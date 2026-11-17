import { app, ipcMain, type WebContents } from 'electron';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ClaudeLoginProgress } from '../shared/types';

// "Connect with Claude" — Anthropic को आधिकारिक `ant` CLI ले browser मा login गराउँछ।
// Login पछि token %APPDATA%\Anthropic मा बस्छ, र Anthropic SDK ले त्यही profile आफैं पढ्छ र refresh गर्छ।
//
// "Connect with Claude" uses Anthropic's official `ant` CLI for the browser (OAuth) login.
// The token lands in %APPDATA%\Anthropic and the Anthropic SDK reads and refreshes that profile itself,
// so this app never sees a password and never stores the token itself.

/** यो app को आफ्नै profile, ताकि अरू tool का login नबिग्रियोस् — A dedicated profile so other tools' logins stay untouched. */
export const CLAUDE_PROFILE = 'simple-coding-studio';

const RELEASES_API =
  'https://api.github.com/repos/anthropics/anthropic-cli/releases/latest';
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

let loginChild: ChildProcess | null = null;

function configDir(): string {
  if (process.env.ANTHROPIC_CONFIG_DIR) return process.env.ANTHROPIC_CONFIG_DIR;
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'Anthropic',
    );
  }
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
    'anthropic',
  );
}

export function isClaudeConnected(): boolean {
  const dir = configDir();
  return (
    fs.existsSync(path.join(dir, 'configs', `${CLAUDE_PROFILE}.json`)) &&
    fs.existsSync(path.join(dir, 'credentials', `${CLAUDE_PROFILE}.json`))
  );
}

const exeName = process.platform === 'win32' ? 'ant.exe' : 'ant';
const bundledAnt = () => path.join(app.getPath('userData'), 'bin', exeName);

function findAnt(): string | null {
  if (fs.existsSync(bundledAnt())) return bundledAnt();
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const found = spawnSync(finder, ['ant'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const first =
    found.status === 0
      ? found.stdout.split(/\r?\n/).find((l) => l.trim())
      : undefined;
  // Apache Ant (Java build tool) को नाम पनि `ant` हो — skip Apache Ant, which shares the name.
  if (first && !/apache|\.bat$|\.cmd$/i.test(first)) return first.trim();
  return null;
}

/** API key/token env ले profile लाई नढाकोस् — Keep stray env credentials from shadowing the profile. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_PROFILE;
  return env;
}

function sendProgress(target: WebContents, progress: ClaudeLoginProgress) {
  if (!target.isDestroyed()) target.send('claude:progress', progress);
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SimpleCodingStudio' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * GitHub बाट Anthropic को आधिकारिक `ant` ल्याउने, SHA-256 checksum मिलाउने, र app कै फोल्डरमा राख्ने।
 * Download the official `ant` release from GitHub, verify its SHA-256 checksum, and keep it in the app's folder.
 */
async function installAnt(target: WebContents): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error(
      'यो कम्प्युटरमा `ant` आफैं install गर्नुहोस्: https://github.com/anthropics/anthropic-cli — Please install the `ant` CLI yourself.',
    );
  }
  const arch =
    process.arch === 'arm64'
      ? 'arm64'
      : process.arch === 'ia32'
        ? '386'
        : 'amd64';
  sendProgress(target, {
    stage: 'installing',
    message:
      'Claude login उपकरण ल्याउँदै (पहिलोपटक मात्र) · Fetching the Claude login tool (first time only)…',
  });

  const releaseRes = await fetch(RELEASES_API, {
    headers: {
      'User-Agent': 'SimpleCodingStudio',
      Accept: 'application/vnd.github+json',
    },
  });
  if (!releaseRes.ok)
    throw new Error(`GitHub release lookup failed (HTTP ${releaseRes.status})`);
  const release = (await releaseRes.json()) as {
    tag_name: string;
    assets: ReleaseAsset[];
  };
  const zipAsset = release.assets.find((a) =>
    a.name.endsWith(`_windows_${arch}.zip`),
  );
  const sumAsset = release.assets.find((a) =>
    a.name.endsWith('_checksums.txt'),
  );
  if (!zipAsset || !sumAsset)
    throw new Error('`ant` Windows release not found on GitHub.');

  const [zip, sums] = await Promise.all([
    download(zipAsset.browser_download_url),
    download(sumAsset.browser_download_url),
  ]);
  const expected = sums
    .toString('utf8')
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/))
    .find(([, name]) => name === zipAsset.name)?.[0];
  const actual = createHash('sha256').update(zip).digest('hex');
  if (!expected || expected.toLowerCase() !== actual) {
    throw new Error(
      'Download checksum मिलेन, सुरक्षाका लागि रोकियो — Checksum mismatch; stopped for safety.',
    );
  }

  // नयाँ खाली फोल्डरमा extract गरेर ant.exe मात्र राख्ने — extract into a fresh folder and keep only ant.exe.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-ant-'));
  try {
    const zipPath = path.join(work, zipAsset.name);
    fs.writeFileSync(zipPath, zip);
    const outDir = path.join(work, 'x');
    fs.mkdirSync(outDir);
    const tarExe = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'tar.exe',
    );
    const res = spawnSync(tarExe, ['-xf', zipPath, '-C', outDir], {
      windowsHide: true,
      encoding: 'utf8',
    });
    if (res.status !== 0)
      throw new Error(
        `Unzip failed: ${res.stderr || res.error?.message || ''}`,
      );
    const found = findFile(outDir, 'ant.exe');
    if (!found) throw new Error('ant.exe not found in the download.');
    fs.mkdirSync(path.dirname(bundledAnt()), { recursive: true });
    fs.copyFileSync(found, bundledAnt());
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return bundledAnt();
}

