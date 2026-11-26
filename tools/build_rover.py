"""Ground truth from the rover: Perseverance's real traverse, clipped to our board, plus photos it took at chosen stops.

Reads NASA's published localisation (data/M20_waypoints.json, data/M20_traverse.json — from mars.nasa.gov/mmgis-maps/M20),
our DEM window and tile pack, and writes game/data/rover.json:
  path   : the drive, in board tile coordinates
  stops  : real waypoints (sol, position) with a Navcam photo taken at that exact site/drive
  stats  : how the rover's real route compares with the board (slope, sand) and how our DEM compares with the
           elevations the rover itself reported — evidence that the terrain model and the cost function are sound

Usage: python tools/build_rover.py [--photos 8]
"""
import argparse
import json
import os
import urllib.request

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&num=100&page=0&order=sol+asc&search=NAVCAM_LEFT&sol={}"
UA = {"User-Agent": "Mozilla/5.0 (Alexstra Space Apps)"}
SLOPE_LIMIT, SOFT_DUNE = 15, 0.6


def get(url, raw=False):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
        return r.read() if raw else json.load(r)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--photos", type=int, default=8); a = ap.parse_args()
    dem = json.load(open(os.path.join(ROOT, "data", "jezero_dem.json")))
    board = json.load(open(os.path.join(ROOT, "game", "data", "board.json")))
    b, N = dem["bounds_lonlat"], board["cols"]
    tx = lambda lon: (lon - b["west"]) / (b["east"] - b["west"]) * N
    ty = lambda lat: (b["north"] - lat) / (b["north"] - b["south"]) * N
    inside = lambda x, y: 0 <= x < N and 0 <= y < N
    slope, soft = np.array(board["slope"]).reshape(N, N), np.array(board["soft"]).reshape(N, N)

    # --- the drive ---
    path = []
    for f in json.load(open(os.path.join(ROOT, "data", "M20_traverse.json"), encoding="utf-8"))["features"]:
        g = f["geometry"]; lines = g["coordinates"] if g["type"] == "LineString" else [p for l in g["coordinates"] for p in l]
        for lon, lat, *_ in lines:
            x, y = tx(lon), ty(lat)
            if inside(x, y) and (not path or abs(path[-1][0] - x) + abs(path[-1][1] - y) > 0.12):
                path.append([round(x, 2), round(y, 2), f["properties"]["sol"]])
    tiles = list(dict.fromkeys((min(N - 1, int(p[1])), min(N - 1, int(p[0]))) for p in path))
    rs, rf = np.array([slope[t] for t in tiles]), np.array([soft[t] for t in tiles])

    # --- our DEM against the elevations the rover reported ---
    z = np.array(dem["elevation_m"]); n = z.shape[0]
    wps = [f["properties"] for f in json.load(open(os.path.join(ROOT, "data", "M20_waypoints.json"), encoding="utf-8"))["features"]]
    wps = [w for w in wps if inside(tx(w["lon"]), ty(w["lat"]))]
    diffs = []
    for w in wps:
        px, py = tx(w["lon"]) / N * n - 0.5, ty(w["lat"]) / N * n - 0.5
        x0, y0 = int(np.clip(px, 0, n - 2)), int(np.clip(py, 0, n - 2)); fx, fy = px - x0, py - y0
        e = (z[y0, x0] * (1 - fx) + z[y0, x0 + 1] * fx) * (1 - fy) + (z[y0 + 1, x0] * (1 - fx) + z[y0 + 1, x0 + 1] * fx) * fy
        diffs.append(e - w["elev_geoid"])
    diffs = np.array(diffs)

    stats = {
        "rover_tiles": len(tiles), "drive_sols": [int(min(p[2] for p in path)), int(max(p[2] for p in path))], "waypoints": len(wps),
        "rover_mean_slope": round(float(rs.mean()), 2), "board_mean_slope": round(float(slope.mean()), 2),
        "rover_max_slope": round(float(rs.max()), 1), "rover_over_10deg_pct": round(float((rs > 10).mean() * 100), 1), "board_over_10deg_pct": round(float((slope > 10).mean() * 100), 1),
        "rover_over_limit": int((rs > SLOPE_LIMIT).sum()),
        "rover_sand_pct": round(float((rf > SOFT_DUNE).mean() * 100), 1), "board_sand_pct": round(float((soft > SOFT_DUNE).mean() * 100), 1),
        "dem_vs_rover_elev_mean_m": round(float(diffs.mean()), 2), "dem_vs_rover_elev_std_m": round(float(diffs.std()), 2),
    }
    print(json.dumps(stats, indent=1))

    # --- stops with a photo: spread out, on ground you can stand on, away from the landing site ---
    home = (N // 2, N // 2); cand = []
    for w in wps:
        x, y = int(tx(w["lon"])), int(ty(w["lat"]))
        if slope[y, x] <= SLOPE_LIMIT and abs(x - home[0]) + abs(y - home[1]) >= 5 and (x, y) not in [(c["x"], c["y"]) for c in cand]:
            cand.append({"x": x, "y": y, "sol": w["sol"], "site": w["site"], "drive": w["drive"]})
    chosen = [max(cand, key=lambda c: abs(c["x"] - home[0]) + abs(c["y"] - home[1]))]
    while len(chosen) < min(a.photos * 2, len(cand)):                                # farthest-point spread
        chosen.append(max((c for c in cand if c not in chosen), key=lambda c: min(abs(c["x"] - o["x"]) + abs(c["y"] - o["y"]) for o in chosen)))
    out_dir = os.path.join(ROOT, "game", "assets", "rover"); os.makedirs(out_dir, exist_ok=True)
    stops = []
    for c in chosen:
        if len(stops) == a.photos: break
        try: imgs = get(API.format(c["sol"]))["images"]
        except Exception as e: print("  sol", c["sol"], "api failed:", e); continue
        def tilt(i):                                                                 # mast elevation: about -10 deg looks out across the ground
            try: return float(i["extended"]["mastEl"])
            except Exception: return -90.0
        here = [i for i in imgs if str(i.get("site")) == str(c["site"]) and str(i.get("drive")) == str(c["drive"]) and i.get("sample_type") == "Full" and -28 < tilt(i) < 6]
        here.sort(key=lambda i: abs(tilt(i) + 10))
        if not here: print(f"  sol {c['sol']} site {c['site']} drive {c['drive']}: no landscape Navcam frame at this exact stop"); continue
        im = here[0]; name = f"sol{c['sol']:04d}_{c['site']}_{c['drive']}.jpg"
        open(os.path.join(out_dir, name), "wb").write(get(im["image_files"]["medium"], raw=True))
        stops.append({**c, "img": "assets/rover/" + name, "date": im["date_taken_utc"][:10], "id": im["imageid"], "credit": im["credit"]})
        print(f"  stop ({c['x']},{c['y']}) sol {c['sol']}: {name}")
    json.dump({"path": path, "stops": stops, "stats": stats, "source": "NASA/JPL-Caltech — Mars 2020 localisation (mmgis-maps/M20) and raw image API"},
              open(os.path.join(ROOT, "game", "data", "rover.json"), "w"), separators=(",", ":"))
    print("wrote game/data/rover.json:", len(path), "path points,", len(stops), "stops with photos")


if __name__ == "__main__":
    main()
