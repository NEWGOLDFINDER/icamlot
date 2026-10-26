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
check('106 actions', ACTIONS.ALL.length === 106);
var e0 = ENV.create();
var s0 = e0.reset({});
check('37 entrées par défaut', s0.obs.length === 37, 'n=' + s0.obs.length);
check('106 sorties par défaut', s0.mask.length === 106);
check('masque : prises possibles au départ', s0.mask.slice(0, 20).some(function (x) { return x; }));
check('masque : mur impossible au départ', !s0.mask.slice(20, 40).some(function (x) { return x; }));
check('masque : trône toujours possible', s0.mask[s0.mask.length - 1] === 1);

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

console.log('\n7. Masque : 106 sorties');
check('somme des familles', ACTIONS.FAMILLES.reduce(function (a, f) { return a + f.n; }, 0) === 106);

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
check('lidar adverse non nul', sOpp.obs.length === 37 && (sOpp.obs[35] !== 0 || sOpp.obs[36] !== 0), sOpp.obs.slice(35).join(','));

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
check('2e pierre de la même tour encore possible', afterT0.mask[iT1] === 1);

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

if (fail) { console.log('\n' + fail + ' échec(s).'); process.exit(1); }
console.log('\nTous les tests passent.');
