import { makeCost, planTour, astar, SLOPE_LIMIT } from "./astar.js";
import { paintBoard, tileKind, TS, ART, TEXTURES } from "./tiles.js";
import * as A from "./audio.js";
import { startCine, drawCine } from "./cine.js";
import * as V3 from "./view3d.js";
import * as KB from "./ares.js";

const TILE = TS;                            // canvas pixels per board tile (40x40 tiles -> 640 px)
const JUMP_MS = 170;                        // one hop
const O2_MARGIN = 1.4;                      // tank = 1.4 x the cost of the optimal tour
const OFF_PENALTY = 1.4;                    // ground off ARES's line burns 40% more oxygen
const IDLE_SECONDS = 720;                   // life support alone empties a full tank in 12 minutes
const TANKS = 4, TANK_REFILL = 0.25;        // spare oxygen canisters, each refills a quarter of the tank
const $ = (id) => document.getElementById(id);
let ctx = $("c").getContext("2d");           // `let`: in 3D mode the ground layer is drawn into `veil` instead, then draped over the terrain
const screen = ctx, VEIL = 1024, veil = Object.assign(document.createElement("canvas"), { width: VEIL, height: VEIL }), veilCtx = veil.getContext("2d");
const BOARD = 640;                          // the board is drawn in these units (16 per tile); the camera scales them to the canvas
const VIEW_TILES = 15;                      // tiles across the screen when zoomed in on the astronaut
const CHAR_SCALE = 0.19;                    // board units per character-sheet pixel (astronaut ~1.7 tiles tall)
// Draw one frame of a character sheet with its feet at board position (x, footY).
function drawChar(g, sheet, anim, frame, x, footY, scale, flip = false) {
  const a = sheet.anims[anim], [cw, ch] = sheet.cell, dw = cw * scale, dh = ch * scale;
  g.save(); g.translate(x, footY); if (flip) g.scale(-1, 1);
  g.drawImage(sheet.img, (frame % a.n) * cw, a.row * ch, cw, ch, -dw / 2, -dh, dw, dh); g.restore();
}

// ---------- board (real data, built by tools/build_tiles.py) ----------
async function loadBoard() {
  // Every file asked for moves the loading bar on, so a slow line shows progress instead of a blank page.
  const STEPS = ["Reading NASA's terrain model of Jezero Crater", "Loading slopes and night heat", "Loading the rover's real track", "Painting the ground", "Waking ARES"];
  const prog = { n: 0, of: 0, top: 0 }, counted = (p) => { prog.of++; return p.finally(() => { prog.n++;
    const f = Math.max(prog.top, (prog.n / Math.max(prog.of, 60)) * 0.96); prog.top = f;   // never runs backwards when more files are asked for
    document.querySelector("#boot i").style.width = `${3 + f * 97}%`; $("bootpct").textContent = `${Math.round(f * 100)}%`; $("bootmsg").textContent = STEPS[Math.min(STEPS.length - 1, Math.floor(f * STEPS.length))]; }); };
  const image = (src) => counted(new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = src; }));
  const json = (src) => counted(fetch(src, { cache: "no-cache" }).then((r) => r.json()));   // always check for a newer data file
  const [pack, img, height, astro, astroMeta, ares, aresMeta, propSizes, tex] = await Promise.all([json("data/board.json"), image("data/board.png"), image("data/height.png"),
    image("assets/astro.png"), json("assets/astro.json"), image("assets/ares.png"), json("assets/ares.json"), json("assets/props/props.json"),
    Promise.all(TEXTURES.map((n) => image(`assets/tex/${n}.png`)))]);
  pack.layers = { slope: await image("data/slope.png"), heat: await image("data/heat.png") };   // clean data maps, built by tools/build_tiles.py
  const props = await Promise.all(propSizes.map((row, r) => Promise.all(row.map((_, c) => image(`assets/props/${r}_${c}.png`)))));
  const names = { wreck: "0_0", ship: "0_1", part0: "2_0", part1: "2_1", part2: "2_3", tank: "2_4", rover: "3_0" }, items = {};
  await Promise.all(Object.entries(names).map(async ([k, f]) => { items[k] = await image(`assets/items/${f}.png`); }));
  const rover = await json("data/rover.json");
  KB.index(await json("data/knowledge.json"));               // what ARES can look up (see ares.js)
  pack.sites = await json("data/sites.json");                // landing sites: the rover's own, and ground no rover has reached
  return { ...pack, img, height, tex, props, items, rover, astro: { img: astro, ...astroMeta }, ares: { img: ares, ...aresMeta } };
}
function overlay(t, colour) {               // one pixel per tile, scaled up when drawn
  const c = Object.assign(document.createElement("canvas"), { width: t.cols, height: t.rows });
  const g = c.getContext("2d"), im = g.createImageData(t.cols, t.rows);
  for (let i = 0; i < t.cols * t.rows; i++) im.data.set(colour(i), i * 4);
  g.putImageData(im, 0, 0); return c;
}
const slopeColour = (t) => (i) => { const s = t.slope[i];
  return s > SLOPE_LIMIT ? [255, 30, 60, 230] : s > 10 ? [255, 140, 30, 200] : s > 5 ? [255, 225, 60, 170] : [60, 220, 130, 150]; };
const thermalColour = (t) => (i) => { const w = 1 - t.soft[i];   // warm at night = rock
  return [30 + 225 * w, 70 + 50 * w, 255 - 225 * w, 200]; };

// What each map button shows: [legend gradient, low label, high label, one-line explanation]
const LAYERS = {
  1: () => ["linear-gradient(90deg,#8c4a66,#ac5454,#c66c48,#dc8a4e,#eeae66)", "LOW", "HIGH", "Drawn from the data: ripples = loose sand, cracked slabs = bedrock, boulders = steep."],
  2: () => ["linear-gradient(90deg,#3e1c64,#b03e78,#d4582c,#f6be32)", "LOW", "HIGH", "The real HiRISE photo of this exact ground."],
  3: (t) => ["linear-gradient(90deg,#4a2a9a,#a0286e,#c83a3a,#e8702a,#f2a83a,#fbe2b0)", t.elev_range_m[0].toFixed(0) + " m", t.elev_range_m[1].toFixed(0) + " m", "Real elevation (HiRISE), with a contour line every 5 m."],
  4: () => ["linear-gradient(90deg,#2e9660,#78c860,#f0d646,#f48c28,#e22c3c)", "0°", `${SLOPE_LIMIT}° and over`, `Real slope (HiRISE). Green is flat. Red is over ${SLOPE_LIMIT}° and cannot be crossed.`],
  5: () => ["linear-gradient(90deg,#282c96,#288ca8,#7e6096,#de8034,#ff5428)", "COLD: SAND", "WARM: ROCK", "Night heat (THEMIS). Cold ground is loose sand, warm ground is solid rock."],
};
function setLayer(n) {
  if (S.layer !== n) A.ui();
  S.layer = n;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", +b.dataset.layer === n));
  if (!T) return;
  const [grad, lo, hi, note] = LAYERS[n](T);
  $("elev").style.background = grad; $("lo").textContent = lo; $("hi").textContent = hi; $("note").textContent = note;
}

// ---------- sprites ----------
function sprite(rows, pal) {
  const c = Object.assign(document.createElement("canvas"), { width: rows[0].length, height: rows.length });
  const g = c.getContext("2d");
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1); } }));
  return c;
}
const K = "#2e1424";                         // dark outline so sprites pop off the ground
const AP = { k: K, w: "#ffffff", W: "#cfd6ea", o: "#ffb02e", g: "#8f96b3", r: "#ff4d6d" };
const ASTRO = [[".kwkkwk.", ".kgkkgk."], ["kwk..kwk", "kgk..kgk"]].map((legs) =>
  sprite([".kkkkkk.", "kwwwwwwk", "kwooooWk", "kwooooWk", "kwwwwwwk", "kwwrrwwk", "kgwwwwgk", ".kwwwwk.", ...legs], AP));
const ARES = [0, 1, 2].map((f) => sprite([".kkkkk.", "kRRRRRk", f === 2 ? "kRRRRRk" : "kRRcCRk", f === 2 ? "kRRkkRk" : "kRRccRk", "krrrrrk", f ? ".kdkdk." : "kdkkkdk"],
  { k: K, r: "#8a4b3a", R: "#c97a52", c: "#4ff0d0", C: "#ffffff", d: "#5c2f26" }));
const SHIP = sprite(["....kkkk....", "..kkbbbbkk..", ".kbbccccbbk.", "kbbbbbbbbbbk", "kmmkmmmmkmmk", ".kk.kkkk.kk."], { k: K, b: "#7de3ff", c: "#ffffff", m: "#8f96b3" });
const PART = sprite([".kkkk.", "kyyyyk", "kyYYyk", "kyYYyk", "kyyyyk", ".kkkk."], { k: K, y: "#ffcf4a", Y: "#ffffff" });
const TANK = sprite([".kkkk.", "kmmmmk", "kcCcck", "kcCcck", "kcCcck", "kcccck", ".kkkk."], { k: K, m: "#8f96b3", c: "#4ff0d0", C: "#ffffff" });
const ROVER = sprite(["......kk....", ".....kwwk...", "......kk....", ".kkkkkkkkkk.", "kwwwwwwwwwwk", "kwgggwwgggwk", ".kkkkkkkkkk.", "kdk.kdk..kdk", ".k...k....k."], { k: K, w: "#f2f2f2", g: "#8f96b3", d: "#5a5f73" });
const DEVIL = [0, 1].map((f) => sprite(f ? ["..ss.s..", ".s..ss..", "..sss...", "...ss...", "..s.s...", "...s...."] : [".s.ss...", "..ss..s.", "...sss..", "...ss...", "...s.s..", "....s..."], { s: "#ffe4b8" }));

// ---------- sound (synthesised in audio.js) ----------
const chirp = (mood = 0) => A.ares(mood);    // ARES speaks in tones
const hop = () => A.jump();

// ---------- state ----------
const S = { state: "title", layer: 1, showRoute: true, auto: false, keys: [] };
let T, cost, slopeLayer, thermalLayer;
const X = (i) => i % T.cols, Y = (i) => (i / T.cols) | 0;
const dist = (a, b) => Math.abs(X(a) - X(b)) + Math.abs(Y(a) - Y(b));
const surface = (i) => ({ dune: "loose sand", slab: "bedrock", gravel: "gravel", cliff: "rock wall" })[tileKind(T, i)];

function nearestPassable(cx, cy, taken = []) {
  for (let r = 0; r < 10; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = cx + dx, y = cy + dy, i = y * T.cols + x;
    if (x >= 0 && y >= 0 && x < T.cols && y < T.rows && cost.passable(i) && !taken.includes(i)) return i;
  }
  return cy * T.cols + cx;
}

function post(cls, who, text, src = "") {
  const p = document.createElement("p"); p.className = cls;
  const b = document.createElement("b"); b.textContent = who + " "; p.append(b, text);
  if (src) { const s = document.createElement("small"); s.textContent = src; p.append(s); }
  $("log").append(p); $("log").scrollTop = $("log").scrollHeight;
}
function say(text, src = "", mood = 0) {
  if (S.type) post("a", "ARES:", S.type.text);                // the previous line moves down into the history
  S.type = { text, src, t0: performance.now() }; $("src").textContent = src;
  chirp(mood); S.talk = performance.now();
  const lines = [""];                                         // the first words also float above ARES on the board
  for (const w of text.split(" ")) { if ((lines[lines.length - 1] + " " + w).trim().length > 22) lines.push(""); lines[lines.length - 1] = (lines[lines.length - 1] + " " + w).trim(); }
  if (lines.length > 3) { lines.length = 3; lines[2] = lines[2].slice(0, 19) + "..."; }
  S.bubble = { lines, t0: performance.now() };
}
const cool = {};
const once = (key, ms, fn) => { const now = performance.now(); if ((cool[key] ?? -1e9) + ms < now) { cool[key] = now; fn(); } };

function replan() {                         // ARES's line: the cheapest, safest tour of the remaining pieces and back to the ship
  const plan = planTour(T, cost, S.cell, S.parts.filter((p) => !p.done).map((p) => p.cell), S.home);
  S.route = plan; S.onRoute = new Set(plan ? plan.path : []); S.ri = 0;   // S.ri: how far along the line you are
  if (!plan) return;
  plan.remain = new Float32Array(plan.path.length);                       // oxygen cost from each point to the end
  for (let k = plan.path.length - 2; k >= 0; k--) plan.remain[k] = plan.remain[k + 1] + cost.step(plan.path[k + 1]);
}

function placeTanks(avoid) {                // spare canisters land on the hardest reachable ground, away from the easy route
  const cand = [];
  for (let i = 0; i < T.slope.length; i++) {
    if (!cost.passable(i) || avoid.has(i) || dist(i, S.home) < 5) continue;
    let near = 99; for (const a of avoid) near = Math.min(near, dist(i, a));
    if (near >= 3 && near <= 9) cand.push(i);
  }
  cand.sort((a, b) => cost.mult(b) - cost.mult(a));
  const out = [];
  for (const i of cand) { if (out.length === TANKS) break;
    if (out.every((o) => dist(o, i) >= 9) && astar(T, cost, S.home, i)) out.push(i); }
  return out.map((cell) => ({ cell, done: false }));
}

