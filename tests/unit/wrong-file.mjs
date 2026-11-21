// Unit test: code typed into the wrong file is caught; placeholders are flagged.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { findWrongFile, placeholderIn } = await import(
  pathToFileURL(path.resolve('src/renderer/lib/wrongFile.ts')).href
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
const steps = [
  {
    title: 'lib/main.dart',
    code: 'void main() {}\nclass MyApp extends StatelessWidget {}',
  },
  {
    title: 'lib/screen.dart',
    code: 'class HomeScreen extends StatelessWidget {}',
  },
];
const wrong = findWrongFile(
  'C:/p/lib/main.dart',
  'void main() {}\nclass HomeScreen extends StatelessWidget {}',
  steps,
);
eq(
  'screen class in main.dart is wrong',
  wrong.map((w) => [w.name, w.belongsTo, w.line]),
  [['HomeScreen', 'lib/screen.dart', 2]],
);
eq(
  'own code is fine',
  findWrongFile(
    'C:/p/lib/screen.dart',
    'class HomeScreen extends StatelessWidget {}',
    steps,
  ),
  [],
);
eq(
  'main() in screen.dart is wrong',
  findWrongFile('/p/lib/screen.dart', 'void main() {}', steps).map(
    (w) => w.name,
  ),
  ['main'],
);
eq(
  'unknown class is fine',
  findWrongFile('/p/lib/other.dart', 'class Brand {}', steps),
  [],
);
eq('no steps is fine', findWrongFile('/p/lib/main.dart', 'class A {}', []), []);
eq('placeholder TODO', placeholderIn('void f() {\n  // TODO\n}'), 'TODO');
eq('placeholder dots', placeholderIn('void f() {\n  // ...\n}'), '// ...');
eq('real code has none', placeholderIn('void f() { print(1); }'), undefined);
process.exit(bad ? 1 : 0);
