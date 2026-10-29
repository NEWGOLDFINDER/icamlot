"""benchmark_duels.py de bout en bout : un petit modèle temporaire (ONNX, .pt, ou politique aléatoire) joue 2 matchs dans le moteur
JS de référence, l'un contre le Bâtisseur en jaune, l'autre sans adversaire en bleu. Vérifie le rapport JSON et le tableau Markdown."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

import embarque_fixtures as F  # noqa: E402  (insère la racine du dépôt dans sys.path)

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

pytestmark = pytest.mark.lent

ARGS_COMMUNS = ["--matchs", "2", "--robots", "batisseur", "--sans-adversaire", "--processus", "1", "--envs-par-processus", "1"]


@pytest.fixture(scope="module")
def petit_modele(tmp_path_factory):
    """(.onnx, .pt) : imitation de 1 époque du programme d'exemple, 2 scénarios (trainer/README.md)."""
    return F.exporter_petit_modele(tmp_path_factory.mktemp("bench"), "petit", 1)


@pytest.mark.parametrize("cas", ["onnx", "pt", "aleatoire"])
def test_deux_matchs_par_couleur_et_par_adversaire(cas, petit_modele, tmp_path):
    import benchmark_duels as B

    onnx, pt = petit_modele
    chemin = {"onnx": str(onnx), "pt": str(pt), "aleatoire": None}[cas]
    sortie, rapport = tmp_path / "duels.json", tmp_path / "duels.md"
    args_modele = ["--modele", chemin] if chemin else []
    r = B.main([*args_modele, *ARGS_COMMUNS, "--sortie", str(sortie), "--rapport", str(rapport)])

    assert r["matchs"] == 2
    assert r["duels"] == 1                                     # un match contre le Bâtisseur ; le match seul n'a pas d'adversaire
    assert set(r["par_equipe"]) == {"yellow", "blue"}          # un match par couleur (répartition équilibrée de l'évaluation)
    assert set(r["par_adversaire"]) == {"robot:batisseur · realiste", "sans adversaire · aucun"}
    assert set(r["par_adversaire"]["robot:batisseur · realiste"]["par_equipe"]) == {"yellow"}
    assert set(r["par_adversaire"]["sans adversaire · aucun"]["par_equipe"]) == {"blue"}
    assert r["protocole"]["modele"] == (chemin or "politique aléatoire (référence)")
    assert r["protocole"]["glouton"] is True

    assert json.loads(sortie.read_text(encoding="utf-8"))["matchs"] == 2
    md = rapport.read_text(encoding="utf-8")
    assert "| Adversaire |" in md and "robot:batisseur · realiste" in md and "sans adversaire · aucun" in md
