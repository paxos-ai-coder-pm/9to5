# Apps that call LLMs

- **Keys server-side only.** Never ship API keys to a browser, extension, or mobile bundle; proxy through your backend.
- **Current models & SDKs:** check the provider's docs for current model IDs and SDK methods before coding (they change often). Make the model name a config value.
- **Prompts are code:** keep them in files/constants, versioned, with the variables clearly marked. Put stable instructions first (prompt caching), user content last, and delimit untrusted content (e.g. XML tags).
- **Structured output:** request JSON / tool calls with a schema; validate the result and handle refusals, truncation (`max_tokens`), and malformed output.
- **Untrusted output:** treat model output like user input — escape before rendering, never execute it, allowlist any tools/actions it can trigger (prompt injection).
- **Reliability:** timeouts, retries with backoff on 429/5xx, streaming for long responses, graceful fallback message.
- **Cost & latency:** cap tokens, cache repeated calls, pick the smallest model that passes evals, log token usage per request.
- **Evals:** keep a small fixed set of real inputs with expected properties; run it when changing prompts or models. Don't ship prompt changes on vibes.
- **Privacy:** tell users what's sent to the model; don't send secrets or unnecessary personal data.
