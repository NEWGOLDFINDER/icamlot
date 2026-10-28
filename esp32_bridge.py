#!/usr/bin/env python3
"""Pont temps réel entre le Raspberry Pi 5 et les 2 microcontrôleurs ESP32 (traduction brique -> commandes).

Matériel (spec/robot.json) : Raspberry Pi 5 + 2 ESP32.
- ESP32 « NAV » : base roulante holonome (3 roues omnidirectionnelles), odométrie.
- ESP32 « ACT » : pinces des faces A et B (hauteur d'axe `hc`, angle `rot`, ventouses sur 3 rangées), canon et ascenseur
  (fourche) de la face C.

Principe (docs/CONTRATS.md §7) : le moteur JS de référence décide du TEMPS MASQUÉ. Pour chaque brique, le pont Node
(embarque/bridge.js) renvoie un « plan » lu dans les points clés du moteur : déplacements de la base, des pinces, de la fourche
et du canon, événements (ventouses, tir), avec leurs instants relatifs au début de la brique. Ce module traduit ce plan en
commandes ESP32 SANS rien décider lui-même : l'ordre et le parallélisme des commandes sont ceux du moteur. Une commande dépend
de toutes celles que le moteur avait terminées avant son début ; sinon elle part à l'instant nominal du plan.

Le champ `tm` d'une brique (prendre, tour, stocker, reprendre, préparer la pince) ne change rien ici : le moteur en a déjà tiré
le plan. L'action « préparer la pince » (`tourner` avec `tm`) n'a aucun déplacement à son propre instant : la rotation est
reportée au prochain trajet, dont le plan la contient (HOST `PENDING_ROT`, information sans commande ESP32).

PROTOCOLE SÉRIE : il n'est pas dans la spec (`spec/robot.json` ne décrit aucun message). Ce qui existait avant ce module est
conservé : liaison série ligne à ligne, commandes NAV `SET_POSE x y h` et `GOTO x y h`, ACT `RESET_ACTUATORS`. Tout le reste
est une HYPOTHÈSE nommée ci-dessous (H1 à H7) et fait l'objet de questions à l'équipe (voir le rapport du chantier).
"""
from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from embarque.spec import table_longueur_mm

try:
    import serial
except ImportError:  # pragma: no cover - dépend de la machine
    serial = None

logger = logging.getLogger("ESP32Bridge")
logger.setLevel(logging.INFO)

# ---------------------------------------------------------------------------------------------------------------------
# Hypothèses (paramètres nommés ; aucune de ces valeurs n'est dans spec/*.json)
# ---------------------------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class ParamsESP32:
    # Hérités de l'ancien module (aucune source dans la spec) :
    baudrate: int = 115200
    timeout_s: float = 0.5
    nav_port: str = "/dev/ttyUSB_NAV"
    act_port: str = "/dev/ttyUSB_ACT"
    # H1 : les commandes ACT/NAV de mouvement sont acquittées tout de suite (« OK ... ») et l'ESP32 signale la fin du mouvement
    #      par une ligne « DONE #<id> ». Chaque commande porte donc un suffixe « #<id> ».
    suffixe_id: bool = True
    # H2 : le suffixe d'identifiant est « #<id> » (voir H1).
    # H3 : NAV enchaîne les `GOTO` d'une même brique sans s'arrêter entre deux points de passage (sinon la durée réelle dépasse
    #      celle du moteur). Le profil de vitesse est celui du firmware ; les limites sont envoyées par `SET_LIMITS` (H4).
    # H4 : `SET_LIMITS <v_mm_s> <w_deg_s>` fixe les vitesses de la base : valeurs de spec/robot.json (500 mm/s, 120 °/s, « declare »).
    envoyer_limites: bool = True
    # H5 : requêtes d'état `POSE?` (NAV) et `STATUS?` (ACT), réponses décrites par parse_pose et parse_status.
    # H6 : la durée de sortie de l'attente `WAIT_UNTIL <t>` est gérée par le Pi (commande HOST, pas de message série).
    # Tolérance (s) pour dire qu'une commande commence quand une autre finit : instants lus dans des flottants du moteur.
    eps_t: float = 1e-6
    # Pas d'interrogation des fins de mouvement sur matériel réel (s). Hypothèse de réglage.
    poll_s: float = 0.01
    # Repère : miroir de la table pour l'équipe bleue (CONTRATS §2) : x -> LONGUEUR - x, h -> 180 - h (longueur lue dans la spec).
    largeur_table_mm: float = field(default_factory=table_longueur_mm)
    # H7 : le moteur échantillonne les mouvements aux instants où un AUTRE axe change (rotation de pince avec montée coordonnée,
    #      fourche pendant un trajet...). Chaque mouvement est réduit à ses points de passage (Ramer-Douglas-Peucker en fonction du
    #      temps) dont l'écart maximal à la trajectoire du moteur reste sous ces tolérances (mm ou degrés). Valeurs de réglage.
    tol_pos_mm: float = 1.0
    tol_cap_deg: float = 1.0
    tol_hc_mm: float = 1.0
    tol_rot_deg: float = 1.0
    tol_fourche_mm: float = 1.0
    tol_canon_mm: float = 1.0


