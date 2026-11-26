// 3D view: the same game, seen over the real terrain. Nothing here changes the rules — it only draws.
// The ground is a mesh built from the HiRISE elevation model; the painted board is draped over it; a second draped
// layer carries everything the 2D view draws on the ground (route, rover path, glows, layers); characters and
// objects stand on the surface as billboards.
import * as THREE from "./lib/three.module.min.js";

const BOARD = 640;                           // board units across (16 per tile) — same units as the 2D view
export const EXAG = 3.5;                     // vertical exaggeration, so 46 m of real relief reads on screen
let R, scene, cam, H, HN, hScale, ground, veil, veilTex, spr = {}, ready3 = false, look = new THREE.Vector3(320, 0, 320), W = 960;
const v = new THREE.Vector3();

export const ready = () => ready3;

export function heightAt(bx, by) {           // ground height in board units at a board position (bilinear)
  const u = Math.max(0, Math.min(HN - 1.001, (bx / BOARD) * (HN - 1))), w = Math.max(0, Math.min(HN - 1.001, (by / BOARD) * (HN - 1)));
  const x0 = u | 0, y0 = w | 0, fx = u - x0, fy = w - y0, i = y0 * HN + x0;
  return ((H[i] * (1 - fx) + H[i + 1] * fx) * (1 - fy) + (H[i + HN] * (1 - fx) + H[i + HN + 1] * fx) * fy) * hScale;
}

function sprite(image, w) {                  // a billboard standing on its bottom edge, `w` board units wide
  const tex = new THREE.Texture(image); tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.08, depthWrite: false, fog: false }));
  s.center.set(0.5, 0); s.scale.set(w, (image.height / image.width) * w, 1); scene.add(s); return s;
}
function sheetSprite(sheet, scale) {         // a billboard that shows one frame of a character sheet
  const s = sprite(sheet.img, 1), [cw, ch] = sheet.cell;
  s.scale.set(cw * scale, ch * scale, 1); s.userData = { sheet };
  return s;
}
function frame(s, anim, f, flip) {
  const { sheet } = s.userData, a = sheet.anims[anim], [cw, ch] = sheet.cell, iw = sheet.img.width, ih = sheet.img.height, col = f % a.n, t = s.material.map;
  t.repeat.set((flip ? -cw : cw) / iw, ch / ih); t.offset.set(((flip ? col + 1 : col) * cw) / iw, 1 - ((a.row + 1) * ch) / ih);
}
const place = (s, bx, by, lift = 0) => s.position.set(bx, heightAt(bx, by) + lift, by);

// A boulder: a lumpy, faceted stone with a flat underside. Three shapes are enough to stop them looking alike.
function rockShape(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, q = new THREE.Vector3();
  const bump = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 4.7) * 43758.5453; return s - Math.floor(s); };
  for (let i = 0; i < p.count; i++) {                    // the same corner always moves the same way, so faces stay joined
    q.fromBufferAttribute(p, i); const k = 0.72 + 0.5 * bump(Math.round(q.x * 50), Math.round(q.y * 50), Math.round(q.z * 50));
    q.multiplyScalar(k); q.y = Math.max(q.y, -0.25) * 0.85; p.setXYZ(i, q.x, q.y, q.z);
  }
  g.computeVertexNormals(); return g;
}

// Real stones standing on the terrain, exactly where the 2D board paints them (so: where the slope data puts them).
function buildRocks(rocks, image) {
  const tex = new THREE.Texture(image); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(0.55, 0.55); tex.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, flatShading: true });
  const list = [];
  rocks.forEach((r, n) => {                               // a rock wall is a pile; everything else is one stone
    const rnd = (k) => { const s = Math.sin((n + 1) * 91.7 + k * 17.3) * 43758.5453; return s - Math.floor(s); };
    if (!r.wall) return list.push({ x: r.x, z: r.y, s: r.w * 0.5, h: 0.62 + rnd(1) * 0.45, rot: rnd(2) * 6.28, shade: 0.82 + rnd(3) * 0.3 });
    for (let k = 0; k < 4; k++) list.push({ x: r.x + (rnd(k + 4) - 0.5) * 11, z: r.y - 7 + (rnd(k + 9) - 0.5) * 10, s: 5 + rnd(k + 14) * 4.5, h: 0.9 + rnd(k + 19) * 0.9, rot: rnd(k + 24) * 6.28, shade: 0.66 + rnd(k + 29) * 0.26 });
  });
  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  for (let shape = 0; shape < 3; shape++) {
    const mine = list.filter((_, i) => i % 3 === shape), mesh = new THREE.InstancedMesh(rockShape(shape + 1), mat, mine.length);
    mine.forEach((r, i) => {
      pos.set(r.x, heightAt(r.x, r.z) + r.s * 0.12, r.z); quat.setFromAxisAngle(up, r.rot); scl.set(r.s, r.s * r.h, r.s * (0.8 + 0.4 * ((i * 7) % 5) / 5));
      mesh.setMatrixAt(i, m4.compose(pos, quat, scl)); mesh.setColorAt(i, col.setScalar(r.shade));
    });
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
  }
  scene.add(new THREE.HemisphereLight(0xffd9b0, 0x5a2030, 1.15));                       // warm sky, dark red bounce from the ground
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.1); sun.position.set(-260, 420, -220); scene.add(sun);   // upper left, like the painted board
  return list.length;
}

