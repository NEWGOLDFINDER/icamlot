#!/usr/bin/env python3
"""Pont temps réel entre le Raspberry Pi 5 et les 2 ESP32 (traduction brique -> commandes, voir docs/PROTOCOLE_ESP32.md).

Matériel (spec/robot.json, `calcul.embarque` ; affectation déclarée par l'équipe le 2026-10-28) :
- ESP32 n°1 `NAV` : base roulante UNIQUEMENT (2 RoboClaw, 2 PMW3389, gyroscope).
- ESP32 n°2 `ACT` : TOUS les actionneurs : vérins Z des nacelles A et B (axes `hc`), rotations des nacelles, ascenseur du Graal,
  canon (une seule sortie « séance de tir »), 6 pompes (une par pierre), 6 capteurs de pression, tirette.
Les deux sont reliés au Pi en USB. L'évitement est décidé par le Pi, qui envoie `STOP` à `NAV`.

Principe (docs/CONTRATS.md §7) : le moteur JS de référence décide du TEMPS MASQUÉ. Pour chaque brique, le pont Node
(embarque/bridge.js) renvoie un « plan » lu dans les points clés du moteur : déplacements de la base, des pinces, de la fourche
et du canon, événements (ventouses, tir), avec leurs instants relatifs au début de la brique. Ce module traduit ce plan en
commandes ESP32 SANS rien décider lui-même : l'ordre et le parallélisme des commandes sont ceux du moteur. Une commande dépend
de toutes celles que le moteur avait terminées avant son début ; sinon elle part à l'instant nominal du plan.

Le champ `tm` d'une brique (prendre, tour, stocker, reprendre, préparer la pince) ne change rien ici : le moteur en a déjà tiré
le plan. L'action « préparer la pince » (`tourner` avec `tm`) n'a aucun déplacement à son propre instant : la rotation est
reportée au prochain trajet, dont le plan la contient (HOST `PENDING_ROT`, information sans commande ESP32).

PROTOCOLE SÉRIE : PROPOSÉ, à valider par l'équipe (docs/PROTOCOLE_ESP32.md). Aucune valeur numérique du protocole ne vient de la
spec : celles de `ParamsESP32` sont des HYPOTHÈSES nommées, chacune justifiée dans le document (§9). Le firmware n'existe pas
encore : `FirmwareSimule` le remplace, ligne à ligne, derrière la même couche de liaison (`ESP32Device`).
"""
from __future__ import annotations

import copy
import logging
import math
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence, Set, Tuple

from embarque.miroir import face_reelle, pose_miroir, rot_reelle
from embarque.spec import angles_nacelle_deg, depression_minimale_kpa, table_longueur_mm

try:
    import serial
except ImportError:  # pragma: no cover - dépend de la machine
    serial = None

logger = logging.getLogger("ESP32Bridge")
logger.setLevel(logging.INFO)

VERSION_PROTOCOLE = 1


# ---------------------------------------------------------------------------------------------------------------------
# Hypothèses (paramètres nommés ; aucune de ces valeurs n'est dans spec/*.json). Justifications : docs/PROTOCOLE_ESP32.md §9.
# ---------------------------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class ParamsESP32:
    # --- liaison ---
    # Débit proposé (sans effet sur l'USB natif). Le débit de l'ancien module (115200) n'avait pas de source.
    baudrate: int = 921600
    # Délai d'attente d'un accusé de réception (s). Hérité de l'ancien module (0,5 s), sans source.
    timeout_s: float = 0.5
    # Nombre d'essais de `HELLO` à l'ouverture (l'ESP32 peut redémarrer à l'ouverture du port). Hypothèse de réglage.
    essais_hello: int = 6
    # Délai d'attente de la fin de `INIT` (s). Hypothèse de réglage : l'étalonnage du zéro des capteurs de pression est du ressort du firmware.
    timeout_init_s: float = 10.0
    # Noms de ports hérités de l'ancien module (alias udev supposés). L'identité est vérifiée par `HELLO`, pas par le nom.
    nav_port: str = "/dev/ttyUSB_NAV"
    act_port: str = "/dev/ttyUSB_ACT"
    # --- chien de garde et télémétrie (proposés) ---
    watchdog_ms: int = 500
    periode_ping_s: float = 0.1
    telem_ms: int = 50
    # --- exécution des plans ---
    envoyer_limites: bool = True            # `SET_LIMITS <v_mm_s> <w_deg_s>` : valeurs de spec/robot.json (500 mm/s, 120 °/s, « declare »)
    envoyer_durees: bool = True             # `T=<ms>` sur Z, ROT, ASC : reproduit la coordination du moteur (proposé)
    chainer_trajectoires: bool = True       # segments NAV consécutifs -> une commande `PATH` (proposé)
    points_par_trajectoire: int = 8         # longueur maximale d'un `PATH` (200 octets par ligne)
    # Tolérance (s) pour dire qu'une commande commence quand une autre finit : instants lus dans des flottants du moteur.
    eps_t: float = 1e-6
    # Un axe est immobile sur un segment si sa valeur change de moins que cela (mm ou degrés) : même seuil que embarque/bridge.js.
    eps_val: float = 1e-6
    # Pas d'interrogation des fins de mouvement sur matériel réel (s). Hypothèse de réglage.
    poll_s: float = 0.01
    # Délai maximal d'une commande : facteur_delai x durée du moteur + marge_delai_s (hypothèses de réglage).
    facteur_delai: float = 3.0
    marge_delai_s: float = 2.0
    # Tir : marge (s) ajoutée à l'attente de la phase d'attaque. Hypothèse : 0 (aucune mesure ne justifie une marge).
    marge_avant_tir_s: float = 0.0
    # --- évitement (décidé par le Pi) ---
    periode_evitement_s: float = 0.1        # cadence du lidar (typique 10 Hz, fiche constructeur dans spec/robot.json)
    attente_evitement_max_s: float = 8.0    # 4 attentes de 2 s du moteur (engine.js, travel)
    # Repère : miroir de l'équipe bleue (CONTRATS §15, embarque/miroir.py) : x -> LONGUEUR - x, cap de la vraie face B en miroir
    # (h -> 180 - 120 - h), faces A <-> B (longueur lue dans la spec).
    largeur_table_mm: float = field(default_factory=table_longueur_mm)
    # H7 : le moteur échantillonne les mouvements aux instants où un AUTRE axe change. Chaque mouvement est réduit à ses points de
    #      passage (Ramer-Douglas-Peucker en fonction du temps) dont l'écart maximal à la trajectoire du moteur reste sous ces
    #      tolérances (mm ou degrés). Valeurs de réglage.
    tol_pos_mm: float = 1.0
    tol_cap_deg: float = 1.0
    tol_hc_mm: float = 1.0
    tol_rot_deg: float = 1.0
    tol_fourche_mm: float = 1.0
    # --- firmware simulé ---
    # Pression simulée d'une pompe en marche, en multiple du seuil de dépression de la spec (hypothèse de test : supérieur à 1).
    mock_vide_facteur: float = 2.0
    # Délai (s, temps simulé) entre `INIT` et le retrait de la tirette dans le scénario de test. None : la tirette ne bouge pas seule.
    mock_delai_tirette_s: Optional[float] = 1.0


PARAMS = ParamsESP32()


class BriqueNonPriseEnCharge(ValueError):
    """La brique n'a pas de traduction en commandes ESP32."""


class ErreurLiaison(RuntimeError):
    """Liaison série impossible, ESP32 absent, rôle ou version de protocole inattendus, commande refusée à l'initialisation."""


# Briques que le catalogue v3 peut émettre (ACTIONS.toProgramStep) et celles du programme de référence.
BRIQUES_PRISES_EN_CHARGE = frozenset({
    "prendre", "mur", "tour", "porte", "tir", "boulets", "monterGraal", "trone",
    "attendre", "attendreJusqua", "seDeplacer", "tourner", "deposerZone", "lacher", "deposer", "traj",
})

# Groupes de commandes (parallélisme, tests). NAV est sur l'ESP32 n°1, tous les autres sur l'ESP32 n°2.
GROUPES_ACT_MOUVEMENT = ("Z_A", "ROT_A", "Z_B", "ROT_B", "ASC", "TIR")


# ---------------------------------------------------------------------------------------------------------------------
# Commandes
# ---------------------------------------------------------------------------------------------------------------------
@dataclass
class Commande:
    """Une commande d'un périphérique. Instants relatifs au début de la brique, en secondes (ceux du moteur)."""
    id: int
    dev: str                      # 'NAV', 'ACT' ou 'HOST' (exécutée par le Pi, sans message série)
    texte: str
    t0: float
    t1: float
    groupe: str                   # NAV, Z_A, ROT_A, Z_B, ROT_B, ASC, TIR, PUMP_A, PUMP_B, HOST
    deps: Tuple[int, ...] = ()
    no_avant: Optional[float] = None   # instant de match (s) avant lequel la commande ne part pas (tir : début de la phase d'attaque)
    cible: Optional[Tuple[float, float, float]] = None   # NAV : pose visée (x, y, h) dans le repère RÉEL de la table

    @property
    def duree(self) -> float:
        return max(0.0, self.t1 - self.t0)


