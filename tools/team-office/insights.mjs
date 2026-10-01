// Plain-language helpers: time estimates from past runs, and failure explanations a non-developer can act on.

export function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n) && n > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

const finished = (history) => (history || []).filter((h) => h.status === "finished").slice(0, 20);

/** Typical minutes for a whole run of this size (null until there are ≥ 2 finished runs to go on). */
export function typicalRunMinutes(history, size = "standard") {
  const runs = finished(history).filter((h) => h.activeMs > 0);
  const same = runs.filter((h) => (h.size || "standard") === size);
  const pool = same.length >= 2 ? same : runs;
  if (pool.length < 2) return null;
  return Math.max(1, Math.round(median(pool.map((h) => h.activeMs)) / 60000));
}

/** Minutes left for the current run, from past per-task times (null when there's nothing to go on). */
export function minutesLeft(state, history) {
  const tasks = state?.tasks || [];
  const left = tasks.filter((t) => t.status !== "done").length;
  if (!tasks.length || !left) return null;
  const perTask = median(finished(history).filter((h) => h.buildMs > 0 && h.taskCount > 0).map((h) => h.buildMs / h.taskCount));
  const samples = finished(history).filter((h) => h.buildMs > 0 && h.taskCount > 0).length;
  if (!perTask || samples < 2) return null;
  return Math.max(1, Math.round((perTask * left) / 60000));
}

export function fmtMinutes(min) {
  if (min == null) return "";
  if (min < 60) return `about ${min} min`;
  const h = Math.floor(min / 60);
  const m = Math.round((min % 60) / 5) * 5;
  return `about ${h} h${m ? ` ${m} min` : ""}`;
}

/**
 * A failed / interrupted / stopped run, explained for a non-developer.
 * Returns { reason, actions } — actions are button ids the chat shows: continue, retry, setup, ask.
 */
export function explainFailure(run) {
  const err = String(run?.error || "");
  const canContinue = !!run?.sessionId;
  if (run?.status === "interrupted")
    return { reason: "The office was closed (or the computer slept) while the team was working.", actions: canContinue ? ["continue", "ask"] : ["retry", "ask"] };
  if (run?.status === "stopped") return { reason: "You stopped this run.", actions: canContinue ? ["continue", "retry"] : ["retry"] };
  if (/isn't on PATH|ENOENT/i.test(err)) return { reason: "Claude isn't installed on this computer (or the office can't find it).", actions: ["setup"] };
  if (/auth|log ?in|401|403/i.test(err)) return { reason: "Claude isn't signed in on this computer.", actions: ["setup", "retry"] };
  if (/without starting the pipeline/i.test(err)) return { reason: "The team didn't get started — nothing was changed.", actions: ["retry", "ask"] };
  if (/stopped early/i.test(err)) {
    const phase = err.match(/board still at (\w+)/i)?.[1];
    const step = { PLAN: "planning", BUILD: "building", TEST: "checking", FIX: "fixing", REVIEW: "final check" }[phase?.toUpperCase()] || "working";
    return { reason: `The team stopped before finishing (during the ${step} step).`, actions: canContinue ? ["continue", "ask"] : ["retry", "ask"] };
  }
  if (/Gave up after/i.test(err)) return { reason: "The run kept being paused by the Claude usage limit, so the office gave up.", actions: canContinue ? ["continue", "ask"] : ["retry"] };
  return { reason: "Something went wrong while the team was working.", actions: canContinue ? ["continue", "ask"] : ["retry", "ask"] };
}
