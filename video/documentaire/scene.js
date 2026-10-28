// ICAM LOT — vidéo 30 s « la plus grande techno prévue sur le robot ».
// Rendu déterministe image par image : window.renderFrame(t) dessine l'instant t (s).
// Unités 3D : mm. Repère : X = x table, Z = y table, Y = hauteur.
import * as THREE from './node_modules/three/build/three.module.js';

const P = new URLSearchParams(location.search);
const DPR = parseFloat(P.get('dpr') || '2');
const W = 1920, H = 1080;

const SPEC = await (await fetch('spec.json')).json();
const MESH = await (await fetch('meshes.json')).json();

// ------------------------------------------------------------------ outils
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const eio = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
const eout = k => 1 - Math.pow(1 - k, 3);
const eoutx = k => k >= 1 ? 1 : 1 - Math.pow(2, -10 * k);
const eback = k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
const fadeIO = (t, a, b, fi = 0.35, fo = 0.35) => Math.min(seg(t, a, a + fi), 1 - seg(t, b - fo, b));
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const tab = (x, y, h = 0) => V(x, h, y);            // point table (x, y, hauteur)

const C = {
  bg: 0x03050a, cyan: 0x38e1ff, yellow: 0xf2b705, blue: 0x3a7bff,
  stone: 0xc8a77a, metal: 0x9aa3ad, nacelle: 0x2f7fc1, canon: 0xc0392b, asc: 0x2e9e44, graal: 0xe2a72e, ball: 0xf5d33b,
};
const CSS = { cyan: '#38e1ff', yellow: '#f2b705', blue: '#5b93ff', white: '#f4f7fb', dim: '#8ea3b8', red: '#ff5a6a' };

// ------------------------------------------------------------------ rendu
const glc = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(DPR); renderer.setSize(W, H, false);
glc.style.width = W + 'px'; glc.style.height = H + 'px';
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;

const hud = document.getElementById('hud');
hud.width = W * DPR; hud.height = H * DPR;
const g = hud.getContext('2d');

const camera = new THREE.PerspectiveCamera(40, W / H, 5, 60000);
const world = new THREE.Scene(); world.background = new THREE.Color(C.bg); world.fog = new THREE.Fog(C.bg, 6000, 26000);
const netScene = new THREE.Scene(); netScene.background = new THREE.Color(0x02040a); netScene.fog = new THREE.Fog(0x02040a, 2500, 7000);
const voidScene = new THREE.Scene(); voidScene.background = new THREE.Color(0x02030a);

// lumières du monde
world.add(new THREE.HemisphereLight(0xd6e2f2, 0x161a22, 0.8));
const fill = new THREE.DirectionalLight(0xfff1dc, 0.9); fill.position.set(1300, 1400, 3400); fill.target.position.set(1300, 0, 500); world.add(fill, fill.target);
const key = new THREE.DirectionalLight(0xffffff, 2.4);
key.position.set(1200, 3200, -600); key.target.position.set(1500, 0, 1000);
key.castShadow = true; key.shadow.mapSize.set(4096, 4096);
Object.assign(key.shadow.camera, { left: -1900, right: 1900, top: 1500, bottom: -1500, near: 500, far: 7000 });
key.shadow.bias = -0.0004; key.shadow.normalBias = 1.5;
world.add(key, key.target);
const rim = new THREE.DirectionalLight(0x9fdcff, 0.55); rim.position.set(3500, 900, 2600); world.add(rim);
const warm = new THREE.PointLight(0xffb347, 1.2, 2200, 1.2); warm.position.set(300, 700, 1000); world.add(warm);

// ------------------------------------------------------------------ table
function tableTexture() {
  const cv = document.createElement('canvas'); cv.width = 3000; cv.height = 2000;
  const c = cv.getContext('2d');
  c.fillStyle = '#0a1422'; c.fillRect(0, 0, 3000, 2000);
  for (let x = 0; x <= 3000; x += 100) { c.strokeStyle = x % 500 ? 'rgba(56,225,255,0.10)' : 'rgba(56,225,255,0.28)'; c.lineWidth = x % 500 ? 2 : 4; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 2000); c.stroke(); }
  for (let y = 0; y <= 2000; y += 100) { c.strokeStyle = y % 500 ? 'rgba(56,225,255,0.10)' : 'rgba(56,225,255,0.28)'; c.lineWidth = y % 500 ? 2 : 4; c.beginPath(); c.moveTo(0, y); c.lineTo(3000, y); c.stroke(); }
  const team = (col, mirror) => {
    const mx = x => mirror ? 3000 - x : x;
    c.fillStyle = col + '33'; c.strokeStyle = col; c.lineWidth = 8;
    c.fillRect(mirror ? 2500 : 0, 750, 500, 500); c.strokeRect(mirror ? 2500 : 0, 750, 500, 500);
    for (const m of SPEC.murs) {
      c.save(); c.translate(mx(m.c[0]), m.c[1]); c.rotate((mirror ? -1 : 1) * m.grand_axe_deg * Math.PI / 180);
      c.fillStyle = col + '22'; c.fillRect(-200, -100, 400, 200); c.strokeRect(-200, -100, 400, 200); c.restore();
    }
    for (const tw of SPEC.tours) { c.beginPath(); c.arc(mx(tw.c[0]), tw.c[1], 100, 0, Math.PI * 2); c.fillStyle = col + '22'; c.fill(); c.stroke(); }
    for (const z of SPEC.pami[mirror ? 'bleu' : 'jaune']) { c.setLineDash([20, 14]); c.strokeRect(z.x[0], z.y[0], z.x[1] - z.x[0], z.y[1] - z.y[0]); c.setLineDash([]); }
  };
  team('#f2b705', false); team('#3a7bff', true);
  c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 4;
  for (const p of SPEC.carrieres) { const lx = p.axe_long === 'x'; c.strokeRect(p.c[0] - (lx ? 160 : 55), p.c[1] - (lx ? 55 : 160), lx ? 320 : 110, lx ? 110 : 320); }
  const r = rng(7);
  for (const a of SPEC.aruco) {
    c.fillStyle = '#fff'; c.fillRect(a[0] - 60, a[1] - 60, 120, 120); c.fillStyle = '#000'; c.fillRect(a[0] - 50, a[1] - 50, 100, 100);
    c.fillStyle = '#fff'; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (r() > 0.5) c.fillRect(a[0] - 34 + i * 17, a[1] - 34 + j * 17, 17, 17);
  }
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
  return tx;
}
const TABLE_TX = tableTexture();
const table = new THREE.Group(); world.add(table);
const topMat = new THREE.MeshStandardMaterial({ map: TABLE_TX, roughness: 0.85, metalness: 0.0, transparent: true });
const top = new THREE.Mesh(new THREE.PlaneGeometry(3000, 2000), topMat);
top.rotation.x = -Math.PI / 2; top.position.set(1500, 0, 1000); top.receiveShadow = true; table.add(top);
const base = new THREE.Mesh(new THREE.BoxGeometry(3044, 40, 2044), new THREE.MeshStandardMaterial({ color: 0x0b0f17, roughness: 0.9 }));
base.position.set(1500, -21, 1000); table.add(base);
const borderMat = new THREE.MeshStandardMaterial({ color: 0x1a2433, roughness: 0.6, metalness: 0.3, emissive: 0x0a3a4a, emissiveIntensity: 0.6 });
const borders = [];
for (const [x, y, w, d] of [[1500, -11, 3044, 22], [1500, 2011, 3044, 22], [-11, 1000, 22, 2000], [3011, 1000, 22, 2000]]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 70, d), borderMat); m.position.set(x, 35, y); m.castShadow = m.receiveShadow = true;
  table.add(m); borders.push(m);
}
// lignes lumineuses du contour et des remparts (tracé progressif)
function polyLine(points, color, opacity = 1) {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  l.userData.n = points.length; return l;
}
const glowLines = [];
{
  const h = 72;
  glowLines.push(polyLine([tab(0, 0, h), tab(3000, 0, h), tab(3000, 2000, h), tab(0, 2000, h), tab(0, 0, h)], C.cyan));
  const team = (col, mirror) => {
    const mx = x => mirror ? 3000 - x : x;
    const ring = (cx, cy, r) => { const p = []; for (let i = 0; i <= 48; i++) { const a = i / 48 * Math.PI * 2; p.push(tab(cx + r * Math.cos(a), cy + r * Math.sin(a), 2)); } return p; };
    for (const tw of SPEC.tours) glowLines.push(polyLine(ring(mx(tw.c[0]), tw.c[1], 100), col));
    for (const m of SPEC.murs) {
      const a = (mirror ? -1 : 1) * m.grand_axe_deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      const pts = [[-200, -100], [200, -100], [200, 100], [-200, 100], [-200, -100]].map(([u, v]) => tab(mx(m.c[0]) + u * ca - v * sa, m.c[1] + u * sa + v * ca, 2));
      glowLines.push(polyLine(pts, col));
    }
    const x0 = mirror ? 2500 : 0;
    glowLines.push(polyLine([tab(x0, 750, 2), tab(x0 + 500, 750, 2), tab(x0 + 500, 1250, 2), tab(x0, 1250, 2), tab(x0, 750, 2)], col));
  };
  team(C.yellow, false); team(C.blue, true);
  glowLines.forEach(l => table.add(l));
}
// pierres : 10 carrières × 3 pierres à plat
const stoneGeo = new THREE.BoxGeometry(320, 110, 110);
const stoneMat = new THREE.MeshStandardMaterial({ color: C.stone, roughness: 0.75, metalness: 0.0 });
const tagTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 64, 64); c.fillStyle = '#000'; c.fillRect(6, 6, 52, 52); c.fillStyle = '#fff'; const r = rng(13); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (r() > 0.5) c.fillRect(14 + i * 9, 14 + j * 9, 9, 9); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const tagMat = new THREE.MeshBasicMaterial({ map: tagTex });
const stoneMatP9 = stoneMat.clone(); stoneMatP9.transparent = true;
const xrayEdge = new THREE.LineBasicMaterial({ color: C.cyan, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const stones = [];
for (const [pi, p] of SPEC.carrieres.entries()) {
  for (let k = 0; k < 3; k++) {
    const s = new THREE.Group();
    const m = new THREE.Mesh(stoneGeo, p.id === 'P9' ? stoneMatP9 : stoneMat); m.castShadow = m.receiveShadow = true; s.add(m);
    if (p.id === 'P9') { const e = new THREE.LineSegments(new THREE.EdgesGeometry(stoneGeo), xrayEdge); s.add(e); }
    const tg = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), tagMat); tg.rotation.x = -Math.PI / 2; tg.position.y = 55.5; s.add(tg);
    if (p.axe_long === 'y') s.rotation.y = Math.PI / 2;
    s.userData = { pack: p.id, k, x: p.c[0], y: p.c[1], h: 55 + 110 * k, delay: pi * 0.09 + k * 0.05 };
    table.add(s); stones.push(s);
  }
}

