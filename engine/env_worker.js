#!/usr/bin/env node
/* Processus Node de l'environnement d'apprentissage (moteur JS de référence).

   Protocole : JSON-lignes sur stdin -> stdout. Une requête = un objet JSON sur une ligne avec un champ « cmd ».
   Chaque requête reçoit exactement une réponse (un objet JSON sur une ligne), dans l'ordre des requêtes.
   Si la requête porte un champ « rid », il est recopié tel quel dans la réponse (corrélation côté Python).
   Une commande qui échoue répond { error: '...' } et le processus continue. Rien d'autre n'est écrit sur stdout
   (les traces vont sur stderr).

   ── Commandes historiques (un environnement « courant », utilisées par l'évolution, l'API et les outils) ──
   ping                                  -> { ok, moteur, bareme }
   create   { config }                   -> { ok, nInputs, nOutputs }
   reset    { scenario }                 -> état (voir ci-dessous)
   step     { action }                   -> état
   score                                 -> { score, detail, T, errors, program }
   program                               -> { program }
   imitate  { config?, program, scenario } -> résultat de ENV.imitate : { pairs: [{ obs, action, mask }], score, detail, T, n }
   qualify  { strategy | program, params } -> { ok, score, errors, T }
   example                               -> { program: ENV.EXAMPLE }
   play     { layers, acts, scenario }   -> match complet joué par un MLP : { score, detail, T, errors, program, done, adversaire? }
   close                                 -> { ok }

   ── Commandes groupées (plusieurs environnements par processus, utilisées par trainer/js_env_pool.py) ──
   create_batch  { config, n, maxDecisions? }
       Crée n environnements identiques (ENV.create(config)).
       -> { ok, n, nInputs, nOutputs, catalogue, groups, obsVersion, catalogueVersion, moteur, bareme, maxDecisions }
       obsVersion / catalogueVersion : ENV.OBS_VERSION / ACTIONS.CATALOGUE_VERSION s'ils existent, sinon une empreinte
       « empreinte:<16 hex> » = sha256(JSON.stringify(...)) des groupes d'observation (id, n, desc) ou du catalogue.
   set_opponents { opponents: { <id>: { program, params } | { brain } } }
       Enregistre des adversaires une fois pour toutes ; un scénario les désigne par « opponentRef ».  -> { ok, n }
   reset_batch   { scenarios: [scénario|null] x n }  ou  { ids: [i...], scenarios: [scénario...] }
       Remet à zéro les environnements désignés (null = ne pas toucher). -> { results: [état|null] }
   step_batch    { actions: [index|null] x n, next?: [scénario|null] x n }
       Joue une action dans chaque environnement (null = environnement au repos, réponse null).
       Si l'épisode se termine et que next[i] est fourni, l'environnement est remis à zéro avec ce scénario
       (auto-reset) : obs/mask sont alors ceux du nouvel épisode et « reset » vaut true.
       -> { results: [résultat|null] }
   score_batch   { ids? }  -> { results: [bilan] }  (bilan de l'épisode en cours ou terminé de chaque environnement)
   imitate_trace { config?, program, scenario }
       Rejoue un programme comme ENV.imitate et ajoute, pour chaque paire, la récompense (différence de score
       jusqu'à la décision suivante) et l'instant de décision. -> { pairs: [{ obs, action, mask, reward, t }],
       score0, score, T, n, errors, detail }

   adversaires                           -> { robots: [{ id, nom, type, esquisse, modele: bool }] } (robots adverses, contrat §14)
   physique                              -> { caracteristiques: [{ id, nom, unite, nominal, statut, source, plageDefaut }] }
   Robots adverses « réseau » : modèles figés lus au démarrage dans .data/adversaires/<id>.json (ou ICAMLOT_ADVERSAIRES=<dossier>).

   Scénario : { seed?, intensite?, params?, physique?, opponent?: { program, params } | { brain } | { robot: id, fixe? }, opponentRef?: <id> }
   (opponentRef est accepté par toutes les commandes qui prennent un scénario : reset, imitate, play, *_batch).

   État (reset, step) : { obs: number[], mask: (0|1)[], t, score, reward, done, err } (contrat §4 de docs/CONTRATS.md).
   Résultat de step_batch : état + { dt, crash?, truncated?, reset?, final? } où
     final (présent quand l'épisode vient de se terminer) = bilan de l'épisode :
     { score, detail, T, errors, decisions, invalid, crash, truncated, adversaire: { score, errors } | null }
     score = SCORE.scoreAt(result, params, min(T, 100)) ; errors = erreurs moteur du robot.
   crash : ENV.step a levé une exception (l'environnement est considéré terminé, message dans err).
   truncated : l'épisode a atteint maxDecisions décisions sans finir (garde-fou : 300 par défaut, comme ENV.play).
*/
var path = require('path');
var crypto = require('crypto');
var readline = require('readline');
var loadIcamlot = require('./load.js').loadIcamlot;
var rootDir = path.resolve(__dirname, '..');
var ctx = loadIcamlot(rootDir);
var env = null;
/* modèles figés des adversaires « réseau » (champion, intermédiaire) */
function chargerAdversaires() {
  var fs = require('fs');
  var dir = process.env.ICAMLOT_ADVERSAIRES || path.join(rootDir, '.data', 'adversaires');
  ctx.ADVERSAIRES.IDS.forEach(function (id) {
    var pr = ctx.ADVERSAIRES.PROFILS[id], f = pr.modele ? path.join(dir, pr.modele + '.json') : null;
    if (!f || !fs.existsSync(f)) return;
    try { ctx.ADVERSAIRES.enregistrerModele(pr.modele, JSON.parse(fs.readFileSync(f, 'utf8'))); }
    catch (e) { process.stderr.write('Adversaire ' + id + ' : modèle illisible (' + e.message + ')\n'); }
  });
}
chargerAdversaires();

