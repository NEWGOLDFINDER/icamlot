#!/usr/bin/env node
/* Pont Node persistant entre le runner Python (Raspberry Pi 5) et le moteur JS de référence.

   Le runner n'a AUCUNE copie Python de l'observation, du masque ni de la conversion action -> brique : il appelle ici les
   mêmes fonctions pures que l'entraînement (contrats §4 et §5 de docs/CONTRATS.md) :
     ENV.observeBelief(belief, groupes)   ACTIONS.maskBelief(belief, catalogue)   ACTIONS.toProgramStep(act, belief)
     ACTIONS.realStep(brique, equipe)     ENV.OBS_VERSION    ACTIONS.CATALOGUE_VERSION

   Protocole : JSON-lignes sur stdin -> stdout (comme engine/env_worker.js). Une requête = un objet JSON sur une ligne avec un
   champ « cmd » ; chaque requête reçoit exactement une réponse (une ligne), dans l'ordre. Un champ « rid » est recopié.
   Une commande qui échoue répond { error } et le processus continue. Rien d'autre n'est écrit sur stdout (traces : stderr).

   ── Fonctions pures (mêmes entrées que l'entraînement) ──
   hello        { entrees?, familles?, vision? }  configure les groupes d'observation et les familles d'actions (défaut : tous),
                                                  -> { obsVersion, catalogueVersion, nInputs, nOutputs, groups, catalogue, match,
                                                       vitesses, moteur, bareme }
                vision:false coupe le modèle de caméras simulé (ENV.VISION), à utiliser quand les caméras sont réelles.
   observe      { belief }                        -> { obs }
   mask         { belief }                        -> { mask }
   observe_mask { belief }                        -> { obs, mask }                       (un seul aller-retour par décision)
   step         { index | act, belief }           -> { index, act, brique, reelle }
                brique = ACTIONS.toProgramStep (repère de l'équipe, avec le temps masqué tm) ; reelle = ACTIONS.realStep(brique, equipe)
   mirror_ids   { ids }                           -> { ids } : ids du repère réel <-> repère de l'équipe (ENGINE.mirrorId)

   ── Mode simulation (capteurs simulés par le moteur : ENV.beliefFromSim) ──
   sim_reset    { config?, scenario?, maxDecisions?, trace? } -> état
   sim_step     { index, trace? }                              -> état + { brique, plan, dt, final? }
        état = { belief, obs, mask, t, score, reward, done, err, truncated? }
        plan = déplacements et événements de la brique (voir extractPlan), lus dans les points clés du moteur.
        maxDecisions : 80 par défaut, comme le pool d'évaluation (engine/env_worker.js, DEFAULT_MAX_DECISIONS).
        final = bilan de l'épisode, comme env_worker.js (score à min(T, 100) s, erreurs moteur, adversaire).

   ── Modèle interne du robot (robot réel) ──
   Le robot réel exécute chaque brique sur un moteur local sans adversaire (prédiction de ses propres pinces, constructions,
   pierres posées, Graal), dont le plan (trajet, mouvements de pince en temps masqué) est celui que les ESP32 reproduisent.
   track_start  { params?, vision? }              -> { belief }
   track_exec   { brique, adversaire?, trace? }   -> { info, plan, belief, frames? }
   reference                                      -> { programme } : ENGINE.PROGRAMME_REFERENCE (briques en repère de l'équipe)
   track_belief { adversaire? }                   -> { belief }

   Repère : toutes les briques, tous les plans et la croyance du modèle interne sont dans le repère de l'équipe (jaune).
   Pour l'équipe bleue, le runner met les mesures en miroir à l'entrée et les commandes ESP32 à la sortie. */
'use strict';
var path = require('path');
var readline = require('readline');
var loadIcamlot = require('../engine/load.js').loadIcamlot;
var rootDir = path.resolve(__dirname, '..');
var ctx = loadIcamlot(rootDir);
var ENV = ctx.ENV, ACTIONS = ctx.ACTIONS, ENGINE = ctx.ENGINE, SCORE = ctx.SCORE;

/* Hypothèse : nombre maximal de décisions par épisode simulé (repris de engine/env_worker.js, DEFAULT_MAX_DECISIONS). */
var DEFAULT_MAX_DECISIONS = 80;
/* Tolérance sur les valeurs des points clés (mm, degrés) pour décider qu'un axe bouge, et sur les instants (s). Hypothèse numérique. */
var EPS_VAL = 1e-6, EPS_T = 1e-9;