def _h_norm(h: float) -> float:
    """Cap ramené dans ]-180, 180] (le moteur cumule les rotations ; le firmware prend le plus court chemin)."""
    v = (h + 180.0) % 360.0 - 180.0
    return 180.0 if v == -180.0 else v


def _mirror_xy_h(x: float, y: float, h: float, equipe: str, largeur: float) -> Tuple[float, float, float]:
    """Repère de l'équipe -> repère réel (CONTRATS §15) : bleu, x -> largeur - x, cap de la face A de l'équipe = vraie face B."""
    return pose_miroir(x, y, h, equipe, largeur)


def _simplifier(pts: List[dict], tol: Sequence[float]) -> List[dict]:
    """Ramer-Douglas-Peucker sur (t, v) : garde les extrémités et les points dont l'écart à l'interpolation linéaire dépasse tol."""
    if len(pts) <= 2:
        return pts
    garde = [False] * len(pts)
    garde[0] = garde[-1] = True
    pile = [(0, len(pts) - 1)]
    while pile:
        a, b = pile.pop()
        pa, pb = pts[a], pts[b]
        dt = pb["t"] - pa["t"]
        pire, k = 0.0, -1
        for i in range(a + 1, b):
            u = (pts[i]["t"] - pa["t"]) / dt if dt > 0 else 0.0
            e = max(abs(pts[i]["v"][c] - (pa["v"][c] + (pb["v"][c] - pa["v"][c]) * u)) / tol[c] for c in range(len(tol)))
            if e > pire:
                pire, k = e, i
        if pire > 1.0 and k > 0:
            garde[k] = True
            pile += [(a, k), (k, b)]
    return [p for p, g in zip(pts, garde) if g]


def _mouvements_de_l_axe(pts: List[dict], eps: float) -> List[List[dict]]:
    """Découpe la série d'un seul axe en mouvements : suites de points consécutifs dont la valeur change. Les paliers (valeur
    constante, souvent parce qu'un AUTRE axe du même groupe bouge) n'en font pas partie : l'axe n'a pas de commande à ces instants."""
    runs: List[List[dict]] = []
    for p, q in zip(pts[:-1], pts[1:]):
        if abs(q["v"][0] - p["v"][0]) <= eps:
            continue
        if runs and runs[-1][-1] is p:
            runs[-1].append(q)
        else:
            runs.append([p, q])
    return runs


def _suffixe_duree(t0: float, t1: float, params: ParamsESP32) -> str:
    """` T=<ms>` (millisecondes, décimales admises) si le mouvement dure ; rien pour un saut instantané du moteur."""
    return f" T={(t1 - t0) * 1000.0:.3f}" if params.envoyer_durees and t1 - t0 > 0 else ""


def traduire(plan: dict, equipe: str = "yellow", params: ParamsESP32 = PARAMS) -> List[Commande]:
    """Plan d'une brique (embarque/bridge.js : extractPlan, repère de l'équipe) -> commandes ESP32 triées.

    Lève BriqueNonPriseEnCharge pour une brique ou un groupe inconnu. Les dépendances reproduisent le temps masqué du moteur :
    la commande j dépend de la commande i (placée avant elle) si i se terminait avant le début de j.

    Correspondance (docs/PROTOCOLE_ESP32.md §7) : x, y, h -> GOTO (NAV) ; hc -> Z ; rot -> ROT ; fx, fz -> ASC ; ventouses -> PUMP
    (une pompe par rangée) ; sortie du canon + mise en route + boulets -> UNE commande TIR (le firmware gère le reste).
    """
    brique = plan.get("brique") or {}
    kind = brique.get("a")
    if kind not in BRIQUES_PRISES_EN_CHARGE:
        raise BriqueNonPriseEnCharge(f"brique « {kind} » : pas de traduction ESP32 ({brique})")
    cmds: List[Commande] = []

    def add(dev: str, texte: str, t0: float, t1: float, groupe: str, no_avant: Optional[float] = None,
            cible: Optional[Tuple[float, float, float]] = None) -> None:
        cmds.append(Commande(len(cmds), dev, texte, float(t0), float(t1), groupe, no_avant=no_avant, cible=cible))

    canon: List[Tuple[float, float]] = []                 # sortie du canon (absorbée dans la séance de tir)
    for mv in plan.get("moves", []):
        g, pts = mv["g"], mv["pts"]
        if g == "NAV":
            pts = _simplifier(pts, (params.tol_pos_mm, params.tol_pos_mm, params.tol_cap_deg))
            for p, q in zip(pts[:-1], pts[1:]):
                x, y, h = _mirror_xy_h(q["v"][0], q["v"][1], q["v"][2], equipe, params.largeur_table_mm)
                h = _h_norm(h)
                add("NAV", f"GOTO {x:.1f} {y:.1f} {h:.1f}", p["t"], q["t"], "NAV", cible=(round(x, 1), round(y, 1), round(h, 1)))
        elif g in ("GRIP_A", "GRIP_B"):
            face = face_reelle(g[-1], equipe)            # bleu : la face A de l'équipe est la vraie face B (CONTRATS §15)
            for axe, i, tol in (("Z", 0, params.tol_hc_mm), ("ROT", 1, params.tol_rot_deg)):     # hc -> vérin Z ; rot -> rotation
                # bleu : angle de l'équipe +θ = angle réel -θ (CONTRATS §16 ; 0 et 180 inchangés)
                val = (lambda v: rot_reelle(v, equipe)) if axe == "ROT" else float
                for run in _mouvements_de_l_axe([{"t": p["t"], "v": [val(p["v"][i])]} for p in pts], params.eps_val):
                    run = _simplifier(run, (tol,))
                    for p, q in zip(run[:-1], run[1:]):
                        add("ACT", f"{axe} {face} {q['v'][0]:.1f}{_suffixe_duree(p['t'], q['t'], params)}", p["t"], q["t"], f"{axe}_{face}")
        elif g == "FORK":
            pts = _simplifier(pts, (params.tol_fourche_mm,) * 2)
            for p, q in zip(pts[:-1], pts[1:]):
                add("ACT", f"ASC {q['v'][0]:.1f} {q['v'][1]:.1f}{_suffixe_duree(p['t'], q['t'], params)}", p["t"], q["t"], "ASC")
        elif g == "CANON":
            canon.append((pts[0]["t"], pts[-1]["t"]))
        else:
            raise BriqueNonPriseEnCharge(f"groupe de mouvement inconnu « {g} » (brique {kind})")
    spin = fire = None
    for ev in plan.get("events", []):
        k = ev["kind"]
        if k == "VAC":
            r, fr = ev["rows"], face_reelle(ev["face"], equipe)
            add("ACT", f"PUMP {fr} {int(r[0])} {int(r[1])} {int(r[2])}", ev["t0"], ev["t1"], "PUMP_" + fr)
        elif k == "CANON_SPIN":
            spin = ev
        elif k == "FIRE":
            fire = ev
        elif k == "WAIT":
            texte = f"WAIT_UNTIL {ev['until']:g}" if ev.get("until") is not None else f"WAIT {ev['t1'] - ev['t0']:.3f}"
            add("HOST", texte, ev["t0"], ev["t1"], "HOST")
        else:
            raise BriqueNonPriseEnCharge(f"événement inconnu « {k} » (brique {kind})")
    if fire is not None:
        # Séance de tir : UNE commande. Le firmware ne connaît pas l'horloge du match et enchaîne seul la sortie du canon, la mise en
        # route et les boulets : le Pi l'envoie assez tard pour que le premier boulet parte à l'instant du moteur (qui attend le début
        # de la phase d'attaque après la préparation), sans jamais avant `noAvant` moins la préparation.
        prep = sum(b - a for a, b in canon) + ((spin["t1"] - spin["t0"]) if spin else 0.0)
        t_debut = max(0.0, fire["t0"] - prep)
        no_avant = fire.get("noAvant")
        add("ACT", "TIR", t_debut, fire["t1"], "TIR", None if no_avant is None else no_avant - prep + params.marge_avant_tir_s)
    # « Préparer la pince » : rotation demandée en temps masqué, sans mouvement à cet instant (reportée au prochain trajet).
    if kind == "tourner" and brique.get("tm") and not any(c.groupe.startswith(("Z_", "ROT_")) for c in cmds):
        cmds.append(Commande(len(cmds), "HOST", f"PENDING_ROT {face_reelle(brique['f'], equipe)} {rot_reelle(brique['r'], equipe):g}",
                             0.0, 0.0, "HOST"))
    # tri puis dépendances
    cmds.sort(key=lambda c: (c.t0, c.t1, c.id))
    for n, c in enumerate(cmds):
        c.id = n
    tous: List[Set[int]] = []
    for j, c in enumerate(cmds):
        avant = {i.id for i in cmds[:j] if i.t1 <= c.t0 + params.eps_t}
        tous.append(avant)
        # réduction transitive : une dépendance déjà impliquée par une autre est inutile (une commande ne finit qu'après les siennes)
        c.deps = tuple(sorted(d for d in avant if not any(d in tous[e] for e in avant if e != d)))
    return cmds


