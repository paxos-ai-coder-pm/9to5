# Systematic debugging

1. **Reproduce** reliably with the smallest command/input. If you can't reproduce, gather evidence (logs, exact steps, versions) before changing anything.
2. **Read the whole error.** Find the first stack frame in project code; note the exact message and values.
3. **Localize:** what changed recently (`git diff`, `git log -p -- <file>`)? Bisect by commenting out / adding one log line at a time, or `git bisect` for regressions.
4. **One hypothesis at a time.** Write it down ("the token is expired because the clock is UTC"), predict what you'll see if it's true, run the check. Wrong? Discard it cleanly and revert the probe.
5. **Fix the cause, not the symptom.** No blanket try/catch, retries, sleeps, or null-guards that hide the real bug.
6. **Prove it:** add a test that failed before the fix and passes after; rerun the original reproduction.
7. **Clean up** debug logs and probes. Record a `T lesson` if the root cause was non-obvious.

Common culprits: stale build/cache, wrong working directory or env, version mismatch between docs and installed package, async ordering, time zones, case-sensitive paths (Linux CI vs Windows), line endings, off-by-one, and data that differs between dev and test.
