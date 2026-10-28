"""Export du cerveau récurrent (contrat §5 de docs/CONTRATS.md).

Écrit, pour une base <B> :
  <B>.onnx       graphe ONNX (opset ≥ 17) : entrées obs (B, n_in) float32, hidden (B, H) float32 ;
                 sorties logits (B, n_out) float32 (NON masqués), next_hidden (B, H) float32 ;
                 la normalisation des observations est intégrée au graphe ;
  <B>.meta.json  { n_in, n_out, hidden, obs_version, catalogue_version, normalisation, … } ;
  <B>.json       poids pour le runtime web (format décrit dans trainer/FORMAT_MODELE.md).

Une vérification numérique compare ONNX Runtime à PyTorch sur des entrées aléatoires (plusieurs pas récurrents).

  python -m trainer.export_onnx --modele .data/modeles/fumee.pt            # écrit .data/modeles/fumee.{onnx,meta.json,json}
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional, Union

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np
import torch
import torch.nn as nn

from trainer.models import PolicyExport, RecurrentActorCritic, load_checkpoint

OPSET = 17
FORMAT_WEB = "icamlot-modele-recurrent"
# Tolérance de la vérification ONNX Runtime / PyTorch (écart absolu maximal sur logits et next_hidden).
TOLERANCE = 1e-4


def _base(path: Union[str, Path]) -> Path:
    p = Path(path)
    return p.with_suffix("") if p.suffix in (".onnx", ".json", ".pt") else p


def _with(base: Path, ext: str) -> Path:
    return Path(str(base) + ext)


def export_onnx(model: RecurrentActorCritic, path: Union[str, Path], opset: int = OPSET) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    cpu = RecurrentActorCritic.from_config(model.config())
    cpu.load_state_dict({k: v.detach().cpu() for k, v in model.state_dict().items()})
    cpu.eval()
    wrapper = PolicyExport(cpu).eval()
    obs = torch.zeros((1, cpu.n_in), dtype=torch.float32)
    hid = torch.zeros((1, cpu.hidden_dim), dtype=torch.float32)
    kwargs = dict(
        export_params=True, opset_version=opset, do_constant_folding=True,
        input_names=["obs", "hidden"], output_names=["logits", "next_hidden"],
        dynamic_axes={"obs": {0: "B"}, "hidden": {0: "B"}, "logits": {0: "B"}, "next_hidden": {0: "B"}},
    )
    import warnings
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            # exportateur TorchScript : ne demande pas onnxscript ; GRUCell et LayerNorm y sont bien pris en charge
            torch.onnx.export(wrapper, (obs, hid), str(path), dynamo=False, **kwargs)
    except TypeError:  # versions de torch sans l'argument dynamo
        torch.onnx.export(wrapper, (obs, hid), str(path), **kwargs)
    except Exception:  # exportateur TorchScript retiré : exportateur torch.export (demande onnxscript)
        torch.onnx.export(wrapper, (obs, hid), str(path), dynamo=True, **kwargs)
    # un seul fichier (pas de .onnx.data externe) : le modèle est petit
    try:
        import onnx
        m = onnx.load(str(path), load_external_data=True)
        onnx.checker.check_model(m)
        onnx.save_model(m, str(path), save_as_external_data=False)
        for extra in path.parent.glob(path.name + ".data"):
            extra.unlink()
    except ImportError:
        pass
    return path


def verify_onnx(model: RecurrentActorCritic, path: Union[str, Path], batch: int = 4, steps: int = 5, seed: int = 0) -> dict:
    """Compare ONNX Runtime et PyTorch sur `steps` pas récurrents enchaînés (entrées aléatoires)."""
    import onnxruntime as ort
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    ins = {i.name: i.shape for i in sess.get_inputs()}
    outs = [o.name for o in sess.get_outputs()]
    cpu = RecurrentActorCritic.from_config(model.config())
    cpu.load_state_dict({k: v.detach().cpu() for k, v in model.state_dict().items()})
    wrapper = PolicyExport(cpu).eval()
    rng = np.random.default_rng(seed)
    h_t = torch.zeros((batch, cpu.hidden_dim))
    h_o = np.zeros((batch, cpu.hidden_dim), np.float32)
    worst = 0.0
    for _ in range(steps):
        obs = rng.normal(size=(batch, cpu.n_in)).astype(np.float32) * 2.0
        with torch.no_grad():
            lt, h_t = wrapper(torch.as_tensor(obs), h_t)
        lo, h_o = sess.run(["logits", "next_hidden"], {"obs": obs, "hidden": h_o})
        worst = max(worst, float(np.abs(lo - lt.numpy()).max()), float(np.abs(h_o - h_t.numpy()).max()))
    return {"entrees": list(ins), "sorties": outs, "ecart_max": worst, "ok": worst <= TOLERANCE, "pas": steps, "lot": batch}


def _lin(m: nn.Linear) -> dict:
    # w en [entrée][sortie] (même convention que camelot-poids et cerveau/net.js)
    return {"w": m.weight.detach().cpu().numpy().T.tolist(), "b": m.bias.detach().cpu().numpy().tolist()}


def web_json(model: RecurrentActorCritic, meta: Optional[dict] = None) -> dict:
    """Poids pour le runtime web (format décrit dans trainer/FORMAT_MODELE.md)."""
    arch = model.config()
    enc = []
    mods = list(model.encoder)
    i = 0
    while i < len(mods):
        lin = mods[i]
        layer = _lin(lin)
        i += 1
        if i < len(mods) and isinstance(mods[i], nn.LayerNorm):
            ln = mods[i]
            layer["ln"] = {"gamma": ln.weight.detach().cpu().numpy().tolist(),
                           "beta": ln.bias.detach().cpu().numpy().tolist(), "eps": ln.eps}
            i += 1
        i += 1  # activation
        enc.append(layer)
    actor = [_lin(m) for m in model.actor if isinstance(m, nn.Linear)]
    g = model.gru
    out = {
        "format": FORMAT_WEB, "version": 1,
        "n_in": model.n_in, "n_out": model.n_out, "hidden": model.hidden_dim,
        "activation": arch["activation"],
        "normalisation": {"mean": model.obs_mean.cpu().numpy().tolist(), "std": model.obs_std.cpu().numpy().tolist(),
                          "clip": model.clip_obs},
        "encodeur": enc,
        "gru": {"w_ih": g.weight_ih.detach().cpu().numpy().T.tolist(), "w_hh": g.weight_hh.detach().cpu().numpy().T.tolist(),
                "b_ih": g.bias_ih.detach().cpu().numpy().tolist(), "b_hh": g.bias_hh.detach().cpu().numpy().tolist()},
        "acteur": actor,
    }
    if meta:
        for k in ("obs_version", "catalogue_version", "groupes", "moteur", "bareme", "physique", "adversaires"):
            if meta.get(k) is not None:
                out[k] = meta[k]
    return out


def web_forward(w: dict, obs: np.ndarray, hidden: np.ndarray):
    """Implémentation de référence (NumPy) du format web, pour les tests et pour les autres runtimes."""
    act = {"silu": lambda x: x / (1 + np.exp(-x)), "relu": lambda x: np.maximum(x, 0), "tanh": np.tanh}[w["activation"]]
    n = w["normalisation"]
    x = np.clip((obs - np.asarray(n["mean"])) / np.asarray(n["std"]), -n["clip"], n["clip"])
    for L in w["encodeur"]:
        x = x @ np.asarray(L["w"]) + np.asarray(L["b"])
        if "ln" in L:
            mu = x.mean(-1, keepdims=True)
            var = ((x - mu) ** 2).mean(-1, keepdims=True)
            x = (x - mu) / np.sqrt(var + L["ln"]["eps"]) * np.asarray(L["ln"]["gamma"]) + np.asarray(L["ln"]["beta"])
        x = act(x)
    g, H = w["gru"], w["hidden"]
    gi = x @ np.asarray(g["w_ih"]) + np.asarray(g["b_ih"])
    gh = hidden @ np.asarray(g["w_hh"]) + np.asarray(g["b_hh"])
    sig = lambda v: 1 / (1 + np.exp(-v))
    r = sig(gi[:, :H] + gh[:, :H])
    z = sig(gi[:, H:2 * H] + gh[:, H:2 * H])
    nn_ = np.tanh(gi[:, 2 * H:] + r * gh[:, 2 * H:])
    h = (1 - z) * nn_ + z * hidden
    y = h
    for k, L in enumerate(w["acteur"]):
        y = y @ np.asarray(L["w"]) + np.asarray(L["b"])
        if k < len(w["acteur"]) - 1:
            y = act(y)
    return y, h


def onnx_opset(path: Union[str, Path]) -> Optional[int]:
    try:
        import onnx
    except ImportError:
        return None
    return max(o.version for o in onnx.load(str(path)).opset_import if o.domain in ("", "ai.onnx"))


def meta_json(model: RecurrentActorCritic, info: Optional[dict] = None, opset: int = OPSET) -> dict:
    info = info or {}
    return {
        "format": "icamlot-modele-meta", "version": 1,
        "n_in": model.n_in, "n_out": model.n_out, "hidden": model.hidden_dim,
        "obs_version": info.get("obs_version"), "catalogue_version": info.get("catalogue_version"),
        "onnx": {"opset": opset, "entrees": {"obs": ["B", model.n_in], "hidden": ["B", model.hidden_dim]},
                 "sorties": {"logits": ["B", model.n_out], "next_hidden": ["B", model.hidden_dim]}, "type": "float32"},
        "normalisation": {
            "integree_au_graphe": True,
            "formule": "obs_n = clip((obs - mean) / std, -clip, +clip)",
            "clip": model.clip_obs,
            "mean": model.obs_mean.cpu().numpy().tolist(), "std": model.obs_std.cpu().numpy().tolist(),
        },
        "masque": "non intégré : mettre à -inf les logits des actions invalides (masque de l'environnement) avant argmax/softmax",
        "etat_cache": "zéros (B, hidden) au début de chaque match ; réinjecter next_hidden à chaque décision",
        "architecture": model.config(),
        "groupes": info.get("groupes"),
        "catalogue": info.get("catalogue"),
        "moteur": info.get("moteur"), "bareme": info.get("bareme"),
        "evaluation": info.get("evaluation"),
        # traçabilité (chantier adversaires) : configuration de l'environnement, caractéristiques physiques (nominales, plages,
        # tirage) et mélange d'adversaires utilisés pour l'entraînement
        "env_config": info.get("env_config"),
        "physique": info.get("physique") or (info.get("env_config") or {}).get("physique"),
        "adversaires": info.get("adversaires"),
    }


def export_all(model: RecurrentActorCritic, base: Union[str, Path], info: Optional[dict] = None, verify: bool = True) -> dict:
    """Écrit <base>.onnx, <base>.meta.json et <base>.json ; renvoie un résumé (dont la vérification numérique)."""
    base = _base(base)
    base.parent.mkdir(parents=True, exist_ok=True)
    # le JSON web et le meta ne dépendent pas de l'export ONNX : un échec de l'export (ex. onnxscript absent)
    # ne doit pas faire perdre le modèle entraîné ; il est consigné dans le meta et le résumé.
    try:
        onnx_path = export_onnx(model, _with(base, ".onnx"))
        onnx_err = None
    except Exception as e:  # noqa: BLE001
        onnx_path, onnx_err = None, f"{type(e).__name__}: {e}"
    meta = meta_json(model, info, (onnx_opset(onnx_path) if onnx_path else None) or OPSET)
    out = {"onnx": str(onnx_path) if onnx_path else None, "meta": str(_with(base, ".meta.json")), "web": str(_with(base, ".json"))}
    if onnx_err:
        out["onnx_erreur"] = meta["onnx_erreur"] = onnx_err
    if verify and onnx_path:
        try:
            out["verification"] = verify_onnx(model, onnx_path)
        except ImportError:
            out["verification"] = {"ok": None, "raison": "onnxruntime absent"}
        meta["verification_onnx"] = out["verification"]
        if out["verification"].get("ok") is False:
            raise RuntimeError(f"Export ONNX incohérent avec PyTorch : écart {out['verification']['ecart_max']:.2e}")
    _with(base, ".meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    _with(base, ".json").write_text(json.dumps(web_json(model, info), ensure_ascii=False), encoding="utf-8")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Export ONNX + meta + JSON web d'un point de sauvegarde .pt")
    ap.add_argument("--modele", required=True, help="point de sauvegarde .pt (trainer.models.save_checkpoint)")
    ap.add_argument("--sortie", help="base des fichiers produits (défaut : celle du .pt)")
    a = ap.parse_args(argv)
    model, ck = load_checkpoint(a.modele)
    res = export_all(model, a.sortie or a.modele, ck)
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
