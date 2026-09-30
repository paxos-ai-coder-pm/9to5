// Settings, project folders & seeding, and opening apps — each test on its own temporary studio copy.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { makeStudio, until, FAKE_OPENER } from "./helpers.mjs";

let s, settings, projects, apps, lib;
before(async () => {
  s = makeStudio();
  process.env.DEVSTUDIO_PROJECTS = s.projects;
  process.env.DEVSTUDIO_OPENER = FAKE_OPENER;
  process.env.FAKE_LOG = path.join(s.tmp, "log");
  settings = await s.import("settings.mjs");
  projects = await s.import("projects.mjs");
  apps = await s.import("apps.mjs");
  lib = await s.import("lib.mjs");
});
after(() => {
  apps?.stopAllApps();
  s?.cleanup();
});

const get = (url, headers = {}) =>
  new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });

// ---------- settings ----------
test("settings: defaults, validation and the projects-folder override", () => {
  assert.equal(settings.readSettings().lightTeam, false);
  assert.equal(settings.projectsRoot(), path.resolve(s.projects));
  assert.throws(() => settings.updateSettings({ studioName: "" }), /1–40/);
  assert.throws(() => settings.updateSettings({ studioName: "<script>" }), /1–40/);
  assert.throws(() => settings.updateSettings({ projectsDir: "relative/dir" }), /full folder path/);
  assert.throws(() => settings.updateSettings({ projectsDir: s.root }), /inside the Dev Studio/);
  const next = settings.updateSettings({ studioName: "  Priya's   Studio ", lightTeam: 1 });
  assert.equal(next.studioName, "Priya's Studio");
  assert.equal(next.lightTeam, true);
  const custom = path.join(s.tmp, "elsewhere");
  assert.equal(settings.updateSettings({ projectsDir: custom }).projectsDir, custom);
  assert.ok(fs.existsSync(custom), "folder is created");
  settings.updateSettings({ projectsDir: "", lightTeam: false });
});

// ---------- resolving project names ----------
test("resolveProject: new names go to the projects folder; the studio itself only by '.'", () => {
  const p = projects.resolveProject("family-budget");
  assert.equal(p.dir, path.join(s.projects, "family-budget"));
  assert.equal(p.isNew, true);
  assert.equal(p.foreign, false);
  assert.equal(projects.resolveProject(".").dir, s.root);
  assert.equal(projects.resolveProject("merage-hub").dir, path.join(s.projects, "merage-hub"), "no more hidden aliases");
  assert.throws(() => projects.resolveProject("../etc"), /valid project folder name/);
  assert.throws(() => projects.resolveProject("Has Spaces"), /valid project folder name/);
});

test("resolveProject: an existing folder the studio didn't make is flagged", () => {
  const dir = path.join(s.projects, "photos");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "holiday.jpg"), "x");
  const p = projects.resolveProject("photos");
  assert.equal(p.isNew, false);
  assert.equal(p.foreign, true);
});

test("resolveProject: projects from the run history are found by name wherever they live", () => {
  const elsewhere = path.join(s.tmp, "old-place", "shop-site");
  fs.mkdirSync(elsewhere, { recursive: true });
  fs.writeFileSync(path.join(elsewhere, "index.html"), "x");
  lib.writeHistory([{ id: "h1", project: "shop-site", dir: elsewhere, status: "finished", startedAt: 1, endedAt: 2 }]);
  const p = projects.resolveProject("shop-site");
  assert.equal(p.dir, elsewhere);
  assert.equal(p.foreign, false);
  lib.writeHistory([]);
});

