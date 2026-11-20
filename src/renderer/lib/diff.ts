// 🔍 सानो line-diff र कोड-टुक्रा मिलाउने — a small line diff and a snippet merger (no dependencies).

export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
}

const MAX_CELLS = 4_000_000;

/** पुरानो र नयाँ पाठको लाइन-अन्तर — line-by-line difference between old and new text. */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: DiffLine[] = a
    .slice(0, start)
    .map((text) => ({ type: 'same', text }));
  const ma = a.slice(start, endA);
  const mb = b.slice(start, endB);
  if (ma.length * mb.length > MAX_CELLS) {
    for (const text of ma) out.push({ type: 'del', text });
    for (const text of mb) out.push({ type: 'add', text });
  } else {
    const w = mb.length + 1;
    const t = new Uint32Array((ma.length + 1) * w);
    for (let i = ma.length - 1; i >= 0; i--)
      for (let j = mb.length - 1; j >= 0; j--)
        t[i * w + j] =
          ma[i] === mb[j]
            ? t[(i + 1) * w + j + 1] + 1
            : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < ma.length && j < mb.length) {
      if (ma[i] === mb[j]) {
        out.push({ type: 'same', text: ma[i] });
        i++;
        j++;
      } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) {
        out.push({ type: 'del', text: ma[i++] });
      } else {
        out.push({ type: 'add', text: mb[j++] });
      }
    }
    while (i < ma.length) out.push({ type: 'del', text: ma[i++] });
    while (j < mb.length) out.push({ type: 'add', text: mb[j++] });
  }
  for (const text of a.slice(endA)) out.push({ type: 'same', text });
  return out;
}

export function diffStats(lines: DiffLine[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.type === 'add') added++;
    else if (l.type === 'del') removed++;
  }
  return { added, removed };
}

const norm = (s: string) => s.trim();

/**
 * AI को कोड-टुक्रालाई फाइलमा राख्ने ठाउँ पत्ता लगाउने।
 * - टुक्रा लगभग पूरै फाइल जत्रो भए: पूरै फाइल बदल्ने
 * - होइन भने: टुक्राको पहिलो र अन्तिम लाइन फाइलमा खोज्ने र बीचको भाग बदल्ने
 * Find where an AI code snippet belongs: a near-whole-file snippet replaces the file; otherwise its first and
 * last lines are located in the file and the range between them is replaced. Returns null when unsure.
 */
export function mergeSnippet(
  fileText: string,
  snippet: string,
): { text: string; mode: 'whole' | 'range' } | null {
  const file = fileText.replace(/\r\n/g, '\n');
  const snip = snippet.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  if (!snip.trim()) return null;
  const fl = file.split('\n');
  const sl = snip.split('\n');
  const crlf = fileText.includes('\r\n');
  const keepEol = (t: string) => (crlf ? t.replace(/\n/g, '\r\n') : t);
  if (file.trim() === '' || sl.length >= fl.length * 0.7) {
    const nl = file.endsWith('\n') || file.trim() === '' ? '\n' : '';
    return { text: keepEol(snip + nl), mode: 'whole' };
  }
  const first = sl.findIndex((l) => norm(l) !== '');
  let last = sl.length - 1;
  while (last > first && norm(sl[last]) === '') last--;
  const a = norm(sl[first]);
  const z = norm(sl[last]);
  const starts: number[] = [];
  fl.forEach((l, i) => {
    if (norm(l) === a) starts.push(i);
  });
  if (starts.length !== 1) return null; // अस्पष्ट — ambiguous or missing
  const s = starts[0];
  let e = -1;
  for (let i = Math.min(fl.length - 1, s + sl.length * 3 + 20); i >= s; i--) {
    if (norm(fl[i]) === z) {
      e = i;
      break;
    }
  }
  if (e < s) return null;
  const merged = [...fl.slice(0, s), ...sl, ...fl.slice(e + 1)].join('\n');
  return { text: keepEol(merged), mode: 'range' };
}

const NOT_CODE = new Set([
  'quiz',
  'challenge',
  'result',
  'bash',
  'sh',
  'shell',
  'powershell',
  'cmd',
  'console',
  'text',
]);

/** यो भाषाको block फाइलमा लगाउन मिल्छ? — can a block of this language be applied to a file? */
export function isApplicableLanguage(language: string): boolean {
  return !NOT_CODE.has(language.toLowerCase());
}

/** जवाफबाट पहिलो काम लाग्ने कोड block निकाल्ने — pick the first useful fenced code block of an answer. */
export function firstCodeBlock(
  markdown: string,
): { language: string; code: string } | null {
  const re = /```([\w+-]*)[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const language = m[1].toLowerCase();
    if (!isApplicableLanguage(language)) continue;
    if (m[2].trim()) return { language, code: m[2] };
  }
  return null;
}
