// Unit test: the one-click Android resValues fix edits android/app/build.gradle(.kts) safely (scratch files only).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { enableResValues } = await import(
  pathToFileURL(path.resolve('src/main-process/runPrep.ts')).href
);
const { analyzeOutput } = await import(
  pathToFileURL(path.resolve('src/renderer/lib/errorAnalyzer.ts')).href
).catch(() => ({}));
let bad = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `got ${got} want ${want}`);
  if (!ok) bad++;
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scs-resvalues-'));
const mk = (name, text) => {
  const root = path.join(tmp, name);
  fs.mkdirSync(path.join(root, 'android', 'app'), { recursive: true });
  return {
    root,
    file: (f) => path.join(root, 'android', 'app', f),
    text,
    write: (f) => fs.writeFileSync(path.join(root, 'android', 'app', f), text),
  };
};

// Groovy, like the user's project
const g = mk('groovy', '');
fs.writeFileSync(
  g.file('build.gradle'),
  'plugins {\n  id "com.android.application"\n}\n\nandroid {\n    namespace "x.y"\n    defaultConfig {\n        resValue "string", "t", "v"\n    }\n}\n',
);
eq('groovy: patched', await enableResValues(g.root), 'patched');
const gText = fs.readFileSync(g.file('build.gradle'), 'utf8');
eq(
  'groovy: buildFeatures added inside android',
  /android \{\n    buildFeatures \{\n        resValues true\n    \}/.test(
    gText,
  ),
  true,
);
eq(
  'groovy: backup written',
  fs.existsSync(g.file('build.gradle.scs-backup')),
  true,
);
eq('groovy: second time is a no-op', await enableResValues(g.root), 'already');

// Kotlin DSL
const k = mk('kts', '');
fs.writeFileSync(
  k.file('build.gradle.kts'),
  'android {\n    namespace = "x.y"\n}\n',
);
eq('kts: patched', await enableResValues(k.root), 'patched');
eq(
  'kts: uses = true',
  /resValues = true/.test(fs.readFileSync(k.file('build.gradle.kts'), 'utf8')),
  true,
);

// existing buildFeatures block
const b = mk('bf', '');
fs.writeFileSync(
  b.file('build.gradle'),
  'android {\n    buildFeatures {\n        buildConfig true\n    }\n}\n',
);
eq('existing block: patched', await enableResValues(b.root), 'patched');
const bText = fs.readFileSync(b.file('build.gradle'), 'utf8');
eq(
  'existing block: only one buildFeatures',
  (bText.match(/buildFeatures/g) || []).length,
  1,
);
eq(
  'existing block: resValues inside it',
  /buildFeatures \{\n        resValues true\n        buildConfig true/.test(
    bText,
  ),
  true,
);

// no file
const n = mk('none', '');
eq('no gradle file', await enableResValues(n.root), 'nofile');

// The Output panel recognises the Gradle error and offers the one-click fix
const gradleError =
  'FAILURE: Build failed with an exception.\n* What went wrong:\nA problem occurred configuring project :app.\n> com.android.builder.errors.EvalIssueException: defaultConfig contains custom resource values, but the feature is disabled.\n';
const tips = analyzeOutput ? analyzeOutput(gradleError) : [];
const tip = tips.find((t) => t.id === 'android-resvalues');
eq('Output error card is shown', Boolean(tip), true);
eq('it offers the resValues fix', tip?.fix?.action, 'androidResValues');

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
