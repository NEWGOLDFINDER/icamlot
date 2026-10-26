"""Architectures de réseaux de neurones V2 haute performance pour ICAM LOT Eurobot 2027.

Comprend :
- FactorizedEncoder : Encodeur multi-branches spécialisé séparant :
    1. Branche Géométrique continue (pose robot + lidar adverse : 6 entrées)
    2. Branche Terrain & Scoring (paquets + murs + tours + graal : 23 entrées)
    3. Branche Actionneurs & Temps (temps restant + pinces A/B + boulets : 8 entrées)
    4. Fusion par normalisation LayerNorm et activation SiLU (Swish).
- RecurrentActorCritic : Réseau récurrent (GRU 128) avec connexions résiduelles (ResNet)
    sur l'Acteur (politique 106 actions) et le Critique (valeur V(s)).
- Pi5ActorWrapper : Wrapper d'inférence pure exportable en ONNX (~620 Ko),
    exécutable en ~42 µs sur processeur Cortex-A76 (Raspberry Pi 5).
"""
from __future__ import annotations

import torch
import torch.nn as nn
from typing import Optional, Tuple


class FactorizedEncoder(nn.Module):
    """Encodeur multi-branches séparant la géométrie, la table et les actionneurs."""

    def __init__(self, n_in: int = 37, hidden_dim: int = 128):
        super().__init__()
        self.n_in = n_in
        self.hidden_dim = hidden_dim

        if n_in == 37:
            # 1. Branche géométrie continue : pose robot (4) + Lidar adverse (2)
            self.geo_mlp = nn.Sequential(
                nn.Linear(6, 32),
                nn.SiLU(),
            )
            # 2. Branche terrain & châteaux : 10 paquets (10) + 5 murs + 4 tours + 4 graal (13) = 23
            self.table_mlp = nn.Sequential(
                nn.Linear(23, 64),
                nn.SiLU(),
            )
            # 3. Branche mécanique & horloge : temps restant (1) + pinces A/B (6) + boulets (1) = 8
            self.mech_mlp = nn.Sequential(
                nn.Linear(8, 32),
                nn.SiLU(),
            )
            # 4. Fusion avec projection et normalisation
            self.fusion = nn.Sequential(
                nn.Linear(32 + 64 + 32, hidden_dim),
                nn.LayerNorm(hidden_dim),
                nn.SiLU(),
            )
        else:
            # Fallback générique si dimension différente
            self.generic = nn.Sequential(
                nn.Linear(n_in, hidden_dim),
                nn.LayerNorm(hidden_dim),
                nn.SiLU(),
            )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if self.n_in == 37:
            # x shape: (B, 37)
            # Géométrie: robot (1..5) + adversaire (35..37)
            geo = torch.cat([x[:, 1:5], x[:, 35:37]], dim=1)
            # Table: 10 paquets (5..15) + murs (21..26) + tours (26..30) + graal (30..34)
            table = torch.cat([x[:, 5:15], x[:, 21:34]], dim=1)
            # Mécanique: temps restant (0) + pinces A/B (15..21) + boulets (34)
            mech = torch.cat([x[:, 0:1], x[:, 15:21], x[:, 34:35]], dim=1)

            g_feat = self.geo_mlp(geo)
            t_feat = self.table_mlp(table)
            m_feat = self.mech_mlp(mech)

            concat_feat = torch.cat([g_feat, t_feat, m_feat], dim=1)
            return self.fusion(concat_feat)

        return self.generic(x)


class RecurrentActorCritic(nn.Module):
    """Réseau Acteur-Critique récurrent (GRU 128) optimisé avec connexions résiduelles."""

    def __init__(self, n_in: int = 37, n_out: int = 106, hidden_dim: int = 128):
        super().__init__()
        self.n_in = n_in
        self.n_out = n_out
        self.hidden_dim = hidden_dim

        # 1. Encodeur factorisé
        self.encoder = FactorizedEncoder(n_in=n_in, hidden_dim=hidden_dim)

        # 2. Mémoire récurrente temporelle (GRU 128)
        self.gru = nn.GRUCell(hidden_dim, hidden_dim)

        # 3. Tête Acteur avec connexion résiduelle
        self.actor_dense = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.SiLU(),
        )
        self.actor_out = nn.Linear(hidden_dim, n_out)

        # 4. Tête Critique (valeur V(s)) avec connexion résiduelle
        self.critic_dense = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.SiLU(),
        )
        self.critic_out = nn.Linear(hidden_dim, 1)

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

        # Tête Acteur résiduelle
        h_act = next_hidden + self.actor_dense(next_hidden)
        logits = self.actor_out(h_act)

        if mask is not None:
            # Masquer strictement les actions interdites
            logits = torch.where(mask, logits, torch.full_like(logits, -1e8))

        # Tête Critique résiduelle
        h_crit = next_hidden + self.critic_dense(next_hidden)
        value = self.critic_out(h_crit).squeeze(-1)

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

    Ne conserve que l'encodeur factorisé, le GRU 128 et l'Acteur résiduel.
    Inférence ultra-légère (~42 µs sur processeur Cortex-A76).
    """

    def __init__(self, model: RecurrentActorCritic):
        super().__init__()
        self.encoder = model.encoder
        self.gru = model.gru
        self.actor_dense = model.actor_dense
        self.actor_out = model.actor_out

    def forward(self, obs: torch.Tensor, hidden: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """Renvoie (logits, next_hidden) pour entrée (obs, hidden)."""
        feat = self.encoder(obs)
        next_hidden = self.gru(feat, hidden)
        h_act = next_hidden + self.actor_dense(next_hidden)
        logits = self.actor_out(h_act)
        return logits, next_hidden
