# « Construire le cerveau d'ICAMLOT » — mini-documentaire (1 min 56, 1080p, sans voix off)

Équipe ICAMLOT, association ROBOTICAM VENDÉE : MAEL DELAHAYE, PIERRE-MARIE CHIRON, WILLIAM TRICOIRE, CORENTIN BATY.

La vidéo est rendue image par image dans un navigateur sans écran (three.js, Playwright), puis encodée avec ffmpeg. La musique est synthétisée par `audio_doc.py`, sans aucun son externe. Le fichier MP4 n'est pas versionné.

## Déroulé

| Temps | Plan |
|---|---|
| 0:00 | Titre |
| 0:04 | Le jeu : table, pierres, barème sur les constructions réelles |
| 0:18 | Notre robot : silhouette réelle, sans mécanisme |
| 0:23 | Match complet accéléré : 116 points |
| 0:32 | Duel : P10 déjà pris par l'adversaire, 108 points |
| 0:39 | L'objectif : un cerveau qui choisit lui-même |
| 0:44 | 1 · Recréer le monde : quadrillage A*, règle d'attente, matchs en parallèle |
| 1:02 | 2 · Ce qu'il perçoit : les 56 entrées réelles, la croyance sur les carrières |
| 1:16 | 3 · Le réseau : 56 → 128 → mémoire 128 → 130 notes, filtre |
| 1:31 | 4 · Apprendre (méthode prévue) : imitation, renforcement, examen, fichier d'environ 500 ko |
| 1:43 | Calendrier |
| 1:49 | Équipe et demande d'apport financier |

## Ce qui est réel, ce qui est illustré

**Réel (moteur de référence, branche `audit/simulateur-ia`, commit 0161a45)**
- Matchs de `ENGINE.PROGRAMME_REFERENCE`, un programme écrit à la main et non le réseau : 116 points seul, 108 contre 65 en duel miroir. Les données viennent de `gen_match_reference.js` puis `compact_match.py`.
- Les 56 entrées et le masque à chaque décision : `obsref.js` (`ENV.imitate`).

**Mesuré (dossiers de `sources_factuelles/`)**
- 140 035 paramètres.
- Fichier ONNX de 497 261 octets.
- 83 tests sur 83 réussis.
- 5 à 6 s de calcul par match.

**Illustration (signalée à l'écran)**
- Cases d'obstacles du quadrillage.
- Activations internes du réseau.
- Hauteurs des notes de sortie.
- Barres d'apprentissage.

**Calendrier** : celui de `AUDIT_SIMULATEUR_IA.md` §6.6, présenté comme prévu.

**Notre robot** : plaque haute mesurée (`spec/robot.json`) extrudée jusqu'au toit, roues et mât. Aucune pince, ventouse, canon ni ascenseur. La montée du Graal (ascenseur) n'est pas montrée.

## Régénérer

Prérequis : Node ≥ 18, Python 3 avec numpy, ffmpeg, Chromium pour Playwright, et la branche `audit/simulateur-ia` copiée par exemple dans `../../../icamlot-audit` (`git worktree add`).

```bash
npm install three@0.169.0
node gen_match_reference.js --root ../../../icamlot-audit --programme PROGRAMME_REFERENCE --out .
python3 compact_match.py .
node obsref.js ../../../icamlot-audit
python3 audio_doc.py
python3 -m http.server 8765 &
PAGE=index.html node render.js 0 1156 part0.mp4 1
PAGE=index.html node render.js 1156 2312 part1.mp4 1
PAGE=index.html node render.js 2312 3468 part2.mp4 1
printf "file part0.mp4\nfile part1.mp4\nfile part2.mp4\n" > parts.txt
ffmpeg -f concat -i parts.txt -i musique_doc.wav -c:v copy -c:a aac -b:a 192k -shortest ICAMLOT_documentaire_cerveau_1080p.mp4
```

- Le dernier argument de `render.js` fixe la résolution : `1` pour du 1080p, `2` pour du 4K.
- `scene.js` est la concaténation, dans l'ordre, de `partA.js`, `partHud.js`, `partHull.js`, `partMatch.js`, `partNet2.js`, `partComp.js` et `partDoc.js`.
- Pour contrôler une image sans tout rendre : `node docshot.js 0.5 12.0 48.5`, qui écrit dans `prev/`. Il faut adapter la page chargée dans le script.

## Version avec voix off (ElevenLabs)

La voix est générée par l'équipe dans ElevenLabs à partir de `voix_off_elevenlabs.txt`. Le fichier audio n'est pas versionné.

1. **Découpage** : `voix/aligner.py` fait un alignement forcé texte → silences et trouve les 18 phrases. Contrôle : dans chaque phrase, le nombre de pauses internes doit correspondre à sa ponctuation.
2. **Placement** : `voix/plan_voix.py` fixe les nouvelles durées de plans pour qu'aucune phrase ne déborde. Il place chaque phrase 0,3 s après le début de son plan, découpe les sous-titres aux pauses et écrit `voix_plan.json` ainsi que `voix_placee.wav`.
3. **Image** : `partDoc.js` lit `voix_plan.json`. Chaque plan est étiré ou resserré pour suivre la voix, sans figer l'animation. Les sous-titres affichent le texte exact prononcé. Les apparitions à l'écran sont calées sur les mots (murs, tours, porte ; 116 points ; chaque entrée nommée ; filtre ; choix ; apport financier).
4. **Son** : `audio_voix.py` produit la musique aux nouvelles durées. Le mixage baisse la musique sous la voix et normalise à −15 LUFS :

```bash
ffmpeg -i voix_placee.wav -i musique_voix.wav -filter_complex "[0:a]aformat=channel_layouts=mono,highpass=f=70,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,volume=1.6,asplit=2[v1][vkey];[1:a]volume=0.55[m];[m][vkey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=350[md];[v1]pan=stereo|c0=c0|c1=c0[vs];[md][vs]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-15:TP=-1.5:LRA=11[out]" -map "[out]" -ar 48000 mix_voix.wav
```

Résultat : 117,3 s. Pendant les phrases, la voix est 9,4 dB au-dessus de la musique.
