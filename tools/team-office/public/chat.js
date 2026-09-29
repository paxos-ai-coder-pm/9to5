// Chat dock: talk to the manager by text (or dictate with the mic). Messages persist in .claude/team/chat.json via the server.
import { AGENT_BY_ID, esc, prettyModel } from "./agents.js";

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
          if (m.from === "user") return `<li class="me"><span class="from">${m.answer ? "YOU → TEAM" : "YOU"}</span><span class="text">${esc(m.text)}</span></li>`;
          const a = AGENT_BY_ID[m.from];
          const openAsk = m.ask && chat.ask && !chat.ask.answered && chat.ask.text === m.text;
          return `<li class="them${m.ask ? " question" : ""}"><span class="from"><i style="background:${a?.color || "#888"}"></i>${esc(m.from.toUpperCase())}${m.ask ? " · ❓ NEEDS YOUR ANSWER" : ""}</span><span class="text">${md(m.text)}</span>${(m.relays || []).map((r) => `<span class="relay">${esc(r)}</span>`).join("")}${m.proposal ? proposalCard(m.proposal) : ""}${
            openAsk ? `<div class="q-actions"><button class="px-btn small" data-answer="Approved - go ahead.">✓ APPROVE</button><button class="px-btn small ghost" data-reply="1">✎ REPLY</button></div>` : ""
          }</li>`;
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
    sendBtn.disabled = chat.busy && !replyAsk;
    renderChips();
    renderRunBar();
  }

  // Quick replies that fit the moment.
  function renderChips() {
    const run = chat.run;
    const recent = run && Date.now() - (run.endedAt || 0) < 6 * 3600e3;
    let chips;
    if (chat.ask && !chat.ask.answered) chips = [["✓ Approve", "answer:Approved - go ahead."], ["Explain the plan simply", "Explain the plan in simple terms — what will I get?"], ["✎ Reply to the team", "reply"]];
    else if (run?.status === "running") chips = [["What's happening now?"], ["Anything blocked?"], ["How long will it take?"]];
    else if (run?.status === "waiting") chips = [["When does it resume?"], ["What's done so far?"]];
    else if (run?.status === "finished" && recent) chips = [["How do I try it?"], ["Publish it to GitHub"], ["What should we improve next?"]];
    else if (run?.status === "failed" && recent) chips = [["What went wrong?"], ["Try again"]];
    else chips = [["Start a new project", "I want to build something new — ask me what I need."], ["Improve Merage Hub", "I want to improve Merage Hub — what could the team work on?"], ["What can the team do?"]];
    $("chatSuggest").innerHTML = chips.map(([label, action]) => `<button data-chip="${esc(action || label)}">${esc(label)}</button>`).join("");
  }

  // Reply mode: the next message goes straight to the team as the answer to its question.
  let replyAsk = null;
  function setReply(ask) {
    replyAsk = ask;
    input.placeholder = ask ? `Reply to the ${ask.agent} (goes straight to the team)…` : "Tell the manager what to build…";
    form.classList.toggle("replying", !!ask);
    sendBtn.disabled = false;
  }
  async function answer(text) {
    try {
      await fetch("/api/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    } catch {
      lastError = "Can't reach the office server.";
    }
    setReply(null);
    poll();
  }
  $("chatSuggest").addEventListener("click", (e) => {
    const b = e.target.closest("[data-chip]");
    if (!b) return;
    const a = b.dataset.chip;
    if (a.startsWith("answer:")) answer(a.slice(7));
    else if (a === "reply") replyTo(chat.ask);
    else send(a);
  });
  log.addEventListener("click", (e) => {
    const ans = e.target.closest("[data-answer]");
    if (ans) answer(ans.dataset.answer);
    if (e.target.closest("[data-reply]")) replyTo(chat.ask);
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
    return `<div class="proposal">
      <div class="p-head">🚀 PROPOSED RUN</div>
      <div class="p-task">${esc(p.task)}</div>
      <div class="p-dir">📁 ${esc(p.dir)}${p.isNew ? " <b>(new folder)</b>" : ""}</div>
      ${p.allowGithub ? `<div class="p-github">🔓 This run may <b>commit and push to GitHub</b>${p.githubAccount ? ` as <b>${esc(p.githubAccount)}</b>` : ""} (no force-push or deletes). Starting it gives that permission for this run only.</div>` : ""}
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
        JSON.stringify(next.ask) !== JSON.stringify(chat.ask) ||
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

  // Escape leaves reply mode
  input.addEventListener("keydown", (e) => e.key === "Escape" && replyAsk && setReply(null));

  return {
    open: () => setOpen(true),
    refresh: () => poll(),
    replyTo,
    // put text in the box (e.g. from an example or a project card); optionally send it right away
    prefill(text, sendNow = false) {
      setOpen(true);
      setReply(null);
      if (sendNow && !chat.busy) return send(text);
      input.value = text;
      autosize();
      input.focus();
    },
  };
}
