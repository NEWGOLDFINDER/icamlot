"""Bande-son synthétique (aucun échantillon externe), calée sur la chronologie de scene.js."""
import json
import wave
import numpy as np

SR, DUR = 48000, 30.0
N = int(SR * DUR)
rng = np.random.default_rng(7)
L = np.zeros(N)
R = np.zeros(N)
t_all = np.arange(N) / SR


def put(sig, t0, gain=1.0, pan=0.0):
    i = int(t0 * SR)
    if i >= N:
        return
    s = sig[: N - i] * gain
    L[i:i + len(s)] += s * np.sqrt(0.5 * (1 - pan))
    R[i:i + len(s)] += s * np.sqrt(0.5 * (1 + pan))


def env(n, a=0.005, d=0.3):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / d)


def lowpass(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def lp_fast(x, fc):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / np.sqrt(1 + (f / fc) ** 4), len(x))


def hit(dur=2.5, f0=48, gain=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f0 * (1 + 2.5 * np.exp(-t / 0.04))
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.55)
    noise = lp_fast(rng.standard_normal(n), 3000) * np.exp(-t / 0.08) * 0.5
    return np.tanh((body + noise) * 1.6) * gain


def whoosh(dur=1.0, up=True):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    out = np.zeros(n)
    k = 2048
    for s in range(0, n, k):
        u = s / n if up else 1 - s / n
        out[s:s + k] = lp_fast(x[s:s + k], 300 + 7000 * u ** 2)[: len(x[s:s + k])]
    e = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2 if not up else (t / dur) ** 2.2
    return out * e * 0.6


def riser(dur=1.0, f0=200, f1=1600):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f0 * (f1 / f0) ** (t / dur)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.5 * np.sin(2 * np.pi * np.cumsum(f * 1.5) / SR)
    return s * (t / dur) ** 2 * 0.25 + whoosh(dur, True) * 0.6


def blip(f=1800, dur=0.06, g=0.2):
    n = int(dur * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * f * t) * env(n, 0.001, dur / 4) * g


def thud(g=0.5):
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 70 * t * (1 + np.exp(-t / 0.02))) * np.exp(-t / 0.09) + lp_fast(rng.standard_normal(n), 900) * np.exp(-t / 0.03) * 0.4) * g


def chime(f=880, g=0.3):
    n = int(1.6 * SR)
    t = np.arange(n) / SR
    s = sum(np.sin(2 * np.pi * f * m * t) * np.exp(-t / (0.6 / m)) / m for m in (1, 2, 3, 4.2))
    return s * env(n, 0.002, 0.7) * g


def pad(f_list, dur, g=0.12):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for f in f_list:
        for det in (-0.3, 0.0, 0.31):
            ph = rng.uniform(0, 2 * np.pi)
            s += np.sign(np.sin(2 * np.pi * (f + det) * t + ph)) * 0.25 + np.sin(2 * np.pi * (f + det) * t + ph)
    s = lp_fast(s, 1400)
    fade = np.minimum(1, t / 0.6) * np.minimum(1, (dur - t) / 0.8)
    return s / len(f_list) * fade * g


# --- lit musical : pad + basse pulsée (120 bpm) de 3 s à 27,3 s
chords = [[110, 130.8, 164.8], [87.3, 110, 130.8], [130.8, 164.8, 196], [98, 123.5, 146.8]]   # la m, fa, do, sol
for i, t0 in enumerate(np.arange(3.0, 27.3, 2.0)):
    put(pad(chords[i % 4], 2.3, 0.10), t0, 1.0, 0.0)
