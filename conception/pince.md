# Nacelle de préhension (faces A et B) : rotations et hauteurs

Calculs : `tools/conception_pince.py` (sortie complète dans `pince_calculs.txt`). Schéma : `pince_rotation.png`.

## Modèle
- **Pierre** de 320 × 110 mm.
- **Axe de rotation** au niveau de la rangée de ventouses 2 (comme `hc` dans le moteur).
- **Rangées de ventouses** :
  - rangée 1 à −110 mm de l'axe, rangée 2 à 0 mm : 2 ventouses chacune, enveloppe ±130 mm (valeur héritée du simulateur) ;
  - rangée 3 à +67 mm : 2 ventouses Ø 20 mm, centrées à 12 mm du bord bas de la pierre 3.
- **Règles appliquées** :
  - actionneurs ≤ 350 mm à tout instant ;
  - pierres ≤ 350 mm, sauf dans le château et les zones de construction ;
  - garde de 5 mm au-dessus du sol.
- **Mouvement** : le chariot monte ou descend pendant la rotation (mouvement coordonné).

## Résultats

| Geste | Résultat | Marge |
|---|---|---|
| Nacelle **vide** 0 → 180° | faisable | 46,7 mm |
| **Retournement 180° avec une pierre** (prise en bas par la ventouse 3, puis remise à 0° comme linteau), hors château ou dans le château, dans les deux sens | **impossible** | **−61,9 mm** |
| 1 pierre tenue par la ventouse 2, 0 → 180° | faisable, mais inutile : la pierre reste tenue en son centre | 7,8 mm |
| Pile de 3 pierres 0 → 90° (piliers de porte), ventouses 3 à ±90 mm | **impossible** | −6,1 mm |
| Pile de 3 pierres 0 → 90°, ventouses 3 à **±70 mm** | faisable | 7,8 mm |
| Linteau posé (dessous à 325 mm) | haut des ventouses à **347 mm** | 3 mm |

**Pourquoi le retournement avec une pierre est impossible.** La pierre est tenue 110 mm au-dessus de l'axe et la rangée 1 est 110 mm en dessous. L'ensemble mesure environ 300 × 320 mm. Vers 135°, il lui faudrait 407 mm de hauteur libre entre le sol et 350 mm, qui n'en offrent que 345. Rapprocher les ventouses ne suffit pas : même avec des ventouses ponctuelles, il manque encore plus de 30 mm.

## Conséquences et recommandations
1. **Rangée 3 : ventouses à ±70 mm du centre au plus.** Sinon, la pile ne peut pas tourner de 90° pour faire une porte ou une tour.
2. **Haut de la nacelle : au plus 13 mm au-dessus du centre des ventouses 3.** Sinon, le linteau ne peut pas être posé sous 350 mm.
3. **Le linteau ne peut être que la pierre du haut d'une pile de 3** (rangée 3). Chaque porte consomme donc une pile complète : 2 piliers + 1 linteau, comme dans la stratégie de référence.
   - Pour transformer une pierre isolée en linteau, il faut d'abord la reposer sur une pile de 2, puis reprendre la pile de 3.
   - Toute autre solution demande de revoir la mécanique, par exemple une rangée 3 sur une coulisse indépendante.
4. **La rotation de 180° reste utile à vide**, pour prendre une pierre avec la rangée 3 placée en bas, et pour poser « à plat retourné ».
5. **Saillie des nacelles** (canon rentré, fourche du Graal rangée au-dessus du toit) :

| Saillie | Périmètre au départ (≤ 1200) | Pire cas en match, 2 nacelles en rotation (≤ 1400) |
|---|---|---|
| 30 mm | 1180,1 | 1233,9 |
| **35 mm (recommandé)** | **1187,2** | 1252,1 |
| 40 mm | 1196,3 (3,7 mm de marge) | 1270,3 |
