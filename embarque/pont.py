"""Client Python du pont Node persistant (embarque/bridge.js).

Aucune réimplémentation de l'observation, du masque ni de la conversion action -> brique : tout passe par le moteur JS
de référence (mêmes fonctions que l'entraînement, contrats §4 et §5 de docs/CONTRATS.md).
Protocole : JSON-lignes, une réponse par requête, dans l'ordre (voir l'en-tête de embarque/bridge.js).
"""
from __future__ import annotations

import json
import os
import select
import shutil
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
BRIDGE_JS = Path(__file__).resolve().with_name("bridge.js")

# Hypothèse : délai maximal de réponse du pont (s). Le masque lance un A* sur la grille du planificateur ; mesuré à
# quelques dixièmes de seconde par décision sur un Xeon 2,1 GHz. Valeur large, à resserrer sur le Pi 5 après mesure.
DELAI_REPONSE_S = 120.0


class ErreurPont(RuntimeError):
    """Le pont Node a répondu { error } ou ne répond plus."""


class PontNode:
    """Processus Node persistant ; une instance = un moteur (simulation ou modèle interne du robot)."""

    def __init__(self, node: str = "node", delai_s: float = DELAI_REPONSE_S, racine: Optional[Path] = None):
        exe = shutil.which(node) or node
        self.delai_s = delai_s
        self._rid = 0
        self._verrou = threading.Lock()
        self.proc = subprocess.Popen(
            [exe, str(BRIDGE_JS)], cwd=str(racine or ROOT), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=sys.stderr, text=True, bufsize=1,
        )
        self.hello_info: Dict[str, Any] = {}

    # ---- transport -------------------------------------------------------------------------------------------------
    def appeler(self, cmd: str, **champs: Any) -> Dict[str, Any]:
        with self._verrou:
            if self.proc.poll() is not None:
                raise ErreurPont(f"Le pont Node s'est arrêté (code {self.proc.returncode}).")
            self._rid += 1
            req = {"cmd": cmd, "rid": self._rid, **champs}
            try:
                self.proc.stdin.write(json.dumps(req, separators=(",", ":")) + "\n")
                self.proc.stdin.flush()
            except (BrokenPipeError, OSError) as e:
                raise ErreurPont(f"Écriture impossible vers le pont Node ({e}).") from e
            prete, _, _ = select.select([self.proc.stdout], [], [], self.delai_s)
            if not prete:
                raise ErreurPont(f"Pas de réponse du pont Node à « {cmd} » en {self.delai_s:.0f} s.")
            ligne = self.proc.stdout.readline()
            if not ligne:
                raise ErreurPont("Le pont Node a fermé sa sortie.")
            rep = json.loads(ligne)
            if rep.get("rid") != self._rid:
                raise ErreurPont(f"Réponse désynchronisée (attendu {self._rid}, reçu {rep.get('rid')}).")
            if "error" in rep:
                raise ErreurPont(f"{cmd} : {rep['error']}")
            return rep

    def fermer(self) -> None:
        if self.proc.poll() is None:
            try:
                self.appeler("close")
            except ErreurPont:
                pass
            try:
                self.proc.stdin.close()
                self.proc.wait(timeout=5)
            except Exception:
                self.proc.kill()

    def __enter__(self) -> "PontNode":
        return self

    def __exit__(self, *exc) -> None:
        self.fermer()

    # ---- fonctions pures du moteur ---------------------------------------------------------------------------------
    def hello(self, entrees: Optional[List[str]] = None, familles: Optional[List[str]] = None,
              vision: Optional[bool] = None) -> Dict[str, Any]:
        champs: Dict[str, Any] = {}
        if entrees is not None:
            champs["entrees"] = entrees
        if familles is not None:
            champs["familles"] = familles
        if vision is not None:
            champs["vision"] = vision
        self.hello_info = self.appeler("hello", **champs)
        return self.hello_info

    def observe(self, belief: dict) -> List[float]:
        return self.appeler("observe", belief=belief)["obs"]

    def mask(self, belief: dict) -> List[int]:
        return self.appeler("mask", belief=belief)["mask"]

    def observe_mask(self, belief: dict):
        r = self.appeler("observe_mask", belief=belief)
        return r["obs"], r["mask"]

    def step(self, act: Any, belief: dict) -> Dict[str, Any]:
        """act : index du catalogue (int) ou action (dict). Renvoie { index, act, brique, reelle }."""
        if isinstance(act, int):
            return self.appeler("step", index=act, belief=belief)
        return self.appeler("step", act=act, belief=belief)

    def mirror_ids(self, ids: List[str]) -> List[str]:
        return self.appeler("mirror_ids", ids=ids)["ids"]

    # ---- simulation ------------------------------------------------------------------------------------------------
    def sim_reset(self, scenario: Optional[dict] = None, config: Optional[dict] = None,
                  max_decisions: Optional[int] = None) -> Dict[str, Any]:
        champs: Dict[str, Any] = {"scenario": scenario or {}}
        if config is not None:
            champs["config"] = config
        if max_decisions is not None:
            champs["maxDecisions"] = max_decisions
        return self.appeler("sim_reset", **champs)

    def sim_step(self, index: int, trace: bool = False) -> Dict[str, Any]:
        return self.appeler("sim_step", index=int(index), trace=trace)

    # ---- modèle interne du robot réel ------------------------------------------------------------------------------
    def track_start(self, params: Optional[dict] = None, vision: Optional[bool] = None) -> Dict[str, Any]:
        champs: Dict[str, Any] = {"params": params or {}}
        if vision is not None:
            champs["vision"] = vision
        return self.appeler("track_start", **champs)

    def track_exec(self, brique: dict, adversaire: Optional[dict] = None) -> Dict[str, Any]:
        return self.appeler("track_exec", brique=brique, adversaire=adversaire)

    def track_belief(self, adversaire: Optional[dict] = None) -> Dict[str, Any]:
        return self.appeler("track_belief", adversaire=adversaire)
