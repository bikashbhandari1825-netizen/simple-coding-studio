// Unit test: Dart import typo detection and suggestions (no AI involved).
// node tests/unit/import-typos.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { findImportTypos, suggestImport } = await import(
  pathToFileURL(path.resolve('src/renderer/lib/importTypos.ts')).href
);
let bad = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `got ${got} want ${want}`);
  if (!ok) bad++;
};
eq(
  'scheme + file typo',
  suggestImport('packages:flutter/matterial.dart'),
  'package:flutter/material.dart',
);
eq(
  'file typo only',
  suggestImport('package:flutter/matterial.dart'),
  'package:flutter/material.dart',
);
eq(
  'scheme typo only',
  suggestImport('pakage:flutter/material.dart'),
  'package:flutter/material.dart',
);
eq(
  'widgets typo',
  suggestImport('package:flutter/widgts.dart'),
  'package:flutter/widgets.dart',
);
eq('dart: typo', suggestImport('dart:asyncc'), 'dart:async');
eq(
  'correct import is left alone',
  suggestImport('package:flutter/material.dart'),
  null,
);
eq('correct dart: is left alone', suggestImport('dart:io'), null);
eq(
  'unknown real package is left alone',
  suggestImport('package:my_app/main.dart'),
  null,
);
eq('relative path is left alone', suggestImport('../models/user.dart'), null);
eq(
  'very different name is not guessed',
  suggestImport('package:flutter/xyz_unrelated.dart'),
  null,
);
const t = findImportTypos(
  "import 'packages:flutter/matterial.dart';\nimport 'package:flutter/material.dart';\nvoid main() {}\n",
);
eq('finds exactly one typo', t.length, 1);
eq('typo is on line 1', t[0]?.line, 1);
eq(
  'range covers the URI inside the quotes',
  t[0] && `${t[0].startColumn}-${t[0].endColumn}`,
  '9-40',
);
process.exit(bad ? 1 : 0);
