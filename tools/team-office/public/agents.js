// Agent identity. Colors are the validated dark-mode categorical palette, in fixed slot order
// (all 8 slots validated: worst adjacent CVD ΔE 8.4, all ≥3:1 on #1a1a19) — the same color marks an agent everywhere on the page.
export const AGENTS = [
  { id: "architect", role: "Planner / Architect", color: "#3987e5", hair: "#3b2412", skin: "#f1c27d", pants: "#2d3a55", acc: "hardhat" },
  { id: "dev-1", role: "Developer · Package A", color: "#d95926", hair: "#141414", skin: "#c68642", pants: "#2f2f2f", acc: "headphones" },
  { id: "dev-2", role: "Developer · Package B", color: "#199e70", hair: "#8a3f1d", skin: "#ffdbac", pants: "#3a3350", acc: "headphones", long: true },
  { id: "tester-api", role: "Tester · API & logic", color: "#c98500", hair: "#5a3418", skin: "#e0ac69", pants: "#2b3b2b", acc: "cap" },
  { id: "tester-ui", role: "Tester · UI / E2E", color: "#d55181", hair: "#e3c16f", skin: "#f5d0a9", pants: "#29324a", acc: "cap", long: true },
  { id: "tester-edge", role: "Tester · Security", color: "#008300", hair: "#262626", skin: "#8d5524", pants: "#3b2b2b", acc: "cap" },
  { id: "reviewer", role: "Reviewer", color: "#9085e9", hair: "#bdbdbd", skin: "#ffdbac", pants: "#333333", acc: "glasses" },
  { id: "manager", role: "Manager · your contact", color: "#e66767", hair: "#4a2a14", skin: "#d9a066", pants: "#1f1f1f", acc: "headset" },
];
export const AGENT_BY_ID = Object.fromEntries(AGENTS.map((a) => [a.id, a]));

export const STATUS = {
  done: { icon: "✓", label: "Done" },
  active: { icon: "▶", label: "Active" },
  ready: { icon: "◆", label: "Ready" },
  blocked: { icon: "✖", label: "Blocked" },
  pending: { icon: "○", label: "Pending" },
};

export const AGENT_STATE = {
  idle: { icon: "☕", label: "On break" },
  working: { icon: "⌨", label: "Working" },
  waiting: { icon: "…", label: "Waiting" },
  done: { icon: "✓", label: "Done" },
  failed: { icon: "✖", label: "Found issues" },
};

// A pending task whose dependencies are all done is "ready" (AmnesiaGraph semantics).
export function taskStatus(task, tasks) {
  if (task.status !== "pending") return task.status;
  const done = new Set(tasks.filter((t) => t.status === "done").map((t) => t.id));
  return (task.depends_on || []).every((d) => done.has(d)) ? "ready" : "pending";
}

export function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
