"""Pont Node (embarque/bridge.js) : mêmes fonctions que l'entraînement, aucune copie Python."""
from __future__ import annotations

import json
import random
import subprocess

import pytest

import embarque_fixtures as F
from embarque.pont import ErreurPont, PontNode


@pytest.fixture(scope="module")
def pont():
    with PontNode() as p:
        p.hello()
        yield p


def versions_du_moteur():
    js = ("var ctx=require('./engine/load.js').loadIcamlot(process.cwd());"
          "console.log(JSON.stringify({o:ctx.ENV.OBS_VERSION,c:ctx.ACTIONS.CATALOGUE_VERSION,n:ctx.ENV.create({}).nInputs,"
          "m:ctx.ENV.create({}).nOutputs,v:ctx.SPEC.robot.entrainement.vitesse_lineaire_mm_s.valeur}))")
    return json.loads(subprocess.run(["node", "-e", js], cwd=str(F.ROOT), capture_output=True, text=True, check=True).stdout)


def test_hello_donne_les_versions_et_dimensions_du_moteur(pont):
    v = versions_du_moteur()
    h = pont.hello_info
    assert (h["obsVersion"], h["catalogueVersion"], h["nInputs"], h["nOutputs"]) == (v["o"], v["c"], v["n"], v["m"])
    assert h["vitesses"]["lineaire_mm_s"] == v["v"] == 500
    assert len(h["catalogue"]) == h["nOutputs"] and h["match"] == 100


def test_observation_et_masque_identiques_a_ceux_de_l_environnement(pont):
    """observe(belief) et mask(belief) du pont = obs et mask que l'environnement a calculés pour la même croyance."""
    rng = random.Random(3)
    n = 0
    etat = pont.sim_reset({"seed": 5, "intensite": "aucun"}, {"skipContacts": True}, 200)
    while not etat["done"] and n < 40:
        obs, mask = pont.observe_mask(etat["belief"])
        assert obs == etat["obs"] and mask == etat["mask"]
        assert pont.observe(etat["belief"]) == obs and pont.mask(etat["belief"]) == mask
        cat = pont.hello_info["catalogue"]
        idx = rng.choice([i for i, m in enumerate(mask) if m and cat[i]["a"] not in ("finir", "trone", "tir", "preparer", "lacher")])
        brique = pont.step(idx, etat["belief"])["brique"]
        etat = pont.sim_step(idx)
        assert etat["brique"] == brique, "step(act, belief) doit renvoyer la brique que l'environnement exécute"
        n += 1
    assert n >= 12


def test_step_brique_et_miroir_bleu(pont):
    etat = pont.sim_reset({"seed": 1, "intensite": "aucun"}, {"skipContacts": True}, 200)
    b = etat["belief"]
    p1 = next(a for a in pont.hello_info["catalogue"] if a["a"] == "prendre" and a["f"] == "A" and a["p"] == "P1")
    r = pont.step(p1, b)
    assert r["brique"] == {"a": "prendre", "f": "A", "p": "P1", "tm": True}          # temps masqué demandé au moteur
    assert r["reelle"] == r["brique"]                                                # jaune : repère identique
    bleu = dict(b, team="blue")
    r2 = pont.step(p1, bleu)
    assert r2["brique"] == r["brique"] and r2["reelle"]["p"] == "P4"                  # bleu : ids en miroir pour le moteur
    prep = next(a for a in pont.hello_info["catalogue"] if a["a"] == "preparer" and a["f"] == "B" and a["r"] == 90)
    assert pont.step(prep, b)["brique"] == {"a": "tourner", "f": "B", "r": 90, "tm": True}   # « préparer la pince »


def test_erreurs_du_pont_n_arretent_pas_le_processus(pont):
    with pytest.raises(ErreurPont):
        pont.appeler("commande_inconnue")
    with pytest.raises(ErreurPont):
        pont.appeler("observe")                           # belief manquant
    with pytest.raises(ErreurPont):
        pont.step(10_000, {"team": "yellow"})              # hors catalogue
    assert pont.appeler("ping")["ok"]


def test_mirror_ids_involution(pont):
    ids = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "M1", "M7", "T1", "T6"]
    assert pont.mirror_ids(pont.mirror_ids(ids)) == ids
    assert pont.mirror_ids(["P1"]) == ["P4"]


def test_groupes_d_observation_restreints():
    with PontNode() as p:
        h = p.hello(entrees=["temps", "robot"])
        assert h["nInputs"] == 10
        etat = p.sim_reset({"seed": 1, "intensite": "aucun"}, {"skipContacts": True, "entrees": ["temps", "robot"]}, 20)
        assert len(p.observe(etat["belief"])) == 10 == len(etat["obs"])
