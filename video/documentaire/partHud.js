// ------------------------------------------------------------------ HUD 2D
const F = (w, s, fam = 'Inter Display') => `${w} ${s * DPR}px "${fam}", "Inter", sans-serif`;
function text(str, x, y, o = {}) {
  const { size = 32, weight = 600, color = CSS.white, alpha = 1, align = 'left', track = 0, fam = 'Inter Display', glow = 0, base = 'alphabetic' } = o;
  if (alpha <= 0 || !str) return 0;
  g.save(); g.globalAlpha = clamp(alpha); g.font = F(weight, size, fam); g.textAlign = align; g.textBaseline = base;
  g.letterSpacing = (track * DPR) + 'px'; g.fillStyle = color;
  if (glow) { g.shadowColor = color; g.shadowBlur = glow * DPR; }
  g.fillText(str, x * DPR, y * DPR); const w = g.measureText(str).width / DPR; g.restore(); return w;
}
function typeOn(str, k) { return str.slice(0, Math.round(str.length * clamp(k))); }
function rect(x, y, w, h, fill, alpha = 1, stroke) {
  g.save(); g.globalAlpha = clamp(alpha);
  if (fill) { g.fillStyle = fill; g.fillRect(x * DPR, y * DPR, w * DPR, h * DPR); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5 * DPR; g.strokeRect(x * DPR, y * DPR, w * DPR, h * DPR); }
  g.restore();
}
function line(x1, y1, x2, y2, color, alpha = 1, w = 1.5) { g.save(); g.globalAlpha = clamp(alpha); g.strokeStyle = color; g.lineWidth = w * DPR; g.beginPath(); g.moveTo(x1 * DPR, y1 * DPR); g.lineTo(x2 * DPR, y2 * DPR); g.stroke(); g.restore(); }
function dot(x, y, r, color, alpha = 1) { g.save(); g.globalAlpha = clamp(alpha); g.fillStyle = color; g.shadowColor = color; g.shadowBlur = 12 * DPR; g.beginPath(); g.arc(x * DPR, y * DPR, r * DPR, 0, Math.PI * 2); g.fill(); g.restore(); }
const VP = { x0: 0, w: W }, NVP = { x0: 0, w: W };
function proj(v) { const p = v.clone().project(camera); return { x: VP.x0 + (p.x + 1) / 2 * VP.w, y: (1 - p.y) / 2 * H, z: p.z }; }
function callout(anchor, dx, dy, label, sub, k, color = CSS.cyan) {
  if (k <= 0) return; const a = proj(anchor); if (a.z > 1) return;
  const ex = a.x + dx, ey = a.y + dy, kk = eout(clamp(k * 1.6));
  dot(a.x, a.y, 4.5, color, kk);
  const mx = lerp(a.x, ex, kk), my = lerp(a.y, ey, kk); line(a.x, a.y, mx, my, color, 0.9 * kk);
  const left = dx < 0, tk = clamp((k - 0.35) * 1.8);
  if (tk > 0) {
    line(ex, ey, ex + (left ? -22 : 22), ey, color, tk);
    const tx = ex + (left ? -30 : 30);
    text(typeOn(label, tk * 1.4), tx, ey + 8, { size: 25, weight: 600, align: left ? 'right' : 'left', alpha: tk });
    if (sub) text(typeOn(sub, (tk - 0.3) * 1.6), tx, ey + 38, { size: 18, weight: 500, color: CSS.dim, align: left ? 'right' : 'left', alpha: tk, fam: 'Inter' });
  }
}
function chip(str, x, y, k, color = CSS.cyan) {
  if (k <= 0) return; const kk = eout(k);
  g.save(); g.font = F(600, 19, 'Inter'); g.letterSpacing = (2 * DPR) + 'px'; const w = g.measureText(str).width / DPR + 34; g.restore();
  rect(x, y, w * kk, 40, 'rgba(6,18,30,0.75)', k, color);
  rect(x, y, 4, 40, color, k);
  text(typeOn(str, (k - 0.2) * 1.6), x + 18, y + 27, { size: 19, weight: 600, track: 2, fam: 'Inter', alpha: k });
}
function sectionTitle(num, title, k) {
  if (k <= 0) return; const kk = eoutx(k);
  text(num, 80, 150, { size: 22, weight: 700, color: CSS.cyan, track: 4, alpha: kk, fam: 'Inter' });
  line(80, 166, 80 + 70 * kk, 166, CSS.cyan, kk, 2);
  text(typeOn(title, k * 1.5), 80, 210, { size: 44, weight: 700, track: 1, alpha: kk });
}
function glitchTitle(str, x, y, size, k, seed, o = {}) {
  if (k <= 0) return;
  const r = rng(seed), jitter = 1 - clamp(k * 1.5);
  if (jitter > 0.02) {
    for (let i = 0; i < 3; i++) {
      const dx = (r() - 0.5) * 60 * jitter, cols = ['#ff2e63', '#38e1ff', '#ffffff'];
      text(str, x + dx, y + (r() - 0.5) * 10 * jitter, Object.assign({ size, weight: 800, align: 'center', color: cols[i], alpha: 0.5 * k }, o));
    }
  }
  text(str, x, y, Object.assign({ size, weight: 800, align: 'center', alpha: clamp(k * 1.3), glow: 18 }, o));
}
function vignette(a = 0.55) {
  const gr = g.createRadialGradient(W / 2 * DPR, H / 2 * DPR, H * 0.35 * DPR, W / 2 * DPR, H / 2 * DPR, W * 0.75 * DPR);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${a})`); g.fillStyle = gr; g.fillRect(0, 0, W * DPR, H * DPR);
}
function flash(a, color = '255,255,255') { if (a > 0) { g.fillStyle = `rgba(${color},${clamp(a)})`; g.fillRect(0, 0, W * DPR, H * DPR); } }
function scanlines(a) { if (a <= 0) return; g.save(); g.globalAlpha = a; g.fillStyle = '#000'; for (let y = 0; y < H * DPR; y += 4 * DPR) g.fillRect(0, y, W * DPR, DPR); g.restore(); }

