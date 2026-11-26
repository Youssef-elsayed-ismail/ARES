// The opening story: ~35 seconds, drawn live from the game's own art and timed to its score (assets/story.mp3).
// Space -> the engine blows and three pieces tear away -> falling to Mars -> impact -> ARES wakes alone -> someone arrives -> title.
import * as A from "./audio.js";

const FAIL = 6000, DIVE = 10500, HIT = 15500, WAKE = 18300, COME = 24300, MEET = 27100, TITLE = 30150;   // the beats, in ms
export const CINE_MS = 35150;
const W = 1280, H = 720, K = "#2e1424";
const rnd = (i, s = 1) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
const STARS = Array.from({ length: 260 }, (_, i) => ({ x: rnd(i, 1) * W, y: rnd(i, 2) * H, z: 0.2 + rnd(i, 3) * 0.8, tw: rnd(i, 4) * 6 }));
const ease = (x) => (x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x));
const seg = (t, a, b) => ease((t - a) / (b - a));     // 0..1 progress through [a, b] ms

const LINES = [                                         // [start ms, end ms, text]
  [700, 5400, "A traveller was going home. To a far star."],
  [FAIL + 300, FAIL + 2300, "Then the engine died."],
  [FAIL + 2500, DIVE - 200, "Three pieces tore away."],
  [DIVE + 300, HIT - 600, "Mars pulled him down."],
  [WAKE - 200, COME - 300, "He woke up alone. Broken ship. Three pieces lost."],
  [COME + 200, TITLE - 300, "Then someone came."],
];
const BREAK = [FAIL + 250, FAIL + 1000, FAIL + 1800];   // when each piece tears off
const CUES = [[200, A.whoosh], [500, () => A.engine(5.4)],
  [FAIL, () => { A.boom(0.6); A.powerdown(); }], [FAIL + 500, A.alarm], [FAIL + 1400, A.alarm], [FAIL + 2300, A.alarm], [FAIL + 3200, A.alarm], [FAIL + 4000, A.alarm],
  ...BREAK.map((at) => [at, () => { A.spark(); A.whoosh(); }]),
  [DIVE - 150, () => A.roar((HIT - DIVE + 150) / 1000)],
  [HIT, () => { A.boom(1.3); A.die(); }], [HIT + 260, A.blocked], [HIT + 900, () => A.step("gravel")], [HIT + 1250, () => A.step("slab")], [HIT + 1700, () => A.step("gravel")],
  [WAKE - 900, A.heart], [WAKE - 150, A.heart], [WAKE + 700, () => A.ares(1)], [WAKE + 2900, () => A.ares(3)],
  ...[0, 1, 2, 3, 4, 5].map((k) => [COME + 300 + k * 430, () => A.step(k % 2 ? "gravel" : "dune")]),
  [MEET, () => { A.ares(2); A.pickup(); }], [TITLE - 1500, () => A.riser(1.5)], [TITLE + 250, A.hit], [TITLE + 1100, A.win]];

export function startCine(state) { state.cine = { t0: performance.now(), fired: new Set() }; }

function drawSprite(g, sheet, anim, frame, x, footY, scale, flip = false) {
  const a = sheet.anims[anim], [cw, ch] = sheet.cell, dw = cw * scale, dh = ch * scale;
  g.save(); g.translate(x, footY); if (flip) g.scale(-1, 1);
  g.drawImage(sheet.img, (frame % a.n) * cw, a.row * ch, cw, ch, -dw / 2, -dh, dw, dh); g.restore();
}
const img = (g, im, cx, cy, w, rot = 0) => { const h = (im.height / im.width) * w; g.save(); g.translate(cx, cy); g.rotate(rot); g.drawImage(im, -w / 2, -h / 2, w, h); g.restore(); };
function glow(g, x, y, r, rgb, a) { if (a <= 0 || r <= 0) return; const q = g.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, `rgba(${rgb},${a})`); q.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = q; g.fillRect(x - r, y - r, r * 2, r * 2); }
const cam = (g, zoom, cx, cy) => { g.translate(W / 2, H / 2); g.scale(zoom, zoom); g.translate(-cx, -cy); };   // look at (cx, cy), zoomed

