"""Tests unitaires et benchmark pour TorchEnv (Simulation Eurobot 100% GPU)."""
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import time
import torch
from trainer.torch_engine import TorchEnv, BAREME

def test_torch_env_reset():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"--- 1. Test Reset sur {device} ---")
    B = 64
    env = TorchEnv(batch_size=B, device=device)
    obs = env.reset()

    assert obs.shape == (B, 37), f"Shape obs attendue (64, 37), obtenue: {obs.shape}"
    mask = env.get_mask()
    assert mask.shape == (B, 106), f"Shape mask attendue (64, 106), obtenue: {mask.shape}"

    # Au départ:
    # - Les prises de paquets directement accessibles (P1, P2, P5, P6, P9, P10) doivent être autorisées
    reachable_takes = [0, 1, 4, 5, 8, 9, 10, 11, 14, 15, 18, 19]
    blocked_takes = [2, 3, 6, 7, 12, 13, 16, 17]
    assert mask[:, reachable_takes].all(), "Les paquets directement accessibles doivent être autorisés au départ"
    assert not mask[:, blocked_takes].any(), "Les paquets bloqués par P9/P10 doivent être masqués pour empêcher toute collision"
    # - Poser des murs (20..39) doit être interdit (pas de pierre en main)
    assert not mask[:, 20:40].any(), "Poser des murs doit être interdit au départ"
    # - Trône (105) doit être autorisé dans le masque de base
    assert mask[:, 105].all(), "Le trône doit être autorisé dans le masque de base"

    print("  ok  obs shape (B, 37)")
    print("  ok  mask shape (B, 106)")
    print("  ok  règles initiales validées")


def test_torch_env_example_program():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"\n--- 2. Test Programme d'Exemple (14 actions) sur {device} ---")
    B = 16
    env = TorchEnv(batch_size=B, device=device)
    env.reset()

    # Programme d'exemple officiel ICAM LOT
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
        69,  # porte A M3 int
        86,  # prendreGraal B
        98,  # poserGraal B M3
        84,  # boulets
        105, # trone
    ]

    for step_i, act_idx in enumerate(EXAMPLE_ACTIONS):
        actions = torch.full((B,), act_idx, dtype=torch.long, device=device)
        obs, reward, done, info = env.step(actions)

    score = env.score[0].item()
    errors = env.errors[0].item()
    t = env.t[0].item()

    print(f"  Score obtenu: {score} pts (attendu: 105.0 pts)")
    print(f"  Erreurs: {errors} (attendu: 0)")
    print(f"  Temps final: {t:.1f} s (attendu: 100.0 s)")

    assert errors == 0, f"Erreurs détectées: {errors}"
    assert score == 105.0, f"Score incorrect: {score} != 105.0"
    assert env.done.all(), "Tous les environnements doivent être terminés"
    print("  ok  Programme d'exemple donne exactement 105 points sans aucune erreur !")


def test_torch_env_performance_benchmark():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"\n--- 3. Benchmark de Performance GPU ({device}) ---")
    B = 1024
    env = TorchEnv(batch_size=B, device=device)
    env.reset()

    EXAMPLE_ACTIONS = [0, 18, 20, 32, 4, 19, 28, 36, 3, 69, 86, 98, 84, 105]

    # Warmup
    for act in EXAMPLE_ACTIONS:
        env.step(torch.full((B,), act, dtype=torch.long, device=device))
    if device.type == "cuda":
        torch.cuda.synchronize()

    # Benchmark: 100 itérations de match complets pour B=1024 environnements
    N_ROUNDS = 20
    t0 = time.time()
    for _ in range(N_ROUNDS):
        env.reset()
        for act in EXAMPLE_ACTIONS:
            env.step(torch.full((B,), act, dtype=torch.long, device=device))

    if device.type == "cuda":
        torch.cuda.synchronize()
    elapsed = time.time() - t0

    total_matches = N_ROUNDS * B
    total_steps = total_matches * len(EXAMPLE_ACTIONS)
    matches_per_sec = total_matches / elapsed
    steps_per_sec = total_steps / elapsed

    print(f"  Total matches simulés: {total_matches}")
    print(f"  Temps total: {elapsed:.3f} s")
    print(f"  Vitesse: {matches_per_sec:,.0f} matches complets / seconde")
    print(f"  Débit: {steps_per_sec:,.0f} steps / seconde sur GPU !")


def test_torch_rules_reinforcement():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"\n--- 4. Tests des règles renforcées Eurobot 2027 ({device}) ---")

    # A. Règle des tours : 1 seule tour par zone circulaire
    env = TorchEnv(batch_size=1, device=device)
    env.reset()
    # Prendre P1 sur face A (act 0)
    env.step([0])
    # Faire tour T1 pierre 1 (act 40)
    env.step([40])
    assert env.towers[0, 0].item() == 1, "Tour T1 doit être construite"
    mask = env.get_mask()
    # Tenter de refaire une tour sur T1 avec face A (act 41 ou 42)
    assert not mask[0, 41].item(), "2e pierre de tour sur T1 doit être STRICTEMENT impossible"
    assert not mask[0, 42].item(), "3e pierre de tour sur T1 doit être STRICTEMENT impossible"
    print("  ok  Règle des tours : max 1 seule tour par zone circulaire vérifiée")

    # B. Règle du Graal : interdit de poser dans le vide
    env.reset()
    # Prendre le Graal sur face B (act 86)
    env.step([86])
    mask = env.get_mask()
    # Vérifier que poserGraal sur n'importe quelle zone vide est STRICTEMENT interdit
    poser_graal_acts = [idx for idx in range(87, 105)]
    for act in poser_graal_acts:
        assert not mask[0, act].item(), f"poserGraal {act} ne doit pas être possible sur zone vide"
    # Vérifier que compute_score() donne 0 pt de Graal si zone vide
    env.graal_state[0] = 3
    env.graal_zone[0] = 0  # M1 (non construite)
    env.robot_pose[0, 0] = 1500.0  # hors de la salle du trône
    env.robot_pose[0, 1] = 1000.0
    score = env.compute_score()
    assert score[0].item() == 0.0, "Graal sur zone vide ne doit donner AUCUN point"
    print("  ok  Règle du Graal : pose dans le vide strictement bloquée et 0 pt")

    # C. Collision avec caisses : trajectoire traversant un pack non pris
    env.reset()
    # Robot est à (250, 1000). Action 2 (prendre P3 à 1750, 305.5) coupe directement à travers P9 (1500, 500)
    old_errors = env.errors.item()
    env.step([2])
    new_errors = env.errors.item()
    assert new_errors > old_errors, "Trajectoire traversant une caisse doit déclencher une collision"
    print("  ok  Détection de collision : robot ne peut plus passer à travers les caisses")


if __name__ == "__main__":
    test_torch_env_reset()
    test_torch_env_example_program()
    test_torch_rules_reinforcement()
    test_torch_env_performance_benchmark()
