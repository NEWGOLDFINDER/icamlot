# Contrôle adversarial « honnêteté » du script documentaire

Objet : `script_documentaire.md`, `script_documentaire.json` et `voix_off_heygen.txt` (dossier `doc/`), confrontés à `dossier_cerveau.md`, `dossier_monde.md`, `diagnostic_pierres.md` et au dépôt `/home/user/icamlot-audit` (commit `0161a45`, moteur 2.0.0). Contrôle fait le 2026-10-28.

Règle suivie : chaque constat renvoie à un fichier (`chemin:ligne`) ou à une mesure refaite ici (§5). Aucun fichier du dépôt n'a été modifié : `git status --short` est vide après les mesures.

## 1. Verdict

Le script est prudent sur un point essentiel : il **n'attribue aucun score au réseau**, et le bandeau « programme écrit à la main (pas le réseau) » est bien prévu. Il garde pourtant **8 problèmes majeurs et 1 critique**. Un spectateur peut en sortir avec des idées fausses :

1. **Un robot terminé, qui marque 116 points.** En réalité, les pinces, le canon, l'ascenseur et le Graal ont le statut « proposé » : ce sont des conceptions de l'audit que l'équipe doit encore valider (`spec/robot.json:12`, `:335`, `:412`, `:438`, `:470`). 45 des 116 points viennent du canon et de l'ascenseur, simulés avec des durées supposées.
2. **Un cerveau en cours d'entraînement, sélectionné sur 200 matchs.** En réalité, seul un essai de 2 min 37 s a tourné, sur l'ancien moteur 1.3.0. Les « 200 matchs » d'examen sont aujourd'hui identiques pour un même adversaire.
3. **Une chaîne qui a fonctionné « de bout en bout ».** Elle s'arrête à l'export du fichier. Le programme embarqué ne peut pas encore charger le modèle actuel.
4. **Une forme du robot montrée exactement**, alors que les trois dossiers la classent confidentielle.

L'angle de ce contrôle est l'honnêteté. La conformité à la demande du client n'est traitée que là où le script lui prête une décision (P-25 au §3).

## 2. Tableau des problèmes (du plus grave au moins grave)

| # | Plan | Gravité | Problème en une ligne |
|---|---|---|---|
| 1 | P03, §3.2, P05 | **critique** | Forme exacte du châssis, hauteur et roues montrées « à l'échelle » : classées confidentielles |
| 2 | P03 | majeure | « Voici notre robot » et « mécanismes volontairement non montrés » laissent croire à un robot terminé |
| 3 | P04 | majeure | Les 116 pts sont présentés comme ceux de « notre robot », mais reposent sur des mécanismes proposés et des durées supposées |
| 4 | P04, §3.1 | majeure | Graal sur le toit, 10 boulets, deux piles portées, porte en deux temps : la mécanique se devine |
| 5 | P19–P24 (chapitre 5) | majeure | Méthode racontée au présent comme si elle s'appliquait déjà à « notre cerveau » |
| 6 | P23 | majeure | « Deux cents matchs d'examen désignent la meilleure version » : jamais exécuté, et matchs identiques |
| 7 | P25 | majeure | « A fonctionné de bout en bout » : essai de fumée sur l'ancien moteur, sans aller jusqu'au robot |
| 8 | Annexe A, après P21 | majeure | « Il s'entraîne contre plusieurs adversaires » : prévu, pas fait |
| 9 | P13 | moyenne | La « croyance » est contournée par le filtre, qui connaît l'état réel (mesuré) |
| 10 | P15 | moyenne | La frise « mémoire » montre les 13 décisions du programme écrit à la main |
| 11 | P17 | moyenne | « Prendre P1 », note la plus haute, sans mention « illustration » ; 10 des 29 actions « permises » échouent (mesuré) |
| 12 | P18 | moyenne | « Cerveau : quoi faire » collé sur une brique jouée par le programme écrit à la main |
| 13 | P21 | moyenne | Le « +8 » vient du programme écrit à la main ; à l'entraînement, le même mur rapporte 13 |
| 14 | P24 | moyenne | Le fichier « se fond » dans le robot, alors que l'embarqué ne fonctionne pas |
| 15 | P26 | moyenne | « Se construit » au présent ; le calendrier est celui que l'audit propose |
| 16 | P27 | moyenne | « Cherche des partenaires » et « rendez-vous en mai » : rien dans le dépôt |
| 17 | P05 → P06 | moyenne | L'enchaînement « 108 » puis « un cerveau qui s'adapte » sous-entend que le réseau ferait mieux |
| 18 | P07 | moyenne | « Au millimètre, d'après le règlement » : PDF absent, monde plein d'hypothèses, écart connu au règlement |
| 19 | §0.2, §8 | moyenne | Le script prête au client des décisions que sa demande relayée ne contient pas |
| 20 | P10 | mineure | « 83 tests vérifient ce monde » : ce sont des tests de cohérence ; la ligne « aucune erreur interne » prête à confusion |
| 21 | P14 | mineure | « Cent quarante mille réglages » inclut la critique, qui ne joue pas (123 394 dans la version qui joue) |
| 22 | P22 | mineure | « Six secondes » : machine de test et choix aléatoires ; libellé « temps réel » ambigu |
| 23 | P20 | mineure | Le programme imité n'est pas celui des 116 pts que le spectateur vient de voir |
| 24 | P09 | mineure | « Il attend » : règle du simulateur ; le lidar réel est « à définir » |
| 25 | P11, P12 | mineure | Valeurs présentées comme la perception du robot ; ce sont les entrées qu'un réseau recevrait |
| 26 | P16 | mineure | « 130 actions » dont 32 ne peuvent jamais réussir |
| 27 | P04, F35 | mineure | Le compteur de score oublie 38 pts à 38,95 s |
| 28 | P27 | mineure | Plan de match sans le bandeau « programme écrit à la main » |
| 29 | Annexe A (autres lignes) | mineure | « Pour notre robot : 134 pts », « notre robot retarde son départ »… |
| 30 | P06 | mineure | Le réseau s'allume à l'intérieur du robot : il laisse croire que le cerveau est à bord |
| 31 | P08 | mineure | Les cases rouges calculées sur l'empreinte réelle dessinent la forme du robot |
| 32 | Titre | mineure | « Le cerveau d'ICAM LOT » sous-entend que ce cerveau existe |

