// Undo for a run: before the team starts, the project's files are snapshotted into a hidden git ref
// (refs/devstudio/checkpoints/<id>). A temporary index is used, so the user's own branch, staging area and history
// are never touched. Restoring brings back changed/deleted files and removes files the run added; it first
// snapshots the current state, so an undo can itself be undone.
// Ignored files (.gitignore) and heavy generated folders (node_modules, .venv, …) are left alone.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const HEAVY = ["node_modules", ".venv", "venv", "__pycache__", ".next", ".nuxt", "target", ".gradle", "Pods", ".dart_tool", ".claude/team", "tests/scratch"];
const EXCLUDES = HEAVY.map((d) => `:(glob,exclude)**/${d}/**`);
const IDENTITY = { GIT_AUTHOR_NAME: "9to5", GIT_AUTHOR_EMAIL: "devstudio@localhost", GIT_COMMITTER_NAME: "9to5", GIT_COMMITTER_EMAIL: "devstudio@localhost" };

let gitOk = null;
export function gitAvailable() {
  if (gitOk === null) {
    try {
      execFileSync("git", ["--version"], { stdio: "ignore", timeout: 10000, windowsHide: true });
      gitOk = true;
    } catch {
      gitOk = false;
    }
  }
  return gitOk;
}

function git(dir, args, { index, input } = {}) {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    input,
    timeout: 120000,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...IDENTITY, ...(index ? { GIT_INDEX_FILE: index } : {}) },
  }).trim();
}

const safeId = (id) => String(id).replace(/[^\w.-]/g, "_").slice(0, 80);
const tempIndex = () => path.join(os.tmpdir(), `devstudio-index-${crypto.randomUUID()}`);
// the folder is its own repository (not just somewhere inside another one)
const norm = (p) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
export const isRepo = (dir) => {
  try {
    // realpathSync.native: resolves symlinks (macOS /var → /private/var) and Windows 8.3 short names like RUNNER~1
    return norm(fs.realpathSync.native(git(dir, ["rev-parse", "--show-toplevel"]))) === norm(fs.realpathSync.native(dir));
  } catch {
    return false;
  }
};

// the tree of the work folder as it is right now (respecting .gitignore and the heavy-folder excludes)
function snapshotTree(dir) {
  const index = tempIndex();
  try {
    git(dir, ["add", "-A", "--", ".", ...EXCLUDES], { index });
    return git(dir, ["write-tree"], { index });
  } finally {
    fs.rmSync(index, { force: true });
  }
}

/** Snapshot the project. Returns { id, commit, tree } or null (no git / not its own repo / failed). */
export function createCheckpoint(dir, id, label = "9to5 checkpoint") {
  if (!gitAvailable() || !isRepo(dir)) return null;
  try {
    const tree = snapshotTree(dir);
    let head = null;
    try {
      head = git(dir, ["rev-parse", "--verify", "-q", "HEAD"]);
    } catch {}
    const commit = git(dir, ["commit-tree", tree, ...(head ? ["-p", head] : []), "-m", label]);
    git(dir, ["update-ref", `refs/devstudio/checkpoints/${safeId(id)}`, commit]);
    return { id: safeId(id), commit, tree };
  } catch {
    return null;
  }
}

export function hasCheckpoint(dir, id) {
  try {
    git(dir, ["rev-parse", "--verify", "-q", `refs/devstudio/checkpoints/${safeId(id)}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Put the project's files back the way they were at checkpoint `id`.
 * Returns { restored, removed, redoId } — redoId is a checkpoint of the state just before this undo.
 */
export function restoreCheckpoint(dir, id) {
  if (!gitAvailable()) throw new Error("Undo needs git, which isn't installed on this computer.");
  let cpTree;
  try {
    cpTree = git(dir, ["rev-parse", "--verify", "-q", `refs/devstudio/checkpoints/${safeId(id)}^{tree}`]);
  } catch {
    throw new Error("There's no saved copy to go back to for that change.");
  }
  const redoId = `redo-${Date.now()}`;
  const before = createCheckpoint(dir, redoId, "9to5: before undo");
  if (!before) throw new Error("Couldn't save the current state before undoing, so nothing was changed.");

  const out = git(dir, ["diff-tree", "-r", "-z", "--no-renames", "--name-status", cpTree, before.tree]);
  const parts = out.split("\0").filter((p) => p !== "");
  const added = [];
  const restore = [];
  for (let i = 0; i + 1 < parts.length; i += 2) (parts[i] === "A" ? added : restore).push(parts[i + 1]);

  const root = path.resolve(dir);
  for (const rel of added) {
    const full = path.resolve(root, rel);
    if (!full.startsWith(root + path.sep)) continue;
    fs.rmSync(full, { force: true });
    // tidy up folders the run created that are now empty
    for (let d = path.dirname(full); d.startsWith(root + path.sep); d = path.dirname(d)) {
      try {
        fs.rmdirSync(d);
      } catch {
        break;
      }
    }
  }
  if (restore.length) {
    const index = tempIndex();
    try {
      git(dir, ["read-tree", cpTree], { index });
      git(dir, ["checkout-index", "-f", "-z", "--stdin"], { index, input: restore.join("\0") });
    } finally {
      fs.rmSync(index, { force: true });
    }
  }
  return { restored: restore.length, removed: added.length, redoId };
}
