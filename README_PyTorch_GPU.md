# Entraînement et GPU : voir README.md

L'ancien moteur PyTorch vectorisé (`trainer/torch_engine.py`) est retiré. L'entraînement tourne sur le moteur JS de référence, en pool de processus Node (`trainer/js_env_pool.py`). Le GPU, s'il existe, ne sert qu'au réseau (`--device` de `python -m trainer.ppo_trainer`).

Commandes, sorties et hypothèses : [README.md](README.md) et [trainer/README.md](trainer/README.md).
