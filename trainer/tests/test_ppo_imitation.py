"""PPO (apprentissage sur un environnement jouet, fumée sur le moteur JS) et imitation (masque, retours)."""
import json
import time

import numpy as np
import pytest
import torch

from trainer.imitation import Demo, collect_demos, discounted_returns, example_program, imitation_train
from trainer.models import RecurrentActorCritic, load_checkpoint
from trainer.ppo_trainer import PPOConfig, PPOTrainer
from trainer.scenarios import ScenarioSampler
from trainer.tests.conftest import FakePool


def test_ppo_apprend_et_respecte_le_masque(tmp_path):
    torch.manual_seed(0)
    np.random.seed(0)
    pool = FakePool(n_envs=16, n_valid=3, n_out=5, length=3)
    cfg = PPOConfig(rollout=6, mises_a_jour=40, hidden=16, encodeur=[16], critique=[16], lr=3e-3, lr_fin=3e-3,
                    entropie=0.0, entropie_fin=0.0, eval_matchs=0, checkpoint_tous_les=0, mini_lots=2)
    tr = PPOTrainer(cfg, pool, ScenarioSampler(), torch.device("cpu"), log=lambda s: None)
    first = tr.train_iteration()["score_moyen"]
    for _ in range(cfg.mises_a_jour - 1):
        last = tr.train_iteration()
    assert pool.masked_chosen == 0
    assert last["score_moyen"] > max(2.5, first + 0.8), (first, last["score_moyen"])
    assert tr.ret_rms.count > 1 and np.all(tr.obs_rms.var >= 0)


class LentPool(FakePool):
    """FakePool dont chaque pas dure `dt` secondes (cœur unique : un rollout dure très longtemps)."""
    dt = 0.05

    def step(self, actions, next_scenarios=None):
        time.sleep(self.dt)
        return super().step(actions, next_scenarios)


def test_duree_max_verifiee_pendant_la_collecte_et_progression(tmp_path):
    torch.manual_seed(0)
    pool = LentPool(n_envs=4, n_valid=3, n_out=5, length=3)
    # un rollout de 200 pas durerait ~10 s ; la durée maximale est de 0,4 s
    cfg = PPOConfig(rollout=200, mises_a_jour=5, hidden=16, encodeur=[16], critique=[16], duree_max_s=0.4,
                    eval_matchs=0, checkpoint_tous_les=0, mini_lots=2)
    logs, prog = [], []
    tr = PPOTrainer(cfg, pool, ScenarioSampler(), torch.device("cpu"), log=logs.append)
    tr.on_collect = lambda done, total, dt: prog.append((done, total, dt))
    t0 = time.time()
    res = tr.run(tmp_path / "m", None, None)
    assert time.time() - t0 < 5, "la limite de durée n'a pas coupé la collecte"
    assert res["mises_a_jour"] == 0 and res["transitions"] == 0
    assert any("Durée maximale atteinte pendant la collecte" in l for l in logs), logs
    assert prog and prog[0][1] == 200 * 4 and prog[-1][0] < prog[-1][1]
    assert [p[0] for p in prog] == sorted(p[0] for p in prog)


def test_gae_cas_simple():
    pool = FakePool(n_envs=1)
    tr = PPOTrainer(PPOConfig(gamma=0.5, gae_lambda=1.0, eval_matchs=0), pool, ScenarioSampler(), torch.device("cpu"),
                    log=lambda s: None)
    data = {"rew": np.array([[1.0], [2.0], [4.0]], np.float32), "val": np.zeros((3, 1), np.float32),
            "done": np.array([[False], [True], [False]]), "last_val": np.array([8.0], np.float32)}
    adv, ret = tr.gae(data, scale=1.0)
    # épisode 1 : 1 + 0,5·2 = 2 puis 2 (fin) ; épisode 2 : 4 + 0,5·8 = 8
    assert np.allclose(ret[:, 0], [2.0, 2.0, 8.0])


