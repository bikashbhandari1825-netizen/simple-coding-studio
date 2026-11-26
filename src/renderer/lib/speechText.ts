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

// English वाक्यमा कोष्ठकभित्रको नेपाली अर्थ (जस्तै "shows (देखाउँछ) text") ले वाक्यलाई नेपाली बनाउनु हुँदैन।
// A Nepali gloss in brackets inside an English sentence must not turn the sentence into Nepali.
const NEPALI_GLOSS = /\s*\([^()]*[ऀ-ॿ][^()]*\)/g;

function langOf(sentence: string): SpeakChunk['lang'] {
  const bare = sentence.replace(NEPALI_GLOSS, ' ');
  const dev = bare.match(DEVANAGARI)?.length ?? 0;
  const lat = bare.match(LATIN)?.length ?? 0;
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

// English जवाफमा चिन्हका नाम पनि English मा — in an English answer the symbol names are English too
const SYMBOL_NAMES_EN: Record<string, string> = {
  '{': 'curly brace',
  '}': 'curly brace',
  '(': 'bracket',
  ')': 'bracket',
  '[': 'square bracket',
  ']': 'square bracket',
  ';': 'semicolon',
  '=': 'equals sign',
  '=>': 'arrow',
  '<': 'less than',
  '>': 'greater than',
  ':': 'colon',
  '.': 'dot',
  ',': 'comma',
  '+': 'plus',
  '-': 'minus',
  '*': 'star',
  '/': 'slash',
  '!': 'not sign',
  '&': 'and sign',
  '|': 'pipe',
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

/** Quiz/challenge/result JSON लाई बोल्न मिल्ने पाठमा — speak quiz, challenge and result cards as sentences. */
function speakBlocks(markdown: string): string {
  return markdown.replace(
    /```(quiz|challenge|result)[^\n]*\n([\s\S]*?)```/g,
    (all, kind: string, body: string) => {
      try {
        const d = JSON.parse(body.trim()) as Record<string, unknown>;
        if (kind === 'quiz') {
          const qs = (d.questions as { q: string; options: string[] }[]) ?? [];
          return qs
            .map(
              (q, i) =>
                `प्रश्न ${i + 1}. ${q.q}\n` +
                q.options.map((o, j) => `${'ABCD'[j]}. ${o}`).join('\n'),
            )
            .join('\n');
        }
        if (kind === 'challenge')
          return [d.title, d.taskNe, d.taskEn].filter(Boolean).join('\n');
        return [d.tip_ne, d.tip_en].filter(Boolean).join('\n');
      } catch {
        return all;
      }
    },
  );
}

type Section = 'en' | 'ne' | null;

/**
 * 🔁 क्रम: सधैं सरल English पहिले, त्यसपछि नेपाली। जवाफमा नेपाली अघि परेको भए आवाजमा उल्टाइन्छ।
 * Order rule: always simple English first, then Nepali. If an answer has Nepali first, it is swapped for speech.
 */
function englishFirst(items: { s: string; sec: Section }[]): string[] {
  // "English" / "नेपाली" शीर्षकका खण्ड (block) जोडा परेमा सटाउने — swap an adjacent Nepali block + English block
  const blocks: { sec: Section; list: string[] }[] = [];
  for (const it of items) {
    const last = blocks[blocks.length - 1];
    if (last && last.sec === it.sec) last.list.push(it.s);
    else blocks.push({ sec: it.sec, list: [it.s] });
  }
  for (let i = 0; i + 1 < blocks.length; i++) {
    if (blocks[i].sec === 'ne' && blocks[i + 1].sec === 'en') {
      [blocks[i], blocks[i + 1]] = [blocks[i + 1], blocks[i]];
      i++;
    }
  }
  return blocks.flatMap((b) => b.list);
}

export function markdownToSpeech(markdown: string): SpeakChunk[] {
  markdown = speakBlocks(markdown);
  // जवाफ नेपालीमा छ? नत्र हरेक सहायक वाक्य English — is the answer Nepali? Otherwise every helper phrase is English
  const nepaliAnswer = /[ऀ-ॿ]{3}/.test(markdown.replace(/```[\s\S]*?```/g, ''));
  const sentences: { s: string; sec: Section }[] = [];
  let section: Section = null;
  // हरेक वाक्य आफ्नै विरामसहित; चिन्ह मात्र भए त्यसको नाम भन्ने — every sentence ends with its own stop,
  // and a sentence made only of symbols is spoken as the symbols' names.
  const add = (raw: string) => {
    let s = raw.trim();
    if (!s) return;
    if (!/[\p{L}\p{N}]/u.test(s)) {
      const names = [...new Set(s.match(/=>|[{}()[\];=<>:.,+\-*/!&|]/g) ?? [])]
        .map((ch) => (nepaliAnswer ? SYMBOL_NAMES : SYMBOL_NAMES_EN)[ch])
        .filter(Boolean);
      if (!names.length) return;
      s = [...new Set(names)].join(', ');
    }
    if (!/[।.!?:]$/.test(s)) s += langOf(s) === 'ne-NP' ? '।' : '.';
    sentences.push({ s, sec: section });
  };
  const lines = markdown.replace(/\r/g, '').split('\n');
  let inCode = false;
  // "कोड छ" भन्ने वाक्य एकपटक मात्र — the "code is on the screen" sentence is said only once per answer
  let codeAnnounced = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      if (!inCode && !codeAnnounced) {
        codeAnnounced = true;
        sentences.push({
          // जवाफ English मा छ भने यो वाक्य पनि English — नेपाली बीचमा नघुस्न
          // An English answer gets an English cue, so no Nepali sentence ever pops up in the middle
          s: codeNote(nepaliAnswer),
          sec: section,
        });
      }
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
    let text = cleanInline(line.replace(/^[-*+]\s+|^\d+[.)]\s+/, ''));
    if (!text) continue;
    // फाइलको बाटो अक्षर-अक्षर नपढ्ने, "File: home screen" भन्ने — a bare file path is spoken as a short file name
    const fileName = spokenFileName(
      line.replace(/^[-*+]\s+|^\d+[.)]\s+/, '').replace(/[`*]/g, ''),
    );
    if (fileName) {
      add(nepaliAnswer ? `फाइल: ${fileName}` : `File: ${fileName}`);
      continue;
    }
    // "English: …" / "नेपाली: …" लेबल: खण्ड चिनो राखेर लेबल हटाउने — keep the section, drop the spoken label
    const labelled = /^(English|नेपाली)\s*[:：]\s*(.+)$/i.exec(text);
    if (labelled) {
      section = /^English/i.test(labelled[1]) ? 'en' : 'ne';
      text = labelled[2];
    }
    // "नेपाली" / "English" जस्ता शीर्षक मात्र भएका लाइन नपढ्ने — skip bare language headings.
    if (/^(नेपाली|English|नेपाली\s*\/\s*English)[:.]?$/i.test(text)) {
      section = /^English/i.test(text)
        ? 'en'
        : /^नेपाली[:.]?$/.test(text)
          ? 'ne'
          : null;
      continue;
    }
    // वाक्य, र "नेपाली — English" वा "नेपाली · English" भाग छुट्याउने ताकि हरेक भाग आफ्नै आवाजमा पढियोस्।
    // Split sentences, and "Nepali — English" / "Nepali · English" halves, so each half gets its own voice.
    // एउटै लाइनमा "नेपाली — English" भए English पहिले — a single "Nepali — English" line is spoken English first
    const before = sentences.length;
    for (const s of text.split(/(?<=[।.!?])\s+|\s[—·/]\s/)) add(s);
    const added = sentences.slice(before);
    if (
      added.length === 2 &&
      langOf(added[0].s) === 'ne-NP' &&
      langOf(added[1].s) === 'en-US'
    )
      sentences.splice(before, 2, added[1], added[0]);
  }

  // उही भाषाका सानो वाक्यहरू जोडेर चिल्लो पढाइ — join short same-language sentences for smoother speech.
  const chunks: SpeakChunk[] = [];
  for (const s of englishFirst(sentences)) {
    const lang = langOf(s);
    const last = chunks[chunks.length - 1];
    if (last && last.lang === lang && last.text.length + s.length < MAX_CHUNK)
      last.text += ' ' + s;
    else chunks.push({ text: s, lang });
  }
  for (const c of chunks)
    c.text =
      c.lang === 'ne-NP'
        ? polishNepali(c.text)
        : polishEnglish(c.text.replace(NEPALI_GLOSS, ' '));
  return chunks.filter((c) => c.text.replace(/[।.,\s]/g, ''));
}

/** "कोड छ" भन्ने एउटा वाक्य — the one sentence that says the code is on the screen */
export function codeNote(nepali: boolean): string {
  return nepali
    ? 'कोड Guru को कोड बाकसमा छ, स्क्रिनमा हेर्नुहोस्।'
    : 'The code is in the Guru code box on the screen.';
}

const FILE_EXT =
  /^[\w./\\-]+\.(dart|py|js|ts|tsx|jsx|json|yaml|yml|md|html|css|kt|java|xml|gradle|txt)$/i;

/** फाइलको बाटोबाट छोटो नाम (बोल्न मिल्ने) — a short speakable name from a file path, or null when the line is not a path */
export function spokenFileName(line: string): string | null {
  const t = line.trim();
  if (!FILE_EXT.test(t)) return null;
  const base = t.split(/[\\/]/).pop() ?? t;
  const name = base
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return name || null;
}

/**
 * 🎵 लाइन-लाइनको पढाइ (Spotify जस्तै): देखिएका हरेक लाइन (unit) को आवाज, र कुन आवाज कुन लाइनको हो।
 * Line-by-line speech: the chunks for each displayed line (unit) from `from` on, plus which unit each chunk belongs to
 * (so the screen can highlight the line being read). `note` is spoken once at the end and belongs to no line (-1).
 */
export function unitsToSpeech(
  units: string[],
  from = 0,
  only?: SpeakChunk['lang'],
  note?: string,
): { chunks: SpeakChunk[]; unitOf: number[] } {
  const chunks: SpeakChunk[] = [];
  const unitOf: number[] = [];
  const push = (list: SpeakChunk[], u: number) => {
    for (const c of list) {
      if (only && c.lang !== only) continue;
      chunks.push(c);
      unitOf.push(u);
    }
  };
  for (let u = Math.max(0, from); u < units.length; u++)
    push(markdownToSpeech(units[u]), u);
  if (note) push(markdownToSpeech(note), -1);
  return { chunks, unitOf };
}
