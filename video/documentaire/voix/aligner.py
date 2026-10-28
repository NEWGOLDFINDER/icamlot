"""Alignement forcé texte → silences : choisit 17 coupures parmi les silences détectés (programmation dynamique)."""
import json, re, subprocess
out = subprocess.run(['ffmpeg', '-i', 'voix.mp3', '-af', 'silencedetect=noise=-40dB:d=0.3', '-f', 'null', '-'], capture_output=True, text=True).stderr
st = [float(x) for x in re.findall(r'silence_start: ([0-9.]+)', out)]
en = [(float(a), float(b)) for a, b in re.findall(r'silence_end: ([0-9.]+) \| silence_duration: ([0-9.]+)', out)]
sil = [(s, e, d) for s, (e, d) in zip(st, en)]
TOTAL = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', 'voix.mp3'], capture_output=True, text=True).stdout)
lines = [l.strip() for l in open('texte.txt', encoding='utf-8') if l.strip()]
# poids : lettres + pauses de ponctuation internes
def poids(l): return len(re.sub(r'[^\wÀ-ÿ]', '', l)) + 8 * len(re.findall(r'[.,:;?…]', l))
w = [poids(l) for l in lines]
speech_start = sil[0][1] if sil and sil[0][0] < 0.05 else 0.0
end_speech = sil[-1][0] if sil and sil[-1][1] >= TOTAL - 0.05 else TOTAL
cands = [x for x in sil if x[0] > 0.5 and x[1] < end_speech - 0.3]
cum = [sum(w[:i + 1]) / sum(w) for i in range(len(w))]
exp_t = [speech_start + c * (end_speech - speech_start) for c in cum[:-1]]
INF = 1e18
n, m = len(exp_t), len(cands)
dp = [[INF] * m for _ in range(n)]; bk = [[-1] * m for _ in range(n)]
def cost(i, j):
    s, e, d = cands[j]; mid = (s + e) / 2
    return ((mid - exp_t[i]) / 1.6) ** 2 - 3.0 * min(d, 1.6)
for j in range(m): dp[0][j] = cost(0, j)
for i in range(1, n):
    best, bj = INF, -1
    for j in range(m):
        if j > 0 and dp[i - 1][j - 1] < best: best, bj = dp[i - 1][j - 1], j - 1
        if best < INF: dp[i][j] = best + cost(i, j); bk[i][j] = bj
j = min(range(m), key=lambda k: dp[n - 1][k]); path = [j]
for i in range(n - 1, 0, -1): j = bk[i][j]; path.append(j)
path = path[::-1]
cuts = [cands[k] for k in path]
seg = []; t0 = speech_start
for i, l in enumerate(lines):
    t1 = cuts[i][0] if i < len(cuts) else end_speech
    seg.append({'i': i + 1, 'debut': round(t0, 3), 'fin': round(t1, 3), 'duree': round(t1 - t0, 3), 'texte': l, 'poids': w[i]})
    if i < len(cuts): t0 = cuts[i][1]
for s in seg: s['debit'] = round(s['poids'] / s['duree'], 1)
json.dump(seg, open('segments.json', 'w'), ensure_ascii=False, indent=1)
for s in seg: print(f"{s['i']:2d} {s['debut']:7.2f}-{s['fin']:7.2f} ({s['duree']:5.2f} s)  débit {s['debit']:5.1f}  {s['texte'][:60]}")
