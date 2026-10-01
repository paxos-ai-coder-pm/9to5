#!/usr/bin/env node
// Serves the office UI, the live team state, the manager chat, and the project actions (open, undo, share…).
// No dependencies.
//   node tools/team-office/server.mjs [port]   (default 4400; 0 = any free port)
//
// Chat replies come from the `manager` agent (.claude/agents/manager.md) via the Claude Code CLI in headless mode
// (`claude -p --agent manager`), so they use your existing Claude Code login. Set CLAUDE_BIN to override the binary.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ROOT, DIR, STATE_FILE, CHAT_FILE, readState, readChat, updateChat, updateState, setAgent, setModel, configuredModels, summary, claudeEnv, event, signInHint } from "./lib.mjs";
import { readRun, readHistory, startRun, stopRun, isRunning, recoverRunState, continueAfterAnswer, continueRun, shutdown } from "./runner.mjs";
import { resolveProject, knownProjects, portfolio, findProject } from "./projects.mjs";
import { readSettings, updateSettings, projectsRoot, defaultProjectsDir } from "./settings.mjs";
import { openApp, stopApp, closeApp, appStatus, stopAllApps, showFiles, captureScreenshot, screenshotPath } from "./apps.mjs";
import { codeVersion } from "./version.mjs";
import { readManifest, insidePath } from "./manifest.mjs";
import { restoreCheckpoint } from "./checkpoint.mjs";
import { zipDirectory } from "./zip.mjs";
import { checkHealth, CLAUDE_BIN, GH_BIN } from "./health.mjs";
import { explainFailure, minutesLeft, typicalRunMinutes, fmtMinutes } from "./insights.mjs";
import { parseDirectives, visibleDraft } from "./directives.mjs";
import { createStreamParser } from "./stream.mjs";
import { createTelegram } from "./telegram.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "public");
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4400);
const REPLY_TIMEOUT_MS = 180000;
const PID_FILE = path.join(DIR, "office.json"); // lets `devstudio status/stop` find this server
const VERSION = codeVersion(); // the code this office was started with

// Which GitHub account `gh` is signed in to (shown on publishing proposals and to the manager). Refreshed every 10 min.
let githubAccount = null;
function refreshGithubAccount() {
  execFile(GH_BIN, ["api", "user", "--jq", ".login"], { timeout: 15000, windowsHide: true }, (err, out) => {
    githubAccount = err ? null : String(out).trim() || null;
  });
}
refreshGithubAccount();
setInterval(refreshGithubAccount, 10 * 60 * 1000).unref();

// Setup checklist (Claude installed & signed in, git, GitHub, projects folder). Refreshed every 5 min and on demand.
let health = null;
async function refreshHealth() {
  health = await checkHealth({ githubAccount, projectsDir: projectsRoot() });
  return health;
}
refreshHealth().catch(() => {});
setInterval(() => refreshHealth().catch(() => {}), 5 * 60 * 1000).unref();
// what stops the manager from replying at all (null = nothing known)
function chatBlocker() {
  const c = health?.checks.find((x) => x.id === "claude");
  const a = health?.checks.find((x) => x.id === "auth");
  if (c && !c.ok) return "Claude Code isn't installed on this computer yet";
  if (a && !a.ok && !a.unknown) return "Claude isn't signed in on this computer yet";
  return null;
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png",
  ".mjs": "text/javascript", ".woff2": "font/woff2", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon",
};