def chevauchements(cmds: Sequence[Commande], eps: float = PARAMS.eps_t) -> Set[Tuple[str, str]]:
    """Paires de groupes (triées) dont des commandes se recouvrent dans le temps : le parallélisme du plan."""
    out: Set[Tuple[str, str]] = set()
    for a in range(len(cmds)):
        for b in range(a + 1, len(cmds)):
            x, y = cmds[a], cmds[b]
            if x.groupe == y.groupe or "HOST" in (x.groupe, y.groupe):
                continue
            if min(x.t1, y.t1) - max(x.t0, y.t0) > eps:
                out.add(tuple(sorted((x.groupe, y.groupe))))  # type: ignore[arg-type]
    return out


# ---------------------------------------------------------------------------------------------------------------------
# États renvoyés par les ESP32
# ---------------------------------------------------------------------------------------------------------------------
@dataclass
class EtatActionneurs:
    """Ligne `STATUS` de l'ESP32 ACT : hauteur d'axe et angle des nacelles, dépression par pompe (kPa), fourche, séance de tir, tirette."""
    grip: Dict[str, Tuple[float, float]] = field(default_factory=lambda: {"A": (0.0, 0.0), "B": (0.0, 0.0)})      # face -> (hc mm, rot °)
    pression: Dict[str, Tuple[float, float, float]] = field(default_factory=lambda: {"A": (0.0, 0.0, 0.0), "B": (0.0, 0.0, 0.0)})  # kPa, rangées 1..3
    fourche: Tuple[float, float] = (0.0, 0.0)                                # (fx, fz) mm
    tir: str = "IDLE"                                                        # IDLE, RUN ou DONE
    tirette: Optional[int] = None                                            # 1 = en place, 0 = retirée
    # Seuil de dépression d'une pierre tenue : spec/robot.json (ventouses.depression_minimale_kPa, statut « propose »).
    seuil_vide_kpa: float = field(default_factory=depression_minimale_kpa)

    @property
    def tenue(self) -> Dict[str, Tuple[int, int, int]]:
        """face -> rangées 1..3 : 1 si la dépression atteint le seuil (pierre tenue)."""
        return {f: tuple(1 if p >= self.seuil_vide_kpa else 0 for p in v) for f, v in self.pression.items()}  # type: ignore[misc]


_CLES_STATUS = (("Z_A", 1), ("ROT_A", 1), ("Z_B", 1), ("ROT_B", 1), ("VAC_A", 3), ("VAC_B", 3), ("ASC", 2), ("TIR", 1), ("TIRETTE", 1))


def format_status(e: EtatActionneurs) -> str:
    g, p = e.grip, e.pression
    s = ("STATUS Z_A {:.1f} ROT_A {:.1f} Z_B {:.1f} ROT_B {:.1f} VAC_A {:.1f} {:.1f} {:.1f} VAC_B {:.1f} {:.1f} {:.1f} ASC {:.1f} {:.1f} TIR {}"
         .format(g["A"][0], g["A"][1], g["B"][0], g["B"][1], *p["A"], *p["B"], *e.fourche, e.tir))
    return s + (f" TIRETTE {e.tirette}" if e.tirette is not None else "")


def parse_status(ligne: str, seuil_vide_kpa: Optional[float] = None) -> EtatActionneurs:
    """`STATUS Z_A hc ROT_A rot Z_B hc ROT_B rot VAC_A k1 k2 k3 VAC_B k1 k2 k3 ASC fx fz TIR etat [TIRETTE v]` (docs/PROTOCOLE_ESP32.md §5.7)."""
    t = ligne.split()
    if not t or t[0] != "STATUS":
        raise ValueError(f"réponse STATUS illisible : {ligne!r}")
    arite = dict(_CLES_STATUS)
    d: Dict[str, List[str]] = {}
    i = 1
    while i < len(t):
        cle = t[i]
        n = arite.get(cle, -1)
        if n < 0 or i + 1 + n > len(t):
            raise ValueError(f"réponse STATUS illisible : {ligne!r}")
        d[cle] = t[i + 1: i + 1 + n]
        i += 1 + n
    try:
        e = EtatActionneurs(seuil_vide_kpa=seuil_vide_kpa) if seuil_vide_kpa is not None else EtatActionneurs()
        for f in ("A", "B"):
            e.grip[f] = (float(d["Z_" + f][0]), float(d["ROT_" + f][0]))
            e.pression[f] = tuple(float(x) for x in d["VAC_" + f])  # type: ignore[assignment]
        e.fourche = (float(d["ASC"][0]), float(d["ASC"][1]))
        e.tir = d["TIR"][0]
        e.tirette = int(d["TIRETTE"][0]) if "TIRETTE" in d else None
    except (KeyError, ValueError) as ex:
        raise ValueError(f"réponse STATUS illisible : {ligne!r}") from ex
    return e


def parse_pose(ligne: str) -> Tuple[float, float, float]:
    """`POSE x y h [ETAT]`, repère réel de la table."""
    t = ligne.split()
    if len(t) < 4 or t[0] != "POSE":
        raise ValueError(f"réponse POSE illisible : {ligne!r}")
    return float(t[1]), float(t[2]), float(t[3])


# ---------------------------------------------------------------------------------------------------------------------
# Lignes reçues
# ---------------------------------------------------------------------------------------------------------------------
@dataclass
class Evenement:
    """Une ligne de l'ESP32 : ACK, NAK, DONE, FAIL, ABORT, WPT (avec identifiant), PONG, HELLO, EVT, ERR."""
    type: str
    id: Optional[int]
    args: Tuple[str, ...]
    ligne: str


_TYPES_AVEC_ID = frozenset({"ACK", "NAK", "DONE", "FAIL", "ABORT", "WPT"})
_TYPES_SANS_ID = frozenset({"PONG", "HELLO", "POSE", "STATUS", "EVT", "ERR"})
_RE_ID = re.compile(r"^#(\d+)$")


def parse_ligne(ligne: str) -> Optional[Evenement]:
    """Ligne reçue -> événement ; None pour une ligne inconnue (journaux de démarrage de l'ESP32 compris)."""
    t = ligne.strip().split()
    if not t:
        return None
    if t[0] in _TYPES_AVEC_ID:
        m = _RE_ID.match(t[1]) if len(t) > 1 else None
        return Evenement(t[0], int(m.group(1)), tuple(t[2:]), ligne.strip()) if m else None
    if t[0] in _TYPES_SANS_ID:
        return Evenement(t[0], None, tuple(t[1:]), ligne.strip())
    return None


# ---------------------------------------------------------------------------------------------------------------------
# Horloges
# ---------------------------------------------------------------------------------------------------------------------
class HorlogeReelle:
    virtuelle = False

    def now(self) -> float:
        return time.monotonic()

    def sleep(self, dt: float) -> None:
        if dt > 0:
            time.sleep(dt)


class HorlogeVirtuelle:
    """Temps simulé : sleep avance l'horloge (tests et mode MOCK, sans attendre)."""

    virtuelle = True

    def __init__(self) -> None:
        self.t = 0.0

    def now(self) -> float:
        return self.t

    def sleep(self, dt: float) -> None:
        self.t += max(0.0, dt)


