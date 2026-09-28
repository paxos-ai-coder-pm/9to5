---
name: team
description: Run the full agent team pipeline (architect → dev-1 + dev-2 → tester-api + tester-ui + tester-edge → reviewer) on a feature, bug fix, or new project, with live progress in the pixel team office. Use when the user says /team <task> or asks to "use the team".
---

# Team pipeline

The task is: $ARGUMENTS

You (the main session) are the orchestrator. Subagents cannot spawn each other, so you pass context between them. Give every agent the full text it needs — they start with no memory of this conversation. The project is the current working directory.

**Progress tracking.** Every step below updates the team office. `T` below means `node "${TEAM_CLI:-tools/team-office/team.mjs}"` — run it exactly like that, from the project directory. The office UI is http://localhost:4400 (the `team-office` entry in the dev-studio repo's `.claude/launch.json`). Set an agent to `working` right before spawning it, and to `done` / `failed` when its report comes back. If context gets compacted mid-run, run `T resume` to recover the active / ready / blocked work.

**User chat.** The user talks to the `manager` agent from the office's chat box; instructions they give there are queued in an inbox. **At every phase boundary** (before spawning each wave of agents) run `T inbox` and apply what it prints: pass relevant instructions into the next agents' prompts, and adjust the plan if needed. Acknowledge anything you act on with `T say manager "<short note>"`. Also use `T say <agent> "…"` to tell the user about milestones (plan ready, tests failed, review verdict).

**Headless mode.** If you were launched from the team office (the prompt says so), the user is *not* watching this terminal:
- Never use AskUserQuestion or wait for terminal input. To ask the user something (open questions, plan approval), post it with `T say <agent> "<question>"`, then check `T inbox` every 30 seconds (`sleep 30` between checks) for up to 30 minutes. The manager relays the user's answers into the inbox. If nothing arrives, `T say manager "Pausing — I need your answer to continue."`, `T phase done`, and stop.
- Browser/preview tools may be unavailable; don't try to start servers with preview_start. Testers fall back to curl, scripts, and code review.

## 0. Start
- `T init "<one-line task summary>"`
- Interactive sessions only: start the office with preview_start `{name: "team-office"}` so the user can watch.

## 1. Plan
`T phase plan` · `T agent architect working "Exploring the codebase"` · spawn `architect` with the task.
When it returns:
- Save its "Execution graph" JSON block to `.claude/team/graph.json` (in the project directory), then `T tasks .claude/team/graph.json` (fix and retry if it reports an unknown dependency).
- `T agent architect done "Plan ready"`.
- If it lists OPEN QUESTIONS, ask the user (AskUserQuestion interactively; the chat in headless mode) before continuing.
- Get the user's go-ahead on the plan: `T say architect "Plan ready: <n> tasks. <2–3 sentence summary incl. stack and where the files go>. Reply 'go' to start building."`, then wait for approval (interactive: ask directly; headless: poll `T inbox`). If the user's request to start the run already said to proceed without plan review, skip the wait.

## 2. Build (parallel)
`T phase build` · `T agent dev-1 working "Starting package A"` · `T agent dev-2 working "Starting package B"`.
In a single message, spawn `dev-1` and `dev-2`, each with the full plan text (including the execution graph). They update their own tasks. Wait for both, then mark each `done` (or `failed` with the reason).
- If either reports it needs a file owned by the other, sequence that change (have the owner make it), then continue.
- Run the project's static checks yourself (type-check / lint / build) to confirm the combined result is sound.

## 3. Test (parallel)
`T phase test`. If the project is a web app, make sure its dev server is running (interactive: preview_start; headless: tell testers to report if it's down). For each tester: `T task <its task id> start` and `T agent <tester> working "…"`. Then in a single message spawn `tester-api`, `tester-ui`, and `tester-edge`, each with: the plan, both dev reports, and how to run the project.
When each returns: PASS → `T task <id> done` + `T agent <tester> done "<n>/<n> PASS"`; FAIL → `T task <id> block "<top failure>"` + `T agent <tester> failed "<top failure>"`.

## 4. Fix loop
If any tester reports FAIL: `T phase fix`, set the owning dev to `working "Fix: …"` and the tester to `waiting`. Send the failures to the owning dev (via SendMessage if still available, otherwise a new spawn with the plan + failure report), then `T task <id> reset` and re-run only the testers that failed. Max 2 loops — after that, stop and report to the user.

## 5. Review
`T phase review` · `T task <review task id> start` · `T agent reviewer working "Reviewing the diff"` · spawn `reviewer` with the plan, dev reports, and final tester reports.
- REQUEST CHANGES → `T agent reviewer failed "<top issue>"`, route issues to the owning dev (phase `fix`), re-test affected areas, re-review (max 2 loops).
- APPROVE → `T task <id> done` · `T agent reviewer done "APPROVE"` · `T phase done`.

## 6. Report to the user
Files changed, test verdicts, review verdict, how to run/try the result, and anything left open — interactively in your reply, and in headless mode as `T say manager "<short summary>"`. Never commit or push unless the user asks.
