---
name: team
description: Run the full agent team pipeline (architect → dev-1 + dev-2 → tester-api + tester-ui + tester-edge → reviewer) on a feature, bug fix, or new project, with live progress in the pixel team office. Use when the user says /team <task> or asks to "use the team".
---

# Team pipeline

The task is: $ARGUMENTS

You (the main session) are the orchestrator. Subagents cannot spawn each other, so you pass context between them. Give every agent the full text it needs — they start with no memory of this conversation. The project is the current working directory.

**Progress tracking.** Every step below updates the team office. `T` below means `node tools/team-office/team.mjs` — run it exactly like that, from the project directory. The office UI is http://localhost:4400 (the `team-office` entry in the dev-studio repo's `.claude/launch.json`). Set an agent to `working` right before spawning it, and to `done` / `failed` when its report comes back. If context gets compacted mid-run, run `T resume` to recover the active / ready / blocked work.

**User chat.** The user talks to the `manager` agent from the office's chat box; instructions they give there are queued in an inbox. **At every phase boundary** (before spawning each wave of agents) run `T inbox` and apply what it prints: pass relevant instructions into the next agents' prompts, and adjust the plan if needed. Acknowledge anything you act on with `T say manager "<short note>"`. Also use `T say <agent> "…"` to tell the user about milestones (plan ready, tests failed, review verdict) — in plain words.

**Discipline (applies to every spawn).** The team works from playbooks in `.claude/playbooks/` (index: `README.md`). Every prompt you give a teammate must include: (1) "Read `.claude/playbooks/_core.md` and these playbooks: <the plan's Playbooks list>", (2) the plan's **Definition of done**, and (3) the relevant lessons from `T lessons`. Teammates must report *evidence* (commands run + results) — send back any report that claims success without it.

**Who it's for.** Unless the task says the user is a developer, they aren't: every teammate also reads `.claude/playbooks/for-non-developers.md`, and "done" means they can open it with one click and use it.

## Team size
The run's size comes from the launch note (`Team size: …`) or the task; if neither says, the architect picks one in its plan. Use the smallest size that keeps the work safe:
- **quick** — a small change to something that exists (text, colors, one feature on one screen). Architect (a short plan, 1–4 tasks, package A only) → `dev-1` → `tester-ui` *or* `tester-api` (whichever fits) → verification gate → `reviewer`. Skip dev-2 and the other testers.
- **standard** (default) — a new small app or a normal feature. Architect → dev-1 + dev-2 → the testers that have something to test (no API → no `tester-api`; nothing that takes input or stores personal data → no `tester-edge`) → review.
- **full** — anything with logins, payments, personal or sensitive data, or files on the user's computer: every teammate, including `tester-edge`.

Mark skipped teammates' tasks out of the graph (don't create tasks for them) so progress stays accurate.

## Headless mode
If you were launched from the team office (the prompt says so), the user is *not* watching this terminal:
- Never use AskUserQuestion or wait for terminal input. To ask the user something that needs an answer (open questions, plan approval), use `T ask <agent> "<question>"`, adding `--options "A|B|C"` whenever the answer is one of a few choices (they get one button per option). Then wait with `T wait` (it returns as soon as they answer, or after ~2 minutes with "No answer yet"); repeat it for up to 30 minutes. If nothing arrives, `T say manager "Pausing — I'll carry on as soon as you answer."` and stop **without** changing the phase: the office sees the open question and resumes this session with the user's answer when it arrives. Use `T say` only for updates that need no reply.
- Browser/preview tools may be unavailable; don't try to start servers with preview_start. Testers fall back to curl, scripts, and code review.

## 0. Start
- `T init "<one-line task summary, in plain words>"`
- Interactive sessions only: start the office with preview_start `{name: "team-office"}` so the user can watch.

