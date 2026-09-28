# Vikrant's Dev Studio

An 8-agent software team for [Claude Code](https://claude.com/claude-code), plus an 8-bit pixel-art office where you can watch them work and chat with their manager.

```
architect ─▶ dev-1 ┐          ┌▶ tester-api  ┐
             dev-2 ┘ (parallel)├▶ tester-ui   ├─▶ reviewer
                               └▶ tester-edge ┘
                 manager ◀──▶ you (chat / voice)
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

The agent prompts are currently tuned for a Next.js 16 + Prisma + shadcn/ui app (Merage Hub) — edit the stack notes in `.claude/agents/*.md` for other projects.

## The pipeline: `/team <task>`

The `/team` skill (`.claude/skills/team/SKILL.md`) runs PLAN → BUILD → TEST → FIX loop (max 2) → REVIEW → DONE. You approve the plan before any code is written. Nothing is committed unless you ask.

## The office

`tools/team-office` is a zero-dependency Node server + canvas UI (http://localhost:4400):

- **Pixel office** — each agent is a character with its own desk; they walk from the lounge to their desk when they start work, type, and show what they're doing in speech bubbles. The whiteboard shows one sticky note per task.
- **Progress** — phase tracker, % of tasks done, a dependency graph of the plan (status shown by icon + label), a Gantt-style agent timeline, and a live activity log.
- **Manager chat** — type or talk (🎤, Web Speech API in Chrome/Edge), the manager speaks replies aloud with a talking animation in the office (🔊 to mute, ▶ to replay a message; always on when you use the mic). The manager gets a live snapshot of the team with each message. Instructions are queued in an inbox that `/team` reads at every phase boundary; the team can post back to you with `team.mjs say`.
- **Human-like voice** — the manager speaks with [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) (Apache-2.0) running on-device in the browser via kokoro-js (multi-threaded WASM; the server sends cross-origin-isolation headers to enable threads). The ~92 MB model downloads once from Hugging Face and is cached. Voices: Hindi male (default: English spoken in an Indian voice), US/UK male & female, or the instant system voice as fallback.
- **Demo** — click *Watch demo* (or open `/?demo`) to see a simulated run.

The execution graph uses [AmnesiaGraph](https://github.com/turio/AmnesiaGraph)'s normalized task format (`id`, `order`, `title`, `source`, `depends_on`, `verify`) plus an `owner` field, so the same file can be fed to `amnesia init`.

## Install into a project

1. Copy `.claude/agents/`, `.claude/skills/team/` and `tools/team-office/` into your repo.
2. Add `/.claude/team/` to `.gitignore` (run state lives there).
3. Add the office to `.claude/launch.json` (see the one in this repo), or run it directly:
   ```bash
   node tools/team-office/server.mjs 4400
   ```
4. Restart Claude Code, then run `/team <what you want built>`.

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
inbox                                 print + mark read the user's instructions
resume                                recover active / ready / blocked work after a context reset
```

`task <id> verify` runs the task's `verify` commands and marks it done, or blocked with the failing command. Writes are serialized with a lock, so parallel agents can report safely.
