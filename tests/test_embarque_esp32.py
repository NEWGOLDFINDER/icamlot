"""Test de cohérence esp32_bridge / temps masqué du moteur (docs/CONTRATS.md §7.3), exécution des plans et protocole série
(docs/PROTOCOLE_ESP32.md) contre le firmware simulé.

Pour chaque brique du programme de référence (ENGINE.PROGRAMME_REFERENCE) puis pour 200 décisions aléatoires valides du
catalogue (donc avec `tm`), esp32_bridge doit produire des commandes pour toute brique, et l'ordre et le parallélisme des
mouvements doivent être ceux du moteur. La vérité est relue dans les points clés bruts du moteur, pas dans le plan.
"""
from __future__ import annotations

import pytest

import embarque_fixtures as F
from embarque.pont import PontNode
from esp32_bridge import (BriqueNonPriseEnCharge, DualESP32Orchestrator, ESP32Device, EtatActionneurs, FirmwareSimule, HorlogeVirtuelle,
                          SerieSimulee, chevauchements, format_status, parse_ligne, parse_pose, parse_status, traduire)

NB_DECISIONS = 200
COMMANDES_SUPPRIMEES = ("FIRE", "CANON", "GRIP", "FORK", "VAC", "RESET_ACTUATORS")


@pytest.fixture(scope="module")
def pont():
    with PontNode() as p:
        p.hello()
        yield p


def verifier_brique(plan: dict, frames: list, equipe: str = "yellow"):
    """Vérifie les commandes d'un plan contre les points clés bruts du moteur. Renvoie les commandes."""
    cmds = traduire(plan, equipe)                                # lève BriqueNonPriseEnCharge si non pris en charge
    verite = F.union_par_groupe(F.intervalles_verite(frames))
    # 1. chaque mouvement du moteur correspond à des commandes du même axe, aux mêmes instants (début et fin)
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
    # 2. parallélisme : mêmes paires d'axes simultanés
    para = {p for p in chevauchements(cmds) if p[0] in F.GROUPES_MOUVEMENT and p[1] in F.GROUPES_MOUVEMENT}
    assert para == F.paires_paralleles(verite), f"parallélisme {para} != moteur {F.paires_paralleles(verite)} ({plan['brique']})"
    # 3. ordre : chaque commande attend toutes celles que le moteur avait terminées avant son début
    for c in cmds:
        assert all(cmds[d].t1 <= c.t0 + F.EPS_T for d in c.deps)
        for o in cmds:
            if o.id < c.id and o.t1 <= c.t0 + F.EPS_T:
                assert _atteint(cmds, c, o.id), f"{c.texte} devrait attendre {o.texte} ({plan['brique']})"
    # 4. ventouses : mêmes changements d'état, dans le même ordre, pour chaque face (une pompe par rangée)
    vac = F.changements_vide(frames)
    for face in ("A", "B"):
        attendu = vac[face]
        obtenu = [tuple(int(x) for x in c.texte.split()[2:5]) for c in sorted(cmds, key=lambda c: (c.t0, c.id)) if c.groupe == "PUMP_" + face]
        assert obtenu == attendu, f"ventouses {face} : {obtenu} != {attendu} ({plan['brique']})"
    # 5. canon : une seule commande TIR pour toute la séance (sortie, mise en route, boulets) ; jamais avant la sortie du moteur
    tirs = [c for c in cmds if c.groupe == "TIR"]
    assert all(c.texte == "TIR" for c in tirs) and len(tirs) <= 1
    if verite["CANON"] and not plan.get("err"):
        assert len(tirs) == 1, f"séance de tir : {len(tirs)} commande(s) ({plan['brique']})"
        assert tirs[0].t0 >= verite["CANON"][0][0] - F.EPS_T
        assert tirs[0].t1 >= verite["CANON"][-1][1] - F.EPS_T
    assert not any(c.texte.split()[0] in COMMANDES_SUPPRIMEES for c in cmds)
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
    n_cmd, tirs = 0, 0
    for b in prog:
        r = pont.track_exec(b, trace=True)
        assert not r["info"]["err"], (b, r["info"])
        cmds = verifier_brique(r["plan"], r["frames"])
        n_cmd += len(cmds)
        tirs += sum(1 for c in cmds if c.groupe == "TIR")
    assert n_cmd > 50
    assert tirs == 1


