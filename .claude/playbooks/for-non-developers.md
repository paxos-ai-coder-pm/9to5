# Building for someone who isn't a developer

Apply this by default: runs started from the office are for people who can describe what they want but can't read code, don't use a terminal, and won't install developer tools. (Skip it only when the task says the user is a developer.) "Done" means **they can open it and use it**, not that the code compiles.

## 1. Pick the lightest thing that works
- **Personal tools** (to-do list, budget, tracker, planner): a static web app — plain HTML/CSS/JS in one folder, data in `localStorage`, no build step, no server. Opens in any browser.
- **Needs shared or larger data, or runs on a schedule**: Node with only the standard library (`node:http`, `node:fs`), data in a JSON file (or SQLite if it's really needed). Read the port from `process.env.PORT` (default 3000) and bind to `127.0.0.1`.
- **Works on the user's own files** (rename photos, tidy a folder): a script with a small local web page or clear prompts, *never* a bare command-line tool that needs arguments.
- No Docker, no cloud accounts, no API keys, no paid services, no databases to install — unless the user asked. If a feature would need one, leave it out of v1 and say so in the report.
- Prefer what's already installed on a normal computer (a browser, Node since the studio needs it). Every extra dependency is something that can fail on their machine.

## 2. Never lose or damage their data
- Anything that changes the user's own files shows a **preview first** ("These 42 photos will be renamed…") and only acts after they confirm. Keep an undo log (e.g. `renames-2026-09-30.csv`) so it can be reversed.
- Apps that store what the user types offer **Export (CSV/JSON)** and, where it makes sense, **Import** — people are afraid of losing their data, and localStorage can be cleared.
- Ask before deleting anything; say what will happen in plain words.

## 3. Make it easy to use
- Big, readable text (≥ 16px), clear labels, one obvious main action per screen, works on a phone-sized screen too (`frontend.md`).
- Empty states explain what to do next ("No expenses yet — add your first one above"). Errors say what happened and how to fix it, in plain words — never a stack trace.
- Include a little **sample data** or a "Try with example data" button when an empty app would be confusing.
- Words from the user's world, not ours: "Save", "Your expenses", not "Submit", "Records", "Persist".

## 4. Deliver it so it opens with one click
Every project ends with these files (plan them as tasks):
- **`devstudio.json`** in the project root — tells the office how to open it (the user gets an **▶ Open** button). Check it with `T deliver`; fix whatever it reports.
  ```json
  { "name": "Family Budget", "kind": "static", "entry": "index.html",
    "howTo": ["Click ▶ Open", "Add this month's income at the top", "Add each expense as you spend"] }
  ```
  `kind`: `static` (opens `entry`), `web` (runs `start`, must listen on `$PORT`; add `"install": "npm install"` if it has dependencies), `script` (runs `start` once and shows its output), `extension` or `other` (the office shows `howTo`). `howTo` is 1–8 short steps in plain words.
- **`START-HERE.md`** — for a person, not a developer: what it is, how to open it (double-click the start file, or ▶ Open in the studio), how to use it in 3–6 steps, where their data is kept and how to back it up. No jargon, no terminal commands.
- **A double-click start file** when it isn't a plain static page: `Start.cmd` (Windows) and `Start.command` (macOS, `chmod +x`) that start it and open the browser.
- A **screenshot** is taken automatically by the office for web/static projects. If you have browser tools, you may save a better one as `docs/screenshot.png` and add `"screenshot": "docs/screenshot.png"` to `devstudio.json`.

## 5. Talk like a person
- Questions to the user (`T ask`) are short, concrete and answerable by tapping: offer 2–4 `--options` whenever you can ("Cards|List", "Just me|My family"). Never ask about frameworks, databases or file formats — decide those yourself.
- The plan you post for approval starts with **what they'll get** and **how they'll use it**; technical details go last, briefly.
- The final report (`T report`) says what they got, how to open it, what's not in this version, and ideas for next time — in their words.
