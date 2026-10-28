# Graal à anses et ascenseur de la face C — note de conception

Générée et vérifiée par `tools/conception_graal.py` (cotes dans `DESIGN`). Les fichiers produits sont :
- `graal.step` et `ascenseur_graal.step` : mêmes origine et axes que `Structure_robot_p.STEP`, à insérer en « coïncidence d'origine » dans SolidWorks ;
- `vues_graal.png` : vue de dessus et vue de profil.

Statut : **proposition**, à valider par l'équipe.

## 1. Pourquoi une anse en haut du Graal est impossible

- Le niveau 4 exige un Graal posé sur le toit (> 300 mm), libre de tout actionneur.
- Les actionneurs ne doivent jamais dépasser 350 mm (règlement général F.3).
- Tout organe qui soulève le Graal le touche à une hauteur `h` au-dessus de son fond. Pour faire passer le Graal au-dessus du toit, il faut donc :

  `toit + garde + h ≤ 350`

- Une anse au sommet (h ≥ 60 mm) est donc exclue. **Les anses doivent être en bas du Graal.**

## 2. Le toit actuel est trop haut

| Toit | Dessus des dents en position haute (anses à 22 mm, garde 4 mm) | Verdict |
|---|---|---|
| 341,2 mm (actuel) | 367,2 mm | **interdit** (+17 mm) |
| 321,2 mm | 347,2 mm | possible, marge de 2,8 mm |
| **311,2 mm (tubes de 290 mm)** | **337,2 mm** | **marge de 12,8 mm, recommandé** |

Avec ces anses, le toit doit être à 324 mm au plus. Même avec des dents très fines, il ne pourrait pas dépasser environ 333 mm.

**Proposition : remplacer les 6 tubes de 320 mm par des tubes de 290 mm**, ce qui met le toit à 311,2 mm. On garde 11 mm au-dessus de la limite de 300 mm du niveau 4.

## 3. Le Graal proposé

- **Base** de 70 × 70 mm. Le règlement exige plus grand qu'un cube de 60 mm.
- **Hauteur de 100 mm.** Une fois sur le toit, son sommet est à 411 mm, sous la balise adverse placée à 430 mm sur notre mât. Le règlement interdit de la masquer (jeu E.2.b).
- **Silhouette** : pied Ø 30 mm, puis coupe conique jusqu'à Ø 70 mm.
- **Deux anses basses**, à gauche et à droite :
  - dessous à 22 mm du fond, épaisseur 6 mm, débord 22 mm, longueur 50 mm ;
  - lèvre de retenue extérieure de 4 × 14 mm ;
  - la dent de la fourche glisse dans le canal formé entre la paroi et la lèvre.
- **Contraintes « PAMI » respectées** (jeu E.2.b) : périmètre d'environ 370 mm (≤ 600), hauteur ≤ 175 mm, masse très inférieure à 1,5 kg en PLA.

## 4. L'ascenseur proposé (face C, bord droit vu de face)

- **Rail vertical** de 15 × 10 mm, placé à 120,5 mm à droite du centre de la face, de z = 15 à 335 mm.
- **Chariot** portant une **coulisse horizontale** de 87 mm de course, perpendiculaire à la face.
- **Fourche** : 2 dents de 8 × 5 × 72 mm, espacées de 88 mm entre axes, reliées par une traverse.
- **Canon** : il garde la partie gauche de la face C, soit environ 120 mm de largeur libre.

### Séquence (fin de match, dans la salle du trône)
1. **Au départ**, la fourche est rangée en haut, coulisse rentrée au-dessus du toit. Elle n'ajoute rien au périmètre de départ.
2. **Sortie et descente** : la coulisse sort, puis le chariot descend. Les dents se retrouvent à 9–14 mm du sol, soit 8 mm sous les anses. Cela peut se faire en temps masqué pendant le trajet.
3. **Engagement** : le robot recule la face C vers le Graal et les dents glissent dans les canaux des anses. La tolérance latérale est de ± 5 mm ; un chanfrein d'entrée sur les lèvres est recommandé.
4. **Montée** (3,5 s, valeur annoncée de 3 à 4 s) jusqu'à un fond du Graal à 315,2 mm, dents à 337,2 mm.
5. **Transfert** : la coulisse rentre de 87 mm. Le Graal passe 4 mm au-dessus du bord du toit et se place à 70 mm du centre, contre le mât de balise (supposé au centre, au minimum réglementaire de Ø 70 mm).
6. **Pose** : le chariot descend de 8 mm et le Graal repose sur le toit.
7. **Dégagement** : la coulisse ressort, les dents quittent les canaux et le Graal est libre de tout actionneur.

À aucun moment le Graal ne quitte le château, puisque le robot est dans la salle du trône. Le Graal ne dépasse 350 mm que dans le château, ce qui est autorisé. Les actionneurs restent à 337,2 mm au plus.

## 5. Points à valider
- Raccourcir les tubes à 290 mm (ou toute autre hauteur de toit ≤ 324 mm).
- Mât de balise centré de Ø 70 mm. S'il est plus gros ou décalé vers la face C, relancer le script.
- Le Graal est placé dans la salle du trône pendant la préparation, hors de l'emprise de départ du robot.
