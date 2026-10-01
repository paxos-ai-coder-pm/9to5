#!/usr/bin/env node
// A stand-in for the `claude` CLI in integration tests. Scripted by the JSON file in $FAKE_CONTROL:
//   { "loggedIn": true,
//     "manager": ["reply 1", "reply 2", …],     manager replies in order (then the last one repeats)
//     "lead": "finish" | "ask" | "long" | "fail" | "quit" | "early",   what the team lead does
//     "onResume": "finish" | "ask" | …  }         what it does when resumed (--resume)
// Every call is logged to $FAKE_LOG as one JSON line: { args, cwd, role, resumed, prompt }.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

const args = process.argv.slice(2);
const control = (() => {
  try {
    return JSON.parse(fs.readFileSync(process.env.FAKE_CONTROL, "utf8"));
  } catch {
    return {};
  }
})();
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const log = (entry) => process.env.FAKE_LOG && fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(entry) + "\n");

if (args[0] === "--version") {
  console.log("9.9.9 (Claude Code)");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  console.log(JSON.stringify({ loggedIn: control.loggedIn ?? true, authMethod: "oauth_token" }));
  process.exit(control.loggedIn === false ? 1 : 0);
}

let prompt = "";
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", main);

function main() {
  const resumed = args.includes("--resume");
  const role = args.includes("--agent") ? args[args.indexOf("--agent") + 1] : "lead";
  log({ args, cwd: process.cwd(), role, resumed, prompt: prompt.slice(0, 4000) });
  const session = resumed ? args[args.indexOf("--resume") + 1] : `sess-${role}-${Date.now()}`;
  out({ type: "system", subtype: "init", session_id: session, model: "claude-fake-1" });
  if (role === "manager") return manager(session);
  lead(resumed ? control.onResume || "finish" : control.lead || "finish", session);
}

function manager(session) {
  const replies = control.manager?.length ? control.manager : ["Hi! What would you like to build?"];
  const counter = `${process.env.FAKE_CONTROL}.manager-count`;
  const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) : 0;
  fs.writeFileSync(counter, String(n + 1));
  const text = replies[Math.min(n, replies.length - 1)];
  out({ type: "stream_event", event: { type: "message_start", message: { model: "claude-fake-1" } } });
  for (const piece of text.match(/[\s\S]{1,12}/g) || []) out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: piece } } });
  out({ type: "result", subtype: "success", is_error: false, result: text, session_id: session });
}

// the team lead, through the real office CLI ($TEAM_CLI), in the project folder
const T = (...a) => execFileSync(process.execPath, [process.env.TEAM_CLI, ...a], { encoding: "utf8" });
function lead(mode, session) {
  const done = (result, code = 0, isError = false) => {
    out({ type: "result", subtype: isError ? "error" : "success", is_error: isError, result, session_id: session });
    process.exit(code);
  };
  if (mode === "quit") return done("I couldn't figure out what to do.");
  T("init", "Fake run");
  if (mode === "long") {
    T("phase", "build");
    T("agent", "dev-1", "working", "Building the page");
    spawn("sleep", ["300"], { stdio: "ignore" }); // like a dev server a tester started
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === "fail") {
    T("phase", "build");
    return done("Something broke badly.", 1, true);
  }
  if (mode === "ask") {
    T("phase", "plan");
    T("ask", "architect", "Plan ready: 2 tasks. Approve to start building?");
    T("say", "manager", "Pausing — I'll carry on as soon as you answer.");
    return done("Paused for the user's answer.");
  }
  if (mode === "askopts") {
    T("phase", "plan");
    T("ask", "architect", "Which layout do you prefer?", "--options", "Cards|List");
    return done("Paused for the user's answer.");
  }
  if (mode === "early") {
    T("phase", "build");
    return done("I stopped halfway.");
  }
  if (mode === "slow") return setTimeout(() => finish(done), 2500);
  finish(done);
}

function finish(done) {
  // finish: plan → build a static page → deliver → report → done
  fs.mkdirSync(".devstudio", { recursive: true }); // the team's working folder, like the real lead (SKILL.md)
  fs.writeFileSync(path.join(".devstudio", "graph.json"), JSON.stringify({ version: 1, tasks: [
    { id: "T1", title: "Create index.html", plain: "Make the page", owner: "dev-1", depends_on: [] },
    { id: "T2", title: "Final code review", plain: "Final check", owner: "reviewer", depends_on: ["T1"] },
  ] }));
  T("tasks", path.join(".devstudio", "graph.json"));
  T("phase", "build");
  const n = fs.existsSync("index.html") ? Number((fs.readFileSync("index.html", "utf8").match(/v(\d+)/) || [0, 0])[1]) + 1 : 1;
  fs.writeFileSync("index.html", `<!doctype html><title>Fake app</title><h1>Hello from the team v${n}</h1>`);
  T("task", "T1", "done");
  fs.writeFileSync("devstudio.json", JSON.stringify({ name: "Fake App", kind: "static", howTo: ["Click ▶ Open", "Your page opens in the browser"] }));
  T("deliver");
  fs.writeFileSync(path.join(".devstudio", "report.json"), JSON.stringify({ summary: "Your page is ready.", got: ["A page that says hello"], howToOpen: ["Click ▶ Open"], notYet: ["No styling yet"], next: ["Add colors"] }));
  T("report", path.join(".devstudio", "report.json"));
  T("task", "T2", "done");
  T("phase", "done");
  done("All done — built the page.");
}
