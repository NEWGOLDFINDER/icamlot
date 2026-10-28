#!/usr/bin/env node
/* Tests du moteur de simulation (chantier moteur, docs/CONTRATS.md §1 à §3).
   Usage : node tests/test_moteur.js   (code de retour non nul en cas d'échec) */
var path = require('path');
var fs = require('fs');
var ROOT = path.resolve(__dirname, '..');
var L = require(path.join(ROOT, 'engine', 'load.js')).loadIcamlot(ROOT, { moteurSeul: true });
var E = L.ENGINE, S = L.SCORE, G = L.GEOM, GE = G.GEO;

var nOk = 0, nKo = 0;
function ok(cond, nom, detail) {
  if (cond) { nOk++; console.log('  ok   ' + nom + (detail ? '  (' + detail + ')' : '')); }
  else { nKo++; console.log('  ÉCHEC ' + nom + (detail ? '  (' + detail + ')' : '')); }
}
function proche(a, b, tol) { return Math.abs(a - b) <= tol; }
function titre(t) { console.log('\n— ' + t + ' —'); }
function run(prog, P, opts) { var sim = E.makeSim(P || {}, opts || { skipContacts: true }); var infos = (prog || []).map(function (st) { return sim.exec(st); }); return { sim: sim, infos: infos }; }
function msgs(R) { return R.errors.map(function (e) { return e.step + ': ' + e.msg; }).join(' | '); }

/* ------------------------------------------------------------------ */
titre('Spécification');
var gen = require(path.join(ROOT, 'tools', 'gen_spec.js'));
ok(fs.readFileSync(path.join(ROOT, 'spec', 'spec.js'), 'utf8') === gen.contenu(), 'spec/spec.js à jour avec spec/*.json', 'sinon : node tools/gen_spec.js');
ok(E.DEF.v === 0.5 && E.DEF.w === 120 && E.DEF.vz === L.SPEC.robot.mecanismes.pince_A_et_B.vitesse_chariot_mm_s && E.DEF.trot === 1.5 && E.DEF.tvac === 0.5 && E.DEF.trel === 0.4, 'durées et vitesses lues dans la spec');
ok(L.BAREME.pierre === L.SPEC.regles.bareme.pierre && L.BAREME.mur === L.SPEC.regles.bareme.mur && L.BAREME.tour === L.SPEC.regles.bareme.tour && L.BAREME.porte === L.SPEC.regles.bareme.porte &&
  L.BAREME.graalPresent === L.SPEC.regles.bareme.graal_present && L.BAREME.graalNiveau === L.SPEC.regles.bareme.graal_par_niveau && L.BAREME.retourPartiel === L.SPEC.regles.bareme.trone_partiel &&
  L.BAREME.retourComplet === L.SPEC.regles.bareme.trone_complet && L.BAREME.boulet1 === L.SPEC.regles.bareme.boulet_au_moins_1 && L.BAREME.boulet3 === L.SPEC.regles.bareme.boulets_au_moins_3_supplement &&
  L.BAREME.douve === L.SPEC.regles.bareme.douve_par_pami && L.BAREME.attaque === L.SPEC.regles.bareme.attaque_pami, 'bareme.js identique au barème de spec/regles_2027.json');

/* ------------------------------------------------------------------ */
titre('Géométrie du robot');
var k0 = { x: 250, y: 1000, h: 0, A: { hc: 165, rot: 0 }, B: { hc: 165, rot: 0 }, C: GE.C0 };
var per0 = G.perimetre(k0, { sansMeca: true }), perN = G.perimetre(k0);
ok(proche(per0, 1173.1, 0.2), 'périmètre du châssis seul ≈ 1173,1 mm', per0.toFixed(1) + ' mm');
ok(perN <= 1200 && proche(perN, 1190, 2), 'périmètre de départ avec nacelles ≤ 1200 (≈ 1190 d\'après tools/cao_robot.py)', perN.toFixed(1) + ' mm');
ok(G.actTop(k0) <= 350 && proche(G.actTop(k0), 347.2, 0.05), 'hauteur maximale au départ ≤ 350 mm', G.actTop(k0).toFixed(1) + ' mm (traverse de la fourche rangée)');
ok(proche(GE.face, 110.3, 1e-9) && proche(GE.dPierre, 200.3, 1e-9) && proche(GE.toit, 311.2, 1e-9), 'faces à 110,3 mm, pierre à plat centrée à 200,3 mm, toit à 311,2 mm');
ok(GE.hcMin === 135 && GE.hcMax === 273, 'course de l\'axe des nacelles [135, 273] mm');
var hf = G.heldFoot(k0, 0, 1);
ok(proche(hf.cx, 450.3, 1e-6) && proche(hf.cy, 1000, 1e-6), 'pierre tenue par la face A au centre de la nacelle', hf.cx.toFixed(1) + ', ' + hf.cy.toFixed(1));
var uMax = 0; for (var a = 0; a <= 180; a++) uMax = Math.max(uMax, G.actExt(a).umax);
var perPire = G.perimetre({ A: k0.A, B: k0.B, C: { can: 90, fx: GE.fourche.fxSortie, fz: 300 } }, { uA: uMax, uB: uMax });
ok(perPire <= 1400, 'périmètre au pire en match (2 nacelles au pire angle, canon et fourche sortis) ≤ 1400', perPire.toFixed(1) + ' mm');

