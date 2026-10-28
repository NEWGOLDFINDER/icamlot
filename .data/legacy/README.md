# Données héritées (archivées le 2026-10-28)

Ces fichiers ont été produits par l'ancienne chaîne d'entraînement. Ils sont gardés pour l'historique et ne sont plus lus par défaut par l'entraîneur ni par l'API.

## Pourquoi ils sont incompatibles

| Fichiers | Contenu | Raison |
|---|---|---|
| `brains/*.json` et `weights/*.json` (7 cerveaux, dont `cerveau-v2-champion`) | MLP de 37 entrées et 106 sorties (format `camelot-poids`, `layers` en [entrée][sortie]), entraînés par neuroévolution | Ils ont été entraînés et sélectionnés dans le moteur PyTorch abstrait (`trainer/torch_engine.py`, retiré). L'audit l'a jugé infidèle au moteur de référence (constats C2 à C5 de `AUDIT_SIMULATEUR_IA.md`). Rejoué dans le moteur JS, le champion fait 102 points, contre 105 annoncés. Les observations et le catalogue d'actions vont changer (chantier actions-env). Ces fichiers ne portent aucune version d'observation ni de catalogue. |
| `weights/best_brain_pi5.onnx` (+ `.onnx.data`) | ONNX avec les entrées `obs` (56) et `hidden` (128), et 4 sorties `primary_logits` (130), `approach_logits` (5), `folding_logits` (2), `next_hidden` | Il ne respecte pas le contrat §5 de `docs/CONTRATS.md`, qui fixe 2 sorties (`logits`, `next_hidden`) et un fichier `.meta.json`. Il a été entraîné dans le moteur abstrait. Ses têtes « approche » et « pliage » n'étaient branchées nulle part. Il n'est pas non plus compatible avec `pi5_runner.py` (constat C1). |
| `weights/test_brain_pi5.onnx` (+ `.onnx.data`) | ONNX de test : entrées `obs` (37) et `hidden` (64), sorties `logits` (106) et `next_hidden` | Il a une taille fixe de lot 1 en sortie et n'a pas de `.meta.json`. C'est un modèle de test sans entraînement connu. |
| `weights/ppo_best.pt` | État PyTorch de l'ancien `RecurrentActorCritic` (encodeur factorisé 56D, Transformer non utilisé, têtes mortes, World Model) | L'architecture a été supprimée (`trainer/models.py` a été réécrit). Le fichier n'est pas un point de sauvegarde au format `icamlot-checkpoint`. |

## Ce qui les remplace

- Les sorties par défaut de l'entraîneur en ligne de commande vont dans `.data/modeles/` : `<nom>.pt`, `<nom>.dernier.pt`, `<nom>.onnx`, `<nom>.meta.json`, `<nom>.json` et `<nom>.eval.json`. Voir `trainer/README.md`.
- Côté API, les cerveaux de l'interface restent dans `<données>/brains/<slug>.json`. Leurs poids vont dans `<données>/weights/<slug>.json`, avec les fichiers du modèle récurrent dans `<données>/weights/<slug>.modele.*`.
- Le format des poids pour le web est décrit dans `trainer/FORMAT_MODELE.md`.

## Fichiers qui y faisaient encore référence (hors chantier entraînement, à mettre à jour par leurs chantiers)

- `pi5_runner.py` (`DEFAULT_MODEL_PATH`) et `benchmark_duels.py` : `.data/weights/best_brain_pi5.onnx`.
- `tests/test_champion_js.js` : `.data/brains/cerveau-v2-champion.json` et `.data/weights/cerveau-v2-champion.json`. Ce test échouait déjà (102 points au lieu de 105).
- `deploy/install.sh` : copie `.data/brains` et `.data/weights` s'ils existent. Ces dossiers n'existent plus dans le dépôt, donc rien n'est copié.
