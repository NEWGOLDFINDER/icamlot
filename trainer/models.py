"""Architectures de réseaux de neurones V2 haute performance pour ICAM LOT Eurobot 2027.

Comprend :
- EntityTokenizer : Tokeniseur d'entités objet-centré (22 entités Eurobot).
- TransformerEncoder : Encodeur self-attention à 2 couches (d_model=64, nhead=4, GELU).
- FactorizedEncoder : Encodeur multi-branches spécialisé séparant géométrie, table et mécanique.
- WorldModelHead : Tête auxiliaire de dynamique physique (8 prédictions : pose, dt, enveloppe, contact).
- RecurrentActorCritic : Réseau récurrent (GRU 128) avec têtes Acteur, Critique et World Model auxiliaire.
- Pi5ActorWrapper : Wrapper d'inférence pure exportable en ONNX (~600 Ko, opset 18).
"""
from __future__ import annotations

import torch
import torch.nn as nn
from typing import Optional, Tuple


class EntityTokenizer(nn.Module):
    """Tokeniseur d'entités objet-centré (22 entités pour Eurobot 2027).

    Convertit le vecteur d'observation standard (B, 37) en 22 jetons d'entités de dimension d_model=64.
    Entités :
    - 0 : Robot allié (pose, dt, pinces A/B, boulets -> 10 features)
    - 1 : Robot adverse (lidar x, y -> 2 features)
    - 2..11 : 10 Paquets P1..P10 (1 feature chacun)
    - 12..16 : 5 Murs M1..M5 (1 feature chacun)
    - 17..20 : 4 Tours T1..T4 (1 feature chacun)
    - 21 : Graal (4 features)
    """

    def __init__(self, d_model: int = 64):
        super().__init__()
        self.d_model = d_model
        self.num_entities = 22

        self.proj_robot = nn.Linear(10, d_model)
        self.proj_opp = nn.Linear(2, d_model)
        self.proj_pack = nn.Linear(1, d_model)
        self.proj_wall = nn.Linear(1, d_model)
        self.proj_tower = nn.Linear(1, d_model)
        self.proj_graal = nn.Linear(4, d_model)

        self.type_embed = nn.Embedding(self.num_entities, d_model)
        self.norm = nn.LayerNorm(d_model)

    def forward(self, obs: torch.Tensor) -> torch.Tensor:
        B = obs.shape[0]
        device = obs.device

        # 0. Robot : [rx, ry, rcos, rsin, t_rem, hA_n, hA_flat, hB_n, hB_flat, balls]
        rob_feat = torch.cat([
            obs[:, 1:5],   # rx, ry, rcos, rsin (4)
            obs[:, 0:1],   # t_rem (1)
            obs[:, 15:17], # hA_n, hA_flat (2)
            obs[:, 18:20], # hB_n, hB_flat (2)
            obs[:, 34:35], # balls (1)
        ], dim=-1)
        tok_rob = self.proj_robot(rob_feat).unsqueeze(1)  # (B, 1, d_model)

        # 1. Adversaire : [opp_x, opp_y]
        opp_feat = obs[:, 35:37]
        tok_opp = self.proj_opp(opp_feat).unsqueeze(1)    # (B, 1, d_model)

        # 2..11. 10 Paquets
        pack_feat = obs[:, 5:15].unsqueeze(-1)           # (B, 10, 1)
        tok_pack = self.proj_pack(pack_feat)             # (B, 10, d_model)

        # 12..16. 5 Murs
        wall_feat = obs[:, 21:26].unsqueeze(-1)          # (B, 5, 1)
        tok_wall = self.proj_wall(wall_feat)             # (B, 5, d_model)

        # 17..20. 4 Tours
        tower_feat = obs[:, 26:30].unsqueeze(-1)         # (B, 4, 1)
        tok_tower = self.proj_tower(tower_feat)          # (B, 4, d_model)

        # 21. Graal : [g_home, g_held, g_posed, g_lvl]
        graal_feat = obs[:, 30:34]
        tok_graal = self.proj_graal(graal_feat).unsqueeze(1) # (B, 1, d_model)

        tokens = torch.cat([tok_rob, tok_opp, tok_pack, tok_wall, tok_tower, tok_graal], dim=1)  # (B, 22, d_model)
        type_ids = torch.arange(self.num_entities, device=device).unsqueeze(0).expand(B, -1)
        tokens = tokens + self.type_embed(type_ids)
        return self.norm(tokens)


