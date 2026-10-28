"""Test de cohérence esp32_bridge / temps masqué du moteur (docs/CONTRATS.md §7.3) et de l'exécution des plans.

Pour chaque brique du programme de référence (ENGINE.PROGRAMME_REFERENCE) puis pour 200 décisions aléatoires valides du
catalogue (donc avec `tm`), esp32_bridge doit produire des commandes pour toute brique, et l'ordre et le parallélisme des
mouvements doivent être ceux du moteur. La vérité est relue dans les points clés bruts du moteur, pas dans le plan.
"""
from __future__ import annotations

import pytest

import embarque_fixtures as F
from embarque.pont import PontNode
from esp32_bridge import (BriqueNonPriseEnCharge, DualESP32Orchestrator, PARAMS, chevauchements, format_status, parse_pose,
                          parse_status, traduire)

NB_DECISIONS = 200


@pytest.fixture(scope="module")
def pont():
    with PontNode() as p:
        p.hello()
        yield p


def verifier_brique(plan: dict, frames: list, equipe: str = "yellow"):
    """Vérifie les commandes d'un plan contre les points clés bruts du moteur. Renvoie les commandes."""
    cmds = traduire(plan, equipe)                                # lève BriqueNonPriseEnCharge si non pris en charge
    verite = F.union_par_groupe(F.intervalles_verite(frames))
    # 1. chaque mouvement du moteur correspond à des commandes du même groupe, aux mêmes instants (début et fin)
    for g in F.GROUPES_MOUVEMENT:
        du_groupe = sorted((c.t0, c.t1) for c in cmds if c.groupe == g)
        fusion = []
        for t0, t1 in du_groupe:
            if fusion and abs(fusion[-1][1] - t0) <= F.EPS_T:
                fusion[-1] = (fusion[-1][0], t1)
            else:
                fusion.append((t0, t1))
        assert len(fusion) == len(verite[g]), f"{g} : {len(fusion)} mouvement(s) de commandes, {len(verite[g])} dans le moteur ({plan['brique']})"
        for (a0, a1), (b0, b1) in zip(fusion, verite[g]):
            assert abs(a0 - b0) <= F.EPS_T and abs(a1 - b1) <= F.EPS_T, f"{g} : commandes {(a0, a1)}, moteur {(b0, b1)} ({plan['brique']})"
    # 2. parallélisme : mêmes paires de groupes simultanés
    para = {p for p in chevauchements(cmds) if p[0] in F.GROUPES_MOUVEMENT and p[1] in F.GROUPES_MOUVEMENT}
    assert para == F.paires_paralleles(verite), f"parallélisme {para} != moteur {F.paires_paralleles(verite)} ({plan['brique']})"
    # 3. ordre : chaque commande attend toutes celles que le moteur avait terminées avant son début
    for c in cmds:
        assert all(cmds[d].t1 <= c.t0 + F.EPS_T for d in c.deps)
        for o in cmds:
            if o.id < c.id and o.t1 <= c.t0 + F.EPS_T:
                assert _atteint(cmds, c, o.id), f"{c.texte} devrait attendre {o.texte} ({plan['brique']})"
    # 4. ventouses : mêmes changements d'état, dans le même ordre, pour chaque face
    vac = F.changements_vide(frames)
    for face in ("A", "B"):
        attendu = vac[face]
        obtenu = [tuple(int(x) for x in c.texte.split()[2:5]) for c in sorted(cmds, key=lambda c: (c.t0, c.id)) if c.groupe == "VAC_" + face]
        assert obtenu == attendu, f"ventouses {face} : {obtenu} != {attendu} ({plan['brique']})"
    return cmds


def _atteint(cmds, c, cible):
    """cible est une dépendance (transitive) de c."""
    pile, vus = list(c.deps), set()
    while pile:
        d = pile.pop()
        if d == cible:
            return True
        if d not in vus:
            vus.add(d)
            pile += list(cmds[d].deps)
    return False


def test_programme_de_reference(pont):
    pont.track_start(vision=False)
    prog = pont.reference()
    assert len(prog) >= 10
    n_cmd = 0
    for b in prog:
        r = pont.track_exec(b, trace=True)
        assert not r["info"]["err"], (b, r["info"])
        n_cmd += len(verifier_brique(r["plan"], r["frames"]))
    assert n_cmd > 50


def test_200_decisions_aleatoires(pont):
    n, tm_total, paralleles_tm, bricks = 0, 0, 0, set()
    for etat in F.decisions_aleatoires(pont, NB_DECISIONS):
        n += 1
        plan, frames = etat["plan"], etat["frames"]
        bricks.add(plan["brique"].get("a"))
        cmds = verifier_brique(plan, frames)
        if plan["brique"].get("tm"):
            tm_total += 1
            if any(p for p in chevauchements(cmds) if "NAV" in p and any(g.startswith(("GRIP", "FORK", "CANON")) for g in p)):
                paralleles_tm += 1
    assert n == NB_DECISIONS
    assert tm_total > 20, "le tirage doit contenir des briques avec temps masqué"
    assert len(bricks) >= 6, f"familles de briques jouées trop peu variées : {bricks}"
    print(f"{n} décisions, {tm_total} briques tm, dont {paralleles_tm} avec pince en parallèle du trajet ; familles : {sorted(bricks)}")


