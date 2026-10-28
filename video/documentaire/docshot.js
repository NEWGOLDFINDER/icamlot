// node docshot.js dpr t1 t2 ...  -> prev/d_<t>.jpg ; affiche la durée
const { chromium } = require('playwright');
(async () => {
  const [dpr, ...ts] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] }); const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: +dpr });
  p.on('pageerror', e => console.log('ERR', e.message)); p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await p.goto(`http://localhost:8765/doc.html?dpr=${dpr}`); await p.waitForFunction('window.READY === true', null, { timeout: 180000 });
  console.log('durée', await p.evaluate(() => window.DUREE));
  for (const t of ts) { const t0 = Date.now(); await p.evaluate(t => window.renderFrame(+t), t); await p.screenshot({ path: `prev/d_${t}.jpg`, type: 'jpeg', quality: 82 }); console.log(t, Date.now() - t0, 'ms'); }
  await b.close();
})();