## 1. Plan
`T phase plan` · `T agent architect working "Working out the plan"` · spawn `architect` with the task and the team size.
When it returns:
- Save its "Execution graph" JSON block to `.claude/team/graph.json` (in the project directory), then `T tasks .claude/team/graph.json` (fix and retry if it reports an unknown dependency).
- `T agent architect done "Plan ready"`.
- If it lists OPEN QUESTIONS, ask the user (AskUserQuestion interactively; `T ask … --options` in headless mode) before continuing.
- Check the plan has **What you'll get**, **Playbooks** and **Definition of done** sections; if not, send it back to the architect.
- Get the user's go-ahead, written for someone who isn't a developer (no stack names, file paths or jargon up front):
  `T ask architect "Here's the plan. What you'll get: <2–3 plain bullets>. How you'll use it: <one sentence, e.g. 'click ▶ Open and it opens in your browser'>. Not in this first version: <1–2 items, or 'nothing important'>. <n> parts, about <m> minutes." --options "Looks good — build it|I'd like changes"`
  then wait for the answer (interactive: ask directly; headless: `T wait`). "I'd like changes" or any other reply → revise the plan with the architect and ask again. If the user's request to start the run already said to proceed without plan review, skip the wait.

## 2. Build (parallel)
`T phase build` · `T agent dev-1 working "Starting package A"` · `T agent dev-2 working "Starting package B"` (quick size: dev-1 only).
In a single message, spawn `dev-1` and `dev-2`, each with the full plan text (including the execution graph). They update their own tasks. Wait for both, then mark each `done` (or `failed` with the reason).
- If either reports it needs a file owned by the other, sequence that change (have the owner make it), then continue.
- Run the project's static checks yourself (type-check / lint / build) to confirm the combined result is sound.

## 3. Test (parallel)
`T phase test`. If the project is a web app, make sure its dev server is running (interactive: preview_start; headless: tell testers to report if it's down). For each tester the size calls for: `T task <its task id> start` and `T agent <tester> working "…"`. Then in a single message spawn them, each with: the plan, the dev reports, and how to run the project.
When each returns: PASS → `T task <id> done` + `T agent <tester> done "<n>/<n> PASS"`; FAIL → `T task <id> block "<top failure>"` + `T agent <tester> failed "<top failure>"`.

## 4. Fix loop
If any tester reports FAIL: `T phase fix`, set the owning dev to `working "Fix: …"` and the tester to `waiting`. Send the failures to the owning dev (via SendMessage if still available, otherwise a new spawn with the plan + failure report), then `T task <id> reset` and re-run only the testers that failed. Max 2 loops — after that, stop and report to the user.

## 4b. Deliver
Make sure the project can be opened with one click (see `for-non-developers.md` §4): `devstudio.json`, `START-HERE.md`, and start files where needed are part of the plan's tasks. Run `T deliver` in the project directory and fix every problem it prints (have the owning dev do it). A web app must start with its `start` command on the port in `$PORT`. This is part of the Definition of done.

## 4c. Verification gate (before review)
Run every command in the plan's **Definition of done** yourself and read the output. Any failure → back to the fix loop, not review. Only a green gate goes to the reviewer; include the gate's commands and results (and the `T deliver` output) in the reviewer's prompt.

## 5. Review
`T phase review` · `T task <review task id> start` · `T agent reviewer working "Checking everything"` · spawn `reviewer` with the plan, dev reports, and final tester reports.
- REQUEST CHANGES → `T agent reviewer failed "<top issue>"`, route issues to the owning dev (phase `fix`), re-test affected areas, re-review (max 2 loops).
- APPROVE → `T task <id> done` · `T agent reviewer done "APPROVE"` · `T phase done`.

## 6. Remember
Make sure this run left at least one specific lesson (`T lessons` to check; the reviewer normally records them). If the run hit a problem that cost a fix loop, record its root cause with `T lesson "…"` — future runs start by reading these.

## 7. Report to the user
Write a plain-language report as JSON — `{ "summary": "…", "got": […], "howToOpen": […], "notYet": […], "next": […] }` (one sentence; then short lists in the user's words: what they got, how to open it, what isn't in this version, ideas for next time) — save it as `.claude/team/report.json` and post it with `T report .claude/team/report.json`. Interactively, also give the technical summary in your reply: files changed, test verdicts, review verdict, verification-gate results. Never commit or push unless the user asks.
