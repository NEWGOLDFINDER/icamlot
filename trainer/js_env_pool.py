"""Pool de processus Node exécutant le moteur JS de référence (engine/env_worker.js).

P processus × M environnements. Chaque processus tient M environnements et reçoit des commandes groupées
(`create_batch`, `reset_batch`, `step_batch`, `score_batch`, `imitate_trace`) ; le protocole est documenté
en tête de `engine/env_worker.js`.

Le pas est réellement parallèle : la commande est écrite à tous les processus, puis les réponses sont lues.
Chaque processus a un fil lecteur (stdout) et un fil qui garde la fin de son stderr : un processus qui meurt
ou qui ne répond pas dans le délai lève `EnvPoolError` avec le message du moteur.

Rien n'est codé en dur sur la taille des observations ni du catalogue : tout est lu dans la réponse de
`create_batch` (`n_in`, `n_out`, `catalogue`, `obs_version`, `catalogue_version`).
"""
from __future__ import annotations

import atexit
import json
import os
import queue
import subprocess
import threading
import time
import weakref
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
WORKER = ROOT / "engine" / "env_worker.js"

# Hypothèse : délai maximal de réponse d'un processus pour une commande ordinaire (s).
# Un pas groupé de M environnements prend de l'ordre de M × 0,25 s sur un cœur (mesure de l'audit : ~5 décisions/s).
DELAI_REPONSE_S = 120.0
# Hypothèse : nombre maximal de décisions par épisode (repris de ENV.play dans engine/env.js : max = 80).
MAX_DECISIONS = 80


class EnvPoolError(RuntimeError):
    """Erreur d'un processus d'environnement (arrêt, délai dépassé, réponse d'erreur)."""


