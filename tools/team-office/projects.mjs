// Projects: where they live, how a project name the manager proposes maps to a folder, how the team's files are
// seeded into it, and the "My Projects" cards.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { ROOT, readRun, readHistory } from "./lib.mjs";
import { projectsRoot, readSettings } from "./settings.mjs";
import { readManifest } from "./manifest.mjs";
import { gitAvailable, isRepo } from "./checkpoint.mjs";
import { GH_BIN } from "./health.mjs";

export const MARKER = path.join(".claude", "devstudio-project.json"); // "the studio has worked on this folder"
export const TEAM_CLI = path.join(ROOT, "tools", "team-office", "team.mjs");
// how every agent calls the office CLI from any project folder (forward slashes work in Git Bash and cmd)
export const T_CMD = `node "${TEAM_CLI.replaceAll("\\", "/")}"`;
// appended to every file the studio seeds, so a later run knows it may refresh it
export const SEAL = "<!-- Seeded by Dev Studio: refreshed on every run. Delete this line to keep your own version. -->";

export const projectId = (dir) => crypto.createHash("sha1").update(path.resolve(dir)).digest("hex").slice(0, 12);
const ACTIVE = ["running", "waiting", "needs-answer"];

/** Every project the office knows: folders the team has run in, plus the folders in the projects folder. */
export function knownProjects() {
  const byDir = new Map();
  const add = (name, dir) => dir && !byDir.has(path.resolve(dir)) && byDir.set(path.resolve(dir), { name, dir: path.resolve(dir) });
  const run = readRun();
  if (run?.dir) add(run.project, run.dir);
  for (const h of readHistory()) add(h.project, h.dir);
  const root = projectsRoot();
  try {
    for (const d of fs.readdirSync(root, { withFileTypes: true })) if (d.isDirectory() && !d.name.startsWith(".")) add(d.name, path.join(root, d.name));
  } catch {}
  return [...byDir.values()];
}

/**
 * "." / this repo's folder name → the Dev Studio itself; a known project's name → its folder; anything else → a new
 * folder in the projects folder. `foreign` = the folder already has files the studio didn't create.
 */
export function resolveProject(name) {
  const n = String(name || "").trim().toLowerCase();
  const here = path.basename(ROOT).toLowerCase();
  if (!n || n === "." || n === here) return { name: path.basename(ROOT), dir: ROOT, isNew: false, foreign: false };
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(n)) throw new Error(`"${name}" isn't a valid project folder name (use lowercase letters, digits and dashes).`);
  const known = knownProjects().find((p) => p.name.toLowerCase() === n && p.dir !== ROOT);
  const dir = known ? known.dir : path.join(projectsRoot(), n);
  const isNew = !fs.existsSync(dir) || fs.readdirSync(dir).filter((f) => f !== ".git").length === 0;
  const hasHistory = readHistory().some((h) => h.dir && path.resolve(h.dir) === dir);
  const foreign = !isNew && !hasHistory && !fs.existsSync(path.join(dir, MARKER));
  return { name: known?.name || n, dir, isNew, foreign };
}

const sha = (s) => crypto.createHash("sha1").update(s).digest("hex");
function readMarker(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, MARKER), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Get a folder ready for a run: create it, `git init` (when git is installed), seed the team's agents, /team skill and
 * playbooks. A file the project changed (or had before) is left alone and reported in `skipped`.
 */
