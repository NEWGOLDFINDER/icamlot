# Diagnostic : les pierres « posées n'importe comment » dans la vidéo

Document interne. Il contient de la mécanique confidentielle (section 6). Tout chiffre vient d'un fichier cité (`chemin:ligne`) ou d'une mesure faite dans le moteur avec les scripts de ce dossier. Ce qui manque est marqué [À FOURNIR] ou [À CONFIRMER].

## Verdict

| Question | Réponse mesurée |
|---|---|
| Le rendu des pierres est-il faux ? | **Non** pour les pierres au départ, à plat et debout : 0 mm d'écart sur les 8 sommets. **Oui** pendant une rotation de nacelle : jusqu'à 225 mm d'écart. Ce cas n'apparaît pas dans les 10,2 s montrées (rotation maximale mesurée : 0°). |
| D'où vient le désordre vu dans la vidéo ? | **Du moteur, couche actions.** Les briques du réseau reçoivent `pm: 'proche'`. Le moteur pose alors la pile au point valide le plus rapide à atteindre, à n'importe quel angle, pourvu qu'elle mord de 8 mm dans la zone. Le « Mur M1 » du modèle est à 0 % dans M1, tourné de 45°, à 342 mm du centre de la zone. |
| Ce placement est-il récompensé ? | **Oui.** `score.js` compte une même pile comme mur dans chaque zone qu'elle touche : 2 piles valent 4 murs (20 pts). Cela contredit `spec/regles_2027.json:324`. |
| Le modèle d'essai est-il encore valable ? | **Non.** Contre le moteur actuel, il fait 36 pts et 76 erreurs. À partir de 9,99 s, il choisit 76 fois de suite une action supprimée du moteur. Le robot reste ensuite immobile jusqu'à 100 s. |
| Quelle source pour une vidéo réaliste et honnête ? | `ENGINE.PROGRAMME_REFERENCE` : seul, 116 pts, 0 erreur ; en duel contre son miroir, 108 pts contre 65. C'est un programme écrit à la main, pas le réseau. `ENV.EXAMPLE` pose des constructions propres, mais il fait 6 erreurs et ne déplace jamais le Graal. |

## 0. Sources et méthode

- Dépôt : copie de `audit/simulateur-ia`, `/home/user/icamlot-audit`, commit `0161a452ce9b`, moteur `VERSION 2.0.0` (`engine/engine.js:11`). Aucun fichier du dépôt n'a été modifié.
- Tests du moteur exécutés avant les mesures : `node tests/test_moteur.js` → **83 réussis, 0 échoué**.
- Chargement identique à `vid/stones.js` : contexte `vm` avec `spec/spec.js`, `bareme.js`, `engine/*.js`. La fonction interne `geomHeld` est exposée en mémoire par remplacement de texte. Elle est pure : elle ne lit que la pose passée en argument (`engine/engine.js:175-179`).
- Scripts (dans ce dossier) :
  - `gen_match_reference.js` : générateur des matchs échantillonnés ;
  - `diag_pierres.js` : conventions, matchs, constructions, zones. Il écrit `diag_mesures.json` et sa sortie est dans `diag_sortie.txt` ;
  - `valider_rendu.js` : formule de rendu actuelle et corrigée, testée avec three.js 0.169 (`vid/node_modules/three`).
- **Intensité « réaliste »** : `intensityParams` ne modifie que `faible` et `agressif` (`engine/engine.js:88-93`). « Réaliste » = paramètres `DEF` inchangés.
- **Graine 10000** : `P.seed` n'est lu nulle part dans `engine/engine.js`. Seul `P.bseed` sert, aux boulets (`engine/engine.js:1043`). Mesure : le duel EXAMPLE donne une chronologie identique (poses, pierres, erreurs) avec la graine 10000, avec la graine 12345 et sans graine.

## 1. Convention géométrique et rendu

### 1.1 `nv`, `lv`, `rectPoly` (`engine/geom.js:154-155, 172-176`)

