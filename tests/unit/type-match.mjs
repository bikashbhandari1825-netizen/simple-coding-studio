// Unit test: live typing sync (which target lines are already typed) and the Nepali split.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { matchProgress, pathMatchLength } = await import(
  pathToFileURL(path.resolve('src/renderer/lib/typeMatch.ts')).href
);
const { splitNepali } = await import(
  pathToFileURL(path.resolve('src/renderer/lib/splitCode.ts')).href
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

const target = "import 'a.dart';\n\nclass A {\n  int x = 1;\n}";
const none = matchProgress(target, undefined);
eq('nothing typed: nothing done, no next marker', none.states, [
  'todo',
  'todo',
  'todo',
  'todo',
  'todo',
]);
const some = matchProgress(target, "import 'a.dart';\n\nclass A {\n");
eq('two lines typed, next is the third', some.states, [
  'done',
  'done',
  'done',
  'next',
  'todo',
]);
eq(
  'counts only non-blank lines',
  [some.matched, some.total, some.nextLine],
  [2, 4, 3],
);
eq(
  'extra spaces are ignored',
  matchProgress('a;\nb;', '   a;   \n  b;').matched,
  2,
);
eq('lines must come in order', matchProgress('a;\nb;', 'b;\na;').matched, 1);
eq(
  'path prefix typed so far',
  pathMatchLength('lib/services/x.dart', 'lib/se'),
  6,
);
eq('path match ignores case', pathMatchLength('lib/x.dart', 'LIB/x'), 5);
eq('path with a typo stops there', pathMatchLength('lib/x.dart', 'lib/y'), 4);

const sp = splitNepali('Hello world.\n\n## नेपाली\n\nनमस्ते।');
eq('nepali split: english part', sp.english, 'Hello world.');
eq(
  'nepali split: nepali part starts at the heading',
  sp.nepali.startsWith('## नेपाली'),
  true,
);
eq(
  'no nepali heading: everything is english',
  splitNepali('Only English here.').nepali,
  '',
);
eq(
  'a heading inside code is not a split',
  splitNepali('```\n## नेपाली\n```\ntext').nepali,
  '',
);
process.exit(bad ? 1 : 0);
