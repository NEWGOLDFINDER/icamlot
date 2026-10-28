#!/usr/bin/env python3
"""Runner embarqué du réseau récurrent (Raspberry Pi 5) : boucle de décision ONNX + moteur JS de référence.

Rien n'est réimplémenté en Python : l'observation, le masque et la conversion action -> brique sont celles de l'entraînement,
appelées dans le moteur JS par le pont Node persistant (embarque/bridge.js, client embarque/pont.py). Python ne fait que :
  1. charger le modèle (`<modele>.onnx` + `<modele>.meta.json`, voir trainer/FORMAT_MODELE.md) et REFUSER un modèle dont
     `obs_version` / `catalogue_version` / dimensions / groupes / catalogue ne sont pas ceux du moteur ;
  2. appliquer le masque aux logits non masqués, choisir l'action gloutonne, garder l'état caché (zéros au début du match,
     `next_hidden` réinjecté une fois par décision) ;
  3. fournir la croyance : en simulation, construite par le moteur (ENV.beliefFromSim) ; sur le robot, par les capteurs
     (embarque/croyance.py : lidar, caméras A et B, état des actionneurs renvoyé par les ESP32) ;
  4. envoyer la brique choisie aux ESP32 (esp32_bridge.py) avec le temps masqué décidé par le moteur.

Modes :
  python pi5_runner.py --modele M.onnx --simulation --graine 10000 [--matchs N] [--intensite realiste --strategie S.json]
  python pi5_runner.py --modele M.onnx --robot [--mock-esp] [--equipe jaune|bleue]
  python pi5_runner.py --modele M.onnx --benchmark
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, List, Optional, Tuple

import numpy as np

from embarque.croyance import CamerasAbsentes, ConstructeurCroyance, Mesures
from embarque.pont import ErreurPont, PontNode
from embarque.spec import duree_match_s
from esp32_bridge import DualESP32Orchestrator, EtatActionneurs, Rapport
from lidar_tracker import LidarTracker

ROOT = Path(__file__).resolve().parent

# Hypothèse : mêmes bornes que l'évaluation (engine/env_worker.js, DEFAULT_MAX_DECISIONS = 80 ; repris de ENV.play).
MAX_DECISIONS = 80
# Hypothèse : configuration ENV.create de l'évaluation quand le modèle n'en porte pas (trainer/evaluation.py : skipContacts).
ENV_CONFIG_DEFAUT = {"skipContacts": True}
# Hypothèse : garde-fou du nombre de décisions sur le robot réel (le match s'arrête à 100 s ; la limite de 80 de l'évaluation
# n'est qu'un protocole d'entraînement). Évite une boucle de décisions sans avance du temps.
MAX_DECISIONS_ROBOT = 1000


class ModeleIncompatible(RuntimeError):
    """Le modèle ne correspond pas à l'observation, au catalogue ou aux dimensions du moteur : le runner refuse de jouer."""


# ---------------------------------------------------------------------------------------------------------------------
# Modèle
# ---------------------------------------------------------------------------------------------------------------------
def chemin_meta(onnx: Path) -> Path:
    onnx = Path(onnx)
    return onnx.with_name(onnx.name[: -len(onnx.suffix)] + ".meta.json") if onnx.suffix else onnx.with_name(onnx.name + ".meta.json")


def charger_meta(onnx: Path) -> dict:
    p = chemin_meta(onnx)
    if not p.exists():
        raise ModeleIncompatible(f"Fichier {p.name} introuvable à côté de {Path(onnx).name} : les versions du modèle sont inconnues.")
    meta = json.loads(p.read_text(encoding="utf-8"))
    manque = [k for k in ("n_in", "n_out", "hidden", "obs_version", "catalogue_version") if meta.get(k) is None]
    if manque:
        raise ModeleIncompatible(f"{p.name} : champs absents {manque}.")
    return meta


