/* Simulation du plateau : interface (programme, table 3D, frise, stratégies ou cerveau en direct).
   Le moteur (GEO, ENGINE, SCORE) est chargé depuis /engine/ et tourne aussi dans un Web Worker. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var BrainActs = window.ACTIONS;
  var MATCH = 100;
  /* paramètres par défaut : lus dans le moteur (ENGINE.DEF), jamais recopiés ici */
  var DEF = Object.assign({}, ENGINE.DEF);
  var PIDS = { v: 'pV', va: 'pVA', w: 'pW', vz: 'pVZ', trot: 'pTR', tvac: 'pTV', trel: 'pTL', x0: 'pX0', y0: 'pY0', h0: 'pH0', gx: 'pGX', gy: 'pGY', ga: 'pGA', gs: 'pGS', pgap: 'pPGap', ovl: 'pOvl',
    tMonteeGraal: 'pTMG', tTransfertGraal: 'pTTG', tPoseGraal: 'pTPG', tDegagementGraal: 'pTDG', tSortieFourche: 'pTSF', tDescenteFourche: 'pTDF',
    tx: 'pTX', ty: 'pTY', tirDepuisTrone: 'pTirTrone', bn: 'pBN', brate: 'pBRate', bdep: 'pBDep', bspin: 'pBSpin', bel: 'pBEl', bh: 'pBH', btx: 'pBTx', bmode: 'pBMode',
    bm: 'pBM', bcd: 'pBCd', be: 'pBE', bmu: 'pBMu', bcr: 'pBCr', bdv: 'pBDv', bdaz: 'pBDaz', bdel: 'pBDel', bseed: 'pBSeed' };
  /* paramètres qui peuvent valoir 0 ou être négatifs (angles) */
  var ZERO_OK = ['tvac', 'trel', 'x0', 'y0', 'h0', 'gx', 'gy', 'ga', 'pgap', 'ovl', 'tx', 'ty', 'bn', 'bdep', 'bspin', 'bel', 'be', 'bmu', 'bcr', 'bdv', 'bdaz', 'bdel', 'bseed',
    'tMonteeGraal', 'tTransfertGraal', 'tPoseGraal', 'tDegagementGraal', 'tSortieFourche', 'tDescenteFourche'];
  var ANGLES = ['h0', 'ga'];
  /* programme de référence du moteur (116 pts, 0 erreur) */
  var EXAMPLE = JSON.parse(JSON.stringify(ENGINE.PROGRAMME_REFERENCE));
  var OBSOLETE_PARAMS = ['zmin', 'zmax', 'cl', 'cw'];
  var ACTIONS = [
    ['prendre', 'Prendre (paquet ou pierre)'], ['deposer', 'Déposer en x, y, angle'], ['mur', 'Poser en mur'], ['tour', 'Faire une tour'], ['porte', 'Faire une porte'],
    ['tir', 'Commencer la séance de tir (canon, face C)'], ['monterGraal', 'Monter le Graal (ascenseur, face C)'],
    ['traj', 'Trajectoire (points cliqués)'], ['lacher', 'Lâcher sur place'], ['tourner', 'Tourner la pince (0, 90, 180°)'], ['attendre', 'Attendre (s)'], ['attendreJusqua', 'Attendre jusqu\'à (s)'], ['trone', 'Aller dans la salle du trône']
  ];
  var SHORT = { prendre: 'Prendre', deposer: 'Déposer', mur: 'Mur', tour: 'Tour', porte: 'Porte', tir: 'Tir', monterGraal: 'Monter Graal', traj: 'Trajectoire', lacher: 'Lâcher', tourner: 'Tourner', attendre: 'Attendre', attendreJusqua: 'Attendre jusqu\'à', trone: 'Trône' };
  var ICONS = { prendre: 'fa-hand', deposer: 'fa-location-crosshairs', mur: 'fa-grip-lines', tour: 'fa-chess-rook', porte: 'fa-archway', tir: 'fa-bullseye', monterGraal: 'fa-trophy', traj: 'fa-route', lacher: 'fa-hand-holding', tourner: 'fa-rotate-right', attendre: 'fa-hourglass-half', attendreJusqua: 'fa-clock', trone: 'fa-crown' };
  var FIELDS = { prendre: ['f', 'mode', 'p', 's', 'v', 'tm'], deposer: ['f', 'q', 'xy', 'ang', 'r', 'drop', 'tm'], tourner: ['f', 'r', 'tm'], lacher: ['f', 'q'], traj: ['fa', 'pts'], mur: ['f', 'zm', 'pm', 'side', 'xy', 'ang'], tour: ['f', 'zt', 's', 'pm', 'xy', 'ang', 'tm'], porte: ['f', 'zm', 'pm', 'side', 'xy', 'ang', 'tm'], tir: [], monterGraal: [], attendre: ['sec'], attendreJusqua: ['sec'], trone: [] };
  var PKIDS = ENGINE.PK.map(function (p) { return p.id; }), MIDS = ENGINE.ZM.map(function (z) { return z.id; }), TIDS = ENGINE.ZT.map(function (z) { return z.id; });
  var SIDS = []; PKIDS.forEach(function (p) { for (var l = 1; l <= 3; l++) SIDS.push(p + '.' + l); });
  var prog = [], params = {}, sel = -1;
  var pilot = { mode: 'strategie', slug: '', name: '', layers: null, cfg: null };
  /* angle de pince d'un dépôt (ancien champ o : plat / debout) */
  function rotOf(st) { return st.r != null ? +st.r : st.o === 'debout' ? 90 : 0; }
  /* la case Lâcher n'est disponible que si la face tient une pierre saisie avant */
  function updateDrop() {
    var cb = document.getElementById('cbDrop'); if (!cb || sel < 0 || !prog[sel] || prog[sel].a !== 'deposer') return;
    var inf = R && R.stepInfo[sel], n = inf && inf.held ? inf.held[prog[sel].f] : null;
    cb.disabled = n === 0 && !cb.checked; cb.parentNode.title = n === 0 ? 'Aucune pierre saisie avant cette étape sur la face ' + prog[sel].f : '';
    cb.parentNode.style.opacity = cb.disabled ? '0.5' : '';
  }
  /* champs affichés : la prise montre soit le paquet, soit la pierre et sa ventouse */
  function fieldsOf(st) {
    return (FIELDS[st.a] || []).filter(function (k) {
      /* constructions : position manuelle seulement en mode manuel, côté d'approche seulement en placement parfait */
      if (st.a === 'mur' || st.a === 'tour' || st.a === 'porte') { if ((k === 'xy' || k === 'ang') && st.pm !== 'manuel') return false; if (k === 'side' && st.pm && st.pm !== 'parfait') return false; return true; }
      if (st.a !== 'prendre') return true;
      return st.mode === 'pierre' || st.mode === 'deux' ? k !== 'p' : k !== 's' && k !== 'v';
    });
  }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  var oppChoice = { slug: lsGet('icamlot-opp-slug'), intensity: lsGet('icamlot-opp-int') || 'realiste' };
  if (oppChoice.slug == null) oppChoice.slug = 'exemple';
  var oppLoaded = {};
  function saveOppChoice() {
    lsSet('icamlot-opp-slug', oppChoice.slug || '');
    lsSet('icamlot-opp-int', oppChoice.intensity);
  }

  /* ---------- stockage navigateur (brouillon en cours) ---------- */
  function saveLocal() { if (pilot.mode === 'cerveau') return; lsSet('camelot-prog-v1', JSON.stringify({ params: params, program: prog })); }
  function loadLocal() { try { var j = JSON.parse(lsGet('camelot-prog-v1') || 'null'); if (j && Array.isArray(j.program)) { j.program.forEach(upgradeStep); j.program = j.program.filter(function (x) { return x && x.a !== 'prendreGraal'; }); dropParams(j.params); return j; } } catch (e) {} return null; }
  /* anciens programmes : boulets -> tir ; poserGraal -> monterGraal (prendreGraal n'existe plus : l'étape est retirée) */
  function upgradeStep(st) { if (st && st.a === 'boulets') st.a = 'tir'; if (st && st.a === 'poserGraal') st.a = 'monterGraal'; return st; }
  function dropParams(P) { if (P) OBSOLETE_PARAMS.forEach(function (k) { delete P[k]; }); return P; }

  /* ---------- paramètres ---------- */
  function writeParams() {
    for (var k in PIDS) { var el = $(PIDS[k]); if (!el) continue; if (typeof DEF[k] === 'boolean') el.checked = params[k] !== false; else el.value = params[k]; }
  }
  function readParams() {
    for (var k in PIDS) {
      var el = $(PIDS[k]); if (!el) continue;
      if (typeof DEF[k] === 'boolean') { params[k] = el.checked; continue; }
      if (typeof DEF[k] === 'string') { params[k] = el.value || DEF[k]; continue; }
      var v = parseFloat(el.value), zeroOk = ZERO_OK.indexOf(k) >= 0;
      params[k] = isFinite(v) && (zeroOk ? v >= 0 || ANGLES.indexOf(k) >= 0 : v > 0) ? v : DEF[k];
    }
  }

  /* ---------- annuler / rétablir ---------- */
  var undoS = [], redoS = [], lastSnap = null;
  function snap() { return JSON.stringify({ p: params, g: prog }); }
  function pushHistory() {
    var s = snap();
    if (lastSnap !== null && s !== lastSnap) { undoS.push(lastSnap); if (undoS.length > 150) undoS.shift(); redoS = []; }
    lastSnap = s; updateUndoBtns();
  }
  function restore(s) {
    var o = JSON.parse(s); params = o.p; prog = o.g; lastSnap = s;
    if (sel >= prog.length) sel = prog.length - 1;
    writeParams(); renderSteps(); saveLocal(); updateDirty(); updateUndoBtns();
    clearTimeout(timer); timer = setTimeout(recompute, 150);
  }
  function doUndo() { if (!undoS.length) return; redoS.push(lastSnap); restore(undoS.pop()); toast('Modification annulée'); }
  function doRedo() { if (!redoS.length) return; undoS.push(lastSnap); restore(redoS.pop()); toast('Modification rétablie'); }
  function updateUndoBtns() { $('bUndo').disabled = !undoS.length; $('bRedo').disabled = !redoS.length; }

  var timer = null;
  function changed(rerender) {
    if (pilot.mode === 'cerveau') {
      if (rerender) renderSteps();
      clearTimeout(timer); timer = setTimeout(recompute, 250);
      return;
    }
    if (rerender) renderSteps();
    pushHistory(); saveLocal(); updateDirty();
    clearTimeout(timer); timer = setTimeout(recompute, 250);
  }

  /* ---------- description d'une étape ---------- */
  function pmTxt(st) { return st.pm === 'proche' ? ' · au plus proche' : st.pm === 'manuel' ? ' · manuel (' + Math.round(st.x) + ', ' + Math.round(st.y) + ', ' + fmt(+st.ang || 0) + '°)' : ''; }
  function sideTxt(s) { return s === 'ext' ? ' · de l\'extérieur' : s === 'int' ? ' · de l\'intérieur' : ''; }
  function describe(st) {
    var f = st.f ? ' · face ' + st.f : '';
    switch (st.a) {
      case 'prendre': return st.mode === 'pierre' ? 'Prendre la pierre ' + st.s + f : st.mode === 'deux' ? 'Prendre les 2 pierres du dessus (' + st.s + ' et celle dessous)' + f : 'Prendre ' + st.p + f;
      case 'deposer': var rd = rotOf(st); return 'Déposer ' + (st.q === 'pile' ? 'la pile' : st.q) + ' en ' + Math.round(st.x) + ', ' + Math.round(st.y) + ', ' + fmt(st.ang) + '° · ' + (rd === 90 ? 'debout' : rd === 180 ? 'à plat retournée' : 'à plat') + (st.drop ? ' · lâcher' : '') + f;
      case 'traj': var tp = st.pts || [], la = tp.length ? tp[tp.length - 1] : null;
        return 'Trajectoire : ' + tp.length + ' point' + (tp.length > 1 ? 's' : '') + (la ? ' → ' + Math.round(la.x) + ', ' + Math.round(la.y) + (la.a != null && la.a !== '' ? ', face ' + (st.fa || 'A') + ' à ' + fmt(+la.a) + '°' : '') : '');
      case 'lacher': return 'Lâcher ' + (st.q === 'pile' ? 'la pile' : st.q) + ' sur place' + f;
      case 'tourner': return 'Tourner la pince ' + st.f + ' à ' + (+st.r || 0) + '°' + (st.tm ? ' · pendant le trajet suivant' : '');
      case 'mur': return 'Mur en ' + st.z + pmTxt(st) + f + (st.pm && st.pm !== 'parfait' ? '' : sideTxt(st.side));
      case 'tour': return 'Tour ' + st.z + ' avec ' + st.s + pmTxt(st) + f;
      case 'porte': return 'Porte en ' + st.z + pmTxt(st) + f + (st.pm && st.pm !== 'parfait' ? '' : sideTxt(st.side));
      case 'tir': return 'Séance de tir : salle du trône, face C vers le camp adverse (à partir de 85 s)';
      case 'monterGraal': return 'Monter le Graal sur le toit (ascenseur de la face C, robot dans son château)';
      case 'attendre': return 'Attendre ' + fmt(st.sec) + ' s';
      case 'attendreJusqua': return 'Attendre jusqu\'à ' + fmt(st.sec) + ' s';
      case 'trone': return 'Aller dans la salle du trône';
    }
    return st.a;
  }
  function zoneLabel(id) { var z = ENGINE.zoneById(id); return id + (z && z.name ? ' · ' + z.name : (id[0] === 'T' ? ' · tour' : '')); }
  function defaults(a) {
    var st = { a: a };
    FIELDS[a].forEach(function (k) {
      if (k === 'f') st.f = 'A'; if (k === 'p') st.p = 'P1'; if (k === 'zm') st.z = 'M1'; if (k === 'zt') st.z = 'T1'; if (k === 'zmt') st.z = 'M3';
      if (k === 'side') st.side = 'auto'; if (k === 's') st.s = a === 'prendre' ? 'P1.3' : 'P1.1'; if (k === 'sec') st.sec = a === 'attendreJusqua' ? 85 : 1;
      if (k === 'mode') st.mode = 'paquet'; if (k === 'v') st.v = 'auto'; if (k === 'tm') st.tm = true;
      if (k === 'q') st.q = 'pile'; if (k === 'xy') { if (a === 'deposer') { st.x = 1200; st.y = 1000; } else { st.x = null; st.y = null; } } if (k === 'pm') st.pm = 'parfait'; if (k === 'ang') st.ang = 0;
      if (k === 'r') st.r = a === 'tourner' ? 90 : 0; if (k === 'drop') st.drop = false; if (k === 'fa') st.fa = 'A'; if (k === 'pts') st.pts = [];
    });
    return st;
  }

  /* ---------- éditeur du programme ---------- */
  var stepsEl = $('steps'), dragFrom = -1;
  function opt(sel_, list, val) { list.forEach(function (o) { var e = document.createElement('option'); e.value = o[0]; e.textContent = o[1]; if (o[0] === val) e.selected = true; sel_.appendChild(e); }); }
  function mkSel(label, list, val, onCh) { var s = document.createElement('select'); s.setAttribute('aria-label', label); opt(s, list, val); s.addEventListener('change', function () { onCh(s.value); }); return s; }
  function mkSeg(label, list, val, onCh) {
    var g = document.createElement('div'); g.className = 'segc'; g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
    list.forEach(function (o) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = o[1]; b.setAttribute('aria-pressed', String(o[0] === val));
      b.addEventListener('click', function () { g.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); onCh(o[0]); });
      g.appendChild(b);
    });
    return g;
  }
  function fld(label, ctrl) { var d = document.createElement('div'); d.className = 'fld'; var s = document.createElement('span'); s.textContent = label; d.appendChild(s); d.appendChild(ctrl); return d; }
  function iconBtn(icon, text, title, fn, cls) {
    var b = document.createElement('button'); b.type = 'button'; if (cls) b.className = cls; b.title = title;
    b.innerHTML = '<i class="fa-solid ' + icon + '"></i>' + (text ? '<span>' + text + '</span>' : ''); if (!text) b.setAttribute('aria-label', title);
    b.addEventListener('click', fn); return b;
  }
  function setField(i, k, v) { prog[i][k] = v; changed(); refreshRow(i); }
  function refreshRow(i) { var li = stepsEl.children[i]; if (li) { var t = li.querySelector('.txt'); if (t) t.textContent = describe(prog[i]); } renderTimeline(); }

  /* liste des points d'une trajectoire : x, y, angle facultatif ; clic sur la table pour en ajouter */
  function ptsEditor(st, i) {
    var box = document.createElement('div'); box.className = 'ptsl';
    var P = st.pts || (st.pts = []);
    if (!P.length) { var e0 = document.createElement('div'); e0.className = 'muted'; e0.textContent = 'Aucun point : clique sur la table pour en ajouter.'; box.appendChild(e0); }
    P.forEach(function (q, j) {
      var row = document.createElement('div'); row.className = 'ptr';
      var lb = document.createElement('span'); lb.className = 'muted'; lb.textContent = j === P.length - 1 ? 'Arr.' : String(j + 1); row.appendChild(lb);
      [['x', 'x', 0, 3000], ['y', 'y', 0, 2000], ['a', 'angle', -360, 360]].forEach(function (c) {
        var inp = document.createElement('input'); inp.type = 'number'; inp.step = '5'; inp.min = String(c[2]); inp.max = String(c[3]);
        inp.value = q[c[0]] == null ? '' : q[c[0]]; inp.setAttribute('aria-label', 'Point ' + (j + 1) + ' : ' + c[1]); if (c[0] === 'a') inp.placeholder = 'libre';
        function read() { var v = parseFloat(inp.value); return c[0] === 'a' ? (isFinite(v) ? v : null) : (isFinite(v) ? Math.max(c[2], Math.min(c[3], v)) : q[c[0]]); }
        inp.addEventListener('input', function () { q[c[0]] = read(); updateGhost(); });
        inp.addEventListener('change', function () { q[c[0]] = read(); changed(); refreshRow(i); });
        row.appendChild(inp);
      });
      row.appendChild(iconBtn('fa-arrow-up', '', 'Monter le point', function () { if (j > 0) { P.splice(j - 1, 0, P.splice(j, 1)[0]); changed(true); } }));
      row.appendChild(iconBtn('fa-xmark', '', 'Supprimer le point', function () { P.splice(j, 1); changed(true); }, 'danger'));
      box.appendChild(row);
    });
    if (P.length) box.appendChild(iconBtn('fa-eraser', 'Effacer les points', 'Effacer tous les points', function () { st.pts = []; changed(true); }));
    return box;
  }
  function editor(st, i) {
    var d = document.createElement('div'); d.className = 'sedit';
    d.appendChild(fld('Action', mkSel('Action', ACTIONS, st.a, function (v) { prog[i] = defaults(v); changed(true); })));
    fieldsOf(st).forEach(function (k) {
      if (k === 'f') d.appendChild(fld('Face', mkSeg('Face', [['A', 'Face A'], ['B', 'Face B']], st.f, function (v) { setField(i, 'f', v); })));
      if (k === 'p') d.appendChild(fld('Paquet', mkSel('Paquet', PKIDS.map(function (p) { return [p, p]; }), st.p, function (v) { setField(i, 'p', v); })));
      if (k === 'zm') d.appendChild(fld('Zone', mkSel('Zone de mur', MIDS.map(function (z) { return [z, zoneLabel(z)]; }), st.z, function (v) { setField(i, 'z', v); })));
      if (k === 'zt') d.appendChild(fld('Tour', mkSel('Tour', TIDS.map(function (z) { return [z, z]; }), st.z, function (v) { setField(i, 'z', v); })));
      if (k === 'zmt') d.appendChild(fld('Sur', mkSel('Construction', MIDS.concat(TIDS).map(function (z) { return [z, zoneLabel(z)]; }), st.z, function (v) { setField(i, 'z', v); })));
      if (k === 'side') d.appendChild(fld('Côté', mkSeg('Côté', [['auto', 'Auto'], ['ext', 'Extérieur'], ['int', 'Intérieur']], st.side, function (v) { setField(i, 'side', v); })));
      if (k === 's') d.appendChild(fld(st.mode === 'deux' ? 'Dessus' : 'Pierre', mkSel('Pierre', SIDS.map(function (p) { return [p, 'Pierre ' + p]; }), st.s, function (v) { setField(i, 's', v); })));
      if (k === 'mode') d.appendChild(fld('Prendre', mkSeg('Prendre', [['paquet', 'Paquet (3)'], ['deux', 'Deux du dessus'], ['pierre', 'Une pierre (dessus)']], st.mode || 'paquet', function (v) { prog[i].mode = v; changed(true); })));
      if (k === 'v') d.appendChild(fld('Ventouse', mkSel('Ventouse', [['auto', 'Auto (pince au plus près de 165 mm)'], ['1', 'Ventouse 1 (bas)'], ['2', 'Ventouse 2 (milieu)'], ['3', 'Ventouse 3 (haut)']], st.v || 'auto', function (v) { setField(i, 'v', v); })));
      if (k === 'q') d.appendChild(fld('Quoi', mkSel('Pierres déposées', [['pile', 'Toute la pile tenue']].concat(SIDS.map(function (p) { return [p, 'Pierre ' + p]; })), st.q, function (v) { setField(i, 'q', v); })));
      if (k === 'r') d.appendChild(fld(st.a === 'tourner' ? 'Angle' : 'Pince', mkSeg('Angle de la pince', st.a === 'tourner' ? [['0', '0°'], ['90', '90°'], ['180', '180°']] : [['0', '0° à plat'], ['90', '90° debout'], ['180', '180° retournée']], String(rotOf(st)), function (v) { delete prog[i].o; setField(i, 'r', +v); })));
      if (k === 'pm') d.appendChild(fld('Placement', mkSeg('Placement de la construction', [['parfait', 'Parfait'], ['proche', 'Au plus proche'], ['manuel', 'Manuel']], st.pm || 'parfait', function (v) {
        var q = prog[i]; q.pm = v;
        if (v === 'manuel' && (q.x == null || q.y == null)) { var zz = ENGINE.zoneById(q.z); q.x = zz ? Math.round(zz.c[0]) : 1200; q.y = zz ? Math.round(zz.c[1]) : 1000; q.ang = zz && zz.tan !== undefined ? zz.tan : 0; }
        changed(true);
      })));
      if (k === 'fa') d.appendChild(fld('Angles de', mkSeg('Face orientée par les angles', [['A', 'Face A'], ['B', 'Face B'], ['C', 'Face C']], st.fa || 'A', function (v) { setField(i, 'fa', v); })));
      if (k === 'pts') d.appendChild(fld('Points', ptsEditor(st, i)));
      if (k === 'drop') {
        var lbd = document.createElement('label'); lbd.className = 'chk';
        var cbd = document.createElement('input'); cbd.type = 'checkbox'; cbd.id = 'cbDrop'; cbd.checked = !!st.drop;
        cbd.addEventListener('change', function () { setField(i, 'drop', cbd.checked); });
        lbd.appendChild(cbd); lbd.appendChild(document.createTextNode(' Lâcher : si la pince ne descend pas assez, la pierre tombe (à plat seulement)'));
        d.appendChild(lbd); setTimeout(updateDrop, 0);
      }
      if (k === 'xy' || k === 'ang') {
        var w2 = document.createElement('div'); w2.className = 'crow';
        (k === 'xy' ? [['x', 'x', 0, 3000, 5, 'mm'], ['y', 'y', 0, 2000, 5, 'mm']] : [['ang', 'Angle', -360, 360, 5, '°']]).forEach(function (q) {
          var inp2 = document.createElement('input'); inp2.type = 'number'; inp2.min = String(q[2]); inp2.max = String(q[3]); inp2.step = String(q[4]); inp2.value = st[q[0]]; inp2.setAttribute('aria-label', q[1] + ' (' + q[5] + ')');
          /* la prévisualisation suit la saisie, le calcul est relancé à la validation */
          inp2.addEventListener('input', function () { var v = parseFloat(inp2.value); if (isFinite(v)) { prog[i][q[0]] = v; updateGhost(); } });
          inp2.addEventListener('change', function () { var v = parseFloat(inp2.value); setField(i, q[0], isFinite(v) ? Math.max(q[2], Math.min(q[3], v)) : 0); inp2.value = prog[i][q[0]]; });
          var u2 = document.createElement('span'); u2.className = 'muted'; u2.textContent = (k === 'xy' ? q[1] + ' ' : '') + q[5];
          if (k === 'xy') w2.appendChild(u2); w2.appendChild(inp2); if (k !== 'xy') w2.appendChild(u2);
        });
        d.appendChild(fld(k === 'xy' ? 'Position' : 'Angle', w2));
        if (k === 'ang') { var nt = document.createElement('div'); nt.className = 'muted'; nt.style.fontSize = '12px'; nt.textContent = st.a === 'deposer' ? 'Angle du grand côté de la pierre (ou de la rangée debout) : 0° le long de x, positif vers +y, comme l\'orientation de départ.' : 'Centre de la construction et angle de son grand côté (mur, rangée des piliers) : 0° le long de x, positif vers +y. Hors de la zone : avertissement, pas de points.'; d.appendChild(nt); }
      }
      if (k === 'tm') {
        var lb = document.createElement('label'); lb.className = 'chk';
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!st.tm;
        cb.addEventListener('change', function () { setField(i, 'tm', cb.checked); });
        lb.appendChild(cb); lb.appendChild(document.createTextNode(st.a === 'tourner' ? ' Temps masqué : la rotation se fait pendant le prochain trajet' : ' Temps masqué : la pince monte, descend et tourne pendant le trajet'));
        d.appendChild(lb);
      }
      if (k === 'sec') {
        var w = document.createElement('div'); w.className = 'crow';
        var inp = document.createElement('input'); inp.type = 'number'; inp.min = '0'; inp.step = '0.5'; inp.value = st.sec; inp.setAttribute('aria-label', 'Secondes');
        inp.addEventListener('change', function () { setField(i, 'sec', Math.max(0, parseFloat(inp.value) || 0)); });
        var u = document.createElement('span'); u.className = 'muted'; u.textContent = 's';
        w.appendChild(inp); w.appendChild(u); d.appendChild(fld(st.a === 'attendre' ? 'Durée' : 'Jusqu\'à', w));
      }
    });
    var kinds = targetKinds(st);
    if (kinds.length) { var h = document.createElement('div'); h.className = 'hintp'; h.innerHTML = '<i class="fa-solid fa-hand-pointer"></i>'; h.appendChild(document.createTextNode(pickText(kinds))); d.appendChild(h); }
    var a = document.createElement('div'); a.className = 'sacts';
    a.appendChild(iconBtn('fa-arrow-up', '', 'Monter (Alt+↑)', function () { moveStep(i, -1); }));
    a.appendChild(iconBtn('fa-arrow-down', '', 'Descendre (Alt+↓)', function () { moveStep(i, 1); }));
    a.appendChild(iconBtn('fa-clone', 'Dupliquer', 'Dupliquer (Ctrl+D)', function () { dupStep(i); }));
    a.appendChild(iconBtn('fa-trash-can', 'Supprimer', 'Supprimer (Suppr)', function () { delStep(i); }, 'danger'));
    d.appendChild(a);
    return d;
  }

  function renderSteps() {
    stepsEl.innerHTML = '';
    if (sel >= prog.length) sel = prog.length - 1;
    var live = pilot.mode === 'cerveau';
    prog.forEach(function (st, i) {
      var li = document.createElement('li'); li.className = 'step' + (i === sel ? ' sel' : ''); li.draggable = !live; li.dataset.i = i;
      var row = document.createElement('div'); row.className = 'srow';
      row.innerHTML = '<span class="grip" title="Glisser pour déplacer">⋮⋮</span><span class="num">' + (i + 1) + '</span><i class="ico fa-solid ' + ICONS[st.a] + '"></i><span class="txt"></span><span class="tm" id="tm' + i + '"></span>';
      row.querySelector('.txt').textContent = describe(st);
      row.addEventListener('click', function () { select(i === sel ? -1 : i, true); });
      li.appendChild(row);
      var er = document.createElement('div'); er.className = 'serr'; er.id = 'er' + i; er.hidden = true; li.appendChild(er);
      if (!live && i === sel) li.appendChild(editor(st, i));
      if (!live) {
        li.addEventListener('dragstart', function (e) { dragFrom = i; li.classList.add('drag'); try { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; } catch (x) {} });
        li.addEventListener('dragend', function () { li.classList.remove('drag'); });
        li.addEventListener('dragover', function (e) { e.preventDefault(); li.classList.add('over'); });
        li.addEventListener('dragleave', function () { li.classList.remove('over'); });
        li.addEventListener('drop', function (e) {
          e.preventDefault(); li.classList.remove('over'); if (dragFrom < 0 || dragFrom === i) return;
          var m = prog.splice(dragFrom, 1)[0]; prog.splice(i, 0, m); if (sel === dragFrom) sel = i; dragFrom = -1; changed(true);
        });
      }
      stepsEl.appendChild(li);
    });
    if (!prog.length) {
      stepsEl.innerHTML = live
        ? '<li class="empty"><b>Aucune décision</b>Charge un cerveau : il choisit chaque action d\'après l\'état de la table, jusqu\'à 100 s.</li>'
        : '<li class="empty"><b>Programme vide</b>Ajoute une première étape avec les boutons du bas, ou charge l\'exemple.</li>';
    }
    $('palLab').textContent = live ? 'Décisions du réseau (lecture seule)' : (sel >= 0 ? 'Ajouter après l\'étape ' + (sel + 1) : 'Ajouter à la fin');
    lastPlayIdx = -2;
    showStepInfo(); renderTimeline(); updatePick();
  }
  function showStepInfo() {
    if (!R) return;
    prog.forEach(function (st, i) {
      var inf = R.stepInfo[i], tm = $('tm' + i), er = $('er' + i); if (!inf || !tm) return;
      tm.textContent = fmt(inf.t0) + '–' + fmt(inf.t1) + ' s';
      tm.className = 'tm' + (inf.t1 > MATCH ? ' bad' : '');
      tm.parentNode.parentNode.classList.toggle('err', !!inf.err);
      if (inf.err) { er.textContent = inf.err; er.hidden = false; } else er.hidden = true;
    });
  }
  function select(i, jump) {
    sel = i; renderSteps();
    if (jump && i >= 0 && R && R.stepInfo[i]) time = R.stepInfo[i].t0 + 0.01;
    var li = stepsEl.children[i]; if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
  }
  function moveStep(i, d) {
    var j = i + d; if (i < 0 || j < 0 || j >= prog.length) return;
    var t = prog[j]; prog[j] = prog[i]; prog[i] = t; sel = j; changed(true);
  }
  function dupStep(i) { if (i < 0) return; prog.splice(i + 1, 0, JSON.parse(JSON.stringify(prog[i]))); sel = i + 1; changed(true); toast('Étape dupliquée'); }
  function delStep(i) {
    if (i < 0) return; prog.splice(i, 1); sel = Math.min(i, prog.length - 1); changed(true);
    toast('Étape ' + (i + 1) + ' supprimée', '', [['Annuler', doUndo]]);
  }
  function addStep(a) {
    var at = sel >= 0 ? sel + 1 : prog.length;
    prog.splice(at, 0, defaults(a)); sel = at; changed(true);
    var li = stepsEl.children[at]; if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
  }
  (function () {
    var g = $('palGrid');
    ACTIONS.forEach(function (a) {
      var b = document.createElement('button'); b.type = 'button'; b.title = a[1];
      b.innerHTML = '<i class="fa-solid ' + ICONS[a[0]] + '"></i><span></span>'; b.querySelector('span').textContent = SHORT[a[0]];
      b.addEventListener('click', function () { addStep(a[0]); });
      g.appendChild(b);
    });
  })();

  /* ---------- calcul (Web Worker si possible) ---------- */
  var worker = null, reqId = 0, R = null;
  /* le Web Worker charge le même moteur que la page (adresses des balises <script>, version comprise) */
  function scriptUrl(name) { var s = document.querySelector('script[src*="' + name + '"]'); return s ? s.src : '../' + name; }
  var workerSrc = Promise.all([fetch(scriptUrl('spec/spec.js')), fetch(scriptUrl('engine/geom.js')), fetch(scriptUrl('engine/engine.js'))]).then(function (rs) {
    return Promise.all(rs.map(function (r) { if (!r.ok) throw new Error('script ' + r.url); return r.text(); }));
  }).then(function (src) {
    return src[0] + '\n' + src[1] + '\n' + src[2] + '\nonmessage=function(e){var r=ENGINE.simulateMatch(e.data.prog,e.data.P,{opponent:e.data.opponent,intensity:e.data.intensity});var opp=r.opponent||null;if(opp){delete opp.poseAt;delete opp.stoneAt;}r.opponent=null;delete r.poseAt;delete r.stoneAt;postMessage({id:e.data.id,r:r,opp:opp});};';
  });
  workerSrc.then(function (code) {
    try {
      worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
      worker.onmessage = function (e) { if (e.data.id === reqId) accept(e.data.r, e.data.opp); };
      worker.onerror = function () { worker = null; };
    } catch (e) { worker = null; }
  }, function () { worker = null; });
  /* adversaire : { name, program, params } (stratégie) ou { name, brain: { layers, acts, entrees, familles } } (cerveau) */
  function currentOpponent() {
    if (!oppChoice.slug) return null;
    if (oppChoice.slug === 'exemple') return { name: 'Exemple', program: EXAMPLE, params: params };
    if (oppChoice.slug.indexOf('robot:') === 0) { var rid = oppChoice.slug.slice(6), pr = ADVERSAIRES.PROFILS[rid]; return pr ? { name: 'Robot · ' + pr.nom, robot: rid } : null; }
    return oppLoaded[oppChoice.slug] || null;
  }
  function currentOpponentName() { var o = currentOpponent(); return o && o.name; }
  /* un cerveau récurrent garde un état caché : un nouvel agent (état à zéro) pour chaque match simulé */
  function freshBrain(b) {
    if (!b || !b.model) return b;
    var nb = Object.assign({}, b);
    nb.choose = window.RUNTIME.chooser(b.model, brainExpect(b));
    return nb;
  }
  function brainExpect(b) {
    var cat = BrainActs.filterByFamilles(b.familles);
    return { nIn: window.ENV.nInputs(b.entrees), nOut: cat.length, obsVersion: window.ENV.OBS_VERSION, catalogueVersion: BrainActs.CATALOGUE_VERSION };
  }
  function oppData(o) { return o ? (o.brain ? { name: o.name, brain: freshBrain(o.brain), params: o.params || params } : { name: o.name, program: o.program, params: o.params || params }) : null; }
  /* cerveau ou stratégie manquante : chargée depuis le serveur, puis on relance fn */
  function ensureOpponent(fn) {
    var slug = oppChoice.slug;
    if (!slug || slug === 'exemple' || oppLoaded[slug]) return false;
    if (slug.indexOf('robot:') === 0) {
      /* robot adverse « réseau » : modèle figé chargé une fois depuis le serveur (.data/adversaires) */
      var pr = ADVERSAIRES.PROFILS[slug.slice(6)];
      if (!pr || pr.type !== 'reseau' || ADVERSAIRES.modele(pr.modele)) return false;
      api('GET', '../api/adversaires/' + pr.id + '/modele').then(function (j) { ADVERSAIRES.enregistrerModele(pr.modele, j); fn(); },
        function (e) { toast('Robot ' + pr.nom + ' : ' + e.message, 'bad'); oppChoice.slug = ''; saveOppChoice(); fillOppSelect(); fn(); });
      return true;
    }
    if (slug.indexOf('cerveau:') === 0) {
      loadOppBrain(slug.slice(8)).then(fn, function () { oppChoice.slug = ''; saveOppChoice(); fillOppSelect(); fn(); });
    } else {
      api('GET', API + '/' + slug).then(function (j) {
        oppLoaded[slug] = { name: j.name, program: j.program, params: j.params || params };
        fn();
      }, function () { oppChoice.slug = ''; saveOppChoice(); fn(); });
    }
    return true;
  }
  function recompute() {
    readParams(); $('busy').hidden = false;
    if (ensureOpponent(recompute)) return;
    var opp = currentOpponent();
    /* robot adverse (engine/adversaires.js) : joué dans la page (le worker ne rejoue que des programmes) */
    if (opp && opp.robot) return recomputeRobot(opp);
    /* un cerveau (le nôtre ou celui d'en face) décide en direct : le moteur joue les deux robots, puis la page rejoue le tout */
    if (pilot.mode === 'cerveau' || (opp && opp.brain)) return recomputeLive(opp);
    var data = { prog: JSON.parse(JSON.stringify(prog)), P: paramsMatch(), id: ++reqId, opponent: oppData(opp), intensity: opp ? oppChoice.intensity : 'aucun' };
    if (worker) worker.postMessage(data);
    else setTimeout(function () { var r = ENGINE.simulateMatch(data.prog, data.P, { opponent: data.opponent, intensity: data.intensity }); accept(r, r.opponent); }, 0);
  }
  /* rejeu : notre programme et ce que l'adversaire a joué, avec contacts et trajectoires */
  function simulateProg(list, oppProg) {
    var opp = currentOpponent();
    var o = opp ? { name: opp.name, program: oppProg || opp.program, params: opp.params || params } : null;
    var data = { prog: JSON.parse(JSON.stringify(list)), P: paramsMatch(), id: ++reqId, opponent: o, intensity: opp ? oppChoice.intensity : 'aucun' };
    if (worker) worker.postMessage(data);
    else setTimeout(function () { var r = ENGINE.simulateMatch(data.prog, data.P, { opponent: data.opponent, intensity: data.intensity }); accept(r, r.opponent); }, 0);
  }
  /* cerveau : modèle récurrent (poids v2) ou MLP (layers) ; tout est lu dans le fichier de poids et la configuration */
  function brainSpec(name, layers, cfg, weights) {
    var familles = (cfg.actions && cfg.actions.familles) || BrainActs.FAMILLES.map(function (f) { return f.id; });
    var acts = ((cfg.reseau && cfg.reseau.couches) || []).map(function (c) { return c.activation; });
    var model = window.RUNTIME ? window.RUNTIME.modeleDe(weights) : null;
    return {
      name: name,
      brain: {
        layers: Array.isArray(layers) ? layers : (layers && layers.layers) || [],
        acts: acts,
        entrees: cfg.entrees || window.ENV.GROUPS.map(function (g) { return g.id; }),
        familles: familles,
        model: model
      }
    };
  }
  function recomputeLive(opp) {
    if (!window.ENV || !window.NET || !window.RUNTIME || !BrainActs) {
      $('busy').hidden = true;
      toast('Moteur du cerveau introuvable.', 'bad');
      return;
    }
    if (pilot.mode === 'cerveau' && (!pilot.layers || !pilot.cfg)) {
      $('busy').hidden = true;
      toast('Charge un cerveau depuis le tiroir Cerveaux.', 'bad');
      return;
    }
    setTimeout(function () {
      try {
        var inten = opp ? oppChoice.intensity : 'aucun', oppSpec = oppData(opp), ours, theirs;
        if (pilot.mode === 'cerveau') {
          var bs = brainSpec(pilot.name, pilot.layers, pilot.cfg, pilot.weights);
          var env = window.ENV.create({ entrees: bs.brain.entrees, familles: bs.brain.familles, params: params, adversaire: { intensite: inten }, skipContacts: false, onError: 'penalite', filterSafety: true });
          var chooser = bs.brain.model
            ? window.RUNTIME.chooser(bs.brain.model, { nIn: env.nInputs, nOut: env.nOutputs, obsVersion: window.ENV.OBS_VERSION, catalogueVersion: BrainActs.CATALOGUE_VERSION })
            : window.ENV.chooserFromLayers(bs.brain.layers, bs.brain.acts);
          env.play(chooser, { params: params, intensite: inten, opponent: oppSpec, filterSafety: true });
          ours = env.program(); theirs = env.opponentProgram();
        } else {
          var pm = window.ENV.playProgram(prog, params, oppSpec, inten, false);
          ours = pm.program; theirs = pm.opponentProgram;
        }
        if (pilot.mode === 'cerveau') { prog = ours; sel = -1; lastSnap = snap(); renderSteps(); }
        simulateProg(ours, opp ? theirs : null);
      } catch (e) {
        $('busy').hidden = true;
        toast('Lecture du cerveau impossible : ' + e.message, 'bad');
      }
    }, 0);
  }
  /* ---------- caractéristiques physiques du match (contrat §14) : notre robot (tirées par la graine ou fixées), adversaire ---------- */
  var phyFixe = {}, oppFixe = {}, phyLast = null;
  function phyReglages() { return { actif: !!($('mPhyTir') && $('mPhyTir').checked), valeurs: Object.assign({}, phyFixe), plages: (function () { var p = {}; Object.keys(phyFixe).forEach(function (k) { p[k] = 0; }); return p; })() }; }
  function matchSeed() { var v = $('mSeed') ? parseInt($('mSeed').value, 10) : 1; return isNaN(v) ? 1 : v; }
  function paramsMatch() {
    var ph = ADVERSAIRES.tirerPhysique(matchSeed(), phyReglages());
    phyLast = { notre: ph.valeurs, adversaire: null };
    return Object.assign({}, params, ph.params, { seed: matchSeed() });
  }
  function recomputeRobot(opp) {
    setTimeout(function () {
      try {
        var P = paramsMatch(), spec = { robot: opp.robot, fixe: Object.assign({}, oppFixe) }, ours, res;
        if (pilot.mode === 'cerveau') {
          if (!pilot.layers || !pilot.cfg) { $('busy').hidden = true; toast('Charge un cerveau depuis le tiroir Cerveaux.', 'bad'); return; }
          var bs = brainSpec(pilot.name, pilot.layers, pilot.cfg, pilot.weights);
          var env = window.ENV.create({ entrees: bs.brain.entrees, familles: bs.brain.familles, params: P, skipContacts: false, onError: 'penalite' });
          var chooser = bs.brain.model ? window.RUNTIME.chooser(bs.brain.model, { nIn: env.nInputs, nOut: env.nOutputs, obsVersion: window.ENV.OBS_VERSION, catalogueVersion: BrainActs.CATALOGUE_VERSION }) : window.ENV.chooserFromLayers(bs.brain.layers, bs.brain.acts);
          env.play(chooser, { params: P, seed: matchSeed(), intensite: 'realiste', opponent: spec, filterSafety: true });
          prog = env.program(); sel = -1; lastSnap = snap(); renderSteps();
          res = env.result(); phyLast.adversaire = env.physique().adversaire;
        } else {
          var pm = window.ENV.playProgram(prog, P, spec, 'realiste', false);
          res = pm.result; phyLast.adversaire = pm.adversaire;
        }
        var opR = res.opponent; res.opponent = null;
        accept(res, opR);
        renderPhy();
      } catch (e) { $('busy').hidden = true; toast('Match contre le robot adverse impossible : ' + e.message, 'bad'); }
    }, 0);
  }
  function renderPhy() {
    var tb = document.querySelector('#mPhyTab tbody'), to = document.querySelector('#mPhyOpp tbody'); if (!tb) return;
    var last = phyLast || {}, nv = last.notre || {};
    tb.innerHTML = '';
    ADVERSAIRES.PHYSIQUE.forEach(function (d) {
      var tr = document.createElement('tr'), v = nv[d.id] != null ? nv[d.id] : d.nominal;
      tr.innerHTML = '<td>' + esc(d.nom) + ' <small>(' + esc(d.unite) + ', ' + esc(d.statut === 'declare' ? 'déclaré' : d.statut === 'herite' ? 'hérité' : d.statut) + ')</small></td><td style="text-align:right">' + (Math.round(v * 1000) / 1000) + '</td><td><input type="number" step="any" style="width:70px"></td>';
      var inp = tr.querySelector('input'); if (phyFixe[d.id] != null) inp.value = phyFixe[d.id];
      inp.addEventListener('change', function () { var x = parseFloat(inp.value); if (isNaN(x)) delete phyFixe[d.id]; else phyFixe[d.id] = x; });
      tb.appendChild(tr);
    });
    to.innerHTML = '';
    var a = last.adversaire;
    if (!a) { to.innerHTML = '<tr><td colspan="3" class="note">Choisir un robot adverse (Robot) pour voir ses caractéristiques tirées.</td></tr>'; return; }
    var keys = a.phys ? Object.keys(a.phys).map(function (k) { return [k, a.phys[k], (ADVERSAIRES.physDesc(k) || {}).nom || k]; })
      : [['forme', a.forme, 'Empreinte'], ['perimetre', a.perimetre, 'Périmètre (mm)'], ['v', a.v, 'Vitesse (mm/s)'], ['w', a.w, 'Rotation (°/s)'], ['tPrise', a.tPrise, 'Prise (s)'], ['tPose', a.tPose, 'Pose par pierre (s)'], ['tGraal', a.tGraal, 'Montée du Graal (s)'], ['dArret', a.dArret, 'Distance d\'arrêt (mm)'], ['precision', a.precision, 'Précision du tir'], ['capacite', a.capacite, 'Capacité (pierres)']];
    keys.forEach(function (k) {
      var tr = document.createElement('tr'), v = typeof k[1] === 'number' ? Math.round(k[1] * 1000) / 1000 : k[1];
      tr.innerHTML = '<td>' + esc(k[2]) + '</td><td style="text-align:right">' + esc(String(v)) + '</td><td>' + (k[0] === 'forme' ? '<select><option value="">tirée</option><option>rond</option><option>rectangle</option><option>triangle</option></select>' : '<input type="number" step="any" style="width:70px">') + '</td>';
      var inp = tr.querySelector('input,select'); if (oppFixe[k[0]] != null) inp.value = oppFixe[k[0]];
      inp.addEventListener('change', function () { var x = k[0] === 'forme' ? inp.value : parseFloat(inp.value); if (x === '' || (typeof x === 'number' && isNaN(x))) delete oppFixe[k[0]]; else oppFixe[k[0]] = x; });
      to.appendChild(tr);
    });
  }
  /* robot adverse abstrait : poses interpolées linéairement (points clés { t, x, y, h }) */
  function poseAbstraite(K, t) {
    if (t <= K[0].t) return K[0];
    var lo = 0, hi = K.length - 1; if (t >= K[hi].t) return K[hi];
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (K[mid].t < t) lo = mid; else hi = mid; }
    var a = K[hi - 1], b = K[hi], k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
    return { t: t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, h: a.h + (b.h - a.h) * k };
  }
  function attachAt(res) {
    if (!res) return res;
    if (res.abstrait) { res.poseAt = function (t) { return poseAbstraite(res.K, t); }; return res; }
    res.poseAt = function (t) { return ENGINE.poseAtK(res.K, t); };
    res.stoneAt = function (st, t) { var e = st.tl[0]; for (var i = 0; i < st.tl.length; i++) if (st.tl[i].t <= t) e = st.tl[i]; return e; };
    return res;
  }
  function accept(r, opp) {
    attachAt(r);
    r.opponent = attachAt(opp || r.opponent || null);
    R = r; $('busy').hidden = true; updateDrop();
    R.outZone = {}; try { var oz = outcome(Math.min(R.T, MATCH)); R.stones.forEach(function (st) { if (/^[wtpl]/.test(st.tag || '') && oz.fin[st.id] && !oz.fin[st.id].home && !oz.inZ[st.id]) R.outZone[st.id] = 1; }); } catch (x) {}
    TEND = Math.max(MATCH, Math.ceil(R.T + 1));
    $('track').setAttribute('aria-valuemax', String(TEND));
    var tot = $('tot'), nErr = R.errors.length;
    tot.textContent = 'Durée ' + fmt(R.T) + ' s' + (R.T <= MATCH ? '' : ' (+' + fmt(R.T - MATCH) + ' s)') + (nErr ? ' · ' + nErr + ' erreur' + (nErr > 1 ? 's' : '') + ' moteur' : '');
    tot.className = 'tot ' + (R.T <= MATCH && !nErr ? 'ok' : 'bad');
    showStepInfo(); buildTrail(); buildOppTrail(); buildShots(); computeBad(); drawStrip(); renderResults(); renderAlerts(); renderTimeline();
    if (them) them.group.visible = !!R.opponent && !R.opponent.abstrait;
    buildAbstrait(R.opponent && R.opponent.abstrait ? R.opponent : null);
    if (time > TEND) time = TEND;
  }

  /* ---------- géométrie / score (modules partagés : engine/score.js) ---------- */
  var BARS = SCORE.BARS;
  function gripTop(g) { return SCORE.gripTop(g); }
  function hullPer(P) { return SCORE.hullPer(P); }
  function inCastle(x, y) { return SCORE.inCastle(x, y); }
  var countPer = true;
  function graalAt(t) { return SCORE.graalAt(R, t); }
  function graalPos(t) { return SCORE.graalPos(R, params, t); }
  function checks(t) { return SCORE.checks(R, params, t, countPer); }

  /* ---------- scène ---------- */
  var canvas = $('view'), gl;
  try { gl = new THREE.WebGLRenderer({ canvas: canvas, antialias: true }); }
  catch (e) { canvas.insertAdjacentHTML('afterend', '<p style="padding:16px">Le rendu 3D n\'est pas disponible dans ce navigateur. Le programme et les résultats restent calculés.</p>'); gl = null; }
  var scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, 10, 20000), controls = null;
  if (gl) {
    gl.outputEncoding = THREE.sRGBEncoding; gl.shadowMap.enabled = true; gl.shadowMap.type = THREE.PCFSoftShadowMap; gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    controls = new THREE.OrbitControls(camera, canvas); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 300; controls.maxDistance = 9000;
  }
  /* cadre la table selon la forme de l'écran : en hauteur (téléphone), son long côté passe à la verticale, notre côté (jaune) en bas */
  var camPortrait = null, camMoved = false;
  if (controls) controls.addEventListener('start', function () { camMoved = true; });
  function setCam(name) {
    if (name === 'follow' || !controls) return;
    camMoved = false;
    var a = camera.aspect || 1.6, portrait = a < 1, tv = Math.tan(camera.fov * Math.PI / 360), th = tv * a;
    var ew = portrait ? 2300 : 3300, eh = portrait ? 3300 : 2300, d = Math.max(eh / 2 / tv, ew / 2 / th);
    camPortrait = portrait;
    if (name === 'top') { camera.position.set(portrait ? -1 : 0, d, portrait ? 0 : 1); controls.target.set(0, 0, 0); }
    else {
      /* vue inclinée : la profondeur de la table est vue raccourcie, plus la hauteur des pierres */
      var el = 46 * Math.PI / 180, depth = portrait ? 3300 : 2300;
      var D = Math.max((depth * Math.sin(el) + 500 * Math.cos(el)) / 2 / tv, ew / 2 / th) * 1.2, h = Math.cos(el) * D;
      if (portrait) { controls.target.set(-300, 0, 0); camera.position.set(-300 - h, Math.sin(el) * D, 0); }
      else { controls.target.set(0, 0, 300); camera.position.set(0, Math.sin(el) * D, 300 + h); }
    }
    controls.update();
  }
  setCam('table');
  scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--stage').trim() || '#13151c');
  scene.add(new THREE.HemisphereLight(0xffffff, 0x606a78, 0.9));
  var sun = new THREE.DirectionalLight(0xffffff, 0.7); sun.position.set(800, 3000, 1600); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  var sc = sun.shadow.camera; sc.left = -1700; sc.right = 1700; sc.top = 1200; sc.bottom = -1200; sc.near = 100; sc.far = 8000; scene.add(sun);
  function W(x, y) { return [x - 1500, y - 1000]; }
  function mat(c, r, m) { return new THREE.MeshStandardMaterial({ color: c, roughness: r == null ? 0.7 : r, metalness: m == null ? 0.1 : m }); }
  function box(w, h, d, m) { var o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.castShadow = o.receiveShadow = true; return o; }
  function cyl(rt, rb, h, m, seg) { var o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 28), m); o.castShadow = o.receiveShadow = true; return o; }
  var tex = new THREE.TextureLoader().load('table.jpg');
  tex.encoding = THREE.sRGBEncoding; if (gl) tex.anisotropy = gl.capabilities.getMaxAnisotropy();
  var topM = new THREE.Mesh(new THREE.PlaneGeometry(3000, 2000), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 })); topM.rotation.x = -Math.PI / 2; topM.receiveShadow = true; scene.add(topM);
  var under = box(3044, 40, 2044, mat(0x6b5a45, 0.9, 0)); under.position.set(0, -20.5, 0); scene.add(under);
  var grey = mat(0xb5b0a1, 0.8, 0);
  [[0, -1011, 3044, 22], [0, 1011, 3044, 22], [-1511, 0, 22, 2000], [1511, 0, 22, 2000]].forEach(function (b) { var m = box(b[2], 70, b[3], grey); m.position.set(b[0], 35, b[1]); scene.add(m); });

  /* repères (cliquables pour remplir l'étape sélectionnée) */
  var labels = new THREE.Group(); scene.add(labels);
  var markers = [];
  function label(text, x, y, z, flat, color, kind) {
    var c = document.createElement('canvas'); c.width = 256; c.height = 128; var g = c.getContext('2d');
    g.fillStyle = 'rgba(20,24,32,0.82)'; g.beginPath(); g.moveTo(20, 8); g.arcTo(248, 8, 248, 120, 18); g.arcTo(248, 120, 8, 120, 18); g.arcTo(8, 120, 8, 8, 18); g.arcTo(8, 8, 248, 8, 18); g.fill();
    g.fillStyle = color || '#ffffff'; g.font = 'bold 64px "IBM Plex Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 66);
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    var m;
    if (flat) { m = new THREE.Mesh(new THREE.PlaneGeometry(130, 65), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, 3, z); }
    else { m = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); m.scale.set(150, 75, 1); m.position.set(x, y, z); m.renderOrder = 10; }
    m.userData = { kind: kind, id: text, base: m.scale.clone() };
    labels.add(m); markers.push(m);
  }
  ENGINE.PK.forEach(function (p) { var w = W(p.x, p.y); label(p.id, w[0], 470, w[1], false, '#ffd36b', 'P'); });
  ENGINE.ZM.forEach(function (z) { var w = W(z.c[0], z.c[1]), n = nv(z.nin); label(z.id, w[0] + n[0] * 150, 0, w[1] + n[1] * 150, true, null, 'M'); });
  ENGINE.ZT.forEach(function (z) { var w = W(z.c[0], z.c[1]); label(z.id, w[0], 0, w[1] + 150, true, '#9fd1ff', 'T'); });

  /* pierres */
  var stoneMat = [mat(0xc39a66, 0.9, 0), mat(0xb68c5a, 0.9, 0), mat(0xa98050, 0.9, 0)];
  var edgeMat = new THREE.LineBasicMaterial({ color: 0x6d4e2b }), tagMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  var stoneMeshes = [];
  ENGINE.PK.forEach(function (pk, qi) {
    for (var l = 0; l < 3; l++) {
      var m = box(320, 110, 110, stoneMat[l].clone());
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), edgeMat));
      [55.5, -55.5].forEach(function (z) { var t = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), tagMat); t.position.z = z; if (z < 0) t.rotation.y = Math.PI; m.add(t); });
      var w = W(pk.x, pk.y); m.userData = { home: { x: w[0], y: 55 + 110 * l, z: w[1], ry: pk.tan ? Math.PI / 2 : 0 }, l: l, pk: pk.id };
      scene.add(m); stoneMeshes.push(m);
    }
  });

  /* prévisualisation du dépôt : pierres fantômes, rouges si l'étape est en erreur (contact, course de pince, appui...) */
  var ghostMat = new THREE.MeshStandardMaterial({ color: 0x2fbf71, transparent: true, opacity: 0.45, depthWrite: false });
  var ghostEdge = new THREE.LineBasicMaterial({ color: 0x2fbf71 });
  var ghosts = [0, 1, 2].map(function () {
    var m = new THREE.Mesh(new THREE.BoxGeometry(320, 110, 110), ghostMat);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), ghostEdge)); m.visible = false; scene.add(m); return m;
  });
  /* trajectoire de l'étape sélectionnée : ligne, points et robot à l'arrivée (flèche : face des angles) */
  var trajG = new THREE.Group(); scene.add(trajG); var trajKey = '';
  function updateTraj(st, inf) {
    var key = st && st.a === 'traj' && R && inf ? JSON.stringify([st.pts, st.fa, inf.t0, inf.t1, R.T, !!inf.err]) : '';
    if (key === trajKey) return; trajKey = key;
    trajG.children.slice().forEach(function (o) { trajG.remove(o); if (o.geometry) o.geometry.dispose(); });
    if (!key) return;
    var p0 = R.poseAt(inf.t0), w0 = W(p0.x, p0.y), pts = [new THREE.Vector3(w0[0], 6, w0[1])];
    var col = inf.err ? 0xd62f2f : 0x4fc3f7, lm = new THREE.LineBasicMaterial({ color: col }), dm = new THREE.MeshBasicMaterial({ color: col });
    (st.pts || []).forEach(function (q, j) {
      var w = W(+q.x, +q.y); pts.push(new THREE.Vector3(w[0], 6, w[1]));
      var dot = new THREE.Mesh(new THREE.SphereGeometry(j === st.pts.length - 1 ? 16 : 11, 12, 8), dm); dot.position.set(w[0], 8, w[1]); trajG.add(dot);
    });
    trajG.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lm));
    var pe = R.poseAt(inf.t1), tri = GEOM.robotPoly(pe).map(function (v) { var w = W(v[0], v[1]); return new THREE.Vector3(w[0], 7, w[1]); });
    tri.push(tri[0].clone()); trajG.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(tri), lm));
    var a = nv(pe.h + 120 * ({ A: 0, B: 1, C: 2 }[st.fa] || 0)), we = W(pe.x, pe.y), wf = W(pe.x + 260 * a[0], pe.y + 260 * a[1]);
    trajG.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(we[0], 9, we[1]), new THREE.Vector3(wf[0], 9, wf[1])]), new THREE.LineBasicMaterial({ color: 0xf5c518 })));
  }
  function updateGhost() {
    var stT = sel >= 0 ? prog[sel] : null; updateTraj(stT, stT && R ? R.stepInfo[sel] : null);
    var st = sel >= 0 ? prog[sel] : null, isG = false;
    var isC = st && (st.a === 'mur' || st.a === 'tour' || st.a === 'porte');
    var inf = st && (st.a === 'deposer' || isG || isC) && R ? R.stepInfo[sel] : null, gh = inf && inf.ghost;
    /* position du fantôme : la saisie (dépôt, construction manuelle) ou celle calculée par le moteur */
    var bx = isC && st.pm !== 'manuel' && gh && gh.T ? gh.T[0] : st && st.x, by = isC && st.pm !== 'manuel' && gh && gh.T ? gh.T[1] : st && st.y, ba = isC && st.pm !== 'manuel' && gh && gh.T ? gh.ang : st && +st.ang || 0;
    ghosts.forEach(function (m, j) {
      var ft = !isG && gh && gh.feet[j]; m.visible = !!ft; if (!ft) return;
      var a = ba * Math.PI / 180, u = [Math.cos(a), Math.sin(a)], v = [-Math.sin(a), Math.cos(a)];
      var w = W(bx + ft.u * u[0] + ft.v * v[0], by + ft.u * u[1] + ft.v * v[1]);
      m.position.set(w[0], ft.zc, w[1]); m.rotation.set(0, -a, ft.vertical ? Math.PI / 2 : 0);
    });
    var c = inf && inf.err ? 0xd62f2f : 0x2fbf71; ghostMat.color.setHex(c); ghostEdge.color.setHex(c);
  }

  /* robots (jaune = nous, bleu = adversaire en miroir).
     Tout vient de GEOM / SPEC : empreinte au sol (GEO.hull), plaques, roues, nacelles (GEO.rangees, GEO.colonne), canon (GEO.canon), ascenseur (GEOM.fourchePtsR). */
  var yellow = mat(0xf2b600, 0.5, 0.1), blue = mat(0x3a6fd0, 0.55, 0.15), dark = mat(0x39414e, 0.5, 0.3), black = mat(0x1d2128, 0.8, 0);
  var D2R = Math.PI / 180, CHS = SPEC.robot.chassis, PLATE = CHS.plaque_haute.polygone_repere_robot, ROUES = SPEC.robot.entrainement.roues;
  var PLATE_T = 6;                       /* épaisseur de dessin des plaques (visuel, hypothèse) */
  var MAST = { r: 35, h: 430 };          /* mât de balise centré, Ø 70 mm jusqu'à 430 mm (docs/CONTRATS.md §2) */
  var CAN_LEN = 160;                     /* longueur dessinée du tube du canon (visuel, hypothèse) */
  var STONE_LX = GEO.dPierre - GEO.rin;  /* centre d'une pierre tenue, dans le repère de la nacelle : 90 mm */
  function polyShape(pts, k, dy) { var sh = new THREE.Shape(); pts.forEach(function (q, i) { var x = q[0] * k, y = -q[1] * k; if (i) sh.lineTo(x, y); else sh.moveTo(x, y); }); return sh; }
  var hullGeo = new THREE.ShapeGeometry(polyShape(GEO.hull, 1));
  var hullEdge = new THREE.BufferGeometry().setFromPoints(GEO.hull.map(function (q) { return new THREE.Vector3(q[0], 0, q[1]); }));
  var topGeo = new THREE.ExtrudeGeometry(polyShape(PLATE, 1), { depth: PLATE_T, bevelEnabled: false });
  var lowGeo = new THREE.ExtrudeGeometry(polyShape(PLATE, CHS.plaque_basse.rayon_sommets / CHS.plaque_haute.rayon_sommets), { depth: PLATE_T, bevelEnabled: false });
  function forkGeo(fx) { return new THREE.ExtrudeGeometry(polyShape(GEOM.fourchePtsR(fx), 1), { depth: GEO.fourche.cao.travEp, bevelEnabled: false }); }
  function makeBot(scheme) {
    var bot = new THREE.Group(); scene.add(bot);
    var mastM = scheme.elec, modM = scheme.mod, banner = scheme.banner;
    /* empreinte réelle au sol (translucide) et son contour */
    var foot = new THREE.Mesh(hullGeo, new THREE.MeshBasicMaterial({ color: scheme.elec.color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    foot.rotation.x = -Math.PI / 2; foot.position.y = 1.5; bot.add(foot);
    var edge = new THREE.LineLoop(hullEdge, new THREE.LineBasicMaterial({ color: scheme.elec.color })); edge.position.y = 2; bot.add(edge);
    /* plaques et montants */
    var low = new THREE.Mesh(lowGeo, dark); low.rotation.x = -Math.PI / 2; low.position.y = CHS.plaque_basse.z_centre - PLATE_T / 2; low.castShadow = true; bot.add(low);
    var top = new THREE.Mesh(topGeo, dark); top.rotation.x = -Math.PI / 2; top.position.y = GEO.toit - PLATE_T; top.castShadow = true; bot.add(top);
    PLATE.forEach(function (q) { var c = cyl(8, 8, GEO.toit, dark, 10); c.position.set(q[0], GEO.toit / 2, q[1]); bot.add(c); });
    /* roues omnidirectionnelles : axe radial */
    ROUES.angles_deg_repere_robot.forEach(function (a) {
      var r = a * D2R, g = new THREE.Group(); g.position.set(ROUES.rayon_implantation * Math.cos(r), ROUES.diametre / 2, ROUES.rayon_implantation * Math.sin(r)); g.rotation.y = -r; bot.add(g);
      var wh = cyl(ROUES.diametre / 2, ROUES.diametre / 2, 25, black, 24); wh.rotation.z = Math.PI / 2; g.add(wh);
    });
    /* mât de balise */
    var mast = cyl(MAST.r, MAST.r, MAST.h - GEO.toit, mastM, 24); mast.position.set(0, (MAST.h + GEO.toit) / 2, 0); bot.add(mast);
    var ring = cyl(MAST.r + 3, MAST.r + 3, 14, mat(banner, 0.4, 0.1), 24); ring.position.set(0, MAST.h - 7, 0); bot.add(ring);
    /* nacelle de la face k (0 = A, 1 = B), repère : x normale, y haut, z latéral ; rotation autour de la normale */
    function makeModule(k) {
      var face = new THREE.Group(); face.rotation.y = -k * 120 * D2R; bot.add(face);
      var mod = new THREE.Group(); mod.position.x = GEO.rin; face.add(mod);
      var hw = GEO.faceLong / 2 - 12;
      [-hw, hw].forEach(function (z) { var u = box(10, GEO.toit, 10, modM); u.position.set(6, GEO.toit / 2, z); mod.add(u); });
      var tb = box(10, 10, 2 * hw + 10, modM); tb.position.set(6, GEO.toit - 5, 0); mod.add(tb);
      var carr = new THREE.Group(); mod.add(carr);
      var cross = box(10, 12, 2 * hw, modM); cross.position.set(6, 0, 0); carr.add(cross);
      var grip = new THREE.Group(); carr.add(grip);
      var depth = GEO.saillie - GEO.nacDos, xm = (GEO.nacDos + GEO.saillie) / 2;
      var col = box(depth, GEO.colonne.z1 - GEO.colonne.z0, 2 * GEO.colonne.hu, modM); col.position.set(xm, (GEO.colonne.z0 + GEO.colonne.z1) / 2, 0); grip.add(col);
      var mats = [0, 1, 2].map(function () { return new THREE.MeshStandardMaterial({ color: banner, roughness: 0.55 }); });
      GEO.rangees.forEach(function (rg, i) {
        var bar = box(depth, 2 * rg.r, 2 * rg.hl, mats[i]); bar.position.set(xm, rg.z, 0); grip.add(bar);
        [-rg.hl, rg.hl].forEach(function (z) { var c = cyl(rg.r, rg.r, depth, mats[i], 16); c.rotation.z = Math.PI / 2; c.position.set(xm, rg.z, z); grip.add(c); });
      });
      var lab = box(4, 40, 40, k ? mat(0x2aa3a3, 0.5, 0.1) : mat(0x8a5cd0, 0.5, 0.1)); lab.position.set(2, GEO.toit - 30, 0); mod.add(lab);
      return { carr: carr, grip: grip, mats: mats };
    }
    var MOD = { A: makeModule(0), B: makeModule(1) };
    /* face C : canon (rentré au départ) et ascenseur du Graal (fourche à 2 dents) */
    var faceC = new THREE.Group(); faceC.rotation.y = -240 * D2R; bot.add(faceC);
    var canTube = cyl(1, 1, 1, mat(0x5a6170, 0.4, 0.6), 20); faceC.add(canTube);
    var liftCarr = box(30, 55, 21, mat(0x7a8190, 0.5, 0.4)); faceC.add(liftCarr);
    var rail = box(10, GEO.toit, 21, dark); rail.position.set(GEO.rin + 15, GEO.toit / 2, 120.5); faceC.add(rail);
    var forkMesh = new THREE.Mesh(forkGeo(GEO.fourche.fxRentree), mat(0xc9ced8, 0.4, 0.5)); forkMesh.rotation.x = -Math.PI / 2; forkMesh.castShadow = true; bot.add(forkMesh);
    var forkFx = GEO.fourche.fxRentree;
    function placeC(C) {
      C = C || GEO.C0;
      var el = GEO.canon.el * D2R, rec = GEO.canon.course - (C.can || 0);
      var mx = GEO.rin + GEO.canon.horsFace - rec * Math.cos(el), my = GEO.canon.hauteur - rec * Math.sin(el);
      canTube.scale.set(GEO.canon.d / 2, CAN_LEN, GEO.canon.d / 2); canTube.rotation.set(0, 0, el - Math.PI / 2);
      canTube.position.set(mx - Math.cos(el) * CAN_LEN / 2, my - Math.sin(el) * CAN_LEN / 2, GEO.canon.y);
      var fz = GEOM.fourcheZ(C.fz);
      liftCarr.position.set(GEO.rin + 25, (fz[0] + fz[1]) / 2, 120.5);
      if (Math.abs(C.fx - forkFx) > 0.05) { forkMesh.geometry.dispose(); forkMesh.geometry = forkGeo(C.fx); forkFx = C.fx; }
      forkMesh.position.y = C.fz;
    }
    var tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), loc = new THREE.Object3D();
    function place(p) {
      if (!p) return;
      var w = W(p.x, p.y); bot.position.set(w[0], 0, w[1]); bot.rotation.y = -p.h * Math.PI / 180;
      ['A', 'B'].forEach(function (f) { if (p[f]) { MOD[f].carr.position.y = p[f].hc; MOD[f].grip.rotation.x = p[f].rot * Math.PI / 180; } });
      placeC(p.C);
      bot.updateMatrixWorld(true);
    }
    function fromGrip(mesh, f, lx, ly, ry) {
      loc.position.set(lx, ly, 0); loc.rotation.set(0, ry, 0); loc.updateMatrix();
      tmpM.multiplyMatrices(MOD[f].grip.matrixWorld, loc.matrix); tmpM.decompose(tmpV, tmpQ, tmpS);
      mesh.position.copy(tmpV); mesh.quaternion.copy(tmpQ);
    }
    return { group: bot, MOD: MOD, place: place, fromGrip: fromGrip };
  }
  var us = makeBot({ elec: yellow, mod: blue, banner: 0xd62f2f });
  var them = makeBot({ elec: blue, mod: yellow, banner: 0xf2b600 });
  them.group.visible = false;
  var robot = us.group, MOD = us.MOD;
  /* robot adverse abstrait (engine/adversaires.js) : empreinte extrudée à sa hauteur déclarée, et ses constructions */
  var absBot = null, absBuilt = null, absMat = new THREE.MeshStandardMaterial({ color: 0x4aa3ff, roughness: 0.5, metalness: 0.2, transparent: true, opacity: 0.9 });
  function buildAbstrait(res) {
    if (absBot) { scene.remove(absBot); absBot.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); absBot = null; }
    if (absBuilt) { scene.remove(absBuilt); absBuilt.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); absBuilt = null; }
    if (!res) return;
    var sh = new THREE.Shape(); res.forme.forEach(function (q, i) { if (i) sh.lineTo(q[0], -q[1]); else sh.moveTo(q[0], -q[1]); }); sh.closePath();
    var g = new THREE.ExtrudeGeometry(sh, { depth: res.params.hauteur || 340, bevelEnabled: false });
    var m = new THREE.Mesh(g, absMat); m.rotation.x = -Math.PI / 2; m.castShadow = true;
    var nose = new THREE.Mesh(new THREE.BoxGeometry(60, 20, 20), new THREE.MeshStandardMaterial({ color: 0xf2b600 })); nose.position.set(res.R - 30, (res.params.hauteur || 340) + 10, 0);
    absBot = new THREE.Group(); absBot.add(m); absBot.add(nose); scene.add(absBot);
    absBuilt = new THREE.Group(); scene.add(absBuilt);
    (res.built || []).forEach(function (c) {
      c.feet.forEach(function (f) {
        var xs = f.foot.map(function (v) { return v[0]; }), ys = f.foot.map(function (v) { return v[1]; }), cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2, cy = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
        var L = Math.hypot(f.foot[1][0] - f.foot[0][0], f.foot[1][1] - f.foot[0][1]), N = Math.hypot(f.foot[3][0] - f.foot[0][0], f.foot[3][1] - f.foot[0][1]), ang = Math.atan2(f.foot[1][1] - f.foot[0][1], f.foot[1][0] - f.foot[0][0]);
        var b = new THREE.Mesh(new THREE.BoxGeometry(L, f.top - f.bottom, N), new THREE.MeshStandardMaterial({ color: 0x9a7b55, roughness: 0.8 }));
        var w = W(cx, cy); b.position.set(w[0], (f.top + f.bottom) / 2, w[1]); b.rotation.y = -ang; b.userData = { t: c.t, id: f.id }; b.castShadow = true;
        absBuilt.add(b);
      });
    });
  }
  function placeAbstrait(res, t) {
    if (!absBot) return;
    var p = res.poseAt(Math.min(t, res.T)), w = W(p.x, p.y); absBot.position.set(w[0], 0, w[1]); absBot.rotation.y = -p.h * D2R;
    absBuilt.children.forEach(function (b) { b.visible = t >= b.userData.t; });
  }
  /* pierres prises par le robot abstrait : sur sa construction une fois posée, cachées avant (transportées) */
  function pierreAbstraite(res, id) { var out = null; (res.built || []).forEach(function (c) { if (c.ids.indexOf(id) >= 0) out = c; }); return out; }
  function graalAbstrait(res, t) {
    var tl = (res.graal && res.graal.tl) || [{ t: 0, k: 'home' }], e = tl[0]; tl.forEach(function (x) { if (x.t <= t) e = x; });
    if (e.k === 'home') return { k: 'home', c: res.graalHome.c, ang: res.graalHome.ang, bottom: 0 };
    if (e.k === 'robot') { var p = res.poseAt(t); return { k: 'robot', c: [p.x, p.y], ang: p.h, bottom: res.params.hauteur || 340 }; }
    if (e.k === 'construction') { var z = ENGINE.zoneById(e.z), c = (res.built || []).filter(function (q) { return q.z === e.z; })[0], top = 0; if (c) c.feet.forEach(function (f) { top = Math.max(top, f.top); }); return { k: 'construction', c: z.c, ang: 0, bottom: top }; }
    var q = res.poseAt(e.t); return { k: e.k, c: [q.x, q.y], ang: 0, bottom: 0 };
  }
  /* Graal (spec : base 62 x 62, hauteur 100, 2 anses basses) : la taille de la base suit le paramètre gs */
  function makeGraal(color) {
    var g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: color, roughness: 0.3, metalness: 0.6 }), A = GEO.graal.anse;
    var body = box(1, 1, 1, m); g.add(body);
    var anses = [-1, 1].map(function (sg) { var a = box(A.saillie + 4, 14, A.long, m); g.add(a); return { m: a, sg: sg }; });
    g.userData = { body: body, anses: anses, gs: 0 };
    g.visible = false; scene.add(g); return g;
  }
  function sizeGraal(g, gs) {
    var u = g.userData; if (u.gs === gs) return; u.gs = gs;
    u.body.scale.set(gs, GEO.graal.h, gs); u.body.position.y = GEO.graal.h / 2;
    u.anses.forEach(function (a) { a.m.position.set(0, GEO.graal.anse.dessous + 7, a.sg * (gs / 2 + (GEO.graal.anse.saillie - 4) / 2)); });
  }
  var graalM = makeGraal(0xe8c547);
  var graalOpp = makeGraal(0x9ec0ff);
  var ballMat = new THREE.MeshStandardMaterial({ color: 0xf2b600, roughness: 0.8 }), balls = [];
  var ballMatOpp = new THREE.MeshStandardMaterial({ color: 0x3a6fd0, roughness: 0.8 }), ballsOpp = [];
  for (var bi = 0; bi < 10; bi++) { var bm = new THREE.Mesh(new THREE.SphereGeometry(22.5, 16, 12), ballMat); bm.castShadow = true; scene.add(bm); balls.push(bm); }
  /* position d'un boulet tg secondes après son tir (points enregistrés toutes les 20 ms) */
  function ballAt(b, tg) {
    var P = b.pts; if (tg >= P[P.length - 1][0]) return P[P.length - 1].slice(1);
    var lo = 0, hi = P.length - 1; while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (P[mid][0] <= tg) lo = mid; else hi = mid; }
    var a = P[lo], c = P[hi], u = c[0] > a[0] ? (tg - a[0]) / (c[0] - a[0]) : 0;
    return [a[1] + (c[1] - a[1]) * u, a[2] + (c[2] - a[2]) * u, a[3] + (c[3] - a[3]) * u];
  }
  for (var bj = 0; bj < 10; bj++) { var bo = new THREE.Mesh(new THREE.SphereGeometry(22.5, 16, 12), ballMatOpp); bo.castShadow = true; bo.visible = false; scene.add(bo); ballsOpp.push(bo); }
  var shotLines = null, shotLinesOpp = null;
  function buildShots() {
    [shotLines, shotLinesOpp].forEach(function (g) { if (g) { scene.remove(g); g.children.forEach(function (l) { l.geometry.dispose(); }); } });
    function lines(res, colIn) {
      var grp = new THREE.Group(); grp.visible = showTrail; scene.add(grp);
      ((res && res.balls && res.balls.shots) || []).forEach(function (b) {
        var pts = b.pts.map(function (q) { var w = W(q[1], q[2]); return new THREE.Vector3(w[0], q[3], w[1]); });
        grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: b.cour ? colIn : 0xff6b6b, transparent: true, opacity: 0.6 })));
      });
      return grp;
    }
    shotLines = lines(R, 0xf2b600); shotLinesOpp = lines(R.opponent, 0x4aa3ff);
  }
  var trail = null, trailOpp = null, showTrail = true, showOppTrail = true;
  function buildTrail() {
    if (trail) { scene.remove(trail); trail.geometry.dispose(); }
    if (!R) return;
    var pts = []; for (var t = 0; t <= R.T; t += 0.1) { var p = R.poseAt(t), w = W(p.x, p.y); pts.push(new THREE.Vector3(w[0], 2, w[1])); }
    trail = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff3d7f })); trail.visible = showTrail; scene.add(trail);
  }
  function buildOppTrail() {
    if (trailOpp) { scene.remove(trailOpp); if (trailOpp.geometry) trailOpp.geometry.dispose(); trailOpp = null; }
    if (!R || !R.opponent) return;
    var pts = []; for (var t = 0; t <= R.opponent.T; t += 0.1) { var p = R.opponent.poseAt(t), w = W(p.x, p.y); pts.push(new THREE.Vector3(w[0], 3, w[1])); }
    trailOpp = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x4aa3ff })); trailOpp.visible = showOppTrail; scene.add(trailOpp);
  }
  function placeRobot(p) { us.place(p); }
  function fromGrip(mesh, f, lx, ly, ry) { us.fromGrip(mesh, f, lx, ly, ry); }

  /* ---------- choix d'un repère en cliquant sur la table ---------- */
  function targetKinds(st) {
    var k = [];
    fieldsOf(st).forEach(function (f) {
      if (f === 'xy') k.push('XY'); if (f === 'pts') k.push('PT'); if (f === 'p') k.push('P'); if (f === 'zm') k.push('M'); if (f === 'zt') k.push('T'); if (f === 'zmt') k.push('M', 'T'); if (f === 's') k.push('S');
    });
    return k;
  }
  function pickText(kinds) {
    var w = [];
    if (kinds.indexOf('P') >= 0) w.push('un paquet (P)'); if (kinds.indexOf('M') >= 0) w.push('une zone de mur (M)');
    if (kinds.indexOf('T') >= 0) w.push('une tour (T)'); if (kinds.indexOf('S') >= 0) w.push('une pierre'); if (kinds.indexOf('XY') >= 0) w.push('le point de dépôt'); if (kinds.indexOf('PT') >= 0) return 'Clique sur la table pour ajouter un point à la trajectoire';
    return 'Clique ' + w.join(' ou ') + ' sur la table';
  }
  function curKinds() { return sel >= 0 && prog[sel] ? targetKinds(prog[sel]) : []; }
  function updatePick() {
    var kinds = curKinds(), el = $('pick');
    el.hidden = !kinds.length; if (kinds.length) el.textContent = 'Étape ' + (sel + 1) + ' : c' + pickText(kinds).slice(1);
    var st = sel >= 0 ? prog[sel] : null;
    markers.forEach(function (m) {
      var on = !kinds.length || kinds.indexOf(m.userData.kind) >= 0;
      var cur = st && ((m.userData.kind === 'P' && st.p === m.userData.id) || ((m.userData.kind === 'M' || m.userData.kind === 'T') && st.z === m.userData.id && kinds.indexOf(m.userData.kind) >= 0));
      m.material.opacity = on ? 1 : 0.25;
      m.scale.copy(m.userData.base).multiplyScalar(cur ? 1.35 : 1);
    });
  }
  var ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function hitAt(ev) {
    var kinds = curKinds(); if (!kinds.length) return null;
    var r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (kinds.indexOf('XY') >= 0 || kinds.indexOf('PT') >= 0) {
      var hp = ray.intersectObjects([topM].concat(stoneMeshes), false)[0]; if (!hp) return null;
      var px = Math.round((hp.point.x + 1500) / 5) * 5, py = Math.round((hp.point.z + 1000) / 5) * 5;
      return px >= 0 && px <= 3000 && py >= 0 && py <= 2000 ? { kind: kinds.indexOf('PT') >= 0 ? 'PT' : 'XY', x: px, y: py } : null;
    }
    var objs = markers.filter(function (m) { return labels.visible && kinds.indexOf(m.userData.kind) >= 0; });
    if (kinds.indexOf('S') >= 0 || kinds.indexOf('P') >= 0) objs = objs.concat(stoneMeshes);
    var hits = ray.intersectObjects(objs, false);
    for (var i = 0; i < hits.length; i++) {
      var u = hits[i].object.userData;
      if (u.kind) return { kind: u.kind, id: u.id };
      if (u.pk) return kinds.indexOf('S') >= 0 ? { kind: 'S', id: u.pk + '.' + (u.l + 1) } : { kind: 'P', id: u.pk };
    }
    var th = ray.intersectObject(topM, false)[0]; if (!th) return null;
    var x = th.point.x + 1500, y = th.point.z + 1000, best = null, bd = 260;
    function near(kind, id, cx, cy) { var d = Math.hypot(cx - x, cy - y); if (d < bd) { bd = d; best = { kind: kind, id: id }; } }
    if (kinds.indexOf('P') >= 0) ENGINE.PK.forEach(function (p) { near('P', p.id, p.x, p.y); });
    if (kinds.indexOf('M') >= 0) ENGINE.ZM.forEach(function (z) { near('M', z.id, z.c[0], z.c[1]); });
    if (kinds.indexOf('T') >= 0) ENGINE.ZT.forEach(function (z) { near('T', z.id, z.c[0], z.c[1]); });
    return best;
  }
  function applyPick(h) {
    var st = prog[sel], f = { P: 'p', M: 'z', T: 'z', S: 's' }[h.kind];
    if (h.kind === 'PT') { (st.pts || (st.pts = [])).push({ x: h.x, y: h.y, a: null }); changed(true); toast('Point ' + st.pts.length + ' ajouté : ' + h.x + ', ' + h.y); return; }
    if (h.kind === 'XY') { st.x = h.x; st.y = h.y; changed(true); toast('Étape ' + (sel + 1) + ' : ' + describe(st)); return; }
    if (st[f] === h.id) return;
    st[f] = h.id; changed(true); toast('Étape ' + (sel + 1) + ' : ' + describe(st));
  }
  var downXY = null, hoverQueued = false;
  canvas.addEventListener('pointerdown', function (e) { downXY = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', function (e) {
    if (!downXY || Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 5) { downXY = null; return; }
    downXY = null; var h = hitAt(e); if (h) applyPick(h);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (e.buttons || hoverQueued) return; hoverQueued = true;
    requestAnimationFrame(function () { hoverQueued = false; canvas.style.cursor = hitAt(e) ? 'pointer' : ''; });
  });

  /* ---------- frise, résultats, alertes ---------- */
  var strip = $('strip'), badMap = [], TEND = 100, time = 0;
  function computeBad() { badMap = []; for (var t = 0; t <= TEND; t += 0.2) badMap.push(checks(Math.min(t, R.T))); }
  function drawStrip() {
    if (!R) return;
    var w = strip.clientWidth || 800, ctx = strip.getContext('2d');
    strip.width = w; strip.height = 6; ctx.fillStyle = '#3ccf7a'; ctx.fillRect(0, 0, w, 6);
    ctx.fillStyle = '#ff6b6b';
    badMap.forEach(function (b, i) { if (b.bad) ctx.fillRect(Math.floor(i * 0.2 / TEND * w), 0, Math.ceil(0.2 / TEND * w) + 1, 6); });
  }
  function renderTimeline() {
    var g = $('segs'); g.innerHTML = '';
    $('m100').style.left = (MATCH / TEND * 100) + '%';
    if (!R) return;
    var tw = $('track').clientWidth || 600;
    prog.forEach(function (st, i) {
      var inf = R.stepInfo[i]; if (!inf || inf.t1 == null) return;
      var d = document.createElement('div'); d.className = 'sg' + (i === sel ? ' sel' : '') + (inf.err || inf.t1 > MATCH ? ' err' : '');
      d.style.left = (inf.t0 / TEND * 100) + '%'; d.style.width = 'calc(' + ((inf.t1 - inf.t0) / TEND * 100) + '% - 2px)';
      d.textContent = (inf.t1 - inf.t0) / TEND * tw >= 15 ? String(i + 1) : ''; d.title = (i + 1) + '. ' + describe(st) + ' (' + fmt(inf.t0) + '–' + fmt(inf.t1) + ' s)';
      g.appendChild(d);
    });
  }
  function stepAt(t) { if (!R) return -1; for (var i = 0; i < R.stepInfo.length; i++) { var s = R.stepInfo[i]; if (s && t >= s.t0 && t < s.t1) return i; } return -1; }
  (function () {
    var tr = $('track'), down = false, moved = false, x0 = 0;
    function tAt(e) { var r = tr.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * TEND; }
    tr.addEventListener('pointerdown', function (e) { down = true; moved = false; x0 = e.clientX; tr.setPointerCapture(e.pointerId); time = tAt(e); dragging = true; });
    tr.addEventListener('pointermove', function (e) { if (!down) return; if (Math.abs(e.clientX - x0) > 3) moved = true; time = tAt(e); });
    tr.addEventListener('pointerup', function (e) {
      if (!down) return; down = false; dragging = false;
      if (!moved) { var i = stepAt(tAt(e)); if (i >= 0 && i !== sel) { sel = i; renderSteps(); var li = stepsEl.children[i]; if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' }); } }
    });
    tr.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); seek(e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey); }
    });
  })();
  function seek(dir, big) { time = Math.max(0, Math.min(TEND, time + dir * (big ? 5 : 1))); }

  function fmt(t) { return (Math.round(t * 10) / 10).toFixed(1).replace('.', ','); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function own(id) { return SCORE.own(id, 'yellow'); }
  function outcome(T) { return SCORE.outcome(R, params, T); }
  function scoreOf(o) { return SCORE.scoreOf(o, params); }
  function renderResults() {
    var T = R.T, tE = MATCH, o = outcome(tE), sc = scoreOf(o); /* évaluation à T = 100 s (trône, boulets et Graal ne comptent qu'à la fin du match, docs/CONTRATS.md §3) */
    R.gLevel = sc.niveauGraal;
    $('scoreV').textContent = sc.total; $('totPts').textContent = sc.total + ' pts';
    var oppR = R.opponent, oppSc = null;
    if (oppR) {
      oppSc = SCORE.scoreAt(oppR, oppR.params, MATCH);
      $('scoreOpp').hidden = false; $('scoreOpp').textContent = 'adv. ' + oppSc.total + ' pts';
      $('totPts').textContent = sc.total + ' · adv. ' + oppSc.total;
    } else { $('scoreOpp').hidden = true; $('scoreOpp').textContent = ''; }
    $('score').title = 'Score estimé ' + 'à 100 s' + ' : détail dans l\'onglet Résultat';
    var h = '<div class="scorebox"><div class="big"><b>' + sc.total + '</b> pts</div><p class="note">Score estimé à 100 s' + (T > MATCH ? ' : ce qui est fait après ne compte pas' : '') + '. Barème du compteur de points' + (oppR ? ', face à l\'adversaire (' + ((currentOpponent() && currentOpponent().name) || 'miroir') + ' : ' + oppSc.total + ' pts).' : '.') + '</p></div>';
    sc.rows.forEach(function (r) {
      var sub = 0; r[1].forEach(function (x) { sub += x[2]; });
      h += '<div class="sgrp"><div class="sh"><span>' + esc(r[0]) + '</span><b>' + sub + ' pts</b></div>';
      r[1].forEach(function (x) { h += '<div class="srw' + (x[2] ? '' : ' zero') + '"><span>' + esc(x[0]) + '<small>' + esc(x[1]) + '</small></span><b>' + x[2] + '</b></div>'; });
      h += '</div>';
    });
    if (params.gs <= 60) h += '<p class="note bad" style="padding:0 14px">Le Graal fait ' + params.gs + ' mm : le règlement exige un cube strictement plus grand que 60 mm.</p>';
    var rows = [];
    rows.push(['Durée du programme', fmt(T) + ' s', T <= MATCH]);
    rows.push(['Erreurs moteur', R.errors.length ? R.errors.length + ' (voir Alertes)' : 'aucune', !R.errors.length]);
    var gk = graalAt(tE).k;
    rows.push(['Graal', (GRAAL_ETAT[gk] || gk) + ' · niveau ' + sc.niveauGraal, gk === 'retire' ? false : null]);
    rows.push(['Pierres prises', Object.keys(o.fin).filter(function (k) { return !o.fin[k].home; }).length + R.stones.filter(function (st) { return R.stoneAt(st, tE).k === 'held'; }).length + ' / 30', null]);
    rows.push(['Pierres dans une zone', Object.keys(o.inZ).length + ' (dont ' + Object.keys(o.inOwn).length + ' chez nous)', null]);
    var adv = o.walls.concat(o.towers, o.doors).filter(function (z) { return !own(z); });
    rows.push(['Constructions côté adverse', adv.length ? adv.join(', ') + ' (non comptées)' : 'aucune', adv.length ? false : null]);
    var sh = R.balls.shots;
    rows.push(['Boulets', sh ? sh.length + ' tirés de ' + fmt(sh.length ? sh[0].t : R.balls.t0) + ' à ' + fmt(sh.length ? sh[sh.length - 1].t : R.balls.t0) + ' s, vitesse de sortie ' + R.balls.v0.toFixed(2).replace('.', ',') + ' m/s' :'pas de séance de tir', sh ? o.nBalls === sh.length : null]);
    var badT = badMap.filter(function (b, i) { return b.bad && i * 0.2 <= T; }).length * 0.2;
    rows.push(['Temps hors règlement', badT ? 'environ ' + fmt(badT) + ' s (voir Alertes)' : 'aucun', !badT]);
    rows.push(['Contacts robot-pierre', R.collisions.length ? R.collisions.length + ' (voir Alertes)' : 'aucun', !R.collisions.length]);
    h += '<h3 class="rh">Détails</h3><dl class="facts">' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd class="' + (r[2] === true ? 'ok' : r[2] === false ? 'bad' : '') + '">' + esc(r[1]) + '</dd>'; }).join('') + '</dl>';
    $('results').innerHTML = h;
  }
  function renderAlerts() {
    var items = [];
    if (R.T > MATCH) items.push({ t: MATCH, k: 'Durée', txt: 'Le programme dure ' + fmt(R.T) + ' s : il dépasse les 100 s du match.' });
    R.errors.forEach(function (e) { var inf = R.stepInfo[e.step - 1]; items.push({ t: inf ? inf.t0 : 0, k: 'Étape ' + e.step, txt: e.msg, step: e.step - 1 }); });
    R.collisions.forEach(function (c) { items.push({ t: c.t, k: 'Contact', txt: 'Contact avec ' + c.with }); });
    var cur = null;
    badMap.forEach(function (b, i) {
      var t = i * 0.2, why = b.why.filter(function (w) { return w !== 'contact'; }).join(', ');
      if (why && t <= R.T) { if (cur && cur.why === why) cur.t1 = t + 0.2; else { cur = { t0: t, t1: t + 0.2, why: why }; items.push(cur); } }
      else cur = null;
    });
    items.forEach(function (it) { if (it.why) { it.t = it.t0; it.k = 'Règlement'; it.txt = 'Hors règlement (' + it.why + ') de ' + fmt(it.t0) + ' à ' + fmt(Math.min(it.t1, R.T)) + ' s'; } });
    items.sort(function (a, b) { return a.t - b.t; });
    var ul = $('alerts'); ul.innerHTML = '';
    if (!items.length) ul.innerHTML = '<li class="none"><i class="fa-solid fa-circle-check"></i> Aucune alerte : le programme respecte le règlement contrôlé.</li>';
    items.forEach(function (it) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="t">' + fmt(it.t) + ' s</span><span><span class="k"></span><span class="m"></span></span>';
      li.querySelector('.k').textContent = it.k; li.querySelector('.m').textContent = it.txt;
      li.addEventListener('click', function () { time = it.t + 0.01; setPlaying(false); if (it.step != null) { sel = it.step; renderSteps(); } });
      ul.appendChild(li);
    });
    var n = $('nAlerts'); n.textContent = items.length; n.className = 'cnt' + (items.length ? '' : ' zero');
  }

  /* ---------- mise à jour de la vue ---------- */
  var red = new THREE.Color(0xd62f2f), green = new THREE.Color(0x2fbf71), dragging = false, lastPlayIdx = -2;
  /* q = SCORE.graalPos : { k, c, ang, bottom, top } (home, ascenseur, toit ou posé) ; null si le Graal est retiré de la table */
  function placeGraal(mesh, q, gs) {
    if (!q) { mesh.visible = false; return; }
    sizeGraal(mesh, gs); mesh.visible = true;
    var w = W(q.c[0], q.c[1]); mesh.position.set(w[0], q.bottom, w[1]); mesh.rotation.set(0, -q.ang * D2R, 0);
  }
  var GRAAL_ETAT = { home: 'au départ', ascenseur: 'sur la fourche', toit: 'sur le toit', retire: 'retiré (erreur)', gone: 'retiré (erreur)' };
  function update(t) {
    if (!R) return;
    var tt = Math.min(t, R.T), groups = [], opp = R.opponent;
    R.stones.forEach(function (st, i) {
      var m = stoneMeshes[i], e = R.stoneAt(st, tt), holder = us;
      m.visible = true;
      if (e.k === 'gone' && opp && opp.abstrait) { m.visible = false; return; }
      if (e.k === 'gone') {
        if (opp) { e = opp.stoneAt(opp.stones[i], tt); holder = them; }
        else { m.visible = false; return; }
      }
      if (e.k === 'gone') { m.visible = false; return; }
      var outZ = holder === us && e.k === 'free' && R.outZone && R.outZone[st.id];
      if (m.userData.col == null) m.userData.col = m.material.color.getHex();
      m.material.color.setHex(outZ ? 0xe03b3b : m.userData.col); m.material.emissive.setHex(outZ ? 0x5a0000 : 0x000000);
      if (e.k === 'home') { var h = m.userData.home; m.position.set(h.x, h.y, h.z); m.rotation.set(0, h.ry, 0); return; }
      if (e.k === 'free') {
        if (!e._p) { holder.place(e.pose); holder.fromGrip(m, e.f, STONE_LX, GEOM.stoneZc(e.l), Math.PI / 2); e._p = m.position.clone(); e._q = m.quaternion.clone(); }
        m.position.copy(e._p); m.quaternion.copy(e._q); return;
      }
      groups.push([m, e, holder]);
    });
    var c = checks(tt), p = c.p; us.place(p);
    var abs = opp && opp.abstrait, po = opp && !abs ? opp.poseAt(Math.min(t, opp.T)) : null;
    if (opp && !abs) them.place(po);
    if (abs) placeAbstrait(opp, t);
    groups.forEach(function (g) { g[2].fromGrip(g[0], g[1].f, STONE_LX, GEOM.stoneZc(g[1].l), Math.PI / 2); });
    var gq = graalPos(tt), gk = graalAt(tt).k;
    placeGraal(graalM, gq, params.gs);
    graalOpp.visible = false;
    if (opp && !abs) { var tO = Math.min(t, opp.T); placeGraal(graalOpp, SCORE.graalPos(opp, opp.params, tO), opp.params.gs || params.gs); }
    if (abs) placeGraal(graalOpp, graalAbstrait(opp, Math.min(t, opp.T)), params.gs);
    ['A', 'B'].forEach(function (f) { for (var j = 0; j < 3; j++) { var on = p[f].vac[j]; us.MOD[f].mats[j].color.copy(on ? green : red); us.MOD[f].mats[j].emissive.copy(green).multiplyScalar(on ? 0.2 : 0); } });
    if (po) ['A', 'B'].forEach(function (f) { if (!po[f]) return; for (var j = 0; j < 3; j++) { var on = po[f].vac[j]; them.MOD[f].mats[j].color.copy(on ? green : red); them.MOD[f].mats[j].emissive.copy(green).multiplyScalar(on ? 0.2 : 0); } });
    var shots = R.balls.shots || [], nOn = 0, nIn = 0;
    function flyBalls(meshes, res, bot, tb, count) {
      var sh = res.balls.shots || [], nO = 0, nI = 0;
      meshes.forEach(function (bm, i) {
        var b = sh[i];
        bm.visible = i < (sh.length || Math.min(10, Math.round(count)));
        if (!b || tb < b.t) { nO++; bm.position.copy(new THREE.Vector3(-76 + (i % 5) * 18, 245, (Math.floor(i / 5) - 0.5) * 30).applyMatrix4(bot.group.matrixWorld)); return; }
        var q = ballAt(b, tb - b.t), w = W(q[0], q[1]); bm.position.set(w[0], q[2], w[1]);
        if (tb - b.t >= b.tStop && b.cour) nI++;
      });
      return { on: nO, in: nI };
    }
    var fb = flyBalls(balls, R, us, Math.min(t, TEND), params.bn); nOn = fb.on; nIn = fb.in;
    if (opp && !abs) {
      flyBalls(ballsOpp, opp, them, Math.min(t, opp.T), opp.params.bn);
    } else ballsOpp.forEach(function (bm) { bm.visible = false; });
    var hR = $('hR'), hS = $('hS'), hP = $('hP'), hB = $('hBall');
    hR.textContent = Math.round(c.robotH) + ' mm ' + (c.robotH <= 350.5 ? '✓' : '✗'); hR.className = c.robotH <= 350.5 ? 'ok' : 'bad';
    if (c.n) { var okS = c.oTop <= c.oLim + 0.5; hS.textContent = Math.round(c.oTop) + ' / ' + (c.oLim === Infinity ? 'sans limite' : c.oLim + ' mm') + ' ' + (okS ? '✓' : '✗'); hS.className = okS ? 'ok' : 'bad'; } else { hS.textContent = '-'; hS.className = ''; }
    hP.textContent = Math.round(c.per) + ' / ' + c.plim + ' mm ' + (c.per <= c.plim + 0.5 ? '✓' : '✗'); hP.className = c.per <= c.plim + 0.5 ? 'ok' : 'bad';
    var hG = $('hG'), hC = $('hC'), gst = (GRAAL_ETAT[gk] || gk) + (R.gLevel != null && (t >= R.T || t >= MATCH) ? ' · niveau ' + R.gLevel : '');
    hG.textContent = gst; hG.className = gk === 'retire' || gk === 'gone' ? 'bad' : gk === 'toit' ? 'ok' : '';
    hC.textContent = (p.C && p.C.can > 0.5 ? 'sorti ' + Math.round(p.C.can) + ' mm' : 'rentré') + ' · fourche ' + Math.round(p.C ? p.C.fx : 0) + ' / ' + Math.round(p.C ? p.C.fz : 0);
    $('hA').textContent = Math.round(p.A.hc) + ' / ' + Math.round(p.A.rot) + '°'; $('hB').textContent = Math.round(p.B.hc) + ' / ' + Math.round(p.B.rot) + '°';
    var hOpp = $('hOpp');
    if (opp) {
      var oName = (currentOpponentName()) || 'en miroir';
      hOpp.textContent = oName; hOpp.className = '';
    } else { hOpp.textContent = 'aucun'; hOpp.className = 'muted'; }
    if (!shots.length || t < shots[0].t) { hB.textContent = 'à bord'; hB.className = ''; }
    else { hB.textContent = (shots.length - nOn) + ' tirés · ' + nIn + ' dans la cour'; hB.className = nIn >= 3 ? 'ok' : ''; }
    var clk = $('clk'); clk.textContent = fmt(Math.min(t, TEND)); clk.className = t > MATCH ? 'bad' : '';
    $('clk2').textContent = fmt(Math.min(t, TEND)) + ' / ' + TEND + ' s';
    var lab = 'Fin du programme', stepN = '-';
    for (var i = 0; i < R.segs.length; i++) { var sg = R.segs[i]; if (tt >= sg.t0 && tt < sg.t1) { lab = sg.label; stepN = sg.step ? String(sg.step) : '-'; break; } }
    if (tt >= R.T) lab = 'Programme terminé en ' + fmt(R.T) + ' s';
    $('now').textContent = (stepN !== '-' ? stepN + '. ' : '') + lab; $('hStep').textContent = stepN;
    var pi = stepAt(tt);
    if (pi !== lastPlayIdx) {
      lastPlayIdx = pi;
      Array.prototype.forEach.call(stepsEl.children, function (li, k) { li.classList.toggle('play', k === pi); });
    }
    $('ph').style.left = (Math.min(t, TEND) / TEND * 100) + '%';
    $('track').setAttribute('aria-valuenow', String(Math.round(t)));
    if (trail) trail.geometry.setDrawRange(0, Math.max(2, Math.floor(tt / 0.1)));
    if (trailOpp) trailOpp.geometry.setDrawRange(0, Math.max(2, Math.floor(Math.min(t, opp ? opp.T : 0) / 0.1)));
    updateGhost();
  }

  /* ---------- message éphémère ---------- */
  var toastTimer = null;
  function toast(msg, kind, actions) {
    var t = $('toast'), b = $('toastBtns'); $('toastMsg').textContent = msg; b.innerHTML = '';
    t.className = 'toast' + (kind ? ' ' + kind : '');
    (actions || []).forEach(function (a, i) {
      var e = document.createElement('button'); e.type = 'button'; e.textContent = a[0]; if (i === 0 && actions.length > 1) e.className = 'primary';
      e.addEventListener('click', function () { hideToast(); if (a[1]) a[1](); }); b.appendChild(e);
    });
    t.hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, actions && actions.length > 1 ? 9000 : 3200);
  }
  function hideToast() { $('toast').hidden = true; }

  /* ---------- panneaux latéraux ---------- */
  var openDrawer = null;
  function showDrawer(id) {
    if (openDrawer) openDrawer.classList.remove('open');
    openDrawer = $(id); openDrawer.classList.add('open'); $('scrim').hidden = false;
    var f = openDrawer.querySelector('input, button'); if (f) setTimeout(function () { f.focus(); }, 60);
    if (id === 'dStrats') refreshStrats();
    if (id === 'dBrains') refreshBrains();
  }
  function closeDrawer() { if (!openDrawer) return; openDrawer.classList.remove('open'); openDrawer = null; $('scrim').hidden = true; }
  $('bStrats').addEventListener('click', function () { showDrawer('dStrats'); });
  $('bBrains').addEventListener('click', function () { showDrawer('dBrains'); });
  $('bParams').addEventListener('click', function () { showDrawer('dParams'); });
  $('bHelp').addEventListener('click', function () { showDrawer('dHelp'); });
  $('scrim').addEventListener('click', closeDrawer);
  document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', closeDrawer); });

  /* ---------- JSON ---------- */
  function exportObj() { return { format: 'camelot-strategie', version: 1, name: current || undefined, params: params, program: prog }; }
  function importObj(o) {
    if (!o || !Array.isArray(o.program)) throw new Error('le JSON doit contenir une liste « program ».');
    var valid = ACTIONS.map(function (a) { return a[0]; });
    o.program.forEach(upgradeStep); dropParams(o.params);
    var p2 = o.program.filter(function (s) { return s && valid.indexOf(s.a) >= 0; }).map(function (s) { var d = defaults(s.a); for (var k in d) if (s[k] !== undefined) d[k] = s[k]; if (s.tm === undefined && d.tm !== undefined) d.tm = false; if (s.a === 'deposer' && s.r === undefined) d.r = s.o === 'debout' ? 90 : 0; return d; });
    setPilotMode('strategie');
    prog = p2; params = Object.assign({}, DEF, dropParams(o.params) || {}); sel = -1; writeParams(); readParams(); changed(true);
    return p2.length;
  }
  $('bExport').addEventListener('click', function () {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(exportObj(), null, 2)], { type: 'application/json' }));
    a.download = (slugify(current) || 'strategie-camelot') + '.json'; document.body.appendChild(a); a.click(); a.remove();
    toast('Fichier JSON téléchargé', 'ok');
  });
  $('bCopy').addEventListener('click', function () {
    var txt = JSON.stringify(exportObj(), null, 2);
    try { navigator.clipboard.writeText(txt).then(function () { toast('JSON copié', 'ok'); }, function () { $('tJson').value = txt; toast('Copie impossible : le JSON est dans « Coller du JSON »', 'bad'); }); }
    catch (e) { $('tJson').value = txt; toast('Copie impossible : le JSON est dans « Coller du JSON »', 'bad'); }
  });
  function confirmLoss(go) { if (!isDirty() || !prog.length) go(); else toast('Les modifications non enregistrées seront perdues.', 'bad', [['Continuer', go], ['Annuler', null]]); }
  $('bLoadText').addEventListener('click', function () {
    var txt = $('tJson').value;
    confirmLoss(function () { try { var n = importObj(JSON.parse(txt)); setCurrent(''); markSaved(false); toast(n + ' étapes chargées', 'ok'); closeDrawer(); } catch (e) { toast('JSON illisible : ' + e.message, 'bad'); } });
  });
  $('fImport').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      confirmLoss(function () {
        try { var o = JSON.parse(rd.result), n = importObj(o); setCurrent(o.name || f.name.replace(/\.json$/i, '')); markSaved(false); toast(n + ' étapes chargées depuis ' + f.name, 'ok'); closeDrawer(); }
        catch (e) { toast('Fichier illisible : ' + e.message, 'bad'); }
      });
      ev.target.value = '';
    };
    rd.readAsText(f);
  });

  /* ---------- stratégies enregistrées sur le serveur ---------- */
  var API = '../api/strategies', current = lsGet('icamlot-strat-name') || '', strats = [], delArm = '';
  var savedSnap = lsGet('icamlot-strat-saved') || '';
  $('sName').value = current;
  function slugify(s) { return (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64); }
  function setCurrent(n) { current = n; lsSet('icamlot-strat-name', n || null); $('sName').value = n; updateDirty(); }
  function stateSnap() { return JSON.stringify({ params: params, program: prog }); }
  function isDirty() { if (pilot.mode === 'cerveau') return false; return stateSnap() !== savedSnap; }
  function markSaved(yes) { savedSnap = yes ? stateSnap() : ''; lsSet('icamlot-strat-saved', savedSnap || null); updateDirty(); }
  function updateDirty() {
    var s = $('state');
    if (pilot.mode === 'cerveau') {
      s.textContent = 'en direct'; s.className = 'state saved';
      document.title = (pilot.name || 'Cerveau') + ' · Simulation du plateau · ICAM LOT';
      return;
    }
    if (!current || !savedSnap) { s.textContent = 'non enregistrée'; s.className = 'state' + (prog.length ? ' dirty' : ''); }
    else if (isDirty()) { s.textContent = 'modifiée'; s.className = 'state dirty'; }
    else { s.textContent = 'enregistrée'; s.className = 'state saved'; }
    document.title = (current ? current + ' · ' : '') + 'Simulation du plateau · ICAM LOT';
  }
  function setPilotMode(mode, meta) {
    pilot.mode = mode;
    if (meta) {
      pilot.slug = meta.slug || '';
      pilot.name = meta.name || '';
      if (meta.layers) pilot.layers = meta.layers;
      if (meta.weights) pilot.weights = meta.weights;
      if (meta.cfg) pilot.cfg = meta.cfg;
    }
    if (mode !== 'cerveau') { pilot.layers = null; pilot.weights = null; pilot.cfg = null; pilot.slug = ''; pilot.name = ''; }
    document.body.classList.toggle('pilot-cerveau', mode === 'cerveau');
    $('tabProg').textContent = mode === 'cerveau' ? 'Décisions' : 'Programme';
    $('vProg').innerHTML = mode === 'cerveau'
      ? '<i class="fa-solid fa-brain"></i> Décisions'
      : '<i class="fa-solid fa-list-ol"></i> Programme';
    $('sName').placeholder = mode === 'cerveau' ? 'Cerveau en direct' : 'Stratégie sans nom';
    if (mode === 'cerveau') {
      $('sName').value = pilot.name || '';
      $('palette').hidden = true;
    } else {
      $('palette').hidden = false;
    }
    updateDirty();
  }
  function api(method, url, body) {
    return fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'same-origin' }).then(function (r) {
      if (r.status === 401) { location.href = '../connexion/?suite=' + encodeURIComponent(location.pathname); throw new Error('session expirée'); }
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ('erreur ' + r.status)); return j; });
    });
  }
  function fmtDate(s) { return new Date(s * 1000).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  function renderStrats() {
    var ul = $('strats'), q = slugify($('sFilter').value); ul.innerHTML = '';
    var list = strats.filter(function (s) { return !q || s.slug.indexOf(q) >= 0; });
    if (!list.length) { ul.innerHTML = '<li class="emptyl">' + (strats.length ? 'Aucune stratégie ne correspond.' : 'Aucune stratégie enregistrée pour l\'instant.') + '</li>'; return; }
    list.forEach(function (s) {
      var li = document.createElement('li'); if (s.slug === slugify(current)) li.className = 'cur';
      var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = s.name; nm.title = s.name;
      var meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = s.steps + ' étape' + (s.steps > 1 ? 's' : '') + ' · ' + fmtDate(s.updated);
      var kpi = document.createElement('span'), stt = statOf(s); kpi.className = 'kpi';
      if (stt) { kpi.innerHTML = '<b></b> · <b></b>'; kpi.children[0].textContent = stt.pts + ' pts'; kpi.children[1].textContent = fmt(stt.T) + ' s'; if (stt.T > MATCH) kpi.children[1].className = 'bad'; kpi.title = 'Score estimé et durée du programme, calculés avec le simulateur actuel'; }
      else if (stt === false) kpi.textContent = 'points non calculés';
      else { kpi.textContent = 'calcul des points…'; queueStat(s); }
      nm.appendChild(kpi); nm.appendChild(meta); li.appendChild(nm);
      var act = document.createElement('span'); act.className = 'act';
      var bl = document.createElement('button'); bl.type = 'button'; bl.textContent = 'Ouvrir'; bl.setAttribute('aria-label', 'Ouvrir ' + s.name);
      bl.addEventListener('click', function () { confirmLoss(function () { loadStrat(s.slug); }); });
      var bd = document.createElement('button'); bd.type = 'button'; bd.className = 'danger';
      bd.innerHTML = delArm === s.slug ? 'Confirmer' : '<i class="fa-solid fa-trash-can"></i>'; bd.setAttribute('aria-label', 'Supprimer ' + s.name);
      bd.addEventListener('click', function () { if (delArm === s.slug) delStrat(s.slug, s.name); else { delArm = s.slug; renderStrats(); } });
      act.appendChild(bl); act.appendChild(bd); li.appendChild(act); ul.appendChild(li);
    });
  }
  function fillOppSelect() {
    var sel_ = $('pOpp'), cur = oppChoice.slug, html = '<option value="">Aucun</option><option value="exemple">Exemple (miroir)</option>';
    if (oppLoaded.cerveau) html += '<option value="cerveau">' + esc(oppLoaded.cerveau.name || 'Rejeu Cerveau') + '</option>';
    strats.forEach(function (s) { html += '<option value="' + esc(s.slug) + '">' + esc(s.name) + '</option>'; });
    brains.forEach(function (b) { html += '<option value="cerveau:' + esc(b.slug) + '">Cerveau · ' + esc(b.name) + '</option>'; });
    sel_.innerHTML = html;
    if (cur && cur !== 'exemple' && cur !== 'cerveau' && !strats.some(function (s) { return s.slug === cur; }) && !(cur.indexOf('cerveau:') === 0 && !brainsLoaded) && !brains.some(function (b) { return 'cerveau:' + b.slug === cur; })) cur = 'exemple';
    sel_.value = cur || '';
    document.querySelectorAll('#pOppInt button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.i === oppChoice.intensity)); });
    $('pOppInt').hidden = !sel_.value;
    if (typeof renderMatch === 'function') renderMatch();
  }
  /* points et durée de chaque stratégie enregistrée : simulées ici, une à la fois, dans un worker à part */
  var statCache = {}, statQ = [], statBusy = false, statWorker = null, statId = 0;
  workerSrc.then(function (code) { try { statWorker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))); statWorker.onerror = function () { statWorker = null; }; } catch (e) { statWorker = null; } });
  /* les points mémorisés sont liés à la version du moteur : recalculés dès que le simulateur change */
  var ENG_VER = ENGINE.VERSION + '.' + (scriptUrl('engine/engine.js').split('?v=')[1] || 'dev');
  function statKey(s) { return 'icamlot-stat-' + ENG_VER + '-' + s.slug + '-' + s.updated; }
  try { for (var li = localStorage.length - 1; li >= 0; li--) { var lk = localStorage.key(li); if (/^icamlot-stat-/.test(lk) && lk.indexOf('icamlot-stat-' + ENG_VER + '-') !== 0) localStorage.removeItem(lk); } } catch (e) {}
  if (/__V__/.test($('verNote').textContent)) $('verNote').hidden = true;
  function statOf(s) {
    var k = statKey(s); if (statCache[k] !== undefined) return statCache[k];
    try { var j = JSON.parse(lsGet(k) || 'null'); if (j && isFinite(j.pts)) return (statCache[k] = j); } catch (e) {}
    return null;
  }
  /* score à 100 s (ou en fin de programme) et durée, avec les fonctions de la page appliquées au résultat r */
  function statFrom(r, P) {
    r.poseAt = function (t) { return ENGINE.poseAtK(r.K, t); };
    r.stoneAt = function (st, t) { var e = st.tl[0]; for (var i = 0; i < st.tl.length; i++) if (st.tl[i].t <= t) e = st.tl[i]; return e; };
    var sR = R, sP = params; R = r; params = P;
    try { return { pts: scoreOf(outcome(MATCH)).total, T: r.T }; } finally { R = sR; params = sP; }
  }
  function queueStat(s) { if (!statQ.some(function (q) { return statKey(q) === statKey(s); })) statQ.push(s); nextStat(); }
  function nextStat() {
    if (statBusy || !statQ.length) return;
    var s = statQ.shift(); if (statOf(s) !== null) return nextStat();
    statBusy = true;
    function done(st) {
      statBusy = false;
      statCache[statKey(s)] = st || false; if (st) lsSet(statKey(s), JSON.stringify(st));
      renderStrats(); nextStat();
    }
    api('GET', API + '/' + s.slug).then(function (j) {
      var P = Object.assign({}, DEF, j.params || {}), pr = Array.isArray(j.program) ? j.program : [];
      if (statWorker) {
        var id = ++statId;
        statWorker.onmessage = function (e) { if (e.data.id === id) { var st = null; try { st = statFrom(e.data.r, P); } catch (x) {} done(st); } };
        statWorker.postMessage({ prog: pr, P: P, id: id });
      } else setTimeout(function () { var st = null; try { st = statFrom(ENGINE.simulate(pr, P), P); } catch (x) {} done(st); }, 0);
    }, function () { done(null); });
  }
  function refreshStrats() {
    return api('GET', API).then(function (j) { strats = j.strategies || []; renderStrats(); fillOppSelect(); }, function () {
      strats = []; $('strats').innerHTML = '<li class="emptyl bad">Serveur des stratégies injoignable. L\'export JSON reste disponible.</li>';
      fillOppSelect();
    });
  }
  function doSave(name) {
    api('PUT', API + '/' + slugify(name), { name: name, params: params, program: prog }).then(function () {
      setCurrent(name); markSaved(true); toast('« ' + name + ' » enregistrée', 'ok'); refreshStrats();
    }, function (e) { toast('Échec de l\'enregistrement : ' + e.message, 'bad'); });
  }
  /* Enregistrer : sous le nom affiché en haut (la stratégie ouverte) ; sans nom, demande un nom comme « Enregistrer sous » */
  function save() {
    if (pilot.mode === 'cerveau') { toast('Un cerveau ne s\'enregistre pas comme stratégie. Il joue en direct.', 'bad'); return; }
    var name = $('sName').value.trim() || current;
    if (!slugify(name)) { saveAs(); return; }
    saveNamed(name);
  }
  /* Enregistrer sous : copie sous un nouveau nom, qui devient la stratégie ouverte ; l'ancienne reste telle quelle */
  function saveAs() {
    var d = $('dSaveAs'), inp = $('sAsName'), base = $('sName').value.trim() || current;
    inp.value = base ? base + ' (copie)' : '';
    $('asNote').hidden = !current;
    if (typeof d.showModal !== 'function') { var n = window.prompt('Enregistrer sous', inp.value); if (n && slugify(n.trim())) saveNamed(n.trim()); return; }
    d.showModal(); inp.focus(); inp.select();
  }
  $('fSaveAs').addEventListener('submit', function (e) {
    e.preventDefault();
    var n = $('sAsName').value.trim();
    if (!slugify(n)) { $('sAsName').focus(); return; }
    $('dSaveAs').close(); saveNamed(n);
  });
  $('bAsCancel').addEventListener('click', function () { $('dSaveAs').close(); });
  function saveNamed(name) {
    var slug = slugify(name);
    api('GET', API).then(function (j) {
      strats = j.strategies || [];
      var clash = strats.filter(function (s) { return s.slug === slug; })[0];
      if (clash && slug !== slugify(current)) toast('« ' + clash.name + ' » existe déjà.', 'bad', [['Remplacer', function () { doSave(name); }], ['Annuler', null]]);
      else doSave(name);
    }, function (e) { toast('Serveur injoignable : ' + e.message, 'bad'); });
  }
  function loadStrat(slug) {
    delArm = '';
    api('GET', API + '/' + slug).then(function (j) {
      setPilotMode('strategie'); oursKind = 'strategie';
      var n = importObj(j); setCurrent(j.name); markSaved(true); renderStrats(); closeDrawer();
      time = 0; setPlaying(true); toast('« ' + j.name + ' » ouverte (' + n + ' étapes)', 'ok');
    }, function (e) { toast('Impossible d\'ouvrir : ' + e.message, 'bad'); });
  }
  function delStrat(slug, name) {
    delArm = '';
    api('DELETE', API + '/' + slug).then(function () {
      if (slug === slugify(current)) markSaved(false);
      toast('« ' + name + ' » supprimée'); refreshStrats();
    }, function (e) { toast('Suppression impossible : ' + e.message, 'bad'); renderStrats(); });
  }
  $('sFilter').addEventListener('input', renderStrats);
  $('bNew').addEventListener('click', function () {
    confirmLoss(function () {
      setPilotMode('strategie');
      prog = []; params = Object.assign({}, DEF); sel = -1; writeParams(); setCurrent(''); markSaved(false); changed(true); closeDrawer(); $('sName').focus();
    });
  });
  var brains = [], delBrainArm = '', brainsLoaded = false;
  function renderBrains() {
    var ul = $('brains'); if (!ul) return; ul.innerHTML = '';
    if (!brains.length) {
      ul.innerHTML = '<li class="emptyl">Aucun cerveau enregistré. Entraîne-en un dans l\'Atelier Cerveau.</li>';
      return;
    }
    brains.forEach(function (s) {
      var li = document.createElement('li'); if (pilot.mode === 'cerveau' && s.slug === pilot.slug) li.className = 'cur';
      var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = s.name;
      var meta = document.createElement('span'); meta.className = 'meta';
      meta.textContent = (s.n_parametres || '?') + ' param. · ' + (s.methode || '') + (s.entraine ? ' · entraîné' : ' · non entraîné') + ' · ' + fmtDate(s.updated);
      nm.appendChild(meta); li.appendChild(nm);
      var act = document.createElement('span'); act.className = 'act';
      var bl = document.createElement('button'); bl.type = 'button'; bl.textContent = 'Jouer';
      bl.addEventListener('click', function () { loadBrain(s.slug); });
      act.appendChild(bl); li.appendChild(act); ul.appendChild(li);
    });
  }
  function refreshBrains() {
    return api('GET', '../api/cerveaux').then(function (j) { brains = j.cerveaux || []; brainsLoaded = true; renderBrains(); fillOppSelect(); }, function () {
      brains = []; brainsLoaded = true; fillOppSelect(); $('brains').innerHTML = '<li class="emptyl bad">Serveur des cerveaux injoignable.</li>';
    });
  }
  function loadBrain(slug, keepDrawer) {
    api('GET', '../api/cerveaux/' + slug).then(function (j) {
      return api('GET', '../api/cerveaux/' + slug + '/poids').then(function (w) {
        return { j: j, w: w };
      }, function () { return { j: j, w: null }; });
    }).then(function (pair) {
      var j = pair.j, w = pair.w;
      if (!window.ENV || !window.NET || !window.RUNTIME || !BrainActs) throw new Error('moteur cerveau absent');
      var couches = (j.reseau && j.reseau.couches) || [{ neurones: 64, activation: 'relu' }, { neurones: 64, activation: 'relu' }];
      var familles = (j.actions && j.actions.familles) || BrainActs.FAMILLES.map(function (f) { return f.id; });
      var nIn = window.ENV.nInputs(j.entrees);
      var nOut = BrainActs.filterByFamilles(familles).length;
      var layers = (w && w.layers) ? w.layers : window.NET.randomWeights(nIn, couches, nOut, j.graine || 1);
      setPilotMode('cerveau', { slug: slug, name: j.name, layers: layers, weights: w, cfg: j });
      if (!keepDrawer) closeDrawer();
      oursKind = 'cerveau'; renderMatch();
      var entraine = !!(w && (w.layers || window.RUNTIME.modeleDe(w)));
      toast(entraine
        ? '« ' + j.name + ' » joue en direct'
        : '« ' + j.name + ' » sans poids entraînés : décisions aléatoires parmi les actions valides', entraine ? 'ok' : 'bad');
      time = 0; setPlaying(true);
      recompute();
    }, function (e) { toast('Impossible d\'ouvrir le cerveau : ' + e.message, 'bad'); });
  }
  /* ---------- Match : qui pilote chaque robot ---------- */
  var oursKind = 'strategie';
  function oppKind() { var s = oppChoice.slug; return !s ? 'aucun' : s === 'exemple' ? 'exemple' : s.indexOf('cerveau:') === 0 ? 'cerveau' : s.indexOf('robot:') === 0 ? 'robot' : 'strategie'; }
  function fillSel(sel_, list, cur, placeholder) {
    var h = placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '';
    list.forEach(function (o) { h += '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; });
    sel_.innerHTML = h; sel_.value = cur || '';
  }
  function setPressed(id, attr, val) { document.querySelectorAll('#' + id + ' button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset[attr] === val)); }); }
  function renderMatch() {
    if (!$('mOurSel')) return;
    oursKind = pilot.mode === 'cerveau' ? 'cerveau' : oursKind;
    setPressed('mOurKind', 'k', oursKind);
    if (oursKind === 'cerveau') {
      fillSel($('mOurSel'), brains.map(function (b) { return [b.slug, b.name + (b.entraine ? '' : ' (non entraîné)')]; }), pilot.mode === 'cerveau' ? pilot.slug : '', brains.length ? '— choisir un cerveau —' : 'Aucun cerveau enregistré');
      $('mOurNote').textContent = pilot.mode === 'cerveau' ? 'Il décide en direct jusqu\'à 100 s ; ses décisions apparaissent dans l\'onglet Décisions.' : 'Choisis un cerveau pour qu\'il joue seul.';
    } else {
      fillSel($('mOurSel'), strats.map(function (s) { return [s.slug, s.name]; }), slugify(current || ''), 'Programme en cours' + (current ? ' (' + current + ')' : ' (sans nom)'));
      $('mOurNote').textContent = 'La liste d\'étapes de l\'onglet Programme, ou une stratégie enregistrée.';
    }
    var k = oppKind(); setPressed('mOppKind', 'k', k);
    $('mOppSel').hidden = k === 'aucun' || k === 'exemple';
    $('mOppInt').hidden = k === 'aucun';
    setPressed('mOppInt', 'i', oppChoice.intensity);
    if (k === 'cerveau') fillSel($('mOppSel'), brains.map(function (b) { return [b.slug, b.name + (b.entraine ? '' : ' (non entraîné)')]; }), oppChoice.slug.slice(8), brains.length ? '' : 'Aucun cerveau enregistré');
    if (k === 'strategie') fillSel($('mOppSel'), strats.map(function (s) { return [s.slug, s.name]; }), oppChoice.slug, strats.length ? '' : 'Aucune stratégie enregistrée');
    if (k === 'robot') fillSel($('mOppSel'), ADVERSAIRES.IDS.map(function (id) { var p = ADVERSAIRES.PROFILS[id]; return [id, p.nom + (p.type === 'reseau' ? ' (réseau figé)' : ' (à règles)')]; }), oppChoice.slug.slice(6), '');
    $('mOppInt').hidden = k === 'aucun' || k === 'robot';
    var rn = $('mRobotNote'); if (rn) { rn.hidden = k !== 'robot'; if (k === 'robot') { var pr = ADVERSAIRES.PROFILS[oppChoice.slug.slice(6)]; rn.textContent = pr ? pr.description + ' Esquisse : ' + pr.esquisse + ' pts.' : ''; } }
    renderPhy();
    var bm = $('bMatch'); if (bm) bm.title = 'Match · jaune : ' + (pilot.mode === 'cerveau' ? 'cerveau ' + pilot.name : 'stratégie') + ' · bleu : ' + (k === 'aucun' ? 'aucun' : (currentOpponentName() || k));
  }
  function setOpp(slug) { oppChoice.slug = slug; saveOppChoice(); fillOppSelect(); renderMatch(); recompute(); }
  $('bMatch').addEventListener('click', function () { if (!brains.length) refreshBrains(); renderMatch(); showDrawer('dMatch'); });
  document.querySelectorAll('#mOurKind button').forEach(function (b) {
    b.addEventListener('click', function () {
      oursKind = b.dataset.k;
      if (oursKind === 'strategie' && pilot.mode === 'cerveau') { setPilotMode('strategie'); loadLocalDraft(); recompute(); }
      renderMatch();
    });
  });
  $('mOurSel').addEventListener('change', function () {
    var v = $('mOurSel').value;
    if (oursKind === 'cerveau') { if (v) loadBrain(v, true); }
    else if (v) loadStrat(v);
  });
  document.querySelectorAll('#mOppKind button').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.dataset.k;
      if (k === 'aucun') return setOpp('');
      if (k === 'exemple') return setOpp('exemple');
      if (k === 'strategie') return setOpp(strats.length ? strats[0].slug : '');
      if (k === 'robot') return setOpp('robot:' + ADVERSAIRES.IDS[0]);
      if (!brains.length) return refreshBrains().then(function () { setOpp(brains.length ? 'cerveau:' + brains[0].slug : ''); });
      setOpp('cerveau:' + brains[0].slug);
    });
  });
  $('mOppSel').addEventListener('change', function () { var v = $('mOppSel').value; if (v) setOpp(oppKind() === 'cerveau' ? 'cerveau:' + v : oppKind() === 'robot' ? 'robot:' + v : v); });
  document.querySelectorAll('#mOppInt button').forEach(function (b) {
    b.addEventListener('click', function () { oppChoice.intensity = b.dataset.i; saveOppChoice(); fillOppSelect(); renderMatch(); recompute(); });
  });
  $('mGo').addEventListener('click', function () { closeDrawer(); time = 0; setPlaying(true); recompute(); });
  function loadLocalDraft() { var j = loadLocal(); if (j) { prog = j.program; params = Object.assign({}, DEF, j.params || {}); writeParams(); } sel = -1; renderSteps(); }

  /* cerveau adverse : même réseau qu'un cerveau du joueur, mais il pilote le robot bleu (repère miroir) */
  function loadOppBrain(slug) {
    return api('GET', '../api/cerveaux/' + slug).then(function (j) {
      return api('GET', '../api/cerveaux/' + slug + '/poids').then(function (w) { return { j: j, w: w }; }, function () { return { j: j, w: null }; });
    }).then(function (pair) {
      var j = pair.j, w = pair.w;
      if (!window.ENV || !window.NET || !window.RUNTIME || !BrainActs) throw new Error('moteur cerveau absent');
      var couches = (j.reseau && j.reseau.couches) || [{ neurones: 64, activation: 'relu' }, { neurones: 64, activation: 'relu' }];
      var familles = (j.actions && j.actions.familles) || BrainActs.FAMILLES.map(function (f) { return f.id; });
      var layers = (w && w.layers) ? w.layers : window.NET.randomWeights(window.ENV.nInputs(j.entrees), couches, BrainActs.filterByFamilles(familles).length, j.graine || 1);
      var spec = brainSpec(j.name, layers, j, w);
      oppLoaded['cerveau:' + slug] = { name: 'Cerveau · ' + j.name, brain: spec.brain, params: params };
      if (!(w && (w.layers || spec.brain.model))) toast('« ' + j.name + ' » sans poids entraînés : décisions aléatoires parmi les actions valides', 'bad');
    });
  }
  $('bSave').addEventListener('click', save);
  $('bSaveAs').addEventListener('click', saveAs);
  $('fName').addEventListener('submit', function (e) { e.preventDefault(); save(); });
  $('sName').addEventListener('input', function () { $('state').textContent = $('sName').value.trim() && $('sName').value.trim() !== current ? 'nouveau nom' : ''; if (!$('state').textContent) updateDirty(); });
  $('bLogout').addEventListener('click', function () {
    fetch('../api/logout', { method: 'POST', credentials: 'same-origin' }).finally(function () { location.href = '../'; });
  });

  /* ---------- repères (aide) ---------- */
  (function () {
    var h = '<div class="idgrid"><div><h4>Paquets (3 pierres, .1 en bas)</h4><ul>';
    ENGINE.PK.forEach(function (p) { h += '<li><b>' + p.id + '</b> x ' + p.x + ', y ' + p.y + '</li>'; });
    h += '</ul></div><div><h4>Zones de mur (400 × 200 mm)</h4><ul>';
    ENGINE.ZM.forEach(function (z) { h += '<li><b>' + z.id + '</b> ' + esc(z.name) + '</li>'; });
    h += '</ul><h4>Tours (Ø200 mm)</h4><ul>';
    ENGINE.ZT.forEach(function (z) { h += '<li><b>' + z.id + '</b>' + (parseInt(z.id.slice(1), 10) > 4 ? ' (adverse)' : '') + '</li>'; });
    h += '</ul></div></div><p class="note" style="margin-top:8px">M1 à M5 et T1 à T4 : château jaune. M6 à M10 et T5 à T8 : château adverse. Salle du trône jaune : x 0 à 500, y 750 à 1250.</p>';
    $('ids').innerHTML = h;
  })();

  /* ---------- commandes ---------- */
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var playing = !reduce, speed = 2, last = performance.now(), camMode = 'table', bPlay = $('bPlay');
  function setPlaying(v) { playing = v; bPlay.innerHTML = '<i class="fa-solid ' + (v ? 'fa-pause' : 'fa-play') + '"></i>'; bPlay.setAttribute('aria-label', v ? 'Pause' : 'Lecture'); }
  function togglePlay() { if (time >= TEND) time = 0; setPlaying(!playing); }
  setPlaying(playing);
  bPlay.addEventListener('click', togglePlay);
  $('bRestart').addEventListener('click', function () { time = 0; setPlaying(true); });
  document.querySelectorAll('[data-speed]').forEach(function (b) {
    b.addEventListener('click', function () { speed = parseFloat(b.dataset.speed); document.querySelectorAll('[data-speed]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); });
  });
  document.querySelectorAll('[data-cam]').forEach(function (b) {
    b.addEventListener('click', function () { camMode = b.dataset.cam; setCam(camMode); document.querySelectorAll('[data-cam]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); });
  });
  $('cLab').addEventListener('change', function (e) { labels.visible = e.target.checked; });
  $('cTrail').addEventListener('change', function (e) { showTrail = e.target.checked; if (trail) trail.visible = showTrail; if (shotLines) shotLines.visible = showTrail; if (shotLinesOpp) shotLinesOpp.visible = showTrail; });
  $('cOppTrail').addEventListener('change', function (e) { showOppTrail = e.target.checked; if (trailOpp) trailOpp.visible = showOppTrail; });
  $('cPer').addEventListener('change', function (e) { countPer = e.target.checked; if (R) { computeBad(); drawStrip(); renderAlerts(); renderResults(); } });
  $('pOpp').addEventListener('change', function () {
    oppChoice.slug = $('pOpp').value;
    $('pOppInt').hidden = !oppChoice.slug;
    if (oppChoice.slug.indexOf('cerveau:') === 0 && !brains.length) refreshBrains();
    saveOppChoice(); recompute();
  });
  document.querySelectorAll('#pOppInt button').forEach(function (b) {
    b.addEventListener('click', function () {
      oppChoice.intensity = b.dataset.i;
      document.querySelectorAll('#pOppInt button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      saveOppChoice(); if (oppChoice.slug) recompute();
    });
  });
  for (var k in PIDS) $(PIDS[k]).addEventListener('change', function () { readParams(); changed(); });
  $('bReset').addEventListener('click', function () { params = Object.assign({}, DEF); writeParams(); changed(); toast('Paramètres par défaut remis', '', [['Annuler', doUndo]]); });
  $('bUndo').addEventListener('click', doUndo);
  $('bRedo').addEventListener('click', doRedo);
  $('bExample').addEventListener('click', function () { confirmLoss(function () { prog = JSON.parse(JSON.stringify(EXAMPLE)); sel = -1; changed(true); toast('Stratégie d\'exemple chargée', '', [['Annuler', doUndo]]); }); });
  $('bClear').addEventListener('click', function () {
    if (!prog.length) return;
    toast('Effacer les ' + prog.length + ' étapes ?', 'bad', [['Effacer', function () { prog = []; sel = -1; changed(true); toast('Programme effacé', '', [['Annuler', doUndo]]); }], ['Annuler', null]]);
  });
  var hud = $('hud');
  function setHud(min) { hud.classList.toggle('min', min); $('bHud').setAttribute('aria-expanded', String(!min)); lsSet('icamlot-hud-min', min ? '1' : null); }
  setHud(lsGet('icamlot-hud-min') === '1' || window.innerWidth < 600);
  $('bHud').addEventListener('click', function () { setHud(!hud.classList.contains('min')); });
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { var on = x === t; x.setAttribute('aria-selected', String(on)); $('pane-' + x.dataset.pane).hidden = !on; });
      $('palette').hidden = pilot.mode === 'cerveau' || t.dataset.pane !== 'prog';
    });
  });
  function setView(v) {
    document.body.classList.toggle('v-table', v === 'table'); document.body.classList.toggle('v-prog', v === 'prog');
    $('vTable').setAttribute('aria-pressed', String(v === 'table')); $('vProg').setAttribute('aria-pressed', String(v === 'prog'));
    resize();
  }
  $('vTable').addEventListener('click', function () { setView('table'); });
  $('vProg').addEventListener('click', function () { setView('prog'); });
  $('score').addEventListener('click', function () {
    document.querySelector('.tab[data-pane="res"]').click();
    if (window.matchMedia('(max-width: 900px)').matches) setView('prog');
  });

  /* raccourcis clavier */
  document.addEventListener('keydown', function (e) {
    var tag = e.target.tagName, typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT', mod = e.ctrlKey || e.metaKey, key = e.key;
    if (mod && key.toLowerCase() === 's') { e.preventDefault(); if ($('dSaveAs').open) return; if (e.shiftKey) saveAs(); else save(); return; }
    if ($('dSaveAs').open) return;  /* la boîte « Enregistrer sous » gère ses touches (Échap la ferme) */
    if (key === 'Escape') { if (!$('toast').hidden) hideToast(); else if (openDrawer) closeDrawer(); else if (typing) e.target.blur(); else if (sel >= 0) select(-1); return; }
    if (typing || openDrawer) return;
    if (pilot.mode === 'cerveau') {
      if (key === ' ' && tag !== 'BUTTON') { e.preventDefault(); togglePlay(); return; }
      if (key === 'ArrowLeft' || key === 'ArrowRight') { e.preventDefault(); seek(key === 'ArrowLeft' ? -1 : 1, e.shiftKey); return; }
      if (key === 'Home') { e.preventDefault(); time = 0; return; }
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        if (!prog.length) return; e.preventDefault();
        var dLive = key === 'ArrowUp' ? -1 : 1;
        select(sel < 0 ? (dLive > 0 ? 0 : prog.length - 1) : Math.max(0, Math.min(prog.length - 1, sel + dLive)), true);
      }
      return;
    }
    if (mod && !e.shiftKey && key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return; }
    if (mod && (key.toLowerCase() === 'y' || (e.shiftKey && key.toLowerCase() === 'z'))) { e.preventDefault(); doRedo(); return; }
    if (mod && key.toLowerCase() === 'd') { e.preventDefault(); dupStep(sel); return; }
    if (mod) return;
    if (key === ' ' && tag !== 'BUTTON') { e.preventDefault(); togglePlay(); return; }
    if (key === 'ArrowLeft' || key === 'ArrowRight') { e.preventDefault(); seek(key === 'ArrowLeft' ? -1 : 1, e.shiftKey); return; }
    if (key === 'Home') { e.preventDefault(); time = 0; return; }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      if (!prog.length) return; e.preventDefault();
      var d = key === 'ArrowUp' ? -1 : 1;
      if (e.altKey) moveStep(sel, d); else select(sel < 0 ? (d > 0 ? 0 : prog.length - 1) : Math.max(0, Math.min(prog.length - 1, sel + d)), true);
      return;
    }
    if ((key === 'Delete' || key === 'Backspace') && sel >= 0) { e.preventDefault(); delStep(sel); }
  });
  window.addEventListener('beforeunload', function (e) { if (current && savedSnap && isDirty()) { e.preventDefault(); e.returnValue = ''; } });

  function resize() { drawStrip(); if (!gl) return; var w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; gl.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); if (!camMoved || (w < h) !== camPortrait) setCam(camMode); }
  if (window.ResizeObserver) { new ResizeObserver(resize).observe(canvas); new ResizeObserver(function () { drawStrip(); renderTimeline(); }).observe($('track')); } else window.addEventListener('resize', resize);

  var saved = loadLocal();
  params = Object.assign({}, DEF, saved && saved.params ? saved.params : {});
  prog = saved ? saved.program : JSON.parse(JSON.stringify(EXAMPLE));
  writeParams(); readParams(); lastSnap = snap(); updateUndoBtns(); renderSteps(); updateDirty(); resize(); fillOppSelect(); refreshStrats(); refreshBrains(); recompute();
  (function openPilot() {
    try {
      var raw = sessionStorage.getItem('icamlot-pilot');
      if (raw) {
        sessionStorage.removeItem('icamlot-pilot');
        var p = JSON.parse(raw);
        if (p && p.mode === 'cerveau' && p.slug) {
          if (p.intensity && p.intensity !== 'aucun') oppChoice.intensity = p.intensity;
          loadBrain(p.slug);
          return;
        }
      }
    } catch (e) {}
    try {
      var replay = sessionStorage.getItem('icamlot-replay');
      if (replay) {
        sessionStorage.removeItem('icamlot-replay');
        var o = JSON.parse(replay);
        if (o.opponent && o.opponent.program) {
          oppChoice.intensity = o.intensity || o.opponent.intensity || 'realiste';
          oppLoaded.cerveau = { name: o.opponent.name || 'Cerveau', program: o.opponent.program, params: o.opponent.params || o.params };
          oppChoice.slug = 'cerveau';
          saveOppChoice();
        }
        importObj(o); setCurrent(o.name || ''); markSaved(false);
        fillOppSelect();
        toast('Programme chargé', 'ok');
      }
    } catch (e) {}
    var m = /[?&]strategie=([a-z0-9-]+)/.exec(location.search);
    if (m) loadStrat(m[1]);
    var b = /[?&]cerveau=([^&]+)/.exec(location.search);
    if (b) loadBrain(slugify(decodeURIComponent(b[1])));
  })();

  var followOff = new THREE.Vector3(-800, 1000, 800), vT = new THREE.Vector3(), vC = new THREE.Vector3();
  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (R && playing && !dragging) { time += dt * speed; if (time >= TEND) { time = TEND; setPlaying(false); } }
    update(time);
    if (gl) {
      if (camMode === 'follow') { controls.target.lerp(vT.set(robot.position.x, 150, robot.position.z), 0.1); camera.position.lerp(vC.set(robot.position.x + followOff.x, followOff.y, robot.position.z + followOff.z), 0.05); }
      controls.update(); gl.render(scene, camera);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
