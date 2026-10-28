
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
const DUREE = acc; window.DUREE = DUREE;
function cur(t) { for (const [id] of PLANS) if (t < PL[id][1]) return id; return 'END'; }
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
function renderFrame(t) {
  g.clearRect(0, 0, hud.width, hud.height); resetWorld();
  const id = cur(t), [t0, t1] = PL[id], tl = t - t0, d = t1 - t0, q = tl / d;
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
  // transitions : fondu au noir court entre plans
  const fin = 1 - seg(t, t1 - 0.18, t1), deb = seg(t, t0, t0 + 0.18);
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
    const lk = seg(tl, 2.6, 3.2); for (const p of SPEC.carrieres) label3(tab(p.c[0], p.c[1], 420), p.id, lk, CSS.yellow, 18);
    caption('Un match dure 100 secondes. Sur la table : 30 pierres de 320 × 110 × 110 mm, rangées par trois dans 10 carrières.', t, PL.S02[0] + 0.3, PL.S02[1]);
    return {};
  },
  // --- le barème : les constructions finales du match de référence
  S03(t, tl, d, q) {
    placeMatch(SOLO, 100);
    look(orbit(700, 1000, lerp(1900, 1650, eio(q)), lerp(1.2, 0.55, eio(q)), lerp(1500, 1250, q)).add(drift(t, 1)), tab(620, 950, 80), 44);
    renderWorld();
    const it = [
      [tab(679.3, 570.8, 340), 'Mur', '3 pierres à plat · +5 (+1 par pierre)', 0.4, -260, -110, CSS.yellow],
      [tab(850, 750, 340), 'Tour', '1 pierre debout · +5', 1.2, 230, -150, '#ff8a3d'],
      [tab(850, 1000, 440), 'Porte', '2 debout + 1 à plat · +20', 2.0, 250, -40, '#2f9bff'],
      [tab(326, 1057, 420), 'Graal', 'sur le toit du robot · +25', 2.8, -280, -120, '#e2a72e'],
      [tab(60, 1230, 5), 'Retour au trône', 'robot dans la salle du trône en fin de match · +10', 3.6, -60, 140, '#7cf3c0'],
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
    const mt = clamp(tl / (d - 0.8)) * 100, p = robotPose(SOLO, 'jaune', mt);
    placeMatch(SOLO, mt);
    look(orbit(lerp(900, 800, q), 1000, 2500, lerp(1.25, 1.75, eio(q)), 2200).add(drift(t, 1.5)), tab(lerp(p.x, 800, 0.6), lerp(p.y, 1000, 0.6), 0), 44);
    renderWorld();
    const sc = mt >= 100 ? 116 : liveScore(SOLO, 'jaune', mt);
    info(['CHRONO', fmt(100 - mt, 1) + ' s'], 70, 150, seg(tl, 0.2, 0.5), CSS.cyan, 240);
    info(['SCORE', String(sc) + ' pts'], 330, 150, seg(tl, 0.2, 0.5), CSS.yellow, 240);
    tag('ACCÉLÉRÉ ×' + fmt(100 / (d - 0.8), 0), W - 70, 110, seg(tl, 0.2, 0.5), CSS.cyan, 'right');
    if (mt >= 100) { const k = seg(tl, d - 0.8, d - 0.4); text('+55 en fin de match : Graal, trône, boulets', 330, 270, { size: 20, weight: 700, color: CSS.yellow, alpha: k, fam: 'Inter' }); }
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
    const seq = [[0, 1.2], [1, 2.3], [7, 3.4], [9, 4.5], [2, 5.6]], hiIdx = seq.reduce((a, [gi, s]) => tl >= s ? gi : a, -1);
    RAYS.visible = hiIdx === 9 || tl > 4.5; if (RAYS.visible) setRays(py, D6.obs.slice(48, 56).map(v => v * 1000), eout(seg(tl, 4.5, 5.0)));
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
    info(['RÉGLAGES DU RÉSEAU', '≈ 140 000 coefficients (140 035)'], 70, 140, seg(tl, 4.6, 5.0), CSS.cyan, 470);
    text('activations internes : illustration', 70, H - 40, { size: 15, weight: 500, color: CSS.dim, alpha: 0.9, fam: 'Inter' });
    caption('Chaque neurone additionne les entrées, chacune multipliée par un coefficient, puis transforme ce total. Ce sont ces coefficients que l\'entraînement ajustera.', t, PL.S13[0] + 0.3, PL.S13[1], { size: 34 });
    return {};
  },
  // --- sorties, filtre (masque réel à t = 0), choix
  S14(t, tl, d, q) {
    const dec = DEC_SOLO[0];
    netState(t, { appear: [1, 1, 1, 1], inputs: dec.obs, flow: 1, memory: 1, mask: tl > 3.2 ? dec.mask : null, win: tl > 4.6 ? dec.action : -1 });
    look(V(2000, 250, 3600).add(drift(t, 2)), V(0, 0, 0), 40, 0, netCam); netCam.setViewOffset(W, H, 0, 230, W, H); netCam.updateProjectionMatrix(); renderNet();
    g.fillStyle = 'rgba(2,6,13,0.55)'; g.fillRect(0, 560 * DPR, W * DPR, 520 * DPR);
    outputBars(160, 900, 1600, 230, { mask: dec.mask, maskOn: tl > 3.2, win: dec.action, showWin: tl > 4.6, seed: 9 }, seg(tl, 0.4, 1.0));
    text('130 NOTES · UNE PAR ACTION (prendre, mur, tour, porte, Graal, boulets, trône, trajets…)', 160, 620, { size: 18, weight: 700, track: 2, color: CSS.white, alpha: seg(tl, 0.5, 0.9), fam: 'Inter' });
    tag('À t = 0 S : 29 ACTIONS PERMISES SUR 130 (MESURÉ)', 160, 940, seg(tl, 3.3, 3.7), '#ff9aa5');
    tag('CHOIX : « ' + dec.label.toUpperCase() + ' »', W - 160, 940, seg(tl, 4.7, 5.1), '#ffd84d', 'right');
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
    const imit = tl < 3.0, k = DEC_SOLO.reduce((a, dd, i) => (SOLO.briques.jaune[i] && SOLO.briques.jaune[i].t0 <= mt ? i : a), 0), dec = DEC_SOLO[Math.min(k, DEC_SOLO.length - 1)];
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
    const k = seg(tl, 2.4, 3.0);
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