def verifier_modele(meta: dict, hello: dict) -> None:
    """Compare le meta du modèle au moteur (réponse de `hello`). Lève ModeleIncompatible avec la liste des écarts."""
    err: List[str] = []
    if meta["obs_version"] != hello["obsVersion"]:
        err.append(f"obs_version : modèle {meta['obs_version']!r}, moteur {hello['obsVersion']!r}")
    if meta["catalogue_version"] != hello["catalogueVersion"]:
        err.append(f"catalogue_version : modèle {meta['catalogue_version']!r}, moteur {hello['catalogueVersion']!r}")
    if meta["n_in"] != hello["nInputs"]:
        err.append(f"entrées : modèle {meta['n_in']}, moteur {hello['nInputs']}")
    if meta["n_out"] != hello["nOutputs"]:
        err.append(f"actions : modèle {meta['n_out']}, moteur {hello['nOutputs']}")
    if meta.get("groupes") and list(meta["groupes"]) != list(hello["groups"]):
        err.append(f"groupes d'observation : modèle {meta['groupes']}, moteur {hello['groups']}")
    cat = meta.get("catalogue")
    if cat and len(cat) == len(hello["catalogue"]):
        ecarts = [i for i, (a, b) in enumerate(zip(cat, hello["catalogue"])) if a.get("label") != b.get("label")]
        if ecarts:
            err.append(f"catalogue : {len(ecarts)} action(s) différente(s), la première à l'indice {ecarts[0]}")
    if err:
        raise ModeleIncompatible("Modèle refusé : " + " ; ".join(err))


class Politique:
    """Réseau récurrent ONNX : `obs` brute (B, n_in) + `hidden` (B, H) -> `logits` non masqués + `next_hidden`."""

    def __init__(self, onnx: Path, meta: dict, providers: Optional[List[str]] = None):
        try:
            import onnxruntime as ort
        except ImportError as e:  # pragma: no cover - dépend de la machine
            raise RuntimeError("onnxruntime n'est pas installé (pip install onnxruntime).") from e
        self.meta = meta
        self.sess = ort.InferenceSession(str(onnx), providers=providers or ["CPUExecutionProvider"])
        entrees = {i.name: i.shape for i in self.sess.get_inputs()}
        sorties = [o.name for o in self.sess.get_outputs()]
        if set(entrees) != {"obs", "hidden"} or "logits" not in sorties or "next_hidden" not in sorties:
            raise ModeleIncompatible(f"Graphe ONNX inattendu : entrées {sorted(entrees)}, sorties {sorties}.")
        if entrees["obs"][-1] != meta["n_in"] or entrees["hidden"][-1] != meta["hidden"]:
            raise ModeleIncompatible(f"Graphe ONNX {entrees} différent du meta (n_in {meta['n_in']}, hidden {meta['hidden']}).")
        self.n_in, self.n_out, self.hidden_dim = meta["n_in"], meta["n_out"], meta["hidden"]
        self.h = np.zeros((1, self.hidden_dim), np.float32)

    def reset(self) -> None:
        """État caché à zéro : début de match."""
        self.h = np.zeros((1, self.hidden_dim), np.float32)

    def logits(self, obs: List[float]) -> np.ndarray:
        """Un pas du réseau (observation brute) ; réinjecte next_hidden. À appeler UNE fois par décision."""
        o = np.asarray(obs, np.float32).reshape(1, -1)
        if o.shape[1] != self.n_in:
            raise ModeleIncompatible(f"Observation de {o.shape[1]} valeurs pour un modèle à {self.n_in} entrées.")
        lg, nh = self.sess.run(["logits", "next_hidden"], {"obs": o, "hidden": self.h})
        self.h = nh
        return lg[0]

    def decider(self, obs: List[float], mask: List[int]) -> int:
        """Action gloutonne sous masque ; -1 s'il n'y a aucune action valide (pas d'appel au réseau)."""
        m = np.asarray(mask, bool)
        if not m.any():
            return -1
        lg = self.logits(obs)
        return int(np.argmax(np.where(m, lg, -np.inf)))


# ---------------------------------------------------------------------------------------------------------------------
# Sources de croyance : simulation (moteur) et robot (capteurs)
# ---------------------------------------------------------------------------------------------------------------------
@dataclass
class ResultatDecision:
    idx: int
    label: str
    brique: Optional[dict]
    t: float
    latence_modele_ms: float
    latence_pont_ms: float
    err: Optional[str] = None


