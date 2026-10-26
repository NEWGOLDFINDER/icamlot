/* Score et contrôles de règlement — source unique pour /plateau/, le compteur n'utilise que bareme.js.
   Dépend de geom.js, engine.js et bareme.js. */
(function (root) {
  var BARS = [{ y: -110, hl: 105, r: 25 }, { y: 0, hl: 105, r: 25 }, { y: 70, hl: 90, r: 10 }];
  function gripTop(g) {
    var th = g.rot * Math.PI / 180, c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th)), m = 0;
    BARS.forEach(function (b) { m = Math.max(m, b.y * Math.cos(th) + b.hl * s + b.r * c); });
    return g.hc + m;
  }
  function hullPer(P) {
    P = P.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [];
    P.forEach(function (q) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); });
    for (var i = P.length - 1; i >= 0; i--) { var q = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    var H = lo.slice(0, -1).concat(up.slice(0, -1)), per = 0;
    for (var j = 0; j < H.length; j++) { var a = H[j], b = H[(j + 1) % H.length]; per += Math.hypot(a[0] - b[0], a[1] - b[1]); }
    return per;
  }
  function inCastle(x, y) { return ENGINE.inPoly(x, y, ENGINE.CASTLE) || ENGINE.inPoly(x, y, ENGINE.CASTLE_B); }
  function own(id, team) {
    var n = parseInt(id.slice(1), 10);
    if (team === 'blue') return id[0] === 'M' ? n >= 6 : n >= 5;
    return id[0] === 'M' ? n <= 5 : n <= 4;
  }
  function graalAt(R, t) { var e = R.graal.tl[0]; for (var i = 0; i < R.graal.tl.length; i++) if (R.graal.tl[i].t <= t) e = R.graal.tl[i]; return e; }
  /* empreinte du robot : triangle, + canon de la face C une fois déployé (séance de tir) */
  function canOut(R, t) { return R.balls && R.balls.tDeploy != null && t >= R.balls.tDeploy; }
  function robotFoot(R, params, p, t) { return canOut(R, t) ? triPoly(p).concat(cannonPoly(p, params.cl, params.cw) || []) : triPoly(p); }
  /* repère d'une pierre à l'instant t (mêmes formules que le moteur) */
  function stoneGeoAt(R, st, t) {
    var e = R.stoneAt(st, t);
    if (e.k === 'home') { var pk = ENGINE.PK[st.pk]; return { c: [pk.x, pk.y], ang: pk.tan + 90, top: 110 * st.l + 110, e: e }; }
    var p = e.k === 'held' ? R.poseAt(t) : e.pose, g = p[e.f], th = g.rot * Math.PI / 180, fo = heldFoot(p, e.f === 'A' ? 0 : 1, e.l);
    return { c: [fo.cx, fo.cy], ang: fo.ang, top: g.hc + 110 * (e.l - 1) * Math.cos(th) + 160 * Math.abs(Math.sin(th)) + 55 * Math.abs(Math.cos(th)), e: e };
  }
  function zoneAtXY(c) {
    for (var i = 0; i < ENGINE.ZM.length; i++) { var z = ENGINE.ZM[i]; if (ENGINE.inPoly(c[0], c[1], rectPoly({ cx: z.c[0], cy: z.c[1], hl: 200, hn: 100, ang: z.tan + 90 }))) return z.id; }
    for (var j = 0; j < ENGINE.ZT.length; j++) if (Math.hypot(c[0] - ENGINE.ZT[j].c[0], c[1] - ENGINE.ZT[j].c[1]) <= 100) return ENGINE.ZT[j].id;
    return null;
  }
  /* Graal posé sur une pierre : il suit la pierre ; sa zone est recalculée si la pierre a bougé depuis la pose */
  function graalPos(R, params, t) {
    var ge = graalAt(R, t); if (ge.k !== 'ride') return null;
    var st = R.stones.filter(function (x) { return x.id === ge.s; })[0], fr = stoneGeoAt(R, st, t), n = nv(fr.ang), u = lv(fr.ang);
    var c = [fr.c[0] + ge.du * u[0] + ge.dv * n[0], fr.c[1] + ge.du * u[1] + ge.dv * n[1]], moved = fr.e.t > ge.t + 1e-6;
    return { c: c, top: fr.top + (params.gs || 60), ang: fr.ang, held: fr.e.k === 'held', zone: moved ? zoneAtXY(c) : ge.zone };
  }
  function checks(R, params, t, countPer) {
    if (countPer == null) countPer = true;
    var p = R.poseAt(t), robotH = Math.max(345, gripTop(p.A), gripTop(p.B)), pts = robotFoot(R, params, p, t), oTop = 0, oLim = 350, bad = false, objBad = false, n = 0;
    R.stones.forEach(function (st) {
      var e = R.stoneAt(st, t); if (e.k !== 'held') return; n++;
      var g = p[e.f], th = g.rot * Math.PI / 180, top = g.hc + 110 * (e.l - 1) * Math.cos(th) + 160 * Math.abs(Math.sin(th)) + 55 * Math.abs(Math.cos(th));
      var fo = heldFoot(p, e.f === 'A' ? 0 : 1, e.l), lim = inCastle(fo.cx, fo.cy) ? 430 : 350;
      if (top > lim + 0.5) objBad = true; if (top > oTop) { oTop = top; oLim = lim; }
      if (countPer) pts = pts.concat(rectPoly(fo));
    });
    var ge = graalAt(R, t), gTop = 0, gs = params.gs || 60;
    if (ge.k === 'ride') { var gp = graalPos(R, params, t); gTop = gp.top; if (gTop > 430.5) objBad = true; if (gp.held) { n++; if (gTop > oTop) { oTop = gTop; oLim = 430; } } }
    if (ge.k === 'held' || ge.k === 'free') {
      gTop = ge.k === 'held' ? p[ge.f].hc - 110 + gs / 2 : (ge.top != null ? ge.top : ge.pose[ge.f].hc - 110 + gs);
      if (gTop > 430.5) objBad = true;
      if (ge.k === 'held') { n++; if (gTop > oTop) { oTop = gTop; oLim = 430; } }
    }
    var per = hullPer(pts), plim = t <= 0.01 ? 1200 : 1400;
    var col = false; (R.collisions || []).forEach(function (c) { if (t >= c.t - 0.001 && t < c.t + 0.1) col = true; });
    var why = [];
    if (robotH > 350.5) why.push('hauteur du robot'); if (objBad) why.push('hauteur des objets'); if (per > plim + 0.5) why.push('périmètre'); if (col) why.push('contact');
    bad = why.length > 0;
    return { p: p, robotH: robotH, oTop: oTop, oLim: oLim, n: n, per: per, plim: plim, gTop: gTop, bad: bad, why: why };
  }
  function outcome(R, params, T) {
    var team = (params && params.team) || 'yellow';
    var fin = {};
    R.stones.forEach(function (st) {
      var e = R.stoneAt(st, T);
      if (e.k === 'home') { var pk = ENGINE.PK[st.pk]; fin[st.id] = { foot: rectPoly({ cx: pk.x, cy: pk.y, hl: 160, hn: 55, ang: pk.tan + 90 }), v: false, bottom: 110 * st.l, home: true }; }
      else if (e.k === 'free') { var g = e.pose[e.f], th = g.rot * Math.PI / 180, fo = heldFoot(e.pose, e.f === 'A' ? 0 : 1, e.l), zc = g.hc + 110 * (e.l - 1) * Math.cos(th); fin[st.id] = { foot: rectPoly(fo), v: Math.abs(Math.sin(th)) > 0.7, bottom: zc - (160 * Math.abs(Math.sin(th)) + 55 * Math.abs(Math.cos(th))) }; }
    });
    function zr(z) { return rectPoly({ cx: z.c[0], cy: z.c[1], hl: 200, hn: 100, ang: z.tan + 90 }); }
    Object.keys(fin).forEach(function (k) { fin[k].top = fin[k].bottom + (fin[k].v ? 320 : 110); });
    /* une pierre compte aussi si elle repose sur une pierre déjà valide pour la zone (E.1) */
    function grow(ss) {
      for (var more = true; more;) { more = false; Object.keys(fin).forEach(function (k) { if (fin[k].home || ss.indexOf(k) >= 0) return; if (ss.some(function (j) { return Math.abs(fin[k].bottom - fin[j].top) < 3 && overlap(fin[k].foot, fin[j].foot, 0); })) { ss.push(k); more = true; } }); }
      return ss;
    }
    var walls = [], doors = [], towers = [], inZ = {}, inOwn = {};
    ENGINE.ZM.forEach(function (z) {
      var P = zr(z), ss = grow(Object.keys(fin).filter(function (k) { return !fin[k].home && overlap(fin[k].foot, P, 0); }));
      ss.forEach(function (k) { inZ[k] = 1; if (own(z.id, team)) inOwn[k] = 1; });
      var h = ss.filter(function (k) { return !fin[k].v; }), v = ss.filter(function (k) { return fin[k].v; });
      if (v.length >= 2 && h.some(function (k) { return fin[k].bottom > 300; })) doors.push(z.id);
      else if (h.length >= 3) walls.push(z.id);
    });
    ENGINE.ZT.forEach(function (z) {
      var ss = grow(Object.keys(fin).filter(function (k) {
        if (fin[k].home) return false; var d = 1e9, P = fin[k].foot;
        if (ENGINE.inPoly(z.c[0], z.c[1], P)) d = 0; else for (var i = 0; i < 4; i++) { var a = P[i], b = P[(i + 1) % 4], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, u = Math.max(0, Math.min(1, ((z.c[0] - a[0]) * dx + (z.c[1] - a[1]) * dy) / L)); d = Math.min(d, Math.hypot(z.c[0] - a[0] - u * dx, z.c[1] - a[1] - u * dy)); }
        return d < 100;
      }));
      ss.forEach(function (k) { inZ[k] = 1; if (own(z.id, team)) inOwn[k] = 1; if (fin[k].v && towers.indexOf(z.id) < 0) towers.push(z.id); });
    });
    var ge = graalAt(R, T), tri = robotFoot(R, params, R.poseAt(T), T), throne = ENGINE.throneOf ? ENGINE.throneOf(team) : ENGINE.THRONE;
    var throneFull = tri.every(function (v) { return ENGINE.inPoly(v[0], v[1], throne); });
    var thronePart = !throneFull && (overlap(triPoly(R.poseAt(T)), throne, 0) || tri.some(function (v) { return ENGINE.inPoly(v[0], v[1], throne); }));
    var nBalls = 0;
    /* boulets : arrêtés dans la cour adverse à la fin du match (100 s), tirés pendant la phase d'attaque */
    (R.balls.shots || []).forEach(function (b) { if (b.cour && b.t >= 85 - 1e-6 && b.t + b.tStop <= (ENGINE.MATCH || 100) + 1e-6) nBalls++; });
    return { T: T, fin: fin, walls: walls, doors: doors, towers: towers, inZ: inZ, inOwn: inOwn, ge: ge, gp: graalPos(R, params || {}, T), throneFull: throneFull, thronePart: thronePart, nBalls: nBalls, team: team };
  }
  function scoreOf(o, params) {
    var B = root.BAREME, team = (o && o.team) || (params && params.team) || 'yellow';
    var rows = [];
    var nP = Object.keys(o.inOwn).length, wOwn = o.walls.filter(function (id) { return own(id, team); }), tOwn = o.towers.filter(function (id) { return own(id, team); }), dOwn = o.doors.filter(function (id) { return own(id, team); });
    var g = o.ge, gIn = false, lvl = 0, gNote = 'non posé dans le château', gs = (params && params.gs) || 60;
    if (g.k === 'ride') g = { k: 'free', zone: o.gp.zone, top: o.gp.top };
    if (g.k === 'free' && g.zone && own(g.zone, team)) {
      gIn = true; var bottom = g.top - gs;
      lvl = bottom >= 300 ? 3 : bottom >= 200 ? 2 : bottom >= 100 ? 1 : 0;
      gNote = 'posé sur ' + g.zone + ' (base à ' + Math.round(bottom) + ' mm)';
    } else if (g.k === 'held') gNote = 'encore tenu par le robot';
    var roi = o.throneFull ? B.retourComplet : o.thronePart ? B.retourPartiel : 0;
    var bl = (o.nBalls >= 1 ? B.boulet1 : 0) + (o.nBalls >= 3 ? B.boulet3 : 0);
    rows.push(['Construction', [
      ['Pierres dans nos zones', nP + ' × ' + B.pierre + ' pt', nP * B.pierre],
      ['Murs', wOwn.length ? wOwn.join(', ') : 'aucun', wOwn.length * B.mur],
      ['Tours', tOwn.length ? tOwn.join(', ') : 'aucune', tOwn.length * B.tour],
      ['Porte', dOwn.length ? dOwn[0] : 'aucune', dOwn.length ? B.porte : 0]
    ]]);
    rows.push(['Graal', [
      ['Dans le château', gNote, gIn ? B.graalPresent : 0],
      ['Niveau d\'élévation', gIn ? 'niveau ' + lvl + ' (estimé d\'après la hauteur)' : '-', lvl * B.graalNiveau]
    ]]);
    rows.push(['Retour du roi', [
      ['Salle du trône', o.throneFull ? 'complètement' : o.thronePart ? 'en partie' : 'dehors', roi]
    ]]);
    rows.push(['Assaut', [
      ['Boulets dans la cour adverse', o.nBalls + ' arrêtés dans la cour à 100 s', bl],
      ['Douves et attaque de PAMI', 'non simulées', 0]
    ]]);
    var total = 0; rows.forEach(function (r) { r[1].forEach(function (x) { total += x[2]; }); });
    return {
      total: total, rows: rows,
      detail: {
        pierres: nP * B.pierre, murs: wOwn.length * B.mur, tours: tOwn.length * B.tour, porte: dOwn.length ? B.porte : 0,
        graal: (gIn ? B.graalPresent : 0) + lvl * B.graalNiveau, roi: roi, boulets: bl
      }
    };
  }
  function scoreAt(R, params, t) {
    var T = Math.min(t != null ? t : R.T, ENGINE.MATCH || 100);
    return scoreOf(outcome(R, params, T), params);
  }
  var api = { BARS: BARS, gripTop: gripTop, hullPer: hullPer, robotFoot: robotFoot, graalPos: graalPos, stoneGeoAt: stoneGeoAt, inCastle: inCastle, own: own, graalAt: graalAt, checks: checks, outcome: outcome, scoreOf: scoreOf, scoreAt: scoreAt };
  root.SCORE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
