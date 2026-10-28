
// ------------------------------------------------------------------ composants du documentaire (sans voix off : tout se lit à l'écran)
const TEAM = { nom: 'ICAMLOT', asso: 'ROBOTICAM VENDÉE', membres: ['MAEL DELAHAYE', 'PIERRE-MARIE CHIRON', 'WILLIAM TRICOIRE', 'CORENTIN BATY'] };
function wrapLines(str, size, maxW, weight = 600, fam = 'Inter Display') {
  g.save(); g.font = F(weight, size, fam); const words = str.split(' '), lines = []; let cur = '';
  for (const w of words) { const tst = cur ? cur + ' ' + w : w; if (g.measureText(tst).width / DPR > maxW && cur) { lines.push(cur); cur = w; } else cur = tst; }
  if (cur) lines.push(cur); g.restore(); return lines;
}
// grand sous-titre pédagogique (remplace la voix off)
function caption(str, t, t0, t1, o = {}) {
  if (typeof SUBS_OFF !== 'undefined' && SUBS_OFF) return;
  if (!str || t < t0 || t > t1) return;
  const a = fadeIO(t, t0, t1, 0.25, 0.25), size = o.size || 40, y0 = o.y || (H - 150), lines = wrapLines(str, size, o.maxW || 1500, 650);
  const hh = lines.length * size * 1.25 + 40;
  const gr = g.createLinearGradient(0, (y0 - hh) * DPR, 0, (y0 + 60) * DPR); gr.addColorStop(0, 'rgba(2,5,12,0)'); gr.addColorStop(0.35, `rgba(2,5,12,${0.78 * a})`); gr.addColorStop(1, `rgba(2,5,12,${0.85 * a})`);
  g.fillStyle = gr; g.fillRect(0, (y0 - hh) * DPR, W * DPR, (hh + 60) * DPR);
  const rise = (1 - eout(seg(t, t0, t0 + 0.35))) * 14;
  lines.forEach((l, i) => text(l, W / 2, y0 - (lines.length - 1 - i) * size * 1.25 + rise, { size, weight: 650, align: 'center', alpha: a, color: o.color || CSS.white }));
}
function chapter(num, title, t, t0, t1) {
  if (t < t0 || t > t1) return; const a = fadeIO(t, t0, t1, 0.2, 0.3);
  g.fillStyle = `rgba(2,4,10,${0.82 * a})`; g.fillRect(0, 0, W * DPR, H * DPR);
  const k = eoutx(seg(t, t0, t0 + 0.5));
  text(String(num).padStart(2, '0'), W / 2, 470, { size: 26, weight: 700, align: 'center', track: 10, color: CSS.cyan, alpha: a, fam: 'Inter' });
  line(W / 2 - 120 * k, 492, W / 2 + 120 * k, 492, CSS.cyan, a, 2);
  text(title, W / 2, 570, { size: 74, weight: 800, align: 'center', alpha: a, glow: 12 });
}
function tag(str, x, y, a, col = CSS.cyan, align = 'left') {
  if (a <= 0) return; g.save(); g.font = F(700, 16, 'Inter'); g.letterSpacing = (3 * DPR) + 'px'; const w = g.measureText(str).width / DPR + 28; g.restore();
  const x0 = align === 'right' ? x - w : x; rect(x0, y, w, 34, 'rgba(4,10,20,0.78)', a, col); text(str, x0 + 14, y + 23, { size: 16, weight: 700, track: 3, alpha: a, fam: 'Inter' });
}
function info(lines, x, y, a, col = CSS.cyan, w = 520) {
  if (a <= 0) return; const h = 26 + lines.length * 34; rect(x, y, w, h, 'rgba(4,10,20,0.8)', a, col); rect(x, y, 4, h, col, a);
  lines.forEach((l, i) => text(l, x + 20, y + 40 + i * 34, { size: i === 0 && lines.length > 1 ? 20 : 22, weight: i === 0 && lines.length > 1 ? 700 : 600, alpha: a, color: i === 0 && lines.length > 1 ? col : CSS.white, fam: 'Inter' }));
}
// cote sur la table (deux points 3D)
function cote(p1, p2, label, a, col = CSS.cyan) {
  if (a <= 0) return; const A = proj(p1), B = proj(p2); if (A.z > 1 || B.z > 1) return;
  const k = eout(a); const mx = lerp(A.x, B.x, k), my = lerp(A.y, B.y, k);
  line(A.x, A.y, mx, my, col, a, 2); dot(A.x, A.y, 4, col, a); if (k > 0.98) dot(B.x, B.y, 4, col, a);
  text(label, (A.x + B.x) / 2, (A.y + B.y) / 2 - 14, { size: 22, weight: 800, align: 'center', color: col, alpha: clamp((a - 0.5) * 2), fam: 'Inter' });
}
function label3(p, str, a, col = CSS.white, size = 18, dy = 0) { if (a <= 0) return; const q = proj(p); if (q.z > 1) return; text(str, q.x, q.y + dy, { size, weight: 800, align: 'center', color: col, alpha: a, fam: 'Inter' }); }

