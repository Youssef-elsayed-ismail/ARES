"""Cut a grid of ground textures (white gaps between them) into square, seamlessly tiling PNGs.

Each swatch is made tileable by cross-fading it with a half-offset copy of itself, so no edge shows when it repeats.

Usage: python tools/slice_textures.py <sheet> <out_dir> name1 name2 ...   (names in reading order)
"""
import os
import sys

import numpy as np
from PIL import Image

SIZE = 512


def runs(mask):
    out, start = [], None
    for i, v in enumerate(mask):
        if v and start is None: start = i
        if not v and start is not None: out.append((start, i)); start = None
    if start is not None: out.append((start, len(mask)))
    return [r for r in out if r[1] - r[0] > 100]


def seamless(a):
    n = a.shape[0]
    b = np.roll(a, (n // 2, n // 2), axis=(0, 1))
    d = np.abs(np.arange(n) - (n - 1) / 2) / (n / 2)                 # 0 at the centre, 1 at the edges
    w = np.clip((np.maximum.outer(d, d) - 0.72) / 0.2, 0, 1)[..., None]   # use the offset copy only near the edges
    return (a * (1 - w) + b * w).astype(np.uint8)


def main():
    sheet, out, names = sys.argv[1], sys.argv[2], sys.argv[3:]
    im = Image.open(sheet).convert("RGB")
    a = np.asarray(im).astype(np.int16)
    ink = ~((a.min(2) > 235) & ((a.max(2) - a.min(2)) < 12))
    rows = runs(ink.mean(1) > 0.5)
    os.makedirs(out, exist_ok=True)
    k = 0
    for y0, y1 in rows:
        cols = runs(ink[y0:y1].mean(0) > 0.5)             # columns are found inside each row band (sheets may have empty margins)
        print("row", y0, y1, "->", len(cols), "swatches")
        for x0, x1 in cols:
            s = min(y1 - y0, x1 - x0) - 8
            sw = im.crop((x0 + 4, y0 + 4, x0 + 4 + s, y0 + 4 + s)).resize((SIZE, SIZE), Image.LANCZOS)
            Image.fromarray(seamless(np.asarray(sw).astype(np.float32))).save(os.path.join(out, names[k] + ".png"))
            k += 1
    print("wrote", k, "textures to", out)


if __name__ == "__main__":
    main()
