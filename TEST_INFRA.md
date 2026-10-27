# Test Infrastructure Specification — icamlot AI Low-Level Control Refactoring (F1–F18)

## 1. Test Philosophy: Requirement-Driven Opaque-Box Methodology

The **icamlot AI** test infrastructure is engineered around the principle of **opaque-box requirement verification**. Rather than inspecting private implementation internals or coupling tests to transient helper methods, tests are derived directly from the authoritative specifications established in `ORIGINAL_REQUEST.md` (Approved Task Prompt 2026-10-27T14:47:40Z, Requirements R1–R7) and `PROJECT.md` (Features F1–F18).

### Core Principles
1. **Opaque-Box Verification**: The test suite evaluates observable behavior, interface contracts, mathematical invariants, tensor shapes, execution timing budgets, and Eurobot rules through public interfaces (`TorchEnv`, `RecurrentActorCritic`, `Pi5ActorWrapper`, `Pi5EurobotAgent`, `export_pi5_onnx`, `actions_table.json`, `engine/actions.js`, `engine/env.js`, `cerveau/net.js`).
2. **Explicit Expected Value Derivation**: Every assertion is derived from formal mathematical properties:
   - Chassis & gripper geometry: flat 0° width $320\text{ mm}$ ($R \approx 276.5\text{ mm}$) vs vertical 90° width $110\text{ mm}$ ($R \approx 232.0\text{ mm}$), nominal triangular robot $a = 400\text{ mm}$ ($R \approx 230.94\text{ mm}$).
   - 8 strategic crossroad waypoints: North Castle Exit (1050, 450), South Castle Exit (1050, 1550), Central West Crossroad (1050, 1000), North Corridor (1500, 280), South Corridor (1500, 1720), Central Point (1500, 1000), North Flank Approach (500, 220), South Flank Approach (500, 1780).
   - 56-dimensional observation tensor: 37 legacy match features + 11 proprioceptive variables per face (cups, rotation, height $hc/350.0$, hull radius $hullRadius/350.0$, transit folding) + 8-direction virtual distance radar rays ($0^\circ..315^\circ$ step $45^\circ$, normalized by $1000.0\text{ mm}$, clamped to $[0.0, 3.0]$).
   - Multi-head actor contract: primary logits $(B, N)$, approach logits $(B, 5)$, folding logits $(B, 2)$, next hidden $(B, 128)$.
   - Official Eurobot 2027 scoring bareme (§E & §F) and deployment constraints ($< 5.0\text{ ms}$ CPU decision latency, ONNX opset 18 compatibility).
3. **Progressive Testability**: The test suite is designed for progressive verification across development milestones (M1–M4). Tests provide clear, informative assertion signals when a feature is present and contractually compliant. For unbuilt features in active or future milestones, tests gracefully skip with clear diagnostic messages (`pytest.skip("Progressive Testability [Fx]: ...")`), allowing early milestone runners to verify already-completed functionality without blocking on unreleased modules.
4. **Zero-Flake Isolation**: Each test is self-contained, creates its own tensors/environment instances with explicit devices and seeds, and cleans up temporary artifacts.

---

## 2. 4-Tier Test Architecture

The testing strategy is structured into four distinct, rigorous tiers:

| Tier | Name | Target Scope | Cardinality | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | **Feature Coverage** | F1 through F18 | $\ge 5$ tests per feature ($90+$ tests) | Isolated happy-path verification of nominal behavior, tensor shapes, interface contracts, and core mechanics. |
| **Tier 2** | **Boundary & Corner Cases** | F1 through F18 | $\ge 5$ tests per feature ($90+$ tests) | Stress testing boundary limits (table coordinates 0/3000/2000 mm, batch sizes 1/256/1024, zero/max stones held, multi-angle obstructions, timeout limits). |
| **Tier 3** | **Cross-Feature Interactions** | Pairwise combinations | $\ge 12$ pairwise tests | Verifying synergistic behavior across subsystems (e.g. unblocking drop + gripper reorientation, waypoints + fastest path selection, transit clearance + proprioception, multi-head actor + PPO + ONNX export). |
| **Tier 4** | **Real-World Application Scenarios** | Full Eurobot 2027 Scenarios | $\ge 5$ comprehensive scenarios | End-to-end integration matching real tournament situations (standard 100s match, Sokoban blockage clearing with multi-angle approaches, staging under contestation, 5 ms real-time CPU loop, trapped adversarial recovery). |

---

## 3. Feature Inventory & Tier Mapping

