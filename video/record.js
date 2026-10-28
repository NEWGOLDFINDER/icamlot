// Joue un match réel dans le moteur JS de référence (branche audit/simulateur-ia) :
// cerveau « fumee » (glouton) contre la stratégie d'exemple, intensité réaliste, graine d'évaluation 10000.
// Enregistre, à chaque décision, les activations réelles du réseau et la chronologie des deux robots.
const path = require('path'), fs = require('fs');
const ROOT = path.resolve(process.argv[2] || process.env.ICAMLOT_AUDIT || '../../icamlot-audit');   // racine d'une copie de la branche audit/simulateur-ia
const ctx = require(path.join(ROOT, 'engine/load.js')).loadIcamlot(ROOT);
const vm = require('vm'); vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'cerveau/runtime.js'), 'utf8'), ctx);
const ENV = ctx.ENV, RT = ctx.RUNTIME || ctx.CERVEAU_RUNTIME || ctx.module.exports;
const model = JSON.parse(fs.readFileSync(path.join(ROOT, '.data/modeles/fumee.json'), 'utf8'));
const sig = x => 1 / (1 + Math.exp(-x)), silu = x => x / (1 + Math.exp(-x));
function lin(x, w, b) { const y = Float64Array.from(b); for (let k = 0; k < x.length; k++) { const r = w[k], xk = x[k]; for (let j = 0; j < y.length; j++) y[j] += xk * r[j]; } return y; }
function fwd(obs, h) {
  const nm = model.normalisation, xn = obs.map((v, i) => Math.max(-nm.clip, Math.min(nm.clip, (v - nm.mean[i]) / nm.std[i])));
  let x = xn; const L = model.encodeur[0]; x = lin(x, L.w, L.b);
  const mu = x.reduce((a, b) => a + b) / x.length, va = x.reduce((a, b) => a + (b - mu) ** 2, 0) / x.length;
  x = x.map((v, i) => silu((v - mu) / Math.sqrt(va + L.ln.eps) * L.ln.gamma[i] + L.ln.beta[i]));
  const G = model.gru, H = model.hidden, gi = lin(x, G.w_ih, G.b_ih), gh = lin(h, G.w_hh, G.b_hh), hn = new Float64Array(H);
  for (let i = 0; i < H; i++) { const r = sig(gi[i] + gh[i]), z = sig(gi[H + i] + gh[H + i]), n = Math.tanh(gi[2 * H + i] + r * gh[2 * H + i]); hn[i] = (1 - z) * n + z * h[i]; }
  const A = model.acteur[0], lg = lin(hn, A.w, A.b);
  return { xn, enc: x, h: hn, logits: lg };
}
const env = ENV.create({ skipContacts: true, opponent: { program: ENV.EXAMPLE } });   // configuration de trainer/evaluation.py
let h = new Float64Array(model.hidden), lastObs = null, last = null; const dec = [];
const choose = (obs, mask) => {
  const o = Array.from(obs);
  if (!(lastObs && o.every((v, i) => v === lastObs[i]))) { last = fwd(o, h); h = last.h; lastObs = o; }
  let best = -1, bv = -Infinity; for (let i = 0; i < last.logits.length; i++) if (mask[i] && last.logits[i] > bv) { bv = last.logits[i]; best = i; }
  dec.push({ t: env.sim.time(), obs: o, mask: Array.from(mask), xn: last.xn, enc: Array.from(last.enc), h: Array.from(last.h), logits: Array.from(last.logits), idx: best, label: env.catalogue[best].label });
  return best;
};
// boucle de trainer/evaluation.py : masque de l'environnement, choix glouton, au plus 80 décisions
let st = env.reset({ seed: 10000, intensite: 'realiste' }), n = 0;
while (!st.done && n < 80) { const i = choose(st.obs, st.mask); st = env.step(i); dec[dec.length - 1].err = st.err || null; dec[dec.length - 1].reward = st.reward; n++; }
const fin = st;
const R = env.result();
// contrôle : notre forward == runtime de référence
const ref = RT && RT.forward ? RT.forward(model, dec[0].obs, new Float64Array(model.hidden)) : null;
if (ref) console.log('écart runtime', Math.max(...ref.logits.map((v, i) => Math.abs(v - dec[0].logits[i]))));
const poses = (K, f) => { const out = []; for (let t = 0; t <= 100.001; t += 0.05) { const p = f(t); out.push([+p.x.toFixed(1), +p.y.toFixed(1), +p.h.toFixed(2)]); } return out; };
const ysim = env.sim;
const blueK = R.opponent ? R.opponent.K : null;
const poseAtK = (K, t) => { if (t <= K[0].t) return K[0]; let i = K.length - 1; if (t >= K[i].t) return K[i]; let lo = 0, hi = i; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (K[m].t < t) lo = m; else hi = m; } const a = K[hi - 1], b = K[hi], d = b.t - a.t, k = d > 0 ? (t - a.t) / d : 1, e = b.lin ? k : k * k * (3 - 2 * k); return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, h: a.h + (b.h - a.h) * e }; };
const out = {
  source: 'moteur JS de référence (audit/simulateur-ia) · modèle .data/modeles/fumee.json · adversaire : stratégie d\'exemple, intensité réaliste, graine 10000',
  score: fin.score, catalogue: env.catalogue.map(a => a.label), groups: env.groups,
  weights: { enc: model.encodeur[0].w, gru_ih: model.gru.w_ih, act: model.acteur[0].w },
  dec: dec.map(d => ({ t: +d.t.toFixed(3), obs: d.obs.map(v => +v.toFixed(4)), mask: d.mask, xn: d.xn.map(v => +v.toFixed(3)), enc: d.enc.map(v => +v.toFixed(3)), h: d.h.map(v => +v.toFixed(3)), logits: d.logits.map(v => +v.toFixed(3)), idx: d.idx, label: d.label, err: d.err, reward: d.reward })),
  yellow: poses(R.K, t => ysim.poseAtT(t)),
  blue: blueK ? poses(blueK, t => poseAtK(blueK, t)) : null,
};
fs.writeFileSync('match.json', JSON.stringify(out));
console.log('score', fin.score, 'décisions', dec.length, 'T fin', ysim.time().toFixed(1));
dec.forEach(d => console.log(d.t.toFixed(1).padStart(6), d.label, d.err || '', d.reward));
console.log('bleu', out.blue && out.blue[0], out.blue && out.blue[out.blue.length - 1], 'jaune0', out.yellow[0]);
