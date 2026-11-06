// "📱" panel: connect a Telegram bot so you can talk to the manager from your phone.
import { esc } from "./agents.js";
import { createDialog } from "./ui.js";
import qrcode from "./vendor/qrcode.mjs"; // MIT, Kazuhiko Arase — vendored, no network

// The pairing link as a QR code (SVG), so the phone can scan it straight off the screen.
export function qrSvg(text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n} ${n}" role="img" aria-label="QR code for the pairing link" shape-rendering="crispEdges"><path d="${path}" fill="#000"/></svg>`;
}

export function createPhone() {
  const $ = (id) => document.getElementById(id);
  const modal = $("phoneModal");
  const dialog = createDialog(modal, { onClose: () => clearInterval(timer) });
  const body = $("phoneBody");
  let st = null;
  let timer = null;

  async function load() {
    try {
      st = await (await fetch("/api/telegram", { cache: "no-store" })).json();
    } catch {
      st = null;
    }
    paintButton();
    if (!modal.hidden) render();
  }
  async function post(payload) {
    const res = await fetch("/api/telegram", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
    st = j;
    paintButton();
    render();
  }

  function paintButton() {
    const b = $("phoneBtn");
    b.classList.toggle("on", !!st?.paired);
    b.title = st?.paired ? `Phone connected (${st.chatName} on Telegram) — click to manage` : "Talk to the manager from your phone (Telegram)";
  }

  function render(error = "") {
    const err = error ? `<p class="m-error">${esc(error)}</p>` : "";
    if (!st) return (body.innerHTML = `<p class="m-error">Can't reach the office server.</p>`);

    if (!st.configured) {
      body.innerHTML = `
        <p>Chat with your manager from anywhere using <b>Telegram</b> (free). Your PC connects out to Telegram, so there's nothing to open on your router. Only your own Telegram account will be able to use the bot.</p>
        <ol class="m-steps">
          <li>Install <b>Telegram</b> on your phone and sign in.</li>
          <li>In Telegram, open <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a> and send <code>/newbot</code>. Give it any name, e.g. <i>My Dev Studio</i>, and a username ending in <code>bot</code>.</li>
          <li>BotFather replies with a <b>token</b> like <code>123456789:AAH…</code>. Copy it and paste it here:</li>
        </ol>
        <form class="m-form" id="tokenForm">
          <input id="tokenInput" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your bot token" aria-label="Telegram bot token" />
          <button class="px-btn" type="submit">Connect</button>
        </form>
        <p class="m-note">The token stays on this PC (in a file that's never committed). Treat it like a password.</p>${err}`;
      $("tokenForm").onsubmit = async (e) => {
        e.preventDefault();
        const btn = e.submitter;
        btn.disabled = true;
        btn.textContent = "CHECKING…";
        try {
          await post({ action: "setup", token: $("tokenInput").value });
        } catch (x) {
          render(x.message);
        }
      };
      return;
    }

    if (!st.paired) {
      const mins = Math.max(1, Math.round((st.pairExpires - Date.now()) / 60000));
      body.innerHTML = `
        <p>✓ Bot <b>@${esc(st.botUsername)}</b> is connected. Now link it to <b>your</b> Telegram account:</p>
        <ol class="m-steps">
          <li>Point your phone's camera at this code (or open the link on your phone):
            <div class="qr">${qrSvg(st.pairLink)}<a class="m-link" href="${esc(st.pairLink)}" target="_blank" rel="noopener">${esc(st.pairLink)}</a></div></li>
          <li>Telegram opens the bot — tap <b>Start</b>. That's it.</li>
        </ol>
        <p class="m-note">Or send this to @${esc(st.botUsername)}: <code>/start ${esc(st.pairCode)}</code> · the code expires in ${mins} min <button class="px-btn small ghost" id="newCode">New code</button></p>
        <p class="m-wait">Waiting for you to tap Start…</p>
        ${st.lastError ? `<p class="m-error">${esc(st.lastError)}</p>` : ""}${err}
        <button class="px-btn small ghost" id="disconnectBtn">Use a different bot</button>`;
      $("newCode").onclick = () => post({ action: "newcode" }).catch((x) => render(x.message));
      $("disconnectBtn").onclick = () => post({ action: "disconnect" }).catch((x) => render(x.message));
      return;
    }

    body.innerHTML = `
      <p class="m-ok">Connected to <b>${esc(st.chatName)}</b> via <b>@${esc(st.botUsername)}</b>.</p>
      <ul class="m-list">
        <li>Message the bot like you'd message the manager here — same conversation.</li>
        <li>You'll get plan questions with <b>✓ Approve / ✎ Reply</b> buttons, proposals with <b>▶ Start</b>, and updates when a run pauses or finishes.</li>
        <li>Commands: <code>/status</code> · <code>/stop</code> · <code>/help</code></li>
        <li>Only works while the office is running on this PC (<code>devstudio</code>).</li>
      </ul>
      ${st.lastError ? `<p class="m-error">${esc(st.lastError)}</p>` : ""}${err}
      <button class="px-btn small ghost" id="disconnectBtn">Disconnect phone</button>`;
    $("disconnectBtn").onclick = () => {
      if (confirm("Disconnect your phone? You'll need to pair again to use Telegram.")) post({ action: "disconnect" }).catch((x) => render(x.message));
    };
  }

  function open() {
    render();
    dialog.open();
    load();
    clearInterval(timer);
    timer = setInterval(load, 3000); // notice pairing as soon as you tap Start
  }
  $("phoneBtn").onclick = open;
  $("phoneClose").onclick = () => dialog.close();

  load();
  setInterval(load, 60000);
}
