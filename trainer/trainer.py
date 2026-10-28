#!/usr/bin/env python3
"""Entraîneur ICAM LOT lancé par l'API (api/server.py) : une tâche JSON → évolution, imitation ou PPO.

Toutes les méthodes jouent dans le moteur JS de référence (pool de processus Node, trainer/js_env_pool.py) :
- evolution : neuroévolution d'un MLP (CPU, NumPy), chaque individu joue des matchs complets (commande « play ») ;
- imitation : démarrage à chaud du réseau récurrent sur des programmes (stratégies enregistrées, ENV.EXAMPLE) ;
- ppo       : PPO récurrent (imitation préalable optionnelle).
Imitation et PPO se terminent par une évaluation dans le moteur JS et un export ONNX + meta + JSON web.

  python -m trainer.trainer --job <tâche.json> --strategies <dossier> --weights-out <poids.json>
"""
from __future__ import annotations

import argparse
import json
import math
import os
import signal
import sys
import time
from pathlib import Path
from typing import List, Optional

ROOT = Path(__file__).resolve().parent.parent
# Hypothèse : période minimale (s) entre deux messages de progression pendant la collecte du 1er rollout.
MESSAGE_PERIODE_S = 2.0
TRAINER_DIR = Path(__file__).resolve().parent
# Éliminer le dossier trainer/ de sys.path pour éviter qu'un module trainer.py masque le package trainer
while str(TRAINER_DIR) in sys.path:
    sys.path.remove(str(TRAINER_DIR))
if str(ROOT) in sys.path:
    sys.path.remove(str(ROOT))
sys.path.insert(0, str(ROOT))

import numpy as np

from trainer.js_env_pool import JsEnvPool, default_procs
from trainer.scenarios import ROBOTS, SELF, ScenarioSampler, load_strategies

try:
    import torch
    HAS_TORCH = True
except ImportError:  # pragma: no cover
    torch = None
    HAS_TORCH = False


