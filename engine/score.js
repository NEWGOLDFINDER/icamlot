/* Score et contrôles de règlement — source unique pour /plateau/, le compteur n'utilise que bareme.js.
   Dépend de spec/spec.js, geom.js, engine.js et bareme.js. Contrat : docs/CONTRATS.md §3.
   Le trône, les boulets et le Graal sont évalués en fin de match (T = 100 s) ; avant, seules les constructions comptent. */
(function (root) {
  var G = root.GEOM, GE = G.GEO;
  /* compatibilité : rangées de ventouses (z relatif à l'axe, demi-longueur, rayon) */
  var BARS = GE.rangees.map(function (r) { return { y: r.z, hl: r.hl, r: r.r }; });
  function gripTop(g) { return g.hc + G.actExt(g.rot).zmax; }
  function hullPer(P) { return G.hullPer(P); }
  function inCastle(x, y) { return ENGINE.inPoly(x, y, ENGINE.CASTLE) || ENGINE.inPoly(x, y, ENGINE.CASTLE_B); }
  function own(id, team) {
    var n = parseInt(id.slice(1), 10);
    if (team === 'blue') return id[0] === 'M' ? n >= 6 : n >= 5;
    return id[0] === 'M' ? n <= 5 : n <= 4;
  }
  function graalAt(R, t) { var e = R.graal.tl[0]; for (var i = 0; i < R.graal.tl.length; i++) if (R.graal.tl[i].t <= t) e = R.graal.tl[i]; return e; }
  /* projection verticale du robot (châssis, nacelles, canon s'il est sorti, ascenseur), repère table */
  function robotFoot(R, params, p) { return G.robotFootprint(p); }
  /* repère d'une pierre à l'instant t (mêmes formules que le moteur) */
  function stoneGeoAt(R, st, t) {
    var e = R.stoneAt(st, t);
    if (e.k === 'home') { var pk = ENGINE.PK[st.pk]; return { c: [pk.x, pk.y], ang: pk.tan + 90, top: 110 * st.l + 110, e: e }; }
    var p = e.k === 'held' ? R.poseAt(t) : e.pose, g = p[e.f], th = g.rot * Math.PI / 180, fo = heldFoot(p, e.f === 'A' ? 0 : 1, e.l);
    return { c: [fo.cx, fo.cy], ang: fo.ang, top: g.hc + G.stoneZc(e.l) * Math.cos(th) + 160 * Math.abs(Math.sin(th)) + 55 * Math.abs(Math.cos(th)), e: e };
  }
  /* Graal à l'instant t : { k, c, ang, bottom, top, poly } ; null s'il a été retiré */
  function graalPos(R, params, t) {
    var ge = graalAt(R, t), P = R.params || params || {};
    if (ge.k === 'retire' || ge.k === 'gone') return null;
    var q;
    if (ge.k === 'home') q = { c: [P.gx, P.gy], ang: P.ga, bottom: 0, top: GE.graal.h };
    else if (ge.k === 'toit' || ge.k === 'ascenseur') q = ENGINE.graalOnRobot(R.poseAt(t), ge.k);
    else q = { c: ge.c, ang: ge.ang || 0, bottom: ge.bottom != null ? ge.bottom : 0, top: ge.top != null ? ge.top : GE.graal.h, zone: ge.zone };
    q.k = ge.k; q.poly = ENGINE.graalPoly(q.c, q.ang);
    return q;
  }
  /* contrôles à l'instant t (affichage du plateau ; le moteur produit les mêmes contrôles en erreurs) */
  function checks(R, params, t) {
    var p = R.poseAt(t), robotH = G.actTop(p), oTop = 0, oLim = 350, objBad = false, n = 0;
    R.stones.forEach(function (st) {
      var e = R.stoneAt(st, t); if (e.k !== 'held') return; n++;
      var g = p[e.f], th = g.rot * Math.PI / 180, top = g.hc + G.stoneZc(e.l) * Math.cos(th) + 160 * Math.abs(Math.sin(th)) + 55 * Math.abs(Math.cos(th));
      var foot = rectPoly(heldFoot(p, e.f === 'A' ? 0 : 1, e.l)), exempt = foot.every(function (v) { return inCastle(v[0], v[1]); }), lim = exempt ? Infinity : GE.hMax;
      if (top > lim + 0.5) objBad = true; if (top > oTop) { oTop = top; oLim = lim; }
    });
    var gp = graalPos(R, params, t), gTop = gp ? gp.top : 0;
    if (gp && (gp.k === 'toit' || gp.k === 'ascenseur')) { n++; if (gTop > oTop) { oTop = gTop; oLim = Infinity; } }
    var per = G.perimetre(p), plim = t <= 0.01 ? GE.perDepart : GE.perMatch;
    var col = false; (R.collisions || []).forEach(function (c) { if (t >= c.t - 0.001 && t < c.t + 0.1) col = true; });
    var why = [];
    if (robotH > GE.hMax + 0.5) why.push('hauteur du robot'); if (objBad) why.push('hauteur des objets'); if (per > plim + 0.5) why.push('périmètre'); if (col) why.push('contact');
    return { p: p, robotH: robotH, oTop: oTop, oLim: oLim, n: n, per: per, plim: plim, gTop: gTop, bad: why.length > 0, why: why };
  }
  function zoneAtXY(c) {
    for (var i = 0; i < ENGINE.ZM.length; i++) if (ENGINE.inPoly(c[0], c[1], ENGINE.zoneRect(ENGINE.ZM[i]))) return ENGINE.ZM[i].id;
    for (var j = 0; j < ENGINE.ZT.length; j++) if (Math.hypot(c[0] - ENGINE.ZT[j].c[0], c[1] - ENGINE.ZT[j].c[1]) <= 100) return ENGINE.ZT[j].id;
    return null;
  }
  function outcome(R, params, T) {
    var team = (params && params.team) || (R.params && R.params.team) || 'yellow';
    var fin = {};
    R.stones.forEach(function (st) {
      var e = R.stoneAt(st, T);
      if (e.k === 'home') { var pk = ENGINE.PK[st.pk]; fin[st.id] = { foot: rectPoly({ cx: pk.x, cy: pk.y, hl: 160, hn: 55, ang: pk.tan + 90 }), v: false, bottom: 110 * st.l, home: true }; }
      else if (e.k === 'free') { var g = e.pose[e.f], th = g.rot * Math.PI / 180, fo = heldFoot(e.pose, e.f === 'A' ? 0 : 1, e.l), zc = g.hc + G.stoneZc(e.l) * Math.cos(th); fin[st.id] = { foot: rectPoly(fo), v: Math.abs(Math.sin(th)) > 0.7, bottom: zc - (160 * Math.abs(Math.sin(th)) + 55 * Math.abs(Math.cos(th))) }; }
    });
    Object.keys(fin).forEach(function (k) { fin[k].top = fin[k].bottom + (fin[k].v ? 320 : 110); });
    /* une pierre compte aussi si elle repose sur une pierre déjà valide pour la zone (E.1) */
    function grow(ss) {
      for (var more = true; more;) { more = false; Object.keys(fin).forEach(function (k) { if (fin[k].home || ss.indexOf(k) >= 0) return; if (ss.some(function (j) { return Math.abs(fin[k].bottom - fin[j].top) < 3 && overlap(fin[k].foot, fin[j].foot, 0); })) { ss.push(k); more = true; } }); }
      return ss;
    }
    var walls = [], doors = [], towers = [], inZ = {}, inOwn = {};
    ENGINE.ZM.forEach(function (z) {
      var P = ENGINE.zoneRect(z), ss = grow(Object.keys(fin).filter(function (k) { return !fin[k].home && overlap(fin[k].foot, P, 0); }));
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
    var MATCH = ENGINE.MATCH || 100, final = T >= MATCH - 1e-6;
    var p = R.poseAt(T), foot = G.robotFootprint(p), throne = ENGINE.throneOf(team), castle = ENGINE.castleOf(team);
    var throneFull = foot.every(function (v) { return ptIn(v, throne); });
    var thronePart = !throneFull && overlap(foot, throne, 0);
    var nBalls = 0;
    /* boulets : tirés pendant la phase d'attaque et arrêtés dans la cour adverse à la fin du match */
    (R.balls.shots || []).forEach(function (b) { if (b.cour && b.t >= (ENGINE.T_ATTAQUE || 85) - 1e-6 && b.t <= MATCH + 1e-6 && b.t + b.tStop <= MATCH + 1e-6) nBalls++; });
    var gp = graalPos(R, params, T), ge = graalAt(R, T);
    var gIn = !!gp && gp.poly.every(function (v) { return ptIn(v, castle); });
    var robotIn = ENGINE.inPoly(p.x, p.y, castle), fourcheOut = p.C && p.C.fx >= GE.fourche.fxSortie - 1;
    return { T: T, final: final, fin: fin, walls: walls, doors: doors, towers: towers, inZ: inZ, inOwn: inOwn, ge: ge, gp: gp, gIn: gIn, robotInCastle: robotIn, fourcheDegagee: !!fourcheOut, throneFull: throneFull, thronePart: thronePart, nBalls: nBalls, team: team };
  }
  /* point dans un rectangle ou polygone, bord compris */
  function ptIn(v, P) {
    if (ENGINE.inPoly(v[0], v[1], P)) return true;
    for (var i = 0; i < P.length; i++) { var a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, u = L ? Math.max(0, Math.min(1, ((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / L)) : 0; if (Math.hypot(v[0] - a[0] - u * dx, v[1] - a[1] - u * dy) <= 0.5) return true; }
    return false;
  }
  function scoreOf(o, params) {
    var B = root.BAREME, team = (o && o.team) || (params && params.team) || 'yellow';
    var rows = [];
    var nP = Object.keys(o.inOwn).length, wOwn = o.walls.filter(function (id) { return own(id, team); }), tOwn = o.towers.filter(function (id) { return own(id, team); }), dOwn = o.doors.filter(function (id) { return own(id, team); });
    /* Graal (E.2.b) : présence si dans le château ; niveau 4 sur le toit, fourche dégagée, robot dans son château ;
       niveaux 1 à 3 d'après la hauteur de son dessous (1, 2 ou 3 pierres à plat ; une pierre debout = niveau 3) ; sur une porte : niveau 3 (signalé) */
    var g = o.gp, k = o.ge.k, gIn = false, lvl = 0, gNote;
    if (!o.final) gNote = 'évalué à la fin du match';
    else if (!g) gNote = 'retiré de la table (sorti du château)';
    else {
      gIn = o.gIn;
      if (!gIn) gNote = 'hors du château';
      else if (k === 'home') gNote = 'à son départ (dans la salle du trône)';
      else if (k === 'ascenseur') gNote = 'encore tenu par l\'ascenseur';
      else if (k === 'toit') {
        if (o.fourcheDegagee && o.robotInCastle) { lvl = 4; gNote = 'sur le toit du robot, libre de tout actionneur'; }
        else gNote = 'sur le toit, mais ' + (!o.fourcheDegagee ? 'fourche non dégagée' : 'robot hors de son château');
      } else {
        var zone = g.zone || zoneAtXY(g.c), bottom = g.bottom;
        lvl = bottom >= 300 ? 3 : bottom >= 200 ? 2 : bottom >= 100 ? 1 : 0;
        gNote = 'posé ' + (zone ? 'sur ' + zone : 'au sol') + ' (base à ' + Math.round(bottom) + ' mm)';
        if (zone && o.doors.indexOf(zone) >= 0) { lvl = 3; gNote += ' : sur une porte, niveau non défini par le règlement, compté 3 (à confirmer)'; }
      }
    }
    var roi = !o.final ? 0 : o.throneFull ? B.retourComplet : o.thronePart ? B.retourPartiel : 0;
    var bl = !o.final ? 0 : (o.nBalls >= 1 ? B.boulet1 : 0) + (o.nBalls >= 3 ? B.boulet3 : 0);
    rows.push(['Construction', [
      ['Pierres dans nos zones', nP + ' × ' + B.pierre + ' pt', nP * B.pierre],
      ['Murs', wOwn.length ? wOwn.join(', ') : 'aucun', wOwn.length * B.mur],
      ['Tours', tOwn.length ? tOwn.join(', ') : 'aucune', tOwn.length * B.tour],
      ['Porte', dOwn.length ? dOwn[0] + (dOwn.length > 1 ? ' (une seule par château)' : '') : 'aucune', dOwn.length ? B.porte : 0]
    ]]);
    rows.push(['Graal', [
      ['Dans le château', gNote, gIn ? B.graalPresent : 0],
      ['Niveau d\'élévation', gIn ? 'niveau ' + lvl : '-', gIn ? lvl * B.graalNiveau : 0]
    ]]);
    rows.push(['Retour du roi', [
      ['Salle du trône', !o.final ? 'évalué à la fin du match' : o.throneFull ? 'complètement' : o.thronePart ? 'en partie' : 'dehors', roi]
    ]]);
    rows.push(['Assaut', [
      ['Boulets dans la cour adverse', !o.final ? 'évalués à la fin du match' : o.nBalls + ' arrêtés dans la cour à ' + (ENGINE.MATCH || 100) + ' s', bl],
      ['Douves et attaque de PAMI', 'non simulées', 0]
    ]]);
    var total = 0; rows.forEach(function (r) { r[1].forEach(function (x) { total += x[2]; }); });
    return {
      total: total, rows: rows, niveauGraal: gIn ? lvl : 0,
      detail: {
        pierres: nP * B.pierre, murs: wOwn.length * B.mur, tours: tOwn.length * B.tour, porte: dOwn.length ? B.porte : 0,
        graal: gIn ? B.graalPresent + lvl * B.graalNiveau : 0, roi: roi, boulets: bl
      }
    };
  }
  /* score à l'instant t (t omis : fin du match). Le trône, les boulets et le Graal ne comptent qu'à T = 100 s. */
  function scoreAt(R, params, t) {
    var M = ENGINE.MATCH || 100, T = t == null ? M : Math.min(t, M);
    return scoreOf(outcome(R, params, T), params);
  }
  var api = { BARS: BARS, gripTop: gripTop, hullPer: hullPer, robotFoot: robotFoot, graalPos: graalPos, stoneGeoAt: stoneGeoAt, inCastle: inCastle, own: own, graalAt: graalAt, checks: checks, outcome: outcome, scoreOf: scoreOf, scoreAt: scoreAt };
  root.SCORE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
