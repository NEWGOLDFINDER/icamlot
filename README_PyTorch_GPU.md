# Projet ICAM LOT - Intelligence Artificielle Eurobot 2027 & Déploiement Raspberry Pi 5

Ce système combine :
1. **Un moteur de simulation 100% GPU en PyTorch vectorisé** (> 9 200 matchs complets / seconde).
2. **Un entraîneur Deep Reinforcement Learning (PPO)** avec réseau récurrent (**GRU**) pour conférer au robot mémoire temporelle, anticipation de l'adversaire et séquençage stratégique.
3. **Un moteur d'inférence ultra-léger exporté en ONNX**, autonome et ultra-rapide (< 0.10 ms par décision sur Raspberry Pi 5 sans nécessiter PyTorch).

---

## 1. Architecture Matérielle & Logicielle

```
  Station d'entraînement (GPU NVIDIA RTX)                Robot Réel (Raspberry Pi 5)
┌───────────────────────────────────────────────┐     ┌───────────────────────────────────────────────┐
│ TorchEnv GPU (> 9,200 matchs/s)               │     │ Capteurs / Lidar / Odométrie (ROS 2 / CAN)   │
│       │                                       │     │                    │                          │
│       ▼                                       │     │                    ▼                          │
│ RecurrentActorCritic (Perception + GRU + PPO) │     │ format_observation() + compute_mask()         │
│       │                                       │     │                    │                          │
│       ▼ (Validation > 105 pts, 0 faute)       │     │                    ▼                          │
│ export_pi5_onnx() ────────────────────────────┼────►│ pi5_runner.py (ONNX Runtime, 25 µs)          │
│       │                                       │     │                    │                          │
│       ▼                                       │     │                    ▼                          │
│ best_brain_pi5.onnx (~23 Ko)                  │     │ Commande Moteurs & Actionneurs (ID 0..105)   │
└───────────────────────────────────────────────┘     └───────────────────────────────────────────────┘
```

---

## 2. Performances Mesurées

| Composant | Matériel | Métrique | Performance mesurée |
| :--- | :--- | :--- | :--- |
| **Simulation GPU** | NVIDIA GeForce RTX 3070 | Vitesse de calcul | **9 212 matchs complets / s** (>128k steps/s) |
| **Entraînement PPO** | PyTorch CUDA | Débit d'échantillonnage | **~3 200 transitions PPO / s** |
| **Inférence ONNX Pi 5** | ARM Cortex-A76 / CPU | Latence par décision | **0.026 ms** (~26 microsecondes) |
| **Empreinte Modèle** | Disque / Mémoire RAM | Taille du fichier `.onnx` | **23.5 Ko** (34 347 paramètres) |
| **Budget Temps Réel** | Cycle Eurobot (< 5 ms) | Marge d'exécution | **> 150× plus rapide que le budget max** |

---

## 3. Fichiers et Rôles

- `trainer/torch_engine.py` : Moteur de simulation vectorisé GPU (cinématique, collisions, scoring Eurobot 2027).
- `trainer/models.py` : Architecture `RecurrentActorCritic` (Encodeur + GRU 64 + Tête Acteur 106 logits + Critique) et `Pi5ActorWrapper`.
- `trainer/ppo_trainer.py` : Entraîneur PPO récurrent avec warm-start par imitation, pénalisation des collisions et auto-export ONNX champion.
- `trainer/export_onnx.py` : Exportateur et validateur ONNX avec mesure de latence CPU.
- `pi5_runner.py` : Agent autonome pour Raspberry Pi 5 (**aucune dépendance PyTorch**, dépend uniquement de `onnxruntime` et `numpy`).
- `trainer/test_torch_engine.py` : Suite de tests de validation du moteur GPU.
- `tests/test_engine.js` : Suite de tests JavaScript (10 suites de tests).

---

## 4. Guide d'Utilisation

### A. Entraîner un cerveau champion (sur PC / Station GPU)

```bash
# Entraînement PPO récurrent (warm-start imitation + optimisation RL sur GPU)
python trainer/ppo_trainer.py --steps 100000 --batch-size 256 --rollout-len 32 --eval-every 2
```

Le script :
1. Initialise la mémoire récurrente GRU par imitation du programme optimal.
2. Optimise la stratégie via PPO face aux contraintes temporelles et collisions.
3. Dès qu'un nouveau score record sans faute est validé, il génère automatiquement `.data/weights/best_brain_pi5.onnx`.

### B. Déployer sur le Raspberry Pi 5

1. Sur le Raspberry Pi 5, installez uniquement les dépendances légères :
   ```bash
   pip install onnxruntime numpy
   ```
2. Copiez sur la Pi 5 :
   - `pi5_runner.py`
   - `.data/weights/best_brain_pi5.onnx`
   - `trainer/actions_table.json`

3. **Lancer le benchmark de vitesse** sur la Pi 5 :
   ```bash
   python pi5_runner.py --benchmark
   ```

4. **Simuler un match complet de 100 s** :
   ```bash
   python pi5_runner.py --simulate
   ```

5. **Intégration dans le code robot (ROS 2 / C++ / Python)** :
   ```python
   from pi5_runner import Pi5EurobotAgent

   # Initialisation de l'agent (charge le modèle ONNX en RAM)
   agent = Pi5EurobotAgent("best_brain_pi5.onnx")
   agent.reset()  # Au coup d'envoi du match (t = 0)

   # Dans la boucle principale (ex: 20 Hz ou à chaque fin d'action) :
   sensor_state = {
       "t": elapsed_time,
       "x": robot_x, "y": robot_y, "cap": robot_yaw,
       "packs": [3, 3, 3, 0, 3, ...],
       "held_A": count_A, "held_B": count_B,
       "opp_x": opp_x, "opp_y": opp_y,
       # ...
   }

   obs = agent.format_observation(sensor_state)
   mask = agent.compute_mask(sensor_state)
   action_id, action_info, latency_ms = agent.predict(obs, mask)

   print(f"Action choisie en {latency_ms:.2f} ms : {action_info['a']} vers {action_info.get('p') or action_info.get('z')}")
   # Envoyer l'ordre aux asservissements et actionneurs
   ```

---

## 5. Règles Eurobot 2027 Garanties

1. **Règle stricte des tours (§E et §F)** :
   - Max 1 seule tour (pierre verticale) comptabilisée par zone circulaire ($T_1..T_4$).
   - Masquage GPU temps-réel empêchant de rejouer sur une tour déjà finie.
2. **Règle du Graal (§E)** :
   - Interdiction absolue de poser le Graal dans le vide ; il doit obligatoirement reposer sur une construction valide (mur $\ge 3$ pierres ou tour $\ge 1$ pierre verticale).
3. **Anti-collision paquets et adversaire** :
   - Détection géométrique vectorisée segment-point.
   - Pénalité de collision pour éliminer toute trajectoire traversant les caisses $P_1..P_{10}$ ou le robot adverse.
