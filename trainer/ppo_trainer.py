"""PPO récurrent sur le moteur JS de référence (pool de processus Node, trainer/js_env_pool.py).

- Collecte de séquences de `rollout` pas sur N = processus × environnements ; l'état caché repart de zéro au début
  de chaque épisode (pendant la collecte et pendant l'apprentissage).
- Récompense = celle de l'environnement (somme = score officiel final, contrat §4) + pénalités configurables
  (par erreur moteur, par action refusée). Le masque d'actions vient de l'environnement.
- GAE, normalisation des avantages (par mini-lot), normalisation des observations (statistiques glissantes,
  figées pendant un rollout et sa mise à jour, sauvegardées dans le modèle et exportées), mise à l'échelle des
  retours pour la critique (écart-type glissant des retours actualisés), clipping de la valeur optionnel,
  entropie et taux d'apprentissage planifiés linéairement, écrêtage du gradient, points de sauvegarde, reprise.
- Le champion n'est choisi que sur une évaluation dans le moteur JS (trainer/evaluation.py).

  python -m trainer.ppo_trainer --processus 2 --envs-par-processus 4 --rollout 16 --mises-a-jour 3 \\
      --imitation-exemple --eval-matchs 8 --sortie .data/modeles/fumee
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np
import torch
import torch.nn.functional as F

from trainer.evaluation import MATCHS_SELECTION, evaluate, resume
from trainer.js_env_pool import JsEnvPool, default_procs
from trainer.models import RecurrentActorCritic, RunningMeanStd, load_checkpoint, save_checkpoint
from trainer.scenarios import ScenarioSampler


@dataclass
class PPOConfig:
    """Hyperparamètres. Les valeurs par défaut sont des HYPOTHÈSES de départ (pratiques PPO usuelles),
    pas des valeurs mesurées sur ce problème ; elles sont toutes réglables."""
    # environnement
    processus: int = 1
    envs_par_processus: int = 4
    rollout: int = 32                 # pas par environnement et par mise à jour
    max_decisions: int = 80           # troncature d'un épisode (repris de ENV.play)
    # optimisation
    mises_a_jour: int = 100           # nombre de rollouts + mises à jour (borné aussi par transitions_max / duree_max_s)
    transitions_max: int = 0          # 0 = pas de borne
    duree_max_s: float = 0.0          # 0 = pas de borne
    lr: float = 3e-4
    lr_fin: float = 0.0               # décroissance linéaire de lr vers lr_fin
    gamma: float = 1.0                # objectif = score final (somme non actualisée des récompenses)
    gae_lambda: float = 0.95
    clip: float = 0.2
    clip_valeur: bool = True
    coef_valeur: float = 0.5
    entropie: float = 0.01
    entropie_fin: float = 0.01        # décroissance linéaire de l'entropie vers entropie_fin
    epoques: int = 4
    mini_lots: int = 2                # découpage des N séquences en mini-lots
    grad_max: float = 0.5
    normaliser_obs: bool = True
    normaliser_retours: bool = True
    # récompense : pénalités ajoutées à celle de l'environnement (0 = récompense de l'environnement seule)
    penalite_erreur: float = 0.0      # par décision qui produit une erreur moteur
    penalite_invalide: float = 0.0    # par action refusée par l'environnement (« Action invalide. »)
    # modèle
    hidden: int = 128
    encodeur: List[int] = field(default_factory=lambda: [128])
    acteur: List[int] = field(default_factory=list)
    critique: List[int] = field(default_factory=lambda: [128])
    activation: str = "silu"
    # scénarios
    intensites: List[str] = field(default_factory=lambda: ["aucun"])
    graine: int = 1
    # sauvegardes, évaluation
    checkpoint_tous_les: int = 10
    eval_tous_les: int = 0            # 0 = seulement à la fin
    eval_matchs: int = MATCHS_SELECTION
    eval_graine: int = 10_000


class TimeLimit(Exception):
    """duree_max_s atteinte pendant la collecte d'un rollout (le rollout partiel est abandonné)."""


