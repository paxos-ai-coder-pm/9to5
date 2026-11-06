// The team office in 3D (three.js r187, bundled in vendor/three — no download, works offline). It runs the same small
// simulation as the earlier pixel office: everyone has a desk and a place in the lounge, walks the corridors between
// them, and their desk shows what they're doing. Positions use that office's floor plan — x across the room, y from
// the back wall (y = 48) to the front edge (y = 216) — which becomes the 3D floor (x, z); height is the world's y.
import * as THREE from "./vendor/three/three.module.min.js";
import { RoundedBoxGeometry } from "./vendor/three/RoundedBoxGeometry.js";
import { AGENTS, AGENT_BY_ID, AGENT_STATE, taskStatus, taskLabel, fmtDur, esc, modelFor } from "./agents.js";

const W = 384;
const H = 216;
const WALL = 48;
const SPEED = 38; // plan units per second
const ROOM_H = 52; // wall height
const HIP = 6.2; // a teammate's hip height
const SEAT = 5.4; // a chair's seat height

const STATIONS = {
  architect: { dx: 174, dy: 61 },
  manager: { dx: 237, dy: 61 },
  reviewer: { dx: 300, dy: 61 },
  "dev-1": { dx: 36, dy: 122 },
  "dev-2": { dx: 92, dy: 122 },
  "tester-api": { dx: 196, dy: 122 },
  "tester-ui": { dx: 252, dy: 122 },
  "tester-edge": { dx: 308, dy: 122 },
};
const LOUNGE = AGENTS.map((_, i) => ({ x: 60 + i * 16, y: 184 })); // seats on the sofa
const CORRIDORS = [101, 156];
const PASSAGE_X = 162;
const SOFA_END = 194; // the way round the sofa's end, and the walkway in front of it
const SOFA_FRONT = 200;
const SOFA_SEAT = 6.6;
const SCALE = 1.2; // the people a little larger than the furniture, so you can tell who's who
// The plan is wide for a 16:9 picture; in 3D its positions are drawn closer together across the room (the furniture and
// people keep their shapes), so the camera can come in closer.
const SQUEEZE = 0.82;
const X = (x) => 192 + (x - 192) * SQUEEZE;

const still = matchMedia("(prefers-reduced-motion: reduce)");

