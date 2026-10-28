"""Construction de la croyance (`belief`) du robot réel à partir de ses capteurs.

La croyance est l'entrée des fonctions pures du moteur (`ENV.observeBelief`, `ACTIONS.maskBelief`, `ACTIONS.toProgramStep` ;
documentation dans l'en-tête de engine/env.js). Le runner n'en réimplémente aucune : il remplit cette structure.

Origine de chaque champ :
  - pose                        : lidar (triangulation) ou, à défaut, odométrie de l'ESP32 NAV ;
  - adversaire                  : `lidar_tracker.LidarTracker.adversaire` ;
  - paquets (carrières)         : caméras des faces A et B (nombre de pierres vues et instant de la vue) ;
  - pierres étrangères          : caméras (même modèle) ;
  - état des pinces et mécanismes, pierres tenues, pierres posées, portes, Graal, séance de tir :
        MODÈLE INTERNE du robot, le moteur JS exécuté localement sur les briques envoyées (embarque/bridge.js : track_*),
        recoupé avec l'état renvoyé par l'ESP32 ACT (codeurs, dépression des ventouses) ;
  - échec de la dernière action : refus du moteur local (action impossible) ou erreur d'un ESP32.

Repère : la croyance est toujours construite dans le repère de l'ÉQUIPE (jaune), comme à l'entraînement où le robot est
toujours jaune. Les mesures de l'équipe bleue sont mises en miroir à l'entrée (embarque/miroir.py, docs/CONTRATS.md §15 :
x -> longueur - x, cap de la VRAIE face B mis en miroir h -> 180 - 120 - h, faces A <-> B pour l'état des pinces lu sur
l'ESP32, vx -> -vx, ids des paquets par ENGINE.mirrorId) ; les commandes ESP32 le sont en sortie (esp32_bridge.traduire :
la face A de l'équipe pilote la vraie face B).
"""
from __future__ import annotations

import copy
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol, Tuple

from embarque.miroir import face_reelle, pose_miroir, rot_reelle
from embarque.spec import table_longueur_mm

logger = logging.getLogger("Croyance")


@dataclass
class Mesures:
    """Lectures des capteurs à l'instant de la décision, en repère RÉEL de la table."""
    t: float                                           # horloge de match (s)
    pose: Tuple[float, float, float]                   # x, y (mm), cap de la normale de la face A (°)
    adversaire: Optional[Dict[str, float]] = None      # { x, y, vx, vy, t } ou None
    paquets: Dict[str, Dict[str, float]] = field(default_factory=dict)   # id réel -> { n, t } (caméras A et B)
    etrangeres: Optional[List[dict]] = None            # pierres posées par l'adversaire, vues par les caméras ; None = pas de lecture
    actionneurs: Any = None                            # esp32_bridge.EtatActionneurs ou None


class Capteurs(Protocol):
    def lire(self, t: float) -> Mesures:
        """Lit tous les capteurs ; t = horloge de match."""


class CamerasAbsentes:
    """Caméras A et B non branchées : aucune mise à jour des paquets (le robot garde la connaissance du règlement et ce qu'il a pris)."""

    def paquets(self) -> Dict[str, Dict[str, float]]:
        return {}

    def etrangeres(self) -> Optional[List[dict]]:
        return None


def miroir_pose(pose: Tuple[float, float, float], equipe: str) -> Tuple[float, float, float]:
    """Pose réelle <-> pose dans le repère de l'équipe (involutif) : bleu, x -> longueur - x et cap de la vraie face B en miroir."""
    return pose_miroir(pose[0], pose[1], pose[2], equipe)


def miroir_adversaire(adv: Optional[dict], equipe: str) -> Optional[dict]:
    if adv is None or equipe != "blue":
        return adv
    out = dict(adv)
    out["x"] = table_longueur_mm() - adv["x"]
    out["vx"] = -adv.get("vx", 0.0)
    return out


# Caractéristiques physiques de notre robot (observation « physique », icamlot-obs-3.1, docs/CONTRATS.md §14) : clés du moteur
# (ADVERSAIRES.clesPhysiques dans engine/adversaires.js), en unités du moteur (v et va en m/s, w en °/s, vz en mm/s, durées en s,
# brate en boulets/s). Sans fichier de calibration, le modèle interne garde les valeurs de la spec.
CLES_PHYSIQUES = ("v", "va", "w", "vz", "trot", "tvac", "trel", "tMonteeGraal", "tDescenteFourche", "bdep", "bspin", "brate")


def params_calibration(chemin: Optional[str]) -> dict:
    """Valeurs mesurées sur le robot (fichier JSON { clé: valeur }, unités du moteur), pour le modèle interne et donc pour
    belief.params (observation « physique », masque). Clés inconnues ignorées ; la descente de la fourche suit la montée du Graal
    si elle n'est pas donnée (hypothèse du moteur)."""
    if not chemin:
        return {}
    import json
    with open(chemin, encoding="utf-8") as fh:
        j = json.load(fh)
    out = {k: float(v) for k, v in j.items() if k in CLES_PHYSIQUES and isinstance(v, (int, float)) and v >= 0}
    if "tMonteeGraal" in out and "tDescenteFourche" not in out:
        out["tDescenteFourche"] = out["tMonteeGraal"]
    return out


