#!/usr/bin/env node
/* Mesures de symétrie jaune / bleu (chantier symétrie, contrat §15). Indépendant des conventions du moteur : le « miroir
   physique » d'une situation jaune est défini ici une fois pour toutes.

   Miroir physique : le robot n'est pas symétrique (faces A, B, C à h, h + 120, h + 240 ; spec/robot.json). Le miroir de la table
   (x -> 3000 - x) change l'ordre cyclique (A, B, C) en (A, C, B) ; le vrai robot bleu qui reproduit au mieux la situation jaune
   est donc celui dont la face B joue le rôle de la face A jaune : cap réel h' = 180 - (h + 120) = 60 - h (normale de A),
   pinces A et B échangées, face C inchangée (seule sa disposition interne reste en miroir : canon et ascenseur).

   node tests/mesure_symetrie.js [--etats 200] [--reference] [--modele fichier.json] [--matchs 8] [--adversaires batisseur,razzia]
     --etats N     : N croyances tirées d'épisodes aléatoires (jaune, avec et sans adversaire) ; obs(jaune) == obs(miroir bleu)
                     hors bit d'équipe, masque identique
     --reference   : programme de référence traduit en actions du catalogue (ENV.imitate), rejoué en jaune et en bleu, seul
     --modele F    : modèle (JSON web icamlot-modele-recurrent) joué en jaune et en bleu, seul et contre les robots à règles
     --matchs N    : graines 1000 .. 1000 + N - 1 pour --modele */
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var ctx = require('../engine/load.js').loadIcamlot(ROOT);
var ENGINE = ctx.ENGINE, ENV = ctx.ENV, SCORE = ctx.SCORE, ACTIONS = ctx.ACTIONS, ADV = ctx.ADVERSAIRES || globalThis.ADVERSAIRES;

var argv = process.argv.slice(2);
function opt(name, def) { var i = argv.indexOf('--' + name); if (i < 0) return def; var v = argv[i + 1]; return v == null || v.slice(0, 2) === '--' ? true : v; }
var N_ETATS = +opt('etats', 0), REF = !!opt('reference', false), MODELE = opt('modele', null), N_MATCHS = +opt('matchs', 8);
var ADVS = String(opt('adversaires', 'batisseur,razzia')).split(',').filter(Boolean);

function rng(s) { var a = s >>> 0 || 1; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
function sd(a) { var m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (a.length - 1)) : 0; }
function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }

/* ------------------------------------------------------------------ miroir physique d'une croyance */
var SWAP = { A: 'B', B: 'A' };
function capPhys(h) { return 60 - h; }
function mid(id) { if (!id) return id; var s = String(id); return s.indexOf('.') >= 0 ? ENGINE.mirrorId(s.split('.')[0]) + '.' + s.split('.')[1] : ENGINE.mirrorId(s); }
function mirFoot(F) { return F.map(function (v) { return [3000 - v[0], v[1]]; }); }
/* angle de nacelle : le miroir change u (droite vue de face) en -u, donc rot en -rot ; 0 et 180 sont leur propre miroir (-180 est
   hors de la plage [-90, 180] de la spec) ; tour et porte : 90° par défaut */
