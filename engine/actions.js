/* Catalogue des 106 actions du réseau (cahier des charges, annexe A) et masque de validité. */
(function (root) {
  var FACES = ['A', 'B'];
  var PACKS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'];
  var MURS = ['M1', 'M2', 'M3', 'M4', 'M5'];
  var TOURS = ['T1', 'T2', 'T3', 'T4'];
  var COTES = ['ext', 'int'];
  var GRAAL_ZONES = MURS.concat(TOURS);
  var FAMILLES = [
    { id: 'prendre', label: 'Prendre un paquet', n: 20 },
    { id: 'mur', label: 'Poser un mur', n: 20 },
    { id: 'tour', label: 'Faire une tour', n: 24 },
    { id: 'porte', label: 'Faire une porte', n: 20 },
    { id: 'boulets', label: 'Lâcher les boulets', n: 1 },
    { id: 'prendreGraal', label: 'Prendre le Graal', n: 2 },
    { id: 'poserGraal', label: 'Poser le Graal', n: 18 },
    { id: 'trone', label: 'Retour au trône', n: 1 }
  ];

  function buildAll() {
    var out = [];
    FACES.forEach(function (f) {
      PACKS.forEach(function (p) { out.push({ i: out.length, famille: 'prendre', a: 'prendre', f: f, p: p, label: 'Prendre ' + p + ' · face ' + f }); });
    });
    FACES.forEach(function (f) {
      MURS.forEach(function (z) {
        COTES.forEach(function (side) { out.push({ i: out.length, famille: 'mur', a: 'mur', f: f, z: z, side: side, label: 'Mur ' + z + ' · ' + side + ' · face ' + f }); });
      });
    });
    FACES.forEach(function (f) {
      TOURS.forEach(function (z) {
        [0, 1, 2].forEach(function (rank) { out.push({ i: out.length, famille: 'tour', a: 'tour', f: f, z: z, rank: rank, label: 'Tour ' + z + ' · pierre ' + (rank + 1) + ' · face ' + f }); });
      });
    });
    FACES.forEach(function (f) {
      MURS.forEach(function (z) {
        COTES.forEach(function (side) { out.push({ i: out.length, famille: 'porte', a: 'porte', f: f, z: z, side: side, label: 'Porte ' + z + ' · ' + side + ' · face ' + f }); });
      });
    });
    out.push({ i: out.length, famille: 'boulets', a: 'boulets', label: 'Lâcher les boulets' });
    FACES.forEach(function (f) { out.push({ i: out.length, famille: 'prendreGraal', a: 'prendreGraal', f: f, label: 'Prendre le Graal · face ' + f }); });
    FACES.forEach(function (f) {
      GRAAL_ZONES.forEach(function (z) { out.push({ i: out.length, famille: 'poserGraal', a: 'poserGraal', f: f, z: z, label: 'Poser le Graal sur ' + z + ' · face ' + f }); });
    });
    out.push({ i: out.length, famille: 'trone', a: 'trone', label: 'Aller dans la salle du trône' });
    return out;
  }
  var ALL = buildAll();
  if (ALL.length !== 106) throw new Error('Le catalogue doit compter 106 actions, pas ' + ALL.length + '.');

  function filterByFamilles(familles) {
    var set = {};
    (familles || FAMILLES.map(function (f) { return f.id; })).forEach(function (id) { set[id] = true; });
    return ALL.filter(function (a) { return set[a.famille]; });
  }

  function indexOfStep(st, sim, catalogue) {
    catalogue = catalogue || ALL;
    for (var i = 0; i < catalogue.length; i++) {
      var a = catalogue[i];
      if (a.a !== (st.a === 'tir' ? 'boulets' : st.a)) continue;
      if (a.f && a.f !== st.f) continue;
      if (a.p && a.p !== st.p) continue;
      if (a.z && a.z !== st.z) continue;
      if (a.side && a.side !== st.side) continue;
      if (a.a === 'tour') {
        var held = sim.held()[st.f];
        var stack = held && held.stack ? held.stack.filter(function (x) { return x; }) : [];
        var rank = -1;
        stack.forEach(function (x, k) { if (x.id === st.s) rank = k; });
        if (rank !== a.rank) continue;
      }
      return i;
    }
    return -1;
  }
  function toProgramStep(act, sim) {
    var st = { a: act.a === 'boulets' ? 'tir' : act.a };
    var blue = teamOf(sim) === 'blue';
    if (act.f) st.f = act.f;
    if (act.p) st.p = act.p;
    if (act.z) st.z = act.z;
    if (act.side) st.side = act.side;
    if (act.a === 'tour') {
      var held = sim.held()[act.f];
      var stack = held && held.stack ? held.stack : [];
      var target = stack.filter(function (x) { return x; })[act.rank];
      /* le programme est écrit dans le repère du cerveau : un robot bleu le rejouera par mirrorStep */
      st.s = target ? (blue ? ENGINE.mirrorId(target.id.split('.')[0]) + '.' + target.id.split('.')[1] : target.id) : 'P1.1';
    }
    return st;
  }

  function faceEmpty(sim, f) { return !sim.held()[f]; }
  function faceStackFlat(sim, f) {
    var h = sim.held()[f];
    if (!h || !h.stack) return false;
    var n = h.stack.filter(function (x) { return x; }).length;
    return n === 3 && sim.pose()[f].rot === 0;
  }
  function faceHoldsGraal(sim, f) { var h = sim.held()[f]; return !!(h && h.graal); }
  function packetStacked(sim, p) {
    var idx = -1; ENGINE.PK.forEach(function (pk, i) { if (pk.id === p) idx = i; });
    if (idx < 0) return false;
    var sts = sim.stones().filter(function (st) { return st.pk === idx; });
    if (sts.length !== 3) return false;
    if (!sts.every(function (x) { return x.cur.k === 'home'; })) return false;
    if (sim.claimed && sts.some(function (x) { return sim.claimed(x.id); })) return false;
    return true;
  }
  function stoneHeldRank(sim, f, rank) {
    var h = sim.held()[f];
    if (!h || !h.stack) return false;
    return !!h.stack.filter(function (x) { return x; })[rank];
  }
  function zoneStoneCount(sim, z) {
    var zone = ENGINE.zoneById(z); if (!zone) return 0;
    var isWall = z && z[0] === 'M';
    var zr = zone.tan !== undefined ? rectPoly({ cx: zone.c[0], cy: zone.c[1], hl: 200, hn: 100, ang: zone.tan + 90 }) : null;
    var n = 0;
    /* pierres posées par ce robot, puis celles de l'autre robot (la zone est occupée aussi) */
    var all = [];
    sim.stones().forEach(function (st) { if (st.cur.k === 'free' && st.cur.geo) all.push(st.cur.geo); });
    (sim.foreign ? sim.foreign() : []).forEach(function (g) { all.push(g); });
    all.forEach(function (g) {
      if (!isWall && !g.vertical) return; // pour une tour, seule une pierre verticale compte
      if (zr) { if (overlap(g.foot, zr, 0)) n++; return; }
      var d = 1e9, P = g.foot;
      if (ENGINE.inPoly(zone.c[0], zone.c[1], P)) { n++; return; }
      for (var i = 0; i < P.length; i++) {
        var a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
        var u = L ? Math.max(0, Math.min(1, ((zone.c[0] - a[0]) * dx + (zone.c[1] - a[1]) * dy) / L)) : 0;
        d = Math.min(d, Math.hypot(zone.c[0] - a[0] - u * dx, zone.c[1] - a[1] - u * dy));
      }
      if (d < 100) n++;
    });
    return n;
  }
  function zoneHasBuild(sim, z) {
    var isWall = z && z[0] === 'M';
    return isWall ? zoneStoneCount(sim, z) >= 3 : zoneStoneCount(sim, z) >= 1;
  }
  function towerComplete(sim, z) { return zoneStoneCount(sim, z) >= 1; }

  function validDoorTarget(act) {
    if (act.z === 'M5') return false; // Pas de place pour déployer la porte près de la bordure basse
    if (act.z === 'M1' && act.side === 'ext') return false; // Pas de place pour déployer la porte côté extérieur haut
    return true;
  }
  function castleHasDoor(sim) {
    if (typeof SCORE === 'undefined' || !SCORE.outcome) return false;
    var r = sim.result(false);
    var o = SCORE.outcome(r, sim.params(), sim.time());
    var team = teamOf(sim);
    return o.doors.some(function (id) { return SCORE.own(id, team); });
  }

  /* Une action est écrite dans le repère du cerveau (jaune : P1–P10, M1–M5, T1–T4). Pour un robot bleu, les mêmes
     numéros désignent les cibles en miroir : on les traduit en vrais numéros avant de lire la table. */
  function teamOf(sim) { var P = sim.params && sim.params(); return (P && P.team) || 'yellow'; }
  function real(act, sim) {
    if (teamOf(sim) !== 'blue') return act;
    var o = {}; Object.keys(act).forEach(function (k) { o[k] = act[k]; });
    if (o.p) o.p = ENGINE.mirrorId(o.p);
    if (o.z) o.z = ENGINE.mirrorId(o.z);
    return o;
  }
  var PACK_CENTERS = [
    [750, 55], [1250, 55], [1750, 55], [2250, 55],
    [750, 1945], [1250, 1945], [1750, 1945], [2250, 1945],
    [1500, 500], [1500, 1500]
  ];

  var ACTION_TARGETS = {
    'P1': [750, 305.5], 'P2': [1250, 305.5], 'P3': [1750, 305.5], 'P4': [2250, 305.5],
    'P5': [750, 1694.5], 'P6': [1250, 1694.5], 'P7': [1750, 1694.5], 'P8': [2250, 1694.5],
    'P9': [1249.5, 500], 'P10': [1249.5, 1500],
    'M1_ext': [250, 229.5], 'M1_int': [250, 570.5],
    'M2_ext': [799.8, 450.3], 'M2_int': [558.8, 691.3],
    'M3_ext': [1020.5, 1000], 'M3_int': [679.5, 1000],
    'M4_ext': [799.8, 1550.0], 'M4_int': [558.8, 1309.0],
    'M5_ext': [250, 1770.5], 'M5_int': [250, 1429.5],
    'T1': [329.5, 400], 'T2': [679.5, 750], 'T3': [679.5, 1250], 'T4': [329.5, 1600],
    'PG_M1': [150, 320], 'PG_M2': [579.3, 490.8], 'PG_M3': [750, 920], 'PG_M4': [579.3, 1349.5], 'PG_M5': [150, 1520],
    'PG_T1': [400, 320], 'PG_T2': [750, 670], 'PG_T3': [750, 1170], 'PG_T4': [400, 1520]
  };

  function getActionTarget(act) {
    if (act.p && ACTION_TARGETS[act.p]) return ACTION_TARGETS[act.p];
    if (act.z) {
      if (act.famille === 'mur' || act.famille === 'porte') {
        var key = act.z + '_' + (act.side || 'ext');
        if (ACTION_TARGETS[key]) return ACTION_TARGETS[key];
      }
      if (act.famille === 'tour' && ACTION_TARGETS[act.z]) return ACTION_TARGETS[act.z];
      if (act.famille === 'poserGraal') {
        var pgKey = 'PG_' + act.z;
        if (ACTION_TARGETS[pgKey]) return ACTION_TARGETS[pgKey];
      }
    }
    if (act.famille === 'boulets' || act.famille === 'trone') return [250, 1000];
    if (act.famille === 'prendreGraal') return [295.3, 1067.3];
    return null;
  }

  function hitsCrates(act, sim) {
    if (!sim || typeof sim.pose !== 'function') return false;
    var s = sim.pose();
    if (!s || s.x == null) return false;
    var rawTgt = getActionTarget(act);
    if (!rawTgt) return false;

    var isBlue = (sim.params && sim.params().team === 'blue');
    var tx = isBlue ? 3000 - rawTgt[0] : rawTgt[0];
    var ty = rawTgt[1];
    var ax = s.x, ay = s.y;
    var abx = tx - ax, aby = ty - ay;
    var l2 = abx * abx + aby * aby;
    if (l2 < 1e-4) return false;

    var targetPk = act.famille === 'prendre' ? (isBlue && typeof ENGINE !== 'undefined' ? ENGINE.mirrorId(act.p) : act.p) : null;
    var stones = typeof sim.stones === 'function' ? sim.stones() : [];

    for (var k = 0; k < 10; k++) {
      var pkId = 'P' + (k + 1);
      if (pkId === targetPk) continue;

      var hasStones = stones.some(function (st) {
        return st.pk === k && st.cur && st.cur.k === 'home';
      });
      if (!hasStones) continue;

      var cx = PACK_CENTERS[k][0], cy = PACK_CENTERS[k][1];
      var acx = cx - ax, acy = cy - ay;
      var u = Math.max(0, Math.min(1, (acx * abx + acy * aby) / l2));
      var px = ax + u * abx, py = ay + u * aby;
      var dist = Math.hypot(cx - px, cy - py);
      if (dist < 235) return true;
    }

    // 2. Trajet retour vers le trône (depuis la cible) : se laisser place de rentrer
    if (act.famille !== 'boulets' && act.famille !== 'trone') {
      var thX = isBlue ? 2750 : 250, thY = 1000;
      var btx = thX - tx, bty = thY - ty;
      var l2_ret = btx * btx + bty * bty;
      if (l2_ret >= 1e-4) {
        for (var k2 = 0; k2 < 10; k2++) {
          var pkId2 = 'P' + (k2 + 1);
          if (pkId2 === targetPk) continue;
          var active2 = stones.some(function (st) {
            return st.pk === k2 && st.cur && st.cur.k === 'home';
          });
          if (!active2) continue;

          var cx2 = PACK_CENTERS[k2][0], cy2 = PACK_CENTERS[k2][1];
          var bcx = cx2 - tx, bcy = cy2 - ty;
          var u_ret = Math.max(0, Math.min(1, (bcx * btx + bcy * bty) / l2_ret));
          var px_ret = tx + u_ret * btx, py_ret = ty + u_ret * bty;
          var dist_ret = Math.hypot(cx2 - px_ret, cy2 - py_ret);
          if (dist_ret < 235) return true;
        }
      }
    }

    return false;
  }

  function valid(act, sim) {
    if (hitsCrates(act, sim)) return false;

    // Anticipation temporelle : budget temps pour rentrer au trône et tirer les boulets (<= 100s)
    if (act.famille !== 'boulets' && act.famille !== 'trone' && typeof sim.pose === 'function' && typeof sim.time === 'function') {
      var rawTgt = getActionTarget(act);
      if (rawTgt) {
        var s = sim.pose();
        var isBlue = (sim.params && sim.params().team === 'blue');
        var tx = isBlue ? 3000 - rawTgt[0] : rawTgt[0], ty = rawTgt[1];
        var thX = isBlue ? 2750 : 250, thY = 1000;
        var dt_act = Math.hypot(tx - s.x, ty - s.y) / 500.0 + 1.0;
        var dt_throne = Math.hypot(thX - tx, thY - ty) / 500.0 + 0.5;
        var ballsFired = sim.balls && sim.balls().shots;
        var dt_tir = ballsFired ? 0.0 : 6.1;
        if (sim.time() + dt_act + dt_throne + dt_tir > 100.0) return false;
      }
    }
    act = real(act, sim);
    switch (act.famille) {
      case 'prendre': return faceEmpty(sim, act.f) && packetStacked(sim, act.p);
      case 'mur': return faceStackFlat(sim, act.f) && !zoneHasBuild(sim, act.z);
      case 'tour': return stoneHeldRank(sim, act.f, act.rank) && !towerComplete(sim, act.z);
      case 'porte': return faceStackFlat(sim, act.f) && !zoneHasBuild(sim, act.z) && !castleHasDoor(sim) && validDoorTarget(act);
      case 'boulets': return !sim.balls().shots && sim.time() >= 80;
      case 'prendreGraal': return faceEmpty(sim, act.f) && sim.graal().cur.k === 'home';
      case 'poserGraal': return faceHoldsGraal(sim, act.f) && zoneHasBuild(sim, act.z);
      case 'trone': return true;
      default: return false;
    }
  }

  function mask(sim, catalogue) {
    return (catalogue || ALL).map(function (act) { return valid(act, sim) ? 1 : 0; });
  }

  var api = { FACES: FACES, PACKS: PACKS, MURS: MURS, TOURS: TOURS, COTES: COTES, FAMILLES: FAMILLES, ALL: ALL, filterByFamilles: filterByFamilles, toProgramStep: toProgramStep, indexOfStep: indexOfStep, valid: valid, mask: mask };
  root.ACTIONS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
