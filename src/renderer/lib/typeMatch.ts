// ✍️ टाइप गर्दै जाँदा मिलेका लाइन चिन्ने: माथिको editor मा लेखेको कोड तलको लक्ष्य कोडसँग कति मिल्यो।
// Typing sync: how much of the target code is already typed in the editor above, line by line.

export type LineState = 'done' | 'next' | 'todo';

export interface Progress {
  /** हरेक लक्ष्य लाइनको अवस्था — the state of every target line */
  states: LineState[];
  /** मिलेका (खाली बाहेक) लाइन — matched non-blank lines */
  matched: number;
  /** जम्मा (खाली बाहेक) लाइन — all non-blank lines */
  total: number;
  /** अब टाइप गर्नुपर्ने पहिलो लाइन (नभए -1) — the first line still to type, or -1 */
  nextLine: number;
}

/**
 * लक्ष्य कोडका लाइन क्रमैसँग टाइप गरिएको पाठमा खोज्ने (खाली ठाउँ बेवास्ता)।
 * Find the target lines, in order, inside the typed text (leading/trailing spaces ignored).
 */
export function matchProgress(
  target: string,
  typed: string | undefined,
): Progress {
  const lines = target.split('\n');
  const typedLines = (typed ?? '').split('\n').map((l) => l.trim());
  const done: boolean[] = lines.map(() => false);
  let pointer = 0;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    for (let k = pointer; k < typedLines.length; k++) {
      if (typedLines[k] === t) {
        done[i] = true;
        pointer = k + 1;
        return;
      }
    }
  });
  const states: LineState[] = lines.map((line, i) => {
    if (line.trim()) return done[i] ? 'done' : 'todo';
    // खाली लाइन: अघि र पछिका लाइन मिलेका भए मात्र — a blank line counts when the lines around it matched
    let a = i - 1;
    while (a >= 0 && !lines[a].trim()) a--;
    let b = i + 1;
    while (b < lines.length && !lines[b].trim()) b++;
    return a >= 0 && b < lines.length && done[a] && done[b] ? 'done' : 'todo';
  });
  const total = lines.filter((l) => l.trim()).length;
  const matched = done.filter(Boolean).length;
  const nextLine = lines.findIndex((l, i) => l.trim() && !done[i]);
  if (matched > 0 && nextLine >= 0) states[nextLine] = 'next';
  return { states, matched, total, nextLine };
}

/** बाटो टाइप गर्दा अहिलेसम्म मिलेका अक्षर — how many leading characters of the path are typed so far */
export function pathMatchLength(path: string, typed: string): number {
  const a = path.toLowerCase();
  const b = typed.trim().toLowerCase();
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}