// ------------------------------------------------------------------ robot (châssis mesuré + modules de principe)
function meshFromTris(arr, mat, faceDeg) {
  const geo = new THREE.BufferGeometry();
  const a = new Float32Array(arr.length), f = faceDeg * Math.PI / 180, cf = Math.cos(f), sf = Math.sin(f);
  for (let i = 0; i < arr.length; i += 3) {             // module (x normale, y droite, z haut) -> robot (rx, ry) -> three (X=rx, Y=z, Z=ry)
    const x = arr[i], y = arr[i + 1], z = arr[i + 2];
    a[i] = x * cf - y * sf; a[i + 1] = z; a[i + 2] = x * sf + y * cf;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(a, 3)); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; return m;
}
const FACE_DEG = { A: 0, B: 120, C: 240 };
const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
function mat(color, o = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.5, metalness: 0.15, clippingPlanes: [clipPlane] }, o)); }
const TOIT = SPEC.toit;                                        // 311,2 mm (tubes de 290 mm, retenu par l'équipe)
function makeRobot() {
  const R = new THREE.Group();
  const body = new THREE.Group(); R.add(body);
  const plateShape = sc => new THREE.Shape(SPEC.top.map(([x, y]) => new THREE.Vector2(x * sc, y * sc)));
  const plateMat = mat(0xa7b0bb, { metalness: 0.2, roughness: 0.35, transparent: true, opacity: 1 });
  const mk = (sc, y0) => { const gm = new THREE.ExtrudeGeometry(plateShape(sc), { depth: 5, bevelEnabled: false }); gm.rotateX(Math.PI / 2); const m = new THREE.Mesh(gm, plateMat); m.position.y = y0; m.castShadow = m.receiveShadow = true; return m; };
  const roof = mk(1, TOIT); body.add(mk(162 / 171.5, 15.3), roof);
  R.userData.roof = roof; R.userData.plateMat = plateMat;
  const tubeMat = mat(0x8a939e, { metalness: 0.25, roughness: 0.35 });
  for (const [x, y] of SPEC.top) {
    const n = Math.hypot(x, y), k = (n - 16) / n;
    const m = new THREE.Mesh(new THREE.BoxGeometry(20, TOIT - 20, 20), tubeMat); m.position.set(x * k, 15 + (TOIT - 20) / 2, y * k); m.castShadow = true; body.add(m);
  }
  // 3 roues omnidirectionnelles Ø 60 à 192 mm, à 60°/180°/300°
  const wheelMat = mat(0x3a3f47, { metalness: 0.8, roughness: 0.3 }), rollMat = mat(0x22262c, { roughness: 0.8, metalness: 0.1 }), motMat = mat(0x55606b, { metalness: 0.8 });
  for (const ad of SPEC.wheels.angles_deg_repere_robot) {
    const a = ad * Math.PI / 180, wg = new THREE.Group();
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 26, 24), wheelMat); hub.rotation.z = Math.PI / 2; wg.add(hub);
    for (let i = 0; i < 12; i++) {
      const b = i / 12 * Math.PI * 2, r = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 13, 10), rollMat);
      r.position.set((i % 2 ? 6 : -6), 26 * Math.sin(b), 26 * Math.cos(b)); r.rotation.x = b; wg.add(r);
    }
    const mo = new THREE.Mesh(new THREE.CylinderGeometry(18.5, 18.5, 70, 20), motMat); mo.rotation.z = Math.PI / 2; mo.position.x = -52; wg.add(mo);
    wg.position.set(192 * Math.cos(a), 30, 192 * Math.sin(a)); wg.rotation.y = -a; wg.traverse(o => { if (o.isMesh) o.castShadow = true; });
    body.add(wg);
  }
  // support de balise centré (règlement général G.2, mât déclaré centré)
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(35, 35, 430 - TOIT, 24), mat(0x7a8592, { metalness: 0.2, roughness: 0.4 })); mast.position.y = TOIT + (430 - TOIT) / 2; body.add(mast); R.userData.mast = mast;
  // nacelles A et B (fixe / chariot / tournant)
  const nMat = mat(C.nacelle), fMat = mat(0x4b5563), suckMat = mat(0x1d4f7a, { emissive: 0x38e1ff, emissiveIntensity: 0 });
  const nac = {};
  for (const f of ['A', 'B']) {
    const grp = new THREE.Group(); body.add(grp);
    grp.add(meshFromTris(MESH.nacelle_fixe, fMat, FACE_DEG[f]));
    const mob = new THREE.Group(); grp.add(mob);
    mob.add(meshFromTris(MESH.nacelle_mobile, fMat, FACE_DEG[f]));
    mob.add(meshFromTris(MESH.nacelle_tour, f === 'A' ? suckMat : nMat, FACE_DEG[f]));
    nac[f] = { grp, mob };
  }
  R.userData.nac = nac; R.userData.suckMat = suckMat;
  // face C : canon, chargeur + 10 boulets, ascenseur
  body.add(meshFromTris(MESH.canon_lanceur, mat(C.canon), FACE_DEG.C), meshFromTris(MESH.canon_tube, mat(C.canon), FACE_DEG.C));
  body.add(meshFromTris(MESH.chargeur, mat(0xffe9a8, { transparent: true, opacity: 0.18, depthWrite: false }), FACE_DEG.C));
  body.add(meshFromTris(MESH.boulets, mat(C.ball, { emissive: 0x6b5200, emissiveIntensity: 0.4 }), FACE_DEG.C));
  body.add(meshFromTris(MESH.asc_fixe, mat(C.asc), FACE_DEG.C), meshFromTris(MESH.asc_mob, mat(C.asc), FACE_DEG.C));
  return R;
}
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


// ------------------------------------------------------------------ notre robot : volume extérieur net, sans aucun mécanisme
// Enveloppe = plaque haute mesurée (spec/robot.json, polygone_repere_robot) extrudée du sol au toit ; roues omni aux coins ; mât de balise.
function makeHull() {
  const R = new THREE.Group();
  const shape = new THREE.Shape(SPEC.top.map(([x, y]) => new THREE.Vector2(x, y)));
  const H0 = 18, H1 = TOIT + 5;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: H1 - H0, bevelEnabled: true, bevelThickness: 4, bevelSize: 4, bevelSegments: 2 });
  geo.rotateX(Math.PI / 2); geo.translate(0, H1, 0);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fc6e2, roughness: 0.28, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.2, transparent: true, opacity: 0.96, emissive: 0x0a2a44, emissiveIntensity: 0.45 });
  const body = new THREE.Mesh(geo, glass); body.castShadow = body.receiveShadow = true; R.add(body);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: 0x38e1ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }));
  R.add(edges);
  // bandeau lumineux à mi-hauteur (signature visuelle, pas un composant)
  const ring = new THREE.Shape(SPEC.top.map(([x, y]) => new THREE.Vector2(x * 1.08, y * 1.08)));
  ring.holes.push(new THREE.Path(SPEC.top.slice().reverse().map(([x, y]) => new THREE.Vector2(x * 1.0, y * 1.0))));
  const band = new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: 10, bevelEnabled: false }),
    new THREE.MeshBasicMaterial({ color: 0xf2b705, side: THREE.DoubleSide }));
  band.geometry.rotateX(Math.PI / 2); band.position.y = 120; R.add(band);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.7, roughness: 0.3 }), rollMat = new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.8 });
  const wheels = [];
  for (const ad of SPEC.wheels.angles_deg_repere_robot) {
    const a = ad * Math.PI / 180, wg = new THREE.Group(), spin = new THREE.Group(); wg.add(spin);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 26, 24), wheelMat); hub.rotation.z = Math.PI / 2; spin.add(hub);
    for (let i = 0; i < 12; i++) { const b = i / 12 * Math.PI * 2, r = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 13, 10), rollMat); r.position.set((i % 2 ? 6 : -6), 26 * Math.sin(b), 26 * Math.cos(b)); r.rotation.x = b; spin.add(r); }
    wg.position.set(192 * Math.cos(a), 30, 192 * Math.sin(a)); wg.rotation.y = -a; wg.traverse(o => { if (o.isMesh) o.castShadow = true; });
    R.add(wg); wheels.push(spin);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(35, 35, 430 - H1, 24), new THREE.MeshStandardMaterial({ color: 0x8a96a3, metalness: 0.3, roughness: 0.35 }));
  mast.position.y = H1 + (430 - H1) / 2; mast.castShadow = true; R.add(mast);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 8, 24), new THREE.MeshBasicMaterial({ color: 0x38e1ff })); cap.position.y = 432; R.add(cap);
  // tampon « confidentiel » sur le toit
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const c = cv.getContext('2d');
  c.strokeStyle = '#ff4d5e'; c.lineWidth = 10; c.strokeRect(8, 8, 496, 112); c.fillStyle = '#ff4d5e'; c.font = '800 54px Inter, sans-serif'; c.textAlign = 'center'; c.fillText('CONFIDENTIEL', 256, 84);
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(200, 50), new THREE.MeshBasicMaterial({ map: tx, transparent: true }));
  lab.rotation.x = -Math.PI / 2; lab.rotation.z = Math.PI / 2; lab.position.set(75, H1 + 6, 0); R.add(lab);
  R.userData = { glass, edges, band, wheels, label: lab };
  return R;
}