var cfg = { groups: ENV.DEFAULT_GROUPS.slice(), familles: null, catalogue: ACTIONS.ALL.slice() };
var simEnv = null, simState = null, track = null;

function reply(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

function numOr(x, d) { return x != null && x.valeur != null ? x.valeur : (typeof x === 'number' ? x : d); }
function vitesses() {
  var e = (ctx.SPEC.robot && ctx.SPEC.robot.entrainement) || {};
  return {
    lineaire_mm_s: numOr(e.vitesse_lineaire_mm_s, null), approche_mm_s: numOr(e.vitesse_approche_mm_s, null),
    rotation_deg_s: numOr(e.vitesse_rotation_deg_s, null)
  };
}

function configure(msg) {
  if (msg.entrees || msg.familles || msg.reset) {
    cfg.groups = (msg.entrees || ENV.DEFAULT_GROUPS).slice();
    cfg.familles = msg.familles || null;
    cfg.catalogue = ACTIONS.filterByFamilles(cfg.familles || ACTIONS.FAMILLES.map(function (f) { return f.id; }));
  }
  if (msg.vision === false) ENV.VISION.portee = -1;
}

function hello(msg) {
  configure(msg);
  return {
    ok: true, moteur: ENGINE.VERSION, bareme: ctx.BAREME_VERSION,
    obsVersion: ENV.OBS_VERSION, catalogueVersion: ACTIONS.CATALOGUE_VERSION,
    nInputs: ENV.nInputs(cfg.groups), nOutputs: cfg.catalogue.length, groups: cfg.groups, catalogue: cfg.catalogue,
    match: ENV.MATCH, vitesses: vitesses()
  };
}

function need(msg, k) { if (msg[k] == null) throw new Error('Champ « ' + k + ' » manquant.'); return msg[k]; }

/* ---------------------------------------------------------------------------------------------------------------------------
   Plan d'une brique, lu dans les points clés du moteur (sim.result(false).K) : c'est le « temps masqué » du moteur.
   Les instants sont relatifs au début de la brique. Axes regroupés comme les actionneurs réels :
     NAV (x, y, h)   GRIP_A / GRIP_B (hc, rot)   FORK (fx, fz)   CANON (can)
   Un déplacement (« move ») est un intervalle continu pendant lequel le groupe change de valeur : pts = [{ t, v: [...] }].
   Deux déplacements dont les intervalles se recouvrent s'exécutent en parallèle dans le moteur.
   Événements : VAC (ventouses d'une face, 3 rangées, 0/1), CANON_SPIN, FIRE (tir de n boulets ; noAvant = instant de match avant
   lequel on ne tire pas, début de la phase d'attaque), WAIT (attente ; until = instant de match absolu).
--------------------------------------------------------------------------------------------------------------------------- */
var GROUPS = {
  NAV: function (f) { return [f.x, f.y, f.h]; },
  GRIP_A: function (f) { return [f.A.hc, f.A.rot]; },
  GRIP_B: function (f) { return [f.B.hc, f.B.rot]; },
  FORK: function (f) { return [f.C.fx, f.C.fz]; },
  CANON: function (f) { return [f.C.can]; }
};
function differs(a, b) { for (var i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > EPS_VAL) return true; return false; }
function vacOf(f, face) { return (f[face].vac || []).map(function (v) { return v ? 1 : 0; }); }
function sameArr(a, b) { return a.length === b.length && a.every(function (x, i) { return x === b[i]; }); }

function extractPlan(sim, k0, t0, brique, info) {
  var R = sim.result(false), K = R.K, t1 = sim.time();
  var first = K[Math.max(0, k0 - 1)];
  var frames = [Object.assign({}, first, { t: t0 })].concat(K.slice(k0));
  var moves = [], events = [], open = {};
  function rel(t) { return Math.max(0, t - t0); }
  function nextTimeAfter(i, t) { for (var j = i + 1; j < frames.length; j++) if (frames[j].t > t + EPS_T) return frames[j].t; return t; }
  for (var i = 1; i < frames.length; i++) {
    var p = frames[i - 1], q = frames[i], dt = q.t - p.t;
    Object.keys(GROUPS).forEach(function (g) {
      var pv = GROUPS[g](p), qv = GROUPS[g](q), ch = differs(pv, qv), o = open[g];
      if (ch && dt > EPS_T) {
        if (o && Math.abs(o.last - p.t) <= EPS_T) { o.pts.push({ t: rel(q.t), v: qv }); o.last = q.t; }
        else { o = open[g] = { g: g, pts: [{ t: rel(p.t), v: pv }, { t: rel(q.t), v: qv }], last: q.t }; moves.push(o); }
      } else if (ch) {
        /* saut instantané (aucun temps ne passe) : déplacement de durée nulle */
        moves.push({ g: g, pts: [{ t: rel(p.t), v: pv }, { t: rel(q.t), v: qv }], last: q.t, jump: true });
        open[g] = null;
      } else if (dt > EPS_T) open[g] = null;
    });
    ['A', 'B'].forEach(function (face) {
      var va = vacOf(p, face), vb = vacOf(q, face);
      if (!sameArr(va, vb)) events.push({ kind: 'VAC', face: face, rows: vb, t0: rel(q.t), t1: rel(nextTimeAfter(i, q.t)) });
    });
  }
  /* événements propres à la brique, absents des points clés */
  var P = sim.params(), B = sim.balls();
  if ((brique.a === 'tir' || brique.a === 'boulets') && !(info && info.err) && B.shots && B.tDeploy >= t0 - EPS_T) {
    var dep = P.bdep > 0 ? P.bdep : 0.1;
    if (P.bspin > 0) events.push({ kind: 'CANON_SPIN', t0: rel(B.tDeploy + dep), t1: rel(B.tDeploy + dep + P.bspin) });
    events.push({ kind: 'FIRE', n: B.n, rate: P.brate > 0 ? P.brate : 2, t0: rel(B.t0), t1: rel(t1), noAvant: ENGINE.T_ATTAQUE });
  }
  if (brique.a === 'attendre' || brique.a === 'attendreJusqua') events.push({ kind: 'WAIT', until: brique.a === 'attendreJusqua' ? +brique.sec : null, t0: 0, t1: rel(t1) });
  moves.forEach(function (m) { delete m.last; });
  var plan = { brique: brique, t0: t0, t1: t1, dt: t1 - t0, err: (info && info.err) || null, moves: moves, events: events };
  return plan;
}

function framesSince(sim, k0, t0) {
  var K = sim.result(false).K;
  return [Object.assign({}, K[Math.max(0, k0 - 1)], { t: t0 })].concat(K.slice(k0)).map(function (f) {
    return { t: f.t - t0, x: f.x, y: f.y, h: f.h, A: f.A, B: f.B, C: f.C };
  });
}

/* ---------------------------------------------------------------------------------------------------------------------------
   Mode simulation
--------------------------------------------------------------------------------------------------------------------------- */
function resolveScenario(sc) { return sc || {}; }
function simSnapshot(st) {
  return { belief: simEnv.belief(), obs: st.obs, mask: st.mask, t: st.t, score: st.score, reward: st.reward || 0, done: !!st.done, err: st.err || null };
}
function bilan() {
  var R = simEnv.result();
  var sc = SCORE.scoreAt(R, R.params, Math.min(R.T, ENV.MATCH));
  var out = { score: sc.total, detail: sc.detail, T: R.T, errors: (R.errors || []).length, decisions: simState.decisions, truncated: !!simState.truncated, adversaire: null };
  if (R.opponent) {
    var so = SCORE.scoreAt(R.opponent, R.opponent.params, Math.min(R.opponent.T, ENV.MATCH));
    out.adversaire = { score: so.total, errors: (R.opponent.errors || []).length };
  }
  return out;
}
function simReset(msg) {
  if (!simEnv || msg.config) simEnv = ENV.create(msg.config || { skipContacts: true });
  simState = { decisions: 0, maxDecisions: Math.max(1, parseInt(msg.maxDecisions, 10) || DEFAULT_MAX_DECISIONS), truncated: false, done: false };
  var st = simEnv.reset(resolveScenario(msg.scenario));
  var out = simSnapshot(st);
  out.nInputs = simEnv.nInputs; out.nOutputs = simEnv.nOutputs;
  return out;
}
function simStep(msg) {
  if (!simEnv || !simState) throw new Error('sim_reset d\'abord.');
  if (simState.done) throw new Error('Épisode terminé : sim_reset d\'abord.');
  var sim = simEnv.sim, k0 = sim.result(false).K.length, t0 = sim.time(), st, crash = null;
  try { st = simEnv.step(+need(msg, 'index')); simState.decisions++; }
  catch (e) { crash = e.message; simState.decisions++; }
  if (crash) {
    simState.done = true;
    return { belief: null, obs: [], mask: [], t: t0, score: 0, reward: 0, done: true, err: 'Exception moteur : ' + crash, crash: true, brique: null, plan: null, dt: 0 };
  }
  var out = simSnapshot(st);
  out.brique = st.step || null; out.dt = st.dt || 0;
  out.plan = extractPlan(sim, k0, t0, st.step || {}, { err: st.err });
  if (msg.trace) out.frames = framesSince(sim, k0, t0);
  if (!out.done && simState.decisions >= simState.maxDecisions) { out.done = true; out.truncated = true; simState.truncated = true; }
  if (out.done) { simState.done = true; out.final = bilan(); }
  return out;
}

/* ---------------------------------------------------------------------------------------------------------------------------
   Modèle interne du robot réel (moteur local sans adversaire, repère de l'équipe)
--------------------------------------------------------------------------------------------------------------------------- */
function trackStart(msg) {
  configure(msg);
  var P = Object.assign({}, ENGINE.DEF, msg.params || {});
  var duel = ENGINE.makeDuel({ params: P, skipContacts: true, blue: null });
  track = { duel: duel, sim: duel.sims.yellow, mem: ENV.newMemory() };
  return { belief: ENV.beliefFromSim(track.sim, track.mem, null) };
}
function trackExec(msg) {
  if (!track) throw new Error('track_start d\'abord.');
  var brique = need(msg, 'brique'), sim = track.sim, k0 = sim.result(false).K.length, t0 = sim.time();
  var info = track.duel.exec('yellow', ACTIONS.realStep(brique, 'yellow'));
  ENV.updateMemory(track.mem, sim, t0, sim.time(), brique, info);
  var out = { info: info, plan: extractPlan(sim, k0, t0, brique, info), belief: ENV.beliefFromSim(sim, track.mem, msg.adversaire || null) };
  if (msg.trace) out.frames = framesSince(sim, k0, t0);
  return out;
}

/* ---------------------------------------------------------------------------------------------------------------------------
   Commandes
--------------------------------------------------------------------------------------------------------------------------- */
function handle(msg) {
  switch (msg.cmd) {
    case 'ping': return { ok: true };
    case 'hello': return hello(msg);
    case 'observe': return { obs: ENV.observeBelief(need(msg, 'belief'), cfg.groups) };
    case 'mask': return { mask: ACTIONS.maskBelief(need(msg, 'belief'), cfg.catalogue) };
    case 'observe_mask': {
      var b = need(msg, 'belief');
      return { obs: ENV.observeBelief(b, cfg.groups), mask: ACTIONS.maskBelief(b, cfg.catalogue) };
    }
    case 'step': {
      var bel = need(msg, 'belief'), act = msg.act, idx = msg.index != null ? +msg.index : -1;
      if (idx >= 0) act = cfg.catalogue[idx];
      if (!act) throw new Error('Action hors catalogue.');
      var brique = ACTIONS.toProgramStep(act, bel);
      return { index: idx, act: act, brique: brique, reelle: brique ? ACTIONS.realStep(brique, bel.team) : null };
    }
    case 'reference': return { programme: ENGINE.PROGRAMME_REFERENCE };
    case 'mirror_ids': return { ids: need(msg, 'ids').map(function (id) { return ENGINE.mirrorId(id); }) };
    case 'sim_reset': return simReset(msg);
    case 'sim_step': return simStep(msg);
    case 'track_start': return trackStart(msg);
    case 'track_exec': return trackExec(msg);
    case 'track_belief': if (!track) throw new Error('track_start d\'abord.'); return { belief: ENV.beliefFromSim(track.sim, track.mem, msg.adversaire || null) };
    case 'close': return { ok: true, bye: true };
  }
  throw new Error('Commande inconnue : ' + msg.cmd);
}

var rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', function (line) {
  line = line.trim();
  if (!line) return;
  var msg, out;
  try { msg = JSON.parse(line); } catch (e) { return reply({ error: 'JSON illisible.' }); }
  try { out = handle(msg); } catch (e) { out = { error: e.message }; }
  if (msg && msg.rid != null && out && typeof out === 'object') out.rid = msg.rid;
  reply(out);
  if (out && out.bye) process.exit(0);
});
rl.on('close', function () { process.exit(0); });
