// Chat dock: talk to Maya (the manager) by text or dictation. Messages persist in .claude/team/chat.json via the server.
// Besides text, messages can carry: a proposal card (▶ Start), the manager's suggested answers (buttons), the team's
// question with answer buttons, a final report card, next-step buttons (continue, try again, open, redo, setup) and
// collapsed technical details.
import { AGENT_BY_ID, esc, prettyModel } from "./agents.js";
import { postJson, openProject, isSimple } from "./ui.js";

// Minimal, safe markdown for chat bubbles: escape first, then code blocks, inline code, bold, links to http(s) only.
function md(text) {
  const blocks = [];
  let s = esc(text).replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre class="md-code">${code.replace(/\n$/, "")}</pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = s
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/^#{1,4} (.+)$/gm, "<b>$1</b>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
}

const SIZE = { quick: "Quick change", standard: "Standard", full: "Full team (extra checks)" };
const ACTION = {
  continue: "↻ CONTINUE",
  retry: "↻ TRY AGAIN",
  setup: "⚙ SHOW ME HOW TO FIX IT",
  ask: "WHAT HAPPENED?",
  open: "▶ OPEN IT",
  change: "✎ CHANGE SOMETHING",
  redo: "↷ REDO",
};
const firstLine = (t) => String(t || "").split("\n")[0];

