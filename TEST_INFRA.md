# Tests : document remplacé

Ce plan de tests (exigences F1 à F18 de l'ancienne architecture) est périmé. Il citait `torch_engine.py`, `Pi5EurobotAgent` et `tests/test_e2e_requirements.py`, qui n'existent plus.

Tests actuels :
- Python : `python -m pytest -q` (`python -m pytest -q -m "not lent"` pour sauter ceux qui jouent des matchs) ;
- moteur et environnement : `node tests/test_moteur.js`, `node tests/test_engine.js`, `node tests/test_adversaires.js`.

Détail : [README.md](README.md), section Tests.
