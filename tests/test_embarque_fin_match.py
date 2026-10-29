"""Fin de match : arrêt autonome des ESP32 (docs/PROTOCOLE_ESP32.md §6 bis), marge de fin côté Pi, Pi en retard.

Tout est en temps simulé (HorlogeVirtuelle) : aucun test ne dépend de la charge de la machine. Chaque test vérifie un invariant, pas une
durée mesurée : jamais de mouvement d'un axe après la durée du match (spec/regles_2027.json, match.duree_s ; pénalité de 50 points sinon).
"""
from __future__ import annotations

import random

import numpy as np
import pytest

import embarque_fixtures as F
from embarque.pont import PontNode
from embarque.spec import duree_match_s
from esp32_bridge import (DualESP32Orchestrator, ESP32Device, FirmwareSimule, HorlogeVirtuelle, ParamsESP32, SerieSimulee)
from pi5_runner import CapteursRobot, Pi5Runner, RobotBackend, ouvrir

DUREE = duree_match_s()
P = ParamsESP32()
FIN_ESP32 = DUREE - P.marge_arret_esp32_s            # instant d'arrêt autonome, après le départ
EPS = 1e-6


# ---- protocole contre le firmware simulé ------------------------------------------------------------------------------------------
def banc(role: str):
    hz = HorlogeVirtuelle()
    fw = FirmwareSimule(role, hz)
    dev = ESP32Device(f"ESP32_{role}", role, "mock", liaison=SerieSimulee(fw), firmware=fw)
    assert dev.connect()
    return hz, fw, dev


def echange(dev, texte, pid):
    dev.envoyer(texte, pid)
    dev.sonder()
    return [(e.type, e.id, e.args) for e in dev.prendre()]


def test_nav_start_arme_l_arret_autonome_et_fige_la_pose():
    hz, fw, dev = banc("NAV")
    assert echange(dev, "CFG FIN_MS 10000", 1) == [("ACK", 1, ())]
    assert dev.interroger("CHRONO?", "CHRONO") == -1                       # pas parti
    assert echange(dev, "START 2000", 2) == [("ACK", 2, ())]               # le match a commencé il y a 2 s
    echange(dev, "SET_LIMITS 500 120", 3)
    assert dev.interroger("CHRONO?", "CHRONO") == 2000
    hz.sleep(1.0)
    echange(dev, "GOTO 5000.0 0.0 0.0", 4)                                   # 5 m à 500 mm/s : 10 s
    hz.sleep(3.0)
    assert hz.now() == pytest.approx(4.0)                                    # départ à -2 s : fin à 8 s ; il reste 4 s
    hz.sleep(5.0)                                                            # le Pi ne dit rien : l'ESP32 s'arrête seul à t = 8 s
    dev.sonder()
    evts = [(e.type, e.id, e.args) for e in dev.prendre()]
    assert ("ABORT", 4, ("FIN",)) in evts
    assert fw.mouvement_jusqua == pytest.approx(8.0) and fw.fini
    x = fw.pose[0]
    assert x == pytest.approx(500.0 * (8.0 - 1.0))                           # figée à l'instant de l'arrêt, pas de l'interrogation
    hz.sleep(5.0)
    assert dev.interroger("POSE?", "POSE")[0] == pytest.approx(x, abs=0.1)
    assert dev.fin_recue
    # après la fin : plus aucune commande d'action (NAK STATE FIN), STOP toujours accepté (doublon du Pi)
    assert echange(dev, "GOTO 100.0 100.0 0.0", 5) == [("NAK", 5, ("STATE", "FIN"))]
    assert echange(dev, "SET_POSE 0 0 0", 6) == [("NAK", 6, ("STATE", "FIN"))]
    assert echange(dev, "STOP", 7) == [("ACK", 7, ()), ("DONE", 7, ())]


