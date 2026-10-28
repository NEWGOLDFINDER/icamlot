#!/usr/bin/env python3
"""Suivi lidar 2D du robot adverse pour le Raspberry Pi 5 (Eurobot 2027).

Le lidar sert à deux choses (spec/robot.json, perception) : localiser notre robot par triangulation et suivre le robot adverse.
Ce module ne traite que le SECOND point : il transforme un scan brut en position et vitesse de l'adversaire dans le repère
RÉEL de la table (mm, m/s -> mm/s), c'est-à-dire exactement le champ `adversaire` de la croyance du moteur
(`{ x, y, vx, vy, t }`, voir l'en-tête de engine/env.js). La pose de notre robot (triangulation) est fournie par ailleurs.

Aucune valeur numérique n'est dans spec/*.json pour le lidar (`modele_capteur_lidar` : « a_definir »). Toutes celles de
`ParamsLidar` sont donc des HYPOTHÈSES nommées : celles de l'ancienne version sont conservées telles quelles, marquées « héritée ».
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np

from embarque.spec import table_largeur_mm, table_longueur_mm


@dataclass(frozen=True)
class ParamsLidar:
    """Hypothèses du suivi (aucune n'est dans la spec)."""
    # Portée utile du lidar (mm) : points plus proches ou plus lointains ignorés. Héritée.
    portee_min_mm: float = 150.0
    portee_max_mm: float = 3500.0
    # Marge (mm) à l'intérieur des bords de la table : les points plus près d'un bord sont ceux des bordures. Héritée.
    marge_bord_mm: float = 70.0
    # Rayon (mm) autour de l'estimation précédente dans lequel on cherche l'adversaire (sinon, tout le scan). Héritée.
    rayon_porte_mm: float = 450.0
    # Décalage du zéro du lidar par rapport à la face A (°). Hypothèse : lidar monté avec son zéro sur la face A.
    decalage_angle_deg: float = 0.0
    # Sens de l'angle du lidar : +1 si croissant dans le sens trigonométrique de la table, -1 sinon. Hypothèse (montage non décrit).
    sens_angle: int = 1
    # Bruits du filtre de Kalman. Hérités.
    q_pos: float = 10.0
    q_vel: float = 100.0
    r_mesure: float = 400.0          # variance de mesure (mm²) ; l'ancien commentaire donnait ~20 mm de précision
    p0: float = 500.0
    # Pas nominal du filtre (s) avant la première mesure. Hérité.
    dt_nominal_s: float = 0.1
    # Bornes de l'intervalle de temps entre deux scans (s), pour éviter un pas aberrant. Héritées.
    dt_min_s: float = 1e-3
    dt_max_s: float = 0.5
    # Au-delà de cet âge sans mesure valide (s), l'adversaire est considéré comme perdu (champ `adversaire` = None).
    # Hypothèse ; l'observation normalise l'âge de la mesure par 5 s (ENV.NORM.ageAdversaire).
    perte_apres_s: float = 5.0
    # Distance de sécurité du test de menace (mm). Héritée.
    rayon_securite_mm: float = 350.0
    # Déplacement plus court que cela (mm) : pas de direction, pas de menace. Valeur du moteur (oppBlocks, engine.js), pas de la spec.
    deplacement_min_mm: float = 20.0


class KalmanFilter2D:
    """Filtre de Kalman : état [x, y, vx, vy], mesure [x, y] (mm, mm/s)."""

    def __init__(self, params: ParamsLidar = ParamsLidar()):
        self.params = params
        dt = params.dt_nominal_s
        self.x = np.zeros(4, dtype=np.float64)
        self.F = np.array([[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]], dtype=np.float64)
        self.H = np.array([[1, 0, 0, 0], [0, 1, 0, 0]], dtype=np.float64)
        self.P = np.eye(4) * params.p0
        self.Q = np.diag([params.q_pos, params.q_pos, params.q_vel, params.q_vel]).astype(np.float64)
        self.R = np.eye(2) * params.r_mesure
        self.initialized = False

    def predict(self, dt: Optional[float] = None) -> np.ndarray:
        if dt is not None and dt > 0:
            self.F[0, 2] = dt
            self.F[1, 3] = dt
        self.x = self.F @ self.x
        self.P = self.F @ self.P @ self.F.T + self.Q
        return self.x

    def update(self, z: np.ndarray) -> np.ndarray:
        if not self.initialized:
            self.x[:2] = z
            self.x[2:] = 0.0
            self.initialized = True
            return self.x
        y = z - self.H @ self.x
        S = self.H @ self.P @ self.H.T + self.R
        K = self.P @ self.H.T @ np.linalg.inv(S)
        self.x = self.x + K @ y
        self.P = (np.eye(4) - K @ self.H) @ self.P
        return self.x


class LidarTracker:
    """Acquisition et suivi de l'adversaire.

    `source_scan` : fonction sans argument qui renvoie le dernier scan [(angle_deg, dist_mm), ...] ou None. Le pilote du lidar
    (RPLidar, YDLidar...) n'est pas décrit dans la spec : il n'est pas fourni ici (point ouvert).
    `horloge` : secondes (monotone) ; en test, une fonction contrôlée.
    """

    def __init__(self, port: str = "/dev/ttyUSB_LIDAR", baudrate: int = 115200, mock: bool = False,
                 params: ParamsLidar = ParamsLidar(), source_scan: Optional[Callable[[], Optional[Sequence[Tuple[float, float]]]]] = None,
                 horloge: Callable[[], float] = time.perf_counter):
        self.port = port
        self.baudrate = baudrate
        self.mock = mock
        self.params = params
        self.source_scan = source_scan
        self.horloge = horloge
        self.table_x = table_longueur_mm()
        self.table_y = table_largeur_mm()
        self.kalman = KalmanFilter2D(params)
        self.last_update_time = horloge()
        self.t_derniere_mesure: Optional[float] = None
        self.opp_pose = (0.0, 0.0)
        self.opp_vel = (0.0, 0.0)
        self.opp_detected = False

    def reset(self) -> None:
        self.kalman = KalmanFilter2D(self.params)
        self.t_derniere_mesure = None
        self.opp_detected = False
        self.last_update_time = self.horloge()

    # ---- traitement d'un scan ---------------------------------------------------------------------------------------
    def _points_table(self, scan: Sequence[Tuple[float, float]], robot_pose: Tuple[float, float, float]) -> np.ndarray:
        p = self.params
        rx, ry, rth = robot_pose
        pts: List[Tuple[float, float]] = []
        for angle_deg, dist_mm in scan:
            if dist_mm < p.portee_min_mm or dist_mm > p.portee_max_mm:
                continue
            phi = math.radians(rth + p.sens_angle * angle_deg + p.decalage_angle_deg)
            px, py = rx + dist_mm * math.cos(phi), ry + dist_mm * math.sin(phi)
            if px < p.marge_bord_mm or px > self.table_x - p.marge_bord_mm or py < p.marge_bord_mm or py > self.table_y - p.marge_bord_mm:
                continue
            pts.append((px, py))
        return np.array(pts, dtype=np.float64).reshape(-1, 2)

    def process_scan(self, scan_points: Sequence[Tuple[float, float]], robot_pose: Tuple[float, float, float],
                     t: Optional[float] = None) -> Tuple[float, float, float, float]:
        """Traite un scan brut [(angle_deg, dist_mm), ...] et renvoie (x, y, vx, vy) de l'adversaire (mm, mm/s).

        robot_pose : (x, y, cap) de notre robot dans le repère réel de la table (cap en degrés).
        Les statiques de la table (nos constructions, pierres posées) ne sont pas filtrés : point ouvert (voir le rapport).
        """
        now = self.horloge() if t is None else t
        dt = max(self.params.dt_min_s, min(self.params.dt_max_s, now - self.last_update_time))
        self.last_update_time = now
        self.kalman.predict(dt=dt)
        if scan_points is not None and len(scan_points) and not self.mock:
            pts = self._points_table(scan_points, robot_pose)
            if len(pts):
                if self.kalman.initialized:
                    d = np.hypot(pts[:, 0] - self.kalman.x[0], pts[:, 1] - self.kalman.x[1])
                    proches = d < self.params.rayon_porte_mm
                    cluster = pts[proches] if proches.any() else pts
                else:
                    cluster = pts
                corrige = self.kalman.update(np.median(cluster, axis=0))
                self.opp_pose = (float(corrige[0]), float(corrige[1]))
                self.opp_vel = (float(corrige[2]), float(corrige[3]))
                self.opp_detected = True
                self.t_derniere_mesure = now
                return self.opp_pose[0], self.opp_pose[1], self.opp_vel[0], self.opp_vel[1]
        self.opp_detected = False
        x, y, vx, vy = self.kalman.x
        return float(x), float(y), float(vx), float(vy)

    def mise_a_jour(self, robot_pose: Tuple[float, float, float], t: Optional[float] = None) -> None:
        """Lit le dernier scan de `source_scan` (s'il existe) et met le suivi à jour."""
        scan = self.source_scan() if self.source_scan else None
        self.process_scan(scan or [], robot_pose, t)

    # ---- sortie pour la croyance ------------------------------------------------------------------------------------
    def adversaire(self, t_match: float, t_horloge: Optional[float] = None) -> Optional[Dict[str, float]]:
        """Champ `adversaire` de la croyance : { x, y, vx, vy, t } en repère réel, `t` = instant de match de la dernière
        mesure. None si l'adversaire n'a jamais été vu ou si la mesure date de plus de `perte_apres_s`."""
        if self.t_derniere_mesure is None or not self.kalman.initialized:
            return None
        now = self.horloge() if t_horloge is None else t_horloge
        age = now - self.t_derniere_mesure
        if age > self.params.perte_apres_s:
            return None
        x, y, vx, vy = (float(v) for v in self.kalman.x)
        return {"x": x, "y": y, "vx": vx, "vy": vy, "t": t_match - age}

    def menace_sur_trajet(self, pose_xy: Tuple[float, float], cible_xy: Tuple[float, float], rayon_mm: Optional[float] = None) -> bool:
        """Évitement décidé par le Pi : vrai si l'adversaire détecté est à moins de `rayon_mm` (défaut : rayon_securite_mm) de notre
        robot ET devant lui, dans le sens du déplacement vers `cible_xy`. Même critère que le moteur (`oppBlocks`, engine.js : adversaire
        proche et en avant ; ignoré si la cible est trop proche : `deplacement_min_mm`). Le lidar est supposé au centre du robot (hypothèse : montage non
        décrit). Repère réel de la table (mm)."""
        if not self.opp_detected:
            return False
        r = self.params.rayon_securite_mm if rayon_mm is None else rayon_mm
        dx, dy = self.opp_pose[0] - pose_xy[0], self.opp_pose[1] - pose_xy[1]
        mx, my = cible_xy[0] - pose_xy[0], cible_xy[1] - pose_xy[1]
        m = math.hypot(mx, my)
        if m < self.params.deplacement_min_mm or math.hypot(dx, dy) > r:
            return False
        return (dx * mx + dy * my) / m > 0.0

    def check_collision_threat(self, target_pose: Tuple[float, float], safety_radius: Optional[float] = None) -> bool:
        """Vrai si la cible est à moins de `safety_radius` (défaut : rayon_securite_mm) de l'adversaire détecté."""
        if not self.opp_detected:
            return False
        r = self.params.rayon_securite_mm if safety_radius is None else safety_radius
        return math.hypot(target_pose[0] - self.opp_pose[0], target_pose[1] - self.opp_pose[1]) < r
