/* Moteur de simulation ICAM LOT — source unique pour /plateau/ et l'entraînement.
   Optimisations D.1 (overlap, dans geom.js) et D.2 (choix de pose paresseux). */
(function (root) {
  var rin = GEO.rin, R3 = GEO.R;
  var VERSION = '1.2.0';
  var MATCH = 100;
  var DEF = { v: 0.5, va: 0.2, w: 120, vz: 100, trot: 1.5, tvac: 0.5, trel: 0.4, tballs: 4, x0: 250, y0: 1000, h0: 0, gx: 100, gy: 1180, gs: 60, team: 'yellow' };
  var PK = [];
  [750, 1250, 1750, 2250].forEach(function (x, i) { PK.push({ id: 'P' + (i + 1), x: x, y: 55, tan: 0 }); });
  [750, 1250, 1750, 2250].forEach(function (x, i) { PK.push({ id: 'P' + (i + 5), x: x, y: 1945, tan: 0 }); });
  PK.push({ id: 'P9', x: 1500, y: 500, tan: 90 }); PK.push({ id: 'P10', x: 1500, y: 1500, tan: 90 });
  var ZM = [
    { id: 'M1', c: [250, 400], tan: 0, nin: 90, name: 'mur haut' },
    { id: 'M2', c: [679.3, 570.8], tan: 45, nin: 135, name: 'mur diagonal haut' },
    { id: 'M3', c: [850, 1000], tan: 90, nin: 180, name: 'mur de façade' },
    { id: 'M4', c: [679.3, 1429.5], tan: -45, nin: 225, name: 'mur diagonal bas' },
    { id: 'M5', c: [250, 1600], tan: 0, nin: 270, name: 'mur bas' }
  ];
  ZM.slice().forEach(function (z, i) { ZM.push({ id: 'M' + (i + 6), c: [3000 - z.c[0], z.c[1]], tan: 180 - z.tan, nin: 180 - z.nin, name: z.name + ' adverse' }); });
  var ZT = [[500, 400], [850, 750], [850, 1250], [500, 1600]].map(function (c, i) { return { id: 'T' + (i + 1), c: c }; });
  ZT.slice().forEach(function (z, i) { ZT.push({ id: 'T' + (i + 5), c: [3000 - z.c[0], z.c[1]] }); });
  var THRONE = [[0, 750], [500, 750], [500, 1250], [0, 1250]];
  var CASTLE = [[0, 295], [610, 295], [960, 640], [960, 1360], [610, 1705], [0, 1705]];
  var CASTLE_B = CASTLE.map(function (p) { return [3000 - p[0], p[1]]; }).reverse();
  var THRONE_B = THRONE.map(function (p) { return [3000 - p[0], p[1]]; }).reverse();
  function throneOf(team) { return team === 'blue' ? THRONE_B : THRONE; }
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
    return P;
  }
  function intensityParams(P, intensity) {
    var Q = Object.assign({}, P);
    if (intensity === 'faible') { Q.v = (Q.v || DEF.v) * 0.7; Q.va = (Q.va || DEF.va) * 0.7; Q.w = (Q.w || DEF.w) * 0.85; }
    if (intensity === 'agressif') { Q.v = (Q.v || DEF.v) * 1.2; Q.va = (Q.va || DEF.va) * 1.15; Q.w = (Q.w || DEF.w) * 1.1; }
    return Q;
  }
  function zoneById(id) { for (var i = 0; i < ZM.length; i++) if (ZM[i].id === id) return ZM[i]; for (var j = 0; j < ZT.length; j++) if (ZT[j].id === id) return ZT[j]; return null; }
  function inPoly(x, y, P) { var c = false; for (var i = 0, j = P.length - 1; i < P.length; j = i++) { if (((P[i][1] > y) !== (P[j][1] > y)) && (x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0])) c = !c; } return c; }
  function angd(a, b) { return ((b - a) % 360 + 540) % 360 - 180; }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function inTable(P, m) { m = m || 0; return P.every(function (v) { return v[0] >= m && v[0] <= 3000 - m && v[1] >= m && v[1] <= 2000 - m; }); }
  function zoneRect(z) { return rectPoly({ cx: z.c[0], cy: z.c[1], hl: 200, hn: 100, ang: z.tan + 90 }); }
  function ptSegD(p, a, b) { var dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
  function ptPolyD(p, P) { if (inPoly(p[0], p[1], P)) return 0; var d = 1e9; for (var i = 0; i < P.length; i++) d = Math.min(d, ptSegD(p, P[i], P[(i + 1) % P.length])); return d; }

  function makeSim(P, opts) {
    opts = opts || {};
    P = Object.assign({}, DEF, P || {});
    var V = P.v * 1000, VA = P.va * 1000, WR = P.w, VZ = P.vz, TV = P.tvac, TL = P.trel, TR = P.trot, GS = P.gs;
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
    function oppOccupies(x, y, t) {
      var o = oppAt(t);
      if (!o || o.x == null) return false;
      return Math.hypot(x - o.x, y - o.y) < (GEO.R + 200);
    }
    var s = { t: 0, x: P.x0, y: P.y0, h: P.h0, A: { hc: 165, rot: 0, vac: [0, 0, 0] }, B: { hc: 165, rot: 0, vac: [0, 0, 0] } };
    var K = [], segs = [], errors = [], stepInfo = [];
    var stones = [];
    PK.forEach(function (pk, i) { for (var l = 0; l < 3; l++) stones.push({ id: pk.id + '.' + (l + 1), pk: i, l: l, tl: [{ t: 0, k: 'home' }], cur: { k: 'home' }, tag: 'home' }); });
    var held = { A: null, B: null };
    var graal = { tl: [{ t: 0, k: 'home' }], cur: { k: 'home' } };
    var balls = { t: Infinity, d: P.tballs, at: null };
    function cp(g) { return { hc: g.hc, rot: g.rot, vac: g.vac.slice() }; }
    function snap(lin) { return { t: s.t, x: s.x, y: s.y, h: s.h, A: cp(s.A), B: cp(s.B), lin: !!lin }; }
    K.push(snap());
    var stepNo = 0;
    function seg(d, label) { segs.push({ t0: s.t, t1: s.t + d, label: label, step: stepNo }); }
    function adv(d, label) { seg(d, label); s.t += d; K.push(snap()); applyOpp(s.t); }
    function poseNow() { return { x: s.x, y: s.y, h: s.h, A: cp(s.A), B: cp(s.B) }; }
    function fk(f) { return f === 'A' ? 0 : 1; }
    function stoneFoot(st, pose) {
      var c = st.cur;
      if (c.k === 'home') { var pk = PK[st.pk]; return { foot: rectPoly({ cx: pk.x, cy: pk.y, hl: 160, hn: 55, ang: pk.tan + 90 }), top: 110 * st.l + 110, bottom: 110 * st.l }; }
      if (c.k === 'held') { var p = pose || poseNow(); return geomHeld(p, c.f, c.l); }
      return c.geo;
    }
    function geomHeld(p, f, l) {
      var g = p[f], th = g.rot * Math.PI / 180, fo = heldFoot(p, fk(f), l);
      var zc = g.hc + 110 * (l - 1) * Math.cos(th), hz = 160 * Math.abs(Math.sin(th)) + 55 * Math.abs(Math.cos(th));
      var zl = 110 * (l - 1) * Math.sin(th);
      return { foot: rectPoly(fo), fo: fo, top: zc + hz, bottom: zc - hz, zc: zc, vertical: Math.abs(Math.sin(th)) > 0.7, ul: zl, th: th, phi: p.h + 120 * fk(f), O: [p.x, p.y] };
    }
    function sat2(A, B) { return overlap(A, B, 1); }
    function heldVsFree(hg, fg) {
      if (!overlap(hg.foot, fg.foot, 1)) return false;
      if (hg.bottom >= fg.top - 1) return false;
      var t = lv(hg.phi), O = hg.O, umin = 1e9, umax = -1e9;
      fg.foot.forEach(function (v) { var u = (v[0] - O[0]) * t[0] + (v[1] - O[1]) * t[1]; umin = Math.min(umin, u); umax = Math.max(umax, u); });
      var c = Math.cos(hg.th), sn = Math.sin(hg.th);
      var rect = [[-160, -55], [160, -55], [160, 55], [-160, 55]].map(function (q) {
        /* pierre tenue dans le plan de la face : axe long tourné de th depuis la latérale */
        return [hg.ul + q[0] * c + q[1] * sn, hg.zc - q[0] * sn + q[1] * c];
      });
      var box = [[umin, fg.bottom], [umax, fg.bottom], [umax, fg.top], [umin, fg.top]];
      return overlap(rect, box, 1);
    }
    function freeStones(excl) { return stones.filter(function (st) { return st.cur.k !== 'held' && st.cur.k !== 'gone' && (!excl || excl.indexOf(st) < 0); }); }
    function heldStonesOf(f) { return held[f] && held[f].stack ? held[f].stack.filter(function (x) { return x; }) : []; }
    function robotPolys(p, extraHeld) {
      var polys = [{ P: triPoly(p), bottom: 0 }];
      ['A', 'B'].forEach(function (f) { heldStonesOf(f).forEach(function (st) { var g = geomHeld(p, f, st.l); polys.push({ P: g.foot, bottom: g.bottom }); }); });
      return polys;
    }
    function collides(p, excl, frGeo) {
      var tri = triPoly(p);
      if (!inTable(tri, 0)) return 'bord de table';
      var fr = frGeo || freeStones(excl).map(function (st) { var g = stoneFoot(st); g.id = st.id; return g; });
      for (var j = 0; j < fr.length; j++) if (overlap(tri, fr[j].foot, 1)) return fr[j].id;
      var oNow = oppAt(s.t);
      if (oNow && oNow.x != null && overlap(tri, triPoly(oNow), 1)) return 'robot adverse';
      var hs = [];
      ['A', 'B'].forEach(function (f) { heldStonesOf(f).forEach(function (st) { hs.push(geomHeld(p, f, st.l)); }); });
      for (var i = 0; i < hs.length; i++) {
        if (!inTable(hs[i].foot, 0)) return 'bord de table';
        for (var k = 0; k < fr.length; k++) if (heldVsFree(hs[i], fr[k])) return fr[k].id;
      }
      return null;
    }
    function hullRadius() {
      var p = { x: 0, y: 0, h: s.h, A: cp(s.A), B: cp(s.B) }, m = R3;
      robotPolys(p).forEach(function (o) { o.P.forEach(function (v) { m = Math.max(m, Math.hypot(v[0], v[1])); }); });
      return m;
    }
    /* ---- planification sur grille, test exact du robot à l'orientation d'arrivée ---- */
    var CELL = 40, GW = 75, GH = 50;
    function plan(goal, hGoal, excl) {
      var start = [s.x, s.y], fr = freeStones(excl).map(function (st) { var g = stoneFoot(st); g.id = st.id; return g; });
      var cache = new Int8Array(GW * GH);
      function free(i, j) {
        var k = j * GW + i; if (cache[k]) return cache[k] > 0;
        if (oppOccupies((i + 0.5) * CELL, (j + 0.5) * CELL, s.t)) { cache[k] = -1; return false; }
        var p = { x: (i + 0.5) * CELL, y: (j + 0.5) * CELL, h: hGoal, A: cp(s.A), B: cp(s.B) };
        var ok = !collides(p, null, fr); cache[k] = ok ? 1 : -1; return ok;
      }
      function cell(q) { return [Math.max(0, Math.min(GW - 1, Math.floor(q[0] / CELL))), Math.max(0, Math.min(GH - 1, Math.floor(q[1] / CELL)))]; }
      var sc = cell(start), gc = cell(goal), N = GW * GH, gS = new Float64Array(N).fill(Infinity), par = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
      var si = sc[1] * GW + sc[0], gi = gc[1] * GW + gc[0]; cache[si] = 1; cache[gi] = 1;
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
          var ng = gS[cur] + Math.hypot(dx, dy); if (ng < gS[ni]) { gS[ni] = ng; par[ni] = cur; push(ng + Math.hypot(nx - gc[0], ny - gc[1]), ni); }
        }
      }
      if (!found) return null;
      var path = [], c2 = gi; while (c2 >= 0) { var x = c2 % GW; path.push([(x + 0.5) * CELL, ((c2 - x) / GW + 0.5) * CELL]); c2 = par[c2]; }
      path.reverse(); path[0] = start; path[path.length - 1] = goal;
      function los(a, b) { var n = Math.ceil(dist(a, b) / 30); for (var k = 1; k < n; k++) { var q = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]; var c = cell(q); if (!free(c[0], c[1])) return false; } return true; }
      var out = [path[0]], i2 = 0;
      while (i2 < path.length - 1) { var jj = path.length - 1; while (jj > i2 + 1 && !los(path[i2], path[jj])) jj--; out.push(path[jj]); i2 = jj; }
      return out;
    }
    function travel(O, h, label, excl, speed) {
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
      var pts = (dist([s.x, s.y], O) < 60) ? null : plan(O, h, excl);
      if (!pts) pts = [[s.x, s.y], O];
      var L = 0; for (var i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
      var dh = angd(s.h, h), h0 = s.h;
      function splitAt(pp, d0) { var acc2 = 0, o2 = [pp[0]]; for (var q = 1; q < pp.length; q++) { var dd = dist(pp[q - 1], pp[q]); if (acc2 < d0 - 0.5 && acc2 + dd > d0 + 0.5) { var u = (d0 - acc2) / dd; o2.push([pp[q - 1][0] + (pp[q][0] - pp[q - 1][0]) * u, pp[q - 1][1] + (pp[q][1] - pp[q - 1][1]) * u]); } acc2 += dd; o2.push(pp[q]); } return o2; }
      /* modes : rotation au milieu, au début, à la fin, sur place avant, sur place après */
      var modes = L > 50 ? [[Math.min(200, L * 0.25), Math.max(Math.min(200, L * 0.25) + 1, L - Math.min(200, L * 0.25))], [0, Math.min(L, 450)], [Math.max(0, L - 450), L], ['avant'], ['apres']] : [[0, Math.max(L, 1)]];
      var fr = freeStones(excl).map(function (st) { var g = stoneFoot(st); g.id = st.id; return g; });
      function nodesFor(m) {
        var nodes = [];
        if (m[0] === 'avant') { nodes.push({ p: pts[0], h: h0 + dh, d: 0, rotOnly: true }); var a3 = 0; for (var q = 1; q < pts.length; q++) { a3 += dist(pts[q - 1], pts[q]); nodes.push({ p: pts[q], h: h0 + dh, d: a3 }); } return nodes; }
        if (m[0] === 'apres') { var a4 = 0; for (var q2 = 1; q2 < pts.length; q2++) { a4 += dist(pts[q2 - 1], pts[q2]); nodes.push({ p: pts[q2], h: h0, d: a4 }); } nodes.push({ p: pts[pts.length - 1], h: h0 + dh, d: a4, rotOnly: true }); return nodes; }
        var pp = splitAt(splitAt(pts, m[0]), m[1]), a5 = 0;
        for (var q3 = 1; q3 < pp.length; q3++) { a5 += dist(pp[q3 - 1], pp[q3]); var fh = Math.max(0, Math.min(1, (a5 - m[0]) / Math.max(1, m[1] - m[0]))); nodes.push({ p: pp[q3], h: h0 + dh * fh, d: a5 }); }
        return nodes;
      }
      function hitsFor(nodes) {
        var prev = { p: pts[0], h: h0 };
        for (var i = 0; i < nodes.length; i++) {
          var nd = nodes[i], n = Math.max(1, Math.ceil(Math.max(dist(prev.p, nd.p) / 30, Math.abs(nd.h - prev.h) / 8)));
          for (var k = 1; k <= n; k++) { var u = k / n, q = { x: prev.p[0] + (nd.p[0] - prev.p[0]) * u, y: prev.p[1] + (nd.p[1] - prev.p[1]) * u, h: prev.h + (nd.h - prev.h) * u, A: cp(s.A), B: cp(s.B) }; if (collides(q, null, fr)) return true; }
          prev = nd;
        }
        return false;
      }
      var chosen = null, pts0 = pts;
      for (var mi = 0; mi < modes.length && !chosen; mi++) { var nd = nodesFor(modes[mi]); if (!hitsFor(nd)) chosen = nd; }
      if (!chosen && dist([s.x, s.y], O) >= 60) {
        var alt = plan(O, h0, excl);
        if (alt) { pts = alt; L = 0; for (var i3 = 1; i3 < pts.length; i3++) L += dist(pts[i3 - 1], pts[i3]); var nd2 = nodesFor(['apres']); if (!hitsFor(nd2)) chosen = nd2; }
        if (!chosen) { pts = pts0; L = 0; for (var i5 = 1; i5 < pts.length; i5++) L += dist(pts[i5 - 1], pts[i5]); }
      }
      if (!chosen) chosen = nodesFor(modes[0]);
      var tMove = L / (speed || V), tRot = Math.abs(dh) / WR, rotOnlyN = chosen.filter(function (x) { return x.rotOnly; }).length;
      var D = rotOnlyN ? tMove + tRot : Math.max(tMove, tRot), t0 = s.t;
      D = Math.max(D, 0.2);
      seg(D, label);
      chosen.forEach(function (nd) {
        var tt = rotOnlyN ? (nd.rotOnly ? (nd.d > 0 ? tMove + tRot : tRot) : (chosen[0].rotOnly ? tRot : 0) + (L > 0 ? nd.d / L : 1) * tMove) : (L > 0 ? nd.d / L : 1) * D;
        s.x = nd.p[0]; s.y = nd.p[1]; s.h = nd.h; s.t = t0 + Math.min(tt, D); K.push(snap(chosen.length > 1));
      });
      s.x = O[0]; s.y = O[1]; s.h = h0 + dh; s.t = t0 + D;
      applyOpp(s.t);
    }
    function lin(O, h, v, label) {
      var d = Math.max(dist([s.x, s.y], O) / v, Math.abs(angd(s.h, h)) / WR, 0.15);
      s.x = O[0]; s.y = O[1]; s.h = s.h + angd(s.h, h); adv(d, label);
    }
    function zz(f, hc, label) { if (Math.abs(hc - s[f].hc) < 0.5) return; var d = Math.max(Math.abs(hc - s[f].hc) / VZ, 0.1); s[f].hc = hc; adv(d, label); }
    function rr(f, deg, label) { if (Math.abs(deg - s[f].rot) < 0.5) return; var d = Math.max(TR * Math.abs(deg - s[f].rot) / 90, 0.1); s[f].rot = deg; adv(d, label); }
    function vac(f, arr, label, dur) { s[f].vac = arr; K.push(snap()); adv(dur, label); }
    function release(st, f) { var g = geomHeld(poseNow(), f, st.l); st.cur = { k: 'free', geo: g, pose: poseNow(), f: f, l: st.l }; st.tl.push({ t: s.t, k: 'free', pose: poseNow(), f: f, l: st.l }); }
    function err(msg) { errors.push({ step: stepNo, msg: msg }); stepInfo[stepNo - 1].err = msg; }
    function nv2(a) { return nv(a); }
    function choose(cands, excl, backDist, normalOnly) {
      var nn = cands.length, sc = new Array(nn), ord = new Array(nn), cols = new Array(nn), i;
      if (!nn) return null;
      for (i = 0; i < nn; i++) {
        var c0 = cands[i];
        sc[i] = (c0.pen || 0) + dist([s.x, s.y], c0.O) * 0.2 + Math.abs(angd(s.h, c0.h)) * 0.5;
        ord[i] = i;
      }
      ord.sort(function (x, y) { return sc[x] - sc[y] || x - y; });
      function colOf(c) {
        var p = { x: c.O[0], y: c.O[1], h: c.h, A: cp(s.A), B: cp(s.B) };
        if (c.setA) p.A = Object.assign(p.A, c.setA); if (c.setB) p.B = Object.assign(p.B, c.setB);
        var col = c.check ? c.check(p) : collides(p, excl);
        if (!col && backDist) {
          var nnv = nv(c.phi), tt = lv(c.phi), bopts = [[c.O[0] - backDist * nnv[0], c.O[1] - backDist * nnv[1]]];
          if (!normalOnly) bopts.push([c.O[0] + 170 * tt[0] - 8 * nnv[0], c.O[1] + 170 * tt[1] - 8 * nnv[1]], [c.O[0] - 170 * tt[0] - 8 * nnv[0], c.O[1] - 170 * tt[1] - 8 * nnv[1]]);
          var okB = null;
          for (var q = 0; q < bopts.length && !okB; q++) { var pb = { x: bopts[q][0], y: bopts[q][1], h: c.h, A: cp(s.A), B: cp(s.B) }; if (c.backCheck ? !c.backCheck(pb) : !collides(pb, excl)) okB = bopts[q]; }
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

    var steps = {
      prendre: function (st) {
        var f = st.f; if (held[f]) return err('La face ' + f + ' tient déjà quelque chose.');
        var idx = -1; PK.forEach(function (pk, i) { if (pk.id === st.p) idx = i; }); if (idx < 0) return err('Paquet inconnu.');
        var sts = stackStones(idx);
        if (sts.some(function (x) { return x.cur.k === 'gone'; })) return err('Le paquet ' + st.p + ' n\'est plus là (pris par l\'adversaire).');
        if (sts.some(function (x) { return x.cur.k === 'held'; })) return err('Le paquet ' + st.p + ' est déjà tenu.');
        var tag = sts[0].tag;
        if (!sts.every(function (x) { return x.tag === tag; }) || (tag !== 'home' && sts[0].cur.geo.vertical)) return err('Les pierres de ' + st.p + ' ne sont plus empilées.');
        var sc = stackCenter(sts), cands = [];
        [sc.tan + 90, sc.tan - 90].forEach(function (phi) { var n = nv2(phi); cands.push({ O: [sc.c[0] - (rin + 55) * n[0], sc.c[1] - (rin + 55) * n[1]], h: phi - 120 * fk(f), phi: phi }); });
        var b = choose(cands, sts, 80, true); if (!b) return err('Aucune position de prise.');
        if (b.col) err('Prise de ' + st.p + ' : contact possible avec ' + b.col + '.');
        var n = nv2(b.c.phi), Ob = [b.c.O[0] - 80 * n[0], b.c.O[1] - 80 * n[1]];
        travel(Ob, b.c.h, 'Face ' + f + ' vers le paquet ' + st.p, sts);
        if (sts.some(function (x) { return x.cur.k === 'gone'; })) return err('Le paquet ' + st.p + ' n\'est plus là (pris par l\'adversaire).');
        rr(f, 0, 'Pince ' + f + ' à plat'); zz(f, 165, 'Pince ' + f + ' à la hauteur de la pile');
        lin(b.c.O, b.c.h, VA, 'Contact avec ' + st.p);
        sts.forEach(function (x) { x.cur = { k: 'held', f: f, l: x.l }; x.tl.push({ t: s.t, k: 'held', f: f, l: x.l }); x.tag = null; });
        held[f] = { stack: [sts[0], sts[1], sts[2]] };
        vac(f, [1, 1, 1], 'Vide face ' + f + ' sur ' + st.p, TV);
        zz(f, 180, 'Levée de 15 mm');
        lin(Ob, b.c.h, VA, 'Recul avec ' + st.p);
      },
      mur: function (st) {
        var f = st.f, z = zoneById(st.z); var hs = heldStonesOf(f);
        if (!z || !z.tan && z.tan !== 0) return err('Zone de mur inconnue.');
        if (hs.length !== 3 || s[f].rot !== 0) return err('Il faut une pile de 3 pierres à plat sur la face ' + f + '.');
        var sides = st.side === 'ext' ? [z.nin] : st.side === 'int' ? [z.nin + 180] : [z.nin, z.nin + 180];
        var cands = [];
        sides.forEach(function (phi, si) {
          var n = nv2(phi), t = lv(phi);
          [0, 10, -10, 20, -20, 30, -30, 40, -40].forEach(function (sl) { [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, -5, -10, -15, -20, -25, -30, -35, -40, -45].forEach(function (ac) {
            var C = [z.c[0] + sl * t[0] + ac * n[0], z.c[1] + sl * t[1] + ac * n[1]];
            cands.push({ O: [C[0] - (rin + 55) * n[0], C[1] - (rin + 55) * n[1]], h: phi - 120 * fk(f), phi: phi, pen: (Math.abs(sl) + Math.abs(ac)) * 4 + si * 50, setF: { hc: 165 } });
          }); });
        });
        cands.forEach(function (c) { if (f === 'A') c.setA = c.setF; else c.setB = c.setF; });
        var b = choose(cands, null, 85); if (b.col) err('Pose sur ' + z.id + ' : contact possible avec ' + b.col + '.');
        var n = nv2(b.c.phi), Ob = b.c.Ob || [b.c.O[0] - 85 * n[0], b.c.O[1] - 85 * n[1]];
        travel(Ob, b.c.h, 'Face ' + f + ' vers ' + z.id + ' (' + z.name + ')');
        lin(b.c.O, b.c.h, VA, 'Approche de ' + z.id);
        zz(f, 165, 'Descente de 15 mm');
        var tag = 'w' + s.t.toFixed(3) + f; hs.forEach(function (x) { release(x, f); x.tag = tag; });
        held[f] = null; vac(f, [0, 0, 0], 'Vide coupé : mur posé sur ' + z.id, TL);
        lin(Ob, b.c.h, VA, 'Recul');
      },
      tour: function (st) {
        var f = st.f, z = zoneById(st.z), hs = heldStonesOf(f);
        if (!z || z.tan !== undefined) return err('Zone de tour inconnue.');
        var target = hs.filter(function (x) { return x.id === st.s; })[0]; if (!target) return err('La pierre ' + st.s + ' n\'est pas tenue par la face ' + f + '.');
        if (Math.abs(s[f].rot) < 1) { zz(f, 250, 'Levée pour la rotation'); rr(f, 90, 'Rotation de 90° : pierres debout'); zz(f, 175, 'Descente à 175 mm'); }
        var sg = Math.sign(s[f].rot), best = null;
        for (var off = 0; off <= 140 && !(best && !best.col); off += 10) {
          var cands = [];
          for (var phi = 0; phi < 360; phi += 10) for (var da = 0; da < 360; da += (off ? 30 : 360)) {
            var d = nv2(da), Pt = [z.c[0] + off * d[0], z.c[1] + off * d[1]], n = nv2(phi), t = lv(phi), zl = sg * 110 * (target.l - 1);
            cands.push({ O: [Pt[0] - (rin + 55) * n[0] - zl * t[0], Pt[1] - (rin + 55) * n[1] - zl * t[1]], h: phi - 120 * fk(f), phi: phi, pen: off * 10, Pt: Pt });
          }
          cands.forEach(function (c) { var o = {}; o[f] = { hc: 160 }; if (f === 'A') c.setA = o.A; else c.setB = o.B; });
          var b = choose(cands, null, 80, true); if (b && (!best || (best.col && !b.col))) best = b;
        }
        if (best.col) err('Tour ' + z.id + ' : contact possible avec ' + best.col + '.');
        else if (dist(best.c.Pt, z.c) > 1) err('Tour ' + z.id + ' : pierre décalée de ' + Math.round(dist(best.c.Pt, z.c)) + ' mm du centre du cercle (place insuffisante).');
        var n = nv2(best.c.phi), Ob = [best.c.O[0] - 80 * n[0], best.c.O[1] - 80 * n[1]];
        travel(Ob, best.c.h, 'Face ' + f + ' vers la tour ' + z.id);
        lin(best.c.O, best.c.h, VA, 'Au-dessus du cercle ' + z.id);
        zz(f, 160, 'Descente au sol');
        release(target, f); target.tag = 't'; held[f].stack[target.l] = null;
        var v = s[f].vac.slice(); v[target.l] = 0; vac(f, v, 'Pierre ' + target.id + ' lâchée : tour ' + z.id, TL);
        zz(f, 175, 'Levée de 15 mm');
        lin(Ob, best.c.h, VA, 'Recul');
        if (!heldStonesOf(f).length) { held[f] = null; rr(f, 0, 'Retour de la rotation'); zz(f, 165, 'Pince ' + f + ' en position basse'); }
      },
      porte: function (st) {
        var f = st.f, z = zoneById(st.z), hs = heldStonesOf(f);
        if (!z || z.tan === undefined) return err('Zone de mur inconnue.');
        if (hs.length !== 3 || s[f].rot !== 0) return err('Il faut une pile de 3 pierres à plat sur la face ' + f + '.');
        var sides = st.side === 'ext' ? [z.nin] : st.side === 'int' ? [z.nin + 180] : [z.nin, z.nin + 180], cands = [];
        sides.forEach(function (phi, si) { [1, -1].forEach(function (sg) {
          var n = nv2(phi), t = lv(phi), u0 = 55 * sg, O1 = [z.c[0] - (rin + 55) * n[0] + u0 * t[0], z.c[1] - (rin + 55) * n[1] + u0 * t[1]];
          cands.push({ O: O1, h: phi - 120 * fk(f), phi: phi, sg: sg, pen: si * 50, check: function (p) { var o = p[f]; o.hc = 160; o.rot = 90 * sg; return collides(p); },
            sweep: true });
        }); });
        cands.forEach(function (c) {
          var n0 = nv2(c.phi);
          for (var bd = 100; bd <= 300 && !c.Ob; bd += 50) {
            var ok = true, pb0 = [c.O[0] - bd * n0[0], c.O[1] - bd * n0[1]];
            for (var a = 0; a <= 90 && ok; a += 15) { var pb = { x: pb0[0], y: pb0[1], h: c.h, A: cp(s.A), B: cp(s.B) }; pb[f].hc = 250; pb[f].rot = a * c.sg; if (collides(pb)) ok = false; }
            if (ok) c.Ob = pb0;
          }
          if (!c.Ob) c.pen += 1e6;
        });
        var b = choose(cands); if (b.col) err('Porte ' + z.id + ' : contact possible avec ' + b.col + '.');
        if (!b.c.Ob) err('Porte ' + z.id + ' : pas de place pour tourner la pile.');
        var c = b.c, n = nv2(c.phi), t = lv(c.phi), O2 = [z.c[0] - (rin + 55) * n[0], z.c[1] - (rin + 55) * n[1]], Ob = c.Ob || [c.O[0] - 100 * n[0], c.O[1] - 100 * n[1]];
        travel(Ob, c.h, 'Face ' + f + ' vers ' + z.id + ' pour la porte');
        zz(f, 250, 'Levée pour la rotation'); rr(f, 90 * c.sg, 'Rotation de 90° : pierres debout'); zz(f, 175, 'Descente à 175 mm');
        lin(c.O, c.h, VA, 'Pierres au-dessus de ' + z.id);
        zz(f, 160, 'Descente au sol');
        [hs[0], hs[1]].forEach(function (x) { release(x, f); x.tag = 'p'; held[f].stack[x.l] = null; });
        vac(f, [0, 0, 1], '2 piliers posés', TL);
        zz(f, 320, 'Levée à 320 mm'); rr(f, 0, 'Retour de la rotation : linteau horizontal');
        lin(O2, c.h, VA, 'Centrage du linteau');
        zz(f, 265, 'Pose du linteau (petites ventouses en bas)');
        release(hs[2], f); hs[2].tag = 'l'; held[f] = null;
        vac(f, [0, 0, 0], 'Linteau posé : porte terminée sur ' + z.id, TL);
        lin([O2[0] - 100 * n[0], O2[1] - 100 * n[1]], c.h, VA, 'Recul'); zz(f, 165, 'Pince ' + f + ' en position basse');
      },
      boulets: function () {
        if (balls.t < Infinity) return err('Les boulets ont déjà été lâchés.');
        var O = [tx(2184, P.team), 1000], h = th(120, P.team);
        travel(O, h, 'Trappe vers la cour adverse');
        var n = nv2(s.h + 240); balls.t = s.t; balls.at = [s.x + (rin + 40) * n[0], s.y + (rin + 40) * n[1]];
        adv(P.tballs, '10 boulets lâchés un par un dans la cour adverse');
      },
      prendreGraal: function (st) {
        var f = st.f; if (held[f]) return err('La face ' + f + ' doit être vide pour prendre le Graal.');
        if (graal.cur.k !== 'home' && graal.cur.k !== 'free') return err('Le Graal est déjà tenu.');
        var G = graal.cur.k === 'home' ? [P.gx, P.gy] : graal.cur.c, gz = graal.cur.k === 'home' ? GS / 2 : graal.cur.z, cands = [];
        for (var phi = 0; phi < 360; phi += 15) { var n = nv2(phi); cands.push({ O: [G[0] - (rin + GS / 2) * n[0], G[1] - (rin + GS / 2) * n[1]], h: phi - 120 * fk(f), phi: phi }); }
        var b = choose(cands, null, 80, true); if (b.col) err('Prise du Graal : contact possible avec ' + b.col + '.');
        var n2 = nv2(b.c.phi), Ob = [b.c.O[0] - 80 * n2[0], b.c.O[1] - 80 * n2[1]];
        travel(Ob, b.c.h, 'Face ' + f + ' vers le Graal');
        rr(f, 0, 'Pince à plat'); zz(f, gz + 110, 'Ventouse du Graal à sa hauteur');
        lin(b.c.O, b.c.h, VA, 'Contact avec le Graal');
        graal.cur = { k: 'held', f: f }; graal.tl.push({ t: s.t, k: 'held', f: f }); held[f] = { graal: true };
        var v = s[f].vac.slice(); v[0] = 1; vac(f, v, 'Vide sur le Graal', TV);
        zz(f, gz + 130, 'Levée de 20 mm');
        lin(Ob, b.c.h, VA, 'Recul avec le Graal');
      },
      poserGraal: function (st) {
        var f = st.f; if (!held[f] || !held[f].graal) return err('La face ' + f + ' ne tient pas le Graal.');
        var z = zoneById(st.z); if (!z) return err('Zone inconnue.');
        var zr = z.tan !== undefined ? zoneRect(z) : null, inZ = freeStones().filter(function (x) { var g = stoneFoot(x); return zr ? overlap(g.foot, zr, 0) : ptPolyD(z.c, g.foot) < 100; });
        if (!inZ.length) return err('Aucune construction dans ' + z.id + '.');
        var top = 0; inZ.forEach(function (x) { top = Math.max(top, stoneFoot(x).top); });
        var tops = inZ.filter(function (x) { return stoneFoot(x).top > top - 1; }), cc = [0, 0], pts = [];
        tops.forEach(function (x) { var fo = stoneFoot(x).foot; fo.forEach(function (v) { pts.push(v); }); var g = stoneFoot(x); cc[0] += (g.fo ? g.fo.cx : z.c[0]) / tops.length; cc[1] += (g.fo ? g.fo.cy : z.c[1]) / tops.length; });
        var cands = [];
        for (var phi = 0; phi < 360; phi += 15) {
          var n = nv2(phi), e = 1e9; pts.forEach(function (v) { e = Math.min(e, (v[0] - cc[0]) * n[0] + (v[1] - cc[1]) * n[1]); });
          var Gc = [cc[0] + (e + GS / 2) * n[0], cc[1] + (e + GS / 2) * n[1]];
          cands.push({ O: [Gc[0] - (rin + GS / 2) * n[0], Gc[1] - (rin + GS / 2) * n[1]], h: phi - 120 * fk(f), phi: phi, Gc: Gc });
        }
        var b = choose(cands, null, 100, true); if (b.col) err('Pose du Graal : contact possible avec ' + b.col + '.');
        var n2 = nv2(b.c.phi), Ob = [b.c.O[0] - 100 * n2[0], b.c.O[1] - 100 * n2[1]], hcp = top + GS / 2 + 110;
        travel(Ob, b.c.h, 'Face ' + f + ' vers ' + z.id + ' avec le Graal');
        zz(f, hcp + 5, 'Montée du Graal au-dessus de ' + z.id);
        lin(b.c.O, b.c.h, VA, 'Graal au-dessus de ' + z.id);
        zz(f, hcp, 'Pose du Graal');
        graal.cur = { k: 'free', c: b.c.Gc, z: top + GS / 2, pose: poseNow(), f: f, top: top + GS }; graal.tl.push({ t: s.t, k: 'free', pose: poseNow(), f: f, top: top + GS, c: b.c.Gc, zone: z.id });
        held[f] = null; var v = s[f].vac.slice(); v[0] = 0; vac(f, v, 'Graal posé sur ' + z.id + ' (haut à ' + Math.round(top + GS) + ' mm)', TL);
        lin(Ob, b.c.h, VA, 'Recul'); zz(f, 165, 'Pince ' + f + ' en position basse');
      },
      attendre: function (st) { adv(Math.max(0, +st.sec || 0), 'Attente de ' + (+st.sec || 0) + ' s'); },
      attendreJusqua: function (st) { var tt = +st.sec || 0; if (s.t < tt) adv(tt - s.t, 'Attente jusqu\'à ' + tt + ' s'); },
      trone: function () { travel([tx(250, P.team), 1000], s.h, 'Retour dans la salle du trône'); }
    };
    var program = [];
    var oppApplied = {};
    function vanishPacket(pkId, t) {
      var idx = -1; PK.forEach(function (pk, i) { if (pk.id === pkId) idx = i; });
      if (idx < 0) return;
      stackStones(idx).forEach(function (st) {
        if (st.cur.k === 'held') return;
        st.cur = { k: 'gone' }; st.tag = 'gone'; st.tl.push({ t: t, k: 'gone' });
      });
    }
    function applyOpp(t) {
      var taken = P.oppTaken || {};
      Object.keys(taken).forEach(function (id) {
        if (oppApplied[id] || t < taken[id]) return;
        var idx = -1; PK.forEach(function (pk, i) { if (pk.id === id) idx = i; });
        if (idx >= 0 && stackStones(idx).some(function (x) { return x.cur.k === 'held'; })) { oppApplied[id] = true; return; }
        vanishPacket(id, taken[id]); oppApplied[id] = true;
      });
    }
    function exec(st) {
      program.push(st);
      var i = stepInfo.length;
      stepNo = i + 1; stepInfo.push({ t0: s.t });
      var t0 = s.t;
      applyOpp(s.t);
      try { (steps[st.a] || function () { err('Action inconnue.'); })(st); } catch (e) { err('Erreur interne : ' + e.message); }
      applyOpp(s.t);
      stepInfo[i].t1 = s.t;
      return { t0: t0, t1: s.t, dt: s.t - t0, err: stepInfo[i].err || null };
    }
    function attach(res) {
      res.poseAt = function (t) { return poseAtK(K, t); };
      res.stoneAt = function (st, t) { var e = st.tl[0]; for (var i = 0; i < st.tl.length; i++) if (st.tl[i].t <= t) e = st.tl[i]; return e; };
      return res;
    }
    function contactsOf(res) {
      var last = '', collisions = [];
      for (var tt = 0; tt <= s.t; tt += 0.1) {
        var p = res.poseAt(tt), tri = triPoly(p), hs = [], free = [];
        stones.forEach(function (st) {
          var e = res.stoneAt(st, tt);
          if (e.k === 'held') hs.push(geomHeld(p, e.f, e.l));
          else if (e.k === 'home') { var pk = PK[st.pk]; free.push({ id: st.id, foot: rectPoly({ cx: pk.x, cy: pk.y, hl: 160, hn: 55, ang: pk.tan + 90 }), top: 110 * st.l + 110, bottom: 110 * st.l }); }
          else if (e.k !== 'gone') { var g2 = geomHeld(e.pose, e.f, e.l); free.push({ id: st.id, foot: g2.foot, top: g2.top, bottom: g2.bottom }); }
        });
        var hit = [];
        if (!inTable(tri, -1)) hit.push('bord de table');
        free.forEach(function (fs) { if (overlap(tri, fs.foot, 1.5)) hit.push(fs.id); });
        hs.forEach(function (h) { if (!inTable(h.foot, -1)) hit.push('bord de table'); free.forEach(function (fs) { if (heldVsFree(h, fs)) hit.push(fs.id); }); });
        var key = Array.from(new Set(hit)).join(', ');
        if (key && key !== last) collisions.push({ t: tt, with: key });
        last = key;
      }
      return collisions;
    }
    function result(doContacts) {
      var res = attach({ K: K, segs: segs, stones: stones, graal: graal, balls: balls, errors: errors, stepInfo: stepInfo, T: s.t, program: program.slice(), PK: PK, ZM: ZM, ZT: ZT, THRONE: throneOf(P.team), CASTLE: CASTLE, params: P });
      res.collisions = doContacts === false || opts.skipContacts ? [] : contactsOf(res);
      return res;
    }
    function finish() { adv(0.5, 'Fin du programme'); return result(true); }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function snapshot() {
      return { s: clone(s), stones: clone(stones), graal: clone(graal), balls: clone(balls), K: clone(K), segs: clone(segs), errors: clone(errors), stepInfo: clone(stepInfo), stepNo: stepNo, program: clone(program), oppApplied: clone(oppApplied), held: serializeHeld() };
    }
    function serializeHeld() {
      var h = {};
      ['A', 'B'].forEach(function (f) {
        if (!held[f]) h[f] = null;
        else if (held[f].graal) h[f] = { graal: true };
        else h[f] = { stack: (held[f].stack || []).map(function (st) { return st ? st.id : null; }) };
      });
      return h;
    }
    function restoreHeld(h) {
      var byId = {}; stones.forEach(function (st) { byId[st.id] = st; });
      held = { A: null, B: null };
      ['A', 'B'].forEach(function (f) {
        if (!h[f]) return;
        if (h[f].graal) { held[f] = { graal: true }; return; }
        held[f] = { stack: h[f].stack.map(function (id) { return id ? byId[id] : null; }) };
      });
    }
    function restore(snap) {
      s = clone(snap.s); stones = clone(snap.stones); graal = clone(snap.graal); balls = clone(snap.balls);
      K = clone(snap.K); segs = clone(snap.segs); errors = clone(snap.errors); stepInfo = clone(snap.stepInfo);
      stepNo = snap.stepNo; program = clone(snap.program); oppApplied = clone(snap.oppApplied);
      restoreHeld(snap.held);
    }
    function pose() { return poseNow(); }
    function getHeld() { return held; }
    function getStones() { return stones; }
    function getGraal() { return graal; }
    function getBalls() { return balls; }
    function time() { return s.t; }
    function params() { return P; }
    return { exec: exec, finish: finish, result: result, snapshot: snapshot, restore: restore, pose: pose, held: getHeld, stones: getStones, graal: getGraal, balls: getBalls, time: time, params: params, program: function () { return program.slice(); } };
  }
  function simulate(prog, P, opts) {
    var sim = makeSim(P, opts);
    (prog || []).forEach(function (st) { sim.exec(st); });
    return sim.finish();
  }
  function poseAtK(K, t) {
    if (t <= K[0].t) return K[0];
    for (var i = 1; i < K.length; i++) {
      if (t <= K[i].t) {
        var a = K[i - 1], b = K[i], d = b.t - a.t, k = d > 0 ? (t - a.t) / d : 1, e = b.lin ? k : k * k * (3 - 2 * k);
        var L = function (x, y) { return x + (y - x) * e; };
        var g = function (ga, gb) { return { hc: L(ga.hc, gb.hc), rot: L(ga.rot, gb.rot), vac: ga.vac }; };
        return { t: t, x: L(a.x, b.x), y: L(a.y, b.y), h: L(a.h, b.h), A: g(a.A, b.A), B: g(a.B, b.B) };
      }
    }
    return K[K.length - 1];
  }
  function extractOpp(R) {
    var taken = {};
    (R.stepInfo || []).forEach(function (inf, i) {
      var st = R.program && R.program[i];
      if (st && st.a === 'prendre' && !inf.err) taken[st.p] = inf.t1;
    });
    return {
      taken: taken,
      none: false,
      result: R,
      poseAt: function (t) { return poseAtK(R.K, t); }
    };
  }
  function simulateMatch(prog, P, opts) {
    opts = opts || {};
    var intensity = opts.intensity || (opts.adversaire && opts.adversaire.intensite) || 'aucun';
    var oppSrc = opts.opponent;
    var Ropp = null, ev = { taken: {}, none: true, poseAt: null };
    if (oppSrc && oppSrc.program && oppSrc.program.length && intensity !== 'aucun' && intensity !== 'none') {
      var Pb = intensityParams(blueParams(oppSrc.params || P), intensity);
      Ropp = simulate(oppSrc.program.map(mirrorStep), Pb, { skipContacts: true });
      ev = extractOpp(Ropp);
    }
    var R = simulate(prog, Object.assign({}, P || {}, { oppTaken: ev.taken }), { skipContacts: opts.skipContacts, oppPoseAt: ev.poseAt });
    R.opponent = Ropp;
    R.oppEvents = { taken: ev.taken, none: ev.none };
    return R;
  }
  var api = {
    VERSION: VERSION, MATCH: MATCH, DEF: DEF, simulate: simulate, simulateMatch: simulateMatch, makeSim: makeSim,
    poseAtK: poseAtK, extractOpp: extractOpp, mirrorId: mirrorId, mirrorStep: mirrorStep, blueParams: blueParams,
    intensityParams: intensityParams, PK: PK, ZM: ZM, ZT: ZT, THRONE: THRONE, THRONE_B: THRONE_B, CASTLE: CASTLE,
    CASTLE_B: CASTLE_B, inPoly: inPoly, zoneById: zoneById, throneOf: throneOf, tx: tx, th: th
  };
  root.ENGINE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
