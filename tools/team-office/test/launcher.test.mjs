// The launcher (tools/team-office/launch.mjs, behind bin/devstudio and bin\devstudio.cmd): start, replacing an office
// that's out of date or from an older version, stop, status, and update through git. Each test runs on a free port.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { makeStudio, until, sleep } from "./helpers.mjs";

const studios = [];
const fakes = [];
after(() => {
  for (const f of fakes) f.kill();
  for (const t of studios) {
    t.launch("stop");
    t.s.cleanup();
  }
});

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
// a process that exited but wasn't reaped (no init in some containers) still answers kill(pid, 0): that's gone too
const alive = (pid) => {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return !/^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return true;
  }
};

async function studio() {
  const s = makeStudio();
  const port = await freePort();
  const env = { ...process.env, DEVSTUDIO_PORT: String(port), DEVSTUDIO_NO_BROWSER: "1", DEVSTUDIO_PROJECTS: s.projects, CLAUDE_BIN: path.join(s.tmp, "no-claude"), GH_BIN: path.join(s.tmp, "no-gh") };
  const launch = (...args) => {
    const r = spawnSync(process.execPath, [path.join(s.office, "launch.mjs"), ...args], { env, encoding: "utf8", timeout: 60000 });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const ping = async () => {
    try {
      return await (await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(2000) })).json();
    } catch {
      return null;
    }
  };
  const t = { s, port, launch, ping };
  studios.push(t);
  return t;
}

// a stand-in program on the port: `state` answers /api/state (an older 9to5), `ping` answers /api/ping
async function fakeOn(port, { state, ping } = {}) {
  const code = `
    const [port, state, ping] = process.argv.slice(1);
    require("http").createServer((req, res) => {
      const body = req.url === "/api/state" && state !== "-" ? state : req.url === "/api/ping" && ping !== "-" ? ping.replace("PID", process.pid) : null;
      res.writeHead(body ? 200 : 404, { "content-type": "application/json" }).end(body || "not found");
    }).listen(Number(port), "127.0.0.1");`;
  const child = spawn(process.execPath, ["-e", code, String(port), state ? JSON.stringify(state) : "-", ping ? JSON.stringify(ping) : "-"], { stdio: "ignore" });
  fakes.push(child);
  await until(
    () =>
      new Promise((resolve) => {
        const sock = net.connect({ host: "127.0.0.1", port }, () => (sock.destroy(), resolve(true)));
        sock.on("error", () => resolve(false));
      }),
    10000,
    "fake program listening",
  );
  return child;
}

test("start: the office starts in the background and answers; starting again doesn't restart it", async () => {
  const t = await studio();
  const r = t.launch("start");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /9to5 is ready at http:\/\/localhost:\d+/);
  const first = await t.ping();
  assert.equal(first.app, "devstudio");
  assert.match(t.launch("status").out, /9to5 is running/);
  assert.equal(t.launch("start").code, 0);
  assert.equal((await t.ping()).pid, first.pid, "same office");
});

test("an office started before an update is restarted with the new code", async () => {
  const t = await studio();
  assert.equal(t.launch("start").code, 0);
  const before = await t.ping();
  fs.appendFileSync(path.join(t.s.office, "public", "style.css"), "\n/* a later version */\n");
  assert.match(t.launch("status").out, /started before the last update/);
  const r = t.launch("start");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /restarting it with the new version/);
  const now = await t.ping();
  assert.notEqual(now.pid, before.pid);
  assert.notEqual(now.version, before.version);
  await until(() => !alive(before.pid), 5000, "the old office is gone");
});

test("an out-of-date office in the middle of a run is left alone", async () => {
  const t = await studio();
  const fake = await fakeOn(t.port, { ping: { app: "devstudio", pid: "PID", version: "old", busy: true } });
  const r = t.launch("start");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /team is in the middle of something/);
  await sleep(300);
  assert.equal(fake.exitCode, null, "still running");
});

