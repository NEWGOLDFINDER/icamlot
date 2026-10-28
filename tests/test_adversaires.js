/* Robots adverses et caractéristiques physiques tirées (chantier adversaires, docs/CONTRATS.md §14).
   node tests/test_adversaires.js [matchs par robot (défaut 5)] */
var path = require('path'), fs = require('fs');
var ROOT = path.resolve(__dirname, '..');
var C = require(path.join(ROOT, 'engine', 'load.js')).loadIcamlot(ROOT);
var A = C.ADVERSAIRES, E = C.ENGINE, ENV = C.ENV, S = C.SCORE, G = C.GEOM, RG = C.SPEC.regles, LIM = RG.robot_limites;
var N = +(process.argv[2] || 5), fails = 0, n = 0;
function check(name, cond, detail) { n++; if (!cond) fails++; console.log((cond ? '  ok  ' : '  KO  ') + name + (detail != null ? '  (' + detail + ')' : '')); }
function inR(x, ab, eps) { eps = eps || 1e-6; return x >= ab[0] - eps && x <= ab[1] + eps; }
function seul(id, seed) {
  var prep = A.preparerRegles(id, seed), sim = prep.make({ team: 'blue' });
  for (var k = 0; k < 300; k++) { var b = prep.agent.next(sim); if (!b) break; sim.exec(b); }
  var r = sim.result(); return { r: r, sc: S.scoreAt(r, r.params), tirage: prep.tirage, program: sim.program() };
}
/* modèles figés des robots « réseau » s'ils ont été entraînés (sinon §7 crée un petit modèle temporaire) */
var DIR = process.env.ICAMLOT_ADVERSAIRES || path.join(ROOT, '.data', 'adversaires');
A.IDS.forEach(function (id) { var pr = A.PROFILS[id]; if (pr.modele && fs.existsSync(path.join(DIR, pr.modele + '.json'))) A.enregistrerModele(pr.modele, JSON.parse(fs.readFileSync(path.join(DIR, pr.modele + '.json'), 'utf8'))); });

console.log('1. Profils');
check('4 robots adverses : 2 à règles, 2 réseaux', A.IDS.length === 4 && A.IDS.filter(function (id) { return A.PROFILS[id].type === 'regles'; }).length === 2, A.IDS.join(', '));
check('chaque profil a une esquisse (points à atteindre seul)', A.IDS.every(function (id) { return A.PROFILS[id].esquisse > 0; }));

console.log('\n2. Plages de tirage (200 graines) et reproductibilité');
var bornes = { perimetre: [900, LIM.perimetre_depart_max], v: [300, 800], w: [90, 360], tPrise: [1, 4], tPose: [1, 4], tGraal: [2, 6], dArret: [250, 450] };
var okR = true, detR = '';
A.IDS.forEach(function (id) {
  var pr = A.PROFILS[id];
  for (var s = 0; s < 200; s++) {
    var t = A.tirerAdversaire(id, s);
    if (pr.type === 'regles') {
      Object.keys(bornes).forEach(function (k) { if (!inR(t[k], pr[k]) || !inR(t[k], bornes[k])) { okR = false; detR = id + ' ' + k + ' ' + t[k]; } });
      var per = A.perimetreOf(A.empreinte(t.forme, t.perimetre)); if (Math.abs(per - t.perimetre) > 1e-6) { okR = false; detR = id + ' périmètre ' + per; }
    } else {
      var pl = A.plagesReseau(id);
      Object.keys(t.phys).forEach(function (k) { if (!inR(t.phys[k], pl[k], 1e-3)) { okR = false; detR = id + ' ' + k + ' ' + t.phys[k]; } });
      if (!inR(t.phys.v, bornes.v) || !inR(t.phys.w, bornes.w) || !inR(t.phys.tMonteeGraal, bornes.tGraal)) { okR = false; detR = id + ' v/w/Graal'; }
    }
  }
});
check('adversaires : valeurs tirées dans les plages du profil et dans les bornes validées', okR, detR || 'v 300–800, w 90–360, prise/pose 1–4 s, Graal 2–6 s, périmètre 900–1200, arrêt 250–450');
var okN = true, detN = '';
for (var s2 = 0; s2 < 200; s2++) {
  var ph = A.tirerPhysique(s2, { actif: true });
  A.PHYSIQUE.forEach(function (d) { var b = A.bornes(d, d.nominal, d.plageDefaut); if (!inR(ph.valeurs[d.id], [Math.min(b[0], b[1]), Math.max(b[0], b[1])], 1e-3)) { okN = false; detN = d.id + ' ' + ph.valeurs[d.id]; } });
}
check('notre robot : ± 15 % autour de la spec (montée du Graal dans la plage déclarée)', okN, detN || A.PHYSIQUE.map(function (d) { return d.id + ' ' + d.nominal + (Array.isArray(d.plageDefaut) ? ' [' + d.plageDefaut + ']' : ''); }).join(', '));
var g = A.physDesc('tMonteeGraal');
check('montée du Graal : plage par défaut = plage déclarée de la spec', JSON.stringify(g.plageDefaut) === JSON.stringify(C.SPEC.robot.mecanismes.ascenseur_graal.duree_montee_s.plage), JSON.stringify(g.plageDefaut));
var p1 = A.tirerPhysique(7, { actif: true }), p2 = A.tirerPhysique(7, { actif: true }), p3 = A.tirerPhysique(8, { actif: true });
check('tirage reproductible par graine, différent pour une autre graine', JSON.stringify(p1) === JSON.stringify(p2) && JSON.stringify(p1.valeurs) !== JSON.stringify(p3.valeurs));
var pf = A.tirerPhysique(7, { actif: true, valeurs: { v: 450 }, plages: { v: 0 } }), pn = A.tirerPhysique(7, { actif: false });
check('valeur fixée à la main et tirage coupé', pf.valeurs.v === 450 && Math.abs(pf.params.v - 0.45) < 1e-12 && A.PHYSIQUE.every(function (d) { return pn.valeurs[d.id] === d.nominal; }));
check('statut de chaque valeur dans la spec (déclaré / hérité)', A.PHYSIQUE.every(function (d) { return /^(declare|herite|mesure|propose)$/.test(d.statut); }) && A.physDesc('trel').statut === 'herite' && A.physDesc('trot').statut === 'declare',
  A.PHYSIQUE.map(function (d) { return d.id + ':' + d.statut; }).join(' '));

