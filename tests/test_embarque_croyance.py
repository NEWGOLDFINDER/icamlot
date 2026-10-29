"""Croyance construite depuis les capteurs (embarque/croyance.py), miroir bleu, robot avec ESP32 simulés, suivi lidar."""
from __future__ import annotations

import math
import random

import pytest

import embarque_fixtures as F
from embarque.croyance import ConstructeurCroyance, Mesures, miroir_adversaire, miroir_pose
from embarque.miroir import ECART_FACES_DEG, cap_miroir, face_miroir, face_reelle
from embarque.pont import PontNode
from embarque.spec import duree_match_s
from esp32_bridge import DualESP32Orchestrator
from lidar_tracker import LidarTracker, ParamsLidar
from pi5_runner import CapteursRobot, Pi5Runner, RobotBackend, ouvrir


def mesures_depuis_simulation(b: dict) -> Mesures:
    """Capteurs parfaits : ce que le robot mesurerait si ses lidar et caméras donnaient exactement la vérité du moteur."""
    return Mesures(t=b["t"], pose=(b["pose"]["x"], b["pose"]["y"], b["pose"]["h"]), adversaire=b["adversaire"],
                   paquets={k: dict(v) for k, v in b["paquets"].items()}, etrangeres=b["etrangeres"])


def test_croyance_des_capteurs_donne_la_meme_observation_que_la_simulation():
    """Modèle interne (moteur local, caméras simulées coupées) + mesures des capteurs = croyance de l'environnement :
    l'observation et le masque calculés par le pont sont identiques, décision après décision."""
    rng = random.Random(4)
    with PontNode() as sim, PontNode() as interne:
        cat = sim.hello()["catalogue"]
        interne.hello(vision=False)
        cons = ConstructeurCroyance(interne)
        cons.demarrer()
        etat = sim.sim_reset({"seed": 3, "intensite": "aucun"}, {"skipContacts": True}, 200)
        n = 0
        while not etat["done"] and n < 40:
            b = cons.croyance(mesures_depuis_simulation(etat["belief"]))
            obs, mask = interne.observe_mask(b)
            assert obs == etat["obs"], f"observation différente à la décision {n}"
            assert mask == etat["mask"], f"masque différent à la décision {n}"
            idx = rng.choice([i for i, m in enumerate(mask) if m and cat[i]["a"] not in ("finir", "trone", "tir")] or [i for i, m in enumerate(mask) if m])
            brique = sim.step(idx, etat["belief"])["brique"]
            cons.appliquer(brique)
            etat = sim.sim_step(idx)
            n += 1
        assert n >= 10


def test_echec_connu_du_moteur_local_masque_la_brique_meme_si_l_horloge_avance():
    """Une brique refusée par le moteur local est masquée tant que le robot n'a pas bougé, même si l'horloge de match avance."""
    with PontNode() as interne:
        interne.hello(vision=False)
        cons = ConstructeurCroyance(interne)
        cons.demarrer()
        impossible = {"a": "prendre", "f": "A", "p": "P1", "tm": True}
        cons.appliquer(impossible)                     # réussit
        r = cons.appliquer(impossible)                 # P1 est vide : refus, le temps n'avance pas
        assert r["info"]["err"] and cons.echec
        b = cons.croyance(Mesures(t=r["belief"]["t"] + 0.3, pose=(r["belief"]["pose"]["x"], r["belief"]["pose"]["y"], r["belief"]["pose"]["h"])))
        assert b["echec"] and b["echecs"]["t"] == b["t"] and impossible in b["echecs"]["briques"]


def test_les_capteurs_remplacent_le_modele_interne_quand_ils_sont_plus_recents():
    with PontNode() as interne:
        interne.hello(vision=False)
        cons = ConstructeurCroyance(interne)
        cons.demarrer()
        cons.appliquer({"a": "seDeplacer", "x": 900, "y": 1000})
        t = cons.interne["t"]
        adv = {"x": 2000.0, "y": 1000.0, "vx": -100.0, "vy": 0.0, "t": t - 0.5}
        m = Mesures(t=t + 1.0, pose=(905.0, 1003.0, 2.0), adversaire=adv,
                    paquets={"P3": {"n": 1, "t": t + 0.5}, "P4": {"n": 0, "t": -5.0}})        # P3 vu plus récemment ; P4 : mesure plus vieille que la connaissance initiale
        b = cons.croyance(m)
        assert b["t"] == t + 1.0 and b["pose"] == {"x": 905.0, "y": 1003.0, "h": 2.0} and b["adversaire"] == adv
        assert b["paquets"]["P3"] == {"n": 1, "t": t + 0.5}
        assert b["paquets"]["P4"]["n"] == 3
        obs0 = interne.observe(cons.croyance(Mesures(t=t + 1.0, pose=(900.0, 1000.0, 0.0))))
        assert interne.observe(b) != obs0, "l'observation doit dépendre des mesures"


