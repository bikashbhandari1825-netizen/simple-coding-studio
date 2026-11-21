// Unit test: Guru answers split into an explanation box and separate code boxes; plain-language error hints.
// node tests/unit/split-code.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { splitCode } = await import(
  pathToFileURL(path.resolve('src/renderer/lib/splitCode.ts')).href
);
const { hintFor } = await import(
  pathToFileURL(path.resolve('src/renderer/lib/editorErrorHint.ts')).href
);
let bad = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  console.log(
    ok ? 'ok  ' : 'FAIL',
    name,
    ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`,
  );
  if (!ok) bad++;
};
const md =
  '## English\n\nCreate the file.\n\nlib/main.dart\n\n```dart\nvoid main() {}\n```\n\n## नेपाली\n\nफाइल बनाउनुहोस्।\n\n`pubspec.yaml`\n\n```yaml\nname: a\n```';
const r = splitCode(md);
eq('two code blocks', r.blocks.length, 2);
eq(
  'first block title is the path above it',
  r.blocks[0].title,
  'lib/main.dart',
);
eq('second block title (backticked path)', r.blocks[1].title, 'pubspec.yaml');
eq('code is not in the explanation text', r.text.includes('void main'), false);
eq(
  'English heading comes before Nepali in the text',
  r.text.indexOf('English') < r.text.indexOf('नेपाली'),
  true,
);
eq(
  'path lines are removed from the text',
  r.text.includes('lib/main.dart'),
  false,
);
eq('no code → no blocks', splitCode('## English\n\nHello.').blocks.length, 0);
eq(
  'unfinished block is still a code block',
  splitCode('Text\n\n```dart\nvoid ma').blocks.length,
  1,
);
eq(
  'hint: semicolon (English first)',
  hintFor("Expected to find ';'.", 3).en.startsWith('A semicolon'),
  true,
);
eq(
  'hint: has Nepali too',
  /[ऀ-ॿ]/.test(hintFor("Expected to find ';'.", 3).ne),
  true,
);
eq(
  'hint: English has no Nepali',
  /[ऀ-ॿ]/.test(hintFor("Undefined name 'nme'.", 2).en),
  false,
);
eq(
  'hint: name is quoted',
  hintFor("Cannot find name 'nme'. Did you mean 'name'?", 2).en.includes(
    '"nme"',
  ),
  true,
);
eq(
  'hint: generic fallback names the line',
  hintFor('something odd', 7).en.includes('line 7'),
  true,
);
const pl = splitCode(
  'Plan\n\n`lib/main.dart` — app entry, replace whole file\n\n```dart\nvoid main() {}\n```',
);
eq('placement: title', pl.blocks[0].title, 'lib/main.dart');
eq('placement: note', pl.blocks[0].place, 'app entry, replace whole file');
eq('placement: plan text kept', pl.text, 'Plan');
process.exit(bad ? 1 : 0);