// deterministic pseudo-random for stable "code" on screens
function rnd(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
const WEBGL = webglAvailable();

// ---------- materials and shapes ----------
const materials = new Map();
function mat(color, { rough = 0.6, metal = 0, basic = false, opacity = 1 } = {}) {
  const key = [color, rough, metal, basic, opacity].join();
  if (!materials.has(key)) {
    const o = { color, transparent: opacity < 1, opacity };
    materials.set(key, basic ? new THREE.MeshBasicMaterial({ ...o, toneMapped: false }) : new THREE.MeshStandardMaterial({ ...o, roughness: rough, metalness: metal }));
  }
  return materials.get(key);
}
const rounded = (w, h, d, r = 0.4) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01));
function mesh(geo, material, x = 0, y = 0, z = 0, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
function canvasTexture(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { canvas, ctx: canvas.getContext("2d"), tex };
}
function roundRect(g, x, y, w, h, r, fill) {
  g.fillStyle = fill;
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

// ---------- a teammate ----------
// Feet on the floor at the origin, facing +z (towards the camera). Limbs hang from pivots so they can swing.
function makePerson(a) {
  const skin = mat(a.skin, { rough: 0.65 });
  const hair = mat(a.hair, { rough: 0.8 });
  const shirt = mat(a.color, { rough: 0.55 });
  const pants = mat(a.pants, { rough: 0.7 });
  const shoe = mat("#1c1e1d", { rough: 0.45 });
  const dark = mat("#1b1b1b", { rough: 0.3 });
  const root = new THREE.Group();
  const limb = (x, y) => {
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    root.add(g);
    return g;
  };
  // legs: a thigh from the hip, and a shin (with the shoe) from the knee
  const knees = [];
  const legs = [-1, 1].map((side) => {
    const g = limb(side * 1.25, HIP);
    g.add(mesh(new THREE.CapsuleGeometry(1.12, 1.0, 6, 16), pants, 0, -1.6, 0));
    const knee = new THREE.Group();
    knee.position.y = -3.1;
    knee.add(mesh(new THREE.CapsuleGeometry(1.02, 1.1, 6, 16), pants, 0, -1.35, 0), mesh(rounded(2.3, 1.3, 3.4, 0.6), shoe, 0, -2.55, 0.7));
    g.add(knee);
    knees.push(knee);
    return g;
  });
  const torso = mesh(new THREE.CapsuleGeometry(2.55, 2, 8, 24), shirt, 0, 9.6, 0);
  torso.scale.z = 0.78;
  root.add(torso, mesh(new THREE.CylinderGeometry(0.9, 0.95, 1.4, 16), skin, 0, 13.4, 0));
  const arms = [-1, 1].map((side) => {
    const g = limb(side * 3.15, 12.4);
    g.rotation.z = side * 0.08;
    g.add(mesh(new THREE.CapsuleGeometry(0.95, 3.4, 6, 12), shirt, 0, -2.65, 0));
    g.add(mesh(new THREE.SphereGeometry(1.05, 16, 12), skin, 0, -5.5, 0));
    return g;
  });
  // a mug in the right hand while on break
  const mug = new THREE.Group();
  mug.add(mesh(new THREE.CylinderGeometry(0.85, 0.75, 1.8, 16), mat("#f4f3ef", { rough: 0.35 }), 0, 0, 0), mesh(new THREE.TorusGeometry(0.5, 0.16, 8, 16), mat("#f4f3ef", { rough: 0.35 }), 0.95, 0, 0));
  mug.position.set(0, -5.6, 1.1);
  mug.visible = false;
  arms[1].add(mug);

  // the head turns from the neck; its parts sit around the head's centre (0, 3.4, 0)
  const head = limb(0, 13.6);
  const C = 3.4;
  head.add(mesh(new THREE.SphereGeometry(3.25, 40, 28), skin, 0, C, 0));
  const eyes = [-1, 1].map((side) => {
    const e = mesh(new THREE.SphereGeometry(0.42, 12, 10), dark, side * 1.15, C + 0.3, 2.98, { cast: false });
    head.add(e);
    return e;
  });
  const smile = mesh(new THREE.TorusGeometry(0.75, 0.13, 8, 20, Math.PI), dark, 0, C - 1.05, 2.98, { cast: false });
  smile.rotation.z = Math.PI;
  head.add(smile);
  const cap = (r, color, tilt, opts) => {
    const m = mesh(new THREE.SphereGeometry(r, 40, 16, 0, Math.PI * 2, 0, Math.PI * 0.52), mat(color, opts), 0, C, 0);
    m.rotation.x = tilt;
    head.add(m);
    return m;
  };
  cap(3.45, a.hair, -0.38, { rough: 0.8 });
  if (a.long) {
    const back = mesh(new THREE.CapsuleGeometry(2.7, 3.2, 6, 20), hair, 0, C - 2.3, -1.25);
    back.scale.z = 0.6;
    head.add(back);
  }
  const ink = mat("#232625", { rough: 0.4 });
  if (a.acc === "hardhat") {
    const hat = mesh(new THREE.SphereGeometry(3.8, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat("#f5b324", { rough: 0.35 }), 0, C + 0.45, 0);
    head.add(hat, mesh(new THREE.CylinderGeometry(4.4, 4.5, 0.35, 40), mat("#e6a516", { rough: 0.4 }), 0, C + 0.5, 0.35), mesh(rounded(0.9, 0.9, 7.2, 0.4), mat("#f7c34a", { rough: 0.35 }), 0, C + 4.05, 0));
  } else if (a.acc === "headphones" || a.acc === "headset") {
    head.add(mesh(new THREE.TorusGeometry(3.65, 0.38, 10, 40, Math.PI), ink, 0, C + 0.2, -0.2));
    for (const side of [-1, 1]) {
      const cup = mesh(new THREE.CylinderGeometry(1.3, 1.3, 1.1, 24), ink, side * 3.5, C, 0);
      cup.rotation.z = Math.PI / 2;
      head.add(cup);
    }
    if (a.acc === "headset") {
      const boom = mesh(new THREE.CylinderGeometry(0.16, 0.16, 4, 8), ink, -2.65, C - 1.55, 1.75);
      boom.rotation.set(0.95, 0, 0.55);
      head.add(boom, mesh(new THREE.SphereGeometry(0.42, 12, 10), mat(a.color, { rough: 0.4 }), -1.2, C - 2.45, 2.85));
    }
  } else if (a.acc === "cap") {
    cap(3.55, "#f1f1ef", -0.12, { rough: 0.6 });
    const brim = mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.3, 24, 1, false, -Math.PI / 2, Math.PI), mat("#d9d9d6", { rough: 0.6 }), 0, C + 0.55, 2.0);
    brim.scale.z = 1.25;
    head.add(brim);
  } else if (a.acc === "glasses") {
    for (const side of [-1, 1]) head.add(mesh(new THREE.TorusGeometry(0.85, 0.15, 8, 28), ink, side * 1.15, C + 0.3, 3.08, { cast: false }));
    head.add(mesh(new THREE.BoxGeometry(0.75, 0.15, 0.15), ink, 0, C + 0.35, 3.2, { cast: false }));
  }
  root.traverse((o) => (o.userData.agent = a.id));
  return { root, legs, knees, arms, head, eyes, mug, yaw: 0, blinkAt: 2000 + rnd(a.id.length) * 4000 };
}

// ---------- a desk: desk, screen, keyboard, a chair in the teammate's colour ----------
function makeStation(id) {
  const { dx, dy } = STATIONS[id];
  const a = AGENT_BY_ID[id];
  const g = new THREE.Group();
  g.position.set(X(dx + 18), 0, dy + 3);
  const top = mat("#f4f2ed", { rough: 0.5 });
  const metal = mat("#212523", { rough: 0.35, metal: 0.3 });
  g.add(mesh(rounded(34, 1.2, 13, 0.5), top, 0, 8.4, 0));
  for (const side of [-1, 1]) g.add(mesh(rounded(1.4, 7.8, 11.5, 0.3), metal, side * 15.4, 3.9, 0));
  // monitor
  const screen = canvasTexture(256, 150);
  const mon = new THREE.Group();
  mon.position.set(0, 9, -3.4);
  mon.add(mesh(rounded(1.2, 4.4, 0.9, 0.3), metal, 0, 2.2, 0), mesh(rounded(5, 0.4, 3.2, 0.2), metal, 0, 0.2, 0.4));
  mon.add(mesh(rounded(17, 10.4, 0.9, 0.5), mat("#1b1e1d", { rough: 0.35 }), 0, 9.4, 0));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(15.8, 9.2), new THREE.MeshBasicMaterial({ map: screen.tex, toneMapped: false }));
  face.position.set(0, 9.4, 0.47);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: "#444" }));
  led.userData.live = true;
  led.position.set(7.7, 4.6, 0.46);
  mon.add(face, led);
  g.add(mon);
  // desk things
  g.add(mesh(rounded(11, 0.5, 3.6, 0.2), mat("#e3e6e2", { rough: 0.5 }), 0, 9.25, 2.6));
  g.add(mesh(rounded(1.6, 0.6, 2.4, 0.28), mat("#e3e6e2", { rough: 0.5 }), 8.2, 9.3, 2.8));
  g.add(mesh(new THREE.CylinderGeometry(0.9, 0.8, 1.8, 16), mat("#f4f3ef", { rough: 0.35 }), 12.6, 9.9, 0.6));
  g.add(mesh(rounded(4, 0.3, 3, 0.1), mat("#f4d35e", { rough: 0.7 }), -11.6, 9.15, 1.6));
  // chair (its back faces the camera: you see who sits there over its top)
  const chair = new THREE.Group();
  chair.position.set(0, 0, 12.5);
  const cushion = mat(a.color, { rough: 0.75 });
  chair.add(mesh(rounded(9, 1.6, 8.5, 0.7), cushion, 0, SEAT - 0.8, 0), mesh(rounded(9, 7.5, 1.4, 0.6), cushion, 0, 9.9, 4.6));
  chair.add(mesh(rounded(0.8, 3.6, 0.8, 0.3), metal, 0, 5.8, 4.3), mesh(new THREE.CylinderGeometry(0.45, 0.45, 3.4, 12), metal, 0, 2.3, 0));
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2;
    const spoke = mesh(rounded(0.7, 0.5, 4.2, 0.2), metal, Math.sin(ang) * 2, 0.75, Math.cos(ang) * 2);
    spoke.rotation.y = ang;
    chair.add(spoke, mesh(new THREE.SphereGeometry(0.5, 10, 8), metal, Math.sin(ang) * 4, 0.5, Math.cos(ang) * 4));
  }
  g.add(chair);
  // what the pointer finds when it's over this desk (the desk itself is merged into the room)
  const hit = new THREE.Mesh(new THREE.BoxGeometry(36, 26, 32), new THREE.MeshBasicMaterial());
  hit.position.set(0, 13, 6);
  hit.visible = false;
  hit.userData = { live: true, agent: id };
  g.add(hit);
  return { group: g, screen, led, hit, key: "" };
}