PARAMS = ParamsESP32()


class BriqueNonPriseEnCharge(ValueError):
    """La brique n'a pas de traduction en commandes ESP32."""


# Briques que le catalogue v3 peut émettre (ACTIONS.toProgramStep) et celles du programme de référence.
BRIQUES_PRISES_EN_CHARGE = frozenset({
    "prendre", "mur", "tour", "porte", "tir", "boulets", "monterGraal", "trone",
    "attendre", "attendreJusqua", "seDeplacer", "tourner", "deposerZone", "lacher", "deposer", "traj",
})


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
    groupe: str                   # NAV, GRIP_A, GRIP_B, FORK, CANON, VAC_A, VAC_B, CANON_SPIN, FIRE, HOST
    deps: Tuple[int, ...] = ()
    no_avant: Optional[float] = None   # instant de match (s) avant lequel la commande ne part pas (tir : début de la phase d'attaque)

    @property
    def duree(self) -> float:
        return max(0.0, self.t1 - self.t0)


def _h_norm(h: float) -> float:
    """Cap ramené dans ]-180, 180] (le moteur cumule les rotations ; le firmware prend le plus court chemin)."""
    v = (h + 180.0) % 360.0 - 180.0
    return 180.0 if v == -180.0 else v


def _mirror_xy_h(x: float, y: float, h: float, equipe: str, largeur: float) -> Tuple[float, float, float]:
    if equipe == "blue":
        return largeur - x, y, 180.0 - h
    return x, y, h


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


