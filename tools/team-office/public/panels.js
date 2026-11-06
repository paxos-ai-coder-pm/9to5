import { AGENTS, AGENT_BY_ID, STATUS, AGENT_STATE, taskStatus, fmtDur, esc, modelFor } from "./agents.js";

const PHASES = ["plan", "build", "test", "fix", "review", "done"];
const PHASE_PCT = { idle: 0, plan: 5, build: 30, test: 60, fix: 70, review: 90, done: 100 };
const SVG = "http://www.w3.org/2000/svg";

// one floating tooltip shared by the graph and the timeline
const gtip = document.createElement("div");
gtip.className = "tip";
gtip.style.position = "fixed";
gtip.hidden = true;
document.body.appendChild(gtip);
function showTip(e, html) {
  gtip.innerHTML = html;
  gtip.hidden = false;
  const x = Math.min(e.clientX + 14, window.innerWidth - gtip.offsetWidth - 8);
  const y = Math.min(e.clientY + 14, window.innerHeight - gtip.offsetHeight - 8);
  gtip.style.left = x + "px";
  gtip.style.top = y + "px";
}
const hideTip = () => (gtip.hidden = true);

function el(tag, attrs = {}, text) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}

// ---------------- header ----------------
export function renderHeader(s) {
  const taskEl = document.getElementById("task");
  // "Current" only while a run is going (or paused mid-way); a finished, failed or stopped run is the last job.
  // Without an office run (a /team run in Claude Code) the board is all there is to go on.
  const going = s.run ? ["running", "waiting", "needs-answer"].includes(s.run.status) : !["done", "idle"].includes(s.phase);
  taskEl.textContent = s.task ? `${going ? "Current job" : "Last job"}: ${s.task}` : "";
  taskEl.title = s.task || "";
  taskEl.hidden = !s.task;
  // FIX only shows up once a fix loop actually happens (always showing it reads as "something will break")
  const phases = PHASES.filter((p) => p !== "fix" || s.loop || s.phase === "fix");
  const cur = phases.indexOf(s.phase);
  document.getElementById("phases").innerHTML = phases.map((p, i) => {
    let cls = "";
    if (i < cur) cls = "past";
    if (i === cur) cls = "now" + (p === "done" ? " done-phase" : "");
    const label = p === "fix" && s.loop ? `FIX ×${s.loop}` : p.toUpperCase();
    return `<li class="${cls}" ${i === cur ? 'aria-current="step"' : ""}>${label}</li>`;
  }).join("");

  const tasks = s.tasks || [];
  const done = tasks.filter((t) => t.status === "done").length;
  const blocked = tasks.filter((t) => t.status === "blocked").length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : PHASE_PCT[s.phase] || 0;
  document.getElementById("pct").textContent = pct;
  document.getElementById("heroSub").textContent = tasks.length
    ? `${done} / ${tasks.length} tasks${blocked ? ` · ${blocked} blocked` : ""}`
    : s.phase && s.phase !== "idle"
      ? `phase: ${s.phase}`
      : "waiting for a run";
  const bar = document.getElementById("bar");
  bar.setAttribute("aria-valuenow", pct);
  bar.querySelector("i").style.width = pct + "%";
}

// ---------------- roster ----------------
function modelBadge(mdl) {
  if (!mdl) return "";
  const tip = mdl.actual ? `Running on ${mdl.id}` : `Configured: ${mdl.id} (actual model shows once it runs)`;
  return `<span class="model${mdl.actual ? " actual" : ""}" title="${esc(tip)}">${esc(mdl.label)}</span>`;
}

export function renderRoster(s, now) {
  const lead = modelFor(s, "lead");
  const leadCard = `<li class="lead-card"><i class="sw" style="background:#f2f2ee"></i><div style="min-width:0">
      <span class="nm">team lead</span>
      <span class="st">Orchestrates the pipeline</span>
      ${modelBadge(lead) || `<span class="model" title="Runs you start with /team use your Claude Code session's model">Your session's model</span>`}</div></li>`;
  document.getElementById("roster").innerHTML =
    leadCard +
    AGENTS.map((a) => {
      const ag = s.agents?.[a.id] || { state: "idle" };
      const m = AGENT_STATE[ag.state] || AGENT_STATE.idle;
      return `<li><i class="sw" style="background:${a.color}"></i><div style="min-width:0">
      <span class="nm">${a.id}</span>
      <span class="st">${m.label}${ag.since && ag.state !== "idle" ? ` · ${fmtDur(now - ag.since)}` : ""}</span>
      <span class="ac" title="${esc(ag.activity)}">${esc(ag.activity || a.role)}</span>
      ${modelBadge(modelFor(s, a.id))}</div></li>`;
    }).join("");
}

