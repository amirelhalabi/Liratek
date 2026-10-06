"""Soundtrack for the LiraTek launch video: 21 s, A minor, 112 BPM.

Usage: python3 music.py <out.wav>

Pad + bass + plucked arpeggio, light kick and hats once the product appears,
and effects (hits, whooshes, click) tuned to the same key and mixed under it.
Pure Python (no numpy on this machine).
"""
import math
import sys
import random
import struct
import wave

SR = 44100
DUR = 21.0
N = int(SR * DUR)
BPM = 112
BEAT = 60 / BPM
BAR = 4 * BEAT
L = [0.0] * N
R = [0.0] * N
random.seed(7)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def add(start, length, fn, gain=1.0, pan=0.0):
    """fn(t_local) -> sample. pan -1..1."""
    i0 = max(0, int(start * SR))
    i1 = min(N, int((start + length) * SR))
    gl = gain * math.cos((pan + 1) * math.pi / 4)
    gr = gain * math.sin((pan + 1) * math.pi / 4)
    for i in range(i0, i1):
        s = fn(i / SR - start)
        L[i] += s * gl
        R[i] += s * gr


# Am – F – C – G (MIDI roots in octave 3, chord tones)
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]


def chord_at(t):
    return CHORDS[int(t / BAR) % 4]


# --- pad: soft, slow-attack chord, detuned left/right --------------------
def pad_voice(f, detune):
    def fn(t):
        env = min(1.0, t / 0.6) * min(1.0, (BAR - t) / 0.5)
        return env * (math.sin(2 * math.pi * f * detune * t) + 0.3 * math.sin(4 * math.pi * f * detune * t))
    return fn


bars = int(DUR / BAR) + 1
for b in range(bars):
    t0 = b * BAR
    for n in chord_at(t0 + 0.01):
        f = hz(n + 12)
        add(t0, BAR + 0.3, pad_voice(f, 1.003), 0.035, -0.5)
        add(t0, BAR + 0.3, pad_voice(f, 0.997), 0.035, 0.5)


# --- bass: root on beats 1 and 3 --------------------------------------------
def pluck(f, decay, bright=0.4):
    def fn(t):
        env = math.exp(-t * decay) * min(1.0, t / 0.004)
        return env * (math.sin(2 * math.pi * f * t) + bright * math.sin(4 * math.pi * f * t))
    return fn


t = 3.0
while t < DUR - 0.8:
    root = chord_at(t)[0]
    add(t, 0.6, pluck(hz(root - 12), 6, 0.2), 0.16)
    t += 2 * BEAT

# --- arpeggio: 8th notes from the reveal on ----------------------------------
t = 3.0
step = 0
while t < DUR - 1.2:
    notes = chord_at(t)
    n = notes[[0, 1, 2, 1][step % 4]] + 24
    add(t, 0.35, pluck(hz(n), 11, 0.25), 0.05, 0.35 if step % 2 else -0.35)
    t += BEAT / 2
    step += 1


# --- kick and hats ------------------------------------------------------------
def kick(t):
    f = 45 + 75 * math.exp(-t * 30)
    return math.sin(2 * math.pi * f * t) * math.exp(-t * 14)


def hat(t):
    return (random.random() * 2 - 1) * math.exp(-t * 90)


t = 3.0
while t < DUR - 1.0:
    add(t, 0.3, kick, 0.33)
    if t >= 5.8:
        add(t + BEAT / 2, 0.06, hat, 0.035, 0.2)
    t += BEAT

# --- hook: four soft hits rising through A minor as the amounts land ----------
for i, n in enumerate([69, 72, 76, 81]):
    add(0.05 + i * 0.2, 0.8, pluck(hz(n), 5, 0.3), 0.12, [-0.4, 0.3, -0.2, 0.4][i])
add(1.1, 1.9, pad_voice(hz(57), 1.0), 0.06)  # low A under the hook line


# --- whooshes into each scene (filtered noise swell) ---------------------------
def whoosh(length):
    state = [0.0]

    def fn(t):
        x = t / length
        env = math.sin(math.pi * x) ** 2
        a = 0.02 + 0.25 * x  # opening filter
        state[0] += a * ((random.random() * 2 - 1) - state[0])
        return state[0] * env
    return fn


for cut in [3.0, 5.8, 9.8, 13.8, 17.5]:
    add(cut - 0.35, 0.6, whoosh(0.6), 0.22)

# --- cursor click on "Complete Sale" (an A, short) ----------------------------
add(5.8 + 1.75, 0.15, pluck(hz(93), 40, 0.1), 0.08)
# drawers popping in: one soft note each, C major-ish over the C bar
for i, n in enumerate([72, 76, 79, 81, 84, 88]):
    add(13.8 + 0.35 + i * 0.22, 0.4, pluck(hz(n), 12, 0.2), 0.045, -0.5 + i * 0.2)

# --- outro: ring out on A minor ------------------------------------------------
for n in [57, 60, 64, 69]:
    add(19.3, 1.7, pad_voice(hz(n + 12), 1.0), 0.03)

# --- master: fade, soft clip, normalise ----------------------------------------
for i in range(N):
    t = i / SR
    fade = min(1.0, t / 0.05) * min(1.0, (DUR - t) / 0.8)
    L[i] = math.tanh(L[i] * 1.3) * fade
    R[i] = math.tanh(R[i] * 1.3) * fade
peak = max(max(abs(x) for x in L), max(abs(x) for x in R))
g = 0.89 / peak
OUT = sys.argv[1] if len(sys.argv) > 1 else "music.wav"
with wave.open(OUT, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(b"".join(struct.pack("<hh", int(L[i] * g * 32767), int(R[i] * g * 32767)) for i in range(N)))
print(OUT, DUR, "s, peak", round(peak, 3))
