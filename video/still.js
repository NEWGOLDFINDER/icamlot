// node still.js dpr t1 t2 ... -> prev/t_<t>.jpg
const { chromium } = require('playwright');
(async () => {
  const [dpr, ...ts] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: +dpr });
  p.on('console', m => console.log('console:', m.text())); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(`http://localhost:8765/index.html?dpr=${dpr}`);
  await p.waitForFunction('window.READY === true', null, { timeout: 120000 });
  require('fs').mkdirSync('prev', { recursive: true });
  for (const t of ts) {
    const t0 = Date.now();
    await p.evaluate(t => window.renderFrame(+t), t);
    await p.screenshot({ path: `prev/t_${t}.jpg`, type: 'jpeg', quality: 85 });
    console.log(t, Date.now() - t0, 'ms');
  }
  await b.close();
})();
