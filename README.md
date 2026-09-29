# Vikrant's Dev Studio

An 8-agent software team for [Claude Code](https://claude.com/claude-code), plus an 8-bit pixel-art office where you can watch them work and chat with their manager.

```
architect ─▶ dev-1 ┐          ┌▶ tester-api  ┐
             dev-2 ┘ (parallel)├▶ tester-ui   ├─▶ reviewer
                               └▶ tester-edge ┘
                 manager ◀──▶ you (chat)
```

## The team

| Agent | Role | Model |
|---|---|---|
| `architect` | Explores the code, writes the plan: two non-overlapping work packages, a test plan, acceptance criteria and an execution graph. Read-only. | Opus |
| `dev-1`, `dev-2` | Implement work packages A and B in parallel; only touch their own files. | Sonnet |
| `tester-api` | Route handlers / server logic via curl and scratch scripts. | Sonnet |
| `tester-ui` | End-to-end flows in the browser, console/network errors, responsive layout. | Sonnet |
| `tester-edge` | Security & edge cases: authz, IDOR, injection, validation, info leaks. | Sonnet |
| `reviewer` | Final gate: reviews the diff against the plan and test results → APPROVE / REQUEST CHANGES. Read-only. | Opus |
| `manager` | Your point of contact. Answers questions about progress in plain language and relays your instructions to the team. Read-only. | Sonnet |

The agents are stack-agnostic: they detect the project's stack (with extra notes for Next.js and Manifest V3 browser extensions), and the architect picks a stack for new projects.

## The pipeline: `/team <task>`

The `/team` skill (`.claude/skills/team/SKILL.md`) runs PLAN → BUILD → TEST → FIX loop (max 2) → REVIEW → DONE. You approve the plan before any code is written. Nothing is committed unless you ask.

## The office

`tools/team-office` is a zero-dependency Node server + canvas UI (http://localhost:4400):

- **Pixel office** — each agent is a character with its own desk; they walk from the lounge to their desk when they start work, type, and show what they're doing in speech bubbles. The whiteboard shows one sticky note per task.
- **Progress** — phase tracker, % of tasks done, a dependency graph of the plan (status shown by icon + label), a Gantt-style agent timeline, and a live activity log.
- **Manager chat** — type (or dictate with 🎤 in Chrome/Edge) to talk to the manager, who gets a live snapshot of the team with each message. Instructions are queued in an inbox that `/team` reads at every phase boundary; the team can post back to you with `team.mjs say`.
- **The manager starts the team** — describe what you want; the manager scopes it, decides where it goes (Merage Hub, an existing sibling project, or a new sibling folder), and proposes a run. Confirm with ▶ Start (or just say "go") and the office launches `/team` headlessly (`claude -p`) in that folder. Plan approval and questions come back through the chat; ■ Stop kills the run. Background runs can edit files inside the project folder and run node/npm/npx/curl/read-only git — never commit or push. Logs: `.claude/team/runs/`.
- **Live typing & models** — the manager's reply streams into the chat as it's written; every agent card (plus the team lead) shows its model — the configured alias until a run reports the exact model ID from the stream.
- **Survives usage limits** — if a run hits the Claude usage limit it pauses (⏳ in the chat) and automatically resumes the *same session* right after the limit resets (reset time taken from the CLI's rate-limit events), continuing where it left off; repeats across resets (max 20). The pause survives an office restart; ■ Stop cancels it.
- **Per-run GitHub permission** — runs can't commit or push by default. When you ask to publish, the manager proposes the run with `ALLOW: github`; the card shows 🔓 and the gh account, and ▶ Start grants commit/`gh repo create`/push for that run only. Force-push, history rewrites, repo deletion and `rm` are always blocked. Requires `gh auth login`.
- **Demo** — click *Watch demo* (or open `/?demo`) to see a simulated run.

The execution graph uses [AmnesiaGraph](https://github.com/turio/AmnesiaGraph)'s normalized task format (`id`, `order`, `title`, `source`, `depends_on`, `verify`) plus an `owner` field, so the same file can be fed to `amnesia init`.

## Playbooks: disciplined agents with broad stack coverage

A small, focused library instead of dozens of agents: `.claude/playbooks/` (~500 lines total).

- **`_core.md`** — rules every agent follows: research the installed version before using an API, change small and verify each step, evidence before claims (quote the command + output), fix root causes, no destructive actions, honest reports, record lessons.
- **Practices** — `testing`, `review`, `security`, `debugging`, `api-design`, `database`, `frontend` (a11y/UX), `devops`, `llm-apps`.
- **Stacks** — TypeScript/Node, React/Next.js (+Vue, Angular, Svelte), Python (Django/FastAPI/Flask), Go, Java/Kotlin (Spring, Ktor, Android), C#/.NET, Rust, Swift/iOS, Flutter/React Native/KMP, C/C++, PHP/Laravel & Ruby/Rails, browser extensions.
- **The pipeline enforces it:** the architect's plan must name the playbooks and a *Definition of done* (exact commands); every teammate reads them; a **verification gate** runs those commands before review.
- **Memory:** `T lesson "…"` records project lessons (`.claude/lessons.md`) or global ones (`--global`); `T lessons` is read at the start of every run, so mistakes aren't repeated.

## Friendlier office

- Plain-English **status line** ("Building — 3 of 11 tasks done · dev-1: popup UI").
- **Needs-your-answer banner**: when the team asks something (`T ask`), a yellow banner + chat buttons let you **✓ Approve** or **✎ Reply** in one click — answers go straight to the team.
- **Context-aware quick replies** in the chat; manager replies render basic formatting.
- **Projects** tab (every run, folder path, "how to try it") and **Lessons** tab.
- **My Projects** panel — one card per project: status (built / in progress / paused / needs attention), GitHub link with public/private, last commit, uncommitted/unpushed changes, and quick actions (copy path, how to try, publish, push changes).
- **Welcome card** with example requests, **?** help on every panel, optional **desktop notifications** (🔔) and a (❓) tab-title badge.
- **📱 Phone (Telegram)** — talk to the manager from anywhere. Create a bot with @BotFather, paste its token in the 📱 panel, tap the one-time pairing link on your phone. Your messages go to the manager; replies, team questions (✓ Approve / ✎ Reply buttons), proposals (▶ Start) and run updates come to your phone. `/status`, `/stop`, `/help`. Long-polling only (no public URL); private to the paired account; token stored in `.claude/team/telegram.json` (gitignored).

## Install into a project

1. Copy `.claude/agents/`, `.claude/skills/team/`, `.claude/playbooks/` and `tools/team-office/` into your repo.
2. Add `/.claude/team/` to `.gitignore` (run state lives there).
3. Add the office to `.claude/launch.json` (see the one in this repo), or run it directly:
   ```bash
   node tools/team-office/server.mjs 4400
   ```
4. Restart Claude Code, then run `/team <what you want built>`.

**Quick launcher (Windows):** run `bin/devstudio.cmd` from the repo, or copy `bin/devstudio.cmd` and `bin/devstudio` into a folder on your PATH (e.g. `~/.local/bin`) and change `STUDIO` in the .cmd from `%~dp0..` to this repo's full path. Then `devstudio` starts the office and opens it, `devstudio stop` stops it, `devstudio status` checks it.

The office calls the `claude` CLI, so it must be signed in (`claude` → `/login`). It strips stale non-Claude model overrides from its environment when talking to Anthropic.

Requires Node 18+. Manager chat shells out to the `claude` CLI (`claude -p --agent manager`), so the CLI must be installed and logged in for the environment the server runs in; set `CLAUDE_BIN` to point at a specific binary.

## Progress CLI

Agents and the orchestrator report progress with `node tools/team-office/team.mjs`:

```text
init "<task>"                         start a new run
phase <plan|build|test|fix|review|done>
agent <name> <idle|working|waiting|done|failed> ["activity"]
tasks <graph.json>                    load the execution graph
task <id> <start|done|block|reset|verify> ["reason"]
log <agent> "<msg>"                   activity log entry
say <agent> "<msg>"                   post a message into the user's chat
ask <agent> "<question>"            ask the user something (banner + Approve/Reply)
lesson "<text>" [--global]           remember something for future runs
lessons                               print project + global lessons
inbox                                 print + mark read the user's instructions
resume                                recover active / ready / blocked work after a context reset
```

`task <id> verify` runs the task's `verify` commands and marks it done, or blocked with the failing command. Writes are serialized with a lock, so parallel agents can report safely.
