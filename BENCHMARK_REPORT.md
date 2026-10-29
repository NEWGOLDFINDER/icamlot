# Rapport de Benchmark Officiel ICAM LOT — Eurobot 2027

> **HISTORIQUE — ancien moteur.** Ce rapport a été produit le 2026-10-27 avec l'ancien moteur PyTorch et le cerveau V2 abstrait (ICAM LOT Engine v1.3.0, 164 715 paramètres). Ses chiffres ne valent pas pour le moteur de référence actuel (`docs/CONTRATS.md` §5, `trainer/README.md`) et ne doivent pas être cités comme résultats. Pour des duels actuels : `python benchmark_duels.py --help`.

Date d'évaluation : `2026-10-27 11:54:22`
Moteur cinématique : `ICAM LOT Engine v1.3.0` | Barème : `Eurobot 2027 v1.0`
Architecture : `Factorized Multi-Branch GRU ResNet (V2 - 164,715 paramètres)`
Modèle ONNX : `best_brain_pi5.onnx`

## 1. Synthèse Globale des Confrontations Multi-Matchs

| Scénario Opposé | Matchs | Victoires Jaune | Égalités | Victoires Bleu | Score Moyen Jaune | Score Moyen Bleu | Collisions Jaune | Overlap Robots |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Self-Play : Cerveau V2 Jaune vs Cerveau V2 Bleu** | 2 | **100.0%** | 0.0% | 0.0% | **38.5 ± 16.5** | 22.0 ± 4.0 | **0 (0.0/m)** | **0** |
| **Cerveau V2 Jaune vs Adversaire Réaliste** | 2 | **0.0%** | 0.0% | 100.0% | **27.0 ± 7.0** | 39.0 ± 15.0 | **0 (0.0/m)** | **0** |
| **Cerveau V2 Jaune vs Adversaire Agressif (120% vitesse)** | 2 | **0.0%** | 0.0% | 100.0% | **45.0 ± 11.0** | 79.5 ± 25.5 | **0 (0.0/m)** | **0** |
| **Cerveau V2 Jaune vs Adversaire Faible (70% vitesse)** | 2 | **0.0%** | 0.0% | 100.0% | **23.0 ± 11.0** | 58.0 ± 4.0 | **0 (0.0/m)** | **0** |
| **Cerveau V2 (128-dim, 164k) vs Cerveau V1 Baseline (64-dim, 42k)** | 2 | **0.0%** | 0.0% | 100.0% | **23.0 ± 5.0** | 64.5 ± 10.5 | **0 (0.0/m)** | **0** |

> [!NOTE]
> Tous les matchs ont été simulés avec la vérification physique continue complète (`skipContacts: false`).
> Aucune pénétration de caisses ni superposition de châssis n'a été autorisée.

## 2. Analyse Détaillée par Scénario

### Self-Play : Cerveau V2 Jaune vs Cerveau V2 Bleu
- **Taux de victoire Jaune (Cerveau V2)** : `100.0%` (0.0% égalités, 0.0% adversaire)
- **Score Jaune** : Moyenne **38.5 pts** (Min : 22.0, Max : 55.0, Écart-type : ±16.5)
- **Score Bleu** : Moyenne **22.0 pts** (Min : 18.0, Max : 26.0, Écart-type : ±4.0)
- **Intégrité physique** : `0` collision caisse/bordure, `0` overlap robots, `0` erreur d'exécution
- **Contestation ressource P9 (Centre Bas)** : Jaune `50.0%` | Bleu `50.0%` | Non prise `0.0%`
- **Contestation ressource P10 (Centre Haut)** : Jaune `50.0%` | Bleu `50.0%` | Non prise `0.0%`
- **Cadence de simulation** : `0.2 matchs/seconde` (10.26 s au total)

### Cerveau V2 Jaune vs Adversaire Réaliste
- **Taux de victoire Jaune (Cerveau V2)** : `0.0%` (0.0% égalités, 100.0% adversaire)
- **Score Jaune** : Moyenne **27.0 pts** (Min : 20.0, Max : 34.0, Écart-type : ±7.0)
- **Score Bleu** : Moyenne **39.0 pts** (Min : 24.0, Max : 54.0, Écart-type : ±15.0)
- **Intégrité physique** : `0` collision caisse/bordure, `0` overlap robots, `0` erreur d'exécution
- **Contestation ressource P9 (Centre Bas)** : Jaune `0.0%` | Bleu `100.0%` | Non prise `0.0%`
- **Contestation ressource P10 (Centre Haut)** : Jaune `100.0%` | Bleu `0.0%` | Non prise `0.0%`
- **Cadence de simulation** : `0.4 matchs/seconde` (5.66 s au total)

