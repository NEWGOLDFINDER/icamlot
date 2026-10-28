# Audit — simulateur, entraînement et déploiement du cerveau ICAM LOT

Date : 2026-10-28 · Révision auditée : `4dee407` (branche `main`)

Ce document ne contient que des faits constatés dans le code ou mesurés en l'exécutant. Tout ce qui dépend du règlement officiel ou du robot réel est signalé comme **à confirmer** (section 4) et n'est pas tranché ici.

---

## 0. Verdict

1. **Il existe deux simulateurs qui ne simulent pas le même monde.**
   - Le moteur JS (`engine/engine.js`) modélise réellement la géométrie, les pinces, les collisions, la planification A* et la balistique des boulets.
   - Le moteur PyTorch (`trainer/torch_engine.py`) est un modèle abstrait : compteurs, cercles et durées forfaitaires.
   - Le PPO s'entraîne **uniquement** sur le second.
2. **Le réseau ne « pilote » pas le robot : il choisit parmi 130 macro-actions** (prendre P9, poser un mur sur M1…). Tous les mouvements et toutes les pinces sont gérés par du code écrit à la main. Les têtes « approche » et « pliage » du réseau ne sont branchées nulle part.
3. **La chaîne de déploiement est cassée.** `pi5_runner.py` envoie 37 entrées au modèle ONNX actuel, qui en attend 56. Le programme plante (vérifié).
4. **Le masque d'actions ment au moteur de référence.** Avec une politique aléatoire, **52 % des actions déclarées valides par le masque échouent** dans le moteur JS (mesuré : 94 erreurs sur 181 décisions).
5. **Les performances annoncées ne sont pas établies.**
   - Le « 105 pts » correspond à une séquence unique, mémorisée, jouée sans adversaire.
   - Rejoué contre lui-même dans le moteur JS, ce même programme tombe à **54 pts** avec 6 erreurs.
   - `BENCHMARK_REPORT.md` (2 matchs par scénario, 0 % de victoires dans 4 scénarios sur 5) contredit le `README.md` (100 % de victoires, 105 pts).

---

## 1. Architecture réelle (et écarts avec la documentation)

| Élément | Ce que dit la doc | Ce que fait le code |
|---|---|---|
| Simulateur d'entraînement | « moteur cinématique officiel » | PPO : `TorchEnv` abstrait. Évolution : `TorchEnv` ou le worker JS, selon la config |
| Contrôle | « contrôle bas niveau des trajectoires et actionneurs » | Choix d'une macro-action parmi 130. Trajectoires et pinces sont scriptées (`engine.js:785-1126`) |
| Têtes approche/pliage | « multi-têtes PPO » | Échantillonnées et comptées dans la log-prob, mais **jamais lues par l'environnement** |
| Cerveau « champion » de l'UI | « V2 factorisé GRU, 164 715 params » | MLP 37→256→128→64→64→64→106, **66 090 params**, entraîné par évolution (`.data/brains/cerveau-v2-champion.json`) |
| Encodeur « Entity-Transformer » | utilisé | `EntityTokenizer` et `TransformerEncoder` sont instanciés (`models.py:173-175`) mais **jamais appelés** dans `forward` |
| Observation | contrat 56D (`PROJECT.md`) | Ordre réel ≠ contrat (rot/hc de chaque face entrelacés). Le runner Pi 5 produit 37D |

Il existe **4 implémentations indépendantes** du masque d'actions, chacune avec ses propres règles :

- `engine/actions.js` ;
- `torch_engine.get_mask` ;
- `pi5_runner.compute_mask` ;
- les « live masks » JS, torch et Pi 5.

Il en existe **3** de l'observation : `env.js`, `torch_engine.get_obs` et `pi5_runner.format_observation`.

---

## 2. Constats classés par gravité

### CRITIQUES (empêchent d'obtenir un robot intelligent fiable)

**C1. Déploiement Pi 5 incompatible avec le modèle exporté** (vérifié par exécution)
- Le modèle `best_brain_pi5.onnx` a 2 entrées (`obs` 56, `hidden` 128) et 4 sorties (`primary_logits` 130, `approach_logits` 5, `folding_logits` 2, `next_hidden` 128).
- Côté runner :
  - `pi5_runner.py:107` construit l'observation en 37D ;
  - `:302` construit un masque de 106 actions ;
  - `:481` fait `self.hidden = outputs[1]`, ce qui stocke les logits d'approche (taille 5) à la place de l'état caché.