const LEVELS = [
  { name: "EASY", line: true, margin: 1.7, bonus: 1, shuffle: false, about: "Green line shown. Plenty of oxygen." },
  { name: "NORMAL", line: true, margin: 1.4, bonus: 1.5, shuffle: true, about: "Green line shown. Tight oxygen. At the rover's site the pieces move each run." },
  { name: "HARD", line: false, margin: 1.5, bonus: 2.5, shuffle: true, about: "No line. Read SLOPE and HEAT yourself." },
];
// What the orbiters can tell about the ground you are standing on (true statements, picked by the tile's real data).
const FACTS = {
  dune: ["Sand here. It loses its heat fast after sunset — that is how the THEMIS camera in orbit tells sand from rock.", "THEMIS night infrared: cold ground = loose sand"],
  slab: ["Solid rock here. It stays warm all night. Your rover drilled this crater floor and found volcanic rock.", "THEMIS night infrared: warm ground = bedrock"],
  gravel: ["Mixed ground. Long ago this crater held a lake. A river built a delta to the west of here.", "Jezero held a lake about 3.5 billion years ago"],
};

function start(level = S.level ?? LEVELS[0]) {
  S.level = level; S.tap = null; S.keys = [];                 // forget keys pressed on the menu or in the intro
  A.unlock(); A.music(true); A.whoosh();
  const site = T.sites.sites[S.siteN ?? 0]; S.site = site;  // where the ship came down: the rover's landing site, or ground no rover has reached
  S.home = nearestPassable(site.x, site.y);
  const NAMES = ["Fuel cell", "Navigation core", "Hull plate"];
  if (site.visited) {                                       // pieces lie at real places where Perseverance stopped and took a photo
    const stops = T.rover.stops.map((s) => ({ ...s, cell: nearestPassable(s.x, s.y) })).filter((s) => dist(s.cell, S.home) >= 5);
    const order = level.shuffle ? stops.map((s) => [Math.random(), s]).sort((a, b) => a[0] - b[0]).map((x) => x[1]) : [...stops].sort((a, b) => dist(a.cell, S.home) - dist(b.cell, S.home));
    S.parts = NAMES.map((name, k) => ({ name, cell: order[k].cell, stop: order[k], done: false }));
  } else S.parts = NAMES.map((name, k) => ({ name, cell: nearestPassable(site.parts[k].x, site.parts[k].y), orbit: site.parts[k], done: false }));   // unvisited ground: only orbital close-ups exist
  S.rover = nearestPassable(22, 21, [S.home, ...S.parts.map((p) => p.cell)]);   // the rover stays where it really landed
  Object.assign(S, { cell: S.home, prev: S.home, jump: null, spent: 0, walked: 0, maxSlope: 0, steps: 0, offSteps: 0, got: 0,
    auto: false, state: "play", face: 1, dir: "down", zoomed: true, view: T.cols, camX: BOARD / 2, camY: BOARD / 2, tracks: [], puffs: [], quake: null, bubble: null, happy: -1e9, lost: null, shake: null, float: null, tanks: [], devil: { x: 30, y: 8, tx: 30, ty: 8 } });
  for (const k in cool) delete cool[k];
  replan();
  S.optimal = S.route ? S.route.cost : 0; S.tank = S.optimal * level.margin;
  S.tanks = placeTanks(S.onRoute);
  // IMPACT: what planning with the data is worth, against simply walking the shortest way and ignoring the ground.
  const naive = planTour(T, { passable: cost.passable, step: () => T.cell_m }, S.cell, S.parts.map((p) => p.cell), S.home);
  const use = (path) => path.slice(1).reduce((sum, i) => sum + cost.step(i), 0), bad = (path) => path.filter((i) => cost.risk(i) > 0).length;
  const odds = (path) => 1 - path.slice(1).reduce((p, i) => p * (1 - cost.risk(i)), 1);
  S.impact = naive && S.route ? { save: 1 - S.optimal / use(naive.path), bad0: bad(naive.path), bad1: bad(S.route.path), odds0: odds(naive.path), odds1: odds(S.route.path),
    m0: (naive.path.length - 1) * T.cell_m, m1: (S.route.path.length - 1) * T.cell_m } : null;
  const I = S.impact;
  $("impact").innerHTML = I ? `<span class="lab">Impact of planning with NASA data &middot; vs the shortest way</span><div class="tiles">
    <div><b>&minus;${(I.save * 100).toFixed(0)}%</b><span>oxygen used</span></div>
    <div><b><s>${I.bad0} &rarr;</s> ${I.bad1}</b><span>danger tiles</span></div>
    <div><b><s>${(I.odds0 * 100).toFixed(0)}% &rarr;</s> ${(I.odds1 * 100).toFixed(0)}%</b><span>accident odds</span></div></div>` : "";
  S.tags = {                                                  // the words written on the map itself (I shows and hides them)
    route: ["ARES'S ROUTE", I ? `A* on NASA slope + heat data \u00b7 ${(I.save * 100).toFixed(0)}% less oxygen` : "A* on NASA slope + heat data"],
    rover: ["PERSEVERANCE'S REAL DRIVE", "Where NASA's rover actually went"],
    part: ["SHIP PIECE  +100", site.visited ? "At a real rover stop" : "Ground no rover has reached"],
    tank: ["AIR TANK  +25% OXYGEN", "On steep or sandy ground"],
    home: ["THE WRECK \u00b7 SHIP COMPUTER", "Bring the 3 pieces here. Press E here: NASA photos + data"] };
  S.tagAt = {};
  if (!level.line) { S.route = null; S.onRoute = new Set(); }   // HARD: ARES gives no line; the layers are your only guide
  S.showRover = SET.rover;
  $("title").style.display = "none"; $("debrief").style.display = "none"; $("how").style.display = "none"; $("photo").style.display = "none"; $("log").textContent = ""; S.type = null;
  say("Friend! ARES was going home. Far star. Ship broke over this crater. Fell here.", "", 2);
  if (!site.visited) say(`No rover ever came here. The nearest track is ${site.far_m} metres away. No photos from the ground. Only eyes from orbit. We read them well.`, `unvisited = more than ${T.sites.unvisited_m} m from NASA's rover traverse`, 1);
  if (level.line) say("Three ship pieces out there. ARES cannot walk far. You walk. Green line = safest way. ARES counted every slope.", "SPACE = follow the line · or jump on your own", 0);
  else say("Three ship pieces out there. ARES is too hurt to plan a way. Read the ground yourself: SLOPE and HEAT. The white dots are where your rover drove.", "keys 4 and 5", 0);
  say("Blue tanks = spare air. They fell on bad ground. Steep or sandy ground can kill.", "", 0);
  if (I) say(level.line ? `Why follow my line? The short way crosses ${I.bad0} danger tiles. Mine crosses ${I.bad1}, and burns ${(I.save * 100).toFixed(0)}% less air. Data saves lives.`
    : `No line today. But know this: a planned way here burns ${(I.save * 100).toFixed(0)}% less air than the short way, and crosses ${I.bad1} danger tiles, not ${I.bad0}. Read the maps.`, "A* on real slope and night-heat data vs the shortest path", 0);
  S.brief = performance.now() + 12000; S.tips = true; S.pop = null; if (SET.start3d !== !!S.mode3d && V3.ready()) toggle3d();   // open on the whole map with the legend showing
  suggest(["Where is the next piece?", "Why follow your route?", "How do you tell sand from rock?", "Why did the rover come here?"]);
  let guided = false; try { guided = !!localStorage.getItem("ares-guided"); } catch { /* private mode */ }
  if (!guided && level.line) startGuide(); else { S.guide = null; $("guide").style.display = "none"; }   // first game: ARES explains the controls
}

function nextDir() {
  const k = S.keys[S.keys.length - 1] ?? S.tap; S.tap = null;   // S.tap: a quick tap released before this frame
  if (k) { S.auto = false; return { ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0], ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1] }[k]; }
  if (S.auto && S.route) {
    const nx = S.route.path[S.ri] === S.cell ? S.route.path[S.ri + 1] : undefined;
    if (nx === undefined) { S.auto = false; return null; }
    return [X(nx) - X(S.cell), Y(nx) - Y(S.cell)];
  }
  return null;
}

function tryJump() {
  const d = nextDir(); if (!d) return;
  const nx = X(S.cell) + d[0], ny = Y(S.cell) + d[1];
  if (d[0]) S.face = d[0];
  S.dir = d[1] > 0 ? "down" : d[1] < 0 ? "up" : "side";
  if (nx < 0 || ny < 0 || nx >= T.cols || ny >= T.rows) return;
  const to = ny * T.cols + nx;
  if (!cost.passable(to)) {
    once("bump", 350, () => A.blocked());
    once("blocked", 2500, () => say(`No no no. Rock wall. ${T.slope[to].toFixed(0)}° slope. Suit falls. Other way.`, `HiRISE DTM — limit is ${SLOPE_LIMIT}°`, 1));
    return;
  }
  S.jump = { from: S.cell, to, t: 0 }; hop();
}

function land(to) {
  const s = T.slope[to], soft = T.soft[to], off = !S.onRoute.has(to), line = S.level.line;
  const burn = cost.step(to) * (off && line ? OFF_PENALTY : 1);   // HARD has no line, so no off-line penalty — only the ground itself
  S.prev = S.cell; S.cell = to; S.steps++; S.spent += burn; S.walked += T.cell_m;
  if (!off) { if (S.route.path[S.ri + 1] === to) S.ri++; else replan(); }   // stepped onto the line somewhere else: ARES redraws it from here
  const harsh = off && (line || cost.risk(to) > 0);          // does this landing deserve a red flash and a jolt?
  A.step(tileKind(T, to)); if (harsh && cost.risk(to) > 0) A.danger();   // sand thuds, rock clicks, gravel crunches
  S.shake = { cell: to, t0: performance.now(), off: harsh };
  S.tracks.push({ cell: to, side: S.dir === "side" }); if (S.tracks.length > 60) S.tracks.shift();
  for (let k = 0; k < 7; k++) S.puffs.push({ x: X(to) * TILE + 8, y: Y(to) * TILE + 14, vx: (Math.random() - 0.5) * 0.03, vy: -Math.random() * 0.012, t0: performance.now(), r: 1 + Math.random() * 1.6 });
  if (harsh) S.quake = { t0: performance.now(), amp: 1 + cost.risk(to) * 40 };   // bad ground shakes the view
  S.float = { text: `-${((burn / S.tank) * 100).toFixed(1)}% O2`, t0: performance.now(), cell: to, off: harsh };
  S.maxSlope = Math.max(S.maxSlope, s);
  if (off) {
    S.offSteps++;
    if (Math.random() < cost.risk(to)) {                    // ground off the line can kill
      const cause = s / SLOPE_LIMIT > soft ? `Slipped on a ${s.toFixed(0)}° slope and tore the suit.` : "Sank into loose sand and could not climb out.";
      return end("dead", cause);
    }
    if (line) once("offpop", 9000, () => (S.pop = { cell: to, t0: performance.now(), colour: "#ff4d6d", lines: ["OFF ARES'S ROUTE", `+${Math.round((OFF_PENALTY - 1) * 100)}% oxygen per jump`, `${(cost.risk(to) * 100).toFixed(0)}% accident odds here`] }));
    if (line) once("off", 14000, () => say(`Off the green line! Air burns ${Math.round((OFF_PENALTY - 1) * 100)}% faster. Here: ${s.toFixed(0)}° slope, ${surface(to)} — ${(cost.risk(to) * 100).toFixed(0)}% death chance each jump.`, "risk grows with slope and loose sand", 1));
    else if (cost.risk(to) > 0) once("bad", 9000, () => say(`Bad ground! ${s.toFixed(0)}° slope, ${surface(to)}. ${(cost.risk(to) * 100).toFixed(0)}% death chance each jump. Check SLOPE.`, "HiRISE DTM + THEMIS", 1));
  }
  const o2 = 1 - S.spent / S.tank;
  if (o2 <= 0) return end("out", "Oxygen ran out before you got back.");
  if (o2 < 0.5) once("o50", 1e9, () => say("Half air left. ARES counts. You count too?", "", 1));
  if (o2 < 0.25) once("o25", 1e9, () => say("Air low! Grab a blue tank or go back to ship. Please, friend.", "", 1));
  const t = S.tanks.find((t) => t.cell === to && !t.done);
  if (t) { t.done = true; S.got++; S.happy = performance.now(); S.spent = Math.max(0, S.spent - TANK_REFILL * S.tank); A.tank(); if (line) replan();
    S.float = { text: `+${TANK_REFILL * 100}% O2`, t0: performance.now(), cell: to, good: true }; say("Air! Breathe, friend. Breathe.", "", 2);
    S.pop = { cell: to, t0: performance.now(), colour: "#4ff0d0", lines: [`+${TANK_REFILL * 100}% OXYGEN  +30`, `worth the ${s.toFixed(0)} deg slope?`] }; }
  for (const p of S.parts) if (!p.done && p.cell === to) {
    p.done = true; if (line) replan(); S.happy = performance.now(); A.pickup();
    const left = S.parts.filter((x) => !x.done).length, [fact, src] = FACTS[tileKind(T, to)] ?? FACTS.gravel;
    say(left ? `${p.name}! Good good good! ${left} more.` : `${p.name}! All three! ARES can fly home! Back to ship!`, "", 2);
    say(fact, `${src} · here: ${s.toFixed(1)}° slope, ${T.elev[to].toFixed(0)} m`, 0);
    S.pop = { cell: to, t0: performance.now(), colour: "#ffcf4a", dx: 150, lines: [`${p.name.toUpperCase()}  +100`, `${left ? left + " more to find" : "all found: go home!"}`, "real NASA photo: bottom left"] };
    if (p.stop) {                                             // the real view from this spot
      $("ptag").textContent = "REAL NASA PHOTO · TAKEN AT THIS SPOT"; $("shot").src = p.stop.img;
      $("cap").textContent = `What Perseverance saw from here — Sol ${p.stop.sol}, ${p.stop.date}. Image: ${p.stop.credit}`;
    } else {                                                  // nobody has stood here: all that exists is the view from orbit
      $("ptag").textContent = "REAL NASA IMAGE FROM ORBIT · NO ROVER HAS BEEN HERE"; $("shot").src = p.orbit.img;
      $("cap").textContent = `HiRISE close-up of this tile, 25 cm per pixel (${p.orbit.lat}° N, ${p.orbit.lon}° E). Nearest rover track: ${p.orbit.far_m} m. THEMIS reads this tile as ${surface(to)} — its pixels are 100 m, so look for what they miss. Image: NASA/JPL-Caltech/Univ. of Arizona`;
    }
    $("photo").style.display = "block"; clearTimeout(S.photoT); S.photoT = setTimeout(() => ($("photo").style.display = "none"), 9000);
  }
  if (to === S.rover) once("rover", 1e9, () => say("Old machine. Yours? It says PERSEVERANCE. It landed right here.", "NASA's rover landed in Jezero Crater on 18 Feb 2021", 0));
  if (to === S.home && S.steps > 2) {
    if (S.parts.every((p) => p.done)) return end("home", "");
    once("early", 8000, () => say("Back already? Pieces still out there. Press E for the ship computer.", "", 0));
  }
}

