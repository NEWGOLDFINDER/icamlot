"""Caractéristiques physiques de notre robot côté embarqué (observation « physique », docs/CONTRATS.md §14) :
spec par défaut, ou fichier de calibration, transmises au modèle interne puis à la croyance (belief.params)."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from embarque.croyance import CLES_PHYSIQUES, ConstructeurCroyance, params_calibration
from embarque.pont import PontNode

ROOT = Path(__file__).resolve().parent.parent


def _js(expr: str):
    code = ("var c=require(process.argv[1]+'/engine/load.js').loadIcamlot(process.argv[1]);"
            f"process.stdout.write(JSON.stringify({expr}));")
    return json.loads(subprocess.run(["node", "-e", code, str(ROOT)], check=True, capture_output=True, text=True).stdout)


def test_cles_identiques_au_moteur():
    assert list(CLES_PHYSIQUES) == _js("c.ADVERSAIRES.clesPhysiques()")


def test_sans_calibration_valeurs_de_la_spec(tmp_path):
    defs = _js("c.ENGINE.DEF")
    with PontNode() as pont:
        pont.hello(vision=False)
        cons = ConstructeurCroyance(pont)
        b = cons.demarrer()
        for k in CLES_PHYSIQUES:
            assert b["params"][k] == defs[k], k
        obs = pont.observe(b)
        assert len(obs) == _js("c.ENV.nInputs()")


def test_calibration_dans_la_croyance_et_l_observation(tmp_path):
    f = tmp_path / "calibration.json"
    f.write_text(json.dumps({"v": 0.45, "trot": 1.2, "tMonteeGraal": 3.2, "inconnue": 3}), encoding="utf-8")
    p = params_calibration(str(f))
    assert p == {"v": 0.45, "trot": 1.2, "tMonteeGraal": 3.2, "tDescenteFourche": 3.2}
    defs = _js("c.ENGINE.DEF")
    with PontNode() as pont:
        pont.hello(vision=False)
        b = ConstructeurCroyance(pont, params_moteur=p).demarrer()
        assert b["params"]["v"] == 0.45 and b["params"]["trot"] == 1.2
        # groupe « physique » = dernières entrées de l'observation (ordre des groupes par défaut) : v / v_spec - 1
        n = len(CLES_PHYSIQUES) - 1  # tDescenteFourche n'est pas observée (liée à la montée du Graal)
        obs = pont.observe(b)
        phys = obs[-n:]
        assert abs(phys[0] - (0.45 / defs["v"] - 1)) < 1e-6
