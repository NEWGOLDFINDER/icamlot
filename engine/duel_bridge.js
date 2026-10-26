#!/usr/bin/env node
/**
 * Pont de simulation de match Eurobot 2027 pour ICAM LOT.
 * Interface JSON-RPC sur stdin/stdout pour piloter des duels complets
 * entre deux cerveaux (Self-Play) ou contre des adversaires de référence.
 */
var path = require('path');
var readline = require('readline');
var loadIcamlot = require('./load.js').loadIcamlot;
var ctx = loadIcamlot(path.resolve(__dirname, '..'));

var ENGINE = ctx.ENGINE, ENV = ctx.ENV, SCORE = ctx.SCORE, ACTIONS = ctx.ACTIONS;

var duel = null;
var blueAgent = null;
var isBlueExternal = false;
var done = { yellow: false, blue: false };
var beliefs = { yellow: null, blue: null };
var lastAction = { yellow: -1, blue: -1 };
var repeatCount = { yellow: 0, blue: 0 };
var guardSteps = 0;
var rejectedMask = { yellow: {}, blue: {} };

function reply(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function checkOverlap(Ry, Rb) {
  if (!Ry || !Rb) return 0;
  var n = 0;
  var tMax = Math.min(Ry.T, Rb.T);
  for (var tt = 0; tt <= tMax; tt += 0.05) {
    var py = Ry.poseAt(tt);
    var pb = Rb.poseAt(tt);
    if (py && pb && ctx.overlap(ctx.triPoly(py), ctx.triPoly(pb), 1)) {
      n++;
    }
  }
  return n;
}

function finishMatch() {
  if (blueAgent) {
    try {
      duel.advanceBlue(blueAgent, ENV.MATCH);
    } catch (e) {}
  }
  var Ry = duel.finish();
  var Rb = Ry.opponent;

  var scY = SCORE.scoreAt(Ry, Ry.params, ENV.MATCH);
  var scB = Rb ? SCORE.scoreAt(Rb, Rb.params, ENV.MATCH) : { total: 0, detail: {} };
  var overlap = checkOverlap(Ry, Rb);

  return {
    status: 'finished',
    yellow: {
      score: scY.total,
      detail: scY.detail,
      errors: Ry.errors.length,
      error_list: Ry.errors || [],
      collisions: Ry.collisions ? Ry.collisions.length : 0,
      collision_list: Ry.collisions || [],
      t: Math.min(Ry.T, ENV.MATCH),
      actions: duel.programs.yellow.length
    },
    blue: {
      score: scB.total,
      detail: scB.detail,
      errors: Rb ? Rb.errors.length : 0,
      error_list: (Rb && Rb.errors) || [],
      collisions: (Rb && Rb.collisions) ? Rb.collisions.length : 0,
      collision_list: (Rb && Rb.collisions) || [],
      t: Rb ? Math.min(Rb.T, ENV.MATCH) : 0,
      actions: duel.programs.blue.length
    },
    overlap_steps: overlap,
    claims: {
      yellow: Object.keys(duel.claims.yellow),
      blue: Object.keys(duel.claims.blue)
    }
  };
}

function getDecision(team) {
  var sim = duel.sims[team];
  var otherTeam = team === 'yellow' ? 'blue' : 'yellow';
  var otherSim = duel.sims[otherTeam];

  var t = sim.time();
  if (t >= ENV.MATCH - 0.05 || guardSteps >= 500) {
    done[team] = true;
    return null;
  }

  var rawMask = ACTIONS.mask(sim, ACTIONS.ALL);
  if (!rawMask.some(function (x) { return x; })) {
    ACTIONS.ALL.forEach(function (a, i) { if (a.a === 'trone') rawMask[i] = 1; });
  }

  var m = ENV.liveMask(ACTIONS.ALL, rawMask, t);
  if (repeatCount[team] >= 2 && lastAction[team] >= 0 && m.some(function (x, i) { return x && i !== lastAction[team]; })) {
    m[lastAction[team]] = 0;
  }

  // Appliquer les rejets temporaires pour ce pas de temps
  var rej = rejectedMask[team];
  for (var k in rej) {
    if (rej[k]) m[parseInt(k, 10)] = 0;
  }

  if (!m.some(function (x) { return x; })) {
    // Si rien de possible, attendre
    var waitSec = t < 80 ? 80 : ENV.MATCH;
    var brick = { a: 'attendreJusqua', sec: waitSec };
    duel.exec(team, team === 'blue' ? ENGINE.mirrorStep(brick) : brick);
    rejectedMask[team] = {};
    return null;
  }

  var oppPose = otherSim ? otherSim.poseAtT(t) : null;
  var obs = ENV.observe(sim, null, beliefs[team], oppPose);

  return {
    status: 'need_action',
    team: team,
    t: t,
    obs: obs,
    mask: m
  };
}

function findNextTeam() {
  while (guardSteps++ < 500) {
    if (done.yellow && done.blue) {
      return finishMatch();
    }

    var ty = done.yellow ? Infinity : duel.sims.yellow.time();
    var tb = done.blue ? Infinity : duel.sims.blue.time();

    if (ty >= ENV.MATCH - 0.05) done.yellow = true;
    if (tb >= ENV.MATCH - 0.05) done.blue = true;

    if (done.yellow && done.blue) {
      return finishMatch();
    }

    var nextTeam = ty <= tb ? 'yellow' : 'blue';

    if (nextTeam === 'blue' && !isBlueExternal) {
      // Adversaire automatique
      if (blueAgent) {
        var b = blueAgent.next(duel.sims.blue, duel.sims.yellow);
        if (b == null) {
          done.blue = true;
        } else {
          duel.exec('blue', b);
        }
      } else {
        done.blue = true;
      }
      continue;
    }

    // Le robot désigné (Yellow ou Blue externe) doit décider
    var dec = getDecision(nextTeam);
    if (dec) {
      return dec;
    }
  }

  return finishMatch();
}

function initMatch(cfg) {
  cfg = cfg || {};
  guardSteps = 0;
  done.yellow = false;
  done.blue = false;
  lastAction.yellow = -1;
  lastAction.blue = -1;
  repeatCount.yellow = 0;
  repeatCount.blue = 0;
  rejectedMask.yellow = {};
  rejectedMask.blue = {};

  var Py = Object.assign({}, ENGINE.DEF, cfg.params || {});
  isBlueExternal = cfg.blue === 'external';

  var intensity = cfg.blue || 'realiste';
  var Pb = ENGINE.intensityParams(ENGINE.blueParams(Py), isBlueExternal ? 'realiste' : intensity);

  duel = ENGINE.makeDuel({
    params: Py,
    skipContacts: false,
    blue: { params: Pb, contacts: true }
  });

  beliefs.yellow = ENV.makeBelief();
  beliefs.blue = ENV.makeBelief();

  if (!isBlueExternal) {
    var op = ENV.opponentSetup({ program: ENV.EXAMPLE }, Pb, intensity);
    blueAgent = op ? op.agent : null;
  } else {
    blueAgent = null;
  }

  return findNextTeam();
}

function testActionSafety(team, actIdx) {
  var sim = duel.sims[team];
  var act = ACTIONS.ALL[actIdx];
  if (!act) return false;
  var brick = ACTIONS.toProgramStep(act, sim);
  var testBrick = team === 'blue' ? ENGINE.mirrorStep(brick) : brick;
  var snap = sim.snapshot();
  var errs0 = sim.result(false).errors.length;
  sim.exec(testBrick);
  var res = sim.result(true);
  var errs1 = res.errors.length;
  var cols = res.collisions ? res.collisions.length : 0;
  sim.restore(snap);
  return (errs1 === errs0) && (cols === 0);
}

function applyAction(team, actIdx) {
  var sim = duel.sims[team];
  var cat = ACTIONS.ALL;
  var act = cat[actIdx];

  if (!act) {
    done[team] = true;
    return findNextTeam();
  }

  // Vérifier la sécurité physique de l'action choisie
  if (!testActionSafety(team, actIdx)) {
    // Action non sécurisée : on l'interdit pour ce pas et on redemande une décision
    rejectedMask[team][actIdx] = true;
    var reDec = getDecision(team);
    if (reDec) return reDec;
    return findNextTeam();
  }

  // Action validée : réinitialiser les rejets pour le prochain pas
  rejectedMask[team] = {};

  if (actIdx === lastAction[team]) {
    repeatCount[team]++;
  } else {
    repeatCount[team] = 1;
    lastAction[team] = actIdx;
  }

  var brick = ACTIONS.toProgramStep(act, sim);
  var info = duel.exec(team, team === 'blue' ? ENGINE.mirrorStep(brick) : brick);
  ENV.updateBelief(beliefs[team], brick, info || { err: null });

  if (!isBlueExternal && blueAgent) {
    try {
      duel.advanceBlue(blueAgent, duel.sims.yellow.time());
    } catch (e) {}
  }

  return findNextTeam();
}

var rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', function (line) {
  line = line.trim();
  if (!line) return;
  var msg;
  try { msg = JSON.parse(line); } catch (e) { return reply({ error: 'JSON parse error' }); }

  try {
    if (msg.cmd === 'ping') {
      return reply({ ok: true, version: ENGINE.VERSION, bareme: ctx.BAREME_VERSION });
    }
    if (msg.cmd === 'init') {
      return reply(initMatch(msg.config || {}));
    }
    if (msg.cmd === 'action') {
      return reply(applyAction(msg.team, msg.action));
    }
    reply({ error: 'Unknown cmd: ' + msg.cmd });
  } catch (err) {
    reply({ error: 'Runtime error: ' + err.message, stack: err.stack });
  }
});