// ---------- merging what never moves ----------
// small things (books, keyboards, wheels, eyes) cast no shadow: you'd never see it, and it halves the shadow work
const small = (m) => {
  if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
  return m.geometry.boundingSphere.radius * Math.max(...m.getWorldScale(new THREE.Vector3()).toArray()) < 2.4;
};
function mergeGeometries(meshes) {
  const parts = meshes.map((m) => {
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    return g.index ? g : g.setIndex([...Array(g.attributes.position.count).keys()]);
  });
  const nv = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const ni = parts.reduce((n, g) => n + g.index.count, 0);
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const idx = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + vo;
    vo += g.attributes.position.count;
    io += ia.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
function mergeStatic(scene) {
  scene.updateMatrixWorld(true);
  const groups = new Map();
  scene.traverse((o) => {
    if (!o.isMesh || o.userData.live) return;
    const cast = o.castShadow && !small(o);
    const key = o.material.uuid + (cast ? "c" : "") + (o.receiveShadow ? "r" : "");
    if (!groups.has(key)) groups.set(key, { material: o.material, cast, receive: o.receiveShadow, meshes: [] });
    groups.get(key).meshes.push(o);
  });
  for (const { material, cast, receive, meshes } of groups.values()) {
    const merged = new THREE.Mesh(mergeGeometries(meshes), material);
    merged.castShadow = cast;
    merged.receiveShadow = receive;
    for (const m of meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    scene.add(merged);
  }
}

// ---------- the room ----------
function plankTexture() {
  const { ctx: g, tex } = canvasTexture(1024, 512);
  g.fillStyle = "#dcc6a2";
  g.fillRect(0, 0, 1024, 512);
  for (let row = 0; row < 16; row++) {
    const y = row * 32;
    g.fillStyle = `rgba(${row % 2 ? "120,84,40" : "255,250,240"},0.05)`;
    g.fillRect(0, y, 1024, 32);
    g.fillStyle = "rgba(80,56,30,0.16)";
    g.fillRect(0, y + 31, 1024, 1);
    for (let x = (row % 4) * 96; x < 1024; x += 384) g.fillRect(x, y, 1.5, 31);
  }
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 4);
  return tex;
}

function makeRoom(scene) {
  const wall = mat("#e5ebe4", { rough: 0.9 });
  const white = mat("#f6f5f1", { rough: 0.5 });
  const oak = mat("#c9a378", { rough: 0.65 });
  const dark = mat("#232826", { rough: 0.45 });
  // floor slab, walls
  const floor = mesh(new THREE.PlaneGeometry(322, 172), new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.75 }), 192, 0, 132, { cast: false });
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor, mesh(new THREE.BoxGeometry(322, 4, 172), mat("#b89d76", { rough: 0.8 }), 192, -2.01, 132, { cast: false }));
  scene.add(mesh(new THREE.BoxGeometry(330, ROOM_H, 4), wall, 192, ROOM_H / 2, 46), mesh(new THREE.BoxGeometry(322, 2, 0.8), white, 192, 1, 48.4));
  for (const x of [31, 353]) scene.add(mesh(new THREE.BoxGeometry(4, ROOM_H, 172), wall, x, ROOM_H / 2, 132));

  // window, with the sky behind it (drawn live: clouds drift past)
  const sky = canvasTexture(256, 128);
  scene.add(mesh(rounded(56, 32, 1.6, 0.4), white, 76, 22, 48.8));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(51, 27), new THREE.MeshBasicMaterial({ map: sky.tex, toneMapped: false }));
  glass.position.set(76, 22, 49.7);
  scene.add(glass, mesh(new THREE.BoxGeometry(1.1, 27, 0.8), white, 76, 22, 49.9), mesh(new THREE.BoxGeometry(51, 1.1, 0.8), white, 76, 22, 49.9), mesh(rounded(60, 1.2, 3.6, 0.4), white, 76, 5.4, 50.2));

  // bookshelf
  const shelf = new THREE.Group();
  shelf.position.set(126, 0, 52.5);
  shelf.add(mesh(new THREE.BoxGeometry(42, 34, 1), oak, 0, 17, -4));
  for (const x of [-20.4, 20.4]) shelf.add(mesh(new THREE.BoxGeometry(1.2, 34, 9), oak, x, 17, 0));
  for (const y of [0.6, 11.6, 22.6, 33.4]) shelf.add(mesh(new THREE.BoxGeometry(41, 1.1, 9), oak, 0, y, 0));
  const books = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9", "#e9e7e1", "#2b2f2d"];
  for (let s = 0; s < 3; s++) {
    let x = -19;
    for (let i = 0; x < 18; i++) {
      const w = 1.6 + rnd(i * 3 + s) * 1.4;
      const h = 7 + rnd(i * 7 + s * 5) * 2.6;
      const book = mesh(rounded(w, h, 6.4, 0.25), mat(books[(i + s * 3) % books.length], { rough: 0.6 }), x + w / 2, 1.15 + s * 11 + h / 2, 0.6);
      if (rnd(i + s * 11) > 0.85) book.rotation.z = 0.12;
      shelf.add(book);
      x += w + 0.35;
    }
  }
  scene.add(shelf);

  // whiteboard: the plan's tasks as sticky notes (drawn live)
  const board = canvasTexture(512, 176);
  scene.add(mesh(rounded(89, 32, 0.8, 0.3), mat("#c3c8c5", { rough: 0.3, metal: 0.4 }), 194, 24, 48.5));
  const writing = new THREE.Mesh(new THREE.PlaneGeometry(86, 29), new THREE.MeshStandardMaterial({ map: board.tex, roughness: 0.35 }));
  writing.position.set(194, 24, 48.95);
  writing.receiveShadow = true;
  scene.add(writing, mesh(rounded(42, 0.8, 2.2, 0.3), mat("#c3c8c5", { rough: 0.3, metal: 0.4 }), 194, 7.8, 49.6));
  for (const [x, c] of [[180, "#d03b3b"], [186, "#3987e5"], [192, "#232826"]]) {
    const pen = mesh(new THREE.CylinderGeometry(0.35, 0.35, 4, 10), mat(c, { rough: 0.4 }), x, 8.6, 49.6);
    pen.rotation.z = Math.PI / 2;
    scene.add(pen);
  }

  // clock (real time)
  const clock = new THREE.Group();
  clock.position.set(250, 33, 48.6);
  const dial = mesh(new THREE.CylinderGeometry(5, 5, 0.6, 48), white, 0, 0, 0);
  dial.rotation.x = Math.PI / 2;
  clock.add(dial, mesh(new THREE.TorusGeometry(5, 0.45, 12, 48), dark, 0, 0, 0.1));
  for (let i = 0; i < 12; i++) {
    const tick = mesh(new THREE.BoxGeometry(0.35, i % 3 ? 0.6 : 1.1, 0.2), dark, Math.sin((i / 12) * Math.PI * 2) * 4, Math.cos((i / 12) * Math.PI * 2) * 4, 0.4, { cast: false });
    tick.rotation.z = -(i / 12) * Math.PI * 2;
    clock.add(tick);
  }
  const hand = (len, w) => {
    const pivot = new THREE.Group();
    pivot.position.z = 0.5;
    const m = mesh(new THREE.BoxGeometry(w, len, 0.2), dark, 0, len / 2 - 0.4, 0, { cast: false });
    m.userData.live = true;
    pivot.add(m);
    clock.add(pivot);
    return pivot;
  };
  const hourHand = hand(2.8, 0.55);
  const minuteHand = hand(4, 0.38);
  clock.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.4, 12), mat("#d03b3b"), 0, 0, 0.75).rotateX(Math.PI / 2));
  scene.add(clock);

  // a framed print
  const print = canvasTexture(256, 256);
  {
    const p = print.ctx;
    const grad = p.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#1d2c45");
    grad.addColorStop(1, "#2c4466");
    p.fillStyle = grad;
    p.fillRect(0, 0, 256, 256);
    const stars = [[64, 96], [104, 72], [144, 96], [184, 136], [104, 152], [144, 184], [64, 200]];
    p.strokeStyle = "rgba(250,178,25,0.55)";
    p.lineWidth = 3;
    p.beginPath();
    stars.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.stroke();
    p.fillStyle = "#fab219";
    for (const [x, y] of stars) {
      p.beginPath();
      p.arc(x, y, 9, 0, Math.PI * 2);
      p.fill();
    }
  }
  scene.add(mesh(rounded(31, 31, 1, 0.3), dark, 283, 26, 48.6));
  const art = new THREE.Mesh(new THREE.PlaneGeometry(27, 27), new THREE.MeshStandardMaterial({ map: print.tex, roughness: 0.4 }));
  art.position.set(283, 26, 49.15);
  scene.add(art);

  // server rack, with blinking lights
  const rack = new THREE.Group();
  rack.position.set(337, 0, 57);
  rack.add(mesh(rounded(18, 36, 13, 0.6), dark, 0, 18, 0));
  const leds = [];
  for (let i = 0; i < 6; i++) {
    rack.add(mesh(rounded(15, 4, 0.5, 0.2), mat("#2f3532", { rough: 0.4 }), 0, 6 + i * 5, 6.6, { cast: false }));
    for (let k = 0; k < 2; k++) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 0.3), new THREE.MeshBasicMaterial({ color: "#333" }));
      l.position.set(4 + k * 2, 6 + i * 5, 6.95);
      l.userData.live = true;
      rack.add(l);
      leds.push(l);
    }
  }
  scene.add(rack);

  // coffee corner
  scene.add(mesh(rounded(28, 9, 14, 0.5), white, 48, 4.5, 160), mesh(rounded(29, 1, 15, 0.4), oak, 48, 9.4, 160));
  scene.add(mesh(rounded(11, 11, 8, 0.9), mat("#2f3432", { rough: 0.4, metal: 0.2 }), 45, 15.4, 158), mesh(new THREE.CylinderGeometry(0.9, 0.8, 1.8, 16), mat("#f4f3ef", { rough: 0.35 }), 45, 10.8, 161));
  scene.add(mesh(new THREE.SphereGeometry(0.4, 10, 8), mat("#d03b3b", { basic: true }), 49, 18.5, 162.1, { cast: false }));
  const steam = [0, 1, 2].map((i) => {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 10), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false }));
    puff.position.set(45, 12, 161);
    puff.userData.live = true;
    puff.userData.offset = i / 3;
    scene.add(puff);
    return puff;
  });

  // rug, sofa (facing into the room), water cooler
  scene.add(mesh(rounded(140, 0.35, 50, 0.17), mat("#d6a07f", { rough: 0.95 }), 130, 0.18, 190, { cast: false }), mesh(rounded(126, 0.4, 36, 0.2), mat("#e3b896", { rough: 0.95 }), 130, 0.2, 190, { cast: false }));
  const sofa = new THREE.Group();
  const fabric = mat("#8aa48d", { rough: 0.9 });
  sofa.position.set(130, 0, 182);
  sofa.add(mesh(rounded(112, 4, 17, 1.2), fabric, 0, 3.2, 0), mesh(rounded(112, 11, 4.6, 1.6), fabric, 0, 10, -6.4));
  for (const x of [-42, -14, 14, 42]) sofa.add(mesh(rounded(27, 2.6, 13, 1.2), fabric, x, 6.3, 1.4));
  for (const x of [-58, 58]) sofa.add(mesh(rounded(4.6, 8.5, 17, 1.4), fabric, x, 6.2, 0));
  for (const x of [-53, 53]) for (const z of [-6.5, 6.5]) sofa.add(mesh(new THREE.CylinderGeometry(0.6, 0.5, 1.4, 10), dark, x, 0.7, z));
  scene.add(sofa);
  scene.add(mesh(rounded(10, 14, 10, 1), white, 210, 7, 192), mesh(new THREE.CylinderGeometry(3.8, 3.8, 9, 32), mat("#8ccdf3", { rough: 0.1, opacity: 0.82 }), 210, 18.5, 192));

  // plants
  const plant = (x, z, size) => {
    const p = new THREE.Group();
    p.position.set(x, 0, z);
    p.scale.setScalar(size);
    p.add(mesh(new THREE.CylinderGeometry(3.4, 2.6, 6, 28), white, 0, 3, 0), mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.3, 24), mat("#5a4632"), 0, 5.9, 0));
    const greens = ["#3f8f4e", "#4fa35d", "#2f7a40", "#5bb36a"];
    for (let i = 0; i < 7; i++) {
      const ang = (i / 7) * Math.PI * 2 + rnd(i + x) * 0.6;
      const leaf = mesh(new THREE.SphereGeometry(2.2, 16, 12), mat(greens[i % greens.length], { rough: 0.7 }), Math.sin(ang) * 2.2, 9 + rnd(i * 5 + z) * 5, Math.cos(ang) * 2.2);
      leaf.scale.set(0.7, 1.5, 0.45);
      leaf.rotation.set(Math.cos(ang) * 0.5, ang, -Math.sin(ang) * 0.5);
      p.add(leaf);
    }
    scene.add(p);
  };
  plant(334, 204, 1.1);
  plant(44, 206, 0.95);
  plant(153, 56, 1.05);
  plant(326, 104, 0.9);

  return { sky, board, hourHand, minuteHand, leds, steam };
}