def test_start_exige_fin_ms_et_garde_l_instant_le_plus_ancien():
    hz, fw, dev = banc("NAV")
    assert echange(dev, "START 0", 1) == [("NAK", 1, ("STATE", "FIN_MS"))]
    echange(dev, "CFG FIN_MS 10000", 2)
    echange(dev, "START 300", 3)
    hz.sleep(1.0)
    echange(dev, "START 100", 4)                                             # nouvel essai du Pi : plus tardif, ignoré
    assert dev.interroger("CHRONO?", "CHRONO") == 1300
    echange(dev, "START 2000", 5)                                            # plus ancien : retenu
    assert dev.interroger("CHRONO?", "CHRONO") == 2000
    assert echange(dev, "CFG FIN_MS 20000", 6) == [("NAK", 6, ("STATE", "MATCH"))]    # on ne repousse pas l'arrêt en cours de match
    hz.sleep(8.0)
    dev.sonder()
    assert fw.fini
    assert echange(dev, "START 0", 7) == [("NAK", 7, ("STATE", "FIN"))]
    assert echange(dev, "CFG FIN_MS 10000", 8) == [("ACK", 8, ())]          # nouveau match : réarmé
    assert not fw.fini and fw.t0 is None
    assert echange(dev, "GOTO 100.0 100.0 0.0", 9)[0][0] == "ACK"


def test_sans_fin_ms_aucun_arret_autonome():
    hz, fw, dev = banc("NAV")
    echange(dev, "SET_LIMITS 500 120", 1)
    echange(dev, "GOTO 5000.0 0.0 0.0", 2)
    hz.sleep(20.0)
    dev.sonder()
    assert [e.type for e in dev.prendre()] == ["DONE"] and not fw.fini


def test_act_tirette_arme_le_chrono_les_axes_s_arretent_les_pompes_gardent_leur_etat():
    hz, fw, dev = banc("ACT")
    echange(dev, "CFG FIN_MS 10000", 1)
    echange(dev, "PUMP B 1 1 0", 2)
    assert dev.interroger("CHRONO?", "CHRONO") == -1                       # tirette en place : pas parti
    hz.sleep(1.0)
    fw.retirer_tirette()                                                     # t = 1 s : départ
    dev.sonder()
    hz.sleep(1.0)
    assert dev.interroger("CHRONO?", "CHRONO") == 1000
    echange(dev, "Z A 200.0 T=20000.000", 3)
    echange(dev, "ROT B 90.0 T=20000.000", 4)
    fw.programmee[5] = [30.0]
    echange(dev, "TIR", 5)
    hz.sleep(30.0)                                                           # l'ESP32 s'arrête seul à t = 11 s
    dev.sonder()
    evts = [(e.type, e.id, e.args) for e in dev.prendre()]
    assert {("ABORT", 3, ("FIN",)), ("ABORT", 4, ("FIN",)), ("ABORT", 5, ("FIN",))} <= set(evts)
    assert fw.mouvement_jusqua == pytest.approx(11.0)
    st = dev.interroger("STATUS?", "STATUS")
    assert st.tenue["B"] == (1, 1, 0) and st.tir == "IDLE"                   # les pompes gardent leur état, la séance de tir est abandonnée
    z = st.grip["A"][0]
    hz.sleep(5.0)
    assert dev.interroger("STATUS?", "STATUS").grip["A"][0] == z             # les axes ne bougent plus
    for texte in ("Z A 150.0", "ROT A 0.0", "ASC 0.0 0.0", "PUMP A 0 0 0", "TIR", "INIT"):
        assert echange(dev, texte, 9) == [("NAK", 9, ("STATE", "FIN"))], texte
    assert echange(dev, "STOP", 10) == [("ACK", 10, ()), ("DONE", 10, ())]
    assert dev.interroger("STATUS?", "STATUS").tenue["B"] == (1, 1, 0)


# ---- orchestrateur : armement, départ, borne sûre de l'âge ---------------------------------------------------------------------------
def orch_demarre(params: ParamsESP32 = P, retard_lecture_s: float = 0.0):
    """Initialisation, attente de la tirette, synchronisation du départ ; fin_match posé comme dans RobotBackend.demarrer."""
    orch = DualESP32Orchestrator(mock=True, params=params)
    assert orch.initialize(pose=(250.0, 1000.0, 0.0))
    assert orch.attendre_depart()
    if retard_lecture_s:
        orch.dormir_jusqua(orch.horloge.now() + retard_lecture_s)          # le Pi lit la tirette en retard
    t_dep = orch.synchroniser_depart()
    orch.fin_match = t_dep + DUREE
    return orch, t_dep


