// Runtime web du modèle récurrent (cerveau/runtime.js) comparé à web_forward (Python), tolérance 1e-5.
// Référence : tests/web_runtime_ref.json, générée par tests/gen_web_runtime_ref.py.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const RUNTIME = require('../cerveau/runtime.js');

const racine = path.join(__dirname, '..');
const modele = JSON.parse(fs.readFileSync(path.join(racine, '.data/modeles/fumee.json'), 'utf8'));
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'web_runtime_ref.json'), 'utf8'));
const TOL = 1e-5;
let ok = 0;
function test(nom, f) { try { f(); ok++; console.log('ok   ' + nom); } catch (e) { console.log('FAIL ' + nom + '\n     ' + e.message); process.exitCode = 1; } }
function ecartMax(a, b) { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; }

test('validate : modèle fumee accepté, versions et dimensions vérifiées', () => {
  assert.strictEqual(RUNTIME.validate(modele, { nIn: modele.n_in, nOut: modele.n_out, obsVersion: modele.obs_version, catalogueVersion: modele.catalogue_version }), null);
  assert.ok(RUNTIME.validate(modele, { nIn: modele.n_in + 1 }));
  assert.ok(RUNTIME.validate(modele, { nOut: 3 }));
  assert.ok(RUNTIME.validate(modele, { obsVersion: 'autre' }));
  assert.ok(RUNTIME.validate(modele, { catalogueVersion: 'autre' }));
  assert.ok(RUNTIME.validate({ format: 'camelot-poids' }));
});

test('forward enchaîné = web_forward Python à 1e-5 (logits et état caché, ' + ref.pas.length + ' pas)', () => {
  let hidden = RUNTIME.zeros(modele), pire = 0;
  ref.pas.forEach((p, k) => {
    const r = RUNTIME.forward(modele, p.obs, hidden);
    hidden = r.hidden;
    const dl = ecartMax(r.logits, p.logits), dh = ecartMax(r.hidden, p.hidden);
    pire = Math.max(pire, dl, dh);
    assert.ok(dl < TOL, 'pas ' + k + ' : écart logits ' + dl);
    assert.ok(dh < TOL, 'pas ' + k + ' : écart état caché ' + dh);
  });
  console.log('     écart maximal : ' + pire.toExponential(2));
});

test('chooser : argmax masqué identique à Python, état caché propagé', () => {
  const choose = RUNTIME.chooser(modele);
  ref.pas.forEach((p, k) => {
    assert.strictEqual(choose(p.obs, p.mask), p.argmax_masque, 'pas ' + k);
    assert.strictEqual(p.mask[p.argmax_masque], 1);
  });
  assert.ok(ecartMax(choose.hidden(), ref.pas[ref.pas.length - 1].hidden) < TOL);
});

test('reset : l\'état caché repart de zéro (même séquence, mêmes choix)', () => {
  const choose = RUNTIME.chooser(modele);
  const a = ref.pas.map(p => choose(p.obs, p.mask));
  assert.ok(choose.hidden().some(v => v !== 0));
  choose.reset();
  assert.ok(choose.hidden().every(v => v === 0));
  const b = ref.pas.map(p => choose(p.obs, p.mask));
  assert.deepStrictEqual(a, b);
});

test('même observation redemandée : état caché avancé une seule fois, nouveau masque appliqué', () => {
  const p = ref.pas[0], choose = RUNTIME.chooser(modele);
  const a = choose(p.obs, p.mask);
  const h1 = Array.from(choose.hidden());
  const m2 = p.mask.slice(); m2[a] = 0;
  const b = choose(p.obs, m2);
  assert.notStrictEqual(a, b);
  assert.strictEqual(m2[b], 1);
  assert.deepStrictEqual(Array.from(choose.hidden()), h1);
  assert.ok(ecartMax(h1, p.hidden) < TOL);
});

test('masque : une action masquée n\'est jamais choisie, -1 si rien de permis', () => {
  const logits = [5, 9, 1, 7];
  assert.strictEqual(RUNTIME.choisir(logits, [1, 0, 1, 1]), 3);
  assert.strictEqual(RUNTIME.choisir(logits, [0, 0, 0, 0]), -1);
  assert.strictEqual(RUNTIME.choisir(logits, null), 1);
});

test('modeleDe : camelot-poids v2 récurrent et JSON web brut', () => {
  assert.strictEqual(RUNTIME.modeleDe({ format: 'camelot-poids', version: 2, architecture: 'recurrent', modele }), modele);
  assert.strictEqual(RUNTIME.modeleDe(modele), modele);
  assert.strictEqual(RUNTIME.modeleDe({ format: 'camelot-poids', version: 1, layers: [] }), null);
});

console.log(ok + ' tests passés');
