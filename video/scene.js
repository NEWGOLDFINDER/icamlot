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

// ------------------------------------------------------------------ particules (ouverture)
const dust = (() => {
  const r = rng(5), n = 5000, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { p[i * 3] = (r() - 0.5) * 8000; p[i * 3 + 1] = (r() - 0.5) * 4500; p[i * 3 + 2] = -r() * 20000; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: C.cyan, size: 9, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  voidScene.add(pts); return pts;
})();
const voidGrid = new THREE.GridHelper(40000, 160, 0x0e3a52, 0x0a2233); voidGrid.position.y = -1600; voidScene.add(voidGrid);

// ------------------------------------------------------------------ match réel (moteur de référence + modèle fumee)
const LIVE = await (await fetch('netlive.json')).json();
const DEC = LIVE.dec, T_END = 10.0;

// ------------------------------------------------------------------ robot confidentiel : rendu à part, puis flouté dans le HUD
const rcv = document.createElement('canvas');
const rRenderer = new THREE.WebGLRenderer({ canvas: rcv, alpha: true, antialias: false, preserveDrawingBuffer: true });
rRenderer.setPixelRatio(Math.min(1, DPR)); rRenderer.setSize(W, H, false);
rRenderer.toneMapping = THREE.ACESFilmicToneMapping; rRenderer.outputColorSpace = THREE.SRGBColorSpace; rRenderer.localClippingEnabled = true;
const robotScene = new THREE.Scene();
robotScene.add(new THREE.HemisphereLight(0xd6e2f2, 0x161a22, 1.1));
{ const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(1200, 3200, -600); robotScene.add(d); const d2 = new THREE.DirectionalLight(0x9fdcff, 0.9); d2.position.set(2500, 800, 2600); robotScene.add(d2); }
const robot = makeRobot(); robotScene.add(robot);
// silhouette unie : aucune couleur ni aucun détail du robot n'est rendu
robotScene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0x4fa6d6, clippingPlanes: [clipPlane] });
const tiny = document.createElement('canvas'); tiny.width = 64; tiny.height = 36; const tctx = tiny.getContext('2d');
function placeRobot(obj, x, y, thDeg) { obj.position.set(x, 0, y); obj.rotation.y = -thDeg * Math.PI / 180; }
function robotToWorld(x, y, th, rx, ry, z) { const a = th * Math.PI / 180; return tab(x + rx * Math.cos(a) - ry * Math.sin(a), y + rx * Math.sin(a) + ry * Math.cos(a), z); }
const ROBOT_START = [250, 1000, 0];
placeRobot(robot, ...ROBOT_START);
const glowMat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
const ringY = new THREE.Mesh(new THREE.RingGeometry(150, 240, 64), glowMat(C.cyan)); ringY.rotation.x = -Math.PI / 2; world.add(ringY);
const ringB = new THREE.Mesh(new THREE.RingGeometry(150, 240, 64), glowMat(C.blue)); ringB.rotation.x = -Math.PI / 2; world.add(ringB);

// ------------------------------------------------------------------ adversaire simulé : robot à 4 roues (modèle fictif)
function makeAdversary() {
  const A = new THREE.Group(), body = new THREE.Group(); A.add(body);
  const m = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.5, metalness: 0.2 }, o));
  const add = (geo, mt, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, mt); o.position.set(x, z, y); o.rotation.set(rx, ry, rz); o.castShadow = o.receiveShadow = true; body.add(o); return o; };
  const L = 300, Wd = 260, alu = m(0xaab3bd, { metalness: 0.5, roughness: 0.35 }), dark = m(0x232a35), blue = m(0x2f62d8, { roughness: 0.35 });
  add(new THREE.BoxGeometry(L, 10, Wd), dark, 0, 0, 45);                                          // plaque basse
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {                                             // 4 roues Ø 70
    add(new THREE.CylinderGeometry(35, 35, 24, 28), m(0x14171c, { roughness: 0.9 }), sx * 92, sy * 113, 35, Math.PI / 2);
    add(new THREE.CylinderGeometry(16, 16, 26, 16), alu, sx * 92, sy * 113, 35, Math.PI / 2);
    add(new THREE.CylinderGeometry(14, 14, 60, 16), m(0x4b5563, { metalness: 0.6 }), sx * 92, sy * 70, 35, Math.PI / 2);   // moteurs
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) add(new THREE.BoxGeometry(20, 245, 20), alu, sx * (L / 2 - 14), sy * (Wd / 2 - 14), 172);
  add(new THREE.BoxGeometry(L - 12, 6, Wd - 12), dark, 0, 0, 175);                                 // plateau intermédiaire
  add(new THREE.BoxGeometry(110, 22, 80), m(0x0f5132, { emissive: 0x1aff8c, emissiveIntensity: 0.15 }), -40, 0, 190); // électronique
  add(new THREE.BoxGeometry(L, 8, Wd), blue, 0, 0, 296);                                            // toit
  for (const sy of [-1, 1]) add(new THREE.BoxGeometry(L - 40, 200, 4), m(0x2f62d8, { transparent: true, opacity: 0.35 }), 0, sy * (Wd / 2 + 1), 160);
  for (const sy of [-1, 1]) add(new THREE.BoxGeometry(28, 190, 16), alu, L / 2 + 22, sy * 72, 125);  // pince avant
  add(new THREE.BoxGeometry(16, 22, 170), dark, L / 2 + 38, 0, 120);
  for (const sy of [-1, 1]) add(new THREE.BoxGeometry(14, 60, 40), m(0xf2b705), L / 2 + 48, sy * 72, 70);
  add(new THREE.CylinderGeometry(36, 36, 34, 28), m(0x0b0d10, { roughness: 0.3 }), 90, 0, 318);     // lidar
  add(new THREE.CylinderGeometry(40, 40, 110, 24), alu, 0, 0, 355);                                 // support de balise
  add(new THREE.CylinderGeometry(24, 24, 6, 20), m(0xf2b705), -100, 80, 303);                       // arrêt d'urgence
  add(new THREE.CylinderGeometry(17, 17, 22, 20), m(0xd92b2b), -100, 80, 316);
  A.userData.body = body; return A;
}
const adv = makeAdversary(); world.add(adv);

// ------------------------------------------------------------------ « dans sa tête » : notre robot = repère neutre
const nous = new THREE.Group(); world.add(nous);
{
  const d = new THREE.Mesh(new THREE.CylinderGeometry(212, 212, 8, 48), new THREE.MeshBasicMaterial({ color: C.yellow, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })); d.position.y = 6; nous.add(d);
  const r = new THREE.Mesh(new THREE.RingGeometry(200, 214, 64), glowMat(C.yellow)); r.rotation.x = -Math.PI / 2; r.position.y = 12; nous.add(r);
  const a = new THREE.Mesh(new THREE.ConeGeometry(55, 130, 3), glowMat(0xffe9a8)); a.rotation.z = -Math.PI / 2; a.position.set(150, 14, 0); nous.add(a);
  const b = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 900, 8), glowMat(C.yellow)); b.position.y = 450; b.material.opacity = 0.35; nous.add(b);
}
const pulse = new THREE.Mesh(new THREE.RingGeometry(0, 1, 96), glowMat(C.cyan)); pulse.rotation.x = -Math.PI / 2; world.add(pulse);
const rays = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 6), 3)),
  new THREE.LineBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
world.add(rays);
// zones de mur qui s'allument quand le moteur valide la construction
const ZONE = {};
for (const mz of SPEC.murs) {
  const z = new THREE.Mesh(new THREE.PlaneGeometry(400, 200), glowMat(C.yellow)); z.rotation.x = -Math.PI / 2; z.rotation.z = -mz.grand_axe_deg * Math.PI / 180;
  z.position.set(mz.c[0], 4, mz.c[1]); z.material.opacity = 0; world.add(z); ZONE[mz.id] = z;
}

