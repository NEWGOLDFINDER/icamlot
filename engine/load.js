/* Charge le moteur dans Node (tests, worker d'environnement, entraîneur).
   spec/spec.js (généré par tools/gen_spec.js) est chargé en premier (contrat §1).
   opts.moteurSeul : ne charge pas engine/actions.js ni engine/env.js. */
function loadIcamlot(rootDir, opts) {
  opts = opts || {};
  var fs = require('fs');
  var path = require('path');
  var vm = require('vm');
  var ctx = {
    console: console, Math: Math, JSON: JSON, Date: Date, Error: Error,
    Array: Array, Object: Object, String: String, Number: Number, Boolean: Boolean,
    Set: Set, Map: Map, Float32Array: Float32Array, Int8Array: Int8Array, Int32Array: Int32Array,
    Float64Array: Float64Array, Uint8Array: Uint8Array, ArrayBuffer: ArrayBuffer,
    parseInt: parseInt, parseFloat: parseFloat, isFinite: isFinite, isNaN: isNaN,
    Infinity: Infinity, NaN: NaN, undefined: undefined,
    module: { exports: {} }, exports: {}
  };
  ctx.globalThis = ctx;
  ctx.global = ctx;
  function run(rel) {
    var file = path.join(rootDir, rel);
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx, { filename: rel });
  }
  run('spec/spec.js');
  run('bareme.js');
  run('engine/geom.js');
  run('engine/engine.js');
  run('engine/score.js');
  if (opts.moteurSeul) return ctx;
  run('engine/actions.js');
  run('engine/env.js');
  return ctx;
}

if (typeof module !== 'undefined') module.exports = { loadIcamlot: loadIcamlot };
