"""
Empirical Challenger Test Suite for Milestone 1 Observation Tensors & Distance Radar Raycasting.
Requirement R5, Features F10, F11, F12.
"""

import json
import math
import subprocess
import pytest
import torch

from trainer.torch_engine import TorchEnv, MATCH_DURATION


DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
BATCH_SIZES = [1, 16, 256]
DEVICES = ["cpu"] + (["cuda"] if torch.cuda.is_available() else [])


# -----------------------------------------------------------------------------
# Part 1: Batch Sizes (1, 16, 256) across CPU and GPU
# -----------------------------------------------------------------------------

@pytest.mark.parametrize("device", DEVICES)
@pytest.mark.parametrize("batch_size", BATCH_SIZES)
def test_obs_tensor_shapes_and_types(device, batch_size):
    """Verify (B, 56) float32 tensor across batch sizes on CPU and GPU."""
    env = TorchEnv(batch_size=batch_size, device=device)
    obs = env.get_obs()

    assert obs.shape == (batch_size, 56), f"Expected shape ({batch_size}, 56), got {obs.shape}"
    assert obs.dtype == torch.float32, f"Expected float32, got {obs.dtype}"
    assert obs.device.type == device, f"Expected device {device}, got {obs.device.type}"
    assert torch.isfinite(obs).all(), "Observation contains NaN or Inf values"


@pytest.mark.parametrize("device", DEVICES)
@pytest.mark.parametrize("batch_size", BATCH_SIZES)
def test_obs_values_bounded_and_non_negative(device, batch_size):
    """Verify that all observation slices conform to physical range constraints."""
    env = TorchEnv(batch_size=batch_size, device=device)
    obs = env.get_obs()

    # Time remaining in [0, 1]
    t_rem = obs[:, 0]
    assert (t_rem >= 0.0).all() and (t_rem <= 1.0).all()

    # Pose: x/3000, y/2000 in [0, 1], cos, sin in [-1, 1]
    rx = obs[:, 1]
    ry = obs[:, 2]
    rcos = obs[:, 3]
    rsin = obs[:, 4]
    assert (rx >= 0.0).all() and (rx <= 1.0).all()
    assert (ry >= 0.0).all() and (ry <= 1.0).all()
    assert (rcos >= -1.0 - 1e-5).all() and (rcos <= 1.0 + 1e-5).all()
    assert (rsin >= -1.0 - 1e-5).all() and (rsin <= 1.0 + 1e-5).all()

    # Packs (10) in [0, 1]
    packs = obs[:, 5:15]
    assert (packs >= 0.0).all() and (packs <= 1.0).all()

    # Face A & B load flags (6) in [0, 1]
    faces = obs[:, 15:21]
    assert (faces >= 0.0).all() and (faces <= 1.0).all()

    # Constructions (9)
    murs = obs[:, 21:26]
    tours = obs[:, 26:30]
    assert (murs >= 0.0).all() and (murs <= 2.0).all()
    assert (tours >= 0.0).all() and (tours <= 1.0).all()

    # Graal (4)
    graal = obs[:, 30:34]
    assert (graal >= 0.0).all() and (graal <= 1.0).all()

    # Boulets (1) and Opponent (2)
    boulets = obs[:, 34]
    opp = obs[:, 35:37]
    assert (boulets >= 0.0).all() and (boulets <= 1.0).all()
    assert (opp >= 0.0).all() and (opp <= 1.0).all()

    # Proprioception (11)
    # vA (3), rotA (1), hcA (1), vB (3), rotB (1), hcB (1), hull (1)
    proprio = obs[:, 37:48]
    assert (proprio >= 0.0).all() and (proprio <= 1.0).all(), (
        f"Proprioception out of [0, 1]: min={proprio.min().item()}, max={proprio.max().item()}"
    )

    # 8 Radar rays in [0, 1]
    radar = obs[:, 48:56]
    assert (radar >= 0.0).all() and (radar <= 1.0).all(), (
        f"Radar rays out of [0, 1]: min={radar.min().item()}, max={radar.max().item()}"
    )


# -----------------------------------------------------------------------------
# Part 2: 8 Radar Rays Under Extreme Poses
# -----------------------------------------------------------------------------