- `python pi5_runner.py --benchmark` plante : `Got: 37 Expected: 56`.

**C2. Écart entre simulateurs (torch ≠ JS)** — même séquence de référence (l'`EXAMPLE` de `env.js`) jouée dans les deux moteurs :

| Étape | Durée JS (s) | Durée torch (s) | Position finale JS | Position finale torch |
|---|---|---|---|---|
| mur M1 | 4,6 | 3,9 | (450, 252) | (250, 230) |
| porte M3 | 14,1 | 9,3 | (580, 1000) | (680, 1000) |
| poser Graal M3 | 10,8 | 2,9 | (551, 920) | (750, 920) |
| fin des constructions | **62,0** | **50,4** | | |

Conséquences : le torch est environ 20 % trop optimiste sur le temps, et la position du robot dérive jusqu'à 200 mm après chaque construction. Les budgets temps appris par le réseau n'existent pas dans le moteur de référence.

**C3. Points « gratuits » ou faux dans le moteur torch**
- **Boulets** : `balls_in_cour = 10` à chaque tir (`torch_engine.py:1284`), soit +20 pts garantis. Le moteur JS calcule le vol avec traînée, rebonds et dispersion.
- **Graal** : niveau 3 forcé sur un mur, niveau = 1 sur une tour (`:1302`). Le moteur JS calcule le niveau d'après la hauteur et trouve 3 sur une tour, car une pierre debout fait 320 mm.
- **Pierres déposées** (`deposerZone`, `staging`) : elles disparaissent du monde. Elles ne sont ni des obstacles, ni reprenables.
- **Points des pierres** : forfaitaires (3 par mur ou porte, 1 par tour). Le moteur JS compte les pierres dont l'empreinte touche une zone.
- **Trône** : il suffit que le centre du robot soit dans le rectangle (`:1039`). Le moteur JS exige les 3 sommets du triangle.
- **Score à t = 0** : 0 dans torch, **10 dans le moteur JS** (le robot démarre dans la salle du trône). Les récompenses des deux moteurs ne sont donc pas comparables.

**C4. Actions cassées dans le moteur de référence, mais « réussies » dans torch** (vérifié par exécution)
- `staging` (6 actions) : `toProgramStep` produit `{a:'staging'}`, qui n'existe pas dans `engine.js`. Résultat : « Action inconnue ».
- `repickup` (6 actions) : produit `{a:'prendre', z:'SN'}` sans paquet. Résultat : « Paquet inconnu ». Le masque la déclare pourtant valide dès qu'une face est vide (`actions.js:647`).
- Prise partielle : le masque l'autorise (`actions.js:631-635`), mais le moteur la refuse (`engine.js:787` : « La face A tient déjà quelque chose »).
- `tournerPince` juste après une tour : contact avec la pierre qui vient d'être posée.
- Répartition des erreurs avec une politique aléatoire (181 décisions) :

| Famille | Taux d'échec |
|---|---|
| traj | 19/26 |
| tournerPince | 34/73 |
| staging | 7/7 |
| repickup | 7/7 |
| tour | 6/10 |
| deposerZone | 6/11 |
| prendre | 8/25 |

**C5. Pas d'adversaire réel pendant l'entraînement PPO**
- `env.reset()` sans scénario donne `opp_pose = 0`, c'est-à-dire aucun adversaire (`torch_engine.py:570`).
- `dynamic_opponent` est désactivé par défaut. Même activé, l'adversaire se téléporte à 3 positions fixes et ne retire que P4 et P8.
- Le curriculum est désactivé par défaut (`ppo_trainer.main`).
- Mesure : dans le moteur JS, le programme de référence joué contre lui-même passe de **105 à 54 pts**, avec 6 erreurs (P10 et P4 déjà pris, Graal inaccessible, porte incomplète).

**C6. Observations incohérentes entre les implémentations**
- **Radar** :
  - JS : marche par pas de 50 mm avec dilatation du rayon robot (235 à 350 mm). Il voit l'adversaire et les pierres posées (`env.js:125-139`).
  - torch : intersection rayon-cercle brute, sans adversaire ni pierres posées.
  - Pour l'équipe bleue, le radar JS n'est pas passé en miroir.
- **Rayon d'enveloppe** : constant à 235 en JS (`env.js:122` appelle `sim.hullRadius`, que `makeSim` n'expose pas), alors que torch varie de 235 à 350.
- `rot / 90` vaut 2,0 quand la pince est à 180° : la valeur sort de [0, 1].
- Le drapeau « à plat » ne reconnaît que 0°, alors que le moteur accepte 180° pour un mur.

