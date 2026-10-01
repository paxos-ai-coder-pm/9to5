// "Right now" card (simple view): one plain sentence about what's happening, the five steps, how far along, how long
// is left, and the one or two buttons that make sense at this moment.
import { AGENT_BY_ID, STEPS, stepIndex, taskLabel, esc } from "./agents.js";
import { postJson, openProject } from "./ui.js";

const RECENT = 6 * 3600e3;
export const fmtLeft = (m) => (m == null ? "" : m < 60 ? `about ${m} min left` : `about ${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min ` : ""}left`);

export function createProgress({ chat, getProjects, onDemo }) {
  const host = document.getElementById("progress");
  let last = "";

  function stepper(phase, loop) {
    const cur = stepIndex(phase);
    return `<ol class="stepper" aria-label="Steps">${STEPS.map((st, i) => {
      const cls = i < cur || phase === "done" ? "past" : i === cur ? "now" : "";
      const label = st.key === "test" && phase === "fix" ? "Fixing" : st.label;
      return `<li class="${cls}"${i === cur ? ' aria-current="step"' : ""}><span class="dot" aria-hidden="true">${i < cur || phase === "done" ? "✓" : i + 1}</span>${esc(label)}</li>`;
    }).join("")}</ol>`;
  }
  const button = (label, attrs, ghost = false) => `<button type="button" class="px-btn${ghost ? " ghost" : ""}" ${attrs}>${label}</button>`;
  const projectFor = (run) => getProjects().find((p) => run && p.dir === run.dir);

  function view(s, mode) {
    const run = s.run;
    const tasks = s.tasks || [];
    const done = tasks.filter((t) => t.status === "done").length;
    const recent = run && Date.now() - (run.endedAt || 0) < RECENT;

    if (mode === "demo") return working(s, tasks, done, "This is a pretend run, so you can see how it works.");
    if (s.ask && !s.ask.answered) {
      const who = AGENT_BY_ID[s.ask.agent]?.name || s.ask.agent;
      return `<p class="now-line">❓ <b>${esc(who)}</b> needs your answer before the team can go on.</p>${button("ANSWER NOW", 'data-go="answer"')}`;
    }
    if (run?.status === "needs-answer") return `<p class="now-line">⏸ The team paused until you answer its question. Nothing is built yet.</p>${button("ANSWER NOW", 'data-go="answer"')}`;
    if (run?.status === "waiting") {
      const at = new Date(run.resumeAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return `<p class="now-line">⏳ Paused — your Claude plan's usage limit was reached. The team carries on by itself at <b>${esc(at)}</b>.</p>${stepper(s.phase, s.loop)}`;
    }
    const boardActive = !!s.task && s.phase && !["done", "idle"].includes(s.phase);
    if (run ? run.status === "running" : boardActive) {
      if (!s.task || (run && s.startedAt < run.startedAt)) return `<p class="now-line">🚀 The team is getting started on <b>${esc(firstLine(run?.task))}</b>…</p>${stepper("plan", 0)}`;
      return working(s, tasks, done);
    }
    if (run?.status === "finished" && recent) {
      const p = projectFor(run);
      return (
        `<p class="now-line">✅ <b>${esc(p?.app?.name || run.project)}</b> is ready.</p>` +
        stepper("done", 0) +
        `<div class="now-actions">${p?.canOpen ? button("▶ OPEN IT", `data-go="open" data-id="${esc(p.id)}"`) : button("HOW DO I TRY IT?", `data-go="ask" data-text="How do I try ${esc(run.project)}?"`)}${p ? button("✎ CHANGE SOMETHING", `data-go="change" data-name="${esc(p.name)}"`, true) : ""}</div>`
      );
    }
    if (["failed", "interrupted", "stopped"].includes(run?.status) && recent) {
      const title = firstLine(run.task);
      const what = run.status === "stopped" ? "You stopped" : run.status === "interrupted" ? "The office was closed during" : "The team got stuck on";
      return (
        `<p class="now-line">⚠ ${what} <b>${esc(title)}</b>.</p>` +
        `<div class="now-actions">${run.sessionId ? button("↻ CONTINUE", `data-go="continue" data-run="${esc(run.id)}"`) : ""}${button("↻ TRY AGAIN", `data-go="retry" data-run="${esc(run.id)}"`, !!run.sessionId)}${button("WHAT HAPPENED?", `data-go="ask" data-text="What went wrong with &quot;${esc(title)}&quot;, and can the team fix it?"`, true)}</div>`
      );
    }
    return (
      `<p class="now-line">Nothing is being built right now.</p>` +
      `<div class="now-actions">${button("💬 TELL THE MANAGER WHAT TO BUILD", 'data-go="chat"')}${button("▶ WATCH A DEMO", 'data-go="demo"', true)}</div>`
    );
  }

  function working(s, tasks, done, note = "") {
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : { plan: 5, build: 30, test: 60, fix: 70, review: 90, done: 100 }[s.phase] || 0;
    const active = tasks.filter((t) => t.status === "active").slice(0, 3);
    const blocked = tasks.filter((t) => t.status === "blocked").length;
    const stepText = s.phase === "fix" ? `The checkers found ${blocked || "something"} to fix — the builders are on it` : STEPS[stepIndex(s.phase)]?.text || "Working";
    return (
      `<p class="now-line">${esc(stepText)}.</p>` +
      stepper(s.phase, s.loop) +
      `<div class="meter"><div class="bar" role="progressbar" aria-label="How far along" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>` +
      `<span class="meter-text">${tasks.length ? `${done} of ${tasks.length} parts done` : "Planning the parts of the job"}${s.minutesLeft ? ` · ${fmtLeft(s.minutesLeft)}` : ""}</span></div>` +
      (active.length ? `<p class="now-doing"><span class="muted">Now:</span> ${active.map((t) => esc(taskLabel(t))).join(" · ")}</p>` : "") +
      (note ? `<p class="muted">${esc(note)}</p>` : "")
    );
  }

  host.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-go]");
    if (!b) return;
    const go = b.dataset.go;
    if (go === "chat") chat.open();
    if (go === "demo") onDemo();
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

  return {
    update(s, mode) {
      const html = view(s, mode);
      if (html !== last) {
        last = html;
        host.innerHTML = html;
      }
    },
  };
}

function firstLine(t) {
  return String(t || "").split("\n")[0].slice(0, 120);
}