function space(g, t, T) {                               // stars drifting, a far nebula, Mars rising
  g.fillStyle = "#07040c"; g.fillRect(-200, -200, W + 400, H + 400);
  glow(g, 260, 180, 520, "120,60,170", 0.16); glow(g, 900, 120, 420, "40,150,160", 0.1);
  const warp = 1 - seg(t, 0, 1500);                     // arriving: the stars are streaks, then points
  for (const s of STARS) { const x = (s.x - t * (0.02 + warp * 0.5) * s.z + W * 40) % W, a = 0.35 + 0.65 * Math.abs(Math.sin(t / 700 + s.tw));
    g.fillStyle = `rgba(255,${230 + 25 * s.z},${200 + 55 * s.z},${a * s.z})`; g.fillRect(x, s.y, (s.z > 0.8 ? 3 : 2) + warp * 260 * s.z, s.z > 0.8 ? 3 : 2); }
  const rise = seg(t, 0, DIVE), mx = 980, my = 900 - rise * 270, mr = 430;
  glow(g, mx, my, mr * 1.5, "255,110,60", 0.28);
  g.save(); g.beginPath(); g.arc(mx, my, mr, 0, 7); g.clip();
  g.fillStyle = g.createPattern(T.tex[2], "repeat"); g.save(); g.translate(-t * 0.004, 0); g.fillRect(mx - mr, my - mr, mr * 2 + 200, mr * 2); g.restore();
  const sh = g.createRadialGradient(mx - 180, my - 200, 80, mx, my, mr * 1.05); sh.addColorStop(0, "rgba(255,200,150,0.25)"); sh.addColorStop(0.6, "rgba(40,10,20,0.25)"); sh.addColorStop(1, "rgba(10,2,10,0.92)"); g.fillStyle = sh; g.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
  g.restore();
  g.strokeStyle = "rgba(255,170,110,0.35)"; g.lineWidth = 3; g.beginPath(); g.arc(mx, my, mr + 2, Math.PI * 1.05, Math.PI * 1.75); g.stroke();   // thin air, lit at the edge
}
const shipAt = (t) => { const fail = t > FAIL;          // where the ship is, and how it is turned, while it is still in space
  return { x: -220 + seg(t, 0, DIVE) * 900, y: 300 + Math.sin(t / 600) * 14 + (fail ? Math.sin(t / 37) * 7 + seg(t, FAIL, DIVE) * 70 : 0), rot: fail ? Math.sin(t / 90) * 0.06 + seg(t, FAIL, DIVE) * 0.3 : Math.sin(t / 900) * 0.02 }; };

