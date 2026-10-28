# Format du modèle récurrent (export ONNX, meta, JSON web)

Ce document décrit ce que produit `trainer/export_onnx.py` (contrat §5 de `docs/CONTRATS.md`) et comment l'exécuter. Il concerne l'embarqué (Pi 5, ONNX) et le web (JSON).

Pour une base `<B>` (par exemple `.data/modeles/fumee`), l'export écrit :

| Fichier | Contenu | Consommateur |
|---|---|---|
| `<B>.onnx` | Graphe de la politique (opset ≥ 17, un seul fichier) | Pi 5 (onnxruntime) |
| `<B>.meta.json` | Dimensions, versions, normalisation, catalogue, évaluation | Pi 5, outils |
| `<B>.json` | Poids pour le runtime web (`icamlot-modele-recurrent`) | `cerveau/`, `plateau/` |
| `<B>.pt` | Point de sauvegarde PyTorch (`icamlot-checkpoint`) | Entraîneur (reprise, évaluation, ré-export) |

## 1. Calcul du réseau

```
obs_n  = clip((obs - mean) / std, -clip, +clip)                    normalisation (incluse)
x      = act(LayerNorm(obs_n · W_e + b_e))                         encodeur, une couche par entrée de « encodeur »
h'     = GRUCell(x, h)                                             mémoire (H = hidden)
logits = act(… act(h' · W_a1 + b_a1) …) · W_aK + b_aK              tête acteur (pas d'activation après la dernière couche)
```

- `act` vaut `silu` par défaut (`x · sigmoid(x)`). `relu` et `tanh` sont aussi possibles. Le champ `activation` donne la valeur utilisée.
- LayerNorm : `(x - moyenne(x)) / sqrt(variance(x) + eps) · gamma + beta`, sur la dernière dimension, avec une variance biaisée (division par n).
- GRUCell, avec la convention PyTorch et les portes dans l'ordre r, z, n :
  ```
  gi = x · W_ih + b_ih        gh = h · W_hh + b_hh        (taille 3H, découpées en [r | z | n])
  r  = sigmoid(gi_r + gh_r)   z = sigmoid(gi_z + gh_z)    n = tanh(gi_n + r ⊙ gh_n)
  h' = (1 - z) ⊙ n + z ⊙ h
  ```
- **Masque** : il n'est pas dans le graphe. Avant le choix, mettre à −∞ (ou −1e9) les logits des actions dont le masque de l'environnement vaut 0. Le choix glouton est l'argmax des logits masqués.
- **État caché** : des zéros `(B, H)` au début de chaque match. On réinjecte `next_hidden` à chaque décision, une fois par décision.
- Les logits sont indexés dans l'ordre du catalogue de l'environnement (`ENV.create(cfg).catalogue`, recopié dans `meta.catalogue`).

## 2. ONNX (`<B>.onnx`)

| Nom | Forme | Type |
|---|---|---|
| entrée `obs` | (B, n_in) | float32, **observation brute** (la normalisation est dans le graphe) |
| entrée `hidden` | (B, H) | float32 |
| sortie `logits` | (B, n_out) | float32, **non masqués** |
| sortie `next_hidden` | (B, H) | float32 |

B est dynamique. Le fichier est autonome : il n'y a pas de `.onnx.data`. À chaque export, ONNX Runtime est comparé à PyTorch sur 5 pas récurrents enchaînés. L'écart maximal toléré est 1e-4. Le résultat est écrit dans `meta.verification_onnx`.

## 3. Meta (`<B>.meta.json`)

