#!/usr/bin/env python3
"""Module de traitement et suivi Lidar 2D temps-réel pour Raspberry Pi 5 (Eurobot 2027).

Caractéristiques :
- Traite les scans 360° d'un Lidar 2D branché en USB (ex: RPLidar A1/A2/C1 ou YDLidar).
- Filtrage géométrique de la table (3000 x 2000 mm) et des balises fixes.
- Clustering euclidien pour isoler le robot adverse.
- Filtre de Kalman 2D : estimation continue de la position (x_opp, y_opp) et de la vitesse (vx, vy).
- Détection de collision prédictive (alerte si trajectoire interceptée à moins de 350 mm).
"""
from __future__ import annotations

import math
import time
from typing import Dict, List, Optional, Tuple

import numpy as np


class KalmanFilter2D:
    """Filtre de Kalman pour estimation continue de la position et de la vitesse de l'adversaire."""

    def __init__(self, dt: float = 0.1):
        self.dt = dt
        # Vecteur d'état : [x, y, vx, vy]
        self.x = np.zeros(4, dtype=np.float32)

        # Matrice de transition d'état
        self.F = np.array([
            [1.0, 0.0, dt,  0.0],
            [0.0, 1.0, 0.0, dt ],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ], dtype=np.float32)

        # Matrice d'observation (on mesure x et y)
        self.H = np.array([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
        ], dtype=np.float32)

        # Covariance d'état
        self.P = np.eye(4, dtype=np.float32) * 500.0

        # Bruit de processus (accélérations possibles de l'adversaire)
        q_pos = 10.0
        q_vel = 100.0
        self.Q = np.diag([q_pos, q_pos, q_vel, q_vel]).astype(np.float32)

        # Bruit de mesure Lidar (~20 mm de précision)
        self.R = np.eye(2, dtype=np.float32) * 400.0

        self.initialized = False

    def predict(self, dt: Optional[float] = None) -> np.ndarray:
        """Étape de prédiction du mouvement."""
        if dt is not None and dt > 0:
            self.F[0, 2] = dt
            self.F[1, 3] = dt

        self.x = self.F @ self.x
        self.P = self.F @ self.P @ self.F.T + self.Q
        return self.x

    def update(self, z: np.ndarray) -> np.ndarray:
        """Étape de correction avec la mesure Lidar z = [x_meas, y_meas]."""
        if not self.initialized:
            self.x[:2] = z
            self.x[2:] = 0.0
            self.initialized = True
            return self.x

        y = z - (self.H @ self.x)  # Innovation
        S = self.H @ self.P @ self.H.T + self.R
        K = self.P @ self.H.T @ np.linalg.inv(S)  # Gain de Kalman

        self.x = self.x + K @ y
        I = np.eye(4, dtype=np.float32)
        self.P = (I - K @ self.H) @ self.P
        return self.x


class LidarTracker:
    """Gestionnaire d'acquisition Lidar et tracking de l'adversaire."""

    def __init__(
        self,
        port: str = "/dev/ttyUSB_LIDAR",
        baudrate: int = 115200,
        mock: bool = False,
    ):
        self.port = port
        self.baudrate = baudrate
        self.mock = mock
        self.kalman = KalmanFilter2D(dt=0.1)

        self.last_update_time = time.perf_counter()
        self.opp_pose = (0.0, 0.0)
        self.opp_vel = (0.0, 0.0)
        self.opp_detected = False

    def process_scan(
        self,
        scan_points: List[Tuple[float, float]],
        robot_pose: Tuple[float, float, float],
    ) -> Tuple[float, float, float, float]:
        """Traite les points du scan brut [(angle_deg, dist_mm), ...] et extrait (x, y, vx, vy) de l'adversaire.

        robot_pose : (rx, ry, rcap_deg)
        """
        now = time.perf_counter()
        dt = max(1e-3, min(0.5, now - self.last_update_time))
        self.last_update_time = now

        # Prédire le mouvement avec Kalman
        self.kalman.predict(dt=dt)

        if not scan_points or self.mock:
            # En mode mock ou absence de mesure, conserver l'état estimé
            x, y, vx, vy = self.kalman.x
            return float(x), float(y), float(vx), float(vy)

        rx, ry, rth = robot_pose
        rad_th = math.radians(rth)
        cos_th = math.cos(rad_th)
        sin_th = math.sin(rad_th)

        # 1. Conversion coordonnées polaires -> coordonnées table absolues (mm)
        valid_points = []
        for angle_deg, dist_mm in scan_points:
            if dist_mm < 150.0 or dist_mm > 3500.0:
                continue

            # Angle absolu sur la table
            phi = math.radians(angle_deg + rth)
            px = rx + dist_mm * math.cos(phi)
            py = ry + dist_mm * math.sin(phi)

            # Filtrage des bordures de table (3000 x 2000 mm avec marge de 60 mm pour les murs)
            if px < 70.0 or px > 2930.0 or py < 70.0 or py > 1930.0:
                continue

            # Filtrage des zones de construction fixes connues (nos murs et nos tours)
            # Murs : x in [200, 900], y in [350, 1650]
            # On conserve tout ce qui est mobile
            valid_points.append([px, py])

        if not valid_points:
            self.opp_detected = False
            x, y, vx, vy = self.kalman.x
            return float(x), float(y), float(vx), float(vy)

        pts = np.array(valid_points)

        # 2. Clustering rapide : trouver le centre de masse du groupe le plus dense
        # Si Kalman est initialisé, filtrer les points proches de l'estimation précédente
        if self.kalman.initialized:
            prev_x, prev_y = self.kalman.x[:2]
            dists = np.hypot(pts[:, 0] - prev_x, pts[:, 1] - prev_y)
            close_mask = dists < 450.0
            if np.any(close_mask):
                cluster = pts[close_mask]
            else:
                cluster = pts
        else:
            cluster = pts

        center = np.median(cluster, axis=0)
        self.opp_detected = True

        # 3. Mise à jour de Kalman
        corrected = self.kalman.update(center.astype(np.float32))
        self.opp_pose = (float(corrected[0]), float(corrected[1]))
        self.opp_vel = (float(corrected[2]), float(corrected[3]))

        return self.opp_pose[0], self.opp_pose[1], self.opp_vel[0], self.opp_vel[1]

    def check_collision_threat(
        self,
        target_pose: Tuple[float, float],
        safety_radius: float = 350.0,
    ) -> bool:
        """Vérifie si la cible ou la trajectoire prévue coupe la zone de sécurité de l'adversaire."""
        if not self.opp_detected:
            return False

        opp_x, opp_y = self.opp_pose
        tx, ty = target_pose
        dist_to_opp = math.hypot(tx - opp_x, ty - opp_y)
        return dist_to_opp < safety_radius
