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
  function pytorchCode(name, nIn, couches, nOut) {
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
  function silu(x) {
    return x / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
  }
  function sigmoid(x) {
    return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
  }
  function layerNorm(x, gamma, beta, eps) {
    eps = eps || 1e-5;
    var n = x.length, sum = 0;
    for (var i = 0; i < n; i++) sum += x[i];
    var mean = sum / n, varSum = 0;
    for (var i = 0; i < n; i++) { var diff = x[i] - mean; varSum += diff * diff; }
    var invStd = 1 / Math.sqrt(varSum / n + eps);
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      out[i] = (x[i] - mean) * invStd * (gamma ? gamma[i] : 1) + (beta ? beta[i] : 0);
    }
    return out;
  }
  function linear(x, w, b, actFn) {
    var outDim = b ? b.length : (w[0] ? w[0].length : 0);
    var inDim = x.length;
    var out = new Float32Array(outDim);
    var wIsTransposed = (w.length === outDim);
    for (var j = 0; j < outDim; j++) {
      var s = b ? b[j] : 0;
      if (wIsTransposed) {
        var row = w[j];
        for (var k = 0; k < inDim; k++) s += x[k] * row[k];
      } else {
        for (var k = 0; k < inDim; k++) s += x[k] * w[k][j];
      }
      out[j] = actFn ? actFn(s) : s;
    }
    return out;
  }
  function gruCell(x, h, W_ih, W_hh, b_ih, b_hh) {
    var hiddenDim = h.length;
    var gi = linear(x, W_ih, b_ih);
    var gh = linear(h, W_hh, b_hh);
    var next_h = new Float32Array(hiddenDim);
    for (var i = 0; i < hiddenDim; i++) {
      var r = sigmoid(gi[i] + gh[i]);
      var z = sigmoid(gi[hiddenDim + i] + gh[hiddenDim + i]);
      var n = Math.tanh(gi[2 * hiddenDim + i] + r * gh[2 * hiddenDim + i]);
      next_h[i] = (1 - z) * n + z * h[i];
    }
    return next_h;
  }
  function forwardFactorizedGRU(model, obs, hidden) {
    var enc = model.encoder || {};
    var geo = [obs[1], obs[2], obs[3], obs[4], obs[35] || 0, obs[36] || 0];
    var g_feat = linear(geo, enc.geo_w, enc.geo_b, silu);

    var table = [];
    for (var i = 5; i < 15; i++) table.push(obs[i] || 0);
    for (var i = 21; i < 34; i++) table.push(obs[i] || 0);
    var t_feat = linear(table, enc.table_w, enc.table_b, silu);

    var mech = [obs[0] || 0];
    for (var i = 15; i < 21; i++) mech.push(obs[i] || 0);
    mech.push(obs[34] || 0);
    var m_feat = linear(mech, enc.mech_w, enc.mech_b, silu);

    var concat = new Float32Array(g_feat.length + t_feat.length + m_feat.length);
    concat.set(g_feat, 0);
    concat.set(t_feat, g_feat.length);
    concat.set(m_feat, g_feat.length + t_feat.length);

    var fused_lin = linear(concat, enc.fusion_w, enc.fusion_b);
    var feat = layerNorm(fused_lin, enc.ln_gamma, enc.ln_beta);
    for (var i = 0; i < feat.length; i++) feat[i] = silu(feat[i]);

    var h_prev = hidden || new Float32Array(model.hidden_dim || 128);
    var next_h = model.gru ? gruCell(feat, h_prev, model.gru.w_ih, model.gru.w_hh, model.gru.b_ih, model.gru.b_hh) : feat;

    var actHead = model.actor || {};
    var h_dense = linear(next_h, actHead.dense_w, actHead.dense_b, silu);
    var h_res = new Float32Array(next_h.length);
    for (var i = 0; i < next_h.length; i++) h_res[i] = next_h[i] + h_dense[i];
    var logits = linear(h_res, actHead.out_w, actHead.out_b);

    return { logits: logits, hidden: next_h };
  }
  function chooserFromRecurrent(model) {
    var hidden = new Float32Array(model.hidden_dim || 128);
    return function (obs, mask) {
      var res = forwardFactorizedGRU(model, obs, hidden);
      hidden = res.hidden;
      return choose(res.logits, mask);
    };
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
    silu: silu, sigmoid: sigmoid, layerNorm: layerNorm, linear: linear, gruCell: gruCell,
    forwardFactorizedGRU: forwardFactorizedGRU, chooserFromRecurrent: chooserFromRecurrent
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
