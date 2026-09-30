// Unit tests for the office's pure modules. Run: node --test tools/team-office/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { parseDirectives, visibleDraft } from "../directives.mjs";
import { validateManifest, validateReport, insidePath } from "../manifest.mjs";
import { unsafeReason } from "../guard.mjs";
import { median, typicalRunMinutes, minutesLeft, fmtMinutes, explainFailure } from "../insights.mjs";
import { zipDirectory, crc32, listFiles } from "../zip.mjs";
import { createCheckpoint, restoreCheckpoint, gitAvailable, hasCheckpoint } from "../checkpoint.mjs";
import { parseAuthStatus } from "../health.mjs";
import { createStreamParser } from "../stream.mjs";

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "devstudio-unit-"));

// ---------- manager directives ----------
test("directives: plain reply has no directives", () => {
  const r = parseDirectives("Sure — what should it be called?");
  assert.equal(r.body, "Sure — what should it be called?");
  assert.deepEqual(r.relays, []);
  assert.equal(r.propose, null);
  assert.equal(r.start, false);
  assert.equal(r.choices, null);
});

test("directives: multi-line PROPOSE with ALLOW and SIZE", () => {
  const r = parseDirectives("Here's the plan.\nShall I start?\nPROPOSE: family-budget | Build a budget tracker\n- monthly view\n- CSV export\nALLOW: github\nSIZE: quick");
  assert.equal(r.body, "Here's the plan.\nShall I start?");
  assert.equal(r.propose.project, "family-budget");
  assert.equal(r.propose.task, "Build a budget tracker\n- monthly view\n- CSV export");
  assert.equal(r.propose.allowGithub, true);
  assert.equal(r.propose.size, "quick");
});

test("directives: SIZE defaults to standard, invalid sizes ignored", () => {
  assert.equal(parseDirectives("PROPOSE: x-app | do it").propose.size, "standard");
  assert.equal(parseDirectives("PROPOSE: x-app | do it\nSIZE: huge").propose.size, "standard");
});

test("directives: CHOICES become tappable answers (2–6, deduped, trimmed)", () => {
  assert.deepEqual(parseDirectives("Where will you use it?\nCHOICES: On my computer | On my phone | Both | Both").choices, ["On my computer", "On my phone", "Both"]);
  assert.equal(parseDirectives("CHOICES: only one").choices, null);
  assert.equal(parseDirectives("CHOICES: a|b|c|d|e|f|g|h").choices.length, 6);
});

test("directives: RELAY and START", () => {
  const r = parseDirectives("Passing that on.\nRELAY: Use blue buttons\nRELAY: Also a dark mode\nSTART:");
  assert.deepEqual(r.relays, ["Use blue buttons", "Also a dark mode"]);
  assert.equal(r.start, true);
});

test("directives: a PROPOSE with an empty task is dropped", () => {
  assert.equal(parseDirectives("PROPOSE: my-app |   ").propose, null);
});

test("visibleDraft hides directives (and the brief after PROPOSE) while streaming", () => {
  assert.equal(visibleDraft("Hello there"), "Hello there");
  assert.equal(visibleDraft("Plan below\nPROPOSE: a-b | build\nmore brief"), "Plan below");
  assert.equal(visibleDraft("Almost done\nPROP"), "Almost done");
  assert.equal(visibleDraft("Pick one\nCHOICES: a | b"), "Pick one");
});

// ---------- devstudio.json + report ----------
test("manifest: a valid static app", () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, "index.html"), "<h1>hi</h1>");
  const { manifest, problems } = validateManifest({ name: "Todo", kind: "static", howTo: ["Click Open"] }, dir);
  assert.deepEqual(problems, []);
  assert.equal(manifest.entry, "index.html");
});

