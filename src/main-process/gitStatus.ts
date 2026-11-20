import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import type { GitStatusInfo } from '../shared/types';

// 🔄 Project को Git/backup स्थिति (पढ्ने मात्र — केही बदल्दैन) — read-only Git/backup status.

function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout: 6000, windowsHide: true, maxBuffer: 2_000_000 },
      (err, stdout) => resolve(err ? null : stdout),
    );
  });
}

export async function readGitStatus(root: string): Promise<GitStatusInfo> {
  const out = await git(root, ['status', '--porcelain=v1', '-b']);
  if (out === null) return { isRepo: false };
  const lines = out.split(/\r?\n/).filter(Boolean);
  const head = lines.find((l) => l.startsWith('## ')) ?? '';
  const changed = lines.filter((l) => !l.startsWith('## ')).length;
  // "## main...origin/main [ahead 2, behind 1]"  |  "## main"  |  "## No commits yet on main"
  const branch = head
    .slice(3)
    .replace(/^No commits yet on /, '')
    .split('...')[0]
    .split(' ')[0];
  const hasRemote = head.includes('...');
  const ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0);
  const behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0);
  return { isRepo: true, branch, changed, ahead, behind, hasRemote };
}

export function registerGitStatusHandlers(): void {
  ipcMain.handle(
    'project:gitStatus',
    async (_e, root: unknown): Promise<GitStatusInfo> =>
      typeof root === 'string' && root
        ? readGitStatus(root)
        : { isRepo: false },
  );
}
