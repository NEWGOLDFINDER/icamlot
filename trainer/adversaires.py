#!/usr/bin/env python3
"""(Ré)entraîne UNE FOIS un robot adverse « réseau » et enregistre son modèle figé (docs/CONTRATS.md §14).

    python -m trainer.adversaires --robot champion        [--duree 1800] [--transitions 200000] [--processus 4]
    python -m trainer.adversaires --robot intermediaire   [--duree 300]  [--transitions 15000]

Même pipeline que notre robot (catalogue, observation, trainer/) :
- caractéristiques physiques tirées à chaque match dans la plage du profil (ADVERSAIRES.reglagesPhysiques) ;
- imitation d'un programme de démonstration (ADVERSAIRES.programmeDemo : la référence pour le champion, 3 murs + Graal + tir
  pour l'intermédiaire ; attentes courtes avant le tir ajustées à la vitesse tirée), puis PPO ;
- adversaires pendant son entraînement : 50 % seul sur la table, 50 % programme de référence en miroir (hypothèse) ;
- sélection sur l'évaluation dans le moteur JS.
Sortie : .data/adversaires/<modele>.json (JSON web « icamlot-modele-recurrent », chargé par engine/env_worker.js et le
plateau) et .data/adversaires/<modele>.entrainement.json (réglages, durée mesurée, évaluation). L'API lance la même commande
(POST /api/adversaires/<robot>/entrainer).
Budgets par défaut (hypothèses) : champion = entraînement complet (imitation 60 époques + PPO jusqu'à --transitions ou --duree),
intermédiaire = volontairement court (imitation 20 époques + PPO bref).
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from trainer.js_env_pool import JsEnvPool, default_procs  # noqa: E402

DOSSIER = ROOT / ".data" / "adversaires"
# Budgets par défaut (hypothèses, réglables) : (durée max s, transitions PPO, époques d'imitation, matchs d'évaluation)
BUDGETS = {
    "champion": {"duree": 1800, "transitions": 200_000, "epoques": 60, "eval": 30},
    "intermediaire": {"duree": 300, "transitions": 15_000, "epoques": 20, "eval": 30},
}
MELANGE_ENTRAINEMENT = {"aucun": 0.5, "reference": 0.5}


def config_robot(robot: str, n_procs: int, duree: float, transitions: int, epoques: int, eval_matchs: int, graine: int) -> dict:
    with JsEnvPool(1, 1, {"skipContacts": True}) as pool:
        info = pool.procs[0].call({"cmd": "adversaire_cfg", "robot": robot}, 60)
    if info.get("error"):
        raise SystemExit(info["error"])
    return {
        "methode": "ppo",
        "physique": info["physique"],
        "demonstrations": [{"nom": "demonstration " + robot, "program": info["demonstration"]}],
        "adversaire": {"melange": MELANGE_ENTRAINEMENT},
        "reglages": {
            "mode": "rapide", "processus": n_procs, "graine": graine, "duree_max": duree, "ppo_steps": transitions,
            "pretrain_imitation": True, "imitation_exemple": False, "epoques": epoques, "imitation_scenarios": 8,
            "eval_matchs": eval_matchs, "ppo_batch_size": 2 * n_procs, "hidden": 128,
        },
        "_robot": robot, "_profil": info["profil"],
    }


def entrainer(robot: str, n_procs: int = 0, duree: float = None, transitions: int = None, epoques: int = None,
              eval_matchs: int = None, graine: int = 1, dossier: Path = DOSSIER) -> dict:
    from trainer import trainer as T
    b = BUDGETS[robot]
    n_procs = n_procs or default_procs()
    cfg = config_robot(robot, n_procs, duree if duree is not None else b["duree"], transitions or b["transitions"],
                       epoques or b["epoques"], eval_matchs if eval_matchs is not None else b["eval"], graine)
    modele = cfg["_profil"]["modele"]
    work = dossier / "entrainement"
    work.mkdir(parents=True, exist_ok=True)
    job_path = work / f"{modele}.job.json"
    T.atomic_write(job_path, {"config": cfg, "status": "running", "log": str(work / f"{modele}.log")})
    job = T.Job(job_path)
    t0 = time.time()
    per = max(1, round(int(cfg["reglages"]["ppo_batch_size"]) / n_procs))
    job.logline(f"Entraînement de l'adversaire {robot} : {n_procs} processus × {per} environnement(s).")
    with JsEnvPool(n_procs, per, T.env_config_of(cfg)) as pool:
        sampler = T.sampler_of(cfg, [], pool, job.logline)
        out = work / f"{modele}-poids.json"
        doc, best, _ = T.run_ppo(job, pool, cfg, [], sampler, out)
    duree_s = time.time() - t0
    web = Path(doc["fichiers"]["web"])
    dossier.mkdir(parents=True, exist_ok=True)
    dest = dossier / f"{modele}.json"
    shutil.copyfile(web, dest)
    bilan = {"robot": robot, "modele": str(dest), "duree_s": round(duree_s, 1), "score_selection": best,
             "evaluation": doc.get("evaluation"), "config": {k: v for k, v in cfg.items() if not k.startswith("_")},
             "materiel": T.device_info(), "date": time.strftime("%Y-%m-%d %H:%M:%S")}
    T.atomic_write(dossier / f"{modele}.entrainement.json", bilan)
    job.logline(f"Adversaire {robot} figé : {dest} ({duree_s:.0f} s, score de sélection {best}).")
    return bilan


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--robot", required=True, choices=sorted(BUDGETS))
    ap.add_argument("--processus", type=int, default=0)
    ap.add_argument("--duree", type=float, help="durée maximale du PPO (s)")
    ap.add_argument("--transitions", type=int, help="transitions PPO maximales")
    ap.add_argument("--epoques", type=int, help="époques d'imitation")
    ap.add_argument("--eval", type=int, help="matchs de l'évaluation de sélection")
    ap.add_argument("--graine", type=int, default=1)
    ap.add_argument("--dossier", default=str(DOSSIER))
    a = ap.parse_args(argv)
    b = entrainer(a.robot, a.processus, a.duree, a.transitions, a.epoques, a.eval, a.graine, Path(a.dossier))
    ev = b.get("evaluation") or {}
    print(json.dumps({"robot": b["robot"], "modele": b["modele"], "duree_s": b["duree_s"], "score": (ev.get("score") or {})}, ensure_ascii=False))


if __name__ == "__main__":
    main()
