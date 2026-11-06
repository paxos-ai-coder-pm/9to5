#!/usr/bin/env node
// 9to5 launcher — bin/devstudio (macOS/Linux), bin\devstudio.cmd (Windows) and the double-click files run this.
//   start (default)  start the office and open it in the browser. An office started before an update is restarted
//                    with the new code (unless the team is in the middle of a run); an older 9to5 that still
//                    holds the port is stopped and replaced.
//   update           get the latest version from GitHub (git), then start / restart the office
//   stop             stop the office (and any run it is doing)
//   status           is it running, and is it the current version?
// Environment: DEVSTUDIO_PORT (default 4400), DEVSTUDIO_NO_BROWSER=1 (don't open a browser).
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { codeVersion } from "./version.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUDIO = path.resolve(HERE, "..", "..");
const SERVER = path.join(HERE, "server.mjs");
const PORT = Number(process.env.DEVSTUDIO_PORT || 4400);
const URL_ = `http://localhost:${PORT}`;
const LOG = path.join(STUDIO, ".claude", "team", "office.log");
const win = process.platform === "win32";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (text) => console.log(text);
const fail = (text) => {
  console.error(text);
  process.exitCode = 1;
};

// ---------- what is on the port? ----------
async function getJson(route) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}${route}`, { signal: AbortSignal.timeout(2500) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
/** The current kind of office answers /api/ping. */
const ping = async () => {
  const j = await getJson("/api/ping");
  return j?.app === "devstudio" ? j : null;
};
/** 9to5 versions from before /api/ping still answer /api/state the old way. */
const olderOffice = async () => {
  const s = await getJson("/api/state");
  return s && typeof s === "object" && "configuredModels" in s ? s : null;
};
const portBusy = () =>
  new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port: PORT });
    sock.setTimeout(2000, () => (sock.destroy(), resolve(false)));
    sock.once("connect", () => (sock.destroy(), resolve(true)));
    sock.once("error", () => resolve(false));
  });
const run = (bin, args) => spawnSync(bin, args, { encoding: "utf8", windowsHide: true });

/** The process listening on the port (for an older office, which doesn't say its pid). */
function listenerPid() {
  if (win) {
    for (const line of (run("netstat", ["-ano", "-p", "tcp"]).stdout || "").split(/\r?\n/)) {
      const f = line.trim().split(/\s+/);
      if (f[0] === "TCP" && f[1]?.endsWith(`:${PORT}`) && f[3] === "LISTENING") return Number(f[4]) || null;
    }
    return null;
  }
  const lsof = run("lsof", ["-nP", `-iTCP:${PORT}`, "-sTCP:LISTEN", "-t"]).stdout || "";
  const fuser = lsof.trim() ? "" : run("fuser", [`${PORT}/tcp`]).stdout || "";
  return Number((lsof || fuser).trim().split(/\s+/)[0]) || null;
}

async function stopPid(pid) {
  if (win) run("taskkill", ["/PID", String(pid), "/T", "/F"]);
  else
    try {
      process.kill(pid, "SIGTERM"); // the office stops its run and any app it opened on the way out
    } catch {}
  for (let i = 0; i < 40 && (await portBusy()); i++) await sleep(250);
  if (!win && (await portBusy()))
    try {
      process.kill(pid, "SIGKILL");
      for (let i = 0; i < 20 && (await portBusy()); i++) await sleep(250);
    } catch {}
  return !(await portBusy());
}

// ---------- start ----------
function spawnOffice() {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  if (win) {
    // in its own minimized window: closing that window also stops the office
    const line = `start "9to5 server" /min "${process.execPath}" "${SERVER}" ${PORT}`;
    spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], { cwd: STUDIO, windowsVerbatimArguments: true, windowsHide: true, detached: true, stdio: "ignore" }).unref();
  } else {
    const out = fs.openSync(LOG, "a");
    spawn(process.execPath, [SERVER, String(PORT)], { cwd: STUDIO, detached: true, stdio: ["ignore", out, out] }).unref();
  }
}

function openBrowser() {
  say(`9to5 is ready at ${URL_}`);
  if (process.env.DEVSTUDIO_NO_BROWSER) return;
  const [bin, args] = process.platform === "darwin" ? ["open", [URL_]] : win ? ["cmd", ["/c", "start", "", URL_]] : ["xdg-open", [URL_]];
  try {
    const child = spawn(bin, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => say(`Open ${URL_} in your browser.`));
    child.unref();
  } catch {
    say(`Open ${URL_} in your browser.`);
  }
}

async function start() {
  let office = await ping();
  if (office && office.version !== codeVersion()) {
    // started before the code on disk changed (an update, or an office from before versions were reported)
    const busy = office.busy ?? (await getJson("/api/state"))?.run?.status === "running";
    if (busy) {
      say("The office is running an older version, but the team is in the middle of something, so it keeps going for now.");
      say(`To switch to the new version once the team is done: ${win ? "devstudio stop" : "bin/devstudio stop"}, then start 9to5 again.`);
      return openBrowser();
    }
    say("The office was started before the last update — restarting it with the new version…");
    if (!(await stopPid(office.pid))) return fail("Couldn't stop the running office. Restart your computer, then start 9to5 again.");
    office = null;
  } else if (!office && (await portBusy())) {
    const old = await olderOffice();
    if (!old)
      return fail(
        `Another program is using port ${PORT}, so 9to5 can't start there.\n` +
          `Close that program, or start the studio on another port: ${win ? `set DEVSTUDIO_PORT=4401 && devstudio` : `DEVSTUDIO_PORT=4401 bin/devstudio`}`,
      );
    if (old.run?.status === "running") {
      say("An older version of 9to5 is running, and its team is in the middle of something — leaving it running for now.");
      say("Once the team is done, close the older office (or restart your computer), then start 9to5 again.");
      return openBrowser();
    }
    const pid = listenerPid();
    if (!pid || !(await stopPid(pid)))
      return fail(
        `An older version of 9to5 is still running on port ${PORT} and couldn't be stopped automatically.\n` +
          "Close the window it runs in (or restart your computer), then start 9to5 again.",
      );
    say("Stopped the older version of 9to5.");
  }
  if (!office) {
    say(`Starting 9to5 at ${URL_} …`);
    spawnOffice();
    for (let i = 0; i < 80 && !(office = await ping()); i++) await sleep(250);
    if (!office) {
      let tail = "";
      try {
        tail = fs.readFileSync(LOG, "utf8").trim().split("\n").slice(-15).join("\n");
      } catch {}
      return fail(`9to5 didn't start.${win ? ' The "9to5 server" window says why.' : tail ? `\nThe last lines of its log (${LOG}):\n${tail}` : ""}`);
    }
  }
  openBrowser();
}

