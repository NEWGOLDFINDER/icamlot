"""Miroir de l'équipe bleue (docs/CONTRATS.md §15), identique à ENGINE.mirrorCap / ENGINE.mirrorFace (engine/engine.js).

Le robot n'est pas symétrique : faces A, B, C à h, h + 120°, h + 240° (spec/robot.json, repere.angle_0). Le miroir de la table
(x -> longueur - x) change l'ordre cyclique (A, B, C) en (A, C, B) ; en échangeant A et B on retrouve celui du vrai robot.
Repère de l'équipe bleue (celui du modèle interne et du réseau, toujours « jaune ») :
  - la face A de l'équipe est la VRAIE face B (et inversement) ; la face C reste C ;
  - le cap de l'équipe est celui de cette face mis en miroir : h_équipe = 180 - (h_réel + ECART_FACES_DEG) (involutif) ;
  - x -> longueur - x.
Asymétrie résiduelle : disposition interne des faces (canon à gauche et ascenseur à droite sur C ; pierres décalées à gauche par
une nacelle à 90°) ; le modèle interne du Pi, en repère jaune, les voit donc en miroir (voir §15, points ouverts).
"""
from __future__ import annotations

from typing import Tuple

from embarque.spec import table_longueur_mm

# spec/robot.json, repere.angle_0 : « normale de la face A ; faces B et C à +120° et +240° » (texte, pas de champ numérique).
# Même valeur que ENGINE.ECART_FACES (vérifié par tests/test_embarque_pont.py via la commande hello du pont).
ECART_FACES_DEG = 120.0


def cap_miroir(h: float) -> float:
    """Cap réel <-> cap de l'équipe bleue (involutif)."""
    return 180.0 - ECART_FACES_DEG - h


def face_miroir(f: str) -> str:
    """Face réelle <-> face de l'équipe bleue : A <-> B, C inchangée."""
    return {"A": "B", "B": "A"}.get(f, f)


def face_reelle(f: str, equipe: str) -> str:
    return face_miroir(f) if equipe == "blue" else f


def pose_miroir(x: float, y: float, h: float, equipe: str, longueur: float = None) -> Tuple[float, float, float]:
    """Pose réelle <-> pose dans le repère de l'équipe (involutif) ; identité pour le jaune."""
    if equipe != "blue":
        return x, y, h
    L = table_longueur_mm() if longueur is None else longueur
    return L - x, y, cap_miroir(h)
