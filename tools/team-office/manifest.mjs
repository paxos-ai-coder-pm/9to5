// devstudio.json — how the office opens a finished project for the user — and the plain-language run report.
// Shared by the team CLI (`T deliver`, `T report`) and the office server, so it has no server dependencies.
//
// devstudio.json (in the project root, written by the team):
//   { "name": "Family Budget",
//     "kind": "web" | "static" | "script" | "extension" | "other",
//     "start": "npm start",          web/script: command run in the project folder (web apps must listen on $PORT)
//     "install": "npm install",      optional, run once first when `installedCheck` (default node_modules) is missing
//     "entry": "index.html",         static: the page to open (default index.html)
//     "path": "/",                   web: the page to open once the app is up
//     "howTo": ["Click Open", "…"],  plain-language steps for the user (1–8)
//     "screenshot": "docs/screenshot.png" }
import fs from "node:fs";
import path from "node:path";

export const KINDS = ["web", "static", "script", "extension", "other"];
export const MANIFEST = "devstudio.json";

const str = (v, max) => typeof v === "string" && v.trim() && v.length <= max;
const list = (v, min, max, len) => Array.isArray(v) && v.length >= min && v.length <= max && v.every((s) => str(s, len));
// a path inside the project, relative, no ".." — returns null if unsafe
export function insidePath(dir, rel) {
  if (typeof rel !== "string" || !rel.trim() || path.isAbsolute(rel)) return null;
  const full = path.resolve(dir, rel);
  return full === dir || full.startsWith(dir + path.sep) ? full : null;
}

/** Returns { manifest, problems[] }. `manifest` is the cleaned object (null if unusable). */
export function validateManifest(raw, dir) {
  const problems = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { manifest: null, problems: ["devstudio.json must be a JSON object."] };
  const m = {};
  if (!str(raw.name, 60)) problems.push('"name" is required (≤ 60 characters), e.g. "Family Budget".');
  else m.name = raw.name.trim();
  if (!KINDS.includes(raw.kind)) problems.push(`"kind" must be one of: ${KINDS.join(", ")}.`);
  else m.kind = raw.kind;
  if (raw.start != null) {
    if (!str(raw.start, 300)) problems.push('"start" must be a command (≤ 300 characters), e.g. "npm start".');
    else m.start = raw.start.trim();
  }
  if ((m.kind === "web" || m.kind === "script") && !m.start) problems.push(`A "${m.kind}" project needs a "start" command.`);
  if (raw.install != null) {
    if (!str(raw.install, 300)) problems.push('"install" must be a command, e.g. "npm install".');
    else m.install = raw.install.trim();
  }
  if (raw.installedCheck != null) {
    if (!insidePath(dir, raw.installedCheck)) problems.push('"installedCheck" must be a path inside the project, e.g. "node_modules".');
    else m.installedCheck = raw.installedCheck;
  }
  if (raw.entry != null || m.kind === "static") {
    const entry = raw.entry ?? "index.html";
    const full = insidePath(dir, entry);
    if (!full) problems.push('"entry" must be a file inside the project, e.g. "index.html".');
    else if (dir && !fs.existsSync(full)) problems.push(`"entry" file ${entry} doesn't exist.`);
    else m.entry = entry.replaceAll("\\", "/");
  }
  if (raw.path != null) {
    if (typeof raw.path !== "string" || !raw.path.startsWith("/") || raw.path.length > 200) problems.push('"path" must start with "/", e.g. "/".');
    else m.path = raw.path;
  }
  if (!list(raw.howTo, 1, 8, 200)) problems.push('"howTo" must list 1–8 short steps for the user, in plain words.');
  else m.howTo = raw.howTo.map((s) => s.trim());
  if (raw.screenshot != null) {
    const full = insidePath(dir, raw.screenshot);
    if (!full || !/\.(png|jpe?g|webp)$/i.test(raw.screenshot)) problems.push('"screenshot" must be a .png/.jpg/.webp file inside the project.');
    else m.screenshot = raw.screenshot.replaceAll("\\", "/");
  }
  // usable = the office can show it and open it; other problems (a bad screenshot path) are reported but not fatal
  const usable = m.name && m.kind && m.howTo && (!["web", "script"].includes(m.kind) || m.start) && (m.kind !== "static" || m.entry);
  return { manifest: usable ? m : null, problems };
}

/** Read and validate <dir>/devstudio.json. Returns { manifest, problems } (manifest null if missing/invalid). */
export function readManifest(dir) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), "utf8"));
  } catch (e) {
    return { manifest: null, problems: [e.code === "ENOENT" ? `No ${MANIFEST} yet.` : `${MANIFEST} isn't valid JSON (${e.message}).`], missing: e.code === "ENOENT" };
  }
  return validateManifest(raw, dir);
}

// The run's final report, in plain words — posted by the lead with `T report <file.json>`:
//   { "summary": "Your family budget tracker is ready.", "got": ["…"], "howToOpen": ["…"], "notYet": ["…"], "next": ["…"] }
export function validateReport(raw) {
  const problems = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { report: null, problems: ["The report must be a JSON object."] };
  const r = {};
  if (!str(raw.summary, 300)) problems.push('"summary" is required: one plain sentence (≤ 300 characters).');
  else r.summary = raw.summary.trim();
  if (!list(raw.got, 1, 8, 240)) problems.push('"got" must list 1–8 things the user now has, in plain words.');
  else r.got = raw.got.map((s) => s.trim());
  for (const k of ["howToOpen", "notYet", "next"]) {
    if (raw[k] == null) continue;
    if (!list(raw[k], 0, 8, 240)) problems.push(`"${k}" must be a list of up to 8 short sentences.`);
    else r[k] = raw[k].map((s) => s.trim());
  }
  return { report: problems.length ? null : r, problems };
}