// ------------------------------------------------------------------ match réel rejoué (moteur de référence, programme écrit à la main)
function placeRobot(obj, x, y, thDeg) { obj.position.set(x, 0, y); obj.rotation.y = -thDeg * Math.PI / 180; }
const MATCH = { solo: await (await fetch('mref_solo.json')).json(), duel: await (await fetch('mref.json')).json() };
const hullY = makeHull(); world.add(hullY);
const hullB = makeHull(); hullB.userData.band.material = new THREE.MeshBasicMaterial({ color: 0x3a7bff, side: THREE.DoubleSide }); world.add(hullB);
function goblet() {
  const g = new THREE.Group(), gold = new THREE.MeshStandardMaterial({ color: 0xe2a72e, metalness: 0.85, roughness: 0.25, emissive: 0x3a2500, emissiveIntensity: 0.3 });
  const b = new THREE.Mesh(new THREE.CylinderGeometry(28, 31, 26, 32), gold); b.position.y = 13; g.add(b);
  const s = new THREE.Mesh(new THREE.CylinderGeometry(10, 14, 30, 24), gold); s.position.y = 41; g.add(s);
  const c = new THREE.Mesh(new THREE.CylinderGeometry(31, 12, 44, 32, 1, true), gold); c.position.y = 78; g.add(c);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material.side = THREE.DoubleSide; } });
  return g;
}
const graalY = goblet(); world.add(graalY);
const balls = Array.from({ length: 10 }, () => { const m = new THREE.Mesh(new THREE.SphereGeometry(22.5, 20, 14), new THREE.MeshStandardMaterial({ color: 0xf5d33b, roughness: 0.6, emissive: 0x4a3a00, emissiveIntensity: 0.3 })); m.castShadow = true; world.add(m); return m; });
const STONE_BY_ID = {}; for (const s of stones) STONE_BY_ID[s.userData.pack + '.' + (s.userData.k + 1)] = s;
function idx(m, mt) { const f = clamp(mt / m.dt, 0, 2000), i = Math.min(Math.floor(f), 1999); return [i, f - i]; }
const angLerp = (a, b, k) => { let d = b - a; while (d > 180) d -= 360; while (d < -180) d += 360; return a + d * k; };
function robotPose(m, team, mt) {
  const arr = m.robots[team]; if (!arr) return null; const [i, k] = idx(m, mt), A = arr[i], B = arr[Math.min(i + 1, arr.length - 1)];
  return { x: lerp(A[0], B[0], k), y: lerp(A[1], B[1], k), h: angLerp(A[2], B[2], k) };
}
function scoreAt(m, team, mt) { const arr = m.score[team]; return arr ? arr[idx(m, mt)[0]] : null; }
// pierre : [état 0 départ 1 tenue 2 posée 3 retirée, qui, cx, cy, z_bas, z_haut, hl, hn, ang, th]
function placeStones(m, mt, visible = true) {
  const [i, k] = idx(m, mt);
  for (const id in STONE_BY_ID) {
    const s = STONE_BY_ID[id], arr = m.pierres[id]; if (!arr) continue;
    let A = arr[i], B = arr[Math.min(i + 1, arr.length - 1)];
    if (!A || A[0] === 3) { s.visible = false; continue; }
    const kk = (B && B[0] === A[0]) ? k : 0; if (!B || B[0] !== A[0]) B = A;
    s.visible = visible; s.scale.set(1, 1, 1);
    s.position.set(lerp(A[2], B[2], kk), (lerp(A[4], B[4], kk) + lerp(A[5], B[5], kk)) / 2, lerp(A[3], B[3], kk));
    s.rotation.set(0, -angLerp(A[8], B[8], kk) * Math.PI / 180, -lerp(A[9], B[9], kk) * Math.PI / 180);
  }
}
function placeMatch(m, mt, o = {}) {
  const py = robotPose(m, 'jaune', mt); placeRobot(hullY, py.x, py.y, py.h); hullY.visible = o.robots !== false;
  const pb = robotPose(m, 'bleu', mt); hullB.visible = !!pb && o.robots !== false; if (pb) placeRobot(hullB, pb.x, pb.y, pb.h);
  placeStones(m, mt, o.stones !== false);
  const g = m.graal.jaune[idx(m, mt)[0]]; graalY.visible = g[0] !== 'ascenseur' && o.graal !== false;   // ascenseur : mécanisme confidentiel, non montré
  graalY.position.set(g[1], g[4], g[2]); graalY.rotation.y = -g[3] * Math.PI / 180;
  const b = (m.boulets.jaune || [])[idx(m, mt)[0]];
  balls.forEach((s, j) => { const p = b && b[j]; s.visible = !!p; if (p) s.position.set(p[0], p[2], p[1]); });
  return { py, pb };
}

// ------------------------------------------------------------------ réseau de neurones : structure réelle (56 → 128 → GRU 128 → 130), valeurs d'entrée réelles
// Aucun cerveau entraîné n'existe sur le moteur actuel : les activations internes et les notes de sortie sont des ILLUSTRATIONS (signalées à l'écran).
const OBS = await (await fetch('obs_reference.json')).json();          // entrées calculées par ENV.observe pendant le programme de référence
const GROUPS = [
  ['temps', 'Temps restant', 1], ['robot', 'Position et cap', 4], ['paquets', 'Carrières P1 à P10', 10], ['faces', 'Charge des pinces', 6],
  ['constructions', 'Murs et tours', 9], ['graal', 'Graal', 4], ['boulets', 'Boulets', 1], ['adversaire', 'Adversaire (lidar)', 2],
  ['proprioception', 'État interne', 11], ['spatial', 'Espace libre (8 directions)', 8]];
