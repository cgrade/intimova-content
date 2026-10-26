"""Procedural wine-red satin background, candle-lit, slowly moving.
Usage: python3 satin.py <seconds> <out.mp4> [still.png at t]
Renders at 540x960 and upscales to 1080x1920 in ffmpeg.
"""
import sys, subprocess
import numpy as np

W, H, FPS = 540, 960, 30
import json
dur = float(sys.argv[1]); out = sys.argv[2]
still_t = float(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[3] != '-' else None
CUES = json.load(open(sys.argv[5])).get('cues', {}) if len(sys.argv) > 5 else {}

def sstep(x):
    x = min(max(x, 0.0), 1.0); return x * x * (3 - 2 * x)

def heat_at(t):
    if 'heat' not in CUES: return 0.0
    a, b = CUES['heat'], CUES.get('peak', CUES['heat'] + 20) + 4
    return sstep((t - a) / (b - a))

def lights_at(t):
    if 'lights' not in CUES: return 0.0
    dt = t - CUES['lights']
    if dt < 0: return 0.0
    if dt < 0.5: on = [1, 0.15, 0.9, 0.35, 1][int(dt / 0.1)]  # power coming back, a flicker
    else: on = 1.0
    off = sstep((t - CUES.get('end', 1e9)) / 1.2)
    return on * (1 - off)

# time warp: the satin moves a little faster as the heat rises
_ts = np.arange(0, dur + 1, 1 / 30)
_teff = np.cumsum([1 / 30 * (1 + 0.6 * heat_at(x)) for x in _ts])
def teff(t):
    return float(np.interp(t, _ts, _teff))

ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
X = xs / H * 3.2
Y = ys / H * 3.2
nx, ny = xs / W, ys / H

# colour ramp: shadow -> deep wine -> crimson -> soft rose highlight
stops = np.array([0.0, 0.30, 0.55, 0.78, 0.92, 1.0], np.float32)
cols = np.array([
    [6, 2, 4], [26, 5, 12], [62, 10, 28], [122, 26, 52], [196, 96, 108], [238, 196, 188]
], np.float32)

def ramp(v):
    v = np.clip(v, 0, 1)
    out = np.empty(v.shape + (3,), np.float32)
    for c in range(3):
        out[..., c] = np.interp(v, stops, cols[:, c])
    return out

L = np.array([-0.45, -0.75, 0.55], np.float32); L /= np.linalg.norm(L)
Hv = L + np.array([0, 0, 1], np.float32); Hv /= np.linalg.norm(Hv)
rng = np.random.default_rng(7)

def frame(t_real):
    t = teff(t_real); heat = heat_at(t_real); lit = lights_at(t_real)
    u = 0.82 * X + 0.57 * Y
    v = -0.57 * X + 0.82 * Y
    uw = (u + 0.38 * np.sin(0.85 * v + 0.21 * t) + 0.16 * np.sin(2.2 * v - 0.16 * t + 1.0)
          + 0.07 * np.sin(4.1 * v + 0.27 * t + 2.3))
    h = (0.95 * np.sin(3.1 * uw + 0.6 * np.sin(1.2 * v + 0.12 * t))
         + 0.42 * np.sin(5.7 * uw + 1.1 * np.sin(1.7 * v - 0.15 * t + 0.7) + 1.3)
         + 0.16 * np.sin(10.4 * uw + 0.9 * np.sin(2.6 * v + 0.2 * t) + 2.9))
    gy, gx = np.gradient(h)
    k = H / 3.2
    gx *= k; gy *= k
    s = gx * -0.62 + gy * -0.78          # slope toward the light
    band = 1 / (1 + np.exp(-1.15 * s))   # lit side of each fold
    crest = np.exp(-((s - 2.2) / 0.9) ** 2)  # narrow sheen on the turning folds
    cx = 0.66 + 0.06 * np.sin(0.17 * t); cy = 0.36 + 0.05 * np.cos(0.13 * t)
    pool = np.exp(-(((nx - cx) * 1.1) ** 2 + ((ny - cy) * 0.85) ** 2) / (0.22 + 0.10 * heat))
    flick = 1 + 0.03 * np.sin(6.7 * t) * np.sin(2.9 * t + 1.1)
    val = (0.12 + 0.55 * band ** 1.4 + 0.34 * crest) * (0.30 + 0.85 * pool) * flick * (1 + 0.2 * heat)
    val = val * (1 + 0.3 * lit) * (1 - 0.3 * lit) + 0.42 * 0.3 * lit + 0.03 * lit
    img = ramp(val)
    vig = 1 - 0.6 * (1 - 0.5 * lit) * (((nx - 0.5) * 1.25) ** 2 + ((ny - 0.45) * 0.95) ** 2)
    img *= np.clip(vig, 0.3, 1)[..., None]
    return np.clip(img, 0, 255).astype(np.uint8)

if still_t is not None:
    from PIL import Image
    Image.fromarray(frame(still_t)).resize((1080, 1920), Image.LANCZOS).save(sys.argv[3])
    sys.exit()

n = int(np.ceil(dur * FPS))
p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                      '-vf', 'scale=1080:1920:flags=lanczos', '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', '-pix_fmt', 'yuv420p', out],
                     stdin=subprocess.PIPE)
for i in range(n):
    p.stdin.write(frame(i / FPS).tobytes())
p.stdin.close(); p.wait()
print('bg frames', n)
