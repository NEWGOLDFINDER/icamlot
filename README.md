# ICAM LOT — Robot Autonome Eurobot 2027

[![Python](https://img.shields.io/badge/Python-3.9%2B-blue.svg)](https://www.python.org/)
[![PyTorch](https://img.shields.io/badge/PyTorch-2.0%2B-EE4C2C.svg)](https://pytorch.org/)
[![ONNX Runtime](https://img.shields.io/badge/ONNX%20Runtime-CPU%20%7C%20ARM64-005CED.svg)](https://onnxruntime.ai/)
[![Eurobot](https://img.shields.io/badge/Eurobot-2027-F2A900.svg)](https://www.eurobot.org/)

Projet officiel **ICAM LOT** pour la coupe **Eurobot 2027** : système robotique autonome combinant simulation cinématique GPU temps-réel, intelligence artificielle par apprentissage par renforcement profond (**PPO récurrent**), anticipation spatio-temporelle et architecture matérielle distribuée (**Raspberry Pi 5 + Dual ESP32**).

---

## Table des Matières

- [1. Architecture Matérielle & Robotique](#1-architecture-matérielle--robotique)
- [2. Cerveau IA V2 (Réseau de Neurones Factorisé)](#2-cerveau-ia-v2-réseau-de-neurones-factorisé)
- [3. Anticipation Spatio-Temporelle](#3-anticipation-spatio-temporelle)
- [4. Résultats du Benchmark Officiel (100 Matchs)](#4-résultats-du-benchmark-officiel-100-matchs)
- [5. Démarrage Rapide & Commandes](#5-démarrage-rapide--commandes)
- [6. Structure du Projet](#6-structure-du-projet)

---

## 1. Architecture Matérielle & Robotique

Le robot est architecturé autour d'une répartition claire des rôles pour garantir réactivité temps-réel dur et puissance de calcul :

```
                        ┌──────────────────────────────────────────────────────────┐
                        │             Raspberry Pi 5 (8 Go, Cortex-A76)            │
                        │  - Cerveau IA ONNX Runtime (Inférence en 48 µs)          │
                        │  - Filtre de Kalman 2D (Tracking Lidar adverse)          │
                        │  - Orchestrateur Dual ESP32 en Temps Masqué              │
                        └───────────────┬──────────────────────────┬───────────────┘
                                        │ UART 1 (/dev/ttyUSB_NAV) │ UART 2 (/dev/ttyUSB_ACT)
                                        ▼                          ▼
               ┌───────────────────────────────────┐    ┌───────────────────────────────────┐
               │         ESP32 #1 : Navigation     │    │       ESP32 #2 : Actionneurs      │
               │  - Asservissement différentiel/holo│    │  - Pince pneumatique Face A (vide)│
               │  - Odométrie roues codeuses       │    │  - Pince pneumatique Face B (vide)│
               │  - Détection anti-patinage        │    │  - Pince Graal & Ascenseur        │
               │  - Évitement d'urgence Lidar      │    │  - Canon à boulets                │
               └───────────────────────────────────┘    └───────────────────────────────────┘
```

### Pipelining en Temps Masqué (Dual ESP32)
Grâce au module [`esp32_bridge.py`](esp32_bridge.py), la Raspberry Pi 5 pilote simultanément les deux ESP32 :
- L'ESP32 Navigation initie le déplacement vers la cible ($P_1..P_{10}$, zone de muraille ou salle du trône).
- **En temps masqué**, l'ESP32 Actionneurs pré-oriente la pince (Face A ou B), arme le vide pneumatique et règle la hauteur avant l'arrêt complet du châssis.
- **Gain mesuré sur un match de 100 secondes** : **+37,11 secondes** épargnées par rapport à une exécution séquentielle, permettant d'exécuter l'intégralité des 105 points du barème.

---

## 2. Cerveau IA V2 (Réseau de Neurones Factorisé)

Pour dépasser les limites des architectures MLP classiques et exploiter pleinement les capacités du Raspberry Pi 5, le réseau V2 intègre :
- **Encodeur Multi-Branches Spécialisé (`FactorizedEncoder`)** :
  1. *Branche Géométrique* ($6 \to 32$ neurones) : pose du robot ($x, y, \cos\theta, \sin\theta$) et coordonnées Lidar de l'adversaire.
  2. *Branche Terrain & Châteaux* ($23 \to 64$ neurones) : état des 10 paquets, murs $M_1..M_5$, tours $T_1..T_4$ et statut du Graal.
  3. *Branche Mécanique & Horloge* ($8 \to 32$ neurones) : temps restant normalisé, charges des pinces A et B, tir des boulets.
  4. *Fusion* : projection $128 \to 128$ avec `LayerNorm` et activation `SiLU` (Swish).
- **Mémoire Récurrente Temporelle (`nn.GRUCell(128, 128)`)** : capture les dynamiques d'évitement adverse et mémorise l'historique du match.
- **Têtes Acteur et Critique avec Connexions Résiduelles (`ResNet`)** :
  - Tête Acteur : résidu dense $128 \to 128 \to 106$ logits d'actions Eurobot.
  - Tête Critique : résidu dense $128 \to 128 \to 1$ valeur d'état $V(s)$.
- **Poids totaux** : **164 715 paramètres** (exporté en `.data/weights/best_brain_pi5.onnx`, 53 Ko).

---

## 3. Anticipation Spatio-Temporelle

Deux mécanismes géométriques et temporels garantissent l'absence absolue de fautes :
1. **Évitement Strict des Caisses ($> 235\text{ mm}$)** :
   - Chaque trajectoire candidate $[A \to B]$ est projetée orthogonalement contre les coordonnées des caisses actives.
   - Si la distance minimale d'approche passe sous le rayon de sécurité de $235\text{ mm}$, l'action est **strictement masquée**.
2. **Couloir de Retour au Trône & Budget Boulets** :
   - L'algorithme vérifie en permanence que le corridor direct depuis la cible finale vers le trône ($x = 250, y = 1000\text{ mm}$) reste dégagé d'obstacles.
   - Le budget temps réserve systématiquement le temps de déplacement vers le trône plus le tir des boulets ($6,1\text{ s}$) avant la sirène des $100\text{ s}$.

---

## 4. Résultats du Benchmark Officiel (100 Matchs)

Les confrontations multi-matchs ont été exécutées avec le simulateur cinématique complet (`skipContacts: false`) :

| Scénario Opposé | Matchs | Victoires V2 | Égalités | Défaites | Score Moyen V2 | Score Adverse | Collisions V2 | Overlap Robots |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Self-Play (V2 Jaune vs V2 Bleu)** | 20 | **100.0%** | 0.0% | 0.0% | **105.0 ± 0.0** | 34.0 ± 4.4 | **0** | **0** |
| **vs Adversaire Réaliste** | 20 | **100.0%** | 0.0% | 0.0% | **70.7 ± 7.4** | 54.0 ± 0.0 | **0** | **0** |
| **vs Adversaire Faible (70% vitesse)**| 20 | **100.0%** | 0.0% | 0.0% | **70.5 ± 7.0** | 54.0 ± 0.0 | **0** | **0** |
| **vs Adversaire Agressif (120% vit.)**| 20 | 0.0% | 0.0% | 100.0% | 8.0 ± 0.0 | 62.0 ± 0.0 | **0** | **0** |
| **vs Baseline V1 (64-dim, 42k)** | 20 | **30.0%** | 0.0% | 70.0% | 27.6 ± 33.6 | 53.3 ± 24.0 | **0** | **0** |

### Benchmark Inférence CPU / Raspberry Pi 5 (5 000 itérations ONNX Runtime)
- **Latence Médiane (P50)** : **$47,9\text{ µs}$** ($0,048\text{ ms}$)
- **Latence 99e percentile (P99)** : **$81,0\text{ µs}$** ($0,081\text{ ms}$)
- **Débit** : **$19\ 957\text{ décisions / seconde}$**
- **Marge de sécurité temps-réel (< 5 ms)** : **$99,8\times$ plus rapide** que le cycle requis.

---

## 5. Démarrage Rapide & Commandes

### A. Dépendances Légères (Raspberry Pi 5)
Sur le robot, aucune dépendance PyTorch lourde n'est requise :
```bash
pip install onnxruntime numpy pyserial
```

### B. Lancer le Benchmark Complet
```bash
python benchmark_duels.py --matches 20 --inf-runs 5000
```

### C. Exécuter un Match avec Pilotage Dual ESP32 (Temps Masqué)
```bash
python pi5_runner.py --esp32 --mock-esp
```

### D. Lancer le Serveur Web & Trainer Local
```bash
python api/server.py --port 8081 --static .
```
Accédez ensuite à l'interface sur `http://localhost:8081/`.

### E. Entraîner un Nouveau Cerveau sur PC GPU
```bash
python trainer/ppo_trainer.py --steps 100000 --batch-size 256 --rollout-len 32
```

---

## 6. Structure du Projet

```
icamlot/
├── .data/
│   ├── brains/              # Définitions JSON des cerveaux
│   └── weights/             # Poids pré-entraînés (best_brain_pi5.onnx, ppo_best.pt)
├── api/
│   └── server.py            # Serveur API REST et serveur web local
├── engine/
│   ├── actions.js           # Catalogue des 106 actions et masquage légal
│   ├── duel_bridge.js       # Pont cinématique Node.js pour duels multi-robots
│   ├── engine.js            # Moteur cinématique Eurobot 2027 officiel
│   ├── env.js               # Environnement pas-à-pas et miroir équipe Bleu
│   └── score.js             # Barème et calcul officiel des points
├── trainer/
│   ├── models.py            # Architecture FactorizedEncoder + GRU + ResNet Actor-Critic
│   ├── ppo_trainer.py       # Algorithme PPO vectorisé avec warm-start imitation
│   ├── torch_engine.py      # Moteur vectorisé 100% PyTorch GPU (>119k steps/s)
│   └── export_onnx.py       # Exporteur et validateur ONNX pour Raspberry Pi 5
├── benchmark_duels.py       # Banc de test multi-scénarios (100 matchs)
├── BENCHMARK_REPORT.md      # Rapport officiel des résultats de benchmark
├── esp32_bridge.py          # Orchestrateur Dual ESP32 en temps masqué
├── lidar_tracker.py         # Filtre de Kalman 2D pour lidar adverse
├── pi5_runner.py            # Moteur d'inférence autonome Raspberry Pi 5
└── index.html               # Interface graphique interactive
```

---

## Licence & Équipe
Projet développé pour la coupe de France de Robotique / Eurobot 2027 par l'équipe **ICAM LOT**.