const GCOL = ['#38e1ff', '#7cf3c0', '#f2b705', '#2f9bff', '#ff8a3d', '#e2a72e', '#ffd84d', '#5b93ff', '#b58cff', '#fff1a8'];
const FAMS = [['prendre', 20], ['mur', 20], ['tour', 24], ['porte', 20], ['boulets', 1], ['poserGraal', 18], ['trone', 1], ['staging', 6], ['repickup', 6], ['traj', 8], ['tournerPince', 2], ['deposerZone', 2], ['prendreGraal', 2]];
const net = { layers: [] };
{
  const inPos = []; let y = 0;
  GROUPS.forEach(([, , n], gi) => { for (let i = 0; i < n; i++) { inPos.push({ p: V(-1500, 0, 0), g: gi, yy: y }); y += 26; } y += 34; });
  const h0 = y - 34; inPos.forEach(o => o.p.y = h0 / 2 - o.yy);
  const enc = []; for (let i = 0; i < 128; i++) { const row = Math.floor(i / 8), col = i % 8; enc.push({ p: V(-600, (7.5 - row) * 52, (col - 3.5) * 52) }); }
  const gru = []; for (let i = 0; i < 128; i++) { const a = i / 128 * Math.PI * 2; gru.push({ p: V(300 + 60 * Math.sin(a * 4), 330 * Math.cos(a), 330 * Math.sin(a)) }); }
  const out = []; let k = 0; FAMS.forEach(([, n], fi) => { for (let i = 0; i < n; i++, k++) out.push({ p: V(1300, (6 - Math.floor(k / 10)) * 58, ((k % 10) - 4.5) * 58), f: fi }); });
  net.layers = [inPos, enc, gru, out];
  const sph = new THREE.SphereGeometry(1, 14, 10);
  for (const L of net.layers) for (const o of L) { o.m = new THREE.Mesh(sph, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })); o.m.position.copy(o.p); netScene.add(o.m); }
  const mk = (A, B, n, seed, col) => {
    const r = rng(seed), p = [], c = [], cc = new THREE.Color(col);
    for (let i = 0; i < n; i++) { const a = A[Math.floor(r() * A.length)].p, b = B[Math.floor(r() * B.length)].p, k = 0.35 + 0.65 * r(); p.push(a.x, a.y, a.z, b.x, b.y, b.z); c.push(cc.r * k, cc.g * k, cc.b * k, cc.r * k, cc.g * k, cc.b * k); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    l.userData.n = n; netScene.add(l); return l;
  };
  net.links = [mk(inPos, enc, 1400, 1, 0x38e1ff), mk(enc, gru, 1400, 2, 0x58f0d0), mk(gru, out, 1400, 3, 0xb9c8d8)];
  net.loop = new THREE.Mesh(new THREE.TorusGeometry(330, 3, 8, 128), new THREE.MeshBasicMaterial({ color: 0x7cf3c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending }));
  net.loop.rotation.y = Math.PI / 2; net.loop.position.x = 300; netScene.add(net.loop);
  const NP = 900, geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NP * 3), 3));
  net.pulses = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); netScene.add(net.pulses);
}
// o : { appear (0..1 par couche), inputs (valeurs réelles 56), mask (130 booléens réels ou null), win (index ou -1), flow (0..1), memory (0..1) }
function netState(t, o) {
  const [inp, enc, gru, out] = net.layers, ap = o.appear || [1, 1, 1, 1];
  inp.forEach((n, i) => { const v = o.inputs ? clamp(Math.abs(o.inputs[i])) : 0.4, a = eback(clamp(ap[0] * 1.3 - i / 56 * 0.3));
    n.m.material.color.set(GCOL[n.g]); n.m.material.opacity = clamp(ap[0] * 1.5) * (0.35 + 0.65 * v); n.m.scale.setScalar(Math.max(0.001, a) * (7 + 7 * v)); });
  const r = rng(Math.floor(t * 6) + 11);
  enc.forEach(n => { const v = 0.3 + 0.7 * r() * (o.flow || 0); n.m.material.color.set(0x38e1ff); n.m.material.opacity = clamp(ap[1]) * (0.3 + 0.7 * v); n.m.scale.setScalar(Math.max(0.001, eback(clamp(ap[1]))) * (6 + 6 * v)); });
  gru.forEach((n, i) => { const v = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(i * 0.37 + t * 3 * (o.memory || 0))); n.m.material.color.set(i % 2 ? 0x7cf3c0 : 0xff4fa3); n.m.material.opacity = clamp(ap[2]) * (0.3 + 0.7 * v); n.m.scale.setScalar(Math.max(0.001, eback(clamp(ap[2]))) * (6 + 5 * v)); });
  out.forEach((n, i) => { const masked = o.mask && !o.mask[i], win = i === o.win;
    n.m.material.color.set(win ? 0xffd84d : masked ? 0x5a1620 : 0xdfe8f2); n.m.material.opacity = clamp(ap[3]) * (masked ? 0.35 : win ? 1 : 0.8);
    n.m.scale.setScalar(Math.max(0.001, eback(clamp(ap[3]))) * (win ? 20 + 3 * Math.sin(t * 9) : 8)); });
  net.links.forEach((l, i) => { const k = clamp(ap[i + 1] * 1.2); l.material.opacity = 0.13 * k; l.geometry.setDrawRange(0, Math.round(l.userData.n * 2 * eout(k))); });
  net.loop.material.opacity = 0.6 * clamp(ap[2]) * (0.4 + 0.6 * (o.memory || 0)); net.loop.rotation.x = t * 1.5;
  const pa = net.pulses.geometry.attributes.position.array, f = o.flow || 0;
  for (let i = 0; i < 900; i++) {
    const L = i % 3, A = net.layers[L], B = net.layers[L + 1], rr = rng(i * 7 + 3), a = A[Math.floor(rr() * A.length)].p, b = (L === 2 && o.win >= 0 && i % 4 === 0) ? out[o.win].p : B[Math.floor(rr() * B.length)].p;
    const u = ((t * 0.9 + rr()) % 1); if (f <= 0) { pa[i * 3 + 1] = 1e6; continue; }
    const P = a.clone().lerp(b, u); pa.set([P.x, P.y, P.z], i * 3);
  }
  net.pulses.geometry.attributes.position.needsUpdate = true; net.pulses.material.opacity = f;
}

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

// ------------------------------------------------------------------ documentaire « Construire le cerveau d'ICAMLOT » (sans voix off)
// Faits : dossiers et script vérifiés (scratchpad/doc), dépôt audit/simulateur-ia (commit 0161a45), matchs du moteur de référence.
const SOLO = MATCH.solo, DUEL = MATCH.duel, DEC_SOLO = OBS.solo.decisions, DEC_DUEL = OBS.duel.decisions;
const D6 = DEC_DUEL[5];                                       // duel, t = 16,33 s : « Prendre P10 » (P10 déjà pris par l'adversaire)
const T_D6 = 16.326;
// rayons « espace libre » (valeurs réelles de l'entrée spatiale)
const RAYS = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(48), 3)), new THREE.LineBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.95 }));
RAYS.visible = false; world.add(RAYS);
// fantômes de croyance : carrières vides en réalité, pleines pour le robot
const GHOSTS = ['P4', 'P8', 'P10'].map(id => {
  const p = SPEC.carrieres.find(c => c.id === id), geo = new THREE.BoxGeometry(p.axe_long === 'x' ? 320 : 110, 330, p.axe_long === 'x' ? 110 : 320);
  const grp = new THREE.Group(); grp.position.set(p.c[0], 165, p.c[1]);
  grp.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: C.yellow, transparent: true, opacity: 0.12, depthWrite: false })));
  grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: C.yellow, transparent: true, opacity: 1 })));
  grp.visible = false; grp.userData.id = id; world.add(grp); return grp;
});
const lightGold = new THREE.DirectionalLight(0xffc77a, 0); lightGold.position.set(-1200, 900, 2400); lightGold.target.position.set(400, 0, 1000); world.add(lightGold, lightGold.target);

// ------------------------------------------------------------------ plans
const PLANS = [
  ['S01', 4.5], ['S02', 6.0], ['S03', 7.5], ['S04', 5.0], ['S05', 9.0], ['S06', 7.0], ['S07', 5.0],
  ['CH1', 1.4], ['S08', 6.5], ['S09', 4.5], ['S10', 5.5],
  ['CH2', 1.4], ['S11', 7.5], ['S12', 5.5],
  ['CH3', 1.4], ['S13', 7.0], ['S14', 6.5],
  ['CH4', 1.4], ['S15', 6.0], ['S16', 4.5], ['S17', 5.5], ['END', 7.0]];
let acc = 0; const PL = {}; for (const [id, d] of PLANS) { PL[id] = [acc, acc + d]; acc += d; }
const VOIX = await (await fetch('voix_plan.json')).json();
let accN = 0; const PLN = {}; for (const [id, dn] of VOIX.plans) { PLN[id] = [accN, accN + dn]; accN += dn; }
const DUREE = accN; window.DUREE = DUREE;
function cur(t) { for (const [id] of PLANS) if (t < PLN[id][1]) return id; return 'END'; }
let SUBS_OFF = true;   // les anciennes légendes sont remplacées par les sous-titres de la voix
const SUBS = VOIX.lignes.flatMap(l => l.sous_titres).map((c, i, A) => ({ texte: c.texte, a: c.debut - 0.08, b: Math.min(c.fin + 0.3, i + 1 < A.length ? A[i + 1].debut - 0.12 : 1e9) }));
const CHAP = { S01: '', S02: 'LE JEU', S03: 'LE JEU', S04: 'NOTRE ROBOT', S05: 'NOTRE ROBOT', S06: 'NOTRE ROBOT', S07: 'NOTRE OBJECTIF', S08: '1 · RECRÉER LE MONDE', S09: '1 · RECRÉER LE MONDE', S10: '1 · RECRÉER LE MONDE',
  S11: '2 · CE QU\'IL PERÇOIT', S12: '2 · CE QU\'IL PERÇOIT', S13: '3 · LE RÉSEAU', S14: '3 · LE RÉSEAU', S15: '4 · APPRENDRE (PRÉVU)', S16: '4 · APPRENDRE (PRÉVU)', S17: 'OÙ NOUS EN SOMMES', END: '' };

function look(pos, tgt, fov = 40, roll = 0, cam = camera, vw = W, vh = H) {
  cam.position.copy(pos); cam.up.set(0, 1, 0); cam.lookAt(tgt); if (roll) cam.rotateZ(roll);
  cam.fov = fov; cam.aspect = vw / vh; cam.clearViewOffset(); cam.updateProjectionMatrix();
}
function drift(t, a = 1) { return V(Math.sin(t * 0.71) * 14 * a + Math.sin(t * 1.9) * 4 * a, Math.sin(t * 1.13) * 9 * a, Math.cos(t * 0.83) * 14 * a); }
function orbit(cx, cz, r, ang, h) { return V(cx + r * Math.cos(ang), h, cz + r * Math.sin(ang)); }
const netCam = new THREE.PerspectiveCamera(40, W / H, 10, 30000);
function projN(v) { const p = v.clone().project(netCam); return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H, z: p.z }; }
const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');
const fmtMm = v => Math.round(v).toLocaleString('fr-FR').replace(/ | /g, ' ');
function liveScore(m, team, mt) { const s = scoreAt(m, team, Math.min(mt, 100)); return s ? s[0] : 0; }
function setRays(pose, d, k) {
  const pa = RAYS.geometry.attributes.position.array;
  for (let i = 0; i < 8; i++) { const a = (pose.h + i * 45) * Math.PI / 180, L = d[i] * k; pa.set([pose.x, 60, pose.y, pose.x + L * Math.cos(a), 60, pose.y + L * Math.sin(a)], i * 6); }
  RAYS.geometry.attributes.position.needsUpdate = true;
}
function resetWorld() {
  GRIDP.visible = false; PATH.visible = false; LIDAR.forEach(l => l.visible = false); RAYS.visible = false; GHOSTS.forEach(gh => gh.visible = false);
  table.visible = true; topMat.opacity = 1; topMat.transparent = false; lightGold.intensity = 0; borders.forEach(b => { b.scale.y = 1; b.position.y = 35; });
  glowLines.forEach(l => l.geometry.setDrawRange(0, l.userData.n));
}
function renderWorld(cam = camera) { renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.setClearColor(C.bg, 1); renderer.clear(); renderer.render(world, cam); }
function renderNet(full = true) { renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); if (full) { renderer.setClearColor(0x02060d, 1); renderer.clear(); } else renderer.clearDepth(); renderer.render(netScene, netCam); }
renderer.autoClear = false; netScene.background = null;

