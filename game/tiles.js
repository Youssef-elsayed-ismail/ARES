// Builds the board picture from painted textures and props. The art is hand-style, but WHERE each thing goes is real data:
//   which ground texture  <- THEMIS night IR (cold = loose sand, warm = bedrock) + slope + real photo brightness
//   rocks and boulders    <- slope from the HiRISE DTM: pebbles > 5°, boulders > 7.5°, rock piles on impassable ground
//   craters               <- real hollows in the HiRISE DTM (a tile clearly lower than everything around it)
//   light and colour      <- real elevation: hillshade from the DTM, cooler and darker low down, warmer and brighter high up
import { SLOPE_LIMIT } from "./astar.js";

export const TS = 16;                        // board units per tile (what the game logic draws in)
export const ART = 64;                       // art pixels per tile
const LEDGE_M = 3.5;                         // a drop this big to the next tile gets a rock-face ledge
const BLOCK = 4;                            // texture borders are cut in blocks this many art pixels wide
export const TEXTURES = ["sand", "bedrock", "gravel", "basalt", "dust", "rubble"];

function rng(seed) { let s = (seed * 2654435761) >>> 0; return () => { s += 0x6d2b79f5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function ranks(a) { const o = Array.from(a.keys()).sort((i, j) => a[i] - a[j]), r = new Float32Array(a.length); o.forEach((i, k) => (r[i] = k / (a.length - 1))); return r; }
const canvas = (w, h = w) => Object.assign(document.createElement("canvas"), { width: w, height: h });
const hash2 = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function noise(x, y, s, cell) {              // smooth value noise, 0..1
  const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (hash2(x0, y0, s) * (1 - u) + hash2(x0 + 1, y0, s) * u) * (1 - v) + (hash2(x0, y0 + 1, s) * (1 - u) + hash2(x0 + 1, y0 + 1, s) * u) * v;
}

// Lay textures over the board: each tile names a texture; borders between them are cut organically and get a dark seam.
function quilt(N, which, tex, px) {
  const W = N * px, M = W / BLOCK, per = px / BLOCK, at = (x, y) => Math.max(0, Math.min(N - 1, y)) * N + Math.max(0, Math.min(N - 1, x));
  const idx = new Uint8Array(M * M), w = new Float32Array(tex.length);
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
    const u = (x + 0.5) / per - 0.5, v = (y + 0.5) / per - 0.5, x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    w.fill(0);
    w[which[at(x0, y0)]] += (1 - fx) * (1 - fy); w[which[at(x0 + 1, y0)]] += fx * (1 - fy); w[which[at(x0, y0 + 1)]] += (1 - fx) * fy; w[which[at(x0 + 1, y0 + 1)]] += fx * fy;
    let best = 0, bv = -1;
    for (let k = 0; k < w.length; k++) if (w[k] > 0) { const val = w[k] + (noise(x, y, k + 1, 9) - 0.5) * 0.45; if (val > bv) { bv = val; best = k; } }
    idx[y * M + x] = best;
  }
  const art = canvas(W), g = art.getContext("2d"), tmp = canvas(W), tg = tmp.getContext("2d"), mask = canvas(M), mg = mask.getContext("2d");
  g.imageSmoothingEnabled = false; tg.imageSmoothingEnabled = false;
  for (let k = 0; k < tex.length; k++) {
    const im = mg.createImageData(M, M); let any = false;
    for (let p = 0; p < M * M; p++) if (idx[p] === k) { im.data[p * 4 + 3] = 255; any = true; }
    if (!any) continue;
    mg.putImageData(im, 0, 0);
    tg.globalCompositeOperation = "source-over"; tg.clearRect(0, 0, W, W); tg.fillStyle = tg.createPattern(tex[k], "repeat"); tg.fillRect(0, 0, W, W);
    tg.globalCompositeOperation = "destination-in"; tg.drawImage(mask, 0, 0, W, W);
    g.drawImage(tmp, 0, 0);
  }
  g.fillStyle = "rgba(46,20,36,0.4)";                                                // a dark seam where two grounds meet
  for (let y = 0; y < M - 1; y++) for (let x = 0; x < M - 1; x++) { const p = y * M + x; if (idx[p] !== idx[p + 1] || idx[p] !== idx[p + M]) g.fillRect(x * BLOCK, y * BLOCK, BLOCK, BLOCK); }
  return art;
}

export function tileKind(T, i) { return T.slope[i] > SLOPE_LIMIT ? "cliff" : T.soft[i] > 0.6 ? "dune" : T.soft[i] < 0.36 ? "slab" : "gravel"; }

// flat = true paints the ground for the 3D view: no rocks and no ledges (those become real geometry there), only their
// shadows, and the canvas carries `rocks`: where each rock stands, in board units.
export function paintBoard(T, photo, tex, props, flat = false) {
  const N = T.cols, W = N * ART, M = W / BLOCK, at = (x, y) => Math.max(0, Math.min(N - 1, y)) * N + Math.max(0, Math.min(N - 1, x));

  const tiny = canvas(N).getContext("2d"); tiny.drawImage(photo, 0, 0, N, N);       // real brightness, one value per tile
  const pd = tiny.getImageData(0, 0, N, N).data, lum = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) lum[i] = pd[i * 4] * 0.3 + pd[i * 4 + 1] * 0.59 + pd[i * 4 + 2] * 0.11;
  const bright = ranks(lum);

  const which = new Uint8Array(N * N);                                               // texture of each tile, from the data
  for (let i = 0; i < N * N; i++) { const k = tileKind(T, i);
    which[i] = k === "cliff" ? 5 : k === "dune" ? 0 : k === "slab" ? (bright[i] < 0.3 ? 3 : 1) : T.slope[i] < 4 ? 4 : 2; }

  const art = quilt(N, which, tex, ART), g = art.getContext("2d");

  // light: hillshade and height tint from the real elevation, multiplied over the ground
  const L = N * 4, lit = canvas(L), lg = lit.getContext("2d"), li = lg.createImageData(L, L), lo = T.elev_range_m[0], span = T.elev_range_m[1] - lo;
  const elevAt = (x, y) => { const u = (x + 0.5) / 4 - 0.5, v = (y + 0.5) / 4 - 0.5, x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    return (T.elev[at(x0, y0)] * (1 - fx) + T.elev[at(x0 + 1, y0)] * fx) * (1 - fy) + (T.elev[at(x0, y0 + 1)] * (1 - fx) + T.elev[at(x0 + 1, y0 + 1)] * fx) * fy; };
  for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) {
    const e = elevAt(x, y), dzdx = (elevAt(x + 1, y) - elevAt(x - 1, y)) / (T.cell_m / 2), dzdy = (elevAt(x, y + 1) - elevAt(x, y - 1)) / (T.cell_m / 2);
    const shade = Math.max(0.55, Math.min(1, 0.86 - (dzdx + dzdy) * 2.2)), f = Math.max(0, Math.min(1, (e - lo) / span)), p = (y * L + x) * 4;   // light from the upper left
    li.data[p] = (178 + 77 * f) * shade; li.data[p + 1] = (140 + 104 * f) * shade; li.data[p + 2] = (172 + 50 * f) * shade; li.data[p + 3] = 255;
  }
  lg.putImageData(li, 0, 0);
  g.imageSmoothingEnabled = true; g.globalCompositeOperation = "multiply"; g.drawImage(lit, 0, 0, W, W); g.globalCompositeOperation = "source-over";

  // props, back to front
  const put = [], add = (im, cx, footY, scale, wall = false) => put.push({ im, x: cx - (im.width * scale) / 2, y: footY - im.height * scale, w: im.width * scale, h: im.height * scale, z: footY, rock: true, wall });
  let craters = 0, ledges = 0;
  for (let i = 0; i < N * N; i++) {
    const tx = i % N, ty = (i / N) | 0, X = tx * ART, Y = ty * ART, r = rng(i + 104729), s = T.slope[i], pick = (row) => props[row][(r() * props[row].length) | 0];
    if (tx > 0 && ty > 0 && tx < N - 1 && ty < N - 1 && s <= SLOPE_LIMIT) {          // a real hollow in the DTM
      let sum = 0, low = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) { const e = T.elev[at(tx + dx, ty + dy)]; sum += e; if (e <= T.elev[i]) low = false; }
      const depth = sum / 8 - T.elev[i];
      if (low && depth > 1.2) { const im = props[4][Math.min(3, (depth / 1.5) | 0)], sc = 0.45;                      // deeper hollow, bigger crater; drawn under the rocks
        put.push({ im, x: X + ART / 2 - (im.width * sc) / 2, y: Y + ART / 2 - (im.height * sc) / 2, w: im.width * sc, h: im.height * sc, z: -1 }); craters++; continue; }
    }
    const kind = tileKind(T, i), drop = (dx, dy) => kind !== "cliff" && T.elev[i] - T.elev[at(tx + dx, ty + dy)] > LEDGE_M && (tx + dx < N) && (ty + dy < N);
    if (drop(0, 1)) { const im = props[3][0], sc = (ART * 1.06) / im.width; ledges++;      // the ground really drops to the south: a rock face
      put.push({ im, x: X - ART * 0.03, y: Y + ART - im.height * sc * 0.42, w: im.width * sc, h: im.height * sc, z: Y + ART - 1, ledge: true }); }
    if (drop(1, 0)) { const im = props[3][1], sc = (ART * 1.06) / im.height; ledges++;     // ...or to the east
      put.push({ im, x: X + ART - im.width * sc * 0.45, y: Y - ART * 0.03, w: im.width * sc, h: im.height * sc, z: Y + ART - 2, ledge: true }); }
    if (kind !== "cliff" && s < 5 && r() < 0.045) {                                         // small ground details that match the surface
      const im = props[6][kind === "dune" ? 0 : kind === "slab" ? 1 : 2], sc = 0.2;
      put.push({ im, x: X + ART / 2 - (im.width * sc) / 2, y: Y + ART / 2 - (im.height * sc) / 2, w: im.width * sc, h: im.height * sc, z: 0 }); continue; }
    if (kind === "cliff") add(pick(2), X + ART / 2 + (r() - 0.5) * 10, Y + ART * 0.98, 0.3, true);
    else if (s > 10) add(pick(1), X + ART * (0.3 + r() * 0.4), Y + ART * (0.6 + r() * 0.35), 0.34);
    else if (s > 7.5) { if (r() < 0.55) add(pick(1), X + ART * (0.3 + r() * 0.4), Y + ART * (0.55 + r() * 0.4), 0.25); else add(pick(0), X + ART * (0.25 + r() * 0.5), Y + ART * (0.4 + r() * 0.5), 0.42); }
    else if (s > 5 && r() < 0.45) add(pick(0), X + ART * (0.25 + r() * 0.5), Y + ART * (0.4 + r() * 0.5), 0.38);
    else if (r() < 0.05) add(pick(0), X + ART * (0.25 + r() * 0.5), Y + ART * (0.4 + r() * 0.5), 0.3);
  }
  put.sort((a, b) => a.z - b.z);
  for (const p of put) {
    if (flat && p.ledge) continue;                       // 3D: the mesh itself shows the drop
    if (flat && p.rock) { g.fillStyle = "rgba(30,10,24,0.42)"; g.beginPath(); g.ellipse(p.x + p.w / 2 + p.w * 0.12, p.y + p.h * 0.84, p.w * 0.56, p.w * 0.26, 0, 0, 7); g.fill(); continue; }   // 3D: only the rock's shadow
    g.drawImage(p.im, p.x, p.y, p.w, p.h);
  }
  const u = ART / TS;                                    // art pixels per board unit
  art.rocks = put.filter((p) => p.rock).map((p) => ({ x: (p.x + p.w / 2) / u, y: (p.y + p.h * 0.8) / u, w: p.w / u, wall: p.wall }));
  console.info(`board painted: ${put.length} props, ${craters} craters from DTM hollows, ${ledges} ledges from DTM drops`);
  return art;
}
