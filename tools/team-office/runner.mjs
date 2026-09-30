// Launches the /team pipeline headlessly (`claude -p "/team …"`) when the user confirms a run the manager proposed.
// Projects live in the projects folder (settings.mjs), seeded with the team's agents, /team skill and playbooks.
// Before a run touches a project its files are checkpointed, so the user can undo the run.
// A run that stops early can continue in the same session:
//   - hits the Claude usage limit → waits and resumes automatically after each reset
//   - the lead stops because the user hasn't answered its question → resumes as soon as they answer
//   - interrupted (office closed, computer slept), failed or stopped → the user can press ↻ Continue
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT, DIR, updateState, setModel, readState, readChat, claudeEnv, signInHint, readRun, writeRun, readHistory, writeHistory, killTree } from "./lib.mjs";
import { resolveProject, prepareProject, T_CMD, TEAM_CLI } from "./projects.mjs";
import { readSettings } from "./settings.mjs";
import { createCheckpoint } from "./checkpoint.mjs";
import { CLAUDE_BIN } from "./health.mjs";
import { createStreamParser } from "./stream.mjs";

export { readRun, readHistory };

const LOG_DIR = path.join(DIR, "runs");
const MAX_ATTEMPTS = 20; // resume at most this many times
const RESUME_BUFFER_MS = 90 * 1000; // start a little after the reset time
const FALLBACK_WAIT_MS = 30 * 60 * 1000; // if no reset time is known, check back in 30 min

// What an unattended run may do: edit files inside the project folder (acceptEdits is scoped to the working
// directory) and run project tooling. No git commit/push, no deletes. (This list steers the team; it is not a
// sandbox — node/python/npm can run any program. See README "Safety".)
const ALLOWED_TOOLS = [
  "Read", "Glob", "Grep", "Edit", "Write", "Agent", "Task", "TodoWrite", "WebFetch", "WebSearch", "Skill",
  "Bash(node:*)", "Bash(npm:*)", "Bash(npx:*)", "Bash(curl:*)", "Bash(sleep:*)",
  // toolchains for the stacks the playbooks cover (run project code/tests/installs — same trust level as node/npm)
  "Bash(python:*)", "Bash(python3:*)", "Bash(py:*)", "Bash(pip:*)", "Bash(pip3:*)", "Bash(pytest:*)", "Bash(uv:*)", "Bash(ruff:*)",
  "Bash(.venv/Scripts/python:*)", "Bash(.venv/Scripts/pip:*)", "Bash(.venv/Scripts/pytest:*)", "Bash(.venv/bin/python:*)", "Bash(.venv/bin/pip:*)", "Bash(.venv/bin/pytest:*)",
  "Bash(go:*)", "Bash(cargo:*)", "Bash(rustc:*)", "Bash(dotnet:*)", "Bash(java:*)", "Bash(mvn:*)", "Bash(gradle:*)", "Bash(./gradlew:*)",
  "Bash(flutter:*)", "Bash(dart:*)", "Bash(php:*)", "Bash(composer:*)", "Bash(ruby:*)", "Bash(bundle:*)", "Bash(rails:*)",
  "Bash(cmake:*)", "Bash(ctest:*)", "Bash(make:*)", "Bash(bun:*)", "Bash(pnpm:*)", "Bash(yarn:*)", "Bash(where:*)", "Bash(which:*)",
  "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git ls-files:*)", "Bash(git init:*)", "Bash(git add:*)",
  "Bash(cd:*)", "Bash(ls:*)", "Bash(mkdir:*)", "Bash(cat:*)", "Bash(head:*)", "Bash(tail:*)", "Bash(wc:*)", "Bash(grep:*)", "Bash(find:*)", "Bash(pwd)",
];

// Extra rights for runs the user explicitly approved to publish (proposal card says so; Start = consent).
// GitHub Pages ("put it online") is switched on with a POST to the repo's pages endpoint.
const GITHUB_TOOLS = [
  "Bash(git commit:*)", "Bash(git push:*)", "Bash(git remote:*)", "Bash(git branch:*)", "Bash(git checkout:*)", "Bash(git rm:*)",
  "Bash(gh repo create:*)", "Bash(gh repo view:*)", "Bash(gh auth status:*)", "Bash(gh api user:*)",
  "Bash(gh api -X POST repos/:*)", "Bash(gh api -X GET repos/:*)",
];
// Never allowed, even for publishing runs.
const DENIED_TOOLS = [
  "Bash(git push --force:*)", "Bash(git push -f:*)", "Bash(git push --force-with-lease:*)", "Bash(git push --delete:*)",
  "Bash(git reset --hard:*)", "Bash(gh repo delete:*)", "Bash(gh repo archive:*)", "Bash(rm:*)",
  // sign-in stays the user's business (`gh auth status` above is read-only and allowed)
  "Bash(gh auth login:*)", "Bash(gh auth logout:*)", "Bash(gh auth token:*)", "Bash(gh auth refresh:*)", "Bash(gh auth setup-git:*)", "Bash(gh auth switch:*)",
  "Bash(gh api -X DELETE:*)", "Bash(gh api --method DELETE:*)", "Bash(gh api -X PATCH:*)", "Bash(gh api -X PUT:*)",
  // a run must never change its own permissions or settings
  "Skill(fewer-permission-prompts)", "Skill(update-config)", "Edit(.claude/settings*.json)", "Write(.claude/settings*.json)",
];