/* ------------------------------------------------------------------ */
titre('Rotations des nacelles (mouvement vertical coordonné, port de tools/conception_pince.py)');
function bal(nom, mask, ch, a0, a1, attendu) { var b = G.balayage(mask, ch, a0, a1); ok(b.ok === attendu, nom + ' : ' + (attendu ? 'faisable' : 'impossible'), 'marge ' + b.marge.toFixed(1) + ' mm'); }
bal('pile de 3, 0 → 90°, dans le château', 7, true, 0, 90, true);
bal('retournement 180 → 0° d\'une pierre tenue en rangée 3 (château)', 4, true, 180, 0, false);
bal('retournement 180 → 0° d\'une pierre tenue en rangée 3 (hors château)', 4, false, 180, 0, false);
bal('nacelle vide 0 → 180°', 0, false, 0, 180, true);
bal('1 pierre en rangée 1, 0 → 90°, hors château', 1, false, 0, 90, true);
bal('1 pierre en rangée 2, 0 → 180°, dans le château', 2, true, 0, 180, true);
/* écart volontaire avec conception_pince.py : sa branche « infaisable » oublie la limite de 350 mm des pierres hors château */
bal('pile de 3, 0 → 90°, hors château (conception_pince.py dit faisable à tort)', 7, false, 0, 90, false);
bal('1 pierre en rangée 3, 0 → 90°, hors château (conception_pince.py dit faisable à tort)', 4, false, 0, 90, false);
var r1 = run([{ a: 'prendre', f: 'A', p: 'P1' }, { a: 'tourner', f: 'A', r: 90 }]);
ok(/rotation impossible sous 350 mm/.test(r1.infos[1].err || ''), 'pile tournée hors du château : erreur « rotation impossible sous 350 mm »', r1.infos[1].err);
var r2 = run([{ a: 'prendre', f: 'B', mode: 'pierre', s: 'P1.3' }, { a: 'tourner', f: 'B', r: 180 }]);
ok(/rotation impossible sous 350 mm/.test(r2.infos[1].err || '') && r2.infos[1].dt === 0, 'retournement à 180° d\'une pierre en rangée 3 refusé sans avancer le temps', r2.infos[1].err);
var r3 = run([{ a: 'tourner', f: 'A', r: 180 }, { a: 'tourner', f: 'A', r: 0 }]);
ok(!r3.infos[0].err && !r3.infos[1].err && proche(r3.infos[0].dt, 3, 0.05), 'nacelle vide 0 → 180° exécutée (3 s)', r3.infos[0].dt.toFixed(2) + ' s');

