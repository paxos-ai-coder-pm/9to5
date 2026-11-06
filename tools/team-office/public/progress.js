// "Right now" card (simple view): one plain sentence about what's happening, the five steps, how far along, how long
// is left, and the one or two buttons that make sense at this moment.
import { AGENT_BY_ID, STEPS, stepIndex, taskLabel, esc } from "./agents.js";
import { postJson, openProject } from "./ui.js";

const RECENT = 6 * 3600e3;
const IDEAS = [
  ["To-do list", "A simple to-do list I can use in my browser"],
  ["Budget tracker", "A monthly budget tracker for my household"],
  ["Photo renamer", "Rename all my photos in a folder by the date they were taken"],
];
// a numbering machine's wheel for each digit: 10 faces round a drum; each wheel's turns only ever count up
const FACES = Array.from({ length: 10 }, (_, i) => `<b style="--i:${i}">${i}</b>`).join("");
const WHEEL = `<span class="wheel"><span class="drum">${FACES}</span></span>`;
const turns = (n) => [100, 10, 1].map((p) => Math.floor(n / p));
export const fmtLeft = (m) => (m == null ? "" : m < 60 ? `about ${m} min left` : `about ${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min ` : ""}left`);

export function createProgress({ chat, getProjects, nextNo, onDemo }) {
  const host = document.getElementById("progress");
  const title = document.getElementById("progressTitle");
  let last = "";
  let idle = false; // set by view(): nothing is running, so the card invites the next idea
  let sending = false;
  let draft = "";
  let shownNo = 0; // the number the wheels show; they roll forward to the next one
  let lastStep = -1; // how many steps were stamped last time: a step that completes while you watch gets its stamp landing

  function stepper(phase) {
    const cur = stepIndex(phase);
    const passed = phase === "done" ? STEPS.length : Math.max(0, cur);
    const fresh = lastStep >= 0 && passed > lastStep ? passed - 1 : -1; // the stamp that just landed
    lastStep = passed;
    const progress = (Math.max(0, cur) / (STEPS.length - 1)) * 100;
    return `<ol class="stepper" aria-label="Steps" style="--step-progress:${progress}%">${STEPS.map((st, i) => {
      const cls = i < passed ? `past${i === fresh ? " stamped" : ""}` : i === cur ? "now" : "";
      const label = st.key === "test" && phase === "fix" ? "Fixing" : st.label;
      return `<li class="${cls}"${i === cur ? ' aria-current="step"' : ""}><span class="dot" aria-hidden="true">${i < passed ? '<svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>' : i + 1}</span>${esc(label)}</li>`;
    }).join("")}</ol>`;
  }
  const button = (label, attrs, ghost = false) => `<button type="button" class="px-btn${ghost ? " ghost" : ""}" ${attrs}>${label}</button>`;
  const projectFor = (run) => getProjects().find((p) => run && p.dir === run.dir);

  function view(s, mode) {
    idle = false;
    const run = s.run;
    const tasks = s.tasks || [];
    const done = tasks.filter((t) => t.status === "done").length;
    const recent = run && Date.now() - (run.endedAt || 0) < RECENT;

    if (mode === "demo") return working(s, tasks, done);
    if (s.ask && !s.ask.answered) {
      const who = AGENT_BY_ID[s.ask.agent]?.name || s.ask.agent;
      return `<p class="now-line"><b>${esc(who)}</b> needs your answer before the team can go on.</p>${button("Answer now", 'data-go="answer"')}`;
    }
    if (run?.status === "needs-answer") return `<p class="now-line">The team paused until you answer its question. Nothing is built yet.</p>${button("Answer now", 'data-go="answer"')}`;
    if (run?.status === "waiting") {
      const at = new Date(run.resumeAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return `<p class="now-line">Paused — your Claude plan's usage limit was reached. The team carries on by itself at <b>${esc(at)}</b>.</p>${stepper(s.phase)}`;
    }
    const boardActive = !!s.task && s.phase && !["done", "idle"].includes(s.phase);
    if (run ? run.status === "running" : boardActive) {
      if (!s.task || (run && s.startedAt < run.startedAt)) return `<p class="now-line">The team is getting started on <b>${esc(firstLine(run?.task))}</b>…</p>${stepper("plan")}`;
      return working(s, tasks, done);
    }
    if (run?.status === "finished" && recent) {
      const p = projectFor(run);
      return (
        `<p class="now-line"><b>${esc(p?.app?.name || run.project)}</b> is ready.</p>` +
        stepper("done") +
        `<div class="now-actions">${p?.canOpen ? button('<svg class="icon" aria-hidden="true"><use href="#i-play"/></svg> Open it', `data-go="open" data-id="${esc(p.id)}"`) : button("How do I try it?", `data-go="ask" data-text="How do I try ${esc(run.project)}?"`)}${p ? button('<svg class="icon" aria-hidden="true"><use href="#i-edit"/></svg> Change something', `data-go="change" data-name="${esc(p.name)}"`, true) : ""}</div>`
      );
    }
    if (["failed", "interrupted", "stopped"].includes(run?.status) && recent) {
      const title = firstLine(run.task);
      const what = run.status === "stopped" ? "You stopped" : run.status === "interrupted" ? "The office was closed during" : "The team got stuck on";
      return (
        `<p class="now-line">${what} <b>${esc(title)}</b>.</p>` +
        `<div class="now-actions">${run.sessionId ? button('<svg class="icon" aria-hidden="true"><use href="#i-redo"/></svg> Continue', `data-go="continue" data-run="${esc(run.id)}"`) : ""}${button('<svg class="icon" aria-hidden="true"><use href="#i-redo"/></svg> Try again', `data-go="retry" data-run="${esc(run.id)}"`, !!run.sessionId)}${button("What happened?", `data-go="ask" data-text="What went wrong with &quot;${esc(title)}&quot;, and can the team fix it?"`, true)}</div>`
      );
    }
    // nothing running: the landing's main action — type an idea here and it goes straight to Maya
    idle = true;
    return (
      `<div class="start">` +
      `<div class="start-head"><h3 class="start-title">What would you like to build?</h3>` +
      `<span class="commission-no" title="Your next project's number">No. <span class="wheels" aria-hidden="true">${WHEEL.repeat(3)}</span>` +
      `<span class="sr-only">${nextNo() == null ? "" : String(nextNo()).padStart(3, "0")}</span></span></div>` +
      `<p class="start-sub">Describe an app, feature or fix. Maya will draft a plan for you to review.</p>` +
      `<form class="start-form"><label class="sr-only" for="startText">Your idea</label>` +
      `<textarea id="startText" rows="2" maxlength="4000" required placeholder="For example, a budget tracker with monthly totals…"></textarea>` +
      `<div class="start-row"><button type="submit" class="px-btn start-go">Send to Maya <svg class="icon" aria-hidden="true"><use href="#i-arrow"/></svg></button>` +
      `${button('<svg class="icon" aria-hidden="true"><use href="#i-play"/></svg> Watch demo', 'data-go="demo"', true)}</div>` +
      `<p class="start-feedback" id="startFeedback" role="status"></p></form>` +
      `<div class="examples" id="examples"><span>Try an idea</span>${IDEAS.map(([label, text]) => `<button type="button" data-go="idea" data-text="${esc(text)}">${esc(label)}</button>`).join("")}</div>` +
      `</div>`
    );
  }

  function working(s, tasks, done) {
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : { plan: 5, build: 30, test: 60, fix: 70, review: 90, done: 100 }[s.phase] || 0;
    const active = tasks.filter((t) => t.status === "active").slice(0, 3);
    const blocked = tasks.filter((t) => t.status === "blocked").length;
    const stepText = s.phase === "fix" ? `The checkers found ${blocked || "something"} to fix — the builders are on it` : STEPS[stepIndex(s.phase)]?.text || "Working";
    return (
      `<p class="now-line">${esc(stepText)}.</p>` +
      stepper(s.phase) +
      `<div class="meter"><div class="bar" role="progressbar" aria-label="How far along" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>` +
      `<span class="meter-text">${tasks.length ? `${done} of ${tasks.length} parts done` : "Planning the parts of the job"}${s.minutesLeft ? ` · ${fmtLeft(s.minutesLeft)}` : ""}</span></div>` +
      (active.length ? `<p class="now-doing"><span class="muted">Now:</span> ${active.map((t) => esc(taskLabel(t))).join(" · ")}</p>` : "")
    );
  }

  host.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-go]");
    if (!b) return;
    const go = b.dataset.go;
    if (go === "idea") {
      const box = host.querySelector("#startText");
      box.value = b.dataset.text;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }
    if (go === "demo") {
      onDemo();
      document.getElementById("replayBtn").focus();
    }
    if (go === "open") openProject(b.dataset.id);
    if (go === "change") chat.prefill(`In ${b.dataset.name}, I'd like to change: `);
    if (go === "ask") chat.prefill(b.dataset.text, true);
    if (go === "answer") {
      const banner = document.getElementById("askBanner");
      banner.scrollIntoView({ behavior: "smooth", block: "center" });
      banner.querySelector("button")?.focus();
    }
    if (go === "continue" || go === "retry") {
      b.disabled = true;
      try {
        await postJson("/api/run", { action: go, runId: b.dataset.run });
        if (go === "retry") chat.open();
      } catch (x) {
        alert(x.message);
      }
      chat.refresh();
    }
  });

  // Enter sends the idea; Shift+Enter adds a line.
  host.addEventListener("submit", async (e) => {
    e.preventDefault();
    const box = host.querySelector("#startText");
    const submitted = box.value;
    const text = submitted.trim();
    if (!text) return box.focus();
    if (sending) return;
    const feedback = host.querySelector("#startFeedback");
    sending = e.target.querySelector(".start-go").disabled = true;
    feedback.textContent = "";
    try {
      const error = await chat.sendIdea(text);
      if (error) feedback.textContent = error;
      else {
        const current = host.querySelector("#startText");
        if (current?.value === submitted) current.value = "";
        if (draft === submitted) draft = "";
      }
    } finally {
      sending = false;
      const submit = host.querySelector(".start-go");
      if (submit) submit.disabled = false;
    }
  });
  host.addEventListener("keydown", (e) => {
    if (e.target.id === "startText" && e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      e.target.form.requestSubmit();
    }
  });

  // the numbering machine: new wheels show the last number at once, then roll forward to the next one
  function roll() {
    const drums = host.querySelectorAll(".drum");
    if (!drums.length) return;
    const set = (n) => turns(n).forEach((t, i) => drums[i].style.setProperty("--d", t));
    set(shownNo);
    const n = nextNo();
    if (n == null || n === shownNo) return;
    shownNo = n;
    requestAnimationFrame(() => requestAnimationFrame(() => set(n)));
  }

  return {
    update(s, mode) {
      const html = view(s, mode);
      const nextTitle = idle ? "New project" : "Right now";
      if (title.textContent !== nextTitle) title.textContent = nextTitle;
      if (html !== last) {
        last = html;
        // Keep the idea if the composer is temporarily replaced by run progress.
        const box = host.querySelector("#startText");
        const selection = box && document.activeElement === box && [box.selectionStart, box.selectionEnd];
        if (box) draft = box.value;
        host.innerHTML = html;
        roll();
        const again = host.querySelector("#startText");
        if (again) {
          again.value = draft;
          again.closest("form").querySelector(".start-go").disabled = sending;
          if (selection) {
            again.focus();
            again.setSelectionRange(...selection);
          }
        }
      }
    },
  };
}

function firstLine(t) {
  return String(t || "").split("\n")[0].slice(0, 120);
}
