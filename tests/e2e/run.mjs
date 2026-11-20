// Simple Coding Studio — end-to-end self-test (packaged app, isolated profile).
// Simple Coding Studio — installer बाट बनेको app को पूरा स्वचालित परीक्षण (छुट्टै profile मा)।
//
// Usage:
//   node tests/e2e/run.mjs                       # core suite (no Claude usage, no Flutter compile)
//   node tests/e2e/run.mjs --with-guru           # also ask Guru one short question (uses your Claude plan)
//   node tests/e2e/run.mjs --with-flutter=<dir>  # also "Run in Chrome" a Flutter project (opens Chrome)
//   node tests/e2e/run.mjs --repeat=3            # run the whole suite several times
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchApp } from './driver.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const exe = path.join(
  process.env.FORGE_OUT_DIR || path.join(projectRoot, 'out'),
  'Simple Coding Studio-win32-x64',
  'SimpleCodingStudio.exe',
);
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const repeat = Number(args.repeat ?? 1);

// ---------------------------------------------------------------- fixture project
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-e2e-'));
  const w = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  w('pubspec.yaml', 'name: e2e_fixture\nenvironment:\n  sdk: ^3.0.0\n');
  w(
    'lib/main.dart',
    "void main() {\n  int count = 'five'\n  print(count);\n}\n",
  );
  w('lib/ok.dart', 'int add(int a, int b) => a + b;\n');
  w('app.js', 'const name = "Bikash";\nconsole.log(nme);\n');
  w('hello.py', 'def greet(name)\n    print("Namaste", name)\n');
  w('bad_import.py', 'print("start")\nimport surely_missing_module_xyz\n');
  w(
    'sleep_e2e.py',
    'import time\nprint("running", flush=True)\ntime.sleep(300)\n',
  );
  w('data/notes.md', '# नोट\nनमस्ते संसार\n');
  fs.writeFileSync(
    path.join(dir, 'image.bin'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d, 0x49, 0x48]),
  );
  fs.writeFileSync(
    path.join(dir, 'utf16.txt'),
    Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('नमस्ते UTF-16', 'utf16le'),
    ]),
  );
  fs.writeFileSync(
    path.join(dir, 'bom.txt'),
    Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('BOM नमस्ते', 'utf8'),
    ]),
  );
  // Junction (Flutter को .plugin_symlinks जस्तै; admin बिना बन्छ) — like Flutter's plugin symlinks, no admin needed.
  fs.mkdirSync(path.join(dir, 'real_plugin', 'lib'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'real_plugin', 'lib', 'plugin.dart'),
    'void plugin() {}\n',
  );
  fs.symlinkSync(
    path.join(dir, 'real_plugin'),
    path.join(dir, 'linked_plugin'),
    'junction',
  );
  return dir;
}

// ---------------------------------------------------------------- in-page helpers
const HELPERS = `
window.__t = {
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  async until(fn, ms = 15000, step = 100) {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { try { const v = fn(); if (v) return v; } catch {} await new Promise((r) => setTimeout(r, step)); }
    return null;
  },
  async idleGuru(ms = 120000) {
    const busy = () => [...document.querySelectorAll('aside button')].some((b) => b.innerText.trim() === '⏹');
    const t0 = performance.now();
    let calm = 0;
    while (performance.now() - t0 < ms) {
      if (busy()) calm = 0; else if (++calm >= 12) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  },
  rows: () => [...document.querySelectorAll('aside li > div')],
  rowText: (d) => d.innerText.replace(/[🗑🔗]/gu, '').trim().split('\\n').pop().trim(),
  row(name) { return this.rows().find((d) => this.rowText(d) === name); },
  tabs: () => [...document.querySelectorAll('main div[title]')].map((d) => d.innerText.split('\\n')[0]).filter(Boolean),
  squiggles: () => document.querySelectorAll('.monaco-editor .squiggly-error').length,
  card: () => document.querySelector('aside [role=status]')?.innerText.split('\\n')[0] ?? '',
  toasts: [],
  watchToasts() {
    const seen = this.toasts;
    new MutationObserver(() => { for (const e of document.querySelectorAll('.fixed.bottom-8')) if (!seen.includes(e.innerText)) seen.push(e.innerText); })
      .observe(document.documentElement, { childList: true, subtree: true });
  },
  async open(name) {
    const r = await this.until(() => this.row(name), 8000);
    if (!r) throw new Error('row not found: ' + name);
    r.click();
    await this.wait(400);
  },
};
window.__t.watchToasts();
'ok'`;