/* ------------------------------------------------------------------ */
titre('Programme de référence (golden)');
var ref = E.PROGRAMME_REFERENCE;
var familles = {}; ref.forEach(function (s) { familles[s.a] = 1; });
ok(familles.prendre && familles.mur && familles.porte && familles.tour && familles.tir && familles.monterGraal && familles.trone, 'utilise prises, murs, porte, tour, tir, monterGraal, trône');
var Rref = E.simulate(ref, {}, {});
var sc = S.scoreAt(Rref, Rref.params);
console.log('     score ' + sc.total + ' pts, programme terminé à ' + Rref.T.toFixed(2) + ' s');
sc.rows.forEach(function (r) { r[1].forEach(function (x) { console.log('       ' + r[0] + ' · ' + x[0] + ' : ' + x[1] + ' → ' + x[2]); }); });
ok(Rref.errors.length === 0, 'aucune erreur moteur', msgs(Rref));
ok(Rref.collisions.length === 0, 'aucun contact', JSON.stringify(Rref.collisions));
var GOLDEN = { total: 116, T: 90.30, detail: { pierres: 16, murs: 20, tours: 5, porte: 20, graal: 25, roi: 10, boulets: 20 } };
ok(sc.total === GOLDEN.total, 'score golden ' + GOLDEN.total, String(sc.total));
ok(proche(Rref.T, GOLDEN.T, 0.005), 'durée golden ' + GOLDEN.T.toFixed(2) + ' s', Rref.T.toFixed(2));
Object.keys(GOLDEN.detail).forEach(function (k) { ok(sc.detail[k] === GOLDEN.detail[k], 'poste ' + k + ' = ' + GOLDEN.detail[k], String(sc.detail[k])); });
var badT = null, perMax = 0, hMax = 0;
for (var t = 0; t <= Rref.T; t += 0.1) { var c = S.checks(Rref, Rref.params, t); perMax = Math.max(perMax, c.per); hMax = Math.max(hMax, c.robotH); if (c.bad && badT == null) badT = t + ' ' + c.why.join(', '); }
ok(badT == null, 'contrôles de hauteur, périmètre et contacts respectés tout le match', 'périmètre max ' + perMax.toFixed(1) + ' mm, actionneurs max ' + hMax.toFixed(1) + ' mm' + (badT ? ', premier défaut à ' + badT : ''));
var rDoor = Rref.stones.filter(function (x) { return x.tag === 'l'; })[0];
ok(rDoor && rDoor.id === 'P2.3', 'linteau de la porte = pierre de la rangée 3 (P2.3)', rDoor && rDoor.id);

/* ------------------------------------------------------------------ */
titre('Graal');
var Pd = E.makeSim({}, { skipContacts: true }).params();
var gp = E.graalPoly([Pd.gx, Pd.gy], Pd.ga);
ok(gp.every(function (v) { return v[0] >= 0 && v[0] <= 500 && v[1] >= 750 && v[1] <= 1250; }), 'Graal par défaut entièrement dans la salle du trône', Pd.gx + ', ' + Pd.gy + ', ' + Pd.ga + '°');
ok(!G.overlap(gp, G.robotFootprint(k0), 0), 'Graal par défaut hors de l\'emprise du robot au départ');
[['jaune', {}], ['bleu', E.blueParams({})]].forEach(function (q) {
  var r = run([{ a: 'monterGraal' }], q[1]), R = r.sim.result(true);
  ok(!R.errors.length && r.sim.graal().cur.k === 'toit' && proche(r.infos[0].dt, 10, 0.01), 'monterGraal depuis le départ (' + q[0] + ')', r.infos[0].dt.toFixed(2) + ' s ' + msgs(R));
});
var rg = run([{ a: 'monterGraal' }, { a: 'trone' }]), Rg = rg.sim.finish(), sg = S.scoreAt(Rg, Rg.params);
ok(sg.niveauGraal === 4 && sg.detail.graal === 25 && sg.detail.roi === 10, 'Graal sur le toit, robot dans le trône à 100 s : niveau 4, 25 pts', 'graal ' + sg.detail.graal + ', trône ' + sg.detail.roi + ' ' + msgs(Rg));
var gr = E.graalOnRobot(Rg.poseAt(100), 'toit');
ok(proche(gr.bottom, 311.2, 1e-9), 'Graal posé sur le toit à 311,2 mm');
var rr = run([{ a: 'monterGraal' }, { a: 'seDeplacer', x: 1500, y: 1000 }]), Rr = rr.sim.finish(), sr = S.scoreAt(Rr, Rr.params);
ok(rr.sim.graal().cur.k === 'retire' && /retiré de la table/.test(rr.infos[1].err || '') && sr.detail.graal === 0, 'Graal retiré si le robot sort du château avec le Graal sur le toit', rr.infos[1].err);
ok(rr.sim.preconditions({ a: 'monterGraal' }) !== null, 'monterGraal refusé une fois le Graal parti', rr.sim.preconditions({ a: 'monterGraal' }));
var rh = run([{ a: 'seDeplacer', x: 1500, y: 1000 }]);
ok(/château/.test(rh.sim.preconditions({ a: 'monterGraal' }) || ''), 'monterGraal refusé hors du château', rh.sim.preconditions({ a: 'monterGraal' }));
ok(E.makeSim({}).exec({ a: 'prendreGraal', f: 'A' }).err === 'Action inconnue.', 'prendreGraal supprimé (Action inconnue)');

