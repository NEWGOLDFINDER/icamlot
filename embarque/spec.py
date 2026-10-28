"""Valeurs de spec/regles_2027.json utilisées côté Python (aucun nombre du règlement n'est recopié dans le code)."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REGLES = ROOT / "spec" / "regles_2027.json"


@lru_cache(maxsize=1)
def regles() -> dict:
    return json.loads(REGLES.read_text(encoding="utf-8"))


def table_longueur_mm() -> float:
    """Longueur X de la table : sert au miroir bleu/jaune (x -> longueur - x)."""
    return float(regles()["table"]["longueur_x"])


def table_largeur_mm() -> float:
    return float(regles()["table"]["largeur_y"])


def duree_match_s() -> float:
    return float(regles()["match"]["duree_s"])


def phase_attaque_debut_s() -> float:
    return float(regles()["match"]["phase_attaque_debut_s"])
