"""Stream a small window of the Jezero HiRISE DTM (USGS) via HTTP Range requests.

No full download: reads only the rows/columns of the requested window, then computes
slope (degrees) and writes a compact JSON grid for the game (also used as an offline fallback).

Usage:
  python tools/fetch_dem_window.py --lat 18.4447 --lon 77.4508 --size 1600 --step 4 --out game/public/data/jezero_dem.json
"""
import argparse
import json
import math
import struct
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np

# planetarymaps.usgs.gov only 302-redirects here (and often returns 502/504), so hit the bucket directly.
DEM_URL = ("https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/"
           "JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif")
MARS_R = 3396190.0  # Mars 2000 sphere radius (m), from the product's projection
UA = {"User-Agent": "Mozilla/5.0 (Alexstra Space Apps)"}


def get_range(start, end, tries=5):
    req = urllib.request.Request(DEM_URL, headers={**UA, "Range": f"bytes={start}-{end}"})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))


def read_header():
    d = get_range(0, 262143)
    bo = "<" if d[:2] == b"II" else ">"
    assert struct.unpack(bo + "H", d[2:4])[0] == 42, "expected classic TIFF"
    off = struct.unpack(bo + "I", d[4:8])[0]
    n = struct.unpack(bo + "H", d[off:off + 2])[0]
    sizes = {1: 1, 2: 1, 3: 2, 4: 4, 11: 4, 12: 8, 16: 8}
    fmt = {1: "B", 2: "c", 3: "H", 4: "I", 11: "f", 12: "d", 16: "Q"}
    tags = {}
    for i in range(n):
        e = d[off + 2 + i * 12: off + 14 + i * 12]
        tag, typ, cnt = struct.unpack(bo + "HHI", e[:8])
        nbytes = sizes[typ] * cnt
        if nbytes <= 4:
            raw = e[8:8 + nbytes]
        else:
            p = struct.unpack(bo + "I", e[8:12])[0]
            raw = d[p:p + nbytes] if p + nbytes <= len(d) else get_range(p, p + nbytes - 1)
        if typ == 2:
            tags[tag] = raw.decode("latin1")
        else:
            tags[tag] = struct.unpack(bo + fmt[typ] * cnt, raw)
    return bo, tags


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, default=18.4447)
    ap.add_argument("--lon", type=float, default=77.4508)
    ap.add_argument("--size", type=float, default=1600, help="window size in metres")
    ap.add_argument("--step", type=int, default=4, help="sample every N metres (pixels)")
    ap.add_argument("--out", default="jezero_dem.json")
    a = ap.parse_args()

    bo, t = read_header()
    width, height = t[256][0], t[257][0]
    strip_offsets = t[273]
    sx, sy = t[33550][0], t[33550][1]          # pixel scale (m)
    tie_x, tie_y = t[33922][3], t[33922][4]    # upper-left corner (m, equirectangular)
    nodata = float(t[42113].strip("\x00")) if 42113 in t else None
    assert t[259][0] == 1 and t[258][0] == 32 and t[339][0] == 3, "expected uncompressed float32"

    cx = MARS_R * math.radians(a.lon)
    cy = MARS_R * math.radians(a.lat)
    half = a.size / 2
    col0 = int((cx - half - tie_x) / sx)
    row0 = int((tie_y - (cy + half)) / sy)
    ncols = int(a.size / sx)
    nrows = int(a.size / sy)
    assert 0 <= col0 and col0 + ncols <= width and 0 <= row0 and row0 + nrows <= height, "window outside DTM"

    rows = list(range(row0, row0 + nrows, a.step))
    rps = t[278][0]

    def fetch_row(r):
        base = strip_offsets[r // rps] + (r % rps) * width * 4
        b = get_range(base + col0 * 4, base + (col0 + ncols) * 4 - 1)
        return np.frombuffer(b, dtype=bo + "f4")[::a.step]

    print(f"fetching {len(rows)} row slices ({ncols * 4 // 1024} KB each)...", flush=True)
    with ThreadPoolExecutor(6) as ex:
        z = np.vstack(list(ex.map(fetch_row, rows))).astype(np.float64)

    if nodata is not None:
        z[np.isclose(z, nodata)] = np.nan
    cell = a.step * sx
    gy, gx = np.gradient(z, cell)
    gx = gx / math.cos(math.radians(a.lat))   # the product is equirectangular with true scale at the equator: east-west ground distance is shorter by cos(lat)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))

    out = {
        "source": DEM_URL,
        "center": {"lat": a.lat, "lon": a.lon},
        "size_m": a.size,
        "cell_m": cell,
        "rows": z.shape[0],
        "cols": z.shape[1],
        "bounds_lonlat": {
            "west": math.degrees((tie_x + col0 * sx) / MARS_R),
            "east": math.degrees((tie_x + (col0 + ncols) * sx) / MARS_R),
            "north": math.degrees((tie_y - row0 * sy) / MARS_R),
            "south": math.degrees((tie_y - (row0 + nrows) * sy) / MARS_R),
        },
        "elevation_m": np.round(np.nan_to_num(z, nan=-99999), 2).tolist(),
        "slope_deg": np.round(np.nan_to_num(slope, nan=90), 2).tolist(),
    }
    with open(a.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    s = slope[~np.isnan(slope)]
    print(f"grid {z.shape}, cell {cell} m, elev {np.nanmin(z):.1f}..{np.nanmax(z):.1f} m, "
          f"slope median {np.median(s):.1f} p95 {np.percentile(s, 95):.1f} max {s.max():.1f} deg, "
          f"nan {np.isnan(z).sum()} -> {a.out}")


if __name__ == "__main__":
    main()
