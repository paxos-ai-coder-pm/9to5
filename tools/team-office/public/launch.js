// The page that opens a project for the user: starts it, says what's happening in plain words, and moves on to the
// app once it's ready. Scripts show their output here; extensions show their how-to steps.
import { esc, getInitials } from "./agents.js";
import { postJson } from "./ui.js";

// The studio can be renamed in Settings.
fetch("/api/ping", { cache: "no-store" })
  .then((r) => r.json())
  .then(({ name }) => {
    if (!name) return;
    document.querySelector(".launch-studio-name").textContent = name;
    document.querySelector(".launch-brand .logo-abbr").textContent = getInitials(name);
  })
  .catch(() => {});

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get("id") || "";
let name = "your project";

function show({ title, status, spin = false, steps, log, details, actions = "" }) {
  if (title) {
    $("title").textContent = title;
    document.title = title;
  }
  if (status != null) $("status").innerHTML = status;
  $("spinner").hidden = !spin;
  $("steps").hidden = !steps?.length;
  if (steps?.length) $("steps").innerHTML = steps.map((s) => `<li>${esc(s)}</li>`).join("");
  $("log").hidden = log == null;
  if (log != null) $("log").textContent = log || "(no output)";
  $("details").hidden = !details;
  if (details) $("detailsLog").textContent = details;
  $("actions").innerHTML = actions;
}

const filesButton = `<button type="button" class="px-btn ghost" id="filesBtn">Show the files</button>`;
document.addEventListener("click", async (e) => {
  if (e.target.id === "filesBtn") {
    try {
      await postJson("/api/projects", { action: "files", id });
    } catch (x) {
      alert(x.message);
    }
  }
  if (e.target.id === "againBtn") location.reload();
  if (e.target.id === "stopBtn") {
    await postJson("/api/projects", { action: "stop", id }).catch(() => {});
    show({ status: "Closed." });
  }
});

async function poll() {
  let info;
  try {
    info = await (await fetch(`/api/apps?id=${encodeURIComponent(id)}`, { cache: "no-store" })).json();
  } catch {
    return show({ title: "CAN'T REACH THE STUDIO", status: "9to5 isn't running on this computer any more." });
  }
  if (info.error) return show({ title: "NOT FOUND", status: esc(info.error) });
  name = info.project.name;
  const app = info.app;
  if (!app) return setTimeout(poll, 700);
  switch (app.status) {
    case "installing":
      show({ title: `OPENING ${name.toUpperCase()}`, status: "Getting things ready — the first time can take a few minutes…", spin: true });
      return setTimeout(poll, 1000);
    case "starting":
      show({ title: `OPENING ${name.toUpperCase()}`, status: `Starting ${esc(name)}…`, spin: true });
      return setTimeout(poll, 700);
    case "running":
      if (app.url) {
        show({ title: `OPENING ${name.toUpperCase()}`, status: `Ready — taking you there…`, spin: true });
        return location.replace(app.url);
      }
      // a script that is still running
      show({ title: name.toUpperCase(), status: "Running…", spin: true, log: app.log, actions: `<button type="button" class="px-btn ghost" id="stopBtn">■ STOP</button>` });
      return setTimeout(poll, 700);
    case "exited":
      return show({ title: name.toUpperCase(), status: "Done. Here's what it said:", log: app.log, actions: `<button type="button" class="px-btn" id="againBtn">Run again</button>${filesButton}` });
    case "manual":
      return show({
        title: name.toUpperCase(),
        status: "This one isn't opened in the browser. Here's how to use it:",
        steps: info.howTo,
        actions: filesButton,
      });
    case "stopped":
      return show({ title: name.toUpperCase(), status: "Closed.", actions: `<button type="button" class="px-btn" id="againBtn">▶ OPEN AGAIN</button>` });
    default:
      return show({
        title: `COULDN'T OPEN ${name.toUpperCase()}`,
        status: `${esc(app.error || "Something went wrong.")} In the studio, ask the manager: <i>“${esc(name)} won't open — can the team fix it?”</i>`,
        details: app.log || undefined,
        actions: `<button type="button" class="px-btn" id="againBtn">Try again</button>${filesButton}`,
      });
  }
}

(async () => {
  if (!/^[0-9a-f]{12}$/.test(id)) return show({ title: "NOT FOUND", status: "That project link isn't right." });
  try {
    await postJson("/api/projects", { action: "open", id });
  } catch (x) {
    return show({ title: "CAN'T OPEN IT YET", status: esc(x.message), actions: filesButton });
  }
  poll();
})();