def test_miroir_bleu():
    assert miroir_pose(miroir_pose((250.0, 1000.0, 30.0), "blue"), "blue") == (250.0, 1000.0, 30.0)
    # CONTRATS §15 : cap de la vraie face B mis en miroir, 180 - 120 - h
    assert miroir_pose((250.0, 1000.0, 0.0), "blue") == (2750.0, 1000.0, 60.0)
    assert [face_miroir(f) for f in "ABC"] == ["B", "A", "C"] and all(cap_miroir(cap_miroir(h)) == h for h in (0.0, 37.5, -200.0))
    assert face_reelle("A", "blue") == "B" and face_reelle("A", "yellow") == "A"
    assert miroir_pose((250.0, 1000.0, 0.0), "yellow") == (250.0, 1000.0, 0.0)
    adv = {"x": 1000.0, "y": 500.0, "vx": 100.0, "vy": -50.0, "t": 3.0}
    assert miroir_adversaire(adv, "blue") == {"x": 2000.0, "y": 500.0, "vx": -100.0, "vy": -50.0, "t": 3.0}
    assert miroir_adversaire(adv, "yellow") == adv


def test_equipe_bleue_echange_les_faces_a_et_b():
    """CONTRATS §15 : en bleu, la pince A de l'équipe (modèle interne, réseau) est la VRAIE face B ; le recoupement avec l'ESP32
    compare donc l'état réel de B à la pince A du modèle. Même écart angulaire entre faces que le moteur (hello du pont)."""
    from esp32_bridge import EtatActionneurs
    with PontNode() as interne:
        assert interne.hello(vision=False)["miroir"]["ecartFaces"] == ECART_FACES_DEG
        cons = ConstructeurCroyance(interne, "blue")
        cons.demarrer()
        r = cons.appliquer({"a": "prendre", "f": "A", "p": "P1", "tm": True})
        assert not r["info"].get("err")
        a, b = cons.interne["pinces"]["A"], cons.interne["pinces"]["B"]
        assert a["slots"] == ["P1.1", "P1.2", "P1.3"] and b["slots"] == [None, None, None]
        assert abs(a["hc"] - b["hc"]) > 2.0                                 # la pince qui a pris n'est plus à la hauteur de l'autre
        vide = cons.croyance(Mesures(t=r["belief"]["t"], pose=miroir_pose((r["belief"]["pose"]["x"], r["belief"]["pose"]["y"], r["belief"]["pose"]["h"]), "blue")))
        assert vide["pinces"] == cons.interne["pinces"]
        pleine = (100.0, 100.0, 100.0)
        reel = EtatActionneurs(grip={"A": (b["hc"], b["rot"]), "B": (a["hc"], a["rot"])}, pression={"A": (0.0, 0.0, 0.0), "B": pleine})
        assert cons._recouper(cons.interne, reel) == []                      # vraie face B = pince A de l'équipe
        inverse = EtatActionneurs(grip={"A": (a["hc"], a["rot"]), "B": (b["hc"], b["rot"])}, pression={"A": pleine, "B": (0.0, 0.0, 0.0)})
        assert any(d.startswith("hc A") for d in cons._recouper(cons.interne, inverse))


def test_equipe_bleue_voit_le_meme_monde_que_l_equipe_jaune():
    """Mêmes mesures mises en miroir : le robot bleu au miroir du jaune produit exactement la même observation et le même masque."""
    with PontNode() as interne:
        interne.hello(vision=False)
        jaune = ConstructeurCroyance(interne, "yellow")
        bleu = ConstructeurCroyance(interne, "blue")
        jaune.demarrer()
        mj = Mesures(t=0.0, pose=(250.0, 1000.0, 0.0), adversaire={"x": 2700.0, "y": 900.0, "vx": -50.0, "vy": 10.0, "t": 0.0},
                     paquets={"P1": {"n": 2, "t": 0.0}, "P4": {"n": 3, "t": 0.0}})
        mb = Mesures(t=0.0, pose=miroir_pose(mj.pose, "blue"), adversaire=miroir_adversaire(mj.adversaire, "blue"),
                     paquets={"P4": {"n": 2, "t": 0.0}, "P1": {"n": 3, "t": 0.0}})
        bj = jaune.croyance(mj)
        bleu.demarrer()
        bb = bleu.croyance(mb)
        assert bj["pose"] == bb["pose"] and bj["adversaire"] == bb["adversaire"] and bj["paquets"] == bb["paquets"]
        assert interne.observe_mask(bj) == interne.observe_mask(bb)
        assert bj["paquets"]["P1"]["n"] == 2