## 3. Détail des problèmes

### P-1 · P03, §3.2, P05 · critique · forme exacte du robot
- **Extrait** : « extrusion du polygone mesuré du châssis (…) (−168,6 ; −30,1), (58,4 ; −161,0)… soit un triangle tronqué aux faces de 262 mm (…) 3 roues omnidirectionnelles Ø 60 mm aux coins tronqués (192 mm du centre, à 60°, 180° et 300°) » ; à l'écran : « Silhouette à l'échelle ».
- **Problème** : la forme exacte est confidentielle dans les trois dossiers et dans la consigne :
  - `dossier_monde.md` §11.2 : « Forme exacte du châssis : triangle tronqué, faces de 262 mm… », marqué « ne jamais montrer, dire ou laisser deviner » ;
  - `dossier_cerveau.md` §0.3 ;
  - `diagnostic_pierres.md` §6 : « Forme exacte (…) et les roues. À l'écran, utiliser une silhouette générique. »

  Le script justifie son choix par une « décision du client relayée par la commande », invérifiable ici. La seule parole du client disponible dit « le robot est invisible ». Elle demande de voir un robot, pas d'en publier la forme cotée. Le robot bleu (P05) reprend la même silhouette.
- **Correction** : par défaut, une silhouette générique de même encombrement : prisme arrondi ou cylindre d'environ Ø 425 mm (rayon au sol de 212,4 mm, `spec/robot.json:66`), d'au plus 350 mm de haut, sans troncatures et sans roues visibles. Retirer « à l'échelle ». Ne passer au polygone exact qu'avec la validation écrite de l'équipe [À CONFIRMER].

### P-2 · P03 · majeure · robot présenté comme terminé
- **Extrait** : voix « Voici notre robot, ICAM LOT. » ; écran « mécanismes volontairement non montrés » ; rendu « verre dépoli » réaliste.
- **Problème** :
  - « Volontairement non montrés » suppose que les mécanismes existent. Or les pinces A et B, le canon C, l'ascenseur et le Graal ont tous le statut `propose` (`spec/robot.json:335`, `:412`, `:438`, `:470`), défini comme « conception proposée par l'audit, à valider par l'équipe » (`spec/robot.json:12`).
  - Le plan de l'audit prévoit d'intégrer les cotes des pinces, du canon et de l'ascenseur « dès qu'elles existent en CAO » (`AUDIT_SIMULATEUR_IA.md:333`).
  - Le toit de 311,2 mm est « CAO à mettre à jour par l'équipe » (`spec/robot.json:81-85`).
  - Rien dans le dépôt ne dit qu'un robot physique est assemblé [À CONFIRMER].
