"""Utilitaires communs aux tests du chantier embarqué (tests/test_embarque_*.py)."""
from __future__ import annotations

import random
import subprocess
import sys
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Tolérance (s) des comparaisons d'instants : les plans viennent de flottants du moteur sérialisés en JSON (exacts) ; marge numérique.
EPS_T = 1e-6

# Axes du moteur, tels que les commandes les pilotent : base (GOTO / PATH), vérins Z (hc), rotations, ascenseur (fx, fz). La sortie du
# canon (CANON) n'est pas une commande : elle fait partie de la séance de tir (commande TIR).
GROUPES_MOUVEMENT = ("NAV", "Z_A", "ROT_A", "Z_B", "ROT_B", "ASC")
GROUPES_VERITE = GROUPES_MOUVEMENT + ("CANON",)


def exporter_petit_modele(dossier: Path, nom: str, epoques: int) -> Tuple[Path, Path]:
    """Entraîne et exporte un petit modèle récurrent (imitation du programme d'exemple, trainer/README.md) : (.onnx, .pt)."""
    base = dossier / nom
    cmd = [sys.executable, "-m", "trainer.imitation", "--exemple", "--scenarios", "2", "--epoques", str(epoques),
           "--hidden", "32", "--processus", "1", "--envs-par-processus", "1", "--sortie", str(base)]
    r = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        raise RuntimeError(f"export du modèle de test impossible :\n{r.stdout[-1500:]}\n{r.stderr[-1500:]}")
    return base.with_suffix(".onnx"), base.with_suffix(".pt")


# ---- vérité tirée des points clés bruts du moteur (indépendante de embarque/bridge.js : extractPlan) -------------------
def _vals(f: dict) -> Dict[str, Tuple[float, ...]]:
    return {"NAV": (f["x"], f["y"], f["h"]), "Z_A": (f["A"]["hc"],), "ROT_A": (f["A"]["rot"],), "Z_B": (f["B"]["hc"],),
            "ROT_B": (f["B"]["rot"],), "ASC": (f["C"]["fx"], f["C"]["fz"]), "CANON": (f["C"]["can"],)}


def intervalles_verite(frames: List[dict], eps: float = 1e-6) -> List[Tuple[float, float, frozenset]]:
    """Pour chaque intervalle de temps non nul entre deux points clés : l'ensemble des groupes dont la valeur change."""
    out = []
    for p, q in zip(frames[:-1], frames[1:]):
        if q["t"] - p["t"] <= 1e-9:
            continue
        vp, vq = _vals(p), _vals(q)
        bouge = frozenset(g for g in GROUPES_VERITE if any(abs(a - b) > eps for a, b in zip(vp[g], vq[g])))
        out.append((p["t"], q["t"], bouge))
    return out


def union_par_groupe(intervalles: List[Tuple[float, float, frozenset]]) -> Dict[str, List[Tuple[float, float]]]:
    """Intervalles de mouvement fusionnés par groupe."""
    res: Dict[str, List[Tuple[float, float]]] = {g: [] for g in GROUPES_VERITE}
    for t0, t1, gs in intervalles:
        for g in gs:
            L = res[g]
            if L and abs(L[-1][1] - t0) <= EPS_T:
                L[-1] = (L[-1][0], t1)
            else:
                L.append((t0, t1))
    return res


def paires_paralleles(union: Dict[str, List[Tuple[float, float]]], eps: float = EPS_T) -> set:
    out = set()
    gs = [g for g in GROUPES_MOUVEMENT if union[g]]
    for i, a in enumerate(gs):
        for b in gs[i + 1:]:
            if any(min(a1, b1) - max(a0, b0) > eps for a0, a1 in union[a] for b0, b1 in union[b]):
                out.add(tuple(sorted((a, b))))
    return out


def changements_vide(frames: List[dict]) -> Dict[str, List[Tuple[int, int, int]]]:
    """Nouveaux états de ventouses (3 rangées) par face, dans l'ordre, chaque fois qu'ils changent (état initial exclu)."""
    res: Dict[str, List[Tuple[int, int, int]]] = {"A": [], "B": []}
    for face in ("A", "B"):
        prec = tuple(1 if x else 0 for x in frames[0][face]["vac"])
        for f in frames[1:]:
            v = tuple(1 if x else 0 for x in f[face]["vac"])
            if v != prec:
                res[face].append(v)
                prec = v
    return res


# ---- modèles de test, entraînés une seule fois par session pytest ----------------------------------------------------------
_MODELES: Dict[str, Tuple[Path, Path]] = {}


def modele_de_test(tmp_path_factory, nom: str = "petit") -> Tuple[Path, Path]:
    """(.onnx, .pt). « petit » : 30 époques d'imitation ; « peu » : 1 époque (politique presque aléatoire, actions très variées).
    Le modèle versionné .data/modeles/fumee.onnx n'est pas utilisé : il date de l'observation à 56 entrées (incompatible v3)."""
    if nom not in _MODELES:
        dossier = tmp_path_factory.getbasetemp() / "modeles_embarque"
        dossier.mkdir(exist_ok=True)
        _MODELES[nom] = exporter_petit_modele(dossier, nom, {"petit": 30, "peu": 1}[nom])
    return _MODELES[nom]


# ---- décisions aléatoires valides dans l'environnement du moteur ------------------------------------------------------
def decisions_aleatoires(pont, n: int, graine: int = 7, scenarios: Optional[List[dict]] = None) -> Iterator[dict]:
    """Joue n décisions valides (indice tiré au hasard sous le masque) en enchaînant des matchs ; produit les réponses de sim_step
    avec les points clés bruts (trace)."""
    rng = random.Random(graine)
    scs = scenarios or [{"seed": 1, "intensite": "aucun"}, {"seed": 2, "intensite": "aucun"}, {"seed": 3, "intensite": "aucun"}]
    fait, k = 0, 0
    while fait < n:
        etat = pont.sim_reset(scs[k % len(scs)], {"skipContacts": True}, 200)
        k += 1
        while not etat["done"] and fait < n:
            valides = [i for i, m in enumerate(etat["mask"]) if m]
            if not valides:
                break
            etat = pont.sim_step(rng.choice(valides), trace=True)
            if etat.get("plan") is None:
                break
            fait += 1
            yield etat
