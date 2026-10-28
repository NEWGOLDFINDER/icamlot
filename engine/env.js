/* Environnement d'apprentissage v3 (contrat §4 de docs/CONTRATS.md) : reset / step, croyance, observation, masque, récompense,
   adversaires (stratégie enregistrée, cerveau MLP « layers », modèle récurrent « icamlot-modele-recurrent »).

   Croyance (« belief ») : tout ce que le robot réel sait, en repère RÉEL de la table (mm, degrés). Le runner embarqué la remplit
   avec ses capteurs et appelle les mêmes fonctions pures ENV.observeBelief(belief, groupes) et ACTIONS.maskBelief(belief, catalogue).
   {
     version: 3,
     team: 'yellow' | 'blue',
     t: secondes depuis le départ,
     pose: { x, y, h },                         lidar (triangulation) ; h = normale de la face A ; B à h + 120, C à h + 240
     pinces: { A: { rot, hc, slots: [id|null, id|null, id|null] }, B: {...} }   codeurs + vide : angle (0/90/180), hauteur d'axe,
                                                 pierre tenue par rangée (1, 2, 3) ; id = 'P6.3' (paquet d'origine . niveau 1..3)
     meca: { can, fx, fz },                     canon sorti (mm), fourche de l'ascenseur (position, hauteur) : codeurs
     graal: 'home' | 'ascenseur' | 'toit' | 'retire',
     tir: booléen (séance de tir faite),
     adversaire: null | { x, y, vx, vy, t },    lidar : position (mm) et vitesse (mm/s) du robot adverse, instant de la mesure
     pierres: [ { id, pk, foot: [[x, y] x4], bottom, top, vertical, grp } ]   pierres posées par CE robot (il sait où il les a
                                                 lâchées) ; pk = index du paquet d'origine ; grp = pierres lâchées ensemble
     portes: [ 'M3', ... ],                     portes construites par ce robot (ids réels)
     paquets: { P1: { n, t }, ... },            caméras A et B : pierres encore à la carrière (0..3, de bas en haut) et instant de
                                                 l'information (0 = connaissance du règlement au départ) ; ids réels
     etrangeres: [ { foot, bottom, top } ] (facultatif), pierres de l'adversaire connues (non rempli par la simulation : hypothèse)
     echec: booléen,                            la dernière action a échoué (le robot le sait)
     echecs: { t, briques: [brique réelle] },   briques qui ont échoué à l'instant t sans faire avancer le temps (masquées à t)
     params: { gx, gy, ga, tx, ty, bn, tirDepuisTrone }   départ du Graal (réel) et réglages du tir, connus avant le match
   }
   La simulation construit la croyance depuis le moteur avec le modèle de caméras ENV.VISION (hypothèses, voir plus bas). */