class PPOTrainer:
    def __init__(self, cfg: PPOConfig, pool: JsEnvPool, sampler: ScenarioSampler,
                 device: Optional[torch.device] = None, model: Optional[RecurrentActorCritic] = None,
                 log: Optional[Callable[[str], None]] = None):
        self.cfg = cfg
        self.pool = pool
        self.sampler = sampler
        self.device = device or torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.log = log or (lambda s: print(s, flush=True))
        self.model = (model or RecurrentActorCritic(pool.n_in, pool.n_out, hidden=cfg.hidden, encodeur=cfg.encodeur,
                                                    acteur=cfg.acteur, critique=cfg.critique,
                                                    activation=cfg.activation)).to(self.device)
        if self.model.n_in != pool.n_in or self.model.n_out != pool.n_out:
            raise ValueError(f"Modèle {self.model.n_in}→{self.model.n_out}, environnement {pool.n_in}→{pool.n_out}.")
        self.opt = torch.optim.Adam(self.model.parameters(), lr=cfg.lr, eps=1e-5)
        self.obs_rms = RunningMeanStd((pool.n_in,))
        self.ret_rms = RunningMeanStd(())
        self.update = 0
        self.global_step = 0
        self.episodes: List[dict] = []
        self.best_eval: Optional[dict] = None
        N = pool.n_envs
        self._ret_acc = np.zeros(N, np.float64)
        self._ep_ret = np.zeros(N, np.float64)
        self._obs = self._mask = None
        self._hidden = self.model.init_hidden(N, self.device)
        self._start = np.ones(N, bool)
        # Rappel de progression pendant la collecte : on_collect(décisions faites, total du rollout, s écoulées).
        # Sur 1 cœur un rollout dure des dizaines de minutes : sans lui, ni progression ni limite de durée.
        self.on_collect: Optional[Callable[[int, int, float], None]] = None
        self.deadline: Optional[float] = None   # instant (time.time()) de fin de la durée maximale

    # ───────── état sauvegardé ─────────
    def state(self) -> dict:
        return {
            "env_config": self.pool.config, "obs_version": self.pool.obs_version,
            "catalogue_version": self.pool.catalogue_version, "catalogue": self.pool.catalogue,
            "groupes": self.pool.groups, "moteur": self.pool.moteur, "bareme": self.pool.bareme,
            "obs_rms": self.obs_rms.state_dict(), "ret_rms": self.ret_rms.state_dict(),
            "optimizer_state": self.opt.state_dict(), "update": self.update, "global_step": self.global_step,
            "ppo_config": asdict(self.cfg), "gamma": self.cfg.gamma, "best_eval": self.best_eval,
        }

    def load_state(self, ck: dict, optimizer: bool = True) -> None:
        if ck.get("obs_rms"):
            self.obs_rms.load_state_dict(ck["obs_rms"])
        if ck.get("ret_rms"):
            self.ret_rms.load_state_dict(ck["ret_rms"])
        if optimizer and ck.get("optimizer_state"):
            self.opt.load_state_dict(ck["optimizer_state"])
        self.update = int(ck.get("update") or 0)
        self.global_step = int(ck.get("global_step") or 0)
        self.best_eval = ck.get("best_eval")

    def save(self, path, extra: Optional[dict] = None) -> None:
        st = self.state()
        st.update(extra or {})
        save_checkpoint(path, self.model, st)

    # ───────── plans ─────────
    def _frac(self) -> float:
        c = self.cfg
        return min(1.0, self.update / max(1, c.mises_a_jour))

    def lr_now(self) -> float:
        return self.cfg.lr + (self.cfg.lr_fin - self.cfg.lr) * self._frac()

    def ent_now(self) -> float:
        return self.cfg.entropie + (self.cfg.entropie_fin - self.cfg.entropie) * self._frac()

    def _ret_scale(self) -> float:
        return float(np.sqrt(self.ret_rms.var + 1e-8)) if self.cfg.normaliser_retours else 1.0

    # ───────── collecte ─────────
    def _penalties(self, infos) -> np.ndarray:
        p = np.zeros(len(infos), np.float32)
        for i, inf in enumerate(infos):
            err = inf.get("err")
            if not err:
                continue
            if err in ("Action invalide.", "Action hors catalogue."):
                p[i] -= self.cfg.penalite_invalide
            else:
                p[i] -= self.cfg.penalite_erreur
        return p

    @torch.no_grad()
    def collect(self) -> dict:
        c, pool, dev = self.cfg, self.pool, self.device
        N, T = pool.n_envs, c.rollout
        if self._obs is None:
            self._obs, self._mask = pool.reset([self.sampler.sample() for _ in range(N)])
            self._start[:] = True
            self._hidden = self.model.init_hidden(N, dev)
        if c.normaliser_obs:
            self.model.set_obs_stats(self.obs_rms.mean, self.obs_rms.var)
        self.model.eval()
        buf = {k: [] for k in ("obs", "mask", "act", "logp", "val", "rew", "done", "start")}
        t_start = time.time()
        h0 = None
        raw_obs = []
        for t in range(T):
            start = torch.as_tensor(self._start, device=dev)
            h_in = self._hidden * (~start).float().unsqueeze(-1)
            if t == 0:
                h0 = h_in.clone()
            o = torch.as_tensor(self._obs, device=dev)
            m = torch.as_tensor(self._mask, device=dev)
            logits, value, h = self.model(o, h_in, m)
            dist = torch.distributions.Categorical(logits=logits)
            a = dist.sample()
            nxt = [self.sampler.sample() for _ in range(N)]
            sr = pool.step(a.cpu().numpy().tolist(), nxt)
            r = sr.reward + self._penalties(sr.infos)
            buf["obs"].append(self._obs); buf["mask"].append(self._mask); buf["start"].append(self._start.copy())
            buf["act"].append(a.cpu().numpy()); buf["logp"].append(dist.log_prob(a).cpu().numpy())
            buf["val"].append(value.cpu().numpy()); buf["rew"].append(r); buf["done"].append(sr.done.copy())
            raw_obs.append(self._obs)
            # échelle des retours : écart-type glissant du retour actualisé
            self._ret_acc = self._ret_acc * c.gamma + r
            self.ret_rms.update(self._ret_acc)
            self._ret_acc[sr.done] = 0.0
            self._ep_ret += r
            for i in np.flatnonzero(sr.done):
                fin = dict(sr.infos[i].get("final") or {})
                fin["retour"] = float(self._ep_ret[i])
                self.episodes.append(fin)
                self._ep_ret[i] = 0.0
            self._obs, self._mask = sr.obs, sr.mask
            self._hidden = h
            self._start = sr.done.copy()
            if self.deadline is not None and time.time() > self.deadline:
                raise TimeLimit()
            if self.on_collect is not None:
                self.on_collect((t + 1) * N, T * N, time.time() - t_start)
        # valeur de la dernière observation (bootstrap)
        start = torch.as_tensor(self._start, device=dev)
        h_in = self._hidden * (~start).float().unsqueeze(-1)
        _, last_v, _ = self.model(torch.as_tensor(self._obs, device=dev), h_in, torch.as_tensor(self._mask, device=dev))
        self.global_step += N * T
        data = {k: np.stack(v) for k, v in buf.items()}
        data["h0"] = h0
        data["last_val"] = last_v.cpu().numpy()
        data["raw_obs"] = np.concatenate(raw_obs)
        return data

    def gae(self, data: dict, scale: float):
        c = self.cfg
        rew = data["rew"] / scale
        val, done = data["val"], data["done"].astype(np.float32)
        T = rew.shape[0]
        adv = np.zeros_like(rew)
        last = np.zeros(rew.shape[1], np.float32)
        for t in reversed(range(T)):
            next_v = data["last_val"] if t == T - 1 else val[t + 1]
            nonterm = 1.0 - done[t]   # troncature traitée comme une fin d'épisode (hypothèse)
            delta = rew[t] + c.gamma * next_v * nonterm - val[t]
            last = delta + c.gamma * c.gae_lambda * nonterm * last
            adv[t] = last
        return adv, adv + val

    def learn(self, data: dict) -> dict:
        c, dev = self.cfg, self.device
        for g in self.opt.param_groups:
            g["lr"] = self.lr_now()
        ent_coef = self.ent_now()
        # l'échelle des retours est figée pour toute la mise à jour (valeurs collectées dans la même échelle)
        adv, ret = self.gae(data, self._scale_used)
        T, N = adv.shape
        to = lambda x, dt=torch.float32: torch.as_tensor(x, device=dev, dtype=dt)
        O, M = to(data["obs"]), to(data["mask"], torch.bool)
        A, LP, V = to(data["act"], torch.long), to(data["logp"]), to(data["val"])
        ADV, RET, S = to(adv), to(ret), to(data["start"])
        h0 = data["h0"]
        n_mb = max(1, min(c.mini_lots, N))
        self.model.train()
        stats = {"perte_politique": 0.0, "perte_valeur": 0.0, "entropie": 0.0, "kl_approx": 0.0, "fraction_clip": 0.0}
        n = 0
        for _ in range(c.epoques):
            perm = np.random.permutation(N)
            for chunk in np.array_split(perm, n_mb):
                idx = torch.as_tensor(chunk, device=dev)
                logits, values, _ = self.model.forward_sequence(O[:, idx], h0[idx], S[:, idx], M[:, idx])
                dist = torch.distributions.Categorical(logits=logits)
                new_lp = dist.log_prob(A[:, idx])
                ent = dist.entropy().mean()
                log_ratio = new_lp - LP[:, idx]
                ratio = log_ratio.exp()
                adv_b = ADV[:, idx]
                adv_b = (adv_b - adv_b.mean()) / (adv_b.std() + 1e-8)
                pg = torch.max(-adv_b * ratio, -adv_b * ratio.clamp(1 - c.clip, 1 + c.clip)).mean()
                if c.clip_valeur:
                    v_clip = V[:, idx] + (values - V[:, idx]).clamp(-c.clip, c.clip)
                    v_loss = 0.5 * torch.max((values - RET[:, idx]) ** 2, (v_clip - RET[:, idx]) ** 2).mean()
                else:
                    v_loss = 0.5 * ((values - RET[:, idx]) ** 2).mean()
                loss = pg + c.coef_valeur * v_loss - ent_coef * ent
                self.opt.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), c.grad_max)
                self.opt.step()
                with torch.no_grad():
                    stats["perte_politique"] += pg.item()
                    stats["perte_valeur"] += v_loss.item()
                    stats["entropie"] += ent.item()
                    stats["kl_approx"] += ((ratio - 1) - log_ratio).mean().item()
                    stats["fraction_clip"] += ((ratio - 1).abs() > c.clip).float().mean().item()
                n += 1
        self.model.eval()
        out = {k: v / max(n, 1) for k, v in stats.items()}
        out.update({"lr": self.lr_now(), "coef_entropie": ent_coef, "echelle_retours": self._scale_used})
        return out

    def train_iteration(self) -> dict:
        """Un rollout + une mise à jour PPO. Renvoie les statistiques."""
        self._scale_used = self._ret_scale()   # échelle utilisée par la critique pendant ce rollout
        n_ep0 = len(self.episodes)
        t0 = time.time()
        data = self.collect()
        t_col = time.time() - t0
        st = self.learn(data)
        if self.cfg.normaliser_obs:
            self.obs_rms.update(data["raw_obs"])
            self.model.set_obs_stats(self.obs_rms.mean, self.obs_rms.var)
        self.update += 1
        new = self.episodes[n_ep0:]
        st.update({
            "mise_a_jour": self.update, "transitions": self.global_step, "duree_collecte_s": t_col,
            "duree_s": time.time() - t0, "decisions_par_s": data["act"].size / max(t_col, 1e-9),
            "episodes": len(new),
            "score_moyen": float(np.mean([e.get("score", 0) for e in new])) if new else None,
            "erreurs_moyennes": float(np.mean([e.get("errors") or 0 for e in new])) if new else None,
            "recompense_rollout": float(data["rew"].sum() / max(1, data["rew"].shape[1])),
        })
        return st

    # ───────── évaluation / champion ─────────
    def evaluate_and_select(self, base: Path, eval_sampler: ScenarioSampler, info_extra: Optional[dict] = None) -> dict:
        from trainer.export_onnx import export_all
        c = self.cfg
        scs = eval_sampler.fixed(c.eval_matchs, c.eval_graine)
        ev = evaluate(self.model, self.pool, scs, self.device, deterministic=True, log=self.log)
        # le pool d'entraînement doit repartir de zéro (les environnements ont servi à l'évaluation)
        self._obs = None
        ev["protocole"] = {"matchs": c.eval_matchs, "graine": c.eval_graine, **eval_sampler.describe(), "glouton": True,
                           "obs_version": self.pool.obs_version, "catalogue_version": self.pool.catalogue_version}
        ev["mise_a_jour"] = self.update
        self.log("Évaluation : " + resume(ev))
        champion_pt = Path(str(base) + ".pt")
        best = self.best_eval
        if best is None and champion_pt.exists():
            try:
                _, old = load_checkpoint(champion_pt)
                if (old.get("evaluation") or {}).get("protocole") == ev["protocole"]:
                    best = old["evaluation"]
            except Exception:
                best = None
        better = best is None or ev["score"]["moyenne"] > best["score"]["moyenne"]
        ev["champion"] = bool(better)
        if better:
            self.best_eval = ev
            extra = {"evaluation": ev}
            extra.update(info_extra or {})
            self.save(champion_pt, extra)
            info = self.state()
            info["evaluation"] = ev
            export_all(self.model, base, info)
            Path(str(base) + ".eval.json").write_text(json.dumps(ev, ensure_ascii=False, indent=2), encoding="utf-8")
            self.log(f"Nouveau champion : {champion_pt}")
        else:
            self.best_eval = best
            self.log(f"Champion conservé (score {best['score']['moyenne']:.1f} ≥ {ev['score']['moyenne']:.1f}).")
        return ev

    def run(self, base: Path, eval_sampler: Optional[ScenarioSampler] = None,
            on_update: Optional[Callable[[dict], bool]] = None) -> dict:
        """Boucle complète. on_update(stats) peut renvoyer True pour arrêter. Écrit <base>.dernier.pt
        (reprise) et, après évaluation, <base>.pt (champion) + exports."""
        c = self.cfg
        base = Path(base)
        eval_sampler = eval_sampler or self.sampler
        t0 = time.time()
        last_eval = None
        self.deadline = t0 + c.duree_max_s if c.duree_max_s else None
        while self.update < c.mises_a_jour:
            try:
                st = self.train_iteration()
            except TimeLimit:
                self.log(f"Durée maximale atteinte pendant la collecte du rollout {self.update + 1} : rollout partiel abandonné.")
                break
            self.log(f"Mise à jour {self.update}/{c.mises_a_jour} — transitions {self.global_step} · "
                     f"épisodes {st['episodes']} · score moyen {st['score_moyen'] if st['score_moyen'] is None else round(st['score_moyen'], 1)} · "
                     f"π {st['perte_politique']:.3f} · V {st['perte_valeur']:.3f} · H {st['entropie']:.3f} · "
                     f"KL {st['kl_approx']:.4f} · {st['decisions_par_s']:.1f} décisions/s")
            stop = bool(on_update and on_update(st))
            if c.checkpoint_tous_les and self.update % c.checkpoint_tous_les == 0:
                self.save(Path(str(base) + ".dernier.pt"))
            if c.eval_tous_les and self.update % c.eval_tous_les == 0 and c.eval_matchs:
                last_eval = self.evaluate_and_select(base, eval_sampler)
                last_eval["_update"] = self.update
            if stop:
                self.log("Arrêt demandé.")
                break
            if c.transitions_max and self.global_step >= c.transitions_max:
                self.log("Nombre maximal de transitions atteint.")
                break
            if c.duree_max_s and time.time() - t0 > c.duree_max_s:
                self.log("Durée maximale atteinte.")
                break
        self.save(Path(str(base) + ".dernier.pt"))
        if c.eval_matchs and (last_eval is None or last_eval.get("_update") != self.update):
            last_eval = self.evaluate_and_select(base, eval_sampler)
        self.deadline = None
        return {"evaluation": last_eval, "best_eval": self.best_eval, "mises_a_jour": self.update,
                "transitions": self.global_step, "duree_s": time.time() - t0}


