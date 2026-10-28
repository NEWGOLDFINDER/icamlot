# Dossier factuel « Le monde physique et le robot »

Projet ICAM LOT · Eurobot 2027 (thème Camelot) · support du mini-documentaire pédagogique

- **Dépôt de référence** : `/home/user/icamlot-audit` (copie de la branche `audit/simulateur-ia`, commit `0161a45` du 2026-10-28). Aucun fichier du dépôt n'a été modifié.
- **Rédigé le** 2026-10-28 à partir des fichiers du dépôt et de mesures exécutées pour ce dossier (annexe A).
- **Fichier de mesures joint** : `/tmp/claude-0/-home-user-icamlot/7624d51f-7be7-5b87-ae0f-1fda87a83f3b/scratchpad/doc/mesures_programme_reference.json` (positions finales des pierres, chronologie, trajectoire du robot échantillonnée toutes les 0,1 s). **Usage interne** : voir §11.

## Comment lire ce dossier

| Marqueur | Sens |
|---|---|
| `chemin:ligne` | Source dans le dépôt `/home/user/icamlot-audit` |
| **[MESURE DOSSIER]** | Valeur obtenue en exécutant le moteur pour ce dossier (commandes en annexe A) |
| **[À FOURNIR]** | Information absente du dépôt : l'équipe doit la donner |
| **[À CONFIRMER]** | Information présente mais incertaine, contradictoire ou de seconde main |
| **[INTERNE – NE PAS MONTRER]** | Mécanique confidentielle : à ne jamais montrer, dire ou laisser deviner dans la vidéo publique |

Statuts des valeurs du robot, définis par le dépôt (`spec/robot.json:7-13`) :

| Statut | Définition du dépôt |
|---|---|
| mesuré | « mesuré sur la CAO » |
| déclaré | « déclaré par l'équipe » |
| hérité | « valeur actuelle du simulateur, à valider par l'équipe » |
| à définir | « information manquante : aucune valeur ne doit être inventée » |
| proposé | « conception proposée par l'audit, à valider par l'équipe » |

**Limite importante.** Le règlement officiel (`Eurobot2027_Rules_FR.pdf`, `Eurobot_General_Rules_SR_FR.pdf`), le plan `table.svg` et la CAO `Structure_robot_p.STEP` **ne sont pas dans le dépôt**. Vérification faite : aucun `.pdf`, `.svg` ni `.zip` dans `/home/user/icamlot` ni dans `/home/user/icamlot-audit`. Toutes les règles citées ici viennent donc de leur transcription dans `spec/regles_2027.json`, qui donne la section du règlement pour chaque valeur (`spec/regles_2027.json:2-6`). **[À FOURNIR]** : les PDF et le SVG, pour vérifier chaque chiffre avant diffusion.

---

## 0. L'essentiel en 12 points

1. Le dépôt rattache la compétition à la **Coupe de France de Robotique / Eurobot 2027, thème « Camelot »** (`index.html:7`, `index.html:89`). L'image de la table porte « The legend of CAMELOT » (`plateau/table.jpg`).
2. Un **match dure 100 s**. La **phase d'attaque** commence à **85 s**. La **préparation** dure au plus **180 s** (`spec/regles_2027.json:8-13`).
3. Deux équipes s'affrontent : **jaune**, à gauche (x de 0 à 500), et **bleue**, à droite (x de 2500 à 3000). Le terrain est symétrique par x → 3000 − x (`spec/regles_2027.json:21-43`, `:268`).
4. La **table** mesure **3000 × 2000 mm** (`spec/regles_2027.json:14-20`).
5. **30 pierres** de **320 × 110 × 110 mm**, d'environ 90 g, sont rangées par 3 dans **10 carrières**, P1 à P10 (`spec/regles_2027.json:91-188`).
6. Chaque château a **5 zones de mur** (M1 à M5, 400 × 200 mm) et **4 zones de tour** (T1 à T4, Ø 200 mm) (`spec/regles_2027.json:189-269`).
7. On construit des **murs** (3 pierres à plat), des **tours** (1 pierre debout) et **une porte** au plus (2 pierres debout et 1 linteau) (`spec/regles_2027.json:316-328`).
8. Le **Graal** démarre dans la salle du trône et **ne doit jamais sortir du château**. Il vaut jusqu'à 25 pts au **niveau 4**, posé sur le toit du robot (`spec/regles_2027.json:329-343`, `:365-366`).
9. **Score maximal théorique du robot principal : 134 pts**, PAMI non compris (`AUDIT_SIMULATEUR_IA.md:192-196`).
10. Le **programme de référence actuel** du moteur fait **116 pts en 90,3 s, sans erreur**. Contre son propre miroir, il tombe à **108 pts** **[MESURE DOSSIER]** (concorde avec `docs/CONTRATS.md:133` et `:150`).
11. L'ancien exemple `ENV.EXAMPLE` faisait **105 pts en 91,8 s** dans la révision auditée `4dee407`. Il ne fait plus que **74 pts, avec 6 erreurs**, dans le moteur actuel **[MESURE DOSSIER]**. **Le chiffre de « 105 pts » est donc périmé.**
12. Les pinces, les ventouses, le canon, l'ascenseur du Graal et la forme exacte du robot sont **confidentiels** (§11).

---

## 1. La compétition