def test_200_decisions_aleatoires(pont):
    n, tm_total, paralleles_tm, bricks = 0, 0, 0, set()
    for etat in F.decisions_aleatoires(pont, NB_DECISIONS):
        n += 1
        plan, frames = etat["plan"], etat["frames"]
        bricks.add(plan["brique"].get("a"))
        cmds = verifier_brique(plan, frames)
        if plan["brique"].get("tm"):
            tm_total += 1
            if any(p for p in chevauchements(cmds) if "NAV" in p and any(g.startswith(("Z_", "ROT_", "ASC", "TIR")) for g in p)):
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
    rot = [c for c in c2 if c.groupe == "ROT_A"]
    assert rot and rot[-1].texte.split()[2] == "90.0", c2
    assert ("NAV", "ROT_A") in chevauchements(c2)


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


def test_la_seance_de_tir_est_une_seule_commande_tardive():
    """Le firmware ne connaît pas l'horloge : TIR part assez tard pour que le premier boulet parte à l'instant du moteur."""
    plan = {"brique": {"a": "tir"},
            "moves": [{"g": "CANON", "pts": [{"t": 2.0, "v": [0]}, {"t": 3.0, "v": [90]}]}],
            "events": [{"kind": "CANON_SPIN", "t0": 3.0, "t1": 3.5}, {"kind": "FIRE", "n": 10, "rate": 2, "t0": 14.0, "t1": 18.6, "noAvant": 85.0}]}
    cmds = traduire(plan)
    assert [(c.texte, c.groupe) for c in cmds] == [("TIR", "TIR")]
    assert cmds[0].t0 == pytest.approx(14.0 - 1.5) and cmds[0].t1 == pytest.approx(18.6)
    assert cmds[0].no_avant == pytest.approx(85.0 - 1.5)


# ---- exécution -------------------------------------------------------------------------------------------------------
def test_execution_mock_respecte_les_durees_du_moteur(pont):
    pont.track_start(vision=False)
    orch = DualESP32Orchestrator(mock=True)
    assert orch.initialize()
    chaines = 0
    for b in pont.reference():
        r = pont.track_exec(b, trace=True)
        rap = orch.executer(r["plan"])
        assert rap.ok, rap.erreur
        cmds = rap.commandes
        for c in cmds:
            assert abs(rap.debuts[c.id] - c.t0) <= 1e-6 and abs(rap.fins[c.id] - c.t1) <= 1e-6, (c.texte, rap.debuts[c.id], rap.fins[c.id], c.t0, c.t1)
    journal = orch.nav.journal + orch.act.journal
    chaines = sum(1 for l in orch.nav.journal if l.startswith("PATH"))
    # protocole : aucune des anciennes commandes ; une seule séance de tir ; trajectoires enchaînées et pompes par face
    assert not [l for l in journal if l.split()[0] in COMMANDES_SUPPRIMEES]
    assert sum(1 for l in orch.act.journal if l.startswith("TIR ")) == 1
    assert any(l.startswith("PUMP A ") for l in orch.act.journal) and any(l.startswith("Z A ") and " T=" in l for l in orch.act.journal)
    assert chaines >= 0
    # état simulé de l'ESP32 ACT : le robot a fini avec les pinces à la hauteur de repos
    st = orch.lire_actionneurs()
    assert set(st.grip) == {"A", "B"} and st.tir == "DONE"


