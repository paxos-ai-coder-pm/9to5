#!/usr/bin/env node
// Team progress CLI. Writes .claude/team/state.json, which the pixel office (server.mjs) renders.
// The task graph uses AmnesiaGraph's normalized format ({ version, tasks: [{ id, order, title, source, depends_on, verify }] })
// plus an optional `owner` field, so the same file can be fed to `amnesia init` if AmnesiaGraph is installed.
//
// Usage:
//   node tools/team-office/team.mjs init "<task description>"
//   node tools/team-office/team.mjs phase <plan|build|test|fix|review|done>
//   node tools/team-office/team.mjs agent <name> <idle|working|waiting|done|failed> ["activity"]
//   node tools/team-office/team.mjs tasks <graph.json>            # tasks may carry a "plain" title for the user
//   node tools/team-office/team.mjs task <id> <start|done|block|reset|verify> ["reason"]
//   node tools/team-office/team.mjs log <agent> "<message>"
//   node tools/team-office/team.mjs say <agent> "<message>"   # post into the user's chat
//   node tools/team-office/team.mjs ask <agent> "<question>" [--options "A|B|C"]   # ask the user (banner + answer buttons)
//   node tools/team-office/team.mjs inbox                      # print + mark read the user's messages for the team
//   node tools/team-office/team.mjs wait [--timeout <sec>]     # like inbox, but waits (default 110 s) until a message arrives
//   node tools/team-office/team.mjs deliver [devstudio.json]   # check the "how to open it" file so the user gets an ▶ Open button
//   node tools/team-office/team.mjs report <report.json>       # post the plain-language final report to the user
//   node tools/team-office/team.mjs lesson "<text>" [--global] # remember something for future runs (project, or all projects)
//   node tools/team-office/team.mjs lessons                    # print this project's + global lessons
//   node tools/team-office/team.mjs resume                     # print active / ready / blocked work
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ROOT, DIR, STATE_FILE, AGENTS, AGENT_STATES, PHASES,
  emptyState, withLock, readState, writeState, updateState, updateChat, readChat, event, setAgent, summary,
} from "./lib.mjs";
import { readManifest, validateReport, MANIFEST } from "./manifest.mjs";
import { unsafeReason } from "./guard.mjs";

const GLOBAL_LESSONS = path.join(ROOT, ".claude", "playbooks", "lessons-global.md");

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

// `--name value` options, removed from the positional args
function takeOption(list, name) {
  const i = list.indexOf(name);
  if (i === -1) return undefined;
  const v = list[i + 1];
  list.splice(i, 2);
  return v;
}

