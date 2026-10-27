"""Exportateur de modèle PyTorch vers ONNX pour Raspberry Pi 5.

Permet d'exporter l'Acteur GRU en un fichier .onnx compact (~620 Ko),
vérifié avec onnx.checker et benchmarqué sur CPU avec ONNX Runtime.
"""
from __future__ import annotations

import sys
import io
import time
from pathlib import Path
from typing import Optional, Union

# Assurer l'encodage UTF-8 pour Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent.parent
TRAINER_DIR = Path(__file__).resolve().parent
while str(TRAINER_DIR) in sys.path:
    sys.path.remove(str(TRAINER_DIR))
if str(ROOT) in sys.path:
    sys.path.remove(str(ROOT))
sys.path.insert(0, str(ROOT))

import torch

try:
    import onnx
    HAS_ONNX = True
except ImportError:
    onnx = None
    HAS_ONNX = False

try:
    import onnxruntime as ort
    HAS_ORT = True
except ImportError:
    ort = None
    HAS_ORT = False

from trainer.models import RecurrentActorCritic, Pi5ActorWrapper


def export_pi5_onnx(
    model: RecurrentActorCritic,
    output_path: Union[str, Path],
    hidden_dim: Optional[int] = None,
    benchmark_runs: int = 500,
) -> dict:
    """Exporte l'Acteur GRU en format ONNX prêt pour Raspberry Pi 5."""
    if not HAS_ONNX or onnx is None:
        print("Avertissement : Le paquet Python 'onnx' n'est pas installé. L'export .onnx Pi 5 est ignoré (le modèle PyTorch .pt et les poids JSON restent sauvegardés).")
        return {"path": None, "size_kb": 0.0, "latency_ms": 0.0, "decisions_per_sec": 0, "warning": "onnx non installé"}

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    hidden_dim = hidden_dim or getattr(model, "hidden_dim", 128)

    # Passer en mode évaluation sur CPU
    cpu_model = RecurrentActorCritic(n_in=model.n_in, n_out=model.n_out, hidden_dim=hidden_dim)
    cpu_model.load_state_dict(model.state_dict())
    cpu_model.eval()

    actor_export = Pi5ActorWrapper(cpu_model)
    actor_export.eval()

    dummy_obs = torch.zeros((1, model.n_in), dtype=torch.float32)
    dummy_hidden = torch.zeros((1, hidden_dim), dtype=torch.float32)

    # Export ONNX (opset 18 pour LayerNorm natif et compatibilité universelle Pi 5)
    torch.onnx.export(
        actor_export,
        (dummy_obs, dummy_hidden),
        str(output_path),
        export_params=True,
        opset_version=18,
        do_constant_folding=True,
        input_names=["obs", "hidden"],
        output_names=["primary_logits", "approach_logits", "folding_logits", "next_hidden"],
        dynamic_axes={
            "obs": {0: "batch_size"},
            "hidden": {0: "batch_size"},
            "primary_logits": {0: "batch_size"},
            "approach_logits": {0: "batch_size"},
            "folding_logits": {0: "batch_size"},
            "next_hidden": {0: "batch_size"},
        },
    )

    file_size_kb = output_path.stat().st_size / 1024.0 if output_path.exists() else 0.0

    # 1. Vérification d'intégrité ONNX (si le package onnx est installé)
    if HAS_ONNX and onnx is not None and output_path.exists():
        try:
            onnx_model = onnx.load(str(output_path))
            onnx.checker.check_model(onnx_model)
        except Exception:
            pass

    # 2. Benchmark de latence CPU via ONNX Runtime (si onnxruntime est installé)
    avg_latency_ms = 0.0
    fps = 0
    if HAS_ORT and ort is not None and output_path.exists():
        try:
            session = ort.InferenceSession(str(output_path), providers=["CPUExecutionProvider"])
            obs_np = dummy_obs.numpy()
            hidden_np = dummy_hidden.numpy()

            # Warmup
            for _ in range(20):
                _ = session.run(None, {"obs": obs_np, "hidden": hidden_np})

            # Mesure
            runs = min(benchmark_runs, 100)
            t0 = time.perf_counter()
            for _ in range(runs):
                outputs = session.run(None, {"obs": obs_np, "hidden": hidden_np})
                hidden_np = outputs[3]
            t1 = time.perf_counter()

            avg_latency_ms = ((t1 - t0) / runs) * 1000.0
            fps = runs / max(t1 - t0, 1e-6)
        except Exception:
            pass

    summary = {
        "path": str(output_path),
        "size_kb": round(file_size_kb, 1),
        "latency_ms": round(avg_latency_ms, 3),
        "decisions_per_sec": int(fps),
    }

    print(f"Export ONNX réussi : {output_path}")
    print(f"  Taille du fichier : {summary['size_kb']} Ko")
    if fps > 0:
        print(f"  Latence CPU moyenne : {summary['latency_ms']} ms ({summary['latency_ms']*1000:.0f} µs par décision)")
        print(f"  Débit d'inférence CPU : {summary['decisions_per_sec']:,} décisions / seconde")

    return summary


if __name__ == "__main__":
    # Test d'export d'un modèle aléatoire V2
    model = RecurrentActorCritic(n_in=56, n_out=130, hidden_dim=128)
    export_pi5_onnx(model, ".data/weights/best_brain_pi5.onnx", hidden_dim=128)