function findFile(dir: string, name: string): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name) return full;
    if (entry.isDirectory()) {
      const nested = findFile(full, name);
      if (nested) return nested;
    }
  }
  return null;
}

function runAnt(
  antPath: string,
  args: string[],
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(antPath, args, { env: cleanEnv(), windowsHide: true });
    let output = '';
    child.stdout?.on('data', (d: Buffer) => (output += d.toString('utf8')));
    child.stderr?.on('data', (d: Buffer) => (output += d.toString('utf8')));
    child.on('error', (err) => resolve({ code: -1, output: err.message }));
    child.on('close', (code) => resolve({ code, output }));
  });
}

async function login(target: WebContents): Promise<boolean> {
  if (loginChild)
    throw new Error('Login पहिल्यै चलिरहेको छ — A login is already in progress.');
  const antPath = findAnt() ?? (await installAnt(target));

  sendProgress(target, {
    stage: 'waiting',
    message:
      'Browser खुल्यो। आफ्नो Claude (Anthropic Console) account छानेर Allow थिच्नुहोस् · Browser opened — pick your account and approve.',
  });

  return new Promise<boolean>((resolve, reject) => {
    // `ant auth login` आफैं browser खोल्छ र login पूरा भएपछि बन्द हुन्छ — it opens the browser and exits when done.
    const child = spawn(
      antPath,
      ['auth', 'login', '--profile', CLAUDE_PROFILE],
      { env: cleanEnv(), windowsHide: true },
    );
    loginChild = child;
    let output = '';
    child.stdout?.on('data', (d: Buffer) => (output += d.toString('utf8')));
    child.stderr?.on('data', (d: Buffer) => (output += d.toString('utf8')));
    const timer = setTimeout(() => child.kill(), LOGIN_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      loginChild = null;
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      loginChild = null;
      if (code === 0 && isClaudeConnected()) {
        resolve(true);
      } else if (code === null) {
        resolve(false); // रद्द गरियो वा समय सकियो — cancelled or timed out
      } else {
        const tail = output.trim().split(/\r?\n/).slice(-3).join(' ');
        reject(new Error(`Login पूरा भएन — Login did not finish. ${tail}`));
      }
    });
  });
}

export function registerClaudeLoginHandlers(): void {
  ipcMain.handle('claude:login', async (e) => {
    const ok = await login(e.sender);
    sendProgress(e.sender, { stage: ok ? 'done' : 'idle', message: '' });
    return ok;
  });

  ipcMain.handle('claude:cancelLogin', () => {
    loginChild?.kill();
  });

  ipcMain.handle('claude:logout', async () => {
    const antPath = findAnt();
    if (antPath)
      await runAnt(antPath, ['auth', 'logout', '--profile', CLAUDE_PROFILE]);
    // ant नभेटिए वा logout पछि पनि बाँकी भए यो app को profile फाइल मात्र हटाउने।
    // If ant is missing or files remain, remove only this app's profile files.
    for (const sub of ['credentials', 'configs']) {
      fs.rmSync(path.join(configDir(), sub, `${CLAUDE_PROFILE}.json`), {
        force: true,
      });
    }
    return isClaudeConnected();
  });

  ipcMain.handle('claude:status', async (): Promise<string> => {
    if (!isClaudeConnected()) return '';
    const antPath = findAnt();
    if (!antPath) return '';
    const { output } = await runAnt(antPath, [
      'auth',
      'status',
      '--profile',
      CLAUDE_PROFILE,
    ]);
    return output.trim().slice(0, 600);
  });
}

export function stopClaudeLogin(): void {
  loginChild?.kill();
}
