/* Simulation du plateau : interface (programme, table 3D, frise, stratégies ou cerveau en direct).
   Le moteur (GEO, ENGINE, SCORE) est chargé depuis /engine/ et tourne aussi dans un Web Worker. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var BrainActs = window.ACTIONS;
  var MATCH = 100;
  var DEF = { v: 0.5, va: 0.2, w: 120, vz: 100, trot: 1.5, tvac: 0.5, trel: 0.4, tballs: 4, x0: 250, y0: 1000, h0: 0, gx: 100, gy: 1180, gs: 60 };
  var PIDS = { v: 'pV', va: 'pVA', w: 'pW', vz: 'pVZ', trot: 'pTR', tvac: 'pTV', trel: 'pTL', tballs: 'pTB', x0: 'pX0', y0: 'pY0', h0: 'pH0', gx: 'pGX', gy: 'pGY', gs: 'pGS' };
  var EXAMPLE = [
    { a: 'prendre', f: 'A', p: 'P1' }, { a: 'prendre', f: 'B', p: 'P9' },
    { a: 'mur', f: 'A', z: 'M1', side: 'ext' }, { a: 'mur', f: 'B', z: 'M2', side: 'ext' },
    { a: 'prendre', f: 'A', p: 'P5' }, { a: 'prendre', f: 'B', p: 'P10' },
    { a: 'mur', f: 'A', z: 'M5', side: 'ext' }, { a: 'mur', f: 'B', z: 'M4', side: 'ext' },
    { a: 'prendre', f: 'A', p: 'P4' }, { a: 'boulets' },
    { a: 'porte', f: 'A', z: 'M3', side: 'int' },
    { a: 'prendreGraal', f: 'B' }, { a: 'poserGraal', f: 'B', z: 'M3' },
    { a: 'trone' }
  ];
  var ACTIONS = [
    ['prendre', 'Prendre le paquet'], ['mur', 'Poser en mur'], ['tour', 'Faire une tour'], ['porte', 'Faire une porte'],
    ['boulets', 'Lâcher les boulets (cour adverse)'], ['prendreGraal', 'Prendre le Graal'], ['poserGraal', 'Poser le Graal sur'],
    ['attendre', 'Attendre (s)'], ['attendreJusqua', 'Attendre jusqu\'à (s)'], ['trone', 'Aller dans la salle du trône']
  ];
  var SHORT = { prendre: 'Prendre', mur: 'Mur', tour: 'Tour', porte: 'Porte', boulets: 'Boulets', prendreGraal: 'Prendre Graal', poserGraal: 'Poser Graal', attendre: 'Attendre', attendreJusqua: 'Attendre jusqu\'à', trone: 'Trône' };
  var ICONS = { prendre: 'fa-hand', mur: 'fa-grip-lines', tour: 'fa-chess-rook', porte: 'fa-archway', boulets: 'fa-bowling-ball', prendreGraal: 'fa-trophy', poserGraal: 'fa-award', attendre: 'fa-hourglass-half', attendreJusqua: 'fa-clock', trone: 'fa-crown' };
  var FIELDS = { prendre: ['f', 'p'], mur: ['f', 'zm', 'side'], tour: ['f', 'zt', 's'], porte: ['f', 'zm', 'side'], boulets: [], prendreGraal: ['f'], poserGraal: ['f', 'zmt'], attendre: ['sec'], attendreJusqua: ['sec'], trone: [] };
  var PKIDS = ENGINE.PK.map(function (p) { return p.id; }), MIDS = ENGINE.ZM.map(function (z) { return z.id; }), TIDS = ENGINE.ZT.map(function (z) { return z.id; });
  var SIDS = []; PKIDS.forEach(function (p) { for (var l = 1; l <= 3; l++) SIDS.push(p + '.' + l); });
  var prog = [], params = {}, sel = -1;
  var pilot = { mode: 'strategie', slug: '', name: '', layers: null, cfg: null };

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
  function loadLocal() { try { var j = JSON.parse(lsGet('camelot-prog-v1') || 'null'); if (j && Array.isArray(j.program)) return j; } catch (e) {} return null; }

  /* ---------- paramètres ---------- */
  function writeParams() { for (var k in PIDS) $(PIDS[k]).value = params[k]; }
  function readParams() {
    for (var k in PIDS) {
      var v = parseFloat($(PIDS[k]).value), zeroOk = (k === 'tvac' || k === 'trel' || k === 'x0' || k === 'y0' || k === 'h0' || k === 'gx' || k === 'gy');
      params[k] = isFinite(v) && (zeroOk ? true : v > 0) ? v : DEF[k];
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
  function sideTxt(s) { return s === 'ext' ? ' · de l\'extérieur' : s === 'int' ? ' · de l\'intérieur' : ''; }
  function describe(st) {
    var f = st.f ? ' · face ' + st.f : '';
    switch (st.a) {
      case 'prendre': return 'Prendre ' + st.p + f;
      case 'mur': return 'Mur en ' + st.z + f + sideTxt(st.side);
      case 'tour': return 'Tour ' + st.z + ' avec ' + st.s + f;
      case 'porte': return 'Porte en ' + st.z + f + sideTxt(st.side);
      case 'boulets': return 'Lâcher les boulets';
      case 'prendreGraal': return 'Prendre le Graal' + f;
      case 'poserGraal': return 'Poser le Graal sur ' + st.z + f;
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
      if (k === 'side') st.side = 'auto'; if (k === 's') st.s = 'P1.1'; if (k === 'sec') st.sec = a === 'attendreJusqua' ? 85 : 1;
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
    (FIELDS[st.a] || []).forEach(function (k) {
      if (k === 'f') d.appendChild(fld('Face', mkSeg('Face', [['A', 'Face A'], ['B', 'Face B']], st.f, function (v) { setField(i, 'f', v); })));
      if (k === 'p') d.appendChild(fld('Paquet', mkSel('Paquet', PKIDS.map(function (p) { return [p, p]; }), st.p, function (v) { setField(i, 'p', v); })));
      if (k === 'zm') d.appendChild(fld('Zone', mkSel('Zone de mur', MIDS.map(function (z) { return [z, zoneLabel(z)]; }), st.z, function (v) { setField(i, 'z', v); })));
      if (k === 'zt') d.appendChild(fld('Tour', mkSel('Tour', TIDS.map(function (z) { return [z, z]; }), st.z, function (v) { setField(i, 'z', v); })));
      if (k === 'zmt') d.appendChild(fld('Sur', mkSel('Construction', MIDS.concat(TIDS).map(function (z) { return [z, zoneLabel(z)]; }), st.z, function (v) { setField(i, 'z', v); })));
      if (k === 'side') d.appendChild(fld('Côté', mkSeg('Côté', [['auto', 'Auto'], ['ext', 'Extérieur'], ['int', 'Intérieur']], st.side, function (v) { setField(i, 'side', v); })));
      if (k === 's') d.appendChild(fld('Pierre', mkSel('Pierre', SIDS.map(function (p) { return [p, 'Pierre ' + p]; }), st.s, function (v) { setField(i, 's', v); })));
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
  (function () {
    function attach(w) {
      worker = w;
      worker.onmessage = function (e) { if (e.data.id === reqId) accept(e.data.r, e.data.opp); };
      worker.onerror = function () { worker = null; };
    }
    try {
      Promise.all([
        fetch('../engine/geom.js').then(function (r) { return r.text(); }),
        fetch('../engine/engine.js').then(function (r) { return r.text(); })
      ]).then(function (src) {
        var code = src[0] + '\n' + src[1] + '\nonmessage=function(e){var r=ENGINE.simulateMatch(e.data.prog,e.data.P,{opponent:e.data.opponent,intensity:e.data.intensity});var opp=r.opponent||null;if(opp){delete opp.poseAt;delete opp.stoneAt;}r.opponent=null;delete r.poseAt;delete r.stoneAt;postMessage({id:e.data.id,r:r,opp:opp});};';
        attach(new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))));
      }, function () { worker = null; });
    } catch (e) { worker = null; }
  })();
  function currentOpponent() {
    if (!oppChoice.slug) return null;
    if (oppChoice.slug === 'exemple') return { name: 'Exemple', program: EXAMPLE, params: params };
    return oppLoaded[oppChoice.slug] || null;
  }
  function recompute() {
    if (pilot.mode === 'cerveau') return recomputeLive();
    readParams(); $('busy').hidden = false;
    var opp = currentOpponent();
    if (oppChoice.slug && oppChoice.slug !== 'exemple' && !opp) {
      api('GET', API + '/' + oppChoice.slug).then(function (j) {
        oppLoaded[oppChoice.slug] = { name: j.name, program: j.program, params: j.params || params };
        recompute();
      }, function () { oppChoice.slug = ''; saveOppChoice(); recompute(); });
      return;
    }
    var data = { prog: JSON.parse(JSON.stringify(prog)), P: Object.assign({}, params), id: ++reqId, opponent: opp ? { name: opp.name, program: opp.program, params: opp.params || params } : null, intensity: opp ? oppChoice.intensity : 'aucun' };
    if (worker) worker.postMessage(data);
    else setTimeout(function () { var r = ENGINE.simulateMatch(data.prog, data.P, { opponent: data.opponent, intensity: data.intensity }); accept(r, r.opponent); }, 0);
  }
  function simulateProg(list) {
    var opp = currentOpponent();
    var data = { prog: JSON.parse(JSON.stringify(list)), P: Object.assign({}, params), id: ++reqId, opponent: opp ? { name: opp.name, program: opp.program, params: opp.params || params } : null, intensity: opp ? oppChoice.intensity : 'aucun' };
    if (worker) worker.postMessage(data);
    else setTimeout(function () { var r = ENGINE.simulateMatch(data.prog, data.P, { opponent: data.opponent, intensity: data.intensity }); accept(r, r.opponent); }, 0);
  }
  function recomputeLive() {
    if (!window.ENV || !window.NET || !BrainActs) {
      $('busy').hidden = true;
      toast('Moteur du cerveau introuvable.', 'bad');
      return;
    }
    if (!pilot.layers || !pilot.cfg) {
      $('busy').hidden = true;
      toast('Charge un cerveau depuis le tiroir Cerveaux.', 'bad');
      return;
    }
    readParams();
    $('busy').hidden = false;
    var opp = currentOpponent();
    if (oppChoice.slug && oppChoice.slug !== 'exemple' && !opp) {
      api('GET', API + '/' + oppChoice.slug).then(function (j) {
        oppLoaded[oppChoice.slug] = { name: j.name, program: j.program, params: j.params || params };
        recomputeLive();
      }, function () { oppChoice.slug = ''; saveOppChoice(); recomputeLive(); });
      return;
    }
    setTimeout(function () {
      try {
        var familles = (pilot.cfg.actions && pilot.cfg.actions.familles) || BrainActs.FAMILLES.map(function (f) { return f.id; });
        var entrees = pilot.cfg.entrees || window.ENV.GROUPS.map(function (g) { return g.id; });
        var env = window.ENV.create({
          entrees: entrees,
          familles: familles,
          params: params,
          adversaire: { intensite: opp ? oppChoice.intensity : 'aucun' },
          skipContacts: true,
          onError: 'penalite'
        });
        var acts = ((pilot.cfg.reseau && pilot.cfg.reseau.couches) || []).map(function (c) { return c.activation; });
        var layers = pilot.layers;
        env.play(function (obs, mask) {
          return window.NET.choose(window.NET.forward(layers, obs, acts), mask);
        }, {
          params: params,
          intensite: opp ? oppChoice.intensity : 'aucun',
          opponent: opp ? { name: opp.name, program: opp.program, params: opp.params || params } : null
        });
        prog = env.program();
        sel = -1;
        lastSnap = snap();
        renderSteps();
        simulateProg(prog);
      } catch (e) {
        $('busy').hidden = true;
        toast('Lecture du cerveau impossible : ' + e.message, 'bad');
      }
    }, 0);
  }
  function attachAt(res) {
    if (!res) return res;
    res.poseAt = function (t) { return ENGINE.poseAtK(res.K, t); };
    res.stoneAt = function (st, t) { var e = st.tl[0]; for (var i = 0; i < st.tl.length; i++) if (st.tl[i].t <= t) e = st.tl[i]; return e; };
    return res;
  }
  function accept(r, opp) {
    attachAt(r);
    r.opponent = attachAt(opp || r.opponent || null);
    R = r; $('busy').hidden = true;
    TEND = Math.max(MATCH, Math.ceil(R.T + 1));
    $('track').setAttribute('aria-valuemax', String(TEND));
    var tot = $('tot'), nErr = R.errors.length;
    tot.textContent = 'Durée ' + fmt(R.T) + ' s' + (R.T <= MATCH ? '' : ' (+' + fmt(R.T - MATCH) + ' s)');
    tot.className = 'tot ' + (R.T <= MATCH && !nErr ? 'ok' : 'bad');
    showStepInfo(); buildTrail(); buildOppTrail(); computeBad(); drawStrip(); renderResults(); renderAlerts(); renderTimeline();
    if (them) them.group.visible = !!R.opponent;
    if (graalOpp) graalOpp.visible = !!R.opponent;
    if (ballsOpp) ballsOpp.forEach(function (b) { b.visible = !!R.opponent; });
    if (time > TEND) time = TEND;
  }

  /* ---------- géométrie / score (modules partagés) ---------- */
  var BARS = SCORE.BARS;
  function gripTop(g) { return SCORE.gripTop(g); }
  function hullPer(P) { return SCORE.hullPer(P); }
  function inCastle(x, y) { return SCORE.inCastle(x, y); }
  var countPer = true;
  function graalAt(t) { return SCORE.graalAt(R, t); }
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
      var m = box(320, 110, 110, stoneMat[l]);
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), edgeMat));
      [55.5, -55.5].forEach(function (z) { var t = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), tagMat); t.position.z = z; if (z < 0) t.rotation.y = Math.PI; m.add(t); });
      var w = W(pk.x, pk.y); m.userData = { home: { x: w[0], y: 55 + 110 * l, z: w[1], ry: pk.tan ? Math.PI / 2 : 0 }, l: l, pk: pk.id };
      scene.add(m); stoneMeshes.push(m);
    }
  });

  /* robots (jaune = nous, bleu = adversaire en miroir) */
  var yellow = mat(0xf2b600, 0.5, 0.1), blue = mat(0x3a6fd0, 0.55, 0.15), dark = mat(0x39414e, 0.5, 0.3), black = mat(0x1d2128, 0.8, 0);
  var shp = new THREE.Shape();
  [180, 300, 60].forEach(function (a, i) { var r = a * Math.PI / 180, x = GEO.R * Math.cos(r), z = GEO.R * Math.sin(r); if (i) shp.lineTo(x, -z); else shp.moveTo(x, -z); });
  var plateGeo = new THREE.ExtrudeGeometry(shp, { depth: 20, bevelEnabled: false });
  function makeBot(scheme) {
    var bot = new THREE.Group(); scene.add(bot);
    var elecM = scheme.elec, modM = scheme.mod, banner = scheme.banner;
    [70, 220].forEach(function (y) { var pl = new THREE.Mesh(plateGeo, dark); pl.rotation.x = -Math.PI / 2; pl.position.y = y; pl.castShadow = true; bot.add(pl); });
    var elec = cyl(70, 70, 130, elecM, 3); elec.rotation.y = Math.PI / 6; elec.position.set(-25, 155, 0); bot.add(elec);
    var lidar = cyl(38, 38, 40, black); lidar.position.set(-30, 260, 0); bot.add(lidar);
    [180, 300, 60].forEach(function (a) { var r = a * Math.PI / 180, g = new THREE.Group(); g.position.set(150 * Math.cos(r), 50.8, 150 * Math.sin(r)); g.rotation.y = -r; bot.add(g); var wh = cyl(50.8, 50.8, 39.5, black, 24); wh.rotation.z = Math.PI / 2; g.add(wh); });
    var rc = nv(240), bau = cyl(22, 22, 25, mat(banner, 0.4, 0.1)); bau.position.set(60 * rc[0], 245, 60 * rc[1]); bot.add(bau);
    function makeModule(k) {
      var face = new THREE.Group(); face.rotation.y = -k * 120 * Math.PI / 180; bot.add(face);
      var mod = new THREE.Group(); mod.position.x = GEO.rin; face.add(mod);
      [-175, 175].forEach(function (z) { var u = box(20, 345, 20, modM); u.position.set(-40, 172.5, z); mod.add(u); });
      var tb = box(20, 15, 370, modM); tb.position.set(-40, 337.5, 0); mod.add(tb);
      var carr = new THREE.Group(); mod.add(carr);
      var cross = box(14, 14, 330, modM); cross.position.set(-40, 0, 0); carr.add(cross);
      var ring = new THREE.Mesh(new THREE.TorusGeometry(58, 3.5, 10, 48), new THREE.MeshStandardMaterial({ color: banner, roughness: 0.5 })); ring.rotation.y = Math.PI / 2; ring.position.set(-34, 0, 0); carr.add(ring);
      var grip = new THREE.Group(); carr.add(grip);
      var spine = box(6, 200, 14, modM); spine.position.set(-27, -20, 0); grip.add(spine);
      var mats = [0, 1, 2].map(function () { return new THREE.MeshStandardMaterial({ color: banner, roughness: 0.55 }); });
      BARS.forEach(function (b, i) {
        var bar = box(6, 14, 2 * (b.hl - b.r) + 20, modM); bar.position.set(-27, b.y, 0); grip.add(bar);
        [-80, 80].forEach(function (z) { var c = cyl(b.r * 0.4, b.r, 24, mats[i]); c.rotation.z = -Math.PI / 2; c.position.set(-12, b.y, z); grip.add(c); });
      });
      var gcup = cyl(8, 16, 24, mats[0]); gcup.rotation.z = -Math.PI / 2; gcup.position.set(-12, -110, 0); grip.add(gcup);
      var lab = box(4, 40, 40, k ? mat(0x2aa3a3, 0.5, 0.1) : mat(0x8a5cd0, 0.5, 0.1)); lab.position.set(-60, 300, 0); mod.add(lab);
      return { carr: carr, grip: grip, mats: mats };
    }
    var MOD = { A: makeModule(0), B: makeModule(1) };
    var tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), loc = new THREE.Object3D();
    function place(p) {
      if (!p) return;
      var w = W(p.x, p.y); bot.position.set(w[0], 0, w[1]); bot.rotation.y = -p.h * Math.PI / 180;
      ['A', 'B'].forEach(function (f) { if (p[f]) { MOD[f].carr.position.y = p[f].hc; MOD[f].grip.rotation.x = p[f].rot * Math.PI / 180; } });
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
  var graalM = box(60, 60, 60, new THREE.MeshStandardMaterial({ color: 0xe8c547, roughness: 0.3, metalness: 0.6 })); scene.add(graalM);
  var graalOpp = box(60, 60, 60, new THREE.MeshStandardMaterial({ color: 0x9ec0ff, roughness: 0.3, metalness: 0.6 })); graalOpp.visible = false; scene.add(graalOpp);
  var ballMat = new THREE.MeshStandardMaterial({ color: 0xf2b600, roughness: 0.8 }), balls = [];
  var ballMatOpp = new THREE.MeshStandardMaterial({ color: 0x3a6fd0, roughness: 0.8 }), ballsOpp = [];
  for (var bi = 0; bi < 10; bi++) { var bm = new THREE.Mesh(new THREE.SphereGeometry(22.5, 16, 12), ballMat); bm.castShadow = true; scene.add(bm); balls.push(bm); }
  for (var bj = 0; bj < 10; bj++) { var bo = new THREE.Mesh(new THREE.SphereGeometry(22.5, 16, 12), ballMatOpp); bo.castShadow = true; bo.visible = false; scene.add(bo); ballsOpp.push(bo); }
  var BSEED = []; for (var bk = 0; bk < 10; bk++) BSEED.push([((bk * 37) % 10) / 10 - 0.5, ((bk * 53) % 10) / 10 - 0.5]);
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
    (FIELDS[st.a] || []).forEach(function (f) {
      if (f === 'p') k.push('P'); if (f === 'zm') k.push('M'); if (f === 'zt') k.push('T'); if (f === 'zmt') k.push('M', 'T'); if (f === 's') k.push('S');
    });
    return k;
  }
  function pickText(kinds) {
    var w = [];
    if (kinds.indexOf('P') >= 0) w.push('un paquet (P)'); if (kinds.indexOf('M') >= 0) w.push('une zone de mur (M)');
    if (kinds.indexOf('T') >= 0) w.push('une tour (T)'); if (kinds.indexOf('S') >= 0) w.push('une pierre');
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
    var T = R.T, tE = Math.min(T, MATCH), o = outcome(tE), sc = scoreOf(o);
    $('scoreV').textContent = sc.total; $('totPts').textContent = sc.total + ' pts';
    var oppR = R.opponent, oppSc = null;
    if (oppR) {
      oppSc = SCORE.scoreAt(oppR, oppR.params, Math.min(oppR.T, MATCH));
      $('scoreOpp').hidden = false; $('scoreOpp').textContent = 'adv. ' + oppSc.total + ' pts';
      $('totPts').textContent = sc.total + ' · adv. ' + oppSc.total;
    } else { $('scoreOpp').hidden = true; $('scoreOpp').textContent = ''; }
    $('score').title = 'Score estimé ' + (T > MATCH ? 'à 100 s' : 'en fin de programme') + ' : détail dans l\'onglet Résultat';
    var h = '<div class="scorebox"><div class="big"><b>' + sc.total + '</b> pts</div><p class="note">Score estimé ' + (T > MATCH ? 'à 100 s : ce qui est fait après ne compte pas' : 'en fin de programme') + '. Barème du compteur de points' + (oppR ? ', face à l\'adversaire (' + ((currentOpponent() && currentOpponent().name) || 'miroir') + ' : ' + oppSc.total + ' pts).' : '.') + '</p></div>';
    sc.rows.forEach(function (r) {
      var sub = 0; r[1].forEach(function (x) { sub += x[2]; });
      h += '<div class="sgrp"><div class="sh"><span>' + esc(r[0]) + '</span><b>' + sub + ' pts</b></div>';
      r[1].forEach(function (x) { h += '<div class="srw' + (x[2] ? '' : ' zero') + '"><span>' + esc(x[0]) + '<small>' + esc(x[1]) + '</small></span><b>' + x[2] + '</b></div>'; });
      h += '</div>';
    });
    if (params.gs <= 60) h += '<p class="note bad" style="padding:0 14px">Le Graal fait ' + params.gs + ' mm : le règlement exige un cube strictement plus grand que 60 mm.</p>';
    var rows = [];
    rows.push(['Durée du programme', fmt(T) + ' s', T <= MATCH]);
    rows.push(['Pierres prises', Object.keys(o.fin).filter(function (k) { return !o.fin[k].home; }).length + R.stones.filter(function (st) { return R.stoneAt(st, tE).k === 'held'; }).length + ' / 30', null]);
    rows.push(['Pierres dans une zone', Object.keys(o.inZ).length + ' (dont ' + Object.keys(o.inOwn).length + ' chez nous)', null]);
    var adv = o.walls.concat(o.towers, o.doors).filter(function (z) { return !own(z); });
    rows.push(['Constructions côté adverse', adv.length ? adv.join(', ') + ' (non comptées)' : 'aucune', adv.length ? false : null]);
    rows.push(['Boulets', R.balls.t < Infinity ? 'lâchés de ' + fmt(R.balls.t) + ' à ' + fmt(R.balls.t + R.balls.d) + ' s' : 'non lâchés', R.balls.t < Infinity ? o.nBalls === 10 : null]);
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
  function placeGraal(mesh, ge, holder, homeX, homeY, gs, pHold) {
    mesh.scale.setScalar(gs / 60);
    if (!ge || ge.k === 'home') { var gw = W(homeX, homeY); mesh.position.set(gw[0], gs / 2, gw[1]); mesh.rotation.set(0, 0, 0); return; }
    if (ge.k === 'held') holder.fromGrip(mesh, ge.f, gs / 2, -110, 0);
    else {
      if (!ge._p) { holder.place(ge.pose); holder.fromGrip(mesh, ge.f, gs / 2, -110, 0); ge._p = mesh.position.clone(); ge._q = mesh.quaternion.clone(); if (pHold) holder.place(pHold); }
      mesh.position.copy(ge._p); mesh.quaternion.copy(ge._q);
    }
  }
  function update(t) {
    if (!R) return;
    var tt = Math.min(t, R.T), groups = [], opp = R.opponent;
    R.stones.forEach(function (st, i) {
      var m = stoneMeshes[i], e = R.stoneAt(st, tt), holder = us;
      m.visible = true;
      if (e.k === 'gone') {
        if (opp) { e = opp.stoneAt(opp.stones[i], tt); holder = them; }
        else { m.visible = false; return; }
      }
      if (e.k === 'gone') { m.visible = false; return; }
      if (e.k === 'home') { var h = m.userData.home; m.position.set(h.x, h.y, h.z); m.rotation.set(0, h.ry, 0); return; }
      if (e.k === 'free') {
        if (!e._p) { holder.place(e.pose); holder.fromGrip(m, e.f, 55, 110 * (e.l - 1), Math.PI / 2); e._p = m.position.clone(); e._q = m.quaternion.clone(); }
        m.position.copy(e._p); m.quaternion.copy(e._q); return;
      }
      groups.push([m, e, holder]);
    });
    var ge = graalAt(tt);
    var c = checks(tt), p = c.p; us.place(p);
    var po = opp ? opp.poseAt(Math.min(t, opp.T)) : null;
    if (opp) them.place(po);
    groups.forEach(function (g) { g[2].fromGrip(g[0], g[1].f, 55, 110 * (g[1].l - 1), Math.PI / 2); });
    placeGraal(graalM, ge, us, params.gx, params.gy, params.gs, p);
    if (opp) placeGraal(graalOpp, SCORE.graalAt(opp, Math.min(t, opp.T)), them, opp.params.gx, opp.params.gy, opp.params.gs || params.gs, po);
    ['A', 'B'].forEach(function (f) { for (var j = 0; j < 3; j++) { var on = p[f].vac[j]; us.MOD[f].mats[j].color.copy(on ? green : red); us.MOD[f].mats[j].emissive.copy(green).multiplyScalar(on ? 0.2 : 0); } });
    if (po) ['A', 'B'].forEach(function (f) { if (!po[f]) return; for (var j = 0; j < 3; j++) { var on = po[f].vac[j]; them.MOD[f].mats[j].color.copy(on ? green : red); them.MOD[f].mats[j].emissive.copy(green).multiplyScalar(on ? 0.2 : 0); } });
    var ba = R.balls.at, bw = ba ? W(ba[0], ba[1]) : [0, 0];
    balls.forEach(function (bm, i) {
      var ti = R.balls.t + (i + 0.5) * R.balls.d / 10;
      if (tt < ti) bm.position.copy(new THREE.Vector3(-76 + (i % 5) * 18, 245, (Math.floor(i / 5) - 0.5) * 30).applyMatrix4(us.group.matrixWorld));
      else { var k = Math.min(1, (tt - ti) / 0.35); bm.position.set(bw[0] + BSEED[i][0] * 160 * k, 200 + (22.5 - 200) * k * k, bw[1] + BSEED[i][1] * 160 * k); }
    });
    if (opp) {
      var bao = opp.balls.at, bwo = bao ? W(bao[0], bao[1]) : [0, 0], tto = Math.min(t, opp.T);
      ballsOpp.forEach(function (bm, i) {
        var ti = opp.balls.t + (i + 0.5) * opp.balls.d / 10;
        if (tto < ti) bm.position.copy(new THREE.Vector3(-76 + (i % 5) * 18, 245, (Math.floor(i / 5) - 0.5) * 30).applyMatrix4(them.group.matrixWorld));
        else { var k = Math.min(1, (tto - ti) / 0.35); bm.position.set(bwo[0] + BSEED[i][0] * 160 * k, 200 + (22.5 - 200) * k * k, bwo[1] + BSEED[i][1] * 160 * k); }
      });
    }
    var hR = $('hR'), hS = $('hS'), hP = $('hP'), hB = $('hBall');
    hR.textContent = Math.round(c.robotH) + ' mm ' + (c.robotH <= 350.5 ? '✓' : '✗'); hR.className = c.robotH <= 350.5 ? 'ok' : 'bad';
    if (c.n) { var okS = c.oTop <= c.oLim + 0.5; hS.textContent = Math.round(c.oTop) + ' / ' + c.oLim + ' mm ' + (okS ? '✓' : '✗'); hS.className = okS ? 'ok' : 'bad'; } else { hS.textContent = '-'; hS.className = ''; }
    hP.textContent = Math.round(c.per) + ' / ' + c.plim + ' mm ' + (c.per <= c.plim + 0.5 ? '✓' : '✗'); hP.className = c.per <= c.plim + 0.5 ? 'ok' : 'bad';
    $('hA').textContent = Math.round(p.A.hc) + ' / ' + Math.round(p.A.rot) + '°'; $('hB').textContent = Math.round(p.B.hc) + ' / ' + Math.round(p.B.rot) + '°';
    var hOpp = $('hOpp');
    if (opp) {
      var oName = (currentOpponent() && currentOpponent().name) || 'en miroir';
      hOpp.textContent = oName; hOpp.className = '';
    } else { hOpp.textContent = 'aucun'; hOpp.className = 'muted'; }
    if (tt < R.balls.t) { hB.textContent = 'à bord'; hB.className = ''; }
    else { var nb = Math.min(10, Math.floor((tt - R.balls.t) / (R.balls.d / 10) + 0.5)), okB = R.balls.t >= 85 && R.balls.t + R.balls.d <= 100; hB.textContent = nb + ' / 10 ' + (okB ? '✓' : '✗'); hB.className = okB ? 'ok' : 'bad'; }
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
    var p2 = o.program.filter(function (s) { return s && valid.indexOf(s.a) >= 0; }).map(function (s) { var d = defaults(s.a); for (var k in d) if (s[k] !== undefined) d[k] = s[k]; return d; });
    setPilotMode('strategie');
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
      if (meta.cfg) pilot.cfg = meta.cfg;
    }
    if (mode !== 'cerveau') { pilot.layers = null; pilot.cfg = null; pilot.slug = ''; pilot.name = ''; }
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
      nm.appendChild(meta); li.appendChild(nm);
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
    sel_.innerHTML = html;
    if (cur && cur !== 'exemple' && !strats.some(function (s) { return s.slug === cur; })) cur = 'exemple';
    sel_.value = cur || '';
    document.querySelectorAll('#pOppInt button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.i === oppChoice.intensity)); });
    $('pOppInt').hidden = !sel_.value;
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
  function save() {
    if (pilot.mode === 'cerveau') { toast('Un cerveau ne s\'enregistre pas comme stratégie. Il joue en direct.', 'bad'); return; }
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
      setPilotMode('strategie');
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
  var brains = [], delBrainArm = '';
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
    return api('GET', '../api/cerveaux').then(function (j) { brains = j.cerveaux || []; renderBrains(); }, function () {
      brains = []; $('brains').innerHTML = '<li class="emptyl bad">Serveur des cerveaux injoignable.</li>';
    });
  }
  function loadBrain(slug) {
    api('GET', '../api/cerveaux/' + slug).then(function (j) {
      return api('GET', '../api/cerveaux/' + slug + '/poids').then(function (w) {
        return { j: j, w: w };
      }, function () { return { j: j, w: null }; });
    }).then(function (pair) {
      var j = pair.j, w = pair.w;
      if (!window.ENV || !window.NET || !BrainActs) throw new Error('moteur cerveau absent');
      var couches = (j.reseau && j.reseau.couches) || [{ neurones: 64, activation: 'relu' }, { neurones: 64, activation: 'relu' }];
      var familles = (j.actions && j.actions.familles) || BrainActs.FAMILLES.map(function (f) { return f.id; });
      var nIn = window.ENV.nInputs(j.entrees);
      var nOut = BrainActs.filterByFamilles(familles).length;
      var layers = (w && w.layers) ? w.layers : window.NET.randomWeights(nIn, couches, nOut, j.graine || 1);
      setPilotMode('cerveau', { slug: slug, name: j.name, layers: layers, cfg: j });
      closeDrawer();
      toast(w && w.layers
        ? '« ' + j.name + ' » joue en direct'
        : '« ' + j.name + ' » sans poids entraînés : décisions aléatoires parmi les actions valides', w && w.layers ? 'ok' : 'bad');
      time = 0; setPlaying(true);
      recompute();
    }, function (e) { toast('Impossible d\'ouvrir le cerveau : ' + e.message, 'bad'); });
  }
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
  $('cTrail').addEventListener('change', function (e) { showTrail = e.target.checked; if (trail) trail.visible = showTrail; });
  $('cOppTrail').addEventListener('change', function (e) { showOppTrail = e.target.checked; if (trailOpp) trailOpp.visible = showOppTrail; });
  $('cPer').addEventListener('change', function (e) { countPer = e.target.checked; if (R) { computeBad(); drawStrip(); renderAlerts(); renderResults(); } });
  $('pOpp').addEventListener('change', function () {
    oppChoice.slug = $('pOpp').value;
    $('pOppInt').hidden = !oppChoice.slug;
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
    if (mod && key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
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
  writeParams(); readParams(); lastSnap = snap(); updateUndoBtns(); renderSteps(); updateDirty(); resize(); fillOppSelect(); refreshStrats(); recompute();
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