`nv(a) = (cos a, sin a)` est la normale. `lv(a) = (−sin a, cos a)` est la direction latérale, c'est-à-dire a + 90°. `rectPoly` place `hl` le long de `lv(ang)` et `hn` le long de `nv(ang)`. Mesure sur les sommets produits :

| `ang` | arête de 2·hl = 320 mm orientée vers | arête de 2·hn = 110 mm orientée vers |
|---|---|---|
| 0 | 90° | 0° |
| 30 | 120° | 30° |
| 90 | 180° | 90° |
| 135 | 225° | 135° |

Conclusion : le côté `hl` est orienté à `ang + 90`. L'angle exporté par `vid/stones.js:38` (`f.ang + 90`) est donc bien la direction du côté `hl`.

### 1.2 Pierre tenue : `heldFoot` (`engine/geom.js:167-171`) et `geomHeld` (`engine/engine.js:175-179`)

`fo.ang` est la normale de la face qui tient la pierre (`p.h + 120·k`). `hl = 160|cos th| + 55|sin th|`, `hn = 55`, et la demi-hauteur vaut `160|sin th| + 55|cos th|`. `th` est la rotation de la nacelle. Mesures (pose de test, face A) :

| rot | rangée | 2·hl (le long de `ang+90`) | 2·hn | top − bottom | z | décalage latéral |
|---|---|---|---|---|---|---|
| 0 | 1 / 2 / 3 | 320 | 110 | 110 | 0→110 / 110→220 / 220→330 | 0 |
| 90 (debout) | 1 / 2 / 3 | 110 | 110 | **320** | 0→320 | −110 / 0 / +110 |
| 180 | 1 / 3 | 320 | 110 | 110 | 220→330 / 0→110 | 0 |
| 45 | 2 | 304,06 | 110 | 304,06 | — | 0 |

- **À plat** : `hl` = grand côté (320), `hn` = petit côté (110), `top − bottom` = hauteur (110). C'est correct.
- **Debout** (portes, tours) : l'empreinte au sol fait 110 × 110. Le grand côté de 320 mm est vertical : `top − bottom = 320`. `ang` donne alors l'orientation du carré, et non celle du grand côté. Les dimensions exportées (110, 110, 320) sont correctes.
- **Entre deux angles** (rotation en cours) : `hl` et `top − bottom` décrivent la **boîte englobante** de la pierre inclinée, et non la pierre elle-même. À 45°, on obtient 304 × 304 au lieu de 320 × 110.
- Les formules de `geomHeld` et de `SCORE.stoneGeoAt` (`engine/score.js:20-25`) ont été comparées tous les 0,5 s sur les 5 matchs : écart maximal 0 mm sur le centre, 6·10⁻¹⁴ mm sur le haut.

### 1.3 Rendu de la vidéo (`vid/stones.js:38, 48` puis `vid/partD.js:66`)

Le rendu crée une `BoxGeometry(320, 110, 110)`, la place en `(cx, zc, cy)`, applique `rotation.y = −angle` et une échelle `(2hl/320, (top−bottom)/110, 2hn/110)`. Le repère est `tab(x, y, h) = (x, h, y)` (`vid/partA.js:24`), le même que celui des robots (`vid/partB.js:18`). Les 8 sommets ont été mesurés avec three.js et comparés à la boîte vraie du moteur :

| Cas | Écart max, formule actuelle | Écart max, formule corrigée |
|---|---|---|
| Au départ, P1 (axe x) et P9 (axe y) | 0 mm | 0 mm |
| Tenue à plat, faces A et B, rangées 1 et 3 | 0 mm | 0 mm |
| Debout (rot 90°), faces A et B | 0 mm | 0 mm |
| Retournée (rot 180°) | 0 mm | 0 mm |
| Rotation en cours, rot 30° | **160 mm** (boîte 332 × 255 × 110) | 0 mm |
| Matchs exportés, échantillons en rotation (123 pour EXAMPLE, 179 pour PROGRAMME_REFERENCE en duel) | **jusqu'à 225 mm** (th ≈ 45°) | 0 mm |

