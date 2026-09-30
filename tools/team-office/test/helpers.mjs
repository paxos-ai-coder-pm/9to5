// Test helpers: every test gets its own temporary copy of the studio (so nothing touches the real .claude/team
// state), a temporary projects folder, and — for integration tests — the office server running against a fake
// `claude` binary (test/fake-claude.mjs) that plays the manager and the team lead.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../../..");
export const FAKE_CLAUDE = path.join(HERE, "fake-claude.mjs");
export const FAKE_OPENER = path.join(HERE, "fake-opener.mjs");
export const FAKE_BROWSER = path.join(HERE, "fake-browser.mjs");
export const isWindows = process.platform === "win32";

export function makeStudio() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devstudio-test-"));
  const root = path.join(tmp, "studio");
  for (const rel of ["tools/team-office", ".claude/agents", ".claude/skills", ".claude/playbooks"]) {
    fs.cpSync(path.join(REPO, rel), path.join(root, rel), { recursive: true, filter: (src) => !src.includes(`${path.sep}.claude${path.sep}team`) && !src.endsWith(`${path.sep}test`) });
  }
  const projects = path.join(tmp, "projects");
  fs.mkdirSync(projects, { recursive: true });
  const state = path.join(root, ".claude", "team");
  return {
    tmp,
    root,
    projects,
    state,
    office: path.join(root, "tools", "team-office"),
    import: (mod) => import(pathToFileURL(path.join(root, "tools", "team-office", mod)).href),
    read: (file) => JSON.parse(fs.readFileSync(path.join(state, file), "utf8")),
    write: (file, data) => {
      fs.mkdirSync(state, { recursive: true });
      fs.writeFileSync(path.join(state, file), JSON.stringify(data, null, 2));
    },
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until it returns something truthy (or throw after `ms`). */
export async function until(fn, ms = 10000, label = "condition") {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label} (last: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
}

/** Start the office server of `studio` on a free port, with the fake claude. `control` scripts the fake. */
export async function startServer(studio, { env = {}, control = {} } = {}) {
  const controlFile = path.join(studio.tmp, "fake-control.json");
  const logFile = path.join(studio.tmp, "fake-log.jsonl");
  fs.writeFileSync(controlFile, JSON.stringify(control));
  const proc = spawn(process.execPath, [path.join(studio.office, "server.mjs"), "0"], {
    cwd: studio.root,
    env: {
      ...process.env,
      CLAUDE_BIN: FAKE_CLAUDE,
      GH_BIN: path.join(studio.tmp, "no-gh"), // not installed
      DEVSTUDIO_PROJECTS: studio.projects,
      DEVSTUDIO_OPENER: FAKE_OPENER,
      FAKE_CONTROL: controlFile,
      FAKE_LOG: logFile,
      DEVSTUDIO_CHROME: "", // no pictures unless a test asks for them
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  proc.stdout.on("data", (d) => (out += d));
  proc.stderr.on("data", (d) => (out += d));
  const port = await until(() => out.match(/running at http:\/\/localhost:(\d+)/)?.[1], 10000, "server start").catch((e) => {
    proc.kill();
    throw new Error(`${e.message}\n${out}`);
  });
  const base = `http://localhost:${port}`;
  const api = async (p, { method = "GET", body, headers = {} } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text, headers: res.headers };
  };
  return {
    port: Number(port),
    base,
    proc,
    api,
    output: () => out,
    control: (c) => fs.writeFileSync(controlFile, JSON.stringify(c)),
    fakeLog: () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []),
    stop: () =>
      new Promise((resolve) => {
        if (proc.exitCode !== null) return resolve();
        proc.once("exit", resolve);
        proc.kill("SIGTERM");
      }),
  };
}
