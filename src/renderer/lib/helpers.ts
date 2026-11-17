// साना सहयोगी functions — Small helper functions.

const LANGUAGE_BY_EXT: Record<string, string> = {
  dart: 'dart',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  json: 'json',
  html: 'html',
  css: 'css',
  scss: 'scss',
  md: 'markdown',
  py: 'python',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  java: 'java',
  kt: 'kotlin',
  gradle: 'java',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'cpp',
  cs: 'csharp',
  sh: 'shell',
  bat: 'bat',
  ps1: 'powershell',
  sql: 'sql',
};

export function languageFor(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return LANGUAGE_BY_EXT[ext] ?? 'plaintext';
}

export function fileIcon(
  name: string,
  isDirectory: boolean,
  open = false,
): string {
  if (isDirectory) return open ? '📂' : '📁';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'dart') return '🎯';
  if (['yaml', 'yml', 'json'].includes(ext)) return '⚙️';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext))
    return '🖼️';
  if (ext === 'md') return '📘';
  if (['js', 'ts', 'tsx', 'jsx', 'mjs'].includes(ext)) return '📜';
  if (ext === 'py') return '🐍';
  if (['html', 'css'].includes(ext)) return '🌐';
  return '📄';
}

const BINARY_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'bmp',
  'pdf',
  'zip',
  'apk',
  'exe',
  'dll',
  'so',
  'jar',
  'ttf',
  'otf',
  'woff',
  'woff2',
  'mp3',
  'mp4',
  'wav',
  'keystore',
  'jks',
]);

export function isProbablyBinary(name: string): boolean {
  return BINARY_EXT.has(name.split('.').pop()?.toLowerCase() ?? '');
}

/** Terminal का रङ codes हटाउने — Strip terminal colour codes. */
export function stripAnsi(text: string): string {
  // oxlint-disable-next-line no-control-regex -- ANSI escape codes start with ESC
  const withoutColors = text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
  return withoutColors.replace(/\r(?!\n)/g, '\n');
}

export function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Electron ले "Error invoking remote method 'x': Error: " अगाडि थप्छ — strip Electron's IPC prefix.
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

const RECENT_KEY = 'studio.recentProjects';

export function loadRecent(): string[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(RECENT_KEY) ?? '[]',
    ) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string').slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

export function rememberRecent(rootPath: string): void {
  try {
    const next = [
      rootPath,
      ...loadRecent().filter((p) => p !== rootPath),
    ].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage नभए पनि एप चल्छ — the app works without it.
  }
}

export function forgetRecent(rootPath: string): void {
  try {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify(loadRecent().filter((p) => p !== rootPath)),
    );
  } catch {
    // ignore
  }
}