for t0 in np.arange(3.0, 27.3, 0.5):
    root = chords[int((t0 - 3) // 2) % 4][0] / 2
    n = int(0.42 * SR)
    tt = np.arange(n) / SR
    put(np.tanh(2 * np.sin(2 * np.pi * root * tt)) * env(n, 0.004, 0.16) * 0.22, t0)
# respiration du lit sous les impacts
# --- ouverture
put(riser(0.85, 120, 900), 0.05, 0.8)
put(hit(3.0, 42, 1.0), 0.9)
for k in range(10):
    put(blip(2400 + 120 * k, 0.03, 0.06), 0.25 + k * 0.055, pan=0.3)
for k in range(12):
    put(blip(2000 + 90 * k, 0.03, 0.05), 1.45 + k * 0.045, pan=-0.3)
put(riser(0.7, 300, 3000), 2.3, 0.7)
put(hit(2.0, 55, 0.8), 3.0)
put(whoosh(1.2, False), 3.0, 0.7)
# --- le monde : chute des pierres (une par carrière)
for i in range(10):
    put(thud(0.32), 4.3 + i * 0.09 + 0.45, pan=-0.6 + i * 0.13)
for k in range(4):
    put(blip(1500 + 200 * k, 0.05, 0.08), 4.0 + 0.7 * k)
# --- plan 3 : adversaire, notre robot, tampon, plongée
put(riser(0.8, 200, 1200), 7.55, 0.5)
put(riser(0.8, 220, 1400), 8.45, 0.5)
put(hit(1.5, 70, 0.6), 9.0)
put(riser(0.9, 150, 2400), 9.6, 0.9)
put(hit(2.6, 40, 1.0), 10.5)
put(whoosh(0.8, False), 10.45, 0.6)
# --- plan 4 : dans sa tête
WSTART = [10.9, 14.0, 17.0, 20.0]
for w in WSTART:
    put(hit(1.2, 36, 0.7), w)                          # battement de décision
    n = int(1.2 * SR)
    tt = np.arange(n) / SR                             # ralenti : son qui descend
    put(np.sin(2 * np.pi * np.cumsum(420 * np.exp(-tt / 0.5) + 60) / SR) * env(n, 0.01, 0.5) * 0.18, w + 0.05)
    for j in range(14):                                # activations
        put(blip(1200 + 140 * ((j * 7) % 11), 0.025, 0.05), w + 0.15 + j * 0.075, pan=np.sin(j) * 0.7)
    put(chime(1318.5, 0.12), w + 1.3)                  # décision affichée
runs = [(12.5, 14.0), (15.6, 17.0), (18.6, 20.0), (21.6, 23.4)]
for a, b in runs:                                      # tic-tac du chrono
    for tk in np.arange(a, b, 0.25):
        put(blip(3200, 0.012, 0.05), tk, pan=0.2)
put(chime(880, 0.28), 20.0)                            # « +13 pts » mur M1
put(chime(988, 0.28), 23.4)                            # « +13 pts » mur M4
put(whoosh(0.9, True), 23.4, 0.6)
# --- plan 5 : entraînement
put(hit(2.0, 50, 0.85), 24.2)
for k in range(24):
    put(blip(900 + 60 * (k % 8), 0.04, 0.05), 24.6 + k * 0.11, pan=((k % 5) - 2) / 3)
# --- appel
put(riser(0.6, 300, 2600), 27.15, 0.8)
put(hit(3.2, 38, 1.1), 27.8)
put(pad([110, 164.8, 220, 277.2], 2.4, 0.14), 27.8)

# réverbération simple (réponse impulsionnelle bruitée)
ir_n = int(1.8 * SR)
ir = rng.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / SR / 0.45)
ir = lp_fast(ir, 5000)
ir /= np.sqrt(np.sum(ir ** 2))


def conv(x, h):
    m = len(x) + len(h)
    return np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(h, m), m)[: len(x)]


L2 = L + 0.22 * conv(L, ir)
R2 = R + 0.22 * conv(R, np.roll(ir, 97))
st = np.stack([L2, R2], 1)
st[-int(0.6 * SR):] *= np.linspace(1, 0, int(0.6 * SR))[:, None]
st = np.tanh(st / np.max(np.abs(st)) * 1.4) * 0.89
with wave.open('bande_son.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((st * 32767).astype('<i2').tobytes())
print('ok', st.shape, float(np.max(np.abs(st))))
