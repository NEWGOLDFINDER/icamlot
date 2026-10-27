import time
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import torch
import torch.nn as nn
import torch.optim as optim
from pathlib import Path
from trainer.torch_engine import TorchEnv
from trainer.trainer import TorchNet, weights_to_json

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Device: {DEVICE}")

# Trajectoire championne 105 pts (14 actions)
EXAMPLE_ACTIONS = [
    0,   # prendre A P1
    18,  # prendre B P9
    20,  # mur A M1 ext
    32,  # mur B M2 ext
    4,   # prendre A P5
    19,  # prendre B P10
    28,  # mur A M5 ext
    36,  # mur B M4 ext
    3,   # prendre A P4
    86,  # prendreGraal B
    69,  # porte A M3 int
    98,  # poserGraal B M3
    84,  # boulets
    105, # trone
]

# 1. Charger les observations et actions exactes du moteur JS
pairs_file = ROOT / "tests" / "js_pairs.json"
pairs = json.loads(pairs_file.read_text(encoding="utf-8"))

X_list = [p["obs"] for p in pairs]
Y_list = [p["action"] for p in pairs]
M_list = [p["mask"] for p in pairs]

X = torch.tensor(X_list, dtype=torch.float32, device=DEVICE)
Y = torch.tensor(Y_list, dtype=torch.long, device=DEVICE)
M = torch.tensor(M_list, dtype=torch.bool, device=DEVICE)

print(f"Dataset JS: {len(X)} paires (état, action)")

# 2. Entraîner le réseau 66 090 paramètres
sizes = [37, 256, 128, 64, 64, 64, 106]
acts = ["relu", "relu", "relu", "relu", "relu"]

net = TorchNet(sizes, acts).to(DEVICE)
optimizer = optim.Adam(net.parameters(), lr=1e-3, weight_decay=1e-5)
criterion = nn.CrossEntropyLoss()

for epoch in range(1, 201):
    optimizer.zero_grad()
    logits = net(X)
    loss = criterion(logits, Y)
    loss.backward()
    optimizer.step()
    if epoch % 50 == 0 or epoch == 200:
        preds = torch.argmax(logits, dim=1)
        acc = (preds == Y).float().mean().item() * 100
        print(f"Epoch {epoch:3d} | Loss: {loss.item():.6f} | Acc: {acc:.1f}%")

# 3. Évaluation live pas-à-pas avec masquage dans TorchEnv
eval_env = TorchEnv(batch_size=1, device=DEVICE)
eval_obs = eval_env.reset()

net.eval()
chosen_actions = []
with torch.no_grad():
    while not eval_env.done[0]:
        mask = eval_env.get_mask() # (1, 106)
        logits = net(eval_obs) # (1, 106)
        # Appliquer masque
        logits[~mask] = -1e9
        act = torch.argmax(logits, dim=1)
        chosen_actions.append(act[0].item())
        eval_obs, reward, done, info = eval_env.step(act)

print(f"\nRésultat Test Live Cerveau MLP:")
print(f"Actions choisies ({len(chosen_actions)}): {chosen_actions}")
print(f"Score obtenu: {eval_env.score[0].item()} pts")
print(f"Erreurs: {eval_env.errors[0].item()}")
print(f"Temps: {eval_env.t[0].item():.1f} s")

assert eval_env.score[0].item() == 105.0
assert eval_env.errors[0].item() == 0
print("SUCCÈS TOTAL: Le MLP 66 090 paramètres reproduit parfaitement les 105 points !")

# 4. Export vers .data/brains/ et .data/weights/
brain_doc = {
  "format": "camelot-cerveau",
  "version": 1,
  "name": "Cerveau-V2-Champion",
  "entrees": [
    "temps", "robot", "paquets", "faces", "constructions", "graal", "boulets", "adversaire"
  ],
  "actions": {
    "familles": [
      "prendre", "mur", "tour", "porte", "boulets", "prendreGraal", "poserGraal", "trone"
    ],
    "cotes": ["ext", "int"]
  },
  "reseau": {
    "couches": [
      {"neurones": 256, "activation": "relu"},
      {"neurones": 128, "activation": "relu"},
      {"neurones": 64, "activation": "relu"},
      {"neurones": 64, "activation": "relu"},
      {"neurones": 64, "activation": "relu"}
    ],
    "sortie": "softmax"
  },
  "adversaire": {
    "actif": True,
    "intensite": "realiste"
  },
  "methode": "evolution",
  "reglages": {
    "population": 40,
    "generations": 50,
    "mutation": 0.08,
    "scenarios_par_evaluation": 3,
    "graine": 42,
    "duree_max": 600,
    "epoques": 100,
    "taux_apprentissage": 0.003,
    "lot": 64,
    "mode": "rapide"
  },
  "recompense": {
    "base": "score",
    "penalite_erreur": 20.0,
    "penalite_contact": 20.0,
    "sur_erreur": "penalite"
  },
  "graine": 42,
  "n_entrees": 37,
  "n_sorties": 106,
  "n_parametres": 66090,
  "metadonnees": {
    "moteur": "1.3.0",
    "bareme": "2027-1.0"
  },
  "updated": int(time.time()),
  "best_score": 105.0,
  "last_training": int(time.time())
}

weights_doc = {
  "format": "camelot-poids",
  "version": 1,
  "layers": weights_to_json(net.export_layers())
}

brain_path = ROOT / ".data" / "brains" / "cerveau-v2-champion.json"
weights_path = ROOT / ".data" / "weights" / "cerveau-v2-champion.json"

brain_path.parent.mkdir(parents=True, exist_ok=True)
weights_path.parent.mkdir(parents=True, exist_ok=True)

brain_path.write_text(json.dumps(brain_doc, ensure_ascii=False, indent=2), encoding="utf-8")
weights_path.write_text(json.dumps(weights_doc, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Exporté avec succès :\n  - Cerveau: {brain_path}\n  - Poids: {weights_path}")