/* Nombre maximal de décisions par épisode en mode groupé (hypothèse reprise de ENV.play : max = 80). */
var DEFAULT_MAX_DECISIONS = 300;  /* garde-fou ; 80 tronquait les réseaux qui attendent par pas de 1 s (catalogue 3.1), même borne que ENV.play */

function reply(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function make(cfg) {
  env = ctx.ENV.create(cfg || {});
  return { ok: true, nInputs: env.nInputs, nOutputs: env.nOutputs };
}

function finalScore(R) {
  return ctx.SCORE.scoreAt(R, R.params, Math.min(R.T, ctx.ENV.MATCH));
}

/* ───────────── environnements groupés ───────────── */
var batch = [];          /* [{ env, last, decisions, invalid, done, crash, truncated, final }] */
var batchCfg = null;
var maxDecisions = DEFAULT_MAX_DECISIONS;
var opponents = {};

function sha16(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

function versions(e) {
  var groupsDesc = (e.groups || []).map(function (id) {
    var g = (ctx.ENV.GROUPS || []).filter(function (x) { return x.id === id; })[0];
    var v = g && g.vars && g.vars[0];
    return { id: id, n: v ? v.n : null, desc: v ? v.desc : null };
  });
  var obsV = ctx.ENV.OBS_VERSION ? String(ctx.ENV.OBS_VERSION) : 'empreinte:' + sha16(groupsDesc);
  var catV = ctx.ACTIONS.CATALOGUE_VERSION ? String(ctx.ACTIONS.CATALOGUE_VERSION) : 'empreinte:' + sha16(e.catalogue);
  return { obsVersion: obsV, catalogueVersion: catV };
}

function resolveScenario(sc) {
  if (!sc) return {};
  var out = {};
  Object.keys(sc).forEach(function (k) { if (k !== 'opponentRef') out[k] = sc[k]; });
  if (sc.opponentRef != null) {
    var spec = opponents[sc.opponentRef];
    if (!spec) throw new Error('Adversaire inconnu : ' + sc.opponentRef);
    out.opponent = spec;
  }
  return out;
}

function slot(i) {
  var s = batch[i];
  if (!s) throw new Error('Environnement ' + i + ' inexistant (create_batch d\'abord).');
  return s;
}

function bilan(s) {
  var R = s.env.result();
  if (!R) return null;
  var sc = finalScore(R);
  var out = {
    score: sc.total, detail: sc.detail, T: R.T, errors: (R.errors || []).length,
    decisions: s.decisions, invalid: s.invalid, crash: !!s.crash, truncated: !!s.truncated, adversaire: null
  };
  if (R.opponent) {
    var so = finalScore(R.opponent);
    out.adversaire = { score: so.total, errors: (R.opponent.errors || []).length };
  }
  if (s.env.physique) out.physique = s.env.physique();
  return out;
}

function resetSlot(i, scenario) {
  var s = slot(i);
  var st = s.env.reset(resolveScenario(scenario));
  s.last = st; s.decisions = 0; s.invalid = 0; s.done = false; s.crash = false; s.truncated = false; s.final = null;
  return { obs: st.obs, mask: st.mask, t: st.t, score: st.score, reward: 0, done: !!st.done, err: null };
}

function stepSlot(i, action, next) {
  var s = slot(i);
  if (s.done) return { error: 'Épisode terminé : reset_batch d\'abord (environnement ' + i + ').' };
  var st, out;
  try {
    st = s.env.step(action);
    s.decisions++;
    if (st.err === 'Action invalide.' || st.err === 'Action hors catalogue.') s.invalid++;
    out = { obs: st.obs, mask: st.mask, t: st.t, score: st.score, reward: st.reward || 0, done: !!st.done, err: st.err || null, dt: st.dt || 0 };
    s.last = st;
  } catch (e) {
    s.decisions++;
    s.crash = true;
    out = { obs: s.last ? s.last.obs : [], mask: s.last ? s.last.mask : [], t: s.last ? s.last.t : 0, score: s.last ? s.last.score : 0,
            reward: 0, done: true, err: 'Exception moteur : ' + e.message, dt: 0, crash: true };
  }
  if (!out.done && s.decisions >= maxDecisions) { out.done = true; out.truncated = true; s.truncated = true; }
  if (out.done) {
    s.done = true;
    try { s.final = bilan(s); } catch (e2) { s.final = { score: out.score, errors: null, crash: true, truncated: !!s.truncated, decisions: s.decisions, invalid: s.invalid, adversaire: null, bilanErreur: e2.message }; }
    s.final.crash = !!s.crash;
    out.final = s.final;
    if (next) {
      var r = resetSlot(i, next);
      out.obs = r.obs; out.mask = r.mask; out.t = r.t; out.score = r.score; out.reset = true;
    }
  }
  return out;
}

/* Rejoue un programme comme ENV.imitate en traçant le score après chaque brique du robot jaune.
   ENV.imitate n'expose pas les récompenses : on enveloppe ENGINE.makeDuel (exec du jaune) et ACTIONS.indexOfStep
   le temps de l'appel (Node est mono-fil : rien d'autre ne tourne pendant ce temps). */
function imitateTrace(e, program, scenario) {
  var ENGINE = ctx.ENGINE, ACTIONS = ctx.ACTIONS, SCORE = ctx.SCORE, MATCH = ctx.ENV.MATCH;
  var origDuel = ENGINE.makeDuel, origIdx = ACTIONS.indexOfStep;
  var execs = [], lastIdx = null, sim = null;
  function scoreNow() { return SCORE.scoreAt(sim.result(false), sim.params(), Math.min(sim.time(), MATCH)).total; }
  ENGINE.makeDuel = function () {
    var d = origDuel.apply(this, arguments), ex = d.exec;
    sim = d.sims.yellow;
    d.exec = function (team, brick) {
      if (team !== 'yellow') return ex.apply(d, arguments);
      var rec = { pair: lastIdx != null && lastIdx >= 0, t0: sim.time(), s0: scoreNow() };
      lastIdx = null;
      var info = ex.apply(d, arguments);
      rec.s1 = scoreNow();
      execs.push(rec);
      return info;
    };
    return d;
  };
  ACTIONS.indexOfStep = function () { var r = origIdx.apply(this, arguments); lastIdx = r; return r; };
  var im;
  try {
    im = e.imitate(program || [], scenario || { intensite: 'aucun' });
  } finally {
    ENGINE.makeDuel = origDuel;
    ACTIONS.indexOfStep = origIdx;
  }
  var R = e.result();
  var score = finalScore(R).total;
  var pairExecs = execs.filter(function (x) { return x.pair; });
  var pairs = im.pairs || [];
  if (pairExecs.length !== pairs.length) throw new Error('Traçage incohérent : ' + pairExecs.length + ' briques pour ' + pairs.length + ' paires.');
  var score0 = pairExecs.length ? pairExecs[0].s0 : score;
  pairs.forEach(function (p, k) {
    var sNext = k + 1 < pairExecs.length ? pairExecs[k + 1].s0 : score;
    p.reward = sNext - pairExecs[k].s0;
    p.t = pairExecs[k].t0;
  });
  return { pairs: pairs, score0: score0, score: score, detail: finalScore(R).detail, T: R.T, n: pairs.length, errors: (R.errors || []).length };
}

function handle(msg) {
  var cmd = msg.cmd;
  if (cmd === 'ping') return { ok: true, moteur: ctx.ENGINE.VERSION, bareme: ctx.BAREME_VERSION };
  if (cmd === 'create') return make(msg.config || {});
  if (cmd === 'reset') {
    if (!env) make(msg.config || {});
    return env.reset(resolveScenario(msg.scenario || {}));
  }
  if (cmd === 'step') {
    if (!env) return { error: 'Appelle reset d\'abord.' };
    return env.step(msg.action);
  }
  if (cmd === 'score') {
    if (!env) return { error: 'Pas d\'environnement.' };
    var R0 = env.result();
    var sc0 = finalScore(R0);
    return { score: sc0.total, detail: sc0.detail, T: R0.T, errors: R0.errors.length, program: env.program() };
  }
  if (cmd === 'program') return { program: env ? env.program() : [] };
  if (cmd === 'imitate') {
    if (!env || msg.config) make(msg.config || {});
    return env.imitate(msg.program || [], resolveScenario(msg.scenario || {}));
  }
  if (cmd === 'qualify') return ctx.ENV.qualify(msg.strategy || { program: msg.program }, msg.params);
  if (cmd === 'example') return { program: ctx.ENV.EXAMPLE };
  if (cmd === 'play') {
    if (!env) make(msg.config || {});
    var choose = ctx.ENV.chooserFromLayers(msg.layers, msg.acts || []);
    var st = env.play(choose, resolveScenario(msg.scenario || {}));
    var R = env.result();
    var sc = finalScore(R);
    var out = { score: sc.total, detail: sc.detail, T: R.T, errors: R.errors.length, program: env.program(), done: st.done };
    if (R.opponent) {
      var so = finalScore(R.opponent);
      out.adversaire = { score: so.total, detail: so.detail, T: R.opponent.T, errors: R.opponent.errors.length, program: env.opponentProgram() };
      out.contacts = R.collisions.length;
    }
    return out;
  }
  if (cmd === 'close') { env = null; batch = []; return { ok: true }; }
  if (cmd === 'physique') {
    return { caracteristiques: ctx.ADVERSAIRES.PHYSIQUE.map(function (d) { return { id: d.id, nom: d.nom, unite: d.unite, nominal: d.nominal, statut: d.statut, source: d.source, plageDefaut: d.plageDefaut }; }) };
  }
  if (cmd === 'adversaire_cfg') {
    /* réglages d'entraînement d'un robot adverse « réseau » : tirage physique et programme de démonstration */
    var prA = ctx.ADVERSAIRES.PROFILS[msg.robot];
    if (!prA || prA.type !== 'reseau') return { error: 'Robot adverse « réseau » inconnu : ' + msg.robot };
    return { robot: msg.robot, profil: prA, physique: ctx.ADVERSAIRES.reglagesPhysiques(msg.robot), demonstration: ctx.ADVERSAIRES.programmeDemo(msg.robot) };
  }
  if (cmd === 'adversaires') {
    return { robots: ctx.ADVERSAIRES.IDS.map(function (id) { var p = ctx.ADVERSAIRES.PROFILS[id]; return { id: id, nom: p.nom, type: p.type, esquisse: p.esquisse, modele: p.type === 'regles' || !!ctx.ADVERSAIRES.modele(p.modele) }; }) };
  }

  /* ── commandes groupées ── */
  if (cmd === 'create_batch') {
    var n = Math.max(1, parseInt(msg.n, 10) || 1);
    batchCfg = msg.config || {};
    maxDecisions = Math.max(1, parseInt(msg.maxDecisions, 10) || DEFAULT_MAX_DECISIONS);
    batch = [];
    for (var i = 0; i < n; i++) batch.push({ env: ctx.ENV.create(batchCfg), last: null, decisions: 0, invalid: 0, done: true, crash: false, truncated: false, final: null });
    var e0 = batch[0].env, v = versions(e0);
    return {
      ok: true, n: n, nInputs: e0.nInputs, nOutputs: e0.nOutputs, catalogue: e0.catalogue, groups: e0.groups,
      obsVersion: v.obsVersion, catalogueVersion: v.catalogueVersion,
      moteur: ctx.ENGINE.VERSION, bareme: ctx.BAREME_VERSION, maxDecisions: maxDecisions
    };
  }
  if (cmd === 'set_opponents') {
    opponents = msg.opponents || {};
    return { ok: true, n: Object.keys(opponents).length };
  }
  if (cmd === 'reset_batch') {
    var ids = msg.ids || batch.map(function (_, k) { return k; });
    var scs = msg.scenarios || [];
    var res = batch.map(function () { return null; });
    ids.forEach(function (id, k) {
      var sc1 = msg.ids ? scs[k] : scs[id];
      if (msg.ids || sc1 !== null) res[id] = resetSlot(id, sc1 || {});
    });
    return { results: res };
  }
  if (cmd === 'step_batch') {
    var acts = msg.actions || [], nexts = msg.next || [];
    return {
      results: batch.map(function (_, k) {
        if (acts[k] == null) return null;
        return stepSlot(k, acts[k], nexts[k] || null);
      })
    };
  }
  if (cmd === 'score_batch') {
    var ids2 = msg.ids || batch.map(function (_, k) { return k; });
    return { results: ids2.map(function (id) { var s = slot(id); return s.done && s.final ? s.final : bilan(s); }) };
  }
  if (cmd === 'imitate_trace') {
    /* environnement neuf : les environnements groupés ne sont pas touchés */
    var e = ctx.ENV.create(msg.config || batchCfg || {});
    return imitateTrace(e, msg.program || [], resolveScenario(msg.scenario || { intensite: 'aucun' }));
  }
  return { error: 'Commande inconnue : ' + cmd };
}

var rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', function (line) {
  line = line.trim();
  if (!line) return;
  var msg;
  try { msg = JSON.parse(line); } catch (e) { return reply({ error: 'JSON illisible.' }); }
  var out;
  try {
    out = handle(msg);
  } catch (e) {
    out = { error: 'Erreur interne : ' + e.message };
  }
  if (msg && msg.rid != null && out && typeof out === 'object') out.rid = msg.rid;
  reply(out);
});
rl.on('close', function () { process.exit(0); });