- **Correction** : voix « Voici notre robot, ICAM LOT, tel que nous le simulons. » ; écran « Maquette numérique · robot en cours de conception ». Supprimer « volontairement ».

### P-3 · P04 · majeure · 116 points d'un robot hypothétique
- **Extrait** : « Seul, programmé à la main, il marque en simulation cent seize points. »
- **Problème** :
  - « Il » renvoie à « notre robot » de P03. Le détail du score (sortie de `tests/test_moteur.js`, refaite ici) est : constructions 61, Graal niveau 4 « sur le toit du robot » 25, trône 10, boulets 20.
  - 45 pts reposent donc sur le canon et l'ascenseur, tous deux `propose`. Le niveau 4 n'est possible qu'avec le toit de 311,2 mm, pas encore dans la CAO. Avec le toit mesuré de 341,2 mm, il est « impossible sous 350 mm » (`AUDIT_SIMULATEUR_IA.md:344`).
  - Les durées des pinces sont des « hypothèses héritées » (`docs/CONTRATS.md:38`), la balistique aussi (`engine/engine.js:34-35`), et la pose de départ est une « hypothèse héritée » (`engine/engine.js:17-18`).
  - `dossier_monde.md` §8.3 range ces valeurs sous « à ne pas présenter comme mesuré ».
- **Correction** : voix « Dans le simulateur, un programme écrit à la main lui fait marquer cent seize points. » ; écran « Robot simulé · mécanismes en conception, durées supposées ».

### P-4 · P04 et §3.1 · majeure · la mécanique se devine
- **Extrait** :
  - « ensuite, simple halo générique sur le toit » ;
  - « Boulets : seulement leurs 10 points d'arrêt dans la cour adverse » ;
  - « P1 prise à 2,08 s, P9 à 4,53 s, premier mur à 7,28 s » ;
  - « porte M3 (piliers à 46,31 s, linteau à 51,29 s) » ;
  - saut du compteur de 61 à 116 à 100 s.
- **Problème** : chaque image révèle un mécanisme confidentiel :
  - le Graal sur le toit révèle l'ascenseur ;
  - 10 boulets qui tombent entre 85 et 89,5 s (`match_programme_reference.json`, segment « 10 boulets tirés… ») révèlent le canon ;
  - deux piles de 3 prises avant le premier mur révèlent les deux faces de préhension ;
  - deux piliers posés ensemble, puis le linteau, révèlent la « méthode de construction de la porte » (`dossier_monde.md` §11.2).

  Le marqueur de `dossier_monde.md` interdit de « laisser deviner ». Le script laisse ces points en [À CONFIRMER], mais les met au montage par défaut.
- **Correction** : par défaut, pas de Graal sur le robot, pas de boulets, pas de pierres qui disparaissent par paires. Montrer l'état final des constructions et le seul score total. Rétablir chaque élément seulement après validation écrite de l'équipe.

### P-5 · P19 à P24 (chapitre 5) · majeure · le présent fait croire que c'est fait
- **Extrait** : « Au départ, il choisit presque au hasard. Il commence par imiter… Puis il joue en simulation… Deux cents matchs d'examen désignent la meilleure version. Exporté, il tient en un demi-mégaoctet… »
- **Problème** : le spectateur comprend que « notre cerveau » a suivi ces étapes. Or :
  - seul existe un entraînement de fumée de 2 min 37 s, sur le moteur 1.3.0 : « pas un cerveau utilisable » (`trainer/README.md:58-77`, `:70`) ;
  - le moteur actuel est le 2.0.0 (`engine/engine.js:11`) ;
  - par défaut, l'imitation copie `ENV.EXAMPLE`, qui fait 74 pts et 6 erreurs (`trainer/imitation.py:49-51`, `docs/CONTRATS.md:133`) ;
  - par défaut, l'entraînement se fait sans adversaire (`trainer/ppo_trainer.py:77`).

  Il faut attendre P25-P26 pour l'apprendre.
