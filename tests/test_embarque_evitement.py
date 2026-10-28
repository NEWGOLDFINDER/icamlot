"""Évitement décidé par le Pi : menace calculée à partir du lidar, STOP envoyé à l'ESP32 de navigation, reprise (docs/PROTOCOLE_ESP32.md §4.4, §7)."""
from __future__ import annotations

import math

from esp32_bridge import DualESP32Orchestrator
from lidar_tracker import LidarTracker, ParamsLidar
from pi5_runner import CapteursRobot


def scan_vers(rx, ry, rth, cibles, params=ParamsLidar()):
    """Scan [(angle, distance)] d'un lidar placé en (rx, ry, rth) qui voit des points ronds aux positions `cibles` de la table."""
    out = []
    for cx, cy in cibles:
        phi = math.degrees(math.atan2(cy - ry, cx - rx))
        out.append((params.sens_angle * (phi - rth - params.decalage_angle_deg), math.hypot(cx - rx, cy - ry)))
    return out


def test_menace_sur_trajet_adversaire_proche_et_devant_seulement():
    pose = (250.0, 1000.0, 0.0)
    trk = LidarTracker(horloge=lambda: 0.0)
    assert not trk.menace_sur_trajet(pose[:2], (900.0, 1000.0))                         # rien détecté
    trk.process_scan(scan_vers(*pose, [(500.0, 1000.0)]), pose, t=0.1)                    # à 250 mm devant (rayon de sécurité : 350 mm)
    assert trk.opp_detected
    assert trk.menace_sur_trajet(pose[:2], (900.0, 1000.0))
    assert not trk.menace_sur_trajet(pose[:2], (50.0, 1000.0))                            # il est derrière le sens du déplacement
    assert not trk.menace_sur_trajet(pose[:2], (260.0, 1000.0))                           # déplacement trop court : pas de direction
    assert not trk.menace_sur_trajet(pose[:2], (900.0, 1000.0), rayon_mm=200.0)            # hors du rayon demandé
    loin = LidarTracker(horloge=lambda: 0.0)
    loin.process_scan(scan_vers(*pose, [(1200.0, 1000.0)]), pose, t=0.1)
    assert not loin.menace_sur_trajet(pose[:2], (900.0, 1000.0))


def test_le_robot_evite_avec_la_menace_du_lidar_et_repart_quand_elle_disparait():
    """Bout en bout, ESP32 simulés : CapteursRobot.menace (lidar) est branchée sur l'orchestrateur ; STOP envoyé à NAV, puis reprise."""
    orch = DualESP32Orchestrator(mock=True)
    assert orch.initialize(pose=(250.0, 1000.0, 0.0))
    hz = orch.horloge
    lidar = LidarTracker(horloge=hz.now)
    orch.menace = CapteursRobot(orch, lidar=lidar).menace

    def scan():                       # un adversaire à 250 mm devant le robot de 0,5 s à 1,05 s, puis plus rien
        return scan_vers(*orch.lire_pose(), [(orch.lire_pose()[0] + 250.0, 1000.0)]) if 0.5 <= hz.now() < 1.05 else []
    lidar.source_scan = scan
    plan = {"brique": {"a": "seDeplacer"}, "dt": 2.0, "events": [],
            "moves": [{"g": "NAV", "pts": [{"t": 0.0, "v": [250, 1000, 0]}, {"t": 2.0, "v": [1250, 1000, 0]}]}]}
    rap = orch.executer(plan)
    assert rap.ok, rap.erreur
    assert any(l.startswith("STOP") for l in orch.nav.journal)
    assert plan["dt"] + 0.4 < rap.duree < plan["dt"] + 1.0
    assert orch.lire_pose() == (1250.0, 1000.0, 0.0)
