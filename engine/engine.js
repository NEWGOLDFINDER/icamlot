/* Moteur de simulation ICAM LOT — source unique pour /plateau/ et l'entraînement.
   Géométrie et durées lues dans SPEC (spec/spec.js, généré depuis spec/*.json) via engine/geom.js.
   Contrats : docs/CONTRATS.md §1 à §3. Optimisations D.1 (overlap, dans geom.js) et D.2 (choix de pose paresseux). */
(function (root) {
  var SPEC = root.SPEC, G = root.GEOM;
  if (!SPEC || !G) throw new Error('SPEC ou GEOM absents : charger spec/spec.js puis engine/geom.js avant engine/engine.js.');
  var RG = SPEC.regles, RB = SPEC.robot, NAC = RB.mecanismes.pince_A_et_B, CAN = RB.mecanismes.canon_C, ASC = RB.mecanismes.ascenseur_graal, ENT = RB.entrainement;
  function val(x) { return x !== null && typeof x === 'object' && 'valeur' in x ? x.valeur : x; }
  var GE = G.GEO, D_P = GE.dPierre, FACE = GE.face, HULL_R = GE.hullR, H_MAX = GE.hMax, HC_MIN = GE.hcMin, HC_MAX = GE.hcMax, BORDURE = GE.bordure;
  var GR = GE.graal, FO = GE.fourche, D2R = Math.PI / 180;
  var VERSION = '2.0.0';
  var MATCH = RG.match.duree_s, T_ATTAQUE = RG.match.phase_attaque_debut_s;
  /* Paramètres. Valeurs lues dans la spec quand elles y sont ; sinon « hypothèse » (voir le rapport du chantier moteur). */
  var DEF = {
    v: val(ENT.vitesse_lineaire_mm_s) / 1000, va: val(ENT.vitesse_approche_mm_s) / 1000, w: val(ENT.vitesse_rotation_deg_s),
    vz: NAC.vitesse_chariot_mm_s, trot: NAC.rotation_duree_s_pour_90deg, tvac: NAC.prise_vide_s, trel: NAC.relache_s,
    /* hypothèse héritée : départ au centre de la salle du trône, face A vers +x */
    x0: 250, y0: 1000, h0: 0,
    /* Graal au départ (repère jaune) : centre (gx, gy), ga = angle de la normale aux anses. Choix calculé (voir graalDefaut ci-dessous). */
    gx: 154, gy: 1170, ga: 90,
    gs: GR.base,   /* côté du Graal (affichage), = spec */
    /* hypothèses héritées : jeu de 5 mm au-dessus des piliers avant de poser le linteau (325 mm), chevauchement minimal de 8 mm d'une construction avec sa zone */
    pgap: 5, ovl: 8,
    /* tir : position (hypothèse héritée : centre du trône) ; tirer depuis le trône est un choix d'équipe, pas une règle (contrat §2) */
    tx: 250, ty: 1000, tirDepuisTrone: true,
    bn: RG.assaut.boulets_par_equipe,
    /* spec canon_C.cadence_boulets_s = 2 : lu comme 2 boulets par seconde (sens de l'ancien simulateur ; 2 s par boulet ne tiendrait pas dans 85-100 s) */
    brate: CAN.cadence_boulets_s, bdep: CAN.deploiement_s, bspin: CAN.mise_en_route_s, bel: CAN.elevation_deg, bh: CAN.bouche_deployee.hauteur,
    /* balistique héritée (hypothèses) : point visé, mode, masse, traînée, restitution, frottements, dispersions, graine */
    btx: 2625, bmode: 'arret', bm: 2, bcd: 0.47, be: 0.5, bmu: 0.3, bcr: 0.05, bdv: 5, bdaz: 2, bdel: 2, bseed: 1,
    /* ascenseur du Graal : montée (spec, déclarée) ; transfert, pose, dégagement (contrat §2) ; sortie et descente de la fourche (hypothèses : même vitesses que le transfert et la montée) */
    tMonteeGraal: val(ASC.duree_montee_s), tTransfertGraal: 0.8, tPoseGraal: 0.2, tDegagementGraal: 0.8, tSortieFourche: 0.8, tDescenteFourche: val(ASC.duree_montee_s),
    team: 'yellow'
  };
  var PK = [];
  RG.carrieres.liste.forEach(function (c) { PK.push({ id: c.id, x: c.c[0], y: c.c[1], tan: c.axe_long === 'x' ? 0 : 90 }); });
  var NOMS_MURS = { M1: 'mur haut', M2: 'mur diagonal haut', M3: 'mur de façade', M4: 'mur diagonal bas', M5: 'mur bas' };
  /* nin : normale vers l'intérieur du château (côté cour) */
  var NIN = { M1: 90, M2: 135, M3: 180, M4: 225, M5: 270 };
  var ZM = RG.remparts_jaune.murs.map(function (m) { return { id: m.id, c: m.c.slice(), tan: m.grand_axe_deg, nin: NIN[m.id], name: NOMS_MURS[m.id] }; });
  ZM.slice().forEach(function (z, i) { ZM.push({ id: 'M' + (i + 6), c: [3000 - z.c[0], z.c[1]], tan: 180 - z.tan, nin: 180 - z.nin, name: z.name + ' adverse' }); });
  var ZT = RG.remparts_jaune.tours.map(function (t) { return { id: t.id, c: t.c.slice() }; });
  ZT.slice().forEach(function (z, i) { ZT.push({ id: 'T' + (i + 5), c: [3000 - z.c[0], z.c[1]] }); });
  var ZMW = RG.remparts_jaune.mur_dimensions, ZTR = RG.remparts_jaune.tour_diametre / 2;
  var TJ = RG.zones_depart.trone_jaune;
  var THRONE = [[TJ.x[0], TJ.y[0]], [TJ.x[1], TJ.y[0]], [TJ.x[1], TJ.y[1]], [TJ.x[0], TJ.y[1]]];
  /* château (cour + remparts) : contour hérité de l'ancien moteur (zones de muraille comprises) */
  var CASTLE = [[0, 295], [610, 295], [960, 640], [960, 1360], [610, 1705], [0, 1705]];
  var CASTLE_B = CASTLE.map(function (p) { return [3000 - p[0], p[1]]; }).reverse();
  var THRONE_B = THRONE.map(function (p) { return [3000 - p[0], p[1]]; }).reverse();
  function throneOf(team) { return team === 'blue' ? THRONE_B : THRONE; }
  function castleOf(team) { return team === 'blue' ? CASTLE_B : CASTLE; }
  function tx(x, team) { return team === 'blue' ? 3000 - x : x; }
  function th(h, team) { return team === 'blue' ? 180 - h : h; }
  function mirrorId(id) {
    var n = parseInt(id.slice(1), 10), p = id[0];
    if (p === 'M') return 'M' + (n <= 5 ? n + 5 : n - 5);
    if (p === 'T') return 'T' + (n <= 4 ? n + 4 : n - 4);
    if (p === 'P') {
      var map = { P1: 'P4', P2: 'P3', P3: 'P2', P4: 'P1', P5: 'P8', P6: 'P7', P7: 'P6', P8: 'P5', P9: 'P9', P10: 'P10' };
      return map[id] || id;
    }
    return id;
  }
  function mirrorStep(st) {
    var o = {}; Object.keys(st).forEach(function (k) { o[k] = st[k]; });
    if (o.p) o.p = mirrorId(o.p);
    if (o.z) o.z = mirrorId(o.z);
    if (o.s && o.s.indexOf('.') >= 0) o.s = mirrorId(o.s.split('.')[0]) + '.' + o.s.split('.')[1];
    return o;
  }
  function blueParams(base) {
    base = base || {};
    var P = Object.assign({}, DEF, base, { team: 'blue' });
    delete P.oppTaken;
    P.x0 = 3000 - (base.x0 != null ? base.x0 : DEF.x0);
    P.h0 = 180 - (base.h0 != null ? base.h0 : DEF.h0);
    P.gx = 3000 - (base.gx != null ? base.gx : DEF.gx);
    P.gy = base.gy != null ? base.gy : DEF.gy;
    P.ga = 180 - (base.ga != null ? base.ga : DEF.ga);
    return P;
  }
  function intensityParams(P, intensity) {
    var Q = Object.assign({}, P);
    if (intensity === 'faible') { Q.v = (Q.v || DEF.v) * 0.7; Q.va = (Q.va || DEF.va) * 0.7; Q.w = (Q.w || DEF.w) * 0.85; }
    if (intensity === 'agressif') { Q.v = (Q.v || DEF.v) * 1.2; Q.va = (Q.va || DEF.va) * 1.15; Q.w = (Q.w || DEF.w) * 1.1; }
    return Q;
  }
  /* cour du château (D.4 : entourée par les remparts, salle du trône comprise) : bords intérieurs des zones de muraille */
  var COUR_B = [[3000, 500], [2532.8, 500], [2250, 782.8], [2250, 1217.2], [2532.8, 1500], [3000, 1500]];
  var COUR = COUR_B.map(function (p) { return [3000 - p[0], p[1]]; }).reverse();
  function zoneById(id) { for (var i = 0; i < ZM.length; i++) if (ZM[i].id === id) return ZM[i]; for (var j = 0; j < ZT.length; j++) if (ZT[j].id === id) return ZT[j]; return null; }
  function inPoly(x, y, P) { var c = false; for (var i = 0, j = P.length - 1; i < P.length; j = i++) { if (((P[i][1] > y) !== (P[j][1] > y)) && (x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0])) c = !c; } return c; }
  /* point dans un polygone, bord compris (à 0,5 mm près) */
  function inPolyB(x, y, P) { return inPoly(x, y, P) || ptPolyD([x, y], P) <= 0.5; }
  function angd(a, b) { return ((b - a) % 360 + 540) % 360 - 180; }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function inTable(P, m) { m = m || 0; return P.every(function (v) { return v[0] >= m && v[0] <= 3000 - m && v[1] >= m && v[1] <= 2000 - m; }); }
  function zoneRect(z) { return rectPoly({ cx: z.c[0], cy: z.c[1], hl: ZMW[0] / 2, hn: ZMW[1] / 2, ang: z.tan + 90 }); }
  function ptSegD(p, a, b) { var dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
  function ptPolyD(p, P) { if (inPoly(p[0], p[1], P)) return 0; var d = 1e9; for (var i = 0; i < P.length; i++) d = Math.min(d, ptSegD(p, P[i], P[(i + 1) % P.length])); return d; }
  function inCastleAny(x, y) { return inPoly(x, y, CASTLE) || inPoly(x, y, CASTLE_B); }
  /* empreinte du Graal (base 62 x 62 et anses), repère table : centre c, angle a de la normale aux anses */
  function graalPoly(c, a) {
    var b = GR.base / 2, an = GR.anse, n = nv(a), t = lv(a);
    return [[b, -b], [an.long / 2, -b - an.saillie], [-an.long / 2, -b - an.saillie], [-b, -b], [-b, b], [-an.long / 2, b + an.saillie], [an.long / 2, b + an.saillie], [b, b]]
      .map(function (q) { return [c[0] + q[0] * n[0] + q[1] * t[0], c[1] + q[0] * n[1] + q[1] * t[1]]; });
  }
  /* position du Graal sur le toit (ou sur la fourche) d'un robot à la pose p : repère de la face C */
  function graalOnRobot(p, k) {
    var C = G.cState(p.C), phi = p.h + 240, n = nv(phi), t = lv(phi);
    var gx = k === 'toit' ? GR.toit[0] : C.fx + FO.cao.travEp + FO.cao.jeuGraal + GR.base / 2;
    var bottom = k === 'toit' ? GE.toit : C.fz + FO.cao.dentEp - GR.anse.dessous;
    return { c: [p.x + gx * n[0] + GR.y * t[0], p.y + gx * n[1] + GR.y * t[1]], ang: phi, bottom: bottom, top: bottom + GR.h };
  }
  /* Le Graal par défaut : calcul (voir rapport du chantier moteur, tests/test_moteur.js « graal par défaut »).
     Contraintes : entièrement dans la salle du trône ; hors de la projection du robot au départ (mécanismes compris) ;
     prise par la face C possible sans sortir du château. Critère : durée de monterGraal depuis le départ la plus courte. */

  function makeSim(P, opts) {
    opts = opts || {};
    P = Object.assign({}, DEF, P || {});
    var V = P.v * 1000, VA = P.va * 1000, WR = P.w, VZ = P.vz, TV = P.tvac, TL = P.trel, TR = P.trot, WROT = 90 / TR;
    var OWN_CASTLE = castleOf(P.team), OWN_COUR = P.team === 'blue' ? COUR_B : COUR;
    function oppAt(t) { return opts.oppPoseAt ? opts.oppPoseAt(t) : null; }
    function lidarXY(p) { var n = nv(p.h); return [p.x - 30 * n[0], p.y - 30 * n[1]]; }
    function oppBlocks(p, t, dir) {
      var o = oppAt(t);
      if (!o || o.x == null) return false;
      var L = lidarXY(p), dx = o.x - L[0], dy = o.y - L[1], d = Math.hypot(dx, dy);
      if (d > 400) return false;
      var m = Math.hypot(dir[0], dir[1]);
      if (m < 20) return false;
      return (dx * dir[0] + dy * dir[1]) / m > 0;
    }
    /* pierres posées par l'autre robot (et son Graal au sol) : obstacles (jamais des appuis) */
    function foreign() { return opts.foreignFeet ? opts.foreignFeet() : []; }
    function oppOccupies(x, y, t) {
      var o = oppAt(t);
      if (!o || o.x == null) return false;
      return Math.hypot(x - o.x, y - o.y) < (HULL_R + 200);
    }
    var s = { t: 0, x: P.x0, y: P.y0, h: P.h0, A: { hc: 165, rot: 0, vac: [0, 0, 0] }, B: { hc: 165, rot: 0, vac: [0, 0, 0] }, C: { can: 0, fx: FO.fxRentree, fz: FO.fzHaut } };
    var K = [], segs = [], errors = [], stepInfo = [];
    var stones = [];
    PK.forEach(function (pk, i) { for (var l = 0; l < 3; l++) stones.push({ id: pk.id + '.' + (l + 1), pk: i, l: l, sl: l, tl: [{ t: 0, k: 'home' }], cur: { k: 'home' }, tag: 'home' }); });
    var held = { A: null, B: null };
    /* Graal : 'home' (au départ), 'ascenseur' (sur la fourche), 'toit' (posé sur le toit, solidaire du robot), 'retire' (sorti du château) */
    var graal = { tl: [{ t: 0, k: 'home' }], cur: { k: 'home' } };
    /* boulets : balles en mousse de 45 mm (D.4) */
    var balls = { shots: null, t0: Infinity, v0: null, n: 0, tDeploy: Infinity };
    /* portes construites par ce robot (une seule par château) et nombre de pierres stockées dans la cour */
    var doors = {}, stock = 0;
    function cp(g) { return { hc: g.hc, rot: g.rot, vac: g.vac.slice() }; }
    function cpC(c) { return { can: c.can, fx: c.fx, fz: c.fz }; }
    function snap(lin) { return { t: s.t, x: s.x, y: s.y, h: s.h, A: cp(s.A), B: cp(s.B), C: cpC(s.C), lin: !!lin }; }
    var stepNo = 0;
    function seg(d, label) { segs.push({ t0: s.t, t1: s.t + d, label: label, step: stepNo }); }
    function pushK(lin) { var k = snap(lin); K.push(k); ctlK(k); }
    function adv(d, label) { seg(d, label); s.t += d; pushK(); applyOpp(s.t); }
    function poseNow() { return { x: s.x, y: s.y, h: s.h, A: cp(s.A), B: cp(s.B), C: cpC(s.C) }; }
    function fk(f) { return f === 'A' ? 0 : 1; }
    function homeGeo(st) { var pk = PK[st.pk]; return { foot: rectPoly({ cx: pk.x, cy: pk.y, hl: 160, hn: 55, ang: pk.tan + 90 }), top: 110 * st.l + 110, bottom: 110 * st.l, id: st.id }; }
    function stoneFoot(st, pose) {
      var c = st.cur;
      if (c.k === 'home') return homeGeo(st);
      if (c.k === 'held') { var p = pose || poseNow(); return geomHeld(p, c.f, c.l); }
      return c.geo;
    }
    function geomHeld(p, f, l) {
      var g = p[f], th0 = g.rot * D2R, fo = heldFoot(p, fk(f), l), zc0 = G.stoneZc(l), sn = Math.sin(th0), cs = Math.cos(th0);
      var zc = g.hc + zc0 * cs, hz = 160 * Math.abs(sn) + 55 * Math.abs(cs);
      return { foot: rectPoly(fo), fo: fo, top: zc + hz, bottom: zc - hz, zc: zc, vertical: Math.abs(sn) > 0.7, ul: zc0 * sn, th: th0, phi: p.h + 120 * fk(f), O: [p.x, p.y] };
    }
    /* centre et rayon d'un obstacle (mis en cache sur l'objet) */
    function prep(o) {
      if (o.rad != null) return o;
      var cx = 0, cy = 0, r = 0, F = o.foot;
      F.forEach(function (v) { cx += v[0] / F.length; cy += v[1] / F.length; });
      F.forEach(function (v) { r = Math.max(r, Math.hypot(v[0] - cx, v[1] - cy)); });
      o.cx = cx; o.cy = cy; o.rad = r; return o;
    }
    function graalGeo() {
      if (graal.cur.k !== 'home') return null;
      return { id: 'graal', foot: graalPoly([P.gx, P.gy], P.ga), bottom: 0, top: GR.h };
    }
    function obstacles(excl) {
      var obs = freeStones(excl).map(function (st) { var g = stoneFoot(st); g.id = st.id; return g; }).concat(foreign());
      var isExcl = (excl || []).some(function (x) { return x === 'graal' || (x && x.id === 'graal'); });
      if (!isExcl) { var gg = graalGeo(); if (gg) obs.push(gg); }
      return obs;
    }
    function heldVsFree(hg, fg, tol) {
      tol = tol == null ? 1 : tol;
      if (!overlap(hg.foot, fg.foot, tol)) return false;
      if (hg.bottom >= fg.top - 1) return false;
      var t = lv(hg.phi), O = hg.O, umin = 1e9, umax = -1e9;
      fg.foot.forEach(function (v) { var u = (v[0] - O[0]) * t[0] + (v[1] - O[1]) * t[1]; umin = Math.min(umin, u); umax = Math.max(umax, u); });
      var c = Math.cos(hg.th), sn = Math.sin(hg.th);
      var rect = [[-160, -55], [160, -55], [160, 55], [-160, 55]].map(function (q) {
        /* pierre tenue dans le plan de la face : axe long tourné de th depuis la latérale */
        return [hg.ul + q[0] * c + q[1] * sn, hg.zc - q[0] * sn + q[1] * c];
      });
      var box = [[umin, fg.bottom], [umax, fg.bottom], [umax, fg.top], [umin, fg.top]];
      return overlap(rect, box, tol);
    }
    function freeStones(excl) { return stones.filter(function (st) { return st.cur.k !== 'held' && st.cur.k !== 'gone' && (!excl || excl.indexOf(st) < 0); }); }
    function heldStonesOf(f) { return held[f] && held[f].stack ? held[f].stack.filter(function (x) { return x; }) : []; }
    function maskOf(f) { var m = 0; heldStonesOf(f).forEach(function (x) { m |= 1 << x.sl; }); return m; }
    function heldGeos(p) { var hs = []; ['A', 'B'].forEach(function (f) { heldStonesOf(f).forEach(function (st) { hs.push(geomHeld(p, f, st.sl)); }); }); return hs; }

    /* ---- corps du robot hors châssis (nacelles, canon, ascenseur), repère robot, mis en cache par état des mécanismes ---- */
    var bodyCache = new Map();
    function rectC(x0, x1, y0, y1) { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }
    function bodiesOf(p) {
      var C = G.cState(p.C), key = p.A.hc.toFixed(1) + ',' + p.A.rot.toFixed(1) + ',' + p.B.hc.toFixed(1) + ',' + p.B.rot.toFixed(1) + ',' + C.can.toFixed(1) + ',' + C.fx.toFixed(1) + ',' + C.fz.toFixed(1);
      var b = bodyCache.get(key); if (b) return b;
      var L = [];
      ['A', 'B'].forEach(function (f, k) { var g = p[f], e = G.actExt(g.rot); L.push({ id: 'nacelle ' + f, P: G.nacPtsR(k, g, e.umax), z0: g.hc + e.zmin, z1: g.hc + e.zmax }); });
      var cp2 = G.canonPtsR(C.can); if (cp2) L.push({ id: 'canon', P: cp2, z0: GE.canon.z[0], z1: GE.canon.z[1] });
      var fx = C.fx, fz = C.fz, F = FO.cao, dy = FO.dentY, xd = fx + F.travEp + F.dentLong;
      [[[[FACE + 10, 110], [FACE + 22, 110], [FACE + 40, 111], [FACE + 40, 125], [FACE + 22, 131], [FACE + 10, 131]], fz - 40, fz + 15],
        [rectC(fx, fx + F.brasLong, F.brasY[0], F.brasY[1]), fz + 5, fz + 15],
        [rectC(fx, fx + F.travEp, dy[0] - F.dentL / 2, F.brasY[1]), fz, fz + 15],
        [rectC(fx + F.travEp, xd, dy[0] - F.dentL / 2, dy[0] + F.dentL / 2), fz, fz + F.dentEp],
        [rectC(fx + F.travEp, xd, dy[1] - F.dentL / 2, dy[1] + F.dentL / 2), fz, fz + F.dentEp]
      ].forEach(function (q) { L.push({ id: 'ascenseur', P: G.faceToRobot(q[0], 240), z0: Math.max(0, q[1]), z1: q[2] }); });
      var R = HULL_R;
      L.forEach(function (o) { o.rad = 0; o.P.forEach(function (v) { o.rad = Math.max(o.rad, Math.hypot(v[0], v[1])); }); R = Math.max(R, o.rad); });
      b = { list: L, R: R };
      if (bodyCache.size > 4000) bodyCache.clear();
      bodyCache.set(key, b);
      return b;
    }
    function bodyPoly(o, p) { return G.toTable(o.P, p); }
    /* tous les contacts (all) ou le premier, pour une pose p, des pierres tenues hs et des obstacles fr */
    function hits(p, hs, fr, tol, all, oNow) {
      var B = bodiesOf(p), mg = Math.max(0, -tol), out = [], i, j, k, o, T = null;
      function add(id) { if (out.indexOf(id) < 0) out.push(id); return !all; }
      function polys() { if (!T) T = B.list.map(function (b) { return bodyPoly(b, p); }); return T; }
      if (p.x < B.R + 1 || p.x > 2999 - B.R || p.y < B.R + 1 || p.y > 1999 - B.R) {
        var edge = !inTable(robotPoly(p), -1);
        if (!edge) { var TT = polys(); for (i = 0; i < B.list.length && !edge; i++) if (B.list[i].z0 < BORDURE && !inTable(TT[i], -1)) edge = true; }
        if (edge && add('bord de table')) return out;
      }
      for (j = 0; j < fr.length; j++) {
        o = prep(fr[j]);
        var d = Math.hypot(o.cx - p.x, o.cy - p.y);
        if (d >= B.R + o.rad + mg) continue;
        if (d < HULL_R + o.rad + mg && G.hullHit(p, o.foot, tol)) { if (add(o.id)) return out; continue; }
        for (k = 0; k < B.list.length; k++) {
          var b = B.list[k];
          if (b.z0 >= o.top - 1 || b.z1 <= o.bottom + 1 || d >= b.rad + o.rad + mg) continue;
          if (overlap(polys()[k], o.foot, tol)) { if (add(o.id)) return out; break; }
        }
      }
      if (oNow && oNow.x != null && G.hullsHit(p, oNow, 1)) { if (add('robot adverse')) return out; }
      for (i = 0; i < hs.length; i++) {
        if (hs[i].bottom < BORDURE && !inTable(hs[i].foot, -1)) { if (add('bord de table')) return out; }
        for (k = 0; k < fr.length; k++) if (heldVsFree(hs[i], fr[k], tol)) { if (add(fr[k].id)) return out; }
      }
      return out;
    }
    /* tol : pénétration tolérée en mm ; négative = marge de sécurité exigée (calcul des trajets) */
    var MARGE = -5, MARGE_TRACE = -25;
    function collides(p, excl, frGeo, tol) {
      tol = tol == null ? 1 : tol;
      if (!p.C) p.C = s.C;
      var r = hits(p, heldGeos(p), frGeo || obstacles(excl), tol, false, oppAt(s.t));
      return r.length ? r[0] : null;
    }
    /* rayon de l'enveloppe du robot (mécanismes et pierres tenues compris), pour l'observation */
    function hullRadius() {
      var p = { x: 0, y: 0, h: s.h, A: cp(s.A), B: cp(s.B), C: cpC(s.C) }, m = bodiesOf(p).R;
      heldGeos(p).forEach(function (g) { g.foot.forEach(function (v) { m = Math.max(m, Math.hypot(v[0], v[1])); }); });
      return m;
    }

    /* ---- contrôles réglementaires à chaque point clé (erreurs moteur) : hauteur des actionneurs, des objets tenus, périmètre ---- */
    var ctlPrev = null, ctlSeen = {}, perCache = new Map();
    function perOf(k, uA, uB) {
      var key = uA.toFixed(1) + ',' + uB.toFixed(1) + ',' + k.C.can.toFixed(1) + ',' + k.C.fx.toFixed(1), v = perCache.get(key);
      if (v == null) { v = G.perimetre(k, { uA: uA, uB: uB }); if (perCache.size > 4000) perCache.clear(); perCache.set(key, v); }
      return v;
    }
    function umaxBetween(a0, a1) { var m = 0, n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 3)); for (var i = 0; i <= n; i++) m = Math.max(m, G.actExt(a0 + (a1 - a0) * i / n).umax); return m; }
    function ctlErr(kind, msg) { if (ctlSeen[kind] === stepNo) return; ctlSeen[kind] = stepNo; err(msg); }
    function ctlK(k) {
      var pr = ctlPrev || k; ctlPrev = k;
      var top = G.actTop(k);
      if (top > H_MAX + 0.5) ctlErr('h', 'Hauteur des actionneurs : ' + Math.round(top) + ' mm (350 mm au plus, règlement général F.3).');
      ['A', 'B'].forEach(function (f) {
        heldStonesOf(f).forEach(function (st) {
          var g = geomHeld(k, f, st.sl);
          if (g.top > H_MAX + 0.5 && !g.foot.every(function (v) { return inCastleAny(v[0], v[1]); })) ctlErr('o', 'Pierre ' + st.id + ' tenue à ' + Math.round(g.top) + ' mm hors du château et des zones de construction (350 mm au plus).');
        });
      });
      var uA = umaxBetween(pr.A.rot, k.A.rot), uB = umaxBetween(pr.B.rot, k.B.rot), per = perOf(k, uA, uB), lim = k.t <= 0.01 ? GE.perDepart : GE.perMatch;
      if (per > lim + 0.5) ctlErr('p', 'Périmètre du robot : ' + Math.round(per) + ' mm (' + lim + ' mm au plus).');
    }
    /* ---- rotations des nacelles : mouvement vertical coordonné (geom.corridor) ---- */
    /* pierres tenues par la face f dans un château (projection au sol de chaque pierre, aux angles du balayage) */
    function heldInCastle(p, f, rots) {
      var hs = heldStonesOf(f); if (!hs.length) return true;
      var a0 = Math.min.apply(null, rots), a1 = Math.max.apply(null, rots), n = Math.max(1, Math.ceil((a1 - a0) / 15));
      for (var i = 0; i <= n; i++) {
        var q = { x: p.x, y: p.y, h: p.h, A: p.A, B: p.B }; q[f] = { hc: p[f].hc, rot: a0 + (a1 - a0) * i / n };
        for (var j = 0; j < hs.length; j++) if (!rectPoly(heldFoot(q, fk(f), hs[j].sl)).every(function (v) { return inCastleAny(v[0], v[1]); })) return false;
      }
      return true;
    }
    var pathCache = new Map();
    /* profil (rot, hc) de a0 à a1 en partant de h0 : la hauteur ne bouge que si le couloir l'impose ; points clés simplifiés */
    function rotPath(mask, ch, a0, h0, a1) {
      var key = mask + ',' + (ch ? 1 : 0) + ',' + a0.toFixed(1) + ',' + h0.toFixed(1) + ',' + a1.toFixed(1), r = pathCache.get(key);
      if (r) return r;
      var n = Math.max(1, Math.ceil(Math.abs(a1 - a0))), A = [], H = [], LO = [], HI = [], m = 1e9, h = h0, i, j, kk;
      for (i = 0; i <= n; i++) { var a = a0 + (a1 - a0) * i / n, c = G.corridor(mask, ch, a); m = Math.min(m, c[1] - c[0]); h = Math.max(c[0], Math.min(c[1], h)); A.push(a); H.push(h); LO.push(c[0]); HI.push(c[1]); }
      if (m < 0) { r = { ok: false, marge: m }; pathCache.set(key, r); return r; }
      var keys = [];
      if (Math.abs(H[0] - h0) > 0.05) keys.push({ rot: a0, hc: H[0], d: Math.max(Math.abs(H[0] - h0) / VZ, 0.1) });
      function fits(i0, j0) { for (var q = i0 + 1; q < j0; q++) { var hl = H[i0] + (H[j0] - H[i0]) * (q - i0) / (j0 - i0); if (hl < LO[q] - 1e-6 || hl > HI[q] + 1e-6) return false; } return true; }
      i = 0;
      while (i < n) { j = i + 1; while (j < n && fits(i, j + 1)) j++; keys.push({ rot: A[j], hc: H[j], d: Math.max(Math.abs(A[j] - A[i]) / WROT, Math.abs(H[j] - H[i]) / VZ) }); i = j; }
      for (kk = 0; kk < keys.length; kk++) keys[kk].d = Math.max(keys[kk].d, 0.02);
      r = { ok: true, marge: m, keys: keys };
      if (pathCache.size > 2000) pathCache.clear();
      pathCache.set(key, r);
      return r;
    }
    function rotMsg(f, a0, a1, ch, marge) { return 'Rotation de la pince ' + f + ' de ' + Math.round(a0) + ' à ' + Math.round(a1) + '° : rotation impossible sous 350 mm (charge ' + (heldStonesOf(f).map(function (x) { return 'rangée ' + (x.sl + 1); }).join(', ') || 'aucune') + (ch ? ', dans le château' : ', hors château') + ', manque ' + Math.round(-marge) + ' mm).'; }
    /* hauteur d'axe hc admissible à l'angle rot (sans rotation) */
    function hcMsg(f, hc, rot, ch) {
      if (hc < HC_MIN - 0.5 || hc > HC_MAX + 0.5) return 'axe de la pince ' + f + ' à ' + Math.round(hc) + ' mm, hors de sa course (' + HC_MIN + ' à ' + HC_MAX + ' mm)';
      var A = G.actExt(rot);
      if (hc + A.zmax > H_MAX + 0.5) return 'haut de la pince ' + f + ' à ' + Math.round(hc + A.zmax) + ' mm (350 mm au plus)';
      if (hc + A.zmin < -0.5) return 'pince ' + f + ' dans le sol';
      var m = maskOf(f);
      if (m && !ch) { var Ld = G.loadExt(m, rot); if (hc + Ld.zmax > H_MAX + 0.5) return 'pierres tenues à ' + Math.round(hc + Ld.zmax) + ' mm hors du château (350 mm au plus)'; }
      return null;
    }
    function zOk(hc) { return hc >= HC_MIN - 0.5 && hc <= HC_MAX + 0.5; }
    function zMsg(hc) { return 'pince à ' + Math.round(hc) + ' mm, hors de sa course (' + HC_MIN + ' à ' + HC_MAX + ' mm)'; }
    /* séquence de mouvements de pince -> points clés { t, hc, rot } depuis l'état from ; err si une rotation ou une hauteur est impossible */
    function expand(f, from, seq, ch) {
      var cur = { hc: from.hc, rot: from.rot }, t = 0, keys = [{ t: 0, hc: from.hc, rot: from.rot }];
      for (var i = 0; i < seq.length; i++) {
        var q = seq[i];
        if (q.rot != null && Math.abs(q.rot - cur.rot) > 0.5) {
          var rp = rotPath(maskOf(f), ch, cur.rot, cur.hc, q.rot);
          if (!rp.ok) return { err: rotMsg(f, cur.rot, q.rot, ch, rp.marge), at: i };
          for (var j = 0; j < rp.keys.length; j++) { t += rp.keys[j].d; cur = { hc: rp.keys[j].hc, rot: rp.keys[j].rot }; keys.push({ t: t, hc: cur.hc, rot: cur.rot }); }
        }
        if (q.hc != null && Math.abs(q.hc - cur.hc) > 0.5) {
          var why = hcMsg(f, q.hc, cur.rot, ch); if (why) return { err: q.label ? q.label + ' : ' + why + '.' : why + '.', at: i };
          t += Math.max(Math.abs(q.hc - cur.hc) / VZ, 0.1); cur = { hc: q.hc, rot: cur.rot }; keys.push({ t: t, hc: cur.hc, rot: cur.rot });
        }
      }
      return { keys: keys, D: t, end: cur };
    }

    /* ---- planification sur grille, test exact du robot à l'orientation d'arrivée ---- */
    var CELL = 40, GW = 75, GH = 50;
    function gridCell(q) { return [Math.max(0, Math.min(GW - 1, Math.floor(q[0] / CELL))), Math.max(0, Math.min(GH - 1, Math.floor(q[1] / CELL)))]; }
    /* cellule libre = robot sans contact ; cellule « serrée » = à moins de la marge d'une pierre (le trajet l'évite si possible) */
    function freeGrid(h, fr) {
      var cache = new Int8Array(GW * GH), A0 = cp(s.A), B0 = cp(s.B), C0 = cpC(s.C);
      function st(i, j) {
        var k = j * GW + i; if (cache[k]) return cache[k];
        if (oppOccupies((i + 0.5) * CELL, (j + 0.5) * CELL, s.t)) { cache[k] = -1; return -1; }
        var p = { x: (i + 0.5) * CELL, y: (j + 0.5) * CELL, h: h, A: A0, B: B0, C: C0 };
        cache[k] = collides(p, null, fr) ? -1 : collides(p, null, fr, MARGE_TRACE) ? 2 : 1; return cache[k];
      }
      var f = function (i, j) { return st(i, j) > 0; };
      f.tight = function (i, j) { return st(i, j) === 2; };
      return f;
    }
    function plan(goal, hGoal, excl, start0, freeF) {
      var start = start0 || [s.x, s.y], fr = obstacles(excl);
      var cell = gridCell, sc = cell(start), gc = cell(goal), N = GW * GH, gS = new Float64Array(N).fill(Infinity), par = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
      var si = sc[1] * GW + sc[0], gi = gc[1] * GW + gc[0], fg = freeF || freeGrid(hGoal, fr);
      function free(i, j) { var k = j * GW + i; return k === si || k === gi || fg(i, j); }
      var heap = [];
      function push(f, i) { heap.push([f, i]); var c = heap.length - 1; while (c > 0) { var pr = (c - 1) >> 1; if (heap[pr][0] <= heap[c][0]) break; var tmp = heap[pr]; heap[pr] = heap[c]; heap[c] = tmp; c = pr; } }
      function pop() { var top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; var c = 0; for (;;) { var l = 2 * c + 1, r = l + 1, m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; var tmp = heap[m]; heap[m] = heap[c]; heap[c] = tmp; c = m; } } return top; }
      gS[si] = 0; push(0, si); var found = false;
      while (heap.length) {
        var cur = pop()[1]; if (closed[cur]) continue; closed[cur] = 1;
        if (cur === gi) { found = true; break; }
        var cx = cur % GW, cy = (cur - cx) / GW;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue; var nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
          var ni = ny * GW + nx; if (closed[ni] || !free(nx, ny)) continue;
          var ng = gS[cur] + Math.hypot(dx, dy) * (fg.tight(nx, ny) ? 4 : 1); if (ng < gS[ni]) { gS[ni] = ng; par[ni] = cur; push(ng + Math.hypot(nx - gc[0], ny - gc[1]), ni); }
        }
      }
      if (!found) return null;
      var path = [], c2 = gi; while (c2 >= 0) { var x = c2 % GW; path.push([(x + 0.5) * CELL, ((c2 - x) / GW + 0.5) * CELL]); c2 = par[c2]; }
      path.reverse(); path[0] = start; path[path.length - 1] = goal;
      function los(a, b) { var n = Math.ceil(dist(a, b) / 30); for (var k = 1; k < n; k++) { var q = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]; var c = cell(q); if (!free(c[0], c[1]) || (fg.tight(c[0], c[1]) && c[1] * GW + c[0] !== si && c[1] * GW + c[0] !== gi)) return false; } return true; }
      var out = [path[0]], i2 = 0;
      while (i2 < path.length - 1) { var jj = path.length - 1; while (jj > i2 + 1 && !los(path[i2], path[jj])) jj--; out.push(path[jj]); i2 = jj; }
      return out;
    }
    /* rotations de pince demandées en temps masqué (étape « Tourner ») : faites pendant le prochain trajet.
       L'état logique de la pince est déjà tourné ; from garde l'état réel tant que le trajet n'a pas eu lieu. */
    var pend = { A: null, B: null }, flushing = false;
    function flushPend() {
      ['A', 'B'].forEach(function (f) {
        var pd = pend[f]; if (!pd) return; pend[f] = null;
        s[f].hc = pd.from.hc; s[f].rot = pd.from.rot; flushing = true; try { runSeq(f, pd.seq); } finally { flushing = false; }
      });
    }
    /* Évitement de l'autre robot en cours de trajet (lidar) : on connaît sa trajectoire ; si la prochaine position
       passerait à moins de 60 mm de lui, le robot s'arrête sur place et attend par pas de 0,1 s. Au bout de 8 s d'attente
       cumulée il repart (le contact éventuel est alors signalé). rk : points clés { t, x, y, h } du trajet, t depuis le départ. */
    var YIELD_GAP = 60, YIELD_MAX = 8, ABORT = { abort: true };
    /* pose à l'instant tt ; lin : interpolation linéaire, sinon adoucie (« smoothstep ») comme la lecture des points clés poseAtK */
    function itpRk(rk, tt, lin) {
      if (tt <= rk[0].t) return rk[0];
      for (var j = 1; j < rk.length; j++) if (tt <= rk[j].t) { var a = rk[j - 1], b = rk[j], u = b.t > a.t ? (tt - a.t) / (b.t - a.t) : 1, e = lin ? u : u * u * (3 - 2 * u); return { t: tt, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, h: a.h + (b.h - a.h) * e }; }
      return rk[rk.length - 1];
    }
    /* après l'arrivée, le robot reste sur place pour travailler (approche et recul de quelques cm compris) :
       on regarde 6 s plus loin, avec une marge plus large */
    var STAY = 6, STAY_GAP = 100;
    function rkConflict(rk, t0, w, lin) {
      var Dr = rk[rk.length - 1].t + w, Dn = Dr + STAY;
      for (var tt = 0; tt <= Dn + 1e-9; tt += 0.1) {
        var o = oppAt(t0 + tt); if (!o || o.x == null) continue;
        if (G.hullsHit(itpRk(rk, Math.max(0, tt - w), lin), o, -(tt > Dr ? STAY_GAP : YIELD_GAP))) return true;
      }
      return false;
    }
    /* 1) on attend au départ le plus court délai qui laisse passer l'adversaire sur tout le trajet ; 2) sinon arrêt en cours de route */
    function yieldRk(rk, t0, lin) {
      var Dn = rk[rk.length - 1].t, near = false, tt, q, o;
      if (!opts.oppPoseAt || rk.length < 2 || Dn <= 0) return { rk: rk, hold: 0 };
      for (tt = 0; tt <= Dn + STAY + 1e-9 && !near; tt += 0.25) { q = itpRk(rk, Math.min(tt, Dn), lin); o = oppAt(t0 + tt); if (o && o.x != null && Math.hypot(q.x - o.x, q.y - o.y) < 800) near = true; }
      if (!near || !rkConflict(rk, t0, 0, lin)) return { rk: rk, hold: 0 };
      for (var w = 0.25; w <= 10 + 1e-9; w += 0.25) {
        if (rkConflict(rk, t0, w, lin)) continue;
        var shifted = [{ t: 0, x: rk[0].x, y: rk[0].y, h: rk[0].h }];
        rk.forEach(function (k) { shifted.push({ t: k.t + w, x: k.x, y: k.y, h: k.h }); });
        return { rk: shifted, hold: w, lin: lin };   /* même profil de mouvement qu'avant, simplement décalé */
      }
      var dt = 0.1, u = 0, tau = 0, waited = 0, cur = null, holds = [];
      while (u < Dn - 1e-9) {
        var nu = Math.min(Dn, u + dt), qn = itpRk(rk, nu, lin), on = oppAt(t0 + tau + (nu - u));
        var blocked = on && on.x != null && G.hullsHit(qn, on, -YIELD_GAP);
        if (blocked && waited >= YIELD_MAX) return { rk: rk, hold: 0, abort: true };
        /* s'arrêter ne sert à rien si l'adversaire arrive sur nous : l'étape est abandonnée plutôt que de se faire percuter en route */
        if (blocked) { var oh = oppAt(t0 + tau + dt), qh = itpRk(rk, u, lin); if (oh && oh.x != null && G.hullsHit(qh, oh, -YIELD_GAP / 2)) return { rk: rk, hold: 0, abort: true }; }
        if (blocked) { if (!cur) cur = { u: u, d: 0 }; cur.d += dt; tau += dt; waited += dt; }
        else { if (cur) { holds.push(cur); cur = null; } tau += nu - u; u = nu; }
      }
      if (cur) holds.push(cur);
      /* le trajet lui-même est libre, mais le robot resterait sur place devant l'adversaire qui passe : on renonce */
      if (!holds.length) return { rk: rk, hold: 0, abort: true };
      /* points clés d'origine, débuts d'arrêt, et un point tous les 0,25 s (lecture linéaire sans écart avec le profil d'origine) */
      var base = rk.map(function (k) { return k.t; }).concat(holds.map(function (hh) { return hh.u; }));
      for (var uu0 = 0.25; uu0 < Dn; uu0 += 0.25) base.push(uu0);
      var us = base.sort(function (a, b) { return a - b; }).filter(function (x, i, arr) { return !i || x - arr[i - 1] > 1e-9; });
      var out = [], cum = 0;
      us.forEach(function (uu) {
        var pq = itpRk(rk, uu, lin); out.push({ t: uu + cum, x: pq.x, y: pq.y, h: pq.h });
        holds.forEach(function (hh) { if (Math.abs(hh.u - uu) < 1e-9) { cum += hh.d; out.push({ t: uu + cum, x: pq.x, y: pq.y, h: pq.h }); } });
      });
      return { rk: out, hold: cum, lin: true };
    }
    /* grip : mouvements de pince faits pendant le trajet (temps masqué), { f, seq: [{ hc } | { rot }] } */
    function travel(O, h, label, excl, speed, grip) {
      if (opts.oppPoseAt) {
        var dir0 = [O[0] - s.x, O[1] - s.y], waits = 0, Vnow = speed || V;
        while (waits < 4) {
          var guess = (dist([s.x, s.y], O) < 60) ? [[s.x, s.y], O] : (plan(O, h, excl) || [[s.x, s.y], O]);
          var hit = oppBlocks({ x: s.x, y: s.y, h: s.h }, s.t, dir0), acc = 0, gi;
          for (gi = 1; gi < guess.length && !hit; gi++) {
            acc += dist(guess[gi - 1], guess[gi]);
            if (oppBlocks({ x: guess[gi][0], y: guess[gi][1], h: h }, s.t + acc / Vnow, [guess[gi][0] - guess[gi - 1][0], guess[gi][1] - guess[gi - 1][1]])) hit = true;
          }
          if (!hit) break;
          var o0 = oppAt(s.t) || { x: 0, y: 0 };
          adv(2, 'Attente 2 s : adversaire dans le lidar');
          waits++;
          var o1 = oppAt(s.t) || o0;
          if (Math.hypot((o1.x || 0) - o0.x, (o1.y || 0) - o0.y) < 40) break;
        }
      }
      var Gl = [], pendTxt = [], pendBackup = { A: pend.A, B: pend.B }, after = {};
      var pEnd = { x: O[0], y: O[1], h: h, A: s.A, B: s.B };
      ['A', 'B'].forEach(function (f) {
        var seq = [], mk = maskOf(f);
        /* garde au sol des pierres tenues (et 350 mm hors du château) pendant le trajet */
        if (mk) { var c = G.corridor(mk, false, s[f].rot); if (c[0] <= c[1] && (s[f].hc < c[0] - 0.5 || s[f].hc > c[1] + 0.5)) seq.push({ hc: Math.max(c[0], Math.min(c[1], s[f].hc)), label: 'Pierres tenues à la hauteur de trajet' }); }
        if (pend[f]) { seq = seq.concat(pend[f].seq); pendTxt.push(f); pend[f] = null; }
        if (grip && grip.f === f) seq = seq.concat(grip.seq);
        if (!seq.length) return;
        var from = pendBackup[f] ? pendBackup[f].from : cp(s[f]);
        var rots = [from.rot].concat(seq.filter(function (q) { return q.rot != null; }).map(function (q) { return q.rot; }));
        var q0 = { x: s.x, y: s.y, h: s.h, A: s.A, B: s.B }; q0[f] = from;
        var ch = heldInCastle(q0, f, rots) && heldInCastle(pEnd, f, rots), ex = expand(f, from, seq, ch);
        /* impossible pendant le trajet (pierres hors du château par exemple) : fait sur place à l'arrivée */
        if (ex.err) { after[f] = seq; s[f].hc = from.hc; s[f].rot = from.rot; return; }
        Gl.push({ f: f, from: from, seq: seq, gk: ex.keys, end: ex.keys[ex.keys.length - 1] });
      });
      Gl.forEach(function (g) { s[g.f].hc = g.from.hc; s[g.f].rot = g.from.rot; });
      var Gtot = 0; Gl.forEach(function (g) { Gtot = Math.max(Gtot, g.end.t); });
      function itp(arr, t) {
        if (t >= arr[arr.length - 1].t) return arr[arr.length - 1];
        for (var j = 1; j < arr.length; j++) if (t <= arr[j].t) { var a = arr[j - 1], b = arr[j], u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1; return { t: t, hc: a.hc + (b.hc - a.hc) * u, rot: a.rot + (b.rot - a.rot) * u, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, h: a.h + (b.h - a.h) * u }; }
        return arr[arr.length - 1];
      }
      function withG(fn) { var o = {}; Gl.forEach(function (g) { o[g.f] = cp(s[g.f]); s[g.f].hc = g.end.hc; s[g.f].rot = g.end.rot; }); var r = fn(); Gl.forEach(function (g) { s[g.f].hc = o[g.f].hc; s[g.f].rot = o[g.f].rot; }); return r; }
      /* tracé avec la pince dans son état final ; s'il est bloqué près du départ, avec son état de départ (elle bougera en fin de trajet) */
      var pts = (dist([s.x, s.y], O) < 60) ? null : withG(function () { return plan(O, h, excl); });
      if (!pts && Gl.length && dist([s.x, s.y], O) >= 60) pts = plan(O, h, excl);
      if (!pts) pts = [[s.x, s.y], O];
      var L = 0; for (var i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
      var dh = angd(s.h, h), h0 = s.h, st0 = [s.x, s.y];
      function splitAt(pp, d0) { var acc2 = 0, o2 = [pp[0]]; for (var q = 1; q < pp.length; q++) { var dd = dist(pp[q - 1], pp[q]); if (acc2 < d0 - 0.5 && acc2 + dd > d0 + 0.5) { var u = (d0 - acc2) / dd; o2.push([pp[q - 1][0] + (pp[q][0] - pp[q - 1][0]) * u, pp[q - 1][1] + (pp[q][1] - pp[q - 1][1]) * u]); } acc2 += dd; o2.push(pp[q]); } return o2; }
      /* modes : rotation au milieu, au début, à la fin, sur place avant, sur place après */
      var modes = L > 50 ? [[Math.min(200, L * 0.25), Math.max(Math.min(200, L * 0.25) + 1, L - Math.min(200, L * 0.25))], [0, Math.min(L, 450)], [Math.max(0, L - 450), L], ['avant'], ['apres']] : [[0, Math.max(L, 1)], ['avant'], ['apres']];
      var fr = obstacles(excl);
      function nodesFor(m) {
        var nodes = [];
        if (m[0] === 'avant') { nodes.push({ p: pts[0], h: h0 + dh, d: 0, rotOnly: true }); var a3 = 0; for (var q = 1; q < pts.length; q++) { a3 += dist(pts[q - 1], pts[q]); nodes.push({ p: pts[q], h: h0 + dh, d: a3 }); } return nodes; }
        if (m[0] === 'apres') { var a4 = 0; for (var q2 = 1; q2 < pts.length; q2++) { a4 += dist(pts[q2 - 1], pts[q2]); nodes.push({ p: pts[q2], h: h0, d: a4 }); } nodes.push({ p: pts[pts.length - 1], h: h0 + dh, d: a4, rotOnly: true }); return nodes; }
        var pp = splitAt(splitAt(pts, m[0]), m[1]), a5 = 0;
        /* trajet quasi nul : la rotation se fait entièrement */
        for (var q3 = 1; q3 < pp.length; q3++) { a5 += dist(pp[q3 - 1], pp[q3]); var fh = L < 1 ? 1 : Math.max(0, Math.min(1, (a5 - m[0]) / Math.max(1, m[1] - m[0]))); nodes.push({ p: pp[q3], h: h0 + dh * fh, d: a5 }); }
        return nodes;
      }
      /* instants de passage aux nœuds (depuis le départ du robot) : mêmes règles que le mouvement réel */
      function timesOf(nodes) {
        var Ln = nodes.length ? nodes[nodes.length - 1].d : 0, tM = Ln / (speed || V), tR = Math.abs(dh) / WR, rotN = nodes.some(function (x) { return x.rotOnly; });
        var D = Math.max(rotN ? tM + tR : Math.max(tM, tR), 0.2), turned = false;
        return { D: D, L: Ln, rotN: rotN, ts: nodes.map(function (nd) { if (nd.rotOnly) turned = true; var tt = rotN ? (Ln > 0 ? nd.d / Ln : 1) * tM + (turned ? tR : 0) : (Ln > 0 ? nd.d / Ln : 1) * D; return Math.min(tt, D); }) };
      }
      /* contrôle fin du trajet : position du robot et état des pinces au même instant.
         gMode : 'tot' la pince bouge dès le départ, 'fin' elle finit à l'arrivée, 'avant' le robot attend la pince avant de partir */
      var gMode = 'tot', delay = 0, gOff = 0;
      function setTiming(T) { delay = gMode === 'avant' ? Gtot : 0; gOff = gMode === 'fin' ? Math.max(0, T.D - Gtot) : 0; }
      function hitsFor(nodes) {
        var T = timesOf(nodes), prev = { p: st0, h: h0, t: 0 }; setTiming(T);
        function grips(q, t) { Gl.forEach(function (g) { var e = itp(g.gk, t - gOff); q[g.f] = { hc: e.hc, rot: e.rot, vac: s[g.f].vac }; }); return q; }
        function at(q, t) { return collides(grips(q, t), null, fr); }
        if (delay > 0) for (var tw = 0.05; tw < delay; tw += 0.05) if (at({ x: st0[0], y: st0[1], h: h0, A: cp(s.A), B: cp(s.B) }, tw)) return true;
        for (var i = 0; i < nodes.length; i++) {
          var nd = nodes[i], ti = T.ts[i], n = Math.max(1, Math.ceil(Math.max(dist(prev.p, nd.p) / 10, Math.abs(nd.h - prev.h) / 1.5, Gl.length ? (ti - prev.t) / 0.05 : 0)));
          var qAt = function (u) { return grips({ x: prev.p[0] + (nd.p[0] - prev.p[0]) * u, y: prev.p[1] + (nd.p[1] - prev.p[1]) * u, h: prev.h + (nd.h - prev.h) * u, A: cp(s.A), B: cp(s.B) }, delay + prev.t + (ti - prev.t) * u); };
          var fine = Math.max(1, Math.ceil(Math.max(dist(prev.p, nd.p) / 1, Math.abs(nd.h - prev.h) / 0.2) / n));
          for (var k = 1; k <= n; k++) {
            var q = qAt(k / n);
            if (collides(q, null, fr)) return true;
            /* point serré : vérification à ~1 mm et 0,2° autour de lui, pour qu'aucun contact ne passe entre deux vérifications */
            if (collides(q, null, fr, MARGE)) for (var z = -fine; z <= fine; z++) { var uz = (k + z / fine) / n; if (uz > 0 && uz < 1 && collides(qAt(uz), null, fr)) return true; }
          }
          prev = { p: nd.p, h: nd.h, t: ti };
        }
        /* robot arrivé, pince encore en mouvement */
        for (var te = delay + T.D; te < gOff + Gtot + 0.05; te += 0.05) if (at({ x: prev.p[0], y: prev.p[1], h: prev.h, A: cp(s.A), B: cp(s.B) }, te)) return true;
        return false;
      }
      function search() {
        var ch = null;
        for (var mi = 0; mi < modes.length && !ch; mi++) { var nd = nodesFor(modes[mi]); if (!hitsFor(nd)) ch = nd; }
        if (!ch && dist(st0, O) >= 60) {
          var pts0 = pts, alt = withG(function () { return plan(O, h0, excl); }) || (Gl.length ? plan(O, h0, excl) : null);
          if (alt) { pts = alt; var nd2 = nodesFor(['apres']); if (!hitsFor(nd2)) ch = nd2; }
          if (!ch) pts = pts0;
        }
        /* dernier recours : aller au cap de départ jusqu'à un endroit dégagé, y pivoter sur place, puis finir au cap d'arrivée */
        if (!ch && Math.abs(dh) > 1) ch = withG(function () { return viaRotation(); });
        return ch;
      }
      var chosen = search();
      /* sinon : la pince bouge en fin de trajet (une fois le robot éloigné), ou avant que le robot parte */
      if (!chosen && Gl.length && Gtot > 0) { gMode = 'fin'; chosen = search(); }
      if (!chosen && Gl.length && Gtot > 0) { gMode = 'avant'; chosen = search(); }
      if (!chosen) gMode = 'tot';
      if (!chosen) { chosen = nodesFor(modes[0]); err('Trajet vers ' + Math.round(O[0]) + ', ' + Math.round(O[1]) + ' : aucun passage sans contact trouvé (' + label + ').'); }
      function viaRotation() {
        var h1 = h0 + dh, f0 = freeGrid(h0, fr), f1 = freeGrid(h1, fr), sc = gridCell(st0), si = sc[1] * GW + sc[0];
        function ctr(k) { var i = k % GW; return k === si ? st0 : [(i + 0.5) * CELL, ((k - i) / GW + 0.5) * CELL]; }
        /* d'abord par les cases dégagées (marge du tracé), puis en acceptant les cases serrées */
        for (var pass = 0; pass < 2; pass++) {
          var par = new Int32Array(GW * GH).fill(-2), q = [si], qi = 0; par[si] = -1;
          while (qi < q.length && q.length < 3750) {
            var k = q[qi++], ci = k % GW, cj = (k - ci) / GW;
            for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
              var ni = ci + dx, nj = cj + dy, nk = nj * GW + ni;
              if ((dx || dy) && ni >= 0 && nj >= 0 && ni < GW && nj < GH && par[nk] === -2 && f0(ni, nj) && (pass || !f0.tight(ni, nj))) { par[nk] = k; q.push(nk); }
            }
          }
          var cand = q.slice().sort(function (a, b) { var A = ctr(a), B = ctr(b); return (dist(A, O) + 0.5 * dist(A, st0)) - (dist(B, O) + 0.5 * dist(B, st0)); });
          for (var c = 0; c < Math.min(cand.length, 60); c++) {
            var P0 = ctr(cand[c]), p2 = dist(P0, O) < 1 ? [P0, O] : plan(O, h1, excl, P0, f1); if (!p2) continue;
            var chain = [], k2 = cand[c]; while (k2 !== si && k2 >= 0) { chain.push(ctr(k2)); k2 = par[k2]; } chain.reverse();
            var nodes = [], d = 0, prev = st0;
            chain.forEach(function (pt) { d += dist(prev, pt); nodes.push({ p: pt, h: h0, d: d }); prev = pt; });
            nodes.push({ p: P0, h: h1, d: d, rotOnly: true });
            p2.slice(1).forEach(function (pt) { d += dist(prev, pt); nodes.push({ p: pt, h: h1, d: d }); prev = pt; });
            if (!hitsFor(nodes)) return nodes;
          }
        }
        return null;
      }
      var T = timesOf(chosen), D = T.D, t0 = s.t; setTiming(T);
      Gl.forEach(function (g) { g.gk = g.gk.map(function (k) { return { t: k.t + gOff, hc: k.hc, rot: k.rot }; }); if (gOff > 0) g.gk.unshift({ t: 0, hc: g.from.hc, rot: g.from.rot }); });
      var rk = [{ t: 0, x: s.x, y: s.y, h: s.h }];
      if (delay > 0) rk.push({ t: delay, x: s.x, y: s.y, h: s.h });
      chosen.forEach(function (nd, i) { rk.push({ t: delay + T.ts[i], x: nd.p[0], y: nd.p[1], h: nd.h }); });
      var linFlag = Gl.length ? true : chosen.length > 1, yl = yieldRk(rk, t0, linFlag);
      if (yl.abort) {
        /* passage bloqué par l'adversaire : le robot reste où il est, attend, et l'étape échoue (jamais de superposition) */
        ['A', 'B'].forEach(function (f) { pend[f] = pendBackup[f]; });
        adv(YIELD_MAX, 'Attente ' + YIELD_MAX + ' s : passage bloqué par l\'adversaire');
        err('Trajet vers ' + Math.round(O[0]) + ', ' + Math.round(O[1]) + ' abandonné : passage bloqué par le robot adverse (' + label + ').');
        throw ABORT;
      }
      rk = yl.rk; D += yl.hold;
      if (!Gl.length) {
        seg(D, label + (yl.hold ? ' · arrêt de ' + String(Math.round(yl.hold * 10) / 10).replace('.', ',') + ' s : adversaire sur le trajet' : ''));
        rk.slice(1).forEach(function (k) { s.x = k.x; s.y = k.y; s.h = k.h; s.t = t0 + k.t; pushK(yl.lin != null ? yl.lin : linFlag); });
        s.x = O[0]; s.y = O[1]; s.h = h0 + dh; s.t = t0 + D;
      } else {
        /* pince en temps masqué : ses mouvements s'enchaînent pendant le trajet, le robot attend la pince si elle est plus lente */
        var D2 = Math.max(delay + D, gOff + Gtot);
        seg(D2, label + (grip ? ' · pince en temps masqué' : '') + (pendTxt.length ? ' · rotation de la pince ' + pendTxt.join(' et ') + ' pendant le trajet' : '') + (gMode === 'avant' ? ' (la pince d\'abord)' : gMode === 'fin' ? ' (pince en fin de trajet)' : ''));
        var ts = Gl.reduce(function (a, g) { return a.concat(g.gk); }, rk).map(function (k) { return k.t; }).concat([D2]).filter(function (t) { return t > 1e-6; }).sort(function (a, b) { return a - b; });
        ts.filter(function (t, i) { return !i || t - ts[i - 1] > 1e-6; }).forEach(function (t) {
          var r = itp(rk, t); s.x = r.x; s.y = r.y; s.h = r.h;
          Gl.forEach(function (g) { var q = itp(g.gk, t); s[g.f].hc = q.hc; s[g.f].rot = q.rot; });
          s.t = t0 + t; pushK(true);
        });
        s.x = O[0]; s.y = O[1]; s.h = h0 + dh; s.t = t0 + D2;
        applyOpp(s.t);
        Gl.forEach(function (g) { s[g.f].hc = g.end.hc; s[g.f].rot = g.end.rot; });
      }
      ['A', 'B'].forEach(function (f) { if (after[f]) runSeq(f, after[f]); });
    }
    function runSeq(f, seq) { seq.forEach(function (q) { if (q.rot != null) rr(f, q.rot, q.label); if (q.hc != null) zz(f, q.hc, q.label); }); }
    /* trajet + mouvements de pince : pendant le trajet si tm, sinon avant (before) ou après */
    function moveTo(O, h, label, excl, f, seq, tm, before) {
      if (tm && seq.length) return travel(O, h, label, excl, null, { f: f, seq: seq });
      if (before) runSeq(f, seq);
      travel(O, h, label, excl);
      if (!before) runSeq(f, seq);
    }
    var lastExcl = null;
    function lin(O, h, v, label, excl) {
      flushPend();
      var useExcl = excl !== undefined ? excl : lastExcl;
      var d = Math.max(dist([s.x, s.y], O) / v, Math.abs(angd(s.h, h)) / WR, 0.15);
      var steps = Math.max(2, Math.ceil(dist([s.x, s.y], O) / 25));
      var sx0 = s.x, sy0 = s.y, sh0 = s.h, dh = angd(sh0, h);
      for (var k = 1; k <= steps; k++) {
        var u = k / steps;
        var pk = { x: sx0 + (O[0] - sx0) * u, y: sy0 + (O[1] - sy0) * u, h: sh0 + dh * u, A: cp(s.A), B: cp(s.B), C: s.C };
        var col = collides(pk, useExcl);
        if (col) { err(label + ' : contact avec ' + col + ' pendant lin().'); break; }
      }
      s.x = O[0]; s.y = O[1]; s.h = s.h + dh; adv(d, label);
    }
    /* mouvement de pince sur place (points clés { hc, rot }) : contrôle des contacts pendant le mouvement */
    function gripCheck(f, keys, label) {
      var p = poseNow(), g0 = { hc: s[f].hc, rot: s[f].rot };
      for (var i = 0; i < keys.length; i++) {
        var g1 = keys[i], n = Math.max(2, Math.ceil(Math.max(Math.abs(g1.hc - g0.hc) / 10, Math.abs(g1.rot - g0.rot) / 3)));
        for (var k = 1; k <= n; k++) { var u = k / n; p[f] = { hc: g0.hc + (g1.hc - g0.hc) * u, rot: g0.rot + (g1.rot - g0.rot) * u, vac: s[f].vac }; var c = collides(p); if (c) { err(label + ' : contact avec ' + c + ' (la pince bouge sur place).'); return; } }
        g0 = g1;
      }
    }
    function zz(f, hc, label) {
      flushPend(); if (Math.abs(hc - s[f].hc) < 0.5) return;
      var why = hcMsg(f, hc, s[f].rot, heldInCastle(poseNow(), f, [s[f].rot]));
      if (why) { err((label || 'Pince ' + f) + ' : ' + why + '.'); throw ABORT; }
      gripCheck(f, [{ hc: hc, rot: s[f].rot }], label);
      var d = Math.max(Math.abs(hc - s[f].hc) / VZ, 0.1); s[f].hc = hc; adv(d, label);
    }
    function rr(f, deg, label) {
      flushPend(); if (Math.abs(deg - s[f].rot) < 0.5) return;
      var a0 = s[f].rot, ch = heldInCastle(poseNow(), f, [a0, deg]), rp = rotPath(maskOf(f), ch, a0, s[f].hc, deg);
      if (!rp.ok) { err(rotMsg(f, a0, deg, ch, rp.marge)); throw ABORT; }
      gripCheck(f, rp.keys, label);
      rp.keys.forEach(function (k) { s[f].hc = k.hc; s[f].rot = k.rot; adv(k.d, label); });
      s[f].rot = deg;
    }
    function vac(f, arr, label, dur) { flushPend(); s[f].vac = arr; pushK(); adv(dur, label); }
    /* pose : position où la pierre se retrouve (pince réelle, ou hauteur d'atterrissage si elle est lâchée de haut) */
    function release(st, f, pose) { var p = pose || poseNow(), g = geomHeld(p, f, st.sl); st.cur = { k: 'free', geo: g, pose: p, f: f, l: st.sl }; st.tl.push({ t: s.t, k: 'free', pose: p, f: f, l: st.sl }); }
    function err(msg) { errors.push({ step: stepNo, msg: msg }); if (stepNo > 0 && stepInfo[stepNo - 1] && !stepInfo[stepNo - 1].err) stepInfo[stepNo - 1].err = msg; }
    function nv2(a) { return nv(a); }
    function choose(cands, excl, backDist, normalOnly) {
      var nn = cands.length, sc = new Array(nn), ord = new Array(nn), cols = new Array(nn), i;
      if (!nn) return null;
      for (i = 0; i < nn; i++) {
        var c0 = cands[i];
        sc[i] = (c0.pen || 0) + dist([s.x, s.y], c0.O) * 0.2 + Math.abs(angd(s.h, c0.h)) * 0.5;
        ord[i] = i;
      }
      lastExcl = excl;
      ord.sort(function (x, y) { return sc[x] - sc[y] || x - y; });
      function colOf(c) {
        var p = { x: c.O[0], y: c.O[1], h: c.h, A: cp(s.A), B: cp(s.B), C: c.setC || cpC(s.C) };
        if (c.setA) p.A = Object.assign(p.A, c.setA); if (c.setB) p.B = Object.assign(p.B, c.setB);
        var col = c.check ? c.check(p) : collides(p, excl);
        if (!col && backDist) {
          var nnv = nv(c.phi), tt = lv(c.phi), bopts = [[c.O[0] - backDist * nnv[0], c.O[1] - backDist * nnv[1]]];
          if (!normalOnly) bopts.push([c.O[0] + 170 * tt[0] - 8 * nnv[0], c.O[1] + 170 * tt[1] - 8 * nnv[1]], [c.O[0] - 170 * tt[0] - 8 * nnv[0], c.O[1] - 170 * tt[1] - 8 * nnv[1]]);
          var okB = null;
          for (var q = 0; q < bopts.length && !okB; q++) { var pb = { x: bopts[q][0], y: bopts[q][1], h: c.h, A: cp(s.A), B: cp(s.B), C: c.setC || cpC(s.C) }; if (c.backCheck ? !c.backCheck(pb) : !collides(pb, excl)) okB = bopts[q]; }
          if (okB) c.Ob = okB; else col = 'recul impossible';
        }
        return col;
      }
      for (var oi = 0; oi < nn; oi++) {
        i = ord[oi]; var c = cands[i];
        var col = colOf(c);
        if (!col) return { c: c, score: sc[i], col: null };
        cols[i] = col;
      }
      return { c: cands[0], score: sc[0], col: cols[0] };
    }
    function stackStones(pkIdx) { return stones.filter(function (st) { return st.pk === pkIdx; }).sort(function (a, b) { return a.l - b.l; }); }
    function stackCenter(sts) {
      var c = sts[0].cur;
      if (c.k === 'home') { var pk = PK[sts[0].pk]; return { c: [pk.x, pk.y], tan: pk.tan }; }
      var fo = c.geo.fo; return { c: [fo.cx, fo.cy], tan: fo.ang - 90 };
    }
    function stoneById(id) { return stones.filter(function (o) { return o.id === id; })[0]; }
    function zoneAt(c) {
      for (var i = 0; i < ZM.length; i++) if (inPoly(c[0], c[1], zoneRect(ZM[i]))) return ZM[i].id;
      for (var j = 0; j < ZT.length; j++) if (dist(c, ZT[j].c) <= ZTR) return ZT[j].id;
      return null;
    }
    /* quelque chose (pierre libre ou Graal) est-il posé sur la pierre st ? */
    function covered(st, excl) {
      var g = stoneFoot(st), on = null;
      freeStones(excl).forEach(function (o) { if (o === st || on) return; var go = stoneFoot(o); if (go.bottom >= g.top - 1 && overlap(g.foot, go.foot, 1)) on = o.id; });
      return on;
    }
    function takeAt(f, b, label, excl, seq, tm, hc, what, onGrab) {
      var n = nv2(b.c.phi), Ob = [b.c.O[0] - 80 * n[0], b.c.O[1] - 80 * n[1]];
      /* la pierre visée n'est ignorée qu'au contact final : le trajet jusqu'au point de recul doit l'éviter */
      moveTo(Ob, b.c.h, label, null, f, seq, tm, false);
      if (excl && excl.some(isClaimed)) return err('Le paquet ' + what + ' n\'est plus là (pris par l\'adversaire).');
      lin(b.c.O, b.c.h, VA, 'Contact avec ' + what);
      onGrab();
      zz(f, Math.min(hc + 15, HC_MAX), 'Levée de 15 mm');
      lin(Ob, b.c.h, VA, 'Recul avec ' + what);
    }
    /* stockage : pierres libres posées dans la cour de notre château, hors zones de construction (E.1.b : 3 au plus) */
    function inAnyZone(foot) {
      for (var i = 0; i < ZM.length; i++) if (overlap(foot, zoneRect(ZM[i]), 0)) return true;
      for (var j = 0; j < ZT.length; j++) if (ptPolyD(ZT[j].c, foot) < ZTR) return true;
      return false;
    }
    function stored(foot) { var c = [0, 0]; foot.forEach(function (v) { c[0] += v[0] / foot.length; c[1] += v[1] / foot.length; }); return inPoly(c[0], c[1], OWN_COUR) && !inAnyZone(foot); }
    function stockCount() { return stones.filter(function (x) { return x.cur.k === 'free' && stored(x.cur.geo.foot); }).length; }
    var STOCK_MAX = RG.construction.stockage_max_cour;
    function stockPre(foots) {
      var n = foots.filter(stored).length;
      if (n && stockCount() + n > STOCK_MAX) return 'Stockage : ' + (stockCount() + n) + ' pierres seraient posées dans la cour hors des zones de construction (' + STOCK_MAX + ' au plus, E.1.b).';
      return null;
    }

    /* ---- préconditions (vérification pure : ni avance du temps, ni planification) ---- */
    function holdsPile(f) { var hs = heldStonesOf(f); return hs.length === 3 && hs.every(function (x, i) { return x.sl === i; }); }
    var PRE = {
      prendre: function (st) {
        var f = st.f; if (f !== 'A' && f !== 'B') return 'Face inconnue (A ou B).';
        if (held[f]) return 'La face ' + f + ' tient déjà quelque chose.';
        if (st.mode === 'pierre' || st.mode === 'deux') return prePierre(st).why;
        var idx = -1; PK.forEach(function (pk, i) { if (pk.id === st.p) idx = i; }); if (idx < 0) return 'Paquet inconnu.';
        var sts = stackStones(idx);
        if (sts.some(isClaimed)) return 'Le paquet ' + st.p + ' n\'est plus là (pris par l\'adversaire).';
        if (sts.some(function (x) { return x.cur.k === 'held'; })) return 'Le paquet ' + st.p + ' est déjà tenu.';
        var tag = sts[0].tag;
        if (!sts.every(function (x) { return x.tag === tag; }) || (tag !== 'home' && sts[0].cur.geo.vertical)) return 'Les pierres de ' + st.p + ' ne sont plus empilées.';
        var on = covered(sts[2], sts); if (on) return 'Le paquet ' + st.p + ' n\'est pas dégagé : ' + on + ' est posé dessus.';
        var hc = stoneFoot(sts[0]).bottom + 165; if (!zOk(hc)) return 'Prise de ' + st.p + ' : ' + zMsg(hc) + '.';
        return null;
      },
      deposer: function (st) {
        var f = st.f, rot = st.r != null ? +st.r : (st.o === 'debout' ? 90 : 0), hs = heldStonesOf(f), dep = st.q === 'pile' ? hs : hs.filter(function (x) { return x.id === st.q; });
        if ([0, 90, 180].indexOf(rot) < 0) return 'Angle de pince : 0, 90 ou 180°.';
        if (st.drop && rot === 90) return 'Lâcher : seulement à plat (une pierre debout lâchée de haut basculerait).';
        if (!hs.length) return 'La face ' + f + ' ne tient aucune pierre.';
        if (!dep.length) return 'La pierre ' + st.q + ' n\'est pas tenue par la face ' + f + '.';
        var cs = Math.cos(rot * D2R);
        if (rot !== 90) {
          var dsl = dep.map(function (x) { return x.sl; }), all = hs.map(function (x) { return x.sl; }), low = cs > 0 ? Math.min : Math.max;
          if (Math.max.apply(null, dsl) - Math.min.apply(null, dsl) + 1 !== dep.length) return 'Pile à plat impossible : il manque une pierre au milieu de la pince, celles du dessus tomberaient.';
          if (st.q !== 'pile' && low.apply(null, dsl) !== low.apply(null, all)) return 'À plat, seule la pierre du bas de la pince peut être posée seule : ' + st.q + ' a une pierre tenue sous elle.';
        }
        if (Math.abs(s[f].rot - rot) > 0.5 && !G.balayage(maskOf(f), true, s[f].rot, rot).ok) return rotMsg(f, s[f].rot, rot, true, G.balayage(maskOf(f), true, s[f].rot, rot).marge);
        var T = [+st.x || 0, +st.y || 0], foot = rectPoly({ cx: T[0], cy: T[1], hl: 160, hn: 55, ang: (+st.ang || 0) });
        return stockPre(dep.map(function () { return foot; }));
      },
      mur: function (st) {
        var f = st.f, z = zoneById(st.z);
        if (!z || z.tan === undefined) return 'Zone de mur inconnue.';
        if (heldStonesOf(f).length !== 3 || (s[f].rot !== 0 && s[f].rot !== 180)) return 'Il faut une pile de 3 pierres à plat sur la face ' + f + '.';
        return null;
      },
      tour: function (st) {
        var f = st.f, z = zoneById(st.z);
        if (!z || z.tan !== undefined) return 'Zone de tour inconnue.';
        if (!heldStonesOf(f).some(function (x) { return x.id === st.s; })) return 'La pierre ' + st.s + ' n\'est pas tenue par la face ' + f + '.';
        if (Math.abs(s[f].rot - 90) > 0.5) { var b = G.balayage(maskOf(f), true, s[f].rot, 90); if (!b.ok) return rotMsg(f, s[f].rot, 90, true, b.marge); }
        return null;
      },
      porte: function (st) {
        var f = st.f, z = zoneById(st.z);
        if (!z || z.tan === undefined) return 'Zone de mur inconnue.';
        if (!holdsPile(f) || s[f].rot !== 0) return 'Il faut une pile de 3 pierres à plat sur la face ' + f + ' (rangées 1, 2 et 3).';
        var cas = inPoly(z.c[0], z.c[1], CASTLE) ? 'jaune' : 'bleu';
        if (doors[cas]) return 'Une seule porte par château (E.1.b) : porte déjà construite sur ' + doors[cas] + '.';
        return null;
      },
      tir: function () { return preTir(); },
      boulets: function () { return preTir(); },
      monterGraal: function () {
        if (graal.cur.k !== 'home') return graal.cur.k === 'retire' ? 'Le Graal a été retiré de la table.' : 'Le Graal n\'est plus à son départ.';
        if (!inPoly(s.x, s.y, OWN_CASTLE)) return 'Monter le Graal : le robot doit être dans son château.';
        if (Math.abs(s.C.fx - FO.fxRentree) > 0.5 || Math.abs(s.C.fz - FO.fzHaut) > 0.5) return 'Monter le Graal : la fourche n\'est pas rangée.';
        return null;
      },
      traj: function (st) { return (st.pts || []).some(function (q) { return q && isFinite(+q.x) && isFinite(+q.y); }) ? null : 'Trajectoire : aucun point (clique sur la table pour en ajouter).'; },
      lacher: function (st) {
        var f = st.f, hs = heldStonesOf(f), dep = st.q === 'pile' || !st.q ? hs : hs.filter(function (x) { return x.id === st.q; });
        if (!hs.length) return 'La face ' + f + ' ne tient aucune pierre.';
        if (!dep.length) return 'La pierre ' + st.q + ' n\'est pas tenue par la face ' + f + '.';
        var cs = Math.cos(s[f].rot * D2R);
        if (Math.abs(cs) >= 0.5) {
          var sl = dep.map(function (x) { return x.sl; }), all = hs.map(function (x) { return x.sl; }), low = cs > 0 ? Math.min : Math.max;
          if (Math.max.apply(null, sl) - Math.min.apply(null, sl) + 1 !== dep.length) return 'Lâcher : il manque une pierre au milieu de la pince, celles du dessus tomberaient en vrac.';
          if (low.apply(null, sl) !== low.apply(null, all)) return 'Lâcher à plat : seule la pierre du bas de la pince peut être lâchée seule (une pierre tenue est sous ' + dep[0].id + ').';
        }
        var p = poseNow();
        return stockPre(dep.map(function (x) { return geomHeld(p, f, x.sl).foot; }));
      },
      deposerZone: function (st) { return PRE.lacher(st); },
      seDeplacer: function () { return null; },
      tourner: function (st) {
        var f = st.f, r = +st.r;
        if ([0, 90, 180].indexOf(r) < 0) return 'Angle de pince : 0, 90 ou 180°.';
        if (Math.abs(s[f].rot - r) > 0.5) { var b = G.balayage(maskOf(f), true, s[f].rot, r); if (!b.ok) return rotMsg(f, s[f].rot, r, true, b.marge); }
        return null;
      },
      attendre: function () { return null; },
      attendreJusqua: function () { return null; },
      trone: function () { return null; }
    };
    function preTir() {
      if (balls.shots) return 'La séance de tir a déjà eu lieu.';
      if (s.t >= MATCH) return 'Tir impossible : le match est terminé (tir autorisé de ' + T_ATTAQUE + ' à ' + MATCH + ' s).';
      if (!(Math.round(P.bn != null ? P.bn : 10) > 0)) return 'Aucun boulet à tirer.';
      return null;
    }
    function preconditions(st) {
      if (!st || !PRE[st.a]) return 'Action inconnue.';
      if ((st.f === 'A' || st.f === 'B') && pend[st.f] && st.a !== 'tourner') {
        /* rotation demandée en temps masqué : l'état logique est déjà tourné, le contrôle se fait sur lui */
      }
      return PRE[st.a](st);
    }
    /* une pierre seule (ou deux) prise à plat */
    function prePierre(st) {
      var f = st.f, x = stoneById(st.s), two = st.mode === 'deux';
      if (!x) return { why: 'Pierre inconnue.' };
      if (isClaimed(x)) return { why: 'La pierre ' + x.id + ' n\'est plus là (prise par l\'adversaire).' };
      if (x.cur.k === 'held') return { why: 'La pierre ' + x.id + ' est déjà tenue.' };
      var g = stoneFoot(x);
      if (g.vertical) return { why: 'La pierre ' + x.id + ' est debout : la pince ne prend des pierres seules qu\'à plat.' };
      var on = covered(x); if (on) return { why: 'La pierre ' + x.id + ' n\'est pas sur le dessus (' + on + ' est posé dessus) : seule celle du dessus peut être prise.' };
      var picked = [x], y = null, gl = g;
      if (two) {
        var fc = stackCenter([x]);
        var under = freeStones().filter(function (o) { if (o === x) return false; var go = stoneFoot(o); return Math.abs(go.top - g.bottom) < 1 && overlap(g.foot, go.foot, 1); });
        if (!under.length) return { why: 'Prendre deux pierres : rien n\'est empilé sous ' + x.id + '.' };
        if (under.length > 1) return { why: 'Prendre deux pierres : ' + x.id + ' repose sur plusieurs pierres (' + under.map(function (o) { return o.id; }).join(', ') + ').' };
        y = under[0]; var gy = stoneFoot(y), yc = stackCenter([y]), da = Math.abs(((yc.tan - fc.tan) % 180 + 180) % 180);
        if (gy.vertical || dist(yc.c, fc.c) > 10 || Math.min(da, 180 - da) > 3) return { why: 'Prendre deux pierres : ' + x.id + ' et ' + y.id + ' ne sont pas empilées à plat et alignées, la pince ne peut pas les tenir ensemble.' };
        picked = [y, x]; gl = gy;
      }
      /* ventouse de la pierre la plus basse prise ; à deux, la pierre du dessus prend la ventouse suivante */
      var lmax = two ? 1 : 2, slots = st.v && st.v !== 'auto' ? [+st.v - 1] : [0, 1, 2].filter(function (l) { return l <= lmax; }), best = null;
      if (slots[0] > lmax) return { why: 'Prendre deux pierres : la pierre du bas prend la ventouse 1 ou 2 (la 3 ne laisse pas de place à celle du dessus).' };
      slots.forEach(function (l) { var hc = gl.bottom + 55 - G.stoneZc(l); if (zOk(hc) && (!best || Math.abs(hc - 165) < Math.abs(best.hc - 165))) best = { l: l, hc: hc }; });
      var what = two ? y.id + ' et ' + x.id : x.id;
      if (!best) { var l0 = slots[0]; return { why: 'Prise de ' + what + ' avec la ventouse ' + (l0 + 1) + ' : ' + zMsg(gl.bottom + 55 - G.stoneZc(l0)) + '.' }; }
      return { why: null, x: x, picked: picked, best: best, what: what, two: two };
    }

    /* prise de la pierre du dessus seule, ou des deux du dessus (st.mode 'deux'), posées à plat */
    function prendrePierre(st) {
      var f = st.f, q = prePierre(st); if (q.why) return err(q.why);
      var x = q.x, picked = q.picked, best = q.best, what = q.what, two = q.two;
      var sc = stackCenter([x]), cands = [];
      [sc.tan + 90, sc.tan - 90].forEach(function (phi) { var n = nv2(phi); cands.push({ O: [sc.c[0] - D_P * n[0], sc.c[1] - D_P * n[1]], h: phi - 120 * fk(f), phi: phi }); });
      var b = choose(cands, picked, 80, true); if (!b) return err('Aucune position de prise.');
      if (b.col) err('Prise de ' + what + ' : contact possible avec ' + b.col + '.');
      var seq = [{ rot: 0, label: 'Pince ' + f + ' à plat' }, { hc: best.hc, label: 'Ventouse ' + (best.l + 1) + ' à la hauteur de ' + picked[0].id }];
      takeAt(f, b, 'Face ' + f + ' vers ' + (two ? 'les pierres ' : 'la pierre ') + what, picked, seq, st.tm, best.hc, what, function () {
        held[f] = { stack: [null, null, null] }; var v = [0, 0, 0];
        picked.forEach(function (o, i) { o.sl = best.l + i; o.cur = { k: 'held', f: f, l: o.sl }; o.tl.push({ t: s.t, k: 'held', f: f, l: o.sl }); o.tag = null; held[f].stack[o.sl] = o; v[o.sl] = 1; });
        vac(f, v, 'Vide ventouse' + (two ? 's ' + (best.l + 1) + ' et ' + (best.l + 2) : ' ' + (best.l + 1)) + ' sur ' + what, TV);
      });
    }
    /* ---- placement des constructions (mur, tour, porte) : parfait (centré), au plus proche, manuel ----
       La pierre compte dès que sa projection verticale touche la zone (E.1) ; « au plus proche » exige un chevauchement minimal. */
    var OVL = P.ovl != null ? P.ovl : 8;
    function consFeet(kind, C, phi) {
      var t = lv(phi);
      if (kind === 'mur') return [rectPoly({ cx: C[0], cy: C[1], hl: 160, hn: 55, ang: phi })];
      if (kind === 'tour') return [rectPoly({ cx: C[0], cy: C[1], hl: 55, hn: 55, ang: phi })];
      return [-55, 55].map(function (u) { return rectPoly({ cx: C[0] + u * t[0], cy: C[1] + u * t[1], hl: 55, hn: 55, ang: phi }); });
    }
    /* toutes les pierres au sol de la construction touchent la zone (chevauchement > tol) */
    function consTouch(kind, z, C, phi, tol) {
      return consFeet(kind, C, phi).every(function (ft) { return z.tan !== undefined ? overlap(ft, zoneRect(z), tol) : ptPolyD(z.c, ft) <= ZTR - Math.max(tol, 0) && (tol > 0 || ptPolyD(z.c, ft) < ZTR); });
    }
    /* positions candidates { C : centre de la construction, phi : normale de la face du robot } selon le mode */
    function placeCands(st, z, kind, poseOf) {
      var out = [];
      if (st.pm === 'manuel') {
        var a = +st.ang || 0, C = [+st.x || 0, +st.y || 0];
        (kind === 'tour' ? [a - 90, a + 90, a, a + 180] : [a - 90, a + 90]).forEach(function (phi, i) { out.push({ C: C, phi: phi, pen: i * 5 }); });
        return out;
      }
      /* au plus proche : grille autour de la zone, toutes orientations ; tri par temps de trajet estimé depuis le robot */
      var R0 = z.tan !== undefined ? 380 : 190, step = 20, dphi = kind === 'tour' ? 10 : 15;
      for (var dx = -R0; dx <= R0; dx += step) for (var dy = -R0; dy <= R0; dy += step) {
        var C2 = [z.c[0] + dx, z.c[1] + dy];
        for (var phi2 = 0; phi2 < 360; phi2 += dphi) {
          if (!consTouch(kind, z, C2, phi2, OVL)) continue;
          var o = poseOf(C2, phi2), est = dist([s.x, s.y], o.O) / V + Math.abs(angd(s.h, o.h)) / WR;
          out.push({ C: C2, phi: phi2, est: est });
        }
      }
      out.sort(function (a, b) { return a.est - b.est; });
      return out.slice(0, 60).map(function (c, i) { c.pen = i * 0.05; return c; });
    }
    /* avertissement en mode manuel : hors zone (pas de points) ou chevauchement faible */
    function consCheck(st, z, kind, C, phi, what) {
      if (st.pm !== 'manuel') return;
      if (!consTouch(kind, z, C, phi, 0)) err(what + ' hors de la zone ' + z.id + ' : la construction ne rapporte pas de points.');
      else if (!consTouch(kind, z, C, phi, OVL)) err(what + ' : chevauchement avec ' + z.id + ' inférieur à ' + OVL + ' mm (risqué sur le vrai robot).');
    }
    /* empreintes d'un dépôt dans le repère du point visé (u : angle demandé, v : u + 90°), pour la prévisualisation */
    function ghostFeet(pose, f, list, T, ang) {
      var u = nv(ang), w = lv(ang);
      return list.map(function (x) { var g = geomHeld(pose, f, x.sl), dx = g.fo.cx - T[0], dy = g.fo.cy - T[1]; return { u: dx * u[0] + dy * u[1], v: dx * w[0] + dy * w[1], zc: g.zc, vertical: g.vertical }; });
    }
    /* la rotation de la pince f de a0 à a1 (profil coordonné) est-elle sans contact à la pose p ? */
    function sweepFree(p, f, a0, h0, a1) {
      var ch = heldInCastle(p, f, [a0, a1]), rp = rotPath(maskOf(f), ch, a0, h0, a1);
      if (!rp.ok) return false;
      var g0 = { hc: h0, rot: a0 }, q = { x: p.x, y: p.y, h: p.h, A: cp(s.A), B: cp(s.B), C: cpC(s.C) };
      for (var i = 0; i < rp.keys.length; i++) {
        var g1 = rp.keys[i], n = Math.max(1, Math.ceil(Math.abs(g1.rot - g0.rot) / 15));
        for (var k = 1; k <= n; k++) { var u = k / n; q[f] = { hc: g0.hc + (g1.hc - g0.hc) * u, rot: g0.rot + (g1.rot - g0.rot) * u, vac: s[f].vac }; if (collides(q)) return false; }
        g0 = g1;
      }
      return true;
    }

    /* ---- canon : vol d'une balle en mousse (traînée quadratique, rebonds amortis, roulement) ---- */
    var BR = RG.assaut.boulet_diametre / 2000;
    function flight(o, az, el, v0) {
      var g = 9.81, m = (P.bm > 0 ? P.bm : 2) / 1000, k = 0.5 * 1.2 * (P.bcd > 0 ? P.bcd : 0.47) * Math.PI * BR * BR / m;
      var E = P.be != null ? P.be : 0.5, MU = P.bmu != null ? P.bmu : 0.3, CR = P.bcr != null ? P.bcr : 0.05, dt = 0.001;
      var x = o[0] / 1000, y = o[1] / 1000, z = o[2] / 1000, a = az * D2R, e = el * D2R, bh = BORDURE / 1000, be = RG.table.bordure_epaisseur / 1000;
      var vx = v0 * Math.cos(e) * Math.cos(a), vy = v0 * Math.cos(e) * Math.sin(a), vz = v0 * Math.sin(e);
      var t = 0, pts = [[0, o[0], o[1], o[2]]], next = 0.02, roll = false, out = false, nb = 0, imp = null;
      while (t < 20) {
        if (!roll) { var v = Math.hypot(vx, vy, vz); vx -= k * v * vx * dt; vy -= k * v * vy * dt; vz -= (g + k * v * vz) * dt; }
        else { var vh = Math.hypot(vx, vy), dec = CR * g * dt; if (vh <= dec) { vx = 0; vy = 0; } else { vx -= dec * vx / vh; vy -= dec * vy / vh; } }
        x += vx * dt; y += vy * dt; z += vz * dt; t += dt;
        /* sol : rebond (mousse) puis roulement quand le rebond devient trop faible */
        if (!roll && z <= BR) { z = BR; if (!imp) imp = [x * 1000, y * 1000]; if (Math.abs(vz) < 0.3) { roll = true; vz = 0; } else { vz = -E * vz; vx *= 1 - MU; vy *= 1 - MU; nb++; } }
        /* bordures de 70 mm : rebond si la balle les touche, sortie de table si elle passe au-dessus */
        if (x < BR || x > 3 - BR) { if (z < bh + BR) { x = x < BR ? BR : 3 - BR; vx = -E * vx; } else if (x < -be - BR || x > 3 + be + BR) { out = true; break; } }
        if (y < BR || y > 2 - BR) { if (z < bh + BR) { y = y < BR ? BR : 2 - BR; vy = -E * vy; } else if (y < -be - BR || y > 2 + be + BR) { out = true; break; } }
        if (t >= next - 1e-9) { pts.push([t, x * 1000, y * 1000, z * 1000]); next += 0.02; }
        if (roll && !vx && !vy) break;
      }
      pts.push([t, x * 1000, y * 1000, z * 1000]);
      return { pts: pts, rest: [x * 1000, y * 1000], imp: imp || [x * 1000, y * 1000], tStop: t, out: out, bounces: nb };
    }
    /* boulet dans la cour adverse : tout ou partie de sa projection verticale (E.4) */
    function inCour(c) { var Z = P.team === 'blue' ? COUR : COUR_B; return inPoly(c[0], c[1], Z) || ptPolyD(c, Z) <= BR * 1000; }
    /* tir : les paramètres sont dans le repère de l'équipe (jaune) ; l'équipe bleue tire en miroir vers -x */
    function mir(x) { return P.team === 'blue' ? 3000 - x : x; }
    function flyTrue(o, az, el, v) {
      if (P.team !== 'blue') return flight(o, az, el, v);
      var f = flight([3000 - o[0], o[1], o[2]], az, el, v);
      f.pts = f.pts.map(function (q) { return [q[0], 3000 - q[1], q[2], q[3]]; }); f.rest = [3000 - f.rest[0], f.rest[1]]; f.imp = [3000 - f.imp[0], f.imp[1]];
      return f;
    }
    /* tirage reproductible, différent à chaque tir */
    function rnd(i, j) { var x = Math.sin((i + 1) * 12.9898 + (j + 1) * 78.233 + (P.bseed || 1) * 37.719) * 43758.5453; return 2 * (x - Math.floor(x)) - 1; }
    /* projection verticale complète du robot dans un rectangle (salle du trône) */
    function footIn(p, R) { var xs = R.map(function (q) { return q[0]; }), ys = R.map(function (q) { return q[1]; }), x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys); return G.robotFootprint(p).every(function (v) { return v[0] >= x0 - 0.5 && v[0] <= x1 + 0.5 && v[1] >= y0 - 0.5 && v[1] <= y1 + 0.5; }); }
    /* mouvement des mécanismes de la face C sur place (canon, fourche) : contact vérifié dans l'état final */
    function moveC(c, d, label) {
      var p = poseNow(); Object.keys(c).forEach(function (k) { p.C[k] = c[k]; });
      var col = collides(p); if (col) err(label + ' : contact avec ' + col + '.');
      Object.keys(c).forEach(function (k) { s.C[k] = c[k]; }); adv(d, label);
    }
    function seanceTir() {
      var why = preTir(); if (why) return err(why);
      var h = P.team === 'blue' ? 300 : 120;  /* face C (h + 240) vers le camp adverse */
      if (P.tirDepuisTrone !== false) travel([mir(P.tx != null ? P.tx : 250), P.ty != null ? P.ty : 1000], h, 'Vers la position de tir : face C vers le camp adverse');
      else travel([s.x, s.y], h, 'Rotation sur place : face C vers le camp adverse');
      /* sortie du canon (90 mm en 1 s) et mise en route des volants, puis attente de la phase d'attaque */
      balls.tDeploy = s.t;
      moveC({ can: GE.canon.course }, P.bdep > 0 ? P.bdep : 0.1, 'Sortie du canon (' + GE.canon.course + ' mm)');
      if (P.bspin > 0) adv(P.bspin, 'Mise en route du canon');
      if (s.t < T_ATTAQUE) adv(T_ATTAQUE - s.t, 'Attente du début de la phase d\'attaque (' + T_ATTAQUE + ' s)');
      var p = poseNow();
      if (P.tirDepuisTrone !== false && !footIn(p, throneOf(P.team))) err('Position de tir : le robot et son canon doivent être entièrement dans la salle du trône (paramètre tirDepuisTrone).');
      var rate = P.brate > 0 ? P.brate : 2, el = P.bel != null ? P.bel : GE.canon.el;
      var N = Math.max(0, Math.min(Math.round(P.bn != null ? P.bn : 10), Math.floor((MATCH - s.t) * rate + 1e-9) + 1));
      if (!N) return err('Tir impossible : la phase d\'attaque est finie (' + MATCH + ' s).');
      var n = nv(h + 240), t = lv(h + 240), mz = [p.x + (FACE + GE.canon.horsFace) * n[0] + GE.canon.y * t[0], p.y + (FACE + GE.canon.horsFace) * n[1] + GE.canon.y * t[1], P.bh != null ? P.bh : GE.canon.hauteur];
      /* vitesse de sortie : celle qui amène la balle (sans dispersion) au point visé, par dichotomie.
         Point visé = point d'arrêt (bmode 'arret') ou premier impact au sol ('impact'). */
      var tgt = P.btx != null ? P.btx : 2625, imp = P.bmode === 'impact', lo = 0.5, hi = 25, f0 = null, mzo = [mir(mz[0]), mz[1], mz[2]];  /* visée dans le repère de l'équipe */
      function reach(fl) { return imp ? fl.imp[0] : fl.rest[0]; }
      for (var it = 0; it < 40; it++) { var mid = (lo + hi) / 2, fm = flight(mzo, 0, el, mid); if ((fm.out && !imp) || reach(fm) > tgt) hi = mid; else lo = mid; }
      var v0 = (lo + hi) / 2; f0 = flight(mzo, 0, el, v0);
      if ((f0.out && !imp) || Math.abs(reach(f0) - tgt) > 50) err('Canon : le point visé x = ' + Math.round(tgt) + ' mm n\'est pas atteignable avec une élévation de ' + el + '° (' + (imp ? 'impact' : 'arrêt') + ' le plus proche à x = ' + Math.round(reach(f0)) + ' mm).');
      balls.shots = []; balls.t0 = s.t; balls.v0 = v0; balls.n = N; balls.muzzle = mz;
      for (var i = 0; i < N; i++) {
        var vi = v0 * (1 + (P.bdv != null ? P.bdv : 5) / 100 * rnd(i, 0)), az = (P.bdaz != null ? P.bdaz : 2) * rnd(i, 1), ei = el + (P.bdel != null ? P.bdel : 2) * rnd(i, 2);
        var fl = flyTrue(mz, az, ei, vi); fl.t = s.t + i / rate; fl.v0 = vi; fl.az = az; fl.el = ei; fl.cour = !fl.out && inCour(fl.rest);
        balls.shots.push(fl);
      }
      var nIn = balls.shots.filter(function (x) { return x.cour; }).length;
      adv(Math.max(0.1, (N - 1) / rate + 0.1), N + ' boulets tirés (' + String(rate).replace('.', ',') + ' par seconde, vitesse de sortie ' + v0.toFixed(2).replace('.', ',') + ' m/s) : ' + nIn + ' arrêtés dans la cour adverse');
    }
    /* ---- Graal : montée sur le toit par l'ascenseur de la face C (contrat §2) ---- */
    function monterGraal() {
      var why = PRE.monterGraal(); if (why) return err(why);
      var Gc = [P.gx, P.gy], cands = [], low = { can: s.C.can, fx: FO.fxSortie, fz: FO.fzBas };
      /* la face C regarde le Graal perpendiculairement à ses anses (2 sens possibles) ; centre du Graal à (155,3 ; 57) dans le repère de la face C */
      [0, 180].forEach(function (k) {
        var phi = P.ga + k, n = nv(phi), t = lv(phi), O = [Gc[0] - GR.xPrise * n[0] - GR.y * t[0], Gc[1] - GR.xPrise * n[1] - GR.y * t[1]];
        cands.push({ O: O, h: phi - 240, phi: phi, setC: low, pen: inPoly(O[0], O[1], OWN_CASTLE) ? 0 : 1e6 });
      });
      var exG = [{ id: 'graal' }], b = choose(cands, exG, 80, true);
      if (b.col) return err('Monter le Graal : pas de position de prise (' + b.col + ').');
      var c = b.c, n = nv(c.phi), Ob = c.Ob || [c.O[0] - 80 * n[0], c.O[1] - 80 * n[1]];
      /* sortie puis descente de la fourche en temps masqué : le trajet est calculé avec la fourche basse */
      var C0 = cpC(s.C), k0 = K.length, t0 = s.t, tS = P.tSortieFourche, tD = P.tDescenteFourche;
      s.C.fx = low.fx; s.C.fz = low.fz;
      travel(Ob, c.h, 'Face C vers le Graal · fourche sortie et descendue en temps masqué');
      function fAt(tt) { var u = tt - t0; return u <= 0 ? C0 : u < tS ? { can: C0.can, fx: C0.fx + (low.fx - C0.fx) * u / tS, fz: C0.fz } : u < tS + tD ? { can: C0.can, fx: low.fx, fz: C0.fz + (low.fz - C0.fz) * (u - tS) / tD } : { can: C0.can, fx: low.fx, fz: low.fz }; }
      for (var i = k0; i < K.length; i++) K[i].C = fAt(K[i].t);
      if (s.t < t0 + tS) { s.C = fAt(s.t); s.C.fx = C0.fx; adv(t0 + tS - s.t, 'Sortie de la fourche'); }
      s.C = { can: C0.can, fx: low.fx, fz: low.fz };
      if (s.t < t0 + tS + tD) { K[K.length - 1].C = fAt(K[K.length - 1].t); adv(t0 + tS + tD - s.t, 'Descente de la fourche'); }
      if (graal.cur.k !== 'home') return err('Le Graal n\'est plus à son départ.');
      lin(c.O, c.h, VA, 'Dents de la fourche sous les anses du Graal', exG);
      graal.cur = { k: 'ascenseur' }; graal.tl.push({ t: s.t, k: 'ascenseur' });
      moveC({ fz: FO.fzHaut }, P.tMonteeGraal, 'Montée du Graal (' + String(P.tMonteeGraal).replace('.', ',') + ' s)');
      moveC({ fx: FO.fxRentree }, P.tTransfertGraal, 'Transfert du Graal au-dessus du toit (' + Math.round(FO.fxSortie - FO.fxRentree) + ' mm)');
      moveC({ fz: FO.fzHaut - FO.cao.margeToit }, P.tPoseGraal, 'Graal posé sur le toit');
      graal.cur = { k: 'toit' }; graal.tl.push({ t: s.t, k: 'toit' });
      moveC({ fx: FO.fxSortie }, P.tDegagementGraal, 'Dégagement de la fourche : Graal libre de tout actionneur');
    }
    /* confinement du Graal (E.2.b) : s'il sort du château (remparts compris), il est retiré de la table */
    function graalConfine(t0, t1) {
      var g = graal.cur; if (g.k !== 'toit' && g.k !== 'ascenseur') return;
      var tl0 = Math.max(t0, graal.tl[graal.tl.length - 1].t);
      for (var tt = tl0; tt <= t1 + 1e-9; tt += 0.05) {
        var p = poseAtK(K, Math.min(tt, t1)), q = graalOnRobot(p, g.k);
        if (!graalPoly(q.c, q.ang).every(function (v) { return inPolyB(v[0], v[1], OWN_CASTLE); })) {
          graal.cur = { k: 'retire' }; graal.tl.push({ t: Math.min(tt, t1), k: 'retire' });
          err('Graal sorti du château à ' + String(Math.round(Math.min(tt, t1) * 10) / 10).replace('.', ',') + ' s : retiré de la table (E.2.b), 0 point de Graal.');
          return;
        }
      }
    }

    var steps = {
      prendre: function (st) {
        var why = PRE.prendre(st); if (why) return err(why);
        var f = st.f;
        if (st.mode === 'pierre' || st.mode === 'deux') return prendrePierre(st);
        var idx = -1; PK.forEach(function (pk, i) { if (pk.id === st.p) idx = i; });
        var sts = stackStones(idx), hc = stoneFoot(sts[0]).bottom + 165;
        var sc = stackCenter(sts), cands = [];
        [sc.tan + 90, sc.tan - 90].forEach(function (phi) { var n = nv2(phi); cands.push({ O: [sc.c[0] - D_P * n[0], sc.c[1] - D_P * n[1]], h: phi - 120 * fk(f), phi: phi }); });
        var b = choose(cands, sts, 80, true); if (!b) return err('Aucune position de prise.');
        if (b.col) err('Prise de ' + st.p + ' : contact possible avec ' + b.col + '.');
        var seq = [{ rot: 0, label: 'Pince ' + f + ' à plat' }, { hc: hc, label: 'Pince ' + f + ' à la hauteur de la pile' }];
        takeAt(f, b, 'Face ' + f + ' vers le paquet ' + st.p, sts, seq, st.tm, hc, st.p, function () {
          sts.forEach(function (x) { x.sl = x.l; x.cur = { k: 'held', f: f, l: x.sl }; x.tl.push({ t: s.t, k: 'held', f: f, l: x.sl }); x.tag = null; });
          held[f] = { stack: [sts[0], sts[1], sts[2]] };
          vac(f, [1, 1, 1], 'Vide face ' + f + ' sur ' + st.p, TV);
        });
      },
      deposer: function (st) {
        var f = st.f, info = stepInfo[stepNo - 1], T = [+st.x || 0, +st.y || 0], ang = +st.ang || 0;
        /* angle de pince : 0° à plat, 90° debout, 180° à plat retourné (ancien champ o : plat / debout) */
        var rot = st.r != null ? +st.r : (st.o === 'debout' ? 90 : 0), deb = rot === 90, cs = Math.cos(rot * D2R);
        var hs = heldStonesOf(f), dep = st.q === 'pile' ? hs : hs.filter(function (x) { return x.id === st.q; });
        /* prévisualisation par défaut, tant que la position du robot n'est pas trouvée */
        var nG = Math.max(1, dep.length);
        info.ghost = { feet: [] };
        for (var gi = 0; gi < nG; gi++) info.ghost.feet.push(deb ? { u: (gi - (nG - 1) / 2) * 110, v: 0, zc: 160, vertical: true } : { u: 0, v: 0, zc: 55 + 110 * gi, vertical: false });
        var why = PRE.deposer(st); if (why) return err(why);
        /* à plat, la pierre la plus basse est celle de la plus petite ventouse à 0°, de la plus grande à 180° */
        function low(list) { var sl = list.map(function (x) { return x.sl; }); return cs > 0 ? Math.min.apply(null, sl) : Math.max.apply(null, sl); }
        var lLow = low(dep), cands = [], whyC = null;
        [ang - 90, ang + 90].forEach(function (phi, si) {
          var h = phi - 120 * fk(f), p = { x: 0, y: 0, h: h, A: cp(s.A), B: cp(s.B) }; p[f].rot = rot; p[f].hc = 165;
          var cx = 0, cy = 0; dep.forEach(function (x) { var fo = heldFoot(p, fk(f), x.sl); cx += fo.cx / dep.length; cy += fo.cy / dep.length; });
          p.x = T[0] - cx; p.y = T[1] - cy;
          var feet = dep.map(function (x) { return geomHeld(p, f, x.sl).foot; }), sup = [];
          feet.forEach(function (ft) { var m = 0; freeStones().forEach(function (o) { var g = stoneFoot(o); if (overlap(ft, g.foot, 1)) m = Math.max(m, g.top); }); sup.push(m); });
          var top = Math.max.apply(null, sup);
          if (deb && sup.some(function (m) { return m < top - 1; })) { whyC = whyC || 'une pierre debout serait en porte-à-faux (appuis de hauteurs différentes)'; return; }
          /* hc : hauteur de pince qui pose les pierres sur leur appui ; hcR : hauteur où la pince lâche (plus haut si elle ne descend pas assez) */
          var hc = deb ? top + 160 : top + 55 - G.stoneZc(lLow) * cs, hcR = hc;
          if (hc > HC_MAX + 0.5) { whyC = whyC || zMsg(hc) + (top ? ' (appui à ' + Math.round(top) + ' mm)' : ' (posée au sol)'); return; }
          if (hc < HC_MIN - 0.5) {
            if (!st.drop) { whyC = whyC || zMsg(hc) + (top ? ' (appui à ' + Math.round(top) + ' mm)' : ' (posée au sol)') + ' ; coche « Lâcher » pour la laisser tomber'; return; }
            hcR = HC_MIN;
          }
          var gg = graalGeo(), gHit = false;
          if (gg) dep.forEach(function (x) { var p2 = { x: p.x, y: p.y, h: h, A: cp(s.A), B: cp(s.B) }; p2[f].rot = rot; p2[f].hc = hc; var g = geomHeld(p2, f, x.sl); if (overlap(g.foot, gg.foot, 1) && g.bottom < gg.top - 1 && g.top > gg.bottom + 1) gHit = true; });
          var c = { O: [p.x, p.y], h: h, phi: phi, rot: rot, hc: hc, hcR: hcR, pen: si * 5 + (gHit ? 1e6 : 0), gHit: gHit };
          var o = { hc: hcR, rot: rot }; if (f === 'A') c.setA = o; else c.setB = o;
          /* approche et recul avec la pince 15 mm au-dessus de la hauteur où elle lâche */
          c.backCheck = function (pb) { pb[f].hc = Math.min(hcR + 15, HC_MAX); pb[f].rot = rot; return collides(pb); };
          cands.push(c);
        });
        if (!cands.length) return err('Dépôt en ' + Math.round(T[0]) + ', ' + Math.round(T[1]) + ' impossible : ' + whyC + '.');
        var b = choose(cands, null, 85, true), c = b.c;
        var pT = { x: c.O[0], y: c.O[1], h: c.h, A: cp(s.A), B: cp(s.B) }; pT[f].hc = c.hc; pT[f].rot = c.rot;
        info.ghost = { feet: ghostFeet(pT, f, dep, T, ang) };
        if (c.gHit) err('Dépôt : contact avec le Graal.');
        if (b.col) err('Dépôt en ' + Math.round(T[0]) + ', ' + Math.round(T[1]) + ' : contact possible avec ' + b.col + '.');
        var n = nv2(c.phi), Ob = c.Ob || [c.O[0] - 85 * n[0], c.O[1] - 85 * n[1]], hA = Math.min(c.hcR + 15, HC_MAX), seq = [];
        if (Math.abs(s[f].rot - c.rot) > 0.5) seq.push({ rot: c.rot, label: 'Pince ' + f + ' tournée à ' + c.rot + '°' });
        seq.push({ hc: hA, label: 'Pince ' + f + ' au-dessus du point de dépôt' });
        var what = st.q === 'pile' ? (dep.length > 1 ? 'la pile' : dep[0].id) : st.q, pose = deb ? 'debout' : rot === 180 ? 'à plat (retournée)' : 'à plat';
        moveTo(Ob, c.h, 'Face ' + f + ' vers le dépôt (' + Math.round(T[0]) + ', ' + Math.round(T[1]) + ', ' + Math.round(ang) + '°)', null, f, seq, st.tm, true);
        lin(c.O, c.h, VA, 'Approche du point de dépôt');
        var fall = c.hc < c.hcR - 0.5 ? c.hcR - c.hc : 0;
        zz(f, c.hcR, fall ? 'Descente au plus bas (' + Math.round(c.hcR) + ' mm)' : 'Descente : ' + what + ' posée ' + pose);
        var tag = 'd' + s.t.toFixed(3) + f, v = s[f].vac.slice(), land = null;
        if (fall) { land = poseNow(); land[f].hc = c.hc; }
        dep.forEach(function (x) { release(x, f, land); x.tag = tag; held[f].stack[x.sl] = null; v[x.sl] = 0; });
        if (!heldStonesOf(f).length) held[f] = null;
        vac(f, v, (fall ? 'Lâcher : ' + what + ' tombe de ' + Math.round(fall) + ' mm, ' : 'Vide coupé : ' + what + ' ') + pose + ' en ' + Math.round(T[0]) + ', ' + Math.round(T[1]), TL);
        zz(f, hA, 'Levée de 15 mm');
        lin(Ob, c.h, VA, 'Recul');
      },
      mur: function (st) {
        var why = PRE.mur(st); if (why) return err(why);
        var f = st.f, z = zoneById(st.z), hs = heldStonesOf(f), cands = [];
        function wallPose(C, phi) { var n = nv2(phi); return { O: [C[0] - D_P * n[0], C[1] - D_P * n[1]], h: phi - 120 * fk(f) }; }
        if (st.pm === 'manuel' || st.pm === 'proche') placeCands(st, z, 'mur', wallPose).forEach(function (pc) { var o = wallPose(pc.C, pc.phi); cands.push({ O: o.O, h: o.h, phi: pc.phi, pen: pc.pen, C: pc.C, setF: { hc: 165 } }); });
        else {
          var sides = st.side === 'ext' ? [z.nin] : st.side === 'int' ? [z.nin + 180] : [z.nin, z.nin + 180];
          sides.forEach(function (phi, si) {
            var n = nv2(phi), t = lv(phi);
            [0, 10, -10, 20, -20, 30, -30, 40, -40].forEach(function (sl) { [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, -5, -10, -15, -20, -25, -30, -35, -40, -45].forEach(function (ac) {
              var C = [z.c[0] + sl * t[0] + ac * n[0], z.c[1] + sl * t[1] + ac * n[1]];
              cands.push({ O: [C[0] - D_P * n[0], C[1] - D_P * n[1]], h: phi - 120 * fk(f), phi: phi, pen: (Math.abs(sl) + Math.abs(ac)) * 4 + si * 50, C: C, setF: { hc: 165 } });
            }); });
          });
        }
        if (!cands.length) return err('Mur ' + z.id + ' : aucune position ne chevauche la zone de ' + OVL + ' mm.');
        cands.forEach(function (c) { if (f === 'A') c.setA = c.setF; else c.setB = c.setF; });
        var b = choose(cands, null, 85); if (b.col) err('Pose sur ' + z.id + ' : contact possible avec ' + b.col + '.');
        consCheck(st, z, 'mur', b.c.C, b.c.phi, 'Mur');
        stepInfo[stepNo - 1].ghost = { T: b.c.C, ang: b.c.phi + 90, feet: [55, 165, 275].map(function (zc) { return { u: 0, v: 0, zc: zc, vertical: false }; }) };
        var n = nv2(b.c.phi), Ob = b.c.Ob || [b.c.O[0] - 85 * n[0], b.c.O[1] - 85 * n[1]];
        travel(Ob, b.c.h, 'Face ' + f + ' vers ' + z.id + ' (' + z.name + ')');
        lin(b.c.O, b.c.h, VA, 'Approche de ' + z.id);
        zz(f, 165, 'Descente : pile posée');
        var tag = 'w' + s.t.toFixed(3) + f; hs.forEach(function (x) { release(x, f); x.tag = tag; });
        held[f] = null; vac(f, [0, 0, 0], 'Vide coupé : mur posé sur ' + z.id, TL);
        lin(Ob, b.c.h, VA, 'Recul');
      },
      tour: function (st) {
        var why = PRE.tour(st); if (why) return err(why);
        var f = st.f, z = zoneById(st.z), hs = heldStonesOf(f);
        var target = hs.filter(function (x) { return x.id === st.s; })[0];
        var pre = Math.abs(s[f].rot - 90) > 1 ? [{ rot: 90, label: 'Rotation de 90° : pierres debout' }, { hc: 175, label: 'Pierres à 15 mm du sol' }] : [];
        if (!st.tm) { runSeq(f, pre); pre = []; }
        /* en temps masqué, la position est choisie avec la pince déjà tournée */
        var g0 = cp(s[f]); if (pre.length) { s[f].hc = 175; s[f].rot = 90; }
        var best = null, zl = G.stoneZc(target.sl);
        function towerPose(Pt, phi) { var n = nv2(phi), t = lv(phi); return { O: [Pt[0] - D_P * n[0] - zl * t[0], Pt[1] - D_P * n[1] - zl * t[1]], h: phi - 120 * fk(f) }; }
        if (st.pm === 'manuel' || st.pm === 'proche') {
          var tc = placeCands(st, z, 'tour', towerPose).map(function (pc) { var o = towerPose(pc.C, pc.phi), q = { O: o.O, h: o.h, phi: pc.phi, pen: pc.pen, Pt: pc.C }; q.setA = f === 'A' ? { hc: 160 } : undefined; q.setB = f === 'B' ? { hc: 160 } : undefined; return q; });
          if (!tc.length) { s[f].hc = g0.hc; s[f].rot = g0.rot; return err('Tour ' + z.id + ' : aucune position ne chevauche la zone de ' + OVL + ' mm.'); }
          best = choose(tc, null, 80, true);
        }
        for (var off = 0; off <= 140 && !(best && !best.col) && st.pm !== 'manuel' && st.pm !== 'proche'; off += 10) {
          var cands = [];
          for (var phi = 0; phi < 360; phi += 10) for (var da = 0; da < 360; da += (off ? 30 : 360)) {
            var d = nv2(da), Pt = [z.c[0] + off * d[0], z.c[1] + off * d[1]], o2 = towerPose(Pt, phi);
            cands.push({ O: o2.O, h: o2.h, phi: phi, pen: off * 10, Pt: Pt });
          }
          cands.forEach(function (c) { var o = {}; o[f] = { hc: 160 }; if (f === 'A') c.setA = o.A; else c.setB = o.B; });
          var b = choose(cands, null, 80, true); if (b && (!best || (best.col && !b.col))) best = b;
        }
        consCheck(st, z, 'tour', best.c.Pt, best.c.phi, 'Tour');
        stepInfo[stepNo - 1].ghost = { T: best.c.Pt, ang: best.c.phi + 90, feet: [{ u: 0, v: 0, zc: 160, vertical: true }] };
        if (best.col) err('Tour ' + z.id + ' : contact possible avec ' + best.col + '.');
        else if (!st.pm || st.pm === 'parfait') if (dist(best.c.Pt, z.c) > 1) err('Tour ' + z.id + ' : pierre décalée de ' + Math.round(dist(best.c.Pt, z.c)) + ' mm du centre du cercle (place insuffisante).');
        var n = nv2(best.c.phi), Ob = [best.c.O[0] - 80 * n[0], best.c.O[1] - 80 * n[1]];
        s[f].hc = g0.hc; s[f].rot = g0.rot;
        moveTo(Ob, best.c.h, 'Face ' + f + ' vers la tour ' + z.id, null, f, pre, true, true);
        lin(best.c.O, best.c.h, VA, 'Au-dessus du cercle ' + z.id);
        zz(f, 160, 'Descente au sol');
        release(target, f); target.tag = 't'; held[f].stack[target.sl] = null;
        var v = s[f].vac.slice(); v[target.sl] = 0; vac(f, v, 'Pierre ' + target.id + ' lâchée : tour ' + z.id, TL);
        zz(f, 175, 'Levée de 15 mm');
        lin(Ob, best.c.h, VA, 'Recul');
        if (!heldStonesOf(f).length) { held[f] = null; rr(f, 0, 'Retour de la rotation'); zz(f, 165, 'Pince ' + f + ' en position basse'); }
      },
      /* porte (contrat §2) : pile tournée de 90° dans le château, piliers 1 et 2 posés debout, retour à 0° avec la pierre 3,
         linteau monté (dessous à 325 mm, axe à 270 mm) puis posé. Le linteau est toujours la pierre de la rangée 3. */
      porte: function (st) {
        var why = PRE.porte(st); if (why) return err(why);
        var f = st.f, z = zoneById(st.z), hs = heldStonesOf(f);
        var sides = st.side === 'ext' ? [z.nin] : st.side === 'int' ? [z.nin + 180] : [z.nin, z.nin + 180], cands = [];
        function doorPose(C, phi) { var n = nv2(phi), t = lv(phi); return { O: [C[0] - D_P * n[0] + 55 * t[0], C[1] - D_P * n[1] + 55 * t[1]], h: phi - 120 * fk(f) }; }
        var pcs = st.pm === 'manuel' || st.pm === 'proche' ? placeCands(st, z, 'porte', doorPose) : sides.map(function (phi, si) { return { C: z.c, phi: phi, pen: si * 50 }; });
        if (!pcs.length) return err('Porte ' + z.id + ' : aucune position ne chevauche la zone de ' + OVL + ' mm.');
        /* la recherche du recul (rotation de la pile) est coûteuse : limitée aux 40 premières positions */
        pcs.slice(0, 40).forEach(function (pc) {
          var o = doorPose(pc.C, pc.phi);
          cands.push({ O: o.O, h: o.h, phi: pc.phi, pen: pc.pen, C: pc.C, check: function (p) { var g = p[f]; g.hc = 160; g.rot = 90; return collides(p); } });
        });
        cands.forEach(function (c) {
          var n0 = nv2(c.phi);
          for (var bd = 100; bd <= 300 && !c.Ob; bd += 50) {
            var pb0 = [c.O[0] - bd * n0[0], c.O[1] - bd * n0[1]], pb = { x: pb0[0], y: pb0[1], h: c.h, A: cp(s.A), B: cp(s.B) };
            if (heldInCastle(pb, f, [0, 90]) && sweepFree(pb, f, s[f].rot, s[f].hc, 90)) c.Ob = pb0;
          }
          if (!c.Ob) c.pen += 1e6;
        });
        var b = choose(cands); if (b.col) err('Porte ' + z.id + ' : contact possible avec ' + b.col + '.');
        if (!b.c.Ob) return err('Porte ' + z.id + ' : pas de place dans le château pour tourner la pile.');
        consCheck(st, z, 'porte', b.c.C, b.c.phi, 'Porte');
        stepInfo[stepNo - 1].ghost = { T: b.c.C, ang: b.c.phi + 90, feet: [{ u: -55, v: 0, zc: 160, vertical: true }, { u: 55, v: 0, zc: 160, vertical: true }, { u: 0, v: 0, zc: 380, vertical: false }] };
        var c = b.c, n = nv2(c.phi), O2 = [c.C[0] - D_P * n[0], c.C[1] - D_P * n[1]], Ob = c.Ob;
        moveTo(Ob, c.h, 'Face ' + f + ' vers ' + z.id + ' pour la porte', null, f, [], false, false);
        rr(f, 90, 'Rotation de 90° de la pile dans le château : pierres debout');
        zz(f, 175, 'Pierres à 15 mm du sol');
        lin(c.O, c.h, VA, 'Pierres au-dessus de ' + z.id);
        zz(f, 160, 'Descente au sol');
        [hs[0], hs[1]].forEach(function (x) { release(x, f); x.tag = 'p'; held[f].stack[x.sl] = null; });
        vac(f, [0, 0, 1], '2 piliers posés (rangées 1 et 2)', TL);
        zz(f, 175, 'Levée de 15 mm');
        /* recul jusqu'à pouvoir remettre la pierre 3 à plat sans toucher les piliers */
        var dR = null;
        for (var r = 60; r <= 300 && dR == null; r += 10) {
          var pr = { x: c.O[0] - r * n[0], y: c.O[1] - r * n[1], h: c.h, A: cp(s.A), B: cp(s.B) }, ok = true;
          for (var d0 = 10; d0 <= r && ok; d0 += 10) { var pl = { x: c.O[0] - d0 * n[0], y: c.O[1] - d0 * n[1], h: c.h, A: cp(s.A), B: cp(s.B) }; if (collides(pl)) ok = false; }
          if (ok && sweepFree(pr, f, 90, s[f].hc, 0)) dR = r;
        }
        if (dR == null) return err('Porte ' + z.id + ' : pas de place pour reculer et remettre le linteau à plat.');
        lin([c.O[0] - dR * n[0], c.O[1] - dR * n[1]], c.h, VA, 'Recul de ' + dR + ' mm pour remettre le linteau à plat');
        rr(f, 0, 'Linteau (pierre de la rangée 3) remis à plat');
        /* hauteur d'axe qui pose le dessous du linteau sur le haut des piliers */
        var pTop = Math.max(stoneFoot(hs[0]).top, stoneFoot(hs[1]).top), hL = pTop + 55 - G.stoneZc(hs[2].sl), gap = P.pgap != null ? P.pgap : 5;
        zz(f, hL + gap, 'Montée du linteau : dessous à ' + Math.round(pTop + gap) + ' mm');
        lin([O2[0] - dR * n[0], O2[1] - dR * n[1]], c.h, VA, 'Centrage du linteau');
        lin(O2, c.h, VA, 'Linteau au-dessus des piliers');
        zz(f, hL, 'Pose du linteau sur les piliers');
        release(hs[2], f); hs[2].tag = 'l'; held[f] = null;
        doors[inPoly(z.c[0], z.c[1], CASTLE) ? 'jaune' : 'bleu'] = z.id;
        vac(f, [0, 0, 0], 'Linteau posé : porte terminée sur ' + z.id, TL);
        lin([O2[0] - 100 * n[0], O2[1] - 100 * n[1]], c.h, VA, 'Recul'); zz(f, 165, 'Pince ' + f + ' en position basse');
      },
      tir: function () { seanceTir(); },
      boulets: function () { seanceTir(); },
      monterGraal: function () { monterGraal(); },
      /* trajectoire tracée point par point : suivie telle quelle (contacts signalés, pas corrigés).
         Angle facultatif à chaque point (orientation de la face choisie) ; entre deux angles, rotation répartie selon la distance. */
      traj: function (st) {
        flushPend();
        var why = PRE.traj(st); if (why) return err(why);
        var list = (st.pts || []).filter(function (q) { return q && isFinite(+q.x) && isFinite(+q.y); });
        var off = 120 * ({ A: 0, B: 1, C: 2 }[st.fa] || 0), P0 = [s.x, s.y], pts = [P0].concat(list.map(function (q) { return [+q.x, +q.y]; }));
        var dcum = [0]; for (var i = 1; i < pts.length; i++) dcum.push(dcum[i - 1] + dist(pts[i - 1], pts[i]));
        /* caps imposés (déroulés sans saut de plus de 180° d'un repère au suivant) */
        var anc = [{ i: 0, h: s.h }];
        list.forEach(function (q, k) { if (q.a !== null && q.a !== undefined && q.a !== '' && isFinite(+q.a)) { var prev = anc[anc.length - 1].h; anc.push({ i: k + 1, h: prev + angd(prev, +q.a - off) }); } });
        var hs = pts.map(function (p, i) {
          var a = null, b = null; anc.forEach(function (x) { if (x.i <= i) a = x; if (x.i >= i && !b) b = x; });
          if (!b || b === a) return a.h;
          var span = dcum[b.i] - dcum[a.i], u = span > 0 ? (dcum[i] - dcum[a.i]) / span : (i - a.i) / Math.max(1, b.i - a.i);
          return a.h + (b.h - a.h) * u;
        });
        var hit = null;
        for (var j = 1; j < pts.length; j++) {
          var A = pts[j - 1], B = pts[j], hA = hs[j - 1], hB = hs[j], L = dist(A, B);
          var n = Math.max(1, Math.ceil(Math.max(L / 10, Math.abs(hB - hA) / 1.5)));
          for (var k = 1; k <= n && !hit; k++) { var u = k / n, q = { x: A[0] + (B[0] - A[0]) * u, y: A[1] + (B[1] - A[1]) * u, h: hA + (hB - hA) * u, A: cp(s.A), B: cp(s.B) }; var c = collides(q); if (c) hit = { c: c, j: j }; }
          if (hit && hit.j === j) err('Trajectoire : contact avec ' + hit.c + ' entre ' + (j === 1 ? 'le départ' : 'le point ' + (j - 1)) + ' et le point ' + j + '.');
          var d = Math.max(L / V, Math.abs(hB - hA) / WR, 0.05);
          s.x = B[0]; s.y = B[1]; s.h = hB; adv(d, 'Trajectoire : point ' + j + ' / ' + list.length + ' (' + Math.round(B[0]) + ', ' + Math.round(B[1]) + ')');
          K[K.length - 1].lin = true;
          if (hit) hit = { c: hit.c, j: -1 };
        }
      },
      /* lâcher sur place : vide coupé, les pierres tombent droit sur leur appui (sol ou pierres) */
      lacher: function (st) {
        var why = PRE.lacher(st); if (why) return err(why);
        var f = st.f, hs = heldStonesOf(f), dep = st.q === 'pile' || !st.q ? hs : hs.filter(function (x) { return x.id === st.q; });
        var p = poseNow(), cs = Math.cos(s[f].rot * D2R), deb = Math.abs(cs) < 0.5;
        /* chute de chaque pierre jusqu'à son appui ; à plat, la pile tombe d'un bloc */
        var gs = dep.map(function (x) { var g = geomHeld(p, f, x.sl), m = 0; freeStones().forEach(function (o) { var go = stoneFoot(o); if (go.top <= g.bottom + 1 && overlap(g.foot, go.foot, 1)) m = Math.max(m, go.top); }); return { x: x, g: g, fall: g.bottom - m }; });
        if (!deb) { var fmin = Math.min.apply(null, gs.map(function (q) { return q.fall; })); gs.forEach(function (q) { q.fall = fmin; }); }
        var fmax = Math.max.apply(null, gs.map(function (q) { return q.fall; }));
        if (deb && fmax > 5) err('Une pierre debout lâchée de ' + Math.round(fmax) + ' mm basculerait : lâcher debout seulement au contact de l\'appui.');
        var gg = graalGeo(); if (gg) gs.forEach(function (q) { var b = q.g.bottom - q.fall, t2 = q.g.top - q.fall; if (overlap(q.g.foot, gg.foot, 1) && b < gg.top - 1 && t2 > gg.bottom + 1) err('Lâcher : ' + q.x.id + ' tomberait sur le Graal.'); });
        var tag = 'd' + s.t.toFixed(3) + f, v = s[f].vac.slice();
        gs.forEach(function (q) { var land = poseNow(); land[f].hc -= q.fall; release(q.x, f, land); q.x.tag = tag; held[f].stack[q.x.sl] = null; v[q.x.sl] = 0; });
        var what = st.q === 'pile' || !st.q ? (dep.length > 1 ? 'la pile' : dep[0].id) : st.q;
        vac(f, v, 'Lâcher : ' + what + (fmax > 1 ? ' tombe de ' + Math.round(fmax) + ' mm' : ' posée') + ' (face ' + f + ')', TL);
        if (!heldStonesOf(f).length) {
          held[f] = null;
          if (s[f].rot !== 0) rr(f, 0, 'Retour de la rotation');
          if (s[f].hc !== 165) zz(f, 165, 'Pince ' + f + ' en position basse');
        }
      },
      deposerZone: function (st) {
        var why = PRE.deposerZone(st); if (why) return err(why);
        var f = st.f, deb = Math.abs(Math.cos(s[f].rot * D2R)) < 0.5;
        if (deb) { if (Math.abs(s[f].hc - 160) > 0.5) zz(f, 160, 'Descente des pierres au sol'); }
        else if (Math.abs(s[f].hc - 165) > 0.5) zz(f, 165, 'Descente à 165 mm');
        return steps.lacher(st);
      },
      seDeplacer: function (st) {
        var x = mir(st.x != null ? st.x : 1050), y = st.y != null ? st.y : 1000, h = st.h != null ? st.h : s.h;
        travel([x, y], h, 'Déplacement vers waypoint');
      },
      tourner: function (st) {
        var why = PRE.tourner(st); if (why) return err(why);
        var f = st.f, r = +st.r;
        if (Math.abs(s[f].rot - r) < 0.5) return;
        var seq = [{ rot: r, label: 'Pince ' + f + ' tournée à ' + r + '°' }];
        if (!st.tm) return runSeq(f, seq);
        var pd = pend[f]; pend[f] = { from: pd ? pd.from : cp(s[f]), seq: (pd ? pd.seq : []).concat(seq) };
        s[f].rot = r;
      },
      attendre: function (st) { flushPend(); adv(Math.max(0, +st.sec || 0), 'Attente de ' + (+st.sec || 0) + ' s'); },
      attendreJusqua: function (st) { flushPend(); var tt = +st.sec || 0; if (s.t < tt) adv(tt - s.t, 'Attente jusqu\'à ' + tt + ' s'); },
      /* retour dans la salle du trône : centre du trône, cap le plus proche du cap actuel qui met toute la projection du robot dans le trône */
      trone: function () {
        var O = [tx(250, P.team), 1000], TRn = throneOf(P.team), h = s.h;
        for (var k = 0; k <= 36; k++) {
          var hk = s.h + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 5, p = { x: O[0], y: O[1], h: hk, A: s.A, B: s.B, C: s.C };
          if (footIn(p, TRn)) { h = hk; break; }
        }
        travel(O, h, 'Retour dans la salle du trône');
      }
    };
    var program = [];
    var oppApplied = {};
    /* pierres prises par l'adversaire : P.oppTaken associe un paquet ('P9') ou une pierre ('P9.2') à l'instant de la prise.
       Dans un duel, l'objet est partagé et rempli par le moteur de l'autre robot au fur et à mesure de ses décisions. */
    function claimTargets(id) {
      if (/^P\d+$/.test(id)) { var idx = -1; PK.forEach(function (pk, i) { if (pk.id === id) idx = i; }); return idx < 0 ? [] : stackStones(idx); }
      return stones.filter(function (x) { return x.id === id; });
    }
    function isClaimed(st) {
      var tk = P.oppTaken || {};
      return st.cur.k === 'gone' || (st.cur.k === 'home' && (tk[st.id] != null || tk[PK[st.pk].id] != null));
    }
    function vanish(id, tt) {
      claimTargets(id).forEach(function (st) {
        if (st.cur.k !== 'home') return;
        st.cur = { k: 'gone' }; st.tag = 'gone'; st.tl.push({ t: tt, k: 'gone' });
      });
    }
    function applyOpp(t) {
      var taken = P.oppTaken || {};
      Object.keys(taken).forEach(function (id) {
        if (oppApplied[id] || t < taken[id]) return;
        oppApplied[id] = true;
        vanish(id, taken[id]);
      });
    }
    /* contrôles de départ (t = 0) : périmètre, hauteur, robot et Graal dans la salle du trône, Graal hors de l'emprise du robot */
    (function () {
      var k0 = snap(); K.push(k0); ctlPrev = k0;
      var per = G.perimetre(k0), top = G.actTop(k0), TRn = throneOf(P.team), gp = graalPoly([P.gx, P.gy], P.ga);
      if (per > GE.perDepart + 0.5) err('Périmètre de départ : ' + Math.round(per) + ' mm (' + GE.perDepart + ' mm au plus).');
      if (top > H_MAX + 0.5) err('Hauteur de départ des actionneurs : ' + Math.round(top) + ' mm (350 mm au plus).');
      if (!footIn(k0, TRn)) err('Départ : le robot doit être entièrement dans sa salle du trône.');
      if (!gp.every(function (v) { return inPolyB(v[0], v[1], TRn); })) err('Graal : sa position de départ (' + P.gx + ', ' + P.gy + ') n\'est pas entièrement dans la salle du trône.');
      if (overlap(gp, G.robotFootprint(k0), 0)) err('Graal : sa position de départ touche l\'emprise du robot au départ.');
    })();
    function exec(st) {
      program.push(st);
      var i = stepInfo.length;
      stepNo = i + 1; stepInfo.push({ t0: s.t, held: { A: heldStonesOf('A').length, B: heldStonesOf('B').length } });
      var t0 = s.t, st0 = stock;
      applyOpp(s.t);
      try { (steps[st.a] || function () { err('Action inconnue.'); })(st); } catch (e) { if (e !== ABORT) err('Erreur interne : ' + e.message); }
      applyOpp(s.t);
      stepInfo[i].t1 = s.t;
      /* contact avec l'autre robot pendant cette étape (sa trajectoire est connue jusqu'ici) */
      if (opts.oppPoseAt && s.t > t0) {
        for (var tc = t0; tc <= s.t + 1e-9; tc += 0.1) {
          var oc = oppAt(tc), pc = poseAtK(K, tc);
          if (oc && oc.x != null && G.hullsHit(pc, oc, 1)) { err('Contact avec le robot adverse (à ' + String(Math.round(tc * 10) / 10).replace('.', ',') + ' s).'); break; }
        }
      }
      graalConfine(t0, s.t);
      stock = stockCount();
      if (stock > STOCK_MAX && stock > st0) err('Stockage : ' + stock + ' pierres posées dans la cour hors des zones de construction (' + STOCK_MAX + ' au plus, E.1.b).');
      return { t0: t0, t1: s.t, dt: s.t - t0, err: stepInfo[i].err || null };
    }
    function attach(res) {
      res.poseAt = function (t) { return poseAtK(K, t); };
      res.stoneAt = function (st, t) { var e = st.tl[0]; for (var i = 0; i < st.tl.length; i++) if (st.tl[i].t <= t) e = st.tl[i]; return e; };
      return res;
    }
    function contactsOf(res) {
      var last = '', collisions = [], gHome = { id: 'graal', foot: graalPoly([P.gx, P.gy], P.ga), bottom: 0, top: GR.h };
      for (var tt = 0; tt <= s.t; tt += 0.1) {
        var p = res.poseAt(tt), hs = [], free = [];
        stones.forEach(function (st) {
          var e = res.stoneAt(st, tt);
          if (e.k === 'held') hs.push(geomHeld(p, e.f, e.l));
          else if (e.k === 'home') free.push(homeGeo(st));
          else if (e.k !== 'gone') { var g2 = geomHeld(e.pose, e.f, e.l); free.push({ id: st.id, foot: g2.foot, top: g2.top, bottom: g2.bottom }); }
        });
        if (SCORE_graalAt(res, tt).k === 'home') free.push(gHome);
        var hit = hits(p, hs, free, 1.5, true, oppAt(tt));
        var key = hit.join(', ');
        if (key && key !== last) collisions.push({ t: tt, with: key });
        last = key;
      }
      return collisions;
    }
    function SCORE_graalAt(res, t) { var e = res.graal.tl[0]; for (var i = 0; i < res.graal.tl.length; i++) if (res.graal.tl[i].t <= t) e = res.graal.tl[i]; return e; }
    function result(doContacts) {
      var res = attach({ K: K, segs: segs, stones: stones, graal: graal, balls: balls, errors: errors, stepInfo: stepInfo, T: s.t, program: program.slice(), PK: PK, ZM: ZM, ZT: ZT, THRONE: throneOf(P.team), CASTLE: CASTLE, COUR_B: COUR_B, params: P, doors: Object.assign({}, doors) });
      res.collisions = doContacts === false || opts.skipContacts ? [] : contactsOf(res);
      return res;
    }
    function finish() { flushPend(); if (stepNo === 0) { stepNo = 1; stepInfo.push({ t0: s.t, held: { A: 0, B: 0 } }); } adv(0.5, 'Fin du programme'); return result(true); }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function snapshot() {
      return { s: clone(s), stones: clone(stones), graal: clone(graal), balls: clone(balls), K: clone(K), segs: clone(segs), errors: clone(errors), stepInfo: clone(stepInfo), stepNo: stepNo, program: clone(program), oppApplied: clone(oppApplied), pend: clone(pend), held: serializeHeld(), doors: clone(doors), stock: stock, ctlPrev: clone(ctlPrev), ctlSeen: clone(ctlSeen) };
    }
    function serializeHeld() {
      var h = {};
      ['A', 'B'].forEach(function (f) { h[f] = held[f] ? { stack: (held[f].stack || []).map(function (st) { return st ? st.id : null; }) } : null; });
      return h;
    }
    function restoreHeld(h) {
      var byId = {}; stones.forEach(function (st) { byId[st.id] = st; });
      held = { A: null, B: null };
      ['A', 'B'].forEach(function (f) { if (h[f]) held[f] = { stack: h[f].stack.map(function (id) { return id ? byId[id] : null; }) }; });
    }
    function restore(sn) {
      s = clone(sn.s); stones = clone(sn.stones); graal = clone(sn.graal); balls = clone(sn.balls);
      K = clone(sn.K); segs = clone(sn.segs); errors = clone(sn.errors); stepInfo = clone(sn.stepInfo);
      stepNo = sn.stepNo; program = clone(sn.program); oppApplied = clone(sn.oppApplied);
      pend = clone(sn.pend); doors = clone(sn.doors || {}); stock = sn.stock || 0; ctlPrev = sn.ctlPrev ? clone(sn.ctlPrev) : K[K.length - 1]; ctlSeen = clone(sn.ctlSeen || {});
      restoreHeld(sn.held);
    }
    function pose() { return poseNow(); }
    function getHeld() { return held; }
    function getStones() { return stones; }
    function getGraal() { return graal; }
    function getBalls() { return balls; }
    function time() { return s.t; }
    function params() { return P; }
    function poseAtT(tt) { return poseAtK(K, tt); }
    /* pierres posées (et Graal resté au sol), vues par l'autre robot comme obstacles */
    function freeFeet() {
      var out = stones.filter(function (x) { return x.cur.k === 'free'; }).map(function (x) { var g = stoneFoot(x); return { id: x.id, foot: g.foot, top: g.top, bottom: g.bottom }; });
      var gg = graalGeo(); if (gg) out.push({ id: 'Graal adverse', foot: gg.foot, top: gg.top, bottom: gg.bottom });
      return out;
    }
    /* pierres qui ont quitté leur paquet pour ce robot : id -> instant de la prise */
    function leftHome(into) {
      stones.forEach(function (x) {
        if (x.cur.k === 'home' || x.cur.k === 'gone' || into[x.id] != null) return;
        for (var i = 0; i < x.tl.length; i++) if (x.tl[i].k !== 'home' && x.tl[i].k !== 'gone') { into[x.id] = x.tl[i].t; return; }
      });
      return into;
    }
    function claimed(id) { return stones.some(function (x) { return x.id === id && isClaimed(x); }); }
    return { exec: exec, finish: finish, result: result, preconditions: preconditions, poseAtT: poseAtT, claimed: claimed, covered: function (st, excl) { return covered(st, excl); }, foreign: foreign, freeFeet: freeFeet, leftHome: leftHome, snapshot: snapshot, restore: restore, pose: pose, held: getHeld, stones: getStones, graal: getGraal, balls: getBalls, errors: function () { return errors; }, time: time, params: params, hullRadius: hullRadius, stockage: stockCount, portes: function () { return Object.assign({}, doors); }, program: function () { return program.slice(); } };
  }
  function simulate(prog, P, opts) {
    var sim = makeSim(P, opts);
    (prog || []).forEach(function (st) { sim.exec(st); });
    return sim.finish();
  }
  function poseAtK(K, t) {
    if (t <= K[0].t) return K[0];
    var lo = 0, hi = K.length - 1;
    if (t >= K[hi].t) return K[hi];
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (K[mid].t < t) lo = mid; else hi = mid; }
    var a = K[hi - 1], b = K[hi], d = b.t - a.t, k = d > 0 ? (t - a.t) / d : 1, e = b.lin ? k : k * k * (3 - 2 * k);
    var L = function (x, y) { return x + (y - x) * e; };
    var g = function (ga, gb) { return { hc: L(ga.hc, gb.hc), rot: L(ga.rot, gb.rot), vac: ga.vac }; };
    var c = function (ca, cb) { return ca && cb ? { can: L(ca.can, cb.can), fx: L(ca.fx, cb.fx), fz: L(ca.fz, cb.fz) } : (cb || ca); };
    return { t: t, x: L(a.x, b.x), y: L(a.y, b.y), h: L(a.h, b.h), A: g(a.A, b.A), B: g(a.B, b.B), C: c(a.C, b.C) };
  }
  /* ---------- duel : deux robots sur la même table ----------
     Chaque robot a son moteur (makeSim), le jaune en repère jaune, le bleu en vrai repère bleu (programmes passés par mirrorStep).
     Les deux moteurs partagent le monde par trois liens :
       - les pierres : dès qu'un robot décide de prendre une pierre, elle est réservée (P.oppTaken de l'autre) ; l'autre ne peut plus la prendre
         (« premier engagé, premier servi ») et elle disparaît de sa table à l'instant de la prise. Une pierre n'existe donc jamais chez les deux ;
       - les pierres posées par l'un (et son Graal resté au sol) sont des obstacles pour l'autre ;
       - les robots : lidar (attente de 2 s si l'autre est à moins de 400 mm devant), cases occupées évitées par le trajet, et contact signalé
         s'ils se touchent quand même (châssis contre châssis).
     Ordre des décisions : le robot dont l'horloge est la plus en retard décide en premier (à égalité, le jaune). */
  function programAgent(list) {
    var i = 0;
    return { next: function () { return i < list.length ? list[i++] : null; }, program: function () { return list.slice(0, i); } };
  }
  function makeDuel(cfg) {
    cfg = cfg || {};
    var Py = Object.assign({}, DEF, cfg.params || {}, { team: 'yellow' });
    var hasBlue = !!cfg.blue;
    var Pb = hasBlue ? Object.assign({}, DEF, cfg.blue.params || {}, { team: 'blue' }) : null;
    var tk = { yellow: {}, blue: {} }, sims = {}, programs = { yellow: [], blue: [] };
    sims.yellow = makeSim(Object.assign({}, Py, { oppTaken: tk.blue }), {
      skipContacts: !!cfg.skipContacts,
      oppPoseAt: hasBlue ? function (tt) { return sims.blue.poseAtT(tt); } : null,
      foreignFeet: hasBlue ? function () { return sims.blue.freeFeet(); } : null
    });
    if (hasBlue) sims.blue = makeSim(Object.assign({}, Pb, { oppTaken: tk.yellow }), {
      skipContacts: !cfg.blue.contacts,
      oppPoseAt: function (tt) { return sims.yellow.poseAtT(tt); },
      foreignFeet: function () { return sims.yellow.freeFeet(); }
    });
    function exec(team, brick) {
      var info = sims[team].exec(brick);
      sims[team].leftHome(tk[team]);   /* pierres réservées pour l'autre robot */
      programs[team].push(brick);
      return info;
    }
    /* fait jouer l'adversaire tant que son horloge est en retard sur t (même règle que run : à égalité, le jaune décide d'abord) */
    function advanceBlue(agent, upTo) {
      if (!hasBlue || !agent) return;
      for (var n = 0; n < 500 && sims.blue.time() < upTo; n++) {
        var b = agent.next(sims.blue, sims.yellow);
        if (b == null) { agent.done = true; return; }
        exec('blue', b);
      }
    }
    /* deux programmes (ou tout agent qui a next(sim, autre) -> brique | null) jusqu'à la fin */
    function run(agents) {
      var done = { yellow: false, blue: !hasBlue }, guard = 0;
      while ((!done.yellow || !done.blue) && guard++ < 5000) {
        var team = done.yellow ? 'blue' : done.blue ? 'yellow' : (sims.blue.time() < sims.yellow.time() ? 'blue' : 'yellow');
        var b = agents[team].next(sims[team], sims[team === 'yellow' ? 'blue' : 'yellow']);
        if (b == null) { done[team] = true; continue; }
        exec(team, b);
      }
    }
    function finish() {
      var Ry = sims.yellow.finish(), Rb = hasBlue ? sims.blue.finish() : null;
      if (hasBlue && !cfg.skipContacts) Ry = sims.yellow.result(true);
      Ry.opponent = Rb;
      Ry.oppEvents = { taken: Object.assign({}, tk.blue), none: !hasBlue };
      Ry.programs = { yellow: programs.yellow.slice(), blue: programs.blue.slice() };
      return Ry;
    }
    return { sims: sims, exec: exec, run: run, advanceBlue: advanceBlue, finish: finish, claims: tk, programs: programs, hasBlue: hasBlue };
  }
  /* programme jaune contre programme bleu (écrit en repère jaune, joué en miroir) */
  function simulateMatch(prog, P, opts) {
    opts = opts || {};
    var intensity = opts.intensity || (opts.adversaire && opts.adversaire.intensite) || 'aucun';
    var oppSrc = opts.opponent;
    var has = oppSrc && oppSrc.program && oppSrc.program.length && intensity !== 'aucun' && intensity !== 'none';
    var duel = makeDuel({
      params: P, skipContacts: opts.skipContacts,
      blue: has ? { params: intensityParams(blueParams(oppSrc.params || P), intensity) } : null
    });
    var agents = { yellow: programAgent(prog || []), blue: has ? programAgent(oppSrc.program.map(mirrorStep)) : null };
    duel.run(agents);
    return duel.finish();
  }
  /* Programme de référence (golden test, tests/test_moteur.js) : piles, murs, porte, tours, tir, Graal monté sur le toit, retour au trône. */
  var PROGRAMME_REFERENCE = [];
  var api = {
    VERSION: VERSION, MATCH: MATCH, T_ATTAQUE: T_ATTAQUE, DEF: DEF, simulate: simulate, simulateMatch: simulateMatch, makeSim: makeSim, makeDuel: makeDuel, programAgent: programAgent,
    poseAtK: poseAtK, mirrorId: mirrorId, mirrorStep: mirrorStep, blueParams: blueParams,
    intensityParams: intensityParams, PK: PK, ZM: ZM, ZT: ZT, THRONE: THRONE, THRONE_B: THRONE_B, CASTLE: CASTLE,
    CASTLE_B: CASTLE_B, COUR: COUR, COUR_B: COUR_B, inPoly: inPoly, zoneById: zoneById, zoneRect: zoneRect, throneOf: throneOf, castleOf: castleOf, tx: tx, th: th,
    graalPoly: graalPoly, graalOnRobot: graalOnRobot, PROGRAMME_REFERENCE: PROGRAMME_REFERENCE
  };
  root.ENGINE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
