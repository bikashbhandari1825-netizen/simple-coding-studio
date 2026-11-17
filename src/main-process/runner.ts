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
import type { ProjectInfo, RunEvent, RunPreset } from '../shared/types';
import {
  assertInsideProject,
  detectProjectKind,
  registerProject,
} from './fileSystem';

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
      preset('dart-run', 'Dart project चलाऊ', 'Run Dart project', 'dart', [
        'run',
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
): { runId: number; done: Promise<number | null> } {
  if (current) {
    current.stopped = true;
    killTree(current.child);
  }
  const runId = nextRunId++;
  send(target, { runId, type: 'start', commandLine: p.commandLine });

  // .bat/.cmd (flutter, npm) चलाउन Windows मा shell चाहिन्छ। Args हामीले नै बनाएका र quote गरिएका हुन्।
  // Windows needs a shell for .bat/.cmd tools; every arg here is ours and quoted.
  const child = spawn([p.command, ...p.args.map(quote)].join(' '), {
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
      return startProcess(e.sender, assertInsideProject(rootPath), p).runId;
    },
  );

  ipcMain.handle('run:key', async (_e, key: string) => {
    if (!current || !['r', 'R', 'q'].includes(key)) return;
    current.child.stdin?.write(key);
  });

  ipcMain.handle('run:stop', async () => stopCurrentRun());

  ipcMain.handle(
    'project:createFlutter',
    async (e, rawName: unknown): Promise<ProjectInfo | null> => {
      const name = typeof rawName === 'string' ? rawName.trim() : '';
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) {
        throw new Error(
          'नाम सानो अंग्रेजी अक्षर, अंक र _ मात्र हुनुपर्छ (जस्तै my_app) — Use lowercase letters, digits and _ (e.g. my_app).',
        );
      }
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
      const target = path.join(parent, name);
      if (
        await fs.stat(target).then(
          () => true,
          () => false,
        )
      ) {
        throw new Error(
          'त्यहाँ यही नामको फोल्डर पहिल्यै छ — A folder with that name already exists there.',
        );
      }
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
      return registerProject(target);
    },
  );
}
