"""Moteur de simulation Eurobot 2027 ICAM LOT 100% PyTorch GPU vectorisé.

Permet d'exécuter des milliers d'environnements simultanés directement en mémoire VRAM
sur GPU (CUDA) avec calcul matriciel des cinématiques, masquage des 106 actions,
gestion des préhensions/poses, scoring officiel Eurobot 2027 et observations.
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
    # Fallback si le fichier n'est pas encore généré
    actions = []
    rin = 400.0 / (2.0 * math.sqrt(3.0))
    # 0..19: Prendre
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


class TorchEnv:
    """Environnement de simulation Eurobot vectorisé en PyTorch sur GPU."""

    def __init__(
        self,
        config: Optional[dict] = None,
        batch_size: int = 64,
        device: Optional[torch.device] = None,
    ):
        self.config = config or {}
        self.batch_size = batch_size
        self.device = device or DEVICE
        self.n_in = 37
        self.n_out = 106
        self.on_error = (self.config.get("recompense") or {}).get("sur_erreur") or self.config.get("onError") or "penalite"
        # Support du pipelining matériel en temps masqué (Dual ESP32 Navigation + Actionneurs)
        self.pipelined_mech = bool(self.config.get("pipelined_mech", False))

        # Charger la table des métadonnées des 106 actions
        self._init_actions_tensors()

        # Allouer les tenseurs d'état sur le GPU
        self._init_state_tensors()

    def _init_actions_tensors(self):
        actions_list = _load_actions_table()
        assert len(actions_list) == 106, f"Expected 106 actions, got {len(actions_list)}"

        families = ["prendre", "mur", "tour", "porte", "boulets", "prendreGraal", "poserGraal", "trone"]
        family_map = {name: i for i, name in enumerate(families)}

        target_x = torch.zeros(106, dtype=torch.float32, device=self.device)
        target_y = torch.zeros(106, dtype=torch.float32, device=self.device)
        target_h = torch.zeros(106, dtype=torch.float32, device=self.device)
        mech_time = torch.zeros(106, dtype=torch.float32, device=self.device)
        family_t = torch.zeros(106, dtype=torch.long, device=self.device)
        face_t = torch.full((106,), -1, dtype=torch.long, device=self.device)
        item_idx = torch.full((106,), -1, dtype=torch.long, device=self.device)
        rank_t = torch.zeros(106, dtype=torch.long, device=self.device)

        murs_list = ["M1", "M2", "M3", "M4", "M5"]
        tours_list = ["T1", "T2", "T3", "T4"]
        graal_zones = murs_list + tours_list

        for idx, act in enumerate(actions_list):
            target_x[idx] = float(act.get("tx", 250.0))
            target_y[idx] = float(act.get("ty", 1000.0))
            target_h[idx] = float(act.get("th", 0.0))
            mech_time[idx] = float(act.get("mech", 1.0))
            a_type = act.get("a", "")
            if a_type == "tir":
                a_type = "boulets"
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

        self.action_tx = target_x
        self.action_ty = target_y
        self.action_th = target_h
        self.action_mech = mech_time
        self.action_family = family_t
        self.action_face = face_t
        self.action_item = item_idx
        self.action_rank = rank_t

        # Indices GPU pré-alloués pour vectorisation intégrale de get_mask
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

        # Positions des 10 paquets pour détection de collision vectorisée
        self.pack_centers = torch.tensor([
            [750.0, 55.0], [1250.0, 55.0], [1750.0, 55.0], [2250.0, 55.0],
            [750.0, 1945.0], [1250.0, 1945.0], [1750.0, 1945.0], [2250.0, 1945.0],
            [1500.0, 500.0], [1500.0, 1500.0]
        ], dtype=torch.float32, device=D)
        self.pack_indices = torch.arange(10, dtype=torch.long, device=D).unsqueeze(0)

        # Positions des 5 zones de mur (M1..M5)
        self.wall_centers = torch.tensor([
            [250.0, 400.0], [679.3, 570.8], [850.0, 1000.0], [679.3, 1429.5], [250.0, 1600.0]
        ], dtype=torch.float32, device=D)
        self.wall_indices = torch.arange(5, dtype=torch.long, device=D).unsqueeze(0)

    def _init_state_tensors(self):
        B = self.batch_size
        D = self.device

        # Temps écoulé (s)
        self.t = torch.zeros(B, dtype=torch.float32, device=D)

        # Pose robot: x, y, cap (deg)
        self.robot_pose = torch.zeros((B, 3), dtype=torch.float32, device=D)

        # Pose adversaire lidar: x, y
        self.opp_pose = torch.zeros((B, 2), dtype=torch.float32, device=D)

        # 10 paquets (P1..P10): nombre de pierres restantes (3 au départ)
        self.pack_stones = torch.full((B, 10), 3, dtype=torch.long, device=D)

        # Pinces: 2 faces (A=0, B=1). Nombre de pierres tenues (0..3)
        self.held_count = torch.zeros((B, 2), dtype=torch.long, device=D)
        # Orientation pince (0.0 = plat, 90.0 = vertical)
        self.held_rot = torch.zeros((B, 2), dtype=torch.float32, device=D)

        # Graal: 0=home (100, 1180), 1=tenu face A, 2=tenu face B, 3=posé château
        self.graal_state = torch.zeros(B, dtype=torch.long, device=D)
        self.graal_zone = torch.full((B,), -1, dtype=torch.long, device=D)
        self.graal_level = torch.zeros(B, dtype=torch.float32, device=D)

        # Constructions murs: 5 zones (M1..M5). 0=vide, 0.5=mur, 1.0=porte
        self.walls = torch.zeros((B, 5), dtype=torch.float32, device=D)

        # Constructions tours: 4 zones (T1..T4). Nombre de pierres verticales (0..3)
        self.towers = torch.zeros((B, 4), dtype=torch.long, device=D)

        # Boulets
        self.balls_fired = torch.zeros(B, dtype=torch.bool, device=D)
        self.balls_in_cour = torch.zeros(B, dtype=torch.long, device=D)

        # Statut épisode
        self.done = torch.zeros(B, dtype=torch.bool, device=D)
        self.score = torch.zeros(B, dtype=torch.float32, device=D)
        self.errors = torch.zeros(B, dtype=torch.long, device=D)

    def reset(self, scenario: Optional[dict] = None) -> torch.Tensor:
        """Réinitialise tous les environnements du batch."""
        self.t.zero_()

        # Départ jaune: x=250, y=1000, h=0
        self.robot_pose[:, 0] = 250.0
        self.robot_pose[:, 1] = 1000.0
        self.robot_pose[:, 2] = 0.0

        # Lidar adversaire (bleu à 2750, 1000 si présent)
        has_opp = (scenario or {}).get("intensite", "aucun") not in ("aucun", "none")
        if has_opp:
            self.opp_pose[:, 0] = 2750.0
            self.opp_pose[:, 1] = 1000.0
        else:
            self.opp_pose.zero_()

        self.pack_stones.fill_(3)
        self.held_count.zero_()
        self.held_rot.zero_()
        self.graal_state.zero_()
        self.graal_zone.fill_(-1)
        self.graal_level.zero_()
        self.walls.zero_()
        self.towers.zero_()
        self.balls_fired.zero_()
        self.balls_in_cour.zero_()
        self.done.zero_()
        self.errors.zero_()
        self.score = self.compute_score()

        return self.get_obs()

    def get_obs(self) -> torch.Tensor:
        """Calcule les 37 entrées du réseau pour tout le batch en opérations GPU."""
        B = self.batch_size
        D = self.device

        # 1. Temps restant normalisé (1)
        t_rem = torch.clamp((MATCH_DURATION - self.t) / MATCH_DURATION, min=0.0, max=1.0).unsqueeze(1)

        # 2. Pose robot (4): x / 3000, y / 2000, cos(rad), sin(rad)
        rx = (self.robot_pose[:, 0] / 3000.0).unsqueeze(1)
        ry = (self.robot_pose[:, 1] / 2000.0).unsqueeze(1)
        rad = self.robot_pose[:, 2] * (math.pi / 180.0)
        rcos = torch.cos(rad).unsqueeze(1)
        rsin = torch.sin(rad).unsqueeze(1)

        # 3. Paquets restants (10)
        packs = self.pack_stones.float() / 3.0

        # 4. Charges des pinces (6: [pierres/3, à plat (1/0), graal (1/0)] pour A et B)
        # Face A (0)
        hA_n = (self.held_count[:, 0].float() / 3.0).unsqueeze(1)
        hA_flat = ((self.held_count[:, 0] > 0) & (self.held_rot[:, 0] == 0.0) & (self.graal_state != 1)).float().unsqueeze(1)
        hA_graal = (self.graal_state == 1).float().unsqueeze(1)

        # Face B (1)
        hB_n = (self.held_count[:, 1].float() / 3.0).unsqueeze(1)
        hB_flat = ((self.held_count[:, 1] > 0) & (self.held_rot[:, 1] == 0.0) & (self.graal_state != 2)).float().unsqueeze(1)
        hB_graal = (self.graal_state == 2).float().unsqueeze(1)

        # 5. Constructions (9: M1..M5 et T1..T4)
        murs_val = self.walls
        tours_val = (self.towers > 0).float()

        # 6. Graal (4: home, tenu, posé, niveau/4)
        g_home = (self.graal_state == 0).float().unsqueeze(1)
        g_held = ((self.graal_state == 1) | (self.graal_state == 2)).float().unsqueeze(1)
        g_posed = (self.graal_state == 3).float().unsqueeze(1)
        g_lvl = (self.graal_level / 4.0).unsqueeze(1)

        # 7. Boulets (1: tiré 1/0)
        balls_val = self.balls_fired.float().unsqueeze(1)

        # 8. Adversaire (2: x / 3000, y / 2000)
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

    def get_mask(self) -> torch.Tensor:
        """Calcule le masque de validité (B, 106) en tenseur booléen sur GPU de manière 100% vectorisée."""
        B = self.batch_size
        D = self.device
        mask = torch.zeros((B, 106), dtype=torch.bool, device=D)

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

        # 4. PORTE (64..83) - 1 seule par château selon règlement Eurobot
        has_door = (self.walls == 1.0).any(dim=1, keepdim=True)
        mask_porte = face_flat_m & zone_free_m & (~has_door)
        # Exclure les zones où la porte heurte inévitablement les bordures de table (M5 et M1 ext)
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

        # 9. FILTRAGE GÉOMÉTRIQUE STRICT : Interdiction absolue de traverser des caisses
        A_pos = self.robot_pose[:, :2].unsqueeze(1).unsqueeze(2)
        B_tgt = torch.stack([self.action_tx, self.action_ty], dim=1).unsqueeze(0).unsqueeze(2)
        AB_vec = B_tgt - A_pos
        L2_dist = (AB_vec ** 2).sum(dim=-1, keepdim=True).clamp(min=1e-6)

        C_packs = self.pack_centers.unsqueeze(0).unsqueeze(0)
        AC_vec = C_packs - A_pos
        u_proj = ((AC_vec * AB_vec).sum(dim=-1, keepdim=True) / L2_dist).clamp(0.0, 1.0)
        P_proj = A_pos + u_proj * AB_vec
        dist_to_packs = torch.hypot(C_packs[..., 0] - P_proj[..., 0], C_packs[..., 1] - P_proj[..., 1]).squeeze(-1)

        fam_t = self.action_family.unsqueeze(0).unsqueeze(-1)
        item_t = self.action_item.unsqueeze(0).unsqueeze(-1)
        target_pk = torch.where(fam_t == 0, item_t, torch.full_like(item_t, -1))

        active_stones = (self.pack_stones > 0).unsqueeze(1)
        pack_idx = self.pack_indices.unsqueeze(1)
        is_obstacle = active_stones & (pack_idx != target_pk)

        hits_obstacle = ((dist_to_packs < 235.0) & is_obstacle).any(dim=-1)
        mask = mask & (~hits_obstacle)

        # 10. ANTICIPATION DU RETOUR AU TRÔNE : Laisser place et passage dégagé vers le trône
        T_pos = torch.tensor([250.0, 1000.0], device=self.device).unsqueeze(0).unsqueeze(1).unsqueeze(2)
        BT_vec = T_pos - B_tgt
        L2_ret = (BT_vec ** 2).sum(dim=-1, keepdim=True).clamp(min=1e-6)
        BC_vec = C_packs - B_tgt
        u_ret = ((BC_vec * BT_vec).sum(dim=-1, keepdim=True) / L2_ret).clamp(0.0, 1.0)
        P_proj_ret = B_tgt + u_ret * BT_vec
        dist_to_throne = torch.hypot(C_packs[..., 0] - P_proj_ret[..., 0], C_packs[..., 1] - P_proj_ret[..., 1]).squeeze(-1)

        # Pour les actions hors trône et boulets, le chemin de retour doit être libre
        blocks_throne = ((dist_to_throne < 235.0) & is_obstacle).any(dim=-1)
        not_throne_act = (fam_t.squeeze(-1) != 4) & (fam_t.squeeze(-1) != 7)
        mask = mask & (~(blocks_throne & not_throne_act))

        # 11. BUDGET TEMPS D'ANTICIPATION : Garantir le temps de rentrer et tirer les boulets (<= 100s)
        dist_AB = torch.hypot(B_tgt[..., 0].squeeze(-1) - A_pos[..., 0].squeeze(-1),
                              B_tgt[..., 1].squeeze(-1) - A_pos[..., 1].squeeze(-1))
        dt_action = dist_AB / SPEED_LIN + self.action_mech.unsqueeze(0)
        dist_to_throne_ret = torch.hypot(250.0 - self.action_tx.unsqueeze(0), 1000.0 - self.action_ty.unsqueeze(0))
        dt_throne_ret = dist_to_throne_ret / SPEED_LIN + 0.5
        dt_tir_requis = torch.where(~self.balls_fired, 6.1, 0.0).unsqueeze(1)
        t_previsionnel = self.t.unsqueeze(1) + dt_action + dt_throne_ret + dt_tir_requis
        out_of_time = (t_previsionnel > 100.0) & not_throne_act
        mask = mask & (~out_of_time)

        # Si aucune action n'est libre, le trône permet le désengagement
        none_valid = ~mask.any(dim=1)
        mask[none_valid, 105] = True

        return mask

    def get_live_mask(self) -> torch.Tensor:
        """Applique les contraintes temps-réel (masque le trône avant 88s si actions utiles)."""
        mask = self.get_mask().clone()
        B = self.batch_size

        # Optimisation double-face : si en table (x > 500), une face pleine et une vide,
        # et paquets disponibles avant 75s, masquer mur/tour/porte
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

        useful = mask[:, :105].any(dim=1)
        early_useful = useful & (self.t < 88.0)
        early_balls = (~self.balls_fired) & (~useful) & (self.t < 80.0)

        mask[early_useful | early_balls, 105] = False

        # Si aucune action n'est valide, on autorise le trône
        none_valid = ~mask.any(dim=1)
        mask[none_valid, 105] = True

        return mask

    def compute_score(self) -> torch.Tensor:
        """Calcule le score officiel Eurobot 2027 vectorisé sur GPU."""
        # 1. Pierres dans nos zones (1 pt chacune)
        # Mur = 3 pierres, Porte = 3 pierres, Tour = max 1 pierre par tour
        n_murs = (self.walls == 0.5).sum(dim=1)
        n_portes = (self.walls == 1.0).sum(dim=1)
        n_pierres_murs = (n_murs + n_portes) * 3
        n_pierres_tours = torch.clamp(self.towers, 0, 1).sum(dim=1)
        sc_pierres = (n_pierres_murs + n_pierres_tours).float() * BAREME["pierre"]

        # 2. Murs complets (5 pts chacun)
        sc_murs = n_murs.float() * BAREME["mur"]

        # 3. Portes (20 pts chacune, max 1 par château selon règlement)
        sc_portes = (n_portes > 0).float() * BAREME["porte"]

        # 4. Tours (5 pts chacune, max 1 par zone circulaire)
        sc_tours = (self.towers > 0).sum(dim=1).float() * BAREME["tour"]

        # 5. Graal posé (5 pts présence + 5 pts par niveau) - seulement sur zone réellement construite
        g_in = self.graal_state == 3
        z = self.graal_zone
        is_wall_zone = (z >= 0) & (z < 5)
        is_tower_zone = (z >= 5) & (z < 9)
        wall_built = torch.where(is_wall_zone, self.walls.gather(1, torch.clamp(z, 0, 4).unsqueeze(1)).squeeze(1) > 0, torch.zeros_like(g_in))
        tower_built = torch.where(is_tower_zone, self.towers.gather(1, torch.clamp(z - 5, 0, 3).unsqueeze(1)).squeeze(1) > 0, torch.zeros_like(g_in))
        has_build = wall_built | tower_built
        valid_graal = g_in & has_build
        sc_graal = torch.where(valid_graal, BAREME["graalPresent"] + self.graal_level * BAREME["graalNiveau"], 0.0)

        # 6. Retour dans la salle du trône (x in [0, 500], y in [750, 1250])
        rx = self.robot_pose[:, 0]
        ry = self.robot_pose[:, 1]
        in_throne = (rx >= 0.0) & (rx <= 500.0) & (ry >= 750.0) & (ry <= 1250.0)
        sc_trone = torch.where(in_throne, BAREME["retourComplet"], 0.0)

        # 7. Boulets arrêtés dans la cour adverse (5 pts si >= 1, +15 si >= 3)
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

        mask = self.get_mask()
        # Masque des actions valides
        batch_idx = torch.arange(B, device=D)
        is_valid = mask[batch_idx, actions]

        # Invalides: incrémenter compteur d'erreurs
        self.errors += (~is_valid).long()

        old_score = self.score

        # Pour les environnements non terminés
        active = ~self.done

        # Coordonnées cibles pour chaque environnement
        tx = self.action_tx[actions]
        ty = self.action_ty[actions]
        th = self.action_th[actions]
        mech = self.action_mech[actions]
        fam = self.action_family[actions]
        f_idx = self.action_face[actions]
        item = self.action_item[actions]

        # Déplacement robot
        dx = tx - self.robot_pose[:, 0]
        dy = ty - self.robot_pose[:, 1]
        dist = torch.hypot(dx, dy)

        dh = torch.abs((th - self.robot_pose[:, 2] + 180.0) % 360.0 - 180.0)

        dt_lin = dist / SPEED_LIN
        dt_rot = dh / SPEED_ROT
        dt_move = torch.maximum(dt_lin, dt_rot)

        if self.pipelined_mech:
            # Pipelining matériel Dual ESP32 : pré-positionnement en roulant (70% du temps mech masqué)
            # et saisie / pose finale au contact (30% du temps mech)
            dt_pre = mech * 0.70
            dt_contact = mech * 0.30
            dt_transit = torch.maximum(dt_move, dt_pre)
            dt_total = dt_transit + dt_contact
        else:
            dt_total = dt_move + mech

        # Détection de collision vectorisée du trajet A -> B AVANT toute action
        A = self.robot_pose[:, :2]
        B_target = torch.stack([tx, ty], dim=1)
        AB = (B_target - A).unsqueeze(1)
        L2 = (AB ** 2).sum(dim=-1, keepdim=True).clamp(min=1e-6)

        # 1. Collision avec paquets / caisses non pris (seuil 235 mm)
        C_pk = self.pack_centers.unsqueeze(0)
        AC_pk = C_pk - A.unsqueeze(1)
        u_pk = ((AC_pk * AB).sum(dim=-1, keepdim=True) / L2).clamp(0.0, 1.0)
        P_proj_pk = A.unsqueeze(1) + u_pk * AB
        dist_pk = torch.hypot(C_pk[..., 0] - P_proj_pk[..., 0], C_pk[..., 1] - P_proj_pk[..., 1])

        target_pack = torch.where(fam == 0, item, -1).unsqueeze(1)
        pack_is_obstacle = (self.pack_stones > 0) & (self.pack_indices != target_pack)
        hit_pack = active & is_valid & ((dist_pk < 235.0) & pack_is_obstacle).any(dim=1)

        # 2. Collision avec adversaire (seuil 350 mm)
        has_opp = (self.opp_pose[:, 0] > 0) & (self.opp_pose[:, 1] > 0)
        C_opp = self.opp_pose.unsqueeze(1)
        AC_opp = C_opp - A.unsqueeze(1)
        u_opp = ((AC_opp * AB).sum(dim=-1, keepdim=True) / L2).clamp(0.0, 1.0)
        P_proj_opp = A.unsqueeze(1) + u_opp * AB
        dist_opp = torch.hypot(C_opp[..., 0] - P_proj_opp[..., 0], C_opp[..., 1] - P_proj_opp[..., 1]).squeeze(1)
        hit_opp = active & is_valid & has_opp & (dist_opp < 350.0)

        has_col = hit_pack | hit_opp
        self.errors += has_col.long()
        if self.on_error == "fin":
            self.done = self.done | has_col

        # SUCCÈS : L'action ne s'exécute QUE si elle est valide, active ET sans collision
        # En cas de collision : le robot est bloqué sur place, aucun objet pris, aucun mur posé !
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
            self.held_count[idx_b, f_idx[idx_b]] = torch.clamp(self.held_count[idx_b, f_idx[idx_b]] - 1, min=0)
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
            self.graal_level[idx_b] = 3.0

        # 8. TRÔNE (fam == 7)
        mask_trone = success & (fam == 7)
        if mask_trone.any():
            idx_b = torch.where(mask_trone)[0]
            self.t[idx_b] = torch.maximum(self.t[idx_b], torch.full_like(self.t[idx_b], MATCH_DURATION))

        # Le robot ne bouge que pour les actions RÉELLEMENT sans collision !
        self.robot_pose[success, 0] = tx[success]
        self.robot_pose[success, 1] = ty[success]
        self.robot_pose[success, 2] = th[success]

        # Avancement du temps (sauf pour boulets et trône déjà traités)
        not_special = active & (fam != 4) & (fam != 7)
        self.t[not_special] += dt_total[not_special]

        # Fin d'épisode si t >= 100 s
        self.done = self.done | (self.t >= MATCH_DURATION)

        # Nouveau score et récompense
        self.score = self.compute_score()
        rewards = self.score - old_score

        info = {
            "score": self.score,
            "errors": self.errors,
            "t": self.t,
            "dt": dt_total,
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

        # Clôture du match à 100 s
        self.t = torch.maximum(self.t, torch.full_like(self.t, MATCH_DURATION))
        self.done.fill_(True)
        self.score = self.compute_score()

        return {
            "score": self.score,
            "T": self.t,
            "errors": self.errors,
            "steps": step_i + 1,
        }