# ---------------------------------------------------------------------------------------------------------------------
# Liaison avec un ESP32 (réel ou simulé)
# ---------------------------------------------------------------------------------------------------------------------
class ESP32Device:
    """Liaison série ligne à ligne avec un ESP32 : écriture, lecture non bloquante, ventilation des lignes reçues.

    Même code pour le robot et pour la simulation : en simulation, `liaison` est une `SerieSimulee` branchée sur un `FirmwareSimule`.
    Les accusés (ACK, NAK) et les résultats (DONE, FAIL, ABORT, WPT) vont dans un tampon lu par `attendre_reponse` ou `prendre` ;
    les lignes POSE et STATUS mettent à jour les derniers états connus, sans passer par le tampon.
    """

    def __init__(self, name: str, role: str, port: str, baudrate: int = PARAMS.baudrate, timeout: float = PARAMS.timeout_s,
                 liaison: Any = None, firmware: Optional["FirmwareSimule"] = None, params: ParamsESP32 = PARAMS):
        self.name, self.role, self.port, self.baudrate, self.timeout = name, role, port, baudrate, timeout
        self.params = params
        self.liaison = liaison
        self.firmware = firmware
        self.journal: List[str] = []                       # lignes envoyées (hors PING)
        self.derniere_pose: Optional[Tuple[float, float, float]] = None
        self.dernier_statut: Optional[EtatActionneurs] = None
        self.tirette: Optional[int] = None
        self.erreurs: List[str] = []                       # lignes ERR reçues
        self._n_pose = self._n_statut = 0
        self._buf = b""
        self._tampon: List[Evenement] = []
        self._verrou = threading.Lock()
        self._ping_actif = False
        self._ping_thread: Optional[threading.Thread] = None

    @property
    def virtuel(self) -> bool:
        return bool(getattr(self.liaison, "virtuelle", False))

    # ---- ouverture -----------------------------------------------------------------------------------------------------
    def connect(self) -> bool:
        """Ouvre le port (sauf liaison simulée) puis vérifie le rôle et la version du protocole par `HELLO`. Pas de repli silencieux."""
        if self.liaison is None:
            if serial is None:
                logger.error("[%s] pyserial n'est pas installé : liaison impossible", self.name)
                return False
            try:
                self.liaison = serial.Serial(port=self.port, baudrate=self.baudrate, timeout=0, write_timeout=self.timeout)
                time.sleep(0.1)  # initialisation du bootloader ESP32
                self.liaison.reset_input_buffer()
                self.liaison.reset_output_buffer()
            except Exception as e:  # noqa: BLE001
                logger.error("[%s] ouverture de %s impossible (%s)", self.name, self.port, e)
                self.liaison = None
                return False
        return self.handshake()

    def handshake(self) -> bool:
        for _ in range(max(1, self.params.essais_hello)):
            try:
                self.ecrire("HELLO")
            except ErreurLiaison as e:
                logger.error("[%s] %s", self.name, e)
                return False
            e = self._attendre(lambda x: x.type == "HELLO", self.timeout)
            if e is None:
                continue
            role = e.args[0] if e.args else "?"
            version = e.args[1] if len(e.args) > 1 else "?"
            if role != self.role or version != str(VERSION_PROTOCOLE):
                logger.error("[%s] attendu %s protocole %d, reçu %s protocole %s (ports inversés ?)", self.name, self.role,
                             VERSION_PROTOCOLE, role, version)
                return False
            logger.info("[%s] connecté sur %s (%s)", self.name, self.port, e.ligne)
            return True
        logger.error("[%s] pas de réponse à HELLO sur %s", self.name, self.port)
        return False

    # ---- écriture ------------------------------------------------------------------------------------------------------
    def ecrire(self, ligne: str, journal: bool = True) -> None:
        if self.liaison is None or not getattr(self.liaison, "is_open", True):
            raise ErreurLiaison(f"[{self.name}] liaison fermée")
        with self._verrou:
            try:
                self.liaison.write((ligne + "\n").encode("utf-8"))
                flush = getattr(self.liaison, "flush", None)
                if flush:
                    flush()
            except Exception as e:  # noqa: BLE001
                raise ErreurLiaison(f"[{self.name}] écriture impossible ({e})") from e
        if journal:
            self.journal.append(ligne)

    def envoyer(self, texte: str, pid: int) -> None:
        """Envoie `texte #pid`."""
        self.ecrire(f"{texte} #{pid}")

    def ping(self) -> None:
        self.ecrire("PING", journal=False)

    def demarrer_ping(self, periode_s: float) -> None:
        """Fil d'entretien du chien de garde (robot réel) : un `PING` toutes les `periode_s`, même pendant le calcul du réseau."""
        if self._ping_thread is not None:
            return
        self._ping_actif = True

        def boucle() -> None:
            while self._ping_actif:
                try:
                    self.ping()
                except ErreurLiaison:
                    pass
                time.sleep(periode_s)

        self._ping_thread = threading.Thread(target=boucle, name=f"ping-{self.name}", daemon=True)
        self._ping_thread.start()

    # ---- lecture -------------------------------------------------------------------------------------------------------
    def sonder(self) -> None:
        """Lit les octets disponibles (sans bloquer) et ventile les lignes complètes."""
        lig = self.liaison
        if lig is None or not getattr(lig, "is_open", True):
            return
        try:
            n = lig.in_waiting
            data = lig.read(n) if n else b""
        except Exception as e:  # noqa: BLE001
            logger.error("[%s] lecture impossible (%s)", self.name, e)
            return
        if not data:
            return
        self._buf += data
        *lignes, self._buf = self._buf.split(b"\n")
        for brut in lignes:
            self._ingerer(brut.decode("utf-8", "replace").strip())

    def _ingerer(self, ligne: str) -> None:
        e = parse_ligne(ligne)
        if e is None:
            return
        try:
            if e.type == "POSE":
                self.derniere_pose, self._n_pose = parse_pose(ligne), self._n_pose + 1
                return
            if e.type == "STATUS":
                self.dernier_statut, self._n_statut = parse_status(ligne), self._n_statut + 1
                if self.dernier_statut.tirette is not None:
                    self.tirette = self.dernier_statut.tirette
                return
        except ValueError as ex:
            logger.warning("[%s] %s", self.name, ex)
            return
        if e.type == "PONG":
            return
        if e.type == "EVT" and len(e.args) >= 2 and e.args[0] == "TIRETTE":
            try:
                self.tirette = int(e.args[1])
            except ValueError:
                pass
            return
        if e.type == "ERR":
            self.erreurs.append(e.ligne)
            logger.warning("[%s] %s", self.name, e.ligne)
            return
        self._tampon.append(e)

    def prendre(self) -> List[Evenement]:
        """Événements reçus et pas encore lus (ordre d'arrivée)."""
        out, self._tampon = self._tampon, []
        return out

    def _attendre(self, trouve: Callable[[Evenement], bool], timeout: float) -> Optional[Evenement]:
        fin = time.monotonic() + timeout
        while True:
            self.sonder()
            for e in self._tampon:
                if trouve(e):
                    self._tampon.remove(e)
                    return e
            if self.virtuel or time.monotonic() >= fin:
                return None
            time.sleep(0.001)

    def attendre_reponse(self, pid: int, types: Tuple[str, ...] = ("ACK", "NAK"), timeout: Optional[float] = None) -> Optional[Evenement]:
        """Premier événement de type `types` portant l'identifiant `pid` ; None si le délai est dépassé (jamais attendu en simulation)."""
        return self._attendre(lambda e: e.id == pid and e.type in types, self.timeout if timeout is None else timeout)

    def interroger(self, requete: str, genre: str) -> Any:
        """Envoie `POSE?` ou `STATUS?` et renvoie la ligne POSE / STATUS reçue ensuite."""
        n0 = self._n_pose if genre == "POSE" else self._n_statut
        self.ecrire(requete)
        fin = time.monotonic() + self.timeout
        while True:
            self.sonder()
            if (self._n_pose if genre == "POSE" else self._n_statut) > n0:
                return self.derniere_pose if genre == "POSE" else self.dernier_statut
            if self.virtuel or time.monotonic() >= fin:
                raise ErreurLiaison(f"[{self.name}] pas de réponse à {requete}")
            time.sleep(0.001)

    def close(self) -> None:
        self._ping_actif = False
        lig = self.liaison
        if lig is not None and getattr(lig, "is_open", False):
            try:
                lig.close()
            except Exception:  # noqa: BLE001
                pass


# ---------------------------------------------------------------------------------------------------------------------
# Firmware simulé (mock) : parle le protocole, ligne à ligne, en temps simulé
# ---------------------------------------------------------------------------------------------------------------------
class SerieSimulee:
    """Port série factice branché sur un FirmwareSimule (même interface que pyserial : write, read, in_waiting, close)."""
    virtuelle = True

    def __init__(self, firmware: "FirmwareSimule"):
        self.fw = firmware
        self.is_open = True
        self._entree = b""
        self._sortie = b""
        self._verrou = threading.RLock()       # le fil d'entretien du chien de garde écrit pendant que le fil principal lit

    def write(self, data: bytes) -> int:
        with self._verrou:
            self._entree += data
            *lignes, self._entree = self._entree.split(b"\n")
            for brut in lignes:
                self.fw.recevoir(brut.decode("utf-8", "replace"))
        return len(data)

    def _tirer(self) -> None:
        with self._verrou:
            lignes = self.fw.vider()
            if lignes:
                self._sortie += ("\n".join(lignes) + "\n").encode("utf-8")

    @property
    def in_waiting(self) -> int:
        self._tirer()
        return len(self._sortie)

    def read(self, n: int = 1) -> bytes:
        with self._verrou:
            self._tirer()
            d, self._sortie = self._sortie[:n], self._sortie[n:]
            return d

    def flush(self) -> None:
        pass

    def reset_input_buffer(self) -> None:
        pass

    reset_output_buffer = reset_input_buffer

    def close(self) -> None:
        self.is_open = False


def _delta_cap(a: float, b: float) -> float:
    return _h_norm(b - a)


