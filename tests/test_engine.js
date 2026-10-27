#!/usr/bin/env node
/* Non-régression du moteur extrait + environnement pas à pas. */
var path = require('path');
var assert = require('assert');
var loadIcamlot = require('../engine/load.js').loadIcamlot;
var ctx = loadIcamlot(path.resolve(__dirname, '..'));
var ENGINE = ctx.ENGINE, ENV = ctx.ENV, SCORE = ctx.SCORE, ACTIONS = ctx.ACTIONS;

var EXAMPLE = ENV.EXAMPLE;
var fail = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  ' + name);
  else { console.log('  KO  ' + name + (detail ? ' — ' + detail : '')); fail++; }
}

console.log('Moteur ' + ENGINE.VERSION + ', barème ' + ctx.BAREME_VERSION);

console.log('\n1. Programme d\'exemple (simulate)');
var t0 = Date.now();
var R = ENGINE.simulate(EXAMPLE, ENGINE.DEF);
var ms = Date.now() - t0;
console.log('   durée simulée ' + R.T.toFixed(1) + ' s, calcul en ' + ms + ' ms, erreurs ' + R.errors.length + ', contacts ' + R.collisions.length);
check('durée ~ 91,8 s (tir attendu jusqu\'à 85 s)', Math.abs(R.T - 91.8) < 0.15, 'T=' + R.T);
check('aucune erreur', R.errors.length === 0, JSON.stringify(R.errors));
check('score calculable', SCORE.scoreAt(R, ENGINE.DEF).total >= 0);
var sc = SCORE.scoreAt(R, ENGINE.DEF);
console.log('   score ' + sc.total + ' pts', sc.detail);

console.log('\n2. Équivalence pas à pas');
var env = ENV.create({ skipContacts: false, adversaire: { intensite: 'aucun' } });
env.reset({});
EXAMPLE.forEach(function (st) {
  var cat = env.catalogue;
  var idx = -1;
  for (var i = 0; i < cat.length; i++) {
    var a = cat[i];
    if (a.a !== st.a) continue;
    if (st.f && a.f !== st.f) continue;
    if (st.p && a.p !== st.p) continue;
    if (st.z && a.z !== st.z) continue;
    if (st.side && a.side !== st.side) continue;
    if (st.a === 'tour') continue;
    idx = i; break;
  }
  if (st.a === 'tour') {
    /* le réseau désigne la pierre par son rang ; ici on joue le programme brut via makeSim */
  }
});
var sim = ENGINE.makeSim(ENGINE.DEF);
EXAMPLE.forEach(function (st) { sim.exec(st); });
var R2 = sim.finish();
check('même durée pas à pas', Math.abs(R2.T - R.T) < 1e-6, R2.T + ' vs ' + R.T);
check('mêmes erreurs', R2.errors.length === R.errors.length);
check('mêmes contacts', R2.collisions.length === R.collisions.length);
check('même score', SCORE.scoreAt(R2, ENGINE.DEF).total === sc.total);

console.log('\n3. Catalogue et masque');
check('106 actions de base + 24 nouvelles = 130 actions', ACTIONS.ALL_BASE.length === 106 && ACTIONS.ALL.length === 130);
var e0 = ENV.create();
var s0 = e0.reset({});
check('56 entrées par défaut', s0.obs.length === 56, 'n=' + s0.obs.length);
var eLegacy = ENV.create({ groups: ['temps', 'robot', 'paquets', 'faces', 'constructions', 'graal', 'boulets', 'adversaire'] });
check('37 entrées avec groupes historiques', eLegacy.reset({}).obs.length === 37);
check('130 sorties par défaut', s0.mask.length === 130);
check('masque : prises possibles au départ', s0.mask.slice(0, 20).some(function (x) { return x; }));
check('masque : mur impossible au départ', !s0.mask.slice(20, 40).some(function (x) { return x; }));
check('masque : trône toujours possible (action 105)', s0.mask[105] === 1);

console.log('\n4. Copie / restauration');
var snap = e0.snapshot();
var st1 = e0.step(0);
e0.restore(snap);
var st2 = e0.step(0);
check('même dt après restore', Math.abs(st1.dt - st2.dt) < 1e-9, st1.dt + ' vs ' + st2.dt);

console.log('\n5. Intensité « aucun » = déterministe');
var eA = ENV.create({ adversaire: { intensite: 'aucun' } });
var a1 = eA.reset({ seed: 1 });
var a2 = eA.reset({ seed: 1 });
check('reset identique', JSON.stringify(a1.obs) === JSON.stringify(a2.obs));

