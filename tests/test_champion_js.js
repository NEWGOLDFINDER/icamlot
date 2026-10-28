#!/usr/bin/env node
/* Runtime JS du modèle récurrent « icamlot-modele-recurrent » (trainer/FORMAT_MODELE.md) :
   1. parité numérique avec l'implémentation de référence web_forward (trainer/export_onnx.py) sur des observations réelles,
      état caché enchaîné ;
   2. le modèle joue un match complet dans ENV (joueur) et sert d'adversaire (self-play), actions toujours valides.
   Pas d'ancien champion compatible (observation v3, catalogue v3) : le modèle est tiré au hasard, aux dimensions de l'env.
   node tests/test_champion_js.js   (code retour 1 si échec ; la parité est sautée, et signalée, si Python/torch manque) */
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var ROOT = path.resolve(__dirname, '..');
var ctx = require('../engine/load.js').loadIcamlot(ROOT);
var ENGINE = ctx.ENGINE, ENV = ctx.ENV, SCORE = ctx.SCORE, ACTIONS = ctx.ACTIONS;

var fail = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  ' + name + (detail ? '  (' + detail + ')' : ''));
  else { console.log('  KO  ' + name + (detail ? ' — ' + detail : '')); fail++; }
}
function rng(s) { var a = s >>> 0 || 1; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function mat(r, n, m, s) { var w = []; for (var i = 0; i < n; i++) { var row = []; for (var j = 0; j < m; j++) row.push((r() * 2 - 1) * s); w.push(row); } return w; }
function vec(r, n, s, o) { var v = []; for (var i = 0; i < n; i++) v.push((o || 0) + (r() * 2 - 1) * s); return v; }

var r = rng(2027), nIn = ENV.nInputs(), nOut = ACTIONS.ALL.length, H = 32, E1 = 48, A1 = 40;
var model = {
  format: 'icamlot-modele-recurrent', version: 1, n_in: nIn, n_out: nOut, hidden: H, activation: 'silu',
  obs_version: ENV.OBS_VERSION, catalogue_version: ACTIONS.CATALOGUE_VERSION, groupes: ENV.DEFAULT_GROUPS.slice(),
  normalisation: { mean: vec(r, nIn, 0.2), std: vec(r, nIn, 0.4, 0.7), clip: 5 },
  encodeur: [{ w: mat(r, nIn, E1, 0.4), b: vec(r, E1, 0.1), ln: { gamma: vec(r, E1, 0.3, 1), beta: vec(r, E1, 0.1), eps: 1e-5 } }],
  gru: { w_ih: mat(r, E1, 3 * H, 0.3), w_hh: mat(r, H, 3 * H, 0.3), b_ih: vec(r, 3 * H, 0.1), b_hh: vec(r, 3 * H, 0.1) },
  acteur: [{ w: mat(r, H, A1, 0.4), b: vec(r, A1, 0.1) }, { w: mat(r, A1, nOut, 0.4), b: vec(r, nOut, 0.1) }]
};
console.log('Modèle récurrent aléatoire : ' + nIn + ' entrées, ' + nOut + ' sorties, mémoire ' + H + ' (obs ' + ENV.OBS_VERSION + ', catalogue ' + ACTIONS.CATALOGUE_VERSION + ')');

console.log('\n1. Parité avec web_forward (trainer/export_onnx.py)');
/* observations réelles : programme de référence imité */
var env = ENV.create({ skipContacts: true }), im = env.imitate(ENGINE.PROGRAMME_REFERENCE, { intensite: 'aucun' });
var obs = im.pairs.map(function (p) { return p.obs; });
var fwd = ENV.recurrentForward(model), h = new Array(H).fill(0), jsOut = [];
obs.forEach(function (o) { var y = fwd(o, h); h = y.hidden; jsOut.push({ logits: y.logits, hidden: y.hidden }); });
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icamlot-champion-'));
fs.writeFileSync(path.join(tmp, 'modele.json'), JSON.stringify(model));
fs.writeFileSync(path.join(tmp, 'obs.json'), JSON.stringify(obs));
var py = [
  'import json, sys, numpy as np',
  'sys.path.insert(0, sys.argv[1])',
  'from trainer.export_onnx import web_forward',
  'w = json.load(open(sys.argv[2])); obs = json.load(open(sys.argv[3]))',
  'h = np.zeros((1, w["hidden"])); out = []',
  'for o in obs:',
  '    y, h = web_forward(w, np.asarray([o], dtype=np.float64), h)',
  '    out.append({"logits": y[0].tolist(), "hidden": h[0].tolist()})',
  'print(json.dumps(out))'
].join('\n');
var res = cp.spawnSync(process.env.PYTHON || 'python3', ['-c', py, ROOT, path.join(tmp, 'modele.json'), path.join(tmp, 'obs.json')], { encoding: 'utf8', maxBuffer: 1 << 28 });
if (res.status !== 0) {
  console.log('  SAUTÉ  Python / numpy / torch indisponible : ' + (res.stderr || res.error || '').toString().split('\n').filter(Boolean).slice(-1)[0]);
} else {
  var pyOut = JSON.parse(res.stdout), worst = 0;
  pyOut.forEach(function (p, k) {
    p.logits.forEach(function (v, i) { worst = Math.max(worst, Math.abs(v - jsOut[k].logits[i])); });
    p.hidden.forEach(function (v, i) { worst = Math.max(worst, Math.abs(v - jsOut[k].hidden[i])); });
  });
  check('logits et état caché identiques sur ' + obs.length + ' pas enchaînés', worst < 1e-6, 'écart max ' + worst.toExponential(2));
}
fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n2. Matchs joués par le modèle');
var envP = ENV.create({ skipContacts: true }), choose = ENV.chooserFromRecurrent(model), legal = true;
var st = envP.play(function (o, m) { var i = choose(o, m); if (!m[i]) legal = false; return i; }, { seed: 5, intensite: 'realiste' });
var R = envP.result();
check('joueur : match terminé à 100 s, actions toujours dans le masque', st.done && legal && Math.abs(envP.sim.time() - ENV.MATCH) < 1e-6, SCORE.scoreAt(R, R.params, ENV.MATCH).total + ' pts, ' + envP.program().length + ' briques, adversaire ' + SCORE.scoreAt(R.opponent, R.opponent.params, ENV.MATCH).total + ' pts');
var envS = ENV.create({ skipContacts: true }), sp = envS.reset({ seed: 6, intensite: 'realiste', opponent: { brain: model } }), n = 0;
while (!sp.done && n < 200) { sp = envS.step(choose(sp.obs, sp.mask)); n++; }
if (!sp.done) sp = envS.step(envS.catalogue.map(function (a) { return a.a; }).indexOf('finir'));
var RS = envS.result();
check('self-play : le modèle joue aussi le robot bleu (miroir)', sp.done && envS.opponentProgram().length > 0, 'bleu ' + SCORE.scoreAt(RS.opponent, RS.opponent.params, ENV.MATCH).total + ' pts, ' + envS.opponentProgram().length + ' briques');
var bad = 0; [['obs_version', 'x'], ['catalogue_version', 'x'], ['n_in', nIn + 1]].forEach(function (kv) { var m2 = Object.assign({}, model); m2[kv[0]] = kv[1]; try { ENV.brainSpec(m2); } catch (e) { bad++; } });
check('modèle incompatible (versions, dimensions) refusé', bad === 3);

console.log('\n' + (fail ? fail + ' échec(s).' : 'Tous les tests passent.'));
process.exit(fail ? 1 : 0);
