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
import { ROOT, STATE_FILE, CHAT_FILE, readState, readChat, updateChat, updateState, setAgent, summary } from "./lib.mjs";

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

function askManager(text, sessionId) {
  const s = readState();
  const prompt =
    `${text}\n\n` +
    `<team_snapshot at="${new Date().toLocaleString()}">\n${s.task ? summary(s) : "No run in progress — the team is idle."}\n` +
    (s.events?.length ? `Recent events:\n${recentEvents(s)}\n` : "") +
    `</team_snapshot>`;
  const args = ["-p", "--agent", "manager", "--output-format", "json", "--strict-mcp-config", "--permission-mode", "dontAsk"];
  if (sessionId) args.push("--resume", sessionId);
  const env = { ...process.env };
  delete env.CLAUDECODE; // let the CLI run even if this server was launched from inside a Claude Code session

  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let child;
    try {
      child = spawn(CLAUDE_BIN, args, { cwd: ROOT, env, windowsHide: true });
    } catch (e) {
      return resolve({ error: `Couldn't start the Claude CLI (${e.message}).` });
    }
    const timer = setTimeout(() => child.kill(), REPLY_TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ error: e.code === "ENOENT" ? "The Claude CLI (`claude`) isn't on PATH for the office server." : e.message });
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out.trim().split("\n").pop());
        if (r.is_error) return resolve({ error: r.result || "The manager hit an error.", sessionId: r.session_id });
        resolve({ text: r.result || "", sessionId: r.session_id });
      } catch {
        resolve({ error: (err || out || "No reply (timed out?)").trim().slice(0, 400) });
      }
    });
    child.stdin.end(prompt);
  });
}

function splitRelays(text) {
  const relays = [];
  const body = text
    .split("\n")
    .filter((line) => {
      const m = line.match(/^\s*RELAY:\s*(.+)$/);
      if (m) relays.push(m[1].trim());
      return !m;
    })
    .join("\n")
    .trim();
  return { body, relays };
}

async function handleChat(text) {
  const sessionId = updateChat((c) => {
    c.messages.push(msg("user", text));
    c.busy = true;
    return c.sessionId;
  });
  updateState((s) => setAgent(s, "manager", "working", "Replying to you"));

  let r = await askManager(text, sessionId);
  // A stale/unknown session id: retry once as a fresh conversation.
  if (r.error && sessionId && /session|conversation/i.test(r.error)) r = await askManager(text, null);

  if (r.error) {
    const loginHint = /log ?in|auth|401/i.test(r.error)
      ? " To enable live replies, open a terminal, run `claude`, and sign in with /login — then try again."
      : "";
    updateChat((c) => {
      c.busy = false;
      c.messages.push(msg("system", `The manager couldn't reply: ${r.error}.${loginHint} Your message was saved to the team inbox, so the /team pipeline will still see it.`));
      c.inbox.push({ id: crypto.randomUUID(), t: Date.now(), text, read: false });
    });
    updateState((s) => setAgent(s, "manager", "failed", "Chat offline"));
    return;
  }

  const { body, relays } = splitRelays(r.text);
  updateChat((c) => {
    c.busy = false;
    c.sessionId = r.sessionId || c.sessionId;
    c.messages.push(msg("manager", body || "(no reply)", relays.length ? { relays } : {}));
    for (const t of relays) c.inbox.push({ id: crypto.randomUUID(), t: Date.now(), text: t, read: false });
  });
  updateState((s) => {
    setAgent(s, "manager", "waiting", relays.length ? `Relayed ${relays.length} note(s) to team` : "Here if you need me");
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/api/state") {
      let body = "{}";
      try {
        body = fs.readFileSync(STATE_FILE, "utf8");
      } catch {}
      return send(res, 200, body);
    }

    if (url.pathname === "/api/chat" && req.method === "GET") {
      let body = null;
      try {
        body = fs.readFileSync(CHAT_FILE, "utf8");
      } catch {}
      return send(res, 200, body || JSON.stringify({ messages: [], inbox: [], busy: false }));
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      // Only accept same-origin JSON posts, so other websites can't drive the manager.
      const origin = req.headers.origin;
      if ((origin && new URL(origin).host !== req.headers.host) || !String(req.headers["content-type"]).startsWith("application/json")) {
        return send(res, 403, { error: "forbidden" });
      }
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
    } catch {}
    console.log(`Team office running at http://localhost:${PORT}`);
  });
