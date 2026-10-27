# Project: icamlot AI — Low-Level Trajectory & Actuator Control Refactoring

## Architecture
The system refactors the Eurobot simulation, perception, neural architecture, web simulator, and edge deployment runners to grant the neural model full low-level control over trajectories, multi-angle approaches, and actuators, eliminating physical and geometric blockage modes:
- **Simulation Layer (`engine/actions.js`, `engine/engine.js`, `trainer/actions_table.json`, `trainer/torch_engine.py`)**:
  - Unblocking post-tower grippers via `deposerZone` / `lacher` and `tournerPince` (0° $\leftrightarrow$ 90° reorientation).
  - Packet re-pickup lifting `x.cur.k === 'home'` and partial pickup.
  - Dynamic multi-angle approach targets: dual opposing approaches for P1..P10, 4 cardinal approaches for towers T1..T4 and Graal, with automated fastest collision-free angle selection.
  - 8 repositioning navigation waypoints (`traj`) to key table crossroads.
  - Adaptive placement (`pm: 'proche'`) in `toProgramStep` and automated transit carriage clearance (`hc = 250` mm) in `travel`.
- **Perception & Observation Layer (`trainer/torch_engine.py`, `engine/env.js`)**:
  - Enriched 56-dimensional observation tensor: 37 legacy features + 11 proprioceptive variables per face (stones per suction cup, rotation angle, carriage height, hull radius) + 8-direction virtual distance radar rays (0°, 45°, 90°, 135°, 180°, 225°, 270°, 315° relative to robot chassis against borders, crates, walls, towers).
  - Mathematical parity between PyTorch GPU vectorized raycasting and JS environment observations.
- **Neural Multi-Head Architecture Layer (`trainer/models.py`, `trainer/ppo_trainer.py`)**:
  - Factorized multi-head `RecurrentActorCritic` branching from residual GRU-128:
    1. Primary discrete action logits head
    2. Low-level approach parameter head (approach angle $\phi$ / side ext, int, proche)
    3. Low-level actuator parameter head (transit gripper folding $0^\circ \leftrightarrow 90^\circ$)
  - Multi-head joint policy log-prob and entropy PPO clipped surrogate training loop.
- **Web Simulator & Edge Deployment Layer (`cerveau/net.js`, `engine/env.js`, `plateau/app.js`, `trainer/export_onnx.py`, `pi5_runner.py`)**:
  - Pure JS recurrent GRUCell / factorized encoder runtime in `cerveau/net.js` and `plateau/app.js`.
  - Physical safety fallback in `engine/env.js`: speculative candidate step in `sim.snapshot()`, collision detection, rollback, action masking, and re-selection of the next best prediction.
  - Clean ONNX opset 18 export isolating `Pi5ActorWrapper` with multi-head outputs and zero-PyTorch $< 5\text{ ms}$ CPU execution in `pi5_runner.py`.

---

