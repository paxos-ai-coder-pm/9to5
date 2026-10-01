// Directive lines the manager appends to its chat replies (hidden from the user):
//   RELAY: <instruction for the team>      PROPOSE: <project-folder> | <task>      START:
//   ALLOW: github                           SIZE: quick|standard|full               CHOICES: a | b | c
const DIRECTIVE = /^\s*(RELAY|PROPOSE|START|ALLOW|SIZE|CHOICES):\s*(.*)$/;
const NAMES = ["RELAY:", "PROPOSE:", "START:", "ALLOW:", "SIZE:", "CHOICES:"];
export const SIZES = ["quick", "standard", "full"];

export function parseDirectives(text) {
  const relays = [];
  let propose = null;
  let start = false;
  let choices = null;
  let size = null;
  const body = [];
  let inPropose = false; // a PROPOSE brief may continue over several lines, until the next directive
  let allowGithub = false; // "ALLOW: github" — the proposed run may commit/push (shown on the card; Start = consent)
  for (const line of String(text || "").split("\n")) {
    const m = line.match(DIRECTIVE);
    if (m) {
      inPropose = false;
      const arg = m[2].trim();
      if (m[1] === "ALLOW" && /github/i.test(arg)) allowGithub = true;
      if (m[1] === "RELAY" && arg) relays.push(arg);
      if (m[1] === "START") start = true;
      if (m[1] === "SIZE" && SIZES.includes(arg.toLowerCase())) size = arg.toLowerCase();
      if (m[1] === "CHOICES") {
        const list = arg.split("|").map((c) => c.trim().slice(0, 80)).filter(Boolean);
        choices = [...new Set(list)].slice(0, 6);
        if (choices.length < 2) choices = null; // one "choice" isn't a choice
      }
      if (m[1] === "PROPOSE") {
        const [project, ...rest] = m[2].split("|");
        propose = { project: project.trim(), task: rest.join("|").trim() };
        inPropose = true;
      }
    } else if (inPropose) propose.task += "\n" + line;
    else body.push(line);
  }
  if (propose) {
    propose.task = propose.task.trim();
    propose.allowGithub = allowGithub;
    propose.size = size || "standard";
    if (!propose.task) propose = null;
  }
  return { body: body.join("\n").trim(), relays, propose, start, choices };
}

// The reply as it's being written, minus directive lines (and a trailing half-written one).
export function visibleDraft(text) {
  const lines = String(text || "").split("\n");
  // everything from the first directive on is hidden (a PROPOSE brief spans several lines)
  const first = lines.findIndex((l) => DIRECTIVE.test(l));
  const shown = first === -1 ? lines : lines.slice(0, first);
  const last = shown[shown.length - 1]?.trim() || "";
  if (last && /^[A-Z]{1,8}:?$/.test(last) && NAMES.some((d) => d.startsWith(last))) shown.pop();
  return shown.join("\n").trimEnd();
}
