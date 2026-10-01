// Safety check for commands the team CLI runs itself (`T task <id> verify` executes the plan's verify commands with
// execSync, i.e. outside Claude Code's permission rules). Verify commands should only check things, so anything that
// deletes, rewrites history, publishes or escalates is refused.
const RULES = [
  [/^(sudo|doas|su)\b/, "runs as administrator"],
  [/^(rm|rmdir|del|erase|rd|shred|unlink)\b/i, "deletes files"],
  [/^remove-item\b/i, "deletes files"],
  [/^find\b.*\s-(delete|exec)\b/, "deletes or runs commands on files"],
  [/^git\s+(push|reset|clean|rebase|filter-branch|filter-repo|checkout\s+--\s|restore|stash\s+(drop|clear)|branch\s+-D|update-ref|gc|prune)\b/, "changes git history or discards work"],
  [/^gh\s+(repo\s+(delete|archive|create|edit|rename)|auth|release|secret|api)\b/, "changes things on GitHub"],
  [/^(npm|pnpm|yarn|bun)\s+(publish|unpublish|deprecate|owner|login|logout|adduser)\b/, "publishes packages or changes accounts"],
  [/^(mkfs|dd|format|diskpart|shutdown|reboot|halt|poweroff|chmod\s+-R|chown\s+-R)\b/i, "can damage the computer"],
  [/^(curl|wget|iwr|invoke-webrequest)\b.*\|\s*(sh|bash|zsh|pwsh|powershell|iex|python)\b/i, "downloads and runs a script"],
];

/** Returns null if the command looks safe to run as a check, else a short reason. */
export function unsafeReason(command) {
  const cmd = String(command || "");
  // (…|sh) is caught before splitting on "|"
  for (const [re, why] of RULES) if (re.test(cmd.trim())) return why;
  // every piece of a chain / pipeline: a && b ; c | d || e, plus $(…) and `…` substitutions
  const parts = cmd.split(/&&|\|\||;|\||\$\(|`|\n/).map((p) => p.replace(/^[\s(]+/, "").trim()).filter(Boolean);
  for (const p of parts) {
    const bare = p.replace(/^(\w+=\S*\s+)+/, ""); // skip leading VAR=value assignments
    for (const [re, why] of RULES) if (re.test(bare)) return why;
  }
  if (/(^|\s)>\s*\/dev\/(sd|nvme|disk)/.test(cmd)) return "can damage the computer";
  return null;
}
