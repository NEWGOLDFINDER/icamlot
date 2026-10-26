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
      if (a.a !== st.a) continue;
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
    var st = { a: act.a };
    if (act.f) st.f = act.f;
    if (act.p) st.p = act.p;
    if (act.z) st.z = act.z;
    if (act.side) st.side = act.side;
    if (act.a === 'tour') {
      var held = sim.held()[act.f];
      var stack = held && held.stack ? held.stack : [];
      var target = stack.filter(function (x) { return x; })[act.rank];
      st.s = target ? target.id : 'P1.1';
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
    if (sts.some(function (x) { return x.cur.k === 'held' || x.cur.k === 'gone'; })) return false;
    var tag = sts[0] && sts[0].tag;
    return sts.length === 3 && sts.every(function (x) { return x.tag === tag; }) && (tag === 'home' || (sts[0].cur.geo && !sts[0].cur.geo.vertical));
  }
  function stoneHeldRank(sim, f, rank) {
    var h = sim.held()[f];
    if (!h || !h.stack) return false;
    return !!h.stack.filter(function (x) { return x; })[rank];
  }
  function zoneHasBuild(sim, z) {
    var zone = ENGINE.zoneById(z); if (!zone) return false;
    var zr = zone.tan !== undefined ? rectPoly({ cx: zone.c[0], cy: zone.c[1], hl: 200, hn: 100, ang: zone.tan + 90 }) : null;
    return sim.stones().some(function (st) {
      if (st.cur.k !== 'free') return false;
      var g = st.cur.geo; if (!g) return false;
      if (zr) return overlap(g.foot, zr, 0);
      var d = 1e9, P = g.foot;
      if (ENGINE.inPoly(zone.c[0], zone.c[1], P)) return true;
      for (var i = 0; i < P.length; i++) {
        var a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
        var u = L ? Math.max(0, Math.min(1, ((zone.c[0] - a[0]) * dx + (zone.c[1] - a[1]) * dy) / L)) : 0;
        d = Math.min(d, Math.hypot(zone.c[0] - a[0] - u * dx, zone.c[1] - a[1] - u * dy));
      }
      return d < 100;
    });
  }

  function valid(act, sim) {
    switch (act.famille) {
      case 'prendre': return faceEmpty(sim, act.f) && packetStacked(sim, act.p);
      case 'mur': return faceStackFlat(sim, act.f);
      case 'tour': return stoneHeldRank(sim, act.f, act.rank);
      case 'porte': return faceStackFlat(sim, act.f);
      case 'boulets': return sim.balls().t === Infinity;
      case 'prendreGraal': return faceEmpty(sim, act.f) && sim.graal().cur.k !== 'held';
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
