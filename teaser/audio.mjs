/* Bande son du teaser, synthétisée (aucun échantillon externe) à partir des repères du montage.
   Machine : relais qui claquent, pompe à vide qui démarre, sifflement d'air puis ventouse qui colle,
   mise à l'air « pschhh » au lâcher, choc sourd du carton, vérins de la pince, roulement des roues.
   Au ralenti, ces bruits sont plus graves et plus longs. Habillage : nappe, pulsation, whoosh, impacts, feux. */
import fs from 'node:fs';

const SR = 48000, TAU = 2 * Math.PI;
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
/* filtre d'état variable : passe-bande (bp) et passe-bas (lp), fréquence modifiable à chaque échantillon */
function svf() {
  let lp = 0, bp = 0;
  return (x, fc, damp) => { const f = 2 * Math.sin(Math.PI * Math.min(fc, SR / 6) / SR), hp = x - lp - damp * bp; bp += f * hp; lp += f * bp; return { bp, lp }; };
}

export function soundtrack(c, file) {
  const N = Math.ceil(c.dur * SR), L = new Float32Array(N), Rt = new Float32Array(N), verb = new Float32Array(N);
  const add = (i, v, pan = 0, send = 0) => { if (i < 0 || i >= N) return; L[i] += v * (1 - Math.max(0, pan)); Rt[i] += v * (1 + Math.min(0, pan)); verb[i] += v * send; };
  const frameAt = t => c.frames[Math.max(0, Math.min(c.frames.length - 1, Math.floor(t * c.fps)))];
  const slowAt = t => { const f = frameAt(t); return f.r > 0 && f.r < 0.62; };
  const env = (t, a, d) => t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / d);

  /* ---------- machine ---------- */
  /* un bruit de la machine s'arrête net (fondu de 8 ms) au raccord qui suit */
  const machine = e => {
    const k = e.r, P = Math.pow(k, 0.5), D = 1 / Math.pow(k, 0.6), send = k < 0.62 ? 0.35 : 0.1;
    const put = (i, v, pan = 0) => { const t = i / SR; if (t > e.end) return; add(i, t > e.end - 0.008 ? v * (e.end - t) / 0.008 : v, pan, send); };
    return { P, D, put };
  };
  /* relais / électrovanne : claquement sec, résonance métallique, coup de l'armature, rebond de contact */
  function relay(e, v, amp = 1, pan = -0.2) {
    const { P, D, put } = machine(e), i0 = Math.floor(v * SR);
    [[0, 1], [0.0045 * D, 0.45]].forEach(([off, a]) => {
      let hp = 0, prev = 0; const j0 = i0 + Math.floor(off * SR);
      for (let k = 0; k < 0.04 * D * SR; k++) {
        const t = k / SR, n = rnd(); hp = 0.55 * (hp + n - prev); prev = n;
        const tick = hp * Math.exp(-t / (0.0012 * D)), ring = Math.sin(TAU * 2350 * P * t) * Math.exp(-t / (0.006 * D)) * 0.3, body = Math.sin(TAU * 170 * P * t) * Math.exp(-t / (0.012 * D)) * 0.5;
        put(j0 + k, (tick * 0.9 + ring + body) * a * amp * 0.8, pan);
      }
    });
  }
  /* pompe à vide à membrane : démarrage, sifflement d'air tant que la ventouse n'est pas collée, puis arrêt */
  function pump(e, v0, vSeal, vStop) {
    const { P, D, put } = machine(e), i0 = Math.floor(v0 * SR), i1 = Math.floor((vStop + 0.15 * D) * SR), f0 = 52 * P;
    const air = svf(), body = svf();
    let ph = 0;
    for (let i = i0; i < i1; i++) {
      const t = i / SR, u = t - v0, sealed = t >= vSeal, us = t - vSeal;
      const f = f0 * (1 - Math.exp(-u / (0.06 * D))) * (sealed ? 1 - 0.06 * (1 - Math.exp(-us / 0.05)) : 1) * (t > vStop ? Math.exp(-(t - vStop) / (0.06 * D)) : 1);
      ph += f / SR;
      let w = 0; for (let n = 1; n <= 9; n++) w += Math.sin(TAU * n * ph + n * 0.7) / n;
      const stroke = Math.pow(0.55 + 0.45 * Math.max(0, Math.sin(TAU * ph)), 2);
      const motor = body(w * stroke, 1800 * P, 0.7).lp;
      const hissAmp = sealed ? 0.06 + 0.3 * Math.exp(-us / 0.06) : 0.36 * Math.min(1, u / 0.04);
      const hiss = air(rnd(), 2600 * P, 0.9).bp * hissAmp;
      const g = Math.min(1, u / 0.03) * (t > vStop ? Math.exp(-(t - vStop) / (0.08 * D)) : 1);
      put(i, (motor * 0.32 + hiss * 1.3) * g, 0.1);
    }
  }
  /* ventouse qui colle : « tchk » court et sourd */
  function seal(e, v) {
    const { P, D, put } = machine(e), i0 = Math.floor(v * SR), lp = svf(); let ph = 0;
    for (let k = 0; k < 0.12 * D * SR; k++) {
      const t = k / SR, f = 70 * P + 60 * P * Math.exp(-t / 0.01); ph += f / SR;
      put(i0 + k, Math.sin(TAU * ph) * env(t, 0.001, 0.035 * D) * 0.55 + lp(rnd(), 900 * P, 1).lp * env(t, 0.0005, 0.012 * D) * 0.9, 0.1);
    }
  }
  /* mise à l'air au lâcher : « pschhh » qui descend, précédé d'un petit pop */
  function vent(e, v) {
    const { P, D, put } = machine(e), i0 = Math.floor(v * SR), bpf = svf();
    for (let k = 0; k < 0.55 * D * SR; k++) {
      const t = k / SR, fc = (1300 + 2700 * Math.exp(-t / (0.12 * D))) * P;
      const x = bpf(rnd(), fc, 0.8).bp * env(t, 0.003, 0.17 * D) * 0.9 + Math.sin(TAU * 260 * P * t) * env(t, 0.0005, 0.015 * D) * 0.3;
      put(i0 + k, x, 0.25);
    }
  }
  /* carton qui se pose : choc sourd, bruit de carton, petit rebond */
  function land(e, v, amp = 1) {
    const { P, D, put } = machine(e);
    [[0, 1], [0.035 * D, 0.3]].forEach(([off, a]) => {
      const i0 = Math.floor((v + off) * SR), lp = svf(); let ph = 0;
      for (let k = 0; k < 0.25 * D * SR; k++) {
        const t = k / SR, f = 68 * P + 45 * P * Math.exp(-t / 0.015); ph += f / SR;
        const x = Math.sin(TAU * ph) * env(t, 0.001, 0.07 * D) * 0.7 + lp(rnd(), 650 * P, 1).lp * env(t, 0.0005, 0.03 * D) * 1.1 + Math.sin(TAU * 330 * P * t) * env(t, 0.001, 0.025 * D) * 0.12;
        put(i0 + k, x * a * amp, 0);
      }
    });
  }
  /* contact d'une face avec la pile : tape légère */
  function tap(e, v) {
    const { P, D, put } = machine(e), i0 = Math.floor(v * SR), lp = svf();
    for (let k = 0; k < 0.08 * D * SR; k++) { const t = k / SR; put(i0 + k, lp(rnd(), 1200 * P, 1).lp * env(t, 0.0005, 0.008 * D) * 0.7 + Math.sin(TAU * 150 * P * t) * env(t, 0.001, 0.02 * D) * 0.3, 0); }
  }
  /* vérin de la pince (vis + moteur pas à pas) : sifflement mécanique court, avec cliquetis */
  function verin(e, v0, v1) {
    const { P, put } = machine(e), i0 = Math.floor(v0 * SR), i1 = Math.floor(Math.max(v0 + 0.06, v1) * SR), lp = svf(); let ph = 0;
    for (let i = i0; i < i1; i++) {
      const t = (i - i0) / SR, rest = (i1 - i) / SR, g = Math.min(1, t / 0.02, rest / 0.03);
      ph += 640 * P / SR;
      const step = Math.sign(Math.sin(TAU * ph)) * 0.5 + Math.sin(TAU * ph * 2) * 0.3, rattle = rnd() * (0.5 + 0.5 * Math.sin(TAU * 95 * t));
      put(i, lp(step + rattle * 0.4, 2200 * P, 0.9).lp * g * 0.075, -0.3);
    }
  }
  (c.sfx || []).forEach(e => {
    const D = 1 / Math.pow(e.r, 0.6);
    if (e.k === 'aspire') { relay(e, e.v); pump(e, e.v + 0.012 * D, e.v1, e.v1 + 0.35 * D); seal(e, e.v1); }
    else if (e.k === 'lache') { relay(e, e.v, 1, 0.2); vent(e, e.v + 0.006 * D); land(e, e.v + 0.02 * D); }
    else if (e.k === 'contact') tap(e, e.v);
    else if (e.k === 'verin') verin(e, e.v, e.v1);
  });
  /* roues : roulement sourd sur le vinyle, seulement quand le robot avance */
  { const lp = svf(), hp = svf(); let gs = 0;
    for (let i = 0; i < N; i++) {
      const t = i / SR, f = frameAt(t), tg = Math.min(1, f.mm / 450) * 0.16; gs += 0.0015 * (tg - gs);
      if (gs < 1e-4) continue;
      const n = rnd(), r = lp(n, 140, 1).lp * 2.2 + hp(n, 1800, 1).bp * 0.08;
      add(i, r * gs, 0, 0.03);
    } }

  /* ---------- habillage ---------- */
  /* nappe : quintes graves désaccordées, filtrées, plus sombre au ralenti */
  let lp1 = 0, lp2 = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR; let x = 0;
    [[1, 1], [1.006, 0.8], [1.498, 0.5], [2, 0.35], [0.5, 0.6]].forEach(([m, a]) => { const ph = (t * 55 * m) % 1; x += a * (2 * ph - 1); });
    const cut = slowAt(t) ? 0.01 : t > 25.2 ? 0.02 : 0.03;
    lp1 += cut * (x - lp1); lp2 += cut * (lp1 - lp2);
    add(i, lp2 * 0.045 * Math.min(1, t / 1.5) * (t > 29 ? Math.max(0, 30 - t) : 1), Math.sin(t * 0.7) * 0.2, 0.15);
  }
  /* pulsation (120 bpm) pendant l'action ; étouffée au ralenti */
  for (let b = 4.3; b < 25.2; b += 0.5) {
    const s = slowAt(b), i0 = Math.floor(b * SR), len = Math.floor((s ? 0.6 : 0.35) * SR); let ph = 0;
    for (let k = 0; k < len; k++) { const t = k / SR, f = (s ? 30 : 45) + (s ? 50 : 90) * Math.exp(-t * 28); ph += f / SR; add(i0 + k, Math.sin(TAU * ph) * env(t, 0.002, s ? 0.22 : 0.11) * 0.38, 0, s ? 0.3 : 0.05); }
    if (!s) { const j0 = Math.floor((b + 0.25) * SR); let hp = 0, prev = 0; for (let k = 0; k < 0.05 * SR; k++) { const n = rnd(); hp = 0.9 * (hp + n - prev); prev = n; add(j0 + k, hp * env(k / SR, 0.001, 0.012) * 0.05, (b * 2) % 2 ? 0.4 : -0.4); } }
  }
  /* whoosh aux raccords */
  c.cuts.forEach((v, n) => {
    const i0 = Math.floor((v - 0.3) * SR), len = Math.floor(0.45 * SR), bpf = svf();
    for (let k = 0; k < len; k++) { const u = k / len, fc = 300 + 4200 * Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 2; add(i0 + k, bpf(rnd(), fc, 0.7).bp * Math.sin(Math.PI * u) ** 2 * 0.2, (u * 2 - 1) * (n % 2 ? 0.7 : -0.7), 0.2); }
  });
  /* montées avant le départ et avant le carton de fin */
  [[2.9, 4.3], [24.5, 25.2]].forEach(([a, b]) => {
    let ph = 0, y = 0;
    for (let i = Math.floor(a * SR); i < b * SR; i++) { const u = (i / SR - a) / (b - a), f = 120 + 900 * u * u; ph += f / SR; y += 0.2 * (rnd() - y); add(i, (Math.sin(TAU * ph) * 0.06 + y * 0.25) * u * u, 0, 0.3); }
  });
  /* impacts des textes, tampon, feux de départ */
  const boom = (v, f0, f1, dec, g, noise, send) => {
    const i0 = Math.floor(v * SR); let ph = 0, y = 0;
    for (let k = 0; k < dec * 6 * SR; k++) { const t = k / SR, f = f1 + (f0 - f1) * Math.exp(-t * 18); ph += f / SR; y += 0.3 * (rnd() - y); add(i0 + k, (Math.sin(TAU * ph) * env(t, 0.002, dec) + y * noise * env(t, 0.001, 0.03)) * g, 0, send); }
  };
  const beep = (v, f, d, g) => { const i0 = Math.floor(v * SR); for (let k = 0; k < d * SR; k++) { const t = k / SR; add(i0 + k, Math.sign(Math.sin(TAU * f * t)) * 0.5 * env(t, 0.003, d * 0.5) * g * (t < d - 0.01 ? 1 : 0), 0, 0.25); } };
  c.hits.forEach(h => {
    if (h.k === 'feu') beep(h.v, 880, 0.09, 0.1);
    else if (h.k === 'go') { beep(h.v, 1760, 0.3, 0.1); boom(h.v, 140, 38, 0.35, 0.8, 1.2, 0.4); }
    else if (h.k === 'tampon') boom(h.v, 220, 70, 0.07, 0.8, 2.5, 0.35);
    else if (h.k === 'logo' || h.k === 'titre') boom(h.v, 120, 30, 0.6, 0.9, 1, 0.7);
    else boom(h.v, 130, 36, 0.3, 0.65, 1.2, 0.45);
  });

  /* ---------- réverbération (Schroeder), mixage, limiteur doux ---------- */
  const wet = new Float32Array(N);
  [1557, 1617, 1491, 1422].forEach(d0 => { const d = Math.round(d0 * SR / 25000 * 1.6), buf = new Float32Array(d); let p = 0, f = 0; for (let i = 0; i < N; i++) { const o = buf[p]; f = o * 0.7 + f * 0.3; buf[p] = verb[i] + f * 0.82; p = (p + 1) % d; wet[i] += o * 0.25; } });
  [225, 556].forEach(d0 => { const d = Math.round(d0 * SR / 25000 * 1.6), buf = new Float32Array(d); let p = 0; for (let i = 0; i < N; i++) { const o = buf[p], x = wet[i]; buf[p] = x + o * 0.5; wet[i] = o - x * 0.5; p = (p + 1) % d; } });
  let pk = 0;
  for (let i = 0; i < N; i++) { L[i] += wet[i] * 0.8; Rt[i] += wet[(i + 480) % N] * 0.8; pk = Math.max(pk, Math.abs(L[i]), Math.abs(Rt[i])); }
  const g = 1.25 / Math.max(1e-6, pk), out = Buffer.alloc(44 + N * 4);
  for (let i = 0; i < N; i++) {
    const fade = Math.min(1, (c.dur - i / SR) / 0.6);
    out.writeInt16LE(Math.round(Math.tanh(L[i] * g) * 0.92 * fade * 32767), 44 + i * 4);
    out.writeInt16LE(Math.round(Math.tanh(Rt[i] * g) * 0.92 * fade * 32767), 46 + i * 4);
  }
  out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(N * 4, 40);
  fs.writeFileSync(file, out);
}