function rotPhys(r) { return r == null ? r : +r === 180 || +r === 0 ? +r : -r; }
function mirrorBrick(st) {
  var o = JSON.parse(JSON.stringify(st));
  if (o.f && SWAP[o.f]) o.f = SWAP[o.f];
  if (o.p) o.p = ENGINE.mirrorId(o.p);
  if (o.z) o.z = ENGINE.mirrorId(o.z);
  if (o.s) o.s = mid(o.s);
  if (o.a === 'deposer') { if (o.x != null) o.x = 3000 - o.x; if (o.ang != null) o.ang = 180 - o.ang; }
  if (o.a === 'traj' && o.pts) o.pts = o.pts.map(function (q) { var r = Object.assign({}, q); if (q.x != null) r.x = 3000 - q.x; if (q.a != null && q.a !== '') r.a = capPhys(q.a); return r; });
  if (o.a === 'tourner' && o.r != null) o.r = rotPhys(o.r);
  if (o.a === 'deposer' && (o.r != null || o.o === 'debout')) o.r = rotPhys(o.r != null ? o.r : 90);
  if (o.a === 'tour' || o.a === 'porte') o.r = rotPhys(o.r != null ? o.r : 90);
  return o;
}
function mirrorBelief(b) {
  var m = JSON.parse(JSON.stringify(b));
  m.team = b.team === 'blue' ? 'yellow' : 'blue';
  m.pose = { x: 3000 - b.pose.x, y: b.pose.y, h: capPhys(b.pose.h) };
  m.pinces = {};
  ['A', 'B'].forEach(function (f) { var g = JSON.parse(JSON.stringify(b.pinces[f])); g.slots = (g.slots || [null, null, null]).map(function (id) { return id ? mid(id) : null; }); g.rot = rotPhys(g.rot); g.rotReelle = rotPhys(g.rotReelle); m.pinces[SWAP[f]] = g; });

  if (b.adversaire) { m.adversaire.x = 3000 - b.adversaire.x; m.adversaire.vx = -(b.adversaire.vx || 0); }
  var ids = ENGINE.PK.map(function (p) { return p.id; });
  m.pierres = (b.pierres || []).map(function (s) { var o = JSON.parse(JSON.stringify(s)); o.id = mid(s.id); o.pk = ids.indexOf(ENGINE.mirrorId(ENGINE.PK[s.pk].id)); o.foot = mirFoot(s.foot); return o; });
  m.portes = (b.portes || []).map(mid);
  m.etrangeres = (b.etrangeres || []).map(function (s) { var o = JSON.parse(JSON.stringify(s)); o.foot = mirFoot(s.foot); return o; });
  m.paquets = {}; Object.keys(b.paquets).forEach(function (k) { m.paquets[ENGINE.mirrorId(k)] = b.paquets[k]; });
  m.params.gx = 3000 - b.params.gx; m.params.ga = 180 - (b.params.ga || 0);
  if (b.echecs) m.echecs = { t: b.echecs.t, briques: (b.echecs.briques || []).map(mirrorBrick) };
  return m;
}

