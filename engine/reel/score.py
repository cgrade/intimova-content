"""Original score for an Intimova story reel, timed to the story's cues (v2).

Built on what research says moves listeners, not on "magic frequencies":
- Tempo drives arousal (Bernardi et al., Heart 2006): calm sections sit near 56 bpm, then the
  pulse accelerates to about 100 bpm through the heat.
- Pauses relax and reset (same study): the hard silence when the lights come back.
- Hearing a heartbeat speed up raises felt attraction (Valins 1966, with caveats): a heartbeat
  enters when she makes the call and quickens with the heat.
- Chills come with gradual crescendos, a new instrument entering, unprepared harmony, and rising
  brightness and range (Bannister & Eerola 2018 review): a bowed lead enters on the turn with a
  surprise chord, then the build widens and brightens to the peak.
- An endlessly rising Shepard tone builds tension (a film-scoring technique).
- Phone speakers lose bass below about 60 Hz, so the bass and heartbeat carry audible harmonics.

Cues (seconds, from the reel planner): pulse, turn, heat, peak, lights, dread, end, total.
Missing cues get sensible defaults. Everything is synthesised here, so there is no licence to clear.
Usage: python3 score.py <meta.json> <out.wav> [seed]
"""
import sys, json, wave
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt

SR = 48000
meta = json.load(open(sys.argv[1]))
out_path = sys.argv[2]
rng = np.random.default_rng(int(sys.argv[3]) if len(sys.argv) > 3 else 11)
T = float(meta['total'])
C = meta.get('cues', {})
heat_t = C.get('heat', T * 0.55)
peak_t = C.get('peak', T * 0.82)
lights_t = C.get('lights')
end_t = C.get('end', T - 3)
cut_t = lights_t if lights_t else end_t
pulse_t = C.get('pulse', heat_t * 0.5)
turn_t = C.get('turn', (pulse_t + heat_t) / 2)
dread_t = C.get('dread', (cut_t + end_t) / 2 if lights_t else None)
N = int(T * SR) + SR
t = np.arange(N) / SR

def midi(m): return 440.0 * 2 ** ((m - 69) / 12)
def sm(x): x = np.clip(x, 0, 1); return x * x * (3 - 2 * x)
def lp(x, f): return sosfilt(butter(2, f, 'low', fs=SR, output='sos'), x)
def hp(x, f): return sosfilt(butter(2, f, 'high', fs=SR, output='sos'), x)

heat = np.clip((t - heat_t) / max(peak_t - heat_t, 1.0), 0, 1) ** 0.85   # 0 calm -> 1 at the peak, a steady build
gate = 1 - sm((t - cut_t) / (0.03 if lights_t else 1.5))       # hard cut at the lights; a gentle fade into the end card otherwise
bpm = 56 + 44 * heat                                            # tempo map
breath = 1 - 0.22 * (0.5 - 0.5 * np.cos(2 * np.pi * t / 10.0)) * (1 - heat)   # slow 10 s swell in calm parts

# ---------- harmony ----------
CALM = [[50, 53, 57, 60, 64], [46, 50, 53, 57, 62], [43, 46, 50, 53, 57], [45, 50, 52, 57, 64]]   # Dm9 Bbmaj7 Gm9 Asus4
CALM_BASS = [38, 34, 31, 33]
TURN = [39, 43, 46, 50, 57]          # Ebmaj7(#11): the Neapolitan, an unprepared lift on the turn
HEAT = [[50, 53, 57, 60, 64, 69], [46, 50, 53, 57, 62, 65], [43, 46, 50, 53, 58, 62], [45, 49, 52, 55, 58, 64]]  # ... A7(b9)
HEAT_BASS = [38, 34, 31, 33]

def env(n, a, r):
    e = np.ones(n); na, nr = max(1, int(a * SR)), max(1, int(r * SR))
    e[:na] = np.linspace(0, 1, na) ** 2; e[-nr:] *= np.linspace(1, 0, nr) ** 1.5
    return e

