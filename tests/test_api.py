#!/usr/bin/env python3
"""Tests des routes cerveaux / entraînements de api/server.py.

Avec pytest, un serveur est lancé sur un port libre avec un dossier de données temporaire et sans mot de passe.
Sans pytest : python3 tests/test_api.py vise un serveur déjà lancé (ICAMLOT_TEST, défaut http://127.0.0.1:8081).
"""
import json
import os
import signal
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


# ───────────── processus : lancement, arrêt, orphelins, authentification ─────────────
sys.path.insert(0, str(ROOT))
from api import server as srv  # noqa: E402  (fonctions /proc et arrêt testées directement)

BRAIN = {
    "name": "Test proc", "entrees": ENTREES, "actions": {"familles": FAMILLES},
    "reseau": {"couches": [{"neurones": 8, "activation": "relu"}]}, "methode": "evolution",
    # longue durée pour que la tâche tourne jusqu'à ce que le test l'arrête
    "reglages": {"population": 4, "generations": 500, "duree_max": 1800, "graine": 1, "processus": 2},
}


def start_api(tmp, port, password="", grace="3"):
    """API sur tmp/strategies ; les tâches vont dans tmp/trainings (voir jobs_dir)."""
    env = dict(os.environ, ICAMLOT_PASSWORD=password, ICAMLOT_STOP_GRACE_S=grace)
    p = subprocess.Popen([sys.executable, str(ROOT / "api" / "server.py"), "--port", str(port),
                          "--data", str(tmp / "strategies")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            urllib.request.urlopen(base + "/api/auth", timeout=1)
            break
        except urllib.error.HTTPError:
            break
        except Exception:
            time.sleep(0.1)
    return p, base


def gone(pid):
    st = srv.proc_stat(pid)
    return st is None or st[0] in ("Z", "X")


def wait_for(cond, what, timeout=120):
    end = time.time() + timeout
    while time.time() < end:
        v = cond()
        if v:
            return v
        time.sleep(0.3)
    raise AssertionError("délai dépassé : " + what)


def launch(base, slug="test-proc"):
    st, j, _ = req("PUT", f"/api/cerveaux/{slug}", dict(BRAIN, name=slug), base=base)
    assert st == 200, (st, j)
    st, j, _ = req("POST", "/api/trainings", {"slug": slug}, base=base)
    assert st == 200, (st, j)
    return j["id"]


def status_of(base, jid):
    return req("GET", f"/api/trainings/{jid}", base=base)[1]


def procs_of(base, jid):
    st, j, _ = req("GET", "/api/processus", base=base)
    assert st == 200, (st, j)
    return [q for q in j["processus"] if q["tache"] == jid]


def running_with_workers(base, jid):
    """Attend l'entraîneur et au moins un worker Node, renvoie (pid entraîneur, pids workers)."""
    def cond():
        ps = procs_of(base, jid)
        tr = [q["pid"] for q in ps if q["type"] == "entraineur"]
        wk = [q["pid"] for q in ps if q["type"] == "worker"]
        return (tr[0], wk) if tr and wk else None
    return wait_for(cond, "entraîneur et workers Node")


def cleanup(base, proc, tmp):
    try:
        req("POST", "/api/processus/stop-all", {}, base=base)
    except Exception:
        pass
    proc.terminate()
    proc.wait(timeout=10)
    for pid in srv.all_pids():  # filet : tout processus encore rattaché au dossier de test
        if str(tmp) in " ".join(srv.proc_cmdline(pid)):
            srv._signal(pid, signal.SIGKILL)


def dead_pid():
    p = subprocess.Popen([sys.executable, "-c", "pass"])
    p.wait()
    return p.pid


def test_lancement_stop_et_workers(tmp_path):
    api, base = start_api(tmp_path, _free_port())
    try:
        jid = launch(base)
        tr, wk = running_with_workers(base, jid)
        j = status_of(base, jid)
        assert j["status"] == "running" and j["pid"] == tr
        assert os.getpgid(tr) == tr  # nouveau groupe de processus
        assert all(os.getpgid(w) == tr for w in wk)
        q = next(x for x in procs_of(base, jid) if x["pid"] == tr)
        assert q["duree_s"] >= 0 and q["rss_mo"] and q["nom"]
        st, r, _ = req("POST", f"/api/trainings/{jid}/stop", {}, base=base)
        assert st == 200 and r["status"] == "stopped", (st, r)
        wait_for(lambda: all(gone(p) for p in [tr] + wk), "disparition de l'entraîneur et des workers", 20)
        time.sleep(1.0)  # le watcher ne doit pas réécrire 'interrupted'
        j = status_of(base, jid)
        assert j["status"] == "stopped" and not j.get("error"), j
        assert procs_of(base, jid) == []
    finally:
        cleanup(base, api, tmp_path)


def test_stop_processus_et_stop_all(tmp_path):
    api, base = start_api(tmp_path, _free_port())
    try:
        jid = launch(base)
        tr, wk = running_with_workers(base, jid)
        jid2 = launch(base, "test-proc2")  # en file d'attente
        assert status_of(base, jid2)["status"] == "queued"
        # pid hors liste : refusé (pid de pytest, pid 1, pid inexistant)
        for bad in (os.getpid(), 1, 99999999):
            st, r, _ = req("POST", f"/api/processus/{bad}/stop", {}, base=base)
            assert st == 404, (bad, st, r)
        assert not gone(os.getpid())
        # arrêt d'un processus de la liste : un worker arrête tout l'entraîneur ; la file reprend
        st, r, _ = req("POST", f"/api/processus/{wk[0]}/stop", {}, base=base)
        assert st == 200 and jid in r["taches"], (st, r)
        wait_for(lambda: all(gone(p) for p in [tr] + wk), "arrêt via /api/processus/<pid>/stop", 20)
        assert status_of(base, jid)["status"] == "stopped"
        tr2, wk2 = running_with_workers(base, jid2)
        assert status_of(base, jid2)["status"] == "running"
        # tout arrêter : arrête les processus ET annule la file d'attente
        jid3 = launch(base, "test-proc3")
        assert status_of(base, jid3)["status"] == "queued"
        st, r, _ = req("POST", "/api/processus/stop-all", {}, base=base)
        assert st == 200 and jid2 in r["taches"] and r["annulees"] == [jid3], (st, r)
        wait_for(lambda: all(gone(p) for p in [tr2] + wk2), "arrêt de tous les processus", 20)
        assert status_of(base, jid2)["status"] == "stopped"
        assert status_of(base, jid3)["status"] == "stopped"
        time.sleep(3)
        st, r, _ = req("GET", "/api/processus", base=base)
        assert st == 200 and r["processus"] == [], r
        st, r, _ = req("POST", "/api/processus/stop-all", {}, base=base)
        assert st == 200 and r["tues"] == []
    finally:
        cleanup(base, api, tmp_path)


def test_orphelins_interrompus_et_file_reprise(tmp_path):
    """Au démarrage : running/paused sans pid vivant -> interrupted ; la tâche en file démarre."""
    api, base = start_api(tmp_path, _free_port())
    try:
        jid = launch(base)  # crée le cerveau et la config valide d'une tâche
        req("POST", f"/api/trainings/{jid}/stop", {}, base=base)
        jobs = tmp_path / "trainings"
        modele = json.loads((jobs / (jid + ".json")).read_text())
        api.terminate()
        api.wait(timeout=10)
        mort = dead_pid()
        ids = {"a": "20260101-000000-aaaaaa", "b": "20260101-000001-bbbbbb", "c": "20260101-000002-cccccc"}
        for k, st, pid in (("a", "running", mort), ("b", "paused", None)):
            (jobs / (ids[k] + ".json")).write_text(json.dumps({"id": ids[k], "status": st, "created": 1, "name": k, "pid": pid}))
        (jobs / (ids["c"] + ".json")).write_text(json.dumps(dict(modele, id=ids["c"], status="queued", created=2,
                                                                  log=str(jobs / "c.log"), pid=None)))
        api, base = start_api(tmp_path, _free_port())
        for k in ("a", "b"):
            j = status_of(base, ids[k])
            assert j["status"] == "interrupted" and "ne tourne plus" in j["error"], j
        if mort:
            assert str(mort) in status_of(base, ids["a"])["error"]
        running_with_workers(base, ids["c"])  # la file a repris
        assert status_of(base, ids["c"])["status"] == "running"
    finally:
        cleanup(base, api, tmp_path)


def test_stop_apres_redemarrage_de_l_api(tmp_path):
    port = _free_port()
    api, base = start_api(tmp_path, port)
    try:
        jid = launch(base)
        tr, wk = running_with_workers(base, jid)
        api.terminate()  # l'entraîneur est dans son propre groupe : il survit à l'API
        api.wait(timeout=10)
        assert not gone(tr)
        api, base = start_api(tmp_path, port)
        assert status_of(base, jid)["status"] == "running"  # vivant : pas marqué interrupted
        assert [q["pid"] for q in procs_of(base, jid) if q["type"] == "entraineur"] == [tr]
        st, r, _ = req("POST", f"/api/trainings/{jid}/stop", {}, base=base)
        assert st == 200, (st, r)
        wait_for(lambda: all(gone(p) for p in [tr] + wk), "arrêt d'un entraîneur d'une instance précédente", 20)
        assert status_of(base, jid)["status"] == "stopped"
    finally:
        cleanup(base, api, tmp_path)


def test_processus_exige_authentification(tmp_path):
    api, base = start_api(tmp_path, _free_port(), password="secret-de-test")
    try:
        assert req("GET", "/api/processus", base=base)[0] == 401
        assert req("POST", f"/api/processus/{os.getpid()}/stop", {}, base=base)[0] == 401
        assert req("POST", "/api/processus/stop-all", {}, base=base)[0] == 401
        st, _, h = req("POST", "/api/login", {"password": "secret-de-test"}, base=base)
        assert st == 200
        cookie = h["Set-Cookie"].split(";")[0]
        st, j, _ = req("GET", "/api/processus", cookie=cookie, base=base)
        assert st == 200 and j["processus"] == []
        assert req("POST", f"/api/processus/{os.getpid()}/stop", {}, cookie=cookie, base=base)[0] == 404
    finally:
        cleanup(base, api, tmp_path)


def test_escalade_sigkill():
    """Un entraîneur qui ignore SIGTERM est tué (SIGKILL) après le délai, avec ses descendants."""
    code = ("import signal,subprocess,sys,time\n"
            "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
            "c = subprocess.Popen([sys.executable, '-c', 'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(300)'])\n"
            "print(c.pid, flush=True); time.sleep(300)")
    p = subprocess.Popen([sys.executable, "-c", code, "trainer.trainer"], stdout=subprocess.PIPE, text=True,
                         start_new_session=True, cwd=str(ROOT))
    child = int(p.stdout.readline())
    try:
        assert srv.proc_kind(p.pid) == "trainer" and not gone(child)
        t0 = time.time()
        res = srv.stop_processes([p.pid], grace=1.0)
        assert res["sigkill"] and res["survivants"] == [], res
        assert time.time() - t0 >= 1.0
        p.wait(timeout=5)
        wait_for(lambda: gone(child), "descendant tué", 5)
    finally:
        p.kill()
        p.wait()


def _job_with_log(tmp_path, status, log_lines, pid=None):
    """Tâche + journal dans tmp_path/trainings (srv.DATA pointe sur tmp_path/strategies, restauré par l'appelant)."""
    import secrets
    jobs = tmp_path / "trainings"
    jobs.mkdir(parents=True, exist_ok=True)
    jid = "20260101-000009-" + secrets.token_hex(3)
    log = jobs / (jid + ".log")
    log.write_text("\n".join(log_lines) + "\n")
    (jobs / (jid + ".json")).write_text(json.dumps({"id": jid, "status": status, "created": 1, "log": str(log), "pid": pid}))
    return jid


def test_statut_final_selon_le_journal_et_le_code_retour(tmp_path):
    """Une sortie sur exception donne 'error' avec son message, quel que soit le code retour (cas b99da7)."""
    old = srv.DATA
    srv.DATA = str(tmp_path / "strategies")
    try:
        fatal = ["[10:00:00] Entraîneur démarré", "Traceback (most recent call last):", '  File "x.py", line 1, in <module>',
                 "AttributeError: 'FactorizedEncoder' object has no attribute 'geo_mlp'"]
        ok = ["[10:00:00] Entraîneur démarré", "[10:05:00] Terminé. Poids enregistrés."]
        cas = [  # (statut écrit par l'entraîneur, journal, code retour, statut attendu)
            ("done", fatal, 0, "error"),        # 'done' malgré l'exception
            ("running", fatal, 0, "error"),     # code 0 malgré l'exception
            ("running", fatal, 1, "error"),
            ("running", ok, 0, "done"),
            ("running", ["[10:00:00] x"], -15, "interrupted"),
            ("running", ["[10:00:00] x"], 143, "interrupted"),
            ("running", ["[10:00:00] x"], 3, "error"),
            ("done", ok, 0, "done"),
        ]
        for st, lines, rc, attendu in cas:
            jid = _job_with_log(tmp_path, st, lines)
            srv.finish_job(jid, rc)
            j = srv.load_json(srv.job_path(jid))
            assert j["status"] == attendu, (st, rc, attendu, j)
            if attendu == "error" and lines is fatal:
                assert "geo_mlp" in j["error"], j
        # tâche arrêtée par l'utilisateur : inchangée
        jid = _job_with_log(tmp_path, "stopped", fatal)
        srv.finish_job(jid, -15)
        assert srv.load_json(srv.job_path(jid))["status"] == "stopped"
        # redémarrage de l'API : pid mort + erreur fatale dans le journal -> 'error' avec le message
        jid = _job_with_log(tmp_path, "running", fatal, pid=dead_pid())
        jid2 = _job_with_log(tmp_path, "running", ok[:1], pid=dead_pid())
        srv.reconcile_jobs()
        a, b = srv.load_json(srv.job_path(jid)), srv.load_json(srv.job_path(jid2))
        assert a["status"] == "error" and "geo_mlp" in a["error"], a
        assert b["status"] == "interrupted" and "ne tourne plus" in b["error"], b
    finally:
        srv.DATA = old


def test_exception_de_l_entraineur_donne_error(tmp_path):
    """De bout en bout : un entraîneur qui plante (point de sauvegarde illisible) -> tâche 'error' avec message."""
    api, base = start_api(tmp_path, _free_port())
    try:
        st, j, _ = req("PUT", "/api/cerveaux/test-ppo-ko", {
            "name": "test-ppo-ko", "entrees": ENTREES, "actions": {"familles": FAMILLES}, "methode": "ppo",
            "reglages": {"ppo_steps": 5000, "ppo_batch_size": 16, "processus": 1}}, base=base)
        assert st == 200, (st, j)
        bad = tmp_path / "weights" / "ancien.pt"
        bad.parent.mkdir(parents=True, exist_ok=True)
        bad.write_bytes(b"pas un point de sauvegarde")
        (tmp_path / "weights" / "test-ppo-ko.json").write_text(json.dumps({"fichiers": {"pt": str(bad)}}))
        st, j, _ = req("POST", "/api/trainings", {"slug": "test-ppo-ko", "reprendre": True}, base=base)
        assert st == 200, (st, j)
        jid = j["id"]
        j = wait_for(lambda: (lambda x: x if x["status"] not in ("queued", "running") else None)(status_of(base, jid)),
                     "fin de la tâche", 90)
        assert j["status"] == "error" and j.get("error"), j
        wait_for(lambda: req("GET", "/api/processus", base=base)[1]["processus"] == [], "sortie de l'entraîneur", 20)
    finally:
        cleanup(base, api, tmp_path)


def test_route_trainer_expose_les_coeurs(tmp_path):
    api, base = start_api(tmp_path, _free_port())
    try:
        st, j, _ = req("GET", "/api/trainer", base=base)
        assert st == 200 and j["cpu_count"] == (os.cpu_count() or 1)
        assert j["cpu_affinite"] == len(os.sched_getaffinity(0)) and 1 <= j["procs_auto"]
        assert j["envs_par_coeur_alerte"] > 0
    finally:
        cleanup(base, api, tmp_path)


def main():
    run_checks()
    print("API ok")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("API KO:", e)
        sys.exit(1)
