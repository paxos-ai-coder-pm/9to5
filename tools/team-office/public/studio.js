// Friendly layer on top of the office: plain-English status, "needs your answer" banner, welcome card,
// projects/lessons tabs, help tips, and optional desktop notifications.
import { AGENT_BY_ID, STEPS, stepIndex, displayName, esc, fmtDur, getInitials } from "./agents.js";
import { isSimple } from "./ui.js";

const PHASE_TEXT = {
  plan: "Planning — the architect is working out the tasks",
  build: "Building",
  test: "Testing — the testers are checking the work",
  fix: "Fixing what the testers found",
  review: "Final review — the reviewer is checking everything",
  done: "Done",
};
const who = (id) => (isSimple() ? AGENT_BY_ID[id]?.name || id : `The ${id}`);

export function createStudio({ chat, setup }) {
  const $ = (id) => document.getElementById(id);
  let state = {};
  let mode = "live";
  let overview = { history: [], lessons: { global: [], projects: [] } };
  let primed = false;
  let lastAskT = 0;
  let lastRunKey = "";
  let renderedAskKey = "";
  let studioName = "9to5";

  // ---------- plain-English status ----------
  function headline(s) {
    const run = s.run;
    if (mode === "demo") return "Demo run";
    if (s.ask && !s.ask.answered) return `${who(s.ask.agent)} needs your answer`;
    if (s.ask?.answered && run?.status === "running") return "Answer sent — the team is picking it up";
    if (run?.status === "needs-answer") return "The team paused until you answer its question — nothing is built yet";
    if (run?.status === "waiting") {
      const at = new Date(run.resumeAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return `Paused by the Claude usage limit — the team continues by itself at ${at}`;
    }
    // an office-launched run knows whether it's really running; without one (a /team run in Claude Code) trust the board
    const boardActive = !!s.task && s.phase && s.phase !== "done" && s.phase !== "idle";
    if (run ? run.status === "running" : boardActive) {
      if (!s.task) return "Starting up — the team lead is getting ready";
      const tasks = s.tasks || [];
      const done = tasks.filter((t) => t.status === "done").length;
      if (isSimple()) {
        const step = STEPS[stepIndex(s.phase)];
        const n = stepIndex(s.phase) + 1;
        return `Step ${n} of ${STEPS.length}: ${s.phase === "fix" ? "Fixing a few things" : step?.label || "Working"}${tasks.length ? ` — ${done} of ${tasks.length} parts done` : ""}`;
      }
      const working = Object.entries(s.agents || {})
        .filter(([id, a]) => a.state === "working" && id !== "manager")
        .map(([id, a]) => `${id}${a.activity ? `: ${a.activity}` : ""}`);
      const base = s.phase === "build" ? `Building — ${done} of ${tasks.length} tasks done` : PHASE_TEXT[s.phase] || "Working";
      return working.length ? `${base} · ${working.slice(0, 2).join(" · ")}` : base;
    }
    if (run?.status === "needs-answer") return "The team paused until you answer its question";
    if (run?.status === "finished" && Date.now() - (run.endedAt || 0) < 6 * 3600e3) {
      // the app's own name (registered by `T deliver` in this run), like the Right now card — not its folder name
      const name = s.delivered && s.delivered.t >= run.startedAt ? s.delivered.name : run.project;
      return `Finished: ${name} — press Open to try it`;
    }
    if (["failed", "interrupted"].includes(run?.status) && Date.now() - (run.endedAt || 0) < 6 * 3600e3) return `The last run didn't finish — you can continue it or ask the manager what happened`;
    if (setup?.ready() === false) return "Almost ready. Finish setup below.";
    return "Ready for your next idea";
  }

  // ---------- needs your answer ----------
  function renderAsk(s) {
    const ask = s.ask;
    const show = mode === "live" && ask && (!ask.answered || s.run?.status === "running") && Date.now() - ask.t < 24 * 3600e3;
    $("askBanner").hidden = !show;
    document.title = (ask && !ask.answered && mode === "live" ? "(❓) " : "") + studioName;
    if (!show) return;
    const key = `${ask.t}|${ask.answered || ""}|${isSimple()}`;
    if (key === renderedAskKey) return; // don't rebuild buttons every tick (would eat clicks)
    renderedAskKey = key;
    const a = AGENT_BY_ID[ask.agent];
    $("askFrom").innerHTML = `<i style="background:${a?.color || "#888"}"></i>${esc(displayName(ask.agent, isSimple()).toUpperCase())}${isSimple() && a ? ` (${esc(a.job.toLowerCase())})` : ""} ASKS`;
    $("askText").textContent = ask.text;
    $("askBanner").classList.toggle("answered", !!ask.answered);
    const options = ask.options?.length ? ask.options : null;
    $("askActions").innerHTML = ask.answered
      ? `<span class="ask-sent">Answer sent — waiting for the team</span>`
      : (options
          ? options.map((o, i) => `<button type="button" class="px-btn" data-option="${i}">${esc(o)}</button>`).join("")
          : `<button type="button" class="px-btn" data-option="approve">Approve</button>`) + `<button type="button" class="px-btn ghost" data-option="reply"><svg class="icon" aria-hidden="true"><use href="#i-edit"/></svg> Reply</button>`;
    for (const b of $("askActions").querySelectorAll("[data-option]"))
      b.onclick = () => (b.dataset.option === "reply" ? chat.replyTo(ask) : answer(b.dataset.option === "approve" ? "Approved - go ahead." : options[Number(b.dataset.option)]));
  }

  async function answer(text) {
    try {
      await fetch("/api/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    } catch {}
    if (state.ask) state.ask.answered = Date.now();
    renderAsk(state);
    chat.refresh();
  }

  // ---------- welcome ----------
  function renderWelcome(s) {
    const first = mode === "live" && !s.task && !s.run && overview.history.length === 0;
    $("welcome").hidden = !(first && localStorage.getItem("welcomeDismissed") !== "1");
  }
  $("welcomeClose").onclick = () => {
    localStorage.setItem("welcomeDismissed", "1");
    $("welcome").hidden = true;
    const idea = $("startText");
    (idea?.offsetParent ? idea : $("workspace")).focus();
  };

  // ---------- tabs ----------
  const tabs = { tabLog: "log", tabProjects: "projects", tabLessons: "lessons" };
  function selectTab(id) {
    for (const [t, panel] of Object.entries(tabs)) {
      $(t).setAttribute("aria-selected", String(t === id));
      $(t).tabIndex = t === id ? 0 : -1;
      $(panel).hidden = t !== id;
    }
    localStorage.setItem("tab", id);
    if (id !== "tabLog") refreshOverview();
  }
  for (const t of Object.keys(tabs)) {
    $(t).onclick = () => selectTab(t);
    // arrow keys move between tabs (the ARIA tabs pattern); only the selected tab is in the Tab order
    $(t).onkeydown = (e) => {
      const ids = Object.keys(tabs);
      const i = ids.indexOf(t) + (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0);
      if (i === ids.indexOf(t)) return;
      const next = ids[(i + ids.length) % ids.length];
      selectTab(next);
      $(next).focus();
    };
  }
  selectTab(localStorage.getItem("tab") in tabs ? localStorage.getItem("tab") : "tabLog");

  // ---------- projects & lessons ----------
  const when = (ms) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  function renderProjects() {
    const list = overview.history;
    if (!list.length) {
      $("projects").innerHTML = `<li class="empty-note">Nothing built yet. Finished runs show up here with their folder, so you can find and try them.</li>`;
      return;
    }
    $("projects").innerHTML = list
      .map(
        (h) => `<li class="proj ${h.status}">
          <div class="proj-top"><span class="chip ${h.status === "finished" ? "done" : h.status === "failed" ? "blocked" : "pending"}" aria-hidden="true"></span>
            <b>${esc(h.project)}</b><span class="proj-when">${when(h.endedAt || h.startedAt)} · ${fmtDur((h.endedAt || h.startedAt) - h.startedAt)}${h.attempts > 1 ? ` · ${h.attempts} sessions` : ""}</span></div>
          <div class="proj-title">${esc(h.title)}</div>
          ${h.error ? `<div class="proj-err">${esc(h.error)}</div>` : ""}
          <div class="proj-actions">
            ${h.dir ? `<button class="px-btn small ghost" data-copy="${esc(h.dir)}">Copy folder path</button>` : ""}
            ${h.status === "finished" ? `<button class="px-btn small ghost" data-ask="How do I try ${esc(h.project)}?">How to try it</button>` : ""}
            ${h.status === "failed" ? `<button class="px-btn small ghost" data-ask="What went wrong with the ${esc(h.project)} run, and can the team fix it?">Ask about it</button>` : ""}
          </div></li>`,
      )
      .join("");
  }
  function renderLessons() {
    const { global, projects } = overview.lessons;
    if (!global.length && !projects.length) {
      $("lessons").innerHTML = `<p class="empty-note">After each run the reviewer records what the team learned (gotchas, working commands, conventions). Future runs read these first, so the same mistake isn't made twice.</p>`;
      return;
    }
    const block = (title, lines) => `<h3>${esc(title)}</h3><ul>${lines.slice().reverse().map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
    $("lessons").innerHTML = projects.map((p) => block(`${p.project}`, p.lines)).join("") + (global.length ? block("All projects", global) : "");
  }
  document.querySelector(".log-panel").addEventListener("click", async (e) => {
    const copy = e.target.closest("[data-copy]");
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy);
        copy.textContent = "Copied";
        setTimeout(() => (copy.textContent = "Copy folder path"), 1500);
      } catch {
        prompt("Folder path:", copy.dataset.copy);
      }
    }
    const ask = e.target.closest("[data-ask]");
    if (ask) chat.prefill(ask.dataset.ask, true);
  });
  let loading = false;
  async function refreshOverview() {
    if (loading) return;
    loading = true;
    try {
      overview = await (await fetch("/api/overview", { cache: "no-store" })).json();
      renderProjects();
      renderLessons();
      renderWelcome(state);
    } catch {}
    loading = false;
  }

  // ---------- help tips ----------
  const pop = $("helpPop");
  let helpButton;
  function closeHelp() {
    helpButton?.removeAttribute("aria-describedby");
    helpButton = null;
    pop.hidden = true;
  }
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".help");
    if (!btn || btn === helpButton) return closeHelp();
    closeHelp();
    helpButton = btn;
    pop.textContent = btn.dataset.help;
    pop.hidden = false;
    btn.setAttribute("aria-describedby", pop.id);
    const r = btn.getBoundingClientRect();
    pop.style.top = r.bottom + 8 + window.scrollY + "px";
    pop.style.left = Math.max(8, Math.min(r.right, document.documentElement.clientWidth - 8) - pop.offsetWidth) + window.scrollX + "px";
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeHelp());

  // ---------- notifications ----------
  const bell = $("notifyBtn");
  const notifyOn = () => localStorage.getItem("notify") === "on" && "Notification" in window && Notification.permission === "granted";
  const paintBell = () => {
    bell.setAttribute("aria-pressed", String(notifyOn()));
    bell.title = notifyOn() ? "Notifications on — click to turn off" : "Notify me when the team needs me or finishes";
  };
  bell.onclick = async () => {
    if (!("Notification" in window)) return alert("This browser doesn't support notifications.");
    if (notifyOn()) localStorage.setItem("notify", "off");
    else if ((await Notification.requestPermission()) === "granted") localStorage.setItem("notify", "on");
    paintBell();
  };
  paintBell();
  function notify(title, body) {
    if (!notifyOn() || (document.visibilityState === "visible" && document.hasFocus())) return;
    try {
      const n = new Notification(title, { body, tag: "devstudio" });
      n.onclick = () => window.focus();
    } catch {}
  }
  function watchForNotifications(s) {
    const run = s.run;
    const runKey = run ? `${run.id}:${run.status}:${run.attempts || 1}` : "";
    if (primed) {
      if (s.ask && !s.ask.answered && s.ask.t > lastAskT) notify(`❓ ${AGENT_BY_ID[s.ask.agent]?.name || s.ask.agent} needs your answer`, s.ask.text.slice(0, 180));
      if (runKey && runKey !== lastRunKey && run) {
        if (run.status === "finished") notify("✅ The team finished", `${run.project}: ${String(run.task).split("\n")[0].slice(0, 120)}`);
        if (run.status === "failed") notify("⚠ A run stopped with a problem", run.error || run.project);
        if (run.status === "waiting") notify("⏳ Paused by the usage limit", "The team will resume automatically after the reset.");
        if (run.status === "needs-answer") notify("⏸ The team is waiting for you", "Answer its question and it carries on where it stopped.");
      }
      if (runKey !== lastRunKey && run && run.status !== "running") refreshOverview();
    }
    lastAskT = Math.max(lastAskT, s.ask?.t || 0);
    lastRunKey = runKey;
    primed = true;
  }

  refreshOverview();
  setInterval(refreshOverview, 30000);

  return {
    update(s, m = "live") {
      state = s;
      mode = m;
      if (s.studioName && s.studioName !== studioName) {
        studioName = s.studioName;
        $("studioName").textContent = studioName;
        for (const face of document.querySelectorAll(".logo-abbr")) face.textContent = getInitials(studioName); // the brand mark
      }
      const status = headline(s);
      if ($("headline").textContent !== status) $("headline").textContent = status;
      renderAsk(s);
      renderWelcome(s);
      if (m === "live") watchForNotifications(s);
    },
  };
}
