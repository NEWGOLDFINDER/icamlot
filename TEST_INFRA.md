# Test Infrastructure Specification — icamlot AI Dual Track E2E

## 1. Test Philosophy: Requirement-Driven Opaque-Box Methodology

The **icamlot AI** test infrastructure is engineered around the principle of **opaque-box requirement verification**. Rather than inspecting private implementation internals or coupling tests to transient helper methods, tests are derived directly from the authoritative specifications established in `ORIGINAL_REQUEST.md` (Requirements R1–R7) and `PROJECT.md` (Features F1–F14).

### Core Principles
1. **Opaque-Box Verification**: The test suite evaluates observable behavior, interface contracts, mathematical invariants, tensor shapes, execution timing budgets, and Eurobot rules through public interfaces (`TorchEnv`, `FactorizedEncoder`, `RecurrentActorCritic`, `Pi5ActorWrapper`, `Pi5EurobotAgent`, `export_pi5_onnx`, `actions_table.json`).
2. **Explicit Expected Value Derivation**: Every assertion is derived from formal mathematical properties (e.g. Euclidean/Manhattan bounds, equilateral geometry $a=400\text{ mm}$, circumscribed radius $R \approx 230.94\text{ mm}$, dilation radii for flat $276.5\text{ mm}$ vs upright $232\text{ mm}$), official Eurobot 2027 scoring rules, and production deployment constraints ($< 5.0\text{ ms}$ CPU decision latency, ONNX opset 18 compatibility).
3. **Progressive Testability**: The test suite is designed for progressive verification across development milestones (M1–M4). Tests provide clear, informative assertion signals when a feature is present and contractually compliant. For unbuilt features in active or future milestones, tests gracefully skip with clear diagnostic messages (`pytest.skip("Progressive Testability [Fx]: ...")`), allowing early milestone runners to verify already-completed functionality without blocking on unreleased modules.
4. **Zero-Flake Isolation**: Each test is self-contained, creates its own tensors/environment instances with explicit devices and seeds, and cleans up temporary artifacts (e.g. temporary ONNX export files).

---

## 2. 4-Tier Test Architecture

The testing strategy is structured into four distinct, rigorous tiers:

| Tier | Name | Target Scope | Cardinality | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | **Feature Coverage** | F1 through F14 | $\ge 5$ tests per feature ($70+$ tests) | Isolated happy-path verification of nominal behavior, tensor shapes, interface contracts, and core mechanics. |
| **Tier 2** | **Boundary & Corner Cases** | F1 through F14 | $\ge 5$ tests per feature ($70+$ tests) | Stress testing boundary limits (table coordinates 0/3000/2000 mm, batch sizes 1/256/1024, zero/max stones held, full wall partitions, timeouts). |
| **Tier 3** | **Cross-Feature Interactions** | Pairwise combinations | $\ge 12$ pairwise tests | Verifying synergistic behavior across subsystems (e.g. gripper folding + wavefront pathing, staging drop + packet re-pickup, trapped reset + state cloning, entity tokenizer + world model). |
| **Tier 4** | **Real-World Application Scenarios** | Full Eurobot 2027 Scenarios | $\ge 5$ comprehensive scenarios | End-to-end integration matching real tournament situations (standard 100s match, Sokoban blockage clearing, staging under contestation, 5 ms real-time CPU loop, trapped adversarial recovery). |

---

## 3. Feature Inventory & Tier Mapping

| Feature ID | Feature Name | Source Req. | Milestone | Primary Interface | Tier 1 Tests | Tier 2 Tests |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **F1** | 2D GPU Distance Grid | R1 | M1 | `trainer/torch_engine.py` | 5 | 5 |
| **F2** | Dynamic Envelope Dilation | R1 | M1 | `trainer/torch_engine.py` | 5 | 5 |
| **F3** | Real-Time Topological Closures | R1 | M1 | `trainer/torch_engine.py` | 5 | 5 |
| **F4** | Staging & Relay Drop Zones | R2 | M1 | `engine/actions.js`, `torch_engine.py` | 5 | 5 |
| **F5** | Packet Re-Pickup Mechanics | R2 | M1 | `engine/actions.js`, `torch_engine.py` | 5 | 5 |
| **F6** | $90^\circ$ Gripper Folding | R2 | M1 | `trainer/torch_engine.py` | 5 | 5 |
| **F7** | Sokoban Curriculum Resets | R5 | M1 | `trainer/torch_engine.py` | 5 | 5 |
| **F8** | GPU State Cloning & Restoration | R6 | M1 | `trainer/torch_engine.py` | 5 | 5 |
| **F9** | Object-Centric Entity Tokenizer | R4 | M2 | `trainer/models.py` | 5 | 5 |
| **F10** | 2-Layer Self-Attention Transformer | R4 | M2 | `trainer/models.py` | 5 | 5 |
| **F11** | Auxiliary World-Model Head | R3 | M2 | `trainer/models.py` | 5 | 5 |
| **F12** | Auxiliary MSE Loss Integration | R3 | M2 | `trainer/ppo_trainer.py` | 5 | 5 |
| **F13** | Production ONNX Export Isolation | R7 | M2 | `trainer/export_onnx.py` | 5 | 5 |
| **F14** | Edge CPU Inference & Tree Search | R6, R7 | M2, M3 | `pi5_runner.py`, `trainer/tree_search.py` | 5 | 5 |

