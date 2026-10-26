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
      var layers = msg.layers, acts = msg.acts || [];
      function choose(obs, mask) {
        var h = obs.slice(), i, j, k;
        for (i = 0; i < layers.length; i++) {
          var w = layers[i].w, b = layers[i].b, next = [];
          for (j = 0; j < b.length; j++) {
            var s = b[j];
            for (k = 0; k < h.length; k++) s += h[k] * w[k][j];
            if (i < layers.length - 1) {
              var name = acts[i] || 'relu';
              if (name === 'tanh') s = Math.tanh(s);
              else if (name === 'sigmoid') s = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, s))));
              else s = s > 0 ? s : 0;
            }
            next[j] = s;
          }
          h = next;
        }
        var best = -1, bestv = -1e99;
        for (i = 0; i < h.length; i++) if (mask[i] && h[i] > bestv) { bestv = h[i]; best = i; }
        if (best < 0) { for (i = 0; i < mask.length; i++) if (mask[i]) return i; }
        return best;
      }
      var st = env.play(choose, msg.scenario || {});
      var R = env.result();
      var sc = ctx.SCORE.scoreAt(R, R.params, Math.min(R.T, ctx.ENV.MATCH));
      return reply({ score: sc.total, detail: sc.detail, T: R.T, errors: R.errors.length, program: env.program(), done: st.done });
    }
    if (cmd === 'close') { env = null; return reply({ ok: true }); }
    reply({ error: 'Commande inconnue : ' + cmd });
  } catch (e) {
    reply({ error: 'Erreur interne : ' + e.message });
  }
});
