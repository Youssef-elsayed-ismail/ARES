"""Build the tile pack the game plays on: a GRID x GRID board over the DEM window.

Per tile (40 m at the default 40x40):
  slope = 90th-percentile slope of the 4 m DEM cells inside the tile (the steep part you must cross)
  soft  = 1 - normalised THEMIS night-IR brightness (dark at night = loose dust)
  elev  = mean elevation
Art (SUB x SUB pixels per tile):
  board.png  = the real HiRISE image as pixel art: Mars colours, cooler in lowlands, warmer on highlands
  height.png = elevation bands in the blue-to-red convention of NASA's MOLA maps

Usage: python tools/build_tiles.py   (needs data/jezero_dem.json; pulls Mars Trek tiles live)
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_layers import HIRISE, ROOT, THEMIS, mosaic  # noqa: E402

GRID = 40
SUB = 8          # art pixels per tile side (5 m each)
BANDS = [(52, 48, 150), (44, 104, 214), (36, 176, 204), (54, 200, 128), (176, 220, 70),
         (250, 208, 62), (250, 150, 56), (236, 84, 66), (214, 60, 120)]
# Dark -> light ramps for the real-image pixel art. Lowlands lean plum/rose, highlands lean rust/gold.
LOW = [(20, 12, 52), (62, 28, 100), (118, 42, 122), (176, 62, 120), (222, 104, 128), (246, 168, 166), (255, 224, 218)]
MID = [(40, 14, 20), (100, 30, 30), (164, 52, 36), (212, 88, 44), (238, 136, 72), (250, 192, 124), (255, 234, 190)]
HIGH = [(46, 22, 6), (110, 52, 8), (172, 92, 12), (220, 140, 22), (246, 190, 50), (255, 226, 110), (255, 246, 190)]


def ramp(colours, v):
    c = np.array(colours, dtype=np.float32)
    x = np.clip(v, 0, 1) * (len(c) - 1)
    i = np.minimum(x.astype(int), len(c) - 2)
    f = (x - i)[..., None]
    return c[i] * (1 - f) + c[i + 1] * f


def norm(a, lo=2, hi=98):
    p, q = np.percentile(a, [lo, hi])
    return np.clip((a - p) / (q - p), 0, 1)


def main():
    dem = json.load(open(os.path.join(ROOT, "data", "jezero_dem.json")))
    b, n, cell = dem["bounds_lonlat"], dem["rows"], dem["cell_m"]
    k = n // GRID
    tiles = lambda a, f: f(a.reshape(GRID, k, GRID, k).transpose(0, 2, 1, 3).reshape(GRID, GRID, -1), axis=2)
    z = np.array(dem["elevation_m"], dtype=np.float32)
    slope90 = tiles(np.array(dem["slope_deg"], dtype=np.float32), lambda a, axis: np.percentile(a, 90, axis=axis))
    elev = tiles(z, np.mean)

    _, th = mosaic(THEMIS, 9, b, GRID)
    th = np.asarray(th, dtype=np.float32)
    soft = 1 - (th - th.min()) / (th.max() - th.min())

    # --- art ---
    P = GRID * SUB
    gy, gx = np.gradient(z * 4.0, cell)                                    # x4 vertical exaggeration for the hillshade
    az, alt = np.radians(315), np.radians(45)
    sl, asp = np.arctan(np.hypot(gx, gy)), np.arctan2(-gx, gy)
    shade = np.sin(alt) * np.cos(sl) + np.cos(alt) * np.sin(sl) * np.cos(az - asp)
    small = lambda arr: np.asarray(Image.fromarray(arr.astype(np.float32), "F").resize((P, P), Image.BOX))
    zs, hs = small(z), small(shade)
    _, hi = mosaic(HIRISE, 15, b, P * 2)
    tex = np.asarray(hi.resize((P, P), Image.BOX), dtype=np.float32)
    out = os.path.join(ROOT, "game", "data")
    os.makedirs(out, exist_ok=True)

    light = 0.72 * norm(tex, 1, 99) + 0.28 * norm(hs)                      # the real image leads; relief supports it
    light = np.clip((light - 0.5) * 1.25 + 0.5, 0, 1)
    e = (np.argsort(np.argsort(zs, axis=None)).reshape(zs.shape) / (zs.size - 1))[..., None]   # elevation rank 0..1
    lo_w, hi_w = np.clip(1 - 2 * e, 0, 1), np.clip(2 * e - 1, 0, 1)
    rgb = ramp(LOW, light) * lo_w + ramp(MID, light) * (1 - lo_w - hi_w) + ramp(HIGH, light) * hi_w
    art = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")
    art.quantize(40, method=Image.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB").save(os.path.join(out, "board.png"))


    pack = {
        "site": "Jezero Crater — Perseverance landing area",
        "center": dem["center"], "bounds_lonlat": b, "rows": GRID, "cols": GRID, "cell_m": dem["size_m"] / GRID,
        "sources": {"elevation": dem["source"], "imagery": "Mars Trek / " + HIRISE, "thermal": "Mars Trek / " + THEMIS},
        "slope": np.round(slope90, 1).flatten().tolist(),
        "soft": np.round(soft, 3).flatten().tolist(),
        "elev": np.round(elev, 1).flatten().tolist(),
        "art_px_per_tile": SUB,
        "elev_range_m": [round(float(z.min()), 1), round(float(z.max()), 1)],
        "palette": ["#%02x%02x%02x" % c for c in BANDS],
    }
    # --- the data layers as clean maps: smooth colour straight from the data, over the real relief, with no texture ---
    Q = 640
    up = lambda arr: np.asarray(Image.fromarray(arr.astype(np.float32), "F").resize((Q, Q), Image.BICUBIC), dtype=np.float32)
    relief = 0.62 + 0.5 * norm(up(shade), 1, 99)                            # hillshade from the DTM, as a brightness
    def ramp_img(v, colours, name, lines=None):
        rgb_ = ramp(colours, v) * relief[..., None]
        if lines is not None: rgb_ = rgb_ * (1 - 0.38 * lines[..., None])
        Image.fromarray(np.clip(rgb_, 0, 255).astype(np.uint8), "RGB").save(os.path.join(out, name))
    zq = up(z); zn = (zq - zq.min()) / (zq.max() - zq.min())
    step = 5.0; frac = (zq / step) % 1.0; cgy, cgx = np.gradient(zq)       # a contour every 5 m, about one pixel wide whatever the slope
    contour = (np.minimum(frac, 1 - frac) * step < 0.8 * np.maximum(np.hypot(cgx, cgy), 1e-3)).astype(np.float32) * (np.hypot(cgx, cgy) > 0.012)
    ramp_img(zn, [(74, 42, 154), (160, 40, 110), (200, 58, 58), (232, 112, 42), (242, 168, 58), (251, 226, 176)], "height.png", contour)
    sq = up(np.array(dem["slope_deg"], dtype=np.float32))
    sv = np.clip(np.where(sq < 5, sq / 5 * 0.25, np.where(sq < 10, 0.25 + (sq - 5) / 5 * 0.25, np.where(sq < 15, 0.5 + (sq - 10) / 5 * 0.25, 0.75 + (sq - 15) / 10 * 0.25))), 0, 1)
    ramp_img(sv, [(46, 150, 96), (120, 200, 96), (240, 214, 70), (244, 140, 40), (226, 44, 60)], "slope.png")
    _, thq = mosaic(THEMIS, 9, b, Q)
    tq = np.asarray(thq.resize((Q, Q), Image.BICUBIC), dtype=np.float32); tq = (tq - tq.min()) / (tq.max() - tq.min())
    ramp_img(tq, [(40, 44, 150), (40, 140, 168), (126, 96, 150), (222, 128, 52), (255, 84, 40)], "heat.png")

    # real heightmap for the 3D view: the DEM at 8 m, as 16-bit values between its lowest and highest point
    hn = 200; hz = z.reshape(hn, n // hn, hn, n // hn).mean(axis=(1, 3)); h_lo, h_hi = float(hz.min()), float(hz.max())
    open(os.path.join(out, "height.bin"), "wb").write(np.round((hz - h_lo) / (h_hi - h_lo) * 65535).astype("<u2").tobytes())
    pack["heightmap"] = {"file": "data/height.bin", "size": hn, "min_m": round(h_lo, 2), "max_m": round(h_hi, 2)}
    json.dump(pack, open(os.path.join(out, "board.json"), "w"), separators=(",", ":"))
    q = np.percentile(slope90, [50, 90, 100])
    print(f"tiles {GRID}x{GRID} @ {pack['cell_m']:.0f} m | slope p90/tile: median {q[0]:.1f} p90 {q[1]:.1f} max {q[2]:.1f} | "
          f">15deg: {(slope90 > 15).sum()}")


if __name__ == "__main__":
    main()