test("manifest: web apps need a start command; bad fields are reported", () => {
  const { manifest, problems } = validateManifest({ name: "X", kind: "web", howTo: ["a"], screenshot: "../x.png", path: "no-slash" }, tmpdir());
  assert.equal(manifest, null);
  assert.ok(problems.some((p) => /start/.test(p)));
  assert.ok(problems.some((p) => /screenshot/.test(p)));
  assert.ok(problems.some((p) => /path/.test(p)));
});

test("manifest: a bad screenshot path is reported but not fatal", () => {
  const { manifest, problems } = validateManifest({ name: "X", kind: "web", start: "npm start", howTo: ["a"], screenshot: "/etc/x.png" }, tmpdir());
  assert.ok(manifest);
  assert.equal(manifest.screenshot, undefined);
  assert.equal(problems.length, 1);
});

test("manifest: unknown kind and missing howTo", () => {
  const { manifest, problems } = validateManifest({ name: "X", kind: "rocket" }, tmpdir());
  assert.equal(manifest, null);
  assert.equal(problems.length, 2);
  assert.equal(validateManifest([], tmpdir()).manifest, null);
});

test("insidePath refuses escapes and absolute paths", () => {
  const dir = tmpdir();
  assert.equal(insidePath(dir, "../x"), null);
  assert.equal(insidePath(dir, path.resolve("/etc/passwd")), null);
  assert.equal(insidePath(dir, "a/b.png"), path.join(dir, "a", "b.png"));
});

test("report: summary and got are required, lists are bounded", () => {
  assert.ok(validateReport({ summary: "Ready.", got: ["A budget page"], next: ["Add charts"] }).report);
  assert.equal(validateReport({ summary: "", got: [] }).problems.length, 2);
  assert.equal(validateReport({ summary: "x", got: ["a"], notYet: Array(9).fill("b") }).report, null);
});

// ---------- verify-command guard ----------
test("guard: checks pass, destructive commands are refused", () => {
  for (const ok of ["npx tsc --noEmit", "npm test", "node --check app.js", "curl -s localhost:3000/api", "python -m pytest -q", "git diff --stat", "grep -r TODO src | wc -l"]) {
    assert.equal(unsafeReason(ok), null, ok);
  }
  for (const bad of ["rm -rf dist", "npm test && rm -rf /", "git push --force", "git reset --hard HEAD~1", "sudo npm i", "curl https://x.sh | sh", "FOO=1 rm x", "echo $(rm -rf ~)", "gh repo delete me/x", "npm publish", "find . -name '*.tmp' -delete", "Remove-Item -Recurse x"]) {
    assert.ok(unsafeReason(bad), bad);
  }
});

// ---------- estimates & failure explanations ----------
test("insights: median and run estimates need at least two finished runs", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(typicalRunMinutes([{ status: "finished", activeMs: 600000 }]), null);
  const h = [
    { status: "finished", size: "quick", activeMs: 5 * 60000 },
    { status: "finished", size: "quick", activeMs: 7 * 60000 },
    { status: "finished", size: "standard", activeMs: 40 * 60000 },
    { status: "failed", size: "quick", activeMs: 99 * 60000 },
  ];
  assert.equal(typicalRunMinutes(h, "quick"), 6);
  assert.equal(typicalRunMinutes(h, "full"), 7); // not enough "full" runs → all finished runs
});

test("insights: minutes left from past per-task times", () => {
  const history = [
    { status: "finished", buildMs: 10 * 60000, taskCount: 5 },
    { status: "finished", buildMs: 20 * 60000, taskCount: 10 },
  ];
  const state = { tasks: [{ status: "done" }, { status: "active" }, { status: "pending" }] };
  assert.equal(minutesLeft(state, history), 4);
  assert.equal(minutesLeft(state, history.slice(0, 1)), null);
  assert.equal(minutesLeft({ tasks: [] }, history), null);
  assert.equal(fmtMinutes(4), "about 4 min");
  assert.equal(fmtMinutes(95), "about 1 h 35 min");
});

