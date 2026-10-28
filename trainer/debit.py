"""Mesure du débit du pool JS (décisions/s, matchs/s) pour choisir le nombre de processus sur une machine.

Politique aléatoire uniforme sur les actions valides (ou un modèle .pt), auto-reset, durée fixe par configuration.

  python -m trainer.debit --processus 1 2 4 8 11 --envs-par-processus 4 --duree 60
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np
import torch

from trainer.js_env_pool import JsEnvPool


def mesure(n_procs: int, envs: int, duree: float, model=None, seed: int = 0, env_cfg=None) -> dict:
    rng = np.random.default_rng(seed)
    with JsEnvPool(n_procs, envs, env_cfg or {"skipContacts": True}) as pool:
        obs, mask = pool.reset([{"seed": seed + i} for i in range(pool.n_envs)])
        hidden = model.init_hidden(pool.n_envs) if model is not None else None
        t0 = time.time()
        d0, e0 = pool.stats["decisions"], pool.stats["episodes"]
        while time.time() - t0 < duree:
            if model is not None:
                with torch.no_grad():
                    lg, _, hidden = model(torch.as_tensor(obs), hidden, torch.as_tensor(mask))
                acts = torch.distributions.Categorical(logits=lg).sample().numpy().tolist()
            else:
                acts = [int(rng.choice(np.flatnonzero(m))) for m in mask]
            sr = pool.step(acts, [{"seed": int(rng.integers(1, 2**31 - 1))} for _ in acts])
            obs, mask = sr.obs, sr.mask
            if hidden is not None and sr.done.any():
                hidden[torch.as_tensor(sr.done)] = 0.0
        dt = time.time() - t0
        dec, ep = pool.stats["decisions"] - d0, pool.stats["episodes"] - e0
    return {"processus": n_procs, "envs_par_processus": envs, "duree_s": round(dt, 1), "decisions": dec,
            "matchs": ep, "decisions_par_s": dec / dt, "matchs_par_s": ep / dt,
            "decisions_par_s_par_processus": dec / dt / n_procs, "decisions_par_match": dec / ep if ep else None}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Débit du moteur JS en pool de processus.")
    ap.add_argument("--processus", type=int, nargs="+", default=[1, 2])
    ap.add_argument("--envs-par-processus", type=int, default=4)
    ap.add_argument("--duree", type=float, default=60.0)
    ap.add_argument("--modele", help="point de sauvegarde .pt (sinon politique aléatoire)")
    ap.add_argument("--sortie", help="écrit les mesures en JSON")
    a = ap.parse_args(argv)
    model = None
    if a.modele:
        from trainer.models import load_checkpoint
        model, _ = load_checkpoint(a.modele)
        model.eval()
    res = []
    for p in a.processus:
        r = mesure(p, a.envs_par_processus, a.duree, model)
        print(json.dumps(r, ensure_ascii=False), flush=True)
        res.append(r)
    info = {"cpu": os.cpu_count(), "mesures": res}
    if a.sortie:
        Path(a.sortie).write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
