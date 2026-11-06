# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: Vikrant, the owner, using the studio for his own projects** on his own computer. He describes what he wants, approves plans, watches the team work, and opens what it built. (His own technical level was not stated; the commitments below keep the interface in plain words either way.)
- **Secondary, a bonus:** people who install it from GitHub. The README is written for someone who can describe what they want but has never used a terminal.

## Product Purpose

A software team you can talk to. You describe an idea in plain words, the manager (Maya) asks a couple of quick questions and proposes a plan, you approve it with one click, the team builds and checks it, and you press **▶ Open** to use the result.

Success: an idea becomes something that works and opens with one click, and every step on the way is easy to understand.

## Positioning

An 8-agent Claude Code team working through a visible pipeline: an architect plans, two developers build in parallel, three testers check (logic, usability, security and edge cases), a reviewer gives the final verdict, and a manager talks to you. It runs on your computer with your Claude plan. Nothing is built until you approve the plan, every finished project carries `devstudio.json` so the office can open it, and every run on an existing project is snapshotted so it can be undone. The team works in a 3D office you can watch.

## Operating Context

- Runs locally at `http://localhost:4400`, started with `bin/devstudio` (Windows `bin\devstudio.cmd`, Mac `bin/Dev Studio.command`). Needs Node.js 20+ and Claude Code signed in; Git enables Undo, GitHub enables publishing.
- Uses the owner's Claude plan: a run pauses at the usage limit and continues by itself after the reset.
- Two views: **Simple** (default — the office, the chat with Maya, My Projects, and the idea/"Right now" card) and **Behind the scenes** (task plan, timeline, activity log, team models, past runs, lessons).
- Projects are saved in `~/DevStudioProjects` by default (changeable in Settings). One run at a time; further requests queue.
- Optional: talk to Maya from a phone through Telegram; notifications when the team needs an answer or finishes; a demo run (`/?demo`).
- Run logs live in `.claude/team/runs/`; the team's working rules live in `.claude/playbooks/`.

## Capabilities and Constraints

- Guided brief with tap-to-answer choices; plan approval in plain words; team sizes (quick / standard / full); a "lighter team" setting that runs every teammate on Sonnet; time estimates.
- My Projects: ▶ Open (static page, local web app, script, or how-to steps), ✎ Change, ↻ Continue, ↻ Try again, Show files, Share a copy (zip without secrets or history), Put it online (GitHub Pages), Update picture, Remove from list, and a per-project history with ↶ Undo / ↷ Redo.
- Safety: the office answers only to `localhost` and same-origin requests; runs can't commit or publish unless the run's card says so; force-push, history rewrites and deleting repositories are always blocked. The team runs the programs a project needs — the permission list steers it, it is not a sandbox.
- Technical: zero runtime dependencies and no build step (plain Node server, vanilla ES modules, bundled fonts, works offline). Tests: unit, CLI, integration with a fake `claude`, and browser tests; CI on Linux, macOS and Windows.
- Terminology: **Maya** (manager), **Asha** (plans), **Ben & Chloe** (build), **Diego, Emma & Farid** (check), **Grace** (final check); **Simple** / **Behind the scenes**; **My Projects**; **▶ Open**, **✎ Change**, **↶ Undo**, **↻ Continue**.
- Open, undecided (from `docs/IMPROVEMENTS.md`): a desktop wrapper or `npx devstudio`; hosting for apps that need a server; a sandboxed mode for untrusted work; a real end-to-end run with Claude to tune the agent instructions.

## Brand Commitments

Binding, confirmed by the owner:

- **The office you can watch (now a real-time 3D office, three.js) and the named team** (Maya, Asha, Ben, Chloe, Diego, Emma, Farid, Grace) stay.
- **The colour palette: two colours, sage `#9cb29e` and black `#000000`** (with their tints and shades), in both a light and a dark theme that follow the computer's setting. One red is allowed, reserved for errors and blocked work. The teammates keep their own colours inside the office. (Replaces the earlier cream / peach / olive / forest palette.)
- **Plain words, no jargon** in every label and message; technical detail belongs in Behind the scenes.

The studio's name, "Vikrant's Dev Studio", is the default and can be renamed in Settings; the logo's letters follow the name.

## Evidence on Hand

- `README.md` (setup, usage, features, safety, the team), `docs/IMPROVEMENTS.md` (the non-developer journey review and what's done or open), the demo run (`/?demo`), and the test suites in `tools/team-office/test/`.
- None yet: user research, usage numbers, testimonials or outside users. "Put it online" has not been tested against real GitHub. Future work must not invent any of these.

## Product Principles

1. **Functional and easy to understand wins.** When goals conflict, the choice that works and is understood at a glance comes first.
2. **Nothing happens behind your back.** Plans are approved before anything is built, the team asks rather than guesses, and every change can be seen and undone.
3. **Plain words up front, detail on request.** The Simple view speaks like a person; the technical view is one switch away, never in the way.
4. **The office is the personality.** Delight comes from the team at work in the 3D office and small, purposeful motion — never at the cost of clarity or speed.
5. **Few steps from idea to a running thing.** A returning user gets from an idea to ▶ Open with as little ceremony as possible.

## Accessibility & Inclusion

WCAG AA is a commitment: text contrast of at least 4.5:1 (3:1 for icons, controls and focus indicators), everything usable by keyboard with a visible focus indicator, and reduced-motion settings respected.
