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
    # Avec le Waypoint Bypass (Chantier 2), les paquets derrière P9/P10 sont accessibles via contournement
    assert mask[:, reachable_takes].all(), "Les paquets directement accessibles doivent être autorisés au départ"
    assert mask[:, blocked_takes].all(), "Avec le Waypoint Bypass, les paquets derrière P9/P10 sont atteignables par contournement"
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
        86,  # prendreGraal B
        69,  # porte A M3 int
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

    # D. Anticipation spatio-temporelle : se laisser place et temps de retourner au trône pour les boulets
    env.reset()
    # Si t=92.0 s (fin de match imminente), les actions secondaires lointaines sont masquées
    env.t[0] = 92.0
    mask_late = env.get_mask()
    assert not mask_late[0, 0].item(), "À t=92s, prendre P1 doit être masqué car impossible de rentrer et tirer avant 100s"
    assert mask_late[0, 105].item(), "À t=92s, le repli vers le trône doit rester garanti et prioritaire"
    print("  ok  Anticipation du trône : place et budget temps garantis pour tirer les boulets (<= 100s)")


def test_torch_staging_and_repickup():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"\n--- 5. Tests de l'espace tactique : Staging & Reprise ({device}) ---")
    import math
    env = TorchEnv(batch_size=1, device=device)
    env.reset()

    # 1. Vérifier que le staging avec pince vide est strictement masqué
    mask = env.get_mask(full=True)
    assert not mask[0, 106].item(), "Staging avec 0 pierres doit être masqué"

    # 2. Charger 3 pierres à plat sur Face A
    env.held_count[0, 0] = 3
    env.held_rot[0, 0] = 0.0
    mask_loaded = env.get_mask(full=True)
    assert mask_loaded[0, 106].item(), "Staging SN Face A doit être autorisé avec 3 pierres à plat"

    # 3. Exécuter l'action de staging (106)
    obs, rew, done, info = env.step([106])
    assert env.errors[0].item() == 0, "Le staging légal ne doit produire AUCUNE erreur"
    assert env.held_count[0, 0].item() == 0, "Pince Face A doit être vidée après staging"
    assert env.staged_packs[0, 0].item() == 3, "Zone SN doit contenir 3 pierres après staging"
    assert math.isclose(env.robot_pose[0, 0].item(), 1120.5, abs_tol=1.0)
    assert math.isclose(env.robot_pose[0, 1].item(), 450.0, abs_tol=1.0)
    assert env.score[0].item() == 0.0, "Le staging ne doit pas attribuer de points de mur/tour"

    # 4. Vérifier que la reprise (112) devient légale
    mask_staged = env.get_mask(full=True)
    assert mask_staged[0, 112].item(), "Reprise SN Face A doit être autorisée après dépôt"
    # Vérifier que le re-staging sur la même zone occupée est masqué
    env.held_count[0, 0] = 3
    env.held_rot[0, 0] = 0.0
    mask_re_stage = env.get_mask(full=True)
    assert not mask_re_stage[0, 106].item(), "Re-staging sur zone déjà pleine doit être masqué"

    # 5. Exécuter la reprise (112)
    env.held_count[0, 0] = 0
    obs, rew, done, info = env.step([112])
    assert env.errors[0].item() == 0, "La reprise ne doit produire AUCUNE erreur"
    assert env.held_count[0, 0].item() == 3, "Pince Face A doit avoir rechargé 3 pierres"
    assert env.staged_packs[0, 0].item() == 0, "Zone SN doit être vide après reprise"
    print("  ok  Staging (106) et Reprise (112) validés sans erreur et avec mise à jour d'état exacte")


def test_torch_wavefront_and_envelope():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"\n--- 6. Tests de la grille wavefront 2D et de l'enveloppe dynamique ({device}) ---")
    env = TorchEnv(batch_size=2, device=device)
    env.reset()

    # Wavefront distance grid
    grid = env.compute_wavefront_distance()
    assert grid.shape == (2, 1, 50, 75), f"Dimensions grille attendues (2, 1, 50, 75), obtenu {grid.shape}"
    assert (grid >= 0.0).all(), "Toutes les distances doivent être positives"

    # Vérifier l'enveloppe dynamique et le repli de pince à 90°
    assert env.held_rot[0, 0].item() == 0.0
    env.fold_gripper(face=0)
    assert env.held_rot[0, 0].item() == 90.0
    env.toggle_gripper_folding(face=0)
    assert env.held_rot[0, 0].item() == 0.0

    # Dilation obstacles
    occ = env.dilate_obstacles()
    assert occ.shape == (2, 1, 50, 75)
    print("  ok  Propagation wavefront 2D (50x75) et repli 90° validés")


