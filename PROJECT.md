# Project: icamlot AI — Spatial Anticipation and Long-Term Planning

## Architecture
The system integrates GPU-accelerated simulation physics, object-centric entity representation, auxiliary world modeling, and multi-step tree search planning:
- **Simulation Layer (`trainer/torch_engine.py`, `engine/actions.js`)**: Real-time Eurobot table simulation on GPU ($50 \times 75$ grid of $40\text{ mm}$ cells), dynamic obstacle envelope dilation (empty, flat $0^\circ$, upright $90^\circ$), wavefront distance propagation, staging drop zones, packet re-pickup, and procedural curriculum resets.
- **Neural Perception & World Model Layer (`trainer/models.py`, `trainer/ppo_trainer.py`)**: 22-entity object-centric tokenizer, 2-layer self-attention transformer encoder, recurrent GRU policy/value heads, and auxiliary world-model head predicting future spatial states, durations, and contacts.
- **Planning Layer (`trainer/tree_search.py`, `benchmark_duels.py`)**: GPU-batched multi-step tree search (Gumbel AlphaZero / MCTS) evaluating 4–6 step rollouts using top-K policy priors to solve Sokoban blockages and navigate around obstacles.
- **Production Edge Inference Layer (`trainer/export_onnx.py`, `pi5_runner.py`)**: Clean ONNX export via `Pi5ActorWrapper` guaranteeing zero-PyTorch dependency and $< 0.5\text{ ms}$ inference latency on Raspberry Pi 5 CPU.

---

## Feature Inventory
Every feature from the Survey phase is mapped to a milestone below.

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | 2D GPU Distance Grid | $75 \times 50$ cells ($40\text{ mm}$) with wavefront propagation (iterated 2D pooling) | M1 | R1 |
| F2 | Dynamic Envelope Dilation | Dilation radii for empty ($R \approx 230\text{ mm}$), flat $0^\circ$ ($R \approx 276.5\text{ mm}$), upright $90^\circ$ ($R \approx 232\text{ mm}$) | M1 | R1 |
| F3 | Real-Time Topological Closures | Shortest obstacle-avoiding paths and topological closure detection on GPU grid | M1 | R1 |
| F4 | Staging & Relay Drop Zones | Staging zones outside transit corridors (North entrance, South entrance, Center) in `actions.js`, `actions_table.json`, `torch_engine.py` | M1 | R2 |
| F5 | Packet Re-Pickup Mechanics | Update `packetStacked` to permit picking up previously staged/placed packets | M1 | R2 |
| F6 | $90^\circ$ Gripper Folding | Gripper orientation folding during transit to pass narrow corridors | M1 | R2 |
| F7 | Sokoban Curriculum Resets | 50% standard ($t=0$), 30% procedural trapped/puzzle ($t \in [20, 75]$ s), 20% adversarial duels | M1 | R5 |
| F8 | GPU State Cloning & Restoration | Fast deep cloning and restoration of the 16 CUDA simulation state tensors (`clone_state`, `restore_state`) | M1 | R6 |
| F9 | Object-Centric Entity Tokenizer | 22-entity representation (Robot, Opponent, 10 Packets, 9 Construction Zones, Graal) | M2 | R4 |
| F10 | 2-Layer Self-Attention Transformer | Self-attention transformer (`d_model=64, nhead=4, gelu`) replacing flat MLPs in `FactorizedEncoder` | M2 | R4 |
| F11 | Auxiliary World-Model Head | Conditioned on GRU hidden state (128) + action (32) predicting next pose, duration, envelope, contact | M2 | R3 |
| F12 | Auxiliary MSE Loss Integration | Self-supervised auxiliary multi-task loss in `ppo_trainer.py` regularizing recurrent representations | M2 | R3 |
| F13 | Production ONNX Export Isolation | `Pi5ActorWrapper` omitting auxiliary/critic heads, cleanly exporting to opset 18 | M2 | R7 |
| F14 | Edge CPU Inference Verification | `pi5_runner.py` verifying $< 5\text{ ms}$ real-time latency budget on CPU | M2 | R7 |
| F15 | GPU Multi-Step Tree Search | GPU-accelerated Gumbel AlphaZero / MCTS evaluating 4–6 steps with top-K action priors | M3 | R6 |
| F16 | Adversarial Duel Integration | Integration of planned tree search policy into `benchmark_duels.py` against baseline opponents | M3 | R6/R7 |
| F17 | End-to-End PPO Smoke Run | Short training run verifying curriculum sampling and auxiliary loss decrease without leaks | M4 | R7 |
| F18 | 100% E2E Test Suite Acceptance | Complete verification of Tiers 1–4 test suite published by E2E Testing Track | M4 | AC |
| F19 | Adversarial Coverage Hardening | Tier 5 white-box challenger stress testing and gap remediation | M4 | AC |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Simulation Physics, Wavefront Distance Map & Tactical Actions | R1, R2, R5 physics reset, and state clone/restore in `torch_engine.py`, `engine/actions.js`, `actions_table.json`, `trainer/test_torch_engine.py` | None | PLANNED |
| M2 | Entity-Transformer Architecture, Auxiliary World Model & ONNX Export | R3, R4, R7 export isolation in `trainer/models.py`, `trainer/ppo_trainer.py`, `trainer/export_onnx.py`, `pi5_runner.py` | None | PLANNED |
| M3 | GPU Multi-Step Tree Search Planning & Duel Benchmarking | R6, R7 duels in `trainer/tree_search.py`, `benchmark_duels.py` | M1, M2 | PLANNED |
| M4 | Final Milestone: E2E Acceptance & Adversarial Hardening | Phase 1: 100% E2E test pass (Tiers 1–4). Phase 2: Tier 5 adversarial coverage hardening | M1, M2, M3, TEST_READY | PLANNED |

