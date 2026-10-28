/* Géométrie partagée : robot réel (spec/robot.json, via SPEC), pierres, tests de recouvrement.
   Chargé après spec/spec.js par /plateau/, /cerveau/, l'environnement d'entraînement et les tests Node.

   Repères (docs/CONTRATS.md §2) :
   - robot : origine au centre, angle 0 = normale de la face A, sens trigonométrique ; faces B et C à +120° et +240° ;
   - face : n = normale sortante (nv), u = droite vue de face (lv), z = hauteur depuis le sol ;
   - nacelle (faces A et B) : plan (u, z) de la face, origine sur l'axe de rotation (hauteur hc, rangée 2).
     Rotation d'un angle rot (degrés) : (u, z) -> (u cos + z sin, -u sin + z cos). À 90°, la rangée 1 (z = -110) passe en u = -110.
   Toute valeur absente de la spec est une constante nommée ci-dessous, avec sa source ou la mention « hypothèse ». */
(function (root) {
  var SPEC = root.SPEC;
  if (!SPEC || !SPEC.robot || !SPEC.regles) throw new Error('SPEC absente : charger spec/spec.js (généré par node tools/gen_spec.js) avant engine/geom.js.');
  var RG = SPEC.regles, RB = SPEC.robot, CH = RB.chassis, MEC = RB.mecanismes;
  var NAC = MEC.pince_A_et_B, CAN = MEC.canon_C, ASC = MEC.ascenseur_graal, GRA = MEC.graal;
  var VERINS = MEC.actionneurs_carte.verins;
  function val(x) { return x !== null && typeof x === 'object' && 'valeur' in x ? x.valeur : x; }
  var D2R = Math.PI / 180;

  /* ---------------- règles ---------------- */
  var PL = RG.pierres.dimensions[0], PE = RG.pierres.dimensions[1];      /* pierre 320 x 110 x 110 */
  var H_MAX = RG.robot_limites.hauteur_max_robot_et_objets_manipules;     /* 350 */
  var PER_DEPART = RG.robot_limites.perimetre_depart_max, PER_MATCH = RG.robot_limites.perimetre_deploye_max;
  var BORDURE = RG.table.bordure_hauteur;                                  /* 70 : un élément plus haut peut dépasser au-dessus de la bordure */

  /* ---------------- châssis ---------------- */
  var FACE = CH.plaque_haute.distance_faces_au_centre[0];                 /* 110,3 */
  var TOIT = val(CH.toit_cible);                                           /* 311,2 */
  var HULL = CH.empreinte_sol.polygone;                                    /* repère robot, sens trigonométrique */
  var NH = HULL.length, HX = new Float64Array(NH), HY = new Float64Array(NH), HNX = new Float64Array(NH), HNY = new Float64Array(NH), HOFF = new Float64Array(NH), HMIN = new Float64Array(NH);
  var HULL_R = 0;
  (function () {
    var i, j;
    for (i = 0; i < NH; i++) { HX[i] = HULL[i][0]; HY[i] = HULL[i][1]; HULL_R = Math.max(HULL_R, Math.hypot(HX[i], HY[i])); }
    for (i = 0; i < NH; i++) {
      var k = (i + 1) % NH, dx = HX[k] - HX[i], dy = HY[k] - HY[i], L = Math.hypot(dx, dy);
      HNX[i] = dy / L; HNY[i] = -dx / L; HOFF[i] = HNX[i] * HX[i] + HNY[i] * HY[i];
      var m = 1e9; for (j = 0; j < NH; j++) m = Math.min(m, HNX[i] * HX[j] + HNY[i] * HY[j]); HMIN[i] = m;
    }
  })();

  /* ---------------- nacelles A et B (conception/pince.md, tools/conception_pince.py) ---------------- */
  var SAILLIE = NAC.saillie_hors_face.recommandation;                      /* 35 : avant des ventouses depuis la face */
  var NAC_DOS = 2;            /* dos de la nacelle à 2 mm de la face (tools/cao_robot.py : xa = FACE + 2) */
  var D_PIERRE = FACE + SAILLIE + PE / 2;                                  /* 200,3 : centre d'une pierre à plat tenue */
  var GARDE_SOL = 5;          /* garde au sol des pierres et des actionneurs en rotation (tools/conception_pince.py, contrat §2) */
  var VT = NAC.ventouses;
  var R_V40 = 20;             /* ventouses Ø40 des rangées 1 et 2 (spec : « Ø40 à soufflet ») */
  var OV3 = [40, 20];         /* ventouses ovales 40 x 20 de la rangée 3, grand axe horizontal (spec : « ovale 40 x 20 ») */
  var BORD_V3 = VT.rangee_3.centre_au_dessus_bord_bas_pierre;             /* 12 */
  /* capsules (z relatif à l'axe, demi-longueur, rayon) */
  var RANGEES = [
    { z: VT.rangee_1.z_axe, hl: VT.rangee_1.x[1], r: R_V40 },
    { z: VT.rangee_2.z_axe, hl: VT.rangee_2.x[1], r: R_V40 },
    { z: VT.rangee_3.z_axe, hl: VT.rangee_3.x[1] + (OV3[0] - OV3[1]) / 2, r: OV3[1] / 2 }
  ];
  /* colonne centrale de 30 mm de large, de -135 à +77 (contrat §2 ; tools/cao_robot.py) */
  var COL = { hu: 15, z0: -135, z1: RANGEES[2].z + RANGEES[2].r };
  /* course de l'axe : la nacelle à 0° reste au-dessus de la garde au sol et sous 350 mm (contrat §2 : [135, 273]) */
  var HC_MIN = GARDE_SOL - (RANGEES[0].z - RANGEES[0].r), HC_MAX = H_MAX - (RANGEES[2].z + RANGEES[2].r);
  /* pierre tenue par la rangée r (0, 1, 2), nacelle à 0° : [u0, u1, z0, z1] relatif à l'axe */
  function stoneRect(r) {
    var b = r === 2 ? RANGEES[2].z - BORD_V3 : RANGEES[r].z - PE / 2;
    return [-PL / 2, PL / 2, b, b + PE];
  }
  /* centre (relatif à l'axe, à 0°) de la pierre tenue par la rangée r : -110, 0, +110 */
  function stoneZc(r) { var q = stoneRect(r); return (q[2] + q[3]) / 2; }

  /* étendue verticale et latérale d'une capsule / d'un rectangle tournés */
  function capExt(c, cs, sn, o) {
    var zs = Math.abs(c.hl * sn), zc = c.z * cs, us = Math.abs(c.hl * cs) + Math.abs(c.z * sn);
    if (zc + zs + c.r > o.zmax) o.zmax = zc + zs + c.r;
    if (zc - zs - c.r < o.zmin) o.zmin = zc - zs - c.r;
    if (us + c.r > o.umax) o.umax = us + c.r;
  }
  function rectExt(q, cs, sn, o) {
    for (var a = 0; a < 2; a++) for (var b = 2; b < 4; b++) {
      var u = q[a], z = q[b], zr = -u * sn + z * cs, ur = Math.abs(u * cs + z * sn);
      if (zr > o.zmax) o.zmax = zr; if (zr < o.zmin) o.zmin = zr; if (ur > o.umax) o.umax = ur;
    }
  }
  /* actionneur seul (3 rangées + colonne) à l'angle rot : { zmin, zmax, umax } relatifs à l'axe */
  function actExt(rot) {
    var a = rot * D2R, cs = Math.cos(a), sn = Math.sin(a), o = { zmin: 1e9, zmax: -1e9, umax: 0 };
    for (var i = 0; i < 3; i++) capExt(RANGEES[i], cs, sn, o);
    rectExt([-COL.hu, COL.hu, COL.z0, COL.z1], cs, sn, o);
    return o;
  }
  /* pierres tenues (masque de rangées : bit r) à l'angle rot */
  function loadExt(mask, rot) {
    var a = rot * D2R, cs = Math.cos(a), sn = Math.sin(a), o = { zmin: 1e9, zmax: -1e9, umax: 0 };
    for (var r = 0; r < 3; r++) if (mask & (1 << r)) rectExt(stoneRect(r), cs, sn, o);
    return o;
  }

  var BAL = new Map();
  /* ---- faisabilité des rotations (portage de balayage, tools/conception_pince.py) ----
     Pour une charge (masque de rangées) et un angle, plage de hauteurs d'axe admissibles [lo, hi] :
     actionneurs <= 350 mm, actionneurs et pierres >= GARDE_SOL, pierres <= 350 mm hors château et hors zones de construction,
     axe dans sa course [HC_MIN, HC_MAX]. Tables au degré, angles 0 à 180 (charge et nacelle symétriques en u). */
  var CORR = [], HC_GEO = [HC_MIN, HC_MAX], MARGE_H = 0, COURSE_V = 0;
  function buildCorr() {
    var HM = H_MAX - MARGE_H;
    for (var mask = 0; mask < 8; mask++) for (var ch = 0; ch < 2; ch++) {
      var lo = new Float64Array(181), hi = new Float64Array(181);
      for (var a = 0; a <= 180; a++) {
        var A = actExt(a), Ld = loadExt(mask, a), bas = Math.min(A.zmin, mask ? Ld.zmin : 1e9);
        var h1 = Math.min(HM - A.zmax, HC_MAX);
        if (mask && !ch) h1 = Math.min(h1, HM - Ld.zmax);
        lo[a] = Math.max(GARDE_SOL - bas, HC_MIN); hi[a] = h1;
      }
      CORR[mask * 2 + ch] = { lo: lo, hi: hi };
    }
  }
  buildCorr();
  /* Course réelle de l'axe et marge sous 350 mm (paramètres d'équipe, chantier moteur-2) :
     - course : spec actionneurs_carte.verins.course_mm (100 mm déclarés) ; hcBas : hauteur de l'axe en butée basse (décalage de
       montage, hypothèse non tranchée) ; l'axe va alors de max(hcBas, 135) à min(hcBas + course, 273) (bornes géométriques) ;
     - margeHauteur : marge sous 350 mm pendant les rotations (0 par défaut : la règle dit « au plus 350 mm »).
     configurerCourse(null) rétablit la course géométrique [135, 273] et une marge nulle. Réglage global (même robot pour tous). */
  function configurerCourse(o) {
    o = o || {};
    HC_MIN = o.hcBas != null ? Math.max(HC_GEO[0], +o.hcBas) : HC_GEO[0];
    HC_MAX = o.hcBas != null ? Math.min(HC_GEO[1], +o.hcBas + (o.course != null ? +o.course : val(VERINS.course_mm))) : HC_GEO[1];
    MARGE_H = o.margeHauteur > 0 ? +o.margeHauteur : 0;
    GEO.hcMin = HC_MIN; GEO.hcMax = HC_MAX; GEO.margeHauteur = MARGE_H;
    buildCorr(); BAL.clear(); COURSE_V++;
    return { hcMin: HC_MIN, hcMax: HC_MAX, margeHauteur: MARGE_H };
  }
  function courseVersion() { return COURSE_V; }
  function normAng(a) { a = ((a % 360) + 360) % 360; return a > 180 ? 360 - a : a; }
  /* plage admissible à l'angle a (prudente entre deux degrés) */
  function corridor(mask, chateau, a) {
    var T = CORR[mask * 2 + (chateau ? 1 : 0)], x = normAng(a), i0 = Math.floor(x), i1 = Math.min(180, Math.ceil(x));
    return [Math.max(T.lo[i0], T.lo[i1]), Math.min(T.hi[i0], T.hi[i1])];
  }
  /* balayage de a0 à a1 : { ok, marge } (marge = min(hi - lo), comme tools/conception_pince.py, course de l'axe comprise) */
  function balayage(mask, chateau, a0, a1) {
    var key = mask + (chateau ? 'c' : 'h') + a0 + ',' + a1, r = BAL.get(key);
    if (r) return { ok: r.ok, marge: r.marge };
    var n = Math.max(1, Math.ceil(Math.abs(a1 - a0))), m = 1e9;
    for (var k = 0; k <= n; k++) { var c = corridor(mask, chateau, a0 + (a1 - a0) * k / n); m = Math.min(m, c[1] - c[0]); }
    r = { ok: m >= 0, marge: m };
    if (BAL.size > 5000) BAL.clear();
    BAL.set(key, r);
    return { ok: r.ok, marge: r.marge };
  }

  /* ---------------- canon (face C, contrat §2 ; spec mecanismes.canon_C) ---------------- */
  var CAN_Y = -50;            /* axe du canon à 50 mm à gauche de l'axe de la face C (contrat §2 ; tools/cao_robot.py CANON.y) */
  var CAN_EL = CAN.elevation_deg, CAN_D = CAN.diametre_tube, CAN_COURSE = CAN.course_sortie;
  var CAN_HF = CAN.bouche_deployee.hors_face, CAN_HZ = CAN.bouche_deployee.hauteur;
  /* projection au sol du tube sorti de can mm : bout de l'axe à FACE + 57 - (90 - can) cos 35°, plus le rayon projeté */
  function canonReach(can) { return FACE + CAN_HF - (CAN_COURSE - can) * Math.cos(CAN_EL * D2R) + CAN_D / 2 * Math.sin(CAN_EL * D2R); }
  var CAN_Z = [CAN_HZ - CAN_HF * Math.tan(CAN_EL * D2R) - CAN_D / 2 / Math.cos(CAN_EL * D2R), CAN_HZ + CAN_D / 2 * Math.cos(CAN_EL * D2R)];

  /* ---------------- ascenseur du Graal (face C, bord droit ; tools/cao_robot.py, conception/ascenseur_graal.md) ---------------- */
  var GR_BASE = GRA.base[0], GR_H = GRA.hauteur;
  /* anses (tools/cao_robot.py G) : dessous à 22 mm du fond, débord 20 mm, longueur 50 mm */
  var ANSE = { dessous: 22, saillie: 20, long: 50 };
  /* fourche (tools/cao_robot.py F) */
  var FO = { jeuFace: 4, travEp: 8, jeuGraal: 2, dentL: 8, dentEp: 5, dentLong: 72, dentBas: 9, brasY: [113, 123], brasLong: 110, margeToit: 4 };
  var G_TOIT = ASC.position_graal_sur_toit.repere_face_C;                  /* [76,3 ; 57] */
  var GY = G_TOIT[1];
  var GX_PRISE = FACE + FO.jeuFace + FO.travEp + FO.jeuGraal + GR_BASE / 2; /* 155,3 */
  var FX_SORTIE = FACE + FO.jeuFace, FX_RENTREE = FX_SORTIE - ASC.course_coulisse_horizontale; /* 114,3 / 35,3 : face intérieure de la traverse */
  var FZ_HAUT = TOIT + FO.margeToit + ANSE.dessous - FO.dentEp, FZ_BAS = FO.dentBas;  /* dessous des dents : 332,2 / 9 */
  var DENT_Y = [GY - GR_BASE / 2 - (ANSE.saillie - 4) / 2, GY + GR_BASE / 2 + (ANSE.saillie - 4) / 2]; /* 18 / 96 (lèvre de 4 mm) */
  /* polygone (repère face C) de la partie de l'ascenseur qui dépasse : chariot et palier (fixes en x), bras, traverse, dents */
  function fourchePtsC(fx) {
    var y0 = DENT_Y[0] - FO.dentL / 2, y1 = DENT_Y[1] + FO.dentL / 2, xd = fx + FO.travEp + FO.dentLong;
    return [[FACE + 10, 110], [FACE + 22, 110], [FACE + 40, 111], [FACE + 40, 125], [FACE + 22, 131], [FACE + 10, 131],
      [fx, y0], [xd, y0], [xd, y1], [fx + FO.brasLong, FO.brasY[0]], [fx + FO.brasLong, FO.brasY[1]], [fx, FO.brasY[1]]];
  }
  /* hauteurs de l'ascenseur pour un dessous de dents à fz : chariot de fz - 40 à fz + 15 (tools/cao_robot.py) */
  function fourcheZ(fz) { return [Math.max(0, fz - 40), fz + 15]; }

  /* ---------------- outils de repère ---------------- */
  function nv(deg) { var r = deg * D2R; return [Math.cos(r), Math.sin(r)]; }
  function lv(deg) { var r = deg * D2R; return [-Math.sin(r), Math.cos(r)]; }
  /* points du repère d'une face (angle phiR dans le repère robot : 0, 120, 240) vers le repère robot */
  function faceToRobot(pts, phiR) {
    var c = Math.cos(phiR * D2R), s = Math.sin(phiR * D2R);
    return pts.map(function (q) { return [q[0] * c - q[1] * s, q[0] * s + q[1] * c]; });
  }
  function toTable(pts, p) {
    var c = Math.cos(p.h * D2R), s = Math.sin(p.h * D2R);
    return pts.map(function (q) { return [p.x + q[0] * c - q[1] * s, p.y + q[0] * s + q[1] * c]; });
  }

  /* pierre tenue par la face k (0 = A, 1 = B), rangée l : centre 2D, demi-largeurs (latérale, normale), angle de la face */
  function heldFoot(p, k, l) {
    var g = k === 0 ? p.A : p.B, phi = p.h + 120 * k, n = nv(phi), t = lv(phi);
    var th = g.rot * D2R, zc = stoneZc(l), u = zc * Math.sin(th), hl = PL / 2 * Math.abs(Math.cos(th)) + PE / 2 * Math.abs(Math.sin(th));
    return { cx: p.x + D_PIERRE * n[0] + u * t[0], cy: p.y + D_PIERRE * n[1] + u * t[1], hl: hl, hn: PE / 2, ang: phi };
  }
  function rectPoly(f) {
    var n = nv(f.ang), t = lv(f.ang), P = [];
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (s) { P.push([f.cx + s[0] * f.hl * t[0] + s[1] * f.hn * n[0], f.cy + s[0] * f.hl * t[1] + s[1] * f.hn * n[1]]); });
    return P;
  }
  /* empreinte au sol mesurée du châssis, dans le repère table */
  function robotPoly(p) {
    var c = Math.cos(p.h * D2R), s = Math.sin(p.h * D2R), P = new Array(NH);
    for (var i = 0; i < NH; i++) P[i] = [p.x + HX[i] * c - HY[i] * s, p.y + HX[i] * s + HY[i] * c];
    return P;
  }

  /* ---------------- corps du robot hors châssis (repère robot) ----------------
     nacelle : rectangle [FACE + 2, FACE + 35] x [-umax, umax] de la face, hauteur hc + étendue de l'actionneur ;
     canon sorti de can mm ; ascenseur : partie qui dépasse de la face C (position fx de la traverse, fz du dessous des dents). */
  function nacPtsR(k, g, umax) {
    var U = umax != null ? umax : actExt(g.rot).umax;
    return faceToRobot([[FACE + NAC_DOS, -U], [FACE + SAILLIE, -U], [FACE + SAILLIE, U], [FACE + NAC_DOS, U]], 120 * k);
  }
  function canonPtsR(can) {
    if (!(can > 0)) return null;
    var x1 = canonReach(can); if (x1 <= FACE) return null;
    return faceToRobot([[FACE, CAN_Y - CAN_D / 2], [x1, CAN_Y - CAN_D / 2], [x1, CAN_Y + CAN_D / 2], [FACE, CAN_Y + CAN_D / 2]], 240);
  }
  function fourchePtsR(fx) { return faceToRobot(fourchePtsC(fx), 240); }
  var C0 = { can: 0, fx: FX_RENTREE, fz: FZ_HAUT };
  /* état des mécanismes de la face C par défaut (départ : canon rentré, fourche rangée au-dessus du toit) */
  function cState(C) { return C || C0; }

  /* ---------------- enveloppe convexe et périmètre ---------------- */
  function convexHull(P) {
    P = P.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [], i;
    for (i = 0; i < P.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], P[i]) <= 0) lo.pop(); lo.push(P[i]); }
    for (i = P.length - 1; i >= 0; i--) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], P[i]) <= 0) up.pop(); up.push(P[i]); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function hullPer(P) {
    var H = convexHull(P), per = 0;
    for (var j = 0; j < H.length; j++) { var a = H[j], b = H[(j + 1) % H.length]; per += Math.hypot(a[0] - b[0], a[1] - b[1]); }
    return per;
  }
  /* points du robot (repère robot) : châssis + nacelles + canon s'il est sorti + ascenseur. Pierres tenues exclues (contrat §2).
     opt.uA, opt.uB : demi-largeur imposée des nacelles (pire cas pendant une rotation) ; opt.sansMeca : châssis seul. */
  function robotPtsR(st, opt) {
    opt = opt || {};
    var P = HULL.slice();
    if (opt.sansMeca) return P;
    P = P.concat(nacPtsR(0, st.A, opt.uA), nacPtsR(1, st.B, opt.uB));
    var C = cState(st.C), cp = canonPtsR(C.can); if (cp) P = P.concat(cp);
    return P.concat(fourchePtsR(C.fx));
  }
  function perimetre(st, opt) { return hullPer(robotPtsR(st, opt)); }
  /* projection verticale complète du robot dans le repère table (salle du trône, affichage) */
  function robotFootprint(p) { return toTable(convexHull(robotPtsR(p)), p); }
  /* hauteur maximale des actionneurs : nacelles (hc + haut de l'actionneur), fourche (haut de la traverse), canon */
  function actTop(st) {
    var C = cState(st.C);
    return Math.max(st.A.hc + actExt(st.A.rot).zmax, st.B.hc + actExt(st.B.rot).zmax, fourcheZ(C.fz)[1], C.can > 0 ? CAN_Z[1] : 0);
  }

  /* ---------------- recouvrements ---------------- */
  /* Pré-test par boîtes englobantes (cahier des charges, annexe D.1) : résultats identiques, beaucoup plus rapide. */
  function overlap(A, B, tol) {
    var i, v, ax0 = 1e9, ax1 = -1e9, ay0 = 1e9, ay1 = -1e9, bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
    for (i = 0; i < A.length; i++) { v = A[i]; if (v[0] < ax0) ax0 = v[0]; if (v[0] > ax1) ax1 = v[0]; if (v[1] < ay0) ay0 = v[1]; if (v[1] > ay1) ay1 = v[1]; }
    for (i = 0; i < B.length; i++) { v = B[i]; if (v[0] < bx0) bx0 = v[0]; if (v[0] > bx1) bx1 = v[0]; if (v[1] < by0) by0 = v[1]; if (v[1] > by1) by1 = v[1]; }
    if (ax1 <= bx0 + tol || bx1 <= ax0 + tol || ay1 <= by0 + tol || by1 <= ay0 + tol) return false;
    var polys = [A, B];
    for (var q = 0; q < 2; q++) {
      var P = polys[q];
      for (i = 0; i < P.length; i++) {
        var a = P[i], b = P[(i + 1) % P.length], nx = b[1] - a[1], ny = a[0] - b[0], L = Math.hypot(nx, ny); nx /= L; ny /= L;
        var mnA = 1e9, mxA = -1e9, mnB = 1e9, mxB = -1e9, j, d;
        for (j = 0; j < A.length; j++) { d = A[j][0] * nx + A[j][1] * ny; if (d < mnA) mnA = d; if (d > mxA) mxA = d; }
        for (j = 0; j < B.length; j++) { d = B[j][0] * nx + B[j][1] * ny; if (d < mnB) mnB = d; if (d > mxB) mxB = d; }
        if (mxA <= mnB + tol || mxB <= mnA + tol) return false;
      }
    }
    return true;
  }
  /* châssis à la pose p contre un polygone convexe B (repère table) : même convention de tolérance que overlap.
     B est ramené dans le repère robot ; les normales du châssis et leurs étendues sont précalculées. */
  var QX = new Float64Array(64), QY = new Float64Array(64);
  function hullHit(p, B, tol) {
    var c = Math.cos(p.h * D2R), s = Math.sin(p.h * D2R), nB = B.length, i, j, d, mn, mx;
    if (nB > 64) return overlap(robotPoly(p), B, tol);
    var cx = 0, cy = 0, r2 = 0;
    for (i = 0; i < nB; i++) { var dx = B[i][0] - p.x, dy = B[i][1] - p.y; QX[i] = dx * c + dy * s; QY[i] = -dx * s + dy * c; cx += QX[i]; cy += QY[i]; }
    cx /= nB; cy /= nB;
    for (i = 0; i < nB; i++) r2 = Math.max(r2, (QX[i] - cx) * (QX[i] - cx) + (QY[i] - cy) * (QY[i] - cy));
    if (Math.hypot(cx, cy) >= HULL_R + Math.sqrt(r2) + tol) return false;
    /* axes de B */
    for (i = 0; i < nB; i++) {
      var k = (i + 1) % nB, nx = QY[k] - QY[i], ny = QX[i] - QX[k], L = Math.hypot(nx, ny); if (L < 1e-9) continue; nx /= L; ny /= L;
      mn = 1e9; mx = -1e9; for (j = 0; j < nB; j++) { d = QX[j] * nx + QY[j] * ny; if (d < mn) mn = d; if (d > mx) mx = d; }
      var hm = 1e9, hM = -1e9; for (j = 0; j < NH; j++) { d = HX[j] * nx + HY[j] * ny; if (d < hm) hm = d; if (d > hM) hM = d; }
      if (hM <= mn + tol || mx <= hm + tol) return false;
    }
    /* axes du châssis */
    for (i = 0; i < NH; i++) {
      mn = 1e9; mx = -1e9; for (j = 0; j < nB; j++) { d = QX[j] * HNX[i] + QY[j] * HNY[i]; if (d < mn) mn = d; if (d > mx) mx = d; }
      if (HOFF[i] <= mn + tol || mx <= HMIN[i] + tol) return false;
    }
    return true;
  }
  /* deux châssis (robot et adversaire). L'adversaire peut porter sa propre empreinte (engine/adversaires.js, contrat §14) :
     o.fp = polygone convexe dans son repère, o.R = son rayon maximal ; sinon c'est le même châssis que le nôtre. */
  function hullsHit(p, o, tol) {
    if (Math.hypot(p.x - o.x, p.y - o.y) >= HULL_R + (o.fp ? o.R : HULL_R) + tol) return false;
    return hullHit(p, o.fp ? toTable(o.fp, o) : robotPoly(o), tol);
  }

  /* compatibilité : anciens noms (le triangle de 400 mm n'existe plus) */
  function triPoly(p) { return robotPoly(p); }
  function cannonPoly(p, can) { var q = canonPtsR(can != null ? can : CAN_COURSE); return q ? toTable(q, p) : null; }

  var GEO = {
    rin: FACE, R: HULL_R, face: FACE, toit: TOIT, faceLong: CH.faces_longueur[0], hull: HULL, hullR: HULL_R,
    saillie: SAILLIE, nacDos: NAC_DOS, dPierre: D_PIERRE, gardeSol: GARDE_SOL, hMax: H_MAX, perDepart: PER_DEPART, perMatch: PER_MATCH,
    bordure: BORDURE, pierre: [PL, PE], rangees: RANGEES, colonne: COL, hcMin: HC_MIN, hcMax: HC_MAX, bordV3: BORD_V3,
    canon: { y: CAN_Y, el: CAN_EL, d: CAN_D, course: CAN_COURSE, horsFace: CAN_HF, hauteur: CAN_HZ, z: CAN_Z },
    graal: { base: GR_BASE, h: GR_H, anse: ANSE, xPrise: GX_PRISE, toit: G_TOIT, y: GY },
    fourche: { fxSortie: FX_SORTIE, fxRentree: FX_RENTREE, fzHaut: FZ_HAUT, fzBas: FZ_BAS, dentY: DENT_Y, cao: FO },
    C0: C0
  };
  var api = {
    GEO: GEO, nv: nv, lv: lv, heldFoot: heldFoot, rectPoly: rectPoly, robotPoly: robotPoly, triPoly: triPoly, cannonPoly: cannonPoly, overlap: overlap,
    hullHit: hullHit, hullsHit: hullsHit, convexHull: convexHull, hullPer: hullPer, perimetre: perimetre, robotPtsR: robotPtsR, robotFootprint: robotFootprint,
    actExt: actExt, loadExt: loadExt, actTop: actTop, stoneRect: stoneRect, stoneZc: stoneZc, corridor: corridor, balayage: balayage, normAng: normAng, configurerCourse: configurerCourse, courseVersion: courseVersion,
    nacPtsR: nacPtsR, canonPtsR: canonPtsR, canonReach: canonReach, fourchePtsR: fourchePtsR, fourcheZ: fourcheZ, faceToRobot: faceToRobot, toTable: toTable, cState: cState
  };
  root.GEOM = api;
  root.GEO = GEO; root.nv = nv; root.lv = lv;
  root.heldFoot = heldFoot; root.rectPoly = rectPoly; root.robotPoly = robotPoly; root.triPoly = triPoly; root.cannonPoly = cannonPoly; root.overlap = overlap;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
