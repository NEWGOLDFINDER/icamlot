// node render.js <debut> <fin_exclue> <sortie.mp4> [dpr] : rendu (1920x1080 CSS × dpr ; 1 = 1080p, 2 = 4K) envoyé à ffmpeg
const { chromium } = require('playwright');
const { spawn } = require('child_process');
(async () => {
  const [a, b, out, dprArg] = process.argv.slice(2); const FPS = 30, DPR = +(dprArg || 1);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const br = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await br.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: DPR });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(`http://localhost:8765/index.html?dpr=${DPR}`);
  await p.waitForFunction('window.READY === true', null, { timeout: 300000 });
  const t0 = Date.now();
  for (let f = +a; f < +b; f++) {
    await p.evaluate(t => window.renderFrame(t), (f + 0.5) / FPS);
    const buf = await p.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 10 === 0) console.log(`${out} image ${f} — ${((Date.now() - t0) / 1000 / (f - a + 1)).toFixed(1)} s/image`);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await br.close(); console.log('FIN', out);
})();