// ------------------------------------------------------------------ grille d'entraînement (copies simplifiées)
const GRID = { cols: 7, rows: 5, dx: 3600, dy: 2600 };
const gridGroup = new THREE.Group(); world.add(gridGroup);
const clones = [];
{
  const planeMat = new THREE.MeshBasicMaterial({ map: TABLE_TX, transparent: true });
  const r = rng(11), n = GRID.cols * GRID.rows;
  const stoneI = new THREE.InstancedMesh(stoneGeo, new THREE.MeshStandardMaterial({ color: C.stone, roughness: 0.8 }), n * 30);
  const robY = new THREE.InstancedMesh(new THREE.CylinderGeometry(200, 200, 110, 32), new THREE.MeshStandardMaterial({ color: C.yellow, emissive: C.yellow, emissiveIntensity: 0.6 }), n);
  const robB = new THREE.InstancedMesh(new THREE.BoxGeometry(300, 300, 260), new THREE.MeshStandardMaterial({ color: C.blue, emissive: C.blue, emissiveIntensity: 0.5 }), n);
  let si = 0, ci = 0; const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < GRID.cols; i++) for (let j = 0; j < GRID.rows; j++) {
    const ox = (i - 3) * GRID.dx, oy = (j - 2) * GRID.dy, main = ox === 0 && oy === 0;
    if (!main) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(3000, 2000), planeMat); pl.rotation.x = -Math.PI / 2; pl.position.set(1500 + ox, 0, 1000 + oy); gridGroup.add(pl);
      gridGroup.add(polyLine([tab(ox, oy, 5), tab(3000 + ox, oy, 5), tab(3000 + ox, 2000 + oy, 5), tab(ox, 2000 + oy, 5), tab(ox, oy, 5)], C.cyan, 0.7));
      for (const p of SPEC.carrieres) for (let k = 0; k < 3; k++) {
        q.setFromAxisAngle(V(0, 1, 0), p.axe_long === 'y' ? Math.PI / 2 : 0);
        m4.compose(V(p.c[0] + ox, 55 + 110 * k, p.c[1] + oy), q, V(1, 1, 1)); stoneI.setMatrixAt(si++, m4);
      }
    }
    const packs = SPEC.carrieres, pk = packs[Math.floor(r() * packs.length)], wall = SPEC.murs[Math.floor(r() * 5)];
    const pkB = packs[Math.floor(r() * packs.length)], wallB = SPEC.murs[Math.floor(r() * 5)];
    clones.push({ ox, oy, ci, ph: r(), path: [[250, 1000], [pk.c[0], pk.c[1] + (pk.c[1] < 1000 ? 260 : -260)], [wall.c[0] + 120, wall.c[1]], [250, 1000]],
      pathB: [[2750, 1000], [pkB.c[0], pkB.c[1] + (pkB.c[1] < 1000 ? 260 : -260)], [3000 - wallB.c[0] - 120, wallB.c[1]], [2750, 1000]] });
    ci++;
  }
  stoneI.count = si; robY.count = ci; robB.count = ci;
  gridGroup.add(stoneI, robY, robB); gridGroup.userData = { robY, robB };
}
function pathAt(path, u) { const n = path.length - 1, s = clamp(u) * n, i = Math.min(n - 1, Math.floor(s)), k = eio(s - i); return [lerp(path[i][0], path[i + 1][0], k), lerp(path[i][1], path[i + 1][1], k)]; }

// ------------------------------------------------------------------ réseau de neurones (architecture réelle, activations réelles)
const GROUPS = [
  ['Temps restant', 1], ['Position et cap', 4], ['Pierres restantes P1→P10', 10], ['Charge des pinces A / B', 6],
  ['Murs et tours construits', 9], ['Graal', 4], ['Boulets', 1], ['Adversaire (lidar)', 2], ['État fin des pinces', 11], ['Radar 8 directions', 8]];
