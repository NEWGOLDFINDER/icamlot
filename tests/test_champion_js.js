const fs = require('fs');
const path = require('path');

// Simuler window pour les modules partagés
global.window = global;
require('../bareme.js');
require('../engine/geom.js');
require('../engine/engine.js');
require('../engine/score.js');
require('../engine/actions.js');
require('../engine/env.js');

const brain = JSON.parse(fs.readFileSync(path.join(__dirname, '../.data/brains/cerveau-v2-champion.json'), 'utf8'));
const weights = JSON.parse(fs.readFileSync(path.join(__dirname, '../.data/weights/cerveau-v2-champion.json'), 'utf8'));

console.log(`Cerveau: ${brain.name}, Entrées: ${brain.n_entrees}, Sorties: ${brain.n_sorties}, Params: ${brain.n_parametres}`);
console.log(`Poids chargés: ${weights.layers.length} couches`);

const acts = (brain.reseau.couches || []).map(c => c.activation);
const choose = ENV.chooserFromLayers(weights.layers, acts);

const env = ENV.create({
  entrees: brain.entrees,
  familles: brain.actions.familles,
  skipContacts: true,
  onError: 'penalite'
});

env.play(choose, {});

const prog = env.program();
console.log(`Programme généré (${prog.length} étapes):`);
prog.forEach((st, i) => console.log(`  ${i+1}. ${st.a}`));

const res = ENGINE.simulateMatch(prog, {}, {});
const finalScore = SCORE.scoreAt(res, {}, 100).total;

console.log(`Score JS final: ${finalScore} pts`);
console.log(`Erreurs: ${res.errors.length}`);
console.log(`Durée T: ${res.T.toFixed(1)} s`);

if (finalScore === 105 && res.errors.length === 0) {
  console.log("TEST NODE.JS / JS ENGINE 100% VALIDÉ !");
  process.exit(0);
} else {
  console.error("ÉCHEC VALIDATION JS");
  process.exit(1);
}
