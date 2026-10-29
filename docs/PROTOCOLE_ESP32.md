# Protocole série Raspberry Pi 5 <-> ESP32 (ICAM LOT 2027)

**Statut : proposé, à valider par l'équipe.** Aucun firmware n'existe encore (`spec/robot.json`, `calcul.embarque.firmware`) : ce document sert à écrire les firmwares. Il est appliqué côté Pi par `esp32_bridge.py` et côté firmware simulé par `FirmwareSimule` (même fichier).

Convention : tout ce qui vient de la spec ou de l'équipe est cité avec sa source. **Toute autre valeur est marquée « proposée »** avec sa justification, et reprise dans la liste du §9. Les questions ouvertes sont au §10.

## 1. Affectation (déclarée par l'équipe, 2026-10-28)

| ESP32 | Rôle | Matériel (guide de la carte, version du 25/10/2026) |
|---|---|---|
| n°1 `NAV` | **base roulante uniquement** | 2 RoboClaw (UART1 J4, UART2 J5), 2 PMW3389 (SPI), gyroscope LSM6DSOX (SPI) |
| n°2 `ACT` | **tous les actionneurs** : vérins Z, rotations des nacelles, ascenseur du Graal, canon (séance de tir), pompes | 6 pompes (GPIO8 à 13), 6 capteurs de pression (2 ADS1115, I2C 0x48 / 0x49), 2 vérins (VNH5019 + potentiomètres GPIO1 / GPIO2), tirette GPIO14 |

Les deux sont reliés au Pi 5 en USB. L'évitement est décidé par le Pi, qui ordonne à `NAV` de s'arrêter. Le servo « lanceur » (GPIO7) n'est pas pris en compte. Les caméras (tags ArUco) et le lidar sont lus par le Pi, pas par les ESP32 : ils n'apparaissent pas dans ce protocole.

## 2. Transport et trames

| Point | Règle | Statut |
|---|---|---|
| Liaison | USB, un port série virtuel (CDC) par ESP32 | déclaré (USB) ; le choix du port USB du kit (natif ou pont UART) est une question ouverte (Q1) |
| Débit | 921 600 bauds (sans effet sur l'USB natif) | **proposé** : la télémétrie (§6) et les trames de commande restent très loin de la limite ; une marge évite de se poser la question |
| Identification des ports | par la commande `HELLO` (§3), pas par le nom du port | **proposé** : les ports `/dev/ttyACM*` changent d'ordre au branchement |
| Codage | ASCII, une trame = une ligne terminée par `\n` (`\r\n` toléré) | **proposé** : lisible au terminal, écriture du firmware simple |
| Longueur | 200 octets au plus par ligne | **proposé** : tient dans un tampon fixe |
| Champs | séparés par une espace ; mots-clés en majuscules ; nombres décimaux avec un point | **proposé** |
| Unités | mm, degrés, millisecondes, kPa | **proposé** (celles de la spec et du moteur) |
| Contrôle d'erreur | aucun (CRC de l'USB) | **proposé** |
| Lignes inconnues | ignorées (journaux de démarrage de l'ESP32 compris) | **proposé** |

**Identifiant de commande** : toute commande qui produit un résultat se termine par ` #<id>`, un entier ≥ 1 choisi par le Pi, unique par ESP32 pour la session (**proposé**). Les réponses le reprennent.

**Cycle de vie d'une commande** (Pi vers ESP32, puis retour) :

```
Pi  : GOTO 900.0 1000.0 0.0 #12
ESP : ACK #12                 commande comprise et acceptée (au plus 20 ms, proposé)
 ou : NAK #12 BUSY ...        refusée, rien n'a bougé
ESP : DONE #12                mouvement terminé (position atteinte)
 ou : FAIL #12 STALL          échec en cours de route
 ou : ABORT #12 STOP          interrompu (STOP, chien de garde, autre commande)
```

Une commande instantanée (`SET_POSE`, `SET_LIMITS`, `CFG`) n'a que `ACK` ou `NAK` : l'`ACK` vaut fin. Une commande de mouvement reçoit exactement un `ACK` ou un `NAK`, puis, si `ACK`, exactement un résultat parmi `DONE`, `FAIL`, `ABORT`.

**Voies de mouvement** : un ordre sur une voie déjà occupée est refusé (`NAK #id BUSY <voie>`). `NAV` : une seule voie (déplacement). `ACT` : `Z_A`, `Z_B`, `ROT_A`, `ROT_B`, `ASC`, `TIR`, `PUMP_A`, `PUMP_B`. Les voies d'un même ESP32 s'exécutent en parallèle (temps masqué du moteur, `docs/CONTRATS.md` §7). **Le Pi n'envoie un ordre sur une voie qu'après le résultat du précédent**, sauf une trajectoire enchaînée (`PATH`).

## 3. Commandes communes aux deux ESP32

| Commande | Réponse | Rôle |
|---|---|---|
| `HELLO` | `HELLO <NAV\|ACT> <version_protocole> <version_firmware>` | identifie l'ESP32. Le Pi refuse un rôle ou une version de protocole inattendus. Version du protocole décrite ici : `1` (proposé). |
| `PING` | `PONG` | entretient le chien de garde |
| `CFG <clé> <valeur> #id` | `ACK` | réglage, clés ci-dessous |
| `STOP #id` | voir §4.4 (NAV) et §5.6 (ACT) | arrêt prioritaire |
| `START <âge_ms> #id` | `ACK` ou `NAK` | le match a commencé il y a `âge_ms` ms : lance le chrono de l'arrêt autonome de fin de match (§6 bis) |
| `CHRONO?` | `CHRONO <ms>` | millisecondes écoulées depuis le départ du match selon cet ESP32, arrondies au-dessus ; `-1` si le match n'est pas parti (§6 bis) |

**Clés de `CFG`** : `WATCHDOG_MS <ms>` (0 = désactivé), `TELEM_MS <ms>` (0 = télémétrie coupée), `FIN_MS <ms>` (instant de l'arrêt autonome de fin de match, en ms après le départ ; 0 = pas d'arrêt autonome ; §6 bis). Propres à `ACT` : `VIDE_MIN_KPA <kPa>`.

**Chien de garde** (**proposé**) : si l'ESP32 ne reçoit aucune ligne du Pi pendant `WATCHDOG_MS`, il passe en sécurité. Valeur **proposée** : 500 ms, avec un `PING` du Pi toutes les 100 ms (5 par fenêtre : on tolère la perte de 4 messages consécutifs et une pause du calcul du réseau). Le chien de garde est armé par le premier `CFG WATCHDOG_MS` reçu après `HELLO`, pour que le firmware reste utilisable au terminal. Sécurité `NAV` : consigne de vitesse nulle sur les deux RoboClaw, `ABORT #id WATCHDOG` de la commande en cours. Sécurité `ACT` : arrêt des vérins et des autres axes (`ABORT … WATCHDOG`), abandon d'une séance de tir ; **les pompes gardent leur état** (**proposé** : couper le vide ferait lâcher les pierres tenues ; question Q8).

**Erreur spontanée** : `ERR <code> [texte]` (RoboClaw muet, ADS1115 absent, courant d'un vérin trop fort…). Les codes sont au §8.

## 4. ESP32 n°1 `NAV` : base roulante

Repère : celui de la table, **réel** (le Pi met en miroir les coordonnées pour l'équipe bleue avant l'envoi : `x -> 3000 - x`, `h -> 180 - h`, `docs/CONTRATS.md` §2). `h` en degrés, normalisé dans ]-180, 180] ; le firmware prend le chemin le plus court.