/* ------------------------------------------------------------------ 1. obs et masque sur N croyances tirées */
function teamBitIndex() { var g = ENV.DEFAULT_GROUPS, k = 0; for (var i = 0; i < g.length; i++) { if (g[i] === 'robot') return k + 6; k += ENV.nInputs([g[i]]); } return -1; }
function mesureEtats(N) {
  var cat = ACTIONS.ALL, TB = teamBitIndex(), states = [], seed = 1;
  while (states.length < N) {
    var env = ENV.create({ skipContacts: true }), r = rng(seed), st = env.reset({ seed: seed, intensite: seed % 2 ? 'realiste' : 'aucun' }), k = 0;
    seed++;
    while (!st.done && k < 40 && states.length < N) {
      states.push(env.belief());
      var v = []; st.mask.forEach(function (m, i) { if (m) v.push(i); });
      var idx = v[Math.floor(r() * v.length)];
      if (cat[idx].a === 'finir' && r() < 0.95) idx = v[Math.floor(r() * v.length)];
      st = env.step(idx); k++;
    }
  }
  var sep = { n90: { etats: 0, diff: 0 }, nAutre: { etats: 0, diff: 0 } };
  var obsOk = 0, maskOk = 0, tenues = 0, diffIdx = {}, diffFam = {}, nDiffAct = 0, nAct = 0, exemples = [], t0 = Date.now();
  states.forEach(function (bY, n) {
    var bB = mirrorBelief(bY), oY = ENV.observeBelief(bY), oB = ENV.observeBelief(bB);
    if (['A', 'B'].some(function (f) { return (bY.pinces[f].slots || []).some(Boolean); })) tenues++;
    var d = []; oY.forEach(function (v, i) { if (i !== TB && Math.abs(v - oB[i]) > 1e-9) d.push(i); });
    if (!d.length && Math.abs(oY[TB] - oB[TB]) > 0.5) obsOk++;
    d.forEach(function (i) { diffIdx[i] = (diffIdx[i] || 0) + 1; if (process.env.DEBUG_OBS) console.log('   obs[' + i + '] ' + oY[i] + ' / ' + oB[i] + ' pose ' + JSON.stringify(bY.pose)); });
    var mY = ACTIONS.maskBelief(bY), mB = ACTIONS.maskBelief(bB), same = true;
    mY.forEach(function (v, i) {
      nAct++;
      if (v !== mB[i]) {
        same = false; nDiffAct++; diffFam[cat[i].famille] = (diffFam[cat[i].famille] || 0) + 1;
        if (exemples.length < 12) { var eY = ACTIONS.explainBelief(bY)[i], eB = ACTIONS.explainBelief(bB)[i]; exemples.push('état ' + n + ' t=' + f1(bY.t) + ' « ' + cat[i].label + ' » jaune: ' + (eY || 'valide') + ' | bleu: ' + (eB || 'valide')); }
      }
    });
    if (same) maskOk++;
    /* répartition : nacelle à 90° (pierres décalées latéralement, chiralité des nacelles) ou non */
    var a90 = ['A', 'B'].some(function (f) { var g = bY.pinces[f]; return Math.abs(Math.abs(g.rot) - 90) < 0.5 || (g.rotReelle != null && Math.abs(Math.abs(g.rotReelle) - 90) < 0.5); });
    var dN = mY.filter(function (v, i) { return v !== mB[i]; }).length;
    sep[a90 ? 'n90' : 'nAutre'].etats++; sep[a90 ? 'n90' : 'nAutre'].diff += dN;
  });
  console.log('\n1. Miroir physique sur ' + N + ' croyances (' + tenues + ' avec pierres tenues), ' + f1((Date.now() - t0) / 1000) + ' s');
  console.log('   obs(jaune) == obs(bleu miroir) hors bit d\'équipe : ' + obsOk + ' / ' + N);
  console.log('   indices d\'observation différents (nombre d\'états) : ' + JSON.stringify(diffIdx));
  console.log('   masque identique : ' + maskOk + ' / ' + N + ' ; actions différentes : ' + nDiffAct + ' / ' + nAct + ' ' + JSON.stringify(diffFam));
  console.log('   actions différentes, états avec une nacelle à ±90° : ' + sep.n90.diff + ' sur ' + sep.n90.etats + ' états ; autres états : ' + sep.nAutre.diff + ' sur ' + sep.nAutre.etats + ' états');
  exemples.forEach(function (e) { console.log('     ' + e); });
  return { obsOk: obsOk, maskOk: maskOk, N: N, nDiffAct: nDiffAct, nAct: nAct };
}

/* ------------------------------------------------------------------ match d'un cerveau, jaune ou bleu, seul ou contre un robot à règles */
function jouer(team, brain, seed, robot, params) {
  var other = team === 'blue' ? 'yellow' : 'blue';
  var P0 = Object.assign({}, ENGINE.DEF, params || {}, { seed: seed });
  var Pt = team === 'blue' ? ENGINE.blueParams(P0) : Object.assign({}, P0, { team: 'yellow' });
  var tk = { us: {}, them: {} }, them = null, rule = robot ? ADV.preparerRegles(robot, seed) : null;
  var us = ENGINE.makeSim(Object.assign({}, Pt, { oppTaken: tk.them }), {
    skipContacts: true,
    oppPoseAt: rule ? function (tt) { return them.poseAtT(tt); } : null,
    foreignFeet: rule ? function () { return them.freeFeet(); } : null
  });
  if (rule) them = rule.make({ team: other, skipContacts: true, oppTaken: tk.us, oppPoseAt: function (tt) { return us.poseAtT(tt); }, oppRadius: function () { return us.hullRadius(); }, foreignFeet: function () { return us.freeFeet(); } });
  var agent = ENV.brainAgent(brain), done = { us: false, them: !rule }, guard = 0;
  while ((!done.us || !done.them) && guard++ < 5000) {
    var who = done.us ? 'them' : done.them ? 'us' : (them.time() < us.time() || (them.time() === us.time() && other === 'yellow') ? 'them' : 'us');
    if (who === 'us') { var b = agent.next(us, them); if (b == null) { done.us = true; continue; } us.exec(b); us.leftHome(tk.us); }
    else { var c = rule.agent.next(them, us); if (c == null) { done.them = true; continue; } them.exec(c); them.leftHome(tk.them); }
  }
  var R = us.finish(), sc = SCORE.scoreAt(R, R.params, ENV.MATCH).total;
  var Ro = rule ? them.finish() : null, so = Ro ? SCORE.scoreAt(Ro, Ro.params, ENV.MATCH).total : null;
  return { score: sc, errors: R.errors.length, errs: R.errors.map(function (e) { return e.msg; }), opp: so, program: agent.program() };
}

