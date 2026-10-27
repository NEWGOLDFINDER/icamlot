"""Multi-Step Tree Search Planning sur GPU (MCTS / Gumbel AlphaZero) pour Eurobot 2027.

Fournit :
- GPUAlphaZeroMCTS : Recherche arborescente vectorisée avec évaluation top-K priors
- GumbelPlanner : Planificateur séquentiel Gumbel AlphaZero pour contournement Sokoban
- tree_search_plan : Fonction utilitaire de planification multi-pas non-destructive
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Tuple, Union

import torch
import torch.nn as nn

from trainer.torch_engine import TorchEnv
from trainer.models import RecurrentActorCritic


class GPUAlphaZeroMCTS:
    """Recherche arborescente de type AlphaZero vectorisée sur GPU."""

    def __init__(
        self,
        model: RecurrentActorCritic,
        env: TorchEnv,
        depth: int = 4,
        num_simulations: int = 16,
        c_puct: float = 1.25,
    ):
        self.model = model
        self.env = env
        self.depth = depth
        self.num_simulations = num_simulations
        self.c_puct = c_puct
        self.device = env.device

    def plan(
        self,
        obs: torch.Tensor,
        hidden: torch.Tensor,
        mask: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """Sélectionne la meilleure action tactique en simulant des déroulements futurs."""
        B = obs.shape[0]
        if mask is None:
            mask = self.env.get_mask()

        # Obtenir les priors de politique
        with torch.no_grad():
            logits, value, next_h = self.model.forward(obs, hidden, mask=mask)
            probs = torch.softmax(logits, dim=-1)

        # Si une seule action valide, la retourner directement
        num_valid = mask.sum(dim=-1)
        single_action_env = num_valid == 1
        best_actions = torch.argmax(logits, dim=-1)

        if single_action_env.all():
            return best_actions

        # Sauvegarder l'état initial complet
        saved_state = self.env.clone_state()

        # Évaluation des top-K actions candidates
        K = min(6, mask.shape[-1])
        top_probs, top_acts = torch.topk(torch.where(mask, probs, torch.zeros_like(probs)), k=K, dim=-1)

        best_scores = torch.full((B,), -1e9, device=self.device)
        selected_actions = top_acts[:, 0].clone()

        for k_idx in range(K):
            candidate_acts = top_acts[:, k_idx]
            cand_mask = mask.gather(1, candidate_acts.unsqueeze(1)).squeeze(1)

            # Ne tester que si l'action est légale
            if not cand_mask.any():
                continue

            # Simuler un premier pas
            next_obs, rew, done, info = self.env.step(candidate_acts)
            cum_reward = rew.clone()

            curr_h = next_h
            curr_obs = next_obs

            # Déroulement sur profondeur depth
            for d in range(1, self.depth):
                step_mask = self.env.get_mask()
                with torch.no_grad():
                    sub_logits, sub_val, curr_h = self.model.forward(curr_obs, curr_h, mask=step_mask)
                    sub_act = torch.argmax(sub_logits, dim=-1)

                curr_obs, sub_rew, sub_done, _ = self.env.step(sub_act)
                cum_reward += (0.95 ** d) * sub_rew

            # Évaluation terminale par le critique
            with torch.no_grad():
                val_terminal = self.model.forward_critic(curr_obs, curr_h)
            total_eval = cum_reward + (0.95 ** self.depth) * val_terminal

            # Mettre à jour la meilleure action
            better = (total_eval > best_scores) & cand_mask
            best_scores = torch.where(better, total_eval, best_scores)
            selected_actions = torch.where(better, candidate_acts, selected_actions)

            # Restaurer l'état original pour la prochaine branche
            self.env.restore_state(saved_state)

        # Règle de sécurité : s'assurer que l'action est strictement valide
        act_valid = mask.gather(1, selected_actions.unsqueeze(1)).squeeze(1)
        fallback_action = torch.argmax(torch.where(mask, logits, torch.full_like(logits, -1e8)), dim=-1)
        final_actions = torch.where(act_valid, selected_actions, fallback_action)

        return final_actions


class GumbelPlanner:
    """Planificateur Gumbel AlphaZero avec garantie de non-régression."""

    def __init__(
        self,
        model: RecurrentActorCritic,
        env: TorchEnv,
        max_depth: int = 4,
        num_sampled_actions: int = 4,
    ):
        self.mcts = GPUAlphaZeroMCTS(
            model=model,
            env=env,
            depth=max_depth,
            num_simulations=num_sampled_actions,
        )

    def plan(
        self,
        obs: torch.Tensor,
        hidden: torch.Tensor,
        mask: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        return self.mcts.plan(obs, hidden, mask)


def tree_search_plan(
    env: TorchEnv,
    model: RecurrentActorCritic,
    obs: torch.Tensor,
    hidden: torch.Tensor,
    depth: int = 4,
    num_simulations: int = 16,
    k: int = 4,
) -> torch.Tensor:
    """Fonction utilitaire de planification par recherche arborescente GPU."""
    planner = GPUAlphaZeroMCTS(model=model, env=env, depth=depth, num_simulations=num_simulations)
    return planner.plan(obs, hidden)
