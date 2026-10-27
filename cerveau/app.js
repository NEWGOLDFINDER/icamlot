/* Atelier Cerveau : construction, entraînement, évaluation, rejouer. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var API = '../api';
  var current = '', savedSnap = '', delArm = '', brains = [], jobId = null, pollTimer = null;
  var oppPool = [{ name: 'Exemple', program: ENV.EXAMPLE, score: 85 }];
  var cfg = defaultCfg();
  var weights = null;

  function defaultCfg() {
    return {
      format: 'camelot-cerveau', version: 1, name: '',
      entrees: ENV.GROUPS.map(function (g) { return g.id; }),
      actions: { familles: ACTIONS.FAMILLES.map(function (f) { return f.id; }), cotes: ['ext', 'int'] },
      architecture: 'mlp',
      reseau: { couches: [{ neurones: 64, activation: 'relu' }, { neurones: 64, activation: 'relu' }], sortie: 'softmax', architecture: 'mlp' },
      adversaire: { actif: false, intensite: 'aucun' },
      methode: 'evolution',
      reglages: {
        population: 20, generations: 30, mutation: 0.1, scenarios_par_evaluation: 1, graine: 1, duree_max: 300,
        epoques: 40, taux_apprentissage: 0.02, lot: 16, mode: 'rapide',
        ppo_steps: 100000, ppo_batch_size: 256, ppo_rollout_len: 32, ppo_lr: 0.0003,
        curriculum_sokoban: true, world_model: true, mcts_eval: false, pretrain_imitation: true
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
  function par() { return NET.countParams(nIn(), cfg.reseau.couches, nOut()); }

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
    cfg.architecture = ($('pArch') && $('pArch').value) || cfg.architecture || 'mlp';
    cfg.reseau.architecture = cfg.architecture;
    cfg.graine = parseInt($('pSeed').value, 10) || 1;
    cfg.reglages.graine = parseInt($('rSeed').value, 10) || cfg.graine;
    cfg.reglages.population = parseInt($('rPop').value, 10) || 20;
    cfg.reglages.generations = parseInt($('rGen').value, 10) || 30;
    cfg.reglages.mutation = parseFloat($('rMut').value) || 0.1;
    cfg.reglages.scenarios_par_evaluation = parseInt($('rScen').value, 10) || 1;
    cfg.reglages.duree_max = parseInt($('rMax').value, 10) || 300;
    cfg.reglages.epoques = parseInt($('rEp').value, 10) || 40;
    cfg.reglages.taux_apprentissage = parseFloat($('rLr').value) || 0.02;
    cfg.reglages.lot = parseInt($('rBatch').value, 10) || 16;
    if ($('rPpoSteps')) cfg.reglages.ppo_steps = parseInt($('rPpoSteps').value, 10) || 100000;
    if ($('rPpoBatch')) cfg.reglages.ppo_batch_size = parseInt($('rPpoBatch').value, 10) || 256;
    if ($('rPpoRollout')) cfg.reglages.ppo_rollout_len = parseInt($('rPpoRollout').value, 10) || 32;
    if ($('rPpoLr')) cfg.reglages.ppo_lr = parseFloat($('rPpoLr').value) || 0.0003;
    if ($('rPpoCurriculum')) cfg.reglages.curriculum_sokoban = $('rPpoCurriculum').checked;
    if ($('rPpoWorldModel')) cfg.reglages.world_model = $('rPpoWorldModel').checked;
    if ($('rPpoMcts')) cfg.reglages.mcts_eval = $('rPpoMcts').checked;
    if ($('rPpoPretrain')) cfg.reglages.pretrain_imitation = $('rPpoPretrain').checked;
    cfg.recompense.penalite_erreur = parseFloat($('rPenE').value) || 0;
    cfg.recompense.penalite_contact = parseFloat($('rPenC').value) || 0;
    cfg.recompense.sur_erreur = $('rFinErr').checked ? 'fin' : 'penalite';
    cfg.name = $('sName').value.trim();
  }
  function writeUi() {
    $('sName').value = cfg.name || current || '';
    $('pSeed').value = cfg.graine || 1;
    if ($('pArch')) $('pArch').value = cfg.architecture || (cfg.reseau && cfg.reseau.architecture) || 'mlp';
    var r = cfg.reglages;
    $('rPop').value = r.population; $('rGen').value = r.generations; $('rMut').value = r.mutation;
    $('rScen').value = r.scenarios_par_evaluation; $('rMax').value = r.duree_max; $('rSeed').value = r.graine;
    $('rEp').value = r.epoques; $('rLr').value = r.taux_apprentissage; $('rBatch').value = r.lot;
    if ($('rPpoSteps')) $('rPpoSteps').value = r.ppo_steps != null ? r.ppo_steps : 100000;
    if ($('rPpoBatch')) $('rPpoBatch').value = r.ppo_batch_size != null ? r.ppo_batch_size : 256;
    if ($('rPpoRollout')) $('rPpoRollout').value = r.ppo_rollout_len != null ? r.ppo_rollout_len : 32;
    if ($('rPpoLr')) $('rPpoLr').value = r.ppo_lr != null ? r.ppo_lr : 0.0003;
    if ($('rPpoCurriculum')) $('rPpoCurriculum').checked = r.curriculum_sokoban !== false;
    if ($('rPpoWorldModel')) $('rPpoWorldModel').checked = r.world_model !== false;
    if ($('rPpoMcts')) $('rPpoMcts').checked = !!r.mcts_eval;
    if ($('rPpoPretrain')) $('rPpoPretrain').checked = r.pretrain_imitation !== false;
    $('rPenE').value = cfg.recompense.penalite_erreur; $('rPenC').value = cfg.recompense.penalite_contact;
    $('rFinErr').checked = cfg.recompense.sur_erreur === 'fin';
    document.querySelectorAll('#meth button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.m === cfg.methode)); });
    document.querySelectorAll('#adv button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.i === cfg.adversaire.intensite)); });
    setMethode(cfg.methode, true);
    renderCatalog(); renderLayers(); refreshNet();
  }

  function renderCatalog() {
    var box = $('entrees'); box.innerHTML = '';
    ENV.GROUPS.forEach(function (g) {
      var on = cfg.entrees.indexOf(g.id) >= 0;
      var d = document.createElement('label'); d.className = 'chk';
      d.innerHTML = '<input type="checkbox" value="' + g.id + '"' + (on ? ' checked' : '') + '><span><b>' + esc(g.label) + '</b> · ' + g.vars[0].n + ' val.<small style="display:block;font-weight:400" class="muted">' + esc(g.vars[0].desc) + '</small></span>';
      d.querySelector('input').addEventListener('change', function () { readUi(); refreshNet(); updateDirty(); });
      box.appendChild(d);
    });
    var so = $('sorties'); so.innerHTML = '';
    ACTIONS.FAMILLES.forEach(function (f) {
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
    var p = par();
    $('nIn').textContent = nIn(); $('nOut').textContent = nOut(); $('nPar').textContent = p.total.toLocaleString('fr-FR');
    $('nHid').textContent = cfg.reseau.couches.length;
    $('parDetail').innerHTML = p.detail.map(function (d) { return esc(d.txt); }).join(' &nbsp;·&nbsp; ');
    if (p.total > NET.MAX_PARAMS) $('parDetail').innerHTML += ' <span class="bad">Plafond ' + NET.MAX_PARAMS.toLocaleString('fr-FR') + ' dépassé.</span>';
    $('code').textContent = NET.pytorchCode(slugify($('sName').value) || 'Cerveau', nIn(), cfg.reseau.couches, nOut(), cfg.architecture || (cfg.reseau && cfg.reseau.architecture));
    NET.draw($('netCv'), nIn(), cfg.reseau.couches, nOut());
  }

  $('bAddLayer').addEventListener('click', function () {
    if (cfg.reseau.couches.length >= NET.MAX_LAYERS) return toast('Plafond de ' + NET.MAX_LAYERS + ' couches.', 'bad');
    cfg.reseau.couches.push({ neurones: 64, activation: 'relu' }); renderLayers(); refreshNet(); updateDirty();
  });
  $('bDefNet').addEventListener('click', function () {
    cfg.reseau.couches = [{ neurones: 64, activation: 'relu' }, { neurones: 64, activation: 'relu' }]; renderLayers(); refreshNet(); updateDirty();
  });

  function applyBestNetConfig() {
    cfg.name = cfg.name || 'Cerveau-V2-Champion';
    // 1. Activer toutes les 37 entrées
    cfg.entrees = ENV.GROUPS.map(function (g) { return g.id; });
    // 2. Activer toutes les 106 actions
    cfg.actions = {
      familles: ACTIONS.FAMILLES.map(function (f) { return f.id; }),
      cotes: ['ext', 'int']
    };
    // 3. Architecture optimale du meilleur réseau (5 couches profondes, 66 090 paramètres)
    cfg.reseau = {
      couches: [
        { neurones: 256, activation: 'relu' },
        { neurones: 128, activation: 'relu' },
        { neurones: 64, activation: 'relu' },
        { neurones: 64, activation: 'relu' },
        { neurones: 64, activation: 'relu' }
      ],
      sortie: 'softmax'
    };
    // 4. Adversaire réaliste
    cfg.adversaire = { actif: true, intensite: 'realiste' };
    // 5. Méthode d'évolution optimisée
    cfg.methode = 'evolution';
    cfg.reglages = {
      population: 40,
      generations: 50,
      mutation: 0.08,
      scenarios_par_evaluation: 3,
      graine: 42,
      duree_max: 600,
      epoques: 100,
      taux_apprentissage: 0.003,
      lot: 64,
      mode: 'rapide',
      ppo_steps: 150000,
      ppo_batch_size: 256,
      ppo_rollout_len: 32,
      ppo_lr: 0.0003,
      curriculum_sokoban: true,
      world_model: true,
      mcts_eval: true,
      pretrain_imitation: true
    };
    cfg.architecture = 'mlp';
    // 6. Récompenses et sécurité Eurobot (pénalités pour 0 faute / 0 contact)
    cfg.recompense = {
      base: 'score',
      penalite_erreur: 20.0,
      penalite_contact: 20.0,
      sur_erreur: 'penalite'
    };
    cfg.graine = 42;

    writeUi();
    updateDirty();
    toast('Paramètres optimaux du meilleur réseau (V2 Champion · 66 090 params · 37 entrées / 106 sorties) appliqués !', 'ok');
  }
  var bBestNet = $('bBestNet');
  if (bBestNet) bBestNet.addEventListener('click', applyBestNetConfig);
  var bBestTop = $('bBestTop');
  if (bBestTop) bBestTop.addEventListener('click', applyBestNetConfig);
  $('pSeed').addEventListener('change', function () { cfg.graine = parseInt($('pSeed').value, 10) || 1; updateDirty(); });

  function setMethode(m, silent) {
    cfg.methode = m;
    document.querySelectorAll('#meth button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.m === m)); });
    $('reglEvo').hidden = m !== 'evolution';
    $('reglImi').hidden = m !== 'imitation';
    if ($('reglPpo')) $('reglPpo').hidden = m !== 'ppo';
    if (m === 'imitation') {
      $('methHelp').textContent = 'Le réseau apprend à reproduire les stratégies déjà enregistrées, rejouées pas à pas.';
    } else if (m === 'ppo') {
      $('methHelp').textContent = 'PPO Récurrent GPU : optimise un Actor-Critic GRU avec World-Model auxiliaire et Curriculum Sokoban vectorisé.';
    } else {
      $('methHelp').textContent = 'Une population joue des matchs ; on garde les meilleurs et on les mute.';
    }
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
  ['rPop', 'rGen', 'rMut', 'rScen', 'rMax', 'rSeed', 'rEp', 'rLr', 'rBatch', 'rPenE', 'rPenC', 'rFinErr',
   'rPpoSteps', 'rPpoBatch', 'rPpoRollout', 'rPpoLr', 'rPpoCurriculum', 'rPpoWorldModel', 'rPpoMcts', 'rPpoPretrain'].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener('change', function () { readUi(); updateDirty(); });
  });
  if ($('pArch')) $('pArch').addEventListener('change', function () { readUi(); refreshNet(); updateDirty(); });

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { var on = x === t; x.setAttribute('aria-selected', String(on)); $('pane-' + x.dataset.pane).hidden = !on; });
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
  function applyBrain(j) {
    cfg = Object.assign(defaultCfg(), j);
    cfg.architecture = j.architecture || (j.reseau && j.reseau.architecture) || 'mlp';
    cfg.reseau = j.reseau || cfg.reseau;
    cfg.reseau.architecture = cfg.architecture;
    cfg.actions = j.actions || cfg.actions;
    cfg.reglages = Object.assign(defaultCfg().reglages, j.reglages || {});
    cfg.recompense = Object.assign(defaultCfg().recompense, j.recompense || {});
    cfg.adversaire = Object.assign(defaultCfg().adversaire, j.adversaire || {});
    current = j.name; $('sName').value = j.name;
    writeUi(); markSaved(true);
    if (j.obsolète && j.obsolète.length) {
      toast('Ce cerveau a été entraîné avec un ' + j.obsolète.join(' et un ') + ' plus ancien. Réentraîne-le pour coller au règlement actuel.', 'bad');
    }
    weights = null;
    refreshPlayInfo();
    if (j.entraine) api('GET', API + '/cerveaux/' + slugify(j.name) + '/poids').then(function (w) { weights = w.layers || w; refreshPlayInfo(); }, function () { refreshPlayInfo(); });
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
    var pad = 28, ys = [];
    hist.forEach(function (p) {
      if (methode === 'imitation') ys.push(p.loss);
      else if (methode === 'ppo') { ys.push(p.best, p.mean, p.loss, p.aux_loss); }
      else { ys.push(p.best, p.mean, p.worst); }
    });
    var ymin = Math.min.apply(null, ys.filter(function (x) { return x != null; })), ymax = Math.max.apply(null, ys.filter(function (x) { return x != null; }));
    if (ymin === ymax) { ymin -= 1; ymax += 1; }
    function X(i) { return pad + (w - 2 * pad) * i / Math.max(hist.length - 1, 1); }
    function Y(v) { return h - pad - (h - 2 * pad) * (v - ymin) / (ymax - ymin); }
    ctx.strokeStyle = '#2a2d39'; ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, h - pad); ctx.lineTo(w - pad, h - pad); ctx.stroke();
    function series(key, color) {
      ctx.strokeStyle = color; ctx.beginPath();
      hist.forEach(function (p, i) { var v = p[key]; if (v == null) return; if (i === 0) ctx.moveTo(X(i), Y(v)); else ctx.lineTo(X(i), Y(v)); });
      ctx.stroke();
    }
    if (methode === 'imitation') series('loss', '#f5c518');
    else if (methode === 'ppo') {
      series('best', '#3ccf7a');
      series('mean', '#f5c518');
      series('aux_loss', '#8ab4ff');
    }
    else { series('best', '#3ccf7a'); series('mean', '#f5c518'); series('worst', '#ff6b6b'); }
  }
  function diagnose(hist, methode) {
    if (!hist || hist.length < 4) { $('tDiag').textContent = ''; return; }
    if (methode === 'imitation') {
      var a = hist[hist.length - 4].loss, b = hist[hist.length - 1].loss;
      if (b > a * 1.05) $('tDiag').textContent = 'La perte remonte : possible surapprentissage.';
      else if (Math.abs(b - a) / Math.max(a, 1e-6) < 0.02) $('tDiag').textContent = 'La perte ne baisse plus beaucoup.';
      else $('tDiag').textContent = '';
      return;
    }
    if (methode === 'ppo') {
      var lastPpo = hist[hist.length - 1];
      if (lastPpo) $('tDiag').innerHTML = '<span style="color:#3ccf7a">● Record: ' + (lastPpo.best != null ? lastPpo.best : 0) + ' pts</span> &nbsp; <span style="color:#f5c518">● Moyen: ' + (lastPpo.mean != null ? lastPpo.mean : 0) + ' pts</span> &nbsp; <span style="color:#8ab4ff">● World-Model aux: ' + (lastPpo.aux_loss != null ? lastPpo.aux_loss : '—') + '</span>';
      return;
    }
    var bests = hist.map(function (p) { return p.best; });
    var last = bests.slice(-4);
    if (last.every(function (v) { return v === last[0]; })) $('tDiag').textContent = 'Le score ne progresse plus.';
    else $('tDiag').textContent = '';
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
    } else {
      $('tProg').textContent = j.status === 'queued' ? 'file' : '—';
    }
    $('tEta').textContent = p.eta_s != null ? Math.round(p.eta_s) + ' s' : '—';
    $('tMps').textContent = p.matches_per_s != null ? p.matches_per_s : '—';
    if (p.device) $('tDev').textContent = (p.name || p.device) + (p.vram_mo ? ' · ' + p.vram_mo + ' Mo' : '');
    drawChart(p.history, m); diagnose(p.history, m);
    setJobBtns(j.status);
    if (j.status === 'done') {
      toast('Entraînement terminé' + (j.best_score ? ' · meilleur score ' + Math.round(j.best_score) : ''), 'ok');
      api('GET', API + '/cerveaux/' + slugify(j.slug || current) + '/poids').then(function (w) { weights = w.layers || w; }, function () {});
    }
    if (j.status === 'error') toast(j.error || 'Erreur d\'entraînement', 'bad');
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
    api('POST', API + '/trainings/' + jobId + '/stop').then(function () { toast('Arrêt demandé.'); poll(); }, function (e) { toast(e.message, 'bad'); });
  });

  api('GET', API + '/trainer').then(function (j) {
    $('tDev').textContent = (j.name || j.device) + (j.cuda ? ' (CUDA)' : ' (CPU)');
  }, function () { $('tDev').textContent = 'injoignable'; });

  /* ---------- évaluation / rejouer ---------- */
  function makeEnv() {
    readUi();
    return ENV.create({
      entrees: cfg.entrees, familles: cfg.actions.familles,
      adversaire: cfg.adversaire, skipContacts: true,
      onError: cfg.recompense.sur_erreur
    });
  }
  function layersFor() {
    if (weights) return weights;
    return NET.randomWeights(nIn(), cfg.reseau.couches, nOut(), cfg.graine || 1);
  }
  function acts() { return cfg.reseau.couches.map(function (c) { return c.activation; }); }
  function runPolicy(env, layers, scenario) {
    env.play(function (obs, mask) { return NET.choose(NET.forward(layers, obs, acts()), mask); }, scenario || {});
    var R = env.result();
    var sc = SCORE.scoreAt(R, R.params, Math.min(R.T, ENV.MATCH));
    return { score: sc.total, detail: sc.detail, errors: R.errors.length, T: R.T, program: env.program() };
  }
  function runRandom(env, scenario) {
    env.play(function (obs, mask) {
      var valid = []; mask.forEach(function (v, i) { if (v) valid.push(i); });
      return valid[Math.floor(Math.random() * valid.length)] || 0;
    }, scenario || {});
    var R = env.result();
    var sc = SCORE.scoreAt(R, R.params, Math.min(R.T, ENV.MATCH));
    return { score: sc.total, detail: sc.detail, errors: R.errors.length, T: R.T };
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
    return '<tr><td>' + esc(name) + '</td><td class="num">' + n(s.mean) + '</td><td class="num">' + n(s.std) + '</td><td class="num">' + n(s.min) + '</td><td class="num">' + n(s.max) + '</td>' +
      ['pierres', 'murs', 'tours', 'porte', 'graal', 'roi', 'boulets', 'errors'].map(function (k) { return '<td class="num">' + n(d[k]) + '</td>'; }).join('') + '</tr>';
  }
  $('bEval').addEventListener('click', function () {
    $('eStatus').textContent = 'Évaluation en cours…';
    var n = Math.max(1, Math.min(20, parseInt($('eN').value, 10) || 5));
    setTimeout(function () {
      try {
        var env = makeEnv(), L = layersFor();
        var model = [], rnd = [], scr = [];
        for (var i = 0; i < n; i++) {
          var scn = { seed: 1000 + i, intensite: cfg.adversaire.intensite, opponent: ENV.pickOpponent(oppPool, 1000 + i, cfg.adversaire.intensite) };
          model.push(runPolicy(env, L, scn));
          rnd.push(runRandom(env, scn));
          scr.push(runScripted(env, ENV.EXAMPLE, { seed: 1000 + i, intensite: 'aucun' }));
        }
        $('eTable').tBodies[0].innerHTML = rowHtml('Ce cerveau' + (weights ? '' : ' (poids aléatoires)'), model) + rowHtml('Aléatoire (actions valides)', rnd) + rowHtml('Stratégie d\'exemple', scr);
        $('eStatus').textContent = n + ' scénarios · graines 1000 à ' + (1000 + n - 1) + '.';
      } catch (e) { $('eStatus').textContent = 'Erreur : ' + e.message; }
    }, 40);
  });

  function refreshPlayInfo() {
    var name = $('sName').value.trim() || current;
    var box = $('rCurrent');
    if (box) {
      box.innerHTML = name
        ? '<b>' + esc(name) + '</b> — ' + (weights ? 'poids chargés, il jouera en direct.' : 'pas encore de poids entraînés : le plateau tirera au sort parmi les actions valides.')
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