// Mark the user's unread messages read and print them; the pending question counts as answered.
function readInbox() {
  const unread = updateChat((c) => {
    const u = c.inbox.filter((m) => !m.read);
    u.forEach((m) => (m.read = true));
    return u;
  });
  if (!unread.length) return false;
  updateState((s) => {
    // time spent waiting for the user doesn't count towards how long the work took (estimates)
    if (s.ask) s.askWaitMs = (s.askWaitMs || 0) + Math.max(0, (s.ask.answered || Date.now()) - s.ask.t);
    s.ask = null;
  });
  for (const m of unread) console.log(`[${new Date(m.t).toLocaleTimeString()}] ${m.text}`);
  return true;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

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
          // the same task in words a non-developer understands ("Remember who's coming")
          ...(typeof t.plain === "string" && t.plain.trim() ? { plain: t.plain.trim().slice(0, 80) } : {}),
          source: t.source || "",
          depends_on: t.depends_on || [],
          verify: t.verify || [],
          owner: t.owner || "",
          status: prev.get(t.id)?.status || "pending",
          reason: prev.get(t.id)?.reason || "",
        }))
        .sort((a, b) => a.order - b.order);
      s.tasksLoadedAt ||= Date.now();
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
        // verify commands run here, outside Claude Code's permission rules — they may only check, never change things
        const why = unsafeReason(c);
        if (why) {
          updateState((s) => setTask(s, id, "blocked", `verify command refused (${why}): ${c}`));
          fail(`${id} blocked: refused to run "${c}" — it ${why}. Verify commands must only check things (tests, type-check, lint, curl).`);
        }
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
  case "ask": {
    // A question the user must answer (plan approval, open questions). Shown as a banner with quick-reply buttons;
    // cleared when the team reads the answer from the inbox.
    const rest = [...args];
    const optArg = takeOption(rest, "--options");
    const [agent, question] = rest;
    if (!AGENTS.includes(agent)) fail(`agent must be one of ${AGENTS.join(", ")}`);
    if (!question) fail('usage: ask <agent> "<question>" [--options "A|B|C"]');
    const options = optArg ? [...new Set(optArg.split("|").map((o) => o.trim().slice(0, 80)).filter(Boolean))].slice(0, 6) : [];
    if (optArg && options.length < 2) fail("--options needs at least two choices, separated by |");
    updateChat((c) => c.messages.push({ id: crypto.randomUUID(), t: Date.now(), from: agent, text: question, ask: true, ...(options.length ? { options } : {}) }));
    updateState((s) => {
      s.ask = { agent, text: question, t: Date.now(), ...(options.length ? { options } : {}) };
      event(s, { type: "log", agent, msg: `❓ ${question}` });
    });
    console.log("Question posted. Poll `inbox` for the answer.");
    break;
  }
  case "inbox": {
    if (!readInbox()) console.log("Inbox empty — no new instructions from the user.");
    break;
  }
  case "wait": {
    // Block (cheaply, in this process) until the user writes, instead of polling with the model.
    const rest = [...args];
    const timeout = Math.min(590, Math.max(1, Number(takeOption(rest, "--timeout") ?? 110) || 110));
    const end = Date.now() + timeout * 1000;
    for (;;) {
      if (readChat().inbox.some((m) => !m.read) && readInbox()) break;
      if (Date.now() >= end) {
        console.log(`No answer yet (waited ${timeout} s).`);
        break;
      }
      sleep(1000);
    }
    break;
  }
  case "deliver": {
    const file = path.resolve(args[0] || MANIFEST);
    const dir = path.dirname(file);
    if (path.basename(file) !== MANIFEST) fail(`The file must be called ${MANIFEST}, in the project folder.`);
    const { manifest, problems } = readManifest(dir);
    for (const p of problems) console.log(`✖ ${p}`);
    if (!manifest) fail(`${MANIFEST} can't be used yet — fix the problems above and run deliver again.`);
    updateState((s) => {
      s.delivered = { t: Date.now(), name: manifest.name, kind: manifest.kind };
      event(s, { type: "log", agent: "", msg: `📦 Ready to open: ${manifest.name} (${manifest.kind})` });
    });
    console.log(`✓ ${MANIFEST} OK — the user gets an ▶ Open button for "${manifest.name}" (${manifest.kind}).${problems.length ? " (Fix the notes above too.)" : ""}`);
    break;
  }
  case "report": {
    const [file] = args;
    if (!file) fail("usage: report <report.json>");
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
    } catch (e) {
      fail(`Couldn't read ${file}: ${e.message}`);
    }
    const { report, problems } = validateReport(raw);
    if (!report) fail(problems.map((p) => `✖ ${p}`).join("\n"));
    const t = Date.now();
    updateChat((c) => c.messages.push({ id: crypto.randomUUID(), t, from: "manager", text: report.summary, report }));
    updateState((s) => {
      s.report = { ...report, t };
      event(s, { type: "log", agent: "manager", msg: `📋 Final report: ${report.summary}` });
    });
    console.log("✓ Report posted to the user.");
    break;
  }
  case "lesson": {
    const global = args.includes("--global");
    const text = args.filter((a) => a !== "--global").join(" ").trim();
    if (!text) fail('usage: lesson "<one specific, actionable line>" [--global]');
    const file = global ? GLOBAL_LESSONS : path.join(process.cwd(), ".claude", "lessons.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, global ? "# Lessons for every project\n\n" : "# Lessons learned in this project\n\nRead by the architect at the start of every team run. One line each; newest last.\n\n");
    fs.appendFileSync(file, `- ${new Date().toISOString().slice(0, 10)}: ${text.replace(/\s+/g, " ")}\n`);
    updateState((s) => event(s, { type: "log", agent: "", msg: `📝 Lesson${global ? " (global)" : ""}: ${text}` }));
    console.log(`Recorded in ${file}`);
    break;
  }
  case "lessons": {
    const show = (label, file) => {
      if (!fs.existsSync(file)) return console.log(`${label}: none yet`);
      const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith("- "));
      console.log(`${label} (${lines.length}):\n${lines.slice(-40).join("\n") || "  none yet"}`);
    };
    show("This project's lessons", path.join(process.cwd(), ".claude", "lessons.md"));
    show("Global lessons", GLOBAL_LESSONS);
    break;
  }
  case "resume": {
    console.log(summary(readState()));
    break;
  }
  default:
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 21).join("\n").replace(/^\/\/ ?/gm, ""));
}