class FirmwareSimule:
    """ESP32 simulé qui parle le protocole de docs/PROTOCOLE_ESP32.md (rôle NAV ou ACT) avec le temps de l'horloge fournie.

    Ce n'est pas le firmware : il n'a ni vérins, ni moteurs. Durée d'un mouvement : `T=` si la commande en porte une ; sinon, pour
    NAV, distance / vitesse de `SET_LIMITS` ; sinon le mouvement est instantané. Le canal `programmee` (durées nominales du plan,
    par identifiant de commande) n'existe pas dans le protocole : il sert aux tests pour rejouer exactement les durées du moteur
    et pour injecter des retards ; il l'emporte sur `T=`.
    """

    def __init__(self, role: str, horloge: Any, params: ParamsESP32 = PARAMS):
        assert role in ("NAV", "ACT")
        self.role, self.hz, self.params = role, horloge, params
        self.journal: List[str] = []
        self.programmee: Dict[int, List[float]] = {}
        self._sortie: List[str] = []
        self.watchdog_s: Optional[float] = None
        self.derniere_rx: Optional[float] = None
        self._securite = False
        self.telem_s: Optional[float] = None
        self._prochaine_telem = 0.0
        self.vide_min_kpa: Optional[float] = None
        # NAV
        self.pose: Tuple[float, float, float] = (0.0, 0.0, 0.0)
        self.limites: Optional[Tuple[float, float]] = None
        self._nav: Optional[dict] = None
        self._nav_stoppe = False
        # ACT
        self.etat = EtatActionneurs()
        self.etat_initial: Optional[EtatActionneurs] = None
        self.pompes: Dict[str, Tuple[int, int, int]] = {"A": (0, 0, 0), "B": (0, 0, 0)}
        self._voies: Dict[str, dict] = {}
        self.tirette = 1
        self._retrait_a: Optional[float] = None

    # ---- sortie --------------------------------------------------------------------------------------------------------
    def _emettre(self, ligne: str) -> None:
        self._sortie.append(ligne)

    def vider(self) -> List[str]:
        self.mise_a_jour()
        out, self._sortie = self._sortie, []
        return out

    def retirer_tirette(self) -> None:
        """Scénario de test : la tirette est retirée maintenant."""
        if self.role == "ACT" and self.tirette == 1:
            self.tirette = 0
            self.etat.tirette = 0
            self._emettre("EVT TIRETTE 0")

    # ---- temps ---------------------------------------------------------------------------------------------------------
    def prochaine_echeance(self) -> Optional[float]:
        """Prochain instant (horloge) où un mouvement ou un point de passage se termine, ou None."""
        c: List[float] = []
        if self._nav:
            c.append(self._nav["t0"] + self._nav["cum"][self._nav["k"]])
        c += [v["t0"] + v["dur"] for v in self._voies.values()]
        if self._retrait_a is not None and self.tirette == 1:
            c.append(self._retrait_a)
        return min(c) if c else None

    def mise_a_jour(self) -> None:
        now = self.hz.now()
        if (self.watchdog_s and self.derniere_rx is not None and not self._securite
                and now - self.derniere_rx > self.watchdog_s):
            self._securite_watchdog(now)
        if self.role == "NAV":
            self._avancer_nav(now)
        else:
            self._avancer_act(now)
        if self.telem_s and now >= self._prochaine_telem:
            self._emettre(self._ligne_etat())
            self._prochaine_telem = now + self.telem_s

    def _ligne_etat(self) -> str:
        if self.role == "NAV":
            return "POSE {:.1f} {:.1f} {:.1f} {}".format(*self._pose_nav(self.hz.now()), self._etat_nav())
        self.etat.tirette = self.tirette
        return format_status(self.etat)

    def _securite_watchdog(self, now: float) -> None:
        self._securite = True
        if self.role == "NAV" and self._nav:
            self.pose = self._pose_nav(now)
            self._emettre(f"ABORT #{self._nav['id']} WATCHDOG")
            self._nav = None
            self._nav_stoppe = True
        for voie, v in list(self._voies.items()):
            self._emettre(f"ABORT #{v['id']} WATCHDOG")
            if voie == "TIR":
                self.etat.tir = "IDLE"
        self._voies.clear()
        self._emettre("ERR WATCHDOG")

    # ---- réception -----------------------------------------------------------------------------------------------------
    def recevoir(self, ligne: str) -> None:
        self.mise_a_jour()
        l = ligne.strip()
        if not l:
            return
        if l != "PING":
            self.journal.append(l)
        self.derniere_rx = self.hz.now()
        self._securite = False
        t = l.split()
        pid: Optional[int] = None
        args: List[str] = []
        for w in t[1:]:
            m = _RE_ID.match(w)
            if m:
                pid = int(m.group(1))
            else:
                args.append(w)
        op = t[0]
        nak = (lambda code, txt="": self._emettre(f"NAK #{pid} {code} {txt}".rstrip())) if pid is not None else (lambda code, txt="": self._emettre(f"ERR {code} {txt}".rstrip()))
        try:
            if op == "PING":
                self._emettre("PONG")
            elif op == "HELLO":
                self._emettre(f"HELLO {self.role} {VERSION_PROTOCOLE} simule")
                if self.role == "ACT":
                    self._emettre(f"EVT TIRETTE {self.tirette}")
            elif op == "CFG":
                self._cfg(pid, args, nak)
            elif op == "STOP":
                self._stop(pid)
            elif self.role == "NAV" and op in ("SET_POSE", "SET_LIMITS", "GOTO", "PATH", "POSE?"):
                self._cmd_nav(op, args, pid, nak)
            elif self.role == "ACT" and op in ("INIT", "Z", "ROT", "ASC", "PUMP", "TIR", "STATUS?"):
                self._cmd_act(op, args, pid, nak)
            else:
                nak("UNKNOWN", op)
        except (IndexError, ValueError) as ex:
            nak("SYNTAX", str(ex))
        self.mise_a_jour()

    def _cfg(self, pid: Optional[int], args: List[str], nak: Callable[..., None]) -> None:
        cle, val = args[0], float(args[1])
        if cle == "WATCHDOG_MS":
            self.watchdog_s = val / 1000.0 if val > 0 else None
        elif cle == "TELEM_MS":
            self.telem_s = val / 1000.0 if val > 0 else None
            self._prochaine_telem = self.hz.now()
        elif cle == "VIDE_MIN_KPA" and self.role == "ACT":
            self.vide_min_kpa = val
        else:
            return nak("RANGE", cle)
        self._emettre(f"ACK #{pid}")

    # ---- NAV -----------------------------------------------------------------------------------------------------------
    def _etat_nav(self) -> str:
        return "MOVING" if self._nav else ("STOPPED" if self._nav_stoppe else "IDLE")

    def _pose_nav(self, now: float) -> Tuple[float, float, float]:
        mv = self._nav
        if not mv:
            return self.pose
        el, k = now - mv["t0"], 0
        while k < len(mv["cum"]) - 1 and el >= mv["cum"][k]:
            k += 1
        a = mv["dep"] if k == 0 else mv["pts"][k - 1]
        b = mv["pts"][k]
        d0 = mv["cum"][k - 1] if k else 0.0
        u = 1.0 if mv["cum"][k] <= d0 else min(1.0, max(0.0, (el - d0) / (mv["cum"][k] - d0)))
        return (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, _h_norm(a[2] + _delta_cap(a[2], b[2]) * u))

    def _durees_calculees(self, pts: List[Tuple[float, float, float]]) -> List[float]:
        out, p = [], self.pose
        for q in pts:
            if self.limites:
                out.append(max(math.hypot(q[0] - p[0], q[1] - p[1]) / self.limites[0], abs(_delta_cap(p[2], q[2])) / self.limites[1]))
            else:
                out.append(0.0)
            p = q
        return out

    def _cmd_nav(self, op: str, args: List[str], pid: Optional[int], nak: Callable[..., None]) -> None:
        if op == "POSE?":
            return self._emettre(self._ligne_etat())
        if op == "SET_POSE":
            if self._nav:
                return nak("BUSY")
            self.pose = (float(args[0]), float(args[1]), float(args[2]))
        elif op == "SET_LIMITS":
            self.limites = (float(args[0]), float(args[1]))
        else:   # GOTO, PATH
            if self._nav:
                return nak("BUSY")
            if op == "GOTO":
                pts = [(float(args[0]), float(args[1]), float(args[2]))]
            else:
                n = int(args[0])
                v = [float(x) for x in args[1:]]
                if n < 1 or len(v) != 3 * n:
                    return nak("SYNTAX", "PATH")
                pts = [(v[3 * i], v[3 * i + 1], v[3 * i + 2]) for i in range(n)]
            durees = self.programmee.get(pid) if pid is not None else None
            if durees is None or len(durees) != len(pts):
                durees = self._durees_calculees(pts)
            cum, s = [], 0.0
            for d in durees:
                s += d
                cum.append(s)
            self._nav = {"id": pid, "t0": self.hz.now(), "pts": pts, "cum": cum, "k": 0, "dep": self.pose}
            self._nav_stoppe = False
        self._emettre(f"ACK #{pid}")

    def _avancer_nav(self, now: float) -> None:
        mv = self._nav
        while mv is not None and now - mv["t0"] >= mv["cum"][mv["k"]] - 1e-9:
            mv["k"] += 1
            if mv["k"] < len(mv["pts"]):
                self._emettre(f"WPT #{mv['id']} {mv['k']}")
            else:
                self.pose = mv["pts"][-1]
                self._emettre(f"DONE #{mv['id']}")
                self._nav = mv = None

    # ---- STOP (NAV : arrêt d'évitement ; ACT : arrêt des axes) ---------------------------------------------------------------
    def _stop(self, pid: Optional[int]) -> None:
        self._emettre(f"ACK #{pid}")
        now = self.hz.now()
        if self.role == "NAV":
            if self._nav:
                self.pose = self._pose_nav(now)
                self._emettre(f"ABORT #{self._nav['id']} STOP")
                self._nav = None
            self._nav_stoppe = True
        else:
            for voie, v in list(self._voies.items()):
                if voie.startswith("PUMP"):
                    continue
                self._emettre(f"ABORT #{v['id']} STOP")
                if voie == "TIR":
                    self.etat.tir = "IDLE"
                else:
                    self._appliquer(voie, self._valeur_voie(voie, v, now))
                del self._voies[voie]
        self._emettre(f"DONE #{pid}")

    # ---- ACT -----------------------------------------------------------------------------------------------------------
    def _valeur(self, voie: str) -> Tuple[float, ...]:
        e = self.etat
        if voie.startswith("Z_"):
            return (e.grip[voie[-1]][0],)
        if voie.startswith("ROT_"):
            return (e.grip[voie[-1]][1],)
        if voie == "ASC":
            return e.fourche
        return ()

    def _appliquer(self, voie: str, val: Tuple[float, ...]) -> None:
        e = self.etat
        if voie.startswith("Z_"):
            f = voie[-1]
            e.grip[f] = (val[0], e.grip[f][1])
        elif voie.startswith("ROT_"):
            f = voie[-1]
            e.grip[f] = (e.grip[f][0], val[0])
        elif voie == "ASC":
            e.fourche = (val[0], val[1])

    def _valeur_voie(self, voie: str, v: dict, now: float) -> Tuple[float, ...]:
        u = 1.0 if v["dur"] <= 0 else min(1.0, max(0.0, (now - v["t0"]) / v["dur"]))
        return tuple(a + (b - a) * u for a, b in zip(v["dep"], v["cib"]))

    def _cmd_act(self, op: str, args: List[str], pid: Optional[int], nak: Callable[..., None]) -> None:
        now = self.hz.now()
        if op == "STATUS?":
            return self._emettre(self._ligne_etat())
        if op == "INIT":
            self._voies.clear()
            ini = self.etat_initial if self.etat_initial is not None else EtatActionneurs()
            self.etat = copy.deepcopy(ini)
            self.pompes = {"A": (0, 0, 0), "B": (0, 0, 0)}
            self._maj_pression()
            self.etat.tir = "IDLE"
            if self.params.mock_delai_tirette_s is not None:          # scénario de test : tirette remise, puis retirée après le délai
                self.tirette, self._retrait_a = 1, now + self.params.mock_delai_tirette_s
                self._emettre("EVT TIRETTE 1")
            self._emettre(f"ACK #{pid}")
            return self._emettre(f"DONE #{pid}")
        duree_T = next((float(a[2:]) / 1000.0 for a in args if a.startswith("T=")), None)
        args = [a for a in args if not a.startswith("T=")]
        prog = self.programmee.get(pid) if pid is not None else None
        duree = prog[0] if prog else (duree_T if duree_T is not None else 0.0)
        if op in ("Z", "ROT"):
            face = args[0]
            if face not in ("A", "B"):
                return nak("SYNTAX", "face")
            voie, cib = f"{op}_{face}", (float(args[1]),)
            # plage des rotations coordonnées : [-90, 180] (spec/robot.json, rotation_angles_deg ; PROTOCOLE_ESP32 §5.2)
            if op == "ROT" and not (min(angles_nacelle_deg()) - 1e-6 <= cib[0] <= max(angles_nacelle_deg()) + 1e-6):
                return nak("RANGE", "ROT")

        elif op == "ASC":
            voie, cib = "ASC", (float(args[0]), float(args[1]))
        elif op == "PUMP":
            face = args[0]
            if face not in ("A", "B") or len(args) != 4:
                return nak("SYNTAX", "PUMP")
            voie, cib = f"PUMP_{face}", ()
        else:   # TIR
            voie, cib = "TIR", ()
        if voie in self._voies:
            return nak("BUSY", voie)
        if op == "PUMP":
            self.pompes[face] = tuple(int(x) for x in args[1:4])    # type: ignore[assignment]
            self._maj_pression()
        elif op == "TIR":
            self.etat.tir = "RUN"
        self._voies[voie] = {"id": pid, "t0": now, "dur": duree, "dep": self._valeur(voie), "cib": cib}
        self._emettre(f"ACK #{pid}")
        self._avancer_act(now)

    def _maj_pression(self) -> None:
        seuil = self.vide_min_kpa if self.vide_min_kpa is not None else depression_minimale_kpa()
        for f, etats in self.pompes.items():
            self.etat.pression[f] = tuple(self.params.mock_vide_facteur * seuil if x else 0.0 for x in etats)  # type: ignore[assignment]

    def _avancer_act(self, now: float) -> None:
        for voie, v in list(self._voies.items()):
            if now - v["t0"] >= v["dur"] - 1e-9:
                self._appliquer(voie, v["cib"])
                if voie == "TIR":
                    self.etat.tir = "DONE"
                self._emettre(f"DONE #{v['id']}")
                del self._voies[voie]
            elif v["cib"]:
                self._appliquer(voie, self._valeur_voie(voie, v, now))
        if self._retrait_a is not None and self.tirette == 1 and now >= self._retrait_a - 1e-9:
            self.retirer_tirette()


