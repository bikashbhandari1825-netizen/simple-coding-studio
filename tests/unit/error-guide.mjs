// Unit test: the Error Guide finds the reason and builds the right steps.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { buildGuide, parseError, currentStepIndex, resolveRelative } =
  await import(
    pathToFileURL(path.resolve('src/renderer/lib/errorGuide.ts')).href
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
const root = 'C:\\proj';
const base = {
  rootPath: root,
  filePath: 'C:\\proj\\lib\\services\\database_service.dart',
  projectName: 'my_app',
  activePath: 'C:\\proj\\lib\\services\\database_service.dart',
  selectedDir: root,
  newFileOpen: false,
  fileText: () => undefined,
  exists: () => false,
  knownClasses: ['WorkEntry', 'HomeScreen'],
};

eq(
  'parse package',
  parseError("Target of URI doesn't exist: 'package:sqflite/sqflite.dart'."),
  { kind: 'package', pkg: 'sqflite' },
);
eq(
  'parse relative import',
  parseError("Target of URI doesn't exist: '../models/work_entry.dart'."),
  { kind: 'import', uri: '../models/work_entry.dart' },
);
eq('parse class', parseError("Undefined class 'Workentry'."), {
  kind: 'class',
  name: 'Workentry',
});
eq('typo hints are left to the quick fix', parseError('Did you mean x?'), null);
eq(
  'resolve ../',
  resolveRelative('C:/proj/lib/services', '../models/a.dart'),
  'C:/proj/lib/models/a.dart',
);

// 📦 missing package
const pkg = buildGuide(
  { message: "Target of URI doesn't exist: 'package:sqflite/sqflite.dart'." },
  base,
);
eq('package guide file', pkg.file, 'pubspec.yaml');
eq('package: English first', /^The package/.test(pkg.en), true);
eq(
  'package: 3 steps',
  pkg.steps.map((s) => s.id),
  ['open-pubspec', 'add-package', 'get-packages'],
);
eq('package: first step current', currentStepIndex(pkg), 0);
const pkg2 = buildGuide(
  { message: "Target of URI doesn't exist: 'package:sqflite/sqflite.dart'." },
  {
    ...base,
    activePath: 'C:\\proj\\pubspec.yaml',
    fileText: (p) =>
      p.endsWith('pubspec.yaml')
        ? 'dependencies:\n  flutter:\n    sdk: flutter\n  sqflite: ^2.0.0\n'
        : undefined,
  },
);
eq(
  'package: steps 1+2 done once added',
  pkg2.steps.map((s) => s.done),
  [true, true, false],
);
eq('package: now at the Get packages step', currentStepIndex(pkg2), 2);
eq(
  'flutter package is never missing',
  buildGuide(
    {
      message: "Target of URI doesn't exist: 'package:flutter/material.dart'.",
    },
    base,
  ),
  null,
);

// 📄 missing file
const imp = buildGuide(
  { message: "Target of URI doesn't exist: '../models/work_entry.dart'." },
  base,
);
eq('import guide file', imp.file, 'lib/models/work_entry.dart');
eq(
  'import: no folder known yet, so only new-file and write-code',
  imp.steps.map((s) => s.id),
  ['new-file', 'type-name', 'write-code'],
);
eq(
  'import: typed path includes the missing folders',
  imp.steps[1].en.includes('lib/models/work_entry.dart'),
  true,
);
const dirs = ['C:/proj/lib', 'C:/proj/lib/models'];
const imp3 = buildGuide(
  { message: "Target of URI doesn't exist: '../models/work_entry.dart'." },
  { ...base, exists: (p) => dirs.includes(p) },
);
eq(
  'import: one arrow step per existing folder, then new file, then write',
  imp3.steps.map((s) => s.id),
  ['folder:lib', 'folder:lib/models', 'new-file', 'type-name', 'write-code'],
);
eq('import: folder step points at the tree row', imp3.steps[1].target, {
  kind: 'tree',
  path: 'C:/proj/lib/models',
});
eq(
  'import: type only the file name once inside the folder',
  imp3.steps[3].en.includes('lib/models/work_entry.dart'),
  true,
);
eq(
  'import: nothing done yet',
  imp3.steps.map((s) => s.done),
  [false, false, false, false, false],
);
const imp4 = buildGuide(
  { message: "Target of URI doesn't exist: '../models/work_entry.dart'." },
  {
    ...base,
    exists: (p) => dirs.includes(p),
    selectedDir: 'C:\\proj\\lib\\models',
  },
);
eq(
  'import: choosing the folder marks the folder steps OK',
  imp4.steps.map((s) => s.done),
  [true, true, false, false, false],
);
const imp2 = buildGuide(
  { message: "Target of URI doesn't exist: '../models/work_entry.dart'." },
  {
    ...base,
    exists: (p) =>
      p === 'C:/proj/lib/models/work_entry.dart' || dirs.includes(p),
    fileText: () => 'class WorkEntry {}',
  },
);
eq(
  'import: all done after creating and writing',
  imp2.steps.every((s) => s.done),
  true,
);
const own = buildGuide(
  {
    message:
      "Target of URI doesn't exist: 'package:my_app/screens/home_screen.dart'.",
  },
  base,
);
eq(
  'own package import means a missing file',
  own.file,
  'lib/screens/home_screen.dart',
);

// 🔤 class
const cls = buildGuide(
  { message: "Undefined class 'Workentry'.", line: 7 },
  base,
);
eq(
  'class: case mismatch finds the right name',
  /"WorkEntry"/.test(cls.en),
  true,
);
const cls2 = buildGuide({ message: "Undefined class 'Brand'.", line: 3 }, base);
eq('class: unknown class suggests a file', cls2.file, 'lib/brand.dart');
eq(
  'no guide for other errors',
  buildGuide({ message: "Expected ';'" }, base),
  null,
);
process.exit(bad ? 1 : 0);
