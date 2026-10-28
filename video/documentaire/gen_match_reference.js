#!/usr/bin/env node
/* Génère match_reference.json (ENV.EXAMPLE en duel contre son miroir) et match_reference_solo.json (ENV.EXAMPLE seul)
   à partir du moteur JS de référence (copie de la branche audit/simulateur-ia), sans modifier aucun fichier du dépôt.

   Chargement : identique à vid/stones.js (spec/spec.js, bareme.js, engine/geom.js, engine/engine.js, engine/score.js,
   engine/actions.js, engine/env.js dans un contexte vm) ; la seule différence avec le dépôt est l'exposition de la fonction
   interne geomHeld de makeSim (remplacement de texte au chargement, en mémoire). geomHeld est pure : elle ne lit que la pose
   passée en argument (engine/engine.js:175-179).

   Usage : node gen_match_reference.js [--root /home/user/icamlot-audit] [--out <dossier>] [--programme EXAMPLE|PROGRAMME_REFERENCE]
           [--graine 10000] [--intensite realiste] [--dt 0.05] [--duree 100]
   Sans --programme, écrit match_reference.json (duel) et match_reference_solo.json (seul) avec ENV.EXAMPLE.
   Avec --programme PROGRAMME_REFERENCE, écrit match_programme_reference.json et match_programme_reference_solo.json. */
'use strict';
const path = require('path'), fs = require('fs'), vm = require('vm'), crypto = require('crypto'), cp = require('child_process');

const ANCRE = 'return { exec: exec, finish: finish, result: result,';
const FICHIERS = ['spec/spec.js', 'bareme.js', 'engine/geom.js', 'engine/engine.js', 'engine/score.js', 'engine/actions.js', 'engine/env.js'];

function charger(root) {
  const ctx = { console, Math, JSON, Date, Error, Array, Object, String, Number, Boolean, Set, Map, WeakMap, Float32Array, Int8Array, Int32Array, Float64Array, Uint8Array, ArrayBuffer, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, undefined, module: { exports: {} }, exports: {} };
  ctx.globalThis = ctx.global = ctx;
  const empreintes = {};
  for (const rel of FICHIERS) {
    let src = fs.readFileSync(path.join(root, rel), 'utf8');
    empreintes[rel] = crypto.createHash('sha256').update(src).digest('hex').slice(0, 16);
    if (rel === 'engine/engine.js') {
      if (!src.includes(ANCRE)) throw new Error('ancre introuvable dans engine/engine.js');
      src = src.replace(ANCRE, 'return { geomHeld: geomHeld, exec: exec, finish: finish, result: result,');
    }
    vm.runInNewContext(src, ctx, { filename: rel });
  }
  ctx.__empreintes = empreintes;
  /* simulateur « outil » : sert seulement à appeler geomHeld (fonction pure de la pose) */
  ctx.__geo = ctx.ENGINE.makeSim(Object.assign({}, ctx.ENGINE.DEF), {});
  return ctx;
}

/* ---------------------------------------------------------------- matchs */
/* programme (repère jaune) seul ou contre une stratégie jouée en miroir par le bleu : ENV.playProgram (engine/env.js:284-291) */
function jouerProgramme(ctx, prog, opts) {
  opts = opts || {};
  const spec = opts.adversaire ? { program: opts.adversaire } : null;
  const params = opts.graine != null ? { seed: opts.graine } : {};
  const r = ctx.ENV.playProgram(prog, params, spec, opts.intensite || 'realiste', !!opts.skipContacts);
  return r.result;
}