# ---------------------------------------------------------------------------------------------------------------------
# Rapport et exécution des plans
# ---------------------------------------------------------------------------------------------------------------------
@dataclass
class Rapport:
    """Résultat de l'exécution d'un plan : instants relatifs au début de la brique."""
    commandes: List[Commande]
    debuts: Dict[int, float] = field(default_factory=dict)
    fins: Dict[int, float] = field(default_factory=dict)
    ok: bool = True
    erreur: Optional[str] = None

    @property
    def duree(self) -> float:
        return max(self.fins.values(), default=0.0)


@dataclass
class _Envoi:
    """Une ligne envoyée : une commande, ou un `PATH` qui porte plusieurs commandes NAV consécutives."""
    dev: ESP32Device
    pid: int
    cids: List[int]
    t_envoi: float
    delai: float
    nav: bool
    texte: str
    stoppe: bool = False


class _Execution:
    """Exécution d'un plan : lance les commandes quand leurs dépendances sont terminées, suit les DONE / WPT, gère l'évitement."""

    def __init__(self, orch: "DualESP32Orchestrator", cmds: List[Commande], plan: dict, t_match0: Optional[float]):
        self.o, self.P, self.hz = orch, orch.params, orch.horloge
        self.cmds = cmds
        self.par_id = {c.id: c for c in cmds}
        self.rap = Rapport(cmds)
        self.origine = self.hz.now()
        self.a_lancer: Dict[int, Commande] = dict(self.par_id)
        self.envois: Dict[Tuple[str, int], _Envoi] = {}
        self.host: Dict[int, float] = {}
        self.reste: Dict[int, float] = {}              # durée restante d'un segment NAV interrompu par l'évitement
        self.t_seg: Dict[int, float] = {}              # début du segment NAV en cours
        self.t_match0 = t_match0
        self.dt_plan = float(plan.get("dt") or 0.0)
        self.bloque_depuis: Optional[float] = None
        self.derniere_eval = -math.inf
        self.abandon: Optional[str] = None

    def rel(self) -> float:
        return self.hz.now() - self.origine

    # ---- échec ---------------------------------------------------------------------------------------------------------
    def echec(self, msg: str) -> None:
        if self.abandon is None:
            self.abandon = msg
            self.rap.ok, self.rap.erreur = False, msg
        self.a_lancer.clear()
        self.host.clear()

    # ---- lancement -----------------------------------------------------------------------------------------------------
    def depart_min(self, c: Commande) -> float:
        if c.no_avant is not None and self.t_match0 is not None:
            return max(c.t0, c.no_avant - self.t_match0)
        return c.t0

    def chaine(self, c: Commande) -> List[Commande]:
        """Segments NAV consécutifs à envoyer ensemble (`PATH`) : sans autre dépendance non terminée que le segment précédent."""
        out = [c]
        if not self.P.chainer_trajectoires:
            return out
        suivants = sorted((x for x in self.a_lancer.values() if x.groupe == "NAV" and x.id > c.id), key=lambda x: x.id)
        for s in suivants:
            prec = out[-1]
            if len(out) >= self.P.points_par_trajectoire or abs(s.t0 - prec.t1) > self.P.eps_t or prec.id not in s.deps:
                break
            ids = {x.id for x in out}
            if not all(d in self.rap.fins for d in set(s.deps) - ids):
                break
            out.append(s)
        return out

    def _menace(self, cible: Tuple[float, float, float]) -> bool:
        try:
            return bool(self.o.menace((cible[0], cible[1])))
        except Exception:  # noqa: BLE001
            logger.exception("évaluation de la menace en échec : on s'arrête par précaution")
            return True

    def lancer(self, now: float) -> int:
        n = 0
        for i, c in sorted(self.a_lancer.items()):
            if self.abandon:
                break
            if i not in self.a_lancer:
                continue
            if not all(d in self.rap.fins for d in c.deps) or now < self.depart_min(c) - 1e-12:
                continue
            if c.dev == "HOST":
                del self.a_lancer[i]
                self.rap.debuts[i] = now
                self.host[i] = now + (c.duree if c.texte.startswith("WAIT") else 0.0)
                n += 1
                continue
            if c.dev == "NAV":
                if self.bloque_depuis is not None:
                    continue
                if self.o.menace is not None and c.cible is not None and self._menace(c.cible):
                    self.bloque_depuis, self.derniere_eval = now, now
                    continue
                lot = self.chaine(c)
            else:
                lot = [c]
            self.envoyer(lot, now)
            n += 1
        return n

    def envoyer(self, lot: List[Commande], now: float) -> None:
        dev = self.o.nav if lot[0].dev == "NAV" else self.o.act
        pid = self.o.prochain_id()
        if len(lot) == 1:
            texte = lot[0].texte
        else:
            texte = f"PATH {len(lot)} " + " ".join(f"{c.cible[0]:.1f} {c.cible[1]:.1f} {c.cible[2]:.1f}" for c in lot)    # type: ignore[index]
        retards = self.o.retards
        fw = dev.firmware
        if fw is not None and (lot[0].dev == "NAV" or lot[0].groupe in ("TIR", "PUMP_A", "PUMP_B") or any(retards.get(c.id) for c in lot)):
            fw.programmee[pid] = [self.reste.get(c.id, c.duree) + retards.get(c.id, 0.0) for c in lot]    # canal de test, hors protocole
        for c in lot:
            self.a_lancer.pop(c.id, None)
        try:
            dev.envoyer(texte, pid)
        except ErreurLiaison as e:
            return self.echec(f"{texte} -> {e}")
        rep = dev.attendre_reponse(pid)
        if rep is None:
            return self.echec(f"{texte} -> pas d'accusé de réception")
        if rep.type == "NAK":
            return self.echec(f"{texte} -> NAK {' '.join(rep.args)}")
        self.rap.debuts.setdefault(lot[0].id, now)
        self.t_seg[lot[0].id] = now
        delai = self.P.facteur_delai * sum(self.reste.get(c.id, c.duree) for c in lot) + self.P.marge_delai_s
        self.envois[(dev.role, pid)] = _Envoi(dev, pid, [c.id for c in lot], now, delai, lot[0].dev == "NAV", texte)

    def terminer_host(self, now: float) -> int:
        n = 0
        for i in [i for i, f in self.host.items() if f <= now + 1e-12]:
            del self.host[i]
            self.rap.fins[i] = now
            n += 1
        return n

    # ---- événements ----------------------------------------------------------------------------------------------------
    def lire(self, now: float) -> int:
        n = 0
        for dev in (self.o.nav, self.o.act):
            dev.sonder()
            for e in dev.prendre():
                env = self.envois.get((dev.role, e.id)) if e.id is not None else None
                if env is None:
                    continue                      # accusé d'une commande déjà traitée, ou STOP d'évitement
                n += 1
                if e.type == "WPT":
                    k = int(e.args[0])
                    if 1 <= k <= len(env.cids):
                        self.rap.fins.setdefault(env.cids[k - 1], now)
                        if k < len(env.cids):
                            self.rap.debuts.setdefault(env.cids[k], now)
                            self.t_seg[env.cids[k]] = now
                elif e.type == "DONE":
                    for cid in env.cids:
                        self.rap.fins.setdefault(cid, now)
                    del self.envois[(dev.role, env.pid)]
                elif e.type == "FAIL":
                    del self.envois[(dev.role, env.pid)]
                    self.echec(f"{env.texte} -> FAIL {' '.join(e.args)}")
                elif e.type == "ABORT":
                    del self.envois[(dev.role, env.pid)]
                    if env.stoppe and e.args[:1] == ("STOP",):
                        self.remettre(env, now)
                    else:
                        self.echec(f"{env.texte} -> ABORT {' '.join(e.args)}")
        return n

    def remettre(self, env: _Envoi, now: float) -> None:
        """Déplacement interrompu par l'évitement : les segments non terminés repartent à la reprise (même pose visée)."""
        premier = True
        for cid in env.cids:
            if cid in self.rap.fins:
                continue
            c = self.par_id[cid]
            if premier:
                self.reste[cid] = max(0.0, self.reste.get(cid, c.duree) - (now - self.t_seg.get(cid, now)))
                premier = False
            self.a_lancer[cid] = c

    # ---- surveillance --------------------------------------------------------------------------------------------------
    def delais(self, now: float) -> None:
        for cle, env in list(self.envois.items()):
            if now - env.t_envoi > env.delai:
                del self.envois[cle]
                self.echec(f"{env.texte} -> délai dépassé ({env.delai:.1f} s)")

    def cible_courante(self) -> Optional[Tuple[float, float, float]]:
        for c in self.cmds:
            if c.groupe == "NAV" and c.id not in self.rap.fins:
                return c.cible
        return None

    def evitement(self, now: float) -> None:
        """Évitement décidé par le Pi : `STOP` à NAV si une menace est sur le trajet ; reprise quand elle disparaît."""
        if self.o.menace is None or self.abandon:
            return
        actifs = [e for e in self.envois.values() if e.nav and not e.stoppe]
        if not actifs and self.bloque_depuis is None:
            return
        if now - self.derniere_eval < self.P.periode_evitement_s - 1e-12:
            return
        cib = self.cible_courante()
        if cib is None:
            return
        self.derniere_eval = now
        m = self._menace(cib)
        if self.bloque_depuis is None:
            if m:
                self.stop_nav(now, actifs)
        elif not m:
            logger.info("évitement : voie libre, reprise du déplacement")
            self.bloque_depuis = None
        elif now - self.bloque_depuis > self.P.attente_evitement_max_s - 1e-9:
            self.echec(f"évitement : adversaire sur le trajet depuis plus de {self.P.attente_evitement_max_s:g} s")

    def stop_nav(self, now: float, actifs: List[_Envoi]) -> None:
        try:
            self.o.envoyer_stop(self.o.nav)
        except ErreurLiaison as e:
            return self.echec(f"STOP -> {e}")
        self.bloque_depuis = now
        for e in actifs:
            e.stoppe = True
        logger.info("évitement : adversaire sur le trajet, STOP envoyé à NAV")

    # ---- temps ---------------------------------------------------------------------------------------------------------
    def echeances(self, now: float) -> List[float]:
        """Instants futurs (relatifs) où quelque chose peut se produire, en temps simulé."""
        c: List[float] = list(self.host.values())
        for x in self.a_lancer.values():
            if all(d in self.rap.fins for d in x.deps) and not (x.dev == "NAV" and self.bloque_depuis is not None):
                c.append(max(self.depart_min(x), max((self.rap.fins[d] for d in x.deps), default=0.0)))
        for dev in (self.o.nav, self.o.act):
            if dev.firmware is not None:
                e = dev.firmware.prochaine_echeance()
                if e is not None:
                    c.append(e - self.origine)
        if self.o.menace is not None:
            if self.bloque_depuis is not None:
                c += [self.derniere_eval + self.P.periode_evitement_s, self.bloque_depuis + self.P.attente_evitement_max_s]
            elif any(e.nav and not e.stoppe for e in self.envois.values()):
                c.append(self.derniere_eval + self.P.periode_evitement_s)
        if self.o.fin_match is not None:
            c.append(self.o.fin_match - self.origine)
        return [x for x in c if x > now + 1e-12]

    def fin_de_match(self) -> bool:
        fin = self.o.fin_match
        if fin is not None and self.hz.now() >= fin - 1e-12:
            self.o.arreter_tout()
            self.echec("fin du match : robot arrêté")
            self.envois.clear()
            return True
        return False

    def executer(self) -> Rapport:
        o, hz = self.o, self.hz
        while True:
            now = self.rel()
            n = self.lire(now)
            if self.fin_de_match():
                return self.rap
            self.delais(now)
            self.evitement(now)
            n += self.terminer_host(now) + self.lancer(now)
            if n:
                continue                                   # plusieurs commandes peuvent se débloquer au même instant
            if not self.a_lancer and not self.envois and not self.host:
                break
            if hz.virtuelle:
                futur = self.echeances(now)
                if not futur:
                    self.echec("plan bloqué (aucune commande ne peut démarrer)")
                    self.envois.clear()
                    continue
                o.dormir_jusqua(self.origine + min(futur))
            else:
                hz.sleep(self.P.poll_s)
        if hz.virtuelle and self.rap.ok:
            # temps simulé : la durée de la brique est celle du moteur même sans commande (attentes internes, retour au trône...)
            o.dormir_jusqua(self.origine + max(self.dt_plan, self.rel()))
        return self.rap


