// "My Projects": the commission book — one numbered entry per project: a picture, what it is, its sign-off stamps,
// Open, Change something, and its history (with Undo). Git/GitHub details are behind the scenes.
import { esc, AGENT_BY_ID } from "./agents.js";
import { postJson, copyText, openProject } from "./ui.js";

const STATUS = {
  running: { label: "Being built", cls: "active" },
  waiting: { label: "Paused (usage limit)", cls: "ready" },
  "needs-answer": { label: "Waiting for your answer", cls: "ready" },
  finished: { label: "Ready", cls: "done" },
  failed: { label: "Needs attention", cls: "blocked" },
  stopped: { label: "Stopped", cls: "pending" },
  interrupted: { label: "Interrupted", cls: "blocked" },
};
// a run in the Changes list: its stamp box, and the word for people who can't see it
const RUN_MARK = { finished: ["done", "finished"], failed: ["blocked", "failed"], interrupted: ["blocked", "interrupted"], stopped: ["pending", "stopped"], running: ["active", "running"], waiting: ["ready", "paused"], "needs-answer": ["ready", "waiting for you"] };
// who signs each station of a finished project; which testers check depends on the job, so they go unnamed
const crew = (...ids) => ids.map((id) => AGENT_BY_ID[id]);
const SIGNOFF = (size) => [
  ["Planned", crew("architect")],
  ["Built", size === "quick" ? crew("dev-1") : crew("dev-1", "dev-2")],
  ["Checked", null],
  ["Signed off", crew("reviewer")],
];

