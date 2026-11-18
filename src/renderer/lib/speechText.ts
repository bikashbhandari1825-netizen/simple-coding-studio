import type { SpeakChunk } from '../../shared/types';

// Guru को Markdown जवाफलाई बोल्न मिल्ने वाक्यहरूमा बदल्ने।
// - Code block पढिँदैन (सुन्दा अर्थ लाग्दैन), तर "यहाँ code छ" भनिन्छ।
// - तालिका (code breakdown) का पंक्तिहरू वाक्यजस्तै पढिन्छन्।
// - हरेक वाक्य नेपाली (ne-NP) वा English (en-US) आवाजमा।
//
// Turn Guru's Markdown answer into speakable sentences: code blocks are announced instead of read out,
// table rows are read as sentences, and each sentence gets a Nepali or English voice.

const DEVANAGARI = /[ऀ-ॿ]/g;
const LATIN = /[A-Za-z]/g;
const EMOJI = /(?:\p{Extended_Pictographic}|\u{FE0F}|\u{200D})/gu;
const MAX_CHUNK = 260;

function langOf(sentence: string): SpeakChunk['lang'] {
  const dev = sentence.match(DEVANAGARI)?.length ?? 0;
  const lat = sentence.match(LATIN)?.length ?? 0;
  // थोरै मात्र नेपाली भए पनि नेपाली आवाज: नेपाली मान्छेले English प्राविधिक शब्द आफ्नै लवजमा भन्छ।
  // Any real Nepali content gets the Nepali voice; a Nepali speaker says English terms in a Nepali accent.
  return dev >= 2 && dev >= lat * 0.15 ? 'ne-NP' : 'en-US';
}

function cleanInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~#>]+/g, ' ')
    .replace(EMOJI, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// नेपाली आवाजलाई मान्छेले बोलेजस्तै बनाउन पाठ मिलाउने: चिन्हहरू शब्दमा, उचित विराम (।), कोष्ठक/स्ल्यासमा रोकाइ।
// Make Nepali text sound like a person speaking: symbols become words, sentences end with "।",
// brackets and slashes become short pauses, and code symbols are not read out letter by letter.
const SYMBOL_WORDS: [RegExp, string][] = [
  [/\s=>\s/g, ' ले फर्काउँछ '],
  [/\s==\s/g, ' बराबर छ कि भनेर जाँच्छ '],
  [/\s!=\s/g, ' बराबर छैन भने '],
  [/\s=\s/g, ' बराबर '],
  [/\s\+\s/g, ' प्लस '],
  [/\s-\s/g, ', '],
  [/\s\*\s/g, ' गुणा '],
  [/\s<\s/g, ' भन्दा सानो '],
  [/\s>\s/g, ' भन्दा ठूलो '],
  [/&&/g, ' र '],
  [/\|\|/g, ' वा '],
  [/→|➜|->/g, ', '],
  [/([ऀ-ॿ])\/([ऀ-ॿ])/g, '$1 वा $2'],
  [/\be\.g\.,?/gi, 'जस्तै,'],
  [/\betc\.?/gi, 'आदि'],
];

const SYMBOL_NAMES: Record<string, string> = {
  '{': 'कर्ली ब्रेस',
  '}': 'कर्ली ब्रेस',
  '(': 'कोष्ठक',
  ')': 'कोष्ठक',
  '[': 'स्क्वायर ब्रेकेट',
  ']': 'स्क्वायर ब्रेकेट',
  ';': 'सेमिकोलन',
  '=': 'बराबर चिन्ह',
  '=>': 'एरो',
  '<': 'सानो चिन्ह',
  '>': 'ठूलो चिन्ह',
  ':': 'कोलन',
  '.': 'डट',
  ',': 'कमा',
  '+': 'प्लस',
  '-': 'माइनस',
  '*': 'स्टार',
  '/': 'स्ल्यास',
  '!': 'नट चिन्ह',
  '&': 'एन्ड चिन्ह',
  '|': 'पाइप',
};

/** English आवाजका लागि: code का चिन्ह नपढ्ने, दोहोरो विराम हटाउने — drop code symbols and double stops. */
export function polishEnglish(text: string): string {
  return text
    .replace(/\(\s*\)|\{\s*\}|\[\s*\]/g, ' ')
    .replace(/[{};]/g, ' ')
    .replace(/\s=\s/g, ' equals ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function polishNepali(text: string): string {
  let t = text;
  for (const [re, word] of SYMBOL_WORDS) t = t.replace(re, word);
  t = t
    // खाली कोष्ठक, ब्रेस, अर्धविराम: पढ्दा अर्थ छैन — (), {}, ; read as nothing
    .replace(/\(\s*\)|\{\s*\}|\[\s*\]/g, ' ')
    .replace(/[{}[\];]/g, ' ')
    // कोष्ठकलाई सानो रोकाइ — brackets become short pauses
    .replace(/\s*\(\s*/g, ', ')
    .replace(/\s*\)\s*/g, ', ')
    .replace(/["“”]/g, '')
    .replace(/\s*,\s*(,\s*)+/g, ', ')
    // नेपाली शब्दपछिको "." लाई पूर्णविराम "।" — Nepali sentences end with "।" for natural intonation
    .replace(/([ऀ-ॿ])\s*\.(\s|$)/g, '$1।$2')
    .replace(/\s+/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
  if (t && !/[।?!.:]$/.test(t)) t += '।';
  return t;
}

export function markdownToSpeech(markdown: string): SpeakChunk[] {
  const sentences: string[] = [];
  // हरेक वाक्य आफ्नै विरामसहित; चिन्ह मात्र भए त्यसको नाम भन्ने — every sentence ends with its own stop,
  // and a sentence made only of symbols is spoken as the symbols' names.
  const add = (raw: string) => {
    let s = raw.trim();
    if (!s) return;
    if (!/[\p{L}\p{N}]/u.test(s)) {
      const names = [...new Set(s.match(/=>|[{}()[\];=<>:.,+\-*/!&|]/g) ?? [])]
        .map((ch) => SYMBOL_NAMES[ch])
        .filter(Boolean);
      if (!names.length) return;
      s = [...new Set(names)].join(', ');
    }
    if (!/[।.!?:]$/.test(s)) s += langOf(s) === 'ne-NP' ? '।' : '.';
    sentences.push(s);
  };
  const lines = markdown.replace(/\r/g, '').split('\n');
  let inCode = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      if (!inCode) sentences.push('यहाँ code छ, त्यो screen मा हेर्नुहोस्।');
      inCode = !inCode;
      continue;
    }
    if (inCode || !line) continue;
    if (/^\|?\s*:?-{2,}/.test(line)) continue; // तालिकाको --- पंक्ति — table separator row
    if (line.startsWith('|')) {
      const cells = line
        .split('|')
        .map((c) => cleanInline(c))
        .filter(Boolean);
      // तालिकाको शीर्षक पंक्ति नपढ्ने — skip the header row (the row right before the --- line).
      const nextLine = lines[lines.indexOf(raw) + 1]?.trim() ?? '';
      if (/^\|?\s*:?-{2,}/.test(nextLine)) continue;
      // पहिलो cell (लाइन/भाग) सँगै, अनि हरेक cell आफ्नै भाषाको आवाजमा — first cell as a prefix, each cell in its own voice.
      const [first, ...rest] = cells;
      if (!rest.length) add(first);
      rest.forEach((cell, i) => add(i === 0 ? `${first}: ${cell}` : cell));
      continue;
    }
    const text = cleanInline(line.replace(/^[-*+]\s+|^\d+[.)]\s+/, ''));
    if (!text) continue;
    // "नेपाली" / "English" जस्ता शीर्षक मात्र भएका लाइन नपढ्ने — skip bare language headings.
    if (/^(नेपाली|English|नेपाली\s*\/\s*English)[:.]?$/i.test(text)) continue;
    // वाक्य, र "नेपाली — English" वा "नेपाली · English" भाग छुट्याउने ताकि हरेक भाग आफ्नै आवाजमा पढियोस्।
    // Split sentences, and "Nepali — English" / "Nepali · English" halves, so each half gets its own voice.
    for (const s of text.split(/(?<=[।.!?])\s+|\s[—·/]\s/)) add(s);
  }

  // उही भाषाका सानो वाक्यहरू जोडेर चिल्लो पढाइ — join short same-language sentences for smoother speech.
  const chunks: SpeakChunk[] = [];
  for (const s of sentences) {
    const lang = langOf(s);
    const last = chunks[chunks.length - 1];
    if (last && last.lang === lang && last.text.length + s.length < MAX_CHUNK)
      last.text += ' ' + s;
    else chunks.push({ text: s, lang });
  }
  for (const c of chunks)
    c.text = c.lang === 'ne-NP' ? polishNepali(c.text) : polishEnglish(c.text);
  return chunks.filter((c) => c.text.replace(/[।.,\s]/g, ''));
}
