# Browser extensions (Chrome / Edge / Firefox, Manifest V3)

**Detect:** `manifest.json` with `manifest_version: 3`. **Try it:** chrome://extensions → Developer mode → Load unpacked → the project folder (reload after changes). Tests: pure logic with `node --test`; stub `chrome.*` APIs.

## Architecture
- **Service worker** (background): event-driven and short-lived — no global state that must survive (persist in `chrome.storage`), register listeners at top level synchronously, no DOM.
- **Content scripts:** run in the page's isolated world; keep them small; message the service worker for privileged work.
- **Popup/options pages:** normal web pages under the extension origin; state lives in storage, not the popup (it closes).
- Messaging: `chrome.runtime.sendMessage`/`onMessage` with a typed `{ type, payload }` contract; `return true` (or a promise) for async responses.

## Rules
- **Least privilege:** only the `permissions` and `host_permissions` actually used; prefer `activeTab` + `chrome.scripting` on demand over broad `<all_urls>` content scripts; optional permissions for rare features.
- **No remote code** (MV3 forbids it): bundle all JS locally; no `eval`/`new Function`; CSP stays default.
- **Untrusted page data:** never inject page/user strings with `innerHTML`; use `textContent`/DOM APIs; validate messages (check `sender.id`/origin, ignore unknown `type`s).
- **Storage:** `chrome.storage.local` for personal data (not `sync`, which has small quotas and syncs across devices); mind quotas; never store secrets/API keys in the bundle.
- **Privacy:** personal data (resumes, contact info) stays local unless the user explicitly sends it; say so in the UI.
- Icons 16/32/48/128; a clear `description`; keyboard shortcuts via `commands`.

## Pitfalls
Service worker going idle and losing in-memory state, listeners registered inside async callbacks (missed events), content script not injected on already-open tabs, CSP blocking inline scripts in popup HTML (use external .js files), `chrome.*` vs `browser.*` differences for Firefox.

## Review focus
Permissions minimal, message handlers validate senders, no innerHTML with untrusted data, no remote code, state persisted correctly.
