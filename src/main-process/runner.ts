import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type WebContents,
} from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  FlutterTemplateId,
  ProjectInfo,
  RunEvent,
  RunPreset,
} from '../shared/types';
import { templateSpec, writeTemplateFiles } from './flutterTemplates';
import { sanitizeProjectName } from '../shared/projectName';
import {
  assertInsideProject,
  detectProjectKind,
  registerProject,
} from './fileSystem';
import { dartEntry, enableResValues, prepareRun } from './runPrep';

// UI ले कमाण्ड पठाउँदैन, preset को id मात्र पठाउँछ। कमाण्ड यहीँ बन्छ, त्यसैले UI बाट जुनसुकै कमाण्ड चलाउन मिल्दैन।
// The UI sends only a preset id; the command is built here, so the UI can never run arbitrary commands.

interface ResolvedPreset extends RunPreset {
  command: string;
  args: string[];
  /** Process चलाउनुको सट्टा फाइल खोल्ने — Open a file instead of running a process. */
  openPath?: string;
}

let current: { child: ChildProcess; runId: number; stopped: boolean } | null =
  null;
let nextRunId = 1;

const quote = (arg: string) =>
  /[\s&()^%!"]/.test(arg) ? `"${arg.replace(/"/g, '')}"` : arg;

function preset(
  id: string,
  labelNe: string,
  labelEn: string,
  command: string,
  args: string[],
  interactive = false,
): ResolvedPreset {
  return {
    id,
    labelNe,
    labelEn,
    command,
    args,
    interactive,
    commandLine: [command, ...args.map(quote)].join(' '),
  };
}

// यी चलाउनुअघि प्याकेज चाहिन्छ — these need the project's packages first
const NEEDS_PACKAGES: Record<string, 'flutter' | 'dart'> = {
  'flutter-web': 'flutter',
  'flutter-windows': 'flutter',
  'flutter-apk': 'flutter',
  'flutter-build-web': 'flutter',
  'dart-run': 'dart',
};

/**
 * 📦 प्याकेज छुटेका वा पुराना छन्? (.dart_tool/package_config.json नभए, वा pubspec त्यसपछि बदलिए)
 * Are the packages missing or out of date? (no package_config.json, or pubspec changed after it)
 */
async function pathExists(p: string): Promise<boolean> {
  return fs.stat(p).then(
    () => true,
    () => false,
  );
}

async function packagesStale(root: string): Promise<boolean> {
  try {
    const cfg = (
      await fs.stat(path.join(root, '.dart_tool', 'package_config.json'))
    ).mtimeMs;
    for (const name of ['pubspec.yaml', 'pubspec.lock']) {
      const st = await fs.stat(path.join(root, name)).catch(() => null);
      if (st && st.mtimeMs > cfg + 1000) return true;
    }
    return false;
  } catch {
    return true;
  }
}

async function resolvePresets(
  rootPath: string,
  currentFile: string | null,
): Promise<ResolvedPreset[]> {
  const root = assertInsideProject(rootPath);
  const file = currentFile ? assertInsideProject(currentFile) : null;
  const kind = await detectProjectKind(root);
  const list: ResolvedPreset[] = [];

  if (kind === 'flutter') {
    list.push(
      preset(
        'flutter-web',
        'Chrome मा चलाऊ',
        'Run in Chrome',
        'flutter',
        ['run', '-d', 'chrome'],
        true,
      ),
      preset(
        'flutter-windows',
        'Windows एपको रूपमा चलाऊ',
        'Run as Windows app',
        'flutter',
        ['run', '-d', 'windows'],
        true,
      ),
      preset('flutter-pub-get', 'प्याकेजहरू ल्याऊ', 'Get packages', 'flutter', [
        'pub',
        'get',
      ]),
      preset(
        'flutter-apk',
        'APK बनाऊ (मोबाइल)',
        'Build APK (Android)',
        'flutter',
        ['build', 'apk'],
      ),
      preset(
        'flutter-build-web',
        'Web संस्करण बनाऊ',
        'Build for web',
        'flutter',
        ['build', 'web'],
      ),
      preset(
        'flutter-doctor',
        'Flutter जाँच (doctor)',
        'Check Flutter setup',
        'flutter',
        ['doctor'],
      ),
    );
  } else if (kind === 'dart') {
    list.push(
      // सही entry फाइल आफैं खोज्ने (bin/<name>.dart नभए पनि) — find the real entry file
      preset('dart-run', 'Dart project चलाऊ', 'Run Dart project', 'dart', [
        'run',
        ...(await dartEntry(root, file).then((e) => (e ? [e] : []))),
      ]),
      preset('dart-pub-get', 'प्याकेजहरू ल्याऊ', 'Get packages', 'dart', [
        'pub',
        'get',
      ]),
    );
  } else if (kind === 'node') {
    const pkg = JSON.parse(
      await fs
        .readFile(path.join(root, 'package.json'), 'utf8')
        .catch(() => '{}'),
    ) as {
      scripts?: Record<string, string>;
    };
    list.push(
      preset('npm-install', 'प्याकेजहरू ल्याऊ', 'Install packages', 'npm', [
        'install',
      ]),
    );
    if (pkg.scripts?.dev)
      list.push(
        preset('npm-dev', 'Dev server चलाऊ', 'Run dev server', 'npm', [
          'run',
          'dev',
        ]),
      );
    if (pkg.scripts?.start)
      list.push(preset('npm-start', 'एप चलाऊ', 'Start app', 'npm', ['start']));
  } else if (kind === 'web') {
    const index = path.join(root, 'index.html');
    list.push({
      ...preset('web-open', 'Browser मा खोल', 'Open in browser', 'open', [
        index,
      ]),
      openPath: index,
    });
  }

  // अहिले खुलेको फाइल सिधै चलाउने — Run the open file directly.
  if (file) {
    const ext = path.extname(file).toLowerCase();
    const runners: Record<string, [string, string[]]> = {
      '.dart': ['dart', ['run', file]],
      '.py': ['python', [file]],
      '.js': ['node', [file]],
      '.mjs': ['node', [file]],
    };
    const runner = runners[ext];
    if (runner && kind !== 'flutter') {
      list.push(
        preset(
          'run-file',
          `यो फाइल चलाऊ (${path.basename(file)})`,
          'Run this file',
          runner[0],
          runner[1],
        ),
      );
    }
    if (ext === '.html') {
      list.push({
        ...preset('open-file', 'Browser मा खोल', 'Open in browser', 'open', [
          file,
        ]),
        openPath: file,
      });
    }
  }
  return list;
}

function send(target: WebContents, event: RunEvent) {
  if (!target.isDestroyed()) target.send('run:event', event);
}

function killTree(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // Windows मा child.kill() ले flutter का भित्री process मार्दैन — kill the whole tree.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
    });
  } else {
    child.kill('SIGTERM');
  }
}

function startProcess(
  target: WebContents,
  cwd: string,
  p: ResolvedPreset,
  /** अघि चलाउने कमाण्ड, जस्तै "flutter pub get && " — a command to run first */
  prefix = '',
  /** console मा पहिले देखाउने सूचना — notes shown first */
  notes: string[] = [],
): { runId: number; done: Promise<number | null> } {
  if (current) {
    current.stopped = true;
    killTree(current.child);
  }
  const runId = nextRunId++;
  send(target, { runId, type: 'start', commandLine: prefix + p.commandLine });
  if (notes.length)
    send(target, {
      runId,
      type: 'output',
      stream: 'stdout',
      data: notes.join('\n') + '\n',
    });

  // .bat/.cmd (flutter, npm) चलाउन Windows मा shell चाहिन्छ। Args हामीले नै बनाएका र quote गरिएका हुन्।
  // Windows needs a shell for .bat/.cmd tools; every arg here is ours and quoted.
  const child = spawn(prefix + [p.command, ...p.args.map(quote)].join(' '), {
    cwd,
    shell: true,
    windowsHide: true,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  const entry = { child, runId, stopped: false };
  current = entry;

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (data: string) =>
    send(target, { runId, type: 'output', stream: 'stdout', data }),
  );
  child.stderr?.on('data', (data: string) =>
    send(target, { runId, type: 'output', stream: 'stderr', data }),
  );

  const done = new Promise<number | null>((resolve) => {
    child.on('error', (err) => {
      send(target, {
        runId,
        type: 'output',
        stream: 'stderr',
        data: `${err.message}\n`,
      });
    });
    child.on('close', (code) => {
      if (current?.runId === runId) current = null;
      send(target, { runId, type: 'exit', code, stoppedByUser: entry.stopped });
      resolve(code);
    });
  });
  return { runId, done };
}

export function stopCurrentRun(): void {
  if (current) {
    current.stopped = true;
    killTree(current.child);
  }
}

export function registerRunnerHandlers(): void {
  ipcMain.handle(
    'run:presets',
    async (
      _e,
      rootPath: string,
      currentFile: string | null,
    ): Promise<RunPreset[]> => {
      const list = await resolvePresets(rootPath, currentFile);
      return list.map(({ id, labelNe, labelEn, commandLine, interactive }) => ({
        id,
        labelNe,
        labelEn,
        commandLine,
        interactive,
      }));
    },
  );

  ipcMain.handle(
    'run:start',
    async (
      e,
      rootPath: string,
      presetId: string,
      currentFile: string | null,
    ) => {
      const list = await resolvePresets(rootPath, currentFile);
      const p = list.find((x) => x.id === presetId);
      if (!p)
        throw new Error(
          'यो कमाण्ड अहिले उपलब्ध छैन — This command is not available.',
        );
      if (p.openPath) {
        const err = await shell.openPath(p.openPath);
        if (err) throw new Error(err);
        return 0;
      }
      const root = assertInsideProject(rootPath);
      const tool = NEEDS_PACKAGES[p.id];
      if (p.id === 'dart-run' && p.args.length < 2)
        throw new Error(
          'चलाउने Dart फाइल भेटिएन (main() भएको bin/*.dart वा lib/main.dart चाहिन्छ) — No Dart file with main() found (bin/*.dart or lib/main.dart).',
        );
      const prep = tool
        ? await prepareRun(root, tool, p.id, await packagesStale(root))
        : { steps: [], notes: [] };
      // 📦 Run थिच्दा प्याकेज बारम्बार नमाग्न / नअड्कन — never let Run get stuck on "pub get"
      // Windows मा OneDrive भित्रको project मा path: प्याकेज (third_party/…) भए pub get सधैं असफल हुन्छ (errno 4390)।
      // In a OneDrive project with path: packages, pub get always fails (errno 4390), so use the packages already fetched.
      let steps = prep.steps;
      let runPreset = p;
      const notes = [...prep.notes];
      if (tool === 'flutter') {
        const hasConfig = await pathExists(
          path.join(root, '.dart_tool', 'package_config.json'),
        );
        const spec = await fs
          .readFile(path.join(root, 'pubspec.yaml'), 'utf8')
          .catch(() => '');
        const blocked =
          /[\\/]OneDrive([\\/]|$)/i.test(root) && /^\s+path\s*:/m.test(spec);
        if (hasConfig) {
          if (blocked && steps.some((s) => /\bpub get\b/.test(s))) {
            steps = steps.filter((s) => !/\bpub get\b/.test(s));
            notes.push(
              '⚠️ OneDrive भित्रको project मा pub get चल्दैन, पहिले ल्याइएका प्याकेजले चलाउँदैछु। नयाँ प्याकेज चाहिए project OneDrive बाहिर राख्नुहोस् (जस्तै C:\\dev)। · pub get cannot run inside OneDrive with path: packages, so I use the packages already fetched. Move the project outside OneDrive (for example C:\\dev) to add new packages.',
            );
          } else {
            // pub get असफल भए पनि Run नरोक्ने — a failing pub get must not stop Run
            steps = steps.map((s) =>
              /\bpub get\b/.test(s)
                ? `(${s} || echo [warning] pub get failed - running with the packages already fetched)`
                : s,
            );
          }
          // flutter ले आफैं फेरि pub get नगरोस् — stop flutter from running pub get again by itself
          runPreset = {
            ...p,
            args: [...p.args, '--no-pub'],
            commandLine: [
              p.command,
              ...[...p.args, '--no-pub'].map(quote),
            ].join(' '),
          };
        }
      }
      const prefix = steps.map((s) => `${s} && `).join('');
      return startProcess(e.sender, root, runPreset, prefix, notes).runId;
    },
  );

  // 🔧 एकै क्लिकको fix: UI ले काम र package नाम मात्र पठाउँछ — one-click fixes: the UI sends only an action and a name
  ipcMain.handle(
    'run:fix',
    async (e, rootPath: string, action: unknown, pkg: unknown) => {
      const root = assertInsideProject(rootPath);
      const kind = await detectProjectKind(root);
      if (kind !== 'flutter' && kind !== 'dart')
        throw new Error(
          'यो Flutter/Dart project होइन — Not a Flutter/Dart project.',
        );
      const tool = kind;
      let args: string[];
      if (action === 'androidResValues') {
        // resValues चालू गरेर APK फेरि बनाउने — enable resValues, then build the APK again
        const state = await enableResValues(root);
        const note =
          state === 'patched'
            ? '🔧 android/app/build.gradle मा resValues चालू गरेँ (पुरानो फाइलको backup: build.gradle.scs-backup) · Enabled resValues in android/app/build.gradle (backup: build.gradle.scs-backup)'
            : state === 'already'
              ? 'ℹ️ resValues पहिल्यै चालू छ · resValues is already on'
              : '⚠️ android/app/build.gradle भेटिएन · android/app/build.gradle was not found';
        const apk = preset('flutter-apk', 'APK बनाऊ', 'Build APK', 'flutter', [
          'build',
          'apk',
        ]);
        return startProcess(e.sender, root, apk, '', [note]).runId;
      }
      if (action === 'pubGet') args = ['pub', 'get'];
      else if (action === 'pubUpgrade')
        args = ['pub', 'upgrade', '--major-versions'];
      else if (action === 'pubAdd') {
        if (typeof pkg !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(pkg))
          throw new Error('Invalid package name');
        // pubspec मा पहिल्यै छ भने थप्नु पर्दैन, ल्याए पुग्छ — already listed? then just fetch
        const spec = await fs
          .readFile(path.join(root, 'pubspec.yaml'), 'utf8')
          .catch(() => '');
        args = new RegExp(`^\\s+${pkg}\\s*:`, 'm').test(spec)
          ? ['pub', 'get']
          : ['pub', 'add', pkg];
      } else throw new Error('Unknown fix');
      const p = preset('quick-fix', 'छिटो सुधार', 'Quick fix', tool, args);
      return startProcess(e.sender, root, p).runId;
    },
  );

  ipcMain.handle('run:key', async (_e, key: string) => {
    if (!current || !['r', 'R', 'q'].includes(key)) return;
    current.child.stdin?.write(key);
  });

  ipcMain.handle('run:stop', async () => stopCurrentRun());

  ipcMain.handle(
    'project:createFlutter',
    async (
      e,
      rawName: unknown,
      rawTemplate: unknown,
    ): Promise<ProjectInfo | null> => {
      // जे लेखे पनि मान्य नाम बनाउने (रोक्ने होइन) — sanitize whatever was typed instead of rejecting it
      let name = sanitizeProjectName(
        typeof rawName === 'string' ? rawName : '',
      );
      const templateId: FlutterTemplateId =
        rawTemplate === 'complete' ||
        rawTemplate === 'firebase' ||
        rawTemplate === 'map'
          ? rawTemplate
          : 'basic';
      const win = BrowserWindow.fromWebContents(e.sender);
      const options: Electron.OpenDialogOptions = {
        title: 'नयाँ project कहाँ राख्ने? — Where should the new project go?',
        properties: ['openDirectory', 'createDirectory'],
      };
      const picked = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      if (picked.canceled || picked.filePaths.length === 0) return null;
      const parent = picked.filePaths[0];
      // फोल्डर पहिल्यै भए _2, _3… थपेर खाली नाम पाउने — if the folder exists, add _2, _3… instead of failing
      const exists = (dir: string) =>
        fs.stat(dir).then(
          () => true,
          () => false,
        );
      const base = name;
      for (let n = 2; await exists(path.join(parent, name)); n++)
        name = `${base}_${n}`;
      const target = path.join(parent, name);
      const p = preset(
        'flutter-create',
        'नयाँ Flutter project',
        'New Flutter project',
        'flutter',
        ['create', name],
      );
      const code = await startProcess(e.sender, parent, p).done;
      if (code !== 0)
        throw new Error(
          'Flutter project बनाउन सकिएन, console हेर्नुहोस् — flutter create failed; see the console.',
        );
      // तयार starter: फाइल लेख्ने र packages थप्ने — apply the starter: write files, add packages
      const spec = templateSpec(templateId, name);
      if (spec) {
        await writeTemplateFiles(target, spec);
        const add = preset(
          'flutter-pub-add-template',
          'Starter का packages थप्दै',
          'Adding starter packages',
          'flutter',
          ['pub', 'add', ...spec.packages],
        );
        const addCode = await startProcess(e.sender, target, add).done;
        if (addCode !== 0)
          throw new Error(
            'Starter का packages थप्न सकिएन (इन्टरनेट?), console हेर्नुहोस् — adding packages failed; see the console.',
          );
      }
      return registerProject(target);
    },
  );
}
