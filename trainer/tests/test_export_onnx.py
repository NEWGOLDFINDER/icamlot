"""Export ONNX (contrat §5) : aller-retour ONNX Runtime / PyTorch, meta, JSON web."""
import json

import numpy as np
import pytest
import torch

from trainer.export_onnx import OPSET, export_all, web_forward, web_json
from trainer.models import PolicyExport, RecurrentActorCritic

ort = pytest.importorskip("onnxruntime")


@pytest.fixture
def model(dims):
    torch.manual_seed(0)
    n_in, n_out = dims
    m = RecurrentActorCritic(n_in, n_out, hidden=24)
    rng = np.random.default_rng(0)
    m.set_obs_stats(rng.normal(size=n_in), rng.uniform(0.1, 2.0, size=n_in))
    return m


def test_onnx_aller_retour(tmp_path, model):
    info = {"obs_version": "obs-test", "catalogue_version": "cat-test", "catalogue": [{"i": 0}]}
    res = export_all(model, tmp_path / "cerveau", info)
    assert res["verification"]["ok"], res
    sess = ort.InferenceSession(res["onnx"], providers=["CPUExecutionProvider"])
    ins = {i.name: i for i in sess.get_inputs()}
    outs = [o.name for o in sess.get_outputs()]
    assert list(ins) == ["obs", "hidden"] and outs == ["logits", "next_hidden"]
    assert ins["obs"].type == "tensor(float)" and ins["obs"].shape[1] == model.n_in
    assert ins["hidden"].shape[1] == model.hidden_dim
    try:
        import onnx
        assert max(o.version for o in onnx.load(res["onnx"]).opset_import if o.domain in ("", "ai.onnx")) >= 17
    except ImportError:
        pass
    # lot de taille variable, plusieurs pas récurrents, normalisation intégrée (entrées brutes)
    x = np.random.default_rng(1).normal(size=(7, model.n_in)).astype(np.float32) * 3
    h = np.zeros((7, model.hidden_dim), np.float32)
    ht = torch.zeros(7, model.hidden_dim)
    pe = PolicyExport(model).eval()
    for _ in range(3):
        lo, h = sess.run(None, {"obs": x, "hidden": h})
        with torch.no_grad():
            lt, ht = pe(torch.as_tensor(x), ht)
        assert lo.shape == (7, model.n_out)
        assert np.abs(lo - lt.numpy()).max() < 1e-4 and np.abs(h - ht.numpy()).max() < 1e-4
    meta = json.loads((tmp_path / "cerveau.meta.json").read_text())
    for k in ("n_in", "n_out", "hidden", "obs_version", "catalogue_version", "normalisation"):
        assert k in meta, k
    assert (meta["n_in"], meta["n_out"], meta["hidden"]) == (model.n_in, model.n_out, model.hidden_dim)
    assert meta["obs_version"] == "obs-test" and meta["catalogue_version"] == "cat-test"
    assert meta["normalisation"]["integree_au_graphe"] is True and meta["onnx"]["opset"] >= OPSET >= 17
    assert not list(tmp_path.glob("*.onnx.data"))


def test_json_web_reproduit_pytorch(model):
    w = web_json(model, {"obs_version": "o", "catalogue_version": "c"})
    assert w["format"] == "icamlot-modele-recurrent" and w["n_in"] == model.n_in and w["n_out"] == model.n_out
    x = np.random.default_rng(2).normal(size=(4, model.n_in)).astype(np.float32)
    h = np.random.default_rng(3).normal(size=(4, model.hidden_dim)).astype(np.float32)
    y, h2 = web_forward(json.loads(json.dumps(w)), x, h)
    with torch.no_grad():
        yt, ht = PolicyExport(model)(torch.as_tensor(x), torch.as_tensor(h))
    assert np.abs(y - yt.numpy()).max() < 1e-4 and np.abs(h2 - ht.numpy()).max() < 1e-4