function ago(ms) {
  if (!ms) return "—";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
const when = (ms) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function createPortfolio({ chat }) {
  const host = document.getElementById("portfolio");
  const hiddenBtn = document.getElementById("showHidden");
  let projects = [];
  let nextNo = null; // the next new project's number (once the list has loaded)
  let known = null; // each project's status at the last refresh: what changed since is what moves
  let showHidden = false;
  let lastHtml = "";
  const openDetails = new Set(); // keep <details> open across refreshes

  function openLabel(p) {
    const kind = p.app?.kind;
    const play = '<svg class="icon" aria-hidden="true"><use href="#i-play"/></svg>';
    if (p.appState?.status === "running" && p.appState.url) return `${play} Open again`;
    return `${play} ${kind === "script" ? "Run" : kind === "extension" || kind === "other" ? "How to use" : "Open"}`;
  }

  function card(p, motion = "") {
    const st = STATUS[p.status] || { label: p.status, cls: "pending" };
    const title = p.app?.name || p.name;
    const running = ["running", "starting", "installing"].includes(p.appState?.status);
    const active = ["running", "waiting", "needs-answer"].includes(p.status);
    const primary = [
      p.canOpen ? `<button class="px-btn small" data-act="open" data-id="${p.id}">${openLabel(p)}</button>` : "",
      running ? `<button class="px-btn small ghost" data-act="stop" data-id="${p.id}"><svg class="icon" aria-hidden="true"><use href="#i-stop"/></svg> Close app</button>` : "",
      !active && p.exists ? `<button class="px-btn small ghost" data-act="change" data-name="${esc(p.name)}"><svg class="icon" aria-hidden="true"><use href="#i-edit"/></svg> Change</button>` : "",
      p.canContinue ? `<button class="px-btn small ghost" data-act="continue" data-run="${esc(p.latestRunId)}"><svg class="icon" aria-hidden="true"><use href="#i-redo"/></svg> Continue</button>` : "",
      p.status === "finished" && !p.canOpen ? `<button class="px-btn small ghost" data-act="ask" data-text="How do I try ${esc(p.name)}?">How do I try it?</button>` : "",
      p.status === "failed" && !p.canContinue ? `<button class="px-btn small ghost" data-act="ask" data-text="What went wrong with ${esc(p.name)}, and can the team fix it?">What went wrong?</button>` : "",
    ].join("");
    const webby = ["static", "web"].includes(p.app?.kind);
    const more = [
      p.exists ? `<button class="link-btn" data-act="files" data-id="${p.id}">Show files</button>` : "",
      p.exists ? `<a class="link-btn" href="/api/projects/${p.id}/zip" download>Share a copy (zip)</a>` : "",
      p.exists && webby ? `<button class="link-btn" data-act="ask" data-text="Put ${esc(p.name)} online so I can share a link with people.">Put it online</button>` : "",
      p.exists && !p.github && !webby ? `<button class="link-btn" data-act="ask" data-text="Publish ${esc(p.name)} to GitHub">Publish to GitHub</button>` : "",
      p.github && (p.uncommitted || p.unpushed) ? `<button class="link-btn" data-act="ask" data-text="Commit and push the latest changes of ${esc(p.name)} to GitHub">Push changes to GitHub</button>` : "",
      p.exists && webby ? `<button class="link-btn" data-act="shot" data-id="${p.id}">${p.hasScreenshot ? "Update" : "Take"} picture</button>` : "",
      `<button class="link-btn" data-act="${p.hidden ? "unhide" : "hide"}" data-id="${p.id}">${p.hidden ? "Put back in the list" : "Remove from list"}</button>`,
      `<button class="link-btn tech" data-copy="${esc(p.dir)}">Copy folder path</button>`,
    ].join("");
    const history = p.history
      .map(
        (h) => `<li><span class="chip ${(RUN_MARK[h.status] || ["pending"])[0]}" aria-hidden="true"></span><span class="sr-only">${esc((RUN_MARK[h.status] || [, h.status])[1])}: </span><span class="h-when">${esc(when(h.at))}</span> <span class="h-title">${esc(h.title)}</span>${
          h.canUndo ? ` <button class="link-btn" data-act="undo" data-id="${p.id}" data-run="${esc(h.id)}" data-title="${esc(h.title)}"><svg class="icon" aria-hidden="true"><use href="#i-undo"/></svg> Undo this change</button>` : ""
        }</li>`,
      )
      .join("");
    const gitLine = !p.exists
      ? `<span class="pf-warn">Folder not found</span>`
      : !p.isRepo
        ? `<span class="pf-muted">Not a git repository</span>`
        : [
            p.lastCommitAt ? `Last commit ${ago(p.lastCommitAt)}` : "No commits yet",
            p.uncommitted ? `<span class="pf-warn">${p.uncommitted} uncommitted change${p.uncommitted === 1 ? "" : "s"}</span>` : "no uncommitted changes",
            p.github && p.unpushed ? `<span class="pf-warn">${p.unpushed} commit${p.unpushed === 1 ? "" : "s"} not pushed</span>` : p.github && p.unpushed === 0 ? "all pushed" : "",
          ]
            .filter(Boolean)
            .join(" · ");
    const slug = p.github ? p.github.replace("https://github.com/", "") : "";
    return `<article class="pf-card${p.hidden ? " is-hidden" : ""}${motion === "turning" ? " turning" : ""}" aria-labelledby="pf-${p.id}">
      <div class="pf-lead"><span class="pf-no"><small>No.</small>${String(p.no || 0).padStart(3, "0")}</span>
      ${p.hasScreenshot ? `<img class="pf-shot" src="/api/projects/${p.id}/screenshot?t=${p.lastActivity || 0}" alt="Picture of ${esc(title)}" loading="lazy" />` : ""}</div>
      <div class="pf-body">
      <h3 id="pf-${p.id}">${esc(title)}</h3>
      <p class="pf-title" title="${esc(p.latestTitle)}">${esc(p.lastRunNote ? "" : p.latestTitle || "")}</p>
      ${p.lastRunNote ? `<div class="pf-row pf-note">${esc(p.lastRunNote)}</div>` : ""}
      ${p.appState?.status === "failed" ? `<div class="pf-row pf-warn">Couldn't open it last time: ${esc(p.appState.error || "")}</div>` : ""}
      ${p.github ? `<div class="pf-row"><a class="pf-gh" href="${esc(p.github)}" target="_blank" rel="noopener noreferrer">On GitHub: ${esc(slug)} <svg class="icon pf-out" aria-hidden="true"><use href="#i-external"/></svg></a>${p.visibility ? ` <span class="pf-vis ${esc(p.visibility)}">${esc(p.visibility.toUpperCase())}</span>` : ""}</div>` : ""}
      ${signoff(p, st, !!motion)}
      <div class="pf-actions">${primary}</div>
      <div class="pf-extra"><details class="pf-more" data-key="more-${p.id}"${openDetails.has(`more-${p.id}`) ? " open" : ""}><summary>More</summary><div class="pf-links">${more}</div></details>
      ${history ? `<details class="pf-history" data-key="hist-${p.id}"${openDetails.has(`hist-${p.id}`) ? " open" : ""}><summary>Changes (${p.runs})</summary><ul>${history}</ul></details>` : ""}</div>
      <div class="pf-row pf-git tech">${gitLine}</div>
      <div class="pf-row pf-muted tech">${esc(p.dir)} · last activity ${ago(p.lastActivity)}</div>
      </div>
    </article>`;
  }

  // a finished project carries every station's stamp, each signed by its crew; anything else shows the one stamp it's at
  function signoff(p, st, landing) {
    if (p.status !== "finished") return `<ol class="signoff single"><li><span class="stamp ${st.cls}">${esc(st.label)}</span></li></ol>`;
    return `<ol class="signoff${landing ? " landing" : ""}" aria-label="Signed off by the team">${SIGNOFF(p.builtSize)
      .map(([word, who], i) => {
        const names = who ? who.map((a) => a.name).join(" & ") : "the testers";
        const marks = (who || crew("tester-api", "tester-ui", "tester-edge")).map((a) => `<i style="background:${a.color}"></i>`).join("");
        return `<li style="--i:${i}"><span class="stamp done">${word}</span><span class="signer"><span class="marks" aria-hidden="true">${marks}</span>${esc(names)}</span></li>`;
      })
      .join("")}</ol>`;
  }

  async function refresh() {
    try {
      const data = await (await fetch(`/api/portfolio${showHidden ? "?hidden=1" : ""}`, { cache: "no-store" })).json();
      projects = data.projects;
      nextNo = data.nextNo || projects.length + 1;
      const motion = (p) => (!known ? "" : !known.has(p.id) ? "turning" : p.status === "finished" && known.get(p.id) !== "finished" ? "landing" : "");
      hiddenBtn.hidden = !showHidden && !projects.some((p) => p.hidden) && !localStorage.getItem("hadHidden");
      const html = projects.length
        ? projects.map((p) => card(p, motion(p))).join("") +
          // the gallery always ends with a tile for the next idea
          `<button type="button" class="pf-new" data-act="new"><span class="pf-plus" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg></span><span>Start a project<small>Describe your idea — Maya's team builds it</small></span></button>`
        : `<div class="pf-empty">
            <span class="pf-empty-icon" aria-hidden="true"><svg class="icon"><use href="#i-folder"/></svg></span>
            <h3>No projects yet</h3>
            <p>Once the team starts a project, you can follow its progress here.</p>
            <button type="button" class="px-btn small ghost" data-act="new">Start a project</button>
          </div>`;
      known = new Map(projects.map((p) => [p.id, p.status]));
      if (html !== lastHtml) {
        lastHtml = html;
        host.innerHTML = html;
      }
      window.dispatchEvent(new CustomEvent("portfolio")); // the "Right now" card uses the projects too
    } catch {
      host.innerHTML = `<p class="empty-note">Can't reach the office.</p>`;
      lastHtml = "";
    }
  }

  host.addEventListener("toggle", (e) => {
    const d = e.target.closest("details[data-key]");
    if (d) d.open ? openDetails.add(d.dataset.key) : openDetails.delete(d.dataset.key);
  }, true);

  host.addEventListener("click", async (e) => {
    const copy = e.target.closest("[data-copy]");
    if (copy) return copyText(copy.dataset.copy, copy);
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "open") return openProject(b.dataset.id);
    if (act === "change") return chat.prefill(`In ${b.dataset.name}, I'd like to change: `);
    if (act === "ask") return chat.prefill(b.dataset.text);
    if (act === "new") {
      // the idea box at the top when it's there (Simple view, nothing running), otherwise the chat
      const box = document.getElementById("startText");
      if (!box?.offsetParent) return chat.open();
      return box.focus();
    }
    if (act === "undo" && !confirm(`Go back to how this project was before “${b.dataset.title}”?\n\nEverything changed since then (including later changes) goes back too. You can redo it afterwards.`)) return;
    b.disabled = true;
    try {
      if (act === "continue") await postJson("/api/run", { action: "continue", runId: b.dataset.run });
      else if (act === "shot") {
        b.textContent = "Taking a picture…";
        await postJson("/api/projects", { action: "screenshot", id: b.dataset.id });
      } else {
        if (act === "hide") localStorage.setItem("hadHidden", "1");
        await postJson("/api/projects", { action: { stop: "stop", files: "files", undo: "undo", hide: "hide", unhide: "unhide" }[act], id: b.dataset.id, runId: b.dataset.run });
      }
      if (["undo", "continue"].includes(act)) chat.open();
    } catch (x) {
      alert(x.message);
    }
    b.disabled = false;
    chat.refresh();
    refresh();
  });

  hiddenBtn.onclick = () => {
    showHidden = !showHidden;
    hiddenBtn.setAttribute("aria-pressed", String(showHidden));
    hiddenBtn.textContent = showHidden ? "Hide removed" : "Show removed";
    refresh();
  };
  window.addEventListener("viewchange", () => ((lastHtml = ""), refresh()));

  refresh();
  setInterval(refresh, 8000);
  return { refresh, projects: () => projects, nextNo: () => nextNo };
}
