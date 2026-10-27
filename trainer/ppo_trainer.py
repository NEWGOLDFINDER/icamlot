"""Entraîneur PPO (Proximal Policy Optimization) récurrent pour ICAM LOT Eurobot 2027.

Entraîne un réseau RecurrentActorCritic (GRU + MLP) 100% sur GPU avec TorchEnv,
puis exporte automatiquement le cerveau champion au format ONNX optimisé pour Raspberry Pi 5.
"""
from __future__ import annotations

import argparse
import math
import sys
import os

# Forcer stdout/stderr en mode unbuffered et UTF-8
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)
    except Exception:
        pass
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
TRAINER_DIR = Path(__file__).resolve().parent
while str(TRAINER_DIR) in sys.path:
    sys.path.remove(str(TRAINER_DIR))
if str(ROOT) in sys.path:
    sys.path.remove(str(ROOT))
sys.path.insert(0, str(ROOT))

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim

from trainer.torch_engine import TorchEnv, MATCH_DURATION
from trainer.models import RecurrentActorCritic
from trainer.export_onnx import export_pi5_onnx

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


class PPOTrainer:
    """Gestionnaire d'entraînement PPO récurrent avec TorchEnv sur GPU."""

    def __init__(
        self,
        env_batch_size: int = 256,
        rollout_len: int = 32,
        hidden_dim: int = 128,
        lr: float = 3e-4,
        gamma: float = 0.99,
        gae_lambda: float = 0.95,
        clip_coef: float = 0.2,
        ent_coef: float = 0.01,
        vf_coef: float = 0.5,
        max_grad_norm: float = 0.5,
        ppo_epochs: int = 4,
        num_minibatches: int = 4,
        c_aux: float = 0.1,
        curriculum: bool = False,
        device: Optional[torch.device] = None,
    ):
        self.device = device or DEVICE
        self.batch_size = env_batch_size
        self.rollout_len = rollout_len
        self.hidden_dim = hidden_dim
        self.lr = lr
        self.gamma = gamma
        self.gae_lambda = gae_lambda
        self.clip_coef = clip_coef
        self.ent_coef = ent_coef
        self.vf_coef = vf_coef
        self.max_grad_norm = max_grad_norm
        self.ppo_epochs = ppo_epochs
        self.num_minibatches = num_minibatches
        self.c_aux = c_aux
        self.use_curriculum = curriculum
        self.aux_targets_buf = []

        # Environnement d'entraînement sur GPU
        self.env = TorchEnv(batch_size=self.batch_size, device=self.device)

        # Modèle Acteur-Critique récurrent
        self.model = RecurrentActorCritic(
            n_in=self.env.n_in,
            n_out=self.env.n_out,
            hidden_dim=self.hidden_dim,
        ).to(self.device)

        self.optimizer = optim.Adam(self.model.parameters(), lr=self.lr, eps=1e-5)

        # Suivi des scores réels des matchs terminés
        self.finished_scores: List[float] = []
        self.finished_errors: List[int] = []

    @staticmethod
    def compute_multihead_loss(
        new_logprob: torch.Tensor,
        old_logprob: torch.Tensor,
        advantages: torch.Tensor,
        clip_coef: float = 0.2,
    ) -> torch.Tensor:
        """Calcule la perte surrogate clippée PPO pour politique conjointe multi-têtes."""
        log_ratio = new_logprob - old_logprob
        ratio = torch.exp(log_ratio)
        surr1 = ratio * advantages
        surr2 = torch.clamp(ratio, 1.0 - clip_coef, 1.0 + clip_coef) * advantages
        return -torch.min(surr1, surr2).mean()

    @staticmethod
    def joint_policy_loss(
        new_logprob: torch.Tensor,
        old_logprob: torch.Tensor,
        advantages: torch.Tensor,
        clip_coef: float = 0.2,
    ) -> torch.Tensor:
        """Alias pour le calcul de la perte de politique conjointe multi-têtes."""
        return PPOTrainer.compute_multihead_loss(new_logprob, old_logprob, advantages, clip_coef)

    @staticmethod
    def multihead_entropy(
        primary_logits: torch.Tensor,
        approach_logits: torch.Tensor,
        folding_logits: torch.Tensor,
    ) -> torch.Tensor:
        """Calcule l'entropie multi-têtes cumulée sur les 3 têtes d'action."""
        ent_prim = torch.distributions.Categorical(logits=primary_logits).entropy()
        ent_app = torch.distributions.Categorical(logits=approach_logits).entropy()
        ent_fold = torch.distributions.Categorical(logits=folding_logits).entropy()
        return ent_prim + ent_app + ent_fold

    def compute_aux_loss(self, aux_preds: torch.Tensor, aux_targets: torch.Tensor) -> torch.Tensor:
        """Calcule la perte auxiliaire multi-tâche (MSE sur cinématique/enveloppe + BCE sur contact)."""
        mse_loss = nn.functional.mse_loss(aux_preds[:, 0:7], aux_targets[:, 0:7])
        bce_loss = nn.functional.binary_cross_entropy(
            torch.clamp(aux_preds[:, 7], min=1e-6, max=1.0 - 1e-6),
            aux_targets[:, 7]
        )
        return mse_loss + bce_loss

    def pretrain_imitation(self, epochs: int = 150, lr: float = 1e-3) -> None:
        """Pré-entraîne le réseau récurrent par imitation du programme champion Eurobot."""
        print(f"--- Pré-entraînement par imitation (initialisation stratégique GRU) ---")
        example_actions = [0, 18, 20, 32, 4, 19, 28, 36, 3, 86, 69, 98, 84, 105]

        # Simuler un épisode pour enregistrer la trajectoire de référence
        B = 64
        env = TorchEnv(batch_size=B, device=self.device)
        obs_seq = []
        mask_seq = []
        act_seq = []

        obs = env.reset()
        for act_idx in example_actions:
            obs_seq.append(obs.clone())
            mask = env.get_live_mask()
            mask_seq.append(mask.clone())
            act = torch.full((B,), act_idx, dtype=torch.long, device=self.device)
            act_seq.append(act)
            obs, _, _, _ = env.step(act)

        T = len(example_actions)
        opt = optim.Adam(self.model.parameters(), lr=lr)
        criterion_ce = nn.CrossEntropyLoss()
        criterion_mse = nn.MSELoss()

        self.model.train()
        for ep in range(1, epochs + 1):
            hidden = self.model.init_hidden(B, device=self.device)
            total_loss = 0.0

            for t in range(T):
                t_obs = obs_seq[t]
                t_mask = mask_seq[t]
                t_act = act_seq[t]

                logits, val, hidden = self.model(t_obs, hidden, mask=t_mask)
                loss_ce = criterion_ce(logits, t_act)
                loss_v = criterion_mse(val, torch.full_like(val, 105.0))
                loss = loss_ce + 0.01 * loss_v

                total_loss += loss

            opt.zero_grad()
            total_loss.backward()
            opt.step()

            if ep % 50 == 0 or ep == epochs:
                print(f"  [Imitation Ep {ep:3d}/{epochs}] Perte moyenne : {total_loss.item() / T:.4f}")

        print("  ok  Mémoire temporelle GRU initialisée avec succès.")

    def collect_rollouts(
        self,
        current_obs: Optional[torch.Tensor] = None,
        current_hidden: Optional[torch.Tensor] = None,
        current_done: Optional[torch.Tensor] = None,
    ) -> Tuple[dict, torch.Tensor, torch.Tensor, torch.Tensor]:
        """Collecte un buffer de transitions (T, B) en faisant progresser le batch sur GPU."""
        T = self.rollout_len
        B = self.batch_size
        D = self.device

        if current_obs is None:
            current_obs = self.env.get_obs()
        if current_hidden is None:
            current_hidden = self.model.init_hidden(B, device=D)
        if current_done is None:
            current_done = torch.zeros(B, dtype=torch.bool, device=D)

        # Buffers de stockage multi-têtes
        obs_buf = torch.zeros((T, B, self.env.n_in), dtype=torch.float32, device=D)
        mask_buf = torch.zeros((T, B, self.env.n_out), dtype=torch.bool, device=D)
        primary_actions_buf = torch.zeros((T, B), dtype=torch.long, device=D)
        approach_actions_buf = torch.zeros((T, B), dtype=torch.long, device=D)
        folding_actions_buf = torch.zeros((T, B), dtype=torch.long, device=D)
        logprobs_buf = torch.zeros((T, B), dtype=torch.float32, device=D)
        rewards_buf = torch.zeros((T, B), dtype=torch.float32, device=D)
        dones_buf = torch.zeros((T, B), dtype=torch.bool, device=D)
        values_buf = torch.zeros((T, B), dtype=torch.float32, device=D)
        hiddens_buf = torch.zeros((T, B, self.hidden_dim), dtype=torch.float32, device=D)
        aux_targets_buf = torch.zeros((T, B, 8), dtype=torch.float32, device=D)

        obs = current_obs
        hidden = current_hidden
        done = current_done

        prev_scores = self.env.score.clone()
        prev_errors = self.env.errors.clone()

        for step in range(T):
            # Si un env est done, on reset son hidden state
            hidden = torch.where(done.unsqueeze(1), torch.zeros_like(hidden), hidden)

            # Auto-reset des environnements terminés
            if done.any():
                done_idx = torch.where(done)[0]
                # Enregistrer le score final du match
                final_sc = self.env.score[done_idx].cpu().tolist()
                final_err = self.env.errors[done_idx].cpu().tolist()
                self.finished_scores.extend(final_sc)
                self.finished_errors.extend(final_err)

                # Reset des environnements terminés avec support curriculum
                self.env.reset(curriculum=self.use_curriculum, indices=done_idx)
                prev_scores[done_idx] = self.env.score[done_idx]
                prev_errors[done_idx] = self.env.errors[done_idx]

                obs = self.env.get_obs()

            live_mask = self.env.get_live_mask()

            obs_buf[step] = obs
            mask_buf[step] = live_mask
            dones_buf[step] = done
            hiddens_buf[step] = hidden

            with torch.no_grad():
                action, logprob, _, value, next_hidden = self.model.get_action_and_value(
                    obs, hidden, mask=live_mask
                )

            if isinstance(action, (tuple, list)):
                a_prim, a_app, a_fold = action[0], action[1], action[2]
            else:
                a_prim = action
                a_app = torch.zeros_like(action)
                a_fold = torch.zeros_like(action)

            primary_actions_buf[step] = a_prim
            approach_actions_buf[step] = a_app
            folding_actions_buf[step] = a_fold
            logprobs_buf[step] = logprob
            values_buf[step] = value

            # Transition dans l'environnement GPU
            next_obs, _, next_done, info = self.env.step(action)

            # Enregistrer les cibles d'entraînement du World Model auxiliaire (8 variables)
            rx_norm = self.env.robot_pose[:, 0] / 3000.0
            ry_norm = self.env.robot_pose[:, 1] / 2000.0
            rad = self.env.robot_pose[:, 2] * (math.pi / 180.0)
            rcos = torch.cos(rad)
            rsin = torch.sin(rad)
            dt_step = info["dt"] / 10.0
            env_L = info["envelope"][:, 0] / 300.0
            env_W = info["envelope"][:, 1] / 300.0
            contact = info["contact"]
            aux_targets_buf[step] = torch.stack([rx_norm, ry_norm, rcos, rsin, dt_step, env_L, env_W, contact], dim=-1)

            # Calcul de la récompense mise en forme :
            # 1. Delta score Eurobot
            sc_diff = self.env.score - prev_scores
            # 2. Pénalité stricte par erreur / collision (-15 pts par collision de caisse ou adversaire)
            err_diff = (self.env.errors - prev_errors).float()
            # 3. Récompense totale
            step_reward = sc_diff - 15.0 * err_diff

            # Bonus terminal de match réussi sans fautes
            throne_bonus = torch.where(
                next_done & (self.env.errors == 0) & (self.env.score >= 50.0) & (self.env.robot_pose[:, 0] <= 500.0) & (self.env.robot_pose[:, 1] >= 750.0) & (self.env.robot_pose[:, 1] <= 1250.0),
                torch.full_like(step_reward, 10.0),
                torch.zeros_like(step_reward),
            )
            step_reward += throne_bonus

            rewards_buf[step] = step_reward

            prev_scores = self.env.score.clone()
            prev_errors = self.env.errors.clone()
            obs = next_obs
            hidden = next_hidden
            done = next_done

        # Estimation de la valeur terminale pour GAE
        with torch.no_grad():
            last_mask = self.env.get_live_mask()
            last_hidden = torch.where(done.unsqueeze(1), torch.zeros_like(hidden), hidden)
            _, last_value, _ = self.model(obs, last_hidden, last_mask)

            # Calcul des avantages GAE
            advantages = torch.zeros_like(rewards_buf)
            lastgaelam = 0.0
            for t in reversed(range(T)):
                if t == T - 1:
                    nextnonterminal = (~done).float()
                    nextvalues = last_value
                else:
                    nextnonterminal = (~dones_buf[t + 1]).float()
                    nextvalues = values_buf[t + 1]

                delta = rewards_buf[t] + self.gamma * nextvalues * nextnonterminal - values_buf[t]
                advantages[t] = lastgaelam = delta + self.gamma * self.gae_lambda * nextnonterminal * lastgaelam

            returns = advantages + values_buf

        rollout_data = {
            "obs": obs_buf,
            "mask": mask_buf,
            "primary_actions": primary_actions_buf,
            "approach_actions": approach_actions_buf,
            "folding_actions": folding_actions_buf,
            "actions": primary_actions_buf,
            "logprobs": logprobs_buf,
            "rewards": rewards_buf,
            "dones": dones_buf,
            "values": values_buf,
            "advantages": advantages,
            "returns": returns,
            "initial_hiddens": hiddens_buf[0],  # État caché au début du rollout pour chaque env
            "aux_targets": aux_targets_buf,
        }
        self.aux_targets_buf = aux_targets_buf

        return rollout_data, obs, hidden, done

    collect_rollout = collect_rollouts

    def train_step(self, rollout_data: dict) -> dict:
        """Effectue les époques d'optimisation PPO récurrentes sur les données du rollout."""
        T = self.rollout_len
        B = self.batch_size
        env_batch_size = B // self.num_minibatches

        obs_buf = rollout_data["obs"]                  # (T, B, n_in)
        mask_buf = rollout_data["mask"]                # (T, B, n_out)
        primary_actions_buf = rollout_data.get("primary_actions", rollout_data.get("actions"))
        approach_actions_buf = rollout_data.get("approach_actions", torch.zeros_like(primary_actions_buf))
        folding_actions_buf = rollout_data.get("folding_actions", torch.zeros_like(primary_actions_buf))
        logprobs_buf = rollout_data["logprobs"]        # (T, B)
        advantages_buf = rollout_data["advantages"]    # (T, B)
        returns_buf = rollout_data["returns"]          # (T, B)
        dones_buf = rollout_data["dones"]              # (T, B)
        init_hiddens = rollout_data["initial_hiddens"] # (B, hidden_dim)

        # Normalisation des avantages sur l'ensemble du rollout
        adv_flat = advantages_buf.view(-1)
        adv_mean = adv_flat.mean()
        adv_std = adv_flat.std() + 1e-8
        norm_adv_buf = (advantages_buf - adv_mean) / adv_std

        total_pg_loss = 0.0
        total_v_loss = 0.0
        total_ent_loss = 0.0
        total_aux_loss = 0.0
        n_updates = 0

        for epoch in range(self.ppo_epochs):
            # Permutation aléatoire des indices d'environnements
            env_indices = torch.randperm(B, device=self.device)

            for mb in range(self.num_minibatches):
                mb_env_idx = env_indices[mb * env_batch_size : (mb + 1) * env_batch_size]

                # Déroulement séquentiel récurrent pour ce minibatch d'environnements
                mb_hidden = init_hiddens[mb_env_idx].clone()

                mb_new_logprobs = []
                mb_entropies = []
                mb_new_values = []
                mb_aux_preds = []

                for t in range(T):
                    t_done = dones_buf[t, mb_env_idx]
                    mb_hidden = torch.where(t_done.unsqueeze(1), torch.zeros_like(mb_hidden), mb_hidden)

                    t_obs = obs_buf[t, mb_env_idx]
                    t_mask = mask_buf[t, mb_env_idx]
                    t_act_prim = primary_actions_buf[t, mb_env_idx]
                    t_act_app = approach_actions_buf[t, mb_env_idx]
                    t_act_fold = folding_actions_buf[t, mb_env_idx]
                    t_act = (t_act_prim, t_act_app, t_act_fold)

                    _, new_lp, ent, val, next_mb_hidden = self.model.get_action_and_value(
                        t_obs, mb_hidden, mask=t_mask, action=t_act
                    )

                    # Prédiction auxiliaire conditionnée par l'état caché et l'action primaire
                    if self.c_aux > 0.0 and "aux_targets" in rollout_data:
                        pred_aux = self.model.forward_aux(mb_hidden, t_act_prim)
                        mb_aux_preds.append(pred_aux)

                    mb_hidden = next_mb_hidden
                    mb_new_logprobs.append(new_lp)
                    mb_entropies.append(ent)
                    mb_new_values.append(val)

                new_logprob = torch.stack(mb_new_logprobs, dim=0) # (T, mb_B)
                entropy = torch.stack(mb_entropies, dim=0)         # (T, mb_B)
                new_value = torch.stack(mb_new_values, dim=0)       # (T, mb_B)

                old_logprob = logprobs_buf[:, mb_env_idx]
                mb_adv = norm_adv_buf[:, mb_env_idx]
                mb_ret = returns_buf[:, mb_env_idx]

                # 1. Perte de politique (surrogate objectif clippé PPO multi-têtes)
                pg_loss = self.compute_multihead_loss(new_logprob, old_logprob, mb_adv, self.clip_coef)

                # 2. Perte de valeur (fonction de valeur du Critique)
                v_loss = 0.5 * ((new_value - mb_ret) ** 2).mean()

                # 3. Perte d'entropie (exploration)
                ent_loss = entropy.mean()

                # 4. Perte auxiliaire World-Model (MSE + BCE)
                if self.c_aux > 0.0 and len(mb_aux_preds) > 0:
                    all_aux_preds = torch.stack(mb_aux_preds, dim=0).view(-1, 8)
                    all_aux_targets = rollout_data["aux_targets"][:, mb_env_idx].reshape(-1, 8)
                    aux_loss = self.compute_aux_loss(all_aux_preds, all_aux_targets)
                else:
                    aux_loss = torch.tensor(0.0, device=self.device)

                # Perte globale
                loss = pg_loss + self.vf_coef * v_loss - self.ent_coef * ent_loss + self.c_aux * aux_loss

                self.optimizer.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(self.model.parameters(), self.max_grad_norm)
                self.optimizer.step()

                total_pg_loss += pg_loss.item()
                total_v_loss += v_loss.item()
                total_ent_loss += ent_loss.item()
                total_aux_loss += aux_loss.item()
                n_updates += 1

        return {
            "pg_loss": total_pg_loss / max(n_updates, 1),
            "v_loss": total_v_loss / max(n_updates, 1),
            "entropy": total_ent_loss / max(n_updates, 1),
            "aux_loss": total_aux_loss / max(n_updates, 1),
        }

    def evaluate_greedy(self, num_episodes: int = 128) -> dict:
        """Évalue la politique en mode déterministe (greedy) sur plusieurs matchs complets."""
        self.model.eval()
        eval_env = TorchEnv(batch_size=num_episodes, device=self.device)
        obs = eval_env.reset()
        hidden = self.model.init_hidden(num_episodes, device=self.device)

        with torch.no_grad():
            for _ in range(50):
                if eval_env.done.all():
                    break
                live_mask = eval_env.get_live_mask()
                action, _, _, _, next_hidden = self.model.get_action_and_value(
                    obs, hidden, mask=live_mask, deterministic=True
                )
                obs, _, dones, _ = eval_env.step(action)
                hidden = torch.where(dones.unsqueeze(1), torch.zeros_like(hidden), next_hidden)

        eval_env.t = torch.maximum(eval_env.t, torch.full_like(eval_env.t, MATCH_DURATION))
        eval_env.done.fill_(True)
        final_scores = eval_env.compute_score().cpu().numpy()
        errors = eval_env.errors.cpu().numpy()

        self.model.train()
        return {
            "mean_score": float(np.mean(final_scores)),
            "max_score": float(np.max(final_scores)),
            "min_score": float(np.min(final_scores)),
            "std_score": float(np.std(final_scores)),
            "mean_errors": float(np.mean(errors)),
        }

    def train(
        self,
        total_steps: int = 200_000,
        eval_every_rollouts: int = 10,
        save_path_pt: str = ".data/weights/ppo_best.pt",
        save_path_onnx: str = ".data/weights/best_brain_pi5.onnx",
    ):
        """Boucle principale d'entraînement PPO sur GPU."""
        print(f"=== Démarrage Entraînement PPO Eurobot 2027 ===")
        print(f"  Périphérique : {self.device}")
        print(f"  Envs parallèles : {self.batch_size}")
        print(f"  Longueur rollout : {self.rollout_len} pas ({self.batch_size * self.rollout_len:,} transitions / rollout)")
        print(f"  Objectif étapes : {total_steps:,}")

        Path(save_path_pt).parent.mkdir(parents=True, exist_ok=True)
        Path(save_path_onnx).parent.mkdir(parents=True, exist_ok=True)

        current_obs = self.env.reset(curriculum=self.use_curriculum)
        current_hidden = self.model.init_hidden(self.batch_size, device=self.device)
        current_done = torch.zeros(self.batch_size, dtype=torch.bool, device=self.device)

        transitions_per_rollout = self.batch_size * self.rollout_len
        num_rollouts = math.ceil(total_steps / transitions_per_rollout)

        best_score = -float("inf")
        best_effective = -float("inf")
        start_time = time.perf_counter()
        total_transitions_done = 0

        for r in range(1, num_rollouts + 1):
            t0 = time.perf_counter()

            # 1. Collecte des transitions
            rollout_data, current_obs, current_hidden, current_done = self.collect_rollouts(
                current_obs, current_hidden, current_done
            )

            # 2. Mise à jour PPO
            metrics = self.train_step(rollout_data)

            total_transitions_done += transitions_per_rollout
            elapsed = time.perf_counter() - start_time
            sps = int(total_transitions_done / elapsed)

            # 3. Log régulier
            recent_scores = self.finished_scores[-100:] if self.finished_scores else [0.0]
            avg_sc = np.mean(recent_scores)

            print(
                f"[Rollout {r:3d}/{num_rollouts}] Steps: {total_transitions_done:7,d} | "
                f"SPS: {sps:,} | PG Loss: {metrics['pg_loss']:+.3f} | "
                f"V Loss: {metrics['v_loss']:.3f} | Ent: {metrics['entropy']:.2f} | "
                f"Train Score 100: {avg_sc:.1f} pts"
            )

            # 4. Évaluation greedy périodique
            if r % eval_every_rollouts == 0 or r == num_rollouts:
                eval_res = self.evaluate_greedy(num_episodes=128)
                effective_score = eval_res["mean_score"] - 15.0 * eval_res["mean_errors"]
                print(
                    f"  >>> EVAL GREEDY : Score Moyen = {eval_res['mean_score']:.1f} pts "
                    f"(Max = {eval_res['max_score']:.1f} pts, Min = {eval_res['min_score']:.1f} pts) | "
                    f"Erreurs = {eval_res['mean_errors']:.2f} | Score effectif = {effective_score:.1f}"
                )

                if effective_score > best_effective:
                    best_effective = effective_score
                    best_score = eval_res["mean_score"]
                    print(f"  [+] Nouveau record retenu (Score: {best_score:.1f} pts, Err: {eval_res['mean_errors']:.2f}) ! Sauvegarde...")

                    # Sauvegarde PyTorch
                    torch.save({
                        "model_state": self.model.state_dict(),
                        "score": best_score,
                        "step": total_transitions_done,
                    }, save_path_pt)

                    # Export automatique ONNX pour Pi 5
                    export_pi5_onnx(self.model, save_path_onnx, hidden_dim=self.hidden_dim)

        print(f"\nEntraînement terminé en {time.perf_counter() - start_time:.1f} s.")
        print(f"Meilleur score validé : {best_score:.1f} pts")
        print(f"Modèle PyTorch : {save_path_pt}")
        print(f"Modèle ONNX pour Raspberry Pi 5 : {save_path_onnx}")


