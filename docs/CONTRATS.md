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
| **embarque** | `pi5_runner.py`, `esp32_bridge.py`, `lidar_tracker.py`, `embarque/*` (dont `bridge.js`), `tests/test_embarque_*.py`, `tests/embarque_fixtures.py` |
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

## 7. Temps masqué (décision validée par l'équipe, à traiter par actions-env)
1. **Temps masqué automatique** dans chaque macro-action, dès qu'il est faisable sans collision ni dépassement de 350 mm. Le moteur choisit le moment : pendant le trajet, en fin de trajet, ou à l'arrêt.
2. **Action « préparer la pince »** (angle et hauteur) d'une face, exécutée pendant le trajet suivant.
3. **Test de cohérence avec `esp32_bridge.py`** : les mouvements réalisés en parallèle doivent être les mêmes en simulation et sur le robot.

## 8. API du moteur livré (fusionné le 2026-10-28, `tests/test_moteur.js` : 83 tests sur 83)
- **Étapes**
  - Supprimées : `prendreGraal`, `poserGraal` (renvoient « Action inconnue. »).
  - Ajoutée : `{a:'monterGraal'}`.
  - Inchangées : `prendre` (modes `pierre`/`deux`), `deposer`, `mur`, `tour`, `porte`, `tir`/`boulets`, `traj`, `lacher`, `deposerZone`, `seDeplacer`, `tourner`, `attendre`, `attendreJusqua`, `trone`.
- **Sémantique**
  - Une étape impossible (pas de position, pas de passage sans contact, rotation impossible sous 350 mm) est abandonnée : erreur, robot immobile, temps non avancé.
  - M1 et M5 sont impossibles depuis l'extérieur.
  - Une pile ne tourne à 90° que dans le château.
