"""Musique du documentaire (synthèse, aucun échantillon externe), calée sur les plans de partDoc.js."""
import wave
import numpy as np

SR = 48000
PLANS = [('S01', 4.5), ('S02', 6.0), ('S03', 7.5), ('S04', 5.0), ('S05', 9.0), ('S06', 7.0), ('S07', 5.0),
         ('CH1', 1.4), ('S08', 6.5), ('S09', 4.5), ('S10', 5.5), ('CH2', 1.4), ('S11', 7.5), ('S12', 5.5),
         ('CH3', 1.4), ('S13', 7.0), ('S14', 6.5), ('CH4', 1.4), ('S15', 6.0), ('S16', 4.5), ('S17', 5.5), ('END', 7.0)]
PL, acc = {}, 0.0
for k, d in PLANS:
    PL[k] = (acc, acc + d)
    acc += d
DUR = acc
N = int(SR * DUR)
L = np.zeros(N)
R = np.zeros(N)
rng = np.random.default_rng(3)


def put(sig, t0, gain=1.0, pan=0.0):
    i = int(t0 * SR)
    if i >= N or i + len(sig) <= 0:
        return
    s = sig[: N - i] * gain
    L[i:i + len(s)] += s * np.sqrt(0.5 * (1 - pan))
    R[i:i + len(s)] += s * np.sqrt(0.5 * (1 + pan))


def lp(x, fc):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / np.sqrt(1 + (f / fc) ** 4), len(x))


def pluck(f, dur=1.6, g=0.2):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.25) + 0.12 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t / 0.12))
    return s * np.minimum(1, t / 0.004) * np.exp(-t / 0.55) * g


def pad(freqs, dur, g=0.08):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for f in freqs:
        for det in (-0.25, 0.0, 0.27):
            s += np.sin(2 * np.pi * (f + det) * t + rng.uniform(0, 6.28)) + 0.3 * np.sin(2 * np.pi * 2 * (f + det) * t)
    s = lp(s, 1600)
    fade = np.minimum(1, t / 0.9) * np.minimum(1, (dur - t) / 0.9)
    return s / len(freqs) * fade * g


def kick(g=0.5):
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * np.cumsum(50 * (1 + 2.2 * np.exp(-t / 0.03))) / SR) * np.exp(-t / 0.16) * g


def boom(dur=2.4, g=0.8):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * np.cumsum(38 * (1 + 1.6 * np.exp(-t / 0.05))) / SR) * np.exp(-t / 0.7)
    s += lp(rng.standard_normal(n), 2200) * np.exp(-t / 0.09) * 0.4
    return np.tanh(s * 1.4) * g


def whoosh(dur=1.0, g=0.3):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    out = np.zeros(n)
    k = 2048
    for s0 in range(0, n, k):
        u = s0 / n
        out[s0:s0 + k] = lp(x[s0:s0 + k], 300 + 6000 * u ** 2)[: len(x[s0:s0 + k])]
    return out * (t / dur) ** 2 * g


def tick(f=2600, g=0.04):
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * f * t) * np.exp(-t / 0.006) * g


# harmonie : si mineur — sol — ré — la (une mesure = 2,667 s à 90 bpm)
BEAT = 60 / 90
BAR = 4 * BEAT
CH = [[123.47, 146.83, 185.0], [98.0, 123.47, 146.83], [146.83, 185.0, 220.0], [110.0, 138.59, 164.81]]


def chord_at(t):
    return CH[int(t // BAR) % 4]


def intensity(t):
    """0 → 1 : ouverture calme, montée sur le match, respiration aux chapitres, sommet sur le réseau, résolution finale."""
    pts = [(0, 0.15), (PL['S02'][0], 0.3), (PL['S05'][0], 0.6), (PL['S06'][1], 0.65), (PL['S07'][0], 0.35), (PL['S08'][0], 0.5),
           (PL['S10'][1], 0.6), (PL['S11'][0], 0.45), (PL['S13'][0], 0.7), (PL['S15'][1], 0.85), (PL['S17'][0], 0.55), (PL['END'][0], 0.9), (DUR, 0.6)]
    for (a, va), (b, vb) in zip(pts, pts[1:]):
        if a <= t <= b:
            return va + (vb - va) * (t - a) / max(b - a, 1e-6)
    return 0.6


# nappes
t = 0.0
while t < DUR - 0.5:
    put(pad(chord_at(t), BAR + 1.0, 0.06 + 0.05 * intensity(t)), t)
    t += BAR
# arpèges (croches) à partir du plan 2
t = PL['S02'][0]
k = 0
while t < PL['END'][0] + 3 * BAR:
    c = chord_at(t)
    notes = [c[0] * 2, c[1] * 2, c[2] * 2, c[1] * 4, c[2] * 2, c[1] * 2]
    put(pluck(notes[k % len(notes)], 1.4, 0.07 + 0.09 * intensity(t)), t, pan=0.35 * np.sin(k * 0.7))
    t += BEAT / 2
    k += 1
# basse et pulsation sur les plans les plus rythmés
for a, b in [('S04', 'S06'), ('S08', 'S10'), ('S13', 'S16'), ('END', 'END')]:
    t = PL[a][0]
    while t < PL[b][1] - 0.2:
        put(np.tanh(2 * np.sin(2 * np.pi * chord_at(t)[0] / 2 * np.arange(int(0.6 * SR)) / SR)) * np.exp(-np.arange(int(0.6 * SR)) / SR / 0.3) * 0.13, t)
        put(kick(0.22 * intensity(t)), t)
        t += BEAT
# ponctuations
put(whoosh(1.0, 0.25), 0.0)
put(boom(3.0, 0.75), 1.0)
for c in ['CH1', 'CH2', 'CH3', 'CH4']:
    put(whoosh(0.8, 0.25), PL[c][0] - 0.8)
    put(boom(2.0, 0.55), PL[c][0])
put(boom(2.0, 0.5), PL['S07'][0])
for i in range(10):                                  # entrées qui s'allument
    put(tick(1800 + 120 * i, 0.05), PL['S11'][0] + 1.2 + i * 0.55)
put(whoosh(1.2, 0.3), PL['END'][0] - 1.2)
put(boom(3.5, 0.9), PL['END'][0])
put(pad([123.47, 185.0, 246.94, 293.66], 6.5, 0.16), PL['END'][0])

# réverbération
ir_n = int(2.2 * SR)
ir = lp(rng.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / SR / 0.6), 4500)
ir /= np.sqrt(np.sum(ir ** 2))


def conv(x, h):
    m = len(x) + len(h)
    return np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(h, m), m)[: len(x)]


st = np.stack([L + 0.3 * conv(L, ir), R + 0.3 * conv(R, np.roll(ir, 131))], 1)
st[: int(0.3 * SR)] *= np.linspace(0, 1, int(0.3 * SR))[:, None]
st[-int(1.5 * SR):] *= np.linspace(1, 0, int(1.5 * SR))[:, None]
st = np.tanh(st / np.max(np.abs(st)) * 1.3) * 0.88
with wave.open('musique_doc.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((st * 32767).astype('<i2').tobytes())
print('ok', round(DUR, 2), 's')
