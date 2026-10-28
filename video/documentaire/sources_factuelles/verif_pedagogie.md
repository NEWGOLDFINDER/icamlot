# Contrôle adversarial « pédagogie » du script documentaire

Objet : `script_documentaire.md`, `script_documentaire.json` et `voix_off_heygen.txt` (dossier `doc/`). Ils sont confrontés à `dossier_cerveau.md`, `dossier_monde.md`, `diagnostic_pierres.md` et au dépôt `/home/user/icamlot-audit` (commit `0161a45`, moteur 2.0.0). Contrôle fait le 2026-10-28.

Question posée : un sponsor non technicien comprend-il chaque étape (monde simulé, entrées, masque, couches, mémoire, renforcement, imitation, évaluation, export) ? Les analogies sont-elles justes techniquement ? Le rythme tient-il ?

Règle suivie : chaque constat renvoie à un fichier (`chemin:ligne`) ou à une mesure refaite ici (§8). Ce qui manque est marqué [À FOURNIR] ou [À CONFIRMER]. Aucun fichier du dépôt n'a été modifié.

Ce contrôle ne refait pas celui de `verif_honnetete.md` (renvois « H-n » = son problème P-n). Les textes proposés au §5 intègrent ses corrections : futur pour ce qui n'est pas fait, « dans le simulateur », pas de « deux cents matchs ».

## 1. Verdict

Le script est exact, mais il ne donne pas à comprendre. **Il nomme les étapes sans les expliquer.**

**Ce qu'un sponsor retient :**
- l'accroche « 116 seul, 108 face à un adversaire » ;
- « pas une image : cinquante-six nombres » ;
- « le réseau décide quoi faire ; le comment reste programmé à la main » ;
- « imiter », « examen ».

**Ce qu'il ne peut pas comprendre :**
- **Les règles du jeu.** La voix off ne prononce jamais « pierre », « mur », « tour », « porte », « trône » ni « score ». « Carrière » arrive en P05 sans définition.
- **Ce qu'est un réseau.** Le mot « couche » n'est jamais prononcé. Rien ne dit ce que fait un neurone, ni à quoi servent les « réglages ».
- **Ce qu'apprendre veut dire.** Le verbe « apprendre » n'est jamais prononcé. Rien ne relie les « cent quarante mille réglages » (P14) à l'apprentissage (P21).
- **Le choix d'une action.** P17 dit « la mieux notée l'emporte », P19 dit « il choisit presque au hasard ». Le script n'explique pas que ces deux phrases décrivent deux modes différents : l'examen et l'entraînement.
- **La mémoire et l'apprentissage.** Le sponsor risque de les confondre : il croira que le robot « se souvient » des matchs passés.
- **Le simulateur.** Le « pourquoi » (jouer beaucoup de matchs, vite) arrive 60 s après le « quoi ».

**Le rythme est celui d'une bande-annonce.** Les 9 notions de la mission tiennent en 71,4 s. Chacune a 3 à 6 s et une seule phrase. Il n'y a ni exemple, ni récapitulatif, ni connecteur de cause.

Ce rythme contredit les seuls mots du client relayés : « il faut que tu prennes le temps d'expliquer », « plus de limite de temps », « de la pédagogie sur comment on crée ce réseau de neurones ». Ses mots priment sur la limite de 90 à 120 s que le script dit tenir de « la commande du flux » (§8.1 du script ; voir aussi H-19).

**Correction centrale (§5) :** une version longue de 39 phrases (787 mots, environ 5 min 15 s à 150 mots/min). Chaque phrase est sourcée. Chaque notion y reçoit un pourquoi, un exemple et un lien avec la suivante. Durée cible : [À CONFIRMER] par le client.

## 2. Mesures clés