- **Correction** : passer au futur (« Au départ, il choisira presque au hasard… »), ou afficher pendant tout le chapitre « Méthode · premier entraînement réel prévu en janv.–févr. 2027 » [À CONFIRMER : calendrier adopté par l'équipe].

### P-6 · P23 · majeure · examen sur 200 matchs
- **Extrait** : « Deux cents matchs d'examen désignent la meilleure version. »
- **Problème** :
  - 200 est une « Hypothèse » du code (`trainer/evaluation.py:31-32`). Jamais exécuté : la fumée a été évaluée sur 24 matchs (`trainer/README.md:74`).
  - Pour un même adversaire, les matchs sont identiques (« le moteur est déterministe pour un même adversaire », `trainer/README.md:74`). L'examen revient donc à un seul match répété.
  - Seule la moyenne sert à choisir (`trainer/ppo_trainer.py:334`).

  La phrase prête au procédé une rigueur statistique qu'il n'a pas encore. La note du script le reconnaît, mais la voix ne change pas.
- **Correction** : « Chaque version passera un examen sur des matchs simulés, contre plusieurs adversaires. » Ou bien couper P23. Ne pas citer « deux cents » tant que les matchs ne varient pas.

### P-7 · P25 · majeure · « de bout en bout »
- **Extrait** : « la chaîne d'apprentissage a fonctionné de bout en bout » ; écran « testée de bout en bout sur un essai ».
- **Problème** :
  - Le « bout en bout » du dépôt va de l'imitation à l'export ONNX (`trainer/README.md:58-77`). Il ne va pas jusqu'au robot : `pi5_runner.py` envoie 37 entrées au lieu de 56 et plante (`dossier_cerveau.md` §8.3, mesure du dossier ; `AUDIT_SIMULATEUR_IA.md:51-57`).
  - L'essai date du moteur 1.3.0. Rejoué sur le moteur actuel, ce cerveau fait 26 pts avec 76 erreurs par match (`dossier_cerveau.md` §9.1 a). Le diagnostic donne 36 pts (`diagnostic_pierres.md`, verdict) : chiffres à concilier [À CONFIRMER].
  - Pour le public, « de bout en bout » veut dire « jusqu'au robot ».
- **Correction** : « La chaîne d'apprentissage a tourné une première fois : un essai de quelques minutes, sur une version précédente du simulateur. » Écran : « Essai sur le moteur 1.3.0 · pas encore relancé sur le moteur actuel · pas encore à bord ».

### P-8 · Annexe A, ligne « après P21 » · majeure · prévu présenté comme fait
- **Extrait** : « Il s'entraîne contre plusieurs adversaires : le programme en miroir, des stratégies enregistrées, et plus tard d'autres réseaux. »
- **Problème** : c'est une décision d'équipe à appliquer (`docs/CONTRATS.md:151`). Aujourd'hui, l'entraînement se fait par défaut sans adversaire (`trainer/ppo_trainer.py:77`), et le self-play récurrent est impossible (`trainer/scenarios.py:49-51`).
- **Correction** : « Il devra s'entraîner contre plusieurs adversaires… »

### P-9 · P13 · moyenne · la « croyance » est contournée par le filtre (nouveau constat, mesuré)
- **Extrait** : « Et ce qu'il croit : une carrière reste pleine tant qu'il n'y est pas allé. » Image : « Puis le jaune tente P10 : la cellule P10 tombe à 0 ».
- **Problème** :
  - Les 56 entrées codent bien cette croyance (`engine/env.js:144-151`). Mais le filtre (masque) lit l'état réel des pierres : `sim.stones()`, `cur.k`, `sim.claimed` (`engine/actions.js:196-199`).
  - Mesuré : dans le duel, à t = 16,33 s, la croyance dit P10 = 3, alors que « Prendre P10 · face B » est **refusée par le masque** (`script_donnees_ecran.json`, `duel.decisions[5].action_valide_sous_masque = false`).
  - Un réseau ne « tenterait » donc jamais P10. La scène montre un échec du programme écrit à la main, que le système du réseau n'aurait pas.
  - Ce défaut n'est signalé dans aucun des trois dossiers.
- **Correction** :
  - soit retirer la tentative sur P10 ;
  - soit dire : « Aujourd'hui, ses entrées supposent une carrière pleine tant qu'il n'y est pas allé ; le filtre, lui, connaît encore la vérité. C'est à corriger. »

  Signaler aussi le défaut au chantier actions-env.

### P-10 · P15 · moyenne · frise de mémoire sur des décisions qui ne sont pas les siennes
- **Extrait** : « Frise horizontale des 13 décisions du match de référence, à leurs instants réels (…). Un anneau de 128 points lumineux passe d'une décision à la suivante. »
- **Problème** : ce sont les décisions du programme écrit à la main, qui n'a pas de mémoire. 4 d'entre elles sont refusées par le masque au moment où le programme les joue : « Mur M1 · int », « Mur M5 · int », « Porte M3 · int », « Lâcher les boulets » (`script_donnees_ecran.json`, `solo.decisions[3]`, `[7]`, `[10]`, `[11]`). Deux briques de ce programme n'existent pas dans le catalogue : `monterGraal` et la prise d'une pierre seule (`dossier_cerveau.md` §6.2).
- **Correction** : graduations génériques, ou mention à l'écran « Instants de décision du programme écrit à la main · illustration ».

### P-11 · P17 · moyenne · choix et filtre présentés comme réels
- **Extrait** : « la plus haute s'illumine et devient l'étiquette « Prendre P1 » » ; écran « À t = 0 s : 29 actions permises sur 130 (mesuré) » / « Choix : la note la plus haute ».
- **Problème** :
  - La mention « Notes : illustration », exigée au §3.3 pour P17, manque dans le texte à l'écran. « Prendre P1 » est le choix du programme, pas celui d'un réseau.
  - Mesuré ici (§5) : sur les 29 actions permises à t = 0, **10 échouent** si on les joue : 2 « Prendre le Graal » (« Action inconnue. »), 6 « repickup » (« Paquet inconnu. ») et 2 trajets (contact). Placé juste après « écarter l'impossible », le visuel fait croire que les 29 sont possibles.
- **Correction** : à l'écran, « Notes : illustration · choix du programme écrit à la main » et « 29 permises, dont 10 échouent encore (mesuré) ».

### P-12 · P18 · moyenne · « Cerveau : quoi faire » sur une brique du programme
- **Extrait** : « le robot exécute la brique réelle (0 → 3,13 s du match seul) » avec l'étiquette « Cerveau : quoi faire ».
- **Problème** :
  - La brique a été choisie par le programme écrit à la main. L'étiquette contredit le bandeau « pas le réseau » prévu pour tout plan de match (§3.1).
  - Quand c'est le réseau qui choisit un mur, une tour ou une porte, le « comment » n'est pas le même : `pm: 'proche'` est ajouté (`engine/actions.js:148-150`). C'est la cause du désordre dénoncé par le client (`diagnostic_pierres.md` §3). Le visuel promet donc une exécution propre que le réseau n'obtient pas aujourd'hui.
- **Correction** : à l'écran, « Illustration : choix du programme écrit à la main ». Envisager une phrase honnête : « Aujourd'hui, quand le réseau choisit, la pose des pierres est encore imprécise : c'est en cours de correction » [À CONFIRMER par l'équipe].