```jsonc
{
  "format": "icamlot-modele-meta", "version": 1,
  "n_in": 56, "n_out": 130, "hidden": 128,            // exemple : valeurs lues dans l'environnement au moment de l'entraînement
  "obs_version": "empreinte:0674f241f0ab4e76",
  "catalogue_version": "empreinte:229f666a3de8854e",
  "onnx": { "opset": 17, "entrees": {...}, "sorties": {...}, "type": "float32" },
  "normalisation": { "integree_au_graphe": true, "formule": "obs_n = clip((obs - mean) / std, -clip, +clip)",
                     "clip": 5.0, "mean": [...n_in], "std": [...n_in] },
  "masque": "non intégré : …", "etat_cache": "zéros (B, hidden) au début de chaque match …",
  "architecture": { "n_in", "n_out", "hidden", "encodeur": [128], "acteur": [], "critique": [128],
                    "activation": "silu", "layernorm": true, "clip_obs": 5.0 },
  "groupes": ["temps", "robot", …],                   // groupes d'observation, dans l'ordre
  "catalogue": [{ "i": 0, "famille": "prendre", "a": "prendre", "f": "A", "p": "P1", "label": "…" }, …],
  "moteur": "1.3.0", "bareme": "2027-1.0",
  "evaluation": { … rapport de trainer/evaluation.py … },
  "verification_onnx": { "ecart_max": 3.6e-07, "ok": true, … }
}
```

**Versions.** `obs_version` vaut `ENV.OBS_VERSION` et `catalogue_version` vaut `ACTIONS.CATALOGUE_VERSION` quand le moteur les définit. Sinon, ce sont des empreintes calculées par `engine/env_worker.js` :
- `obs_version` = `"empreinte:" + sha256(JSON.stringify([{id, n, desc} des groupes d'observation, dans l'ordre]))[:16]` ;
- `catalogue_version` = `"empreinte:" + sha256(JSON.stringify(catalogue))[:16]`.

Un runtime doit refuser un modèle dont les versions ne correspondent pas à son observation et à son catalogue.

## 4. JSON web (`<B>.json`)

```jsonc
{
  "format": "icamlot-modele-recurrent", "version": 1,
  "n_in": 56, "n_out": 130, "hidden": 128, "activation": "silu",
  "obs_version": "…", "catalogue_version": "…", "groupes": [...], "moteur": "…", "bareme": "…",
  "normalisation": { "mean": [n_in], "std": [n_in], "clip": 5.0 },
  "encodeur": [ { "w": [n_in][E], "b": [E], "ln": { "gamma": [E], "beta": [E], "eps": 1e-5 } } ],
  "gru":      { "w_ih": [E][3H], "w_hh": [H][3H], "b_ih": [3H], "b_hh": [3H] },
  "acteur":   [ { "w": [H][n_out], "b": [n_out] } ]
}
```

- Toutes les matrices `w` sont rangées **[entrée][sortie]**, avec un produit `y_j = b_j + Σ_k x_k · w[k][j]`. C'est la même convention que `camelot-poids` (`layers`) et que `NET.forward` dans `cerveau/net.js`.
- `ln` est absent si `layernorm` est désactivé. Il y a une activation après chaque couche de l'encodeur, et entre les couches de l'acteur, mais pas après la dernière.
- La critique n'est pas exportée, car elle n'est pas utile pour jouer.
- L'implémentation de référence est `web_forward` dans `trainer/export_onnx.py` (NumPy). Les tests vérifient qu'elle reproduit PyTorch à 1e-4 près.

### Fichier de poids servi par l'API (`GET /api/cerveaux/<slug>/poids`)

- Évolution (MLP) : `{ "format": "camelot-poids", "version": 1, "layers": [...], "obs_version", "catalogue_version" }`. Ce format est inchangé, avec en plus les versions.
- Imitation et PPO (réseau récurrent) :
  ```jsonc
  { "format": "camelot-poids", "version": 2, "architecture": "recurrent",
    "modele": { …JSON web ci-dessus… },
    "fichiers": { "pt", "onnx", "meta", "web" },   // chemins côté serveur (<données>/weights/<slug>.modele.*)
    "evaluation": { … } }
  ```
  Il n'y a **pas** de champ `layers` : le runtime web doit lire `modele`.