EXTREME_POSES = [
    # (x, y, heading_deg, description)
    (0.0, 0.0, 0.0, "Bottom-left corner heading 0°"),
    (0.0, 0.0, 45.0, "Bottom-left corner heading 45°"),
    (3000.0, 0.0, 0.0, "Bottom-right corner heading 0°"),
    (3000.0, 0.0, 180.0, "Bottom-right corner heading 180°"),
    (0.0, 2000.0, 0.0, "Top-left corner heading 0°"),
    (0.0, 2000.0, 270.0, "Top-left corner heading 270°"),
    (3000.0, 2000.0, 0.0, "Top-right corner heading 0°"),
    (3000.0, 2000.0, 225.0, "Top-right corner heading 225°"),
    # Table center
    (1500.0, 1000.0, 0.0, "Table center heading 0°"),
    (1500.0, 1000.0, 45.0, "Table center heading 45°"),
    (1500.0, 1000.0, 90.0, "Table center heading 90°"),
    (1500.0, 1000.0, 180.0, "Table center heading 180°"),
    # Touching borders
    (70.0, 1000.0, 180.0, "Touching west border looking west"),
    (2930.0, 1000.0, 0.0, "Touching east border looking east"),
    (1500.0, 70.0, 270.0, "Touching south border looking south"),
    (1500.0, 1930.0, 90.0, "Touching north border looking north"),
    # Inside castle
    (400.0, 1000.0, 0.0, "Inside castle center"),
    (250.0, 400.0, 45.0, "Inside castle near wall M1"),
    (500.0, 1600.0, 135.0, "Inside castle near tower T4"),
    # Directly next to walls (5 walls)
    (250.0, 400.0 - 220.0, 90.0, "Facing wall M1 from south"),
    (679.3, 570.8 - 220.0, 90.0, "Facing wall M2 from south"),
    (850.0, 1000.0 - 220.0, 90.0, "Facing wall M3 from south"),
    (679.3, 1429.5 - 220.0, 90.0, "Facing wall M4 from south"),
    (250.0, 1600.0 - 220.0, 90.0, "Facing wall M5 from south"),
    # Directly next to towers (4 towers)
    (500.0 - 220.0, 400.0, 0.0, "Facing tower T1 from west"),
    (850.0 - 220.0, 750.0, 0.0, "Facing tower T2 from west"),
    (850.0 - 220.0, 1250.0, 0.0, "Facing tower T3 from west"),
    (500.0 - 220.0, 1600.0, 0.0, "Facing tower T4 from west"),
]


@pytest.mark.parametrize("pose", EXTREME_POSES, ids=[p[3] for p in EXTREME_POSES])
@pytest.mark.parametrize("device", DEVICES)
def test_radar_extreme_poses_integrity(pose, device):
    """Stress-test 8 radar rays under extreme poses with active walls and towers."""
    x, y, h, desc = pose
    env = TorchEnv(batch_size=1, device=device)

    # Force robot pose
    env.robot_pose[0, 0] = x
    env.robot_pose[0, 1] = y
    env.robot_pose[0, 2] = h

    # Activate walls and towers so ray-circle intersections are actively exercised
    env.walls[0, :] = 1.0  # all 5 walls built
    env.towers[0, :] = 1   # all 4 towers built

    obs = env.get_obs()
    radar = obs[0, 48:56]

    # 1. Finite check (no NaN, no Inf)
    assert torch.isfinite(radar).all(), f"NaN or Inf in radar at {desc}: {radar}"

    # 2. Clamped non-negative check
    assert (radar >= 0.0).all(), f"Negative radar distance at {desc}: {radar}"

    # 3. Normalized upper bound check
    assert (radar <= 1.0).all(), f"Radar exceeds 1.0 at {desc}: {radar}"


def test_radar_table_center_exact_border_distances():
    """Verify exact theoretical border distances from table center (1500, 1000)."""
    env = TorchEnv(batch_size=1, device=DEVICE)
    # Empty table
    env.pack_stones.fill_(0)
    env.walls.fill_(0.0)
    env.towers.fill_(0)

    # Robot at center (1500, 1000) heading 0° (facing East)
    env.robot_pose[0, 0] = 1500.0
    env.robot_pose[0, 1] = 1000.0
    env.robot_pose[0, 2] = 0.0

    radar = env.compute_distance_radar()[0].cpu()
    # Ray 0: East (ux=1, uy=0) -> dist to x=2930 is 1430 mm -> clamped to 1000 mm -> 1.0
    assert math.isclose(radar[0].item(), 1.0, abs_tol=1e-4)

    # Ray 2: North (ux=0, uy=1, angle 90°) -> dist to y=1930 is (1930 - 1000) = 930 mm -> 0.93
    assert math.isclose(radar[2].item(), 0.93, abs_tol=1e-4)

    # Ray 4: West (ux=-1, uy=0, angle 180°) -> dist to x=70 is (1500 - 70) = 1430 mm -> clamped to 1.0
    assert math.isclose(radar[4].item(), 1.0, abs_tol=1e-4)

    # Ray 6: South (ux=0, uy=-1, angle 270°) -> dist to y=70 is (1000 - 70) = 930 mm -> 0.93
    assert math.isclose(radar[6].item(), 0.93, abs_tol=1e-4)


