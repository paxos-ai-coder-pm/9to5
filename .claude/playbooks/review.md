# Code review checklist

Review in this order and stop to report anything serious — don't bury a correctness bug under style notes.

1. **Does it do what was asked?** Compare against the plan's acceptance criteria one by one. Unplanned changes need a reason.
2. **Correctness:** off-by-one, null/undefined, async races (missing `await`, shared mutable state), error paths that swallow failures, wrong time zone/locale handling, integer/float issues, pagination edges.
3. **Security** (see `security.md`): authz on every new entry point, input validation at the boundary, output escaping, secrets, injection, SSRF, path traversal.
4. **Data:** migrations reversible and safe for existing rows; no N+1 queries; indexes for new lookups; transactions where multiple writes must succeed together.
5. **Integration:** the two work packages agree on names, types, and payload shapes; nothing references a function/route that doesn't exist.
6. **Tests:** new behaviour has tests that would fail without the change; tester FAILs are resolved or explicitly accepted.
7. **Maintainability:** follows existing patterns; clear names; no dead code, debug logs, commented-out blocks, or TODOs without an owner; no copy-paste where a shared helper exists.
8. **Platform:** current, non-deprecated APIs for the installed versions (check, don't assume).

## Reporting
- Only report issues you're confident about; for each: `file:line` — problem — concrete fix — owner.
- Severity: **blocker** (wrong behaviour, security, data loss) → **should fix** → **nit** (optional, max 3).
- Verdict APPROVE only when there are no blockers and acceptance criteria are met.
