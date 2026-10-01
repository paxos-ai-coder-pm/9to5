// Telegram connector: talk to the manager from your phone.
// - Long-polls the Telegram Bot API (outbound HTTPS only — no public URL, tunnel, or port forwarding needed).
// - Private: only the one Telegram account that paired with a one-time code can use it.
// - Your messages → the manager; manager/team messages, questions (Approve/Reply buttons),
//   proposals (Start/Not yet) and run updates → your phone.
// The bot token is entered by the user in the office UI and stored in .claude/team/telegram.json (gitignored).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DIR, readChat, readState } from "./lib.mjs";

const CONFIG = path.join(DIR, "telegram.json");
const PAIR_TTL_MS = 15 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// same friendly names as the office (public/agents.js)
const LABEL = {
  manager: "💼 Maya · manager", architect: "📐 Asha · planner", "dev-1": "🛠 Ben · builder", "dev-2": "🛠 Chloe · builder",
  "tester-api": "🧪 Diego · checker", "tester-ui": "🧪 Emma · checker", "tester-edge": "🛡 Farid · safety check", reviewer: "🔍 Grace · final check", system: "ℹ️ Office",
};
const ACTION_BUTTON = { continue: "↻ Continue", retry: "↻ Try again" }; // the chat's next-step buttons that make sense on a phone

// chat markdown → Telegram HTML (escape first)
function toHtml(text) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const blocks = [];
  let s = esc(String(text)).replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre>${code.replace(/\n$/, "")}</pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>").replace(/^#{1,4} (.+)$/gm, "<b>$1</b>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
}
function chunks(text, max = 3800) {
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  out.push(rest);
  return out;
}

