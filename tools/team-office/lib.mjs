// Shared state helpers for the team office CLI (team.mjs) and server (server.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DIR = path.join(ROOT, ".claude", "team");
export const STATE_FILE = path.join(DIR, "state.json");
export const CHAT_FILE = path.join(DIR, "chat.json");
const LOCK = path.join(DIR, ".lock");

export const AGENTS = ["architect", "dev-1", "dev-2", "tester-api", "tester-ui", "tester-edge", "reviewer", "manager"];
export const AGENT_STATES = ["idle", "working", "waiting", "done", "failed"];
export const PHASES = ["plan", "build", "test", "fix", "review", "done"];

export function emptyState(task = "") {
  const now = Date.now();
  return {
    task,
    phase: task ? "plan" : "idle",
    loop: 0,
    startedAt: now,
    updatedAt: now,
    agents: Object.fromEntries(AGENTS.map((a) => [a, { state: "idle", activity: "", since: now }])),
    tasks: [],
    events: [],
  };
}

export function emptyChat() {
  return { sessionId: null, busy: false, updatedAt: Date.now(), messages: [], inbox: [] };
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Several processes (both devs, the server) write concurrently, so serialize read-modify-write with a lock directory.
export function withLock(fn) {
  fs.mkdirSync(DIR, { recursive: true });
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      fs.mkdirSync(LOCK);
      break;
    } catch {
      try {
        if (Date.now() - fs.statSync(LOCK).mtimeMs > 10000) fs.rmSync(LOCK, { recursive: true, force: true });
      } catch {}
      if (Date.now() > deadline) throw new Error("Could not acquire lock on " + LOCK);
      sleep(50);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(LOCK, { recursive: true, force: true });
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback();
  }
}

function writeJson(file, data) {
  data.updatedAt = Date.now();
  const tmp = file + "." + process.pid + ".tmp";
  const body = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, body);
  // On Windows the rename fails (EPERM/EBUSY) while another process or OneDrive briefly has the file open — retry,
  // then fall back to writing in place.
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(e.code)) throw e;
      if (i >= 10) {
        fs.writeFileSync(file, body);
        fs.rmSync(tmp, { force: true });
        return;
      }
      sleep(30 + i * 20);
    }
  }
}

export const readState = () => {
  const s = readJson(STATE_FILE, emptyState);
  for (const a of AGENTS) s.agents[a] ||= { state: "idle", activity: "", since: Date.now() };
  return s;
};
export const writeState = (s) => {
  s.events = s.events.slice(-500);
  writeJson(STATE_FILE, s);
};
export const readChat = () => readJson(CHAT_FILE, emptyChat);
export const writeChat = (c) => {
  c.messages = c.messages.slice(-300);
  c.inbox = c.inbox.slice(-100);
  writeJson(CHAT_FILE, c);
};

export function event(state, e) {
  state.events.push({ t: Date.now(), ...e });
}

// Update state / chat atomically: fn receives the parsed object and mutates it.
export const updateState = (fn) => withLock(() => { const s = readState(); const r = fn(s); writeState(s); return r; });
export const updateChat = (fn) => withLock(() => { const c = readChat(); const r = fn(c); writeChat(c); return r; });

export function setAgent(state, name, st, activity = "") {
  state.agents[name] = { state: st, activity, since: Date.now() };
  event(state, { type: "state", agent: name, state: st, msg: activity || st });
}

// Environment for spawning the Claude CLI. Drops CLAUDECODE (lets it run from inside a Claude Code session) and,
// when requests go to Anthropic, stale non-Claude model overrides inherited from a parent process (e.g. an old
// MiniMax setup) — those would make the CLI request a model Anthropic doesn't serve.
export function claudeEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.CLAUDECODE;
  // Started from inside a Claude app session (e.g. its preview pane)? That session's private auth token is inherited
  // but isn't valid for the standalone CLI, and it would override your own `claude auth login`. Drop it.
  // The app also routes its sessions through its own endpoint (ANTHROPIC_BASE_URL), which rejects normal logins.
  if (env.CLAUDE_CODE_ENTRYPOINT || env.CLAUDE_AGENT_SDK_VERSION) {
    for (const k of ["CLAUDE_CODE_ENTRYPOINT", "CLAUDE_AGENT_SDK_VERSION", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]) delete env[k];
  }
  const anthropic = !env.ANTHROPIC_BASE_URL || /api\.anthropic\.com/.test(env.ANTHROPIC_BASE_URL);
  if (anthropic) {
    if (env.ANTHROPIC_BASE_URL) delete env.ANTHROPIC_BASE_URL;
    for (const k of ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_SMALL_FAST_MODEL"]) {
      if (env[k] && !/claude|opus|sonnet|haiku|fable/i.test(env[k])) delete env[k];
    }
  }
  return env;
}

// Record the model an agent actually ran on ("lead" = the orchestrating session). Returns true if it changed.
export function setModel(state, agent, model) {
  if (!model || state.models?.[agent] === model) return false;
  state.models = { ...(state.models || {}), [agent]: model };
  return true;
}

// Configured model per agent, from the `model:` field of .claude/agents/*.md frontmatter.
export function configuredModels() {
  const dir = path.join(ROOT, ".claude", "agents");
  const out = {};
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      const fm = fs.readFileSync(path.join(dir, f), "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const name = fm?.[1].match(/^name:\s*(.+)$/m)?.[1].trim() || f.slice(0, -3);
      out[name] = fm?.[1].match(/^model:\s*(.+)$/m)?.[1].trim() || "inherit";
    }
  } catch {}
  return out;
}

export function readyIds(state) {
  const done = new Set(state.tasks.filter((t) => t.status === "done").map((t) => t.id));
  return state.tasks.filter((t) => t.status === "pending" && (t.depends_on || []).every((d) => done.has(d))).map((t) => t.id);
}

export function summary(s) {
  const ready = readyIds(s);
  const by = (st) => s.tasks.filter((t) => t.status === st);
  const fmt = (t) => `  ${t.id} ${t.title}${t.owner ? ` [${t.owner}]` : ""}${t.reason ? ` — ${t.reason}` : ""}${t.source ? `\n      source: ${t.source}` : ""}`;
  return [
    `Task: ${s.task || "(none)"}`,
    `Phase: ${s.phase}${s.loop ? ` (fix loop ${s.loop})` : ""}`,
    `Done: ${by("done").length}/${s.tasks.length}`,
    "Active:\n" + (by("active").map(fmt).join("\n") || "  —"),
    "Blocked:\n" + (by("blocked").map(fmt).join("\n") || "  —"),
    "Ready:\n" + (s.tasks.filter((t) => ready.includes(t.id)).map(fmt).join("\n") || "  —"),
    "Agents:\n" + AGENTS.map((a) => `  ${a}: ${s.agents[a]?.state}${s.agents[a]?.activity ? ` — ${s.agents[a].activity}` : ""}`).join("\n"),
  ].join("\n");
}
