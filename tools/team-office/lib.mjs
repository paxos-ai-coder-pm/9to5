// Shared state helpers for the team office CLI (team.mjs) and server (server.mjs).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DIR = path.join(ROOT, ".claude", "team");
export const STATE_FILE = path.join(DIR, "state.json");
export const CHAT_FILE = path.join(DIR, "chat.json");
export const RUN_FILE = path.join(DIR, "run.json");
export const HISTORY_FILE = path.join(DIR, "history.json");
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
// The lock records its owner's pid, so one left by a process that was killed (office closed, run stopped) is broken
// right away instead of blocking everyone until it's 10 s old.
const lockOwner = (dir) => {
  try {
    return fs.readFileSync(path.join(dir, "owner"), "utf8");
  } catch {
    return null;
  }
};
const gone = (pid) => {
  try {
    process.kill(Number(pid), 0);
    return false;
  } catch (e) {
    return e.code === "ESRCH";
  }
};
function breakStaleLock() {
  const owner = lockOwner(LOCK);
  let stale = !!owner && gone(owner);
  try {
    stale ||= Date.now() - fs.statSync(LOCK).mtimeMs > 10000;
  } catch {
    return; // released meanwhile
  }
  if (!stale) return;
  // move it aside first: if another process broke it and took a fresh lock meanwhile, that one is put back
  const aside = `${LOCK}.stale-${process.pid}-${Date.now()}`;
  try {
    fs.renameSync(LOCK, aside);
  } catch {
    return;
  }
  if (lockOwner(aside) !== owner)
    try {
      return fs.renameSync(aside, LOCK);
    } catch {}
  fs.rmSync(aside, { recursive: true, force: true });
}
export function withLock(fn) {
  fs.mkdirSync(DIR, { recursive: true });
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      fs.mkdirSync(LOCK);
      try {
        fs.writeFileSync(path.join(LOCK, "owner"), String(process.pid));
      } catch {}
      break;
    } catch {
      breakStaleLock();
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

// The current / last office-launched run, and finished runs (newest first).
export const readRun = () => readJson(RUN_FILE, () => null);
export function writeRun(run) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(RUN_FILE, JSON.stringify(run, null, 2));
}
export const readHistory = () => readJson(HISTORY_FILE, () => []);
export function writeHistory(list) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(list.slice(0, 100), null, 2));
}

// End a process and everything it started. Children spawned with `detached` on macOS/Linux lead their own
// process group, so the whole group gets the signal; on Windows taskkill /T walks the tree.
export function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
}

export function event(state, e) {
  state.events.push({ t: Date.now(), ...e });
}

// Update state / chat atomically: fn receives the parsed object and mutates it.
export const updateState = (fn) => withLock(() => { const s = readState(); const r = fn(s); writeState(s); return r; });
export const updateChat = (fn) => withLock(() => { const c = readChat(); const r = fn(c); writeChat(c); return r; });

// `quiet`: update the agent's card without a line in the activity log (routine chat states would bury the team's work)
export function setAgent(state, name, st, activity = "", { quiet = false } = {}) {
  state.agents[name] = { state: st, activity, since: Date.now() };
  if (!quiet) event(state, { type: "state", agent: name, state: st, msg: activity || st });
}

// Environment for spawning the Claude CLI. Drops CLAUDECODE (lets it run from inside a Claude Code session) and,
// when requests go to Anthropic, stale non-Claude model overrides inherited from a parent process (e.g. an old
// MiniMax setup) — those would make the CLI request a model Anthropic doesn't serve.
// Variables that tie a process to the Claude Code session it runs in. An office started from inside a session (the
// app's preview, a terminal in Claude Code) would otherwise hand them to every team run and manager reply: they'd run
// under that session's id (and --resume it), and talk to its messaging socket.
const PARENT_SESSION = ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_REMOTE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_PID"];

export function claudeEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of PARENT_SESSION) delete env[k];
  // Started from inside a Claude app session (e.g. its preview pane)? That session's private auth token is inherited
  // but isn't valid for the standalone CLI, and it would override your own `claude auth login`. Drop it.
  // The app also routes its sessions through its own endpoint (ANTHROPIC_BASE_URL), which rejects normal logins.
  if (env.CLAUDE_CODE_ENTRYPOINT || env.CLAUDE_AGENT_SDK_VERSION) {
    for (const k of ["CLAUDE_CODE_ENTRYPOINT", "CLAUDE_AGENT_SDK_VERSION", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]) delete env[k];
  }
  // A custom endpoint (e.g. a leftover MiniMax URL in the Windows user environment) with no API key/token for it
  // can't work with a normal `claude auth login` — it only produces 401s. Fall back to Anthropic.
  if (env.ANTHROPIC_BASE_URL && !/api\.anthropic\.com/.test(env.ANTHROPIC_BASE_URL) && !env.ANTHROPIC_AUTH_TOKEN && !env.ANTHROPIC_API_KEY) {
    delete env.ANTHROPIC_BASE_URL;
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

// How to sign the Claude CLI in, in words for this computer's OS (sign-in can't happen from the office itself).
export function signInHint(then = "try again") {
  const where =
    process.platform === "win32" ? "Open PowerShell (Start menu → PowerShell)" : process.platform === "darwin" ? "Open Terminal (Spotlight → Terminal)" : "Open a terminal";
  return `${where}, run: claude auth login — approve in the browser, then ${then}.`;
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