console.log('\n6. Imitation : paires (état, action) du programme d\'exemple');
var imEnv = ENV.create({ skipContacts: true, adversaire: { intensite: 'aucun' } });
var im = imEnv.imitate(EXAMPLE, { intensite: 'aucun' });
check('des paires collectées', im.n >= 10, 'n=' + im.n);
check('première action = prendre', im.pairs[0] && ACTIONS.ALL[im.pairs[0].action].a === 'prendre');
check('score d\'imitation = simulate', im.score === sc.total, im.score + ' vs ' + sc.total);

console.log('\n7. Masque : 130 sorties');
check('somme des familles', ACTIONS.FAMILLES.reduce(function (a, f) { return a + f.n; }, 0) === 130);

console.log('\n8. Robot adverse');
check('P1 miroir = P4', ENGINE.mirrorId('P1') === 'P4');
check('M1 miroir = M6', ENGINE.mirrorId('M1') === 'M6');
var none = ENGINE.simulateMatch(EXAMPLE, ENGINE.DEF, { opponent: { program: EXAMPLE }, intensity: 'aucun' });
check('intensité aucun = sans adversaire', !none.opponent && Math.abs(none.T - 91.8) < 0.15, 'T=' + none.T);
var both = ENGINE.simulateMatch(EXAMPLE, ENGINE.DEF, { opponent: { program: EXAMPLE, name: 'Exemple' }, intensity: 'realiste' });
check('adversaire simulé', !!both.opponent);
check('départ bleu x ≈ 2750', both.opponent && Math.abs(both.opponent.params.x0 - 2750) < 1, both.opponent && both.opponent.params.x0);
check('adversaire a pris des paquets', both.oppEvents && Object.keys(both.oppEvents.taken).length > 0, JSON.stringify(both.oppEvents && both.oppEvents.taken));
var scOpp = SCORE.scoreAt(both.opponent, both.opponent.params, Math.min(both.opponent.T, 100));
check('score adverse > 0', scOpp.total > 0, 'score=' + scOpp.total);
var q = ENV.qualify({ program: EXAMPLE });
check('exemple qualifie (≥ 70 pts, 0 erreur)', q.ok && q.score >= 70, JSON.stringify(q));
var envOpp = ENV.create({ skipContacts: true, adversaire: { intensite: 'realiste' } });
var sOpp = envOpp.reset({ opponent: { program: EXAMPLE, name: 'Exemple' }, intensite: 'realiste' });
check('lidar adverse non nul', sOpp.obs.length === 56 && (sOpp.obs[35] !== 0 || sOpp.obs[36] !== 0), sOpp.obs.slice(35, 37).join(','));

console.log('\n9. Jeu en direct (pas un programme figé)');
function firstValid(obs, mask) {
  for (var i = 0; i < mask.length; i++) if (mask[i]) return i;
  return -1;
}
function idxOf(cat, pred) {
  for (var i = 0; i < cat.length; i++) if (pred(cat[i])) return i;
  return -1;
}
var live = ENV.create({ skipContacts: true });
var seenEarlyThrone = false, seenBallsBefore80 = false;
live.play(function (obs, mask) {
  var elapsed = (1 - obs[0]) * 100, cat = live.catalogue, i, j, useful;
  for (i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    if (cat[i].a === 'trone' && elapsed < 88) {
      useful = false;
      for (j = 0; j < mask.length; j++) if (mask[j] && cat[j].a !== 'trone') useful = true;
      if (useful) seenEarlyThrone = true;
    }
    if (cat[i].a === 'boulets' && elapsed < 79.5) seenBallsBefore80 = true;
  }
  return firstValid(obs, mask);
}, {});
var Rlive = live.result();
check('match jusqu\'à au moins 100 s', Rlive.T >= 99.5, 'T=' + Rlive.T);
check('épisode terminé', live.program().length > 0);
check('trône masqué tant qu\'il reste des actions avant 88 s', !seenEarlyThrone);
check('boulets masqués avant 80 s', !seenBallsBefore80);