function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > limit) reject(new Error("too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// A chat message. `extra` may carry: proposal, relays, choices, actions [{ kind, … }], details (collapsed text), via.
const msg = (from, text, extra = {}) => ({ id: crypto.randomUUID(), t: Date.now(), from, text, ...extra });
// A task's headline for chat lines: its first clause ("Build a budget tracker for the family: spending by…" → "Build a
// budget tracker for the family"), cut at a word if it's still long — never ending in dangling punctuation.
const firstLine = (task) => {
  let line = String(task || "").split("\n")[0].trim();
  const clause = line.search(/[:;—]\s/);
  if (line.length > 90 && clause >= 20) line = line.slice(0, clause);
  if (line.length > 90) {
    const cut = line.slice(0, 90);
    const space = cut.lastIndexOf(" ");
    line = (space > 45 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?—-]+$/, "") + "…";
  }
  return line.replace(/[\s.,;:!?—-]+$/, "");
};
const sentence = (headline) => (headline.endsWith("…") ? headline : `${headline}.`);

function recentEvents(s, n = 12) {
  return (s.events || [])
    .slice(-n)
    .map((e) => `  ${new Date(e.t).toLocaleTimeString()} ${e.agent || "system"}: ${e.msg}`)
    .join("\n");
}

function runSnapshot() {
  const run = readRun();
  const { proposal, queue = [] } = readChat();
  const t = (ms) => new Date(ms).toLocaleTimeString();
  const history = readHistory();
  const typical = ["quick", "standard", "full"].map((sz) => [sz, typicalRunMinutes(history, sz)]).filter(([, m]) => m);
  const projects = knownProjects().filter((p) => p.dir !== ROOT);
  const { lightTeam } = readSettings();
  return [
    run
      ? `Pipeline run: ${run.status.toUpperCase()} — project "${run.project}" (${run.dir}) — size ${run.size || "standard"} — task: ${firstLine(run.task)} — started ${t(run.startedAt)}${run.attempts > 1 ? `, attempt ${run.attempts}` : ""}${run.endedAt ? `, ended ${t(run.endedAt)}` : ""}${run.error ? ` — error: ${run.error}` : ""}` +
        (run.status === "waiting" ? ` — paused by the Claude usage limit; resumes automatically at ${t(run.resumeAt)}, continuing where it left off (the user can ■ Stop it).` : "") +
        (run.status === "needs-answer" ? ` — paused because the team's question is unanswered; it continues automatically as soon as the user answers (banner buttons, or RELAY their answer). Nothing is finished yet.` : "") +
        (["failed", "interrupted", "stopped"].includes(run.status) && run.sessionId ? ` — the user can press ↻ Continue to pick it up where it stopped.` : "")
      : "No pipeline run has been started from the office yet.",
    proposal ? `Pending proposal (waiting for the user's confirmation): project "${proposal.project}"${proposal.isNew ? " (new folder)" : ""}, size ${proposal.size} — ${proposal.task}` : "No pending proposal.",
    queue.length ? `Queued runs (start automatically after the current one finishes): ${queue.map((q) => `"${firstLine(q.task)}"`).join(", ")}` : "No queued runs.",
    (() => {
      const ask = readState().ask;
      if (!ask) return "The team has no open question for the user.";
      return ask.answered
        ? `The user already answered the team's question ("${ask.text.slice(0, 200)}") — the team will pick it up at its next inbox check.`
        : `The team is WAITING for the user's answer (${ask.agent} asks: "${ask.text.slice(0, 400)}"${ask.options ? `; answer buttons: ${ask.options.join(" / ")}` : ""}). Point the user to the yellow banner and its buttons, or if they answer you in chat, RELAY it.`;
    })(),
    `The Dev Studio itself (project name "."): ${ROOT} — only for changes to the studio/office, when the user explicitly asks for that.`,
    `Projects folder: ${projectsRoot()} — a new project is created there as <name>/.`,
    `Existing projects (use these exact names for changes to them): ${projects.map((p) => p.name).join(", ") || "(none yet)"}`,
    `Team: ${lightTeam ? "LIGHT team (every teammate on Sonnet — uses less of the Claude plan)" : "normal team (architect and reviewer on Opus)"}.`,
    typical.length ? `Typical run times so far: ${typical.map(([sz, m]) => `${sz} ${fmtMinutes(m)}`).join(", ")}.` : "No finished runs yet to estimate run times from.",
    githubAccount ? `GitHub CLI (gh) is signed in as: ${githubAccount} — runs you mark with ALLOW: github can create repos, push and turn on GitHub Pages there.` : "GitHub CLI (gh) is not signed in — publishing runs won't work until the user runs `gh auth login`.",
  ].join("\n");
}

function askManager(text, sessionId) {
  const s = readState();
  const prompt =
    `${text}\n\n` +
    `<team_snapshot at="${new Date().toLocaleString()}">\n${runSnapshot()}\n\nOffice board:\n${s.task ? summary(s) : "No run in progress — the team is idle."}\n` +
    (s.events?.length ? `Recent events:\n${recentEvents(s)}\n` : "") +
    `</team_snapshot>`;
  // stream-json + partial messages → we see the reply token by token and can show it while it's being written
  const args = ["-p", "--agent", "manager", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--strict-mcp-config", "--permission-mode", "dontAsk"];
  if (sessionId) args.push("--resume", sessionId);
  const env = claudeEnv();

  return new Promise((resolve) => {
    let err = "";
    let child;
    try {
      child = spawn(CLAUDE_BIN, args, { cwd: ROOT, env, windowsHide: true });
    } catch (e) {
      return resolve({ error: `Couldn't start the Claude CLI (${e.message}).` });
    }
    const timer = setTimeout(() => child.kill(), REPLY_TIMEOUT_MS);
    let authError = null;
    const parser = createStreamParser({
      onText: (text) => (draft = visibleDraft(text)),
      onModel: (model, agent) => !agent && updateState((s) => setModel(s, "manager", model)),
      // Retrying won't fix a bad login — fail fast instead of silently retrying for minutes.
      onRetry: (ev) => {
        if ((ev.error_status === 401 || ev.error_status === 403) && !authError) {
          authError = `Not logged in (authentication failed, HTTP ${ev.error_status})`;
          child.kill();
        }
      },
    });
    if (process.env.OFFICE_DEBUG) {
      console.log("[debug] spawn env keys:", Object.keys(env).filter((k) => /^(ANTHROPIC|CLAUDE|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|NODE|PATH$|XDG|SHELL)/i.test(k)).sort().join(","));
      child.stdout.on("data", (d) => console.log("[debug] stdout:", String(d).slice(0, 300).replace(/\n/g, " ⏎ ")));
      child.stderr.on("data", (d) => console.log("[debug] stderr:", String(d).slice(0, 300)));
      child.on("close", (code) => console.log("[debug] exit", code));
    }
    child.stdout.on("data", (d) => parser.push(d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ error: e.code === "ENOENT" ? "The Claude CLI (`claude`) isn't on PATH for the office server." : e.message });
    });
    child.on("close", () => {
      clearTimeout(timer);
      const r = parser.end();
      if (authError) return resolve({ error: authError });
      if (!r) return resolve({ error: (err || "No reply (timed out?)").trim().slice(0, 400) });
      if (r.is_error) return resolve({ error: r.result || "The manager hit an error.", sessionId: r.session_id });
      resolve({ text: r.result || "", sessionId: r.session_id });
    });
    child.stdin.end(prompt);
  });
}

