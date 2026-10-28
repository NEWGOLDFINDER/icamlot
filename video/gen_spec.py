"""Extrait de spec/robot.json et spec/regles_2027.json (branche audit/simulateur-ia) les valeurs utilisées par la scène."""
import json
import sys
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else '../../icamlot-audit')
r = json.loads((root / 'spec/robot.json').read_text())
s = json.loads((root / 'spec/regles_2027.json').read_text())
d = {'top': r['chassis']['plaque_haute']['polygone_repere_robot'], 'foot': r['chassis']['empreinte_sol']['polygone'],
     'wheels': r['entrainement']['roues'], 'toit': r['chassis']['toit_cible']['valeur'],
     'carrieres': s['carrieres']['liste'], 'murs': s['remparts_jaune']['murs'], 'tours': s['remparts_jaune']['tours'],
     'aruco': s['aruco_table']['centres'], 'pami': s['ecuries_pami']}
Path('spec.json').write_text(json.dumps(d))
