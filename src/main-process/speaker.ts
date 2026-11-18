import { app, ipcMain, net, type WebContents } from 'electron';
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
let current = null; // { id, chunks, i, rate, gender, engine, googleFailed }
// लुकेको window मा <audio> लोड हुँदैन, त्यसैले Web Audio (डाउनलोड → decode → बजाउने) प्रयोग गर्ने।
// Hidden windows defer <audio> loading, so play through Web Audio (download → decode → play) instead.
let actx = null;
let source = null;
let pulseTimer = 0;
function audioCtx() { if (!actx) actx = new AudioContext(); if (actx.state === 'suspended') actx.resume(); return actx; }
function stopAudio() { clearInterval(pulseTimer); if (source) { source.onended = null; try { source.stop(); } catch (e) {} source = null; } }
function stopAll() { speechSynthesis.cancel(); stopAudio(); }
// Google को नेपाली आवाजले एकपटकमा करिब २०० अक्षर मात्र लिन्छ: वाक्य/अल्पविराम/खाली ठाउँमा टुक्र्याउने।
// Google's Nepali voice takes about 200 characters at a time: split at sentence, comma or space boundaries.
function pieces(text) {
  const out = []; let rest = text.trim();
  while (rest.length > 180) {
    let cut = -1;
    for (const re of [/[।.!?]\\s/g, /[,;:]\\s/g, /\\s/g]) {
      let m; re.lastIndex = 0;
      while ((m = re.exec(rest)) && m.index < 180) cut = m.index + 1;
      if (cut > 40) break;
    }
    if (cut <= 0) cut = 180;
    out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
const ttsUrl = (q) => base + '/tts?q=' + encodeURIComponent(q);
// 🇳🇵 Google (Translate जस्तै) नेपाली आवाज; नचले हेमकलामा — Google's Nepali voice (as in Translate); Hemkala if it fails.
function load(q) {
  return fetch(ttsUrl(q)).then((r) => { if (!r.ok) throw new Error('tts ' + r.status); return r.arrayBuffer(); })
    .then((b) => audioCtx().decodeAudioData(b));
}
function playGoogle(job, c) {
  const parts = pieces(c.text);
  let k = 0, announced = false;
  // अर्को टुक्रा पहिल्यै ल्याउने ताकि बीचमा रोकिँदैन — fetch the next piece ahead so there is no gap.
  const pending = parts.map(() => null);
  const get = (n) => { if (n < parts.length && !pending[n]) pending[n] = load(parts[n]); return pending[n]; };
  const fail = () => {
    if (current !== job) return;
    // इन्टरनेट/Google नचले बाँकी नेपाली हेमकलामा — without Google, read the rest of the Nepali with Hemkala.
    stopAudio(); job.googleFailed = true;
    speakSynth(job, { text: parts.slice(k).join(' '), lang: 'ne-NP' });
  };
  const playPart = () => {
    if (current !== job) return;
    if (k >= parts.length) { stopAudio(); job.i++; next(); return; }
    get(k + 1);
    get(k).then((buf) => {
      if (current !== job) return;
      const ctx = audioCtx();
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = job.rate;
      s.connect(ctx.destination);
      s.onended = () => { if (current !== job || source !== s) return; clearInterval(pulseTimer); source = null; k++; playPart(); };
      source = s;
      s.start();
      if (!announced) { announced = true; post({ type: 'chunk', id: job.id, index: job.i, voice: 'Google नेपाली (ne-NP)' }); }
      clearInterval(pulseTimer);
      pulseTimer = setInterval(() => { if (current === job) post({ type: 'word', id: job.id, index: job.i, charIndex: 0 }); }, 200);
    }).catch(fail);
  };
  playPart();
}
function speakSynth(job, c) {
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
function next() {
  const job = current;
  if (!job) return;
  if (job.i >= job.chunks.length) { post({ type: 'end', id: job.id }); current = null; return; }
  const c = job.chunks[job.i];
  if (c.lang === 'ne-NP' && job.engine === 'google' && !job.googleFailed) playGoogle(job, c);
  else speakSynth(job, c);
}
const es = new EventSource(base + '/cmd');
let failures = 0;
es.onopen = () => { failures = 0; };
es.onerror = () => { if (++failures >= 3) { stopAll(); window.close(); } };
es.onmessage = (m) => {
  const c = JSON.parse(m.data);
  if (c.type === 'speak') {
    const old = current; current = null; stopAll();
    if (old) post({ type: 'end', id: old.id, stopped: true });
    const job = { id: c.id, chunks: c.chunks, i: 0, rate: c.rate || 1, gender: c.gender || 'female', engine: c.engine === 'microsoft' ? 'microsoft' : 'google', googleFailed: false };
    current = job;
    voicesReady().then((ok) => {
      if (current !== job) return;
      if (!ok && job.engine !== 'google' && job.chunks.some((x) => x.lang === 'ne-NP')) post({ type: 'error', id: job.id, error: 'no-nepali-voice' });
      post({ type: 'start', id: job.id, voice: job.engine === 'google' ? 'Google नेपाली (ne-NP)' : (pick('ne-NP', job.gender) || {}).name || '' });
      next();
    });
  }
  if (c.type === 'stop') { const old = current; current = null; stopAll(); if (old) post({ type: 'end', id: old.id, stopped: true }); }
};
post({ type: 'ready' });
</script></body></html>`;

// 🇳🇵 Google Translate को नेपाली आवाज (ne): मान्छेले बोलेजस्तो प्राकृतिक लवज। केवल Guru को व्याख्याको पाठ जान्छ।
// Google Translate's Nepali voice (ne), a natural human-like accent. Only the text of Guru's explanation is sent.
const ttsCache = new Map<string, Buffer>();
async function googleTts(text: string): Promise<Buffer> {
  const q = text.trim().slice(0, 200);
  if (!q) throw new Error('empty');
  const hit = ttsCache.get(q);
  if (hit) return hit;
  const url =
    'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ne&q=' +
    encodeURIComponent(q);
  const r = await net.fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok || !/audio/.test(r.headers.get('content-type') ?? ''))
    throw new Error('tts ' + r.status);
  const mp3 = Buffer.from(await r.arrayBuffer());
  if (ttsCache.size > 300)
    ttsCache.delete(ttsCache.keys().next().value as string);
  ttsCache.set(q, mp3);
  return mp3;
}

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
      } else if (sub.startsWith('/tts?')) {
        const q = new URLSearchParams(sub.slice(5)).get('q') ?? '';
        void googleTts(q)
          .then((mp3) => {
            res.writeHead(200, {
              'content-type': 'audio/mpeg',
              'content-length': mp3.length,
              'cache-control': 'no-store',
            });
            res.end(mp3);
          })
          .catch(() => res.writeHead(502).end());
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
        // लुकेको window लाई "पृष्ठभूमि" भनेर ढिलो/बन्द नगर्ने — do not throttle or suspend the hidden window.
        '--disable-background-media-suspend',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
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
    async (
      e,
      id: unknown,
      chunks: unknown,
      rate: unknown,
      gender: unknown,
      engine: unknown,
    ) => {
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
        engine: engine === 'microsoft' ? 'microsoft' : 'google',
      });
    },
  );
  ipcMain.handle('speaker:stop', () => {
    command({ type: 'stop' });
  });
}