// ---------- live textures ----------
const SCREEN_BG = { working: "#0f1720", waiting: "#111a2c", done: "#0f2a18", failed: "#2c1111", idle: "#0a0c0b" };
function drawScreen(g, id, st, t) {
  const a = AGENT_BY_ID[id];
  const W2 = g.canvas.width;
  const H2 = g.canvas.height;
  g.fillStyle = SCREEN_BG[st] || SCREEN_BG.idle;
  g.fillRect(0, 0, W2, H2);
  const u = 14; // one cell of the old 16×8 screen
  const ox = 16;
  const oy = 19;
  const r = (x, y, w, h, c) => roundRect(g, ox + x * u, oy + y * u, w * u - 3, h * u - 3, 3, c);
  if (st === "idle") {
    const px = Math.abs(Math.sin(t / 900 + id.length)) * (W2 - 40);
    const py = Math.abs(Math.sin(t / 1300 + id.length * 3)) * (H2 - 40);
    roundRect(g, 10 + px, 10 + py, 20, 20, 6, a.color);
    return;
  }
  if (st === "done") {
    g.strokeStyle = "#7ee07e";
    g.lineWidth = 14;
    g.lineCap = g.lineJoin = "round";
    g.beginPath();
    g.moveTo(W2 * 0.33, H2 * 0.52);
    g.lineTo(W2 * 0.45, H2 * 0.68);
    g.lineTo(W2 * 0.68, H2 * 0.32);
    g.stroke();
    return;
  }
  if (st === "failed") {
    if (Math.floor(t / 400) % 2) return;
    g.strokeStyle = "#ff6b6b";
    g.lineWidth = 14;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(W2 * 0.38, H2 * 0.3);
    g.lineTo(W2 * 0.62, H2 * 0.7);
    g.moveTo(W2 * 0.62, H2 * 0.3);
    g.lineTo(W2 * 0.38, H2 * 0.7);
    g.stroke();
    return;
  }
  if (st === "waiting") {
    r(1, 1, 8, 1, "#3987e5");
    if (Math.floor(t / 500) % 2) r(1, 6, 3, 1, "#c3c2b7");
    return;
  }
  const tick = Math.floor(t / 260);
  if (id.startsWith("tester")) {
    const total = 18;
    const shown = tick % (total + 6);
    for (let i = 0; i < Math.min(shown, total); i++) r(1 + (i % 6) * 2.2, 0.5 + Math.floor(i / 6) * 2.4, 1.4, 1.6, rnd(i * 7 + id.length) > 0.86 ? "#ff6b6b" : "#7ee07e");
  } else if (id === "reviewer") {
    for (let i = 0; i < 5; i++) {
      const k = rnd(tick + i);
      g.fillStyle = k > 0.66 ? "#1f5f2a" : k > 0.4 ? "#6a1f1f" : "#1b2433";
      g.fillRect(0, oy + i * u * 1.6 - 6, W2, u * 1.6 - 2);
      r(0.5, i * 1.6, 1 + rnd(i + tick * 3) * 12, 0.7, "#c3c2b7");
    }
  } else if (id === "manager") {
    for (let i = 0; i < 3; i++) {
      const mine = (tick + i) % 2;
      r(mine ? 6 : 1, 0.6 + i * 2.6, 4 + rnd(tick + i) * 5, 1.8, mine ? "#9cb29e" : "#e8e8e8");
    }
  } else if (id === "architect") {
    const n = 1 + (tick % 5);
    const boxes = [[1, 0.4], [9, 0.4], [1, 4.6], [9, 4.6], [5, 2.5]];
    for (let i = 0; i < n; i++) r(boxes[i][0], boxes[i][1], 5, 2.6, i % 2 ? "#9cdcfe" : a.color);
  } else {
    const colors = [a.color, "#9cdcfe", "#ce9178", "#dcdcaa", "#c586c0"];
    for (let i = 0; i < 6; i++) {
      const line = tick + i;
      const indent = Math.floor(rnd(line * 3) * 4);
      r(0.5 + indent, i * 1.2, 2 + Math.floor(rnd(line) * (13 - indent)), 0.75, colors[line % colors.length]);
    }
  }
}