// The reply as it's being written (directive lines hidden).
let draft = "";

async function handleChat(text, via) {
  const sessionId = updateChat((c) => {
    c.messages.push(msg("user", text, via ? { via } : {}));
    c.busy = true;
    return c.sessionId;
  });
  updateState((s) => setAgent(s, "manager", "working", "Replying to you"));

  draft = "";
  let r = await askManager(text, sessionId);
  // Resuming can fail for reasons that won't fix themselves (unknown session, or history from another model/provider
  // that the API rejects — e.g. "Invalid signature in thinking block"). Start a fresh conversation once instead.
  if (r.error && sessionId && !/log ?in|auth|401|rate.?limit|usage limit/i.test(r.error)) {
    draft = "";
    updateChat((c) => (c.sessionId = null));
    r = await askManager(text, null);
  }
  setTimeout(() => (draft = ""), 1500); // keep the draft briefly so the final message replaces it without a flash

  if (r.error) {
    const auth = /log ?in|auth|401/i.test(r.error);
    const loginHint = auth ? ` Sign-in can't be done from this chat. ${signInHint("send your message here again")}` : "";
    // Only queue it for the team if a run is there to read it — otherwise it would surface in some later, unrelated run.
    const listening = teamListening();
    updateChat((c) => {
      c.busy = false;
      c.messages.push(msg("system", `The manager couldn't reply: ${r.error}.${loginHint} ${listening ? "Your message was saved to the team inbox, so the team will still see it." : "Your message wasn't delivered — send it again once the manager is back."}`, auth ? { actions: [{ kind: "setup" }] } : {}));
      if (listening) c.inbox.push({ id: crypto.randomUUID(), t: Date.now(), text, read: false });
    });
    updateState((s) => setAgent(s, "manager", "failed", "Chat offline"));
    if (auth) refreshHealth().catch(() => {});
    return;
  }

  const { body, relays, propose, start, choices } = parseDirectives(r.text);

  // PROPOSE → a run card the user can confirm; the manager decides the project folder and task.
  let proposal = null;
  let notice = null;
  if (propose) {
    try {
      proposal = makeProposal(propose);
    } catch (e) {
      notice = `Couldn't prepare that run: ${e.message}`;
    }
  }

  updateChat((c) => {
    c.busy = false;
    c.sessionId = r.sessionId || c.sessionId;
    c.messages.push(msg("manager", body || "(no reply)", { ...(relays.length ? { relays } : {}), ...(proposal ? { proposal } : {}), ...(choices ? { choices } : {}) }));
    if (proposal) c.proposal = proposal;
    if (notice) c.messages.push(msg("system", notice));
    for (const t of relays) c.inbox.push({ id: crypto.randomUUID(), t: Date.now(), text: t, read: false });
  });
  updateState((s) => {
    setAgent(s, "manager", "waiting", proposal ? "Waiting for your go-ahead" : relays.length ? `Relayed ${relays.length} note(s) to team` : "Here if you need me");
  });
  if (relays.length) continueAfterAnswer(); // a run paused for the user's answer picks it up now

  // START → only launches a run the user has already seen proposed (guards against starting unconfirmed work).
  if (start) {
    const pending = readChat().proposal;
    if (pending) launch(pending);
    else systemMessage("The manager tried to start a run without proposing one first — ask it to propose the run so you can confirm it.");
  }
}

function makeProposal({ project, task, allowGithub = false, size = "standard" }) {
  const p = resolveProject(project);
  return {
    id: crypto.randomUUID(), t: Date.now(), project: p.name, dir: p.dir, isNew: p.isNew, foreign: p.foreign, task,
    allowGithub: !!allowGithub, githubAccount: githubAccount || null, size, estimate: typicalRunMinutes(readHistory(), size),
  };
}

function systemMessage(text, extra = {}) {
  updateChat((c) => c.messages.push(msg("system", text, extra)));
}

