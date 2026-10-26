/* Géométrie partagée : robot, pierres, tests de recouvrement.
   Chargé par /plateau/, l'environnement d'entraînement et les tests Node. */
(function (root) {
  var GEO = { a: 400, rin: 400 / (2 * Math.sqrt(3)), R: 400 / Math.sqrt(3) };
  var QUARRIES = [];
  [750, 1250, 1750, 2250].forEach(function (x) { QUARRIES.push({ x: x, y: 55, rot: 0 }); });
  [750, 1250, 1750, 2250].forEach(function (x) { QUARRIES.push({ x: x, y: 1945, rot: 0 }); });
  QUARRIES.push({ x: 1500, y: 500, rot: 90 }); QUARRIES.push({ x: 1500, y: 1500, rot: 90 });
  function nv(deg) { var r = deg * Math.PI / 180; return [Math.cos(r), Math.sin(r)]; }
  function lv(deg) { var r = deg * Math.PI / 180; return [-Math.sin(r), Math.cos(r)]; }
  /* pierre tenue par la face k : centre 2D, demi-largeurs (latérale, normale), angle de la face */
  function heldFoot(p, k, l) {
    var g = k === 0 ? p.A : p.B, phi = p.h + 120 * k, n = nv(phi), t = lv(phi);
    var th = g.rot * Math.PI / 180, z = 110 * (l - 1) * Math.sin(th), hl = 160 * Math.abs(Math.cos(th)) + 55 * Math.abs(Math.sin(th));
    var d = GEO.rin + 55;
    return { cx: p.x + d * n[0] + z * t[0], cy: p.y + d * n[1] + z * t[1], hl: hl, hn: 55, ang: phi };
  }
  function rectPoly(f) {
    var n = nv(f.ang), t = lv(f.ang), P = [];
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (s) { P.push([f.cx + s[0] * f.hl * t[0] + s[1] * f.hn * n[0], f.cy + s[0] * f.hl * t[1] + s[1] * f.hn * n[1]]); });
    return P;
  }
  function triPoly(p) { var P = []; [180, 300, 60].forEach(function (a) { var v = nv(p.h + a); P.push([p.x + GEO.R * v[0], p.y + GEO.R * v[1]]); }); return P; }
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

  var api = { GEO: GEO, QUARRIES: QUARRIES, nv: nv, lv: lv, heldFoot: heldFoot, rectPoly: rectPoly, triPoly: triPoly, overlap: overlap };
  root.GEO = GEO; root.QUARRIES = QUARRIES; root.nv = nv; root.lv = lv;
  root.heldFoot = heldFoot; root.rectPoly = rectPoly; root.triPoly = triPoly; root.overlap = overlap;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
