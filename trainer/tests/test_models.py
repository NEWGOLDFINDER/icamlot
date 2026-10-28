"""Modèle récurrent : formes, masque, déroulé séquentiel, normalisation, sauvegarde."""
import numpy as np
import torch

from trainer.models import MASK_LOGIT, RecurrentActorCritic, RunningMeanStd, load_checkpoint, save_checkpoint


def test_formes(dims):
    n_in, n_out = dims
    m = RecurrentActorCritic(n_in, n_out, hidden=32)
    obs, h = torch.randn(5, n_in), m.init_hidden(5)
    logits, v, h2 = m(obs, h)
    assert logits.shape == (5, n_out) and v.shape == (5,) and h2.shape == (5, 32)
    assert not hasattr(m, "actor_approach") and not hasattr(m, "aux_head")


def test_dimensions_parametriques():
    for n_in, n_out in ((3, 2), (37, 106), (56, 130), (80, 200)):
        m = RecurrentActorCritic(n_in, n_out, hidden=16, encodeur=(24, 12), acteur=(8,), critique=())
        lg, v, h = m(torch.zeros(2, n_in), m.init_hidden(2))
        assert lg.shape == (2, n_out) and h.shape == (2, 16)


def test_masque_jamais_choisi():
    torch.manual_seed(0)
    m = RecurrentActorCritic(6, 10, hidden=8)
    mask = torch.zeros(64, 10, dtype=torch.bool)
    mask[:, [1, 4, 7]] = True
    logits, _, _ = m(torch.randn(64, 6), m.init_hidden(64), mask)
    assert (logits[~mask] == MASK_LOGIT).all()
    d = torch.distributions.Categorical(logits=logits)
    a = d.sample((50,))
    assert mask.gather(1, a.T).all()
    p = d.probs
    assert torch.allclose(p[~mask], torch.zeros_like(p[~mask]))
    assert torch.isfinite(d.entropy()).all()


def test_sequence_egale_pas_a_pas_avec_resets():
    torch.manual_seed(1)
    m = RecurrentActorCritic(5, 4, hidden=8)
    T, B = 6, 3
    obs = torch.randn(T, B, 5)
    starts = torch.zeros(T, B)
    starts[0] = 1
    starts[3, 1] = 1
    h0 = torch.randn(B, 8)
    lg_seq, v_seq, h_seq = m.forward_sequence(obs, h0, starts)
    h = h0
    for t in range(T):
        h = h * (1 - starts[t]).unsqueeze(-1)
        lg, v, h = m(obs[t], h)
        assert torch.allclose(lg, lg_seq[t], atol=1e-6) and torch.allclose(v, v_seq[t], atol=1e-6)
    assert torch.allclose(h, h_seq, atol=1e-6)


def test_normalisation_et_rms():
    rms = RunningMeanStd((3,))
    x = np.random.default_rng(0).normal([1, -2, 5], [2, 0.5, 3], size=(5000, 3))
    for part in np.array_split(x, 7):
        rms.update(part)
    assert np.allclose(rms.mean, x.mean(0), atol=1e-3) and np.allclose(rms.var, x.var(0), rtol=1e-2)
    m = RecurrentActorCritic(3, 2, hidden=4, clip_obs=5.0)
    m.set_obs_stats(rms.mean, rms.var)
    z = m.normalise(torch.as_tensor(x, dtype=torch.float32))
    assert torch.allclose(z.mean(0), torch.zeros(3), atol=0.05)
    assert z.abs().max() <= 5.0


def test_sauvegarde_aller_retour(tmp_path):
    m = RecurrentActorCritic(7, 3, hidden=12, encodeur=(16,), activation="tanh")
    m.set_obs_stats(np.arange(7.0), np.ones(7) * 4)
    save_checkpoint(tmp_path / "m.pt", m, {"obs_version": "o1"})
    m2, ck = load_checkpoint(tmp_path / "m.pt")
    assert ck["obs_version"] == "o1" and m2.config() == m.config()
    x, h = torch.randn(2, 7), torch.randn(2, 12)
    assert torch.allclose(m(x, h)[0], m2(x, h)[0])