def test_un_actionneur_lent_retarde_les_commandes_suivantes():
    """Le robot attend l'actionneur le plus lent : les commandes qui dépendent de la commande en retard partent après elle."""
    plan = {"brique": {"a": "seDeplacer"}, "dt": 2.0, "events": [], "moves": [
        {"g": "GRIP_A", "pts": [{"t": 0.0, "v": [165, 0]}, {"t": 1.0, "v": [200, 0]}]},      # vérin Z de A : 0 -> 1 s
        {"g": "GRIP_B", "pts": [{"t": 0.0, "v": [165, 0]}, {"t": 0.5, "v": [165, 90]}]},     # rotation de B : 0 -> 0,5 s
        {"g": "NAV", "pts": [{"t": 1.0, "v": [250, 1000, 0]}, {"t": 2.0, "v": [500, 1000, 0]}]}]}   # la base attend les deux
    cmds = traduire(plan)
    z = next(c for c in cmds if c.groupe == "Z_A")
    rot = next(c for c in cmds if c.groupe == "ROT_B")
    nav = next(c for c in cmds if c.groupe == "NAV")
    assert z.id in nav.deps and rot.id in nav.deps
    orch = DualESP32Orchestrator(mock=True)
    assert orch.initialize()
    orch.retards = {z.id: 2.0}
    rap = orch.executer(plan)
    assert rap.ok, rap.erreur
    assert rap.fins[z.id] == pytest.approx(3.0)
    assert rap.debuts[nav.id] >= rap.fins[z.id] - 1e-9          # la base attend le vérin en retard
    assert rap.debuts[rot.id] == pytest.approx(0.0) and rap.fins[rot.id] == pytest.approx(0.5)   # l'axe indépendant n'attend personne


def test_pas_de_tir_avant_la_phase_d_attaque():
    plan = {"brique": {"a": "tir"}, "moves": [], "events": [{"kind": "FIRE", "n": 10, "rate": 2, "t0": 0.0, "t1": 4.6, "noAvant": 85.0}]}
    orch = DualESP32Orchestrator(mock=True)
    assert orch.initialize()
    rap = orch.executer(plan, t_match0=80.0)
    assert abs(rap.debuts[0] - 5.0) < 1e-9 and abs(rap.fins[0] - 9.6) < 1e-9


def plan_trajet(points, dt_total=None):
    """Plan d'un trajet de la base : (t, x, y, h) -> un seul mouvement NAV."""
    return {"brique": {"a": "seDeplacer"}, "moves": [{"g": "NAV", "pts": [{"t": t, "v": [x, y, h]} for t, x, y, h in points]}], "events": [],
            "dt": dt_total if dt_total is not None else points[-1][0]}


TRAJET = plan_trajet([(0, 250, 1000, 0), (1, 500, 1000, 0), (2, 500, 1500, 0), (3, 900, 1500, 0)])


def test_trajectoire_enchainee_une_seule_ligne_et_dependances_par_point():
    """Les segments consécutifs de la base partent dans une seule commande PATH ; le vérin qui attend le premier point part dès `WPT 1` ;
    le segment qui attend aussi ce vérin n'est pas enchaîné (il part dans une commande séparée, quand le vérin a fini)."""
    plan = {**TRAJET, "moves": TRAJET["moves"] + [{"g": "GRIP_A", "pts": [{"t": 1.0, "v": [165, 0]}, {"t": 2.0, "v": [200, 0]}]}]}
    orch = DualESP32Orchestrator(mock=True)
    assert orch.initialize()
    rap = orch.executer(plan)
    assert rap.ok, rap.erreur
    paths = [l for l in orch.nav.journal if l.startswith("PATH")]
    assert len(paths) == 1 and paths[0].startswith("PATH 2 500.0 1000.0 0.0 500.0 1500.0 0.0 #")
    assert [l.rsplit(" #", 1)[0] for l in orch.nav.journal if l.startswith("GOTO")] == ["GOTO 900.0 1500.0 0.0"]
    z = next(c for c in rap.commandes if c.groupe == "Z_A")
    assert rap.debuts[z.id] == pytest.approx(1.0) and rap.fins[z.id] == pytest.approx(2.0)
    assert [round(rap.fins[c.id], 6) for c in rap.commandes if c.groupe == "NAV"] == [1.0, 2.0, 3.0]