class DualESP32Orchestrator:
    """Chef d'orchestre des deux ESP32 : exécute les plans du moteur en respectant ordre et parallélisme.

    `menace(cible_xy) -> bool` (facultatif) : fourni par le Pi (lidar). Vrai si l'adversaire gêne le déplacement vers `cible_xy`
    (repère réel de la table) ; le pont envoie alors `STOP` à NAV (docs/PROTOCOLE_ESP32.md §4.4).
    `fin_match` : instant (horloge) où le match s'arrête ; tout mouvement cesse (pénalité si le robot bouge après la fin).
    """

    def __init__(self, nav_port: str = PARAMS.nav_port, act_port: str = PARAMS.act_port, baudrate: int = PARAMS.baudrate,
                 mock: bool = False, params: ParamsESP32 = PARAMS, horloge: Optional[Any] = None):
        self.params = params
        self.mock = mock
        self.horloge = horloge or (HorlogeVirtuelle() if mock else HorlogeReelle())
        if mock:
            fn, fa = FirmwareSimule("NAV", self.horloge, params), FirmwareSimule("ACT", self.horloge, params)
            self.nav = ESP32Device("ESP32_NAV", "NAV", "mock", liaison=SerieSimulee(fn), firmware=fn, params=params)
            self.act = ESP32Device("ESP32_ACT", "ACT", "mock", liaison=SerieSimulee(fa), firmware=fa, params=params)
        else:
            self.nav = ESP32Device("ESP32_NAV", "NAV", nav_port, baudrate, params.timeout_s, params=params)
            self.act = ESP32Device("ESP32_ACT", "ACT", act_port, baudrate, params.timeout_s, params=params)
        self.equipe = "yellow"
        # Injection de retards (mock) : id de commande -> secondes ajoutées à sa durée nominale (tests de dépendances).
        self.retards: Dict[int, float] = {}
        self.menace: Optional[Callable[[Tuple[float, float]], bool]] = None
        self.fin_match: Optional[float] = None
        self._seq = 0

    def prochain_id(self) -> int:
        self._seq += 1
        return self._seq

    # ---- cycle de vie -------------------------------------------------------------------------------------------------
    def _commande(self, dev: ESP32Device, texte: str, fin: bool = False) -> None:
        pid = self.prochain_id()
        dev.envoyer(texte, pid)
        rep = dev.attendre_reponse(pid)
        if rep is None:
            raise ErreurLiaison(f"{dev.name} : pas d'accusé de réception pour « {texte} »")
        if rep.type == "NAK":
            raise ErreurLiaison(f"{dev.name} : « {texte} » refusée ({' '.join(rep.args)})")
        if fin:
            r = dev.attendre_reponse(pid, ("DONE", "FAIL", "ABORT"), self.params.timeout_init_s)
            if r is None or r.type != "DONE":
                raise ErreurLiaison(f"{dev.name} : « {texte} » non terminée ({r.ligne if r else 'délai dépassé'})")

    def initialize(self, pose: Optional[Tuple[float, float, float]] = None, equipe: str = "yellow",
                   vitesses: Optional[Dict[str, float]] = None, etat_initial: Optional[EtatActionneurs] = None) -> bool:
        """Ouvre les deux liaisons (HELLO), règle chien de garde, télémétrie et seuil de vide, fixe la pose, les limites, puis `INIT`.

        `pose` : départ dans le repère de l'équipe (valeurs du moteur, ENGINE.DEF x0, y0, h0), mis en miroir pour le bleu ; None : NAV
        garde sa pose. `vitesses` : {lineaire_mm_s, rotation_deg_s} lues dans spec/robot.json via le pont.
        `etat_initial` : état de départ des actionneurs, utilisé seulement par le firmware SIMULÉ (le vrai robot lit ses capteurs).
        Renvoie False (et journalise) si une liaison, un rôle ou une commande est refusé : aucun repli silencieux en simulation."""
        self.equipe = equipe
        p = self.params
        try:
            for dev in (self.nav, self.act):
                if not dev.connect():
                    raise ErreurLiaison(f"{dev.name} : liaison impossible ({dev.port})")
            for dev in (self.nav, self.act):
                self._commande(dev, f"CFG WATCHDOG_MS {p.watchdog_ms}")
                self._commande(dev, f"CFG TELEM_MS {p.telem_ms}")
            self._commande(self.act, f"CFG VIDE_MIN_KPA {depression_minimale_kpa():g}")
            if pose is not None:                 # pose de départ (spec / moteur : ENGINE.DEF x0, y0, h0), fournie par l'appelant
                x, y, h = _mirror_xy_h(pose[0], pose[1], pose[2], equipe, p.largeur_table_mm)
                self._commande(self.nav, f"SET_POSE {x:.1f} {y:.1f} {_h_norm(h):.1f}")
            if p.envoyer_limites and vitesses and vitesses.get("lineaire_mm_s") and vitesses.get("rotation_deg_s"):
                self._commande(self.nav, f"SET_LIMITS {vitesses['lineaire_mm_s']:g} {vitesses['rotation_deg_s']:g}")
            if self.act.firmware is not None and etat_initial is not None:
                self.act.firmware.etat_initial = copy.deepcopy(etat_initial)
            self._commande(self.act, "INIT", fin=True)
        except ErreurLiaison as e:
            logger.error("initialisation impossible : %s", e)
            return False
        if not self.horloge.virtuelle:
            for dev in (self.nav, self.act):
                dev.demarrer_ping(p.periode_ping_s)
        return True

    def close(self) -> None:
        self.nav.close()
        self.act.close()

    # ---- horloge -------------------------------------------------------------------------------------------------------
    def dormir_jusqua(self, cible: float) -> None:
        """Temps simulé : avance l'horloge jusqu'à `cible` en entretenant le chien de garde (un PING toutes les `periode_ping_s`)."""
        hz, pas = self.horloge, self.params.periode_ping_s
        while hz.now() + pas < cible:
            hz.sleep(pas)
            self._pings()
        hz.sleep(max(0.0, cible - hz.now()))
        self._pings()

    def _pings(self) -> None:
        for dev in (self.nav, self.act):
            try:
                dev.ping()
            except ErreurLiaison:
                pass

    # ---- lectures -----------------------------------------------------------------------------------------------------
    def lire_actionneurs(self) -> EtatActionneurs:
        return self.act.interroger("STATUS?", "STATUS")

    def lire_pose(self) -> Tuple[float, float, float]:
        """Odométrie de la base, repère RÉEL de la table."""
        return self.nav.interroger("POSE?", "POSE")

    # ---- départ du match et arrêts ------------------------------------------------------------------------------------
    def attendre_depart(self, timeout_s: Optional[float] = None) -> bool:
        """Départ par la tirette (ESP32 ACT) : attend `TIRETTE 1` (en place) puis `TIRETTE 0` (retirée). Renvoie False si le délai est
        dépassé, ou si, en temps simulé, la tirette ne sera jamais retirée."""
        hz = self.horloge
        fin = None if timeout_s is None else hz.now() + timeout_s
        vue_en_place = False
        while True:
            self.act.sonder()
            t = self.act.tirette
            if t == 1:
                vue_en_place = True
            elif t == 0 and vue_en_place:
                return True
            if fin is not None and hz.now() >= fin:
                return False
            if hz.virtuelle:
                e = self.act.firmware.prochaine_echeance() if self.act.firmware is not None else None
                if e is None or (fin is not None and e > fin):
                    return False
                self.dormir_jusqua(e)
            else:
                hz.sleep(self.params.poll_s)

    def envoyer_stop(self, dev: ESP32Device) -> None:
        """`STOP` prioritaire. Ne lève pas si le périphérique est déjà arrêté."""
        pid = self.prochain_id()
        dev.envoyer("STOP", pid)
        rep = dev.attendre_reponse(pid)
        if rep is None or rep.type == "NAK":
            raise ErreurLiaison(f"{dev.name} : STOP non acquitté ({rep.ligne if rep else 'délai dépassé'})")

    def arreter_base(self) -> None:
        """Arrêt d'évitement de la base (décidé par le Pi)."""
        self.envoyer_stop(self.nav)

    def arreter_tout(self) -> None:
        """Arrêt de la base et des axes des actionneurs (fin du match)."""
        for dev in (self.nav, self.act):
            try:
                self.envoyer_stop(dev)
            except ErreurLiaison as e:
                logger.error("%s", e)

    # ---- exécution ----------------------------------------------------------------------------------------------------
    def executer(self, plan: dict, equipe: Optional[str] = None, t_match0: Optional[float] = None) -> Rapport:
        """Traduit puis exécute le plan d'une brique. Chaque commande part quand toutes ses dépendances sont terminées, et pas
        avant son instant nominal : le robot attend l'actionneur le plus lent, comme le moteur. `t_match0` : instant de match au
        début de la brique, pour respecter les `no_avant` (pas de tir avant la phase d'attaque)."""
        cmds = traduire(plan, equipe or self.equipe, self.params)
        return _Execution(self, cmds, plan, t_match0).executer()
