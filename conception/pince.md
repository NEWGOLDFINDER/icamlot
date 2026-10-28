# Nacelle de préhension (faces A et B) : dimensionnement, rotations, hauteurs

Calculs : `tools/conception_pince.py` (angles −90, 0, 90 et 180°) (sortie complète dans `pince_calculs.txt`). Schéma : `pince_rotation.png`.

Statut :
- règle de la porte validée par l'équipe : le linteau est la pierre du haut d'une pile de 3 ;
- dimensions des ventouses déléguées à l'audit : ce sont des **propositions**, à valider par des essais.

## Dimensionnement retenu (par face, 6 ventouses)

| Rangée | Rôle | Ventouses | Position verticale | Position horizontale |
|---|---|---|---|---|
| 1 | pierre du bas | 2 × Ø 40 à soufflet | centre de la pierre (axe − 110 mm) | ±100 mm |
| 2 | pierre du milieu | 2 × Ø 40 à soufflet | centre de la pierre (axe) | ±100 mm |
| 3 | pierre du haut (linteau) | 2 × **ovales 40 × 20 mm**, grand axe horizontal | centre à **12 mm du bord bas** de la pierre (axe + 67 mm) | ±66 mm |

### Pourquoi ces positions
- **Tag ArUco** : il est au centre de chaque grande face. Sa taille n'est pas cotée dans le règlement ; je l'estime à environ 90 mm d'après les photos, **à mesurer sur une vraie pierre**.
  - Les Ø 40 laissent 35 mm de jeu avec le tag et restent à 40 mm des bouts de la pierre.
  - Les ovales ne laissent que 1 mm de jeu avec un tag de 90 mm. S'il est plus grand, rapprocher les ovales ou les passer en Ø 20 ronds à ±65 mm.
- **Ventouses de la rangée 3, 20 mm de haut** : quand on pose le linteau (dessous à 325 mm), le haut des ventouses arrive à 347 mm, sous la limite de 350 mm. La nacelle ne doit pas dépasser de plus de 13 mm au-dessus de leur centre.
- **Ovales plutôt que rondes Ø 20** : 2,3 fois plus de surface pour la même hauteur. C'est la rangée la plus sollicitée, car elle porte une pierre dont le centre de gravité est à 55 mm devant elle (effet de pelage).
- **Enveloppe de la rangée 3 limitée à ±86 mm** : au-delà, la pile de 3 ne peut plus tourner de 90° sous 350 mm (marge 4,1 mm à ±86, négative à ±91).

## Tenue (coefficient de sécurité, objectif ≥ 3)

Hypothèses à vérifier par essai : frottement ventouse/carton 0,5 ; accélération du robot 2 m/s² (0,5 m/s atteints en 0,25 s) ; dépression réellement obtenue sur le carton.

| Pierre | Dépression | Rangée 3 (linteau) | Rangée 1 (porte toute la pile, pire cas) | Pierre debout (90°) |
|---|---|---|---|---|
| 90 g (règlement) | 20 kPa | 4,9 | 9,3 | 27,9 |
| 90 g | 30 kPa | 7,4 | 13,9 | 41,8 |
| 180 g (masse doublée) | 30 kPa | 3,7 | 7,0 | 20,9 |

**Exigence pour le circuit de vide : au moins 20 kPa sous chaque ventouse, sur carton, avec la fuite propre au carton.** Prévoir des ventouses à soufflet et un débit suffisant. Le règlement prévient que la masse des pierres peut changer d'un organisateur à l'autre.

## Rotations sous 350 mm (le chariot monte ou descend pendant la rotation)

| Geste | Résultat | Marge |
|---|---|---|
| Nacelle vide 0 → 180° | faisable | 65,4 mm |
| Pile de 3 pierres 0 → 90° (piliers de porte), dans le château | faisable | 4,1 mm |
| Pile de 3 pierres 0 → 90°, hors du château (pierres ≤ 350 mm) | **impossible** (à faire dans le château) | −114,7 mm |
| 1 pierre tenue par la rangée 1, 0 → 90° (tour) | faisable | 4,1 mm |
| 1 pierre tenue par la rangée 3, 0 → 90° (tour), hors du château | **impossible** (à faire dans le château) | −53,4 mm |
| Retournement à 180° d'une pierre tenue par la rangée 3 | **impossible** | −53,4 mm |
| Linteau posé (dessous à 325 mm) | haut des ventouses à 347 mm | 3 mm |

### Rotation à −90° (décision de l'équipe du 2026-10-28, `spec/robot.json` `rotation_moins_90`)

Angles de la nacelle : −90, 0, 90 et 180° ; plage des rotations coordonnées [−90, 180] (jamais par −180°). À −90°, la pierre tenue part de l'autre côté de la face (décalage latéral opposé à celui de +90°) : c'est le miroir exact de +90°, utilisé par l'équipe bleue.

| Geste | Résultat | Marge |
|---|---|---|
| Nacelle vide 0 → −90°, 90 → −90° (par 0), −90 → 180° (270°, par 0 et 90) | faisable | 65,4 mm |
| 1 pierre tenue par la rangée 1, 0 → −90° (tour), hors du château | faisable | 4,1 mm |
| 1 pierre tenue par la rangée 2, 0 → −90°, hors du château | faisable | 6,6 mm |
| 1 pierre tenue par la rangée 3, 0 → −90°, hors du château | **impossible** (à faire dans le château) | −53,4 mm |
| 1 pierre tenue par la rangée 3, 0 → −90°, dans le château | faisable | 65,0 mm |
| Pile de 3 pierres 0 → −90°, hors du château | **impossible** (à faire dans le château) | −114,7 mm |
| Pile de 3 pierres 0 → −90° (piliers de porte), dans le château | faisable | 4,1 mm |
| 1 pierre tenue par la rangée 1, 90 → −90° (par 0), hors du château | faisable | 4,1 mm |

Les marges à −a sont exactement celles à +a (écart calculé : 0 mm sur 5 charges, dans et hors du château) : la nacelle et les pierres sont symétriques de part et d'autre de l'axe vertical de la face. Le moteur réutilise donc les mêmes tables de faisabilité pour ±a (`GEOM.corridor`). Seuls changent la position latérale de la pierre et le balayage horizontal (contacts), vérifiés par le moteur.

Conséquence validée : chaque porte utilise une pile complète (2 piliers + le linteau du haut). Les marges en rotation sont faibles (2 à 4 mm). Il faut donc programmer les rotations avec le mouvement vertical coordonné calculé par le script, et les vérifier sur le robot.

## Saillie des nacelles (canon rentré, fourche du Graal rangée au-dessus du toit)

| Saillie | Périmètre au départ (≤ 1200) | Pire cas en match, 2 nacelles en rotation (≤ 1400) |
|---|---|---|
| 30 mm | 1178,6 | 1214,8 |
| **35 mm (recommandé)** | **1184,4** | 1232,5 |
| 40 mm | 1191,9 | 1250,6 |

> **Correction du 2026-10-28.** Le calcul de faisabilité oubliait la limite de 350 mm des pierres hors château dans un cas. Le chantier moteur l'a relevé. Les rotations de pile ou de pierre en rangée 3 doivent donc se faire dans le château, ce que le moteur impose.
