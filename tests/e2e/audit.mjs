// 🔍 Run बटन अडिट: प्याकेज गरिएको एपको आफ्नै Run API ले वास्तविक scratch project हरू चलाउँछ।
// Run-button audit: drives the packaged app's own run API on real scratch projects (Python, JS, Dart, Flutter).
//   node tests/e2e/audit.mjs [--flutter] [--apk] [--windows]
// scratch प्रोजेक्ट TEMP मा मात्र बन्छन्, तपाईंका project छोइँदैन — scratch projects live in TEMP only.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchApp } from './driver.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const exe = path.join(
  process.env.FORGE_OUT_DIR || path.join(projectRoot, 'out'),
  'Simple Coding Studio-win32-x64',
  'SimpleCodingStudio.exe',
);
const flags = new Set(process.argv.slice(2).map((a) => a.replace(/^--/, '')));
const FLUTTER = 'C:\\flutter\\bin\\flutter.bat';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'scs-audit-'));
const w = (root, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};

// ---- scratch projects
const py = path.join(base, 'py_proj');
w(py, 'main.py', 'print("PY-OK", 2 + 3)\n');
w(py, 'bad.py', 'print("before")\nraise ValueError("boom")\n');
const js = path.join(base, 'js_proj');
w(
  js,
  'package.json',
  JSON.stringify({ name: 'js_proj', scripts: { start: 'node index.js' } }),
);
w(js, 'index.js', 'console.log("JS-OK", 6 * 7);\n');
const dart = path.join(base, 'dart_proj');
w(dart, 'pubspec.yaml', 'name: dart_proj\nenvironment:\n  sdk: ^3.0.0\n');
w(dart, 'bin/dart_proj.dart', "void main() { print('DART-OK ${1 + 1}'); }\n");

let flutterApp = null;
if (flags.has('flutter')) {
  flutterApp = path.join(base, 'audit_app');
  console.log('creating a Flutter app (flutter create)...');
  execFileSync(
    FLUTTER,
    [
      'create',
      '--platforms=web,windows,android',
      '--no-pub',
      '-t',
      'app',
      'audit_app',
    ],
    {
      cwd: base,
      shell: true,
      stdio: 'ignore',
    },
  );
  // हाम्रो "पूरा starter" का फाइल राख्ने — apply our "Complete starter" files
  const mod = await import(
    pathToFileURL(
      path.resolve(projectRoot, 'src/main-process/flutterTemplateComplete.ts'),
    ).href
  );
  fs.rmSync(path.join(flutterApp, 'test'), { recursive: true, force: true });
  for (const [rel, content] of Object.entries(mod.completeFiles('Audit App')))
    w(flutterApp, rel, content);
  execFileSync(FLUTTER, ['pub', 'add', 'shared_preferences', 'intl'], {
    cwd: flutterApp,
    shell: true,
    stdio: 'ignore',
  });
}

// ---- launch the packaged app
const port = 9341;
const profile = path.join(base, 'profile');
const { child, page } = await launchApp({ exe, port, userDataDir: profile });
const results = [];
// एप तयार हुन पर्खने — wait until the app's API is ready
for (let i = 0; i < 60; i++) {
  const ready = await page
    .eval('Boolean(window.studio && window.studio.openRecentFolder)')
    .catch(() => false);
  if (ready) break;
  await new Promise((r) => setTimeout(r, 500));
}

