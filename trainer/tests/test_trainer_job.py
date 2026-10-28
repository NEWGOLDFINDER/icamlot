"""Tâches lancées par l'API (python -m trainer.trainer) : évolution, imitation, PPO sur le moteur JS."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
pytestmark = pytest.mark.lent

BASE_CFG = {
    "name": "Test", "entrees": None, "actions": {"familles": None},
    "reseau": {"couches": [{"neurones": 8, "activation": "relu"}]},
    "adversaire": {"intensite": "aucun"}, "recompense": {"sur_erreur": "penalite"},
}


def run_job(tmp_path, methode, reglages):
    cfg = dict(BASE_CFG, methode=methode, reglages=dict(reglages, processus=1, graine=1))
    job = tmp_path / "job.json"
    out = tmp_path / "poids.json"
    job.write_text(json.dumps({"id": "test", "status": "queued", "config": cfg, "log": str(tmp_path / "job.log")}))
    (tmp_path / "strategies").mkdir()
    res = subprocess.run([sys.executable, "-m", "trainer.trainer", "--job", str(job), "--strategies",
                          str(tmp_path / "strategies"), "--weights-out", str(out)], cwd=ROOT,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=900)
    j = json.loads(job.read_text())
    assert res.returncode == 0 and j["status"] == "done", (res.stdout[-3000:], (tmp_path / "job.log").read_text()[-3000:])
    return j, json.loads(out.read_text())


def test_job_evolution(tmp_path):
    j, poids = run_job(tmp_path, "evolution", {"population": 2, "generations": 1, "duree_max": 60})
    assert poids["layers"] and poids["catalogue_version"]
    assert j["progress"]["methode"] == "evolution"


def test_job_imitation(tmp_path):
    j, poids = run_job(tmp_path, "imitation", {"epoques": 3, "imitation_scenarios": 1, "eval_matchs": 1, "hidden": 16})
    assert poids["architecture"] == "recurrent" and poids["modele"]["format"] == "icamlot-modele-recurrent"
    assert Path(poids["fichiers"]["onnx"]).exists() and Path(poids["fichiers"]["meta"]).exists()
    assert poids["evaluation"]["matchs"] == 1


def test_job_ppo(tmp_path):
    j, poids = run_job(tmp_path, "ppo", {"ppo_steps": 4, "ppo_batch_size": 2, "ppo_rollout_len": 2, "epoques": 2,
                                         "imitation_scenarios": 1, "eval_matchs": 1, "hidden": 16})
    assert poids["architecture"] == "recurrent" and poids["evaluation"]["matchs"] == 1
    assert j["progress"]["methode"] == "ppo" and j["progress"]["history"]
    assert Path(poids["fichiers"]["pt"]).exists()
