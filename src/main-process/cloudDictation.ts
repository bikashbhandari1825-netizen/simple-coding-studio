import { app, ipcMain, type WebContents } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { DictationEvent } from '../shared/types';

// ☁️ Cloud dictation: Electron भित्र SpeechRecognition चल्दैन (network error), तर Chrome/Edge भित्र चल्छ।
// त्यसैले app ले Chrome/Edge को एउटा लुकेको सानो window चलाउँछ, जसले Google/Microsoft को speech service बाट
// नेपाली/English तुरुन्तै अक्षरमा बदलेर यहाँ पठाउँछ। API key चाहिँदैन।
//
// SpeechRecognition fails inside Electron, but works in Chrome/Edge. The app runs a hidden Chrome/Edge window
// on a private localhost page; it streams Google/Microsoft speech results back here. No API key is needed.
// The browser only listens while the 🎤 button is on.

let server: http.Server | null = null;
let token = '';
let browser: ChildProcess | null = null;
let target: WebContents | null = null;
let sse: http.ServerResponse | null = null;
let pending: string[] = [];
let starting: Promise<void> | null = null;

function findBrowser(): string | null {
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    // Chrome पहिले: Google को नेपाली पहिचान राम्रो — Chrome first: Google's Nepali recognition is strong.
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  return candidates.find((c) => c && fs.existsSync(c)) ?? null;
}

function emit(event: DictationEvent) {
  if (target && !target.isDestroyed()) target.send('dictation:event', event);
}

function command(cmd: object) {
  const line = `data: ${JSON.stringify(cmd)}\n\n`;
  if (sse) sse.write(line);
  else pending.push(line);
}

// Browser भित्र चल्ने page — the page that runs inside the hidden browser window.
const PAGE = (
  tok: string,
) => `<!doctype html><html><head><meta charset="utf-8"><title>Simple Coding Studio · Dictation</title></head>
<body style="font:14px Segoe UI;background:#0f172a;color:#cbd5e1">Simple Coding Studio dictation
<script>
const base = '/d/${tok}';
const R = window.SpeechRecognition || window.webkitSpeechRecognition;
// घटनाहरू क्रमैसँग पठाउने (एकपछि अर्को), नत्र शब्द अघिपछि वा हराउन सक्छन् — send events strictly in order, or words can arrive shuffled or be lost.
let chain = Promise.resolve();
const post = (o) => { chain = chain.then(() => fetch(base + '/ev', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) }).catch(() => {})); };
// अन्तिम नभएको बोलाइ (browser ले session बन्द गर्दा हराउने) — words heard but not yet final; Chrome drops them when a session ends.
let lastInterim = '';
function flushInterim() {
  const t = lastInterim.trim();
  lastInterim = '';
  if (t) { post({ type: 'final', text: t }); post({ type: 'interim', text: '' }); }
}
// एकपटकमा एउटा मात्र recognizer: पुरानाका घटनाहरू बेवास्ता — only one recognizer at a time; events from old ones are ignored.
let current = null, active = false, lang = 'ne-NP', netFails = 0;
function retire(r) {
  if (!r) return;
  r.onstart = r.onresult = r.onerror = r.onend = null;
  flushInterim();
  try { r.abort(); } catch {}
}
function begin() {
  if (!R) { post({ type: 'error', error: 'no-api' }); return; }
  const r = new R();
  current = r;
  r.lang = lang; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
  r.onstart = () => { if (r === current) { netFails = 0; post({ type: 'start' }); } };
  r.onresult = (e) => {
    if (r !== current) return;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) post({ type: 'final', text: t }); else interim += t;
    }
    lastInterim = interim;
    post({ type: 'interim', text: interim });
  };
  r.onerror = (e) => {
    if (r !== current) return;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'language-not-supported') active = false;
    // network/no-speech/aborted ले बीचमा रोकिए पनि आफैं फेरि सुरु हुन्छ (onend मा) — these end the session; onend restarts it.
    if (e.error !== 'no-speech' && e.error !== 'aborted' && e.error !== 'network') post({ type: 'error', error: e.error });
    else if (e.error === 'network') netFails++;
    if (netFails >= 4) { post({ type: 'error', error: 'network' }); netFails = 0; }
  };
  // Browser आफैं केही बेरपछि रोकिन्छ; 🎤 चालु भएसम्म नयाँ सुरु गर्ने — browsers stop on their own; start a fresh one while active.
  r.onend = () => {
    if (r !== current) return;
    flushInterim();
    if (active) setTimeout(() => { if (active && r === current) begin(); }, 0);
    else { current = null; post({ type: 'end' }); }
  };
  r.start();
}
const es = new EventSource(base + '/cmd');
// App बन्द भएपछि (server हरायो) यो window आफैं बन्द हुने — close this window once the app (server) is gone.
let failures = 0;
es.onopen = () => { failures = 0; };
es.onerror = () => { if (++failures >= 3) { active = false; retire(current); window.close(); } };
es.onmessage = (m) => {
  const c = JSON.parse(m.data);
  if (c.type === 'start') { lang = c.lang; active = true; const old = current; current = null; retire(old); begin(); }
  if (c.type === 'stop') { active = false; if (current) current.stop(); else post({ type: 'end' }); }
};
post({ type: 'ready' });
</script></body></html>`;

function ensureServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server?.listening) {
      resolve((server.address() as { port: number }).port);
      return;
    }
    token = randomBytes(16).toString('hex');
    server = http.createServer((req, res) => {
      const base = `/d/${token}`;
      // Token नभएको अनुरोध अस्वीकार — reject anything without the secret token.
      if (!req.url?.startsWith(base)) {
        res.writeHead(404).end();
        return;
      }
      const sub = req.url.slice(base.length);
      if (sub === '' || sub === '/') {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(PAGE(token));
      } else if (sub === '/cmd') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        sse = res;
        for (const line of pending) res.write(line);
        pending = [];
        req.on('close', () => {
          if (sse === res) sse = null;
        });
      } else if (sub === '/ev' && req.method === 'POST') {
        let body = '';
        req.on('data', (d: Buffer) => {
          body += d.toString('utf8');
          if (body.length > 100_000) req.destroy();
        });
        req.on('end', () => {
          try {
            const ev = JSON.parse(body) as {
              type: string;
              text?: string;
              error?: string;
            };
            if (
              ['start', 'interim', 'final', 'end', 'error', 'ready'].includes(
                ev.type,
              )
            ) {
              emit({
                type: ev.type as DictationEvent['type'],
                text: typeof ev.text === 'string' ? ev.text : undefined,
                error: ev.error,
              });
            }
          } catch {
            // ignore malformed
          }
          res.writeHead(204).end();
        });
      } else {
        res.writeHead(404).end();
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () =>
      resolve((server!.address() as { port: number }).port),
    );
  });
}

async function ensureBrowser(): Promise<void> {
  // Chrome पहिल्यै चलिरहेको भए (उही profile) नयाँ window त्यसैमा खुल्छ; जडान (sse) नै मुख्य संकेत।
  // If Chrome already runs with this profile the window opens in that process, so the live connection is what counts.
  if (sse) return;
  if (starting) return starting;
  starting = (async () => {
    const exe = findBrowser();
    if (!exe) throw new Error('no-browser');
    const port = await ensureServer();
    const profile = path.join(app.getPath('userData'), 'dictation-browser');
    browser = spawn(
      exe,
      [
        `--user-data-dir=${profile}`,
        `--app=http://127.0.0.1:${port}/d/${token}/`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-sync',
        // लुकेको window ले आवाज पहिचान नरोकोस् — keep the hidden window from being throttled or paused.
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-features=CalculateNativeWinOcclusion',
        // Screen बाहिर लुकाउने — keep the window off-screen.
        '--window-position=-32000,-32000',
        '--window-size=360,120',
        // यो private page लाई mic अनुमति आफैं दिने — auto-allow the mic for this private page only.
        '--use-fake-ui-for-media-stream',
      ],
      { windowsHide: true, detached: false },
    );
    browser.on('exit', () => {
      browser = null;
    });
    // Page तयार हुन्जेल पर्खने (बढीमा १५ सेकेन्ड; पहिलो पटक Chrome सुरु हुन ढिलो हुन्छ) — wait up to 15 s; Chrome's first start can be slow.
    const t0 = Date.now();
    while (!sse && Date.now() - t0 < 15000)
      await new Promise((r) => setTimeout(r, 50));
    if (!sse) throw new Error('browser-timeout');
  })().finally(() => {
    starting = null;
  });
  return starting;
}

export function stopCloudDictation(): void {
  if (browser?.pid !== undefined && browser.exitCode === null) {
    spawn('taskkill', ['/pid', String(browser.pid), '/T', '/F'], {
      windowsHide: true,
    });
  }
  browser = null;
  server?.close();
  server = null;
}

export function registerCloudDictationHandlers(): void {
  ipcMain.handle('dictation:available', () => Boolean(findBrowser()));
  ipcMain.handle('dictation:prepare', async (e) => {
    target = e.sender;
    await ensureBrowser();
  });
  ipcMain.handle('dictation:start', async (e, lang: unknown) => {
    target = e.sender;
    const l = lang === 'en-US' ? 'en-US' : 'ne-NP';
    await ensureBrowser();
    command({ type: 'start', lang: l });
  });
  ipcMain.handle('dictation:stop', () => {
    command({ type: 'stop' });
  });
}
