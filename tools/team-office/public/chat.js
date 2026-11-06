// Chat dock: talk to Maya (the manager) by text or dictation. Messages persist in .claude/team/chat.json via the server.
// Besides text, messages can carry: a proposal card (▶ Start), the manager's suggested answers (buttons), the team's
// question with answer buttons, a final report card, next-step buttons (continue, try again, open, redo, setup) and
// collapsed technical details.
import { AGENT_BY_ID, esc, prettyModel } from "./agents.js";
import { postJson, openProject, isSimple } from "./ui.js";

// Minimal, safe markdown for chat bubbles: escape first, then code blocks, inline code, bold, bullets, and links to
// http(s) only — [text](url) or a bare address (the team posts repo URLs as plain text).
function md(text) {
  const kept = []; // finished HTML set aside, so later steps (bare links, bullets) don't reach inside it
  const keep = (html) => `\u0000${kept.push(html) - 1}\u0000`;
  const link = (href, label) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  let s = esc(text)
    // a code block is its own block: drop the line breaks around it (the box has its own margin)
    .replace(/\n{0,2}```[\w-]*\n?([\s\S]*?)```\n{0,2}/g, (_, code) => keep(`<pre class="md-code">${code.replace(/\n$/, "")}</pre>`))
    .replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${code}</code>`))
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, href) => keep(link(href, label)))
    // a bare address ends at a space, an escaped quote or bracket; trailing punctuation belongs to the sentence
    .replace(/https?:\/\/(?:(?!&quot;|&#39;|&lt;|&gt;)[^\s\u0000])+/g, (url) => {
      const [, href, tail] = url.match(/^(.*?)([.,;:!?)*]*)$/);
      return keep(link(href, href)) + tail;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/^#{1,4} (.+)$/gm, "<b>$1</b>")
    .replace(/^([ \t]*)[-*] (?=\S)/gm, "$1• ");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[+i]);
}

const SIZE = { quick: "Quick change", standard: "Standard", full: "Full team (extra checks)" };
const ACTION = {
  continue: '<svg class="icon" aria-hidden="true"><use href="#i-redo"/></svg> Continue',
  retry: '<svg class="icon" aria-hidden="true"><use href="#i-redo"/></svg> Try again',
  setup: '<svg class="icon" aria-hidden="true"><use href="#i-settings"/></svg> Show me how to fix it',
  ask: "What happened?",
  open: '<svg class="icon" aria-hidden="true"><use href="#i-play"/></svg> Open it',
  change: '<svg class="icon" aria-hidden="true"><use href="#i-edit"/></svg> Change something',
  redo: '<svg class="icon" aria-hidden="true"><use href="#i-redo"/></svg> Redo',
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
  let lastError = "";
  const wide = window.matchMedia("(min-width: 1101px)");
  const phone = window.matchMedia("(max-width: 600px)");
  const chatBackground = document.querySelectorAll("body > :is(.skip, .top, .setup, .ask-banner, .welcome, .banner), .grid > :not(#chat)");
  const inPage = () => wide.matches && isSimple();
  let open = wide.matches && localStorage.getItem("chatOpen") !== "0";

  // The voice feature was removed: clear its cached model (~92 MB) and settings from this browser.
  if ("caches" in window) ["transformers-cache", "kokoro-voices"].forEach((c) => caches.delete(c).catch(() => {}));
  ["managerVoice", "managerVoiceId", "chatLang", "chatSpeak"].forEach((k) => localStorage.removeItem(k));

  function setOpen(v, focus = true) {
    open = v;
    if (wide.matches && !inPage()) localStorage.setItem("chatOpen", v ? "1" : "0");
    show(focus);
  }

  function show(focus = false) {
    const v = open || inPage();
    const modal = v && phone.matches;
    for (const section of chatBackground) section.inert = modal;
    if (modal) {
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
    } else {
      box.removeAttribute("role");
      box.removeAttribute("aria-modal");
    }
    box.hidden = !v;
    fab.hidden = v;
    fab.setAttribute("aria-expanded", String(v));
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
      log.innerHTML = `<li class="empty"><span class="chat-welcome-icon" aria-hidden="true"><svg class="icon"><use href="#i-spark"/></svg></span><strong>Hi, I’m Maya.</strong><p>Tell me what you have in mind. I’ll draft a plan for you to review before the team starts.</p></li>`;
    } else {
      log.innerHTML = msgs
        .map((m, i) => {
          const details = m.details ? `<details class="msg-details"><summary>Details</summary><pre>${esc(m.details)}</pre></details>` : "";
          if (m.from === "system")
            return `<li class="sys"><span class="text">${esc(m.text)}</span>${m.proposal ? proposalCard(m.proposal) : ""}${actionButtons(m.actions)}${details}</li>`;
          if (m.from === "user") return `<li class="me"><span class="from">${m.answer ? "You → team" : "You"}${m.via === "telegram" ? " · from your phone" : ""}</span><span class="text">${esc(m.text)}</span></li>`;
          const a = AGENT_BY_ID[m.from];
          const openAsk = m.ask && chat.ask && !chat.ask.answered && chat.ask.text === m.text;
          const answers = openAsk
            ? `<div class="q-actions">${(m.options?.length ? m.options.map((o) => `<button type="button" class="px-btn small" data-answer="${esc(o)}">${esc(o)}</button>`) : [`<button type="button" class="px-btn small" data-answer="Approved - go ahead.">Approve</button>`]).join("")}<button type="button" class="px-btn small ghost" data-reply="1"><svg class="icon" aria-hidden="true"><use href="#i-edit"/></svg> Reply</button></div>`
            : "";
          // the manager's suggested answers, while they're still the latest thing in the chat
          const choices = m.choices?.length && i === lastIdx && !chat.busy ? `<div class="choices">${m.choices.map((c) => `<button type="button" data-send="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : "";
          return `<li class="them${openAsk ? " question" : ""}"><span class="from"><i style="background:${a?.color || "var(--text-muted)"}"></i>${who(m)}${openAsk ? " · needs your answer" : ""}</span><span class="text">${md(m.text)}</span>${m.report ? reportCard(m.report) : ""}${(m.relays || []).map((r) => `<span class="relay">${esc(r)}</span>`).join("")}${m.proposal ? proposalCard(m.proposal) : ""}${answers}${choices}${details}</li>`;
        })
        .join("");
    }
    // while the manager is replying, show the reply as it's being written
    if (chat.busy) log.insertAdjacentHTML("beforeend", `<li class="them typing"><span class="from"><i style="background:${AGENT_BY_ID.manager.color}"></i>${isSimple() ? "MAYA" : "MANAGER"}</span><span class="text" id="draftText"></span></li>`);
    if (lastError) log.insertAdjacentHTML("beforeend", `<li class="sys"><span class="text">${esc(lastError)}</span></li>`);

    status.textContent = chat.busy ? (chat.draft ? "Typing…" : "Thinking…") : lastError ? "Unavailable" : "Online";
    status.className = "chat-status" + (chat.busy ? " busy" : lastError ? " off" : "");
    $("chatModel").textContent = chat.managerModel ? `· ${prettyModel(chat.managerModel)}` : "";
    $("chatModel").title = chat.managerModel ? `Manager model: ${chat.managerModel}` : "";
    sendBtn.disabled = chat.busy && !replyAsk;
    renderChips();
    renderRunBar();
    renderQueue();
    renderDraft(); // last: the run bar and the chips change how tall the log is
  }

  // Quick replies that fit the moment.
  function renderChips() {
    const run = chat.run;
    const recent = run && Date.now() - (run.endedAt || 0) < 6 * 3600e3;
    let chips;
    if (chat.ask && !chat.ask.answered) chips = [["Explain it simply", "Explain the team's question in simple terms — what will I get?"], ["Reply to the team", "reply"]];
    else if (run?.status === "running") chips = [["What's happening now?"], ["How long will it take?"], ["Anything I need to do?"]];
    else if (run?.status === "waiting") chips = [["When does it continue?"], ["What's done so far?"]];
    else if (run?.status === "needs-answer") chips = [["What does the team need from me?"], ["Explain the question simply"]];
    else if (run?.status === "finished" && recent) chips = [["How do I use it?"], ["Put it online"], ["What could we improve next?"]];
    else if (["failed", "interrupted"].includes(run?.status) && recent) chips = [["What went wrong?"], ["Can the team fix it?"]];
    else chips = [["Improve a project", "I want to improve one of my existing projects — which ones can the team work on?"], ["What can the team do?"]];
    if (chat.proposal) chips = []; // a plan is waiting for Start: that's the next step, and it gets the room
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
      <div class="p-head"><span class="p-label">Ready to start</span> · ${esc(SIZE[p.size] || SIZE.standard)}${p.estimate ? ` · usually about ${p.estimate} min` : ""}</div>
      <div class="p-task">${esc(p.task)}</div>
      <div class="p-dir" title="${esc(p.dir)}">${p.isNew ? `New project “${esc(folder)}”` : `Changes to “${esc(folder)}”`}<span class="tech"> — ${esc(p.dir)}</span></div>
      ${p.foreign ? `<div class="p-warn"><b>Heads up:</b> this folder already has files the studio didn't make — the team will change them. (You can undo the run afterwards.)</div>` : ""}
      ${p.allowGithub ? `<div class="p-github">This run may <b>publish to GitHub</b>${p.githubAccount ? ` as <b>${esc(p.githubAccount)}</b>` : ""} (no force-push or deletes). Starting it gives that permission for this run only.</div>` : ""}
      ${pending ? `<div class="p-actions"><button type="button" class="px-btn small" data-run="start" data-id="${esc(p.id)}">${busy ? "Queue it" : '<svg class="icon" aria-hidden="true"><use href="#i-play"/></svg> Start'}</button><button type="button" class="px-btn small ghost" data-run="dismiss" data-id="${esc(p.id)}">Not yet</button></div>${busy ? `<div class="p-note">The team is busy — this starts right after the current run.</div>` : ""}` : ""}
    </div>`;
  }

  function renderRunBar() {
    const bar = $("runBar");
    const run = chat.run;
    if (!run) return void (bar.hidden = true);
    const mark = { running: "active", waiting: "ready", "needs-answer": "ready", finished: "done", failed: "blocked", stopped: "pending", interrupted: "blocked" }[run.status] || "active";
    const active = ["running", "waiting", "needs-answer"].includes(run.status);
    const recent = active || Date.now() - (run.endedAt || 0) < 10 * 60 * 1000;
    bar.hidden = !recent;
    bar.className = "run-bar " + run.status;
    const words = { running: "Working", finished: "Finished", failed: "Needs attention", stopped: "Stopped", interrupted: "Interrupted" };
    let label = words[run.status] || run.status;
    let detail = `${run.project} · ${firstLine(run.task)}`;
    if (run.status === "waiting") {
      const mins = Math.max(0, Math.round((run.resumeAt - Date.now()) / 60000));
      const at = new Date(run.resumeAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      label = "Paused";
      detail = `Out of usage — continues at ${at} (${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`})`;
    } else if (run.status === "needs-answer") {
      label = "Waiting for you";
      detail = "The team needs your answer to continue — nothing is built yet";
    } else if (run.attempts > 1 && run.status === "running" && !isSimple()) detail += ` · attempt ${run.attempts}`;
    const stopTitle = { waiting: "Cancel the automatic resume", "needs-answer": "Cancel this run instead of answering" }[run.status] || "Stop the team";
    bar.innerHTML = `<span class="r-status"><span class="chip ${mark}" aria-hidden="true"></span>${esc(label)}</span><span class="r-task" title="${esc(run.task)}">${esc(detail)}</span>${
      active ? `<button type="button" class="px-btn small ghost" data-run="stop" title="${stopTitle}"><svg class="icon" aria-hidden="true"><use href="#i-stop"/></svg> Stop</button>` : ""
    }`;
  }

  function renderQueue() {
    const q = chat.queue || [];
    const bar = $("queueBar");
    bar.hidden = !q.length;
    bar.innerHTML = q.length
      ? `<span class="q-label">Next up</span><ol>${q.map((x, i) => `<li><span>${esc(x.task)}</span><button type="button" class="icon-btn small" data-unqueue="${i}" aria-label="Remove “${esc(x.task)}” from the queue" title="Remove from the queue">✕</button></li>`).join("")}</ol>`
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
        if (box.hidden) {
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
        status.textContent = chat.draft ? "Typing…" : "Thinking…";
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

  async function send(text, fromIdea = false) {
    text = text.trim();
    if (!text) return;
    if (replyAsk && !fromIdea) {
      input.value = "";
      autosize();
      return answer(text); // reply mode → straight to the team's inbox
    }
    if (chat.busy) return;
    if (!fromIdea) {
      input.value = "";
      autosize();
    }
    chat = { ...chat, busy: true, messages: [...(chat.messages || []), { from: "user", text }] };
    render();
    try {
      await postJson("/api/chat", { text });
      lastError = "";
    } catch (x) {
      // nothing was sent: say why in plain words, and give the words back (the idea box keeps its own copy)
      const why = x.message === "Failed to fetch" ? "the office isn't responding — check that it's still running"
        : /^(forbidden|bad request|not found|Request failed)/.test(x.message) ? "the office couldn't take it"
        : x.message.replace(/\.$/, "");
      lastError = `Not sent — ${why}. Your message is still in the box, so you can send it again.`;
      if (!fromIdea && !input.value.trim()) {
        input.value = text;
        autosize();
      }
    }
    poll();
    return lastError;
  }

  // ---- text input ----
  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
  }
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send(input.value);
    }
    if (e.key === "Escape" && replyAsk) {
      e.stopPropagation();
      setReply(null);
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

  function minimize() {
    setOpen(false);
    fab.focus();
  }
  $("chatMin").addEventListener("click", minimize);
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !inPage()) minimize();
  });
  fab.addEventListener("click", () => setOpen(true));
  window.addEventListener("viewchange", () => (show(), render()));
  phone.addEventListener("change", () => show());
  wide.addEventListener("change", () => {
    open = wide.matches && localStorage.getItem("chatOpen") !== "0";
    show();
  });

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

  function sendIdea(text) {
    if (chat.busy) return "Maya is replying. Try again in a moment.";
    setOpen(true, false);
    box.focus({ preventScroll: inPage() });
    return send(text, true);
  }

  return { open: () => setOpen(true), refresh: () => poll(), replyTo, prefill, sendIdea };
}