def traduire(plan: dict, equipe: str = "yellow", params: ParamsESP32 = PARAMS) -> List[Commande]:
    """Plan d'une brique (embarque/bridge.js : extractPlan, repère de l'équipe) -> commandes ESP32 triées.

    Lève BriqueNonPriseEnCharge pour une brique ou un groupe inconnu. Les dépendances reproduisent le temps masqué du moteur :
    la commande j dépend de la commande i (placée avant elle) si i se terminait avant le début de j.
    """
    brique = plan.get("brique") or {}
    kind = brique.get("a")
    if kind not in BRIQUES_PRISES_EN_CHARGE:
        raise BriqueNonPriseEnCharge(f"brique « {kind} » : pas de traduction ESP32 ({brique})")
    cmds: List[Commande] = []

    def add(dev: str, texte: str, t0: float, t1: float, groupe: str, no_avant: Optional[float] = None) -> None:
        cmds.append(Commande(len(cmds), dev, texte, float(t0), float(t1), groupe, no_avant=no_avant))

    for mv in plan.get("moves", []):
        g, pts = mv["g"], mv["pts"]
        tol = {"NAV": (params.tol_pos_mm, params.tol_pos_mm, params.tol_cap_deg), "GRIP_A": (params.tol_hc_mm, params.tol_rot_deg),
               "GRIP_B": (params.tol_hc_mm, params.tol_rot_deg), "FORK": (params.tol_fourche_mm,) * 2,
               "CANON": (params.tol_canon_mm,)}.get(g)
        if tol is None:
            raise BriqueNonPriseEnCharge(f"groupe de mouvement inconnu « {g} » (brique {kind})")
        pts = _simplifier(pts, tol)
        for p, q in zip(pts[:-1], pts[1:]):
            v = q["v"]
            if g == "NAV":
                x, y, h = _mirror_xy_h(v[0], v[1], v[2], equipe, params.largeur_table_mm)
                add("NAV", f"GOTO {x:.1f} {y:.1f} {_h_norm(h):.1f}", p["t"], q["t"], "NAV")
            elif g in ("GRIP_A", "GRIP_B"):
                add("ACT", f"GRIP {g[-1]} {v[0]:.1f} {v[1]:.1f}", p["t"], q["t"], g)
            elif g == "FORK":
                add("ACT", f"FORK {v[0]:.1f} {v[1]:.1f}", p["t"], q["t"], "FORK")
            elif g == "CANON":
                add("ACT", f"CANON {v[0]:.1f}", p["t"], q["t"], "CANON")
            else:
                raise BriqueNonPriseEnCharge(f"groupe de mouvement inconnu « {g} » (brique {kind})")
    for ev in plan.get("events", []):
        k = ev["kind"]
        if k == "VAC":
            r = ev["rows"]
            add("ACT", f"VAC {ev['face']} {int(r[0])} {int(r[1])} {int(r[2])}", ev["t0"], ev["t1"], "VAC_" + ev["face"])
        elif k == "CANON_SPIN":
            add("ACT", "CANON_SPIN", ev["t0"], ev["t1"], "CANON_SPIN")
        elif k == "FIRE":
            add("ACT", f"FIRE {int(ev['n'])} {ev['rate']:g}", ev["t0"], ev["t1"], "FIRE", ev.get("noAvant"))
        elif k == "WAIT":
            texte = f"WAIT_UNTIL {ev['until']:g}" if ev.get("until") is not None else f"WAIT {ev['t1'] - ev['t0']:.3f}"
            add("HOST", texte, ev["t0"], ev["t1"], "HOST")
        else:
            raise BriqueNonPriseEnCharge(f"événement inconnu « {k} » (brique {kind})")
    # « Préparer la pince » : rotation demandée en temps masqué, sans mouvement à cet instant (reportée au prochain trajet).
    if kind == "tourner" and brique.get("tm") and not any(c.groupe.startswith("GRIP") for c in cmds):
        cmds.append(Commande(len(cmds), "HOST", f"PENDING_ROT {brique['f']} {brique['r']}", 0.0, 0.0, "HOST"))
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
    """Réponse de `STATUS?` (H5) : codeurs des pinces, ventouses (1 = pierre tenue, dépression atteinte), fourche, canon."""
    grip: Dict[str, Tuple[float, float]] = field(default_factory=dict)       # face -> (hc mm, rot °)
    tenue: Dict[str, Tuple[int, int, int]] = field(default_factory=dict)    # face -> rangées 1..3
    fourche: Tuple[float, float] = (0.0, 0.0)                                # (fx, fz) mm
    canon: float = 0.0                                                       # mm


def format_status(e: EtatActionneurs) -> str:
    g, t = e.grip, e.tenue
    return ("STATUS GRIP_A {:.1f} {:.1f} GRIP_B {:.1f} {:.1f} VAC_A {} {} {} VAC_B {} {} {} FORK {:.1f} {:.1f} CANON {:.1f}"
            .format(*g["A"], *g["B"], *t["A"], *t["B"], *e.fourche, e.canon))


def parse_status(ligne: str) -> EtatActionneurs:
    """`STATUS GRIP_A hc rot GRIP_B hc rot VAC_A r1 r2 r3 VAC_B r1 r2 r3 FORK fx fz CANON can` (H5)."""
    t = ligne.split()
    if not t or t[0] != "STATUS":
        raise ValueError(f"réponse STATUS illisible : {ligne!r}")
    d: Dict[str, List[float]] = {}
    cle = None
    for w in t[1:]:
        if w.isalpha() or "_" in w:
            cle = w
            d[cle] = []
        elif cle is not None:
            d[cle].append(float(w))
    e = EtatActionneurs()
    for f in ("A", "B"):
        e.grip[f] = (d["GRIP_" + f][0], d["GRIP_" + f][1])
        e.tenue[f] = tuple(int(x) for x in d["VAC_" + f])  # type: ignore[assignment]
    e.fourche = (d["FORK"][0], d["FORK"][1])
    e.canon = d["CANON"][0]
    return e