// ------------------------------------------------------------------ image
function renderFrame(tn) {
  g.clearRect(0, 0, hud.width, hud.height); resetWorld();
  const id = cur(tn), [n0, n1] = PLN[id], [t0, t1] = PL[id], d = t1 - t0, k = (n1 - n0) / d;
  const tl = (tn - n0) / k, t = t0 + tl, q = tl / d;   // temps interne du plan, étiré ou resserré pour suivre la voix
  VP.x0 = 0; VP.w = W;
  const R = SHOTS[id](t, tl, d, q) || {};
  // habillage commun
  if (id !== 'S01' && id !== 'END' && !id.startsWith('CH')) {
    const w1 = text(TEAM.nom, 70, 70, { size: 22, weight: 800, track: 6, alpha: 0.95, fam: 'Inter' });
    text(TEAM.asso, 70 + w1 + 16, 70, { size: 18, weight: 600, track: 4, color: CSS.dim, alpha: 0.95, fam: 'Inter' });
    if (CHAP[id]) text(CHAP[id], W - 70, 70, { size: 18, weight: 700, track: 4, align: 'right', color: CSS.cyan, alpha: 0.95, fam: 'Inter' });
  }
  if (R.bandeau) tag('SIMULATION · PROGRAMME ÉCRIT À LA MAIN (PAS LE RÉSEAU)', 70, 92, R.bandeau, CSS.yellow);
  vignette(0.55);
  // sous-titres = texte exact de la voix off (sauf plans où le texte est déjà affiché en grand)
  if (!['S01', 'S07', 'END'].includes(id)) for (const s of SUBS) { SUBS_OFF = false; caption(s.texte, tn, s.a, s.b, { size: 40 }); SUBS_OFF = true; }
  // transitions : fondu au noir court entre plans
  const fin = 1 - seg(tn, n1 - 0.18, n1), deb = seg(tn, n0, n0 + 0.18);
  if (!id.startsWith('CH')) flash((1 - Math.min(fin, deb)) * 0.9, '2,4,10');
}

// caméra « drone » qui suit un point en douceur
function follow(p, t, r, ang, h, fov = 40) { look(orbit(p.x, p.y, r, ang, h).add(drift(t, 1)), tab(p.x, p.y, 120), fov); }