## Feature Inventory
Every feature from the Survey phase appears here with its assigned milestone.

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Gripper Unblocking `deposerZone` | Drop 1-2 remaining stones into construction zone (+1 pt bareme) or buffer, freeing face | M1 | R1 |
| F2 | Gripper Reorientation `tournerPince` | Rotate gripper face between 0° (flat, 320 mm) and 90° (vertical, 110 mm) | M1 | R1 |
| F3 | Packet Re-Pickup & Partial Pickup | Lift `x.cur.k === 'home'` restriction in `packetStacked`; allow partial pickup | M1 | R1 |
| F4 | Opposing Dual Approaches (P1..P10) | North/South for P1..P8, West/East for P9..P10 | M1 | R2 |
| F5 | 4 Cardinal Approaches (T1..T4, Graal) | Exterior, Interior, Top, Bottom at offset 170.5 mm | M1 | R2 |
| F6 | Fast Multi-Angle Path Selection | Validate action if $\ge 1$ approach is collision-free; pick fastest approach in `get_mask()`/`step()` | M1 | R2 |
| F7 | 8 Navigation Crossroads (`traj`) | Repositioning actions to 8 crossroads: (1050,450), (1050,1550), (1050,1000), (1500,280), (1500,1720), (1500,1000), (500,220), (500,1780) | M1 | R3 |
| F8 | Adaptive Placement `pm: 'proche'` | Set `pm: 'proche'` in `toProgramStep` for walls, towers, doors to test candidate offset poses | M1 | R4 |
| F9 | Transit Z-Axis Clearance | Automatically raise carriage to `hc = 250` mm during transit carrying stones | M1 | R4 |
| F10 | Enriched Proprioception | Stone count per cup, gripper rotation `rot / 90.0`, height `hc / 350.0`, radius `hullRadius / 350.0` | M1 | R5 |
| F11 | 8-Direction Distance Radar | 8 rays (0°..315° step 45°) relative to chassis against borders, crates, walls, towers | M1 | R5 |
| F12 | 56-Dim Observation Parity | Unified 56-dim tensor in `torch_engine.py` and `engine/env.js` with exact normalization | M1 | R5 |
| F13 | Multi-Head `RecurrentActorCritic` | Primary action head + approach parameter head + transit gripper folding head | M2 | R6 |
| F14 | Multi-Head PPO Training Loop | Factorized joint policy loss, multi-head entropy, and backprop in `ppo_trainer.py` | M2 | R6 |
| F15 | Web Sim Recurrent Runtime | Support 56-dim observations and recurrent GRU in `cerveau/net.js` and `plateau/app.js` | M3 | R7 |
| F16 | Physical Safety Fallback Loop | `sim.snapshot()` $\to$ `exec` $\to$ collision check $\to$ rollback $\to$ mask $\to$ re-query in `engine/env.js` | M3 | R7 |
| F17 | Multi-Head ONNX Model Export | Export `Pi5ActorWrapper` with multi-head logits to opset 18 via `export_onnx.py` | M3 | R7 |
| F18 | Edge CPU Deployment Runner | CPU inference in `pi5_runner.py` with 56-dim observations within $< 5\text{ ms}$ latency budget | M3 | R7 |
| F19 | 100% E2E Test Suite Acceptance | Complete verification of Tiers 1–4 test suite published by E2E Testing Track | M4 | AC |
| F20 | Adversarial Coverage Hardening | Tier 5 white-box challenger stress testing and gap remediation | M4 | AC |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Simulation Kinematics, Actions & Proprioception Radar | F1–F12: R1, R2, R3, R4, R5 in `engine/actions.js`, `engine/engine.js`, `trainer/actions_table.json`, `trainer/torch_engine.py`, `engine/env.js`, `trainer/test_torch_engine.py`, `tests/test_engine.js` | None | PLANNED |
| M2 | Multi-Head Neural Architecture & PPO Training | F13–F14: R6 multi-head actor and PPO training loop in `trainer/models.py`, `trainer/ppo_trainer.py` | M1 | PLANNED |
| M3 | Web Simulator Runtime, Safety Fallback & Edge ONNX Export | F15–F18: R7 web sim runtime, physical safety fallback in `env.js`, ONNX export, and Pi 5 CPU runner in `cerveau/net.js`, `plateau/app.js`, `engine/env.js`, `trainer/export_onnx.py`, `pi5_runner.py` | M1, M2 | PLANNED |
| M4 | Final Milestone: E2E Acceptance & Adversarial Hardening | F19–F20: Phase 1: 100% E2E test pass (Tiers 1–4). Phase 2: Tier 5 adversarial coverage hardening | M1, M2, M3, TEST_READY | PLANNED |

*Note: The **E2E Testing Track Orchestrator** runs in parallel to design, update, and publish the requirement-driven opaque-box test suite (`TEST_INFRA.md` $\to$ `TEST_READY.md`).*

---

## Interface Contracts