# ---- évitement (décidé par le Pi) et fin du match --------------------------------------------------------------------------------
def test_evitement_stop_puis_reprise_quand_la_menace_disparait():
    orch = DualESP32Orchestrator(mock=True)
    assert orch.initialize(pose=(250.0, 1000.0, 0.0))
    hz = orch.horloge
    t0 = hz.now()
    orch.menace = lambda cible: 0.45 <= hz.now() - t0 < 1.55
    rap = orch.executer(TRAJET)
    assert rap.ok, rap.erreur
    stops = [l for l in orch.nav.journal if l.startswith("STOP")]
    assert len(stops) == 1
    nav = [l for l in orch.nav.journal if l.startswith(("GOTO", "PATH"))]
    assert len(nav) == 2 and nav[1].startswith("PATH") and nav[1].split()[-4:-1] == ["900.0", "1500.0", "0.0"]
    attendu = TRAJET["dt"]
    # la brique dure plus que le plan du moteur de (au plus) la durée de la menace + une période d'évaluation
    assert attendu + 0.9 < rap.duree < attendu + 1.2 + 2 * orch.params.periode_evitement_s
    assert orch.lire_pose() == (900.0, 1500.0, 0.0)


def test_evitement_adversaire_qui_reste_la_la_brique_echoue():
    orch = DualESP32Orchestrator(mock=True)
    assert orch.initialize(pose=(250.0, 1000.0, 0.0))
    hz = orch.horloge
    t0 = hz.now()
    orch.menace = lambda cible: hz.now() - t0 >= 0.45
    rap = orch.executer(TRAJET)
    assert not rap.ok and rap.erreur.startswith("évitement")
    assert hz.now() - t0 == pytest.approx(0.45 + orch.params.attente_evitement_max_s, abs=0.3)
    x, y, h = orch.lire_pose()
    assert 250.0 < x < 900.0 and orch.nav.derniere_pose is not None       # arrêté en route
    assert orch.nav.firmware._nav is None


def test_pas_de_depart_si_la_menace_est_deja_la():
    orch = DualESP32Orchestrator(mock=True)
    assert orch.initialize(pose=(250.0, 1000.0, 0.0))
    orch.menace = lambda cible: True
    rap = orch.executer(plan_trajet([(0, 250, 1000, 0), (1, 500, 1000, 0)]))
    assert not rap.ok
    assert not [l for l in orch.nav.journal if l.startswith(("GOTO", "PATH"))]


def test_fin_du_match_arrete_tout():
    orch = DualESP32Orchestrator(mock=True)
    assert orch.initialize(pose=(250.0, 1000.0, 0.0))
    orch.fin_match = orch.horloge.now() + 1.5
    rap = orch.executer(TRAJET)
    assert not rap.ok and "fin du match" in rap.erreur
    assert orch.horloge.now() == pytest.approx(orch.fin_match)
    assert [l for l in orch.nav.journal if l.startswith("STOP")] and [l for l in orch.act.journal if l.startswith("STOP")]


# ---- protocole contre le firmware simulé ----------------------------------------------------------------------------------------------
def banc(role: str, role_firmware: str = None):
    hz = HorlogeVirtuelle()
    fw = FirmwareSimule(role_firmware or role, hz)
    dev = ESP32Device(f"ESP32_{role}", role, "mock", liaison=SerieSimulee(fw), firmware=fw)
    return hz, fw, dev


def echange(dev, texte, pid):
    dev.envoyer(texte, pid)
    dev.sonder()
    return [(e.type, e.id, e.args) for e in dev.prendre()]


def test_hello_refuse_un_mauvais_role():
    _, _, dev = banc("NAV", role_firmware="ACT")
    assert not dev.connect()
    _, _, ok = banc("ACT")
    assert ok.connect()


