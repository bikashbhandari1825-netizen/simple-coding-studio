import fs from 'node:fs/promises';
import path from 'node:path';

// 🛠️ Run अघि आफैं मिलाउने (Auto Path & Package Resolver):
//  - Dart project को सही entry फाइल खोज्ने (bin/<name>.dart नभए पनि)
//  - Flutter कोड भए pubspec मा flutter SDK छ कि छैन मिलाउने
//  - import गरिएका तर pubspec मा नभएका package आफैं थप्ने
//  - Chrome मा चलाउन web/ नभए web support थप्ने
//  - प्याकेज पुराना भए pub get
// Before Run: find the right Dart entry file, make sure a Flutter project's pubspec has the Flutter SDK,
// add packages that the code imports but pubspec lacks, add web support for Chrome, and run pub get.

/** Flutter SDK सँगै आउने package (pub.dev बाट थप्नु पर्दैन) — packages that ship with the Flutter SDK */
const SDK_PACKAGES = new Set([
  'flutter',
  'flutter_test',
  'flutter_driver',
  'flutter_localizations',
  'flutter_web_plugins',
  'integration_test',
  'sky_engine',
]);
const SKIP_DIRS = new Set([
  '.dart_tool',
  'build',
  '.git',
  'node_modules',
  '.idea',
  '.vscode',
  'ios',
  'android',
  'windows',
  'linux',
  'macos',
  'web',
]);

const exists = (p: string) =>
  fs
    .stat(p)
    .then(() => true)
    .catch(() => false);

export async function readPubspec(root: string): Promise<string> {
  return fs.readFile(path.join(root, 'pubspec.yaml'), 'utf8').catch(() => '');
}

export function pubspecName(spec: string): string | null {
  return spec.match(/^name\s*:\s*['"]?([a-z0-9_]+)/m)?.[1] ?? null;
}

/** dependencies / dev_dependencies मा भएका नामहरू — package names declared in pubspec. */
export function declaredPackages(spec: string): Set<string> {
  const names = new Set<string>();
  let inDeps = false;
  for (const line of spec.replace(/\r/g, '').split('\n')) {
    if (/^\S/.test(line)) {
      inDeps = /^(dependencies|dev_dependencies|dependency_overrides)\s*:/.test(
        line,
      );
      continue;
    }
    const m = inDeps ? line.match(/^ {2}([a-z0-9_]+)\s*:/) : null;
    if (m) names.add(m[1]);
  }
  return names;
}

/** lib/, bin/, test/ का .dart फाइलले import गरेका package — packages imported by the project's Dart code. */
export async function importedPackages(root: string): Promise<Set<string>> {
  const found = new Set<string>();
  let files = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8 || files > 1500) return;
    const entries = await fs
      .readdir(dir, { withFileTypes: true })
      .catch(() => []);
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
          await walk(path.join(dir, e.name), depth + 1);
      } else if (e.name.endsWith('.dart') && files++ <= 1500) {
        const text = await fs
          .readFile(path.join(dir, e.name), 'utf8')
          .catch(() => '');
        for (const m of text.matchAll(
          /^\s*(?:import|export)\s+['"]package:([a-z0-9_]+)\//gm,
        ))
          found.add(m[1]);
      }
    }
  };
  for (const sub of ['lib', 'bin', 'test']) {
    const d = path.join(root, sub);
    if (await exists(d)) await walk(d, 0);
  }
  return found;
}