/* ------------------------------------------------------------------ 2. programme de référence -> actions du catalogue -> jaune / bleu */
function mesureReference() {
  var env = ENV.create({ skipContacts: true }), im = env.imitate(ENGINE.PROGRAMME_REFERENCE, { intensite: 'aucun' });
  var seq = im.pairs.map(function (p) { return p.action; }), iFin = ACTIONS.ALL.map(function (a) { return a.a; }).indexOf('finir');
  console.log('\n2. Programme de référence -> ' + seq.length + ' actions du catalogue (imitation jaune : ' + im.score + ' pts, ' + im.errors + ' erreur(s))');
  ['yellow', 'blue'].forEach(function (team) {
    var k = 0, invalides = [];
    /* une action masquée est sautée (comptée), la suivante est jouée */
    var brain = { choose: function (obs, mask) { while (k < seq.length && !mask[seq[k]]) { invalides.push(k + ':' + ACTIONS.ALL[seq[k]].label); k++; } var i = k < seq.length ? seq[k] : iFin; k++; return i; } };
    var r = jouer(team, brain, 0, null, null);
    /* même programme, briques exécutées sans masque (ENGINE.mirrorStep en bleu) */
    var Pm = Object.assign({}, ENGINE.DEF, { seed: 0 }), simM = ENGINE.makeSim(team === 'blue' ? ENGINE.blueParams(Pm) : Pm, { skipContacts: true });
    ENGINE.PROGRAMME_REFERENCE.forEach(function (st) { simM.exec(team === 'blue' ? ENGINE.mirrorStep(st) : st); });
    var RM = simM.finish();
    console.log('   ' + (team === 'blue' ? 'bleu ' : 'jaune') + ' seul, briques du programme sans masque : ' + SCORE.scoreAt(RM, RM.params, ENV.MATCH).total + ' pts, ' + RM.errors.length + ' erreur(s)' + (RM.errors.length ? ' ' + JSON.stringify(RM.errors.slice(0, 3).map(function (e) { return e.msg; })) : ''));
    console.log('   ' + (team === 'blue' ? 'bleu ' : 'jaune') + ' seul : ' + r.score + ' pts, ' + r.errors + ' erreur(s), ' + invalides.length + ' action(s) masquée(s) sautée(s)' + (invalides.length ? ' ' + JSON.stringify(invalides.slice(0, 6)) : '') + (r.errs.length ? ' ' + JSON.stringify(r.errs.slice(0, 3)) : ''));
  });
}

/* ------------------------------------------------------------------ 3. modèle entraîné : jaune / bleu, seul / contre robots à règles */
function mesureModele(file) {
  var brain = JSON.parse(require('fs').readFileSync(file, 'utf8'));
  console.log('\n3. Modèle ' + file + ' (' + N_MATCHS + ' matchs par cas, graines 1000..' + (1000 + N_MATCHS - 1) + ')');
  console.log('   | adversaire | jaune : nous · adv · err | bleu : nous · adv · err |');
  [null].concat(ADVS).forEach(function (robot) {
    var row = {};
    ['yellow', 'blue'].forEach(function (team) {
      var s = [], o = [], e = 0;
      for (var i = 0; i < N_MATCHS; i++) { var r = jouer(team, brain, 1000 + i, robot, null); s.push(r.score); if (r.opp != null) o.push(r.opp); e += r.errors; }
      row[team] = f1(mean(s)) + ' ± ' + f1(sd(s)) + ' · ' + (o.length ? f1(mean(o)) : '—') + ' · ' + e;
    });
    console.log('   | ' + (robot || 'seul') + ' | ' + row.yellow + ' | ' + row.blue + ' |');
  });
}

