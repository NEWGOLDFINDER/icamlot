# Projet ICAM LOT - Refonte PyTorch GPU

La branche `pytorch-gpu-rewrite` contient les fondations pour le passage de tout le moteur de simulation (actuellement en JavaScript / Node.js) vers PyTorch en vue d'accélérer drastiquement les calculs sur GPU (vectorisation des environnements).

## Ce qui a été fait
1. **Intégration PyTorch dans `trainer/trainer.py`** :
   - `TorchNet` a été ajouté pour effectuer l'entraînement (et l'imitation) en PyTorch avec calcul des gradients (`CrossEntropyLoss`, `SGD`).
   - Le basculement vers PyTorch permet d'exploiter directement l'API de base en évitant les surcoûts NumPy.
2. **Squelette du moteur vectorisé `TorchEnv`** :
   - Le fichier `trainer/torch_engine.py` a été créé. Il modélise les données de base (positions de $B$ robots, paquets, Graal, zones) sous forme de tenseurs GPU (`torch.zeros((batch_size, ...))`).

## Ce qui reste à implémenter pour finaliser la refonte totale
La réécriture intégrale de l'environnement requiert d'adapter environ 2 000 lignes de logique (physique, collisions par théorèmes des axes séparateurs, A*, règles du jeu) en opérations matricielles.
Le fichier `TorchEnv` fournit la coquille où insérer ces calculs. Par la suite, le simulateur complet PyTorch (calcul de score et pas de simulation exacts) devra s'y substituer à `EnvWorker`.
