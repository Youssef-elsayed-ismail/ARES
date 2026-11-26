// A* over the tile board (4-directional) with a custom, data-driven cost function.
// cost(step) = tile_size_m * (1 + W_SLOPE * (slope/limit)^2 + W_SOFT * softness)
//   slope    : degrees — 90th-percentile slope inside the tile, from the HiRISE DTM
//   softness : 0..1 from THEMIS night IR (dark at night = low thermal inertia = loose dust)

export const SLOPE_LIMIT = 15;   // deg — steeper tiles are impassable for a suited astronaut
export const W_SLOPE = 2.5;
export const W_SOFT = 0.6;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function makeCost(t) {
  const mult = (i) => { const s = t.slope[i] / SLOPE_LIMIT; return 1 + W_SLOPE * s * s + W_SOFT * t.soft[i]; };
  return {
    passable: (i) => t.slope[i] <= SLOPE_LIMIT,
    mult,
    step: (to) => t.cell_m * mult(to),
    // Chance of a fatal accident when stepping onto a tile ARES has not scanned.
    // Easy ground is never fatal; from about 2% the risk is real, up to 8% on the worst passable tile.
    risk: (i) => { const s = t.slope[i] / SLOPE_LIMIT, r = 0.004 + 0.06 * s * s + 0.02 * t.soft[i]; return r < 0.02 ? 0 : r; },
  };
}

class Heap {                     // binary min-heap keyed by f-score
  constructor() { this.n = []; this.f = []; }
  get size() { return this.n.length; }
  push(node, f) {
    const { n, f: F } = this; let i = n.length; n.push(node); F.push(f);
    while (i > 0) { const p = (i - 1) >> 1; if (F[p] <= F[i]) break; [n[p], n[i]] = [n[i], n[p]]; [F[p], F[i]] = [F[i], F[p]]; i = p; }
  }
  pop() {
    const { n, f: F } = this; const top = n[0]; const ln = n.pop(), lf = F.pop();
    if (n.length) {
      n[0] = ln; F[0] = lf; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < n.length && F[l] < F[m]) m = l;
        if (r < n.length && F[r] < F[m]) m = r;
        if (m === i) break;
        [n[m], n[i]] = [n[i], n[m]]; [F[m], F[i]] = [F[i], F[m]]; i = m;
      }
    }
    return top;
  }
}

/** Returns { path: tile indices start..goal, cost } or null if unreachable. */
export function astar(t, cost, start, goal) {
  const { cols, rows, cell_m: cell } = t, N = cols * rows;
  const g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const gx = goal % cols, gy = (goal / cols) | 0;
  const hmin = cost.hmin ?? 1;                                                               // cheapest possible multiplier -> admissible
  const h = (i) => cell * hmin * (Math.abs((i % cols) - gx) + Math.abs(((i / cols) | 0) - gy));
  const open = new Heap(); g[start] = 0; open.push(start, h(start));
  while (open.size) {
    const cur = open.pop();
    if (cur === goal) break;
    if (closed[cur]) continue; closed[cur] = 1;
    const cx = cur % cols, cy = (cur / cols) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nb = ny * cols + nx;
      if (closed[nb] || !cost.passable(nb)) continue;
      const ng = g[cur] + cost.step(nb);
      if (ng < g[nb]) { g[nb] = ng; came[nb] = cur; open.push(nb, ng + h(nb)); }
    }
  }
  if (!isFinite(g[goal])) return null;
  const out = []; for (let i = goal; i !== -1; i = came[i]) out.push(i);
  return { path: out.reverse(), cost: g[goal] };
}

/** Best order to visit all `targets` from `start` and end at `home`. Returns { path, cost, order } or null. */
export function planTour(t, cost, start, targets, home) {
  const cache = new Map();
  const leg = (a, b) => { const k = a + ">" + b; if (!cache.has(k)) cache.set(k, astar(t, cost, a, b)); return cache.get(k); };
  let best = null;
  const permute = (rest, seq) => {
    if (!rest.length) {
      const stops = [start, ...seq, home]; let total = 0; const legs = [];
      for (let i = 0; i < stops.length - 1; i++) { const l = leg(stops[i], stops[i + 1]); if (!l) return; total += l.cost; legs.push(l); }
      if (!best || total < best.cost) best = { cost: total, legs, order: seq };
      return;
    }
    rest.forEach((x, i) => permute(rest.filter((_, j) => j !== i), [...seq, x]));
  };
  permute(targets, []);
  if (!best) return null;
  const path = []; best.legs.forEach((l, i) => path.push(...(i ? l.path.slice(1) : l.path)));
  return { path, cost: best.cost, order: best.order };
}
