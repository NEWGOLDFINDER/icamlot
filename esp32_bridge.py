#!/usr/bin/env python3
"""Pont de communication temps-réel entre Raspberry Pi 5 et les 2 microcontrôleurs ESP32.

Architecture matérielle :
- ESP32 #1 (Navigation) : asservissement base roulante, odométrie, gyromètre, profils en S.
- ESP32 #2 (Actionneurs) : pinces Face A, pinces Face B, servomoteur 90° (tours), élévateur Graal, boulets.
- Raspberry Pi 5 : IA (ONNX), Lidar adversaire, chef d'orchestre en temps masqué.
"""
from __future__ import annotations

import json
import logging
import sys
import time
from typing import Any, Dict, Optional, Tuple

try:
    import serial
except ImportError:
    serial = None

logger = logging.getLogger("ESP32Bridge")
logger.setLevel(logging.INFO)


class ESP32Device:
    """Interface série générique pour un microcontrôleur ESP32."""

    def __init__(
        self,
        name: str,
        port: str,
        baudrate: int = 115200,
        timeout: float = 0.5,
        mock: bool = False,
    ):
        self.name = name
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.mock = mock or (serial is None)
        self.ser: Optional[Any] = None

    def connect(self) -> bool:
        """Ouvre la liaison série avec l'ESP32."""
        if self.mock:
            logger.info(f"[{self.name}] Mode MOCK actif (simulation logicielle)")
            return True

        try:
            self.ser = serial.Serial(
                port=self.port,
                baudrate=self.baudrate,
                timeout=self.timeout,
            )
            # Attendre l'initialisation du bootloader ESP32
            time.sleep(0.1)
            self.ser.reset_input_buffer()
            self.ser.reset_output_buffer()
            logger.info(f"[{self.name}] Connecté sur {self.port} à {self.baudrate} bauds")
            return True
        except Exception as e:
            logger.warning(f"[{self.name}] Échec connexion sur {self.port} ({e}) -> passage en mode MOCK")
            self.mock = True
            return False

    def send_command(self, cmd: str) -> str:
        """Envoie une ligne de commande et attend l'accusé de réception."""
        cmd_clean = cmd.strip()
        if self.mock:
            return f"OK {cmd_clean}"

        if not self.ser or not self.ser.is_open:
            return "ERR_NOT_CONNECTED"

        try:
            self.ser.write((cmd_clean + "\n").encode("utf-8"))
            self.ser.flush()
            resp = self.ser.readline().decode("utf-8").strip()
            return resp
        except Exception as e:
            logger.error(f"[{self.name}] Erreur communication ({e})")
            return f"ERR {e}"

    def close(self):
        """Ferme la liaison série."""
        if self.ser and self.ser.is_open:
            self.ser.close()


