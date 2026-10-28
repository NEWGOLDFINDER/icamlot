"""Réduit les matchs échantillonnés par gen_match_reference.js (match_programme_reference*.json) au format lu par la page (mref*.json)."""
import json
import sys

for src, dst in [('match_programme_reference_solo.json', 'mref_solo.json'), ('match_programme_reference.json', 'mref.json')]:
    m = json.load(open(sys.argv[1] + '/' + src if len(sys.argv) > 1 else src))
    out = {'dt': m['echantillonnage']['dt'],
           'robots': {k: [[r[0], r[1], r[2]] for r in v] for k, v in m['robots'].items() if v},
           'pierres': {k: [None if r is None else [r[0], {'jaune': 1, 'bleu': 2}.get(r[1], 0), *r[2:10]] for r in v] for k, v in m['pierres'].items()},
           'graal': {k: v for k, v in m['graal'].items() if v}, 'boulets': {k: v for k, v in m['boulets'].items() if v},
           'score': {k: v for k, v in m['score'].items() if v},
           'briques': {k: m[k]['briques'] for k in ('jaune', 'bleu') if m.get(k)},
           'segments': {k: m[k].get('segments') for k in ('jaune', 'bleu') if m.get(k)},
           'score_final': {k: m[k]['score_final'] for k in ('jaune', 'bleu') if m.get(k)}, 'evenements': m['evenements_pierres']}
    json.dump(out, open(dst, 'w'), separators=(',', ':'))
    print(dst, out['score_final']['jaune']['total'])
