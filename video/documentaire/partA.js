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