### P-13 · P21 · moyenne · récompense illustrée avec le mauvais chiffre
- **Extrait** : « Mosaïque de tables simulées (…) au moment où un mur est posé, « +8 » s'envole (…) comme à 7,28 s dans le match de référence ».
- **Problème** : dans ces tables d'entraînement, c'est le réseau qui choisit. Son mur passe par `pm: 'proche'`, et le score compte une même pile dans chaque zone touchée (`engine/score.js:74-80`, contraire à `spec/regles_2027.json:324`). D'où : « « Mur M1 » rapporte 13 pts au lieu de 8 » (`trainer/README.md:77`). Le « +8 » décrit le programme écrit à la main, pas l'entraînement.
- **Correction** : marquer la mosaïque « illustration » et ne pas afficher de valeur chiffrée, ou dire que le barème de l'entraînement est en cours de correction.

### P-14 · P24 · moyenne · embarqué suggéré
- **Extrait** : « une icône de fichier « 497 ko », qui vole jusqu'au robot de verre et s'y fond ».
- **Problème** : le geste visuel dit « c'est installé ». En réalité :
  - `pi5_runner.py` est incompatible (37 entrées contre 56, modèle par défaut introuvable : `dossier_cerveau.md` §8.3) ;
  - aucun firmware ESP32 n'est dans le dépôt (ibid.) ;
  - la latence sur Raspberry Pi 5 n'est pas mesurée (`dossier_cerveau.md` §8.2).

  L'écran dit « intégration prévue », mais l'image contredit l'écran. La taille de 497 261 octets est vérifiée ici (`.data/modeles/fumee.onnx`).