class SimBackend:
    """Capteurs simulés par le moteur (ENV.beliefFromSim, modèle de caméras ENV.VISION) : le moteur exécute aussi la brique."""

    def __init__(self, pont: PontNode, scenario: dict, config: Optional[dict] = None, max_decisions: int = MAX_DECISIONS,
                 orch: Optional[DualESP32Orchestrator] = None):
        self.pont, self.scenario, self.config, self.max_decisions, self.orch = pont, scenario, config or ENV_CONFIG_DEFAUT, max_decisions, orch
        self.etat: dict = {}
        self.final: Optional[dict] = None
        self.rapports: List[Tuple[dict, Rapport]] = []

    def demarrer(self) -> None:
        self.etat = self.pont.sim_reset(self.scenario, self.config, self.max_decisions)
        self.final = None
        self.rapports = []

    def termine(self) -> bool:
        return bool(self.etat.get("done"))

    def croyance(self) -> dict:
        return self.etat["belief"]

    def verifier(self, obs: List[float], mask: List[int]) -> None:
        """Parité : l'observation et le masque du runner sont ceux que l'environnement a calculés lui-même."""
        if obs != self.etat["obs"] or mask != self.etat["mask"]:
            raise AssertionError("Observation ou masque du pont différents de ceux de l'environnement (même croyance).")

    def executer(self, idx: int, brique: Optional[dict]) -> Optional[str]:
        t0 = self.etat["t"]
        r = self.pont.sim_step(idx)
        if brique != r.get("brique"):
            raise AssertionError(f"Brique du pont {brique} différente de celle de l'environnement {r.get('brique')}.")
        if self.orch is not None and r.get("plan") is not None:
            self.rapports.append((r["plan"], self.orch.executer(r["plan"], "yellow", t_match0=t0)))
        self.etat = r
        if r.get("done"):
            self.final = r.get("final")
        return r.get("err")

    def bilan(self) -> dict:
        return self.final or {}


class CapteursRobot:
    """Lecture des capteurs réels : pose (odométrie ESP32 NAV, hypothèse faute de triangulation lidar), adversaire (lidar_tracker),
    caméras A et B (non fournies : CamerasAbsentes), codeurs et ventouses (ESP32 ACT)."""

    def __init__(self, orch: DualESP32Orchestrator, lidar: Any = None, cameras: Any = None,
                 source_pose: Optional[Callable[[], Tuple[float, float, float]]] = None):
        """source_pose : pose (x, y, cap) en repère réel, par exemple la triangulation du lidar quand elle existera ;
        par défaut, l'odométrie de l'ESP32 NAV (`POSE?`, hypothèse H5)."""
        self.orch, self.lidar, self.cameras = orch, lidar, cameras or CamerasAbsentes()
        self.source_pose = source_pose or orch.lire_pose

    def lire(self, t: float) -> Mesures:
        pose = self.source_pose()
        adv = None
        if self.lidar is not None:
            self.lidar.mise_a_jour(pose)
            adv = self.lidar.adversaire(t)
        return Mesures(t=t, pose=pose, adversaire=adv, paquets=self.cameras.paquets(), etrangeres=self.cameras.etrangeres(),
                       actionneurs=self.orch.lire_actionneurs())


class RobotBackend:
    """Robot réel (ou ESP32 simulés avec --mock-esp) : croyance = modèle interne + capteurs, brique exécutée par les ESP32."""

    def __init__(self, pont: PontNode, orch: DualESP32Orchestrator, capteurs: Any, equipe: str = "yellow", horloge: Any = None):
        self.pont, self.orch, self.capteurs, self.equipe = pont, orch, capteurs, equipe
        self.horloge = horloge or orch.horloge
        self.cons = ConstructeurCroyance(pont, equipe)
        self.t_depart = 0.0
        self.echec_materiel = False
        self.programme: List[dict] = []
        self.rapports: List[Rapport] = []

    def t_match(self) -> float:
        return self.horloge.now() - self.t_depart

    def demarrer(self) -> None:
        interne = self.cons.demarrer()
        v = self.pont.hello_info.get("vitesses") or {}
        etat0 = EtatActionneurs(grip={f: (interne["pinces"][f]["hc"], interne["pinces"][f]["rot"]) for f in ("A", "B")},
                                tenue={"A": (0, 0, 0), "B": (0, 0, 0)}, fourche=(interne["meca"]["fx"], interne["meca"]["fz"]), canon=interne["meca"]["can"])
        self.orch.initialize(pose=(interne["pose"]["x"], interne["pose"]["y"], interne["pose"]["h"]), equipe=self.equipe, vitesses=v, etat_initial=etat0)
        self.t_depart = self.horloge.now()
        self.echec_materiel = False

    def termine(self) -> bool:
        return self.t_match() >= duree_match_s()

    def croyance(self) -> dict:
        return self.cons.croyance(self.capteurs.lire(self.t_match()), self.echec_materiel)

    def verifier(self, obs: List[float], mask: List[int]) -> None:
        pass

    def executer(self, idx: int, brique: Optional[dict]) -> Optional[str]:
        t0 = self.t_match()
        if brique is None:
            self.echec_materiel = True
            return "Action non résolue."
        r = self.cons.appliquer(brique)
        err = r["info"].get("err")
        self.programme.append(brique)
        if err:
            self.echec_materiel = False          # l'échec est connu par le moteur local (cons.echec) : rien à exécuter
            return err
        rap = self.orch.executer(r["plan"], self.equipe, t_match0=t0)
        self.rapports.append(rap)
        self.echec_materiel = not rap.ok
        return rap.erreur

    def bilan(self) -> dict:
        return {"T": self.t_match(), "decisions": len(self.programme), "programme": self.programme}


