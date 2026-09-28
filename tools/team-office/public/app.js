import { createOffice } from "./office.js";
import { renderHeader, renderRoster, renderLegends, renderGraph, renderTimeline, renderLog } from "./panels.js";
import { createDemo } from "./demo.js";
import { createChat } from "./chat.js";

const chat = createChat({ onSpeaking: (on, text) => office.setSpeaking(on, text) });
const office = createOffice({
  canvas: document.getElementById("canvas"),
  overlay: document.getElementById("overlay"),
  tip: document.getElementById("tip"),
  onSelect: (id) => id === "manager" && chat.open(),
});

let mode = new URLSearchParams(location.search).has("demo") ? "demo" : "live";
let state = {};
let lastStamp = 0;

function apply(next) {
  state = next;
  office.update(state);
  renderHeader(state);
  renderGraph(state);
  renderLog(state);
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
    const empty = !s.task;
    $("banner").hidden = !empty;
    const stamp = s.updatedAt || -1;
    if (stamp !== lastStamp) {
      lastStamp = stamp;
      // Between runs only agent states matter (e.g. the manager answering chat).
      apply(empty ? { phase: "idle", agents: s.agents || {}, tasks: [], events: [] } : s);
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
setMode(mode);
setInterval(() => {
  poll();
  tick();
}, 1000);
