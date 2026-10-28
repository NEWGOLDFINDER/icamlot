"""Imitation (démarrage à chaud) du réseau récurrent à partir de programmes joués dans le moteur JS.

Les démonstrations viennent de `env.imitate` via la commande `imitate_trace` du worker : pour chaque décision,
(observation, action du catalogue, masque, récompense, instant). Corrections par rapport à l'ancienne version (audit M5) :
- entropie croisée MASQUÉE : les logits des actions invalides sont mis à −1e9 avant la perte ;
- une cible invalide sous le masque (ex. « Lâcher les boulets » avant que le masque ne l'autorise) est ignorée et comptée ;
- cible de valeur = retour réel actualisé de la démonstration (plus de constante 105), à l'échelle des retours ;
- plusieurs démonstrations (plusieurs programmes × plusieurs scénarios), chacune déroulée comme une séquence
  (état caché remis à zéro au début de chaque démonstration).

  python -m trainer.imitation --exemple --strategies .data/strategies --scenarios 4 --epoques 200 \\
      --sortie .data/modeles/imitation
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Optional, Sequence

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np
import torch
import torch.nn.functional as F

from trainer.js_env_pool import JsEnvPool, default_procs
from trainer.models import MASK_LOGIT, RecurrentActorCritic, RunningMeanStd, masked_logits, save_checkpoint
from trainer.scenarios import ScenarioSampler, load_strategies


@dataclass
class Demo:
    nom: str
    obs: np.ndarray       # (T, n_in)
    actions: np.ndarray   # (T,)
    masks: np.ndarray     # (T, n_out) bool
    rewards: np.ndarray   # (T,)
    score: float
    score0: float
    erreurs: int


def example_program(pool: JsEnvPool) -> List[dict]:
    """Programme d'exemple de engine/env.js (ENV.EXAMPLE)."""
    return pool.map([{"cmd": "example"}])[0]["program"]


def collect_demos(pool: JsEnvPool, programmes: Sequence[dict], scenarios: Sequence[dict],
                  timeout: Optional[float] = None) -> List[Demo]:
    """programmes : [{ nom, program }] ; chaque programme est joué dans chaque scénario (en parallèle sur le pool)."""
    msgs, noms = [], []
    for p in programmes:
        for sc in scenarios:
            msgs.append({"cmd": "imitate_trace", "program": p["program"], "scenario": sc})
            noms.append(f"{p['nom']} · graine {sc.get('seed')} · {sc.get('intensite', 'aucun')}")
    out = pool.map(msgs, timeout=timeout or max(pool.timeout, 600.0))
    demos = []
    for nom, r in zip(noms, out):
        pairs = r.get("pairs") or []
        if not pairs:
            continue
        demos.append(Demo(
            nom=nom,
            obs=np.asarray([p["obs"] for p in pairs], dtype=np.float32).reshape(len(pairs), pool.n_in),
            actions=np.asarray([p["action"] for p in pairs], dtype=np.int64),
            masks=np.asarray([p["mask"] for p in pairs], dtype=bool).reshape(len(pairs), pool.n_out),
            rewards=np.asarray([p.get("reward", 0.0) for p in pairs], dtype=np.float32),
            score=float(r.get("score") or 0), score0=float(r.get("score0") or 0), erreurs=int(r.get("errors") or 0),
        ))
    return demos


def discounted_returns(rewards: np.ndarray, gamma: float) -> np.ndarray:
    G = np.zeros_like(rewards, dtype=np.float64)
    acc = 0.0
    for t in range(len(rewards) - 1, -1, -1):
        acc = float(rewards[t]) + gamma * acc
        G[t] = acc
    return G.astype(np.float32)