export function prepareProject(p, { lightTeam = readSettings().lightTeam } = {}) {
  fs.mkdirSync(p.dir, { recursive: true });
  if (p.dir === ROOT) return { skipped: [] };
  if (gitAvailable() && !isRepo(p.dir)) {
    try {
      execFileSync("git", ["init", "-q"], { cwd: p.dir, stdio: "ignore", windowsHide: true });
    } catch {}
  }
  const marker = readMarker(p.dir) || { name: p.name, createdAt: Date.now(), createdByStudio: !!p.isNew, seeded: {} };
  const skillFile = path.join(p.dir, ".claude", "skills", "team", "SKILL.md");
  // seeded by an older studio version (before seals existed): those files carry the office CLI command
  const legacy = fs.existsSync(skillFile) && /team-office\/team\.mjs/.test(fs.readFileSync(skillFile, "utf8"));
  const skipped = [];

  // The office CLI lives in this repo, so its relative path is rewritten to an absolute one (env-var paths get
  // blocked in headless runs). A lighter team runs every teammate on Sonnet.
  const seed = (from, rel) => {
    let text = fs.readFileSync(from, "utf8").replaceAll("node tools/team-office/team.mjs", T_CMD);
    if (lightTeam && rel.startsWith(".claude/agents/")) text = text.replace(/^model:\s*opus\s*$/m, "model: sonnet");
    text = text.trimEnd() + "\n\n" + SEAL + "\n";
    const to = path.join(p.dir, rel);
    if (fs.existsSync(to)) {
      const cur = fs.readFileSync(to, "utf8");
      const ours = cur === text || cur.includes(SEAL) || marker.seeded[rel] === sha(cur) || /team-office\/team\.mjs/.test(cur) || (legacy && rel.startsWith(".claude/playbooks/"));
      if (!ours) return skipped.push(rel);
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, text);
    marker.seeded[rel] = sha(text);
  };
  for (const f of fs.readdirSync(path.join(ROOT, ".claude", "agents"))) {
    if (f !== "manager.md") seed(path.join(ROOT, ".claude", "agents", f), `.claude/agents/${f}`);
  }
  seed(path.join(ROOT, ".claude", "skills", "team", "SKILL.md"), ".claude/skills/team/SKILL.md");
  // playbooks (discipline + practice + stack guides); global lessons stay in the studio repo and are read via `T lessons`
  const pbDir = path.join(ROOT, ".claude", "playbooks");
  for (const f of fs.existsSync(pbDir) ? fs.readdirSync(pbDir) : []) {
    if (f.endsWith(".md") && f !== "lessons-global.md") seed(path.join(pbDir, f), `.claude/playbooks/${f}`);
  }
  fs.writeFileSync(path.join(p.dir, MARKER), JSON.stringify(marker, null, 2));

  const gi = path.join(p.dir, ".gitignore");
  const cur = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  if (!cur.includes(".claude/team/")) {
    const extra = p.isNew ? "node_modules/\n.env\n" : "";
    fs.appendFileSync(gi, `${cur && !cur.endsWith("\n") ? "\n" : ""}# team run state\n.claude/team/\n.devstudio/\ntests/scratch/\n${extra}`);
  } else if (!cur.includes(".devstudio/")) {
    fs.appendFileSync(gi, `${cur.endsWith("\n") ? "" : "\n"}.devstudio/\n`); // the team's working files (plan, report)
  }
  return { skipped };
}

// ---- My Projects cards ----
const gitCache = new Map(); // dir → { t, info }
const ghVisibility = new Map(); // "owner/repo" → { t, visibility }
function git(dir, args) {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
function gitInfo(dir) {
  const hit = gitCache.get(dir);
  if (hit && Date.now() - hit.t < 30000) return hit.info;
  let info = { repo: false };
  if (dir && gitAvailable() && fs.existsSync(path.join(dir, ".git"))) {
    const remote = git(dir, ["remote", "get-url", "origin"]);
    const m = remote && remote.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/i);
    const slug = m ? `${m[1]}/${m[2]}` : null;
    const ahead = slug ? Number(git(dir, ["rev-list", "--count", "@{u}..HEAD"]) ?? NaN) : NaN;
    info = {
      repo: true,
      github: slug ? `https://github.com/${slug}` : null,
      slug,
      lastCommit: git(dir, ["log", "-1", "--format=%ct|%s"]),
      uncommitted: (git(dir, ["status", "--porcelain"]) || "").split("\n").filter(Boolean).length,
      unpushed: Number.isFinite(ahead) ? ahead : null,
    };
    if (slug) info.visibility = visibilityOf(slug);
  }
  gitCache.set(dir, { t: Date.now(), info });
  return info;
}
// public/private via gh (async, cached 10 min); unknown until the first lookup finishes
function visibilityOf(slug) {
  const hit = ghVisibility.get(slug);
  if (!hit || Date.now() - hit.t > 10 * 60 * 1000) {
    ghVisibility.set(slug, { t: Date.now(), visibility: hit?.visibility || null });
    execFile(GH_BIN, ["repo", "view", slug, "--json", "visibility", "-q", ".visibility"], { timeout: 15000, windowsHide: true }, (err, out) => {
      ghVisibility.set(slug, { t: Date.now(), visibility: err ? hit?.visibility || null : String(out).trim().toLowerCase() || null });
    });
  }
  return ghVisibility.get(slug).visibility;
}