// ---------------------------------------------------------------- tests
function tests(fixture) {
  const fx = JSON.stringify(fixture);
  return [
    {
      name: 'App starts and renders',
      run: async (p) => {
        const len = await p.eval(
          `__t.until(() => document.getElementById('root')?.innerText.length > 50, 30000).then(Boolean)`,
        );
        if (!len) throw new Error('UI did not render');
      },
    },
    {
      name: 'UI language switch (ने / EN / ने+EN)',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          const pick = (l) => [...document.querySelectorAll('[role=radio]')].find((b) => b.innerText.trim() === l).click();
          const head = () => [...document.querySelectorAll('header button')].map((b) => b.textContent).join(' ');
          pick('EN'); await __t.wait(250); const en = head();
          pick('ने'); await __t.wait(250); const ne = head();
          pick('ने+EN'); await __t.wait(250); const both = head();
          return { en: en.includes('Open') && !en.includes('खोल'), ne: ne.includes('खोल') && !/\\bOpen\\b/.test(ne), both: both.includes('खोल · Open') };
        })()`);
        if (!r.en || !r.ne || !r.both) throw new Error(JSON.stringify(r));
      },
    },
    {
      name: 'Open folder: tree, nested folders, junction folder 🔗',
      run: async (p) => {
        await p.eval(
          `(async () => { localStorage.setItem('studio.recentProjects', JSON.stringify([${fx}])); return 1; })()`,
        );
        await p.reload();
        await new Promise((r) => setTimeout(r, 2500));
        await p.eval(HELPERS);
        const r = await p.eval(`(async () => {
          const btn = await __t.until(() => [...document.querySelectorAll('button')].find((x) => x.title === ${fx}), 15000);
          btn.click();
          await __t.until(() => __t.row('lib'), 10000);
          const top = __t.rows().map(__t.rowText);
          await __t.open('linked_plugin');
          await __t.open('lib');
          const linkIsFolder = __t.rows().some((d) => d.innerText.includes('linked_plugin') && d.innerText.includes('🔗') && d.innerText.includes('📂'));
          return { top, linkIsFolder, kind: [...document.querySelectorAll('header span')].map((s) => s.innerText).find((t) => /Dart|Flutter|Folder/.test(t)) };
        })()`);
        for (const want of [
          'lib',
          'data',
          'linked_plugin',
          'real_plugin',
          'app.js',
          'hello.py',
          'pubspec.yaml',
        ]) {
          if (!r.top.includes(want))
            throw new Error(`missing ${want} in tree: ${r.top.join(', ')}`);
        }
        if (!r.linkIsFolder)
          throw new Error('junction folder did not open as a folder');
        if (!/Dart/.test(r.kind ?? ''))
          throw new Error('project kind not detected: ' + r.kind);
      },
    },
    {
      name: 'Click-to-open: text, UTF-8 BOM, UTF-16; binary refused politely',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          await __t.open('utf16.txt'); await __t.wait(800);
          const utf16 = document.querySelector('.view-line')?.innerText.replace(/ /g, ' ');
          await __t.open('bom.txt'); await __t.wait(800);
          const bom = document.querySelector('.view-line')?.innerText.replace(/ /g, ' ');
          __t.toasts.length = 0;
          await __t.open('image.bin'); await __t.wait(800);
          return { utf16, bom, tabs: __t.tabs(), toast: __t.toasts.join(' | ') };
        })()`);
        if (!r.utf16?.includes('नमस्ते UTF-16'))
          throw new Error('UTF-16 text wrong: ' + r.utf16);
        if (r.bom?.replace(/﻿/g, '') !== 'BOM नमस्ते')
          throw new Error('BOM text wrong: ' + JSON.stringify(r.bom));
        if (r.tabs.includes('image.bin'))
          throw new Error('binary file opened as a tab');
        if (!/binary/i.test(r.toast))
          throw new Error('no friendly binary message: ' + r.toast);
      },
    },
    {
      name: 'Save keeps the file encoding (UTF-16 / BOM)',
      run: async (p) => {
        await p.eval(`(async () => {
          await window.studio.readFile(${JSON.stringify(path.join(fixture, 'utf16.txt'))});
          await window.studio.writeFile(${JSON.stringify(path.join(fixture, 'utf16.txt'))}, 'नमस्ते UTF-16 saved');
          await window.studio.readFile(${JSON.stringify(path.join(fixture, 'bom.txt'))});
          await window.studio.writeFile(${JSON.stringify(path.join(fixture, 'bom.txt'))}, 'BOM saved');
          return 1;
        })()`);
        const u = fs.readFileSync(path.join(fixture, 'utf16.txt'));
        const b = fs.readFileSync(path.join(fixture, 'bom.txt'));
        if (
          !(u[0] === 0xff && u[1] === 0xfe) ||
          u.subarray(2).toString('utf16le') !== 'नमस्ते UTF-16 saved'
        )
          throw new Error('UTF-16 not preserved');
        if (
          !(b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) ||
          b.subarray(3).toString('utf8') !== 'BOM saved'
        )
          throw new Error('BOM not preserved');
      },
    },
    {
      name: 'Inline errors: JavaScript (Monaco)',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          await __t.open('app.js');
          const t0 = performance.now();
          const ok = await __t.until(() => __t.squiggles() > 0 && /app\\.js/.test(__t.card()), 15000);
          return { ok: Boolean(ok), ms: Math.round(performance.now() - t0), card: __t.card() };
        })()`);
        if (!r.ok) throw new Error('no JS error shown: ' + r.card);
        return `${r.ms} ms — ${r.card}`;
      },
    },
    {
      name: 'Inline errors: Python syntax',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          await __t.open('hello.py');
          const t0 = performance.now();
          const ok = await __t.until(() => __t.squiggles() > 0 && /hello\\.py/.test(__t.card()), 15000);
          return { ok: Boolean(ok), ms: Math.round(performance.now() - t0), card: __t.card() };
        })()`);
        if (!r.ok) throw new Error('no Python error shown: ' + r.card);
        return `${r.ms} ms — ${r.card}`;
      },
    },
    {
      name: 'Inline errors: Dart analysis server',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          await __t.open('main.dart');
          const t0 = performance.now();
          const ok = await __t.until(() => __t.squiggles() > 0 && /main\\.dart/.test(__t.card()), 45000);
          return { ok: Boolean(ok), ms: Math.round(performance.now() - t0), card: __t.card() };
        })()`);
        if (!r.ok) throw new Error('no Dart error shown: ' + r.card);
        return `${r.ms} ms (includes analysis-server start) — ${r.card}`;
      },
    },
    {
      name: 'Error card follows the active tab',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          const tab = (n) => [...document.querySelectorAll('main div[title]')].find((d) => d.innerText.split('\\n')[0] === n);
          const seen = [];
          for (const n of ['app.js', 'hello.py', 'main.dart', 'app.js']) { tab(n).click(); await __t.wait(400); seen.push([n, __t.card()]); }
          return seen;
        })()`);
        for (const [n, c] of r)
          if (!c.includes(n)) throw new Error(`card for ${n} showed: ${c}`);
      },
    },
    {
      name: 'Ctrl+P quick open',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));
          const qi = await __t.until(() => document.querySelector('[role=dialog][aria-label="Quick open"] input'), 5000);
          await __t.until(() => !/Indexing|खोज्दै/.test(document.querySelector('[role=dialog]').innerText), 10000);
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(qi, 'notes');
          qi.dispatchEvent(new Event('input', { bubbles: true }));
          await __t.wait(250);
          const top = document.querySelector('[role=dialog] li button')?.innerText;
          qi.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          await __t.wait(1000);
          return { top, tabs: __t.tabs(), dialogGone: !document.querySelector('[role=dialog][aria-label="Quick open"]') };
        })()`);
        if (
          !r.top?.includes('notes.md') ||
          !r.tabs.includes('notes.md') ||
          !r.dialogGone
        )
          throw new Error(JSON.stringify(r));
      },
    },
    {
      name: 'Status bar: project, save, run and Git status',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          const bar = document.querySelector('[data-testid=status-bar]');
          const st = (k) => bar?.querySelector('[data-status=' + k + ']')?.textContent ?? null;
          return { bar: bar?.innerText ?? '', save: st('save'), run: st('run'), git: st('git') };
        })()`);
        if (!r.bar.includes(path.basename(fixture)))
          throw new Error('project name missing: ' + r.bar);
        if (!r.save || !r.run || !r.git)
          throw new Error('missing status parts: ' + JSON.stringify(r));
        if (!/Git/.test(r.git)) throw new Error('git text: ' + r.git);
        return `${r.save} | ${r.run} | ${r.git}`;
      },
    },
    {
      name: 'New Flutter app: starter picker (3 templates)',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          const btn = [...document.querySelectorAll('header button')].find((b) => b.textContent.includes('✨'));
          btn.click();
          const dlg = await __t.until(() => document.querySelector('[role=dialog] [role=radiogroup]'), 5000);
          if (!dlg) return { error: 'no dialog' };
          const radios = [...dlg.querySelectorAll('[role=radio]')];
          const ids = radios.map((x) => x.dataset.template);
          const before = radios.map((x) => x.getAttribute('aria-checked'));
          radios.find((x) => x.dataset.template === 'map').click();
          await __t.wait(150);
          const after = [...dlg.querySelectorAll('[role=radio]')].map((x) => x.getAttribute('aria-checked'));
          const hasName = Boolean(document.querySelector('[role=dialog] input'));
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await __t.wait(250);
          return { ids, before, after, hasName, closed: !document.querySelector('[role=dialog]') };
        })()`);
        if (r.error) throw new Error(r.error);
        if (r.ids.join() !== 'basic,firebase,map')
          throw new Error('templates: ' + r.ids);
        if (
          r.before.join() !== 'true,false,false' ||
          r.after.join() !== 'false,false,true'
        )
          throw new Error('selection: ' + JSON.stringify(r));
        if (!r.hasName || !r.closed) throw new Error(JSON.stringify(r));
      },
    },
    {
      name: 'Guru quick-action buttons sit below the input',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          const row = document.querySelector('aside [data-testid=quick-actions]');
          const ta = document.querySelector('aside textarea');
          if (!row || !ta) return { error: 'missing row or textarea' };
          const labels = [...row.querySelectorAll('button')].map((b) => b.textContent.trim());
          const below = row.getBoundingClientRect().top >= ta.getBoundingClientRect().bottom - 1;
          [...row.querySelectorAll('button')].find((b) => b.textContent.includes('🧩')).click();
          await __t.wait(300);
          const filled = ta.value;
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, '');
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return { labels, below, filled };
        })()`);
        if (r.error) throw new Error(r.error);
        if (r.labels.length !== 3 || !r.below)
          throw new Error(JSON.stringify(r));
        for (const want of [
          'यो फाइल बुझाऊ',
          'एरर खोज र ठीक गर',
          'नयाँ विजेट/रूट बनाऊ',
        ])
          if (!r.labels.some((l) => l.includes(want)))
            throw new Error('label missing: ' + want);
        if (!r.filled.startsWith('नयाँ widget/route बनाऊ'))
          throw new Error('widget button did not prefill: ' + r.filled);
      },
    },
    {
      name: 'Run a file: error → Fix Tip with file and line',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          localStorage.setItem('studio.guruAutoExplain', 'off');
          await __t.open('bad_import.py');
          await __t.wait(800);
          const sel = document.querySelector('header select');
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'run-file');
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          await __t.wait(300);
          [...document.querySelectorAll('header button')].find((b) => b.className.includes('btn-run')).click();
          const note = await __t.until(() => document.querySelector('[role=note]'), 20000);
          return note ? note.innerText.replace(/\\s+/g, ' ').slice(0, 200) : null;
        })()`);
        if (
          !r ||
          !/ModuleNotFoundError/.test(r) ||
          !/bad_import\.py/.test(r) ||
          !/2/.test(r)
        )
          throw new Error('Fix Tip missing/wrong: ' + r);
        return r.slice(0, 120);
      },
    },
    {
      name: 'Voice typing service (Web Speech API, ne-NP) starts and stops',
      run: async (p) => {
        const r = await p.eval(
          `(async () => {
          const ev = [];
          const off = window.studio.onDictationEvent((e) => ev.push(e.type + (e.error ? ':' + e.error : '')));
          const available = await window.studio.dictationAvailable();
          await window.studio.dictationStart('ne-NP');
          await __t.until(() => ev.includes('start'), 15000);
          await __t.wait(800);
          await window.studio.dictationStop();
          await __t.until(() => ev.includes('end'), 8000);
          off();
          return { available, ev };
        })()`,
          60000,
        );
        if (!r.available) throw new Error('Chrome/Edge not found');
        if (!r.ev.includes('start') || !r.ev.includes('end'))
          throw new Error('events: ' + r.ev.join(','));
        const errs = r.ev.filter((e) => e.startsWith('error'));
        if (errs.length) throw new Error('errors: ' + errs.join(','));
      },
    },
    {
      name: 'Speaker: natural ne-NP and en-US voices, stop works',
      run: async (p) => {
        const r = await p.eval(
          `(async () => {
          const ev = [];
          const off = window.studio.onSpeakerEvent((e) => { if (e.type !== 'word') ev.push(e.type + (e.voice ? '|' + e.voice : '') + (e.error ? '!' + e.error : '') + (e.stopped ? '(stopped)' : '')); });
          await window.studio.speak('e2e1', [{ text: 'नमस्ते। म तपाईंको गुरु हुँ।', lang: 'ne-NP' }, { text: 'Hello, I am your tutor.', lang: 'en-US' }], 1, 'female');
          await __t.until(() => ev.some((e) => e.startsWith('end')), 30000);
          await window.studio.speak('e2e2', [{ text: 'यो लामो वाक्य हो जुन बीचमै रोकिनेछ, किनभने हामी stop बटन जाँच्दैछौं।', lang: 'ne-NP' }], 1, 'female');
          const firstEnd = ev.findIndex((x) => x.startsWith('end'));
          await __t.until(() => ev.some((e, i) => i > firstEnd && e.startsWith('chunk')), 15000);
          await __t.wait(600);
          await window.studio.stopSpeaking();
          await __t.wait(800);
          off();
          return ev;
        })()`,
          90000,
        );
        const chunks = r.filter((e) => e.startsWith('chunk'));
        // पूर्वनिर्धारित Google नेपाली; Google नचले हेमकला — Google Nepali by default, Hemkala if Google fails.
        if (!/Google नेपाली|हेमकला|Hemkala/.test(chunks[0] ?? ''))
          throw new Error('Nepali chunk voice: ' + chunks[0]);
        if (
          !/Natural/.test(chunks[1] ?? '') ||
          !/English/.test(chunks[1] ?? '')
        )
          throw new Error('English chunk voice: ' + chunks[1]);
        if (!r.some((e) => e === 'end(stopped)'))
          throw new Error('stop did not end playback: ' + r.join(' , '));
        if (r.some((e) => e.includes('!')))
          throw new Error('speaker errors: ' + r.join(' , '));
        return chunks
          .slice(0, 2)
          .map((c) => c.split('|')[1]?.replace(/Microsoft | Online.*$/g, ''))
          .join(' + ');
      },
    },
    ...(args['with-guru']
      ? [
          {
            name: 'Guru (Claude Code) answers in Nepali + English',
            run: async (p) => {
              const r = await p.eval(
                `(async () => {
                await __t.idleGuru();
                const ta = document.querySelector('aside textarea');
                Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'print() ले के गर्छ? एक वाक्य नेपाली, एक वाक्य English।');
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                await __t.wait(200);
                const before = document.querySelectorAll('aside .md-body').length;
                (await __t.until(() => [...document.querySelectorAll('aside button')].find((b) => b.innerText.trim() === '➤' && !b.disabled), 120000, 250)).click();
                const t0 = performance.now();
                await __t.until(() => document.querySelectorAll('aside .md-body').length > before && ![...document.querySelectorAll('aside button')].some((b) => b.innerText.trim() === '⏹'), 120000, 250);
                const a = [...document.querySelectorAll('aside .md-body')].pop()?.innerText ?? '';
                return { ms: Math.round(performance.now() - t0), a: a.slice(0, 160), speaker: [...document.querySelectorAll('aside button[aria-label^="Read aloud"]')].length };
              })()`,
                150000,
              );
              if (!/[ऀ-ॿ]/.test(r.a) || !/[A-Za-z]{4}/.test(r.a))
                throw new Error('answer not bilingual: ' + r.a);
              if (r.speaker < 1)
                throw new Error('no speaker button under the answer');
              return `${r.ms} ms`;
            },
          },
          {
            name: 'One-click fix: Guru fix → diff preview → apply to file',
            run: async (p) => {
              const r = await p.eval(
                `(async () => {
                await __t.idleGuru();
                await __t.open('main.dart');
                await __t.until(() => __t.squiggles() > 0, 45000);
                const code = () => document.querySelector('.monaco-editor .view-lines')?.innerText ?? '';
                const before = code();
                [...document.querySelectorAll('aside [data-testid=quick-actions] button')].find((b) => b.textContent.includes('🛠')).click();
                const view = await __t.until(() => document.querySelector('[data-testid=diff-view]'), 150000, 300);
                if (!view) return { error: 'diff dialog never opened' };
                const diffText = view.innerText;
                const apply = [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.includes('✅'));
                apply.click();
                await __t.wait(800);
                const after = code();
                return { before, after, diffText: diffText.slice(0, 300), closed: !document.querySelector('[data-testid=diff-view]') };
              })()`,
                200000,
              );
              if (r.error) throw new Error(r.error);
              if (!/^[+−]/m.test(r.diffText))
                throw new Error('empty diff: ' + r.diffText);
              if (!r.closed) throw new Error('dialog did not close');
              if (!r.before || !r.after || r.before === r.after)
                throw new Error('file not changed by apply');
              return `diff ok, file changed (${r.before.length} → ${r.after.length} chars)`;
            },
          },
        ]
      : []),
    ...(args['with-flutter']
      ? [
          {
            name: 'Run in Chrome (flutter run -d chrome)',
            run: async (p) => {
              const root = JSON.stringify(
                path.resolve(String(args['with-flutter'])),
              );
              const r = await p.eval(`(async () => {
                const proj = await window.studio.openRecentFolder(${root});
                localStorage.setItem('studio.recentProjects', JSON.stringify([${root}]));
                return Boolean(proj);
              })()`);
              if (!r) throw new Error('cannot open flutter project');
              await p.reload();
              await new Promise((res) => setTimeout(res, 2500));
              await p.eval(HELPERS);
              const run = await p.eval(
                `(async () => {
                (await __t.until(() => [...document.querySelectorAll('button')].find((x) => x.title === ${root}), 15000)).click();
                await __t.until(() => document.querySelector('header select'), 10000);
                const sel = document.querySelector('header select');
                Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'flutter-web');
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                await __t.wait(300);
                [...document.querySelectorAll('header button')].find((b) => b.className.includes('btn-run')).click();
                const t0 = performance.now();
                const ok = await __t.until(() => [...document.querySelectorAll('button')].some((b) => b.innerText.includes('Hot reload')), 300000, 500);
                const secs = Math.round((performance.now() - t0) / 1000);
                [...document.querySelectorAll('button')].find((b) => /Stop|रोक/.test(b.innerText) && b.className.includes('chip'))?.click();
                const stopped = await __t.until(() => /तपाईंले रोक्नुभयो|Stopped by you/.test(document.querySelector('.font-mono')?.innerText.slice(-200) ?? ''), 20000);
                return { ok: Boolean(ok), secs, stopped: Boolean(stopped) };
              })()`,
                360000,
              );
              if (!run.ok) throw new Error('app was not served in Chrome');
              if (!run.stopped) throw new Error('Stop did not end the run');
              return `served in ${run.secs} s, stopped cleanly`;
            },
          },
        ]
      : []),
  ];
}

// ---------------------------------------------------------------- helpers for cleanup checks
function helperProcesses(userDataDir) {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${userDataDir.replace(/'/g, "''")}') -and $_.Name -ne 'SimpleCodingStudio.exe' -and $_.Name -ne 'powershell.exe' -and $_.ProcessId -ne $PID }).Count`,
      ],
      { encoding: 'utf8' },
    );
    return Number(out.trim());
  } catch {
    return -1;
  }
}

