// Scripted demo run, so the office can be seen in action without a real /team run.
// Uses the same state shape that tools/team-office/team.mjs writes.
import { AGENTS } from "./agents.js";

const GRAPH = [
  { id: "T001", title: "Add Rsvp model to Prisma schema", owner: "dev-1", depends_on: [], verify: ["npx prisma validate"] },
  { id: "T002", title: "RSVP route handler (POST/DELETE)", owner: "dev-1", depends_on: ["T001"], verify: ["npx tsc --noEmit"] },
  { id: "T003", title: "Attendee count query", owner: "dev-1", depends_on: ["T001"] },
  { id: "T004", title: "<RsvpButton /> component", owner: "dev-2", depends_on: [] },
  { id: "T005", title: "Wire event detail page", owner: "dev-2", depends_on: ["T002", "T004"] },
  { id: "T006", title: "Attendee list sidebar", owner: "dev-2", depends_on: ["T003"] },
  { id: "T007", title: "API tests: rsvp routes", owner: "tester-api", depends_on: ["T002", "T003"] },
  { id: "T008", title: "E2E: RSVP flow in browser", owner: "tester-ui", depends_on: ["T005", "T006"] },
  { id: "T009", title: "Security: authz & IDOR probe", owner: "tester-edge", depends_on: ["T002"] },
  { id: "T010", title: "Final code review", owner: "reviewer", depends_on: ["T007", "T008", "T009"] },
];

export function createDemo(onChange) {
  let s;
  let timers = [];

  const ev = (e) => s.events.push({ t: Date.now(), ...e });
  const agent = (name, state, activity = "") => {
    s.agents[name] = { state, activity, since: Date.now() };
    ev({ type: "state", agent: name, state, msg: activity || state });
  };
  const phase = (p) => {
    if (p === "fix") s.loop++;
    s.phase = p;
    ev({ type: "phase", phase: p, agent: "", msg: `Phase → ${p.toUpperCase()}${p === "fix" ? ` (loop ${s.loop})` : ""}` });
  };
  const task = (id, status, reason = "") => {
    const t = s.tasks.find((x) => x.id === id);
    t.status = status;
    t.reason = reason;
    ev({ type: "task", id, status, agent: t.owner, msg: reason ? `${id} ${status}: ${reason}` : `${id} ${status} — ${t.title}` });
  };
  const log = (a, msg) => ev({ type: "log", agent: a, msg });

  const script = [
    [0, () => { agent("manager", "waiting", "Here if you need me"); agent("architect", "working", "Reading src/app/events…"); phase("plan"); }],
    [3000, () => agent("architect", "working", "Checking Next 16 route handler docs")],
    [3500, () => agent("architect", "working", "Drafting work packages A / B")],
    [3000, () => {
      s.tasks = GRAPH.map((t, i) => ({ order: i + 1, source: `plan.md#${t.id.toLowerCase()}`, verify: [], ...t, status: "pending", reason: "" }));
      log("architect", "Execution graph loaded: 10 tasks");
    }],
    [2000, () => { agent("architect", "done", "Plan approved"); phase("build"); }],
    [800, () => { agent("dev-1", "working", "Prisma: Rsvp model"); task("T001", "active"); agent("dev-2", "working", "Building <RsvpButton/>"); task("T004", "active"); }],
    [4500, () => { task("T001", "done"); task("T002", "active"); agent("dev-1", "working", "POST /api/events/[id]/rsvp"); }],
    [3000, () => { task("T004", "done"); agent("dev-2", "waiting", "Waiting on T002 contract"); }],
    [3500, () => { task("T002", "done"); task("T003", "active"); agent("dev-1", "working", "Attendee count query"); task("T005", "active"); agent("dev-2", "working", "Wiring event detail page"); }],
    [4000, () => { task("T003", "done"); agent("dev-1", "done", "tsc ✓  lint ✓"); }],
    [2000, () => { task("T005", "done"); task("T006", "active"); agent("dev-2", "working", "Attendee list sidebar"); }],
    [4000, () => { task("T006", "done"); agent("dev-2", "done", "tsc ✓  lint ✓"); }],
    [1500, () => {
      phase("test");
      agent("tester-api", "working", "curl POST /rsvp — 8 cases"); task("T007", "active");
      agent("tester-ui", "working", "Clicking RSVP on /events/42"); task("T008", "active");
      agent("tester-edge", "working", "Probing IDOR on rsvp id"); task("T009", "active");
    }],
    [4000, () => log("tester-api", "6/8 passing…")],
    [2500, () => { task("T007", "done"); agent("tester-api", "done", "8/8 PASS"); }],
    [2000, () => { agent("tester-edge", "failed", "IDOR: can cancel others' RSVP"); task("T009", "blocked", "IDOR on DELETE /rsvp"); }],
    [2000, () => { task("T008", "done"); agent("tester-ui", "done", "5/5 flows PASS"); }],
    [1500, () => { phase("fix"); agent("dev-1", "working", "Fix: check rsvp.userId === session"); agent("tester-edge", "waiting", "Waiting for fix"); }],
    [5000, () => { agent("dev-1", "done", "Ownership check added"); task("T009", "active"); agent("tester-edge", "working", "Re-testing IDOR"); }],
    [4000, () => { task("T009", "done"); agent("tester-edge", "done", "0 critical findings"); }],
    [1500, () => { phase("review"); agent("reviewer", "working", "Reviewing 14 changed files"); task("T010", "active"); }],
    [4000, () => agent("reviewer", "working", "Checking server/client boundaries")],
    [4000, () => { task("T010", "done"); agent("reviewer", "done", "APPROVE ✓"); phase("done"); log("", "Run complete — ready to commit"); }],
  ];

  function start() {
    stop();
    const now = Date.now();
    s = {
      task: "DEMO · Add event RSVP to Merage Hub",
      phase: "plan",
      loop: 0,
      startedAt: now,
      updatedAt: now,
      agents: Object.fromEntries(AGENTS.map((a) => [a.id, { state: "idle", activity: "", since: now }])),
      tasks: [],
      events: [{ t: now, type: "log", agent: "", msg: "New run: Add event RSVP to Merage Hub" }],
    };
    onChange(structuredClone(s));
    let at = 600;
    for (const [delay, fn] of script) {
      at += delay;
      timers.push(setTimeout(() => { fn(); s.updatedAt = Date.now(); onChange(structuredClone(s)); }, at));
    }
  }
  function stop() {
    timers.forEach(clearTimeout);
    timers = [];
  }
  return { start, stop };
}