- **Correction** : fichier en pointillés qui s'arrête devant le robot ; écran « Prévu · pas encore testé à bord ».

### P-15 · P26 · moyenne · travail en cours et calendrier
- **Extrait** : « Le cerveau, lui, se construit : entraînement cet hiver, essais à bord au printemps. »
- **Problème** :
  - « Se construit » fait croire à un entraînement en cours ; le dépôt n'en montre aucun (`dossier_cerveau.md` §10, n° 6).
  - Le calendrier vient du « plan de remise en état proposé » de l'audit (`AUDIT_SIMULATEUR_IA.md:212`, tableau `:327-336`). Rien ne dit que l'équipe l'a adopté.
  - « Essais à bord au printemps » suppose un robot physique prêt [À CONFIRMER].
- **Correction** : « Le cerveau reste à entraîner : c'est prévu cet hiver, avec des essais à bord au printemps. » Faire valider les dates par l'équipe [À CONFIRMER].

### P-16 · P27 · moyenne · affirmations sans source
- **Extrait** : « Rendez-vous en mai deux mille vingt-sept : ICAM LOT cherche des partenaires. »
- **Problème** :
  - Une recherche de « sponsor », « partenaire » et « mécène » dans les .md, .html, .json et .js du dépôt ne donne aucun résultat. Les sources citées (F34, F01, `AUDIT_SIMULATEUR_IA.md:336`) ne parlent pas de partenaires.
  - « Mai 2027 » vient du seul calendrier de l'audit. L'inscription et l'homologation de l'équipe ne figurent nulle part.
- **Correction** : texte à faire valider par l'équipe [À FOURNIR]. En attendant : « Rendez-vous à la Coupe de France de robotique 2027 » [À CONFIRMER : date et inscription].

### P-17 · P05 → P06 · moyenne · promesse implicite
- **Extrait** : « … cent huit. » puis « Notre objectif : un cerveau qui s'adapte. »
- **Problème** : l'enchaînement laisse entendre qu'un réseau regagnerait les 8 points perdus. Le script le reconnaît : « Aucune mesure ne montre encore qu'un réseau fait mieux » (F09, `dossier_cerveau.md` §1.2). La note interdit de le suggérer à l'écran, mais la voix le suggère.
- **Correction** : « Notre objectif : un cerveau qui s'adapte. Fera-t-il mieux ? C'est ce qu'il reste à prouver. »

### P-18 · P07 · moyenne · « au millimètre, d'après le règlement »
- **Problème** :
  - Les PDF du règlement ne sont pas dans le dépôt (`dossier_monde.md`, « Limite importante »).
  - Le monde contient des hypothèses : durées, balistique, château « polygone hérité », accélérations non modélisées (`dossier_monde.md` §8.3).
  - Il contient aussi un écart connu au règlement : double comptage des murs (`engine/score.js:74-80` contre `spec/regles_2027.json:324`).
- **Correction** : « D'abord, on recrée le monde d'après les cotes du règlement. » Écran : « Source : transcription du règlement 2027 ».

### P-19 · §0.2 et §8 · moyenne · décisions prêtées au client
- **Extrait** :
  - « C'est la décision du client relayée par la commande » (forme visible) ;
  - « la commande du flux impose 90 à 120 s (« décision du client », non vérifiable ici) ».
