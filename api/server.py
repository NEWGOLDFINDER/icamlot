#!/usr/bin/env python3
"""API ICAM LOT (bibliothèque standard uniquement).

Accès protégé par un mot de passe d'équipe (ICAMLOT_PASSWORD) : une connexion
réussie pose un cookie de session signé, valable 30 jours.

  POST   /api/login
  POST   /api/logout
  GET    /api/auth
  GET/PUT/DELETE /api/strategies/<slug>
  GET/PUT/DELETE /api/cerveaux/<slug>
  GET    /api/cerveaux/<slug>/poids
  GET/POST /api/trainings
  GET    /api/trainings/<id>
  POST   /api/trainings/<id>/pause|resume|stop
  GET    /api/trainer

Les entrées et familles d'actions valides, et leurs tailles, sont lues dans le moteur JS de référence
(engine/env.js, engine/actions.js) par un appel unique à Node : rien n'est recopié en dur ici.

En local : python3 api/server.py --static .  (sert le site, protège /plateau/ et /cerveau/)
"""
import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
from functools import partial
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get("ICAMLOT_DATA")
if not DATA:
    if os.name == "nt" or not os.path.exists("/var/lib/icamlot"):
        DATA = os.path.join(REPO, ".data", "strategies")
    else:
        DATA = "/var/lib/icamlot/strategies"
PASSWORD = os.environ.get("ICAMLOT_PASSWORD", "")
COOKIE = "icamlot_session"
SESSION_DAYS = 30
MAX_BODY = 512 * 1024
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
ID_RE = re.compile(r"^[a-z0-9-]{6,40}$")
SECRET = b""
TRAINER_PY = os.path.join(REPO, "trainer", "trainer.py")

MAX_LAYERS = 8
MAX_NEURONS = 256
MAX_PARAMS = 250000
MAX_POP = 200
MAX_GEN = 500
MAX_EPOCHS = 500
MAX_DURATION = 1800
ACTIVATIONS = {"relu", "tanh", "sigmoid"}
METHODES = {"evolution", "imitation", "ppo"}
# Réseau récurrent (imitation, PPO) : mêmes valeurs par défaut que trainer/models.py (RecurrentActorCritic)
REC_HIDDEN = 128
REC_ENCODEUR = 128
REC_CRITIQUE = 128
MAX_HIDDEN = 512
MAX_EVAL = 2000
MAX_PROCS = 64
# Hypothèse (aucune valeur dans spec/*.json) : délai entre SIGTERM et SIGKILL lors d'un arrêt (s). L'entraîneur
# attrape SIGTERM et ferme ses processus Node (trainer.py) ; on lui laisse ce temps avant de tout tuer.
# Réglable par la variable d'environnement ICAMLOT_STOP_GRACE_S.
STOP_GRACE_S = float(os.environ.get("ICAMLOT_STOP_GRACE_S", "10"))
# Hypothèse : attente maximale (s) de la disparition des processus après SIGKILL.
KILL_WAIT_S = 5.0
# Hypothèse : période (s) de surveillance d'un entraîneur lancé par une instance précédente de l'API.
ADOPT_POLL_S = 2.0
# Hypothèse (aucune valeur dans spec/*.json) : au-delà de ce nombre d'environnements par cœur, l'interface
# avertit que la collecte d'un rollout sera très longue (mesure d'audit : ~5 décisions/s par cœur).
ENVS_PAR_COEUR_ALERTE = int(os.environ.get("ICAMLOT_ENVS_PAR_COEUR_ALERTE", "16"))
# Marqueurs de la ligne de commande des processus de calcul du projet (voir /api/processus).
MARK_TRAINER = "trainer.trainer"
MARK_WORKER = "engine/env_worker.js"

_ENV_INFO = None
_ENV_LOCK = threading.Lock()
_ENV_JS = r"""
var root = process.argv[1];
var c = require(require('path').join(root, 'engine', 'load.js')).loadIcamlot(root);
var g = {}; c.ENV.GROUPS.forEach(function (x) { g[x.id] = x.vars.reduce(function (a, v) { return a + v.n; }, 0); });
var f = {}; c.ACTIONS.FAMILLES.forEach(function (x) { f[x.id] = c.ACTIONS.filterByFamilles([x.id]).length; });
process.stdout.write(JSON.stringify({ entrees: g, entrees_defaut: c.ENV.DEFAULT_GROUPS, familles: f,
  familles_ordre: c.ACTIONS.FAMILLES.map(function (x) { return x.id; }), moteur: c.ENGINE.VERSION, bareme: c.BAREME_VERSION }));
"""


def env_info():
    """Entrées, familles d'actions (avec leurs tailles), versions du moteur et du barème, lues dans le moteur JS."""
    global _ENV_INFO
    with _ENV_LOCK:
        if _ENV_INFO is None:
            try:
                res = subprocess.run(["node", "-e", _ENV_JS, REPO], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     text=True, timeout=60)
            except (OSError, subprocess.TimeoutExpired) as e:
                raise RuntimeError(f"Moteur JS indisponible (Node) : {e}")
            if res.returncode != 0:
                raise RuntimeError("Moteur JS indisponible : " + res.stderr.strip()[-300:])
            _ENV_INFO = json.loads(res.stdout)
        return _ENV_INFO

_job_lock = threading.Lock()
_job_proc = None
_job_id = None


def slugify(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:64]


def path_for(slug):
    return os.path.join(DATA, slug + ".json")


def data_root():
    return os.path.dirname(os.path.abspath(DATA))


def brains_dir():
    d = os.path.join(data_root(), "brains")
    os.makedirs(d, exist_ok=True)
    return d


def jobs_dir():
    d = os.path.join(data_root(), "trainings")
    os.makedirs(d, exist_ok=True)
    return d


def weights_dir():
    d = os.path.join(data_root(), "weights")
    os.makedirs(d, exist_ok=True)
    return d


def brain_path(slug):
    return os.path.join(brains_dir(), slug + ".json")


def weights_path(slug):
    return os.path.join(weights_dir(), slug + ".json")