// एप अचानक मारिँदा छुटेको process अर्को पटक खोल्दा सफा हुन्छ? — after a hard kill, does the next start clean up?
function pidsOf(match) {
  const out = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `@(Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and $_.CommandLine -and $_.CommandLine.Contains('${match}') }).ProcessId -join ','`,
    ],
    { encoding: 'utf8' },
  ).trim();
  return out ? out.split(',').map(Number) : [];
}
async function crashRecovery(fixture, userDataDir, port) {
  const { child, page } = await launchApp({ exe, port, userDataDir });
  for (let i = 0; i < 100; i++) {
    if (
      await page
        .eval(
          `Boolean(document.body && document.getElementById('root') && document.readyState === 'complete')`,
        )
        .catch(() => false)
    )
      break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await page.eval(HELPERS);
  const fx = JSON.stringify(fixture);
  const ok = await page.eval(`(async () => {
    (await __t.until(() => [...document.querySelectorAll('button')].find((x) => x.title === ${fx}), 15000)).click();
    await __t.open('sleep_e2e.py'); await __t.wait(600);
    const sel = document.querySelector('header select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'run-file');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await __t.wait(300);
    [...document.querySelectorAll('header button')].find((b) => b.className.includes('btn-run')).click();
    return Boolean(await __t.until(() => /running/.test(document.querySelector('.font-mono')?.innerText ?? ''), 20000));
  })()`);
  page.close();
  if (!ok) {
    child.kill();
    throw new Error('long-running script did not start');
  }
  const before = pidsOf(path.join(fixture, 'sleep_e2e.py'));
  execFileSync('taskkill', ['/PID', String(child.pid), '/F']); // only the app, not its children — like a crash
  await new Promise((r) => setTimeout(r, 1500));
  const orphaned = pidsOf(path.join(fixture, 'sleep_e2e.py'));
  if (!before.length || !orphaned.length)
    throw new Error('could not reproduce an orphan (before=' + before + ')');
  const again = await launchApp({ exe, port: port + 1, userDataDir });
  let left = orphaned;
  for (let i = 0; i < 40 && left.length; i++) {
    await new Promise((r) => setTimeout(r, 500));
    left = pidsOf(path.join(fixture, 'sleep_e2e.py'));
  }
  await again.page.eval('window.close(), 1', 5000).catch(() => {});
  again.page.close();
  const t0 = Date.now();
  while (again.child.exitCode === null && Date.now() - t0 < 15000)
    await new Promise((r) => setTimeout(r, 200));
  if (again.child.exitCode === null) again.child.kill();
  if (left.length) {
    execFileSync('taskkill', ['/PID', String(left[0]), '/T', '/F']);
    throw new Error('orphan still running after restart: ' + left);
  }
  return `orphan PID ${orphaned[0]} removed on next start`;
}

// ---------------------------------------------------------------- main
if (!fs.existsSync(exe)) {
  console.error(
    'Packaged app not found. Run `npm.cmd run make` (or `npm.cmd run package`) first:',
    exe,
  );
  process.exit(2);
}
let failures = 0;
for (let round = 1; round <= repeat; round++) {
  const fixture = makeFixture();
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'studio-e2e-profile-'),
  );
  const port = 9400 + round;
  console.log(`\n=== Round ${round}/${repeat} — fixture ${fixture}`);
  const { child, page } = await launchApp({ exe, port, userDataDir });
  for (let i = 0; i < 100; i++) {
    const ready = await page
      .eval(
        `Boolean(document.body && document.getElementById('root') && document.readyState === 'complete')`,
      )
      .catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await page.eval(HELPERS);
  {
    // दोस्रो पटक खोल्दा नयाँ copy नचली पहिलेकै window अगाडि आउँछ — a second launch must exit and focus the first.
    const t1 = Date.now();
    const second = spawn(exe, [`--user-data-dir=${userDataDir}`], {
      stdio: 'ignore',
    });
    second.on('error', () => {});
    while (second.exitCode === null && Date.now() - t1 < 15000)
      await new Promise((r) => setTimeout(r, 200));
    const alive = await page.eval('1', 5000).catch(() => 0);
    if (second.exitCode === null) {
      second.kill();
      failures++;
      console.log('  FAIL  Single instance — a second copy kept running');
    } else if (!alive) {
      failures++;
      console.log(
        '  FAIL  Single instance — the first window stopped responding',
      );
    } else {
      console.log(
        `  PASS  Single instance: second launch hands over and exits  (${Date.now() - t1} ms)`,
      );
    }
  }
  for (const t of tests(fixture)) {
    const t0 = Date.now();
    try {
      const note = await t.run(page);
      console.log(
        `  PASS  ${t.name}  (${Date.now() - t0} ms)${note ? '  — ' + note : ''}`,
      );
    } catch (err) {
      failures++;
      console.log(
        `  FAIL  ${t.name}  (${Date.now() - t0} ms)\n        ${String(err.message ?? err).slice(0, 400)}`,
      );
    }
  }
  // App बन्द गर्दा सहायक process (Chrome/Edge/dart) बाँकी नरहून् — closing the app must leave no helper processes.
  try {
    await page.eval('window.close(), 1', 5000);
  } catch {
    // the page goes away while closing
  }
  page.close();
  const t0 = Date.now();
  while (child.exitCode === null && Date.now() - t0 < 15000)
    await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 6000));
  const left = helperProcesses(userDataDir);
  if (child.exitCode === null) {
    failures++;
    console.log('  FAIL  App closes cleanly — still running');
    child.kill();
  } else if (left > 0) {
    failures++;
    console.log(
      `  FAIL  App closes cleanly — ${left} helper process(es) left behind`,
    );
  } else {
    console.log('  PASS  App closes cleanly, no helper processes left');
  }
  // थाहा भएको सीमा: एप जबरजस्ती मारिँदा चलिरहेको run बाँकी रहन सक्छ (antivirus-सुरक्षित रहन PowerShell सफाइ हटाइयो)।
  // Known limit, opt-in: a hard-killed app can leave its run behind (PowerShell cleanup removed to stay antivirus-safe).
  if (args['with-crash']) {
    const t1 = Date.now();
    try {
      const note = await crashRecovery(fixture, userDataDir, port + 50);
      console.log(
        `  PASS  Crash recovery: leftover run is cleaned on next start  (${Date.now() - t1} ms)  — ${note}`,
      );
    } catch (err) {
      failures++;
      console.log(`  FAIL  Crash recovery  (${Date.now() - t1} ms)
        ${String(err.message ?? err).slice(0, 400)}`);
    }
  }
  fs.rmSync(fixture, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} failure(s)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