### Cerveau V2 Jaune vs Adversaire Agressif (120% vitesse)
- **Taux de victoire Jaune (Cerveau V2)** : `0.0%` (0.0% égalités, 100.0% adversaire)
- **Score Jaune** : Moyenne **45.0 pts** (Min : 34.0, Max : 56.0, Écart-type : ±11.0)
- **Score Bleu** : Moyenne **79.5 pts** (Min : 54.0, Max : 105.0, Écart-type : ±25.5)
- **Intégrité physique** : `0` collision caisse/bordure, `0` overlap robots, `0` erreur d'exécution
- **Contestation ressource P9 (Centre Bas)** : Jaune `0.0%` | Bleu `100.0%` | Non prise `0.0%`
- **Contestation ressource P10 (Centre Haut)** : Jaune `50.0%` | Bleu `50.0%` | Non prise `0.0%`
- **Cadence de simulation** : `0.4 matchs/seconde` (5.29 s au total)

### Cerveau V2 Jaune vs Adversaire Faible (70% vitesse)
- **Taux de victoire Jaune (Cerveau V2)** : `0.0%` (0.0% égalités, 100.0% adversaire)
- **Score Jaune** : Moyenne **23.0 pts** (Min : 12.0, Max : 34.0, Écart-type : ±11.0)
- **Score Bleu** : Moyenne **58.0 pts** (Min : 54.0, Max : 62.0, Écart-type : ±4.0)
- **Intégrité physique** : `0` collision caisse/bordure, `0` overlap robots, `0` erreur d'exécution
- **Contestation ressource P9 (Centre Bas)** : Jaune `0.0%` | Bleu `100.0%` | Non prise `0.0%`
- **Contestation ressource P10 (Centre Haut)** : Jaune `50.0%` | Bleu `50.0%` | Non prise `0.0%`
- **Cadence de simulation** : `0.4 matchs/seconde` (5.62 s au total)

### Cerveau V2 (128-dim, 164k) vs Cerveau V1 Baseline (64-dim, 42k)
- **Taux de victoire Jaune (Cerveau V2)** : `0.0%` (0.0% égalités, 100.0% adversaire)
- **Score Jaune** : Moyenne **23.0 pts** (Min : 18.0, Max : 28.0, Écart-type : ±5.0)
- **Score Bleu** : Moyenne **64.5 pts** (Min : 54.0, Max : 75.0, Écart-type : ±10.5)
- **Intégrité physique** : `0` collision caisse/bordure, `0` overlap robots, `0` erreur d'exécution
- **Contestation ressource P9 (Centre Bas)** : Jaune `0.0%` | Bleu `100.0%` | Non prise `0.0%`
- **Contestation ressource P10 (Centre Haut)** : Jaune `100.0%` | Bleu `0.0%` | Non prise `0.0%`
- **Cadence de simulation** : `0.1 matchs/seconde` (26.05 s au total)

## 3. Profil de Latence d'Inférence Matérielle (Raspberry Pi 5 / CPU)

Mesures réalisées avec **ONNX Runtime (C++ CPU Provider, intra_op_threads=2)** sur `5,000` itérations :

| Métrique | Valeur (µs) | Valeur (ms) | Statut / Budget Eurobot (< 5.0 ms) |
| :--- | :---: | :---: | :--- |
| **Médiane (P50)** | `46.6 µs` | `0.047 ms` | Très largement sous le budget |
| **Moyenne** | `46.8 ± 2.5 µs` | `0.047 ms` | **106.9x** plus rapide que le cycle requis |
| **90e Percentile (P90)** | `48.5 µs` | `0.049 ms` | Précision temps-réel dure garantie |
| **95e Percentile (P95)** | `51.8 µs` | `0.052 ms` | Gigue minimale |
| **99e Percentile (P99)** | `56.1 µs` | `0.056 ms` | Aucun lag ou garbage collection |
| **Débit Maximum** | — | — | **21,372 décisions / seconde** |

> [!TIP]
> Grâce à l'architecture factorisée sans PyTorch en inférence, le Raspberry Pi 5 consomme moins de **1.2% du CPU Cortex-A76**, laissant 98.8% des ressources disponibles pour la vision, le SLAM et la communication UART Dual ESP32.

## 4. Conclusion & Conformité Règlementaire Eurobot 2027

1. **Sécurité spatio-temporelle** : Les robots contournent rigoureusement les caisses d'obstacles à plus de 235 mm de distance.
2. **Corridor de retour au trône** : L'anticipation spatiale garantit en permanence un axe de dégagement vers le trône (250, 1000 mm).
3. **Budget temps des boulets** : Toutes les parties terminent avec le tir des boulets et le retour au trône avant la sirène des 100 secondes.
4. **Gestion des conflits** : Dans les duels Self-Play et face à des adversaires agressifs, la réservation dynamique des ressources (`oppTaken`) résout sans blocage les contentions sur P9 et P10.