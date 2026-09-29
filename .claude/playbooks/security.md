# Security checklist

## Every change
- **Secrets:** none in code, logs, test fixtures, or commits. Read from env/config; `.env*` is gitignored. Rotate anything that leaked.
- **Input:** validate at the boundary (schema: Zod, Pydantic, Bean Validation, etc.) — type, length, range, format. Reject, don't "fix up".
- **Output:** escape by default (framework templating); never build HTML with string concatenation or `innerHTML` from untrusted data.
- **AuthN/AuthZ:** every new route/action/handler checks *who* the caller is and *whether they may touch this resource* (IDOR: fetch by id **and** owner). Deny by default.
- **Injection:** parameterized queries only; no shell commands built from user input; no `eval`/dynamic imports of user data.
- **Files & URLs:** normalize and confine paths (no `..` escape); allowlist hosts for server-side fetches (SSRF); limit upload size/type.
- **Errors:** users get generic messages; details go to server logs without secrets or PII.
- **Dependencies:** no new packages without need; prefer well-maintained ones; pin via lockfile.

## Web specifics
Cookies `HttpOnly; Secure; SameSite=Lax` (or Strict); CSRF protection for cookie-authenticated state changes; rate-limit login/signup/reset; passwords hashed with bcrypt/argon2 (never reversible); same error for "no such user" and "wrong password"; CORS allowlist, not `*` with credentials; security headers (CSP, X-Content-Type-Options).

## Data & privacy
Collect the minimum; don't log personal data; encrypt sensitive data at rest where the platform supports it; make deletion possible.

## LLM features
Treat model output as untrusted input; never let it build SQL/shell/HTML unescaped; guard tool calls with allowlists; keep API keys server-side.

## Reporting a finding
Severity (Critical / High / Medium / Low), exact reproduction, observed vs expected, `file:line`, fix. Never exploit beyond what proves the issue, and only with fake data.
