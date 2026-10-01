# Vikrant's Dev Studio

A software team you can talk to. Tell the manager what you'd like in plain words — *"a monthly budget tracker for my household"* — approve the plan with one click, watch the team build it in an 8-bit pixel office, then press **▶ Open** to use it. No coding needed.

Under the hood it's an 8-agent team for [Claude Code](https://claude.com/claude-code):

```
architect ─▶ dev-1 ┐          ┌▶ tester-api  ┐
             dev-2 ┘ (parallel)├▶ tester-ui   ├─▶ reviewer
                               └▶ tester-edge ┘
                 manager ◀──▶ you (chat)
```

## Get started (no coding needed)

You need two things on your computer:

1. **Node.js** (version 20 or newer) — download it from [nodejs.org](https://nodejs.org) and install it like any app.
2. **Claude Code**, signed in to your Claude account — [install it](https://claude.com/claude-code), then open a terminal (Windows: PowerShell · Mac: Terminal) once and run `claude auth login`.

Then start the studio:

- **Windows:** double-click `bin\devstudio.cmd`.
- **Mac:** double-click `bin/Dev Studio.command` (the first time: right-click → Open).
- **Linux / from a terminal:** `bin/devstudio` (also `devstudio stop` and `devstudio status`).

Your browser opens the office at http://localhost:4400. If anything is missing, a **setup checklist** at the top says exactly what to do (with a Copy button for any command). Git and GitHub are optional — Git enables **Undo**, GitHub enables publishing.

## Using it

1. **Tell Maya, the manager, what you want** in the chat — or tap one of the examples. She asks a couple of quick questions you can answer with a tap, then shows what she understood.
2. **Press ▶ Start** on her card. The team posts a plan in plain words — *what you'll get, how you'll use it, what's not in this first version* — and waits for **Looks good — build it**.
3. **Watch** the "Right now" card: five steps (Planning → Building → Checking → Final check → Ready), how many parts are done, and about how long is left. You can close the browser; the 🔔 button notifies you when the team needs you or finishes, and 📱 lets you answer from your phone.
4. **Press ▶ Open.** The project opens in your browser (or shows its steps, for things like browser extensions). A plain report says what you got and what could come next.
5. **Change it any time** with **✎ Change something**, and **↶ Undo** any change from the project's history.

If something goes wrong, the chat says what happened in plain words and offers **↻ Continue** (pick up where it stopped), **↻ Try again**, or **What happened?**. Nothing is lost when the office is closed, the computer sleeps, or your Claude plan hits its usage limit — the run pauses and continues.

## What's in the office

- **Simple view (default)** — the "Right now" card, the pixel office with friendly teammate names (Asha plans, Ben and Chloe build, Diego, Emma and Farid check, Grace does the final check, Maya is your manager), and **My Projects**. **Behind the scenes** switches to the full technical view: task graph, timeline, activity log, models, lessons.
- **My Projects** — one card per project with a picture of the result, **▶ Open** / **■ Close app**, **✎ Change something**, **↻ Continue**, and *More*: 📂 Show files, ⬇ Share a copy (zip — without secrets, git history or the studio's files), 🌐 Put it online (GitHub Pages, for projects that run in the browser), 📸 Update picture, Remove from list. *Changes* lists every run with **↶ Undo**.
- **Answer buttons** — questions from the team come with real choices (not just "Approve"); the manager's questions come with tap-to-answer suggestions.
- **One run at a time, with a queue** — ask for something else while the team is busy and it starts right after.
- **⚙ Settings** — the studio's name, where projects are saved (default `~/DevStudioProjects`), a *lighter team* (every teammate on Sonnet, to use less of your Claude plan), light/dark theme, and the setup checklist.
- **📱 Phone (Telegram)** — talk to the manager from anywhere. Create a bot with @BotFather, paste its token in the 📱 panel, scan the QR code with your phone. Replies, team questions (with answer buttons), proposals (▶ Start), run updates and ↻ Continue come to your phone. `/status`, `/stop`, `/help`. Long-polling only (no public URL); private to the paired account; token stored in `.claude/team/telegram.json` (gitignored).
- **Readable and accessible** — bundled fonts (no requests to Google; works offline), 17–24px text on every control, contrast ≥ 4.5:1 in both themes, keyboard-friendly dialogs and tabs, screen-reader announcements for new messages, little motion (none with *reduce motion*).
- **Demo** — *Watch a demo* (or `/?demo`) plays a pretend run.

## How the team builds for non-developers

Runs from the office follow `.claude/playbooks/for-non-developers.md`: the lightest thing that works (a static web page with browser storage before a server, nothing to install or sign up for), the user's data kept safe (a preview and an undo log before touching their files; export for what they type in), plain words on screen, and a project that opens with one click. Every project ends with:

- **`devstudio.json`** — how the office opens it (`static`, `web` with a start command that listens on `$PORT`, `script`, `extension`), plus how-to steps in plain words. The team checks it with `T deliver`.
- **`START-HERE.md`** and double-click start files, so it also works without the studio.
- A **plain-language report** (`T report`): what you got, how to open it, what's not in this version, ideas for next time.

The **team size** fits the job: *quick* (one builder, one checker — for small changes), *standard*, or *full* (with the security tester — for logins, payments, personal data or files on your computer). Proposal cards show the size and, once there's history, how long runs usually take.

## Safety

- New projects go into their own folder inside the projects folder, never among your own folders. If a project folder already has files the studio didn't make, the proposal card says so.
- Before each run on an existing project, the studio snapshots its files into a hidden git ref (your branch, staging area and history are untouched), so **↶ Undo** can put everything back — and undo the undo.
- Runs can't commit or publish unless you start a run whose card says it may (🔓, with the GitHub account named). Force-push, history rewrites and deleting repositories are always blocked.
- The office only answers to `localhost` (other websites can't drive it, even through DNS rebinding) and only accepts same-origin requests.
- **Be aware:** while it works, the team runs the programs a project needs (Node, Python, npm…), and those can do anything a program on your computer can do. The permission list steers the team; it isn't a sandbox. Only build things you'd be happy to run yourself.

## The team

| Agent | Name | Role | Model |
|---|---|---|---|
| `architect` | Asha | Explores the code, writes the plan: *what you'll get* in plain words, a size, two non-overlapping work packages, a test plan, acceptance criteria, delivery, and an execution graph with plain task titles. Read-only. | Opus |
| `dev-1`, `dev-2` | Ben, Chloe | Implement work packages A and B in parallel; only touch their own files. | Sonnet |
| `tester-api` | Diego | Route handlers / server logic via curl and scratch scripts. | Sonnet |
| `tester-ui` | Emma | End-to-end flows, and whether a first-time user can open and use it by following START-HERE.md. | Sonnet |
| `tester-edge` | Farid | Security & edge cases: authz, IDOR, injection, validation, info leaks, the user's data. | Sonnet |
| `reviewer` | Grace | Final gate: the diff against the plan, test results, and "usable by a non-developer" → APPROVE / REQUEST CHANGES. Read-only. | Opus |
| `manager` | Maya | Your point of contact: a quick brief with tap-to-answer questions, proposals, progress in plain language, relays your answers. Read-only. | Sonnet |

The agents are stack-agnostic: they detect the project's stack (with extra notes for Next.js and Manifest V3 browser extensions), and the architect picks a stack for new projects. With **Settings → Lighter team** every teammate runs on Sonnet.

## The pipeline: `/team <task>`

The `/team` skill (`.claude/skills/team/SKILL.md`) runs PLAN → BUILD → TEST → FIX loop (max 2) → DELIVER → verification gate → REVIEW → DONE → report. You approve the plan before any code is written. Nothing is committed unless you ask. You can also run `/team` directly in Claude Code; the office shows it live.

**Headless runs** (started from the office): questions go to the chat and wait with `T wait` (no model turns spent polling). A run pauses instead of ending when it's waiting for your answer, hits the usage limit, or the office closes — and continues in the *same session* (your answer, the limit's reset, or ↻ Continue). Logs: `.claude/team/runs/`.

## Playbooks: disciplined agents with broad stack coverage

A small, focused library instead of dozens of agents: `.claude/playbooks/`.

- **`_core.md`** — rules every agent follows: research the installed version before using an API, change small and verify each step, evidence before claims, fix root causes, no destructive actions, honest reports, record lessons.
- **`for-non-developers.md`** — building for someone who isn't a developer (above).
- **Practices** — `testing`, `review`, `security`, `debugging`, `api-design`, `database`, `frontend` (a11y/UX), `devops`, `llm-apps`.
- **Stacks** — TypeScript/Node, React/Next.js (+Vue, Angular, Svelte), Python (Django/FastAPI/Flask), Go, Java/Kotlin (Spring, Ktor, Android), C#/.NET, Rust, Swift/iOS, Flutter/React Native/KMP, C/C++, PHP/Laravel & Ruby/Rails, browser extensions.
- **The pipeline enforces it:** the plan must name the playbooks and a *Definition of done* (exact commands, including `T deliver`); a **verification gate** runs those commands before review.
- **Memory:** `T lesson "…"` records project lessons (`.claude/lessons.md`) or global ones (`--global`); `T lessons` is read at the start of every run.

## Install into another repo

1. Copy `.claude/agents/`, `.claude/skills/team/`, `.claude/playbooks/` and `tools/team-office/` into your repo.
2. Add `/.claude/team/` to `.gitignore` (run state lives there).
3. Add the office to `.claude/launch.json` (see the one in this repo), or run it directly: `node tools/team-office/server.mjs 4400`.
4. Restart Claude Code, then run `/team <what you want built>`.

The office calls the `claude` CLI (`claude -p --agent manager` for the chat, `claude -p "/team …"` for runs), so it must be installed and signed in for the environment the server runs in; set `CLAUDE_BIN` to point at a specific binary. It strips stale non-Claude model overrides from its environment when talking to Anthropic. `DEVSTUDIO_PROJECTS` overrides the projects folder; `DEVSTUDIO_PORT` the launcher's port; `DEVSTUDIO_CHROME` the browser used for project pictures (set it empty for no pictures).

**Upgrading from an older version:** new projects now go to `~/DevStudioProjects` instead of next to this repo. Projects you already built keep working from their old folders (they're found through the run history). To keep creating projects next to this repo, set **⚙ Settings → Where projects are saved** to this repo's parent folder.

## Progress CLI

Agents and the orchestrator report progress with `node tools/team-office/team.mjs` (`T` in the skill):

```text
init "<task>"                         start a new run
phase <plan|build|test|fix|review|done>
agent <name> <idle|working|waiting|done|failed> ["activity"]
tasks <graph.json>                    load the execution graph (tasks may carry a "plain" title)
task <id> <start|done|block|reset|verify> ["reason"]
log <agent> "<msg>"                   activity log entry
say <agent> "<msg>"                   post a message into the user's chat
ask <agent> "<question>" [--options "A|B|C"]   ask the user (banner + answer buttons)
inbox                                 print + mark read the user's instructions
wait [--timeout <sec>]                like inbox, but waits (default 110 s) until the user answers
deliver [devstudio.json]              check "how to open it", so the user gets an ▶ Open button
report <report.json>                  post the plain-language final report
lesson "<text>" [--global]            remember something for future runs
lessons                               print project + global lessons
resume                                recover active / ready / blocked work after a context reset
```

`task <id> verify` runs the task's `verify` commands and marks it done, or blocked with the failing command; commands that delete, push, publish or need admin rights are refused. Writes are serialized with a lock, so parallel agents can report safely.

## Development

Zero dependencies. `npm test` runs the unit, CLI, project/app and integration tests (the integration tests drive the real server against a fake `claude` in `tools/team-office/test/fake-claude.mjs`); `npm run test:ui` runs the browser tests (needs Playwright: `npm install --no-save playwright && npx playwright install chromium`); `npm run check` syntax-checks every file. CI runs them on Linux, macOS and Windows (`.github/workflows/test.yml`).
