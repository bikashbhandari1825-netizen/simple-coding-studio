// 🔁 सुरक्षा जाल: Guru ले कहिले नेपाली अघि लेखे पनि देखाउँदा सधैं सरल English पहिले, त्यसपछि नेपाली।
// Safety net: even if the model writes Nepali first (for example because the learner asked in Nepali),
// the displayed answer is reordered so simple English always comes first, then Nepali.
// Only whole "नेपाली" / "English" sections are swapped; code blocks and the closing 📚 word list stay put.

type Kind = 'ne' | 'en' | 'tail' | 'other';

interface Block {
  kind: Kind;
  lines: string[];
}

// "## English", "**नेपाली**", "🇳🇵 नेपाली:", "English: first sentence…" — a section starts here.
// "English words…" (no colon, more text) is NOT a section start.
const SECTION =
  /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:[^\p{L}\p{N}\s]{1,6}\s*)?(नेपाली|English)\s*(?:(?:\*\*|__)\s*)?(?:[:：]|\s*$)/u;
const TAIL = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*📚/u;

function kindOf(line: string): Kind {
  if (TAIL.test(line)) return 'tail';
  const m = SECTION.exec(line);
  if (!m) return 'other';
  return m[1] === 'English' ? 'en' : 'ne';
}

/** जवाफ अर्थात् Markdown लाई English-पहिले क्रममा; बदलिएन भने उही पाठ — returns the text, reordered if needed. */
export function englishFirst(markdown: string): {
  text: string;
  changed: boolean;
} {
  const lines = markdown.split('\n');
  const blocks: Block[] = [];
  let inCode = false;
  for (const line of lines) {
    if (line.trim().startsWith('```')) inCode = !inCode;
    const kind =
      inCode || line.trim().startsWith('```') ? 'other' : kindOf(line);
    const last = blocks[blocks.length - 1];
    if (kind === 'other') {
      if (last) last.lines.push(line);
      else blocks.push({ kind: 'other', lines: [line] });
    } else {
      blocks.push({ kind, lines: [line] });
    }
  }
  let changed = false;
  // पहिलो "tail" (📚) अघिका खण्डमा मात्र काम — only reorder sections before the closing word list
  for (let i = 0; i + 1 < blocks.length; i++) {
    if (blocks[i].kind === 'tail') break;
    if (blocks[i].kind === 'ne' && blocks[i + 1].kind === 'en') {
      [blocks[i], blocks[i + 1]] = [blocks[i + 1], blocks[i]];
      changed = true;
      i++;
    }
  }
  if (!changed) return { text: markdown, changed: false };
  // खण्डहरू जोड्दा खाली लाइन छुट्याउन — keep a blank line between swapped sections
  const out: string[] = [];
  for (const b of blocks) {
    const body = [...b.lines];
    while (body.length && body[body.length - 1].trim() === '') body.pop();
    if (out.length) out.push('');
    out.push(...body);
  }
  return { text: out.join('\n'), changed: true };
}