// ---------------- execution graph ----------------
export function renderLegends() {
  document.getElementById("legend").innerHTML = Object.entries(STATUS)
    .map(([k, v]) => `<li><span class="chip ${k}" aria-hidden="true"></span>${v.label}</li>`)
    .join("");
  document.getElementById("tlLegend").innerHTML =
    `<li><span class="sw-box" style="background:linear-gradient(90deg,${AGENTS.slice(0, 4).map((a) => a.color).join(",")})"></span>Working (agent color)</li>` +
    `<li><span class="sw-box" style="border:2px solid var(--text-muted)"></span>Waiting</li>` +
    `<li><span class="chip blocked" aria-hidden="true"></span>Found issues</li>` +
    `<li><span class="chip done" aria-hidden="true"></span>Finished</li>`;
}

export function renderGraph(s) {
  const host = document.getElementById("graph");
  const tasks = s.tasks || [];
  if (!tasks.length) {
    host.innerHTML = `<div class="empty">No execution graph yet — the architect creates it during PLAN.</div>`;
    renderTable(s);
    return;
  }
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const level = {};
  const lv = (t, seen = new Set()) => {
    if (level[t.id] != null) return level[t.id];
    if (seen.has(t.id)) return 0;
    seen.add(t.id);
    const deps = (t.depends_on || []).map((d) => byId[d]).filter(Boolean);
    return (level[t.id] = deps.length ? 1 + Math.max(...deps.map((d) => lv(d, seen))) : 0);
  };
  tasks.forEach((t) => lv(t));
  const cols = [];
  [...tasks].sort((a, b) => a.order - b.order).forEach((t) => (cols[level[t.id]] ||= []).push(t));

  // top-down layered layout: one row per dependency depth, rows centered
  const NW = 150, NH = 58, CG = 14, RG = 30, P = 6;
  const widest = Math.max(...cols.map((c) => c.length));
  const width = P * 2 + widest * (NW + CG) - CG;
  const height = P * 2 + cols.length * (NH + RG) - RG;
  const pos = {};
  cols.forEach((row, r) => {
    const off = (width - (row.length * (NW + CG) - CG)) / 2;
    row.forEach((t, i) => (pos[t.id] = { x: off + i * (NW + CG), y: P + r * (NH + RG) }));
  });
  // shrink to fit the panel (down to 70%), otherwise scroll
  const fit = Math.max(0.7, Math.min(1, (host.clientWidth - 4) / width));
  const svg = el("svg", { width: width * fit, height: height * fit, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Task dependency graph" });

  for (const t of tasks) {
    for (const d of t.depends_on || []) {
      if (!pos[d]) continue;
      const a = pos[d], b = pos[t.id];
      const x1 = a.x + NW / 2, y1 = a.y + NH, x2 = b.x + NW / 2, y2 = b.y;
      const my = (y1 + y2) / 2;
      svg.appendChild(el("path", { class: "edge" + (byId[d].status === "done" ? " live" : ""), d: `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2 - 2}` }));
      svg.appendChild(el("rect", { x: x2 - 2, y: y2 - 4, width: 4, height: 4, fill: byId[d].status === "done" ? "var(--ink)" : "var(--grid)" }));
    }
  }
  for (const t of tasks) {
    const st = taskStatus(t, tasks);
    const { x, y } = pos[t.id];
    const g = el("g", { class: `node ${st}`, transform: `translate(${x},${y})`, tabindex: 0 });
    g.appendChild(el("rect", { class: "frame", x: 1, y: 1, width: NW - 2, height: NH - 2 }));
    g.appendChild(el("rect", { class: "mark", x: 7, y: 7, width: 16, height: 16, fill: { done: "var(--good)", active: "var(--active)", ready: "var(--ready)", blocked: "var(--critical)", pending: "transparent" }[st], "stroke-dasharray": st === "pending" ? "3 2" : "none" }));
    g.appendChild(el("text", { class: "id", x: 30, y: 18 }, `${t.id} · ${STATUS[st].label.toUpperCase()}`));
    const owner = AGENT_BY_ID[t.owner];
    if (owner) g.appendChild(el("rect", { x: NW - 14, y: 7, width: 8, height: 8, fill: owner.color }));
    wrap(t.title, 17, 2).forEach((line, i) => g.appendChild(el("text", { class: "ttl" + (st === "pending" ? " dim" : ""), x: 8, y: 38 + i * 14 }, line)));
    const hit = el("rect", { class: "hit", width: NW, height: NH });
    g.appendChild(hit);
    const html = () =>
      `<b>${esc(t.id)} · ${STATUS[st].label}</b>${esc(t.title)}` +
      (t.owner ? `<br><span class="muted">owner:</span> ${esc(t.owner)}` : "") +
      (t.depends_on?.length ? `<br><span class="muted">depends on:</span> ${esc(t.depends_on.join(", "))}` : "") +
      (t.verify?.length ? `<br><span class="muted">verify:</span> ${esc(t.verify.join(" && "))}` : "") +
      (t.reason ? `<br><span class="muted">note:</span> ${esc(t.reason)}` : "") +
      (t.source ? `<br><span class="muted">source:</span> ${esc(t.source)}` : "");
    g.addEventListener("mousemove", (e) => showTip(e, html()));
    g.addEventListener("mouseleave", hideTip);
    svg.appendChild(g);
  }
  host.replaceChildren(svg);
  renderTable(s);
}

function wrap(text, max, lines) {
  const out = [];
  let cur = "";
  for (const word of text.split(/\s+/)) {
    if (!cur) cur = word;
    else if ((cur + " " + word).length <= max) cur += " " + word;
    else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  const res = out.slice(0, lines).map((l) => (l.length > max ? l.slice(0, max - 1) + "…" : l));
  if (out.length > lines) res[lines - 1] = res[lines - 1].slice(0, max - 1) + "…";
  return res;
}

function renderTable(s) {
  const tasks = s.tasks || [];
  document.getElementById("tableWrap").innerHTML = tasks.length
    ? `<table><thead><tr><th>ID</th><th>STATUS</th><th>TASK</th><th>OWNER</th><th>DEPENDS ON</th></tr></thead><tbody>${tasks
        .map((t) => {
          const st = taskStatus(t, tasks);
          return `<tr><td>${esc(t.id)}</td><td><span class="chip ${st}" aria-hidden="true"></span> ${STATUS[st].label}</td><td>${esc(t.title)}${t.reason ? `<br><span class="muted">${esc(t.reason)}</span>` : ""}</td><td>${esc(t.owner || "—")}</td><td class="muted">${esc((t.depends_on || []).join(", ") || "—")}</td></tr>`;
        })
        .join("")}</tbody></table>`
    : `<div class="empty">No tasks yet.</div>`;
}

// ---------------- timeline (Gantt of agent activity) ----------------
function niceStep(span) {
  const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200].map((x) => x * 1000);
  return steps.find((st) => span / st <= 7) || steps[steps.length - 1];
}

export function renderTimeline(s, now) {
  const host = document.getElementById("timeline");
  const events = s.events || [];
  if (!s.startedAt || !events.length) {
    host.innerHTML = `<div class="empty">Agent activity will appear here once a run starts.</div>`;
    return;
  }
  const t0 = s.startedAt;
  const lastT = events[events.length - 1].t;
  // leave room after the last event so end-of-run markers aren't clipped
  const t1 = s.phase === "done" ? lastT + Math.max(2000, (lastT - t0) * 0.04) : Math.max(now, t0 + 1000);
  const LW = 104, RH = 24, TOP = 30, P = 8;
  const width = Math.max(420, host.clientWidth);
  const plotW = width - LW - P;
  const height = TOP + AGENTS.length * RH + 24;
  const X = (t) => LW + ((t - t0) / (t1 - t0)) * plotW;
  const svg = el("svg", { width, height, role: "img", "aria-label": "Agent activity over time" });

  // grid + axis
  const stepMs = niceStep(t1 - t0);
  for (let t = 0; t <= t1 - t0; t += stepMs) {
    svg.appendChild(el("line", { class: "gridline", x1: X(t0 + t), x2: X(t0 + t), y1: TOP - 4, y2: height - 20 }));
    svg.appendChild(el("text", { class: "axis", x: X(t0 + t), y: height - 4, "text-anchor": t === 0 ? "start" : "middle" }, fmtDur(t)));
  }

  // phase strip
  const phaseEv = events.filter((e) => e.type === "phase");
  phaseEv.forEach((e, i) => {
    const end = phaseEv[i + 1]?.t ?? t1;
    const x = X(e.t), w = Math.max(1, X(end) - x - 2);
    svg.appendChild(el("rect", { x, y: 4, width: w, height: 16, fill: i % 2 ? "var(--paper-2)" : "var(--grid)" }));
    if (w > 34) svg.appendChild(el("text", { x: x + 4, y: 17, "font-size": 15 }, e.phase.toUpperCase()));
  });
  if (!phaseEv.length) svg.appendChild(el("text", { x: LW, y: 17, class: "axis" }, "phases"));
  svg.appendChild(el("text", { x: 0, y: 17, class: "axis" }, "phase"));

  AGENTS.forEach((a, row) => {
    const y = TOP + row * RH;
    svg.appendChild(el("rect", { x: 0, y: y + 7, width: 8, height: 8, fill: a.color }));
    svg.appendChild(el("text", { class: "row-label", x: 14, y: y + 16 }, a.id));
    svg.appendChild(el("line", { class: "gridline", x1: LW, x2: width - P, y1: y + RH - 1, y2: y + RH - 1 }));
    const evs = events.filter((e) => e.type === "state" && e.agent === a.id);
    evs.forEach((e, i) => {
      const end = evs[i + 1]?.t ?? t1;
      const x = X(e.t) + 1;
      const w = Math.max(2, X(end) - X(e.t) - 2);
      const by = y + 5, bh = RH - 10;
      let mark = null;
      if (e.state === "working") mark = el("rect", { x, y: by, width: w, height: bh, fill: a.color });
      else if (e.state === "waiting") mark = el("rect", { x: x + 1, y: by + 1, width: Math.max(1, w - 2), height: bh - 2, fill: "none", stroke: "var(--text-muted)", "stroke-width": 2 });
      else if (e.state === "failed") {
        mark = el("g");
        mark.appendChild(el("rect", { x, y: by, width: Math.max(12, Math.min(w, 16)), height: bh, fill: "var(--critical)" }));
      } else if (e.state === "done") {
        mark = el("g");
        mark.appendChild(el("rect", { x, y: by, width: 12, height: bh, fill: "var(--good)" }));
      }
      if (!mark) return;
      svg.appendChild(mark);
      const hit = el("rect", { class: "bar-hit", x: X(e.t), y, width: Math.max(12, X(end) - X(e.t)), height: RH });
      const m = AGENT_STATE[e.state] || AGENT_STATE.idle;
      hit.addEventListener("mousemove", (ev) =>
        showTip(ev, `<b>${esc(a.id)} · ${m.label}</b>${esc(e.msg || "")}<br><span class="muted">${fmtDur(e.t - t0)} → ${fmtDur(end - t0)} · ${fmtDur(end - e.t)}</span>`),
      );
      hit.addEventListener("mouseleave", hideTip);
      svg.appendChild(hit);
    });
  });
  if (s.phase !== "done") svg.appendChild(el("line", { class: "now", x1: X(t1), x2: X(t1), y1: TOP - 4, y2: height - 20 }));
  host.replaceChildren(svg);
}

// ---------------- activity log ----------------
export function renderLog(s) {
  const ol = document.getElementById("log");
  const atBottom = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 30;
  const evs = (s.events || []).slice(-120);
  ol.innerHTML = evs
    .map((e) => {
      const a = AGENT_BY_ID[e.agent];
      const bad = e.state === "failed" || e.status === "blocked";
      const good = e.state === "done" || e.status === "done";
      const cls = e.type === "phase" ? "phase" : bad ? "bad" : good ? "good" : "";
      const time = new Date(e.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const who = a ? `<span class="who"><i style="background:${a.color}"></i>${a.id}</span>` : `<span class="who">system</span>`;
      return `<li class="${cls}"><time>${time}</time>${who}<span class="msg">${esc(e.msg)}</span></li>`;
    })
    .join("");
  if (atBottom) ol.scrollTop = ol.scrollHeight;
}
