#!/usr/bin/env node
// Serves the pixel office UI, the live team state, and the manager chat. No dependencies.
//   node tools/team-office/server.mjs [port]   (default 4400)
//
// Chat replies come from the `manager` agent (.claude/agents/manager.md) via the Claude Code CLI in headless mode
// (`claude -p --agent manager`), so they use your existing Claude Code login. Set CLAUDE_BIN to override the binary.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ROOT, STATE_FILE, CHAT_FILE, readState, readChat, updateChat, updateState, setAgent, setModel, configuredModels, summary, claudeEnv, event } from "./lib.mjs";
import { readRun, readHistory, startRun, stopRun, isRunning, resolveProject, recoverRunState } from "./runner.mjs";
import { createStreamParser } from "./stream.mjs";
import { createTelegram } from "./telegram.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "public");
const PORT = Number(process.argv[2] || process.env.PORT || 4400);
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const REPLY_TIMEOUT_MS = 180000;

// Which GitHub account `gh` is signed in to (shown on publishing proposals and to the manager). Refreshed every 10 min.
let githubAccount = null;
function refreshGithubAccount() {
  execFile("gh", ["api", "user", "--jq", ".login"], { timeout: 15000, windowsHide: true }, (err, out) => {
    githubAccount = err ? null : String(out).trim() || null;
  });
}
refreshGithubAccount();
setInterval(refreshGithubAccount, 10 * 60 * 1000).unref();

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
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

const msg = (from, text, extra = {}) => ({ id: crypto.randomUUID(), t: Date.now(), from, text, ...extra });

function recentEvents(s, n = 12) {
  return (s.events || [])
    .slice(-n)
    .map((e) => `  ${new Date(e.t).toLocaleTimeString()} ${e.agent || "system"}: ${e.msg}`)
    .join("\n");
}