def test_initialize_envoie_fin_ms_lu_dans_la_spec():
    orch = DualESP32Orchestrator(mock=True)
    assert orch.initialize()
    attendu = f"CFG FIN_MS {int(round(FIN_ESP32 * 1000))}"
    assert attendu == "CFG FIN_MS 99800"
    for dev in (orch.nav, orch.act):
        assert [l for l in dev.journal if l.startswith("CFG FIN_MS")][0].startswith(attendu + " #")


def test_aucun_arret_autonome_si_desactive():
    orch, _ = orch_demarre(ParamsESP32(arret_autonome=False))
    assert not [l for d in (orch.nav, orch.act) for l in d.journal if l.startswith(("CFG FIN_MS", "START"))]
    assert orch.nav.firmware.fin_s is None and orch.nav.firmware.t0 is None


@pytest.mark.parametrize("retard", [0.0, 0.3, 2.0])
def test_nav_s_arrete_au_plus_tard_en_meme_temps_qu_act_meme_si_le_pi_lit_la_tirette_en_retard(retard):
    orch, t_dep = orch_demarre(retard_lecture_s=retard)
    nav, act = orch.nav.firmware, orch.act.firmware
    assert orch.armes == {"NAV": True, "ACT": True}
    assert act.t0 is not None and nav.t0 is not None
    assert t_dep <= act.t0 + EPS and t_dep == pytest.approx(act.t0, abs=0.002)    # le Pi retrouve le vrai départ (borne précoce)
    assert nav.t0 <= act.t0 + EPS                                               # NAV ne s'arrête jamais plus tard qu'ACT
    assert nav.t0 == pytest.approx(act.t0, abs=0.002)
    # le retard de lecture n'a pas décalé l'arrêt de NAV : il tombe à la même seconde que celui d'ACT (à la milliseconde près)
    assert nav.t0 + nav.fin_s == pytest.approx(act.t0 + act.fin_s, abs=0.002)


def test_sans_tirette_les_deux_esp32_demarrent_avec_start_0():
    orch = DualESP32Orchestrator(mock=True)
    assert orch.initialize()
    h = orch.horloge.now()
    assert orch.synchroniser_depart(avec_tirette=False) == pytest.approx(h)
    assert orch.armes == {"NAV": True, "ACT": True}
    assert orch.nav.firmware.t0 == pytest.approx(h) and orch.act.firmware.t0 == pytest.approx(h)


# ---- Pi : marge de fin, temps simulé borné ---------------------------------------------------------------------------------------------
def plan_fin(dt_nav=6.0, dt_axes=5.0):
    """Une brique : base 6 s, vérin Z de A, rotation de B, pompes de A (0,3 s)."""
    return {"brique": {"a": "seDeplacer"}, "dt": dt_nav, "t0": 0.0, "t1": dt_nav, "err": None, "events": [
        {"kind": "VAC", "face": "A", "rows": [1, 1, 1], "t0": 0.1, "t1": 0.4}],
        "moves": [
            {"g": "NAV", "pts": [{"t": 0.0, "v": [250, 1000, 0]}, {"t": dt_nav, "v": [1750, 1000, 0]}]},
            {"g": "GRIP_A", "pts": [{"t": 0.0, "v": [165, 0]}, {"t": dt_axes, "v": [200, 0]}]},
            {"g": "GRIP_B", "pts": [{"t": 0.0, "v": [165, 0]}, {"t": dt_axes, "v": [165, 90]}]}]}


def commandes_apres(dev, t_limite):
    """Lignes d'action reçues par le firmware après `t_limite` (hors STOP, qui n'est jamais une action)."""
    fw = dev.firmware
    return [l for l, t in zip(fw.journal, fw.journal_t) if t > t_limite and l.split()[0] in ("GOTO", "PATH", "Z", "ROT", "ASC", "PUMP", "TIR")]