/* ------------------------------------------------------------------ */
titre('Règles et score');
/* porte centrée sur M5 : le robot toucherait le bord de table ; placement manuel décalé de 50 mm le long de la zone */
var rp = run([{ a: 'prendre', f: 'A', p: 'P5' }, { a: 'porte', f: 'A', z: 'M5', pm: 'manuel', x: 300, y: 1600, ang: 0 }]), Rp = rp.sim.finish(), sp = S.scoreAt(Rp, Rp.params);
ok(!Rp.errors.length && sp.detail.porte === 20, 'porte acceptée sur M5', msgs(Rp) || 'porte ' + sp.detail.porte + ' pts');
rp.sim.exec({ a: 'prendre', f: 'A', p: 'P1' });
ok(/Une seule porte par château/.test(rp.sim.preconditions({ a: 'porte', f: 'A', z: 'M3' }) || ''), 'seconde porte dans le même château refusée', rp.sim.preconditions({ a: 'porte', f: 'A', z: 'M3' }));
var rs = run([{ a: 'prendre', f: 'A', p: 'P1' }, { a: 'deposer', f: 'A', q: 'pile', x: 300, y: 700, ang: 0 }, { a: 'prendre', f: 'B', p: 'P5' }]);
ok(!rs.infos[1].err && rs.sim.stockage() === 3, '3 pierres stockées dans la cour : permis', 'stockage ' + rs.sim.stockage() + (rs.infos[1].err ? ' ' + rs.infos[1].err : ''));
var stDep = { a: 'deposer', f: 'B', q: 'pile', x: 320, y: 1300, ang: 0 }, preS = rs.sim.preconditions(stDep), exS = rs.sim.exec(stDep);
ok(/Stockage/.test(preS || '') && exS.err === preS, 'plus de 3 pierres stockées dans la cour : erreur moteur', exS.err);
var rl = run([{ a: 'prendre', f: 'A', p: 'P1' }, { a: 'deposer', f: 'A', q: 'pile', x: 300, y: 700, ang: 0 }, { a: 'prendre', f: 'B', p: 'P5' }, { a: 'seDeplacer', x: 300, y: 1050, h: 0 }, { a: 'lacher', f: 'B', q: 'pile' }]);
ok(/Stockage/.test(rl.infos[4].err || ''), 'lâcher une 4e pierre dans la cour : erreur moteur', rl.infos[4].err);
var rt = run([]), Rt = rt.sim.finish();
ok(S.scoreAt(Rt, Rt.params, 50).detail.roi === 0 && S.scoreAt(Rt, Rt.params).detail.roi === 10, 'trône compté seulement à T = 100 s', 'à 50 s : ' + S.scoreAt(Rt, Rt.params, 50).detail.roi + ', à 100 s : ' + S.scoreAt(Rt, Rt.params).detail.roi);
ok(S.scoreAt(Rt, Rt.params, 50).detail.graal === 0 && S.scoreAt(Rt, Rt.params).detail.graal === 5, 'Graal (présence 5 pts) compté seulement à T = 100 s');
ok(S.scoreAt(Rref, Rref.params, 89).detail.boulets === 0 && S.scoreAt(Rref, Rref.params).detail.boulets === 20, 'boulets comptés seulement à T = 100 s');
var rc = run([{ a: 'tir' }]), bl = rc.sim.balls();
ok(bl.shots.length === 10 && bl.shots.every(function (b) { return b.t >= 85 - 1e-9 && b.t <= 100; }) && !rc.infos[0].err, '10 boulets tirés dans la fenêtre [85, 100] s', 'premier à ' + bl.shots[0].t.toFixed(2) + ' s, dernier à ' + bl.shots[9].t.toFixed(2) + ' s');
ok(Rt.K[0].C.can === 0, 'canon rentré au départ');
var rc2 = run([{ a: 'seDeplacer', x: 700, y: 1000, h: 120 }, { a: 'tir' }], { tirDepuisTrone: false });
ok(!rc2.infos[1].err && rc2.sim.pose().x === 700, 'tirDepuisTrone = faux : tir sur place', rc2.infos[1].err);
var rc3 = run([{ a: 'attendreJusqua', sec: 99.9 }, { a: 'tir' }]);
ok((rc3.sim.balls().shots || []).every(function (b) { return b.t <= 100; }) && !!rc3.infos[1].err, 'aucun boulet tiré après 100 s', rc3.infos[1].err);
var rc4 = run([{ a: 'attendreJusqua', sec: 100 }]);
ok(/terminé/.test(rc4.sim.preconditions({ a: 'tir' }) || ''), 'tir refusé après 100 s');

