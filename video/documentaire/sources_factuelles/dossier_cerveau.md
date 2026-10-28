# Comment on crée le cerveau du robot ICAM LOT — dossier factuel pour le documentaire

Projet ICAM LOT · Eurobot 2027 (thème Camelot) · dossier établi le 2026-10-28.
Dépôt de référence : copie de la branche `audit/simulateur-ia`, révision `0161a45` (dernier commit : « Contrats §9 : adversaire par défaut conservé… », 2026-10-28 11:45 UTC).
Tous les chemins `fichier:ligne` sont relatifs à la racine de ce dépôt.

---

## 0. Mode d'emploi

### 0.1 Règle de rédaction
Aucun fait n'est inventé. Chaque affirmation porte une source (`fichier:ligne`) ou renvoie à une mesure exécutée pour ce dossier. Ce qui manque est marqué **[À FOURNIR]** (information que seule l'équipe possède) ou **[À CONFIRMER]** (information présente mais contradictoire, ou à valider par l'équipe).

### 0.2 Statuts utilisés

| Statut | Signification |
|---|---|
| **MESURÉ-ici** | Mesure exécutée pour ce dossier, le 2026-10-28, sur la machine de travail (Intel Xeon 2,8 GHz, 4 vCPU, sans GPU, Node 22.22.0, Python 3 + NumPy 2.5.3 + ONNX Runtime 1.29.0, **sans PyTorch**). Les scripts sont listés en annexe C. |
| **MESURÉ-dépôt** | Mesure rapportée dans un fichier du dépôt (par l'équipe ou par l'audit). Elle n'a pas été refaite ici, sauf mention contraire. |
| **CODE** | Ce que fait le code, lu dans le fichier cité. |
| **DÉCLARÉ** | Valeur donnée par l'équipe et consignée dans la spec (`spec/robot.json`, statut `declare`). |
| **PROPOSÉ** | Conception ou réglage proposé par l'audit ou par les chantiers, pas encore validé ou construit. |
| **PLANIFIÉ** | Prévu dans le plan ou le calendrier, pas encore fait. |
| **À DÉFINIR** | Information manquante dans le dépôt (statut `a_definir` de la spec, ou absente). |
| **ESTIMÉ** | Calcul fait à partir de mesures, avec une hypothèse explicite. Ce n'est pas une mesure. |

### 0.3 Confidentialité : ce qui ne doit pas apparaître à l'écran
Le dossier documente tout, mais les éléments suivants décrivent la mécanique du robot. Ils sont signalés par **[CONFIDENTIEL – hors écran]** à chaque occurrence.

| Élément | Où il apparaît dans le dépôt |
|---|---|
| Forme exacte du châssis (triangle tronqué, faces de 262 mm, empreinte à 45 sommets, hauteur 341,2 mm) | `spec/robot.json:22-30`, `docs/CONTRATS.md:30-31`, `AUDIT_SIMULATEUR_IA.md:282-286` |
| Nacelles des faces A et B, ventouses (6 par face), rangées, chariot, rotations 0/90/180° | `docs/CONTRATS.md:32-39`, `AUDIT_SIMULATEUR_IA.md:341`, `conception/pince.md` |
| Canon (face C) : course, bouche, élévation, cadence | `docs/CONTRATS.md:40-44`, `engine/engine.js:1052-1091` |
| Ascenseur et fourche du Graal (face C), séquence `monterGraal`, dimensions du Graal construit | `docs/CONTRATS.md:45-53`, `engine/engine.js:1093-1125`, `conception/ascenseur_graal.md` |
| Fichiers CAO et rendus | `conception/*.step`, `conception/rendu_*.png`, `tools/cao_robot.py` |
| Commandes envoyées aux ESP32 (`VACUUM_SEAL`, `GRAAL_ELEVATE`, `FIRE_BALLS`…) | `esp32_bridge.py:142-169` |
| Vue « plateau » du simulateur web : elle dessine l'empreinte réelle, les nacelles, le canon, la fourche et le Graal | commit `f8caa87` (« feat(plateau): empreinte réelle, nacelles, canon, fourche et Graal… ») |
| Libellés d'observation qui nomment les ventouses (« Vide [A0..2, B0..2] ») | `engine/env.js:14` |

**[À CONFIRMER]** par l'équipe : la liste exacte de ce qui est confidentiel. Les règles du jeu (table, pierres, barème) sont publiques ; les libellés génériques des actions (« Prendre P9 · face A », « Mur M1 ») paraissent sans risque, mais c'est à l'équipe de trancher.

### 0.4 Documents du dépôt à NE PAS utiliser comme source pour la vidéo
Ces fichiers contiennent des chiffres contredits par le code actuel ou par l'audit. Le chantier « docs-bench » chargé de les corriger (`docs/CONTRATS.md:21`) n'a pas encore livré.

| Affirmation | Fichier | Ce que disent le code ou les mesures |
|---|---|---|
| « 164 715 paramètres », « exporté en `.data/weights/best_brain_pi5.onnx`, 53 Ko » | `README.md:65` | Le réseau actuel a **140 035 paramètres** entraînables (§5.3, MESURÉ-ici). Ce fichier ONNX est archivé dans `.data/legacy/weights/` (`docs/CONTRATS.md:107`). |
| Self-play « 100,0 % » de victoires, « 105,0 ± 0,0 » pts | `README.md:87` | L'audit : « Les performances annoncées ne sont pas établies » (`AUDIT_SIMULATEUR_IA.md:18-21`). |
| « +37,11 secondes épargnées… les 105 points du barème » | `README.md:49` | Ce chiffre n'apparaît qu'à cet endroit du dépôt (recherche de « 37,11 » / « 37.11 » dans les fichiers .md, .py, .js et .json : une seule occurrence, MESURÉ-ici). Aucun script ni résultat ne le produit. Il date d'avant l'audit, qui juge les 105 pts non établis. **[À CONFIRMER]** |
| Architecture « FactorizedEncoder + GRU + ResNet », têtes multiples, Transformer | `README.md:148`, `PROJECT.md:15-21` | Une seule tête de politique, pas de Transformer (`trainer/models.py:10`). |

---

## 1. Pourquoi un réseau de neurones, et pour faire quoi exactement

### 1.1 Son rôle : choisir la prochaine macro-action
- Le réseau **choisit une macro-action du catalogue après chaque brique**. Les briques sont, par exemple, « prendre le paquet P9 avec la face B » ou « poser un mur sur M1 ». — `trainer/README.md:3` ; `AUDIT_SIMULATEUR_IA.md:15` · CODE
- Le catalogue compte **130 macro-actions** (§4). — `engine/actions.js:107` · CODE
- Il décide **à nouveau après chaque brique, jusqu'à 100 s** : « Ce n'est pas un programme figé. » — `engine/env.js:421` · CODE
- Le nombre de décisions par match est borné à **80** (hypothèse reprise de `ENV.play`). — `engine/env.js:423` ; `trainer/js_env_pool.py:37-38` ; `trainer/README.md:97` · CODE
- Mesure du nombre de décisions par match avec une politique aléatoire : environ 20 à 27 (MESURÉ-dépôt, moteur 1.3.0, `trainer/README.md:87`) ; 29,4 en moyenne sur 40 matchs avec le moteur actuel 2.0.0 (MESURÉ-ici, annexe C, script `masque_vs_moteur.js`).

### 1.2 Pourquoi un réseau et pas seulement un programme écrit à la main
Ce que disent les sources :
- **But déclaré par l'équipe** : « Le but du réseau est de s'adapter à l'adversaire. » — `docs/CONTRATS.md:150` · DÉCLARÉ
- **Ce qu'on observe avec un programme figé** (MESURÉ-ici, moteur 2.0.0, script `references.js`) :
  - le programme de référence `ENGINE.PROGRAMME_REFERENCE` (`engine/engine.js:1666-1675`), joué **seul**, fait **116 pts** en 90,3 s, avec 0 erreur ;
  - le même programme, joué contre lui-même en miroir (intensité « réaliste »), tombe à **108 pts**, avec 2 erreurs : « Le paquet P10 n'est plus là (pris par l'adversaire). » puis « Il faut une pile de 3 pierres à plat sur la face B. » ;
  - ces deux chiffres correspondent à ceux du contrat (`docs/CONTRATS.md:133` et `:150`).
- **Ce que l'équipe a choisi** : le conflit avec l'adversaire par défaut (108 au lieu de 116) « est voulu », et l'entraînement doit se faire contre plusieurs adversaires, pas seul sur la table. — `docs/CONTRATS.md:150-151` · DÉCLARÉ

**[À FOURNIR]** Toute autre motivation (pédagogique, comparaison avec une stratégie purement scriptée, etc.). Le dépôt ne contient **aucune mesure** montrant qu'un réseau fait mieux qu'un programme écrit à la main. Ne pas l'affirmer à l'écran.

### 1.3 Ce que le réseau ne fait PAS
- **Il ne pilote ni les trajectoires ni les actionneurs.** « Tous les mouvements et toutes les pinces sont gérés par du code écrit à la main. » — `AUDIT_SIMULATEUR_IA.md:15` ; tableau `:30` · CODE
- Une action choisie est traduite en « brique » de programme par `ACTIONS.toProgramStep`. — `engine/actions.js:141-172` · CODE
- La brique est ensuite exécutée par le moteur : planification du trajet, approche, prise, pose. — `engine/engine.js:1140-1430`, table `steps` · CODE
- **Il ne choisit pas parmi des actions impossibles** : le masque d'actions met à −1e9 les logits des actions invalides, en dehors du réseau. — `trainer/models.py:22-23`, `:70-73` ; `trainer/FORMAT_MODELE.md:31` · CODE
- **Il ne voit pas la table** : il reçoit 56 nombres (§3), dont une partie est une croyance et non la vérité (§3.3).
- Sur le robot réel, l'exécution d'une macro-action est prévue sur les ESP32 : « décision → exécution de la macro-action par les ESP32 → nouvelle observation ». — `AUDIT_SIMULATEUR_IA.md:260` · PLANIFIÉ