// grille de planification (75 × 50 cases de 40 mm) : cases occupées = obstacles dilatés du rayon du robot (illustration du principe)
const GRIDP = (() => {
  const geo = new THREE.PlaneGeometry(36, 36); geo.rotateX(-Math.PI / 2);
  const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }), 75 * 50);
  const d = new THREE.Object3D(); let k = 0;
  for (let i = 0; i < 75; i++) for (let j = 0; j < 50; j++) { d.position.set(20 + i * 40, 3, 20 + j * 40); d.updateMatrix(); m.setMatrixAt(k, d.matrix); m.setColorAt(k, new THREE.Color(0x0e2a40)); k++; }
  m.renderOrder = 10; m.visible = false; world.add(m); return m;
})();
function gridOccupancy(m, mt, rob = 212, progress = 1) {
  const [i] = idx(m, mt), obs = [];
  for (const id in m.pierres) { const r = m.pierres[id][i]; if (r && (r[0] === 0 || r[0] === 2)) obs.push(r); }
  const col = new THREE.Color(); let k = 0;
  for (let a = 0; a < 75; a++) for (let b = 0; b < 50; b++) {
    const x = 20 + a * 40, y = 20 + b * 40; let occ = x < rob || x > 3000 - rob || y < rob || y > 2000 - rob;
    if (!occ) for (const r of obs) { const ang = r[8] * Math.PI / 180, dx = x - r[2], dy = y - r[3], u = Math.abs(dx * Math.cos(ang) + dy * Math.sin(ang)), v = Math.abs(-dx * Math.sin(ang) + dy * Math.cos(ang)); if (u < r[6] + rob && v < r[7] + rob) { occ = true; break; } }
    const show = (a + b * 0.6) / 105 < progress;
    col.set(!show ? 0x000000 : occ ? 0x7a1e2a : 0x0e3550); GRIDP.setColorAt(k++, col);
  }
  GRIDP.instanceColor.needsUpdate = true;
}
// trajet réel (trace) d'un robot entre deux instants
const PATHPTS = [];
const PATH = (() => { const l = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 2001), 3)), new THREE.LineBasicMaterial({ color: 0xf2b705, transparent: true, opacity: 1 })); l.visible = false; world.add(l); return l; })();
function setPath(m, team, t0, t1, cut) {
  const pa = PATH.geometry.attributes.position.array; let n = 0;
  PATHPTS.length = 0; for (let t = t0; t <= Math.min(t1, cut) + 1e-6; t += m.dt) { const p = robotPose(m, team, t); pa.set([p.x, 18, p.y], n * 3); PATHPTS.push(p); n++; }
  PATH.geometry.setDrawRange(0, n); PATH.geometry.attributes.position.needsUpdate = true;
}
// demi-disque « lidar » devant un robot (règle du simulateur : adversaire à moins de 400 mm devant → attente)
const LIDAR = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.CircleGeometry(400 + 212, 48, -Math.PI / 2, Math.PI), new THREE.MeshBasicMaterial({ color: 0xff5a6a, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.renderOrder = 10; m.visible = false; world.add(m); return m; });

