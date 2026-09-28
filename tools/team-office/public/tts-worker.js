// Neural text-to-speech worker: Kokoro-82M (Apache-2.0) via kokoro-js / Transformers.js, running on-device.
// The model downloads once from Hugging Face and is cached by the browser (Cache Storage).
import { hasDevanagari, hindiToIPA } from "./hindi-g2p.js";

const KOKORO_JS = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";
const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

let tts = null;
let chain = Promise.resolve(); // ONNX sessions can't run concurrently, so every job is serialized
let liveGen = 0; // jobs from an older generation were cancelled (user hit stop / sent a new message)

async function load({ dtype = "q8", device = "wasm" }) {
  if (tts) return postMessage({ type: "ready" });
  const { KokoroTTS } = await import(KOKORO_JS);
  const files = {};
  const progress_callback = (p) => {
    if (p.status !== "progress" || !p.total) return;
    files[p.file] = { loaded: p.loaded, total: p.total };
    const all = Object.values(files);
    const loaded = all.reduce((s, f) => s + f.loaded, 0);
    const total = all.reduce((s, f) => s + f.total, 0);
    postMessage({ type: "progress", pct: Math.floor((loaded / total) * 100), mb: Math.round(total / 1e6) });
  };
  tts = await KokoroTTS.from_pretrained(MODEL, { dtype, device, progress_callback });

  // kokoro-js only whitelists its English voices, but the model repo also ships Hindi voices (hm_omega, hm_psi,
  // hf_alpha, hf_beta). Allow them, phonemizing the text as US English → English spoken in an Indian voice.
  const validate = tts._validate_voice.bind(tts);
  tts._validate_voice = (voice) => (/^h[fm]_/.test(voice) ? "a" : validate(voice));

  postMessage({ type: "ready" });
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "load") {
    chain = chain.then(() => load(m)).catch((err) => postMessage({ type: "error", error: String(err?.message || err) }));
  } else if (m.type === "cancel") {
    liveGen = m.gen;
  } else if (m.type === "speak") {
    chain = chain.then(async () => {
      if (!tts || m.gen < liveGen) return postMessage({ type: "skipped", id: m.id, gen: m.gen });
      try {
        let out;
        if (hasDevanagari(m.text)) {
          // Hindi: our own G2P → phoneme ids → Kokoro, always with a Hindi voice
          const voice = /^h[fm]_/.test(m.voice) ? m.voice : "hm_omega";
          const { input_ids } = tts.tokenizer(hindiToIPA(m.text), { truncation: true });
          out = await tts.generate_from_ids(input_ids, { voice, speed: m.speed || 1 });
        } else out = await tts.generate(m.text, { voice: m.voice, speed: m.speed || 1 });
        const audio = out.audio;
        postMessage({ type: "audio", id: m.id, gen: m.gen, sr: out.sampling_rate, audio }, [audio.buffer]);
      } catch (err) {
        postMessage({ type: "speak-error", id: m.id, gen: m.gen, error: String(err?.message || err) });
      }
    });
  }
};