const GCOL = ['#38e1ff', '#7cf3c0', '#f2b705', '#2f9bff', '#ff8a3d', '#e2a72e', '#ffd84d', '#5b93ff', '#b58cff', '#fff1a8'];
const netCam = new THREE.PerspectiveCamera(40, W / H, 10, 20000);
const net = { layers: [] };
{
  const inPos = []; let y = 0;
  GROUPS.forEach(([, n], gi) => { for (let i = 0; i < n; i++) { inPos.push({ p: V(-1500, 0, 0), g: gi, yy: y }); y += 26; } y += 34; });
  const h0 = y - 34; inPos.forEach(o => o.p.y = h0 / 2 - o.yy);
  const enc = []; for (let i = 0; i < 128; i++) { const row = Math.floor(i / 8), col = i % 8; enc.push({ p: V(-600, (7.5 - row) * 52, (col - 3.5) * 52) }); }
  const gru = []; for (let i = 0; i < 128; i++) { const a = i / 128 * Math.PI * 2; gru.push({ p: V(300 + 60 * Math.sin(a * 4), 330 * Math.cos(a), 330 * Math.sin(a)) }); }
  const out = []; for (let i = 0; i < 130; i++) { const col = i % 10, row = Math.floor(i / 10); out.push({ p: V(1300, (6 - row) * 58, (col - 4.5) * 58) }); }
  net.layers = [inPos, enc, gru, out];
  const sph = new THREE.SphereGeometry(1, 14, 10);
  for (const L of net.layers) for (const o of L) { o.m = new THREE.Mesh(sph, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })); o.m.position.copy(o.p); netScene.add(o.m); }
  // panneau de fond
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(3900, 2300), new THREE.MeshBasicMaterial({ color: 0x02060d, transparent: true, opacity: 0.78, depthWrite: false }));
  bg.position.set(-100, 0, -700); net.bg = bg;
  const fr = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(3900, 2300)), new THREE.LineBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.5 }));
  fr.position.copy(bg.position); net.frame = fr;
  // liaisons les plus actives de chaque décision (contribution = activation × poids)
  const POS = 0x38e1ff, NEG = 0xff4fa3;
  net.sets = DEC.map(d => {
    const mk = (list, A, B, col) => {
      const p = [], c = [], cc = new THREE.Color();
      for (const [a, b, s] of list) {
        const pa = A[a].p, pb = B[b].p, k = Math.pow(Math.abs(s), 0.6);
        p.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
        cc.setHex(col || (s >= 0 ? POS : NEG)).multiplyScalar(0.25 + 0.75 * k); c.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b);
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      l.userData = { n: list.length, list, A, B }; netScene.add(l); return l;
    };
    return [mk(d.L1, inPos, enc), mk(d.L2, enc, gru), mk(d.L3, gru, out, 0xffd84d)];
  });
  const loop = new THREE.Mesh(new THREE.TorusGeometry(330, 3, 8, 128), new THREE.MeshBasicMaterial({ color: 0x7cf3c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending }));
  loop.rotation.y = Math.PI / 2; loop.position.x = 300; netScene.add(loop); net.loop = loop;
  const NP = 900, geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NP * 3), 3));
  net.pulses = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 9, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })); netScene.add(net.pulses);
  net.halo = new THREE.Mesh(new THREE.RingGeometry(20, 25, 48), new THREE.MeshBasicMaterial({ color: 0xffd84d, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); netScene.add(net.halo);
}
const OUTCOL = { masked: new THREE.Color(0x5a1620), valid: new THREE.Color(0xdfe8f2), win: new THREE.Color(0xffd84d) };
function nodeVis(L, i, d) {
  if (!d) return { v: 0, col: null };
  if (L === 0) return { v: clamp(Math.abs(d.xn[i]) / 2.5), col: new THREE.Color(GCOL[net.layers[0][i].g]) };
  if (L === 1) return { v: clamp((d.enc[i] + 0.28) / 2.5), col: new THREE.Color(0x38e1ff) };
  if (L === 2) return { v: clamp(Math.abs(d.h[i])), col: new THREE.Color(d.h[i] >= 0 ? 0x7cf3c0 : 0xff4fa3) };
  if (i === d.idx) return { v: 1, col: OUTCOL.win };
  return d.mask[i] ? { v: 0.25 + 0.75 * Math.pow(d.probs[i], 0.25), col: OUTCOL.valid } : { v: 0.12, col: OUTCOL.masked };
}

// ------------------------------------------------------------------ données du match réel : pierres échantillonnées dans le moteur
const STONES = await (await fetch('stones.json')).json();
function stoneSample(id, mt) {
  const a = STONES.stones[id]; if (!a) return null;
  const f = clamp(mt / STONES.dt, 0, a.length - 1), i = Math.min(a.length - 2, Math.floor(f)), k = f - i, A = a[i], B = a[i + 1];
  if (!A || !B) return A || B;
  if (A[7] !== B[7] && (A[7] === 3 || B[7] === 3)) return k < 0.5 ? A : B;      // pose : pas d'interpolation à travers le lâcher
  let da = B[6] - A[6]; if (da > 180) da -= 360; if (da < -180) da += 360;
  return [lerp(A[0], B[0], k), lerp(A[1], B[1], k), lerp(A[2], B[2], k), B[3], B[4], B[5], A[6] + da * k, B[7]];
}
// trajectoires (traces lumineuses)
function trail(arr, color) {
  const pts = arr.map(p => tab(p[0], p[1], 14));
  const l = polyLine(pts, color, 0.9); l.material.opacity = 0.9; l.userData.n = pts.length; world.add(l); return l;
}
const trailY = trail(LIVE.yellow, C.yellow), trailB = trail(LIVE.blue, 0x6fa0ff);
nous.visible = false; pulse.visible = false;

// ------------------------------------------------------------------ montage
const SH = { hook: [0, 2.4], world: [2.4, 5.4], reveal: [5.4, 7.6], go: [7.6, 7.9], A: [7.9, 9.4], B: [9.4, 11.9], C: [11.9, 12.6], D: [12.6, 16.0], E: [16.0, 18.6], F: [18.6, 20.0], G: [20.0, 22.6], H: [22.6, 24.2], I: [24.2, 27.4], J: [27.4, 30] };
const IN = (t, k) => t >= SH[k][0] && t < SH[k][1];
const DT3 = DEC[2].t, DT4 = DEC[3].t;
const KF = [[7.6, 0], [7.9, 0], [9.4, 3.0], [11.9, 3.5], [12.6, DT3], [20.0, DT3], [21.8, 7.4], [22.6, DT4], [24.2, T_END], [99, T_END]];
function matchT(t) { if (t <= KF[0][0]) return 0; for (let i = 1; i < KF.length; i++) if (t <= KF[i][0]) return lerp(KF[i - 1][1], KF[i][1], (t - KF[i - 1][0]) / (KF[i][0] - KF[i - 1][0])); return T_END; }
function speedAt(t) { return (matchT(t + 0.02) - matchT(t - 0.02)) / 0.04; }
function poseAt(arr, mt) {
  const f = clamp(mt / 0.05, 0, arr.length - 1), i = Math.min(arr.length - 2, Math.floor(f)), k = f - i, a = arr[i], b = arr[i + 1];
  let dh = b[2] - a[2]; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
  return { x: lerp(a[0], b[0], k), y: lerp(a[1], b[1], k), h: a[2] + dh * k };
}
function look(pos, tgt, fov = 40, roll = 0, cam = camera, vw = W, vh = H) {
  cam.position.copy(pos); cam.up.set(0, 1, 0); cam.lookAt(tgt); if (roll) cam.rotateZ(roll);
  cam.fov = fov; cam.aspect = vw / vh; cam.clearViewOffset(); cam.updateProjectionMatrix();
}
function drift(t, a = 1) { return V(Math.sin(t * 0.71) * 18 * a + Math.sin(t * 1.9) * 5 * a, Math.sin(t * 1.13) * 12 * a, Math.cos(t * 0.83) * 18 * a); }
function shake(t, a) { return V(Math.sin(t * 37.1) * a + Math.sin(t * 23.3) * a * 0.6, Math.sin(t * 29.7) * a * 0.7, Math.cos(t * 31.9) * a); }
function orbit(cx, cz, r, ang, h) { return V(cx + r * Math.cos(ang), h, cz + r * Math.sin(ang)); }
const cubic = (a, b, c, k) => a.clone().multiplyScalar((1 - k) * (1 - k)).add(b.clone().multiplyScalar(2 * k * (1 - k))).add(c.clone().multiplyScalar(k * k));
renderer.autoClear = false; netScene.background = null; netScene.fog = null;
VP.x0 = 0; VP.w = W; NVP.x0 = 0; NVP.w = W;

// ------------------------------------------------------------------ image
let NETFADE = 1;
function renderFrame(t) {
  g.clearRect(0, 0, hud.width, hud.height);
  const mt = matchT(t), yp = poseAt(LIVE.yellow, mt), bp = poseAt(LIVE.blue, mt), live = t >= SH.go[0];
  // robots
  placeRobot(robot, ...(live ? [yp.x, yp.y, yp.h] : ROBOT_START));
  placeRobot(adv, ...(live ? [bp.x, bp.y, bp.h] : [2750, 1000, 180]));
  adv.visible = t >= 5.45 && t < SH.I[1];
  const bAdv = eio(seg(t, 5.5, 6.2)); adv.userData.body.scale.set(1, Math.max(0.001, bAdv), 1);
  ringB.visible = t > 5.5 && t < 6.3; ringB.position.set(2750, bAdv * 440, 1000); ringB.material.opacity = 0.9 * (1 - bAdv * 0.6);
  const build = eio(seg(t, 6.4, 7.0)); clipPlane.constant = build * 470;
  ringY.visible = t > 6.4 && t < 7.1; ringY.position.set(250, build * 470, 1000); ringY.material.opacity = 0.9 * (1 - build * 0.6);
  // pierres
  for (const s of stones) {
    const u = s.userData, id = u.pack + '.' + (u.k + 1);
    if (!live) {
      const drop = eout(seg(t, 3.1 + u.delay * 0.8, 3.5 + u.delay * 0.8)), bounce = Math.sin(seg(t, 3.5 + u.delay * 0.8, 3.7 + u.delay * 0.8) * Math.PI) * 18;
      s.position.set(u.x, u.h + (1 - drop) * 1400 + bounce, u.y); s.rotation.set(0, u.pack === 'P9' || u.pack === 'P10' ? Math.PI / 2 : 0, 0); s.scale.set(1, 1, 1);
      s.visible = t >= 3.1 + u.delay * 0.8; continue;
    }
    const b = stoneSample(id, mt); s.visible = !!b && t < SH.I[1]; if (!b) continue;
    // boîte réelle : empreinte 2·hl × 2·hn, hauteur top-bottom, angle du grand côté
    s.position.set(b[0], b[2], b[1]); s.rotation.set(0, -b[6] * Math.PI / 180, 0); s.scale.set(b[3] / 320, b[5] / 110, b[4] / 110);
  }
  // traces
  const nT = Math.max(1, Math.floor(mt / 0.05) + 1);
  trailY.visible = trailB.visible = live && t < SH.I[0] + 0.5;
  trailY.geometry.setDrawRange(0, nT); trailB.geometry.setDrawRange(0, nT);
  trailB.material.opacity = IN(t, 'B') ? 1 : 0.65; trailY.material.opacity = 0.55;
  // radar (arrêt sur image)
  rays.visible = IN(t, 'D') && t > 15.0;
  if (rays.visible) {
    const pa = rays.geometry.attributes.position.array, rk = eout(seg(t, 15.0, 15.4)), d3 = DEC[2];
    for (let i = 0; i < 8; i++) { const a = (yp.h + i * 45) * Math.PI / 180, d = d3.obs[48 + i] * 1000 * rk; pa.set([yp.x, 60, yp.y, yp.x + d * Math.cos(a), 60, yp.y + d * Math.sin(a)], i * 6); }
    rays.geometry.attributes.position.needsUpdate = true;
  }
  for (const id in ZONE) ZONE[id].material.opacity = 0;
  // table
  topMat.opacity = eout(seg(t, 2.6, 3.4));
  borders.forEach(b => { b.scale.y = Math.max(0.001, eout(seg(t, 2.8, 3.4))); b.position.y = 35 * b.scale.y; });
  glowLines.forEach((l, i) => l.geometry.setDrawRange(0, Math.max(0, Math.round(l.userData.n * seg(t, 2.45 + i * 0.03, 3.3 + i * 0.03)))));
  table.visible = t >= SH.world[0] - 0.1;
  // grille d'entraînement
  gridGroup.visible = t >= SH.I[0] - 0.1;
  if (gridGroup.visible) {
    const { robY, robB } = gridGroup.userData, m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (const c of clones) {
      const u = ((t - SH.I[0]) * 0.45 + c.ph) % 1, [x, y] = pathAt(c.path, u), [xb, yb] = pathAt(c.pathB, (u + 0.37) % 1);
      q.setFromAxisAngle(V(0, 1, 0), u * 6); m4.compose(V(x + c.ox, 56, y + c.oy), q, V(1, 1, 1)); robY.setMatrixAt(c.ci, m4);
      m4.compose(V(xb + c.ox, 130, yb + c.oy), q, V(1, 1, 1)); robB.setMatrixAt(c.ci, m4);
    }
    robY.instanceMatrix.needsUpdate = robB.instanceMatrix.needsUpdate = true;
    const op = eout(seg(t, SH.I[0], SH.I[0] + 0.8));
    gridGroup.children.forEach(o => { if (!o.isInstancedMesh && o.material) o.material.opacity = op * (o.isLine ? 0.7 : 1); });
  }

  // --- caméras
  let scene = world, netFull = false, pip = false;
  if (t < SH.world[0]) {
    scene = voidScene; const q = seg(t, 0, SH.hook[1]);
    look(V(0, 0, 2000 - 15000 * Math.pow(q, 2.2)), V(0, 0, -20000 - 15000 * q), 50);
  } else if (t < SH.reveal[0]) {
    const q = eio(seg(t, SH.world[0], SH.world[1]));
    const pos = orbit(1500, 1000, lerp(2300, 3300, q), lerp(2.6, 1.65, q), lerp(200, 2300, Math.pow(q, 1.2))).add(drift(t, 1.5));
    look(pos, tab(lerp(600, 1450, q), lerp(1200, 1000, q), 0), lerp(48, 42, q), lerp(0.1, -0.02, q));
  } else if (t < SH.go[0]) {
    if (t < 6.4) { const q = eio(seg(t, 5.4, 6.4)); look(orbit(2750, 1000, lerp(1300, 850, q), lerp(2.5, 3.6, q), lerp(700, 420, q)).add(drift(t)), tab(2750, 1000, 170), 38, lerp(-0.06, 0.04, q)); }
    else { const q = eio(seg(t, 6.4, 7.6)); const p0 = orbit(2750, 1000, 850, 3.6, 420), p1 = V(1500, 1300, 650), p2 = orbit(250, 1000, 900, -0.3, 480);
      look(cubic(p0, p1, p2, clamp(q * 1.5)).add(drift(t)), tab(lerp(2750, 250, eio(clamp(q * 1.8))), 1000, 170), 40, Math.sin(clamp(q * 1.5) * Math.PI) * -0.14); }
  } else if (t < SH.B[0]) {
    const q = eio(seg(t, SH.go[0], SH.B[0]));
    look(orbit(1500, 900, lerp(2700, 3000, q), lerp(1.95, 1.45, q), lerp(1900, 2300, q)).add(drift(t, 2)), tab(1500, 800, 0), 44, lerp(0.05, -0.03, q));
  } else if (t < SH.C[0]) {
    // caméra embarquée derrière l'adversaire : on suit sa trajectoire au ralenti
    const q = seg(t, SH.B[0], SH.B[1]), a = bp.h * Math.PI / 180, fx = Math.cos(a), fy = Math.sin(a);
    const back = lerp(900, 520, eio(q)), hh = lerp(520, 360, eio(q));
    const pos = tab(bp.x - fx * back + fy * 160, bp.y - fy * back - fx * 160, hh).add(shake(t, 4));
    look(pos, tab(bp.x + fx * 900, bp.y + fy * 900, 120), lerp(52, 60, q), Math.sin(t * 1.3) * 0.03);
  } else if (t < SH.D[0]) {
    // accélération ×3 : la caméra s'arrache vers le haut
    const q = eio(seg(t, SH.C[0], SH.C[1])), a = bp.h * Math.PI / 180;
    const p0 = tab(bp.x - Math.cos(a) * 520, bp.y - Math.sin(a) * 520, 360), p1 = orbit(1450, 820, 1700, 1.2, 3300);
    look(p0.lerp(p1, q).add(shake(t, 18 * (1 - q))), tab(lerp(bp.x, 1450, q), lerp(bp.y, 820, q), 0), lerp(60, 48, q), (1 - q) * 0.1);
  } else if (t < SH.E[0]) {
    // arrêt sur image : la caméra tourne autour de la table figée
    const q = seg(t, SH.D[0], SH.D[1]);
    look(orbit(1450, 820, lerp(1700, 1450, q), lerp(1.2, 2.0, eio(q)), lerp(3300, 3100, q)).add(drift(t, 1)), tab(1450, 820, 0), 48);
  } else if (t < SH.G[0]) {
    netFull = true; scene = null;
  } else if (t < SH.H[0]) {
    // exécution : on suit notre robot jusqu'au mur
    const q = seg(t, SH.G[0], SH.G[1]);
    look(orbit(yp.x, yp.y, lerp(1500, 900, eio(q)), lerp(2.3, 1.85, q), lerp(1100, 520, eio(q))).add(drift(t, 1)), tab(yp.x - 80, yp.y - 60, 140), lerp(40, 46, q), lerp(0.03, -0.02, q));
  } else if (t < SH.I[0]) {
    pip = t < 23.7;
    const q = eio(seg(t, SH.H[0], SH.H[1]));
    look(orbit(lerp(700, 640, q), lerp(900, 1150, q), lerp(1500, 1250, q), lerp(-0.3, 0.55, q), lerp(900, 650, q)).add(drift(t, 1.5)), tab(yp.x, yp.y, 120), 44, lerp(-0.04, 0.04, q));
  } else {
    const q = eio(seg(t, SH.I[0], 30)), p0 = orbit(640, 1150, 1250, 0.55, 650);
    look(V(lerp(p0.x, 1500, q), lerp(p0.y, 22000, Math.pow(q, 1.25)), lerp(p0.z, 1000 + 9000, q)).add(drift(t, 3)), tab(lerp(yp.x, 1500, q), lerp(yp.y, 1000, q), 0), lerp(44, 42, q), q * 0.08);
  }
  dust.rotation.z = t * 0.03;

  // --- rendu
  renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H);
  renderer.setClearColor(netFull ? 0x02060d : C.bg, 1); renderer.clear();
  if (scene) renderer.render(scene, camera);
  if (netFull) {
    const q = seg(t, SH.E[0], SH.F[1]);
    netFrameP(t, 2, seg(t, 16.15, 18.5), 1);
    const zz = eio(seg(t, 17.9, 18.7)), win = net.layers[3][DEC[2].idx].p;
    let pos = V(lerp(-2300, 2300, eio(clamp(q * 1.25))), lerp(420, 150, q), lerp(2300, 2500, q)), tgt = V(lerp(-1100, 900, eio(clamp(q * 1.3))), 0, 0);
    if (t > 18.6) { pos = win.clone().add(V(900, 120, 900)); tgt = win.clone(); }
    look(pos.add(drift(t * 1.4, 3)), tgt, 44, 0, netCam);
    renderer.render(netScene, netCam);
  }
  if (pip) {
    const pw = 640, ph = 360, px = W - pw - 60, py = 130;
    netFrameP(t, 3, seg(t, 22.65, 23.45), 1);
    look(V(700, 250, 3300), V(-100, 0, 0), 40, 0, netCam, pw, ph);
    renderer.setScissorTest(true); renderer.setViewport(px, H - py - ph, pw, ph); renderer.setScissor(px, H - py - ph, pw, ph);
    renderer.setClearColor(0x02060d, 1); renderer.clear(); renderer.render(netScene, netCam);
    renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H);
  }
  // --- notre robot : silhouette unie, pixelisée puis floutée selon sa taille à l'écran
  const robotOn = scene === world && t >= 6.4 && t < SH.I[0] + 0.4;
  if (robotOn) {
    const c = proj(robot.position.clone().add(V(0, 170, 0))), e = proj(robot.position.clone().add(V(240, 170, 0)).add(V(0, 0, 0)));
    const e2 = proj(robot.position.clone().add(V(0, 400, 0)));
    const rpx = Math.max(Math.hypot(e.x - c.x, e.y - c.y), Math.hypot(e2.x - c.x, e2.y - c.y), 4);
    if (c.z < 1) {
      rRenderer.render(robotScene, camera);
      const tw = Math.round(clamp(W * 5 / (2 * rpx), 16, 480)), th = Math.max(9, Math.round(tw * H / W));
      if (tiny.width !== tw) { tiny.width = tw; tiny.height = th; }
      tctx.clearRect(0, 0, tw, th); tctx.drawImage(rcv, 0, 0, tw, th);
      const bl = Math.max(5, rpx * 0.45);
      g.save(); g.imageSmoothingEnabled = true; g.filter = `blur(${bl * DPR}px)`;
      g.drawImage(tiny, 0, 0, W * DPR, H * DPR); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.35; g.drawImage(tiny, 0, 0, W * DPR, H * DPR); g.restore();
    }
  }
  hudFrame(t, mt, yp, bp);
}

