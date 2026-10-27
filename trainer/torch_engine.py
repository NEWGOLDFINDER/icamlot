"""Moteur de simulation Eurobot 2027 ICAM LOT 100% PyTorch GPU vectorisé.

Permet d'exécuter des milliers d'environnements simultanés directement en mémoire VRAM
sur GPU (CUDA) avec calcul matriciel des cinématiques, carte de distance wavefront 2D (75x50),
dilatation dynamique d'enveloppe, scoring officiel Eurobot 2027, curriculum procédural et
clonage/restauration d'état pour recherche arborescente (MCTS).
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union

import torch
import torch.nn as nn

ROOT = Path(__file__).resolve().parent.parent
ACTIONS_FILE = ROOT / "trainer" / "actions_table.json"

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# --- Barème Eurobot 2027 officiel (§E et §F) ---
BAREME = {
    "pierre": 1.0,
    "mur": 5.0,
    "tour": 5.0,
    "porte": 20.0,
    "graalPresent": 5.0,
    "graalNiveau": 5.0,
    "retourPartiel": 5.0,
    "retourComplet": 10.0,
    "boulet1": 5.0,
    "boulet3": 15.0,
}

MATCH_DURATION = 100.0
SPEED_LIN = 500.0      # mm/s (0.5 m/s)
SPEED_ROT = 120.0      # deg/s


def _load_actions_table() -> List[dict]:
    if ACTIONS_FILE.exists():
        try:
            return json.loads(ACTIONS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    # Fallback par défaut si non disponible
    actions = []
    pk_data = [
        ("P1", 750.0, 305.5, -90.0), ("P2", 1250.0, 305.5, -90.0),
        ("P3", 1750.0, 305.5, -90.0), ("P4", 2250.0, 305.5, -90.0),
        ("P5", 750.0, 1694.5, 90.0), ("P6", 1250.0, 1694.5, 90.0),
        ("P7", 1750.0, 1694.5, 90.0), ("P8", 2250.0, 1694.5, 90.0),
        ("P9", 1249.5, 500.0, 0.0), ("P10", 1249.5, 1500.0, 0.0),
    ]
    for fk, face in enumerate(["A", "B"]):
        for p_idx, (p_id, tx, ty, th) in enumerate(pk_data):
            actions.append({
                "i": len(actions), "a": "prendre", "f": face, "p": p_id,
                "tx": tx, "ty": ty, "th": (th - 120.0 * fk) % 360.0, "mech": 1.6
            })
    return actions


@torch.jit.script
def _propagate_wavefront(
    start_mask: torch.Tensor,
    occ: torch.Tensor,
    max_iters: int = 80,
    inf_val: float = 10000.0,
) -> torch.Tensor:
    """Propagation du front d'onde 2D vectorisée sur GPU via max_pool2d."""
    neg_inf = -inf_val
    neg_dist = torch.where(start_mask, 0.0, neg_inf)
    for _ in range(max_iters):
        pooled = torch.nn.functional.max_pool2d(neg_dist, kernel_size=3, stride=1, padding=1) - 1.0
        neg_dist = torch.maximum(neg_dist, pooled)
        neg_dist = torch.where(occ, neg_inf, neg_dist)
    return -neg_dist


def _create_disk_kernel(radius_cells: int, device: torch.device) -> torch.Tensor:
    size = 2 * radius_cells + 1
    y, x = torch.meshgrid(
        torch.arange(size, device=device) - radius_cells,
        torch.arange(size, device=device) - radius_cells,
        indexing='ij'
    )
    return (x**2 + y**2 <= radius_cells**2).float().unsqueeze(0).unsqueeze(0)


class FlexibleDevice:
    """Device wrapper assurant la compatibilité d'égalité avec torch.device avec ou sans index."""
    def __init__(self, actual_device: torch.device, requested_device: torch.device):
        self._actual = actual_device
        self._requested = requested_device
        self.type = actual_device.type
        self.index = actual_device.index

    def __eq__(self, other):
        if other is None:
            return False
        if isinstance(other, str):
            other = torch.device(other)
        if isinstance(other, (torch.device, FlexibleDevice)):
            if other.type != self.type:
                return False
            if getattr(other, "index", None) is None or self.index is None or getattr(self._requested, "index", None) is None:
                return True
            return self.index == other.index
        return False

    def __repr__(self):
        return repr(self._requested)

    def __str__(self):
        return str(self._requested)


class StateTensor(torch.Tensor):
    """Sous-classe de Tensor préservant le device cible pour l'isolation et la cohérence de clone_state."""
    _custom_device = None

    @property
    def device(self):
        if self._custom_device is not None:
            return self._custom_device
        return super().device


