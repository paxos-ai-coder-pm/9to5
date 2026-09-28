// Parser for `claude -p --output-format stream-json --verbose [--include-partial-messages]` output.
//   onText(text)          — the main session's current message so far (resets at each new message)
//   onModel(model, agent) — model id seen for the main session (agent = null) or a subagent (its subagent_type)
// Returns the final `result` event from end().
export function createStreamParser({ onText, onModel } = {}) {
  let buf = "";
  let text = "";
  let result = null;
  const subagents = new Map(); // Agent/Task tool_use id → subagent_type
  const seen = new Map(); // agent key → last reported model (report changes only)

  function model(m, agent = null) {
    if (!m || m === "<synthetic>") return;
    const key = agent || "";
    if (seen.get(key) === m) return;
    seen.set(key, m);
    onModel?.(m, agent);
  }

  function handle(ev) {
    const parent = ev.parent_tool_use_id || null;
    if (ev.type === "system" && ev.subtype === "init") model(ev.model);
    else if (ev.type === "stream_event") {
      if (parent) return;
      const e = ev.event || {};
      if (e.type === "message_start") {
        text = "";
        onText?.(text);
        model(e.message?.model);
      } else if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
        text += e.delta.text;
        onText?.(text);
      }
    } else if (ev.type === "assistant" && ev.message) {
      model(ev.message.model, parent ? subagents.get(parent) || "subagent" : null);
      for (const b of ev.message.content || []) {
        if (b.type === "tool_use" && (b.name === "Agent" || b.name === "Task") && b.input?.subagent_type) subagents.set(b.id, b.input.subagent_type);
      }
    } else if (ev.type === "result") result = ev;
  }

  function line(l) {
    if (!l.trim()) return;
    try {
      handle(JSON.parse(l));
    } catch {}
  }

  return {
    push(chunk) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        line(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    },
    end() {
      line(buf);
      buf = "";
      return result;
    },
  };
}