def test_preparer_la_pince_est_reportee_au_prochain_trajet(pont):
    """« Préparer la pince » : aucune commande ESP32 à cet instant, la rotation part pendant le trajet suivant."""
    pont.track_start(vision=False)
    r1 = pont.track_exec({"a": "tourner", "f": "A", "r": 90, "tm": True}, trace=True)
    c1 = verifier_brique(r1["plan"], r1["frames"])
    assert [c.dev for c in c1] == ["HOST"] and c1[0].texte == "PENDING_ROT A 90"
    r2 = pont.track_exec({"a": "seDeplacer", "x": 900, "y": 1000}, trace=True)
    c2 = verifier_brique(r2["plan"], r2["frames"])
    rot = [c for c in c2 if c.groupe == "GRIP_A"]
    assert rot and rot[-1].texte.endswith(" 90.0"), c2
    assert ("GRIP_A", "NAV") in chevauchements(c2)


def test_brique_non_prise_en_charge():
    with pytest.raises(BriqueNonPriseEnCharge):
        traduire({"brique": {"a": "prendreGraal", "f": "A"}, "moves": [], "events": []})
    with pytest.raises(BriqueNonPriseEnCharge):
        traduire({"brique": {"a": "seDeplacer"}, "moves": [{"g": "ROUES", "pts": [{"t": 0, "v": [0]}, {"t": 1, "v": [1]}]}], "events": []})


def test_miroir_bleu_des_commandes_de_navigation(pont):
    pont.track_start(vision=False)
    r = pont.track_exec({"a": "seDeplacer", "x": 900, "y": 1000}, trace=True)
    jaune = [c.texte for c in traduire(r["plan"], "yellow") if c.dev == "NAV"]
    bleu = [c.texte for c in traduire(r["plan"], "blue") if c.dev == "NAV"]
    assert jaune == ["GOTO 900.0 1000.0 0.0"]
    assert bleu == [f"GOTO {3000 - 900:.1f} 1000.0 180.0"]
    # le miroir ne touche pas les commandes d'actionneurs
    assert [c.texte for c in traduire(r["plan"], "yellow") if c.dev == "ACT"] == [c.texte for c in traduire(r["plan"], "blue") if c.dev == "ACT"]


# ---- exécution -------------------------------------------------------------------------------------------------------
def test_execution_mock_respecte_les_durees_du_moteur(pont):
    pont.track_start(vision=False)
    orch = DualESP32Orchestrator(mock=True)
    orch.initialize()
    for b in pont.reference():
        r = pont.track_exec(b, trace=True)
        rap = orch.executer(r["plan"])
        assert rap.ok, rap.erreur
        cmds = rap.commandes
        for c in cmds:
            assert abs(rap.debuts[c.id] - c.t0) <= 1e-6 and abs(rap.fins[c.id] - c.t1) <= 1e-6
    # état simulé de l'ESP32 ACT : le robot a fini avec les pinces à la hauteur de repos
    st = orch.lire_actionneurs()
    assert set(st.grip) == {"A", "B"}


def test_un_actionneur_lent_retarde_les_commandes_suivantes(pont):
    """Le robot attend l'actionneur le plus lent : les commandes qui dépendent de la commande en retard partent après elle."""
    pont.track_start(vision=False)
    r1 = pont.track_exec({"a": "tourner", "f": "A", "r": 90, "tm": True})
    r2 = pont.track_exec({"a": "seDeplacer", "x": 900, "y": 1000})
    orch = DualESP32Orchestrator(mock=True)
    orch.initialize()
    cmds = traduire(r2["plan"])
    rot = next(c for c in cmds if c.groupe == "GRIP_A" and c.t0 < 1e-9)
    suiv = [c for c in cmds if rot.id in c.deps]
    assert suiv, "une commande doit attendre la première rotation de pince"
    orch.retards = {rot.id: 2.0}
    rap = orch.executer(r2["plan"])
    assert rap.ok
    for c in suiv:
        assert rap.debuts[c.id] >= rap.fins[rot.id] - 1e-9
    nav = next(c for c in cmds if c.groupe == "NAV")
    assert abs(rap.debuts[nav.id]) < 1e-9                    # le trajet, lui, part sans attendre la pince


def test_pas_de_tir_avant_la_phase_d_attaque():
    plan = {"brique": {"a": "tir"}, "moves": [], "events": [{"kind": "FIRE", "n": 10, "rate": 2, "t0": 0.0, "t1": 4.6, "noAvant": 85.0}]}
    orch = DualESP32Orchestrator(mock=True)
    orch.initialize()
    rap = orch.executer(plan, t_match0=80.0)
    assert abs(rap.debuts[0] - 5.0) < 1e-9 and abs(rap.fins[0] - 9.6) < 1e-9


def test_protocole_etat():
    from esp32_bridge import EtatActionneurs
    e = EtatActionneurs(grip={"A": (165.0, 0.0), "B": (180.0, 90.0)}, tenue={"A": (0, 0, 0), "B": (1, 1, 1)}, fourche=(35.3, 332.2), canon=0.0)
    assert parse_status(format_status(e)).tenue == e.tenue and parse_status(format_status(e)).grip == e.grip
    assert parse_pose("POSE 250.0 1000.0 -90.0") == (250.0, 1000.0, -90.0)
    with pytest.raises(ValueError):
        parse_status("ERR")
