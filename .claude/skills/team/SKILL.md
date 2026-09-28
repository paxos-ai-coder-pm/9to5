---
name: team
description: Run the full agent team pipeline (architect → dev-1 + dev-2 → tester-api + tester-ui + tester-edge → reviewer) on a feature or bug fix, with live progress in the pixel team office. Use when the user says /team <task> or asks to "use the team".
---

# Team pipeline

The task is: $ARGUMENTS

You (the main session) are the orchestrator. Subagents cannot spawn each other, so you pass context between them. Give every agent the full text it needs — they start with no memory of this conversation.

**Progress tracking.** Every step below updates the team office via `node tools/team-office/team.mjs …` (run from the repo root; `T` below is shorthand for that). The office UI is the `team-office` entry in `.claude/launch.json` (http://localhost:4400). Set an agent to `working` right before spawning it, and to `done` / `failed` when its report comes back. If context gets compacted mid-run, run `T resume` to recover the active / ready / blocked work.

**User chat.** The user can talk to the `manager` agent from the office's chat box (text or voice); instructions they give there are queued in an inbox. **At every phase boundary** (before spawning each wave of agents) run `T inbox` and apply what it prints: pass relevant instructions into the next agents' prompts, and adjust the plan if needed. Acknowledge anything you act on with `T say manager "<short note>"`. Also use `T say <agent> "…"` to tell the user about milestones (plan ready, tests failed, review verdict).

## 0. Start
- `T init "<one-line task summary>"`
- Start the office with preview_start `{name: "team-office"}` so the user can watch.

## 1. Plan
`T phase plan` · `T agent architect working "Exploring the codebase"` · spawn `architect` with the task.
When it returns:
- Save its "Execution graph" JSON block to `.claude/team/graph.json`, then `T tasks .claude/team/graph.json` (fix and retry if it reports an unknown dependency).
- `T agent architect done "Plan ready"`.
- If it lists OPEN QUESTIONS, ask the user (AskUserQuestion) before continuing.
- Show the user a short summary of the plan and wait for a go-ahead. Also `T say architect "Plan ready: <n> tasks. <one-line summary>"` so it shows in the chat.

## 2. Build (parallel)
`T phase build` · `T agent dev-1 working "Starting package A"` · `T agent dev-2 working "Starting package B"`.
In a single message, spawn `dev-1` and `dev-2`, each with the full plan text (including the execution graph). They update their own tasks. Wait for both, then mark each `done` (or `failed` with the reason).
- If either reports it needs a file owned by the other, sequence that change (have the owner make it), then continue.
- Run `npx tsc --noEmit` yourself to confirm the combined result compiles.

## 3. Test (parallel)
`T phase test`. Make sure the dev server is running (preview_start `{name: "merage-hub"}`). For each tester: `T task <its task id> start` and `T agent <tester> working "…"`. Then in a single message spawn `tester-api`, `tester-ui`, and `tester-edge`, each with: the plan, both dev reports, and the server URL.
When each returns: PASS → `T task <id> done` + `T agent <tester> done "<n>/<n> PASS"`; FAIL → `T task <id> block "<top failure>"` + `T agent <tester> failed "<top failure>"`.

## 4. Fix loop
If any tester reports FAIL: `T phase fix`, set the owning dev to `working "Fix: …"` and the tester to `waiting`. Send the failures to the owning dev (via SendMessage if still available, otherwise a new spawn with the plan + failure report), then `T task <id> reset` and re-run only the testers that failed. Max 2 loops — after that, stop and report to the user.

## 5. Review
`T phase review` · `T task <review task id> start` · `T agent reviewer working "Reviewing the diff"` · spawn `reviewer` with the plan, dev reports, and final tester reports.
- REQUEST CHANGES → `T agent reviewer failed "<top issue>"`, route issues to the owning dev (phase `fix`), re-test affected areas, re-review (max 2 loops).
- APPROVE → `T task <id> done` · `T agent reviewer done "APPROVE"` · `T phase done`.

## 6. Report to the user
Files changed, test verdicts, review verdict, and anything left open. Do not commit unless the user asks.
