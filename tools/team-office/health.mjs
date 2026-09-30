// Setup checklist: is everything the studio needs installed and signed in? Each check carries a plain-language fix.
import fs from "node:fs";
import { execFile } from "node:child_process";
import { claudeEnv, signInHint } from "./lib.mjs";

export const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
export const GH_BIN = process.env.GH_BIN || "gh";

function run(bin, args, { env, timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, windowsHide: true, env }, (err, stdout, stderr) =>
      resolve({ ok: !err, code: err?.code, stdout: String(stdout || ""), stderr: String(stderr || "") }),
    );
  });
}

/** `claude auth status --json` → { loggedIn: true | false | null (unknown), method } */
export function parseAuthStatus(stdout) {
  try {
    const j = JSON.parse(String(stdout).trim());
    return { loggedIn: typeof j.loggedIn === "boolean" ? j.loggedIn : null, method: j.authMethod || null };
  } catch {
    const t = String(stdout);
    if (/not (logged|signed) in/i.test(t)) return { loggedIn: false, method: null };
    if (/(logged|signed) in/i.test(t)) return { loggedIn: true, method: null };
    return { loggedIn: null, method: null };
  }
}

const installClaude = {
  text: "Install Claude Code (the app the team runs on), then click Check again.",
  command: "npm install -g @anthropic-ai/claude-code",
  link: "https://claude.com/claude-code",
};

/**
 * Run every check. `extra` supplies things the server already knows: { githubAccount, projectsDir }.
 * Returns { ready, checkedAt, checks: [{ id, label, ok, required, detail, fix? }] }.
 */
export async function checkHealth({ githubAccount = null, projectsDir } = {}) {
  const env = claudeEnv();
  const [claude, auth, git, gh] = await Promise.all([
    run(CLAUDE_BIN, ["--version"], { env }),
    run(CLAUDE_BIN, ["auth", "status", "--json"], { env }),
    run("git", ["--version"]),
    run(GH_BIN, ["--version"]),
  ]);
  const checks = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({ id: "node", label: "Node.js", ok: nodeMajor >= 18, required: true, detail: `Version ${process.versions.node}`, fix: nodeMajor >= 18 ? undefined : { text: "Install Node.js 18 or newer.", link: "https://nodejs.org" } });

  checks.push({
    id: "claude",
    label: "Claude Code installed",
    ok: claude.ok,
    required: true,
    detail: claude.ok ? claude.stdout.trim().split("\n")[0] : "Not found",
    fix: claude.ok ? undefined : installClaude,
  });

  const a = claude.ok ? parseAuthStatus(auth.stdout) : { loggedIn: null };
  checks.push({
    id: "auth",
    label: "Signed in to Claude",
    ok: a.loggedIn === true,
    unknown: a.loggedIn === null,
    required: true,
    detail: !claude.ok ? "Install Claude Code first" : a.loggedIn === true ? "Signed in" : a.loggedIn === false ? "Not signed in" : "Couldn't tell — it may still work",
    fix: a.loggedIn === true || !claude.ok ? undefined : { text: signInHint("click Check again"), command: "claude auth login" },
  });

  let writable = false;
  try {
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.accessSync(projectsDir, fs.constants.W_OK);
    writable = true;
  } catch {}
  checks.push({
    id: "projects",
    label: "Projects folder",
    ok: writable,
    required: true,
    detail: projectsDir,
    fix: writable ? undefined : { text: "The studio can't write to this folder. Pick another one in ⚙ Settings." },
  });

  checks.push({
    id: "git",
    label: "Git (for Undo and GitHub)",
    ok: git.ok,
    required: false,
    detail: git.ok ? git.stdout.trim() : "Not installed — Undo won't be available",
    fix: git.ok ? undefined : { text: "Install Git so you can undo the team's changes.", link: "https://git-scm.com/downloads" },
  });
  checks.push({
    id: "github",
    label: "GitHub (optional, for publishing)",
    ok: gh.ok && !!githubAccount,
    required: false,
    detail: !gh.ok ? "GitHub CLI not installed" : githubAccount ? `Signed in as ${githubAccount}` : "Not signed in",
    fix: gh.ok && githubAccount ? undefined : gh.ok ? { text: "Sign in to GitHub to publish projects.", command: "gh auth login" } : { text: "Install the GitHub CLI to publish projects.", link: "https://cli.github.com" },
  });

  // "unknown" sign-in doesn't block: the manager will say so if it really can't reply
  const ready = checks.filter((c) => c.required).every((c) => c.ok || c.unknown);
  return { ready, checkedAt: Date.now(), checks };
}
