#!/usr/bin/env node
/* Génère spec/spec.js à partir des deux sources de vérité (spec/regles_2027.json, spec/robot.json).
   spec/spec.js définit globalThis.SPEC = { regles, robot } ; il est chargé en premier par engine/load.js (Node)
   et par les pages HTML, avant engine/geom.js.
   Usage : node tools/gen_spec.js   (à relancer après toute modification des JSON ; le test moteur vérifie la synchronisation) */
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');

function lire(rel) {
  var f = path.join(ROOT, rel);
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { throw new Error('Lecture de ' + rel + ' impossible : ' + e.message); }
}

function contenu() {
  var regles = lire('spec/regles_2027.json'), robot = lire('spec/robot.json');
  return '/* FICHIER GÉNÉRÉ par tools/gen_spec.js à partir de spec/regles_2027.json et spec/robot.json : ne pas modifier à la main. */\n' +
    '(function (g) {\n' +
    '  g.SPEC = {\n' +
    '    regles: ' + JSON.stringify(regles) + ',\n' +
    '    robot: ' + JSON.stringify(robot) + '\n' +
    '  };\n' +
    '})(typeof globalThis !== \'undefined\' ? globalThis : this);\n';
}

if (require.main === module) {
  var out = path.join(ROOT, 'spec', 'spec.js');
  fs.writeFileSync(out, contenu());
  console.log('spec/spec.js écrit (' + fs.statSync(out).size + ' octets).');
}

module.exports = { contenu: contenu };
