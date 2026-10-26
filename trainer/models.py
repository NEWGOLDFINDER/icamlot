"""Architectures de réseaux de neurones pour ICAM LOT Eurobot 2027.

Comprend :
- RecurrentActorCritic : Réseau récurrent (GRU) avec tête Acteur (politique 106 actions)
  et tête Critique (estimation de valeur du match), idéal pour PPO sur GPU.
- Pi5ActorWrapper : Wrapper d'inférence ultra-léger exportable en ONNX
  conçu spécifiquement pour une exécution en < 0.2 ms sur Raspberry Pi 5.
"""
from __future__ import annotations

import torch
import torch.nn as nn
from typing import Optional, Tuple


class RecurrentActorCritic(nn.Module):
    """Réseau Acteur-Critique récurrent (GRU) pour l'apprentissage par renforcement (PPO)."""

    def __init__(self, n_in: int = 37, n_out: int = 106, hidden_dim: int = 64):
        super().__init__()
        self.n_in = n_in
        self.n_out = n_out
        self.hidden_dim = hidden_dim

        # Encodeur de perception
        self.encoder = nn.Sequential(
            nn.Linear(n_in, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU(),
        )

        # Mémoire temporelle récurrente (GRU)
        self.gru = nn.GRUCell(hidden_dim, hidden_dim)

        # Tête Acteur (Politique pi(a|s))
        self.actor = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, n_out),
        )

        # Tête Critique (Fonction de valeur V(s))
        self.critic = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, 1),
        )

    def init_hidden(self, batch_size: int, device: Optional[torch.device] = None) -> torch.Tensor:
        """Initialise l'état caché récurrent (mémoire vide au début du match)."""
        if device is None:
            device = next(self.parameters()).device
        return torch.zeros((batch_size, self.hidden_dim), dtype=torch.float32, device=device)

    def forward(
        self,
        obs: torch.Tensor,
        hidden: torch.Tensor,
        mask: Optional[torch.Tensor] = None,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Passe avant : calcule les logits d'action, la valeur d'état et le nouvel état caché."""
        feat = self.encoder(obs)
        next_hidden = self.gru(feat, hidden)

        logits = self.actor(next_hidden)
        if mask is not None:
            # Masquer strictement les actions interdites
            logits = torch.where(mask, logits, torch.full_like(logits, -1e8))

        value = self.critic(next_hidden).squeeze(-1)
        return logits, value, next_hidden

    def get_action_and_value(
        self,
        obs: torch.Tensor,
        hidden: torch.Tensor,
        mask: Optional[torch.Tensor] = None,
        action: Optional[torch.Tensor] = None,
        deterministic: bool = False,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """Échantillonne une action selon la distribution de probabilité et évalue sa log-probabilité."""
        logits, value, next_hidden = self.forward(obs, hidden, mask)
        dist = torch.distributions.Categorical(logits=logits)

        if action is None:
            if deterministic:
                action = torch.argmax(logits, dim=-1)
            else:
                action = dist.sample()

        log_prob = dist.log_prob(action)
        entropy = dist.entropy()
        return action, log_prob, entropy, value, next_hidden


class Pi5ActorWrapper(nn.Module):
    """Wrapper d'inférence pure pour l'export ONNX vers Raspberry Pi 5.

    Ne conserve que l'encodeur, le GRU et l'Acteur (pas de critique).
    Inférence ultra-légère (< 0.15 ms sur Cortex-A76).
    """

    def __init__(self, model: RecurrentActorCritic):
        super().__init__()
        self.encoder = model.encoder
        self.gru = model.gru
        self.actor = model.actor

    def forward(self, obs: torch.Tensor, hidden: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """Renvoie (logits, next_hidden) pour entrée (obs, hidden)."""
        feat = self.encoder(obs)
        next_hidden = self.gru(feat, hidden)
        logits = self.actor(next_hidden)
        return logits, next_hidden
