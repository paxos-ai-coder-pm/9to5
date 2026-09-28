// Rule-based Hindi (Devanagari) → IPA, using only symbols in Kokoro's phoneme vocabulary.
// kokoro-js's phonemizer is English-only, so Hindi text is converted here and fed to Kokoro's Hindi voices.
// Handles inherent-schwa deletion (right-to-left VC_CV rule + word-final), nukta, anusvara/chandrabindu nasalization.

const CONS = {
  "क": "k", "ख": "kʰ", "ग": "ɡ", "घ": "ɡʰ", "ङ": "ŋ",
  "च": "ʧ", "छ": "ʧʰ", "ज": "ʤ", "झ": "ʤʰ", "ञ": "ɲ",
  "ट": "ʈ", "ठ": "ʈʰ", "ड": "ɖ", "ढ": "ɖʰ", "ण": "ɳ",
  "त": "t", "थ": "tʰ", "द": "d", "ध": "dʰ", "न": "n",
  "प": "p", "फ": "pʰ", "ब": "b", "भ": "bʰ", "म": "m",
  "य": "j", "र": "ɾ", "ल": "l", "ळ": "l", "व": "ʋ",
  "श": "ʃ", "ष": "ʃ", "स": "s", "ह": "h",
  // precomposed nukta letters
  "क़": "q", "ख़": "x", "ग़": "ɣ", "ज़": "z", "ड़": "ɽ", "ढ़": "ɽʰ", "फ़": "f", "य़": "j",
};
const NUKTA = { "क": "q", "ख": "x", "ग": "ɣ", "ज": "z", "ड": "ɽ", "ढ": "ɽʰ", "फ": "f", "य": "j" };
const VOWELS = {
  "अ": "ə", "आ": "aː", "इ": "ɪ", "ई": "iː", "उ": "ʊ", "ऊ": "uː", "ऋ": "ɾɪ",
  "ए": "eː", "ऐ": "ɛː", "ओ": "oː", "औ": "ɔː", "ऑ": "ɔ", "ऍ": "æ",
};
const MATRAS = {
  "ा": "aː", "ि": "ɪ", "ी": "iː", "ु": "ʊ", "ू": "uː", "ृ": "ɾɪ",
  "े": "eː", "ै": "ɛː", "ो": "oː", "ौ": "ɔː", "ॉ": "ɔ", "ॅ": "æ",
};
const VIRAMA = "्", NUKTA_SIGN = "़", ANUSVARA = "ं", CHANDRABINDU = "ँ", VISARGA = "ः";
const DIGITS = ["शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ"];

// homorganic nasal for anusvara before a stop
function nasalBefore(ipa) {
  const c = ipa[0];
  if ("kɡqxɣ".includes(c)) return "ŋ";
  if ("ʧʤ".includes(c)) return "n";
  if ("ʈɖɽ".includes(c)) return "ɳ";
  if ("pbfm".includes(c)) return "m";
  if ("tdn".includes(c)) return "n";
  return null;
}

function nasalizeVowel(v) {
  return v[0] + "̃" + v.slice(1); // aː → ãː
}

function wordToIPA(word) {
  const units = []; // { c: ipa, schwa: bool } | { v: ipa } ; either may carry nasal:true
  const chars = [...word];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (CONS[ch] !== undefined) {
      let ipa = CONS[ch];
      if (chars[i + 1] === NUKTA_SIGN) {
        ipa = NUKTA[ch] || ipa;
        i++;
      }
      const next = chars[i + 1];
      if (next === VIRAMA) {
        units.push({ c: ipa, schwa: false });
        i++;
      } else if (MATRAS[next]) {
        units.push({ c: ipa, schwa: false });
        units.push({ v: MATRAS[next] });
        i++;
      } else units.push({ c: ipa, schwa: true });
    } else if (VOWELS[ch]) units.push({ v: VOWELS[ch] });
    else if (ch === ANUSVARA || ch === CHANDRABINDU) {
      const last = units[units.length - 1];
      if (last) last.nasal = ch === ANUSVARA ? "anusvara" : "chandrabindu";
    } else if (ch === VISARGA) units.push({ c: "h", schwa: false });
  }

  const hasVowel = (u) => u && (u.v || (u.c && u.schwa));
  // word-final schwa deletion (keep for single-consonant words like न, व)
  const last = units[units.length - 1];
  if (last?.c && last.schwa && units.length > 1 && !last.nasal) last.schwa = false;
  // medial schwa deletion, scanning right to left: V C[ə] C V → V C C V
  // (never the first unit, so a word's first syllable keeps its vowel: कमला → kəmlaː, समझना → səməʤʰnaː)
  for (let i = units.length - 2; i >= 1; i--) {
    const u = units[i];
    if (u.c === undefined || !u.schwa || u.nasal) continue;
    const next = units[i + 1];
    const precededByVowel = hasVowel(units[i - 1]);
    const followedByCV = next?.c !== undefined && (next.schwa || units[i + 2]?.v !== undefined);
    if (precededByVowel && followedByCV) u.schwa = false;
  }

  let out = "";
  units.forEach((u, i) => {
    if (u.c !== undefined) {
      out += u.c;
      if (u.schwa) {
        if (u.nasal) {
          const n = u.nasal === "anusvara" && units[i + 1]?.c ? nasalBefore(units[i + 1].c) : null;
          out += n ? "ə" + n : "ə̃";
        } else out += "ə";
      }
    } else {
      if (u.nasal) {
        const n = u.nasal === "anusvara" && units[i + 1]?.c ? nasalBefore(units[i + 1].c) : null;
        out += n ? u.v + n : nasalizeVowel(u.v);
      } else out += u.v;
    }
  });
  return out;
}

export const hasDevanagari = (text) => /[ऀ-ॿ]/.test(text);

export function hindiToIPA(text) {
  return text
    .replace(/[०-९]/g, (d) => " " + DIGITS["०१२३४५६७८९".indexOf(d)] + " ")
    .replace(/[0-9]/g, (d) => " " + DIGITS[+d] + " ")
    .replace(/[।॥]/g, ".")
    .split(/([ऀ-ॿ]+)/)
    .map((part) => (/[ऀ-ॿ]/.test(part) ? wordToIPA(part) : part.toLowerCase()))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
