#!/usr/bin/env python3
"""Duels de benchmark : un modèle contre des adversaires, dans le moteur JS de référence.

Le juge est `trainer/evaluation.py` (fonction `evaluate`, même pool d'environnements `trainer/js_env_pool.py`) :
mêmes graines, même répartition jaune / bleu que la sélection du champion (docs/CONTRATS.md §17).

Modèle joué (--modele) :
  - `.onnx` : export de `trainer/export_onnx.py`, son `.meta.json` à côté (comme `pi5_runner.py`), exécuté par ONNX Runtime ;
  - `.pt` : point de sauvegarde `trainer/models.py` ;
  - absent : politique aléatoire sur les actions valides (référence).

Adversaires (au moins un, ou --sans-adversaire) :
  - --robots : robots à règles `batisseur`, `razzia` (docs/CONTRATS.md §14) ; `champion` et `intermediaire` exigent un modèle
    figé dans `.data/adversaires/<id>.json` (ou dossier ICAMLOT_ADVERSAIRES) ;
  - --strategie : stratégie enregistrée (JSON camelot-strategie, répétable) ;
  - --cerveau CONFIG POIDS : cerveau MLP (camelot-cerveau et camelot-poids, répétable) ;
  - --sans-adversaire : notre robot seul sur la table.

Le total --matchs est réparti à parts égales entre les adversaires choisis. L'intensité (--intensite, défaut « realiste »)
s'applique à tous les adversaires sauf « sans adversaire ». Rapport : par adversaire et par couleur.

  python benchmark_duels.py --modele .data/modeles/ppo.onnx --matchs 40 --robots batisseur razzia \
      --strategie .data/strategies/x.json --rapport .data/benchmarks/ppo.md
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional, Sequence

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np
import torch

from trainer.evaluation import build_sampler, evaluate, resume
from trainer.js_env_pool import JsEnvPool, default_procs
from trainer.models import load_checkpoint, masked_logits
from trainer.scenarios import BLEU, INTENSITES, JAUNE, PART_BLEU_DEFAUT, ROBOTS, ScenarioSampler

# Hypothèse : nombre de matchs du benchmark par défaut (la sélection d'un champion utilise trainer.evaluation.MATCHS_SELECTION).
MATCHS_DEFAUT = 20
INTENSITE_DEFAUT = "realiste"
SANS_ADVERSAIRE = "aucun"


class PolitiqueOnnx:
    """Réseau ONNX (obs brute + hidden -> logits non masqués + next_hidden) avec l'interface de `trainer.evaluation.evaluate` :
    appel (obs, hidden, mask) sur un lot -> (logits masqués, None, next_hidden). Même contrat que `pi5_runner.Politique`."""

    def __init__(self, onnx: Path, meta: dict):
        import onnxruntime as ort
        self.sess = ort.InferenceSession(str(onnx), providers=["CPUExecutionProvider"])
        self.n_in, self.n_out, self.hidden = int(meta["n_in"]), int(meta["n_out"]), int(meta["hidden"])

    def eval(self):
        return self

    def init_hidden(self, batch_size: int, device=None) -> torch.Tensor:
        return torch.zeros(batch_size, self.hidden, device=device)

    def __call__(self, obs: torch.Tensor, hidden: torch.Tensor, mask: Optional[torch.Tensor] = None):
        lg, nh = self.sess.run(["logits", "next_hidden"],
                               {"obs": obs.cpu().numpy().astype(np.float32), "hidden": hidden.cpu().numpy().astype(np.float32)})
        return masked_logits(torch.from_numpy(lg), mask), None, torch.from_numpy(nh)


def charger_modele(chemin: Optional[str]):
    """(modèle évaluable, meta ou point de sauvegarde, libellé). Modèle None : politique aléatoire de référence."""
    if not chemin:
        return None, {}, "politique aléatoire (référence)"
    p = Path(chemin)
    if p.suffix == ".onnx":
        meta_p = p.with_suffix(".meta.json")
        if not meta_p.exists():
            raise SystemExit(f"{meta_p.name} introuvable à côté de {p.name} : les versions du modèle sont inconnues.")
        meta = json.loads(meta_p.read_text(encoding="utf-8"))
        return PolitiqueOnnx(p, meta), meta, str(p)
    model, ck = load_checkpoint(str(p))
    return model, ck, str(p)


def echantillonneur(a: argparse.Namespace) -> ScenarioSampler:
    """Adversaires choisis -> mélange à parts égales (robots, stratégies, cerveaux, « sans adversaire »)."""
    base = build_sampler([Path(p) for p in a.strategie], Path(a.dossier_strategies) if a.dossier_strategies else None,
                         a.cerveau, [a.intensite], part_bleu=a.part_bleu)
    melange = {r: 1.0 for r in a.robots}
    melange.update({o["id"]: 1.0 for o in base.opponents})
    if a.sans_adversaire:
        melange[SANS_ADVERSAIRE] = 1.0
    if not melange:
        raise SystemExit("Aucun adversaire : --robots, --strategie, --cerveau ou --sans-adversaire.")
    return ScenarioSampler(base.opponents, [a.intensite], a.graine, melange=melange, part_bleu=a.part_bleu)


def _score(b: Optional[dict]) -> str:
    if not b or b["score"]["moyenne"] is None:
        return "—"
    s = f"{b['score']['moyenne']:.1f} ± {b['score']['ecart_type']:.1f}"
    if b.get("taux_victoire") is not None:
        s += f" · vict. {100 * b['taux_victoire']:.0f} %"
    return f"{s} ({b['matchs']})"


def _adv(b: Optional[dict]) -> str:
    m = (b or {}).get("score_adversaire") or {}
    return "—" if m.get("moyenne") is None else f"{m['moyenne']:.1f}"


def rapport_markdown(r: dict, modele: str) -> str:
    """Tableau par adversaire et par couleur : score moyen ± écart-type, victoires, nombre de matchs entre parenthèses."""
    pe = r.get("par_equipe") or {}
    lignes = [f"# Duels : {modele}", "", f"`{resume(r)}`", "",
              "| Adversaire | Jaune : score · victoires (matchs) | Bleu : score · victoires (matchs) | Score adverse | Erreurs moteur / match |",
              "|---|---|---|---|---|"]
    for k, b in r["par_adversaire"].items():
        p = b.get("par_equipe") or {}
        lignes.append(f"| {k} | {_score(p.get(JAUNE))} | {_score(p.get(BLEU))} | {_adv(b)} | {b['erreurs_par_match']['moyenne']:.2f} |")
    if len(r["par_adversaire"]) > 1:
        lignes.append(f"| **Total** | {_score(pe.get(JAUNE))} | {_score(pe.get(BLEU))} | {_adv(r)} | {r['erreurs_par_match']['moyenne']:.2f} |")
    return "\n".join(lignes) + "\n"


def main(argv: Optional[Sequence[str]] = None) -> dict:
    ap = argparse.ArgumentParser(description="Duels d'un modèle contre des adversaires dans le moteur JS de référence.")
    ap.add_argument("--modele", help=".onnx (+ .meta.json à côté) ou point de sauvegarde .pt ; sinon politique aléatoire")
    ap.add_argument("--matchs", type=int, default=MATCHS_DEFAUT, help="matchs au total, répartis entre les adversaires")
    ap.add_argument("--robots", nargs="+", default=[], choices=ROBOTS, help="robots à règles ou réseaux figés")
    ap.add_argument("--strategie", action="append", default=[], help="stratégie enregistrée (JSON camelot-strategie), répétable")
    ap.add_argument("--dossier-strategies", help="toutes les stratégies d'un dossier comme adversaires")
    ap.add_argument("--cerveau", nargs=2, action="append", default=[], metavar=("CONFIG", "POIDS"),
                    help="cerveau MLP adverse : configuration camelot-cerveau et poids camelot-poids, répétable")
    ap.add_argument("--sans-adversaire", action="store_true", help="inclure notre robot seul sur la table")
    ap.add_argument("--intensite", default=INTENSITE_DEFAUT, choices=INTENSITES, help="intensité des adversaires (défaut : realiste)")
    ap.add_argument("--part-bleu", type=float, default=PART_BLEU_DEFAUT, help="proportion de matchs joués en bleu (0 = jaune seul)")
    ap.add_argument("--graine", type=int, default=10_000, help="première graine des scénarios (mêmes matchs d'un appel à l'autre)")
    ap.add_argument("--processus", type=int, default=default_procs())
    ap.add_argument("--envs-par-processus", type=int, default=4)
    ap.add_argument("--echantillonner", action="store_true", help="politique échantillonnée au lieu de gloutonne")
    ap.add_argument("--env-config", help="configuration ENV.create (JSON) ; sinon celle du modèle, sinon {skipContacts: true}")
    ap.add_argument("--sortie", help="écrit le rapport JSON ici")
    ap.add_argument("--rapport", help="écrit le tableau Markdown ici")
    a = ap.parse_args(argv)

    model, ck, libelle = charger_modele(a.modele)
    env_cfg = (json.loads(Path(a.env_config).read_text(encoding="utf-8")) if a.env_config
               else (ck.get("env_config") or {"skipContacts": True}))
    sampler = echantillonneur(a)
    scenarios = sampler.fixed(a.matchs, a.graine)
    for sc in scenarios:
        if sc["intensite"] != SANS_ADVERSAIRE:
            sc["intensite"] = a.intensite
    with JsEnvPool(a.processus, a.envs_par_processus, env_cfg, opponents=sampler.registry()) as pool:
        for cle in ("obs_version", "catalogue_version"):
            attendu = ck.get(cle)
            if model is not None and attendu not in (None, getattr(pool, cle)):
                raise SystemExit(f"{libelle} : {cle} {attendu!r} ≠ moteur {getattr(pool, cle)!r} : modèle refusé.")
        r = evaluate(model, pool, scenarios, deterministic=not a.echantillonner, log=print)
    r["protocole"] = {"modele": libelle, "matchs": a.matchs, "graine": a.graine, "intensite": a.intensite,
                      "glouton": not a.echantillonner, **sampler.describe()}
    md = rapport_markdown(r, libelle)
    print(md)
    if a.sortie:
        Path(a.sortie).parent.mkdir(parents=True, exist_ok=True)
        Path(a.sortie).write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
    if a.rapport:
        Path(a.rapport).parent.mkdir(parents=True, exist_ok=True)
        Path(a.rapport).write_text(md, encoding="utf-8")
    return r


if __name__ == "__main__":
    main()