/** Runs grouped by project folder (newest first), including the active run. */
function runsByProject() {
  const run = readRun();
  const runs = readHistory();
  if (run && ACTIVE.includes(run.status)) runs.unshift({ ...run, title: run.task.split("\n")[0], active: true });
  const byDir = new Map();
  for (const r of runs) {
    if (!r.dir) continue;
    const dir = path.resolve(r.dir);
    if (!byDir.has(dir)) byDir.set(dir, { name: r.project, dir, runs: [] });
    byDir.get(dir).runs.push(r);
  }
  return byDir;
}

/** The project with this id (from a card), or null. The client never sends paths. */
export function findProject(id) {
  if (!/^[0-9a-f]{12}$/.test(String(id))) return null;
  for (const p of runsByProject().values()) if (projectId(p.dir) === id) return p;
  for (const p of knownProjects()) if (projectId(p.dir) === id) return p;
  return null;
}

export function portfolio({ appStatus = () => null, showHidden = false } = {}) {
  const hidden = new Set(readSettings().hiddenProjects);
  const current = readRun();
  const cards = [];
  for (const p of runsByProject().values()) {
    if (!showHidden && hidden.has(p.dir)) continue;
    const latest = p.runs[0];
    const built = p.runs.some((r) => r.status === "finished");
    const g = gitInfo(p.dir);
    const [ct, subject] = (g.lastCommit || "").split(/\|(.*)/s);
    const exists = fs.existsSync(p.dir);
    const { manifest } = exists ? readManifest(p.dir) : { manifest: null };
    const shot = manifest?.screenshot ? path.join(p.dir, manifest.screenshot) : path.join(p.dir, ".claude", "devstudio", "screenshot.png");
    const canOpen = !!manifest || (exists && fs.existsSync(path.join(p.dir, "index.html")));
    cards.push({
      id: projectId(p.dir),
      name: p.name,
      dir: p.dir,
      exists,
      hidden: hidden.has(p.dir),
      isStudio: p.dir === ROOT,
      runs: p.runs.length,
      // project status: an active run wins; otherwise a project that was ever built successfully counts as built
      // (a later failed/stopped run is shown as a note, not as the project's status)
      status: ACTIVE.includes(latest.status) ? latest.status : built ? "finished" : latest.status,
      lastRunNote: built && ["failed", "stopped", "interrupted"].includes(latest.status) ? `Last run ${latest.status}: ${latest.title}` : null,
      latestTitle: latest.title,
      latestRunId: latest.id,
      lastActivity: latest.endedAt || latest.startedAt,
      resumeAt: latest.resumeAt,
      // the latest run can be picked up again (same session) if it didn't finish
      canContinue: ["failed", "interrupted", "stopped"].includes(latest.status) && !!latest.sessionId && !(current && ACTIVE.includes(current.status)),
      history: p.runs.slice(0, 6).map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        at: r.endedAt || r.startedAt,
        // "go back to before this change": needs its checkpoint; not for publishing runs (commits are already out)
        canUndo: !!r.checkpoint && !r.allowGithub && !r.active && exists,
      })),
      app: manifest ? { kind: manifest.kind, name: manifest.name, howTo: manifest.howTo } : canOpen ? { kind: "static", name: p.name, howTo: ["Click ▶ Open to see it in your browser."] } : null,
      canOpen: canOpen && exists,
      hasScreenshot: exists && fs.existsSync(shot),
      appState: appStatus(p.dir),
      github: g.github || null,
      visibility: g.visibility || null,
      lastCommitAt: ct ? Number(ct) * 1000 : null,
      lastCommitSubject: subject || null,
      uncommitted: g.uncommitted ?? null,
      unpushed: g.unpushed ?? null,
      isRepo: g.repo,
    });
  }
  return cards;
}
