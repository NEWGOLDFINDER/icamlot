"""pi5_runner : versions refusées, masque, état caché, pas de dépendance à torch ni aux chemins hérités."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys

import numpy as np
import pytest

import embarque_fixtures as F
import pi5_runner
from pi5_runner import ModeleIncompatible, Politique, charger_meta, ouvrir


@pytest.fixture(scope="module")
def petit(tmp_path_factory):
    return F.modele_de_test(tmp_path_factory, "petit")[0]


def copie_avec_meta(onnx, dossier, modif):
    """Copie le modèle et son meta dans `dossier`, le meta modifié par modif(dict)."""
    dossier.mkdir(parents=True, exist_ok=True)
    cible = dossier / onnx.name
    shutil.copy(onnx, cible)
    meta = json.loads(onnx.with_suffix(".meta.json").read_text(encoding="utf-8"))
    modif(meta)
    cible.with_suffix(".meta.json").write_text(json.dumps(meta), encoding="utf-8")
    return cible


def test_modele_compatible_accepte(petit):
    pont, pol, meta = ouvrir(petit)
    with pont:
        assert meta["obs_version"] == pont.hello_info["obsVersion"] and meta["catalogue_version"] == pont.hello_info["catalogueVersion"]
        assert pol.n_in == pont.hello_info["nInputs"] and pol.n_out == pont.hello_info["nOutputs"]


@pytest.mark.parametrize("champ,valeur,attendu", [
    ("obs_version", "icamlot-obs-2.9", "obs_version"),
    ("catalogue_version", "empreinte:0000000000000000", "catalogue_version"),
    ("n_in", 56, "entrées"),
    ("n_out", 130, "actions"),
])
def test_ecart_de_version_ou_de_dimension_refuse(petit, tmp_path, champ, valeur, attendu):
    onnx = copie_avec_meta(petit, tmp_path / champ, lambda m: m.__setitem__(champ, valeur))
    with pytest.raises(ModeleIncompatible, match=attendu):
        ouvrir(onnx)


def test_catalogue_different_refuse(petit, tmp_path):
    def modif(m):
        m["catalogue"] = [dict(a) for a in m["catalogue"]]
        m["catalogue"][3]["label"] = "autre action"
    with pytest.raises(ModeleIncompatible, match="catalogue"):
        ouvrir(copie_avec_meta(petit, tmp_path / "cat", modif))


def test_meta_absent_refuse(petit, tmp_path):
    d = tmp_path / "sans_meta"
    d.mkdir()
    shutil.copy(petit, d / petit.name)
    with pytest.raises(ModeleIncompatible, match="introuvable"):
        charger_meta(d / petit.name)


def test_modele_herite_56_entrees_refuse_par_la_ligne_de_commande():
    """Le modèle versionné .data/modeles/fumee (observation à 56 entrées, avant la v3) doit être refusé, code de sortie 2."""
    fumee = F.ROOT / ".data" / "modeles" / "fumee.onnx"
    if not fumee.exists():
        pytest.skip("fumee.onnx absent")
    r = subprocess.run([sys.executable, "pi5_runner.py", "--modele", str(fumee), "--simulation"], cwd=str(F.ROOT), capture_output=True, text=True, timeout=120)
    assert r.returncode == 2, r.stdout + r.stderr
    assert "Modèle refusé" in r.stderr and "obs_version" in r.stderr


def test_etat_cache_zero_au_depart_et_reinjecte_une_fois_par_decision(petit):
    import onnxruntime as ort
    meta = charger_meta(petit)
    pol = Politique(petit, meta)
    ref = ort.InferenceSession(str(petit), providers=["CPUExecutionProvider"])
    rng = np.random.default_rng(1)
    h = np.zeros((1, meta["hidden"]), np.float32)
    assert not pol.h.any()
    for _ in range(5):
        obs = rng.random(meta["n_in"]).astype(np.float32)
        lg_ref, h = ref.run(["logits", "next_hidden"], {"obs": obs[None], "hidden": h})
        lg = pol.logits(obs.tolist())
        assert np.array_equal(lg, lg_ref[0])
        assert np.array_equal(pol.h, h)
    assert pol.h.any()
    pol.reset()
    assert not pol.h.any()


def test_masque_applique_aux_logits(petit):
    meta = charger_meta(petit)
    pol = Politique(petit, meta)
    rng = np.random.default_rng(2)
    obs = None
    for k in range(20):
        obs = rng.random(meta["n_in"]).astype(np.float32).tolist()
        pol.reset()
        brut = int(np.argmax(pol.logits(obs)))
        mask = np.ones(meta["n_out"], int)
        mask[brut] = 0                                    # on interdit le meilleur choix non masqué
        pol.reset()
        idx = pol.decider(obs, mask.tolist())
        assert idx != brut and mask[idx] == 1
    # aucune action valide : pas d'appel au réseau, état caché inchangé
    pol.reset()
    assert pol.decider(obs, [0] * meta["n_out"]) == -1 and not pol.h.any()


def test_pas_de_torch_ni_de_chemins_herites():
    r = subprocess.run([sys.executable, "-c", "import pi5_runner, esp32_bridge, lidar_tracker, sys; print('torch' in sys.modules)"],
                       cwd=str(F.ROOT), capture_output=True, text=True, timeout=120)
    assert r.stdout.strip() == "False", r.stdout + r.stderr
    for f in ("pi5_runner.py", "esp32_bridge.py", "lidar_tracker.py", "embarque/pont.py", "embarque/croyance.py"):
        src = (F.ROOT / f).read_text(encoding="utf-8")
        assert "torch_engine" not in src and ".data/legacy" not in src and "best_brain" not in src, f


def test_benchmark_mesure_la_latence(petit):
    r = pi5_runner.benchmark(petit, 50)
    assert r["decisions"] == 50 and r["p50_ms"] > 0