def job_path(jid):
    return os.path.join(jobs_dir(), jid + ".json")


def atomic_json(path, obj):
    folder = os.path.dirname(path)
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def n_params(n_in, couches, n_out):
    sizes = [n_in] + [c["neurones"] for c in couches] + [n_out]
    total = 0
    for a, b in zip(sizes, sizes[1:]):
        total += a * b + b
    return total


def n_params_recurrent(n_in, n_out, hidden=REC_HIDDEN, enc=REC_ENCODEUR, crit=REC_CRITIQUE):
    """Paramètres de RecurrentActorCritic (trainer/models.py) avec ses couches par défaut :
    encodeur Linear + LayerNorm, GRUCell, acteur Linear, critique Linear + Linear."""
    encoder = n_in * enc + enc + 2 * enc
    gru = 3 * hidden * (enc + hidden) + 6 * hidden
    actor = hidden * n_out + n_out
    critic = hidden * crit + crit + crit + 1
    return encoder + gru + actor + critic


def validate_cerveau(j, slug):
    name = str(j.get("name", "")).strip()[:80]
    if not name or slugify(name) != slug:
        return None, "Nom invalide."
    try:
        info = env_info()
    except RuntimeError as e:
        return None, str(e)
    ENTREE_N, FAMILLE_N = info["entrees"], info["familles"]
    entrees = j.get("entrees") or list(info["entrees_defaut"])
    if not isinstance(entrees, list) or any(e not in ENTREE_N for e in entrees):
        return None, "Entrées inconnues."
    actions = j.get("actions") or {}
    familles = actions.get("familles") or list(info["familles_ordre"])
    if not isinstance(familles, list) or any(f not in FAMILLE_N for f in familles):
        return None, "Familles d'actions inconnues."
    if "trone" not in familles:
        familles = list(familles) + ["trone"]
    reseau = j.get("reseau") or {}
    couches = reseau.get("couches") or [{"neurones": 64, "activation": "relu"}, {"neurones": 64, "activation": "relu"}]
    if not isinstance(couches, list) or not couches or len(couches) > MAX_LAYERS:
        return None, f"Au plus {MAX_LAYERS} couches cachées."
    clean = []
    for c in couches:
        n = int(c.get("neurones") or 0)
        act = str(c.get("activation") or "relu")
        if n < 1 or n > MAX_NEURONS or act not in ACTIVATIONS:
            return None, f"Chaque couche a 1 à {MAX_NEURONS} neurones (relu, tanh ou sigmoïde)."
        clean.append({"neurones": n, "activation": act})
    n_in = sum(ENTREE_N[e] for e in entrees)
    n_out = sum(FAMILLE_N[f] for f in familles)
    methode = j.get("methode") or "evolution"
    if methode not in METHODES:
        return None, "Méthode inconnue (evolution, imitation ou ppo)."
    # l'évolution entraîne un MLP ; l'imitation et le PPO entraînent le réseau récurrent (trainer/models.py)
    architecture = "mlp" if methode == "evolution" else "recurrent"
    regl = j.get("reglages") or {}
    try:
        hidden = int(regl.get("hidden") or REC_HIDDEN)
    except (TypeError, ValueError):
        hidden = REC_HIDDEN
    hidden = max(8, min(MAX_HIDDEN, hidden))
    params = n_params(n_in, clean, n_out) if architecture == "mlp" else n_params_recurrent(n_in, n_out, hidden)
    if params > MAX_PARAMS:
        return None, f"Le réseau a {params} paramètres, le plafond est {MAX_PARAMS}."
    if not isinstance(regl, dict):
        return None, "Réglages invalides."
    def clamp(key, lo, hi, default):
        try:
            v = float(regl.get(key, default))
        except (TypeError, ValueError):
            v = default
        return max(lo, min(hi, v))
    reglages = {
        "population": int(clamp("population", 2, MAX_POP, 20)),
        "generations": int(clamp("generations", 1, MAX_GEN, 30)),
        "mutation": clamp("mutation", 0.001, 1.0, 0.1),
        "scenarios_par_evaluation": int(clamp("scenarios_par_evaluation", 1, 20, 1)),
        "graine": int(clamp("graine", 1, 1e9, 1)),
        "duree_max": int(clamp("duree_max", 30, MAX_DURATION, 300)),
        "epoques": int(clamp("epoques", 1, MAX_EPOCHS, 40)),
        "taux_apprentissage": clamp("taux_apprentissage", 1e-5, 1.0, 0.02),
        "lot": int(clamp("lot", 1, 256, 16)),
        "mode": "rapide" if str(regl.get("mode") or "rapide") == "rapide" else "precis",
        "ppo_steps": int(clamp("ppo_steps", 1000, 1_000_000, 100_000)),
        "ppo_batch_size": int(clamp("ppo_batch_size", 16, 1024, 256)),
        "ppo_rollout_len": int(clamp("ppo_rollout_len", 8, 128, 32)),
        "ppo_lr": clamp("ppo_lr", 1e-5, 0.01, 0.0003),
        "ppo_penalite_erreur": clamp("ppo_penalite_erreur", 0, 100, 0),
        "pretrain_imitation": bool(regl.get("pretrain_imitation", True)),
        "imitation_exemple": bool(regl.get("imitation_exemple", True)),
        "imitation_lr": clamp("imitation_lr", 1e-5, 0.01, 0.001),
        "imitation_scenarios": int(clamp("imitation_scenarios", 1, 64, 4)),
        "hidden": hidden,
        "processus": int(clamp("processus", 0, MAX_PROCS, 0)),
        "eval_matchs": int(clamp("eval_matchs", 0, MAX_EVAL, 200)),
    }
    rec = j.get("recompense") or {}
    recompense = {
        "base": "score",
        "penalite_erreur": float(rec.get("penalite_erreur") or 0),
        "penalite_contact": float(rec.get("penalite_contact") or 0),
        "sur_erreur": "fin" if rec.get("sur_erreur") == "fin" else "penalite",
    }
    adv = j.get("adversaire") or {}
    intensite = str(adv.get("intensite") or "aucun")
    if intensite not in ("aucun", "faible", "realiste", "agressif"):
        intensite = "aucun"
    seed = int(j.get("graine") or reglages["graine"])
    doc = {
        "format": "camelot-cerveau",
        "version": 1,
        "name": name,
        "entrees": entrees,
        "actions": {"familles": familles, "cotes": ["ext", "int"]},
        "reseau": {"couches": clean, "sortie": "softmax", "architecture": architecture},
        "architecture": architecture,
        "adversaire": {"actif": intensite != "aucun", "intensite": intensite},
        "methode": methode,
        "reglages": reglages,
        "recompense": recompense,
        "graine": seed,
        "n_entrees": n_in,
        "n_sorties": n_out,
        "n_parametres": params,
        "metadonnees": {
            "moteur": (j.get("metadonnees") or {}).get("moteur") or info["moteur"],
            "bareme": (j.get("metadonnees") or {}).get("bareme") or info["bareme"],
        },
    }
    return doc, None