console.log('\n3. Robots à règles seuls sur la table (' + N + ' matchs chacun)');
['batisseur', 'razzia'].forEach(function (id) {
  var sc = [], errs = 0, conf = true, depart = true, rep = true, pr = A.PROFILS[id];
  for (var k = 0; k < N; k++) {
    var m = seul(id, 100 + k); sc.push(m.sc.total); errs += m.r.errors.length;
    if (!m.r.conformite.ok) conf = false;
    var p0 = m.r.poseAt(0), foot = G.toTable(m.r.forme, p0), thr = E.throneOf('blue');
    if (!foot.every(function (v) { return E.inPoly(v[0], v[1], thr); }) || G.overlap(foot, E.graalPoly(m.r.graalHome.c, m.r.graalHome.ang), 0)) depart = false;
    if (k === 0) { var m2 = seul(id, 100); rep = m2.sc.total === m.sc.total && JSON.stringify(m2.program) === JSON.stringify(m.program); }
  }
  var moy = sc.reduce(function (a, b) { return a + b; }, 0) / sc.length;
  check(pr.nom + ' : chaque match >= esquisse (' + pr.esquisse + ' pts), sans erreur moteur', Math.min.apply(null, sc) >= pr.esquisse && errs === 0, 'moyenne ' + moy.toFixed(1) + ', min ' + Math.min.apply(null, sc) + ', erreurs ' + errs);
  check(pr.nom + ' : périmètre <= ' + LIM.perimetre_depart_max + ' / ' + LIM.perimetre_deploye_max + ' mm, hauteur <= ' + LIM.hauteur_max_robot_et_objets_manipules + ' mm', conf);
  check(pr.nom + ' : départ entièrement dans sa salle du trône, hors du Graal', depart);
  check(pr.nom + ' : même graine, même match', rep);
});
var bat = seul('batisseur', 100);
check('Bâtisseur : ne tire pas', !bat.r.tir && bat.sc.detail.boulets === 0);
var raz = seul('razzia', 100), cibles = A.PROFILS.razzia.carrieres, prem = raz.program.filter(function (b) { return b.a === 'prendre'; }).slice(0, 2);
check('Razzia : vide d\'abord les carrières proches de notre château, puis tire', prem.length === 2 && prem.every(function (b) { return cibles.indexOf(b.p) >= 0; }) && raz.r.tir && raz.sc.detail.boulets > 0, prem.map(function (b) { return b.p; }).join(', '));