function runSnapshot() {
  const run = readRun();
  const { proposal } = readChat();
  const t = (ms) => new Date(ms).toLocaleTimeString();
  let projects = [];
  try {
    projects = fs.readdirSync(path.resolve(ROOT, ".."), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name);
  } catch {}
  return [
    run
      ? `Pipeline run: ${run.status.toUpperCase()} — project "${run.project}" (${run.dir}) — task: ${run.task.split("\n")[0]} — started ${t(run.startedAt)}${run.attempts > 1 ? `, attempt ${run.attempts}` : ""}${run.endedAt ? `, ended ${t(run.endedAt)}` : ""}${run.error ? ` — error: ${run.error}` : ""}` +
        (run.status === "waiting" ? ` — paused by the Claude usage limit; resumes automatically at ${t(run.resumeAt)}, continuing where it left off (the user can ■ Stop it).` : "")
      : "No pipeline run has been started from the office yet.",
    proposal ? `Pending proposal (waiting for the user's confirmation): project "${proposal.project}"${proposal.isNew ? " (new folder)" : ""} — ${proposal.task}` : "No pending proposal.",
    (() => {
      const ask = readState().ask;
      if (!ask) return "The team has no open question for the user.";
      return ask.answered
        ? `The user already answered the team's question ("${ask.text.slice(0, 200)}") — the team will pick it up at its next inbox check.`
        : `The team is WAITING for the user's answer (${ask.agent} asks: "${ask.text.slice(0, 400)}"). Point the user to the yellow banner / ✓ Approve and ✎ Reply buttons, or if they answer you in chat, RELAY it.`;
    })(),
    `This repo (Merage Hub, project name "merage-hub"): ${ROOT}`,
    githubAccount ? `GitHub CLI (gh) is signed in as: ${githubAccount} — runs you mark with ALLOW: github can create repos and push there.` : "GitHub CLI (gh) is not signed in — publishing runs won't work until the user runs `gh auth login`.",
    `Sibling project folders in ${path.resolve(ROOT, "..")}: ${projects.join(", ") || "(none)"}`,
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

// The reply as it's being written, minus directive lines (and a trailing half-written one).
let draft = "";
function visibleDraft(text) {
  const lines = text.split("\n").filter((l) => !/^\s*(RELAY|PROPOSE|START):/.test(l));
  const last = lines[lines.length - 1]?.trim() || "";
  if (last && /^[A-Z]{1,7}$/.test(last) && ["RELAY:", "PROPOSE:", "START:"].some((d) => d.startsWith(last))) lines.pop();
  return lines.join("\n").trimEnd();
}

// Directive lines the manager appends (hidden from the user):
//   RELAY: <instruction for the team>        PROPOSE: <project-folder> | <task>        START:
function parseDirectives(text) {
  const relays = [];
  let propose = null;
  let start = false;
  const body = [];
  let inPropose = false; // a PROPOSE brief may continue over several lines, until the next directive
  let allowGithub = false; // "ALLOW: github" — the proposed run may commit/push (shown on the card; Start = consent)
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(RELAY|PROPOSE|START|ALLOW):\s*(.*)$/);
    if (m) {
      inPropose = false;
      if (m[1] === "ALLOW" && /github/i.test(m[2])) allowGithub = true;
      if (m[1] === "RELAY" && m[2].trim()) relays.push(m[2].trim());
      if (m[1] === "START") start = true;
      if (m[1] === "PROPOSE") {
        const [project, ...rest] = m[2].split("|");
        propose = { project: project.trim(), task: rest.join("|").trim() };
        inPropose = true;
      }
    } else if (inPropose) propose.task += "\n" + line;
    else body.push(line);
  }
  if (propose) {
    propose.task = propose.task.trim();
    propose.allowGithub = allowGithub;
    if (!propose.task) propose = null;
  }
  return { body: body.join("\n").trim(), relays, propose, start };
}

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
    const loginHint = /log ?in|auth|401/i.test(r.error)
      ? " Sign-in can't be done from this chat. Open PowerShell (Start menu → PowerShell), run: claude auth login — approve in the browser, then send your message here again."
      : "";
    updateChat((c) => {
      c.busy = false;
      c.messages.push(msg("system", `The manager couldn't reply: ${r.error}.${loginHint} Your message was saved to the team inbox, so the /team pipeline will still see it.`));
      c.inbox.push({ id: crypto.randomUUID(), t: Date.now(), text, read: false });
    });
    updateState((s) => setAgent(s, "manager", "failed", "Chat offline"));
    return;
  }

  const { body, relays, propose, start } = parseDirectives(r.text);

  // PROPOSE → a run card the user can confirm; the manager decides the project folder and task.
  let proposal = null;
  let notice = null;
  if (propose) {
    try {
      const p = resolveProject(propose.project);
      proposal = { id: crypto.randomUUID(), t: Date.now(), project: p.name, dir: p.dir, isNew: p.isNew, task: propose.task, allowGithub: !!propose.allowGithub, githubAccount: githubAccount || null };
    } catch (e) {
      notice = `Couldn't prepare that run: ${e.message}`;
    }
  }

  updateChat((c) => {
    c.busy = false;
    c.sessionId = r.sessionId || c.sessionId;
    c.messages.push(msg("manager", body || "(no reply)", { ...(relays.length ? { relays } : {}), ...(proposal ? { proposal } : {}) }));
    if (proposal) c.proposal = proposal;
    if (notice) c.messages.push(msg("system", notice));
    for (const t of relays) c.inbox.push({ id: crypto.randomUUID(), t: Date.now(), text: t, read: false });
  });
  updateState((s) => {
    setAgent(s, "manager", "waiting", proposal ? "Waiting for your go-ahead" : relays.length ? `Relayed ${relays.length} note(s) to team` : "Here if you need me");
  });

  // START → only launches a run the user has already seen proposed (guards against starting unconfirmed work).
  if (start) {
    const pending = readChat().proposal;
    if (pending) launch(pending);
    else systemMessage("The manager tried to start a run without proposing one first — ask it to propose the run so you can confirm it.");
  }
}

function systemMessage(text) {
  updateChat((c) => c.messages.push(msg("system", text)));
}