Dans le segment rendu, le match fumee de 0 à 10,2 s (`vid/stones.js:40`, `T_END = 10.2`), la rotation de nacelle mesurée vaut **0°** sur les deux faces des deux robots. Le défaut de rotation n'a donc pas pu apparaître à l'écran.

Défaut mineur : au départ, `stones.js:48` code P9 et P10 avec un angle de 0° et des dimensions échangées (110 × 320). Une fois la pierre tenue, l'angle vaut celui du grand côté (90°). `stoneSample` (`vid/partD.js:9-10`) interpole donc un quart de tour sur un seul échantillon de 50 ms à la prise (4,55 s de match). Avec la table `KF` de `vid/partD.js:24` (3,5 → 5,576 s de match en 0,7 s de vidéo ; `DEC[2].t` = 5,576 s dans `vid/netlive.json`), ces 50 ms durent environ 17 ms à l'écran, soit moins d'une image à 30 i/s (`vid/render.js:5`).

**Verdict : le rendu est juste pour tout ce qui a été montré. Il serait faux pendant les rotations (portes, tours).** Correction :

```js
// b = [etat, qui, cx, cy, z_bas, z_haut, hl, hn, ang, th, face, rangee]  (fichiers match_*.json de ce dossier)
s.scale.set(1, 1, 1);                                            // plus de déformation
s.position.set(b[2], (b[4] + b[5]) / 2, b[3]);
s.rotation.set(0, -b[8] * Math.PI / 180, -b[9] * Math.PI / 180); // ordre XYZ (défaut three.js) : lacet = ang, puis roulis −th
```

- Pierre au départ : `ang` = axe long de la carrière (0 ou 90), `th = 0`, sans échanger les dimensions. Le quart de tour de P9 et P10 disparaît.
- Si l'on garde `stones.js`, il faut ajouter `th`. `geomHeld` le renvoie **en radians** (`g.th`, `engine/engine.js:178`).
- Interpolation :
  - pas d'interpolation à travers un changement d'état (prise, lâcher) : utiliser `evenements_pierres` ;
  - `ang` au plus court modulo 360 ;
  - `th` linéaire.
- Vérifié par `valider_rendu.js` sur 60 030 états de pierre par fichier : écart nul avec la formule corrigée. Écart entre `hl`, `hn`, `z_bas`, `z_haut` et la boîte reconstruite : ≤ 0,05 mm (arrondi à 0,1 mm).

## 2. Matchs joués dans le moteur

« Fin » = `R.T`. `finish()` ajoute 0,5 s après la dernière brique (`engine/engine.js:1524`). Les scores sont calculés par `SCORE.scoreAt(R, R.params)`, évalués à 100 s (`engine/score.js:160-163`).

| Match | Équipe | Score | pierres / murs / tours / porte / Graal / roi / boulets | Dernière brique, R.T | Erreurs | Contacts |
|---|---|---|---|---|---|---|
| EXAMPLE seul | jaune | **74** | 9 / 10 / 0 / 20 / 5 / 10 / 20 | 89,8 s, 90,3 s | 6 | 0 |
| EXAMPLE contre miroir | jaune | **74** | 9 / 10 / 0 / 20 / 5 / 10 / 20 | 89,8 s, 90,3 s | 6 | 0 |
|  | bleu | **51** | 6 / 10 / 0 / 0 / 5 / 10 / 20 | 89,8 s, 90,3 s | 8 | — |
| fumee contre EXAMPLE | jaune | **36** | 6 / 20 / 0 / 0 / 5 / 5 / 0 | 9,99 s | **76** | 0 |
|  | bleu | **13** | 3 / 5 / 0 / 0 / 5 / 0 / 0 | 11,6 s | 2 | — |
| PROGRAMME_REFERENCE seul | jaune | **116** | 16 / 20 / 5 / 20 / 25 / 10 / 20 | 89,8 s, 90,3 s | 0 | 0 |
| PROGRAMME_REFERENCE contre miroir | jaune | **108** | 13 / 15 / 5 / 20 / 25 / 10 / 20 | 89,8 s, 90,3 s | 2 | 0 |
|  | bleu | **65** | 10 / 15 / 5 / 0 / 25 / 10 / 0 | 43,94 s, 44,44 s | 4 | — |

