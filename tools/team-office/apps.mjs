// "▶ Open": run a finished project for the user, from its devstudio.json.
//   static  → served by a tiny built-in server        web → its own start command, told which port to use ($PORT)
//   script  → run once, output shown in the office      extension / other → nothing to run: show the how-to steps
// Each project keeps the same port every time, so what the app saved in the browser (localStorage) is still there.
// Also: "📂 Show files" and a screenshot of the result (headless Chrome/Edge, if one is installed).
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { DIR, killTree } from "./lib.mjs";
import { readManifest, insidePath } from "./manifest.mjs";

const PORTS_FILE = path.join(DIR, "app-ports.json");
const FIRST_PORT = 4500;
const LAST_PORT = 4999;
const START_TIMEOUT_MS = 120000;
const INSTALL_TIMEOUT_MS = 10 * 60000;
const apps = new Map(); // dir → entry

// ---------- ports ----------
function readPorts() {
  try {
    return JSON.parse(fs.readFileSync(PORTS_FILE, "utf8"));
  } catch {
    return {};
  }
}
const portFree = (port) =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
/** The project's own port (the same every time). If something else took it, move to a free one. */
export async function portFor(dir) {
  const ports = readPorts();
  const taken = new Set(Object.entries(ports).filter(([d]) => d !== dir).map(([, p]) => p));
  let port = ports[dir];
  if (port && (await portFree(port))) return port;
  for (let p = FIRST_PORT; p <= LAST_PORT; p++) {
    if (taken.has(p) || p === port) continue;
    if (await portFree(p)) {
      port = p;
      break;
    }
  }
  if (!port || !(await portFree(port))) throw new Error("No free port to open the app on.");
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(PORTS_FILE, JSON.stringify({ ...readPorts(), [dir]: port }, null, 2));
  return port;
}

// ---------- the built-in server for static apps ----------
const TYPES = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".woff": "font/woff",
  ".woff2": "font/woff2", ".wasm": "application/wasm", ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".webm": "video/webm", ".webmanifest": "application/manifest+json",
};
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
export function staticHandler(dir) {
  return (req, res) => {
    // same DNS-rebinding guard as the office; and never serve dotfiles (.env, .git, .claude)
    if (!LOCAL.test(String(req.headers.host || ""))) return res.writeHead(403).end();
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
    } catch {
      return res.writeHead(400).end();
    }
    if (rel.split("/").some((seg) => seg.startsWith("."))) return res.writeHead(404).end("Not found");
    let file = rel ? insidePath(dir, rel) : path.join(dir, "index.html");
    if (!file) return res.writeHead(404).end("Not found");
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
      const data = fs.readFileSync(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache" });
      res.end(data);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    }
  };
}

// ---------- running ----------
function pushLog(entry, chunk) {
  const lines = String(chunk).replace(/\r/g, "").split("\n");
  if (entry.partial) lines[0] = entry.partial + lines[0];
  entry.partial = lines.pop();
  entry.log.push(...lines);
  if (entry.log.length > 400) entry.log.splice(0, entry.log.length - 400);
}
function spawnShell(entry, command, env) {
  // shell: the manifest's command is a normal command line ("npm start", "python app.py")
  const child = spawn(command, { cwd: entry.dir, shell: true, env: { ...process.env, ...env }, windowsHide: true, detached: process.platform !== "win32" });
  child.stdout.on("data", (d) => pushLog(entry, d));
  child.stderr.on("data", (d) => pushLog(entry, d));
  return child;
}
const waitExit = (child, ms) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve({ timeout: true }), ms);
    child.on("error", (e) => (clearTimeout(t), resolve({ code: -1, error: e })));
    child.on("close", (code) => (clearTimeout(t), resolve({ code })));
  });
