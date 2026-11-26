"""Mark every AI-generated image as AI-generated, as the Space Apps submission rules require.

- art_src sheets (the generated originals): a visible banner along the bottom edge, and NASA branding removed from the
  items sheet (the generator drew a NASA wordmark on the rover and a NASA flag; generated content may not carry those).
- game/assets images cut from those sheets: a text chunk in the PNG metadata. Their visible mark is the
  "AI-GENERATED ART" label the game shows on screen wherever they appear.

Usage: python tools/mark_ai_art.py      (safe to run again: sheets already marked are skipped)
"""
import glob
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from PIL.PngImagePlugin import PngInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOTE = "AI-generated image (prompt written by Team Alexstra), processed by this project's own code. Not NASA imagery."
BANNER = "AI-GENERATED IMAGE  ·  Team Alexstra  ·  NASA Space Apps 2026"


def clean_items(im):
    a = np.asarray(im.convert("RGB")).astype(np.int16).copy()
    y0, y1, x0, x1 = 772, 828, 232, 320                                  # the wordmark on the rover body
    reg = a[y0:y1, x0:x1]; r, g, b = reg[..., 0], reg[..., 1], reg[..., 2]
    ink = ((b > r + 18) | ((r > g + 70) & (r > 150) & (g < 120))) & (reg.sum(2) < 640)
    reg[ink] = np.median(reg[(~ink) & (reg.min(2) > 150)], axis=0); a[y0:y1, x0:x1] = reg
    a[690:980, 1235:1500] = 255                                          # the flag: removed entirely
    return Image.fromarray(a.astype(np.uint8))


def banner(im):
    im = im.convert("RGB"); w, h = im.size; bar = max(26, h // 34)
    out = Image.new("RGB", (w, h + bar), (30, 12, 24)); out.paste(im, (0, 0))
    d = ImageDraw.Draw(out)
    try: font = ImageFont.truetype("arialbd.ttf", int(bar * 0.6))
    except OSError: font = ImageFont.load_default()
    d.text((12, h + bar * 0.18), BANNER, fill=(255, 207, 74), font=font)
    return out


def main():
    src = os.path.join(ROOT, "art_src")
    for f in sorted(glob.glob(os.path.join(src, "*_sheet.webp"))):
        im = Image.open(f)
        if os.path.basename(f) == "items_sheet.webp": im = clean_items(im)
        out = f[:-5] + "_ai.png"
        if not os.path.exists(out): banner(im).save(out, pnginfo=meta())
        os.remove(f); print("marked", os.path.basename(out))
    n = 0
    for f in glob.glob(os.path.join(ROOT, "game", "assets", "**", "*.png"), recursive=True):
        im = Image.open(f)
        if im.text.get("AI-Disclosure"): continue
        im.save(f, pnginfo=meta()); n += 1
    print("metadata added to", n, "game images")


def meta():
    m = PngInfo(); m.add_text("AI-Disclosure", NOTE); m.add_text("Source", "AI image generation"); return m


if __name__ == "__main__":
    main()