def atomic_write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def append_log(path: Path, line: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(line.rstrip() + "\n")


def device_info():
    if HAS_TORCH and torch.cuda.is_available():
        name = torch.cuda.get_device_name(0)
        mem = torch.cuda.get_device_properties(0).total_memory
        return {"device": "cuda", "name": name + " (réseau sur GPU, moteur JS sur CPU)", "vram_mo": round(mem / 1024 / 1024)}
    return {"device": "cpu", "name": "CPU (moteur JS" + (" + PyTorch)" if HAS_TORCH else " + NumPy)"), "vram_mo": 0}


def torch_device():
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


# ───────────── MLP de l'évolution (NumPy) ─────────────
def activations_of(cfg):
    reseau = cfg.get("reseau") or {}
    couches = reseau.get("couches") or [{"activation": "relu"}, {"activation": "relu"}]
    return [c.get("activation", "relu") for c in couches]


def sizes_of(cfg, n_in, n_out):
    reseau = cfg.get("reseau") or {}
    couches = reseau.get("couches") or [{"neurones": 64}, {"neurones": 64}]
    hidden = [int(c.get("neurones", 64)) for c in couches]
    return [n_in] + hidden + [n_out]


def init_weights(sizes, seed: int):
    rng = np.random.RandomState(seed)
    layers = []
    for a, b in zip(sizes[:-1], sizes[1:]):
        w = rng.randn(a, b).astype(np.float32) * np.sqrt(2.0 / max(a, 1))
        layers.append({"w": w, "b": np.zeros(b, dtype=np.float32)})
    return layers


def clone_weights(layers):
    return [{"w": l["w"].copy(), "b": l["b"].copy()} for l in layers]


def mutate(layers, sigma: float, rng: np.random.RandomState):
    out = clone_weights(layers)
    for l in out:
        l["w"] += rng.randn(*l["w"].shape).astype(np.float32) * sigma
        l["b"] += rng.randn(*l["b"].shape).astype(np.float32) * sigma
    return out


def weights_to_json(layers):
    return [{"w": np.asarray(l["w"]).tolist(), "b": np.asarray(l["b"]).tolist()} for l in layers]


def weights_from_json(raw):
    return [{"w": np.asarray(l["w"], dtype=np.float32), "b": np.asarray(l["b"], dtype=np.float32)} for l in raw]


# ───────────── tâche ─────────────
class Job:
    def __init__(self, path: Path):
        self.path = path
        self.data = json.loads(path.read_text(encoding="utf-8"))
        self.log = Path(self.data.get("log") or str(path.with_suffix(".log")))

    def save(self):
        atomic_write(self.path, self.data)

    def logline(self, msg):
        ts = time.strftime("%H:%M:%S")
        append_log(self.log, f"[{ts}] {msg}")
        self.data.setdefault("progress", {})["message"] = msg
        self.save()

    def _status(self):
        try:
            return json.loads(self.path.read_text(encoding="utf-8")).get("status")
        except (OSError, ValueError):
            return None

    def paused(self):
        return self._status() == "paused"

    def stopped(self):
        return self._status() in ("stopped", "annule")

    def wait_if_paused(self):
        while self.paused():
            time.sleep(0.4)
            if self.stopped():
                return True
        return self.stopped()


def env_config_of(cfg: dict) -> dict:
    """Configuration passée à ENV.create (engine/env.js)."""
    return {
        "entrees": cfg.get("entrees"),
        "familles": (cfg.get("actions") or {}).get("familles"),
        "params": cfg.get("params") or {},
        "mode": (cfg.get("reglages") or {}).get("mode") or "rapide",
        "skipContacts": ((cfg.get("reglages") or {}).get("mode") or "rapide") == "rapide",
        "onError": (cfg.get("recompense") or {}).get("sur_erreur") or "penalite",
        "recompense": cfg.get("recompense") or {},
        # caractéristiques physiques de notre robot : { actif, valeurs, plages } (ENV.create({ physique }), contrat §14)
        "physique": cfg.get("physique") or None,
    }


def procs_of(cfg: dict) -> int:
    n = int((cfg.get("reglages") or {}).get("processus") or 0)
    return n if n > 0 else default_procs()


def qualified_opponents(pool: JsEnvPool, strats: List[dict], min_score: float = 70) -> List[dict]:
    """Stratégies enregistrées jouables comme adversaires (ENV.qualify : sans erreur et ≥ 70 pts, règle de engine/env.js)."""
    if not strats:
        return []
    res = pool.map([{"cmd": "qualify", "strategy": s["spec"]} for s in strats])
    kept = []
    for s, q in zip(strats, res):
        if q.get("ok") and float(q.get("score") or 0) >= min_score:
            kept.append(dict(s, score=q["score"]))
    return kept


def sampler_of(cfg: dict, opponents: List[dict], pool: Optional[JsEnvPool] = None, log=None) -> ScenarioSampler:
    """Scénarios d'entraînement. cfg.adversaire.melange = { batisseur, razzia, champion, intermediaire, self, reference,
    aucun, <id de stratégie> : proportion } (défaut de l'interface : 20 % de chacun des 4 robots + 20 % de self-play).
    Un robot « réseau » sans modèle figé (.data/adversaires/<id>.json) est retiré du mélange (signalé)."""
    adv = cfg.get("adversaire") or {}
    intensity = adv.get("intensite") or "aucun"
    seed = int((cfg.get("reglages") or {}).get("graine") or 1)
    melange = adv.get("melange")
    if melange:
        m = {k: float(v) for k, v in melange.items() if v and float(v) > 0}
        if pool is not None:
            dispo = {r["id"]: r.get("modele") for r in pool.robots_adverses()}
            for k in list(m):
                if k in ROBOTS and not dispo.get(k):
                    if log:
                        log(f"Adversaire « {k} » : modèle figé absent (.data/adversaires/{k}.json), retiré du mélange.")
                    m.pop(k)
        known = {o["id"] for o in opponents}
        for k in list(m):
            if k not in ROBOTS and k not in (SELF, "reference", "aucun") and k not in known:
                if log:
                    log(f"Adversaire « {k} » inconnu, retiré du mélange.")
                m.pop(k)
        if m:
            return ScenarioSampler(opponents, ["realiste"], seed, melange=m)
    return ScenarioSampler(opponents if intensity != "aucun" else [], [intensity], seed)


# ───────────── évolution ─────────────
def run_evolution(job: Job, pool: JsEnvPool, cfg: dict, sampler: ScenarioSampler):
    regl = cfg.get("reglages") or {}
    pop_n = int(regl.get("population") or 20)
    gens = int(regl.get("generations") or 30)
    sigma = float(regl.get("mutation") or 0.1)
    n_scen = int(regl.get("scenarios_par_evaluation") or 1)
    seed = int(regl.get("graine") or 1)
    t_max = float(regl.get("duree_max") or 300)
    pen = float((cfg.get("recompense") or {}).get("penalite_erreur") or 0)
    elites = max(1, pop_n // 5)
    rng = np.random.RandomState(seed)
    acts = activations_of(cfg)
    sizes = sizes_of(cfg, pool.n_in, pool.n_out)
    start = cfg.get("poids")
    base = weights_from_json(start) if start else init_weights(sizes, seed)
    if [l["w"].shape for l in base] != [(a, b) for a, b in zip(sizes[:-1], sizes[1:])]:
        job.logline("Poids de reprise incompatibles avec l'environnement actuel : départ aléatoire.")
        base = init_weights(sizes, seed)
    pop = [base] + [mutate(base, sigma, rng) for _ in range(pop_n - 1)]
    t0 = time.time()
    matches = 0
    history = []
    best_w, best_sc = clone_weights(base), -1e9
    opps = sampler.opponents

    def scenario(g, k):
        sc = {"seed": seed + g * 100 + k, "intensite": sampler.intensites[0]}
        if opps and sc["intensite"] != "aucun":
            sc["opponentRef"] = opps[(seed + g + k) % len(opps)]["id"]
        return sc

    for g in range(1, gens + 1):
        if job.wait_if_paused():
            job.data["status"] = "stopped"
            job.logline("Entraînement arrêté.")
            return best_w, best_sc, history
        t_gen = time.time()
        msgs = [{"cmd": "play", "layers": weights_to_json(ind), "acts": acts, "scenario": scenario(g, k)}
                for ind in pop for k in range(n_scen)]
        res = pool.map(msgs)
        matches += len(msgs)
        scores = []
        for i in range(len(pop)):
            vals = [float(r.get("score") or 0) - pen * float(r.get("errors") or 0) for r in res[i * n_scen:(i + 1) * n_scen]]
            scores.append(float(np.mean(vals)))
        order = sorted(range(len(pop)), key=lambda i: scores[i], reverse=True)
        pop = [pop[i] for i in order]
        scores = [scores[i] for i in order]
        if scores[0] > best_sc:
            best_sc, best_w = scores[0], clone_weights(pop[0])
        mean, worst = float(np.mean(scores)), float(scores[-1])
        dt = time.time() - t_gen
        elapsed = time.time() - t0
        history.append({"g": g, "best": scores[0], "mean": mean, "worst": worst})
        job.data["progress"] = {
            "methode": "evolution", "generation": g, "generations": gens, "best": scores[0], "mean": mean,
            "worst": worst, "history": history[-200:], "eta_s": round((elapsed / g) * (gens - g)),
            "elapsed_s": round(elapsed), "matches": matches, "matches_per_s": round(len(msgs) / max(dt, 1e-6), 2),
            "processus": pool.n_procs, **device_info(),
        }
        job.data["status"] = "running"
        job.data["best_score"] = best_sc
        job.save()
        job.logline(f"Génération {g}/{gens} — meilleur {scores[0]:.1f} · moyen {mean:.1f} · pire {worst:.1f} · "
                    f"{len(msgs) / max(dt, 1e-6):.2f} matchs/s")
        if elapsed > t_max:
            job.logline("Durée maximale atteinte, on s'arrête.")
            break
        new_pop = [clone_weights(pop[i]) for i in range(elites)]
        while len(new_pop) < pop_n:
            new_pop.append(mutate(pop[rng.randint(0, elites)], sigma, rng))
        pop = new_pop
    return best_w, best_sc, history


# ───────────── nouvelle pile : imitation / PPO ─────────────
def model_base(out: Path) -> Path:
    """<poids>.json → base des fichiers du modèle : <poids>.modele.{pt,onnx,meta.json,json}."""
    return Path(str(out.with_suffix("")) + ".modele")


def model_of(cfg: dict, pool: JsEnvPool):
    from trainer.models import RecurrentActorCritic
    regl = cfg.get("reglages") or {}
    hidden = int(regl.get("hidden") or 128)
    return RecurrentActorCritic(pool.n_in, pool.n_out, hidden=hidden)


def demos_for(job: Job, pool: JsEnvPool, cfg: dict, strats: List[dict], sampler: ScenarioSampler):
    from trainer.imitation import collect_demos, example_program
    regl = cfg.get("reglages") or {}
    progs = [{"nom": s["nom"], "program": s["spec"]["program"]} for s in strats]
    # programmes de démonstration fournis par la tâche (entraînement des adversaires : trainer/adversaires.py)
    progs += [{"nom": d.get("nom") or "demonstration", "program": d["program"]} for d in (cfg.get("demonstrations") or [])]
    if regl.get("imitation_exemple", True):
        progs.append({"nom": "ENV.EXAMPLE", "program": example_program(pool)})
    n_sc = int(regl.get("imitation_scenarios") or 4)
    scs = [{"seed": int(regl.get("graine") or 1) + k, "intensite": "aucun"} for k in range(n_sc)]
    if sampler.opponents or sampler.melange:
        scs += [dict(sampler.sample()) for _ in range(n_sc)]
    job.logline(f"Collecte des démonstrations : {len(progs)} programme(s) × {len(scs)} scénario(s)…")
    demos = collect_demos(pool, progs, scs)
    if demos:
        sc = [d.score for d in demos]
        job.logline(f"{len(demos)} démonstrations, score {np.mean(sc):.1f} en moyenne (min {min(sc):.0f}, max {max(sc):.0f}).")
    return demos


def evaluate_and_export(job: Job, pool: JsEnvPool, model, cfg: dict, sampler: ScenarioSampler, base: Path, info: dict):
    from trainer.evaluation import MATCHS_SELECTION, evaluate, resume
    from trainer.export_onnx import export_all
    from trainer.models import save_checkpoint
    regl = cfg.get("reglages") or {}
    n_eval = int(regl.get("eval_matchs") if regl.get("eval_matchs") is not None else MATCHS_SELECTION)
    ev = None
    if n_eval > 0 and sampler.melange and SELF in sampler.melange and SELF not in (getattr(pool, "opponents", None) or {}):
        # self-play évalué contre le modèle lui-même
        from trainer.export_onnx import web_json
        reg = dict(sampler.registry())
        reg[SELF] = {"brain": web_json(model, info)}
        pool.set_opponents(reg)
    if n_eval > 0:
        job.logline(f"Évaluation dans le moteur JS sur {n_eval} matchs…")
        ev = evaluate(model, pool, sampler.fixed(n_eval), torch_device(), log=job.logline)
        ev["protocole"] = {"matchs": n_eval, **sampler.describe(), "glouton": True}
        job.logline("Évaluation : " + resume(ev))
    info = dict(info, evaluation=ev)
    save_checkpoint(Path(str(base) + ".pt"), model, info)
    exp = export_all(model, base, info)
    v = exp.get("verification") or {}
    if exp.get("onnx_erreur"):
        job.logline(f"Export ONNX ignoré ({exp['onnx_erreur']}) : poids web et .pt enregistrés ; installer onnx et onnxscript pour le Pi 5.")
    else:
        job.logline(f"Export ONNX : {exp['onnx']} (vérification ONNX Runtime : écart {v.get('ecart_max', float('nan')):.1e}).")
    return ev, exp


def pool_info(pool: JsEnvPool, sampler: Optional[ScenarioSampler] = None) -> dict:
    out = {"env_config": pool.config, "obs_version": pool.obs_version, "catalogue_version": pool.catalogue_version,
           "catalogue": pool.catalogue, "groupes": pool.groups, "moteur": pool.moteur, "bareme": pool.bareme,
           "physique": physique_info(pool)}
    if sampler is not None:
        out["adversaires"] = sampler.describe()
    return out


def physique_info(pool: JsEnvPool) -> dict:
    """Traçabilité : caractéristiques de notre robot (nominales de la spec, statut) et réglages du tirage de l'entraînement."""
    try:
        car = pool.physique()
    except Exception:  # noqa: BLE001 (ancien worker)
        car = []
    return {"caracteristiques": car, "reglages": pool.config.get("physique")}


def recurrent_weights_doc(model, base: Path, ev, info: dict) -> dict:
    from trainer.export_onnx import web_json
    return {
        "format": "camelot-poids", "version": 2, "architecture": "recurrent",
        "modele": web_json(model, info),
        "fichiers": {"pt": str(base) + ".pt", "onnx": str(base) + ".onnx", "meta": str(base) + ".meta.json",
                     "web": str(base) + ".json"},
        "evaluation": ev,
    }


def run_imitation(job: Job, pool: JsEnvPool, cfg: dict, strats: List[dict], sampler: ScenarioSampler, out: Path):
    from trainer.imitation import imitation_train
    if not HAS_TORCH:
        raise RuntimeError("PyTorch est requis pour l'imitation du réseau récurrent.")
    regl = cfg.get("reglages") or {}
    epochs = int(regl.get("epoques") or 40)
    t_max = float(regl.get("duree_max") or 300)
    demos = demos_for(job, pool, cfg, strats, sampler)
    if not demos:
        raise RuntimeError("Aucune démonstration exploitable (aucune stratégie enregistrée et pas d'exemple).")
    model = model_of(cfg, pool).to(torch_device())
    t0 = time.time()
    history = []

    def progress(ep, st):
        history.append({"g": ep, "best": None, "mean": st["perte_ce"], "worst": None, "loss": st["perte_ce"]})
        elapsed = time.time() - t0
        job.data["progress"] = {
            "methode": "imitation", "generation": ep, "generations": epochs, "loss": st["perte_ce"],
            "precision": st["precision"], "cibles_invalides": st["cibles_invalides"], "history": history[-200:],
            "eta_s": round((elapsed / ep) * (epochs - ep)), "elapsed_s": round(elapsed),
            "matches": len(demos), **device_info(),
        }
        job.data["status"] = "running"
        job.save()
        return job.wait_if_paused() or elapsed > t_max

    st = imitation_train(model, demos, epochs=epochs, lr=float(regl.get("imitation_lr") or 1e-3),
                         batch_demos=int(regl.get("lot") or 16), device=torch_device(),
                         log=job.logline, progress=progress)
    base = model_base(out)
    info = pool_info(pool, sampler)
    info.update({"obs_rms": st["obs_rms"].state_dict(), "ret_rms": st["ret_rms"].state_dict(), "gamma": 1.0,
                 "imitation": {k: v for k, v in st.items() if k not in ("historique", "obs_rms", "ret_rms")}})
    ev, _ = evaluate_and_export(job, pool, model, cfg, sampler, base, info)
    best = ev["score"]["moyenne"] if ev else None
    return recurrent_weights_doc(model, base, ev, info), best, history


def run_ppo(job: Job, pool: JsEnvPool, cfg: dict, strats: List[dict], sampler: ScenarioSampler, out: Path):
    from trainer.imitation import imitation_train
    from trainer.models import load_checkpoint
    from trainer.ppo_trainer import PPOConfig, PPOTrainer
    if not HAS_TORCH:
        raise RuntimeError("PyTorch est requis pour le PPO.")
    regl = cfg.get("reglages") or {}
    rollout = int(regl.get("ppo_rollout_len") or 32)
    total = int(regl.get("ppo_steps") or 100_000)
    pc = PPOConfig(
        processus=pool.n_procs, envs_par_processus=pool.envs_per_proc, rollout=rollout,
        mises_a_jour=max(1, math.ceil(total / (rollout * pool.n_envs))), transitions_max=total,
        duree_max_s=float(regl.get("duree_max") or 600), lr=float(regl.get("ppo_lr") or 3e-4),
        # les pénalités de cerveau.recompense sont transmises à l'environnement (contrat §4, cfg.recompense) ;
        # ppo_penalite_erreur est une pénalité supplémentaire appliquée par l'entraîneur (0 par défaut)
        penalite_erreur=float(regl.get("ppo_penalite_erreur") or 0), hidden=int(regl.get("hidden") or 128),
        intensites=list(sampler.intensites), graine=int(regl.get("graine") or 1),
        eval_matchs=int(regl.get("eval_matchs") if regl.get("eval_matchs") is not None else PPOConfig.eval_matchs),
    )
    device = torch_device()
    base = model_base(out)
    model, ck = None, None
    if cfg.get("reprendre_pt") and Path(cfg["reprendre_pt"]).exists():
        model, ck = load_checkpoint(cfg["reprendre_pt"], device)
        if ck.get("catalogue_version") != pool.catalogue_version or ck.get("obs_version") != pool.obs_version:
            job.logline("Point de sauvegarde incompatible avec l'environnement actuel : départ de zéro.")
            model, ck = None, None
    tr = PPOTrainer(pc, pool, sampler, device, model or model_of(cfg, pool), log=job.logline)
    tr.info_extra = {"physique": physique_info(pool), "adversaires": sampler.describe()}
    if ck:
        tr.load_state(ck, optimizer=False)
        tr.update = 0
        job.logline("Reprise des poids du modèle précédent.")
    elif regl.get("pretrain_imitation", True):
        job.logline("Pré-entraînement par imitation…")
        demos = demos_for(job, pool, cfg, strats, sampler)
        if demos:
            imitation_train(tr.model, demos, epochs=int(regl.get("epoques") or 40),
                            lr=float(regl.get("imitation_lr") or 1e-3), device=device,
                            obs_rms=tr.obs_rms, ret_rms=tr.ret_rms, log=job.logline)
    t0 = time.time()
    history = []
    best_mean = [None]

    # self-play (mélange « self ») : notre réseau courant, rafraîchi toutes les self_play_tous_les mises à jour ; au départ,
    # le champion précédent donné par cfg.adversaire.self_modele (JSON web) s'il existe, sinon le réseau de départ
    self_k = int(regl.get("self_play_tous_les") or 5)
    def push_self(src=None):
        from trainer.export_onnx import web_json
        brain = src or web_json(tr.model, tr.state())
        reg = dict(sampler.registry())
        reg[SELF] = {"brain": brain}
        pool.set_opponents(reg)
    if sampler.melange and SELF in sampler.melange:
        prev = (cfg.get("adversaire") or {}).get("self_modele")
        src = None
        if prev and Path(prev).exists():
            try:
                src = json.loads(Path(prev).read_text(encoding="utf-8"))
                src = src.get("modele") or src
                job.logline(f"Self-play : champion précédent {prev}.")
            except (OSError, ValueError):
                src = None
        push_self(src)

    def on_update(st):
        if sampler.melange and SELF in sampler.melange and self_k > 0 and st["mise_a_jour"] % self_k == 0:
            push_self()
        elapsed = time.time() - t0
        if st["score_moyen"] is not None:
            best_mean[0] = st["score_moyen"] if best_mean[0] is None else max(best_mean[0], st["score_moyen"])
        history.append({"g": st["mise_a_jour"], "best": None if best_mean[0] is None else round(best_mean[0], 1),
                        "mean": None if st["score_moyen"] is None else round(st["score_moyen"], 1), "worst": None,
                        "loss": round(st["perte_politique"], 4), "aux_loss": None,
                        "value_loss": round(st["perte_valeur"], 4), "entropy": round(st["entropie"], 4)})
        frac = tr.global_step / max(1, pc.transitions_max)
        job.data["progress"] = {
            "methode": "ppo", "generation": st["mise_a_jour"], "generations": pc.mises_a_jour,
            "step": tr.global_step, "steps": pc.transitions_max, "loss": round(st["perte_politique"], 4),
            "history": history[-200:], "eta_s": (round(min(elapsed / max(frac, 1e-9) * (1 - frac), max(0.0, pc.duree_max_s - elapsed)) if pc.duree_max_s else elapsed / max(frac, 1e-9) * (1 - frac)) if frac > 0 else None),
            "elapsed_s": round(elapsed), "matches": len(tr.episodes),
            "matches_per_s": round(len(tr.episodes) / max(elapsed, 1e-9), 3),
            "decisions_per_s": round(st["decisions_par_s"], 1), "processus": pool.n_procs, "envs": pool.n_envs,
            **device_info(),
        }
        job.data["status"] = "running"
        job.save()
        return job.wait_if_paused()

    # Message de progression pendant la collecte d'un rollout (sur 1 cœur, des dizaines de minutes sans mise à jour).
    # Seul le message est publié ici ; la limite de durée est vérifiée par PPOTrainer pendant la collecte.
    last_msg = [0.0]

    def on_collect(done, total, dt):
        if time.time() - last_msg[0] < MESSAGE_PERIODE_S and done < total:
            return
        last_msg[0] = time.time()
        job.data.setdefault("progress", {})["message"] = (
            f"Collecte du rollout {tr.update + 1} : {done}/{total} décisions · {done / max(dt, 1e-9):.1f} déc/s")
        job.save()

    job.logline(f"Collecte du rollout 1 : 0/{pc.rollout * pool.n_envs} décisions")
    tr.on_collect = on_collect
    res = tr.run(base, sampler, on_update)
    ev = tr.best_eval
    info = tr.state()
    info["evaluation"] = ev
    # le champion (meilleure évaluation) est dans <base>.pt ; on recharge ses poids pour le document de poids
    champion = Path(str(base) + ".pt")
    model_out = tr.model
    if champion.exists():
        model_out, info = load_checkpoint(champion)
    best = ev["score"]["moyenne"] if ev else None
    job.logline(f"PPO terminé : {res['mises_a_jour']} mises à jour, {res['transitions']} transitions.")
    return recurrent_weights_doc(model_out, base, ev, info), best, history


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True, help="fichier JSON de la tâche")
    ap.add_argument("--strategies", help="dossier des stratégies (démonstrations / adversaires)")
    ap.add_argument("--weights-out", help="où écrire les poids du meilleur modèle")
    args = ap.parse_args()
    # l'API arrête une tâche par SIGTERM : on sort proprement (fermeture des processus Node)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    job = Job(Path(args.job))
    pool = None
    try:
        cfg = job.data.get("config") or {}
        job.data["status"] = "running"
        job.data["progress"] = {"message": "Démarrage…", **device_info()}
        job.save()
        n_procs = procs_of(cfg)
        methode = cfg.get("methode") or "evolution"
        regl = cfg.get("reglages") or {}
        if methode == "ppo":
            per = max(1, round(int(regl.get("ppo_batch_size") or 16) / n_procs))
        else:
            per = 1
        job.logline(f"Entraîneur démarré ({device_info()['name']}) : moteur JS, {n_procs} processus × {per} environnement(s).")
        pool = JsEnvPool(n_procs, per, env_config_of(cfg))
        job.logline(f"Environnement : {pool.n_in} entrées, {pool.n_out} actions, moteur {pool.moteur}, barème {pool.bareme}.")
        folder = Path(args.strategies) if args.strategies else None
        strats = load_strategies(folder) if folder else []
        opponents = qualified_opponents(pool, strats)
        sampler = sampler_of(cfg, opponents, pool, job.logline)
        if sampler.melange:
            job.logline("Mélange d'adversaires : " + ", ".join(f"{k} {v * 100:.0f} %" for k, v in sampler.melange.items()))
        if sampler.opponents:
            pool.set_opponents(sampler.registry())
        out = Path(args.weights_out or job.data.get("weights") or job.path.with_name(job.path.stem + "-poids.json"))
        if methode == "imitation":
            doc, best_sc, history = run_imitation(job, pool, cfg, strats, sampler, out)
            atomic_write(out, doc)
        elif methode == "ppo":
            doc, best_sc, history = run_ppo(job, pool, cfg, strats, sampler, out)
            atomic_write(out, doc)
        else:
            best_w, best_sc, history = run_evolution(job, pool, cfg, sampler)
            atomic_write(out, {"format": "camelot-poids", "version": 1, "layers": weights_to_json(best_w),
                               "obs_version": pool.obs_version, "catalogue_version": pool.catalogue_version})
        job.data["weights"] = str(out)
        job.data["best_score"] = best_sc
        if job.data.get("status") != "stopped":
            job.data["status"] = "done"
        job.data.setdefault("progress", {})["message"] = "Terminé."
        job.save()
        job.logline("Terminé. Poids enregistrés.")
    except Exception as e:
        import traceback
        print(traceback.format_exc(), file=sys.stderr)
        job.data["status"] = "error"
        job.data["error"] = str(e)
        job.save()
        job.logline(f"Erreur fatale : {e}")
        raise
    finally:
        if pool is not None:
            pool.close()


if __name__ == "__main__":
    main()