const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtIn = (ms) => {
  const m = Math.max(1, Math.round((ms - Date.now()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
};

// Every run status change lands in the chat and on the manager's board card.
function onRunEvent(run) {
  const title = run.task.split("\n")[0].slice(0, 120);
  const text = {
    waiting: `⏳ Out of Claude usage — the team paused mid-run (${run.limitMessage}). It will pick up automatically where it left off at ${fmtTime(run.resumeAt)} (in ${fmtIn(run.resumeAt)}). ■ Stop cancels.`,
    resumed: `▶ Usage limit has reset — the team is back at work on: ${title} (attempt ${run.attempts}).`,
    finished: `✅ Run finished — ${title}. Files are in ${run.dir}.`,
    stopped: `■ Run stopped — ${title}.`,
    failed: `⚠️ Run failed — ${title}.${run.error ? ` ${run.error}` : ""}`,
  }[run.status];
  if (!text) return;
  const extra =
    (run.summary && ["finished", "failed"].includes(run.status) ? `\n\nTeam lead's last words:\n${run.summary}` : "") +
    (run.status === "failed" ? `\n\nFull log: ${run.log}` : "");
  systemMessage(text + extra);
  const board = { waiting: `Paused until ${fmtTime(run.resumeAt)}`, resumed: "Team is back at work" }[run.status] || `Run ${run.status}`;
  updateState((s) => setAgent(s, "manager", "waiting", board));
}

// ---- the three things a user can do, shared by the web chat and Telegram ----
// `via` marks where it came from (e.g. "telegram") so the web chat can show it.

function sendUserMessage(text, via) {
  text = String(text || "").trim();
  if (!text || text.length > 4000) return { error: "Message must be 1–4000 characters.", code: 400 };
  if (readChat().busy) return { error: "The manager is still replying — one moment.", code: 409 };
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
  return { ok: true };
}

function runAction(action, proposalId, via) {
  const pending = readChat().proposal;
  const extra = via ? { via } : {};
  if (action === "start") {
    if (!pending || pending.id !== proposalId) return { error: "That proposal is no longer pending.", code: 409 };
    updateChat((c) => c.messages.push(msg("user", "▶ Start", extra)));
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
  return { error: "unknown action", code: 400 };
}

// Short plain-text status for /status on the phone.
function statusText() {
  const s = readState();
  const run = readRun();
  const lines = [];
  if (run?.status === "running") lines.push(`🟢 Working on: ${run.project} — ${run.task.split("\n")[0].slice(0, 160)}`);
  else if (run?.status === "waiting") lines.push(`⏳ Paused by the usage limit — resumes at ${fmtTime(run.resumeAt)} (in ${fmtIn(run.resumeAt)}).`);
  else if (run) lines.push(`Last run ${run.status}: ${run.project} — ${run.task.split("\n")[0].slice(0, 120)}`);
  else lines.push("The team is idle — tell me what to build.");
  if (run?.status === "running" && s.task) {
    const done = (s.tasks || []).filter((t) => t.status === "done").length;
    lines.push(`Phase: ${String(s.phase).toUpperCase()} · ${done}/${(s.tasks || []).length} tasks done`);
    const working = Object.entries(s.agents || {}).filter(([id, a]) => a.state === "working" && id !== "manager");
    for (const [id, a] of working) lines.push(`• ${id}: ${a.activity || "working"}`);
  }
  if (s.ask && !s.ask.answered) lines.push(`\n❓ The ${s.ask.agent} is waiting for your answer:\n${s.ask.text}`);
  return lines.join("\n");
}

const telegram = createTelegram({
  onText: (text, via) => sendUserMessage(text, via),
  onAnswer: (text, via) => answerTeam(text, via),
  onRunAction: (action, id, via) => runAction(action, id, via),
  statusText,
});

function launch(proposal) {
  if (isRunning()) return systemMessage("A run is already in progress or paused until the usage limit resets — stop it (■ in the chat) before starting another.");
  try {
    startRun({ project: proposal.project, task: proposal.task, allowGithub: !!proposal.allowGithub }, onRunEvent);
    updateChat((c) => {
      c.proposal = null;
      c.messages.push(msg("system", `🚀 Run started: ${proposal.task}\nProject folder: ${proposal.dir}${proposal.isNew ? " (new)" : ""}. The team will post the plan here for your go-ahead before building.`));
    });
    updateState((s) => setAgent(s, "manager", "waiting", "Team is on it"));
  } catch (e) {
    systemMessage(`Couldn't start the run: ${e.message}`);
  }
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/api/state") {
      let state = {};
      try {
        state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      } catch {}
      return send(res, 200, { ...state, configuredModels: configuredModels(), run: readRun() });
    }

    // Past runs + lessons for the Projects / Lessons tabs.
    if (url.pathname === "/api/overview") {
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
        history,
        lessons: {
          global: lessonLines(path.join(ROOT, ".claude", "playbooks", "lessons-global.md")),
          projects: projects.map((h) => ({ project: h.project, dir: h.dir, lines: lessonLines(path.join(h.dir, ".claude", "lessons.md")) })).filter((p) => p.lines.length),
        },
      });
    }

    if (url.pathname === "/api/chat" && req.method === "GET") {
      let chat = { messages: [], inbox: [], busy: false };
      try {
        chat = JSON.parse(fs.readFileSync(CHAT_FILE, "utf8"));
      } catch {}
      const st = readState();
      const managerModel = st.models?.manager || configuredModels().manager || "";
      return send(res, 200, { ...chat, run: readRun(), draft: chat.busy ? draft : "", managerModel, ask: st.ask || null });
    }

    // Only accept same-origin JSON posts, so other websites can't drive the manager or launch runs.
    const sameOriginJson = () => {
      const origin = req.headers.origin;
      return !(origin && new URL(origin).host !== req.headers.host) && String(req.headers["content-type"]).startsWith("application/json");
    };

    // Direct answer to a team question (T ask) — goes straight to the team's inbox, no manager round-trip.
    if (url.pathname === "/api/answer" && req.method === "POST") {
      if (!sameOriginJson()) return send(res, 403, { error: "forbidden" });
      let text;
      try {
        text = String(JSON.parse(await readBody(req, 8192)).text || "").trim();
      } catch {
        return send(res, 400, { error: "bad request" });
      }
      const r = answerTeam(text);
      return send(res, r.error ? r.code : 200, r);
    }

    // Phone (Telegram) connection: status, connect with a bot token, new pairing code, disconnect.
    if (url.pathname === "/api/telegram") {
      if (req.method === "GET") return send(res, 200, telegram.status());
      if (req.method !== "POST" || !sameOriginJson()) return send(res, 403, { error: "forbidden" });
      let body;
      try {
        body = JSON.parse(await readBody(req, 2048));
      } catch {
        return send(res, 400, { error: "bad request" });
      }
      try {
        if (body.action === "setup") return send(res, 200, await telegram.setup(body.token));
        if (body.action === "newcode") return send(res, 200, telegram.newPairCode());
        if (body.action === "disconnect") return send(res, 200, telegram.disconnect());
      } catch (e) {
        return send(res, 400, { error: /Unauthorized|401/i.test(e.message) ? "Telegram rejected that token — copy it again from @BotFather." : e.message });
      }
      return send(res, 400, { error: "unknown action" });
    }

    if (url.pathname === "/api/run" && req.method === "POST") {
      if (!sameOriginJson()) return send(res, 403, { error: "forbidden" });
      let body;
      try {
        body = JSON.parse(await readBody(req, 1024));
      } catch {
        return send(res, 400, { error: "bad request" });
      }
      const r = runAction(body.action, body.proposalId);
      return send(res, r.error ? r.code : 200, r);
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      if (!sameOriginJson()) return send(res, 403, { error: "forbidden" });
      let text;
      try {
        text = String(JSON.parse(await readBody(req)).text || "").trim();
      } catch {
        return send(res, 400, { error: "bad request" });
      }
      const r = sendUserMessage(text);
      return send(res, r.error ? r.code : 202, r);
    }

    const file = path.normalize(path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname));
    if (!file.startsWith(PUBLIC)) return send(res, 403, "", "text/plain");
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, "Not found", "text/plain");
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(data);
    });
  })
  .listen(PORT, "127.0.0.1", () => {
    // Clear a stale "busy" flag left by a server that was stopped mid-reply.
    try {
      if (readChat().busy) updateChat((c) => (c.busy = false));
      recoverRunState(onRunEvent); // re-arms an automatic resume if a run is waiting for a usage reset
    } catch {}
    console.log(`Team office running at http://localhost:${PORT}`);
  });
