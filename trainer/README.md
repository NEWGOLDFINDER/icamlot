# Entraîneur ICAM LOT

Le réseau choisit une macro-action du catalogue de `engine/actions.js` après chaque brique. Tout se joue dans le **moteur JS de référence** (`engine/*.js`). Ce moteur tourne en pool de processus Node (`engine/env_worker.js`, piloté par `trainer/js_env_pool.py`). Le GPU, s'il y en a un, ne sert qu'au réseau. L'ancien moteur PyTorch abstrait (`torch_engine.py`) est retiré.

Rien n'est codé en dur sur les dimensions. `n_in`, `n_out`, le catalogue et les versions d'observation et de catalogue sont lus dans l'environnement au démarrage du pool, puis enregistrés dans chaque modèle.

## Modules

| Fichier | Rôle |
|---|---|
| `js_env_pool.py` | P processus × M environnements, pas parallèle (`step_async` / `step_wait`), auto-reset, délais, erreurs remontées |
| `scenarios.py` | Scénarios : adversaire (stratégie enregistrée `{program, params}` ou cerveau MLP `{brain}`), intensité, graine |
| `models.py` | `RecurrentActorCritic` : normalisation intégrée, encodeur MLP + LayerNorm, GRUCell, acteur (logits masqués), critique |
| `imitation.py` | Démarrage à chaud sur des programmes (`imitate_trace`), entropie croisée masquée, cibles de valeur = retours réels |
| `ppo_trainer.py` | PPO récurrent (séquences, GAE, normalisations, planifications, points de sauvegarde, reprise, champion) |
| `evaluation.py` | N matchs dans le moteur JS : moyenne ± écart-type, min/max, victoires, erreurs moteur par match |
| `export_onnx.py` | ONNX + `.meta.json` + JSON web (format : `FORMAT_MODELE.md`), avec vérification ONNX Runtime |
| `debit.py` | Mesure du débit (décisions/s, matchs/s) selon le nombre de processus |
| `trainer.py` | Tâches lancées par l'API (`api/server.py`) : évolution (MLP), imitation, PPO |

## Commandes

Prérequis : Node.js ≥ 18, Python 3 avec `numpy` et `torch`. `onnx` et `onnxruntime` servent à l'export et à sa vérification (`onnxscript` n'est pas nécessaire). Les commandes se lancent depuis la racine du dépôt.

```bash
# Imitation seule (démarrage à chaud) sur le programme d'exemple de engine/env.js et/ou un dossier de stratégies
python -m trainer.imitation --exemple --strategies .data/strategies --scenarios 4 --epoques 200 \
    --processus 2 --eval-matchs 20 --sortie .data/modeles/imitation

# PPO (avec imitation préalable de l'exemple), adversaire = stratégie enregistrée en intensité réaliste
python -m trainer.ppo_trainer --processus 11 --envs-par-processus 4 --rollout 32 --mises-a-jour 500 \
    --imitation-exemple --intensites aucun realiste --strategie .data/strategies/ma-strategie.json \
    --eval-matchs 200 --eval-tous-les 50 --sortie .data/modeles/ppo

# Reprise d'un entraînement (poids, optimiseur, statistiques de normalisation, compteur de mises à jour)
python -m trainer.ppo_trainer --reprendre .data/modeles/ppo.dernier.pt --mises-a-jour 200 --sortie .data/modeles/ppo

# Évaluation (sélection : >= 200 matchs) contre une stratégie et/ou un cerveau MLP (config + poids)
python -m trainer.evaluation --modele .data/modeles/ppo.pt --matchs 200 --intensites realiste \
    --strategie .data/strategies/ma-strategie.json --cerveau cerveau.json poids.json --sortie rapport.json
python -m trainer.evaluation --matchs 200        # référence : politique aléatoire sur les actions valides

# Export ONNX + meta + JSON web d'un point de sauvegarde
python -m trainer.export_onnx --modele .data/modeles/ppo.pt          # écrit .data/modeles/ppo.{onnx,meta.json,json}

# Débit selon le nombre de processus
python -m trainer.debit --processus 1 2 4 6 8 11 --envs-par-processus 4 --duree 60

# Tests (pytest) ; -m "not lent" pour sauter ceux qui jouent des matchs
python -m pytest -q
```

Fichiers produits pour une sortie `<B>` :
- `<B>.dernier.pt` : dernier état, pour la reprise ;
- `<B>.pt` : champion, c'est-à-dire la meilleure évaluation JS de la session, ou d'une session précédente si le protocole est identique ;
- `<B>.onnx`, `<B>.meta.json`, `<B>.json` et `<B>.eval.json` : exports du champion.

## Preuve de bout en bout (CPU, 2026-10-28)

Commande :

```bash
python -m trainer.ppo_trainer --processus 2 --envs-par-processus 4 --rollout 16 --mises-a-jour 5 \
    --imitation-exemple --imitation-epoques 200 --imitation-scenarios 4 --eval-matchs 24 --graine 1 \
    --sortie .data/modeles/fumee
```

Résultats : voir `.data/modeles/fumee.eval.json` et le rapport du chantier. C'est un entraînement de **fumée**, pas un cerveau utilisable.

## Hypothèses (paramètres nommés, valeurs par défaut non mesurées sur ce problème)

| Paramètre | Défaut | Où | Remarque |
|---|---|---|---|
| `MAX_DECISIONS` / `max_decisions` | 80 | `js_env_pool.py`, `env_worker.js` | Repris de `ENV.play`. Un épisode tronqué est traité comme terminé |
| `DELAI_REPONSE_S` | 120 s | `js_env_pool.py` | Délai maximal de réponse d'un processus |
| `default_procs()` | nombre de threads − 1 | `js_env_pool.py` | Un thread reste pour Python |
| `gamma` | 1,0 | `PPOConfig` | L'objectif est le score final (somme non actualisée) |
| `gae_lambda`, `clip`, `coef_valeur`, `entropie`, `epoques`, `grad_max`, `lr` | 0,95 ; 0,2 ; 0,5 ; 0,01 ; 4 ; 0,5 ; 3e-4 | `PPOConfig` | Valeurs PPO usuelles |
| `lr_fin` | 0 | `PPOConfig` | Décroissance linéaire |
| `clip_valeur` | oui | `PPOConfig` | |
| `penalite_erreur`, `penalite_invalide` | 0 | `PPOConfig` | Pénalités de l'entraîneur. Celles de l'environnement passent par `cfg.recompense` (contrat §4) |
| `hidden`, `encodeur`, `acteur`, `critique`, `activation`, `layernorm`, `clip_obs` | 128 ; [128] ; [] ; [128] ; silu ; oui ; 5 | `models.py` | |
| imitation : `lr`, `epochs`, `batch_demos`, `value_coef` | 1e-3 ; 200 ; 16 ; 0,5 | `imitation.py` | Adam |
| `MATCHS_SELECTION` | 200 | `evaluation.py` | Critère de la phase 3 de l'audit |
| `TOLERANCE` (export) | 1e-4 | `export_onnx.py` | Écart ONNX Runtime / PyTorch |
| graines d'évaluation | 10 000 + k | `evaluation.py` | Mêmes matchs pour tous les modèles comparés |
