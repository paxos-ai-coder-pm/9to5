// The team CLI (`T` in the /team skill): the new commands for non-developer runs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { makeStudio, until } from "./helpers.mjs";

let s, project;
const T = (...args) => spawnSync(process.execPath, [path.join(s.office, "team.mjs"), ...args], { cwd: project, encoding: "utf8" });
const state = () => s.read("state.json");
const chat = () => s.read("chat.json");
const pushInbox = (text) => {
  const c = fs.existsSync(path.join(s.state, "chat.json")) ? chat() : { messages: [], inbox: [] };
  c.inbox.push({ id: String(Math.random()), t: Date.now(), text, read: false });
  s.write("chat.json", c);
};

before(() => {
  s = makeStudio();
  project = path.join(s.projects, "cli-app");
  fs.mkdirSync(project, { recursive: true });
  assert.equal(T("init", "CLI test").status, 0);
});
after(() => s.cleanup());

test("tasks keep a plain title for the user and remember when the plan was loaded", () => {
  fs.writeFileSync(path.join(project, "graph.json"), JSON.stringify({ version: 1, tasks: [
    { id: "T1", title: "Add Rsvp model to Prisma schema", plain: "Remember who's coming", owner: "dev-1", depends_on: [], verify: ["node --version"] },
    { id: "T2", title: "Cleanup", owner: "dev-2", depends_on: ["T1"], verify: ["rm -rf build"] },
  ] }));
  assert.equal(T("tasks", "graph.json").status, 0);
  const st = state();
  assert.equal(st.tasks[0].plain, "Remember who's coming");
  assert.equal(st.tasks[1].plain, undefined);
  assert.ok(st.tasksLoadedAt > 0);
});

test("verify runs checks, but refuses commands that change or delete things", () => {
  assert.equal(T("task", "T1", "verify").status, 0);
  assert.equal(state().tasks[0].status, "done");
  const r = T("task", "T2", "verify");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refused to run "rm -rf build"/);
  assert.equal(state().tasks[1].status, "blocked");
  assert.match(state().tasks[1].reason, /deletes files/);
});

test("ask --options gives the user answer buttons", () => {
  assert.equal(T("ask", "architect", "Which layout?", "--options", "Cards | List | Cards").status, 0);
  assert.deepEqual(state().ask.options, ["Cards", "List"]);
  const m = chat().messages.at(-1);
  assert.equal(m.ask, true);
  assert.deepEqual(m.options, ["Cards", "List"]);
  assert.equal(T("ask", "architect", "Only one?", "--options", "Yes").status, 1);
});

test("wait returns as soon as the user answers, and counts the waiting time", async () => {
  const child = spawn(process.execPath, [path.join(s.office, "team.mjs"), "wait", "--timeout", "20"], { cwd: project });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const started = Date.now();
  await new Promise((r) => setTimeout(r, 1200));
  pushInbox("Cards please");
  const code = await new Promise((r) => child.on("close", r));
  assert.equal(code, 0);
  assert.match(out, /Cards please/);
  assert.ok(Date.now() - started < 8000, "didn't wait for the timeout");
  assert.equal(state().ask, null, "the question is answered");
  assert.ok(state().askWaitMs > 0);
  assert.ok(chat().inbox.every((m) => m.read));
});

test("wait gives up quietly after its timeout", () => {
  const r = T("wait", "--timeout", "1");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /No answer yet/);
});

test("deliver checks devstudio.json and records that the project can be opened", () => {
  let r = T("deliver");
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /No devstudio\.json yet/);
  fs.writeFileSync(path.join(project, "devstudio.json"), JSON.stringify({ name: "CLI App", kind: "web", howTo: ["Click Open"] }));
  r = T("deliver");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /needs a "start" command/);
  fs.writeFileSync(path.join(project, "devstudio.json"), JSON.stringify({ name: "CLI App", kind: "web", start: "npm start", howTo: ["Click Open"] }));
  r = T("deliver");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Open button/);
  assert.equal(state().delivered.name, "CLI App");
});

test("report posts a plain-language summary card into the chat", () => {
  fs.writeFileSync(path.join(project, "bad.json"), JSON.stringify({ summary: "" }));
  assert.equal(T("report", "bad.json").status, 1);
  const report = { summary: "Your app is ready.", got: ["A page to track spending"], howToOpen: ["Click ▶ Open"], notYet: ["No charts yet"], next: ["Add charts"] };
  fs.writeFileSync(path.join(project, "report.json"), JSON.stringify(report));
  assert.equal(T("report", "report.json").status, 0);
  const m = chat().messages.at(-1);
  assert.equal(m.from, "manager");
  assert.deepEqual(m.report, report);
  assert.equal(state().report.summary, "Your app is ready.");
});