| Feature ID | Feature Name | Source Req. | Milestone | Primary Interface | Tier 1 Tests | Tier 2 Tests |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **F1** | Gripper Unblocking `deposerZone` | R1 | M1 | `engine/actions.js`, `actions_table.json`, `torch_engine.py` | 5 | 5 |
| **F2** | Gripper Reorientation `tournerPince` | R1 | M1 | `engine/actions.js`, `actions_table.json`, `torch_engine.py` | 5 | 5 |
| **F3** | Packet Re-Pickup & Partial Pickup | R1 | M1 | `engine/actions.js`, `actions_table.json`, `torch_engine.py` | 5 | 5 |
| **F4** | Opposing Dual Approaches (P1..P10) | R2 | M1 | `trainer/actions_table.json`, `torch_engine.py` | 5 | 5 |
| **F5** | 4 Cardinal Approaches (T1..T4, Graal) | R2 | M1 | `trainer/actions_table.json`, `torch_engine.py` | 5 | 5 |
| **F6** | Fast Multi-Angle Path Selection | R2 | M1 | `trainer/torch_engine.py`, `actions.js` | 5 | 5 |
| **F7** | 8 Navigation Crossroads (`traj`) | R3 | M1 | `trainer/actions_table.json`, `torch_engine.py` | 5 | 5 |
| **F8** | Adaptive Placement `pm: 'proche'` | R4 | M1 | `engine/actions.js`, `torch_engine.py` | 5 | 5 |
| **F9** | Transit Z-Axis Clearance | R4 | M1 | `engine/engine.js`, `torch_engine.py` | 5 | 5 |
| **F10** | Enriched Proprioception | R5 | M1 | `trainer/torch_engine.py`, `engine/env.js` | 5 | 5 |
| **F11** | 8-Direction Distance Radar | R5 | M1 | `trainer/torch_engine.py`, `engine/env.js` | 5 | 5 |
| **F12** | 56-Dim Observation Parity | R5 | M1 | `trainer/torch_engine.py`, `engine/env.js` | 5 | 5 |
| **F13** | Multi-Head `RecurrentActorCritic` | R6 | M2 | `trainer/models.py` | 5 | 5 |
| **F14** | Multi-Head PPO Training Loop | R6 | M2 | `trainer/ppo_trainer.py` | 5 | 5 |
| **F15** | Web Sim Recurrent Runtime | R7 | M3 | `cerveau/net.js`, `plateau/app.js` | 5 | 5 |
| **F16** | Physical Safety Fallback Loop | R7 | M3 | `engine/env.js` | 5 | 5 |
| **F17** | Multi-Head ONNX Model Export | R7 | M3 | `trainer/export_onnx.py` | 5 | 5 |
| **F18** | Edge CPU Deployment Runner | R7 | M3 | `pi5_runner.py` | 5 | 5 |

---

## 4. Test Runner & Execution Guide

### Python Environment
Tests are executed using the dedicated virtual environment:
```bash
cd /root/.gemini/antigravity-cli/scratch/icamlot
/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/pytest tests/test_e2e_requirements.py
```

### Pytest Markers
The test suite utilizes custom markers to allow granular execution:
- `-m tier1`: Run all Tier 1 Feature Coverage tests (F1–F18).
- `-m tier2`: Run all Tier 2 Boundary & Corner Case tests (F1–F18).
- `-m tier3`: Run all Tier 3 Cross-Feature Interaction tests.
- `-m tier4`: Run all Tier 4 Real-World Application Scenario tests.
- `-m f1` ... `-m f18`: Run tests specifically targeting a single feature.
- `-m m1`: Run tests for features implemented in Milestone 1 (F1–F12).
- `-m m2`: Run tests for features implemented in Milestone 2 (F13–F14).
- `-m m3`: Run tests for features implemented in Milestone 3 (F15–F18).

### Key Execution Commands

```bash
# 1. Full E2E Test Suite Run (all tiers, verbose)
/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/python -m pytest tests/test_e2e_requirements.py -v

# 2. Run by Specific Tier
/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/python -m pytest tests/test_e2e_requirements.py -m tier1 -v
/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/python -m pytest tests/test_e2e_requirements.py -m tier2 -v
/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/python -m pytest tests/test_e2e_requirements.py -m tier3 -v
/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/python -m pytest tests/test_e2e_requirements.py -m tier4 -v

# 3. Run by Milestone
/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/python -m pytest tests/test_e2e_requirements.py -m m1 -v
/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/python -m pytest tests/test_e2e_requirements.py -m m2 -v
/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/python -m pytest tests/test_e2e_requirements.py -m m3 -v
```

---

## 5. Real-World Application Scenarios (Tier 4)

Tier 4 implements five concrete Eurobot match scenarios representing tournament operations:

1. **Scenario 1: Eurobot Standard 100s Match Execution**
   - Simulates a full 100-second tournament match starting from standard initialization ($t=0\text{ s}$).
   - Verifies sequential execution across stone pickup, castle wall construction, Graal retrieval and placement, boulets launch, and return to throne before $t=100\text{ s}$.
   - Acceptance: Score $\ge 105.0$ points, 0 collisions/errors, terminal flag set.

2. **Scenario 2: Clearing Central Sokoban Blockage with Dual Approaches**
   - Stone packets P9 and P10 create narrow choke points across central navigation lanes.
   - Evaluates opposing dual approaches (West/East) to retrieve packets without colliding with static table obstacles.

3. **Scenario 3: Tactical Staging and Unblocking Under Opponent Duel**
   - The opponent robot aggressively occupies central field corridors.
   - Verifies tactical staging drops and gripper unblocking via `deposerZone`, freeing suction cups outside transit lanes.

4. **Scenario 4: Fast Real-Time CPU Decision Loop (< 5 ms Budget)**
   - Simulates 100 consecutive real-time decision steps under Raspberry Pi 5 CPU constraints using ONNX Runtime with 56-dim observations.
   - Enforces strict compliance: $100\%$ of individual decision steps execute in $< 5.0\text{ ms}$, with average latency $< 1.0\text{ ms}$ and zero frame drops.

5. **Scenario 5: Adversarial Recovery via Crossroad Navigation Waypoints**
   - Starts in a procedurally generated or contested configuration.
   - Evaluates navigating through 8 strategic crossroad waypoints to clear blind spots and resume match progression.

---

## 6. Coverage Thresholds & Quality Gates

To achieve final acceptance in Milestone 4, the E2E test suite enforces the following thresholds:
- **Test Pass Rate**: $100\%$ of implemented feature tests must pass with zero assertion failures.
- **Progressive Testability**: Zero unexpected exceptions or crashes; unbuilt features report clean diagnostic skips.
- **Latency Budget**: Median CPU decision time $\le 0.5\text{ ms}$; maximum single decision time $< 5.0\text{ ms}$.
- **Export Integrity**: $100\%$ compliance with ONNX checker (`onnx.checker.check_model()`) and opset 18 compatibility.
