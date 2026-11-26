"""Cut a generated character sheet (loose rows on a white background) into a clean sprite atlas.

Removes the background (flood fill from the border, so white inside the outline survives), finds each
pose, drops loose bits such as dust puffs, and writes a grid atlas: one row per animation, fixed cell
size, every frame anchored bottom-centre.

Usage: python tools/slice_sheet.py <sheet> <out.png> name=row:count[:start] ...
"""
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi


GROW = 1          # pixels a body may be split by and still count as one piece
MIN_AREA = 2500   # smaller blobs are not characters
BG_AREA = 1800    # a pale region this large is background, not a white part of the character


def cut(path):
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    pale = (rgb.min(2) > 222) & ((rgb.max(2) - rgb.min(2)) < 16)
    lab, n = ndi.label(pale)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    area = ndi.sum(pale, lab, range(1, n + 1))
    big = np.flatnonzero(area > BG_AREA) + 1             # the generator leaves a white card around each pose
    bg = np.isin(lab, np.union1d(edge[edge > 0], big))
    for _ in range(2):                                   # peel the pale anti-aliased fringe
        bg |= ndi.binary_dilation(bg) & (rgb.min(2) > 185) & ((rgb.max(2) - rgb.min(2)) < 40)
    fg = ~bg
    groups, n = ndi.label(ndi.binary_dilation(fg, iterations=GROW))      # each pose = one connected body; loose bits are separate
    frames = []
    for g, sl in enumerate(ndi.find_objects(groups), 1):
        keep = fg[sl] & (groups[sl] == g)
        if keep.sum() < MIN_AREA:                                         # dust puffs, symbols
            continue
        ys, xs = np.where(keep)
        keep = keep[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        oy, ox = sl[0].start + ys.min(), sl[1].start + xs.min()
        px = np.dstack([rgb[oy:oy + keep.shape[0], ox:ox + keep.shape[1]].astype(np.uint8), (keep * 255).astype(np.uint8)])
        frames.append((oy + keep.shape[0], ox, px))                       # sort rows by the feet line
    frames.sort(key=lambda f: f[0])
    rows, cur = [], [frames[0]]
    for f in frames[1:]:
        if f[0] - cur[-1][0] > 45:
            rows.append(cur); cur = []
        cur.append(f)
    rows.append(cur)
    return [[f[2] for f in sorted(r, key=lambda f: f[1])] for r in rows]


def main():
    global BG_AREA, MIN_AREA, GROW
    sheet, out, specs = sys.argv[1], sys.argv[2], sys.argv[3:]
    while specs and specs[0].split("=")[0] in ("bg", "min", "grow"):   # bg=N pale areas this big are background · min=N smallest sprite · grow=N join bits this close
        k, v = specs.pop(0).split("=")
        if k == "bg": BG_AREA = int(v)
        elif k == "min": MIN_AREA = int(v)
        else: GROW = int(v)
    if not specs:                                         # no animations named: write every sprite as its own file, <out>/<row>_<col>.png
        import os
        os.makedirs(out, exist_ok=True)
        rows, meta = cut(sheet), []
        for r, row in enumerate(rows):
            meta.append([])
            for c, f in enumerate(row):
                Image.fromarray(f, "RGBA").save(os.path.join(out, f"{r}_{c}.png")); meta[-1].append([f.shape[1], f.shape[0]])
        json.dump(meta, open(os.path.join(out, "props.json"), "w"))
        print("rows found:", [len(r) for r in rows], "->", out)
        return
    rows = cut(sheet)
    print("rows found:", [len(r) for r in rows])
    anims = {}
    for s in specs:
        name, rest = s.split("=")
        row, count, *start = map(int, rest.split(":"))
        anims[name] = rows[row][(start[0] if start else 0):][:count]
    cw = max(f.shape[1] for a in anims.values() for f in a) + 2
    ch = max(f.shape[0] for a in anims.values() for f in a) + 2
    cols = max(len(a) for a in anims.values())
    atlas = Image.new("RGBA", (cw * cols, ch * len(anims)))
    meta = {"cell": [cw, ch], "anims": {}}
    for r, (name, fr) in enumerate(anims.items()):
        meta["anims"][name] = {"row": r, "n": len(fr)}
        for c, f in enumerate(fr):
            atlas.paste(Image.fromarray(f, "RGBA"), (c * cw + (cw - f.shape[1]) // 2, r * ch + ch - 1 - f.shape[0]))
    atlas.save(out)
    json.dump(meta, open(out.rsplit(".", 1)[0] + ".json", "w"))
    print("wrote", out, atlas.size, meta)


if __name__ == "__main__":
    main()