def test_radar_detects_approaching_obstacle():
    """Verify that moving towards a wall strictly decreases the forward radar ray."""
    env = TorchEnv(batch_size=1, device=DEVICE)
    env.pack_stones.fill_(0)
    env.towers.fill_(0)
    env.walls.fill_(0.0)

    # Build wall M3 at (850, 1000)
    env.walls[0, 2] = 1.0

    # Test at distances 600 mm, 400 mm, 250 mm facing wall M3 (facing West, heading 180°)
    distances = [600.0, 450.0, 300.0]
    forward_rays = []

    for d in distances:
        env.robot_pose[0, 0] = 850.0 + d
        env.robot_pose[0, 1] = 1000.0
        env.robot_pose[0, 2] = 180.0  # looking directly at wall M3
        radar = env.compute_distance_radar()[0].cpu()
        forward_ray = radar[0].item()  # forward ray is ray 0
        forward_rays.append(forward_ray)

    # Distances must be strictly decreasing
    assert forward_rays[0] > forward_rays[1] > forward_rays[2], (
        f"Forward rays not strictly decreasing: {forward_rays}"
    )
    # Check that distance to obstacle radius 210 mm matches geometry
    # At d=300 mm from center, dist to border of wall (r=210) is 300 - 210 = 90 mm -> 0.09
    assert math.isclose(forward_rays[2], (300.0 - 210.0) / 1000.0, abs_tol=0.01)


# -----------------------------------------------------------------------------
# Part 3: PyTorch TorchEnv.get_obs() vs JS env.observe() Numerical Parity
# -----------------------------------------------------------------------------

def get_js_observation(state_override=None):
    """Query JavaScript engine env.observe() via Node.js CLI."""
    js_script = """
    var path = require('path');
    var loadIcamlot = require('./engine/load.js').loadIcamlot;
    var ctx = loadIcamlot(path.resolve('.'));
    var ENV = ctx.ENV, ACTIONS = ctx.ACTIONS;

    var env = ENV.create({ skipContacts: true, adversaire: { intensite: 'aucun' } });
    var s = env.reset({});
    var sim = env.sim;

    // Optional overrides
    var overrides = %OVERRIDES%;
    if (overrides) {
        if (overrides.pose) {
            sim.pose().x = overrides.pose.x;
            sim.pose().y = overrides.pose.y;
            sim.pose().h = overrides.pose.h;
        }
        if (overrides.A) {
            sim.pose().A.rot = overrides.A.rot;
            sim.pose().A.hc = overrides.A.hc;
            sim.pose().A.vac = overrides.A.vac;
        }
        if (overrides.B) {
            sim.pose().B.rot = overrides.B.rot;
            sim.pose().B.hc = overrides.B.hc;
            sim.pose().B.vac = overrides.B.vac;
        }
        var belief = ENV.makeBelief();
        var obs = ENV.observe(sim, null, belief, { x: 0, y: 0 });
        console.log(JSON.stringify(obs));
    } else {
        console.log(JSON.stringify(s.obs));
    }
    """.replace("%OVERRIDES%", json.dumps(state_override) if state_override else "null")

    res = subprocess.run(["node", "-e", js_script], capture_output=True, text=True, check=True)
    return json.loads(res.stdout.strip())


