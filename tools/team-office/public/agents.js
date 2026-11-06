// Agent identity. Colors are the validated dark-mode categorical palette, in fixed slot order
// (all 8 slots validated: worst adjacent CVD ΔE 8.4, all ≥3:1 on #1a1a19) — the same color marks an agent everywhere on the page.
// `name` + `job` are what a non-developer sees (simple view, chat, phone); `id` + `role` are the technical view.
export const AGENTS = [
  { id: "architect", name: "Asha", job: "Plans the work", role: "Planner / Architect", color: "#3987e5", hair: "#3b2412", skin: "#f1c27d", pants: "#2d3a55", acc: "hardhat" },
  { id: "dev-1", name: "Ben", job: "Builds it", role: "Developer · Package A", color: "#d95926", hair: "#141414", skin: "#c68642", pants: "#2f2f2f", acc: "headphones" },
  { id: "dev-2", name: "Chloe", job: "Builds it", role: "Developer · Package B", color: "#199e70", hair: "#8a3f1d", skin: "#ffdbac", pants: "#3a3350", acc: "headphones", long: true },
  { id: "tester-api", name: "Diego", job: "Checks that it works", role: "Tester · API & logic", color: "#c98500", hair: "#5a3418", skin: "#e0ac69", pants: "#2b3b2b", acc: "cap" },
  { id: "tester-ui", name: "Emma", job: "Checks it's easy to use", role: "Tester · UI / E2E", color: "#d55181", hair: "#e3c16f", skin: "#f5d0a9", pants: "#29324a", acc: "cap", long: true },
  { id: "tester-edge", name: "Farid", job: "Checks it's safe", role: "Tester · Security", color: "#008300", hair: "#262626", skin: "#8d5524", pants: "#3b2b2b", acc: "cap" },
  { id: "reviewer", name: "Grace", job: "Does the final check", role: "Reviewer", color: "#9085e9", hair: "#bdbdbd", skin: "#ffdbac", pants: "#333333", acc: "glasses" },
  { id: "manager", name: "Maya", job: "Your manager", role: "Manager · your contact", color: "#e66767", hair: "#4a2a14", skin: "#d9a066", pants: "#1f1f1f", acc: "headset" },
];
export const AGENT_BY_ID = Object.fromEntries(AGENTS.map((a) => [a.id, a]));

// "Asha" in the simple view, "architect" behind the scenes
export const displayName = (id, simple = true) => (simple ? AGENT_BY_ID[id]?.name : null) || id;

// The pipeline in plain words: five steps (fixing is part of checking).
export const STEPS = [
  { key: "plan", label: "Planning", text: "Asha is working out what to build" },
  { key: "build", label: "Building", text: "Ben and Chloe are building it" },
  { key: "test", label: "Checking", text: "Diego, Emma and Farid are trying it out" },
  { key: "review", label: "Final check", text: "Grace is checking everything one last time" },
  { key: "done", label: "Ready", text: "Done" },
];
export const stepIndex = (phase) => ({ plan: 0, build: 1, test: 2, fix: 2, review: 3, done: 4 })[phase] ?? -1;

// A task in words the user understands: the architect's "plain" title if it gave one
export const taskLabel = (t, simple = true) => (simple && t.plain) || t.title;

export const STATUS = {
  done: { label: "Done" },
  active: { label: "Active" },
  ready: { label: "Ready" },
  blocked: { label: "Blocked" },
  pending: { label: "Pending" },
};

export const AGENT_STATE = {
  idle: { label: "On break" },
  working: { label: "Working" },
  waiting: { label: "Waiting" },
  done: { label: "Done" },
  failed: { label: "Found something to fix" },
};

// A pending task whose dependencies are all done is "ready" (AmnesiaGraph semantics).
export function taskStatus(task, tasks) {
  if (task.status !== "pending") return task.status;
  const done = new Set(tasks.filter((t) => t.status === "done").map((t) => t.id));
  return (task.depends_on || []).every((d) => done.has(d)) ? "ready" : "pending";
}

// "claude-opus-5-5" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5", "sonnet" → "Sonnet", "inherit" → "Same as lead"
export function prettyModel(id) {
  if (!id) return "";
  const m = String(id).match(/(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/i);
  const cap = (s) => s[0].toUpperCase() + s.slice(1).toLowerCase();
  if (m) return `${cap(m[1])} ${m[2]}${m[3] ? "." + m[3] : ""}`;
  if (id === "inherit") return "Same as lead";
  return /^[a-z]+$/.test(id) ? cap(id) : id;
}

// Actual model if a run/chat has reported one, else the configured alias from the agent's definition.
export function modelFor(state, agentId) {
  const actual = state?.models?.[agentId];
  if (actual) return { label: prettyModel(actual), id: actual, actual: true };
  const conf = state?.configuredModels?.[agentId];
  return conf ? { label: prettyModel(conf), id: conf, actual: false } : null;
}

export function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// The letters on the logo tile: the studio name's initials ("Vikrant's Dev Studio" → "VDS"), shared with the launch page
export function getInitials(name) {
  // the first letter of each word — "Vikrant's" is one word, not "Vikrant" + "s"
  const letters = String(name || "").split(/\s+/).map((w) => w.match(/[A-Za-z]/)?.[0]).filter(Boolean);
  return letters.length >= 2 ? letters.slice(0, 4).join("").toUpperCase() : "VDS";
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
