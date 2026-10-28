"""Évaluation d'un cerveau dans le moteur JS de référence (seul juge pour la sélection du champion).

N matchs (scénarios déterministes : mêmes graines et adversaires d'un appel à l'autre), politique gloutonne
(argmax des logits masqués) ou échantillonnée. Rapport : moyenne ± écart-type, min/max, taux de victoire
contre l'adversaire, erreurs moteur par match, crashs, troncatures, débit.

  python -m trainer.evaluation --modele .data/modeles/fumee.pt --matchs 200 --intensites realiste \\
      --strategie .data/strategies/ma-strategie.json
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np
import torch

from trainer.js_env_pool import JsEnvPool, default_procs
from trainer.models import RecurrentActorCritic, load_checkpoint
from trainer.scenarios import INTENSITES, ScenarioSampler, brain_opponent, load_strategies, load_strategy_file

# Hypothèse : nombre de matchs pour sélectionner un champion (critère de sortie de la phase 3 de l'audit : ≥ 200).
MATCHS_SELECTION = 200


def _stats(xs: Sequence[float]) -> dict:
    if not xs:
        return {"moyenne": None, "ecart_type": None, "min": None, "max": None, "ic95": None}
    a = np.asarray(xs, dtype=np.float64)
    sd = float(a.std(ddof=1)) if a.size > 1 else 0.0
    return {"moyenne": float(a.mean()), "ecart_type": sd, "min": float(a.min()), "max": float(a.max()),
            "ic95": 1.96 * sd / math.sqrt(a.size) if a.size > 1 else None}


@torch.no_grad()
def evaluate(
    model: Optional[RecurrentActorCritic],
    pool: JsEnvPool,
    scenarios: Sequence[dict],
    device: Optional[torch.device] = None,
    deterministic: bool = True,
    seed: int = 0,
    log: Optional[Callable[[str], None]] = None,
) -> dict:
    """Joue len(scenarios) matchs. model=None : politique aléatoire uniforme sur les actions valides (référence)."""
    device = device or torch.device("cpu")
    if model is not None:
        model.eval()
        if model.n_in != pool.n_in or model.n_out != pool.n_out:
            raise ValueError(f"Modèle {model.n_in}→{model.n_out} incompatible avec l'environnement {pool.n_in}→{pool.n_out}.")
    rng = np.random.default_rng(seed)
    scs = list(scenarios)
    N = pool.n_envs
    t0 = time.time()
    dec0 = pool.stats["decisions"]
    nxt = 0
    env_sc: List[Optional[dict]] = [None] * N
    first = []
    for i in range(N):
        if nxt < len(scs):
            first.append(scs[nxt]); env_sc[i] = scs[nxt]; nxt += 1
    obs = np.zeros((N, pool.n_in), np.float32)
    mask = np.ones((N, pool.n_out), bool)
    if first:
        got = pool.reset_ids(list(range(len(first))), first)
        for i, (o, m) in got.items():
            obs[i], mask[i] = o, m
    active = np.array([env_sc[i] is not None for i in range(N)])
    hidden = model.init_hidden(N, device) if model is not None else None
    results: List[dict] = []
    while active.any():
        if model is not None:
            logits, _, h = model(torch.as_tensor(obs, device=device), hidden, torch.as_tensor(mask, device=device))
            if deterministic:
                a = torch.argmax(logits, -1)
            else:
                a = torch.distributions.Categorical(logits=logits).sample()
            acts = a.cpu().numpy()
            hidden = h
        else:
            acts = np.array([rng.choice(np.flatnonzero(m)) for m in mask])
        sr = pool.step([int(acts[i]) if active[i] else None for i in range(N)])
        obs, mask = sr.obs, sr.mask
        to_reset, reset_sc = [], []
        for i in np.flatnonzero(active & sr.done):
            fin = dict(sr.infos[i].get("final") or {})
            fin["scenario"] = env_sc[i]
            results.append(fin)
            if nxt < len(scs):
                to_reset.append(int(i)); reset_sc.append(scs[nxt]); env_sc[i] = scs[nxt]; nxt += 1
            else:
                active[i] = False; env_sc[i] = None
        if to_reset:
            for i, (o, m) in pool.reset_ids(to_reset, reset_sc).items():
                obs[i], mask[i] = o, m
            if hidden is not None:
                hidden[torch.as_tensor(to_reset, device=device)] = 0.0
        if log and results and len(results) % max(1, len(scs) // 10) == 0 and to_reset:
            log(f"Évaluation : {len(results)}/{len(scs)} matchs")
    dt = max(time.time() - t0, 1e-9)
    return rapport(results, dt, pool.stats["decisions"] - dec0)


def rapport(results: List[dict], duree_s: float, decisions: int) -> dict:
    scores = [float(r.get("score") or 0) for r in results]
    errs = [int(r.get("errors") or 0) for r in results]
    duels = [r for r in results if r.get("adversaire")]
    wins = sum(1 for r in duels if r["score"] > r["adversaire"]["score"])
    ties = sum(1 for r in duels if r["score"] == r["adversaire"]["score"])
    par_adv: Dict[str, List[dict]] = {}
    for r in results:
        sc = r.get("scenario") or {}
        key = (sc.get("opponentRef") or "sans adversaire") + " · " + (sc.get("intensite") or "aucun")
        par_adv.setdefault(key, []).append(r)
    detail_keys = sorted({k for r in results for k in (r.get("detail") or {})})
    return {
        "matchs": len(results),
        "score": _stats(scores),
        "erreurs_par_match": _stats(errs),
        "erreurs_moteur": errs,
        "matchs_sans_erreur": sum(1 for e in errs if e == 0),
        "duels": len(duels),
        "victoires": wins, "egalites": ties, "defaites": len(duels) - wins - ties,
        "taux_victoire": (wins / len(duels)) if duels else None,
        "score_adversaire": _stats([float(r["adversaire"]["score"]) for r in duels]),
        "crashs": sum(1 for r in results if r.get("crash")),
        "tronques": sum(1 for r in results if r.get("truncated")),
        "actions_invalides": sum(int(r.get("invalid") or 0) for r in results),
        "detail_moyen": {k: float(np.mean([(r.get("detail") or {}).get(k) or 0 for r in results])) for k in detail_keys},
        "par_adversaire": {k: {"matchs": len(v), "score": _stats([float(x.get("score") or 0) for x in v]),
                               "taux_victoire": (sum(1 for x in v if x.get("adversaire") and x["score"] > x["adversaire"]["score"])
                                                 / max(1, sum(1 for x in v if x.get("adversaire"))))
                               if any(x.get("adversaire") for x in v) else None}
                           for k, v in sorted(par_adv.items())},
        "duree_s": duree_s,
        "matchs_par_s": len(results) / duree_s if duree_s > 0 else None,
        "decisions": decisions,
        "decisions_par_s": decisions / duree_s if duree_s > 0 else None,
    }


def resume(r: dict) -> str:
    s = r["score"]
    txt = f"{r['matchs']} matchs : score {s['moyenne']:.1f} ± {s['ecart_type']:.1f} (min {s['min']:.0f}, max {s['max']:.0f})"
    if r.get("taux_victoire") is not None:
        txt += f" · victoires {100 * r['taux_victoire']:.0f} % ({r['victoires']}/{r['duels']})"
    e = r["erreurs_par_match"]
    txt += f" · erreurs moteur/match {e['moyenne']:.2f} · crashs {r['crashs']} · tronqués {r['tronques']}"
    txt += f" · {r['matchs_par_s']:.2f} matchs/s, {r['decisions_par_s']:.1f} décisions/s"
    return txt


def build_sampler(strategies: Sequence[Path] = (), dossier: Optional[Path] = None, cerveaux: Sequence[tuple] = (),
                  intensites: Sequence[str] = ("aucun",), seed: int = 1) -> ScenarioSampler:
    opps = [load_strategy_file(p) for p in strategies]
    opps += load_strategies(dossier) if dossier else []
    for k, (cfg_path, poids_path) in enumerate(cerveaux):
        cfg = json.loads(Path(cfg_path).read_text(encoding="utf-8"))
        poids = json.loads(Path(poids_path).read_text(encoding="utf-8"))
        opps.append(brain_opponent(cfg, poids, ident=f"cerveau:{Path(cfg_path).stem}"))
    return ScenarioSampler(opps, intensites, seed)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Évalue un cerveau dans le moteur JS de référence.")
    ap.add_argument("--modele", help="point de sauvegarde .pt (sinon : politique aléatoire de référence)")
    ap.add_argument("--matchs", type=int, default=MATCHS_SELECTION)
    ap.add_argument("--processus", type=int, default=default_procs())
    ap.add_argument("--envs-par-processus", type=int, default=4)
    ap.add_argument("--intensites", nargs="+", default=["aucun"], choices=INTENSITES)
    ap.add_argument("--strategie", action="append", default=[], help="stratégie adverse (JSON camelot-strategie), répétable")
    ap.add_argument("--dossier-strategies", help="toutes les stratégies d'un dossier comme adversaires")
    ap.add_argument("--cerveau", nargs=2, action="append", default=[], metavar=("CONFIG", "POIDS"),
                    help="cerveau MLP adverse : configuration camelot-cerveau et poids camelot-poids")
    ap.add_argument("--graine", type=int, default=10_000, help="première graine des scénarios")
    ap.add_argument("--echantillonner", action="store_true", help="politique échantillonnée au lieu de gloutonne")
    ap.add_argument("--sortie", help="écrit le rapport JSON ici")
    ap.add_argument("--env-config", help="configuration ENV.create (JSON) ; sinon celle du point de sauvegarde")
    a = ap.parse_args(argv)
    model, ck = (None, {})
    if a.modele:
        model, ck = load_checkpoint(a.modele)
    env_cfg = json.loads(Path(a.env_config).read_text()) if a.env_config else (ck.get("env_config") or {"skipContacts": True})
    sampler = build_sampler([Path(p) for p in a.strategie], Path(a.dossier_strategies) if a.dossier_strategies else None,
                            a.cerveau, a.intensites)
    with JsEnvPool(a.processus, a.envs_par_processus, env_cfg, opponents=sampler.registry()) as pool:
        if model is not None and (ck.get("catalogue_version") not in (None, pool.catalogue_version)
                                  or ck.get("obs_version") not in (None, pool.obs_version)):
            print("Attention : versions d'observation/catalogue différentes de celles de l'entraînement.", file=sys.stderr)
        r = evaluate(model, pool, sampler.fixed(a.matchs, a.graine), deterministic=not a.echantillonner, log=print)
    r["protocole"] = {"matchs": a.matchs, "graine": a.graine, **sampler.describe(), "glouton": not a.echantillonner}
    print(resume(r))
    if a.sortie:
        Path(a.sortie).parent.mkdir(parents=True, exist_ok=True)
        Path(a.sortie).write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
    return r


if __name__ == "__main__":
    main()
