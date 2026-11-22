// 🔧 Guru ले एउटा फाइलको class अर्को फाइलमा प्रयोग गर्‍यो तर import लेखेन भने आफैं थप्ने।
// If Guru uses a class from another file but forgets the import, add the import automatically.
// यो फाइल अरू फाइलमा निर्भर छैन (आफ्नै परीक्षण सजिलो होस् भनेर) — this file has no local imports, so it can be unit-tested on its own

const slashes = (p: string) => p.split('\\').join('/');

/** फाइलको बाटो र Guru ले दिएको नाम मिल्छ? — does a path end with the given file name? */
function samePath(path: string, title: string): boolean {
  const want = '/' + slashes(title).replace(/^\.?\//, '');
  return ('/' + slashes(path)).toLowerCase().endsWith(want.toLowerCase());
}

/** कोडमा परिभाषित class नाम — the class names a piece of code defines */
function definedNames(code: string): { name: string }[] {
  const out: { name: string }[] = [];
  for (const m of code.matchAll(
    /^[ \t]*(?:abstract\s+|final\s+|base\s+|sealed\s+)?(?:mixin\s+)?class\s+([A-Za-z_]\w*)|^[ \t]*enum\s+([A-Za-z_]\w*)/gm,
  ))
    out.push({ name: m[1] ?? m[2] });
  return out;
}

export interface FixBlock {
  title?: string;
  code: string;
  /** थपिएका import लाइन — the import lines that were added */
  addedImports?: string[];
}

const IMPORT_LINE = /^\s*import\s+['"]([^'"]+)['"][^;]*;/gm;

function dirOf(p: string): string {
  return p
    .split('\\')
    .join('/')
    .replace(/\/[^/]*$/, '');
}

/** from फाइलबाट to फाइलसम्मको सापेक्ष बाटो — a relative path from one file to another */
export function relativeImport(from: string, to: string): string {
  const a = dirOf(from).split('/').filter(Boolean);
  const b = to.split('\\').join('/').split('/').filter(Boolean);
  const file = b.pop() as string;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ups = a.length - i;
  const down = b.slice(i);
  return [...Array(ups).fill('..'), ...down, file].join('/');
}

/** यो फाइलमा कुन फाइलहरू import भएका छन् (सापेक्ष वा package:) — which files this file already imports */
function importedTargets(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(IMPORT_LINE)) out.push(m[1]);
  return out;
}

/** Dart का import लाइनपछिको ठाउँ — the position right after the last import line (or after the leading comments) */
function insertionPoint(code: string): number {
  let end = -1;
  for (const m of code.matchAll(IMPORT_LINE))
    end = (m.index ?? 0) + m[0].length;
  if (end >= 0) return end;
  // import छैन भने सुरुका टिप्पणी/खाली लाइनपछि — otherwise after the leading comment lines
  let pos = 0;
  for (const line of code.split('\n')) {
    if (line.trim() === '' || line.trim().startsWith('//'))
      pos += line.length + 1;
    else break;
  }
  return Math.min(pos, code.length);
}

/**
 * एउटै उत्तरका फाइलहरू जाँचेर छुटेका import थप्ने — check the files of one answer and add the missing imports.
 * सुरक्षा: Dart फाइल र lib/ भित्रका मात्र छोइन्छ — safety: only Dart files under lib/ are touched.
 */
export function fixMissingImports<T extends FixBlock>(blocks: T[]): T[] {
  const dart = blocks.filter(
    (b) =>
      b.title && /(^|\/)lib\/.+\.dart$/i.test(b.title.split('\\').join('/')),
  );
  // class नाम → उसलाई परिभाषित गर्ने फाइल — class name → the file that defines it
  const owner = new Map<string, string>();
  for (const b of dart)
    for (const d of definedNames(b.code))
      if (d.name !== 'main' && !owner.has(d.name))
        owner.set(d.name, b.title as string);

  return blocks.map((b) => {
    const title = b.title;
    if (!title || !dart.includes(b)) return b;
    const mine = new Set(definedNames(b.code).map((d) => d.name));
    const imports = importedTargets(b.code);
    // टिप्पणी र string भित्रका शब्द class होइनन् — words inside comments and strings are not class uses
    const bare = b.code
      .replace(/\/\/.*$/gm, '')
      .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''");
    const used = new Set(
      [...bare.matchAll(/\b[A-Z][A-Za-z0-9_]*\b/g)].map((m) => m[0]),
    );
    const need = new Set<string>(); // फाइलहरू जसको import चाहिन्छ — files that need an import
    for (const name of used) {
      const file = owner.get(name);
      if (
        !file ||
        mine.has(name) ||
        samePath(file, title) ||
        samePath(title, file)
      )
        continue;
      const already = imports.some((uri) => {
        if (uri.startsWith('package:')) {
          // package:app/screens/x.dart → lib/screens/x.dart
          const tail = uri.replace(/^package:[^/]+\//, '');
          return samePath(file, 'lib/' + tail) || samePath(file, tail);
        }
        if (uri.startsWith('dart:')) return false;
        const resolved = relativeImport(title, file);
        return uri === resolved || samePath(file, uri.replace(/^\.\//, ''));
      });
      if (!already) need.add(file);
    }
    if (need.size === 0) return b;
    const lines = [...need].map(
      (file) => `import '${relativeImport(title, file)}';`,
    );
    const at = insertionPoint(b.code);
    const before = b.code.slice(0, at);
    const after = b.code.slice(at);
    const sep = before.length && !before.endsWith('\n') ? '\n' : '';
    const code = `${before}${sep}${lines.join('\n')}\n${after.startsWith('\n') ? after.slice(1) : after}`;
    return { ...b, code, addedImports: lines };
  });
}