var zenv = ENV.create({ skipContacts: true });
zenv.reset({});
var zcat = zenv.catalogue;
zenv.step(idxOf(zcat, function (a) { return a.a === 'prendre' && a.f === 'A' && a.p === 'P1'; }));
var afterMur = zenv.step(idxOf(zcat, function (a) { return a.a === 'mur' && a.f === 'A' && a.z === 'M1' && a.side === 'ext'; }));
zenv.step(idxOf(zcat, function (a) { return a.a === 'prendre' && a.f === 'A' && a.p === 'P2'; }));
var afterTake2 = zenv.step(idxOf(zcat, function (a) { return a.a === 'prendre' && a.f === 'B' && a.p === 'P5'; }));
var m1ok = false, m2ok = false;
for (var zi = 0; zi < zcat.length; zi++) {
  if (zcat[zi].a !== 'mur' || zcat[zi].f !== 'A') continue;
  if (zcat[zi].z === 'M1' && afterTake2.mask[zi]) m1ok = true;
  if (zcat[zi].z === 'M2' && afterTake2.mask[zi]) m2ok = true;
}
check('impossible de reposer un mur sur M1', !m1ok);
check('M2 encore libre avec une pile', m2ok);

var tenv = ENV.create({ skipContacts: true });
tenv.reset({});
var tcat = tenv.catalogue;
tenv.step(idxOf(tcat, function (a) { return a.a === 'prendre' && a.f === 'A' && a.p === 'P1'; }));
var afterT0 = tenv.step(idxOf(tcat, function (a) { return a.a === 'tour' && a.f === 'A' && a.z === 'T1' && a.rank === 0; }));
var iT1 = idxOf(tcat, function (a) { return a.a === 'tour' && a.f === 'A' && a.z === 'T1' && a.rank === 1; });
check('2e pierre de la même tour impossible (tour terminée)', afterT0.mask[iT1] === 0);

var benv = ENV.create({ skipContacts: true });
benv.play(function (obs, mask) {
  var cat = benv.catalogue, i;
  for (i = 0; i < mask.length; i++) if (mask[i] && cat[i].a === 'boulets') return i;
  for (i = 0; i < mask.length; i++) if (mask[i] && cat[i].a !== 'trone') return i;
  for (i = 0; i < mask.length; i++) if (mask[i]) return i;
  return -1;
}, {});
check('les boulets peuvent être tirés en live', benv.program().some(function (s) { return s.a === 'tir'; }), JSON.stringify(benv.program().map(function (s) { return s.a; })));
check('durée au moins 100 s avec boulets', benv.result().T >= 99.5, 'T=' + benv.result().T);


console.log('\n10. Duel : deux robots sur la même table (pas de vol de pierre, pas de superposition)');
function rngOf(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) | 0; var x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; }; }
function picker(seed) { var r = rngOf(seed); return function (obs, mask) { var ok = []; for (var i = 0; i < mask.length; i++) if (mask[i]) ok.push(i); return ok.length ? ok[Math.floor(r() * ok.length)] : -1; }; }
function bothHave(R) {
  var O = R.opponent, dup = [];
  R.stones.forEach(function (st, i) {
    var a = st.cur.k, b = O.stones[i].cur.k;
    if (a !== 'home' && a !== 'gone' && b !== 'home' && b !== 'gone') dup.push(st.id);
  });
  return dup;
}
function robotOverlap(R) {
  var O = R.opponent, n = 0;
  for (var tt = 0; tt <= Math.min(R.T, O.T); tt += 0.1) if (ctx.overlap(ctx.triPoly(R.poseAt(tt)), ctx.triPoly(O.poseAt(tt)), 1)) n++;
  return n;
}
var dEx = ENGINE.simulateMatch(EXAMPLE, ENGINE.DEF, { opponent: { program: EXAMPLE, params: ENGINE.DEF }, intensity: 'realiste' });
check('même programme des deux côtés : aucune pierre chez les deux robots', bothHave(dEx).length === 0, bothHave(dEx).join(','));
check('une pierre réservée n\'est plus prenable par l\'autre', dEx.errors.concat(dEx.opponent.errors).some(function (e) { return /pris par l'adversaire|prise par l'adversaire/.test(e.msg); }));
check('les deux robots ne se superposent jamais (programmes)', robotOverlap(dEx) === 0, 'pas : ' + robotOverlap(dEx));
var soloB = ENV.playProgram([], ENGINE.DEF, { program: EXAMPLE, params: ENGINE.DEF }, 'realiste', true).result.opponent;
check('miroir exact : le bleu joue l\'exemple comme le jaune (même score, même durée)',
  SCORE.scoreAt(soloB, soloB.params, 100).total === sc.total && Math.abs(soloB.T - R.T) < 1e-6, SCORE.scoreAt(soloB, soloB.params, 100).total + ' / ' + sc.total + ', T ' + soloB.T);
