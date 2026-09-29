// Launches the /team pipeline headlessly (`claude -p "/team …"`) when the user confirms a run the manager proposed.
// New projects get their own sibling folder next to this repo, seeded with the team's agents and /team skill.
// If a run hits the Claude usage limit it waits and resumes the same session automatically after each reset.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { ROOT, DIR, updateState, setModel, readState, claudeEnv } from "./lib.mjs";
import { createStreamParser } from "./stream.mjs";

const RUN_FILE = path.join(DIR, "run.json");
const LOG_DIR = path.join(DIR, "runs");
const TEAM_CLI = path.join(ROOT, "tools", "team-office", "team.mjs");
const PROJECTS_ROOT = path.resolve(ROOT, "..");
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
// how every agent calls the office CLI from any project folder (forward slashes work in Git Bash and cmd)
const T_CMD = `node "${TEAM_CLI.replaceAll("\\", "/")}"`;
const MAX_ATTEMPTS = 20; // resume at most this many times across usage resets
const RESUME_BUFFER_MS = 90 * 1000; // start a little after the reset time
const FALLBACK_WAIT_MS = 30 * 60 * 1000; // if no reset time is known, check back in 30 min

// What an unattended run may do: edit files inside the project folder (acceptEdits is scoped to the working
// directory) and run project tooling. No git commit/push, no deletes.
const ALLOWED_TOOLS = [
  "Read", "Glob", "Grep", "Edit", "Write", "Agent", "Task", "TodoWrite", "WebFetch", "WebSearch", "Skill",
  "Bash(node:*)", "Bash(npm:*)", "Bash(npx:*)", "Bash(curl:*)", "Bash(sleep:*)",
  "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git ls-files:*)", "Bash(git init:*)", "Bash(git add:*)",
  "Bash(cd:*)", "Bash(ls:*)", "Bash(mkdir:*)", "Bash(cat:*)", "Bash(head:*)", "Bash(tail:*)", "Bash(wc:*)", "Bash(grep:*)", "Bash(find:*)", "Bash(pwd)",
];

// Extra rights for runs the user explicitly approved to publish (proposal card says so; Start = consent).
const GITHUB_TOOLS = [
  "Bash(git commit:*)", "Bash(git push:*)", "Bash(git remote:*)", "Bash(git branch:*)", "Bash(git checkout:*)", "Bash(git rm:*)",
  "Bash(gh repo create:*)", "Bash(gh repo view:*)", "Bash(gh auth status:*)", "Bash(gh api user:*)",
];
// Never allowed, even for publishing runs.
const DENIED_TOOLS = [
  "Bash(git push --force:*)", "Bash(git push -f:*)", "Bash(git push --force-with-lease:*)", "Bash(git push --delete:*)",
  "Bash(git reset --hard:*)", "Bash(gh repo delete:*)", "Bash(gh repo archive:*)", "Bash(gh auth:*)", "Bash(rm:*)",
];

let child = null;
let stopping = false;
let resumeTimer = null;
let onEvent = null; // (run) => void — called on waiting / resumed / finished / failed / stopped

export function readRun() {
  try {
    return JSON.parse(fs.readFileSync(RUN_FILE, "utf8"));
  } catch {
    return null;
  }
}
function writeRun(run) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(RUN_FILE, JSON.stringify(run, null, 2));
}
const HISTORY_FILE = path.join(DIR, "history.json");
export function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  } catch {
    return [];
  }
}
// Finished/failed/stopped runs, newest first (for the Projects tab).
function recordHistory(run) {
  const entry = {
    id: run.id, project: run.project, dir: run.dir, title: String(run.task || "").split("\n")[0].slice(0, 200), status: run.status,
    startedAt: run.startedAt, endedAt: run.endedAt || Date.now(), attempts: run.attempts || 1, allowGithub: !!run.allowGithub,
    summary: run.summary ? String(run.summary).slice(0, 1200) : undefined, error: run.error,
  };
  const list = [entry, ...readHistory().filter((h) => h.id !== run.id)].slice(0, 100);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(list, null, 2));
}
const emit = (run) => {
  try {
    if (["finished", "failed", "stopped"].includes(run.status)) recordHistory(run);
  } catch {}
  try {
    onEvent?.(run);
  } catch {}
};

