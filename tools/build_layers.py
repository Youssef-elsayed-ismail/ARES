"""Build the game's terrain pack for the DEM window: pixel-art ground + slope + THEMIS grids.

Reads data/jezero_dem.json (from fetch_dem_window.py), pulls only the Mars Trek tiles that
cover the window, and writes game/data/ground.png + game/data/terrain.json.

Usage: python tools/build_layers.py
"""
import base64
import io
import json
import math
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TILE = "https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{z}/{r}/{c}.png"
HIRISE = "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd"
THEMIS = "THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018"
UA = {"User-Agent": "Mozilla/5.0 (Alexstra Space Apps)"}

# Mars-toned ramp (dark -> light) used to tint the grayscale HiRISE mosaic.
PALETTE = [(38, 20, 24), (62, 30, 30), (90, 42, 36), (118, 56, 42), (146, 72, 48), (170, 92, 58),
           (190, 114, 72), (206, 138, 92), (220, 162, 116), (232, 188, 146), (242, 212, 180)]


def fetch_tile(layer, z, r, c):
    url = TILE.format(layer=layer, z=z, r=r, c=c)
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as resp:
                return Image.open(io.BytesIO(resp.read())).convert("L")
        except Exception:
            if i == 3:
                raise
    return None


def mosaic(layer, z, b, out_px):
    """Crop [west,east,south,north] from the layer at zoom z, resized to out_px square."""
    size = 180.0 / 2 ** z
    c0, c1 = int((b["west"] + 180) // size), int((b["east"] + 180) // size)
    r0, r1 = int((90 - b["north"]) // size), int((90 - b["south"]) // size)
    jobs = [(r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]
    with ThreadPoolExecutor(8) as ex:
        tiles = list(ex.map(lambda rc: fetch_tile(layer, z, *rc), jobs))
    big = Image.new("L", ((c1 - c0 + 1) * 256, (r1 - r0 + 1) * 256))
    for (r, c), t in zip(jobs, tiles):
        big.paste(t, ((c - c0) * 256, (r - r0) * 256))
    px = 256 / size
    box = ((b["west"] + 180) * px - c0 * 256, (90 - b["north"]) * px - r0 * 256,
           (b["east"] + 180) * px - c0 * 256, (90 - b["south"]) * px - r0 * 256)
    print(f"  {layer[:28]} z{z}: {len(jobs)} tiles, crop {box[2]-box[0]:.0f}px -> {out_px}px")
    return big.crop(tuple(int(round(v)) for v in box)), big.resize((out_px, out_px), Image.BILINEAR, box=box)


def b64(arr):
    return base64.b64encode(arr.tobytes()).decode("ascii")


def main():
    dem = json.load(open(os.path.join(ROOT, "data", "jezero_dem.json")))
    b, n = dem["bounds_lonlat"], dem["rows"]
    os.makedirs(os.path.join(ROOT, "game", "data"), exist_ok=True)

    # Ground: HiRISE at ~2.5 m/px (z14), 2 px per grid cell, tinted + quantised for a pixel-art look.
    _, g = mosaic(HIRISE, 14, b, n * 2)
    a = np.asarray(g, dtype=np.float32)
    lo, hi = np.percentile(a, [1, 99])
    a = np.clip((a - lo) / (hi - lo), 0, 1)
    idx = np.round(a * (len(PALETTE) - 1)).astype(np.uint8)
    Image.fromarray(np.array(PALETTE, dtype=np.uint8)[idx], "RGB").save(os.path.join(ROOT, "game", "data", "ground.png"))

    # THEMIS night IR (~100 m/px): bright = warm at night = rocky/bedrock, dark = dust/sand.
    raw, t = mosaic(THEMIS, 9, b, n)
    themis = np.asarray(t, dtype=np.uint8)

    elev = np.array(dem["elevation_m"], dtype=np.float32)
    slope = np.array(dem["slope_deg"], dtype=np.float32)
    emin = float(elev.min())
    pack = {
        "site": "Jezero Crater — Perseverance landing area",
        "center": dem["center"], "bounds_lonlat": b, "rows": n, "cols": dem["cols"], "cell_m": dem["cell_m"],
        "sources": {"elevation": dem["source"], "imagery": "Mars Trek / " + HIRISE, "thermal": "Mars Trek / " + THEMIS},
        "elev_min_m": emin,
        "elev_cm_u16": b64(np.round((elev - emin) * 100).astype("<u2")),
        "slope_x4_u8": b64(np.clip(np.round(slope * 4), 0, 255).astype(np.uint8)),
        "themis_u8": b64(themis),
    }
    json.dump(pack, open(os.path.join(ROOT, "game", "data", "terrain.json"), "w"), separators=(",", ":"))
    print(f"THEMIS native crop {raw.size}, values {themis.min()}..{themis.max()} (mean {themis.mean():.0f})")
    print("wrote game/data/ground.png + terrain.json",
          os.path.getsize(os.path.join(ROOT, "game", "data", "terrain.json")) // 1024, "KB")


if __name__ == "__main__":
    main()
