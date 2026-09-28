// Chat dock: talk to the manager by text (or dictate with the mic). Messages persist in .claude/team/chat.json via the server.
import { AGENT_BY_ID, esc } from "./agents.js";

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
      log.innerHTML = `<li class="empty">👋 I'm the team manager.<br>Ask me how the work is going, or give the team instructions — I'll pass them on.</li>`;
    } else {
      log.innerHTML = msgs
        .map((m) => {
          if (m.from === "system") return `<li class="sys"><span class="text">${esc(m.text)}</span></li>`;
          if (m.from === "user") return `<li class="me"><span class="from">YOU</span><span class="text">${esc(m.text)}</span></li>`;
          const a = AGENT_BY_ID[m.from];
          return `<li class="them"><span class="from"><i style="background:${a?.color || "#888"}"></i>${esc(m.from.toUpperCase())}</span><span class="text">${esc(m.text)}</span>${(m.relays || []).map((r) => `<span class="relay">${esc(r)}</span>`).join("")}</li>`;
        })
        .join("");
    }
    if (chat.busy) log.insertAdjacentHTML("beforeend", `<li class="them typing"><span class="from"><i style="background:#e66767"></i>MANAGER</span><span class="text">typing</span></li>`);
    if (lastError) log.insertAdjacentHTML("beforeend", `<li class="sys"><span class="text">${esc(lastError)}</span></li>`);
    log.scrollTop = log.scrollHeight;

    status.textContent = chat.busy ? "● typing…" : lastError ? "● server unreachable" : "● online";
    status.className = "chat-status" + (chat.busy ? " busy" : lastError ? " off" : "");
    sendBtn.disabled = chat.busy;
    $("chatSuggest").hidden = msgs.length > 0;
  }

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
      const changed = msgs.length !== lastCount || next.busy !== chat.busy || fresh.length > 0;
      chat = next;
      lastCount = msgs.length;
      if (changed) render();
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
  poll();
  setInterval(poll, 1000);

  return { open: () => setOpen(true) };
}
