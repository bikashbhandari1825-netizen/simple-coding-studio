import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  FileEntry,
  ProjectInfo,
  ProjectKind,
  SearchResult,
} from '../shared/types';

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

const MAX_FILE_BYTES = 8 * 1024 * 1024;
/** Ctrl+P सूचीमा बढीमा यति फाइल — the most files listed for Quick Open. */
const MAX_LIST_FILES = 25_000;
/** फाइल खोजमा नपस्ने भारी फोल्डर — heavy folders skipped by Quick Open. */
const LIST_SKIP = new Set([
  'venv',
  '.venv',
  '__pycache__',
  'Intermediate',
  'Binaries',
  'Saved',
  'DerivedDataCache',
]);

/** Project खोजमा बढीमा यति नतिजा / ठूलो फाइल छोड्ने — search result and file-size limits. */
const SEARCH_MAX_MATCHES = 500;
const SEARCH_MAX_FILE_BYTES = 1024 * 1024;
const SEARCH_SKIP_EXT =
  /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|7z|rar|jar|exe|dll|so|dylib|class|ttf|otf|woff2?|mp[34]|wav|ogg|mov|avi|lock|bin|keystore|jks)$/i;

/** खोलिएको फाइल कुन encoding मा थियो (save गर्दा उही राख्न) — each file's encoding, kept when saving. */
type Encoding = 'utf8' | 'utf8-bom' | 'utf16le' | 'utf16be';
const encodings = new Map<string, Encoding>();

/** Node का error हरूलाई बुझिने नेपाली/English सन्देश — friendly bilingual messages for file-system errors. */
export function friendlyFsError(err: unknown, what: string): Error {
  const code = (err as NodeJS.ErrnoException)?.code;
  const name = path.basename(what);
  switch (code) {
    case 'ENOENT':
      return new Error(
        `"${name}" भेटिएन (सारिएको वा मेटिएको हुनसक्छ) — "${name}" was not found (it may have been moved or deleted).`,
      );
    case 'EISDIR':
      return new Error(
        `"${name}" फोल्डर हो, फाइल होइन — "${name}" is a folder, not a file.`,
      );
    case 'EACCES':
    case 'EPERM':
      return new Error(
        `"${name}" खोल्ने अनुमति छैन — No permission to open "${name}".`,
      );
    case 'EBUSY':
      return new Error(
        `"${name}" अर्को program ले प्रयोग गरिरहेको छ — "${name}" is in use by another program.`,
      );
    case 'UNKNOWN':
    case 'ETIMEDOUT':
      return new Error(
        `"${name}" OneDrive बाट download हुन सकेन; internet जाँच्नुहोस् — "${name}" could not be downloaded from OneDrive; check your internet.`,
      );
    default:
      return err instanceof Error ? err : new Error(String(err));
  }
}

/** Bytes बाट पाठ (UTF-8, BOM, UTF-16), binary भए अस्वीकार — decode bytes as text; refuse binary files. */
function decodeText(buf: Buffer, file: string): string {
  if (
    buf.length >= 3 &&
    buf[0] === 0xef &&
    buf[1] === 0xbb &&
    buf[2] === 0xbf
  ) {
    encodings.set(file, 'utf8-bom');
    return buf.subarray(3).toString('utf8');
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    encodings.set(file, 'utf16le');
    return buf.subarray(2).toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    encodings.set(file, 'utf16be');
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  // सुरुका ८KB मा NUL byte भए binary (image, .uasset…) — NUL bytes in the first 8 KB mean a binary file.
  if (buf.subarray(0, 8192).includes(0)) {
    throw new Error(
      `"${path.basename(file)}" code/पाठ फाइल होइन (binary), editor मा खोल्न मिल्दैन — "${path.basename(file)}" is a binary file, not text.`,
    );
  }
  encodings.set(file, 'utf8');
  return buf.toString('utf8');
}

function encodeText(text: string, file: string): Buffer {
  switch (encodings.get(file)) {
    case 'utf8-bom':
      return Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(text, 'utf8'),
      ]);
    case 'utf16le':
      return Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(text, 'utf16le'),
      ]);
    case 'utf16be': {
      const le = Buffer.from(text, 'utf16le');
      le.swap16();
      return Buffer.concat([Buffer.from([0xfe, 0xff]), le]);
    }
    default:
      return Buffer.from(text, 'utf8');
  }
}