export function createTelegram({ onText, onAnswer, onRunAction, statusText, studioName = () => "Dev Studio", log = console.log }) {
  let cfg = load();
  let polling = false;
  let generation = 0; // bumps on disconnect/setup so an old poll loop stops
  let replyMode = false; // next text from the phone answers the team's open question
  let forwarding = false;

  function load() {
    try {
      return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
    } catch {
      return {};
    }
  }
  function save() {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
  }

  async function call(method, body = {}, token = cfg.token) {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(method === "getUpdates" ? 45000 : 15000),
    });
    const j = await res.json().catch(() => ({}));
    if (!j.ok) {
      const e = new Error(j.description || `Telegram HTTP ${res.status}`);
      e.status = j.error_code || res.status;
      throw e;
    }
    return j.result;
  }

  async function sendText(text, keyboard) {
    const parts = chunks(toHtml(text));
    for (let i = 0; i < parts.length; i++) {
      const body = { chat_id: cfg.chatId, text: parts[i], parse_mode: "HTML", disable_web_page_preview: true };
      if (keyboard && i === parts.length - 1) body.reply_markup = { inline_keyboard: keyboard };
      try {
        await call("sendMessage", body);
      } catch {
        // formatting problem → send as plain text
        await call("sendMessage", { ...body, parse_mode: undefined, text: String(text).slice(i * 3800, (i + 1) * 3800) });
      }
    }
  }

  // ---------- setup / pairing ----------
  function newPairCode() {
    cfg.pairCode = String(crypto.randomInt(100000, 1000000));
    cfg.pairExpires = Date.now() + PAIR_TTL_MS;
    save();
  }
  function status() {
    const pairing = cfg.token && !cfg.chatId;
    if (pairing && (!cfg.pairCode || Date.now() > cfg.pairExpires)) newPairCode();
    return {
      configured: !!cfg.token,
      botUsername: cfg.botUsername || null,
      paired: !!cfg.chatId,
      chatName: cfg.chatName || null,
      pairLink: pairing ? `https://t.me/${cfg.botUsername}?start=${cfg.pairCode}` : null,
      pairCode: pairing ? cfg.pairCode : null,
      pairExpires: pairing ? cfg.pairExpires : null,
      lastError: cfg.lastError || null,
    }; // never includes the token
  }
  async function setup(token) {
    token = String(token || "").trim();
    if (!/^\d{5,}:[\w-]{30,}$/.test(token)) throw new Error("That doesn't look like a bot token (it should look like 123456789:ABC…).");
    const me = await call("getMe", {}, token);
    generation++;
    cfg = { token, botUsername: me.username, offset: 0 };
    newPairCode();
    start();
    return status();
  }
  function disconnect() {
    generation++;
    const hadChat = cfg.chatId;
    const old = cfg;
    cfg = {};
    save();
    if (hadChat) call("sendMessage", { chat_id: hadChat, text: "🔌 Disconnected from the Dev Studio. Pair again from the office to reconnect." }, old.token).catch(() => {});
    return status();
  }

  // ---------- inbound ----------
  async function pollLoop() {
    if (polling || !cfg.token) return;
    polling = true;
    const gen = generation;
    // drop anything queued while the office was off (don't act on stale commands)
    if (!cfg.offset) {
      try {
        const old = await call("getUpdates", { offset: -1, timeout: 0 });
        if (old.length) cfg.offset = old.at(-1).update_id + 1;
        save();
      } catch {}
    }
    while (cfg.token && gen === generation) {
      try {
        const updates = await call("getUpdates", { offset: cfg.offset || 0, timeout: 30, allowed_updates: ["message", "callback_query"] });
        if (cfg.lastError) {
          cfg.lastError = null;
          save();
        }
        for (const u of updates) {
          cfg.offset = u.update_id + 1;
          save();
          await handleUpdate(u).catch((e) => log(`[telegram] ${e.message}`));
        }
      } catch (e) {
        if (gen !== generation) break;
        cfg.lastError = e.status === 409 ? "Another program is using this bot (only one office can run it at a time)." : e.status === 401 ? "The bot token was revoked — connect again." : `Can't reach Telegram: ${e.message}`;
        save();
        await sleep(e.status === 401 ? 60000 : 5000);
      }
    }
    polling = false;
  }

  function help() {
    return sendText(
      `👋 This is your ${studioName()} manager.\n\nJust type what you want built or ask how things are going.\n\n` +
        "/status — what the team is doing\n/stop — stop the current run\n/help — this message\n\n" +
        "When the team needs your answer you'll get answer buttons (or ✎ Reply to type your own).",
    );
  }

  async function typingWhileBusy() {
    for (let i = 0; i < 60; i++) {
      await sleep(i === 0 ? 300 : 4500);
      if (!readChat().busy) return;
      await call("sendChatAction", { chat_id: cfg.chatId, action: "typing" }).catch(() => {});
    }
  }

  async function handleUpdate(u) {
    if (u.callback_query) return handleButton(u.callback_query);
    const m = u.message;
    if (!m || m.chat.type !== "private") return;
    const text = (m.text || "").trim();

    if (!cfg.chatId) {
      const code = text.match(/^\/start\s+(\d{6})$/)?.[1];
      if (code && code === cfg.pairCode && Date.now() < cfg.pairExpires) {
        cfg.chatId = m.chat.id;
        cfg.chatName = m.from?.username ? `@${m.from.username}` : m.from?.first_name || "you";
        cfg.pairCode = null;
        cfg.lastSentId = readChat().messages.at(-1)?.id || null; // start fresh — don't dump history
        save();
        await sendText(`✅ Paired with ${studioName()}, ${cfg.chatName}!`);
        return help();
      }
      return call("sendMessage", { chat_id: m.chat.id, text: "🔒 This bot is private. Pair it from the Dev Studio office (📱 Phone button)." });
    }
    if (m.chat.id !== cfg.chatId) return call("sendMessage", { chat_id: m.chat.id, text: "🔒 This bot is private." });
    if (!text) return sendText("I can only read text messages for now.");
    if (/^\/(start|help)\b/.test(text)) return help();
    if (/^\/status\b/.test(text)) return sendText(statusText());
    if (/^\/stop\b/.test(text))
      return sendText("Stop the team's current run?", [[{ text: "■ Yes, stop it", callback_data: "stop" }, { text: "Cancel", callback_data: "noop" }]]);

    if (replyMode) {
      replyMode = false;
      const r = onAnswer(text, "telegram");
      return sendText(r.error ? `⚠ ${r.error}` : "✓ Sent to the team — they'll pick it up within a minute.");
    }
    const r = await onText(text, "telegram");
    if (r.error) return sendText(`⏳ ${r.error}`);
    if (!r.blocked) typingWhileBusy();
  }

  async function handleButton(q) {
    const answerCb = (text) => call("answerCallbackQuery", { callback_query_id: q.id, text }).catch(() => {});
    if (!cfg.chatId || q.from.id !== cfg.chatId) return answerCb("This bot is private.");
    const [action, arg, arg2] = String(q.data || "").split(":");
    const clearButtons = () => call("editMessageReplyMarkup", { chat_id: cfg.chatId, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    if (action === "approve") {
      const r = onAnswer("Approved - go ahead.", "telegram");
      await answerCb(r.error ? r.error : "Approved ✓");
      if (!r.error) clearButtons();
    } else if (action === "reply") {
      replyMode = true;
      await answerCb("Type your reply");
      await sendText("✎ Type your reply — it goes straight to the team.");
    } else if (action === "opt") {
      // one of the answer buttons of the team's question
      const option = readState().ask?.options?.[Number(arg)];
      const r = option ? onAnswer(option, "telegram") : { error: "That question was already answered." };
      await answerCb(r.error ? r.error : `Sent: ${option}`);
      clearButtons();
    } else if (action === "ch") {
      // one of the manager's suggested answers → as if the user typed it
      const choice = cfg.lastChoices?.id === arg ? cfg.lastChoices.choices[Number(arg2)] : null;
      if (!choice) return answerCb("That question has moved on — just type your answer.");
      const r = await onText(choice, "telegram");
      await answerCb(r.error ? r.error : choice);
      clearButtons();
      if (!r.error && !r.blocked) typingWhileBusy();
    } else if (action === "run") {
      const r = onRunAction(arg, { runId: arg2 }, "telegram");
      await answerCb(r.error ? r.error : arg === "continue" ? "Continuing…" : "OK");
      clearButtons();
    } else if (action === "start" || action === "dismiss") {
      const r = onRunAction(action, { proposalId: arg }, "telegram");
      await answerCb(r.error ? r.error : action === "start" ? "Starting the team…" : "OK, not yet");
      clearButtons();
    } else if (action === "stop") {
      const r = onRunAction("stop", {}, "telegram");
      await answerCb(r.ok ? "Stopping…" : "Nothing is running");
      clearButtons();
    } else {
      await answerCb("OK");
      clearButtons();
    }
  }

  // ---------- outbound: forward new team/manager/office messages ----------
  async function forward() {
    if (forwarding || !cfg.chatId) return;
    forwarding = true;
    try {
      const chat = readChat();
      const msgs = chat.messages || [];
      let i = cfg.lastSentId ? msgs.findIndex((m) => m.id === cfg.lastSentId) : msgs.length - 1;
      if (i === -1) i = msgs.length - 1; // history was trimmed — resume from the end
      for (const m of msgs.slice(i + 1)) {
        if (m.from !== "user") {
          let text = `**${LABEL[m.from] || m.from}**\n${m.text}`;
          let keyboard;
          if (m.report) {
            const r = m.report;
            const list = (title, items) => (items?.length ? `\n\n**${title}**\n${items.map((i) => `• ${i}`).join("\n")}` : "");
            text += list("What you got", r.got) + list("How to open it", r.howToOpen) + list("Not in this version yet", r.notYet) + list("Ideas for next time", r.next);
          }
          if (m.choices?.length) {
            cfg.lastChoices = { id: m.id.slice(0, 8), choices: m.choices };
            keyboard = m.choices.map((c, i) => [{ text: c, callback_data: `ch:${m.id.slice(0, 8)}:${i}` }]);
          }
          const runButtons = (m.actions || []).filter((a) => ACTION_BUTTON[a.kind] && a.runId).map((a) => ({ text: ACTION_BUTTON[a.kind], callback_data: `run:${a.kind}:${a.runId}`.slice(0, 64) }));
          if (runButtons.length) keyboard = [runButtons];
          if (m.proposal) {
            const p = m.proposal;
            text += `\n\n🚀 **Proposed run** — ${p.project}${p.isNew ? " (new folder)" : ""}\n${p.task.slice(0, 700)}${p.task.length > 700 ? "…" : ""}`;
            if (p.allowGithub) text += `\n\n🔓 This run may commit and push to GitHub${p.githubAccount ? ` as ${p.githubAccount}` : ""}.`;
            if (chat.proposal?.id === p.id) keyboard = [[{ text: "▶ Start", callback_data: `start:${p.id}` }, { text: "Not yet", callback_data: `dismiss:${p.id}` }]];
          }
          if (m.ask)
            keyboard = m.options?.length
              ? [...m.options.map((o, i) => [{ text: o, callback_data: `opt:${i}` }]), [{ text: "✎ Reply", callback_data: "reply" }]]
              : [[{ text: "✓ Approve", callback_data: "approve" }, { text: "✎ Reply", callback_data: "reply" }]];
          await sendText(text, keyboard);
        }
        cfg.lastSentId = m.id;
        save();
      }
    } catch (e) {
      log(`[telegram] forward failed: ${e.message}`);
    }
    forwarding = false;
  }

  function start() {
    if (!cfg.token) return;
    pollLoop();
  }
  setInterval(forward, 1500).unref?.();
  start();

  return { status, setup, disconnect, newPairCode: () => (newPairCode(), status()) };
}
