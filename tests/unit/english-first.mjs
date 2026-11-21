// Unit test: the displayed answer is always simple English first, then Nepali.
// node tests/unit/english-first.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { englishFirst } = await import(
  pathToFileURL(path.resolve('src/renderer/lib/englishFirst.ts')).href
);
let bad = 0;
const check = (name, cond, extra = '') => {
  console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra);
  if (!cond) bad++;
};

// 1. Nepali first (headings) -> swapped
let r = englishFirst(
  '## नेपाली\n\nयसले पाठ देखाउँछ।\n\n## English\n\nThis shows text.',
);
check(
  'Nepali-first headings are swapped',
  r.changed && r.text.indexOf('This shows text.') < r.text.indexOf('यसले पाठ'),
  r.text,
);

// 2. labelled lines (the real model output shape)
r = englishFirst(
  'नेपाली: print() ले स्क्रिनमा देखाउँछ।\n\nEnglish: print() shows text on the screen.',
);
check(
  'Nepali-first labelled lines are swapped',
  r.changed && r.text.startsWith('English:'),
  r.text,
);

// 3. already English-first -> unchanged
const ok = '## English\n\nThis shows text.\n\n## नेपाली\n\nयसले पाठ देखाउँछ।';
r = englishFirst(ok);
check('English-first answer is untouched', !r.changed && r.text === ok);

// 4. the closing word list stays at the very end
r = englishFirst(
  '**नेपाली**\n\nयसले पाठ देखाउँछ।\n\n**English**\n\nThis shows text.\n\n📚 नयाँ English शब्द / New English words\n\nprint — छाप्नु',
);
check(
  'word list stays last',
  r.changed &&
    r.text.indexOf('This shows text.') < r.text.indexOf('यसले पाठ') &&
    r.text.indexOf('📚') > r.text.indexOf('यसले पाठ'),
  r.text,
);

// 5. text before the sections (a code line) stays first
r = englishFirst(
  'print("Hello")\n\nनेपाली: नमस्ते देखाउँछ।\n\nEnglish: It shows hello.',
);
check(
  'preamble stays, sections swap',
  r.changed &&
    r.text.startsWith('print("Hello")') &&
    r.text.indexOf('English:') < r.text.indexOf('नेपाली:'),
  r.text,
);

// 6. "English words…" (no colon) is not a section
const plain = 'यो नेपाली वाक्य हो।\n\nEnglish words are useful.';
r = englishFirst(plain);
check('"English words" line is not a section', !r.changed);

// 7. labels inside a code block are ignored
const code = '```dart\n// नेपाली: x\n// English: y\n```';
r = englishFirst(code);
check('code block content is ignored', !r.changed);

// 8. emoji-prefixed Nepali heading
r = englishFirst('🇳🇵 नेपाली\n\nनमस्ते।\n\n🇬🇧 English\n\nHello.');
check(
  'emoji headings are recognised',
  r.changed && r.text.indexOf('Hello.') < r.text.indexOf('नमस्ते'),
  r.text,
);

// 9. Nepali-only answer is untouched
r = englishFirst('नेपाली\n\nयो नेपाली मात्र हो।');
check('Nepali-only answer is untouched', !r.changed);

process.exit(bad ? 1 : 0);
