/* Environnement d'apprentissage : reset / step, observations, masque, adversaire en mode rapide. */
(function (root) {
  var MATCH = 100;
  var DEFAULT_GROUPS = ['temps', 'robot', 'paquets', 'faces', 'constructions', 'graal', 'boulets', 'adversaire'];
  var GROUPS = [
    { id: 'temps', label: 'Temps', vars: [{ id: 'temps', nom: 'Temps restant', desc: 'Secondes restantes / 100 s', n: 1 }] },
    { id: 'robot', label: 'Robot', vars: [{ id: 'robot', nom: 'Pose du robot', desc: 'x / 3000, y / 2000, cos(cap), sin(cap)', n: 4 }] },
    { id: 'paquets', label: 'Paquets', vars: [{ id: 'paquets', nom: 'Pierres restantes par paquet', desc: 'P1 à P10, chacune / 3 (croyance : inchangé tant qu\'on n\'y va pas)', n: 10 }] },
    { id: 'faces', label: 'Faces A et B', vars: [{ id: 'faces', nom: 'Charges des pinces', desc: 'Pour chaque face : pierres / 3, à plat, tient le Graal', n: 6 }] },
    { id: 'constructions', label: 'Constructions', vars: [{ id: 'constructions', nom: 'Murs et tours jaunes', desc: 'M1–M5 (vide / mur / porte) et T1–T4 (vide / tour)', n: 9 }] },
    { id: 'graal', label: 'Graal', vars: [{ id: 'graal', nom: 'État du Graal', desc: 'au départ / tenu / posé, niveau / 4', n: 4 }] },
    { id: 'boulets', label: 'Boulets', vars: [{ id: 'boulets', nom: 'Boulets lâchés', desc: '0 ou 1', n: 1 }] },
    { id: 'adversaire', label: 'Adversaire (lidar)', vars: [{ id: 'adversaire', nom: 'Position adverse', desc: 'x / 3000, y / 2000 vus par le lidar', n: 2 }] },
    { id: 'proprioception', label: 'Proprioception', vars: [{ id: 'proprioception', nom: 'État fin des pinces', desc: 'Vide [A0..2, B0..2], rot/90, hc/300, rayon enveloppe', n: 11 }] },
    { id: 'spatial', label: 'Spatial', vars: [{ id: 'spatial', nom: 'Dégagement corridors (raycasting 8 directions)', desc: 'Distances libres dans 8 directions relatives', n: 8 }] }
  ];
  var GROUP_N = {}; GROUPS.forEach(function (g) { GROUP_N[g.id] = g.vars[0].n; });

  function nInputs(groups) {
    var n = 0; (groups || DEFAULT_GROUPS).forEach(function (id) { n += GROUP_N[id] || 0; });
    return n;
  }

  function mirrorId(id) { return ENGINE.mirrorId(id); }
  function mirrorStep(st) { return ENGINE.mirrorStep(st); }
  function blueParams(base) { return ENGINE.blueParams(base); }

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

  /* Repère du cerveau : un robot bleu voit la table en miroir (x -> 3000 - x, cap -> 180 - cap, M6–M10 vus comme M1–M5...). */
  function teamOf(sim) { return (sim.params().team) || 'yellow'; }
  function ownPose(sim) {
    var p = sim.pose();
    if (teamOf(sim) !== 'blue') return p;
    var q = Object.assign({}, p); q.x = 3000 - p.x; q.h = 180 - p.h; return q;
  }
  function ownId(sim, id) { return teamOf(sim) === 'blue' ? ENGINE.mirrorId(id) : id; }

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

  /* oppPose : position de l'adversaire en vrai repère de la table ; elle est présentée dans le repère du cerveau */
  function observe(sim, groups, belief, oppPose) {
    groups = groups || DEFAULT_GROUPS.slice();
    var p = ownPose(sim), t = sim.time(), held = sim.held(), graal = sim.graal().cur, balls = sim.balls();
    var blue = teamOf(sim) === 'blue';
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
          push(n / 3, (h && !h.graal && sim.pose()[f].rot === 0) ? 1 : 0, h && h.graal ? 1 : 0);
        });
      }
      if (id === 'constructions') {
        var c = constructionsState(sim);
        ACTIONS.MURS.forEach(function (z) { push(c.murs[ownId(sim, z)] || 0); });
        ACTIONS.TOURS.forEach(function (z) { push(c.tours[ownId(sim, z)] || 0); });
      }
      if (id === 'graal') {
        var home = graal.k === 'home' ? 1 : 0, heldG = graal.k === 'held' ? 1 : 0, posed = (graal.k === 'free' || graal.k === 'ride') ? 1 : 0;
        var lvl = 0, gtop = graal.k === 'free' ? graal.top : null;
        if (graal.k === 'ride') { var gpos = SCORE.graalPos(sim.result(false), sim.params(), sim.time()); gtop = gpos ? gpos.top : null; }
        if (gtop != null) {
          var bottom = gtop - (sim.params().gs || 60);
          lvl = bottom >= 300 ? 3 : bottom >= 200 ? 2 : bottom >= 100 ? 1 : 0;
        }
        push(home, heldG, posed, lvl / 4);
      }
      if (id === 'boulets') push(balls.shots ? 1 : 0);
      if (id === 'adversaire') {
        var o = oppPose || { x: 0, y: 0 };
        push(((blue ? 3000 - (o.x || 0) : (o.x || 0))) / 3000, (o.y || 0) / 2000);
      }
      if (id === 'proprioception') {
        var pNow = sim.pose();
        var vA = (pNow.A && pNow.A.vac) || [0, 0, 0];
        var vB = (pNow.B && pNow.B.vac) || [0, 0, 0];
        push(vA[0], vA[1], vA[2], ((pNow.A && pNow.A.rot) || 0) / 90.0, ((pNow.A && pNow.A.hc) || 165) / 300.0);
        push(vB[0], vB[1], vB[2], ((pNow.B && pNow.B.rot) || 0) / 90.0, ((pNow.B && pNow.B.hc) || 165) / 300.0);
        var rHull = (sim.hullRadius ? sim.hullRadius() : 235) / 350.0;
        push(rHull);
      }
      if (id === 'spatial') {
        var pPos = sim.pose();
        var rx = pPos.x, ry = pPos.y, rcap = pPos.h;
        for (var ray = 0; ray < 8; ray++) {
          var ang = (rcap + ray * 45) * Math.PI / 180.0;
          var dx = Math.cos(ang), dy = Math.sin(ang);
          var maxD = 1000.0, stepD = 50.0, freeD = maxD;
          for (var distVal = 50.0; distVal <= maxD; distVal += stepD) {
            var qx = rx + distVal * dx, qy = ry + distVal * dy;
            if (qx < 70 || qx > 2930 || qy < 70 || qy > 1930) { freeD = distVal; break; }
            if (ACTIONS.hitsCrates(sim, rx, ry, qx, qy, null)) { freeD = distVal; break; }
          }
          push(freeD / maxD);
        }
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

  /* masque « en direct » : pas de trône tant qu'il reste à jouer, et pas avant 80 s si les boulets sont encore possibles */
  function liveMask(catalogue, mask, t, sim) {
    var m = mask.slice(), useful = false, i, ballsIn = false;
    for (i = 0; i < m.length; i++) if (m[i] && catalogue[i].a !== 'trone') useful = true;
    for (i = 0; i < catalogue.length; i++) if (catalogue[i].a === 'boulets') ballsIn = true;
    if ((useful && t < 88) || (ballsIn && !useful && t < 80)) {
      for (i = 0; i < catalogue.length; i++) if (catalogue[i].a === 'trone') m[i] = 0;
    }

    /* Optimisation double face : si le robot est sur la table hors du chateau, qu une face est pleine et l autre vide,
       et qu un paquet prenable sans collision reste disponible avant 75 s, on masque le retour au chateau (mur, tour, porte)
       pour forcer le robot a charger sa seconde face et doubler l efficacite de ses trajets. */
    if (sim && typeof sim.pose === 'function' && t < 75.0) {
      var p = sim.pose();
      var isBlue = (sim.params && sim.params().team === 'blue');
      var inField = isBlue ? (p.x < 2500) : (p.x > 500);
      if (inField) {
        var hA = sim.held()['A'], hB = sim.held()['B'];
        var nA = (hA && hA.stack) ? hA.stack.filter(function (x) { return x; }).length : 0;
        var nB = (hB && hB.stack) ? hB.stack.filter(function (x) { return x; }).length : 0;
        var oneFullOneEmpty = (nA === 3 && nB === 0 && !(hB && hB.graal)) || (nB === 3 && nA === 0 && !(hA && hA.graal));
        if (oneFullOneEmpty) {
          var emptyFace = (nA === 0 && !(hA && hA.graal)) ? 'A' : 'B';
          var hasPack = false;
          for (i = 0; i < catalogue.length; i++) {
            if (m[i] && catalogue[i].a === 'prendre' && catalogue[i].f === emptyFace) {
              hasPack = true;
              break;
            }
          }
          if (hasPack) {
            for (i = 0; i < catalogue.length; i++) {
              var aFam = catalogue[i].a;
              if (aFam === 'mur' || aFam === 'tour' || aFam === 'porte') {
                m[i] = 0;
              }
            }
          }
        }
      }
    }

    return m;
  }

  function chooserFromLayers(layers, acts) {
    acts = acts || [];
    return function (obs, mask) {
      var h = obs.slice(), i, j, k;
      for (i = 0; i < layers.length; i++) {
        var w = layers[i].w, b = layers[i].b, next = [];
        for (j = 0; j < b.length; j++) {
          var s = b[j];
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
      var best = -1, bestv = -1e99;
      for (i = 0; i < h.length; i++) if (mask[i] && h[i] > bestv) { bestv = h[i]; best = i; }
      if (best < 0) { for (i = 0; i < mask.length; i++) if (mask[i]) return i; }
      return best;
    };
  }

  /* Pilote d'un cerveau pour le robot adverse (bleu) : même règles de jeu que le robot du joueur.
     brain = { choose(obs, mask) | layers + acts, entrees, familles }.
     next(sim, otherSim) renvoie la brique à jouer dans le vrai repère du robot (miroir déjà appliqué) ;
     program() renvoie ce que le cerveau a décidé, dans son propre repère (rejouable comme une stratégie). */
  function brainAgent(brain, scenarioSeed) {
    var groups = brain.entrees || DEFAULT_GROUPS.slice();
    var catalogue = ACTIONS.filterByFamilles(brain.familles || ACTIONS.FAMILLES.map(function (f) { return f.id; }));
    var choose = brain.choose || chooserFromLayers(brain.layers, brain.acts);
    var belief = makeBelief(), last = -1, same = 0, n = 0, rec = [];
    function wait(sim, sec) { var b = { a: 'attendreJusqua', sec: sec }; rec.push(b); return b; }
    return {
      kind: 'cerveau',
      next: function (sim, other) {
        var t = sim.time();
        if (t >= MATCH - 0.05 || n >= 80) return null;
        var mask = ACTIONS.mask(sim, catalogue);
        if (!mask.some(function (x) { return x; })) catalogue.forEach(function (a, i) { if (a.a === 'trone') mask[i] = 1; });
        var m = liveMask(catalogue, mask, t, sim);
        if (same >= 2 && last >= 0 && m.some(function (x, i) { return x && i !== last; })) m[last] = 0;
        if (!m.some(function (x) { return x; })) {
          if (t < 80) return wait(sim, 80);
          return wait(sim, MATCH);
        }
        var opp = other ? other.poseAtT(t) : null;
        var idx = choose(observe(sim, groups, belief, opp), m);
        if (idx == null || idx < 0 || !m[idx]) return null;
        if (brain.filterSafety) {
          while (idx != null && idx >= 0 && m[idx]) {
            if (testSimActionSafety(sim, catalogue[idx])) break;
            m[idx] = 0;
            if (!m.some(function (x) { return x; })) { idx = -1; break; }
            idx = choose(observe(sim, groups, belief, opp), m);
          }
          if (idx == null || idx < 0 || !m[idx]) return null;
        }
        if (idx === last) same++; else { same = 1; last = idx; }
        n++;
        var brick = ACTIONS.toProgramStep(catalogue[idx], sim);
        updateBelief(belief, brick, { err: null });
        rec.push(brick);
        return teamOf(sim) === 'blue' ? mirrorStep(brick) : brick;
      },
      program: function () { return rec.slice(); }
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
    agent.program = function () { return list.slice(0, played().length); };   /* repère de la stratégie, pas le miroir */
    return { params: params, agent: agent, spec: spec };
  }

  /* Programme du joueur contre un adversaire (stratégie ou cerveau) : le moteur joue les deux robots et renvoie
     le résultat ainsi que ce que l'adversaire a joué (repère de sa stratégie, rejouable par simulateMatch). */
  function playProgram(prog, params, spec, intensity, skipContacts) {
    var P = Object.assign({}, ENGINE.DEF, params || {});
    var op = opponentSetup(spec, P, intensity || 'realiste');
    var duel = ENGINE.makeDuel({ params: P, skipContacts: !!skipContacts, blue: op ? { params: op.params } : null });
    duel.run({ yellow: ENGINE.programAgent(prog || []), blue: op ? op.agent : null });
    var R = duel.finish();
    return { result: R, program: (prog || []).slice(), opponentProgram: op ? op.agent.program() : [] };
  }

  function create(opts) {
    opts = opts || {};
    var groups = opts.entrees || DEFAULT_GROUPS.slice();
    var familles = opts.familles || ACTIONS.FAMILLES.map(function (f) { return f.id; });
    var catalogue = ACTIONS.filterByFamilles(familles);
    var params = Object.assign({}, ENGINE.DEF, opts.params || {});
    var intensity = (opts.adversaire && opts.adversaire.intensite) || 'aucun';
    var skipContacts = opts.mode === 'rapide' || opts.skipContacts;
    var onError = opts.onError || 'penalite'; /* penalite | fin */
    var duel = null, sim = null, belief = null, opp = null, lastScore = 0, done = false, history = [];

    /* l'adversaire joue toutes les décisions qui précèdent la nôtre (horloge en retard sur la nôtre) */
    function syncOpp(upTo) { if (opp) duel.advanceBlue(opp.agent, upTo == null ? sim.time() : upTo); }
    function oppPose() { return duel && duel.hasBlue ? duel.sims.blue.poseAtT(sim.time()) : { x: 0, y: 0 }; }

    function state() {
      syncOpp();
      if (sim) sim.oppPose = oppPose;
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
      opp = opponentSetup(scenario.opponent || opts.opponent, P, scenario.intensite || intensity);
      duel = ENGINE.makeDuel({ params: P, skipContacts: skipContacts, blue: opp ? { params: opp.params } : null });
      sim = duel.sims.yellow;
      belief = makeBelief();
      done = false;
      history = [];
      lastScore = SCORE.scoreAt(sim.result(false), sim.params(), 0).total;
      var s = state();
      s.reset = true;
      return s;
    }

    function exec(brick) { return duel.exec('yellow', brick); }

    function step(index) {
      if (!sim) reset();
      if (done) return state();
      var act = catalogue[index];
      if (!act) return Object.assign(state(), { err: 'Action hors catalogue.' });
      if (!ACTIONS.valid(act, sim)) {
        if (onError === 'fin') { done = true; return Object.assign(state(), { err: 'Action invalide.', done: true, dt: 0, reward: 0 }); }
        return Object.assign(state(), { err: 'Action invalide.', dt: 0, reward: 0 });
      }
      var brick = ACTIONS.toProgramStep(act, sim);
      var t0 = sim.time();
      var info = exec(brick);
      updateBelief(belief, brick, info);
      history.push(brick);
      var t1 = Math.min(sim.time(), MATCH);
      var sc = SCORE.scoreAt(sim.result(false), sim.params(), t1);
      var reward = sc.total - lastScore;
      lastScore = sc.total;
      if (info.err && onError === 'fin') done = true;
      if (t1 >= MATCH) done = true;
      if (act.a === 'trone') {
        var ballsLeft = sim.balls && !sim.balls().shots && catalogue.some(function (a) { return a.famille === 'boulets' || a.a === 'boulets'; });
        var until = (ballsLeft && sim.time() < 80) ? 80 : MATCH;
        if (sim.time() < until) {
          finishWait(until);
          t1 = Math.min(sim.time(), MATCH);
          sc = SCORE.scoreAt(sim.result(false), sim.params(), t1);
          reward = sc.total - lastScore + reward;
          lastScore = sc.total;
        }
        if (until >= MATCH) done = true;
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
      syncOpp();
      exec(brick);
      history.push(brick);
      var t1 = Math.min(sim.time(), MATCH);
      lastScore = SCORE.scoreAt(sim.result(false), sim.params(), t1).total;
      if (t1 >= MATCH) done = true;
    }
    /* Vérification de sécurité physique en amont : teste l'action dans une copie du monde et vérifie l'absence de collision et d'erreur */
    function testActionSafety(act) {
      if (!sim || typeof sim.snapshot !== 'function') return true;
      var snap = snapshot();
      try {
        var brick = ACTIONS.toProgramStep(act, sim);
        var prevErrCount = (snap.sim.errors || []).length;
        var info = exec(brick);
        var curSnap = sim.snapshot();
        var hasErr = (curSnap.errors || []).length > prevErrCount || (info && info.err);
        var hasCol = false;
        if (!skipContacts) {
          var res = sim.result(true);
          hasCol = !!(res.collisions && res.collisions.length > 0);
        }
        restore(snap);
        return !hasErr && !hasCol;
      } catch (e) {
        restore(snap);
        return false;
      }
    }

    /* le match se termine : l'adversaire joue ce qui lui reste jusqu'à 100 s (pour que le rejeu soit complet) */
    function endMatch() { syncOpp(MATCH); }

    /* Le réseau décide après chaque brique, jusqu'à 100 s. Ce n'est pas un programme figé. */
    function play(chooseFn, scenario) {
      var st = reset(scenario || {}), n = 0, last = -1, same = 0, max = 80;
      var doFilterSafety = opts.filterSafety || (scenario && scenario.filterSafety);
      while (!st.done && n < max && sim.time() < MATCH) {
        var m = liveMask(catalogue, st.mask, st.t, sim);
        if (same >= 2 && last >= 0 && m.some(function (x, i) { return x && i !== last; })) m[last] = 0;
        if (!m.some(function (x) { return x; })) {
          if (sim.time() < 80) { finishWait(80); st = state(); n++; continue; }
          break;
        }
        var idx = chooseFn(st.obs, m);
        if (idx == null || idx < 0) break;
        if (doFilterSafety) {
          while (idx != null && idx >= 0 && m[idx]) {
            if (testActionSafety(catalogue[idx])) break;
            m[idx] = 0;
            if (!m.some(function (x) { return x; })) { idx = -1; break; }
            idx = chooseFn(st.obs, m);
          }
          if (idx == null || idx < 0 || !m[idx]) break;
        }
        if (idx === last) same++; else { same = 1; last = idx; }
        st = step(idx);
        n++;
      }
      if (sim && sim.time() < MATCH - 0.05) finishWait(MATCH);
      done = true;
      endMatch();
      return state();
    }
    function imitate(program, scenario) {
      var s0 = reset(scenario || { intensite: 'aucun' });
      var pairs = [];
      (program || []).forEach(function (st) {
        if (!st || st.a === 'attendre' || st.a === 'attendreJusqua') {
          if (sim && st) { syncOpp(); exec(st); }
          return;
        }
        syncOpp();
        var idx = ACTIONS.indexOfStep(st, sim, catalogue);
        if (idx < 0) { exec(st); history.push(st); return; }
        var s = state();
        pairs.push({ obs: s.obs, action: idx, mask: s.mask });
        var info = exec(st);
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
    /* ce que l'adversaire a joué, dans son repère (rejouable comme une stratégie par simulateMatch) */
    function opponentProgram() { return opp ? opp.agent.program() : []; }
    function result() {
      if (!sim) return null;
      var R = sim.result(!skipContacts);
      if (duel.hasBlue) {
        R.opponent = duel.sims.blue.result(false);
        R.oppEvents = { taken: Object.assign({}, duel.claims.blue), none: false };
      }
      return R;
    }
    function snapshot() {
      return sim ? {
        sim: sim.snapshot(), blue: duel.hasBlue ? duel.sims.blue.snapshot() : null,
        claims: JSON.parse(JSON.stringify(duel.claims)), programs: JSON.parse(JSON.stringify(duel.programs)),
        belief: JSON.parse(JSON.stringify(belief)), lastScore: lastScore, done: done, history: JSON.parse(JSON.stringify(history))
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
      belief = snap.belief; lastScore = snap.lastScore; done = snap.done; history = snap.history;
    }

    return { reset: reset, step: step, play: play, testActionSafety: testActionSafety, imitate: imitate, program: program, opponentProgram: opponentProgram, result: result, snapshot: snapshot, restore: restore, catalogue: catalogue, groups: groups, nInputs: nInputs(groups), nOutputs: catalogue.length };
  }

  function testSimActionSafety(sim, act) {
    if (!sim || typeof sim.snapshot !== 'function') return true;
    var snap = sim.snapshot();
    try {
      var brick = ACTIONS.toProgramStep(act, sim);
      var prevErrCount = (snap.errors || []).length;
      var info = sim.exec(brick);
      var curSnap = sim.snapshot();
      var hasErr = (curSnap.errors || []).length > prevErrCount || (info && info.err);
      var res = sim.result(true);
      var hasCol = !!(res.collisions && res.collisions.length > 0);
      sim.restore(snap);
      return !hasErr && !hasCol;
    } catch (e) {
      sim.restore(snap);
      return false;
    }
  }

  var EXAMPLE = [
    { a: 'prendre', f: 'A', p: 'P1' }, { a: 'prendre', f: 'B', p: 'P9' },
    { a: 'mur', f: 'A', z: 'M1', side: 'ext' }, { a: 'mur', f: 'B', z: 'M2', side: 'ext' },
    { a: 'prendre', f: 'A', p: 'P5' }, { a: 'prendre', f: 'B', p: 'P10' },
    { a: 'mur', f: 'A', z: 'M5', side: 'ext' }, { a: 'mur', f: 'B', z: 'M4', side: 'ext' },
    { a: 'prendre', f: 'A', p: 'P4' },
    { a: 'porte', f: 'A', z: 'M3', side: 'int' },
    { a: 'prendreGraal', f: 'B' }, { a: 'poserGraal', f: 'B', z: 'M3' },
    { a: 'tir' },
    { a: 'trone' }
  ];

  var api = {
    MATCH: MATCH, GROUPS: GROUPS, DEFAULT_GROUPS: DEFAULT_GROUPS, nInputs: nInputs, create: create, mirrorId: mirrorId,
    mirrorStep: mirrorStep, blueParams: blueParams, pickOpponent: pickOpponent,
    chooserFromLayers: chooserFromLayers, brainAgent: brainAgent, opponentSetup: opponentSetup,
    playProgram: playProgram, qualify: qualify, EXAMPLE: EXAMPLE,
    observe: observe, makeBelief: makeBelief, updateBelief: updateBelief, liveMask: liveMask,
    testActionSafety: testSimActionSafety
  };
  root.ENV = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
