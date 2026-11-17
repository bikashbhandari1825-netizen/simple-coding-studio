import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileEntry, ProjectInfo, ProjectKind } from '../shared/types';

// प्रयोगकर्ताले आफैं खोलेका फोल्डरहरू मात्र। UI ले यीभन्दा बाहिरका फाइल छुन पाउँदैन।
// Only folders the user explicitly opened. The UI may not touch files outside them.
const allowedRoots = new Set<string>();

// सुरुवातीलाई अलमल्याउने ठूला/generated फोल्डरहरू लुकाउने।
// Hide large/generated folders that would confuse a beginner.
const HIDDEN = new Set([
  '.git',
  'node_modules',
  '.dart_tool',
  'build',
  '.idea',
  '.vite',
  'out',
  '.gradle',
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024;

// Windows मा फाइल नाममा नमिल्ने अक्षरहरू — Characters Windows forbids in names.
// oxlint-disable-next-line no-control-regex -- control characters are exactly what we reject
const INVALID_NAME = /[<>:"/\\|?*\u0000-\u001f]/;

export function assertInsideProject(target: string): string {
  const resolved = path.resolve(target);
  for (const root of allowedRoots) {
    const rel = path.relative(root, resolved);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      return resolved;
    }
  }
  throw new Error(
    'यो फाइल खोलिएको project बाहिर छ — This path is outside the opened project.',
  );
}

export function isProjectRoot(target: string): boolean {
  return allowedRoots.has(path.resolve(target));
}

export async function detectProjectKind(root: string): Promise<ProjectKind> {
  const has = async (name: string) =>
    fs
      .stat(path.join(root, name))
      .then(() => true)
      .catch(() => false);
  if (await has('pubspec.yaml')) {
    const pubspec = await fs
      .readFile(path.join(root, 'pubspec.yaml'), 'utf8')
      .catch(() => '');
    return /^\s*flutter\s*:/m.test(pubspec) ? 'flutter' : 'dart';
  }
  if (await has('package.json')) return 'node';
  if ((await has('requirements.txt')) || (await has('main.py')))
    return 'python';
  if (await has('index.html')) return 'web';
  return 'unknown';
}

export async function registerProject(
  folderPath: string,
): Promise<ProjectInfo | null> {
  const resolved = path.resolve(folderPath);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) return null;
  allowedRoots.add(resolved);
  return {
    rootPath: resolved,
    name: path.basename(resolved),
    kind: await detectProjectKind(resolved),
  };
}

function validateName(name: unknown): string {
  if (typeof name !== 'string') throw new Error('Invalid name');
  const trimmed = name.trim();
  if (
    !trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    INVALID_NAME.test(trimmed)
  ) {
    throw new Error(
      'नाम मिलेन। यी अक्षर प्रयोग नगर्नुहोस्: < > : " / \\ | ? * — Invalid name.',
    );
  }
  return trimmed;
}

export function registerFileSystemHandlers(): void {
  ipcMain.handle('fs:openFolderDialog', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Project फोल्डर छान्नुहोस् — Choose a project folder',
      properties: ['openDirectory'],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return registerProject(result.filePaths[0]);
  });

  // Drag & drop: preload ले वास्तविक path निकालेर पठाउँछ। प्रयोगकर्ताले आफैं छोडेकाले यो अनुमति हो।
  // Drag & drop: preload resolves the real path; the user dropping it counts as consent.
  ipcMain.handle('fs:openDroppedPath', async (_event, droppedPath: unknown) => {
    if (typeof droppedPath !== 'string' || droppedPath === '') return null;
    return registerProject(droppedPath);
  });

  ipcMain.handle(
    'fs:readDir',
    async (_event, dirPath: string): Promise<FileEntry[]> => {
      const dir = assertInsideProject(dirPath);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries
        .filter((e) => !HIDDEN.has(e.name))
        .map((e) => ({
          name: e.name,
          path: path.join(dir, e.name),
          isDirectory: e.isDirectory(),
        }))
        .sort((a, b) =>
          a.isDirectory === b.isDirectory
            ? a.name.localeCompare(b.name)
            : a.isDirectory
              ? -1
              : 1,
        );
    },
  );

  ipcMain.handle(
    'fs:readFile',
    async (_event, filePath: string): Promise<string> => {
      const file = assertInsideProject(filePath);
      const stat = await fs.stat(file);
      if (stat.size > MAX_FILE_BYTES) {
        throw new Error(
          'फाइल धेरै ठूलो छ (2MB भन्दा बढी) — File is too large (over 2 MB).',
        );
      }
      return fs.readFile(file, 'utf8');
    },
  );

  ipcMain.handle(
    'fs:writeFile',
    async (_event, filePath: string, content: string): Promise<void> => {
      const file = assertInsideProject(filePath);
      if (typeof content !== 'string') throw new Error('Invalid content');
      await fs.writeFile(file, content, 'utf8');
    },
  );

  ipcMain.handle(
    'fs:createFile',
    async (_event, dirPath: string, name: string): Promise<string> => {
      const dir = assertInsideProject(dirPath);
      const target = assertInsideProject(path.join(dir, validateName(name)));
      // 'wx' = पहिल्यै भए नबनाउने — fail instead of overwriting an existing file.
      await fs
        .writeFile(target, '', { flag: 'wx' })
        .catch((err: NodeJS.ErrnoException) => {
          if (err.code === 'EEXIST')
            throw new Error(
              'यो नामको फाइल पहिल्यै छ — A file with this name already exists.',
            );
          throw err;
        });
      return target;
    },
  );

  ipcMain.handle(
    'fs:createFolder',
    async (_event, dirPath: string, name: string): Promise<string> => {
      const dir = assertInsideProject(dirPath);
      const target = assertInsideProject(path.join(dir, validateName(name)));
      await fs.mkdir(target).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'EEXIST')
          throw new Error(
            'यो नामको फोल्डर पहिल्यै छ — A folder with this name already exists.',
          );
        throw err;
      });
      return target;
    },
  );

  ipcMain.handle(
    'fs:trash',
    async (_event, entryPath: string): Promise<void> => {
      const target = assertInsideProject(entryPath);
      if (isProjectRoot(target))
        throw new Error(
          'पूरै project मेटाउन मिल्दैन — Cannot delete the project root.',
        );
      await shell.trashItem(target);
    },
  );
}