function end(why, cause) {
  S.state = "end"; S.auto = false; S.jump = null; S.paused = false; $("comp").style.display = "none"; $("hint").style.display = "none"; $("photo").style.display = "none"; $("legend").style.display = "none"; $("toast").style.display = "none"; S.guide = null; $("guide").style.display = "none";
  S.zoomed = why !== "home";                                  // win: pull back to show the whole walk
  S.lost = why === "home" ? null : performance.now();
  const got = S.parts.filter((p) => p.done).length, o2 = Math.max(0, 1 - S.spent / S.tank), L = S.level, R = T.rover.stats;
  const kind = why !== "home" ? ["WORST PATH", cause]
    : got < 3 ? ["SAFE PATH", "You are safe, but ARES is still stranded."]
    : !L.line ? ["EXPLORER PATH", "All pieces with no line to follow. You read Mars yourself."]
    : S.offSteps <= S.steps * 0.1 ? ["BEST-PRACTICE PATH", "All pieces, on ARES's line. ARES goes home."]
    : ["UNEXPECTED PATH", "All pieces — and you survived your own detours."];
  const score = why === "home" ? Math.round((got * 100 + o2 * 300 + S.got * 30) * L.bonus) : got * 50;
  const key = "ares-best-" + L.name + (S.site.visited ? "" : "-" + S.site.id); let best = 0;
  try { best = +localStorage.getItem(key) || 0; if (score > best) localStorage.setItem(key, score); } catch { /* private mode */ }
  if (why === "home" && got === 3) A.win(); else if (why === "home") chirp(0); else A.die();
  A.music(false);
  if (why !== "home") say("No... friend? Friend!", "", 3); else if (got === 3) say("Ship whole again. ARES remembers you. Always.", "", 2);
  $("debrief").innerHTML = `<h1>${kind[0]}</h1><h2>${kind[1]}</h2><table>
    <tr><td>Level</td><td>${L.name}</td></tr>
    <tr><td>Ship parts</td><td>${got} / 3</td></tr>
    <tr><td>Oxygen left</td><td>${(o2 * 100).toFixed(0)}%</td></tr>
    <tr><td>Distance</td><td>${S.walked.toFixed(0)} m</td></tr>
    <tr><td>Oxygen used vs best possible</td><td>${((S.spent + S.got * TANK_REFILL * S.tank) / S.tank * 100).toFixed(0)}% vs ${(S.optimal / S.tank * 100).toFixed(0)}%</td></tr>
    <tr><td>Jumps off the green line</td><td>${S.offSteps} / ${S.steps}</td></tr>
    <tr><td>Steepest slope crossed</td><td>${S.maxSlope.toFixed(1)}&deg;</td></tr>
    <tr><td>Air tanks collected</td><td>${S.got} / ${TANKS}</td></tr>
    <tr><td>SCORE</td><td>${score}${score > best && score ? " NEW BEST!" : best ? ` (best ${best})` : ""}</td></tr></table>
    ${S.impact ? `<div class="why"><b>IMPACT</b> On this walk, planning with NASA's slope and night-heat data instead of taking the shortest way means <b>${(S.impact.save * 100).toFixed(0)}% less oxygen</b>, <b>${S.impact.bad0 - S.impact.bad1} fewer danger tiles</b> and accident odds cut from <b>${(S.impact.odds0 * 100).toFixed(0)}% to ${(S.impact.odds1 * 100).toFixed(0)}%</b>. The same reading of the ground keeps real rovers alive — and will guide the first crews.</div>` : ""}
    <p class="blink">ENTER = MENU</p>
    <small>${S.site.visited ? "" : `UNVISITED GROUND: this walk started ${S.site.far_m} m from the nearest rover track, planned from orbital data alone. No rover has checked this ground; the terrain model was checked where the rover did drive.<br>`}CHECKED AGAINST THE REAL ROVER: Perseverance drove this same ground on sols ${R.drive_sols[0]}–${R.drive_sols[1]}. Its tiles average ${R.rover_mean_slope}&deg; of slope against ${R.board_mean_slope}&deg; for the whole board, and it never crossed a tile over our ${SLOPE_LIMIT}&deg; limit.
    Our terrain model matches the elevations the rover reported to within ${R.dem_vs_rover_elev_std_m} m.<br>
    DATA: MRO HiRISE DTM (USGS) | Mars Odyssey THEMIS night IR and HiRISE mosaic (JPL Mars Trek) | Mars 2020 traverse and Navcam images (NASA/JPL-Caltech)</small>`;
  const won = why === "home" && got === 3;                    // a win holds on the repaired ship for a moment before the scores
  clearTimeout(S.debriefT); S.debriefT = setTimeout(() => { if (S.state === "end") $("debrief").style.display = "flex"; }, won ? 3200 : why === "home" ? 600 : 1800);
}

// ---------- ARES's answers: tools that compute on the NASA data, then retrieval from the knowledge base (see ares.js). No language model. ----------
// The real way from where you stand to a tile: the stretch of the green line if it goes there, otherwise a fresh A* search.
function wayTo(target) {
  if (S.route && S.route.path[S.ri] === S.cell) { const k = S.route.path.indexOf(target, S.ri); if (k >= 0) return { path: S.route.path.slice(S.ri, k + 1), cost: S.route.remain[S.ri] - S.route.remain[k] }; }
  return astar(T, cost, S.cell, target);
}
const pct = (c) => ((c / S.tank) * 100).toFixed(0);
function nearest(cells) {                    // nearest by real walking cost, not by straight-line distance
  let best = null; for (const c of cells) { const w = wayTo(c); if (w && (!best || w.cost < best.cost)) best = { ...w, cell: c }; } return best;
}
// Where a tile is from you, in plain compass words and metres (used for facts about the map, not for walking directions).
function bearing(j) {
  const dx = X(j) - X(S.cell), dy = Y(j) - Y(S.cell), m = Math.round(Math.hypot(dx, dy) * T.cell_m);
  if (!dx && !dy) return "right where you stand";
  const ns = Math.abs(dy) * 2 > Math.abs(dx) ? (dy < 0 ? "north" : "south") : "", ew = Math.abs(dx) * 2 > Math.abs(dy) ? (dx < 0 ? "west" : "east") : "";
  return `${m} m to the ${ns}${ns && ew ? "-" : ""}${ew}`;
}
// Questions about the data itself, answered by measuring the board (every number is computed from the NASA layers, live).
function dataAnswer(q) {
  const n = T.slope.length, pick = (arr, sign) => { let b = 0; for (let j = 1; j < n; j++) if ((arr[j] - arr[b]) * sign > 0) b = j; return b; };
  const share = (f) => ((Array.from({ length: n }, (_, j) => j).filter(f).length / n) * 100).toFixed(0);
  if (/steepest|most steep|worst slope/.test(q)) { const j = pick(T.slope, 1); return [`The steepest tile is ${T.slope[j].toFixed(1)}°, ${bearing(j)}. It is a rock wall: nobody crosses that.`, "HiRISE terrain model, steepest part of each 40 m tile"]; }
  if (/flattest|least steep|gentlest/.test(q)) { const j = pick(T.slope, -1); return [`The flattest tile is ${T.slope[j].toFixed(1)}°, ${bearing(j)}, on ${surface(j)}.`, "HiRISE terrain model"]; }
  if (/highest|tallest|top|peak/.test(q)) { const j = pick(T.elev, 1); return [`The highest ground is ${T.elev[j].toFixed(1)} m, ${bearing(j)}. Heights on Mars are counted from a reference level, so they are negative here.`, "HiRISE terrain model, elevation"]; }
  if (/lowest|deepest|bottom/.test(q)) { const j = pick(T.elev, -1); return [`The lowest ground is ${T.elev[j].toFixed(1)} m, ${bearing(j)}. The whole board spans ${(T.elev_range_m[1] - T.elev_range_m[0]).toFixed(0)} m from low to high.`, "HiRISE terrain model, elevation"]; }
  if (/how much|how many|percent|share|portion|area/.test(q) && /sand|dune|soft/.test(q)) return [`${share((j) => tileKind(T, j) === "dune")}% of the board is loose sand: ground that goes cold at night.`, "THEMIS night infrared"];
  if (/how much|how many|percent|share|portion|area/.test(q) && /rock|bedrock|slab|solid/.test(q)) return [`${share((j) => tileKind(T, j) === "slab")}% of the board is solid rock: ground that stays warm at night.`, "THEMIS night infrared"];
  if (/how many|how much|count|number/.test(q) && /wall|block|impass|cannot cross|no.?go/.test(q)) return [`${T.slope.filter((s) => s > SLOPE_LIMIT).length} of ${n} tiles are steeper than ${SLOPE_LIMIT}° and cannot be crossed.`, "HiRISE terrain model"];
  if (/how many|how much|count|number/.test(q) && /danger|risk|unsafe/.test(q)) return [`${Array.from({ length: n }, (_, j) => j).filter((j) => cost.passable(j) && cost.risk(j) > 0).length} of ${n} tiles are dangerous to step on, and ${T.slope.filter((s) => s > SLOPE_LIMIT).length} more cannot be crossed at all.`, "HiRISE slope + THEMIS night heat"];
  if (/average|mean|typical/.test(q) && /slope|steep/.test(q)) return [`The average slope of the board is ${T.rover.stats.board_mean_slope}°. The tiles the real rover drove on average ${T.rover.stats.rover_mean_slope}°.`, "HiRISE terrain model + NASA rover traverse"];
  if (/how (big|large|wide|long)|size|scale|metre|meter/.test(q) && /map|board|area|tile|this/.test(q)) return [`The board is 1.60 km north to south and 1.52 km east to west: ${T.cols} by ${T.rows} tiles of ${T.cell_m} m. It is centred on the rover's landing site, ${T.center.lat}° N, ${T.center.lon}° E.`, "HiRISE terrain model window"];
  if (/how far|distance|how long/.test(q) && /rover|drove|drive|perseverance/.test(q)) { const P = T.rover.path; let m = 0; for (let k = 1; k < P.length; k++) m += Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]) * T.cell_m;
    return [`Inside this board the rover drove about ${(m / 1000).toFixed(1)} km, between sols ${T.rover.stats.drive_sols[0]} and ${T.rover.stats.drive_sols[1]}, stopping ${T.rover.stats.waypoints} times.`, "NASA Mars 2020 traverse data"]; }
  return null;
}
function reply(q) {
  q = q.toLowerCase();
  if (S.state !== "play") return ["Start a walk first. Then ask me anything about this ground.", "", []];
  const i = S.cell, o2 = Math.max(0, 1 - S.spent / S.tank), left = S.parts.filter((p) => !p.done), SRC = "A* path on real slope and night-heat data";
  const go = (w) => KB.directions(KB.turns(w.path, T.cols));
  const NAV = ["Is it safe around me?", "Do I have enough air?", "Where is the nearest air tank?"], DATA = ["Where is the steepest ground?", "How much of the map is sand?", "Where is the highest point?", "How far did the rover drive?"];
  // 1. navigation: read off the real path
  if (/\b(home|ship|wreck|back|return)\b/.test(q) && !/piece|part|broke|crash|who/.test(q)) { const w = wayTo(S.home);
    return w ? [`To the ship: ${go(w)} It costs ${pct(w.cost)}% air. You have ${(o2 * 100).toFixed(0)}%.`, SRC, NAV] : ["There is no way to the ship from here.", SRC, NAV]; }
  if (/tank|canister|refill/.test(q)) { const w = nearest(S.tanks.filter((t) => !t.done).map((t) => t.cell));
    return w ? [`Nearest air tank: ${go(w)} It costs ${pct(w.cost)}% air to reach and gives back ${TANK_REFILL * 100}%. The ground there is ${T.slope[w.cell].toFixed(0)}° ${surface(w.cell)}: ${(cost.risk(w.cell) * 100).toFixed(0)}% accident odds on the last jump.`, SRC, ["Do I have enough air?", "Where is the next piece?", "Is it safe around me?"]] : ["No air tanks left.", "", NAV]; }
  if (/next|piece|part\b|direction|which way|get to|lead me|guide me/.test(q)) {
    if (!left.length) { const w = wayTo(S.home); return [`All three found. To the ship: ${go(w)} It costs ${pct(w.cost)}% air.`, SRC, NAV]; }
    const w = nearest(left.map((p) => p.cell)), p = left.find((x) => x.cell === w.cell);
    return [`${p.name}: ${go(w)} It costs ${pct(w.cost)}% air. It lies on ${surface(p.cell)}, ${p.stop ? `where the rover stopped on sol ${p.stop.sol}` : `${p.orbit.far_m} m from any rover track`}.`, SRC, ["Is it safe around me?", "Do I have enough air?", "What are the photos I find?"]];
  }
  // 2. your tank and the ground around you
  if (/enough|\b(air|oxygen|o2)\b.*\b(left|have|much)\b|\bhow much (air|oxygen)/.test(q)) { const plan = planTour(T, cost, i, left.map((p) => p.cell), S.home), need = plan ? plan.cost / S.tank : 1;
    return [`You have ${(o2 * 100).toFixed(0)}% air. The cheapest way to finish from here needs ${(need * 100).toFixed(0)}%. ${need < o2 ? `That leaves ${((o2 - need) * 100).toFixed(0)}% spare.` : "That is not enough: take an air tank."}`, "A* tour cost from your tile", ["Where is the nearest air tank?", "Where is the next piece?", "How does the oxygen work?"]]; }
  if (/safe|around me|under me|where i stand|near me|next to me|what am i (standing )?on|\b(steep|slope|ground|surface|high|height|elevation|risk|danger|dangerous)\b.*\b(here|under|my tile|this tile|i am|i'm)\b|\b(here|this tile|my tile)\b.*\b(steep|slope|ground|surface|risk|danger|dangerous)\b/.test(q)) {
    const look = [["up", 0, -1], ["down", 0, 1], ["left", -1, 0], ["right", 1, 0]].map(([name, dx, dy]) => { const x = X(i) + dx, y = Y(i) + dy; if (x < 0 || y < 0 || x >= T.cols || y >= T.rows) return `${name}: edge of the map`;
      const j = y * T.cols + x; return !cost.passable(j) ? `${name}: rock wall, ${T.slope[j].toFixed(0)}°` : `${name}: ${T.slope[j].toFixed(0)}° ${surface(j)}${cost.risk(j) ? `, ${(cost.risk(j) * 100).toFixed(0)}% risk` : ", safe"}`; });
    return [`You stand on ${T.slope[i].toFixed(1)}° ${surface(i)}, at ${T.elev[i].toFixed(0)} m. ${look.join(". ")}.`, "HiRISE slope and elevation, THEMIS night heat, per tile", ["Where is the next piece?", "How do you tell sand from rock?", "How steep can a rover go?"]];
  }
  // 3. measurements of the board
  const d = dataAnswer(q); if (d) return [...d, DATA.filter((x) => x.toLowerCase() !== q).slice(0, 3)];
  // 4. retrieval: the written knowledge base, with this board's live numbers filled in
  const I = S.impact, R = T.rover.stats;
  const hit = KB.retrieve(q, { limit: SLOPE_LIMIT, cell: T.cell_m, pen: Math.round((OFF_PENALTY - 1) * 100), refill: TANK_REFILL * 100, sol0: R.drive_sols[0], sol1: R.drive_sols[1],
    rslope: R.rover_mean_slope, bslope: R.board_mean_slope, dem: R.dem_vs_rover_elev_std_m,
    save: I ? (I.save * 100).toFixed(0) : "?", bad0: I ? I.bad0 : "?", bad1: I ? I.bad1 : "?", odds0: I ? (I.odds0 * 100).toFixed(0) : "?", odds1: I ? (I.odds1 * 100).toFixed(0) : "?" });
  if (hit) return [hit.text, hit.source, hit.next];
  return ["I do not have that in the data I carry, so I will not guess. Ask me about this ground: the slopes, the heat, the heights, the rover, or the way to go.", "", [DATA[0], DATA[1], ...KB.someQuestions(2)]];
}
function ask(q) {                            // one question in, one sourced answer out, plus what to ask next
  post("u", "YOU:", q); const [a, src, next] = reply(q); say(a, src, 0); suggest(next);
}
function suggest(list) {
  const qs = [...new Set([...(list || []), "Where is the next piece?", "Why follow your route?", "How do I know your map is right?", "How much of the map is sand?"])].slice(0, 4);
  $("chips").innerHTML = ""; qs.forEach((t) => { const b = document.createElement("button"); b.textContent = t; b.dataset.q = t; $("chips").append(b); });
}
$("ask").addEventListener("submit", (e) => { e.preventDefault(); const q = $("q").value.trim(); if (!q) return; $("q").value = ""; $("q").blur(); ask(q); });
$("chips").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; b.blur(); ask(b.dataset.q); });

