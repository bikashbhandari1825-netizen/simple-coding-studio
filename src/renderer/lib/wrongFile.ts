// 🚫 गलत फाइलमा कोड: Guru ले अर्को फाइलको भनेको कोड यो फाइलमा राखियो भने समात्ने।
// Wrong-file check: catches code that Guru assigned to a different file being typed into this one.

export interface StepFile {
  title?: string;
  code: string;
}

export interface WrongFile {
  line: number;
  startColumn: number;
  endColumn: number;
  /** के नाम (class वा main) — the class or function name */
  name: string;
  /** त्यो कोड कुन फाइलको हो — the file that code really belongs to */
  belongsTo: string;
}

const slashes = (p: string) => p.split('\\').join('/');

/** फाइलको बाटो र Guru ले दिएको नाम मिल्छ? — does this file path match the file name Guru gave? */
export function samePath(path: string, title: string): boolean {
  const want = '/' + slashes(title).replace(/^\.?\//, '');
  return ('/' + slashes(path)).toLowerCase().endsWith(want.toLowerCase());
}

const DEFINES =
  /^[ \t]*(?:abstract\s+|final\s+)?class\s+([A-Za-z_]\w*)|^[ \t]*(?:Future<void>\s+|void\s+)(main)\s*\(/gm;

/** कोडमा परिभाषित class र main() — the classes and main() a piece of code defines */
export function definedNames(
  code: string,
): { name: string; line: number; startColumn: number; endColumn: number }[] {
  const out: {
    name: string;
    line: number;
    startColumn: number;
    endColumn: number;
  }[] = [];
  for (const m of code.matchAll(DEFINES)) {
    const name = m[1] ?? m[2];
    const at = (m.index ?? 0) + m[0].lastIndexOf(name);
    const before = code.slice(0, at);
    const line = before.split('\n').length;
    const startColumn = at - before.lastIndexOf('\n');
    out.push({ name, line, startColumn, endColumn: startColumn + name.length });
  }
  return out;
}

export function findWrongFile(
  path: string,
  content: string,
  steps: StepFile[],
): WrongFile[] {
  if (!/\.dart$/i.test(path)) return [];
  const mine = steps.filter((s) => s.title && samePath(path, s.title));
  const mineNames = new Set(
    mine.flatMap((s) => definedNames(s.code).map((d) => d.name)),
  );
  const other = new Map<string, string>(); // name → file it belongs to
  for (const s of steps) {
    if (!s.title || samePath(path, s.title)) continue;
    for (const d of definedNames(s.code))
      if (!other.has(d.name)) other.set(d.name, s.title);
  }
  const out: WrongFile[] = [];
  for (const d of definedNames(content)) {
    const belongsTo = other.get(d.name);
    if (belongsTo && !mineNames.has(d.name)) out.push({ ...d, belongsTo });
  }
  return out;
}

/** Guru को कोडमा नक्कली/आधा भाग? — placeholders that mean the code is not real */
export function placeholderIn(code: string): string | undefined {
  const m =
    /\bTODO\b|\/\/\s*\.\.\.|^\s*\.\.\.\s*$|your code here|rest of (?:the )?code|same as before|implement (?:this|here)/im.exec(
      code,
    );
  return m?.[0].trim();
}