// any HTTP answer means the app is up (Vite & co. may listen on ::1 only, so try both)
function answers(port, p = "/") {
  const one = (host) =>
    new Promise((resolve) => {
      const req = http.get({ host, port, path: p, timeout: 1500 }, (res) => {
        res.resume();
        resolve(res.statusCode < 500);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => (req.destroy(), resolve(false)));
    });
  return Promise.all([one("127.0.0.1"), one("::1")]).then((r) => r.some(Boolean));
}

/** Public view of a running (or last run) app, for the cards and the launch page. */
export function appStatus(dir) {
  const e = apps.get(dir);
  if (!e) return null;
  return { status: e.status, kind: e.kind, url: e.url || null, port: e.port || null, startedAt: e.startedAt, exitCode: e.exitCode ?? null, error: e.error || null, log: e.log.slice(-60).join("\n") };
}

/** Open a project. Resolves as soon as the app is starting; poll appStatus() for "running". */
export async function openApp({ name, dir }) {
  const cur = apps.get(dir);
  if (cur && ["installing", "starting", "running"].includes(cur.status)) return appStatus(dir);
  let { manifest, problems } = readManifest(dir);
  // older projects without devstudio.json: a plain index.html can still be opened
  if (!manifest && fs.existsSync(path.join(dir, "index.html"))) manifest = { name, kind: "static", entry: "index.html", howTo: ["Your app opens in the browser."] };
  if (!manifest) throw new Error(`The team didn't leave instructions for opening this project yet (${problems[0]}). Ask the manager "How do I try ${name}?"`);

  const entry = { dir, name: manifest.name, kind: manifest.kind, status: "starting", startedAt: Date.now(), log: [], partial: "" };
  apps.set(dir, entry);
  if (manifest.kind === "extension" || manifest.kind === "other") {
    entry.status = "manual";
    return appStatus(dir);
  }
  if (manifest.kind === "static") {
    entry.port = await portFor(dir);
    entry.server = http.createServer(staticHandler(dir));
    await new Promise((resolve, reject) => entry.server.once("error", reject).listen(entry.port, "127.0.0.1", resolve));
    entry.url = `http://localhost:${entry.port}/${manifest.entry === "index.html" ? "" : manifest.entry}`;
    entry.status = "running";
    return appStatus(dir);
  }

  // web / script: run the project's own commands (install first, once)
  const env = { BROWSER: "none", FORCE_COLOR: "0" };
  if (manifest.kind === "web") {
    entry.port = await portFor(dir);
    Object.assign(env, { PORT: String(entry.port) });
    entry.url = `http://localhost:${entry.port}${manifest.path || "/"}`;
  }
  (async () => {
    const check = insidePath(dir, manifest.installedCheck || "node_modules");
    if (manifest.install && check && !fs.existsSync(check)) {
      entry.status = "installing";
      entry.child = spawnShell(entry, manifest.install, env);
      const r = await waitExit(entry.child, INSTALL_TIMEOUT_MS);
      if (entry.status === "stopped") return;
      if (r.timeout || r.code !== 0) {
        if (r.timeout) killTree(entry.child.pid);
        Object.assign(entry, { status: "failed", error: r.timeout ? "Installing took too long." : "Installing what the app needs failed.", exitCode: r.code ?? null });
        return;
      }
    }
    entry.status = manifest.kind === "script" ? "running" : "starting";
    entry.child = spawnShell(entry, manifest.start, env);
    const exited = waitExit(entry.child, 24 * 3600e3).then((r) => {
      if (entry.status === "stopped") return;
      entry.exitCode = r.code;
      if (manifest.kind === "script") entry.status = r.code === 0 ? "exited" : "failed";
      else {
        entry.status = "failed";
        entry.error = entry.ready ? "The app stopped." : "The app closed before it was ready.";
      }
      if (r.code !== 0 && !entry.error) entry.error = "The script ended with an error.";
    });
    if (manifest.kind === "script") return;
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (entry.status === "starting" && Date.now() < deadline) {
      if (await answers(entry.port, manifest.path || "/")) {
        entry.ready = true;
        entry.status = "running";
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (entry.status === "starting") {
      Object.assign(entry, { status: "failed", error: "The app didn't start within 2 minutes." });
      killTree(entry.child.pid);
    }
    await exited;
  })().catch((e) => Object.assign(entry, { status: "failed", error: e.message }));
  return appStatus(dir);
}

export function stopApp(dir) {
  const e = apps.get(dir);
  if (!e) return false;
  e.status = "stopped";
  if (e.server) {
    e.server.close();
    e.server.closeAllConnections?.(); // browsers keep connections open; free the port now
  }
  if (e.child && e.child.exitCode === null) killTree(e.child.pid);
  return true;
}
export function stopAllApps() {
  for (const dir of apps.keys()) stopApp(dir);
}

// ---------- show files ----------
/** Open the folder in Explorer / Finder / the file manager. DEVSTUDIO_OPENER overrides the program (tests). */
export function showFiles(dir) {
  const [bin, args] = process.env.DEVSTUDIO_OPENER
    ? [process.env.DEVSTUDIO_OPENER, [dir]]
    : process.platform === "win32"
      ? ["explorer.exe", [dir]]
      : process.platform === "darwin"
        ? ["open", [dir]]
        : ["xdg-open", [dir]];
  return new Promise((resolve) => {
    try {
      const child = spawn(bin, args, { detached: true, stdio: "ignore", windowsHide: false });
      child.once("error", () => resolve({ ok: false, error: `Couldn't open the folder on this computer. It's here: ${dir}` }));
      child.once("spawn", () => {
        child.unref();
        resolve({ ok: true });
      });
    } catch {
      resolve({ ok: false, error: `Couldn't open the folder on this computer. It's here: ${dir}` });
    }
  });
}

// ---------- screenshot ----------
export function findBrowser() {
  if (process.env.DEVSTUDIO_CHROME) return process.env.DEVSTUDIO_CHROME;
  const pf = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
  const candidates =
    process.platform === "win32"
      ? pf.flatMap((b) => [path.join(b, "Google", "Chrome", "Application", "chrome.exe"), path.join(b, "Microsoft", "Edge", "Application", "msedge.exe")])
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium", "/usr/bin/microsoft-edge"];
  return candidates.find((c) => fs.existsSync(c)) || null;
}
export const screenshotPath = (dir) => path.join(dir, ".claude", "devstudio", "screenshot.png");
let lastShotError = null;
/** Why the last screenshot attempt produced no picture (null if it worked). */
export const screenshotError = () => lastShotError;

/** Take a picture of the running app (starting it if needed). Resolves to the file path, or null if not possible. */
export async function captureScreenshot(project) {
  const browser = findBrowser();
  if (!browser) return null;
  const wasRunning = apps.get(project.dir)?.status === "running";
  try {
    let st = await openApp(project);
    const deadline = Date.now() + START_TIMEOUT_MS + INSTALL_TIMEOUT_MS;
    while (st && ["installing", "starting"].includes(st.status) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      st = appStatus(project.dir);
    }
    if (st?.status !== "running" || !st.url) return null;
    const out = screenshotPath(project.dir);
    const fresh = out.replace(/\.png$/, ".new.png"); // a failed attempt must not wipe the previous picture
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.rmSync(fresh, { force: true });
    // Chrome makes Unix sockets in its temp folder (≈108-character path limit): use a short one where there is one
    const tmp = process.platform !== "win32" && fs.existsSync("/tmp") ? "/tmp" : os.tmpdir();
    const profile = fs.mkdtempSync(path.join(tmp, "devstudio-shot-"));
    const args = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--window-size=1280,800", "--virtual-time-budget=4000", `--screenshot=${fresh}`, st.url];
    // resolves to what went wrong (exit status + the browser's own output), or null when it exited cleanly
    const shoot = (extra) =>
      new Promise((resolve) =>
        execFile(browser, [...extra, ...args], { timeout: 60000, windowsHide: true, env: { ...process.env, TMPDIR: tmp } }, (err, stdout, stderr) => {
          const said = `${stdout || ""}${stderr || ""}`.split("\n").filter((l) => l.trim() && !/crashpad|cpufreq/.test(l)).slice(-12).join("\n");
          resolve({ failed: !!err, text: `${err ? `exit ${err.code ?? err.signal ?? "?"}` : "exit 0"}${said ? `: ${said}` : ""}` });
        }),
      );
    const linux = process.platform === "linux";
    const tries = [await shoot(linux && process.getuid?.() === 0 ? ["--no-sandbox"] : [])];
    // Linux containers / AppArmor often have no usable sandbox; the page is the user's own app on localhost
    if (!fs.existsSync(fresh) && linux) tries.push(await shoot(["--no-sandbox"]));
    fs.rmSync(profile, { recursive: true, force: true });
    if (!fs.existsSync(fresh)) {
      lastShotError = `no picture from ${path.basename(browser)} (${tries.map((t) => t.text).join(" | then: ")})`;
      return null;
    }
    fs.renameSync(fresh, out);
    lastShotError = null;
    return out;
  } catch (e) {
    lastShotError = e.message;
    return null;
  } finally {
    if (!wasRunning) stopApp(project.dir);
  }
}
