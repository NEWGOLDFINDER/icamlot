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
    if (cmd === 'qualify') {
      return reply(ctx.ENV.qualify(msg.strategy || { program: msg.program }, msg.params));
    }
    if (cmd === 'example') return reply({ program: ctx.ENV.EXAMPLE });
    if (cmd === 'play') {
      if (!env) make(msg.config || {});
      var choose = ctx.ENV.chooserFromLayers(msg.layers, msg.acts || []);
      var st = env.play(choose, msg.scenario || {});
      var R = env.result();
      var sc = ctx.SCORE.scoreAt(R, R.params, Math.min(R.T, ctx.ENV.MATCH));
      var out = { score: sc.total, detail: sc.detail, T: R.T, errors: R.errors.length, program: env.program(), done: st.done };
      if (R.opponent) {
        var so = ctx.SCORE.scoreAt(R.opponent, R.opponent.params, Math.min(R.opponent.T, ctx.ENV.MATCH));
        out.adversaire = { score: so.total, detail: so.detail, T: R.opponent.T, errors: R.opponent.errors.length, program: env.opponentProgram() };
        out.contacts = R.collisions.length;
      }
      return reply(out);
    }
    if (cmd === 'close') { env = null; return reply({ ok: true }); }
    reply({ error: 'Commande inconnue : ' + cmd });
  } catch (e) {
    reply({ error: 'Erreur interne : ' + e.message });
  }
});