// A run occupies the team while it's working or waiting for a usage reset.
export const isRunning = () => !!child || readRun()?.status === "waiting";

// On server start: re-arm a pending usage-reset resume; a "running" run with no live child was interrupted.
export function recoverRunState(handler) {
  if (handler) onEvent = handler;
  const run = readRun();
  if (run?.status === "running" && !child) writeRun({ ...run, status: "interrupted", endedAt: Date.now() });
  if (run?.status === "waiting") scheduleResume(run);
}

// "merage-hub" / "." → this repo; otherwise a sibling folder (created if missing).
export function resolveProject(name) {
  const n = String(name || "").trim().toLowerCase();
  const here = path.basename(ROOT).toLowerCase();
  if (!n || n === "." || n === "merage-hub" || n === here) return { name: path.basename(ROOT), dir: ROOT, isNew: false };
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(n)) throw new Error(`"${name}" isn't a valid project folder name (use lowercase letters, digits and dashes).`);
  const dir = path.join(PROJECTS_ROOT, n);
  const isNew = !fs.existsSync(dir) || fs.readdirSync(dir).filter((f) => f !== ".git").length === 0;
  return { name: n, dir, isNew };
}

function prepareProject(p) {
  fs.mkdirSync(p.dir, { recursive: true });
  if (p.dir === ROOT) return;
  if (!fs.existsSync(path.join(p.dir, ".git"))) execFileSync("git", ["init", "-q"], { cwd: p.dir });
  // Seed (and refresh) the team's playbook so the pipeline works the same in every project. The office CLI lives
  // in this repo, so its relative path is rewritten to an absolute one (env-var paths get blocked in headless runs).
  const seed = (from, to) => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, fs.readFileSync(from, "utf8").replaceAll("node tools/team-office/team.mjs", T_CMD));
  };
  for (const f of fs.readdirSync(path.join(ROOT, ".claude", "agents"))) {
    if (f !== "manager.md") seed(path.join(ROOT, ".claude", "agents", f), path.join(p.dir, ".claude", "agents", f));
  }
  seed(path.join(ROOT, ".claude", "skills", "team", "SKILL.md"), path.join(p.dir, ".claude", "skills", "team", "SKILL.md"));
  // playbooks (discipline + practice + stack guides); global lessons stay in the studio repo and are read via `T lessons`
  const pbDir = path.join(ROOT, ".claude", "playbooks");
  for (const f of fs.existsSync(pbDir) ? fs.readdirSync(pbDir) : []) {
    if (f.endsWith(".md") && f !== "lessons-global.md") seed(path.join(pbDir, f), path.join(p.dir, ".claude", "playbooks", f));
  }
  const gi = path.join(p.dir, ".gitignore");
  const cur = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  if (!cur.includes(".claude/team/")) fs.appendFileSync(gi, `${cur && !cur.endsWith("\n") ? "\n" : ""}# team run state\n.claude/team/\ntests/scratch/\n`);
}

function killTree(pid) {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGTERM");
  } catch {}
}

// Fallback when the stream carried no resetsAt: parse "resets 10:50pm (America/Los_Angeles)".
export function parseResetTime(text, now = Date.now()) {
  const m = String(text || "").match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\(([\w/+-]+)\))?/i);
  if (!m) return null;
  let h = +m[1] % 12;
  if ((m[3] || "").toLowerCase() === "pm") h += 12;
  if (!m[3] && +m[1] === 12) h = 12;
  const min = +(m[2] || 0);
  const tz = m[4] || Intl.DateTimeFormat().resolvedOptions().timeZone;
  // wall-clock (h:min in tz) → UTC instant; try today and tomorrow in that zone, take the first one in the future
  const offsetAt = (utcMs) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - Math.floor(utcMs / 60000) * 60000;
  };
  try {
    const today = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
    for (let d = 0; d < 2; d++) {
      const guess = Date.UTC(+today.year, +today.month - 1, +today.day + d, h, min);
      const t = guess - offsetAt(guess);
      if (t > now - 60000) return t;
    }
  } catch {}
  return null;
}