// ---------- stop / status ----------
async function stop() {
  const office = await ping();
  const pid = office?.pid || ((await portBusy()) && (await olderOffice()) ? listenerPid() : null);
  if (!pid) return say("9to5 is not running.");
  if (await stopPid(pid)) say("9to5 stopped.");
  else fail("Couldn't stop 9to5. Restart your computer to be sure it's closed.");
}

async function status() {
  const office = await ping();
  if (office) {
    const stale = office.version !== codeVersion();
    say(`9to5 is running at ${URL_} (pid ${office.pid}).${stale ? " It was started before the last update — start 9to5 again to switch to the new version." : ""}`);
  } else if ((await portBusy()) && (await olderOffice())) say(`An older version of 9to5 is running at ${URL_}. Start 9to5 to replace it with the new version.`);
  else say("9to5 is not running.");
}

// ---------- update ----------
async function update() {
  const git = (...args) => run("git", ["-C", STUDIO, ...args]);
  const out = (r) => (r.stdout || "").trim();
  if (out(git("rev-parse", "--is-inside-work-tree")) !== "true")
    return fail("This copy of 9to5 wasn't downloaded with git, so it can't update itself.\nDownload the latest version from GitHub and start it from there.");
  // only the studio's own files count: run state and settings are ignored by git, projects live elsewhere
  if (out(git("status", "--porcelain", "--untracked-files=no")))
    return fail(`Some of 9to5's own files were changed on this computer, so nothing was updated (and nothing was lost).\nTo see what changed: git -C "${STUDIO}" status`);
  say("Getting the latest version…");
  const fetched = git("fetch", "origin");
  if (fetched.status !== 0) return fail(`Couldn't get the latest version from GitHub:\n${(fetched.stderr || "").trim()}`);
  const main = out(git("symbolic-ref", "--short", "refs/remotes/origin/HEAD")).replace(/^origin\//, "") || "main";
  if (out(git("rev-parse", "--abbrev-ref", "HEAD")) !== main) {
    const co = git("checkout", main);
    if (co.status !== 0) return fail(`Couldn't switch to the ${main} branch:\n${(co.stderr || "").trim()}`);
  }
  const before = out(git("rev-parse", "HEAD"));
  const merged = git("merge", "--ff-only", `origin/${main}`);
  if (merged.status !== 0) return fail(`Couldn't update automatically — this copy has changes of its own:\n${(merged.stderr || "").trim()}`);
  say(before === out(git("rev-parse", "HEAD")) ? "Already up to date." : `Updated to the latest version: ${out(git("log", "-1", "--format=%h %s"))}`);
  await start();
}

if (Number(process.versions.node.split(".")[0]) < 20) {
  fail(`9to5 needs Node.js 20 or newer (this computer has ${process.version}). Get it from https://nodejs.org`);
} else {
  const cmd = process.argv[2] || "start";
  const commands = { start, stop, status, update };
  if (!commands[cmd]) fail("Usage: devstudio [start|update|stop|status]");
  else await commands[cmd]();
}