| Élément | Valeur | Source |
|---|---|---|
| Nom | Coupe de France de Robotique / Eurobot 2027 | `index.html:7`, `README.md:8` |
| Thème | « Camelot » ; la table porte « The legend of CAMELOT » | `index.html:89`, `point-counter/index.html:150`, `plateau/table.jpg` (lecture de l'image) |
| Règlement de jeu | Version OFFICIELLE 1.0 | `spec/regles_2027.json:3` |
| Règlement général | Version OFFICIELLE 1.4 | `spec/regles_2027.json:4` |
| Arbitrage (contact pour les points flous) | referee@planete-sciences.org | `spec/regles_2027.json:341` |
| Logos visibles sur l'image de la table | eurobot junior, eurobot, Planète Sciences | `plateau/table.jpg` (lecture de l'image) |
| Date de la compétition | « mai 2027 » (calendrier de l'audit) | `AUDIT_SIMULATEUR_IA.md:336` |
| Lieu, date exacte, format du tournoi (séries, phases finales) | **[À FOURNIR]** | absents du dépôt |
| Origine de `plateau/table.jpg` (rendu officiel ou recréation) | **[À CONFIRMER]** ; image de 2400 × 1601 px, ajoutée le 2026-10-20 (commit `2fc9532`) | `git log -- plateau/table.jpg` |

### 1.1 Les missions

Le compteur de points du dépôt donne aux 4 familles de points les titres suivants (`point-counter/index.html:238`) :
- « Construction de Camelot » ;
- « Il n'y en a qu'un, et c'est le mien ! » (Graal) ;
- « Le retour du roi » ;
- « À l'assaut ! ».

Que ce soient les titres officiels du règlement : **[À CONFIRMER]**.

### 1.2 Déroulement d'un match

| Phase | Durée et règle | Source |
|---|---|---|
| Préparation | au plus 180 s | `spec/regles_2027.json:11` (général H.1 à H.3) |
| Départ | le robot démarre dans sa zone de départ, qui est sa salle du trône (500 × 500 mm, « ligne incluse ») | `spec/regles_2027.json:21-43` (jeu D.3) |
| Match | 100 s | `spec/regles_2027.json:9` |
| Phase d'attaque | de 85 s à la fin du match | `spec/regles_2027.json:10`, `AUDIT_SIMULATEUR_IA.md:175` (jeu E.4.b) |
| Fin du match | trône, boulets et Graal évalués à la fin ; un élément encore tenu ne compte pas ; robot qui bouge après la fin : −50 pts | `spec/regles_2027.json:325`, `:346`, `:356`, `:400` |
| Signal de départ (tirette ou autre), procédure d'homologation | **[À FOURNIR]** | absents du dépôt |

### 1.3 Les deux camps

- **Jaune** : salle du trône en x ∈ [0, 500], y ∈ [750, 1250] (`spec/regles_2027.json:22-31`).
- **Bleu** : salle du trône en x ∈ [2500, 3000], y ∈ [750, 1250] (`spec/regles_2027.json:32-41`).
- Les remparts bleus sont le miroir des jaunes, par x → 3000 − x (`spec/regles_2027.json:268`). Dans le moteur, les zones bleues s'appellent M6 à M10 et T5 à T8 (`engine/engine.js:46`, `:48`).
- Le moteur simule le jaune ; le bleu est joué en miroir (`docs/CONTRATS.md:29`).
- La couleur attribuée à ICAM LOT pour chaque match : **[À FOURNIR]** (tirage ou règle du tournoi).
- Composition d'une équipe sur la table : un « robot principal » (`point-counter/index.html:245`) et des PAMI (§3.4). Nombre de PAMI d'ICAM LOT : **[À FOURNIR]**.

---

## 2. La table

### 2.1 Dimensions et repère

| Élément | Valeur | Source |
|---|---|---|
| Aire de jeu | 3000 mm (x) × 2000 mm (y) | `spec/regles_2027.json:15-16` |
| Bordure | 70 mm de haut, 22 mm d'épaisseur | `spec/regles_2027.json:17-18` |
| Repère | celui de `table.svg` (viewBox 3000 × 2000), identique à celui du moteur | `spec/regles_2027.json:5` |

Orientation **[MESURE DOSSIER]**, lue sur l'image et le rendu 3D :
- x = 0 est le côté jaune, à gauche de `plateau/table.jpg` ;
- y = 0 est le bord des carrières P1 à P4, en haut de l'image ;
- le rendu 3D plaque l'image sur un plan de 3000 × 2000 mm (`plateau/app.js:519-521`).

### 2.2 Les zones

| Zone | Définition | Source |
|---|---|---|
| **Salle du trône** jaune | x ∈ [0, 500], y ∈ [750, 1250] ; c'est aussi la zone de départ | `spec/regles_2027.json:22-31` |
| **Château** (cour et remparts) | Polygone du moteur : (0, 295), (610, 295), (960, 640), (960, 1360), (610, 1705), (0, 1705). Le moteur le qualifie de « contour hérité de l'ancien moteur ». **[À CONFIRMER]** contre le plan officiel | `engine/engine.js:52-53` |
| **Cour** du château | Bords intérieurs des zones de mur, salle du trône comprise : (0, 500), (467, 500), (750, 783), (750, 1217), (467, 1500), (0, 1500) | `engine/engine.js:94-96` ; valeurs relues **[MESURE DOSSIER]** |
| **Écuries PAMI** jaunes | x ∈ [5, 195] ; y ∈ [5, 295] et [1705, 1995]. Le règlement indique 200 × 300 mm | `spec/regles_2027.json:44-66`, `:89` |
| **Écuries PAMI** bleues | x ∈ [2805, 2995] ; mêmes y | `spec/regles_2027.json:67-88` |
| **Douves** | « 3 par château », lecture du plan à confirmer. Leur géométrie n'est pas dans la spec : **[À FOURNIR]** | `bareme.js:23`, `bareme.js:28` |

**Ce qu'on voit sur l'image** (lecture de `plateau/table.jpg`, à faire confirmer) :
- une bande bleue (de l'eau) longe chaque château côté centre, avec 3 rectangles cernés de bleu foncé de chaque côté. Les identifier comme les douves est une interprétation : **[À CONFIRMER]** ;
- deux lignes blanches à liseré noir traversent la table. Leur rôle n'est documenté nulle part dans le dépôt : **[À CONFIRMER]**.

### 2.3 Les carrières P1 à P10

Chaque carrière contient **3 pierres à plat empilées**. Leurs contours sur le plan mesurent 319 × 109 mm. Les carrières ne sont **attribuées à aucune équipe** : prendre P3, P4, P7 ou P8, côté adverse, est permis (`spec/regles_2027.json:103-104`, `:187` ; `AUDIT_SIMULATEUR_IA.md:176`).

| Carrière | Centre (x, y) mm | Grand axe | Source |
|---|---|---|---|
| P1 | (750, 55) | x | `spec/regles_2027.json:106-113` |
| P2 | (1250, 55) | x | `spec/regles_2027.json:114-121` |
| P3 | (1750, 55) | x | `spec/regles_2027.json:122-129` |
| P4 | (2250, 55) | x | `spec/regles_2027.json:130-137` |
| P5 | (750, 1945) | x | `spec/regles_2027.json:138-145` |
| P6 | (1250, 1945) | x | `spec/regles_2027.json:146-153` |
| P7 | (1750, 1945) | x | `spec/regles_2027.json:154-161` |
| P8 | (2250, 1945) | x | `spec/regles_2027.json:162-169` |
| P9 | (1500, 500) | y | `spec/regles_2027.json:170-177` |
| P10 | (1500, 1500) | y | `spec/regles_2027.json:178-185` |

Hauteurs des pierres au départ dans le moteur : 0 à 110, 110 à 220 et 220 à 330 mm (`engine/engine.js:168`, `top: 110 * l + 110`).

### 2.4 Les remparts jaunes : murs M1 à M5, tours T1 à T4

Les zones de mur mesurent 400 × 200 mm et les zones de tour Ø 200 mm (`spec/regles_2027.json:263-267`). Le surnom vient du moteur (`engine/engine.js:42`).

| Zone | Centre (x, y) mm | Grand axe | Surnom dans le moteur | Source |
|---|---|---|---|---|
| M1 | (250, 400) | 0° | mur haut | `spec/regles_2027.json:192-199` |
| M2 | (679,3 ; 570,8) | 45° | mur diagonal haut | `spec/regles_2027.json:200-207` |
| M3 | (850, 1000) | 90° | mur de façade | `spec/regles_2027.json:208-215` |
| M4 | (679,3 ; 1429,5) | −45° | mur diagonal bas | `spec/regles_2027.json:216-223` |
| M5 | (250, 1600) | 0° | mur bas | `spec/regles_2027.json:224-231` |
| T1 | (500, 400) | — | — | `spec/regles_2027.json:234-239` |
| T2 | (850, 750) | — | — | `spec/regles_2027.json:240-245` |
| T3 | (850, 1250) | — | — | `spec/regles_2027.json:246-251` |
| T4 | (500, 1600) | — | — | `spec/regles_2027.json:252-260` |

L'audit a relu le plan G.1 à 300 dpi et confirme ces positions (`AUDIT_SIMULATEUR_IA.md:165-170`).

Coins des zones de mur dans le moteur **[MESURE DOSSIER]**, en mm :
- M1 : x de 50 à 450, y de 300 à 500 ;
- M3 : x de 750 à 950, y de 800 à 1200 ;
- M5 : x de 50 à 450, y de 1500 à 1700 ;
- M2 : (891, 642), (609, 359), (467, 500), (750, 783) ;
- M4 : (750, 1217), (467, 1500), (609, 1642), (891, 1359).

### 2.5 Les tags ArUco

| Élément | Valeur | Source |
|---|---|---|
| Tags fixes de la table | 4 tags de 100 mm (bordure blanche de 120 mm), centrés en (600, 600), (2400, 600), (600, 1400) et (2400, 1400) | `spec/regles_2027.json:270-290` |
| Numéros de ces tags | « non lisibles dans le SVG : à relever sur la table réelle » : **[À FOURNIR]** | `spec/regles_2027.json:291` |
| Plages réservées | robots bleus 1 à 5, robots jaunes 6 à 10, aire de jeu 11 à 50, équipe bleue 51 à 70, équipe jaune 71 à 90 | `spec/regles_2027.json:292-313` (général G.6) |
| Tag des pierres | n° 13 | `spec/regles_2027.json:99` |
| Taille et position du tag sur une pierre | « au centre de chaque grande face », taille estimée à environ 90 mm d'après des photos, **à mesurer sur une vraie pierre** : **[À CONFIRMER]** | `conception/pince.md:18` |

---

## 3. Les éléments de jeu

### 3.1 Les pierres

| Propriété | Valeur | Source |
|---|---|---|
| Dimensions | 320 × 110 × 110 mm | `spec/regles_2027.json:92-96` |
| Masse | environ 90 g ; « peut changer d'un organisateur à l'autre » | `spec/regles_2027.json:97`, `conception/pince.md:35` |
| Nombre | 30 (10 carrières × 3) | `spec/regles_2027.json:98`, `:104` |
| Matériau | carton (hypothèse de calcul de la conception) : **[À CONFIRMER]** dans le règlement | `conception/pince.md:27`, `:35` |
| Couleurs et aspect réel (pour l'animation) | **[À FOURNIR]** (photo d'une vraie pierre) | absents du dépôt |

**Vocabulaire.** Le règlement parle de « pierres ». Le `README.md:72` les appelle « caisses ». Dans le documentaire, dire **pierres**.

### 3.2 Le Graal

| Propriété | Valeur | Source |
|---|---|---|
| Départ | « dans la salle du trône de l'équipe, entièrement contenu, non contrôlé par le robot » | `spec/regles_2027.json:331` |
| Taille minimale | « plus grand qu'un cube de 60 mm » | `spec/regles_2027.json:332` |
| Confinement | « ne doit jamais sortir de la cour du château et de ses remparts pendant tout le match ; sinon retiré de la table » | `spec/regles_2027.json:333` |
| Graal adverse | interdit de le déplacer | `spec/regles_2027.json:334` |
| Hauteur | il peut dépasser 350 mm seulement dans les zones de construction et dans le château | `spec/regles_2027.json:342` |
| Qui fabrique le Graal | le dépôt le traite comme un objet **conçu par l'équipe** (statut « proposé ») : **[À CONFIRMER]** dans le règlement | `spec/robot.json:469-471` |
| Graal d'ICAM LOT | base de 62 × 62 mm, 100 mm de haut, 2 anses basses : **[INTERNE – NE PAS MONTRER]**, car la forme des anses révèle le mécanisme de prise | `spec/robot.json:472-477`, `conception/ascenseur_graal.md:26-29` |
| Contraintes listées pour le Graal | « contraintes de construction d'un PAMI : périmètre ≤ 600 mm, altitude ≤ 175 mm, masse ≤ 1,5 kg » ; sommet ≤ 425 mm sur le toit. Source réglementaire exacte : **[À CONFIRMER]** | `spec/robot.json:478-482` |
| Position de départ simulée | **contradiction** : (70, 810) dans le moteur, calculée (`engine/engine.js:19-25`, `docs/CONTRATS.md:134`), contre (100, 1180) dans `spec/robot.json:483-486`. Position réelle, et qui la choisit : **[À CONFIRMER]** | voir colonne |

### 3.3 Les boulets

| Propriété | Valeur | Source |
|---|---|---|
| Nombre | 10 par équipe | `spec/regles_2027.json:352` |
| Diamètre | 45 mm | `spec/regles_2027.json:353` |
| Matériau | « balles en mousse de 45 mm (D.4) » (commentaire du moteur) | `engine/engine.js:153` |
| Qui tire | le robot et les PAMI, au plus 1 boulet par PAMI | `spec/regles_2027.json:354-355` |
| Validation | « tout ou partie de la projection verticale dans la cour du château adverse en fin de match » | `spec/regles_2027.json:356` |
| Position de tir imposée | aucune | `spec/regles_2027.json:357` |

### 3.4 Les PAMI

- Ils partent de 2 écuries par équipe (§2.2) (`spec/regles_2027.json:44-90`).
- Ils peuvent tirer 1 boulet chacun et marquer des points de douve et d'attaque (`spec/regles_2027.json:354`, `:369-370`).
- Contraintes de construction citées dans le dépôt : périmètre ≤ 600 mm, altitude ≤ 175 mm, masse ≤ 1,5 kg (`spec/robot.json:480`).
- Ils ne sont **pas simulés** (`engine/score.js:148`, `AUDIT_SIMULATEUR_IA.md:190`).
- Nombre maximal de PAMI par équipe, règles de mouvement et d'attaque, PAMI réellement construits par ICAM LOT : **[À FOURNIR]**.

---

## 4. Les règles de construction

Source : `spec/regles_2027.json:316-328` (jeu E.1) et `:329-343` (jeu E.2).

| Règle | Texte de la spec | Ligne |
|---|---|---|
| Pierre validée | « tout ou partie de la projection verticale dans la zone, ou posée sur une pierre déjà valide pour la zone » | `:318` |
| Mur | « 3 pierres horizontales empilées, dans une zone rectangulaire » | `:319` |
| Tour | « 1 pierre verticale, dans une zone circulaire » | `:320` |
| Porte | « 2 pierres verticales surmontées d'1 pierre horizontale, dans une zone rectangulaire de mur (n'importe laquelle) » | `:321` |
| Une construction par zone | oui | `:322` |
| Une porte par château | oui | `:323` |
| Une pierre ne compte que pour une construction | oui | `:324` |
| Élément encore contrôlé en fin de match | non compté | `:325` |
| Stockage | au plus 3 pierres dans la cour du château | `:326` |
| Vol | « seulement si toutes les carrières sont vides et sans détruire le château, sinon pénalité ≥ 50 pts » | `:327` |
| Graal niveau 1 | « sur 1 pierre horizontale » | `:336` |
| Graal niveau 2 | « sur 2 pierres horizontales » | `:337` |
| Graal niveau 3 | « sur 3 pierres horizontales ou sur 1 pierre verticale » | `:338` |
| Graal niveau 4 | « sur le toit du robot (> 300 mm), libre de tout actionneur et de tout moyen de fixation » | `:339` |
| Graal sur une porte | « non défini par le règlement : à faire préciser » : **[À CONFIRMER]** auprès de l'arbitrage | `:341` |

### 4.1 Comment le moteur de référence applique ces règles

Ce sont des choix d'implémentation, pas le règlement.

- **Niveau du Graal** : calculé d'après la hauteur de son dessous (≥ 100, 200 ou 300 mm donne le niveau 1, 2 ou 3). Le niveau 4 exige que le Graal soit sur le toit, la fourche dégagée et le robot dans son château. Sur une porte, il est compté au niveau 3 et signalé « à confirmer » (`engine/score.js:111-129`, `docs/CONTRATS.md:63-67`).
- **Porte** : autorisée sur toutes les zones de mur (`docs/CONTRATS.md:68`). M1 et M5 sont impossibles depuis l'extérieur, pour une raison géométrique : le robot toucherait le bord de table (`docs/CONTRATS.md:126`). Mesuré : « Pose sur M1 : aucune position sans contact (bord de table) » **[MESURE DOSSIER]**.
- **Stockage** : plus de 3 pierres libres dans la cour, hors zones de construction, provoque une erreur moteur (`docs/CONTRATS.md:69`).
- **Vol** : non modélisé (`AUDIT_SIMULATEUR_IA.md:186`).
- **Confinement du Graal** : si son empreinte sort du château, il est retiré et vaut 0 pt (`docs/CONTRATS.md:53`).
- **Trône, boulets, Graal** : évalués seulement à t = 100 s (`docs/CONTRATS.md:70`).

### 4.2 Forme exacte d'une porte dans le moteur [MESURE DOSSIER]

Mesure faite sur la porte M3 du programme de référence :
- les 2 piliers debout occupent x de 795 à 905, avec y de 890 à 1000 pour l'un et de 1000 à 1110 pour l'autre ;
- le linteau à plat couvre y de 840 à 1160, à z de 320 à 430 mm.

**Les deux piliers se touchent : il n'y a aucun passage entre eux.**

La spec ne parle pas d'ouverture (`spec/regles_2027.json:321`). Savoir si le vrai robot posera la porte ainsi, et si le règlement exige un passage, est **[À CONFIRMER]**. C'est important pour l'animation : une porte « ouverte » dessinée à l'écran ne correspondrait pas au moteur.

---

## 5. Barème, pénalités et score maximal

### 5.1 Barème complet

Source : `spec/regles_2027.json:359-373` (jeu F), recopié dans `bareme.js:9-22`. Le test `tests/test_moteur.js:26-28` vérifie que les deux sont identiques.

| Poste | Points |
|---|---|
| Pierre dans une zone de construction de son château | 1 par pierre |
| Mur | +5 |
| Tour | +5 |
| Porte (une seule par château) | +20 |
| Graal présent dans le château | +5 |
| Graal, par niveau d'élévation (1 à 4) | +5 par niveau |
| Retour du roi, partiel (une partie de la projection du robot dans la salle du trône) | 5 |
| Retour du roi, complet (toute la projection) | 10 |
| Douve adverse occupée par un PAMI | 5 par douve |
| Attaque d'un PAMI adverse par un PAMI (une seule fois) | 5 |
| Au moins 1 boulet dans la cour adverse | 5 |
| Au moins 3 boulets dans la cour adverse | +15 |

Le retour du roi est évalué « en fin de match, robot arrêté dans sa salle du trône » (`spec/regles_2027.json:344-349`).

### 5.2 Pénalités utiles

Source : `spec/regles_2027.json:395-403` (général H.4).

| Faute | Pénalité |
|---|---|
| Perte d'une pièce du robot | −20 |
| Dégradation de la table ou d'un élément | −30 |
| Évitement non fonctionnel | −30 |
| Robot qui bouge après la fin | −50 |
| Vol de pierres hors conditions | ≥ 50 (`spec/regles_2027.json:327`) |

Une seule pénalité est appliquée par match, la plus haute. Un score négatif est ramené à 0.

### 5.3 Score maximal théorique

**Calcul de l'audit** (`AUDIT_SIMULATEUR_IA.md:192-196`) :

| Poste | Points |
|---|---|
| Constructions : 1 porte (3 pierres, 20 pts), 4 murs (12 pierres, 20 pts) et 4 tours (4 pierres, 20 pts), soit 19 pierres (19 pts) | 79 |
| Graal au niveau 4 (5 + 4 × 5) | 25 |
| Trône complet | 10 |
| Boulets (5 + 15) | 20 |
| **Total du robot principal, hors PAMI** | **134** |

L'audit précise que ce total suppose les 19 pierres disponibles « malgré l'adversaire ».

**Complément calculé pour ce dossier**, non présent dans l'audit :
- avec les PAMI : 134 + 3 douves × 5 + 5 (attaque) = **154 pts** pour l'équipe ;
- le nombre de 3 douves vient de `bareme.js:28`, lui-même marqué « à confirmer » : **[À CONFIRMER]**.

**Point ouvert.** Des pierres posées dans une zone en plus d'une construction rapportent-elles 1 pt chacune ? La règle de validation « posée sur une pierre déjà valide » (`spec/regles_2027.json:318`) et le compteur (« une construction en trop ne rapporte que ses points de pierre », `point-counter/index.html:257`) le laissent penser. Le maximum de 134 ne compte pas ce cas. **[À CONFIRMER]** auprès de l'arbitrage.

---

## 6. Les limites imposées au robot

Source : `spec/regles_2027.json:374-394` (général F.3, G.2, F.4.c).

| Limite | Valeur | Ligne |
|---|---|---|
| Périmètre au départ | ≤ 1200 mm | `:376` |
| Périmètre déployé (en match) | ≤ 1400 mm | `:377` |
| Définition du périmètre | « périmètre de l'enveloppe convexe de la projection verticale au sol » | `:378` |
| Pierres tenues dans le périmètre | **non** (décision de l'équipe du 2026-10-28) | `:390-393`, `AUDIT_SIMULATEUR_IA.md:340` |
| Hauteur du robot et des objets manipulés | ≤ 350 mm | `:379` |
| Bouton d'arrêt d'urgence | hauteur ≤ 375 mm | `:380` |
| Support de balise | hauteur entre 425 et 435 mm, dans un cercle de Ø 200 mm autour du centre du robot ; section comprise entre un cercle de Ø 70 et un carré de 100 × 100 mm, du sommet du robot au support | `:381-386` |
| Zone autocollant | 100 × 70 mm, libre, sur une face verticale | `:387` |
| Pièces saillantes | interdites | `:388` |
| Système d'évitement | **obligatoire** | `:389` |

Autres règles de hauteur :
- les objets tenus peuvent dépasser 350 mm seulement dans le château et dans les zones de construction ; les actionneurs restent limités à 350 mm (`docs/CONTRATS.md:59`, `AUDIT_SIMULATEUR_IA.md:299`) ;
- le chiffre de 430 mm parfois cité est la hauteur du **support de balise**, pas une limite d'objets (`AUDIT_SIMULATEUR_IA.md:299`).

Informations manquantes sur l'arrêt d'urgence et la balise : position, diamètre, couleur, modèle **[À FOURNIR]**.

### 6.1 Comment le moteur modélise l'évitement

Ce sont des hypothèses de simulation, pas des mesures du robot.

| Élément | Valeur | Source |
|---|---|---|
| Détection | adversaire à moins de 400 mm du point lidar, dans le sens du mouvement | `engine/engine.js:130-138` |
| Point lidar | 30 mm en arrière du centre, sur l'axe de la face A ; origine non documentée : **[À CONFIRMER]** | `engine/engine.js:129` |
| Réaction avant de partir | attentes de 2 s, au plus 4 fois | `engine/engine.js:494-506` |
| Réaction en cours de trajet | arrêt sur place, attente d'au plus 8 s, puis l'étape échoue ; jamais de superposition des robots | `engine/engine.js:439`, `:639-642` |
| Conséquence | deux réseaux face à face ne peuvent pas se percuter ; un adversaire qui « fonce dessus » est hors règlement | `docs/CONTRATS.md:152` |
| Planification des trajets | A* sur une grille de 40 mm (75 × 50 cellules) | `engine/engine.js:385` |
| Comportement du vrai robot face à un adversaire (distance d'arrêt, capteur) | **[À FOURNIR]** | absent du dépôt |

---

## 7. Le robot ICAM LOT

Rappel : la **forme exacte** du robot est confidentielle (§11). Les cotes ci-dessous servent au dossier interne.

### 7.1 Châssis

Le châssis a été mesuré sur la CAO `Structure_robot_p.STEP`, avec `tools/mesure_step.py` (`spec/robot.json:3`).

| Grandeur | Valeur | Statut | Source |
|---|---|---|---|
| Forme | triangle tronqué (6 sommets) **[INTERNE – NE PAS MONTRER]** | mesuré | `spec/robot.json:25-33` |
| Distance des 3 faces au centre | 110,3 mm **[INTERNE]** | mesuré | `spec/robot.json:34-38` |
| Longueur des faces | 262,0 / 262,1 / 262,0 mm **[INTERNE]** | mesuré | `spec/robot.json:69-73` |
| Rayon maximal au sol | 212,4 mm | mesuré | `spec/robot.json:66` |
| Périmètre du châssis seul | 1173,1 mm, soit 26,9 mm de marge sous 1200 | mesuré | `spec/robot.json:67-68` |
| Hauteur de la structure (CAO actuelle) | 341,2 mm | mesuré | `spec/robot.json:24` |
| Toit cible | 311,2 mm (tubes de 290 mm au lieu de 320), « CAO à mettre à jour par l'équipe » | déclaré | `spec/robot.json:81-85` |
| Périmètre au départ, robot complet | 1190,0 mm (assemblage de principe) | mesuré | `spec/robot.json:86-90` |
| Hauteur maximale au départ, robot complet | 347,2 mm | mesuré | `spec/robot.json:91-94` |
| Mât de balise | centré, Ø 70 mm, jusqu'à 430 mm | déclaré (« centré ») | `spec/robot.json:456-459`, `docs/CONTRATS.md:31` |
| Faces | A et B pour la préhension, C pour le canon et l'ascenseur du Graal. Affectation : « à définir » **[INTERNE]** | déclaré / à définir | `spec/robot.json:17-20` |
| Masse, batterie, autonomie, couleur, habillage | **[À FOURNIR]** | — | absents du dépôt |

**Pourquoi le toit doit descendre.** Avec un toit à 341,2 mm, le niveau 4 du Graal est impossible sous 350 mm. Il faut un toit à 324 mm au plus. L'équipe a accepté des tubes de 290 mm, soit un toit à 311,2 mm (`AUDIT_SIMULATEUR_IA.md:344`, `spec/robot.json:455`). Ce n'est **pas encore reporté dans la CAO** (`spec/robot.json:84`).

### 7.2 Déplacement

| Grandeur | Valeur | Statut | Source |
|---|---|---|---|
| Type | holonome, 3 roues omnidirectionnelles (dit « kiwi ») | mesuré (CAO) | `spec/robot.json:284-287` |
| Roues | Ø 60 mm, « Nex RB-Nex-75 60 mm Aluminum Omni Wheel », à 192 mm du centre, à 60°, 180° et 300° | mesuré (CAO) | `spec/robot.json:288-298` |
| Moteurs | « 37d-gearmotor-50-70-encoder » ; tension et référence exacte : à définir | mesuré (CAO) / à définir | `spec/robot.json:299-303` |
| Vitesse linéaire | 500 mm/s, « vitesse mesurée annoncée par l'équipe ». Protocole de mesure : **[À FOURNIR]** | déclaré | `spec/robot.json:304-308`, `AUDIT_SIMULATEUR_IA.md:342` |
| Vitesse d'approche | 200 mm/s | hérité | `spec/robot.json:309-312` |
| Vitesse de rotation | 120 °/s | déclaré | `spec/robot.json:313-316` |
| Accélération | **non modélisée** par le moteur (durée = distance / vitesse, interpolation visuelle entre points clés). Le dossier de conception suppose 2 m/s² : **[À FOURNIR]** une mesure | — | `engine/engine.js:1576-1586`, `conception/pince.md:27` |

### 7.3 Perception (déclarée)

Source : `spec/robot.json:318-324`, `AUDIT_SIMULATEUR_IA.md:311-314`.

- **Lidar** : localisation par triangulation, plus position du robot adverse. Modèle : à définir **[À FOURNIR]**.
- **Caméras** : 1 sur chaque face de préhension (A et B), avec recalage sur les tags ArUco. Modèle et champ : à définir **[À FOURNIR]**.
- **Conséquence pour l'observation** : le robot ne sait qu'un paquet a disparu **que s'il l'a vu**. L'observation des paquets doit donc être une « croyance » (dernier état vu et âge de l'information) (`AUDIT_SIMULATEUR_IA.md:314`, `docs/CONTRATS.md:76-79`).

### 7.4 Calcul

| Élément | Valeur | Statut | Source |
|---|---|---|---|
| Carte embarquée | Raspberry Pi 5 + 2 ESP32 (non représentés dans la CAO) | déclaré | `spec/robot.json:328-331`, `AUDIT_SIMULATEUR_IA.md:343` |
| Rôles des 2 ESP32 (navigation et actionneurs), Pi 5 « 8 Go » | décrits seulement dans le `README.md`, que l'audit juge en contradiction avec le code : **[À CONFIRMER]** | non qualifié | `README.md:28-42`, `AUDIT_SIMULATEUR_IA.md:139` |
| Machine d'entraînement | AMD Ryzen 5 3600 (6 cœurs / 12 threads) + NVIDIA RTX 3060 | déclaré | `spec/robot.json:327` |
| Débit d'entraînement sur cette machine | non mesuré. Estimation : 30 à 53 décisions/s, environ 110 000 matchs/jour, en supposant la même vitesse par cœur que la machine de test. **[À CONFIRMER]** par `python -m trainer.debit` | estimation | `trainer/README.md:91`, `AUDIT_SIMULATEUR_IA.md:318-325` |
| Débit mesuré sur une autre machine | Xeon 2,1 GHz, 4 vCPU, sans GPU : 4,8 décisions/s avec 1 processus, 8,3 décisions/s avec 3 processus | mesuré par l'équipe | `trainer/README.md:70`, `:79-85` |

### 7.5 Mécanismes [INTERNE – NE PAS MONTRER]

Tout ce sous-chapitre est confidentiel. Statut : **proposé** par l'audit, à valider par l'équipe (`spec/robot.json:333-488`).

- **Pinces A et B** (`spec/robot.json:334-410`, `conception/pince.md`) :
  - 6 ventouses par face, 2 par pierre ; jusqu'à 3 pierres par face, au pas vertical de 110 mm ;
  - rotations à 0°, 90° et 180°, à raison de 1,5 s par 90° ; prise 0,5 s, relâche 0,4 s, chariot à 100 mm/s ;
  - rangées : Ø 40 à soufflet pour les rangées 1 et 2, ovales 40 × 20 pour la rangée 3 ; dépression minimale de 20 kPa ;
  - rotation d'une pierre tenue à 180° impossible ; pile tournée à 90° seulement dans le château ;
  - saillie recommandée : 35 mm.
- **Porte** : la pile de 3 tourne de 90°, les pierres 1 et 2 deviennent les piliers, et la pierre 3 sert de linteau (`docs/CONTRATS.md:39`, `spec/robot.json:406-409`).
- **Canon, face C** (`spec/robot.json:411-436`, `docs/CONTRATS.md:40-44`) :
  - lanceur à 2 volants, tube Ø 50 incliné à 35° ;
  - sortie de 90 mm en 1 s ; bouche à 57 mm de la face et à 189 mm de haut ;
  - chargeur de 4 colonnes × 3 places, 10 boulets.
- **Ascenseur du Graal, face C** (`spec/robot.json:437-468`, `conception/ascenseur_graal.md:31-43`) :
  - rail vertical, chariot, coulisse horizontale de 79 mm et fourche à 2 dents sous les anses du Graal ;
  - montée en 3,5 s (déclaré, plage de 3 à 4 s).
- **Fichiers confidentiels** :
  - `conception/*.step` et `conception/*.png` (rendus) ;
  - `conception/pince.md`, `conception/ascenseur_graal.md`, `conception/pince_calculs.txt` ;
  - `tools/cao_robot.py`, `tools/conception_pince.py`.

---

## 8. La stratégie de référence

Le dépôt contient **deux** programmes de référence. Ce sont des listes de « briques », c'est-à-dire de macro-actions.

### 8.1 `ENV.EXAMPLE` (ancien exemple, `engine/env.js:531-541`)

Les 14 briques, telles qu'écrites dans le fichier :
1. prendre P1 (face A) ;
2. prendre P9 (face B) ;
3. mur M1 (face A, extérieur) ;
4. mur M2 (face B, extérieur) ;
5. prendre P5 (A) ;
6. prendre P10 (B) ;
7. mur M5 (A, extérieur) ;
8. mur M4 (B, extérieur) ;
9. prendre P4 (A) ;
10. porte M3 (A, intérieur) ;
11. `prendreGraal` (B) ;
12. `poserGraal` (B, sur M3) ;
13. tir ;
14. trône.

| Mesure | Valeur | Source |
|---|---|---|
| Seul, révision auditée `4dee407` | **105 pts, T = 91,8 s, 0 erreur** | `AUDIT_SIMULATEUR_IA.md:151`, reproduit **[MESURE DOSSIER]** |
| Détail à `4dee407` | pierres 15, murs 20, tours 0, porte 20, Graal 20 (niveau 3 sur la porte), trône 10, boulets 20 | **[MESURE DOSSIER]** |
| Constructions terminées à | 62,0 s | `AUDIT_SIMULATEUR_IA.md:66`, confirmé **[MESURE DOSSIER]** (somme des durées : 61,98 s) |
| Duel contre lui-même en miroir, `4dee407` | **54 pts, 6 erreurs** (P10 et P4 déjà pris, Graal inaccessible, porte incomplète) | `AUDIT_SIMULATEUR_IA.md:152`, reproduit **[MESURE DOSSIER]** |
| Seul, moteur actuel (`0161a45`, moteur v2.0.0) | **74 pts, 6 erreurs**, T = 90,3 s | `docs/CONTRATS.md:133`, reproduit **[MESURE DOSSIER]** |

Les 6 erreurs du moteur actuel **[MESURE DOSSIER]** :
- M1 et M5 : « aucune position sans contact (bord de table) » ;
- 2 × « La face A tient déjà quelque chose » ;
- 2 × « Action inconnue », pour `prendreGraal` et `poserGraal`, retirés du moteur (`docs/CONTRATS.md:121`).

**Conséquence pour le documentaire.** `ENV.EXAMPLE` ne correspond plus au robot conçu. Le « 105 pts » du `README.md:49` et de `trainer/README.md:72` décrit un ancien moteur.

### 8.2 `ENGINE.PROGRAMME_REFERENCE` (référence actuelle, `engine/engine.js:1665-1675`)

C'est le programme à utiliser « à la place de `ENV.EXAMPLE` » (`docs/CONTRATS.md:133`). Le golden test `tests/test_moteur.js:75` fixe son résultat : 116 pts, T = 90,30 s.

| Mesure | Valeur |
|---|---|
| Seul | **116 pts, programme terminé à 90,30 s, 0 erreur, 0 contact** **[MESURE DOSSIER]** |
| Détail | pierres 16, murs 20 (M1, M2, M4, M5), tour 5 (T2), porte 20 (M3), Graal 25 (niveau 4), trône 10, boulets 20 |
| Duel contre son miroir, intensités « faible », « réaliste » et « agressif » | jaune **108 pts** (2 erreurs : P10 déjà pris par l'adversaire, donc pas de pile pour M4) ; bleu 65 pts (4 à 5 erreurs) **[MESURE DOSSIER]**, concorde avec `docs/CONTRATS.md:150` |
| Écart avec le maximum théorique | 134 − 116 = 18 pts (3 tours et 3 pierres non construites) |

Pourquoi garder cet adversaire : l'équipe garde volontairement le programme de référence en miroir comme adversaire par défaut. « Le but du réseau est de s'adapter à l'adversaire » (`docs/CONTRATS.md:150`).

#### Chronologie mesurée **[MESURE DOSSIER]**

Libellés neutres ici. Le détail par geste, confidentiel, est dans le fichier JSON.

| # | Brique | Début (s) | Fin (s) | Durée (s) | Pose du robot à la fin (x, y) |
|---|---|---|---|---|---|
| 1 | Prendre le paquet P1 | 0,00 | 3,13 | 3,13 | (750, 335) |
| 2 | Prendre le paquet P9 | 3,13 | 5,58 | 2,45 | (1220, 500) |
| 3 | Mur M2 | 5,58 | 8,10 | 2,53 | (881, 369) |
| 4 | Mur M1 | 8,10 | 12,64 | 4,54 | (250, 685) |
| 5 | Prendre le paquet P5 | 12,64 | 16,33 | 3,69 | (750, 1665) |
| 6 | Prendre le paquet P10 | 16,33 | 19,03 | 2,70 | (1220, 1500) |
| 7 | Mur M4 | 19,03 | 21,55 | 2,52 | (881, 1631) |
| 8 | Mur M5 | 21,55 | 26,08 | 4,53 | (250, 1315) |
| 9 | Prendre la pierre du haut de P6 (P6.3) | 26,08 | 30,32 | 4,23 | (1250, 1665) |
| 10 | Prendre le paquet P2 | 30,32 | 34,42 | 4,11 | (1250, 335) |
| 11 | Tour T2 | 34,42 | 41,45 | 7,03 | (615, 938) |
| 12 | Porte M3 | 41,45 | 53,19 | 11,73 | (550, 1000) |
| 13 | Monter le Graal sur le toit | 53,19 | 63,19 | 10,00 | (225, 867) |
| 14 | Séance de tir : placement, attente de 85 s, puis 10 boulets | 63,19 | 89,60 | 26,41 | (250, 1000) |
| 15 | Retour au trône | 89,60 | 89,80 | 0,20 | (250, 1000) |
| — | Fin du programme | — | 90,30 | — | — |

Faits utiles pour la narration **[MESURE DOSSIER]** :
- **Constructions** : toutes terminées à **53,2 s**.
- **Graal** : sur le toit à **62,4 s**.
- **Attente** : le robot attend dans sa salle du trône de **66,2 s à 85,0 s**, soit **18,8 s** sans action, parce que le tir n'est permis qu'à partir de 85 s.
- **Tir** : 10 boulets de 85,0 à 89,6 s, à 2 par seconde, vitesse de sortie 3,98 m/s. Ils s'arrêtent tous dans la cour adverse, en x de 2608 à 2909 et y de 875 à 979.
- **Pierres** : 16 utilisées. Restent dans leurs carrières : P3, P4, P7, P8 (12 pierres) et P6.1, P6.2.

#### État final de la table (référence de réalisme pour l'animation) [MESURE DOSSIER]

| Construction | Pierres | Emprise au sol (mm) | Hauteurs (mm) | Posée à |
|---|---|---|---|---|
| Mur M2 | P9.1, P9.2, P9.3, à plat | centre (679, 571), grand axe à 45° comme la zone | 0 à 330 (3 × 110) | 7,28 s |
| Mur M1 | P1.1 à P1.3, à plat | x de 90 à 410, y de 345 à 455 | 0 à 330 | 11,81 s |
| Mur M4 | P10.1 à P10.3, à plat | centre (679, 1430), grand axe à −45° | 0 à 330 | 20,73 s |
| Mur M5 | P5.1 à P5.3, à plat | x de 90 à 410, y de 1545 à 1655 | 0 à 330 | 25,26 s |
| Tour T2 | P6.3, debout | centre (850, 750), 110 × 110 tourné | 0 à 320 | 38,90 s |
| Porte M3, piliers | P2.1 et P2.2, debout | x de 795 à 905 ; y de 890 à 1000 et de 1000 à 1110 | 0 à 320 | 46,31 s |
| Porte M3, linteau | P2.3, à plat | x de 795 à 905, y de 840 à 1160 | 320 à 430 | 51,29 s |
| Graal | sur le toit du robot | centre (326,3 ; 1057) | dessous 311,2, sommet 411,2 | 62,39 s |
| Robot | dans la salle du trône | centre (250, 1000) | — | 89,80 s |

**Réalisme de pose.** Dans le moteur, un mur est **une pile alignée de 3 pierres posée d'un seul coup**, centrée sur la zone : les 3 pierres ont exactement la même emprise. Aucune pierre n'est posée en biais ni décalée.

### 8.3 Ce que le simulateur suppose (à ne pas présenter comme mesuré)

| Hypothèse | Valeur | Source |
|---|---|---|
| Pose de départ du robot | (250, 1000), face A vers +x, « hypothèse héritée » | `engine/engine.js:17-18` |
| Position de tir | centre du trône (250, 1000) ; tirer depuis le trône est « un choix d'équipe, pas une règle » | `engine/engine.js:29-30`, `docs/CONTRATS.md:44` |
| Cadence de tir | la valeur « 2 » de la spec est lue comme **2 boulets par seconde** : **[À CONFIRMER]** | `engine/engine.js:32`, `spec/robot.json:417` |
| Balistique | point visé x = 2625 ; masse, traînée, restitution, frottements et dispersions « hérités (hypothèses) » | `engine/engine.js:34-35` |
| Durées de l'ascenseur (transfert, pose, dégagement, sortie et descente de la fourche) | paramètres « hypothèses » | `engine/engine.js:36-37` |
| Durées des pinces | « hypothèses héritées » | `docs/CONTRATS.md:38` |
| Accélérations, glissements des roues, erreurs de positionnement, aléas de prise | non modélisés | `engine/engine.js:1576-1586` ; aucun modèle d'erreur trouvé |
| Château | polygone hérité, à comparer au plan | `engine/engine.js:52-53` |
| Douves et PAMI | non simulés | `engine/score.js:148` |

Recalage prévu par l'audit : en avril 2027, les durées et vitesses seront mesurées sur le robot, avec un écart visé ≤ 10 % par action (`AUDIT_SIMULATEUR_IA.md:335`).

---

## 9. Contradictions relevées dans le dépôt

| Sujet | Version A | Version B | À retenir |
|---|---|---|---|
| Score de la stratégie de référence | « 105 pts », 100 % de victoires (`README.md:49`) | 54 pts en duel et `BENCHMARK_REPORT.md` en désaccord (`AUDIT_SIMULATEUR_IA.md:18-21`) ; 74 pts dans le moteur actuel (§8.1) | 116 pts seul, 108 contre son miroir (§8.2) |
| Position de départ du Graal | (70, 810) (`engine/engine.js:25`) | (100, 1180) (`spec/robot.json:483-486`) | **[À CONFIRMER]** |
| Hauteur du toit | 341,2 mm, CAO mesurée (`spec/robot.json:24`) | 311,2 mm déclaré, tubes de 290 mm (`spec/robot.json:81-85`) | 311,2 mm dans le moteur (`engine/geom.js:26`) ; la CAO reste à mettre à jour |
| Niveau maximal du Graal | 1 à 4 (`bareme.js:30`) | plafonné à 3 dans l'ancien code (`AUDIT_SIMULATEUR_IA.md:143`) | corrigé : niveau 4 mesuré dans le moteur actuel (§8.2) |
| Architecture matérielle et cerveau | `README.md:23-65` | l'audit les déclare en contradiction avec le code (`AUDIT_SIMULATEUR_IA.md:25-34`, `:139`) | ne pas citer le `README.md` comme source |
| Vitesses | « 0,5 m/s, 0,2 m/s et 120 °/s, valeurs non justifiées » (`AUDIT_SIMULATEUR_IA.md:208`) | « 0,5 m/s et 120 °/s, valeurs mesurées par l'équipe » (`AUDIT_SIMULATEUR_IA.md:342`) | la mise à jour la plus récente est B ; le statut reste « déclaré » ; 0,2 m/s reste « hérité » |

---

## 10. Données pour représenter le robot à l'écran sans le trahir

Le robot est « invisible » dans le premier montage. Le dépôt **ne fixe pas** comment le représenter publiquement. Voici seulement ce qui est réglementaire et public, à combiner avec une décision de l'équipe **[À CONFIRMER]** :

- **Enveloppe réglementaire** : périmètre ≤ 1200 mm au départ et ≤ 1400 mm en match, hauteur ≤ 350 mm, support de balise de 425 à 435 mm au centre (`spec/regles_2027.json:376-386`).
- **Trajectoire du centre du robot** : échantillonnée toutes les 0,1 s pendant 100 s, en x et y (mm) et en cap h (degrés, angle cumulé), dans `mesures_programme_reference.json`, champ `trajectoire_robot` **[MESURE DOSSIER]**. Elle peut animer un robot stylisé avec les vrais temps.
- **Instants de prise et de pose de chaque pierre** : champ `chronologie_pierres` **[MESURE DOSSIER]**.
- **Positions finales exactes des pierres** : champ `pierres` et tableau du §8.2 **[MESURE DOSSIER]**.
- **Attention** : la vue 3D du simulateur (`/plateau/`) dessine l'empreinte réelle, les nacelles, le canon et l'ascenseur à partir de la spec (`plateau/app.js:601`, `:633`, `:654-659`). **Une capture d'écran de `/plateau/` montre la mécanique confidentielle.**

---

## 11. Confidentialité : ce qui peut ou ne peut pas apparaître à l'écran

### 11.1 Public (règlement et jeu) : peut être montré

- La table, les zones, les carrières, les tags ArUco de la table, les éléments de jeu, les règles de construction, le barème et les pénalités (§1 à §6).
- Les scores mesurés : 116, 108, 105 à l'ancienne révision, 74 et le maximum de 134 (§5, §8).
- L'existence d'un simulateur et de matchs simulés.

### 11.2 [INTERNE – NE PAS MONTRER] : mécanique confidentielle

| Information | Où elle se trouve dans le dépôt |
|---|---|
| Pinces et nacelles : nombre, rotations, chariot, saillie | `spec/robot.json:334-410`, `docs/CONTRATS.md:32-38`, `conception/pince.md`, `conception/nacelle_A.step`, `conception/nacelle_B.step`, `conception/pince_rotation.png` |
| Ventouses : nombre, type, diamètres, positions, dépression | `spec/robot.json:369-401`, `conception/pince.md:9-35`, `conception/pince_calculs.txt` |
| Méthode de construction de la porte (pile tournée de 90°, linteau = pierre de la rangée 3) | `docs/CONTRATS.md:39`, `spec/robot.json:406-409` |
| Canon : position sur la face C, tube, élévation, volants, chargeur | `spec/robot.json:411-436`, `docs/CONTRATS.md:40-44`, `conception/canon.step`, `conception/ascenseur_graal.md:45-48` |
| Ascenseur du Graal : rail, fourche, coulisse, séquence | `spec/robot.json:437-468`, `conception/ascenseur_graal.md:31-43`, `conception/ascenseur_graal.step` |
| Forme du Graal d'ICAM LOT (anses basses) | `spec/robot.json:469-487`, `conception/graal.step` |
| Forme exacte du châssis : triangle tronqué, faces de 262 mm à 110,3 mm, empreinte à 45 sommets | `spec/robot.json:22-282`, `engine/geom.js` |
| Rendus et assemblages | `conception/rendu_prise.png`, `conception/rendu_fin.png`, `tools/cao_robot.py` |
| Vue 3D du simulateur | `plateau/app.js:601-660` (et toute capture de `/plateau/`) |
| Libellés détaillés des gestes : « Vide face A », « Descente de la fourche », « Sortie du canon (90 mm) », « Linteau remis à plat »… | `engine/engine.js`, champ `segments` de `mesures_programme_reference.json` |
| Schéma matériel du README (« pince pneumatique », « pince Graal & ascenseur ») | `README.md:36-42` |

### 11.3 Non listé comme confidentiel par la consigne : à arbitrer par l'équipe [À CONFIRMER]

- Le déplacement holonome à 3 roues omnidirectionnelles (`spec/robot.json:284-298`).
- La perception : lidar et caméras sur deux faces (`spec/robot.json:318-324`).
- Le calcul : Pi 5 + 2 ESP32 (`spec/robot.json:328-331`).
- Le fait que le robot porte des piles de 3 pierres sur deux faces en même temps. Cela révèle la capacité des pinces.
- La stratégie elle-même : ordre des briques et zones choisies (§8.2). Elle peut avoir une valeur pour les adversaires.
- Les durées par brique (§8.2), qui laissent deviner les vitesses des mécanismes.

---

## 12. Liste consolidée des manques

### [À FOURNIR]

1. Les PDF du règlement de jeu 1.0 et du règlement général 1.4, `table.svg` et `Structure_robot_p.STEP` (absents du dépôt).
2. Le lieu, la date exacte et le format du tournoi ; la procédure de départ (tirette) et d'homologation.
3. La couleur (jaune ou bleu) attribuée à ICAM LOT match par match.
4. La géométrie des douves ; les numéros des 4 tags ArUco de la table.
5. Une photo et les caractéristiques réelles d'une pierre (couleur, matériau, taille du tag).
6. Le nombre de PAMI d'ICAM LOT, leurs règles et leur conception.
7. Pour le robot :
   - masse, batterie, autonomie, habillage, couleur ;
   - modèle du lidar ; modèle et champ des caméras ;
   - tension et référence des moteurs ;
   - accélération mesurée ; protocole de mesure des 500 mm/s et 120 °/s ;
   - position et modèle de l'arrêt d'urgence ;
   - comportement réel d'évitement.
8. La mise à jour de la CAO avec le toit à 311,2 mm.

### [À CONFIRMER]

1. Les titres officiels des missions (`point-counter/index.html:238`) et l'origine de `plateau/table.jpg`.
2. Le contour du château dans le moteur (polygone hérité, `engine/engine.js:52-53`).
3. Le niveau du Graal posé sur une porte (`spec/regles_2027.json:341`).
4. Si des pierres en plus des constructions rapportent des points (§5.3), et le nombre de douves (`bareme.js:28`).
5. Si la porte doit comporter un passage entre ses piliers (§4.2).
6. Qui fabrique le Graal, et la source des « contraintes de PAMI » qui lui sont appliquées (`spec/robot.json:478-482`).
7. La position de départ du Graal : (70, 810) ou (100, 1180) ?
8. La cadence de tir : 2 boulets/s ou 1 boulet toutes les 2 s (`engine/engine.js:32`) ?
9. Le point lidar à 30 mm en arrière du centre (`engine/engine.js:129`).
10. Le débit d'entraînement réel sur le Ryzen 5 3600 + RTX 3060.
11. Le niveau de détail du robot autorisé à l'écran (§10, §11.3).

---

## Annexe A. Mesures exécutées pour ce dossier

Les scripts sont dans `/tmp/claude-0/-home-user-icamlot/7624d51f-7be7-5b87-ae0f-1fda87a83f3b/scratchpad/mesures/`. Ils chargent le moteur avec `engine/load.js` en lecture seule. `git status` du dépôt audité est vide après les mesures.

| Script | Ce qu'il mesure | Résultat |
|---|---|---|
| `mesure_ref.js` | `ENV.EXAMPLE` et `ENGINE.PROGRAMME_REFERENCE`, seuls et en duel miroir, dans le moteur actuel (VERSION 2.0.0) | EXAMPLE : 74 pts, 6 erreurs, T = 90,30 s. RÉFÉRENCE : 116 pts, 0 erreur, T = 90,30 s. RÉFÉRENCE contre son miroir : 108 pts (jaune) |
| `chrono.js` | Durée et pose de fin de chaque brique | Tableau du §8.2 |
| `mesure_4dee407.js` | `ENV.EXAMPLE` à la révision auditée `4dee407`, extraite avec `git archive 4dee407 engine bareme.js` dans `scratchpad/rev4dee407/` | 105 pts, T = 91,80 s, 0 erreur ; duel miroir 54 pts, 6 erreurs. Concorde avec `AUDIT_SIMULATEUR_IA.md:151-152` |
| `duel.js` | RÉFÉRENCE contre son miroir, aux intensités aucun, faible, réaliste et agressif | 116 / 108 / 108 / 108 (jaune) ; bleu 65 |
| `export_ref.js` | Écrit `doc/mesures_programme_reference.json` | voir annexe B |

Commande type :

```
node /tmp/claude-0/-home-user-icamlot/7624d51f-7be7-5b87-ae0f-1fda87a83f3b/scratchpad/mesures/mesure_ref.js
```

Le moteur est déterministe : même programme et mêmes paramètres donnent le même résultat. C'est pourquoi l'écart-type vaut 0 dans `trainer/README.md:74`.

## Annexe B. Contenu de `mesures_programme_reference.json` [INTERNE]

| Champ | Contenu |
|---|---|
| `_confidentialite` | avertissement d'usage interne |
| `score_total`, `detail`, `niveau_graal`, `fin_programme_s`, `erreurs`, `contacts` | résultat global (116 pts, niveau 4, 90,3 s, 0, 0) |
| `briques` | 15 briques : début, durée, fin, erreur, pose de fin |
| `segments` | 135 gestes horodatés **[INTERNE – NE PAS MONTRER]** : les libellés décrivent la mécanique |
| `pierres` | les 30 pierres : état final, centre, debout ou à plat, hauteurs basse et haute, zone, instant de pose, face |
| `chronologie_pierres` | pour chaque pierre déplacée : départ, prise (t, face), pose |
| `graal` | chronologie (départ, ascenseur à 57,89 s, toit à 62,39 s) et position finale |
| `boulets` | 10 tirés, premier tir à 85 s, 3,98 m/s, 10 dans la cour adverse, 10 points d'arrêt |
| `trajectoire_robot` | 1001 échantillons [t, x, y, h] de 0 à 100 s, toutes les 0,1 s (`R.poseAt` du moteur) |