# ───────────── processus de calcul (entraîneurs et workers Node) ─────────────
def _read(path):
    try:
        with open(path, "rb") as fh:
            return fh.read()
    except OSError:
        return None


def proc_cmdline(pid):
    raw = _read(f"/proc/{int(pid)}/cmdline")
    if not raw:
        return []
    return [a.decode("utf-8", "replace") for a in raw.split(b"\0") if a]


def proc_stat(pid):
    """(état, ppid, pgid, temps CPU en ticks, début en ticks depuis le démarrage du système) ou None."""
    raw = _read(f"/proc/{int(pid)}/stat")
    if not raw:
        return None
    txt = raw.decode("utf-8", "replace")
    f = txt[txt.rfind(")") + 2:].split()  # le nom du processus (entre parenthèses) peut contenir des espaces
    try:
        return f[0], int(f[1]), int(f[2]), int(f[11]) + int(f[12]), int(f[19])
    except (IndexError, ValueError):
        return None


def proc_kind(pid):
    """'trainer' (python -m trainer.trainer), 'worker' (node engine/env_worker.js) ou None."""
    cmd = proc_cmdline(pid)
    if MARK_TRAINER in cmd:
        return "trainer"
    if any(a.replace("\\", "/").endswith(MARK_WORKER) for a in cmd):
        return "worker"
    return None


def proc_in_project(pid):
    """Le processus appartient à CE dépôt (répertoire courant = REPO, ou script situé dans REPO) : deux
    déploiements ou worktrees sur la même machine ne se voient pas entre eux. Hypothèse ajoutée à la consigne."""
    root = os.path.realpath(REPO)
    try:
        if os.path.realpath(os.readlink(f"/proc/{int(pid)}/cwd")) == root:
            return True
    except OSError:
        pass
    return any(os.path.realpath(a).startswith(root + os.sep) for a in proc_cmdline(pid) if a.startswith("/"))


def proc_alive(pid):
    st = proc_stat(pid)
    return bool(st) and st[0] not in ("Z", "X")


def proc_mine(pid):
    try:
        return os.stat(f"/proc/{int(pid)}").st_uid == os.getuid()
    except OSError:
        return False


def proc_rss_mo(pid):
    raw = _read(f"/proc/{int(pid)}/statm")
    try:
        return round(int(raw.split()[1]) * os.sysconf("SC_PAGE_SIZE") / 1048576, 1)
    except (AttributeError, IndexError, ValueError):
        return None


def all_pids():
    try:
        return [int(n) for n in os.listdir("/proc") if n.isdigit()]
    except OSError:
        return []


def children_of(pid, table):
    """Tous les descendants de pid (table : pid -> ppid), sans pid lui-même."""
    kids, todo = [], [pid]
    while todo:
        cur = todo.pop()
        for p, pp in table.items():
            if pp == cur and p not in kids and p != pid:
                kids.append(p)
                todo.append(p)
    return kids


def list_processes():
    """Processus de calcul du projet appartenant au même utilisateur que l'API (scan de /proc)."""
    try:
        up = float(_read("/proc/uptime").split()[0])
    except (AttributeError, IndexError, ValueError):
        up = 0.0
    hz = os.sysconf("SC_CLK_TCK")
    by_pid = {}
    for j in list_jobs():
        if j.get("pid"):
            by_pid.setdefault(int(j["pid"]), j)
    found = {}
    for pid in all_pids():
        kind = proc_kind(pid)
        if not kind or pid == os.getpid() or not proc_mine(pid) or not proc_in_project(pid):
            continue
        st = proc_stat(pid)
        if st and st[0] not in ("Z", "X"):
            found[pid] = (kind, st)
    out = []
    for pid, (kind, st) in found.items():
        # tâche associée : pid enregistré dans la tâche, sinon l'entraîneur ancêtre ou chef du groupe du worker
        owner, seen, cur = None, set(), pid
        while cur and cur not in seen:
            seen.add(cur)
            if cur in by_pid and (cur == pid or found.get(cur, ("",))[0] == "trainer"):
                owner = by_pid[cur]
                break
            s2 = proc_stat(cur)
            cur = s2[1] if s2 else 0
        if owner is None and kind == "worker" and st[2] in by_pid:
            owner = by_pid[st[2]]
        age = max(0.0, up - st[4] / hz)
        out.append({
            "pid": pid, "pgid": st[2], "ppid": st[1], "type": "entraineur" if kind == "trainer" else "worker",
            "tache": owner.get("id") if owner else None, "nom": owner.get("name") if owner else None,
            "duree_s": round(age), "rss_mo": proc_rss_mo(pid),
            # moyenne depuis le démarrage du processus (pas un instantané)
            "cpu_pct": round(100.0 * (st[3] / hz) / age, 1) if age > 0 else None,
        })
    out.sort(key=lambda r: (r["tache"] or "~", r["type"] != "entraineur", r["pid"]))
    return out


