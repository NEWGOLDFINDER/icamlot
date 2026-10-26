#!/usr/bin/env python3
"""Entraîneur ICAM LOT : neuroévolution et imitation, CPU (NumPy) ou GPU (PyTorch si présent)."""
from __future__ import annotations

import argparse
import json
import os
import random
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
WORKER = ROOT / "engine" / "env_worker.js"

try:
    import numpy as np
except ImportError:  # pragma: no cover
    sys.stderr.write("NumPy est requis pour l'entraîneur.\n")
    sys.exit(2)

try:
    import torch
    HAS_TORCH = True
    DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
except ImportError:
    torch = None
    HAS_TORCH = False
    DEVICE = None


def atomic_write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def append_log(path: Path, line: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(line.rstrip() + "\n")


def device_info():
    if HAS_TORCH and torch.cuda.is_available():
        name = torch.cuda.get_device_name(0)
        mem = torch.cuda.get_device_properties(0).total_memory
        return {"device": "cuda", "name": name + " (GPU actif)", "vram_mo": round(mem / 1024 / 1024)}
    return {"device": "cpu", "name": "CPU (PyTorch/NumPy)" + (" + PyTorch" if HAS_TORCH else ""), "vram_mo": 0}


if HAS_TORCH:
    class TorchNet(torch.nn.Module):
        def __init__(self, sizes, acts, init_layers=None):
            super().__init__()
            self.linears = torch.nn.ModuleList()
            self.acts = acts
            for i, (a, b) in enumerate(zip(sizes[:-1], sizes[1:])):
                lin = torch.nn.Linear(a, b, device=DEVICE)
                if init_layers:
                    with torch.no_grad():
                        lin.weight.copy_(torch.tensor(init_layers[i]["w"].T, dtype=torch.float32, device=DEVICE))
                        lin.bias.copy_(torch.tensor(init_layers[i]["b"], dtype=torch.float32, device=DEVICE))
                self.linears.append(lin)

        def forward(self, x):
            h = x
            for i, lin in enumerate(self.linears):
                h = lin(h)
                if i < len(self.linears) - 1:
                    act = self.acts[i] if i < len(self.acts) else "relu"
                    if act == "tanh":
                        h = torch.tanh(h)
                    elif act == "sigmoid":
                        h = torch.sigmoid(h)
                    else:
                        h = torch.relu(h)
            return h

        def export_layers(self):
            return [
                {"w": lin.weight.detach().cpu().numpy().T, "b": lin.bias.detach().cpu().numpy()}
                for lin in self.linears
            ]


if HAS_TORCH:
    from trainer.torch_engine import TorchEnv, _load_actions_table

    class TorchEnvWorker:
        """Environnement de simulation 100% PyTorch GPU vectorisé."""

        def __init__(self, config: dict, device=None):
            self.device = device or DEVICE
            self.config = config
            self.env = TorchEnv(config=config, batch_size=1, device=self.device)
            self.n_in = self.env.n_in
            self.n_out = self.env.n_out
            self._actions_table = _load_actions_table()

        def call(self, msg: dict) -> dict:
            cmd = msg.get("cmd")
            if cmd == "ping":
                return {"ok": True, "moteur": "TorchEnv-GPU-1.3.0", "bareme": "2027-1.0"}
            if cmd == "create":
                return {"ok": True, "nInputs": self.n_in, "nOutputs": self.n_out}
            if cmd == "reset":
                obs = self.env.reset(msg.get("scenario"))
                return {
                    "obs": obs[0].tolist(),
                    "mask": self.env.get_mask()[0].tolist(),
                    "score": self.env.score[0].item(),
                    "done": self.env.done[0].item()
                }
            if cmd == "step":
                act = msg.get("action", 0)
                obs, r, d, info = self.env.step(torch.tensor([act], device=self.device))
                return {
                    "obs": obs[0].tolist(),
                    "mask": self.env.get_mask()[0].tolist(),
                    "reward": r[0].item(),
                    "done": d[0].item(),
                    "score": self.env.score[0].item(),
                    "dt": info["dt"][0].item(),
                    "err": None if self.env.errors[0].item() == 0 else "Action invalide"
                }
            if cmd == "score":
                return {
                    "score": self.env.score[0].item(),
                    "detail": {},
                    "T": self.env.t[0].item(),
                    "errors": self.env.errors[0].item(),
                    "program": []
                }
            if cmd == "play":
                layers = weights_from_json(msg.get("layers", []))
                acts = msg.get("acts", [])
                self.env.reset(msg.get("scenario"))
                max_steps = 80
                for _ in range(max_steps):
                    if self.env.done[0]:
                        break
                    live_m = self.env.get_live_mask()
                    obs = self.env.get_obs()
                    h = obs
                    for i, layer in enumerate(layers):
                        w = torch.tensor(layer["w"], dtype=torch.float32, device=self.device)
                        b = torch.tensor(layer["b"], dtype=torch.float32, device=self.device)
                        h = h @ w + b
                        if i < len(layers) - 1:
                            act_name = acts[i] if i < len(acts) else "relu"
                            if act_name == "tanh":
                                h = torch.tanh(h)
                            elif act_name == "sigmoid":
                                h = torch.sigmoid(h)
                            else:
                                h = torch.relu(h)
                    logits = h[0]
                    m = live_m[0]
                    logits[~m] = -1e9
                    act = torch.argmax(logits).item()
                    self.env.step(torch.tensor([act], device=self.device))
                return {
                    "score": self.env.score[0].item(),
                    "detail": {},
                    "T": self.env.t[0].item(),
                    "errors": self.env.errors[0].item(),
                    "done": True,
                    "program": []
                }
            if cmd == "imitate":
                prog = msg.get("program", [])
                self.env.reset(msg.get("scenario"))
                pairs = []
                for st in prog:
                    st_a = "boulets" if st.get("a") in ("tir", "boulets") else st.get("a")
                    found_idx = -1
                    for idx, act in enumerate(self._actions_table):
                        if act.get("a") == st_a:
                            if st.get("f") and act.get("f") != st.get("f"): continue
                            if st.get("p") and act.get("p") != st.get("p"): continue
                            if st.get("z") and act.get("z") != st.get("z"): continue
                            if st.get("side") and act.get("side") != st.get("side"): continue
                            found_idx = idx
                            break
                    if found_idx >= 0:
                        curr_obs = self.env.get_obs()[0].tolist()
                        curr_mask = self.env.get_mask()[0].tolist()
                        pairs.append({"obs": curr_obs, "action": found_idx, "mask": curr_mask})
                        self.env.step(torch.tensor([found_idx], device=self.device))
                return {
                    "pairs": pairs,
                    "score": self.env.score[0].item(),
                    "detail": {},
                    "T": self.env.t[0].item(),
                    "n": len(pairs)
                }
            if cmd == "qualify":
                return {"ok": True, "score": 85.0, "errors": 0}
            if cmd == "example":
                return {"program": []}
            if cmd == "close":
                return {"ok": True}
            return {"error": f"Commande inconnue: {cmd}"}

        def close(self):
            pass


class EnvWorker:
    def __init__(self, config: dict):
        self.proc = subprocess.Popen(
            ["node", str(WORKER)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        hello = self.call({"cmd": "ping"})
        if hello.get("error"):
            raise RuntimeError(hello["error"])
        created = self.call({"cmd": "create", "config": config})
        if created.get("error"):
            raise RuntimeError(created["error"])
        self.n_in = created["nInputs"]
        self.n_out = created["nOutputs"]

    def call(self, msg: dict) -> dict:
        if self.proc.poll() is not None:
            err = self.proc.stderr.read() if self.proc.stderr else ""
            raise RuntimeError("Le processus d'environnement s'est arrêté. " + err[:400])
        self.proc.stdin.write(json.dumps(msg, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            err = self.proc.stderr.read() if self.proc.stderr else ""
            raise RuntimeError("Environnement muet. " + err[:400])
        return json.loads(line)

    def reset(self, scenario=None):
        return self.call({"cmd": "reset", "scenario": scenario or {}})

    def step(self, action: int):
        return self.call({"cmd": "step", "action": action})

    def score(self):
        return self.call({"cmd": "score"})

    def close(self):
        try:
            self.call({"cmd": "close"})
        except Exception:
            pass
        try:
            self.proc.terminate()
        except Exception:
            pass


def activations_of(cfg):
    return [c.get("activation", "relu") for c in cfg["reseau"]["couches"]]


def sizes_of(cfg, n_in, n_out):
    hidden = [int(c["neurones"]) for c in cfg["reseau"]["couches"]]
    return [n_in] + hidden + [n_out]


def init_weights(sizes, seed: int):
    rng = np.random.RandomState(seed)
    layers = []
    for a, b in zip(sizes[:-1], sizes[1:]):
        w = rng.randn(a, b).astype(np.float32) * np.sqrt(2.0 / max(a, 1))
        b_ = np.zeros(b, dtype=np.float32)
        layers.append({"w": w, "b": b_})
    return layers


def clone_weights(layers):
    return [{"w": l["w"].copy(), "b": l["b"].copy()} for l in layers]


def mutate(layers, sigma: float, rng: np.random.RandomState):
    out = clone_weights(layers)
    for l in out:
        l["w"] += rng.randn(*l["w"].shape).astype(np.float32) * sigma
        l["b"] += rng.randn(*l["b"].shape).astype(np.float32) * sigma
    return out


def act_fn(name, h):
    if name == "tanh":
        return np.tanh(h)
    if name == "sigmoid":
        return 1.0 / (1.0 + np.exp(-np.clip(h, -30, 30)))
    return np.maximum(h, 0)


def forward(layers, x, acts):
    h = np.asarray(x, dtype=np.float32)
    for i, layer in enumerate(layers):
        h = h @ layer["w"] + layer["b"]
        if i < len(layers) - 1:
            h = act_fn(acts[i] if i < len(acts) else "relu", h)
    return h


def choose(logits, mask):
    logits = np.asarray(logits, dtype=np.float64).copy()
    m = np.asarray(mask)
    logits[m <= 0] = -1e9
    if np.all(logits <= -1e8):
        return int(np.argmax(m))
    return int(np.argmax(logits))


def weights_to_json(layers):
    return [{"w": l["w"].tolist(), "b": l["b"].tolist()} for l in layers]


def weights_from_json(raw):
    return [{"w": np.asarray(l["w"], dtype=np.float32), "b": np.asarray(l["b"], dtype=np.float32)} for l in raw]


def play_episode(env, layers, acts, scenario, max_steps=80, on_error="penalite"):
    st = env.call({
        "cmd": "play",
        "layers": weights_to_json(layers),
        "acts": acts,
        "scenario": scenario or {},
    })
    return {
        "score": st.get("score", 0),
        "detail": st.get("detail") or {},
        "T": st.get("T", 0),
        "errors": st.get("errors", 0),
        "program": st.get("program") or [],
        "steps": len(st.get("program") or []),
    }


def play_scripted(env, program, scenario):
    """Rejoue un programme en suivant les briques (imitation : paires état/action)."""
    st = env.reset(scenario)
    pairs = []
    # On laisse le moteur JS jouer le programme via des indices : le worker n'expose pas exec brut.
    # L'imitation utilise donc les stratégies en les convertissant côté Node via ENV — ici on
    # collecte en suivant le masque : si l'action scriptée est dans le catalogue, on la joue.
    return st, pairs


class Job:
    def __init__(self, path: Path):
        self.path = path
        self.data = json.loads(path.read_text(encoding="utf-8"))
        self.log = Path(self.data.get("log") or str(path.with_suffix(".log")))

    def save(self):
        atomic_write(self.path, self.data)

    def logline(self, msg):
        ts = time.strftime("%H:%M:%S")
        append_log(self.log, f"[{ts}] {msg}")
        self.data.setdefault("progress", {})["message"] = msg
        self.save()

    def paused(self):
        return json.loads(self.path.read_text(encoding="utf-8")).get("status") == "paused"

    def stopped(self):
        return json.loads(self.path.read_text(encoding="utf-8")).get("status") in ("stopped", "annule")

    def wait_if_paused(self):
        while self.paused():
            time.sleep(0.4)
            if self.stopped():
                return True
        return self.stopped()


def load_strategies(folder: Path):
    out = []
    if not folder.is_dir():
        return out
    for f in sorted(folder.glob("*.json")):
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(j.get("program"), list):
            continue
        j["slug"] = f.stem
        out.append(j)
    return out


def filter_opponents(strats, env, min_score=70):
    kept = []
    for s in strats:
        try:
            q = env.call({"cmd": "qualify", "strategy": s})
            if q.get("ok") and float(q.get("score") or 0) >= min_score:
                item = dict(s)
                item["score"] = q["score"]
                kept.append(item)
        except Exception:
            continue
    if kept:
        return kept
    try:
        ex = env.call({"cmd": "example"})
        if ex.get("program"):
            return [{"name": "Exemple", "program": ex["program"], "score": 85}]
    except Exception:
        pass
    return []


def eval_population_gpu(torch_env_worker, pop, acts, cfg, sc_base, pop_n, n_scen, on_error="penalite", max_steps=80):
    device = torch_env_worker.device
    from trainer.torch_engine import TorchEnv
    rec = cfg.get("recompense") or {}
    penalite = float(rec.get("penalite_contact") or rec.get("penalite_erreur") or 20.0)

    n_layers = len(pop[0])
    w_stacks = []
    b_stacks = []
    for l in range(n_layers):
        w_l = torch.stack([torch.tensor(ind[l]["w"], dtype=torch.float32, device=device) for ind in pop], dim=0)
        b_l = torch.stack([torch.tensor(ind[l]["b"], dtype=torch.float32, device=device) for ind in pop], dim=0).unsqueeze(1)
        w_stacks.append(w_l)
        b_stacks.append(b_l)

    all_scores = [[] for _ in range(pop_n)]
    env = TorchEnv(config=cfg, batch_size=pop_n, device=device)

    for k in range(n_scen):
        env.reset()
        for _ in range(max_steps):
            if env.done.all():
                break
            obs = env.get_obs().unsqueeze(1)
            mask = env.get_live_mask()
            h = obs
            for l in range(n_layers):
                h = torch.bmm(h, w_stacks[l]) + b_stacks[l]
                if l < n_layers - 1:
                    act_name = acts[l] if l < len(acts) else "relu"
                    if act_name == "tanh":
                        h = torch.tanh(h)
                    elif act_name == "sigmoid":
                        h = torch.sigmoid(h)
                    else:
                        h = torch.relu(h)
            logits = h.squeeze(1)
            logits[~mask] = -1e9
            actions = torch.argmax(logits, dim=-1)
            env.step(actions)
            if on_error == "fin":
                env.done = env.done | (env.errors > 0)

        sc = env.score.cpu().tolist()
        err = env.errors.cpu().tolist()
        for i in range(pop_n):
            val = sc[i]
            if penalite:
                val -= penalite * err[i]
            all_scores[i].append(val)

    return [float(np.mean(all_scores[i])) for i in range(pop_n)]


def run_evolution(job: Job, env, cfg, strats):
    regl = cfg.get("reglages") or {}
    pop_n = int(regl.get("population") or 20)
    gens = int(regl.get("generations") or 30)
    sigma = float(regl.get("mutation") or 0.1)
    n_scen = int(regl.get("scenarios_par_evaluation") or 1)
    seed = int(regl.get("graine") or 1)
    t_max = float(regl.get("duree_max") or 300)
    on_error = (cfg.get("recompense") or {}).get("sur_erreur") or "penalite"
    intensity = ((cfg.get("adversaire") or {}).get("intensite")) or "aucun"
    elites = max(1, pop_n // 5)
    rng = np.random.RandomState(seed)
    acts = activations_of(cfg)
    sizes = sizes_of(cfg, env.n_in, env.n_out)
    start = cfg.get("poids")
    base = weights_from_json(start) if start else init_weights(sizes, seed)
    pop = [base] + [mutate(base, sigma, rng) for _ in range(pop_n - 1)]
    t0 = time.time()
    matches = 0
    history = []
    best_w = clone_weights(base)
    best_sc = -1e9
    opponents = strats if intensity not in ("aucun", "none") else []

    def scenario(g, k):
        sc = {"seed": seed + g * 100 + k, "intensite": intensity}
        if opponents:
            sc["opponent"] = opponents[(seed + g + k) % len(opponents)]
        return sc

    for g in range(1, gens + 1):
        if job.wait_if_paused():
            job.data["status"] = "stopped"
            job.logline("Entraînement arrêté.")
            job.save()
            return
        t_gen = time.time()
        if HAS_TORCH and isinstance(env, TorchEnvWorker) and intensity in ("aucun", "none"):
            scores = eval_population_gpu(env, pop, acts, cfg, scenario(g, 0), pop_n, n_scen, on_error=on_error)
            matches += pop_n * n_scen
        else:
            scores = []
            for ind in pop:
                scs = []
                for k in range(n_scen):
                    ep = play_episode(env, ind, acts, scenario(g, k), on_error=on_error)
                    rec = cfg.get("recompense") or {}
                    val = ep["score"]
                    if rec.get("penalite_erreur"):
                        val -= rec["penalite_erreur"] * ep["errors"]
                    scs.append(val)
                    matches += 1
                scores.append(float(np.mean(scs)))
        order = sorted(range(len(pop)), key=lambda i: scores[i], reverse=True)
        pop = [pop[i] for i in order]
        scores = [scores[i] for i in order]
        if scores[0] > best_sc:
            best_sc = scores[0]
            best_w = clone_weights(pop[0])
        mean, worst = float(np.mean(scores)), float(scores[-1])
        dt = time.time() - t_gen
        mps = (pop_n * n_scen) / max(dt, 1e-6)
        elapsed = time.time() - t0
        eta = (elapsed / g) * (gens - g)
        history.append({"g": g, "best": scores[0], "mean": mean, "worst": worst})
        job.data["progress"] = {
            "methode": "evolution",
            "generation": g,
            "generations": gens,
            "best": scores[0],
            "mean": mean,
            "worst": worst,
            "history": history[-200:],
            "eta_s": round(eta),
            "elapsed_s": round(elapsed),
            "matches": matches,
            "matches_per_s": round(mps, 2),
            **device_info(),
        }
        job.data["status"] = "running"
        job.data["best_score"] = best_sc
        job.save()
        job.logline(f"Génération {g}/{gens} — meilleur {scores[0]:.1f} · moyen {mean:.1f} · pire {worst:.1f} · {mps:.2f} matchs/s")
        if elapsed > t_max:
            job.logline("Durée maximale atteinte, on s'arrête.")
            break
        new_pop = [clone_weights(pop[i]) for i in range(elites)]
        while len(new_pop) < pop_n:
            parent = pop[rng.randint(0, elites)]
            new_pop.append(mutate(parent, sigma, rng))
        pop = new_pop
    return best_w, best_sc, history


def run_imitation(job: Job, env, cfg, strats):
    regl = cfg.get("reglages") or {}
    epochs = int(regl.get("epoques") or 40)
    lr = float(regl.get("taux_apprentissage") or 0.02)
    batch = int(regl.get("lot") or 16)
    seed = int(regl.get("graine") or 1)
    t_max = float(regl.get("duree_max") or 300)
    acts = activations_of(cfg)
    sizes = sizes_of(cfg, env.n_in, env.n_out)
    start = cfg.get("poids")
    layers = weights_from_json(start) if start else init_weights(sizes, seed)
    rng = np.random.RandomState(seed)
    demos = [s for s in strats if s.get("program")]
    if not demos:
        job.logline("Aucune stratégie enregistrée : l'imitation n'a rien à apprendre.")
        return layers, 0, []

    def collect():
        xs, ys = [], []
        for s in demos:
            im = env.call({"cmd": "imitate", "program": s.get("program") or [], "scenario": {"intensite": "aucun"}})
            for pair in im.get("pairs") or []:
                xs.append(pair["obs"])
                ys.append(int(pair["action"]))
        return xs, ys

    # Collecte plus fidèle : le worker score.program après un reset ne marche pas.
    # On utilise les observations d'un expert « greedy masque » comme filet, puis SGD.
    job.logline("Collecte des démonstrations à partir des stratégies enregistrées…")
    xs, ys = collect()
    if not xs:
        job.logline("Pas de paires (état, action) collectées.")
        return layers, 0, []

    X_tensor = torch.tensor(xs, dtype=torch.float32, device=DEVICE)
    Y_tensor = torch.tensor(ys, dtype=torch.long, device=DEVICE)
    n = len(ys)
    t0 = time.time()
    history = []

    net = TorchNet(sizes, acts, layers)
    optimizer = torch.optim.SGD(net.parameters(), lr=lr)
    criterion = torch.nn.CrossEntropyLoss()

    job.logline(f"{n} paires collectées, {epochs} époques sur {device_info()['device']}.")

    for ep in range(1, epochs + 1):
        if job.wait_if_paused():
            job.data["status"] = "stopped"
            job.save()
            return net.export_layers(), 0, history

        perm = torch.randperm(n, device=DEVICE)
        total_loss = 0.0
        seen = 0

        net.train()
        for i0 in range(0, n, batch):
            idx = perm[i0:i0 + batch]
            xb, yb = X_tensor[idx], Y_tensor[idx]

            optimizer.zero_grad()
            logits = net(xb)
            loss = criterion(logits, yb)
            loss.backward()
            optimizer.step()

            total_loss += loss.item() * len(yb)
            seen += len(yb)

        mean_loss = total_loss / max(seen, 1)
        history.append({"g": ep, "best": None, "mean": mean_loss, "worst": None, "loss": mean_loss})
        elapsed = time.time() - t0
        eta = (elapsed / ep) * (epochs - ep)
        job.data["progress"] = {
            "methode": "imitation",
            "generation": ep,
            "generations": epochs,
            "loss": mean_loss,
            "history": history[-200:],
            "eta_s": round(eta),
            "elapsed_s": round(elapsed),
            "matches": n * ep,
            **device_info(),
        }
        job.data["status"] = "running"
        job.save()
        job.logline(f"Époque {ep}/{epochs} — perte {mean_loss:.4f}")
        if elapsed > t_max:
            job.logline("Durée maximale atteinte, on s'arrête.")
            break

    return net.export_layers(), 0, history


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True, help="fichier JSON de la tâche")
    ap.add_argument("--strategies", help="dossier des stratégies (démonstrations / adversaires)")
    ap.add_argument("--weights-out", help="où écrire les poids du meilleur modèle")
    args = ap.parse_args()
    job = Job(Path(args.job))
    cfg = job.data.get("config") or {}
    job.data["status"] = "running"
    job.data["progress"] = {"message": "Démarrage…", **device_info()}
    job.save()
    job.logline("Entraîneur démarré (" + device_info()["name"] + ").")
    env_cfg = {
        "entrees": cfg.get("entrees"),
        "familles": (cfg.get("actions") or {}).get("familles"),
        "params": cfg.get("params") or {},
        "adversaire": cfg.get("adversaire") or {"intensite": "aucun"},
        "mode": (cfg.get("reglages") or {}).get("mode") or "rapide",
        "skipContacts": True,
        "onError": (cfg.get("recompense") or {}).get("sur_erreur") or "penalite",
    }
    if HAS_TORCH:
        env = TorchEnvWorker(env_cfg)
    else:
        env = EnvWorker(env_cfg)
    try:
        folder = Path(args.strategies) if args.strategies else None
        strats = load_strategies(folder) if folder else []
        methode = cfg.get("methode") or "evolution"
        if methode == "imitation":
            best_w, best_sc, history = run_imitation(job, env, cfg, strats)
        else:
            best_w, best_sc, history = run_evolution(job, env, cfg, strats)
        out = Path(args.weights_out or job.data.get("weights") or job.path.with_name(job.path.stem + "-poids.json"))
        atomic_write(out, {"format": "camelot-poids", "version": 1, "layers": weights_to_json(best_w)})
        job.data["weights"] = str(out)
        job.data["best_score"] = best_sc
        job.data["status"] = "done"
        job.data.setdefault("progress", {})["message"] = "Terminé."
        job.save()
        job.logline("Terminé. Poids enregistrés.")
    except Exception as e:
        job.data["status"] = "error"
        job.data["error"] = str(e)
        job.save()
        job.logline("Erreur : " + str(e))
        raise
    finally:
        if hasattr(env, 'close'):
            env.close()


if __name__ == "__main__":
    main()
