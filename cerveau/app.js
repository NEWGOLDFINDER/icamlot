/* Atelier Cerveau : construction, entraînement, évaluation, rejouer. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var API = '../api';
  var current = '', savedSnap = '', delArm = '', brains = [], jobId = null, pollTimer = null;
  var oppPool = [{ name: 'Référence', program: ENGINE.PROGRAMME_REFERENCE, score: 116 }];
  var cfg = defaultCfg();
  var poids = null; // { kind: 'mlp', layers } | { kind: 'recurrent', model, evaluation, fichiers }

  /* catalogue lu à l'exécution (ENV, ACTIONS) : aucune liste d'entrées ni d'actions n'est codée ici */
  function groupes() { return ENV.GROUPS || []; }
  function groupeInfo(g) {
    var v = (g.vars && g.vars[0]) || {};
    return { n: g.n != null ? g.n : v.n, desc: g.desc != null ? g.desc : v.desc, label: g.label || g.id };
  }
  function groupesDefaut() { return (ENV.DEFAULT_GROUPS || groupes().map(function (g) { return g.id; })).slice(); }
  function familles() {
    if (ACTIONS.FAMILLES) return ACTIONS.FAMILLES;
    var by = {}, ordre = [];
    ENV.create({}).catalogue.forEach(function (a) {
      var f = a.famille || a.a;
      if (!by[f]) { by[f] = { id: f, label: f, n: 0 }; ordre.push(by[f]); }
      by[f].n++;
    });
    return ordre;
  }
  function famillesDefaut() { return familles().map(function (f) { return f.id; }); }
  function estRecurrent(m) { return (m || cfg.methode) !== 'evolution'; }

  function defaultCfg() {
    return {
      format: 'camelot-cerveau', version: 1, name: '',
      entrees: groupesDefaut(),
      actions: { familles: famillesDefaut(), cotes: ['ext', 'int'] },
      architecture: 'mlp',
      reseau: { couches: [{ neurones: 64, activation: 'relu' }, { neurones: 64, activation: 'relu' }], sortie: 'softmax', architecture: 'mlp' },
      adversaire: { actif: false, intensite: 'aucun' },
      methode: 'evolution',
      reglages: {
        population: 20, generations: 30, mutation: 0.1, scenarios_par_evaluation: 1, graine: 1, duree_max: 300, mode: 'rapide',
        epoques: 40, lot: 16, imitation_lr: 0.001, imitation_scenarios: 4, imitation_exemple: true,
        ppo_steps: 100000, ppo_batch_size: 256, ppo_rollout_len: 32, ppo_lr: 0.0003, ppo_penalite_erreur: 0, pretrain_imitation: true,
        hidden: NET.REC.HIDDEN, processus: 0, eval_matchs: 200
      },
      recompense: { base: 'score', penalite_erreur: 0, penalite_contact: 0, sur_erreur: 'penalite' },
      graine: 1
    };
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function slugify(s) { return (s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtDate(s) { return new Date(s * 1000).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); }

  function nIn() { return ENV.nInputs(cfg.entrees); }
  function nOut() { return ACTIONS.filterByFamilles(cfg.actions.familles).length; }
  function par() {
    return estRecurrent() ? NET.countParamsRecurrent(nIn(), nOut(), cfg.reglages.hidden) : NET.countParams(nIn(), cfg.reseau.couches, nOut());
  }

  function api(method, url, body) {
    return fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'same-origin' }).then(function (r) {
      if (r.status === 401) { location.href = '../connexion/?suite=' + encodeURIComponent(location.pathname); throw new Error('session expirée'); }
      var ct = r.headers.get('content-type') || '';
      if (ct.indexOf('json') < 0) return r.text().then(function (t) { if (!r.ok) throw new Error(t || ('erreur ' + r.status)); return t; });
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ('erreur ' + r.status)); return j; });
    });
  }

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

  function snapshot() { return JSON.stringify(cfg); }
  function isDirty() { return snapshot() !== savedSnap || $('sName').value.trim() !== current; }
  function markSaved(yes) { savedSnap = yes ? snapshot() : ''; current = yes ? $('sName').value.trim() : current; lsSet('icamlot-cerveau-saved', savedSnap || null); updateDirty(); }
  function updateDirty() {
    var s = $('state'), name = $('sName').value.trim();
    if (!current || !savedSnap) { s.textContent = 'non enregistré'; s.className = 'state' + (name ? ' dirty' : ''); }
    else if (isDirty()) { s.textContent = 'modifié'; s.className = 'state dirty'; }
    else { s.textContent = 'enregistré'; s.className = 'state saved'; }
    document.title = (name ? name + ' · ' : '') + 'Atelier Cerveau · ICAM LOT';
  }

  function readUi() {
    cfg.entrees = Array.prototype.map.call(document.querySelectorAll('#entrees input:checked'), function (i) { return i.value; });
    if (!cfg.entrees.length) cfg.entrees = ['temps'];
    cfg.actions.familles = Array.prototype.map.call(document.querySelectorAll('#sorties input:checked'), function (i) { return i.value; });
    if (cfg.actions.familles.indexOf('trone') < 0) cfg.actions.familles.push('trone');
    cfg.architecture = estRecurrent() ? 'recurrent' : 'mlp';
    cfg.reseau.architecture = cfg.architecture;
    cfg.graine = parseInt($('pSeed').value, 10) || 1;
    var r = cfg.reglages;
    function ent(id, d, lo, hi) { var v = parseInt($(id).value, 10); if (isNaN(v)) v = d; return Math.max(lo, Math.min(hi, v)); }
    function flt(id, d) { var v = parseFloat($(id).value); return isNaN(v) ? d : v; }
    r.graine = parseInt($('rSeed').value, 10) || cfg.graine;
    r.population = parseInt($('rPop').value, 10) || 20;
    r.generations = parseInt($('rGen').value, 10) || 30;
    r.mutation = parseFloat($('rMut').value) || 0.1;
    r.scenarios_par_evaluation = parseInt($('rScen').value, 10) || 1;
    r.duree_max = parseInt($('rMax').value, 10) || 300;
    r.epoques = parseInt($('rEp').value, 10) || 40;
    r.imitation_lr = parseFloat($('rImiLr').value) || 0.001;
    r.lot = parseInt($('rBatch').value, 10) || 16;
    r.imitation_scenarios = ent('rImiScen', 4, 1, 64);
    r.imitation_exemple = $('rImiEx').checked;
    r.ppo_steps = parseInt($('rPpoSteps').value, 10) || 100000;
    r.ppo_batch_size = parseInt($('rPpoBatch').value, 10) || 256;
    r.ppo_rollout_len = parseInt($('rPpoRollout').value, 10) || 32;
    r.ppo_lr = parseFloat($('rPpoLr').value) || 0.0003;
    r.ppo_penalite_erreur = Math.max(0, Math.min(100, flt('rPpoPen', 0)));
    r.pretrain_imitation = $('rPpoPretrain').checked;
    r.hidden = ent('pHidden', NET.REC.HIDDEN, NET.REC.MIN_HIDDEN, NET.REC.MAX_HIDDEN);
    r.processus = ent('rProc', 0, 0, 64);
    r.eval_matchs = ent('rEvalN', 200, 0, 2000);
    cfg.recompense.penalite_erreur = parseFloat($('rPenE').value) || 0;
    cfg.recompense.penalite_contact = parseFloat($('rPenC').value) || 0;
    cfg.recompense.sur_erreur = $('rFinErr').checked ? 'fin' : 'penalite';
    cfg.name = $('sName').value.trim();
  }
  function writeUi() {
    $('sName').value = cfg.name || current || '';
    $('pSeed').value = cfg.graine || 1;
    var r = cfg.reglages;
    $('rPop').value = r.population; $('rGen').value = r.generations; $('rMut').value = r.mutation;
    $('rScen').value = r.scenarios_par_evaluation; $('rMax').value = r.duree_max; $('rSeed').value = r.graine;
    $('rEp').value = r.epoques; $('rImiLr').value = r.imitation_lr; $('rBatch').value = r.lot;
    $('rImiScen').value = r.imitation_scenarios; $('rImiEx').checked = r.imitation_exemple !== false;
    $('rPpoSteps').value = r.ppo_steps; $('rPpoBatch').value = r.ppo_batch_size; $('rPpoRollout').value = r.ppo_rollout_len;
    $('rPpoLr').value = r.ppo_lr; $('rPpoPen').value = r.ppo_penalite_erreur; $('rPpoPretrain').checked = r.pretrain_imitation !== false;
    $('pHidden').value = r.hidden; $('rProc').value = r.processus; $('rEvalN').value = r.eval_matchs;
    $('rPenE').value = cfg.recompense.penalite_erreur; $('rPenC').value = cfg.recompense.penalite_contact;
    $('rFinErr').checked = cfg.recompense.sur_erreur === 'fin';
    document.querySelectorAll('#meth button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.m === cfg.methode)); });
    document.querySelectorAll('#adv button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.i === cfg.adversaire.intensite)); });
    setMethode(cfg.methode, true);
    renderCatalog(); renderLayers(); refreshNet();
  }

  function renderCatalog() {
    var box = $('entrees'); box.innerHTML = '';
    groupes().forEach(function (g) {
      var on = cfg.entrees.indexOf(g.id) >= 0, gi = groupeInfo(g);
      var d = document.createElement('label'); d.className = 'chk';
      d.innerHTML = '<input type="checkbox" value="' + g.id + '"' + (on ? ' checked' : '') + '><span><b>' + esc(gi.label) + '</b> · ' + gi.n + ' val.<small style="display:block;font-weight:400" class="muted">' + esc(gi.desc || '') + '</small></span>';
      d.querySelector('input').addEventListener('change', function () { readUi(); refreshNet(); updateDirty(); });
      box.appendChild(d);
    });
    var so = $('sorties'); so.innerHTML = '';
    familles().forEach(function (f) {
      var on = cfg.actions.familles.indexOf(f.id) >= 0;
      var d = document.createElement('label'); d.className = 'chk';
      d.innerHTML = '<input type="checkbox" value="' + f.id + '"' + (on ? ' checked' : '') + (f.id === 'trone' ? ' disabled' : '') + '><span><b>' + esc(f.label) + '</b> · ' + f.n + ' sorties</span>';
      d.querySelector('input').addEventListener('change', function () { readUi(); refreshNet(); updateDirty(); });
      so.appendChild(d);
    });
  }
  function renderLayers() {
    var box = $('layers'); box.innerHTML = '';
    cfg.reseau.couches.forEach(function (c, i) {
      var row = document.createElement('div'); row.className = 'layer';
      row.innerHTML = '<span class="n">' + (i + 1) + '</span>';
      var inp = document.createElement('input'); inp.type = 'number'; inp.min = '1'; inp.max = String(NET.MAX_NEURONS); inp.value = c.neurones; inp.setAttribute('aria-label', 'Neurones couche ' + (i + 1));
      inp.addEventListener('change', function () { c.neurones = Math.max(1, Math.min(NET.MAX_NEURONS, parseInt(inp.value, 10) || 1)); refreshNet(); updateDirty(); });
      var sel = document.createElement('select'); sel.setAttribute('aria-label', 'Activation couche ' + (i + 1));
      [['relu', 'ReLU'], ['tanh', 'tanh'], ['sigmoid', 'sigmoïde']].forEach(function (o) { var e = document.createElement('option'); e.value = o[0]; e.textContent = o[1]; if (o[0] === c.activation) e.selected = true; sel.appendChild(e); });
      sel.addEventListener('change', function () { c.activation = sel.value; refreshNet(); updateDirty(); });
      var del = document.createElement('button'); del.type = 'button'; del.className = 'danger'; del.innerHTML = '<i class="fa-solid fa-trash-can"></i>'; del.setAttribute('aria-label', 'Retirer la couche ' + (i + 1));
      del.disabled = cfg.reseau.couches.length <= 1;
      del.addEventListener('click', function () { cfg.reseau.couches.splice(i, 1); renderLayers(); refreshNet(); updateDirty(); });
      row.appendChild(inp); row.appendChild(sel); row.appendChild(del); box.appendChild(row);
    });
  }
  function refreshNet() {
    var rec = estRecurrent(), p = par();
    $('archMlp').hidden = rec; $('archRec').hidden = !rec;
    $('archName').textContent = rec ? 'Récurrent (GRU)' : 'MLP';
    $('nHidLbl').textContent = rec ? 'État caché' : 'Couches cachées';
    $('nSortie').textContent = rec ? 'logits' : 'softmax';
    $('nIn').textContent = nIn(); $('nOut').textContent = nOut(); $('nPar').textContent = p.total.toLocaleString('fr-FR');
    $('nHid').textContent = rec ? cfg.reglages.hidden : cfg.reseau.couches.length;
    $('parDetail').innerHTML = p.detail.map(function (d) { return esc(d.txt); }).join(' &nbsp;·&nbsp; ');
    if (p.total > NET.MAX_PARAMS) $('parDetail').innerHTML += ' <span class="bad">Plafond ' + NET.MAX_PARAMS.toLocaleString('fr-FR') + ' dépassé.</span>';
    $('recDetail').textContent = 'Encodeur ' + NET.REC.ENCODEUR + ' (LayerNorm, SiLU) · GRU ' + cfg.reglages.hidden + ' · tête de politique ' + nOut() + ' · critique ' + NET.REC.CRITIQUE + ' (entraînement seulement).';
    $('code').textContent = NET.pytorchCode(slugify($('sName').value) || 'Cerveau', nIn(), cfg.reseau.couches, nOut(), cfg.architecture, cfg.reglages.hidden);
    NET.draw($('netCv'), nIn(), rec ? [{ neurones: NET.REC.ENCODEUR, activation: 'encodeur' }, { neurones: cfg.reglages.hidden, activation: 'GRU' }] : cfg.reseau.couches, nOut());
  }

  $('bAddLayer').addEventListener('click', function () {
    if (cfg.reseau.couches.length >= NET.MAX_LAYERS) return toast('Plafond de ' + NET.MAX_LAYERS + ' couches.', 'bad');
    cfg.reseau.couches.push({ neurones: 64, activation: 'relu' }); renderLayers(); refreshNet(); updateDirty();
  });
  $('bDefNet').addEventListener('click', function () {
    cfg.reseau.couches = [{ neurones: 64, activation: 'relu' }, { neurones: 64, activation: 'relu' }]; renderLayers(); refreshNet(); updateDirty();
  });

  $('pSeed').addEventListener('change', function () { cfg.graine = parseInt($('pSeed').value, 10) || 1; updateDirty(); });

  function setMethode(m, silent) {
    cfg.methode = m;
    cfg.architecture = estRecurrent(m) ? 'recurrent' : 'mlp';
    cfg.reseau.architecture = cfg.architecture;
    document.querySelectorAll('#meth button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.m === m)); });
    $('reglEvo').hidden = m !== 'evolution';
    $('reglImi').hidden = !(m === 'imitation' || (m === 'ppo' && cfg.reglages.pretrain_imitation !== false));
    $('imiTitre').textContent = m === 'ppo' ? 'Pré-entraînement par imitation' : 'Imitation';
    $('reglPpo').hidden = m !== 'ppo';
    $('lEval').hidden = m === 'evolution';
    if (m === 'imitation') {
      $('methHelp').textContent = 'Le réseau récurrent apprend à reproduire les stratégies enregistrées, rejouées pas à pas dans le moteur JS.';
    } else if (m === 'ppo') {
      $('methHelp').textContent = 'PPO récurrent : politique unique (GRU) entraînée dans le moteur JS, récompense = score officiel moins les pénalités d\'erreur.';
    } else {
      $('methHelp').textContent = 'Une population de MLP joue des matchs ; on garde les meilleurs et on les mute.';
    }
    refreshNet();
    if (!silent) updateDirty();
  }
  document.querySelectorAll('#meth button').forEach(function (b) { b.addEventListener('click', function () { setMethode(b.dataset.m); }); });
  document.querySelectorAll('#adv button').forEach(function (b) {
    b.addEventListener('click', function () {
      cfg.adversaire.intensite = b.dataset.i; cfg.adversaire.actif = b.dataset.i !== 'aucun';
      document.querySelectorAll('#adv button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      updateDirty();
    });
  });
  ['rPop', 'rGen', 'rMut', 'rScen', 'rMax', 'rSeed', 'rEp', 'rImiLr', 'rBatch', 'rImiScen', 'rImiEx', 'rPenE', 'rPenC', 'rFinErr', 'pHidden', 'rProc', 'rEvalN',
   'rPpoSteps', 'rPpoBatch', 'rPpoRollout', 'rPpoLr', 'rPpoPen', 'rPpoPretrain'].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener('change', function () { readUi(); setMethode(cfg.methode, true); updateDirty(); });
  });

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { var on = x === t; x.setAttribute('aria-selected', String(on)); $('pane-' + x.dataset.pane).hidden = !on; });
      if (t.dataset.pane === 'train') loadProcs();
    });
  });

  var openDrawer = null;
  function showDrawer(id) { openDrawer = $(id); openDrawer.classList.add('open'); $('scrim').hidden = false; refreshBrains(); }
  function closeDrawer() { if (!openDrawer) return; openDrawer.classList.remove('open'); openDrawer = null; $('scrim').hidden = true; }
  $('bList').addEventListener('click', function () { showDrawer('dList'); });
  $('scrim').addEventListener('click', closeDrawer);
  document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', closeDrawer); });

  function renderBrains() {
    var ul = $('brains'), q = slugify($('sFilter').value); ul.innerHTML = '';
    var list = brains.filter(function (s) { return !q || s.slug.indexOf(q) >= 0; });
    if (!list.length) { ul.innerHTML = '<li class="muted" style="display:block;border:none;background:none;text-align:center">' + (brains.length ? 'Aucun cerveau ne correspond.' : 'Aucun cerveau enregistré pour l\'instant.') + '</li>'; return; }
    list.forEach(function (s) {
      var li = document.createElement('li'); if (s.slug === slugify(current)) li.className = 'cur';
      var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = s.name;
      var meta = document.createElement('span'); meta.className = 'meta';
      meta.textContent = (s.n_parametres || '?') + ' param. · ' + (s.methode || '') + (s.entraine ? ' · entraîné' : '') + ' · ' + fmtDate(s.updated);
      nm.appendChild(meta); li.appendChild(nm);
      var act = document.createElement('span'); act.className = 'act';
      var bl = document.createElement('button'); bl.type = 'button'; bl.textContent = 'Ouvrir';
      bl.addEventListener('click', function () { confirmLoss(function () { loadBrain(s.slug); }); });
      var bp = document.createElement('button'); bp.type = 'button'; bp.className = 'primary'; bp.textContent = 'Jouer';
      bp.addEventListener('click', function () { openOnPlateau(s.slug, s.name); });
      var bd = document.createElement('button'); bd.type = 'button'; bd.className = 'danger';
      bd.innerHTML = delArm === s.slug ? 'Confirmer' : '<i class="fa-solid fa-trash-can"></i>';
      bd.addEventListener('click', function () { if (delArm === s.slug) delBrain(s.slug, s.name); else { delArm = s.slug; renderBrains(); } });
      act.appendChild(bl); act.appendChild(bp); act.appendChild(bd); li.appendChild(act); ul.appendChild(li);
    });
  }
  function refreshBrains() {
    return api('GET', API + '/cerveaux').then(function (j) { brains = j.cerveaux || []; renderBrains(); }, function () {
      brains = []; $('brains').innerHTML = '<li class="bad" style="display:block;border:none;background:none">Serveur injoignable.</li>';
    });
  }
  function confirmLoss(go) { if (!isDirty()) go(); else toast('Les modifications non enregistrées seront perdues.', 'bad', [['Continuer', go], ['Annuler', null]]); }
  /* Poids de l'API : camelot-poids v2 récurrent (modèle + évaluation) ou v1 MLP (layers). */
  function setPoids(w) {
    poids = null;
    if (!w) return null;
    var m = RUNTIME.modeleDe(w);
    if (m) poids = { kind: 'recurrent', model: m, evaluation: w.evaluation || null, fichiers: w.fichiers || null };
    else if (w.format === 'camelot-poids' && w.version === 2) throw new Error('Poids v2 sans modèle récurrent (architecture ' + w.architecture + ').');
    else if (w.layers || Array.isArray(w)) poids = { kind: 'mlp', layers: w.layers || w };
    else throw new Error('Format de poids inconnu.');
    return poids;
  }
  function chargerPoids(slug, quiet) {
    return api('GET', API + '/cerveaux/' + slug + '/poids').then(function (w) {
      try { setPoids(w); } catch (e) { toast(e.message, 'bad'); }
    }, function () { setPoids(null); }).then(function () { refreshPlayInfo(); renderServerEval(poids && poids.evaluation); });
  }
  function applyBrain(j) {
    var def = defaultCfg();
    cfg = Object.assign(def, j);
    cfg.methode = j.methode || 'evolution';
    cfg.architecture = estRecurrent(cfg.methode) ? 'recurrent' : 'mlp';
    cfg.reseau = Object.assign(def.reseau, j.reseau || {});
    cfg.reseau.architecture = cfg.architecture;
    cfg.actions = j.actions || cfg.actions;
    // options retirées (curriculum, world model, MCTS, ancien taux d'apprentissage...) : on ne garde que les réglages connus
    var r = {};
    Object.keys(def.reglages).forEach(function (k) { r[k] = (j.reglages && j.reglages[k] != null) ? j.reglages[k] : def.reglages[k]; });
    cfg.reglages = r;
    cfg.recompense = Object.assign(defaultCfg().recompense, j.recompense || {});
    cfg.adversaire = Object.assign(defaultCfg().adversaire, j.adversaire || {});
    current = j.name; $('sName').value = j.name;
    writeUi(); markSaved(true);
    if (j.obsolète && j.obsolète.length) {
      toast('Ce cerveau a été entraîné avec un ' + j.obsolète.join(' et un ') + ' plus ancien. Réentraîne-le pour coller au règlement actuel.', 'bad');
    }
    poids = null;
    refreshPlayInfo(); renderServerEval(null);
    if (j.entraine) chargerPoids(slugify(j.name));
  }
  function loadBrain(slug) {
    delArm = '';
    api('GET', API + '/cerveaux/' + slug).then(function (j) { applyBrain(j); closeDrawer(); toast('« ' + j.name + ' » ouvert', 'ok'); }, function (e) { toast('Impossible d\'ouvrir : ' + e.message, 'bad'); });
  }
  function delBrain(slug, name) {
    delArm = '';
    api('DELETE', API + '/cerveaux/' + slug).then(function () {
      if (slug === slugify(current)) markSaved(false);
      toast('« ' + name + ' » supprimé'); refreshBrains();
    }, function (e) { toast('Suppression impossible : ' + e.message, 'bad'); renderBrains(); });
  }
  function doSave(name) {
    readUi(); cfg.name = name;
    return api('PUT', API + '/cerveaux/' + slugify(name), cfg).then(function () {
      current = name; markSaved(true); toast('« ' + name + ' » enregistré', 'ok'); refreshBrains();
      return name;
    });
  }
  function save() {
    var name = $('sName').value.trim(), slug = slugify(name);
    if (!slug) { $('sName').focus(); toast('Donne d\'abord un nom au cerveau (en haut).', 'bad'); return Promise.reject(new Error('nom')); }
    return api('GET', API + '/cerveaux').then(function (j) {
      brains = j.cerveaux || [];
      var clash = brains.filter(function (s) { return s.slug === slug; })[0];
      if (clash && slug !== slugify(current)) {
        return new Promise(function (resolve, reject) {
          toast('« ' + clash.name + ' » existe déjà.', 'bad', [['Remplacer', function () { doSave(name).then(resolve, reject); }], ['Annuler', function () { reject(new Error('annulé')); }]]);
        });
      }
      return doSave(name);
    }, function (e) { toast('Serveur injoignable : ' + e.message, 'bad'); throw e; });
  }
  $('bSave').addEventListener('click', save);
  $('fName').addEventListener('submit', function (e) { e.preventDefault(); save(); });
  $('sName').addEventListener('input', function () { refreshNet(); updateDirty(); });
  $('sFilter').addEventListener('input', renderBrains);
  $('bNew').addEventListener('click', function () {
    confirmLoss(function () { cfg = defaultCfg(); current = ''; $('sName').value = ''; writeUi(); markSaved(false); closeDrawer(); $('sName').focus(); });
  });
  $('bDup').addEventListener('click', function () {
    var name = ($('sName').value.trim() || 'Cerveau') + ' copie';
    $('sName').value = name; current = ''; markSaved(false); toast('Copie locale : enregistre sous un nouveau nom.');
  });

  /* ---------- entraînement ---------- */
  function setJobBtns(status) {
    var run = status === 'running', pause = status === 'paused', queued = status === 'queued';
    $('bStart').disabled = run || queued;
    $('bPause').disabled = !run && !pause;
    $('bPause').innerHTML = pause ? '<i class="fa-solid fa-play"></i> Reprendre' : '<i class="fa-solid fa-pause"></i> Pause';
    $('bStop').disabled = !(run || pause || queued);
  }
  function drawChart(hist, methode) {
    var cv = $('chart'), ctx = cv.getContext('2d'), dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = cv.clientWidth || 480, h = cv.clientHeight || 220;
    cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!hist || !hist.length) return;
    // imitation : perte seule ; PPO et évolution : score (record, moyen, pire)
    var keys = methode === 'imitation' ? [['loss', '#f5c518']] : [['best', '#3ccf7a'], ['mean', '#f5c518'], ['worst', '#ff6b6b']];
    var pad = 28, ys = [];
    hist.forEach(function (p) { keys.forEach(function (k) { if (p[k[0]] != null) ys.push(p[k[0]]); }); });
    if (!ys.length) return;
    var ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
    if (ymin === ymax) { ymin -= 1; ymax += 1; }
    function X(i) { return pad + (w - 2 * pad) * i / Math.max(hist.length - 1, 1); }
    function Y(v) { return h - pad - (h - 2 * pad) * (v - ymin) / (ymax - ymin); }
    ctx.strokeStyle = '#2a2d39'; ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, h - pad); ctx.lineTo(w - pad, h - pad); ctx.stroke();
    ctx.fillStyle = '#a9adba'; ctx.font = '11px "IBM Plex Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText(String(Math.round(ymax * 100) / 100), 4, pad - 8); ctx.fillText(String(Math.round(ymin * 100) / 100), 4, h - pad + 14);
    keys.forEach(function (k) {
      ctx.strokeStyle = k[1]; ctx.beginPath(); var started = false;
      hist.forEach(function (p, i) { var v = p[k[0]]; if (v == null) return; if (!started) { ctx.moveTo(X(i), Y(v)); started = true; } else ctx.lineTo(X(i), Y(v)); });
      ctx.stroke();
    });
  }
  function fmt(v, d) { return v == null ? '—' : (Math.round(v * Math.pow(10, d == null ? 1 : d)) / Math.pow(10, d == null ? 1 : d)).toLocaleString('fr-FR'); }
  function diagnose(hist, methode, p) {
    var box = $('tDiag'); p = p || {};
    if (methode === 'imitation') {
      var txt = p.loss != null ? 'Perte ' + fmt(p.loss, 4) + (p.precision != null ? ' · précision ' + fmt(p.precision * 100, 1) + ' %' : '') + (p.cibles_invalides ? ' · ' + p.cibles_invalides + ' cibles invalides' : '') + '. ' : '';
      if (hist && hist.length >= 4) {
        var a = hist[hist.length - 4].loss, b = hist[hist.length - 1].loss;
        if (b > a * 1.05) txt += 'La perte remonte : possible surapprentissage.';
        else if (Math.abs(b - a) / Math.max(a, 1e-6) < 0.02) txt += 'La perte ne baisse plus beaucoup.';
      }
      box.textContent = txt; return;
    }
    if (!hist || hist.length < 1) { box.textContent = ''; return; }
    var last = hist[hist.length - 1];
    if (methode === 'ppo') {
      box.innerHTML = '<span style="color:#3ccf7a">● Record : ' + fmt(last.best) + ' pts</span> &nbsp; <span style="color:#f5c518">● Moyen : ' + fmt(last.mean) + ' pts</span> &nbsp; <span class="muted">perte politique ' + fmt(last.loss, 4) + ' · entropie ' + fmt(last.entropy, 3) + '</span>';
      return;
    }
    if (hist.length < 4) { box.textContent = ''; return; }
    var bests = hist.map(function (q) { return q.best; }).slice(-4);
    box.textContent = bests.every(function (v) { return v === bests[0]; }) ? 'Le score ne progresse plus.' : '';
  }
  function showProgress(j) {
    var p = j.progress || {}, m = j.methode || cfg.methode;
    $('tJob').textContent = (j.name || '') + ' · ' + (j.status || '');
    $('tQueue').textContent = j.queue ? 'position ' + j.queue : (j.status === 'running' ? 'en cours' : 'libre');
    if (p.step && p.steps) {
      var pct = Math.round((p.step / p.steps) * 100);
      $('tProg').textContent = pct + '% (' + (p.generation || 1) + '/' + (p.generations || 1) + ')';
    } else if (p.generation) {
      $('tProg').textContent = p.generation + ' / ' + p.generations;
    } else if (p.message && (j.status === 'running' || j.status === 'paused')) {
      $('tProg').textContent = p.message;  // pas encore de génération (pré-entraînement, 1er rollout…)
    } else {
      $('tProg').textContent = j.status === 'queued' ? 'file' : '—';
    }
    $('tProg').className = $('tProg').textContent.length > 12 ? 'msg' : '';
    $('tEta').textContent = p.eta_s != null ? Math.round(p.eta_s) + ' s' : '—';
    $('tMps').textContent = p.matches_per_s != null ? p.matches_per_s : '—';
    if (p.device) $('tDev').textContent = (p.name || p.device) + (p.vram_mo ? ' · ' + p.vram_mo + ' Mo' : '');
    drawChart(p.history, m); diagnose(p.history, m, p);
    setJobBtns(j.status);
    if (j.status === 'done') {
      toast('Entraînement terminé' + (j.best_score ? ' · meilleur score ' + Math.round(j.best_score) : ''), 'ok');
      chargerPoids(slugify(j.slug || current)).then(function () { if (poids && poids.evaluation) showEvalSummary(poids.evaluation); });
    }
    if (j.status === 'error' || j.status === 'interrupted') {
      toast(j.error || 'Erreur ou interruption de l\'entraînement', 'bad');
      if (j.error) $('tDiag').innerHTML = '<span style="color:#ff6b6b">⚠️ ' + esc(j.error) + '</span>';
    }
  }
  function poll() {
    if (!jobId) return;
    api('GET', API + '/trainings/' + jobId).then(function (j) {
      showProgress(j);
      api('GET', API + '/trainings/' + jobId + '/log').then(function (t) { $('tLog').textContent = t || ''; $('tLog').scrollTop = $('tLog').scrollHeight; }, function () {});
      if (j.status === 'running' || j.status === 'queued' || j.status === 'paused') pollTimer = setTimeout(poll, 1500);
      else { jobId = j.status === 'done' ? jobId : jobId; setJobBtns(j.status); }
    }, function (e) { $('tLog').textContent = e.message; });
  }
  $('bStart').addEventListener('click', function () {
    readUi();
    var name = $('sName').value.trim();
    if (!slugify(name)) { toast('Enregistre le cerveau avant de lancer un entraînement.', 'bad'); return; }
    save().then(function () {
      return api('POST', API + '/trainings', { slug: slugify(name), methode: cfg.methode, reglages: cfg.reglages, reprendre: $('rResume').checked });
    }).then(function (j) {
      jobId = j.id; $('tLog').textContent = ''; showProgress(j); poll();
      toast(j.status === 'queued' ? 'En file d\'attente (position ' + j.queue + ').' : 'Entraînement lancé.', 'ok');
    }, function (e) { if (e && e.message !== 'nom' && e.message !== 'annulé') toast(e.message, 'bad'); });
  });
  $('bPause').addEventListener('click', function () {
    if (!jobId) return;
    var act = $('bPause').textContent.indexOf('Reprendre') >= 0 ? 'resume' : 'pause';
    api('POST', API + '/trainings/' + jobId + '/' + act).then(function () { poll(); }, function (e) { toast(e.message, 'bad'); });
  });
  $('bStop').addEventListener('click', function () {
    if (!jobId) return;
    $('bStop').disabled = true;
    api('POST', API + '/trainings/' + jobId + '/stop').then(function (r) {
      toast(r && r.sigkill ? 'Tâche arrêtée (SIGKILL après ' + fmt(r.grace_s, 0) + ' s).' : 'Tâche arrêtée.', 'ok');
      poll(); loadProcs();
    }, function (e) { toast(e.message, 'bad'); poll(); });
  });

  /* ---------- processus de calcul (panneau Serveur) ---------- */
  var procTimer = null;
  function fmtDur(s) {
    s = Math.max(0, Math.round(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? h + ' h ' + (m < 10 ? '0' : '') + m + ' min' : m ? m + ' min ' + (s % 60) + ' s' : s + ' s';
  }
  function procError(msg) { var e = $('procErr'); e.hidden = !msg; e.textContent = msg ? '⚠️ ' + msg : ''; }
  function renderProcs(list) {
    var body = $('procBody');
    $('bProcAll').disabled = !list.length;
    if (!list.length) { body.innerHTML = '<li class="muted">Aucun processus de calcul.</li>'; return; }
    body.innerHTML = list.map(function (q) {
      return '<li><div><b>' + q.pid + '</b> · ' + (q.type === 'entraineur' ? 'entraîneur' : 'worker Node') + ' · ' +
        (q.tache ? '<span title="' + esc(q.tache) + '">' + esc(q.nom || q.tache) + '</span>' : '<span class="muted">tâche inconnue</span>') +
        '<small>' + fmtDur(q.duree_s) + ' · ' + (q.rss_mo != null ? fmt(q.rss_mo, 0) + ' Mo' : '—') + '</small></div>' +
        '<button type="button" class="danger" data-stop="' + q.pid + '"><i class="fa-solid fa-stop"></i> Arrêter</button></li>';
    }).join('');
  }
  function loadProcs() {
    return api('GET', API + '/processus').then(function (j) { procError(''); renderProcs(j.processus || []); },
      function (e) { procError('Liste des processus indisponible : ' + e.message); });
  }
  $('procBody').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-stop]'); if (!b) return;
    b.disabled = true;
    api('POST', API + '/processus/' + b.dataset.stop + '/stop').then(function (r) {
      procError(r.survivants && r.survivants.length ? 'Encore actifs après SIGKILL : ' + r.survivants.join(', ') : '');
      toast('Processus ' + b.dataset.stop + ' arrêté.', 'ok'); loadProcs(); poll();
    }, function (e) { procError('Arrêt du processus ' + b.dataset.stop + ' impossible : ' + e.message); toast(e.message, 'bad'); loadProcs(); });
  });
  $('bProcAll').addEventListener('click', function () {
    toast('Arrêter tous les processus de calcul ? Les tâches en attente démarreront ensuite.', 'bad', [['Tout arrêter', function () {
      $('bProcAll').disabled = true;
      api('POST', API + '/processus/stop-all').then(function (r) {
        procError(r.survivants && r.survivants.length ? 'Encore actifs après SIGKILL : ' + r.survivants.join(', ') : '');
        toast((r.tues || []).length + ' processus arrêtés.', 'ok'); loadProcs(); poll();
      }, function (e) { procError('Arrêt de tous les processus impossible : ' + e.message); toast(e.message, 'bad'); loadProcs(); });
    }], ['Annuler']]);
  });
  function procLoop() {
    clearTimeout(procTimer);
    if (!$('pane-train').hidden) loadProcs();
    procTimer = setTimeout(procLoop, 3000);
  }
  procLoop();

  var cpu = null;
  api('GET', API + '/trainer').then(function (j) {
    $('tDev').textContent = (j.name || j.device) + (j.cuda ? ' (CUDA)' : ' (CPU)');
    cpu = j.cpu_count ? j : null;
    if (cpu) $('tCores').textContent = cpu.cpu_count + ' vus (os.cpu_count) · ' + cpu.cpu_affinite + ' utilisables (affinité) · processus Node auto : ' + cpu.procs_auto;
    coresWarn();
  }, function () { $('tDev').textContent = 'injoignable'; });
  /* PPO : environnements par cœur (le serveur donne le seuil d'alerte) */
  function coresWarn() {
    var w = $('tCoresWarn');
    if (!cpu || cfg.methode !== 'ppo') { w.hidden = true; return; }
    var envs = parseInt($('rPpoBatch').value, 10) || 0, roll = parseInt($('rPpoRollout').value, 10) || 0;
    var cores = Math.max(1, cpu.cpu_affinite), par = envs / cores;
    if (par > cpu.envs_par_coeur_alerte) {
      w.hidden = false;
      w.textContent = '⚠️ ' + envs + ' environnements pour ' + cores + ' cœur' + (cores > 1 ? 's' : '') + ' (' + fmt(par, 0) + ' par cœur, alerte au-delà de ' + cpu.envs_par_coeur_alerte + ') : un rollout de ' + envs * roll + ' décisions sera très long. Réduis « Envs parallèles ».';
    } else w.hidden = true;
  }
  ['rPpoBatch', 'rPpoRollout', 'rProc'].forEach(function (id) { var el = $(id); if (el) el.addEventListener('input', coresWarn); });
  document.addEventListener('click', function () { setTimeout(coresWarn, 0); });

  /* ---------- évaluation / rejouer ---------- */
  function pm(st, d) { return st ? fmt(st.moyenne, d) + ' ± ' + fmt(st.ecart_type, d) : '—'; }
  function tile(label, val, sub) { return '<div class="stat"><small>' + esc(label) + '</small><b>' + val + '</b>' + (sub ? '<small style="text-transform:none;letter-spacing:0">' + sub + '</small>' : '') + '</div>'; }
  function showEvalSummary(ev) {
    var box = $('tEval');
    if (!ev) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<small class="muted">Évaluation finale (' + ev.matchs + ' matchs)</small><div class="stats" style="grid-template-columns:repeat(3,1fr)">' +
      tile('Score', pm(ev.score)) + tile('Victoires', ev.duels ? ev.victoires + '/' + ev.duels : '—') + tile('Erreurs moteur', fmt(ev.erreurs_par_match && ev.erreurs_par_match.moyenne, 2), 'par match') + '</div>';
  }
  function renderServerEval(ev) {
    var box = $('svEval');
    $('svEvalTitre').textContent = ev && ev.champion ? 'champion' : '';
    if (!ev) { box.innerHTML = '<p class="note">Aucune évaluation : ouvre un cerveau entraîné par imitation ou PPO.</p>'; showEvalSummary(null); return; }
    showEvalSummary(ev);
    var sc = ev.score || {}, er = ev.erreurs_par_match || {}, h = '<div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">';
    h += tile('Score moyen ± écart-type', pm(sc), ev.matchs + ' matchs · min ' + fmt(sc.min, 0) + ' · max ' + fmt(sc.max, 0) + (sc.ic95 != null ? ' · IC95 ± ' + fmt(sc.ic95) : ''));
    if (ev.duels) h += tile('Victoires', ev.victoires + ' / ' + ev.duels, fmt((ev.taux_victoire || 0) * 100, 0) + ' % · ' + (ev.egalites || 0) + ' égalités · ' + (ev.defaites || 0) + ' défaites');
    else h += tile('Victoires', '—', 'aucun duel (sans adversaire)');
    if (ev.score_adversaire && ev.score_adversaire.moyenne != null) h += tile('Score adverse', pm(ev.score_adversaire));
    h += tile('Erreurs moteur / match', pm(er, 2), (ev.matchs_sans_erreur != null ? ev.matchs_sans_erreur + ' matchs sans erreur sur ' + ev.matchs : '') + ' · max ' + fmt(er.max, 0));
    var bad = (ev.crashs || 0) + (ev.tronques || 0) + (ev.actions_invalides || 0);
    h += tile('Incidents', String(bad), (ev.crashs || 0) + ' crashs · ' + (ev.tronques || 0) + ' tronqués · ' + (ev.actions_invalides || 0) + ' actions invalides');
    h += '</div>';
    var dm = ev.detail_moyen || {}, keys = Object.keys(dm);
    if (keys.length) h += '<p class="note">Détail moyen : ' + keys.map(function (k) { return esc(k) + ' ' + fmt(dm[k]); }).join(' · ') + '</p>';
    var pa = ev.par_adversaire || {}, names = Object.keys(pa);
    if (names.length) {
      h += '<div style="overflow:auto"><table class="table"><thead><tr><th>Adversaire · intensité</th><th class="num">Matchs</th><th class="num">Score moyen ± écart-type</th><th class="num">Victoires</th></tr></thead><tbody>' +
        names.map(function (k) { var a = pa[k]; return '<tr><td>' + esc(k) + '</td><td class="num">' + a.matchs + '</td><td class="num">' + pm(a.score) + '</td><td class="num">' + (a.taux_victoire == null ? '—' : fmt(a.taux_victoire * 100, 0) + ' %') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }
    var pr = ev.protocole;
    if (pr) h += '<p class="note" style="margin-top:8px">Protocole : graine ' + pr.graine + ' · ' + (pr.glouton ? 'politique gloutonne' : 'politique échantillonnée') + ' · observation ' + esc(pr.obs_version || '?') + ' · catalogue ' + esc(pr.catalogue_version || '?') + (ev.duree_s != null ? ' · ' + fmt(ev.duree_s, 0) + ' s (' + fmt(ev.matchs_par_s, 2) + ' matchs/s)' : '') + '.</p>';
    box.innerHTML = h;
  }

  function makeEnv() {
    readUi();
    return ENV.create({
      entrees: cfg.entrees, familles: cfg.actions.familles,
      adversaire: cfg.adversaire, skipContacts: true,
      onError: cfg.recompense.sur_erreur
    });
  }
  function chooserFor(env) {
    if (poids && poids.kind === 'recurrent') {
      var obsV = ENV.OBS_VERSION, catV = (typeof ACTIONS !== 'undefined') ? ACTIONS.CATALOGUE_VERSION : undefined;
      // un nouvel agent par match : l'état caché repart de zéro
      return RUNTIME.chooser(poids.model, { nIn: env.nInputs, nOut: env.nOutputs, obsVersion: obsV, catalogueVersion: catV });
    }
    var layers = poids && poids.kind === 'mlp' ? poids.layers : NET.randomWeights(nIn(), cfg.reseau.couches, nOut(), cfg.graine || 1);
    var acts = cfg.reseau.couches.map(function (c) { return c.activation; });
    return function (obs, mask) { return NET.choose(NET.forward(layers, obs, acts), mask); };
  }
  function resumeRun(env, extra) {
    var R = env.result();
    var sc = SCORE.scoreAt(R, R.params, Math.min(R.T, ENV.MATCH));
    return Object.assign({ score: sc.total, detail: sc.detail, errors: R.errors.length, T: R.T }, extra || {});
  }
  function runPolicy(env, scenario) {
    env.play(chooserFor(env), scenario || {});
    return resumeRun(env, { program: env.program() });
  }
  function runRandom(env, scenario) {
    env.play(function (obs, mask) {
      var valid = []; mask.forEach(function (v, i) { if (v) valid.push(i); });
      return valid[Math.floor(Math.random() * valid.length)] || 0;
    }, scenario || {});
    return resumeRun(env);
  }
  function runScripted(env, program, scenario) {
    return env.imitate(program, scenario || { intensite: 'aucun' });
  }
  function stats(arr) {
    if (!arr.length) return { mean: 0, std: 0, min: 0, max: 0 };
    var m = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
    var v = arr.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / arr.length;
    return { mean: m, std: Math.sqrt(v), min: Math.min.apply(null, arr), max: Math.max.apply(null, arr) };
  }
  function meanDetail(runs) {
    var keys = ['pierres', 'murs', 'tours', 'porte', 'graal', 'roi', 'boulets'], o = {};
    keys.forEach(function (k) {
      o[k] = runs.reduce(function (a, r) { return a + ((r.detail && r.detail[k]) || 0); }, 0) / Math.max(runs.length, 1);
    });
    o.errors = runs.reduce(function (a, r) { return a + (r.errors || 0); }, 0) / Math.max(runs.length, 1);
    return o;
  }
  function rowHtml(name, runs) {
    var s = stats(runs.map(function (r) { return r.score; })), d = meanDetail(runs);
    function n(v) { return (Math.round(v * 10) / 10).toLocaleString('fr-FR'); }
    return '<tr><td>' + esc(name) + '</td><td class="num">' + n(s.mean) + ' ± ' + n(s.std) + '</td><td class="num">' + n(s.min) + '</td><td class="num">' + n(s.max) + '</td>' +
      ['pierres', 'murs', 'tours', 'porte', 'graal', 'roi', 'boulets', 'errors'].map(function (k) { return '<td class="num">' + n(d[k]) + '</td>'; }).join('') + '</tr>';
  }
  $('bEval').addEventListener('click', function () {
    $('eStatus').textContent = 'Évaluation en cours…';
    var n = Math.max(1, Math.min(20, parseInt($('eN').value, 10) || 5));
    setTimeout(function () {
      try {
        var env = makeEnv(), pret = !!poids || estRecurrent() === false;
        var model = [], rnd = [], scr = [];
        for (var i = 0; i < n; i++) {
          var scn = { seed: 1000 + i, intensite: cfg.adversaire.intensite, opponent: ENV.pickOpponent(oppPool, 1000 + i, cfg.adversaire.intensite) };
          if (pret) model.push(runPolicy(env, scn));
          rnd.push(runRandom(env, scn));
          scr.push(runScripted(env, ENGINE.PROGRAMME_REFERENCE, { seed: 1000 + i, intensite: 'aucun' }));
        }
        $('eTable').tBodies[0].innerHTML = (pret ? rowHtml('Ce cerveau' + (poids ? '' : ' (poids aléatoires)'), model) : '') + rowHtml('Aléatoire (actions valides)', rnd) + rowHtml('Stratégie de référence', scr);
        $('eStatus').textContent = n + ' scénarios · graines 1000 à ' + (1000 + n - 1) + '.' + (pret ? '' : ' Pas de poids entraînés pour ce cerveau récurrent : seules les références sont jouées.');
      } catch (e) { $('eStatus').textContent = 'Erreur : ' + e.message; }
    }, 40);
  });

  function refreshPlayInfo() {
    var name = $('sName').value.trim() || current;
    var box = $('rCurrent');
    if (box) {
      box.innerHTML = name
        ? '<b>' + esc(name) + '</b> — ' + (poids ? 'poids ' + (poids.kind === 'recurrent' ? 'du modèle récurrent (' + poids.model.hidden + ' unités cachées)' : 'MLP') + ' chargés, il jouera en direct.' : 'pas encore de poids entraînés : le plateau tirera au sort parmi les actions valides.')
        : '<b>Aucun cerveau ouvert.</b> Ouvre-en un dans la liste, ou donne un nom à celui-ci et enregistre-le.';
    }
    if ($('rInfo')) {
      $('rInfo').textContent = name
        ? 'Le plateau charge le réseau et lui demande la prochaine action après chaque brique, jusqu\'à 100 s. Ce n\'est pas une stratégie enregistrée.'
        : 'Ouvre un cerveau déjà entraîné, ou enregistre celui-ci, puis charge-le. Sur le plateau tu pourras aussi ouvrir une stratégie écrite à la main.';
    }
  }
  function openOnPlateau(slug, name) {
    if (!slug) { toast('Donne un nom et enregistre le cerveau avant de le jouer.', 'bad'); return; }
    try {
      sessionStorage.setItem('icamlot-pilot', JSON.stringify({
        mode: 'cerveau', slug: slug, name: name || slug, intensity: (cfg.adversaire && cfg.adversaire.intensite) || 'aucun'
      }));
    } catch (e) {}
    location.href = '../plateau/';
  }
  $('bPickBrain').addEventListener('click', function () { showDrawer('dList'); });
  $('bOpenPlateau').addEventListener('click', function () {
    var name = $('sName').value.trim() || current;
    var slug = slugify(name);
    if (!slug) { showDrawer('dList'); toast('Ouvre d\'abord un cerveau enregistré, ou donne-lui un nom.', 'bad'); return; }
    openOnPlateau(slug, name);
  });

  window.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { hideToast(); closeDrawer(); }
  });
  window.addEventListener('resize', function () { refreshNet(); });

  cfg = defaultCfg();
  writeUi(); markSaved(false);
  refreshPlayInfo();
  refreshBrains();
  api('GET', API + '/strategies').then(function (j) {
    var list = (j.strategies || []).slice(0, 8);
    return Promise.all(list.map(function (s) {
      return api('GET', API + '/strategies/' + s.slug).then(function (full) {
        var q = ENV.qualify(full);
        if (!q.ok) return null;
        full.slug = s.slug; full.score = q.score;
        return full;
      }, function () { return null; });
    })).then(function (rows) {
      var ok = rows.filter(Boolean);
      if (ok.length) oppPool = ok.concat(oppPool);
    });
  }, function () {});
})();