// ---------- seeding ----------
test("prepareProject: seeds the team, respects the project's own files, refreshes its own", () => {
  const p = projects.resolveProject("seed-test");
  fs.mkdirSync(path.join(p.dir, ".claude", "agents"), { recursive: true });
  // the user's own architect agent must survive
  fs.writeFileSync(path.join(p.dir, ".claude", "agents", "architect.md"), "my own architect");
  // a file seeded by an older studio version (no seal, but it carries the office CLI) is refreshed
  fs.writeFileSync(path.join(p.dir, ".claude", "agents", "dev-1.md"), 'old: node "/x/tools/team-office/team.mjs" task');
  const r = projects.prepareProject(p, { lightTeam: true });
  assert.deepEqual(r.skipped, [".claude/agents/architect.md"]);
  assert.equal(fs.readFileSync(path.join(p.dir, ".claude", "agents", "architect.md"), "utf8"), "my own architect");
  const dev1 = fs.readFileSync(path.join(p.dir, ".claude", "agents", "dev-1.md"), "utf8");
  assert.ok(dev1.includes(projects.SEAL), "seeded files are sealed");
  assert.ok(dev1.includes(projects.T_CMD), "the office CLI path is absolute");
  const reviewer = fs.readFileSync(path.join(p.dir, ".claude", "agents", "reviewer.md"), "utf8");
  assert.match(reviewer, /^model: sonnet$/m, "light team runs the reviewer on Sonnet");
  assert.ok(fs.existsSync(path.join(p.dir, ".claude", "skills", "team", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(p.dir, ".claude", "playbooks", "_core.md")));
  assert.ok(!fs.existsSync(path.join(p.dir, ".claude", "agents", "manager.md")), "the manager stays in the studio");
  assert.match(fs.readFileSync(path.join(p.dir, ".gitignore"), "utf8"), /\.claude\/team\//);
  assert.ok(fs.existsSync(path.join(p.dir, projects.MARKER)));
  execFileSync("git", ["-C", p.dir, "rev-parse", "--git-dir"]); // git init happened

  // a second run (normal team) refreshes sealed files, and still leaves the user's file alone
  const r2 = projects.prepareProject(p, { lightTeam: false });
  assert.deepEqual(r2.skipped, [".claude/agents/architect.md"]);
  assert.match(fs.readFileSync(path.join(p.dir, ".claude", "agents", "reviewer.md"), "utf8"), /^model: opus$/m);
  // .gitignore isn't appended twice
  assert.equal(fs.readFileSync(path.join(p.dir, ".gitignore"), "utf8").match(/\.claude\/team\//g).length, 1);
});

// ---------- opening apps ----------
function makeProject(name, files) {
  const dir = path.join(s.projects, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), typeof c === "string" ? c : JSON.stringify(c));
  }
  return { name, dir };
}

test("apps: a static app is served on its own stable port, without dotfiles or foreign hosts", async () => {
  const p = makeProject("todo-static", {
    "index.html": "<h1>My todos</h1>",
    "app.js": "console.log('hi')",
    ".env": "SECRET=1",
    "devstudio.json": { name: "Todos", kind: "static", howTo: ["Click Open"] },
  });
  const st = await apps.openApp(p);
  assert.equal(st.status, "running");
  assert.match(st.url, /^http:\/\/localhost:45\d\d\/$/);
  assert.equal((await get(st.url)).body, "<h1>My todos</h1>");
  assert.equal((await get(st.url + "app.js")).status, 200);
  assert.equal((await get(st.url + ".env")).status, 404, "dotfiles are never served");
  assert.equal((await get(st.url + "..%2f..%2fetc/passwd")).status, 404);
  assert.equal((await get(st.url, { host: "evil.example" })).status, 403);
  const port = st.port;
  assert.equal(apps.stopApp(p.dir), true);
  const again = await apps.openApp(p);
  assert.equal(again.port, port, "same port every time, so browser-saved data survives");
  apps.stopApp(p.dir);
});

test("apps: a project without devstudio.json but with index.html still opens; one with neither explains", async () => {
  const legacy = makeProject("legacy-page", { "index.html": "old" });
  assert.equal((await apps.openApp(legacy)).status, "running");
  apps.stopApp(legacy.dir);
  const bare = makeProject("bare-thing", { "main.py": "print(1)" });
  await assert.rejects(apps.openApp(bare), /didn't leave instructions/);
});

test("apps: a web app is started with $PORT and reported running once it answers", async () => {
  const server = `require("http").createServer((q, r) => r.end("budget:" + q.url)).listen(process.env.PORT, "127.0.0.1", () => console.log("listening"));`;
  const p = makeProject("web-budget", {
    "server.js": server,
    "devstudio.json": { name: "Budget", kind: "web", start: `"${process.execPath}" server.js`, path: "/home", howTo: ["Click Open"] },
  });
  const first = await apps.openApp(p);
  assert.equal(first.status, "starting");
  const st = await until(() => (apps.appStatus(p.dir).status === "running" ? apps.appStatus(p.dir) : null), 15000, "web app running");
  assert.match(st.url, /\/home$/);
  assert.equal((await get(st.url)).body, "budget:/home");
  assert.match(st.log, /listening/);
  apps.stopApp(p.dir);
  await until(async () => !(await get(st.url).catch(() => null)), 5000, "web app stopped");
});

test("apps: install runs once before the first start", async () => {
  const p = makeProject("needs-install", {
    "server.js": `require("http").createServer((q, r) => r.end("ok")).listen(process.env.PORT, "127.0.0.1");`,
    "devstudio.json": { name: "N", kind: "web", start: `"${process.execPath}" server.js`, install: `"${process.execPath}" -e "require('fs').mkdirSync('node_modules')"`, howTo: ["Open"] },
  });
  await apps.openApp(p);
  await until(() => apps.appStatus(p.dir).status === "running", 15000, "running after install");
  assert.ok(fs.existsSync(path.join(p.dir, "node_modules")));
  apps.stopApp(p.dir);
});

test("apps: a web app that crashes is reported with its output", async () => {
  const p = makeProject("crashy", { "devstudio.json": { name: "C", kind: "web", start: `"${process.execPath}" -e "console.error('boom: missing module'); process.exit(3)"`, howTo: ["Open"] } });
  await apps.openApp(p);
  const st = await until(() => (apps.appStatus(p.dir).status === "failed" ? apps.appStatus(p.dir) : null), 10000, "failed");
  assert.match(st.error, /closed before it was ready/);
  assert.match(st.log, /boom: missing module/);
});

test("apps: a script runs once and its output is kept; extensions just show steps", async () => {
  const p = makeProject("renamer", { "devstudio.json": { name: "Renamer", kind: "script", start: `"${process.execPath}" -e "console.log('Renamed 3 photos (dry run)')"`, howTo: ["Click Run"] } });
  await apps.openApp(p);
  const st = await until(() => (apps.appStatus(p.dir).status === "exited" ? apps.appStatus(p.dir) : null), 10000, "script exited");
  assert.equal(st.exitCode, 0);
  assert.match(st.log, /Renamed 3 photos/);
  const ext = makeProject("my-extension", { "devstudio.json": { name: "Ext", kind: "extension", howTo: ["Open chrome://extensions", "Load unpacked"] } });
  assert.equal((await apps.openApp(ext)).status, "manual");
});

test("apps: show files hands the folder to the system file manager", async () => {
  const p = makeProject("show-me", { "index.html": "x" });
  assert.deepEqual(await apps.showFiles(p.dir), { ok: true });
  await until(() => fs.existsSync(process.env.FAKE_LOG + ".opener") && fs.readFileSync(process.env.FAKE_LOG + ".opener", "utf8").includes(p.dir), 5000, "opener called");
});

const chrome = ["/opt/pw-browsers/chromium", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((c) => fs.existsSync(c));
test("apps: a screenshot of the result is taken with a headless browser", { skip: !chrome && "no Chrome/Chromium installed" }, async () => {
  process.env.DEVSTUDIO_CHROME = chrome;
  const p = makeProject("shot-me", { "index.html": "<body style='background:#3987e5'><h1>Hello</h1></body>", "devstudio.json": { name: "Shot", kind: "static", howTo: ["Open"] } });
  const file = await apps.captureScreenshot(p);
  assert.ok(file && fs.existsSync(file), "screenshot written");
  assert.equal(fs.readFileSync(file).subarray(1, 4).toString(), "PNG");
  assert.equal(apps.appStatus(p.dir).status, "stopped", "an app started just for the picture is stopped again");
  delete process.env.DEVSTUDIO_CHROME;
});
