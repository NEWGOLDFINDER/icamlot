import torch
import numpy as np

def test_imitation():
    try:
        from trainer.trainer import TorchNet, run_imitation, EnvWorker
        print("Success importing TorchNet")
    except Exception as e:
        print("Error", e)

if __name__ == "__main__":
    test_imitation()