function netFrameP(t, k, p, nf) {
  const ap = 1, cur = DEC[k], prev = k > 0 ? DEC[k - 1] : null;
  net.layers.forEach((Lr, L) => {
    const a0 = 0.05 + 0.22 * L, mix = eout(seg(p, a0, a0 + 0.2)), spark = Math.sin(seg(p, a0, a0 + 0.2) * Math.PI);
    Lr.forEach((o, i) => {
      const A = nodeVis(L, i, prev), B = nodeVis(L, i, cur);
      const v = lerp(A.v, B.v, mix), col = (A.col || B.col).clone().lerp(B.col || A.col, mix);
      const base = L === 3 && i === cur.idx ? lerp(9, 22, mix) : L === 2 ? 9 : 8;
      o.m.material.color.copy(col); o.m.material.opacity = nf * (0.25 + 0.75 * v);
      o.m.scale.setScalar(base * (0.6 + 0.9 * v) + spark * 8 * v);
    });
  });
  net.sets.forEach((set, j) => set.forEach((l, L) => {
    const a0 = 0.15 + 0.22 * L; let op = 0, n = 0;
    if (j === k) { op = 0.95 * eout(seg(p, a0, a0 + 0.22)) * (1 - 0.5 * seg(p, 0.92, 1)); n = Math.round(l.userData.n * eout(seg(p, a0, a0 + 0.25))); }
    l.material.opacity = op * nf; l.geometry.setDrawRange(0, n * 2); l.visible = op > 0.002;
  }));
  net.loop.material.opacity = 0.55 * nf; net.loop.rotation.x = t * 1.5;
  const pa = net.pulses.geometry.attributes.position.array;
  for (let i = 0; i < 900; i++) {
    const L = i % 3, set = net.sets[k][L], a0 = 0.15 + 0.22 * L;
    if (p < a0 || p > a0 + 0.45) { pa[i * 3 + 1] = 1e6; continue; }
    const li = Math.floor(i / 3) % set.userData.n, [a, b] = set.userData.list[li], u = (seg(p, a0, a0 + 0.45) * 2.2 + (i * 0.618) % 1) % 1;
    const P = set.userData.A[a].p.clone().lerp(set.userData.B[b].p, u); pa.set([P.x, P.y, P.z], i * 3);
  }
  net.pulses.geometry.attributes.position.needsUpdate = true; net.pulses.material.opacity = nf;
  const wp = net.layers[3][cur.idx].p, hk = seg(p, 0.8, 0.95); net.halo.position.copy(wp); net.halo.lookAt(netCam.position); net.halo.material.opacity = hk * nf; net.halo.scale.setScalar(1 + hk + 0.25 * Math.sin(t * 9));
}