def _group_safe(pgid):
    """killpg n'est permis que sur un groupe créé pour un entraîneur (chef = entraîneur, ou chef disparu) :
    jamais sur celui de l'API ni sur celui d'un shell."""
    if pgid <= 1 or pgid == os.getpgrp():
        return False
    if not proc_alive(pgid):
        return True
    return proc_kind(pgid) == "trainer"


def _signal(pid, sig):
    try:
        os.kill(pid, sig)
    except (ProcessLookupError, PermissionError):
        pass


def _signal_group(pgid, sig):
    try:
        os.killpg(pgid, sig)
    except (ProcessLookupError, PermissionError):
        pass


def _group_members(pgid):
    return [p for p in all_pids() if (proc_stat(p) or (None, 0, -1))[2] == pgid and proc_alive(p)]


def stop_processes(pids, grace=None):
    """Arrête ces processus et leurs descendants : SIGTERM au groupe (si sûr) et à chaque processus, puis
    SIGKILL après `grace` secondes (STOP_GRACE_S) si l'un d'eux vit encore."""
    grace = STOP_GRACE_S if grace is None else grace
    table = {p: (proc_stat(p) or (None, None))[1] for p in all_pids()}
    targets, groups = set(), set()
    for pid in pids:
        st = proc_stat(pid)
        if not st:
            continue
        targets.add(pid)
        targets.update(children_of(pid, table))
        if _group_safe(st[2]):
            groups.add(st[2])
    for g in groups:
        targets.update(_group_members(g))
    targets = {p for p in targets if p != os.getpid() and proc_mine(p)}

    def live():
        return [p for p in targets if proc_alive(p)]

    def wait(limit):
        end = time.time() + limit
        while live() and time.time() < end:
            time.sleep(0.05)
        return not live()

    for g in groups:
        _signal_group(g, signal.SIGTERM)
    for p in targets:
        _signal(p, signal.SIGTERM)
    escalated = False
    if not wait(grace):
        escalated = True
        for g in groups:
            _signal_group(g, signal.SIGKILL)
        for p in live():
            _signal(p, signal.SIGKILL)
        wait(KILL_WAIT_S)
    return {"tues": sorted(targets), "sigkill": escalated, "survivants": sorted(live()), "grace_s": grace}


def mark_stopped(jid):
    """Tâche arrêtée par l'utilisateur : 'stopped' (écrasant l'éventuel 'interrupted' du watcher), sans erreur ;
    puis la file reprend."""
    with _job_lock:
        j = load_json(job_path(jid)) if ID_RE.match(jid or "") else None
        if j and j.get("status") in ("running", "paused", "queued", "interrupted", "stopped"):
            j["status"] = "stopped"
            j.pop("error", None)
            atomic_json(job_path(jid), j)
        kick_queue()


def stop_job(jid):
    """Arrête la tâche, y compris si l'entraîneur a été lancé par une instance précédente de l'API
    (pid lu dans le JSON de la tâche, ligne de commande vérifiée avant d'agir)."""
    path = job_path(jid)
    job = load_json(path) or {}
    if job.get("status") in ("running", "paused", "queued"):
        job["status"] = "stopped"  # avant le signal : le watcher ne la marquera pas 'interrupted'
        atomic_json(path, job)
    res = {"tues": [], "sigkill": False, "survivants": [], "grace_s": STOP_GRACE_S}
    pid = job.get("pid")
    if pid and proc_alive(pid) and proc_kind(pid) == "trainer" and proc_mine(pid):
        res = stop_processes([int(pid)])
    mark_stopped(jid)
    return res


def stop_listed(pids):
    """Arrête des processus de la liste : un worker dont l'entraîneur est vivant entraîne l'arrêt de l'entraîneur.
    Met les tâches concernées à 'stopped' et relance la file."""
    procs = {p["pid"]: p for p in list_processes()}
    roots, jobs = set(), set()
    for pid in pids:
        p = procs[pid]
        if p["tache"]:
            jobs.add(p["tache"])
        roots.add(pid)
    for jid in jobs:  # statut avant les signaux, comme stop_job
        j = load_json(job_path(jid)) or {}
        if j.get("status") in ("running", "paused"):
            j["status"] = "stopped"
            atomic_json(job_path(jid), j)
    # un worker rattaché à un entraîneur vivant : on arrête l'entraîneur (le worker seul le ferait échouer)
    for pid in list(roots):
        if procs[pid]["type"] == "worker":
            tr = procs.get(procs[pid]["ppid"])
            if tr and tr["type"] == "entraineur":
                roots.discard(pid)
                roots.add(tr["pid"])
    res = stop_processes(sorted(roots))
    for jid in jobs:
        mark_stopped(jid)
    if not jobs:
        with _job_lock:
            kick_queue()
    res["taches"] = sorted(jobs)
    return res


def _adopt_watch(jid, pid):
    """Surveille un entraîneur lancé par une instance précédente de l'API (pas de Popen à attendre)."""
    def watch():
        while proc_alive(pid) and proc_kind(pid) == "trainer":
            time.sleep(ADOPT_POLL_S)
        with _job_lock:
            finish_job(jid, None)
            kick_queue()
    threading.Thread(target=watch, daemon=True).start()


def reconcile_jobs():
    """Au démarrage : toute tâche running/paused dont le pid n'est plus vivant (ou n'est plus un entraîneur)
    passe 'interrupted'. Un entraîneur encore vivant est surveillé. Puis la file reprend."""
    with _job_lock:
        for j in list_jobs():
            if j.get("status") not in ("running", "paused"):
                continue
            pid = j.get("pid")
            if pid and proc_alive(pid) and proc_kind(pid) == "trainer":
                _adopt_watch(j["id"], int(pid))
                continue
            fatal = log_failure(j.get("log") or os.path.join(jobs_dir(), j["id"] + ".log"))
            j["status"] = "error" if fatal else "interrupted"
            j["error"] = fatal or ("Interrompu : l'entraîneur" + (f" (pid {pid})" if pid else "") +
                                   " ne tourne plus (redémarrage du serveur ou de l'API).")
            atomic_json(job_path(j["id"]), j)
        kick_queue()


