/* Teaser sponsors : joue la stratégie dans le vrai simulateur (plateau/), image par image, dans Chromium sans écran,
   puis encode la vidéo et le son avec ffmpeg.
   node render.mjs                      → out/teaser.mp4
   node render.mjs --stills 3,7.5,16    → out/still-<t>.png (images de contrôle, temps vidéo en secondes)
   node render.mjs --strategy autre.json
   node render.mjs --gpu                → même vidéo, rendue avec la carte graphique (sur un PC équipé) */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { soundtrack } from './audio.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..'), OUT = path.join(HERE, 'out');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const strategy = JSON.parse(fs.readFileSync(path.resolve(HERE, arg('strategy', 'strategie.json')), 'utf8'));
const stills = arg('stills', '') ? arg('stills').split(',').map(Number) : null;
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css' };
function serve(route, file, patch) {
  let body = fs.readFileSync(file);
  if (patch) body = patch(body.toString());
  return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body });
}
/* app.js sans sa boucle d'animation : le montage choisit lui-même l'instant simulé et la caméra de chaque image */
function patchApp(src) {
  const tail = '  requestAnimationFrame(frame);\n})();';
  const i = src.lastIndexOf(tail);
  if (i < 0) throw new Error('fin de plateau/app.js introuvable : le crochet du teaser est à mettre à jour');
  return src.slice(0, i) + `  window.__SIM = {
    THREE: THREE, scene: scene, camera: camera, gl: gl, robot: robot, balls: balls, graal: graalM,
    update: update, importObj: importObj, outcome: outcome, scoreOf: scoreOf, MATCH: MATCH,
    getR: function () { return R; },
    hideAids: function () { labels.visible = false; trajG.visible = false; if (trail) trail.visible = false; if (shotLines) shotLines.visible = false; }
  };
})();`;
}

/* --gpu : rendu sur la carte graphique de la machine (sinon WebGL logiciel, plus lent mais partout disponible) */
const gpu = process.argv.includes('--gpu');
const browser = await chromium.launch({ args: gpu ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('[page]', e.message));
await page.route('**/*', route => {
  const u = new URL(route.request().url());
  if (u.hostname === 'teaser.local') {
    const f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    return serve(route, f, u.pathname === '/plateau/app.js' ? patchApp : null);
  }
  if (u.hostname === 'cdn.jsdelivr.net' && u.pathname.startsWith('/npm/three@0.128.0/'))
    return serve(route, path.join(HERE, 'node_modules/three', u.pathname.slice('/npm/three@0.128.0/'.length)));
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') return route.continue();
  return route.abort();
});
await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
await page.goto('http://teaser.local/plateau/index.html');
await page.waitForFunction(() => window.__SIM && window.__SIM.getR());
/* charge la stratégie comme « Importer » et attend la fin de sa simulation */
await page.evaluate(s => new Promise(ok => {
  const old = __SIM.getR(); __SIM.importObj(s);
  (function wait() { if (__SIM.getR() !== old) ok(); else setTimeout(wait, 50); })();
}), strategy);
await page.addStyleTag({ url: 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,800;1,700;1,800&display=block' });
await page.addScriptTag({ path: path.join(HERE, 'montage.js') });
const info = await page.evaluate(() => TEASER.init());
console.log('Stratégie :', strategy.name, '·', info.summary);

if (arg('debug', '')) {
  const imgs = await page.evaluate(i => TEASER.debug(i), Math.round(+arg('debug') * info.fps));
  imgs.forEach((b, k) => fs.writeFileSync(path.join(OUT, 'debug-' + ['base', 'mask', 'soft'][k] + '.png'), Buffer.from(b, 'base64')));
} else if (stills) {
  for (const t of stills) {
    const b64 = await page.evaluate(i => TEASER.frame(i, 'png'), Math.round(t * info.fps));
    fs.writeFileSync(path.join(OUT, `still-${t}.png`), Buffer.from(b64, 'base64'));
  }
  console.log(stills.length + ' images dans ' + OUT);
} else {
  const video = path.join(OUT, 'video-muette.mp4'), wav = path.join(OUT, 'son.wav'), final = path.join(OUT, arg('out', 'teaser.mp4'));
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(info.fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let i = 0; i < info.frames; i++) {
    const b64 = await page.evaluate(k => TEASER.frame(k, 'jpeg'), i);
    if (!ff.stdin.write(Buffer.from(b64, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 30 === 29) console.log(`image ${i + 1}/${info.frames} · ${((Date.now() - t0) / 1000 / (i + 1)).toFixed(2)} s/image`);
  }
  ff.stdin.end();
  await new Promise((ok, ko) => ff.on('close', c => c ? ko(new Error('ffmpeg ' + c)) : ok()));
  const cues = await page.evaluate(() => TEASER.cues());
  fs.writeFileSync(path.join(OUT, 'cues.json'), JSON.stringify(cues, null, 1));
  soundtrack(cues, wav);
  await new Promise((ok, ko) => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', final], { stdio: 'inherit' })
    .on('close', c => c ? ko(new Error('ffmpeg ' + c)) : ok()));
  console.log('Vidéo : ' + final);
}
await browser.close();