// ------------------------------------------------------------------ HUD
const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');
const fmtMm = v => Math.round(v).toLocaleString('fr-FR').replace(/ | /g, ' ');
function projN(v) { const p = v.clone().project(netCam); return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H, z: p.z }; }
function stamp(str, x, y, k, rot = -0.08) {
  if (k <= 0) return; const s = lerp(1.6, 1, eoutx(k));
  g.save(); g.translate(x * DPR, y * DPR); g.rotate(rot); g.scale(s, s); g.globalAlpha = clamp(k * 1.5);
  g.font = F(800, 30, 'Inter'); g.letterSpacing = (6 * DPR) + 'px'; const w = g.measureText(str).width;
  g.strokeStyle = '#ff4d5e'; g.lineWidth = 3 * DPR; g.strokeRect(-w / 2 - 18 * DPR, -30 * DPR, w + 36 * DPR, 46 * DPR);
  g.fillStyle = '#ff4d5e'; g.textAlign = 'center'; g.fillText(str, 0, 4 * DPR); g.restore();
}
function speedLines(a, seed) {
  if (a <= 0) return; const r = rng(seed); g.save(); g.globalAlpha = a; g.strokeStyle = '#bfefff';
  for (let i = 0; i < 70; i++) { const y = r() * H, x = r() * W, l = 120 + r() * 420; g.lineWidth = (0.6 + r() * 1.8) * DPR; g.beginPath(); g.moveTo(x * DPR, y * DPR); g.lineTo((x + l) * DPR, y * DPR); g.stroke(); }
  g.restore();
}
function badge(str, x, y, col, bg, a) {
  if (a <= 0) return; g.save(); g.font = F(800, 24, 'Inter'); g.letterSpacing = (3 * DPR) + 'px'; const w = g.measureText(str).width / DPR + 40; g.restore();
  rect(x - w, y, w, 50, bg, a, col); text(str, x - w / 2, y + 34, { size: 24, weight: 800, align: 'center', track: 3, alpha: a, color: '#fff', fam: 'Inter' });
}
function bracket(x, y, r, col, a) { const s = r * 0.45; for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { line(x + sx * r, y + sy * r, x + sx * (r - s), y + sy * r, col, a, 3); line(x + sx * r, y + sy * r, x + sx * r, y + sy * (r - s), col, a, 3); } }
function bigWord(str, y, size, k, col = CSS.white, seed = 1) {
  if (k <= 0) return; const s = lerp(1.35, 1, eoutx(k));
  g.save(); g.translate(W / 2 * DPR, y * DPR); g.scale(s, s); g.translate(-W / 2 * DPR, -y * DPR);
  glitchTitle(str, W / 2, y, size, k, seed, { color: col }); g.restore();
}

