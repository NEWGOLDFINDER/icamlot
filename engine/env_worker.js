#!/usr/bin/env node
/* Processus Node : un environnement par ligne JSON (stdin -> stdout). */
var path = require('path');
var readline = require('readline');
var loadIcamlot = require('./load.js').loadIcamlot;
var rootDir = path.resolve(__dirname, '..');
var ctx = loadIcamlot(rootDir);
var env = null;

function reply(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function make(cfg) {
  env = ctx.ENV.create(cfg || {});
  return { ok: true, nInputs: env.nInputs, nOutputs: env.nOutputs };
}

var rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', function (line) {
  line = line.trim();
  if (!line) return;
  var msg;
  try { msg = JSON.parse(line); } catch (e) { return reply({ error: 'JSON illisible.' }); }
  try {
    var cmd = msg.cmd;
    if (cmd === 'ping') return reply({ ok: true, moteur: ctx.ENGINE.VERSION, bareme: ctx.BAREME_VERSION });
    if (cmd === 'create') return reply(make(msg.config || {}));
    if (cmd === 'reset') {
      if (!env) make(msg.config || {});
      return reply(env.reset(msg.scenario || {}));
    }
    if (cmd === 'step') {
      if (!env) return reply({ error: 'Appelle reset d\'abord.' });
      return reply(env.step(msg.action));
    }
    if (cmd === 'score') {
      if (!env) return reply({ error: 'Pas d\'environnement.' });
      var R = env.result();
      var sc = ctx.SCORE.scoreAt(R, R.params, Math.min(R.T, ctx.ENV.MATCH));
      return reply({ score: sc.total, detail: sc.detail, T: R.T, errors: R.errors.length, program: env.program() });
    }
    if (cmd === 'program') return reply({ program: env ? env.program() : [] });
    if (cmd === 'imitate') {
      if (!env) make(msg.config || {});
      return reply(env.imitate(msg.program || [], msg.scenario || {}));
    }
    if (cmd === 'close') { env = null; return reply({ ok: true }); }
    reply({ error: 'Commande inconnue : ' + cmd });
  } catch (e) {
    reply({ error: 'Erreur interne : ' + e.message });
  }
});