let child = null;
let stopping = false;
let resumeTimer = null;
let onEvent = null; // (run) => void — called on waiting / needs-answer / resumed / finished / failed / stopped

// Finished/failed/stopped runs, newest first (for My Projects, estimates, Continue and Undo).
function recordHistory(run) {
  const entry = {
    id: run.id, project: run.project, dir: run.dir, title: String(run.task || "").split("\n")[0].slice(0, 200), task: String(run.task || "").slice(0, 8000),
    status: run.status, startedAt: run.startedAt, endedAt: run.endedAt || Date.now(), attempts: run.attempts || 1,
    allowGithub: !!run.allowGithub, size: run.size || "standard", lightTeam: !!run.lightTeam, isNew: !!run.isNew, checkpoint: run.checkpoint || undefined,
    sessionId: run.sessionId || undefined, tCmd: run.tCmd, log: run.log,
    activeMs: run.activeMs, buildMs: run.buildMs, taskCount: run.taskCount,
    summary: run.summary ? String(run.summary).slice(0, 1200) : undefined, error: run.error,
  };
  writeHistory([entry, ...readHistory().filter((h) => h.id !== run.id)]);
}
const emit = (run) => {
  try {
    if (["finished", "failed", "stopped", "interrupted"].includes(run.status)) recordHistory(run);
  } catch {}
  try {
    onEvent?.(run);
  } catch {}
};

// A run occupies the team while it's working or waiting for a usage reset. A run paused for the user's answer
// ("needs-answer") doesn't: starting a new run replaces it.
export const isRunning = () => !!child || readRun()?.status === "waiting";

