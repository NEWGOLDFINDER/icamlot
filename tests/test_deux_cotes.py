"""Deux côtés (docs/CONTRATS.md §17) : équipe par scénario, jeu réel en bleu, rapport jaune / bleu, démonstrations bleues."""
from collections import Counter

import numpy as np
import pytest

from trainer.evaluation import rapport
from trainer.imitation import Demo, filtrer_demos_bleues, scenarios_deux_couleurs
from trainer.js_env_pool import JsEnvPool
from trainer.scenarios import (BLEU, JAUNE, ScenarioSampler, cle_scenario, critere_selection, equipe_de_graine, equipe_equilibree)


def test_equipe_tiree_par_la_graine_et_proportion():
    assert [equipe_de_graine(s, 0.5) for s in range(50)] == [equipe_de_graine(s, 0.5) for s in range(50)]
    assert all(equipe_de_graine(s, 0.0) == JAUNE for s in range(200))
    assert all(equipe_de_graine(s, 1.0) == BLEU for s in range(200))
    s = ScenarioSampler([], ["realiste"], 3, melange={"batisseur": 1}, part_bleu=0.3)
    c = Counter(sc["equipe"] for sc in (s.sample() for _ in range(3000)))
    assert abs(c[BLEU] / 3000 - 0.3) < 0.04
    # défaut : 50 %
    d = ScenarioSampler([], ["aucun"], 5)
    c = Counter(sc["equipe"] for sc in (d.sample() for _ in range(3000)))
    assert abs(c[BLEU] / 3000 - 0.5) < 0.04


def test_evaluation_repartie_dans_les_deux_couleurs_pour_chaque_adversaire():
    s = ScenarioSampler([], ["realiste"], 1, melange={"batisseur": 0.5, "razzia": 0.5})
    c = Counter((cle_scenario(sc), sc["equipe"]) for sc in s.fixed(20))
    assert set(c.values()) == {5}
    assert [equipe_equilibree(k, 0.5) for k in range(4)] == [JAUNE, BLEU, JAUNE, BLEU]
    assert s.fixed(20) == s.fixed(20)
    assert all(sc["equipe"] == JAUNE for sc in ScenarioSampler([], ["aucun"], 1, part_bleu=0).fixed(10))


def test_rapport_jaune_bleu_et_critere_du_champion():
    res = [{"score": 100, "errors": 0, "equipe": JAUNE, "scenario": {"seed": 1, "equipe": JAUNE, "intensite": "aucun"}},
           {"score": 100, "errors": 0, "equipe": JAUNE, "scenario": {"seed": 2, "equipe": JAUNE, "intensite": "aucun"}},
           {"score": 40, "errors": 1, "equipe": BLEU, "scenario": {"seed": 3, "equipe": BLEU, "intensite": "aucun"}}]
    r = rapport(res, 1.0, 10)
    assert r["par_equipe"]["yellow"]["score"]["moyenne"] == 100 and r["par_equipe"]["blue"]["score"]["moyenne"] == 40
    assert r["score"]["moyenne"] == 80                       # moyenne des matchs
    assert critere_selection(r) == 70                        # moyenne des deux couleurs
    assert r["par_adversaire"]["sans adversaire · aucun"]["par_equipe"]["blue"]["matchs"] == 1
    assert critere_selection({"score": {"moyenne": 12.0}}) == 12.0   # ancien rapport


def _demo(equipe, invalides, n=6):
    return Demo(nom="d", obs=np.zeros((n, 2), np.float32), actions=np.zeros(n, np.int64), masks=np.ones((n, 3), bool),
                rewards=np.zeros(n, np.float32), score=0, score0=0, erreurs=0, equipe=equipe, invalides=invalides)


def test_demonstrations_bleues_sans_cible_invalide_seulement():
    bons = [_demo(JAUNE, 2), _demo(BLEU, 0), _demo(BLEU, 3), _demo(BLEU, 1)]
    kept, bilan = filtrer_demos_bleues(bons)
    assert len(kept) == 2 and bilan == {"jaune": 1, "bleu_total": 3, "bleu_retenues": 1, "bleu_exclues": 2, "bleu_tronquees": 0, "decisions_bleues": 6}
    assert [sc["equipe"] for sc in scenarios_deux_couleurs([{"seed": 1}], 0.5)] == [JAUNE, BLEU]
    assert [sc["equipe"] for sc in scenarios_deux_couleurs([{"seed": 1}], 0)] == [JAUNE]


@pytest.mark.lent
def test_un_scenario_bleu_joue_reellement_en_bleu():
    """Le moteur joue le côté demandé : équipe lue sur le robot du moteur (bilan), observation différente (bit d'équipe),
    et un adversaire à règles joue l'autre couleur."""
    with JsEnvPool(1, 2, {"skipContacts": True}) as pool:
        sc_j = {"seed": 7, "equipe": JAUNE, "intensite": "aucun"}
        sc_b = {"seed": 7, "equipe": BLEU, "intensite": "aucun"}
        obs, mask = pool.reset([sc_j, sc_b])
        assert not np.array_equal(obs[0], obs[1]), "observation identique : le bit d'équipe devrait différer"
        finals = {}
        for _ in range(400):
            acts = [int(np.flatnonzero(mask[i])[-1]) if i not in finals else None for i in range(2)]
            sr = pool.step(acts)
            obs, mask = sr.obs, sr.mask
            for i in (0, 1):
                if sr.done[i] and i not in finals:
                    finals[i] = sr.infos[i]["final"]
            if len(finals) == 2:
                break
        assert finals[0]["equipe"] == "yellow" and finals[1]["equipe"] == "blue"
        # contre Razzia : l'adversaire joue l'autre couleur, sans erreur de moteur adverse
        sc = {"seed": 3, "equipe": BLEU, "intensite": "realiste", "opponent": {"robot": "razzia"}}
        obs, mask = pool.reset([sc, dict(sc, equipe=JAUNE)])
        fin = {}
        for _ in range(400):
            sr = pool.step([int(np.flatnonzero(mask[i])[0]) if i not in fin else None for i in range(2)])
            obs, mask = sr.obs, sr.mask
            for i in (0, 1):
                if sr.done[i] and i not in fin:
                    fin[i] = sr.infos[i]["final"]
            if len(fin) == 2:
                break
        assert fin[0]["equipe"] == "blue" and fin[1]["equipe"] == "yellow"
        assert fin[0]["adversaire"]["score"] > 0 and fin[0]["adversaire"]["errors"] == 0
