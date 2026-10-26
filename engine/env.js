/* Environnement d'apprentissage : reset / step, observations, masque, adversaire en mode rapide. */
(function (root) {
  var MATCH = 100;
  var GROUPS = [
    { id: 'temps', label: 'Temps', vars: [{ id: 'temps', nom: 'Temps restant', desc: 'Secondes restantes / 100 s', n: 1 }] },
    { id: 'robot', label: 'Robot', vars: [{ id: 'robot', nom: 'Pose du robot', desc: 'x / 3000, y / 2000, cos(cap), sin(cap)', n: 4 }] },
    { id: 'paquets', label: 'Paquets', vars: [{ id: 'paquets', nom: 'Pierres restantes par paquet', desc: 'P1 à P10, chacune / 3 (croyance : inchangé tant qu\'on n\'y va pas)', n: 10 }] },
    { id: 'faces', label: 'Faces A et B', vars: [{ id: 'faces', nom: 'Charges des pinces', desc: 'Pour chaque face : pierres / 3, à plat, tient le Graal', n: 6 }] },
    { id: 'constructions', label: 'Constructions', vars: [{ id: 'constructions', nom: 'Murs et tours jaunes', desc: 'M1–M5 (vide / mur / porte) et T1–T4 (vide / tour)', n: 9 }] },
    { id: 'graal', label: 'Graal', vars: [{ id: 'graal', nom: 'État du Graal', desc: 'au départ / tenu / posé, niveau / 4', n: 4 }] },
    { id: 'boulets', label: 'Boulets', vars: [{ id: 'boulets', nom: 'Boulets lâchés', desc: '0 ou 1', n: 1 }] },
    { id: 'adversaire', label: 'Adversaire (lidar)', vars: [{ id: 'adversaire', nom: 'Position adverse', desc: 'x / 3000, y / 2000 vus par le lidar', n: 2 }] }
  ];
  var GROUP_N = {}; GROUPS.forEach(function (g) { GROUP_N[g.id] = g.vars[0].n; });

  function nInputs(groups) {
    var n = 0; (groups || GROUPS.map(function (g) { return g.id; })).forEach(function (id) { n += GROUP_N[id] || 0; });
    return n;
  }

  function mirrorId(id) { return ENGINE.mirrorId(id); }
  function mirrorStep(st) { return ENGINE.mirrorStep(st); }
  function blueParams(base) { return ENGINE.blueParams(base); }

  var oppCache = {};
  function opponentEvents(strategy, params, intensity) {
    if (!strategy || !strategy.program || !strategy.program.length || intensity === 'aucun' || intensity === 'none') {
      return { taken: {}, poseAt: function () { return { x: 0, y: 0, h: 0 }; }, none: true };
    }
    var key = (strategy.slug || strategy.name || '') + ':' + JSON.stringify(strategy.program) + ':' + (params && params.v) + ':' + intensity;
    if (oppCache[key]) return oppCache[key];
    var Pb = ENGINE.intensityParams(blueParams(params), intensity);
    var R = ENGINE.simulate(strategy.program.map(mirrorStep), Pb, { skipContacts: true });
    var ev = ENGINE.extractOpp(R);
    ev.score = (root.SCORE && SCORE.scoreAt) ? SCORE.scoreAt(R, Pb, Math.min(R.T, MATCH)).total : 0;
    ev.errors = R.errors.length;
    oppCache[key] = ev;
    return ev;
  }

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

  function constructionsState(sim) {
    var R = sim.result(false);
    var o = SCORE.outcome(R, sim.params(), sim.time());
    var murs = {}, tours = {};
    ENGINE.ZM.forEach(function (z) { murs[z.id] = 0; });
    ENGINE.ZT.forEach(function (z) { tours[z.id] = 0; });
    o.walls.forEach(function (id) { murs[id] = 0.5; });
    o.doors.forEach(function (id) { murs[id] = 1; });
    o.towers.forEach(function (id) { tours[id] = 1; });
    return { murs: murs, tours: tours, o: o };
  }

  function observe(sim, groups, belief, oppPose) {
    groups = groups || GROUPS.map(function (g) { return g.id; });
    var p = sim.pose(), t = sim.time(), held = sim.held(), graal = sim.graal().cur, balls = sim.balls();
    var out = [];
    function push() { for (var i = 0; i < arguments.length; i++) out.push(arguments[i]); }
    groups.forEach(function (id) {
      if (id === 'temps') push(Math.max(0, (MATCH - t) / MATCH));
      if (id === 'robot') {
        var rad = p.h * Math.PI / 180;
        push(p.x / 3000, p.y / 2000, Math.cos(rad), Math.sin(rad));
      }
      if (id === 'paquets') {
        ACTIONS.PACKS.forEach(function (pk) { push((belief.packs[pk] != null ? belief.packs[pk] : 3) / 3); });
      }
      if (id === 'faces') {
        ['A', 'B'].forEach(function (f) {
          var h = held[f];
          var n = h && h.stack ? h.stack.filter(function (x) { return x; }).length : 0;
          push(n / 3, (h && !h.graal && p[f].rot === 0) ? 1 : 0, h && h.graal ? 1 : 0);
        });
      }
      if (id === 'constructions') {
        var c = constructionsState(sim);
        ACTIONS.MURS.forEach(function (z) { push(c.murs[z] || 0); });
        ACTIONS.TOURS.forEach(function (z) { push(c.tours[z] || 0); });
      }
      if (id === 'graal') {
        var home = graal.k === 'home' ? 1 : 0, heldG = graal.k === 'held' ? 1 : 0, posed = graal.k === 'free' ? 1 : 0;
        var lvl = 0;
        if (graal.k === 'free' && graal.top != null) {
          var bottom = graal.top - (sim.params().gs || 60);
          lvl = bottom >= 300 ? 3 : bottom >= 200 ? 2 : bottom >= 100 ? 1 : 0;
        }
        push(home, heldG, posed, lvl / 4);
      }
      if (id === 'boulets') push(balls.t < Infinity ? 1 : 0);
      if (id === 'adversaire') {
        var o = oppPose || { x: 0, y: 0 };
        push((o.x || 0) / 3000, (o.y || 0) / 2000);
      }
    });
    return out;
  }

  function makeBelief() {
    var packs = {}; ACTIONS.PACKS.forEach(function (p) { packs[p] = 3; });
    return { packs: packs };
  }

  function updateBelief(belief, step, info) {
    if (step.a === 'prendre') belief.packs[step.p] = info.err ? 0 : 0;
  }

  function clipTime(sim) {
    return sim.time() >= MATCH;
  }

  function create(opts) {
    opts = opts || {};
    var groups = opts.entrees || GROUPS.map(function (g) { return g.id; });
    var familles = opts.familles || ACTIONS.FAMILLES.map(function (f) { return f.id; });
    var catalogue = ACTIONS.filterByFamilles(familles);
    var params = Object.assign({}, ENGINE.DEF, opts.params || {});
    var intensity = (opts.adversaire && opts.adversaire.intensite) || 'aucun';
    var skipContacts = opts.mode === 'rapide' || opts.skipContacts;
    var onError = opts.onError || 'penalite'; /* penalite | fin */
    var sim = null, belief = null, opp = null, lastScore = 0, done = false, history = [];

    function oppPose() { return opp && opp.poseAt ? opp.poseAt(sim.time()) : { x: 0, y: 0 }; }

    function state() {
      var m = ACTIONS.mask(sim, catalogue);
      if (!m.some(function (x) { return x; })) {
        catalogue.forEach(function (a, i) { if (a.a === 'trone') m[i] = 1; });
      }
      return {
        obs: observe(sim, groups, belief, oppPose()),
        mask: m,
        t: sim.time(),
        score: lastScore,
        done: done,
        err: null
      };
    }

    function reset(scenario) {
      scenario = scenario || {};
      var P = Object.assign({}, params, scenario.params || {});
      if (scenario.seed != null) P.seed = scenario.seed;
      opp = opponentEvents(scenario.opponent || opts.opponent, P, scenario.intensite || intensity);
      if (opp.none) P.oppTaken = {};
      else P.oppTaken = Object.assign({}, opp.taken);
      sim = ENGINE.makeSim(P, { skipContacts: skipContacts, oppPoseAt: opp.none ? null : function (t) { return opp.poseAt(t); } });
      belief = makeBelief();
      done = false;
      history = [];
      lastScore = SCORE.scoreAt(sim.result(false), P, 0).total;
      var s = state();
      s.reset = true;
      return s;
    }

    function step(index) {
      if (!sim) reset();
      if (done) return state();
      var act = catalogue[index];
      if (!act) return Object.assign(state(), { err: 'Action hors catalogue.' });
      if (!ACTIONS.valid(act, sim) && act.a !== 'trone') {
        if (onError === 'fin') { done = true; return Object.assign(state(), { err: 'Action invalide.', done: true, dt: 0, reward: 0 }); }
        return Object.assign(state(), { err: 'Action invalide.', dt: 0, reward: 0 });
      }
      var brick = ACTIONS.toProgramStep(act, sim);
      var t0 = sim.time();
      var info = sim.exec(brick);
      if (sim.time() > MATCH) {
        /* la brique est conservée : le score sera lu à 100 s */
      }
      updateBelief(belief, brick, info);
      history.push(brick);
      var t1 = Math.min(sim.time(), MATCH);
      var sc = SCORE.scoreAt(sim.result(false), sim.params(), t1);
      var reward = sc.total - lastScore;
      lastScore = sc.total;
      if (info.err && onError === 'fin') done = true;
      if (t1 >= MATCH) done = true;
      if (!ACTIONS.mask(sim, catalogue).some(function (x, i) { return x && catalogue[i].a !== 'trone'; }) && act.a === 'trone') {
        /* plus rien d'utile : on attend les boulets (80 s) ou la fin, sans figer une stratégie */
        if (sim.time() < MATCH) {
          var ballsLeft = sim.balls().t === Infinity && catalogue.some(function (a) { return a.a === 'boulets'; });
          var until = (ballsLeft && sim.time() < 80) ? 80 : MATCH;
          finishWait(until);
          t1 = Math.min(sim.time(), MATCH);
          sc = SCORE.scoreAt(sim.result(false), sim.params(), t1);
          reward = sc.total - lastScore + reward;
          lastScore = sc.total;
          if (t1 >= MATCH) done = true;
        }
      }
      var s = state();
      s.dt = sim.time() - t0;
      s.reward = reward;
      s.err = info.err;
      s.done = done;
      s.step = brick;
      return s;
    }

    function finishWait(sec) {
      if (!sim || sim.time() >= sec - 0.05) return;
      var brick = { a: 'attendreJusqua', sec: sec };
      sim.exec(brick);
      history.push(brick);
      var t1 = Math.min(sim.time(), MATCH);
      lastScore = SCORE.scoreAt(sim.result(false), sim.params(), t1).total;
      if (t1 >= MATCH) done = true;
    }
    function liveMask(st) {
      var m = st.mask.slice(), t = st.t, useful = false, i, ballsIn = false;
      for (i = 0; i < m.length; i++) if (m[i] && catalogue[i].a !== 'trone') useful = true;
      for (i = 0; i < catalogue.length; i++) if (catalogue[i].a === 'boulets') ballsIn = true;
      /* pas de trône tant qu'il reste à jouer, et pas avant 80 s si les boulets sont encore possibles */
      if ((useful && t < 88) || (ballsIn && !useful && t < 80)) {
        for (i = 0; i < catalogue.length; i++) if (catalogue[i].a === 'trone') m[i] = 0;
      }
      return m;
    }
    /* Le réseau décide après chaque brique, jusqu'à 100 s. Ce n'est pas un programme figé. */
    function play(chooseFn, scenario) {
      var st = reset(scenario || {}), n = 0, last = -1, same = 0, max = 80;
      while (!st.done && n < max && sim.time() < MATCH) {
        var m = liveMask(st);
        if (same >= 2 && last >= 0 && m.some(function (x, i) { return x && i !== last; })) m[last] = 0;
        if (!m.some(function (x) { return x; })) {
          if (sim.time() < 80) { finishWait(80); st = state(); n++; continue; }
          break;
        }
        var idx = chooseFn(st.obs, m);
        if (idx == null || idx < 0) break;
        if (idx === last) same++; else { same = 1; last = idx; }
        st = step(idx);
        n++;
      }
      if (sim && sim.time() < MATCH - 0.05) finishWait(MATCH);
      done = true;
      return state();
    }
    function imitate(program, scenario) {
      var s0 = reset(scenario || { intensite: 'aucun' });
      var pairs = [];
      (program || []).forEach(function (st) {
        if (!st || st.a === 'attendre' || st.a === 'attendreJusqua') {
          if (sim && st) sim.exec(st);
          return;
        }
        var idx = ACTIONS.indexOfStep(st, sim, catalogue);
        if (idx < 0) { sim.exec(st); history.push(st); return; }
        var s = state();
        pairs.push({ obs: s.obs, action: idx, mask: s.mask });
        var info = sim.exec(st);
        updateBelief(belief, st, info);
        history.push(st);
        var t1 = Math.min(sim.time(), MATCH);
        lastScore = SCORE.scoreAt(sim.result(false), sim.params(), t1).total;
        if (sim.time() >= MATCH) done = true;
      });
      var sc = SCORE.scoreAt(sim.result(false), sim.params(), Math.min(sim.time(), MATCH));
      return { pairs: pairs, score: sc.total, detail: sc.detail, T: sim.time(), n: pairs.length, start: s0 };
    }
    function program() { return history.slice(); }
    function result() {
      if (!sim) return null;
      var R = sim.result(!skipContacts);
      if (opp && !opp.none && opp.result) R.opponent = opp.result;
      return R;
    }
    function snapshot() { return sim ? { sim: sim.snapshot(), belief: JSON.parse(JSON.stringify(belief)), lastScore: lastScore, done: done, history: JSON.parse(JSON.stringify(history)) } : null; }
    function restore(snap) {
      if (!sim) reset();
      sim.restore(snap.sim); belief = snap.belief; lastScore = snap.lastScore; done = snap.done; history = snap.history;
    }

    return { reset: reset, step: step, play: play, imitate: imitate, program: program, result: result, snapshot: snapshot, restore: restore, catalogue: catalogue, groups: groups, nInputs: nInputs(groups), nOutputs: catalogue.length };
  }

  var EXAMPLE = [
    { a: 'prendre', f: 'A', p: 'P1' }, { a: 'prendre', f: 'B', p: 'P9' },
    { a: 'mur', f: 'A', z: 'M1', side: 'ext' }, { a: 'mur', f: 'B', z: 'M2', side: 'ext' },
    { a: 'prendre', f: 'A', p: 'P5' }, { a: 'prendre', f: 'B', p: 'P10' },
    { a: 'mur', f: 'A', z: 'M5', side: 'ext' }, { a: 'mur', f: 'B', z: 'M4', side: 'ext' },
    { a: 'prendre', f: 'A', p: 'P4' }, { a: 'boulets' },
    { a: 'porte', f: 'A', z: 'M3', side: 'int' },
    { a: 'prendreGraal', f: 'B' }, { a: 'poserGraal', f: 'B', z: 'M3' },
    { a: 'trone' }
  ];

  var api = { MATCH: MATCH, GROUPS: GROUPS, nInputs: nInputs, create: create, mirrorId: mirrorId, mirrorStep: mirrorStep, blueParams: blueParams, opponentEvents: opponentEvents, pickOpponent: pickOpponent, qualify: qualify, EXAMPLE: EXAMPLE };
  root.ENV = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