def pad_note(f, dur, bright):
    n = int(dur * SR); tt = np.arange(n) / SR; s = np.zeros(n)
    for det in (-0.0045, 0.004):
        ff = f * (1 + det)
        for h in range(1, 10):
            if ff * h > 7000: break
            s += np.sin(2 * np.pi * ff * h * tt + rng.uniform(0, 6.28)) / h ** (2.0 - 0.8 * bright)
    return s * env(n, 1.4, 2.0)

def add(buf, i0, x):
    if i0 >= len(buf): return
    x = x[: len(buf) - i0]; buf[i0:i0 + len(x)] += x

def warm_bass(f, dur):
    # fundamental plus 2nd-4th harmonics, so phones (which drop the fundamental) still "hear" it
    n = int(dur * SR); tt = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * tt) + 0.55 * np.sin(4 * np.pi * f * tt) + 0.3 * np.sin(6 * np.pi * f * tt) + 0.15 * np.sin(8 * np.pi * f * tt)
    return np.tanh(1.4 * s) * env(n, 0.6, 1.6)

pad = np.zeros(N); bass = np.zeros(N)
tc = 0.0; k = 0
while tc < cut_t:
    h = float(heat[min(int(tc * SR), N - 1)])
    if abs(tc - turn_t) < 0.01 or (tc < turn_t < tc + (8.0 if h < 0.05 else 4.0) and tc + 0.5 < turn_t):
        # land the surprise chord exactly on the turn
        if tc < turn_t:
            dur = turn_t - tc + 2.0
            for m in CALM[k % 4]: add(pad, int(tc * SR), pad_note(midi(m), dur, h) * 0.10)
            add(bass, int(tc * SR), warm_bass(midi(CALM_BASS[k % 4]), dur) * 0.085)
            tc = turn_t; k += 1
        for m in TURN: add(pad, int(tc * SR), pad_note(midi(m), 8.0 + 2.0, 0.3) * 0.11)
        add(bass, int(tc * SR), warm_bass(midi(27 + 12), 10.0) * 0.09)
        tc += 8.0; continue
    step = 8.0 if h <= 0 else 4.0 * (1 - 0.3 * h)                # harmony moves faster as it heats
    chords, basses = (CALM, CALM_BASS) if h <= 0 else (HEAT, HEAT_BASS)
    ci = k % 4
    dur = step + 2.0
    lvl = 0.10 + 0.05 * h
    for m in chords[ci]: add(pad, int(tc * SR), pad_note(midi(m), dur, h) * lvl)
    add(bass, int(tc * SR), warm_bass(midi(basses[ci]), dur) * (0.085 + 0.04 * h))
    tc += step; k += 1
pad *= breath