def test_torch_curriculum_reset():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"\n--- 7. Tests du curriculum procédural Eurobot ({device}) ---")
    env = TorchEnv(batch_size=32, device=device)

    # Standard
    env.reset(scenario={"mode": "standard"})
    assert (env.t == 0.0).all()
    assert (env.robot_pose[:, 0] == 250.0).all()

    # Trapped
    env.reset(scenario={"mode": "trapped"})
    assert (env.t >= 20.0).all() and (env.t <= 75.0).all()

    # Adversarial
    env.reset(scenario={"mode": "adversarial"})
    assert (env.opp_pose[:, 0] > 0.0).all()

    # Curriculum stochastique (50/30/20)
    obs = env.reset(curriculum=True)
    assert obs.shape == (32, 37)
    print("  ok  Curriculum procédural (standard, trapped, adversarial) validé")


def test_torch_world_model_and_aux_loss():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"\n--- 8. Tests du World Model auxiliaire et de la perte PPO ({device}) ---")
    from trainer.models import RecurrentActorCritic
    from trainer.ppo_trainer import PPOTrainer

    model = RecurrentActorCritic(n_in=37, n_out=106, hidden_dim=128).to(device)
    hid = model.init_hidden(4, device=device)
    acts = torch.tensor([0, 20, 84, 105], dtype=torch.long, device=device)

    preds = model.forward_aux(hid, acts)
    assert preds.shape == (4, 8), f"Shape attendue (4, 8), obtenu {preds.shape}"
    assert (preds[:, 4] >= 0.0).all(), "dt doit être >= 0"
    assert (preds[:, 7] >= 0.0).all() and (preds[:, 7] <= 1.0).all(), "p_contact dans [0, 1]"

    trainer = PPOTrainer(env_batch_size=8, rollout_len=4, c_aux=0.1, curriculum=True, device=device)
    targets = torch.rand((4, 8), device=device)
    loss = trainer.compute_aux_loss(preds, targets)
    assert loss.item() >= 0.0 and torch.isfinite(loss), "Perte auxiliaire finie"
    print("  ok  WorldModelHead (8 prédictions physiques) et perte auxiliaire validés")


def test_torch_tree_search():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"\n--- 9. Tests de la recherche arborescente GPU (AlphaZero/MCTS) ({device}) ---")
    from trainer.models import RecurrentActorCritic
    from trainer.tree_search import tree_search_plan

    env = TorchEnv(batch_size=2, device=device)
    model = RecurrentActorCritic(n_in=37, n_out=106, hidden_dim=128).to(device)
    obs = env.reset()
    hidden = model.init_hidden(2, device=device)

    # Sauvegarde pour vérifier la non-régression d'état
    t_start = env.t.clone()
    p_start = env.robot_pose.clone()

    actions = tree_search_plan(env, model, obs, hidden, depth=3, num_simulations=4)
    assert actions.shape == (2,)
    mask = env.get_mask()
    valid = mask.gather(1, actions.unsqueeze(1)).squeeze(1)
    assert valid.all(), "Toutes les actions sélectionnées par tree_search doivent être valides"

    assert (env.t == t_start).all(), "L'état de l'environnement doit être parfaitement restauré"
    assert (env.robot_pose == p_start).all(), "La pose du robot doit être restaurée"
    print("  ok  Planification arborescente GPU validée avec non-destructivité d'état stricte")


if __name__ == "__main__":
    test_torch_env_reset()
    test_torch_env_example_program()
    test_torch_rules_reinforcement()
    test_torch_staging_and_repickup()
    test_torch_wavefront_and_envelope()
    test_torch_curriculum_reset()
    test_torch_world_model_and_aux_loss()
    test_torch_tree_search()
    test_torch_env_performance_benchmark()