---

## 4. Test Runner & Execution Guide

### Python Environment
Tests are executed using the dedicated virtual environment:
```bash
/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/pytest tests/test_e2e_requirements.py
```

### Pytest Markers
The test suite utilizes custom markers to allow granular execution:
- `-m tier1`: Run all Tier 1 Feature Coverage tests.
- `-m tier2`: Run all Tier 2 Boundary & Corner Case tests.
- `-m tier3`: Run all Tier 3 Cross-Feature Interaction tests.
- `-m tier4`: Run all Tier 4 Real-World Application Scenario tests.
- `-m f1` ... `-m f14`: Run tests specifically targeting a single feature.
- `-m "m1"`: Run tests for features implemented in Milestone 1 (F1–F8).
- `-m "m2"`: Run tests for features implemented in Milestone 2 (F9–F14).

### Key Execution Commands

```bash
# 1. Full E2E Test Suite Run (all tiers, verbose)
/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/python -m pytest tests/test_e2e_requirements.py -v

# 2. Run by Specific Tier
/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/python -m pytest tests/test_e2e_requirements.py -m tier1 -v
/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/python -m pytest tests/test_e2e_requirements.py -m tier2 -v
/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/python -m pytest tests/test_e2e_requirements.py -m tier3 -v
/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/python -m pytest tests/test_e2e_requirements.py -m tier4 -v

# 3. Run by Specific Feature (e.g. F8 State Clone/Restore or F13 ONNX Export)
/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/python -m pytest tests/test_e2e_requirements.py -m f8 -v
/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/python -m pytest tests/test_e2e_requirements.py -m f13 -v

# 4. Milestone-Specific Verification
/root/.gemini/antigravity-cli/scratch/.venv-icamlot/bin/python -m pytest tests/test_e2e_requirements.py -m m1 -v
```

---

## 5. Real-World Application Scenarios (Tier 4)

Tier 4 implements five concrete Eurobot match scenarios representing tournament operations:

1. **Scenario 1: Eurobot Standard 100s Match Execution**
   - Simulates a full 100-second tournament match starting from standard initialization ($t=0\text{ s}$).
   - Verifies sequential execution across stone pickup, castle wall construction, Graal retrieval and placement, boulets launch, and return to throne before $t=100\text{ s}$.
   - Acceptance: Score $\ge 105.0$ points, 0 collisions/errors, terminal flag set.

2. **Scenario 2: Clearing Central Sokoban Blockage (P9/P10)**
   - Stone packets P9 and P10 create narrow choke points across central navigation lanes.
   - Verifies that the agent evaluates shortest wavefront paths, avoids colliding with static packets, and safely retrieves or bypasses central obstacles.

3. **Scenario 3: Staging Packets Outside Transit Under Contestation**
   - The opponent robot aggressively occupies central field corridors.
   - Verifies that the agent executes tactical staging drops at North or South castle entrances, releasing stones outside transit lanes and freeing grippers for alternate tasks.

4. **Scenario 4: Fast Real-Time CPU Decision Loop (< 5 ms Budget)**
   - Simulates 100 consecutive real-time decision steps under Raspberry Pi 5 CPU constraints using ONNX Runtime.
   - Enforces strict compliance: $100\%$ of individual decision steps must execute in $< 5.0\text{ ms}$, with average latency $< 1.0\text{ ms}$ and zero frame drops.

5. **Scenario 5: Adversarial Duel Recovery from Trapped States**
   - Starts in a procedurally generated trapped configuration ($t \in [20, 75]\text{ s}$) with pre-built walls and contesting opponent.
   - Evaluates multi-step planning recovery, ensuring the robot navigates out of the pocket without incurring collision penalties and resumes scoring.

---

## 6. Coverage Thresholds & Quality Gates

To achieve final acceptance in Milestone 4, the E2E test suite enforces the following thresholds:
- **Test Pass Rate**: $100\%$ of implemented feature tests must pass with zero assertion failures.
- **Progressive Testability**: Zero unexpected exceptions or crashes; unbuilt features report clean diagnostic skips.
- **Latency Budget**: Median CPU decision time $\le 0.5\text{ ms}$; maximum single decision time $< 5.0\text{ ms}$.
- **Export Integrity**: $100\%$ compliance with ONNX checker (`onnx.checker.check_model()`) and opset 18 compatibility.