def test_pas_de_commande_apres_fin_moins_marge():
    orch, t_dep = orch_demarre()
    plan = plan_fin()
    # un vérin Z qui ne doit partir qu'à 1,6 s de la brique, c'est-à-dire après `fin - marge` (la brique commence 1,5 s avant la fin)
    plan["moves"].append({"g": "GRIP_A", "pts": [{"t": 5.0, "v": [200, 0]}, {"t": 5.5, "v": [210, 0]}]})
    orch.dormir_jusqua(orch.fin_match - 1.5)
    rap = orch.executer(plan, t_match0=orch.horloge.now() - t_dep)
    assert not rap.ok
    assert commandes_apres(orch.nav, orch.fin_match - P.marge_fin_s + EPS) == []
    assert commandes_apres(orch.act, orch.fin_match - P.marge_fin_s + EPS) == []
    assert orch.nav.firmware.mouvement_jusqua <= t_dep + FIN_ESP32 + EPS


def test_le_temps_simule_ne_depasse_jamais_la_fin_du_match():
    """Brique sans commande (attente) dont la durée dépasse la fin : l'horloge s'arrête à la fin (cause du 100,13 s constaté)."""
    orch, t_dep = orch_demarre()
    orch.dormir_jusqua(orch.fin_match - 2.0)
    plan = {"brique": {"a": "attendre", "sec": 10}, "dt": 10.0, "t0": 0.0, "t1": 10.0, "err": None, "moves": [],
            "events": [{"kind": "WAIT", "until": None, "t0": 0.0, "t1": 10.0}]}
    rap = orch.executer(plan)
    assert not rap.ok and rap.erreur.startswith("fin du match")
    assert orch.horloge.now() <= orch.fin_match + EPS            # arrêtée par l'arrêt autonome des ESP32 (99,8 s), au plus tard à la fin
    assert orch.nav.firmware.fini and orch.act.firmware.fini
    orch2, _ = orch_demarre(ParamsESP32(arret_autonome=False))   # sans arrêt autonome : c'est le Pi qui arrête, exactement à la fin
    orch2.dormir_jusqua(orch2.fin_match - 2.0)
    rap2 = orch2.executer(plan)
    assert not rap2.ok and orch2.horloge.now() == pytest.approx(orch2.fin_match, abs=EPS)
    assert orch2.nav.journal[-1].startswith("STOP") and orch2.act.journal[-1].startswith("STOP")


# ---- Pi en retard -----------------------------------------------------------------------------------------------------------------------
def avec_latence(orch: DualESP32Orchestrator, latence_s: float) -> None:
    """Pi lent : une fois le match parti, chaque commande n'est écrite que `latence_s` après la décision (les PING, eux, continuent : fil
    d'entretien du chien de garde). Le `START` et la lecture du chrono, faits dès la tirette retirée, ne sont pas retardés."""
    hz = orch.horloge
    for dev in (orch.nav, orch.act):
        d = dev.ecrire

        def ecrire(ligne, journal=True, _d=d):
            if journal and orch.fin_match is not None and ligne.split()[0] not in ("START", "CHRONO?"):
                orch.dormir_jusqua(hz.now() + latence_s)
            _d(ligne, journal)
        dev.ecrire = ecrire


def jouer_brique_de_fin(params: ParamsESP32, latence_s: float):
    orch, t_dep = orch_demarre(params)
    avec_latence(orch, latence_s)
    orch.dormir_jusqua(orch.fin_match - 3.5)
    orch.executer(plan_fin(), t_match0=orch.horloge.now() - t_dep)
    orch.attendre_fin()                                     # ce que fait le runner en fin de match : attendre la fin, puis STOP aux deux ESP32
    orch.arreter_tout()
    orch.dormir_jusqua(orch.horloge.now() + 3.0)                # on laisse passer le temps : le STOP tardif du Pi arrive
    return orch, t_dep


