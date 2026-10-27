#!/usr/bin/env python3
"""Tests des routes cerveaux / entraînements (serveur déjà lancé)."""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("ICAMLOT_TEST", "http://127.0.0.1:8081")


def req(method, path, data=None, cookie=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(BASE + path, data=body, method=method)
    r.add_header("Content-Type", "application/json")
    if cookie:
        r.add_header("Cookie", cookie)
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            raw = resp.read()
            ct = resp.headers.get("content-type", "")
            return resp.status, json.loads(raw) if "json" in ct and raw else raw.decode(), resp.headers
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw), e.headers
        except Exception:
            return e.code, raw.decode(), e.headers


def main():
    st, _, _ = req("GET", "/api/auth")
    assert st == 204, st
    st, j, _ = req("PUT", "/api/cerveaux/test-api", {
        "name": "Test API",
        "entrees": ["temps", "robot", "paquets", "faces", "constructions", "graal", "boulets", "adversaire"],
        "actions": {"familles": ["prendre", "mur", "tour", "porte", "boulets", "prendreGraal", "poserGraal", "trone"]},
        "reseau": {"couches": [{"neurones": 8, "activation": "relu"}]},
        "methode": "evolution",
        "reglages": {"population": 4, "generations": 2, "duree_max": 60, "graine": 1},
    })
    assert st == 200, (st, j)
    assert j["n_parametres"] > 0
    st, j, _ = req("GET", "/api/cerveaux/test-api")
    assert st == 200 and j["name"] == "Test API", j
    st, j, _ = req("GET", "/api/cerveaux")
    assert st == 200 and any(c["slug"] == "test-api" for c in j["cerveaux"]), j

    # Test Cerveau PPO GPU avec Architecture Transformer et World Model
    st, j, _ = req("PUT", "/api/cerveaux/test-ppo", {
        "name": "Test PPO",
        "entrees": ["temps", "robot", "paquets", "faces", "constructions", "graal", "boulets", "adversaire"],
        "actions": {"familles": ["prendre", "mur", "tour", "porte", "boulets", "prendreGraal", "poserGraal", "trone"]},
        "reseau": {"couches": [{"neurones": 64, "activation": "relu"}], "architecture": "transformer"},
        "architecture": "transformer",
        "methode": "ppo",
        "reglages": {
            "ppo_steps": 50000,
            "ppo_batch_size": 128,
            "ppo_rollout_len": 32,
            "ppo_lr": 0.0003,
            "curriculum_sokoban": True,
            "world_model": True,
            "mcts_eval": True,
        },
    })
    assert st == 200, (st, j)
    st, j, _ = req("GET", "/api/cerveaux/test-ppo")
    assert st == 200, (st, j)
    assert j["methode"] == "ppo"
    assert j["reglages"]["ppo_steps"] == 50000
    assert j["reglages"]["curriculum_sokoban"] is True
    assert j["reglages"]["world_model"] is True
    assert j["reglages"]["mcts_eval"] is True
    assert j["architecture"] == "transformer"
    st, _, _ = req("DELETE", "/api/cerveaux/test-ppo")
    assert st == 200
    st, j, _ = req("PUT", "/api/cerveaux/test-api", {
        "name": "Test API",
        "reseau": {"couches": [{"neurones": 9999, "activation": "relu"}]},
    })
    assert st == 400, (st, j)
    st, j, _ = req("GET", "/api/trainer")
    assert st == 200 and "device" in j, j
    st, j, _ = req("DELETE", "/api/cerveaux/test-api")
    assert st == 200, (st, j)
    print("API ok")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("API KO:", e)
        sys.exit(1)
