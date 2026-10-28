"""Scénarios d'entraînement et d'évaluation : adversaire, intensité, graine.

Un scénario est l'objet passé à `ENV.reset(scenario)` (engine/env.js) :
  { seed, intensite, opponentRef? }   où opponentRef désigne un adversaire enregistré dans le pool
  (`JsEnvPool.set_opponents`), soit une stratégie enregistrée { program, params }, soit un cerveau MLP { brain }.

Intensités reconnues par le moteur (ENGINE.intensityParams) : « aucun », « faible », « realiste », « agressif ».
« aucun » = pas d'adversaire.
"""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Dict, List, Optional, Sequence

INTENSITES = ("aucun", "faible", "realiste", "agressif")


def load_strategies(folder: Optional[Path]) -> List[dict]:
    """Stratégies enregistrées (format camelot-strategie : { name, params, program })."""
    out: List[dict] = []
    if not folder or not Path(folder).is_dir():
        return out
    for f in sorted(Path(folder).glob("*.json")):
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(j, dict) or not isinstance(j.get("program"), list) or not j["program"]:
            continue
        out.append({"id": "strategie:" + f.stem, "nom": j.get("name") or f.stem,
                    "spec": {"program": j["program"], "params": j.get("params") or {}}})
    return out


def load_strategy_file(path: Path) -> dict:
    j = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(j.get("program"), list):
        raise ValueError(f"{path} : pas de « program ».")
    return {"id": "strategie:" + Path(path).stem, "nom": j.get("name") or Path(path).stem,
            "spec": {"program": j["program"], "params": j.get("params") or {}}}


def brain_opponent(cerveau: dict, poids: dict, ident: str = "cerveau") -> dict:
    """Adversaire « cerveau » MLP pour ENV.brainAgent : { brain: { layers, acts, entrees, familles } }.
    cerveau : configuration camelot-cerveau ; poids : camelot-poids avec « layers » (w en [entrée][sortie])."""
    layers = poids.get("layers")
    if not layers:
        raise ValueError("Adversaire cerveau : il faut des poids MLP (« layers »). "
                         "Les cerveaux récurrents ne sont pas encore jouables comme adversaires par engine/env.js.")
    acts = [c.get("activation", "relu") for c in ((cerveau.get("reseau") or {}).get("couches") or [])]
    brain = {"layers": layers, "acts": acts}
    if cerveau.get("entrees"):
        brain["entrees"] = cerveau["entrees"]
    fam = (cerveau.get("actions") or {}).get("familles")
    if fam:
        brain["familles"] = fam
    return {"id": ident, "nom": cerveau.get("name") or ident, "spec": {"brain": brain}}


class ScenarioSampler:
    """Tire des scénarios : adversaire (tour à tour ou au hasard), intensité, graine.

    opponents : [{ id, nom, spec }] ; intensites : intensités à tirer (« aucun » = sans adversaire).
    Sans adversaire enregistré, toute intensité se ramène à « aucun ».
    """

    def __init__(self, opponents: Sequence[dict] = (), intensites: Sequence[str] = ("aucun",), seed: int = 1):
        for i in intensites:
            if i not in INTENSITES:
                raise ValueError(f"Intensité inconnue : {i} (attendu : {', '.join(INTENSITES)}).")
        self.opponents = list(opponents)
        self.intensites = list(intensites) or ["aucun"]
        self.rng = random.Random(seed)
        self.seed = seed

    def registry(self) -> Dict[str, dict]:
        return {o["id"]: o["spec"] for o in self.opponents}

    def _make(self, seed: int, intensite: str, opp: Optional[dict]) -> dict:
        if intensite == "aucun" or opp is None:
            return {"seed": int(seed), "intensite": "aucun"}
        return {"seed": int(seed), "intensite": intensite, "opponentRef": opp["id"]}

    def sample(self) -> dict:
        intensite = self.rng.choice(self.intensites)
        opp = self.rng.choice(self.opponents) if self.opponents else None
        return self._make(self.rng.randrange(1, 2**31 - 1), intensite, opp)

    def fixed(self, n: int, base_seed: int = 10_000) -> List[dict]:
        """n scénarios déterministes (même liste à chaque appel) : adversaires et intensités en tourniquet.
        Sert à l'évaluation, pour que deux modèles soient comparés sur les mêmes matchs."""
        combos = [(i, o) for i in self.intensites for o in (self.opponents or [None])]
        return [self._make(base_seed + k, combos[k % len(combos)][0], combos[k % len(combos)][1]) for k in range(n)]

    def describe(self) -> dict:
        return {"adversaires": [o["id"] for o in self.opponents], "intensites": self.intensites, "graine_tirage": self.seed}