/** Symlink/junction ले देखाउने ठाउँ फोल्डर हो कि — follow symlinks/junctions to see whether they point to a folder. */
async function entryKind(
  dir: string,
  e: Dirent,
): Promise<{ isDirectory: boolean; isSymlink: boolean }> {
  if (!e.isSymbolicLink())
    return { isDirectory: e.isDirectory(), isSymlink: false };
  const st = await fs.stat(path.join(dir, e.name)).catch(() => null);
  return { isDirectory: Boolean(st?.isDirectory()), isSymlink: true };
}

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
    if (/^\s*flutter\s*:/m.test(pubspec)) return 'flutter';
    // pubspec अधुरो भए पनि कोडले Flutter प्रयोग गर्छ भने Flutter project — Flutter code with an incomplete pubspec
    const main = await fs
      .readFile(path.join(root, 'lib', 'main.dart'), 'utf8')
      .catch(() => '');
    return /['"]package:flutter\//.test(main) ? 'flutter' : 'dart';
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

/**
 * lib/screens/home_screen.dart जस्तो फोल्डर सहितको बाटो पनि मान्ने — accepts a nested path like "lib/screens/home_screen.dart".
 * हरेक भाग छुट्टै जाँचिन्छ; ".." र पूरा बाटो (C:\ वा /) मान्दैन — every part is checked; ".." and absolute paths are refused.
 */
function validateRelPath(name: unknown): string {
  if (typeof name !== 'string') throw new Error('Invalid name');
  const raw = name.trim();
  if (/^([a-zA-Z]:|[\\/])/.test(raw))
    throw new Error(
      'पूरा बाटो मिल्दैन — project भित्रको बाटो लेख्नुहोस्, जस्तै lib/screens/home_screen.dart — Use a path inside the project.',
    );
  const parts = raw.split(/[\\/]+/).filter((p) => p.length > 0);
  if (parts.length === 0) throw new Error('Invalid name');
  return path.join(...parts.map((p) => validateName(p)));
}

/**
 * lib/lib/lib नबनाउन: लेखेको बाटो project को पहिलो फोल्डर (जस्तै lib/) बाट सुरु भए र चुनिएको फोल्डर त्यही भित्र छ भने, project को जरैबाट बनाउने।
 * Avoid lib/lib/lib: when the typed path starts with the project's top folder (like lib/) and the chosen folder is already inside it, build from the project root.
 */
function baseFor(dir: string, relPath: string): string {
  const parts = relPath.split(path.sep);
  for (const root of allowedRoots) {
    const rel = path.relative(root, dir);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const top = rel.split(path.sep)[0];
    if (parts.length > 1 && parts[0].toLowerCase() === top.toLowerCase())
      return root;
    return dir;
  }
  return dir;
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
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        throw friendlyFsError(err, dir);
      }
      const list = await Promise.all(
        entries
          .filter((e) => !HIDDEN.has(e.name))
          .map(async (e) => ({
            name: e.name,
            path: path.join(dir, e.name),
            ...(await entryKind(dir, e)),
          })),
      );
      return list.sort((x, y) =>
        x.isDirectory === y.isDirectory
          ? x.name.localeCompare(y.name, undefined, {
              numeric: true,
              sensitivity: 'base',
            })
          : x.isDirectory
            ? -1
            : 1,
      );
    },
  );

  ipcMain.handle(
    'fs:readFile',
    async (_event, filePath: string): Promise<string> => {
      const file = assertInsideProject(filePath);
      try {
        const stat = await fs.stat(file);
        if (stat.isDirectory())
          throw Object.assign(new Error('EISDIR'), { code: 'EISDIR' });
        if (stat.size > MAX_FILE_BYTES) {
          const mb = (stat.size / 1048576).toFixed(1);
          throw new Error(
            `फाइल धेरै ठूलो छ (${mb}MB, सीमा 8MB) — File is too large (${mb} MB; limit 8 MB).`,
          );
        }
        return decodeText(await fs.readFile(file), file);
      } catch (err) {
        throw (err as NodeJS.ErrnoException).code
          ? friendlyFsError(err, file)
          : err;
      }
    },
  );

  // Ctrl+P "फाइल खोज" का लागि project का सबै फाइल (generated फोल्डर बाहेक) — every file, for Quick Open.
  ipcMain.handle(
    'fs:listAll',
    async (
      _event,
      rootPath: string,
    ): Promise<{ files: string[]; truncated: boolean }> => {
      const root = assertInsideProject(rootPath);
      const files: string[] = [];
      const queue = [root];
      while (queue.length && files.length < MAX_LIST_FILES) {
        const dir = queue.shift() as string;
        let entries: Dirent[];
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entries) {
          if (HIDDEN.has(e.name)) continue;
          const p = path.join(dir, e.name);
          // Symlink फोल्डरभित्र नपस्ने (pub cache जस्ता ठूला ठाउँ) — never descend into symlinked folders.
          if (e.isDirectory()) {
            if (!LIST_SKIP.has(e.name)) queue.push(p);
          } else if (e.isFile()) {
            files.push(path.relative(root, p));
            if (files.length >= MAX_LIST_FILES) break;
          }
        }
      }
      return { files, truncated: files.length >= MAX_LIST_FILES };
    },
  );

  // Ctrl+Shift+F: project भरका फाइलमा पाठ खोज्ने — search text across the project's files.
  ipcMain.handle(
    'fs:search',
    async (
      _event,
      rootPath: string,
      query: string,
      opts?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean },
    ): Promise<SearchResult> => {
      const root = assertInsideProject(rootPath);
      const result: SearchResult = {
        matches: [],
        files: 0,
        truncated: false,
        error: undefined,
      };
      if (typeof query !== 'string' || !query) return result;
      let re: RegExp;
      try {
        const body = opts?.regex
          ? query
          : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        re = new RegExp(
          opts?.wholeWord ? `\\b(?:${body})\\b` : body,
          opts?.caseSensitive ? 'g' : 'gi',
        );
      } catch {
        result.error = 'यो खोज ढाँचा मिलेन · This search pattern is not valid';
        return result;
      }
      const queue = [root];
      let scanned = 0;
      while (queue.length && !result.truncated && scanned < MAX_LIST_FILES) {
        const dir = queue.shift() as string;
        let entries: Dirent[];
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entries) {
          if (HIDDEN.has(e.name)) continue;
          const p = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (!LIST_SKIP.has(e.name)) queue.push(p);
            continue;
          }
          if (!e.isFile() || SEARCH_SKIP_EXT.test(e.name)) continue;
          scanned++;
          let text: string;
          try {
            const st = await fs.stat(p);
            if (st.size > SEARCH_MAX_FILE_BYTES) continue;
            const buf = await fs.readFile(p);
            if (buf.subarray(0, 8192).includes(0)) continue; // binary
            text = buf.toString('utf8');
          } catch {
            continue;
          }
          let hit = false;
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            re.lastIndex = 0;
            const m = re.exec(lines[i]);
            if (!m) continue;
            hit = true;
            result.matches.push({
              file: path.relative(root, p),
              line: i + 1,
              column: m.index + 1,
              length: Math.max(1, m[0].length),
              text: lines[i].trim().slice(0, 240),
            });
            if (result.matches.length >= SEARCH_MAX_MATCHES) {
              result.truncated = true;
              break;
            }
          }
          if (hit) result.files++;
          if (result.truncated) break;
        }
      }
      return result;
    },
  );

  ipcMain.handle(
    'fs:writeFile',
    async (_event, filePath: string, content: string): Promise<void> => {
      const file = assertInsideProject(filePath);
      if (typeof content !== 'string') throw new Error('Invalid content');
      // खोल्दाकै encoding मा save — save in the same encoding the file was opened with.
      try {
        await fs.writeFile(file, encodeText(content, file));
      } catch (err) {
        throw friendlyFsError(err, file);
      }
    },
  );

  ipcMain.handle(
    'fs:createFile',
    async (_event, dirPath: string, name: string): Promise<string> => {
      const dir = assertInsideProject(dirPath);
      const relPath = validateRelPath(name);
      const target = assertInsideProject(
        path.join(baseFor(dir, relPath), relPath),
      );
      // फोल्डर नभए आफैं बनाउने — create missing folders on the way
      await fs.mkdir(path.dirname(target), { recursive: true });
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
      const relPath = validateRelPath(name);
      const target = assertInsideProject(
        path.join(baseFor(dir, relPath), relPath),
      );
      if (
        await fs.stat(target).then(
          () => true,
          () => false,
        )
      )
        throw new Error(
          'यो नामको फोल्डर पहिल्यै छ — A folder with this name already exists.',
        );
      await fs
        .mkdir(target, { recursive: true })
        .catch((err: NodeJS.ErrnoException) => {
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