/* match du modèle d'essai fumee contre ENV.EXAMPLE : même boucle que vid/stones.js et vid/record.js (trainer/evaluation.py) */
function jouerFumee(ctx, root) {
  const model = JSON.parse(fs.readFileSync(path.join(root, '.data/modeles/fumee.json'), 'utf8'));
  const sig = x => 1 / (1 + Math.exp(-x)), silu = x => x / (1 + Math.exp(-x));
  function lin(x, w, b) { const y = Float64Array.from(b); for (let k = 0; k < x.length; k++) { const r = w[k], xk = x[k]; for (let j = 0; j < y.length; j++) y[j] += xk * r[j]; } return y; }
  function fwd(obs, h) {
    const nm = model.normalisation; let x = obs.map((v, i) => Math.max(-nm.clip, Math.min(nm.clip, (v - nm.mean[i]) / nm.std[i])));
    const L = model.encodeur[0]; x = lin(x, L.w, L.b);
    const mu = x.reduce((a, b) => a + b) / x.length, va = x.reduce((a, b) => a + (b - mu) ** 2, 0) / x.length;
    x = x.map((v, i) => silu((v - mu) / Math.sqrt(va + L.ln.eps) * L.ln.gamma[i] + L.ln.beta[i]));
    const G = model.gru, H = model.hidden, gi = lin(x, G.w_ih, G.b_ih), gh = lin(h, G.w_hh, G.b_hh), hn = new Float64Array(H);
    for (let i = 0; i < H; i++) { const r = sig(gi[i] + gh[i]), z = sig(gi[H + i] + gh[H + i]), n = Math.tanh(gi[2 * H + i] + r * gh[2 * H + i]); hn[i] = (1 - z) * n + z * h[i]; }
    return { h: hn, logits: lin(hn, model.acteur[0].w, model.acteur[0].b) };
  }
  const env = ctx.ENV.create({ skipContacts: true, opponent: { program: ctx.ENV.EXAMPLE } });
  let h = new Float64Array(model.hidden), last = null, lastObs = null; const decisions = [];
  let st = env.reset({ seed: 10000, intensite: 'realiste' }), n = 0;
  while (!st.done && n < 80) {
    const o = Array.from(st.obs);
    if (!(lastObs && o.every((v, i) => v === lastObs[i]))) { last = fwd(o, h); h = last.h; lastObs = o; }
    let best = -1, bv = -Infinity; for (let i = 0; i < last.logits.length; i++) if (st.mask[i] && last.logits[i] > bv) { bv = last.logits[i]; best = i; }
    const t0 = env.sim.time();
    st = env.step(best); n++;
    decisions.push({ t0, t1: env.sim.time(), action: env.catalogue[best].label, brique: st.step, err: st.err || null });
  }
  const R = env.result();
  R.__decisions = decisions;
  return R;
}

/* ---------------------------------------------------------------- géométrie des pierres */
const r1 = x => Math.round(x * 10) / 10, r3 = x => Math.round(x * 1000) / 1000;
const norm360 = a => ((a % 360) + 360) % 360;
/* géométrie d'une pierre dans l'état e (entrée de sa chronologie) à l'instant t, pour le résultat R qui la contient */
function geoPierre(ctx, R, st, e, t) {
  const E = ctx.ENGINE;
  if (e.k === 'home') {
    const pk = E.PK[st.pk];
    return { c: [pk.x, pk.y], zb: 110 * st.l, zt: 110 * st.l + 110, hl: 160, hn: 55, ang: pk.tan, th: 0, debout: false };
  }
  const p = e.k === 'held' ? R.poseAt(t) : e.pose;
  const g = ctx.__geo.geomHeld(p, e.f, e.l), fo = g.fo;
  /* fo.ang = normale de la face qui tient (repère table) ; rectPoly place hl le long de lv(fo.ang) = direction fo.ang + 90 */
  return { c: [fo.cx, fo.cy], zb: g.bottom, zt: g.top, hl: fo.hl, hn: fo.hn, ang: norm360(fo.ang + 90), th: p[e.f].rot, debout: g.vertical, face: e.f, rangee: e.l + 1 };
}
/* état d'une pierre (par id) à l'instant t dans un duel : la chronologie jaune puis, si elle est « gone » chez le jaune, la bleue */
function etatPierre(ctx, RY, RB, id, t, idx) {
  const sY = idx.Y[id], sB = RB ? idx.B[id] : null;
  const eY = RY.stoneAt(sY, t), eB = sB ? RB.stoneAt(sB, t) : null;
  const actif = e => e && (e.k === 'held' || e.k === 'free');
  if (actif(eY) && actif(eB)) return { conflit: true, qui: 'jaune', R: RY, st: sY, e: eY };
  if (actif(eY)) return { qui: 'jaune', R: RY, st: sY, e: eY };
  if (actif(eB)) return { qui: 'bleu', R: RB, st: sB, e: eB };
  if (eY.k === 'home' && (!eB || eB.k === 'home')) return { qui: null, R: RY, st: sY, e: eY };
  return { qui: null, R: RY, st: sY, e: { k: 'gone' } };
}