(function (root) {
  var MATCH = 100;
  var OBS_VERSION = 'icamlot-obs-3.0';

  /* Modèle de visibilité des caméras des faces A et B : HYPOTHÈSES (spec/robot.json : modele_cameras_et_champ = « a_definir »).
     Une carrière est vue si son centre est à moins de portee mm de la caméra et à moins de demiAngle degrés de l'axe de la face.
     Pas d'occultation. Les instants de vue sont échantillonnés tous les pas secondes pendant chaque action. */
  var VISION = { demiAngle: 35, portee: 1500, pas: 0.5, masqueeParCharge: false,
    /* lidar : l'adversaire est toujours vu (pas d'occultation) ; vitesse estimée sur periodeLidar s (HYPOTHÈSES) */
    periodeLidar: 0.1 };
  /* Normalisations : bornes documentées, toutes les entrées sont dans [0, 1] (ou [-1, 1] pour cos/sin). */
  var NORM = { age: 100, rayonEnveloppe: 500, rayon: 1000, pasRayon: 25, rayonAdversaire: 212.35, ageAdversaire: 5 };
  /* vitesse de référence pour normaliser la vitesse adverse : la nôtre (spec/robot.json, vitesse_lineaire_mm_s) */
  function vRef() { var v = SPEC.robot.entrainement && SPEC.robot.entrainement.vitesse_lineaire_mm_s; return (v && v.valeur != null ? v.valeur : v) || ENGINE.DEF.v * 1000; }

  var GROUPS = [
    { id: 'temps', label: 'Temps', vars: [{ id: 'temps', nom: 'Temps', desc: 'temps restant / 100 s ; phase d\'attaque ouverte (t >= 85 s)', n: 2 }] },
    { id: 'robot', label: 'Robot', vars: [{ id: 'robot', nom: 'Pose et enveloppe', desc: 'x / 3000, y / 2000, cos(cap A), sin(cap A) (repère de l\'équipe), dans le château, dans la salle du trône, équipe bleue, rayon de l\'enveloppe (châssis + pierres) / 500 mm', n: 8 }] },
    { id: 'pinces', label: 'Pinces A et B', vars: [{ id: 'pinces', nom: 'État des pinces', desc: 'Pour A puis B : pierre en rangée 1, 2, 3 ; angle / 180 ; hauteur d\'axe (course 135-273 mm) ; pile de 3 à plat', n: 12 }] },
    { id: 'mecanismes', label: 'Canon et ascenseur', vars: [{ id: 'mecanismes', nom: 'Canon, fourche, tir', desc: 'canon sorti / course ; fourche : position, hauteur (normalisées) ; séance de tir faite', n: 4 }] },
    { id: 'graal', label: 'Graal', vars: [{ id: 'graal', nom: 'État du Graal', desc: 'au départ, sur la fourche, sur le toit, retiré', n: 4 }] },
    { id: 'paquets', label: 'Carrières (caméras)', vars: [{ id: 'paquets', nom: 'Pierres par carrière', desc: 'P1 à P10 (repère de l\'équipe) : pierres vues / 3, âge de l\'information / 100 s', n: 20 }] },
    { id: 'constructions', label: 'Constructions propres', vars: [{ id: 'constructions', nom: 'Murs, tours, stock', desc: 'M1-M5 : 0 vide, 0,5 occupée, 1 porte ; T1-T4 : occupée ; pierres stockées dans la cour / 3', n: 10 }] },
    { id: 'adversaire', label: 'Adversaire (lidar)', vars: [{ id: 'adversaire', nom: 'Position et vitesse adverses', desc: 'vu, x / 3000, y / 2000, vx / v, vy / v (repère de l\'équipe, v = notre vitesse, bornées à ±1), âge de la mesure / 5 s', n: 6 }] },
    { id: 'spatial', label: 'Dégagement', vars: [{ id: 'spatial', nom: 'Rayons', desc: 'distance libre (obstacles connus) dans 8 directions à partir de la face A, tous les 45° dans le sens trigonométrique du repère de l\'équipe, / 1000 mm', n: 8 }] },
    { id: 'echec', label: 'Retour d\'exécution', vars: [{ id: 'echec', nom: 'Échec', desc: 'la dernière action a échoué', n: 1 }] }
  ];
  var DEFAULT_GROUPS = GROUPS.map(function (g) { return g.id; });
  var GROUP_N = {}; GROUPS.forEach(function (g) { GROUP_N[g.id] = g.vars[0].n; });
  function nInputs(groups) { var n = 0; (groups || DEFAULT_GROUPS).forEach(function (id) { n += GROUP_N[id] || 0; }); return n; }

  var D2R = Math.PI / 180;
  function geo() { return root.GEOM.GEO; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function centroid(P) { var c = [0, 0]; P.forEach(function (v) { c[0] += v[0] / P.length; c[1] += v[1] / P.length; }); return c; }
  function angd(a, b) { return ((b - a) % 360 + 540) % 360 - 180; }
  function mirrorId(id) { return ENGINE.mirrorId(id); }
  function mirrorStep(st) { return ACTIONS.realStep(st, 'blue'); }
  function blueParams(base) { return ENGINE.blueParams(base); }

  /* ------------------------------------------------------------------ croyance construite depuis le moteur */
  function stoneStateAt(st, t) { var e = st.tl[0]; for (var i = 0; i < st.tl.length; i++) if (st.tl[i].t <= t + 1e-9) e = st.tl[i]; return e.k; }
  function newMemory() {
    var paquets = {}; ENGINE.PK.forEach(function (pk) { paquets[pk.id] = { n: 3, t: 0 }; });
    return { paquets: paquets, taken: {}, tVu: 0, echec: false };
  }
  function homeCountAt(sim, pkIdx, t) { return sim.stones().filter(function (s) { return s.pk === pkIdx && stoneStateAt(s, t) === 'home'; }).length; }
  /* mise à jour après une action jouée de t0 à t1 : vue des caméras, pierres prises par ce robot, échec de prise appris */
  function updateMemory(mem, sim, t0, t1, brick, info) {
    var held = sim.held();
    var times = []; for (var tt = Math.max(0, t0); tt < t1; tt += VISION.pas) times.push(tt); times.push(t1);
    times.forEach(function (tt) {
      var p = sim.poseAtT(tt);
      ['A', 'B'].forEach(function (f, k) {
        if (VISION.masqueeParCharge && held[f]) return;
        var ax = p.h + 120 * k;
        ENGINE.PK.forEach(function (pk, i) {
          var dx = pk.x - p.x, dy = pk.y - p.y, d = Math.hypot(dx, dy);
          if (d > VISION.portee || Math.abs(angd(ax, Math.atan2(dy, dx) / D2R)) > VISION.demiAngle) return;
          mem.paquets[pk.id] = { n: homeCountAt(sim, i, tt), t: tt };
        });
      });
    });
    /* pierres de carrière prises par ce robot : il le sait */
    ENGINE.PK.forEach(function (pk, i) {
      var mine = sim.stones().filter(function (s) { return s.pk === i && (s.cur.k === 'held' || s.cur.k === 'free'); }).length;
      if (mine !== (mem.taken[pk.id] || 0)) { mem.taken[pk.id] = mine; mem.paquets[pk.id] = { n: homeCountAt(sim, i, t1), t: t1 }; }
    });
    /* prise refusée parce que l'adversaire a pris (ou réservé) les pierres : le robot l'apprend en arrivant */
    if (brick && brick.a === 'prendre' && info && info.err && /n'est plus là|absente/.test(info.err)) {
      var pid = brick.p || (brick.s ? String(brick.s).split('.')[0] : null);
      if (pid && mem.paquets[pid]) mem.paquets[pid] = { n: 0, t: t1 };
    }
    mem.echec = !!(info && info.err);
    /* briques qui viennent d'échouer sans faire avancer le temps : le monde n'a pas changé, elles échoueraient encore */
    if (!mem.echecs || mem.echecs.t !== t1) mem.echecs = { t: t1, briques: [] };
    if (brick && info && info.err && t1 - t0 < 1e-9) mem.echecs.briques.push(JSON.parse(JSON.stringify(brick)));
    mem.tVu = t1;
  }
  /* mesure lidar simulée de l'autre robot à l'instant t : position et vitesse (différence sur periodeLidar) */
  function lidarOf(other, t) {
    if (!other) return null;
    var p = other.poseAtT(t), q = other.poseAtT(Math.max(0, t - VISION.periodeLidar)), dt = Math.min(t, VISION.periodeLidar);
    return { x: p.x, y: p.y, vx: dt > 0 ? (p.x - q.x) / dt : 0, vy: dt > 0 ? (p.y - q.y) / dt : 0, t: t };
  }
  function beliefFromSim(sim, mem, oppPose) {
    var P = sim.params(), p = sim.pose(), held = sim.held(), t = sim.time();
    function slots(f) { var h = held[f]; return h && h.stack ? h.stack.map(function (s) { return s ? s.id : null; }) : [null, null, null]; }
    var pierres = sim.stones().filter(function (s) { return s.cur.k === 'free' && s.cur.geo; }).map(function (s) {
      var g = s.cur.geo; return { id: s.id, pk: s.pk, foot: g.foot.map(function (v) { return [v[0], v[1]]; }), bottom: g.bottom, top: g.top, vertical: !!g.vertical, grp: s.tag };
    });
    var paquets = {}; Object.keys(mem.paquets).forEach(function (k) { paquets[k] = { n: mem.paquets[k].n, t: mem.paquets[k].t }; });
    var portes = sim.portes(), pl = []; Object.keys(portes).forEach(function (k) { if (portes[k]) pl.push(portes[k]); });
    return {
      version: 3, team: P.team || 'yellow', t: t,
      pose: { x: p.x, y: p.y, h: p.h },
      pinces: { A: { rot: p.A.rot, hc: p.A.hc, slots: slots('A') }, B: { rot: p.B.rot, hc: p.B.hc, slots: slots('B') } },
      meca: { can: p.C.can, fx: p.C.fx, fz: p.C.fz },
      graal: sim.graal().cur.k,
      tir: !!sim.balls().shots,
      adversaire: oppPose && oppPose.x != null ? { x: oppPose.x, y: oppPose.y, vx: oppPose.vx || 0, vy: oppPose.vy || 0, t: oppPose.t != null ? oppPose.t : t } : null,
      pierres: pierres, portes: pl, paquets: paquets, etrangeres: [], echec: !!mem.echec,
      echecs: mem.echecs ? { t: mem.echecs.t, briques: mem.echecs.briques.slice() } : { t: t, briques: [] },
      params: { gx: P.gx, gy: P.gy, ga: P.ga || 0, tx: P.tx, ty: P.ty, bn: P.bn, tirDepuisTrone: P.tirDepuisTrone }
    };
  }

  /* ------------------------------------------------------------------ observation (fonction pure de la croyance) */
  function observeBelief(b, groups) {
    groups = groups || DEFAULT_GROUPS;
    var blue = b.team === 'blue', out = [];
    function X(x) { return blue ? 3000 - x : x; }
    function H(h) { return blue ? 180 - h : h; }
    function own(id) { return blue ? mirrorId(id) : id; }
    function push() { for (var i = 0; i < arguments.length; i++) out.push(arguments[i]); }
    var G = root.GEOM, GE = geo();
    groups.forEach(function (id) {
      if (id === 'temps') push(clamp01((MATCH - b.t) / MATCH), b.t >= ENGINE.T_ATTAQUE ? 1 : 0);
      else if (id === 'robot') {
        var h = H(b.pose.h) * D2R, r = GE.R;
        ['A', 'B'].forEach(function (f) { (b.pinces[f].slots || []).forEach(function (sid, l) { if (sid) ACTIONS.heldFootAt(b, f, l).forEach(function (v) { r = Math.max(r, Math.hypot(v[0] - b.pose.x, v[1] - b.pose.y)); }); }); });
        push(clamp01(X(b.pose.x) / 3000), clamp01(b.pose.y / 2000), Math.cos(h), Math.sin(h),
          ENGINE.inPoly(b.pose.x, b.pose.y, ENGINE.castleOf(b.team)) ? 1 : 0, ENGINE.inPoly(b.pose.x, b.pose.y, ENGINE.throneOf(b.team)) ? 1 : 0,
          blue ? 1 : 0, clamp01(r / NORM.rayonEnveloppe));
      } else if (id === 'pinces') {
        ['A', 'B'].forEach(function (f) {
          var g = b.pinces[f], sl = g.slots || [null, null, null];
          push(sl[0] ? 1 : 0, sl[1] ? 1 : 0, sl[2] ? 1 : 0, clamp01(g.rot / 180), clamp01((g.hc - GE.hcMin) / (GE.hcMax - GE.hcMin)), sl[0] && sl[1] && sl[2] && Math.abs(g.rot) < 0.5 ? 1 : 0);
        });
      } else if (id === 'mecanismes') {
        var F = GE.fourche;
        push(clamp01(b.meca.can / GE.canon.course), clamp01((b.meca.fx - F.fxRentree) / (F.fxSortie - F.fxRentree)), clamp01((b.meca.fz - F.fzBas) / (F.fzHaut - F.fzBas)), b.tir ? 1 : 0);
      } else if (id === 'graal') push(b.graal === 'home' ? 1 : 0, b.graal === 'ascenseur' ? 1 : 0, b.graal === 'toit' ? 1 : 0, b.graal === 'retire' ? 1 : 0);
      else if (id === 'paquets') {
        ACTIONS.PACKS.forEach(function (pid) { var q = b.paquets[own(pid)] || { n: 3, t: 0 }; push(clamp01(q.n / 3), clamp01((b.t - q.t) / NORM.age)); });
      } else if (id === 'constructions') {
        var feet = (b.pierres || []).map(function (s) { return { c: centroid(s.foot), v: s.vertical }; });
        ACTIONS.MURS.forEach(function (z) {
          var zr = ENGINE.zoneById(own(z)), R = ENGINE.zoneRect(zr);
          var occ = feet.some(function (s) { return ENGINE.inPoly(s.c[0], s.c[1], R); });
          push((b.portes || []).indexOf(own(z)) >= 0 ? 1 : occ ? 0.5 : 0);
        });
        var ztr = SPEC.regles.remparts_jaune.tour_diametre / 2;
        ACTIONS.TOURS.forEach(function (z) { var c = ENGINE.zoneById(own(z)).c; push(feet.some(function (s) { return Math.hypot(s.c[0] - c[0], s.c[1] - c[1]) < ztr; }) ? 1 : 0); });
        push(clamp01(ACTIONS.stockCount(b) / SPEC.regles.construction.stockage_max_cour));
      } else if (id === 'adversaire') {
        var o = b.adversaire;
        var vr = vRef(), cl = function (v) { return Math.max(-1, Math.min(1, v)); };
        if (o && o.x != null) push(1, clamp01(X(o.x) / 3000), clamp01(o.y / 2000), cl((blue ? -1 : 1) * (o.vx || 0) / vr), cl((o.vy || 0) / vr), clamp01((b.t - (o.t != null ? o.t : b.t)) / NORM.ageAdversaire));
        else push(0, 0, 0, 0, 0, 0);
      } else if (id === 'spatial') rays(b).forEach(function (v) { out.push(v); });
      else if (id === 'echec') push(b.echec ? 1 : 0);
    });
    return out;
  }
  /* rayons : calculés en repère réel ; pour le bleu, le sens de balayage est inversé (miroir du sens trigonométrique) */
  function rays(b) {
    var polys = [];
    ENGINE.PK.forEach(function (pk) { var q = b.paquets[pk.id]; if (!q || q.n > 0) polys.push(root.GEOM.rectPoly({ cx: pk.x, cy: pk.y, hl: 160, hn: 55, ang: pk.tan + 90 })); });
    (b.pierres || []).concat(b.etrangeres || []).forEach(function (s) { polys.push(s.foot); });
    if (b.graal === 'home' && b.params && b.params.gx != null) polys.push(ENGINE.graalPoly([b.params.gx, b.params.gy], b.params.ga || 0));
    var boxes = polys.map(function (P) { var xs = P.map(function (v) { return v[0]; }), ys = P.map(function (v) { return v[1]; }); return [Math.min.apply(null, xs), Math.max.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, ys)]; });
    var o = b.adversaire && b.adversaire.x != null ? b.adversaire : null, sgn = b.team === 'blue' ? -1 : 1, out = [];
    for (var k = 0; k < 8; k++) {
      var a = (b.pose.h + sgn * 45 * k) * D2R, dx = Math.cos(a), dy = Math.sin(a), free = NORM.rayon;
      for (var d = NORM.pasRayon; d <= NORM.rayon; d += NORM.pasRayon) {
        var x = b.pose.x + d * dx, y = b.pose.y + d * dy, hit = x < 0 || x > 3000 || y < 0 || y > 2000;
        if (!hit && o && Math.hypot(x - o.x, y - o.y) < NORM.rayonAdversaire) hit = true;
        for (var i = 0; i < polys.length && !hit; i++) { var bx = boxes[i]; if (x >= bx[0] && x <= bx[1] && y >= bx[2] && y <= bx[3] && ENGINE.inPoly(x, y, polys[i])) hit = true; }
        if (hit) { free = d; break; }
      }
      out.push(free / NORM.rayon);
    }
    return out;
  }

  /* ------------------------------------------------------------------ adversaires */
  function qualify(strategy, params) {
    if (!strategy || !strategy.program || !strategy.program.length) return { ok: false, score: 0, errors: 1 };
    var R = ENGINE.simulate(strategy.program, Object.assign({}, ENGINE.DEF, params || {}), { skipContacts: false });
    var sc = SCORE.scoreAt(R, R.params, Math.min(R.T, MATCH));
    return { ok: R.errors.length === 0 && sc.total >= 70, score: sc.total, errors: R.errors.length, T: R.T };
  }
  function mulberry(seed) {
    var a = (seed >>> 0) || 1;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function pickOpponent(list, seed, intensity) {
    if (!list || !list.length || intensity === 'aucun' || intensity === 'none') return null;
    var rng = mulberry(seed + 17);
    var eligible = list.filter(function (s) { return s.program && s.program.length && (s.score == null || s.score >= 70); });
    if (!eligible.length) eligible = list;
    if (intensity === 'agressif' || intensity === 'faible') {
      eligible = eligible.slice().sort(function (a, b) { return ((b.score || 0) - (a.score || 0)) * (intensity === 'faible' ? -1 : 1); });
      eligible = eligible.slice(0, Math.max(1, Math.ceil(eligible.length / 2)));
    }
    return eligible[Math.floor(rng() * eligible.length)];
  }
  function argmaxMasked(v, mask) {
    var best = -1, bv = -Infinity;
    for (var i = 0; i < v.length; i++) if (mask[i] && v[i] > bv) { bv = v[i]; best = i; }
    if (best < 0) for (i = 0; i < mask.length; i++) if (mask[i]) return i;
    return best;
  }
  /* MLP « layers » (camelot-poids v1) : choix glouton */
  function chooserFromLayers(layers, acts) {
    acts = acts || [];
    return function (obs, mask) {
      var h = obs.slice(), i, j, k;
      for (i = 0; i < layers.length; i++) {
        var w = layers[i].w, bb = layers[i].b, next = [];
        for (j = 0; j < bb.length; j++) {
          var s = bb[j];
          for (k = 0; k < h.length; k++) s += h[k] * w[k][j];
          if (i < layers.length - 1) {
            var name = acts[i] || 'relu';
            if (name === 'tanh') s = Math.tanh(s);
            else if (name === 'sigmoid') s = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, s))));
            else s = s > 0 ? s : 0;
          }
          next[j] = s;
        }
        h = next;
      }
      return argmaxMasked(h, mask);
    };
  }
  /* Modèle récurrent « icamlot-modele-recurrent » (trainer/FORMAT_MODELE.md ; référence : web_forward de trainer/export_onnx.py).
     Renvoie un choix glouton avec mémoire ; état caché à zéro à la création (une instance par match). */
  function recurrentForward(w) {
    var act = { silu: function (x) { return x / (1 + Math.exp(-x)); }, relu: function (x) { return x > 0 ? x : 0; }, tanh: Math.tanh }[w.activation || 'silu'];
    var H = w.hidden, nrm = w.normalisation;
    function lin(x, L) { var y = L.b.slice(); for (var k = 0; k < x.length; k++) { var xk = x[k]; if (!xk) continue; var row = L.w[k]; for (var j = 0; j < y.length; j++) y[j] += xk * row[j]; } return y; }
    function sig(v) { return 1 / (1 + Math.exp(-v)); }
    return function (obs, h) {
      var x = obs.map(function (v, i) { var z = (v - nrm.mean[i]) / nrm.std[i]; return Math.max(-nrm.clip, Math.min(nrm.clip, z)); });
      w.encodeur.forEach(function (L) {
        x = lin(x, L);
        if (L.ln) { var mu = 0, va = 0, n = x.length; x.forEach(function (v) { mu += v / n; }); x.forEach(function (v) { va += (v - mu) * (v - mu) / n; }); var sd = Math.sqrt(va + L.ln.eps); x = x.map(function (v, j) { return (v - mu) / sd * L.ln.gamma[j] + L.ln.beta[j]; }); }
        x = x.map(act);
      });
      var g = w.gru, gi = lin(x, { w: g.w_ih, b: g.b_ih }), gh = lin(h, { w: g.w_hh, b: g.b_hh }), h2 = new Array(H);
      for (var j = 0; j < H; j++) { var r = sig(gi[j] + gh[j]), z = sig(gi[H + j] + gh[H + j]), nn = Math.tanh(gi[2 * H + j] + r * gh[2 * H + j]); h2[j] = (1 - z) * nn + z * h[j]; }
      var y = h2;
      w.acteur.forEach(function (L, k) { y = lin(y, L); if (k < w.acteur.length - 1) y = y.map(act); });
      return { logits: y, hidden: h2 };
    };
  }
  function recurrentModelOf(brain) {
    if (!brain) return null;
    if (brain.format === 'icamlot-modele-recurrent') return brain;
    if (brain.modele && brain.modele.format === 'icamlot-modele-recurrent') return brain.modele;
    return null;
  }
  function chooserFromRecurrent(w) {
    var fwd = recurrentForward(w), h = new Array(w.hidden).fill(0);
    return function (obs, mask) { var r = fwd(obs, h); h = r.hidden; return argmaxMasked(r.logits, mask); };
  }
  /* cerveau -> { groups, catalogue, choose } ; refuse un modèle dont les versions ou les dimensions ne correspondent pas */
  function brainSpec(brain) {
    var w = recurrentModelOf(brain);
    if (w) {
      if (w.obs_version && w.obs_version !== OBS_VERSION) throw new Error('Modèle récurrent : version d\'observation ' + w.obs_version + ' au lieu de ' + OBS_VERSION + '.');
      if (w.catalogue_version && w.catalogue_version !== ACTIONS.CATALOGUE_VERSION) throw new Error('Modèle récurrent : version de catalogue ' + w.catalogue_version + ' au lieu de ' + ACTIONS.CATALOGUE_VERSION + '.');
      var groups = w.groupes || brain.entrees || DEFAULT_GROUPS.slice(), catalogue = ACTIONS.filterByFamilles(brain.familles || null);
      if (nInputs(groups) !== w.n_in || catalogue.length !== w.n_out) throw new Error('Modèle récurrent : dimensions ' + w.n_in + ' x ' + w.n_out + ' incompatibles avec l\'environnement (' + nInputs(groups) + ' x ' + catalogue.length + ').');
      return { groups: groups, catalogue: catalogue, choose: chooserFromRecurrent(w), kind: 'recurrent' };
    }
    var g2 = brain.entrees || DEFAULT_GROUPS.slice(), c2 = ACTIONS.filterByFamilles(brain.familles || null);
    if (brain.choose) return { groups: g2, catalogue: c2, choose: brain.choose, kind: 'fonction' };
    if (brain.layers) {
      var L = brain.layers;
      if (L[0].w.length !== nInputs(g2) || L[L.length - 1].b.length !== c2.length) throw new Error('Cerveau MLP : dimensions ' + L[0].w.length + ' x ' + L[L.length - 1].b.length + ' incompatibles avec l\'environnement (' + nInputs(g2) + ' x ' + c2.length + ').');
      return { groups: g2, catalogue: c2, choose: chooserFromLayers(L, brain.acts), kind: 'mlp' };
    }
    throw new Error('Cerveau inconnu : ni layers, ni modèle icamlot-modele-recurrent, ni choose.');
  }
  /* « esprit » d'un robot piloté par un cerveau : croyance, observation, masque, décision, brique (repère réel). */
  function makeMind(spec) {
    var mem = newMemory(), last = { t: 0, brick: null, nErr: 0 }, rec = [];
    return {
      spec: spec, memory: mem, program: function () { return rec.slice(); },
      /* met à jour la croyance avec ce qui s'est passé depuis la dernière décision, puis la renvoie */
      belief: function (sim, oppPose) {
        var t = sim.time(), errs = sim.errors().length, err = errs > last.nErr ? sim.errors()[errs - 1].msg : null;
        if (last.brick || t > last.t) updateMemory(mem, sim, last.t, t, last.brick, { err: err });
        last.brick = null; last.t = t; last.nErr = errs;
        return beliefFromSim(sim, mem, oppPose);
      },
      decide: function (b) {
        var m = ACTIONS.maskBelief(b, spec.catalogue);
        if (!m.some(function (x) { return x; })) return { idx: -1, mask: m };
        var obs = observeBelief(b, spec.groups), idx = spec.choose(obs, m);
        return { idx: idx != null && idx >= 0 && m[idx] ? idx : -1, mask: m, obs: obs };
      },
      /* brique jouée (repère de l'équipe) */
      played: function (sim, b, idx, brickOwn) { rec.push(brickOwn); last.brick = ACTIONS.realStep(brickOwn, b.team); last.t = sim.time(); last.nErr = sim.errors().length; }
    };
  }
  /* Pilote d'un cerveau pour le robot adverse : next(sim, autreSim) renvoie la brique en repère réel ; program() renvoie les
     briques décidées dans le repère de l'équipe (rejouables comme une stratégie). */
  function brainAgent(brain) {
    var spec = brainSpec(brain), mind = makeMind(spec), n = 0;
    return {
      kind: 'cerveau', mind: mind,
      next: function (sim, other) {
        var t = sim.time();
        if (t >= MATCH - 0.05 || n >= 300) return null;
        var b = mind.belief(sim, lidarOf(other, t)), d = mind.decide(b), st;
        n++;
        st = d.idx < 0 ? { a: 'attendreJusqua', sec: MATCH } : ACTIONS.toProgramStep(spec.catalogue[d.idx], b);
        mind.played(sim, b, d.idx, st);
        return ACTIONS.realStep(st, b.team);
      },
      program: function () { return mind.program(); }
    };
  }
  /* Adversaire d'un scénario : une stratégie ({ program, params }) ou un cerveau ({ brain }), avec une intensité. */
  function opponentSetup(spec, P, intensity) {
    if (!spec || intensity === 'aucun' || intensity === 'none') return null;
    var params = ENGINE.intensityParams(blueParams(spec.params || P), intensity);
    if (spec.brain) return { params: params, agent: brainAgent(spec.brain), spec: spec };
    if (!spec.program || !spec.program.length) return null;
    var list = spec.program, agent = ENGINE.programAgent(list.map(mirrorStep)), played = agent.program;
    agent.kind = 'strategie';
    agent.program = function () { return list.slice(0, played().length); };
    return { params: params, agent: agent, spec: spec };
  }
  /* Programme du joueur contre un adversaire (stratégie ou cerveau). */
  function playProgram(prog, params, spec, intensity, skipContacts) {
    var P = Object.assign({}, ENGINE.DEF, params || {});
    var op = opponentSetup(spec, P, intensity || 'realiste');
    var duel = ENGINE.makeDuel({ params: P, skipContacts: !!skipContacts, blue: op ? { params: op.params } : null });
    duel.run({ yellow: ENGINE.programAgent(prog || []), blue: op ? op.agent : null });
    var R = duel.finish();
    return { result: R, program: (prog || []).slice(), opponentProgram: op ? op.agent.program() : [] };
  }

  /* ------------------------------------------------------------------ environnement */
  /* cfg.recompense : { penalite_erreur, penalite_contact, penalite_invalide, sur_erreur: 'penalite' | 'fin' } (pénalités >= 0, retranchées).
     Récompense d'un pas = variation du score officiel (scoreAt à min(t, 100) : constructions en cours de match, trône, boulets
     et Graal seulement à 100 s) - pénalités. Somme sur l'épisode = score final à 100 s - pénalités (l'épisode se termine
     toujours à 100 s : le robot attend sur place). */
  function create(opts) {
    opts = opts || {};
    var groups = opts.entrees || opts.groups || DEFAULT_GROUPS.slice();
    var familles = opts.familles || FAMILLES_ALL();
    var catalogue = ACTIONS.filterByFamilles(familles);
    var params = Object.assign({}, ENGINE.DEF, opts.params || {});
    var intensity = (opts.adversaire && opts.adversaire.intensite) || 'aucun';
    var skipContacts = opts.mode === 'rapide' || !!opts.skipContacts;
    var rec = opts.recompense || {};
    var onError = opts.onError || rec.sur_erreur || 'penalite';
    var PEN = { erreur: +rec.penalite_erreur || 0, contact: +rec.penalite_contact || 0, invalide: +rec.penalite_invalide || 0 };
    var duel = null, sim = null, mem = null, opp = null, lastScore = 0, done = false, history = [], penalties = 0, cur = null;

    /* adversaire du match (décision §9) : scenario.opponent, sinon un de opts.adversaires (choisi par la graine ou
       scenario.adversaire = index), sinon opts.opponent, sinon le programme de référence en miroir */
    var pool = (opts.adversaires || []).slice();
    function opponentSpecOf(scenario) {
      if (scenario.opponent) return scenario.opponent;
      if (pool.length) {
        var k = scenario.adversaire != null ? +scenario.adversaire : Math.floor(mulberry((scenario.seed || 0) + 101)() * pool.length);
        return pool[((k % pool.length) + pool.length) % pool.length];
      }
      return opts.opponent || { program: ENGINE.PROGRAMME_REFERENCE };
    }
    function syncOpp(upTo) { if (opp) duel.advanceBlue(opp.agent, upTo == null ? sim.time() : upTo); }
    function oppPose() { return duel && duel.hasBlue ? lidarOf(duel.sims.blue, sim.time()) : null; }
    function scoreNow() { return SCORE.scoreAt(sim.result(false), sim.params(), Math.min(sim.time(), MATCH)).total; }
    function belief() { syncOpp(); return beliefFromSim(sim, mem, oppPose()); }
    function state() {
      var b = belief();
      cur = { belief: b, mask: done ? catalogue.map(function () { return 0; }) : ACTIONS.maskBelief(b, catalogue) };
      return { obs: observeBelief(b, groups), mask: cur.mask, t: sim.time(), score: lastScore, reward: 0, done: done, err: null };
    }
    function exec(brickOwn) { var info = duel.exec('yellow', ACTIONS.realStep(brickOwn, 'yellow')); history.push(brickOwn); return info; }
    /* fin de match : l'adversaire joue jusqu'à 100 s, puis le robot attend sur place ; renvoie le gain de score et les pénalités */
    function finishEpisode() {
      var r = 0;
      if (!done) {
        syncOpp(MATCH);
        if (sim.time() < MATCH) { var t0 = sim.time(), info = exec({ a: 'attendreJusqua', sec: MATCH }); updateMemory(mem, sim, t0, sim.time(), null, info); }
        var s = scoreNow(); r += s - lastScore; lastScore = s;
        if (PEN.contact && !skipContacts) { var nc = (sim.result(true).collisions || []).length; r -= PEN.contact * nc; penalties += PEN.contact * nc; }
        done = true;
      }
      return r;
    }
    function reset(scenario) {
      scenario = scenario || {};
      var P = Object.assign({}, params, scenario.params || {});
      if (scenario.seed != null) P.seed = scenario.seed;
      opp = opponentSetup(opponentSpecOf(scenario), P, scenario.intensite || intensity);
      duel = ENGINE.makeDuel({ params: P, skipContacts: skipContacts, blue: opp ? { params: opp.params } : null });
      sim = duel.sims.yellow;
      mem = newMemory();
      done = false; history = []; penalties = 0;
      lastScore = scoreNow();
      var s = state(); s.reset = true;
      return s;
    }
    /* joue l'action idx (même chemin pour step et imitate) ; force : ignore le masque (imitation d'un programme) */
    function doAction(idx, force) {
      if (!cur) state();
      var act = catalogue[idx], t0 = sim.time(), reward = 0, err = null, brick = null;
      if (!act) { err = 'Action hors catalogue.'; reward -= PEN.invalide; penalties += PEN.invalide; }
      else if (!force && !cur.mask[idx]) { err = 'Action invalide.'; reward -= PEN.invalide; penalties += PEN.invalide; }
      else {
        brick = ACTIONS.toProgramStep(act, cur.belief);
        if (!brick) { err = 'Action non résolue.'; reward -= PEN.invalide; penalties += PEN.invalide; }
        else {
          syncOpp();
          var info = exec(brick);
          updateMemory(mem, sim, t0, sim.time(), brick, info);
          err = info.err || null;
          if (err) { reward -= PEN.erreur; penalties += PEN.erreur; }
          var s1 = scoreNow(); reward += s1 - lastScore; lastScore = s1;
        }
      }
      if (err && onError === 'fin') reward += finishEpisode();
      else if (sim.time() >= MATCH - 0.05 || (act && act.a === 'finir')) reward += finishEpisode();
      var st = state();
      /* plus aucune action possible : le robot attend la fin du match sur place */
      if (!done && !st.mask.some(function (x) { return x; })) { reward += finishEpisode(); st = state(); }
      st.reward = reward; st.err = err; st.dt = sim.time() - t0; st.step = brick; st.score = lastScore; st.done = done;
      return st;
    }
    function step(index) {
      if (!sim) reset();
      if (done) { var s = state(); s.err = 'Épisode terminé.'; return s; }
      return doAction(index, false);
    }
    /* Le réseau décide après chaque action, jusqu'à 100 s. */
    function play(chooseFn, scenario) {
      var st = reset(scenario || {}), n = 0, max = (scenario && scenario.maxDecisions) || opts.maxDecisions || 200;
      var doFilterSafety = opts.filterSafety || (scenario && scenario.filterSafety);
      while (!st.done && n < max) {
        var m = st.mask.slice();
        var idx = chooseFn(st.obs, m);
        if (doFilterSafety) {
          while (idx != null && idx >= 0 && m[idx] && !testActionSafety(idx)) { m[idx] = 0; idx = m.some(function (x) { return x; }) ? chooseFn(st.obs, m) : -1; }
        }
        if (idx == null || idx < 0 || !m[idx]) break;
        st = step(idx);
        n++;
      }
      finishEpisode();
      return state();
    }
    /* Imitation d'un programme : chaque brique reconnue par ACTIONS.indexOfStep est jouée comme ENV.step (brique du catalogue,
       avec temps masqué) et donne une paire { obs, action, mask, reward, t } ; les autres briques (attentes...) sont jouées
       telles quelles et leur gain est compté dans la paire précédente. Somme des récompenses = score final - score0 - pénalités. */
    function imitate(program, scenario) {
      var s0 = reset(scenario || { intensite: 'aucun' }), pairs = [], score0 = lastScore, prev = null;
      (program || []).forEach(function (st) {
        if (done || !st) return;
        var idx = -1;
        if (st.a !== 'attendre' && !(st.a === 'attendreJusqua' && +st.sec < MATCH)) idx = ACTIONS.indexOfStep(st, cur.belief, catalogue);
        if (idx < 0) {
          syncOpp();
          var t0 = sim.time(), info = exec(st);
          updateMemory(mem, sim, t0, sim.time(), st, info);
          var s1 = scoreNow(), r = s1 - lastScore; lastScore = s1;
          if (sim.time() >= MATCH - 0.05) r += finishEpisode();
          if (prev) prev.reward += r; else score0 += r;
          state();
          return;
        }
        var s = { obs: observeBelief(cur.belief, groups), mask: cur.mask.slice(), t: sim.time() };
        var res = doAction(idx, true);
        prev = { obs: s.obs, action: idx, mask: s.mask, reward: res.reward, t: s.t, err: res.err || null };
        pairs.push(prev);
      });
      var rEnd = finishEpisode();
      if (prev) prev.reward += rEnd; else score0 += rEnd;
      state();
      var sc = SCORE.scoreAt(sim.result(false), sim.params(), MATCH);
      return { pairs: pairs, score: sc.total, detail: sc.detail, T: sim.time(), n: pairs.length, start: s0, score0: score0, penalites: penalties, errors: sim.errors().length };
    }
    function program() { return history.slice(); }
    function opponentProgram() { return opp ? opp.agent.program() : []; }
    function result() {
      if (!sim) return null;
      var R = sim.result(!skipContacts);
      if (duel.hasBlue) { R.opponent = duel.sims.blue.result(false); R.oppEvents = { taken: Object.assign({}, duel.claims.blue), none: false }; }
      return R;
    }
    function snapshot() {
      return sim ? {
        sim: sim.snapshot(), blue: duel.hasBlue ? duel.sims.blue.snapshot() : null,
        claims: JSON.parse(JSON.stringify(duel.claims)), programs: JSON.parse(JSON.stringify(duel.programs)),
        mem: JSON.parse(JSON.stringify(mem)), lastScore: lastScore, done: done, history: JSON.parse(JSON.stringify(history)), penalties: penalties
      } : null;
    }
    function restore(snap) {
      if (!sim) reset();
      sim.restore(snap.sim);
      if (snap.blue && duel.hasBlue) duel.sims.blue.restore(snap.blue);
      ['yellow', 'blue'].forEach(function (k) {
        Object.keys(duel.claims[k]).forEach(function (id) { delete duel.claims[k][id]; });
        Object.keys(snap.claims[k] || {}).forEach(function (id) { duel.claims[k][id] = snap.claims[k][id]; });
        duel.programs[k] = snap.programs[k];
      });
      mem = snap.mem; lastScore = snap.lastScore; done = snap.done; history = snap.history; penalties = snap.penalties;
      state();
    }
    /* outil (pas utilisé par le masque) : l'action idx jouée dans une copie du monde finit-elle sans erreur ni contact ? */
    function testActionSafety(idx) {
      var snap = snapshot();
      try {
        var nCol = skipContacts ? 0 : (sim.result(true).collisions || []).length;
        var r = doAction(idx, false);
        var bad = !!r.err || (!skipContacts && (sim.result(true).collisions || []).length > nCol);
        restore(snap);
        return !bad;
      } catch (e) { restore(snap); return false; }
    }
    var envObj = {
      reset: reset, step: step, play: play, imitate: imitate, program: program, opponentProgram: opponentProgram, result: result,
      snapshot: snapshot, restore: restore, testActionSafety: testActionSafety,
      belief: function () { return cur ? cur.belief : null; },
      catalogue: catalogue, groups: groups, nInputs: nInputs(groups), nOutputs: catalogue.length
    };
    Object.defineProperty(envObj, 'sim', { get: function () { return sim; }, enumerable: true });
    return envObj;
  }
  function FAMILLES_ALL() { return ACTIONS.FAMILLES.map(function (f) { return f.id; }); }

  var api = {
    MATCH: MATCH, OBS_VERSION: OBS_VERSION, VISION: VISION, NORM: NORM, GROUPS: GROUPS, DEFAULT_GROUPS: DEFAULT_GROUPS, nInputs: nInputs,
    create: create, mirrorId: mirrorId, mirrorStep: mirrorStep, blueParams: blueParams, pickOpponent: pickOpponent,
    chooserFromLayers: chooserFromLayers, chooserFromRecurrent: chooserFromRecurrent, recurrentForward: recurrentForward,
    brainSpec: brainSpec, brainAgent: brainAgent, makeMind: makeMind, opponentSetup: opponentSetup, playProgram: playProgram, qualify: qualify,
    newMemory: newMemory, updateMemory: updateMemory, beliefFromSim: beliefFromSim, observeBelief: observeBelief, lidarOf: lidarOf
  };
  /* ENV.EXAMPLE est remplacé par ENGINE.PROGRAMME_REFERENCE (alias conservé pour la commande « example » du worker) */
  Object.defineProperty(api, 'EXAMPLE', { get: function () { return ENGINE.PROGRAMME_REFERENCE; }, enumerable: true });
  root.ENV = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
