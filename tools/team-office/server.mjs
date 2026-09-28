#!/usr/bin/env node
// Serves the pixel office UI, the live team state, and the manager chat. No dependencies.
//   node tools/team-office/server.mjs [port]   (default 4400)
//
// Chat replies come from the `manager` agent (.claude/agents/manager.md) via the Claude Code CLI in headless mode
// (`claude -p --agent manager`), so they use your existing Claude Code login. Set CLAUDE_BIN to override the binary.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ROOT, STATE_FILE, CHAT_FILE, readState, readChat, updateChat, updateState, setAgent, setModel, configuredModels, summary, claudeEnv } from "./lib.mjs";
import { readRun, startRun, stopRun, isRunning, resolveProject, recoverRunState } from "./runner.mjs";
import { createStreamParser } from "./stream.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "public");
const PORT = Number(process.argv[2] || process.env.PORT || 4400);
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const REPLY_TIMEOUT_MS = 180000;

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
      ? `Pipeline run: ${run.status.toUpperCase()} — project "${run.project}" (${run.dir}) — task: ${run.task} — started ${t(run.startedAt)}${run.endedAt ? `, ended ${t(run.endedAt)}` : ""}${run.error ? ` — error: ${run.error}` : ""}`
      : "No pipeline run has been started from the office yet.",
    proposal ? `Pending proposal (waiting for the user's confirmation): project "${proposal.project}"${proposal.isNew ? " (new folder)" : ""} — ${proposal.task}` : "No pending proposal.",
    `This repo (Merage Hub, project name "merage-hub"): ${ROOT}`,
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
    const parser = createStreamParser({
      onText: (text) => (draft = visibleDraft(text)),
      onModel: (model, agent) => !agent && updateState((s) => setModel(s, "manager", model)),
    });
    child.stdout.on("data", (d) => parser.push(d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ error: e.code === "ENOENT" ? "The Claude CLI (`claude`) isn't on PATH for the office server." : e.message });
    });
    child.on("close", () => {
      clearTimeout(timer);
      const r = parser.end();
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
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(RELAY|PROPOSE|START):\s*(.*)$/);
    if (m) {
      inPropose = false;
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
    if (!propose.task) propose = null;
  }
  return { body: body.join("\n").trim(), relays, propose, start };
}

async function handleChat(text) {
  const sessionId = updateChat((c) => {
    c.messages.push(msg("user", text));
    c.busy = true;
    return c.sessionId;
  });
  updateState((s) => setAgent(s, "manager", "working", "Replying to you"));

  draft = "";
  let r = await askManager(text, sessionId);
  // A stale/unknown session id: retry once as a fresh conversation.
  if (r.error && sessionId && /session|conversation/i.test(r.error)) {
    draft = "";
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
      proposal = { id: crypto.randomUUID(), t: Date.now(), project: p.name, dir: p.dir, isNew: p.isNew, task: propose.task };
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

function launch(proposal) {
  if (isRunning()) return systemMessage("A run is already in progress — stop it (■ in the chat) before starting another.");
  try {
    startRun({ project: proposal.project, task: proposal.task }, (run) => {
      const title = run.task.split("\n")[0].slice(0, 120);
      const how = {
        finished: `✅ Run finished — ${title}. Files are in ${run.dir}.`,
        stopped: `■ Run stopped — ${title}.`,
        failed: `⚠️ Run failed — ${title}.${run.error ? ` ${run.error}` : ""}`,
      }[run.status];
      systemMessage(how + (run.summary && run.status !== "stopped" ? `\n\nTeam lead's last words:\n${run.summary}` : "") + (run.status === "failed" ? `\n\nFull log: ${run.log}` : ""));
      updateState((s) => setAgent(s, "manager", "waiting", `Run ${run.status}`));
    });
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
      return send(res, 200, { ...state, configuredModels: configuredModels() });
    }

    if (url.pathname === "/api/chat" && req.method === "GET") {
      let chat = { messages: [], inbox: [], busy: false };
      try {
        chat = JSON.parse(fs.readFileSync(CHAT_FILE, "utf8"));
      } catch {}
      const managerModel = readState().models?.manager || configuredModels().manager || "";
      return send(res, 200, { ...chat, run: readRun(), draft: chat.busy ? draft : "", managerModel });
    }

    // Only accept same-origin JSON posts, so other websites can't drive the manager or launch runs.
    const sameOriginJson = () => {
      const origin = req.headers.origin;
      return !(origin && new URL(origin).host !== req.headers.host) && String(req.headers["content-type"]).startsWith("application/json");
    };

    if (url.pathname === "/api/run" && req.method === "POST") {
      if (!sameOriginJson()) return send(res, 403, { error: "forbidden" });
      let body;
      try {
        body = JSON.parse(await readBody(req, 1024));
      } catch {
        return send(res, 400, { error: "bad request" });
      }
      const pending = readChat().proposal;
      if (body.action === "start") {
        if (!pending || pending.id !== body.proposalId) return send(res, 409, { error: "That proposal is no longer pending." });
        updateChat((c) => c.messages.push(msg("user", "▶ Start")));
        launch(pending);
        return send(res, 200, { ok: true });
      }
      if (body.action === "dismiss") {
        if (pending && pending.id === body.proposalId)
          updateChat((c) => {
            c.proposal = null;
            c.messages.push(msg("user", "Not yet"));
          });
        return send(res, 200, { ok: true });
      }
      if (body.action === "stop") {
        return send(res, 200, { ok: stopRun() });
      }
      return send(res, 400, { error: "unknown action" });
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      if (!sameOriginJson()) return send(res, 403, { error: "forbidden" });
      let text;
      try {
        text = String(JSON.parse(await readBody(req)).text || "").trim();
      } catch {
        return send(res, 400, { error: "bad request" });
      }
      if (!text || text.length > 4000) return send(res, 400, { error: "Message must be 1–4000 characters." });
      if (readChat().busy) return send(res, 409, { error: "The manager is still replying — one moment." });
      handleChat(text).catch((e) => {
        updateChat((c) => {
          c.busy = false;
          c.messages.push(msg("system", `Chat error: ${e.message}`));
        });
      });
      return send(res, 202, { ok: true });
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
      recoverRunState();
    } catch {}
    console.log(`Team office running at http://localhost:${PORT}`);
  });