check('tir du bleu vers la cour jaune', soloB.balls.shots && soloB.balls.shots.length > 0 && soloB.balls.shots.every(function (s) { return s.pts[s.pts.length - 1][1] < 1500; }));

/* cerveau (réseau simulé par un tirage au sort parmi les actions valides) contre cerveau : les deux robots décident en direct */
[1, 2].forEach(function (seed) {
  var envD = ENV.create({ skipContacts: true, adversaire: { intensite: 'realiste' } });
  envD.play(picker(seed), { opponent: { brain: { choose: picker(seed + 100) } }, intensite: 'realiste' });
  var Rd = envD.result();
  check('cerveau contre cerveau (' + seed + ') : adversaire présent et il a joué', !!Rd.opponent && envD.opponentProgram().length > 3, 'n=' + envD.opponentProgram().length);
  check('cerveau contre cerveau (' + seed + ') : aucune pierre chez les deux robots', bothHave(Rd).length === 0, bothHave(Rd).join(','));
  check('cerveau contre cerveau (' + seed + ') : les robots ne se superposent jamais', robotOverlap(Rd) === 0, 'pas : ' + robotOverlap(Rd));
  var rep = ENGINE.simulateMatch(envD.program(), ENGINE.DEF, { opponent: { program: envD.opponentProgram(), params: ENGINE.DEF }, intensity: 'realiste' });
  var a1 = SCORE.scoreAt(Rd, Rd.params, 100).total, a2 = SCORE.scoreAt(rep, rep.params, 100).total;
  var b1 = SCORE.scoreAt(Rd.opponent, Rd.opponent.params, 100).total, b2 = SCORE.scoreAt(rep.opponent, rep.opponent.params, 100).total;
  check('cerveau contre cerveau (' + seed + ') : le rejeu redonne les mêmes points des deux côtés', a1 === a2 && b1 === b2, a1 + '/' + a2 + ' ' + b1 + '/' + b2);
});

/* un même cerveau, côté jaune ou côté bleu, joue pareil (actions et observations en miroir) */
var ACT = ACTIONS.ALL;
function scripted(list) {
  var k = 0;
  return function (obs, mask) {
    while (k < list.length) {
      var st = list[k], idx = -1, i;
      for (i = 0; i < ACT.length; i++) { var a = ACT[i]; if (a.a === (st.a === 'tir' ? 'boulets' : st.a) && (!st.f || a.f === st.f) && (!st.p || a.p === st.p) && (!st.z || a.z === st.z) && (!st.side || a.side === st.side)) { idx = i; break; } }
      k++;
      if (idx >= 0 && mask[idx]) return idx;
    }
    return -1;
  };
}
var brainY = ENV.create({ skipContacts: true });
brainY.play(scripted(EXAMPLE), {});
var Ry = brainY.result(), sY = SCORE.scoreAt(Ry, Ry.params, 100).total;
var pmB = ENV.playProgram([], ENGINE.DEF, { brain: { choose: scripted(EXAMPLE) } }, 'realiste', true);
var Rb = pmB.result.opponent, sB = SCORE.scoreAt(Rb, Rb.params, 100).total;
check('même cerveau en jaune et en bleu : mêmes points', sY === sB && sY > 0, sY + ' / ' + sB);
function noWait(l) { return JSON.stringify(l.filter(function (s) { return s.a !== 'attendreJusqua'; })); }
check('même cerveau en jaune et en bleu : mêmes décisions (repère du cerveau)', noWait(brainY.program()) === noWait(pmB.opponentProgram), noWait(brainY.program()).slice(0, 200) + ' / ' + noWait(pmB.opponentProgram).slice(0, 200));

console.log('\n11. Milestone 1 : Cinématique, Actions & Radar Proprioceptif (R1-R5)');
// R1: packetStacked avec k === 'free' et prise partielle
var envM1 = ENV.create({ skipContacts: true, adversaire: { intensite: 'aucun' } });
var sM1 = envM1.reset({});
var catM1 = envM1.catalogue;
// Prise P1 face A
var idxP1A = idxOf(catM1, function (a) { return a.a === 'prendre' && a.f === 'A' && a.p === 'P1'; });
check('R1: action prendre P1 Face A disponible', idxP1A >= 0 && sM1.mask[idxP1A] === 1);
var stP1A = envM1.step(idxP1A);
check('R1: Face A a pris 3 pierres', envM1.sim.held().A.stack.length === 3);

