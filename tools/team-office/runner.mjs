// Launches the /team pipeline headlessly (`claude -p "/team …"`) when the user confirms a run the manager proposed.
// New projects get their own sibling folder next to this repo, seeded with the team's agents and /team skill.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { ROOT, DIR, updateState, setModel, readState } from "./lib.mjs";
import { createStreamParser } from "./stream.mjs";

const RUN_FILE = path.join(DIR, "run.json");
const LOG_DIR = path.join(DIR, "runs");
const TEAM_CLI = path.join(ROOT, "tools", "team-office", "team.mjs");
const PROJECTS_ROOT = path.resolve(ROOT, "..");
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
// how every agent calls the office CLI from any project folder (forward slashes work in Git Bash and cmd)
const T_CMD = `node "${TEAM_CLI.replaceAll("\\", "/")}"`;

// What an unattended run may do: edit files inside the project folder (acceptEdits is scoped to the working
// directory) and run project tooling. No git commit/push, no deletes.
const ALLOWED_TOOLS = [
  "Read", "Glob", "Grep", "Edit", "Write", "Agent", "Task", "TodoWrite", "WebFetch", "WebSearch", "Skill",
  "Bash(node:*)", "Bash(npm:*)", "Bash(npx:*)", "Bash(curl:*)", "Bash(sleep:*)",
  "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git ls-files:*)", "Bash(git init:*)", "Bash(git add:*)",
  "Bash(cd:*)", "Bash(ls:*)", "Bash(mkdir:*)", "Bash(cat:*)", "Bash(head:*)", "Bash(tail:*)", "Bash(wc:*)", "Bash(grep:*)", "Bash(find:*)", "Bash(pwd)",
];

let child = null;
let stopping = false;

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
export const isRunning = () => !!child;

// A run marked "running" with no live child means the server restarted mid-run.
export function recoverRunState() {
  const run = readRun();
  if (run?.status === "running" && !child) writeRun({ ...run, status: "interrupted", endedAt: Date.now() });
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

/**
 * Start a headless /team run. `onEnd(run)` is called when it finishes, fails, or is stopped.
 */
export function startRun({ project, task }, onEnd) {
  if (child) throw new Error("A run is already in progress — stop it first or wait for it to finish.");
  const p = resolveProject(project);
  prepareProject(p);

  const tCmd = p.dir === ROOT ? "node tools/team-office/team.mjs" : T_CMD;
  const prompt =
    `/team ${task}\n\n` +
    `(HEADLESS: launched from the team office after the user confirmed in chat. The user is not watching this terminal — follow the skill's Headless mode rules.\n` +
    `- Project directory: ${p.dir}${p.isNew ? " — a new, empty project: scaffold it here" : ""}.\n` +
    `- The team office CLI ("T" in the skill) is exactly: ${tCmd} — it lives outside this project; don't look for it. Your first command must be: ${tCmd} init "<one-line task summary>"\n` +
    `- Post the plan summary with T say and wait for the user's "go" before building. Never git commit or push.)`;

  const id = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, `${id}.jsonl`);
  const log = fs.createWriteStream(logFile);

  const env = { ...process.env, TEAM_CLI };
  delete env.CLAUDECODE;
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--strict-mcp-config", "--allowedTools", ...ALLOWED_TOOLS];
  child = spawn(CLAUDE_BIN, args, { cwd: p.dir, env, windowsHide: true });
  stopping = false;

  const run = { id, project: p.name, dir: p.dir, isNew: p.isNew, task, status: "running", startedAt: Date.now(), pid: child.pid, log: logFile };
  writeRun(run);

  // record the model each participant actually runs on: "lead" (orchestrator) and every subagent it spawns
  const parser = createStreamParser({
    onModel: (model, agent) => {
      try {
        updateState((s) => setModel(s, agent || "lead", model));
      } catch {}
    },
  });
  let lastResult = null;
  child.stdout.on("data", (d) => {
    log.write(d);
    parser.push(d);
  });
  child.stderr.on("data", (d) => log.write(d));
  const finish = (code, err) => {
    if (!child) return;
    child = null;
    log.end();
    lastResult = parser.end();
    // A clean exit isn't success if the lead never actually started the pipeline (no `T init` during this run).
    const s = readState();
    const pipelineStarted = !!s.task && s.startedAt >= run.startedAt;
    let status = stopping ? "stopped" : err || code !== 0 || lastResult?.is_error ? "failed" : "finished";
    if (status === "finished" && !pipelineStarted) {
      status = "failed";
      err = "The team lead ended without starting the pipeline.";
    }
    const done = {
      ...run, status, endedAt: Date.now(), exitCode: code,
      error: err || (lastResult?.is_error ? String(lastResult.result).slice(0, 300) : undefined),
      summary: lastResult?.result ? String(lastResult.result).slice(0, 1500) : undefined, // the lead's final words
    };
    writeRun(done);
    onEnd?.(done);
  };
  child.on("error", (e) => finish(-1, e.code === "ENOENT" ? "The Claude CLI (`claude`) isn't on PATH for the office server." : e.message));
  child.on("close", (code) => finish(code));
  child.stdin.end(prompt);
  return run;
}

export function stopRun() {
  if (!child) return false;
  stopping = true;
  killTree(child.pid);
  return true;
}