def imitation_train(
    model: RecurrentActorCritic,
    demos: Sequence[Demo],
    epochs: int = 200,
    lr: float = 1e-3,
    gamma: float = 1.0,
    value_coef: float = 0.5,
    batch_demos: int = 16,
    max_grad_norm: float = 0.5,
    device: Optional[torch.device] = None,
    obs_rms: Optional[RunningMeanStd] = None,
    ret_rms: Optional[RunningMeanStd] = None,
    seed: int = 1,
    log: Optional[Callable[[str], None]] = None,
    progress: Optional[Callable[[int, dict], bool]] = None,
) -> dict:
    """Apprentissage supervisé séquentiel. Met à jour obs_rms / ret_rms (créés si absents) et les statistiques
    de normalisation du modèle. progress(époque, stats) peut renvoyer True pour arrêter."""
    device = device or torch.device("cpu")
    if not demos:
        raise ValueError("Aucune démonstration.")
    n_in, n_out = model.n_in, model.n_out
    obs_rms = obs_rms or RunningMeanStd((n_in,))
    ret_rms = ret_rms or RunningMeanStd(())
    all_obs = np.concatenate([d.obs for d in demos])
    obs_rms.update(all_obs)
    model.set_obs_stats(obs_rms.mean, obs_rms.var)
    returns = [discounted_returns(d.rewards, gamma) for d in demos]
    ret_rms.update(np.concatenate(returns))
    scale = float(np.sqrt(ret_rms.var + 1e-8))

    # séquences complétées (padding) : (T, D, ...)
    D, T = len(demos), max(len(d.actions) for d in demos)
    obs = np.zeros((T, D, n_in), np.float32)
    masks = np.ones((T, D, n_out), bool)
    acts = np.zeros((T, D), np.int64)
    valid = np.zeros((T, D), bool)          # pas réel (hors padding)
    target_ok = np.zeros((T, D), bool)      # cible autorisée par le masque
    vt = np.zeros((T, D), np.float32)
    for k, d in enumerate(demos):
        n = len(d.actions)
        obs[:n, k], masks[:n, k], acts[:n, k] = d.obs, d.masks, d.actions
        valid[:n, k] = True
        target_ok[:n, k] = d.masks[np.arange(n), d.actions]
        vt[:n, k] = returns[k] / scale
    n_total, n_invalid = int(valid.sum()), int((valid & ~target_ok).sum())
    if log:
        log(f"Imitation : {D} démonstrations, {n_total} décisions, {n_invalid} cibles invalides sous le masque (ignorées).")
    to = lambda x, dt=None: torch.as_tensor(x, device=device, dtype=dt)
    O, M, A = to(obs), to(masks), to(acts)
    V, OK, VT = to(valid), to(valid & target_ok), to(vt)
    starts = torch.zeros((T, D), device=device)
    starts[0] = 1.0
    opt = torch.optim.Adam(model.parameters(), lr=lr, eps=1e-5)
    rng = np.random.default_rng(seed)
    model.train()
    hist = []
    stats = {}
    for ep in range(1, epochs + 1):
        perm = rng.permutation(D)
        tot_ce = tot_v = tot_acc = 0.0
        for b0 in range(0, D, batch_demos):
            idx = torch.as_tensor(perm[b0:b0 + batch_demos], device=device)
            logits, values, _ = model.forward_sequence(O[:, idx], model.init_hidden(len(idx), device), starts[:, idx], M[:, idx])
            ok = OK[:, idx]
            ce = F.cross_entropy(logits.reshape(-1, n_out), A[:, idx].reshape(-1), reduction="none").reshape(ok.shape)
            ce_loss = (ce * ok).sum() / ok.sum().clamp(min=1)
            vmask = V[:, idx].float()
            v_loss = (((values - VT[:, idx]) ** 2) * vmask).sum() / vmask.sum().clamp(min=1)
            loss = ce_loss + value_coef * v_loss
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_grad_norm)
            opt.step()
            with torch.no_grad():
                acc = ((logits.argmax(-1) == A[:, idx]) & ok).sum().item()
            tot_ce += ce_loss.item() * len(idx)
            tot_v += v_loss.item() * len(idx)
            tot_acc += acc
        stats = {"epoque": ep, "perte_ce": tot_ce / D, "perte_valeur": tot_v / D,
                 "precision": tot_acc / max(1, n_total - n_invalid),
                 "decisions": n_total, "cibles_invalides": n_invalid, "demonstrations": D, "echelle_retours": scale}
        hist.append(stats)
        if log and (ep == 1 or ep % max(1, epochs // 10) == 0 or ep == epochs):
            log(f"Imitation époque {ep}/{epochs} — perte CE {stats['perte_ce']:.4f} · valeur {stats['perte_valeur']:.4f} · "
                f"précision {100 * stats['precision']:.1f} %")
        if progress and progress(ep, stats):
            break
    model.eval()
    stats["historique"] = hist
    stats["obs_rms"] = obs_rms
    stats["ret_rms"] = ret_rms
    return stats


def main(argv=None):
    from trainer.evaluation import evaluate, resume
    from trainer.export_onnx import export_all

    ap = argparse.ArgumentParser(description="Imitation (démarrage à chaud) sur le moteur JS de référence.")
    ap.add_argument("--exemple", action="store_true", help="ajoute le programme d'exemple de engine/env.js")
    ap.add_argument("--strategies", help="dossier de stratégies (camelot-strategie) à imiter")
    ap.add_argument("--scenarios", type=int, default=4, help="nombre de graines par programme")
    ap.add_argument("--intensites", nargs="+", default=["aucun"])
    ap.add_argument("--epoques", type=int, default=200)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--gamma", type=float, default=1.0)
    ap.add_argument("--hidden", type=int, default=128)
    ap.add_argument("--processus", type=int, default=default_procs())
    ap.add_argument("--envs-par-processus", type=int, default=2)
    ap.add_argument("--eval-matchs", type=int, default=0, help="évaluation finale (0 = aucune)")
    ap.add_argument("--sortie", default=str(ROOT / ".data" / "modeles" / "imitation"))
    a = ap.parse_args(argv)
    env_cfg = {"skipContacts": True}
    sampler = ScenarioSampler([], ["aucun"], 1)
    with JsEnvPool(a.processus, a.envs_par_processus, env_cfg) as pool:
        progs = load_strategies(Path(a.strategies)) if a.strategies else []
        programmes = [{"nom": p["nom"], "program": p["spec"]["program"]} for p in progs]
        if a.exemple:
            programmes.append({"nom": "ENV.EXAMPLE", "program": example_program(pool)})
        if not programmes:
            ap.error("Aucun programme à imiter (--exemple ou --strategies).")
        scs = [{"seed": 1 + k, "intensite": a.intensites[k % len(a.intensites)]} for k in range(a.scenarios)]
        t0 = time.time()
        demos = collect_demos(pool, programmes, scs)
        print(f"{len(demos)} démonstrations en {time.time() - t0:.1f} s ; scores : {[d.score for d in demos]}")
        model = RecurrentActorCritic(pool.n_in, pool.n_out, hidden=a.hidden)
        st = imitation_train(model, demos, epochs=a.epoques, lr=a.lr, gamma=a.gamma, log=print)
        ev = None
        if a.eval_matchs:
            ev = evaluate(model, pool, sampler.fixed(a.eval_matchs))
            print(resume(ev))
        extra = {"env_config": env_cfg, "obs_version": pool.obs_version, "catalogue_version": pool.catalogue_version,
                 "catalogue": pool.catalogue, "groupes": pool.groups, "moteur": pool.moteur, "bareme": pool.bareme,
                 "obs_rms": st["obs_rms"].state_dict(), "ret_rms": st["ret_rms"].state_dict(), "gamma": a.gamma,
                 "imitation": {k: v for k, v in st.items() if k not in ("historique", "obs_rms", "ret_rms")},
                 "evaluation": ev}
        save_checkpoint(a.sortie + ".pt", model, extra)
        print(json.dumps(export_all(model, a.sortie, extra), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