Ces chiffres concordent avec `docs/CONTRATS.md:133` (PROGRAMME_REFERENCE : 116 pts, 90,3 s, 0 erreur ; EXAMPLE : 74 pts, 6 erreurs) et avec la sortie de `tests/test_moteur.js` (duel : jaune 108 avec 2 erreurs, bleu 65 avec 4 erreurs). Les contacts du bleu ne sont pas calculés : `skipContacts: !cfg.blue.contacts`, `engine/engine.js:1612`.

### 2.1 ENV.EXAMPLE (`engine/env.js:531-541`), seul et en duel : chronologie jaune identique

Briques jaunes :

| Temps | Brique | Résultat |
|---|---|---|
| 0→3,13 s | prendre P1 (face A) | |
| 3,13→5,58 s | prendre P9 (face B) | |
| 5,58 s | mur M1 ext | ERREUR « Pose sur M1 : aucune position sans contact (bord de table) » ; voir `docs/CONTRATS.md:126` : M1 et M5 sont impossibles depuis l'extérieur |
| 5,58→8,1 s | mur M2 ext | |
| 8,1 s | prendre P5 | ERREUR « La face A tient déjà quelque chose » |
| 8,1→12,55 s | prendre P10 | |
| 12,55 s | mur M5 ext | ERREUR |
| 12,55→16,47 s | mur M4 ext | |
| 16,47 s | prendre P4 | ERREUR |
| 16,47→28,68 s | porte M3 int | avec la pile P1, portée depuis 3,13 s |
| 28,68 s | `prendreGraal`, `poserGraal` | ERREUR « Action inconnue » : étapes supprimées, `docs/CONTRATS.md:121` |
| 28,68→89,6 s | tir | |
| 89,6→89,8 s | trône | |