def list_json_dir(folder, extra):
    out = []
    if not os.path.isdir(folder):
        return out
    for f in sorted(os.listdir(folder)):
        if not f.endswith(".json"):
            continue
        j = load_json(os.path.join(folder, f))
        if not j:
            continue
        rec = extra(f[:-5], j)
        if rec:
            out.append(rec)
    return out


def list_jobs():
    jobs = []
    for f in os.listdir(jobs_dir()) if os.path.isdir(jobs_dir()) else []:
        if not f.endswith(".json") or f.endswith(".log") or "-poids" in f:
            continue
        j = load_json(os.path.join(jobs_dir(), f))
        if not j or "status" not in j:
            continue
        jobs.append(j)
    jobs.sort(key=lambda x: x.get("created") or 0, reverse=True)
    return jobs


def find_python():
    """Détecte l'interpréteur Python disposant de PyTorch et CUDA pour l'entraînement GPU."""
    try:
        import torch
        if torch.cuda.is_available():
            return sys.executable
    except Exception:
        pass
    candidates = [
        os.path.join(REPO, ".venv", "bin", "python"),
        os.path.join(REPO, "..", ".venv-icamlot", "bin", "python"),
        "/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/python",
        os.path.join(REPO, "venv", "bin", "python"),
    ]
    for cand in candidates:
        cand = os.path.abspath(cand)
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            try:
                res = subprocess.run(
                    [cand, "-c", "import torch; print(torch.cuda.is_available())"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=5,
                )
                if res.returncode == 0:
                    return cand
            except Exception:
                pass
    return sys.executable


# Dernière ligne d'erreur fatale d'un journal : exception Python, trace, ou « Erreur fatale » de l'entraîneur.
FATAL_RE = re.compile(r"(^Traceback \(most recent call last\)|Erreur fatale|^[A-Za-z_][\w.]*(Error|Exception)\b)")
LOG_TAIL_LINES = 40


def log_tail(log, n=LOG_TAIL_LINES):
    try:
        with open(log, "r", encoding="utf-8", errors="replace") as f:
            return [l.strip() for l in f.readlines()[-n:] if l.strip()]
    except OSError:
        return []


def log_failure(log):
    """Message de l'erreur fatale qui termine le journal, ou None. Une erreur n'est retenue que si rien d'autre
    ne suit que sa trace (le journal d'un entraînement réussi finit par « Terminé »)."""
    lines = log_tail(log)
    for k in range(len(lines) - 1, -1, -1):
        if FATAL_RE.search(lines[k]):
            if any("Terminé" in l for l in lines[k + 1:]):
                return None
            cands = [l for l in lines[k:] if re.match(r"^[A-Za-z_][\w.]*(Error|Exception)\b", l)]
            return cands[-1] if cands else lines[k]
    return None


def finish_job(jid, rc):
    """Statut final d'une tâche dont l'entraîneur a quitté (rc : code de retour, None si inconnu). Toute sortie sur
    exception donne 'error' avec son message, quel que soit le code de retour, même si l'entraîneur avait écrit 'done'.
    Une sortie par signal (arrêt) donne 'interrupted'. À appeler avec _job_lock pris par l'appelant ou seul."""
    path = job_path(jid)
    cur = load_json(path) or {}
    st = cur.get("status")
    if st == "stopped":
        return
    fatal = log_failure(cur.get("log") or os.path.join(jobs_dir(), jid + ".log")) if st in ("running", "paused", "done", "error") else None
    if fatal and st != "error":
        cur["status"], cur["error"] = "error", fatal
    elif st in ("running", "paused"):
        if rc == 0:
            cur["status"] = "done"
        elif rc is not None and (rc < 0 or rc == 143):
            cur["status"] = "interrupted"
            cur["error"] = "Entraînement interrompu (signal d'arrêt)."
        else:
            cur["status"] = "interrupted" if rc is None else "error"
            lines = log_tail(cur.get("log") or "")
            cur["error"] = (f"L'entraîneur s'est arrêté (code {rc})." if rc is not None else
                            f"L'entraîneur (pid {cur.get('pid')}) s'est arrêté sans conclure.")
            if lines:
                cur["error"] = next((l for l in reversed(lines) if any(k in l for k in ("Error", "Exception", "Erreur", "Traceback"))), lines[-1])
    else:
        return
    atomic_json(path, cur)


def cpu_info():
    """Cœurs vus par l'API : os.cpu_count() (machine) et affinité (cœurs réellement utilisables par ce processus,
    donc par l'entraîneur). Nombre de processus Node 'auto' = celui du trainer (js_env_pool.default_procs)."""
    n = os.cpu_count() or 1
    try:
        aff = len(os.sched_getaffinity(0))
    except (AttributeError, OSError):
        aff = n
    try:
        sys.path.insert(0, REPO)
        from trainer.js_env_pool import default_procs
        auto = default_procs()
    except Exception:  # numpy absent : même règle que default_procs
        auto = max(1, n - 1)
    finally:
        if sys.path and sys.path[0] == REPO:
            sys.path.pop(0)
    return {"cpu_count": n, "cpu_affinite": aff, "procs_auto": auto,
            "envs_par_coeur_alerte": ENVS_PAR_COEUR_ALERTE}


def spawn_job(jid):
    global _job_proc, _job_id
    path = job_path(jid)
    job = load_json(path)
    if not job:
        return
    job["status"] = "running"
    atomic_json(path, job)
    weights_out = job.get("weights") or weights_path(job.get("slug") or jid)
    log = job.get("log") or os.path.join(jobs_dir(), jid + ".log")
    env = os.environ.copy()
    env["PYTHONPATH"] = REPO + ((":" + env["PYTHONPATH"]) if "PYTHONPATH" in env else "")
    py_bin = find_python()

    try:
        log_fh = open(log, "a", encoding="utf-8")
    except OSError:
        log_fh = None

    proc = subprocess.Popen(
        [py_bin, "-m", "trainer.trainer", "--job", path, "--strategies", DATA, "--weights-out", weights_out],
        cwd=REPO,
        env=env,
        stdout=log_fh if log_fh else subprocess.DEVNULL,
        stderr=log_fh if log_fh else subprocess.DEVNULL,
        start_new_session=True,  # nouveau groupe : l'arrêt vise l'entraîneur et ses workers Node, jamais l'API
    )
    _job_proc = proc
    _job_id = jid
    job["pid"] = proc.pid
    job["log"] = log
    job["weights"] = weights_out
    job["python"] = py_bin
    atomic_json(path, job)

    def watch():
        global _job_proc, _job_id
        proc.wait()
        if log_fh:
            try:
                log_fh.flush()
                log_fh.close()
            except Exception:
                pass
        with _job_lock:
            if _job_id == jid:
                _job_proc = None
                _job_id = None
            finish_job(jid, proc.returncode)
            kick_queue()

    threading.Thread(target=watch, daemon=True).start()


def kick_queue():
    global _job_proc, _job_id
    if _job_proc and _job_proc.poll() is None:
        return
    for j in list_jobs():  # entraîneur encore vivant lancé par une instance précédente de l'API
        pid = j.get("pid")
        if j.get("status") in ("running", "paused") and pid and proc_alive(pid) and proc_kind(pid) == "trainer":
            return
    queued = [j for j in list_jobs() if j.get("status") == "queued"]
    queued.sort(key=lambda x: x.get("created") or 0)
    if queued:
        spawn_job(queued[0]["id"])


def queue_position(jid):
    queued = [j for j in list_jobs() if j.get("status") == "queued"]
    queued.sort(key=lambda x: x.get("created") or 0)
    for i, j in enumerate(queued, start=1):
        if j.get("id") == jid:
            return i
    return 0


def load_secret():
    """Clé de signature des sessions, créée une fois à côté du dossier des stratégies."""
    path = os.path.join(os.path.dirname(os.path.abspath(DATA)), "session.key")
    try:
        with open(path, "rb") as fh:
            key = fh.read()
        if len(key) >= 32:
            return key
    except FileNotFoundError:
        pass
    key = secrets.token_bytes(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(key)
    return key


def sign(exp):
    # Le mot de passe entre dans la signature : le changer déconnecte tout le monde.
    msg = f"{exp}:{hashlib.sha256(PASSWORD.encode()).hexdigest()}".encode()
    return hmac.new(SECRET, msg, hashlib.sha256).hexdigest()


def make_session():
    exp = int(time.time()) + SESSION_DAYS * 86400
    return f"{exp}.{sign(exp)}"


def session_ok(value):
    try:
        exp_s, sig = value.split(".", 1)
        exp = int(exp_s)
    except (AttributeError, ValueError):
        return False
    return exp > time.time() and hmac.compare_digest(sig, sign(exp))


class Handler(SimpleHTTPRequestHandler):
    server_version = "icamlot-api"

    def send_json(self, code, obj, cookie=None):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, code, text, ctype="text/plain; charset=utf-8"):
        body = text.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def path_only(self):
        return self.path.split("?", 1)[0]

    def route(self):
        p = self.path_only().rstrip("/")
        if p == "/api/strategies":
            return "strats", None
        m = re.fullmatch(r"/api/strategies/([^/]+)", p)
        if m:
            return "strat", m.group(1)
        if p == "/api/cerveaux":
            return "brains", None
        m = re.fullmatch(r"/api/cerveaux/([^/]+)/poids", p)
        if m:
            return "poids", m.group(1)
        m = re.fullmatch(r"/api/cerveaux/([^/]+)", p)
        if m:
            return "brain", m.group(1)
        if p == "/api/trainings":
            return "jobs", None
        m = re.fullmatch(r"/api/trainings/([^/]+)/(pause|resume|stop|log)", p)
        if m:
            return "job_" + m.group(2), m.group(1)
        m = re.fullmatch(r"/api/trainings/([^/]+)", p)
        if m:
            return "job", m.group(1)
        if p == "/api/trainer":
            return "trainer", None
        if p == "/api/processus":
            return "procs", None
        if p == "/api/processus/stop-all":
            return "procs_stop_all", None
        m = re.fullmatch(r"/api/processus/(\d+)/stop", p)
        if m:
            return "proc_stop", m.group(1)
        return None, None

    def authed(self):
        if not PASSWORD:
            return True
        c = SimpleCookie()
        try:
            c.load(self.headers.get("Cookie", ""))
        except Exception:
            return False
        return COOKIE in c and session_ok(c[COOKIE].value)

    def cookie(self, value, max_age):
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto", "") == "https" else ""
        return f"{COOKIE}={value}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Lax{secure}"

    def read_json(self, limit=None):
        n = int(self.headers.get("Content-Length") or 0)
        cap = limit or MAX_BODY
        if n <= 0 or n > cap:
            return None
        try:
            return json.loads(self.rfile.read(n))
        except ValueError:
            return None

    def need_auth(self):
        if not self.authed():
            self.send_json(401, {"error": "Connexion requise."})
            return False
        return True

    def do_GET(self):
        p = self.path_only()
        if p == "/api/auth":
            if self.authed():
                self.send_response(204)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return None
            return self.send_json(401, {"error": "Connexion requise."})
        kind, slug = self.route()
        if kind and not self.authed():
            return self.send_json(401, {"error": "Connexion requise."})
        if kind == "strats":
            out = []
            for f in sorted(os.listdir(DATA)):
                if not f.endswith(".json"):
                    continue
                try:
                    with open(os.path.join(DATA, f), encoding="utf-8") as fh:
                        j = json.load(fh)
                    out.append({"slug": f[:-5], "name": j.get("name", f[:-5]),
                                "updated": j.get("updated", 0), "steps": len(j.get("program", []))})
                except (OSError, ValueError):
                    continue
            out.sort(key=lambda s: s["updated"], reverse=True)
            return self.send_json(200, {"strategies": out})
        if kind == "strat":
            if not SLUG_RE.match(slug) or not os.path.exists(path_for(slug)):
                return self.send_json(404, {"error": "Stratégie introuvable."})
            with open(path_for(slug), encoding="utf-8") as fh:
                return self.send_json(200, json.load(fh))
        if kind == "brains":
            out = []
            for f in sorted(os.listdir(brains_dir())):
                if not f.endswith(".json"):
                    continue
                j = load_json(os.path.join(brains_dir(), f))
                if not j:
                    continue
                out.append({
                    "slug": f[:-5], "name": j.get("name", f[:-5]), "updated": j.get("updated", 0),
                    "methode": j.get("methode"), "n_parametres": j.get("n_parametres"),
                    "best_score": j.get("best_score"),
                    "moteur": (j.get("metadonnees") or {}).get("moteur"),
                    "bareme": (j.get("metadonnees") or {}).get("bareme"),
                    "entraine": os.path.exists(weights_path(f[:-5])),
                })
            out.sort(key=lambda s: s["updated"], reverse=True)
            return self.send_json(200, {"cerveaux": out})
        if kind == "brain":
            if not SLUG_RE.match(slug) or not os.path.exists(brain_path(slug)):
                return self.send_json(404, {"error": "Cerveau introuvable."})
            j = load_json(brain_path(slug))
            j["entraine"] = os.path.exists(weights_path(slug))
            stale = []
            meta = j.get("metadonnees") or {}
            try:
                info = env_info()
                if meta.get("moteur") and meta.get("moteur") != info["moteur"]:
                    stale.append("moteur")
                if meta.get("bareme") and meta.get("bareme") != info["bareme"]:
                    stale.append("bareme")
            except RuntimeError:
                pass
            j["obsolète"] = stale
            return self.send_json(200, j)
        if kind == "poids":
            if not SLUG_RE.match(slug) or not os.path.exists(weights_path(slug)):
                return self.send_json(404, {"error": "Poids introuvables. Entraîne d'abord ce cerveau."})
            return self.send_json(200, load_json(weights_path(slug)))
        if kind == "jobs":
            jobs = []
            for j in list_jobs():
                rec = {k: j.get(k) for k in ("id", "slug", "name", "status", "created", "methode", "best_score", "error")}
                rec["queue"] = queue_position(j.get("id"))
                rec["progress"] = j.get("progress")
                jobs.append(rec)
            return self.send_json(200, {"trainings": jobs, "courant": _job_id})
        if kind == "job":
            if not ID_RE.match(slug or "") or not os.path.exists(job_path(slug)):
                return self.send_json(404, {"error": "Entraînement introuvable."})
            j = load_json(job_path(slug))
            j["queue"] = queue_position(slug)
            return self.send_json(200, j)
        if kind == "job_log":
            log = os.path.join(jobs_dir(), slug + ".log")
            if not os.path.exists(log):
                return self.send_text(200, "")
            with open(log, encoding="utf-8") as fh:
                return self.send_text(200, fh.read()[-8000:])
        if kind == "procs":
            return self.send_json(200, {"processus": list_processes(), "stop_grace_s": STOP_GRACE_S})
        if kind == "trainer":
            info = {"device": "cpu", "name": "CPU", "vram_mo": 0, "courant": _job_id, "queue": queue_position(_job_id or "")}
            info.update(cpu_info())
            try:
                import numpy  # noqa: F401
                info["numpy"] = True
            except ImportError:
                info["numpy"] = False
            try:
                import torch
                info["torch"] = True
                info["cuda"] = bool(torch.cuda.is_available())
                if info["cuda"]:
                    info["device"] = "cuda"
                    mem = torch.cuda.get_device_properties(0).total_memory
                    info["vram_mo"] = round(mem / 1024 / 1024)
                    info["name"] = torch.cuda.get_device_name(0) + " (GPU actif : PyTorch)"
            except ImportError:
                info["torch"] = False
                info["cuda"] = False
            return self.send_json(200, info)
        if self.server.static:
            # En local, même protection que nginx : /plateau/ et /cerveau/ demandent la connexion.
            if (p.startswith("/plateau") or p.startswith("/cerveau")) and not self.authed():
                self.send_response(302)
                self.send_header("Location", "/connexion/?suite=" + quote(p))
                self.end_headers()
                return None
            return super().do_GET()
        return self.send_json(404, {"error": "Introuvable."})

    def do_POST(self):
        p = self.path_only()
        if p == "/api/login":
            j = self.read_json() or {}
            given = str(j.get("password", "")).encode()
            if PASSWORD and hmac.compare_digest(given, PASSWORD.encode()):
                return self.send_json(200, {"ok": True}, self.cookie(make_session(), SESSION_DAYS * 86400))
            time.sleep(1.0)  # freine les essais en rafale
            return self.send_json(403, {"error": "Mot de passe incorrect."})
        if p == "/api/logout":
            return self.send_json(200, {"ok": True}, self.cookie("", 0))
        kind, slug = self.route()
        if kind and not self.need_auth():
            return None
        if kind == "jobs":
            j = self.read_json() or {}
            brain_slug = slugify(str(j.get("slug") or j.get("name") or ""))
            if not brain_slug or not os.path.exists(brain_path(brain_slug)):
                return self.send_json(400, {"error": "Enregistre d'abord le cerveau sous un nom."})
            brain = load_json(brain_path(brain_slug))
            cfg, err = validate_cerveau(brain, brain_slug)
            if err:
                return self.send_json(400, {"error": err})
            if j.get("methode") in METHODES:
                cfg["methode"] = j["methode"]
            if isinstance(j.get("reglages"), dict):
                cfg["reglages"].update({k: v for k, v in j["reglages"].items() if k in cfg["reglages"]})
                cfg, err = validate_cerveau({**cfg, "name": cfg["name"]}, brain_slug)
                if err:
                    return self.send_json(400, {"error": err})
            wpath = weights_path(brain_slug)
            if os.path.exists(wpath) and j.get("reprendre"):
                prev = load_json(wpath) or {}
                if prev.get("layers"):
                    cfg["poids"] = prev["layers"]
                if (prev.get("fichiers") or {}).get("pt"):
                    cfg["reprendre_pt"] = prev["fichiers"]["pt"]
            jid = time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)
            job = {
                "id": jid, "slug": brain_slug, "name": cfg["name"], "status": "queued",
                "created": int(time.time()), "methode": cfg["methode"], "config": cfg,
                "log": os.path.join(jobs_dir(), jid + ".log"),
                "weights": wpath,
            }
            atomic_json(job_path(jid), job)
            with _job_lock:
                kick_queue()
            job["queue"] = queue_position(jid)
            return self.send_json(200, job)
        if kind == "proc_stop":
            pid = int(slug)
            if not any(q["pid"] == pid for q in list_processes()):
                return self.send_json(404, {"error": "Ce pid n'est pas un processus de calcul du projet."})
            return self.send_json(200, {"pid": pid, **stop_listed([pid])})
        if kind == "procs_stop_all":
            # « Tout arrêter » annule aussi la file d'attente (équipe, 2026-10-28) : rien ne redémarre ensuite.
            annulees = []
            with _job_lock:
                for j in list_jobs():
                    if j.get("status") == "queued" and ID_RE.match(j.get("id") or ""):
                        j["status"] = "stopped"
                        j["error"] = "Annulée par « Tout arrêter »."
                        atomic_json(job_path(j["id"]), j)
                        annulees.append(j["id"])
            pids = [q["pid"] for q in list_processes()]
            res = stop_listed(pids) if pids else {"tues": [], "sigkill": False, "survivants": [], "taches": [], "grace_s": STOP_GRACE_S}
            res["annulees"] = annulees
            return self.send_json(200, res)
        if kind in ("job_pause", "job_resume", "job_stop"):
            if not ID_RE.match(slug or "") or not os.path.exists(job_path(slug)):
                return self.send_json(404, {"error": "Entraînement introuvable."})
            job = load_json(job_path(slug))
            action = kind.split("_", 1)[1]
            if action == "pause" and job.get("status") == "running":
                job["status"] = "paused"
            elif action == "resume" and job.get("status") == "paused":
                job["status"] = "running"
            elif action == "stop":
                if job.get("status") not in ("running", "paused", "queued"):
                    return self.send_json(400, {"error": "Cette action n'est pas possible dans l'état actuel."})
                res = stop_job(slug)
                return self.send_json(200, {"id": slug, "status": "stopped", **res})
            else:
                return self.send_json(400, {"error": "Cette action n'est pas possible dans l'état actuel."})
            atomic_json(job_path(slug), job)
            return self.send_json(200, {"id": slug, "status": job["status"]})
        return self.send_json(404, {"error": "Introuvable."})

    def do_PUT(self):
        kind, slug = self.route()
        if kind not in ("strat", "brain") or not SLUG_RE.match(slug or ""):
            return self.send_json(400, {"error": "Nom invalide."})
        if not self.authed():
            return self.send_json(401, {"error": "Connexion requise."})
        j = self.read_json()
        if j is None:
            return self.send_json(400, {"error": "JSON vide, trop gros ou illisible."})
        name = str(j.get("name", "")).strip()[:80]
        if not name or slugify(name) != slug:
            return self.send_json(400, {"error": "Nom invalide."})
        if kind == "strat":
            if not isinstance(j.get("program"), list) or not isinstance(j.get("params", {}), dict):
                return self.send_json(400, {"error": "Le JSON doit contenir « program » (liste) et « params »."})
            doc = {"format": "camelot-strategie", "version": 1, "name": name, "updated": int(time.time()),
                   "params": j.get("params", {}), "program": j["program"]}
            atomic_json(path_for(slug), doc)
            return self.send_json(200, {"slug": slug, "name": name, "updated": doc["updated"]})
        doc, err = validate_cerveau(j, slug)
        if err:
            return self.send_json(400, {"error": err})
        prev = load_json(brain_path(slug)) or {}
        doc["updated"] = int(time.time())
        doc["best_score"] = prev.get("best_score")
        doc["last_training"] = prev.get("last_training")
        atomic_json(brain_path(slug), doc)
        return self.send_json(200, {"slug": slug, "name": name, "updated": doc["updated"], "n_parametres": doc["n_parametres"]})

    def do_DELETE(self):
        kind, slug = self.route()
        if kind not in ("strat", "brain") or not SLUG_RE.match(slug or ""):
            return self.send_json(400, {"error": "Nom invalide."})
        if not self.authed():
            return self.send_json(401, {"error": "Connexion requise."})
        if kind == "strat":
            try:
                os.remove(path_for(slug))
            except FileNotFoundError:
                return self.send_json(404, {"error": "Stratégie introuvable."})
            return self.send_json(200, {"deleted": slug})
        try:
            os.remove(brain_path(slug))
        except FileNotFoundError:
            return self.send_json(404, {"error": "Cerveau introuvable."})
        base = os.path.join(weights_dir(), slug + ".modele")
        for extra in (weights_path(slug),) + tuple(base + ext for ext in (".pt", ".dernier.pt", ".onnx", ".meta.json", ".json", ".eval.json")):
            try:
                os.remove(extra)
            except FileNotFoundError:
                pass
        return self.send_json(200, {"deleted": slug})


def main():
    global DATA, SECRET
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8081)
    ap.add_argument("--static", help="sert aussi ce dossier (tests en local)")
    ap.add_argument("--data", help="dossier des stratégies (sinon ICAMLOT_DATA)")
    a = ap.parse_args()
    if a.data:
        DATA = a.data
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(brains_dir(), exist_ok=True)
    os.makedirs(jobs_dir(), exist_ok=True)
    os.makedirs(weights_dir(), exist_ok=True)
    SECRET = load_secret()
    reconcile_jobs()
    if not PASSWORD:
        print("ATTENTION : ICAMLOT_PASSWORD n'est pas défini, le simulateur est ouvert à tous.", flush=True)
    handler = partial(Handler, directory=a.static or ".")
    srv = ThreadingHTTPServer((a.host, a.port), handler)
    srv.static = bool(a.static)
    print(f"API sur http://{a.host}:{a.port} (données : {DATA})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
