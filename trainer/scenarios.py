"""Scénarios d'entraînement et d'évaluation : adversaire, intensité, graine.

Un scénario est l'objet passé à `ENV.reset(scenario)` (engine/env.js) :
  { seed, intensite, opponentRef? }   où opponentRef désigne un adversaire enregistré dans le pool
  (`JsEnvPool.set_opponents`), soit une stratégie enregistrée { program, params }, soit un cerveau MLP { brain }.

Intensités reconnues par le moteur (ENGINE.intensityParams) : « aucun », « faible », « realiste », « agressif ».
« aucun » = pas d'adversaire.

Équipe (docs/CONTRATS.md §17) : chaque scénario porte `equipe` = « yellow » | « blue » (équipe de NOTRE robot ; l'adversaire joue
l'autre). Entraînement : tirée par la graine du scénario, avec la proportion `part_bleu` (défaut 50 %, `PART_BLEU_DEFAUT`).
Évaluation (`fixed`) : répartition déterministe et équilibrée dans chaque adversaire (pas de tirage), pour que les deux couleurs
soient comparées sur les mêmes adversaires.
"""
from __future__ import annotations

import json
import math
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

JAUNE, BLEU = "yellow", "blue"
EQUIPES = (JAUNE, BLEU)
# Proportion de scénarios joués en bleu (décision de l'équipe : 50 %) ; 0 = jaune seul (ancien comportement), 1 = bleu seul.
PART_BLEU_DEFAUT = 0.5


def normaliser_part_bleu(part) -> float:
    p = PART_BLEU_DEFAUT if part is None else float(part)
    if not 0.0 <= p <= 1.0:
        raise ValueError(f"Proportion de matchs bleus hors de [0, 1] : {part}.")
    return p


def equipe_de_graine(seed: int, part_bleu: float = PART_BLEU_DEFAUT) -> str:
    """Équipe tirée par la graine du scénario (reproductible : même graine, même équipe)."""
    return BLEU if random.Random(f"equipe:{int(seed)}").random() < part_bleu else JAUNE


def equipe_equilibree(k: int, part_bleu: float = PART_BLEU_DEFAUT) -> str:
    """Équipe du k-ième match d'une suite répartie sans tirage : bleu si floor((k + 1) p) > floor(k p).
    Sur n matchs consécutifs, floor(n p) sont bleus (p = 0,5 : jaune, bleu, jaune, bleu…)."""
    return BLEU if math.floor((k + 1) * part_bleu + 1e-9) > math.floor(k * part_bleu + 1e-9) else JAUNE


def equipe_scenario(sc: Optional[dict]) -> str:
    """Équipe d'un scénario (jaune si le champ est absent : ancien format)."""
    return (sc or {}).get("equipe") or JAUNE


def critere_selection(ev: Optional[dict]) -> Optional[float]:
    """Critère du champion : moyenne des scores moyens jaune et bleu (docs/CONTRATS.md §17). Une seule couleur jouée (ancien
    rapport, ou proportion bleue 0 ou 1) : la moyenne de cette couleur."""
    if not ev:
        return None
    sel = ev.get("selection") or {}
    if sel.get("valeur") is not None:
        return float(sel["valeur"])
    return (ev.get("score") or {}).get("moyenne")


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
                 melange: Optional[Dict[str, float]] = None, part_bleu: Optional[float] = PART_BLEU_DEFAUT):
        for i in intensites:
            if i not in INTENSITES:
                raise ValueError(f"Intensité inconnue : {i} (attendu : {', '.join(INTENSITES)}).")
        self.opponents = list(opponents)
        self.intensites = list(intensites) or ["aucun"]
        self.rng = random.Random(seed)
        self.seed = seed
        # mélange d'adversaires (proportions) : prioritaire sur opponents / intensites pour sample() et fixed()
        self.melange = normaliser_melange(melange) if melange else None
        # proportion de scénarios joués en bleu (contrat §17)
        self.part_bleu = normaliser_part_bleu(part_bleu)

    def _equipe(self, seed: int, k: Optional[int] = None) -> str:
        """k donné : répartition équilibrée (évaluation) ; sinon tirage par la graine (entraînement)."""
        return equipe_equilibree(k, self.part_bleu) if k is not None else equipe_de_graine(seed, self.part_bleu)

    def _composante(self, seed: int, comp: str, k: Optional[int] = None) -> dict:
        eq = self._equipe(seed, k)
        if comp == "aucun":
            return {"seed": int(seed), "equipe": eq, "intensite": "aucun"}
        if comp == "reference":
            return {"seed": int(seed), "equipe": eq, "intensite": "realiste"}
        if comp in ROBOTS:
            return {"seed": int(seed), "equipe": eq, "intensite": "realiste", "opponent": {"robot": comp}}
        return {"seed": int(seed), "equipe": eq, "intensite": "realiste", "opponentRef": comp}

    def registry(self) -> Dict[str, dict]:
        return {o["id"]: o["spec"] for o in self.opponents}

    def _make(self, seed: int, intensite: str, opp: Optional[dict], k: Optional[int] = None) -> dict:
        eq = self._equipe(seed, k)
        if intensite == "aucun" or opp is None:
            return {"seed": int(seed), "equipe": eq, "intensite": "aucun"}
        return {"seed": int(seed), "equipe": eq, "intensite": intensite, "opponentRef": opp["id"]}

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
        Avec un mélange : n_k = part de chaque adversaire (plus forts restes), matchs entrelacés.
        Équipe : répartie (et non tirée) selon `part_bleu`, séparément pour chaque adversaire (déphasée d'un match par adversaire) :
        chaque adversaire est affronté dans les deux couleurs dès qu'il a au moins 2 matchs."""
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
            vus: Dict[str, int] = {}
            out = []
            for k, c in enumerate(seq):
                j = vus.get(c, 0)
                vus[c] = j + 1
                out.append(self._composante(base_seed + k, c, k=j + comps.index(c)))
            return out
        combos = [(i, o) for i in self.intensites for o in (self.opponents or [None])]
        return [self._make(base_seed + k, combos[k % len(combos)][0], combos[k % len(combos)][1],
                           k=k // len(combos) + k % len(combos)) for k in range(n)]

    def describe(self) -> dict:
        d = {"adversaires": [o["id"] for o in self.opponents], "intensites": self.intensites, "graine_tirage": self.seed,
             "part_bleu": self.part_bleu}
        if self.melange:
            d["melange"] = {k: round(v, 4) for k, v in self.melange.items()}
        return d