- **Problème** : la demande relayée du client dit « plus de limite de temps », « plus de limite de moyen » et « le robot est invisible ». Le script s'impose 120 s en citant une « décision du client » contraire à ses propres mots. Il publie aussi la forme exacte au nom d'une décision que ces mots ne contiennent pas.
- **Correction** : appliquer la parole relayée (pas de limite de durée : intégrer l'annexe A une fois corrigée selon P-8 et P-29). Faire valider la forme par écrit [À CONFIRMER].

### P-20 · P10 · mineure
- **Problème** : 83 sur 83 est vérifié ici. Mais ce sont des tests de cohérence et de non-régression : « score golden 116 » vérifie que le score ne change pas. Ils n'ont détecté ni le double comptage ni la pose `proche`. La ligne « ok aucune erreur interne dans le duel » est vraie, mais ce duel compte 2 erreurs moteur côté jaune et 4 côté bleu (même sortie de test) : le public lira « aucune erreur ».
- **Correction** : voix « Quatre-vingt-trois tests automatiques contrôlent ce simulateur. » Remplacer la ligne « erreur interne » par une autre ligne neutre.

### P-21 · P14 · mineure
- **Problème** : 140 035 inclut la critique, qui ne sert qu'à l'apprentissage. La version qui joue a 123 394 paramètres (calcul refait ici). Les tailles sont aussi des « hypothèses de départ, à régler par l'équipe » (`trainer/models.py:79`).
- **Correction** : « … un réseau de neurones : plus de cent vingt mille réglages. » Écran : « architecture de départ ».

### P-22 · P22 · mineure
- **Problème** : refait ici, on obtient 12 matchs en 60,5 s, soit 5,0 s par match. C'est sur un Xeon 2,8 GHz du cloud, avec 1 fil et des choix aléatoires ; ce n'est pas la machine de l'équipe. L'ordre de grandeur « six secondes » tient, mais le libellé « temps réel » peut être lu comme « temps réel à bord ».
- **Correction** : libellé « temps de calcul ». Écran « machine de test (Xeon, 1 cœur), choix aléatoires ».

### P-23 · P20 · mineure
- **Problème** : juste après P04, le spectateur suppose que le réseau imite le programme des 116 pts. Par défaut, il imite `ENV.EXAMPLE` (74 pts, 6 erreurs). Même avec le programme de référence, 2 briques ne sont pas imitables et 4 cibles sont invalides sous le masque (`dossier_cerveau.md` §6.2).
- **Correction** : « Il imitera d'abord un programme écrit à la main. » Ne pas montrer le match des 116 pts comme le « professeur ».

### P-24 · P09 · mineure
- **Problème** : « il attend » décrit la règle du simulateur (l'écran le dit). Sur le robot réel, le lidar est « à définir » (`spec/robot.json:322`).
- **Correction** : « Dans le simulateur, si l'adversaire est à moins de quarante centimètres devant, il attend. »

### P-25 · P11, P12 · mineure
- **Problème** : « au moment où le robot jaune choisit sa prochaine action » : le jaune est le programme écrit à la main. Les 56 nombres sont « les entrées qu'un réseau recevrait » (`script_donnees_ecran.json`, `_avertissement`). La position adverse y est exacte, sans bruit (`engine/env.js:112-115`, `:306`) ; ce ne sera pas le cas à bord.
- **Correction** : écran « Ce que le réseau recevrait à cet instant · simulation ».

### P-26 · P16 · mineure
- **Problème** : 32 des 130 actions ne peuvent jamais réussir (`dossier_cerveau.md` §4.1). Et `monterGraal`, qui rapporte 25 pts au programme de P04, n'est pas dans le catalogue.
- **Correction** : écran « 130 actions au catalogue, dont 32 encore inutilisables ».

### P-27 · P04 et F35 · mineure · exactitude
- **Problème** : `match_programme_reference_solo.json` donne `score.jaune` = 8, 16, 24, 32, **38** (à 38,95 s, tour T2), 40, 61, puis 116. Le script et F35 omettent 38.
- **Correction** : corriger la liste.

### P-28 · P27 · mineure
- **Problème** : ce plan montre les constructions finales du match seul, sans le bandeau « SIMULATION · programme écrit à la main » exigé au §3.1.
- **Correction** : ajouter le bandeau.

### P-29 · Annexe A (autres lignes) · mineure
- **Après P05** : « Le maximum théorique, pour notre robot : cent trente-quatre points. » C'est un calcul du barème pour « le robot principal », hors PAMI (`AUDIT_SIMULATEUR_IA.md:192-196`). Il suppose le Graal au niveau 4, donc le toit modifié, et toutes les pierres disponibles. Correction : « Le maximum que permet le barème… »
- **Après P09** : « notre robot retarde son départ » décrit le simulateur. Correction : « dans le simulateur, notre robot… »
- **Après P13** : « c'est prévu pour mars » vient du calendrier de l'audit [À CONFIRMER].
- **Après P24** : « pour le robot » ; l'accord des deux formats a été mesuré sur le modèle d'essai, et rien ne tourne à bord. Correction : « Ses deux formats donnent les mêmes notes à trois millionièmes près (mesuré sur un modèle d'essai). »

### P-30 · P06 · mineure
- **Problème** : un réseau qui s'allume dans le robot, juste après les matchs, fait croire que le cerveau est à bord, ou qu'il pilotait ces matchs.
- **Correction** : montrer le réseau hors du robot, sur un écran d'ordinateur.

### P-31 · P08 · mineure · confidentialité
- **Problème** : les cases rouges, calculées avec `freeGrid` à la pose du robot (`engine/engine.js:387-398`), suivent l'empreinte réelle de 45 sommets. Leur contour trahit la forme du robot.
- **Correction** : calculer la grille avec la silhouette générique de P-1, ou afficher seulement les obstacles (pierres, bords).

### P-32 · Titre · mineure
- **Problème** : « Le cerveau d'ICAM LOT » laisse entendre que ce cerveau existe.
- **Correction** : « Construire le cerveau d'ICAM LOT ».

## 4. Points vérifiés et justes

- Aucun score, taux de victoire ni comportement attribué au réseau. La phrase « aucun cerveau entraîné n'existe encore » figure en §0, en P16 et dans les notes.
- 116 pts seul et 108 contre 65 en duel : relu dans les fichiers de match et dans la sortie de `tests/test_moteur.js` refaite ici.
- 83 tests sur 83 ; les libellés de P10 existent : « bareme.js identique… », « aucun contact », « score golden 116 », « aucune erreur interne dans le duel ».
- Duel : le bleu décide P10 à 9,441 s et la prend à 10,837 s. Le jaune échoue à 16,326 s sur « Le paquet P10 n'est plus là (pris par l'adversaire). » Il n'y a aucune attente lidar, et la distance minimale entre les centres est de 500,0 mm à 26,25 s.
- 140 035 et 123 394 paramètres (calcul refait) ; `fumee.onnx` fait 497 261 octets.
- Croyance P4 = P8 = P10 = 3 à 16,33 s, et carrières vidées à 2,08 s, 8,39 s et 10,84 s (`evenements_pierres`).
- 29 actions permises à t = 0 (refait).
- Taux d'erreur du masque en politique aléatoire : 64,2 % sur 12 matchs, refait ici. Le script cite 66 % sur 40 matchs : c'est cohérent.
- La voix off est identique dans `script_documentaire.json`, `script_documentaire.md` et `voix_off_heygen.txt`.
- Aucune latence sur Pi 5 n'est annoncée : P24 la note « non mesurée ».

## 5. Mesures exécutées pour ce contrôle

Fichiers dans `/tmp/claude-0/-home-user-icamlot/7624d51f-7be7-5b87-ae0f-1fda87a83f3b/scratchpad/verif_honnetete/` :

| Fichier | Commande | Résultat |
|---|---|---|
| `test_moteur.out` | `node tests/test_moteur.js` (dans le dépôt) | 83 réussis, 0 échoué ; détail du score 116 ; duel « jaune 108 pts (2 erreurs), bleu 65 pts (4 erreurs) » |
| `masque_t0.js`, `masque_t0.out` | `node masque_t0.js /home/user/icamlot-audit` | à t = 0 : 29 actions permises (prendre 12, prendreGraal 2, trône 1, repickup 6, traj 6, tournerPince 2) ; jouées une à une : 19 réussissent, 10 échouent |
| `debit_rejoue.out` | `node …/scratchpad/mesures/masque_vs_moteur.js /home/user/icamlot-audit 12` | 12 matchs en 60,5 s (0,198 match/s, 5,0 s par match), 26,1 décisions par match, 64,2 % d'erreurs moteur ; Xeon 2,8 GHz, 4 vCPU |
| (lecture Python) | `match_programme_reference*.json`, `script_donnees_ecran.json` | paliers de `score.jaune` ; erreurs des briques ; `action_valide_sous_masque` ; distance minimale entre les robots |

## 6. [À FOURNIR] et [À CONFIRMER] issus de ce contrôle

- [À CONFIRMER] Validation écrite de la forme du robot à l'écran (P-1), et des indices de mécanique de P-4.
- [À CONFIRMER] Un robot physique existe-t-il, et dans quel état (P-2) ? Le toit de 311,2 mm sera-t-il réalisé (P-3) ?
- [À CONFIRMER] L'équipe a-t-elle adopté le calendrier de l'audit (P-15) ?
- [À FOURNIR] Recherche de partenaires, date de la compétition, inscription (P-16).
- [À CONFIRMER] Score du cerveau d'essai rejoué sur le moteur actuel : 26 pts (`dossier_cerveau.md` §9.1) ou 36 pts (`diagnostic_pierres.md`, verdict).
- À signaler au chantier actions-env : le masque lit l'état réel des carrières (`engine/actions.js:196-199`), alors que l'observation code une croyance (P-9).