def main():
    parser = argparse.ArgumentParser(description="Entraînement PPO récurrent GPU pour Eurobot 2027")
    parser.add_argument("--steps", type=int, default=150_000, help="Nombre total de transitions")
    parser.add_argument("--batch-size", type=int, default=256, help="Taille du batch d'environnements parallèles")
    parser.add_argument("--rollout-len", type=int, default=32, help="Longueur d'un rollout par env")
    parser.add_argument("--lr", type=float, default=3e-4, help="Taux d'apprentissage")
    parser.add_argument("--hidden-dim", type=int, default=128, help="Dimension de la mémoire GRU (défaut: 128)")
    parser.add_argument("--eval-every", type=int, default=5, help="Fréquence d'évaluation (en rollouts)")
    parser.add_argument("--pretrain-imitation", action="store_true", default=True, help="Pré-entraîner par imitation avant PPO")
    parser.add_argument("--no-imitation", dest="pretrain_imitation", action="store_false", help="Désactiver le pré-entraînement par imitation")
    parser.add_argument("--out-pt", type=str, default=".data/weights/ppo_best.pt", help="Fichier de sortie .pt")
    parser.add_argument("--out-onnx", type=str, default=".data/weights/best_brain_pi5.onnx", help="Fichier de sortie .onnx")
    args = parser.parse_args()

    trainer = PPOTrainer(
        env_batch_size=args.batch_size,
        rollout_len=args.rollout_len,
        hidden_dim=args.hidden_dim,
        lr=args.lr,
    )

    if args.pretrain_imitation:
        trainer.pretrain_imitation(epochs=150)

    trainer.train(
        total_steps=args.steps,
        eval_every_rollouts=args.eval_every,
        save_path_pt=args.out_pt,
        save_path_onnx=args.out_onnx,
    )


compute_multihead_loss = PPOTrainer.compute_multihead_loss
joint_policy_loss = PPOTrainer.joint_policy_loss
multihead_entropy = PPOTrainer.multihead_entropy


if __name__ == "__main__":
    main()