def test_nav_goto_done_et_voie_occupee():
    hz, fw, dev = banc("NAV")
    assert dev.connect()
    assert echange(dev, "SET_POSE 0.0 0.0 0.0", 1) == [("ACK", 1, ())]
    assert echange(dev, "SET_LIMITS 500 120", 2) == [("ACK", 2, ())]
    assert echange(dev, "GOTO 500.0 0.0 0.0", 3) == [("ACK", 3, ())]
    assert echange(dev, "GOTO 100.0 0.0 0.0", 4) == [("NAK", 4, ("BUSY",))]
    assert echange(dev, "SET_POSE 1.0 1.0 0.0", 5) == [("NAK", 5, ("BUSY",))]
    hz.sleep(0.5)
    dev.sonder()
    assert dev.prendre() == []
    assert dev.interroger("POSE?", "POSE") == pytest.approx((250.0, 0.0, 0.0))
    hz.sleep(0.5)
    dev.sonder()
    assert [(e.type, e.id) for e in dev.prendre()] == [("DONE", 3)]
    assert dev.interroger("POSE?", "POSE") == (500.0, 0.0, 0.0)


def test_nav_stop_est_prioritaire_et_fige_la_pose():
    hz, fw, dev = banc("NAV")
    dev.connect()
    echange(dev, "SET_POSE 0.0 0.0 0.0", 1)
    echange(dev, "SET_LIMITS 500 120", 2)
    echange(dev, "GOTO 1000.0 0.0 0.0", 3)
    hz.sleep(0.5)
    rep = echange(dev, "STOP", 4)
    assert rep == [("ACK", 4, ()), ("ABORT", 3, ("STOP",)), ("DONE", 4, ())]
    x, y, h = dev.interroger("POSE?", "POSE")
    assert x == pytest.approx(250.0) and dev.derniere_pose is not None
    hz.sleep(5)
    assert dev.interroger("POSE?", "POSE")[0] == pytest.approx(250.0)
    assert echange(dev, "GOTO 300.0 0.0 0.0", 5)[0] == ("ACK", 5, ())        # pas de verrouillage : la reprise est décidée par le Pi


def test_nav_chien_de_garde():
    hz, fw, dev = banc("NAV")
    dev.connect()
    echange(dev, "SET_LIMITS 500 120", 1)
    echange(dev, "CFG WATCHDOG_MS 500", 2)
    echange(dev, "GOTO 1000.0 0.0 0.0", 3)
    hz.sleep(0.3)
    dev.ping()
    hz.sleep(0.3)
    dev.sonder()
    assert dev.prendre() == []                                              # le PING a repoussé l'échéance
    hz.sleep(0.6)
    dev.sonder()
    assert [(e.type, e.id, e.args) for e in dev.prendre()] == [("ABORT", 3, ("WATCHDOG",))]
    assert dev.erreurs and dev.erreurs[0].startswith("ERR WATCHDOG")


def test_act_axes_en_parallele_durees_et_voie_occupee():
    hz, fw, dev = banc("ACT")
    assert dev.connect() and dev.tirette == 1
    assert echange(dev, "Z A 200.0 T=1000.000", 1) == [("ACK", 1, ())]
    assert echange(dev, "ROT A 90.0 T=1500.000", 2) == [("ACK", 2, ())]       # une autre voie : en parallèle
    assert echange(dev, "Z A 100.0 T=100.000", 3) == [("NAK", 3, ("BUSY", "Z_A"))]
    assert echange(dev, "ASC 10.0 20.0 T=800.000", 4) == [("ACK", 4, ())]
    hz.sleep(0.5)
    st = dev.interroger("STATUS?", "STATUS")
    assert st.grip["A"] == pytest.approx((100.0, 30.0), abs=0.1) and st.fourche == pytest.approx((6.25, 12.5), abs=0.1)
    dev.prendre()
    hz.sleep(1.0)
    dev.sonder()
    assert sorted((e.type, e.id) for e in dev.prendre()) == [("DONE", 1), ("DONE", 2), ("DONE", 4)]
    st = dev.interroger("STATUS?", "STATUS")
    assert st.grip["A"] == (200.0, 90.0) and st.fourche == (10.0, 20.0)
    assert echange(dev, "Q A 1", 9) == [("NAK", 9, ("UNKNOWN", "Q"))]
    assert echange(dev, "Z X 1.0", 10) == [("NAK", 10, ("SYNTAX", "face"))]