// barres des 130 sorties (hauteurs = illustration) avec masque réel
function outputBars(x0, y0, w, h, o, a) {
  if (a <= 0) return; const n = 130, bw = w / n, r = rng(o.seed || 5);
  rect(x0 - 20, y0 - h - 60, w + 40, h + 120, 'rgba(4,10,20,0.75)', a, 'rgba(56,225,255,0.35)');
  let k = 0;
  FAMS.forEach(([f, c], fi) => {
    for (let i = 0; i < c; i++, k++) {
      const masked = o.mask && !o.mask[k], hv = (o.flat ? 0.45 + 0.1 * r() : 0.15 + 0.6 * r()) * (k === o.win ? 1.6 : 1);
      const hh = h * clamp(hv) * eout(clamp(a * 1.4 - k / n * 0.4)), col = k === o.win && o.showWin ? '#ffd84d' : masked && o.maskOn ? '#3a1a22' : GCOL[fi % GCOL.length];
      rect(x0 + k * bw + 1, y0 - hh, Math.max(1, bw - 2), hh, col, a * (masked && o.maskOn ? 0.6 : 0.95));
    }
  });
  if (o.cursor != null) { const cx = x0 + (o.cursor + 0.5) * bw; line(cx, y0 + 8, cx, y0 - h - 10, '#ffffff', a, 2); }
}
// colonne des 56 entrées (valeurs réelles)
function inputColumn(x0, y0, obs, a, hi = -1) {
  if (a <= 0) return; let y = y0, i = 0;
  rect(x0 - 20, y0 - 56, 440, 10 * 40 + 76, 'rgba(4,10,20,0.85)', a, 'rgba(56,225,255,0.5)');
  text('56 ENTRÉES (VALEURS RÉELLES)', x0, y0 - 20, { size: 18, weight: 800, track: 4, color: CSS.cyan, alpha: a, fam: 'Inter' });
  GROUPS.forEach(([id, name, n], gi) => {
    const ga = a * (hi < 0 || hi === gi ? 1 : 0.3);
    text(name, x0, y + 20, { size: 18, weight: 700, color: GCOL[gi], alpha: ga, fam: 'Inter' });
    for (let j = 0; j < n; j++, i++) { const v = clamp(Math.abs(obs[i])); rect(x0 + 238 + j * 15, y + 2, 12, 24, '#0d1a2a', ga); rect(x0 + 238 + j * 15, y + 2 + 24 * (1 - v), 12, 24 * v, GCOL[gi], ga); }
    y += 40;
  });
}
function timelineBar(x0, y0, w, items, a, now) {
  if (a <= 0) return; line(x0, y0, x0 + w, y0, CSS.dim, a, 2);
  items.forEach((it, i) => { const x = x0 + w * it.u, k = clamp((a - i * 0.08) * 1.6), done = it.done;
    g.save(); g.globalAlpha = k; g.fillStyle = done ? CSS.cyan : '#0b1220'; g.strokeStyle = done ? CSS.cyan : CSS.dim; g.lineWidth = 2 * DPR; g.beginPath(); g.arc(x * DPR, y0 * DPR, 9 * DPR, 0, Math.PI * 2); g.fill(); g.stroke(); g.restore();
    text(it.date, x, y0 - 26, { size: 18, weight: 800, align: 'center', alpha: k, color: done ? CSS.cyan : CSS.white, fam: 'Inter' });
    (it.lines || []).forEach((l, j) => text(l, x, y0 + 40 + j * 24, { size: 16, weight: 500, align: 'center', alpha: k, color: done ? CSS.white : CSS.dim, fam: 'Inter' }));
  });
}

// trajet épais dessiné dans le HUD (les lignes WebGL font 1 px)
function drawPath(a, col = '#f2b705') {
  if (a <= 0 || PATHPTS.length < 2) return; g.save(); g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = 5 * DPR; g.lineJoin = 'round'; g.shadowColor = col; g.shadowBlur = 10 * DPR; g.beginPath();
  PATHPTS.forEach((p, i) => { const q = proj(tab(p.x, p.y, 20)); if (i) g.lineTo(q.x * DPR, q.y * DPR); else g.moveTo(q.x * DPR, q.y * DPR); }); g.stroke(); g.restore();
}
