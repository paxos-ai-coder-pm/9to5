// Chat dock: talk to the manager by text or voice. Messages persist in .claude/team/chat.json via the server.
import { AGENT_BY_ID, esc } from "./agents.js";

export function createChat() {
  const $ = (id) => document.getElementById(id);
  const box = $("chat"), log = $("chatLog"), form = $("chatForm"), input = $("chatText");
  const sendBtn = $("sendBtn"), micBtn = $("micBtn"), speakBtn = $("speakBtn");
  const status = $("chatStatus"), fab = $("chatFab"), badge = $("chatBadge");

  let chat = { messages: [], busy: false };
  let lastCount = -1;
  let unread = 0;
  let open = localStorage.getItem("chatOpen") !== "0";
  let speak = localStorage.getItem("chatSpeak") === "1";
  let lastError = "";

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
      log.innerHTML = `<li class="empty">👋 I'm the team manager.<br>Ask me how the work is going, or give the team instructions — I'll pass them on.<br><br>Type, or tap 🎤 to talk.</li>`;
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

  async function poll() {
    try {
      const res = await fetch("/api/chat", { cache: "no-store" });
      const next = await res.json();
      lastError = "";
      const count = (next.messages || []).length;
      const changed = count !== lastCount || next.busy !== chat.busy;
      if (lastCount >= 0 && count > lastCount) {
        const fresh = next.messages.slice(lastCount).filter((m) => m.from !== "user");
        if (!open) {
          unread += fresh.length;
          badge.textContent = unread;
          badge.hidden = !unread;
        }
        if (speak) fresh.filter((m) => m.from !== "system").forEach((m) => say(m.text));
      }
      chat = next;
      lastCount = count;
      if (changed) render();
    } catch {
      if (!lastError) {
        lastError = "Can't reach the office server.";
        render();
      }
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
    lastCount = -1; // force a full refresh from the server
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

  // ---- voice input (Web Speech API: Chrome, Edge, Safari) ----
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  if (!SR) {
    micBtn.disabled = true;
    micBtn.title = "Voice input isn't supported in this browser — try Chrome or Edge";
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
        lastError = e.error === "not-allowed" ? "Microphone access was blocked — allow it in the browser to use voice." : `Voice input error: ${e.error}`;
        render();
      };
      rec.onend = () => {
        micBtn.setAttribute("aria-pressed", "false");
        rec = null;
        if (finalText.trim()) send(input.value); // spoken message → send automatically
      };
      micBtn.setAttribute("aria-pressed", "true");
      lastError = "";
      rec.start();
    });
  }

  // ---- read replies aloud ----
  function say(text) {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text.replace(/[`*_#>]/g, ""));
    u.rate = 1.05;
    speechSynthesis.speak(u);
  }
  function setSpeak(v) {
    speak = v;
    localStorage.setItem("chatSpeak", v ? "1" : "0");
    speakBtn.setAttribute("aria-pressed", String(v));
    speakBtn.textContent = v ? "🔊" : "🔈";
    if (!v && "speechSynthesis" in window) speechSynthesis.cancel();
  }
  if (!("speechSynthesis" in window)) speakBtn.hidden = true;
  speakBtn.addEventListener("click", () => setSpeak(!speak));

  $("chatMin").addEventListener("click", () => setOpen(false));
  fab.addEventListener("click", () => setOpen(true));

  setSpeak(speak);
  setOpen(open);
  render();
  poll();
  setInterval(poll, 1000);

  return { open: () => setOpen(true) };
}
