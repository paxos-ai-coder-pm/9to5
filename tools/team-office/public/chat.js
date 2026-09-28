// Chat dock: talk to the manager by text or voice. Messages persist in .claude/team/chat.json via the server.
import { AGENT_BY_ID, esc } from "./agents.js";

export function createChat({ onSpeaking } = {}) {
  const $ = (id) => document.getElementById(id);
  const box = $("chat"), log = $("chatLog"), form = $("chatForm"), input = $("chatText");
  const sendBtn = $("sendBtn"), micBtn = $("micBtn"), speakBtn = $("speakBtn");
  const status = $("chatStatus"), fab = $("chatFab"), badge = $("chatBadge");

  let chat = { messages: [], busy: false };
  let lastCount = -1;
  let unread = 0;
  let open = localStorage.getItem("chatOpen") !== "0";
  // Manager speaks by default. (New key: the old "chatSpeak" was saved as off for everyone.)
  let speak = localStorage.getItem("managerVoice") !== "off";
  let voiceTurn = false; // you spoke → the manager always answers out loud
  let speaking = false;
  let lastError = "";
  const tts = "speechSynthesis" in window;

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
          return `<li class="them"><span class="from"><i style="background:${a?.color || "#888"}"></i>${esc(m.from.toUpperCase())}${tts ? `<button class="replay" data-id="${esc(m.id)}" title="Play aloud" aria-label="Play this message aloud">▶</button>` : ""}</span><span class="text">${esc(m.text)}</span>${(m.relays || []).map((r) => `<span class="relay">${esc(r)}</span>`).join("")}</li>`;
        })
        .join("");
    }
    if (chat.busy) log.insertAdjacentHTML("beforeend", `<li class="them typing"><span class="from"><i style="background:#e66767"></i>MANAGER</span><span class="text">typing</span></li>`);
    if (lastError) log.insertAdjacentHTML("beforeend", `<li class="sys"><span class="text">${esc(lastError)}</span></li>`);
    log.scrollTop = log.scrollHeight;

    renderStatus();
    sendBtn.disabled = chat.busy;
    $("chatSuggest").hidden = msgs.length > 0;
  }

  function renderStatus() {
    status.textContent = chat.busy ? "● typing…" : speaking ? "● speaking… (click 🔊 to stop)" : lastError ? "● server unreachable" : "● online";
    status.className = "chat-status" + (chat.busy || speaking ? " busy" : lastError ? " off" : "");
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
        const spoken = fresh.filter((m) => m.from !== "system");
        if (speak || (voiceTurn && spoken.some((m) => m.from === "manager"))) spoken.forEach((m) => say(m.text, m.from));
        if (spoken.some((m) => m.from === "manager")) voiceTurn = false;
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

  async function send(text, byVoice = false) {
    text = text.trim();
    if (!text || chat.busy) return;
    voiceTurn = byVoice;
    stopSpeaking();
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
      stopSpeaking(); // don't let the manager's voice leak into the mic
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
        if (finalText.trim()) send(input.value, true); // spoken message → send automatically, reply out loud
      };
      micBtn.setAttribute("aria-pressed", "true");
      lastError = "";
      rec.start();
    });
  }

  // ---- the manager speaks (Web Speech synthesis) ----
  // Prefer natural-sounding neural voices (Edge "Online (Natural)", Chrome "Google"), in the user's language.
  let voice = null;
  function pickVoice() {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;
    const lang = (navigator.language || "en-US").toLowerCase();
    const base = lang.split("-")[0];
    const score = (v) => {
      const n = v.name.toLowerCase();
      const l = v.lang.toLowerCase();
      return (l === lang ? 40 : l.startsWith(base) ? 25 : 0) + (/natural|neural/.test(n) ? 30 : 0) + (/online/.test(n) ? 10 : 0) + (/google/.test(n) ? 15 : 0) + (v.localService ? 0 : 3);
    };
    voice = [...voices].sort((a, b) => score(b) - score(a))[0];
  }

  // Strip markdown/URLs and split into sentences — Chrome cuts off utterances longer than ~15s.
  function chunks(text) {
    const clean = text
      .replace(/```[\s\S]*?```/g, " (code omitted) ")
      .replace(/https?:\/\/\S+/g, "a link")
      .replace(/[`*_#>|]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const parts = clean.match(/[^.!?]+[.!?]*\s*/g) || [clean];
    const out = [];
    for (const p of parts) {
      if (out.length && (out[out.length - 1] + p).length < 180) out[out.length - 1] += p;
      else out.push(p);
    }
    return out.filter((s) => s.trim());
  }

  let pending = 0;
  function setSpeakingState(v, text = "") {
    if (speaking === v) return;
    speaking = v;
    renderStatus();
    onSpeaking?.(v, text);
  }
  function say(text, from = "manager") {
    if (!tts) return;
    if (!voice) pickVoice();
    const parts = chunks(from === "manager" ? text : `${from} says: ${text}`);
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      if (voice) u.voice = voice;
      u.lang = voice?.lang || navigator.language || "en-US";
      u.rate = 1.03;
      pending++;
      if (i === 0) u.onstart = () => setSpeakingState(true, text);
      u.onend = u.onerror = () => {
        pending = Math.max(0, pending - 1);
        if (!pending) setSpeakingState(false);
      };
      speechSynthesis.speak(u);
    });
  }
  function stopSpeaking() {
    if (!tts) return;
    pending = 0;
    speechSynthesis.cancel();
    setSpeakingState(false);
  }

  function setSpeak(v) {
    speak = v;
    localStorage.setItem("managerVoice", v ? "on" : "off");
    speakBtn.setAttribute("aria-pressed", String(v));
    speakBtn.textContent = v ? "🔊" : "🔈";
    speakBtn.title = v ? "Manager speaks replies (click to mute)" : "Manager is muted (click to let them speak)";
    if (!v) stopSpeaking();
  }
  if (tts) {
    pickVoice();
    speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
  } else speakBtn.hidden = true;
  // While talking, the speaker button stops the current speech; otherwise it toggles mute.
  speakBtn.addEventListener("click", () => (speaking ? stopSpeaking() : setSpeak(!speak)));
  log.addEventListener("click", (e) => {
    const b = e.target.closest(".replay");
    if (!b) return;
    const m = (chat.messages || []).find((x) => x.id === b.dataset.id);
    if (m) {
      stopSpeaking();
      say(m.text, m.from);
    }
  });

  $("chatMin").addEventListener("click", () => setOpen(false));
  fab.addEventListener("click", () => setOpen(true));

  setSpeak(speak);
  setOpen(open);
  render();
  poll();
  setInterval(poll, 1000);

  return { open: () => setOpen(true) };
}