# ---------- soft keys (sparse when calm) ----------
keys = np.zeros(N)
tk = 1.2
while tk < cut_t - 0.3:
    h = float(heat[int(tk * SR)])
    ci = int(tk // 8) % 4
    m = int(rng.choice(CALM[ci][1:])) + 12 * int(rng.choice([1, 1, 2]))
    f = midi(m); n = int(2.6 * SR); tt = np.arange(n) / SR
    note = (np.sin(2 * np.pi * f * tt) + 0.2 * np.sin(4 * np.pi * f * tt) + 0.06 * np.sin(6 * np.pi * f * tt)) * np.exp(-tt / 1.0) * np.minimum(1, tt / 0.005)
    add(keys, int(tk * SR), note * (0.085 + 0.02 * h) * rng.uniform(0.7, 1.0))
    tk += float(rng.choice([2.0, 3.0, 4.0])) * (1 - 0.55 * h)

# ---------- bowed lead: enters on the turn (new instrument), rises through the heat ----------
lead = np.zeros(N)
def bowed(f0, dur, vol, vib=0.0035):
    n = int(dur * SR); tt = np.arange(n) / SR
    ph = 2 * np.pi * np.cumsum(f0 * (1 + vib * np.sin(2 * np.pi * 5.2 * tt) * np.minimum(1, tt / 0.8))) / SR
    s = sum(np.sin(h * ph) / h ** 1.15 for h in range(1, 12))
    s += 0.03 * rng.standard_normal(n)                            # a little bow noise
    return lp(s, 2600) * env(n, 0.5, 0.9) * vol
# appoggiatura on the surprise chord (A against Eb resolving to G), then a rising line to the peak
phrase = [(turn_t, 69, 2.6, 0.16), (turn_t + 2.4, 67, 4.0, 0.14)]
line = [62, 64, 65, 67, 69, 72, 74]
span = max(peak_t - heat_t, 4.0)
for i, m in enumerate(line):
    st = heat_t + i * span / len(line)
    phrase.append((st, m, span / len(line) + 1.0, 0.11 + 0.05 * i / len(line)))
phrase.append((peak_t, 76, max(cut_t - peak_t, 1.0) + 0.6, 0.13))      # held high note into the cut
for st, m, d, v in phrase:
    if st < cut_t: add(lead, int(st * SR), bowed(midi(m), d, v))

# ---------- heartbeat: enters with the call, quickens with the heat ----------
beat = np.zeros(N)
def thump(level):
    n = int(0.26 * SR); tt = np.arange(n) / SR
    f = 62 * np.exp(-tt / 0.07) + 44
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) + 0.75 * np.sin(2 * ph) + 0.55 * np.sin(3 * ph) + 0.35 * np.sin(4 * ph)   # harmonics carry it on phones
    click = lp(rng.standard_normal(n), 1200) * np.exp(-tt / 0.012) * 0.7
    return np.tanh(1.6 * (body * np.exp(-tt / 0.075) + click)) * level
duck = np.ones(N)                                               # the music dips on each beat, so the pulse is felt
dn = int(0.32 * SR); dcurve = np.exp(-np.arange(dn) / (0.11 * SR))
tb = pulse_t
while tb < cut_t - 0.15:
    i = int(tb * SR); h = float(heat[i])
    fade_in = sm((tb - pulse_t) / 6.0)
    lv = (0.09 + 0.24 * h) * fade_in
    add(beat, i, thump(lv)); add(beat, i + int(0.25 * SR), thump(lv * 0.6))
    depth = (0.22 + 0.25 * h) * fade_in
    seg = duck[i:i + dn]; duck[i:i + dn] = np.minimum(seg, 1 - depth * dcurve[: len(seg)])
    tb += 60.0 / float(bpm[i])

