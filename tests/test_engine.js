#!/usr/bin/env node
/* Environnement v3 (chantier actions-env) : catalogue, masque, observation, récompense, imitation, adversaires.
   node tests/test_engine.js [nDecisions]   (code retour 1 si un test échoue) */
var path = require('path');
var cp = require('child_process');
var ROOT = path.resolve(__dirname, '..');
var ctx = require('../engine/load.js').loadIcamlot(ROOT);
var ENGINE = ctx.ENGINE, ENV = ctx.ENV, SCORE = ctx.SCORE, ACTIONS = ctx.ACTIONS;
var N_DEC = +(process.argv[2] || 2000);

var fail = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  ' + name + (detail ? '  (' + detail + ')' : ''));
  else { console.log('  KO  ' + name + (detail ? ' — ' + detail : '')); fail++; }
}
function rng(s) { var a = s >>> 0 || 1; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function finalScore(R) { return SCORE.scoreAt(R, R.params, ENV.MATCH).total; }
function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
/* politique aléatoire sur le masque ; « finir » est rarement choisi pour que les matchs durent */
function randomPick(r, env, mask) {
  var v = []; mask.forEach(function (m, i) { if (m) v.push(i); });
  var idx = v[Math.floor(r() * v.length)];
  if (env.catalogue[idx].a === 'finir' && r() < 0.9) idx = v[Math.floor(r() * v.length)];
  return idx;
}

console.log('Moteur ' + ENGINE.VERSION + ', barème ' + ctx.BAREME_VERSION + ', catalogue ' + ACTIONS.CATALOGUE_VERSION + ', observation ' + ENV.OBS_VERSION);

console.log('\n1. Catalogue v3');
var ALL = ACTIONS.ALL;
check('versions exposées', ACTIONS.CATALOGUE_VERSION === 'icamlot-catalogue-3.1' && ENV.OBS_VERSION === 'icamlot-obs-3.0');
check('familles = catalogue', sum(ACTIONS.FAMILLES.map(function (f) { return f.n; })) === ALL.length, ALL.length + ' actions');
check('labels uniques', new Set(ALL.map(function (a) { return a.label; })).size === ALL.length);
check('plus de prendreGraal / poserGraal / staging / repickup', !ALL.some(function (a) { return /Graal$|staging|repickup/.test(a.famille) && a.famille !== 'monterGraal'; }));
var ATT = ALL.filter(function (a) { return a.famille === 'attenteCourte'; });
check('attentes courtes (contrat §13) : une action par durée de HYPOTHESES.attentesCourtes, « finir » conservé',
  JSON.stringify(ATT.map(function (a) { return a.sec; })) === JSON.stringify(ACTIONS.HYPOTHESES.attentesCourtes) && ATT.every(function (a) { return a.a === 'attendre'; }) && ALL.some(function (a) { return a.a === 'finir'; }),
  ATT.map(function (a) { return a.sec + ' s'; }).join(', '));
check('monterGraal et préparer la pince présents', ALL.some(function (a) { return a.a === 'monterGraal'; }) && ALL.filter(function (a) { return a.a === 'preparer'; }).length === 6);
var env0 = ENV.create({ skipContacts: true }); env0.reset({});
var b0 = env0.belief();
var bricks = ALL.map(function (a) { return ACTIONS.toProgramStep(a, b0); }).filter(Boolean);
check('briques connues du moteur (étapes valides)', bricks.every(function (st) { return env0.sim.preconditions(st) !== 'Action inconnue.'; }));
check('temps masqué automatique (prendre, tour, préparer, stocker)', bricks.filter(function (st) { return /prendre|tourner|deposer$/.test(st.a); }).every(function (st) { return st.tm === true; }));
check('aucun pm « proche » (même effet que la brique du programme)', bricks.every(function (st) { return st.pm == null; }));

console.log('\n2. Points de passage atteignables depuis le départ (moteur)');
ACTIONS.WAYPOINTS_INFO.forEach(function (w) {
  var sim = ENGINE.makeSim(ENGINE.DEF, { skipContacts: true }), info = sim.exec({ a: 'seDeplacer', x: w.x, y: w.y });
  check(w.id + ' (' + w.x + ', ' + w.y + ')', !info.err, info.err || '');
});

console.log('\n3. Imitation du programme de référence');
var Rref = ENGINE.simulate(ENGINE.PROGRAMME_REFERENCE, ENGINE.DEF, { skipContacts: true });
var sRef = finalScore(Rref);
var envI = ENV.create({ skipContacts: true });
var im = envI.imitate(ENGINE.PROGRAMME_REFERENCE, { intensite: 'aucun' });
check('programme de référence : ' + sRef + ' pts sans erreur', sRef === 116 && Rref.errors.length === 0, 'T=' + Rref.T.toFixed(1));
check('imitation : même score que le programme', im.score === sRef, im.score + ' pts');
check('toutes les briques reconnues (une paire par brique)', im.n === ENGINE.PROGRAMME_REFERENCE.length, im.n + ' paires');
check('actions imitées valides dans le masque', im.pairs.every(function (p) { return p.mask[p.action] === 1; }));
check('somme des récompenses = score final', Math.abs(sum(im.pairs.map(function (p) { return p.reward; })) + im.score0 - im.score) < 1e-9);
check('instants croissants', im.pairs.every(function (p, k) { return !k || p.t >= im.pairs[k - 1].t; }));
var last = im.pairs[im.pairs.length - 1];
check('trône, boulets et Graal comptés seulement à la fin', sum(im.pairs.slice(0, -1).map(function (p) { return p.reward; })) === SCORE.scoreAt(envI.result(), envI.result().params, last.t).total);
var ESC = ENGINE.simulate(envI.program(), ENGINE.DEF, { skipContacts: true });
check('env.program() rejoué par le moteur = même score', finalScore(ESC) === im.score && ESC.errors.length === 0);
check('ENV.EXAMPLE = ENGINE.PROGRAMME_REFERENCE', ENV.EXAMPLE === ENGINE.PROGRAMME_REFERENCE);
/* la politique « gloutonne parfaite » rejouée par ENV.step obtient le même score */
var envS = ENV.create({ skipContacts: true }); envS.reset({});
im.pairs.forEach(function (p) { envS.step(p.action); });
var stEnd = envS.step(envS.catalogue.map(function (a) { return a.a; }).indexOf('finir'));
check('mêmes actions jouées par ENV.step : même score', finalScore(envS.result()) === sRef, finalScore(envS.result()) + ' pts');

console.log('\n3b. Tir explicite (contrat §13) : attente avant le premier boulet <= ' + ACTIONS.HYPOTHESES.attenteMaxTir + ' s');
/* attente réelle de la brique tir (segments « Attente, canon rentré » d'exec) */
function attenteExec(sim, st) {
  var snap = sim.snapshot(), n0 = sim.result(false).segs.length; sim.exec(st);
  var a = sim.result(false).segs.slice(n0).filter(function (x) { return /^Attente, canon rentré/.test(x.label); }).reduce(function (u, x) { return u + x.t1 - x.t0; }, 0);
  sim.restore(snap); return a;
}
var segsI = envI.result().segs, tirI = segsI.filter(function (x) { return /^Attente, canon rentré/.test(x.label); });
check('référence imitée : attente dans la brique tir <= attenteMaxTir', sum(tirI.map(function (x) { return x.t1 - x.t0; })) <= ACTIONS.HYPOTHESES.attenteMaxTir + 1e-6, sum(tirI.map(function (x) { return x.t1 - x.t0; })).toFixed(2) + ' s');
check('référence imitée : premier boulet à ' + ENGINE.T_ATTAQUE + ' s', Math.abs(envI.result().balls.t0 - ENGINE.T_ATTAQUE) < 1e-6, String(envI.result().balls.t0));
/* balayage : préfixe de la référence jusqu'au Graal (puis trône), instants de 0,25 s jusqu'à 84,5 s ; validité de tir (masque)
   comparée à l'attente réelle d'exec */
var tirAct = ALL.filter(function (a) { return a.a === 'tir'; }), iGr = ENGINE.PROGRAMME_REFERENCE.map(function (x) { return x.a; }).indexOf('monterGraal');
var swOk = true, swDet = [], swN = 0, swV = 0;
[[], [{ a: 'trone' }]].forEach(function (extra) {
  var simW = ENGINE.makeSim(ENGINE.DEF, { skipContacts: true }), memW = ENV.newMemory();
  ENGINE.PROGRAMME_REFERENCE.slice(0, iGr + 1).concat(extra).forEach(function (st) { var t0 = simW.time(), inf = simW.exec(st); ENV.updateMemory(memW, simW, t0, simW.time(), st, inf); });
  while (simW.time() < 84.5) {
    var bW = ENV.beliefFromSim(simW, memW, null), why = ACTIONS.explainBelief(bW, tirAct)[0], att = attenteExec(simW, ACTIONS.toProgramStep(tirAct[0], bW));
    swN++; if (!why) swV++;
    if (!why && att > ACTIONS.HYPOTHESES.attenteMaxTir + 1e-6) { swOk = false; swDet.push('valide à ' + simW.time().toFixed(2) + ' s, attente ' + att.toFixed(2)); }
    if (why && /attente/.test(why) && att <= ACTIONS.HYPOTHESES.attenteMaxTir - 0.05) { swOk = false; swDet.push('masqué à ' + simW.time().toFixed(2) + ' s, attente ' + att.toFixed(2)); }
    var t1 = simW.time(), inf2 = simW.exec({ a: 'attendre', sec: 0.25 }); ENV.updateMemory(memW, simW, t1, simW.time(), null, inf2);
  }
});
check('masque de tir = attente réelle d\'exec (' + swN + ' instants, ' + swV + ' valides)', swOk && swV > 0, swDet.slice(0, 3).join(' ; '));

console.log('\n4. Récompense, rejeu, pureté (épisodes aléatoires)');
var rS = rng(7), okSum = true, okReplay = true, okPure = true, okPen = true, nEp = 0, worst = '';
for (var e = 0; e < 6; e++) {
  var withOpp = e % 2 === 1, pen = e >= 4 ? { penalite_erreur: 5, penalite_invalide: 1 } : {};
  var env = ENV.create({ skipContacts: true, recompense: pen });
  var st = env.reset({ seed: 100 + e, intensite: withOpp ? 'realiste' : 'aucun' }), acc = 0, nErr = 0, k = 0;
  while (!st.done && k < 60) {
    var bb = env.belief(), snap = JSON.stringify(bb);
    var o1 = ENV.observeBelief(bb, env.groups), m1 = ACTIONS.maskBelief(bb, env.catalogue);
    if (JSON.stringify(bb) !== snap || JSON.stringify(o1) !== JSON.stringify(st.obs) || JSON.stringify(m1) !== JSON.stringify(st.mask) || JSON.stringify(ACTIONS.maskBelief(JSON.parse(snap), env.catalogue)) !== JSON.stringify(m1)) okPure = false;
    st = env.step(randomPick(rS, env, st.mask)); k++;
    acc += st.reward; if (st.err) nErr++;
  }
  if (!st.done) { var fi = env.catalogue.map(function (a) { return a.a; }).indexOf('finir'); st = env.step(fi); acc += st.reward; }
  var R = env.result(), fs = finalScore(R), expect = fs - (pen.penalite_erreur || 0) * nErr;
  if (Math.abs(acc - expect) > 1e-9) { okSum = false; worst = 'épisode ' + e + ' : somme ' + acc + ', attendu ' + expect; }
  if (pen.penalite_erreur && nErr && !(acc < fs)) okPen = false;
  if (!withOpp) { var RR = ENGINE.simulate(env.program(), ENGINE.DEF, { skipContacts: true }); if (finalScore(RR) !== fs || RR.errors.length !== R.errors.length) okReplay = false; }
  nEp++;
}
check('somme des récompenses = score officiel à 100 s - pénalités (' + nEp + ' épisodes, avec et sans adversaire)', okSum, worst);
check('pénalités cfg.recompense appliquées', okPen);
check('rejeu de env.program() par ENGINE.simulate = même score, mêmes erreurs', okReplay);
check('observeBelief / maskBelief purs et identiques à ceux de l\'env', okPure);
var ob = env0.reset({}).obs;
check('observation bornée', ob.length === ENV.nInputs() && ob.every(function (v) { return v >= -1 && v <= 1 && isFinite(v); }), ob.length + ' entrées');

console.log('\n5. Miroir bleu');
function mirrorBelief(b) {
  var m = JSON.parse(JSON.stringify(b)), mid = function (id) { return id && id.indexOf('.') >= 0 ? ENGINE.mirrorId(id.split('.')[0]) + '.' + id.split('.')[1] : ENGINE.mirrorId(id); };
  m.team = b.team === 'blue' ? 'yellow' : 'blue';
  m.pose.x = 3000 - b.pose.x; m.pose.h = 180 - b.pose.h;
  ['A', 'B'].forEach(function (f) { m.pinces[f].slots = b.pinces[f].slots.map(function (id) { return id ? mid(id) : null; }); });
  if (b.adversaire) { m.adversaire.x = 3000 - b.adversaire.x; m.adversaire.vx = -(b.adversaire.vx || 0); }
  m.pierres = b.pierres.map(function (s) { var o = JSON.parse(JSON.stringify(s)); o.id = mid(s.id); o.pk = ENGINE.PK.map(function (p) { return p.id; }).indexOf(ENGINE.mirrorId(ENGINE.PK[s.pk].id)); o.foot = s.foot.map(function (v) { return [3000 - v[0], v[1]]; }); return o; });
  m.portes = b.portes.map(mid);
  m.etrangeres = (b.etrangeres || []).map(function (s) { var o = JSON.parse(JSON.stringify(s)); o.foot = s.foot.map(function (v) { return [3000 - v[0], v[1]]; }); return o; });
  m.paquets = {}; Object.keys(b.paquets).forEach(function (k) { m.paquets[ENGINE.mirrorId(k)] = b.paquets[k]; });
  m.params.gx = 3000 - b.params.gx; m.params.ga = 180 - b.params.ga;
  return m;
}
/* état sans pierre tenue (le robot est chiral : B est à h + 120 dans les deux équipes) */
var envM = ENV.create({ skipContacts: true }); envM.reset({});
var bY = envM.belief(), bB = mirrorBelief(bY);
var oY = ENV.observeBelief(bY), oB = ENV.observeBelief(bB), teamIdx = 2 + 6;
var diff = oY.map(function (v, i) { return Math.abs(v - oB[i]) > 1e-9 ? i : -1; }).filter(function (i) { return i >= 0; });
check('observation bleue = observation jaune (sauf le bit d\'équipe)', diff.length === 1 && diff[0] === teamIdx, 'indices différents : ' + JSON.stringify(diff));
check('masque bleu = masque jaune au départ', JSON.stringify(ACTIONS.maskBelief(bY)) === JSON.stringify(ACTIONS.maskBelief(bB)));
/* état au milieu d'un match (pierres posées, adversaire) : les rayons et les carrières suivent le miroir */
var envM2 = ENV.create({ skipContacts: true }), st2 = envM2.reset({ intensite: 'realiste', seed: 3 }), rM = rng(3);
for (var q = 0; q < 12 && !st2.done; q++) st2 = envM2.step(randomPick(rM, envM2, st2.mask));
var bY2 = envM2.belief(); bY2.pinces.A.slots = [null, null, null]; bY2.pinces.B.slots = [null, null, null];
var bB2 = mirrorBelief(bY2), d2 = ENV.observeBelief(bY2).map(function (v, i) { return Math.abs(v - ENV.observeBelief(bB2)[i]) > 1e-9 ? i : -1; }).filter(function (i) { return i >= 0; });
check('miroir en cours de match (rayons, carrières, constructions, adversaire)', d2.length === 1 && d2[0] === teamIdx, JSON.stringify(d2));
var bl = ENV.blueParams(ENGINE.DEF), simB = ENGINE.makeSim(bl, { skipContacts: true }), memB = ENV.newMemory();
ENV.updateMemory(memB, simB, 0, 0, null, null);
var oBlue = ENV.observeBelief(ENV.beliefFromSim(simB, memB, null)), oYel = ENV.observeBelief(env0.reset({}).obs ? env0.belief() : null);
check('robot bleu au départ (moteur) vu comme le jaune', oBlue.filter(function (v, i) { return Math.abs(v - oYel[i]) > 1e-9; }).length === 1);
check('ACTIONS.realStep : dépôt et ids en miroir', (function () { var s = ACTIONS.realStep({ a: 'deposer', f: 'A', q: 'pile', x: 300, y: 620, ang: 0, r: 0 }, 'blue'); var t = ACTIONS.realStep({ a: 'tour', f: 'B', z: 'T2', s: 'P6.3' }, 'blue'); return s.x === 2700 && s.ang === 180 && t.z === 'T6' && t.s === 'P7.3'; })());

console.log('\n6. Masque -> moteur (' + N_DEC + ' décisions aléatoires par série, sans puis avec adversaire)');
/* causes dépendant du trajet ou de la pose choisie par le moteur (non vérifiables sans planifier/exécuter) */
var PATH = /aucun passage|aucune position|Aucune position|pas de place|pas de position|décalée|contact avec|bloqué|tomber|bascul|tenue à .* hors du château|Graal sorti/;
/* causes liées à l'adversaire (non masquées, décision §9) ou à la croyance (pierres prises sans être vues) */
var OPP = /n'est plus là|absente|robot adverse/;
function serie(withOpp, seed) {
  var r = rng(seed), o = { dec: 0, fail: 0, path: 0, opp: 0, other: {}, eps: 0, t: Date.now(), sansFinir: 0, sansAttente: 0, att: 0 }, iFin = ENV.create({}).catalogue.map(function (a) { return a.a; }).indexOf('finir');
  var iAtt = []; ENV.create({}).catalogue.forEach(function (a, i) { if (a.famille === 'attenteCourte') iAtt.push(i); });
  while (o.dec < N_DEC) {
    var envR = ENV.create({ skipContacts: true }), sr = envR.reset({ seed: seed * 1000 + o.eps, intensite: withOpp ? 'realiste' : 'aucun' }), kk = 0; o.eps++;
    while (!sr.done && kk < 80 && o.dec < N_DEC) {
      if (!sr.mask[iFin] && sr.t < ENV.MATCH - 0.05) o.sansFinir++;
      if (iAtt.some(function (i) { return !sr.mask[i]; }) && sr.t < ENV.MATCH - 0.05) o.sansAttente++;
      var pick = randomPick(r, envR, sr.mask); if (iAtt.indexOf(pick) >= 0) o.att++;
      sr = envR.step(pick); kk++; o.dec++;
      if (!sr.err) continue;
      o.fail++;
      if (OPP.test(sr.err)) o.opp++;
      else if (PATH.test(sr.err)) o.path++;
      else { var key = sr.err.replace(/[0-9]+([.,][0-9]+)?/g, '#'); o.other[key] = (o.other[key] || 0) + 1; }
    }
  }
  o.nOther = o.fail - o.path - o.opp;
  function pc(n) { return (100 * n / o.dec).toFixed(2) + ' %'; }
  console.log('   ' + (withOpp ? 'avec adversaire (référence en miroir)' : 'sans adversaire') + ' : ' + o.dec + ' décisions, ' + o.eps + ' matchs, ' + ((Date.now() - o.t) / o.dec).toFixed(1) + ' ms/décision ; échecs ' + o.fail + ' = ' + pc(o.fail));
  console.log('     dont attentes courtes (jamais en échec) : ' + o.att + ' ; échecs hors attentes : ' + (100 * o.fail / Math.max(1, o.dec - o.att)).toFixed(2) + ' %');
  console.log('     trajet ou pose choisie par le moteur : ' + o.path + ' (' + pc(o.path) + ') ; adversaire / croyance : ' + o.opp + ' (' + pc(o.opp) + ') ; autres : ' + o.nOther + ' (' + pc(o.nOther) + ') ' + JSON.stringify(o.other));
  return o;
}
var S0 = serie(false, 11), S1 = serie(true, 12);
check('sans adversaire : échecs hors trajet < 2 %', S0.nOther / S0.dec < 0.02, (100 * S0.nOther / S0.dec).toFixed(2) + ' %');
check('avec adversaire : échecs hors trajet et hors adversaire < 2 %', S1.nOther / S1.dec < 0.02, (100 * S1.nOther / S1.dec).toFixed(2) + ' %');
/* cohérence masque -> moteur (chantier moteur-2 : le masque joue l'étape à blanc avec le planificateur du moteur) */
check('sans adversaire : échecs toutes causes < 2 %', S0.fail / S0.dec < 0.02, (100 * S0.fail / S0.dec).toFixed(2) + ' %');
check('« finir » toujours valide avant 100 s (le masque n\'est jamais vide)', !S0.sansFinir && !S1.sansFinir, S0.sansFinir + ' / ' + S1.sansFinir);
check('attentes courtes toujours valides avant 100 s', !S0.sansAttente && !S1.sansAttente, S0.sansAttente + ' / ' + S1.sansAttente);

console.log('\n7. Adversaires : stratégie, MLP « layers », modèle récurrent');
function randMat(r, n, m, s) { var w = []; for (var i = 0; i < n; i++) { var row = []; for (var j = 0; j < m; j++) row.push((r() * 2 - 1) * s); w.push(row); } return w; }
function randVec(r, n, s) { var v = []; for (var i = 0; i < n; i++) v.push((r() * 2 - 1) * s); return v; }
var rW = rng(5), nIn = ENV.nInputs(), nOut = ALL.length, H = 16, Eh = 24;
var layers = [{ w: randMat(rW, nIn, 20, 0.3), b: randVec(rW, 20, 0.1) }, { w: randMat(rW, 20, nOut, 0.3), b: randVec(rW, nOut, 0.1) }];
var rec = {
  format: 'icamlot-modele-recurrent', version: 1, n_in: nIn, n_out: nOut, hidden: H, activation: 'silu',
  obs_version: ENV.OBS_VERSION, catalogue_version: ACTIONS.CATALOGUE_VERSION,
  normalisation: { mean: randVec(rW, nIn, 0.1), std: nIn ? new Array(nIn).fill(0).map(function () { return 0.5 + rW(); }) : [], clip: 5 },
  encodeur: [{ w: randMat(rW, nIn, Eh, 0.3), b: randVec(rW, Eh, 0.1), ln: { gamma: randVec(rW, Eh, 1), beta: randVec(rW, Eh, 0.1), eps: 1e-5 } }],
  gru: { w_ih: randMat(rW, Eh, 3 * H, 0.3), w_hh: randMat(rW, H, 3 * H, 0.3), b_ih: randVec(rW, 3 * H, 0.1), b_hh: randVec(rW, 3 * H, 0.1) },
  acteur: [{ w: randMat(rW, H, nOut, 0.3), b: randVec(rW, nOut, 0.1) }]
};
[['stratégie (référence)', { program: ENGINE.PROGRAMME_REFERENCE }], ['MLP layers', { brain: { layers: layers, acts: ['relu'] } }],
 ['modèle récurrent', { brain: rec }], ['poids camelot-poids v2 (récurrent)', { brain: { format: 'camelot-poids', version: 2, architecture: 'recurrent', modele: rec } }]].forEach(function (c) {
  var envO = ENV.create({ skipContacts: true }), s = envO.reset({ seed: 9, intensite: 'realiste', opponent: c[1] }), rO = rng(9), n = 0;
  while (!s.done && n < 40) { s = envO.step(randomPick(rO, envO, s.mask)); n++; }
  if (!s.done) s = envO.step(envO.catalogue.map(function (a) { return a.a; }).indexOf('finir'));
  var R = envO.result();
  check(c[0] + ' : match joué', s.done && R.opponent && envO.opponentProgram().length > 0, 'adversaire ' + finalScore(R.opponent) + ' pts, ' + envO.opponentProgram().length + ' briques, ' + R.opponent.errors.length + ' erreurs');
});
var envP = ENV.create({ skipContacts: true, adversaires: [{ program: ENGINE.PROGRAMME_REFERENCE }, { brain: rec }] });
var kinds = {}; for (var sd = 0; sd < 8; sd++) { envP.reset({ seed: sd, intensite: 'realiste' }); envP.step(envP.catalogue.map(function (a) { return a.a; }).indexOf('finir')); kinds[envP.opponentProgram().length > 0 && JSON.stringify(envP.opponentProgram()[0]) === JSON.stringify(ENGINE.PROGRAMME_REFERENCE[0]) ? 'ref' : 'autre'] = 1; }
check('plusieurs adversaires (opts.adversaires, tirage par graine)', kinds.ref && kinds.autre);
var envD = ENV.create({ skipContacts: true }); envD.reset({ seed: 1, intensite: 'realiste' }); envD.step(envD.catalogue.map(function (a) { return a.a; }).indexOf('finir'));
check('adversaire par défaut = programme de référence en miroir', JSON.stringify(envD.opponentProgram()) === JSON.stringify(ENGINE.PROGRAMME_REFERENCE));
var bad = false; try { ENV.brainSpec(Object.assign({}, rec, { catalogue_version: 'autre' })); } catch (e) { bad = true; }
check('modèle de version différente refusé', bad);

console.log('\n7 bis. Caméras (chantier moteur-2)');
(function () {
  /* l'adversaire (référence en miroir) prend P4 et P8 ; caméras coupées : la croyance n'en sait rien */
  var envC = ENV.create({ skipContacts: true, cameras: false }), sC = envC.reset({ seed: 2, intensite: 'realiste' }), envV = ENV.create({ skipContacts: true }), sV = envV.reset({ seed: 2, intensite: 'realiste' });
  var iTr = envC.catalogue.map(function (a) { return a.a + (a.w || ''); }).indexOf('trajW4');
  for (var k = 0; k < 3; k++) { sC = envC.step(iTr); sV = envV.step(iTr); }
  var bC = envC.belief(), changed = Object.keys(bC.paquets).filter(function (id) { return bC.paquets[id].n !== 3; });
  check('caméras coupées (ENV.create({ cameras: false })) : carrières jamais mises à jour par la vue', changed.length === 0, JSON.stringify(changed));
  check('modèle de caméras : prise seulement (portée et demi-angle réduits)', ENV.VISION.portee <= 500 && ENV.VISION.demiAngle <= 20, ENV.VISION.portee + ' mm, ' + ENV.VISION.demiAngle + '°');
})();

console.log('\n8. duel_bridge.js');
var out = cp.spawnSync('node', [path.join(ROOT, 'engine/duel_bridge.js')], { input: '{"cmd":"ping"}\n{"cmd":"init","config":{"blue":"realiste"}}\n', encoding: 'utf8' });
var lines = out.stdout.trim().split('\n').map(function (l) { return JSON.parse(l); });
check('ping + init', lines[0].ok && lines[0].catalogueVersion === ACTIONS.CATALOGUE_VERSION && lines[1].status === 'need_action' && lines[1].obs.length === ENV.nInputs() && lines[1].mask.length === ALL.length);

console.log('\n' + (fail ? fail + ' échec(s).' : 'Tous les tests passent.'));
process.exit(fail ? 1 : 0);