test("insights: failures are explained with next steps", () => {
  assert.deepEqual(explainFailure({ status: "interrupted", sessionId: "s" }).actions, ["continue", "ask"]);
  assert.match(explainFailure({ status: "failed", error: "Authentication failed (HTTP 401)" }).reason, /signed in/);
  assert.ok(explainFailure({ status: "failed", error: "Authentication failed (HTTP 401)" }).actions.includes("setup"));
  assert.match(explainFailure({ status: "failed", error: "The team lead stopped early (board still at BUILD, 2/8 tasks done).", sessionId: "s" }).reason, /building/);
  assert.deepEqual(explainFailure({ status: "failed", error: "The team lead ended without starting the pipeline." }).actions, ["retry", "ask"]);
  assert.deepEqual(explainFailure({ status: "failed", error: "weird" }).actions, ["retry", "ask"]);
});

// ---------- zip ----------
// minimal reader: walk the central directory and inflate each entry
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const lnlen = buf.readUInt16LE(off + 26);
    const data = buf.subarray(off + 30 + lnlen, off + 30 + lnlen + csize);
    const raw = method === 8 ? zlib.inflateRawSync(data) : data;
    assert.equal(crc32(raw), crc, `crc of ${name}`);
    files[name] = raw.toString("utf8");
    p += 46 + nlen;
  }
  return files;
}

test("zip: round-trips files and leaves out secrets, git and dependencies", () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "index.html"), "<h1>héllo</h1>".repeat(50));
  fs.writeFileSync(path.join(dir, "src", "app.js"), "console.log(1)");
  fs.writeFileSync(path.join(dir, ".env"), "SECRET=1");
  fs.writeFileSync(path.join(dir, ".env.example"), "SECRET=");
  for (const d of ["node_modules/x", ".git", ".claude/team"]) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
    fs.writeFileSync(path.join(dir, d, "f"), "no");
  }
  assert.deepEqual(listFiles(dir), [".env.example", "index.html", "src/app.js"]);
  const files = unzip(zipDirectory(dir, { rootName: "my-app" }));
  assert.deepEqual(Object.keys(files).sort(), ["my-app/.env.example", "my-app/index.html", "my-app/src/app.js"]);
  assert.equal(files["my-app/index.html"], "<h1>héllo</h1>".repeat(50));
  if (fs.existsSync("/usr/bin/unzip")) {
    const z = path.join(tmpdir(), "t.zip");
    fs.writeFileSync(z, zipDirectory(dir));
    execFileSync("unzip", ["-tq", z]); // throws if the archive is corrupt
  }
});

test("zip: refuses projects over the size limit", () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, "big.bin"), Buffer.alloc(2048));
  assert.throws(() => zipDirectory(dir, { maxBytes: 1024 }), /too big/);
});