export function createChat({ onSetup } = {}) {
  const $ = (id) => document.getElementById(id);
  const box = $("chat"), log = $("chatLog"), form = $("chatForm"), input = $("chatText");
  const sendBtn = $("sendBtn"), micBtn = $("micBtn");
  const status = $("chatStatus"), fab = $("chatFab"), badge = $("chatBadge"), live = $("chatLive");

  let chat = { messages: [], busy: false };
  let lastCount = -1;
  let unread = 0;
  // open by default on wide screens; on phones it would cover the whole page, so start as the CHAT button there
  const savedOpen = localStorage.getItem("chatOpen");
  let open = savedOpen ? savedOpen !== "0" : window.matchMedia("(min-width: 1101px)").matches;
  let lastError = "";

  // The voice feature was removed: clear its cached model (~92 MB) and settings from this browser.
  if ("caches" in window) ["transformers-cache", "kokoro-voices"].forEach((c) => caches.delete(c).catch(() => {}));
  ["managerVoice", "managerVoiceId", "chatLang", "chatSpeak"].forEach((k) => localStorage.removeItem(k));

  function setOpen(v, focus = true) {
    open = v;
    localStorage.setItem("chatOpen", v ? "1" : "0");
    box.hidden = !v;
    fab.hidden = v;
    document.body.classList.toggle("chat-open", v);
    if (v) {
      unread = 0;
      badge.hidden = true;
      log.scrollTop = log.scrollHeight;
      if (focus) input.focus();
    }
  }

  function who(m) {
    const a = AGENT_BY_ID[m.from];
    if (!a) return esc(String(m.from).toUpperCase());
    return isSimple() ? `${esc(a.name.toUpperCase())} <span class="from-job">· ${esc(a.job)}</span>` : esc(a.id.toUpperCase());
  }

  function reportCard(r) {
    const list = (title, items) => (items?.length ? `<h4>${title}</h4><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "");
    return `<div class="report">${list("What you got", r.got)}${list("How to open it", r.howToOpen)}${list("Not in this version yet", r.notYet)}${list("Ideas for next time", r.next)}</div>`;
  }

  function actionButtons(actions) {
    if (!actions?.length) return "";
    return `<div class="msg-actions">${actions
      .filter((a) => ACTION[a.kind])
      .map((a, i) => `<button type="button" class="px-btn small${i ? " ghost" : ""}" data-action='${esc(JSON.stringify(a))}'>${ACTION[a.kind]}</button>`)
      .join("")}</div>`;
  }

  function render() {
    const msgs = chat.messages || [];
    const lastIdx = msgs.length - 1;
    if (!msgs.length) {
      log.innerHTML = `<li class="empty">👋 I'm Maya, your manager.<br>Tell me what you'd like — in your own words. I'll ask a couple of quick questions, show you the plan, and get the team started once you say go.</li>`;
    } else {
      log.innerHTML = msgs
        .map((m, i) => {
          const details = m.details ? `<details class="msg-details"><summary>Details</summary><pre>${esc(m.details)}</pre></details>` : "";
          if (m.from === "system")
            return `<li class="sys"><span class="text">${esc(m.text)}</span>${m.proposal ? proposalCard(m.proposal) : ""}${actionButtons(m.actions)}${details}</li>`;
          if (m.from === "user") return `<li class="me"><span class="from">${m.answer ? "YOU → TEAM" : "YOU"}${m.via === "telegram" ? " · 📱" : ""}</span><span class="text">${esc(m.text)}</span></li>`;
          const a = AGENT_BY_ID[m.from];
          const openAsk = m.ask && chat.ask && !chat.ask.answered && chat.ask.text === m.text;
          const answers = openAsk
            ? `<div class="q-actions">${(m.options?.length ? m.options.map((o) => `<button type="button" class="px-btn small" data-answer="${esc(o)}">${esc(o)}</button>`) : [`<button type="button" class="px-btn small" data-answer="Approved - go ahead.">✓ APPROVE</button>`]).join("")}<button type="button" class="px-btn small ghost" data-reply="1">✎ REPLY</button></div>`
            : "";
          // the manager's suggested answers, while they're still the latest thing in the chat
          const choices = m.choices?.length && i === lastIdx && !chat.busy ? `<div class="choices">${m.choices.map((c) => `<button type="button" data-send="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : "";
          return `<li class="them${m.ask ? " question" : ""}"><span class="from"><i style="background:${a?.color || "#888"}"></i>${who(m)}${m.ask ? " · ❓ NEEDS YOUR ANSWER" : ""}</span><span class="text">${md(m.text)}</span>${m.report ? reportCard(m.report) : ""}${(m.relays || []).map((r) => `<span class="relay">${esc(r)}</span>`).join("")}${m.proposal ? proposalCard(m.proposal) : ""}${answers}${choices}${details}</li>`;
        })
        .join("");
    }
    // while the manager is replying, show the reply as it's being written
    if (chat.busy) log.insertAdjacentHTML("beforeend", `<li class="them typing"><span class="from"><i style="background:#e66767"></i>${isSimple() ? "MAYA" : "MANAGER"}</span><span class="text" id="draftText"></span></li>`);
    if (lastError) log.insertAdjacentHTML("beforeend", `<li class="sys"><span class="text">${esc(lastError)}</span></li>`);
    renderDraft();

    status.textContent = chat.busy ? (chat.draft ? "● typing…" : "● thinking…") : lastError ? "● can't reach the office" : "● online";
    status.className = "chat-status" + (chat.busy ? " busy" : lastError ? " off" : "");
    $("chatModel").textContent = chat.managerModel ? `· ${prettyModel(chat.managerModel)}` : "";
    $("chatModel").title = chat.managerModel ? `Manager model: ${chat.managerModel}` : "";
    sendBtn.disabled = chat.busy && !replyAsk;
    renderChips();
    renderRunBar();
    renderQueue();
  }

  // Quick replies that fit the moment.
  function renderChips() {
    const run = chat.run;
    const recent = run && Date.now() - (run.endedAt || 0) < 6 * 3600e3;
    let chips;
    if (chat.ask && !chat.ask.answered) chips = [["Explain it simply", "Explain the team's question in simple terms — what will I get?"], ["✎ Reply to the team", "reply"]];
    else if (run?.status === "running") chips = [["What's happening now?"], ["How long will it take?"], ["Anything I need to do?"]];
    else if (run?.status === "waiting") chips = [["When does it continue?"], ["What's done so far?"]];
    else if (run?.status === "needs-answer") chips = [["What does the team need from me?"], ["Explain the question simply"]];
    else if (run?.status === "finished" && recent) chips = [["How do I use it?"], ["Put it online"], ["What could we improve next?"]];
    else if (["failed", "interrupted"].includes(run?.status) && recent) chips = [["What went wrong?"], ["Can the team fix it?"]];
    else chips = [["Start something new", "I want to build something new — ask me what you need to know."], ["Improve one of my projects", "I want to improve one of my existing projects — which ones can the team work on?"], ["What can the team do?"]];
    $("chatSuggest").innerHTML = chips.map(([label, action]) => `<button type="button" data-chip="${esc(action || label)}">${esc(label)}</button>`).join("");
  }

  // Reply mode: the next message goes straight to the team as the answer to its question.
  let replyAsk = null;
  function setReply(ask) {
    replyAsk = ask;
    const name = ask ? AGENT_BY_ID[ask.agent]?.name || ask.agent : "";
    input.placeholder = ask ? `Reply to ${name} (goes straight to the team)…` : "Tell Maya what to build…";
    form.classList.toggle("replying", !!ask);
    sendBtn.disabled = false;
  }
  async function answer(text) {
    try {
      await postJson("/api/answer", { text });
    } catch (x) {
      lastError = x.message;
    }
    setReply(null);
    poll();
  }
  $("chatSuggest").addEventListener("click", (e) => {
    const b = e.target.closest("[data-chip]");
    if (!b) return;
    const a = b.dataset.chip;
    if (a === "reply") replyTo(chat.ask);
    else send(a);
  });
  log.addEventListener("click", async (e) => {
    const ans = e.target.closest("[data-answer]");
    if (ans) return answer(ans.dataset.answer);
    if (e.target.closest("[data-reply]")) return replyTo(chat.ask);
    const choice = e.target.closest("[data-send]");
    if (choice) return send(choice.dataset.send);
    const act = e.target.closest("[data-action]");
    if (act) {
      const a = JSON.parse(act.dataset.action);
      if (a.kind === "setup") return onSetup?.();
      if (a.kind === "ask") return send(a.text || "What happened?");
      if (a.kind === "open") return openProject(a.id);
      if (a.kind === "change") return prefill(`In ${a.name}, I'd like to change: `);
      act.disabled = true;
      try {
        if (a.kind === "redo") await postJson("/api/projects", { action: "redo", id: a.id, checkpoint: a.checkpoint });
        else await postJson("/api/run", { action: a.kind, runId: a.runId });
        lastError = "";
      } catch (x) {
        lastError = x.message;
      }
      poll();
    }
  });
  function replyTo(ask) {
    if (!ask) return;
    setOpen(true);
    setReply(ask);
    input.focus();
  }

  function renderDraft() {
    const el = $("draftText");
    if (el) {
      el.textContent = chat.draft || "";
      el.classList.toggle("thinking", !chat.draft);
    }
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    if (nearBottom || !el) log.scrollTop = log.scrollHeight;
  }

  // A run the manager proposed; buttons only while it's still the pending proposal.
  function proposalCard(p) {
    const pending = chat.proposal?.id === p.id;
    const busy = ["running", "waiting"].includes(chat.run?.status);
    const folder = p.dir.split(/[\\/]/).pop();
    return `<div class="proposal">
      <div class="p-head">🚀 READY TO START · ${esc(SIZE[p.size] || SIZE.standard)}${p.estimate ? ` · usually about ${p.estimate} min` : ""}</div>
      <div class="p-task">${esc(p.task)}</div>
      <div class="p-dir" title="${esc(p.dir)}">📁 ${p.isNew ? `New project “${esc(folder)}”` : `Changes to “${esc(folder)}”`}<span class="tech"> — ${esc(p.dir)}</span></div>
      ${p.foreign ? `<div class="p-warn">⚠ This folder already has files the studio didn't make — the team will change them. (You can undo the run afterwards.)</div>` : ""}
      ${p.allowGithub ? `<div class="p-github">🔓 This run may <b>publish to GitHub</b>${p.githubAccount ? ` as <b>${esc(p.githubAccount)}</b>` : ""} (no force-push or deletes). Starting it gives that permission for this run only.</div>` : ""}
      ${pending ? `<div class="p-actions"><button type="button" class="px-btn small" data-run="start" data-id="${esc(p.id)}">${busy ? "⏭ QUEUE IT" : "▶ START"}</button><button type="button" class="px-btn small ghost" data-run="dismiss" data-id="${esc(p.id)}">NOT YET</button></div>${busy ? `<div class="p-note">The team is busy — this starts right after the current run.</div>` : ""}` : ""}
    </div>`;
  }

  function renderRunBar() {
    const bar = $("runBar");
    const run = chat.run;
    if (!run) return void (bar.hidden = true);
    const icon = { running: "●", waiting: "⏳", "needs-answer": "⏸", finished: "✓", failed: "✖", stopped: "■", interrupted: "!" }[run.status] || "●";
    const active = ["running", "waiting", "needs-answer"].includes(run.status);
    const recent = active || Date.now() - (run.endedAt || 0) < 10 * 60 * 1000;
    bar.hidden = !recent;
    bar.className = "run-bar " + run.status;
    const words = { running: "WORKING", finished: "FINISHED", failed: "NEEDS ATTENTION", stopped: "STOPPED", interrupted: "INTERRUPTED" };
    let label = `${icon} ${words[run.status] || run.status.toUpperCase()}`;
    let detail = `${run.project} · ${firstLine(run.task)}`;
    if (run.status === "waiting") {
      const mins = Math.max(0, Math.round((run.resumeAt - Date.now()) / 60000));
      const at = new Date(run.resumeAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      label = `⏳ PAUSED`;
      detail = `Out of usage — continues at ${at} (${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`})`;
    } else if (run.status === "needs-answer") {
      label = "⏸ WAITING FOR YOU";
      detail = "The team needs your answer to continue — nothing is built yet";
    } else if (run.attempts > 1 && run.status === "running" && !isSimple()) detail += ` · attempt ${run.attempts}`;
    const stopTitle = { waiting: "Cancel the automatic resume", "needs-answer": "Cancel this run instead of answering" }[run.status] || "Stop the team";
    bar.innerHTML = `<span class="r-status">${esc(label)}</span><span class="r-task" title="${esc(run.task)}">${esc(detail)}</span>${
      active ? `<button type="button" class="px-btn small ghost" data-run="stop" title="${stopTitle}">■ STOP</button>` : ""
    }`;
  }

  function renderQueue() {
    const q = chat.queue || [];
    const bar = $("queueBar");
    bar.hidden = !q.length;
    bar.innerHTML = q.length
      ? `<span class="q-label">NEXT UP</span><ol>${q.map((x, i) => `<li><span>${esc(x.task)}</span><button type="button" class="icon-btn small" data-unqueue="${i}" aria-label="Remove “${esc(x.task)}” from the queue" title="Remove from the queue">✕</button></li>`).join("")}</ol>`
      : "";
  }

  async function runAction(action, proposalId) {
    const confirmText = {
      waiting: "Cancel the paused run? It won't resume after the usage reset.",
      "needs-answer": "Cancel this run? The team won't continue even if you answer later.",
    }[chat.run?.status] || "Stop the team's current run? You can continue it later.";
    if (action === "stop" && !confirm(confirmText)) return;
    try {
      await postJson("/api/run", { action, proposalId });
      lastError = "";
    } catch (x) {
      lastError = x.message;
    }
    poll();
  }
  box.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-run]");
    if (b) return runAction(b.dataset.run, b.dataset.id);
    const u = e.target.closest("[data-unqueue]");
    if (u) {
      await postJson("/api/run", { action: "unqueue", index: Number(u.dataset.unqueue) }).catch((x) => (lastError = x.message));
      poll();
    }
  });

  const seen = new Set(); // message ids already counted for the unread badge / announced
  let primed = false;
  let polling = false;
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const res = await fetch("/api/chat", { cache: "no-store" });
      const next = await res.json();
      lastError = lastError.startsWith("Can't reach") ? "" : lastError;
      const msgs = next.messages || [];
      const fresh = msgs.filter((m) => m.id && !seen.has(m.id));
      fresh.forEach((m) => seen.add(m.id));
      if (primed) {
        const incoming = fresh.filter((m) => m.from !== "user");
        // screen readers hear only the new messages, not the whole log again
        if (incoming.length) live.textContent = incoming.map((m) => `${AGENT_BY_ID[m.from]?.name || "Office"}: ${m.text}`).join(" … ").slice(0, 600);
        if (!open) {
          unread += incoming.length;
          badge.textContent = unread;
          badge.hidden = !unread;
        }
      }
      primed = true;
      const changed =
        msgs.length !== lastCount || next.busy !== chat.busy || fresh.length > 0 || next.managerModel !== chat.managerModel ||
        JSON.stringify(next.ask) !== JSON.stringify(chat.ask) || JSON.stringify(next.queue) !== JSON.stringify(chat.queue) ||
        next.proposal?.id !== chat.proposal?.id || JSON.stringify(next.run) !== JSON.stringify(chat.run);
      const draftChanged = next.draft !== chat.draft;
      chat = next;
      lastCount = msgs.length;
      if (changed) render();
      else if (draftChanged) {
        renderDraft(); // only the streaming text moved — don't rebuild the whole log
        status.textContent = chat.draft ? "● typing…" : "● thinking…";
      }
    } catch {
      if (!lastError) {
        lastError = "Can't reach the office.";
        render();
      }
    } finally {
      polling = false;
    }
  }

  async function send(text) {
    text = text.trim();
    if (!text) return;
    if (replyAsk) {
      input.value = "";
      autosize();
      return answer(text); // reply mode → straight to the team's inbox
    }
    if (chat.busy) return;
    input.value = "";
    autosize();
    chat = { ...chat, busy: true, messages: [...(chat.messages || []), { from: "user", text }] };
    render();
    try {
      await postJson("/api/chat", { text });
      lastError = "";
    } catch (x) {
      lastError = x.message === "Failed to fetch" ? "Can't reach the office." : x.message;
    }
    poll();
  }

  // ---- text input ----
  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
  }
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input.value);
    }
    if (e.key === "Escape" && replyAsk) setReply(null); // Escape leaves reply mode
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    send(input.value);
  });
  // ---- dictation (Web Speech API: Chrome, Edge, Safari) — types what you say into the box ----
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  if (!SR) {
    micBtn.disabled = true;
    micBtn.title = "Dictation isn't supported in this browser — try Chrome or Edge";
  } else {
    micBtn.addEventListener("click", () => {
      if (rec) return rec.stop();
      rec = new SR();
      rec.lang = navigator.language || "en-US";
      rec.interimResults = true;
      rec.continuous = false;
      const before = input.value ? input.value.trimEnd() + " " : "";
      let finalText = "";
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
          else interim += e.results[i][0].transcript;
        }
        input.value = before + finalText + interim;
        autosize();
      };
      rec.onerror = (e) => {
        lastError = e.error === "not-allowed" ? "Microphone access was blocked — allow it in the browser to dictate." : `Dictation error: ${e.error}`;
        render();
      };
      rec.onend = () => {
        micBtn.setAttribute("aria-pressed", "false");
        rec = null;
        if (finalText.trim()) send(input.value);
      };
      micBtn.setAttribute("aria-pressed", "true");
      lastError = "";
      rec.start();
    });
  }

  $("chatMin").addEventListener("click", () => {
    setOpen(false);
    fab.focus();
  });
  fab.addEventListener("click", () => setOpen(true));
  window.addEventListener("viewchange", () => render());

  setOpen(open, false);
  render();
  // poll fast while the manager is writing (to stream its reply), slowly otherwise
  (function loop() {
    poll().finally(() => setTimeout(loop, chat.busy ? 250 : 1000));
  })();

  // put text in the box (e.g. from an example or a project card); optionally send it right away
  function prefill(text, sendNow = false) {
    setOpen(true);
    setReply(null);
    if (sendNow && !chat.busy) return send(text);
    input.value = text;
    autosize();
    input.focus();
    input.setSelectionRange(text.length, text.length);
  }

  return { open: () => setOpen(true), refresh: () => poll(), replyTo, prefill };
}
