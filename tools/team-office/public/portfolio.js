// "My Projects" panel: one card per project with status, GitHub link and git state.
import { esc } from "./agents.js";

const STATUS = {
  running: { label: "In progress", cls: "active", icon: "▶" },
  waiting: { label: "Paused (usage limit)", cls: "ready", icon: "⏳" },
  "needs-answer": { label: "Waiting for your answer", cls: "ready", icon: "⏸" },
  finished: { label: "Built", cls: "done", icon: "✓" },
  failed: { label: "Needs attention", cls: "blocked", icon: "✖" },
  stopped: { label: "Stopped", cls: "pending", icon: "■" },
  interrupted: { label: "Interrupted", cls: "blocked", icon: "!" },
};

function ago(ms) {
  if (!ms) return "—";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export function createPortfolio({ chat }) {
  const host = document.getElementById("portfolio");

  function card(p) {
    const st = STATUS[p.status] || { label: p.status, cls: "pending", icon: "•" };
    const slug = p.github ? p.github.replace("https://github.com/", "") : "";
    const github = p.github
      ? `<a class="pf-gh" href="${esc(p.github)}" target="_blank" rel="noopener noreferrer">⎇ ${esc(slug)} ↗</a>${p.visibility ? ` <span class="pf-vis ${esc(p.visibility)}">${esc(p.visibility.toUpperCase())}</span>` : ""}`
      : `<span class="pf-nogh">Not on GitHub yet</span>`;
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
    const actions = [
      `<button class="px-btn small ghost" data-copy="${esc(p.dir)}">📁 COPY PATH</button>`,
      p.status === "finished" ? `<button class="px-btn small ghost" data-ask="How do I try ${esc(p.name)}?">▶ HOW TO TRY</button>` : "",
      !p.github && p.exists ? `<button class="px-btn small ghost" data-ask="Publish ${esc(p.name)} to GitHub">⎇ PUBLISH</button>` : "",
      p.github && (p.uncommitted || p.unpushed) ? `<button class="px-btn small ghost" data-ask="Commit and push the latest changes of ${esc(p.name)} to GitHub">⇪ PUSH CHANGES</button>` : "",
      p.status === "failed" ? `<button class="px-btn small ghost" data-ask="What went wrong with ${esc(p.name)}, and can the team fix it?">↻ ASK ABOUT IT</button>` : "",
    ].join("");
    return `<article class="pf-card">
      <div class="pf-top"><h3>${esc(p.name)}</h3><span class="pf-status"><span class="chip ${st.cls}">${st.icon}</span>${esc(st.label)}</span></div>
      <p class="pf-title" title="${esc(p.latestTitle)}">${esc(p.lastRunNote ? "" : p.latestTitle || "")}</p>
      ${p.lastRunNote ? `<div class="pf-row pf-note">⚠ ${esc(p.lastRunNote)} <button class="link-btn" data-ask="What happened with the last run of ${esc(p.name)}?">ask why</button></div>` : ""}
      <div class="pf-row">${github}</div>
      <div class="pf-row pf-git">${gitLine}</div>
      <div class="pf-row pf-muted">${p.runs} run${p.runs === 1 ? "" : "s"} · last activity ${ago(p.lastActivity)}${p.status === "waiting" && p.resumeAt ? ` · resumes ${new Date(p.resumeAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</div>
      <div class="pf-actions">${actions}</div>
    </article>`;
  }

  async function refresh() {
    try {
      const { projects } = await (await fetch("/api/portfolio", { cache: "no-store" })).json();
      host.innerHTML = projects.length
        ? projects.map(card).join("")
        : `<p class="empty-note">No projects yet. Tell the manager what to build — every project the team works on shows up here with its status and GitHub link.</p>`;
    } catch {
      host.innerHTML = `<p class="empty-note">Can't reach the office server.</p>`;
    }
  }

  host.addEventListener("click", async (e) => {
    const copy = e.target.closest("[data-copy]");
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy);
        copy.textContent = "✓ COPIED";
        setTimeout(() => (copy.textContent = "📁 COPY PATH"), 1500);
      } catch {
        prompt("Folder path:", copy.dataset.copy);
      }
    }
    const ask = e.target.closest("[data-ask]");
    if (ask) chat.prefill(ask.dataset.ask);
  });

  refresh();
  setInterval(refresh, 15000);
  return { refresh };
}
