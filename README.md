# ICAM LOT — robot Eurobot 2027

Dépôt du robot de l'équipe ICAM LOT pour Eurobot 2027 : moteur de simulation de référence, entraînement d'un réseau de
décision (apprentissage par renforcement récurrent et imitation), adversaires, site de simulation et d'entraînement, et
exécution sur Raspberry Pi 5 avec deux ESP32.

Règle de travail : ne rien inventer. Chaque valeur vient de `spec/*.json` (règlement et robot, avec leur source) ou
devient un paramètre nommé, documenté comme hypothèse. Voir `CLAUDE.md`.

## Architecture

| Partie | Fichiers | Rôle |
|---|---|---|
| Règlement et robot | `spec/regles_2027.json`, `spec/robot.json` → `spec/spec.js` (généré par `tools/gen_spec.js`) | Valeurs du règlement et du robot, chacune avec sa source. |
| Moteur de référence (JS) | `engine/engine.js`, `score.js`, `geom.js`, `actions.js`, `env.js`, `env_worker.js`, `load.js` | Cinématique, barème 2027, catalogue d'actions, environnement pas à pas (observation et masque). Seul juge des résultats. |
| Robots adverses | `engine/adversaires.js` | Bâtisseur et Razzia (robots à règles) ; Champion et Intermédiaire (réseaux figés, `.data/adversaires/`). |
| Entraînement | `trainer/` | PPO récurrent avec démarrage à chaud par imitation, évaluation, export ONNX et web. Les environnements tournent en pool de processus Node (`trainer/js_env_pool.py`) ; le GPU ne sert qu'au réseau. |
| API et site | `api/server.py`, `index.html`, `plateau/`, `cerveau/`, `connexion/`, `point-counter/` | Simulateur (`/plateau/`), Atelier Cerveau (`/cerveau/`), API REST (`/api/`). |
| Raspberry Pi 5 + 2 ESP32 | `pi5_runner.py`, `esp32_bridge.py`, `lidar_tracker.py`, `embarque/`, `docs/PROTOCOLE_ESP32.md` | Runner ONNX (refuse un modèle incompatible avec le moteur), pilotage NAV (base roulante) et ACT (actionneurs). |

Le réseau (`trainer/models.py`) : encodeur MLP avec LayerNorm, cellule GRU, tête d'action à logits masqués et critique.
Une seule tête de politique (`docs/CONTRATS.md` §5).

Versions mesurées avec le moteur actuel (`JsEnvPool`) : observation `icamlot-obs-3.3` (86 entrées), catalogue
`icamlot-catalogue-3.3` (157 actions), moteur 2.0.0, barème 2027-1.0.

## Commandes

Prérequis : Node.js ≥ 18 ; Python 3 avec `numpy` et `torch` (entraînement) ; `onnx` et `onnxruntime` (export et runner).
Les commandes se lancent depuis la racine du dépôt.

### Tests

```bash
python -m pytest -q                  # tests Python (tests/ et trainer/)
python -m pytest -q -m "not lent"    # sans les tests qui jouent des matchs
node tests/test_moteur.js            # moteur
node tests/test_engine.js            # environnement et actions
node tests/test_adversaires.js       # robots adverses
```

### Entraînement

```bash
# Démarrage à chaud par imitation du programme d'exemple
python -m trainer.imitation --exemple --epoques 200 --sortie .data/modeles/imitation

# PPO récurrent, avec imitation préalable, adversaire = stratégie enregistrée
python -m trainer.ppo_trainer --imitation-exemple --processus 4 --envs-par-processus 4 --rollout 32 \
    --mises-a-jour 500 --intensites aucun realiste --strategie .data/strategies/ma-strategie.json \
    --eval-matchs 200 --eval-tous-les 50 --sortie .data/modeles/ppo

# Reprise (poids, optimiseur, statistiques de normalisation)
python -m trainer.ppo_trainer --reprendre .data/modeles/ppo.dernier.pt --mises-a-jour 200 --sortie .data/modeles/ppo

# Robot adverse réseau figé (écrit .data/adversaires/<id>.json)
python -m trainer.adversaires --robot champion
```