/* ---------------------------------------------------------------- échantillonnage */
const ETATS = ['home', 'held', 'free', 'gone'];
const GRAAL_K = ['home', 'ascenseur', 'toit', 'retire'];
function poseRobot(p) {
  const C = p.C || {};
  return [r1(p.x), r1(p.y), r3(p.h), r1(p.A.hc), r3(p.A.rot), p.A.vac[0], p.A.vac[1], p.A.vac[2], r1(p.B.hc), r3(p.B.rot), p.B.vac[0], p.B.vac[1], p.B.vac[2], r1(C.can || 0), r1(C.fx), r1(C.fz)];
}
function boulet(shot, t) {
  if (t < shot.t) return null;
  const u = t - shot.t, P = shot.pts;
  if (u >= P[P.length - 1][0]) { const q = P[P.length - 1]; return [r1(q[1]), r1(q[2]), r1(q[3])]; }
  let i = 1; while (i < P.length && P[i][0] < u) i++;
  const a = P[i - 1], b = P[i], k = b[0] > a[0] ? (u - a[0]) / (b[0] - a[0]) : 1;
  return [r1(a[1] + (b[1] - a[1]) * k), r1(a[2] + (b[2] - a[2]) * k), r1(a[3] + (b[3] - a[3]) * k)];
}
function briques(R, prog) {
  return (R.stepInfo || []).map((si, i) => ({ i: i + 1, brique: (prog || R.program)[i], t0: r3(si.t0), t1: r3(si.t1), err: si.err || null }));
}
function equipe(ctx, R) {
  const S = ctx.SCORE, sc = S.scoreAt(R, R.params);
  return {
    equipe: R.params.team === 'blue' ? 'bleu' : 'jaune',
    fin_programme_s: r3(R.T),
    score_final: { total: sc.total, detail: sc.detail, lignes: sc.rows },
    erreurs: (R.errors || []).map(x => ({ brique: x.step, message: x.msg })),
    contacts: R.collisions || [],
    briques: briques(R),
    segments: (R.segs || []).map(s => ({ t0: r3(s.t0), t1: r3(s.t1), libelle: s.label, brique: s.step })),
    boulets: R.balls && R.balls.shots ? { t_premier: r3(R.balls.t0), vitesse_sortie_m_s: r3(R.balls.v0), bouche: R.balls.muzzle, tirs: R.balls.shots.map(b => ({ t: r3(b.t), arret: b.rest.map(r1), impact: b.imp.map(r1), t_arret_relatif: r3(b.tStop), dans_cour_adverse: !!b.cour, sorti: !!b.out, rebonds: b.bounces, trajectoire_t_x_y_z: b.pts.map(q => [r3(q[0]), r1(q[1]), r1(q[2]), r1(q[3])]) })) } : null
  };
}
function echantillonner(ctx, R, opts) {
  opts = opts || {};
  const dt = opts.dt || 0.05, T = opts.duree || 100, S = ctx.SCORE;
  const RY = R, RB = R.opponent || null;
  const idx = { Y: {}, B: {} };
  RY.stones.forEach(s => { idx.Y[s.id] = s; });
  if (RB) RB.stones.forEach(s => { idx.B[s.id] = s; });
  const ids = RY.stones.map(s => s.id);
  const n = Math.round(T / dt) + 1, temps = [], robots = { jaune: [], bleu: RB ? [] : null }, pierres = {}, graal = { jaune: [], bleu: RB ? [] : null };
  const score = { jaune: [], bleu: RB ? [] : null }, boulets = { jaune: [], bleu: RB ? [] : null }, conflits = [];
  ids.forEach(id => { pierres[id] = []; });
  for (let i = 0; i < n; i++) {
    const t = Math.round(i * dt * 1e6) / 1e6; temps.push(t);
    robots.jaune.push(poseRobot(RY.poseAt(t)));
    if (RB) robots.bleu.push(poseRobot(RB.poseAt(t)));
    ids.forEach(id => {
      const q = etatPierre(ctx, RY, RB, id, t, idx);
      if (q.conflit) conflits.push({ t, id });
      if (q.e.k === 'gone') { pierres[id].push([3, null]); return; }
      const g = geoPierre(ctx, q.R, q.st, q.e, t);
      pierres[id].push([ETATS.indexOf(q.e.k), q.qui, r1(g.c[0]), r1(g.c[1]), r1(g.zb), r1(g.zt), r1(g.hl), r1(g.hn), r3(g.ang), r3(g.th), g.face || null, g.rangee || null]);
    });
    [['jaune', RY], ['bleu', RB]].forEach(([nom, Rx]) => {
      if (!Rx) return;
      const gp = S.graalPos(Rx, Rx.params, t);
      graal[nom].push(gp ? [gp.k, r1(gp.c[0]), r1(gp.c[1]), r3(gp.ang), r1(gp.bottom), r1(gp.top)] : ['retire']);
      const sc = S.scoreAt(Rx, Rx.params, t);
      score[nom].push([sc.total, sc.detail.pierres, sc.detail.murs, sc.detail.tours, sc.detail.porte, sc.detail.graal, sc.detail.roi, sc.detail.boulets]);
      const sh = Rx.balls && Rx.balls.shots;
      boulets[nom].push(sh && t >= Rx.balls.t0 ? sh.map(b => boulet(b, t)) : null);
    });
  }
  /* changements d'état de chaque pierre (pour ne pas interpoler à travers une prise ou un lâcher) */
  const evenements = {};
  ids.forEach(id => {
    const ev = [], add = (R, qui) => (idx[R === RY ? 'Y' : 'B'][id] || { tl: [] }).tl.forEach(x => { if (x.k !== 'gone') ev.push({ t: r3(x.t), etat: x.k, qui: x.k === 'home' ? null : qui, face: x.f || null, rangee: x.l != null ? x.l + 1 : null }); });
    add(RY, 'jaune'); if (RB) add(RB, 'bleu');
    ev.sort((a, b) => a.t - b.t);
    evenements[id] = ev.filter((x, i) => !(x.etat === 'home' && i > 0));
  });
  return { temps, robots, pierres, evenements_pierres: evenements, graal, score, boulets, conflits_pierres: conflits };
}