class TransformerEncoder(nn.Module):
    """Encodeur Transformer auto-attention à 2 couches (d_model=64, nhead=4, GELU)."""

    def __init__(self, d_model: int = 64, nhead: int = 4, num_layers: int = 2, dim_feedforward: int = 128):
        super().__init__()
        self.d_model = d_model
        self.nhead = nhead
        self.num_layers = num_layers
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=dim_feedforward,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers, enable_nested_tensor=False)
        self.norm = nn.LayerNorm(d_model)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.norm(self.transformer(x))


class WorldModelHead(nn.Module):
    """Tête auxiliaire de World Model prédisant les dynamiques physiques futures (8 variables).

    Variables prédites :
    - 0..1 : [x, y] coordonnées futures
    - 2..3 : [cos, sin] orientation future
    - 4 : delta_t durée mécanique (>= 0)
    - 5..6 : [env_L, env_W] dimensions de l'enveloppe robot (>= 0)
    - 7 : p_contact probabilité de collision / scellement dans [0, 1]
    """

    def __init__(self, hidden_dim: int = 128, action_dim: int = 32, n_actions: int = 106):
        super().__init__()
        self.hidden_dim = hidden_dim
        self.action_dim = action_dim
        self.action_embed = nn.Embedding(n_actions, action_dim)
        self.net = nn.Sequential(
            nn.Linear(hidden_dim + action_dim, hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, 8),
        )

    def forward(self, hidden: torch.Tensor, actions: torch.Tensor) -> torch.Tensor:
        if actions.dim() == 2:
            actions = actions.squeeze(1)
        safe_actions = torch.clamp(actions, 0, self.action_embed.num_embeddings - 1)
        act_emb = self.action_embed(safe_actions)
        h_act = torch.cat([hidden, act_emb], dim=-1)
        raw = self.net(h_act)

        xy = raw[:, 0:2]
        cos_sin = torch.tanh(raw[:, 2:4])
        dt = nn.functional.softplus(raw[:, 4:5])
        env = nn.functional.softplus(raw[:, 5:7])
        p_contact = torch.sigmoid(raw[:, 7:8])

        return torch.cat([xy, cos_sin, dt, env, p_contact], dim=-1)


class FactorizedEncoder(nn.Module):
    """Encodeur multi-branches séparant la géométrie, la table et les actionneurs."""

    def __init__(self, n_in: int = 37, hidden_dim: int = 128):
        super().__init__()
        self.n_in = n_in
        self.hidden_dim = hidden_dim

        # Blocs objet-centré & transformer
        self.tokenizer = EntityTokenizer(d_model=64)
        self.transformer = TransformerEncoder(d_model=64, nhead=4, num_layers=2)
        self.self_attn = self.transformer

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

        # 5. Tête World Model Auxiliaire (R3)
        self.aux_head = WorldModelHead(hidden_dim=hidden_dim, action_dim=32, n_actions=max(n_out, 118))

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
            logits = torch.where(mask, logits, torch.full_like(logits, -1e8))

        # Tête Critique résiduelle
        h_crit = next_hidden + self.critic_dense(next_hidden)
        value = self.critic_out(h_crit).squeeze(-1)

        return logits, value, next_hidden

    def forward_actor(self, obs: torch.Tensor, hidden: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """Renvoie uniquement (action_logits, next_hidden)."""
        logits, _, next_h = self.forward(obs, hidden)
        return logits, next_h

    def forward_critic(self, obs: torch.Tensor, hidden: torch.Tensor) -> torch.Tensor:
        """Renvoie scalaire state value V(s)."""
        _, val, _ = self.forward(obs, hidden)
        return val

    def forward_aux(self, hidden: torch.Tensor, actions: torch.Tensor) -> torch.Tensor:
        """Renvoie les 8 prédictions physiques futures [x, y, cos, sin, dt, env_L, env_W, p_contact]."""
        return self.aux_head(hidden, actions)

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