def parse_pose(ligne: str) -> Tuple[float, float, float]:
    """`POSE x y h` (H5), repère réel de la table."""
    t = ligne.split()
    if len(t) < 4 or t[0] != "POSE":
        raise ValueError(f"réponse POSE illisible : {ligne!r}")
    return float(t[1]), float(t[2]), float(t[3])


# ---------------------------------------------------------------------------------------------------------------------
# Périphériques série (réels ou simulés)
# ---------------------------------------------------------------------------------------------------------------------
class ESP32Device:
    """Interface série ligne à ligne d'un ESP32 (conservée de l'ancien module)."""

    def __init__(self, name: str, port: str, baudrate: int = PARAMS.baudrate, timeout: float = PARAMS.timeout_s, mock: bool = False):
        self.name = name
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.mock = mock or (serial is None)
        self.ser: Optional[Any] = None

    def connect(self) -> bool:
        if self.mock:
            logger.info("[%s] mode MOCK (simulation logicielle)", self.name)
            return True
        try:
            self.ser = serial.Serial(port=self.port, baudrate=self.baudrate, timeout=self.timeout)
            time.sleep(0.1)  # initialisation du bootloader ESP32
            self.ser.reset_input_buffer()
            self.ser.reset_output_buffer()
            logger.info("[%s] connecté sur %s à %d bauds", self.name, self.port, self.baudrate)
            return True
        except Exception as e:  # noqa: BLE001
            logger.warning("[%s] échec de connexion sur %s (%s) -> MOCK", self.name, self.port, e)
            self.mock = True
            return False

    def send_command(self, cmd: str) -> str:
        """Envoie une ligne et lit l'accusé de réception (une ligne)."""
        cmd = cmd.strip()
        if self.mock:
            return f"OK {cmd}"
        if not self.ser or not self.ser.is_open:
            return "ERR_NOT_CONNECTED"
        try:
            self.ser.write((cmd + "\n").encode("utf-8"))
            self.ser.flush()
            return self.ser.readline().decode("utf-8").strip()
        except Exception as e:  # noqa: BLE001
            logger.error("[%s] erreur de communication (%s)", self.name, e)
            return f"ERR {e}"

    def lire_fins(self) -> List[int]:
        """Identifiants des commandes terminées signalées par `DONE #<id>` (H1), sans bloquer. Vide en MOCK."""
        out: List[int] = []
        if self.mock or not self.ser or not self.ser.is_open:
            return out
        try:
            while self.ser.in_waiting:
                ligne = self.ser.readline().decode("utf-8").strip()
                if ligne.startswith("DONE #"):
                    out.append(int(ligne[6:]))
        except Exception as e:  # noqa: BLE001
            logger.error("[%s] lecture des fins impossible (%s)", self.name, e)
        return out

    def close(self) -> None:
        if self.ser and self.ser.is_open:
            self.ser.close()