def test_parity_match_start_initial_obs():
    """Compare initial match reset observation between PyTorch and JavaScript."""
    # 1. Get JS observation
    js_obs = get_js_observation()
    assert len(js_obs) == 56, f"Expected 56 elements from JS observe(), got {len(js_obs)}"

    # 2. Get PyTorch observation for default start
    env = TorchEnv(batch_size=1, device="cpu")
    torch_obs = env.reset()[0].tolist()
    env.robot_pose[0, 2] = 0.0
    env.t[0] = 0.0
    env.held_count.fill_(0)
    env.held_vac.fill_(0.0)
    env.held_rot.fill_(0.0)
    env.held_hc.fill_(165.0)

    torch_obs = env.get_obs()[0].tolist()

    # Compare legacy features (0..36)
    # 0: Time
    assert math.isclose(torch_obs[0], js_obs[0], abs_tol=1e-4)
    # 1..4: Robot pose
    for i in range(1, 5):
        assert math.isclose(torch_obs[i], js_obs[i], abs_tol=1e-4), f"Mismatch at pose feature {i}: {torch_obs[i]} vs {js_obs[i]}"
    # 5..14: Packs
    for i in range(5, 15):
        assert math.isclose(torch_obs[i], js_obs[i], abs_tol=1e-4), f"Mismatch at pack feature {i}: {torch_obs[i]} vs {js_obs[i]}"
    # 15..20: Faces
    for i in range(15, 21):
        assert math.isclose(torch_obs[i], js_obs[i], abs_tol=1e-4), f"Mismatch at face feature {i}: {torch_obs[i]} vs {js_obs[i]}"
    # 21..29: Constructions
    for i in range(21, 30):
        assert math.isclose(torch_obs[i], js_obs[i], abs_tol=1e-4), f"Mismatch at construction feature {i}: {torch_obs[i]} vs {js_obs[i]}"
    # 30..33: Graal
    for i in range(30, 34):
        assert math.isclose(torch_obs[i], js_obs[i], abs_tol=1e-4), f"Mismatch at graal feature {i}: {torch_obs[i]} vs {js_obs[i]}"
    # 34: Boulets
    assert math.isclose(torch_obs[34], js_obs[34], abs_tol=1e-4)
    # 35..36: Opponent
    assert math.isclose(torch_obs[35], js_obs[35], abs_tol=1e-4)
    assert math.isclose(torch_obs[36], js_obs[36], abs_tol=1e-4)

    # Compare Proprioception features (37..47)
    # 37..39: Face A vac
    for i in range(37, 40):
        assert math.isclose(torch_obs[i], js_obs[i], abs_tol=1e-4), f"Mismatch at Face A vac {i}: {torch_obs[i]} vs {js_obs[i]}"
    # 40: rotA
    assert math.isclose(torch_obs[40], js_obs[40], abs_tol=1e-4)
    # 41: hcA (165 / 350)
    assert math.isclose(torch_obs[41], js_obs[41], abs_tol=1e-4)
    # 42..44: Face B vac
    for i in range(42, 45):
        assert math.isclose(torch_obs[i], js_obs[i], abs_tol=1e-4), f"Mismatch at Face B vac {i}: {torch_obs[i]} vs {js_obs[i]}"
    # 45: rotB
    assert math.isclose(torch_obs[45], js_obs[45], abs_tol=1e-4)
    # 46: hcB (165 / 350)
    assert math.isclose(torch_obs[46], js_obs[46], abs_tol=1e-4)
    # 47: Hull radius
    assert math.isclose(torch_obs[47], js_obs[47], abs_tol=1e-4)

    # Compare Radar features (48..55)
    # JS steps in 50 mm increments (0.05 step), PyTorch is continuous analytical raycast.
    # Therefore, disparity must be within 1 discrete step (<= 0.05).
    radar_disparities = [abs(torch_obs[48 + k] - js_obs[48 + k]) for k in range(8)]
    max_disparity = max(radar_disparities)
    assert max_disparity <= 0.05, f"Radar disparity between PyTorch and JS exceeds 50 mm step: {max_disparity}"


def test_parity_with_loaded_grippers_and_rotated_faces():
    """Verify parity when grippers are loaded, rotated at 90°, and elevated."""
    state_override = {
        "pose": {"x": 1200.0, "y": 800.0, "h": 45.0},
        "A": {"rot": 90, "hc": 250, "vac": [1, 1, 0]},
        "B": {"rot": 0, "hc": 165, "vac": [0, 0, 0]}
    }
    js_obs = get_js_observation(state_override)

    env = TorchEnv(batch_size=1, device="cpu")
    env.robot_pose[0, 0] = 1200.0
    env.robot_pose[0, 1] = 800.0
    env.robot_pose[0, 2] = 45.0

    env.held_vac[0, 0, :] = torch.tensor([1.0, 1.0, 0.0])
    env.held_rot[0, 0] = 90.0
    env.held_hc[0, 0] = 250.0
    env.held_count[0, 0] = 2

    env.held_vac[0, 1, :] = torch.tensor([0.0, 0.0, 0.0])
    env.held_rot[0, 1] = 0.0
    env.held_hc[0, 1] = 165.0
    env.held_count[0, 1] = 0

    torch_obs = env.get_obs()[0].tolist()

    # Verify Face A proprioception
    assert math.isclose(torch_obs[37], 1.0, abs_tol=1e-4)
    assert math.isclose(torch_obs[38], 1.0, abs_tol=1e-4)
    assert math.isclose(torch_obs[39], 0.0, abs_tol=1e-4)
    assert math.isclose(torch_obs[40], 1.0, abs_tol=1e-4)  # 90 / 90
    assert math.isclose(torch_obs[41], 250.0 / 350.0, abs_tol=1e-4)

    # Parity with JS for all proprioception
    for i in range(37, 48):
        assert math.isclose(torch_obs[i], js_obs[i], abs_tol=1e-4), (
            f"Proprioception mismatch at index {i}: PyTorch={torch_obs[i]}, JS={js_obs[i]}"
        )
