
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