// R1: tournerPince A (action 126)
var idxRotA = idxOf(catM1, function (a) { return a.a === 'tournerPince' && a.f === 'A'; });
check('R1: action tournerPince A présente dans catalogue', idxRotA === 126);
var stRot = envM1.step(idxRotA);
check('R1: tournerPince A bascule rot à 90°', envM1.sim.pose().A.rot === 90);
var stRotBack = envM1.step(idxRotA);
check('R1: tournerPince A rebascule rot à 0°', envM1.sim.pose().A.rot === 0);

// R1: deposerZone (action 128 / 129)
// Déplacement vers tour T1 et pose tour (utilise 1 pierre, laisse 2 pierres sur Face A à 90°)
var idxTourA = idxOf(catM1, function (a) { return a.a === 'tour' && a.f === 'A' && a.z === 'T1'; });
envM1.step(idxTourA);
check('R1: Face A a 2 pierres restantes après tour', envM1.sim.held().A && envM1.sim.held().A.stack.filter(function (x) { return x; }).length === 2);
check('R1: Face A rot = 90° après tour', envM1.sim.pose().A.rot === 90);
var idxDepA = idxOf(catM1, function (a) { return a.a === 'deposerZone' && a.f === 'A'; });
check('R1: action deposerZone A présente dans catalogue', idxDepA === 128);
var stDep = envM1.step(idxDepA);
check('R1: deposerZone vide la pince Face A', !envM1.sim.held().A || envM1.sim.held().A.stack.length === 0);
check('R1: deposerZone réinitialise rot à 0° et hc à 165', envM1.sim.pose().A.rot === 0 && envM1.sim.pose().A.hc === 165);
var idxMurA = idxOf(catM1, function (a) { return a.a === 'mur'; });

// R2: Dynamic multi-angle candidate approaches
var actP1 = catM1[idxP1A];
var targetsP1 = ACTIONS.getActionTargets(actP1, envM1.sim);
check('R2: getActionTargets pour P1 renvoie 2 approches opposées', targetsP1 && targetsP1.length === 2);
var idxT1 = idxOf(catM1, function (a) { return a.a === 'tour' && a.z === 'T1'; });
var targetsT1 = ACTIONS.getActionTargets(catM1[idxT1], envM1.sim);
check('R2: getActionTargets pour T1 renvoie 4 approches cardinales', targetsT1 && targetsT1.length === 4);

// R3: 8 Repositioning Waypoints
var wps = catM1.filter(function (a) { return a.a === 'traj'; });
check('R3: 8 waypoints de trajectoire présents (actions 118..125)', wps.length === 8 && catM1[118].a === 'traj' && catM1[125].a === 'traj');
var stepW1 = envM1.step(118);
var pW1 = envM1.sim.pose();
check('R3: déplacement réussi vers waypoint W1', Math.abs(pW1.x - 1050) < 5 && Math.abs(pW1.y - 450) < 5);

// R4: Adaptive placement & carriage elevation in transit
var pMur = ACTIONS.toProgramStep(catM1[idxMurA]);
check('R4: toProgramStep inclut paramètre pm proche', pMur.pm === 'proche');
var simR4 = ENGINE.makeSim(ENGINE.DEF);
simR4.exec({ a: 'prendre', f: 'A', p: 'P1' });
simR4.exec({ a: 'seDeplacer', x: 1500, y: 1000, h: 0 });
var rR4 = simR4.finish();
check('R4: élévation automatique du chariot hc >= 250 lors du transit avec pierres', rR4.K.some(function (k) { return k.A && k.A.hc >= 250; }));

// R5: Proprioception & Radar observation 56 dimensions
var obsM1 = s0.obs;
check('R5: observation 56 dimensions', obsM1.length === 56);
var proprio = obsM1.slice(37, 48);
check('R5: 11 entrées proprioception présentes et bornées [0, 1]', proprio.length === 11 && proprio.every(function (v) { return !isNaN(v) && v >= 0 && v <= 1; }));
var spatial = obsM1.slice(48, 56);
check('R5: 8 rayons radar spatial présents et bornés [0, 1]', spatial.length === 8 && spatial.every(function (v) { return !isNaN(v) && v >= 0 && v <= 1; }));

if (fail) { console.log('\n' + fail + ' échec(s).'); process.exit(1); }
console.log('\nTous les tests passent.');
