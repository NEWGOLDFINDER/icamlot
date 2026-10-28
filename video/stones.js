// Rejoue le même match que record.js et échantillonne la position réelle de chaque pierre (moteur de référence).
// Le moteur est chargé tel quel ; seule la fonction interne geomHeld est exposée pour lire la géométrie des pierres tenues/posées.
const path = require('path'), fs = require('fs'), vm = require('vm');
const ROOT = path.resolve(process.argv[2] || process.env.ICAMLOT_AUDIT || '../../icamlot-audit');
const ctx = { console, Math, JSON, Date, Error, Array, Object, String, Number, Boolean, Set, Map, Float32Array, Int8Array, Int32Array, Float64Array, Uint8Array, ArrayBuffer, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, undefined, module: { exports: {} }, exports: {} };
ctx.globalThis = ctx.global = ctx;
const ANCRE = 'return { exec: exec, finish: finish, result: result,';
for (const rel of ['spec/spec.js', 'bareme.js', 'engine/geom.js', 'engine/engine.js', 'engine/score.js', 'engine/actions.js', 'engine/env.js']) {
  let src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  if (rel === 'engine/engine.js') { if (!src.includes(ANCRE)) throw new Error('ancre introuvable'); src = src.replace(ANCRE, 'return { geomHeld: geomHeld, exec: exec, finish: finish, result: result,'); }
  vm.runInNewContext(src, ctx, { filename: rel });
}
const ENV = ctx.ENV;
const model = JSON.parse(fs.readFileSync(path.join(ROOT, '.data/modeles/fumee.json'), 'utf8'));
const sig = x => 1 / (1 + Math.exp(-x)), silu = x => x / (1 + Math.exp(-x));
function lin(x, w, b) { const y = Float64Array.from(b); for (let k = 0; k < x.length; k++) { const r = w[k], xk = x[k]; for (let j = 0; j < y.length; j++) y[j] += xk * r[j]; } return y; }
function fwd(obs, h) {
  const nm = model.normalisation; let x = obs.map((v, i) => Math.max(-nm.clip, Math.min(nm.clip, (v - nm.mean[i]) / nm.std[i])));
  const L = model.encodeur[0]; x = lin(x, L.w, L.b);
  const mu = x.reduce((a, b) => a + b) / x.length, va = x.reduce((a, b) => a + (b - mu) ** 2, 0) / x.length;
  x = x.map((v, i) => silu((v - mu) / Math.sqrt(va + L.ln.eps) * L.ln.gamma[i] + L.ln.beta[i]));
  const G = model.gru, H = model.hidden, gi = lin(x, G.w_ih, G.b_ih), gh = lin(h, G.w_hh, G.b_hh), hn = new Float64Array(H);
  for (let i = 0; i < H; i++) { const r = sig(gi[i] + gh[i]), z = sig(gi[H + i] + gh[H + i]), n = Math.tanh(gi[2 * H + i] + r * gh[2 * H + i]); hn[i] = (1 - z) * n + z * h[i]; }
  return { h: hn, logits: lin(hn, model.acteur[0].w, model.acteur[0].b) };
}
const env = ENV.create({ skipContacts: true, opponent: { program: ENV.EXAMPLE } });
let h = new Float64Array(model.hidden), last = null, lastObs = null, labels = [];
let st = env.reset({ seed: 10000, intensite: 'realiste' }), n = 0;
while (!st.done && n < 80) {
  const o = Array.from(st.obs);
  if (!(lastObs && o.every((v, i) => v === lastObs[i]))) { last = fwd(o, h); h = last.h; lastObs = o; }
  let best = -1, bv = -Infinity; for (let i = 0; i < last.logits.length; i++) if (st.mask[i] && last.logits[i] > bv) { bv = last.logits[i]; best = i; }
  labels.push(env.catalogue[best].label); st = env.step(best); n++;
}
const sim = env.sim, R = env.result(), RB = R.opponent;
const byIdB = {}; (RB ? RB.stones : []).forEach(s => { byIdB[s.id] = s; });
const at = (stn, t) => { let e = stn.tl[0]; for (const x of stn.tl) if (x.t <= t) e = x; return e; };
const box = g => { const f = g.fo; return [+f.cx.toFixed(1), +f.cy.toFixed(1), +((g.top + g.bottom) / 2).toFixed(1), +(2 * f.hl).toFixed(1), +(2 * f.hn).toFixed(1), +(g.top - g.bottom).toFixed(1), +(f.ang + 90).toFixed(2)]; };
const PKS = {}; ctx.ENGINE.PK ? ctx.ENGINE.PK.forEach(p => PKS[p.id] = p) : null;
const T_END = 10.2, DT = 0.05, out = {};
for (const s of R.stones) {
  const pk = JSON.parse(fs.readFileSync(path.join(__dirname, 'spec.json'), 'utf8')).carrieres.find(c => c.id === s.id.split('.')[0]);
  const lv = +s.id.split('.')[1] - 1, samples = [];
  for (let t = 0; t <= T_END + 1e-9; t += DT) {
    let e = at(s, t), who = 'y';
    if (e.k === 'gone' && byIdB[s.id]) { e = at(byIdB[s.id], t); who = 'b'; }
    let b;
    if (e.k === 'home') b = [pk.c[0], pk.c[1], 55 + 110 * lv, pk.axe_long === 'x' ? 320 : 110, pk.axe_long === 'x' ? 110 : 320, 110, 0, 0];
    else if (e.k === 'held') b = box(sim.geomHeld((who === 'y' ? R : RB).poseAt(t), e.f, e.l)).concat(who === 'y' ? 1 : 2);
    else if (e.k === 'free') b = box(sim.geomHeld(e.pose, e.f, e.l)).concat(3);
    else b = null;
    if (b && e.k === 'home') b = b.slice(0, 7).concat(0);
    samples.push(b);
  }
  out[s.id] = samples;
}
fs.writeFileSync('stones.json', JSON.stringify({ dt: DT, tEnd: T_END, stones: out, labels: labels.slice(0, 4) }));
const ev = Object.entries(out).filter(([, a]) => a.some(b => b && b[7])).map(([id, a]) => id + ':' + [...new Set(a.map(b => b ? b[7] : 'x'))].join(''));
console.log('premières décisions', labels.slice(0, 4)); console.log('pierres en mouvement', ev.join(' '));
console.log('exemple P1.1 à t=0,4,8', out['P1.1'][0], out['P1.1'][80], out['P1.1'][160]);