console.log('\n4. Évitement (robot à règles) : arrêt si notre robot est sur son chemin');
(function () {
  /* notre robot surgit devant lui pendant son trajet vers une carrière */
  var tir = A.tirerAdversaire('batisseur', 3, { v: 600, dArret: 300 }), apparu = 0.8;
  var probe = A.makeRobot(tir, { team: 'blue', seed: 3 }), F = probe.champ(0), es = probe.estimer(probe.approcheCarriere(E.PK.map(function (p) { return p.id; }).indexOf('P10')), F);
  var milieu = [2750 + 0.8 * (es.c.O[0] - 2750), 1000 + 0.8 * (es.c.O[1] - 1000)];
  var nous = function (t) { return t >= apparu && t < apparu + 2 ? { t: t, x: milieu[0], y: milieu[1], h: 0 } : { t: t, x: 300, y: 300, h: 0 }; };
  var sim = A.makeRobot(tir, { team: 'blue', seed: 3, oppPoseAt: nous, oppRadius: function () { return G.GEO.R; } });
  sim.exec({ a: 'prendre', p: 'P10' });
  var r = sim.result(), arrets = r.K.filter(function (k) { return k.lbl === 'attente : robot adverse devant'; }).length, contact = false, gapMin = 1e9;
  for (var t = 0; t <= r.T; t += 0.05) {
    var o = nous(t), p = r.poseAt(t);
    if (G.hullHit(o, G.toTable(r.forme, p), 1)) contact = true;
    if (t >= apparu && t < apparu + 2) gapMin = Math.min(gapMin, Math.hypot(o.x - p.x, o.y - p.y) - r.R - G.GEO.R);
  }
  check('il s\'arrête derrière notre robot, sans contact, puis repart', arrets > 0 && !contact && r.errors.length === 0 && r.taken && Object.keys(r.taken).length > 0, arrets + ' pas d\'arrêt, écart minimal ' + gapMin.toFixed(0) + ' mm (distance d\'arrêt ' + tir.dArret + ' mm)');
})();

console.log('\n5. Duel contre notre programme de référence (3 matchs par robot à règles)');
['batisseur', 'razzia'].forEach(function (id) {
  var col = 0, errO = 0, ok = true, sc = [];
  for (var k = 0; k < 3; k++) {
    var res = ENV.playProgram(E.PROGRAMME_REFERENCE, { seed: 200 + k }, { robot: id }, 'realiste', false), R = res.result;
    col += (R.collisions || []).filter(function (c) { return /robot adverse/.test(c.with); }).length; errO += R.opponent.errors.length;
    if (!R.opponent.abstrait || !res.adversaire || res.adversaire.profil !== id) ok = false;
    sc.push(S.scoreAt(R.opponent, R.opponent.params).total);
    R.errors.forEach(function (e) { if (/Contact avec le robot adverse/.test(e.msg)) col++; });
  }
  check(A.PROFILS[id].nom + ' contre la référence : aucun contact robot-robot, aucune erreur moteur adverse', ok && col === 0 && errO === 0, 'scores adverses ' + sc.join(', '));
});

console.log('\n6. Environnement : caractéristiques tirées, observation « physique », cohérence du masque');
var env = ENV.create({ skipContacts: true, physique: { actif: true } });
var st = env.reset({ seed: 42, intensite: 'realiste', opponent: { robot: 'razzia' } }), ph1 = st.physique;
var st2 = env.reset({ seed: 42, intensite: 'realiste', opponent: { robot: 'razzia' } });
check('infos de l\'épisode : valeurs tirées des deux robots, reproductibles', ph1 && ph1.notre && ph1.adversaire && ph1.adversaire.profil === 'razzia' && JSON.stringify(ph1) === JSON.stringify(st2.physique), 'v = ' + ph1.notre.v.toFixed(0) + ' mm/s, adversaire v = ' + ph1.adversaire.v.toFixed(0) + ' mm/s');
var b = env.belief(), P = env.sim.params();
check('croyance : caractéristiques effectives du match (masque et moteur identiques)', A.clesPhysiques().every(function (k) { return b.params[k] === P[k]; }) && Math.abs(P.v * 1000 - ph1.notre.v) < 1e-3);
var gi = ENV.GROUPS.filter(function (x) { return x.id === 'physique'; })[0];
check('groupe d\'observation « physique » (OBS_VERSION ' + ENV.OBS_VERSION + ')', gi && gi.vars[0].n === A.PHYSIQUE.length && ENV.DEFAULT_GROUPS.indexOf('physique') >= 0);
var o1 = ENV.observeBelief(b, ['physique']), b0 = JSON.parse(JSON.stringify(b)); A.clesPhysiques().forEach(function (k) { b0.params[k] = E.DEF[k]; });
check('observation physique : 0 aux nominales, écart relatif sinon, bornée', ENV.observeBelief(b0, ['physique']).every(function (v) { return v === 0; }) && o1.every(function (v) { return v >= -1 && v <= 1; }) && Math.abs(o1[0] - (P.v / E.DEF.v - 1)) < 1e-12);
var envN = ENV.create({ skipContacts: true });
check('sans réglage physique : valeurs de la spec (embarqué, tests existants)', A.clesPhysiques().every(function (k) { envN.reset({ seed: 5 }); return envN.sim.params()[k] === E.DEF[k]; }));

