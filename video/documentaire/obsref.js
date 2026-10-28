// Entrées (56) et masques (130) réels à chaque décision du programme de référence, seul et en duel (ENV.imitate, moteur de référence).
const path = require('path'), fs = require('fs');
const ROOT = path.resolve(process.argv[2] || process.env.ICAMLOT_AUDIT || '../../../icamlot-audit');
const ctx = require(path.join(ROOT, 'engine/load.js')).loadIcamlot(ROOT);
const ENV = ctx.ENV, PROG = ctx.ENGINE.PROGRAMME_REFERENCE;
const out = { source: 'ENV.imitate(ENGINE.PROGRAMME_REFERENCE) — engine/env.js, moteur de référence', groupes: null, catalogue: null };
for (const [nom, scen, opts] of [['solo', { seed: 1, intensite: 'aucun' }, {}], ['duel', { seed: 10000, intensite: 'realiste' }, { opponent: { program: PROG } }]]) {
  const env = ENV.create(Object.assign({}, opts));
  out.groupes = env.groups; out.catalogue = env.catalogue.map(a => a.label);
  const r = env.imitate(PROG, scen);
  out[nom] = { score: r.score, T: r.T, decisions: r.pairs.map(p => ({ action: p.action, label: env.catalogue[p.action].label, obs: p.obs.map(v => +v.toFixed(4)), mask: p.mask.map(x => x ? 1 : 0), valides: p.mask.reduce((a, b) => a + (b ? 1 : 0), 0), valide: !!p.mask[p.action] })) };
}
fs.writeFileSync('obs_reference.json', JSON.stringify(out));
for (const k of ['solo', 'duel']) console.log(k, out[k].score, out[k].decisions.map(d => `${d.label} (${d.valides}${d.valide ? '' : ', INVALIDE'})`).join(' | '));