def test_pi_en_retard_de_0_5_s_aucun_mouvement_apres_la_fin_grace_a_l_arret_autonome():
    # marge du Pi réduite au minimum permis : la protection testée est celle des ESP32, pas celle du Pi
    params = ParamsESP32(marge_fin_s=P.marge_arret_esp32_s)
    orch, t_dep = jouer_brique_de_fin(params, 0.5)
    fin = t_dep + DUREE
    for dev in (orch.nav, orch.act):
        fw = dev.firmware
        assert fw.fini and fw.mouvement_jusqua <= fin + EPS, (dev.role, fw.mouvement_jusqua - fin)
        assert fw.mouvement_jusqua == pytest.approx(t_dep + FIN_ESP32, abs=0.002)   # arrêtés par eux-mêmes, avant la fin
        assert fw._nav is None and not fw._voies
    # le STOP du Pi, lui, est bien arrivé en retard (après la fin) : sans l'arrêt autonome, le robot aurait bougé jusque-là
    stop_nav = [t for l, t in zip(orch.nav.firmware.journal, orch.nav.firmware.journal_t) if l.startswith("STOP")]
    assert stop_nav and min(stop_nav) >= fin + 0.5 - EPS
    assert orch.act.firmware.pompes["A"] == (1, 1, 1)                                 # pompes inchangées
    pose = orch.nav.firmware.pose
    assert pose[0] < 1750.0                                                           # la base n'a pas fini son trajet : coupée en route


def test_sans_arret_autonome_le_meme_pi_en_retard_fait_bouger_le_robot_apres_la_fin():
    """Contre-épreuve : le test ci-dessus est sensible. Sans arrêt autonome, le STOP du Pi (0,5 s de retard) arrive après la fin."""
    params = ParamsESP32(arret_autonome=False)
    orch, t_dep = jouer_brique_de_fin(params, 0.5)
    fin = t_dep + DUREE
    assert orch.nav.firmware.mouvement_jusqua >= fin + 0.4         # la base a roulé jusqu'au STOP tardif (-50 points en match)
    assert orch.act.firmware.mouvement_jusqua >= fin + 0.4


def test_pi_a_l_heure_arret_autonome_et_stop_du_pi_se_cumulent_sans_conflit():
    orch, t_dep = jouer_brique_de_fin(P, 0.0)
    for dev in (orch.nav, orch.act):
        assert dev.firmware.fini and dev.firmware.mouvement_jusqua <= t_dep + DUREE + EPS
    assert orch.nav.fin_recue and orch.act.fin_recue


# ---- pont Node : brique jouée à blanc ----------------------------------------------------------------------------------------------------
@pytest.fixture(scope="module")
def pont():
    with PontNode() as p:
        p.hello()
        yield p


def test_brique_refusee_pour_la_duree_laisse_le_modele_interne_inchange(pont):
    """`dt_max` : la brique trop longue est jouée à blanc puis annulée ; la suite du match est identique à celle d'un match sans refus."""
    programme = pont.reference()[:14]
    pont.track_start(vision=False)
    voulu = [pont.track_exec(b) for b in programme]
    pont.track_start(vision=False)
    refus = 0
    for b, ref in zip(programme, voulu):
        r = pont.track_exec(b, dt_max=0.0)
        if r.get("refuse"):
            refus += 1
            assert r["plan"] is None and r["dt"] > 0
            r = pont.track_exec(b)
        assert r["plan"] == ref["plan"] and r["belief"] == ref["belief"] and r["info"] == ref["info"]
    assert refus >= 5
    pont.track_start(vision=False)
    assert pont.track_exec(programme[0], dt_max=1e6)["plan"]["dt"] > 0           # assez de temps : exécutée normalement