function hudFrame(t, mt, yp, bp) {
  // accroche
  if (t < SH.world[0] + 0.3) {
    const out = 1 - seg(t, 2.0, 2.4);
    text('ICAM LOT  ·  EUROBOT 2027', W / 2, 390, { size: 22, weight: 600, align: 'center', track: 8, color: CSS.cyan, alpha: seg(t, 0.1, 0.4) * out, fam: 'Inter' });
    text(typeOn('On vous dévoile', seg(t, 0.15, 0.6)), W / 2, 480, { size: 54, weight: 500, align: 'center', alpha: out });
    bigWord('LA PLUS GRANDE TECHNO', 600, 118, seg(t, 0.65, 1.1) * out, CSS.white, Math.floor(t * 30));
    text(typeOn('prévue sur notre robot', seg(t, 1.15, 1.6)), W / 2, 690, { size: 54, weight: 500, align: 'center', alpha: out, color: CSS.yellow });
    flash(Math.max(0, 0.55 - Math.abs(t - 0.7) * 3), '56,225,255');
    flash(seg(t, 2.25, 2.4) * 0.9 * (1 - seg(t, 2.4, 2.7)));
    flash((1 - seg(t, 2.4, 2.7)) * (t >= 2.4 ? 0.9 : 0));
  }
  const brand = t > SH.world[0] && t < SH.J[0];
  if (brand) {
    const w1 = text('ICAM LOT', 80, 78, { size: 22, weight: 800, track: 6, alpha: 0.95, fam: 'Inter' });
    text('EUROBOT 2027', 80 + w1 + 18, 78, { size: 22, weight: 500, track: 6, color: CSS.dim, alpha: 0.95, fam: 'Inter' });
    const lab = IN(t, 'E') || IN(t, 'F') ? 'RÉSEAU DE NEURONES' : IN(t, 'B') ? 'CAMÉRA EMBARQUÉE · ADVERSAIRE' : 'SIMULATION';
    const w2 = text(lab, W - 80, 78, { size: 20, weight: 600, track: 4, align: 'right', alpha: 0.9, fam: 'Inter' });
    dot(W - 80 - w2 - 18, 71, 5, CSS.red, 0.6 + 0.4 * Math.sin(t * 6));
  }
  // le monde
  if (IN(t, 'world')) {
    const a1 = fadeIO(t, 2.6, 4.1, 0.25, 0.25), a2 = fadeIO(t, 4.0, 5.4, 0.25, 0.3);
    text(typeOn('Avant de rouler sur la vraie table…', seg(t, 2.6, 3.2)), W / 2, 930, { size: 52, weight: 700, align: 'center', alpha: a1 });
    text(typeOn('…il s\'entraîne dans un monde virtuel.', seg(t, 4.05, 4.6)), W / 2, 930, { size: 52, weight: 700, align: 'center', alpha: a2, color: CSS.cyan });
    const ca = 1 - seg(t, 5.1, 5.4);
    chip('TABLE EUROBOT 2027 · 3 000 × 2 000 MM', 80, 130, seg(t, 3.0, 3.4) * ca);
    chip('30 PIERRES · 10 CARRIÈRES', 80, 182, seg(t, 3.4, 3.8) * ca, CSS.yellow);
    chip('1 MATCH = 100 SECONDES', 80, 234, seg(t, 3.8, 4.2) * ca, CSS.white);
  }
  // présentation des robots
  if (IN(t, 'reveal')) {
    callout(tab(2750, 1000, 450), -230, -150, 'Adversaire simulé', 'robot à 4 roues · modèle fictif', seg(t, 5.7, 6.2) * (1 - seg(t, 6.3, 6.5)), CSS.blue);
    const rk = seg(t, 6.9, 7.2) * (1 - seg(t, 7.45, 7.6)), rp = proj(tab(250, 1000, 560));
    if (rk > 0 && rp.z < 1) { text('NOTRE ROBOT', rp.x, Math.max(150, rp.y - 40), { size: 30, weight: 800, align: 'center', track: 5, alpha: rk, glow: 10 }); stamp('DESIGN CONFIDENTIEL', rp.x, Math.max(200, rp.y + 10), seg(t, 6.95, 7.25) * (1 - seg(t, 7.45, 7.6))); }
  }
  // départ
  if (t >= SH.go[0] && t < 8.5) { bigWord('GO', 560, 220, seg(t, 7.6, 7.75) * (1 - seg(t, 8.1, 8.5)), CSS.yellow, Math.floor(t * 30)); flash((1 - seg(t, 7.6, 7.85)) * 0.8, '242,183,5'); }
  // chrono et vitesse pendant le match
  const matchShot = t >= SH.go[0] && t < SH.I[0] && !IN(t, 'E') && !IN(t, 'F');
  if (matchShot) {
    const a = seg(t, 7.7, 8.0) * (1 - seg(t, 24.0, 24.2));
    rect(W / 2 - 150, 104, 300, 82, 'rgba(4,10,20,0.78)', a, 'rgba(56,225,255,0.6)');
    text('TEMPS RESTANT', W / 2, 130, { size: 15, weight: 700, track: 4, align: 'center', color: CSS.cyan, alpha: a, fam: 'Inter' });
    text(fmt(100 - mt, 2) + ' s', W / 2, 174, { size: 42, weight: 800, align: 'center', alpha: a });
    const sp = speedAt(t);
    const s = sp < 0.01 ? ['ARRÊT SUR IMAGE', CSS.yellow, 'rgba(242,183,5,0.18)'] : sp < 0.9 ? ['RALENTI ×' + fmt(sp), CSS.red, 'rgba(255,90,106,0.18)'] : ['VITESSE ×' + fmt(sp), CSS.cyan, 'rgba(56,225,255,0.12)'];
    if (!IN(t, 'H') || t > 23.7) badge(s[0], W - 80, 112, s[1], s[2], a);
    // position de l'adversaire en continu
    rect(62, H - 168, 470, 96, 'rgba(4,10,20,0.75)', a, 'rgba(91,147,255,0.6)');
    text('ADVERSAIRE · POSITION LIDAR', 80, H - 138, { size: 15, weight: 700, track: 3, color: CSS.blue, alpha: a, fam: 'Inter' });
    text(`x ${fmtMm(bp.x)} mm   y ${fmtMm(bp.y)} mm`, 80, H - 98, { size: 30, weight: 700, alpha: a, fam: 'Inter' });
  }
  if (IN(t, 'A')) text('Match simulé dans notre moteur · cerveau en cours d\'entraînement', W - 80, H - 60, { size: 16, weight: 500, align: 'right', color: CSS.dim, alpha: seg(t, 8.0, 8.3), fam: 'Inter' });
  // caméra embarquée : verrouillage lidar
  if (IN(t, 'B')) {
    const k = seg(t, 9.5, 9.9) * (1 - seg(t, 11.7, 11.9));
    sectionTitle('', 'DANS LA ROUE DE L\'ADVERSAIRE', k);
    text('on suit sa trajectoire au ralenti', 80, 252, { size: 24, weight: 500, color: CSS.dim, alpha: k, fam: 'Inter' });
    const yo = proj(robot.position.clone().add(V(0, 200, 0)));
    if (yo.z < 1) { bracket(yo.x, yo.y, 60 + 6 * Math.sin(t * 8), CSS.yellow, k); text('NOTRE ROBOT', yo.x, yo.y - 78, { size: 18, weight: 800, align: 'center', track: 3, color: CSS.yellow, alpha: k, fam: 'Inter' }); }
    const d = Math.hypot(bp.x - (robot.position.x), bp.y - robot.position.z) / 1000;
    text(`distance entre les robots : ${fmt(d, 2)} m`, W / 2, H - 120, { size: 30, weight: 700, align: 'center', alpha: k, fam: 'Inter' });
  }
  if (IN(t, 'C')) { speedLines(0.35 * Math.sin(seg(t, 11.9, 12.6) * Math.PI), Math.floor(t * 30)); bigWord('×3', 560, 160, Math.sin(seg(t, 11.9, 12.6) * Math.PI), CSS.cyan, Math.floor(t * 30)); }
  // arrêt sur image : état des lieux des 56 entrées
  if (IN(t, 'D')) inventory(t, yp, bp);
  // le réseau décide
  if (IN(t, 'E') || IN(t, 'F')) networkHud(t);
  // exécution
  if (IN(t, 'G')) {
    const k = seg(t, 20.05, 20.4) * (1 - seg(t, 22.4, 22.6));
    chip('EXÉCUTION · MUR M1 · EXT · FACE A', 80, 130, k, '#ffd84d');
    const pk = seg(t, 22.55, 22.6), pp = proj(tab(yp.x, yp.y, 500));
    if (t > 22.1) { const q = seg(t, 22.1, 22.6); text(`+${DEC[2].reward} PTS`, W / 2, 330 - 60 * q, { size: 64, weight: 800, align: 'center', color: CSS.yellow, alpha: Math.sin(q * Math.PI * 0.9 + 0.2), glow: 16 }); }
  }
  if (IN(t, 'H')) {
    const k = seg(t, 22.65, 22.9) * (1 - seg(t, 23.9, 24.2));
    if (t < 23.7) { rect(W - 700, 130, 640, 360, null, k, CSS.cyan); text('DÉCISION 4', W - 680, 160, { size: 16, weight: 700, track: 4, color: CSS.cyan, alpha: k, fam: 'Inter' }); }
    const n = seg(t, 23.3, 23.5) * (1 - seg(t, 23.95, 24.2));
    bigWord('MUR M4', 520, 120, n, CSS.white, Math.floor(t * 30) + 2);
    text(`extérieur · face B · certitude ${fmt(DEC[3].top3[0][2] * 100)} %`, W / 2, 590, { size: 30, weight: 600, align: 'center', color: CSS.cyan, alpha: n, fam: 'Inter' });
    const pp = proj(tab(yp.x, yp.y, 500)); if (t > 23.8) { const q = seg(t, 23.8, 24.2); text(`+${DEC[3].reward} PTS`, W / 2, 700 - 60 * q, { size: 64, weight: 800, align: 'center', color: CSS.yellow, alpha: Math.sin(q * Math.PI * 0.9 + 0.2), glow: 16 }); }
  }
  // entraînement
  if (IN(t, 'I') || (t >= SH.J[0] && t < 28.2)) {
    const out = 1 - seg(t, 27.5, 28.0), kk = seg(t, 24.4, 24.9);
    { const bk = kk * out; const gr = g.createLinearGradient(0, 360 * DPR, 0, 680 * DPR); gr.addColorStop(0, 'rgba(2,4,10,0)'); gr.addColorStop(0.3, `rgba(2,4,10,${0.72 * bk})`); gr.addColorStop(0.75, `rgba(2,4,10,${0.72 * bk})`); gr.addColorStop(1, 'rgba(2,4,10,0)'); g.fillStyle = gr; g.fillRect(0, 360 * DPR, W * DPR, 320 * DPR); }
    bigWord('ON L\'ENTRAÎNE VIRTUELLEMENT', 470, 84, kk * out, CSS.white, Math.floor(t * 30) + 7);
    text(typeOn('Des matchs simulés en parallèle, en continu.', seg(t, 24.9, 25.5)), W / 2, 560, { size: 34, weight: 600, align: 'center', alpha: out });
    text(typeOn('Chaque point marqué le récompense : il apprend par renforcement.', seg(t, 25.5, 26.3)), W / 2, 612, { size: 30, weight: 500, align: 'center', color: CSS.cyan, alpha: out, fam: 'Inter' });
    const pts = ['+5 mur', '+5 tour', '+20 porte', '+1 pierre', '+5 Graal', '+10 trône', '+20 boulets'];
    clones.forEach((c, i) => {
      const ph = ((t - SH.I[0]) * 0.45 + c.ph) % 1, near = Math.abs(ph - 0.66);
      if (near < 0.06 && t > 24.5) { const [x, y] = pathAt(c.path, ph), p = proj(tab(x + c.ox, y + c.oy, 400)); if (p.z < 1) text(pts[i % pts.length], p.x, p.y - (0.06 - near) * 300, { size: 20, weight: 800, align: 'center', color: CSS.yellow, alpha: (1 - near / 0.06) * out, fam: 'Inter' }); }
    });
  }
  if (t >= SH.J[0]) {
    const kk = seg(t, 27.7, 28.2), d = seg(t, 27.4, 28.1);
    g.fillStyle = `rgba(2,4,10,${0.8 * d})`; g.fillRect(0, 0, W * DPR, H * DPR);
    bigWord('DEVENEZ SPONSOR', 520, 130, kk, CSS.yellow, Math.floor(t * 30) + 3);
    text(typeOn('Aidez-nous à entraîner le cerveau de notre robot.', seg(t, 28.2, 28.9)), W / 2, 610, { size: 38, weight: 600, align: 'center', alpha: seg(t, 28.1, 28.3) });
    const b = seg(t, 28.8, 29.2);
    line(W / 2 - 160 * b, 668, W / 2 + 160 * b, 668, CSS.cyan, b, 2);
    text('ICAM LOT  ·  EUROBOT 2027', W / 2, 720, { size: 28, weight: 700, align: 'center', track: 8, alpha: b, color: CSS.cyan, fam: 'Inter' });
  }
  // transitions éclair
  for (const c of [SH.B[0], SH.D[0], SH.E[0], SH.G[0], SH.H[0], SH.I[0]]) flash(Math.max(0, 0.75 - Math.abs(t - c) * 6), '210,245,255');
  vignette(0.6);
  scanlines(t < SH.world[0] ? 0.18 : 0.06);
}

