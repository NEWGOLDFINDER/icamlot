"""Calage de la voix : nouvelles durées de plans, position de chaque phrase, sous-titres découpés aux pauses, piste voix placée."""
import json, re, subprocess, wave
import numpy as np
OLD = [('S01', 4.5), ('S02', 6.0), ('S03', 7.5), ('S04', 5.0), ('S05', 9.0), ('S06', 7.0), ('S07', 5.0), ('CH1', 1.4), ('S08', 6.5), ('S09', 4.5), ('S10', 5.5),
       ('CH2', 1.4), ('S11', 7.5), ('S12', 5.5), ('CH3', 1.4), ('S13', 7.0), ('S14', 6.5), ('CH4', 1.4), ('S15', 6.0), ('S16', 4.5), ('S17', 5.5), ('END', 7.0)]
NEW = dict(OLD); NEW.update({'S02': 5.6, 'S03': 7.8, 'S04': 5.7, 'S05': 8.6, 'S06': 6.0, 'S07': 5.3, 'S08': 6.6, 'S09': 4.0, 'S10': 4.6,
                             'S11': 8.1, 'S13': 8.0, 'S14': 7.3, 'S16': 4.4, 'S17': 6.2, 'END': 7.5})
SLOT = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'CH1', 'S09', 'S10', 'CH2', 'S12', 'CH3', 'S14', 'CH4', 'S16', 'S17', 'END']   # plan où démarre chaque phrase
LEAD = 0.3
start, acc = {}, 0.0
for k, _ in OLD: start[k] = acc; acc += NEW[k]
TOTAL = acc
seg = json.load(open('segments.json', encoding='utf-8'))
out = subprocess.run(['ffmpeg', '-i', 'voix.mp3', '-af', 'silencedetect=noise=-40dB:d=0.3', '-f', 'null', '-'], capture_output=True, text=True).stderr
sil = list(zip(map(float, re.findall(r'silence_start: ([0-9.]+)', out)), map(float, re.findall(r'silence_end: ([0-9.]+)', out))))
# contrôle : chaque phrase tient dans la place jusqu'au début de la phrase suivante
lines = []
for i, s in enumerate(seg):
    t0 = start[SLOT[i]] + LEAD
    nxt = start[SLOT[i + 1]] if i + 1 < len(SLOT) else TOTAL
    marge = nxt - (t0 + s['duree'])
    # découpage en sous-titres : phrases, calées sur les pauses internes les plus longues
    parts = [p.strip() for p in re.split(r'(?<=[.?…])\s+', s['texte']) if p.strip()]
    inner = sorted([(e - a, a, e) for a, e in sil if a > s['debut'] + 0.2 and e < s['fin'] - 0.2], reverse=True)[:len(parts) - 1]
    cuts = sorted([(a, e) for _, a, e in inner])
    if len(cuts) != len(parts) - 1:   # repli : proportion du texte
        tot = sum(len(p) for p in parts); c = 0; cuts = []
        for p in parts[:-1]: c += len(p); x = s['debut'] + s['duree'] * c / tot; cuts.append((x, x))
    chunks, a = [], s['debut']
    for j, p in enumerate(parts):
        b = cuts[j][0] if j < len(cuts) else s['fin']
        chunks.append({'texte': p, 'debut': round(t0 + (a - s['debut']), 3), 'fin': round(t0 + (b - s['debut']), 3)})
        if j < len(cuts): a = cuts[j][1]
    lines.append({'i': i + 1, 'plan': SLOT[i], 'debut': round(t0, 3), 'fin': round(t0 + s['duree'], 3), 'src': [s['debut'], s['fin']], 'marge': round(marge, 2), 'sous_titres': chunks})
    print(f"{i+1:2d} {SLOT[i]:4s} {t0:7.2f}-{t0+s['duree']:7.2f}  marge {marge:5.2f}  {len(chunks)} sous-titres{'' if len(cuts)==len(parts)-1 else ' (repli)'}")
json.dump({'plans_anciens': OLD, 'plans': [[k, NEW[k]] for k, _ in OLD], 'duree': TOTAL, 'lignes': lines}, open('voix_plan.json', 'w'), ensure_ascii=False, indent=1)
# piste voix placée (48 kHz, mono)
SR = 48000
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'voix.mp3', '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'], capture_output=True).stdout
x = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768
y = np.zeros(int(TOTAL * SR) + SR)
for l in lines:
    a, b = int(l['src'][0] * SR), int(l['src'][1] * SR); piece = x[a:b].copy(); f = int(0.015 * SR)
    piece[:f] *= np.linspace(0, 1, f); piece[-f:] *= np.linspace(1, 0, f)
    o = int(l['debut'] * SR); y[o:o + len(piece)] += piece
y = y[:int(TOTAL * SR)]
with wave.open('voix_placee.wav', 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(y, -1, 1) * 32767).astype('<i2').tobytes())
print('durée totale', round(TOTAL, 2), 's ; marges négatives :', [l['i'] for l in lines if l['marge'] < 0])
