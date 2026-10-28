# Robot complet (concept) : nacelles, canon, ascenseur à Graal et Graal

Le tout est généré par `tools/cao_robot.py`, à partir de `Structure_robot_p.STEP`.

Les fichiers STEP sont dans le repère de la CAO de l'équipe : on les insère dans SolidWorks en faisant coïncider les origines.

| Fichier | Contenu |
|---|---|
| `chassis_tubes_290.step` | châssis avec les 6 tubes ramenés à 290 mm (toit à 311,2 mm) |
| `nacelle_A.step`, `nacelle_B.step` | guidage vertical, chariot, moteur de rotation, nacelle à 6 ventouses |
| `canon.step` | lanceur à 2 volants, canon Ø 50 incliné à 35° (rentré), chargeur et 10 boulets |
| `ascenseur_graal.step` | rail vertical, chariot, coulisse, fourche à 2 dents (position basse) |
| `graal.step` | Graal à 2 anses basses, posé au sol devant la face C |
| `robot_depart.step`, `robot_fin.step` | assemblages complets (départ / Graal sur le toit) |
| `rendu_prise.png`, `rendu_fin.png` | vues |

Statut : **volumes de principe** (pas de visserie, pas de choix de composants du commerce), à reprendre en CAO détaillée.

## Contrôles automatiques sur l'assemblage (sortie de `cao_robot.py`)
- **Périmètre au départ : 1190,0 mm**, pour une limite de 1200. Configuration : nacelles à 0° avec 35 mm de saillie, canon rentré, fourche rangée au-dessus du toit.
- **Hauteur maximale : 347,2 mm** pour une limite de 350, mât de balise exclu. Le Graal atteint 411,2 mm une fois sur le toit, ce qui est autorisé dans le château et reste sous la balise adverse à 430 mm.
- **Collisions : aucune**, entre modules, avec le châssis et avec le mât de balise (Ø 70, centré).
- **Nacelles vérifiées sur leur course** : axe à 140, 205 et 270 mm, rotations de 0, 90 et 180°.
- **Graal** : dents engagées dans les anses sans interférence ; une fois sur le toit, il ne touche ni le mât ni la fourche.

## Graal (modifié par rapport à la première proposition)
- **Base de 62 × 62 mm** (règlement : plus grand qu'un cube de 60 mm), au lieu de 70 mm. Hauteur 100 mm.
- **Anses** : dessous à 22 mm du fond, débord de 20 mm (au lieu de 22), lèvre de retenue de 4 × 14 mm, longueur 50 mm.
- **Raison** : en position rentrée, la traverse de la fourche passe entre le Graal et le mât de balise centré. Avec 70 mm de base, elle touchait le mât, ou bien le Graal débordait du toit.

## Ascenseur (face C, bord droit vu de face)
- **Rail vertical** : y = 113 à 128 mm de l'axe de la face, z = 15 à 335 mm.
- **Chariot**, plus un **bras coulissant horizontal** de 110 mm, course **79 mm**.
- **Traverse et 2 dents** de 8 × 5 × 72 mm.
- **Hauteurs** : en transfert, dents à 337,2 mm et haut de la traverse à 347,2 mm ; Graal posé, traverse à 343,2 mm.

### Séquence
1. Au départ, la fourche est rangée en haut, au-dessus du toit.
2. Sortie de la fourche, puis descente : dents à 9 mm du sol.
3. Le robot recule la face C, et les dents glissent sous les anses.
4. Montée en 3,5 s (durée annoncée de 3 à 4 s).
5. Rentrée de 79 mm : le Graal se place à 76 mm du centre, contre le mât.
6. Pose (descente de 4 mm), puis sortie de la fourche : le Graal est libre de tout actionneur.

## Canon (face C, partie gauche)
- **Lanceur à 2 volants** au centre du robot. Il est placé là parce que les tubes du châssis, en y = ±101 mm derrière chaque face, et les moteurs des roues occupent les coins.
- **Canon Ø 50 incliné à 35°**, entièrement rentré au départ. Il sort de 90 mm : bouche à environ 57 mm de la face et 189 mm de hauteur.
- **Chargeur** : 4 colonnes de 3 places, au-dessus du lanceur, pour 10 boulets Ø 45.

## Nacelles (faces A et B) : voir `pince.md`
- **Guidage vertical** : 2 rails à l'intérieur, derrière la face.
- **Chariot** de 120 mm de large, **moteur de rotation plat** (Ø 42 mm).
- **Nacelle tournante** : 3 barres arrondies, une colonne centrale, 6 ventouses (4 × Ø 40 et 2 ovales 40 × 20). L'avant des ventouses est à 35 mm de la face.