### 4.1 Commandes

| Commande | Réponse | Rôle |
|---|---|---|
| `SET_POSE x y h #id` | `ACK` | fixe la pose de l'odométrie (départ, recalage par le lidar ou les tags ArUco). Refusée (`NAK BUSY`) pendant un mouvement (**proposé** ; question Q7). |
| `SET_LIMITS v w #id` | `ACK` | vitesse linéaire maximale (mm/s) et de rotation (°/s). Le Pi envoie les valeurs de `spec/robot.json` : 500 mm/s et 120 °/s (déclarées). |
| `GOTO x y h #id` | `ACK`, puis `DONE` | consigne : rejoindre la pose (x, y, h), arrêt à l'arrivée |
| `PATH n x1 y1 h1 … xn yn hn #id` | `ACK`, `WPT #id k` à chaque point, puis `DONE` | trajectoire enchaînée : passer par les points dans l'ordre **sans s'arrêter entre deux points** ; la vitesse est celle de `SET_LIMITS`, le profil est celui du firmware. `n` ≤ 8 (**proposé** : 8 points tiennent dans 200 octets) ; le Pi découpe au-delà. |
| `STOP #id` | voir §4.4 | arrêt d'évitement, prioritaire |
| `POSE?` | `POSE x y h ETAT` | pose courante |

`ETAT` vaut `IDLE`, `MOVING` ou `STOPPED` (arrêté par `STOP`, aucun ordre en cours).

Pourquoi `PATH` : le plan du moteur est une suite de points de passage ; s'arrêter à chacun rendrait le déplacement plus long que celui du moteur. `WPT` permet au Pi de lancer une action de temps masqué exactement quand un point est atteint.

### 4.2 Fin de mouvement