// On server start: re-arm a pending usage-reset resume; a "running" run with no live child was interrupted.
export function recoverRunState(handler) {
  if (handler) onEvent = handler;
  const run = readRun();
  if (run?.status === "running" && !child) {
    const done = { ...run, status: "interrupted", endedAt: Date.now() };
    writeRun(done);
    emit(done);
  }
  if (run?.status === "waiting") scheduleResume(run);
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

const HEADLESS_RULES = (run) =>
  `Same HEADLESS rules as before: the user isn't watching this terminal, talk to them only via ${run.tCmd} say / ask / wait. ` +
  `If a command is refused by permissions, do NOT try to change settings, permissions, or config and don't hunt for workarounds — tell the user what you need with T say, then continue with everything you can do without it. ` +
  (run.allowGithub ? `GitHub publishing is still allowed for this run as the task describes (no force-push, no deletes).` : `Never git commit or push.`);

// reason "usage": the usage limit reset (run is "waiting"); "answer": the user replied (run is "needs-answer");
// "continue": the user pressed ↻ Continue on an interrupted / failed / stopped run.
function resumeRun(reason = "usage") {
  const run = readRun();
  const expected = { usage: ["waiting"], answer: ["needs-answer"], continue: ["failed", "interrupted", "stopped"] }[reason];
  if (!run || !expected.includes(run.status) || child || !run.sessionId) return false;
  if ((run.attempts || 1) >= MAX_ATTEMPTS) {
    const done = { ...run, status: "failed", endedAt: Date.now(), error: `Gave up after ${run.attempts} attempts.` };
    writeRun(done);
    emit(done);
    return false;
  }
  const intro = {
    answer:
      `The user has replied to your question — continue the team pipeline exactly where you left off. ` +
      `First run ${run.tCmd} inbox to read their reply and ${run.tCmd} resume to see the office board (if you set the phase to done when you paused, set it back with ${run.tCmd} phase <the phase you were in>); `,
    usage:
      `Your Claude usage limit has reset — continue the team pipeline exactly where you left off. ` +
      `First run ${run.tCmd} resume to see the office board (done / active / blocked / ready tasks) and ${run.tCmd} inbox for any new messages from the user; `,
    continue:
      `Your previous session ended before the work was finished (${run.status}${run.error ? `: ${run.error}` : ""}). The user asked you to continue. ` +
      (run.boardIsOld
        ? `The office board now shows a later run, not yours: run ${run.tCmd} init "<one-line summary of this task>" and load your execution graph again with ${run.tCmd} tasks (mark what's already done with ${run.tCmd} task <id> done), then check ${run.tCmd} inbox; `
        : `First run ${run.tCmd} resume to see the office board and ${run.tCmd} inbox for any new messages from the user; `) +
      `check what's already done in the project folder; `,
  }[reason];
  const prompt = intro + `then carry on with the remaining steps of the /team skill (re-spawn any teammate whose work was cut off, with the plan and what's already done). ` + HEADLESS_RULES(run);
  const pausedMs = (run.pausedMs || 0) + (run.pausedAt ? Date.now() - run.pausedAt : 0);
  // a continued run is judged by the board from now on (the lead re-inits it if it was another run's)
  const next = { ...run, attempts: (run.attempts || 1) + 1, resumedAt: Date.now(), pausedMs, pausedAt: undefined, endedAt: undefined, boardIsOld: undefined, ...(run.boardIsOld ? { startedAt: Date.now() } : {}) };
  spawnRun(next, prompt, run.sessionId);
  emit({ ...readRun(), status: "resumed", reason });
  return true;
}

/** Continue a run that paused for the user's answer (call after the answer is in the team's inbox). */
export const continueAfterAnswer = () => resumeRun("answer");

/**
 * ↻ Continue: pick an interrupted / failed / stopped run up again in its own session. `runId` may be the current run
 * or one from the history. Throws with a plain message if it can't.
 */
export function continueRun(runId) {
  if (isRunning()) throw new Error("The team is busy with another run — stop it first, or wait until it's done.");
  const current = readRun();
  let run = current;
  if (!run || run.id !== runId) {
    const h = readHistory().find((x) => x.id === runId);
    if (!h) throw new Error("That run isn't known any more.");
    // the office board shows the latest run, not this one — the lead must set it up again for this work
    run = { ...h, task: h.task || h.title, tCmd: h.tCmd || (h.dir === ROOT ? "node tools/team-office/team.mjs" : T_CMD), boardIsOld: true };
  }
  if (!["failed", "interrupted", "stopped"].includes(run.status)) throw new Error("That run doesn't need continuing.");
  if (!run.sessionId) throw new Error("That run can't be continued (it never got going) — try it again instead.");
  if (!fs.existsSync(run.dir)) throw new Error("The project's folder is gone.");
  // a different run that was paused for the user's answer is replaced (and kept in the history)
  if (current && current.id !== run.id && current.status === "needs-answer") {
    const done = { ...current, status: "stopped", endedAt: Date.now() };
    writeRun(done);
    emit(done);
  }
  writeRun(run);
  if (!resumeRun("continue")) throw new Error("Couldn't continue that run.");
  return readRun();
}

/** Start a headless /team run. `handler(run)` is called on every status change. Returns { run, skipped }. */
export function startRun({ project, task, allowGithub = false, size = "standard" }, handler) {
  if (handler) onEvent = handler;
  if (isRunning()) throw new Error("A run is already in progress or waiting for a usage reset — stop it first.");
  // a run that paused for an answer the user never gave is replaced by the new one
  const paused = readRun();
  if (paused?.status === "needs-answer") {
    const done = { ...paused, status: "stopped", endedAt: Date.now() };
    writeRun(done);
    emit(done);
  }
  const p = resolveProject(project);
  const { lightTeam } = readSettings();
  const { skipped } = prepareProject(p, { lightTeam });
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  // snapshot the files so this run can be undone (skipped for a brand-new, empty folder — nothing to go back to)
  const checkpoint = p.isNew ? null : createCheckpoint(p.dir, id, `Dev Studio: before "${task.split("\n")[0].slice(0, 80)}"`);

  const tCmd = p.dir === ROOT ? "node tools/team-office/team.mjs" : T_CMD;
  const prompt =
    `/team ${task}\n\n` +
    `(HEADLESS: launched from the team office after the user confirmed in chat. The user is not watching this terminal — follow the skill's Headless mode rules.\n` +
    `- The user is not a developer unless the task says so: apply .claude/playbooks/for-non-developers.md, and talk to them in plain words.\n` +
    `- Project directory: ${p.dir}${p.isNew ? " — a new, empty project: scaffold it here" : ""}.\n` +
    `- Team size: ${size} (see the skill's "Team size" section).\n` +
    `- The team office CLI ("T" in the skill) is exactly: ${tCmd} — it lives outside this project; don't look for it. Your first command must be: ${tCmd} init "<one-line task summary>"\n` +
    `- Post the plan summary with T ask and wait for the user's "go" before building.\n` +
    `- If a command is refused by permissions, do NOT try to change settings, permissions, or config and don't hunt for workarounds — tell the user what you need with T say, then continue with everything you can do without it.\n` +
    (skipped.length ? `- This project has its own versions of: ${skipped.join(", ")} — use them as they are.\n` : "") +
    (allowGithub
      ? `- GITHUB ALLOWED for this run (the user approved it): you may git add/commit, create GitHub repos with \`gh repo create\` and \`git push\` — only what the task asks for. Never force-push, rewrite history, or delete anything on GitHub. Before pushing to a PUBLIC repo, make sure no secrets, tokens, or local absolute paths (e.g. under .claude/) are committed — gitignore .claude/ unless the task says otherwise. Post the resulting repo URL with T say.)`
      : `- Never git commit or push.)`);

  const run = {
    id, project: p.name, dir: p.dir, isNew: p.isNew, task, tCmd, allowGithub, size, lightTeam,
    checkpoint: checkpoint?.id, attempts: 1, startedAt: Date.now(), log: path.join(LOG_DIR, `${id}.jsonl`),
  };
  spawnRun(run, prompt, null);
  return { run: readRun(), skipped };
}

function spawnRun(run, prompt, resumeSessionId) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const log = fs.createWriteStream(run.log, { flags: "a" }); // resumed attempts append to the same log
  const allowed = run.allowGithub ? [...ALLOWED_TOOLS, ...GITHUB_TOOLS] : ALLOWED_TOOLS;
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--strict-mcp-config", "--allowedTools", ...allowed, "--disallowedTools", ...DENIED_TOOLS];
  if (run.lightTeam) args.push("--model", "sonnet");
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  // detached on macOS/Linux = its own process group, so ■ Stop can end the lead and everything it started (killTree)
  child = spawn(CLAUDE_BIN, args, { cwd: run.dir, env: claudeEnv({ TEAM_CLI }), windowsHide: true, detached: process.platform !== "win32" });
  stopping = false;

  const current = { ...run, status: "running", pid: child.pid, resumeAt: undefined, error: undefined, summary: undefined, question: undefined };
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
        authError = `Authentication failed (HTTP ${ev.error_status}). ${signInHint("start the run again")}`;
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

    // Ended cleanly while its question (T ask) was still open → the lead gave up waiting for the user; nothing is
    // finished. Keep the session and continue the moment they answer (or right away if the answer already arrived).
    const openAsk = s.ask && s.ask.t >= run.startedAt ? s.ask : null;
    if (status === "finished" && pipelineStarted && openAsk && sessionId) {
      const paused = { ...current, sessionId, status: "needs-answer", pausedAt: Date.now(), question: String(openAsk.text).slice(0, 500) };
      writeRun(paused);
      emit(paused);
      if (openAsk.answered || readChat().inbox.some((m) => !m.read)) setTimeout(continueAfterAnswer, 1000);
      return;
    }

    if (status === "finished" && !pipelineStarted) {
      status = "failed";
      err = "The team lead ended without starting the pipeline.";
    } else if (status === "finished" && s.phase !== "done" && !((s.tasks || []).length && s.tasks.every((t) => t.status === "done"))) {
      // (all tasks done but the lead forgot `T phase done` still counts as finished)
      // exited cleanly but the board never reached DONE → the work isn't finished
      status = "failed";
      err = `The team lead stopped early (board still at ${String(s.phase).toUpperCase()}, ${(s.tasks || []).filter((t) => t.status === "done").length}/${(s.tasks || []).length} tasks done).`;
    }
    // how long the work took, without the time spent paused or waiting for the user (for "about N min" estimates)
    const endedAt = Date.now();
    const waited = (current.pausedMs || 0) + (pipelineStarted ? s.askWaitMs || 0 : 0);
    const stats = pipelineStarted
      ? {
          activeMs: Math.max(0, endedAt - run.startedAt - waited),
          buildMs: s.tasksLoadedAt ? Math.max(0, endedAt - s.tasksLoadedAt - waited) : undefined,
          taskCount: (s.tasks || []).length,
        }
      : {};
    const done = {
      ...current, ...stats, sessionId, status, endedAt, exitCode: code,
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
  if (run?.status === "waiting" || run?.status === "needs-answer") {
    clearTimeout(resumeTimer);
    const done = { ...run, status: "stopped", endedAt: Date.now() };
    writeRun(done);
    emit(done);
    return true;
  }
  return false;
}

// Office shutting down (Ctrl+C / window closed): end the run's process group too, so no run keeps going unseen.
// The next start marks it "interrupted".
export function shutdown() {
  if (child) killTree(child.pid);
}
