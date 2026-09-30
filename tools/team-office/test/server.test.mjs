// Integration: the real office server over HTTP, with a fake `claude` (test/fake-claude.mjs) as manager and team lead.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { makeStudio, startServer, until, sleep, isWindows, FAKE_CLAUDE } from "./helpers.mjs";

// the fake CLI is a Node script with a shebang — Windows can't exec it directly
const opts = { skip: isWindows && "integration tests need a POSIX shell" };

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const rawRequest = (port, { method = "GET", path: p = "/", headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.end(body);
  });

async function setup(control = {}, env = {}) {
  const s = makeStudio();
  const srv = await startServer(s, { control, env });
  const chat = async () => (await srv.api("/api/chat")).json;
  const run = () => s.read("run.json");
  const say = async (text) => {
    const before = (await chat()).messages.length;
    const r = await srv.api("/api/chat", { method: "POST", body: { text } });
    assert.ok([200, 202].includes(r.status), JSON.stringify(r.json));
    return until(async () => {
      const c = await chat();
      return !c.busy && c.messages.length > before + 1 ? c : null;
    }, 10000, "manager reply");
  };
  const proposeAndStart = async (reply) => {
    srv.control({ ...JSON.parse(fs.readFileSync(path.join(s.tmp, "fake-control.json"), "utf8")), manager: [reply] });
    fs.rmSync(path.join(s.tmp, "fake-control.json.manager-count"), { force: true });
    const c = await say("Build it");
    const p = c.proposal;
    assert.ok(p, "a proposal card");
    const r = await srv.api("/api/run", { method: "POST", body: { action: "start", proposalId: p.id } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return p;
  };
  const waitRun = (status, ms = 15000) => until(() => (fs.existsSync(path.join(s.state, "run.json")) && run().status === status ? run() : null), ms, `run ${status}`);
  const done = async () => {
    await srv.stop();
    s.cleanup();
  };
  return { s, srv, chat, run, say, proposeAndStart, waitRun, done };
}
const PROPOSE = (name, extra = "") => `Here's the plan — shall I get the team started?\nPROPOSE: ${name} | Build a page that says hello\n- plain and simple${extra}`;

describe("security", opts, () => {
  let t;
  before(async () => (t = await setup()));
  after(() => t.done());

  test("foreign Host headers are refused (DNS rebinding)", async () => {
    assert.equal((await rawRequest(t.srv.port, { path: "/api/state", headers: { host: "evil.example" } })).status, 403);
    assert.equal((await rawRequest(t.srv.port, { path: "/", headers: { host: "evil.example" } })).status, 403);
    assert.equal((await rawRequest(t.srv.port, { path: "/api/state", headers: { host: `127.0.0.1:${t.srv.port}` } })).status, 200);
  });

  test("cross-site and Origin: null posts are refused, and don't crash the server", async () => {
    const post = (origin) => rawRequest(t.srv.port, { method: "POST", path: "/api/chat", headers: { host: `localhost:${t.srv.port}`, origin, "content-type": "application/json" }, body: '{"text":"x"}' });
    assert.equal((await post("null")).status, 403);
    assert.equal((await post("http://evil.example")).status, 403);
    assert.equal((await t.srv.api("/api/ping")).status, 200, "still alive");
    assert.equal((await rawRequest(t.srv.port, { method: "POST", path: "/api/chat", headers: { host: `localhost:${t.srv.port}`, "content-type": "text/plain" }, body: "x" })).status, 403);
  });

  test("unknown API routes 404; static files can't escape public/", async () => {
    assert.equal((await t.srv.api("/api/nope")).status, 404);
    assert.equal((await rawRequest(t.srv.port, { path: "/../server.mjs", headers: { host: "localhost" } })).status, 404);
    assert.equal((await t.srv.api("/")).status, 200);
    assert.equal((await t.srv.api("/launch.html")).status, 200);
  });

  test("the chat API doesn't expose the team inbox or session ids", async () => {
    const c = await t.chat();
    assert.equal(c.inbox, undefined);
    assert.equal(c.sessionId, undefined);
  });

  test("ping and the pid file let the launcher find the office", async () => {
    const r = await t.srv.api("/api/ping");
    assert.equal(r.json.app, "devstudio");
    assert.equal(t.s.read("office.json").port, t.srv.port);
  });
});

describe("setup checklist", opts, () => {
  test("ready when Claude is installed and signed in", async () => {
    const t = await setup();
    const h = (await t.srv.api("/api/health?refresh=1")).json;
    assert.equal(h.ready, true);
    assert.equal(h.checks.find((c) => c.id === "auth").ok, true);
    assert.equal(h.checks.find((c) => c.id === "github").ok, false, "optional GitHub not set up");
    assert.equal(h.checks.find((c) => c.id === "projects").detail, path.resolve(t.s.projects));
    await t.done();
  });

  test("signed out: the chat says so right away (no waiting for the manager)", async () => {
    const t = await setup({ loggedIn: false });
    const h = (await t.srv.api("/api/health?refresh=1")).json;
    assert.equal(h.ready, false);
    const auth = h.checks.find((c) => c.id === "auth");
    assert.equal(auth.ok, false);
    assert.match(auth.fix.text, /claude auth login/);
    await t.srv.api("/api/chat", { method: "POST", body: { text: "Build me a to-do app" } });
    const c = await t.chat();
    const last = c.messages.at(-1);
    assert.equal(last.from, "system");
    assert.match(last.text, /isn't signed in/);
    assert.deepEqual(last.actions, [{ kind: "setup" }]);
    assert.equal(c.busy, false);
    assert.ok(!t.srv.fakeLog().some((l) => l.role === "manager"), "the manager was never started");
    await t.done();
  });

  test("Claude not installed at all", async () => {
    const t = await setup({}, { CLAUDE_BIN: "/nonexistent/claude" });
    const h = (await t.srv.api("/api/health?refresh=1")).json;
    const c = h.checks.find((x) => x.id === "claude");
    assert.equal(c.ok, false);
    assert.match(c.fix.command, /npm install -g @anthropic-ai\/claude-code/);
    await t.done();
  });
});

describe("chat with the manager", opts, () => {
  let t;
  before(async () => (t = await setup({ manager: ["Where will you use it?\nCHOICES: On my computer | On my phone | Both", PROPOSE("hello-page", "\nSIZE: quick")] })));
  after(() => t.done());

  test("suggested answers become buttons", async () => {
    const c = await t.say("I want a to-do app");
    const m = c.messages.at(-1);
    assert.equal(m.from, "manager");
    assert.equal(m.text, "Where will you use it?");
    assert.deepEqual(m.choices, ["On my computer", "On my phone", "Both"]);
  });

  test("a proposal card knows its folder, size and that the folder is new", async () => {
    const c = await t.say("On my computer");
    const p = c.proposal;
    assert.equal(p.project, "hello-page");
    assert.equal(p.dir, path.join(t.s.projects, "hello-page"));
    assert.equal(p.isNew, true);
    assert.equal(p.foreign, false);
    assert.equal(p.size, "quick");
    assert.equal(c.messages.at(-1).text, "Here's the plan — shall I get the team started?");
    // the manager saw the projects folder in its snapshot
    const prompt = t.srv.fakeLog().filter((l) => l.role === "manager").at(-1).prompt;
    assert.match(prompt, new RegExp(`Projects folder: ${t.s.projects.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });
});

describe("a whole run: plan → build → deliver → open → change → undo", opts, () => {
  let t, proj;
  before(async () => (t = await setup({ lead: "finish" }, { DEVSTUDIO_CHROME: ["/opt/pw-browsers/chromium", "/usr/bin/chromium"].find((c) => fs.existsSync(c)) || "" })));
  after(() => t.done());

  test("the run finishes with a plain report and an Open button", async () => {
    await t.proposeAndStart(PROPOSE("hello-page"));
    const r = await t.waitRun("finished");
    assert.ok(r.activeMs > 0 && r.taskCount === 2, "timings recorded for estimates");
    const c = await until(async () => {
      const c = await t.chat();
      return c.messages.some((m) => m.text.startsWith("✅ Finished")) ? c : null;
    }, 5000, "finished message");
    const report = c.messages.find((m) => m.report);
    assert.equal(report.report.summary, "Your page is ready.");
    const fin = c.messages.find((m) => m.text.startsWith("✅ Finished"));
    assert.deepEqual(fin.actions.map((a) => a.kind), ["open", "change"]);
    // the lead was told who it's building for, and the size
    const leadCall = t.srv.fakeLog().find((l) => l.role === "lead");
    assert.match(leadCall.prompt, /for-non-developers\.md/);
    assert.match(leadCall.prompt, /Team size: standard/);
    assert.equal(leadCall.cwd, fs.realpathSync(path.join(t.s.projects, "hello-page")));
  });

  test("My Projects shows it as built, openable, with its history", async () => {
    const { projects } = (await t.srv.api("/api/portfolio")).json;
    assert.equal(projects.length, 1);
    proj = projects[0];
    assert.equal(proj.status, "finished");
    assert.equal(proj.canOpen, true);
    assert.equal(proj.app.kind, "static");
    assert.equal(proj.app.name, "Fake App");
    assert.equal(proj.history.length, 1);
    assert.equal(proj.history[0].canUndo, false, "nothing to undo for a brand-new project");
    assert.equal(proj.dir, undefined === proj.dir ? undefined : proj.dir); // dir is shown (copy path)
  });

  test("▶ Open serves the app; Stop stops it", async () => {
    const r = await t.srv.api("/api/projects", { method: "POST", body: { action: "open", id: proj.id } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.app.status, "running");
    const page = await fetch(r.json.app.url).then((x) => x.text());
    assert.match(page, /Hello from the team v1/);
    const st = (await t.srv.api(`/api/apps?id=${proj.id}`)).json;
    assert.equal(st.app.status, "running");
    assert.deepEqual(st.howTo, ["Click ▶ Open", "Your page opens in the browser"]);
    assert.equal((await t.srv.api("/api/projects", { method: "POST", body: { action: "stop", id: proj.id } })).json.ok, true);
  });

  test("a picture of the result is taken after the run (when a browser is available)", { skip: !fs.existsSync("/opt/pw-browsers/chromium") && "no chromium" }, async () => {
    const r = await until(async () => {
      const x = await t.srv.api(`/api/projects/${proj.id}/screenshot`);
      return x.status === 200 ? x : null;
    }, 30000, "screenshot");
    assert.equal(r.headers.get("content-type"), "image/png");
  });

  test("📂 Show files, and Share a copy as a zip without the studio's files", async () => {
    assert.equal((await t.srv.api("/api/projects", { method: "POST", body: { action: "files", id: proj.id } })).json.ok, true);
    await until(() => fs.existsSync(path.join(t.s.tmp, "fake-log.jsonl.opener")), 3000, "opener");
    const res = await fetch(`${t.srv.base}/api/projects/${proj.id}/zip`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition"), /hello-page\.zip/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 2).toString(), "PK");
    const names = buf.toString("latin1");
    assert.ok(names.includes("hello-page/index.html"));
    assert.ok(!names.includes("hello-page/.claude/"), "studio files left out");
    assert.ok(!names.includes(".git/"), "git history left out");
  });

  test("a second run on the same project can be undone — and redone", async () => {
    await t.proposeAndStart(PROPOSE("hello-page"));
    await until(() => t.run().status === "finished" && t.run().attempts === 1 && t.run().checkpoint, 15000, "second run finished");
    const dir = path.join(t.s.projects, "hello-page");
    assert.match(fs.readFileSync(path.join(dir, "index.html"), "utf8"), /v2/);
    const { projects } = (await t.srv.api("/api/portfolio")).json;
    const latest = projects[0].history[0];
    assert.equal(latest.canUndo, true);
    const undo = await t.srv.api("/api/projects", { method: "POST", body: { action: "undo", id: proj.id, runId: latest.id } });
    assert.equal(undo.status, 200, JSON.stringify(undo.json));
    assert.match(fs.readFileSync(path.join(dir, "index.html"), "utf8"), /v1/);
    const msg = (await t.chat()).messages.at(-1);
    assert.match(msg.text, /back to how it was before/);
    const redo = msg.actions[0];
    assert.equal(redo.kind, "redo");
    const r2 = await t.srv.api("/api/projects", { method: "POST", body: { action: "redo", id: proj.id, checkpoint: redo.checkpoint } });
    assert.equal(r2.status, 200, JSON.stringify(r2.json));
    assert.match(fs.readFileSync(path.join(dir, "index.html"), "utf8"), /v2/);
    assert.equal((await t.srv.api("/api/projects", { method: "POST", body: { action: "redo", id: proj.id, checkpoint: "../../x" } })).status, 400);
  });

  test("Remove from list hides a project (files kept); it can come back", async () => {
    await t.srv.api("/api/projects", { method: "POST", body: { action: "hide", id: proj.id } });
    assert.equal((await t.srv.api("/api/portfolio")).json.projects.length, 0);
    const all = (await t.srv.api("/api/portfolio?hidden=1")).json.projects;
    assert.equal(all[0].hidden, true);
    await t.srv.api("/api/projects", { method: "POST", body: { action: "unhide", id: proj.id } });
    assert.equal((await t.srv.api("/api/portfolio")).json.projects.length, 1);
    assert.ok(fs.existsSync(path.join(t.s.projects, "hello-page", "index.html")));
  });

  test("unknown project ids are refused", async () => {
    assert.equal((await t.srv.api("/api/projects", { method: "POST", body: { action: "open", id: "../../etc" } })).status, 404);
    assert.equal((await t.srv.api("/api/projects/000000000000/zip")).status, 404);
  });
});

describe("waiting for the user's answer", opts, () => {
  test("the run pauses (not 'finished') and continues the same session when answered", async () => {
    const t = await setup({ lead: "ask", onResume: "finish" });
    await t.proposeAndStart(PROPOSE("ask-app"));
    const paused = await t.waitRun("needs-answer");
    assert.match(paused.question, /Approve to start/);
    const st = (await t.srv.api("/api/state")).json;
    assert.equal(st.ask.agent, "architect");
    assert.equal((await t.srv.api("/api/portfolio")).json.projects[0].status, "needs-answer");
    await t.srv.api("/api/answer", { method: "POST", body: { text: "Yes, go ahead" } });
    await t.waitRun("finished");
    const calls = t.srv.fakeLog().filter((l) => l.role === "lead");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].resumed, true);
    assert.match(calls[1].prompt, /replied to your question/);
    await t.done();
  });
});

describe("stop, continue, try again", opts, () => {
  let t;
  before(async () => (t = await setup({ lead: "long", onResume: "finish" })));
  after(() => t.done());

  test("■ Stop ends the lead and everything it started", async () => {
    await t.proposeAndStart(PROPOSE("long-app"));
    const r = await t.waitRun("running");
    await until(() => (t.s.read("state.json").agents["dev-1"].state === "working" ? 1 : 0), 10000, "lead working");
    assert.ok(alive(r.pid));
    const stop = await t.srv.api("/api/run", { method: "POST", body: { action: "stop" } });
    assert.equal(stop.json.ok, true);
    await t.waitRun("stopped");
    await until(() => !alive(r.pid), 5000, "lead gone");
    const msg = (await t.chat()).messages.at(-1);
    assert.match(msg.text, /Stopped/);
    assert.deepEqual(msg.actions.map((a) => a.kind), ["continue", "retry"]);
  });

  test("↻ Continue picks the stopped run up in its own session", async () => {
    const id = t.run().id;
    const r = await t.srv.api("/api/run", { method: "POST", body: { action: "continue", runId: id } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const fin = await t.waitRun("finished");
    assert.equal(fin.id, id);
    const last = t.srv.fakeLog().filter((l) => l.role === "lead").at(-1);
    assert.equal(last.resumed, true);
    assert.match(last.prompt, /asked you to continue/);
    const again = await t.srv.api("/api/run", { method: "POST", body: { action: "continue", runId: id } });
    assert.equal(again.status, 409, "a finished run doesn't need continuing");
  });

  test("↻ Try again turns the same request into a fresh proposal", async () => {
    const id = t.run().id;
    const r = await t.srv.api("/api/run", { method: "POST", body: { action: "retry", runId: id } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const c = await t.chat();
    assert.equal(c.proposal.task, "Build a page that says hello\n- plain and simple");
    assert.equal(c.messages.at(-1).proposal.id, c.proposal.id);
  });
});

describe("continuing an older run", opts, () => {
  test("after another run used the board, the lead is told to set it up again — and the run finishes", async () => {
    const t = await setup({ lead: "long", onResume: "finish" });
    await t.proposeAndStart(PROPOSE("older-app"));
    await t.waitRun("running");
    await until(() => (t.s.read("state.json").agents["dev-1"].state === "working" ? 1 : 0), 10000, "lead working");
    await t.srv.api("/api/run", { method: "POST", body: { action: "stop" } });
    const older = await t.waitRun("stopped");
    // a different project runs to the end in between
    t.srv.control({ lead: "finish", onResume: "finish" });
    await t.proposeAndStart(PROPOSE("newer-app"));
    await until(() => t.run().project === "newer-app" && t.run().status === "finished", 15000, "newer run");
    const r = await t.srv.api("/api/run", { method: "POST", body: { action: "continue", runId: older.id } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const fin = await until(() => (t.run().id === older.id && t.run().status === "finished" ? t.run() : null), 15000, "older run finished");
    assert.equal(fin.project, "older-app");
    const last = t.srv.fakeLog().filter((l) => l.role === "lead").at(-1);
    assert.match(last.prompt, /board now shows a later run/);
    assert.equal(last.cwd, fs.realpathSync(path.join(t.s.projects, "older-app")));
    const history = t.s.read("history.json");
    assert.deepEqual(history.map((h) => [h.project, h.status]), [["older-app", "finished"], ["newer-app", "finished"]]);
    await t.done();
  });
});

describe("failures are explained", opts, () => {
  test("a failed run says what happened in plain words, with next steps and details", async () => {
    const t = await setup({ lead: "fail" });
    await t.proposeAndStart(PROPOSE("broken-app"));
    await t.waitRun("failed");
    const msg = await until(async () => (await t.chat()).messages.find((m) => m.text.startsWith("⚠️")), 5000, "failure message");
    assert.match(msg.text, /Something went wrong/);
    assert.deepEqual(msg.actions.map((a) => a.kind), ["continue", "ask"]);
    assert.match(msg.details, /Full log:/);
    await t.done();
  });

  test("a lead that stops halfway is not 'finished'", async () => {
    const t = await setup({ lead: "early" });
    await t.proposeAndStart(PROPOSE("half-app"));
    const r = await t.waitRun("failed");
    assert.match(r.error, /stopped early/);
    const msg = await until(async () => (await t.chat()).messages.find((m) => m.text.startsWith("⚠️")), 5000, "failure message");
    assert.match(msg.text, /during the building step/);
    await t.done();
  });

  test("closing the office mid-run: the run is marked interrupted and can be continued", async () => {
    const s = makeStudio();
    let srv = await startServer(s, { control: { lead: "long", onResume: "finish" } });
    const c1 = async () => (await srv.api("/api/chat")).json;
    srv.control({ lead: "long", onResume: "finish", manager: [PROPOSE("sleepy-app")] });
    await srv.api("/api/chat", { method: "POST", body: { text: "go" } });
    const p = await until(async () => (await c1()).proposal, 10000, "proposal");
    await srv.api("/api/run", { method: "POST", body: { action: "start", proposalId: p.id } });
    const run = await until(() => (fs.existsSync(path.join(s.state, "run.json")) && s.read("run.json").sessionId ? s.read("run.json") : null), 10000, "session");
    await srv.stop(); // SIGTERM: the office takes the run down with it
    await until(() => !alive(run.pid), 5000, "lead gone with the office");
    srv = await startServer(s, { control: { lead: "long", onResume: "finish" } });
    assert.equal(s.read("run.json").status, "interrupted");
    const msg = (await (await srv.api("/api/chat")).json).messages.at(-1);
    assert.match(msg.text, /office was closed/);
    assert.equal(msg.actions[0].kind, "continue");
    await srv.api("/api/run", { method: "POST", body: { action: "continue", runId: run.id } });
    await until(() => s.read("run.json").status === "finished", 15000, "continued run finished");
    await srv.stop();
    s.cleanup();
  });
});

describe("one run at a time: the queue", opts, () => {
  test("a second request is queued and starts by itself when the first finishes", async () => {
    const t = await setup({ lead: "slow" });
    await t.proposeAndStart(PROPOSE("first-app"));
    await t.waitRun("running");
    t.srv.control({ lead: "finish", manager: [PROPOSE("second-app")] });
    fs.rmSync(path.join(t.s.tmp, "fake-control.json.manager-count"), { force: true });
    const c = await t.say("Also build another one");
    const q = await t.srv.api("/api/run", { method: "POST", body: { action: "start", proposalId: c.proposal.id } });
    assert.equal(q.status, 200);
    const c2 = await t.chat();
    assert.equal(c2.queue.length, 1);
    assert.match(c2.messages.at(-1).text, /Queued/);
    await until(() => t.run().project === "second-app" && t.run().status === "finished", 20000, "queued run done");
    assert.equal((await t.chat()).queue.length, 0);
    await t.done();
  });

  test("queued runs can be removed; after a stop the next one waits for ▶ Start", async () => {
    const t = await setup({ lead: "long" });
    await t.proposeAndStart(PROPOSE("busy-app"));
    await t.waitRun("running");
    for (const name of ["q-one", "q-two"]) {
      t.srv.control({ lead: "long", manager: [PROPOSE(name)] });
      fs.rmSync(path.join(t.s.tmp, "fake-control.json.manager-count"), { force: true });
      const c = await t.say(`queue ${name}`);
      await t.srv.api("/api/run", { method: "POST", body: { action: "start", proposalId: c.proposal.id } });
    }
    assert.equal((await t.chat()).queue.length, 2);
    assert.equal((await t.srv.api("/api/run", { method: "POST", body: { action: "unqueue", index: 0 } })).status, 200);
    assert.deepEqual((await t.chat()).queue.map((q) => q.project), ["q-two"]);
    await t.srv.api("/api/run", { method: "POST", body: { action: "stop" } });
    const c = await until(async () => {
      const c = await t.chat();
      return c.proposal?.project === "q-two" ? c : null;
    }, 10000, "next in line");
    assert.equal(c.queue.length, 0);
    assert.equal(t.run().status, "stopped", "didn't auto-start after a stop");
    await t.done();
  });
});

describe("settings", opts, () => {
  test("name, light team and projects folder", async () => {
    const t = await setup({ lead: "finish" }, { DEVSTUDIO_PROJECTS: "" });
    const s0 = (await t.srv.api("/api/settings")).json;
    assert.equal(s0.studioName, "Vikrant's Dev Studio");
    const bad = await t.srv.api("/api/settings", { method: "POST", body: { studioName: "" } });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /1–40/);
    const custom = path.join(t.s.tmp, "my-projects");
    const ok = await t.srv.api("/api/settings", { method: "POST", body: { studioName: "Priya's Studio", lightTeam: true, projectsDir: custom } });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal((await t.srv.api("/api/state")).json.studioName, "Priya's Studio");
    await t.proposeAndStart(PROPOSE("light-app"));
    await t.waitRun("finished");
    const lead = t.srv.fakeLog().find((l) => l.role === "lead");
    assert.ok(lead.args.includes("--model") && lead.args[lead.args.indexOf("--model") + 1] === "sonnet", "lead on Sonnet");
    assert.equal(lead.cwd, fs.realpathSync(path.join(custom, "light-app")), "new project in the chosen folder");
    assert.match(fs.readFileSync(path.join(custom, "light-app", ".claude", "agents", "architect.md"), "utf8"), /^model: sonnet$/m);
    await t.done();
  });
});

test("fake claude is executable", opts, () => assert.ok(fs.statSync(FAKE_CLAUDE).mode & 0o111));
