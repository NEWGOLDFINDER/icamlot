"""Génère tests/web_runtime_ref.json : vecteur de référence de web_forward (Python) pour tests/test_web_runtime.js.
Usage : python tests/gen_web_runtime_ref.py   (depuis la racine du dépôt ; le résultat est commité)."""
import json
import sys
from pathlib import Path

import numpy as np

RACINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RACINE))
from trainer.export_onnx import web_forward  # noqa: E402

MODELE = RACINE / ".data" / "modeles" / "fumee.json"
SORTIE = RACINE / "tests" / "web_runtime_ref.json"


def main():
    w = json.loads(MODELE.read_text())
    rng = np.random.default_rng(20271028)
    mean, std = np.asarray(w["normalisation"]["mean"]), np.asarray(w["normalisation"]["std"])
    n_in, n_out, H = w["n_in"], w["n_out"], w["hidden"]
    hidden = np.zeros((1, H))
    pas = []
    for k in range(6):
        # observations tirées autour de la normalisation, dont quelques valeurs extrêmes pour exercer le clip
        obs = mean + std * rng.normal(size=n_in) * (1.0 if k < 4 else 9.0)
        mask = (rng.random(n_out) < 0.5).astype(int)
        mask[rng.integers(n_out)] = 1
        logits, hidden = web_forward(w, obs[None, :], hidden)
        lm = np.where(mask > 0, logits[0], -np.inf)
        pas.append({"obs": obs.tolist(), "mask": mask.tolist(), "logits": logits[0].tolist(),
                    "hidden": hidden[0].tolist(), "argmax": int(np.argmax(logits[0])), "argmax_masque": int(np.argmax(lm))})
    SORTIE.write_text(json.dumps({"modele": "fumee.json", "pas": pas}))
    print("écrit", SORTIE, len(pas), "pas")


if __name__ == "__main__":
    main()