test("an older 9to5 (from before the launcher could ping it) is stopped and replaced", async () => {
  const t = await studio();
  const old = await fakeOn(t.port, { state: { configuredModels: {}, run: null } });
  assert.match(t.launch("status").out, /An older version of 9to5 is running/);
  const r = t.launch("start");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Stopped the older version/);
  await until(() => old.exitCode !== null || old.signalCode !== null, 5000, "old office stopped");
  assert.equal((await t.ping()).app, "devstudio");
});

test("an older 9to5 that's running a team is left alone", async () => {
  const t = await studio();
  const old = await fakeOn(t.port, { state: { configuredModels: {}, run: { status: "running" } } });
  const r = t.launch("start");
  assert.match(r.out, /in the middle of something/);
  await sleep(300);
  assert.equal(old.exitCode, null);
});

test("another program on the port: a clear message, and it isn't touched", async () => {
  const t = await studio();
  const other = await fakeOn(t.port);
  const r = t.launch("start");
  assert.equal(r.code, 1);
  assert.match(r.out, /Another program is using port \d+/);
  assert.match(r.out, /DEVSTUDIO_PORT=4401/);
  assert.match(t.launch("stop").out, /not running/);
  await sleep(300);
  assert.equal(other.exitCode, null, "not killed");
});

test("stop stops the office", async () => {
  const t = await studio();
  t.launch("start");
  const { pid } = await t.ping();
  assert.match(t.launch("stop").out, /9to5 stopped/);
  assert.equal(await t.ping(), null);
  await until(() => !alive(pid), 5000, "office process gone");
  assert.match(t.launch("status").out, /not running/);
});

const git = (cwd, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

test("update: gets the latest version through git and restarts the office with it", async () => {
  const t = await studio();
  git(t.s.root, "init");
  git(t.s.root, "add", "-A");
  git(t.s.root, "commit", "-qm", "v1");
  const origin = path.join(t.s.tmp, "origin.git");
  git(t.s.tmp, "clone", "-q", "--bare", t.s.root, origin);
  git(t.s.root, "remote", "add", "origin", origin);
  // someone publishes a newer version
  const other = path.join(t.s.tmp, "other");
  git(t.s.tmp, "clone", "-q", origin, other);
  fs.appendFileSync(path.join(other, "tools", "team-office", "public", "style.css"), "\n/* v2 */\n");
  git(other, "commit", "-qam", "v2: a newer look");
  git(other, "push", "-q", "origin", "main");

  assert.equal(t.launch("start").code, 0);
  const before = await t.ping();
  const r = t.launch("update");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Updated to the latest version: \w+ v2: a newer look/);
  assert.match(r.out, /restarting it with the new version/);
  const now = await t.ping();
  assert.notEqual(now.version, before.version);
  assert.match(fs.readFileSync(path.join(t.s.office, "public", "style.css"), "utf8"), /v2/);
  assert.match(t.launch("update").out, /Already up to date/);

  // the studio's own files changed on this computer: nothing is touched
  fs.appendFileSync(path.join(t.s.office, "public", "style.css"), "\n/* my tweak */\n");
  const blocked = t.launch("update");
  assert.equal(blocked.code, 1);
  assert.match(blocked.out, /were changed on this computer, so nothing was updated/);
  assert.match(fs.readFileSync(path.join(t.s.office, "public", "style.css"), "utf8"), /my tweak/, "the change is kept");
});

test("update on a copy that wasn't made with git explains what to do", async () => {
  const t = await studio();
  // makeStudio copies the files without git; make sure no parent folder is a repository either
  const r = spawnSync(process.execPath, [path.join(t.s.office, "launch.mjs"), "update"], { env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(t.s.root), DEVSTUDIO_PORT: String(t.port), DEVSTUDIO_NO_BROWSER: "1" }, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /wasn't downloaded with git/);
});
