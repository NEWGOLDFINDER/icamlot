# Contrats entre chantiers (remise en état du simulateur)

Ce document fixe les interfaces partagées par les chantiers menés en parallèle. Toute modification d'un contrat passe par l'orchestrateur.

Sources de vérité :
- `spec/regles_2027.json` et `spec/robot.json` : chaque valeur y porte sa source et son statut ;
- `AUDIT_SIMULATEUR_IA.md` : constats et plan ;
- `conception/pince.md`, `conception/ascenseur_graal.md` et `tools/cao_robot.py` : géométrie des mécanismes.

Règle absolue de l'équipe : **ne rien inventer**. Une valeur absente de la spec devient un paramètre nommé, avec une valeur par défaut documentée comme « hypothèse ».

## 0. Répartition des fichiers

| Chantier | Fichiers possédés (seul autorisé à les modifier) |
|---|---|
| **moteur** | `engine/geom.js`, `engine/engine.js`, `engine/score.js`, `bareme.js`, `engine/load.js`, `spec/spec.js` (généré), `tools/gen_spec.js`, `tests/test_moteur.js` (nouveau) |
| **entrainement** | `trainer/**`, `engine/env_worker.js`, `api/server.py`, `tests/test_api.py`, `tests/test_e2e_requirements.py`, `tests/test_empirical_challenger_m1_obs.py`, `pytest.ini`, `.data/**` |
| **actions-env** | `engine/actions.js`, `engine/env.js`, `engine/duel_bridge.js`, `tests/test_engine.js`, `tests/test_champion_js.js` |
| **web** | `cerveau/**`, `plateau/**`, `index.html`, `connexion/**`, `point-counter/**` |
| **embarque** | `pi5_runner.py`, `esp32_bridge.py`, `lidar_tracker.py`, `tests/test_pi5_*.py` (nouveaux) |
| **docs-bench** | `README.md`, `README_PyTorch_GPU.md`, `PROJECT.md`, `TEST_INFRA.md`, `TEST_READY.md`, `BENCHMARK_REPORT.md`, `benchmark_duels.py` |

## 1. Spécification chargée par le code (chantier moteur)
- `tools/gen_spec.js` lit les deux JSON et écrit `spec/spec.js`, qui définit `globalThis.SPEC = { regles, robot }`.
- `spec/spec.js` est chargé **en premier** par `engine/load.js` (Node) et par les pages HTML.
- Le moteur lit la géométrie du robot et les durées dans `SPEC`. Il ne recopie pas les nombres en dur.