function scene(g, t, T) {
  let shake = 0;
  if (t < DIVE) {                                       // 1-2: cruising, then the engine blows
    const fail = t > FAIL, { x, y, rot } = shipAt(t), close = seg(t, FAIL - 300, FAIL + 700) * (1 - seg(t, DIVE - 900, DIVE));
    cam(g, 1 + seg(t, 0, FAIL) * 0.06 + close * 0.42, W / 2 + (x - W / 2) * close * 0.8, H / 2 + (y - H / 2) * close * 0.8);   // drift in, then cut close to the ship
    space(g, t, T);
    const flick = fail ? (Math.sin(t / 45) > 0.2 ? 0.25 : 1) * (1 - seg(t, FAIL + 1800, FAIL + 3200)) : 1;
    for (let k = 0; k < 16; k++) glow(g, x - 150 - k * 22, y + 26 + Math.sin(t / 80 + k) * 3, 36 - k * 1.6, "79,240,208", 0.36 * flick * (1 - k / 16));
    if (!fail) for (let k = 0; k < 22; k++) { const a = (t / 700 + k / 22) % 1; g.fillStyle = `rgba(160,255,235,${0.7 * (1 - a)})`; g.fillRect(x - 170 - a * 330, y + 22 + (rnd(k, 6) - 0.5) * 26, 3 + (1 - a) * 5, 2); }   // exhaust sparks
    if (fail) for (let k = 0; k < 14; k++) { const a = (t / 900 + k / 14) % 1; g.fillStyle = `rgba(90,70,90,${0.55 * (1 - a)})`; g.beginPath(); g.arc(x - 120 - a * 300, y + 10 - a * 70 + Math.sin(k) * 16, 10 + a * 40, 0, 7); g.fill(); }
    BREAK.forEach((at, k) => { if (t < at) return;      // a piece tears off and tumbles away, burning
      const d = (t - at) / 1000, s = shipAt(at), px = s.x - 40 + k * 50 + (-150 + k * 130) * d, py = s.y + 10 + (k - 1) * 20 + (-90 + k * 85) * d + 40 * d * d;
      for (let j = 0; j < 6; j++) glow(g, px - (-150 + k * 130) * 0.05 * j, py - (-90 + k * 85) * 0.05 * j, 26 - j * 3, "255,150,60", 0.35 * (1 - j / 6));
      img(g, T.items["part" + k], px, py, 74, d * (3 + k) * (k % 2 ? -1 : 1)); });
    img(g, T.items.ship, x, y, 380, rot);
    if (fail) {
      const b = (t - FAIL) / 900;                       // the blast at the engine
      if (b < 1) { glow(g, x - 150, y + 24, 70 + b * 300, "255,240,200", 0.9 * (1 - b)); glow(g, x - 150, y + 24, 40 + b * 180, "255,120,40", 0.8 * (1 - b));
        g.strokeStyle = `rgba(255,220,170,${0.8 * (1 - b)})`; g.lineWidth = 5 * (1 - b) + 1; g.beginPath(); g.arc(x - 150, y + 24, 30 + b * 340, 0, 7); g.stroke(); }
      for (let k = 0; k < 8; k++) if (rnd(Math.floor(t / 70), k) > 0.5) { g.fillStyle = k % 2 ? "#ffd23c" : "#fff"; g.fillRect(x - 80 + rnd(Math.floor(t / 70), k + 9) * 190, y - 36 + rnd(Math.floor(t / 70), k + 5) * 100, 5, 5); }
      if (rnd(Math.floor(t / 110), 3) > 0.6) { g.strokeStyle = "#bff"; g.lineWidth = 2; g.beginPath(); let ex = x - 90, ey = y - 20; g.moveTo(ex, ey); for (let j = 0; j < 5; j++) { ex += 26; ey += (rnd(Math.floor(t / 110), j + 20) - 0.5) * 50; g.lineTo(ex, ey); } g.stroke(); }   // an arc of loose current
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (Math.sin(t / 220) > 0.35) { g.fillStyle = "rgba(255,30,50,0.2)"; g.fillRect(0, 0, W, H); }
      shake = 3 + Math.max(0, 1 - b) * 14; }
  } else if (t < HIT) {                                 // 3: falling through the sky
    const p = seg(t, DIVE, HIT), sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, `rgb(${7 + p * 70},${4 + p * 22},${12 + p * 26})`); sky.addColorStop(1, `rgb(${60 + p * 180},${20 + p * 90},${30 + p * 40})`); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    for (const s of STARS) { g.fillStyle = `rgba(255,240,220,${(1 - p) * s.z})`; g.fillRect(s.x, s.y, 2, 2); }
    const land = seg(t, HIT - 2200, HIT);               // the ground comes up to meet him
    if (land > 0) { const gy = H - land * land * 430; g.save(); g.beginPath(); g.rect(0, gy, W, H - gy); g.clip(); g.translate(W / 2, gy); g.scale(1 + land * 2.2, 0.35 + land * 0.9); g.translate(-W / 2 - t * 0.25, 0);
      g.fillStyle = g.createPattern(T.tex[2], "repeat"); g.fillRect(-W, 0, W * 4, H * 3); g.restore();
      const hz = g.createLinearGradient(0, gy, 0, gy + 160); hz.addColorStop(0, "rgba(255,190,120,0.85)"); hz.addColorStop(1, "rgba(255,190,120,0)"); g.fillStyle = hz; g.fillRect(0, gy, W, 160); }
    for (let k = 0; k < 40; k++) { const a = (t / (200 + rnd(k) * 260) + rnd(k, 2)) % 1; g.fillStyle = `rgba(255,${180 + rnd(k, 3) * 60},120,${0.5 * (1 - a)})`; g.fillRect(rnd(k, 4) * W * 1.4 - a * 620, rnd(k, 5) * H * 1.2 - 60 - a * 380, 100 + rnd(k) * 160, 3); }   // air tearing past
    for (let k = 0; k < 3; k++) { const fx = 420 + k * 260 + p * (k - 1) * 240, fy = -60 + p * (300 + k * 90); for (let j = 0; j < 8; j++) glow(g, fx - j * 16, fy - j * 22, 34 - j * 3, "255,170,70", 0.5 * (1 - j / 8)); img(g, T.items["part" + k], fx, fy, 44, t / 130 + k); }   // the three pieces, falling apart from each other
    const x = 240 + p * 720, y = 110 + p * p * 430, spin = 0.62 + p * 0.5 + Math.sin(t / 60) * 0.05;
    for (let k = 0; k < 20; k++) glow(g, x - k * 36, y - k * 23, 120 - k * 4, k < 6 ? "255,240,190" : "255,120,40", 0.32 * (1 - k / 20));
    img(g, T.items.ship, x, y, 300 + p * 60, spin);
    g.strokeStyle = `rgba(255,245,220,${0.5 + 0.3 * Math.sin(t / 40)})`; g.lineWidth = 7; g.beginPath(); g.arc(x + 40, y + 30, 150, -0.35, 1.9); g.stroke();   // the shock wave ahead of the hull
    glow(g, x + 90, y + 60, 170, "255,250,220", 0.6);
    shake = 6 + p * 14;
  } else {                                              // 4-6: the crater floor
    cam(g, 1.1 - seg(t, HIT, HIT + 2600) * 0.1 + seg(t, WAKE, TITLE) * 0.07, W / 2, H / 2 + 30);   // thrown back by the blast, then slowly closer
    const sky = g.createLinearGradient(0, 0, 0, 420); sky.addColorStop(0, "#3a1830"); sky.addColorStop(0.55, "#a8483c"); sky.addColorStop(1, "#f0a060"); g.fillStyle = sky; g.fillRect(-100, -100, W + 200, 530);
    glow(g, 300, 330, 260, "255,220,170", 0.5); g.fillStyle = "#ffe9c8"; g.beginPath(); g.arc(300, 330, 26, 0, 7); g.fill();              // small, pale Mars sun
    g.fillStyle = "#6e2c34"; g.beginPath(); g.moveTo(-100, 430); for (let x = -100; x <= W + 100; x += 40) g.lineTo(x, 392 - Math.sin(x / 190) * 26 - Math.sin(x / 61) * 9 - (x > 800 ? (x - 800) * 0.09 : 0)); g.lineTo(W + 100, 430); g.fill();   // far crater rim
    g.fillStyle = "#8c3a38"; g.beginPath(); g.moveTo(-100, 440); for (let x = -100; x <= W + 100; x += 40) g.lineTo(x, 416 - Math.sin(x / 130 + 2) * 14); g.lineTo(W + 100, 440); g.fill();
    g.save(); g.translate(-100, 425); g.transform(1, 0, 0, 0.5, 0, 0); g.fillStyle = g.createPattern(T.tex[2], "repeat"); g.fillRect(0, 0, W + 200, 760); g.restore();
    const haze = g.createLinearGradient(0, 425, 0, H); haze.addColorStop(0, "rgba(240,160,96,0.6)"); haze.addColorStop(0.45, "rgba(120,50,50,0.1)"); haze.addColorStop(1, "rgba(30,10,24,0.45)"); g.fillStyle = haze; g.fillRect(-100, 425, W + 200, H - 325);
    const wx = 520, wy = 540, since = t - HIT;
    if (since < 1800) { const b = since / 1800;         // the ring of dust thrown out by the impact
      g.strokeStyle = `rgba(255,225,190,${0.75 * (1 - b)})`; g.lineWidth = 16 * (1 - b) + 2; g.beginPath(); g.ellipse(wx, wy + 30, 60 + b * 900, 18 + b * 250, 0, 0, 7); g.stroke(); }
    for (let k = 0; k < 16; k++) { const d = since / 1000 - rnd(k, 11) * 0.15; if (d < 0 || d > 2.6) continue;   // rock thrown up, falling back
      const vx = (rnd(k, 12) - 0.5) * 520, vy = -520 - rnd(k, 13) * 380, px = wx + vx * d, py = wy - 20 + vy * d + 430 * d * d; if (py > wy + 90) continue;
      g.save(); g.translate(px, py); g.rotate(d * 6 + k); g.fillStyle = k % 3 ? "#5a2630" : "#8c3a38"; g.fillRect(-7, -5, 14 + rnd(k, 14) * 10, 10); g.restore(); }
    for (let k = 0; k < 11; k++) { const a = (t / 2600 + k / 11) % 1; g.fillStyle = `rgba(70,50,70,${0.5 * (1 - a)})`; g.beginPath(); g.arc(wx - 30 + Math.sin(a * 5 + k) * 40 + a * 90, wy - 60 - a * 330, 18 + a * 70, 0, 7); g.fill(); }
    glow(g, wx - 40, wy + 20, 190, "255,120,40", (0.3 + 0.12 * Math.sin(t / 130)) * (1 - seg(t, HIT + 3000, COME)));   // fire in the wreck, dying down
    img(g, T.items.wreck, wx, wy, 520); glow(g, wx + 20, wy + 10, 120, "79,240,208", 0.25 + 0.12 * Math.sin(t / 300));
    for (let k = 0; k < 26; k++) { const a = (t / (2400 + rnd(k, 15) * 2200) + rnd(k, 16)) % 1; g.fillStyle = `rgba(255,${150 + rnd(k, 17) * 90},70,${0.9 * (1 - a) * (1 - seg(t, MEET, TITLE) * 0.5)})`; g.fillRect(wx - 150 + rnd(k, 18) * 300 + Math.sin(a * 7 + k) * 26, wy - 30 - a * 380, 3, 3); }   // embers
    if (since < 6500) for (let k = 0; k < 5; k++) if (rnd(Math.floor(t / 90), k + 30) > 0.72) { g.fillStyle = "#fff"; g.fillRect(wx - 120 + rnd(Math.floor(t / 90), k + 40) * 240, wy - 70 + rnd(Math.floor(t / 90), k + 50) * 90, 4, 4); }
    const dust = 1 - seg(t, HIT, HIT + 4300);           // dust from the impact settles
    for (let k = 0; k < 44; k++) { glow(g, rnd(k, 7) * W, 380 + rnd(k, 8) * 300 - (1 - dust) * 60, 80 + rnd(k, 9) * 170, "232,180,140", 0.42 * dust); }
    if (t > WAKE) {                                     // ARES climbs out and looks around
      const up = seg(t, WAKE, WAKE + 2200), ax = 770, ay = 640 - (1 - up) * 40, met = t > MEET;
      glow(g, ax, ay - 60, 140, met ? "255,207,74" : "79,240,208", 0.32 * up);
      g.globalAlpha = up; drawSprite(g, T.ares, met ? "happy" : t < WAKE + 2600 ? "sad" : t < COME - 100 ? "idle" : "talk", t < WAKE + 2600 ? 4 - Math.min(4, Math.floor((t - WAKE) / 520)) : Math.floor(t / 170), ax, ay - (met ? Math.abs(Math.sin(t / 110)) * 22 : 0), 1.5, t > COME); g.globalAlpha = 1;
    }
    if (t > COME) {                                     // the astronaut walks in, kicking up dust
      const p = seg(t, COME, COME + 2600), x = 1400 - p * 420;
      glow(g, x - 30, 560, 170, "255,245,220", 0.16 + 0.1 * p);                                                     // the lamp on the suit
      if (p < 1) for (let k = 0; k < 5; k++) { const a = ((t - COME) / 430 + k / 5) % 1; g.fillStyle = `rgba(232,180,140,${0.45 * (1 - a)})`; g.beginPath(); g.arc(x + 30 + a * 70, 648 - a * 22, 6 + a * 16, 0, 7); g.fill(); }
      drawSprite(g, T.astro, p < 1 ? "side" : t > MEET + 200 ? "win" : "idle", p < 1 ? Math.floor(t / 90) : t > MEET + 200 ? Math.floor(t / 400) % 2 : Math.floor(t / 260), x, 650 - (p < 1 ? Math.abs(Math.sin(t / 130)) * 14 : 0), 1.25, p < 1);
    }
    shake = (1 - seg(t, HIT, HIT + 2200)) * 26;
  }
  return shake;
}

