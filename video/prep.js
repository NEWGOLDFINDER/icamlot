// Extrait de match.json les 4 premières décisions (match 0 à 10 s) et les liaisons les plus actives du réseau.
const fs = require('fs');
const M = JSON.parse(fs.readFileSync('match.json', 'utf8'));
const H = 128, K = 4, T_END = 10.0;
const top = (arr, n) => arr.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2])).slice(0, n);
const dec = M.dec.slice(0, K).map(d => {
  const L1 = [], L2 = [], L3 = [];
  d.xn.forEach((x, i) => M.weights.enc[i].forEach((w, j) => L1.push([i, j, x * w])));
  d.enc.forEach((e, k) => { for (let j = 0; j < H; j++) L2.push([k, j, e * M.weights.gru_ih[k][2 * H + j]]); });
  d.h.forEach((v, i) => L3.push([i, d.idx, v * M.weights.act[i][d.idx]]));
  const n1 = top(L1, 150), n2 = top(L2, 150), n3 = top(L3, 48);
  const norm = l => { const m = Math.abs(l[0][2]); return l.map(([a, b, s]) => [a, b, +(s / m).toFixed(3)]); };
  const valid = d.logits.map((v, i) => d.mask[i] ? v : -Infinity), mx = Math.max(...valid);
  const ex = valid.map(v => v === -Infinity ? 0 : Math.exp(v - mx)), Z = ex.reduce((a, b) => a + b);
  const probs = ex.map(v => v / Z);
  const top3 = probs.map((p, i) => [i, p]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([i, p]) => [i, M.catalogue[i], +p.toFixed(4)]);
  return { t: d.t, obs: d.obs, xn: d.xn, enc: d.enc, h: d.h, logits: d.logits, mask: d.mask, idx: d.idx, label: d.label, reward: d.reward, err: d.err,
    probs: probs.map(p => +p.toFixed(4)), top3, L1: norm(n1), L2: norm(n2), L3: norm(n3), nValid: d.mask.reduce((a, b) => a + b) };
});
const cut = p => p.slice(0, Math.round(T_END / 0.05) + 3);
fs.writeFileSync('netlive.json', JSON.stringify({ source: M.source, dec, yellow: cut(M.yellow), blue: cut(M.blue), catalogue: M.catalogue }));
dec.forEach(d => console.log(d.t, d.label, 'récompense', d.reward, 'valides', d.nValid, 'top3', JSON.stringify(d.top3)));
console.log('jaune', M.yellow[0], M.yellow[200], 'bleu', M.blue[0], M.blue[200]);
