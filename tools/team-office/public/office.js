// 8-bit office renderer. Everything is drawn procedurally at 384×216 and scaled up with pixelated rendering.
import { AGENTS, AGENT_BY_ID, AGENT_STATE, taskStatus, fmtDur, esc, modelFor } from "./agents.js";

const W = 384;
const H = 216;
const WALL = 48;
const SPEED = 38; // px per second

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
const LOUNGE = AGENTS.map((_, i) => ({ x: 42 + i * 16, y: 184 }));
const CORRIDORS = [101, 156];
const PASSAGE_X = 162;

// ---- sprites (10px wide). h hair, s skin, e eye, c shirt, p pants, b shoes ----
const FRONT = [
  "..hhhhhh..",
  ".hhhhhhhh.",
  ".hssssssh.",
  ".ssessess.",
  ".ssssssss.",
  "..ssssss..",
  "...ssss...",
  ".cccccccc.",
  "cccccccccc",
  "cccccccccc",
  "sccccccccs",
  ".pppppppp.",
  ".ppp..ppp.",
  ".ppp..ppp.",
  ".bbb..bbb.",
];
const SIDE_TOP = [
  "..hhhhh...",
  ".hhhhhhh..",
  ".hhhsssss.",
  ".hhsssses.",
  "..hssssss.",
  "...ssss...",
  "..cccccc..",
  ".ccccccc..",
  ".cccsccc..",
  ".cccsccc..",
  "..cccccc..",
  "..pppppp..",
];
const SIDE_LEGS = [
  [".pp...pp..", ".pp...pp..", "bbb..bbb.."],
  ["...ppp....", "...ppp....", "...bbbb..."],
];
const BACK = [
  "..hhhhhh..",
  ".hhhhhhhh.",
  ".hhhhhhhh.",
  ".hhhhhhhh.",
  "..hhhhhh..",
  "...ssss...",
  ".cccccccc.",
  "cccccccccc",
  "cccccccccc",
  "cccccccccc",
];

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