/* ------------------------------------------------------------------ 4. cohérence masque -> moteur, jaune et bleu, seul
   (même runner pour les deux équipes : croyance, masque, action aléatoire valide, brique exécutée par le moteur de l'équipe) */
var PATH = /aucun passage|aucune position|Aucune position|pas de place|pas de position|décalée|contact avec|bloqué|tomber|bascul|tenue à .* hors du château|Graal sorti/;
function coherence(team, N, seed) {
  var r = rng(seed), cat = ACTIONS.ALL, o = { dec: 0, fail: 0, path: 0, other: {}, eps: 0, t: Date.now() }, iFin = cat.map(function (a) { return a.a; }).indexOf('finir');
  while (o.dec < N) {
    var P = Object.assign({}, ENGINE.DEF, { seed: seed * 1000 + o.eps }), sim = ENGINE.makeSim(team === 'blue' ? ENGINE.blueParams(P) : P, { skipContacts: true }), mem = ENV.newMemory(), kk = 0; o.eps++;
    ENV.updateMemory(mem, sim, 0, 0, null, null);
    while (sim.time() < ENV.MATCH - 0.05 && kk < 80 && o.dec < N) {
      var b = ENV.beliefFromSim(sim, mem, null), mask = ACTIONS.maskBelief(b, cat), v = [];
      mask.forEach(function (m, i) { if (m) v.push(i); });
      if (!v.length) break;
      var pick = v[Math.floor(r() * v.length)];
      if (pick === iFin && r() < 0.9) pick = v[Math.floor(r() * v.length)];
      var st = ACTIONS.toProgramStep(cat[pick], b), t0 = sim.time(), info = sim.exec(ACTIONS.realStep(st, team));
      ENV.updateMemory(mem, sim, t0, sim.time(), st, info); kk++; o.dec++;
      if (pick === iFin) break;
      if (!info.err) continue;
      o.fail++;
      if (process.env.DEBUG_COH) console.log('     ' + team + ' match ' + (o.eps - 1) + ' t=' + f1(t0) + ' « ' + cat[pick].label + ' » ' + JSON.stringify(st) + ' -> ' + info.err + ' | pinces ' + JSON.stringify(b.pinces) + ' graal ' + b.graal);
      if (PATH.test(info.err)) o.path++; else { var key = info.err.replace(/[0-9]+([.,][0-9]+)?/g, '#'); o.other[key] = (o.other[key] || 0) + 1; }
    }
  }
  console.log('   ' + (team === 'blue' ? 'bleu ' : 'jaune') + ' : ' + o.dec + ' décisions, ' + o.eps + ' matchs, ' + f1((Date.now() - o.t) / o.dec) + ' ms/décision ; échecs ' + o.fail + ' = ' + (100 * o.fail / o.dec).toFixed(2) + ' % (trajet/pose ' + o.path + ', autres ' + (o.fail - o.path) + ' ' + JSON.stringify(o.other) + ')');
}

console.log('Moteur ' + ENGINE.VERSION + ', catalogue ' + ACTIONS.CATALOGUE_VERSION + ', observation ' + ENV.OBS_VERSION);
var N_COH = +opt('coherence', 0);
if (N_COH > 0) { console.log('\n4. Masque -> moteur, seul (graine 11)'); coherence('yellow', N_COH, 11); coherence('blue', N_COH, 11); }
if (N_ETATS > 0) mesureEtats(N_ETATS);
if (REF) mesureReference();
if (MODELE) mesureModele(MODELE);