const STICKY = { done: "#1b1d1c", active: "#9cb29e", ready: "#ffffff", blocked: "#d03b3b", pending: "#ffffff" };
function drawBoard(g, tasks, agents, t) {
  const W2 = g.canvas.width;
  const H2 = g.canvas.height;
  g.fillStyle = "#fbfbf9";
  g.fillRect(0, 0, W2, H2);
  const s = W2 / 86; // board units → texture pixels
  const note = (i, fill, outline, dashed) => {
    const x = (2 + (i % 8) * 10) * s;
    const y = (3 + Math.floor(i / 8) * 8.5) * s;
    g.save();
    g.translate(x + 3.5 * s, y + 2.5 * s);
    g.rotate((rnd(i * 13) - 0.5) * 0.12);
    roundRect(g, -3.5 * s + 2, -2.5 * s + 3, 7 * s, 5 * s, 3, "rgba(0,0,0,0.12)");
    roundRect(g, -3.5 * s, -2.5 * s, 7 * s, 5 * s, 3, fill);
    if (outline) {
      g.strokeStyle = outline;
      g.lineWidth = 3;
      g.setLineDash(dashed ? [6, 5] : []);
      g.strokeRect(-3.5 * s + 1.5, -2.5 * s + 1.5, 7 * s - 3, 5 * s - 3);
    }
    g.restore();
  };
  tasks.slice(0, 24).forEach((task, i) => {
    const st = taskStatus(task, tasks);
    const blink = st === "active" && !still.matches && Math.floor(t / 600) % 2;
    note(i, blink ? "#c9d6ca" : STICKY[st], st === "ready" ? "#1b1d1c" : st === "pending" ? "#9a998f" : "", st === "pending");
  });
  if (!tasks.length && agents?.architect?.state === "working") {
    const n = Math.floor(t / 500) % 6;
    for (let i = 0; i < n; i++) note(i, "#3987e5");
  }
}

function drawSky(g, t) {
  const W2 = g.canvas.width;
  const H2 = g.canvas.height;
  const grad = g.createLinearGradient(0, 0, 0, H2);
  grad.addColorStop(0, "#8fc9f5");
  grad.addColorStop(1, "#dff1ff");
  g.fillStyle = grad;
  g.fillRect(0, 0, W2, H2);
  g.fillStyle = "rgba(255,255,255,0.95)";
  for (let i = 0; i < 3; i++) {
    const x = ((t / (90 + i * 45) + i * 110) % (W2 + 120)) - 60;
    const y = 26 + i * 30;
    g.beginPath();
    for (const [dx, dy, r] of [[0, 0, 14], [16, -8, 17], [34, 0, 13], [17, 4, 14]]) g.arc(x + dx, y + dy, r, 0, Math.PI * 2);
    g.fill();
  }
}