def test_brique_impossible_laisse_le_modele_interne_comme_le_robot_immobile(pont):
    """Brique en erreur dans le moteur local : rien n'est envoyé aux ESP32, donc le modèle interne ne doit garder aucun état partiel
    (consignes de nacelles changées) que les codeurs ne confirmeraient jamais ; l'échec seul est mémorisé."""
    trouve = 0
    for idx in range(pont.hello_info["nOutputs"]):
        depart = pont.track_start(vision=False)["belief"]
        brique = pont.step(idx, depart)["brique"]
        if brique is None:
            continue
        r = pont.track_exec(brique, dt_max=1e6)
        if not r["info"].get("err"):
            continue
        trouve += 1
        assert r.get("annule") and r["plan"] is None
        assert r["belief"]["pinces"] == depart["pinces"] and r["belief"]["pose"] == depart["pose"] and r["belief"]["t"] == depart["t"]
        assert r["belief"]["echec"] and r["belief"]["echecs"]["briques"]                # l'échec est mémorisé : brique masquée
        if trouve >= 3:
            break
    assert trouve >= 1


def test_backend_ne_lance_pas_une_brique_qui_ne_peut_pas_finir_avant_la_marge(pont):
    orch = DualESP32Orchestrator(mock=True)
    be = RobotBackend(pont, orch, CapteursRobot(orch), "yellow")
    be.demarrer()
    orch.horloge.t = be.t_depart + DUREE - 3.0
    avant = (len(orch.nav.journal), len(orch.act.journal), be.cons.interne["t"])
    err = be.executer(0, {"a": "attendreJusqua", "sec": DUREE})
    assert be.refusee and err.startswith("Brique non lancée")
    assert (len(orch.nav.journal), len(orch.act.journal), be.cons.interne["t"]) == avant
    err = be.executer(0, {"a": "attendre", "sec": 1.0})                         # tient avant `fin - marge` : lancée
    assert not be.refusee and err is None
    err = be.executer(0, {"a": "attendre", "sec": 2.0})                         # 3 - 1 = 2 s restantes, moins 0,5 s de marge : refusée
    assert be.refusee


# ---- matchs complets ----------------------------------------------------------------------------------------------------------------------
class PolitiqueAleatoire:
    """Politique de test déterministe (logits tirés d'une graine) : pas de modèle entraîné, donc pas d'aléa d'une session à l'autre."""

    def __init__(self, n_out: int, graine: int):
        self.n_out, self.rng = n_out, np.random.default_rng(graine)

    def reset(self) -> None:
        pass

    def logits(self, obs):
        return self.rng.random(self.n_out).astype(np.float32)


def verifier_fin_de_match(be: RobotBackend, orch: DualESP32Orchestrator, pi_a_l_heure: bool = True) -> None:
    fin = be.t_depart + DUREE
    if pi_a_l_heure:
        assert be.t_match() == pytest.approx(DUREE, abs=EPS)         # le robot a attendu la fin sans la dépasser (jamais 100,13 s)
    for dev in (orch.nav, orch.act):
        fw = dev.firmware
        assert fw.mouvement_jusqua <= fin + EPS, (dev.role, fw.mouvement_jusqua - fin)
        assert fw._nav is None and not fw._voies
        assert not commandes_apres(dev, fin - orch.params.marge_fin_s + EPS)         # aucune commande d'action dans la marge de fin
    assert orch.nav.journal[-1].startswith("STOP") and orch.act.journal[-1].startswith("STOP")
    assert all(r.ok or r.erreur.startswith("fin du match") for r in be.rapports), [r.erreur for r in be.rapports if not r.ok]


@pytest.mark.parametrize("graine,latence", [(0, 0.0), (1, 0.0), (2, 0.0), (3, 0.5), (4, 0.5)])
def test_match_complet_jusqu_a_la_fin_avec_ou_sans_pi_en_retard(pont, graine, latence):
    """Matchs jusqu'à la fin, politiques déterministes variées, Pi à l'heure ou en retard de 0,5 s par commande."""
    orch = DualESP32Orchestrator(mock=True)
    if latence:
        avec_latence(orch, latence)
    be = RobotBackend(pont, orch, CapteursRobot(orch), "yellow")
    runner = Pi5Runner(PolitiqueAleatoire(pont.hello_info["nOutputs"], graine), pont, be, max_decisions=1000)
    runner.jouer()
    assert len(runner.decisions) >= 3
    verifier_fin_de_match(be, orch, pi_a_l_heure=not latence)
