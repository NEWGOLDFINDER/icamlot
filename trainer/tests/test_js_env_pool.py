"""Pool de processus Node (moteur JS de référence) : formes, pas parallèle, auto-reset, adversaires, erreurs."""
import time

import numpy as np
import pytest

from trainer.js_env_pool import EnvPoolError, JsEnvPool

pytestmark = pytest.mark.lent


@pytest.fixture(scope="module")
def pool():
    p = JsEnvPool(2, 2, {"skipContacts": True}, timeout=120)
    yield p
    p.close()


def test_dimensions_lues_dans_l_env(pool, dims):
    assert (pool.n_in, pool.n_out) == dims
    assert len(pool.catalogue) == pool.n_out
    assert pool.obs_version and pool.catalogue_version
    obs, mask = pool.reset([{"seed": i} for i in range(pool.n_envs)])
    assert obs.shape == (4, pool.n_in) and obs.dtype == np.float32
    assert mask.shape == (4, pool.n_out) and mask.dtype == bool and mask.any(1).all()


def test_sous_ensemble_de_familles(dims):
    from trainer.tests.conftest import env_dims
    cfg = {"skipContacts": True, "familles": ["prendre", "mur", "trone"], "entrees": ["temps", "robot"]}
    with JsEnvPool(1, 1, cfg) as p:
        assert (p.n_in, p.n_out) == env_dims(cfg)
        assert p.n_out < dims[1]


def test_episode_somme_des_recompenses(pool):
    """Somme des récompenses d'un épisode + score au départ = score final (contrat §4 : score de départ nul)."""
    rng = np.random.default_rng(0)
    obs, mask = pool.reset([{"seed": 10 + i} for i in range(pool.n_envs)])
    start_scores = [s["score"] for s in pool.scores()]
    acc = np.zeros(pool.n_envs)
    finals = {}
    for _ in range(200):
        acts = [int(rng.choice(np.flatnonzero(m))) if i not in finals else None for i, m in enumerate(mask)]
        if all(a is None for a in acts):
            break
        sr = pool.step(acts)
        for i in range(pool.n_envs):
            if acts[i] is None:
                assert sr.infos[i].get("repos")
                continue
            assert not sr.infos[i].get("crash"), sr.infos[i]
            acc[i] += sr.reward[i]
            if sr.done[i]:
                finals[i] = sr.infos[i]["final"]
        mask = sr.mask
    assert finals, "aucun épisode terminé"
    for i, fin in finals.items():
        assert abs(start_scores[i] + acc[i] - fin["score"]) < 1e-6, (i, start_scores[i], acc[i], fin)
        assert fin["errors"] is not None and fin["decisions"] >= 1


def test_auto_reset_et_parallelisme(pool):
    rng = np.random.default_rng(1)
    obs, mask = pool.reset([{"seed": 20 + i} for i in range(pool.n_envs)])
    resets = 0
    t0 = time.time()
    n = 0
    while resets < 2 and n < 120:
        acts = [int(rng.choice(np.flatnonzero(m))) for m in mask]
        sr = pool.step(acts, [{"seed": 100 + n}] * pool.n_envs)
        n += 1
        for i in np.flatnonzero(sr.done):
            assert sr.infos[i]["reset"] and "final" in sr.infos[i]
            resets += 1
            assert sr.mask[i].any()
        mask = sr.mask
    assert resets >= 1
    assert pool.stats["decisions"] > 0 and time.time() - t0 > 0


def test_adversaire_strategie(pool):
    ex = pool.map([{"cmd": "example"}])[0]["program"]
    pool.set_opponents({"ex": {"program": ex}})
    obs, mask = pool.reset([{"seed": 1, "intensite": "realiste", "opponentRef": "ex"}] + [{"seed": 2}] * (pool.n_envs - 1))
    rng = np.random.default_rng(2)
    for _ in range(100):
        acts = [int(rng.choice(np.flatnonzero(mask[0])))] + [None] * (pool.n_envs - 1)
        sr = pool.step(acts)
        mask = sr.mask
        if sr.done[0]:
            fin = sr.infos[0]["final"]
            assert fin["adversaire"] is not None and fin["adversaire"]["score"] > 0
            break
    else:
        pytest.fail("épisode contre adversaire non terminé")


def test_erreurs_remontees(pool):
    with pytest.raises(EnvPoolError):
        pool.map([{"cmd": "inconnue"}])
    with pytest.raises(EnvPoolError, match="Adversaire inconnu"):
        pool.reset([{"opponentRef": "absent", "intensite": "realiste"}] * pool.n_envs)
    # le pool reste utilisable après une erreur de commande
    obs, mask = pool.reset([{"seed": 1}] * pool.n_envs)
    assert mask.any()


def test_processus_mort_et_fermeture():
    p = JsEnvPool(1, 1, {"skipContacts": True}, timeout=30)
    p.reset([{}])
    p.procs[0].proc.kill()
    p.procs[0].proc.wait()
    with pytest.raises(EnvPoolError):
        p.step([0])
    p.close()
    assert all(not pr.alive() for pr in p.procs)


def test_imitate_trace_recompenses(pool):
    ex = pool.map([{"cmd": "example"}])[0]["program"]
    tr = pool.map([{"cmd": "imitate_trace", "program": ex, "scenario": {"seed": 1, "intensite": "aucun"}}])[0]
    assert tr["n"] == len(tr["pairs"]) > 0
    assert abs(sum(p["reward"] for p in tr["pairs"]) - (tr["score"] - tr["score0"])) < 1e-6
    ts = [p["t"] for p in tr["pairs"]]
    assert ts == sorted(ts)
    for p in tr["pairs"]:
        assert len(p["obs"]) == pool.n_in and len(p["mask"]) == pool.n_out and 0 <= p["action"] < pool.n_out