class FirmwareSimule(ESP32Device):
    """ESP32 simulé : garde l'état commandé et répond aux requêtes d'état. Les fins de mouvement sont gérées par l'orchestrateur."""

    def __init__(self, name: str, kind: str, pose: Tuple[float, float, float] = (0.0, 0.0, 0.0)):
        super().__init__(name, "mock", mock=True)
        self.kind = kind
        self.pose = pose
        self.limites: Optional[Tuple[float, float]] = None
        self.journal: List[str] = []
        self.etat = EtatActionneurs(grip={"A": (0.0, 0.0), "B": (0.0, 0.0)}, tenue={"A": (0, 0, 0), "B": (0, 0, 0)})

    def send_command(self, cmd: str) -> str:
        c = cmd.strip()
        self.journal.append(c)
        t = c.split("#")[0].split()
        if not t:
            return "ERR vide"
        op, a = t[0], t[1:]
        try:
            if self.kind == "NAV":
                if op == "SET_POSE" or op == "GOTO":
                    self.pose = (float(a[0]), float(a[1]), float(a[2]))
                elif op == "SET_LIMITS":
                    self.limites = (float(a[0]), float(a[1]))
                elif op == "POSE?":
                    return "POSE {:.1f} {:.1f} {:.1f}".format(*self.pose)
                else:
                    return f"ERR commande inconnue {op}"
            else:
                e = self.etat
                if op == "RESET_ACTUATORS":
                    self.etat = EtatActionneurs(grip={"A": (0.0, 0.0), "B": (0.0, 0.0)}, tenue={"A": (0, 0, 0), "B": (0, 0, 0)})
                elif op == "GRIP":
                    e.grip[a[0]] = (float(a[1]), float(a[2]))
                elif op == "VAC":
                    e.tenue[a[0]] = (int(a[1]), int(a[2]), int(a[3]))
                elif op == "FORK":
                    e.fourche = (float(a[0]), float(a[1]))
                elif op == "CANON":
                    e.canon = float(a[0])
                elif op in ("CANON_SPIN", "FIRE"):
                    pass
                elif op == "STATUS?":
                    return format_status(e)
                else:
                    return f"ERR commande inconnue {op}"
        except (IndexError, ValueError) as ex:
            return f"ERR arguments {ex}"
        return f"OK {c}"


# ---------------------------------------------------------------------------------------------------------------------
# Horloges
# ---------------------------------------------------------------------------------------------------------------------
class HorlogeReelle:
    def now(self) -> float:
        return time.monotonic()

    def sleep(self, dt: float) -> None:
        if dt > 0:
            time.sleep(dt)

    virtuelle = False


class HorlogeVirtuelle:
    """Temps simulé : sleep avance l'horloge (tests et mode MOCK, sans attendre)."""

    virtuelle = True

    def __init__(self) -> None:
        self.t = 0.0

    def now(self) -> float:
        return self.t

    def sleep(self, dt: float) -> None:
        self.t += max(0.0, dt)


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


