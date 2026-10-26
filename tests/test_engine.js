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
check('durée ~ 65,1 s', Math.abs(R.T - 65.1) < 0.15, 'T=' + R.T);
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

if (fail) { console.log('\n' + fail + ' échec(s).'); process.exit(1); }
console.log('\nTous les tests passent.');