# ---------------------------------------------------------------------------------------------------------------------
# Boucle de décision
# ---------------------------------------------------------------------------------------------------------------------
class Pi5Runner:
    def __init__(self, politique: Politique, pont: PontNode, backend: Any, max_decisions: int = MAX_DECISIONS,
                 verifier_parite: bool = False, log: Callable[[str], None] = lambda s: None):
        self.politique, self.pont, self.backend = politique, pont, backend
        self.max_decisions, self.verifier_parite, self.log = max_decisions, verifier_parite, log
        self.decisions: List[ResultatDecision] = []

    def jouer(self) -> dict:
        """Un match : état caché à zéro, puis décision -> exécution jusqu'à la fin. Renvoie le bilan du backend."""
        self.politique.reset()
        self.backend.demarrer()
        self.decisions = []
        catalogue = self.pont.hello_info["catalogue"]
        while not self.backend.termine() and len(self.decisions) < self.max_decisions:
            b = self.backend.croyance()
            t_pont = time.perf_counter()
            obs, mask = self.pont.observe_mask(b)
            dt_pont = (time.perf_counter() - t_pont) * 1000
            if self.verifier_parite:
                self.backend.verifier(obs, mask)
            t_mod = time.perf_counter()
            idx = self.politique.decider(obs, mask)
            dt_mod = (time.perf_counter() - t_mod) * 1000
            if idx < 0:                                   # aucune action valide : le robot attend la fin du match
                self.log("Aucune action valide : attente de la fin du match.")
                break
            st = self.pont.step(idx, b)
            err = self.backend.executer(idx, st["brique"])
            d = ResultatDecision(idx, catalogue[idx]["label"], st["brique"], b["t"], dt_mod, dt_pont, err)
            self.decisions.append(d)
            self.log(f"{b['t']:6.1f} s | {idx:3d} {d.label[:46]:46s} | modèle {dt_mod:5.2f} ms, pont {dt_pont:6.1f} ms" + (f" | ERREUR {err}" if err else ""))
        return self.backend.bilan()


# ---------------------------------------------------------------------------------------------------------------------
# Assemblage
# ---------------------------------------------------------------------------------------------------------------------
def ouvrir(modele: Path, vision: Optional[bool] = None) -> Tuple[PontNode, Politique, dict]:
    """Charge le meta, lance le pont, REFUSE un modèle incompatible, ouvre la session ONNX."""
    modele = Path(modele)
    meta = charger_meta(modele)
    pont = PontNode()
    try:
        hello = pont.hello(entrees=meta.get("groupes"), vision=vision)
        verifier_modele(meta, hello)
        return pont, Politique(modele, meta), meta
    except Exception:
        pont.fermer()
        raise


def jouer_simulation(modele: Path, scenario: dict, config: Optional[dict] = None, max_decisions: int = MAX_DECISIONS,
                     esp32_mock: bool = False, verifier_parite: bool = True, log: Callable[[str], None] = lambda s: None) -> dict:
    pont, pol, _ = ouvrir(modele)
    with pont:
        orch = None
        if esp32_mock:
            orch = DualESP32Orchestrator(mock=True)
            orch.initialize()
        be = SimBackend(pont, scenario, config, max_decisions, orch)
        runner = Pi5Runner(pol, pont, be, max_decisions, verifier_parite, log)
        final = runner.jouer()
        final = dict(final)
        final["decisions_detail"] = [(d.idx, d.t) for d in runner.decisions]
        final["rapports_esp32"] = len(be.rapports)
        return final


