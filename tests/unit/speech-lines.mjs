// Unit test: the "code is on the screen" line is said once, file paths are short, and line-by-line speech maps chunks to lines.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { markdownToSpeech, unitsToSpeech, spokenFileName, codeNote } =
  await import(
    pathToFileURL(path.resolve('src/renderer/lib/speechText.ts')).href
  );
let bad = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    ok ? 'ok  ' : 'FAIL',
    name,
    ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`,
  );
  if (!ok) bad++;
};
const count = (chunks, re) => chunks.filter((c) => re.test(c.text)).length;

// ---- the code line is said ONCE, however many code blocks there are
const manyEn = [
  'Here are the files.',
  'lib/screens/quiz_screen.dart',
  '```dart\nclass A {}\n```',
  'lib/screens/home_screen.dart',
  '```dart\nclass B {}\n```',
  'lib/main.dart',
  '```dart\nvoid main() {}\n```',
].join('\n\n');
eq(
  'English: the code line is said once for 3 code blocks',
  count(markdownToSpeech(manyEn), /Guru code box/i),
  1,
);
const manyNe =
  'यसले पाठ देखाउँछ।\n\n```dart\nclass A {}\n```\n\nअर्को फाइल।\n\n```dart\nclass B {}\n```\n\n```dart\nclass C {}\n```';
eq(
  'Nepali: the code line is said once for 3 code blocks',
  count(markdownToSpeech(manyNe), /कोड Guru को कोड बाकसमा/),
  1,
);
eq(
  'no repeated "look at the screen" sentence',
  count(markdownToSpeech(manyEn), /screen/i),
  1,
);

// ---- a bare file path is spoken as a short name, not letter by letter
eq(
  'file name from a path',
  spokenFileName('lib/screens/quiz_screen.dart'),
  'quiz screen',
);
eq('file name keeps simple names', spokenFileName('main.dart'), 'main');
eq(
  'a normal sentence is not a path',
  spokenFileName('This is lib/main.dart here.'),
  null,
);
eq('a word with a dot is not a path', spokenFileName('Hello.'), null);
const pathSpeech = markdownToSpeech('lib/screens/quiz_screen.dart')
  .map((c) => c.text)
  .join(' ');
eq(
  'the spoken path has no slash or dot',
  /[\/.]dart|\//.test(pathSpeech),
  false,
);
eq(
  'the spoken path says the file name',
  /File: quiz screen/.test(pathSpeech),
  true,
);
const pathNe = markdownToSpeech('यो फाइल हो।\n\nlib/home_screen.dart')
  .map((c) => c.text)
  .join(' ');
eq(
  'Nepali answer: the path is "फाइल: home screen"',
  /फाइल: home screen/.test(pathNe),
  true,
);

// ---- line by line (Spotify style)
const units = ['First line here.', 'Second line here.', 'Third line here.'];
const all = unitsToSpeech(units);
eq('all three lines are spoken in order', all.unitOf, [0, 1, 2]);
const from1 = unitsToSpeech(units, 1);
eq('starting from line 2 skips line 1', from1.unitOf, [1, 2]);
eq(
  'the first chunk is the tapped line',
  from1.chunks[0].text.startsWith('Second'),
  true,
);
eq(
  'starting past the end speaks nothing',
  unitsToSpeech(units, 9).chunks.length,
  0,
);
const withNote = unitsToSpeech(units, 2, undefined, codeNote(false));
eq(
  'the code note comes once, at the end, and belongs to no line',
  withNote.unitOf,
  [2, -1],
);
const mixed = unitsToSpeech(['This shows text.', 'यसले पाठ देखाउँछ।'], 0, 'ne-NP');
eq('"only Nepali" keeps just the Nepali line', mixed.unitOf, [1]);
const table = unitsToSpeech([
  '| Line | Meaning |\n| --- | --- |\n| 1 | shows text |',
]);
eq('a table row is still spoken', table.chunks.length > 0, true);
process.exit(bad ? 1 : 0);