## 2. Repère et géométrie du robot (chantier moteur)
- **Pose** `{x, y, h}` : `h` est l'angle de la normale de la face A dans le repère table. Les faces B et C sont à `h + 120` et `h + 240`. Pour l'équipe bleue, le miroir `x -> 3000 - x`, `h -> 180 - h` est inchangé.
- **Empreinte au sol** : `SPEC.robot.chassis.empreinte_sol.polygone`, dans le repère robot (périmètre 1173,1 mm, rayon maximal 212,3 mm). Elle remplace partout le triangle de 400 mm (`triPoly`).
- **Faces** : à 110,3 mm du centre, longueur 262 mm. **Toit** à 311,2 mm (tubes de 290 mm). Mât de balise centré, Ø 70 mm, jusqu'à 430 mm.
- **Nacelles A et B** (rotation autour de la normale de la face, axe à la hauteur `hc` de la rangée 2) :
  - **avant des ventouses** à 110,3 + 35 mm du centre ; une pierre à plat a son centre à **200,3 mm** du centre du robot ;
  - **rangées** (z relatif à l'axe) : 1 à −110, 2 à 0, 3 à +67 (ventouse à 12 mm du bord bas de la pierre 3, dont le centre est à +110) ;
  - **enveloppes en capsules** (demi-longueur, rayon) : rangées 1 et 2 (100, 20), rangée 3 (76, 10) ; colonne centrale de 30 mm de large, de −135 à +77 ;
  - **course de l'axe** `hc` ∈ [135, 273] mm ; angles 0, 90 et 180° ;
  - **rotation faisable** seulement si un mouvement vertical coordonné du chariot garde les actionneurs ≤ 350 mm, les pierres ≥ 5 mm du sol, et les pierres ≤ 350 mm hors château et hors zones de construction (porter `balayage` de `tools/conception_pince.py`). Sinon : erreur « rotation impossible sous 350 mm » ;
  - **durées par défaut** (hypothèses héritées, paramètres) : chariot 100 mm/s, 1,5 s par 90°, prise 0,5 s, relâche 0,4 s.
- **Porte** : la pile de 3 tourne de 90° (dans le château), les pierres 1 et 2 sont posées debout (piliers), la nacelle revient à 0° avec la pierre 3, puis le linteau monte (dessous à 325 mm, axe à 270 mm) et se pose. **Le linteau est toujours la pierre de la rangée 3** ; pas de retournement de pierre à 180°.
- **Canon** (face C, partie gauche, y = −50 mm dans le repère de la face) :
  - rentré au départ, sortie de 90 mm en 1 s ;
  - bouche à 57 mm hors de la face, 189 mm de haut, élévation de 35° ;
  - 10 boulets ; tir autorisé seulement pour t ∈ [85, 100] s ;
  - le tir depuis la salle du trône est un **paramètre** (`tirDepuisTrone`, vrai par défaut), pas une règle.
- **Graal** (62 × 62 × 100 mm, 2 anses basses) :
  - **départ** dans la salle du trône de l'équipe, entièrement dedans, hors de l'emprise de départ du robot, à une position paramétrable `(gx, gy)`. La valeur par défaut est choisie par le moteur et documentée ;
  - **pris uniquement par l'ascenseur de la face C** (bord droit vu de face) ;
  - **position de prise** dans le repère de la face C : centre du Graal à x = 155,3 mm, y = +57 mm.
- **Étape `monterGraal`** (nouvelle) :
  - préconditions : Graal à son départ, jamais déplacé ; robot dans son château ;
  - séquence : trajet jusqu'à la pose de prise, descente de la fourche (en temps masqué), montée en 3,5 s, transfert de 79 mm (0,8 s), pose (0,2 s), dégagement (0,8 s), toutes durées paramétrables ;
  - résultat : `graal.cur.k = 'toit'`, solidaire du robot, en (76,3 ; 57) dans le repère de la face C, à 311,2 mm.
- **Confinement du Graal** : si l'empreinte du Graal sort du château (`CASTLE` du camp, remparts compris), alors `graal.cur.k = 'retire'`, erreur moteur, et 0 point de Graal.
- **Supprimés** : les étapes `prendreGraal` et `poserGraal` par les pinces A/B, et la limite inventée de 430 mm.
- **Périmètre** :
  - empreinte + nacelles (enveloppe tournée) + canon s'il est sorti + fourche si elle est sortie ;
  - **pierres tenues exclues** ;
  - limites : ≤ 1200 mm à t = 0, ≤ 1400 mm pendant le match.
- **Hauteur** : actionneurs ≤ 350 mm à tout instant ; objets tenus ≤ 350 mm hors château et hors zones de construction.
- **Préconditions sans exécution** : le moteur expose `sim.preconditions(step) -> null | 'raison'`. C'est une vérification pure (pas d'avance du temps, pas de planification de trajet) de toutes les conditions d'erreur du moteur qui ne dépendent pas du trajet. Le masque d'actions s'en sert.

## 3. Score (chantier moteur, `score.js`)
- **Graal** :
  - niveaux 1 à 3 d'après la hauteur du dessous du Graal (≥ 100 / 200 / 300 mm, soit 1, 2 ou 3 pierres à plat ; une pierre debout vaut le niveau 3) ;
  - **niveau 4** si `k = 'toit'`, fourche dégagée, robot dans son château à T ;
  - présence (5 pts) si le Graal est dans le château ;
  - Graal sur une porte (niveau non défini par le règlement) : compté niveau 3 et signalé dans le détail.
- **Porte** autorisée dans toutes les zones de mur ; une seule par château.
- **Stockage** : plus de 3 pierres libres dans la cour, hors zones de construction, provoque une erreur moteur.
- **Évaluation à T = 100 s** pour le trône, les boulets et le Graal. `scoreAt(R, params, t)` garde sa signature.
- **Pierres tenues en fin de match** : non comptées (déjà le cas).