/** Flutter कोड हो? (pubspec मा नभए पनि lib/main.dart ले flutter import गर्छ) — is this really Flutter code? */
export async function looksLikeFlutter(
  root: string,
  spec: string,
): Promise<boolean> {
  if (/^\s*flutter\s*:/m.test(spec)) return true;
  const main = await fs
    .readFile(path.join(root, 'lib', 'main.dart'), 'utf8')
    .catch(() => '');
  return /['"]package:flutter\//.test(main);
}

/** Dart project चलाउने सही फाइल — the right entry file for `dart run`. */
export async function dartEntry(
  root: string,
  currentFile: string | null,
): Promise<string | null> {
  const spec = await readPubspec(root);
  const name = pubspecName(spec);
  const hasMain = async (rel: string) => {
    const text = await fs
      .readFile(path.join(root, rel), 'utf8')
      .catch(() => null);
    return text !== null && /\bmain\s*\(/.test(text);
  };
  const candidates = [name ? `bin/${name}.dart` : '', 'bin/main.dart'].filter(
    Boolean,
  );
  const bin = await fs
    .readdir(path.join(root, 'bin'))
    .catch(() => [] as string[]);
  candidates.push(
    ...bin.filter((f) => f.endsWith('.dart')).map((f) => `bin/${f}`),
  );
  if (currentFile?.endsWith('.dart')) {
    const rel = path.relative(root, currentFile).replace(/\\/g, '/');
    if (!rel.startsWith('..')) candidates.push(rel);
  }
  candidates.push('lib/main.dart');
  for (const c of candidates) if (await hasMain(c)) return c;
  return null;
}

/** pubspec मा flutter SDK dependency थप्ने (फाइल नै सच्याउने) — add the Flutter SDK dependency to pubspec. */
async function addFlutterSdk(root: string, spec: string): Promise<void> {
  const eol = spec.includes('\r\n') ? '\r\n' : '\n';
  const block = `  flutter:${eol}    sdk: flutter${eol}`;
  let next: string;
  if (/^dependencies\s*:\s*$/m.test(spec))
    next = spec.replace(/^(dependencies\s*:\s*)(\r?\n)/m, `$1$2${block}`);
  else
    next = `${spec.replace(/\s*$/, '')}${eol}${eol}dependencies:${eol}${block}`;
  if (!/^flutter\s*:/m.test(next))
    next = `${next.replace(/\s*$/, '')}${eol}${eol}flutter:${eol}  uses-material-design: true${eol}`;
  await fs.writeFile(path.join(root, 'pubspec.yaml'), next, 'utf8');
}

/**
 * 🤖 android/app/build.gradle(.kts) मा resValues चालू गर्ने (पुरानो फाइलको backup सहित)
 * Turn on resValues in android/app/build.gradle(.kts) (keeps a backup of the old file).
 */
export async function enableResValues(
  root: string,
): Promise<'patched' | 'already' | 'nofile'> {
  for (const name of ['build.gradle', 'build.gradle.kts']) {
    const file = path.join(root, 'android', 'app', name);
    const text = await fs.readFile(file, 'utf8').catch(() => null);
    if (text === null) continue;
    if (/resValues\s*(=|\s)\s*true/.test(text)) return 'already';
    const kts = name.endsWith('.kts');
    const flag = kts ? 'resValues = true' : 'resValues true';
    let next: string;
    if (/^[ \t]*buildFeatures\s*\{/m.test(text)) {
      next = text.replace(
        /^([ \t]*)buildFeatures\s*\{/m,
        (m, ind: string) => `${m}\n${ind}    ${flag}`,
      );
    } else {
      const m = /^([ \t]*)android\s*\{[^\n]*\n/m.exec(text);
      if (!m) return 'nofile';
      const at = (m.index ?? 0) + m[0].length;
      next =
        text.slice(0, at) +
        `${m[1]}    buildFeatures {\n${m[1]}        ${flag}\n${m[1]}    }\n\n` +
        text.slice(at);
    }
    await fs
      .writeFile(file + '.scs-backup', text, { flag: 'wx' })
      .catch(() => undefined);
    await fs.writeFile(file, next, 'utf8');
    return 'patched';
  }
  return 'nofile';
}

export interface RunPrep {
  /** पहिले चलाउने कमाण्डहरू — commands to run before the real one */
  steps: string[];
  /** console मा देखाउने सूचना — notes shown in the console */
  notes: string[];
}

export async function prepareRun(
  root: string,
  tool: 'flutter' | 'dart',
  presetId: string,
  stale: boolean,
): Promise<RunPrep> {
  const steps: string[] = [];
  const notes: string[] = [];
  let spec = await readPubspec(root);
  if (!spec) return { steps, notes };

  // १. Flutter कोड तर pubspec मा flutter छैन — Flutter code, but pubspec lacks the Flutter SDK
  if (
    tool === 'flutter' &&
    !/^ {2}flutter\s*:\s*\r?\n\s+sdk\s*:\s*flutter/m.test(spec)
  ) {
    await addFlutterSdk(root, spec);
    spec = await readPubspec(root);
    notes.push(
      '🛠️ pubspec.yaml मा Flutter SDK थपेँ · Added the Flutter SDK to pubspec.yaml',
    );
  }

  // २. Chrome मा चलाउन web/ चाहिन्छ — running in Chrome needs web support
  if (
    (presetId === 'flutter-web' || presetId === 'flutter-build-web') &&
    !(await exists(path.join(root, 'web', 'index.html')))
  ) {
    steps.push('flutter create --platforms=web .');
    notes.push(
      '🌐 यो project मा web support थिएन, थप्दैछु · Adding web support to this project',
    );
  }

  // ३. import गरिएका तर pubspec मा नभएका package — imported but not declared
  const own = pubspecName(spec);
  const declared = declaredPackages(spec);
  const missing = [...(await importedPackages(root))].filter(
    (p) => p !== own && !declared.has(p) && !SDK_PACKAGES.has(p),
  );
  // धेरै package एकैपटक छुटेको देखिए pubspec नै बिग्रिएको हुनसक्छ: आफैं नथप्ने
  // Many missing at once usually means pubspec itself is damaged: do not bulk-add, warn instead
  if (missing.length > 8) {
    notes.push(
      `⚠️ कोडले ${missing.length} वटा package प्रयोग गर्छ तर pubspec.yaml मा छैनन् — pubspec.yaml बिग्रिएको/पुरानो हुनसक्छ। आफैं थपिनँ; pubspec जाँच्नुहोस् (git/OneDrive को पुरानो version)। · ${missing.length} imported packages are missing from pubspec.yaml — it may be damaged; not adding them automatically.`,
    );
    steps.push(`${tool} pub get`);
  } else if (missing.length) {
    steps.push(`${tool} pub add ${missing.slice(0, 20).join(' ')}`);
    notes.push(
      `📦 कोडले प्रयोग गरेका तर pubspec मा नभएका package थप्दैछु: ${missing.join(', ')} · Adding packages the code imports: ${missing.join(', ')}`,
    );
  } else if (stale || steps.length || notes.length) {
    steps.push(`${tool} pub get`);
    notes.push('📦 प्याकेजहरू ल्याउँदैछु (pub get) · Fetching packages (pub get)');
  }
  return { steps, notes };
}
