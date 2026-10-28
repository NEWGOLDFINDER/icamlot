# Vidéo ICAM LOT : « la plus grande techno prévue sur notre robot »

Vidéo de 30 s en 16:9 pour présenter le cerveau du robot à de futurs sponsors. Elle est rendue image par image dans un navigateur sans écran (three.js + Playwright), puis encodée avec ffmpeg. La bande-son est synthétisée en Python (aucun son externe).

## Plans

| Temps | Plan |
|---|---|
| 0–3 s | Accroche : « On vous dévoile la plus grande techno prévue sur notre robot » |
| 3–7,5 s | Le monde virtuel : table Eurobot 2027, 30 pierres, 10 carrières (vol de drone) |
| 7,5–10,5 s | Adversaire simulé (robot 4 roues, **modèle fictif**), puis notre robot en **silhouette floutée** (design confidentiel) et plongée « dans sa tête » |
| 10,5–24 s | Dans sa tête : carte de la table selon le robot, chrono restant, position de l'adversaire, charge des pinces, réseau de neurones animé avec ses activations réelles, décisions |
| 24–27,3 s | « On l'entraîne virtuellement » : matchs simulés en parallèle |
| 27,3–30 s | Appel : « Devenez sponsor » |

## D'où viennent les données affichées

- **Table et pierres** : `spec/regles_2027.json` (règlement officiel 1.0 et `table.svg`).
- **Notre robot** : `spec/robot.json` et la CAO de principe (`tools/cao_robot.py`). Il n'est **jamais montré net** : il est rendu en silhouette unie, réduite à 64 × 36 px, puis floutée.
- **Plan « dans sa tête »** : un vrai match joué dans le moteur JS de référence par le modèle `.data/modeles/fumee.json`, avec la boucle de `trainer/evaluation.py` (`skipContacts`, choix glouton, graine 10000, adversaire = stratégie d'exemple en intensité réaliste).
  - Chaque décision est enregistrée : entrées normalisées, sorties de l'encodeur, état GRU, logits et masque.
  - Les liaisons dessinées sont les contributions les plus fortes (activation × poids réel).
  - Seules les 10 premières secondes sont montrées (4 décisions). Le modèle `fumee` est un entraînement d'essai, d'où la mention « cerveau en cours d'entraînement ».
- **Points affichés** (« +13 pts ») : récompenses renvoyées par le moteur. Les points de la grille d'entraînement reprennent le barème du règlement.

## Régénérer

Prérequis : Node ≥ 18, Python 3 avec numpy, ffmpeg, Chromium pour Playwright, et une copie de la branche `audit/simulateur-ia` (par exemple `git worktree add ../../icamlot-audit origin/audit/simulateur-ia`).

```bash
npm install
python3 gen_spec.py ../../icamlot-audit
pip install cadquery-ocp && python3 export_meshes.py ../../icamlot-audit/tools
node record.js ../../icamlot-audit && node prep.js
python3 audio.py
python3 -m http.server 8765 &
node render.js 0 300 part0.mp4 1 && node render.js 300 600 part1.mp4 1 && node render.js 600 900 part2.mp4 1
```

Le dernier argument de `render.js` fixe la résolution : 1 pour du 1080p, 2 pour du 4K. Pour assembler les trois parties avec le son :

```bash
printf "file part0.mp4\nfile part1.mp4\nfile part2.mp4\n" > parts.txt
ffmpeg -f concat -i parts.txt -i bande_son.wav -c:v copy -c:a aac -b:a 192k -shortest icamlot_cerveau_1080p.mp4
```

Pour contrôler un plan sans tout rendre : `node still.js 0.5 12.0 18.4` écrit des aperçus dans `prev/`.
