/* Bande son du teaser, synthétisée (aucun échantillon externe) à partir des repères du montage :
   nappe grave, pulsation, whoosh aux raccords, impacts sur les textes et les poses de pierres,
   sifflement moteur qui suit la vitesse du robot (il descend dans les ralentis), feux de départ. */
import fs from 'node:fs';

const SR = 48000;
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };

export function soundtrack(c, file) {
  const N = Math.ceil(c.dur * SR), L = new Float32Array(N), Rt = new Float32Array(N), verb = new Float32Array(N);
  const add = (i, v, pan = 0, send = 0) => { if (i < 0 || i >= N) return; L[i] += v * (1 - Math.max(0, pan)); Rt[i] += v * (1 + Math.min(0, pan)); verb[i] += v * send; };
  const frameAt = t => c.frames[Math.max(0, Math.min(c.frames.length - 1, Math.floor(t * c.fps)))];
  const slowAt = t => { const f = frameAt(t); return f.r > 0 && f.r < 0.62; };
  const env = (t, a, d) => t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / d);

  /* nappe : quintes graves désaccordées, filtrées, plus sombre au ralenti */
  let lp = 0, lp2 = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR, f0 = 55;
    let x = 0;
    [[1, 1], [1.006, 0.8], [1.498, 0.5], [2, 0.35], [0.5, 0.6]].forEach(([m, a]) => { const ph = (t * f0 * m) % 1; x += a * (2 * ph - 1); });
    const cut = slowAt(t) ? 0.012 : t > 25.2 ? 0.02 : 0.035;
    lp += cut * (x - lp); lp2 += cut * (lp - lp2);
    const g = 0.07 * Math.min(1, t / 1.5) * (t > 29 ? Math.max(0, (30 - t)) : 1);
    add(i, lp2 * g, Math.sin(t * 0.7) * 0.2, 0.15);
  }
  /* pulsation (120 bpm) de 4,3 s au score ; étouffée au ralenti */
  for (let b = 4.3; b < 24.1; b += 0.5) {
    const s = slowAt(b), i0 = Math.floor(b * SR), len = Math.floor((s ? 0.6 : 0.35) * SR);
    let ph = 0;
    for (let k = 0; k < len; k++) { const t = k / SR, f = (s ? 30 : 45) + (s ? 50 : 90) * Math.exp(-t * 28); ph += f / SR; add(i0 + k, Math.sin(2 * Math.PI * ph) * env(t, 0.002, s ? 0.22 : 0.11) * 0.55, 0, s ? 0.3 : 0.05); }
    if (!s) { const j0 = Math.floor((b + 0.25) * SR); let hp = 0, prev = 0; for (let k = 0; k < 0.05 * SR; k++) { const n = rnd(); hp = 0.9 * (hp + n - prev); prev = n; add(j0 + k, hp * env(k / SR, 0.001, 0.012) * 0.08, (b * 2) % 2 ? 0.4 : -0.4); } }
  }
  /* whoosh aux raccords */
  c.cuts.forEach((v, n) => {
    const i0 = Math.floor((v - 0.3) * SR), len = Math.floor(0.45 * SR);
    let y1 = 0, y2 = 0;
    for (let k = 0; k < len; k++) {
      const u = k / len, fc = 300 + 4200 * Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 2, q = 0.35, w = 2 * Math.sin(Math.PI * fc / SR);
      const x = rnd(); y1 += w * (x - y1 - q * y2); y2 += w * y1;
      add(i0 + k, y2 * Math.sin(Math.PI * u) ** 2 * 0.22, (u * 2 - 1) * (n % 2 ? 0.7 : -0.7), 0.2);
    }
  });
  /* montées avant le départ et avant le carton de fin */
  [[2.9, 4.3], [24.5, 25.2]].forEach(([a, b]) => {
    let ph = 0, y = 0;
    for (let i = Math.floor(a * SR); i < b * SR; i++) { const u = (i / SR - a) / (b - a), f = 120 + 900 * u * u; ph += f / SR; y += 0.2 * (rnd() - y); add(i, (Math.sin(2 * Math.PI * ph) * 0.06 + y * 0.25) * u * u, 0, 0.3); }
  });
  /* impacts */
  const boom = (v, f0, f1, dec, g, noise, send) => {
    const i0 = Math.floor(v * SR); let ph = 0, y = 0;
    for (let k = 0; k < dec * 6 * SR; k++) { const t = k / SR, f = f1 + (f0 - f1) * Math.exp(-t * 18); ph += f / SR; y += 0.3 * (rnd() - y); add(i0 + k, (Math.sin(2 * Math.PI * ph) * env(t, 0.002, dec) + y * noise * env(t, 0.001, 0.03)) * g, 0, send); }
  };
  const beep = (v, f, d, g) => { const i0 = Math.floor(v * SR); for (let k = 0; k < d * SR; k++) { const t = k / SR; add(i0 + k, Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.5 * env(t, 0.003, d * 0.5) * g * (t < d - 0.01 ? 1 : 0), 0, 0.25); } };
  c.hits.forEach(h => {
    if (h.k === 'feu') beep(h.v, 880, 0.09, 0.12);
    else if (h.k === 'go') { beep(h.v, 1760, 0.3, 0.12); boom(h.v, 140, 38, 0.35, 0.9, 1.2, 0.4); }
    else if (h.k === 'pose') h.slow ? boom(h.v, 90, 32, 0.28, 0.75, 1.6, 0.6) : boom(h.v, 160, 60, 0.08, 0.45, 1.5, 0.15);
    else if (h.k === 'tampon') boom(h.v, 220, 70, 0.07, 0.8, 2.5, 0.35);
    else if (h.k === 'logo' || h.k === 'titre') boom(h.v, 120, 30, 0.6, 1, 1, 0.7);
    else boom(h.v, 130, 36, 0.3, 0.75, 1.2, 0.45);
  });
  /* moteur : hauteur et volume suivant la vitesse du robot à l'écran */
  let ph1 = 0, ph2 = 0, fs = 0, gs = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR, f = frameAt(t), mm = f.mm, tf = 110 + 0.85 * mm, tg = Math.min(1, mm / 250) * 0.07;
    fs += 0.0008 * (tf - fs); gs += 0.0015 * (tg - gs);
    ph1 += fs / SR; ph2 += fs * 2.01 / SR;
    add(i, (Math.sin(2 * Math.PI * ph1) + 0.35 * Math.sin(2 * Math.PI * ph2) + 0.12 * Math.sign(Math.sin(2 * Math.PI * ph1 * 3))) * gs, 0, 0.05);
  }
  /* réverbération (Schroeder) sur le départ « send » */
  const wet = new Float32Array(N);
  [1557, 1617, 1491, 1422].forEach(d0 => { const d = Math.round(d0 * SR / 25000 * 1.6), buf = new Float32Array(d); let p = 0, f = 0; for (let i = 0; i < N; i++) { const o = buf[p]; f = o * 0.7 + f * 0.3; buf[p] = verb[i] + f * 0.82; p = (p + 1) % d; wet[i] += o * 0.25; } });
  [225, 556].forEach(d0 => { const d = Math.round(d0 * SR / 25000 * 1.6), buf = new Float32Array(d); let p = 0; for (let i = 0; i < N; i++) { const o = buf[p], x = wet[i]; buf[p] = x + o * 0.5; wet[i] = o - x * 0.5; p = (p + 1) % d; } });
  /* mixage, limiteur doux, fondu final */
  let pk = 0;
  for (let i = 0; i < N; i++) { L[i] += wet[i] * 0.9; Rt[i] += wet[(i + 480) % N] * 0.9; pk = Math.max(pk, Math.abs(L[i]), Math.abs(Rt[i])); }
  const g = 0.95 / Math.max(1e-6, pk) * 1.6, out = Buffer.alloc(44 + N * 4);
  for (let i = 0; i < N; i++) {
    const fade = Math.min(1, (c.dur - i / SR) / 0.6);
    out.writeInt16LE(Math.round(Math.tanh(L[i] * g) * 0.9 * fade * 32767), 44 + i * 4);
    out.writeInt16LE(Math.round(Math.tanh(Rt[i] * g) * 0.9 * fade * 32767), 46 + i * 4);
  }
  out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(N * 4, 40);
  fs.writeFileSync(file, out);
}