def test_robot_avec_esp32_simules_joue_un_match(tmp_path_factory):
    """Mode robot (sans matériel) : modèle interne + ESP32 simulés + horloge virtuelle, un match JUSQU'À LA FIN. Les codeurs renvoyés par
    les ESP32 restent cohérents avec le modèle interne pendant tout le match, et aucune commande n'est refusée.

    Indépendant de la charge de la machine : l'horloge est virtuelle (esp32_bridge.HorlogeVirtuelle, aucun appel à l'horloge réelle dans
    la boucle) et le temps simulé ne dépasse jamais la fin du match. Le 100,13 s constaté venait de la durée du plan d'une dernière brique
    (attentes internes du moteur) que l'orchestrateur laissait s'écouler au-delà de 100 s : corrigé à la source (docs/PROTOCOLE_ESP32.md §6 bis)."""
    onnx, _ = F.modele_de_test(tmp_path_factory, "peu")
    pont, pol, _ = ouvrir(onnx, vision=False)
    with pont:
        orch = DualESP32Orchestrator(mock=True)
        be = RobotBackend(pont, orch, CapteursRobot(orch), "yellow")
        runner = Pi5Runner(pol, pont, be, max_decisions=1000)
        bilan = runner.jouer()
        assert bilan["decisions"] >= 5
        # seule la brique coupée par la fin du match (100 s) peut échouer
        assert all(r.ok or r.erreur.startswith("fin du match") for r in be.rapports)
        assert be.cons.historique_divergences == [], be.cons.historique_divergences
        # le match commence au retrait de la tirette (ESP32 des actionneurs) ; le robot attend la fin sans la dépasser (égalité exacte,
        # à l'arrondi des flottants près : le temps est simulé)
        assert be.t_depart == pytest.approx(orch.params.mock_delai_tirette_s)
        assert be.t_match() == pytest.approx(duree_match_s(), abs=1e-6)
        assert sum(1 for r in be.rapports if r.commandes) > 3
        # fin du match : STOP aux deux ESP32 (doublon de leur arrêt autonome), aucun axe n'a bougé après la fin
        assert orch.nav.journal[-1].startswith("STOP") and orch.act.journal[-1].startswith("STOP")
        for dev in (orch.nav, orch.act):
            assert dev.firmware.mouvement_jusqua <= be.t_depart + duree_match_s() + 1e-6


def test_robot_equipe_bleue_envoie_des_commandes_en_miroir(tmp_path_factory):
    onnx, _ = F.modele_de_test(tmp_path_factory, "peu")
    pont, pol, _ = ouvrir(onnx, vision=False)
    with pont:
        orch = DualESP32Orchestrator(mock=True)
        be = RobotBackend(pont, orch, CapteursRobot(orch), "blue")
        Pi5Runner(pol, pont, be, max_decisions=3).jouer()
        mouvements = [c for c in orch.nav.journal if c.startswith(("GOTO", "PATH"))]
        # départ bleu (CONTRATS §15) : vraie face B vers le centre, cap réel 180 - 120 - 0 = 60°
        assert [c for c in orch.nav.journal if c.startswith("SET_POSE")][0].startswith("SET_POSE 2750.0 1000.0 60.0 #")
        assert be.cons.historique_divergences == [], be.cons.historique_divergences
        assert mouvements and all(float(g.split()[2 if g.startswith("PATH") else 1]) > 1500 for g in mouvements[:1])


# ---- lidar -----------------------------------------------------------------------------------------------------------
def scan_vers(rx, ry, rth, cibles, params=ParamsLidar()):
    """Scan [(angle, distance)] d'un lidar placé en (rx, ry, rth) qui voit des points ronds aux positions `cibles` de la table."""
    out = []
    for cx, cy in cibles:
        phi = math.degrees(math.atan2(cy - ry, cx - rx))
        out.append((params.sens_angle * (phi - rth - params.decalage_angle_deg), math.hypot(cx - rx, cy - ry)))
    return out


def test_lidar_suit_un_adversaire_en_mouvement():
    t = [0.0]
    trk = LidarTracker(mock=False, horloge=lambda: t[0])
    pose = (250.0, 1000.0, 0.0)
    for k in range(1, 31):
        t[0] = k * 0.1
        x, y = 1500.0 + 200.0 * t[0], 1000.0           # adversaire à 200 mm/s vers +x
        trk.process_scan(scan_vers(*pose, [(x, y)]), pose, t=t[0])
    adv = trk.adversaire(t_match=3.0, t_horloge=t[0])
    assert adv is not None and abs(adv["x"] - (1500 + 200 * 3.0)) < 40 and abs(adv["y"] - 1000) < 20
    assert abs(adv["vx"] - 200) < 40 and abs(adv["vy"]) < 40
    assert adv["t"] == pytest.approx(3.0)
    # perdu au-delà de perte_apres_s
    assert trk.adversaire(t_match=9.0, t_horloge=t[0] + ParamsLidar().perte_apres_s + 0.1) is None


def test_lidar_ignore_les_bords_de_la_table_et_la_portee():
    trk = LidarTracker(horloge=lambda: 0.0)
    pose = (250.0, 1000.0, 0.0)
    assert trk._points_table([(0.0, 100.0), (0.0, 4000.0)], pose).shape[0] == 0        # trop près / trop loin
    assert trk._points_table([(180.0, 300.0)], pose).shape[0] == 0                      # derrière nous : hors table (x < marge)
    assert trk._points_table([(0.0, 1000.0)], pose).shape[0] == 1


def test_lidar_sans_mesure_renvoie_none():
    trk = LidarTracker(horloge=lambda: 0.0)
    assert trk.adversaire(0.0) is None
    assert not trk.check_collision_threat((100.0, 100.0))
