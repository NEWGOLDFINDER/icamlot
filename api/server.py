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

En local : python3 api/server.py --static .  (sert le site, protège /plateau/ et /cerveau/)
"""
import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
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
FAMILLES = ["prendre", "mur", "tour", "porte", "boulets", "prendreGraal", "poserGraal", "trone"]
ENTREES = ["temps", "robot", "paquets", "faces", "constructions", "graal", "boulets", "adversaire", "proprioception", "spatial"]
ENTREE_N = {
    "temps": 1,
    "robot": 4,
    "paquets": 10,
    "faces": 6,
    "constructions": 9,
    "graal": 4,
    "boulets": 1,
    "adversaire": 2,
    "proprioception": 11,
    "spatial": 8,
}
FAMILLE_N = {"prendre": 20, "mur": 20, "tour": 24, "porte": 20, "boulets": 1, "prendreGraal": 2, "poserGraal": 18, "trone": 1}

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


def validate_cerveau(j, slug):
    name = str(j.get("name", "")).strip()[:80]
    if not name or slugify(name) != slug:
        return None, "Nom invalide."
    entrees = j.get("entrees") or list(ENTREES)
    if not isinstance(entrees, list) or any(e not in ENTREE_N for e in entrees):
        return None, "Entrées inconnues."
    actions = j.get("actions") or {}
    familles = actions.get("familles") or list(FAMILLES)
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
    params = n_params(n_in, clean, n_out)
    if params > MAX_PARAMS:
        return None, f"Le réseau a {params} paramètres, le plafond est {MAX_PARAMS}."
    methode = j.get("methode") or "evolution"
    if methode not in METHODES:
        return None, "Méthode inconnue (evolution, imitation ou ppo)."
    architecture = str((j.get("reseau") or {}).get("architecture") or j.get("architecture") or "mlp")
    if architecture not in ("mlp", "transformer"):
        architecture = "mlp"
    regl = j.get("reglages") or {}
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
        "curriculum_sokoban": bool(regl.get("curriculum_sokoban", True)),
        "world_model": bool(regl.get("world_model", True)),
        "mcts_eval": bool(regl.get("mcts_eval", False)),
        "pretrain_imitation": bool(regl.get("pretrain_imitation", True)),
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
            "moteur": (j.get("metadonnees") or {}).get("moteur") or "1.1.0",
            "bareme": (j.get("metadonnees") or {}).get("bareme") or "2027-1.0",
        },
    }
    return doc, None


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
    proc = subprocess.Popen(
        [sys.executable, TRAINER_PY, "--job", path, "--strategies", DATA, "--weights-out", weights_out],
        cwd=REPO,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    _job_proc = proc
    _job_id = jid
    job["pid"] = proc.pid
    job["log"] = log
    job["weights"] = weights_out
    atomic_json(path, job)

    def watch():
        global _job_proc, _job_id
        proc.wait()
        with _job_lock:
            if _job_id == jid:
                _job_proc = None
                _job_id = None
            cur = load_json(path) or {}
            if cur.get("status") == "running":
                cur["status"] = "interrupted" if proc.returncode else "done"
                if proc.returncode:
                    cur["error"] = f"L'entraîneur s'est arrêté (code {proc.returncode})."
                atomic_json(path, cur)
            kick_queue()

    threading.Thread(target=watch, daemon=True).start()


def kick_queue():
    global _job_proc, _job_id
    if _job_proc and _job_proc.poll() is None:
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
            if meta.get("moteur") and meta.get("moteur") != "1.1.0":
                stale.append("moteur")
            if meta.get("bareme") and meta.get("bareme") != "2027-1.0":
                stale.append("bareme")
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
        if kind == "trainer":
            info = {"device": "cpu", "name": "CPU", "vram_mo": 0, "courant": _job_id, "queue": queue_position(_job_id or "")}
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
                cfg["poids"] = (load_json(wpath) or {}).get("layers")
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
                job["status"] = "stopped"
                with _job_lock:
                    if _job_id == slug and _job_proc and _job_proc.poll() is None:
                        _job_proc.terminate()
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
        for extra in (weights_path(slug),):
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
    if not PASSWORD:
        print("ATTENTION : ICAMLOT_PASSWORD n'est pas défini, le simulateur est ouvert à tous.", flush=True)
    handler = partial(Handler, directory=a.static or ".")
    srv = ThreadingHTTPServer((a.host, a.port), handler)
    srv.static = bool(a.static)
    print(f"API sur http://{a.host}:{a.port} (données : {DATA})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