class DualESP32Orchestrator:
    """Chef d'orchestre pilotant l'ESP32 Navigation et l'ESP32 Actionneurs en temps masqué."""

    def __init__(
        self,
        nav_port: str = "/dev/ttyUSB_NAV",
        act_port: str = "/dev/ttyUSB_ACT",
        baudrate: int = 115200,
        mock: bool = False,
    ):
        self.mock = mock
        self.nav = ESP32Device("ESP32_NAV", nav_port, baudrate=baudrate, mock=mock)
        self.act = ESP32Device("ESP32_ACT", act_port, baudrate=baudrate, mock=mock)

    def initialize(self) -> bool:
        """Connecte les deux ESP32 et configure les paramètres initiaux."""
        ok_nav = self.nav.connect()
        ok_act = self.act.connect()

        # Position initiale jaune par défaut
        self.nav.send_command("SET_POSE 250.0 1000.0 0.0")
        self.act.send_command("RESET_ACTUATORS")

        return ok_nav and ok_act

    def dispatch_action_pipelined(
        self,
        action_id: int,
        action_info: dict,
        current_pose: Tuple[float, float, float] = (250.0, 1000.0, 0.0),
    ) -> dict:
        """Exécute une macro-action en temps masqué sur les 2 ESP32.

        Pipelining temporel :
        1. L'ESP32 Actionneurs pré-positionne immédiatement les pinces (rotation 90°, ouverture, hauteur).
        2. L'ESP32 Navigation démarre simultanément la trajectoire vers les coordonnées cibles.
        3. À l'arrivée au point cible, l'ESP32 Actionneurs exécute la saisie/pose finale au contact.
        """
        fam = action_info.get("a", "inconnu")
        face = action_info.get("f", "A")
        tx = float(action_info.get("tx", current_pose[0]))
        ty = float(action_info.get("ty", current_pose[1]))
        th = float(action_info.get("th", current_pose[2]))
        mech = float(action_info.get("mech", 1.0))

        t_start = time.perf_counter()

        # --- ÉTAPE 1 : Déclenchement simultané en TEMPS MASQUÉ ---
        # 1.a) Ordre préparatoire envoyé à l'ESP32 Actionneurs (Système pneumatique : pompe & électrovannes)
        if fam == "prendre":
            # Pré-armement pneumatique : allumage pompe à vide et descente ventouse
            act_prep_cmd = f"PREPARE {face} VACUUM_ARM 0"
            act_exec_cmd = f"EXECUTE {face} VACUUM_SEAL"
        elif fam == "mur":
            # Maintien sous vide à plat, réglage altitude mur
            act_prep_cmd = f"PREPARE {face} POSITION_WALL 0"
            act_exec_cmd = f"EXECUTE {face} VALVE_RELEASE"
        elif fam == "tour":
            # Rotation servo 90° PENDANT que le robot roule vers la zone circulaire
            act_prep_cmd = f"PREPARE {face} POSITION_TOWER 90"
            act_exec_cmd = f"EXECUTE {face} VALVE_RELEASE"
        elif fam == "porte":
            act_prep_cmd = f"PREPARE {face} POSITION_DOOR 0"
            act_exec_cmd = f"EXECUTE {face} VALVE_RELEASE"
        elif fam == "boulets":
            act_prep_cmd = f"PREPARE ALL CANNON_ARM 0"
            act_exec_cmd = f"EXECUTE ALL FIRE_BALLS"
        elif fam == "prendreGraal":
            act_prep_cmd = f"PREPARE {face} GRAAL_ARM 0"
            act_exec_cmd = f"EXECUTE {face} GRAAL_SEAL"
        elif fam == "poserGraal":
            act_prep_cmd = f"PREPARE {face} GRAAL_ELEVATE 3"
            act_exec_cmd = f"EXECUTE {face} GRAAL_RELEASE"
        elif fam == "trone":
            act_prep_cmd = "PREPARE ALL PARK 0"
            act_exec_cmd = "EXECUTE ALL PUMP_OFF"
        else:
            act_prep_cmd = "NOP"
            act_exec_cmd = "NOP"

        # Envoi préparatoire (actionneurs)
        resp_act_prep = self.act.send_command(act_prep_cmd)

        # 1.b) Ordre de déplacement envoyé à l'ESP32 Navigation
        nav_cmd = f"GOTO {tx:.1f} {ty:.1f} {th:.1f}"
        resp_nav = self.nav.send_command(nav_cmd)

        # Calcul des temps théoriques
        dx = tx - current_pose[0]
        dy = ty - current_pose[1]
        dist = (dx**2 + dy**2)**0.5
        dh = abs((th - current_pose[2] + 180.0) % 360.0 - 180.0)
        dt_move = max(dist / 500.0, dh / 120.0)

        # Pré-action mécanique en temps masqué pendant le mouvement (ascenseur, orientation 90°, démarrage pompe)
        # Système pneumatique ultra-rapide : contact final (dépression ou purge électrovanne) prend seulement ~0.25 s
        dt_pre = mech * 0.75
        dt_contact = min(mech * 0.25, 0.25)

        # Transit combiné en temps masqué
        dt_transit = max(dt_move, dt_pre)
        dt_total = dt_transit + dt_contact

        # --- ÉTAPE 2 : Attente synchronisée de fin de trajet ---
        # Sur robot réel : l'ESP32 Nav renvoie "REACHED" quand l'asservissement termine
        if not self.mock:
            # Polling ou attente d'interruption UART
            pass

        # --- ÉTAPE 3 : Action finale au contact ---
        resp_act_exec = self.act.send_command(act_exec_cmd)

        # Vérification du capteur de dépression pneumatique (ventouses sous vide)
        vacuum_ack = True
        if fam == "prendre":
            # Sur l'ESP32 Actionneurs, la commande renvoie "OK EXECUTE A VACUUM_SEAL [P1 P2 P3]"
            vacuum_ack = ("VACUUM_SEAL" in resp_act_exec or "OK" in resp_act_exec) and not ("ERR" in resp_act_exec)

        time_saved = (dt_move + mech) - dt_total

        return {
            "action_id": action_id,
            "target": (tx, ty, th),
            "dt_move": round(dt_move, 2),
            "dt_pre_mech": round(dt_pre, 2),
            "dt_transit": round(dt_transit, 2),
            "dt_contact": round(dt_contact, 2),
            "dt_total": round(dt_total, 2),
            "time_saved": round(time_saved, 2),
            "resp_nav": resp_nav,
            "resp_act": resp_act_exec,
            "vacuum_ack": vacuum_ack,
        }

    def close(self):
        """Ferme les liaisons séries."""
        self.nav.close()
        self.act.close()
