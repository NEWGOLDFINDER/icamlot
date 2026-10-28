/* Catalogue v3 des macro-actions du réseau, conversion en briques du moteur et masque pur (contrat §4 de docs/CONTRATS.md).

   - Le catalogue est écrit dans le repère de l'équipe (repère jaune) : P1..P10, M1..M5, T1..T4, points de passage W*, stocks S*.
     Pour l'équipe bleue, ACTIONS.realStep applique le miroir (ids et coordonnées) avant d'envoyer la brique au moteur.
   - toProgramStep(act, belief) renvoie LA brique de programme de l'action (repère de l'équipe). ENV.step exécute exactement
     cette brique ; env.program() l'enregistre ; ENGINE.simulate la rejoue à l'identique.
   - maskBelief(belief, catalogue) : fonction pure de la croyance (voir ENV.BELIEF_DOC dans engine/env.js).
     Masque = préconditions du moteur (réécrites sur la croyance, mêmes règles que sim.preconditions) + atteignabilité
     (pose d'approche dans la table, passage sur une grille d'occupation) + règlement (Graal confiné au château).
     Aucune règle de stratégie.
   Temps masqué automatique (contrat §7.1) : toutes les briques qui le permettent portent tm: true ; le moteur choisit le
   moment (pendant le trajet, en fin de trajet, avant de partir, ou sur place). */
