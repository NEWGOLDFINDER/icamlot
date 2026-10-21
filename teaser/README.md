# Teaser sponsors

Vidéo LinkedIn de 30 s (1920×1080, 30 i/s, H.264 + AAC) tournée dans le simulateur du plateau (`plateau/`).
On y voit la stratégie `strategie.json` (« autre 3 murs 3 tours ») jouée image par image, avec un montage façon sport auto :
plans multiples, ralentis, chrono du match et points de chaque action. Le robot est toujours flouté.

## Générer la vidéo

```sh
cd teaser
npm install
node render.mjs                     # → out/teaser.mp4 (~15 min)
node render.mjs --stills 8,18.6     # images de contrôle à 8 s et 18,6 s de la vidéo → out/still-*.png
```

Il faut Chromium (Playwright) et ffmpeg. three.js est servi depuis `node_modules`, sans passer par le CDN.

## Ce que fait chaque fichier

- `render.mjs` ouvre `plateau/index.html` dans Chromium sans écran et y charge la stratégie. Il remplace la boucle
  d'animation de `plateau/app.js` par un accès direct à la scène (`window.__SIM`) et envoie chaque image à ffmpeg.
- `montage.js` contient les plans (temps vidéo → temps simulé, caméra) et le floutage. Le masque du robot est rendu
  avec la profondeur de la scène, élargi puis remplacé par une mosaïque. Il contient aussi les textes, le chrono,
  les sous-titres et le carton de fin.
- `audio.mjs` synthétise les bruitages à partir des repères du montage : whoosh aux raccords, impacts, moteur qui
  suit la vitesse du robot et grave pendant les ralentis, feux de départ. Aucun son externe n'est utilisé.
- `logo-roboticam.png` est le logo extrait du dossier de partenariat 2026-2027.

## Chiffres affichés

Ils viennent de la simulation, pas d'une saisie à la main. Les temps du chrono sont ceux des étapes du simulateur.
Les points viennent du barème `bareme.js` appliqué au résultat (mur +8, tour +6, porte +23, Graal niveau 3 +20,
retour au trône +10, total 95 pts en 58,5 s, sans robot adverse). Si la stratégie change, `montage.js` s'arrête
avec un message au lieu d'afficher des points faux : les plans sont calés sur les étapes de cette stratégie.
