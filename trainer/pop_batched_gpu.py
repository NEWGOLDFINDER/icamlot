import torch
import numpy as np

def run_batched_evaluation(pool, pop, acts, scenario_fn, g, n_scen, cfg, env_n_in, env_n_out, device):
    pop_n = len(pop)
    scores = np.zeros(pop_n)
    rec = cfg.get("recompense") or {}
    pen = rec.get("penalite_erreur", 0)

    # 1. Empiler les poids de la population sur GPU (TorchNet / bmm approach)
    # pop is a list of layers: [ [ {"w": array, "b": array}, ... ], ... ]

    n_layers = len(pop[0])
    W_tensors = []
    B_tensors = []

    for l in range(n_layers):
        # Gather all Ws for layer l
        # Shape of W in JS/Numpy: (in, out)
        Ws = np.stack([ind[l]["w"] for ind in pop]) # (pop_n, in, out)
        Bs = np.stack([ind[l]["b"] for ind in pop]) # (pop_n, out)
        W_tensors.append(torch.tensor(Ws, dtype=torch.float32, device=device))
        B_tensors.append(torch.tensor(Bs, dtype=torch.float32, device=device).unsqueeze(1)) # (pop_n, 1, out)

    n_workers = pool.n_workers if hasattr(pool, 'n_workers') else 1

    matches_played = 0

    for k in range(n_scen):
        sc = scenario_fn(g, k)

        # Array to store results of this scenario for each individual
        ep_scores = np.zeros(pop_n)

        # We need to play the episode for all individuals.
        # If pool has N workers, we run N individuals at a time.

        # We will loop over chunks of population of size n_workers
        for start_idx in range(0, pop_n, n_workers):
            end_idx = min(start_idx + n_workers, pop_n)
            batch_size = end_idx - start_idx

            # Send reset to all workers in the batch
            reset_msgs = [{"cmd": "reset", "scenario": sc} for _ in range(batch_size)]
            # Fill with None for unused workers
            reset_msgs += [None] * (n_workers - batch_size)

            states = pool.call_all(reset_msgs)

            dones = [False] * batch_size

            while not all(dones):
                # Gather active observations
                obs_list = []
                mask_list = []
                active_indices = []

                for i in range(batch_size):
                    if not dones[i] and states[i] and not states[i].get("error"):
                        obs_list.append(states[i]["obs"])
                        mask_list.append(states[i]["mask"])
                        active_indices.append(start_idx + i)
                    elif not dones[i]:
                        # Error or something, mark done
                        dones[i] = True

                if not active_indices:
                    break

                # Convert to tensors
                obs_t = torch.tensor(obs_list, dtype=torch.float32, device=device).unsqueeze(1) # (B, 1, in)
                mask_t = torch.tensor(mask_list, dtype=torch.bool, device=device) # (B, out)

                # Batched forward pass on GPU
                h = obs_t
                for l in range(n_layers):
                    # For active indices, extract their specific weights
                    w = W_tensors[l][active_indices] # (B, in, out)
                    b = B_tensors[l][active_indices] # (B, 1, out)

                    # h: (B, 1, in) bmm w: (B, in, out) -> (B, 1, out)
                    h = torch.bmm(h, w) + b
                    if l < n_layers - 1:
                        act = acts[l] if l < len(acts) else "relu"
                        if act == "tanh":
                            h = torch.tanh(h)
                        elif act == "sigmoid":
                            h = torch.sigmoid(h)
                        else:
                            h = torch.relu(h)

                logits = h.squeeze(1) # (B, out)

                # Apply mask
                logits[~mask_t] = -1e9

                # Choose action
                actions = torch.argmax(logits, dim=1).cpu().numpy()

                # Send step commands
                step_msgs = [None] * n_workers
                for idx, active_idx in enumerate(active_indices):
                    worker_idx = active_idx - start_idx
                    step_msgs[worker_idx] = {"cmd": "step", "action": int(actions[idx])}

                next_states = pool.call_all(step_msgs)

                for i in range(batch_size):
                    if not dones[i] and step_msgs[i] is not None:
                        if next_states[i].get("done") or next_states[i].get("error"):
                            dones[i] = True
                        states[i] = next_states[i]

            # Fetch scores
            score_msgs = [None] * n_workers
            for i in range(batch_size):
                score_msgs[i] = {"cmd": "score"}

            final_scores = pool.call_all(score_msgs)

            for i in range(batch_size):
                fs = final_scores[i] or {}
                sc_val = fs.get("score", 0)
                errs = fs.get("errors", 0)
                ep_scores[start_idx + i] = sc_val - pen * errs
                matches_played += 1

        scores += ep_scores

    scores /= max(1, n_scen)
    return scores.tolist(), matches_played