/** एउटा Run बटनको काम चलाएर नतिजा बटुल्ने — run one preset and collect what it printed */
async function run(label, root, presetId, file, opts = {}) {
  const { timeout = 180000, readyWhen = null, expect = null } = opts;
  const r = await page.eval(
    `(async () => {
      const proj = await window.studio.openRecentFolder(${JSON.stringify(root)});
      if (!proj) return { error: 'cannot open project' };
      const presets = await window.studio.getRunPresets(${JSON.stringify(root)}, ${JSON.stringify(file)});
      const has = presets.some((p) => p.id === ${JSON.stringify(presetId)});
      if (!has) return { error: 'preset missing: ' + ${JSON.stringify(presetId)} + ' in ' + presets.map((p) => p.id).join(',') };
      let out = '';
      let exit = null;
      let runId = null;
      let ready = false;
      const re = ${readyWhen ? 'new RegExp(' + JSON.stringify(readyWhen) + ')' : 'null'};
      const off = window.studio.onRunEvent((e) => {
        if (runId !== null && e.runId !== runId) return;
        if (e.type === 'output') out += e.data;
        if (e.type === 'exit') exit = { code: e.code, stopped: e.stoppedByUser };
      });
      runId = await window.studio.run(${JSON.stringify(root)}, ${JSON.stringify(presetId)}, ${JSON.stringify(file)});
      const t0 = performance.now();
      while (exit === null && performance.now() - t0 < ${timeout}) {
        if (re && re.test(out)) { ready = true; break; }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (ready) { await window.studio.stopRun(); await new Promise((r) => setTimeout(r, 1500)); }
      off();
      return { out: out.slice(-1800), exit, ready, ms: Math.round(performance.now() - t0), timedOut: exit === null && !ready };
    })()`,
    timeout + 60000,
  );
  let ok = false;
  let why = '';
  if (r.error) why = r.error;
  else if (r.timedOut) why = 'timed out after ' + Math.round(r.ms / 1000) + 's';
  else if (readyWhen) {
    ok = r.ready;
    why = ok
      ? 'started (' + Math.round(r.ms / 1000) + 's)'
      : 'exit ' + JSON.stringify(r.exit);
  } else {
    ok =
      (expect ? new RegExp(expect).test(r.out) : true) &&
      (opts.allowFail ? true : r.exit?.code === 0);
    why =
      'exit ' +
      r.exit?.code +
      (expect
        ? new RegExp(expect).test(r.out)
          ? ', output ok'
          : ', expected output missing'
        : '');
  }
  results.push({
    label,
    ok,
    why,
    tail: (r.out ?? '')
      .split('\n')
      .filter(Boolean)
      .slice(-4)
      .join(' | ')
      .slice(0, 300),
  });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  — ' + why);
  if (!ok && r.out)
    console.log(
      '      ' + r.out.split('\n').filter(Boolean).slice(-3).join('\n      '),
    );
}

const only = process.argv.find((x) => x.startsWith('--project='));
try {
  if (only) {
    // एउटा आफ्नै project मा APK/Chrome जाँच्ने — check APK / Chrome on one given project
    const dir = only.slice('--project='.length);
    if (flags.has('apk'))
      await run(
        'Project APK: ' + path.basename(dir),
        dir,
        'flutter-apk',
        null,
        { timeout: 900000, expect: 'Built build|app-release' },
      );
    if (flags.has('chrome'))
      await run(
        'Project Chrome: ' + path.basename(dir),
        dir,
        'flutter-web',
        null,
        {
          timeout: 600000,
          readyWhen:
            'Flutter run key commands|is being served|Debug service listening|To hot reload',
        },
      );
  } else {
    await run(
      'Python: run this file',
      py,
      'run-file',
      path.join(py, 'main.py'),
      {
        expect: 'PY-OK 5',
      },
    );
    await run(
      'Python: error shows and exits non-zero',
      py,
      'run-file',
      path.join(py, 'bad.py'),
      {
        expect: 'ValueError',
        allowFail: true,
      },
    );
    await run(
      'JavaScript: run this file (node)',
      js,
      'run-file',
      path.join(js, 'index.js'),
      { expect: 'JS-OK 42' },
    );
    await run('Node project: npm start', js, 'npm-start', null, {
      expect: 'JS-OK 42',
    });
    await run('Dart: run project', dart, 'dart-run', null, {
      expect: 'DART-OK 2',
    });
    await run('Dart: get packages', dart, 'dart-pub-get', null, {
      expect: 'Got dependencies|Resolving',
    });
    if (flutterApp) {
      await run(
        'Flutter: Check Flutter setup (doctor)',
        flutterApp,
        'flutter-doctor',
        null,
        { allowFail: true, expect: 'Doctor summary|Flutter' },
      );
      await run('Flutter: Get packages', flutterApp, 'flutter-pub-get', null, {
        expect: 'Got dependencies|Resolving|Changed',
      });
      await run('Flutter: Run in Chrome', flutterApp, 'flutter-web', null, {
        timeout: 400000,
        readyWhen:
          'Flutter run key commands|is being served|Debug service listening|To hot reload',
      });
      await run(
        'Flutter: Build for web',
        flutterApp,
        'flutter-build-web',
        null,
        {
          timeout: 400000,
          expect: 'Built build|Compiling',
        },
      );
      if (flags.has('apk'))
        await run(
          'Flutter: Build APK (Android)',
          flutterApp,
          'flutter-apk',
          null,
          { timeout: 900000, expect: 'Built build|app-release' },
        );
      if (flags.has('windows'))
        await run(
          'Flutter: Run as Windows app',
          flutterApp,
          'flutter-windows',
          null,
          {
            timeout: 600000,
            readyWhen: 'Flutter run key commands|To hot reload',
          },
        );
    }
  }
} finally {
  try {
    child.kill();
  } catch {
    /* already closed */
  }
}
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(
  path.join(os.tmpdir(), 'scs-audit-report.json'),
  JSON.stringify(results, null, 1),
);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