### 1.4 Mémoire : un réseau « récurrent »
- Le réseau garde un **état caché** de 128 nombres (GRU) d'une décision à l'autre. Il repart de zéro au début de chaque match. — `trainer/models.py:115`, `:141-145` ; `trainer/FORMAT_MODELE.md:32` · CODE
- L'état caché est remis à zéro au début de chaque épisode, pendant la collecte comme pendant l'apprentissage. — `trainer/ppo_trainer.py:3-4`, `:184` ; `trainer/models.py:171` · CODE

---

## 2. Le monde simulé de référence : le moteur JavaScript

### 2.1 Un seul monde de référence
- `engine/engine.js` est désigné **moteur de référence**, « le seul qui modélise la physique ». — `AUDIT_SIMULATEUR_IA.md:218` · PROPOSÉ (audit), puis appliqué
- L'entraînement se fait **dans ce moteur**, en pool de processus Node. L'ancien moteur PyTorch abstrait (`torch_engine.py`) est retiré. — `trainer/README.md:3` ; `docs/CONTRATS.md:83` · CODE
- Pourquoi ce choix : l'audit a mesuré que l'ancien moteur PyTorch donnait des points « gratuits » ou faux (boulets, Graal, trône) et des durées trop optimistes d'environ 20 %. — `AUDIT_SIMULATEUR_IA.md:59-76` · MESURÉ-dépôt
- Version du moteur actuel : **2.0.0**. — `engine/engine.js:11` · CODE
- Les valeurs de géométrie et de durée sont lues dans `spec/spec.js`, généré à partir de `spec/regles_2027.json` et `spec/robot.json`. — `engine/engine.js:2`, `:5-7` ; `docs/CONTRATS.md:23-26` · CODE

### 2.2 Le temps et le barème
- Match de **100 s** ; phase d'attaque à partir de **85 s**. — `spec/regles_2027.json:8-12` · règlement (source dans le fichier)
- Barème (règlement 2027, version officielle 1.0) — `bareme.js:7-22` ; `spec/regles_2027.json:359-373` :

  | Élément | Points |
  |---|---|
  | Pierre dans une zone de construction | 1 |
  | Mur (3 pierres horizontales) | 5 |
  | Tour (1 pierre verticale) | 5 |
  | Porte (2 verticales + 1 linteau), une seule par château | 20 |
  | Graal présent dans le château | 5 |
  | Graal, par niveau d'élévation (1 à 4) | 5 |
  | Robot partiellement / complètement dans la salle du trône | 5 / 10 |
  | Au moins 1 boulet / au moins 3 boulets dans la cour adverse | 5 / +15 |
  | Douves et attaque de PAMI | 5 chacune (non simulées : `engine/score.js:148`) |

- **Moment du calcul** : le trône, les boulets et le Graal ne sont évalués qu'à **T = 100 s**. Avant, seules les constructions comptent. — `engine/score.js:3`, `:89`, `:114`, `:131-132` ; `docs/CONTRATS.md:70` · CODE
- Score maximal théorique calculé par l'audit pour le robot principal : **134 pts** (79 de constructions + 25 de Graal + 10 de trône + 20 de boulets). — `AUDIT_SIMULATEUR_IA.md:192-196` · ESTIMÉ (calcul de l'audit, hors PAMI)

