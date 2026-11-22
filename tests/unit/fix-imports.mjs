// Unit test: a class used from another file gets its import added automatically.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { fixMissingImports, relativeImport } = await import(
  pathToFileURL(path.resolve('src/renderer/lib/fixImports.ts')).href
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

eq(
  'relative: sibling folder',
  relativeImport('lib/screens/a.dart', 'lib/models/q.dart'),
  '../models/q.dart',
);
eq(
  'relative: same folder',
  relativeImport('lib/a.dart', 'lib/b.dart'),
  'b.dart',
);
eq(
  'relative: deeper',
  relativeImport('lib/main.dart', 'lib/screens/home.dart'),
  'screens/home.dart',
);

const blocks = [
  {
    title: 'pubspec.yaml',
    code: 'name: quiz\ndependencies:\n  flutter:\n    sdk: flutter\n',
  },
  {
    title: 'lib/models/question.dart',
    code: 'class Question {\n  final String text;\n  Question(this.text);\n}\n',
  },
  {
    title: 'lib/screens/question_screen.dart',
    code: "import 'package:flutter/material.dart';\n\nclass QuestionScreen extends StatelessWidget {\n  final Question question;\n  const QuestionScreen({super.key, required this.question});\n  @override\n  Widget build(BuildContext context) => Text(question.text);\n}\n",
  },
  {
    title: 'lib/main.dart',
    code: "import 'package:flutter/material.dart';\nimport 'screens/question_screen.dart';\nimport 'models/question.dart';\n\nvoid main() => runApp(MaterialApp(home: QuestionScreen(question: Question('x'))));\n",
  },
];
const fixed = fixMissingImports(blocks);
const screen = fixed.find(
  (b) => b.title === 'lib/screens/question_screen.dart',
);
eq(
  'missing import is added',
  screen.code.includes("import '../models/question.dart';"),
  true,
);
eq(
  'added after the existing import',
  screen.code.indexOf('package:flutter/material.dart') <
    screen.code.indexOf('../models/question.dart'),
  true,
);
eq('addedImports lists it', screen.addedImports, [
  "import '../models/question.dart';",
]);
eq(
  'a file that already imports is untouched',
  fixed.find((b) => b.title === 'lib/main.dart').code,
  blocks[3].code,
);
eq(
  'the defining file is untouched',
  fixed.find((b) => b.title === 'lib/models/question.dart').code,
  blocks[1].code,
);
eq('pubspec is untouched', fixed[0].code, blocks[0].code);

// package: style import counts as already imported
const pk = fixMissingImports([
  { title: 'lib/models/q.dart', code: 'class Q {}\n' },
  {
    title: 'lib/a.dart',
    code: "import 'package:app/models/q.dart';\nvoid f() { Q(); }\n",
  },
]);
eq('package: import is recognised', pk[1].addedImports, undefined);

// words in strings and comments do not trigger an import
const str = fixMissingImports([
  { title: 'lib/models/q.dart', code: 'class Question {}\n' },
  {
    title: 'lib/a.dart',
    code: "// Question here\nvoid f() { print('Question 1'); }\n",
  },
]);
eq('strings and comments do not count', str[1].addedImports, undefined);

// no imports at all: inserted after leading comments
const none = fixMissingImports([
  { title: 'lib/models/q.dart', code: 'class Q {}\n' },
  { title: 'lib/a.dart', code: '// lib/a.dart\nvoid f() { Q(); }\n' },
]);
eq(
  'no import lines: added after the header comment',
  none[1].code,
  "// lib/a.dart\nimport 'models/q.dart';\nvoid f() { Q(); }\n",
);
process.exit(bad ? 1 : 0);