function scheduleResume(run) {
  clearTimeout(resumeTimer);
  const wait = Math.max(5000, (run.resumeAt || Date.now()) - Date.now());
  // setTimeout caps at ~24.8 days; re-check periodically for very long waits
  resumeTimer = setTimeout(() => (Date.now() >= run.resumeAt - 1000 ? resumeRun() : scheduleResume(readRun())), Math.min(wait, 6 * 3600 * 1000));
}

function resumeRun() {
  const run = readRun();
  if (!run || run.status !== "waiting" || child) return;
  if ((run.attempts || 1) >= MAX_ATTEMPTS) {
    const done = { ...run, status: "failed", endedAt: Date.now(), error: `Gave up after ${run.attempts} attempts across usage resets.` };
    writeRun(done);
    return emit(done);
  }
  const prompt =
    `Your Claude usage limit has reset — continue the team pipeline exactly where you left off. ` +
    `First run ${run.tCmd} resume to see the office board (done / active / blocked / ready tasks) and ${run.tCmd} inbox for any new messages from the user; ` +
    `then carry on with the remaining steps of the /team skill (re-spawn any teammate whose work was cut off, with the plan and what's already done). ` +
    `Same HEADLESS rules as before: the user isn't watching this terminal, talk to them only via ${run.tCmd} say / inbox. ` +
    (run.allowGithub ? `GitHub publishing is still allowed for this run as the task describes (no force-push, no deletes).` : `Never git commit or push.`);
  const next = { ...run, attempts: (run.attempts || 1) + 1, resumedAt: Date.now() };
  spawnRun(next, prompt, run.sessionId);
  emit({ ...readRun(), status: "resumed" });
}

/** Start a headless /team run. `handler(run)` is called on every status change. */
export function startRun({ project, task, allowGithub = false }, handler) {
  if (handler) onEvent = handler;
  if (isRunning()) throw new Error("A run is already in progress or waiting for a usage reset — stop it first.");
  const p = resolveProject(project);
  prepareProject(p);

  const tCmd = p.dir === ROOT ? "node tools/team-office/team.mjs" : T_CMD;
  const prompt =
    `/team ${task}\n\n` +
    `(HEADLESS: launched from the team office after the user confirmed in chat. The user is not watching this terminal — follow the skill's Headless mode rules.\n` +
    `- Project directory: ${p.dir}${p.isNew ? " — a new, empty project: scaffold it here" : ""}.\n` +
    `- The team office CLI ("T" in the skill) is exactly: ${tCmd} — it lives outside this project; don't look for it. Your first command must be: ${tCmd} init "<one-line task summary>"\n` +
    `- Post the plan summary with T say and wait for the user's "go" before building.\n` +
    (allowGithub
      ? `- GITHUB ALLOWED for this run (the user approved it): you may git add/commit, create GitHub repos with \`gh repo create\` and \`git push\` — only what the task asks for. Never force-push, rewrite history, or delete anything on GitHub. Before pushing to a PUBLIC repo, make sure no secrets, tokens, or local absolute paths (e.g. under .claude/) are committed — gitignore .claude/ unless the task says otherwise. Post the resulting repo URL with T say.)`
      : `- Never git commit or push.)`);

  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const run = { id, project: p.name, dir: p.dir, isNew: p.isNew, task, tCmd, allowGithub, attempts: 1, startedAt: Date.now(), log: path.join(LOG_DIR, `${id}.jsonl`) };
  spawnRun(run, prompt, null);
  return readRun();
}