def test_imitation_masquee_cibles_invalides_ignorees():
    torch.manual_seed(0)
    n_in, n_out, T = 4, 6, 5
    rng = np.random.default_rng(0)
    obs = rng.normal(size=(T, n_in)).astype(np.float32)
    masks = np.ones((T, n_out), bool)
    masks[:, 5] = False
    acts = np.array([0, 1, 5, 2, 3])          # la cible 5 est masquée au pas 2
    d = Demo("jouet", obs, acts, masks, np.array([1, 0, 0, 2, 3], np.float32), 6.0, 0.0, 0)
    m = RecurrentActorCritic(n_in, n_out, hidden=16)
    st = imitation_train(m, [d, d], epochs=150, lr=1e-2, gamma=1.0)
    assert st["cibles_invalides"] == 2 and st["decisions"] == 10
    assert np.isfinite(st["perte_ce"]) and st["precision"] == 1.0
    # cible de valeur = retour réel (pas une constante) : 6, 5, 5, 5, 3
    assert np.allclose(discounted_returns(d.rewards, 1.0), [6, 5, 5, 5, 3])
    with torch.no_grad():
        _, v, _ = m.forward_sequence(torch.as_tensor(obs)[:, None], m.init_hidden(1), torch.tensor([[1.0]] + [[0.0]] * 4))
    v = v[:, 0].numpy() * np.sqrt(st["ret_rms"].var + 1e-8)
    assert np.abs(v - np.array([6, 5, 5, 5, 3])).max() < 1.0, v


@pytest.mark.lent
def test_fumee_imitation_ppo_eval_export_moteur_js(tmp_path):
    from trainer.js_env_pool import JsEnvPool
    ort = pytest.importorskip("onnxruntime")
    torch.manual_seed(0)
    with JsEnvPool(1, 2, {"skipContacts": True}) as pool:
        demos = collect_demos(pool, [{"nom": "exemple", "program": example_program(pool)}], [{"seed": 1}])
        assert demos and demos[0].obs.shape[1] == pool.n_in
        assert abs(demos[0].rewards.sum() - (demos[0].score - demos[0].score0)) < 1e-6
        cfg = PPOConfig(rollout=3, mises_a_jour=1, hidden=16, encodeur=[16], critique=[16], eval_matchs=2,
                        checkpoint_tous_les=1)
        tr = PPOTrainer(cfg, pool, ScenarioSampler(), torch.device("cpu"), log=lambda s: None)
        st = imitation_train(tr.model, demos, epochs=3, obs_rms=tr.obs_rms, ret_rms=tr.ret_rms)
        assert st["cibles_invalides"] == int((~demos[0].masks[np.arange(len(demos[0].actions)), demos[0].actions]).sum())
        res = tr.run(tmp_path / "fumee")
    ev = res["evaluation"]
    assert ev["matchs"] == 2 and ev["score"]["moyenne"] is not None and "erreurs_par_match" in ev
    for suffix in (".pt", ".dernier.pt", ".onnx", ".meta.json", ".json", ".eval.json"):
        assert (tmp_path / ("fumee" + suffix)).exists(), suffix
    meta = json.loads((tmp_path / "fumee.meta.json").read_text())
    assert meta["n_in"] == pool.n_in and meta["catalogue_version"] == pool.catalogue_version
    # reprise : le point de sauvegarde contient optimiseur et statistiques
    m, ck = load_checkpoint(tmp_path / "fumee.dernier.pt")
    assert ck["update"] == 1 and ck["optimizer_state"] and ck["obs_rms"]["count"] > 1
    sess = ort.InferenceSession(str(tmp_path / "fumee.onnx"), providers=["CPUExecutionProvider"])
    lo, h = sess.run(None, {"obs": np.zeros((1, pool.n_in), np.float32), "hidden": np.zeros((1, 16), np.float32)})
    assert lo.shape == (1, pool.n_out)