def main(argv=None):
    from trainer.evaluation import build_sampler
    from trainer.imitation import collect_demos, example_program, imitation_train

    ap = argparse.ArgumentParser(description="PPO récurrent sur le moteur JS de référence.")
    d = PPOConfig()
    ap.add_argument("--processus", type=int, default=default_procs())
    ap.add_argument("--envs-par-processus", type=int, default=d.envs_par_processus)
    ap.add_argument("--rollout", type=int, default=d.rollout)
    ap.add_argument("--mises-a-jour", type=int, default=d.mises_a_jour)
    ap.add_argument("--transitions-max", type=int, default=0)
    ap.add_argument("--duree-max", type=float, default=0.0, help="secondes (0 = sans limite)")
    ap.add_argument("--lr", type=float, default=d.lr)
    ap.add_argument("--lr-fin", type=float, default=d.lr_fin)
    ap.add_argument("--gamma", type=float, default=d.gamma)
    ap.add_argument("--lambda-gae", type=float, default=d.gae_lambda)
    ap.add_argument("--entropie", type=float, default=d.entropie)
    ap.add_argument("--entropie-fin", type=float, default=d.entropie_fin)
    ap.add_argument("--epoques", type=int, default=d.epoques)
    ap.add_argument("--mini-lots", type=int, default=d.mini_lots)
    ap.add_argument("--sans-clip-valeur", action="store_true")
    ap.add_argument("--penalite-erreur", type=float, default=d.penalite_erreur)
    ap.add_argument("--penalite-invalide", type=float, default=d.penalite_invalide)
    ap.add_argument("--hidden", type=int, default=d.hidden)
    ap.add_argument("--intensites", nargs="+", default=d.intensites)
    ap.add_argument("--strategie", action="append", default=[], help="stratégie adverse (répétable)")
    ap.add_argument("--dossier-strategies", help="toutes les stratégies d'un dossier comme adversaires")
    ap.add_argument("--cerveau", nargs=2, action="append", default=[], metavar=("CONFIG", "POIDS"))
    ap.add_argument("--graine", type=int, default=d.graine)
    ap.add_argument("--eval-matchs", type=int, default=d.eval_matchs)
    ap.add_argument("--eval-tous-les", type=int, default=d.eval_tous_les)
    ap.add_argument("--imitation-exemple", action="store_true", help="démarrage à chaud sur ENV.EXAMPLE")
    ap.add_argument("--imitation-strategies", help="démarrage à chaud sur les stratégies d'un dossier")
    ap.add_argument("--imitation-epoques", type=int, default=200)
    ap.add_argument("--imitation-scenarios", type=int, default=4)
    ap.add_argument("--reprendre", help="point de sauvegarde .pt à reprendre (poids, optimiseur, statistiques)")
    ap.add_argument("--env-config", help="configuration ENV.create (JSON)")
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--sortie", default=str(ROOT / ".data" / "modeles" / "ppo"))
    a = ap.parse_args(argv)
    torch.manual_seed(a.graine)
    np.random.seed(a.graine)
    cfg = PPOConfig(processus=a.processus, envs_par_processus=a.envs_par_processus, rollout=a.rollout,
                    mises_a_jour=a.mises_a_jour, transitions_max=a.transitions_max, duree_max_s=a.duree_max,
                    lr=a.lr, lr_fin=a.lr_fin, gamma=a.gamma, gae_lambda=a.lambda_gae, entropie=a.entropie,
                    entropie_fin=a.entropie_fin, epoques=a.epoques, mini_lots=a.mini_lots,
                    clip_valeur=not a.sans_clip_valeur, penalite_erreur=a.penalite_erreur,
                    penalite_invalide=a.penalite_invalide, hidden=a.hidden, intensites=a.intensites,
                    graine=a.graine, eval_matchs=a.eval_matchs, eval_tous_les=a.eval_tous_les)
    env_cfg = json.loads(Path(a.env_config).read_text()) if a.env_config else {"skipContacts": True}
    sampler = build_sampler([Path(p) for p in a.strategie], Path(a.dossier_strategies) if a.dossier_strategies else None,
                            a.cerveau, a.intensites, a.graine)
    device = torch.device(a.device)
    with JsEnvPool(cfg.processus, cfg.envs_par_processus, env_cfg, max_decisions=cfg.max_decisions,
                   opponents=sampler.registry()) as pool:
        print(f"Pool : {pool.describe()}", flush=True)
        model = None
        ck = None
        if a.reprendre:
            model, ck = load_checkpoint(a.reprendre, device)
            if ck.get("catalogue_version") != pool.catalogue_version or ck.get("obs_version") != pool.obs_version:
                raise SystemExit("Le point de sauvegarde ne correspond pas aux versions d'observation/catalogue de l'environnement.")
        tr = PPOTrainer(cfg, pool, sampler, device, model)
        if ck:
            tr.load_state(ck)
            tr.cfg.mises_a_jour = tr.update + a.mises_a_jour
            print(f"Reprise à la mise à jour {tr.update}.", flush=True)
        elif a.imitation_exemple or a.imitation_strategies:
            from trainer.scenarios import load_strategies
            progs = []
            if a.imitation_strategies:
                progs += [{"nom": p["nom"], "program": p["spec"]["program"]} for p in load_strategies(Path(a.imitation_strategies))]
            if a.imitation_exemple:
                progs.append({"nom": "ENV.EXAMPLE", "program": example_program(pool)})
            scs = [{"seed": a.graine + k, "intensite": "aucun"} for k in range(a.imitation_scenarios)]
            demos = collect_demos(pool, progs, scs)
            print(f"Démonstrations : {len(demos)} (scores {[d.score for d in demos]})", flush=True)
            imitation_train(tr.model, demos, epochs=a.imitation_epoques, gamma=cfg.gamma, device=device,
                            obs_rms=tr.obs_rms, ret_rms=tr.ret_rms, log=lambda s: print(s, flush=True))
        res = tr.run(Path(a.sortie))
        print(json.dumps({k: v for k, v in res.items() if k != "best_eval"}, ensure_ascii=False, default=str)[:4000])
        print(f"Statistiques du pool : {pool.stats}")


if __name__ == "__main__":
    main()
