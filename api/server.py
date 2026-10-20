#!/usr/bin/env python3
"""API des stratégies du programmeur de match (bibliothèque standard uniquement).

Chaque stratégie est un fichier JSON dans ICAMLOT_DATA (un fichier par nom).

  GET    /api/strategies          liste [{slug, name, updated, steps}]
  GET    /api/strategies/<slug>   stratégie complète {name, updated, params, program}
  PUT    /api/strategies/<slug>   enregistre {name, params, program}
  DELETE /api/strategies/<slug>   supprime

Si ICAMLOT_TOKEN est défini, PUT et DELETE exigent l'en-tête X-Team-Key.
En local : python3 api/server.py --static .  (sert aussi le site, pour tester)
"""
import argparse
import json
import os
import re
import secrets
import tempfile
import time
import unicodedata
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

DATA = os.environ.get("ICAMLOT_DATA", "/var/lib/icamlot/strategies")
TOKEN = os.environ.get("ICAMLOT_TOKEN", "")
MAX_BODY = 512 * 1024
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


def slugify(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:64]


def path_for(slug):
    return os.path.join(DATA, slug + ".json")


class Handler(SimpleHTTPRequestHandler):
    server_version = "icamlot-api"

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def route(self):
        p = self.path.split("?", 1)[0].rstrip("/")
        if p == "/api/strategies":
            return "list", None
        m = re.fullmatch(r"/api/strategies/([^/]+)", p)
        if m:
            return "item", m.group(1)
        return None, None

    def authorized(self):
        if not TOKEN:
            return True
        return secrets.compare_digest(self.headers.get("X-Team-Key", ""), TOKEN)

    def do_GET(self):
        kind, slug = self.route()
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
            return self.send_json(200, {"strategies": out, "locked": bool(TOKEN)})
        if kind == "item":
            if not SLUG_RE.match(slug) or not os.path.exists(path_for(slug)):
                return self.send_json(404, {"error": "Stratégie introuvable."})
            with open(path_for(slug), encoding="utf-8") as fh:
                return self.send_json(200, json.load(fh))
        if self.server.static:
            return super().do_GET()
        return self.send_json(404, {"error": "Introuvable."})

    def do_PUT(self):
        kind, slug = self.route()
        if kind != "item" or not SLUG_RE.match(slug):
            return self.send_json(400, {"error": "Nom invalide."})
        if not self.authorized():
            return self.send_json(403, {"error": "Clé d'équipe incorrecte."})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return self.send_json(413, {"error": "Stratégie vide ou trop grosse."})
        try:
            j = json.loads(self.rfile.read(n))
        except ValueError:
            return self.send_json(400, {"error": "JSON illisible."})
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
        if not self.authorized():
            return self.send_json(403, {"error": "Clé d'équipe incorrecte."})
        try:
            os.remove(path_for(slug))
        except FileNotFoundError:
            return self.send_json(404, {"error": "Stratégie introuvable."})
        return self.send_json(200, {"deleted": slug})


def main():
    global DATA
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8081)
    ap.add_argument("--static", help="sert aussi ce dossier (tests en local)")
    ap.add_argument("--data", help="dossier des stratégies (sinon ICAMLOT_DATA)")
    a = ap.parse_args()
    if a.data:
        DATA = a.data
    os.makedirs(DATA, exist_ok=True)
    handler = partial(Handler, directory=a.static or ".")
    srv = ThreadingHTTPServer((a.host, a.port), handler)
    srv.static = bool(a.static)
    print(f"API stratégies sur http://{a.host}:{a.port} (données : {DATA})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