// Is a team run there to read the inbox? An office run (working, paused for usage, or paused for an answer) or a
// /team run started from Claude Code (its board is mid-pipeline).
function teamListening() {
  if (isRunning() || readRun()?.status === "needs-answer") return true;
  const s = readState();
  return !!s.task && !["done", "idle"].includes(s.phase);
}

const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtIn = (ms) => {
  const m = Math.max(1, Math.round((ms - Date.now()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
};

// Every run status change lands in the chat (with next-step buttons) and on the manager's board card.
function onRunEvent(run) {
  const title = firstLine(run.task);
  const project = findProjectByDir(run.dir);
  if (run.status === "finished") {
    const s = readState();
    const reported = s.report && s.report.t >= run.startedAt;
    const { manifest } = readManifest(run.dir);
    const canOpen = !!manifest || fs.existsSync(path.join(run.dir, "index.html"));
    systemMessage(`✅ Finished: ${sentence(title)}${reported ? "" : canOpen ? " Press ▶ Open to try it." : " Ask me how to try it."}`, {
      actions: [...(canOpen && project ? [{ kind: "open", id: project.id }] : []), ...(project ? [{ kind: "change", id: project.id, name: project.name }] : [])],
      ...(run.summary && !reported ? { details: `Team lead's last words:\n${run.summary}` } : {}),
    });
    // a picture of the result for the project card (if a browser is available and the team didn't leave one)
    if (project && manifest && ["web", "static"].includes(manifest.kind) && !(manifest.screenshot && fs.existsSync(path.join(run.dir, manifest.screenshot))))
      captureScreenshot(project).catch(() => {});
    startNextQueued(true);
  } else if (["failed", "interrupted", "stopped"].includes(run.status)) {
    const { reason, actions } = explainFailure(run);
    const text = run.status === "stopped" ? `■ Stopped: ${sentence(title)}` : `⚠️ ${title} — ${reason}`;
    systemMessage(text, {
      actions: actions.map((kind) => ({ kind, runId: run.id, ...(kind === "ask" ? { text: `What went wrong with "${title}", and can the team fix it?` } : {}) })),
      ...(run.status !== "stopped" ? { details: [run.error, run.summary && `Team lead's last words:\n${run.summary}`, run.log && `Full log: ${run.log}`].filter(Boolean).join("\n\n") } : {}),
    });
    startNextQueued(false);
  } else {
    const text = {
      waiting: `⏳ Out of Claude usage — the team paused mid-run (${run.limitMessage}). It will pick up automatically where it left off at ${fmtTime(run.resumeAt)} (in ${fmtIn(run.resumeAt)}). ■ Stop cancels.`,
      "needs-answer": `⏸ The team paused because it's waiting for your answer — nothing has been built yet. Answer the question above (or just tell me) and it carries on right where it stopped.`,
      resumed: {
        answer: `▶ Got your answer — the team is back at work on: ${sentence(title)}`,
        continue: `↻ Continuing: ${title} — the team picks up where it stopped.`,
        usage: `▶ Usage limit has reset — the team is back at work on: ${title} (attempt ${run.attempts}).`,
      }[run.reason || "usage"],
    }[run.status];
    if (text) systemMessage(text);
  }
  const board = { waiting: `Paused until ${fmtTime(run.resumeAt)}`, "needs-answer": "Waiting for your answer", resumed: "Team is back at work" }[run.status] || `Run ${run.status}`;
  updateState((s) => setAgent(s, "manager", "waiting", board));
}

function findProjectByDir(dir) {
  const card = portfolio({ showHidden: true }).find((p) => p.dir === path.resolve(dir));
  return card ? { id: card.id, name: card.name, dir: card.dir } : null;
}

// After a run ends: a finished run starts the next queued one; otherwise the next one waits for the user's ▶ Start.
function startNextQueued(auto) {
  const next = updateChat((c) => (c.queue?.length ? c.queue.shift() : null));
  if (!next) return;
  if (auto) {
    systemMessage(`⏭ Starting the next queued run: ${firstLine(next.task)}`);
    setTimeout(() => launch(next), 1500);
  } else {
    updateChat((c) => {
      c.proposal = next;
      c.messages.push(msg("system", "Next in line — press ▶ Start when you're ready.", { proposal: next }));
    });
  }
}

// ---- the things a user can do, shared by the web chat and Telegram ----
// `via` marks where it came from (e.g. "telegram") so the web chat can show it.

async function sendUserMessage(text, via) {
  text = String(text || "").trim();
  if (!text || text.length > 4000) return { error: "Message must be 1–4000 characters.", code: 400 };
  if (readChat().busy) return { error: "The manager is still replying — one moment.", code: 409 };
  // Known not to work (Claude missing / signed out)? Say so right away instead of failing minutes later.
  if (chatBlocker()) await refreshHealth().catch(() => {});
  const blocker = chatBlocker();
  if (blocker) {
    updateChat((c) => {
      c.messages.push(msg("user", text, via ? { via } : {}));
      c.messages.push(msg("system", `The manager can't reply yet: ${blocker}. The setup checklist at the top of the page shows how to fix it — it takes a minute. Then send your message again.`, { actions: [{ kind: "setup" }] }));
    });
    return { ok: true, blocked: true };
  }
  handleChat(text, via).catch((e) => {
    updateChat((c) => {
      c.busy = false;
      c.messages.push(msg("system", `Chat error: ${e.message}`));
    });
  });
  return { ok: true };
}

// Direct answer to the team's open question (T ask) — straight to its inbox, no manager round-trip.
function answerTeam(text, via) {
  text = String(text || "").trim();
  if (!text || text.length > 4000) return { error: "Answer must be 1–4000 characters.", code: 400 };
  const ask = readState().ask;
  updateChat((c) => {
    c.messages.push(msg("user", text, { answer: true, ...(via ? { via } : {}) }));
    c.inbox.push({ id: crypto.randomUUID(), t: Date.now(), text: ask ? `Answer to "${ask.text.slice(0, 200)}": ${text}` : text, read: false });
  });
  updateState((s) => {
    if (s.ask) s.ask.answered = Date.now();
    event(s, { type: "log", agent: "", msg: `💬 You answered${via ? ` (${via})` : ""}: ${text.slice(0, 120)}` });
  });
  continueAfterAnswer(); // a run that paused waiting for this answer resumes now
  return { ok: true };
}

function runAction(action, { proposalId, runId, index } = {}, via) {
  const pending = readChat().proposal;
  const extra = via ? { via } : {};
  if (action === "start") {
    if (!pending || pending.id !== proposalId) return { error: "That proposal is no longer pending.", code: 409 };
    updateChat((c) => c.messages.push(msg("user", isRunning() ? "⏭ Queue it" : "▶ Start", extra)));
    launch(pending);
    return { ok: true };
  }
  if (action === "dismiss") {
    if (pending && pending.id === proposalId)
      updateChat((c) => {
        c.proposal = null;
        c.messages.push(msg("user", "Not yet", extra));
      });
    return { ok: true };
  }
  if (action === "stop") return { ok: stopRun() };
  if (action === "continue") {
    try {
      continueRun(String(runId || ""));
      updateChat((c) => c.messages.push(msg("user", "↻ Continue", extra)));
      return { ok: true };
    } catch (e) {
      return { error: e.message, code: 409 };
    }
  }
  if (action === "retry") {
    // the same request as a fresh proposal: pressing ▶ Start again is the consent (incl. any GitHub permission)
    const cur = readRun();
    const r = cur?.id === runId ? cur : readHistory().find((h) => h.id === runId);
    if (!r) return { error: "That run isn't known any more.", code: 404 };
    try {
      const proposal = makeProposal({ project: r.dir === ROOT ? "." : r.project, task: r.task || r.title, allowGithub: r.allowGithub, size: r.size });
      updateChat((c) => {
        c.proposal = proposal;
        c.messages.push(msg("user", "↻ Try again", extra));
        c.messages.push(msg("system", "Here's the same request again — press ▶ Start when you're ready.", { proposal }));
      });
      return { ok: true };
    } catch (e) {
      return { error: e.message, code: 400 };
    }
  }
  if (action === "unqueue") {
    const removed = updateChat((c) => (Number.isInteger(index) && c.queue?.[index] ? c.queue.splice(index, 1)[0] : null));
    return removed ? { ok: true } : { error: "That run isn't in the queue.", code: 404 };
  }
  return { error: "unknown action", code: 400 };
}

// ---- My Projects actions ----
async function projectAction(body) {
  const p = findProject(body.id);
  if (!p) return { error: "That project isn't known.", code: 404 };
  const busyHere = () => {
    const r = readRun();
    return r && path.resolve(r.dir) === p.dir && (isRunning() || r.status === "needs-answer");
  };
  switch (body.action) {
    case "open":
      try {
        return { ok: true, app: await openApp(p) };
      } catch (e) {
        return { error: e.message, code: 409 };
      }
    case "stop":
      return { ok: closeApp(p.dir) };
    case "files": {
      const r = await showFiles(p.dir);
      return r.ok ? r : { error: r.error, code: 500 };
    }
    case "screenshot": {
      const file = await captureScreenshot(p);
      return file ? { ok: true } : { error: "Couldn't take a picture — this needs Chrome or Edge installed, and a project that opens in the browser.", code: 409 };
    }
    case "undo":
    case "redo": {
      if (busyHere()) return { error: "The team is working on this project right now — stop the run first.", code: 409 };
      let checkpoint;
      let title;
      if (body.action === "undo") {
        const h = readHistory().find((x) => x.id === body.runId && x.dir && path.resolve(x.dir) === p.dir);
        if (!h?.checkpoint) return { error: "There's no saved copy to go back to for that change.", code: 404 };
        if (h.allowGithub) return { error: "That change was published to GitHub, so it can't be undone here.", code: 409 };
        checkpoint = h.checkpoint;
        title = h.title;
      } else {
        if (!/^redo-\d+$/.test(String(body.checkpoint))) return { error: "Nothing to redo.", code: 400 };
        checkpoint = body.checkpoint;
      }
      stopApp(p.dir);
      try {
        const r = restoreCheckpoint(p.dir, checkpoint);
        const counts = `${r.restored} file${r.restored === 1 ? "" : "s"} put back, ${r.removed} removed`;
        systemMessage(
          body.action === "undo" ? `↶ ${p.name} is back to how it was before “${firstLine(title)}” (${counts}).` : `↷ Redone — ${p.name} is back to how it was before the undo (${counts}).`,
          { actions: [{ kind: "redo", id: body.id, checkpoint: r.redoId }] },
        );
        return { ok: true, ...r };
      } catch (e) {
        return { error: e.message, code: 409 };
      }
    }
    case "hide":
    case "unhide": {
      const hidden = new Set(readSettings().hiddenProjects);
      body.action === "hide" ? hidden.add(p.dir) : hidden.delete(p.dir);
      updateSettings({ hiddenProjects: [...hidden] });
      return { ok: true };
    }
  }
  return { error: "unknown action", code: 400 };
}

// Short plain-text status for /status on the phone.
function statusText() {
  const s = readState();
  const run = readRun();
  const lines = [];
  if (run?.status === "running") lines.push(`🟢 Working on: ${run.project} — ${firstLine(run.task)}`);
  else if (run?.status === "waiting") lines.push(`⏳ Paused by the usage limit — resumes at ${fmtTime(run.resumeAt)} (in ${fmtIn(run.resumeAt)}).`);
  else if (run?.status === "needs-answer") lines.push(`⏸ Paused until you answer the team's question — ${run.project}: ${firstLine(run.task)}`);
  else if (run) lines.push(`Last run ${run.status}: ${run.project} — ${firstLine(run.task)}`);
  else lines.push("The team is idle — tell me what to build.");
  if (run?.status === "running" && s.task) {
    const done = (s.tasks || []).filter((t) => t.status === "done").length;
    const left = minutesLeft(s, readHistory());
    lines.push(`Phase: ${String(s.phase).toUpperCase()} · ${done}/${(s.tasks || []).length} parts done${left ? ` · ${fmtMinutes(left)} left` : ""}`);
    const working = Object.entries(s.agents || {}).filter(([id, a]) => a.state === "working" && id !== "manager");
    for (const [id, a] of working) lines.push(`• ${id}: ${a.activity || "working"}`);
  }
  if (s.ask && !s.ask.answered) lines.push(`\n❓ The ${s.ask.agent} is waiting for your answer:\n${s.ask.text}`);
  return lines.join("\n");
}

const telegram = createTelegram({
  onText: (text, via) => sendUserMessage(text, via),
  onAnswer: (text, via) => answerTeam(text, via),
  onRunAction: (action, args, via) => runAction(action, args, via),
  statusText,
  studioName: () => readSettings().studioName,
});

function launch(proposal) {
  if (isRunning()) {
    // one run at a time: queue this one, it starts when the current run finishes
    updateChat((c) => {
      c.queue = [...(c.queue || []), proposal].slice(0, 10);
      if (c.proposal?.id === proposal.id) c.proposal = null;
      c.messages.push(msg("system", `⏭ Queued: ${firstLine(proposal.task)} — the team starts it as soon as the current run is done.`));
    });
    return;
  }
  try {
    // A fresh run starts with an empty inbox: notes left from earlier runs (or from when no run was listening)
    // aren't instructions for this one.
    updateChat((c) => c.inbox.forEach((m) => (m.read = true)));
    const { skipped } = startRun({ project: proposal.project, task: proposal.task, allowGithub: !!proposal.allowGithub, size: proposal.size || "standard" }, onRunEvent);
    updateChat((c) => {
      if (c.proposal?.id === proposal.id) c.proposal = null;
      c.messages.push(
        msg("system", `🚀 The team is starting on: ${sentence(firstLine(proposal.task))} They'll post a plan here for your OK before building anything.`, {
          details: `Project folder: ${proposal.dir}${proposal.isNew ? " (new)" : ""}${skipped.length ? `\nKept this project's own versions of: ${skipped.join(", ")}` : ""}`,
        }),
      );
    });
    updateState((s) => setAgent(s, "manager", "waiting", "Team is on it"));
  } catch (e) {
    systemMessage(`Couldn't start the run: ${e.message}`);
  }
}

// Browsers only reach this server as localhost. Any other Host header means a web page reached it through DNS
// rebinding — refuse, or that page could read the office and start runs (which execute code on this computer).
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
function localHost(host) {
  const h = String(host || "").toLowerCase();
  return LOCAL_HOSTS.has(h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0]);
}

async function handle(req, res) {
  if (!localHost(req.headers.host)) return send(res, 403, { error: "forbidden" });
  const url = new URL(req.url, "http://localhost");
  const route = url.pathname;

  // Only accept same-origin JSON posts, so other websites can't drive the manager or launch runs.
  // (an unparsable Origin such as "null" from a sandboxed frame counts as foreign — and must not throw)
  const sameOriginJson = () => {
    const origin = req.headers.origin;
    let host = null;
    try {
      host = origin ? new URL(origin).host : req.headers.host;
    } catch {}
    return host === req.headers.host && String(req.headers["content-type"]).startsWith("application/json");
  };
  const jsonBody = async (limit) => {
    if (req.method !== "POST" || !sameOriginJson()) return { forbidden: true };
    try {
      return { body: JSON.parse(await readBody(req, limit)) || {} };
    } catch {
      return { bad: true };
    }
  };
  const reply = (r, ok = 200) => send(res, r.error ? r.code || 400 : ok, r);

  // the launcher uses this to find the office, and to tell one started before an update (version) or mid-run (busy)
  if (route === "/api/ping") return send(res, 200, { app: "devstudio", pid: process.pid, name: readSettings().studioName, version: VERSION, busy: isRunning() });

  if (route === "/api/state") {
    let state = {};
    try {
      state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    } catch {}
    const run = readRun();
    const left = run?.status === "running" && state.task ? minutesLeft(state, readHistory()) : null;
    return send(res, 200, { ...state, configuredModels: configuredModels(), run, studioName: readSettings().studioName, minutesLeft: left });
  }

  if (route === "/api/health") {
    if (url.searchParams.has("refresh") || !health) await refreshHealth().catch(() => {});
    return send(res, 200, health || { ready: false, checks: [] });
  }

  if (route === "/api/settings") {
    if (req.method === "GET") return send(res, 200, { ...readSettings(), projectsRoot: projectsRoot(), defaultProjectsDir: defaultProjectsDir(), envProjects: !!process.env.DEVSTUDIO_PROJECTS });
    const { body, forbidden, bad } = await jsonBody(4096);
    if (forbidden) return send(res, 403, { error: "forbidden" });
    if (bad) return send(res, 400, { error: "bad request" });
    try {
      const next = updateSettings({ ...("studioName" in body ? { studioName: body.studioName } : {}), ...("projectsDir" in body ? { projectsDir: body.projectsDir } : {}), ...("lightTeam" in body ? { lightTeam: body.lightTeam } : {}) });
      refreshHealth().catch(() => {});
      return send(res, 200, { ...next, projectsRoot: projectsRoot(), defaultProjectsDir: defaultProjectsDir() });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  if (route === "/api/portfolio") return send(res, 200, { projects: portfolio({ appStatus, showHidden: url.searchParams.has("hidden") }) });

  if (route === "/api/apps") {
    const p = findProject(url.searchParams.get("id"));
    if (!p) return send(res, 404, { error: "That project isn't known." });
    const { manifest } = readManifest(p.dir);
    return send(res, 200, { project: { id: url.searchParams.get("id"), name: manifest?.name || p.name }, app: appStatus(p.dir), howTo: manifest?.howTo || [], kind: manifest?.kind || null });
  }

  // /api/projects/<id>/screenshot and /api/projects/<id>/zip
  const pm = route.match(/^\/api\/projects\/([0-9a-f]{12})\/(screenshot|zip)$/);
  if (pm && req.method === "GET") {
    const p = findProject(pm[1]);
    if (!p || !fs.existsSync(p.dir)) return send(res, 404, { error: "That project isn't known." });
    if (pm[2] === "screenshot") {
      const { manifest } = readManifest(p.dir);
      const own = manifest?.screenshot && insidePath(p.dir, manifest.screenshot);
      const file = own && fs.existsSync(own) ? own : screenshotPath(p.dir);
      if (!fs.existsSync(file)) return send(res, 404, { error: "No picture yet." });
      const type = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[path.extname(file).toLowerCase()] || "image/png";
      return send(res, 200, fs.readFileSync(file), type);
    }
    try {
      const zip = zipDirectory(p.dir, { rootName: p.name });
      res.writeHead(200, { "content-type": "application/zip", "content-disposition": `attachment; filename="${p.name}.zip"`, "cache-control": "no-store" });
      return res.end(zip);
    } catch (e) {
      return send(res, 413, { error: e.message });
    }
  }

  if (route === "/api/projects" && req.method === "POST") {
    const { body, forbidden, bad } = await jsonBody(2048);
    if (forbidden) return send(res, 403, { error: "forbidden" });
    if (bad) return send(res, 400, { error: "bad request" });
    return reply(await projectAction(body));
  }

  // Past runs + lessons for the Projects / Lessons tabs.
  if (route === "/api/overview") {
    const lessonLines = (file) => {
      try {
        return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2)).slice(-50);
      } catch {
        return [];
      }
    };
    const history = readHistory();
    const projects = [...new Map(history.map((h) => [h.dir, h])).values()].slice(0, 8);
    return send(res, 200, {
      history: history.map(({ task, sessionId, tCmd, ...h }) => h),
      lessons: {
        global: lessonLines(path.join(ROOT, ".claude", "playbooks", "lessons-global.md")),
        projects: projects.map((h) => ({ project: h.project, dir: h.dir, lines: lessonLines(path.join(h.dir, ".claude", "lessons.md")) })).filter((p) => p.lines.length),
      },
    });
  }

  if (route === "/api/chat" && req.method === "GET") {
    let chat = { messages: [], inbox: [], busy: false };
    try {
      chat = JSON.parse(fs.readFileSync(CHAT_FILE, "utf8"));
    } catch {}
    const st = readState();
    const managerModel = st.models?.manager || configuredModels().manager || "";
    const { inbox, sessionId, ...pub } = chat;
    return send(res, 200, { ...pub, queue: (chat.queue || []).map((q) => ({ task: firstLine(q.task), project: q.project })), run: readRun(), draft: chat.busy ? draft : "", managerModel, ask: st.ask || null });
  }

  // Direct answer to a team question (T ask) — goes straight to the team's inbox, no manager round-trip.
  if (route === "/api/answer") {
    const { body, forbidden, bad } = await jsonBody(8192);
    if (forbidden) return send(res, 403, { error: "forbidden" });
    if (bad) return send(res, 400, { error: "bad request" });
    return reply(answerTeam(String(body.text || "").trim()));
  }

  // Phone (Telegram) connection: status, connect with a bot token, new pairing code, disconnect.
  if (route === "/api/telegram") {
    if (req.method === "GET") return send(res, 200, telegram.status());
    const { body, forbidden, bad } = await jsonBody(2048);
    if (forbidden) return send(res, 403, { error: "forbidden" });
    if (bad) return send(res, 400, { error: "bad request" });
    try {
      if (body.action === "setup") return send(res, 200, await telegram.setup(body.token));
      if (body.action === "newcode") return send(res, 200, telegram.newPairCode());
      if (body.action === "disconnect") return send(res, 200, telegram.disconnect());
    } catch (e) {
      return send(res, 400, { error: /Unauthorized|401/i.test(e.message) ? "Telegram rejected that token — copy it again from @BotFather." : e.message });
    }
    return send(res, 400, { error: "unknown action" });
  }

  if (route === "/api/run") {
    const { body, forbidden, bad } = await jsonBody(1024);
    if (forbidden) return send(res, 403, { error: "forbidden" });
    if (bad) return send(res, 400, { error: "bad request" });
    return reply(runAction(body.action, { proposalId: body.proposalId, runId: body.runId, index: body.index }));
  }

  if (route === "/api/chat" && req.method === "POST") {
    const { body, forbidden, bad } = await jsonBody();
    if (forbidden) return send(res, 403, { error: "forbidden" });
    if (bad) return send(res, 400, { error: "bad request" });
    return reply(await sendUserMessage(String(body.text || "").trim()), 202);
  }

  if (route.startsWith("/api/")) return send(res, 404, { error: "not found" });
  const file = path.normalize(path.join(PUBLIC, route === "/" ? "index.html" : route));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, "", "text/plain");
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "Not found", "text/plain");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  });
}