// deterministic pseudo-random for stable "code" on screens
function rnd(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function createOffice({ canvas, overlay, tip, onSelect }) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const bg = document.createElement("canvas");
  bg.width = W;
  bg.height = H;
  drawBackground(bg.getContext("2d"));

  let state = null;
  let now = Date.now();
  const chars = {};
  AGENTS.forEach((a, i) => {
    chars[a.id] = { x: LOUNGE[i].x, y: LOUNGE[i].y, mode: "stand", facing: 1, path: [], goal: "lounge", jump: 0, prevState: "idle", placed: false };
  });

  // DOM overlay: name tags + speech bubbles
  const tags = {};
  const bubbles = {};
  for (const a of AGENTS) {
    const s = STATIONS[a.id];
    const tag = document.createElement("div");
    tag.className = "tag";
    tag.innerHTML = `<i style="background:${a.color}"></i>${a.id}`;
    place(tag, s.dx + 18, s.dy + 24);
    overlay.appendChild(tag);
    tags[a.id] = tag;
    const b = document.createElement("div");
    b.className = "bubble";
    b.hidden = true;
    overlay.appendChild(b);
    bubbles[a.id] = b;
  }

  function place(el, x, y) {
    el.style.left = (x / W) * 100 + "%";
    el.style.top = (y / H) * 100 + "%";
  }

  function rect(x, y, w, h, c) {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  function sprite(rows, x, y, pal, flip = false) {
    x = Math.round(x);
    y = Math.round(y);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const col = pal[row[c]];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(x + (flip ? row.length - 1 - c : c), y + r, 1, 1);
      }
    }
  }

  function palette(a, blink) {
    return { h: a.hair, s: a.skin, e: blink ? a.skin : "#1b1b1b", c: a.color, p: a.pants, b: "#1a1a1a" };
  }

  function accessory(a, view, x, y, facing) {
    x = Math.round(x);
    y = Math.round(y);
    const flipX = (dx, w) => (view === "side" && facing < 0 ? x + 10 - dx - w : x + dx);
    if (a.acc === "hardhat") {
      rect(x + 1, y - 1, 8, 3, "#fab219");
      rect(x, y + 1, 10, 1, "#d99a12");
      rect(x + 4, y - 1, 2, 1, "#ffd35a");
    } else if (a.acc === "headphones" || a.acc === "headset") {
      rect(x + 1, y - 1, 8, 1, "#222");
      if (view === "side") rect(flipX(3, 2), y + 2, 2, 3, "#222");
      else {
        rect(x, y + 2, 1, 3, "#222");
        rect(x + 9, y + 2, 1, 3, "#222");
      }
      // headset mic boom
      if (a.acc === "headset" && view === "front") {
        rect(x + 1, y + 5, 1, 1, "#222");
        rect(x + 2, y + 6, 2, 1, "#222");
        rect(x + 4, y + 6, 1, 1, "#e66767");
      } else if (a.acc === "headset" && view === "side") rect(flipX(5, 4), y + 5, 4, 1, "#222");
    } else if (a.acc === "cap") {
      rect(x + 1, y - 1, 8, 2, "#ececec");
      if (view === "front") rect(x + 1, y + 1, 8, 1, "#cfcfcf");
      if (view === "side") rect(flipX(7, 3), y + 1, 3, 1, "#cfcfcf");
    } else if (a.acc === "glasses") {
      if (view === "front") {
        rect(x + 1, y + 3, 3, 1, "#111");
        rect(x + 6, y + 3, 3, 1, "#111");
        rect(x + 4, y + 3, 2, 1, "#555");
      } else if (view === "side") rect(flipX(5, 4), y + 3, 4, 1, "#111");
    }
    if (a.long) {
      if (view === "front") {
        rect(x, y + 3, 1, 5, a.hair);
        rect(x + 9, y + 3, 1, 5, a.hair);
      } else if (view === "back") rect(x + 1, y + 5, 8, 3, a.hair);
      else rect(flipX(0, 2), y + 3, 2, 4, a.hair);
    }
  }

  // ---------- movement ----------
  const corridorFor = (y) => (y < 112 ? CORRIDORS[0] : CORRIDORS[1]);
  function route(from, to) {
    const c1 = corridorFor(from.y);
    const c2 = corridorFor(to.y);
    const pts = [{ x: from.x, y: c1 }];
    if (c1 !== c2) pts.push({ x: PASSAGE_X, y: c1 }, { x: PASSAGE_X, y: c2 });
    pts.push({ x: to.x, y: c2 }, { x: to.x, y: to.y });
    return pts;
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
        if (d <= budget) {
          ch.x = p.x;
          ch.y = p.y;
          budget -= d;
          ch.path.shift();
        } else {
          ch.x += (dx / d) * budget;
          ch.y += (dy / d) * budget;
          if (Math.abs(dx) > 0.01) ch.facing = dx > 0 ? 1 : -1;
          budget = 0;
        }
      }
      if (!ch.path.length) ch.mode = ch.goal === "desk" ? "sit" : "stand";
    }
  }

  // ---------- drawing ----------
  function drawScreen(id, x, y, w, h, st, t) {
    const a = AGENT_BY_ID[id];
    const bgc = { working: "#0e1726", waiting: "#101a33", done: "#0c3d12", failed: "#3d0c0c", idle: "#050505" }[st] || "#050505";
    rect(x, y, w, h, bgc);
    if (st === "idle") {
      const px = x + 1 + Math.floor(Math.abs(Math.sin(t / 900 + x)) * (w - 3));
      const py = y + 1 + Math.floor(Math.abs(Math.sin(t / 1300 + y)) * (h - 3));
      rect(px, py, 2, 2, a.color);
      return;
    }
    if (st === "done") {
      const c = "#7ee07e";
      [[5, 5], [6, 6], [7, 7], [8, 6], [9, 5], [10, 4], [11, 3]].forEach(([dx, dy]) => rect(x + dx, y + dy, 1, 1, c));
      return;
    }
    if (st === "failed") {
      if (Math.floor(t / 400) % 2) return;
      for (let i = 0; i < 6; i++) {
        rect(x + 5 + i, y + 2 + i, 1, 1, "#ff6b6b");
        rect(x + 10 - i, y + 2 + i, 1, 1, "#ff6b6b");
      }
      return;
    }
    if (st === "waiting") {
      if (Math.floor(t / 500) % 2) rect(x + 2, y + h - 3, 3, 1, "#c3c2b7");
      rect(x + 2, y + 2, 8, 1, "#3987e5");
      return;
    }
    // working — content depends on role
    const tick = Math.floor(t / 260);
    if (id.startsWith("tester")) {
      const total = 18;
      const shown = tick % (total + 6);
      for (let i = 0; i < Math.min(shown, total); i++) {
        const bad = rnd(i * 7 + id.length) > 0.86;
        rect(x + 1 + (i % 6) * 2 + 1, y + 1 + Math.floor(i / 6) * 3, 1, 2, bad ? "#ff6b6b" : "#7ee07e");
      }
    } else if (id === "reviewer") {
      for (let i = 0; i < 5; i++) {
        const k = rnd(tick + i);
        const c = k > 0.66 ? "#1f5f2a" : k > 0.4 ? "#6a1f1f" : "#1b2433";
        rect(x, y + i * 2, w, 2, c);
        rect(x + 1, y + i * 2, 1 + Math.floor(rnd(i + tick * 3) * (w - 3)), 1, "#c3c2b7");
      }
    } else if (id === "manager") {
      // chat window: alternating message bubbles
      for (let i = 0; i < 3; i++) {
        const mine = (tick + i) % 2;
        rect(x + (mine ? 6 : 1), y + 1 + i * 3, 4 + Math.floor(rnd(tick + i) * 5), 2, mine ? "#fab219" : "#e8e8e8");
      }
    } else if (id === "architect") {
      const n = 1 + (tick % 5);
      const boxes = [[1, 1], [8, 1], [1, 6], [8, 6], [4, 3]];
      for (let i = 0; i < n; i++) rect(x + boxes[i][0], y + boxes[i][1], 5, 3, i % 2 ? "#9cdcfe" : a.color);
    } else {
      const colors = [a.color, "#9cdcfe", "#ce9178", "#dcdcaa", "#c586c0"];
      for (let i = 0; i < 5; i++) {
        const line = tick + i;
        const indent = Math.floor(rnd(line * 3) * 4);
        const len = 2 + Math.floor(rnd(line) * (w - 4 - indent));
        rect(x + 1 + indent, y + 1 + i * 2, len, 1, colors[line % colors.length]);
      }
    }
  }

  function drawStation(id, t) {
    const { dx, dy } = STATIONS[id];
    const a = AGENT_BY_ID[id];
    const st = state?.agents?.[id]?.state || "idle";
    const ch = chars[id];
    // monitor
    rect(dx + 8, dy - 13, 20, 13, "#1d1d1d");
    rect(dx + 9, dy - 12, 18, 10, "#000");
    drawScreen(id, dx + 10, dy - 11, 16, 8, st, t);
    rect(dx + 27, dy - 12, 1, 1, st === "idle" ? "#444" : "#39ff6a");
    rect(dx + 16, dy - 1, 4, 2, "#2a2a2a");
    // desk
    rect(dx, dy, 36, 8, "#8b5a2b");
    rect(dx, dy, 36, 1, "#b07a44");
    rect(dx + 11, dy + 3, 14, 3, "#cfcfcf");
    rect(dx + 12, dy + 4, 12, 1, "#9e9e9e");
    rect(dx + 29, dy + 2, 3, 3, "#f2f2f2");
    rect(dx + 32, dy + 3, 1, 1, "#f2f2f2");
    rect(dx + 2, dy + 2, 5, 4, "#e8d27a");
    rect(dx, dy + 8, 36, 6, "#6b4423");
    rect(dx + 1, dy + 14, 2, 4, "#4a2f18");
    rect(dx + 33, dy + 14, 2, 4, "#4a2f18");
    // seated agent
    const seated = ch.mode === "sit";
    if (seated) {
      const jumpY = ch.jump > 0 ? -Math.round(Math.abs(Math.sin(ch.jump * 8)) * 3) : 0;
      const x = dx + 13;
      const y = dy + 2 + jumpY;
      sprite(BACK, x, y, palette(a));
      accessory(a, "back", x, y, 1);
      if (st === "working") {
        const f = Math.floor(t / 140 + id.length) % 2;
        rect(x - 1, y + 6 + f, 1, 2, a.skin);
        rect(x + 10, y + 7 - f, 1, 2, a.skin);
      } else if (st === "done" && ch.jump > 0) {
        rect(x - 1, y + 3, 1, 4, a.skin);
        rect(x + 10, y + 3, 1, 4, a.skin);
      }
    }
    // chair
    rect(dx + 12, dy + 10, 12, 8, "#2b2b2b");
    rect(dx + 13, dy + 11, 10, 6, seated ? "#3a3a3a" : "#444");
    rect(dx + 17, dy + 18, 2, 3, "#222");
    rect(dx + 13, dy + 21, 10, 1, "#222");
    rect(dx + 13, dy + 22, 1, 1, "#111");
    rect(dx + 22, dy + 22, 1, 1, "#111");
  }

  function drawWalker(id, t) {
    const a = AGENT_BY_ID[id];
    const ch = chars[id];
    const x = ch.x - 5;
    const y = ch.y - 15;
    const blink = Math.floor(t / 150 + id.length * 7) % 30 === 0;
    if (ch.mode === "walk") {
      const f = Math.floor(t / 150) % 2;
      const flip = ch.facing < 0;
      const bob = f ? -1 : 0;
      sprite(SIDE_TOP, x, y + bob, palette(a, blink), flip);
      sprite(SIDE_LEGS[f], x, y + 12, palette(a), flip);
      accessory(a, "side", x, y + bob, ch.facing);
    } else {
      sprite(FRONT, x, y, palette(a, blink));
      accessory(a, "front", x, y, 1);
      // coffee mug + floating z's on break
      rect(x + 9, y + 9, 3, 3, "#f2f2f2");
      rect(x + 10, y + 9, 1, 1, "#6b4423");
      const zt = (t / 1000 + id.length * 0.37) % 3;
      if (zt < 2) {
        const zy = y - 3 - Math.floor(zt * 4);
        const zc = zt < 1.6 ? "#c3c2b7" : "#6b6a64";
        rect(x + 8, zy, 3, 1, zc);
        rect(x + 9, zy + 1, 1, 1, zc);
        rect(x + 8, zy + 2, 3, 1, zc);
      }
    }
  }

  function drawDynamic(t) {
    // clouds drifting past the window
    ctx.save();
    ctx.beginPath();
    ctx.rect(18, 10, 56, 26);
    ctx.clip();
    for (let i = 0; i < 3; i++) {
      const cx = 18 + ((t / (180 + i * 90) + i * 30) % 90) - 20;
      const cy = 14 + i * 7;
      rect(cx, cy, 12, 3, "#ffffff");
      rect(cx + 3, cy - 2, 6, 2, "#ffffff");
    }
    ctx.restore();

    // wall clock with real time
    const d = new Date();
    const cx = 262;
    const cy = 22;
    const hand = (ang, len, c) => {
      for (let r = 0; r <= len; r++) rect(cx + Math.round(Math.sin(ang) * r), cy - Math.round(Math.cos(ang) * r), 1, 1, c);
    };
    hand(((d.getHours() % 12) + d.getMinutes() / 60) * (Math.PI / 6), 3, "#222");
    hand(d.getMinutes() * (Math.PI / 30), 5, "#444");

    // whiteboard = task board: one sticky per task, colored by status
    const tasks = state?.tasks || [];
    const stickyColor = { done: "#0ca30c", active: "#ffffff", ready: "#fab219", blocked: "#d03b3b", pending: "#6b6a64" };
    tasks.slice(0, 24).forEach((task, i) => {
      const sx = 154 + (i % 8) * 10;
      const sy = 11 + Math.floor(i / 8) * 8;
      const st = taskStatus(task, tasks);
      if (st === "pending") {
        rect(sx, sy, 7, 5, "#9a998f");
        rect(sx + 1, sy + 1, 5, 3, "#e9e9e4");
      } else if (st === "active" && Math.floor(t / 400) % 2) {
        rect(sx, sy, 7, 5, "#bdbdbd");
      } else rect(sx, sy, 7, 5, stickyColor[st]);
    });
    if (!tasks.length && state?.agents?.architect?.state === "working") {
      const n = Math.floor(t / 500) % 6;
      for (let i = 0; i < n; i++) rect(156 + i * 12, 16 + (i % 2) * 8, 8, 5, "#3987e5");
    }

    // coffee steam
    const sp = Math.floor(t / 300) % 3;
    rect(12 + (sp === 1 ? 1 : 0), 142 - sp * 2, 1, 2, "#ddd");
    // server LEDs
    for (let i = 0; i < 5; i++) {
      const on = rnd(Math.floor(t / 200) + i * 13) > 0.4;
      rect(368, 44 + i * 10, 2, 1, on ? (i % 2 ? "#39ff6a" : "#fab219") : "#333");
      rect(372, 44 + i * 10, 2, 1, rnd(Math.floor(t / 330) + i) > 0.5 ? "#39ff6a" : "#333");
    }
  }

  function render(t) {
    ctx.drawImage(bg, 0, 0);
    drawDynamic(t);
    const items = [];
    for (const a of AGENTS) {
      const s = STATIONS[a.id];
      items.push({ key: s.dy + 20, draw: () => drawStation(a.id, t) });
      const ch = chars[a.id];
      if (ch.mode !== "sit") items.push({ key: ch.y, draw: () => drawWalker(a.id, t) });
    }
    items.sort((p, q) => p.key - q.key).forEach((i) => i.draw());
    updateBubbles();
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
      const text = st === "done" ? "✓ " + (ag.activity || "done") : st === "failed" ? "✖ " + (ag.activity || "issues found") : st === "waiting" ? "… " + (ag.activity || "waiting") : ag.activity || "working…";
      if (b.textContent !== text) b.textContent = text;
      b.className = "bubble " + st;
      b.hidden = false;
      const s = STATIONS[a.id];
      place(b, s.dx + 18, s.dy - 17);
    }
  }

  // ---------- hover ----------
  function hitTest(lx, ly) {
    for (const a of AGENTS) {
      const ch = chars[a.id];
      if (ch.mode !== "sit" && lx >= ch.x - 7 && lx <= ch.x + 7 && ly >= ch.y - 18 && ly <= ch.y + 2) return a.id;
    }
    for (const a of AGENTS) {
      const { dx, dy } = STATIONS[a.id];
      if (lx >= dx && lx <= dx + 36 && ly >= dy - 14 && ly <= dy + 30) return a.id;
    }
    return null;
  }
  canvas.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    const lx = ((e.clientX - r.left) / r.width) * W;
    const ly = ((e.clientY - r.top) / r.height) * H;
    const id = hitTest(lx, ly);
    if (!id) {
      tip.hidden = true;
      canvas.style.cursor = "";
      return;
    }
    canvas.style.cursor = "pointer";
    const a = AGENT_BY_ID[id];
    const ag = state?.agents?.[id] || { state: "idle" };
    const meta = AGENT_STATE[ag.state] || AGENT_STATE.idle;
    const owned = (state?.tasks || []).filter((t) => t.owner === id);
    const doneN = owned.filter((t) => t.status === "done").length;
    tip.innerHTML =
      `<b>${esc(a.id)}</b>${esc(a.role)}<br>${meta.icon} ${meta.label}` +
      (ag.since ? ` <span class="muted">· ${fmtDur(now - ag.since)}</span>` : "") +
      (ag.activity ? `<br><span class="muted">${esc(ag.activity)}</span>` : "") +
      (owned.length ? `<br>Tasks: ${doneN}/${owned.length} done` : "") +
      (modelFor(state, id) ? `<br><span class="muted">model:</span> ${esc(modelFor(state, id).label)}${modelFor(state, id).actual ? "" : " <span class=\"muted\">(configured)</span>"}` : "") +
      (id === "manager" ? `<br><span class="muted">Click to chat 💬</span>` : "");
    tip.hidden = false;
    const ox = e.clientX - r.left + 14;
    tip.style.left = Math.min(ox, r.width - tip.offsetWidth - 4) + "px";
    tip.style.top = e.clientY - r.top + 14 + "px";
  });
  canvas.addEventListener("mouseleave", () => (tip.hidden = true));
  canvas.addEventListener("click", (e) => {
    const r = canvas.getBoundingClientRect();
    const id = hitTest(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
    if (id && onSelect) onSelect(id);
  });

  // Timer-driven rather than requestAnimationFrame: rAF pauses entirely in background tabs, which would
  // leave agents frozen mid-walk. Timers keep running (throttled), and a generous dt lets walkers catch up.
  let last = performance.now();
  setInterval(() => {
    const ts = performance.now();
    const dt = Math.min(2, (ts - last) / 1000);
    last = ts;
    now = Date.now();
    step(dt);
    render(ts);
  }, 1000 / 30);

  let first = true;
  return {
    update(next) {
      state = next;
      syncGoals(first);
      first = false;
    },
  };
}

