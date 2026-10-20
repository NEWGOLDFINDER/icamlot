#!/usr/bin/env python3
"""API du simulateur ICAM LOT (bibliothèque standard uniquement).

Accès protégé par un mot de passe d'équipe (ICAMLOT_PASSWORD) : une connexion
réussie pose un cookie de session signé, valable 30 jours.

  POST   /api/login               {password} -> cookie de session
  POST   /api/logout              efface le cookie
  GET    /api/auth                204 si la session est valide, sinon 401 (pour nginx auth_request)
  GET    /api/strategies          liste [{slug, name, updated, steps}]
  GET    /api/strategies/<slug>   stratégie complète {name, updated, params, program}
  PUT    /api/strategies/<slug>   enregistre {name, params, program}
  DELETE /api/strategies/<slug>   supprime

Chaque stratégie est un fichier JSON dans ICAMLOT_DATA (un fichier par nom).
En local : python3 api/server.py --static .  (sert aussi le site et protège /plateau/)
"""
import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import time
import unicodedata
from functools import partial
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote

DATA = os.environ.get("ICAMLOT_DATA", "/var/lib/icamlot/strategies")
PASSWORD = os.environ.get("ICAMLOT_PASSWORD", "")
COOKIE = "icamlot_session"
SESSION_DAYS = 30
MAX_BODY = 512 * 1024
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
SECRET = b""


def slugify(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:64]


def path_for(slug):
    return os.path.join(DATA, slug + ".json")


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

    def path_only(self):
        return self.path.split("?", 1)[0]

    def route(self):
        p = self.path_only().rstrip("/")
        if p == "/api/strategies":
            return "list", None
        m = re.fullmatch(r"/api/strategies/([^/]+)", p)
        if m:
            return "item", m.group(1)
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

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return None
        try:
            return json.loads(self.rfile.read(n))
        except ValueError:
            return None

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
        if kind == "list":
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
        if kind == "item":
            if not SLUG_RE.match(slug) or not os.path.exists(path_for(slug)):
                return self.send_json(404, {"error": "Stratégie introuvable."})
            with open(path_for(slug), encoding="utf-8") as fh:
                return self.send_json(200, json.load(fh))
        if self.server.static:
            # En local, même protection que nginx : /plateau/ demande la connexion.
            if p.startswith("/plateau") and not self.authed():
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
        return self.send_json(404, {"error": "Introuvable."})

    def do_PUT(self):
        kind, slug = self.route()
        if kind != "item" or not SLUG_RE.match(slug):
            return self.send_json(400, {"error": "Nom invalide."})
        if not self.authed():
            return self.send_json(401, {"error": "Connexion requise."})
        j = self.read_json()
        if j is None:
            return self.send_json(400, {"error": "JSON vide, trop gros ou illisible."})
        name = str(j.get("name", "")).strip()[:80]
        if not name or slugify(name) != slug:
            return self.send_json(400, {"error": "Nom invalide."})
        if not isinstance(j.get("program"), list) or not isinstance(j.get("params", {}), dict):
            return self.send_json(400, {"error": "Le JSON doit contenir « program » (liste) et « params »."})
        doc = {"format": "camelot-strategie", "version": 1, "name": name, "updated": int(time.time()),
               "params": j.get("params", {}), "program": j["program"]}
        fd, tmp = tempfile.mkstemp(dir=DATA, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, path_for(slug))
        return self.send_json(200, {"slug": slug, "name": name, "updated": doc["updated"]})

    def do_DELETE(self):
        kind, slug = self.route()
        if kind != "item" or not SLUG_RE.match(slug):
            return self.send_json(400, {"error": "Nom invalide."})
        if not self.authed():
            return self.send_json(401, {"error": "Connexion requise."})
        try:
            os.remove(path_for(slug))
        except FileNotFoundError:
            return self.send_json(404, {"error": "Stratégie introuvable."})
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