### 2.3 La table et les éléments de jeu
- Table de **3000 × 2000 mm**, bordures de 70 mm. — `spec/regles_2027.json:14-19`
- **30 pierres** de 320 × 110 × 110 mm, marquées ArUco 13. — `spec/regles_2027.json:91-100`
- **10 carrières** (P1 à P10) de 3 pierres empilées. — `spec/regles_2027.json:102-105` ; positions vérifiées sur le plan officiel dans `AUDIT_SIMULATEUR_IA.md:165-170`
- Dans le moteur, chaque pierre a un état : `home` (dans sa carrière), `held` (tenue), `free` (posée), `gone` (prise par l'adversaire). — `engine/engine.js:149`, `:1445-1453`, `:1503-1508` · CODE
- Au plus **3 pierres** stockées dans la cour hors des zones de construction ; au-delà, erreur moteur. — `spec/regles_2027.json:326` ; `engine/engine.js:791-796`, `:1490-1491` · CODE
- Le Graal a quatre états : `home`, `ascenseur`, `toit`, `retire`. — `engine/engine.js:151-152` · CODE **[CONFIDENTIEL – hors écran pour l'ascenseur]**
- **Confinement du Graal** : s'il sort du château, il est retiré de la table et rapporte 0 point. — `spec/regles_2027.json:333` ; `engine/engine.js:1126-1138` · CODE

### 2.4 Planification des trajets : A* sur une grille
- La table est découpée en une **grille de cellules de 40 mm**, soit 75 × 50 cellules. — `engine/engine.js:385` · CODE
- Une cellule est « libre » si le robot, posé à son centre avec l'orientation d'arrivée, ne touche rien, et si l'adversaire ne l'occupe pas. Elle est « serrée » si le robot passe à moins de la marge de tracé. — `engine/engine.js:384`, `:387-398` · CODE
- Recherche **A\*** sur 8 voisins : le coût d'un pas vaut sa longueur, multipliée par 4 dans une cellule serrée ; l'heuristique est la distance à vol d'oiseau. — `engine/engine.js:400-418` · CODE
- Le chemin trouvé est ensuite **lissé** : on saute les points intermédiaires tant que la ligne droite reste libre (test tous les 30 mm). — `engine/engine.js:420-425` · CODE
- Marges de collision : −5 mm pour la sécurité, −25 mm pour le tracé des trajets. — `engine/engine.js:286-287` · CODE
- Vitesses (spec) : 500 mm/s en ligne (DÉCLARÉ, « vitesse mesurée annoncée par l'équipe »), 200 mm/s en approche (statut `herite`, à valider), 120°/s en rotation (DÉCLARÉ). — `spec/robot.json:304-316` ; lues dans `engine/engine.js:15`

### 2.5 Collisions et contacts
- Pendant la planification, la fonction `collides` teste le robot (avec ses pierres tenues) contre les obstacles. — `engine/engine.js:288-293` · CODE
- En duel, à chaque étape, le moteur vérifie toutes les 0,1 s qu'il n'y a pas de contact avec le robot adverse. Sinon : erreur « Contact avec le robot adverse ». — `engine/engine.js:1482-1488` · CODE
- Une étape impossible (pas de position, pas de passage sans contact, rotation impossible sous 350 mm) est **abandonnée** : erreur, robot immobile, temps non avancé. — `docs/CONTRATS.md:125` · CODE (contrat du moteur livré)
- Pendant l'entraînement, le contrôle de contact a posteriori (balayage complet de la trajectoire toutes les 0,1 s) est désactivé (`skipContacts: true`). Le contrôle des collisions pendant la planification reste actif. — `trainer/ppo_trainer.py:437` ; `engine/engine.js:1521` · CODE

### 2.6 L'adversaire : deux robots sur la même table (« duel »)
- Chaque robot a son propre moteur. Ils partagent le monde par trois liens — `engine/engine.js:1587-1595` · CODE :
  1. **réservation des pierres** : dès qu'un robot décide de prendre une pierre, elle lui est réservée (« premier engagé, premier servi ») ; elle disparaît de la table de l'autre au moment de la prise ;
  2. les pierres posées par l'un sont des **obstacles** pour l'autre ;
  3. **lidar** : attente de 2 s si l'autre robot est à moins de **400 mm devant** ; cases occupées évitées ; contact signalé s'ils se touchent quand même.
- Le test du lidar : l'adversaire est à moins de 400 mm du point lidar (décalé de 30 mm du centre, à l'opposé de la face A) et il se trouve dans le sens du déplacement. — `engine/engine.js:129-138` · CODE
- Avant un trajet, jusqu'à 4 attentes de 2 s (« Attente 2 s : adversaire dans le lidar »). Si l'adversaire n'a pas bougé de 40 mm, on n'attend plus. — `engine/engine.js:494-511` · CODE
- Pendant un trajet, le moteur connaît la trajectoire de l'autre. Si le robot devait passer à moins de 60 mm de lui (100 mm pendant les 6 s de travail à l'arrivée), il retarde d'abord son départ, jusqu'à 10 s par pas de 0,25 s. Sinon, il s'arrête en route par pas de 0,1 s, 8 s au plus. Sinon, l'étape est abandonnée. — `engine/engine.js:436-492` · CODE
- L'évitement est obligatoire dans le règlement (pénalité −30 pts sinon) ; « Deux réseaux face à face ne peuvent donc pas se percuter. » — `spec/regles_2027.json:389`, `:395-400` ; `docs/CONTRATS.md:152` · CODE + règlement
- **Ordre des décisions** : le robot dont l'horloge est en retard décide en premier ; à égalité, le jaune. — `engine/engine.js:1595`, `:1632-1640` · CODE
- **Équipe bleue** : le cerveau voit la table en miroir (x → 3000 − x, cap → 180 − cap, M6–M10 vus comme M1–M5). — `engine/env.js:52-59` ; `engine/engine.js:60-87` · CODE
- **Intensités** de l'adversaire : `aucun`, `faible` (vitesses × 0,7, rotation × 0,85), `realiste` (inchangé), `agressif` (× 1,2, approche × 1,15, rotation × 1,1). — `engine/engine.js:88-93` ; `trainer/scenarios.py:7-8` · CODE
- **Adversaires possibles** : une stratégie enregistrée `{program, params}` ou un cerveau MLP `{brain}`. Un adversaire « cerveau récurrent » n'est pas encore jouable. — `engine/env.js:270-280` ; `trainer/scenarios.py:45-51` ; `docs/CONTRATS.md:99` · CODE / PLANIFIÉ

### 2.7 Les boulets (canon) — [CONFIDENTIEL – hors écran pour le mécanisme]
- Le vol de chaque boulet est simulé : traînée quadratique, rebonds amortis puis roulement, rebond sur les bordures, sortie de table. — `engine/engine.js:1009-1031` · CODE
- La vitesse de sortie est calculée par dichotomie pour atteindre le point visé, puis une dispersion reproductible est appliquée à chaque tir (±5 % de vitesse, ±2° d'azimut, ±2° d'élévation par défaut). — `engine/engine.js:35`, `:1068-1089` · CODE
- Les paramètres balistiques sont des **hypothèses héritées**, pas des mesures. — `engine/engine.js:34` · CODE (statut indiqué dans le code)
- Tir autorisé seulement pour t ∈ [85, 100] s. Tirer depuis la salle du trône est un **paramètre** (`tirDepuisTrone`), pas une règle. — `docs/CONTRATS.md:43-44` ; `engine/engine.js:1052-1063` · CODE

---

## 3. Ce que le réseau perçoit : l'observation (56 nombres)

### 3.1 Les 10 groupes
La liste des groupes est définie dans `engine/env.js:4-16`. Le calcul est fait par `observe` (`engine/env.js:74-142`). Le total est **56** (MESURÉ-ici : `nInputs = 56` renvoyé par le worker, script `versions.js`).

| Indices | Groupe | Ce qui est encodé | Normalisation dans `observe` | Source |
|---|---|---|---|---|
| 0 | temps | Temps restant | (100 − t) / 100, borné à ≥ 0 | `engine/env.js:81` |
| 1–4 | robot | Pose du robot | x / 3000, y / 2000, cos(cap), sin(cap) ; repère miroir pour le bleu | `engine/env.js:82-85`, `:54-58` |
| 5–14 | paquets | Pierres restantes dans P1 à P10, selon la **croyance** (§3.3) | valeur / 3 (3 par défaut) | `engine/env.js:86-88`, `:144-151` |
| 15–20 | faces | Pour A puis B : nombre de pierres tenues, pile « à plat », tient le Graal | n / 3 ; 0 ou 1 ; 0 ou 1 | `engine/env.js:89-95` |
| 21–29 | constructions | M1 à M5 (0 vide, 0,5 mur, 1 porte) ; T1 à T4 (0 ou 1) | déjà dans [0, 1] | `engine/env.js:96-100`, `:61-71` |
| 30–33 | graal | Au départ, tenu, posé, niveau / 4 | 0 ou 1 ; niveau / 4 | `engine/env.js:101-110` |
| 34 | boulets | Séance de tir déjà faite | 0 ou 1 | `engine/env.js:111` |
| 35–36 | adversaire | Position adverse « vue par le lidar » | x / 3000, y / 2000 (miroir pour le bleu) ; (0, 0) sans adversaire | `engine/env.js:112-115`, `:306` |
| 37–47 | proprioception | Pour A puis B : 3 ventouses (vide ou non), rotation / 90, hauteur du chariot / 350 ; puis rayon de l'enveloppe / 350 **[CONFIDENTIEL – libellé hors écran]** | voir colonne précédente | `engine/env.js:116-124` |
| 48–55 | spatial | Dégagement dans 8 directions relatives au cap (tous les 45°) | distance libre / 1000 ; pas de 50 mm jusqu'à 1000 mm ; arrêt au bord de table (70 mm) ou au premier obstacle | `engine/env.js:125-139` |

Exemple mesuré à t = 0, robot jaune, sans adversaire (MESURÉ-ici, script `obs_graal.js`) : temps = 1 ; robot = (0,083 ; 0,5 ; 1 ; 0) ; graal = (1, 0, 0, 0) ; adversaire = (0, 0) ; rayon d'enveloppe = 0,607, soit 212,4 mm ; 29 actions valides sur 130.

### 3.2 Seconde normalisation, dans le réseau
- Avant d'entrer dans le réseau, chaque entrée est recentrée et mise à l'échelle par des statistiques glissantes, puis bornée : `obs_n = clip((obs − moyenne) / écart-type, −5, +5)`. — `trainer/models.py:7-9`, `:132-138` · CODE
- La moyenne et l'écart-type sont mis à jour après chaque mise à jour PPO (algorithme parallèle de Chan, en float64). Ils sont figés pendant un rollout. — `trainer/models.py:28-47` ; `trainer/ppo_trainer.py:7-9`, `:298-300` · CODE
- Ces statistiques sont **intégrées au fichier ONNX** : le robot envoie l'observation brute. — `trainer/FORMAT_MODELE.md:17`, `:39` · CODE

### 3.3 La notion de croyance (paquets)
- **Aujourd'hui (code)** : au départ, la croyance vaut 3 pierres pour chaque paquet. Elle passe à 0 quand **notre** robot exécute « prendre » sur ce paquet, que la prise réussisse ou non. Le libellé le dit : « croyance : inchangé tant qu'on n'y va pas ». — `engine/env.js:8`, `:144-151` · CODE
- Conséquence : le réseau **ne voit pas** qu'un paquet a été vidé par l'adversaire tant qu'il n'y est pas allé lui-même. — conséquence directe de `engine/env.js:149-151` · CODE
- À l'inverse, la position de l'adversaire (entrées 35–36) est la **position exacte** tirée du moteur adverse, sans bruit. — `engine/env.js:306`, `:112-115` · CODE
- **Prévu** : une croyance calculable par le robot, avec ce que voient les caméras A et B et l'âge de l'information. Les fonctions `ENV.observeBelief(belief)` et `ACTIONS.maskBelief(belief, catalogue)` seraient appelées à l'identique par le simulateur et par le runner embarqué. — `docs/CONTRATS.md:76-79` ; `AUDIT_SIMULATEUR_IA.md:259`, `:314` · PLANIFIÉ. Ces fonctions n'existent pas encore dans `engine/actions.js` ni `engine/env.js` (MESURÉ-ici : recherche sans résultat).
- Perception réelle déclarée : lidar (triangulation de la pose + position adverse) et une caméra par face de préhension (A et B), recalée sur les tags ArUco. — `spec/robot.json:318-323` · DÉCLARÉ. Modèle du lidar et champ des caméras : **À DÉFINIR** (`spec/robot.json:322-323`).

### 3.4 Défauts connus de l'observation actuelle
- **Groupe « graal » décalé par rapport au moteur 2.0.0** : `observe` reconnaît les états `held`, `free` et `ride` (`engine/env.js:102`), alors que le moteur utilise `home`, `ascenseur`, `toit` et `retire` (`engine/engine.js:151`). Mesure : après `monterGraal`, le moteur indique `toit`, et l'observation graal vaut **(0, 0, 0, 0)**, exactement comme un Graal retiré de la table (MESURÉ-ici, script `obs_graal.js`).
- L'indicateur « tient le Graal » des faces A/B (`engine/env.js:93`) correspond à une prise du Graal par les pinces A/B, qui a été supprimée (`docs/CONTRATS.md:54`, `:121`). **[À CONFIRMER]** auprès du chantier actions-env : cette entrée peut-elle encore valoir 1 ?
- Le groupe « spatial » utilise la pose réelle de la table (`sim.pose()`, `engine/env.js:126`), pas la pose miroir du bleu. L'audit l'avait signalé (« le radar JS n'est pas passé en miroir », `AUDIT_SIMULATEUR_IA.md:105`). · CODE
- Les empreintes de version ne détectent pas ces changements de sens : elles sont calculées sur les **descriptions** des groupes (`id`, `n`, `desc`), pas sur le comportement (`trainer/FORMAT_MODELE.md:68-70`). Mesure : l'empreinte d'observation est la même aujourd'hui (moteur 2.0.0) qu'au moment de l'entraînement de fumée (moteur 1.3.0), `empreinte:0674f241f0ab4e76` (MESURÉ-ici, `versions.js` ; `.data/modeles/fumee.meta.json`).

---

## 4. Ce que le réseau peut décider : le catalogue des 130 actions

### 4.1 Familles et nombres
Construction du catalogue : `engine/actions.js:39-104`. Contrôle « 130 actions » : `engine/actions.js:107`. Compte par famille : MESURÉ-ici (worker réel, `versions.js`), identique à `engine/actions.js:23-37`.

| Indices | Famille | Nombre | Détail | Ligne | Étape connue du moteur 2.0.0 ? |
|---|---|---|---|---|---|
| 0–19 | prendre | 20 | 2 faces × 10 paquets | `actions.js:41-44` | oui |
| 20–39 | mur | 20 | 2 faces × 5 zones M1–M5 × 2 côtés (ext/int) | `:45-50` | oui |
| 40–63 | tour | 24 | 2 faces × 4 tours × 3 rangs de pierre | `:51-56` | oui |
| 64–83 | porte | 20 | 2 faces × 5 zones × 2 côtés | `:57-62` | oui |
| 84 | boulets | 1 | séance de tir | `:63-64` | oui (étape `tir`) |
| 85–86 | prendreGraal | 2 | par face A ou B | `:65-66` | **non** : « Action inconnue. » (`docs/CONTRATS.md:121`) |
| 87–104 | poserGraal | 18 | 2 faces × 9 zones (M1–M5, T1–T4) | `:67-70` | **non** : « Action inconnue. » (`docs/CONTRATS.md:121`) |
| 105 | trone | 1 | aller dans la salle du trône | `:71-72` | oui |
| 106–111 | staging | 6 | dépôt relais SN/SS/SC × 2 faces | `:74-79` | **non** : « Action inconnue. » (MESURÉ-ici) |
| 112–117 | repickup | 6 | reprise relais × 2 faces | `:81-86` | **non** : « Paquet inconnu. » (MESURÉ-ici) |
| 118–125 | traj | 8 | trajet vers un des 8 carrefours | `:88-91`, `:11-20` | oui |
| 126–127 | tournerPince | 2 | rotation 0° ↔ 90° d'une face | `:93-96` | oui |
| 128–129 | deposerZone | 2 | lâcher le contenu d'une face | `:98-101` | oui |
| | **Total** | **130** | | `:107` | **32 actions sur 130 ne peuvent jamais réussir** |

- L'étape **`monterGraal`** (Graal sur le toit, niveau 4, 25 pts possibles) existe dans le moteur (`engine/engine.js:1354`, `docs/CONTRATS.md:122`), mais **n'est pas dans le catalogue**. Le réseau ne peut donc pas la choisir aujourd'hui. — `engine/actions.js:39-104` · CODE
- L'alignement du catalogue sur le moteur livré revient au chantier actions-env (`docs/CONTRATS.md:19`, `:94-99`). · PLANIFIÉ

### 4.2 Le masque : pourquoi et comment
- **Pourquoi** : le masque doit n'exprimer « que ce qui est physiquement ou réglementairement possible ». — `docs/CONTRATS.md:80` ; `AUDIT_SIMULATEUR_IA.md:227` · PROPOSÉ / contrat
- **Comment, dans le réseau** : les logits des actions masquées sont mis à −1e9 avant le softmax, ce qui leur donne une probabilité nulle en float32. — `trainer/models.py:22-23`, `:70-73` · CODE
- **Comment, côté règles** : `ACTIONS.valid(act, sim)` — `engine/actions.js:596-658` · CODE :
  - les trajets qui traversent des pierres sont refusés (`hitsCrates`, `:597`) ;
  - **budget de temps** : l'action est refusée si le robot ne peut plus, ensuite, rentrer au trône et tirer avant 100 s. Le calcul utilise 500 mm/s et des durées mécaniques forfaitaires (prendre 1,8 s, mur 1,6 s, tour 2,2 s, porte 4,8 s…) (`:599-627`) ;
  - puis des conditions par famille (face vide, pile à plat, zone libre, une porte par château, boulets après 80 s…) (`:629-657`) ;
  - « prendre Pn » est permis tant qu'il reste des pierres du paquet n dans sa carrière **ou posées à plat et empilées ailleurs**, y compris dans un mur déjà construit (`:184-240`, en particulier `:212-239`). Conséquence mesurée : §9.1 (b).
- Le masque n'appelle pas `sim.preconditions` (MESURÉ-ici : aucune occurrence dans `engine/actions.js`), alors que le contrat le demande (`docs/CONTRATS.md:60`, `:80`).
- Un second filtre, `liveMask`, ajoute des règles de **stratégie** : pas de trône avant 88 s s'il reste à jouer, retour au château interdit avant 75 s quand une face est pleine et l'autre vide (« double face »), anti-répétition. — `engine/env.js:153-196`, `:427` · CODE
  - Il est appliqué quand le cerveau joue un match complet (`ENV.play`, `brainAgent` : simulateur web et adversaires MLP), mais **pas** pendant l'entraînement PPO, où le worker renvoie le masque brut de `ENV.step`. — `engine/env.js:426`, `:241` ; `engine/env_worker.js:140-168` · CODE
  - Le simulateur web (`plateau/`) fait jouer un cerveau avec `ENV.play`, en ajoutant `filterSafety: true` : chaque action choisie est d'abord essayée sur une copie du monde, et elle est retirée si elle produit une erreur ou une collision. — `plateau/app.js:433-437` ; `engine/env.js:394-416`, `:434-442` · CODE. Ce que l'on voit dans le simulateur web n'est donc pas exactement ce que le réseau a vécu pendant son entraînement.
  - L'audit demande de retirer ces règles de stratégie (`AUDIT_SIMULATEUR_IA.md:122-123`, `:227`). · PLANIFIÉ

### 4.3 Le masque dit-il la vérité ? (mesure)
Politique aléatoire uniforme sur les actions déclarées valides, moteur 2.0.0, sans adversaire, 40 matchs, 1178 décisions (MESURÉ-ici, script `masque_vs_moteur.js`) :

- **779 décisions sur 1178 (66 %) produisent une erreur moteur**, alors que le masque les déclarait valides. L'audit mesurait 52 % sur l'ancien moteur (`AUDIT_SIMULATEUR_IA.md:17`). L'objectif fixé est moins de 2 % (`AUDIT_SIMULATEUR_IA.md:225`), et 0 erreur sur 10 000 états (`:233`).

| Famille | Choisies | En erreur |
|---|---|---|
| repickup | 114 | 114 (« Paquet inconnu. ») |
| prendreGraal | 37 | 37 (« Action inconnue. ») |
| staging | 34 | 34 (« Action inconnue. ») |
| boulets | 33 | 30 |
| porte | 51 | 45 |
| tour | 180 | 145 |
| trone | 78 | 51 (dont 50 « aucun passage sans contact trouvé ») |
| traj | 181 | 107 |
| tournerPince | 132 | 73 (dont 32 « rotation impossible sous 350 mm ») |
| deposerZone | 55 | 27 |
| prendre | 217 | 92 |
| mur | 66 | 24 |

- Sens inverse aussi : en rejouant `ENGINE.PROGRAMME_REFERENCE` (0 erreur moteur), 4 des 13 actions jouées sont **déclarées invalides** par le masque au moment où elles réussissent (« Mur M1 · int », « Mur M5 · int », « Porte M3 · int », « Lâcher les boulets »). (MESURÉ-ici, script `imitation_trace.js`)
- Pendant ces 40 matchs : 29,4 décisions par match, 1 match tronqué à 80 décisions. (MESURÉ-ici)

---

## 5. L'architecture réelle du réseau

### 5.1 Schéma (code)
Source : `trainer/models.py:1-13`, `:76-155` ; formule dans `trainer/FORMAT_MODELE.md:14-30`.

```
obs (56) ─► normalisation intégrée : clip((obs − moyenne) / écart-type, −5, +5)
         ─► encodeur : Linéaire 56→128 ─► LayerNorm(128) ─► SiLU
         ─► GRUCell(128 → 128)  ◄── état caché h (128), remis à zéro au début du match
              ├─► acteur   : Linéaire 128→130  ─► 130 logits ─► masque (hors réseau) ─► argmax ou tirage
              └─► critique : Linéaire 128→128 ─► SiLU ─► Linéaire 128→1 ─► valeur (sert seulement à l'apprentissage)
```

- **Valeurs par défaut** : `hidden = 128`, `encodeur = (128,)`, `acteur = ()` (aucune couche cachée), `critique = (128,)`, `activation = silu`, `layernorm = oui`, `clip_obs = 5`. — `trainer/models.py:89-100` ; `trainer/README.md:105` · CODE (« hypothèses de départ, à régler par l'équipe », `trainer/models.py:79`)
- **SiLU** : `x · sigmoïde(x)`. — `trainer/FORMAT_MODELE.md:23`
- **LayerNorm** : `(x − moyenne) / √(variance + eps) · γ + β`, sur la dernière dimension, eps = 1e-5. — `trainer/FORMAT_MODELE.md:24` ; eps mesuré dans `.data/modeles/fumee.json` (MESURÉ-ici)
- **GRUCell** (convention PyTorch, portes r, z, n) — `trainer/FORMAT_MODELE.md:25-30` :
  `r = σ(Wᵢᵣx + bᵢᵣ + Wₕᵣh + bₕᵣ)` ; `z = σ(Wᵢ_z x + bᵢ_z + Wₕ_z h + bₕ_z)` ; `n = tanh(Wᵢₙx + bᵢₙ + r ⊙ (Wₕₙh + bₕₙ))` ; `h' = (1 − z) ⊙ n + z ⊙ h`.
- **Initialisation** : poids orthogonaux (gain √2), biais nuls ; sortie de l'acteur à gain 0,01 (politique presque uniforme au départ) ; sortie de la critique à gain 1. — `trainer/models.py:122-129` · CODE
- **Une seule tête de politique** ; plus de têtes « approche » ni « pliage », plus d'encodeur Transformer. — `trainer/models.py:10` ; `docs/CONTRATS.md:84` · CODE

### 5.2 Nombre de paramètres : calcul
| Bloc | Calcul | Paramètres |
|---|---|---|
| Encodeur, Linéaire 56→128 | 56 × 128 + 128 | 7 296 |
| LayerNorm(128) | 128 (γ) + 128 (β) | 256 |
| GRUCell 128→128 | W_ih 3·128·128 + W_hh 3·128·128 + b_ih 384 + b_hh 384 | 99 072 |
| Acteur, Linéaire 128→130 | 128 × 130 + 130 | 16 770 |
| **Sous-total « politique » (exportée en ONNX et JSON web)** | | **123 394** |
| Critique, Linéaire 128→128 | 128 × 128 + 128 | 16 512 |
| Critique, Linéaire 128→1 | 128 + 1 | 129 |
| **Total entraînable** | | **140 035** |
| Tampons de normalisation (moyenne, écart-type : 2 × 56, non entraînés) | | 112 |

### 5.3 Vérification sur les fichiers du dépôt (MESURÉ-ici)
- `.data/modeles/fumee.pt`, lu sans PyTorch (script `lire_pt.py`) : `encoder` 7 552, `gru` 99 072, `actor` 16 770, `critic` 16 641, soit **140 035** paramètres entraînables, plus 112 valeurs de tampons. L'architecture enregistrée est `{n_in: 56, n_out: 130, hidden: 128, encodeur: [128], acteur: [], critique: [128], activation: silu, layernorm: true, clip_obs: 5}`.
- `.data/modeles/fumee.json` (format web, script Node) : formes `[56,128]`, LayerNorm `[128]`, GRU `[128,384]` × 2, acteur `[128,130]` ; total **123 394**. C'est la politique seule : « La critique n'est pas exportée, car elle n'est pas utile pour jouer. » (`trainer/FORMAT_MODELE.md:90`).
- Tailles des fichiers : `fumee.onnx` 497 261 octets ; `fumee.json` 2 697 475 octets ; `fumee.pt` 1 716 917 octets.

---

## 6. L'apprentissage

### 6.1 Vue d'ensemble
1. **Imitation** (démarrage à chaud) : le réseau apprend à reproduire les décisions d'un ou plusieurs programmes joués dans le moteur JS.
2. **PPO récurrent** : le réseau joue des matchs dans le moteur JS. Il renforce les décisions qui ont fait gagner des points.
3. **Évaluation** dans le moteur JS sur des matchs fixés. Seule cette évaluation sert à choisir le **champion**.
4. **Export** du champion (ONNX + meta + JSON web).

Le tout est lancé par `python -m trainer.ppo_trainer … --imitation-exemple …` (`trainer/README.md:30-33`), ou par l'API (`trainer/trainer.py:1-10`).

### 6.2 Imitation — `trainer/imitation.py`
- **Démonstrations** : chaque programme est rejoué dans le moteur par la commande `imitate_trace` du worker. On obtient, pour chaque décision : observation, action du catalogue, masque, récompense, instant. — `trainer/imitation.py:54-76` ; `engine/env_worker.js:39-42`, `:170-212` · CODE
- **Perte** : entropie croisée **masquée**. Une cible invalide sous le masque est ignorée et comptée. — `trainer/imitation.py:4-6`, `:131-133`, `:151-154` · CODE
- **Valeur** : la cible est le retour réel de la démonstration (somme des récompenses restantes), mis à l'échelle. — `trainer/imitation.py:7`, `:79-85`, `:115-117`, `:132` · CODE
- **Séquences** : chaque démonstration est déroulée comme une séquence, avec un état caché remis à zéro au début. — `trainer/imitation.py:8-9`, `:139-140`, `:151` · CODE
- **Réglages par défaut** : Adam, lr 1e-3, 200 époques, 16 démonstrations par lot, coefficient de valeur 0,5, écrêtage du gradient à 0,5. — `trainer/imitation.py:88-103`, `:141` ; `trainer/README.md:106` · CODE (hypothèses)
- **Programme imité par `--imitation-exemple`** : `ENV.EXAMPLE` (`trainer/imitation.py:49-51` ; `trainer/ppo_trainer.py:419`, `:460-461`). Dans le moteur 2.0.0, ce programme fait **74 pts avec 6 erreurs** (MESURÉ-ici, `references.js`), dont 2 « Action inconnue. » (`prendreGraal`, `poserGraal`) ; même chiffre dans `docs/CONTRATS.md:133`. Le contrat recommande d'utiliser `ENGINE.PROGRAMME_REFERENCE` à la place (`docs/CONTRATS.md:133`). · CODE + MESURÉ-ici
- Ce que donnent les deux programmes, rejoués comme démonstrations dans le moteur actuel (MESURÉ-ici, `imitation_trace.js`) :

  | Programme | Briques | Décisions imitables | Cibles invalides sous le masque | Score renvoyé par `imitate_trace` | Erreurs |
  |---|---|---|---|---|---|
  | `ENV.EXAMPLE` | 14 | 14 | 5 | 39 | 6 |
  | `ENGINE.PROGRAMME_REFERENCE` | 15 | 13 | 4 | 61 | 0 |

  - Pour `PROGRAMME_REFERENCE`, deux briques n'ont pas d'équivalent dans le catalogue et ne deviennent pas des décisions : la prise d'une pierre seule (`mode: 'pierre'`) et `monterGraal`.
  - Le score renvoyé (39 et 61) est calculé à T ≈ 89,8 s, donc **sans** trône, Graal ni boulets. Le worker évalue en effet à `min(T, 100)` (`engine/env_worker.js:75-77`) et le score de ces éléments ne compte qu'à 100 s (`engine/score.js:131-132`). Évalués à 100 s, les mêmes programmes font 74 et 116 pts (`references.js`). Conséquence (CODE) : les récompenses des démonstrations, donc les cibles de valeur de l'imitation, ne contiennent pas ces points de fin de match.

### 6.3 PPO récurrent — `trainer/ppo_trainer.py`
**Récompense**
- La récompense d'une décision est la **différence de score** avant et après la brique. — `engine/env.js:357-360` · CODE
- Contrat : la somme des récompenses d'un épisode doit égaler le score officiel final, moins des pénalités configurables. — `docs/CONTRATS.md:75` · CODE / contrat
- Après le choix du trône, le moteur fait attendre jusqu'à 80 s (si les boulets restent à tirer) ou jusqu'à 100 s, et ajoute la variation de score. — `engine/env.js:363-374` · CODE
- Pénalités côté entraîneur : `penalite_erreur` et `penalite_invalide`, à **0** par défaut. — `trainer/ppo_trainer.py:67-69`, `:156-166` · CODE
- Les pénalités côté environnement (`cfg.recompense`) sont **ignorées** aujourd'hui. — `docs/CONTRATS.md:97` · CODE (constat du chantier)
- γ = 1,0 : l'objectif est le score final, une somme non actualisée. — `trainer/ppo_trainer.py:55` ; `trainer/README.md:100` · CODE

**Collecte**
- N = processus × environnements par processus. On collecte `rollout` pas dans chaque environnement. L'action est **tirée au hasard** selon la politique masquée. Remise à zéro automatique en fin d'épisode, avec un nouveau scénario tiré. — `trainer/ppo_trainer.py:168-221` · CODE

**Avantages (GAE)**
- δₜ = rₜ + γ·V(sₜ₊₁)·(1 − finₜ) − V(sₜ) ; Aₜ = δₜ + γλ·(1 − finₜ)·Aₜ₊₁ ; cible de valeur = Aₜ + V(sₜ). Les récompenses sont divisées par l'écart-type glissant des retours. — `trainer/ppo_trainer.py:223-236`, `:152-153`, `:199-202` · CODE
- Un épisode tronqué (80 décisions) est traité comme terminé (hypothèse). — `trainer/ppo_trainer.py:232` · CODE

**Perte et optimisation**
- Ratio = exp(log π_nouveau − log π_ancien) ; perte de politique = moyenne de max(−A·ratio, −A·clip(ratio, 1 − 0,2, 1 + 0,2)) ; avantages normalisés par mini-lot. — `trainer/ppo_trainer.py:261-267` · CODE
- Perte de valeur avec écrêtage optionnel (activé par défaut). — `trainer/ppo_trainer.py:268-272` · CODE
- Perte totale = politique + 0,5 × valeur − coefficient d'entropie × entropie. — `trainer/ppo_trainer.py:273` · CODE
- Écrêtage du gradient à 0,5 ; Adam (eps 1e-5) ; le GRU est re-déroulé sur toute la séquence à chaque mini-lot (`forward_sequence`). — `trainer/ppo_trainer.py:100`, `:259`, `:276` ; `trainer/models.py:157-177` · CODE

**Hyperparamètres par défaut** (« des HYPOTHÈSES de départ (pratiques PPO usuelles), pas des valeurs mesurées sur ce problème », `trainer/ppo_trainer.py:42-43`) — `trainer/ppo_trainer.py:40-83` :

| Paramètre | Défaut |
|---|---|
| processus × environnements par processus | 1 × 4 (en ligne de commande : nombre de threads − 1, `trainer/ppo_trainer.py:394`, `trainer/README.md:99`) |
| rollout (pas par environnement et par mise à jour) | 32 |
| mises à jour | 100 |
| lr → lr_fin (linéaire) | 3e-4 → 0 |
| γ, λ (GAE) | 1,0 ; 0,95 |
| clip | 0,2 |
| coefficient de valeur | 0,5 |
| entropie → entropie_fin | 0,01 → 0,01 |
| époques, mini-lots | 4 ; 2 |
| écrêtage du gradient | 0,5 |
| normalisation des observations et des retours | oui ; oui |
| sauvegarde | toutes les 10 mises à jour |
| matchs d'évaluation | 200 (`MATCHS_SELECTION`) |

### 6.4 Pool de processus Node — `trainer/js_env_pool.py`
- P processus Node × M environnements. Chaque processus exécute `engine/env_worker.js` et reçoit des commandes groupées en JSON, une par ligne. — `trainer/js_env_pool.py:1-12` ; `engine/env_worker.js:1-54` · CODE
- Le pas est parallèle : la commande est écrite à tous les processus, puis les réponses sont lues. Chaque pas attend donc le processus le plus lent. — `trainer/js_env_pool.py:7` ; `trainer/README.md:87-89` · CODE
- Dimensions, catalogue et versions sont lus dans l'environnement au démarrage ; rien n'est codé en dur. — `trainer/js_env_pool.py:11-12` ; `trainer/README.md:5` · CODE
- Délai maximal de réponse d'un processus : 120 s (hypothèse) ; troncature à 80 décisions (hypothèse). — `trainer/js_env_pool.py:34-38` · CODE
- Le GPU, s'il existe, ne sert qu'au réseau. — `trainer/README.md:3` · CODE

### 6.5 Adversaires et scénarios — `trainer/scenarios.py`
- Un scénario = `{seed, intensite, opponentRef?}`. L'adversaire est soit une stratégie enregistrée, soit un cerveau MLP. — `trainer/scenarios.py:1-8` · CODE
- À l'entraînement, intensité et adversaire sont tirés au hasard ; à l'évaluation, ils sont pris en tourniquet, avec les graines 10 000 + k, pour que deux modèles soient comparés sur les mêmes matchs. — `trainer/scenarios.py:86-95` · CODE
- Intensité par défaut à l'entraînement : `aucun`, c'est-à-dire sans adversaire. — `trainer/ppo_trainer.py:77` · CODE
- Prévu : référence en miroir, stratégies enregistrées et réseaux en self-play. — `docs/CONTRATS.md:151` · PLANIFIÉ. Le self-play récurrent n'est pas encore possible (`trainer/scenarios.py:49-51`).

### 6.6 Évaluation sur au moins 200 matchs — `trainer/evaluation.py`
- 200 matchs par défaut (`MATCHS_SELECTION`, « critère de sortie de la phase 3 de l'audit »). — `trainer/evaluation.py:31-32` ; `AUDIT_SIMULATEUR_IA.md:247` · CODE
- Politique **gloutonne** (argmax des logits masqués) par défaut. — `trainer/evaluation.py:83-84` · CODE
- Rapport : moyenne, écart-type, min, max, intervalle de confiance à 95 % (1,96 · σ / √n), victoires, égalités, défaites, erreurs moteur par match, crashs, troncatures, détail du score, résultats par adversaire, débit. — `trainer/evaluation.py:35-41`, `:113-148` · CODE
- **Limite constatée** : pour un même adversaire, le moteur est déterministe, donc tous les matchs sont identiques. Écart-type de 0 sur 24 matchs, « parce que le moteur est déterministe pour un même adversaire ». — `trainer/README.md:74` ; `.data/modeles/fumee.eval.json:3-9` · MESURÉ-dépôt. **[À CONFIRMER]** : quels aléas (positions de départ, durées, vitesses) l'équipe veut introduire pour que 200 matchs soient 200 matchs différents ? L'audit propose des « aléas de durée des actionneurs et de vitesse » (`AUDIT_SIMULATEUR_IA.md:246`).

### 6.7 Choix du champion
- Après chaque évaluation, le modèle devient champion si sa **moyenne de score** dépasse celle du meilleur précédent, à protocole identique. — `trainer/ppo_trainer.py:314-349` (comparaison `:334`) · CODE
- Le champion est alors sauvegardé (`<B>.pt`) et exporté (`<B>.onnx`, `.meta.json`, `.json`, `.eval.json`). — `trainer/ppo_trainer.py:336-345` ; `trainer/README.md:53-56` · CODE
- Le contrat demande une sélection « uniquement sur une évaluation dans le moteur JS contre des adversaires », avec moyenne, écart-type, nombre de matchs et taux de victoire. — `docs/CONTRATS.md:90`. Le code compare seulement la moyenne ; les autres grandeurs sont rapportées, pas utilisées pour choisir. · CODE

### 6.8 Reprise
- Un entraînement peut reprendre depuis `<B>.dernier.pt` (poids, optimiseur, statistiques, compteur). Il est refusé si les versions d'observation ou de catalogue diffèrent. — `trainer/ppo_trainer.py:446-454` ; `trainer/README.md:35-36` · CODE

---

## 7. Débit : combien de matchs peut-on jouer ?

### 7.1 Mesures
| Mesure | Machine | Moteur | Résultat | Statut |
|---|---|---|---|---|
| Politique aléatoire, 1 cœur | machine partagée de l'audit | ancien | ≈ 0,11 match/s, ≈ 5 décisions/s | MESURÉ-dépôt (`AUDIT_SIMULATEUR_IA.md:155`) |
| `trainer.debit`, 1 / 2 / 3 processus × 4 environnements, 45 s | Xeon 2,1 GHz, 4 vCPU | 1.3.0 | 4,8 / 5,8 / 8,3 décisions/s ; 0,20 / 0,30 / 0,31 match/s ; efficacité 58 % à 3 processus | MESURÉ-dépôt (`trainer/README.md:79-89`) |
| Entraînement de fumée (PPO) | même machine | 1.3.0 | 6 à 12 décisions/s | MESURÉ-dépôt (`trainer/README.md:73`) |
| Évaluation gloutonne de la fumée, 24 matchs | même machine | 1.3.0 | 1,38 match/s ; 12,45 décisions/s ; 9 décisions par match | MESURÉ-dépôt (`.data/modeles/fumee.eval.json:92-95`) |
| Politique aléatoire, Node seul, 1 fil, 40 matchs | Xeon 2,8 GHz, 4 vCPU | 2.0.0 | 5,01 décisions/s ; 0,17 match/s ; 29,4 décisions par match | MESURÉ-ici (`masque_vs_moteur.js`) |
| Pool réel (`trainer/js_env_pool.py`), même protocole que `trainer.debit` : politique aléatoire, 4 environnements par processus, 45 s par configuration | Xeon 2,8 GHz, 4 vCPU | 2.0.0 | 1 processus : 4,49 décisions/s ; 2 : 8,15 ; 3 : 14,41 | MESURÉ-ici (`debit_pool.py`) |

Lecture prudente de la dernière ligne :
- en 45 s, seuls 6, 6 et 26 matchs se sont terminés. Les « matchs/s » (0,13 ; 0,13 ; 0,57) sont donc trop bruités pour être cités ; seule la colonne décisions/s est exploitable ;
- 3 processus donnent ici un peu plus que 3 fois 1 processus (14,41 contre 3 × 4,49 = 13,47). C'est un effet de la courte fenêtre et de la variabilité des actions, pas une accélération réelle. À refaire sur une durée plus longue avant de citer un chiffre d'efficacité.

### 7.2 Estimations (ce ne sont pas des mesures)
- Ryzen 5 3600 (12 threads), 11 processus : de ≈ 30 décisions/s (efficacité de 58 %, ≈ 1,3 match/s, ≈ 110 000 matchs/jour) à ≈ 53 décisions/s (mise à l'échelle linéaire, ≈ 2,2 matchs/s). Hypothèse : même vitesse par cœur que la machine de mesure. — `trainer/README.md:91` · ESTIMÉ
- « Plus de 100 000 matchs par jour » avec 12 workers. — `AUDIT_SIMULATEUR_IA.md:318` · ESTIMÉ
- La machine d'entraînement de l'équipe est un Ryzen 5 3600 (6 cœurs, 12 threads) + RTX 3060. — `spec/robot.json:325-327` · DÉCLARÉ. **Débit non mesuré sur cette machine** : **[À FOURNIR]**, avec `python -m trainer.debit --processus 1 2 4 6 8 11` (`trainer/README.md:47`, `:91`).
- Pourquoi la vitesse varie : la durée d'une macro-action varie beaucoup (planification A*, attente du trône), et le pas groupé attend le processus le plus lent. — `trainer/README.md:87-89` · hypothèse du dépôt

---

## 8. Du réseau entraîné au robot : export, vérification, embarqué

### 8.1 Les fichiers produits
`trainer/FORMAT_MODELE.md:5-12` ; `trainer/export_onnx.py:1-13` · CODE

| Fichier | Contenu | Utilisé par |
|---|---|---|
| `<B>.onnx` | Graphe de la politique : entrées `obs` (B, 56) et `hidden` (B, 128) ; sorties `logits` (B, 130) **non masqués** et `next_hidden` (B, 128) ; normalisation incluse ; opset 17 ; un seul fichier | Pi 5 (ONNX Runtime) |
| `<B>.meta.json` | Dimensions, versions, normalisation, catalogue complet, architecture, évaluation, vérification ONNX | Pi 5, outils |
| `<B>.json` | Poids au format web `icamlot-modele-recurrent` (matrices rangées [entrée][sortie]) | simulateur web (`cerveau/`, `plateau/`) |
| `<B>.pt` | Point de sauvegarde PyTorch complet (avec critique, optimiseur, statistiques) | entraîneur |

- Entrées et sorties du `fumee.onnx` lues par ONNX Runtime : `obs ['B', 56]`, `hidden ['B', 128]` → `logits ['B', 130]`, `next_hidden ['B', 128]`, float32. (MESURÉ-ici, `onnx_vs_web.py`)
- Utilisation : état caché à zéro au début du match ; réinjecter `next_hidden` une fois par décision ; masquer les logits avant l'argmax. — `trainer/FORMAT_MODELE.md:31-33` · CODE
- Un runtime doit refuser un modèle dont les versions ne correspondent pas à son observation et à son catalogue. — `trainer/FORMAT_MODELE.md:72` · CODE / contrat

### 8.2 Vérifications numériques
| Vérification | Résultat | Statut |
|---|---|---|
| ONNX Runtime contre PyTorch à l'export : 5 pas récurrents, lot de 4, tolérance 1e-4 | écart maximal 2,38e-6, `ok: true` | MESURÉ-dépôt (`.data/modeles/fumee.meta.json`, champ `verification_onnx`) |
| Même vérification, chiffre du README | « écart ONNX Runtime / PyTorch de 3,6e-7 » | MESURÉ-dépôt (`trainer/README.md:75`). **[À CONFIRMER]** : il ne correspond pas au fichier meta versionné (2,38e-6). |
| ONNX Runtime contre format web recalculé en NumPy (formules de `trainer/FORMAT_MODELE.md:16-30`), 20 pas récurrents, lot de 4 | écart maximal **3,3e-6** | MESURÉ-ici (`onnx_vs_web.py`) |
| Runtime web du navigateur (`cerveau/runtime.js`) contre `web_forward` Python | 7 tests sur 7 réussis ; écart maximal 5,3e-15 | MESURÉ-ici (`node tests/test_web_runtime.js`) |
| Latence d'une décision, ONNX Runtime, lot 1, 2 threads | moyenne 0,052 ms ; médiane 0,048 ms ; p99 0,121 ms — **sur Xeon x86, pas sur Raspberry Pi 5** | MESURÉ-ici (`onnx_vs_web.py`) |
| Latence sur Raspberry Pi 5 | — | **[À FOURNIR]** (non mesurée) |

### 8.3 Cible embarquée : déclaré contre réalisé
- **Déclaré** : Raspberry Pi 5 + 2 ESP32, non représentés dans la CAO. — `spec/robot.json:328-331` ; `AUDIT_SIMULATEUR_IA.md:343` · DÉCLARÉ
- **Répartition décrite dans le code** : ESP32 n° 1 = navigation (asservissement, odométrie, gyromètre) ; ESP32 n° 2 = actionneurs ; Pi 5 = IA (ONNX), lidar adverse et chef d'orchestre en temps masqué. — `esp32_bridge.py:2-8` · CODE **[CONFIDENTIEL – détail des actionneurs hors écran]**
- **`esp32_bridge.py`** : protocole texte sur port série, à 115 200 bauds par défaut. Il comprend un mode simulé qui répond « OK <commande> » sans matériel. Il traduit une action en `PREPARE…` / `GOTO x y θ` / `EXECUTE…`. — `esp32_bridge.py:29-41`, `:67-71`, `:116-201` · CODE. Aucun code des ESP32 (firmware) n'est dans le dépôt : MESURÉ-ici (`git ls-files`, aucun fichier `.ino`, `.c`, `.cpp` ni `platformio`). **[À FOURNIR]**
- **`pi5_runner.py`, état actuel** (dernière modification le 2026-10-27, avant l'audit) :
  - observation en **37** entrées et masque de **106** actions (`pi5_runner.py:93`, `:107`, `:302`, `:400`) ;
  - modèle par défaut `.data/weights/best_brain_pi5.onnx` (`:30`), déplacé depuis dans `.data/legacy/` (`docs/CONTRATS.md:107-109`) ;
  - mesure : `python pi5_runner.py --benchmark` s'arrête sur « Modèle ONNX introuvable » ; avec `--model .data/modeles/fumee.onnx`, ONNX Runtime refuse l'entrée : « index: 1 Got: 37 Expected: 56 ». (MESURÉ-ici) L'audit avait fait le même constat (`AUDIT_SIMULATEUR_IA.md:51-57`) ;
  - le mode `--simulate` importe `trainer.torch_engine`, supprimé (`pi5_runner.py:563-564` ; `docs/CONTRATS.md:109`) ;
  - `self.hidden = outputs[1]` (`pi5_runner.py:481`) : avec le format actuel, `outputs[1]` est bien `next_hidden` (ordre mesuré ci-dessus) ; avec l'ancien modèle à 4 sorties, c'étaient des logits (`AUDIT_SIMULATEUR_IA.md:56`).
- **Prévu** : runner réécrit pour 56 entrées, 130 actions et l'état caché, qui appelle les mêmes fonctions d'observation et de masque que le simulateur (via Node) ; croyance construite à partir du lidar et des caméras ; validation en rejeu avant la table. — `AUDIT_SIMULATEUR_IA.md:256-260` ; `docs/CONTRATS.md:79` · PLANIFIÉ (mars 2027, §9.3)
- Cohérence du temps masqué entre la simulation et `esp32_bridge.py` : test à écrire. — `docs/CONTRATS.md:117` · PLANIFIÉ

---

## 9. État actuel, honnêtement

### 9.1 Ce qui existe et fonctionne (vérifié)
- **Moteur de référence 2.0.0** : `PROGRAMME_REFERENCE` fait 116 pts seul et 108 pts en duel miroir (MESURÉ-ici) ; `node tests/test_moteur.js` : **83 tests réussis sur 83** en 4 s, dont « score golden 116 » (MESURÉ-ici) ; même chiffre annoncé dans `docs/CONTRATS.md:119`.
- **Chaîne d'entraînement complète** dans le moteur JS : pool Node, imitation, PPO récurrent, évaluation, choix du champion, export (fichiers listés en §6). · CODE
- **Export et runtimes** : ONNX ↔ format web cohérents à 3,3e-6 près ; runtime navigateur conforme (7 tests sur 7). (MESURÉ-ici)
- **Un seul modèle entraîné : l'entraînement « de fumée »** — `trainer/README.md:58-77` · MESURÉ-dépôt :
  - commande : 2 processus × 4 environnements, rollout 16, imitation de l'exemple (200 époques, 4 scénarios), 24 matchs d'évaluation, graine 1 ;
  - « C'est un entraînement de **fumée**, pas un cerveau utilisable. » Xeon 2,1 GHz, 4 vCPU, sans GPU ; durée totale 2 min 37 s ;
  - imitation : 4 démonstrations, 56 décisions, 4 cibles invalides ignorées, précision 100 % ;
  - PPO : **6 mises à jour**, 768 transitions, 70 épisodes ; KL ≤ 0,0014 ;
  - évaluation : **76,0 ± 0,0 pts**, 0 erreur, 12 victoires sur 12 contre l'exemple (qui fait 54 pts en duel) ;
  - la politique imitée fait 76 pts et non 105 : elle diverge dès la 4ᵉ décision, à cause de `pm: 'proche'` ajouté par `toProgramStep`.
  - Vérifié dans le point de sauvegarde (MESURÉ-ici, `lire_pt.py`) : `update = 6`, `global_step = 768`, `moteur = 1.3.0`, configuration PPO enregistrée avec `mises_a_jour: 6` et `intensites: ["aucun", "realiste"]`.
  - **[À CONFIRMER]** : la commande citée dans `trainer/README.md:63` indique `--mises-a-jour 5`, alors que le point de sauvegarde enregistre 6 mises à jour et 768 transitions (6 × 2 × 4 × 16).

**Ce même cerveau de fumée, rejoué aujourd'hui dans le moteur 2.0.0** (MESURÉ-ici). Les empreintes de version étant identiques (§3.4), rien n'empêche de le charger.

(a) Protocole de son évaluation : worker d'entraînement, choix glouton, 24 matchs, graines 10 000 + k, adversaire « exemple » une fois sur deux. Script `eval_fumee_onnx.py`, avec le fichier ONNX. Hypothèse : stratégie « exemple » = `ENV.EXAMPLE` avec `params: {}`.
- Score : **26 pts** dans les 24 matchs (écart-type 0), contre 76 sur le moteur 1.3.0 ; **76 erreurs moteur par match**.
- Déroulé identique dans tous les matchs : « Prendre P1 · face A », « Prendre P9 · face B », « Mur M1 · ext · face A », « Mur M4 · ext · face B », puis **76 fois « Prendre le Graal · face B »**. Chaque fois, le moteur répond « Action inconnue. » sans faire avancer le temps (`docs/CONTRATS.md:125`).
- Le match est tronqué à 80 décisions à T ≈ 10 s. Le score est alors calculé à `min(T, 100)` (`engine/env_worker.js:75-77`), donc sans trône, Graal ni boulets : 6 pts de pierres + 20 pts de murs.
- Les « 12 victoires sur 12 » de ces duels n'ont pas de sens : l'adversaire, arrêté au même instant, n'a que 8 pts.

(b) Comme dans le simulateur web (`plateau/app.js:433-437` : `ENV.play`, `liveMask`, anti-répétition, `filterSafety`, contacts actifs). Script `fumee_plateau.js`, avec le fichier JSON web et `cerveau/runtime.js`.
- **Sans adversaire : 84 pts**, 0 erreur, 41 briques. Mais de 51,9 s à 88,7 s, soit environ 37 s, le robot **reprend 11 fois les 3 pierres de son propre mur M1 et les repose au même endroit**. Les pierres P1.1 à P1.3 changent 24 fois d'état (`fumee_boucle.js`).
- **Contre `PROGRAMME_REFERENCE` en miroir : 31 pts contre 65** pour l'adversaire. La même boucle se produit sur le mur M5 : la paire « prendre A P5 / mur A M5 ext » est jouée 24 fois de suite (54 briques au total).
- Ce que le code permet (CODE) :
  - le masque autorise à « prendre » un paquet dont les pierres sont posées à plat et empilées, ce qui inclut un mur déjà construit (`engine/actions.js:212-239`) ;
  - la règle anti-répétition n'interdit que la **même** action plus de 2 fois de suite (`engine/env.js:427`), donc pas une alternance de deux actions ;
  - le cerveau de fumée n'est « pas un cerveau utilisable » (`trainer/README.md:70`).
- **[À FOURNIR]** : quel cerveau a été filmé dans la vidéo précédente. Ce dossier ne permet pas d'affirmer que c'était celui-ci.

### 9.2 Ce qui ne fonctionne pas encore (constats vérifiés)
| Constat | Preuve | Responsable (contrat) |
|---|---|---|
| Le modèle de fumée a été entraîné sur le moteur **1.3.0** ; le moteur actuel est **2.0.0** (géométrie réelle, Graal sur le toit, score en fin de match) | `.data/modeles/fumee.meta.json` (`moteur`) ; `engine/engine.js:11` ; historique : export de la fumée au commit `e220a99` (10:38), fusion du moteur au commit `63d27dc` (11:08) | entraînement |
| 32 actions du catalogue sur 130 ne peuvent jamais réussir ; `monterGraal` absent | §4.1 (MESURÉ-ici) | actions-env |
| Le masque déclare valides des actions qui échouent : 66 % en politique aléatoire | §4.3 (MESURÉ-ici) | actions-env |
| L'observation du Graal sur le toit est (0, 0, 0, 0) | §3.4 (MESURÉ-ici) | actions-env |
| L'imitation par défaut copie `ENV.EXAMPLE`, qui fait 74 pts et 6 erreurs dans le moteur actuel | §6.2 (MESURÉ-ici) | entraînement / actions-env |
| Une action exécutée par `ENV.step` n'a pas le même effet que la brique dont elle provient (`pm: 'proche'`) | `docs/CONTRATS.md:98` ; `engine/actions.js:148-153` | actions-env |
| Pénalités de l'environnement (`cfg.recompense`) ignorées | `docs/CONTRATS.md:97` | actions-env |
| Pas d'adversaire récurrent (pas de self-play du réseau actuel) | `docs/CONTRATS.md:99` ; `trainer/scenarios.py:49-51` | actions-env |
| Matchs d'évaluation identiques pour un même adversaire (moteur déterministe) | §6.6 | **[À CONFIRMER]** |
| `pi5_runner.py` incompatible (37 entrées contre 56 ; modèle par défaut introuvable) | §8.3 (MESURÉ-ici) | embarqué |
| Pas de firmware ESP32 dans le dépôt | §8.3 (MESURÉ-ici) | **[À FOURNIR]** |
| Documentation publique (`README.md`, `PROJECT.md`) contredite par le code | §0.4 | docs-bench |

### 9.3 Ce qui est planifié — calendrier de l'audit (§6.6)
Source : `AUDIT_SIMULATEUR_IA.md:327-336` · PLANIFIÉ

| Période | Contenu | Critère de sortie |
|---|---|---|
| nov. 2026 | Phases 0-1 : spec, géométrie réelle du châssis, conformité au règlement, masque = préconditions du moteur | 0 action valide en erreur sur 10 000 états ; golden tests |
| déc. 2026 | Phase 2 : pool de workers JS + PPO ; phase 3 : adversaires | débit mesuré sur la machine de l'équipe |
| janv.-févr. 2027 | Phase 4 : entraînement, évaluation sur au moins 200 matchs par adversaire ; intégration des cotes de pinces, canon et ascenseur | score moyen et taux de victoire avec intervalle de confiance |
| mars 2027 | Phase 5 : runner embarqué, croyance issue du lidar et des caméras, essais en rejeu | même décision en simulation et sur le robot pour des états enregistrés |
| avr. 2027 | Recalage des durées et vitesses mesurées sur le robot, réentraînement, gel | écart de durée simulation/robot ≤ 10 % par action |
| mai 2027 | Compétition | — |

Avancement constaté au 2026-10-28 : la géométrie réelle, les règles 2027 et les préconditions sont dans le moteur (`docs/CONTRATS.md:119-147`, fusion `63d27dc`) ; le pool JS et le PPO existent déjà (`trainer/README.md`, fusion `d1d489e`). Le critère « 0 action valide en erreur » n'est pas atteint (§4.3).

### 9.4 Points bloquants ou ouverts
- **Toit et niveau 4 du Graal** : avec un toit à 341,2 mm, le niveau 4 est impossible sous 350 mm ; il faut un toit à 324 mm au plus (proposition : tubes de 290 mm). — `AUDIT_SIMULATEUR_IA.md:344` · point bloquant signalé. Le simulateur utilise un toit à 311,2 mm (tubes de 290 mm) — `docs/CONTRATS.md:31` · PROPOSÉ. **[À CONFIRMER]** : le robot réel sera-t-il modifié ?
- Les actionneurs atteignent 350,0 mm sans marge pendant certaines rotations : marge à décider par l'équipe. — `docs/CONTRATS.md:144` · ouvert
- Le canon sort avant 85 s ; seuls les tirs sont limités à [85, 100] s. — `docs/CONTRATS.md:145` · ouvert
- `deploy/install.sh` ne copie pas `spec/spec.js` ; `plateau/app.js` dessinait encore l'ancien triangle à la date du contrat. — `docs/CONTRATS.md:146-147` · ouvert (le commit `f8caa87` annonce depuis l'empreinte réelle dans le plateau)
- Niveau d'un Graal posé sur une porte : non défini par le règlement, à faire préciser par l'arbitrage. — `AUDIT_SIMULATEUR_IA.md:200` ; `spec/regles_2027.json:341` · ouvert
- Affectation des faces A/B/C sur la base : **À DÉFINIR** (`spec/robot.json:17-20`).
- Modèle du lidar, champ des caméras : **À DÉFINIR** (`spec/robot.json:322-323`).
- Moteurs de la base : tension et référence exacte **À DÉFINIR** (`spec/robot.json:299-302`).
- Vitesse d'approche (200 mm/s) : héritée, à valider (`spec/robot.json:309-312`).
- Débit sur la machine de l'équipe : non mesuré (§7.2).

---

## 10. Liste des informations manquantes

| # | Information | Pourquoi elle manque | Statut |
|---|---|---|---|
| 1 | Quel cerveau (fichier, date) a été filmé dans la vidéo précédente, où « le robot place les caisses n'importe comment » | Aucune trace dans le dépôt | **[À FOURNIR]** |
| 2 | Liste exacte des éléments confidentiels | §0.3 est une proposition | **[À CONFIRMER]** |
| 3 | Débit mesuré sur le Ryzen 5 3600 + RTX 3060 | Seules des estimations existent | **[À FOURNIR]** |
| 4 | Latence d'inférence sur le Raspberry Pi 5 | Mesurée seulement sur Xeon x86 | **[À FOURNIR]** |
| 5 | Firmware des ESP32, protocole réel | Absent du dépôt | **[À FOURNIR]** |
| 6 | Un entraînement réel (au-delà de la fumée) sur le moteur 2.0.0, avec son évaluation sur ≥ 200 matchs | Pas encore fait | PLANIFIÉ (janv.-févr. 2027) |
| 7 | Aléas des matchs (positions, durées, vitesses) pour que l'évaluation ne soit pas déterministe | Non décidé | **[À CONFIRMER]** |
| 8 | Paramètres de la stratégie « exemple » utilisée comme adversaire dans la fumée | `trainer/README.md:68` dit seulement « le programme `ENV.EXAMPLE` enregistré comme stratégie » | **[À CONFIRMER]** |
| 9 | Nombre de mises à jour de la fumée : 5 (commande du README) ou 6 (point de sauvegarde) | Contradiction | **[À CONFIRMER]** |
| 10 | Écart ONNX/PyTorch de la fumée : 3,6e-7 (README) ou 2,38e-6 (meta) | Contradiction | **[À CONFIRMER]** |
| 11 | Toit du robot réel (341,2 mm mesuré, 311,2 mm dans le simulateur) | Décision mécanique | **[À CONFIRMER]** |
| 12 | Modèle du lidar, champ des caméras, affectation des faces | `spec/robot.json` : `a_definir` | **À DÉFINIR** |

---

## Annexe A — Phrases vérifiées utilisables telles quelles à l'écran (avec leur source)
1. « Le réseau ne pilote pas les moteurs : après chaque action, il choisit la suivante parmi 130. » — `trainer/README.md:3` ; `engine/actions.js:107`
2. « Il voit le match à travers 56 nombres : le temps, sa position, ce qu'il tient, ce qu'il a construit, la position de l'adversaire… » — `engine/env.js:4-16`
3. « Il a une mémoire : 128 nombres qu'il transmet d'une décision à la suivante, remis à zéro au début de chaque match. » — `trainer/models.py:115`, `:141-145`
4. « Son cerveau compte 140 035 paramètres pendant l'entraînement, et 123 394 dans la version qui joue. » — §5.2-5.3 (MESURÉ-ici)
5. « Il apprend d'abord en imitant un programme, puis en jouant des matchs dans un simulateur et en renforçant ce qui rapporte des points. » — `trainer/imitation.py:1-9` ; `trainer/ppo_trainer.py:1-11`
6. « Le simulateur fait réserver chaque pierre au premier robot qui décide de la prendre, et fait attendre un robot quand l'autre est à moins de 40 cm devant lui. » — `engine/engine.js:1590-1593`
7. « Un programme figé qui marque 116 points seul n'en marque plus que 108 face à un adversaire. » — MESURÉ-ici (`references.js`)
8. « Aujourd'hui, seul un entraînement d'essai de 2 min 37 s existe ; ce n'est pas encore un cerveau utilisable. » — `trainer/README.md:70`

## Annexe B — Glossaire minimal (définitions tirées du dépôt)
- **Brique / macro-action** : une étape de programme comme `prendre`, `mur`, `porte`, `tir`, `trone` (`docs/CONTRATS.md:123`) ; une entrée du catalogue en produit une (`engine/actions.js:141-172`).
- **Masque** : vecteur de 0 et de 1, de la taille du catalogue, qui dit quelles actions sont permises (`docs/CONTRATS.md:74`).
- **Logit** : score brut d'une action en sortie du réseau, avant masque et softmax (`trainer/FORMAT_MODELE.md:31`).
- **État caché** : mémoire du GRU, de 128 nombres (`trainer/FORMAT_MODELE.md:32`).
- **Rollout** : nombre de pas collectés par environnement entre deux mises à jour (`trainer/ppo_trainer.py:47`).
- **Champion** : meilleur modèle selon l'évaluation dans le moteur JS (`trainer/README.md:55`).

## Annexe C — Mesures exécutées pour ce dossier
Toutes en lecture seule : aucun fichier de `/home/user/icamlot-audit` n'a été modifié. Scripts dans `/tmp/claude-0/-home-user-icamlot/7624d51f-7be7-5b87-ae0f-1fda87a83f3b/scratchpad/mesures/`.

| Script | Ce qu'il mesure |
|---|---|
| `lire_pt.py` | Paramètres et métadonnées de `.data/modeles/fumee.pt`, lus sans PyTorch |
| `onnx_vs_web.py` | Entrées et sorties ONNX, écart ONNX Runtime / format web, latence sur la machine de travail |
| `versions.js` | `nInputs`, `nOutputs`, empreintes, version du moteur, familles du catalogue (worker réel) |
| `references.js` | `PROGRAMME_REFERENCE` seul et en duel miroir, `ENV.EXAMPLE` seul (score à 100 s) |
| `imitation_trace.js` | Démonstrations produites par `imitate_trace` pour les deux programmes |
| `masque_vs_moteur.js` | Taux d'erreur moteur des actions déclarées valides (politique aléatoire) |
| `obs_graal.js` | Observation du Graal après `monterGraal` |
| `debit_pool.py` | Débit du pool réel (`trainer/js_env_pool.py`), 1 à 3 processus |
| `eval_fumee_onnx.py` | Le cerveau de fumée rejoué (ONNX) dans le moteur actuel, avec le protocole de son évaluation |
| `fumee_plateau.js` | Le cerveau de fumée joué comme dans le simulateur web (`ENV.play` + `filterSafety`), sans adversaire et contre la référence |
| `fumee_boucle.js` | Historique des pierres P1 et rejeu daté des briques de ce match |
| commandes directes | `pi5_runner.py --benchmark` (avec et sans `--model .data/modeles/fumee.onnx`) ; `node tests/test_web_runtime.js` ; `node tests/test_moteur.js` ; `git ls-files` ; `git status` (vérifie que le dépôt n'a pas été modifié) |