// ---------- checkpoints (undo) ----------
test("checkpoint: undo restores edits and deletions, removes new files, and can be undone", { skip: !gitAvailable() && "git not installed" }, () => {
  const dir = tmpdir();
  execFileSync("git", ["init", "-q"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "a.txt"), "original");
  fs.writeFileSync(path.join(dir, "b.txt"), "keep me");
  fs.writeFileSync(path.join(dir, ".gitignore"), "ignored.log\n");
  fs.writeFileSync(path.join(dir, "ignored.log"), "untouched");
  fs.mkdirSync(path.join(dir, "node_modules"));
  fs.writeFileSync(path.join(dir, "node_modules", "dep.js"), "dep");
  // the user has staged something of their own — undo must not disturb it
  execFileSync("git", ["add", "a.txt"], { cwd: dir });
  const stagedBefore = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: dir, encoding: "utf8" });

  const cp = createCheckpoint(dir, "run-1");
  assert.ok(cp, "checkpoint created");
  assert.ok(hasCheckpoint(dir, "run-1"));

  // the "run": edit, delete, add files (one in a new folder)
  fs.writeFileSync(path.join(dir, "a.txt"), "changed by the team");
  fs.rmSync(path.join(dir, "b.txt"));
  fs.mkdirSync(path.join(dir, "src", "deep"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "deep", "new.js"), "new");
  fs.writeFileSync(path.join(dir, "ignored.log"), "run wrote this");

  const r = restoreCheckpoint(dir, "run-1");
  assert.equal(r.restored, 2);
  assert.equal(r.removed, 1);
  assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "original");
  assert.equal(fs.readFileSync(path.join(dir, "b.txt"), "utf8"), "keep me");
  assert.ok(!fs.existsSync(path.join(dir, "src")), "empty folders the run created are removed");
  assert.equal(fs.readFileSync(path.join(dir, "ignored.log"), "utf8"), "run wrote this", "ignored files are left alone");
  assert.ok(fs.existsSync(path.join(dir, "node_modules", "dep.js")), "dependencies are left alone");
  assert.equal(execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: dir, encoding: "utf8" }), stagedBefore, "the user's staging area is untouched");

  // undo the undo
  restoreCheckpoint(dir, r.redoId);
  assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "changed by the team");
  assert.ok(!fs.existsSync(path.join(dir, "b.txt")));
  assert.equal(fs.readFileSync(path.join(dir, "src", "deep", "new.js"), "utf8"), "new");
});

test("checkpoint: works in a brand-new repo with no commits, and refuses unknown ids", { skip: !gitAvailable() && "git not installed" }, () => {
  const dir = tmpdir();
  execFileSync("git", ["init", "-q"], { cwd: dir });
  assert.ok(createCheckpoint(dir, "empty"));
  fs.writeFileSync(path.join(dir, "made.txt"), "x");
  assert.deepEqual({ ...restoreCheckpoint(dir, "empty"), redoId: 0 }, { restored: 0, removed: 1, redoId: 0 });
  assert.throws(() => restoreCheckpoint(dir, "nope"), /no saved copy/);
  assert.equal(createCheckpoint(tmpdir(), "not-a-repo"), null);
});

// ---------- health ----------
test("health: parses `claude auth status --json`", () => {
  assert.deepEqual(parseAuthStatus('{"loggedIn": true, "authMethod": "oauth_token"}'), { loggedIn: true, method: "oauth_token" });
  assert.equal(parseAuthStatus('{"loggedIn": false}').loggedIn, false);
  assert.equal(parseAuthStatus("Not logged in. Run claude auth login").loggedIn, false);
  assert.equal(parseAuthStatus("").loggedIn, null);
});

// ---------- stream parser ----------
test("stream parser: text, models (incl. subagents), session, result", () => {
  const seen = { text: "", models: [], session: null };
  const p = createStreamParser({ onText: (t) => (seen.text = t), onModel: (m, a) => seen.models.push([m, a]), onSession: (s) => (seen.session = s) });
  const ev = (o) => JSON.stringify(o) + "\n";
  const chunk =
    ev({ type: "system", subtype: "init", model: "claude-x", session_id: "S1" }) +
    ev({ type: "stream_event", event: { type: "message_start", message: { model: "claude-x" } } }) +
    ev({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } } }) +
    ev({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } } }) +
    ev({ type: "assistant", message: { model: "claude-x", content: [{ type: "tool_use", id: "tu1", name: "Agent", input: { subagent_type: "architect" } }] } }) +
    ev({ type: "assistant", parent_tool_use_id: "tu1", message: { model: "claude-opus-y", content: [] } }) +
    ev({ type: "result", result: "done", session_id: "S1" });
  p.push(chunk.slice(0, 50));
  p.push(chunk.slice(50));
  assert.equal(p.end().result, "done");
  assert.equal(seen.text, "Hello");
  assert.equal(seen.session, "S1");
  assert.deepEqual(seen.models, [["claude-x", null], ["claude-opus-y", "architect"]]);
});
