// Setup checklist (shown until Claude is installed and signed in) and the ⚙ Settings dialog.
import { esc, AGENTS, prettyModel } from "./agents.js";
import { createDialog, postJson, copyText } from "./ui.js";

export function createSetup({ onSettings } = {}) {
  const $ = (id) => document.getElementById(id);
  let health = null;
  let settings = null;
  let forced = false; // a "setup" button in the chat shows the card even if nothing is wrong

  function checkList(checks, { onlyProblems = false } = {}) {
    const list = onlyProblems ? checks.filter((c) => !c.ok && (c.required || !c.unknown)) : checks;
    return list
      .map((c) => {
        const icon = c.ok ? '<svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>' : c.required && !c.unknown ? '<svg class="icon" aria-hidden="true"><use href="#i-close"/></svg>' : ""; // unknown / optional: an empty box
        const cls = c.ok ? "ok" : c.required && !c.unknown ? "bad" : "opt";
        const fix = !c.ok && c.fix
          ? `<div class="fix">${esc(c.fix.text)}${c.fix.command ? `<div class="cmd"><code>${esc(c.fix.command)}</code><button type="button" class="px-btn small ghost" data-copy="${esc(c.fix.command)}">Copy</button></div>` : ""}${c.fix.link ? ` <a href="${esc(c.fix.link)}" target="_blank" rel="noopener noreferrer">How to install ↗</a>` : ""}</div>`
          : "";
        return `<li class="check-item ${cls}"><span class="ci" aria-hidden="true">${icon}</span><div><b>${esc(c.label)}</b>${c.required ? "" : ' <span class="muted">(optional)</span>'} <span class="muted">— ${esc(c.detail || "")}</span>${fix}</div></li>`;
      })
      .join("");
  }

  function render() {
    const checks = health?.checks || [];
    const problems = checks.filter((c) => c.required && !c.ok && !c.unknown);
    $("setup").hidden = !(problems.length || forced) || !checks.length;
    $("setupChecks").innerHTML = forced && !problems.length ? checkList(checks) : checkList(checks, { onlyProblems: true });
    $("settingsChecks").innerHTML = checkList(checks);
  }

  async function load(refresh = false) {
    try {
      health = await (await fetch(`/api/health${refresh ? "?refresh=1" : ""}`, { cache: "no-store" })).json();
    } catch {}
    render();
    return health;
  }
  async function recheck(btn) {
    btn.disabled = true;
    btn.textContent = "Checking…";
    await load(true);
    btn.disabled = false;
    btn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-redo"/></svg> Check again';
    if (health?.ready) forced = false;
    render();
  }
  $("setupRecheck").onclick = (e) => recheck(e.currentTarget);
  $("settingsRecheck").onclick = (e) => recheck(e.currentTarget);
  document.addEventListener("click", (e) => {
    const c = e.target.closest(".checks [data-copy]");
    if (c) copyText(c.dataset.copy, c);
  });

  // ---------- settings dialog ----------
  const dialog = createDialog($("settingsModal"));
  const theme = () => {
    try {
      return localStorage.getItem("theme") || "auto";
    } catch {
      return "auto";
    }
  };
  function fill() {
    if (!settings) return;
    $("setName").value = settings.studioName;
    $("setDir").value = settings.projectsRoot;
    $("setDir").disabled = settings.envProjects;
    $("setDirDefault").disabled = settings.envProjects;
    $("setDirNote").textContent = settings.envProjects
      ? "Set by the DEVSTUDIO_PROJECTS environment variable."
      : "New projects get their own folder in here. Projects you already have stay where they are.";
    $("setLight").checked = !!settings.lightTeam;
    for (const r of document.querySelectorAll('input[name="theme"]')) r.checked = r.value === theme();
  }
  function renderModels(configured, actual) {
    const el = $("teamModels");
    if (!el) return;
    el.innerHTML = AGENTS.map((a) => {
      const raw = actual?.[a.id] || configured?.[a.id] || "";
      const label = prettyModel(raw) || "—";
      return `<div class="tm-row"><span class="tm-name"><i class="tm-dot" style="background:${esc(a.color)}"></i>${esc(a.name)} <span class="muted">· ${esc(a.job.toLowerCase())}</span></span><span class="tm-model">${esc(label)}</span></div>`;
    }).join("");
  }

  // Opens at once with what is already known (a key pressed right after the click — Escape — must reach the dialog),
  // then fills in fresh values, unless you have already started changing them.
  let edited = false;
  $("settingsForm").addEventListener("input", () => (edited = true));
  async function openSettings() {
    $("settingsError").hidden = true;
    edited = false;
    fill();
    dialog.open();
    const [sRes, stRes] = await Promise.allSettled([
      fetch("/api/settings", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/state", { cache: "no-store" }).then((r) => r.json()),
    ]);
    if (sRes.status === "fulfilled") settings = sRes.value;
    if (stRes.status === "fulfilled") renderModels(stRes.value.configuredModels, stRes.value.models);
    if (dialog.isOpen() && !edited) fill();
    load();
  }
  $("settingsBtn").onclick = openSettings;
  $("settingsClose").onclick = () => dialog.close();
  $("setDirDefault").onclick = () => ($("setDir").value = settings?.defaultProjectsDir || "");
  for (const r of document.querySelectorAll('input[name="theme"]'))
    r.addEventListener("change", () => {
      try {
        r.value === "auto" ? localStorage.removeItem("theme") : localStorage.setItem("theme", r.value);
      } catch {}
      if (r.value === "auto") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = r.value;
    });
  $("settingsForm").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("settingsSave");
    btn.disabled = true;
    $("settingsError").hidden = true;
    try {
      const patch = { studioName: $("setName").value, lightTeam: $("setLight").checked };
      if (!settings?.envProjects) patch.projectsDir = $("setDir").value === settings?.defaultProjectsDir ? "" : $("setDir").value;
      settings = { ...settings, ...(await postJson("/api/settings", patch)) };
      fill();
      onSettings?.(settings);
      dialog.close();
    } catch (x) {
      $("settingsError").textContent = x.message;
      $("settingsError").hidden = false;
    }
    btn.disabled = false;
  };

  load();
  setInterval(() => !health?.ready && load(), 60000); // keep checking while something is missing

  return {
    // false while something required (Claude installed / signed in) is missing; null until the first check
    ready: () => (health ? health.checks.filter((c) => c.required).every((c) => c.ok || c.unknown) : null),
    // from a chat "setup" button: show the checklist (refreshed)
    show() {
      forced = true;
      load(true).then(() => {
        render();
        $("setup").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    openSettings,
  };
}
