#!/usr/bin/env node
/**
 * Pont de simulation de match Eurobot 2027 pour ICAM LOT (JSON-lignes sur stdin/stdout).
 * Duel entre deux cerveaux externes (self-play) ou contre un adversaire automatique, avec la même croyance,
 * la même observation (ENV.observeBelief) et le même masque (ACTIONS.maskBelief) que l'environnement d'apprentissage.
 *
 *   ping                                   -> { ok, version, bareme, obsVersion, catalogueVersion }
 *   init   { config: { params?, blue?: 'external' | intensité, opponent?: { program, params } | { brain } } }
 *          adversaire automatique par défaut : ENGINE.PROGRAMME_REFERENCE en miroir (décision §9)
 *          -> { status: 'need_action', team, t, obs, mask } | { status: 'finished', ... }
 *   action { team, action }                -> idem (action = index dans ACTIONS.ALL)
 */
var path = require('path');
var readline = require('readline');
var loadIcamlot = require('./load.js').loadIcamlot;
var ctx = loadIcamlot(path.resolve(__dirname, '..'));
var ENGINE = ctx.ENGINE, ENV = ctx.ENV, SCORE = ctx.SCORE, ACTIONS = ctx.ACTIONS;
var MATCH = ENV.MATCH, CAT = ACTIONS.ALL;

var duel = null, blueAgent = null, isBlueExternal = false, guard = 0;
var done = { yellow: false, blue: false }, minds = { yellow: null, blue: null }, pending = { yellow: null, blue: null };

function reply(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function other(team) { return team === 'yellow' ? 'blue' : 'yellow'; }
/* esprit d'un robot externe : croyance mise à jour par ENV.makeMind (caméras, prises, échecs), choix fait à l'extérieur */
function externalMind() { return ENV.makeMind({ groups: ENV.DEFAULT_GROUPS.slice(), catalogue: CAT, choose: null }); }

function finishMatch() {
  if (blueAgent) { try { duel.advanceBlue(blueAgent, MATCH); } catch (e) { /* adversaire automatique terminé */ } }
  ['yellow', 'blue'].forEach(function (team) {
    var sim = duel.sims[team];
    if (sim && sim.time() < MATCH) duel.exec(team, { a: 'attendreJusqua', sec: MATCH });
  });
  var Ry = duel.finish(), Rb = Ry.opponent;
  function side(R, team) {
    var sc = R ? SCORE.scoreAt(R, R.params, MATCH) : { total: 0, detail: {} };
    return {
      score: sc.total, detail: sc.detail, errors: R ? R.errors.length : 0, error_list: (R && R.errors) || [],
      collisions: R && R.collisions ? R.collisions.length : 0, t: R ? Math.min(R.T, MATCH) : 0, actions: duel.programs[team].length
    };
  }
  return { status: 'finished', yellow: side(Ry, 'yellow'), blue: side(Rb, 'blue'), claims: { yellow: Object.keys(duel.claims.yellow), blue: Object.keys(duel.claims.blue) } };
}

function decision(team) {
  var sim = duel.sims[team], t = sim.time();
  if (t >= MATCH - 0.05) { done[team] = true; return null; }
  var b = minds[team].belief(sim, ENV.lidarOf(duel.sims[other(team)], t));
  var m = ACTIONS.maskBelief(b, CAT);
  if (!m.some(function (x) { return x; })) {
    /* plus aucune action possible : le robot attend la fin du match sur place */
    duel.exec(team, { a: 'attendreJusqua', sec: MATCH });
    done[team] = true;
    return null;
  }
  pending[team] = { belief: b, mask: m };
  return { status: 'need_action', team: team, t: t, obs: ENV.observeBelief(b, ENV.DEFAULT_GROUPS), mask: m };
}

function next() {
  while (guard++ < 2000) {
    var ty = done.yellow ? Infinity : duel.sims.yellow.time(), tb = done.blue ? Infinity : duel.sims.blue.time();
    if (ty >= MATCH - 0.05) done.yellow = true;
    if (tb >= MATCH - 0.05) done.blue = true;
    if (done.yellow && done.blue) return finishMatch();
    var team = done.yellow ? 'blue' : done.blue ? 'yellow' : (tb < ty ? 'blue' : 'yellow');
    if (team === 'blue' && !isBlueExternal) {
      var b = blueAgent ? blueAgent.next(duel.sims.blue, duel.sims.yellow) : null;
      if (b == null) done.blue = true; else duel.exec('blue', b);
      continue;
    }
    var d = decision(team);
    if (d) return d;
  }
  return finishMatch();
}

function initMatch(cfg) {
  cfg = cfg || {};
  guard = 0; done = { yellow: false, blue: false }; pending = { yellow: null, blue: null };
  var Py = Object.assign({}, ENGINE.DEF, cfg.params || {});
  isBlueExternal = cfg.blue === 'external';
  var intensity = isBlueExternal ? 'realiste' : (cfg.blue || 'realiste');
  var spec = cfg.opponent || { program: ENGINE.PROGRAMME_REFERENCE };
  var op = isBlueExternal ? null : ENV.opponentSetup(spec, Py, intensity);
  var Pb = op ? op.params : ENGINE.intensityParams(ENGINE.blueParams(Py), intensity);
  duel = ENGINE.makeDuel({ params: Py, skipContacts: false, blue: { params: Pb, contacts: true } });
  blueAgent = op ? op.agent : null;
  minds.yellow = externalMind();
  minds.blue = isBlueExternal ? externalMind() : null;
  return next();
}

function applyAction(team, idx) {
  var p = pending[team], act = CAT[idx];
  if (!p || done[team]) return { error: 'Pas de décision en attente pour ' + team + '.' };
  if (!act || !p.mask[idx]) return { error: 'Action ' + idx + ' invalide pour ' + team + ' (masque).' };
  var st = ACTIONS.toProgramStep(act, p.belief);
  minds[team].played(duel.sims[team], p.belief, idx, st);
  duel.exec(team, ACTIONS.realStep(st, p.belief.team));
  pending[team] = null;
  if (act.a === 'finir') done[team] = true;
  return next();
}

var rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', function (line) {
  line = line.trim();
  if (!line) return;
  var msg;
  try { msg = JSON.parse(line); } catch (e) { return reply({ error: 'JSON parse error' }); }
  try {
    if (msg.cmd === 'ping') return reply({ ok: true, version: ENGINE.VERSION, bareme: ctx.BAREME_VERSION, obsVersion: ENV.OBS_VERSION, catalogueVersion: ACTIONS.CATALOGUE_VERSION });
    if (msg.cmd === 'init') return reply(initMatch(msg.config || {}));
    if (msg.cmd === 'action') return reply(applyAction(msg.team, msg.action));
    reply({ error: 'Unknown cmd: ' + msg.cmd });
  } catch (err) {
    reply({ error: 'Runtime error: ' + err.message, stack: err.stack });
  }
});
