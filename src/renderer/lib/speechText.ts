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

export function markdownToSpeech(markdown: string): SpeakChunk[] {
  const sentences: string[] = [];
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
      if (!rest.length) sentences.push(`${first}.`);
      rest.forEach((cell, i) =>
        sentences.push(i === 0 ? `${first}: ${cell}.` : `${cell}.`),
      );
      continue;
    }
    const text = cleanInline(line.replace(/^[-*+]\s+|^\d+[.)]\s+/, ''));
    if (!text) continue;
    // "नेपाली" / "English" जस्ता शीर्षक मात्र भएका लाइन नपढ्ने — skip bare language headings.
    if (/^(नेपाली|English|नेपाली\s*\/\s*English)[:.]?$/i.test(text)) continue;
    // वाक्य, र "नेपाली — English" वा "नेपाली · English" भाग छुट्याउने ताकि हरेक भाग आफ्नै आवाजमा पढियोस्।
    // Split sentences, and "Nepali — English" / "Nepali · English" halves, so each half gets its own voice.
    for (const s of text.split(/(?<=[।.!?])\s+|\s[—·]\s/))
      if (s.trim()) sentences.push(s.trim());
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
  return chunks;
}
