/* Runtime du modèle récurrent (format `icamlot-modele-recurrent`, voir trainer/FORMAT_MODELE.md).
   Implémentation de référence : web_forward dans trainer/export_onnx.py.
   Aucune dimension, aucun catalogue ni aucune activation n'est codé en dur : tout est lu dans le JSON du modèle. */
(function (root) {
  var ACTIVATIONS = {
    silu: function (x) { return x / (1 + Math.exp(-x)); },
    relu: function (x) { return x > 0 ? x : 0; },
    tanh: Math.tanh
  };
  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

  // y_j = b_j + sum_k x_k * w[k][j]   (w rangé [entrée][sortie])
  function linear(x, w, b) {
    var n = b.length, y = new Float64Array(n), k, j, xk, row;
    for (j = 0; j < n; j++) y[j] = b[j];
    for (k = 0; k < x.length; k++) {
      xk = x[k]; row = w[k];
      for (j = 0; j < n; j++) y[j] += xk * row[j];
    }
    return y;
  }
  function layerNorm(x, ln) {
    var n = x.length, mu = 0, v = 0, i, d, inv;
    for (i = 0; i < n; i++) mu += x[i];
    mu /= n;
    for (i = 0; i < n; i++) { d = x[i] - mu; v += d * d; }
    inv = 1 / Math.sqrt(v / n + ln.eps);
    var y = new Float64Array(n);
    for (i = 0; i < n; i++) y[i] = (x[i] - mu) * inv * ln.gamma[i] + ln.beta[i];
    return y;
  }

  /** Message d'erreur si le modèle n'est pas exploitable avec cette observation et ce catalogue, sinon null.
      attendu : { nIn, nOut, obsVersion, catalogueVersion } (champs facultatifs). */
  function validate(model, attendu) {
    if (!model || model.format !== 'icamlot-modele-recurrent') return 'Format de modèle inconnu (attendu : icamlot-modele-recurrent).';
    if (model.version !== 1) return 'Version du format non gérée : ' + model.version + '.';
    if (!ACTIVATIONS[model.activation]) return 'Activation inconnue : ' + model.activation + '.';
    attendu = attendu || {};
    if (attendu.nIn != null && attendu.nIn !== model.n_in) return 'Le modèle attend ' + model.n_in + ' entrées, l\'environnement en fournit ' + attendu.nIn + '.';
    if (attendu.nOut != null && attendu.nOut !== model.n_out) return 'Le modèle produit ' + model.n_out + ' sorties, le catalogue en compte ' + attendu.nOut + '.';
    if (attendu.obsVersion && model.obs_version && attendu.obsVersion !== model.obs_version) return 'Version d\'observation différente (modèle ' + model.obs_version + ', environnement ' + attendu.obsVersion + ').';
    if (attendu.catalogueVersion && model.catalogue_version && attendu.catalogueVersion !== model.catalogue_version) return 'Version de catalogue différente (modèle ' + model.catalogue_version + ', environnement ' + attendu.catalogueVersion + ').';
    return null;
  }

  function zeros(model) { return new Float64Array(model.hidden); }

  /** Une décision : renvoie { logits (non masqués), hidden (état suivant) }. */
  function forward(model, obs, hidden) {
    var act = ACTIVATIONS[model.activation], nm = model.normalisation, H = model.hidden;
    var x = new Float64Array(obs.length), i, L;
    for (i = 0; i < obs.length; i++) {
      var v = (obs[i] - nm.mean[i]) / nm.std[i];
      x[i] = Math.max(-nm.clip, Math.min(nm.clip, v));
    }
    for (var e = 0; e < model.encodeur.length; e++) {
      L = model.encodeur[e];
      x = linear(x, L.w, L.b);
      if (L.ln) x = layerNorm(x, L.ln);
      for (i = 0; i < x.length; i++) x[i] = act(x[i]);
    }
    var g = model.gru, gi = linear(x, g.w_ih, g.b_ih), gh = linear(hidden, g.w_hh, g.b_hh);
    var h = new Float64Array(H);
    for (i = 0; i < H; i++) {
      var r = sigmoid(gi[i] + gh[i]);
      var z = sigmoid(gi[H + i] + gh[H + i]);
      var n = Math.tanh(gi[2 * H + i] + r * gh[2 * H + i]);
      h[i] = (1 - z) * n + z * hidden[i];
    }
    var y = h;
    for (var k = 0; k < model.acteur.length; k++) {
      L = model.acteur[k];
      y = linear(y, L.w, L.b);
      if (k < model.acteur.length - 1) for (i = 0; i < y.length; i++) y[i] = act(y[i]);
    }
    return { logits: y, hidden: h };
  }

  /** Argmax des logits dont le masque vaut 1 (équivalent à -inf sur les autres). -1 si aucune action n'est permise. */
  function choisir(logits, mask) {
    var best = -1, bv = -Infinity;
    for (var i = 0; i < logits.length; i++) {
      if (mask && !mask[i]) continue;
      if (logits[i] > bv) { bv = logits[i]; best = i; }
    }
    return best;
  }

  function memeObs(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** Agent glouton : function(obs, mask) -> index. À créer (ou `reset()`) au début de chaque match :
      l'état caché repart de zéro et n'avance qu'une fois par décision. Si l'environnement rappelle l'agent
      avec la même observation (filtre de sécurité qui masque l'action choisie puis redemande), les logits
      sont réutilisés sans avancer l'état caché. */
  function chooser(model, attendu) {
    var err = validate(model, attendu);
    if (err) throw new Error(err);
    var hidden = zeros(model), lastObs = null;
    function choose(obs, mask) {
      if (!(lastObs && choose.lastLogits && memeObs(obs, lastObs))) {
        var r = forward(model, obs, hidden);
        hidden = r.hidden;
        choose.lastLogits = r.logits;
        lastObs = Array.prototype.slice.call(obs);
      }
      return choisir(choose.lastLogits, mask);
    }
    choose.reset = function () { hidden = zeros(model); lastObs = null; choose.lastLogits = null; };
    choose.hidden = function () { return hidden; };
    choose.lastLogits = null;
    return choose;
  }

  /** Extrait le modèle récurrent d'un fichier de poids de l'API (camelot-poids v2) ou d'un JSON web brut ; null sinon. */
  function modeleDe(poids) {
    if (!poids) return null;
    if (poids.format === 'icamlot-modele-recurrent') return poids;
    if (poids.format === 'camelot-poids' && poids.architecture === 'recurrent' && poids.modele) return poids.modele;
    return null;
  }

  root.RUNTIME = { validate: validate, forward: forward, choisir: choisir, chooser: chooser, zeros: zeros, modeleDe: modeleDe, ACTIVATIONS: Object.keys(ACTIVATIONS) };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.RUNTIME;
})(typeof globalThis !== 'undefined' ? globalThis : this);
