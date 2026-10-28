
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