Constructions finales du jaune : toutes parfaites (100 % dans la zone, écart d'angle 0°, centre sur le centre de la zone).

| Construction | Pierres | Centre | Angle du grand côté | z | Position | Dans la zone | Empilement |
|---|---|---|---|---|---|---|---|
| Mur M2 (axe 45°) | P9.1, P9.2, P9.3 | (679,3 ; 570,8) | 45° | 0→110, 110→220, 220→330 | à plat | 100 % | 3 alignées, dispersion 0 mm et 0° |
| Mur M4 (axe −45°) | P10.1, P10.2, P10.3 | (679,3 ; 1429,5) | 135° | idem | à plat | 100 % | 3 alignées, 0 mm, 0° |
| Porte M3 (axe 90°) | P1.1 pilier | (850 ; 945) | — | 0→320 | debout | 100 % | — |
|  | P1.2 pilier | (850 ; 1055) | — | 0→320 | debout | 100 % | — |
|  | P1.3 linteau | (850 ; 1000) | 90° | 320→430 | à plat | 100 % | linteau posé sur les piliers (dessous à 320) |

- Les deux piliers se touchent : les centres sont à 110 mm et chaque pilier fait 110 mm de large, donc l'écart entre piliers est de 0 mm. C'est la conséquence des rangées espacées de 110 mm (`docs/CONTRATS.md:34`). Le règlement demande « 2 pierres verticales surmontées d'1 pierre horizontale » (`spec/regles_2027.json:321`) sans parler d'ouverture. [À CONFIRMER] par l'équipe : est-ce bien la porte voulue ? À l'écran, elle n'a pas d'ouverture.
- Le Graal reste à son départ (70, 810) tout le match.

En duel, le bleu (miroir) perd P9, P10 et P1, pris par le jaune. Il fait 8 erreurs. Ses murs M6 (2750 ; 420) et M10 (2750 ; 1580) sont entièrement dans leur zone, avec un angle de 0° et le centre à 20 mm du centre de la zone. Ce décalage reste dans la marge du mode « parfait » (±45 mm le long de la normale, `engine/engine.js:1225`).

### 2.2 Modèle fumee contre ENV.EXAMPLE : le match de la vidéo

Même boucle que `vid/stones.js` et `vid/record.js` (choix glouton sous masque, 80 décisions au plus).

| Temps | Décision du réseau | Brique envoyée au moteur |
|---|---|---|
| 0→3,13 s | Prendre P1 · face A | `{prendre, A, P1}` |
| 3,13→5,58 s | Prendre P9 · face B | `{prendre, B, P9}` |
| 5,58→7,84 s | Mur M1 · ext · face A | `{mur, A, M1, ext, **pm: 'proche'**}` |
| 7,84→9,99 s | Mur M4 · ext · face B | `{mur, B, M4, ext, **pm: 'proche'**}` |
| 9,99 s (×76) | Prendre le Graal · face B | `{prendreGraal, B}` → ERREUR « Action inconnue », durée 0 |

Constructions finales du jaune. C'est ce que montre la vidéo :

| Brique | Pierres | Centre | Angle du grand côté | z | Part dans la zone visée | Où est réellement la pile | Pénétration dans la zone visée |
|---|---|---|---|---|---|---|---|
| « Mur M1 » (axe 0°) | P1.1–3 | (590 ; 360) | 135° (**45° d'écart**) | 0→330, 3 alignées | **0 %** | 48 % sur le cercle de T1, 21 % dans M2 | 12,0 mm |
| « Mur M4 » (axe −45°) | P9.1–3 | (819,3 ; 1089,5) | 135° | 0→330, 3 alignées | **1 %** | **77 % dans M3**, 5 % sur T3 | 13,6 mm |

- Le centre du « Mur M1 » est à 342 mm du centre de M1 ; celui du « Mur M4 », à 368 mm du centre de M4.
- Les piles elles-mêmes sont bien formées (3 pierres alignées, dispersion 0 mm et 0°, z contigus). C'est leur **emplacement** qui est aberrant.
- `vid/stones.json` contient exactement ces poses : P1 à 7,05 s en (590 ; 360), angle −45 ≡ 135 ; P9 à 9,2 s en (819,3 ; 1089,5), angle 135.
- `score.js` compte **4 murs** (M1, M2, M3, M4) avec 6 pierres, soit 20 pts.
- Après 9,99 s, le jaune est immobile en (617,6 ; 887,8), h = −75°, jusqu'à 100 s.
- Le bleu s'arrête à 11,6 s en tenant P8. La boucle de `vid/record.js` ne termine pas le match de l'adversaire : `endMatch()` n'est appelé que par `play()` (`engine/env.js:419, 449`).

### 2.3 ENGINE.PROGRAMME_REFERENCE (`engine/engine.js:1666-1675`)

Seul : 0 erreur, 0 contact. Toutes les constructions sont entièrement dans leur zone, avec un écart d'angle de 0° et un écart au centre de 0 mm.

| Construction | Pierres | Centre | Angle | z | Position |
|---|---|---|---|---|---|
| Mur M2 | P9.1–3 | (679,3 ; 570,8) | 45° | 0→330 | à plat, 3 alignées |
| Mur M1 | P1.1–3 | (250 ; 400) | 0° | 0→330 | à plat, 3 alignées |
| Mur M4 | P10.1–3 | (679,3 ; 1429,5) | 135° | 0→330 | à plat, 3 alignées |
| Mur M5 | P5.1–3 | (250 ; 1600) | 0° | 0→330 | à plat, 3 alignées |
| Tour T2 | P6.3 | (850 ; 750), 0 mm du centre | — | 0→320 | debout |
| Porte M3 | P2.1, P2.2 piliers ; P2.3 linteau | (850 ; 945), (850 ; 1055), (850 ; 1000) | — / — / 90° | 0→320 ; 320→430 | debout / à plat |

Le Graal finit sur le toit (`toit`, dessous à 311,2 mm).

En duel contre son miroir :
- **Jaune, 108 pts.** P10 est pris par le bleu (2 erreurs). Le mur M4 n'est donc pas construit ; le reste est identique et parfait.
- **Bleu, 65 pts.** Il fait 4 erreurs :
  - P9 est pris par le jaune ;
  - « Porte M8 : aucune position sans contact (P7.3) », c'est-à-dire sa propre tour T6 ;
  - « Trajet vers 2750, 1000 : aucun passage sans contact trouvé » pour le tir.
- Le bleu finit au trône à 43,94 s en tenant P3, qui n'est pas comptée. Ses constructions M6, M9, M10 et T6 sont entièrement dans leur zone, avec 0° d'écart.
- Ce duel est l'adversaire par défaut retenu par l'équipe (`docs/CONTRATS.md:150`).

### 2.4 Prises et lâchers

Sur les 5 matchs, le saut de géométrie mesuré à la prise (carrière → pince) et au lâcher (pince → posée) vaut **0 mm et 0°**. Le moteur ne téléporte aucune pierre.

## 3. Conclusion : d'où vient le désordre

1. **Cause principale : le moteur, via la couche actions.**
   - `ACTIONS.toProgramStep` ajoute `pm: 'proche'` à toute brique mur, tour ou porte (`engine/actions.js:148-150`).
   - En mode `proche`, `placeCands` balaie une grille de ±380 mm autour de la zone, tous les 20 mm et tous les 15° (`engine/engine.js:973`). Il trie les candidats par temps de trajet estimé depuis le robot (`:982`).
   - Le seul critère de placement est une pénétration de 8 mm dans la zone (`OVL`, `engine/engine.js:953, 977`). `ovl: 8` est une « hypothèse héritée » (`engine/engine.js:27-28`).
   - Le moteur pose donc la pile **au point valide le plus proche du robot**, et non dans la zone. Mesuré : 0 % et 1 % dans la zone visée, 45° d'écart, 342 à 368 mm du centre.
   - Le défaut est déjà signalé dans `trainer/README.md:77` et `docs/CONTRATS.md:98` (« Mur M1 rapporte 13 pts au lieu de 8 »).
   - Les programmes écrits à la main n'ont pas `pm`. Ils passent par le mode « parfait » (`engine/engine.js:1221-1229`) : écart de 0 à 20 mm au centre, entièrement dans la zone.
2. **Le score récompense ce placement.**
   - `SCORE.outcome` traite chaque zone séparément (`engine/score.js:74-80`). Une pile qui touche deux zones y est comptée comme deux murs.
   - Cela contredit « pierre_une_seule_construction » (`spec/regles_2027.json:324`).
   - Le fichier versionné `.data/modeles/fumee.eval.json` montre ce schéma au moment de l'entraînement : `detail_moyen` vaut `murs: 20.0` avec `pierres: 6.0`, soit 4 murs pour 6 pierres.
   - Savoir si une pile à 45°, presque hors de la zone, est un « mur » au sens du règlement (« dans une zone rectangulaire », `spec/regles_2027.json:319` ; « tout ou partie de la projection verticale », `:318`) relève de l'arbitre. [À CONFIRMER]
3. **Le modèle d'essai est périmé.**
   - fumee a été exporté au commit `e220a99` (2026-10-28 10:38). Dans ce commit, le moteur exécute encore `prendreGraal` (`git show e220a99:engine/engine.js`, ligne 1001).
   - L'étape a disparu avec la fusion du chantier moteur `63d27dc` (11:08), où elle n'apparaît plus (`docs/CONTRATS.md:121`).
   - Le catalogue les propose encore et le masque les juge valides (`engine/actions.js:65-69, 640`).
   - Le réseau les choisit 76 fois. Chaque choix dure 0 s, si bien que la limite de 80 décisions (`trainer/README.md:97`) est atteinte à 9,99 s.
   - Mesure actuelle : 36 pts. `fumee.eval.json` indique 76 pts, mais il a été obtenu avec l'ancien moteur.
   - Le README le dit lui-même : « C'est un entraînement de fumée, pas un cerveau utilisable » (`trainer/README.md:70`).
4. **Le rendu n'est pas en cause dans la vidéo** (section 1.3). Il ne serait faux que pendant les rotations de nacelle, absentes du segment montré.
5. **Source pour la vidéo.**
   - Le plus réaliste et le plus honnête est `ENGINE.PROGRAMME_REFERENCE`. Le contrat dit de l'utiliser « à la place de ENV.EXAMPLE » (`docs/CONTRATS.md:133`).
     - Seul (`match_programme_reference_solo.json`) : 116 pts, 0 erreur, constructions parfaites.
     - En duel (`match_programme_reference.json`) : interaction réelle, mais le bleu échoue sa porte et son tir, puis attend au trône de 43,9 à 100 s.
   - `ENV.EXAMPLE` (`match_reference.json`, demandé) : constructions parfaites, mais 6 briques en erreur et un Graal qui ne bouge pas. Il reste le programme imité par l'entraînement (`--exemple`, `trainer/imitation.py:188`), donc légitime pour illustrer « la démonstration que le réseau imite ». Il faut alors dire qu'il fait 74 pts et 6 erreurs dans le moteur actuel.
   - Dans tous les cas, il faut présenter ces matchs comme des **programmes écrits à la main**, pas comme le réseau. Montrer un réseau qui joue demande un modèle réentraîné sur le moteur actuel. [À FOURNIR]
   - Réalisme des durées : la vitesse linéaire de 500 mm/s et la rotation de 120°/s sont « déclarées » ; la vitesse d'approche de 200 mm/s est « héritée » (`spec/robot.json`, `entrainement`). Les durées de pince (chariot 100 mm/s, 1,5 s par 90°, prise 0,5 s, relâche 0,4 s) sont des hypothèses héritées (`docs/CONTRATS.md:38`). [À CONFIRMER] par une mesure sur le robot réel.

## 4. Fichiers produits (dossier `doc/`)

| Fichier | Contenu |
|---|---|
| `match_reference.json` (3,4 Mo) | ENV.EXAMPLE contre son miroir, intensité réaliste, graine 10000 |
| `match_reference_solo.json` (3,1 Mo) | ENV.EXAMPLE seul |
| `match_programme_reference.json`, `match_programme_reference_solo.json` | Même format, PROGRAMME_REFERENCE (source recommandée) |
| `gen_match_reference.js` | Générateur |
| `diag_pierres.js`, `diag_mesures.json`, `diag_sortie.txt` | Mesures de ce rapport |
| `valider_rendu.js` | Vérification de la formule de rendu sur un fichier `match_*.json` |

Commandes :
- `node gen_match_reference.js` produit les deux fichiers EXAMPLE ;
- `node gen_match_reference.js --programme PROGRAMME_REFERENCE` produit les deux autres ;
- options : `--root`, `--out`, `--graine`, `--intensite`, `--dt`, `--duree`.

Format (décrit aussi dans l'en-tête de chaque fichier, clés `colonnes` et `geometrie_pierre`) : 2001 instants (0 à 100 s, pas de 0,05 s).

| Clé | Contenu |
|---|---|
| `robots.jaune[i]`, `robots.bleu[i]` | `[x, y, h, A.hc, A.rot, A.vide1..3, B.hc, B.rot, B.vide1..3, C.can, C.fx, C.fz]`. `h` n'est pas ramené à [0, 360[ : il est continu, par exemple de −120 à 270 dans `match_reference.json`, et s'interpole linéairement |
| `pierres[id][i]` | `[etat (0 home, 1 held, 2 free, 3 gone), qui, cx, cy, z_bas, z_haut, hl, hn, ang (direction du côté hl, [0, 360[), th (rotation de la nacelle), face, rangée]` |
| `evenements_pierres[id]` | Prises et lâchers horodatés |
| `graal.jaune[i]`, `graal.bleu[i]` | `[k, cx, cy, ang, z_bas, z_haut]`, d'après `SCORE.graalPos` |
| `boulets.<équipe>[i]` | `null` avant le tir, sinon 10 positions `[x, y, z]`. Les trajectoires brutes sont dans `jaune.boulets.tirs` |
| `score.<équipe>[i]` | `[total, pierres, murs, tours, porte, graal, roi, boulets]`, d'après `SCORE.scoreAt(R, params, t)`. Avant 100 s, le trône, les boulets et le Graal valent 0 (`engine/score.js:159-163`) |
| `jaune.briques`, `bleu.briques` | Brique, `t0`, `t1`, erreur |
| `jaune.segments` | Libellés de mouvement du moteur, utiles pour la narration |
| `jaune.erreurs`, `jaune.score_final` | Erreurs et détail du score final |

Aucun conflit de pierre (pierre tenue par les deux robots) et aucun état `gone` dans les fichiers produits.

## 5. Corrections à faire (fichiers à leurs propriétaires, `docs/CONTRATS.md:12-21`)

| Propriétaire | Fichier | Correction |
|---|---|---|
| actions-env | `engine/actions.js:148-150` | Ne plus forcer `pm: 'proche'`. Contrat §6 : « une action exécutée par ENV.step doit avoir exactement le même effet que la brique de programme correspondante » (`docs/CONTRATS.md:98`) |
| actions-env | `engine/actions.js:65-69, 640` | Retirer `prendreGraal` et `poserGraal` du catalogue ou du masque |
| moteur | `engine/score.js:74-80` | Une pierre ne compte que pour une construction (`spec/regles_2027.json:324`) |
| moteur | `engine/engine.js:953, 973-982` | Si le mode `proche` est conservé, exiger l'axe de la zone et une part minimale de l'empreinte dans la zone. Seuil [À CONFIRMER] par l'équipe |
| entrainement | `.data/modeles/fumee.*` | Réentraîner sur le moteur actuel [À FOURNIR] |
| vidéo | `vid/stones.js`, `vid/partD.js` | Formule de la section 1.3 ; appeler `endMatch` (`ENV.play`) ou faire jouer le bleu jusqu'à 100 s |

## 6. Confidentialité (vidéo publique)

Les fichiers `match_*.json`, `diag_*` et ce rapport sont **internes**. Ce qui ne doit pas apparaître à l'écran, ou seulement sur décision de l'équipe [À CONFIRMER] :
- **Pinces et ventouses.**
  - Données : `A.hc`, `A.rot`, `A.vide1..3`, `B.*`, et `face` et `rangee` des pierres.
  - Ce qu'elles révèlent : deux faces à 120° qui portent chacune une pile de 3 pierres, trois rangées de ventouses espacées de 110 mm, une pierre à 200,3 mm du centre, et la rotation de 90° qui met la pile debout pour les piliers.
  - Même sans dessiner la pince, montrer des pierres qui flottent en pile de 3 contre deux faces du robot et basculent ensemble révèle le principe.
- **Canon.**
  - Données : `C.can`, `jaune.boulets.bouche` (position et hauteur de la bouche), vitesse de sortie, trajectoires depuis la face C.
  - Montrer les boulets arriver dans la cour adverse est moins révélateur que montrer leur départ. [À CONFIRMER]
- **Ascenseur et fourche du Graal** : `C.fx`, `C.fz`, et les états `ascenseur` et `toit` (Graal posé à 311,2 mm sur le toit).
- **Forme exacte** : l'empreinte de 45 sommets (`spec/robot.json`, `chassis.empreinte_sol`) et les roues (`vid/spec.json`, clés `foot` et `wheels`). À l'écran, utiliser une silhouette générique.
- Les poses `x, y, h`, les pierres posées et le score peuvent être montrés : ils décrivent le jeu, pas la mécanique.

## 7. Points ouverts

- [À CONFIRMER] (arbitre ou FAQ) : une pile qui ne mord que de 12 mm dans la zone, tournée de 45°, est-elle un mur valide ?
- [À CONFIRMER] (équipe) :
  - la porte sans ouverture (piliers jointifs) est-elle bien la porte voulue ?
  - seuil de chevauchement et alignement exigés en mode `proche` ;
  - ce qui peut être montré de la prise et de la rotation des piles.
- [À FOURNIR] : un modèle entraîné sur le moteur actuel, pour montrer honnêtement un match joué par le réseau.
- [À CONFIRMER] : la cause de l'échec de la porte M8 et du trajet de tir du bleu dans le duel PROGRAMME_REFERENCE. Messages du moteur : « aucune position sans contact (P7.3) » et « aucun passage sans contact trouvé ». Non analysée ici.