- **`sim`**
  - Nouveautés : `preconditions(step)`, `hullRadius()` (≈ 256 mm, jusqu'à ≈ 370 mm avec des pierres), `stockage()`, `portes()`, `errors()`, `covered(st, excl)`.
  - `pose()` et les points `K` portent `C: {can, fx, fz}`.
  - États du Graal : `home`, `ascenseur`, `toit`, `retire`.
- **`ENGINE`**
  - Ajouts : `T_ATTAQUE`, `castleOf`, `zoneRect`, `graalPoly`, `graalOnRobot`, `PROGRAMME_REFERENCE` (116 pts, 90,3 s, 0 erreur ; à utiliser à la place de `ENV.EXAMPLE`, qui fait maintenant 74 pts et 6 erreurs).
  - `DEF` : ajoute `ga`, `tirDepuisTrone`, `t*Graal`, `tSortieFourche`, `tDescenteFourche` ; retire `zmin`, `zmax`, `cl`, `cw`. Graal par défaut en (70, 810).
- **`geom.js`**
  - `triPoly` est un alias de `robotPoly` (empreinte de 45 sommets) ; `cannonPoly(p, can)`.
  - `GEO.rin` = 110,3 ; `GEO.R` = 212,35 ; nouveau global `GEOM`.
- **`SCORE`**
  - `scoreAt` sans `t` évalue à 100 s ; avec t < 100, le trône, les boulets et le Graal valent 0.
  - Nouveau `niveauGraal`.
  - `graalPos` renvoie `{k, c, ang, bottom, top, poly}`.
- **Chargement** : `loadIcamlot(root, { moteurSeul: true })` existe. `spec/spec.js` est chargé en premier, et se régénère avec `node tools/gen_spec.js`.
- **Points ouverts**
  - Les actionneurs atteignent 350,0 mm sans marge pendant certaines rotations (marge à décider par l'équipe).
  - Le canon sort avant 85 s ; seuls les tirs sont limités à [85, 100] s.
  - `deploy/install.sh` ne copie pas `spec/spec.js`.
  - `plateau/app.js` dessine encore l'ancien triangle.

## 9. Décisions de l'équipe (vague 2)
- **Adversaire par défaut** (équipe, 2026-10-28) : le programme de référence en miroir est conservé. Le conflit avec notre robot (108 pts au lieu de 116) est voulu. Le but du réseau est de s'adapter à l'adversaire.
- **Entraînement** : faire jouer le réseau contre plusieurs adversaires (référence miroir, stratégies enregistrées, réseaux en self-play), et non seul sur la table.
- **Collisions** : l'évitement est obligatoire (`regles.robot.systeme_evitement_obligatoire` ; pénalité `evitement_non_fonctionnel` −30). Le moteur le modélise déjà (`oppBlocks` : le robot s'arrête, attend, et l'étape échoue). Deux réseaux face à face ne peuvent donc pas se percuter. Un adversaire scripté qui « fonce dessus » est hors règlement et n'est pas un cas d'entraînement visé.

## 10. Moteur, vague 2 (chantier moteur-2)
- **Monde depuis la croyance** : `ENGINE.makeSim(P, { etat: croyance })` (format §4 : pose, pinces avec `slots` et `rotReelle`, `meca`, `graal`, `paquets`, `pierres`, `etrangeres`, `portes`, `tir`). Pas de contrôles de départ.
- **Planification à blanc (pure)** :
  - `sim.planifier(depart|null, { x, y, h }, { excl, pince: { f, seq }, mode })` -> `null` ou `{ points: [{ x, y, h, t }], duree, mode }` ;
  - `sim.planifierEtape(brique, { mode, verifier })` -> `{ ok, raison, trajet }` : l'étape est jouée à blanc jusqu'à son premier trajet (même choix de pose qu'`exec`) ; sans trajet, elle est jouée entièrement, à blanc ;
  - `mode` : `'disque'` (planificateur certifié seul), `'rapide'` (début de la recherche d'origine), `'ancien'` (recherche d'origine seule), absent (comme `exec`).
- **Trajets d'`exec`** : d'abord le planificateur certifié (cases à cap fixe avec marge, région libre au disque, rotation sur place), vérifié finement ; sinon la recherche d'origine.
- **Masque** : `ACTIONS.HYPOTHESES.planification = 'moteur'` (défaut). Chaque action est jouée à blanc sur le monde de la croyance (`planifierEtape`, mode `'disque'`). Une action acceptée réussit dans `exec` (même pose, même planificateur). `'grille'` rétablit l'ancien masque.
- **Signatures inchangées** : `observeBelief`, `maskBelief`, `toProgramStep`, `realStep`.
- **Nouveautés de `sim`** :
  - `pendantes()` : rotations préparées encore à faire ; la croyance en tire `rotReelle` ;
  - `lastPlan()` : `{ t0, t1, err, K }`, points clés de la dernière étape (format stable : `t, x, y, h, A{hc,rot,vac}, B, C{can,fx,fz}, lin`) ;
  - `recaler({ x, y, h, t })` : recale la pose et l'horloge sur la mesure (horloge en avant seulement).
- **Corrections** :
  - `ENGINE.mirrorStep` met en miroir `deposer.x/ang` et les points de `traj` ; `ACTIONS.realStep` s'y appuie ;
  - `PRE.deposer` évalue le stockage avec les empreintes de la pose réelle (grand axe selon `ang`) ;
  - `attendre` et `attendreJusqua` ne font plus la rotation préparée : « finir » est toujours valide ;
  - une rotation de pince faisable seulement dans le château (pierres au-dessus de 350 mm) se fait sur place à l'arrivée, jamais en route ;
  - le canon sort juste à temps pour 85 s.
- **Paramètres** :
  - `tourner` accepte `hc` (optionnel, borné par la course). Il n'est pas ajouté au catalogue : le gain mesuré sur les prises de la référence est nul, le mouvement est déjà fait en temps masqué ;
  - `DEF.trz` : rampes des vérins Z (1,25 − 100/84 = 0,06 s par mouvement, spec) ;
  - `GEOM.configurerCourse({ hcBas, course, margeHauteur })` : course de l'axe (défaut : géométrique [135, 273], sans marge). `hcBas` et `margeHauteur` restent à trancher par l'équipe.
- **Caméras et lidar (`ENV.VISION`)** :
  - une carrière n'est vue qu'à la pose d'approche de prise, face à elle (hypothèses : 400 mm, 15°) ;
  - `ENV.create({ cameras: false })` ou `VISION.actif = false` coupe le modèle ;
  - le lidar ne voit que les robots ; les rayons d'observation viennent des obstacles connus, pas du lidar.
- **Miroir** : le robot n'est pas symétrique (face B à h + 120 dans les deux équipes). Un programme jaune ne se transpose donc pas par simple miroir pour le bleu. L'observation et le masque bleus restent ceux du jaune en miroir (tests §5 de `tests/test_engine.js`).

## 11. Embarqué livré (fusion 0e06319)
- **Pont Node** `embarque/bridge.js`, utilisé par `embarque/pont.py`. Échange en JSON-lignes. Commandes : `hello`, `observe`, `mask`, `observe_mask`, `step`, `reference`, `sim_*`, `track_*`.
- **`pi5_runner.py`** : refuse un modèle dont l'observation, le catalogue ou les dimensions ne correspondent pas au moteur (code de sortie 2). Modes `--simulation`, `--robot [--mock-esp]`, `--benchmark`.
- **Protocole ESP32** : proposition dans `docs/PROTOCOLE_ESP32.md` (statut « proposé, à valider par l'équipe »), appliquée par `esp32_bridge.py` et le firmware simulé. NAV = base roulante, ACT = tous les actionneurs.
- **Paramètres `.meta.json`** : la clé `env_config` y manque (embarqué et entraînement). Par défaut : `{skipContacts: true}`.

## 12. Décision vérins Z (équipe, 2026-10-28)
- **Choix de l'équipe** : la meilleure conception possible ; l'équipe trouvera le vérin adapté.
- **Conception retenue** : course géométrique complète, axe de 135 à 273 mm, soit une course utile d'au moins 138 mm. C'est le réglage par défaut du moteur (`GEOM.configurerCourse(null)`) ; la référence y fait 116 pts.
- **Vitesse cible** : 80 mm/s.
- **Données conservées** : celles du vérin mesuré (100 mm, 84 / 75 mm/s), qui servent au calcul des rampes.
- **À vérifier** : l'encombrement du vérin dans la CAO.
- Cahier des charges : `spec/robot.json` → `actionneurs_carte.verins.cahier_des_charges`.

## 13. Tir explicite (décision de l'équipe, option B ; catalogue `icamlot-catalogue-3.1`)
- **Constat** : la brique `tir` attendait jusqu'à 85 s sans décision (référence : 13 s immobile à partir de 70,4 s).
- **Action « tir »** : valide seulement si l'attente de la brique avant la sortie du canon, pour un lancement maintenant, est d'au plus `ACTIONS.HYPOTHESES.attenteMaxTir` (1 s, hypothèse). Les autres conditions restent : tir pas encore fait, position atteinte avant 100 s. Le masque majore l'attente avec un minorant du trajet. Si ce majorant dépasse 1 s, il joue l'étape à blanc avec son vrai trajet (même planificateur qu'`exec`). Masque et `exec` concordent sur les 113 instants testés (`tests/test_engine.js` §3b). La brique `tir` du moteur est inchangée (programmes, `esp32_bridge.py`).
- **Aller à la position de tir** : l'action « Aller dans la salle du trône » est réutilisée. La position de tir imposée (`tx, ty` = 250, 1000, `tirDepuisTrone`) est le centre du trône, cible de `trone`. Depuis là, `tir` ne fait plus qu'une rotation (1,7 s mesurée). Aucune nouvelle brique : `BRIQUES_PRISES_EN_CHARGE` d'`esp32_bridge.py` est inchangé.
- **Nouvelle famille `attenteCourte`** : « Attendre 1 / 2 / 4 s sur place » (brique `attendre`, bornée à 100 s), toujours valide avant 100 s ; « finir » reste.
  - Durées `HYPOTHESES.attentesCourtes` = [1, 2, 4] s (hypothèse). 1 s = `attenteMaxTir` : la fenêtre de tir est toujours atteignable. 1 + 2 + 4 composent toute attente entière de 1 à 7 s. 4 s reste sous la durée médiane d'une macro-action de la référence (4,2 s).
- **Référence** : … Graal (fin à 70,4 s), trône, attentes 4 + 4 + 2 + 1 s, tir à 81,7 s (attente interne 0,09 s, premier boulet à 85 s), trône. 116 pts, 90,30 s, 20 paires imitables, 0 cible invalide.
  - Une prise et une tour de plus (P6.2, tours T4 ou T1, 122 pts, Graal fini à 80,2 s) réussissent dans le moteur, mais ne sont pas imitables. Le masque refuse la tour T4 ou T1 de la face A ou B : le trajet vers la pose (680, 1815) ou (680, 185) n'est pas trouvé par le planificateur certifié, alors que la recherche d'origine d'`exec` le trouve.
- **Conséquence** : 155 sorties au lieu de 152 ; les modèles et `.meta.json` du catalogue 3.0 sont refusés (version) et **à réentraîner**.

## 14. Adversaires, caractéristiques physiques tirées, mélange d'entraînement (chantier adversaires)

### 14.0 Masque et recherche de secours ; référence à 122 pts
- **Constat (§13)** : le masque refusait les tours T1 et T4 depuis (680, 185) / (680, 1815), qu'`exec` réussit grâce à sa recherche d'origine.
- **Masque** : quand le planificateur certifié (`'disque'`) ne trouve aucun passage, le masque rejoue l'étape à blanc en mode `'secours'` de `planifierEtape` (début de la recherche d'origine d'`exec`, sans ses replis coûteux : `discMode 'non'` + `rapide`). Limité aux étapes `HYPOTHESES.secoursEtapes` = tour, mur, porte, dépôts, Graal (mesure : le secours pour toutes les étapes coûtait +155 % par masque pour 0,8 % d'actions valides en plus, presque toutes sur les prises et déplacements). `HYPOTHESES.secours = false` rétablit l'ancien masque.
- **Coût** (800 croyances d'épisodes aléatoires, graine 11, même machine, sans autre charge) : sans secours 71,9 ms par masque ; secours limité 77,3 ms (**+7,5 %**) ; secours pour toutes les étapes 179,8 ms (+155 %, écarté).
- **Masque → moteur** (6000 décisions aléatoires, graine 11, sans adversaire) : échecs **1,80 % → 0,90 %** (base 5402b1d : 87,1 ms/décision ; après : 97,7 ms/décision, mesurés pendant un entraînement en parallèle) ; avec le tirage physique de notre robot : **0,98 %** (88,2 ms/décision), soit +0,08 point.
- **Durées déclarées par l'équipe** (spec 134a8e7 : nacelle 1 s, prise 0,35 s, approche 200 mm/s, canon 2 s + 0 s, 1,25 boulet/s ; lâcher 0,4 s hérité) : `tests/test_moteur.js` lit ces valeurs dans la spec.
- **Référence adoptée** (`ENGINE.PROGRAMME_REFERENCE`, golden) : P1, P9, M2, M1, P5, P10, M4, M5, P6.3 face B, P6.2 face A, tour T4 face A, P2 face A, tour T2 face B, porte M3, Graal (fin à 75,8 s), trône, attentes 4 + 1 s, tir lancé à 81,1 s (attente interne 0,20 s, premier boulet à 85 s), trône. **122 pts, 93,00 s, 0 erreur, 20 paires imitables, 0 cible invalide.** Les prises et tours portent `tm: true` (comme les briques du catalogue).

### 14.1 Caractéristiques physiques de notre robot (`ADVERSAIRES.PHYSIQUE`, `engine/adversaires.js`)
| id (moteur) | caractéristique | nominale (spec) | statut | plage par défaut |
|---|---|---|---|---|
| `v` | Vitesse de déplacement | 500 mm/s | déclaré | ± 15 % |
| `va` | Vitesse d'approche | 200 mm/s | déclaré | ± 15 % |
| `w` | Rotation de la base | 120 °/s | déclaré | ± 15 % |
| `vz` | Vitesse des vérins Z | 80 mm/s | déclaré | ± 15 % |
| `trot` | Rotation 90° des nacelles | 1 s | déclaré | ± 15 % |
| `tvac` | Prise par le vide | 0,35 s | déclaré | ± 15 % |
| `trel` | Lâcher | 0,4 s | hérité | ± 15 % |
| `tMonteeGraal` | Montée du Graal | 3,5 s | déclaré | [3, 4] s (plage déclarée) |
| `bdep` | Sortie du canon | 2 s | déclaré | ± 15 % |
| `bspin` | Mise en route du canon | 0 s | déclaré | ± 15 % (reste 0) |
| `brate` | Cadence du canon | 1,25 boulet/s | déclaré | ± 15 % |
- **Tirage** : `ADVERSAIRES.tirerPhysique(graine, { actif, valeurs, plages })` ; une plage = ± % autour de la nominale, `[min, max]` (unité affichée), ou 0 (fixe). Un tirage par caractéristique, toujours consommé : reproductible par graine. La descente de la fourche suit la montée du Graal (hypothèse du moteur).
- **Environnement** : `ENV.create({ physique })` ou `scenario.physique` ; les valeurs tirées priment sur `params`. `reset()` renvoie `physique: { notre, plages, tirageActif, adversaire }` (aussi `env.physique()` et le bilan du worker).
- **Croyance** : `belief.params` contient toutes les clés physiques effectives (`ENV.paramsBelief`) ; le masque (`worldOf`) et l'observation les utilisent.
- **Observation `icamlot-obs-3.1`** : nouveau groupe `physique` (11 entrées, dans les groupes par défaut) = valeur effective / nominale de la spec − 1, bornée à ±1 (mise en route du canon, nominale nulle : écart en s). Les modèles `obs-3.0` sont refusés (version).
- **Embarqué** : spec par défaut ; `pi5_runner.py --calibration fichier.json` (clés du moteur, `embarque/croyance.py: params_calibration`).
- **Entraînement** : `cfg.physique` (API / atelier Cerveau, section « Caractéristiques de notre robot ») → `ENV.create({ physique })` ; enregistré dans `.meta.json` et le JSON web (`physique` : caractéristiques, nominales, statut, réglages ; `env_config`).

### 14.2 Robots adverses (`ADVERSAIRES.PROFILS`)
| id | type | esquisse | description |
|---|---|---|---|
| `batisseur` | à règles | 64 | rond, rapide ; construction pure, Graal sur une construction, trône ; pas de tir |
| `razzia` | à règles | 54 | rond, très rapide ; vide d'abord P1, P5, P2, P6 (carrières proches de notre château), construit chez lui, tir sur notre cour à 85 s, trône |
| `champion` | réseau figé | 116 | mêmes mécanismes que nous ; imitation de la référence + PPO (entraînement complet) |
| `intermediaire` | réseau figé | 41 | mêmes mécanismes, plus lent ; imitation (3 murs, Graal, tir) + PPO bref |

- **Spécification d'adversaire** : `{ robot: id, fixe?: { caractéristique: valeur } }` dans `scenario.opponent` (ou `opts.adversaires`) ; caractéristiques tirées par la graine du scénario.
- **Robot à règles = robot abstrait** (`ADVERSAIRES.makeRobot`) joué par `ENGINE.makeDuel` (`cfg.blue.make`, même interface que `makeSim`). Abstraction (hypothèses) : une prise ramasse d'un coup les pierres disponibles d'une carrière (≤ capacité) en `tPrise` ; une construction (mur 3 pierres à plat, tour 1 debout, porte 2 piliers + linteau) se pose depuis une pose d'approche hors de la zone en `tPose` par pierre (porte × `facteurPorte`) ; le Graal est pris (`tPrise`), monté (`tGraal`) et posé sur une de ses constructions (niveau 3) sans quitter le château ; le tir sort le canon (`tCanon`) puis lance un boulet toutes les `1 / cadence` s dès 85 s, chacun dans notre cour avec la probabilité `precision`. Trajets : Dijkstra sur une grille de 50 mm (rayon d'enveloppe + marge), lissés, vitesse constante + `v / acceleration` par trajet. Score : barème de la spec (`SCORE.scoreAt` délègue).
- **Interactions** : ses prises réservent les pierres (« premier engagé »), ses pierres posées sont des obstacles pour nous, son empreinte est portée par sa pose (`GEOM.hullsHit` : `o.fp`, `o.R`) pour notre évitement et nos contacts ; lui planifie autour de notre robot et **s'arrête** si nous sommes devant à moins de `dArret` (bords des enveloppes), abandonne l'action après `attenteMax` s.
- **Règlement** : empreinte convexe de périmètre ≤ 1200 mm (départ et déployé, mécanismes abstraits dans l'empreinte), hauteur déclarée 340 mm, départ entièrement dans sa salle du trône, hors du Graal ; il construit (pas d'anti-jeu).
- **Stratégies réactives** (`ADVERSAIRES.agentRegles`) : à chaque décision, gain (barème) / durée estimée de chaque action possible d'après l'état réel (carrières restantes, zones libres, notre position), pondérés par les priorités du profil, aléa ± `bruit` / 2 tiré de la graine ; réserve de temps pour le Graal, le tir (Razzia) et le trône ; ne s'enferme pas dans son château avant `enfermementApres` s s'il peut faire autre chose ; attend 0,5 s si une action échoue sans faire avancer le temps.
- **Robots « réseau »** : `ENV.brainAgent` sur un `makeSim` bleu avec les caractéristiques tirées (`ADVERSAIRES.plagesReseau`) ; empreinte = la nôtre (mêmes mécanismes). Modèles figés : `.data/adversaires/<id>.json` (chargés par `engine/env_worker.js`, `ICAMLOT_ADVERSAIRES` ; plateau : `GET /api/adversaires/<id>/modele`).
- **(Ré)entraînement par l'équipe** (aucun modèle n'est versionné ; `.data/adversaires/` est ignoré par git) : `python -m trainer.adversaires --robot champion|intermediaire [--duree s] [--transitions n] [--processus p] [--dossier d]` ou `POST /api/adversaires/<id>/entrainer` (corps `{ duree, transitions, epoques, processus }`) ; sortie `<dossier>/<id>.json` (défaut `.data/adversaires/`, ou `<données de l'API>/adversaires/`, ou `ICAMLOT_ADVERSAIRES`) et bilan `<id>.entrainement.json`. Budgets par défaut : champion = imitation 200 époques (lots de 4, lr 2e-3, 12 scénarios) + PPO lr 1e-4 jusqu'à 200 000 transitions ou 2400 s, évaluation tous les 10 ; intermédiaire = imitation 200 époques (6 scénarios) + PPO 300 s. Pendant son entraînement : 50 % seul, 50 % référence en miroir (hypothèse). Sans modèle : « modèle non entraîné : lancer l'entraînement » (moteur, API `etat`, atelier, plateau) et exclusion du mélange, proportions redistribuées et affichées.

### Plages des adversaires (hypothèses proposées à l'équipe, dans les bornes validées)
| | Bâtisseur | Razzia | Champion | Intermédiaire |
|---|---|---|---|---|
| empreinte | rond, périmètre 1050–1150 mm | rond, 950–1100 mm | la nôtre (1173 mm) | la nôtre |
| vitesse (mm/s) | 550–750 | 700–800 | 600–800 | 300–400 |
| rotation (°/s) | 180–360 | 240–360 | 150–300 | 90–120 |
| prise / pose (s) | 2–3,5 / 1,5–2,5 par pierre | 2–3,5 / 2–3 par pierre | mécanismes × 0,85–1,15 | mécanismes × 1,1–1,4 |
| montée du Graal (s) | 3–5 | 3–6 | 2–3,5 | 4–6 |
| distance d'arrêt (mm) | 250–450 | 250–450 | évitement du moteur | évitement du moteur |
| capacité, tir | 3 pierres, pas de tir | 6 pierres, précision 0,7–0,9 | — | — |

Autres hypothèses du robot abstrait (`ADVERSAIRES.HYPOTHESES`) : grille 50 mm, marge 15 mm, jeu d'approche 25 mm, marge autour de notre robot 120 mm, accélération 1500 mm/s², attente maximale 3 s, porte × 1,5, canon 1 s, 1,5 boulet/s, 10 boulets, hauteur 340 mm, marge de fin 1,5 s.

### 14.3 Scores mesurés
Mesures sur cette machine (CPU 4 cœurs), graines 1000–1029 (seul) et 1000–1029 (contre `PROGRAMME_REFERENCE`, nos caractéristiques nominales) :

| Robot | Esquisse | Seul (30 matchs) | Contre la référence (30 matchs) : adversaire · nous |
|---|---|---|---|
| Bâtisseur | 64 | **97,1 ± 3,3** (min 93), 0 erreur | 93,3 ± 3,6 · 115,5 ± 9,7 ; 0 contact, 0 erreur adverse |
| Razzia | 54 | **106,9 ± 3,4** (min 99), 0 erreur | 105,7 ± 2,6 · 91,1 ± 21,1 ; 0 contact, 0 erreur adverse |
| Champion | 116 | non entraîné ici (décision de l'équipe) | — |
| Intermédiaire | 41 | non entraîné ici (décision de l'équipe) | — |

Nos erreurs moteur contre la référence (28 et 190 sur 30 matchs) viennent du programme figé : pierres prises par l'adversaire. Essai CPU fait avant la décision (modèle non versionné, 2817 s, 3 processus) : champion imité à 100 % → 122,0 ± 0 seul en jaune, mais 85 seul et 53 contre la référence quand il joue en bleu (voir 14.5) ; intermédiaire imité : 79 seul et contre la référence (6 matchs, en jaune).

### 14.4 Mélange d'entraînement de notre réseau
- `cfg.adversaire.melange` = `{ batisseur, razzia, champion, intermediaire, self, reference, aucun, <id de stratégie> : proportion }` ; défaut (API, atelier) : **20 % de chacun des 4 robots + 20 % de self-play**. `"melange": {}` rétablit l'ancien réglage par intensité. Un robot « réseau » sans modèle figé est retiré du mélange (signalé).
- **Self-play** : notre réseau courant (JSON web), enregistré comme adversaire `self` et rafraîchi toutes les `reglages.self_play_tous_les` mises à jour (défaut 5) ; au départ, `cfg.adversaire.self_modele` (champion précédent) s'il est donné.
- **Évaluation de sélection** : matchs répartis selon le mélange (plus forts restes) ; `par_adversaire` donne score, score adverse, taux de victoire et erreurs par adversaire (`robot:<id>`, `self`, `reference`, `sans adversaire`).

### 14.5 Limites et points ouverts
- **PAMI non simulés** (non demandé) : ni douves ni attaque, pour nous comme pour les adversaires.
- Robots à règles : mécanismes abstraits (pas de pinces, pas de balistique des boulets ; précision tirée) ; empreinte du champion et de l'intermédiaire = la nôtre (pas le rectangle 300 × 280 de l'esquisse), car ils partagent nos mécanismes.
- Plages des adversaires et ± 15 % de notre robot : hypothèses proposées à l'équipe.
- **Réseau entraîné en jaune, joué en bleu** : notre robot n'est pas symétrique (§10) ; l'essai CPU du champion passe de 122 pts (jaune) à 85 pts (bleu, seul). Forcer le bit « équipe » à sa valeur d'entraînement ne change rien (mesuré) : à l'équipe de décider s'il faut entraîner les adversaires côté bleu (l'environnement ne fait jouer que le jaune aujourd'hui).
- Bâtisseur et Razzia dépassent largement leur esquisse (97 et 107 pts seuls) : à ralentir (plages) si l'équipe les veut moins forts que le champion.
- 80 décisions par épisode (hypothèse héritée) : un réseau qui attend par pas de 1 s est tronqué (score 0) ; porté à 150 pour l'entraînement des adversaires seulement.
- Évaluation de sélection du self-play : contre le réseau courant (premières mises à jour : réseau de départ).
- La neuroévolution (MLP) n'utilise pas le mélange (intensité seule).
- Un robot à règles qui voit notre robot apparaître brusquement à moins de sa distance d'arrêt s'arrête aussitôt (pas de recul).

## 15. Symétrie jaune / bleu : faces A et B échangées côté bleu (chantier symétrie ; obs `icamlot-obs-3.2`, catalogue `icamlot-catalogue-3.2`)

### 15.1 Principe
- **Constat** : faces A, B, C à h, h + 120°, h + 240° (`spec/robot.json`, `repere.angle_0`). Le miroir de la table (x -> 3000 - x) change l'ordre cyclique (A, B, C) en (A, C, B). Avec l'ancien miroir (h -> 180 - h, faces inchangées), la face B jaune correspondait à la face C bleue : un réseau entraîné en jaune ne voyait pas la même situation en bleu.
- **Repère de l'équipe bleue** (remplace le miroir de cap des §2 et §10) :
  - la face « A » de l'équipe est la **vraie face B**, et inversement ; la face C reste C ;
  - cap de l'équipe = cap de la vraie face B mis en miroir : `h_équipe = 180 - (h_réel + 120)` = `ENGINE.mirrorCap(h_réel)` (involutif) ; `ENGINE.ECART_FACES` = 120 (`repere.angle_0`, valeur en texte dans la spec) ;
  - x -> 3000 - x, ids en miroir (inchangé).
- **Moteur** (`engine/engine.js`) : `mirrorFace`, `mirrorCap`, `ECART_FACES` ; `mirrorStep` échange A et B et met les caps de `traj` en `mirrorCap` (angles d'objets `deposer.ang` : 180 - ang, inchangé) ; `blueParams.h0 = mirrorCap(h0)` (départ bleu à 60° : vraie face B vers le centre) ; `seDeplacer.h` passe par `th()` ; cap de tir bleu inchangé (300°, déjà cohérent). Un programme jaune passé par `mirrorStep` est donc la vraie image miroir (au résidu près, 15.3).
- **Actions** (`engine/actions.js`) : `realStep` (via `mirrorStep`) échange les faces ; `toProgramStep` lit la vraie face (`ACTIONS.realFace`) pour les tours et le stockage. Les libellés « face A / B » du catalogue sont ceux de l'équipe. Les raisons du masque (`explainBelief`) citent la face réelle.
- **Observation** (`engine/env.js`) : en bleu, cap = `mirrorCap(h)`, groupe `pinces` dans l'ordre (vraie B, vraie A), rayons « spatial » à partir de la vraie face B ; rayons, château et trône calculés dans le repère de l'équipe (même résultat au bord ; pose arrondie à 1e-9, tolérance numérique). Jaune : observation inchangée. `ENV.mirrorBelief(b)` : croyance du miroir physique (involutive).
- **Versions** : `icamlot-obs-3.2` et `icamlot-catalogue-3.2` (le sens change en bleu). Les modèles 3.1 sont refusés : à réentraîner (en jaune, leurs entrées et sorties sont les mêmes qu'en 3.1).

### 15.2 Embarqué
- `embarque/miroir.py` : `cap_miroir`, `face_miroir`, `face_reelle`, `pose_miroir` (identiques au moteur ; `hello.miroir.ecartFaces` du pont vérifié par test).
- `embarque/croyance.py` : pose mesurée -> repère d'équipe avec `cap_miroir` ; recoupement ESP32 : vraie face B contre pince A du modèle.
- `embarque/bridge.js` : `track_start { equipe: 'blue' }` fait tourner le modèle interne comme un **moteur bleu en repère réel** (vraie disposition de la face C et des nacelles à 90°) ; croyance (`ENV.mirrorBelief`), plans et images rendus dans le repère de l'équipe (x, `mirrorCap`, GRIP_A <-> GRIP_B, VAC). L'observation et le masque restent calculés sur cette croyance d'équipe (bit d'équipe 0, comme avant).
- `esp32_bridge.traduire` / `initialize` : en bleu, la face A de l'équipe pilote la vraie face B (Z, ROT, PUMP) ; caps `cap_miroir`. Départ bleu : `SET_POSE 2750 1000 60`.

### 15.3 Mesures (`tests/mesure_symetrie.js`, cette machine, 4 cœurs)
| Mesure | Avant (a856c19) | Après |
|---|---|---|
| obs(jaune) = obs(bleu, miroir physique) hors bit d'équipe, 200 croyances (140 avec pierres tenues) | 0 / 200 | **200 / 200** |
| masque identique (états) ; actions différentes | 56 / 200 ; 3113 / 31 000 (10,0 %) | 121 / 200 ; **281 / 31 000 (0,91 %)** |
| référence 122 pts -> 20 actions du catalogue, rejouée en bleu seul (actions masquées sautées) | 32 pts, 8 masquées (dès l'action 10) | 32 pts, 8 masquées (dès l'action 10) |
| même programme, briques sans masque (`mirrorStep`), bleu seul | 79 pts, 3 erreurs | 49 pts, 6 erreurs |
| masque -> moteur, seul, 2000 décisions (graine 11) jaune / bleu | 0,55 % / 0,15 % | 0,55 % / 0,80 % (1 cause hors trajet : hauteur 355 mm signalée pendant une attente, état déjà fautif) |

Imitation (`python -m trainer.imitation --exemple --scenarios 4 --epoques 200 --eval-matchs 8`, 122,0 ± 0 en jaune dans les deux cas), puis 8 matchs (graines 1000-1007) ; nous · adversaire · erreurs moteur cumulées :

| | Avant, jaune | Avant, bleu | Après, jaune | Après, bleu |
|---|---|---|---|---|
| seul | 122,0 ± 0 | 91,0 ± 0 | 122,0 ± 0 | **32,0 ± 0** |
| Bâtisseur | 103,9 ± 23,1 · 93,8 · 5 | 72,1 ± 13,8 · 96,8 · 1 | 112,4 ± 10,7 · 94,5 · 4 | 95,3 ± 34,7 · 94,5 · 2 |
| Razzia | 29,0 ± 0 · 106,5 · 16 | 45,3 ± 22,8 · 104,8 · 19 | 66,0 ± 8,3 · 107,3 · 16 | 56,5 ± 13,4 · 105,5 · 20 |

- En bleu seul, le réseau imité obtient le même score que la référence rejouée en bleu (32 pts) : les 10 premières actions sont celles du jaune, aux mêmes poses en miroir ; l'action 11 (tour T4 face A, rangée 2) est masquée en bleu : la recherche de secours du masque (§14.0) ne trouve pas le passage vers (2320, 1815), alors qu'`exec` (recherche complète) le trouve (2,6 s au lieu de 1,2 s en jaune). Le réseau, sans autre exemple, s'arrête ensuite (32 pts). Avant, ses entrées bleues étaient fausses et il jouait par hasard une autre suite (91 pts).
- L'écart jaune/bleu ne devient donc pas faible pour un réseau imité d'**un seul** programme : il faut entraîner (ou au moins évaluer et sélectionner) aussi en bleu, ce qui a maintenant un sens (mêmes entrées, mêmes actions).

### 15.4 Asymétries résiduelles (mesurées)
- **Nacelles à 90° (principal)** : la pierre de la rangée 1 part à droite, celle de la rangée 3 à gauche (`GEOM.heldFoot`, u = zc sin(rot)) ; pas d'angle -90° (angles 0, 90, 180). 248 des 281 actions de masque différentes (88 %) sont dans les 101 états où une nacelle est (ou sera) à 90° ; 33 sur les 99 autres (0,22 % des actions). Tours de rangée 1 ou 3, portes : la référence échoue en bleu sur la tour T6 rangée 3 (« pierre décalée de 60 mm ») et la porte M8.
- **Face C** (canon à gauche, ascenseur à droite, fourche saillante d'environ 20 mm d'un côté) : essai avec une face C symétrisée (canon et Graal centrés, fourche doublée en miroir, copie hors dépôt) : 280 actions différentes au lieu de 281, référence inchangée. **Effet mesuré négligeable** sur le masque ; le Graal est pris en bleu avec le robot décalé de 114 mm (2 × 57) par rapport au miroir, sans échec mesuré.
- **Planificateur** : à requête miroir, trajets légèrement différents (cap interpolé, lissage ; ex. +0,17 s sur le mur M1 de la référence) ; un essai d'ordre de parcours des cases inversé en bleu (A*, recherche en largeur, voisinages) ne change presque rien (275 au lieu de 281) et n'a pas été gardé.
- Châssis : symétrique à 0,32 mm près (réflexion échangeant A et B).

### 15.5 Points ouverts
- Entraîner aussi en bleu (l'environnement ne fait jouer que le jaune ; `tests/mesure_symetrie.js` contient un runner bleu, seul ou contre un robot à règles) : décision de l'équipe.
- Masque bleu de la tour T8 de la référence : la recherche de secours est plus étroite que celle d'`exec` (asymétrie du planificateur).
- Embarqué bleu : observation et masque calculés sur la croyance d'équipe (chiralité jaune) alors que le modèle interne exécute avec la chiralité réelle : une action acceptée par le masque peut être refusée par le modèle interne (échec connu, rien n'est envoyé aux ESP32).
- `esp32_bridge.py` (chantier embarqué) modifié pour la traduction bleue.

## 16. Rotation des nacelles à −90° (chantier rot-90 ; obs `icamlot-obs-3.3`, catalogue `icamlot-catalogue-3.3`)

- **Spec** : `pince_A_et_B.rotation_angles_deg` = [−90, 0, 90, 180] (équipe, `rotation_moins_90`) ; plage des rotations coordonnées [−90, 180], jamais par −180. Lus par `GEOM.GEO.anglesNacelle / rotMin / rotMax`, `GEOM.rotOk`, `embarque.spec.angles_nacelle_deg`.
- **Géométrie** : à −90°, la pierre tenue est décalée de l'autre côté de la face (u = zc sin rot). Faisabilité sous 350 mm identique à ±a (écart 0 mm, `tools/conception_pince.py`, `conception/pince.md`) : mêmes tables `GEOM.corridor`.
- **Moteur** : `tourner` et `deposer` acceptent −90 ; `tour` et `porte` prennent un champ `r` ∈ {90, −90} (90 par défaut) ; préconditions et `exec` utilisent cet angle (pose décalée de ±zc, recul et balayage).
- **Miroir** (remplace « pas d'angle −90 » de §15.4) : +θ dans le repère de l'équipe = −θ réel ; 0 et 180 inchangés (`GEOM.mirrorRot`, `embarque.miroir.rot_miroir`). `ENGINE.mirrorStep` l'applique à `tourner.r`, `deposer.r` (debout = 90) et à `tour.r` / `porte.r` (absents = 90, donc −90 en bleu). `ENV.mirrorBelief` met `rot` et `rotReelle` en miroir.
- **Observation 3.3** : angle de l'équipe (bleu : `mirrorRot`), codé (angle + 90) / 270 ; l'ancien angle / 180 confondait −90 et 0. Même nombre d'entrées.
- **Catalogue 3.3** : « Préparer la pince » propose −90 (8 actions au lieu de 6, 157 au total) ; une tour est posée à −90° si la pince de l'équipe y est déjà, sinon à +90°. Les modèles 3.2 sont refusés : à réentraîner.
- **Embarqué** : le pont rend plans et images bleus avec l'angle de l'équipe ; `traduire` envoie l'angle réel (`ROT B −90` pour « face A à 90° » en bleu) ; `PENDING_ROT` en face et angle réels ; recoupement codeur en angle réel. Firmware simulé : `ROT` hors [−90, 180] -> `NAK RANGE ROT` (`docs/PROTOCOLE_ESP32.md` §5.2).
- **Correction** : `sim.finish()` ne fait plus une rotation préparée après 100 s (le rejeu de `env.program()` donnait des erreurs absentes de l'environnement).

| Mesure (`tests/mesure_symetrie.js`, `tests/test_engine.js 2000`) | Avant (62055a2) | Après |
|---|---|---|
| obs(jaune) = obs(bleu, miroir physique), 200 croyances | 200 / 200 | 200 / 200 |
| masque identique (états) ; actions différentes | 121 / 200 ; 281 / 31 000 (0,91 %) | 166 / 200 ; **44 / 31 400 (0,14 %)** |
| dont états avec une nacelle à ±90° | 248 actions, 101 états | 41 actions, 118 états |
| référence jaune -> catalogue, rejouée en bleu seul | 32 pts, 8 masquées | **122 pts, 0 masquée** |
| même programme sans masque (`mirrorStep`), bleu seul | 49 pts, 6 erreurs (T6, M8, Graal) | **122 pts, 0 erreur** |
| masque -> moteur, 2000 décisions, jaune / bleu | 0,55 % / 0,80 % | 0,50 % / 0,90 % (trajet ou pose, tirages différents) |

Les états tirés au hasard ne sont pas les mêmes avant et après (catalogue de 157 actions au lieu de 155).

**Asymétries restantes** : 33 des 44 actions différentes sont « Monter le Graal » (face C : ascenseur à droite, prise décalée de 2 × 57 mm), le reste sur le planificateur (tour, trajets). Rotation 90 -> 180 de l'équipe bleue = −90 -> 180 réel (270°, par 0 et 90) : 2 s de plus (1 s par 90°, spec) et un balayage horizontal différent (180° ne sert qu'au stockage sans pierre en rangée 1 et à « Préparer la pince »).

**Points ouverts** : `plateau/app.js` (chantier web) ne propose que 0, 90 et 180° pour « Tourner la pince » (champ `r` de tour et porte non exposé) ; le matériel de rotation (Q3 de PROTOCOLE_ESP32) doit pouvoir aller à −90°.