`DONE #id` quand la pose est atteinte à la tolérance du firmware (valeur à choisir par l'équipe, Q9). `FAIL #id STALL` si un moteur bloque, `FAIL #id TIMEOUT` si la pose n'est pas atteinte dans le délai propre du firmware, `FAIL #id COMM` si un RoboClaw ne répond plus.

### 4.3 Odométrie

Pose estimée par le firmware à partir des deux PMW3389 et du gyroscope (le cap vient du gyroscope). La fusion est du ressort du firmware. Le Pi recale par `SET_POSE` quand le lidar ou les tags ArUco donnent une pose meilleure.

### 4.4 Arrêt d'évitement (`STOP`)

L'évitement est décidé **par le Pi** (lidar). Le Pi envoie `STOP #id` ; l'ESP32 le traite **avant toute autre ligne en attente**, même en plein mouvement :

```
Pi  : STOP #40
ESP : ACK #40
ESP : ABORT #12 STOP          pour la commande de mouvement en cours (GOTO ou PATH)
ESP : DONE #40                robot immobile (ETAT passe à STOPPED)
```

Pas de verrouillage : après `DONE #40`, un nouveau `GOTO` ou `PATH` est accepté (**proposé** : la reprise est décidée par le Pi). La décélération est celle du firmware (Q9). Côté Pi : reprise si la menace disparaît, sinon échec de la brique (voir §7).

## 5. ESP32 n°2 `ACT` : actionneurs

Les consignes sont celles du moteur (`sim.pose()`, points clés `A.hc`, `A.rot`, `C.fx`, `C.fz`) : le firmware ne reçoit aucun nombre qui ne vienne pas de lui ou du moteur.

### 5.1 Vérins Z des nacelles (axes de hauteur `hc`)

| Commande | Réponse | Rôle |
|---|---|---|
| `Z <face> <hc> [T=<ms>] #id` | `ACK`, puis `DONE` | amener l'axe Z de la nacelle `A` ou `B` à la hauteur d'axe `hc` (mm). Recopie par le potentiomètre (GPIO1 / GPIO2). |

`T=<ms>` (**proposé**, facultatif) : durée voulue du mouvement, en millisecondes, décimales admises (`T=716.667`) ; absent pour un saut instantané du moteur. Le firmware cherche à arriver au bout de `T` ms (vitesse constante). Sans `T`, il va à sa vitesse nominale. Le moteur coordonne certains axes (rotation de nacelle avec montée du chariot pour rester sous 350 mm) : sans durée, le firmware ne peut pas reproduire cette coordination. Si la durée est inférieure à ce que l'axe peut faire, `NAK #id SPEED`.
Course 100 mm, vitesse retenue 80 mm/s (84 à vide, 75 à 120 N ; équipe, 2026-10-28, `spec/robot.json` `actionneurs_carte.verins`). La relation entre `hc` et la course du vérin (hauteur de montage) reste à définir (Q2) : la conception utilise 110 mm de course (axe de 160 à 270 mm), voir le chantier moteur. Les consignes hors de la plage du firmware sont refusées (`NAK #id RANGE`). Surveillance du courant (sortie CS du VNH5019, environ 0,14 V par ampère d'après le guide) : `FAIL #id OVERCURRENT`.

### 5.2 Rotation des nacelles

| Commande | Réponse | Rôle |
|---|---|---|
| `ROT <face> <angle> [T=<ms>] #id` | `ACK`, puis `DONE` | amener la nacelle `A` ou `B` à l'angle `angle` (degrés, −90 / 0 / 90 / 180 dans la spec ; consignes intermédiaires d'une rotation coordonnée comprises dans [−90, 180], `NAK #id RANGE ROT` sinon) |

Sens : angle positif dans le sens du moteur (`engine/geom.js`) ; à −90°, la pierre tenue part de l'autre côté de la face qu'à +90° (`spec/robot.json`, `rotation_moins_90`). Pour l'équipe bleue, le Pi envoie l'angle réel (opposé de celui du repère de l'équipe, `docs/CONTRATS.md` §16) : le firmware ne connaît pas l'équipe.

Matériel et capteur de retour : non décrits (Q3).

### 5.3 Ascenseur du Graal (face C)

| Commande | Réponse | Rôle |
|---|---|---|
| `ASC <fx> <fz> [T=<ms>] #id` | `ACK`, puis `DONE` | positionner la fourche : `fx` coulisse horizontale (mm), `fz` hauteur (mm), dans le repère de la face C du moteur (`C.fx`, `C.fz`) |

### 5.4 Pompes et pression (une pompe par pierre, 3 pompes par face)

| Commande | Réponse | Rôle |
|---|---|---|
| `PUMP <face> <p1> <p2> <p3> #id` | `ACK`, puis `DONE` | état des 3 pompes de la face `A` ou `B` (rangées 1, 2, 3 ; 1 = vide, 0 = arrêt) |
| `CFG VIDE_MIN_KPA <kPa> #id` | `ACK` | seuil de dépression « pierre tenue » |

- **Correspondance** (**proposée**, à valider, Q4) : face A, rangées 1 à 3 = pompes 1 à 3 (GPIO8 à 10) ; face B, rangées 1 à 3 = pompes 4 à 6 (GPIO11 à 13). Capteur de pression `Pn` = pompe `n` (1 capteur par pompe, déclaré). La table est dans le firmware : le Pi ne connaît que face et rangée.
- **`DONE`** : pour chaque pompe mise à 1, quand sa dépression dépasse le seuil `VIDE_MIN_KPA` ; pour chaque pompe mise à 0, immédiatement après l'arrêt. `FAIL #id VACUUM` si une pompe mise à 1 n'atteint pas le seuil dans le délai du firmware (pas de pierre, joint mauvais). Si le Pi coupe puis relance dans l'intervalle, `ABORT`.
- **Seuil** : le Pi envoie `spec/robot.json` `mecanismes.pince_A_et_B.ventouses.depression_minimale_kPa` (20 kPa, statut « proposé » dans la spec). Aucun nombre en dur dans le firmware.
- **Démarrage échelonné** (guide de la carte, §7 : environ 100 ms entre deux pompes, pic de 18 A ramené à 10,5 A) : à la charge du firmware, il met les pompes en route l'une après l'autre. Valeur du guide.
- **Zéro des capteurs** : étalonné à l'air libre pendant `INIT` (guide, §8).
- **Mesure** : dépression en kPa **relative au zéro étalonné**, positive quand il y a du vide (**proposé**). La correction par la mesure du 5 V capteurs (ADS1115 n°2) est du ressort du firmware (guide, §8).

### 5.5 Tirette et initialisation

| Commande ou événement | Rôle |
|---|---|
| `EVT TIRETTE <v>` | envoyé à chaque changement, et une fois après `HELLO`. `1` = tirette **en place**, `0` = **retirée** (**proposé** : le niveau logique du microrupteur sur GPIO14, contact vers la masse, est inversé ou non par le firmware ; question Q5). |
| `INIT #id` | `ACK`, puis `DONE` : axes à leur position de départ, zéro des capteurs de pression, pompes à 0. Le firmware connaît les positions de départ (pas de nombre dans la commande). À envoyer **avant** le départ du match. |

Départ du match : le Pi attend `TIRETTE 1` puis `TIRETTE 0` ; l'instant `0` est l'instant t = 0 du match (**proposé** : exiger d'abord l'état « en place » évite de partir sur une tirette absente au démarrage du Pi). `ACT` lance de lui-même son chrono de fin de match au front 1 vers 0 de la tirette (§6 bis), sans attendre le Pi.

### 5.6 Canon : séance de tir

| Commande | Réponse | Rôle |
|---|---|---|
| `TIR #id` | `ACK`, puis `DONE` en fin de séance | **la seule sortie du canon** (déclaré par l'équipe : « une seule sortie séance de tir à activer ; l'ESP32 gère le reste »). Le firmware sort le canon, lance les volants, tire, et gère la fin de séance. |

Le Pi n'envoie aucun paramètre (nombre de boulets, cadence, volants) : ils sont dans le firmware (Q6). Le firmware ne tient **pas** la limite de 85 s (`phase_attaque_debut_s`) : le Pi envoie `TIR` assez tard pour que le premier boulet parte à partir de 85 s, sur la base de la durée de préparation (sortie du canon + mise en route) du moteur, `spec/robot.json` `canon_C` : 1,0 s + 0,5 s (statut « proposé » dans la spec). Voir §7. (Depuis §6 bis, `ACT` connaît le chrono du match ; l'utiliser pour la limite de 85 s est une option, Q6.)

`STOP #id` (ACT) : arrête les vérins, rotations et l'ascenseur, abandonne la séance de tir en cours (`ABORT`), laisse les pompes inchangées. Utilisé à la fin du match en doublon de l'arrêt autonome (§6 bis ; pénalité de 50 points si le robot bouge après la fin, `spec/regles_2027.json`).

### 5.7 État et télémétrie

`STATUS?` renvoie une ligne (les mêmes lignes sont envoyées périodiquement, §6) :

```
STATUS Z_A <hc> ROT_A <angle> Z_B <hc> ROT_B <angle> VAC_A <k1> <k2> <k3> VAC_B <k1> <k2> <k3> ASC <fx> <fz> TIR <etat> TIRETTE <v>
```

- `Z_x` : lecture du potentiomètre, convertie en `hc` ; `ROT_x`, `ASC` : position **estimée** par le firmware si le matériel n'a pas de capteur de retour (Q3) ; `VAC_x` : dépression en kPa par pompe ; `TIR` : `IDLE`, `RUN` ou `DONE` ; `TIRETTE` : 1 en place, 0 retirée.

## 6. Télémétrie périodique

Après `CFG TELEM_MS <ms>`, chaque ESP32 envoie spontanément sa ligne d'état : `POSE x y h ETAT` pour `NAV`, `STATUS …` pour `ACT`. Période **proposée** : **50 ms** (20 Hz) : la pose est au plus vieille de 50 ms, le lidar tourne à 10 Hz (typique, fiche constructeur, `spec/robot.json` `perception.lidar`), et le débit reste négligeable (environ 4 ko/s). Sans télémétrie, le Pi interroge (`POSE?`, `STATUS?`).

## 6 bis. Fin de match autonome (NAV et ACT)

**Pourquoi.** Au robot, le `STOP` de fin de match envoyé par le Pi peut arriver en retard (charge du Pi 5, pause du ramasse-miettes, USB). Un robot qui bouge après la fin coûte 50 points (`spec/regles_2027.json`, `penalites_utiles_simulation.robot_bouge_apres_fin`). Chaque ESP32 s'arrête donc **de lui-même** ; le `STOP` du Pi à la fin reste en doublon.

**Durée.** Le Pi envoie `CFG FIN_MS <ms>` à chaque ESP32 à l'initialisation, avant le départ : `ms = (durée du match − marge d'arrêt) × 1000`. La durée vient de la spec (`spec/regles_2027.json`, `match.duree_s` = 100 s) ; **aucune durée n'est écrite dans le firmware**. Marge d'arrêt **proposée** : 0,2 s (§9), soit `FIN_MS = 99800`. `CFG FIN_MS` est refusé (`NAK STATE MATCH`) pendant un match (il ne permet pas de repousser l'arrêt), accepté avant le départ et après la fin (il réarme le chrono pour un nouveau match).

**Instant de départ (choix).** Les deux ESP32 n'ont pas d'horloge commune ni avec le Pi : on n'échange donc que des **durées**, jamais des heures.

| ESP32 | Source du départ |
|---|---|
| `ACT` | **front 1 vers 0 de la tirette** (GPIO14), mesuré par son propre chrono : indépendant du Pi, donc de son retard. |
| `NAV` | `START <âge_ms> #id` envoyé par le Pi, qui a lu le chrono d'`ACT` (`CHRONO?`). |

