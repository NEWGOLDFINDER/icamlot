/* Simulation du plateau : interface (programme, table 3D, frise, stratégies).
   Le moteur (GEO, ENGINE) est défini dans index.html et tourne aussi dans un Web Worker. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var MATCH = 100;
  var DEF = { v: 0.5, va: 0.2, w: 120, vz: 100, trot: 1.5, tvac: 0.5, trel: 0.4, x0: 250, y0: 1000, h0: 0, gx: 100, gy: 1180, gs: 60, zmin: 140, zmax: 0,
    tx: 250, ty: 1000, cl: 80, cw: 60, bn: 10, brate: 2, bdep: 1, bspin: 0.5, bel: 35, bh: 250, btx: 2625, bmode: 'arret',
    bm: 2, bcd: 0.47, be: 0.5, bmu: 0.3, bcr: 0.05, bdv: 5, bdaz: 2, bdel: 2, bseed: 1 };
  var PIDS = { v: 'pV', va: 'pVA', w: 'pW', vz: 'pVZ', trot: 'pTR', tvac: 'pTV', trel: 'pTL', x0: 'pX0', y0: 'pY0', h0: 'pH0', gx: 'pGX', gy: 'pGY', gs: 'pGS', zmin: 'pZmin', zmax: 'pZmax',
    tx: 'pTX', ty: 'pTY', cl: 'pCL', cw: 'pCW', bn: 'pBN', brate: 'pBRate', bdep: 'pBDep', bspin: 'pBSpin', bel: 'pBEl', bh: 'pBH', btx: 'pBTx', bmode: 'pBMode',
    bm: 'pBM', bcd: 'pBCd', be: 'pBE', bmu: 'pBMu', bcr: 'pBCr', bdv: 'pBDv', bdaz: 'pBDaz', bdel: 'pBDel', bseed: 'pBSeed' };
  /* paramètres qui peuvent valoir 0 */
  var ZERO_OK = ['tvac', 'trel', 'x0', 'y0', 'h0', 'gx', 'gy', 'zmin', 'zmax', 'tx', 'ty', 'cl', 'cw', 'bn', 'bdep', 'bspin', 'bel', 'be', 'bmu', 'bcr', 'bdv', 'bdaz', 'bdel', 'bseed'];
  var EXAMPLE = [
    { a: 'prendre', f: 'A', p: 'P1' }, { a: 'prendre', f: 'B', p: 'P9' },
    { a: 'mur', f: 'A', z: 'M1', side: 'ext' }, { a: 'mur', f: 'B', z: 'M2', side: 'ext' },
    { a: 'prendre', f: 'A', p: 'P5' }, { a: 'prendre', f: 'B', p: 'P10' },
    { a: 'mur', f: 'A', z: 'M5', side: 'ext' }, { a: 'mur', f: 'B', z: 'M4', side: 'ext' },
    { a: 'prendre', f: 'A', p: 'P4' },
    { a: 'porte', f: 'A', z: 'M3', side: 'int' },
    { a: 'prendreGraal', f: 'B' }, { a: 'poserGraal', f: 'B', z: 'M3' },
    { a: 'tir' }
  ];
  var ACTIONS = [
    ['prendre', 'Prendre (paquet ou pierre)'], ['deposer', 'Déposer en x, y, angle'], ['mur', 'Poser en mur'], ['tour', 'Faire une tour'], ['porte', 'Faire une porte'],
    ['tir', 'Commencer la séance de tir (canon, face C)'], ['prendreGraal', 'Prendre le Graal'], ['poserGraal', 'Poser le Graal sur'],
    ['tourner', 'Tourner la pince (0, 90, 180°)'], ['attendre', 'Attendre (s)'], ['attendreJusqua', 'Attendre jusqu\'à (s)'], ['trone', 'Aller dans la salle du trône']
  ];
  var SHORT = { prendre: 'Prendre', deposer: 'Déposer', mur: 'Mur', tour: 'Tour', porte: 'Porte', tir: 'Tir', prendreGraal: 'Prendre Graal', poserGraal: 'Poser Graal', tourner: 'Tourner', attendre: 'Attendre', attendreJusqua: 'Attendre jusqu\'à', trone: 'Trône' };
  var ICONS = { prendre: 'fa-hand', deposer: 'fa-location-crosshairs', mur: 'fa-grip-lines', tour: 'fa-chess-rook', porte: 'fa-archway', tir: 'fa-bullseye', prendreGraal: 'fa-trophy', poserGraal: 'fa-award', tourner: 'fa-rotate-right', attendre: 'fa-hourglass-half', attendreJusqua: 'fa-clock', trone: 'fa-crown' };
  var FIELDS = { prendre: ['f', 'mode', 'p', 's', 'v', 'tm'], deposer: ['f', 'q', 'xy', 'ang', 'r', 'drop', 'tm'], tourner: ['f', 'r', 'tm'], mur: ['f', 'zm', 'side'], tour: ['f', 'zt', 's', 'tm'], porte: ['f', 'zm', 'side', 'tm'], tir: [], prendreGraal: ['f', 'tm'], poserGraal: ['f', 'gm', 'zmt', 'xy', 'tm'], attendre: ['sec'], attendreJusqua: ['sec'], trone: [] };
  var PKIDS = ENGINE.PK.map(function (p) { return p.id; }), MIDS = ENGINE.ZM.map(function (z) { return z.id; }), TIDS = ENGINE.ZT.map(function (z) { return z.id; });
  var SIDS = []; PKIDS.forEach(function (p) { for (var l = 1; l <= 3; l++) SIDS.push(p + '.' + l); });
  var prog = [], params = {}, sel = -1;
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
      if (st.a === 'poserGraal') return st.gm === 'xy' ? k !== 'zmt' : k !== 'xy';
      if (st.a !== 'prendre') return true;
      return st.mode === 'pierre' ? k !== 'p' : k !== 's' && k !== 'v';
    });
  }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- stockage navigateur (brouillon en cours) ---------- */
  function saveLocal() { lsSet('camelot-prog-v1', JSON.stringify({ params: params, program: prog })); }
  function loadLocal() { try { var j = JSON.parse(lsGet('camelot-prog-v1') || 'null'); if (j && Array.isArray(j.program)) { j.program.forEach(upgradeStep); return j; } } catch (e) {} return null; }
  function upgradeStep(st) { if (st && st.a === 'boulets') st.a = 'tir'; return st; }

  /* ---------- paramètres ---------- */
  function writeParams() { for (var k in PIDS) $(PIDS[k]).value = params[k]; }
  function readParams() {
    for (var k in PIDS) {
      if (typeof DEF[k] === 'string') { params[k] = $(PIDS[k]).value || DEF[k]; continue; }
      var v = parseFloat($(PIDS[k]).value), zeroOk = ZERO_OK.indexOf(k) >= 0;
      params[k] = isFinite(v) && (zeroOk ? v >= 0 || k === 'h0' : v > 0) ? v : DEF[k];
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
    if (rerender) renderSteps();
    pushHistory(); saveLocal(); updateDirty();
    clearTimeout(timer); timer = setTimeout(recompute, 250);
  }

  /* ---------- description d'une étape ---------- */
  function sideTxt(s) { return s === 'ext' ? ' · de l\'extérieur' : s === 'int' ? ' · de l\'intérieur' : ''; }
  function describe(st) {
    var f = st.f ? ' · face ' + st.f : '';
    switch (st.a) {
      case 'prendre': return st.mode === 'pierre' ? 'Prendre la pierre ' + st.s + f : 'Prendre ' + st.p + f;
      case 'deposer': var rd = rotOf(st); return 'Déposer ' + (st.q === 'pile' ? 'la pile' : st.q) + ' en ' + Math.round(st.x) + ', ' + Math.round(st.y) + ', ' + fmt(st.ang) + '° · ' + (rd === 90 ? 'debout' : rd === 180 ? 'à plat retournée' : 'à plat') + (st.drop ? ' · lâcher' : '') + f;
      case 'tourner': return 'Tourner la pince ' + st.f + ' à ' + (+st.r || 0) + '°' + (st.tm ? ' · pendant le trajet suivant' : '');
      case 'mur': return 'Mur en ' + st.z + f + sideTxt(st.side);
      case 'tour': return 'Tour ' + st.z + ' avec ' + st.s + f;
      case 'porte': return 'Porte en ' + st.z + f + sideTxt(st.side);
      case 'tir': return 'Séance de tir : salle du trône, face C vers le camp adverse (à partir de 85 s)';
      case 'prendreGraal': return 'Prendre le Graal' + f;
      case 'poserGraal': return st.gm === 'xy' ? 'Poser le Graal en ' + Math.round(st.x) + ', ' + Math.round(st.y) + f : 'Poser le Graal sur ' + st.z + f;
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
      if (k === 'mode') st.mode = 'paquet'; if (k === 'gm') st.gm = 'zone'; if (k === 'v') st.v = 'auto'; if (k === 'tm') st.tm = true;
      if (k === 'q') st.q = 'pile'; if (k === 'xy') { st.x = 1200; st.y = 1000; } if (k === 'ang') st.ang = 0;
      if (k === 'r') st.r = a === 'tourner' ? 90 : 0; if (k === 'drop') st.drop = false;
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
      if (k === 's') d.appendChild(fld('Pierre', mkSel('Pierre', SIDS.map(function (p) { return [p, 'Pierre ' + p]; }), st.s, function (v) { setField(i, 's', v); })));
      if (k === 'mode') d.appendChild(fld('Prendre', mkSeg('Prendre', [['paquet', 'Paquet (3)'], ['pierre', 'Une pierre (dessus)']], st.mode || 'paquet', function (v) { prog[i].mode = v; changed(true); })));
      if (k === 'v') d.appendChild(fld('Ventouse', mkSel('Ventouse', [['auto', 'Auto (pince au plus près de 165 mm)'], ['1', 'Ventouse 1 (bas)'], ['2', 'Ventouse 2 (milieu)'], ['3', 'Ventouse 3 (haut)']], st.v || 'auto', function (v) { setField(i, 'v', v); })));
      if (k === 'q') d.appendChild(fld('Quoi', mkSel('Pierres déposées', [['pile', 'Toute la pile tenue']].concat(SIDS.map(function (p) { return [p, 'Pierre ' + p]; })), st.q, function (v) { setField(i, 'q', v); })));
      if (k === 'gm') d.appendChild(fld('Poser', mkSeg('Poser le Graal', [['zone', 'Sur une construction'], ['xy', 'En x, y']], st.gm || 'zone', function (v) { prog[i].gm = v; changed(true); })));
      if (k === 'r') d.appendChild(fld(st.a === 'tourner' ? 'Angle' : 'Pince', mkSeg('Angle de la pince', st.a === 'tourner' ? [['0', '0°'], ['90', '90°'], ['180', '180°']] : [['0', '0° à plat'], ['90', '90° debout'], ['180', '180° retournée']], String(rotOf(st)), function (v) { delete prog[i].o; setField(i, 'r', +v); })));
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
        if (k === 'ang') { var nt = document.createElement('div'); nt.className = 'muted'; nt.style.fontSize = '12px'; nt.textContent = 'Angle du grand côté de la pierre (ou de la rangée debout) : 0° le long de x, positif vers +y, comme l\'orientation de départ.'; d.appendChild(nt); }
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
    prog.forEach(function (st, i) {
      var li = document.createElement('li'); li.className = 'step' + (i === sel ? ' sel' : ''); li.draggable = true; li.dataset.i = i;
      var row = document.createElement('div'); row.className = 'srow';
      row.innerHTML = '<span class="grip" title="Glisser pour déplacer">⋮⋮</span><span class="num">' + (i + 1) + '</span><i class="ico fa-solid ' + ICONS[st.a] + '"></i><span class="txt"></span><span class="tm" id="tm' + i + '"></span>';
      row.querySelector('.txt').textContent = describe(st);
      row.addEventListener('click', function () { select(i === sel ? -1 : i, true); });
      li.appendChild(row);
      var er = document.createElement('div'); er.className = 'serr'; er.id = 'er' + i; er.hidden = true; li.appendChild(er);
      if (i === sel) li.appendChild(editor(st, i));
      li.addEventListener('dragstart', function (e) { dragFrom = i; li.classList.add('drag'); try { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; } catch (x) {} });
      li.addEventListener('dragend', function () { li.classList.remove('drag'); });
      li.addEventListener('dragover', function (e) { e.preventDefault(); li.classList.add('over'); });
      li.addEventListener('dragleave', function () { li.classList.remove('over'); });
      li.addEventListener('drop', function (e) {
        e.preventDefault(); li.classList.remove('over'); if (dragFrom < 0 || dragFrom === i) return;
        var m = prog.splice(dragFrom, 1)[0]; prog.splice(i, 0, m); if (sel === dragFrom) sel = i; dragFrom = -1; changed(true);
      });
      stepsEl.appendChild(li);
    });
    if (!prog.length) stepsEl.innerHTML = '<li class="empty"><b>Programme vide</b>Ajoute une première étape avec les boutons du bas, ou charge l\'exemple.</li>';
    $('palLab').textContent = sel >= 0 ? 'Ajouter après l\'étape ' + (sel + 1) : 'Ajouter à la fin';
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
  try {
    var src = $('geomSrc').textContent + '\n' + $('engSrc').textContent + '\nonmessage=function(e){var r=ENGINE.simulate(e.data.prog,e.data.P);delete r.poseAt;delete r.stoneAt;postMessage({id:e.data.id,r:r});};';
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = function (e) { if (e.data.id === reqId) accept(e.data.r); };
    worker.onerror = function () { worker = null; recompute(); };
  } catch (e) { worker = null; }
  function recompute() {
    readParams(); $('busy').hidden = false;
    var data = { prog: JSON.parse(JSON.stringify(prog)), P: Object.assign({}, params), id: ++reqId };
    if (worker) worker.postMessage(data);
    else setTimeout(function () { var r = ENGINE.simulate(data.prog, data.P); accept(r); }, 0);
  }
  function accept(r) {
    r.poseAt = function (t) { return ENGINE.poseAtK(r.K, t); };
    r.stoneAt = function (st, t) { var e = st.tl[0]; for (var i = 0; i < st.tl.length; i++) if (st.tl[i].t <= t) e = st.tl[i]; return e; };
    R = r; $('busy').hidden = true; updateDrop();
    TEND = Math.max(MATCH, Math.ceil(R.T + 1));
    $('track').setAttribute('aria-valuemax', String(TEND));
    var tot = $('tot'), nErr = R.errors.length;
    tot.textContent = 'Durée ' + fmt(R.T) + ' s' + (R.T <= MATCH ? '' : ' (+' + fmt(R.T - MATCH) + ' s)');
    tot.className = 'tot ' + (R.T <= MATCH && !nErr ? 'ok' : 'bad');
    showStepInfo(); buildTrail(); buildShots(); updateCannon(); computeBad(); drawStrip(); renderResults(); renderAlerts(); renderTimeline();
    if (time > TEND) time = TEND;
  }

  /* ---------- géométrie côté page ---------- */
  var BARS = [{ y: -110, hl: 105, r: 25 }, { y: 0, hl: 105, r: 25 }, { y: 70, hl: 90, r: 10 }];
  function gripTop(g) { var th = g.rot * Math.PI / 180, c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th)), m = 0; BARS.forEach(function (b) { m = Math.max(m, b.y * Math.cos(th) + b.hl * s + b.r * c); }); return g.hc + m; }
  function hullPer(P) {
    P = P.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [];
    P.forEach(function (q) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); });
    for (var i = P.length - 1; i >= 0; i--) { var q = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    var H = lo.slice(0, -1).concat(up.slice(0, -1)), per = 0;
    for (var j = 0; j < H.length; j++) { var a = H[j], b = H[(j + 1) % H.length]; per += Math.hypot(a[0] - b[0], a[1] - b[1]); }
    return per;
  }
  /* empreinte du robot : triangle, + canon de la face C une fois déployé (séance de tir) */
  function canOut(t) { return R && R.balls.tDeploy != null && t >= R.balls.tDeploy; }
  function robotFoot(p, t) { return canOut(t) ? triPoly(p).concat(cannonPoly(p, params.cl, params.cw) || []) : triPoly(p); }
  function inCastle(x, y) { return ENGINE.inPoly(x, y, ENGINE.CASTLE) || ENGINE.inPoly(x, y, ENGINE.CASTLE_B); }
  var countPer = true;
  function graalAt(t) { var e = R.graal.tl[0]; for (var i = 0; i < R.graal.tl.length; i++) if (R.graal.tl[i].t <= t) e = R.graal.tl[i]; return e; }
  /* repère d'une pierre à l'instant t (mêmes formules que le moteur) */
  function stoneGeoAt(st, t) {
    var e = R.stoneAt(st, t);
    if (e.k === 'home') { var pk = ENGINE.PK[st.pk]; return { c: [pk.x, pk.y], ang: pk.tan + 90, top: 110 * st.l + 110, e: e }; }
    var p = e.k === 'held' ? R.poseAt(t) : e.pose, g = p[e.f], th = g.rot * Math.PI / 180, fo = heldFoot(p, e.f === 'A' ? 0 : 1, e.l);
    return { c: [fo.cx, fo.cy], ang: fo.ang, top: g.hc + 110 * (e.l - 1) * Math.cos(th) + 160 * Math.abs(Math.sin(th)) + 55 * Math.abs(Math.cos(th)), e: e };
  }
  function zoneAtXY(c) {
    for (var i = 0; i < ENGINE.ZM.length; i++) { var z = ENGINE.ZM[i]; if (ENGINE.inPoly(c[0], c[1], rectPoly({ cx: z.c[0], cy: z.c[1], hl: 200, hn: 100, ang: z.tan + 90 }))) return z.id; }
    for (var j = 0; j < ENGINE.ZT.length; j++) if (Math.hypot(c[0] - ENGINE.ZT[j].c[0], c[1] - ENGINE.ZT[j].c[1]) <= 100) return ENGINE.ZT[j].id;
    return null;
  }
  /* Graal posé sur une pierre : il suit la pierre ; sa zone est recalculée si la pierre a bougé depuis la pose */
  function graalPos(t) {
    var ge = graalAt(t); if (ge.k !== 'ride') return null;
    var st = R.stones.filter(function (x) { return x.id === ge.s; })[0], fr = stoneGeoAt(st, t), n = nv(fr.ang), u = lv(fr.ang);
    var c = [fr.c[0] + ge.du * u[0] + ge.dv * n[0], fr.c[1] + ge.du * u[1] + ge.dv * n[1]], moved = fr.e.t > ge.t + 1e-6;
    return { c: c, top: fr.top + params.gs, ang: fr.ang, held: fr.e.k === 'held', zone: moved ? zoneAtXY(c) : ge.zone };
  }
  function checks(t) {
    var p = R.poseAt(t), robotH = Math.max(345, gripTop(p.A), gripTop(p.B)), pts = robotFoot(p, t), oTop = 0, oLim = 350, bad = false, objBad = false, n = 0;
    R.stones.forEach(function (st) {
      var e = R.stoneAt(st, t); if (e.k !== 'held') return; n++;
      var g = p[e.f], th = g.rot * Math.PI / 180, top = g.hc + 110 * (e.l - 1) * Math.cos(th) + 160 * Math.abs(Math.sin(th)) + 55 * Math.abs(Math.cos(th));
      var fo = heldFoot(p, e.f === 'A' ? 0 : 1, e.l), lim = inCastle(fo.cx, fo.cy) ? 430 : 350;
      if (top > lim + 0.5) objBad = true; if (top > oTop) { oTop = top; oLim = lim; }
      if (countPer) pts = pts.concat(rectPoly(fo));
    });
    var ge = graalAt(t), gTop = 0;
    if (ge.k === 'ride') { var gp = graalPos(t); gTop = gp.top; if (gTop > 430.5) objBad = true; if (gp.held) { n++; if (gTop > oTop) { oTop = gTop; oLim = 430; } } }
    if (ge.k === 'held' || ge.k === 'free') { gTop = ge.k === 'held' ? p[ge.f].hc - 110 + params.gs / 2 : (ge.top != null ? ge.top : ge.pose[ge.f].hc - 110 + params.gs); var glim = 430; if (gTop > glim + 0.5) objBad = true; if (ge.k === 'held') { n++; if (gTop > oTop) { oTop = gTop; oLim = glim; } } }
    var per = hullPer(pts), plim = t <= 0.01 ? 1200 : 1400;
    var col = false; R.collisions.forEach(function (c) { if (t >= c.t - 0.001 && t < c.t + 0.1) col = true; });
    var why = [];
    if (robotH > 350.5) why.push('hauteur du robot'); if (objBad) why.push('hauteur des objets'); if (per > plim + 0.5) why.push('périmètre'); if (col) why.push('contact');
    bad = why.length > 0;
    return { p: p, robotH: robotH, oTop: oTop, oLim: oLim, n: n, per: per, plim: plim, gTop: gTop, bad: bad, why: why };
  }

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
      var m = box(320, 110, 110, stoneMat[l]);
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
  var ghostG = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ghostMat); ghostG.add(new THREE.LineSegments(new THREE.EdgesGeometry(ghostG.geometry), ghostEdge)); ghostG.visible = false; scene.add(ghostG);
  function updateGhost() {
    var st = sel >= 0 ? prog[sel] : null, isG = st && st.a === 'poserGraal' && st.gm === 'xy';
    var inf = st && (st.a === 'deposer' || isG) && R ? R.stepInfo[sel] : null, gh = inf && inf.ghost;
    ghostG.visible = !!(isG && gh);
    if (ghostG.visible) { var gw = W(st.x, st.y); ghostG.scale.setScalar(params.gs); ghostG.position.set(gw[0], gh.feet[0].zc, gw[1]); }
    ghosts.forEach(function (m, j) {
      var ft = !isG && gh && gh.feet[j]; m.visible = !!ft; if (!ft) return;
      var a = (+st.ang || 0) * Math.PI / 180, u = [Math.cos(a), Math.sin(a)], v = [-Math.sin(a), Math.cos(a)];
      var w = W(st.x + ft.u * u[0] + ft.v * v[0], st.y + ft.u * u[1] + ft.v * v[1]);
      m.position.set(w[0], ft.zc, w[1]); m.rotation.set(0, -a, ft.vertical ? Math.PI / 2 : 0);
    });
    var c = inf && inf.err ? 0xd62f2f : 0x2fbf71; ghostMat.color.setHex(c); ghostEdge.color.setHex(c);
  }

  /* robot */
  var robot = new THREE.Group(); scene.add(robot);
  var yellow = mat(0xf2b600, 0.5, 0.1), blue = mat(0x3a6fd0, 0.55, 0.15), dark = mat(0x39414e, 0.5, 0.3), black = mat(0x1d2128, 0.8, 0);
  var shp = new THREE.Shape();
  [180, 300, 60].forEach(function (a, i) { var r = a * Math.PI / 180, x = GEO.R * Math.cos(r), z = GEO.R * Math.sin(r); if (i) shp.lineTo(x, -z); else shp.moveTo(x, -z); });
  var plateGeo = new THREE.ExtrudeGeometry(shp, { depth: 20, bevelEnabled: false });
  [70, 220].forEach(function (y) { var pl = new THREE.Mesh(plateGeo, dark); pl.rotation.x = -Math.PI / 2; pl.position.y = y; pl.castShadow = true; robot.add(pl); });
  var elec = cyl(70, 70, 130, yellow, 3); elec.rotation.y = Math.PI / 6; elec.position.set(-25, 155, 0); robot.add(elec);
  var lidar = cyl(38, 38, 40, black); lidar.position.set(-30, 260, 0); robot.add(lidar);
  [180, 300, 60].forEach(function (a) { var r = a * Math.PI / 180, g = new THREE.Group(); g.position.set(150 * Math.cos(r), 50.8, 150 * Math.sin(r)); g.rotation.y = -r; robot.add(g); var wh = cyl(50.8, 50.8, 39.5, black, 24); wh.rotation.z = Math.PI / 2; g.add(wh); });
  var rc = nv(240), bau = cyl(22, 22, 25, mat(0xd62f2f, 0.4, 0.1)); bau.position.set(60 * rc[0], 245, 60 * rc[1]); robot.add(bau);
  function makeModule(k) {
    var face = new THREE.Group(); face.rotation.y = -k * 120 * Math.PI / 180; robot.add(face);
    var mod = new THREE.Group(); mod.position.x = GEO.rin; face.add(mod);
    [-175, 175].forEach(function (z) { var u = box(20, 345, 20, blue); u.position.set(-40, 172.5, z); mod.add(u); });
    var tb = box(20, 15, 370, blue); tb.position.set(-40, 337.5, 0); mod.add(tb);
    var carr = new THREE.Group(); mod.add(carr);
    var cross = box(14, 14, 330, blue); cross.position.set(-40, 0, 0); carr.add(cross);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(58, 3.5, 10, 48), new THREE.MeshStandardMaterial({ color: 0xd62f2f, roughness: 0.5 })); ring.rotation.y = Math.PI / 2; ring.position.set(-34, 0, 0); carr.add(ring);
    var grip = new THREE.Group(); carr.add(grip);
    var spine = box(6, 200, 14, blue); spine.position.set(-27, -20, 0); grip.add(spine);
    var mats = [0, 1, 2].map(function () { return new THREE.MeshStandardMaterial({ color: 0xd62f2f, roughness: 0.55 }); });
    BARS.forEach(function (b, i) {
      var bar = box(6, 14, 2 * (b.hl - b.r) + 20, blue); bar.position.set(-27, b.y, 0); grip.add(bar);
      [-80, 80].forEach(function (z) { var c = cyl(b.r * 0.4, b.r, 24, mats[i]); c.rotation.z = -Math.PI / 2; c.position.set(-12, b.y, z); grip.add(c); });
    });
    var gcup = cyl(8, 16, 24, mats[0]); gcup.rotation.z = -Math.PI / 2; gcup.position.set(-12, -110, 0); grip.add(gcup);
    var lab = box(4, 40, 40, k ? mat(0x2aa3a3, 0.5, 0.1) : mat(0x8a5cd0, 0.5, 0.1)); lab.position.set(-60, 300, 0); mod.add(lab);
    return { carr: carr, grip: grip, mats: mats };
  }
  var MOD = { A: makeModule(0), B: makeModule(1) };
  var graalM = box(60, 60, 60, new THREE.MeshStandardMaterial({ color: 0xe8c547, roughness: 0.3, metalness: 0.6 })); scene.add(graalM);
  var ballMat = new THREE.MeshStandardMaterial({ color: 0xf2b600, roughness: 0.8 }), balls = [];
  for (var bi = 0; bi < 10; bi++) { var bm = new THREE.Mesh(new THREE.SphereGeometry(22.5, 16, 12), ballMat); bm.castShadow = true; scene.add(bm); balls.push(bm); }
  /* position d'un boulet tg secondes après son tir (points enregistrés toutes les 20 ms) */
  function ballAt(b, tg) {
    var P = b.pts; if (tg >= P[P.length - 1][0]) return P[P.length - 1].slice(1);
    var lo = 0, hi = P.length - 1; while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (P[mid][0] <= tg) lo = mid; else hi = mid; }
    var a = P[lo], c = P[hi], u = c[0] > a[0] ? (tg - a[0]) / (c[0] - a[0]) : 0;
    return [a[1] + (c[1] - a[1]) * u, a[2] + (c[2] - a[2]) * u, a[3] + (c[3] - a[3]) * u];
  }
  /* canon sur la face C (dimensions et élévation des paramètres) */
  var canG = new THREE.Group(); canG.rotation.y = -240 * Math.PI / 180; robot.add(canG);
  var canTube = cyl(1, 1, 1, mat(0x5a6170, 0.4, 0.6), 20); canG.add(canTube);
  function updateCannon() {
    var L = params.cl || 0, Wd = params.cw || 40, el = (params.bel || 0) * Math.PI / 180, len = Math.max(60, L + 120);
    canTube.scale.set(Wd / 2, len, Wd / 2); canTube.rotation.set(0, 0, -(Math.PI / 2 - el));
    canTube.position.set(GEO.rin + L - Math.cos(el) * len / 2, (params.bh || 250) - Math.sin(el) * len / 2, 0);
  }
  var shotLines = null;
  function buildShots() {
    if (shotLines) { scene.remove(shotLines); shotLines.children.forEach(function (l) { l.geometry.dispose(); }); }
    shotLines = new THREE.Group(); shotLines.visible = showTrail; scene.add(shotLines);
    (R.balls.shots || []).forEach(function (b) {
      var pts = b.pts.map(function (q) { var w = W(q[1], q[2]); return new THREE.Vector3(w[0], q[3], w[1]); });
      shotLines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: b.cour ? 0xf2b600 : 0xff6b6b, transparent: true, opacity: 0.6 })));
    });
  }
  var trail = null, showTrail = true;
  function buildTrail() {
    if (trail) { scene.remove(trail); trail.geometry.dispose(); }
    var pts = []; for (var t = 0; t <= R.T; t += 0.1) { var p = R.poseAt(t), w = W(p.x, p.y); pts.push(new THREE.Vector3(w[0], 2, w[1])); }
    trail = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff3d7f })); trail.visible = showTrail; scene.add(trail);
  }
  function placeRobot(p) {
    var w = W(p.x, p.y); robot.position.set(w[0], 0, w[1]); robot.rotation.y = -p.h * Math.PI / 180;
    ['A', 'B'].forEach(function (f) { MOD[f].carr.position.y = p[f].hc; MOD[f].grip.rotation.x = p[f].rot * Math.PI / 180; });
    robot.updateMatrixWorld(true);
  }
  var tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), loc = new THREE.Object3D();
  function fromGrip(mesh, f, lx, ly, ry) {
    loc.position.set(lx, ly, 0); loc.rotation.set(0, ry, 0); loc.updateMatrix();
    tmpM.multiplyMatrices(MOD[f].grip.matrixWorld, loc.matrix); tmpM.decompose(tmpV, tmpQ, tmpS);
    mesh.position.copy(tmpV); mesh.quaternion.copy(tmpQ);
  }

  /* ---------- choix d'un repère en cliquant sur la table ---------- */
  function targetKinds(st) {
    var k = [];
    fieldsOf(st).forEach(function (f) {
      if (f === 'xy') k.push('XY'); if (f === 'p') k.push('P'); if (f === 'zm') k.push('M'); if (f === 'zt') k.push('T'); if (f === 'zmt') k.push('M', 'T'); if (f === 's') k.push('S');
    });
    return k;
  }
  function pickText(kinds) {
    var w = [];
    if (kinds.indexOf('P') >= 0) w.push('un paquet (P)'); if (kinds.indexOf('M') >= 0) w.push('une zone de mur (M)');
    if (kinds.indexOf('T') >= 0) w.push('une tour (T)'); if (kinds.indexOf('S') >= 0) w.push('une pierre'); if (kinds.indexOf('XY') >= 0) w.push('le point de dépôt');
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
    if (kinds.indexOf('XY') >= 0) {
      var hp = ray.intersectObjects([topM].concat(stoneMeshes), false)[0]; if (!hp) return null;
      var px = Math.round((hp.point.x + 1500) / 5) * 5, py = Math.round((hp.point.z + 1000) / 5) * 5;
      return px >= 0 && px <= 3000 && py >= 0 && py <= 2000 ? { kind: 'XY', x: px, y: py } : null;
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
  /* état de la table à l'instant t : constructions, Graal, retour du roi, boulets */
  function own(id) { var n = parseInt(id.slice(1), 10); return id[0] === 'M' ? n <= 5 : n <= 4; }
  function outcome(T) {
    var fin = {};
    R.stones.forEach(function (st) {
      var e = R.stoneAt(st, T);
      if (e.k === 'home') { var pk = ENGINE.PK[st.pk]; fin[st.id] = { foot: rectPoly({ cx: pk.x, cy: pk.y, hl: 160, hn: 55, ang: pk.tan + 90 }), v: false, bottom: 110 * st.l, home: true }; }
      else if (e.k === 'free') { var g = e.pose[e.f], th = g.rot * Math.PI / 180, fo = heldFoot(e.pose, e.f === 'A' ? 0 : 1, e.l), zc = g.hc + 110 * (e.l - 1) * Math.cos(th); fin[st.id] = { foot: rectPoly(fo), v: Math.abs(Math.sin(th)) > 0.7, bottom: zc - (160 * Math.abs(Math.sin(th)) + 55 * Math.abs(Math.cos(th))) }; }
    });
    function zr(z) { return rectPoly({ cx: z.c[0], cy: z.c[1], hl: 200, hn: 100, ang: z.tan + 90 }); }
    var walls = [], doors = [], towers = [], inZ = {}, inOwn = {};
    ENGINE.ZM.forEach(function (z) {
      var P = zr(z), ss = Object.keys(fin).filter(function (k) { return !fin[k].home && overlap(fin[k].foot, P, 0); });
      ss.forEach(function (k) { inZ[k] = 1; if (own(z.id)) inOwn[k] = 1; });
      var h = ss.filter(function (k) { return !fin[k].v; }), v = ss.filter(function (k) { return fin[k].v; });
      if (v.length >= 2 && h.some(function (k) { return fin[k].bottom > 300; })) doors.push(z.id);
      else if (h.length >= 3) walls.push(z.id);
    });
    ENGINE.ZT.forEach(function (z) {
      Object.keys(fin).forEach(function (k) {
        if (fin[k].home) return; var d = 1e9, P = fin[k].foot;
        if (ENGINE.inPoly(z.c[0], z.c[1], P)) d = 0; else for (var i = 0; i < 4; i++) { var a = P[i], b = P[(i + 1) % 4], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, u = Math.max(0, Math.min(1, ((z.c[0] - a[0]) * dx + (z.c[1] - a[1]) * dy) / L)); d = Math.min(d, Math.hypot(z.c[0] - a[0] - u * dx, z.c[1] - a[1] - u * dy)); }
        if (d < 100) { inZ[k] = 1; if (own(z.id)) inOwn[k] = 1; if (fin[k].v && towers.indexOf(z.id) < 0) towers.push(z.id); }
      });
    });
    var ge = graalAt(T), tri = robotFoot(R.poseAt(T), T);
    var throneFull = tri.every(function (v) { return ENGINE.inPoly(v[0], v[1], ENGINE.THRONE); });
    var thronePart = !throneFull && (overlap(triPoly(R.poseAt(T)), ENGINE.THRONE, 0) || tri.some(function (v) { return ENGINE.inPoly(v[0], v[1], ENGINE.THRONE); }));
    /* boulets : arrêtés dans la cour adverse à la fin du match (100 s), tirés pendant la phase d'attaque */
    var nBalls = 0;
    (R.balls.shots || []).forEach(function (b) { if (b.cour && b.t >= 85 - 1e-6 && b.t + b.tStop <= MATCH + 1e-6) nBalls++; });
    return { T: T, fin: fin, walls: walls, doors: doors, towers: towers, inZ: inZ, inOwn: inOwn, ge: ge, gp: graalPos(T), throneFull: throneFull, thronePart: thronePart, nBalls: nBalls };
  }
  /* points de la stratégie avec le barème du compteur (bareme.js) ; douves et PAMI ne sont pas simulés */
  function scoreOf(o) {
    var B = BAREME, rows = [];
    var nP = Object.keys(o.inOwn).length, wOwn = o.walls.filter(own), tOwn = o.towers.filter(own), dOwn = o.doors.filter(own);
    var g = o.ge, gIn = false, lvl = 0, gNote = 'non posé dans le château';
    if (g.k === 'ride') g = { k: 'free', zone: o.gp.zone, top: o.gp.top };
    if (g.k === 'free' && g.zone && own(g.zone)) {
      gIn = true; var bottom = g.top - params.gs;
      lvl = bottom >= 300 ? 3 : bottom >= 200 ? 2 : bottom >= 100 ? 1 : 0;
      gNote = 'posé sur ' + g.zone + ' (base à ' + Math.round(bottom) + ' mm)';
    } else if (g.k === 'held') gNote = 'encore tenu par le robot';
    var roi = o.throneFull ? B.retourComplet : o.thronePart ? B.retourPartiel : 0;
    var bl = (o.nBalls >= 1 ? B.boulet1 : 0) + (o.nBalls >= 3 ? B.boulet3 : 0);
    rows.push(['Construction', [
      ['Pierres dans nos zones', nP + ' × ' + B.pierre + ' pt', nP * B.pierre],
      ['Murs', wOwn.length ? wOwn.join(', ') : 'aucun', wOwn.length * B.mur],
      ['Tours', tOwn.length ? tOwn.join(', ') : 'aucune', tOwn.length * B.tour],
      ['Porte', dOwn.length ? dOwn[0] : 'aucune', dOwn.length ? B.porte : 0]
    ]]);
    rows.push(['Graal', [
      ['Dans le château', gNote, gIn ? B.graalPresent : 0],
      ['Niveau d\'élévation', gIn ? 'niveau ' + lvl + ' (estimé d\'après la hauteur)' : '-', lvl * B.graalNiveau]
    ]]);
    rows.push(['Retour du roi', [
      ['Salle du trône', o.throneFull ? 'complètement' : o.thronePart ? 'en partie' : 'dehors', roi]
    ]]);
    rows.push(['Assaut', [
      ['Boulets dans la cour adverse', o.nBalls + ' arrêtés dans la cour à 100 s', bl],
      ['Douves et attaque de PAMI', 'non simulées', 0]
    ]]);
    var total = 0; rows.forEach(function (r) { r[1].forEach(function (x) { total += x[2]; }); });
    return { total: total, rows: rows };
  }
  function renderResults() {
    var T = R.T, tE = Math.min(T, MATCH), o = outcome(tE), sc = scoreOf(o);
    $('scoreV').textContent = sc.total; $('totPts').textContent = sc.total + ' pts';
    $('score').title = 'Score estimé ' + (T > MATCH ? 'à 100 s' : 'en fin de programme') + ' : détail dans l\'onglet Résultat';
    var h = '<div class="scorebox"><div class="big"><b>' + sc.total + '</b> pts</div><p class="note">Score estimé ' + (T > MATCH ? 'à 100 s : ce qui est fait après ne compte pas' : 'en fin de programme') + '. Barème du compteur de points, robot adverse absent.</p></div>';
    sc.rows.forEach(function (r) {
      var sub = 0; r[1].forEach(function (x) { sub += x[2]; });
      h += '<div class="sgrp"><div class="sh"><span>' + esc(r[0]) + '</span><b>' + sub + ' pts</b></div>';
      r[1].forEach(function (x) { h += '<div class="srw' + (x[2] ? '' : ' zero') + '"><span>' + esc(x[0]) + '<small>' + esc(x[1]) + '</small></span><b>' + x[2] + '</b></div>'; });
      h += '</div>';
    });
    if (params.gs <= 100) h += '<p class="note bad" style="padding:0 14px">Le Graal fait ' + params.gs + ' mm : le règlement exige plus qu\'un cube de 100 mm.</p>';
    var rows = [];
    rows.push(['Durée du programme', fmt(T) + ' s', T <= MATCH]);
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
  function update(t) {
    if (!R) return;
    var tt = Math.min(t, R.T), groups = [];
    R.stones.forEach(function (st, i) {
      var m = stoneMeshes[i], e = R.stoneAt(st, tt);
      if (e.k === 'home') { var h = m.userData.home; m.position.set(h.x, h.y, h.z); m.rotation.set(0, h.ry, 0); return; }
      if (e.k === 'free') {
        if (!e._p) { placeRobot(e.pose); fromGrip(m, e.f, 55, 110 * (e.l - 1), Math.PI / 2); e._p = m.position.clone(); e._q = m.quaternion.clone(); }
        m.position.copy(e._p); m.quaternion.copy(e._q); return;
      }
      groups.push([m, e]);
    });
    var ge = graalAt(tt);
    var c = checks(tt), p = c.p; placeRobot(p);
    groups.forEach(function (g) { fromGrip(g[0], g[1].f, 55, 110 * (g[1].l - 1), Math.PI / 2); });
    graalM.scale.setScalar(params.gs / 60);
    if (ge.k === 'home') { var gw = W(params.gx, params.gy); graalM.position.set(gw[0], params.gs / 2, gw[1]); graalM.rotation.set(0, 0, 0); }
    else if (ge.k === 'held') fromGrip(graalM, ge.f, params.gs / 2, -110, 0);
    else if (ge.k === 'ride') { var gp = graalPos(tt), gw2 = W(gp.c[0], gp.c[1]); graalM.position.set(gw2[0], gp.top - params.gs / 2, gw2[1]); graalM.rotation.set(0, -gp.ang * Math.PI / 180, 0); }
    else { if (!ge._p) { placeRobot(ge.pose); fromGrip(graalM, ge.f, params.gs / 2, -110, 0); ge._p = graalM.position.clone(); ge._q = graalM.quaternion.clone(); placeRobot(p); } graalM.position.copy(ge._p); graalM.quaternion.copy(ge._q); }
    ['A', 'B'].forEach(function (f) { for (var j = 0; j < 3; j++) { var on = p[f].vac[j]; MOD[f].mats[j].color.copy(on ? green : red); MOD[f].mats[j].emissive.copy(green).multiplyScalar(on ? 0.2 : 0); } });
    var shots = R.balls.shots || [], nOn = 0, nIn = 0;
    canTube.visible = canOut(t);
    balls.forEach(function (bm, i) {
      var b = shots[i], tb = Math.min(t, TEND);
      bm.visible = i < (shots.length || Math.min(10, Math.round(params.bn)));
      if (!b || tb < b.t) { nOn++; bm.position.copy(new THREE.Vector3(-76 + (i % 5) * 18, 245, (Math.floor(i / 5) - 0.5) * 30).applyMatrix4(robot.matrixWorld)); return; }
      var q = ballAt(b, tb - b.t), w = W(q[0], q[1]); bm.position.set(w[0], q[2], w[1]);
      if (tb - b.t >= b.tStop && b.cour) nIn++;
    });
    var hR = $('hR'), hS = $('hS'), hP = $('hP'), hB = $('hBall');
    hR.textContent = Math.round(c.robotH) + ' mm ' + (c.robotH <= 350.5 ? '✓' : '✗'); hR.className = c.robotH <= 350.5 ? 'ok' : 'bad';
    if (c.n) { var okS = c.oTop <= c.oLim + 0.5; hS.textContent = Math.round(c.oTop) + ' / ' + c.oLim + ' mm ' + (okS ? '✓' : '✗'); hS.className = okS ? 'ok' : 'bad'; } else { hS.textContent = '-'; hS.className = ''; }
    hP.textContent = Math.round(c.per) + ' / ' + c.plim + ' mm ' + (c.per <= c.plim + 0.5 ? '✓' : '✗'); hP.className = c.per <= c.plim + 0.5 ? 'ok' : 'bad';
    $('hA').textContent = Math.round(p.A.hc) + ' / ' + Math.round(p.A.rot) + '°'; $('hB').textContent = Math.round(p.B.hc) + ' / ' + Math.round(p.B.rot) + '°';
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
  }
  function closeDrawer() { if (!openDrawer) return; openDrawer.classList.remove('open'); openDrawer = null; $('scrim').hidden = true; }
  $('bStrats').addEventListener('click', function () { showDrawer('dStrats'); });
  $('bParams').addEventListener('click', function () { showDrawer('dParams'); });
  $('bHelp').addEventListener('click', function () { showDrawer('dHelp'); });
  $('scrim').addEventListener('click', closeDrawer);
  document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', closeDrawer); });

  /* ---------- JSON ---------- */
  function exportObj() { return { format: 'camelot-strategie', version: 1, name: current || undefined, params: params, program: prog }; }
  function importObj(o) {
    if (!o || !Array.isArray(o.program)) throw new Error('le JSON doit contenir une liste « program ».');
    var valid = ACTIONS.map(function (a) { return a[0]; });
    o.program.forEach(upgradeStep);
    var p2 = o.program.filter(function (s) { return s && valid.indexOf(s.a) >= 0; }).map(function (s) { var d = defaults(s.a); for (var k in d) if (s[k] !== undefined) d[k] = s[k]; if (s.tm === undefined && d.tm !== undefined) d.tm = false; if (s.a === 'deposer' && s.r === undefined) d.r = s.o === 'debout' ? 90 : 0; return d; });
    prog = p2; params = Object.assign({}, DEF, o.params || {}); sel = -1; writeParams(); readParams(); changed(true);
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
  function isDirty() { return stateSnap() !== savedSnap; }
  function markSaved(yes) { savedSnap = yes ? stateSnap() : ''; lsSet('icamlot-strat-saved', savedSnap || null); updateDirty(); }
  function updateDirty() {
    var s = $('state');
    if (!current || !savedSnap) { s.textContent = 'non enregistrée'; s.className = 'state' + (prog.length ? ' dirty' : ''); }
    else if (isDirty()) { s.textContent = 'modifiée'; s.className = 'state dirty'; }
    else { s.textContent = 'enregistrée'; s.className = 'state saved'; }
    document.title = (current ? current + ' · ' : '') + 'Simulation du plateau · ICAM LOT';
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
  /* points et durée de chaque stratégie enregistrée : simulées ici, une à la fois, dans un worker à part */
  var statCache = {}, statQ = [], statBusy = false, statWorker = null, statId = 0;
  try { if (src) { statWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))); statWorker.onerror = function () { statWorker = null; }; } } catch (e) { statWorker = null; }
  function statKey(s) { return 'icamlot-stat-v1-' + s.slug + '-' + s.updated; }
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
    try { return { pts: scoreOf(outcome(Math.min(r.T, MATCH))).total, T: r.T }; } finally { R = sR; params = sP; }
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
    return api('GET', API).then(function (j) { strats = j.strategies || []; renderStrats(); }, function () {
      strats = []; $('strats').innerHTML = '<li class="emptyl bad">Serveur des stratégies injoignable. L\'export JSON reste disponible.</li>';
    });
  }
  function doSave(name) {
    api('PUT', API + '/' + slugify(name), { name: name, params: params, program: prog }).then(function () {
      setCurrent(name); markSaved(true); toast('« ' + name + ' » enregistrée', 'ok'); refreshStrats();
    }, function (e) { toast('Échec de l\'enregistrement : ' + e.message, 'bad'); });
  }
  function save() {
    var name = $('sName').value.trim(), slug = slugify(name);
    if (!slug) { $('sName').focus(); toast('Donne d\'abord un nom à la stratégie (en haut).', 'bad'); return; }
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
    confirmLoss(function () { prog = []; params = Object.assign({}, DEF); sel = -1; writeParams(); setCurrent(''); markSaved(false); changed(true); closeDrawer(); $('sName').focus(); });
  });
  $('bSave').addEventListener('click', save);
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
  $('cTrail').addEventListener('change', function (e) { showTrail = e.target.checked; if (trail) trail.visible = showTrail; if (shotLines) shotLines.visible = showTrail; });
  $('cPer').addEventListener('change', function (e) { countPer = e.target.checked; if (R) { computeBad(); drawStrip(); renderAlerts(); renderResults(); } });
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
      $('palette').hidden = t.dataset.pane !== 'prog';
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
    if (mod && key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if (key === 'Escape') { if (!$('toast').hidden) hideToast(); else if (openDrawer) closeDrawer(); else if (typing) e.target.blur(); else if (sel >= 0) select(-1); return; }
    if (typing || openDrawer) return;
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
  writeParams(); readParams(); lastSnap = snap(); updateUndoBtns(); renderSteps(); updateDirty(); resize(); recompute();

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