/* ------------------------------------------------------------------ */
titre('Préconditions cohérentes avec exec');
function cas(nom, prog, st, attendu) {
  var r = run(prog), pre = r.sim.preconditions(st), t0 = r.sim.time(), e = r.sim.exec(st);
  if (attendu) ok(pre === null && !e.err, nom + ' : accepté', e.err || '');
  else ok(pre !== null && e.err === pre && e.dt === 0 && r.sim.time() === t0, nom + ' : refusé sans avancer le temps', pre);
}
cas('prendre P1 au départ', [], { a: 'prendre', f: 'A', p: 'P1' }, true);
cas('prendre avec une face déjà chargée', [{ a: 'prendre', f: 'A', p: 'P1' }], { a: 'prendre', f: 'A', p: 'P2' }, false);
cas('prendre un paquet déjà pris', [{ a: 'prendre', f: 'A', p: 'P1' }], { a: 'prendre', f: 'B', p: 'P1' }, false);
cas('paquet inconnu', [], { a: 'prendre', f: 'A', p: 'P42' }, false);
cas('mur sans pile', [], { a: 'mur', f: 'A', z: 'M1' }, false);
cas('mur sur une zone de tour', [{ a: 'prendre', f: 'A', p: 'P1' }], { a: 'mur', f: 'A', z: 'T1' }, false);
cas('mur avec une pile', [{ a: 'prendre', f: 'A', p: 'P1' }], { a: 'mur', f: 'A', z: 'M1' }, true);
cas('porte sans pile complète', [{ a: 'prendre', f: 'A', mode: 'pierre', s: 'P1.3' }], { a: 'porte', f: 'A', z: 'M3' }, false);
cas('tour avec une pierre non tenue', [], { a: 'tour', f: 'A', z: 'T1', s: 'P1.1' }, false);
cas('tourner à 45°', [], { a: 'tourner', f: 'A', r: 45 }, false);
cas('retournement d\'une pierre en rangée 3', [{ a: 'prendre', f: 'B', mode: 'pierre', s: 'P1.3' }], { a: 'tourner', f: 'B', r: 180 }, false);
cas('deuxième séance de tir', [{ a: 'tir' }], { a: 'tir' }, false);
cas('monterGraal au départ', [], { a: 'monterGraal' }, true);
cas('monterGraal deux fois', [{ a: 'monterGraal' }], { a: 'monterGraal' }, false);
cas('lâcher sans pierre', [], { a: 'lacher', f: 'A' }, false);
cas('mur sur une zone déjà construite', [{ a: 'prendre', f: 'A', p: 'P1' }, { a: 'mur', f: 'A', z: 'M1' }, { a: 'prendre', f: 'A', p: 'P2' }], { a: 'mur', f: 'A', z: 'M1' }, false);
cas('pile tournée sur place hors du château', [{ a: 'prendre', f: 'A', p: 'P1' }], { a: 'tourner', f: 'A', r: 90 }, false);
cas('nacelle vide tournée à 90°', [], { a: 'tourner', f: 'A', r: 90 }, true);
cas('action inconnue', [], { a: 'voler' }, false);

