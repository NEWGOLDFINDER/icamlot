// Cherche une configuration de Chromium sans écran qui utilise vraiment le GPU pour WebGL, mesure la vitesse de rendu
// de la scène, puis écrit gpu_config.json (lu par render.js). Usage : node gpucheck.js   (serveur http sur le port 8765)
const { chromium } = require('playwright');
const fs = require('fs');
const CONFIGS = [
  { nom: 'vulkan', headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] },
  { nom: 'egl (ANGLE)', headless: true, args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] },
  { nom: 'egl', headless: true, args: ['--use-gl=egl', '--ignore-gpu-blocklist', '--enable-gpu'] },
  { nom: 'nouveau headless', headless: true, channel: 'chromium', args: ['--ignore-gpu-blocklist', '--enable-gpu'] },
  { nom: 'logiciel (SwiftShader)', headless: true, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
];
(async () => {
  const res = [];
  for (const c of CONFIGS) {
    const opt = { headless: c.headless, args: c.args }; if (c.channel) opt.channel = c.channel;
    let b;
    try {
      b = await chromium.launch(opt);
      const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
      const gl = await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); if (!g) return 'aucun WebGL2'; const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'inconnu'; });
      let sParImage = null;
      if (!/SwiftShader|aucun/i.test(gl) || c.nom.startsWith('logiciel')) {
        await p.goto(`http://localhost:${process.env.PORT || 8765}/index.html?dpr=1`); await p.waitForFunction('window.READY === true', null, { timeout: 300000 });
        const t0 = Date.now(); for (const t of [20, 47, 66, 80, 95]) { await p.evaluate(t => window.renderFrame(t), t); await p.screenshot({ type: 'png' }); }
        sParImage = (Date.now() - t0) / 5000;
      }
      res.push({ ...c, gl, sParImage }); console.log(`${c.nom.padEnd(24)} ${gl}  ${sParImage ? sParImage.toFixed(2) + ' s/image' : ''}`);
    } catch (e) { console.log(`${c.nom.padEnd(24)} échec : ${e.message.split('\n')[0]}`); }
    if (b) await b.close();
  }
  const ok = res.filter(r => r.sParImage).sort((a, b) => a.sParImage - b.sParImage)[0];
  if (!ok) { console.log('Aucune configuration utilisable.'); process.exit(1); }
  const out = { headless: ok.headless, args: ok.args }; if (ok.channel) out.channel = ok.channel;
  fs.writeFileSync('gpu_config.json', JSON.stringify(out, null, 1));
  console.log(`\nRetenu : ${ok.nom} (${ok.gl}), ${ok.sParImage.toFixed(2)} s/image.` + (/SwiftShader/i.test(ok.gl) ? '\nATTENTION : le GPU n\'est pas utilisé par Chromium (rendu logiciel).' : ''));
})();
