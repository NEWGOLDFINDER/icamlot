# Contrôle d'exactitude du script « Le cerveau d'ICAM LOT »

Contrôle adversarial, angle **exactitude**, du 2026-10-28.
Objet : `script_documentaire.md` / `.json` / `voix_off_heygen.txt` (dossier `doc/`).
Référence : `/home/user/icamlot-audit`, HEAD `0161a45` = `origin/audit/simulateur-ia`, moteur `2.0.0`. Chaque affirmation de la voix off et de l'écran a été confrontée au **fichier du dépôt lui-même**, pas seulement aux dossiers.
Aucun fichier de `/home/user/icamlot-audit` ni de `/home/user/icamlot` n'a été modifié (`git status` vide après les mesures).

## Verdict

| | |
|---|---|
| Nombres de la voix off | 25 sur 27 répliques exactes. **Aucun chiffre faux dans la voix off.** |
| Problèmes trouvés | 25 : **1 élevé**, **10 moyens**, **14 faibles** |
| Le plus grave | Le robot de verre est l'extrusion de la **plaque haute**. Ce n'est pas l'**empreinte au sol** que le moteur utilise. Le volume « fidèle, taille réelle » est donc trop petit, et les roues dépassent du volume (P03, §0.2, §3.2). |
| Chiffre faux à l'écran | Compteur de score de P04 et fait F35 : il manque l'étape **38** (tour T2, 38,95 s). |
| Formulations à corriger | P09 (lidar), P13 (croyance), P15 (« 13 décisions »), P25 (« de bout en bout »), P07 (« au millimètre, d'après le règlement »), P27 (« cherche des partenaires », sans source dans le dépôt) |

## Mesures exécutées pour ce contrôle

| Mesure | Commande | Résultat |
|---|---|---|
| Tests du moteur | `node tests/test_moteur.js` | **83 réussis, 0 échoué** ; libellés de P10 présents mot pour mot (lignes 5, 42, 43, 110 de la sortie) |
| Masque et débit, politique aléatoire, 40 matchs, sans adversaire, 1 fil Node, Xeon 2,80 GHz | `node scratchpad/mesures/masque_vs_moteur.js <dépôt> 40` | 779 erreurs sur 1178 décisions (**66,1 %**) ; **0,173 match/s** (5,8 s par match) ; 29,4 décisions par match |
| Score pas à pas, match seul | lecture de `match_programme_reference_solo.json`, colonne `score.jaune` | 8 (7,30 s) → 16 (11,85) → 24 (20,75) → 32 (25,30) → **38 (38,95)** → 40 (46,35) → 61 (51,30) → 116 (100) |
| Briques des deux matchs | `jaune.briques`, `bleu.briques` | Seul : 15 briques, 0 erreur. Duel : jaune 108 pts (2 erreurs), bleu 65 pts (4 erreurs) |
| Distance entre les robots (duel) | `robots.jaune` / `robots.bleu` | Minimum 500,0 mm, atteint **deux fois** : 22,05–22,20 s et 26,20–26,30 s |
| Phases du Graal (duel) | `graal.jaune`, `graal.bleu` | Jaune : `ascenseur` de 49,15 à 53,65 s. Bleu : de 38,15 à 42,65 s. Seul : de 57,9 à 62,4 s |
| Entrées et masque | `script_donnees_ecran.json` | Valeurs de P11 à P13 et P17 conformes. Le masque déclare invalides 4 des 13 actions du programme de référence (k = 4, 8, 11, 12) |
| Modèle d'essai | `.data/modeles/fumee.meta.json`, `ls -l` | `moteur: "1.3.0"`, `n_in` 56, `n_out` 130 ; `fumee.onnx` = 497 261 octets |
| Polygones du robot | `spec/robot.json` | Plaque haute : 6 sommets, rayon 171,3 mm, périmètre 966,1 mm. Empreinte au sol : 45 sommets, rayon 212,4 mm, faces à 129,1 mm, périmètre 1173,1 mm |
| Paramètres du réseau | calcul à partir de `trainer/models.py:89-130` | 7 296 + 256 + 99 072 + 16 770 = **123 394** ; + 16 641 (critique) = **140 035** |
| Image de la table | lecture de l'en-tête JPEG de `plateau/table.jpg` | 2400 × 1601 px |
| Mot « partenaire » ou « sponsor » dans le dépôt | `grep -rniI "partenaire\|sponsor\|mécène"` | **0 occurrence** |

## 1. Problèmes, du plus grave au moins grave

### 1.1 Gravité élevée

**E1 — P03, §0 point 2, §3.2, F12 : le volume du robot n'est pas « fidèle » ni à « taille réelle ».**
- Extrait : « Volume extérieur fidèle : extrusion du polygone mesuré du châssis (…) (−168,6 ; −30,1), (58,4 ; −161,0) (…), soit un triangle tronqué aux faces de 262 mm, du dessous de la plaque basse (z ≈ 12,8 mm) jusqu'au toit ».
- Ce polygone est celui de la **plaque haute** (`spec/robot.json:30-64`, `rayon_sommets` 171,5). Le moteur n'utilise pas ce polygone. Il utilise l'**empreinte au sol** : `HULL = CH.empreinte_sol.polygone` (`engine/geom.js:27`). Le contrat le confirme : « Elle remplace partout le triangle » (`docs/CONTRATS.md:30`). Cette empreinte a 45 sommets, un rayon de 212,4 mm (`spec/robot.json:66`), des faces à 129,1 mm du centre et un périmètre de 1173,1 mm. La plaque haute, elle, mesure 966,1 mm de périmètre, soit 18 % de moins.
- Conséquences à l'écran :
  - le robot de verre serait plus petit que le robot simulé (≈ 41 mm de moins aux coins, ≈ 19 mm de moins par face) ;
  - les roues, implantées à 192 mm du centre (`spec/robot.json:292`), sortiraient du volume, dont les coins sont à 171,3 mm ;
  - les distances montrées (500 mm entre les robots en P09, approche des pierres) ne correspondraient plus au volume dessiné.
- Détail : 12,8 mm est le **centre** de la plaque basse (`z_centre`, `spec/robot.json:26`), pas son dessous.
- Correction : extruder `chassis.empreinte_sol.polygone` (`spec/robot.json:95-280`), celui du moteur, ou dire « silhouette simplifiée » et retirer « fidèle » et « taille réelle ». Écrire « z = 12,8 mm (centre de la plaque basse) ».

### 1.2 Gravité moyenne

**E2 — P04 (à l'écran) et F35 : la suite du compteur de score est fausse.**
- Extrait : « Compteur de score réel (score.jaune) : 8, 16, 24, 32, 40, 61, puis 116 à 100 s ».
- Dans la colonne `score.jaune` de `match_programme_reference_solo.json`, la tour T2 (P6.3, 38,90 s) fait passer le score de 32 à **38** à 38,95 s. Les piliers de la porte donnent ensuite 40 (46,35 s), puis le linteau et la porte donnent 61 (51,30 s). Avec 5 valeurs pour 6 événements, la tour s'afficherait à 40 au lieu de 38.
- Correction : « 8, 16, 24, 32, 38, 40, 61, puis 116 à 100 s », à corriger dans P04, F35 et le JSON.

**E3 — P15 (image) : « Frise horizontale des 13 décisions du match de référence ».**
- Le programme compte **15 briques** (`engine/engine.js:1666-1675` ; `jaune.briques`). Deux d'entre elles ne sont pas dans le catalogue des 130 actions, et `ENV.imitate` ne les compte donc pas comme des décisions (`engine/env.js:461-462`) :
  - la prise de la pierre seule P6.3 (`mode: 'pierre'`, 26,08 s) ;
  - **`monterGraal`** (53,19 s), qui rapporte 25 des 116 points.
- Plaquée sur les images du match, la frise montrerait le robot agir à 26,08 s et à 53,19 s sans décision. Elle cacherait aussi que le réseau ne peut pas choisir la montée du Graal (dossier_cerveau §4.1).
- Correction : « 13 des 15 briques correspondent à une action du catalogue ». Marquer 26,08 s et 53,19 s comme « hors catalogue ». Ou bien ne pas superposer la frise au match.

**E4 — P13 (voix) : « une carrière reste pleine tant qu'il n'y est pas allé ».**
- Le code met la croyance à 0 dès que notre robot **exécute** « prendre » sur la carrière, que la prise réussisse ou non (`engine/env.js:149-151`). Une étape impossible laisse le robot immobile (`docs/CONTRATS.md:125`). C'est justement le cas montré en P13 : à 16,33 s, la cellule P10 tombe à 0 alors que le robot n'a pas bougé (`jaune.briques[5]` : t0 = t1 = 16,326). La voix contredit donc l'image.
- Cas inverse : la prise de la seule pierre P6.3 (`mode: 'pierre'`, sans `p`) ne met pas la croyance à jour. P6 reste donc « pleine » alors que le robot y est allé.
- Correction : « une carrière reste pleine tant qu'il n'a pas essayé de la prendre » (même nombre de syllabes à peu près). F18 est déjà exact.

**E5 — P09 (voix, écran, image) : la règle du lidar est simplifiée au point d'être inexacte.**
- Extrait de la voix : « Si l'adversaire est à moins de quarante centimètres devant, il attend. »
- Extrait de l'image : « Devant chacun, un demi-disque translucide de 400 mm (…) le jaune s'arrête, (…) puis il repart ».
- Ce que fait le code (`engine/engine.js:129-138`, `:494-511`) :
  - les 400 mm se mesurent entre le **point lidar** (30 mm derrière le centre) et le **centre** de l'adversaire. Ce n'est pas un écart entre les bords : un robot fait 212 mm de rayon ;
  - « devant » veut dire **dans le sens du déplacement** (`dir`), pas du côté du cap ;
  - le test n'est fait **qu'avant de partir**. Il porte sur le trajet prévu, avec la position **future** de l'adversaire, que le simulateur connaît ;
  - l'attente dure 2 s, au plus 4 fois. Elle cesse si l'adversaire n'a pas bougé de 40 mm.
- Le « jaune s'arrête » de l'illustration décrit donc un arrêt en route. Cet arrêt existe, mais c'est une autre règle : 60 mm, par pas de 0,1 s (`engine/engine.js:436-492`).
- La distance minimale de 500 mm est atteinte deux fois (vers 22,1 s et vers 26,25 s), pas seulement à 26,25 s (F15).
- Correction de la voix : « Si l'adversaire va croiser sa route à moins de quarante centimètres, il attend avant de partir. » Écran : « adversaire à moins de 400 mm (centre), dans le sens du trajet prévu → attente de 2 s avant le départ (4 fois au plus) ». Image : demi-disque orienté selon le trajet, robot **à l'arrêt avant de partir**.

**E6 — P25 (voix et écran) : « la chaîne d'apprentissage a fonctionné de bout en bout ».**
- Collée à « Aujourd'hui, le simulateur tourne », la phrase laisse entendre que la chaîne a tourné sur le simulateur actuel. Or le seul essai, la fumée de 2 min 37 s (`trainer/README.md:58-77`), a été fait sur le moteur **1.3.0** : `.data/modeles/fumee.meta.json` indique `"moteur": "1.3.0"`, et le moteur 2.0.0 n'a été fusionné qu'après, au commit `63d27dc` (11:08). Aucun essai de bout en bout sur le moteur 2.0.0 n'est documenté. Sur ce moteur, ce modèle fait 36 pts et 76 erreurs (diagnostic §2.2).
- Correction : « la chaîne d'apprentissage a déjà fonctionné de bout en bout, sur la version précédente du simulateur ». Écran : « … sur un essai, avec le moteur 1.3.0 ». Ou bien relancer un essai sur 2.0.0 avant diffusion [À CONFIRMER].

**E7 — P07 (voix) et F11 : « on recrée le monde, au millimètre, d'après le règlement ».**
- Seule une partie du monde vient du règlement :
  - les PDF du règlement ne sont pas dans le dépôt (`spec/regles_2027.json:2-6`) ;
  - les zones viennent du plan `table.svg`. Ses contours de carrière font 319 × 109 mm, contre 320 × 110 pour les pierres (`:103`) ;
  - le robot n'est pas seulement « mesuré » comme le dit F11. Ses valeurs ont plusieurs statuts : `declare` (vitesse de 500 mm/s), `herite` (approche à 200 mm/s, `spec/robot.json:309-312`), `propose` (pinces) ;
  - le moteur prend dans la spec les valeurs qui y sont, et pour les autres « hypothèse » (`engine/engine.js:13`). Exemples : durées de pince (« hypothèses héritées », `docs/CONTRATS.md:38`), balistique (`engine/engine.js:34-35`), durées de l'ascenseur (`:36-37`), pose de départ (`:17`).
- « Au millimètre » n'est ni mesuré ni vérifiable sans les PDF.
- Correction : « D'abord, on recrée le monde d'après le règlement et les mesures du robot. » Corriger F11 : « cotes du règlement et du plan ; robot mesuré, déclaré ou supposé selon les valeurs ».

**E8 — P17 et P18 (voix) : « Un filtre doit écarter l'impossible » / « Le réseau décide quoi faire ».**
- La note de P17 ne cite qu'un défaut, les 66 % d'actions autorisées qui échouent (remesuré ici : 66,1 %). Le filtre en a deux autres, que le script ne dit pas :
  - il écarte aussi du **possible**. 4 des 13 actions du programme de référence (Mur M1, Mur M5, Porte M3, boulets) sont déclarées invalides au moment même où elles réussissent (`script_donnees_ecran.json`, `solo.decisions[3, 7, 10, 11].action_valide_sous_masque = false` ; dossier_cerveau §4.3). L'imitation ignore ces cibles (`trainer/imitation.py:6`) ;
  - en match, il ajoute des **règles de stratégie écrites à la main**. `liveMask` interdit le trône avant 88 s, impose de charger les deux faces avant 75 s et empêche de répéter une action (`engine/env.js:153-196`). Ces règles s'appliquent dans `ENV.play`, `brainAgent` et `engine/duel_bridge.js:101`, mais pas à l'entraînement. Elles vont contre `docs/CONTRATS.md:80` (« Aucune règle de stratégie »).
- Une partie du « quoi faire » reste donc écrite à la main.
- Correction : garder « doit » et compléter la note. Possibilité pour la voix de P18 : « Le réseau choisit quoi faire, dans un cadre encore écrit à la main ; le comment reste programmé à la main. » Sinon, ajouter une ligne à l'écran : « Aujourd'hui, le filtre se trompe dans les deux sens ».

**E9 — P27 (voix et écran) : « ICAM LOT cherche des partenaires » / « Rejoignez ICAM LOT ».**
- Aucune occurrence de « partenaire », « sponsor » ou « mécène » dans le dépôt de référence. Les sources citées (F34, F01, `AUDIT_SIMULATEUR_IA.md:336`) ne parlent que de la compétition de mai 2027. Seul indice : le message du commit `a80d0a1` de `/home/user/icamlot` (« vidéo 30 s … pour les sponsors »), qui n'est pas une déclaration de l'équipe.
- « Mai 2027 » vient du **calendrier de l'audit** (un plan), pas d'une date officielle. Date et lieu sont déjà [À FOURNIR] au §7.9.
- Correction : marquer la phrase [À CONFIRMER] par l'équipe. Citer comme source la demande du client ou de l'équipe, pas F34.

**E10 — P05 et §4 (Confidentialité) : l'intervalle du Graal à masquer ne vaut que pour le match seul.**
- Extrait : « ne jamais montrer l'intervalle 57,9–62,4 s (phase « ascenseur ») » ; §4 : « état ascenseur du Graal (57,9 → 62,4 s) ».
- Ces bornes sont celles de `match_programme_reference_solo.json`. Or P05 joue `match_programme_reference.json` en accéléré « jusqu'à 100 s ». Dans ce fichier :
  - le Graal jaune est sur la fourche de **49,15 à 53,65 s** ;
  - le Graal **bleu** aussi monte, de **38,15 à 42,65 s**, et finit sur le toit du bleu.
- Le canon jaune est sorti (`C.can` > 0) dès 55,95 s.
- Correction : donner les intervalles des deux fichiers, et pour les deux robots, dans P05 et au §4. Ajouter le Graal bleu à la liste à masquer.

**E11 — P03 et §3.2 : les roues sont montrées sans être signalées comme point à arbitrer.**
- Le diagnostic classe « les roues » (`vid/spec.json`, clé `wheels`) parmi la forme exacte à ne pas montrer (diagnostic §6). Le dossier monde range les « 3 roues omnidirectionnelles » parmi les points « à arbitrer par l'équipe » (dossier_monde §11.3). Le script les montre à leur position exacte (192 mm ; 60°, 180°, 300°) sans les lister au §7 [À CONFIRMER].
- Correction : ajouter « 3 roues visibles (disposition kiwi) » au point 1 du §7 [À CONFIRMER].

### 1.3 Gravité faible

| # | Plan | Extrait | Problème (source vérifiée) | Correction |
|---|---|---|---|---|
| E12 | P14 (voix) | « cent quarante mille réglages » | 140 035 inclut la critique (16 641), qui ne sert pas à décider. Le réseau dessiné (56 → 128 → 128 → 130) et la version qui joue comptent **123 394** paramètres (calcul, `trainer/models.py:114-119` ; `FORMAT_MODELE.md:90`). Ces tailles sont des « hypothèses de départ » (`models.py:79`). | « cent vingt mille réglages », ou garder 140 000 et ajouter « (dont la partie qui ne sert qu'à l'entraînement) » à l'écran |
| E13 | P17 / P19 (voix) | « la mieux notée l'emporte » puis « il choisit presque au hasard » | Les deux phrases se contredisent. Le choix glouton ne vaut qu'en évaluation et sur le robot (`trainer/evaluation.py:83-84`). À l'entraînement, l'action est **tirée au sort** selon les notes (`ppo_trainer.py`, collecte). Avec des notes presque égales, un choix glouton n'est pas « au hasard ». | P17 : « en match, la mieux notée l'emporte » |
| E14 | P21 (voix et image) | « chaque point marqué renforce les choix qui l'ont rapporté » ; « +8 (3 pierres + 5 pour le mur, comme à 7,28 s) » | PPO renforce ce qui rapporte **plus que prévu** (avantage contre la critique, γ = 1 : les choix antérieurs reçoivent aussi le crédit). F29 le dit bien. De plus, un « mur » choisi par le réseau reçoit `pm: 'proche'` (`engine/actions.js:148-150`) : il peut rapporter 13 au lieu de 8 (`trainer/README.md:77`). Ce n'est pas le mur du programme de référence. | « … renforce les choix qui ont rapporté plus que prévu ». Image : garder « illustration » et ne pas renvoyer à 7,28 s |
| E15 | P08 (voix) | « Chaque trajet se calcule sur une grille (…), sans contact » | Les approches et reculs (`lin`, 200 mm/s, `engine/engine.js:682`, `:779-782`, `:1205-1242`) et les déplacements de moins de 60 mm (`:538`) vont en ligne droite, hors grille. Une case n'est testée qu'à l'orientation d'arrivée (`:384`). | « Chaque grand trajet… » ou « Les trajets se calculent… » |
| E16 | P22 (voix et écran) | « Un match s'y joue en six secondes » | La mesure (dossier §7.1), refaite ici (0,173 match/s, 5,8 s), est faite **sans adversaire**, sans contrôle de contact, sur 1 fil Node d'un Xeon 2,8 GHz de l'audit. Ce n'est pas la machine de l'équipe. Elle n'est pas dans le dépôt : `trainer/README.md:83` donne 0,20 match/s sur le moteur 1.3.0. | Écran : ajouter « sans adversaire · machine de l'audit » |
| E17 | P26 (voix) | « essais à bord au printemps » | Mars 2027 = « runner embarqué (…), essais en **rejeu** » sur des états enregistrés. Avril = recalage sur le robot (`AUDIT_SIMULATEUR_IA.md:334-335`). C'est un plan, pas un engagement. | Acceptable ; l'écran est exact. Éventuellement « premiers essais à bord au printemps » |
| E18 | P23 (voix) | « Deux cents matchs d'examen désignent la meilleure version » | `MATCHS_SELECTION = 200` est noté « Hypothèse » (`trainer/evaluation.py:31`). Les 200 matchs sont identiques pour un même adversaire (`trainer/README.md:74`). La note du script le signale. | Garder la note [À CONFIRMER]. Ne pas afficher « 200 matchs différents » |
| E19 | P09 (image) | « les deux robots sur le bord haut de la table » | y = 255 mm, donc le bord y = 0. « Haut » dépend de la caméra : dans `table.svg`, y croît vers le bas. | « le long du bord y = 0 (côté P1 à P4) » |
| E20 | P12 (image) | « 8 rayons (…) tous les 45° à partir de son cap » | Le sens n'est pas précisé : il est trigonométrique (`engine/env.js:129`). Les rayons partent du **centre** du robot, par pas de 50 mm, et s'arrêtent à 70 mm du bord (`:131-135`). | Ajouter « sens trigonométrique, depuis le centre » |
| E21 | P15, P17 (écran) | anneau « mémoire » ; « Choix : la note la plus haute » | Aucun réseau n'a joué : l'état caché et les hauteurs des barres sont des **illustrations**. Le §3.3 l'exige pour P17, mais la liste « À l'écran » de P17 n'en porte pas la mention, ni P15. | Ajouter « illustration » à l'écran de P15 et P17 |
| E22 | P18 (image) | « arrivée en (750 ; 335) mm » | (750 ; 335) est la pose **après le recul**, à 3,13 s. La prise se fait en (750 ; 255,3), de 1,68 à 2,73 s (`jaune.segments`). | « fin de brique en (750 ; 335) mm » |
| E23 | §3.2 | « Mât de balise : centré, Ø 70 mm, jusqu'à 430 mm », source `spec/robot.json:456-459` | Ces lignes ne disent que « centré ». Ø 70 mm et 430 mm viennent de `docs/CONTRATS.md:31`. Le règlement fixe le support entre 425 et 435 mm, avec une section comprise entre Ø 70 mm et 100 × 100 mm (`spec/regles_2027.json:381-386`). | Citer `docs/CONTRATS.md:31` et `regles :381-386` |
| E24 | P24 (écran) | « intégration prévue en mars 2027 », source `AUDIT_SIMULATEUR_IA.md:256-260` | Ces lignes décrivent la phase 5 sans date. La date est en `:334`. | Citer `:334` |
| E25 | En-tête, §2, §10 | « Durée totale 110,6 s » ; minutages des plans | 110,6 s est **l'estimation** à 150 mots/min. Le même nombre désigne aussi la **voix guide seule** mesurée. Avec la voix guide, le film fait 113,6 s, et 116,8 s avec P28. Plusieurs répliques dépassent leur plan : P02 5,34 s pour 4,0 ; P12 6,26 pour 4,0 ; P16 3,89 pour 3,2 ; P23 3,94 pour 3,2 ; P26 5,84 pour 5,2 (`voix_guide_script/durees.csv`). | Écrire « 110,6 s estimés » et ajouter les minutages mesurés ; caler les plans sur `durees.csv` |

Autres imprécisions, sans effet sur la voix :
- §5 : on lit « le "Mur M1" du modèle filmé », puis « Que la vidéo publiée ait bien été rendue avec ces fichiers : [À CONFIRMER] ». Une source existe : le commit `a80d0a1` de `/home/user/icamlot` dit « rejoue un vrai match du moteur de référence (modèle fumee, branche audit/simulateur-ia) ». À citer.
- Annexe A, extension après P21 : « Il s'entraîne contre plusieurs adversaires… » est au présent, alors que c'est prévu (`docs/CONTRATS.md:151`). Par défaut, l'entraînement se fait **sans adversaire** (`intensites` = `aucun`, `trainer/ppo_trainer.py:77`). Écrire : « Il s'entraînera… ».
- Annexe A, extension après P05 : « Le maximum théorique, pour notre robot : 134 » est un **calcul à partir du barème**, « si [les pierres] sont disponibles malgré l'adversaire » (`AUDIT_SIMULATEUR_IA.md:192-196`). Écrire : « Le maximum théorique du barème… ».
- P03 : « Une pierre de 320 mm posée à côté donne l'échelle » ajoute une 31ᵉ pierre qui n'existe pas dans le match. La signaler comme mise en scène ou la retirer.
- P05 : après 43,94 s, le bleu reste au trône jusqu'à 100 s ; sa porte et son tir ont échoué (`bleu.briques` 12 et 14). Le monteur doit le savoir avant l'accéléré.

## 2. Affirmations vérifiées exactes (échantillon, source relue dans le dépôt)

| Plan | Affirmation | Vérification |
|---|---|---|
| P02, P07 | 100 s ; table 3000 × 2000 ; 30 pierres 320 × 110 × 110 ; P1 à P4 en y = 55, P5 à P8 en y = 1945, P9 (1500 ; 500), P10 (1500 ; 1500) ; M3 (850 ; 1000) ; T2 (850 ; 750) ; murs 400 × 200 ; tours Ø 200 | `spec/regles_2027.json:8-20`, `:91-185`, `:189-269` |
| P01 | Pile P1 de 0 à 330 mm, bordure de 70 mm | `engine/engine.js:168` ; `regles :17` |
| P03 | Départ (250 ; 1000), cap 0° ; trône x 0–500, y 750–1250 ; roues Ø 60 à 192 mm, à 60°, 180° et 300° ; toit à 311,2 mm (moteur), 341,2 mm (CAO) | `engine/engine.js:17-18` (« hypothèse héritée ») ; `regles :22-31` ; `robot.json:288-298`, `:24`, `:81-85` ; `geom.js:26` |
| P04 | 116 pts seul, 0 erreur ; poses M2 7,28, M1 11,81, M4 20,73, M5 25,26, T2 38,90, piliers 46,31, linteau 51,29 ; prises P1 2,08 et P9 4,53 ; boulets arrêtés en x 2608–2908,5 et y 875–978,9 | fichier de match (`evenements_pierres`, `jaune.boulets.tirs`) ; `docs/CONTRATS.md:133` |
| P05 | Bleu : décision P10 à 9,441 s, prise à 10,837 s ; message « Le paquet P10 n'est plus là (pris par l'adversaire). » ; M4 jaune jamais construit ; 108 contre 65 | `match_programme_reference.json` ; `docs/CONTRATS.md:150` ; sortie de `test_moteur.js` |
| P08 | Cases de 40 mm, grille de 75 × 50, A* à 8 voisins, cases serrées × 4, chemin lissé | `engine/engine.js:385-425` |
| P09 | 2 s, 4 fois au plus ; aucune attente dans le duel | `engine/engine.js:497-507` ; aucun segment « Attente 2 s » |
| P10 | 83 tests, libellés exacts | exécuté ici |
| P11–P12 | 56 entrées en 10 groupes (1, 4, 10, 6, 9, 4, 1, 2, 11, 8) ; temps 0,837 = 83,7 s ; robot (750 ; 1664), cap 90° ; adversaire (2280 ; 980) ; rayons 300…400 mm ; M1 et M2 à 0,5 | `engine/env.js:4-16`, `:74-142` ; `script_donnees_ecran.json` ; poses du fichier de match à 16,3 s |
| P13 | P4, P8 et P10 crues pleines à 16,33 s, vidées à 2,08, 8,39 et 10,84 s | `duel.decisions[5]` ; `evenements_pierres` |
| P14–P16 | 56 → 128 → GRU 128 → 130 ; 140 035 / 123 394 ; état caché remis à zéro ; 130 actions = 20 + 20 + 24 + 20 + 1 + 8 + 37 | `trainer/models.py:89-145` (calcul) ; `engine/actions.js:23-37`, `:107` |
| P17 | 29 actions permises sur 130 à t = 0 ; logits masqués à −1e9 ; 66 % en politique aléatoire | `solo.decisions[0]` ; `models.py:22-23` ; remesuré ici (66,1 %) |
| P18 | « Tous les mouvements et toutes les pinces sont gérés par du code écrit à la main » | `AUDIT_SIMULATEUR_IA.md:15` |
| P19 | Gain 0,01 sur la sortie de l'acteur | `trainer/models.py:128` |
| P20 | Imitation de `ENV.EXAMPLE` par défaut ; 74 pts et 6 erreurs | `trainer/ppo_trainer.py:419` ; `imitation.py:49-51` ; `docs/CONTRATS.md:133` |
| P21 | Récompense = écart de score après la brique ; pénalités à 0 par défaut | `engine/env.js:357-360` ; `trainer/README.md:104` |
| P23 | 200 matchs d'évaluation par défaut ; champion = meilleure moyenne | `trainer/ppo_trainer.py:82`, `:334` |
| P24 | 497 261 octets (« 497 ko », « un demi-mégaoctet ») ; architecture 56 → 130 | `ls -l .data/modeles/fumee.onnx` ; `fumee.meta.json` |
| P26 | Janv.–févr. 2027 entraînement ; mars à bord, en rejeu ; avr. recalage ; mai compétition | `AUDIT_SIMULATEUR_IA.md:333-336` |
| F06 | Barème 1 / 5 / 5 / 20 ; Graal 5 + 4 × 5 ; trône 5 / 10 ; boulets 5 + 15 ; fin de match à 100 s | `regles :359-373` ; `bareme.js:9-22` ; `engine/score.js:3`, `:131-132` |
| §3.1 | `table.jpg` 2400 × 1601 ; bordure 70 × 22 | en-tête JPEG ; `regles :17-18` |

## 3. Confidentialité : ce qui ne doit pas apparaître à l'écran (constats de ce contrôle)

- **Graal sur la fourche** : en duel, de 49,15 à 53,65 s pour le jaune et de 38,15 à 42,65 s pour le bleu. Le Graal bleu finit aussi sur son toit (E10).
- **Roues** (disposition kiwi) : point à arbitrer, pas encore listé au §7 (E11).
- **Forme exacte** : en corrigeant E1 avec l'empreinte à 45 sommets, le robot montre précisément la forme que dossier_cerveau §0.3 et dossier_monde §11.2 classent confidentielle. La validation écrite de l'équipe, déjà [À CONFIRMER], doit couvrir cette empreinte.
- **P16** : les nombres « prendre 20 · tour 24 » se lisent comme 2 faces × 10 carrières et 2 faces × 4 tours × 3 rangs. Ils laissent deviner deux faces portant chacune une pile de 3, point « à arbitrer » (dossier_monde §11.3). [À CONFIRMER]
- **P18** : la brique « Prendre P1 » contient les libellés « Contact avec P1 » et « Vide face A sur P1 » (`jaune.segments`). Ils ne doivent pas apparaître.

## 4. Points ouverts créés ou renforcés par ce contrôle

- [À CONFIRMER] Volume du robot à l'écran : empreinte au sol mesurée (moteur) ou silhouette simplifiée annoncée comme telle (E1).
- [À CONFIRMER] Phrase « ICAM LOT cherche des partenaires » : à valider par l'équipe (E9).
- [À CONFIRMER] Relancer un essai de bout en bout sur le moteur 2.0.0 avant de dire que la chaîne « fonctionne » aujourd'hui (E6).
- [À FOURNIR] Date et lieu officiels de la compétition de mai 2027 (E9, déjà au §7.9).