export function drawCine(g, state, T, onEnd) {
  const t = performance.now() - state.cine.t0;
  for (const [at, fn] of CUES) if (t >= at && !state.cine.fired.has(at)) { state.cine.fired.add(at); fn(); }
  if (t >= CINE_MS) return onEnd();
  g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = true; g.globalAlpha = 1;
  g.fillStyle = "#07040c"; g.fillRect(0, 0, W, H);
  g.save();
  const sh = scene(g, t, T) || 0; g.restore(); g.setTransform(1, 0, 0, 1, 0, 0);
  if (sh) { g.save(); g.globalCompositeOperation = "copy"; g.drawImage(g.canvas, Math.sin(t / 13) * sh, Math.cos(t / 17) * sh); g.restore(); }   // camera shake
  const flash = Math.max(t > HIT ? 1 - seg(t, HIT, HIT + 1300) : seg(t, HIT - 300, HIT), t > FAIL ? (1 - seg(t, FAIL, FAIL + 450)) * 0.8 : 0);   // the blast, and the impact
  if (flash > 0) { g.fillStyle = `rgba(255,250,235,${flash})`; g.fillRect(0, 0, W, H); }
  if (t > TITLE) {                                      // title
    const p = seg(t, TITLE, TITLE + 1200); g.fillStyle = `rgba(18,8,16,${0.8 * p})`; g.fillRect(0, 0, W, H);
    const s = 1 + (1 - ease(Math.min(1, (t - TITLE - 200) / 500))) * 2.2;
    g.save(); g.translate(W / 2, 330); g.scale(s, s); g.textAlign = "center"; g.font = "150px 'Press Start 2P', monospace";
    g.fillStyle = K; g.fillText("ARES", 10, 10); g.fillStyle = "#ffcf4a"; g.fillText("ARES", 0, 0); g.restore();
    if (t > TITLE + 700 && t < TITLE + 1100) { g.fillStyle = `rgba(255,255,255,${1 - (t - TITLE - 700) / 400})`; g.fillRect(0, 0, W, H); }
    g.textAlign = "center"; g.globalAlpha = seg(t, TITLE + 1200, TITLE + 2200);
    g.font = "30px 'Press Start 2P', monospace"; g.fillStyle = "#4ff0d0"; g.fillText("THE MARS SURVIVAL MAP", W / 2, 420);
    g.font = "17px 'Press Start 2P', monospace"; g.fillStyle = "#fff1dc"; g.fillText("Read real NASA data of Mars. Plan the walk.", W / 2, 478);
    g.globalAlpha = seg(t, TITLE + 2100, TITLE + 3100); g.fillStyle = "#ffcf4a"; g.fillText("The right route saves oxygen. It saves lives.", W / 2, 520); g.globalAlpha = 1;
  }
  const v = g.createRadialGradient(W / 2, H / 2, 260, W / 2, H / 2, 820); v.addColorStop(0, "rgba(10,4,10,0)"); v.addColorStop(1, "rgba(10,4,10,0.8)"); g.fillStyle = v; g.fillRect(0, 0, W, H);
  g.fillStyle = "#000"; g.fillRect(0, 0, W, 64); g.fillRect(0, H - 64, W, 64);                                     // letterbox
  const L = LINES.find((l) => t >= l[0] && t < l[1]);
  if (L) { g.globalAlpha = Math.min(1, (L[1] - t) / 500); g.font = "20px 'Press Start 2P', monospace"; g.textAlign = "center";
    const txt = L[2].slice(0, Math.floor((t - L[0]) / 34)); g.fillStyle = "#fff6e6"; g.fillText(txt, W / 2, H - 24); g.globalAlpha = 1; }
  const fade = Math.max(1 - t / 900, seg(t, CINE_MS - 900, CINE_MS)); if (fade > 0) { g.fillStyle = `rgba(0,0,0,${fade})`; g.fillRect(0, 0, W, H); }
}