// ---------- portraits (who's who, Maya's chat face): the same teammate, head and shoulders ----------
let portraitKit = null;
function portraitRenderer() {
  if (portraitKit !== null) return portraitKit;
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(192, 192, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight("#ffffff", "#c9bfae", 2.2));
    const key = new THREE.DirectionalLight("#fff6ea", 2.4);
    key.position.set(-12, 30, 40);
    scene.add(key);
    const camera = new THREE.PerspectiveCamera(24, 1, 1, 200);
    camera.position.set(0, 16.6, 32);
    camera.lookAt(0, 15.4, 0);
    portraitKit = { renderer, scene, camera };
  } catch {
    portraitKit = false;
  }
  return portraitKit;
}

/** A teammate's head-and-shoulders portrait as a canvas (the same 3D character as in the office). */
export function portrait(a) {
  const c = document.createElement("canvas");
  c.width = c.height = 192;
  c.className = "portrait";
  c.setAttribute("aria-hidden", "true");
  const kit = WEBGL && portraitRenderer();
  const g = c.getContext("2d");
  if (kit) {
    const p = makePerson(a);
    p.root.rotation.y = -0.3;
    kit.scene.add(p.root);
    kit.renderer.render(kit.scene, kit.camera);
    g.drawImage(kit.renderer.domElement, 0, 0, 192, 192);
    kit.scene.remove(p.root);
    p.root.traverse((o) => o.geometry?.dispose());
  } else {
    roundRect(g, 0, 0, 192, 192, 0, a.color);
    g.fillStyle = "#ffffff";
    g.font = "800 96px Archivo, system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(a.name[0], 96, 104);
  }
  return c;
}