function spawnRun(run, prompt, resumeSessionId) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const log = fs.createWriteStream(run.log, { flags: "a" }); // resumed attempts append to the same log
  const allowed = run.allowGithub ? [...ALLOWED_TOOLS, ...GITHUB_TOOLS] : ALLOWED_TOOLS;
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--strict-mcp-config", "--allowedTools", ...allowed, "--disallowedTools", ...DENIED_TOOLS];
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  child = spawn(CLAUDE_BIN, args, { cwd: run.dir, env: claudeEnv({ TEAM_CLI }), windowsHide: true });
  stopping = false;

  const current = { ...run, status: "running", pid: child.pid, resumeAt: undefined, error: undefined, summary: undefined };
  writeRun(current);

  let authError = null;
  let limit = null; // last rate_limit_event info
  const parser = createStreamParser({
    // record the model each participant actually runs on: "lead" (orchestrator) and every subagent it spawns
    onModel: (model, agent) => {
      try {
        updateState((s) => setModel(s, agent || "lead", model));
      } catch {}
    },
    onSession: (id) => {
      if (id && id !== current.sessionId) {
        current.sessionId = id;
        writeRun(current);
      }
    },
    onRateLimit: (info) => (limit = info),
    onRetry: (ev) => {
      if ((ev.error_status === 401 || ev.error_status === 403) && !authError && child) {
        authError = `Authentication failed (HTTP ${ev.error_status}) — sign in with \`claude auth login\` in PowerShell.`;
        killTree(child.pid);
      }
    },
  });
  child.stdout.on("data", (d) => {
    log.write(d);
    parser.push(d);
  });
  child.stderr.on("data", (d) => log.write(d));

  const finish = (code, err) => {
    if (!child) return;
    child = null;
    log.end();
    const result = parser.end();
    if (authError) err = authError;
    const resultText = String(result?.result || "");
    const sessionId = result?.session_id || current.sessionId;

    // Out of usage → wait for the reset and resume the same session (keeps the plan, progress and context).
    const limited =
      !stopping && !authError &&
      (result?.api_error_status === 429 || limit?.status === "rejected" || /out of (extra )?usage|usage limit|limit reached/i.test(resultText + " " + (err || "")));
    if (limited && sessionId) {
      const resetMs = limit?.resetsAt ? limit.resetsAt * 1000 : parseResetTime(resultText);
      const waiting = {
        ...current, sessionId, status: "waiting", pausedAt: Date.now(),
        resumeAt: (resetMs || Date.now() + FALLBACK_WAIT_MS) + RESUME_BUFFER_MS,
        limitMessage: resultText || err || "Usage limit reached",
      };
      writeRun(waiting);
      scheduleResume(waiting);
      return emit(waiting);
    }

    // A clean exit isn't success if the lead never actually started the pipeline (no `T init` during this run).
    const s = readState();
    const pipelineStarted = !!s.task && s.startedAt >= run.startedAt;
    let status = stopping ? "stopped" : err || code !== 0 || result?.is_error ? "failed" : "finished";
    if (status === "finished" && !pipelineStarted) {
      status = "failed";
      err = "The team lead ended without starting the pipeline.";
    }
    const done = {
      ...current, sessionId, status, endedAt: Date.now(), exitCode: code,
      error: err || (result?.is_error ? resultText.slice(0, 300) : undefined),
      summary: resultText ? resultText.slice(0, 1500) : undefined, // the lead's final words
    };
    writeRun(done);
    emit(done);
  };
  child.on("error", (e) => finish(-1, e.code === "ENOENT" ? "The Claude CLI (`claude`) isn't on PATH for the office server." : e.message));
  child.on("close", (code) => finish(code));
  child.stdin.end(prompt);
}

export function stopRun() {
  if (child) {
    stopping = true;
    killTree(child.pid);
    return true;
  }
  const run = readRun();
  if (run?.status === "waiting") {
    clearTimeout(resumeTimer);
    const done = { ...run, status: "stopped", endedAt: Date.now() };
    writeRun(done);
    emit(done);
    return true;
  }
  return false;
}