(function (root) {
  var CATALOGUE_VERSION = 'icamlot-catalogue-3.0';
  var FACES = ['A', 'B'];
  var PACKS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'];
  var MURS = ['M1', 'M2', 'M3', 'M4', 'M5'];
  var TOURS = ['T1', 'T2', 'T3', 'T4'];
  var COTES = ['ext', 'int'];
  var ANGLES = [0, 90, 180];

  /* Hypothèses (paramètres nommés ; aucune de ces valeurs n'est dans spec/*.json). */
  var HYPOTHESES = {
    /* points de passage (repère jaune) : carrefours dégagés des paquets au départ, vérifiés dans le moteur (tests/test_engine.js) */
    waypoints: [
      { id: 'W1', x: 1050, y: 350, label: 'couloir nord, sortie du château' },
      { id: 'W2', x: 1050, y: 1650, label: 'couloir sud, sortie du château' },
      { id: 'W3', x: 1100, y: 1000, label: 'devant la façade (M3)' },
      { id: 'W4', x: 1500, y: 1000, label: 'centre de la table' },
      { id: 'W5', x: 500, y: 1000, label: 'cour du château' },
      { id: 'W6', x: 1950, y: 350, label: 'couloir nord adverse' },
      { id: 'W7', x: 1950, y: 1650, label: 'couloir sud adverse' },
      { id: 'W8', x: 1900, y: 1000, label: 'devant la façade adverse' }
    ],
    /* points de stockage dans la cour (hors zones de construction et hors salle du trône), pierres à plat, grand axe selon
       ang (PRE.deposer teste le stockage avec les empreintes de la pose réelle depuis le chantier moteur-2). */
    stocks: [
      { id: 'S1', x: 300, y: 680, ang: 0, label: 'cour nord' },
      { id: 'S2', x: 300, y: 1320, ang: 0, label: 'cour sud' }
    ],
    /* grille d'atteignabilité : pas de 40 mm (celui du planificateur du moteur), robot assimilé à un disque de rayon
       rayonPassage (sans charge) ou rayonPassageCharge (au moins une pierre tenue) pour traverser une case */
    grille: 40,
    rayonPassage: 175,
    rayonPassageCharge: 215,
    /* tolérance d'arrivée : une case atteinte à moins de cette distance du point de recul suffit */
    toleranceArrivee: 80,
    /* robot « coincé » (en contact, ou aucun déplacement de pasCoince mm sans contact) : le planificateur du moteur ne trouve
       alors aucun passage (mesuré) ; les actions avec trajet sont masquées */
    pasCoince: 20,
    /* atteignabilité : 'grille' (A* sur la grille du planificateur, robot exact au cap d'arrivée) ou 'disque' (rapide, approché) */
    planification: 'grille',
    planMax: 4000,
    /* case libre : sans contact avec cette tolérance (mm, négative = marge exigée) ; le moteur vérifie ensuite le tracé au mm */
    margeGrille: 1,
    viaRotationEssais: 6,
    /* autour de la pose de départ (mm), le robot peut passer par des cases aussi dégagées que la sienne */
    zoneDepart: 250
  };
  var WAYPOINTS_INFO = HYPOTHESES.waypoints;
  var STOCKS = HYPOTHESES.stocks;

  var FAMILLES = [
    { id: 'prendre', label: 'Prendre une pile (3 pierres) à une carrière', n: 20 },
    { id: 'prendrePartiel', label: 'Prendre 1 ou 2 pierres du dessus d\'une carrière', n: 40 },
    { id: 'mur', label: 'Poser un mur', n: 20 },
    { id: 'tour', label: 'Poser une tour (pierre d\'une rangée)', n: 24 },
    { id: 'porte', label: 'Construire une porte (linteau = rangée 3)', n: 20 },
    { id: 'tir', label: 'Séance de tir (canon, face C)', n: 1 },
    { id: 'monterGraal', label: 'Monter le Graal sur le toit (ascenseur, face C)', n: 1 },
    { id: 'trone', label: 'Aller dans la salle du trône', n: 1 },
    { id: 'attendre', label: 'Finir le match sur place (attendre 100 s)', n: 1 },
    { id: 'stockage', label: 'Stocker / reprendre des pierres dans la cour (3 au plus)', n: 8 },
    { id: 'traj', label: 'Aller à un point de passage', n: 8 },
    { id: 'preparerPince', label: 'Préparer la pince (angle, pendant le trajet suivant)', n: 6 },
    { id: 'lacher', label: 'Lâcher les pierres sur place', n: 2 }
  ];

  function buildAll() {
    var out = [];
    function add(o) { o.i = out.length; out.push(o); }
    FACES.forEach(function (f) { PACKS.forEach(function (p) { add({ famille: 'prendre', a: 'prendre', mode: 'pile', f: f, p: p, label: 'Prendre la pile ' + p + ' · face ' + f }); }); });
    FACES.forEach(function (f) {
      PACKS.forEach(function (p) {
        add({ famille: 'prendrePartiel', a: 'prendre', mode: 'deux', f: f, p: p, label: 'Prendre 2 pierres du dessus de ' + p + ' · face ' + f });
        add({ famille: 'prendrePartiel', a: 'prendre', mode: 'pierre', f: f, p: p, label: 'Prendre la pierre du dessus de ' + p + ' · face ' + f });
      });
    });
    FACES.forEach(function (f) { MURS.forEach(function (z) { COTES.forEach(function (side) { add({ famille: 'mur', a: 'mur', f: f, z: z, side: side, label: 'Mur ' + z + ' · ' + side + ' · face ' + f }); }); }); });
    FACES.forEach(function (f) { TOURS.forEach(function (z) { [1, 2, 3].forEach(function (r) { add({ famille: 'tour', a: 'tour', f: f, z: z, rang: r, label: 'Tour ' + z + ' · pierre de la rangée ' + r + ' · face ' + f }); }); }); });
    FACES.forEach(function (f) { MURS.forEach(function (z) { COTES.forEach(function (side) { add({ famille: 'porte', a: 'porte', f: f, z: z, side: side, label: 'Porte ' + z + ' · ' + side + ' · face ' + f }); }); }); });
    add({ famille: 'tir', a: 'tir', label: 'Séance de tir des boulets' });
    add({ famille: 'monterGraal', a: 'monterGraal', label: 'Monter le Graal sur le toit' });
    add({ famille: 'trone', a: 'trone', label: 'Aller dans la salle du trône' });
    add({ famille: 'attendre', a: 'finir', label: 'Finir le match sur place (attendre jusqu\'à 100 s)' });
    FACES.forEach(function (f) { STOCKS.forEach(function (s) { add({ famille: 'stockage', a: 'stocker', f: f, stock: s.id, label: 'Stocker la charge de la face ' + f + ' en ' + s.id + ' (' + s.label + ')' }); }); });
    FACES.forEach(function (f) { STOCKS.forEach(function (s) { add({ famille: 'stockage', a: 'reprendre', f: f, stock: s.id, label: 'Reprendre les pierres de ' + s.id + ' · face ' + f }); }); });
    WAYPOINTS_INFO.forEach(function (w) { add({ famille: 'traj', a: 'traj', w: w.id, label: 'Aller en ' + w.id + ' (' + w.label + ', ' + w.x + ', ' + w.y + ')' }); });
    FACES.forEach(function (f) { ANGLES.forEach(function (r) { add({ famille: 'preparerPince', a: 'preparer', f: f, r: r, label: 'Préparer la pince ' + f + ' à ' + r + '° (pendant le trajet suivant)' }); }); });
    FACES.forEach(function (f) { add({ famille: 'lacher', a: 'lacher', f: f, label: 'Lâcher la charge de la face ' + f + ' sur place' }); });
    return out;
  }
  var ALL = buildAll();
  (function () {
    var n = 0; FAMILLES.forEach(function (F) { var k = ALL.filter(function (a) { return a.famille === F.id; }).length; if (k !== F.n) throw new Error('Famille ' + F.id + ' : ' + k + ' actions au lieu de ' + F.n + '.'); n += k; });
    if (n !== ALL.length) throw new Error('Catalogue incohérent.');
  })();

  function filterByFamilles(familles) {
    var set = {};
    (familles || FAMILLES.map(function (f) { return f.id; })).forEach(function (id) { set[id] = true; });
    return ALL.filter(function (a) { return set[a.famille]; });
  }

  /* ------------------------------------------------------------------ outils géométriques purs */
  function E() { return root.ENGINE; }
  function G() { return root.GEOM; }
  var D2R = Math.PI / 180;
  function nv(a) { return [Math.cos(a * D2R), Math.sin(a * D2R)]; }
  function lv(a) { return [-Math.sin(a * D2R), Math.cos(a * D2R)]; }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function centroid(P) { var c = [0, 0]; P.forEach(function (v) { c[0] += v[0] / P.length; c[1] += v[1] / P.length; }); return c; }
  function ptSegD(p, a, b) { var dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
  function ptPolyD(p, P) { if (E().inPoly(p[0], p[1], P)) return 0; var d = 1e9; for (var i = 0; i < P.length; i++) d = Math.min(d, ptSegD(p, P[i], P[(i + 1) % P.length])); return d; }
  function mirX(x, team) { return team === 'blue' ? 3000 - x : x; }
  function mirId(id, team) {
    if (team !== 'blue' || id == null) return id;
    var s = String(id);
    if (s.indexOf('.') >= 0) return E().mirrorId(s.split('.')[0]) + '.' + s.split('.')[1];
    return E().mirrorId(s);
  }
  function packIndex(pid) { var k = -1; E().PK.forEach(function (pk, i) { if (pk.id === pid) k = i; }); return k; }
  function packFoot(pk) { return G().rectPoly({ cx: pk.x, cy: pk.y, hl: 160, hn: 55, ang: pk.tan + 90 }); }
  function geo() { return G().GEO; }
  function zOk(hc) { return hc >= geo().hcMin - 0.5 && hc <= geo().hcMax + 0.5; }
  function ZTR() { return root.SPEC.regles.remparts_jaune.tour_diametre / 2; }
  function STOCK_MAX() { return root.SPEC.regles.construction.stockage_max_cour; }

  /* ------------------------------------------------------------------ lecture de la croyance (repère réel) */
  function heldList(b, f) { var sl = (b.pinces[f] && b.pinces[f].slots) || [null, null, null]; var out = []; sl.forEach(function (id, l) { if (id) out.push({ id: id, sl: l }); }); return out; }
  function heldMask(b, f) { var m = 0; heldList(b, f).forEach(function (x) { m |= 1 << x.sl; }); return m; }
  function packN(b, pid) { var p = b.paquets && b.paquets[pid]; return p ? p.n : 3; }
  /* pierres « au sol » connues : pierres de carrière présentes (croyance) et pierres posées par ce robot */
  function homeStones(b) {
    var out = [];
    E().PK.forEach(function (pk, i) {
      var n = packN(b, pk.id), foot = packFoot(pk);
      for (var l = 0; l < n; l++) out.push({ id: pk.id + '.' + (l + 1), pk: i, foot: foot, bottom: 110 * l, top: 110 * l + 110, vertical: false, home: true, c: [pk.x, pk.y], tan: pk.tan });
    });
    return out;
  }
  function ownStones(b) { return (b.pierres || []).map(function (s) { var c = centroid(s.foot); return Object.assign({ c: c }, s); }); }
  function groundStones(b) { return homeStones(b).concat(ownStones(b)); }
  function coveredBy(st, all) {
    for (var i = 0; i < all.length; i++) { var o = all[i]; if (o.id === st.id) continue; if (o.bottom >= st.top - 1 && G().overlap(st.foot, o.foot, 1)) return o.id; }
    return null;
  }
  function stoneById(b, id) { var all = groundStones(b); for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i]; return null; }
  function stackAxis(st) {
    if (st.home) return { c: st.c, tan: st.tan };
    var P = st.foot, e0 = dist(P[0], P[1]), e1 = dist(P[1], P[2]), a = e0 >= e1 ? [P[0], P[1]] : [P[1], P[2]];
    return { c: st.c, tan: Math.atan2(a[1][1] - a[0][1], a[1][0] - a[0][0]) / D2R };
  }
  function inAnyZone(foot) {
    var en = E(), i;
    for (i = 0; i < en.ZM.length; i++) if (G().overlap(foot, en.zoneRect(en.ZM[i]), 0)) return true;
    for (i = 0; i < en.ZT.length; i++) if (ptPolyD(en.ZT[i].c, foot) < ZTR()) return true;
    return false;
  }
  function ownCour(team) { return team === 'blue' ? E().COUR_B : E().COUR; }
  function stored(foot, team) { var c = centroid(foot); return E().inPoly(c[0], c[1], ownCour(team)) && !inAnyZone(foot); }
  function stockCount(b) { return (b.pierres || []).filter(function (s) { return stored(s.foot, b.team); }).length; }
  function zoneTakenB(b, zid) {
    var z = E().zoneById(zid); if (!z) return 'Zone inconnue.';
    var hit = (b.pierres || []).concat(b.etrangeres || []).some(function (s) { var c = centroid(s.foot); return z.tan !== undefined ? E().inPoly(c[0], c[1], E().zoneRect(z)) : dist(c, z.c) < ZTR(); });
    return hit ? 'La zone ' + zid + ' est déjà occupée (une construction par zone, E.1).' : null;
  }
  function robotPose(b) { return { x: b.pose.x, y: b.pose.y, h: b.pose.h, A: { hc: b.pinces.A.hc, rot: b.pinces.A.rot, vac: [0, 0, 0] }, B: { hc: b.pinces.B.hc, rot: b.pinces.B.rot, vac: [0, 0, 0] } }; }
  function heldFootAt(b, f, sl) { return G().rectPoly(G().heldFoot(robotPose(b), f === 'A' ? 0 : 1, sl)); }
  var BAL = {};
  function balayageOk(mask, ch, a0, a1) {
    if (Math.abs(a0 - a1) <= 0.5) return true;
    var k = mask + '|' + (ch ? 1 : 0) + '|' + a0.toFixed(1) + '|' + a1.toFixed(1);
    if (BAL[k] == null) BAL[k] = G().balayage(mask, ch, a0, a1).ok;
    return BAL[k];
  }

  /* ------------------------------------------------------------------ préconditions sur la croyance
     Mêmes règles que sim.preconditions (engine.js, PRE), brique en repère réel. Renvoie null ou la raison. */
  function preBelief(st, b) {
    if (!st) return 'Action non résolue.';
    var f = st.f, hs, why;
    switch (st.a) {
      case 'prendre':
        if (f !== 'A' && f !== 'B') return 'Face inconnue (A ou B).';
        if (heldList(b, f).length) return 'La face ' + f + ' tient déjà quelque chose.';
        if (st.mode === 'pierre' || st.mode === 'deux') return prePierreB(st, b).why;
        return prePileB(st, b);
      case 'mur':
        hs = heldList(b, f);
        if (!E().zoneById(st.z) || E().zoneById(st.z).tan === undefined) return 'Zone de mur inconnue.';
        if (hs.length !== 3 || (b.pinces[f].rot !== 0 && b.pinces[f].rot !== 180)) return 'Il faut une pile de 3 pierres à plat sur la face ' + f + '.';
        return zoneTakenB(b, st.z);
      case 'tour':
        if (!E().zoneById(st.z) || E().zoneById(st.z).tan !== undefined) return 'Zone de tour inconnue.';
        if (!heldList(b, f).some(function (x) { return x.id === st.s; })) return 'La pierre ' + st.s + ' n\'est pas tenue par la face ' + f + '.';
        if (!balayageOk(heldMask(b, f), true, b.pinces[f].rot, 90)) return 'Rotation impossible sous 350 mm.';
        return zoneTakenB(b, st.z);
      case 'porte':
        hs = heldList(b, f);
        if (!E().zoneById(st.z) || E().zoneById(st.z).tan === undefined) return 'Zone de mur inconnue.';
        if (!(hs.length === 3 && hs.every(function (x, i) { return x.sl === i; })) || b.pinces[f].rot !== 0) return 'Il faut une pile de 3 pierres à plat sur la face ' + f + ' (rangées 1, 2 et 3).';
        var cas = E().inPoly(E().zoneById(st.z).c[0], E().zoneById(st.z).c[1], E().CASTLE) ? 'jaune' : 'bleu';
        if ((b.portes || []).some(function (id) { var z = E().zoneById(id); return z && (E().inPoly(z.c[0], z.c[1], E().CASTLE) ? 'jaune' : 'bleu') === cas; })) return 'Une seule porte par château (E.1.b).';
        return zoneTakenB(b, st.z);
      case 'tir': case 'boulets':
        if (b.tir) return 'La séance de tir a déjà eu lieu.';
        if (b.t >= E().MATCH) return 'Tir impossible : le match est terminé.';
        if (!(Math.round(b.params && b.params.bn != null ? b.params.bn : 10) > 0)) return 'Aucun boulet à tirer.';
        return null;
      case 'monterGraal':
        if (b.graal !== 'home') return 'Le Graal n\'est plus à son départ.';
        if (!E().inPoly(b.pose.x, b.pose.y, E().castleOf(b.team))) return 'Monter le Graal : le robot doit être dans son château.';
        if (Math.abs(b.meca.fx - geo().fourche.fxRentree) > 0.5 || Math.abs(b.meca.fz - geo().fourche.fzHaut) > 0.5) return 'Monter le Graal : la fourche n\'est pas rangée.';
        return null;
      case 'deposer':
        hs = heldList(b, f);
        var rot = st.r != null ? +st.r : 0;
        if ([0, 90, 180].indexOf(rot) < 0) return 'Angle de pince : 0, 90 ou 180°.';
        if (!hs.length) return 'La face ' + f + ' ne tient aucune pierre.';
        if (rot !== 90 && !contiguous(hs)) return 'Pile à plat impossible : il manque une pierre au milieu de la pince.';
        if (!balayageOk(heldMask(b, f), st.tm ? true : heldInCastleB(b, f), b.pinces[f].rot, rot)) return 'Rotation impossible sous 350 mm.';
        /* hauteur d'axe qui pose la pierre la plus basse au sol (comme le moteur) : dans la course de la pince ? */
        var cs = Math.cos(rot * D2R), sls = hs.map(function (x) { return x.sl; }), lLow = cs > 0 ? Math.min.apply(null, sls) : Math.max.apply(null, sls);
        if (rot !== 90 && !zOk(55 - G().stoneZc(lLow) * cs)) return 'Dépôt au sol : pince hors de sa course pour la rangée ' + (lLow + 1) + '.';
        var feet = depositFeetB(b, f, hs, [+st.x, +st.y], +st.ang || 0, rot);
        why = stockPreB(b, feet); if (why) return why;
        /* place libre : une pierre déjà au point de dépôt mettrait la pince hors de sa course */
        if (groundStones(b).some(function (o) { return feet.some(function (ft) { return G().overlap(ft, o.foot, 1); }); })) return 'Point de dépôt occupé.';
        return null;
      case 'lacher': case 'deposerZone':
        hs = heldList(b, f);
        if (!hs.length) return 'La face ' + f + ' ne tient aucune pierre.';
        if (Math.abs(Math.cos(b.pinces[f].rot * D2R)) >= 0.5 && !contiguous(hs)) return 'Lâcher : il manque une pierre au milieu de la pince.';
        return stockPreB(b, hs.map(function (x) { return heldFootAt(b, f, x.sl); }));
      case 'tourner':
        var r = +st.r;
        if ([0, 90, 180].indexOf(r) < 0) return 'Angle de pince : 0, 90 ou 180°.';
        if (!balayageOk(heldMask(b, f), st.tm ? true : heldInCastleB(b, f), b.pinces[f].rot, r)) return 'Rotation impossible sous 350 mm.';
        /* en temps masqué, la rotation a lieu pendant le prochain trajet, peut-être hors du château : elle doit y être faisable */
        if (st.tm && !balayageOk(heldMask(b, f), false, b.pinces[f].rot, r)) return 'Rotation impossible sous 350 mm hors du château (préparation pendant un trajet).';
        return null;
      case 'traj': case 'seDeplacer': case 'trone': case 'attendre': case 'attendreJusqua':
        return null;
      default:
        return 'Action inconnue.';
    }
  }
  /* empreintes des pierres déposées en T (comme depositFeet du moteur : face de normale ang - 90, grand axe selon ang) */
  function depositFeetB(b, f, hs, T, ang, rot) {
    var q = poseOf(b, 0, 0, ang - 90 - 120 * fk(f)), cx = 0, cy = 0; q[f] = { hc: 165, rot: rot, vac: [0, 0, 0] };
    var fos = hs.map(function (x) { return G().heldFoot(q, fk(f), x.sl); });
    fos.forEach(function (fo) { cx += fo.cx / fos.length; cy += fo.cy / fos.length; });
    return fos.map(function (fo) { return G().rectPoly({ cx: fo.cx + T[0] - cx, cy: fo.cy + T[1] - cy, hl: fo.hl, hn: fo.hn, ang: fo.ang }); });
  }
  function contiguous(hs) { var sl = hs.map(function (x) { return x.sl; }); return Math.max.apply(null, sl) - Math.min.apply(null, sl) + 1 === hs.length; }
  /* pierres tenues par f dans un château (n'importe lequel, comme heldInCastle du moteur) */
  function heldInCastleB(b, f) {
    return heldList(b, f).every(function (x) { return heldFootAt(b, f, x.sl).every(function (v) { return E().inPoly(v[0], v[1], E().CASTLE) || E().inPoly(v[0], v[1], E().CASTLE_B); }); });
  }
  function stockPreB(b, feet) {
    var n = feet.filter(function (ft) { return stored(ft, b.team); }).length, k = stockCount(b);
    if (n && k + n > STOCK_MAX()) return 'Stockage : ' + (k + n) + ' pierres dans la cour hors des zones de construction (' + STOCK_MAX() + ' au plus, E.1.b).';
    return null;
  }
  function prePileB(st, b) {
    var idx = packIndex(st.p); if (idx < 0) return 'Paquet inconnu.';
    var pk = E().PK[idx], all = groundStones(b);
    if (packN(b, pk.id) === 3) {
      var top = { id: pk.id + '.3', foot: packFoot(pk), top: 330 };
      var on = coveredBy(top, all); if (on) return 'Le paquet ' + st.p + ' n\'est pas dégagé : ' + on + ' est posé dessus.';
      return null;
    }
    /* pile reconstituée : les 3 pierres du paquet posées ensemble par ce robot, à plat */
    var mine = ownStones(b).filter(function (s) { return s.pk === idx; }).sort(function (a, c) { return a.bottom - c.bottom; });
    if (mine.length !== 3 || packN(b, pk.id) !== 0) return 'Le paquet ' + st.p + ' n\'est plus complet (croyance).';
    if (!mine.every(function (s) { return s.grp === mine[0].grp && !s.vertical; })) return 'Les pierres de ' + st.p + ' ne sont plus empilées.';
    var on2 = coveredBy(mine[2], all);
    if (on2) return 'Le paquet ' + st.p + ' n\'est pas dégagé : ' + on2 + ' est posé dessus.';
    if (!zOk(mine[0].bottom + 165)) return 'Prise de ' + st.p + ' : pince hors de sa course.';
    return null;
  }
  function prePierreB(st, b) {
    var x = stoneById(b, st.s), two = st.mode === 'deux';
    if (!x) return { why: 'Pierre ' + st.s + ' absente (croyance).' };
    if (x.vertical) return { why: 'La pierre ' + x.id + ' est debout.' };
    var all = groundStones(b), on = coveredBy(x, all);
    if (on) return { why: 'La pierre ' + x.id + ' n\'est pas sur le dessus (' + on + ' est posé dessus).' };
    var gl = x;
    if (two) {
      var under = all.filter(function (o) { return o.id !== x.id && Math.abs(o.top - x.bottom) < 1 && G().overlap(x.foot, o.foot, 1); });
      if (under.length !== 1) return { why: 'Prendre deux pierres : rien (ou plusieurs pierres) sous ' + x.id + '.' };
      var y = under[0], ax = stackAxis(x), ay = stackAxis(y), da = Math.abs(((ay.tan - ax.tan) % 180 + 180) % 180);
      if (y.vertical || dist(ax.c, ay.c) > 10 || Math.min(da, 180 - da) > 3) return { why: 'Prendre deux pierres : pierres non alignées.' };
      gl = y;
    }
    var lmax = two ? 1 : 2, ok = false;
    for (var l = 0; l <= lmax; l++) if (zOk(gl.bottom + 55 - G().stoneZc(l))) ok = true;
    return ok ? { why: null } : { why: 'Prise de ' + x.id + ' : pince hors de sa course.' };
  }

  /* ------------------------------------------------------------------ résolution d'une action en brique */
  function stockById(id) { for (var i = 0; i < STOCKS.length; i++) if (STOCKS[i].id === id) return STOCKS[i]; return null; }
  function wpById(id) { for (var i = 0; i < WAYPOINTS_INFO.length; i++) if (WAYPOINTS_INFO[i].id === id) return WAYPOINTS_INFO[i]; return null; }
  /* pierres posées par ce robot sur un point de stockage (repère réel), de bas en haut */
  function stockStack(b, sid) {
    var s = stockById(sid); if (!s) return [];
    var c = [mirX(s.x, b.team), s.y];
    return ownStones(b).filter(function (o) { return dist(o.c, c) < 40; }).sort(function (a, d) { return a.bottom - d.bottom; });
  }
  function ownStoneId(id, team) { return mirId(id, team); }

  /* Brique de programme de l'action (repère de l'équipe, comme une stratégie écrite pour le jaune), ou null si l'action
     ne désigne rien dans cet état (pile vide, rangée vide...). belief est la croyance (repère réel). */
  function toProgramStep(act, b) {
    var team = (b && b.team) || 'yellow';
    switch (act.a) {
      case 'prendre':
        if (act.mode === 'pile') return { a: 'prendre', f: act.f, p: act.p, tm: true };
        var n = packN(b, mirId(act.p, team));
        if (n < (act.mode === 'deux' ? 2 : 1)) return null;
        return { a: 'prendre', f: act.f, mode: act.mode, s: act.p + '.' + n, tm: true };
      case 'mur': return { a: 'mur', f: act.f, z: act.z, side: act.side };
      case 'tour':
        var id = (b.pinces[act.f].slots || [])[act.rang - 1];
        if (!id) return null;
        return { a: 'tour', f: act.f, z: act.z, s: ownStoneId(id, team), tm: true };
      case 'porte': return { a: 'porte', f: act.f, z: act.z, side: act.side };
      case 'tir': return { a: 'tir' };
      case 'monterGraal': return { a: 'monterGraal' };
      case 'trone': return { a: 'trone' };
      case 'finir': return { a: 'attendreJusqua', sec: E().MATCH };
      case 'traj': var w = wpById(act.w); return { a: 'seDeplacer', x: w.x, y: w.y };
      case 'preparer': return { a: 'tourner', f: act.f, r: act.r, tm: true };
      case 'lacher': return { a: 'deposerZone', f: act.f, q: 'pile' };
      case 'stocker':
        /* pose à plat au sol : à 0° si la rangée 1 est tenue, sinon retournée à 180° si la rangée 3 l'est (la pierre la plus basse touche le sol) */
        var s = stockById(act.stock), sl = (b.pinces[act.f].slots || []), r0 = sl[0] || !sl[2] ? 0 : 180;
        return { a: 'deposer', f: act.f, q: 'pile', x: s.x, y: s.y, ang: s.ang, r: r0, tm: true };
      case 'reprendre':
        var stk = stockStack(b, act.stock);
        if (!stk.length) return null;
        var topS = stk[stk.length - 1];
        if (stk.length === 3 && stk.every(function (o) { return o.pk === topS.pk && o.grp === topS.grp; }) && packN(b, E().PK[topS.pk].id) === 0) return { a: 'prendre', f: act.f, p: ownStoneId(E().PK[topS.pk].id, team), tm: true };
        return { a: 'prendre', f: act.f, mode: stk.length >= 2 ? 'deux' : 'pierre', s: ownStoneId(topS.id, team), tm: true };
    }
    return null;
  }

  /* Brique en repère réel (envoyée au moteur) : ids en miroir et coordonnées de dépôt / trajectoire en miroir pour le bleu.
     seDeplacer est déjà mis en miroir par le moteur (repère de l'équipe). */
  function realStep(st, team) {
    if (!st || team !== 'blue') return st;
    /* ENGINE.mirrorStep met aussi en miroir deposer.x/ang et les points de traj (chantier moteur-2) */
    return E().mirrorStep(st);
  }

  /* même brique, au temps masqué près (tm est ajouté automatiquement par le catalogue) */
  function sameStep(a, b) {
    if (!a || !b) return false;
    var ka = Object.keys(a).filter(function (k) { return k !== 'tm'; }), kb = Object.keys(b).filter(function (k) { return k !== 'tm'; });
    if (ka.length !== kb.length) return false;
    return ka.every(function (k) { return JSON.stringify(a[k]) === JSON.stringify(b[k]); });
  }

  /* Index de l'action du catalogue dont la brique est celle du programme (au temps masqué près), -1 sinon. */
  function indexOfStep(st, b, catalogue) {
    catalogue = catalogue || ALL;
    if (!st) return -1;
    var norm = Object.assign({}, st);
    if (norm.a === 'boulets') norm.a = 'tir';
    if (norm.a === 'lacher') { norm.a = 'deposerZone'; if (norm.q == null) norm.q = 'pile'; }
    if (norm.a === 'deposerZone' && norm.q == null) norm.q = 'pile';
    if (norm.a === 'attendreJusqua' && +norm.sec >= E().MATCH) norm.sec = E().MATCH;
    for (var i = 0; i < catalogue.length; i++) {
      var act = catalogue[i];
      if (!quickMatch(act, norm)) continue;
      var c = toProgramStep(act, b);
      if (c && sameStep(c, norm)) return i;
    }
    return -1;
  }
  function quickMatch(act, st) {
    var a = act.a;
    if (st.a === 'prendre') return (a === 'prendre' || a === 'reprendre') && act.f === st.f;
    if (st.a === 'mur' || st.a === 'porte') return a === st.a && act.f === st.f && act.z === st.z;
    if (st.a === 'tour') return a === 'tour' && act.f === st.f && act.z === st.z;
    if (st.a === 'tir') return a === 'tir';
    if (st.a === 'attendreJusqua') return a === 'finir';
    if (st.a === 'seDeplacer') return a === 'traj';
    if (st.a === 'tourner') return a === 'preparer' && act.f === st.f;
    if (st.a === 'deposerZone') return a === 'lacher' && act.f === st.f;
    if (st.a === 'deposer') return a === 'stocker' && act.f === st.f;
    return a === st.a;
  }

  /* ------------------------------------------------------------------ contacts à une pose (portage 2D de hits() du moteur)
     Corps : châssis (exact), nacelles A/B, canon, ascenseur (enveloppe convexe), pierres tenues ; obstacles : pierres au sol
     (carrières crues présentes, pierres posées par ce robot), Graal à son départ, pierres étrangères connues, bords de table,
     (l'adversaire n'est jamais pris en compte : décision §9, c'est au réseau d'apprendre à l'éviter). Hauteurs comparées comme le moteur (un corps passe au-dessus d'une pierre plus basse). */
  function gripOf(b, f) { return { hc: b.pinces[f].hc, rot: b.pinces[f].rot, vac: [0, 0, 0] }; }
  function poseOf(b, x, y, h, over) {
    var p = { x: x, y: y, h: h, A: gripOf(b, 'A'), B: gripOf(b, 'B'), C: { can: b.meca.can, fx: b.meca.fx, fz: b.meca.fz } };
    if (over) ['A', 'B', 'C'].forEach(function (k) { if (over[k]) p[k] = Object.assign({}, p[k], over[k]); });
    return p;
  }
  /* corps dans le repère robot pour un état des pinces et de la face C (mis en cache par appel du masque) */
  function bodiesR(b, p, cache) {
    var key = [p.A.hc, p.A.rot, p.B.hc, p.B.rot, p.C.can, p.C.fx, p.C.fz].join(',');
    var bc = cache ? (cache.bodies = cache.bodies || {}) : {};
    if (bc[key]) return bc[key];
    var L = [], Gm = G(), GE = geo(), O = { x: 0, y: 0, h: 0, A: p.A, B: p.B, C: p.C };
    ['A', 'B'].forEach(function (f, k) { var g = p[f], e = Gm.actExt(g.rot); L.push({ P: Gm.nacPtsR(k, g, e.umax), z0: g.hc + e.zmin, z1: g.hc + e.zmax }); });
    var cp = Gm.canonPtsR(p.C.can); if (cp) L.push({ P: cp, z0: GE.canon.z[0], z1: GE.canon.z[1] });
    var fz = Gm.fourcheZ(p.C.fz); L.push({ P: Gm.convexHull(Gm.fourchePtsR(p.C.fx)), z0: fz[0], z1: fz[1] });
    ['A', 'B'].forEach(function (f, k) {
      var g = p[f];
      heldList(b, f).forEach(function (x) {
        var th = g.rot * D2R, zc = g.hc + Gm.stoneZc(x.sl) * Math.cos(th), hz = 160 * Math.abs(Math.sin(th)) + 55 * Math.abs(Math.cos(th));
        L.push({ P: Gm.rectPoly(Gm.heldFoot(O, k, x.sl)), z0: zc - hz, z1: zc + hz });
      });
    });
    var BR = geo().R;
    L.forEach(function (q) { q.r = 0; q.P.forEach(function (v) { q.r = Math.max(q.r, Math.hypot(v[0], v[1])); }); BR = Math.max(BR, q.r); });
    return (bc[key] = { L: L, BR: BR });
  }
  function obstacleList(b, cache) {
    if (cache && cache.obs) return cache.obs;
    var obs = groundStones(b).map(function (s) { return { id: s.id, foot: s.foot, bottom: s.bottom, top: s.top }; });
    (b.etrangeres || []).forEach(function (s, i) { obs.push({ id: s.id || 'etrangere' + i, foot: s.foot, bottom: s.bottom || 0, top: s.top || 330 }); });
    if (b.graal === 'home' && b.params && b.params.gx != null) obs.push({ id: 'graal', foot: E().graalPoly([b.params.gx, b.params.gy], b.params.ga || 0), bottom: 0, top: geo().graal.h });
    obs.forEach(function (o) { var c = centroid(o.foot), r = 0; o.foot.forEach(function (v) { r = Math.max(r, dist(v, c)); }); o.c = c; o.rad = r; });
    if (cache) cache.obs = obs;
    return obs;
  }
  function inTableP(P, m) { return P.every(function (v) { return v[0] >= -m && v[0] <= 3000 + m && v[1] >= -m && v[1] <= 2000 + m; }); }
  /* premier contact (id) du robot à la pose p, ou null ; excl : ids d'obstacles ignorés ; tol : pénétration tolérée (mm) */
  function poseHit(b, p, excl, cache, tol) {
    tol = tol == null ? 1 : tol;
    var Gm = G(), B = bodiesR(b, p, cache), L = B.L, BR = B.BR, BORD = geo().bordure, i, j, T = [];
    function tab(k) { return T[k] || (T[k] = Gm.toTable(L[k].P, p)); }
    if (p.x < BR + 1 || p.x > 2999 - BR || p.y < BR + 1 || p.y > 1999 - BR) {
      if (!inTableP(Gm.robotPoly(p), 1)) return 'bord de table';
      for (i = 0; i < L.length; i++) if (L[i].z0 < BORD && !inTableP(tab(i), 1)) return 'bord de table';
    }
    var obs = obstacleList(b, cache), mg = Math.max(0, -tol), R0 = geo().R;
    for (j = 0; j < obs.length; j++) {
      var o = obs[j], dx = o.c[0] - p.x, dy = o.c[1] - p.y, rr = BR + o.rad + mg;
      if (dx * dx + dy * dy >= rr * rr) continue;
      if (excl && excl.indexOf(o.id) >= 0) continue;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < R0 + o.rad + mg && Gm.hullHit(p, o.foot, tol)) return o.id;
      for (i = 0; i < L.length; i++) {
        var q = L[i];
        if (q.z0 >= o.top - 1 || q.z1 <= o.bottom + 1 || d >= q.r + o.rad + mg) continue;
        if (Gm.overlap(tab(i), o.foot, tol)) return o.id;
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ atteignabilité : grille de dégagement (disque) */
  function reachOf(b, cache) {
    if (cache && cache.reach) return cache.reach;
    var H = HYPOTHESES, C = H.grille, GW = Math.ceil(3000 / C), GH = Math.ceil(2000 / C), N = GW * GH;
    var loaded = heldList(b, 'A').length + heldList(b, 'B').length > 0, R = loaded ? H.rayonPassageCharge : H.rayonPassage;
    var clr = new Float32Array(N), obs = obstacleList(b, cache), i, j, k;
    for (j = 0; j < GH; j++) for (i = 0; i < GW; i++) { var x = (i + 0.5) * C, y = (j + 0.5) * C; clr[j * GW + i] = Math.min(x, y, 3000 - x, 2000 - y); }
    obs.forEach(function (o) {
      var reach = R + o.rad + C, i0 = Math.max(0, Math.floor((o.c[0] - reach) / C)), i1 = Math.min(GW - 1, Math.floor((o.c[0] + reach) / C));
      var j0 = Math.max(0, Math.floor((o.c[1] - reach) / C)), j1 = Math.min(GH - 1, Math.floor((o.c[1] + reach) / C));
      for (var jj = j0; jj <= j1; jj++) for (var ii = i0; ii <= i1; ii++) { var q = [(ii + 0.5) * C, (jj + 0.5) * C], d = ptPolyD(q, o.foot), kk = jj * GW + ii; if (d < clr[kk]) clr[kk] = d; }
    });
    function cellOf(x, y) { return [Math.max(0, Math.min(GW - 1, Math.floor(x / C))), Math.max(0, Math.min(GH - 1, Math.floor(y / C)))]; }
    var sc = cellOf(b.pose.x, b.pose.y), s0 = sc[1] * GW + sc[0], seen = new Uint8Array(N), q = [s0];
    /* près du départ, le robot peut toujours s'éloigner par des cases au moins aussi dégagées que la sienne */
    var startClr = Math.min(R, clr[s0]) - 5, start = [b.pose.x, b.pose.y];
    seen[s0] = 1;
    for (var qi = 0; qi < q.length; qi++) {
      var cur = q[qi], ci = cur % GW, cj = (cur - ci) / GW;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var ni = ci + dx, nj = cj + dy; if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
        k = nj * GW + ni; if (seen[k]) continue;
        var need = Math.hypot((ni + 0.5) * C - start[0], (nj + 0.5) * C - start[1]) < H.zoneDepart ? startClr : R;
        if (clr[k] >= need) { seen[k] = 1; q.push(k); }
      }
    }
    var out = {
      R: R,
      ok: function (x, y, tol) {
        tol = tol == null ? H.toleranceArrivee : tol;
        if (dist([x, y], start) <= tol) return true;
        var c0 = cellOf(x - tol, y - tol), c1 = cellOf(x + tol, y + tol);
        for (var jj = c0[1]; jj <= c1[1]; jj++) for (var ii = c0[0]; ii <= c1[0]; ii++) if (seen[jj * GW + ii] && Math.hypot((ii + 0.5) * C - x, (jj + 0.5) * C - y) <= tol) return true;
        return false;
      }
    };
    if (cache) cache.reach = out;
    return out;
  }
  function fk(f) { return f === 'A' ? 0 : f === 'B' ? 1 : 2; }
  function inCastleAny(x, y) { return E().inPoly(x, y, E().CASTLE) || E().inPoly(x, y, E().CASTLE_B); }
  function footIn(p, Rr) {
    var xs = Rr.map(function (q) { return q[0]; }), ys = Rr.map(function (q) { return q[1]; }), x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    return G().robotFootprint(p).every(function (v) { return v[0] >= x0 - 0.5 && v[0] <= x1 + 0.5 && v[1] >= y0 - 0.5 && v[1] <= y1 + 0.5; });
  }
  /* Poses d'approche candidates, comme le moteur (choose) : { O, h, over (état des pinces / face C à la pose), excl, back: [points de recul] }.
     null = pas de trajet (action sur place). */
  function approaches(act, st, b) {
    var en = E(), team = b.team, out = [], DP = geo().dPierre, z, phi, n, t;
    function cand(O, h, over, excl, backs) { out.push({ O: O, h: h, over: over || null, excl: excl || null, back: backs || [] }); }
    function backN(O, nn, d) { return [[O[0] - d * nn[0], O[1] - d * nn[1]]]; }
    function backAll(O, ph, d) { var nn = nv(ph), tt = lv(ph); return [[O[0] - d * nn[0], O[1] - d * nn[1]], [O[0] + 170 * tt[0] - 8 * nn[0], O[1] + 170 * tt[1] - 8 * nn[1]], [O[0] - 170 * tt[0] - 8 * nn[0], O[1] - 170 * tt[1] - 8 * nn[1]]]; }
    var over = {};
    switch (st.a) {
      case 'prendre':
        var ax = null, excl = [];
        if (st.mode === 'pierre' || st.mode === 'deux') {
          var x = stoneById(b, st.s); if (!x) return out;
          ax = stackAxis(x); excl = [x.id];
          if (st.mode === 'deux') groundStones(b).forEach(function (o) { if (o.id !== x.id && Math.abs(o.top - x.bottom) < 1 && G().overlap(x.foot, o.foot, 1)) excl.push(o.id); });
        } else {
          var idx = packIndex(st.p), mine = ownStones(b).filter(function (s) { return s.pk === idx; });
          if (packN(b, st.p) === 3) { ax = { c: [en.PK[idx].x, en.PK[idx].y], tan: en.PK[idx].tan }; excl = [st.p + '.1', st.p + '.2', st.p + '.3']; }
          else if (mine.length) { ax = stackAxis(mine[0]); excl = mine.map(function (s) { return s.id; }); }
          else return out;
        }
        [ax.tan + 90, ax.tan - 90].forEach(function (p) { n = nv(p); var O = [ax.c[0] - DP * n[0], ax.c[1] - DP * n[1]]; cand(O, p - 120 * fk(st.f), null, excl, backN(O, n, 80)); });
        return out;
      case 'mur':
        z = en.zoneById(st.z); phi = st.side === 'ext' ? z.nin : z.nin + 180; n = nv(phi); t = lv(phi); over[st.f] = { hc: 165 };
        [0, 20, -20, 40, -40].forEach(function (sl) { [0, 20, 40, -20, -40].forEach(function (ac) {
          var Cc = [z.c[0] + sl * t[0] + ac * n[0], z.c[1] + sl * t[1] + ac * n[1]], O = [Cc[0] - DP * n[0], Cc[1] - DP * n[1]];
          cand(O, phi - 120 * fk(st.f), over, null, backAll(O, phi, 85));
        }); });
        return out;
      case 'porte':
        z = en.zoneById(st.z); phi = st.side === 'ext' ? z.nin : z.nin + 180; n = nv(phi); t = lv(phi); over[st.f] = { hc: 160, rot: 90 };
        var O2 = [z.c[0] - DP * n[0] + 55 * t[0], z.c[1] - DP * n[1] + 55 * t[1]];
        /* recul où la pile tourne dans le château (100 à 300 mm) */
        var bk = []; for (var bd = 100; bd <= 300; bd += 50) bk.push([O2[0] - bd * n[0], O2[1] - bd * n[1]]);
        cand(O2, phi - 120 * fk(st.f), over, null, bk);
        out[0].porteF = st.f;
        return out;
      case 'tour':
        z = en.zoneById(st.z); over[st.f] = { hc: 160, rot: 90 };
        var sl0 = -1; heldList(b, st.f).forEach(function (q) { if (q.id === st.s) sl0 = q.sl; });
        var zl = G().stoneZc(sl0 < 0 ? 1 : sl0);
        for (phi = 0; phi < 360; phi += 10) { n = nv(phi); t = lv(phi); var Ot = [z.c[0] - DP * n[0] - zl * t[0], z.c[1] - DP * n[1] - zl * t[1]]; cand(Ot, phi - 120 * fk(st.f), over, null, backN(Ot, n, 80)); out[out.length - 1].tourF = st.f; }
        return out;
      case 'monterGraal':
        var P = b.params || {}, Gc = [P.gx, P.gy];
        [0, 180].forEach(function (k) { var p = (P.ga || 0) + k, nn = nv(p), tt = lv(p), O = [Gc[0] - geo().graal.xPrise * nn[0] - geo().graal.y * tt[0], Gc[1] - geo().graal.xPrise * nn[1] - geo().graal.y * tt[1]]; cand(O, p - 240, { C: { fx: geo().fourche.fxSortie, fz: geo().fourche.fzBas } }, ['graal'], backN(O, nn, 80)); });
        return out;
      case 'trone':
        var Ot2 = [mirX(250, team), 1000], TRn = en.throneOf(team), hh = b.pose.h;
        for (var kk = 0; kk <= 36; kk++) { var hk = b.pose.h + (kk % 2 ? 1 : -1) * Math.ceil(kk / 2) * 5; if (footIn(poseOf(b, Ot2[0], Ot2[1], hk), TRn)) { hh = hk; break; } }
        cand(Ot2, hh, null, null, []);
        return out;
      case 'tir':
        var tx = b.params && b.params.tx != null ? b.params.tx : 250, ty = b.params && b.params.ty != null ? b.params.ty : 1000;
        var Otr = b.params && b.params.tirDepuisTrone === false ? [b.pose.x, b.pose.y] : [mirX(tx, team), ty];
        cand(Otr, team === 'blue' ? 300 : 120, { C: { can: geo().canon.course } }, null, []);
        out[0].tir = true;
        return out;
      case 'seDeplacer': cand([mirX(st.x, team), st.y], b.pose.h, null, null, []); return out;
      case 'deposer':
        var rot = st.r != null ? +st.r : 0, hs = heldList(b, st.f);
        [(+st.ang || 0) - 90, (+st.ang || 0) + 90].forEach(function (p) {
          var h = p - 120 * fk(st.f), q = poseOf(b, 0, 0, h), cx = 0, cy = 0; q[st.f] = { hc: 165, rot: rot, vac: [0, 0, 0] };
          hs.forEach(function (x) { var fo = G().heldFoot(q, fk(st.f), x.sl); cx += fo.cx / hs.length; cy += fo.cy / hs.length; });
          var O = [+st.x - cx, +st.y - cy], o2 = {}; o2[st.f] = { hc: 165, rot: rot };
          cand(O, h, o2, null, backN(O, nv(p), 85));
        });
        return out;
    }
    return null;
  }
  /* pierres tenues par la face f dans un château pour les angles donnés (comme heldInCastle du moteur) */
  function heldInCastleAt(b, p, f, rots) {
    return heldList(b, f).every(function (x) {
      return rots.every(function (r) { var q = Object.assign({}, p); q[f] = { hc: p[f].hc, rot: r }; return G().rectPoly(G().heldFoot(q, fk(f), x.sl)).every(function (v) { return inCastleAny(v[0], v[1]); }); });
    });
  }
  /* robot coincé : en contact à sa pose, ou aucun petit déplacement (8 directions, même cap) sans contact */
  function coince(b, cache) {
    var x = b.pose.x, y = b.pose.y, h = b.pose.h, d = HYPOTHESES.pasCoince;
    if (poseHit(b, poseOf(b, x, y, h), null, cache)) return true;
    for (var k = 0; k < 8; k++) { var a = k * 45 * D2R; if (!poseHit(b, poseOf(b, x + d * Math.cos(a), y + d * Math.sin(a), h), null, cache)) return false; }
    return true;
  }
  /* ---- planificateur sur grille (même principe que plan() du moteur) : A* sur des cases de 40 mm, robot au cap d'arrivée,
     case libre = robot sans contact au centre de la case ; cases de départ et d'arrivée toujours libres. Repli (comme
     viaRotation du moteur) : parcours au cap de départ jusqu'à une case où le robot tourne sans contact, puis A* au cap d'arrivée. */
  var GRID = { C: 40, W: 75, H: 50 };
  function freeFn(b, h, over, cache) {
    var key = h.toFixed(1) + '|' + JSON.stringify(over || null), fc = cache.free = cache.free || {};
    if (fc[key]) return fc[key];
    var st = new Int8Array(GRID.W * GRID.H);
    var f = function (i, j) {
      var k = j * GRID.W + i; if (st[k]) return st[k] > 0;
      var free = !poseHit(b, poseOf(b, (i + 0.5) * GRID.C, (j + 0.5) * GRID.C, h, over), null, cache, HYPOTHESES.margeGrille);
      st[k] = free ? 1 : -1; return free;
    };
    f.key = key; f.h = h; f.over = over;
    return (fc[key] = f);
  }
  function cellOf2(x, y) { return [Math.max(0, Math.min(GRID.W - 1, Math.floor(x / GRID.C))), Math.max(0, Math.min(GRID.H - 1, Math.floor(y / GRID.C)))]; }
  /* tableaux de travail réutilisés (le masque est synchrone : pas de réentrance) */
  var WK = { gS: new Float32Array(75 * 50), stamp: new Uint32Array(75 * 50), closed: new Uint32Array(75 * 50), gen: 1 };
  /* A* de s0 vers g0 sur la grille free ; un échec complet donne la composante connexe du départ, gardée pour les requêtes
     suivantes de même cap et même état des pinces */
  function astar(free, s0, g0, maxN, cache, sp) {
    var W = GRID.W, si = s0[1] * W + s0[0], gi = g0[1] * W + g0[0];
    if (si === gi) return true;
    var comps = cache.comp = cache.comp || {}, ck = free.key + '@' + si + (sp ? '@' + sp[0].toFixed(0) + ',' + sp[1].toFixed(0) : ''), comp = comps[ck];
    /* premier pas depuis la position exacte du robot (et non le centre de sa case) : vérifié au tiers et aux deux tiers */
    function firstOk(nx, ny) {
      if (!sp) return true;
      var cx2 = (nx + 0.5) * GRID.C, cy2 = (ny + 0.5) * GRID.C;
      for (var u = 1; u <= 2; u++) if (poseHit(b0, poseOf(b0, sp[0] + (cx2 - sp[0]) * u / 3, sp[1] + (cy2 - sp[1]) * u / 3, free.h, free.over), null, cache)) return false;
      return true;
    }
    var b0 = cache.belief;
    if (comp) return comp.has(gi) || comp.border.has(gi);
    var gen = ++WK.gen, gS = WK.gS, stamp = WK.stamp, closed = WK.closed, heap = [], n = 0, seen = [], border = new Set();
    function g(i) { return stamp[i] === gen ? gS[i] : Infinity; }
    function push(f, i) { heap.push([f, i]); var c = heap.length - 1; while (c > 0) { var pr = (c - 1) >> 1; if (heap[pr][0] <= heap[c][0]) break; var t = heap[pr]; heap[pr] = heap[c]; heap[c] = t; c = pr; } }
    function pop() { var top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; var c = 0; for (;;) { var l = 2 * c + 1, r = l + 1, m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; var t = heap[m]; heap[m] = heap[c]; heap[c] = t; c = m; } } return top; }
    stamp[si] = gen; gS[si] = 0; push(0, si);
    while (heap.length && n++ < maxN) {
      var cur = pop()[1]; if (closed[cur] === gen) continue; closed[cur] = gen; seen.push(cur);
      if (cur === gi) return true;
      var cx = cur % W, cy = (cur - cx) / W;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; var nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= GRID.H) continue;
        var ni = ny * W + nx; if (closed[ni] === gen) continue;
        if (ni === gi) { stamp[ni] = gen; gS[ni] = g(cur) + 1; push(0, ni); continue; }
        if (!free(nx, ny) || (cur === si && !firstOk(nx, ny))) { border.add(ni); continue; }
        var ng = g(cur) + Math.hypot(dx, dy); if (ng < g(ni)) { stamp[ni] = gen; gS[ni] = ng; push(ng + Math.hypot(nx - g0[0], ny - g0[1]), ni); }
      }
    }
    /* échec complet (file vide) : composante du départ ; une arrivée adjacente à la composante est atteinte (case d'arrivée libre d'office) */
    if (!heap.length) { var set = new Set(seen); set.border = border; comps[ck] = set; }
    return false;
  }
  function planOk(b, c, cache) {
    cache.belief = b;
    var goals = c.back.length ? c.back : [c.O], h1 = c.h, over = c.over && !c.porteF ? c.over : null;
    var s0 = cellOf2(b.pose.x, b.pose.y), memo = cache.plan = cache.plan || {};
    return goals.some(function (G0) {
      if (dist(G0, [b.pose.x, b.pose.y]) < 60) return true;
      var g0 = cellOf2(G0[0], G0[1]), mk = h1.toFixed(1) + '|' + JSON.stringify(over) + '|' + g0;
      if (memo[mk] != null) return memo[mk];
      /* chemin direct au cap d'arrivée : le robot doit aussi pouvoir tourner de h0 à h1, au départ ou à l'arrivée
         (sinon le moteur passe par viaRotation : rotation sur place en un point dégagé) */
      var sp = [b.pose.x, b.pose.y];
      var direct = astar(freeFn(b, h1, over, cache), s0, g0, HYPOTHESES.planMax, cache, sp) ||
        (over && astar(freeFn(b, h1, null, cache), s0, g0, HYPOTHESES.planMax, cache, sp));
      var ok = (direct && (rotFree(b, b.pose.x, b.pose.y, b.pose.h, h1, null, cache) || rotFree(b, G0[0], G0[1], b.pose.h, h1, over, cache))) ||
        viaRot(b, s0, g0, h1, over, cache);
      return (memo[mk] = !!ok);
    });
  }
  function rotFree(b, x, y, h0, h1, over, cache) {
    var dh = ((h1 - h0) % 360 + 540) % 360 - 180, n = Math.ceil(Math.abs(dh) / 10);
    for (var k = 1; k <= n; k++) if (poseHit(b, poseOf(b, x, y, h0 + dh * k / n, over), null, cache)) return false;
    return true;
  }
  /* parcours au cap actuel (une fois par appel du masque) puis rotation sur place et A* au cap d'arrivée */
  function viaRot(b, s0, g0, h1, over, cache) {
    var W = GRID.W, si = s0[1] * W + s0[0];
    if (!cache.bfs0) {
      var f0 = freeFn(b, b.pose.h, null, cache), par = new Uint8Array(W * GRID.H), q = [si]; par[si] = 1;
      for (var qi = 0; qi < q.length && q.length < HYPOTHESES.planMax; qi++) {
        var k = q[qi], ci = k % W, cj = (k - ci) / W;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var ni = ci + dx, nj = cj + dy, nk = nj * W + ni; if ((dx || dy) && ni >= 0 && nj >= 0 && ni < W && nj < GRID.H && !par[nk] && f0(ni, nj)) { par[nk] = 1; q.push(nk); } }
      }
      cache.bfs0 = q;
    }
    /* les cases atteintes les plus proches de l'arrivée (sélection partielle) */
    var K = 3 * HYPOTHESES.viaRotationEssais, best = [], q0 = cache.bfs0;
    for (var i = 0; i < q0.length; i++) {
      var kk = q0[i], dx2 = kk % W - g0[0], dy2 = Math.floor(kk / W) - g0[1], d2 = dx2 * dx2 + dy2 * dy2;
      if (best.length < K || d2 < best[best.length - 1][0]) { best.push([d2, kk]); best.sort(function (u, v) { return u[0] - v[0]; }); if (best.length > K) best.pop(); }
    }
    var h0 = b.pose.h, dh = ((h1 - h0) % 360 + 540) % 360 - 180;
    for (var j = 0, tried = 0; j < best.length && tried < HYPOTHESES.viaRotationEssais; j++) {
      var k2 = best[j][1], x = (k2 % W + 0.5) * GRID.C, y = (Math.floor(k2 / W) + 0.5) * GRID.C, ok = true;
      for (var a2 = 1; a2 <= 12 && ok; a2++) if (poseHit(b, poseOf(b, x, y, h0 + dh * a2 / 12, null), null, cache)) ok = false;
      if (!ok) continue;
      tried++;
      if (astar(freeFn(b, h1, over, cache), [k2 % W, Math.floor(k2 / W)], g0, HYPOTHESES.planMax, cache)) return true;
    }
    return false;
  }
  /* rotation préparée (temps masqué) encore à faire : une action sans trajet la fait sur place (comme flushPend du moteur) */
  function pendingOk(b, st, cache) {
    if (st.a === 'tourner') return null;
    var why = null;
    ['A', 'B'].forEach(function (f) {
      var g = b.pinces[f], r0 = g.rotReelle; if (why || r0 == null || Math.abs(r0 - g.rot) < 0.5) return;
      if (!balayageOk(heldMask(b, f), heldInCastleB(b, f), r0, g.rot)) { why = 'Rotation préparée de la pince ' + f + ' impossible ici sous 350 mm.'; return; }
      for (var k = 0; k <= 6 && !why; k++) { var o = {}; o[f] = { rot: r0 + (g.rot - r0) * k / 6 }; if (poseHit(b, poseOf(b, b.pose.x, b.pose.y, b.pose.h, o), null, cache)) why = 'Rotation préparée de la pince ' + f + ' : contact sur place.'; }
    });
    return why;
  }
  /* une pose candidate est-elle tenable (sans contact, avec un recul libre) ? */
  function candOk(b, c, cache) {
    var p = poseOf(b, c.O[0], c.O[1], c.h, c.over);
    if (poseHit(b, p, c.excl, cache)) return false;
    if (c.tir && b.params && b.params.tirDepuisTrone !== false && !footIn(p, E().throneOf(b.team))) return false;
    if (!c.back.length) return true;
    return c.back.some(function (q) {
      if (c.tourF && Math.abs(b.pinces[c.tourF].rot - 90) > 0.5 && !balayageOk(heldMask(b, c.tourF), false, b.pinces[c.tourF].rot, 90)) {
        /* tour : la pile tourne au point de recul, pierres dans un château, sans contact (comme towerCheck du moteur) */
        var pr = poseOf(b, q[0], q[1], c.h), r0 = b.pinces[c.tourF].rot;
        if (!heldInCastleAt(b, pr, c.tourF, [r0, (r0 + 90) / 2, 90])) return false;
        return [r0, (r0 + 90) / 2, 90].every(function (r) { var o = {}; o[c.tourF] = { rot: r }; return !poseHit(b, poseOf(b, q[0], q[1], c.h, o), c.excl, cache); });
      }
      if (c.porteF) {
        /* porte : recul où la pile tourne de 0 à 90° dans le château, sans contact */
        var p0 = poseOf(b, q[0], q[1], c.h), o90 = {}; o90[c.porteF] = { rot: 90 };
        return heldInCastleAt(b, p0, c.porteF, [0, 45, 90]) && !poseHit(b, p0, c.excl, cache) && !poseHit(b, poseOf(b, q[0], q[1], c.h, o90), c.excl, cache);
      }
      return !poseHit(b, poseOf(b, q[0], q[1], c.h, c.over), c.excl, cache);
    });
  }

  /* raison pour laquelle l'action est masquée (null = valide) */
  function explain(act, b, cache) {
    if (b.t >= E().MATCH - 1e-6) return 'Match terminé.';
    var stP = toProgramStep(act, b);
    if (!stP) return 'Rien à prendre ou à poser pour cette action (croyance).';
    var st = realStep(stP, b.team);
    var why = preBelief(st, b); if (why) return why;
    /* actions sans effet (aucun mouvement) */
    if (st.a === 'tourner' && Math.abs(b.pinces[st.f].rot - st.r) <= 0.5) return 'La pince est déjà à cet angle.';
    /* une préparation de cette face attend déjà le prochain trajet : la changer ne prend aucun temps (boucle sans fin possible) */
    if (st.a === 'tourner' && b.pinces[st.f].rotReelle != null) return 'Préparation déjà en attente sur la pince ' + st.f + ' (faite au prochain trajet).';
    if (st.a === 'attendreJusqua' && b.t >= st.sec - 0.05) return 'Déjà l\'heure.';
    /* échec appris : la même brique vient d'échouer à cet instant, le monde n'a pas changé */
    if (b.echecs && b.echecs.t === b.t && (b.echecs.briques || []).some(function (x) { return sameStep(x, st); })) return 'Vient d\'échouer à cet instant.';
    var ap = approaches(act, st, b);
    if (!ap) return pendingOk(b, st, cache);
    if (st.a === 'tir') {
      /* le tir doit commencer avant 100 s : trajet (distance / v, rotation / w), sortie et mise en route du canon */
      var P2 = b.params || {}, v = (P2.v || 0.5) * 1000, w = P2.w || 120, tg = ap[0].O;
      var dh2 = Math.abs(((ap[0].h - b.pose.h) % 360 + 540) % 360 - 180);
      if (b.t + Math.max(dist(tg, [b.pose.x, b.pose.y]) / v, dh2 / w) + (P2.bdep > 0 ? P2.bdep : 0.1) + (P2.bspin > 0 ? P2.bspin : 0) >= E().MATCH) return 'Tir : la position de tir serait atteinte après 100 s.';
    }
    /* règlement E.2.b : le Graal monté ne doit pas sortir du château */
    if (b.graal === 'toit' || b.graal === 'ascenseur') {
      var CST = E().castleOf(b.team);
      ap = ap.filter(function (c) { return E().inPoly(c.O[0], c.O[1], CST) && c.back.every(function (q) { return E().inPoly(q[0], q[1], CST); }); });
      if (!ap.length) return 'Le Graal sur le toit sortirait du château (E.2.b).';
    }
    if (!ap.length) return 'Aucune pose d\'approche.';
    ap = ap.filter(function (c) { return candOk(b, c, cache); });
    if (!ap.length) return 'Aucune pose sans contact (bord de table, obstacle ou recul).';
    if (cache.coince == null) cache.coince = coince(b, cache);
    if (cache.coince) return 'Robot coincé : en contact, ou aucun déplacement de ' + HYPOTHESES.pasCoince + ' mm sans contact.';
    if (HYPOTHESES.planification === 'disque') {
      var R = reachOf(b, cache);
      if (!ap.some(function (c) { return R.ok(c.O[0], c.O[1]) || c.back.some(function (q) { return R.ok(q[0], q[1]); }); })) return 'Hors d\'atteinte (passage bloqué).';
      return null;
    }
    if (!ap.some(function (c) { return planOk(b, c, cache); })) return 'Hors d\'atteinte (aucun passage sur la grille du planificateur).';
    return null;
  }
  /* fonctions pures : la grille d'atteignabilité est calculée une fois par appel, au besoin */
  function explainBelief(b, catalogue) { var cache = {}; return (catalogue || ALL).map(function (a) { return explain(a, b, cache); }); }
  function maskBelief(b, catalogue) { var cache = {}; return (catalogue || ALL).map(function (a) { return explain(a, b, cache) ? 0 : 1; }); }

  var api = {
    CATALOGUE_VERSION: CATALOGUE_VERSION, HYPOTHESES: HYPOTHESES,
    FACES: FACES, PACKS: PACKS, MURS: MURS, TOURS: TOURS, COTES: COTES, ANGLES: ANGLES, FAMILLES: FAMILLES, ALL: ALL,
    WAYPOINTS_INFO: WAYPOINTS_INFO, STOCKS: STOCKS,
    filterByFamilles: filterByFamilles, toProgramStep: toProgramStep, realStep: realStep, sameStep: sameStep, indexOfStep: indexOfStep,
    maskBelief: maskBelief, explainBelief: explainBelief, preBelief: preBelief, approaches: approaches,
    stockCount: stockCount, stored: stored, heldFootAt: heldFootAt,
    _poseHitNow: function (b, tol, dx, dy) { return poseHit(b, poseOf(b, b.pose.x + (dx || 0), b.pose.y + (dy || 0), b.pose.h), null, {}, tol); }
  };
  root.ACTIONS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