## 4. Environnement (chantier actions-env)
- **API conservée** : `ENV.create(cfg)` renvoie `{ reset(scenario), step(index), catalogue, nInputs, nOutputs, result(), program(), opponentProgram() }`. `reset` et `step` renvoient `{ obs: number[], mask: (0|1)[], t, score, reward, done, err }`.
- **Récompense** : la somme des récompenses d'un épisode **égale le score officiel final** (barème à T = 100 s), moins les pénalités d'erreur configurables (`cfg.recompense`). Les gains intermédiaires des constructions sont permis, mais aucun point n'est donné en cours de match pour le trône, les boulets ou le Graal.
- **Observation et masque calculables par le robot** :
  - `ENV.observeBelief(belief)` et `ACTIONS.maskBelief(belief, catalogue)` sont des fonctions pures d'un objet `belief` documenté. Il contient : temps, pose, adversaire vu au lidar, état propre des pinces et constructions, paquets tels que vus par les caméras A et B, avec l'âge de l'information ;
  - l'environnement de simulation construit `belief` depuis le moteur, avec un modèle de visibilité des caméras ;
  - le runner embarqué appelle **les mêmes fonctions**, via Node.
- **Masque** : seulement ce qui est physiquement ou réglementairement possible (`sim.preconditions` + atteignabilité). **Aucune règle de stratégie.**

## 5. Entraînement et modèle (chantier entrainement)
- **Simulateur d'entraînement** : moteur JS de référence, en pool de processus Node (`engine/env_worker.js` : plusieurs environnements par processus, commandes groupées). **`trainer/torch_engine.py` est retiré** de l'entraînement et de l'évaluation.
- **Réseau** : PPO récurrent, une seule tête de politique. Plus de têtes « approche » ni « pliage », plus d'encodeur Transformer inutilisé.
- **Export ONNX** :
  - entrées `obs` (B, n_in) float32 et `hidden` (B, H) float32 ;
  - sorties `logits` (B, n_out) et `next_hidden` (B, H) ;
  - un fichier `<modèle>.meta.json` à côté : `{ n_in, n_out, hidden, obs_version, catalogue_version }`.
- **Export pour le web** : un JSON de poids décrit dans `trainer/FORMAT_MODELE.md`.
- **Sélection du champion** : uniquement sur une évaluation dans le moteur JS contre des adversaires (stratégie enregistrée ou réseau), avec moyenne, écart-type, nombre de matchs et taux de victoire.

## 6. Points transmis par le chantier entraînement (fusionné le 2026-10-28)

### À traiter par actions-env
- Exposer `ENV.OBS_VERSION` et `ACTIONS.CATALOGUE_VERSION`. En attendant, l'entraînement utilise des empreintes sha256.
- `env.imitate` doit renvoyer la récompense et l'instant de chaque paire. Le worker les obtient aujourd'hui en enveloppant `ENGINE.makeDuel` et `ACTIONS.indexOfStep`.
- Appliquer les pénalités de `cfg.recompense` dans l'environnement. Aujourd'hui elles sont ignorées, donc `penalite_erreur` reste sans effet en PPO.
- Une action exécutée par `ENV.step` doit avoir exactement le même effet que la brique de programme correspondante. `toProgramStep` ajoute `pm: 'proche'`, ce qui fait diverger l'imitation (mur M1 : 13 pts au lieu de 8).
- Permettre un adversaire récurrent (modèle `icamlot-modele-recurrent`), et pas seulement un MLP `layers`, pour le self-play.

### Contrat effectif du modèle
- **ONNX** : `obs` brute (la normalisation est dans le graphe), sorties `logits` non masqués et `next_hidden`, état caché à zéro au début du match. Le masque est appliqué côté runtime.
- **Fichiers** : `<modèle>.meta.json` (avec le catalogue complet) et JSON web `icamlot-modele-recurrent`, décrit dans `trainer/FORMAT_MODELE.md` (implémentation de référence : `web_forward`).
- **Poids exposés par l'API** pour l'imitation et le PPO : `{format: camelot-poids, version: 2, architecture: recurrent, modele, fichiers, evaluation}`, sans `layers`.

### Chemins déplacés
- `.data/brains` et `.data/weights` sont maintenant dans `.data/legacy/`.
- À mettre à jour :
  - `pi5_runner.py` (qui importait aussi `trainer.torch_engine`, supprimé) ;
  - `benchmark_duels.py` ;
  - `tests/test_champion_js.js` ;
  - `deploy/install.sh`.
