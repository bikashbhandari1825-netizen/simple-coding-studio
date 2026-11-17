import { app, ipcMain, type WebContents } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { SpeakChunk, SpeakerEvent } from '../shared/types';

// 🔊 Guru को जवाफ ठूलो स्वरमा पढ्ने (Text-to-Speech)।
// Microsoft Edge मा प्राकृतिक नेपाली (हेमकला / सागर) र English (Ava, Andrew…) आवाज निःशुल्क छन्,
// त्यसैले app ले Edge को एउटा लुकेको सानो window मा speechSynthesis चलाउँछ।
//
// Read Guru's answers aloud. Microsoft Edge ships natural Nepali voices (Hemkala / Sagar) and natural
// English voices for free, so the app drives speechSynthesis in a hidden Edge window.

let server: http.Server | null = null;
let token = '';
let browser: ChildProcess | null = null;
let target: WebContents | null = null;
let sse: http.ServerResponse | null = null;
let pending: string[] = [];
let starting: Promise<void> | null = null;

function findEdge(): string | null {
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const candidates = [
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

function emit(event: SpeakerEvent) {
  if (target && !target.isDestroyed()) target.send('speaker:event', event);
}

function command(cmd: object) {
  const line = `data: ${JSON.stringify(cmd)}\n\n`;
  if (sse) sse.write(line);
  else pending.push(line);
}

const PAGE = (
  tok: string,
) => `<!doctype html><html><head><meta charset="utf-8"><title>Simple Coding Studio · Speaker</title></head>
<body style="font:14px Segoe UI;background:#0f172a;color:#cbd5e1">Simple Coding Studio speaker
<script>
const base = '/s/${tok}';
const post = (o) => fetch(base + '/ev', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) }).catch(() => {});
let voices = [];
function loadVoices() { voices = speechSynthesis.getVoices(); }
speechSynthesis.onvoiceschanged = loadVoices; loadVoices();
const hasNepali = () => voices.some((v) => /^ne[-_]NP$/i.test(v.lang) && !v.localService);
// Edge का online (Natural) आवाज लोड नहुन्जेल पर्खने (बढीमा ६ सेकेन्ड) — wait for Edge's online natural voices (up to 6 s).
async function voicesReady() {
  for (let i = 0; i < 60 && !hasNepali(); i++) { loadVoices(); await new Promise((r) => setTimeout(r, 100)); }
  return hasNepali();
}
// राम्रो आवाज छान्ने — pick the best natural voice for each language.
function pick(lang, gender) {
  const prefs = lang === 'ne-NP'
    ? (gender === 'male' ? ['सागर', 'Sagar', 'हेमकला', 'Hemkala'] : ['हेमकला', 'Hemkala', 'सागर', 'Sagar'])
    : (gender === 'male' ? ['Andrew Multilingual', 'Andrew', 'Brian', 'Guy'] : ['Ava Multilingual', 'Emma Multilingual', 'Ava', 'Jenny', 'Aria']);
  const same = voices.filter((v) => v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase());
  // Natural (online) आवाज मात्र; रोबोटिक पुरानो आवाज होइन — natural online voices only, never the robotic local ones.
  for (const p of prefs) { const v = same.find((x) => x.name.includes(p) && !x.localService); if (v) return v; }
  return same.find((v) => !v.localService && /Natural/i.test(v.name)) || same.find((v) => !v.localService) || null;
}
let current = null; // { id, chunks, i, rate, gender }
function next() {
  const job = current;
  if (!job) return;
  if (job.i >= job.chunks.length) { post({ type: 'end', id: job.id }); current = null; return; }
  const c = job.chunks[job.i];
  const u = new SpeechSynthesisUtterance(c.text);
  u.lang = c.lang;
  const v = pick(c.lang, job.gender);
  if (!v) {
    // मिल्ने प्राकृतिक आवाज नभए रोबोटिक आवाजमा नपढ्ने — never fall back to a robotic, wrong-accent voice.
    post({ type: 'error', id: job.id, error: c.lang === 'ne-NP' ? 'no-nepali-voice' : 'no-english-voice' });
    job.i++; next(); return;
  }
  u.voice = v;
  // नेपाली अलि ढिलो र स्पष्ट; English सामान्य गतिमा — Nepali a little slower and clearer; English at normal pace.
  u.rate = job.rate * (c.lang === 'ne-NP' ? 0.92 : 1);
  u.pitch = 1;
  u.onstart = () => { if (current === job) post({ type: 'chunk', id: job.id, index: job.i, voice: v.name }); };
  u.onboundary = (e) => { if (current === job && e.name === 'word') post({ type: 'word', id: job.id, index: job.i, charIndex: e.charIndex }); };
  u.onend = () => { if (current !== job) return; job.i++; next(); };
  u.onerror = (e) => { if (current !== job) return; if (e.error === 'interrupted' || e.error === 'canceled') return; post({ type: 'error', id: job.id, error: e.error }); job.i++; next(); };
  speechSynthesis.speak(u);
}
const es = new EventSource(base + '/cmd');
let failures = 0;
es.onopen = () => { failures = 0; };
es.onerror = () => { if (++failures >= 3) { speechSynthesis.cancel(); window.close(); } };
es.onmessage = (m) => {
  const c = JSON.parse(m.data);
  if (c.type === 'speak') {
    const old = current; current = null; speechSynthesis.cancel();
    if (old) post({ type: 'end', id: old.id, stopped: true });
    const job = { id: c.id, chunks: c.chunks, i: 0, rate: c.rate || 1, gender: c.gender || 'female' };
    current = job;
    voicesReady().then((ok) => {
      if (current !== job) return;
      if (!ok && job.chunks.some((x) => x.lang === 'ne-NP')) post({ type: 'error', id: job.id, error: 'no-nepali-voice' });
      post({ type: 'start', id: job.id, voice: (pick('ne-NP', job.gender) || {}).name || '' });
      next();
    });
  }
  if (c.type === 'stop') { const old = current; current = null; speechSynthesis.cancel(); if (old) post({ type: 'end', id: old.id, stopped: true }); }
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
      const base = `/s/${token}`;
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
          if (body.length > 20_000) req.destroy();
        });
        req.on('end', () => {
          try {
            const ev = JSON.parse(body) as SpeakerEvent;
            if (
              ['ready', 'start', 'chunk', 'word', 'end', 'error'].includes(
                ev.type,
              )
            )
              emit(ev);
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
  if (sse) return;
  if (starting) return starting;
  starting = (async () => {
    const exe = findEdge();
    if (!exe) throw new Error('no-edge');
    const port = await ensureServer();
    const profile = path.join(app.getPath('userData'), 'speaker-browser');
    browser = spawn(
      exe,
      [
        `--user-data-dir=${profile}`,
        `--app=http://127.0.0.1:${port}/s/${token}/`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-sync',
        '--window-position=-32000,-32000',
        '--window-size=360,120',
        // क्लिक बिना पनि बोल्न दिने — allow speech without a click inside the hidden window.
        '--autoplay-policy=no-user-gesture-required',
      ],
      { windowsHide: true },
    );
    browser.on('exit', () => {
      browser = null;
    });
    const t0 = Date.now();
    while (!sse && Date.now() - t0 < 15000)
      await new Promise((r) => setTimeout(r, 50));
    if (!sse) throw new Error('speaker-timeout');
  })().finally(() => {
    starting = null;
  });
  return starting;
}