export function createOffice({ canvas, overlay, tip, onSelect }) {
  let state = null;
  let now = Date.now();
  let simple = true; // friendly names + plain bubbles; false = ids and the agents' own activity text
  const chars = {};
  AGENTS.forEach((a, i) => {
    chars[a.id] = { x: LOUNGE[i].x, y: LOUNGE[i].y, mode: "stand", dirX: 0, dirY: 1, path: [], goal: "lounge", jump: 0, prevState: "idle", placed: false };
  });

  // DOM overlay: name tags + speech bubbles
  const tags = {};
  const bubbles = {};
  for (const a of AGENTS) {
    const tag = document.createElement("div");
    tag.className = "tag";
    tag.innerHTML = `<i style="background:${a.color}"></i><span>${a.name}</span>`;
    overlay.appendChild(tag);
    tags[a.id] = tag;
    const b = document.createElement("div");
    b.className = "bubble";
    b.hidden = true;
    overlay.appendChild(b);
    bubbles[a.id] = b;
  }

  // ---------- movement (plan coordinates) ----------
  const corridorFor = (y) => (y < 112 ? CORRIDORS[0] : CORRIDORS[1]);
  function corridorPath(from, to) {
    const c1 = corridorFor(from.y);
    const c2 = corridorFor(to.y);
    const pts = [{ x: from.x, y: c1 }];
    if (c1 !== c2) pts.push({ x: PASSAGE_X, y: c1 }, { x: PASSAGE_X, y: c2 });
    pts.push({ x: to.x, y: c2 }, { x: to.x, y: to.y });
    return pts;
  }
  // the sofa faces the room's front: you get on and off it from the walkway in front, round its end
  const END = { x: SOFA_END, y: CORRIDORS[1] };
  const onSofa = (p) => p.y >= LOUNGE[0].y - 1;
  function route(from, to) {
    if (onSofa(from) && onSofa(to)) return [{ x: from.x, y: SOFA_FRONT }, { x: to.x, y: SOFA_FRONT }, { x: to.x, y: to.y }];
    if (onSofa(from)) return [{ x: from.x, y: SOFA_FRONT }, { x: SOFA_END, y: SOFA_FRONT }, END, ...corridorPath(END, to)];
    if (onSofa(to)) return [...corridorPath(from, END), { x: SOFA_END, y: SOFA_FRONT }, { x: to.x, y: SOFA_FRONT }, { x: to.x, y: to.y }];
    return corridorPath(from, to);
  }
  const seatFeet = (id) => ({ x: STATIONS[id].dx + 18, y: STATIONS[id].dy + 17 });

  function syncGoals(first) {
    AGENTS.forEach((a, i) => {
      const ch = chars[a.id];
      const st = state?.agents?.[a.id]?.state || "idle";
      const goal = st === "idle" ? "lounge" : "desk";
      if (st === "done" && ch.prevState !== "done") ch.jump = 1.2;
      ch.prevState = st;
      if (goal === ch.goal && ch.placed) return;
      ch.goal = goal;
      const target = goal === "desk" ? seatFeet(a.id) : LOUNGE[i];
      if (first || !ch.placed) {
        Object.assign(ch, target, { mode: goal === "desk" ? "sit" : "stand", path: [], placed: true });
        return;
      }
      if (ch.mode === "sit") Object.assign(ch, seatFeet(a.id));
      ch.path = route(ch, target);
      ch.mode = "walk";
    });
  }

  function step(dt) {
    for (const a of AGENTS) {
      const ch = chars[a.id];
      if (ch.jump > 0) ch.jump = Math.max(0, ch.jump - dt);
      if (ch.mode !== "walk") continue;
      let budget = SPEED * dt;
      while (budget > 0 && ch.path.length) {
        const p = ch.path[0];
        const dx = p.x - ch.x;
        const dy = p.y - ch.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.01) {
          ch.dirX = dx / d;
          ch.dirY = dy / d;
        }
        if (d <= budget) {
          ch.x = p.x;
          ch.y = p.y;
          budget -= d;
          ch.path.shift();
        } else {
          ch.x += (dx / d) * budget;
          ch.y += (dy / d) * budget;
          budget = 0;
        }
      }
      if (!ch.path.length) ch.mode = ch.goal === "desk" ? "sit" : "stand";
    }
  }

  // In the simple view a bubble says what the teammate is doing in plain words (its task's plain title, or its job);
  // behind the scenes it shows the agent's own activity text ("POST /api/rsvp").
  function bubbleText(a, ag, st) {
    if (!simple) return st === "done" ? "Done: " + (ag.activity || "finished") : st === "failed" ? "Issues: " + (ag.activity || "found some") : st === "waiting" ? "… " + (ag.activity || "waiting") : ag.activity || "working…";
    if (st === "done") return "Done";
    if (st === "failed") return "Found something to fix";
    if (st === "waiting") return a.id === "manager" ? "… Here for you" : "… Waiting";
    const task = (state?.tasks || []).find((t) => t.owner === a.id && t.status === "active");
    return task ? taskLabel(task) : a.id === "manager" ? "Talking to you" : a.job + "…";
  }
  function updateBubbles() {
    for (const a of AGENTS) {
      const b = bubbles[a.id];
      const ag = state?.agents?.[a.id];
      const ch = chars[a.id];
      const st = ag?.state || "idle";
      if (ch.mode !== "sit" || st === "idle") {
        b.hidden = true;
        continue;
      }
      const text = bubbleText(a, ag, st);
      if (b.textContent !== text) b.textContent = text;
      const cls = "bubble " + st;
      if (b.className !== cls) b.className = cls;
      b.hidden = false;
    }
  }

  function tipFor(id, e) {
    const r = canvas.getBoundingClientRect();
    const a = AGENT_BY_ID[id];
    const ag = state?.agents?.[id] || { state: "idle" };
    const meta = AGENT_STATE[ag.state] || AGENT_STATE.idle;
    const owned = (state?.tasks || []).filter((t) => t.owner === id);
    const doneN = owned.filter((t) => t.status === "done").length;
    tip.innerHTML =
      (simple ? `<b>${esc(a.name)}</b>${esc(a.job)}` : `<b>${esc(a.id)}</b>${esc(a.role)}`) +
      `<br>${meta.label}` +
      (ag.since ? ` <span class="muted">· ${fmtDur(now - ag.since)}</span>` : "") +
      (ag.activity && !simple ? `<br><span class="muted">${esc(ag.activity)}</span>` : "") +
      (owned.length ? `<br>${simple ? "Parts" : "Tasks"}: ${doneN}/${owned.length} done` : "") +
      (modelFor(state, id) ? `<br><span class="muted">AI model:</span> ${esc(modelFor(state, id).label)}` : "") +
      (id === "manager" ? `<br><span class="muted">Click to chat</span>` : "");
    tip.hidden = false;
    tip.style.left = Math.min(e.clientX - r.left + 14, r.width - tip.offsetWidth - 4) + "px";
    tip.style.top = e.clientY - r.top + 14 + "px";
  }

  const api = {
    update(next) {
      state = next;
      syncGoals(first);
      first = false;
    },
    setSimple(v) {
      simple = v;
      for (const a of AGENTS) tags[a.id].querySelector("span").textContent = v ? a.name : a.id;
    },
  };
  let first = true;

  // ---------- no WebGL: the plan, flat, with the tags where the desks are ----------
  if (!WEBGL) {
    const g = canvas.getContext("2d");
    const paint = () => {
      g.fillStyle = "#e5ebe4";
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = "#1f2a20";
      g.font = "600 11px Archivo, system-ui, sans-serif";
      g.textAlign = "center";
      g.fillText("The 3D office needs WebGL (hardware acceleration) — turn it on in your browser's settings.", canvas.width / 2, 24);
    };
    paint();
    for (const a of AGENTS) {
      const s = STATIONS[a.id];
      Object.assign(tags[a.id].style, { left: ((s.dx + 18) / W) * 100 + "%", top: ((s.dy + 24) / H) * 100 + "%" });
      Object.assign(bubbles[a.id].style, { left: ((s.dx + 18) / W) * 100 + "%", top: ((s.dy - 4) / H) * 100 + "%" });
    }
    setInterval(() => {
      now = Date.now();
      step(0.25);
      updateBubbles();
    }, 250);
    return api;
  }

  // ---------- the 3D scene ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  // No graphics card in use (software rendering: SwiftShader, llvmpipe, Microsoft Basic Render Driver)? Then a lighter
  // office: no shadows, normal resolution, fewer frames — so the rest of the page stays quick.
  const gl = renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const lite = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "");
  renderer.shadowMap.enabled = !lite;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#e5ebe4");
  scene.add(new THREE.HemisphereLight("#ffffff", "#cbbd9f", 1.7));
  const sun = new THREE.DirectionalLight("#fff3e2", 2.6);
  sun.position.set(80, 260, 330);
  sun.target.position.set(192, 0, 130);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -230, right: 230, top: 160, bottom: -160, near: 50, far: 800 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.4;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight("#dfe9ff", 0.6);
  fill.position.set(380, 120, 260);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(30.5, W / H, 10, 2000);
  camera.position.set(192, 182, 322);
  camera.lookAt(192, 8, 126);

  const room = makeRoom(scene);
  const stations = {};
  for (const a of AGENTS) {
    stations[a.id] = makeStation(a.id);
    scene.add(stations[a.id].group);
  }
  mergeStatic(scene); // the room and desks never move: a few dozen draws instead of hundreds
  const people = {};
  for (const a of AGENTS) {
    people[a.id] = makePerson(a);
    people[a.id].root.scale.setScalar(SCALE);
    people[a.id].root.traverse((o) => o.isMesh && small(o) && (o.castShadow = false));
    scene.add(people[a.id].root);
  }
  const pickables = [...Object.values(stations).map((s) => s.hit), ...Object.values(people).map((p) => p.root)];

  // tags sit on the floor in front of each chair; bubbles over the screens
  const v = new THREE.Vector3();
  function pin(el, x, y, z) {
    v.set(x, y, z).project(camera);
    el.style.left = ((v.x + 1) / 2) * 100 + "%";
    el.style.top = ((1 - v.y) / 2) * 100 + "%";
  }
  function pinAll() {
    camera.updateMatrixWorld(); // project with where the camera is now, not where it was at the last frame
    for (const a of AGENTS) {
      const s = STATIONS[a.id];
      pin(tags[a.id], X(s.dx + 18), 2, s.dy + 23);
      pin(bubbles[a.id], X(s.dx + 18), 22.4, s.dy - 1);
    }
  }
  function resize() {
    const w = canvas.clientWidth || W;
    const h = canvas.clientHeight || H;
    renderer.setPixelRatio(lite ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    pinAll();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---------- each frame: where everyone is and what they're doing ----------
  const turnTo = (p, yaw, k) => {
    let d = yaw - p.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    p.yaw += d * Math.min(1, k);
    p.root.rotation.y = p.yaw;
  };
  function pose(t, dt) {
    const calm = still.matches;
    for (const a of AGENTS) {
      const ch = chars[a.id];
      const p = people[a.id];
      const st = state?.agents?.[a.id]?.state || "idle";
      const s = t / 1000;
      const seed = a.id.length * 1.7;
      p.legs.forEach((l) => l.rotation.set(0, 0, 0));
      p.knees.forEach((k) => (k.rotation.x = 0));
      p.arms.forEach((l, i) => l.rotation.set(0, 0, (i ? 1 : -1) * 0.08));
      p.head.rotation.set(0, 0, 0);
      p.mug.visible = false;
      if (ch.mode === "walk") {
        p.root.position.set(X(ch.x), 0, ch.y);
        turnTo(p, Math.atan2(ch.dirX * SQUEEZE, ch.dirY), dt * 12);
        const ph = s * 9;
        const swing = calm ? 0 : Math.sin(ph);
        p.legs[0].rotation.x = swing * 0.55;
        p.legs[1].rotation.x = -swing * 0.55;
        p.knees[0].rotation.x = Math.max(0, swing) * 0.7; // the leg swinging back bends at the knee
        p.knees[1].rotation.x = Math.max(0, -swing) * 0.7;
        p.arms[0].rotation.x = -swing * 0.45;
        p.arms[1].rotation.x = swing * 0.45;
        p.root.position.y = calm ? 0 : Math.abs(Math.cos(ph)) * 0.35;
      } else if (ch.mode === "stand") {
        // on break: sitting on the sofa with a coffee
        p.root.position.set(X(ch.x), SOFA_SEAT - HIP * SCALE, ch.y - 1);
        turnTo(p, 0, dt * 8);
        p.legs.forEach((l) => (l.rotation.x = -1.5));
        p.knees.forEach((k) => (k.rotation.x = 1.5));
        p.mug.visible = true;
        p.arms[1].rotation.x = -1.2;
        p.arms[0].rotation.x = -0.35;
        if (!calm) p.head.rotation.y = Math.sin(s * 0.5 + seed) * 0.3;
      } else {
        const { dx, dy } = STATIONS[a.id];
        p.root.position.set(X(dx + 18), SEAT - HIP * SCALE, dy + 15.2);
        p.yaw = Math.PI;
        p.root.rotation.y = Math.PI;
        p.legs.forEach((l) => (l.rotation.x = -1.5));
        p.knees.forEach((k) => (k.rotation.x = 1.5));
        p.arms.forEach((l) => (l.rotation.x = -1.0));
        if (st === "working" && !calm) {
          const k = Math.sin(s * 14 + seed);
          p.arms[0].rotation.x = -1.05 + k * 0.08;
          p.arms[1].rotation.x = -1.05 - k * 0.08;
          p.head.rotation.x = Math.sin(s * 1.3 + seed) * 0.05;
        } else if (st === "done" && ch.jump > 0) {
          p.root.position.y += calm ? 0 : Math.abs(Math.sin(ch.jump * 8)) * 2.4;
          p.arms.forEach((l, i) => l.rotation.set(-2.85, 0, (i ? 1 : -1) * 0.25));
        } else if (st === "failed" && !calm) {
          p.head.rotation.y = Math.sin(s * 5) * 0.18;
        } else if (st === "waiting") {
          p.head.rotation.z = 0.12;
        }
      }
      // a blink every few seconds
      const blink = !calm && t > p.blinkAt && t < p.blinkAt + 130;
      if (t > p.blinkAt + 130) p.blinkAt = t + 2500 + rnd(t) * 4000;
      p.eyes.forEach((e) => (e.scale.y = blink ? 0.15 : 1));
    }
  }

  let lastSky = 0;
  let boardKey = "";
  let lastLeds = 0;
  function animateRoom(t) {
    const calm = still.matches;
    // screens: redraw only what changed
    for (const a of AGENTS) {
      const st = state?.agents?.[a.id]?.state || "idle";
      const station = stations[a.id];
      const key = st + ":" + (st === "idle" ? Math.floor(t / 66) : Math.floor(t / 130));
      if (key !== station.key) {
        station.key = key;
        drawScreen(station.screen.ctx, a.id, st, calm ? 0 : t);
        station.screen.tex.needsUpdate = true;
      }
      station.led.material.color.set(st === "idle" ? "#444" : "#39ff6a");
    }
    const tasks = state?.tasks || [];
    const bk = tasks.map((x) => x.id + x.status).join() + ":" + (calm ? 0 : Math.floor(t / 500)) + (state?.agents?.architect?.state || "");
    if (bk !== boardKey) {
      boardKey = bk;
      drawBoard(room.board.ctx, tasks, state?.agents, t);
      room.board.tex.needsUpdate = true;
    }
    if (t - lastSky > 66 || !lastSky) {
      lastSky = t;
      drawSky(room.sky.ctx, calm ? 0 : t);
      room.sky.tex.needsUpdate = true;
    }
    const d = new Date();
    room.hourHand.rotation.z = -((d.getHours() % 12) + d.getMinutes() / 60) * (Math.PI / 6);
    room.minuteHand.rotation.z = -(d.getMinutes() + d.getSeconds() / 60) * (Math.PI / 30);
    if (t - lastLeds > 200) {
      lastLeds = t;
      room.leds.forEach((l, i) => l.material.color.set(rnd(Math.floor(t / 200) + i * 13) > 0.4 ? (i % 2 ? "#39ff6a" : "#fab219") : "#333"));
    }
    room.steam.forEach((puff) => {
      const k = calm ? 0 : (t / 2400 + puff.userData.offset) % 1;
      puff.position.y = 12 + k * 7;
      puff.position.x = 45 + Math.sin(k * 6) * 0.6;
      puff.scale.setScalar(0.6 + k * 1.2);
      puff.material.opacity = calm ? 0 : Math.sin(k * Math.PI) * 0.5;
    });
  }

  // ---------- hover and click: what the pointer is over ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, true)[0];
    return hit?.object.userData.agent || null;
  }
  canvas.addEventListener("mousemove", (e) => {
    const id = pick(e);
    canvas.style.cursor = id ? "pointer" : "";
    if (!id) return void (tip.hidden = true);
    tipFor(id, e);
  });
  canvas.addEventListener("mouseleave", () => (tip.hidden = true));
  canvas.addEventListener("click", (e) => {
    const id = pick(e);
    if (id && onSelect) onSelect(id);
  });

  // Draw while the office is on screen (requestAnimationFrame); keep everyone walking while it isn't (a timer), so
  // nobody is found frozen mid-corridor when you come back.
  let onScreen = true;
  new IntersectionObserver(([e]) => (onScreen = e.isIntersecting)).observe(canvas);
  let last = performance.now();
  const advance = () => {
    const ts = performance.now();
    const dt = Math.min(2, (ts - last) / 1000);
    last = ts;
    now = Date.now();
    step(dt);
    return [ts, dt];
  };
  let lastDraw = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    if (document.hidden || !onScreen) return;
    const walking = AGENTS.some((a) => chars[a.id].mode === "walk");
    if (t - lastDraw < (lite ? (walking ? 60 : 160) : walking ? 0 : 31)) return;
    lastDraw = t;
    const [ts, dt] = advance();
    pose(ts, dt);
    animateRoom(ts);
    renderer.render(scene, camera);
    updateBubbles();
  }
  requestAnimationFrame(frame);
  setInterval(() => (document.hidden || !onScreen) && advance(), 250);
  return api;
}