# ---------- pulsing eighths and a Shepard rise through the heat ----------
pulse = np.zeros(N)
tp = heat_t
while tp < cut_t - 0.1:
    i = int(tp * SR); h = float(heat[i])
    root = HEAT_BASS[int((tp - heat_t) // 4) % 4] + 24
    n = int(0.22 * SR); tt = np.arange(n) / SR
    x = (np.sin(2 * np.pi * midi(root) * tt) + 0.3 * np.sin(4 * np.pi * midi(root) * tt)) * np.exp(-tt / 0.06)
    add(pulse, i, x * 0.07 * h)
    tp += 30.0 / float(bpm[i])
shep = np.zeros(N)
i0, i1 = int(heat_t * SR), int(cut_t * SR)
if i1 > i0:
    tt = np.arange(i1 - i0) / SR
    for o in range(6):
        pos = ((tt / 9.0) + o / 6.0) % 1.0                      # one octave every 9 s, endlessly
        f = 110 * 2 ** (pos * 6)
        amp = np.exp(-((pos - 0.5) ** 2) / 0.04)
        shep[i0:i1] += np.sin(2 * np.pi * np.cumsum(f) / SR) * amp
    shep[i0:i1] *= 0.035 * heat[i0:i1] ** 1.5

# ---------- mix the music, open the filter with the heat, cut at the lights ----------
music = pad + keys + lead + pulse + shep
music = lp(music, 1500) * (1 - heat) + lp(music, 7000) * heat
music *= gate * duck
crescendo = 10 ** ((4.5 * heat) / 20)                           # up to +4.5 dB through the heat
music *= crescendo
bass = hp(bass * gate * crescendo * duck, 30)
beat = hp(beat * gate, 30)

# reverb (stereo hall, 2.4 s), tail cut too so the silence is real
irn = int(2.4 * SR); it = np.arange(irn) / SR
irs = [lp(rng.standard_normal(irn) * np.exp(-it / 0.7), 5500) for _ in range(2)]
irs = [x / np.sqrt(np.sum(x ** 2)) for x in irs]
wet = [fftconvolve(music, x)[:N] * gate for x in irs]
L = music * 0.7 + wet[0] * 0.5 + bass + beat
R = music * 0.7 + wet[1] * 0.5 + bass + beat

# ---------- after the cut: silence, clicks, mains hum, dread ----------
if lights_t:
    i0 = int(lights_t * SR)
    for off in (0.6, 0.7, 0.8, 0.9, 1.0):                      # ~0.6 s of true silence first
        n = int(0.012 * SR); x = rng.standard_normal(n) * np.exp(-np.arange(n) / (0.002 * SR)) * 0.35
        j = i0 + int(off * SR); L[j:j + n] += x; R[j:j + n] += x
    flick = np.repeat([1, 0.15, 0.9, 0.35, 1], int(0.1 * SR))
    hn = int((end_t - lights_t + 0.8) * SR); ht = np.arange(hn) / SR
    hum = (np.sin(2 * np.pi * 50 * ht) + 0.8 * np.sin(2 * np.pi * 100 * ht) + 0.7 * np.sin(2 * np.pi * 150 * ht) + 0.5 * np.sin(2 * np.pi * 200 * ht) + 0.35 * np.sin(2 * np.pi * 300 * ht)) * 0.07
    hum[: int(0.6 * SR)] = 0
    hum[int(0.6 * SR): int(0.6 * SR) + len(flick)] *= flick
    tail = np.minimum(1, (hn - np.arange(hn)) / (0.8 * SR))
    hum *= tail
    d0 = (dread_t - lights_t) if dread_t else 3.0
    drone = (np.sin(2 * np.pi * midi(38) * ht) + 0.6 * np.sin(2 * np.pi * midi(50) * ht) + 0.35 * np.sin(2 * np.pi * midi(57) * ht + 0.4 * np.sin(2 * np.pi * 0.25 * ht)))
    drone *= 0.12 * sm((ht - (d0 - 2.5)) / 2.5) * tail
    L[i0:i0 + hn] += hum + drone; R[i0:i0 + hn] += hum + drone * 0.92
    if dread_t:                                                  # one heavy heartbeat on the last line
        j = int(dread_t * SR); x = thump(0.9); L[j:j + len(x)] += x; R[j:j + len(x)] += x

# ---------- end card: one soft unresolved chord ----------
i0 = int(end_t * SR); n = N - i0
ec = sum(pad_note(midi(m), n / SR, 0.2) for m in (50, 57, 60, 64, 69)) * 0.075
ec *= np.minimum(1, (n - np.arange(n)) / (1.2 * SR))
L[i0:] += ec; R[i0:] += ec

# ---------- master ----------
L, R = L[: int(T * SR)], R[: int(T * SR)]
f_in = np.minimum(1, np.arange(len(L)) / (1.0 * SR)); f_out = np.minimum(1, (len(L) - np.arange(len(L))) / (0.8 * SR))
mix = np.stack([L * f_in * f_out, R * f_in * f_out], 1)
calm = mix[int(1.5 * SR): int(heat_t * SR)]
rms = np.sqrt(np.mean(calm ** 2))
mix *= (10 ** (-21.5 / 20)) / max(rms, 1e-9)       # calm sections sit at about -21.5 dBFS; the heat rises above
mix = 0.92 * np.tanh(mix / 0.92)                    # soft limiter, peaks stay under -0.7 dBFS
with wave.open(out_path, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print(f'score v2: {T:.1f}s, rms {20*np.log10(np.sqrt(np.mean(mix**2))):.1f} dBFS, peak {20*np.log10(np.max(np.abs(mix))):.1f} dBFS')