### Observation Vector Contract (M1 $\leftrightarrow$ M2 $\leftrightarrow$ M3)
Shape: `(B, 56)` normalized float tensor in PyTorch / `Float64Array(56)` in JS:
- `[0..36]`: Legacy match features (time, poses, scores, stone flags)
- `[37..47]`: 11 Proprioception variables:
  - `obs[37..39]`: Face A suction cups stone count (`held_a_0, held_a_1, held_a_2 \in {0.0, 1.0}`)
  - `obs[40..42]`: Face B suction cups stone count (`held_b_0, held_b_1, held_b_2 \in {0.0, 1.0}`)
  - `obs[43]`: Face A gripper rotation angle (`rot_a / 90.0 \in [0.0, 1.0]`)
  - `obs[44]`: Face B gripper rotation angle (`rot_b / 90.0 \in [0.0, 1.0]`)
  - `obs[45]`: Current carriage height (`hc / 350.0 \in [0.0, 1.0]`)
  - `obs[46]`: Current bounding hull radius (`hullRadius / 350.0 \in [0.0, 1.0]`)
  - `obs[47]`: Gripper transit folding state (`folding \in {0.0, 1.0}`)
- `[48..55]`: 8 Radar distance rays at angles `[0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°]` relative to chassis, normalized by `1000.0 mm`:
  - Clamped to `[0.0, 3.0]` (representing $0\text{ mm}$ to $3000\text{ mm}$).

### Multi-Head Actor Contract (M2 $\leftrightarrow$ M3 $\leftrightarrow$ M4)
```python
class RecurrentActorCritic(nn.Module):
    def forward_actor(self, obs: torch.Tensor, hidden: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Returns:
            primary_logits: (B, num_actions)
            approach_logits: (B, 5)  # [ext, int, proche, north/west, south/east]
            folding_logits: (B, 2)   # [flat 0°, folded 90°]
            next_hidden: (B, 128)
        """
```

### ONNX Export & Edge Runtime Contract (M2 $\leftrightarrow$ M3)
- Exported model inputs:
  - `obs`: `(1, 56)` float32
  - `hidden`: `(1, 128)` float32
- Exported model outputs:
  - `primary_logits`: `(1, num_actions)` float32
  - `approach_logits`: `(1, 5)` float32
  - `folding_logits`: `(1, 2)` float32
  - `next_hidden`: `(1, 128)` float32

---

## Code Layout

```
/root/.gemini/antigravity-cli/scratch/icamlot/
├── engine/
│   ├── actions.js              # M1: Action catalog, deposerZone, tournerPince, multi-angle approaches, waypoints
│   ├── engine.js               # M1: Placement candidates, travel hc=250 carriage clearance, snapshot/restore
│   └── env.js                  # M1 & M3: Observe (56-dim), play physical safety fallback, brainAgent
├── trainer/
│   ├── actions_table.json      # M1: Action table definitions
│   ├── torch_engine.py         # M1: PyTorch GPU simulation, multi-angle approaches, 56-dim obs, radar raycasts
│   ├── models.py               # M2: RecurrentActorCritic multi-head architecture, Pi5ActorWrapper
│   ├── ppo_trainer.py          # M2: Multi-head PPO training loop, joint entropy, auxiliary heads
│   ├── export_onnx.py          # M3: Multi-head ONNX opset 18 export
│   └── test_torch_engine.py    # M1: Unit tests for torch_engine actions, observations, and radar
├── cerveau/
│   └── net.js                  # M3: Pure JS recurrent GRUCell / factorized encoder runtime (56-dim)
├── plateau/
│   └── app.js                  # M3: Web simulator agent integration
├── pi5_runner.py               # M3: Raspberry Pi 5 CPU inference runner (56-dim obs, multi-head output)
├── tests/
│   ├── test_engine.js          # M1: JS engine unit tests
│   └── test_e2e_requirements.py# E2E Track: Comprehensive requirement-driven opaque-box test suite
└── .agents/teamwork/           # Orchestrator & subagent metadata, plans, and coordination files
```