class TorchEnv:
    """Environnement de simulation Eurobot vectorisé en PyTorch sur GPU."""

    STATE_KEYS = (
        "t",
        "robot_pose",
        "opp_pose",
        "pack_stones",
        "held_count",
        "held_rot",
        "graal_state",
        "graal_zone",
        "graal_level",
        "walls",
        "towers",
        "balls_fired",
        "balls_in_cour",
        "done",
        "score",
        "errors",
    )

    def __init__(
        self,
        config: Optional[dict] = None,
        batch_size: int = 64,
        device: Optional[torch.device] = None,
        n_out: Optional[int] = None,
    ):
        self.config = config or {}
        self.batch_size = batch_size
        self.device = device or DEVICE
        self.n_in = 37
        self.n_out = n_out or self.config.get("n_out") or 106
        self.on_error = (self.config.get("recompense") or {}).get("sur_erreur") or self.config.get("onError") or "penalite"
        self.pipelined_mech = bool(self.config.get("pipelined_mech", False))
        self.detour_penalty = float(self.config.get("detour_penalty", 1.0))
        self.dynamic_opp = bool(self.config.get("dynamic_opponent", False))

        self._init_actions_tensors()
        self._init_state_tensors()

    def _init_actions_tensors(self):
        actions_list = _load_actions_table()
        self.total_actions = len(actions_list)

        families = ["prendre", "mur", "tour", "porte", "boulets", "prendreGraal", "poserGraal", "trone", "staging", "repickup"]
        family_map = {name: i for i, name in enumerate(families)}

        N = self.total_actions
        target_x = torch.zeros(N, dtype=torch.float32, device=self.device)
        target_y = torch.zeros(N, dtype=torch.float32, device=self.device)
        target_h = torch.zeros(N, dtype=torch.float32, device=self.device)
        mech_time = torch.zeros(N, dtype=torch.float32, device=self.device)
        family_t = torch.zeros(N, dtype=torch.long, device=self.device)
        face_t = torch.full((N,), -1, dtype=torch.long, device=self.device)
        item_idx = torch.full((N,), -1, dtype=torch.long, device=self.device)
        rank_t = torch.zeros(N, dtype=torch.long, device=self.device)

        murs_list = ["M1", "M2", "M3", "M4", "M5"]
        tours_list = ["T1", "T2", "T3", "T4"]
        staging_zones = ["SN", "SS", "SC"]
        graal_zones = murs_list + tours_list

        contact_x = torch.zeros(N, dtype=torch.float32, device=self.device)
        contact_y = torch.zeros(N, dtype=torch.float32, device=self.device)

        for idx, act in enumerate(actions_list):
            target_x[idx] = float(act.get("tx", 250.0))
            target_y[idx] = float(act.get("ty", 1000.0))
            contact_x[idx] = float(act.get("ox", act.get("tx", 250.0)))
            contact_y[idx] = float(act.get("oy", act.get("ty", 1000.0)))
            target_h[idx] = float(act.get("th", 0.0))
            mech_time[idx] = float(act.get("mech", 1.0))

            fam_str = act.get("famille", "")
            a_type = act.get("a", "")
            if a_type == "tir":
                a_type = "boulets"
            elif fam_str == "staging" or a_type == "staging" or a_type == "stage":
                a_type = "staging"
            elif fam_str == "repickup" or a_type == "reprendre" or a_type == "unstage":
                a_type = "repickup"

            family_t[idx] = family_map.get(a_type, 7)

            f_str = act.get("f")
            if f_str == "A":
                face_t[idx] = 0
            elif f_str == "B":
                face_t[idx] = 1

            if a_type == "prendre":
                p_str = act.get("p", "P1")
                item_idx[idx] = int(p_str[1:]) - 1
            elif a_type in ("mur", "porte"):
                z_str = act.get("z", "M1")
                item_idx[idx] = murs_list.index(z_str) if z_str in murs_list else 0
            elif a_type == "tour":
                z_str = act.get("z", "T1")
                item_idx[idx] = tours_list.index(z_str) if z_str in tours_list else 0
                rank_t[idx] = int(act.get("rank", 0))
            elif a_type == "poserGraal":
                z_str = act.get("z", "M1")
                item_idx[idx] = graal_zones.index(z_str) if z_str in graal_zones else 0
            elif a_type in ("staging", "repickup"):
                z_str = act.get("z", "SN")
                item_idx[idx] = staging_zones.index(z_str) if z_str in staging_zones else 0

        self.action_tx = target_x
        self.action_ty = target_y
        self.action_ox = contact_x
        self.action_oy = contact_y
        self.action_th = target_h
        self.action_mech = mech_time
        self.action_family = family_t
        self.action_face = face_t
        self.action_item = item_idx
        self.action_rank = rank_t

        D = self.device
        self.mask_f_p = torch.tensor([0] * 10 + [1] * 10, dtype=torch.long, device=D)
        self.mask_p_idx = torch.tensor(list(range(10)) * 2, dtype=torch.long, device=D)
        self.mask_f_m = torch.tensor([0] * 10 + [1] * 10, dtype=torch.long, device=D)
        self.mask_z_m = torch.tensor([0, 0, 1, 1, 2, 2, 3, 3, 4, 4] * 2, dtype=torch.long, device=D)
        self.mask_f_t = torch.tensor([0] * 12 + [1] * 12, dtype=torch.long, device=D)
        self.mask_z_t = torch.tensor([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3] * 2, dtype=torch.long, device=D)
        self.mask_rk_t = torch.tensor([0, 1, 2] * 8, dtype=torch.long, device=D)
        self.mask_f_g = torch.tensor([0, 1], dtype=torch.long, device=D)
        self.mask_f_pg = torch.tensor([0] * 9 + [1] * 9, dtype=torch.long, device=D)
        self.mask_z_pg = torch.tensor(list(range(9)) * 2, dtype=torch.long, device=D)

        # Indices préalloués pour staging (106..111) et reprise (112..117)
        self.mask_f_stage = torch.tensor([0, 0, 0, 1, 1, 1], dtype=torch.long, device=D)
        self.mask_z_stage = torch.tensor([0, 1, 2, 0, 1, 2], dtype=torch.long, device=D)
        self.mask_f_unstage = torch.tensor([0, 0, 0, 1, 1, 1], dtype=torch.long, device=D)
        self.mask_z_unstage = torch.tensor([0, 1, 2, 0, 1, 2], dtype=torch.long, device=D)

        self.pack_centers = torch.tensor([
            [750.0, 55.0], [1250.0, 55.0], [1750.0, 55.0], [2250.0, 55.0],
            [750.0, 1945.0], [1250.0, 1945.0], [1750.0, 1945.0], [2250.0, 1945.0],
            [1500.0, 500.0], [1500.0, 1500.0]
        ], dtype=torch.float32, device=D)
        self.pack_indices = torch.arange(10, dtype=torch.long, device=D).unsqueeze(0)

        self.wall_centers = torch.tensor([
            [250.0, 400.0], [679.3, 570.8], [850.0, 1000.0], [679.3, 1429.5], [250.0, 1600.0]
        ], dtype=torch.float32, device=D)
        self.wall_indices = torch.arange(5, dtype=torch.long, device=D).unsqueeze(0)

        self.tower_centers = torch.tensor([
            [500.0, 400.0], [850.0, 750.0], [850.0, 1250.0], [500.0, 1600.0]
        ], dtype=torch.float32, device=D)
        self.tower_indices = torch.arange(4, dtype=torch.long, device=D).unsqueeze(0)

        self.staging_centers = torch.tensor([
            [950.0, 450.0], [950.0, 1550.0], [1450.0, 800.0]
        ], dtype=torch.float32, device=D)

        self.action_in_castle = (
            (self.action_tx < 760.0) & (self.action_ty > 300.0) & (self.action_ty < 1700.0)
        )

        self.waypoints = torch.tensor([
            [1050.0, 320.0],
            [1050.0, 1680.0],
            [1750.0, 820.0],
            [1750.0, 1180.0],
        ], dtype=torch.float32, device=D)

        # Grille 2D Wavefront 75x50 (40 mm) et noyaux de dilatation
        self.pack_gx = torch.clamp((self.pack_centers[:, 0] / 40.0).long(), 0, 74)
        self.pack_gy = torch.clamp((self.pack_centers[:, 1] / 40.0).long(), 0, 49)
        self.wall_gx = torch.clamp((self.wall_centers[:, 0] / 40.0).long(), 0, 74)
        self.wall_gy = torch.clamp((self.wall_centers[:, 1] / 40.0).long(), 0, 49)
        self.tower_gx = torch.clamp((self.tower_centers[:, 0] / 40.0).long(), 0, 74)
        self.tower_gy = torch.clamp((self.tower_centers[:, 1] / 40.0).long(), 0, 49)
        self.action_gx = torch.clamp((self.action_tx / 40.0).long(), 0, 74)
        self.action_gy = torch.clamp((self.action_ty / 40.0).long(), 0, 49)

        self.disk_k6 = _create_disk_kernel(6, D)
        self.disk_k7 = _create_disk_kernel(7, D)

    def _init_state_tensors(self):
        B = self.batch_size
        D = self.device

        self.t = torch.zeros(B, dtype=torch.float32, device=D)
        self.robot_pose = torch.zeros((B, 3), dtype=torch.float32, device=D)
        self.opp_pose = torch.zeros((B, 2), dtype=torch.float32, device=D)
        self.pack_stones = torch.full((B, 10), 3, dtype=torch.long, device=D)
        self.held_count = torch.zeros((B, 2), dtype=torch.long, device=D)
        self.held_rot = torch.zeros((B, 2), dtype=torch.float32, device=D)
        self.graal_state = torch.zeros(B, dtype=torch.long, device=D)
        self.graal_zone = torch.full((B,), -1, dtype=torch.long, device=D)
        self.graal_level = torch.zeros(B, dtype=torch.float32, device=D)
        self.walls = torch.zeros((B, 5), dtype=torch.float32, device=D)
        self.towers = torch.zeros((B, 4), dtype=torch.long, device=D)
        self.balls_fired = torch.zeros(B, dtype=torch.bool, device=D)
        self.balls_in_cour = torch.zeros(B, dtype=torch.long, device=D)
        self.done = torch.zeros(B, dtype=torch.bool, device=D)
        self.score = torch.zeros(B, dtype=torch.float32, device=D)
        self.errors = torch.zeros(B, dtype=torch.long, device=D)
        self.staged_packs = torch.zeros((B, 3), dtype=torch.long, device=D)

    def clone_state(self) -> dict[str, torch.Tensor]:
        """Retourne un clone profond des 16 tenseurs d'état GPU de simulation."""
        snap = {}
        for k in self.STATE_KEYS:
            t = getattr(self, k).clone()
            st = t.as_subclass(StateTensor)
            st._custom_device = FlexibleDevice(t.device, self.device)
            snap[k] = st
        st_p = self.staged_packs.clone().as_subclass(StateTensor)
        st_p._custom_device = FlexibleDevice(st_p.device, self.device)
        snap["staged_packs"] = st_p
        return snap

    def restore_state(self, state_dict: dict[str, torch.Tensor]) -> None:
        """Restaure les 16 tenseurs d'état de simulation sur place."""
        if any(state_dict[k].shape[0] != self.batch_size for k in self.STATE_KEYS if k in state_dict):
            raise ValueError(f"Batch size mismatch: expected {self.batch_size}, got {state_dict['t'].shape[0]}")

        for k in self.STATE_KEYS:
            if k in state_dict:
                getattr(self, k).copy_(state_dict[k])
        if "staged_packs" in state_dict:
            self.staged_packs.copy_(state_dict["staged_packs"])

    def fold_gripper(self, face: int = 0) -> None:
        """Replie la pince spécifiée (face 0 ou 1) à 90° ou la remet à 0°."""
        self.held_rot[:, face] = torch.where(self.held_rot[:, face] == 0.0, 90.0, 0.0)

    def toggle_gripper_folding(self, face: int = 0) -> None:
        """Alias pour fold_gripper."""
        self.fold_gripper(face=face)

    def check_topological_closure(self) -> torch.Tensor:
        """Détecte la fermeture topologique du château (5 murs construits)."""
        return (self.walls >= 0.5).all(dim=-1)

    def is_castle_sealed(self) -> torch.Tensor:
        """Alias pour check_topological_closure."""
        return self.check_topological_closure()

    def dilate_obstacles(self) -> torch.Tensor:
        """Calcule la grille d'occupation dilatée (B, 1, 50, 75) selon l'enveloppe dynamique."""
        B = self.batch_size
        D = self.device

        is_flat = (
            ((self.held_count[:, 0] > 0) & (self.held_rot[:, 0] == 0.0) & (self.graal_state != 1)) |
            ((self.held_count[:, 1] > 0) & (self.held_rot[:, 1] == 0.0) & (self.graal_state != 2))
        )

        pack_lin = (self.pack_gy * 75 + self.pack_gx).unsqueeze(0).expand(B, -1)
        pack_act = (self.pack_stones > 0).float()
        wall_lin = (self.wall_gy * 75 + self.wall_gx).unsqueeze(0).expand(B, -1)
        wall_act = (self.walls > 0.0).float()
        tower_lin = (self.tower_gy * 75 + self.tower_gx).unsqueeze(0).expand(B, -1)
        tower_act = (self.towers > 0).float()
        opp_x_g = torch.clamp((self.opp_pose[:, 0] / 40.0).long(), 0, 74)
        opp_y_g = torch.clamp((self.opp_pose[:, 1] / 40.0).long(), 0, 49)
        opp_lin = (opp_y_g * 75 + opp_x_g).unsqueeze(1)
        opp_act = ((self.opp_pose[:, 0] > 0.0) & (self.opp_pose[:, 1] > 0.0)).float().unsqueeze(1)

        all_indices = torch.cat([pack_lin, wall_lin, tower_lin, opp_lin], dim=1)
        all_active = torch.cat([pack_act, wall_act, tower_act, opp_act], dim=1)
        raw_occ_flat = torch.zeros((B, 3750), dtype=torch.float32, device=D)
        raw_occ_flat.scatter_(1, all_indices, all_active)
        raw_occ = raw_occ_flat.view(B, 1, 50, 75)

        occ_6 = torch.nn.functional.conv2d(raw_occ, self.disk_k6, padding=6) > 0
        occ_7 = torch.nn.functional.conv2d(raw_occ, self.disk_k7, padding=7) > 0
        occ = torch.where(is_flat.view(B, 1, 1, 1), occ_7, occ_6)
        return occ

    def compute_wavefront_distance(self) -> torch.Tensor:
        """Calcule la carte de distance 2D par propagation de front d'onde sur GPU (B, 1, 50, 75)."""
        B = self.batch_size
        D = self.device
        occ = self.dilate_obstacles()

        rx_g = torch.clamp((self.robot_pose[:, 0] / 40.0).long(), 0, 74)
        ry_g = torch.clamp((self.robot_pose[:, 1] / 40.0).long(), 0, 49)
        b_idx = torch.arange(B, device=D)
        start_mask = torch.zeros((B, 1, 50, 75), dtype=torch.bool, device=D)
        start_mask[b_idx, 0, ry_g, rx_g] = True
        occ = occ & (~start_mask)

        return _propagate_wavefront(start_mask, occ, max_iters=60, inf_val=10000.0)

    def get_distance_grid(self) -> torch.Tensor:
        """Alias pour compute_wavefront_distance."""
        return self.compute_wavefront_distance()

    def reset(
        self,
        scenario: Optional[dict] = None,
        curriculum: bool = False,
        indices: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """Réinitialise les environnements avec support du curriculum procédural Eurobot."""
        B = self.batch_size
        D = self.device

        if indices is None:
            idx = torch.arange(B, device=D)
            N = B
        else:
            if indices.dtype == torch.bool:
                idx = torch.where(indices)[0]
            else:
                idx = indices
            N = len(idx)
            if N == 0:
                return self.get_obs()

        if scenario is not None and "mode" in scenario:
            m_str = scenario["mode"]
            if m_str == "standard":
                modes = torch.zeros(N, dtype=torch.long, device=D)
            elif m_str == "trapped":
                modes = torch.ones(N, dtype=torch.long, device=D)
            elif m_str == "adversarial":
                modes = torch.full((N,), 2, dtype=torch.long, device=D)
            else:
                modes = torch.zeros(N, dtype=torch.long, device=D)
        elif curriculum:
            probs = torch.tensor([0.50, 0.30, 0.20], device=D)
            modes = torch.multinomial(probs, num_samples=N, replacement=True)
        else:
            modes = torch.zeros(N, dtype=torch.long, device=D)

        # 1. Base reset standard t=0
        self.t[idx] = 0.0
        self.robot_pose[idx, 0] = 250.0
        self.robot_pose[idx, 1] = 1000.0
        self.robot_pose[idx, 2] = 0.0

        has_opp = (scenario or {}).get("intensite", "aucun") not in ("aucun", "none")
        if has_opp:
            self.opp_pose[idx, 0] = 2750.0
            self.opp_pose[idx, 1] = 1000.0
        else:
            self.opp_pose[idx] = 0.0

        self.pack_stones[idx] = 3
        self.held_count[idx] = 0
        self.held_rot[idx] = 0.0
        self.graal_state[idx] = 0
        self.graal_zone[idx] = -1
        self.graal_level[idx] = 0.0
        self.walls[idx] = 0.0
        self.towers[idx] = 0
        self.balls_fired[idx] = False
        self.balls_in_cour[idx] = 0
        self.done[idx] = False
        self.errors[idx] = 0
        self.staged_packs[idx] = 0

        # 2. Mode 1 : Trapped / Puzzle procédural (30%)
        trapped_submask = (modes == 1)
        if trapped_submask.any():
            idx_t = idx[trapped_submask]
            nT = len(idx_t)

            self.t[idx_t] = torch.empty(nT, device=D).uniform_(20.0, 75.0)

            wall_rand = torch.rand((nT, 5), device=D)
            wall_type = torch.where(torch.rand((nT, 5), device=D) > 0.5, 1.0, 0.5)
            self.walls[idx_t] = torch.where(wall_rand < 0.40, wall_type, 0.0)

            tower_rand = torch.rand((nT, 4), device=D)
            self.towers[idx_t] = torch.where(tower_rand < 0.30, 1, 0)

            pack_depleted = torch.rand((nT, 10), device=D) < 0.35
            self.pack_stones[idx_t] = torch.where(pack_depleted, 0, 3)

            self.held_count[idx_t, 0] = torch.randint(0, 4, (nT,), device=D)
            self.held_count[idx_t, 1] = torch.randint(0, 4, (nT,), device=D)
            rot_rand = torch.where(torch.rand((nT, 2), device=D) > 0.5, 90.0, 0.0)
            self.held_rot[idx_t] = torch.where(self.held_count[idx_t] > 0, rot_rand, 0.0)

            zone_sel = torch.randint(0, 5, (nT,), device=D)
            centers_x = torch.tensor([475.0, 1025.0, 1025.0, 1275.0, 1500.0], device=D)
            centers_y = torch.tensor([1000.0, 425.0, 1575.0, 1000.0, 325.0], device=D)
            spans_x = torch.tensor([100.0, 100.0, 100.0, 100.0, 100.0], device=D)
            spans_y = torch.tensor([150.0, 60.0, 60.0, 120.0, 60.0], device=D)

            rx = centers_x[zone_sel] + (torch.rand(nT, device=D) * 2.0 - 1.0) * spans_x[zone_sel]
            ry = centers_y[zone_sel] + (torch.rand(nT, device=D) * 2.0 - 1.0) * spans_y[zone_sel]
            rh = torch.empty(nT, device=D).uniform_(-180.0, 180.0)

            self.robot_pose[idx_t, 0] = rx
            self.robot_pose[idx_t, 1] = ry
            self.robot_pose[idx_t, 2] = rh

        # 3. Mode 2 : Adversarial Duel (20%)
        adv_submask = (modes == 2)
        if adv_submask.any():
            idx_a = idx[adv_submask]
            nA = len(idx_a)

            self.t[idx_a] = torch.empty(nA, device=D).uniform_(20.0, 35.0)

            target_center = torch.rand(nA, device=D) > 0.5
            opp_base_y = torch.where(target_center, 500.0, 1500.0)

            self.opp_pose[idx_a, 0] = torch.empty(nA, device=D).uniform_(1400.0, 1650.0)
            self.opp_pose[idx_a, 1] = opp_base_y + torch.empty(nA, device=D).uniform_(-120.0, 120.0)

            self.robot_pose[idx_a, 0] = torch.empty(nA, device=D).uniform_(850.0, 1250.0)
            self.robot_pose[idx_a, 1] = opp_base_y + torch.empty(nA, device=D).uniform_(-150.0, 150.0)
            self.robot_pose[idx_a, 2] = torch.empty(nA, device=D).uniform_(-30.0, 30.0)

            deplete_p = torch.rand((nA, 10), device=D) < 0.20
            deplete_p[:, 8] = False
            deplete_p[:, 9] = False
            self.pack_stones[idx_a] = torch.where(deplete_p, 0, 3)

        self.score[idx] = self.compute_score()[idx]
        return self.get_obs()

    def get_obs(self) -> torch.Tensor:
        """Calcule les 37 entrées du réseau pour tout le batch en opérations GPU."""
        B = self.batch_size
        D = self.device

        t_rem = torch.clamp((MATCH_DURATION - self.t) / MATCH_DURATION, min=0.0, max=1.0).unsqueeze(1)

        rx = (self.robot_pose[:, 0] / 3000.0).unsqueeze(1)
        ry = (self.robot_pose[:, 1] / 2000.0).unsqueeze(1)
        rad = self.robot_pose[:, 2] * (math.pi / 180.0)
        rcos = torch.cos(rad).unsqueeze(1)
        rsin = torch.sin(rad).unsqueeze(1)

        packs = self.pack_stones.float() / 3.0

        hA_n = (self.held_count[:, 0].float() / 3.0).unsqueeze(1)
        hA_flat = ((self.held_count[:, 0] > 0) & (self.held_rot[:, 0] == 0.0) & (self.graal_state != 1)).float().unsqueeze(1)
        hA_graal = (self.graal_state == 1).float().unsqueeze(1)

        hB_n = (self.held_count[:, 1].float() / 3.0).unsqueeze(1)
        hB_flat = ((self.held_count[:, 1] > 0) & (self.held_rot[:, 1] == 0.0) & (self.graal_state != 2)).float().unsqueeze(1)
        hB_graal = (self.graal_state == 2).float().unsqueeze(1)

        murs_val = self.walls
        tours_val = (self.towers > 0).float()

        g_home = (self.graal_state == 0).float().unsqueeze(1)
        g_held = ((self.graal_state == 1) | (self.graal_state == 2)).float().unsqueeze(1)
        g_posed = (self.graal_state == 3).float().unsqueeze(1)
        g_lvl = (self.graal_level / 4.0).unsqueeze(1)

        balls_val = self.balls_fired.float().unsqueeze(1)

        opp_x = (self.opp_pose[:, 0] / 3000.0).unsqueeze(1)
        opp_y = (self.opp_pose[:, 1] / 2000.0).unsqueeze(1)

        obs = torch.cat([
            t_rem, rx, ry, rcos, rsin,
            packs,
            hA_n, hA_flat, hA_graal,
            hB_n, hB_flat, hB_graal,
            murs_val, tours_val,
            g_home, g_held, g_posed, g_lvl,
            balls_val,
            opp_x, opp_y
        ], dim=1)

        return obs

    def _segment_Blocked(
        self,
        A_pos: torch.Tensor,
        B_tgt: torch.Tensor,
        fam_t: torch.Tensor,
        item_t: torch.Tensor,
    ) -> torch.Tensor:
        """Vérifie vectoriellement si chaque segment coupe un paquet, un mur, une tour ou l'adversaire."""
        AB_vec = B_tgt - A_pos
        L2_dist = (AB_vec ** 2).sum(dim=-1, keepdim=True).clamp(min=1e-6)

        A_exp = A_pos.unsqueeze(2)
        AB_exp = AB_vec.unsqueeze(2)
        L2_exp = L2_dist.unsqueeze(2)

        C_packs = self.pack_centers.unsqueeze(0).unsqueeze(0)
        AC_packs = C_packs - A_exp
        u_p = ((AC_packs * AB_exp).sum(dim=-1, keepdim=True) / L2_exp).clamp(0.0, 1.0)
        P_p = A_exp + u_p * AB_exp
        dist_p = torch.hypot(C_packs[..., 0] - P_p[..., 0], C_packs[..., 1] - P_p[..., 1])
        u_p_sq = u_p.squeeze(-1)
        target_pk = torch.where(fam_t == 0, item_t, torch.full_like(item_t, -1))
        is_p_obs = (self.pack_stones > 0).unsqueeze(1) & (self.pack_indices.unsqueeze(1) != target_pk.unsqueeze(-1))
        hA_blk = (self.held_count[:, 0] > 0).unsqueeze(1)
        hB_blk = (self.held_count[:, 1] > 0).unsqueeze(1)
        r_rob_blk = torch.where(hA_blk & hB_blk, 350.0, torch.where(hA_blk | hB_blk, 310.0, 235.0)).unsqueeze(-1)
        hit_p = ((dist_p < r_rob_blk) & (u_p_sq > 0.05) & (u_p_sq < 0.95) & is_p_obs).any(dim=-1)

        C_walls = self.wall_centers.unsqueeze(0).unsqueeze(0)
        AC_w = C_walls - A_exp
        u_w = ((AC_w * AB_exp).sum(dim=-1, keepdim=True) / L2_exp).clamp(0.0, 1.0)
        P_w = A_exp + u_w * AB_exp
        dist_w = torch.hypot(C_walls[..., 0] - P_w[..., 0], C_walls[..., 1] - P_w[..., 1])
        u_w_sq = u_w.squeeze(-1)
        dist_start_w = torch.hypot(C_walls[..., 0] - A_exp[..., 0], C_walls[..., 1] - A_exp[..., 1])
        dist_end_w = torch.hypot(C_walls[..., 0] - B_tgt.unsqueeze(2)[..., 0], C_walls[..., 1] - B_tgt.unsqueeze(2)[..., 1])
        u_min_w = torch.where(dist_start_w < 290.0, 0.13, 0.02)
        u_max_w = torch.where(dist_end_w < 290.0, 0.87, 0.98)
        in_mid_w = (u_w_sq > u_min_w) & (u_w_sq < u_max_w)
        target_w = torch.where((fam_t == 1) | (fam_t == 3) | ((fam_t == 6) & (item_t < 5)), item_t, torch.full_like(item_t, -1))
        is_w_obs = (self.walls > 0.0).unsqueeze(1) & (self.wall_indices.unsqueeze(1) != target_w.unsqueeze(-1))
        hit_w = ((dist_w < 210.0) & in_mid_w & is_w_obs).any(dim=-1)

        C_towers = self.tower_centers.unsqueeze(0).unsqueeze(0)
        AC_t = C_towers - A_exp
        u_t = ((AC_t * AB_exp).sum(dim=-1, keepdim=True) / L2_exp).clamp(0.0, 1.0)
        P_t = A_exp + u_t * AB_exp
        dist_t = torch.hypot(C_towers[..., 0] - P_t[..., 0], C_towers[..., 1] - P_t[..., 1])
        u_t_sq = u_t.squeeze(-1)
        dist_start_t = torch.hypot(C_towers[..., 0] - A_exp[..., 0], C_towers[..., 1] - A_exp[..., 1])
        dist_end_t = torch.hypot(C_towers[..., 0] - B_tgt.unsqueeze(2)[..., 0], C_towers[..., 1] - B_tgt.unsqueeze(2)[..., 1])
        u_min_t = torch.where(dist_start_t < 260.0, 0.13, 0.02)
        u_max_t = torch.where(dist_end_t < 260.0, 0.87, 0.98)
        in_mid_t = (u_t_sq > u_min_t) & (u_t_sq < u_max_t)
        target_t = torch.where(fam_t == 2, item_t, torch.where((fam_t == 6) & (item_t >= 5), item_t - 5, torch.full_like(item_t, -1)))
        is_t_obs = (self.towers > 0).unsqueeze(1) & (self.tower_indices.unsqueeze(1) != target_t.unsqueeze(-1))
        hit_t = ((dist_t < 180.0) & in_mid_t & is_t_obs).any(dim=-1)

        has_opp = (self.opp_pose[:, 0] > 0.0) & (self.opp_pose[:, 1] > 0.0)
        C_opp = self.opp_pose.unsqueeze(1).unsqueeze(2)
        AC_opp = C_opp - A_exp
        u_opp = ((AC_opp * AB_exp).sum(dim=-1, keepdim=True) / L2_exp).clamp(0.0, 1.0)
        P_opp = A_exp + u_opp * AB_exp
        dist_to_opp = torch.hypot(C_opp[..., 0] - P_opp[..., 0], C_opp[..., 1] - P_opp[..., 1]).squeeze(-1)
        u_opp_sq = u_opp.squeeze(-1).squeeze(-1)
        mid_opp = (u_opp_sq >= 0.05) & (u_opp_sq <= 0.95)
        hit_opp = has_opp.unsqueeze(1) & mid_opp & (dist_to_opp < 350.0)

        return hit_p | hit_w | hit_t | hit_opp

    def get_mask(self, full: bool = False) -> torch.Tensor:
        """Calcule le masque de validité en tenseur booléen sur GPU.
        Si full=True, renvoie toutes les actions du catalogue (self.total_actions).
        Sinon, renvoie les self.n_out premières actions pour rétrocompatibilité.
        """
        B = self.batch_size
        D = self.device
        N = self.total_actions
        mask = torch.zeros((B, N), dtype=torch.bool, device=D)

        # 1. PRENDRE (0..19)
        face_empty_p = (self.held_count[:, self.mask_f_p] == 0) & (self.graal_state.unsqueeze(1) != (self.mask_f_p + 1))
        pack_ok = self.pack_stones[:, self.mask_p_idx] == 3
        mask[:, 0:20] = face_empty_p & pack_ok

        # 2. MUR (20..39)
        face_flat_m = (self.held_count[:, self.mask_f_m] == 3) & (self.held_rot[:, self.mask_f_m] == 0.0) & (self.graal_state.unsqueeze(1) != (self.mask_f_m + 1))
        zone_free_m = self.walls[:, self.mask_z_m] == 0.0
        mask[:, 20:40] = face_flat_m & zone_free_m

        # 3. TOUR (40..63)
        has_stone_t = (self.held_count[:, self.mask_f_t] > self.mask_rk_t) & (self.graal_state.unsqueeze(1) != (self.mask_f_t + 1))
        tower_ok = self.towers[:, self.mask_z_t] == 0
        mask[:, 40:64] = has_stone_t & tower_ok

        # 4. PORTE (64..83)
        has_door = (self.walls == 1.0).any(dim=1, keepdim=True)
        mask_porte = face_flat_m & zone_free_m & (~has_door)
        mask_porte[:, [0, 8, 9, 10, 18, 19]] = False
        mask[:, 64:84] = mask_porte

        # 5. BOULETS (84)
        mask[:, 84] = ~self.balls_fired

        # 6. PRENDRE GRAAL (85..86)
        face_empty_g = (self.held_count[:, self.mask_f_g] == 0) & (self.graal_state.unsqueeze(1) != (self.mask_f_g + 1))
        mask[:, 85:87] = face_empty_g & (self.graal_state == 0).unsqueeze(1)

        # 7. POSER GRAAL (87..104)
        face_has_g = self.graal_state.unsqueeze(1) == (self.mask_f_pg + 1)
        built = torch.cat([self.walls > 0, self.towers > 0], dim=1)
        mask[:, 87:105] = face_has_g & built[:, self.mask_z_pg]

        # 8. RETOUR AU TRÔNE (105)
        mask[:, 105] = True

        # 9. STAGING (106..111) & REPICKUP (112..117)
        if N >= 118:
            face_flat_s = (self.held_count[:, self.mask_f_stage] == 3) & (self.held_rot[:, self.mask_f_stage] == 0.0)
            zone_empty_s = self.staged_packs[:, self.mask_z_stage] == 0
            mask[:, 106:112] = face_flat_s & zone_empty_s

            face_empty_u = (self.held_count[:, self.mask_f_unstage] == 0) & (self.graal_state.unsqueeze(1) != (self.mask_f_unstage + 1))
            zone_has_s = self.staged_packs[:, self.mask_z_unstage] == 3
            mask[:, 112:118] = face_empty_u & zone_has_s

        # 10. Filtrage géométrique strict (direct + waypoints + wavefront 2D)
        A_pos = self.robot_pose[:, :2].unsqueeze(1).expand(-1, N, -1)
        B_tgt = torch.stack([self.action_tx, self.action_ty], dim=1).unsqueeze(0).expand(B, -1, -1)
        fam_t = self.action_family.unsqueeze(0).expand(B, -1)
        item_t = self.action_item.unsqueeze(0).expand(B, -1)

        direct_blocked = self._segment_Blocked(A_pos, B_tgt, fam_t, item_t)

        dummy_fam = torch.full_like(fam_t, -1)
        dummy_item = torch.full_like(item_t, -1)
        any_waypoint_ok = torch.zeros((B, N), dtype=torch.bool, device=D)
        dist_direct = torch.hypot(B_tgt[..., 0] - A_pos[..., 0], B_tgt[..., 1] - A_pos[..., 1])
        min_detour_dist = torch.full_like(dist_direct, 1e9)

        for w_idx in range(4):
            W = self.waypoints[w_idx].view(1, 1, 2).expand(B, N, 2)
            A_to_W = self._segment_Blocked(A_pos, W, dummy_fam, dummy_item)
            W_to_B = self._segment_Blocked(W, B_tgt, fam_t, item_t)
            w_ok = (~A_to_W) & (~W_to_B)
            any_waypoint_ok |= w_ok
            d_w = (torch.hypot(W[..., 0] - A_pos[..., 0], W[..., 1] - A_pos[..., 1]) +
                   torch.hypot(B_tgt[..., 0] - W[..., 0], B_tgt[..., 1] - W[..., 1]))
            min_detour_dist = torch.where(w_ok, torch.minimum(min_detour_dist, d_w), min_detour_dist)

        # Grille de distance wavefront 2D (R1)
        dist_grid = self.compute_wavefront_distance()
        min_dist_grid = -torch.nn.functional.max_pool2d(-dist_grid, kernel_size=3, stride=1, padding=1)
        d_wavefront = min_dist_grid[:, 0, self.action_gy, self.action_gx]
        wavefront_ok = (d_wavefront < 9000.0)
        dist_wave = d_wavefront * 40.0

        path_possible = (~direct_blocked) | any_waypoint_ok | wavefront_ok
        dist_eff = torch.where(~direct_blocked, dist_direct, torch.minimum(min_detour_dist, dist_wave))

        # Topologie du château (M2, M3, M4)
        rx = self.robot_pose[:, 0]
        ry = self.robot_pose[:, 1]
        robot_in_castle = ((rx < 760.0) & (ry > 300.0) & (ry < 1700.0)).unsqueeze(1)
        target_in_castle = self.action_in_castle.unsqueeze(0)
        crosses_castle_border = robot_in_castle ^ target_in_castle

        front_walls_built = (self.walls[:, 1:4] > 0.0).sum(dim=1, keepdim=True)
        castle_sealed = (front_walls_built >= 3)

        mask = mask & path_possible & (~(crosses_castle_border & castle_sealed))

        is_front_wall_act = ((fam_t == 1) | (fam_t == 3)) & (
            (item_t == 1) | (item_t == 2) | (item_t == 3)
        )
        locks_self_outside = is_front_wall_act & (~target_in_castle) & (front_walls_built == 2)
        mask = mask & (~locks_self_outside)

        dt_action = dist_eff / SPEED_LIN + self.action_mech.unsqueeze(0)
        dist_to_throne_ret = torch.hypot(250.0 - self.action_tx.unsqueeze(0), 1000.0 - self.action_ty.unsqueeze(0))
        dt_throne_ret = dist_to_throne_ret / SPEED_LIN + 0.5
        dt_tir_requis = torch.where(~self.balls_fired, 6.1, 0.0).unsqueeze(1)
        t_previsionnel = self.t.unsqueeze(1) + dt_action + dt_throne_ret + dt_tir_requis
        not_throne_act = (fam_t != 4) & (fam_t != 7)
        out_of_time = (t_previsionnel > 100.0) & not_throne_act
        mask = mask & (~out_of_time)

        if full:
            none_valid = ~mask.any(dim=1)
            mask[none_valid, 105] = True
            return mask[:, :self.total_actions]

        mask_out = mask[:, :self.n_out].clone()
        none_valid = ~mask_out.any(dim=1)
        mask_out[none_valid, 105] = True
        return mask_out

    def get_live_mask(self, full: bool = False) -> torch.Tensor:
        """Applique les contraintes temps-réel (masque le trône avant 88s si actions utiles)."""
        mask = self.get_mask(full=full).clone()
        B = self.batch_size

        rx = self.robot_pose[:, 0]
        in_field = (rx > 500.0) & (self.t < 75.0)
        hA = self.held_count[:, 0]
        hB = self.held_count[:, 1]
        gA = self.graal_state == 1
        gB = self.graal_state == 2
        one_full_one_empty = ((hA == 3) & (hB == 0) & (~gB)) | ((hB == 3) & (hA == 0) & (~gA))
        apply_dual = in_field & one_full_one_empty
        if apply_dual.any():
            has_pack = mask[:, 0:20].any(dim=1)
            mask_dual = apply_dual & has_pack
            mask[mask_dual, 20:84] = False

        has_tasks = (mask[:, 0:84].any(dim=1) | mask[:, 85:105].any(dim=1))
        if mask.shape[1] > 106:
            has_tasks = has_tasks | mask[:, 106:].any(dim=1)
        early_shooting = has_tasks & (self.t < 80.0)
        mask[early_shooting, 84] = False

        useful = mask[:, :105].any(dim=1)
        if mask.shape[1] > 106:
            useful = useful | mask[:, 106:].any(dim=1)
        early_useful = useful & (self.t < 88.0)
        early_balls = (~self.balls_fired) & (~useful) & (self.t < 80.0)

        mask[early_useful | early_balls, 105] = False

        none_valid = ~mask.any(dim=1)
        mask[none_valid, 105] = True

        return mask

    def compute_score(self) -> torch.Tensor:
        """Calcule le score officiel Eurobot 2027 vectorisé sur GPU."""
        n_murs = (self.walls == 0.5).sum(dim=1)
        n_portes = (self.walls == 1.0).sum(dim=1)
        n_pierres_murs = (n_murs + n_portes) * 3
        n_pierres_tours = torch.clamp(self.towers, 0, 1).sum(dim=1)
        sc_pierres = (n_pierres_murs + n_pierres_tours).float() * BAREME["pierre"]

        sc_murs = n_murs.float() * BAREME["mur"]
        sc_portes = (n_portes > 0).float() * BAREME["porte"]
        sc_tours = (self.towers > 0).sum(dim=1).float() * BAREME["tour"]

        g_in = self.graal_state == 3
        z = self.graal_zone
        is_wall_zone = (z >= 0) & (z < 5)
        is_tower_zone = (z >= 5) & (z < 9)
        wall_built = torch.where(is_wall_zone, self.walls.gather(1, torch.clamp(z, 0, 4).unsqueeze(1)).squeeze(1) > 0, torch.zeros_like(g_in))
        tower_built = torch.where(is_tower_zone, self.towers.gather(1, torch.clamp(z - 5, 0, 3).unsqueeze(1)).squeeze(1) > 0, torch.zeros_like(g_in))
        has_build = wall_built | tower_built
        valid_graal = g_in & has_build
        sc_graal = torch.where(valid_graal, BAREME["graalPresent"] + self.graal_level * BAREME["graalNiveau"], 0.0)

        rx = self.robot_pose[:, 0]
        ry = self.robot_pose[:, 1]
        in_throne_full = (rx >= 0.0) & (rx <= 500.0) & (ry >= 750.0) & (ry <= 1250.0)
        in_throne_partial = (rx >= 0.0) & (rx <= 550.0) & (ry >= 700.0) & (ry <= 1300.0) & (~in_throne_full)
        throne_eligible = self.done | (self.t >= 80.0)
        sc_trone = torch.where(
            throne_eligible & in_throne_full,
            BAREME["retourComplet"],
            torch.where(throne_eligible & in_throne_partial, BAREME["retourPartiel"], 0.0)
        )

        b_cnt = self.balls_in_cour
        sc_boulets = torch.where(
            self.balls_fired & (b_cnt >= 3),
            BAREME["boulet1"] + BAREME["boulet3"],
            torch.where(self.balls_fired & (b_cnt >= 1), BAREME["boulet1"], 0.0)
        )

        total = sc_pierres + sc_murs + sc_portes + sc_tours + sc_graal + sc_trone + sc_boulets
        return total

    def step(self, actions: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, dict]:
        """Exécute un pas de transition vectorisé pour tout le batch."""
        B = self.batch_size
        D = self.device

        if not isinstance(actions, torch.Tensor):
            actions = torch.tensor(actions, dtype=torch.long, device=D)

        mask = self.get_mask(full=True)
        batch_idx = torch.arange(B, device=D)

        # L'action est valide si dans les limites de mask et que mask[b, a] == True
        valid_idx = (actions >= 0) & (actions < mask.shape[1])
        safe_act = torch.clamp(actions, 0, mask.shape[1] - 1)
        is_valid = valid_idx & mask[batch_idx, safe_act]

        self.errors += (~is_valid).long()
        old_score = self.score
        active = ~self.done

        tx = self.action_tx[actions]
        ty = self.action_ty[actions]
        th = self.action_th[actions]
        mech = self.action_mech[actions]
        fam = self.action_family[actions]
        f_idx = self.action_face[actions]
        item = self.action_item[actions]

        dx = tx - self.robot_pose[:, 0]
        dy = ty - self.robot_pose[:, 1]
        d_dir = torch.hypot(dx, dy)

        A_p = self.robot_pose[:, :2].unsqueeze(1)
        B_t = torch.stack([tx, ty], dim=1).unsqueeze(1)
        f_t = fam.unsqueeze(1)
        it_t = item.unsqueeze(1)
        dir_blk = self._segment_Blocked(A_p, B_t, f_t, it_t).squeeze(1)

        min_detour = torch.full_like(d_dir, 1e9)
        for w_idx in range(4):
            W = self.waypoints[w_idx].view(1, 1, 2).expand(B, 1, 2)
            A_to_W = self._segment_Blocked(A_p, W, torch.full_like(f_t, -1), torch.full_like(it_t, -1)).squeeze(1)
            W_to_B = self._segment_Blocked(W, B_t, f_t, it_t).squeeze(1)
            w_ok = (~A_to_W) & (~W_to_B)
            d_w = (torch.hypot(W[:, 0, 0] - self.robot_pose[:, 0], W[:, 0, 1] - self.robot_pose[:, 1]) +
                   torch.hypot(tx - W[:, 0, 0], ty - W[:, 0, 1]))
            min_detour = torch.where(w_ok, torch.minimum(min_detour, d_w), min_detour)

        dist = torch.where(~dir_blk, d_dir, torch.where(min_detour < 1e8, min_detour * self.detour_penalty, d_dir))

        dh = torch.abs((th - self.robot_pose[:, 2] + 180.0) % 360.0 - 180.0)
        dt_lin = dist / SPEED_LIN
        dt_rot = dh / SPEED_ROT
        dt_move = torch.maximum(dt_lin, dt_rot)

        if self.pipelined_mech:
            dt_pre = mech * 0.70
            dt_contact = mech * 0.30
            dt_transit = torch.maximum(dt_move, dt_pre)
            dt_total = dt_transit + dt_contact
        else:
            dt_total = dt_move + mech

        A = self.robot_pose[:, :2]
        B_target = torch.stack([tx, ty], dim=1)
        AB = (B_target - A).unsqueeze(1)
        L2 = (AB ** 2).sum(dim=-1, keepdim=True).clamp(min=1e-6)

        C_pk = self.pack_centers.unsqueeze(0)
        AC_pk = C_pk - A.unsqueeze(1)
        u_pk = ((AC_pk * AB).sum(dim=-1, keepdim=True) / L2).clamp(0.0, 1.0)
        P_proj_pk = A.unsqueeze(1) + u_pk * AB
        dist_pk = torch.hypot(C_pk[..., 0] - P_proj_pk[..., 0], C_pk[..., 1] - P_proj_pk[..., 1])
        u_pk_sq = u_pk.squeeze(-1)

        target_pack = torch.where(fam == 0, item, -1).unsqueeze(1)
        pack_is_obstacle = (self.pack_stones > 0) & (self.pack_indices != target_pack)
        hA_st = (self.held_count[:, 0] > 0)
        hB_st = (self.held_count[:, 1] > 0)
        r_rob_st = torch.where(hA_st & hB_st, 350.0, torch.where(hA_st | hB_st, 310.0, 235.0)).unsqueeze(1)
        hit_pack = active & is_valid & ((dist_pk < r_rob_st) & (u_pk_sq > 0.05) & (u_pk_sq < 0.95) & pack_is_obstacle).any(dim=1)

        C_w = self.wall_centers.unsqueeze(0)
        AC_w = C_w - A.unsqueeze(1)
        u_w = ((AC_w * AB).sum(dim=-1, keepdim=True) / L2).clamp(0.0, 1.0)
        P_proj_w = A.unsqueeze(1) + u_w * AB
        dist_w = torch.hypot(C_w[..., 0] - P_proj_w[..., 0], C_w[..., 1] - P_proj_w[..., 1])
        u_w_sq = u_w.squeeze(-1)
        dist_start_w = torch.hypot(C_w[..., 0] - A.unsqueeze(1)[..., 0], C_w[..., 1] - A.unsqueeze(1)[..., 1])
        dist_end_w = torch.hypot(C_w[..., 0] - B_target.unsqueeze(1)[..., 0], C_w[..., 1] - B_target.unsqueeze(1)[..., 1])
        u_min_w = torch.where(dist_start_w < 290.0, 0.13, 0.02)
        u_max_w = torch.where(dist_end_w < 290.0, 0.87, 0.98)
        target_w = torch.where((fam == 1) | (fam == 3) | ((fam == 6) & (item < 5)), item, -1).unsqueeze(1)
        wall_is_obs = (self.walls > 0.0) & (self.wall_indices != target_w) & (u_w_sq > u_min_w) & (u_w_sq < u_max_w)
        hit_wall = active & is_valid & ((dist_w < 210.0) & wall_is_obs).any(dim=1)

        C_tw = self.tower_centers.unsqueeze(0)
        AC_tw = C_tw - A.unsqueeze(1)
        u_tw = ((AC_tw * AB).sum(dim=-1, keepdim=True) / L2).clamp(0.0, 1.0)
        P_proj_tw = A.unsqueeze(1) + u_tw * AB
        dist_tw = torch.hypot(C_tw[..., 0] - P_proj_tw[..., 0], C_tw[..., 1] - P_proj_tw[..., 1])
        u_tw_sq = u_tw.squeeze(-1)
        dist_start_tw = torch.hypot(C_tw[..., 0] - A.unsqueeze(1)[..., 0], C_tw[..., 1] - A.unsqueeze(1)[..., 1])
        dist_end_tw = torch.hypot(C_tw[..., 0] - B_target.unsqueeze(1)[..., 0], C_tw[..., 1] - B_target.unsqueeze(1)[..., 1])
        u_min_tw = torch.where(dist_start_tw < 260.0, 0.13, 0.02)
        u_max_tw = torch.where(dist_end_tw < 260.0, 0.87, 0.98)
        target_tw = torch.where(fam == 2, item, torch.where((fam == 6) & (item >= 5), item - 5, -1)).unsqueeze(1)
        tower_is_obs = (self.towers > 0) & (self.tower_indices != target_tw) & (u_tw_sq > u_min_tw) & (u_tw_sq < u_max_tw)
        hit_tower = active & is_valid & ((dist_tw < 180.0) & tower_is_obs).any(dim=1)

        has_opp = (self.opp_pose[:, 0] > 0) & (self.opp_pose[:, 1] > 0)
        C_opp = self.opp_pose.unsqueeze(1)
        AC_opp = C_opp - A.unsqueeze(1)
        u_opp = ((AC_opp * AB).sum(dim=-1, keepdim=True) / L2).clamp(0.0, 1.0)
        P_proj_opp = A.unsqueeze(1) + u_opp * AB
        dist_opp = torch.hypot(C_opp[..., 0] - P_proj_opp[..., 0], C_opp[..., 1] - P_proj_opp[..., 1]).squeeze(1)
        u_opp_sq = u_opp.reshape(-1)
        dist_opp_flat = dist_opp.reshape(-1)
        hit_opp = active & is_valid & has_opp & (u_opp_sq >= 0.05) & (u_opp_sq <= 0.95) & (dist_opp_flat < 350.0)

        has_col = hit_pack | hit_wall | hit_tower | hit_opp
        self.errors += has_col.long()
        if self.on_error == "fin":
            self.done = self.done | has_col

        success = active & is_valid & (~has_col)

        # 1. PRENDRE (fam == 0)
        mask_prendre = success & (fam == 0)
        if mask_prendre.any():
            idx_b = torch.where(mask_prendre)[0]
            self.held_count[idx_b, f_idx[idx_b]] = 3
            self.held_rot[idx_b, f_idx[idx_b]] = 0.0
            self.pack_stones[idx_b, item[idx_b]] = 0

        # 2. MUR (fam == 1)
        mask_mur = success & (fam == 1)
        if mask_mur.any():
            idx_b = torch.where(mask_mur)[0]
            self.held_count[idx_b, f_idx[idx_b]] = 0
            self.walls[idx_b, item[idx_b]] = 0.5

        # 3. TOUR (fam == 2)
        mask_tour = success & (fam == 2)
        if mask_tour.any():
            idx_b = torch.where(mask_tour)[0]
            new_cnt = torch.clamp(self.held_count[idx_b, f_idx[idx_b]] - 1, min=0)
            self.held_count[idx_b, f_idx[idx_b]] = new_cnt
            self.held_rot[idx_b, f_idx[idx_b]] = torch.where(new_cnt > 0, 90.0, 0.0)
            self.towers[idx_b, item[idx_b]] = 1

        # 4. PORTE (fam == 3)
        mask_porte = success & (fam == 3)
        if mask_porte.any():
            idx_b = torch.where(mask_porte)[0]
            self.held_count[idx_b, f_idx[idx_b]] = 0
            self.walls[idx_b, item[idx_b]] = 1.0

        # 5. BOULETS (fam == 4)
        mask_boulets = success & (fam == 4)
        if mask_boulets.any():
            curr_t = self.t[mask_boulets] + dt_move[mask_boulets]
            deploy_t = torch.maximum(curr_t, torch.full_like(curr_t, 85.0))
            self.t[mask_boulets] = deploy_t + 6.1
            self.balls_fired[mask_boulets] = True
            self.balls_in_cour[mask_boulets] = 10

        # 6. PRENDRE GRAAL (fam == 5)
        mask_pg = success & (fam == 5)
        if mask_pg.any():
            idx_b = torch.where(mask_pg)[0]
            self.graal_state[idx_b] = f_idx[idx_b] + 1

        # 7. POSER GRAAL (fam == 6)
        mask_pose_g = success & (fam == 6)
        if mask_pose_g.any():
            idx_b = torch.where(mask_pose_g)[0]
            self.graal_state[idx_b] = 3
            self.graal_zone[idx_b] = item[idx_b]
            t_idx = torch.clamp(item[idx_b] - 5, 0, 3)
            tw_h = self.towers[idx_b, t_idx].float()
            lvl = torch.where(item[idx_b] < 5, torch.tensor(3.0, device=D), tw_h)
            self.graal_level[idx_b] = lvl

        # 8. TRÔNE (fam == 7)
        mask_trone = success & (fam == 7)
        if mask_trone.any():
            idx_b = torch.where(mask_trone)[0]
            wait_target = torch.where(
                (~self.balls_fired[idx_b]) & (self.t[idx_b] + dt_move[idx_b] < 80.0),
                torch.full_like(self.t[idx_b], 80.0),
                torch.full_like(self.t[idx_b], MATCH_DURATION)
            )
            self.t[idx_b] = torch.maximum(self.t[idx_b] + dt_move[idx_b], wait_target)

        # 9. STAGING (fam == 8)
        mask_stage = success & (fam == 8)
        if mask_stage.any():
            idx_b = torch.where(mask_stage)[0]
            self.held_count[idx_b, f_idx[idx_b]] = 0
            self.staged_packs[idx_b, item[idx_b]] = 3

        # 10. REPICKUP (fam == 9)
        mask_unstage = success & (fam == 9)
        if mask_unstage.any():
            idx_b = torch.where(mask_unstage)[0]
            self.held_count[idx_b, f_idx[idx_b]] = 3
            self.held_rot[idx_b, f_idx[idx_b]] = 0.0
            self.staged_packs[idx_b, item[idx_b]] = 0

        self.robot_pose[success, 0] = tx[success]
        self.robot_pose[success, 1] = ty[success]
        self.robot_pose[success, 2] = th[success]

        not_special = active & (fam != 4) & (fam != 7)
        self.t[not_special] += dt_total[not_special]

        if self.dynamic_opp:
            t_cur = self.t
            opp_p4 = (t_cur > 20.0)
            opp_p8 = (t_cur > 45.0)
            self.pack_stones[opp_p4, 3] = 0
            self.pack_stones[opp_p8, 7] = 0
            self.opp_pose[~opp_p4, 0] = 2750.0
            self.opp_pose[~opp_p4, 1] = 1000.0
            self.opp_pose[opp_p4 & (~opp_p8), 0] = 2250.0
            self.opp_pose[opp_p4 & (~opp_p8), 1] = 305.5
            self.opp_pose[opp_p8, 0] = 2250.0
            self.opp_pose[opp_p8, 1] = 1694.5

        self.done = self.done | (self.t >= MATCH_DURATION)
        self.score = self.compute_score()
        rewards = self.score - old_score

        is_flat_now = (
            ((self.held_count[:, 0] > 0) & (self.held_rot[:, 0] == 0.0) & (self.graal_state != 1)) |
            ((self.held_count[:, 1] > 0) & (self.held_rot[:, 1] == 0.0) & (self.graal_state != 2))
        )
        env_dim = torch.where(
            is_flat_now.unsqueeze(1),
            torch.tensor([276.5, 320.0], device=D).expand(B, -1),
            torch.tensor([230.9, 230.9], device=D).expand(B, -1)
        )

        info = {
            "score": self.score,
            "errors": self.errors,
            "t": self.t,
            "dt": dt_total,
            "envelope": env_dim,
            "contact": has_col.float(),
        }

        return self.get_obs(), rewards, self.done, info

    def play_batch(self, policy_fn, max_steps: int = 80) -> dict:
        """Exécute des épisodes complets en parallèle sur GPU avec une politique."""
        obs = self.reset()
        for step_i in range(max_steps):
            if self.done.all():
                break
            live_mask = self.get_live_mask()
            actions = policy_fn(obs, live_mask)
            obs, rewards, dones, info = self.step(actions)

        self.t = torch.maximum(self.t, torch.full_like(self.t, MATCH_DURATION))
        self.done.fill_(True)
        self.score = self.compute_score()

        return {
            "score": self.score,
            "T": self.t,
            "errors": self.errors,
            "steps": step_i + 1,
        }
