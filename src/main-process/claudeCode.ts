import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ClaudeStatus } from '../shared/types';

// Guru ले तपाईंको computer मा login भएको Claude Code (`claude` CLI) प्रयोग गर्छ।
// त्यसैले छुट्टै API key वा credit चाहिँदैन, तपाईंको Claude subscription बाटै चल्छ।
//
// Guru runs through the Claude Code CLI already signed in on this computer,
// so it uses the user's Claude subscription: no API key and no separate credits.

let cachedPath: string | null | undefined;

/** `claude` कहाँ छ खोज्ने — Locate the claude executable (native .exe preferred). */
export function findClaude(): string | null {
  if (
    cachedPath !== undefined &&
    (cachedPath === null || fs.existsSync(cachedPath))
  )
    return cachedPath;
  const home = app.getPath('home');
  const candidates = [
    path.join(
      home,
      '.local',
      'bin',
      process.platform === 'win32' ? 'claude.exe' : 'claude',
    ),
  ];
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const found = spawnSync(finder, ['claude'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (found.status === 0)
    candidates.push(
      ...found.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    );
  // .exe लाई shell बिना सिधै चलाउन मिल्छ; .cmd लाई shell चाहिन्छ — prefer a real .exe (no shell needed).
  cachedPath =
    candidates.find(
      (c) =>
        fs.existsSync(c) &&
        (process.platform !== 'win32' || c.toLowerCase().endsWith('.exe')),
    ) ?? null;
  return cachedPath;
}

/** API key env ले subscription login लाई नढाकोस् — Keep stray API-key env vars from overriding the subscription login. */
export function claudeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDE_CODE_SIMPLE;
  return env;
}

function run(
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const claude = findClaude();
  if (!claude)
    return Promise.resolve({
      code: -1,
      stdout: '',
      stderr: 'claude not found',
    });
  return new Promise((resolve) => {
    const child = spawn(claude, args, { env: claudeEnv(), windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', (err) =>
      resolve({ code: -1, stdout, stderr: err.message }),
    );
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

export async function getClaudeStatus(): Promise<ClaudeStatus> {
  if (!findClaude()) return { installed: false, loggedIn: false };
  const { stdout } = await run(['auth', 'status', '--json']);
  try {
    const s = JSON.parse(stdout) as {
      loggedIn?: boolean;
      authMethod?: string;
      email?: string;
      subscriptionType?: string;
      orgName?: string;
    };
    return {
      installed: true,
      loggedIn: Boolean(s.loggedIn),
      email: s.email,
      plan: s.subscriptionType,
      authMethod: s.authMethod,
    };
  } catch {
    return { installed: true, loggedIn: false };
  }
}

/**
 * Login (वा Switch Account) एउटा देखिने terminal window मा चलाउने। Browser खुल्छ र email छान्न मिल्छ।
 * Run login (or switch account) in a visible terminal window; it opens the browser to pick an email.
 */
async function openLoginTerminal(switchAccount: boolean): Promise<void> {
  const claude = findClaude();
  if (!claude)
    throw new Error(
      'Claude Code भेटिएन — Claude Code (claude) is not installed.',
    );
  if (process.platform !== 'win32') {
    throw new Error(
      'Terminal मा `claude auth login` चलाउनुहोस् — Please run `claude auth login` in a terminal.',
    );
  }
  const script = path.join(app.getPath('userData'), 'claude-login.cmd');
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'title Claude Login - Simple Coding Studio',
    'set ANTHROPIC_API_KEY=',
    'set ANTHROPIC_AUTH_TOKEN=',
    'echo.',
    'echo   Simple Coding Studio - Claude account',
    'echo   ------------------------------------',
    ...(switchAccount
      ? [
          'echo   Logging out of the current account...',
          `"${claude}" auth logout`,
          'echo.',
        ]
      : []),
    'echo   A browser will open. Choose the email/account you want, then approve.',
    'echo   Browser खुल्छ - आफूले चाहेको email छानेर Authorize थिच्नुहोस्।',
    'echo.',
    `"${claude}" auth login --claudeai`,
    'echo.',
    'echo   Done - going back to Simple Coding Studio...',
    'echo   सकियो - app मा फर्कँदै...',
    // आफैं बन्द हुने (कुनै key थिच्नु नपर्ने) — closes by itself, no key press needed
    'timeout /t 2 /nobreak >nul',
  ];
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, lines.join('\r\n') + '\r\n', 'utf8');
  // आफ्नै console window मा चलाउने र बन्द हुनेबित्तिकै अवस्था पठाउने — own console window; report the moment it closes
  const child = spawn('cmd.exe', ['/c', script], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.on('error', () => undefined);
  child.on('exit', () => void broadcastStatus());
  child.unref();
}

// ---------------------------------------------------------------- ⚡ instant sign-in detection
// Browser मा Authorize थिच्नेबित्तिकै Claude Code आफैंले token आफ्नो credentials फाइलमा राख्छ। हामी token
// छुँदैनौं; त्यो फाइल बदलिएको मात्र हेरेर तुरुन्तै नयाँ अवस्था app मा पठाउँछौं (३ सेकेन्ड पर्खाइ बिना)।
// When "Authorize" is pressed, Claude Code itself stores the token in its credentials file. We never read the
// token; we only watch for that file changing and push the new sign-in state to the app right away.
let lastPushed = '';
let pushing: Promise<void> | null = null;
async function broadcastStatus(): Promise<void> {
  if (pushing) return pushing;
  pushing = (async () => {
    try {
      const s = await getClaudeStatus();
      const key = JSON.stringify(s);
      if (key === lastPushed) return;
      lastPushed = key;
      for (const w of BrowserWindow.getAllWindows())
        if (!w.isDestroyed()) w.webContents.send('claude:status', s);
    } finally {
      pushing = null;
    }
  })();
  return pushing;
}

function configDir(): string {
  return (
    process.env.CLAUDE_CONFIG_DIR || path.join(app.getPath('home'), '.claude')
  );
}

let watcher: fs.FSWatcher | null = null;
let debounce: ReturnType<typeof setTimeout> | undefined;
function watchCredentials(): void {
  if (watcher) return;
  try {
    const dir = configDir();
    fs.mkdirSync(dir, { recursive: true });
    watcher = fs.watch(dir, (_event, name) => {
      if (name && !/credentials|\.claude\.json$/i.test(String(name))) return;
      clearTimeout(debounce);
      if (process.env.STUDIO_AUTH_DEBUG)
        console.log(`[auth] change seen: ${String(name)} at ${Date.now()}`);
      debounce = setTimeout(() => void broadcastStatus(), 150);
    });
    watcher.on('error', () => {
      watcher = null;
    });
  } catch {
    // फाइल हेर्न नमिले पनि पुरानो polling काम गर्छ — polling still works if watching is not possible
  }
}

export function stopAuthWatch(): void {
  watcher?.close();
  watcher = null;
}

let guruChildren = new Set<ChildProcess>();
export function trackGuruChild(child: ChildProcess): void {
  guruChildren.add(child);
  child.on('close', () => guruChildren.delete(child));
}
export function stopGuruChildren(): void {
  for (const c of guruChildren) killTree(c);
  guruChildren = new Set();
}

export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
    });
  } else {
    child.kill('SIGTERM');
  }
}

export function registerClaudeCodeHandlers(): void {
  watchCredentials();
  ipcMain.handle('claude:status', async () => {
    const s = await getClaudeStatus();
    lastPushed = JSON.stringify(s);
    return s;
  });
  ipcMain.handle('claude:login', (_e, switchAccount: unknown) =>
    openLoginTerminal(switchAccount === true),
  );
  ipcMain.handle('claude:logout', async () => {
    await run(['auth', 'logout']);
    const s = await getClaudeStatus();
    lastPushed = JSON.stringify(s);
    return s;
  });
}
