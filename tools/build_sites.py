"""Landing sites: the rover's own, plus sites on ground no rover has ever reached.

"Unvisited" is measured, not judged: a tile counts as unvisited when it lies more than UNVISITED_M from every point of
Perseverance's real traverse (game/data/rover.json). Sites are then chosen the way real landing sites are screened —
flat, firm, with room around them — and each gets three pieces on unvisited ground of different kinds. Because no
rover photo exists there, each piece gets a real HiRISE close-up of its own tile, pulled from Mars Trek.

Writes game/data/sites.json and game/assets/orbit/*.jpg.   Usage: python tools/build_sites.py
"""
import json
import os
import sys
from collections import deque

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_layers import HIRISE, ROOT, mosaic  # noqa: E402

UNVISITED_M = 200          # farther than this from any rover track = never visited
LIMIT, FLAT, SAND = 15, 5, 0.6
M_PER_DEG = 3396190 * np.pi / 180


def main():
    board = json.load(open(os.path.join(ROOT, "game", "data", "board.json")))
    rover = json.load(open(os.path.join(ROOT, "game", "data", "rover.json")))
    N, cell, b = board["cols"], board["cell_m"], board["bounds_lonlat"]
    slope, soft, elev = (np.array(board[k]).reshape(N, N) for k in ("slope", "soft", "elev"))
    path = np.array([[p[0], p[1]] for p in rover["path"]])
    yy, xx = np.mgrid[0:N, 0:N]
    centres = np.stack([xx + 0.5, yy + 0.5], axis=-1).reshape(-1, 1, 2)
    far = (np.sqrt(((centres - path[None]) ** 2).sum(-1)).min(1) * cell).reshape(N, N)        # metres to the nearest rover track
    unvisited = far > UNVISITED_M

    ok = slope <= LIMIT                                                                      # ground you can stand on, joined to the landing area
    seen = np.zeros((N, N), bool); q = deque([(N // 2, N // 2)]); seen[N // 2, N // 2] = True
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            v, u = y + dy, x + dx
            if 0 <= v < N and 0 <= u < N and ok[v, u] and not seen[v, u]: seen[v, u] = True; q.append((v, u))
    kind = np.where(slope > LIMIT, "cliff", np.where(soft > SAND, "dune", np.where(soft < 0.36, "slab", "gravel")))
    risk = 0.004 + 0.06 * (slope / LIMIT) ** 2 + 0.02 * soft; safe = risk < 0.02

    def roomy(y, x, r=1):                                                                    # flat, firm, and so are its neighbours
        if not (3 <= y < N - 3 and 3 <= x < N - 3): return False
        w = (slice(y - r, y + r + 1), slice(x - r, x + r + 1))
        return bool((slope[w] < FLAT).all() and (soft[w] < SAND).all())
    cand = [(y, x) for y in range(N) for x in range(N) if unvisited[y, x] and seen[y, x] and roomy(y, x)]
    print(f"unvisited tiles: {int(unvisited.sum())} of {N * N} | usable landing tiles: {len(cand)}")
    chosen = [max(cand, key=lambda c: far[c])]
    while len(chosen) < 3:
        chosen.append(max(cand, key=lambda c: min(abs(c[0] - o[0]) + abs(c[1] - o[1]) for o in chosen) + 0.02 * far[c] / cell))

    lon = lambda x: b["west"] + (x + 0.5) / N * (b["east"] - b["west"])
    lat = lambda y: b["north"] - (y + 0.5) / N * (b["north"] - b["south"])
    out_dir = os.path.join(ROOT, "game", "assets", "orbit"); os.makedirs(out_dir, exist_ok=True)
    hi = np.argsort(np.argsort(elev, axis=None)).reshape(N, N) / (N * N - 1)                 # elevation rank
    compass = lambda y, x: ("north" if y < N * 0.4 else "south" if y > N * 0.6 else "") + ("-" if (y < N * 0.4 or y > N * 0.6) and (x < N * 0.4 or x > N * 0.6) else "") + ("west" if x < N * 0.4 else "east" if x > N * 0.6 else "") or "central"
    sites = [{"id": "butler", "name": "Octavia E. Butler Landing", "visited": True, "x": N // 2, "y": N // 2, "far_m": 0,
              "about": "Where Perseverance touched down. The rover drove all around it."}]
    for k, (sy, sx) in enumerate(chosen):
        wants = [("slab", lambda y, x: kind[y, x] == "slab", "solid rock, warm at night"), ("gravel", lambda y, x: kind[y, x] == "gravel", "mixed gravel"),
                 ("high", lambda y, x: hi[y, x] > 0.6, "high ground")]
        parts = []
        for name, test, words in wants:
            pool = [(y, x) for y in range(N) for x in range(N) if unvisited[y, x] and seen[y, x] and safe[y, x] and test(y, x)
                    and 6 <= abs(y - sy) + abs(x - sx) <= 15 and all(abs(y - p["y"]) + abs(x - p["x"]) >= 6 for p in parts)]
            if not pool: pool = [(y, x) for y in range(N) for x in range(N) if unvisited[y, x] and seen[y, x] and safe[y, x]
                                 and 6 <= abs(y - sy) + abs(x - sx) <= 15 and all(abs(y - p["y"]) + abs(x - p["x"]) >= 6 for p in parts)]
            y, x = max(pool, key=lambda c: far[c] - 3 * abs(abs(c[0] - sy) + abs(c[1] - sx) - 10) * cell / 10)
            d = 80 / M_PER_DEG                                                               # a 160 m square around the piece, at 25 cm/pixel
            _, im = mosaic(HIRISE, 17, {"west": lon(x) - d, "east": lon(x) + d, "south": lat(y) - d, "north": lat(y) + d}, 480)
            f = f"site{k + 1}_{name}.jpg"; im.convert("RGB").save(os.path.join(out_dir, f), quality=86)
            parts.append({"x": x, "y": y, "img": "assets/orbit/" + f, "ground": words, "far_m": int(far[y, x]), "lat": round(float(lat(y)), 5), "lon": round(float(lon(x)), 5)})
        where, height = compass(sy, sx), "high" if hi[sy, sx] > 0.6 else "low" if hi[sy, sx] < 0.35 else "middle"
        sites.append({"id": f"site{k + 1}", "name": f"Unvisited site {'ABC'[k]}: {where}, {height} ground", "visited": False, "x": sx, "y": sy, "far_m": int(far[sy, sx]),
                      "about": f"No rover track within {int(far[sy, sx])} m. Flat, firm ground: {slope[sy, sx]:.1f} deg slope. Only seen from orbit.", "parts": parts})
        print(f"  site {'ABC'[k]} at ({sx},{sy}) {where}, {height}: {int(far[sy, sx])} m from any track; pieces at {[(p['x'], p['y']) for p in parts]}")
    json.dump({"unvisited_m": UNVISITED_M, "unvisited_share": round(float(unvisited.mean()), 3), "sites": sites,
               "source": "NASA Mars 2020 traverse (visited or not) + HiRISE terrain model (site screening) + HiRISE mosaic via Mars Trek (close-ups)"},
              open(os.path.join(ROOT, "game", "data", "sites.json"), "w"), separators=(",", ":"))
    print("wrote game/data/sites.json:", len(sites), "sites")


if __name__ == "__main__":
    main()