const SHOTS = {
  // --- ouverture : lumière rasante sur la table, titre
  S01(t, tl, d, q) {
    placeMatch(SOLO, 0); lightGold.intensity = 1.6 * (1 - q * 0.5);
    look(V(lerp(-700, 250, eio(q)), lerp(420, 700, eio(q)), lerp(1000, 1000, q)).add(drift(t, 0.6)), tab(lerp(1300, 1700, q), lerp(1000, 1000, q), 40), 44, lerp(0.05, 0, q));
    renderWorld();
    g.fillStyle = `rgba(2,4,10,${0.55 * (1 - seg(tl, 3.6, 4.5))})`; g.fillRect(0, 0, W * DPR, H * DPR);
    const a = seg(tl, 0.5, 1.2) * (1 - seg(tl, 3.9, 4.4));
    text('EUROBOT 2027 · COUPE DE FRANCE DE ROBOTIQUE', W / 2, 430, { size: 22, weight: 700, track: 8, align: 'center', color: CSS.cyan, alpha: a, fam: 'Inter' });
    glitchTitle('CONSTRUIRE LE CERVEAU', W / 2, 545, 104, seg(tl, 0.9, 1.6) * (1 - seg(tl, 3.9, 4.4)), Math.floor(t * 30));
    glitchTitle('D\'ICAMLOT', W / 2, 660, 104, seg(tl, 1.2, 1.9) * (1 - seg(tl, 3.9, 4.4)), Math.floor(t * 30) + 3, { color: CSS.yellow });
    text('un documentaire de l\'équipe ICAMLOT · ' + TEAM.asso, W / 2, 740, { size: 24, weight: 500, align: 'center', alpha: seg(tl, 1.8, 2.4) * (1 - seg(tl, 3.9, 4.4)), color: CSS.dim, fam: 'Inter' });
    if (tl < 0.5) flash(1 - tl / 0.5, '2,4,10');
    return {};
  },
  // --- le jeu : la table et ses pierres
  S02(t, tl, d, q) {
    placeMatch(SOLO, 0); hullY.visible = false; graalY.visible = true;
    look(orbit(1500, 1000, lerp(2600, 3300, eio(q)), lerp(2.35, 1.75, eio(q)), lerp(900, 2500, eio(q))).add(drift(t, 1.5)), tab(1500, 1000, 0), 44, lerp(0.05, -0.01, q));
    renderWorld();
    cote(tab(0, 2080, 80), tab(3000, 2080, 80), '3 000 mm', seg(tl, 1.0, 2.0));
    cote(tab(3080, 2000, 80), tab(3080, 0, 80), '2 000 mm', seg(tl, 1.6, 2.6));
    const lk = seg(tl, 4.0, 4.5); for (const p of SPEC.carrieres) label3(tab(p.c[0], p.c[1], 420), p.id, lk, CSS.yellow, 18);
    caption('Un match dure 100 secondes. Sur la table : 30 pierres de 320 × 110 × 110 mm, rangées par trois dans 10 carrières.', t, PL.S02[0] + 0.3, PL.S02[1]);
    return {};
  },
  // --- le barème : les constructions finales du match de référence
  S03(t, tl, d, q) {
    placeMatch(SOLO, 100);
    look(orbit(700, 1000, lerp(1900, 1650, eio(q)), lerp(1.2, 0.55, eio(q)), lerp(1500, 1250, q)).add(drift(t, 1)), tab(620, 950, 80), 44);
    renderWorld();
    const it = [
      [tab(679.3, 570.8, 340), 'Mur', '3 pierres à plat · +5 (+1 par pierre)', 2.75, -260, -110, CSS.yellow],
      [tab(850, 750, 340), 'Tour', '1 pierre debout · +5', 3.45, 230, -150, '#ff8a3d'],
      [tab(850, 1000, 440), 'Porte', '2 debout + 1 à plat · +20', 4.2, 250, -40, '#2f9bff'],
      [tab(326, 1057, 420), 'Graal', 'sur le toit du robot · +25', 4.9, -280, -120, '#e2a72e'],
      [tab(60, 1230, 5), 'Retour au trône', 'robot dans la salle du trône en fin de match · +10', 5.6, -60, 140, '#7cf3c0'],
    ];
    for (const [p, a, b, s, dx, dy, col] of it) callout(p, dx, dy, a, b, seg(tl, s, s + 0.8), col);
    caption('Chaque construction rapporte des points : il faut bâtir son château.', t, PL.S03[0] + 0.3, PL.S03[1]);
    return {};
  },
  // --- notre robot (coque nette, mécanismes confidentiels)
  S04(t, tl, d, q) {
    placeMatch(SOLO, 0); lightGold.intensity = 0.6;
    look(orbit(250, 1000, lerp(1100, 780, eio(q)), lerp(-0.2, 0.75, eio(q)), lerp(520, 330, eio(q))).add(drift(t, 0.7)), tab(250, 1000, 170), 38, 0.02);
    renderWorld();
    tag('SILHOUETTE RÉELLE · MÉCANISMES CONFIDENTIELS', W - 70, 110, seg(tl, 0.8, 1.2), '#ff4d5e', 'right');
    caption('Voici notre robot, dans sa version simulée.', t, PL.S04[0] + 0.3, PL.S04[1]);
    return {};
  },
  // --- le match complet en accéléré
  S05(t, tl, d, q) {
    const mt = clamp(tl / 7.5) * 100, p = robotPose(SOLO, 'jaune', mt);
    placeMatch(SOLO, mt);
    look(orbit(lerp(900, 800, q), 1000, 2500, lerp(1.25, 1.75, eio(q)), 2200).add(drift(t, 1.5)), tab(lerp(p.x, 800, 0.6), lerp(p.y, 1000, 0.6), 0), 44);
    renderWorld();
    const sc = mt >= 100 ? 116 : liveScore(SOLO, 'jaune', mt);
    info(['CHRONO', fmt(100 - mt, 1) + ' s'], 70, 150, seg(tl, 0.2, 0.5), CSS.cyan, 240);
    info(['SCORE', String(sc) + ' pts'], 330, 150, seg(tl, 0.2, 0.5), CSS.yellow, 240);
    tag('ACCÉLÉRÉ ×' + fmt(100 / (7.5 * 8.6 / 9), 0), W - 70, 110, seg(tl, 0.2, 0.5), CSS.cyan, 'right');
    if (mt >= 100) { const k = seg(tl, 7.5, 7.9); text('+55 en fin de match : Graal, trône, boulets', 330, 270, { size: 20, weight: 700, color: CSS.yellow, alpha: k, fam: 'Inter' }); }
    caption('Il suit ici un programme écrit à la main : 15 étapes fixées avant le match.', t, PL.S05[0] + 0.3, PL.S05[0] + 8.1);
    caption('Résultat en simulation : 116 points.', t, PL.S05[0] + 8.15, PL.S05[1] + 0.2);
    return { bandeau: 1 };
  },
  // --- le duel : une carrière déjà vidée par l'adversaire
  S06(t, tl, d, q) {
    const mt = tl < 3.4 ? lerp(8.5, 11.6, tl / 3.4) : lerp(15.4, 16.33, clamp((tl - 3.4) / 1.4));
    placeMatch(DUEL, mt);
    if (tl < 3.4) look(orbit(1500, 1500, lerp(1500, 1250, q), lerp(-1.1, -0.8, q), 1100).add(drift(t)), tab(1600, 1450, 80), 42);
    else look(orbit(1300, 1500, 1700, lerp(-1.5, -1.35, q), 1500).add(drift(t)), tab(1150, 1550, 80), 42);
    renderWorld();
    if (tl < 3.4) { const k = seg(tl, 2.3, 2.8); label3(tab(1500, 1500, 520), 'L\'ADVERSAIRE PREND P10', k, CSS.blue, 22); }
    else {
      const k = seg(tl, 3.7, 4.1); label3(tab(1500, 1500, 300), 'P10 : VIDE', k, CSS.red, 30);
      const p = robotPose(DUEL, 'jaune', mt); label3(tab(p.x, p.y, 520), 'son programme prévoyait d\'y aller', k, CSS.yellow, 18);
      info(['SCORE FINAL DU DUEL', 'Nous : 108 · Adversaire : 65'], 70, 150, seg(tl, 4.6, 5.0), CSS.yellow, 420);
    }
    caption('Face à un adversaire, une liste figée ne s\'adapte pas : 108 points au lieu de 116.', t, PL.S06[0] + 0.3, PL.S06[1]);
    return { bandeau: 1 };
  },
  // --- l'objectif
  S07(t, tl, d, q) {
    placeMatch(SOLO, 0);
    look(V(lerp(900, 330, eio(q)), lerp(900, 520, eio(q)), lerp(1500, 1080, eio(q))), tab(250, 1000, 250), 40);
    renderWorld();
    g.fillStyle = `rgba(2,4,10,${0.72 * seg(tl, 0, 0.6)})`; g.fillRect(0, 0, W * DPR, H * DPR);
    text('NOTRE OBJECTIF', W / 2, 400, { size: 24, weight: 700, track: 8, align: 'center', color: CSS.cyan, alpha: seg(tl, 0.3, 0.7), fam: 'Inter' });
    const L = wrapLines('Un cerveau qui choisit lui-même sa prochaine action, selon ce qui se passe sur la table.', 58, 1500, 800);
    L.forEach((l, i) => text(l, W / 2, 490 + i * 70, { size: 58, weight: 800, align: 'center', alpha: seg(tl, 0.5 + i * 0.25, 1.0 + i * 0.25), glow: 8 }));
    text('Il décidera quoi faire ; le comment (trajets, gestes) reste programmé.', W / 2, 680, { size: 28, weight: 500, align: 'center', color: CSS.dim, alpha: seg(tl, 1.6, 2.1), fam: 'Inter' });
    text('Fera-t-il mieux ? C\'est ce qu\'il reste à prouver.', W / 2, 730, { size: 28, weight: 600, align: 'center', color: CSS.yellow, alpha: seg(tl, 2.6, 3.1), fam: 'Inter' });
    return {};
  },
  CH1(t, tl) { placeMatch(SOLO, 0); look(V(1500, 3200, 2800), tab(1500, 1000, 0), 44); renderWorld(); chapter(1, 'RECRÉER LE MONDE DANS L\'ORDINATEUR', t, PL.CH1[0], PL.CH1[1]); return {}; },
  // --- planification de trajet sur quadrillage (trajet réel : « prendre P5 », 12,64 → 16,33 s)
  S08(t, tl, d, q) {
    const T0 = 12.636, T1 = 16.326, mt = lerp(T0, T1, clamp((tl - 1.6) / (d - 2.0)));
    placeMatch(SOLO, mt);
    GRIDP.visible = true; gridOccupancy(SOLO, T0, 212, clamp(tl / 1.4));
    PATH.visible = tl > 1.6; setPath(SOLO, 'jaune', T0, T1, mt);
    look(V(lerp(560, 640, q), lerp(2500, 2300, q), lerp(2350, 2250, q)).add(drift(t, 1)), tab(560, 1150, 0), 44);
    renderWorld();
    tag('QUADRILLAGE : CASES DE 40 MM · RECHERCHE A*', 70, 140, seg(tl, 0.4, 0.8));
    tag('CASES ROUGES : OBSTACLES (ILLUSTRATION) · TRAJET : SIMULATION RÉELLE', 70, 184, seg(tl, 1.2, 1.6), CSS.yellow);
    drawPath(seg(tl, 1.6, 2.0));
    caption('Un simulateur recrée la table, les pierres et les règles. Pour chaque trajet, il cherche un chemin sans contact.', t, PL.S08[0] + 0.3, PL.S08[1]);
    return { bandeau: 0 };
  },
  // --- règle d'attente (duel, t ≈ 26,25 s)
  S09(t, tl, d, q) {
    const mt = lerp(25.6, 26.6, q); placeMatch(DUEL, mt);
    const py = robotPose(DUEL, 'jaune', mt), pb = robotPose(DUEL, 'bleu', mt);
    [[py, LIDAR[0]], [pb, LIDAR[1]]].forEach(([p, l]) => { l.visible = true; l.position.set(p.x, 6, p.y); l.rotation.z = -p.h * Math.PI / 180 + 0; l.material.opacity = 0.18 + 0.1 * Math.sin(t * 6); });
    look(orbit(1500, 300, lerp(1500, 1250, q), lerp(1.25, 1.55, q), 1150).add(drift(t)), tab(1500, 260, 80), 42);
    renderWorld();
    const a = proj(tab(py.x, py.y, 380)), b = proj(tab(pb.x, pb.y, 380));
    if (a.z < 1 && b.z < 1) { line(a.x, a.y, b.x, b.y, CSS.red, seg(tl, 0.6, 1.0), 2); text(fmtMm(Math.hypot(pb.x - py.x, pb.y - py.y)) + ' mm', (a.x + b.x) / 2, (a.y + b.y) / 2 - 16, { size: 24, weight: 800, align: 'center', color: CSS.red, alpha: seg(tl, 0.8, 1.2), fam: 'Inter' }); }
    tag('RÈGLE DU SIMULATEUR : ATTENTE DE 2 S AVANT DE REPARTIR', 70, 140, seg(tl, 0.5, 0.9), CSS.red);
    caption('Si l\'adversaire risque de croiser sa route à moins de 40 cm, notre robot attend.', t, PL.S09[0] + 0.3, PL.S09[1]);
    return { bandeau: 1 };
  },
  // --- matchs en parallèle + débit mesuré
  S10(t, tl, d, q) {
    renderer.setScissorTest(true); renderer.setClearColor(C.bg, 1);
    renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H); renderer.clear();
    const cols = 3, rows = 3, gw = 1180, gh = 664, x0 = 70, y0 = 230, cw = gw / cols, ch = gh / rows;
    for (let i = 0; i < 9; i++) {
      const c = i % cols, r = Math.floor(i / cols), m = i % 2 ? DUEL : SOLO, mt = ((tl * 6 + i * 9.7) % 100);
      placeMatch(m, mt); look(V(1500, 2900, 2600), tab(1500, 950, 0), 42, 0, camera, cw - 8, ch - 8);
      const vx = x0 + c * cw + 4, vy = H - (y0 + (r + 1) * ch) + 4;
      renderer.setViewport(vx, vy, cw - 8, ch - 8); renderer.setScissor(vx, vy, cw - 8, ch - 8); renderer.render(world, camera);
    }
    renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H);
    for (let i = 0; i < 9; i++) { const c = i % cols, r = Math.floor(i / cols); rect(x0 + c * cw + 4, y0 + r * ch + 4, cw - 8, ch - 8, null, 1, 'rgba(56,225,255,0.5)'); }
    const ax = 1310;
    info(['UN MATCH DE 100 S', 'calculé en 5 à 6 s (mesuré)'], ax, 260, seg(tl, 0.5, 0.9), CSS.cyan, 540);
    info(['83 TESTS AUTOMATIQUES', 'réussis sur 83'], ax, 400, seg(tl, 1.2, 1.6), '#7cf3c0', 540);
    text('mesure : 1 cœur, choix au hasard, sans adversaire', ax, 560, { size: 16, weight: 500, color: CSS.dim, alpha: seg(tl, 1.2, 1.6), fam: 'Inter' });
    caption('Dans l\'ordinateur, plusieurs matchs se jouent en même temps, chacun en quelques secondes.', t, PL.S10[0] + 0.3, PL.S10[1]);
    return { bandeau: 1 };
  },
  CH2(t) { placeMatch(DUEL, T_D6); look(V(1500, 3200, 2800), tab(1500, 1000, 0), 44); renderWorld(); chapter(2, 'CE QUE PERÇOIT LE CERVEAU', t, PL.CH2[0], PL.CH2[1]); return {}; },
  // --- arrêt sur image : les 56 entrées réelles
  S11(t, tl, d, q) {
    placeMatch(DUEL, T_D6); const py = robotPose(DUEL, 'jaune', T_D6), pb = robotPose(DUEL, 'bleu', T_D6);
    look(orbit(1300, 1000, lerp(2500, 2300, q), lerp(1.3, 1.65, eio(q)), lerp(2700, 2500, q)).add(drift(t, 0.8)), tab(1150, 1050, 0), 44);
    const seq = [[2, 1.0], [0, 3.45], [1, 4.2], [7, 5.2], [9, 6.3]], hiIdx = seq.reduce((a, [gi, s]) => tl >= s ? gi : a, -1);
    RAYS.visible = tl > 6.3; if (RAYS.visible) setRays(py, D6.obs.slice(48, 56).map(v => v * 1000), eout(seg(tl, 6.3, 6.8)));
    renderWorld();
    tag('ARRÊT SUR IMAGE · DUEL SIMULÉ · t = 16,3 s', 70, 140, seg(tl, 0.2, 0.6), CSS.yellow);
    inputColumn(1430, 220, D6.obs, seg(tl, 0.3, 0.8), hiIdx);
    const hl = gi => seg(tl, seq.find(s => s[0] === gi)[1], seq.find(s => s[0] === gi)[1] + 0.4);
    info(['TEMPS RESTANT', '83,7 s  →  entrée = 0,837'], 70, 200, hl(0), GCOL[0], 420);
    const a1 = proj(tab(py.x, py.y, 420)); if (a1.z < 1 && hl(1) > 0) { text('NOUS', a1.x, a1.y - 34, { size: 18, weight: 800, align: 'center', color: GCOL[1], alpha: hl(1), fam: 'Inter' }); text(`x ${fmtMm(D6.obs[1] * 3000)} · y ${fmtMm(D6.obs[2] * 2000)} mm`, a1.x, a1.y - 8, { size: 20, weight: 700, align: 'center', alpha: hl(1), fam: 'Inter' }); }
    const a2 = proj(tab(pb.x, pb.y, 420)); if (a2.z < 1 && hl(7) > 0) { text('ADVERSAIRE (LIDAR)', a2.x, a2.y - 34, { size: 18, weight: 800, align: 'center', color: GCOL[7], alpha: hl(7), fam: 'Inter' }); text(`x ${fmtMm(D6.obs[35] * 3000)} · y ${fmtMm(D6.obs[36] * 2000)} mm`, a2.x, a2.y - 8, { size: 20, weight: 700, align: 'center', alpha: hl(7), fam: 'Inter' }); }
    if (hl(9) > 0) for (let i = 0; i < 8; i++) { const a = (py.h + i * 45) * Math.PI / 180, L = D6.obs[48 + i] * 1000, p = proj(tab(py.x + L * Math.cos(a), py.y + L * Math.sin(a), 60)); if (p.z < 1) text(fmtMm(L) + ' mm', p.x, p.y - 8, { size: 15, weight: 800, align: 'center', color: GCOL[9], alpha: hl(9), fam: 'Inter' }); }
    if (hl(2) > 0) SPEC.carrieres.forEach((p, j) => label3(tab(p.c[0], p.c[1], 400), `${p.id} : ${Math.round(D6.obs[5 + j] * 3)}/3`, hl(2), GCOL[2], 16));
    caption('Il ne voit pas une image : il reçoit 56 nombres. Temps, position, adversaire, espace libre, carrières…', t, PL.S11[0] + 0.3, PL.S11[1]);
    return { bandeau: 1 };
  },
  // --- la croyance : P4, P8, P10 pleines pour lui, vides en réalité
  S12(t, tl, d, q) {
    placeMatch(DUEL, T_D6); GHOSTS.forEach(gh => { gh.visible = true; gh.children[0].material.opacity = 0.12 + 0.06 * Math.sin(t * 5); });
    look(orbit(2000, 1000, lerp(2300, 2000, q), lerp(1.45, 1.2, eio(q)), lerp(2300, 2100, q)).add(drift(t)), tab(2050, 900, 0), 44);
    renderWorld();
    const ev = { P4: '2,1 s', P8: '8,4 s', P10: '10,8 s' };
    GHOSTS.forEach((gh, i) => { const p = SPEC.carrieres.find(c => c.id === gh.userData.id), k = seg(tl, 0.6 + i * 0.4, 1.0 + i * 0.4);
      label3(tab(p.c[0], p.c[1], 470), `${p.id} · pour lui : 3 pierres`, k, CSS.yellow, 24); label3(tab(p.c[0], p.c[1], 470), `réalité : vide depuis ${ev[gh.userData.id]}`, k, CSS.red, 20, 28); });
    caption('Une carrière reste pleine, pour lui, tant qu\'il n\'a pas essayé de la prendre.', t, PL.S12[0] + 0.3, PL.S12[1]);
    return { bandeau: 1 };
  },
  CH3(t) { netState(t, { appear: [0, 0, 0, 0] }); look(V(0, 0, 5200), V(0, 0, 0), 40, 0, netCam); renderNet(); chapter(3, 'À L\'INTÉRIEUR DU RÉSEAU', t, PL.CH3[0], PL.CH3[1]); return {}; },
  // --- construction du réseau, couche par couche
  S13(t, tl, d, q) {
    const ap = [seg(tl, 0.2, 1.2), seg(tl, 1.2, 2.4), seg(tl, 2.4, 3.6), seg(tl, 3.6, 4.8)];
    netState(t, { appear: ap, inputs: D6.obs, flow: seg(tl, 4.8, 5.4), memory: seg(tl, 2.4, 3.6) });
    look(V(lerp(-2600, 1400, eio(q)), lerp(450, 200, q), lerp(2600, 3300, eio(q))).add(drift(t * 1.3, 2)), V(lerp(-1300, 200, eio(q)), 0, 0), 42, 0, netCam);
    renderNet();
    const lab = (v, s1, s2, k, col) => { const p = projN(v); if (p.z < 1 && k > 0 && p.x > 80 && p.x < W - 80) { text(s1, p.x, p.y, { size: 30, weight: 800, align: 'center', alpha: k, color: col, glow: 6 }); if (s2) text(s2, p.x, p.y + 30, { size: 18, weight: 500, align: 'center', alpha: k, color: CSS.dim, fam: 'Inter' }); } };
    lab(V(-1500, 990, 0), '56 nombres', 'ce qu\'il perçoit', ap[0], CSS.white);
    lab(V(-600, 520, 0), '128 neurones', 'somme pondérée, puis transformation', ap[1], CSS.cyan);
    lab(V(300, 470, 0), 'mémoire : 128', 'garde le fil du match', ap[2], '#7cf3c0');
    lab(V(1300, 470, 0), '130 notes', 'une par action', ap[3], CSS.white);
    info(['RÉGLAGES DU RÉSEAU', '≈ 140 000 coefficients (140 035)'], 70, 140, seg(tl, 5.35, 5.75), CSS.cyan, 470);
    text('activations internes : illustration', 70, H - 40, { size: 15, weight: 500, color: CSS.dim, alpha: 0.9, fam: 'Inter' });
    caption('Chaque neurone additionne les entrées, chacune multipliée par un coefficient, puis transforme ce total. Ce sont ces coefficients que l\'entraînement ajustera.', t, PL.S13[0] + 0.3, PL.S13[1], { size: 34 });
    return {};
  },
  // --- sorties, filtre (masque réel à t = 0), choix
  S14(t, tl, d, q) {
    const dec = DEC_SOLO[0];
    netState(t, { appear: [1, 1, 1, 1], inputs: dec.obs, flow: 1, memory: 1, mask: tl > 2.45 ? dec.mask : null, win: tl > 4.95 ? dec.action : -1 });
    look(V(2000, 250, 3600).add(drift(t, 2)), V(0, 0, 0), 40, 0, netCam); netCam.setViewOffset(W, H, 0, 230, W, H); netCam.updateProjectionMatrix(); renderNet();
    g.fillStyle = 'rgba(2,6,13,0.55)'; g.fillRect(0, 560 * DPR, W * DPR, 520 * DPR);
    outputBars(160, 900, 1600, 230, { mask: dec.mask, maskOn: tl > 2.45, win: dec.action, showWin: tl > 4.95, seed: 9 }, seg(tl, 0.4, 1.0));
    text('130 NOTES · UNE PAR ACTION (prendre, mur, tour, porte, Graal, boulets, trône, trajets…)', 160, 620, { size: 18, weight: 700, track: 2, color: CSS.white, alpha: seg(tl, 0.5, 0.9), fam: 'Inter' });
    tag('À t = 0 S : 29 ACTIONS PERMISES SUR 130 (MESURÉ)', 160, 940, seg(tl, 2.5, 2.9), '#ff9aa5');
    tag('CHOIX : « ' + dec.label.toUpperCase() + ' »', W - 160, 940, seg(tl, 5.0, 5.4), '#ffd84d', 'right');
    text('hauteurs des notes : illustration · filtre encore à fiabiliser', W - 160, 1000, { size: 15, weight: 500, align: 'right', color: CSS.dim, alpha: 0.9, fam: 'Inter' });
    caption('Une mémoire garde le fil du match. En sortie : 130 notes, une par action possible.', t, PL.S14[0] + 0.2, PL.S14[0] + 3.2, { y: 520, size: 34 });
    caption('Un filtre écarte les actions impossibles ; la mieux notée est jouée.', t, PL.S14[0] + 3.2, PL.S14[1], { y: 520, size: 34 });
    return {};
  },
  CH4(t) { netState(t, { appear: [1, 1, 1, 1], flow: 0 }); look(V(0, 200, 5200), V(0, 0, 0), 40, 0, netCam); renderNet(); chapter(4, 'APPRENDRE EN JOUANT · MÉTHODE PRÉVUE', t, PL.CH4[0], PL.CH4[1]); return {}; },
  // --- imitation puis renforcement (méthode prévue)
  S15(t, tl, d, q) {
    const mt = clamp(tl / d) * 45; placeMatch(SOLO, mt);
    const p = robotPose(SOLO, 'jaune', mt);
    renderer.setScissorTest(true); renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H); renderer.setClearColor(C.bg, 1); renderer.clear();
    look(orbit(900, 1000, 2300, 1.5, 2300).add(drift(t)), tab(900, 950, 0), 46, 0, camera, 1000, H);
    renderer.setViewport(0, 0, 1000, H); renderer.setScissor(0, 0, 1000, H); renderer.render(world, camera);
    renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); VP.w = 1000;
    line(1000, 0, 1000, H, CSS.cyan, 0.8, 2);
    const imit = tl < 2.5, k = DEC_SOLO.reduce((a, dd, i) => (SOLO.briques.jaune[i] && SOLO.briques.jaune[i].t0 <= mt ? i : a), 0), dec = DEC_SOLO[Math.min(k, DEC_SOLO.length - 1)];
    text(imit ? 'LE PROFESSEUR : PROGRAMME ÉCRIT À LA MAIN' : 'SEUL : LE SCORE COMME GUIDE', 70, 150, { size: 20, weight: 800, track: 3, color: imit ? CSS.white : CSS.yellow, alpha: 1, fam: 'Inter' });
    text('LE RÉSEAU (ILLUSTRATION)', 1060, 150, { size: 20, weight: 800, track: 3, color: CSS.cyan, alpha: 1, fam: 'Inter' });
    outputBars(1060, 700, 780, 360, { win: dec.action, showWin: true, flat: tl < 0.8, seed: 3 + k }, 1);
    text(imit ? 'on ajuste ses réglages pour qu\'il donne la meilleure note au même choix' : 'ce qui rapporte des points devient un peu plus probable', 1060, 760, { size: 20, weight: 600, alpha: 1, fam: 'Inter' });
    text('choix du moment : ' + dec.label, 1060, 800, { size: 18, weight: 500, color: '#ffd84d', alpha: 1, fam: 'Inter' });
    const s0 = liveScore(SOLO, 'jaune', Math.max(0, mt - 0.6)), s1 = liveScore(SOLO, 'jaune', mt);
    if (!imit && s1 > s0) { const pp = proj(tab(p.x, p.y, 520)); if (pp.z < 1) text('+' + (s1 - s0) + ' pts', pp.x, pp.y, { size: 34, weight: 800, align: 'center', color: CSS.yellow, alpha: 1, glow: 10, fam: 'Inter' }); }
    caption('D\'abord, il imitera un programme écrit à la main.', t, PL.S15[0] + 0.2, PL.S15[0] + 3.0, { size: 36 });
    caption('Puis il jouera seul, en simulation : le score sera son seul guide.', t, PL.S15[0] + 3.0, PL.S15[1], { size: 36 });
    return { bandeau: 1 };
  },
  // --- examen puis fichier pour le robot
  S16(t, tl, d, q) {
    placeMatch(SOLO, 100);
    look(orbit(500, 1000, 1900, 0.3 + q * 0.3, 1300).add(drift(t)), tab(450, 1000, 150), 40); renderWorld();
    g.fillStyle = 'rgba(2,4,10,0.62)'; g.fillRect(0, 0, W * DPR, H * DPR);
    const cx = [560, 960, 1360];
    cx.forEach((x, i) => { const a = seg(tl, 0.2 + i * 0.15, 0.6 + i * 0.15), champ = i === 1 && tl > 1.8;
      rect(x - 150, 300, 300, 150, champ ? 'rgba(242,183,5,0.16)' : 'rgba(4,10,20,0.85)', a * (tl > 2.4 && !champ ? 0.35 : 1), champ ? CSS.yellow : CSS.cyan);
      text('VERSION ' + (i + 1), x, 365, { size: 26, weight: 800, align: 'center', alpha: a * (tl > 2.4 && !champ ? 0.35 : 1), fam: 'Inter' });
      text(champ ? 'CHAMPION' : 'examen', x, 410, { size: 18, weight: 700, align: 'center', color: champ ? CSS.yellow : CSS.dim, alpha: a, fam: 'Inter' }); });
    text('EXAMEN : LES MÊMES MATCHS POUR TOUTES LES VERSIONS · LA MEILLEURE MOYENNE GAGNE', W / 2, 250, { size: 20, weight: 700, track: 2, align: 'center', color: CSS.cyan, alpha: seg(tl, 0.5, 0.9), fam: 'Inter' });
    const fk = eio(seg(tl, 2.4, 3.6)), fx = lerp(960, 980, fk), fy = lerp(470, 640, fk);
    if (tl > 2.4) { rect(fx - 90, fy, 180, 110, 'rgba(4,10,20,0.9)', 1, CSS.yellow); text('≈ 497 ko', fx, fy + 50, { size: 28, weight: 800, align: 'center', color: CSS.yellow, fam: 'Inter' }); text('fichier du réseau', fx, fy + 82, { size: 16, weight: 500, align: 'center', color: CSS.dim, fam: 'Inter' }); }
    text('prévu pour le robot · pas encore testé à bord', W / 2, 800, { size: 20, weight: 600, align: 'center', color: CSS.dim, alpha: seg(tl, 3.2, 3.6), fam: 'Inter' });
    caption('Chaque version passera un examen ; la meilleure deviendra un fichier d\'environ 500 ko pour le robot.', t, PL.S16[0] + 0.2, PL.S16[1], { size: 34 });
    return {};
  },
  // --- où nous en sommes
  S17(t, tl, d, q) {
    placeMatch(SOLO, 100);
    look(orbit(1500, 1000, 3200, 1.6 + q * 0.2, 2600), tab(1500, 1000, 0), 44); renderWorld();
    g.fillStyle = 'rgba(2,4,10,0.7)'; g.fillRect(0, 0, W * DPR, H * DPR);
    timelineBar(220, 520, 1480, [
      { u: 0.0, date: 'AUJOURD\'HUI', done: true, lines: ['simulateur : 83 tests réussis', 'chaîne d\'apprentissage', 'testée une première fois'] },
      { u: 0.33, date: 'JANV.–FÉVR. 2027', lines: ['entraînement du cerveau', 'et examen'] },
      { u: 0.58, date: 'MARS 2027', lines: ['cerveau à bord', 'premiers essais'] },
      { u: 0.8, date: 'AVRIL 2027', lines: ['recalage sur', 'le robot réel'] },
      { u: 1.0, date: 'MAI 2027', lines: ['compétition'] }], seg(tl, 0.2, 1.4));
    text('calendrier prévu', W / 2, 380, { size: 18, weight: 700, track: 4, align: 'center', color: CSS.dim, alpha: seg(tl, 0.2, 0.6), fam: 'Inter' });
    caption('Le simulateur fonctionne. Le cerveau, lui, reste à entraîner : c\'est prévu cet hiver.', t, PL.S17[0] + 0.3, PL.S17[1], { size: 36 });
    return {};
  },
  // --- fin : l'équipe et la demande
  END(t, tl, d, q) {
    placeMatch(SOLO, 100); lightGold.intensity = 1.8;
    look(orbit(400, 1000, lerp(1700, 2000, eio(q)), lerp(0.15, 0.4, q), lerp(950, 1150, eio(q))).add(drift(t, 0.6)), tab(500, 1000, 150), 40); renderWorld();
    g.fillStyle = `rgba(2,4,10,${0.62 * seg(tl, 0.3, 1.0)})`; g.fillRect(0, 0, W * DPR, H * DPR);
    glitchTitle('ICAMLOT', W / 2, 330, 120, seg(tl, 0.4, 1.0), Math.floor(t * 30), { color: CSS.yellow });
    text(TEAM.asso, W / 2, 395, { size: 28, weight: 700, track: 8, align: 'center', alpha: seg(tl, 0.8, 1.2), fam: 'Inter' });
    TEAM.membres.forEach((n, i) => text(n, W / 2 + (i % 2 ? 260 : -260), 480 + Math.floor(i / 2) * 46, { size: 26, weight: 600, align: 'center', color: CSS.white, alpha: seg(tl, 1.2 + i * 0.15, 1.6 + i * 0.15), fam: 'Inter' }));
    const k = seg(tl, 3.1, 3.6);
    rect(W / 2 - 520, 640, 1040, 120, 'rgba(242,183,5,0.12)', k, CSS.yellow);
    text('NOUS RECHERCHONS UN APPORT FINANCIER', W / 2, 700, { size: 40, weight: 800, align: 'center', color: CSS.yellow, alpha: k, glow: 8 });
    text('Devenez partenaire d\'ICAMLOT pour l\'Eurobot 2027', W / 2, 742, { size: 24, weight: 600, align: 'center', alpha: k, fam: 'Inter' });
    text('Images : simulation · matchs joués par un programme écrit à la main · robot montré sans ses mécanismes', W / 2, H - 50, { size: 16, weight: 500, align: 'center', color: CSS.dim, alpha: seg(tl, 3.0, 3.5), fam: 'Inter' });
    if (tl > d - 0.6) flash(seg(tl, d - 0.6, d), '2,4,10');
    return {};
  },
};

window.renderFrame = renderFrame;
await document.fonts.load(F(800, 40)); await document.fonts.load(F(600, 20, 'Inter'));
window.READY = true;