def benchmark(modele: Path, n: int = 1000) -> dict:
    """Latence du modèle seul (observation aléatoire), mesurée ; le pont Node n'est pas inclus."""
    meta = charger_meta(modele)
    pol = Politique(modele, meta)
    rng = np.random.default_rng(0)
    obs = rng.random((n, meta["n_in"]), dtype=np.float32)
    pol.logits(obs[0].tolist())
    t = []
    for k in range(n):
        t0 = time.perf_counter()
        pol.logits(obs[k].tolist())
        t.append((time.perf_counter() - t0) * 1000)
    return {"decisions": n, "moyenne_ms": float(np.mean(t)), "p50_ms": float(np.percentile(t, 50)), "p99_ms": float(np.percentile(t, 99)), "max_ms": float(max(t))}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Runner embarqué du réseau récurrent (ONNX + moteur JS).")
    ap.add_argument("--modele", required=True, help="fichier .onnx (son .meta.json doit être à côté)")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--simulation", action="store_true", help="capteurs simulés par le moteur JS (ENV.beliefFromSim)")
    mode.add_argument("--robot", action="store_true", help="capteurs et ESP32 réels (ou simulés avec --mock-esp)")
    mode.add_argument("--benchmark", action="store_true", help="latence du modèle seul")
    ap.add_argument("--graine", type=int, default=10_000, help="graine du premier match (comme trainer.evaluation)")
    ap.add_argument("--matchs", type=int, default=1)
    ap.add_argument("--intensite", default="aucun", help="intensité de l'adversaire (aucun, faible, realiste, agressif)")
    ap.add_argument("--strategie", help="stratégie adverse (JSON camelot-strategie : { program, params })")
    ap.add_argument("--env-config", help="configuration ENV.create (JSON) ; défaut : celle de l'évaluation")
    ap.add_argument("--mock-esp", action="store_true", help="ESP32 simulés (horloge virtuelle)")
    ap.add_argument("--nav-port", default=None)
    ap.add_argument("--act-port", default=None)
    ap.add_argument("--equipe", choices=("jaune", "bleue"), default="jaune")
    ap.add_argument("--runs", type=int, default=1000)
    ap.add_argument("--sortie", help="écrit le bilan JSON ici")
    ap.add_argument("-v", "--verbeux", action="store_true")
    a = ap.parse_args(argv)
    log = print if a.verbeux else (lambda s: None)
    try:
        if a.benchmark:
            r = benchmark(Path(a.modele), a.runs)
            print(json.dumps(r, indent=1))
            return 0
        if a.simulation:
            cfg = json.loads(Path(a.env_config).read_text()) if a.env_config else None
            opp = None
            if a.strategie:
                j = json.loads(Path(a.strategie).read_text(encoding="utf-8"))
                opp = {"program": j["program"], "params": j.get("params") or {}}
            res = []
            for k in range(a.matchs):
                sc = {"seed": a.graine + k, "intensite": a.intensite if opp else "aucun"}
                if opp:
                    sc["opponent"] = opp
                r = jouer_simulation(Path(a.modele), sc, cfg, esp32_mock=a.mock_esp, log=log)
                res.append(r)
                print(f"match {k + 1}/{a.matchs} graine {sc['seed']} : score {r.get('score')} · erreurs moteur {r.get('errors')} · décisions {r.get('decisions')}")
            if a.sortie:
                Path(a.sortie).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
            return 0
        # --robot
        equipe = "blue" if a.equipe == "bleue" else "yellow"
        pont, pol, _ = ouvrir(Path(a.modele), vision=False)
        with pont:
            kw = {k: v for k, v in (("nav_port", a.nav_port), ("act_port", a.act_port)) if v}
            orch = DualESP32Orchestrator(mock=a.mock_esp, **kw)
            capteurs = CapteursRobot(orch, lidar=LidarTracker(mock=a.mock_esp))
            be = RobotBackend(pont, orch, capteurs, equipe)
            bilan = Pi5Runner(pol, pont, be, MAX_DECISIONS_ROBOT, log=print).jouer()
            print(json.dumps({k: v for k, v in bilan.items() if k != "programme"}, indent=1))
            orch.close()
        return 0
    except (ModeleIncompatible, ErreurPont) as e:
        print(f"Refus : {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