// --- arrêt sur image : chaque groupe d'entrées est montré à sa place sur la table
const CUM = [1, 5, 15, 21, 30, 34, 35, 37, 48, 56];
function inventory(t, yp, bp) {
  const d = DEC[2], o = d.obs, out = 1 - seg(t, 15.85, 16.0), T0 = 12.75, STEP = 0.29;
  const k = i => seg(t, T0 + i * STEP, T0 + i * STEP + 0.25) * out;
  sectionTitle('', 'ARRÊT SUR IMAGE · t = ' + fmt(d.t, 2) + ' s', seg(t, 12.6, 12.9) * out);
  text('état des lieux de tout ce que le robot perçoit', 80, 252, { size: 24, weight: 500, color: CSS.dim, alpha: seg(t, 12.7, 13.0) * out, fam: 'Inter' });
  let n = 0; CUM.forEach((c, i) => { if (t >= T0 + i * STEP) n = c; });
  text('ENTRÉES', W - 80, 210, { size: 16, weight: 700, track: 4, align: 'right', color: CSS.cyan, alpha: out, fam: 'Inter' });
  text(`${n} / 56`, W - 80, 275, { size: 64, weight: 800, align: 'right', alpha: out, glow: 10 });
  const at = (x, y, z, lab, val, i, col, dx = 0, dy = -70) => {
    const kk = k(i); if (kk <= 0) return; const p = proj(tab(x, y, z)); if (p.z > 1) return;
    dot(p.x, p.y, 5, col, kk); line(p.x, p.y, p.x + dx, p.y + dy, col, kk * 0.9, 2);
    const ax = dx < 0 ? 'right' : dx > 0 ? 'left' : 'center', tx = p.x + dx + (dx < 0 ? -8 : dx > 0 ? 8 : 0);
    text(lab, tx, p.y + dy - 30, { size: 14, weight: 700, track: 2, align: ax, color: col, alpha: kk, fam: 'Inter' });
    text(typeOn(val, kk * 1.6), tx, p.y + dy - 4, { size: 24, weight: 800, align: ax, alpha: kk, fam: 'Inter' });
  };
  const cap = Math.round(Math.atan2(o[4], o[3]) * 180 / Math.PI);
  // 1 temps (affiché au centre) — 2 position — 3 paquets — 4 pinces — 5 constructions — 6 Graal — 7 boulets — 8 adversaire — 9 état fin — 10 radar
  { const q = k(0) * (1 - seg(t, T0 + 0.5, T0 + 0.9)); if (q > 0) { rect(W / 2 - 158, 96, 316, 98, null, q, CSS.yellow); text('ENTRÉE 1 · TEMPS RESTANT', W / 2, 222, { size: 15, weight: 700, track: 3, align: 'center', color: CSS.yellow, alpha: q, fam: 'Inter' }); } }
  at(yp.x, yp.y, 420, 'NOTRE POSITION', `x ${fmtMm(o[1] * 3000)} · y ${fmtMm(o[2] * 2000)} · cap ${cap}°`, 1, CSS.yellow, -300, 150);
  SPEC.carrieres.forEach((p, j) => at(p.c[0], p.c[1], 360, p.id, `${Math.round(o[5 + j] * 3)}/3`, 2, Math.round(o[5 + j] * 3) ? CSS.white : CSS.red, 0, -40));
  at(yp.x, yp.y, 250, 'PINCES', `A ${Math.round(o[15] * 3)}/3 · B ${Math.round(o[18] * 3)}/3`, 3, '#2f9bff', 280, -90);
  const built = o.slice(21, 30).filter(v => v > 0).length;
  at(250, 400, 20, 'MURS ET TOURS', `${built} / 9 construits`, 4, '#ff8a3d', -40, -90);
  at(250, 1000, 20, 'GRAAL', o[30] ? 'au départ' : o[31] ? 'tenu' : 'posé', 5, '#e2a72e', 60, 80);
  at(250, 1000, 20, 'BOULETS', o[34] ? 'lâchés' : 'pas encore lâchés', 6, '#ffd84d', 60, 150);
  at(bp.x, bp.y, 480, 'ADVERSAIRE (LIDAR)', `x ${fmtMm(o[35] * 3000)} · y ${fmtMm(o[36] * 2000)}`, 7, CSS.blue, -80, -60);
  at(yp.x, yp.y, 120, 'ÉTAT FIN DES PINCES', `chariot ${Math.round(o[41] * 350)} mm · 6/6 ventouses actives`, 8, '#b58cff', 280, 110);
  if (k(9) > 0) for (let i = 0; i < 8; i++) {
    const a = (yp.h + i * 45) * Math.PI / 180, dd = o[48 + i] * 1000, p = proj(tab(yp.x + dd * Math.cos(a), yp.y + dd * Math.sin(a), 60));
    if (p.z < 1) { dot(p.x, p.y, 4, '#fff1a8', k(9)); text(fmtMm(dd) + ' mm', p.x + 8, p.y - 8, { size: 15, weight: 700, color: '#fff1a8', alpha: k(9), fam: 'Inter' }); }
  }
  if (k(9) > 0) text('RADAR · 8 DIRECTIONS', W / 2, H - 70, { size: 18, weight: 700, track: 4, align: 'center', color: '#fff1a8', alpha: k(9), fam: 'Inter' });
}