class _NodeProc:
    """Un processus Node `env_worker.js` avec lecture non bloquante de stdout et stderr."""

    def __init__(self, idx: int, node: str = "node", worker: Path = WORKER):
        self.idx = idx
        try:
            self.proc = subprocess.Popen(
                [node, str(worker)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                bufsize=1,
                cwd=str(ROOT),
            )
        except FileNotFoundError as e:
            raise EnvPoolError(f"Node introuvable ({node}) : installe Node.js pour le moteur JS.") from e
        self.replies: "queue.Queue[Optional[str]]" = queue.Queue()
        self.stderr_tail: deque = deque(maxlen=60)
        self._pending = 0
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()

    def _read_stdout(self):
        try:
            for line in self.proc.stdout:
                self.replies.put(line)
        except (ValueError, OSError):
            pass
        self.replies.put(None)

    def _read_stderr(self):
        try:
            for line in self.proc.stderr:
                self.stderr_tail.append(line.rstrip())
        except (ValueError, OSError):
            pass

    def _stderr(self) -> str:
        return "\n".join(list(self.stderr_tail)[-15:])

    def alive(self) -> bool:
        return self.proc.poll() is None

    def send(self, msg: dict) -> None:
        if not self.alive():
            raise EnvPoolError(f"Processus {self.idx} arrêté (code {self.proc.returncode}). {self._stderr()}")
        try:
            self.proc.stdin.write(json.dumps(msg, ensure_ascii=False) + "\n")
            self.proc.stdin.flush()
        except (BrokenPipeError, OSError) as e:
            raise EnvPoolError(f"Processus {self.idx} : écriture impossible ({e}). {self._stderr()}") from e
        self._pending += 1

    def recv(self, timeout: float, cmd: str = "") -> dict:
        try:
            line = self.replies.get(timeout=timeout)
        except queue.Empty:
            raise EnvPoolError(f"Processus {self.idx} : pas de réponse à « {cmd} » en {timeout:.0f} s. {self._stderr()}")
        self._pending -= 1
        if line is None:
            self.replies.put(None)
            raise EnvPoolError(f"Processus {self.idx} arrêté pendant « {cmd} ». {self._stderr()}")
        try:
            out = json.loads(line)
        except ValueError as e:
            raise EnvPoolError(f"Processus {self.idx} : réponse illisible ({line[:200]!r}).") from e
        if isinstance(out, dict) and out.get("error"):
            raise EnvPoolError(f"Processus {self.idx}, « {cmd} » : {out['error']}")
        return out

    def call(self, msg: dict, timeout: float) -> dict:
        self.send(msg)
        return self.recv(timeout, msg.get("cmd", ""))

    def close(self, timeout: float = 5.0) -> None:
        if self.alive():
            try:
                self.proc.stdin.close()
            except OSError:
                pass
            try:
                self.proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                try:
                    self.proc.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    pass
        for fh in (self.proc.stdout, self.proc.stderr):
            try:
                fh.close()
            except Exception:
                pass


@dataclass
class StepResult:
    obs: np.ndarray            # (N, n_in) float32 — observation suivante (du nouvel épisode après auto-reset)
    mask: np.ndarray           # (N, n_out) bool
    reward: np.ndarray         # (N,) float32 — récompense de l'environnement (somme = score officiel, contrat §4)
    done: np.ndarray           # (N,) bool — l'épisode vient de se terminer (fin de match, erreur « fin », crash, troncature)
    infos: List[Dict[str, Any]] = field(default_factory=list)


_POOLS: "weakref.WeakSet[JsEnvPool]" = weakref.WeakSet()


@atexit.register
def _close_all():  # pragma: no cover - filet de sécurité à la sortie de l'interpréteur
    for p in list(_POOLS):
        try:
            p.close()
        except Exception:
            pass


class JsEnvPool:
    """P processus Node × M environnements du moteur JS de référence.

    config : configuration passée à `ENV.create` (entrees, familles, params, skipContacts, onError, recompense…).
    """

    def __init__(
        self,
        n_procs: int = 1,
        envs_per_proc: int = 1,
        config: Optional[dict] = None,
        max_decisions: int = MAX_DECISIONS,
        timeout: float = DELAI_REPONSE_S,
        node: str = "node",
        opponents: Optional[Dict[str, dict]] = None,
    ):
        if n_procs < 1 or envs_per_proc < 1:
            raise ValueError("Il faut au moins 1 processus et 1 environnement par processus.")
        self.n_procs = int(n_procs)
        self.envs_per_proc = int(envs_per_proc)
        self.n_envs = self.n_procs * self.envs_per_proc
        self.config = dict(config or {})
        self.timeout = float(timeout)
        self.max_decisions = int(max_decisions)
        self.procs: List[_NodeProc] = []
        self._closed = False
        self._broken = ""
        self._waiting = False
        self._last_obs: Optional[np.ndarray] = None
        self._last_mask: Optional[np.ndarray] = None
        self.stats = {"pas": 0, "decisions": 0, "episodes": 0, "crashs": 0, "tronques": 0, "masques_vides": 0}
        self.opponents: Dict[str, dict] = {}
        _POOLS.add(self)
        try:
            self.procs = [_NodeProc(i, node=node) for i in range(self.n_procs)]
            for p in self.procs:
                p.send({"cmd": "create_batch", "config": self.config, "n": self.envs_per_proc,
                        "maxDecisions": self.max_decisions})
            infos = [p.recv(self.timeout, "create_batch") for p in self.procs]
        except Exception:
            self.close()
            raise
        first = infos[0]
        for k in ("nInputs", "nOutputs", "obsVersion", "catalogueVersion"):
            if any(i.get(k) != first.get(k) for i in infos):
                self.close()
                raise EnvPoolError(f"Les processus ne s'accordent pas sur {k}.")
        self.n_in: int = int(first["nInputs"])
        self.n_out: int = int(first["nOutputs"])
        self.catalogue: List[dict] = first.get("catalogue") or []
        self.groups: List[str] = first.get("groups") or []
        self.obs_version: str = str(first.get("obsVersion"))
        self.catalogue_version: str = str(first.get("catalogueVersion"))
        self.moteur: str = str(first.get("moteur"))
        self.bareme: str = str(first.get("bareme"))
        if opponents:
            self.set_opponents(opponents)

    # ───────────── utilitaires ─────────────
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def __del__(self):  # pragma: no cover
        try:
            self.close()
        except Exception:
            pass

    def _split(self, items: Sequence[Any]) -> List[List[Any]]:
        M = self.envs_per_proc
        return [list(items[p * M:(p + 1) * M]) for p in range(self.n_procs)]

    def _check(self) -> None:
        if self._closed:
            raise EnvPoolError("Pool fermé.")
        if self._broken:
            raise EnvPoolError("Pool inutilisable après une erreur de processus : " + self._broken)
        if self._waiting:
            raise EnvPoolError("Un pas asynchrone est en cours : appelle step_wait d'abord.")

    def _gather(self, calls: List[tuple], timeout: Optional[float] = None) -> List[dict]:
        """Lit une réponse par (processus, commande), dans l'ordre. Toutes les réponses sont lues même si
        l'une est une erreur (les files restent synchronisées) ; la première erreur est ensuite levée.
        Un processus muet ou arrêté rend le pool inutilisable."""
        out: List[Optional[dict]] = []
        first: Optional[EnvPoolError] = None
        for p, cmd in calls:
            try:
                out.append(self.procs[p].recv(timeout or self.timeout, cmd))
            except EnvPoolError as e:
                out.append(None)
                if not self.procs[p].alive() or "pas de réponse" in str(e):
                    self._broken = str(e)
                first = first or e
                if self._broken:
                    break
        if first:
            raise first
        return out  # type: ignore[return-value]

    def _broadcast(self, msgs: List[dict], timeout: Optional[float] = None) -> List[dict]:
        self._check()
        for p, m in zip(self.procs, msgs):
            p.send(m)
        return self._gather([(p, m.get("cmd", "")) for p, m in enumerate(msgs)], timeout)

    def _vec_obs(self, o, n) -> np.ndarray:
        a = np.zeros(n, dtype=np.float32)
        if o:
            v = np.asarray(o, dtype=np.float32)
            a[: min(n, v.size)] = v[:n]
        return a

    def _vec_mask(self, m) -> np.ndarray:
        a = np.zeros(self.n_out, dtype=bool)
        if m:
            v = np.asarray(m, dtype=bool)
            a[: min(self.n_out, v.size)] = v[: self.n_out]
        if not a.any():
            # Masque vide (ne devrait pas arriver : ENV autorise le trône si rien d'autre n'est possible).
            # On autorise tout et on le compte ; l'environnement répondra « Action invalide. ».
            self.stats["masques_vides"] += 1
            a[:] = True
        return a

    # ───────────── adversaires ─────────────
    def set_opponents(self, opponents: Dict[str, dict]) -> None:
        """Enregistre les adversaires {id: {program, params} | {brain}} dans chaque processus."""
        self.opponents = dict(opponents)
        self._broadcast([{"cmd": "set_opponents", "opponents": opponents} for _ in self.procs])

    def robots_adverses(self) -> List[dict]:
        """Robots adverses (engine/adversaires.js) : [{ id, nom, type, esquisse, modele }] ; modele faux = réseau non entraîné."""
        return self._broadcast([{"cmd": "adversaires"} for _ in self.procs])[0].get("robots") or []

    def physique(self) -> List[dict]:
        """Caractéristiques physiques de notre robot (ADVERSAIRES.PHYSIQUE : id, nom, unité, nominale, statut, source, plage)."""
        return self._broadcast([{"cmd": "physique"} for _ in self.procs])[0].get("caracteristiques") or []

    # ───────────── reset / step ─────────────
    def reset(self, scenarios: Optional[Sequence[Optional[dict]]] = None):
        """Remet tous les environnements à zéro. Renvoie (obs (N, n_in), mask (N, n_out))."""
        scs = list(scenarios) if scenarios is not None else [{} for _ in range(self.n_envs)]
        if len(scs) != self.n_envs:
            raise ValueError(f"{len(scs)} scénarios pour {self.n_envs} environnements.")
        scs = [s if s is not None else {} for s in scs]
        outs = self._broadcast([{"cmd": "reset_batch", "scenarios": part} for part in self._split(scs)])
        obs = np.zeros((self.n_envs, self.n_in), dtype=np.float32)
        mask = np.zeros((self.n_envs, self.n_out), dtype=bool)
        for p, out in enumerate(outs):
            for k, st in enumerate(out["results"]):
                i = p * self.envs_per_proc + k
                obs[i] = self._vec_obs(st["obs"], self.n_in)
                mask[i] = self._vec_mask(st["mask"])
        self._last_obs, self._last_mask = obs.copy(), mask.copy()
        return obs, mask

    def reset_ids(self, ids: Sequence[int], scenarios: Sequence[dict]):
        """Remet à zéro certains environnements. Renvoie {id: (obs, mask)}."""
        per: List[List[tuple]] = [[] for _ in self.procs]
        for i, sc in zip(ids, scenarios):
            per[i // self.envs_per_proc].append((i % self.envs_per_proc, sc or {}))
        self._check()
        active = [p for p in range(self.n_procs) if per[p]]
        for p in active:
            self.procs[p].send({"cmd": "reset_batch", "ids": [k for k, _ in per[p]], "scenarios": [s for _, s in per[p]]})
        replies = self._gather([(p, "reset_batch") for p in active])
        out: Dict[int, tuple] = {}
        for p, rep in zip(active, replies):
            res = rep["results"]
            for k, _ in per[p]:
                i = p * self.envs_per_proc + k
                o, m = self._vec_obs(res[k]["obs"], self.n_in), self._vec_mask(res[k]["mask"])
                out[i] = (o, m)
                if self._last_obs is not None:
                    self._last_obs[i], self._last_mask[i] = o, m
        return out

    def step_async(self, actions: Sequence[Optional[int]], next_scenarios: Optional[Sequence[Optional[dict]]] = None):
        """Envoie une action par environnement (None = environnement au repos).
        next_scenarios[i] : scénario de l'épisode suivant si l'épisode i se termine (auto-reset), sinon None."""
        self._check()
        if len(actions) != self.n_envs:
            raise ValueError(f"{len(actions)} actions pour {self.n_envs} environnements.")
        acts = [None if a is None else int(a) for a in actions]
        nxt = list(next_scenarios) if next_scenarios is not None else [None] * self.n_envs
        self._active = [p for p, part in enumerate(self._split(acts)) if any(a is not None for a in part)]
        self._acts = acts
        for p in self._active:
            self.procs[p].send({"cmd": "step_batch", "actions": self._split(acts)[p], "next": self._split(nxt)[p]})
        self._waiting = True

    def step_wait(self) -> StepResult:
        if not self._waiting:
            raise EnvPoolError("step_wait sans step_async.")
        self._waiting = False
        N = self.n_envs
        obs = self._last_obs.copy() if self._last_obs is not None else np.zeros((N, self.n_in), np.float32)
        mask = self._last_mask.copy() if self._last_mask is not None else np.ones((N, self.n_out), bool)
        reward = np.zeros(N, dtype=np.float32)
        done = np.zeros(N, dtype=bool)
        infos: List[Dict[str, Any]] = [{"repos": True} for _ in range(N)]
        outs = dict(zip(self._active, self._gather([(p, "step_batch") for p in self._active])))
        for p, out in outs.items():
            for k, r in enumerate(out["results"]):
                if r is None:
                    continue
                i = p * self.envs_per_proc + k
                if r.get("error"):
                    raise EnvPoolError(f"Environnement {i} : {r['error']}")
                obs[i] = self._vec_obs(r.get("obs"), self.n_in)
                mask[i] = self._vec_mask(r.get("mask"))
                reward[i] = float(r.get("reward") or 0.0)
                done[i] = bool(r.get("done"))
                info = {"err": r.get("err"), "t": r.get("t"), "score": r.get("score"), "dt": r.get("dt"),
                        "crash": bool(r.get("crash")), "tronque": bool(r.get("truncated")), "reset": bool(r.get("reset"))}
                if "final" in r:
                    info["final"] = r["final"]
                    self.stats["episodes"] += 1
                    self.stats["crashs"] += int(bool(r["final"].get("crash")))
                    self.stats["tronques"] += int(bool(r["final"].get("truncated")))
                infos[i] = info
                self.stats["decisions"] += 1
        self.stats["pas"] += 1
        self._last_obs, self._last_mask = obs.copy(), mask.copy()
        return StepResult(obs=obs, mask=mask, reward=reward, done=done, infos=infos)

    def step(self, actions, next_scenarios=None) -> StepResult:
        self.step_async(actions, next_scenarios)
        return self.step_wait()

    def scores(self) -> List[dict]:
        """Bilan (score, erreurs, adversaire…) de l'épisode en cours ou terminé de chaque environnement."""
        outs = self._broadcast([{"cmd": "score_batch"} for _ in self.procs])
        return [r for out in outs for r in out["results"]]

    # ───────────── commandes réparties ─────────────
    def map(self, msgs: Sequence[dict], timeout: Optional[float] = None) -> List[dict]:
        """Répartit des commandes indépendantes (imitate_trace, play, qualify…) entre les processus.
        Chaque processus traite sa file dans l'ordre ; les processus travaillent en parallèle."""
        self._check()
        assign = [i % self.n_procs for i in range(len(msgs))]
        for i, m in enumerate(msgs):
            self.procs[assign[i]].send(m)
        # les réponses d'un processus arrivent dans l'ordre de ses requêtes
        order = [i for p in range(self.n_procs) for i in range(len(msgs)) if assign[i] == p]
        replies = self._gather([(assign[i], msgs[i].get("cmd", "")) for i in order], timeout)
        out: List[Optional[dict]] = [None] * len(msgs)
        for i, r in zip(order, replies):
            out[i] = r
        return out  # type: ignore[return-value]

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        for p in self.procs:
            try:
                p.close()
            except Exception:
                pass

    def describe(self) -> dict:
        return {
            "processus": self.n_procs, "envs_par_processus": self.envs_per_proc, "n_envs": self.n_envs,
            "n_in": self.n_in, "n_out": self.n_out, "obs_version": self.obs_version,
            "catalogue_version": self.catalogue_version, "moteur": self.moteur, "bareme": self.bareme,
            "max_decisions": self.max_decisions,
        }


def default_procs() -> int:
    """Hypothèse : un processus Node par thread disponible, moins un pour le processus Python (au moins 1)."""
    return max(1, (os.cpu_count() or 2) - 1)