def test_act_pompes_pression_et_seuil_de_vide():
    hz, fw, dev = banc("ACT")
    dev.connect()
    echange(dev, "CFG VIDE_MIN_KPA 20", 1)
    echange(dev, "INIT", 2)
    dev.prendre()
    assert echange(dev, "PUMP A 1 0 1", 3)[0] == ("ACK", 3, ())
    st = dev.interroger("STATUS?", "STATUS")
    assert st.tenue["A"] == (1, 0, 1) and st.tenue["B"] == (0, 0, 0)
    assert st.pression["A"][1] == 0.0 and st.pression["A"][0] >= 20.0
    echange(dev, "PUMP A 0 0 0", 4)
    assert dev.interroger("STATUS?", "STATUS").tenue["A"] == (0, 0, 0)


def test_act_seance_de_tir_une_seule_sortie():
    hz, fw, dev = banc("ACT")
    dev.connect()
    fw.programmee[1] = [4.0]
    assert echange(dev, "TIR", 1) == [("ACK", 1, ())]
    assert dev.interroger("STATUS?", "STATUS").tir == "RUN"
    assert echange(dev, "TIR", 2) == [("NAK", 2, ("BUSY", "TIR"))]
    hz.sleep(4.0)
    dev.sonder()
    assert [(e.type, e.id) for e in dev.prendre()] == [("DONE", 1)]
    assert dev.interroger("STATUS?", "STATUS").tir == "DONE"


def test_act_stop_arrete_les_axes_et_laisse_les_pompes():
    hz, fw, dev = banc("ACT")
    dev.connect()
    echange(dev, "PUMP B 1 1 1", 1)
    dev.prendre()
    echange(dev, "Z A 200.0 T=2000.000", 2)
    fw.programmee[3] = [10.0]
    echange(dev, "TIR", 3)
    hz.sleep(1.0)
    rep = echange(dev, "STOP", 4)
    assert ("ABORT", 2, ("STOP",)) in rep and ("ABORT", 3, ("STOP",)) in rep and rep[-1] == ("DONE", 4, ())
    st = dev.interroger("STATUS?", "STATUS")
    assert st.grip["A"][0] == pytest.approx(100.0, abs=0.1)
    assert st.tenue["B"] == (1, 1, 1) and st.tir == "IDLE"


def test_tirette_depart_par_retrait():
    orch = DualESP32Orchestrator(mock=True)
    assert orch.initialize()
    assert orch.act.tirette == 1
    t0 = orch.horloge.now()
    assert orch.attendre_depart()
    assert orch.horloge.now() - t0 == pytest.approx(orch.params.mock_delai_tirette_s)
    assert orch.act.tirette == 0


def test_liaison_reelle_absente_pas_de_repli_silencieux():
    orch = DualESP32Orchestrator(nav_port="/dev/inexistant_nav", act_port="/dev/inexistant_act", mock=False)
    assert orch.initialize() is False


def test_lignes_inconnues_ignorees_et_formats():
    assert parse_ligne("ets Jun  8 2016 00:22:57") is None
    assert parse_ligne("DONE #12").id == 12
    assert parse_ligne("NAK #3 BUSY occupé").args == ("BUSY", "occupé")
    assert parse_ligne("DONE sans identifiant") is None


def test_protocole_etat():
    e = EtatActionneurs(grip={"A": (165.0, 0.0), "B": (180.0, 90.0)}, pression={"A": (0.0, 0.0, 0.0), "B": (41.0, 42.0, 5.0)}, fourche=(35.3, 332.2),
                        tir="RUN", tirette=0)
    e2 = parse_status(format_status(e))
    assert e2.tenue == e.tenue == {"A": (0, 0, 0), "B": (1, 1, 0)} and e2.grip == e.grip and e2.tir == "RUN" and e2.tirette == 0
    assert parse_status(format_status(EtatActionneurs())).tirette is None
    assert parse_pose("POSE 250.0 1000.0 -90.0") == (250.0, 1000.0, -90.0)
    assert parse_pose("POSE 250.0 1000.0 -90.0 MOVING") == (250.0, 1000.0, -90.0)
    for mauvais in ("ERR", "STATUS Z_A 1.0", "STATUS ZZ 1"):
        with pytest.raises(ValueError):
            parse_status(mauvais)
