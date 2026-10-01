# Making Dev Studio work for non-developers

A review of the whole studio (office UI, server, runner, agents, skill, playbooks) from one point of view: **a normal person who can describe what they want, but has never used a terminal, doesn't know what Next.js or git is, and can't read code.**

Their journey has seven steps. Today the studio is strong in the middle (describe → approve → watch) and weak at both ends (installing it, and *using* what was built):

| Step | Today | Verdict |
|---|---|---|
| 1. Install & start | Node + Claude CLI + `claude auth login` in a terminal; launcher is Windows-only | ❌ blocks most people |
| 2. Describe the idea | Chat with the manager, example chips | ✅ good, could guide better |
| 3. Approve the plan | Yellow banner + ✓ Approve | ✅ good, plan text is technical |
| 4. Wait | Pixel office, graph, Gantt, log, 9 agent cards | ⚠️ delightful but overwhelming, full of jargon |
| 5. **Use the result** | "✅ Run finished — Files are in C:\…\my-app" | ❌ the biggest gap |
| 6. Change it | Tell the manager → a full 8-agent run again | ⚠️ slow for small tweaks |
| 7. Share it | Publish to GitHub (a developer's idea of sharing) | ⚠️ |

## Status (implemented on this branch)

| Area | Status |
|---|---|
| Bug fixes (Stop on macOS/Linux, false "finished", stale inbox, DNS rebinding / crash, Merage Hub alias, Node 18 `crypto` crash) | ✅ done, tested |
| P0 "Built" → "I can use it": `devstudio.json` + `T deliver`, ▶ Open (static / web on `$PORT` / script / how-to), launch page, 📂 Show files, screenshot, plain report card (`T report`), START-HERE + start files in the playbook | ✅ done, tested (office side); the team's side is instructions — not yet exercised with a real model run |
| P0 Simple view by default, friendly names, plain steps, "Right now" card, FIX only when it happens, Behind the scenes toggle | ✅ done, tested |
| P0 Setup checklist, instant "not signed in" answer, macOS/Linux launcher, `Dev Studio.command` | ✅ done, tested · ◐ no desktop-app wrapper or `npx devstudio` yet |
| P1 Guided brief (CHOICES buttons), plain-language plan approval, `T ask --options` | ✅ done, tested (UI + CLI); the manager/lead wording is instructions |
| P1 Team sizes, lighter team, `T wait`, time estimates | ✅ done, tested · ◐ lighter team can't change the reviewer/architect model for runs on the studio itself (its agent files are the originals) |
| P1 Non-developer playbook + agent instructions | ✅ written |
| P1 Dedicated projects folder, foreign-folder warning, safe seeding, checkpoints + ↶ Undo / ↷ Redo, verify-command guard, gh deny fix | ✅ done, tested |
| P1 ↻ Continue, ↻ Try again, friendly failures, queue | ✅ done, tested |
| P1 Readability & accessibility (bundled fonts, sizes, contrast, motion, light theme, dialogs, tabs, live region) | ✅ done, tested (contrast computed, keyboard paths in browser tests) |
| P2 ✎ Change something, 🌐 Put it online (GitHub Pages via a publishing run), ⬇ Share a copy, history + undo, Remove from list | ✅ done · ◐ "Put it online" not tested against real GitHub; server apps can't use Pages |
| P2 Phone QR code | ✅ done · ◐ PIN-protected phone web view not done |
| P2 Tests + CI, top-level error handler, configurable name | ✅ 94 tests (unit, CLI, projects/apps, integration with a fake `claude`, browser) + GitHub Actions on Linux/macOS/Windows |

Still open: a real end-to-end run with Claude to tune the new agent instructions; starting an npm-installed `claude.cmd` on Windows (the office currently needs the Windows installer's `claude.exe`); a desktop wrapper / `npx devstudio`; hosting for apps that need a server; a sandboxed mode for untrusted work.

---

## ✅ Fixed first (before the roadmap work)

These were verified bugs (reproduced before the fix, re-tested after with a fake `claude` binary). Each one broke a non-developer's experience directly.

| Problem | Effect for the user | Fix |
|---|---|---|
| **■ Stop did nothing on macOS/Linux.** `killTree` sends `kill(-pid)`, but the run wasn't its own process group → `ESRCH`, swallowed. | "Stopped" in the UI while the team kept editing files and using up the plan. | Runs spawn `detached` (own process group) on POSIX; closing the office ends the run too. |
| **An unanswered plan counted as "finished".** The lead waits 30 min for approval, then `T phase done` + exit 0 → runner said `finished`. | Go for lunch → "✅ Run finished", project card says **Built** — nothing was built. | New `needs-answer` state ("⏸ waiting for you"). Answering later (banner, chat, phone) **resumes the same session**. |
| **Old messages leaked into new runs.** Notes queued while no run was listening (e.g. when the manager was offline) stayed unread. | A new, unrelated run read last week's instruction at its first inbox check. | Launching a run starts with an empty inbox; failed-chat messages are queued only when a run is listening. |
| **Any web page could crash the office** (`Origin: null` → `new URL("null")` throws → process exits) and, via DNS rebinding, **drive it** (Host header was never checked). | A malicious page could start runs — which execute code on the user's computer. | Only `localhost`/`127.0.0.1` Host accepted; unparsable Origin = foreign. |
| **"Improve Merage Hub" edited the Dev Studio itself** (the `merage-hub` alias pointed at the studio repo). | Chip on every user's first screen for someone else's private project; wrong folder even for the author. | Alias removed; generic chips and plain-language examples. |
| Chat covered the whole page on phones on first visit. | Welcome and examples hidden. | Chat starts as the CHAT button on narrow screens. |
| Port already in use → stack trace; sign-in hints said "open PowerShell" on every OS. | Launcher window just closes; wrong instructions on Mac. | Friendly messages; OS-aware sign-in hint. |

---

## P0 — "Built" must mean "I can use it"

Today a finished run ends with `✅ Run finished — <title>. Files are in /path` plus "Team lead's last words" (developer prose) and, on failure, `Full log: …/runs/2026-….jsonl`. A layman can't do anything with a folder path.

**Proposal: add a DELIVER step to the pipeline and an Open button to the office.**

1. **The team ships a run manifest** in every project, e.g. `devstudio.json`:
   ```json
   { "name": "Family Budget", "kind": "web",
     "start": "npm start", "url": "http://localhost:3000",
     "howTo": ["Click Open", "Add this month's income", "Add expenses as you spend"],
     "screenshot": ".devstudio/screenshot.png" }
   ```
   (`kind`: `web` | `static` (open `index.html`) | `script` | `extension` | `desktop`.) Add it to the architect's plan template, the Definition of done, and the reviewer's acceptance criteria.
2. **Office buttons on each project card:** **▶ Open** (runs `start` in the background, waits for `url`, opens the browser; static sites just open the file), **■ Close app**, **📂 Show files** (Explorer / Finder / file manager — today there's only "Copy path").
3. **A picture of the result.** `tester-ui` already drives a browser in interactive runs; have it save a screenshot, and show it on the project card and in the final message.
4. **A human final report**, replacing "Team lead's last words": *What you got* (3 bullets) · *How to open it* · *What it doesn't do yet* · *Ideas for next time* — with ▶ Open / ✎ Change something buttons. (SKILL.md step 7 + `onRunEvent` in `server.mjs`.)
5. **START-HERE.md + double-click start files** (`Start.cmd`, `Start.command`) in every project, written for a non-developer, so it still works without the office.

## P0 — A simple view by default

The first screen shows five panels, nine agent cards, an empty dependency graph, an empty Gantt chart and an empty log. The vocabulary is a developer's: *execution graph, E2E, IDOR, Package A, Opus/Sonnet, "Orchestrates the pipeline", "Your session's model", tester-edge, attempt 2*.

**Proposal: two views, toggled in the header.**

- **Simple (default):** the conversation, one progress card, the office as a small, delightful picture, and *My Projects* with Open buttons.
  ```
  ┌───────────────────────────────────────────────┐
  │  Family Budget                                │
  │  Step 2 of 4 · Building  ▓▓▓▓▓▓░░░░  60%      │
  │  About 12 minutes left · 5 of 8 parts done    │
  │  Now: saving your expenses so they're kept    │
  └───────────────────────────────────────────────┘
  ```
- **Behind the scenes:** today's graph, timeline, activity log, model badges, lessons.

**Plain words everywhere** (headline, phase strip, chat, Telegram):

| Now | Simple view |
|---|---|
| PLAN · BUILD · TEST · FIX · REVIEW · DONE | Planning · Building · Checking · *(Fixing — only shown if it happens)* · Final check · Ready |
| architect / dev-1 / dev-2 / tester-api / tester-ui / tester-edge / reviewer | Give them names and jobs: "Asha — plans the work", "Ben & Chloe — build it", "Checkers", "Security check", "Final check" |
| "Found issues" (failed) | "Found something to fix — fixing it now" (it's normal, not scary) |
| Task titles like *"Add Rsvp model to Prisma schema"* | Ask the architect for a `plain` title per task: *"Remember who's coming"* |
| `T001 · ACTIVE`, verify commands, model badges | Behind-the-scenes only |

Also hide *FIX* from the phase strip until a fix loop actually happens — today it's always shown, which reads as "something will break".

## P0 — Setup without a terminal

Today a new user needs Node 18+, the Claude CLI, `claude auth login` in a terminal, and (for publishing) `gh auth login`. The launcher (`bin/devstudio.cmd`) is Windows-only; `bin/devstudio` is a Git-Bash wrapper around the `.cmd`, so macOS/Linux users must type `node tools/team-office/server.mjs 4400`. If the CLI is missing or signed out, the first thing they see is an error in the chat — after they've already typed out their idea.

**Proposal:**
- A **Setup checklist** card (backed by a `GET /api/health`) shown until everything is green: *Claude installed* (`claude --version`) · *Signed in* (`claude auth status`) · *GitHub (optional)* (`gh auth status`) · *Phone (optional)*. Each red item has one button or one copyable command and re-checks itself.
- Check sign-in **before** the first chat message instead of failing inside it.
- A real cross-platform launcher: a POSIX `bin/devstudio` script, a double-clickable `Dev Studio.command` for macOS, a desktop shortcut option. Longer term: `npx devstudio` or a small desktop app wrapper.

---

## P1 — A better brief means a better result

Output quality for non-developers is decided by the brief, and non-developers don't know what they need to specify. The manager is told to ask "at most 1–2 crisp questions" and otherwise decide itself.

- **Tappable questions.** Add a `CHOICES: On my computer | On my phone | Both` directive rendered as buttons (web and Telegram). A short standard set: *Who will use it?* (just me / family / customers) · *Where?* (computer / phone / both) · *Does it need to remember things?* (no / on this device / shared online) · *Does it need a login?* · *Anything it should look like?*
- **"Here's what I understood"** — a checklist card the user confirms; it becomes the PROPOSE brief.
- **Plain-language plan approval.** The `T ask architect "Plan ready: …"` template in SKILL.md asks for "stack, where the files go, how it will be verified". For this audience lead with *What you'll get* · *How you'll use it* · *Not in this first version* · *About how long*, with the technical plan collapsible.
- **Real answer buttons.** Every team question shows *✓ Approve*, even "Which layout do you prefer, A or B?". Let `T ask` take options (`T ask architect "…" --options "Layout A|Layout B"`) and render them as buttons.

## P1 — Right-size the team (speed and usage)

Every request, from "change the button colour" to a full app, runs the architect (Opus), two devs, three testers and the reviewer (Opus). That's slow for small asks and burns the plan's usage limit — the pause-and-resume feature exists because this happens.

- **Three sizes**, chosen by the manager/architect and shown to the user: *Quick change* (one dev + a light check, minutes) · *Standard* · *Full* (adds the security tester whenever there are logins, payments or personal data).
- Skip testers with nothing to test (no API → no `tester-api`; no inputs → no `tester-edge`).
- An optional *Light team* setting (all Sonnet) for users on smaller plans.
- **Stop polling with the model.** In headless mode the lead runs `sleep 30` + `T inbox` up to 60 times while waiting for approval — each poll is a model turn. Add `T wait --timeout 540` that blocks inside Node until the inbox has something; the lead calls it ~4 times instead of 60.
- **Time estimates** from `history.json` (median duration per size), so "How long will it take?" gets a real answer.

## P1 — Defaults that produce usable software

Add a playbook `for-non-developers.md` that the architect applies unless the user says they're a developer:

- **Low-install stacks first:** a static HTML/CSS/JS app with `localStorage` for personal tools; Node + a JSON file or SQLite for shared local data; the Python standard library for scripts. No Docker, cloud accounts or API keys unless asked.
- **Every project ships:** START-HERE.md in plain words, double-click start files, sample data, and **export/backup** (CSV) of anything the user types in — non-developers fear losing data.
- **Scripts that touch the user's own files** (the "rename my photos" example on the welcome screen!) must show a dry-run preview first and keep an undo log. Never destroy user data.
- Mobile-friendly and readable by default (the team's own `frontend.md` rules).
- New reviewer acceptance criterion: *a non-developer can open and use it by following START-HERE.md in three steps or fewer*; `tester-ui` actually runs the start file.

## P1 — Protect the user's computer and files

- **Projects live next to the studio repo** (`PROJECTS_ROOT = path.resolve(ROOT, "..")` in `runner.mjs`). Clone the studio into your home folder or Documents and the "sibling project folders" are your personal folders: the manager sees all their names, and a new project named like one of them (`photos`, `music`, `budget`; on Windows/macOS `music` *is* `Music`) is treated as an existing project, so `git init` runs and `.claude/` gets written into it. **Use a dedicated folder** (e.g. `~/Dev Studio Projects`, configurable), mark studio projects with a `.devstudio` file, and list only those.
- **`prepareProject` overwrites the project's `.claude/agents/*.md`, `.claude/skills/team/SKILL.md` and playbooks on every run.** In an existing project with its own agents of the same names, those are silently replaced. Namespace them or skip files that differ.
- **Undo.** Before each run on an existing project, commit a checkpoint (the folder is already a git repo), and offer **↶ Undo this run** on the project card.
- **Be honest about the sandbox.** The allowlist is not a security boundary: `Bash(node:*)`, `python`, `make`, `npm install` scripts can do anything, so "can't delete files" is aspirational. `T task <id> verify` also `execSync`s architect-written commands outside Claude's permission checks. Say so plainly in the UI and README, check `verify` commands against the deny list, and offer Claude Code's sandboxing or a container for untrusted work.
- **Minor:** `DENIED_TOOLS` has `Bash(gh auth:*)`, which also blocks the `gh auth status` that `GITHUB_TOOLS` allows. `.claude/playbooks/lessons-global.md` isn't gitignored.

## P1 — Recover instead of starting over

- **↻ Continue where it stopped** for *interrupted* runs (laptop slept, office closed) and *failed* runs. The session id is already saved and `resumeRun` already exists (now also used for answers).
- **Friendly failures.** Replace *"The team lead stopped early (board still at PLAN, 0/0 tasks done)"* and log paths with a plain sentence plus three buttons: *Continue* · *Try again* · *Ask the manager what happened*.
- **A real queue.** The manager is told to offer "queue it after the current run", but no queue exists.

## P1 — Readability and accessibility

- **The pixel font is used for reading.** *Press Start 2P* sets headings, most buttons, tabs and badges at 7–11px (20 declarations in `style.css`). It's charming in the logo and the office, and hard for older eyes everywhere else. Use it for the logo and canvas only; set controls in VT323 or a system font at ≥ 16px, with 44px touch targets (the team's own `frontend.md` rule).
- **Contrast:** "pending" text `#6b6a64` on `#232321` is **2.90:1**, and muted text on cards is **4.47:1** — both below the 4.5:1 minimum.
- **Fonts come from Google Fonts**, so they don't load offline and every visit pings Google. Bundle the two OFL font files in `public/`.
- **Motion:** several things blink at once (current phase, run bar, log cursor, "waiting" text). Keep one gentle indicator.
- **Screen readers:** the chat log is `aria-live` but its `innerHTML` is rebuilt on every change, so everything is re-announced. Tabs have no arrow-key support. The phone dialog doesn't move or trap focus. The `?` help buttons are announced as just "question mark".
- Offer a **light theme** (`color-scheme` is hard-coded to dark).

## P2 — Change it, share it

- **✎ Change something** on each project card → a chat prefilled with that project, using the *Quick change* size.
- **Put it online** for static apps (GitHub Pages via `gh`; later Netlify/Vercel/Cloudflare), with a plain explanation of what "public" means. And **Share a copy** as a zip.
- **History in plain words** — "Yesterday: added dark mode · Undo" — built on the checkpoints above.
- Archive/remove a project from *My Projects*.

## P2 — Phone

Telegram setup (BotFather → token → pairing link) is fine for enthusiasts. For everyone else, show a **QR code** for the pairing link (they're reading it on the PC). Later, consider a PIN-protected mobile web view on the home network. The server deliberately binds to `127.0.0.1` only, so that would be an explicit opt-in.

## P2 — Engineering health

- **No automated tests** for the office. Add a zero-dependency `node --test` suite for `parseDirectives`, `parseResetTime`, `resolveProject`, the stream parser and the runner's state machine. The fake-`claude` approach used to verify this branch's fixes works well for the runner.
- A small CI workflow: `node --check` on every file + the tests.
- A top-level `try/catch` in the request handler, so one bad request can never take the office down again.
- The name "Vikrant's Dev Studio" is hard-coded in the page title, header and Telegram texts. Make it configurable if other people will use it.

---

## Suggested order

1. **Days:** simple view + plain vocabulary · readable fonts & contrast · setup checklist · plain-language plan approval + answer buttons · 📂 Show files.
2. **Next:** DELIVER step (manifest, ▶ Open, screenshot, human final report) · `for-non-developers.md` playbook · dedicated projects folder · ↻ Continue.
3. **Then:** team sizes + `T wait` + time estimates · undo checkpoints · put it online · tests & CI.
