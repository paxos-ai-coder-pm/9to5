import { createOffice } from "./office.js";
import { renderHeader, renderRoster, renderLegends, renderGraph, renderTimeline, renderLog } from "./panels.js";
import { createDemo } from "./demo.js";
import { createChat } from "./chat.js";
import { createStudio } from "./studio.js";
import { createPhone } from "./phone.js";

createPhone();

const chat = createChat();
const studio = createStudio({ chat });
const office = createOffice({
  canvas: document.getElementById("canvas"),
  overlay: document.getElementById("overlay"),
  tip: document.getElementById("tip"),
  onSelect: (id) => id === "manager" && chat.open(),
});

let mode = new URLSearchParams(location.search).has("demo") ? "demo" : "live";
let state = {};
let lastStamp = 0;
let configuredModels = {}; // from the agents' definitions; shown until a run reports actual models

function apply(next) {
  state = { ...next, configuredModels };
  office.update(state);
  renderHeader(state);
  renderGraph(state);
  renderLog(state);
  studio.update(state, mode);
  tick();
}

// cheap per-second refresh for durations and the timeline's "now" line
function tick() {
  const now = Date.now();
  renderRoster(state, now);
  renderTimeline(state, now);
}

const demo = createDemo(apply);
const $ = (id) => document.getElementById(id);

function setMode(m) {
  mode = m;
  $("demoBanner").hidden = m !== "demo";
  const url = new URL(location.href);
  m === "demo" ? url.searchParams.set("demo", "") : url.searchParams.delete("demo");
  history.replaceState(null, "", url);
  if (m === "demo") {
    $("banner").hidden = true;
    demo.start();
  } else {
    demo.stop();
    lastStamp = 0;
    poll();
  }
}

async function poll() {
  if (mode !== "live") return;
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    const s = await res.json();
    configuredModels = s.configuredModels || configuredModels;
    $("banner").hidden = true;
    const empty = !s.task;
    // re-render on board changes and on run status changes (paused / resumed / finished don't touch the board)
    const stamp = `${s.updatedAt || -1}|${s.run?.status}|${s.run?.attempts}|${s.ask?.answered || s.ask?.t || ""}`;
    if (stamp !== lastStamp) {
      lastStamp = stamp;
      // A run that ended without reaching DONE leaves a stale board (phase stuck at e.g. PLAN, agents mid-task).
      // Show it as idle so nobody looks busy; the tasks and log stay visible for reference.
      const ended = s.run && !["running", "waiting"].includes(s.run.status);
      if (!empty && ended && s.phase !== "done") {
        const agents = Object.fromEntries(Object.entries(s.agents || {}).map(([id, a]) => [id, id === "manager" ? a : { ...a, state: "idle", activity: "" }]));
        return apply({ ...s, phase: "idle", agents, ask: s.ask?.answered ? null : s.ask });
      }
      // Between runs only agent states (e.g. the manager answering chat), models, the run and questions matter.
      apply(empty ? { phase: "idle", agents: s.agents || {}, models: s.models || {}, run: s.run, ask: s.ask, tasks: [], events: [] } : s);
    }
  } catch {
    $("banner").hidden = false;
  }
}

$("demoBtn").onclick = () => setMode("demo");
$("replayBtn").onclick = () => demo.start();
$("liveBtn").onclick = () => setMode("live");
$("tableBtn").onclick = (e) => {
  const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
  e.currentTarget.setAttribute("aria-pressed", on);
  $("graph").hidden = on;
  $("tableWrap").hidden = !on;
};
window.addEventListener("resize", tick);

renderLegends();
apply({ phase: "idle", agents: {}, tasks: [], events: [] });
// demo mode never polls, so fetch the configured models once for the roster
fetch("/api/state", { cache: "no-store" })
  .then((r) => r.json())
  .then((s) => {
    configuredModels = s.configuredModels || {};
    if (mode === "demo") apply(state);
  })
  .catch(() => {});
setMode(mode);
setInterval(() => {
  poll();
  tick();
  if (mode === "live") studio.update(state, mode); // keeps "resumes at … / in N min" text fresh
}, 1000);
