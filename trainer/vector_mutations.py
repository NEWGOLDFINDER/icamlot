import torch
import numpy as np
from trainer.trainer import clone_weights

def mutate_batched_gpu(pop, elites_count, sigma, pop_n, device):
    """
    Takes the current sorted population, keeps `elites_count` elite individuals,
    and replaces the rest of the population with mutated copies of the elites.
    This operates using PyTorch tensors for rapid mutations.
    Returns the new population as a standard list of weights (JSON-like format).
    """
    # Create the base list of new pop
    new_pop = [clone_weights(pop[i]) for i in range(elites_count)]

    n_layers = len(pop[0])

    # Randomly select parents from elites for the rest of the population
    n_children = pop_n - elites_count
    if n_children <= 0:
        return new_pop

    parent_indices = np.random.randint(0, elites_count, size=n_children)

    # Reconstruct the children by layer, directly in GPU
    children = [{"w": None, "b": None} for _ in range(n_layers)]

    for l in range(n_layers):
        # Gather elites for this layer
        elites_w = np.stack([pop[i][l]["w"] for i in range(elites_count)])
        elites_b = np.stack([pop[i][l]["b"] for i in range(elites_count)])

        # Move to GPU
        elites_w_t = torch.tensor(elites_w, dtype=torch.float32, device=device)
        elites_b_t = torch.tensor(elites_b, dtype=torch.float32, device=device)

        # Select parents
        parents_w = elites_w_t[parent_indices]
        parents_b = elites_b_t[parent_indices]

        # Mutate
        mutated_w = parents_w + torch.randn_like(parents_w) * sigma
        mutated_b = parents_b + torch.randn_like(parents_b) * sigma

        # Bring back to CPU
        children[l]["w"] = mutated_w.cpu().numpy()
        children[l]["b"] = mutated_b.cpu().numpy()

    # Reassemble new_pop
    for c in range(n_children):
        child = []
        for l in range(n_layers):
            child.append({
                "w": children[l]["w"][c],
                "b": children[l]["b"][c]
            })
        new_pop.append(child)

    return new_pop