class ConstructeurCroyance:
    """Fusionne le modèle interne (moteur local) et les mesures des capteurs en une croyance pour le réseau."""

    def __init__(self, pont: Any, equipe: str = "yellow", params_moteur: Optional[dict] = None):
        self.pont = pont
        self.equipe = equipe
        self.params_moteur = params_moteur or {}
        self.interne: dict = {}
        self.echec = False
        self.divergences: List[str] = []
        self.historique_divergences: List[str] = []

    def demarrer(self) -> dict:
        """Crée le modèle interne. vision=False : les caméras sont réelles, le modèle de caméras simulé du moteur est coupé."""
        # bleu : moteur bleu en repère réel (vraie disposition des faces), croyance rendue dans le repère de l'équipe (§15)
        self.interne = self.pont.track_start(self.params_moteur, vision=False, equipe=self.equipe)["belief"]
        self.echec = False
        return self.interne

    def appliquer(self, brique: dict, adversaire: Optional[dict] = None) -> dict:
        """Exécute la brique sur le modèle interne ; renvoie { info, plan, belief }. Le plan est celui que les ESP32 reproduisent."""
        r = self.pont.track_exec(brique, adversaire)
        self.interne = r["belief"]
        self.echec = bool(r["info"].get("err"))
        return r

    # ---- fusion -----------------------------------------------------------------------------------------------------
    def croyance(self, m: Mesures, echec_materiel: bool = False) -> dict:
        b = copy.deepcopy(self.interne)
        t_int = b["t"]
        b["t"] = m.t
        x, y, h = miroir_pose(m.pose, self.equipe)
        b["pose"] = {"x": x, "y": y, "h": h}
        b["adversaire"] = miroir_adversaire(m.adversaire, self.equipe)
        # paquets : la mesure la plus récente l'emporte (le modèle interne ne change un paquet que pour ce que le robot a pris)
        if m.paquets:
            ids = list(m.paquets)
            vers_equipe = dict(zip(ids, self.pont.mirror_ids(ids))) if self.equipe == "blue" else {i: i for i in ids}
            for rid, obs in m.paquets.items():
                pid = vers_equipe[rid]
                cur = b["paquets"].get(pid)
                if cur is None or obs["t"] >= cur["t"]:
                    b["paquets"][pid] = {"n": obs["n"], "t": obs["t"]}
        if m.etrangeres is not None:
            b["etrangeres"] = [self._etrangere_equipe(o) for o in m.etrangeres]
        # un échec constaté « à cet instant » masque la brique tant que le temps n'avance pas : l'instant est celui du robot
        if b.get("echecs") and b["echecs"].get("t") == t_int:
            b["echecs"]["t"] = m.t
        b["echec"] = bool(b.get("echec")) or echec_materiel
        # recoupement avec les codeurs et les capteurs de dépression des ESP32
        self.divergences = self._recouper(b, m.actionneurs) if m.actionneurs is not None else []
        if any(d.startswith("perte:") for d in self.divergences):
            b["echec"] = True
        self.historique_divergences += self.divergences
        for d in self.divergences:
            logger.warning("Écart modèle interne / ESP32 : %s", d)
        return b

    def _etrangere_equipe(self, o: dict) -> dict:
        if self.equipe != "blue":
            return o
        L = table_longueur_mm()
        out = dict(o)
        out["foot"] = [[L - v[0], v[1]] for v in o["foot"]]
        return out

    def _recouper(self, b: dict, st: Any, tol_hc_mm: float = 2.0, tol_rot_deg: float = 2.0) -> List[str]:
        """Écarts entre le modèle interne et l'état renvoyé par l'ESP32 ACT. tol_* : hypothèses de réglage (jeu des codeurs).
        Le modèle interne est en faces de l'équipe, l'ESP32 en faces réelles (bleu : face A de l'équipe = vraie face B, §15)."""
        out: List[str] = []
        tenues = 0
        for f in ("A", "B"):
            g = b["pinces"][f]
            hc, rot = st.grip[face_reelle(f, self.equipe)]
            if abs(hc - g["hc"]) > tol_hc_mm:
                out.append(f"hc {f} : modèle {g['hc']:.1f} mm, codeur {hc:.1f} mm")
            rot_attendue = rot_reelle(g["rotReelle"] if g.get("rotReelle") is not None else g["rot"], self.equipe)   # §16 : bleu, -θ
            if abs(rot - rot_attendue) > tol_rot_deg:
                out.append(f"rot {f} : modèle {rot_attendue:.1f}°, codeur {rot:.1f}°")
            tenues += sum(1 for v in st.tenue[face_reelle(f, self.equipe)] if v)
        modele = sum(1 for f in ("A", "B") for s in b["pinces"][f]["slots"] if s)
        if tenues < modele:
            out.append(f"perte: {modele} pierre(s) tenues dans le modèle, {tenues} avec dépression")
        return out
