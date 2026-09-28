#!/usr/bin/env node
// Team progress CLI. Writes .claude/team/state.json, which the pixel office (server.mjs) renders.
// The task graph uses AmnesiaGraph's normalized format ({ version, tasks: [{ id, order, title, source, depends_on, verify }] })
// plus an optional `owner` field, so the same file can be fed to `amnesia init` if AmnesiaGraph is installed.
//
// Usage:
//   node tools/team-office/team.mjs init "<task description>"
//   node tools/team-office/team.mjs phase <plan|build|test|fix|review|done>
//   node tools/team-office/team.mjs agent <name> <idle|working|waiting|done|failed> ["activity"]
//   node tools/team-office/team.mjs tasks <graph.json>
//   node tools/team-office/team.mjs task <id> <start|done|block|reset|verify> ["reason"]
//   node tools/team-office/team.mjs log <agent> "<message>"
//   node tools/team-office/team.mjs say <agent> "<message>"   # post into the user's chat
//   node tools/team-office/team.mjs inbox                      # print + mark read the user's messages for the team
//   node tools/team-office/team.mjs resume                     # print active / ready / blocked work
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ROOT, DIR, STATE_FILE, AGENTS, AGENT_STATES, PHASES,
  emptyState, withLock, readState, writeState, updateState, updateChat, event, setAgent, summary,
} from "./lib.mjs";

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function setTask(state, id, status, reason = "") {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) fail(`Unknown task ${id}. Known: ${state.tasks.map((x) => x.id).join(", ")}`);
  t.status = status;
  t.reason = reason;
  if (status === "active") t.startedAt = Date.now();
  if (status === "done") t.doneAt = Date.now();
  event(state, { type: "task", id, status, msg: reason ? `${id} ${status}: ${reason}` : `${id} ${status} — ${t.title}`, agent: t.owner || "" });
  return t;
}

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "init": {
    withLock(() => {
      if (fs.existsSync(STATE_FILE)) fs.copyFileSync(STATE_FILE, path.join(DIR, "state.prev.json"));
      const prev = readState();
      const s = emptyState(args[0] || "Untitled task");
      // keep models already seen for this session (the run's lead is recorded before it calls init; the manager persists)
      s.models = Object.fromEntries(Object.entries(prev.models || {}).filter(([k]) => k === "lead" || k === "manager"));
      s.agents.manager = prev.agents.manager;
      event(s, { type: "log", agent: "", msg: `New run: ${s.task}` });
      writeState(s);
    });
    break;
  }
  case "phase": {
    const [phase] = args;
    if (!PHASES.includes(phase)) fail(`phase must be one of ${PHASES.join(", ")}`);
    updateState((s) => {
      if (phase === "fix") s.loop = (s.loop || 0) + 1;
      s.phase = phase;
      event(s, { type: "phase", phase, agent: "", msg: `Phase → ${phase.toUpperCase()}${phase === "fix" ? ` (loop ${s.loop})` : ""}` });
    });
    break;
  }
  case "agent": {
    const [name, st, activity = ""] = args;
    if (!AGENTS.includes(name)) fail(`agent must be one of ${AGENTS.join(", ")}`);
    if (!AGENT_STATES.includes(st)) fail(`state must be one of ${AGENT_STATES.join(", ")}`);
    updateState((s) => setAgent(s, name, st, activity));
    break;
  }
  case "tasks": {
    const [file] = args;
    if (!file) fail("usage: tasks <graph.json>");
    const graph = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
    const list = Array.isArray(graph) ? graph : graph.tasks;
    if (!Array.isArray(list)) fail("graph must be { version, tasks: [...] }");
    const ids = new Set(list.map((t) => t.id));
    for (const t of list) {
      for (const d of t.depends_on || []) if (!ids.has(d)) fail(`${t.id} depends on unknown task ${d}`);
    }
    updateState((s) => {
      const prev = new Map(s.tasks.map((t) => [t.id, t]));
      s.tasks = list
        .map((t, i) => ({
          id: t.id,
          order: t.order ?? i + 1,
          title: t.title,
          source: t.source || "",
          depends_on: t.depends_on || [],
          verify: t.verify || [],
          owner: t.owner || "",
          status: prev.get(t.id)?.status || "pending",
          reason: prev.get(t.id)?.reason || "",
        }))
        .sort((a, b) => a.order - b.order);
      event(s, { type: "log", agent: "architect", msg: `Execution graph loaded: ${s.tasks.length} tasks` });
    });
    break;
  }
  case "task": {
    const [id, action, reason = ""] = args;
    const map = { start: "active", done: "done", block: "blocked", reset: "pending" };
    if (action === "verify") {
      const t = readState().tasks.find((x) => x.id === id);
      if (!t) fail(`Unknown task ${id}`);
      for (const c of t.verify) {
        console.log(`$ ${c}`);
        try {
          execSync(c, { cwd: process.cwd(), stdio: "inherit", timeout: 300000 }); // run in the project being built
        } catch {
          updateState((s) => setTask(s, id, "blocked", `verify failed: ${c}`));
          fail(`${id} blocked: verify failed: ${c}`);
        }
      }
      updateState((s) => setTask(s, id, "done"));
      console.log(`${id} verified and done`);
      break;
    }
    if (!map[action]) fail("action must be start|done|block|reset|verify");
    updateState((s) => setTask(s, id, map[action], reason));
    break;
  }
  case "log": {
    const [agent, msg] = args;
    updateState((s) => event(s, { type: "log", agent: agent || "", msg: msg || "" }));
    break;
  }
  case "say": {
    const [agent, msg] = args;
    if (!AGENTS.includes(agent)) fail(`agent must be one of ${AGENTS.join(", ")}`);
    if (!msg) fail('usage: say <agent> "<message>"');
    updateChat((c) => c.messages.push({ id: crypto.randomUUID(), t: Date.now(), from: agent, text: msg }));
    updateState((s) => event(s, { type: "log", agent, msg: `💬 ${msg}` }));
    break;
  }
  case "inbox": {
    const unread = updateChat((c) => {
      const u = c.inbox.filter((m) => !m.read);
      u.forEach((m) => (m.read = true));
      return u;
    });
    if (!unread.length) console.log("Inbox empty — no new instructions from the user.");
    for (const m of unread) console.log(`[${new Date(m.t).toLocaleTimeString()}] ${m.text}`);
    break;
  }
  case "resume": {
    console.log(summary(readState()));
    break;
  }
  default:
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 16).join("\n").replace(/^\/\/ ?/gm, ""));
}