// ---------- the ship's computer: everything NASA has on this ground, in one place (E at the wreck) ----------
function openComp(tab = S.compTab || 0) {
  if (!S.paused) A.ui(); S.paused = true; S.compTab = tab; const R = T.rover.stats, I = S.impact, n = T.slope.length, all = Array.from({ length: n }, (_, j) => j);
  const fig = (src, name, text, flag = "") => `<figure data-src="${src}" data-cap="${`${name} — ${text}`.replace(/"/g, "&quot;")}"><img src="${src}" alt=""><figcaption><b>${name}</b>${text}${flag}</figcaption></figure>`;
  const mark = (p) => (p ? `<br><span class="flag ${p.done ? "got" : ""}">${p.done ? "RECOVERED" : "LIES HERE"}: ${p.name.toUpperCase()}</span>` : "");
  const row = (k, v, src) => `<tr><td>${k}</td><td>${v}<small>${src}</small></td></tr>`, pc = (f) => `${((all.filter(f).length / n) * 100).toFixed(0)}%`;
  let body;
  if (tab === 0) body = S.site.visited
    ? `<p>C:\\NASA\\NAVCAM&gt; ${T.rover.stops.length} real photos Perseverance took on this ground. Click a picture to enlarge it.</p><div class="grid">${T.rover.stops.map((s) => fig(s.img, `SOL ${s.sol} &middot; ${s.date}`, `Perseverance Navcam. ${s.credit}`, mark(S.parts.find((q) => q.stop && q.stop.img === s.img)))).join("")}</div>`
    : `<p>C:\\NASA\\HIRISE&gt; No rover has been here, so there are no photos from the ground. These are NASA's close-ups from orbit. Click a picture to enlarge it.</p><div class="grid">${S.parts.map((p) => fig(p.orbit.img, `${p.orbit.lat}&deg; N, ${p.orbit.lon}&deg; E`, `HiRISE from orbit, 25 cm per pixel. ${p.orbit.far_m} m from any rover track. NASA/JPL-Caltech/Univ. of Arizona`, mark(p))).join("")}</div>`;
  else if (tab === 1) body = `<p>C:\\NASA\\ORBIT&gt; What the orbiters saw of this exact ground. The game is built from these four files.</p><div class="grid four">
      ${fig("data/board.png", "PHOTO", "MRO HiRISE, 25 cm per pixel")}${fig("data/height.png", "HEIGHT", "HiRISE terrain model, contour every 5 m")}
      ${fig("data/slope.png", "SLOPE", `HiRISE terrain model; red is over ${SLOPE_LIMIT}&deg;`)}${fig("data/heat.png", "NIGHT HEAT", "Mars Odyssey THEMIS; cold is sand, warm is rock")}</div>`;
  else if (tab === 2) body = `<p>C:\\NASA\\DATA&gt; Measured live from the NASA layers loaded in this game.</p><table>
      ${row("Window on Mars", `1.60 km &times; 1.52 km, centred on ${T.center.lat}&deg; N, ${T.center.lon}&deg; E`, `${T.cols} &times; ${T.rows} tiles of ${T.cell_m} m`)}
      ${row("Lowest to highest ground", `${T.elev_range_m[0].toFixed(0)} m to ${T.elev_range_m[1].toFixed(0)} m`, "HiRISE terrain model, 1 m per pixel")}
      ${row("Average slope", `${R.board_mean_slope}&deg; on the whole board, ${R.rover_mean_slope}&deg; under the real rover`, "HiRISE terrain model + NASA rover traverse")}
      ${row("Too steep to cross", `${T.slope.filter((s) => s > SLOPE_LIMIT).length} of ${n} tiles are over ${SLOPE_LIMIT}&deg;`, "HiRISE terrain model")}
      ${row("Dangerous to step on", `${all.filter((j) => cost.passable(j) && cost.risk(j) > 0).length} of ${n} tiles`, "HiRISE slope + THEMIS night heat")}
      ${row("Loose sand / solid rock", `${pc((j) => tileKind(T, j) === "dune")} sand, ${pc((j) => tileKind(T, j) === "slab")} rock`, "Mars Odyssey THEMIS night infrared")}
      ${row("Perseverance on this board", `sols ${R.drive_sols[0]} to ${R.drive_sols[1]}, ${R.waypoints} stops`, "NASA Mars 2020 localisation data")}
      ${row("Our heights against the rover's own", `&plusmn;${R.dem_vs_rover_elev_std_m} m at ${R.waypoints} stops`, "terrain model checked against the rover")}</table>`;
  else body = `<p>C:\\ARES\\LOG&gt; This walk so far.</p><table>
      ${row("Landing site", S.site.visited ? "Octavia E. Butler Landing" : S.site.name.split(":")[0], S.site.visited ? "visited by the rover" : `${S.site.far_m} m from any rover track`)}
      ${row("Ship pieces", `${S.parts.filter((p) => p.done).length} of 3 recovered`, "bring them all back here")}
      ${row("Oxygen left", `${(Math.max(0, 1 - S.spent / S.tank) * 100).toFixed(0)}%`, "paused while this computer is open")}
      ${row("Walked", `${S.walked.toFixed(0)} m`, `${S.offSteps} of ${S.steps} jumps off ARES's route`)}
      ${I ? row("Planned route against the shortest way", `${(I.save * 100).toFixed(0)}% less oxygen, danger tiles ${I.bad0} &rarr; ${I.bad1}, accident odds ${(I.odds0 * 100).toFixed(0)}% &rarr; ${(I.odds1 * 100).toFixed(0)}%`, "A* on NASA slope and night-heat data") : ""}</table>
      <p style="margin-top:1em"><button id="compend">END THE MISSION HERE</button></p>`;
  $("comp").innerHTML = `<div class="win"><div class="tb"><span>ARES-OS 1.0 &nbsp;&middot;&nbsp; SHIP COMPUTER &nbsp;&middot;&nbsp; MISSION ARCHIVE</span><button id="compclose" title="Back to the walk (E)">X</button></div>
    <div class="tabs">${["IMAGES", "ORBIT MAPS", "GROUND DATA", "THIS WALK"].map((t, k) => `<button data-tab="${k}" class="${k === tab ? "on" : ""}">${k + 1} ${t}</button>`).join("")}</div>
    <div class="body">${body}</div>
    <div class="sb"><span>OXYGEN PAUSED</span><span>1-4 or arrows: folders &nbsp;&middot;&nbsp; E: back to the walk</span><span>ALL IMAGES AND DATA: NASA</span></div></div>
    <div class="view" id="compview"><div class="tb"><span>IMAGE VIEWER</span><button>X</button></div><img alt=""><div></div></div>`;
  $("comp").style.display = "flex"; document.querySelector("#board .aimark").style.display = "none";   // nothing AI-made is on this screen
  $("comp").onclick = (e) => { const v = $("compview"), t = e.target.closest("[data-tab]"), f = e.target.closest("figure");
    if (e.target.closest("#compview")) v.style.display = "none";
    else if (e.target.closest("#compclose")) closeComp();
    else if (e.target.closest("#compend")) { closeComp(); end("home", ""); }
    else if (t) openComp(+t.dataset.tab);
    else if (f) { v.querySelector("img").src = f.dataset.src; v.lastElementChild.textContent = f.dataset.cap.replace(/&[a-z]+;/g, " "); v.style.display = "flex"; } };
}
// ---------- the first screen: a console that keeps typing why this matters; the numbers count to their real values ----------
const GATE_LINES = [                                    // [headline, the part of it in red, the console line under it]
  ["On Mars, the shortest way ", "can kill you.", "A route planned on NASA's slope and night-heat maps uses 15% less oxygen than the shortest walk."],
  ["One tank of oxygen. ", "No second chance.", "The first people on Mars will walk with a fixed amount of air. Planning is what brings them home."],
  ["The map is real. ", "So is the danger.", "Every tile is 40 metres of the real Jezero Crater, measured from orbit at 1 metre per pixel."],
  ["Every step costs air. ", "Choose it well.", "Steep ground and soft sand burn more oxygen. The data shows both before you take the step."],
  ["A safe route is not luck. ", "It is data.", "Perseverance's real track stays on the ground this map calls safe. 0 of its 93 tiles are too steep."],
  ["NASA mapped this ground. ", "Now walk it.", "Sand goes cold at night. Rock stays warm. That is how you tell them apart from orbit."],
];
function gateFx() {
  const G = $("gate"), big = G.querySelector(".gbig"), sub = G.querySelector(".gsub"), nums = [...G.querySelectorAll(".gstats b")], go = G.querySelector(".blink");
  const t0 = performance.now(), cur = '<i class="cur"></i>', out = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
  const HS = 38, CS = 16, GAP = 300, HOLD = 3400, WIPE = 550;   // ms per letter of the headline and of the console line; the pauses
  const span = (L) => (L[0].length + L[1].length) * HS + GAP + L[2].length * CS + HOLD + WIPE;
  sub.textContent = ""; go.style.visibility = "hidden";
  (function tick() {
    if (S.state !== "gate") return;
    const t = performance.now() - t0, k = (d) => out((t - 1700 - d) / 1500);
    nums[0].textContent = "−" + Math.round(15 * k(0)) + "%";
    nums[1].textContent = "39 → " + Math.round(39 - 31 * k(300));
    nums[2].textContent = "68% → " + Math.round(68 - 50 * k(600)) + "%";
    let e = t, n = 0; while (e >= span(GATE_LINES[n % GATE_LINES.length])) { e -= span(GATE_LINES[n % GATE_LINES.length]); n++; }
    const [a, b, c] = GATE_LINES[n % GATE_LINES.length], hl = a.length + b.length, tH = hl * HS, tC = tH + GAP + c.length * CS;
    let h = hl, m = c.length;                           // how many letters of each are on screen right now
    if (e < tH) { h = Math.floor(e / HS); m = 0; } else if (e < tH + GAP) m = 0; else if (e < tC) m = Math.floor((e - tH - GAP) / CS);
    else if (e > tC + HOLD) { const f = 1 - (e - tC - HOLD) / WIPE; h = Math.floor(hl * f); m = Math.floor(c.length * f); }
    const blink = Math.floor(t / 400) % 2;
    big.innerHTML = a.slice(0, h) + "<b>" + b.slice(0, Math.max(0, h - a.length)) + "</b>" + (m === 0 && h < hl ? cur : "");
    sub.innerHTML = m > 0 || e >= tH ? "<u>&gt;</u> " + c.slice(0, m) + (m < c.length || blink ? cur : "") : "";
    if (n > 0 || e > tH) go.style.visibility = "visible";
    requestAnimationFrame(tick);
  })();
}
// ---------- main menu and settings ----------
const SET = { labels: false, rover: true, start3d: false };
try { Object.assign(SET, JSON.parse(localStorage.getItem("ares-settings") || "{}")); } catch { /* private mode */ }
function paintLevels() { document.querySelectorAll("#levels button").forEach((b) => { const L = LEVELS[+b.dataset.l]; let best = 0; try { best = +localStorage.getItem("ares-best-" + L.name) || 0; } catch { /* private mode */ }
  b.innerHTML = `<b><u>${+b.dataset.l + 1}</u>${L.name}</b><span>${L.about}</span>${best ? `<em>Your best score: ${best}</em>` : `<em class="none">Not played yet</em>`}`; }); }
function paintSet() { const on = (id, v) => { const b = $(id); b.textContent = v ? "ON" : "OFF"; b.classList.toggle("on", !!v); };
  on("set-sound", !A.isMuted()); on("set-full", !!document.fullscreenElement); on("set-3d", SET.start3d); on("set-labels", SET.labels); on("set-rover", SET.rover); }
function menu(v) { S.menu = v; document.querySelectorAll("#title .mv").forEach((e) => e.classList.toggle("on", e.dataset.v === v)); if (v === "play") paintLevels(); if (v === "settings") { $("set-reset").textContent = "RESET"; paintSet(); } }
$("title").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.go) { b.blur(); A.unlock(); A.ui(); return menu(b.dataset.go); }
  if (!b.id.startsWith("set-")) return;
  b.blur(); A.unlock();
  if (b.id === "set-sound") $("snd").textContent = A.toggleMute() ? "SOUND OFF" : "SOUND ON";
  else if (b.id === "set-full") { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); setTimeout(paintSet, 400); }
  else if (b.id === "set-3d") SET.start3d = !SET.start3d; else if (b.id === "set-labels") SET.labels = !SET.labels; else if (b.id === "set-rover") SET.rover = !SET.rover;
  else if (b.id === "set-reset") { try { Object.keys(localStorage).filter((k) => k.startsWith("ares-") && k !== "ares-settings").forEach((k) => localStorage.removeItem(k)); } catch { /* private mode */ } paintSet(); b.textContent = "DONE"; return; }
  try { localStorage.setItem("ares-settings", JSON.stringify(SET)); } catch { /* private mode */ }
  paintSet(); });
// ---------- touch controls: each button is the key it stands for ----------
{ const key = (type, code) => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  $("pad").addEventListener("pointerdown", (e) => { const b = e.target.closest("button"); if (!b) return; e.preventDefault(); A.unlock();
    if (b.dataset.k === "KeyE" && !S.paused && S.cell !== S.home) return say("The ship computer is at the wreck. Walk back to it.", "", 0);
    key("keydown", b.dataset.k); b.dataset.down = "1"; });
  for (const t of ["pointerup", "pointercancel", "pointerleave"]) $("pad").addEventListener(t, (e) => { const b = e.target.closest("button"); if (b && b.dataset.down) { delete b.dataset.down; key("keyup", b.dataset.k); } }, true);
  $("debrief").addEventListener("click", (e) => { if (S.state === "end" && !e.target.closest("button, a")) key("keydown", "Enter"); }); }
$("hint").addEventListener("click", () => { if (S.state === "play" && !S.paused && S.cell === S.home) openComp(); });
function closeComp() { S.paused = false; $("comp").style.display = "none"; document.querySelector("#board .aimark").style.display = ""; }

function update(dt) {
  if (S.state !== "play" || S.paused) return;
  if (!S.jump) tryJump();
  if (S.jump) { S.jump.t += dt / JUMP_MS; if (S.jump.t >= 1) { const to = S.jump.to; S.jump = null; land(to); } }
  if (S.state !== "play") return;
  if (1 - S.spent / S.tank < 0.25) once("heart", 950, () => A.heart());   // low oxygen: you hear your own pulse
  tickGuide();
  if (!S.guide) S.spent += (dt / 1000) * (S.tank / IDLE_SECONDS);   // breathing never stops (but ARES holds the clock while he explains)
  if (S.spent >= S.tank) return end("out", "Oxygen ran out before you got back.");
  const d = S.devil, gap = Math.hypot(d.tx - d.x, d.ty - d.y);   // a dust devil wanders the crater floor (scenery only)
  if (gap < 0.2) { d.tx = 2 + Math.random() * (T.cols - 4); d.ty = 2 + Math.random() * (T.rows - 4); }
  else { d.x += ((d.tx - d.x) / gap) * dt * 0.0012; d.y += ((d.ty - d.y) / gap) * dt * 0.0012; }
  const i = S.cell, o2 = Math.max(0, 1 - S.spent / S.tank);
  $("o2pct").textContent = (o2 * 100).toFixed(0);
  $("o2fill").style.width = o2 * 100 + "%";
  $("o2fill").style.background = o2 < 0.25 ? "var(--bad)" : o2 < 0.5 ? "var(--warn)" : "";
  $("o2fill").style.background = o2 < 0.25 ? "var(--bad)" : o2 < 0.5 ? "var(--warn)" : "var(--o2)";
  $("o2row").classList.toggle("low", o2 < 0.25);
  document.querySelectorAll("#slots i").forEach((el, k) => el.classList.toggle("on", S.parts[k].done));
  document.querySelectorAll("#tanks i").forEach((el, k) => { const t = S.tanks[k]; el.classList.toggle("on", !!t && !t.done); el.classList.toggle("used", !t || t.done); });
  $("slope").textContent = T.slope[i].toFixed(1);
  $("surface").textContent = surface(i).toUpperCase();
  const on = S.onRoute.has(i);
  const pct = (cost.risk(i) * 100).toFixed(0);
  $("risk").textContent = on ? (S.auto ? "FOLLOWING THE LINE" : "ON THE GREEN LINE") : S.level.line ? `OFF THE LINE: O2 x${OFF_PENALTY} · ${pct}% DEATH/JUMP` : +pct ? `DANGER: ${pct}% DEATH/JUMP` : "SAFE GROUND";
  $("risk").style.color = on || (!S.level.line && !+pct) ? "var(--o2)" : "var(--bad)";
  const need = on ? S.route.remain[S.ri] : null;
  $("need").textContent = need === null ? "--" : ((need / S.tank) * 100).toFixed(0);
  $("need").style.color = need !== null && need > S.tank - S.spent ? "var(--bad)" : "var(--ink)";
}

const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };
const WIND = Array.from({ length: 46 }, (_, k) => ({ x: hash(k, 1) % 640, y: hash(k, 2) % 640, v: 0.02 + (hash(k, 3) % 100) / 2500 }));

function draw(now) {
  if (!T || S.state === "title") return;
  const cx = (i) => X(i) * TILE, cy = (i) => Y(i) * TILE, beat = Math.floor(now / 250) % 2;
  let ax = cx(S.cell), ay = cy(S.cell), lift = 0;             // where the astronaut is right now (mid-hop included)
  if (S.jump) { const t = S.jump.t; ax = cx(S.jump.from) + (cx(S.jump.to) - cx(S.jump.from)) * t; ay = cy(S.jump.from) + (cy(S.jump.to) - cy(S.jump.from)) * t; lift = Math.sin(Math.PI * t) * 9; }
  // camera: zoomed in on the astronaut, or the whole board (M)
  const briefing = S.brief > now;                              // the opening briefing: whole map, with labels on it
  if (S.brief && !briefing) { S.brief = 0; S.tips = SET.labels; }
  const zoomedNow = S.zoomed && !briefing;
  S.view += ((zoomedNow ? VIEW_TILES : T.cols) - S.view) * 0.1;
  const span = S.view * TILE, half = span / 2, clamp = (v) => Math.max(half, Math.min(BOARD - half, v));
  S.camX += (clamp(ax + 8) - S.camX) * 0.14; S.camY += (clamp(ay + 8) - S.camY) * 0.14;
  const zoom = $("c").width / span;
  const d3 = S.mode3d && V3.ready();                          // 3D: everything that lies on the ground is drawn flat into `veil`
  $("c3").style.display = d3 ? "block" : "none";
  screen.setTransform(1, 0, 0, 1, 0, 0); screen.clearRect(0, 0, $("c").width, $("c").height);
  let qx = 0, qy = 0;
  if (S.quake) { const age = (now - S.quake.t0) / 260; if (age >= 1) S.quake = null; else { qx = Math.sin(now / 17) * S.quake.amp * (1 - age); qy = Math.cos(now / 13) * S.quake.amp * (1 - age); } }
  if (d3) { ctx = veilCtx; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, VEIL, VEIL); ctx.setTransform(VEIL / BOARD, 0, 0, VEIL / BOARD, 0, 0); }
  else ctx.setTransform(zoom, 0, 0, zoom, -(clamp(S.camX) - half + qx) * zoom, -(clamp(S.camY) - half + qy) * zoom);
  const art = S.layer === 1, base = [null, T.art, T.img, T.height, T.layers.slope, T.layers.heat][S.layer];
  if (!d3 || !art) { ctx.imageSmoothingEnabled = true; ctx.drawImage(base, 0, 0, BOARD, BOARD); }   // in 3D the painted board is already on the mesh
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = S.layer === 2 ? "#0003" : "#00000018"; for (let k = 1; k < T.cols; k++) { ctx.fillRect(k * TILE, 0, 0.5, 640); ctx.fillRect(0, k * TILE, 640, 0.5); }
  if (S.layer === 2) { ctx.fillStyle = "#1a0a14aa";                          // photo / height views: hatch the rock walls
    for (let i = 0; i < T.slope.length; i++) if (T.slope[i] > SLOPE_LIMIT) for (let k = 0; k < TILE; k += 4) ctx.fillRect(cx(i) + k, cy(i) + k, 3, 3); }
  if (S.layer === 1) {                                        // the map is alive: sand glints on the dunes, wind carries dust
    const tick = Math.floor(now / 320);
    ctx.fillStyle = "#fff6d8";
    for (let k = 0; k < 26; k++) { const i = T.dunes[hash(k, tick) % T.dunes.length]; if (i === undefined) break;
      const x = cx(i) + hash(k, tick + 9) % 14 + 1, y = cy(i) + hash(k, tick + 5) % 14 + 1; ctx.fillRect(x, y, 1, 1); if (k % 3 === 0) { ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); } }
    ctx.fillStyle = "#ffe9c8aa";
    for (const p of WIND) { const x = (p.x + now * p.v) % 660 - 10, y = (p.y + now * p.v * 0.28) % 640; ctx.fillRect(x | 0, y | 0, 3, 1); }
  }
  if (S.shake) {                                              // the tile you land on rattles
    const age = (now - S.shake.t0) / 280;
    if (age >= 1) S.shake = null;
    else { const a = (1 - age) * 3, i = S.shake.cell, n = base.width / T.cols, jx = Math.round(Math.sin(now / 11) * a), jy = Math.round(Math.cos(now / 13) * a);
      if (!d3) { ctx.fillStyle = K; ctx.fillRect(cx(i) - 1, cy(i) - 1, TILE + 2, TILE + 2);
        ctx.drawImage(base, X(i) * n, Y(i) * n, n, n, cx(i) + jx, cy(i) + jy, TILE, TILE); }
      ctx.fillStyle = S.shake.off ? `rgba(255,40,60,${0.75 * (1 - age)})` : `rgba(255,255,255,${0.45 * (1 - age)})`; ctx.fillRect(cx(i) + jx, cy(i) + jy, TILE, TILE); }
  }
  S.tracks.forEach((t, k) => {                                // bootprints fade behind you
    ctx.fillStyle = `rgba(46,20,36,${0.42 * ((k + 1) / S.tracks.length)})`;
    const x = cx(t.cell) + 8, y = cy(t.cell) + 11;
    if (t.side) { ctx.fillRect(x - 3, y - 1.5, 2.2, 1.2); ctx.fillRect(x + 1, y + 0.6, 2.2, 1.2); } else { ctx.fillRect(x - 2.2, y - 2, 1.2, 2.2); ctx.fillRect(x + 1, y, 1.2, 2.2); }
  });
  if (S.showRover) {                                          // where Perseverance really drove (NASA localisation data)
    ctx.fillStyle = "#ffffffd0"; const P = T.rover.path;
    for (let k = 0; k < P.length; k += 2) ctx.fillRect(P[k][0] * TILE - 0.6, P[k][1] * TILE - 0.6, 1.2, 1.2);
  }
  if (S.showRoute && S.route) {                               // ARES's line, in green, marching toward the goal
    const p = S.route.path, ph = Math.floor(now / 110);
    const line = (w, colour, dash) => { ctx.fillStyle = colour;
      for (let k = S.ri; k < p.length - 1; k++) { if (dash && (k - ph) % 4) continue; const x1 = cx(p[k]) + 8, y1 = cy(p[k]) + 8, x2 = cx(p[k + 1]) + 8, y2 = cy(p[k + 1]) + 8;
        ctx.fillRect(Math.min(x1, x2) - w / 2, Math.min(y1, y2) - w / 2, Math.abs(x2 - x1) + w, Math.abs(y2 - y1) + w); } };
    line(3, K); line(2, "#39e66b"); line(1, "#d8ffe2", true);
  }
  // painted objects: centred on a tile, standing on its lower edge, `w` board units wide
  const item = (im, i, w, dy = 0) => { if (d3) return shadow(cx(i) + 8, cy(i) + 12, w * 0.42);   // 3D: the object itself is a billboard; here only its shadow
    const h = (im.height / im.width) * w; ctx.drawImage(im, cx(i) + 8 - w / 2, cy(i) + 15 - h + dy, w, h); };
  const shadow = (x, y, r) => { ctx.fillStyle = "rgba(30,10,24,0.38)"; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.45, 0, 0, 7); ctx.fill(); };
  ctx.imageSmoothingEnabled = true;
  item(T.items.rover, S.rover, 26, 2);                        // Perseverance, parked where it really landed
  const fixed = S.state === "end" && !S.lost && S.parts.every((p) => p.done);
  item(fixed ? T.items.ship : T.items.wreck, S.home, 46, 5);  // the wreck — whole again if you bring every piece home
  if (!fixed && !d3) for (let k = 0; k < 4; k++) { const a = ((now / 1300 + k / 4) % 1); ctx.fillStyle = `rgba(210,200,215,${0.55 * (1 - a)})`; ctx.beginPath(); ctx.arc(cx(S.home) + 2 + Math.sin(a * 6 + k) * 2, cy(S.home) + 2 - a * 16, 1 + a * 2.2, 0, 7); ctx.fill(); }
  const glow = (i, rgb, speed) => { const x = cx(i) + 8, y = cy(i) + 8, a = 0.45 + 0.25 * Math.sin(now / speed + i), g = ctx.createRadialGradient(x, y, 1, x, y, 15);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); ctx.fillStyle = g; ctx.fillRect(x - 15, y - 15, 30, 30); };
  for (const t of S.tanks) if (!t.done) { glow(t.cell, "79,240,208", 300); item(T.items.tank, t.cell, 10, -Math.sin(now / 400 + t.cell)); }
  S.parts.forEach((p, k) => { if (!p.done) { glow(p.cell, "255,207,74", 260); item(T.items["part" + k], p.cell, k === 2 ? 20 : 15, -1 - Math.sin(now / 350 + k) * 1.5); } });
  ctx.imageSmoothingEnabled = false;
  if (S.layer === 1 && !d3) { ctx.globalAlpha = 0.75; ctx.drawImage(DEVIL[Math.floor(now / 120) % 2], Math.round(S.devil.x * TILE), Math.round(S.devil.y * TILE) - 4, 16, 12); ctx.globalAlpha = 1; }
  // astronaut hops tile to tile; ARES waits on the tile you just left and reacts to what happens
  ctx.strokeStyle = "#ffffffcc"; ctx.lineWidth = 0.75; ctx.strokeRect(cx(S.jump ? S.jump.to : S.cell) + 0.5, cy(S.jump ? S.jump.to : S.cell) + 0.5, TILE - 1, TILE - 1);
  ctx.imageSmoothingEnabled = true;
  const talking = now - (S.talk ?? -1e9) < 1100, o2 = 1 - S.spent / S.tank;
  const mood = S.lost ? "sad" : now - S.happy < 1600 ? "happy" : !S.onRoute.has(S.cell) ? "alert" : talking ? "talk" : "idle";
  const mf = mood === "sad" ? Math.min(4, Math.floor((now - S.lost) / 260)) : Math.floor(now / 170);
  const ar = S.prev !== S.cell ? S.prev : S.home, ab = mood === "happy" ? Math.abs(Math.sin(now / 90)) * 5 : 0;
  const pose = S.lost ? ["fall", Math.min(4, Math.floor((now - S.lost) / 200))] : S.jump ? [S.dir, S.steps * 2 + Math.floor(S.jump.t * 3)] : o2 < 0.25 ? ["low", Math.floor(now / 300)] : ["idle", Math.floor(now / 260)];
  const chars = [() => drawChar(ctx, T.ares, mood, mf, cx(ar) + 8, cy(ar) + 16 - ab, CHAR_SCALE * 0.85),
    () => drawChar(ctx, T.astro, pose[0], pose[1], ax + 8, ay + 17 - lift, CHAR_SCALE, S.face < 0 && pose[0] !== "up" && pose[0] !== "down")];
  if (cy(ar) > ay) chars.reverse();                           // whoever stands lower on the board is drawn in front
  { const x = cx(ar) + 8, y = cy(ar) + 9, g = ctx.createRadialGradient(x, y, 1, x, y, 13), c = mood === "alert" ? "255,70,70" : "79,240,208";   // ARES glows; red when worried
    g.addColorStop(0, `rgba(${c},0.38)`); g.addColorStop(1, `rgba(${c},0)`); ctx.fillStyle = g; ctx.fillRect(x - 13, y - 13, 26, 26); }
  S.puffs = S.puffs.filter((p) => now - p.t0 < 480);          // dust kicked up by each landing
  for (const p of S.puffs) { const age = now - p.t0; ctx.fillStyle = `rgba(232,190,150,${0.7 * (1 - age / 480)})`; ctx.beginPath(); ctx.arc(p.x + p.vx * age, p.y + p.vy * age, p.r * (1 + age / 300), 0, 7); ctx.fill(); }
  const fixedFlip = S.face < 0 && pose[0] !== "up" && pose[0] !== "down";
  let pin = () => {};                                         // 3D: moves the pen so a board point lands where the camera sees it
  if (!d3) chars.forEach((d) => d());
  else {
    shadow(cx(ar) + 8, cy(ar) + 13, 6); shadow(ax + 8, ay + 14, 6 - lift * 0.25);
    ctx = screen;                                             // ground layer finished: hand it to the 3D view, then draw the HUD on top
    V3.render({ now, cols: T.cols, home: S.home, rover: S.rover, tanks: S.tanks, parts: S.parts, fixed, mood, mf, pose, flip: fixedFlip,
      aresX: cx(ar) + 8, aresY: cy(ar) + 12, aresLift: ab, ax: ax + 8, ay: ay + 12, lift, zoomed: zoomedNow, qx, qy,
      first: S.first, dx: S.dir === "side" ? S.face : 0, dz: S.dir === "up" ? -1 : S.dir === "down" ? 1 : 0 });
    const k = ($("c").width / (VIEW_TILES * TILE)) * 0.8;
    pin = (bx, by, up) => { const [sx, sy] = V3.project(bx, by, up); ctx.setTransform(k, 0, 0, k, sx - k * bx, sy - k * by); };
  }
  if (S.bubble && S.view < 26) {                              // what ARES just said, above his head
    const age = now - S.bubble.t0, L = S.bubble.lines; pin(cx(ar) + 8, cy(ar), 30);
    if (age > 3200) S.bubble = null;
    else { ctx.font = "3px 'Press Start 2P', monospace"; ctx.textAlign = "center";
      const w = Math.max(...L.map((l) => ctx.measureText(l).width)) + 6, h = L.length * 4.6 + 4, bx = Math.max(w / 2 + 2, Math.min(BOARD - w / 2 - 2, cx(ar) + 8)), by = cy(ar) - 9 - h;
      ctx.globalAlpha = Math.min(1, (3200 - age) / 400);
      ctx.fillStyle = K; ctx.fillRect(bx - w / 2 - 0.6, by - 0.6, w + 1.2, h + 1.2); ctx.fillStyle = "#fff6e6"; ctx.fillRect(bx - w / 2, by, w, h);
      ctx.fillRect(bx - 1.5, by + h, 3, 1.5); ctx.fillStyle = K; L.forEach((l, k) => ctx.fillText(l, bx, by + 5.2 + k * 4.6)); ctx.globalAlpha = 1; }
  }
  const face = $("face").getContext("2d"); face.clearRect(0, 0, 184, 120);   // the big portrait shows the same mood
  drawChar(face, T.ares, mood, mf, 92, 119, 1);
  $("hero").className = "card " + (mood === "alert" || mood === "sad" ? "alert" : mood === "happy" ? "happy" : "");
  $("mood").textContent = { idle: "CALM", talk: "TALKING", happy: "HAPPY!", alert: "WORRIED", sad: "NO..." }[mood];
  if (S.type) $("line").textContent = S.type.text.slice(0, Math.floor((now - S.type.t0) / 16));   // typed out letter by letter
  if (S.float) {                                              // oxygen change of the last jump, floating up
    const age = (now - S.float.t0) / 900; pin(cx(S.float.cell) + 8, cy(S.float.cell) + 22, 0);
    if (age >= 1) S.float = null;
    else { ctx.font = "5px 'Press Start 2P', monospace"; ctx.textAlign = "center";
      const tx = Math.max(30, Math.min(610, cx(S.float.cell) + 8)), ty = Math.max(8, cy(S.float.cell) + 22 + age * 6);   // below the feet, clear of ARES's speech bubble
      ctx.fillStyle = K; ctx.fillText(S.float.text, tx + 0.5, ty + 0.5);
      ctx.fillStyle = S.float.good ? "#4ff0d0" : S.float.off ? "#ff5a6e" : "#ffffff"; ctx.fillText(S.float.text, tx, ty); }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // ---- on the map: a named label beside each thing. Labels are placed so that none covers another label or another thing. ----
  const CW = $("c").width, scr = (bx, by, up = 0) => (d3 ? V3.project(bx, by, up) : [(bx - (clamp(S.camX) - half + qx)) * zoom, (by - (clamp(S.camY) - half + qy)) * zoom]);
  const mid = (i) => [cx(i) + 8, cy(i) + 8];
  const LS = Math.max(1, Math.min(2.1, 560 / ($("c").clientWidth || 960))), TF = `700 ${16 * LS}px 'Chakra Petch', sans-serif`, SF = `500 ${14 * LS}px 'Chakra Petch', sans-serif`, tags = [];
  const tag = (key, bx, by, colour, kind, withSub) => { const [px, py] = scr(bx, by, 18); if (px < 12 || py < 12 || px > CW - 12 || py > CW - 12) return;
    tags.push({ key, px, py, colour, title: S.tags[kind][0], sub: withSub && LS < 1.3 ? S.tags[kind][1] : "" }); };
  $("hint").style.display = S.state === "play" && !S.paused && !S.jump && S.cell === S.home && !briefing ? "block" : "none";   // standing at the wreck: the computer is one key away
  $("legend").style.display = briefing && S.state === "play" ? "block" : "none";
  if (S.tips && S.state === "play") {
    if (!(zoomedNow && S.cell === S.home)) tag("home", ...mid(S.home), "#ff7a59", "home", true);   // standing on it: no need to name it
    if (S.route) tag("route", ...mid(S.route.path[Math.min(S.route.path.length - 1, S.ri + Math.max(3, (S.route.path.length - S.ri) >> 3))]), "#39e66b", "route", true);
    if (S.showRover) { const P = T.rover.path, q = P[(P.length * 0.72) | 0]; tag("rover", q[0] * TILE, q[1] * TILE, "#ffffff", "rover", true); }
    S.parts.forEach((part, k) => { if (!part.done) tag("p" + k, ...mid(part.cell), "#ffcf4a", "part", !tags.some((t) => t.key[0] === "p")); });
    S.tanks.forEach((tank, k) => { if (!tank.done) tag("t" + k, ...mid(tank.cell), "#4ff0d0", "tank", !tags.some((t) => t.key[0] === "t")); });
    const [ax, ay] = scr(...mid(S.cell), 18), placed = [], floor = briefing ? CW - 64 : CW - 8, keep = d3 && zoomedNow ? [250, 150, 250, 120] : zoomedNow ? [120, 80, 95, 40] : [26, 26, 44, 20];
    const hits = (x, y, w, h, me) => x < 8 || y < 8 || x + w > CW - 8 || y + h > floor
      || placed.some((b) => x < b.x + b.w + 8 && x + w + 8 > b.x && y < b.y + b.h + 8 && y + h + 8 > b.y)
      || tags.some((t) => t !== me && x < t.px + 16 && x + w > t.px - 16 && y < t.py + 16 && y + h > t.py - 16)
      || (x < ax + keep[1] && x + w > ax - keep[0] && y < ay + keep[3] && y + h > ay - keep[2]);   // and never on the astronaut or ARES
    for (const t of tags) {
      ctx.font = TF; const tw = ctx.measureText(t.title).width; ctx.font = SF; const sw = t.sub ? ctx.measureText(t.sub).width : 0;
      const w = Math.ceil(Math.max(tw, sw)) + 24 * LS, h = (t.sub ? 50 : 30) * LS, spots = [];
      for (const g of [20, 46, 78, 116]) { const d = g * 0.7;
        spots.push([t.px + g, t.py - h / 2], [t.px - g - w, t.py - h / 2], [t.px - w / 2, t.py - g - h], [t.px - w / 2, t.py + g],
          [t.px + d, t.py - d - h], [t.px + d, t.py + d], [t.px - d - w, t.py - d - h], [t.px - d - w, t.py + d]); }
      const was = S.tagAt[t.key]; let n = was !== undefined && !hits(spots[was][0], spots[was][1], w, h, t) ? was : spots.findIndex(([x, y]) => !hits(x, y, w, h, t));
      if (n < 0) continue;                                    // no free place: better no label than one on top of another
      S.tagAt[t.key] = n; const [x, y] = spots[n]; placed.push({ x, y, w, h });
      const ex = Math.max(x, Math.min(x + w, t.px)), ey = Math.max(y, Math.min(y + h, t.py));
      ctx.strokeStyle = t.colour; ctx.lineWidth = 2; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.moveTo(t.px, t.py); ctx.lineTo(ex, ey); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = "#12060d"; ctx.beginPath(); ctx.arc(t.px, t.py, 5.5, 0, 7); ctx.fill(); ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = "#12060dea"; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, 7); else ctx.rect(x, y, w, h); ctx.fill(); ctx.lineWidth = 1.5; ctx.globalAlpha = 0.7; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = t.colour; ctx.fillRect(x, y + 6, 3, h - 12);
      ctx.textAlign = "left"; ctx.font = TF; ctx.fillStyle = t.colour; ctx.fillText(t.title, x + 13 * LS, y + 21 * LS);
      if (t.sub) { ctx.font = SF; ctx.fillStyle = "#ecdccd"; ctx.fillText(t.sub, x + 13 * LS, y + 40 * LS); }
    }
  }
  if (S.state === "play" && !S.tips && S.cell !== S.home) {      // labels off: the wreck still shows where the computer is
    const [hx, hy] = scr(...mid(S.home), 18), txt = "SHIP COMPUTER \u00b7 PRESS E HERE", lift = zoomedNow ? (d3 ? 170 : 92) : 30;
    ctx.font = `700 ${15 * LS}px 'Chakra Petch', sans-serif`; const ph = 28 * LS, w = ctx.measureText(txt).width + 22 * LS, x = Math.max(8, Math.min(CW - 8 - w, hx - w / 2)), y = hy - lift - ph;
    if (hx > 0 && hx < CW && y > 8 && hy < CW) { ctx.globalAlpha = 0.72 + 0.28 * Math.sin(now / 280);
      ctx.fillStyle = "#12060df0"; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, ph, 6); else ctx.rect(x, y, w, ph); ctx.fill(); ctx.strokeStyle = "#4ff0d0"; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hx - 6, y + ph); ctx.lineTo(hx, y + ph + 8); ctx.lineTo(hx + 6, y + ph); ctx.fillStyle = "#4ff0d0"; ctx.fill();
      ctx.textAlign = "left"; ctx.fillText(txt, x + 11 * LS, y + ph * 0.7); ctx.globalAlpha = 1; } }
  if (S.pop && !S.pop.shown) {                               // what just happened and what it was worth: a short note at the top
    S.pop.shown = true; const t = $("toast"); t.style.borderColor = S.pop.colour;
    t.innerHTML = S.pop.lines.map((l, k) => (k ? `<span>${l}</span>` : `<b style="color:${S.pop.colour}">${l}</b>`)).join(""); t.style.display = "block";
  }
  if (S.pop && now - S.pop.t0 > 3800) { S.pop = null; $("toast").style.display = "none"; }
  // screen space: a soft dark frame, redder when oxygen is low
  const W = $("c").width, v = ctx.createRadialGradient(W / 2, W / 2, W * 0.36, W / 2, W / 2, W * 0.74), low = o2 < 0.25 ? 0.5 + 0.2 * Math.sin(now / 200) : 0;
  v.addColorStop(0, "rgba(20,8,18,0)"); v.addColorStop(1, low ? `rgba(150,10,30,${low})` : "rgba(20,8,18,0.6)"); ctx.fillStyle = v; ctx.fillRect(0, 0, W, W);
}

function toggle3d() {                        // same game, other camera: V or the 2D/3D button
  if (!V3.ready()) return say("3D is not ready on this device. Staying in 2D.", "", 1);
  S.mode3d = !S.mode3d; $("cam").style.display = S.mode3d ? "block" : "none"; $("dim").textContent = S.mode3d ? "3D" : "2D"; $("dim").classList.toggle("on", S.mode3d); A.whoosh();
}
$("dim").addEventListener("click", (e) => { e.target.blur(); toggle3d(); });
function toggleCam() {                       // 3D only: through the visor, or behind the astronaut (C or the button)
  if (!S.mode3d) { S.mode3d = false; toggle3d(); if (!S.mode3d) return; }
  S.first = !S.first; $("cam").textContent = S.first ? "1ST PERSON" : "3RD PERSON"; $("cam").classList.toggle("on", S.first); A.whoosh();
}
$("cam").addEventListener("click", (e) => { e.target.blur(); toggleCam(); });

const MOVE = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyA", "KeyD", "KeyW", "KeyS"];
addEventListener("keydown", (e) => {
  if (document.activeElement === $("q")) return;             // typing to ARES
  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  if (e.repeat) return;
  if (MOVE.includes(e.code)) { S.keys.push(e.code); S.tap = e.code; }
  if ((MOVE.includes(e.code) || e.code === "Space") && S.brief) S.brief = 1;   // any move ends the opening briefing
  if (e.code === "KeyI" && S.state === "play") { S.tips = !S.tips; S.brief = 0; }
  A.unlock();
  if (e.code === "KeyN") { $("snd").textContent = A.toggleMute() ? "SOUND OFF" : "SOUND ON"; return; }
  if (S.state === "gate") return openGate();
  if (e.code === "KeyF") { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); return; }
  if (S.state === "video") { if (["Escape", "Enter", "Space"].includes(e.code)) endVideo(); return; }
  if (S.state === "cine") { if (["Escape", "Enter", "Space"].includes(e.code)) endCine(true); return; }
  if (S.state === "intro") { if (e.code === "Escape") nextScene(true); else if (["Enter", "Space", "ArrowRight"].includes(e.code)) nextScene(); return; }
  if (S.paused) { const v = $("compview"), tab = S.compTab || 0;                 // the ship computer is open
    if (v && v.style.display === "flex") v.style.display = "none";
    else if (["KeyE", "Escape", "Enter"].includes(e.code)) closeComp();
    else if (/^Digit[1-4]$/.test(e.code)) openComp(+e.code.slice(-1) - 1);
    else if (e.code === "ArrowRight") openComp((tab + 1) % 4); else if (e.code === "ArrowLeft") openComp((tab + 3) % 4);
    return; }   // the ship computer is open
  if (e.code === "KeyH" && T && S.state === "title") return menu(S.menu === "how" ? "main" : "how");
  if (e.code === "KeyH" && T) { const h = $("how"); h.style.display = h.style.display === "flex" ? "none" : "flex"; return; }
  if (S.state === "end" && e.code === "Enter") { S.state = "title"; $("debrief").style.display = "none"; $("title").style.display = "flex"; return; }
  if (S.state === "title" && T) {                             // the main menu: ESC goes back, ENTER goes on, 1-3 pick a level
    if (e.code === "Escape") return menu("main");
    if (S.menu !== "play") { if (e.code === "Enter") menu("play"); return; }
    if (/^(Digit[1-3]|Enter)$/.test(e.code)) return start(LEVELS[e.code === "Enter" ? 0 : +e.code.slice(-1) - 1]);
    return; }
  if ($("photo").style.display === "block" && MOVE.includes(e.code)) $("photo").style.display = "none";
  if (S.state !== "play") return;
  if (/^Digit[1-5]$/.test(e.code)) setLayer(+e.code.slice(-1));
  if (e.code === "KeyR") S.showRoute = !S.showRoute;
  if (e.code === "KeyM") { S.zoomed = !S.zoomed; A.whoosh(); }
  if (e.code === "KeyV") toggle3d();
  if (e.code === "KeyC") toggleCam();
  if (e.code === "KeyP") S.showRover = !S.showRover;
  if (e.code === "Space") {
    if (!S.level.line) say("ARES cannot plan on HARD. Your eyes, friend. SLOPE and HEAT.", "", 1);
    else { S.auto = !S.auto; if (S.auto) { replan(); S.showRoute = true; say("ARES leads. Easiest ground. Least air.", "A* route: slope + ground softness", 0); } }
  }
  if (e.code === "KeyE" && S.cell === S.home) openComp();
});
$("tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { setLayer(+b.dataset.layer); b.blur(); } });
addEventListener("keyup", (e) => { S.keys = S.keys.filter((k) => k !== e.code); });
addEventListener("blur", () => { S.keys = []; });

// ---------- intro: a short animated "how to play", made from the game's own art ----------
const SCENE_MS = 5200;
const SCENES = [
  { cap: "A traveller from another star has crashed in Jezero Crater, on Mars. His name is ARES.",
    draw(g, t) { const im = T.items.wreck; g.drawImage(im, 150, 150, 340, 340 * im.height / im.width);
      for (let k = 0; k < 5; k++) { const a = (t / 1500 + k / 5) % 1; g.fillStyle = `rgba(210,200,215,${0.5 * (1 - a)})`; g.beginPath(); g.arc(300 + Math.sin(a * 6 + k) * 10, 170 - a * 110, 5 + a * 14, 0, 7); g.fill(); }
      drawChar(g, T.ares, "talk", Math.floor(t / 170), 500, 300 - Math.abs(Math.sin(t / 300)) * 8, 1.1); } },
  { cap: "His ship broke into pieces. Find the 3 lost pieces and bring them back.",
    draw(g, t) { ["part0", "part1", "part2"].forEach((k, n) => { const im = T.items[k], x = 150 + n * 170, y = 190 + Math.sin(t / 350 + n) * 10, w = n === 2 ? 150 : 110, gl = g.createRadialGradient(x, y, 5, x, y, 110);
      gl.addColorStop(0, "rgba(255,207,74,0.55)"); gl.addColorStop(1, "rgba(255,207,74,0)"); g.fillStyle = gl; g.fillRect(x - 110, y - 110, 220, 220); g.drawImage(im, x - w / 2, y - (w * im.height / im.width) / 2, w, w * im.height / im.width); }); } },
  { cap: "Jump tile to tile with the ARROW keys. The green line is the safest way: press SPACE and ARES leads.",
    draw(g, t) { const x = 60 + ((t / SCENE_MS) * 520);
      g.fillStyle = "#2e1424"; g.fillRect(40, 236, 560, 12); g.fillStyle = "#39e66b"; g.fillRect(42, 238, 556, 8);
      g.fillStyle = "#d8ffe2"; for (let k = 0; k < 14; k++) g.fillRect(50 + ((k * 40 + t / 12) % 550), 240, 16, 4);
      drawChar(g, T.astro, "side", Math.floor(t / 90), x, 262 - Math.abs(Math.sin(t / 120)) * 22, 0.75);
      drawChar(g, T.ares, "idle", Math.floor(t / 170), x - 90, 262, 0.7);
      const key = (kx, ky, w, label, on) => { g.fillStyle = "#2e1424"; g.fillRect(kx, ky + 4, w, 34); g.fillStyle = on ? "#4ff0d0" : "#fff6e6"; g.fillRect(kx, ky, w, 34); g.fillStyle = "#2e1424"; g.font = "12px 'Press Start 2P', monospace"; g.textAlign = "center"; g.fillText(label, kx + w / 2, ky + 23); };
      const beat = Math.floor(t / 400) % 4; key(84, 292, 36, "^", beat === 0); key(44, 320, 36, "<", beat === 1); key(84, 320, 36, "v", beat === 2); key(124, 320, 36, ">", beat === 3); key(400, 316, 190, "SPACE", Math.floor(t / 600) % 2 === 0); } },
  { cap: "Watch your oxygen. Steep or sandy ground burns more — and can kill. Blue tanks give you air back.",
    draw(g, t) { const p = t / SCENE_MS, o2 = p < 0.6 ? 1 - p * 1.45 : 0.13 + (p - 0.6) * 1.6, low = o2 < 0.25;
      g.fillStyle = "#2e1424"; g.fillRect(120, 96, 400, 46); g.fillStyle = "#000a"; g.fillRect(126, 102, 388, 34);
      g.fillStyle = low ? "#ff4d6d" : o2 < 0.5 ? "#ffcf4a" : "#4ff0d0"; g.fillRect(126, 102, 388 * Math.max(0, Math.min(1, o2)), 34);
      g.fillStyle = "#fff"; g.font = "16px 'Press Start 2P', monospace"; g.textAlign = "center"; g.fillText("O2 " + Math.round(Math.max(0, Math.min(1, o2)) * 100) + "%", 320, 82);
      drawChar(g, T.astro, low ? "low" : "idle", Math.floor(t / 280), 230, 320, 0.8);
      const im = T.items.tank, s = p > 0.55 ? 1 + Math.sin(t / 120) * 0.06 : 1; g.drawImage(im, 400 - 45 * s, 320 - 121 * s, 90 * s, 121 * s);
      if (low) { g.fillStyle = `rgba(150,10,30,${0.25 + 0.15 * Math.sin(t / 150)})`; g.fillRect(0, 0, 640, 360); } } },
  { cap: "The ground is real. Every slope and sand patch is NASA data of Jezero. The white dots are where the Perseverance rover really drove.",
    draw(g, t) { g.fillStyle = "#2e1424"; g.fillRect(166, 26, 308, 308); g.imageSmoothingEnabled = false; g.drawImage(Math.floor(t / 1700) % 2 ? T.height : T.img, 170, 30, 300, 300); g.imageSmoothingEnabled = true;
      g.fillStyle = "#fff"; const P = T.rover.path, n = Math.floor((t / SCENE_MS) * P.length * 1.3);
      for (let k = 0; k < Math.min(n, P.length); k += 2) g.fillRect(170 + (P[k][0] / T.cols) * 300 - 1, 30 + (P[k][1] / T.rows) * 300 - 1, 2.4, 2.4);
      const im = T.items.rover; g.drawImage(im, 480, 210, 140, 140 * im.height / im.width);
      g.fillStyle = "#4ff0d0"; g.font = "9px 'Press Start 2P', monospace"; g.textAlign = "left"; ["HiRISE", "terrain", "model", "", "THEMIS", "night", "heat"].forEach((s, k) => g.fillText(s, 20, 90 + k * 20)); } },
];
function showIntro() {
  S.state = "intro"; S.scene = 0; S.sceneT = performance.now();
  $("title").style.display = "none"; $("intro").style.display = "flex";
  $("idots").innerHTML = SCENES.map(() => "<i><b></b></i>").join("");
}
function nextScene(skip = false) {
  if (!skip && S.scene < SCENES.length - 1) { S.scene++; S.sceneT = performance.now(); return; }
  S.state = "title"; $("intro").style.display = "none"; $("title").style.display = "flex";
  try { localStorage.setItem("ares-seen-intro", "1"); } catch { /* private mode */ }
}
function drawIntro(now) {
  const t = now - S.sceneT, g = $("iv").getContext("2d"), sc = SCENES[S.scene];
  if (t > SCENE_MS) return nextScene();
  g.fillStyle = g.createPattern(T.tex[4], "repeat"); g.fillRect(0, 0, 640, 360);
  g.fillStyle = "rgba(40,14,30,0.45)"; g.fillRect(0, 0, 640, 360);
  sc.draw(g, t);
  const v = g.createRadialGradient(320, 180, 150, 320, 180, 400); v.addColorStop(0, "rgba(20,8,18,0)"); v.addColorStop(1, "rgba(20,8,18,0.75)"); g.fillStyle = v; g.fillRect(0, 0, 640, 360);
  $("icap").textContent = sc.cap.slice(0, Math.floor(t / 22));
  $("inext").innerHTML = S.scene === SCENES.length - 1 ? "PLAY &#9654;" : "NEXT &#9654;";
  document.querySelectorAll("#idots b").forEach((b, k) => (b.style.width = k < S.scene ? "100%" : k === S.scene ? (t / SCENE_MS) * 100 + "%" : "0"));
}
$("inext").addEventListener("click", () => nextScene()); $("iskip").addEventListener("click", () => nextScene(true)); $("replay").addEventListener("click", (e) => { e.target.blur(); showIntro(); });

// ---------- opening: a start gate (browsers need a click before sound), then the story, then the walk-through video ----------
// Drop a file at game/assets/intro.mp4 (or .webm) and it plays full-screen after the opening story, with a SKIP button.
const seenIntro = () => { try { return !!localStorage.getItem("ares-seen-intro"); } catch { return false; } };
function openGate() {
  A.unlock(); A.ui(); $("gate").style.display = "none";
  document.documentElement.requestFullscreen?.().catch(() => {});   // fill the screen (F toggles it)
  playCine();                                                 // every visit opens with the story
}
// The story has its own score: a recorded track, cut to the picture. It is quiet while the ship cruises, comes in hard when the engine
// blows (6.0 s), falls away at the impact (15.5 s) and returns on the title (30.4 s). The beats in cine.js are set to match it.
const score = new Audio("assets/story.mp3"); score.preload = "auto"; score.volume = 0.9;
function playCine() { S.state = "cine"; $("title").style.display = "none"; $("cine").style.display = "block"; A.music(false); startCine(S);
  if (S.video && !$("vid").src.endsWith(S.video)) { const v = $("vid"); v.preload = "auto"; v.src = S.video; v.load(); }   // the walk-through downloads while the story plays
  score.muted = A.isMuted(); score.currentTime = 0; score.play().catch(() => { /* no sound allowed yet: the pictures still play */ }); }
function endCine(skipped) {                  // the story ran to its end: the walk-through follows. Skipped: straight to the menu.
  $("cine").style.display = "none";
  try { localStorage.setItem("ares-seen-intro", "1"); } catch { /* private mode */ }
  score.pause(); A.music(true);                               // the score belongs to the story only; the game has its own quiet music
  if (skipped === true) A.hush(); else if (S.video) return playVideo();
  S.state = "title"; $("title").style.display = "flex";
}
$("cskip").addEventListener("click", () => endCine(true));
$("watch").addEventListener("click", (e) => { e.target.blur(); A.unlock(); playCine(); });
function playVideo() {
  S.state = "video"; const v = $("vid"); $("video").style.display = "block"; if (!v.src.endsWith(S.video)) v.src = S.video; v.currentTime = 0;
  v.play().catch(() => endVideo());
}
function endVideo() {
  $("vid").pause(); $("video").style.display = "none";
  try { localStorage.setItem("ares-seen-intro", "1"); } catch { /* private mode */ }
  S.state = "title"; $("title").style.display = "flex";
}
$("gate").addEventListener("click", openGate); $("vskip").addEventListener("click", endVideo); $("vid").addEventListener("ended", endVideo);
$("snd").addEventListener("click", () => { A.unlock(); $("snd").textContent = A.toggleMute() ? "SOUND OFF" : "SOUND ON"; });

// ---------- first-run guide: ARES walks you through the controls, one step at a time ----------
const GUIDE = [
  { text: "Press an ARROW key (or WASD) to jump one tile.", done: () => S.steps >= 1 },
  { text: "The green line is the safest way. Press SPACE and ARES leads you along it.", done: () => S.auto },
  { text: "Press M to see the whole map. Press M again to come back.", done: () => S.guide.sawMap && S.zoomed },
  { text: "Press 4 to see the real slopes. Red cannot be crossed. Then press 1 to go back.", done: () => S.guide.sawLayer && S.layer === 1 },
  { text: "That is all! Reach the glowing pieces, grab blue tanks for air, and come home. Good luck!", done: () => performance.now() - S.guide.t0 > 6000 },
];
function startGuide() { S.guide = { step: 0, t0: performance.now(), sawMap: false, sawLayer: false }; $("guide").style.display = "flex"; showGuide(); }
function showGuide() { $("gstep").textContent = `${S.guide.step + 1}/${GUIDE.length}`; $("gtext").textContent = GUIDE[S.guide.step].text; chirp(0); }
function endGuide() { S.guide = null; $("guide").style.display = "none"; try { localStorage.setItem("ares-guided", "1"); } catch { /* private mode */ } }
function tickGuide() {
  if (!S.guide) return;
  if (!S.zoomed) S.guide.sawMap = true; if (S.layer !== 1) S.guide.sawLayer = true;
  if (GUIDE[S.guide.step].done()) { if (++S.guide.step >= GUIDE.length) return endGuide(); S.guide.t0 = performance.now(); showGuide(); }
}
$("gskip").addEventListener("click", (e) => { e.target.blur(); endGuide(); });

let last = performance.now();
function frame(now) {
  $("stage").classList.toggle("lobby", S.state !== "play" && S.state !== "end");   // the side panel belongs to the walk, not to the menu
  if (S.state === "cine") score.muted = A.isMuted();
  if (S.state === "cine") drawCine($("cv").getContext("2d"), S, T, endCine);
  else if (S.state === "intro") drawIntro(now); else if (S.state === "play" || S.state === "end") { update(Math.min(50, now - last)); draw(now); }
  last = now; requestAnimationFrame(frame);
}

loadBoard().then(async (t) => {
  T = t; cost = makeCost(T);
  T.art = paintBoard(T, T.img, T.tex, T.props);
  T.dunes = []; for (let i = 0; i < T.slope.length; i++) if (tileKind(T, i) === "dune") T.dunes.push(i);
  setLayer(1);
  drawChar($("face").getContext("2d"), T.ares, "idle", 0, 92, 119, 1);   // ARES is on the menu too
  const ground3d = paintBoard(T, T.img, T.tex, T.props, true);   // the same board without rocks: in 3D they are real geometry
  V3.init(T, $("c3"), ground3d, veil, ground3d.rocks, T.tex[5]).catch((e) => console.warn("3D view unavailable:", e));   // 2D never depends on this
  const R = T.rover.stats;                                    // the "how it works" page is filled from the real numbers
  $("how").innerHTML = `<h2>HOW IT WORKS</h2>
    <table>
    <tr><td>Slopes, rock walls, ledges, height</td><td>MRO HiRISE terrain model, 1 m/pixel</td></tr>
    <tr><td>Sand or solid rock</td><td>Mars Odyssey THEMIS night infrared</td></tr>
    <tr><td>PHOTO layer</td><td>MRO HiRISE image, 25 cm/pixel</td></tr>
    <tr><td>White dots, photos at each piece</td><td>Perseverance traverse and Navcam</td></tr></table>
    <p>ARES plans with A*:<br>cost = ${T.cell_m} m &times; (1 + 2.5 &times; (slope / ${SLOPE_LIMIT}&deg;)&sup2; + 0.6 &times; sand)<br>Steeper than ${SLOPE_LIMIT}&deg; cannot be crossed. The same cost drains your oxygen.</p>
    <p style="color:var(--o2)">CHECKED AGAINST THE REAL ROVER</p>
    <table>
    <tr><td>Average slope of the rover's tiles</td><td>${R.rover_mean_slope}&deg; (board: ${R.board_mean_slope}&deg;)</td></tr>
    <tr><td>Rover tiles steeper than 10&deg;</td><td>${R.rover_over_10deg_pct}% (board: ${R.board_over_10deg_pct}%)</td></tr>
    <tr><td>Rover tiles over our ${SLOPE_LIMIT}&deg; limit</td><td>${R.rover_over_limit} of ${R.rover_tiles}</td></tr>
    <tr><td>Rover tiles on sand</td><td>${R.rover_sand_pct}% (board: ${R.board_sand_pct}%)</td></tr>
    <tr><td>Our terrain model vs rover elevations</td><td>&plusmn;${R.dem_vs_rover_elev_std_m} m at ${R.waypoints} stops</td></tr></table>
    <small>WHO IT IS FOR: children and students, from about age 10, meeting real space data for the first time; anyone curious how a walk on Mars is planned.<br>
    KEYS: arrows jump · SPACE follow the line · V 2D/3D · M whole map · P rover path · 1-5 layers · F full screen · N sound · I labels · C 3D camera · E ship computer at the wreck<br>
    The story, the oxygen tank, the accident chances and the dust devil are game design, not measurements.<br>The limit and the weights in the cost are our choices. Art was made with AI tools; all terrain data is NASA / USGS.</small>
    <p class="blink">H = CLOSE</p>`;
  // landing-site picker: the rover's own site, or ground no rover has reached
  const pickSite = (n) => { S.siteN = n; document.querySelectorAll("#sites button").forEach((b, k) => b.classList.toggle("on", k === n)); $("siteabout").textContent = T.sites.sites[n].about; };
  $("sites").innerHTML = T.sites.sites.map((s, k) => `<button data-s="${k}"><b>${s.visited ? "Rover's landing site" : s.name.split(":")[0]}</b><span class="${s.visited ? "" : "new"}">${s.visited ? "VISITED BY PERSEVERANCE" : "NEVER VISITED · " + s.far_m + " m from any track"}</span></button>`).join("");
  $("sites").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { b.blur(); A.unlock(); A.ui(); pickSite(+b.dataset.s); } });
  pickSite(0);
  $("levels").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && S.state === "title") { b.blur(); start(LEVELS[+b.dataset.l]); } });
  paintLevels(); $("mhow").innerHTML = $("how").innerHTML.replace(/<p class="blink">[^<]*<\/p>/, "");
  window.__game = { S, T, cost, step: update, reply, draw };    // for debugging and tests: step(ms) advances the game, draw(now) paints a frame
  const crop = new URLSearchParams(location.search).get("crop");   // ?crop=x,y : show the painted board 1:1 from that tile (art review)
  if (crop) { const [x, y] = crop.split(",").map(Number); document.body.innerHTML = ""; document.body.style.overflow = "hidden";
    T.art.style.cssText = `position:absolute;left:${-x * ART}px;top:${-y * ART}px`; document.body.append(T.art); return; }
  if (new URLSearchParams(location.search).has("intro")) { try { localStorage.removeItem("ares-seen-intro"); } catch { /* private mode */ } }   // ?intro shows the opening again
  S.state = "gate"; $("gate").style.display = "flex";
  document.querySelector("#boot i").style.width = "100%"; $("bootpct").textContent = "100%"; $("bootmsg").textContent = "Ready";   // full power, then the loader fades away
  setTimeout(() => { $("boot").classList.add("out"); gateFx(); setTimeout(() => ($("boot").style.display = "none"), 500); }, 450);
  for (const f of ["assets/intro.mp4", "assets/intro.webm"]) {   // is an intro video installed?
    try { const r = await fetch(f, { method: "HEAD" }); if (r.ok && (r.headers.get("content-type") || "").startsWith("video")) { S.video = f; break; } } catch { /* no video */ }
  }
  requestAnimationFrame(frame);
}).catch((e) => { $("boot").style.display = "none"; $("title").innerHTML = "<h2>Could not load terrain data</h2><small>" + e + "</small>"; });
