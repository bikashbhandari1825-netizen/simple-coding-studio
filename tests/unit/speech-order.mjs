// Unit test: spoken order is always simple English first, then Nepali.
// node tests/unit/speech-order.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const mod = await import(
  pathToFileURL(path.resolve('src/renderer/lib/speechText.ts')).href
);
const { markdownToSpeech } = mod;
let bad = 0;
const check = (name, md, want) => {
  const got = markdownToSpeech(md).map((c) => c.lang);
  const ok = got.join() === want.join();
  console.log(ok ? 'ok  ' : 'FAIL', name, '->', got.join(' '));
  if (!ok) bad++;
};
const E = 'en-US';
const N = 'ne-NP';
check(
  'English then Nepali headings stay',
  '## English\n\nThis shows text on the screen.\n\n## नेपाली\n\nयसले स्क्रिनमा पाठ देखाउँछ।',
  [E, N],
);
check(
  'Nepali then English headings are swapped',
  '## नेपाली\n\nयसले स्क्रिनमा पाठ देखाउँछ।\n\n## English\n\nThis shows text on the screen.',
  [E, N],
);
check(
  'one "Nepali — English" line is swapped',
  'यसले पाठ देखाउँछ। — This shows text.',
  [E, N],
);
check(
  'bullets under headings (multi) keep English block first',
  '**नेपाली**\n\n- पहिलो कुरा।\n- दोस्रो कुरा।\n\n**English**\n\n- First point.\n- Second point.',
  [E, N],
);
check(
  'code block is announced, not read',
  '## English\n\nSee the code.\n\n```dart\nvoid main() {}\n```\n\n## नेपाली\n\nकोड हेर्नुहोस्।',
  [E, N],
);
check(
  'English sentence with a Nepali gloss in brackets stays English',
  'English: print() shows (देखाउँछ) text on the screen.\n\nनेपाली: print() ले स्क्रिनमा लेख देखाउँछ।',
  [E, N],
);
check(
  'labelled lines "नेपाली: … / English: …" are swapped',
  'नेपाली: print() ले स्क्रिनमा लेख देखाउँछ।\n\nEnglish: print() shows (देखाउँछ) text on the screen.',
  [E, N],
);
const eng = markdownToSpeech(
  'English: print() shows (देखाउँछ) text on the screen.',
)[0];
if (/[ऀ-ॿ]/.test(eng.text) || eng.text.startsWith('English')) {
  console.log('FAIL gloss/label not removed from spoken English:', eng.text);
  bad++;
} else console.log('ok   spoken English has no gloss or label ->', eng.text);
// ---- English answer: nothing Nepali is ever spoken in the middle
const englishOnly = markdownToSpeech(
  'This file is in `lib/main.dart`, for example.\n\n```dart\nvoid main() {}\n```\n\nThe symbols are:\n\n{\n\nRun it, e.g. a = b, then stop.',
);
const allSpoken = englishOnly.map((c) => c.text).join(' | ');
if (/[ऀ-ॿ]/.test(allSpoken) || englishOnly.some((c) => c.lang !== 'en-US')) {
  console.log('FAIL Nepali words in an English answer:', allSpoken);
  bad++;
} else
  console.log('ok   English answer is spoken fully in English ->', allSpoken);
const cue = englishOnly.find((c) => /code is on the screen/i.test(c.text));
if (!cue) {
  console.log('FAIL the code cue is not English');
  bad++;
} else console.log('ok   code cue is English');
// Nepali answer keeps the Nepali cue
const nep = markdownToSpeech('यसले पाठ देखाउँछ।\n\n```dart\nvoid main() {}\n```');
if (!nep.some((c) => /code छ/.test(c.text))) {
  console.log('FAIL Nepali answer lost its Nepali cue');
  bad++;
} else console.log('ok   Nepali answer keeps the Nepali cue');
process.exit(bad ? 1 : 0);
