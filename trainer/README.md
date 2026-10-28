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

Pour le run versionné dans `.data/modeles/fumee.*`, on a ajouté `--intensites aucun realiste --strategie <exemple.json>`. Cet adversaire est le programme `ENV.EXAMPLE` enregistré comme stratégie.

C'est un entraînement de **fumée**, pas un cerveau utilisable. Machine : Xeon 2,1 GHz, 4 vCPU, sans GPU. Durée totale : 2 min 37 s.

- **Imitation** : 4 démonstrations de l'exemple (105 pts), 56 décisions. 4 cibles étaient invalides sous le masque (« Lâcher les boulets ») ; elles ont été ignorées. Après 200 époques, la perte d'entropie croisée vaut 0,006 et la précision 100 %.
- **PPO** : 6 mises à jour de 2 × 4 environnements × 16 pas, soit 768 transitions et 70 épisodes. Le score moyen des épisodes échantillonnés est de 71,6 à 77,6. Le KL reste ≤ 0,0014. Le débit est de 6 à 12 décisions/s.
- **Évaluation gloutonne**, 24 matchs : 76,0 ± 0,0 pts, 0 erreur moteur, 12 victoires sur 12 contre l'exemple (qui fait 54 pts en duel), 1,4 match/s. L'écart-type est nul parce que le moteur est déterministe pour un même adversaire.
- **Export** : `fumee.onnx` (opset 17, écart ONNX Runtime / PyTorch de 3,6e-7), `fumee.meta.json`, `fumee.json`.

La politique imitée fait 76 pts et non 105. Elle diverge dès la 4ᵉ décision. Exécutée par `ENV.step`, une action du catalogue n'a pas le même effet que la brique du programme dont `ACTIONS.indexOfStep` l'a déduite : `toProgramStep` ajoute `pm: 'proche'`. Par exemple, « Mur M1 » rapporte 13 pts au lieu de 8, et la pose qui suit diffère. C'est à corriger côté actions-env.

## Débit mesuré (`python -m trainer.debit`, politique aléatoire, 4 environnements par processus, 45 s)

| Processus | Décisions/s | Matchs/s | Décisions/s par processus |
|---|---|---|---|
| 1 | 4,8 | 0,20 | 4,8 |
| 2 | 5,8 | 0,30 | 2,9 |
| 3 | 8,3 | 0,31 | 2,8 |

Il y a environ 20 à 27 décisions par match avec une politique aléatoire. L'efficacité à 3 processus est de 58 %. Deux causes possibles :
- le pas est synchrone : chaque pas attend le processus le plus lent, et la durée d'une macro-action varie beaucoup (planification A*, attente du trône) ;
- 3 processus Node sur 4 vCPU partagés avec Python.

**Estimation pour un Ryzen 5 3600 (12 threads, 11 processus).** Elle suppose la même vitesse par cœur que cette machine (hypothèse). La fourchette va d'environ 30 décisions/s (efficacité de 58 %, ≈ 1,3 match/s, ≈ 110 000 matchs/jour) à 53 décisions/s (mise à l'échelle linéaire, ≈ 2,2 matchs/s). À mesurer sur la machine avec `python -m trainer.debit --processus 1 2 4 6 8 11`.

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