export function stopSpeaker(): void {
  if (browser?.pid !== undefined && browser.exitCode === null) {
    spawn('taskkill', ['/pid', String(browser.pid), '/T', '/F'], {
      windowsHide: true,
    });
  }
  browser = null;
  server?.close();
  server = null;
}

export function registerSpeakerHandlers(): void {
  ipcMain.handle('speaker:available', () => Boolean(findEdge()));
  ipcMain.handle('speaker:prepare', async (e) => {
    target = e.sender;
    await ensureBrowser();
  });
  ipcMain.handle(
    'speaker:speak',
    async (e, id: unknown, chunks: unknown, rate: unknown, gender: unknown) => {
      target = e.sender;
      if (typeof id !== 'string' || !Array.isArray(chunks))
        throw new Error('Invalid request');
      const clean: SpeakChunk[] = chunks
        .filter(
          (c): c is SpeakChunk =>
            typeof c?.text === 'string' &&
            (c.lang === 'ne-NP' || c.lang === 'en-US'),
        )
        .slice(0, 400)
        .map((c) => ({ text: c.text.slice(0, 1000), lang: c.lang }));
      await ensureBrowser();
      command({
        type: 'speak',
        id,
        chunks: clean,
        rate: typeof rate === 'number' && rate >= 0.5 && rate <= 2 ? rate : 1,
        gender: gender === 'male' ? 'male' : 'female',
      });
    },
  );
  ipcMain.handle('speaker:stop', () => {
    command({ type: 'stop' });
  });
}