export async function init(T, canvas, art, veilCanvas, rocks = [], rockImage = null) {
  const hm = T.heightmap, buf = await (await fetch(hm.file)).arrayBuffer();
  H = new Uint16Array(buf); HN = hm.size; hScale = ((hm.max_m - hm.min_m) / 65535) * (BOARD / (T.cell_m * T.cols)) * EXAG;
  R = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); R.setPixelRatio(1); R.setSize(W, W, false);
  scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xd08458, 520, 1700);
  cam = new THREE.PerspectiveCamera(38, 1, 2, 4000); cam.position.set(320, 500, 900);

  const geo = new THREE.PlaneGeometry(BOARD, BOARD, HN - 1, HN - 1); geo.rotateX(-Math.PI / 2); geo.translate(BOARD / 2, 0, BOARD / 2);
  const pos = geo.attributes.position; for (let i = 0; i < pos.count; i++) pos.setY(i, H[i] * hScale);
  pos.needsUpdate = true;
  const small = Object.assign(document.createElement("canvas"), { width: 2048, height: 2048 }); small.getContext("2d").drawImage(art, 0, 0, 2048, 2048);
  const map = new THREE.CanvasTexture(small); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = R.capabilities.getMaxAnisotropy();
  ground = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map })); scene.add(ground);   // light is already painted in from the same elevation data
  veilTex = new THREE.CanvasTexture(veilCanvas); veilTex.colorSpace = THREE.SRGBColorSpace;
  veil = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: veilTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  veil.renderOrder = 1; scene.add(veil);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshBasicMaterial({ color: 0x5a2228 })); floor.rotation.x = -Math.PI / 2; floor.position.set(320, -1, 320); scene.add(floor);
  const wall = new THREE.MeshBasicMaterial({ color: 0x4a1c26 });                         // the cut edge of the block of terrain
  for (const [x, z, rot] of [[320, 0, 0], [320, 640, 0], [0, 320, 1], [640, 320, 1]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(640, 2), wall); m.position.set(x, 0, z); m.rotation.y = rot * Math.PI / 2; m.material.side = THREE.DoubleSide; scene.add(m); }

  if (rocks.length && rockImage) console.info(`3D view: ${buildRocks(rocks, rockImage)} stones standing on the terrain`);
  spr.wreck = sprite(T.items.wreck, 46); spr.ship = sprite(T.items.ship, 46); spr.rover = sprite(T.items.rover, 26);
  spr.tanks = [0, 1, 2, 3].map(() => sprite(T.items.tank, 10)); spr.parts = [0, 1, 2].map((k) => sprite(T.items["part" + k], k === 2 ? 20 : 15));
  spr.ares = sheetSprite(T.ares, 0.19 * 0.85); spr.astro = sheetSprite(T.astro, 0.19);
  [spr.ares, spr.astro].forEach((s) => (s.renderOrder = 3)); [spr.wreck, spr.ship, spr.rover, ...spr.tanks, ...spr.parts].forEach((s) => (s.renderOrder = 2));
  ready3 = true;
}

/** Draw one frame. `g` describes where everything is, in board units (the same numbers the 2D view uses). */
export function render(g) {
  veilTex.needsUpdate = true;
  const tile = (i) => [(i % g.cols) * 16 + 8, ((i / g.cols) | 0) * 16 + 8];
  spr.wreck.visible = !g.fixed; spr.ship.visible = g.fixed; place(spr.wreck, ...tile(g.home), -2); place(spr.ship, ...tile(g.home), -2); place(spr.rover, ...tile(g.rover), -1);
  spr.tanks.forEach((s, k) => { const t = g.tanks[k]; s.visible = !!t && !t.done; if (s.visible) place(s, ...tile(t.cell), 1 + Math.sin(g.now / 400 + k)); });
  spr.parts.forEach((s, k) => { const p = g.parts[k]; s.visible = !p.done; if (s.visible) place(s, ...tile(p.cell), 2 + Math.sin(g.now / 350 + k) * 1.5); });
  frame(spr.ares, g.mood, g.mf, false); place(spr.ares, g.aresX, g.aresY, g.aresLift);
  frame(spr.astro, g.pose[0], g.pose[1], g.flip); place(spr.astro, g.ax, g.ay, g.lift);

  // camera: first person (through the visor), third person (behind and above), or pulled back over the whole crater floor
  const tx = g.ax, tz = g.ay, ty = heightAt(tx, tz), first = g.first && g.zoomed;
  spr.astro.visible = !first;                             // in first person you do not see your own body
  if (first) {
    cam.position.lerp(v.set(tx - g.dx * 2, ty + 15 + g.lift * 0.6, tz - g.dz * 2), 0.25);
    look.lerp(new THREE.Vector3(tx + g.dx * 90, ty - 12, tz + g.dz * 90), 0.12);   // eyes slightly down: the ground ahead matters more than the sky
  } else {
    cam.position.lerp(g.zoomed ? v.set(tx, ty + 78, tz + 118) : v.set(320, 520, 960), 0.08);
    look.lerp(g.zoomed ? new THREE.Vector3(tx, ty + 10, tz - 6) : new THREE.Vector3(320, 0, 290), 0.1);
  }
  const fov = first ? 68 : 38; if (Math.abs(cam.fov - fov) > 0.1) { cam.fov += (fov - cam.fov) * 0.12; cam.updateProjectionMatrix(); }
  cam.lookAt(look.x + g.qx, look.y + g.qy, look.z);
  R.render(scene, cam);
}

/** Where a point of the board lands on the 2D canvas (canvas pixels), `up` board units above the ground. */
export function project(bx, by, up = 0) {
  v.set(bx, heightAt(bx, by) + up, by).project(cam);
  return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * W];
}