class DualESP32Orchestrator:
    """Chef d'orchestre des deux ESP32 : exécute les plans du moteur en respectant ordre et parallélisme."""

    def __init__(self, nav_port: str = PARAMS.nav_port, act_port: str = PARAMS.act_port, baudrate: int = PARAMS.baudrate,
                 mock: bool = False, params: ParamsESP32 = PARAMS, horloge: Optional[Any] = None):
        self.params = params
        self.mock = mock
        if mock:
            self.nav: ESP32Device = FirmwareSimule("ESP32_NAV", "NAV")
            self.act: ESP32Device = FirmwareSimule("ESP32_ACT", "ACT")
        else:
            self.nav = ESP32Device("ESP32_NAV", nav_port, baudrate=baudrate)
            self.act = ESP32Device("ESP32_ACT", act_port, baudrate=baudrate)
        self.horloge = horloge or (HorlogeVirtuelle() if mock else HorlogeReelle())
        self.equipe = "yellow"
        # Injection de retards (mock) : id de commande -> secondes ajoutées à sa durée nominale (tests de dépendances).
        self.retards: Dict[int, float] = {}
        self._seq = 0

    # ---- cycle de vie -------------------------------------------------------------------------------------------------
    def initialize(self, pose: Tuple[float, float, float] = (250.0, 1000.0, 0.0), equipe: str = "yellow",
                   vitesses: Optional[Dict[str, float]] = None) -> bool:
        """Connecte les deux ESP32. `pose` : départ dans le repère de l'équipe (spec : ENGINE.DEF x0, y0, h0), mis en miroir pour le bleu.
        `vitesses` : {lineaire_mm_s, rotation_deg_s} lues dans spec/robot.json via le pont (H4)."""
        self.equipe = equipe
        ok_nav = self.nav.connect()
        ok_act = self.act.connect()
        x, y, h = _mirror_xy_h(pose[0], pose[1], pose[2], equipe, self.params.largeur_table_mm)
        self.nav.send_command(f"SET_POSE {x:.1f} {y:.1f} {_h_norm(h):.1f}")
        if self.params.envoyer_limites and vitesses and vitesses.get("lineaire_mm_s") and vitesses.get("rotation_deg_s"):
            self.nav.send_command(f"SET_LIMITS {vitesses['lineaire_mm_s']:g} {vitesses['rotation_deg_s']:g}")
        self.act.send_command("RESET_ACTUATORS")
        return ok_nav and ok_act

    def close(self) -> None:
        self.nav.close()
        self.act.close()

    # ---- lectures -----------------------------------------------------------------------------------------------------
    def lire_actionneurs(self) -> EtatActionneurs:
        return parse_status(self.act.send_command("STATUS?"))

    def lire_pose(self) -> Tuple[float, float, float]:
        """Odométrie de la base, repère RÉEL de la table (H5)."""
        return parse_pose(self.nav.send_command("POSE?"))

    # ---- exécution ----------------------------------------------------------------------------------------------------
    def _envoyer(self, c: Commande) -> str:
        self._seq += 1
        suffixe = f" #{c.id}" if self.params.suffixe_id else ""
        dev = self.nav if c.dev == "NAV" else self.act
        return dev.send_command(c.texte + suffixe)

    @staticmethod
    def _depart_min(c: Commande, t_match0: Optional[float]) -> float:
        if c.no_avant is not None and t_match0 is not None:
            return max(c.t0, c.no_avant - t_match0)
        return c.t0

    def executer(self, plan: dict, equipe: Optional[str] = None, t_match0: Optional[float] = None) -> Rapport:
        """Traduit puis exécute le plan d'une brique. Chaque commande part quand toutes ses dépendances sont terminées, et pas
        avant son instant nominal : le robot attend l'actionneur le plus lent, comme le moteur. `t_match0` : instant de match au
        début de la brique, pour respecter les `no_avant` (pas de tir avant la phase d'attaque)."""
        cmds = traduire(plan, equipe or self.equipe, self.params)
        rap = Rapport(cmds)
        hz = self.horloge
        origine = hz.now()
        en_cours: Dict[int, float] = {}                 # id -> fin prévue (mock, HOST) ou +inf (réel : on attend `DONE #id`)
        a_lancer: Dict[int, Commande] = {c.id: c for c in cmds}
        while a_lancer or en_cours:
            now = hz.now() - origine
            progres = True
            while progres:                              # plusieurs commandes peuvent se débloquer au même instant
                progres = False
                if not self.mock:
                    for i in self.nav.lire_fins() + self.act.lire_fins():
                        if i in en_cours:
                            en_cours[i] = now
                for i in [i for i, f in en_cours.items() if f <= now + 1e-12]:
                    del en_cours[i]
                    rap.fins[i] = now
                    progres = True
                for i, c in sorted(a_lancer.items()):
                    if not all(d in rap.fins for d in c.deps) or now < self._depart_min(c, t_match0) - 1e-12:
                        continue
                    del a_lancer[i]
                    rap.debuts[i] = now
                    progres = True
                    if c.dev == "HOST":                 # pas de message série ; seule l'attente dure
                        en_cours[i] = now + (c.duree if c.texte.startswith("WAIT") else 0.0)
                        continue
                    rep = self._envoyer(c)
                    if rep.startswith("ERR"):
                        rap.ok, rap.erreur = False, f"{c.texte} -> {rep}"
                        return rap
                    en_cours[i] = (now + c.duree + self.retards.get(i, 0.0)) if self.mock else math.inf
            if not a_lancer and not en_cours:
                break
            if self.mock:
                prochains = [f for f in en_cours.values() if f != math.inf]
                prochains += [max(self._depart_min(c, t_match0), max((rap.fins[d] for d in c.deps), default=0.0))
                              for c in a_lancer.values() if all(d in rap.fins for d in c.deps)]
                prochains = [f for f in prochains if f > now + 1e-12]
                if not prochains:
                    rap.ok, rap.erreur = False, "plan bloqué (aucune commande ne peut démarrer)"
                    return rap
                hz.sleep(min(prochains) - now)
            else:
                hz.sleep(self.params.poll_s)
        return rap