function drawBackground(g) {
  const r = (x, y, w, h, c) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  // wall
  r(0, 0, W, WALL, "#3b3552");
  for (let x = 0; x < W; x += 16) r(x, 0, 1, WALL - 4, "#352f4a");
  r(0, WALL - 4, W, 4, "#241f33");
  r(0, WALL - 4, W, 1, "#4a4366");
  // floor — wooden planks
  for (let y = WALL; y < H; y += 6) {
    const row = (y - WALL) / 6;
    r(0, y, W, 6, row % 2 ? "#5b4636" : "#634c3a");
    r(0, y + 5, W, 1, "#4a382b");
    for (let x = (row % 3) * 14; x < W; x += 42) r(x, y, 1, 5, "#4a382b");
  }
  // rug in the lounge
  r(18, 164, 150, 46, "#6b2f3a");
  r(20, 166, 146, 42, "#7d3946");
  for (let x = 24; x < 162; x += 8) r(x, 168, 4, 38, "#86414f");
  // window
  r(14, 6, 64, 34, "#1d1a28");
  r(18, 10, 56, 26, "#6ec3ff");
  r(18, 28, 56, 8, "#9bd6ff");
  r(45, 10, 2, 26, "#1d1a28");
  r(18, 22, 56, 1, "#1d1a28");
  r(12, 38, 68, 3, "#2a2638");
  // bookshelf
  r(90, 8, 42, 38, "#5a3a22");
  r(92, 10, 38, 34, "#3a2414");
  const books = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9", "#e8e8e8"];
  for (let s = 0; s < 3; s++) {
    let x = 93;
    for (let i = 0; x < 128; i++) {
      const w = 2 + (i % 3 === 0 ? 1 : 0);
      const h = 7 + ((i * 5 + s) % 3);
      r(x, 10 + s * 11 + (10 - h), w, h, books[(i + s * 2) % books.length]);
      x += w + 1;
    }
    r(92, 20 + s * 11, 38, 1, "#5a3a22");
  }
  // whiteboard frame (stickies drawn live)
  r(150, 6, 88, 34, "#9e9e9e");
  r(152, 8, 84, 30, "#f4f4f0");
  r(150, 40, 88, 2, "#777");
  r(154, 38, 6, 2, "#d03b3b");
  r(162, 38, 6, 2, "#3987e5");
  // clock face
  r(256, 16, 13, 13, "#222");
  r(257, 17, 11, 11, "#f2f2f2");
  // poster
  r(284, 8, 30, 30, "#1b2433");
  r(286, 10, 26, 26, "#233249");
  for (const [x, y] of [[292, 16], [296, 14], [300, 16], [304, 20], [296, 22], [300, 26], [292, 28]]) r(x, y, 3, 3, "#fab219");
  // server rack
  r(360, 34, 18, 64, "#1c1c1c");
  for (let i = 0; i < 6; i++) r(362, 38 + i * 10, 14, 7, "#2c2c2c");
  // coffee machine + counter
  r(2, 146, 28, 30, "#4a4a4a");
  r(4, 144, 24, 4, "#5c5c5c");
  r(6, 150, 16, 12, "#2a2a2a");
  r(10, 160, 6, 5, "#f2f2f2");
  r(22, 151, 4, 2, "#d03b3b");
  // couch
  r(40, 190, 104, 20, "#2d4f7c");
  r(40, 190, 104, 6, "#3a6399");
  r(36, 192, 6, 18, "#24406a");
  r(142, 192, 6, 18, "#24406a");
  for (let x = 44; x < 140; x += 32) r(x, 197, 30, 1, "#24406a");
  // water cooler
  r(178, 170, 12, 22, "#d8d8d8");
  r(179, 160, 10, 11, "#8fd3ff");
  r(181, 178, 3, 2, "#3987e5");
  // plants
  const plant = (x, y) => {
    r(x + 2, y + 10, 8, 7, "#8b4a2b");
    r(x + 1, y + 9, 10, 2, "#a45b35");
    r(x + 4, y, 4, 10, "#1f7a2e");
    r(x, y + 3, 5, 3, "#2a9a3c");
    r(x + 7, y + 2, 5, 3, "#2a9a3c");
    r(x + 2, y - 2, 3, 3, "#36b24a");
    r(x + 7, y - 3, 3, 3, "#36b24a");
  };
  plant(362, 190);
  plant(4, 196);
  plant(140, 50);
  plant(346, 102);
}
