"""Maille les modules dessinés par tools/cao_robot.py (repère module : x normale de face, y droite, z hauteur, mm)."""
import json, sys
sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else '../../icamlot-audit/tools')   # tools/ de la branche audit/simulateur-ia
import cao_robot as C

def tri(shape, defl=0.6):
    t = C.mesh(shape, defl)
    pos = [round(v, 2) for tr in t for p in tr for v in p]
    return pos

out = {}
fixe, mobile, tour = C.nacelle(h=C.H_PRISE)
out['nacelle_fixe'] = tri(fixe); out['nacelle_mobile'] = tri(mobile); out['nacelle_tour'] = tri(tour)
out['pile'] = [tri(p) for p in C.pile(h=C.H_PRISE)]
gg = C.graal_geometrie()
out['graal'] = tri(C.graal(gg['x_prise'], gg['y0'], 0.0))
afixe, amob = C.ascenseur(C.FACE + C.F['jeu_face'], C.F['dent_bas'], gg)
out['asc_fixe'] = tri(afixe); out['asc_mob'] = tri(amob)
lanceur, tube, chargeur, boulets = C.canon(False)
out['canon_lanceur'] = tri(lanceur); out['canon_tube'] = tri(tube)
out['chargeur'] = tri(chargeur); out['boulets'] = tri(boulets, 1.5)
out['meta'] = {'H_PRISE': C.H_PRISE, 'FACE': C.FACE, 'TOIT': C.TOIT, 'graal': gg}
json.dump(out, open('meshes.json', 'w'))
print({k: (len(v) // 9 if isinstance(v, list) and v and not isinstance(v[0], list) else '') for k, v in out.items()})