const server = http
  .createServer((req, res) =>
    // one bad request must never take the office down
    handle(req, res).catch((e) => {
      console.error("[office] request failed:", e);
      if (!res.headersSent) send(res, 500, { error: "Something went wrong in the office." });
      else res.end();
    }),
  )
  .listen(PORT, "127.0.0.1", () => {
    const port = server.address().port;
    // Clear a stale "busy" flag left by a server that was stopped mid-reply.
    try {
      if (readChat().busy) updateChat((c) => (c.busy = false));
      recoverRunState(onRunEvent); // re-arms an automatic resume if a run is waiting for a usage reset
    } catch {}
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(PID_FILE, JSON.stringify({ pid: process.pid, port, startedAt: Date.now() }));
    } catch {}
    console.log(`Team office running at http://localhost:${port}`);
  });
server.on("error", (e) => {
  if (e.code !== "EADDRINUSE") throw e;
  console.error(`Port ${PORT} is already in use. Start the Dev Studio with bin/devstudio (Windows: bin\\devstudio.cmd) — it opens the office if it's already running, replaces an older version, and says if another program has the port.\n(Or start it on another port: node tools/team-office/server.mjs <port>)`);
  process.exit(1);
});
process.on("exit", () => {
  try {
    if (JSON.parse(fs.readFileSync(PID_FILE, "utf8")).pid === process.pid) fs.rmSync(PID_FILE, { force: true });
  } catch {}
});
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    shutdown();
    stopAllApps();
    process.exit(0);
  });
}