function networkHud(t) {
  const d = DEC[2], out = 1 - seg(t, 19.8, 20.0);
  if (t < SH.F[0]) {
    const k = seg(t, 16.05, 16.4);
    sectionTitle('', 'LE RÉSEAU DÉCIDE', k * (1 - seg(t, 18.4, 18.6)));
    const lab = (v, s1, s2, kk, col) => { const q = projN(v); kk *= (q.x < 720 && q.y < 280) ? 0 : 1; if (q.z < 1 && kk > 0 && q.x > 60 && q.x < W - 60) { text(s1, q.x, q.y, { size: 28, weight: 700, align: 'center', alpha: kk, color: col, glow: 6 }); if (s2) text(s2, q.x, q.y + 30, { size: 17, weight: 500, align: 'center', alpha: kk, color: CSS.dim, fam: 'Inter' }); } };
    const f = 1 - seg(t, 18.3, 18.6);
    lab(V(-1500, 990, 0), '56 entrées', 'l\'état des lieux', seg(t, 16.2, 16.5) * f, CSS.white);
    lab(V(-600, 520, 0), 'Encodeur', '128 neurones', seg(t, 16.6, 16.9) * f, CSS.cyan);
    lab(V(300, 470, 0), 'Mémoire GRU', 'garde le fil du match', seg(t, 17.1, 17.4) * f, '#7cf3c0');
    lab(V(1300, 470, 0), '130 actions', 'les impossibles sont masquées', seg(t, 17.6, 17.9) * f, CSS.white);
    text('liaisons : les plus fortes contributions réelles (activation × poids)', W / 2, H - 60, { size: 17, weight: 500, align: 'center', color: CSS.dim, alpha: k * f, fam: 'Inter' });
  } else {
    g.fillStyle = `rgba(2,6,13,${0.55 * seg(t, 18.6, 18.9)})`; g.fillRect(0, 0, W * DPR, H * DPR);
    const n = seg(t, 18.65, 18.85) * out, parts = d.label.split(' · ');
    text('DÉCISION', W / 2, 360, { size: 22, weight: 700, track: 8, align: 'center', color: '#ffd84d', alpha: n, fam: 'Inter' });
    bigWord(parts[0].toUpperCase(), 500, 150, n, CSS.white, Math.floor(t * 30) + 4);
    text(parts.slice(1).join(' · ').replace('ext', 'extérieur'), W / 2, 580, { size: 36, weight: 600, align: 'center', color: CSS.cyan, alpha: seg(t, 18.8, 19.0) * out, fam: 'Inter' });
    text(`certitude du réseau : ${fmt(d.top3[0][2] * 100)} %   ·   ${d.nValid} actions possibles sur 130`, W / 2, 640, { size: 24, weight: 500, align: 'center', alpha: seg(t, 18.95, 19.15) * out, fam: 'Inter' });
    d.top3.slice(1).forEach(([, lb, pr], j) => text(`${lb}   ${fmt(pr * 100)} %`, W / 2, 700 + j * 34, { size: 20, weight: 500, align: 'center', color: CSS.dim, alpha: seg(t, 19.1 + j * 0.1, 19.3 + j * 0.1) * out, fam: 'Inter' }));
  }
}

window.renderFrame = renderFrame;
await document.fonts.load(F(800, 40)); await document.fonts.load(F(600, 20, 'Inter'));
window.READY = true;
