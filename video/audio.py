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
for i, t0 in enumerate(np.arange(2.4, 27.4, 2.0)):
    put(pad(chords[i % 4], 2.3, 0.10), t0, 1.0, 0.0)
for t0 in np.arange(2.4, 27.4, 0.5):
    root = chords[int((t0 - 2.4) // 2) % 4][0] / 2
    n = int(0.42 * SR)
    tt = np.arange(n) / SR
    put(np.tanh(2 * np.sin(2 * np.pi * root * tt)) * env(n, 0.004, 0.16) * 0.22, t0)
# respiration du lit sous les impacts
# --- ouverture (0 - 2,4 s)
put(riser(0.6, 120, 900), 0.05, 0.8)
put(hit(2.4, 42, 1.0), 0.7)
for k in range(10):
    put(blip(2400 + 120 * k, 0.03, 0.06), 0.15 + k * 0.045, pan=0.3)
for k in range(10):
    put(blip(2000 + 90 * k, 0.03, 0.05), 1.15 + k * 0.045, pan=-0.3)
put(riser(0.5, 300, 3000), 1.9, 0.7)
put(hit(1.8, 55, 0.85), 2.4)
put(whoosh(0.9, False), 2.4, 0.7)
# --- le monde : chute des pierres
for i in range(10):
    put(thud(0.32), 3.1 + i * 0.072 + 0.4, pan=-0.6 + i * 0.13)
for k in range(3):
    put(blip(1500 + 200 * k, 0.05, 0.08), 3.0 + 0.4 * k)
# --- présentation des robots
put(riser(0.7, 200, 1200), 5.45, 0.5)
put(whoosh(0.9, True), 6.3, 0.5)
put(riser(0.6, 220, 1400), 6.4, 0.5)
put(hit(1.2, 70, 0.6), 6.95)
put(riser(0.4, 300, 2600), 7.2, 0.8)
# --- GO
put(hit(2.0, 45, 1.1), 7.6)
for k in range(8):
    put(blip(3200, 0.012, 0.05), 7.9 + k * 0.19, pan=0.2)
# --- caméra embarquée au ralenti
put(whoosh(0.6, False), 9.35, 0.6)
n = int(2.5 * SR); tt = np.arange(n) / SR
put(np.sin(2 * np.pi * np.cumsum(55 + 8 * np.sin(tt * 3)) / SR) * env(n, 0.3, 2.0) * 0.35, 9.4)
for k in range(5):
    put(blip(1100, 0.08, 0.07), 9.6 + k * 0.48, pan=-0.4)          # bip de verrouillage lidar
# --- accélération ×3
put(riser(0.7, 400, 4000), 11.9, 0.9)
# --- arrêt sur image : une note par groupe d'entrées
put(hit(2.0, 38, 1.0), 12.6)
notes = [523.3, 587.3, 659.3, 698.5, 784.0, 880.0, 987.8, 1046.5, 1174.7, 1318.5]
for i, f in enumerate(notes):
    put(blip(f, 0.12, 0.12), 12.75 + i * 0.29, pan=-0.6 + i * 0.13)
put(riser(0.5, 200, 2400), 15.5, 0.8)
# --- le réseau décide
put(hit(1.6, 40, 0.9), 16.0)
for j in range(40):
    put(blip(900 + 70 * ((j * 7) % 13), 0.025, 0.05), 16.2 + j * 0.055, pan=np.sin(j) * 0.7)
put(riser(0.6, 300, 2000), 18.0, 0.7)
# --- le nom de l'action
put(hit(2.4, 36, 1.1), 18.6)
put(chime(1318.5, 0.2), 18.65)
# --- exécution
put(whoosh(0.7, False), 19.95, 0.6)
for k in range(10):
    put(blip(3200, 0.012, 0.05), 20.0 + k * 0.18, pan=0.2)
put(thud(0.5), 22.15)
put(chime(880, 0.32), 22.2)                 # +13 pts mur M1
# --- décision 4 en accéléré
put(hit(1.0, 50, 0.7), 22.6)
for j in range(12):
    put(blip(1200 + 90 * j, 0.02, 0.05), 22.7 + j * 0.06)
put(hit(1.2, 45, 0.8), 23.3)
put(chime(988, 0.32), 23.85)                # +13 pts mur M4
# --- entraînement
put(hit(2.0, 50, 0.85), 24.2)
for k in range(24):
    put(blip(900 + 60 * (k % 8), 0.04, 0.05), 24.6 + k * 0.11, pan=((k % 5) - 2) / 3)
# --- appel
put(riser(0.5, 300, 2600), 27.2, 0.8)
put(hit(3.0, 38, 1.1), 27.7)
put(pad([110, 164.8, 220, 277.2], 2.3, 0.14), 27.7)

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
