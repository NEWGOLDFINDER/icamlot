"""Outils communs aux tests de l'entraîneur."""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from trainer.js_env_pool import StepResult  # noqa: E402


def env_dims(config=None):
    """n_in / n_out de l'environnement JS actuel pour une configuration (lus dans engine/env.js, jamais en dur)."""
    js = ("var c=require(process.argv[1]+'/engine/load.js').loadIcamlot(process.argv[1]);"
          "var e=c.ENV.create(JSON.parse(process.argv[2]));process.stdout.write(JSON.stringify([e.nInputs,e.nOutputs]))")
    out = subprocess.run(["node", "-e", js, str(ROOT), json.dumps(config or {})], stdout=subprocess.PIPE,
                         text=True, check=True).stdout
    return tuple(json.loads(out))


@pytest.fixture(scope="session")
def dims():
    return env_dims({"skipContacts": True})


class FakePool:
    """Environnement jouet au même interface que JsEnvPool (pour tester PPO sans Node).

    Épisodes de `length` pas ; l'observation code le pas courant ; les actions >= n_valid sont masquées ;
    récompense 1 si l'action vaut (pas % n_valid), sinon 0. Retour maximal = length.
    """

    def __init__(self, n_envs=8, n_valid=3, n_out=5, length=3, seed=0):
        self.n_envs, self.n_in, self.n_out, self.n_valid, self.length = n_envs, length + 1, n_out, n_valid, length
        self.config, self.obs_version, self.catalogue_version = {}, "jouet", "jouet"
        self.catalogue, self.groups, self.moteur, self.bareme = [{"i": i} for i in range(n_out)], [], "jouet", "jouet"
        self.n_procs, self.envs_per_proc = 1, n_envs
        self.stats = {"decisions": 0}
        self.t = np.zeros(n_envs, int)
        self.masked_chosen = 0

    def _obs(self):
        o = np.zeros((self.n_envs, self.n_in), np.float32)
        o[np.arange(self.n_envs), self.t] = 1.0
        return o

    def _mask(self):
        m = np.zeros((self.n_envs, self.n_out), bool)
        m[:, : self.n_valid] = True
        return m

    def reset(self, scenarios=None):
        self.t[:] = 0
        return self._obs(), self._mask()

    def reset_ids(self, ids, scenarios):
        for i in ids:
            self.t[i] = 0
        o, m = self._obs(), self._mask()
        return {i: (o[i], m[i]) for i in ids}

    def step(self, actions, next_scenarios=None):
        r = np.zeros(self.n_envs, np.float32)
        done = np.zeros(self.n_envs, bool)
        infos = [{} for _ in range(self.n_envs)]
        rets = getattr(self, "_rets", np.zeros(self.n_envs))
        for i, a in enumerate(actions):
            if a is None:
                infos[i] = {"repos": True}
                continue
            self.stats["decisions"] += 1
            if a >= self.n_valid:
                self.masked_chosen += 1
            r[i] = 1.0 if a == self.t[i] % self.n_valid else 0.0
            rets[i] += r[i]
            self.t[i] += 1
            if self.t[i] >= self.length:
                done[i] = True
                infos[i] = {"final": {"score": float(rets[i]), "errors": 0, "detail": {}}}
                rets[i] = 0
                if next_scenarios is not None and next_scenarios[i] is not None:
                    self.t[i] = 0
        self._rets = rets
        return StepResult(self._obs(), self._mask(), r, done, infos)
