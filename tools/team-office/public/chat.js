// Chat dock: talk to the manager by text (or dictate with the mic). Messages persist in .claude/team/chat.json via the server.
import { AGENT_BY_ID, esc, prettyModel } from "./agents.js";

export function createChat() {
  const $ = (id) => document.getElementById(id);
  const box = $("chat"), log = $("chatLog"), form = $("chatForm"), input = $("chatText");
  const sendBtn = $("sendBtn"), micBtn = $("micBtn");
  const status = $("chatStatus"), fab = $("chatFab"), badge = $("chatBadge");

  let chat = { messages: [], busy: false };
  let lastCount = -1;
  let unread = 0;
  let open = localStorage.getItem("chatOpen") !== "0";
  let lastError = "";

  // The voice feature was removed: clear its cached model (~92 MB) and settings from this browser.
  if ("caches" in window) ["transformers-cache", "kokoro-voices"].forEach((c) => caches.delete(c).catch(() => {}));
  ["managerVoice", "managerVoiceId", "chatLang", "chatSpeak"].forEach((k) => localStorage.removeItem(k));

  function setOpen(v) {
    open = v;
    localStorage.setItem("chatOpen", v ? "1" : "0");
    box.hidden = !v;
    fab.hidden = v;
    document.body.classList.toggle("chat-open", v);
    if (v) {
      unread = 0;
      badge.hidden = true;
      log.scrollTop = log.scrollHeight;
      input.focus();
    }
  }

  function render() {
    const msgs = chat.messages || [];
    if (!msgs.length) {
      log.innerHTML = `<li class="empty">👋 I'm the team manager.<br>Tell me what you want built — I'll scope it, propose a plan, and get the team started once you say go.</li>`;
    } else {
      log.innerHTML = msgs
        .map((m) => {
          if (m.from === "system") return `<li class="sys"><span class="text">${esc(m.text)}</span></li>`;
          if (m.from === "user") return `<li class="me"><span class="from">YOU</span><span class="text">${esc(m.text)}</span></li>`;
          const a = AGENT_BY_ID[m.from];
          return `<li class="them"><span class="from"><i style="background:${a?.color || "#888"}"></i>${esc(m.from.toUpperCase())}</span><span class="text">${esc(m.text)}</span>${(m.relays || []).map((r) => `<span class="relay">${esc(r)}</span>`).join("")}${m.proposal ? proposalCard(m.proposal) : ""}</li>`;
        })
        .join("");
    }
    // while the manager is replying, show the reply as it's being written
    if (chat.busy) log.insertAdjacentHTML("beforeend", `<li class="them typing"><span class="from"><i style="background:#e66767"></i>MANAGER</span><span class="text" id="draftText"></span></li>`);
    if (lastError) log.insertAdjacentHTML("beforeend", `<li class="sys"><span class="text">${esc(lastError)}</span></li>`);
    renderDraft();

    status.textContent = chat.busy ? (chat.draft ? "● typing…" : "● thinking…") : lastError ? "● server unreachable" : "● online";
    status.className = "chat-status" + (chat.busy ? " busy" : lastError ? " off" : "");
    $("chatModel").textContent = chat.managerModel ? `· ${prettyModel(chat.managerModel)}` : "";
    $("chatModel").title = chat.managerModel ? `Manager model: ${chat.managerModel}` : "";
    sendBtn.disabled = chat.busy;
    $("chatSuggest").hidden = msgs.length > 0;
    renderRunBar();
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
    return `<div class="proposal">
      <div class="p-head">🚀 PROPOSED RUN</div>
      <div class="p-task">${esc(p.task)}</div>
      <div class="p-dir">📁 ${esc(p.dir)}${p.isNew ? " <b>(new folder)</b>" : ""}</div>
      ${pending ? `<div class="p-actions"><button class="px-btn small" data-run="start" data-id="${esc(p.id)}">▶ START</button><button class="px-btn small ghost" data-run="dismiss" data-id="${esc(p.id)}">NOT YET</button></div>` : ""}
    </div>`;
  }

  function renderRunBar() {
    const bar = $("runBar");
    const run = chat.run;
    if (!run) return void (bar.hidden = true);
    const icon = { running: "●", waiting: "⏳", finished: "✓", failed: "✖", stopped: "■", interrupted: "!" }[run.status] || "●";
    const active = run.status === "running" || run.status === "waiting";
    const recent = active || Date.now() - (run.endedAt || 0) < 10 * 60 * 1000;
    bar.hidden = !recent;
    bar.className = "run-bar " + run.status;
    let label = `${icon} RUN ${run.status.toUpperCase()}`;
    let detail = `${run.project} · ${run.task.split("\n")[0]}`;
    if (run.status === "waiting") {
      const mins = Math.max(0, Math.round((run.resumeAt - Date.now()) / 60000));
      const at = new Date(run.resumeAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      label = `⏳ PAUSED`;
      detail = `Out of usage — resumes at ${at} (${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`})`;
    } else if (run.attempts > 1 && run.status === "running") detail += ` · attempt ${run.attempts}`;
    bar.innerHTML = `<span class="r-status">${esc(label)}</span><span class="r-task" title="${esc(run.task)}">${esc(detail)}</span>${
      active ? `<button class="px-btn small ghost" data-run="stop" title="${run.status === "waiting" ? "Cancel the automatic resume" : "Stop the team"}">■ STOP</button>` : ""
    }`;
  }

  async function runAction(action, proposalId) {
    if (action === "stop" && !confirm(chat.run?.status === "waiting" ? "Cancel the paused run? It won't resume after the usage reset." : "Stop the team's current run?")) return;
    try {
      const res = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, proposalId }) });
      if (!res.ok) lastError = (await res.json().catch(() => ({}))).error || `Request failed (${res.status})`;
    } catch {
      lastError = "Can't reach the office server.";
    }
    poll();
  }
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-run]");
    if (b) runAction(b.dataset.run, b.dataset.id);
  });

  const seen = new Set(); // message ids already counted for the unread badge
  let primed = false;
  let polling = false;
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const res = await fetch("/api/chat", { cache: "no-store" });
      const next = await res.json();
      lastError = "";
      const msgs = next.messages || [];
      const fresh = msgs.filter((m) => m.id && !seen.has(m.id));
      fresh.forEach((m) => seen.add(m.id));
      if (primed && !open) {
        unread += fresh.filter((m) => m.from !== "user").length;
        badge.textContent = unread;
        badge.hidden = !unread;
      }
      primed = true;
      const changed =
        msgs.length !== lastCount || next.busy !== chat.busy || fresh.length > 0 || next.managerModel !== chat.managerModel ||
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
        lastError = "Can't reach the office server.";
        render();
      }
    } finally {
      polling = false;
    }
  }

  async function send(text) {
    text = text.trim();
    if (!text || chat.busy) return;
    input.value = "";
    autosize();
    chat = { ...chat, busy: true, messages: [...(chat.messages || []), { from: "user", text }] };
    render();
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        lastError = e.error || `Send failed (${res.status})`;
      }
    } catch {
      lastError = "Can't reach the office server.";
    }
    poll();
  }

  // ---- text input ----
  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  }
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input.value);
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    send(input.value);
  });
  $("chatSuggest").addEventListener("click", (e) => {
    if (e.target.tagName === "BUTTON") send(e.target.textContent);
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
      rec.lang = "en-US";
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

  $("chatMin").addEventListener("click", () => setOpen(false));
  fab.addEventListener("click", () => setOpen(true));

  setOpen(open);
  render();
  // poll fast while the manager is writing (to stream its reply), slowly otherwise
  (function loop() {
    poll().finally(() => setTimeout(loop, chat.busy ? 250 : 1000));
  })();

  return { open: () => setOpen(true) };
}
