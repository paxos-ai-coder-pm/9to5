// User settings for the office: studio name, where projects live, lighter team, hidden projects.
// Stored in .claude/team/settings.json (gitignored). DEVSTUDIO_PROJECTS overrides the projects folder (tests, power users).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DIR, ROOT } from "./lib.mjs";

const FILE = path.join(DIR, "settings.json");

export const DEFAULTS = Object.freeze({
  studioName: "Vikrant's Dev Studio",
  projectsDir: "", // empty = the default folder below
  lightTeam: false, // every teammate on Sonnet (uses less of the Claude plan)
  hiddenProjects: [], // project folders removed from "My Projects" (files are kept)
});

// A dedicated folder, so new projects never land among the user's own folders (Documents, Music, …).
export const defaultProjectsDir = () => path.join(os.homedir(), "DevStudioProjects");

export function readSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

// The real location of a path that may not exist yet: the deepest existing folder, symlinks resolved
// (macOS /var → /private/var), plus the rest — so "inside the studio" is caught however the path is written.
function realPath(p) {
  let cur = path.resolve(p);
  const rest = [];
  while (!fs.existsSync(cur)) {
    const up = path.dirname(cur);
    if (up === cur) break;
    rest.unshift(path.basename(cur));
    cur = up;
  }
  try {
    cur = fs.realpathSync.native(cur);
  } catch {}
  return path.join(cur, ...rest);
}

export function projectsRoot() {
  return path.resolve(process.env.DEVSTUDIO_PROJECTS || readSettings().projectsDir || defaultProjectsDir());
}

/** Validate and apply a partial update; throws an Error with a plain-language message. Returns the new settings. */
export function updateSettings(patch = {}) {
  const cur = readSettings();
  const next = { ...cur };
  if ("studioName" in patch) {
    const name = String(patch.studioName ?? "").replace(/\s+/g, " ").trim();
    if (!name || name.length > 40 || /[\u0000-\u001f<>]/.test(name)) throw new Error("The studio name must be 1–40 characters (no < or >).");
    next.studioName = name;
  }
  if ("projectsDir" in patch) {
    const raw = String(patch.projectsDir ?? "").trim();
    if (!raw) next.projectsDir = "";
    else {
      const dir = path.resolve(raw.replace(/^~(?=$|[\\/])/, os.homedir()));
      if (!path.isAbsolute(raw) && !raw.startsWith("~")) throw new Error("Use a full folder path, like " + defaultProjectsDir());
      if (dir === path.parse(dir).root) throw new Error("Pick a folder, not a whole drive.");
      const real = realPath(dir);
      const root = realPath(ROOT);
      if (real === root || real.startsWith(root + path.sep)) throw new Error("Projects can't live inside the Dev Studio's own folder.");
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.accessSync(dir, fs.constants.W_OK);
      } catch {
        throw new Error(`Can't create or write to ${dir}.`);
      }
      next.projectsDir = dir;
    }
  }
  if ("lightTeam" in patch) next.lightTeam = !!patch.lightTeam;
  if ("hiddenProjects" in patch) {
    if (!Array.isArray(patch.hiddenProjects)) throw new Error("hiddenProjects must be a list.");
    next.hiddenProjects = [...new Set(patch.hiddenProjects.map(String))].slice(0, 500);
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}
