#!/usr/bin/env python3
"""Tests des routes cerveaux / entraînements de api/server.py.

Avec pytest, un serveur est lancé sur un port libre avec un dossier de données temporaire et sans mot de passe.
Sans pytest : python3 tests/test_api.py vise un serveur déjà lancé (ICAMLOT_TEST, défaut http://127.0.0.1:8081).
"""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = os.environ.get("ICAMLOT_TEST", "http://127.0.0.1:8081")

# Entrées et familles lues dans le moteur JS de référence (aucun identifiant en dur).
_IDS = json.loads(subprocess.check_output(["node", "-e", """
var c = require(require('path').join(process.argv[1], 'engine', 'load.js')).loadIcamlot(process.argv[1]);
process.stdout.write(JSON.stringify({e: c.ENV.GROUPS.map(function (x) { return x.id; }),
  f: c.ACTIONS.FAMILLES.map(function (x) { return x.id; })}));""", str(ROOT)]))
ENTREES, FAMILLES = _IDS["e"], _IDS["f"]


def req(method, path, data=None, cookie=None, base=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request((base or BASE) + path, data=body, method=method)
    r.add_header("Content-Type", "application/json")
    if cookie:
        r.add_header("Cookie", cookie)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read()
            ct = resp.headers.get("content-type", "")
            return resp.status, json.loads(raw) if "json" in ct and raw else raw.decode(), resp.headers
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw), e.headers
        except Exception:
            return e.code, raw.decode(), e.headers


def env_sizes():
    """n_in / n_out attendus, lus dans le moteur JS (pas de valeurs en dur)."""
    js = ("var c=require(process.argv[1]+'/engine/load.js').loadIcamlot(process.argv[1]);"
          "process.stdout.write(JSON.stringify({i:c.ENV.nInputs(JSON.parse(process.argv[2])),"
          "o:c.ACTIONS.filterByFamilles(JSON.parse(process.argv[3])).length}))")
    out = subprocess.run(["node", "-e", js, str(ROOT), json.dumps(ENTREES), json.dumps(FAMILLES)],
                         stdout=subprocess.PIPE, text=True, check=True).stdout
    j = json.loads(out)
    return j["i"], j["o"]


def run_checks(base=None):
    st, _, _ = req("GET", "/api/auth", base=base)
    assert st == 204, st
    st, j, _ = req("PUT", "/api/cerveaux/test-api", {
        "name": "Test API", "entrees": ENTREES, "actions": {"familles": FAMILLES},
        "reseau": {"couches": [{"neurones": 8, "activation": "relu"}]},
        "methode": "evolution",
        "reglages": {"population": 4, "generations": 2, "duree_max": 60, "graine": 1},
    }, base=base)
    assert st == 200, (st, j)
    assert j["n_parametres"] > 0
    st, j, _ = req("GET", "/api/cerveaux/test-api", base=base)
    assert st == 200 and j["name"] == "Test API", j
    n_in, n_out = env_sizes()
    assert j["n_entrees"] == n_in and j["n_sorties"] == n_out, (j["n_entrees"], j["n_sorties"], n_in, n_out)
    assert j["architecture"] == "mlp"
    st, j, _ = req("GET", "/api/cerveaux", base=base)
    assert st == 200 and any(c["slug"] == "test-api" for c in j["cerveaux"]), j

    # Cerveau PPO : options du moteur abstrait retirées, nouvelles options présentes
    st, j, _ = req("PUT", "/api/cerveaux/test-ppo", {
        "name": "Test PPO", "entrees": ENTREES, "actions": {"familles": FAMILLES},
        "reseau": {"couches": [{"neurones": 64, "activation": "relu"}], "architecture": "transformer"},
        "methode": "ppo",
        "reglages": {"ppo_steps": 50000, "ppo_batch_size": 128, "ppo_rollout_len": 32, "ppo_lr": 0.0003,
                     "curriculum_sokoban": True, "world_model": True, "mcts_eval": True, "eval_matchs": 20,
                     "processus": 3},
    }, base=base)
    assert st == 200, (st, j)
    st, j, _ = req("GET", "/api/cerveaux/test-ppo", base=base)
    assert st == 200, (st, j)
    assert j["methode"] == "ppo"
    assert j["architecture"] == "recurrent"
    r = j["reglages"]
    assert r["ppo_steps"] == 50000 and r["eval_matchs"] == 20 and r["processus"] == 3
    for k in ("curriculum_sokoban", "world_model", "mcts_eval"):
        assert k not in r, k
    assert r["pretrain_imitation"] is True
    st, _, _ = req("DELETE", "/api/cerveaux/test-ppo", base=base)
    assert st == 200
    st, j, _ = req("PUT", "/api/cerveaux/test-api", {
        "name": "Test API", "reseau": {"couches": [{"neurones": 9999, "activation": "relu"}]},
    }, base=base)
    assert st == 400, (st, j)
    st, j, _ = req("PUT", "/api/cerveaux/test-api", {"name": "Test API", "entrees": ["inconnue"]}, base=base)
    assert st == 400, (st, j)
    st, j, _ = req("GET", "/api/trainer", base=base)
    assert st == 200 and "device" in j, j
    st, j, _ = req("POST", "/api/trainings", {"slug": "inexistant"}, base=base)
    assert st == 400, (st, j)
    st, j, _ = req("DELETE", "/api/cerveaux/test-api", base=base)
    assert st == 200, (st, j)


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def test_api(tmp_path):
    port = _free_port()
    data = tmp_path / "strategies"
    env = dict(os.environ, ICAMLOT_PASSWORD="")
    proc = subprocess.Popen([sys.executable, str(ROOT / "api" / "server.py"), "--port", str(port), "--data", str(data)],
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(base + "/api/auth", timeout=1)
                break
            except urllib.error.HTTPError:
                break
            except Exception:
                time.sleep(0.1)
        run_checks(base)
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def main():
    run_checks()
    print("API ok")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("API KO:", e)
        sys.exit(1)