*Note: The **E2E Testing Track Orchestrator** runs in parallel from the outset to design and create the requirement-driven opaque-box test suite (`TEST_INFRA.md` $\to$ `TEST_READY.md`).*

---

## Interface Contracts

### `torch_engine.py` (M1) $\leftrightarrow$ `tree_search.py` (M3)
```python
def clone_state(self) -> dict[str, torch.Tensor]:
    """Returns a detached deep clone of the 16 simulation state tensors."""

def restore_state(self, state_dict: dict[str, torch.Tensor]) -> None:
    """Restores the 16 simulation state tensors in-place."""

def step(self, actions: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, dict]:
    """Steps batch environments forward; returns (obs, rewards, dones, info)."""
```

### `torch_engine.py` (M1) $\leftrightarrow$ `models.py` (M2)
- Input observation vector `obs`: shape `(B, 37)` with standardized normalizations ($X \in [0, 3000]$, $Y \in [0, 2000]$, angle in $[-\pi, \pi]$).
- Environment step `info` dictionary provides auxiliary training targets:
  - `info["dt"]`: transition duration in seconds (float).
  - `info["envelope"]`: `(B, 2)` tensor with envelope length/width.
  - `info["contact"]`: `(B,)` binary float tensor indicating collision or closure.

### `models.py` (M2) $\leftrightarrow$ `tree_search.py` (M3)
```python
def forward_actor(self, obs: torch.Tensor, hidden: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    """Returns (action_logits, next_hidden)."""

def forward_critic(self, obs: torch.Tensor, hidden: torch.Tensor) -> torch.Tensor:
    """Returns scalar state value V(s)."""

def forward_aux(self, hidden: torch.Tensor, actions: torch.Tensor) -> torch.Tensor:
    """Returns (B, 8) auxiliary predictions: [x, y, cos, sin, dt, env_L, env_W, p_contact]."""
```

### `models.py` (M2) $\leftrightarrow$ `export_onnx.py` / `pi5_runner.py` (M2)
- Class `Pi5ActorWrapper(nn.Module)` isolates `(encoder, gru, actor_dense, actor_out)`.
- Input shapes: `obs: (B, 37)`, `hidden: (B, 128)`.
- Output shapes: `logits: (B, 106)`, `next_hidden: (B, 128)`.

---

## Code Layout

```
/root/.gemini/antigravity-cli/scratch/icamlot/
├── trainer/
│   ├── torch_engine.py         # M1: GPU physics, wavefront grid, dynamic envelope, resets, clone/restore
│   ├── test_torch_engine.py    # M1: Unit tests for wavefront distance map, envelope, and curriculum
│   ├── models.py               # M2: EntityTokenizer, TransformerEncoder, FactorizedEncoder, WorldModel, ActorCritic
│   ├── ppo_trainer.py          # M2 & M4: PPO training loop, auxiliary MSE loss, curriculum sampling
│   ├── tree_search.py          # M3: GPUAlphaZeroMCTS, GumbelPlanner
│   └── export_onnx.py          # M2: Pi5ActorWrapper ONNX export
├── engine/
│   ├── actions.js              # M1: Action catalog, staging zones, packetStacked re-pickup
│   └── actions_table.json      # M1: Action definitions table
├── pi5_runner.py               # M2: CPU edge inference runner
├── benchmark_duels.py          # M3: Duel benchmark runner
├── tests/
│   ├── test_engine.js          # JS engine unit tests
│   └── test_e2e_*.py           # E2E Testing Track test cases (Tiers 1–4)
└── .agents/teamwork/           # Agent metadata, plans, and coordination files
```
