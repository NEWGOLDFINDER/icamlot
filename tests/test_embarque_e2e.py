"""Bout en bout hors matériel : le runner (ONNX + pont Node, capteurs simulés par ENV.beliefFromSim) joue des matchs complets
et obtient le même score que `python -m trainer.evaluation` sur le même modèle et la même graine."""
from __future__ import annotations

import json

import pytest

import embarque_fixtures as F
from embarque.pont import PontNode
from pi5_runner import jouer_simulation

pytestmark = pytest.mark.lent

N_SCENARIOS = 2      # sans adversaire, puis contre le programme de référence en intensité « realiste » (tourniquet de ScenarioSampler.fixed)
GRAINE = 10_000      # première graine d'évaluation (trainer/evaluation.py)


@pytest.fixture(scope="module")
def strategie_reference(tmp_path_factory):
    with PontNode() as p:
        p.hello()
        prog = p.reference()
    f = tmp_path_factory.mktemp("strategies") / "reference.json"
    f.write_text(json.dumps({"name": "reference", "params": {}, "program": prog}), encoding="utf-8")
    return f


@pytest.mark.parametrize("nom", ["petit", "peu"])
def test_meme_score_que_trainer_evaluation(nom, tmp_path_factory, strategie_reference):
    from trainer.evaluation import build_sampler, evaluate
    from trainer.js_env_pool import JsEnvPool
    from trainer.models import load_checkpoint

    onnx, pt = F.modele_de_test(tmp_path_factory, nom)
    model, ck = load_checkpoint(str(pt))
    env_cfg = ck.get("env_config") or {"skipContacts": True}
    sampler = build_sampler([strategie_reference], intensites=["aucun", "realiste"], seed=1)
    registre = sampler.registry()
    scenarios = sampler.fixed(N_SCENARIOS, GRAINE)
    assert any("opponentRef" in s for s in scenarios) and any("opponentRef" not in s for s in scenarios)
    vus = []
    with JsEnvPool(1, 1, env_cfg, opponents=registre) as pool:
        for sc in scenarios:
            ref = evaluate(model, pool, [sc])
            run_sc = {k: v for k, v in sc.items() if k != "opponentRef"}
            if "opponentRef" in sc:
                run_sc["opponent"] = registre[sc["opponentRef"]]
            r = jouer_simulation(onnx, run_sc, env_cfg)
            assert r["score"] == ref["score"]["moyenne"], f"{nom} graine {sc['seed']} : runner {r['score']} != evaluation {ref['score']['moyenne']}"
            assert r["errors"] == ref["erreurs_moteur"][0]
            assert bool(r["truncated"]) == bool(ref["tronques"])
            if ref["duels"]:
                assert r["adversaire"]["score"] == ref["score_adversaire"]["moyenne"]
            vus.append((sc["seed"], r["score"], r["decisions"]))
    print(nom, vus)


def test_parite_observation_masque_et_brique_pendant_tout_le_match(tmp_path_factory):
    """verifier_parite=True : à chaque décision, l'observation et le masque calculés par le pont sont ceux de l'environnement,
    et la brique renvoyée par step() est celle que l'environnement exécute (AssertionError sinon)."""
    onnx, _ = F.modele_de_test(tmp_path_factory, "peu")
    r = jouer_simulation(onnx, {"seed": 11, "intensite": "aucun"}, esp32_mock=True, verifier_parite=True)
    assert r["decisions"] > 5 and r["rapports_esp32"] == r["decisions"]