console.log('\n7. Robots « réseau » : sans modèle, message explicite ; avec un petit modèle temporaire (créé ici, jamais versionné)');
function rngT(s) { var a = s >>> 0 || 1; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function randMat(r, n, m, s) { var w = []; for (var i = 0; i < n; i++) { var row = []; for (var j = 0; j < m; j++) row.push((r() * 2 - 1) * s); w.push(row); } return w; }
function randVec(r, n, s) { var v = []; for (var i = 0; i < n; i++) v.push((r() * 2 - 1) * s); return v; }
/* modèle récurrent minuscule (format icamlot-modele-recurrent), poids aléatoires */
function petitModele(seed) {
  var r = rngT(seed), nIn = ENV.nInputs(), nOut = C.ACTIONS.ALL.length, H = 8, Eh = 12;
  return {
    format: 'icamlot-modele-recurrent', version: 1, n_in: nIn, n_out: nOut, hidden: H, activation: 'silu',
    obs_version: ENV.OBS_VERSION, catalogue_version: C.ACTIONS.CATALOGUE_VERSION,
    normalisation: { mean: randVec(r, nIn, 0.1), std: new Array(nIn).fill(0).map(function () { return 0.5 + r(); }), clip: 5 },
    encodeur: [{ w: randMat(r, nIn, Eh, 0.3), b: randVec(r, Eh, 0.1), ln: { gamma: randVec(r, Eh, 1), beta: randVec(r, Eh, 0.1), eps: 1e-5 } }],
    gru: { w_ih: randMat(r, Eh, 3 * H, 0.3), w_hh: randMat(r, H, 3 * H, 0.3), b_ih: randVec(r, 3 * H, 0.1), b_hh: randVec(r, 3 * H, 0.1) },
    acteur: [{ w: randMat(r, H, nOut, 0.3), b: randVec(r, nOut, 0.1) }]
  };
}
['champion', 'intermediaire'].forEach(function (id, k) {
  var pr = A.PROFILS[id], msg = '';
  if (!A.modele(pr.modele)) {
    try { ENV.playProgram([], { seed: 300 }, { robot: id }, 'realiste', true); } catch (e) { msg = e.message; }
    check(pr.nom + ' sans modèle : erreur explicite, pas de repli', msg.indexOf(A.NON_ENTRAINE) >= 0 && msg.indexOf(A.commandeEntrainement(id)) >= 0, msg);
    A.enregistrerModele(pr.modele, petitModele(10 + k));
  }
  var res = ENV.playProgram([], { seed: 300 }, { robot: id }, 'realiste', true), R = res.result.opponent;
  check(pr.nom + ' : joue le robot bleu avec ses caractéristiques tirées (petit modèle temporaire ou modèle figé)', R && !R.abstrait && R.params.team === 'blue' && Math.abs(R.params.v * 1000 - res.adversaire.phys.v) < 1e-3 && Math.abs(R.params.trot - res.adversaire.phys.trot) < 1e-6,
    'score ' + S.scoreAt(R, R.params).total + ', v ' + res.adversaire.phys.v.toFixed(0) + ' mm/s, ' + R.program.length + ' briques');
  var env7 = ENV.create({ skipContacts: true }), s7 = env7.reset({ seed: 301, intensite: 'realiste', opponent: { robot: id } });
  check(pr.nom + ' : adversaire d\'un épisode d\'entraînement (ENV.create / reset)', s7.physique.adversaire.profil === id && s7.obs.length === env7.nInputs);
});
console.log('\n' + (fails ? fails + ' échec(s) sur ' + n + '.' : n + ' tests passés.'));
process.exit(fails ? 1 : 0);