Sorties d'une session `<B>` : `<B>.dernier.pt` (reprise), `<B>.pt` (champion, selon l'évaluation JS), puis
`<B>.onnx`, `<B>.meta.json`, `<B>.json` et `<B>.eval.json` (exports). Détail : `trainer/README.md`.

### Évaluation et duels

```bash
# Évaluation dans le moteur JS (moyenne ± écart-type, victoires, erreurs moteur)
python -m trainer.evaluation --modele .data/modeles/ppo.pt --matchs 200 --intensites realiste \
    --strategie .data/strategies/ma-strategie.json

# Duels par adversaire et par couleur (modèle .onnx ou .pt, robots à règles, stratégies, cerveaux)
python benchmark_duels.py --modele .data/modeles/ppo.onnx --matchs 40 --robots batisseur razzia \
    --rapport .data/benchmarks/ppo.md

# Export ONNX, meta et JSON web d'un point de sauvegarde
python -m trainer.export_onnx --modele .data/modeles/ppo.pt

# Débit du moteur selon le nombre de processus
python -m trainer.debit --processus 1 2 4 6 8
```

### Raspberry Pi 5

```bash
# Capteurs simulés par le moteur JS, un match
python pi5_runner.py --modele .data/modeles/ppo.onnx --simulation --matchs 1 --intensite realiste

# Capteurs et ESP32 simulés (horloge virtuelle)
python pi5_runner.py --modele .data/modeles/ppo.onnx --robot --mock-esp

# Latence du modèle seul sur cette machine
python pi5_runner.py --modele .data/modeles/ppo.onnx --benchmark
```

Le mode `--robot` sans `--mock-esp` utilise les ports `--nav-port` et `--act-port` (protocole : `docs/PROTOCOLE_ESP32.md`).

### API et site

```bash
ICAMLOT_PASSWORD=test python3 api/server.py --port 8081 --static . --data .data/strategies
```

Puis ouvrir `http://127.0.0.1:8081/`. Sans `ICAMLOT_PASSWORD`, le simulateur est ouvert à tous (avertissement au démarrage).

### Déploiement

Nginx, tunnel Cloudflare, installation et mise à jour du site : voir `deploy/README.md`.

## Documents de référence

- `docs/CONTRATS.md` : interfaces entre chantiers, répartition des fichiers (§0), modèle (§5), adversaires (§14), deux couleurs (§17), fin de match (§18).
- `docs/PROTOCOLE_ESP32.md` : protocole Raspberry Pi 5 ↔ ESP32 (statut proposé, à valider par l'équipe).
- `docs/RECETTE.md` : procédure de recette sur le site.
- `trainer/README.md` : entraîneur, modules, commandes, hypothèses nommées.
- `trainer/FORMAT_MODELE.md` : format des poids pour le web.
- `deploy/README.md` : déploiement du site.
- `AUDIT_SIMULATEUR_IA.md` : constats de l'audit et plan de remise en état.
- `BENCHMARK_REPORT.md` : historique de l'ancien moteur, à ne pas citer comme résultat actuel.

## Limites connues

- Aucun cerveau entraîné n'est versionné pour le moteur actuel. `.data/modeles/fumee.*` est un test de fumée : il est refusé
  par `benchmark_duels.py` et `pi5_runner.py` (version d'observation différente).
- Les anciens fichiers (`.data/legacy/`) sont incompatibles avec le moteur actuel (`.data/legacy/README.md`).
- Les adversaires Champion et Intermédiaire ne sont pas versionnés : ils se réentraînent avec `trainer.adversaires`.
- La latence sur Raspberry Pi 5 reste à mesurer sur la carte (`pi5_runner.py --benchmark`).
