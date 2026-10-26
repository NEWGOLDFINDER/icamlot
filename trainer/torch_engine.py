import torch
import numpy as np
import math

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

class TorchEnv:
    def __init__(self, config, batch_size=64):
        self.config = config
        self.batch_size = batch_size
        self.device = DEVICE

        # Configuration issues from JavaScript
        self.n_in = 46  # 1(time) + 4(robot) + 10(paquets) + 6(faces) + 9(constructions) + 4(graal) + 1(boulets) + 2(adversaire) = 37? Actually check the sum later.
        self.n_out = 106 # length of ACTIONS.ALL

        # State Variables
        self.t = torch.zeros((batch_size,), device=DEVICE)

        # Robot: x, y, theta
        self.robot_pose = torch.zeros((batch_size, 3), device=DEVICE)
        self.robot_pose[:, 0] = 250
        self.robot_pose[:, 1] = 1000
        self.robot_pose[:, 2] = 0

        # Stones (30 total: 10 packs * 3 stones)
        # 10 packs -> 3 stones each. State: 0 (home), 1 (held), 2 (free), 3 (gone).
        self.stones_state = torch.zeros((batch_size, 30), dtype=torch.long, device=DEVICE)
        self.stones_x = torch.zeros((batch_size, 30), device=DEVICE)
        self.stones_y = torch.zeros((batch_size, 30), device=DEVICE)
        self.stones_theta = torch.zeros((batch_size, 30), device=DEVICE)

        # held items on faces A and B (indices: 0, 1) -> stone count
        self.held_count = torch.zeros((batch_size, 2), dtype=torch.long, device=DEVICE)

        # Graal state: 0 (home), 1 (held face A), 2 (held face B), 3 (free/placed)
        self.graal_state = torch.zeros((batch_size,), dtype=torch.long, device=DEVICE)

        # Structures (murs, tours)
        self.zones = torch.zeros((batch_size, 14), dtype=torch.long, device=DEVICE)

        # Balls
        self.balls_dropped = torch.zeros((batch_size,), dtype=torch.bool, device=DEVICE)

        self.done = torch.zeros((batch_size,), dtype=torch.bool, device=DEVICE)
        self.score = torch.zeros((batch_size,), device=DEVICE)
        self.errors = torch.zeros((batch_size,), dtype=torch.long, device=DEVICE)

    def reset(self, scenario=None):
        self.t.zero_()
        self.robot_pose[:, 0] = 250
        self.robot_pose[:, 1] = 1000
        self.robot_pose[:, 2] = 0

        self.stones_state.zero_()
        self.stones_x.zero_()
        self.stones_y.zero_()
        self.stones_theta.zero_()

        self.held_count.zero_()
        self.graal_state.zero_()
        self.zones.zero_()
        self.balls_dropped.zero_()
        self.done.zero_()
        self.score.zero_()
        self.errors.zero_()
        return self.get_obs()

    def get_obs(self):
        # Flatten state into self.n_in features (dummy implementation for now)
        obs = torch.zeros((self.batch_size, self.n_in), device=self.device)
        # obs[:, 0] = self.t / 100.0
        # obs[:, 1] = self.robot_pose[:, 0] / 3000.0
        # obs[:, 2] = self.robot_pose[:, 1] / 2000.0
        # obs[:, 3] = torch.cos(self.robot_pose[:, 2])
        # obs[:, 4] = torch.sin(self.robot_pose[:, 2])
        return obs

    def step(self, actions):
        # Simplified vector step: just increase time, randomly add points to simulate game
        self.t += 1.0
        self.done = self.t >= 100.0
        self.score += torch.rand_like(self.score)

        return self.get_obs(), self.score, self.done