/* programmes tirés au hasard (graine fixe) : toute étape refusée par preconditions échoue à l'identique dans exec, sans avancer le temps */
(function () {
  var seed = 7; function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }
  var PKS = E.PK.map(function (p) { return p.id; }), ZMS = ['M1', 'M2', 'M3', 'M4', 'M5'], ZTS = ['T1', 'T2', 'T3', 'T4'], nPre = 0, incoh = [], nApres = 0;
  for (var m = 0; m < 6; m++) {
    var sim = E.makeSim({}, { skipContacts: true });
    for (var i = 0; i < 16 && sim.time() < 100; i++) {
      var f = pick(['A', 'B']), k = rnd(), st;
      if (k < 0.3) st = { a: 'prendre', f: f, p: pick(PKS) };
      else if (k < 0.4) st = { a: 'prendre', f: f, mode: 'pierre', s: pick(PKS) + '.' + (1 + Math.floor(rnd() * 3)) };
      else if (k < 0.55) st = { a: 'mur', f: f, z: pick(ZMS) };
      else if (k < 0.62) st = { a: 'porte', f: f, z: pick(ZMS) };
      else if (k < 0.72) { var hs = sim.held()[f] ? sim.held()[f].stack.filter(Boolean) : []; st = { a: 'tour', f: f, z: pick(ZTS), s: hs.length ? pick(hs).id : 'P1.1' }; }
      else if (k < 0.78) st = { a: 'tourner', f: f, r: pick([0, 90, 180]) };
      else if (k < 0.84) st = { a: 'lacher', f: f };
      else if (k < 0.9) st = { a: 'monterGraal' };
      else if (k < 0.95) st = { a: 'seDeplacer', x: 300 + rnd() * 2400, y: 300 + rnd() * 1400 };
      else st = { a: 'tir' };
      var pre = sim.preconditions(st), t0 = sim.time(), e = sim.exec(st);
      if (pre) { nPre++; if (e.err !== pre || e.dt !== 0) incoh.push(st.a + ' : « ' + pre + ' » / « ' + e.err + ' »'); }
      else if (e.err) nApres++;
    }
  }
  ok(!incoh.length, 'programmes au hasard : refus de preconditions identiques à exec', nPre + ' refus vérifiés, ' + nApres + ' échecs dépendant du trajet' + (incoh.length ? ' ; ' + incoh.slice(0, 3).join(' ; ') : ''));
})();

/* ------------------------------------------------------------------ */
titre('Instantané et restauration (utilisés par l\'environnement)');
var rsn = run(ref.slice(0, 4)), snap = rsn.sim.snapshot();
ref.slice(4).forEach(function (st) { rsn.sim.exec(st); });
var T1 = rsn.sim.time(), sc1 = S.scoreAt(rsn.sim.result(false), rsn.sim.params()).total;
rsn.sim.restore(snap);
ref.slice(4).forEach(function (st) { rsn.sim.exec(st); });
ok(rsn.sim.time() === T1 && S.scoreAt(rsn.sim.result(false), rsn.sim.params()).total === sc1 && rsn.sim.result(false).errors.length === 0, 'rejouer après restore donne le même résultat', T1.toFixed(2) + ' s, ' + sc1 + ' pts');
ok(rsn.sim.hullRadius() > 0, 'hullRadius exposé', rsn.sim.hullRadius().toFixed(1) + ' mm');

/* ------------------------------------------------------------------ */
titre('Duel jaune contre bleu (même programme en miroir)');
var exc = null, Rd = null;
try { Rd = E.simulateMatch(ref, {}, { opponent: { program: ref }, intensity: 'normal' }); } catch (e) { exc = e; }
ok(!exc && Rd && Rd.opponent, 'simulateMatch sans exception', exc ? exc.message : 'jaune ' + S.scoreAt(Rd, Rd.params).total + ' pts (' + Rd.errors.length + ' erreurs), bleu ' + S.scoreAt(Rd.opponent, Rd.opponent.params).total + ' pts (' + Rd.opponent.errors.length + ' erreurs)');
ok(Rd && !Rd.errors.concat(Rd.opponent.errors).some(function (e) { return /Erreur interne/.test(e.msg); }), 'aucune erreur interne dans le duel');
var d = E.makeDuel({ blue: { params: E.blueParams({}) } }), excD = null;
try { d.run({ yellow: E.programAgent(ref.slice(0, 4)), blue: E.programAgent(ref.slice(0, 4).map(E.mirrorStep)) }); d.finish(); } catch (e) { excD = e; }
ok(!excD, 'makeDuel + run sans exception', excD && excD.message);

console.log('\n' + nOk + ' réussis, ' + nKo + ' échoués.');
process.exit(nKo ? 1 : 0);
