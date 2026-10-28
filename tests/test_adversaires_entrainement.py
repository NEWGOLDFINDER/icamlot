"""Mélange d'adversaires d'entraînement, rapport par adversaire, réglages de l'API (docs/CONTRATS.md §14)."""
from __future__ import annotations

import importlib.util
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from trainer.evaluation import rapport  # noqa: E402
from trainer.js_env_pool import JsEnvPool  # noqa: E402
from trainer.scenarios import MELANGE_DEFAUT, ROBOTS, ScenarioSampler, cle_scenario  # noqa: E402


def test_melange_par_defaut_20_pourcents():
    assert set(MELANGE_DEFAUT) == set(ROBOTS) | {"self"}
    assert all(abs(v - 0.2) < 1e-12 for v in MELANGE_DEFAUT.values())


def test_fixed_respecte_les_proportions_et_est_deterministe():
    s = ScenarioSampler([], ["realiste"], 1, melange=MELANGE_DEFAUT)
    a, b = s.fixed(50), s.fixed(50)
    assert a == b
    c = Counter(cle_scenario(x) for x in a)
    assert c == {"robot:batisseur": 10, "robot:razzia": 10, "robot:champion": 10, "robot:intermediaire": 10, "self": 10}
    assert all(x["opponent"] == {"robot": x["opponent"]["robot"]} for x in a if "opponent" in x)


def test_sample_suit_le_melange():
    s = ScenarioSampler([], ["realiste"], 3, melange={"batisseur": 3, "aucun": 1})
    c = Counter(cle_scenario(s.sample()) for _ in range(4000))
    assert abs(c["robot:batisseur"] / 4000 - 0.75) < 0.03 and abs(c["sans adversaire"] / 4000 - 0.25) < 0.03
    assert s.describe()["melange"] == {"batisseur": 0.75, "aucun": 0.25}


def test_rapport_par_adversaire():
    res = [{"score": 80, "errors": 0, "adversaire": {"score": 60}, "scenario": {"seed": 1, "intensite": "realiste", "opponent": {"robot": "razzia"}}},
           {"score": 50, "errors": 1, "adversaire": {"score": 90}, "scenario": {"seed": 2, "intensite": "realiste", "opponent": {"robot": "razzia"}}},
           {"score": 100, "errors": 0, "scenario": {"seed": 3, "intensite": "aucun"}}]
    r = rapport(res, 1.0, 10)
    pa = r["par_adversaire"]["robot:razzia · realiste"]
    assert pa["matchs"] == 2 and pa["taux_victoire"] == 0.5 and pa["score_adversaire"]["moyenne"] == 75.0
    assert "sans adversaire · aucun" in r["par_adversaire"]


def test_robot_reseau_sans_modele_retire_du_melange(tmp_path, monkeypatch):
    from trainer import trainer as T
    monkeypatch.setenv("ICAMLOT_ADVERSAIRES", str(tmp_path))   # dossier vide : aucun modèle figé
    with JsEnvPool(1, 1, {"skipContacts": True}) as pool:
        robots = {r["id"]: r for r in pool.robots_adverses()}
        assert robots["batisseur"]["modele"] and not robots["champion"]["modele"]
        logs = []
        s = T.sampler_of({"adversaire": {"melange": MELANGE_DEFAUT}}, [], pool, logs.append)
        assert set(s.melange) == {"batisseur", "razzia", "self"}
        assert any("champion" in m for m in logs)
        # un robot à règles se joue dans le pool (scénario { opponent: { robot } })
        st = pool.reset([{"seed": 4, "intensite": "realiste", "opponent": {"robot": "razzia"}}])
        assert st[0].shape[1] == pool.n_in


def _server():
    spec = importlib.util.spec_from_file_location("icamlot_server", ROOT / "api" / "server.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_api_reglages_par_defaut_et_validation():
    srv = _server()
    doc, err = srv.validate_cerveau({"name": "essai", "methode": "ppo"}, "essai")
    assert err is None
    assert doc["adversaire"]["melange"] == srv.MELANGE_DEFAUT and doc["physique"]["actif"] is True
    doc2, _ = srv.validate_cerveau({"name": "essai", "methode": "ppo", "adversaire": {"melange": {}, "intensite": "realiste"},
                                    "physique": {"actif": False, "valeurs": {"v": 450, "inconnu": 3}, "plages": {"w": 10, "tMonteeGraal": [3, 4], "trot": 0, "vz": "x"}}}, "essai")
    assert doc2["adversaire"]["melange"] == {} and doc2["adversaire"]["intensite"] == "realiste"
    assert doc2["physique"] == {"actif": False, "valeurs": {"v": 450.0}, "plages": {"w": 10.0, "tMonteeGraal": [3.0, 4.0], "trot": 0}}
    info = srv.env_info()
    assert len(info["physique"]) == 11 and {r["id"] for r in info["robots"]} == set(ROBOTS)
