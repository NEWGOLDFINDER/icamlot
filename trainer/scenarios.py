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

# Robots adverses (engine/adversaires.js, docs/CONTRATS.md §14) et mélange d'entraînement par défaut (décision de l'équipe) :
# 20 % de chacun des 4 robots + 20 % de self-play (« self » : notre réseau courant, ou un champion précédent).
ROBOTS = ("batisseur", "razzia", "champion", "intermediaire")
MELANGE_DEFAUT = {"batisseur": 0.2, "razzia": 0.2, "champion": 0.2, "intermediaire": 0.2, "self": 0.2}
# autres composantes acceptées : « reference » (programme de référence en miroir), « aucun » (seul sur la table),
# et l'id d'un adversaire enregistré (stratégie « strategie:<nom> », cerveau…)
SELF = "self"


def normaliser_melange(melange: Optional[Dict[str, float]]) -> Dict[str, float]:
    """Proportions positives ramenées à une somme de 1 (composantes nulles retirées)."""
    m = {str(k): float(v) for k, v in (melange or {}).items() if v is not None and float(v) > 0}
    tot = sum(m.values())
    if tot <= 0:
        raise ValueError("Mélange d'adversaires vide : au moins une proportion > 0.")
    return {k: v / tot for k, v in m.items()}


def cle_scenario(sc: Optional[dict]) -> str:
    """Libellé de l'adversaire d'un scénario (rapport par adversaire de l'évaluation)."""
    sc = sc or {}
    if (sc.get("intensite") or "aucun") == "aucun":
        return "sans adversaire"
    opp = sc.get("opponent") or {}
    if opp.get("robot"):
        return "robot:" + str(opp["robot"])
    if sc.get("opponentRef"):
        return str(sc["opponentRef"])
    return "reference"


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

    def __init__(self, opponents: Sequence[dict] = (), intensites: Sequence[str] = ("aucun",), seed: int = 1,
                 melange: Optional[Dict[str, float]] = None):
        for i in intensites:
            if i not in INTENSITES:
                raise ValueError(f"Intensité inconnue : {i} (attendu : {', '.join(INTENSITES)}).")
        self.opponents = list(opponents)
        self.intensites = list(intensites) or ["aucun"]
        self.rng = random.Random(seed)
        self.seed = seed
        # mélange d'adversaires (proportions) : prioritaire sur opponents / intensites pour sample() et fixed()
        self.melange = normaliser_melange(melange) if melange else None

    def _composante(self, seed: int, comp: str) -> dict:
        if comp == "aucun":
            return {"seed": int(seed), "intensite": "aucun"}
        if comp == "reference":
            return {"seed": int(seed), "intensite": "realiste"}
        if comp in ROBOTS:
            return {"seed": int(seed), "intensite": "realiste", "opponent": {"robot": comp}}
        return {"seed": int(seed), "intensite": "realiste", "opponentRef": comp}

    def registry(self) -> Dict[str, dict]:
        return {o["id"]: o["spec"] for o in self.opponents}

    def _make(self, seed: int, intensite: str, opp: Optional[dict]) -> dict:
        if intensite == "aucun" or opp is None:
            return {"seed": int(seed), "intensite": "aucun"}
        return {"seed": int(seed), "intensite": intensite, "opponentRef": opp["id"]}

    def sample(self) -> dict:
        if self.melange:
            comps, poids = list(self.melange), list(self.melange.values())
            comp = self.rng.choices(comps, weights=poids, k=1)[0]
            return self._composante(self.rng.randrange(1, 2**31 - 1), comp)
        intensite = self.rng.choice(self.intensites)
        opp = self.rng.choice(self.opponents) if self.opponents else None
        return self._make(self.rng.randrange(1, 2**31 - 1), intensite, opp)

    def fixed(self, n: int, base_seed: int = 10_000) -> List[dict]:
        """n scénarios déterministes (même liste à chaque appel) : adversaires et intensités en tourniquet.
        Sert à l'évaluation, pour que deux modèles soient comparés sur les mêmes matchs.
        Avec un mélange : n_k = part de chaque adversaire (plus forts restes), matchs entrelacés."""
        if self.melange:
            comps = list(self.melange)
            quotas = {c: int(n * self.melange[c]) for c in comps}
            reste = sorted(comps, key=lambda c: n * self.melange[c] - quotas[c], reverse=True)
            for c in reste[: n - sum(quotas.values())]:
                quotas[c] += 1
            seq: List[str] = []
            while len(seq) < n:
                for c in comps:
                    if quotas[c] > 0:
                        seq.append(c)
                        quotas[c] -= 1
            return [self._composante(base_seed + k, c) for k, c in enumerate(seq)]
        combos = [(i, o) for i in self.intensites for o in (self.opponents or [None])]
        return [self._make(base_seed + k, combos[k % len(combos)][0], combos[k % len(combos)][1]) for k in range(n)]

    def describe(self) -> dict:
        d = {"adversaires": [o["id"] for o in self.opponents], "intensites": self.intensites, "graine_tirage": self.seed}
        if self.melange:
            d["melange"] = {k: round(v, 4) for k, v in self.melange.items()}
        return d
