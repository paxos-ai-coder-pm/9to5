import { createOffice } from "./office.js";
import { renderHeader, renderRoster, renderLegends, renderGraph, renderTimeline, renderLog } from "./panels.js";
import { createDemo } from "./demo.js";
import { createChat } from "./chat.js";
import { createStudio } from "./studio.js";
import { createPhone } from "./phone.js";
import { createPortfolio } from "./portfolio.js";
import { createProgress } from "./progress.js";
import { createSetup } from "./setup.js";
import { isSimple, setView } from "./ui.js";

createPhone();

const setup = createSetup({ onSettings: () => poll() });
const chat = createChat({ onSetup: () => setup.show() });
const studio = createStudio({ chat, setup });
const portfolio = createPortfolio({ chat });
const progress = createProgress({ chat, getProjects: portfolio.projects, onDemo: () => setMode("demo") });
const office = createOffice({
  canvas: document.getElementById("canvas"),
  overlay: document.getElementById("overlay"),
  tip: document.getElementById("tip"),
  onSelect: (id) => id === "manager" && chat.open(),
});

const $ = (id) => document.getElementById(id);
let mode = new URLSearchParams(location.search).has("demo") ? "demo" : "live";
let state = {};
let lastStamp = 0;
let lastRunStatus;
window.addEventListener("portfolio", () => progress.update(state, mode));
let configuredModels = {}; // from the agents' definitions; shown until a run reports actual models

function apply(next) {
  state = { ...next, configuredModels };
  office.update(state);
  renderHeader(state);
  if (!isSimple()) {
    renderGraph(state);
    renderLog(state);
  }
  studio.update(state, mode);
  progress.update(state, mode);
  tick();
}

// ---- Simple (default) ⇄ Behind the scenes ----
function paintView() {
  const simple = isSimple();
  $("viewSimple").setAttribute("aria-pressed", String(simple));
  $("viewTech").setAttribute("aria-pressed", String(!simple));
  office.setSimple(simple);
}
$("viewSimple").onclick = () => setView("simple");
$("viewTech").onclick = () => setView("tech");
window.addEventListener("viewchange", () => {
  paintView();
  apply(state);
});

// cheap per-second refresh for durations and the timeline's "now" line
function tick() {
  if (isSimple()) return; // the roster and timeline are behind the scenes
  const now = Date.now();
  renderRoster(state, now);
  renderTimeline(state, now);
}

const demo = createDemo(apply);

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
    const stamp = `${s.updatedAt || -1}|${s.run?.status}|${s.run?.attempts}|${s.ask?.answered || s.ask?.t || ""}|${s.studioName}|${s.minutesLeft}`;
    if (stamp !== lastStamp) {
      lastStamp = stamp;
      // a run that just finished (or started) changes the projects — don't wait for the next refresh
      if (s.run?.status !== lastRunStatus) {
        lastRunStatus = s.run?.status;
        portfolio.refresh();
      }
      // A run that ended without reaching DONE leaves a stale board (phase stuck at e.g. PLAN, agents mid-task).
      // Show it as idle so nobody looks busy; the tasks and log stay visible for reference.
      const ended = s.run && !["running", "waiting", "needs-answer"].includes(s.run.status);
      if (!empty && ended && s.phase !== "done") {
        const agents = Object.fromEntries(Object.entries(s.agents || {}).map(([id, a]) => [id, id === "manager" ? a : { ...a, state: "idle", activity: "" }]));
        return apply({ ...s, phase: "idle", agents, ask: s.ask?.answered ? null : s.ask });
      }
      // Between runs only agent states (e.g. the manager answering chat), models, the run and questions matter.
      apply(empty ? { phase: "idle", agents: s.agents || {}, models: s.models || {}, run: s.run, ask: s.ask, studioName: s.studioName, tasks: [], events: [] } : s);
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
paintView();
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
  if (mode === "live") {
    studio.update(state, mode); // keeps "resumes at … / in N min" text fresh
    progress.update(state, mode);
  }
}, 1000);
