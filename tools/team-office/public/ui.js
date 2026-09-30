// Small shared UI helpers: accessible dialogs, JSON posts, clipboard, the current view.

// ---------- view: "simple" (default) or "tech" (behind the scenes) ----------
export const isSimple = () => !document.documentElement.classList.contains("tech-view");
export function setView(view) {
  document.documentElement.classList.toggle("tech-view", view === "tech");
  try {
    localStorage.setItem("view", view);
  } catch {}
  window.dispatchEvent(new CustomEvent("viewchange", { detail: view }));
}

// ---------- dialogs: focus moves in, Tab stays inside, Escape closes, focus returns to the opener ----------
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
export function createDialog(back, { onClose } = {}) {
  let opener = null;
  const box = back.querySelector('[role="dialog"]');
  const focusables = () => [...box.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
  function open() {
    opener = document.activeElement;
    back.hidden = false;
    requestAnimationFrame(() => (focusables()[1] || focusables()[0] || box).focus());
  }
  function close() {
    if (back.hidden) return;
    back.hidden = true;
    onClose?.();
    opener?.focus?.();
  }
  back.addEventListener("click", (e) => e.target === back && close());
  back.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return close();
    if (e.key !== "Tab") return;
    const f = focusables();
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) {
      e.preventDefault();
      f.at(-1).focus();
    } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
      e.preventDefault();
      f[0].focus();
    }
  });
  return { open, close, isOpen: () => !back.hidden };
}

// ---------- requests ----------
export async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

export async function copyText(text, button, done = "✓ COPIED") {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const was = button.textContent;
      button.textContent = done;
      setTimeout(() => (button.textContent = was), 1500);
    }
  } catch {
    prompt("Copy this:", text);
  }
}

// Open a project for the user in a new tab: the launch page starts it and moves on to the app when it's ready.
// (Opened straight from the click, so pop-up blockers allow it.)
export function openProject(id) {
  const w = window.open(`/launch.html?id=${encodeURIComponent(id)}`, "_blank");
  if (!w) location.href = `/launch.html?id=${encodeURIComponent(id)}`;
}