Séquence côté Pi, dès que `EVT TIRETTE 0` est reçu : `h0` = heure du Pi ; `CHRONO?` à `ACT` (réponse `c` ms) ; puis `START <c + (h2 − h0)> #id` à `NAV`, où `h2` est l'heure du Pi à l'écriture de la ligne. `c + (h2 − h0)` est une **borne supérieure** du temps écoulé depuis le retrait (le chrono d'`ACT` est lu entre `h0` et la réponse, puis le temps du Pi s'ajoute) : si le Pi est en retard, `NAV` croit que le match est plus avancé et s'arrête plus tôt, jamais plus tard. L'erreur par excès est au plus un aller-retour USB (quelques ms) ; la seule erreur par défaut possible est le délai entre le calcul de l'âge et l'arrivée des octets chez `NAV` (nominalement quelques ms), couverte par la marge d'arrêt. `START` répété : l'instant de départ le plus ancien est conservé (un nouvel essai après un `ACK` perdu n'avance jamais l'arrêt). `START` est aussi accepté par `ACT` (essais de banc sans tirette : le Pi envoie `START 0` aux deux). L'instant de départ du Pi est `h0 − c` (borne la plus précoce) ; il vaut `t = 0` pour toutes les décisions du Pi.

*Choix écartés.* (a) `START` sans âge envoyé par le Pi aux deux : toute latence du Pi retarde l'arrêt, c'est le défaut qu'on corrige. (b) `START` horodaté aux deux : demande de synchroniser les horloges (inutile, les durées suffisent) et laisse `ACT` dépendre du Pi alors qu'il voit la tirette lui-même.

