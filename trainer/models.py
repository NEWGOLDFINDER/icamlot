"""Réseau du cerveau ICAM LOT : acteur-critique récurrent simple et paramétrique (contrat §5).

  obs (B, n_in) ─► normalisation ─► encodeur MLP (Linear → LayerNorm → activation)×k ─► GRUCell(H)
                                                                                         ├─► tête acteur  ─► logits (B, n_out)
                                                                                         └─► tête critique ─► valeur (B,)

- Normalisation des observations intégrée au modèle : obs_n = clip((obs − mean) / std, −clip, +clip).
  mean et std sont des tampons (buffers) mis à jour par l'entraîneur avec des statistiques glissantes ;
  ils sont sauvegardés avec le modèle et intégrés au graphe ONNX.
- Une seule tête de politique (plus de têtes « approche »/« pliage »), pas d'encodeur Transformer.
- Le masque d'actions vient de l'environnement ; il n'est pas une entrée du graphe exporté.
- Aucune dimension codée en dur : n_in et n_out sont lus dans l'environnement.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import torch
import torch.nn as nn

# Valeur donnée aux logits des actions masquées (probabilité nulle après softmax en float32).
MASK_LOGIT = -1e9

ACTIVATIONS = {"silu": nn.SiLU, "relu": nn.ReLU, "tanh": nn.Tanh}


class RunningMeanStd:
    """Moyenne et variance glissantes (algorithme parallèle de Chan), en float64."""

    def __init__(self, shape=(), epsilon: float = 1e-4):
        self.mean = np.zeros(shape, dtype=np.float64)
        self.var = np.ones(shape, dtype=np.float64)
        self.count = float(epsilon)

    def update(self, x: np.ndarray) -> None:
        x = np.asarray(x, dtype=np.float64)
        if x.size == 0:
            return
        x = x.reshape((-1,) + self.mean.shape)
        b_mean, b_var, b_count = x.mean(axis=0), x.var(axis=0), x.shape[0]
        delta = b_mean - self.mean
        tot = self.count + b_count
        self.mean = self.mean + delta * b_count / tot
        m2 = self.var * self.count + b_var * b_count + delta ** 2 * self.count * b_count / tot
        self.var = m2 / tot
        self.count = tot

    def state_dict(self) -> dict:
        return {"mean": self.mean.tolist(), "var": self.var.tolist(), "count": self.count}

    def load_state_dict(self, d: dict) -> None:
        self.mean = np.asarray(d["mean"], dtype=np.float64)
        self.var = np.asarray(d["var"], dtype=np.float64)
        self.count = float(d["count"])


def _mlp(n_in: int, widths: Sequence[int], activation: str, layernorm: bool) -> Tuple[nn.Sequential, int]:
    layers: List[nn.Module] = []
    d = n_in
    for w in widths:
        layers.append(nn.Linear(d, int(w)))
        if layernorm:
            layers.append(nn.LayerNorm(int(w)))
        layers.append(ACTIVATIONS[activation]())
        d = int(w)
    return nn.Sequential(*layers), d


def masked_logits(logits: torch.Tensor, mask: Optional[torch.Tensor]) -> torch.Tensor:
    if mask is None:
        return logits
    return torch.where(mask.bool(), logits, torch.full_like(logits, MASK_LOGIT))


class RecurrentActorCritic(nn.Module):
    """Acteur-critique récurrent.

    Paramètres (valeurs par défaut = hypothèses de départ, à régler par l'équipe) :
      hidden      : taille H de l'état caché du GRU (128) ;
      encodeur    : largeurs des couches de l'encodeur (128,) ;
      acteur      : couches cachées de la tête acteur avant la sortie (aucune) ;
      critique    : couches cachées de la tête critique (128,) ;
      activation  : silu | relu | tanh (silu) ;
      layernorm   : LayerNorm après chaque couche de l'encodeur (oui) ;
      clip_obs    : borne de l'observation normalisée (5,0).
    """

    def __init__(
        self,
        n_in: int,
        n_out: int,
        hidden: int = 128,
        encodeur: Sequence[int] = (128,),
        acteur: Sequence[int] = (),
        critique: Sequence[int] = (128,),
        activation: str = "silu",
        layernorm: bool = True,
        clip_obs: float = 5.0,
    ):
        super().__init__()
        if activation not in ACTIVATIONS:
            raise ValueError(f"Activation inconnue : {activation}")
        self.n_in, self.n_out, self.hidden_dim = int(n_in), int(n_out), int(hidden)
        self.arch = {
            "n_in": self.n_in, "n_out": self.n_out, "hidden": self.hidden_dim,
            "encodeur": [int(x) for x in encodeur], "acteur": [int(x) for x in acteur],
            "critique": [int(x) for x in critique], "activation": activation,
            "layernorm": bool(layernorm), "clip_obs": float(clip_obs),
        }
        self.register_buffer("obs_mean", torch.zeros(self.n_in))
        self.register_buffer("obs_std", torch.ones(self.n_in))
        self.clip_obs = float(clip_obs)
        self.encoder, d = _mlp(self.n_in, encodeur, activation, layernorm)
        self.gru = nn.GRUCell(d, self.hidden_dim)
        actor_body, da = _mlp(self.hidden_dim, acteur, activation, False)
        self.actor = nn.Sequential(*actor_body, nn.Linear(da, self.n_out))
        critic_body, dc = _mlp(self.hidden_dim, critique, activation, False)
        self.critic = nn.Sequential(*critic_body, nn.Linear(dc, 1))
        self._init_weights()

    def _init_weights(self) -> None:
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=np.sqrt(2))
                nn.init.zeros_(m.bias)
        # sortie de l'acteur presque uniforme, sortie critique à petite échelle (pratique PPO usuelle)
        nn.init.orthogonal_(self.actor[-1].weight, gain=0.01)
        nn.init.orthogonal_(self.critic[-1].weight, gain=1.0)

    # ───────── normalisation ─────────
    def set_obs_stats(self, mean: np.ndarray, var: np.ndarray, eps: float = 1e-8) -> None:
        with torch.no_grad():
            self.obs_mean.copy_(torch.as_tensor(np.asarray(mean), dtype=torch.float32))
            self.obs_std.copy_(torch.as_tensor(np.sqrt(np.asarray(var) + eps), dtype=torch.float32))

    def normalise(self, obs: torch.Tensor) -> torch.Tensor:
        return torch.clamp((obs - self.obs_mean) / self.obs_std, -self.clip_obs, self.clip_obs)

    # ───────── passes avant ─────────
    def init_hidden(self, batch_size: int, device: Optional[torch.device] = None) -> torch.Tensor:
        """État caché initial (mémoire vide au début du match) : des zéros."""
        if device is None:
            device = self.obs_mean.device
        return torch.zeros((batch_size, self.hidden_dim), dtype=torch.float32, device=device)

    def core(self, obs: torch.Tensor, hidden: torch.Tensor) -> torch.Tensor:
        return self.gru(self.encoder(self.normalise(obs)), hidden)

    def forward(self, obs: torch.Tensor, hidden: torch.Tensor, mask: Optional[torch.Tensor] = None):
        """Renvoie (logits masqués (B, n_out), valeur (B,), next_hidden (B, H))."""
        h = self.core(obs, hidden)
        logits = masked_logits(self.actor(h), mask)
        value = self.critic(h).squeeze(-1)
        return logits, value, h

    def forward_sequence(
        self,
        obs: torch.Tensor,        # (T, B, n_in)
        h0: torch.Tensor,         # (B, H) état caché avant le premier pas
        starts: torch.Tensor,     # (T, B) 1 si le pas t est le premier d'un épisode : l'état caché repart de zéro
        mask: Optional[torch.Tensor] = None,  # (T, B, n_out)
    ):
        """Déroule le GRU sur une séquence en remettant l'état caché à zéro au début de chaque épisode.
        Renvoie (logits (T, B, n_out), valeurs (T, B), h_final (B, H))."""
        T = obs.shape[0]
        feats = self.encoder(self.normalise(obs))
        h = h0
        hs = []
        for t in range(T):
            h = h * (1.0 - starts[t].float()).unsqueeze(-1)
            h = self.gru(feats[t], h)
            hs.append(h)
        H = torch.stack(hs, 0)
        logits = masked_logits(self.actor(H), mask)
        values = self.critic(H).squeeze(-1)
        return logits, values, h

    def config(self) -> dict:
        return dict(self.arch)

    @classmethod
    def from_config(cls, arch: dict) -> "RecurrentActorCritic":
        return cls(
            n_in=arch["n_in"], n_out=arch["n_out"], hidden=arch.get("hidden", 128),
            encodeur=arch.get("encodeur", (128,)), acteur=arch.get("acteur", ()),
            critique=arch.get("critique", (128,)), activation=arch.get("activation", "silu"),
            layernorm=arch.get("layernorm", True), clip_obs=arch.get("clip_obs", 5.0),
        )


class PolicyExport(nn.Module):
    """Partie acteur seule, pour l'export (contrat §5) : (obs, hidden) -> (logits, next_hidden).
    La normalisation est dans le graphe ; les logits ne sont PAS masqués."""

    def __init__(self, model: RecurrentActorCritic):
        super().__init__()
        self.model = model

    def forward(self, obs: torch.Tensor, hidden: torch.Tensor):
        h = self.model.core(obs, hidden)
        return self.model.actor(h), h


def save_checkpoint(path, model: RecurrentActorCritic, extra: Optional[Dict] = None) -> None:
    """Point de sauvegarde autonome : architecture + poids (dont statistiques de normalisation) + extra."""
    from pathlib import Path
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = {"format": "icamlot-checkpoint", "version": 1, "arch": model.config(),
            "model_state": {k: v.detach().cpu() for k, v in model.state_dict().items()}}
    data.update(extra or {})
    tmp = p.with_suffix(p.suffix + ".tmp")
    torch.save(data, tmp)
    tmp.replace(p)


def load_checkpoint(path, device: Optional[torch.device] = None) -> Tuple[RecurrentActorCritic, dict]:
    data = torch.load(path, map_location=device or "cpu", weights_only=False)
    if data.get("format") != "icamlot-checkpoint":
        raise ValueError(f"{path} n'est pas un point de sauvegarde icamlot (ancien format ? voir .data/legacy/README.md).")
    model = RecurrentActorCritic.from_config(data["arch"])
    model.load_state_dict(data["model_state"])
    if device is not None:
        model.to(device)
    return model, data
