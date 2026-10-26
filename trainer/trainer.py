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
WORKER = ROOT / "engine" / "env_worker.js"

try:
    import numpy as np
except ImportError:  # pragma: no cover
    sys.stderr.write("NumPy est requis pour l'entraîneur.\n")
    sys.exit(2)

try:
    import torch
    HAS_TORCH = True
except ImportError:
    torch = None
    HAS_TORCH = False


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
        return {"device": "cuda", "name": name, "vram_mo": round(mem / 1024 / 1024)}
    return {"device": "cpu", "name": "CPU (NumPy)" + (" + PyTorch" if HAS_TORCH else ""), "vram_mo": 0}


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


def play_episode(env: EnvWorker, layers, acts, scenario, max_steps=80, on_error="penalite"):
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


def play_scripted(env: EnvWorker, program, scenario):
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


def filter_opponents(strats, env: EnvWorker, min_score=70):
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


def run_evolution(job: Job, env: EnvWorker, cfg, strats):
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
        scores = []
        t_gen = time.time()
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


def run_imitation(job: Job, env: EnvWorker, cfg, strats):
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
    X = np.asarray(xs, dtype=np.float32)
    Y = np.asarray(ys, dtype=np.int64)
    n = len(Y)
    t0 = time.time()
    history = []
    job.logline(f"{n} paires collectées, {epochs} époques.")
    for ep in range(1, epochs + 1):
        if job.wait_if_paused():
            job.data["status"] = "stopped"
            job.save()
            return layers, 0, history
        perm = rng.permutation(n)
        total_loss = 0.0
        seen = 0
        for i0 in range(0, n, batch):
            idx = perm[i0:i0 + batch]
            xb, yb = X[idx], Y[idx]
            # forward + softmax CE, rétropropagation manuelle
            hs = [xb]
            h = xb
            pre = []
            for i, layer in enumerate(layers):
                z = h @ layer["w"] + layer["b"]
                pre.append(z)
                if i < len(layers) - 1:
                    h = act_fn(acts[i] if i < len(acts) else "relu", z)
                else:
                    h = z
                hs.append(h)
            z = pre[-1]
            z = z - z.max(axis=1, keepdims=True)
            exp = np.exp(z)
            p = exp / exp.sum(axis=1, keepdims=True)
            loss = 0.0
            dz = p.copy()
            for r, y in enumerate(yb):
                loss += -np.log(max(p[r, y], 1e-8))
                dz[r, y] -= 1
            loss /= max(len(yb), 1)
            dz /= max(len(yb), 1)
            total_loss += loss * len(yb)
            seen += len(yb)
            # backprop
            grads = [None] * len(layers)
            for i in range(len(layers) - 1, -1, -1):
                x_in = hs[i]
                grads[i] = {"w": x_in.T @ dz, "b": dz.sum(axis=0)}
                if i == 0:
                    break
                dh = dz @ layers[i]["w"].T
                name = acts[i - 1] if i - 1 < len(acts) else "relu"
                zprev = pre[i - 1]
                if name == "tanh":
                    dh = dh * (1 - np.tanh(zprev) ** 2)
                elif name == "sigmoid":
                    sig = 1 / (1 + np.exp(-np.clip(zprev, -30, 30)))
                    dh = dh * sig * (1 - sig)
                else:
                    dh = dh * (zprev > 0)
                dz = dh
            for i, layer in enumerate(layers):
                layer["w"] -= lr * grads[i]["w"]
                layer["b"] -= lr * grads[i]["b"]
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
    return layers, 0, history


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
        env.close()


if __name__ == "__main__":
    main()