**À l'instant d'arrêt** (`FIN_MS` après le départ), sans aucun ordre du Pi :

| ESP32 | Comportement (**proposé**) |
|---|---|
| `NAV` | consigne de vitesse nulle sur les deux RoboClaw (décélération du firmware, Q9) ; `ABORT #id FIN` du mouvement en cours ; `EVT FIN` ; pose figée. |
| `ACT` | vérins Z, rotations, ascenseur arrêtés (`ABORT #id FIN` pour chaque voie occupée) ; séance de tir abandonnée (position finale du canon : Q6) ; **pompes inchangées** (garder l'état, comme au chien de garde ; **question Q12** : le règlement ne compte pas un élément encore contrôlé par un actionneur en fin de match, `spec/regles_2027.json` `element_controle_en_fin_de_match_non_compte`) ; `EVT FIN`. |

Ensuite, **verrou** : les commandes `SET_POSE`, `SET_LIMITS`, `GOTO`, `PATH` (NAV) et `INIT`, `Z`, `ROT`, `ASC`, `PUMP`, `TIR` (ACT) sont refusées par `NAK #id STATE FIN`. Restent acceptés : `HELLO`, `PING`, `CFG`, `STOP` (répond `ACK` puis `DONE`, sans effet : doublon du Pi), `POSE?`, `STATUS?`, `CHRONO?`, `START` (refusé, `NAK STATE FIN`). Le verrou se lève par `CFG FIN_MS` (nouveau match) ou à la remise sous tension (Q14).

**Sans `CFG FIN_MS`**, ou avec `FIN_MS 0`, aucun arrêt autonome : le firmware reste utilisable au banc.

## 7. Côté Pi : exécution d'un plan

Le moteur JS décide le temps masqué ; `esp32_bridge.traduire` transforme le plan d'une brique en commandes (aucune décision de séquencement dans ce module). Correspondance :

| Moteur (points clés) | Commande |
|---|---|
| `x, y, h` | `GOTO` (un segment) ou `PATH` (segments consécutifs sans autre dépendance) |
| `A.hc`, `B.hc` | `Z` avec `T=` |
| `A.rot`, `B.rot` | `ROT` avec `T=` |
| `C.fx`, `C.fz` | `ASC` avec `T=` |
| ventouses d'une face | `PUMP` |
| séance de tir (sortie du canon, mise en route, boulets) | `TIR` |

Règles (hypothèses du Pi, paramètres nommés de `ParamsESP32`) :

1. **Dépendances** : une commande part quand toutes celles que le moteur avait terminées avant son début sont terminées (`DONE`, ou `WPT` pour un point de `PATH`), et pas avant son instant nominal.
2. **Tir** : `TIR` n'est pas envoyé avant `85 s - préparation`, où la préparation est la durée de sortie du canon plus la mise en route lues dans le plan ; marge `marge_avant_tir_s` (hypothèse, 0 s).
3. **Délai maximal** par commande : `facteur_delai × durée du moteur + marge_delai_s` (hypothèses : 3 et 2 s). Passé ce délai, la brique échoue.
4. **Évitement** : tant qu'un déplacement est en cours, le Pi évalue la menace toutes les `periode_evitement_s` (hypothèse : 0,1 s, la cadence du lidar). Menace : le robot adverse est à moins de `rayon_securite_mm` du lidar (350 mm, hérité de `lidar_tracker.py`) et devant le robot dans le sens du déplacement. Alors : `STOP` à `NAV` ; les actionneurs continuent. Si la menace disparaît dans `attente_evitement_max_s` (hypothèse : 8 s, soit les 4 attentes de 2 s du moteur, `travel` dans `engine/engine.js`), le Pi renvoie la fin du trajet interrompu. Sinon la brique échoue (« évitement »), le réseau décide à nouveau. Même comportement que le moteur (`oppBlocks`).
5. **Fin du match** : à 100 s (`regles.match.duree_s`), `STOP` aux deux ESP32 (doublon de l'arrêt autonome, §6 bis). Si un ESP32 signale `EVT FIN` (ou refuse une commande par `NAK STATE FIN`) avant, le plan en cours s'arrête (« fin du match : arrêt autonome ») sans attendre.
6. **Démarrage** : ouverture des ports, `HELLO`, `CFG` (chien de garde, télémétrie, `FIN_MS`, seuil de vide), `SET_POSE`, `SET_LIMITS`, `INIT`, attente de la tirette, lecture du chrono d'`ACT` et `START` à `NAV` (§6 bis), début du match. Si `NAV` ne répond pas à `START` après `essais_start` essais, le Pi continue **sans arrêt autonome de NAV** et le journalise (erreur) ; `orch.armes` le dit (Q15).
7. **Marge de fin** (`marge_fin_s`, hypothèse : 0,5 s) : le Pi n'envoie plus aucune commande aux ESP32 après `fin − marge_fin_s` (le plan en cours échoue : « fin du match : commande non envoyée »), et **ne lance pas une brique** dont le plan du moteur ne finit pas avant `fin − marge_fin_s`. Le modèle interne n'est alors pas avancé : le moteur local joue la brique à blanc et restaure son état (`track_exec` avec `dtMax`, `embarque/bridge.js`). Le réseau n'est interrogé qu'une fois par instant de décision (un seul pas, l'état caché n'avance pas) : on prend la meilleure brique suivante dont le plan tient ; s'il n'y en a aucune, le robot reste immobile jusqu'à la fin du match puis envoie `STOP`.
8. **Temps simulé** (mock) : l'horloge virtuelle ne dépasse jamais l'instant de fin du match, même pour une brique sans commande (attentes internes du moteur).

## 7 bis. Firmware simulé (mock)

`FirmwareSimule` (`esp32_bridge.py`) parle ce protocole ligne à ligne derrière une `SerieSimulee` (même interface que pyserial) : le Pi utilise exactement le même code pour le robot et pour la simulation, et `pi5_runner.py --robot --mock-esp` rejoue un match sans matériel, en temps simulé. Il implémente `HELLO`, `PING`, `CFG`, `STOP`, `START`, `CHRONO?`, `SET_POSE`, `SET_LIMITS`, `GOTO`, `PATH` (avec `WPT`), `POSE?`, `INIT`, `Z`, `ROT`, `ASC`, `PUMP`, `TIR`, `STATUS?`, la télémétrie, le chien de garde, la tirette (`EVT TIRETTE`) et l'arrêt autonome de fin de match (§6 bis). Les événements d'un ESP32 simulé sont traités à leur instant exact même si l'horloge a sauté plus loin (Pi en retard de 0,5 s dans les tests) ; `mouvement_jusqua` (dernier instant où un axe a bougé) n'existe que dans le simulateur, pour les tests. Limites : pas de moteurs, donc la durée d'un mouvement est `T=` (sinon instantané) ; pour la base, distance / vitesse de `SET_LIMITS` ; une pompe en marche donne une dépression de 2 fois le seuil (`mock_vide_facteur`, hypothèse de test) ; la tirette est retirée 1 s après `INIT` (`mock_delai_tirette_s`). Un canal de test hors protocole (`programmee`) permet au pont de rejouer exactement les durées du moteur (base, séance de tir, pompes) et d'injecter des retards ; il n'existe pas sur le robot.

## 8. Codes d'erreur (proposés)

| Code | Où | Sens |
|---|---|---|
| `SYNTAX` | NAK | ligne illisible ou arguments manquants |
| `UNKNOWN` | NAK | commande inconnue |
| `RANGE` | NAK | valeur hors de la plage du firmware |
| `SPEED` | NAK | durée `T=` impossible à tenir |
| `BUSY` | NAK | voie occupée |
| `STATE` | NAK | commande interdite dans l'état actuel : `STATE FIN` (match terminé, verrou), `STATE MATCH` (`CFG FIN_MS` pendant un match), `STATE FIN_MS` (`START` sans `CFG FIN_MS`) |
| `FIN` | ABORT | interrompu par l'arrêt autonome de fin de match |
| `STALL` | FAIL | moteur bloqué |
| `TIMEOUT` | FAIL | position non atteinte dans le délai du firmware |
| `COMM` | FAIL, ERR | liaison interne en défaut (RoboClaw, ADS1115) |
| `OVERCURRENT` | FAIL, ERR | courant de vérin trop fort |
| `VACUUM` | FAIL | dépression insuffisante |
| `STOP` | ABORT | interrompu par `STOP` |
| `WATCHDOG` | ABORT | chien de garde |
| `REPLACED` | ABORT | remplacé par une commande plus récente sur la voie |

## 9. Valeurs proposées (hors spec et hors déclaration de l'équipe)

| Valeur | Proposition | Justification |
|---|---|---|
| Débit | 921 600 bauds | marge ; sans effet sur l'USB natif |
| Version du protocole | 1 | ce document |
| Format | lignes ASCII ≤ 200 octets, `#id` en fin de ligne | simplicité de lecture et d'écriture |
| Délai d'`ACK` | 20 ms | USB et boucle du firmware |
| Chien de garde / `PING` | 500 ms / 100 ms | 5 `PING` par fenêtre |
| Sécurité du chien de garde | `NAV` arrêtée, axes `ACT` arrêtés, pompes inchangées | ne pas lâcher les pierres |
| Télémétrie | 50 ms | pose au plus vieille de 50 ms, débit négligeable |
| `PATH` | 8 points au plus | longueur de ligne |
| `STOP` | sans verrouillage | reprise décidée par le Pi |
| `T=<ms>` | durée facultative sur `Z`, `ROT`, `ASC` | reproduire la coordination du moteur |
| `TIRETTE` | 1 = en place, 0 = retirée ; départ au front 1 vers 0 | éviter un départ sur tirette absente |
| Correspondance pompes | A: 1 à 3, B: 4 à 6, capteur `Pn` = pompe `n` | ordre de la carte, à valider |
| Pression | kPa de dépression, zéro étalonné à `INIT` | guide §8 |
| Délai maximal par commande | 3 × durée du moteur + 2 s | détecter un ESP32 muet |
| Évitement | test toutes les 0,1 s, rayon 350 mm, attente max 8 s | lidar 10 Hz, valeur héritée, 4 × 2 s du moteur |
| Marge avant tir | 0 s | rien ne justifie une marge sans mesure |
| Arrêt autonome de fin de match | `CFG FIN_MS 99800`, soit durée du match (spec, 100 s) − marge d'arrêt | §6 bis |
| Marge d'arrêt des ESP32 (`marge_arret_esp32_s`) | 0,2 s | immobile à 100 s : couvre l'incertitude sur le départ de NAV (un aller-retour USB, quelques ms) et le temps d'arrêt de la base, **inconnu** (décélération du firmware, Q9, Q13) ; à mesurer sur le robot |
| Départ de NAV | `START <âge_ms>`, âge = chrono d'ACT + temps du Pi depuis la question | borne supérieure du temps écoulé : NAV ne s'arrête jamais plus tard que prévu, même si le Pi est en retard |
| Départ d'ACT | front 1 vers 0 de la tirette, chrono local | indépendant du Pi |
| Marge de fin du Pi (`marge_fin_s`) | 0,5 s (au moins la marge d'arrêt, vérifié à la construction de `ParamsESP32`) | le Pi n'envoie aucun ordre et ne lance aucune brique qui finirait dans les 0,5 s avant la fin : 2,5 fois la marge d'arrêt des ESP32, pour qu'un Pi en bonne santé ne donne jamais un ordre que l'arrêt autonome couperait ; à remesurer sur le Pi 5 (latence de décision) |
| Essais de `START` | 3 | `ACK` perdu ; l'âge est recalculé à chaque essai |
| Pompes à la fin du match | état gardé, commandes refusées après la fin | cohérent avec le chien de garde ; Q12 |
| Verrou après la fin | levé par `CFG FIN_MS` ou remise sous tension | un nouveau match sans redémarrer les cartes ; Q14 |

## 10. Questions ouvertes pour l'équipe

1. **Port USB des kits** : prise USB native de l'ESP32-S3 (CDC) ou prise « UART » (pont) ? Elle fixe le comportement au démarrage (journaux du bootloader sur le port série) et le sens du débit.
2. **Vérins** : course et vitesse (`a_definir`), relation entre la hauteur d'axe `hc` et la course ; sens du potentiomètre (brochage à relire, guide §13).
3. **Rotations des nacelles, ascenseur du Graal, canon** : quel matériel les entraîne (moteurs, drivers, capteurs de retour) ? D'après le guide, l'ESP32 n°2 n'a que **GPIO41 et GPIO42** libres (J18) ; les deux rotations, l'ascenseur (deux axes dans le moteur : coulisse et hauteur) et le canon n'ont pas d'entrées de commande sur la carte. Sans capteur, `ROT`, `ASC` et le canon ne peuvent pas renvoyer de position mesurée.
4. **Pompes** : confirmer la correspondance face / rangée / pompe / capteur (§5.4) et les canaux des ADS1115.
5. **Tirette** : polarité du microrupteur (contact fermé tirette en place ou non), et anti-rebond (le chrono de fin de match part du premier front 1 vers 0 ; un rebond ne doit ni le relancer ni le retarder : durée du filtre à fixer dans le firmware).
6. **Séance de tir** : nombre de boulets par séance (10 au chargeur), retrait ou non du canon, ce que devient la séance si on appelle `STOP`. Le Pi doit-il pouvoir limiter le nombre de boulets ? Depuis §6 bis, `ACT` connaît le chrono du match : voulez-vous qu'il tienne lui-même la limite de 85 s (`TIR` reçu trop tôt = attente interne) plutôt que le Pi ?
7. **Recalage** : `SET_POSE` doit-il être accepté pendant un mouvement (recalage lidar en vol) ?
8. **Chien de garde de `ACT`** : confirmer que les pompes gardent leur état.
9. **Navigation** : tolérance d'arrivée, profil d'accélération et décélération (le moteur n'en modélise pas), vitesse d'approche (`vitesse_approche_mm_s` 200 mm/s est « hérité » dans la spec) : à transmettre ou à régler dans le firmware ?
10. **Horodatage** : faut-il joindre l'heure de l'ESP32 aux lignes de télémétrie pour compenser leur âge dans le calcul de la pose ?
11. **Caméras** : le recalage par tags ArUco est fait par le Pi (champ, objectif, hauteur : `a_definir`) et corrige la pose par `SET_POSE` avant la préhension ; à confirmer. Pas de commande dédiée dans ce protocole.
12. **Pompes à la fin du match** (§6 bis) : on propose de **garder leur état** (aucune action après la fin). Or `spec/regles_2027.json` (`element_controle_en_fin_de_match_non_compte`, et le Graal « encore contrôlé par un actionneur ») ne compte pas un élément encore tenu par un actionneur à 100 s. Faut-il (a) garder le vide (comme proposé : le moteur ne compte que les pierres libres, l'élément tenu vaut 0), (b) relâcher le vide juste avant la fin (la pierre tombe : compte-t-elle, y a-t-il une pénalité « perte de pièce », `perte_piece_robot` −20 ?), ou (c) laisser le moteur décider une brique de dépose (`lacher`) avant la fin ? La question d'arbitrage (FAQ / referee@planete-sciences.org) n'est pas tranchée par la spec : à poser à l'équipe.
13. **Temps d'arrêt de la base** : décélération du firmware `NAV` (RoboClaw) à 500 mm/s : distance et durée de freinage. La marge d'arrêt des ESP32 (0,2 s) est une hypothèse non mesurée ; elle doit être au moins égale à ce temps d'arrêt, plus l'incertitude de départ (quelques ms).
14. **Verrou après la fin** : acceptez-vous qu'il ne se lève que par `CFG FIN_MS` ou une remise sous tension (un Pi redémarré réarme les cartes au `initialize`) ? Faut-il un bouton ou une commande `RESET` explicite ?
15. **`START` de NAV refusé ou sans réponse** : on propose de continuer le match sans arrêt autonome de NAV (le Pi reste seul à l'arrêter, comme avant) en le journalisant. Préférez-vous refuser de jouer ?
16. **Marges inconnues du moteur** : le Pi refuse les briques qui finissent dans les 0,5 s avant la fin (`marge_fin_s`) ; le moteur et l'entraînement planifient jusqu'à 100,0 s (retour dans la salle du trône, dernier tir). Faut-il que le moteur utilise `durée − marge` comme fin effective (chantiers moteur / entraînement) ? Tant que ce n'est pas fait, une brique de retour au trône qui finit à 99,8 s est refusée par le Pi.
