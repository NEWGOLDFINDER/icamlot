import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import torch
import numpy as np

def test_imitation():
    try:
        from trainer.trainer import TorchNet, TorchEnvWorker, HAS_TORCH, DEVICE
        print(f"Success importing TorchNet & TorchEnvWorker (HAS_TORCH={HAS_TORCH}, DEVICE={DEVICE})")
        env = TorchEnvWorker({})
        hello = env.call({"cmd": "ping"})
        print("Env ping reply:", hello)
        reset = env.call({"cmd": "reset"})
        print("Env reset ok, obs dim:", len(reset["obs"]))
    except Exception as e:
        print("Error", e)
        raise

if __name__ == "__main__":
    test_imitation()
