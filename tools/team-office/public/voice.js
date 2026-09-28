// Neural voice for the manager: runs Kokoro in a worker, plays sentences back-to-back through Web Audio,
// generating the next sentence while the current one plays.
export const VOICES = [
  { id: "hm_omega", label: "Hindi male · Omega" },
  { id: "hm_psi", label: "Hindi male · Psi" },
  { id: "am_michael", label: "US male · Michael" },
  { id: "am_fenrir", label: "US male · Fenrir" },
  { id: "af_heart", label: "US female · Heart" },
  { id: "af_bella", label: "US female · Bella" },
  { id: "bm_george", label: "UK male · George" },
  { id: "bf_emma", label: "UK female · Emma" },
  { id: "system", label: "System voice (instant, robotic)" },
];

export function createNeuralVoice({ onStatus, onSpeaking }) {
  let worker = null;
  let state = "idle"; // idle | loading | ready | failed
  let ctx = null;
  let gen = 0;
  let nextId = 0;
  const pending = new Map(); // id → { text, gen }
  const queue = []; // AudioBuffers ready to play, in order
  let buffered = new Map(); // id → AudioBuffer (arrived early, waiting for its turn)
  let order = []; // ids in playback order for the current generation
  let current = null;
  let speakingText = "";
  let fallback = null; // (text) => void, used if the model fails

  function status(s, extra = {}) {
    state = s;
    onStatus?.({ state: s, ...extra });
  }

  function load() {
    if (worker || state === "failed") return;
    status("loading", { pct: 0 });
    worker = new Worker("/tts-worker.js", { type: "module" });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") status("loading", { pct: m.pct, mb: m.mb });
      else if (m.type === "ready") status("ready");
      else if (m.type === "error") {
        status("failed", { error: m.error });
        // speak anything still waiting with the fallback voice
        const texts = [...pending.values()].filter((p) => p.gen === gen).map((p) => p.text);
        pending.clear();
        order = [];
        if (texts.length && fallback) fallback(texts.join(" "));
        else finish();
      } else if (m.type === "audio") {
        pending.delete(m.id);
        if (m.gen !== gen) return;
        const buf = audioCtx().createBuffer(1, m.audio.length, m.sr);
        buf.copyToChannel(m.audio, 0);
        buffered.set(m.id, buf);
        drain();
      } else if (m.type === "speak-error" || m.type === "skipped") {
        pending.delete(m.id);
        if (m.gen !== gen) return;
        order = order.filter((id) => id !== m.id);
        drain();
      }
    };
    worker.onerror = (e) => worker.onmessage({ data: { type: "error", error: e.message || "worker failed" } });
    worker.postMessage({ type: "load", dtype: "q8", device: "wasm" });
  }

  function audioCtx() {
    ctx ||= new AudioContext();
    return ctx;
  }

  // must be called from a user gesture at least once (browser autoplay rules)
  function unlock() {
    const c = audioCtx();
    if (c.state === "suspended") c.resume();
  }

  // move in-order buffers into the play queue
  function drain() {
    while (order.length && buffered.has(order[0])) {
      queue.push(buffered.get(order[0]));
      buffered.delete(order.shift());
    }
    playNext();
  }

  function playNext() {
    if (current) return;
    const buf = queue.shift();
    if (!buf) {
      if (!order.length) finish();
      return;
    }
    onSpeaking?.(true, speakingText);
    const src = audioCtx().createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx().destination);
    src.onended = () => {
      if (current !== src) return;
      current = null;
      playNext();
    };
    current = src;
    src.start();
  }

  function finish() {
    if (!speakingText) return;
    speakingText = "";
    onSpeaking?.(false);
  }

  function speak(parts, fullText, voice, onFallback) {
    fallback = onFallback;
    load();
    if (state === "failed") return onFallback(fullText);
    speakingText = speakingText ? speakingText + " " + fullText : fullText;
    for (const text of parts) {
      const id = ++nextId;
      pending.set(id, { text, gen });
      order.push(id);
      worker.postMessage({ type: "speak", id, gen, text, voice });
    }
  }

  function stop() {
    gen++;
    worker?.postMessage({ type: "cancel", gen });
    pending.clear();
    buffered = new Map();
    order = [];
    queue.length = 0;
    if (current) {
      const c = current;
      current = null;
      try {
        c.stop();
      } catch {}
    }
    finish();
  }

  return {
    load,
    unlock,
    speak,
    stop,
    get state() {
      return state;
    },
  };
}