### MAJEURS

**M1. Règles de masque divergentes**
- Boulets : valides seulement à t ≥ 80 s en JS, toujours valides dans torch.
- Durées mécaniques différentes selon les fichiers (prendre 1,8 / 1,6 s ; tour 2,2 / 3,0 s ; porte 4,8 / 8,5 s).
- `pi5_runner` utilise 4 waypoints différents des 8 du catalogue.

**M2. Le masque n'utilise pas le vrai planificateur**
- Le masque raisonne sur des segments et des cercles, alors que le moteur planifie en A* sur une grille de 40 mm avec la géométrie exacte.
- La « 2ᵉ approche » des paquets P1 à P8 est toujours hors table (y = −195,5 ou 2195,5), donc jamais utilisée.

**M3. Stratégie codée en dur dans les masques**
- « Double face » forcée avant 75 s, trône interdit avant 88 s, boulets interdits avant 80 s, anti-répétition.
- Le réseau n'apprend pas ces arbitrages, et ces règles ne sont pas identiques entre JS, torch et Pi 5.

**M4. Une action invalide coûte du temps dans torch** : environ 3,3 s plus une erreur (`torch_engine.py:1373-1374`), contre 0 s en JS. Une collision annule l'action mais fait quand même avancer l'horloge.

**M5. Problèmes de l'apprentissage PPO**
- Têtes mortes : leur log-prob et leur entropie s'ajoutent au ratio PPO, ce qui ajoute du bruit sans aucun signal.
- Imitation : la cible de valeur vaut 105 constant à tous les pas (`ppo_trainer.py:181`).
- Imitation : l'action 84 (boulets) est imitée alors qu'elle est masquée à cet instant (perte d'environ 1e8).
- Imitation : 64 copies d'une seule trajectoire.
- Récompenses et valeurs non normalisées (ordre de 100).
- Évaluation greedy sur 50 pas, sans adversaire, avec un reset déterministe : le « score d'éval » mesure la mémorisation d'une séquence.

**M6. Évolution sur GPU** : `env.reset()` est déterministe et sans adversaire, donc les `n` scénarios d'évaluation sont identiques.

### MINEURS / DOCUMENTATION

- `README.md`, `README_PyTorch_GPU.md` (GRU 64, 34k params, 106 actions) et `PROJECT.md` se contredisent entre eux et contredisent le code.
- `tests/test_champion_js.js` **échoue** : 102 pts au lieu des 105 attendus.
- Les tests JS passent, mais ils vérifient la présence des fonctions, pas leur exactitude. Par exemple, aucun test n'exécute `staging` dans le moteur.
- `trainer/test_torch_engine.py` n'a pas pu se terminer sur CPU en 15 min. Il **n'a pas été vérifié** ici.
- Niveaux du Graal : `bareme.js` indique de 1 à 4, le code plafonne à 3 (point à confirmer, voir §4).

---

## 3. Mesures de référence

| Mesure | Valeur |
|---|---|
| Programme `EXAMPLE`, moteur JS, seul | 105 pts, T = 91,8 s, 0 erreur |
| Même programme, duel contre lui-même | 54 pts, 6 erreurs |
| Même séquence, moteur torch | 105 pts, constructions terminées à 50,4 s (contre 62,0 s en JS) |
| Champion MLP, rejoué dans le moteur JS | 102 pts (test en échec) |
| Débit du moteur JS (1 cœur, politique aléatoire, machine partagée) | environ 0,11 match/s, environ 5 décisions/s |
| Actions « valides » qui échouent dans le moteur JS (politique aléatoire) | 52 % |

---

## 4. Points à confirmer avant de figer le plan (règlement et robot réel)

Le code contient des valeurs que je ne peux pas valider sans le règlement officiel et les caractéristiques réelles du robot. Elles sont listées dans les questions à part. Tant qu'elles ne sont pas tranchées, les phases 1 et 2 ci-dessous gardent ces valeurs marquées « à confirmer ».

---

## 5. Plan de remise en état proposé

Principe directeur : **un seul monde de référence, une seule définition des observations et du masque, et aucun résultat validé hors du moteur de référence.**

### Phase 0 — Spécification unique et filet de sécurité
- Rassembler dans un fichier de spec unique (`spec/regles.json`) le barème, la géométrie de la table, les zones, le départ, le Graal et les durées du robot. Tous les moteurs le lisent.
- Désigner `engine/engine.js` comme **moteur de référence**. C'est le seul qui modélise la physique.
- Ajouter des tests « golden » sur le moteur JS : `EXAMPLE` = 105 pts / T = 91,8 s, plus des cas d'erreur attendus.
- **Critère de sortie** : spec validée par l'équipe, golden tests au vert.

### Phase 1 — Réparer le moteur de référence et le catalogue
- `staging` / `repickup` : soit les implémenter réellement dans `engine.js` (dépôt relais = `deposer` à des coordonnées fixes ; reprise = prise des pierres déposées), soit les retirer du catalogue.
- Aligner le masque sur les préconditions exactes du moteur (prise partielle, rotation à 180°, `tournerPince` sans contact).
- Ajouter un test automatique qui joue chaque action déclarée valide sur un échantillon d'états et exige 0 erreur moteur. Objectif : faire passer le taux d'échec du masque de 52 % à moins de 2 %.
- Corriger l'observation : `hullRadius` exposé, radar en miroir pour l'équipe bleue, normalisations bornées.
- Retirer les règles de stratégie des masques. Le masque ne doit exprimer que ce qui est **physiquement ou réglementairement** possible.
- **Critère de sortie** : 0 action valide qui produise une erreur moteur sur 10 000 états tirés au hasard.

### Phase 2 — Un simulateur d'entraînement fidèle
Deux voies (choix à faire, voir questions) :
- **A. Entraîner directement sur le moteur JS**, en pool de workers `env_worker.js`. Fidélité totale, mais débit faible (environ 5 décisions/s/cœur mesurées) : le nombre de cœurs disponibles détermine la durée d'entraînement.
- **B. Recalibrer le moteur torch sur le moteur JS** :
  - générer des tables de durée et de pose d'arrivée par action, mesurées dans le JS ;
  - reproduire fidèlement les règles de score (boulets, niveau du Graal, trône) ;
  - pré-entraîner rapidement sur torch, puis **affiner et évaluer exclusivement sur le JS**.
- Dans les deux cas : un test de parité exécute des séquences aléatoires dans les deux moteurs et borne l'écart (score identique, temps à ± 5 %).

### Phase 3 — Adversaires réalistes
- Adversaires multiples : stratégies scriptées, cerveaux précédents (ligue de self-play), vitesses variables.
- Contestation des ressources centrales (P9, P10), aléas de durée des actionneurs et de vitesse.
- **Critère de sortie** : évaluation sur au moins 200 matchs JS par type d'adversaire, avec moyenne et intervalle de confiance.

### Phase 4 — Apprentissage RL assaini
- Une seule tête de politique (supprimer les têtes mortes, ou les brancher réellement dans le moteur si le contrôle d'approche est souhaité).
- Supprimer l'encodeur Transformer non utilisé, ou le brancher pour de bon.
- Imitation correcte : plusieurs démonstrations, cibles valides sous le masque, valeur = retour réel.
- Normalisation des récompenses et des valeurs. Récompense = gain de score réel, plus une pénalité d'erreur explicite.
- Sélection du champion **uniquement** sur l'évaluation JS contre adversaires (pas sur le greedy torch).

### Phase 5 — Déploiement robot
- Un seul module observation + masque, porté en Python et testé à l'identique du JS sur des états enregistrés.
- `pi5_runner.py` réécrit pour 56 entrées / 130 actions / 4 sorties, avec la bonne gestion de l'état caché.
- Construction de la « croyance » d'état (paquets pris, constructions) à partir des capteurs réellement disponibles (à confirmer).
- Boucle : décision → exécution de la macro-action par les ESP32 → nouvelle observation. Validation en rejeu (HIL) avant la table.

### Phase 6 — Documentation et tests
- Mettre `README.md`, `PROJECT.md` et le rapport de benchmark en accord avec la réalité mesurée.
- Faire en sorte que la CI exécute les golden tests, le test de cohérence masque/moteur et le test de parité.