function entete(ctx, root, desc) {
  let commit = null; try { commit = cp.execSync('git -C ' + JSON.stringify(root) + ' rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { /* pas de dépôt git */ }
  return Object.assign({
    format: 'icamlot-match-echantillonne',
    version_format: 1,
    genere_par: 'gen_match_reference.js',
    source: { depot: root, commit, moteur_version: ctx.ENGINE.VERSION, empreintes_sha256_16: ctx.__empreintes },
    unites: 'mm, degrés, secondes ; repère table : x de 0 à 3000, y de 0 à 2000, z vers le haut depuis le plateau ; angles dans le sens trigonométrique (contrat §2)',
    colonnes: {
      robots: ['x', 'y', 'h (normale de la face A)', 'A.hc', 'A.rot', 'A.vide1', 'A.vide2', 'A.vide3', 'B.hc', 'B.rot', 'B.vide1', 'B.vide2', 'B.vide3', 'C.can (sortie du canon)', 'C.fx (traverse de la fourche)', 'C.fz (dessous des dents de la fourche)'],
      pierres: ['etat (0 home, 1 held, 2 free, 3 gone)', 'qui (jaune | bleu | null)', 'cx', 'cy', 'z_bas', 'z_haut', 'hl (demi-côté le long de ang)', 'hn (demi-côté perpendiculaire, horizontal)', 'ang (direction du côté hl, [0,360[ ; pour une pierre à plat = grand côté)', 'th (rotation de la nacelle autour de la normale de la face : 0 à plat, 90 debout)', 'face (A | B si tenue ou posée)', 'rangee (1 à 3)'],
      graal: ['k (home | ascenseur | toit | retire)', 'cx', 'cy', 'ang', 'z_bas', 'z_haut'],
      score: ['total', 'pierres', 'murs', 'tours', 'porte', 'graal', 'roi', 'boulets'],
      boulets: 'pour chaque instant : null avant le premier tir, sinon un tableau de 10 positions [x, y, z] (null pour un boulet pas encore tiré)'
    },
    geometrie_pierre: 'Boîte 320 x 110 x 110. Grand axe (320) = cos(th)·d(ang) − sin(th)·z, avec d(ang) = (cos ang, sin ang, 0). Axe de 110 horizontal = d(ang − 90) (normale de la face qui tient). Centre = (cx, cy, (z_bas + z_haut) / 2). hl = 160|cos th| + 55|sin th|, hn = 55 (engine/geom.js:167-171, engine/engine.js:175-179). Pierre au départ : ang = axe long de la carrière, th = 0.'
  }, desc);
}

function main() {
  const a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const root = path.resolve(arg('--root', process.env.ICAMLOT_AUDIT || '/home/user/icamlot-audit'));
  const out = path.resolve(arg('--out', __dirname));
  const nomProg = arg('--programme', 'EXAMPLE'), graine = +arg('--graine', 10000), intensite = arg('--intensite', 'realiste');
  const dt = +arg('--dt', 0.05), duree = +arg('--duree', 100);
  const ctx = charger(root);
  const prog = nomProg === 'EXAMPLE' ? ctx.ENV.EXAMPLE : nomProg === 'PROGRAMME_REFERENCE' ? ctx.ENGINE.PROGRAMME_REFERENCE : null;
  if (!prog) throw new Error('programme inconnu : ' + nomProg);
  const base = nomProg === 'EXAMPLE' ? 'match_reference' : 'match_programme_reference';
  const src = nomProg === 'EXAMPLE' ? 'ENV.EXAMPLE (engine/env.js:531-541)' : 'ENGINE.PROGRAMME_REFERENCE (engine/engine.js:1666-1675)';
  const cas = [
    { fichier: base + '.json', titre: src + ' en duel contre son miroir', adversaire: prog },
    { fichier: base + '_solo.json', titre: src + ' seul sur la table', adversaire: null }
  ];
  for (const c of cas) {
    const t0 = Date.now();
    const R = jouerProgramme(ctx, prog, { adversaire: c.adversaire, intensite, graine });
    const doc = entete(ctx, root, {
      match: { titre: c.titre, programme_jaune: prog, programme_bleu: c.adversaire ? c.adversaire.map(x => ctx.ENGINE.mirrorStep(x)) : null, intensite: c.adversaire ? intensite : 'aucun', graine, appel: 'ENV.playProgram(programme, { seed: ' + graine + ' }, ' + (c.adversaire ? '{ program: programme }, \'' + intensite + '\'' : 'null, \'' + intensite + '\'') + ', false)', note_graine: 'P.seed n\'est lu nulle part dans engine/engine.js (seul P.bseed sert aux boulets) : la graine ne change pas ce match (vérifié par diag_pierres.js).' },
      echantillonnage: { dt, duree },
      jaune: equipe(ctx, R),
      bleu: R.opponent ? equipe(ctx, R.opponent) : null
    });
    Object.assign(doc, echantillonner(ctx, R, { dt, duree }));
    const f = path.join(out, c.fichier);
    fs.writeFileSync(f, JSON.stringify(doc));
    console.log(c.fichier, (fs.statSync(f).size / 1e6).toFixed(2) + ' Mo', 'jaune ' + doc.jaune.score_final.total + ' pts (' + doc.jaune.erreurs.length + ' erreurs, fin ' + doc.jaune.fin_programme_s + ' s)', doc.bleu ? 'bleu ' + doc.bleu.score_final.total + ' pts (' + doc.bleu.erreurs.length + ' erreurs, fin ' + doc.bleu.fin_programme_s + ' s)' : '', 'conflits ' + doc.conflits_pierres.length, ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  }
}

module.exports = { charger, jouerProgramme, jouerFumee, geoPierre, etatPierre, echantillonner, equipe };
if (require.main === module) main();
