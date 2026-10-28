/* Réseau : comptage, dessin, code PyTorch, inférence (mêmes poids que l'entraîneur NumPy). */
(function (root) {
  var MAX_LAYERS = 8, MAX_NEURONS = 256, MAX_PARAMS = 250000;
  function sizes(nIn, couches, nOut) {
    return [nIn].concat(couches.map(function (c) { return c.neurones; })).concat([nOut]);
  }
  function countParams(nIn, couches, nOut) {
    var s = sizes(nIn, couches, nOut), n = 0, detail = [];
    for (var i = 0; i < s.length - 1; i++) {
      var p = s[i] * s[i + 1] + s[i + 1];
      detail.push({ from: s[i], to: s[i + 1], n: p, txt: s[i] + '×' + s[i + 1] + '+' + s[i + 1] + ' = ' + p });
      n += p;
    }
    return { total: n, detail: detail, sizes: s };
  }
  function actName(a) { return a === 'tanh' ? 'Tanh' : a === 'sigmoid' ? 'Sigmoid' : 'ReLU'; }
  /* Valeurs par défaut du réseau récurrent : miroir de api/server.py (REC_*) et de trainer/models.py (RecurrentActorCritic). */
  var REC = { HIDDEN: 128, ENCODEUR: 128, CRITIQUE: 128, MIN_HIDDEN: 8, MAX_HIDDEN: 512 };
  function countParamsRecurrent(nIn, nOut, hidden, enc, crit) {
    hidden = hidden || REC.HIDDEN; enc = enc || REC.ENCODEUR; crit = crit || REC.CRITIQUE;
    var encoder = nIn * enc + enc + 2 * enc;
    var gru = 3 * hidden * (enc + hidden) + 6 * hidden;
    var actor = hidden * nOut + nOut;
    var critic = hidden * crit + crit + crit + 1;
    var detail = [
      { n: encoder, txt: 'encodeur ' + nIn + '→' + enc + ' + LayerNorm = ' + encoder },
      { n: gru, txt: 'GRU ' + enc + '→' + hidden + ' = ' + gru },
      { n: actor, txt: 'acteur ' + hidden + '→' + nOut + ' = ' + actor },
      { n: critic, txt: 'critique ' + hidden + '→' + crit + '→1 = ' + critic + ' (entraînement seulement)' }
    ];
    return { total: encoder + gru + actor + critic, detail: detail, sizes: [nIn, enc, hidden, nOut] };
  }
  function pytorchCode(name, nIn, couches, nOut, arch, hidden) {
    var cls = (name || 'Cerveau').replace(/[^A-Za-z0-9_]/g, '_');
    if (arch === 'recurrent') {
      return [
        'import torch',
        'import torch.nn as nn',
        'from trainer.models import RecurrentActorCritic',
        '',
        '# Réseau récurrent : encodeur + GRU + tête acteur (une seule politique), tête critique pour le PPO.',
        'class ' + cls + '(nn.Module):',
        '    def __init__(self):',
        '        super().__init__()',
        '        self.model = RecurrentActorCritic(n_in=' + nIn + ', n_out=' + nOut + ', hidden=' + (hidden || REC.HIDDEN) + ')',
        '',
        '    def forward(self, obs, hidden=None):',
        '        if hidden is None:',
        '            hidden = torch.zeros(obs.shape[0], self.model.hidden_dim)  # remis à zéro au début de chaque match',
        '        h = self.model.core(obs, hidden)',
        '        return self.model.actor(h), h  # logits non masqués, état caché suivant',
        '',
        '# Le masque d\'actions est appliqué à l\'exécution (-inf sur les actions impossibles).'
      ].join('\n');
    }
    var lines = [
      'import torch',
      'import torch.nn as nn',
      '',
      'class ' + (name || 'Cerveau').replace(/[^A-Za-z0-9_]/g, '_') + '(nn.Module):',
      '    def __init__(self):',
      '        super().__init__()',
      '        self.net = nn.Sequential('
    ];
    var s = sizes(nIn, couches, nOut);
    for (var i = 0; i < s.length - 1; i++) {
      lines.push('            nn.Linear(' + s[i] + ', ' + s[i + 1] + '),');
      if (i < s.length - 2) lines.push('            nn.' + actName(couches[i].activation) + '(),');
    }
    lines.push('        )');
    lines.push('');
    lines.push('    def forward(self, x):');
    lines.push('        return self.net(x)  # logits ; softmax au moment du choix');
    lines.push('');
    lines.push('# Entraînement à partir de la configuration, pas de ce code.');
    return lines.join('\n');
  }
  function act(name, h) {
    if (name === 'tanh') return Math.tanh(h);
    if (name === 'sigmoid') return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, h))));
    return h > 0 ? h : 0;
  }
  function forward(layers, x, acts) {
    var h = x.slice();
    for (var i = 0; i < layers.length; i++) {
      var w = layers[i].w, b = layers[i].b, next = [];
      for (var j = 0; j < b.length; j++) {
        var s = b[j];
        for (var k = 0; k < h.length; k++) s += h[k] * w[k][j];
        next[j] = (i < layers.length - 1) ? act(acts[i] || 'relu', s) : s;
      }
      h = next;
    }
    return h;
  }
  function choose(logits, mask) {
    var best = -1, bestv = -1e99;
    for (var i = 0; i < logits.length; i++) {
      if (!mask[i]) continue;
      if (logits[i] > bestv) { bestv = logits[i]; best = i; }
    }
    if (best < 0) { for (i = 0; i < mask.length; i++) if (mask[i]) return i; }
    return best;
  }
  function randomWeights(nIn, couches, nOut, seed) {
    var a = (seed >>> 0) || 1;
    function rnd() { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
    function gauss() { var u = Math.max(rnd(), 1e-9), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
    var s = sizes(nIn, couches, nOut), layers = [];
    for (var i = 0; i < s.length - 1; i++) {
      var w = [], scale = Math.sqrt(2 / s[i]);
      for (var r = 0; r < s[i]; r++) { w[r] = []; for (var c = 0; c < s[i + 1]; c++) w[r][c] = gauss() * scale; }
      layers.push({ w: w, b: new Array(s[i + 1]).fill(0) });
    }
    return layers;
  }
  function draw(canvas, nIn, couches, nOut) {
    var ctx = canvas.getContext('2d'), dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth || 480, h = canvas.clientHeight || 280;
    canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var s = sizes(nIn, couches, nOut);
    var padX = 36, padY = 22, colW = (w - 2 * padX) / Math.max(s.length - 1, 1);
    function ny(n, i) { var top = padY, bot = h - padY; if (n <= 1) return (top + bot) / 2; return top + (bot - top) * i / (n - 1); }
    function nx(i) { return padX + colW * i; }
    function shown(n) { return Math.min(n, 12); }
    ctx.lineWidth = 0.6;
    for (var i = 0; i < s.length - 1; i++) {
      var a = shown(s[i]), b = shown(s[i + 1]);
      ctx.strokeStyle = 'rgba(245,197,24,0.12)';
      for (var p = 0; p < a; p++) for (var q = 0; q < b; q++) {
        ctx.beginPath(); ctx.moveTo(nx(i), ny(a, p)); ctx.lineTo(nx(i + 1), ny(b, q)); ctx.stroke();
      }
    }
    s.forEach(function (n, i) {
      var vis = shown(n), x = nx(i);
      for (var k = 0; k < vis; k++) {
        ctx.beginPath(); ctx.arc(x, ny(vis, k), i === 0 || i === s.length - 1 ? 5 : 7, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#8ab4ff' : i === s.length - 1 ? '#f5c518' : '#3ccf7a';
        ctx.fill();
      }
      ctx.fillStyle = '#a9adba'; ctx.font = '11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
      var lab = i === 0 ? 'entrées' : i === s.length - 1 ? 'softmax' : (couches[i - 1].activation || 'relu');
      ctx.fillText(n + ' · ' + lab, x, h - 6);
    });
  }
  root.NET = {
    MAX_LAYERS: MAX_LAYERS, MAX_NEURONS: MAX_NEURONS, MAX_PARAMS: MAX_PARAMS,
    sizes: sizes, countParams: countParams, pytorchCode: pytorchCode,
    forward: forward, choose: choose, randomWeights: randomWeights, draw: draw,
    REC: REC, countParamsRecurrent: countParamsRecurrent
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
