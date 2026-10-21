/* Teaser sponsors : plans caméra, ralentis, floutage du robot et habillage, image par image.
   Chargé par render.mjs dans plateau/index.html une fois la stratégie simulée (window.__SIM).
   Les temps simulés viennent des étapes du simulateur ; les points, du barème (bareme.js) appliqué au résultat. */
var TEASER = (function () {
  var S = window.__SIM, THREE = S.THREE, R = S.getR();
  var FPS = 30, END = 30.9, DUR = END + 4.8, W = 1920, H = 1080;   /* END : début du carton de fin */
  var ORANGE = '#f19200', YELLOW = '#f7b500', INK = '#0b0c10';
  var FONT = '"Barlow Condensed", "Poppins", sans-serif', MONO = '"IBM Plex Mono", monospace';

  /* ---------- faits tirés de la simulation ---------- */
  function seg(re) {
    for (var i = 0; i < R.segs.length; i++) if (re.test(R.segs[i].label)) return R.segs[i];
    throw new Error('étape introuvable dans la simulation : ' + re + ' (le montage est calé sur strategie.json)');
  }
  var E = {
    contactP5: seg(/^Contact avec P5/), videP5: seg(/^Vide face B sur P5/),
    murM5: seg(/mur posé sur M5/), tourT1: seg(/: tour T1$/), tourT2: seg(/: tour T2$/),
    piliers: seg(/^2 piliers posés/), linteau: seg(/^Pose du linteau/), videGraal: seg(/^Vide sur le Graal/),
    poseGraal: seg(/^Pose du Graal/), trone: seg(/^Retour dans la salle du trône/),
    face: seg(/^Retour au trône : face C/), deploie: seg(/^Déploiement du canon/), volant: seg(/^Mise en route du canon/), tir: seg(/boulets tirés/)
  };
  /* boulets : tirés depuis la salle du trône pendant la phase d'attaque, arrêtés dans la cour adverse avant 100 s */
  var SHOTS_B = R.balls.shots || [];
  var STOPS = SHOTS_B.filter(function (b) { return b.cour && b.t >= 85 && b.t + b.tStop <= S.MATCH; }).map(function (b) { return b.t + b.tStop; }).sort(function (a, b) { return a - b; });
  var O = S.outcome(Math.min(R.T, S.MATCH)), SC = S.scoreOf(O);
  function group(name) { var g = SC.rows.filter(function (r) { return r[0] === name; })[0], n = 0; g[1].forEach(function (x) { n += x[2]; }); return { pts: n, rows: g[1] }; }
  function need(ok, what) { if (!ok) throw new Error('la simulation ne donne pas ' + what + ' : textes du teaser à revoir'); }
  need(['M1', 'M4', 'M5'].every(function (z) { return O.walls.indexOf(z) >= 0; }), 'les murs M1, M4, M5');
  need(['T1', 'T2', 'T4'].every(function (z) { return O.towers.indexOf(z) >= 0; }), 'les tours T1, T2, T4');
  need(O.doors.indexOf('M3') >= 0, 'la porte M3');
  var graal = group('Graal'), roi = group('Retour du roi'), lvl = +((graal.rows[1][1].match(/niveau (\d)/) || [])[1] || 0);
  need(lvl > 0 && roi.pts > 0, 'le Graal surélevé et le retour au trône');
  need(STOPS.length >= 3, 'au moins 3 boulets arrêtés dans la cour adverse');
  var PTS = {
    mur: BAREME.mur + 3 * BAREME.pierre, tour: BAREME.tour + BAREME.pierre, porte: BAREME.porte + 3 * BAREME.pierre,
    graal: graal.pts, roi: roi.pts, boulets: BAREME.boulet1 + BAREME.boulet3, total: SC.total
  };
  /* compteur : chaque construction compte au moment où le robot la pose (barème de bareme.js) */
  var GAINS = [
    [seg(/mur posé sur M5/).t1, PTS.mur], [seg(/: tour T4$/).t1, PTS.tour], [seg(/mur posé sur M1/).t1, PTS.mur],
    [E.tourT1.t1, PTS.tour], [E.tourT2.t1, PTS.tour], [seg(/mur posé sur M4/).t1, PTS.mur],
    [seg(/^Linteau posé/).t1, PTS.porte], [E.poseGraal.t1, PTS.graal], [E.trone.t1, PTS.roi],
    [STOPS[0], BAREME.boulet1], [STOPS[2], BAREME.boulet3]   /* 1er boulet arrêté chez l'adversaire, puis le 3e (bonus) */
  ];
  need(GAINS.reduce(function (a, g) { return a + g[1]; }, 0) === PTS.total, 'un total égal à la somme des actions');
  function earned(s) { var n = 0; GAINS.forEach(function (g) { if (s >= g[0] - 1e-6) n += g[1]; }); return n; }
  function fmt(t) { return (Math.round(t * 10) / 10).toFixed(1).replace('.', ','); }

  /* ---------- outils ---------- */
  function V(x, y, h) { return new THREE.Vector3(x - 1500, h, y - 1000); }
  function rob(s, h) { var p = R.poseAt(s); return V(p.x, p.y, h || 0); }
  function mix(a, b, u) { return a.clone().lerp(b, u); }
  function ease(u) { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); }
  function cam(p, t, fov) { return { p: p, t: t, fov: fov || 32 }; }
  /* caméra en orbite autour de (x, y, h) : distance d (mm), azimut az sur la table et élévation el (degrés) */
  function orb(x, y, h, d, az, el, fov) {
    var a = az * Math.PI / 180, e = el * Math.PI / 180;
    return cam(V(x + d * Math.cos(e) * Math.cos(a), y + d * Math.cos(e) * Math.sin(a), h + d * Math.sin(e)), V(x, y, h), fov);
  }

  /* ---------- montage : plans, temps simulé (ralentis) et caméras ----------
     keys : [temps vidéo, temps simulé] ; entre deux clés la vitesse est constante, adoucie aux raccords. */
  var SHOTS = [
    { id: 'ouverture', v0: 0, v1: 2.4, keys: [[0, 0], [2.4, 0]], grade: 0.62,
      cam: function (u) { var e = ease(u); return orb(250, 1000, 170, 1900 - 500 * e, 18 - 6 * e, 7, 30); } },
    { id: 'chiffre1', v0: 2.4, v1: 3.0, keys: [[2.4, 0], [3.0, 0]], grade: 0.38, flash: 1,
      cam: function (u) { return cam(V(1500, 1000 + 40 * u, 4300), V(1500, 1000, 0), 34); } },
    { id: 'chiffre2', v0: 3.0, v1: 3.6, keys: [[3.0, 0], [3.6, 0]], grade: 0.38, flash: 1,
      cam: function (u) { return orb(500, 1000, 150, 1600, 4 + 6 * u, 5, 32); } },
    { id: 'feux', v0: 3.6, v1: 4.3, keys: [[3.6, 0], [4.3, 0]], grade: 0.45, flash: 1,
      cam: function (u) { return orb(250, 1000, 170, 1300, 200 - 10 * u, 12, 34); } },
    { id: 'depart', v0: 4.3, v1: 6.6, keys: [[4.3, 0], [6.6, 1.72]], flash: 1, cap: ['DÉPART', 'Salle du trône', null],
      cam: function (u, s) { return cam(V(1450 - 60 * u, 1300, 380), rob(s, 150), 32); } },
    { id: 'prise', v0: 6.6, v1: 9.4, keys: [[6.6, 1.0], [7.3, E.contactP5.t0 - 0.05], [8.5, E.videP5.t0 + 0.1], [8.75, E.videP5.t1 + 0.05], [9.4, 3.16]], flash: 1,
      cap: ['PRISE', '3 pierres d\'un coup', null, E.contactP5.t0],
      cam: function (u) { return orb(760, 1820, 150, 1550 - 120 * u, 28 - 6 * u, 30, 30); } },
    { id: 'mur', v0: 9.4, v1: 12.6, keys: [[9.4, 7.2], [9.9, E.murM5.t0 - 0.3], [11.9, E.murM5.t1 + 0.05], [12.6, 9.1]], flash: 1,
      cap: ['MUR', '3 pierres empilées', PTS.mur, E.murM5.t0],
      cam: function (u) { return orb(250, 1560, 180, 1400 - 120 * u, 62 - 6 * u, 13, 30); } },
    { id: 'tour1', v0: 12.6, v1: 13.7, keys: [[12.6, E.tourT1.t0 - 0.35], [13.7, E.tourT1.t1 + 0.1]], flash: 1,
      cap: ['TOURS', '1 pierre debout', PTS.tour, E.tourT1.t0 - 0.35],
      cam: function (u) { return orb(500, 440, 140, 1150, -32 + 6 * u, 22, 32); } },
    { id: 'tour2', v0: 13.7, v1: 14.8, keys: [[13.7, E.tourT2.t0 - 0.35], [14.8, E.tourT2.t1 + 0.1]], flash: 1, capKeep: 'tour1',
      cam: function (u) { return orb(840, 745, 150, 1150, 18 - 6 * u, 18, 32); } },
    { id: 'piliers', v0: 14.8, v1: 16.0, keys: [[14.8, E.piliers.t0 - 0.75], [16.0, E.piliers.t1 + 0.05]], flash: 1,
      cam: function (u) { return orb(850, 1000, 200, 1600 - 150 * u, 12 - 6 * u, 32, 30); } },
    { id: 'linteau', v0: 16.0, v1: 20.0, keys: [[16.0, E.linteau.t0 - 1.05], [18.7, E.linteau.t1 + 0.3], [20.0, E.linteau.t1 + 1.6]],
      cap: ['PORTE', '2 piliers + 1 linteau', PTS.porte, E.linteau.t0],
      cam: function (u) { return orb(870, 1000, 260, 1250 - 80 * u, -14 + 6 * u, 40, 30); } },
    { id: 'prendreGraal', v0: 20.0, v1: 20.9, keys: [[20.0, E.videGraal.t0 - 0.4], [20.9, E.videGraal.t1 + 0.1]], flash: 1,
      cam: function (u) { return orb(170, 1150, 80, 1100, -20 + 5 * u, 35, 30); } },
    { id: 'graal', v0: 20.9, v1: 23.2, keys: [[20.9, E.poseGraal.t0 - 0.5], [22.3, E.poseGraal.t1 + 0.25], [23.2, E.poseGraal.t1 + 1.0]], flash: 1, glint: E.poseGraal.t1,
      cap: ['GRAAL', 'Niveau ' + lvl + ' : sur le mur', PTS.graal, E.poseGraal.t0],
      cam: function (u) { return orb(690, 1440, 390, 1050 - 80 * u, 46 - 4 * u, 12, 28); } },
    { id: 'final', v0: 23.2, v1: 25.2, keys: [[23.2, E.trone.t0 - 0.05], [24.3, E.trone.t1], [25.2, E.face.t1]], flash: 1,
      cap: ['RETOUR AU TRÔNE', 'Le roi rentre au château', PTS.roi, E.trone.t0],
      cam: function (u) { var e = ease(u); return cam(mix(V(1500, 1000, 500), V(1850, 1000, 2200), e), mix(V(450, 1000, 100), V(520, 1000, 0), e), 34); } },
    /* tir : départ du canon vu de derrière, vol en plan large, arrivée derrière la muraille adverse au ralenti */
    { id: 'canon', v0: 25.2, v1: 26.5, keys: [[25.2, E.deploie.t1 - 0.05], [25.5, E.tir.t0 - 0.1], [26.5, E.tir.t0 + 0.35]], flash: 1, tracer: 1,
      cap: ['PHASE D\'ATTAQUE', 'Tir de boulets dès 85 s', null, E.deploie.t1 - 0.05],
      cam: function (u) { return cam(mix(V(-450, 1430, 300), V(-420, 1400, 320), u), V(700, 1000, 520), 54); } },
    { id: 'vol', v0: 26.5, v1: 27.9, keys: [[26.5, E.tir.t0 + 0.1], [27.9, E.tir.t0 + 0.85]], flash: 1, tracer: 1, noTag: 1,
      cam: function (u) { return orb(1500, 1000, 1000, 2600, -90 + 5 * u, 3, 48); } },
    { id: 'impact', v0: 27.9, v1: END, keys: [[27.9, E.tir.t0 + 0.82], [30.1, E.tir.t0 + 1.3], [END, STOPS[2] + 0.06]], flash: 1, loin: 1, tracer: 1, noTag: 1,
      cap: ['BOULETS', 'Par-dessus les remparts', PTS.boulets, E.tir.t0 + 0.88],
      cam: function (u) { return cam(mix(V(3350, 1060, 620), V(3300, 1040, 580), u), V(2300, 1000, 520), 52); } },
    { id: 'fin', v0: END, v1: DUR, keys: [[END, R.T], [DUR, R.T]], grade: 0.32, blur: 16, flash: 1,
      cam: function (u) { return cam(V(1750 + 80 * u, 1000, 2100 - 60 * u), V(520, 1000, 0), 34); } }
  ];
  SHOTS.forEach(function (sh) { sh.keys.forEach(function (k) { k[1] = Math.max(0, Math.min(R.T, k[1])); }); });
  function shotAt(v) { for (var i = 0; i < SHOTS.length; i++) if (v < SHOTS[i].v1) return SHOTS[i]; return SHOTS[SHOTS.length - 1]; }
  function lin(sh, v) {
    var k = sh.keys; if (v <= k[0][0]) return k[0][1];
    for (var i = 1; i < k.length; i++) if (v <= k[i][0]) return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * (v - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
    return k[k.length - 1][1];
  }
  /* rampe de vitesse adoucie (moyenne glissante sur 0,24 s, sans déborder du plan) */
  function simAt(sh, v) {
    var n = 0, a = 0; for (var j = -6; j <= 6; j++) { var w = Math.max(sh.v0, Math.min(sh.v1, v + j * 0.02)); a += lin(sh, w); n++; }
    return a / n;
  }
  function rate(sh, v) { return (simAt(sh, v + 0.02) - simAt(sh, v - 0.02)) / 0.04; }
  function vOf(sh, s) { for (var v = sh.v0; v < sh.v1; v += 1 / 120) if (simAt(sh, v) >= s) return v; return sh.v1; }

  /* ---------- rendu 3D + floutage du robot ---------- */
  var gl = S.gl, cv = gl.domElement;
  function mk(w, h) { var c = document.createElement('canvas'); c.width = w || W; c.height = h || H; return c; }
  var out = mk(), ox = out.getContext('2d'), base = mk(), bx = base.getContext('2d'), mask = mk(), mx = mask.getContext('2d');
  var soft = mk(), sx = soft.getContext('2d'), inv = mk(), ix = inv.getContext('2d'), cen = mk(), cx = cen.getContext('2d');
  var layB = mk(), lbx = layB.getContext('2d');
  var white = new THREE.MeshBasicMaterial({ color: 0xffffff }), dark = new THREE.MeshBasicMaterial({ color: 0x000000 }), black = new THREE.Color(0x000000);
  var maskSet, keepSet, enemy = new THREE.Group(), spent = [];
  /* masques de l'image : le robot et les boulets encore à bord ; restent nets les pierres, le Graal, les remparts adverses et les boulets tirés */
  function sets(s) {
    var fired = S.balls.filter(function (b, i) { return SHOTS_B[i] && s >= SHOTS_B[i].t; });
    maskSet = [S.robot].concat(S.balls.filter(function (b) { return fired.indexOf(b) < 0; }));
    keepSet = S.stones.concat([S.graal, enemy], fired);
  }
  /* remparts adverses (construits pendant le match, visibles à partir de la phase d'attaque) : murs M6, M7, M9, M10
     et porte M8, en miroir des nôtres. Ils prennent les 15 pierres restantes (P3, P4, P7, P8, P10), qui quittent leurs carrières. */
  function buildEnemy() {
    S.update(R.T);
    var zones = ENGINE.ZM.concat(ENGINE.ZT), Y = new THREE.Vector3(0, 1, 0);
    S.stones.forEach(function (m, i) {
      var st = R.stones[i], e = R.stoneAt(st, R.T);
      if (e.k === 'home') { if (/^P(3|4|7|8|10)\./.test(st.id)) spent.push(m); return; }
      var x = m.position.x + 1500, y = m.position.z + 1000, z = null, d = 1e9;
      zones.forEach(function (q) { var dd = Math.hypot(q.c[0] - x, q.c[1] - y); if (dd < d) { d = dd; z = q.id; } });
      if (['M1', 'M3', 'M4', 'M5'].indexOf(z) < 0) return;
      var a = m.clone(); a.position.set(-m.position.x, m.position.y, m.position.z); a.quaternion.set(m.quaternion.x, -m.quaternion.y, -m.quaternion.z, m.quaternion.w); enemy.add(a);
      if (z === 'M4') { var b = m.clone(); b.position.set(-m.position.x, m.position.y, -m.position.z); b.quaternion.setFromAxisAngle(Y, Math.PI).multiply(m.quaternion); enemy.add(b); }
    });
    need(enemy.children.length === 15 && spent.length === 15, '15 pierres pour les remparts adverses');
    S.scene.add(enemy);
  }
  var keep = mk(), kx = keep.getContext('2d');
  S.robot.traverse(function (o) { o.castShadow = false; });   /* son ombre dessinerait sa forme sur la table */
  /* volume plein autour du robot (prisme triangulaire un peu plus grand que son châssis), utilisé seulement dans les masques :
     le flou couvre ce bloc entier, pas la silhouette ajourée du robot qui trahirait sa structure. Les pierres tenues sont hors du prisme. */
  var proxy = new THREE.Mesh(new THREE.CylinderGeometry(250, 250, 380, 3, 1, false, Math.PI / 6), dark);
  proxy.position.y = 190; proxy.visible = false; S.robot.add(proxy);
  var tagPos = null, robotR = 0;

  function placeCam(c) {
    var k = S.camera; k.fov = c.fov; k.aspect = W / H; k.near = 10; k.far = 20000; k.updateProjectionMatrix();
    k.position.copy(c.p); k.up.set(0, 1, 0); k.lookAt(c.t); k.updateMatrixWorld(true);
  }
  function project(p) { var q = p.clone().project(S.camera); return q.z < 1 && q.z > -1 ? [(q.x + 1) / 2 * W, (1 - q.y) / 2 * H] : null; }
  function renderScene(s, c, sh) {
    S.update(s); placeCam(c); sets(s);
    var built = s >= 85; enemy.visible = built; spent.forEach(function (m) { m.visible = !built; });
    gl.shadowMap.autoUpdate = true; gl.render(S.scene, S.camera);
    bx.drawImage(cv, 0, 0);
    /* masques : la partie visible du robot, puis celle des pierres et du Graal (jamais floutés) ;
       ce qui passe devant cache ce qui est derrière */
    var vis = S.scene.children.map(function (o) { return o.visible; }), bg = S.scene.background;
    S.scene.background = black; gl.shadowMap.autoUpdate = false;
    function silhouette(set, into) {
      S.scene.children.forEach(function (o, i) { o.visible = vis[i] && set.indexOf(o) < 0; }); S.scene.overrideMaterial = dark;
      gl.render(S.scene, S.camera);
      /* sans fond : un fond de couleur forcerait three.js à effacer la profondeur de la première passe */
      S.scene.children.forEach(function (o) { o.visible = set.indexOf(o) >= 0 || !!o.isLight; }); S.scene.overrideMaterial = white; S.scene.background = null;
      gl.autoClear = false; gl.render(S.scene, S.camera); gl.autoClear = true; S.scene.background = black;
      into.drawImage(cv, 0, 0);
    }
    proxy.visible = true; silhouette(maskSet, mx); silhouette(keepSet, kx); proxy.visible = false;
    S.scene.overrideMaterial = null; S.scene.background = bg; S.scene.children.forEach(function (o, i) { o.visible = vis[i]; });
    /* taille du robot à l'écran : règle l'élargissement du masque et la force du flou */
    var rp = rob(s, 175), a = project(rp), side = new THREE.Vector3().setFromMatrixColumn(S.camera.matrixWorld, 0).multiplyScalar(260), b = project(rp.clone().add(side));
    robotR = a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0;
    tagPos = project(rob(s, 400));
    var grow = Math.max(5, Math.min(24, robotR * 0.09)), fuzz = Math.max(12, Math.min(48, robotR * 0.17));
    sx.filter = 'blur(' + grow + 'px) brightness(4)'; sx.fillStyle = '#000'; sx.fillRect(0, 0, W, H); sx.drawImage(mask, 0, 0); sx.filter = 'none';
    mx.filter = 'blur(' + Math.max(3, grow * 0.6) + 'px)'; mx.fillStyle = '#000'; mx.fillRect(0, 0, W, H); mx.drawImage(soft, 0, 0); mx.filter = 'none';
    /* on retire les pierres et le Graal visibles : seul le robot est flouté */
    kx.globalCompositeOperation = 'difference'; kx.fillStyle = '#fff'; kx.fillRect(0, 0, W, H); kx.globalCompositeOperation = 'source-over';
    mx.globalCompositeOperation = 'multiply'; mx.drawImage(keep, 0, 0); mx.globalCompositeOperation = 'source-over';
    ix.filter = 'invert(1)'; ix.drawImage(mask, 0, 0); ix.filter = 'none';
    /* flou fin : les formes générales restent, les mécanismes disparaissent */
    cx.filter = 'blur(' + fuzz + 'px) saturate(0.15) brightness(0.9)'; cx.drawImage(base, 0, 0); cx.filter = 'none';
    cx.globalCompositeOperation = 'multiply'; cx.drawImage(mask, 0, 0); cx.globalCompositeOperation = 'source-over';
    lbx.drawImage(base, 0, 0); lbx.globalCompositeOperation = 'multiply'; lbx.drawImage(inv, 0, 0); lbx.globalCompositeOperation = 'lighter'; lbx.drawImage(cen, 0, 0); lbx.globalCompositeOperation = 'source-over';
    ox.filter = 'contrast(1.12) saturate(1.18) brightness(' + (sh.grade || 1) + ')' + (sh.blur ? ' blur(' + sh.blur + 'px)' : '');
    ox.drawImage(layB, 0, 0); ox.filter = 'none';
  }

  /* ---------- habillage ---------- */
  var logo = new Image(), grain = mk(512, 512);
  (function () { var g = grain.getContext('2d'), d = g.createImageData(512, 512); for (var i = 0; i < d.data.length; i += 4) { var n = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = n; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); })();
  function txt(s, x, y, size, o) {
    o = o || {}; ox.save();
    ox.font = (o.w || '800 italic') + ' ' + size + 'px ' + (o.f || FONT); ox.textAlign = o.a || 'left'; ox.textBaseline = o.b || 'alphabetic';
    ox.letterSpacing = (o.ls || 0) + 'px'; ox.globalAlpha = o.al == null ? 1 : o.al;
    if (o.sh) { ox.shadowColor = 'rgba(0,0,0,0.6)'; ox.shadowBlur = 24; ox.shadowOffsetY = 4; }
    ox.fillStyle = o.c || '#fff'; ox.fillText(s, x, y); var m = ox.measureText(s).width; ox.restore(); return m;
  }
  function para(x, y, w, h, sk, c, al) { ox.save(); ox.globalAlpha = al == null ? 1 : al; ox.fillStyle = c; ox.beginPath(); ox.moveTo(x + sk, y); ox.lineTo(x + w + sk, y); ox.lineTo(x + w, y + h); ox.lineTo(x, y + h); ox.closePath(); ox.fill(); ox.restore(); }
  function inOut(v, a, b, fi, fo) { return Math.max(0, Math.min(1, (v - a) / (fi || 0.15), (b - v) / (fo || 0.15))); }
  function punch(v, a) { var k = Math.max(0, Math.min(1, (v - a) / 0.18)); return 1 + 0.25 * (1 - ease(k)); }
  function center(lines, v, a, b) {
    var al = inOut(v, a, b, 0.06, 0.1), sc = punch(v, a);
    ox.save(); ox.translate(W / 2, H / 2); ox.scale(sc, sc);
    lines.forEach(function (l) { txt(l[0], 0, l[1], l[2], { a: 'center', b: 'middle', c: l[3] || '#fff', ls: l[4] || 0, al: al, sh: 1, w: l[5] }); });
    ox.restore();
  }
  function hazard(x, y, w, h, al) {
    ox.save(); ox.globalAlpha = al; ox.beginPath(); ox.rect(x, y, w, h); ox.clip();
    ox.fillStyle = YELLOW; ox.fillRect(x, y, w, h); ox.fillStyle = INK;
    for (var k = -h; k < w + h; k += 26) { ox.beginPath(); ox.moveTo(x + k, y + h); ox.lineTo(x + k + 13, y + h); ox.lineTo(x + k + 13 + h, y); ox.lineTo(x + k + h, y); ox.fill(); }
    ox.restore();
  }
  function stamp(s, x, y, size, rot, al, sc) {
    ox.save(); ox.translate(x, y); ox.rotate(rot); ox.scale(sc, sc); ox.globalAlpha = al;
    ox.font = '800 ' + size + 'px ' + FONT; ox.letterSpacing = size * 0.08 + 'px'; var w = ox.measureText(s).width + size * 0.7, h = size * 1.25;
    ox.lineWidth = size * 0.09; ox.strokeStyle = '#e8352c'; ox.strokeRect(-w / 2, -h / 2, w, h);
    ox.fillStyle = '#e8352c'; ox.textAlign = 'center'; ox.textBaseline = 'middle'; ox.fillText(s, size * 0.04, size * 0.06);
    ox.restore();
  }
  /* étiquette « CONFIDENTIEL » accrochée au robot */
  function robotTag(al) {
    if (!tagPos || robotR < 18 || tagPos[0] < -100 || tagPos[0] > W + 100 || tagPos[1] < -60 || tagPos[1] > H + 60) return;
    var sz = Math.max(24, Math.min(40, robotR * 0.22)); ox.font = '800 ' + sz + 'px ' + FONT; ox.letterSpacing = '2px';
    var w = ox.measureText('PROTOTYPE CONFIDENTIEL').width + sz * 1.2, h = sz * 1.5, x = tagPos[0] - w / 2, y = Math.max(24, tagPos[1] - h - 16);
    hazard(x - 12, y - 12, w + 24, h + 24, al);
    ox.save(); ox.globalAlpha = al; ox.fillStyle = INK; ox.fillRect(x, y, w, h); ox.restore();
    txt('PROTOTYPE CONFIDENTIEL', x + w / 2, y + h / 2 + 1, sz, { a: 'center', b: 'middle', c: YELLOW, ls: 2, al: al, w: '800' });
  }
  function caption(v, sh) {
    var src = sh.capKeep ? SHOTS.filter(function (x) { return x.id === sh.capKeep; })[0] : sh, c = src.cap; if (!c) return;
    var a = vOf(src, c[3] != null ? c[3] : src.keys[0][1]), b = (sh.capKeep ? sh.v1 : src.v1) - 0.12;
    if (v < a || v > b) return;
    var k = ease((v - a) / 0.22), al = inOut(v, a, b, 0.12, 0.12), x = 96 - 260 * (1 - k), y = H - 250;
    ox.save(); ox.globalAlpha = al;
    ox.font = '800 italic 96px ' + FONT; ox.letterSpacing = '2px'; var tw = ox.measureText(c[0]).width;
    para(x, y, tw + 70, 104, 22, ORANGE);
    txt(c[0], x + 34, y + 88, 96, { c: INK, ls: 2 });
    if (c[2] != null) { para(x + tw + 92, y, 210, 104, 22, '#fff'); txt('+' + c[2] + ' PTS', x + tw + 92 + 116, y + 86, 76, { a: 'center', c: INK }); }
    ox.font = '600 44px ' + FONT; var sw = ox.measureText(c[1]).width;
    para(x - 10, y + 112, sw + 64, 62, 14, 'rgba(11,12,16,0.82)');
    txt(c[1], x + 22, y + 158, 44, { w: '600', ls: 1 });
    ox.restore();
  }
  function earnedAt(v) { var w = Math.min(v, END - 0.01); return v < 4.3 ? 0 : earned(simAt(shotAt(w), w)); }
  /* instant vidéo où le compteur a changé pour la dernière fois (pour l'animation) */
  function popStart(v) { var n = earnedAt(v), w = v; while (w > v - 0.4 && earnedAt(w - 1 / 120) === n) w -= 1 / 120; return w; }
  function hud(v, sh, s) {
    var r = rate(sh, v), al = inOut(v, 4.3, END, 0.2, 0.2);
    ox.save(); ox.globalAlpha = al;
    ox.fillStyle = 'rgba(11,12,16,0.78)'; ox.fillRect(W - 372, 56, 300, 112); ox.fillStyle = ORANGE; ox.fillRect(W - 372, 56, 8, 112);
    txt('CHRONO DU MATCH', W - 344, 92, 26, { w: '600', c: '#c9ccd6', ls: 3 });
    txt(fmt(s) + ' s', W - 344, 150, 58, { w: '500', f: MONO });
    /* points marqués : le compteur saute à chaque construction posée */
    var n = earnedAt(v), n0 = earnedAt(v - 0.4), pop = n > n0 ? 1 - Math.min(1, (v - popStart(v)) / 0.4) : 0;
    ox.fillStyle = 'rgba(11,12,16,0.78)'; ox.fillRect(W - 372, 180, 300, 112); ox.fillStyle = YELLOW; ox.fillRect(W - 372, 180, 8, 112);
    txt('POINTS', W - 344, 216, 26, { w: '600', c: '#c9ccd6', ls: 3 });
    ox.save(); ox.translate(W - 344, 256); ox.scale(1 + 0.25 * pop, 1 + 0.25 * pop); txt(String(n), 0, 0, 62, { b: 'middle', c: pop > 0 ? '#fff' : YELLOW }); ox.restore();
    if (pop > 0) txt('+' + (n - n0), W - 96, 270 - 36 * (1 - pop), 50, { a: 'right', c: YELLOW, al: Math.min(1, pop * 2), sh: 1 });
    if (r < 0.62) {
      var blink = Math.floor(v * 2.5) % 2 === 0;
      ox.fillStyle = '#e8352c'; ox.fillRect(W - 372, 304, 300, 52);
      ox.fillStyle = blink ? '#fff' : 'rgba(255,255,255,0.35)'; ox.beginPath(); ox.arc(W - 342, 330, 9, 0, 7); ox.fill();
      txt('RALENTI  ×' + (Math.round(r * 10) / 10).toFixed(1).replace('.', ','), W - 320, 344, 38, { w: '800 italic', ls: 2 });
    }
    ox.restore();
  }
  function lights(v) {
    /* feux de départ : 5 rouges qui s'allument puis s'éteignent au départ */
    var a = 3.62, n = Math.max(0, Math.min(5, Math.floor((v - a) / 0.12) + 1)), off = v >= 4.3;
    for (var i = 0; i < 5; i++) {
      var x = W / 2 + (i - 2) * 150, y = H / 2 - 40;
      ox.fillStyle = 'rgba(11,12,16,0.9)'; ox.fillRect(x - 58, y - 58, 116, 116);
      ox.fillStyle = !off && i < n ? '#ff2a1f' : '#2a2d39'; ox.beginPath(); ox.arc(x, y, 42, 0, 7); ox.fill();
      if (!off && i < n) { ox.save(); ox.globalAlpha = 0.35; ox.fillStyle = '#ff2a1f'; ox.beginPath(); ox.arc(x, y, 64, 0, 7); ox.fill(); ox.restore(); }
    }
  }
  function overlays(v, sh, s) {
    if (v < 2.4) {
      center([['COUPE DE FRANCE', -70, 120, '#fff', 6], ['DE ROBOTIQUE 2027', 60, 120, ORANGE, 6]], v, 0.35, 2.35);
    }
    if (sh.id === 'chiffre1') center([['100 SECONDES', 0, 190, '#fff', 4]], v, 2.4, 3.0);
    if (sh.id === 'chiffre2') center([['0 PILOTE', -40, 190, '#fff', 4], ['100 % AUTONOME', 95, 64, YELLOW, 8, '700 italic']], v, 3.0, 3.6);
    if (sh.id === 'feux') lights(v);
    if (v >= 4.3 && v < 4.75) center([['GO', 0, 230, YELLOW, 10]], v, 4.3, 4.75);
    if (v >= 4.3 && v < END) { hud(v, sh, s); caption(v, sh); }
    if (sh.id === 'fin') endCard(v);
    /* logo en haut à gauche pendant l'action */
    if (v >= 4.3 && v < END && logo.complete) { ox.save(); ox.globalAlpha = inOut(v, 4.3, END, 0.2, 0.2) * 0.95; ox.drawImage(logo, 64, 52, 230, 230 * logo.height / logo.width); ox.restore(); }
  }
  function endCard(v) {
    var e = END;
    center([['LE ROBOT ?', -40, 150, '#fff', 6]], v, e + 0.15, e + 1.7);
    if (v >= e + 0.65 && v < e + 1.7) { var k = Math.max(0, Math.min(1, (v - e - 0.65) / 0.12)); stamp('CLASSÉ CONFIDENTIEL', W / 2, H / 2 + 120, 72, -0.06, inOut(v, e + 0.65, e + 1.7, 0.05, 0.1), 1.6 - 0.6 * ease(k)); }
    center([['POUR EN SAVOIR PLUS', -80, 84, '#fff', 8, '700 italic'], ['DEVENEZ SPONSOR', 40, 170, ORANGE, 4]], v, e + 1.75, e + 3.15);
    if (v >= e + 3.2) {
      var al = Math.min(1, (v - e - 3.2) / 0.25), sc = 1 + 0.08 * (1 - ease((v - e - 3.2) / 0.4)), lw = 760, lh = lw * logo.height / logo.width;
      ox.save(); ox.globalAlpha = al; ox.translate(W / 2, H / 2 - 120); ox.scale(sc, sc); ox.drawImage(logo, -lw / 2, -lh / 2, lw, lh); ox.restore();
      var a2 = Math.max(0, Math.min(1, (v - e - 3.55) / 0.25));
      txt('ÉCRIVEZ-NOUS EN MP', W / 2, H / 2 + 175, 96, { a: 'center', c: YELLOW, ls: 4, al: a2, sh: 1 });
      txt('Coupe de France de Robotique 2027', W / 2, H / 2 + 250, 44, { a: 'center', w: '600', ls: 2, al: a2 * 0.9 });
    }
  }
  /* reflet sur le Graal une fois posé */
  function glint(v, sh, s) {
    if (!sh.glint || s < sh.glint) return;
    var p = project(S.graal.position.clone().add(new THREE.Vector3(0, 30, 0))); if (!p) return;
    var k = Math.min(1, (s - sh.glint) / 0.25), r = 60 + 30 * Math.sin(v * 9), al = 0.85 * k;
    ox.save(); ox.globalCompositeOperation = 'lighter'; ox.globalAlpha = al;
    var g = ox.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 2); g.addColorStop(0, 'rgba(255,240,190,0.9)'); g.addColorStop(0.25, 'rgba(255,200,80,0.35)'); g.addColorStop(1, 'rgba(255,180,40,0)');
    ox.fillStyle = g; ox.fillRect(p[0] - r * 2, p[1] - r * 2, r * 4, r * 4);
    ox.translate(p[0], p[1]); ox.rotate(v * 0.6); ox.fillStyle = 'rgba(255,235,170,0.8)';
    [0, Math.PI / 2].forEach(function (a) { ox.save(); ox.rotate(a); ox.beginPath(); ox.moveTo(-r * 2.6, 0); ox.lineTo(0, -3); ox.lineTo(r * 2.6, 0); ox.lineTo(0, 3); ox.fill(); ox.restore(); });
    ox.restore();
  }
  /* traceur des boulets en vol : leur trajectoire simulée, qui s'efface derrière eux (façon retransmission de golf) */
  function tracer(s) {
    SHOTS_B.forEach(function (b) {
      if (s < b.t) return;
      var pts = [];
      b.pts.forEach(function (p) { var t = b.t + p[0]; if (t <= s && t >= s - 0.7) pts.push([t, project(V(p[1], p[2], p[3]))]); });
      var q = ballAt(b, s - b.t); if (q) pts.push([s, project(V(q[0], q[1], q[2]))]);
      ox.save(); ox.globalCompositeOperation = 'lighter'; ox.lineCap = 'round';
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1][1], c = pts[i][1]; if (!a || !c) continue;
        var age = (s - pts[i][0]) / 0.7, al = Math.max(0, 1 - age);
        ox.strokeStyle = 'rgba(255,190,40,' + (0.35 * al) + ')'; ox.lineWidth = 14; ox.beginPath(); ox.moveTo(a[0], a[1]); ox.lineTo(c[0], c[1]); ox.stroke();
        ox.strokeStyle = 'rgba(255,240,180,' + (0.9 * al) + ')'; ox.lineWidth = 4; ox.beginPath(); ox.moveTo(a[0], a[1]); ox.lineTo(c[0], c[1]); ox.stroke();
      }
      ox.restore();
    });
  }
  function ballAt(b, tg) {
    var P = b.pts; if (tg >= P[P.length - 1][0]) return P[P.length - 1].slice(1);
    for (var i = 1; i < P.length; i++) if (P[i][0] >= tg) { var a = P[i - 1], c = P[i], u = (tg - a[0]) / (c[0] - a[0]); return [a[1] + (c[1] - a[1]) * u, a[2] + (c[2] - a[2]) * u, a[3] + (c[3] - a[3]) * u]; }
    return null;
  }
  function finish(v, sh) {
    /* éclair au raccord, vignette, grain */
    if (sh.flash && v - sh.v0 < 0.12) { ox.save(); ox.globalAlpha = 0.55 * (1 - (v - sh.v0) / 0.12); ox.fillStyle = '#fff'; ox.fillRect(0, 0, W, H); ox.restore(); }
    var g = ox.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.6)'); ox.fillStyle = g; ox.fillRect(0, 0, W, H);
    ox.save(); ox.globalCompositeOperation = 'overlay'; ox.globalAlpha = 0.07;
    var gx = -Math.floor(Math.random() * 512), gy = -Math.floor(Math.random() * 512);
    for (var x = gx; x < W; x += 512) for (var y = gy; y < H; y += 512) ox.drawImage(grain, x, y);
    ox.restore();
  }

  function frame(i, kind) {
    var v = i / FPS, sh = shotAt(v), u = (v - sh.v0) / (sh.v1 - sh.v0), s = simAt(sh, v);
    ox.fillStyle = '#000'; ox.fillRect(0, 0, W, H);
    renderScene(s, sh.cam(u, s, v), sh);
    if (v >= 4.3 && v < END && !sh.noTag) robotTag(Math.min(1, inOut(v, sh.v0, sh.v1, 0.2, 0.05)));
    glint(v, sh, s);
    if (sh.tracer) tracer(s);
    overlays(v, sh, s);
    finish(v, sh);
    if (v < 0.35) { ox.fillStyle = 'rgba(0,0,0,' + (1 - v / 0.35) + ')'; ox.fillRect(0, 0, W, H); }
    return out.toDataURL('image/' + (kind || 'jpeg'), 0.93).split(',')[1];
  }

  /* repères du son : raccords, impacts (poses de pierres, textes), ralentis et vitesse du robot */
  function cues() {
    var c = { dur: DUR, end: END, fps: FPS, cuts: [], hits: [], frames: [] };
    SHOTS.forEach(function (sh) { if (sh.flash) c.cuts.push(sh.v0); });
    [[0.35, 'titre'], [2.4, 'texte'], [3.0, 'texte'], [4.3, 'go'], [END + 0.15, 'texte'], [END + 0.65, 'tampon'], [END + 1.75, 'texte'], [END + 3.2, 'logo']].forEach(function (h) { c.hits.push({ v: h[0], k: h[1] }); });
    for (var n = 0; n < 5; n++) c.hits.push({ v: 3.62 + n * 0.12, k: 'feu' });
    /* bruits de la machine, lus dans les étapes du simulateur : aspiration, lâcher, contact, mouvements de pince.
       Seuls ceux qui tombent dans un plan sont entendus, coupés au raccord suivant. */
    var KIND = [
      [/^Vide (face [AB] )?sur/, 'aspire'],
      [/^Vide coupé|lâchée|^2 piliers posés|^Linteau posé|^Graal posé/, 'lache'],
      [/^Contact avec/, 'contact'],
      [/^Levée|^Descente|^Montée|position basse|mis à plat|^Retour de la rotation|tournée|^Centrage|^Déploiement du canon/, 'verin'],
      [/^Mise en route du canon/, 'volant']
    ];
    c.sfx = [];
    SHOTS.forEach(function (sh) {
      if (sh.v0 < 4.3 || sh.id === 'fin') return;
      var s0 = sh.keys[0][1], s1 = sh.keys[sh.keys.length - 1][1];
      R.segs.forEach(function (g) {
        var k = null; KIND.forEach(function (q) { if (!k && q[0].test(g.label)) k = q[1]; });
        var t = k === 'contact' ? g.t1 : g.t0;
        if (!k || t < s0 || t > s1) return;
        var v = vOf(sh, t); if (v <= sh.v0 + 0.01 || v >= sh.v1 - 0.03) return;
        var e = { k: k, v: v, r: Math.max(0.25, Math.min(1, rate(sh, v))), end: sh.v1, label: g.label };
        if (k === 'aspire' || k === 'verin') e.v1 = Math.min(sh.v1, vOf(sh, Math.min(g.t1, s1)));
        if (k === 'volant') e.v1 = sh.v1;   /* le canon tourne jusqu'à la fin de la séance de tir */
        c.sfx.push(e);
      });
      /* chaque boulet : départ du canon, puis ses rebonds sur la table */
      SHOTS_B.forEach(function (b, n) {
        var ev = [[b.t, 'tir', 1]], P = b.pts, nb = 0;
        for (var j = 1; j < P.length - 1; j++) if (P[j][3] <= P[j - 1][3] && P[j][3] < P[j + 1][3] && P[j][3] < 40) ev.push([b.t + P[j][0], 'rebond', Math.pow(0.5, nb++)]);
        ev.forEach(function (x) {
          if (x[0] < s0 || x[0] > s1) return;
          var v = vOf(sh, x[0]); if (v <= sh.v0 + 0.01 || v >= sh.v1 - 0.03) return;
          c.sfx.push({ k: x[1], v: v, r: Math.max(0.25, Math.min(1, rate(sh, v))), end: sh.v1, amp: x[2] * (sh.loin && x[1] === 'tir' ? 0.3 : 1), label: 'boulet ' + (n + 1) });
        });
      });
    });
    for (var i = 0; i < DUR * FPS; i++) {
      var v = i / FPS, sh = shotAt(v), s0 = simAt(sh, v), s1 = simAt(sh, v + 1 / FPS), a = R.poseAt(s0), b = R.poseAt(s1);
      var sim = sh.id !== 'fin' && v >= 4.3 && v < END;
      c.frames.push({ r: sim ? rate(sh, v) : 0, mm: sim ? Math.hypot(b.x - a.x, b.y - a.y) * FPS : 0 });
    }
    return c;
  }

  function init() {
    S.hideAids(); buildEnemy();
    gl.setPixelRatio(1); gl.setSize(W, H, false);
    var st = document.createElement('style'); st.textContent = '#view{position:fixed!important;left:0;top:0;width:1920px!important;height:1080px!important;z-index:99}';
    document.head.appendChild(st);
    logo.src = '/teaser/logo-roboticam.png';
    return Promise.all([logo.decode(), document.fonts.load('800 italic 40px "Barlow Condensed"'), document.fonts.load('600 40px "Barlow Condensed"'),
      document.fonts.load('700 italic 40px "Barlow Condensed"'), document.fonts.load('500 40px "IBM Plex Mono"')]).then(function () {
      gl.setSize(W, H, false);
      return { fps: FPS, frames: DUR * FPS, summary: 'programme ' + fmt(R.T) + ' s, score simulé ' + PTS.total + ' pts (murs ' + O.walls.join(' ') + ', tours ' + O.towers.join(' ') + ', porte ' + O.doors.join(' ') + ', Graal niveau ' + lvl + ', trône ' + PTS.roi + ' pts, ' + STOPS.length + ' boulets dans la cour adverse)' };
    });
  }
  function debug(i) { frame(i); return [base, mask, soft].map(function (c) { return c.toDataURL('image/png').split(',')[1]; }); }
  return { init: init, frame: frame, cues: cues, debug: debug };
})();