| Mesure | Valeur | Source |
|---|---|---|
| Durée du film | 110,6 s, 29 plans, soit 3,8 s par plan en moyenne | `script_documentaire.json` |
| Temps donné aux 9 notions de la mission (P07 à P24) | 71,4 s : monde simulé 15,4 ; entrées 13,6 ; couches 4,4 ; mémoire 3,2 ; sorties 3,2 ; masque et choix 3,6 ; quoi/comment 5,0 ; départ au hasard 2,8 ; imitation 4,0 ; renforcement 5,6 ; vitesse 2,8 ; examen 3,2 ; export 4,6 | `densite.py`, `ecart_voix_guide.out` |
| Mots absents de la voix off | « pierre », « mur », « tour », « porte », « trône », « score », « apprendre » : 0 occurrence ; « apprentissage » : 1 (P25, « chaîne d'apprentissage ») | `grep` sur `voix_off_heygen.txt` |
| Connecteurs de cause dans la voix off | « parce que », « car », « donc », « pourquoi », « ainsi » : 0 | idem |
| Pronom « il » | 9 fois. Il désigne le robot en P04 et P09, le réseau de P13 à P24 | idem |
| Texte à l'écran | 557 mots, contre 255 mots de voix, et 92 nombres. Plans les plus chargés : P29 15,5 mots/s ; P10 11,4 ; P22 8,9 ; P16 8,1 ; P05 7,5 ; P12 7,5 | `densite.out` |
| Voix guide comparée au découpage | la voix dépasse la durée prévue dans 18 plans sur 26 : P12 +2,26 s, P02 +1,34 s, P23 +0,74 s, P16 +0,69 s. Son débit va de 95,9 à 196,6 mots/min selon les plans | `voix_guide_script/durees.csv`, `ecart_voix_guide.out` |
| Contenu du fichier exporté (`fumee.onnx`, même architecture) | 123 506 valeurs float32, soit 494 024 octets (99,35 % des 497 261 octets) : 123 394 réglages et 112 valeurs de normalisation | `onnx_init.py` (lecture du protobuf, sans le paquet `onnx`) |

## 3. Grille par étape

| Étape | Le sponsor comprend-il ? | L'analogie est-elle juste ? | Problèmes |
|---|---|---|---|
| Règles du jeu | Non. Les objets du jeu ne sont jamais nommés à l'oral. | sans objet | PED-2 |
| Programme écrit à la main et cerveau | Partiellement. Le contraste n'est jamais expliqué : le programme est une liste figée de 15 étapes (`engine/engine.js:1666-1675`). | « programmé à la main » : juste | PED-3 |
| Monde simulé | Le « quoi », oui ; le « pourquoi », non | « recréer le monde » : juste, mais « au millimètre » est discutable (H-18) | PED-9, PED-20, PED-21 |
| Entrées | Oui pour « 56 nombres ». Non pour la façon dont une information devient un nombre (seulement à l'écran). | « perçoit » : juste ; « croit » : juste dans les entrées, mais le filtre lit la vérité (H-9) | PED-14, PED-23 |
| Couches | Non : « couche » n'est jamais dit, « neurone » n'est pas défini | le fil qui porte un curseur (le « réglage ») est juste pour un poids | PED-6 |
| Mémoire | Ambigu : le sponsor peut confondre mémoire et apprentissage | « mémoire » : juste dans le match (`trainer/models.py:141-145`) | PED-8 |
| Sorties et masque | Les « notes » : oui. Le « doit » de « un filtre doit écarter » : non | « filtre » : juste (`trainer/models.py:22-23`) | PED-11 |
| Choix | Non : la contradiction entre P17 et P19 n'est pas résolue | « la mieux notée l'emporte » : juste à l'examen seulement | PED-5 |
| Imitation | Le « quoi », oui ; le « pourquoi » et le passage au score, non | « professeur et élève » : juste (entropie croisée, `trainer/imitation.py:1-9`) | PED-13 |
| Renforcement | Non : la phrase et l'image enseignent une idée fausse | « renforce les choix qui l'ont rapporté » : incomplète. Il manque « plus que prévu » et le crédit donné aux choix antérieurs. | PED-7, PED-10 |
| Évaluation | Partiellement : « version » n'est pas défini, et la différence avec l'entraînement n'est pas dite | « examen », « champion » : justes ; « deux cents matchs » : voir H-6 | PED-12 |
| Export | Non : « exporté » est du jargon, et rien ne relie le fichier aux réglages | « demi-mégaoctet » : juste (497 261 octets) | PED-10, PED-24 |
| Bilan | Non : il n'y a pas de récapitulatif, et « chaîne d'apprentissage de bout en bout » est du jargon | — | PED-17 |

## 4. Problèmes détaillés (du plus grave au moins grave)

### PED-1 · ensemble du film · critique · le rythme contredit la demande du client
- **Constat** :
  - 110,6 s en tout ; les 9 notions de la mission tiennent en 71,4 s, soit 3 à 6 s et une phrase chacune (§2).
  - L'annexe A, prévue « si la limite est levée », ajoute des faits (134 pts, trois millionièmes, et d'autres). Elle n'ajoute aucune explication.
- **Problème** : la seule parole du client dit « prendre le temps d'expliquer », « plus de limite de temps » et « pédagogie sur comment on crée ce réseau de neurones ». Le script s'impose 120 s au nom d'une « commande du flux » (§7.7 et §8.1 du script). Un sponsor non technicien ne peut pas suivre une nouvelle notion toutes les 4 s, sans exemple.
- **Correction** : adopter la version longue du §5, environ 5 min 15 s à 150 mots/min, plans muets en plus. Garder l'annexe A seulement pour les lignes corrigées par H-8 et H-29. Durée finale : [À CONFIRMER] par le client.

### PED-2 · P02 à P05 · majeure · les règles du jeu ne sont jamais dites
- **Extrait** : « Cent secondes pour bâtir son château. » (P02) ; « si l'adversaire lui prend une carrière » (P05).
- **Problème** :
  - « pierre », « mur », « tour », « porte » et « trône » ne sont jamais prononcés. Ils n'apparaissent qu'à l'écran, en 4 s (P02) ou en cotes (P07).
  - « Carrière » est un terme du règlement, utilisé avant d'être défini.
  - Sans les règles, « 116 » et « 108 » ne veulent rien dire, et l'image de P04 (murs, tour, porte) n'est pas lisible.
- **Correction** : ajouter les phrases A2 et A3 (§5), sourcées par `spec/regles_2027.json:91-188`, `:316-328` et `:359-373`. Image : une pile de 3 pierres, puis un mur, une tour, une porte, chaque construction avec ses points (barème F06).

### PED-3 · P04, P13 à P24 · majeure · qui est qui ? programme, cerveau, robot
- **Extrait** :
  - « Seul, programmé à la main, il marque… » (P04, « il » = le robot) ;
  - « Il garde une mémoire » (P15, « il » = le réseau) ;
  - « Il commence par imiter un programme écrit à la main » (P20).
- **Problème** :
  - Le même pronom désigne le robot puis le réseau. Juste après P04, le spectateur peut croire que le « il » qui imite (P20) est celui qui a marqué 116 points.
  - Le robot jaune est piloté par le programme en P04, mais porte l'étiquette « Cerveau : quoi faire » en P18. En P20, le professeur porte un liseré blanc.
  - La phrase clé « quoi / comment » n'arrive qu'à 62,6 s (P18), après la perception et les sorties. Le spectateur ignore jusque-là ce que le cerveau décide.
  - Le script ne dit jamais ce qu'est un « programme écrit à la main » : une liste figée de 15 étapes (`engine/engine.js:1666-1675`).
- **Correction** :
  - phrases A6, A8 et A9 (§5), avec la phrase « quoi / comment » placée juste après l'objectif ;
  - un code visuel constant : une couleur pour « programme écrit à la main » (robots de match, professeur), une autre pour « cerveau » (réseau abstrait, hors du robot, voir H-30) ;
  - pas de « il » en début de plan : écrire « le robot » ou « le cerveau ».
  - Confidentialité : ne montrer ni le contenu de la liste (ordre de la stratégie, à arbitrer, §4 du script), ni le mot « pinces ». Dire « gestes ».

### PED-4 · P14, P21 · majeure · « apprendre = ajuster les réglages » n'est jamais dit
- **Extrait** : « cent quarante mille réglages » (P14) ; « chaque point marqué renforce les choix qui l'ont rapporté » (P21).
- **Problème** :
  - Le spectateur apprend que les réglages existent, mais pas qu'ils sont tirés au hasard au départ (`trainer/models.py:122-129`).
  - Il n'apprend pas non plus que l'apprentissage consiste à les modifier (`trainer/ppo_trainer.py:259-277`, `trainer/imitation.py:141-161`).
  - Le verbe « apprendre » est absent de la voix off (§2).
  - C'est pourtant l'idée centrale de « comment on crée ce réseau ».
- **Correction** : phrases D3, E2 et E6 (§5). Image : les curseurs des fils (P14) bougent à chaque mise à jour, en P20 et en P21.

### PED-5 · P17 et P19 · majeure (technique) · « la mieux notée l'emporte » contre « il choisit presque au hasard »
- **Extrait** : P17 « la mieux notée l'emporte » ; P19 « Au départ, il choisit presque au hasard. » ; image P19 « un curseur saute d'une barre à l'autre au hasard ».
- **Problème** :
  - Si la mieux notée l'emporte toujours, des notes presque égales donnent un choix fixe, pas un choix au hasard. Les deux phrases ne sont vraies que dans deux modes que le script ne distingue pas.
  - À l'entraînement, l'action est tirée au sort selon les notes : `dist.sample()` (`trainer/ppo_trainer.py:190-191`).
  - À l'examen et en match, c'est la note la plus haute : `argmax` (`trainer/evaluation.py:83-84`, `trainer/ppo_trainer.py:318`, `deterministic=True`).
  - Le hasard de l'entraînement sert à essayer d'autres choix. Un bonus d'entropie l'entretient (coefficient 0,01, `trainer/ppo_trainer.py:60-61`, `:273`).
  - Un sponsor attentif verra la contradiction. Les autres manqueront la notion d'exploration.
- **Correction** :
  - P17 : « En match, le cerveau joue l'action la mieux notée. » (D8) ;
  - P19 : « Au départ, ses cent trente notes sont presque égales : aucune action n'est préférée. » (E1) ;
  - ajouter E4 : « Pendant cet entraînement, il ne jouera pas toujours sa meilleure note : il tirera au sort, selon ses notes, pour essayer d'autres choix. »

### PED-6 · P14 · majeure · couches et neurones jamais expliqués
- **Extrait** : voix « Ces nombres traversent un réseau de neurones : cent quarante mille réglages. » ; image « 56 → 128 (avec normalisation) → mémoire 128 → 130 ».
- **Problème** :
  - Le sponsor voit des boîtes et des chiffres, sans savoir ce qui s'y passe.
  - « (avec normalisation) » est du jargon : il n'aide pas et n'est pas expliqué.
  - Le calcul est pourtant simple et documenté : chaque neurone fait une somme pondérée plus un biais, puis une remise à l'échelle et une activation (`trainer/FORMAT_MODELE.md:16-24`, `:88`).
- **Correction** : phrases D1 à D3 (§5). Image : zoom sur un neurone, avec 56 fils qui arrivent, chacun multiplié par son curseur, puis la somme. Retirer « (avec normalisation) » de l'image publique ; le garder dans le dossier interne.

### PED-7 · P21 · majeure (analogie fausse par omission) · ce que « renforcer » veut dire
- **Extrait** : voix « chaque point marqué renforce les choix qui l'ont rapporté » ; image « au moment où un mur est posé, « +8 » s'envole… La barre de l'action « mur » grandit, les autres baissent un peu ».
- **Problème** :
  - La récompense d'une décision est la variation de score pendant sa brique (`engine/env.js:357-360`). « Prendre » rapporte donc 0 point.
  - Si seule l'action qui marque était renforcée, comme le montre l'image, le réseau n'apprendrait jamais à prendre des pierres. Le code évite cela de deux façons :
    - l'objectif est le score final (γ = 1) et le crédit remonte aux choix précédents (GAE, λ = 0,95) : `trainer/ppo_trainer.py:55-56`, `:223-236` ;
    - un choix n'est renforcé que s'il fait **mieux que prévu** par le critique (avantage) ; s'il fait moins bien, il devient moins probable (`trainer/ppo_trainer.py:261-267`).
  - F29 du script le dit (« plus que prévu »), mais la voix l'a perdu.
  - Le « +8 » pose aussi un problème d'honnêteté : voir H-13.
- **Correction** :
  - voix E5 et E6 (§5) ;
  - image : une jauge « prévu / obtenu » ; quand le mur est posé, les barres « mur » **et** « prendre » (le choix qui l'a rendu possible) grandissent un peu ; dans un autre match moins bon que prévu, une barre baisse ;
  - « un peu » est justifié par l'écrêtage à 0,2 (`trainer/ppo_trainer.py:57`, `:267`).

### PED-8 · P15, P06 · majeure · confusion entre mémoire et apprentissage, et « s'adapte » mal compris
- **Extrait** : « Il garde une mémoire d'une décision à l'autre. » ; « un cerveau qui s'adapte » ; la remise à zéro n'est écrite qu'à l'écran.
- **Problème** :
  - Pour un non-technicien, « mémoire » et « s'adapte » suggèrent un robot qui se souvient des matchs passés et apprend pendant le match. Le code fait autrement :
    - l'état caché repart de zéro à chaque match (`trainer/models.py:141-145`, `trainer/ppo_trainer.py:3-4`) ;
    - ce qui est appris d'un match à l'autre est stocké dans les réglages ;
    - à bord, le fichier ne contient que le calcul de la décision (`trainer/FORMAT_MODELE.md:5-12`), et le calendrier prévoit un « gel » (`AUDIT_SIMULATEUR_IA.md:335`).
  - « S'adapter » ne peut donc vouloir dire que choisir selon ce qu'il perçoit et ce dont il se souvient dans le match (`engine/env.js:421`).
- **Correction** : phrases D4, D5 et E10 (§5).

### PED-9 · P07 et P22 · majeure · le pourquoi du simulateur arrive trop tard
- **Extrait** : « D'abord, on recrée le monde… » (P07, à 19,2 s) ; « Un match s'y joue en six secondes. » (P22, à 80,0 s).
- **Problème** : le spectateur ne sait pas pourquoi on recrée le monde. La raison, jouer beaucoup de matchs vite et en parallèle (`trainer/js_env_pool.py:1-12`), n'arrive que 60 s plus tard, dans un autre chapitre.
- **Correction** : ouvrir le chapitre par B1 et avancer P22 en B6 (§5). Pour l'ordre de grandeur, seule l'estimation de l'audit existe : « plus de 100 000 matchs par jour » possibles (`AUDIT_SIMULATEUR_IA.md:318`, ESTIMÉ). Ne pas citer de nombre de matchs nécessaires : [À CONFIRMER] par l'équipe.

### PED-10 · P14 et P24 · moyenne · « 140 035 / 123 394 » et « demi-mégaoctet » non reliés
- **Extrait** : écran P14 « 140 035 paramètres à l'entraînement · 123 394 dans la version qui joue » ; P24 « il tient en un demi-mégaoctet ».
- **Problème** :
  - L'écart vient du critique, qui ne sert qu'à l'apprentissage et n'est pas exporté (`trainer/models.py:1-5`, `trainer/FORMAT_MODELE.md:90`). Le script ne présente jamais le critique : le chiffre reste une énigme.
  - Le lien entre le fichier et les réglages n'est pas fait, alors qu'il est mesurable : 99,35 % du fichier `fumee.onnx` sont les 123 394 réglages et 112 valeurs de normalisation, à 4 octets chacun (§8).
- **Correction** : E5 présente le critique ; E9 explique l'export (« on ne garde que la partie qui décide… un fichier d'un demi-mégaoctet, qui contient pour l'essentiel ses cent vingt-trois mille réglages »). Retirer la ligne « 123 394 » de P14 et la placer en E9.

### PED-11 · P17 · moyenne · le « doit » du filtre ne s'entend pas, et il manque un exemple
- **Extrait** : « Un filtre doit écarter l'impossible ; la mieux notée l'emporte. » La note du script dit : « « Doit » est volontaire : le filtre n'est pas encore fiable ».
- **Problème** :
  - À l'oral, « doit » s'entend comme le rôle du filtre, pas comme une réserve : la nuance voulue est perdue.
  - Deux notions (filtre et choix) tiennent en 9 mots et 3,6 s.
  - Aucun exemple ne dit ce qu'est une action « impossible ».
- **Correction** : D7 dit la réserve en clair, avec un exemple sourcé : bâtir un mur sans tenir de pierres est refusé (`engine/actions.js:636`). D8 porte le choix, dans un plan séparé.

### PED-12 · P23 · moyenne · l'examen : « version », « pourquoi », « quand »
- **Extrait** : « Deux cents matchs d'examen désignent la meilleure version. » ; image « Trois versions du cerveau (v1, v2, v3) ».
- **Problème** :
  - « Version » n'est pas défini.
  - Le script ne dit pas pourquoi un examen distinct est nécessaire. Le cerveau y joue sans tirage au sort (`trainer/ppo_trainer.py:318`), sur des matchs fixés, les mêmes pour tous les modèles (`trainer/scenarios.py:91-95`, « pour que deux modèles soient comparés sur les mêmes matchs »).
  - Par défaut, l'examen n'a lieu qu'à la fin de l'entraînement (`eval_tous_les = 0`, « seulement à la fin », `trainer/ppo_trainer.py:81`). L'image de trois versions suppose un réglage que l'équipe n'a pas encore choisi.
- **Correction** : E8 (§5), sans « deux cents » (H-6). Fréquence des examens : [À CONFIRMER] par l'équipe (option `--eval-tous-les`).

### PED-13 · P20 · moyenne · imitation : ni pourquoi, ni comment, ni transition
- **Extrait** : « Il commence par imiter un programme écrit à la main. »
- **Problème** : le script ne dit pas :
  - **pourquoi** on imite : c'est un « démarrage à chaud » (`trainer/imitation.py:1`) ;
  - **comment** : on ajuste les réglages pour que l'élève donne la meilleure note au choix du professeur (entropie croisée, `trainer/imitation.py:131-154`) ;
  - **ce qui change ensuite** : la perte PPO ne contient plus de terme d'imitation, seul le score guide (`trainer/ppo_trainer.py:261-273`).
- **Correction** : E2 et E3 (§5), au futur (H-5, H-23).

### PED-14 · P12 · moyenne · entrées : 5 groupes en 4 s, l'exemple seulement à l'écran
- **Extrait** : « Le temps, sa position, ses constructions, l'adversaire, l'espace libre autour. » ; image « temps 0,837 → chrono (83,7 s restantes) ».
- **Problème** :
  - La voix guide met 6,26 s pour dire cette phrase, contre 4,0 s prévues : les blocs « qui s'allument au mot prononcé » seront décalés.
  - Le moment le plus pédagogique (une information devient un nombre) n'est qu'à l'écran, au milieu de 30 mots et 8 nombres.
  - Attention : « tous les nombres sont entre 0 et 1 » serait faux, car le cap est codé en cosinus et sinus, entre −1 et 1 (`engine/env.js:84`).
- **Correction** : C2 donne un seul exemple oral, tiré de la formule (100 − t) / 100 (`engine/env.js:81`) : « s'il reste la moitié du match, l'entrée « temps » vaut zéro virgule cinq ». C3 donne ensuite la liste, plus lentement. À l'écran, un exemple à la fois.

### PED-15 · P05, P07, P10, P12, P16, P22, P26, P29 · moyenne · trop de texte à l'écran
- **Constat** : 557 mots écrits pour 255 mots dits, et 92 nombres à l'écran. Les plans les plus chargés :
  - P10 : 25 mots en 2,2 s ;
  - P29 : 31 mots en 2,0 s ;
  - P22 : 25 mots en 2,8 s ;
  - P16 : 26 mots en 3,2 s ;
  - P05 : 27 mots en 3,6 s ;
  - P07 : 7 lignes et 15 nombres.
- **Problème** : le spectateur doit lire et écouter deux textes différents en même temps. Les lignes que le script juge essentielles à l'honnêteté (« illustration », « pas le réseau ») se perdent dans la masse.
- **Correction** :
  - à l'écran, seulement ce que la voix dit, plus une étiquette de statut (« simulation », « illustration », « prévu ») ;
  - listes longues (familles d'actions P16, calendrier P26, générique P29) : plans dédiés, sans voix simultanée, d'au moins [À CONFIRMER] secondes, ou retrait ;
  - lisibilité à vérifier par un visionnage test avec un non-technicien [À CONFIRMER].

### PED-16 · tout le découpage · moyenne · durées calculées à 0,4 s par mot
- **Constat** :
  - Avec la voix guide, la voix dépasse son plan dans 18 plans sur 26 ; jusqu'à +2,26 s (P12).
  - Son débit varie de 95,9 à 196,6 mots/min.
  - Aucune respiration n'est prévue entre chapitres, sauf P01 (1,0 s) et P29 (2,0 s).
- **Problème** : les animations calées « au mot » (P12, P14, P21) vont se décaler, et le spectateur n'a aucun temps pour encaisser une notion avant la suivante.
- **Correction** :
  - recaler chaque plan sur la voix HeyGen définitive, pas sur 0,4 s par mot ;
  - prévoir une respiration muette d'une à deux secondes et un carton de chapitre à l'écran à chaque changement de chapitre (aujourd'hui, seul P06 en affiche un).

### PED-17 · P25 à P27 · moyenne · ni fil rouge, ni récapitulatif
- **Problème** :
  - Le cœur du système est une boucle : le monde donne 56 nombres et un masque, le cerveau choisit, la brique est exécutée, le score change, et on recommence (`engine/env.js:343-376`). Le film ne la montre jamais en une seule image.
  - La fin passe directement au statut, avec du jargon (« chaîne d'apprentissage », « de bout en bout »).
- **Correction** :
  - un schéma de boucle récurrent, qui revient à chaque chapitre et allume l'étape en cours ;
  - le récapitulatif F1 avant le bilan ;
  - F2 reprend la formulation de H-7.

### PED-18 · P06 et chapitre 5 · moyenne · la promesse « s'adapter » n'est pas tenue dans l'explication
- **Problème** : P06 pose l'objectif « s'adapter à l'adversaire », mais le chapitre 5 ne dit pas comment l'entraînement pourrait y mener. L'équipe a décidé un entraînement contre plusieurs adversaires (`docs/CONTRATS.md:151`) ; par défaut, l'entraînement se fait aujourd'hui sans adversaire (`trainer/ppo_trainer.py:77`).
- **Correction** : E7, au futur (H-8), et E10 pour le sens de « s'adapter » (voir PED-8).

### PED-19 · P06, P11, P14 · mineure · « cerveau » et « réseau de neurones » : l'équivalence n'est pas dite
- **Problème** : P11 demande « Que perçoit le cerveau ? » avant que P14 n'introduise le « réseau de neurones ». Le lien entre les deux mots reste implicite. Le mot « cerveau » vient du dépôt (dossier `cerveau/`), mais il peut faire imaginer une intelligence générale.
- **Correction** : A8 met « cerveau » entre guillemets et le définit par son rôle. D1 dit : « Ces cinquante-six nombres entrent dans un réseau de neurones. »

### PED-20 · P08 · mineure · trajets : de qui parle-t-on ?
- **Problème** :
  - Placé dans « le monde », le calcul des trajets sur une grille peut être attribué au cerveau. Or c'est le « comment » écrit à la main (`engine/engine.js:384-425`, `AUDIT_SIMULATEUR_IA.md:15`).
  - Ce calcul est celui du simulateur. Sur le robot réel, l'exécution est prévue sur les ESP32 (`AUDIT_SIMULATEUR_IA.md:260`) ; la méthode de trajet à bord est [À CONFIRMER].
- **Correction** : B3 (« Les trajets y sont calculés… ») et l'étiquette « code écrit à la main · simulateur ». Pour la confidentialité de la grille, voir H-31.

### PED-21 · P10 · mineure · « tests » sans exemple, et exemple à ne pas surestimer
- **Problème** :
  - Le sponsor ne sait pas ce qu'est un test automatique, et le plan dure 2,2 s.
  - Le libellé « bareme.js identique au barème de spec/regles_2027.json » (`tests/test_moteur.js:28`) vérifie la grille de points. Il ne vérifie pas le comptage, qui garde un défaut connu (`engine/score.js:74-80` contre `spec/regles_2027.json:324`).
- **Correction** : B5 : « …par exemple, que la grille de points utilisée est bien celle du règlement. » Ne pas dire « que les points sont bien comptés ».

### PED-22 · P22 · mineure · « se joue » ou « se calcule »
- **Extrait** : « Un match s'y joue en six secondes. »
- **Problème** : « se joue » peut faire croire que le robot simulé va plus vite. C'est un temps de calcul (voir aussi H-22).
- **Correction** : B6 : « un match de cent secondes s'y calcule en six secondes environ ». Écran : « temps de calcul · machine de test, 1 cœur, choix au hasard ».

### PED-23 · P13 · mineure · la croyance entendue comme un défaut, sans son pourquoi
- **Problème** :
  - « Une carrière reste pleine tant qu'il n'y est pas allé » sonne comme une erreur du robot. La raison n'est pas dite : à bord, l'information viendra de ce que voient le lidar et les caméras (`docs/CONTRATS.md:76-79`, prévu).
  - Le filtre, lui, lit encore l'état réel (H-9).
- **Correction** :
  - soit passer P13 en plan d'extension avec la réserve de H-9 ;
  - soit dire : « Pour les carrières, on ne lui donne que ce qu'il a constaté lui-même : une carrière reste pleine, pour lui, tant qu'il n'y est pas allé. » avec la mention « à bord, prévu avec le lidar et les caméras » [À CONFIRMER : calendrier].

### PED-24 · P24 · mineure · « Exporté »
- **Problème** : « Exporté » est du jargon informatique.
- **Correction** : E9 décrit ce qu'on garde et ce que contient le fichier. Écran : « Fichier pour l'ordinateur de bord (Raspberry Pi 5) · prévu, pas encore testé à bord » (`spec/robot.json:328-331`, H-14).

### PED-25 · P01, P29 · mineure · plans trop courts pour ce qu'ils portent
- **Problème** : P01 (1,0 s) doit faire passer un noir, une lumière rasante, une macro et de la poussière. P29 (2,0 s) affiche 5 lignes et 31 mots.
- **Correction** : allonger P01 et P29 ; durées à fixer au montage [À CONFIRMER].

### PED-26 · annexe A · mineure · elle ajoute des faits, pas de la compréhension
- **Problème** : « à trois millionièmes près » (après P24) est une précision technique sans valeur pour un sponsor. « Cent trente-quatre points » (après P05) est utile comme échelle pour 116, avec la formulation de H-29.
- **Correction** : garder « cent trente-quatre » (corrigé par H-29) juste après A5 ; retirer « trois millionièmes » de la version publique.

## 5. Version longue proposée (voix off), avec sources

Fichier : `/tmp/claude-0/-home-user-icamlot/7624d51f-7be7-5b87-ae0f-1fda87a83f3b/scratchpad/verif_pedagogie/voix_proposee.txt` (format `identifiant|texte`, compatible avec l'outil de voix guide).

- **Volume** : 39 phrases, 787 mots, soit environ 315 s à 150 mots/min et 342 s au débit de la voix guide (138 mots/min), sans les plans muets.
- **Temps** : futur pour ce qui n'est pas fait ; présent pour décrire les composants.
- **Confidentialité** : les phrases ne nomment ni pinces, ni faces, ni canon, ni ascenseur.

| Id | Remplace | Texte | Sources |
|---|---|---|---|
| A1 | P02 | Eurobot deux mille vingt-sept, la Coupe de France de robotique. Un match dure cent secondes. | `index.html:7` ; `spec/regles_2027.json:8-12` |
| A2 | nouveau | Sur la table, trente « pierres », des blocs de trente-deux centimètres, rangés par trois dans dix « carrières ». | `spec/regles_2027.json:91-188` |
| A3 | nouveau | Chaque robot les rapporte dans son château pour bâtir des murs, des tours et une porte ; chaque construction rapporte des points. À la fin, il doit aussi rentrer dans sa salle du trône. | `spec/regles_2027.json:316-328`, `:359-373` |
| A4 | P03 | Voici notre robot, ICAM LOT, tel que nous le simulons. | H-2 |
| A5 | P04 | Dans notre simulateur, un programme écrit à la main lui fait marquer cent seize points. | H-3 ; `docs/CONTRATS.md:133` |
| A6 | nouveau | Ce programme est une liste de quinze étapes, écrite avant le match. | `engine/engine.js:1666-1675` (15 entrées) |
| A7 | P05 | Mais si l'adversaire vide une carrière avant lui, le programme suit quand même sa liste : il ne marque plus que cent huit points. | `docs/CONTRATS.md:150` ; `dossier_cerveau.md` §1.2 (2 erreurs : P10 absente, puis mur impossible) |
| A8 | P06 | Notre objectif : un « cerveau » qui choisit lui-même sa prochaine étape, selon ce qui se passe sur la table. Fera-t-il mieux ? C'est ce qu'il reste à prouver. | `engine/env.js:421` ; `trainer/README.md:3` ; `docs/CONTRATS.md:150` ; H-17 |
| A9 | P18, avancé | Ce cerveau ne conduit pas le robot : il choisit quoi faire ; le comment, trajets et gestes, reste programmé à la main. | `AUDIT_SIMULATEUR_IA.md:15` ; `engine/actions.js:141-172` |
| B1 | nouveau | Pour apprendre, ce cerveau devra jouer un très grand nombre de matchs. Impossible sur une vraie table : on recrée donc le match dans l'ordinateur. | `AUDIT_SIMULATEUR_IA.md:318` (estimation) ; nombre visé [À CONFIRMER] |
| B2 | P07 | On y reproduit la table, les pierres et les règles, d'après les cotes du règlement. | `spec/regles_2027.json:2-6` ; H-18 |
| B3 | P08 | Les trajets y sont calculés sur un quadrillage de cases de quatre centimètres, sans jamais toucher un obstacle. | `engine/engine.js:384-425` |
| B4 | P09 | Si l'adversaire passe à moins de quarante centimètres devant lui, notre robot simulé attend. | `engine/engine.js:129-138`, `:494-511` ; H-24 |
| B5 | P10 | Quatre-vingt-trois tests automatiques contrôlent ce simulateur : par exemple, que la grille de points utilisée est bien celle du règlement. | `tests/test_moteur.js:28` ; `docs/CONTRATS.md:119` |
| B6 | P22, avancé | Résultat : un match de cent secondes s'y calcule en six secondes environ, et plusieurs matchs tournent en même temps. | F30 ; `trainer/js_env_pool.py:1-12` ; H-22 |
| C1 | P11 | Que perçoit le cerveau ? Pas une image : cinquante-six nombres. | `engine/env.js:4-16` |
| C2 | nouveau | Chaque information devient un nombre. S'il reste la moitié du match, l'entrée « temps » vaut zéro virgule cinq. | `engine/env.js:81` |
| C3 | P12 | Il y a aussi sa position, ses constructions, la position de l'adversaire, et l'espace libre autour de lui, dans huit directions. | `engine/env.js:82-85`, `:96-100`, `:112-115`, `:125-139` |
| (C4) | P13 | facultatif, voir PED-23 et H-9 | `engine/env.js:144-151` |
| D1 | P14 | Ces cinquante-six nombres entrent dans un réseau de neurones. Concrètement, c'est un calcul : surtout des multiplications et des additions. | `trainer/FORMAT_MODELE.md:14-30` |
| D2 | nouveau | Première couche : cent vingt-huit « neurones ». Chacun additionne les cinquante-six nombres, multipliés chacun par un coefficient qui lui est propre, puis transforme ce total. | `trainer/FORMAT_MODELE.md:16-24`, `:88` ; `trainer/models.py:89-100` |
| D3 | nouveau | Ces coefficients sont les réglages du réseau : environ cent quarante mille en tout. Au départ, ils sont tirés au hasard ; apprendre, ce sera les ajuster. | `dossier_cerveau.md` §5.2-5.3 ; `trainer/models.py:122-129` ; `trainer/ppo_trainer.py:259-277` |
| D4 | P15 | Vient ensuite une mémoire : cent vingt-huit nombres qu'il met à jour à chaque décision, en gardant une partie et en réécrivant le reste. Sa décision peut ainsi tenir compte de ce qui s'est passé avant. | `trainer/FORMAT_MODELE.md:25-32` (h' = (1 − z) ⊙ n + z ⊙ h) |
| D5 | nouveau | Cette mémoire s'efface à chaque nouveau match. Ce qu'il apprend d'un match à l'autre est rangé ailleurs : dans ses réglages. | `trainer/models.py:141-145` ; `trainer/ppo_trainer.py:3-4` |
| D6 | P16 | Enfin, une dernière couche donne cent trente notes, une par action : prendre telle carrière, bâtir un mur à tel endroit, rentrer au trône. | `engine/actions.js:23-37`, `:107` |
| D7 | P17 (1) | Un filtre éteint d'abord les notes des actions impossibles à cet instant, comme bâtir un mur sans tenir de pierres. Ce filtre reste à fiabiliser. | `trainer/models.py:22-23` ; `engine/actions.js:636` ; `dossier_cerveau.md` §4.3 |
| D8 | P17 (2) | En match, le cerveau joue l'action la mieux notée. | `trainer/evaluation.py:83-84` ; `trainer/FORMAT_MODELE.md:31` |
| E1 | P19 | Au départ, ses cent trente notes sont presque égales : aucune action n'est préférée. | `trainer/models.py:122-129` (gain 0,01) |
| E2 | P20 | Pour ne pas partir de zéro, il imitera d'abord un programme écrit à la main : à chaque décision du professeur, on ajuste ses réglages pour qu'il donne la meilleure note au même choix. | `trainer/imitation.py:1-9`, `:131-154` ; H-5, H-23 |
| E3 | P21 (1) | Ensuite, plus de professeur : il jouera des matchs dans le simulateur, et seul le score le guidera. | `trainer/ppo_trainer.py:261-273` ; `engine/env.js:357-360` |
| E4 | nouveau | Pendant cet entraînement, il ne jouera pas toujours sa meilleure note : il tirera au sort, selon ses notes, pour essayer d'autres choix. | `trainer/ppo_trainer.py:190-191` |
| E5 | nouveau | Une petite partie supplémentaire du réseau, le « critique », estime combien de points il peut encore marquer. | `trainer/models.py:1-5`, `:117-119` ; `trainer/ppo_trainer.py:55`, `:223-236` |
| E6 | P21 (2) | Quand une suite de choix rapporte plus que prévu, chacun de ces choix devient un peu plus probable ; moins que prévu, un peu moins. | `trainer/ppo_trainer.py:223-236`, `:261-267` (écrêtage 0,2) |
| E7 | nouveau | Pour apprendre à s'adapter, il devra s'entraîner contre plusieurs adversaires. | `docs/CONTRATS.md:151` ; H-8 |
| E8 | P23 | Chaque version passera ensuite un examen : des matchs fixés à l'avance, les mêmes pour toutes, joués sans tirage au sort. La meilleure moyenne deviendra le champion. | `trainer/scenarios.py:91-95` ; `trainer/ppo_trainer.py:318`, `:334` ; H-6 |
| E9 | P24 | Pour le robot, on ne garde que la partie qui décide : le critique ne sert plus. Il reste un fichier d'un demi-mégaoctet, qui contient pour l'essentiel ses cent vingt-trois mille réglages. | `trainer/FORMAT_MODELE.md:90` ; mesure §8 (99,35 %) ; H-14 |
| E10 | nouveau | Une fois à bord, ses réglages seront figés : il réagira à ce qu'il perçoit, sans plus apprendre. | `AUDIT_SIMULATEUR_IA.md:335` (« gel ») ; `trainer/FORMAT_MODELE.md:5-12` |
| F1 | nouveau | Récapitulons. Un monde simulé ; cinquante-six nombres en entrée ; cent trente notes en sortie ; une imitation, puis un entraînement guidé par le score ; un examen ; un fichier pour le robot. | synthèse des lignes ci-dessus |
| F2 | P25 | Aujourd'hui, le simulateur fonctionne. La chaîne d'apprentissage a tourné une première fois : un essai de quelques minutes, sur une version précédente du simulateur. | H-7 ; `trainer/README.md:58-77` |
| F3 | P26 | Le cerveau reste à entraîner : c'est prévu cet hiver, avec des essais à bord au printemps. | H-15 ; calendrier [À CONFIRMER] |
| — | P27, P28 | inchangés, selon H-16 [À FOURNIR] | — |

**Images à revoir avec ce texte :**
- **A6** : une liste de 15 cases vides qui se cochent, sans contenu (ordre de la stratégie à arbitrer).
- **D2** : zoom sur un neurone.
- **D4** : flèche de retour sur le bloc mémoire.
- **E6** : jauge « prévu / obtenu » ; les barres « prendre » et « mur » grandissent ensemble (PED-7).
- **E8** : deux colonnes « entraînement : dés » et « examen : sans dés ».
- **E9** : le bloc « critique » se détache avant l'export.
- **Boucle récurrente** (PED-17).

## 6. Points vérifiés et justes

- **« Pas une image : cinquante-six nombres » (P11)** : exact (`engine/env.js:4-16` ; `nInputs = 56`, `dossier_cerveau.md` §3.1). C'est une très bonne accroche.
- **« Le réseau décide quoi faire ; le comment reste programmé à la main » (P18)** : exact (`AUDIT_SIMULATEUR_IA.md:15`). C'est la meilleure phrase pédagogique du script ; elle est seulement mal placée.
- **Image des fils qui portent un curseur (P14)** : juste pour un poids.
- **Anneau de 128 points qui se transforme d'une décision à l'autre, éteint au départ (P15)** : juste (GRU, remise à zéro).
- **130 barres dont 101 s'éteignent (P17)** : visualisation juste du masque à t = 0 (29 actions permises, refait par H). La réserve « 10 des 29 échouent » relève de H-11.
- **Professeur et élève (P20)** : analogie juste de l'entropie croisée.
- **« Examen » et « champion »** : termes justes ; « champion » est le terme du dépôt (`trainer/README.md:55`).
- **Ordre imitation puis renforcement** : conforme au code (`trainer/ppo_trainer.py:455-467`).
- **« Demi-mégaoctet »** : 497 261 octets, vérifié.
- **Durées et voix** : la voix off est identique dans le `.md`, le `.json` et le `.txt` (constaté par H, non contredit ici).

## 7. [À FOURNIR] et [À CONFIRMER] issus de ce contrôle

- [À CONFIRMER] Durée cible de la version longue. Le client a dit « plus de limite de temps » ; le §5 fait environ 5 min 15 s de voix.
- [À CONFIRMER] Nombre de matchs d'entraînement visé, pour remplacer « un très grand nombre » (B1). Seule l'estimation de capacité de l'audit existe (`AUDIT_SIMULATEUR_IA.md:318`).
- [À CONFIRMER] Fréquence des examens pendant l'entraînement (`--eval-tous-les`, 0 par défaut) : elle conditionne l'image « v1, v2, v3 » (PED-12).
- [À CONFIRMER] Méthode de calcul des trajets à bord du robot réel (PED-20).
- [À CONFIRMER] Visionnage test du montage par un non-technicien, pour la lisibilité des textes à l'écran (PED-15) et les durées de P01 et P29 (PED-25).
- [À FOURNIR] Voix HeyGen définitive, pour recaler chaque plan (PED-16).

## 8. Mesures exécutées pour ce contrôle

Fichiers dans `/tmp/claude-0/-home-user-icamlot/7624d51f-7be7-5b87-ae0f-1fda87a83f3b/scratchpad/verif_pedagogie/` :

| Fichier | Commande | Résultat |
|---|---|---|
| `densite.py`, `densite.out` | `python3 -I densite.py doc/script_documentaire.json` | par plan : durée, mots dits, lignes, mots et nombres à l'écran, mots écrits par seconde ; total : 557 mots écrits, 92 nombres |
| `ecart_voix_guide.out` | comparaison de `voix_guide_script/durees.csv` et des durées du `.json` | 18 plans sur 26 dépassés (maximum P12, +2,26 s) ; débit de 95,9 à 196,6 mots/min ; temps par notion |
| `voix.txt` | `grep` sur `voix_off_heygen.txt` (lignes de voix) | 0 « pierre », « mur », « tour », « porte », « trône », « score », « apprendre » ; 0 connecteur de cause ; 9 « il » |
| `onnx_init.py` | `python3 -I onnx_init.py /home/user/icamlot-audit/.data/modeles/fumee.onnx` | 12 initialiseurs float32 : 123 506 valeurs, 494 024 octets, soit 99,35 % du fichier |
| `voix_proposee.txt` | comptage des mots | 39 phrases, 787 mots ; 314,8 s à 150 mots/min ; 342,2 s à 138 mots/min |
| (lecture) | `sed -n` sur `trainer/models.py`, `trainer/ppo_trainer.py`, `trainer/imitation.py`, `trainer/evaluation.py`, `trainer/scenarios.py`, `trainer/FORMAT_MODELE.md`, `engine/env.js`, `engine/actions.js`, `engine/engine.js`, `docs/CONTRATS.md`, `AUDIT_SIMULATEUR_IA.md` | lignes citées ci-dessus |
| (contrôle) | `git -C /home/user/icamlot-audit status --short` | vide : aucun fichier du dépôt modifié |
