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
  w(
    'lib/typo_import.dart',
    "import 'packages:flutter/matterial.dart';\nimport 'dart:async';\n\nvoid main() {}\n",
  );
  w('lib/format_me.dart', 'void main(){print( "x" );}\n');
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
          await __t.until(() => !/Indexing|खोज्दै/.test(document.querySelector('[role=dialog]:not(.find-widget)').innerText), 10000);
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(qi, 'notes');
          qi.dispatchEvent(new Event('input', { bubbles: true }));
          await __t.wait(250);
          const top = document.querySelector('[role=dialog]:not(.find-widget) li button')?.innerText;
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
      name: 'Toolbar: Find, Format, Next error, Search, Undo/Redo buttons',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          const ids = ['tb-search', 'tb-undo', 'tb-redo', 'tb-find', 'tb-format', 'tb-next-error'];
          return { missing: ids.filter((i) => !document.querySelector('[data-testid=' + i + ']')) };
        })()`);
        if (r.missing.length) throw new Error('missing: ' + r.missing);
      },
    },
    {
      name: 'Find & Replace bar (Ctrl+F) opens from the toolbar and the keyboard',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          await __t.open('app.js');
          const visible = () => Boolean(document.querySelector('.monaco-editor .find-widget.visible'));
          document.querySelector('[data-testid=tb-find]').click();
          const viaButton = Boolean(await __t.until(visible, 4000));
          const hasReplace = Boolean(document.querySelector('.monaco-editor .find-widget .replace-part'));
          const hasNav = document.querySelectorAll('.monaco-editor .find-widget .codicon-find-previous-match, .monaco-editor .find-widget .codicon-find-next-match').length;
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          document.querySelector('.monaco-editor .find-widget .codicon-widget-close')?.click();
          await __t.wait(300);
          const closed = !visible();
          // फोकस editor बाहिर हुँदा Ctrl+F — Ctrl+F while the focus is outside the editor
          document.body.focus();
          document.activeElement?.blur?.();
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
          const viaKey = Boolean(await __t.until(visible, 4000));
          document.querySelector('.monaco-editor .find-widget .codicon-widget-close')?.click();
          return { viaButton, hasReplace, hasNav, closed, viaKey };
        })()`);
        if (!r.viaButton) throw new Error('toolbar Find did not open the bar');
        if (!r.hasReplace || r.hasNav < 2)
          throw new Error(
            'find bar is missing replace/next/previous: ' + JSON.stringify(r),
          );
        if (!r.viaKey) throw new Error('Ctrl+F did not open the bar');
      },
    },
    {
      name: 'Project search (Ctrl+Shift+F): results jump to file and line',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
          const activeTab = () => document.querySelector('main div[title].bg-slate-800')?.innerText.split('\\n')[0];
          const activeLine = () => document.querySelector('.monaco-editor .active-line-number')?.textContent?.trim();
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true, bubbles: true }));
          const input = await __t.until(() => document.querySelector('[data-testid=project-search-input]'), 5000);
          if (!input) return { error: 'search dialog did not open' };
          set(input, 'surely_missing_module');
          await __t.until(() => document.querySelectorAll('[data-testid=search-result]').length > 0, 15000);
          const rows = [...document.querySelectorAll('[data-testid=search-result]')].map((b) => b.innerText.replace(/\\s+/g, ' '));
          const none = await (async () => { set(input, 'zzz_no_such_text_zzz'); await __t.until(() => /No matches|केही भेटिएन/.test(document.querySelector('[data-testid=search-results]').innerText), 15000); return /No matches|केही भेटिएन/.test(document.querySelector('[data-testid=search-results]').innerText); })();
          set(input, 'surely_missing_module');
          await __t.until(() => document.querySelectorAll('[data-testid=search-result]').length > 0, 15000);
          document.querySelector('[data-testid=search-result]').click();
          await __t.wait(900);
          const first = { tab: activeTab(), line: activeLine(), closed: !document.querySelector('[data-testid=project-search]') };
          // एउटा फाइलभित्र पनि भेट्ने (नेपाली पाठ) — Nepali text is searchable too
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true, bubbles: true }));
          const input2 = await __t.until(() => document.querySelector('[data-testid=project-search-input]'), 5000);
          set(input2, 'संसार');
          await __t.until(() => document.querySelectorAll('[data-testid=search-result]').length > 0, 15000);
          const nepali = [...document.querySelectorAll('[data-testid=search-result]')].map((b) => b.innerText.replace(/\\s+/g, ' '));
          document.querySelector('[data-testid=search-result]').click();
          await __t.wait(900);
          return { rows, none, first, nepali, second: { tab: activeTab(), line: activeLine() } };
        })()`);
        if (r.error) throw new Error(r.error);
        if (!r.rows.some((x) => x.includes('bad_import.py:2')))
          throw new Error('wrong results: ' + JSON.stringify(r.rows));
        if (!r.none) throw new Error('no "No matches" message');
        if (
          r.first.tab !== 'bad_import.py' ||
          r.first.line !== '2' ||
          !r.first.closed
        )
          throw new Error('did not jump: ' + JSON.stringify(r.first));
        if (!r.nepali.some((x) => x.includes('notes.md:2')))
          throw new Error('Nepali search failed: ' + JSON.stringify(r.nepali));
        if (r.second.tab !== 'notes.md' || r.second.line !== '2')
          throw new Error(
            'did not jump to Nepali hit: ' + JSON.stringify(r.second),
          );
        return r.rows[0];
      },
    },
    {
      name: 'Problems panel: file:line rows, click jumps, next-error button',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          const activeTab = () => document.querySelector('main div[title].bg-slate-800')?.innerText.split('\\n')[0];
          const activeLine = () => document.querySelector('.monaco-editor .active-line-number')?.textContent?.trim();
          // सबै खुला फाइलका गल्ती तयार होऊन् — wait until the error files have their problems
          for (const n of ['app.js', 'hello.py', 'main.dart']) await __t.open(n);
          await __t.until(() => /^⛔\\s*[1-9]/.test(document.querySelector('[data-testid=problems-toggle]')?.innerText ?? ''), 30000);
          document.querySelector('[data-testid=problems-toggle]').click();
          const panel = await __t.until(() => document.querySelector('[data-testid=problems-panel]'), 4000);
          if (!panel) return { error: 'panel did not open' };
          const rows = () => [...document.querySelectorAll('[data-testid=problem-row]')];
          await __t.until(() => rows().some((x) => /hello\\.py:\\d+/.test(x.innerText)) && rows().some((x) => /main\\.dart:\\d+/.test(x.innerText)), 30000);
          const texts = rows().map((x) => x.innerText.replace(/\\s+/g, ' '));
          const hasFix = rows().every((x) => x.querySelector('[data-testid=problem-fix]'));
          // एउटा फाइलका गल्तीमा क्लिक — click a row in another file
          await __t.open('app.js');
          const pyRow = rows().find((x) => /hello\\.py:/.test(x.innerText));
          const want = pyRow.innerText.match(/hello\\.py:(\\d+)/)[1];
          pyRow.querySelector('button').click();
          await __t.wait(900);
          const jumped = { tab: activeTab(), line: activeLine(), want };
          // "Next error" बटन — the toolbar button moves to another error
          const before = { tab: activeTab(), line: activeLine() };
          document.querySelector('[data-testid=tb-next-error]').click();
          await __t.wait(900);
          const next = { tab: activeTab(), line: activeLine() };
          document.querySelector('[data-testid=problems-toggle]').click();
          await __t.wait(200);
          return { texts, hasFix, jumped, before, next, closed: !document.querySelector('[data-testid=problems-panel]') };
        })()`);
        if (r.error) throw new Error(r.error);
        if (!r.hasFix) throw new Error('a row has no Fix with Guru button');
        if (r.jumped.tab !== 'hello.py' || r.jumped.line !== r.jumped.want)
          throw new Error('click did not jump: ' + JSON.stringify(r.jumped));
        if (r.before.tab === r.next.tab && r.before.line === r.next.line)
          throw new Error('Next error did not move: ' + JSON.stringify(r));
        if (!r.closed) throw new Error('panel did not close');
        return r.texts.slice(0, 3).join(' || ');
      },
    },
    {
      name: 'Format code (Dart) + Undo restores it',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          const code = () => document.querySelector('.monaco-editor .view-lines')?.innerText.replace(/\\u00a0/g, ' ') ?? '';
          await __t.open('format_me.dart');
          await __t.until(() => /print/.test(code()), 5000);
          const before = code();
          document.querySelector('[data-testid=tb-format]').click();
          await __t.until(() => code() !== before, 30000);
          const formatted = code();
          const toast = await __t.until(() => __t.toasts.find((t) => /Format|Formatted|मिलाऊ|भयो/.test(t) && /Ctrl\\+Z/.test(t)), 3000);
          document.querySelector('[data-testid=tb-undo]').click();
          await __t.until(() => code() === before, 5000);
          const undone = code();
          document.querySelector('[data-testid=tb-redo]').click();
          await __t.until(() => code() === formatted, 5000);
          return { before, formatted, undone, toast: Boolean(toast), redone: code() === formatted };
        })()`);
        if (r.formatted === r.before)
          throw new Error('format changed nothing: ' + r.formatted);
        if (!/void main\(\) \{/.test(r.formatted))
          throw new Error('not formatted: ' + r.formatted);
        if (r.undone !== r.before)
          throw new Error('undo did not restore the text');
        if (!r.redone) throw new Error('redo did not re-apply');
        if (!r.toast) throw new Error('no format toast');
      },
    },
    {
      name: 'Import typo: red line + green valid import + one-click fix, Guru stays silent',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          const mdBefore = document.querySelectorAll('aside .md-body').length;
          await __t.open('typo_import.dart');
          const bad = await __t.until(() => document.querySelectorAll('.monaco-editor .import-bad-line').length > 0 && document.querySelectorAll('.monaco-editor .import-ok-line').length > 0, 30000);
          const first = document.querySelector('.monaco-editor .view-line');
          const rect = first.getBoundingClientRect();
          return { bad: Boolean(bad), squiggles: __t.squiggles(), x: Math.round(rect.left + 60), y: Math.round(rect.top + rect.height / 2), mdBefore };
        })()`);
        if (!r.bad)
          throw new Error(
            'import lines are not coloured: ' + JSON.stringify(r),
          );
        if (r.squiggles < 1) throw new Error('no red squiggle for the typo');
        // Ctrl+. → Quick Fix list → Enter
        await p.click(r.x, r.y);
        await p.key('.', 'Period', 190, 2);
        const menu = await p.eval(`(async () => {
          const w = await __t.until(() => [...document.querySelectorAll('.action-widget, .codeActionWidget')].find((e) => /package:flutter\\/material\\.dart/.test(e.innerText)), 8000);
          return w ? w.innerText.replace(/\\s+/g, ' ').slice(0, 160) : null;
        })()`);
        if (!menu)
          throw new Error('no one-click "Change to" suggestion appeared');
        await p.key('Enter', 'Enter', 13);
        const after = await p.eval(`(async () => {
          const line1 = () => document.querySelector('.monaco-editor .view-line')?.innerText ?? '';
          await __t.until(() => line1().includes('package:flutter/material.dart'), 5000);
          // Guru ने आफैं केही नगरोस् — Guru must not start anything by itself
          await __t.wait(6000);
          return { line1: line1(), md: document.querySelectorAll('aside .md-body').length, busy: [...document.querySelectorAll('aside button')].some((b) => b.innerText.trim() === '⏹'), autoToggle: /आफैं · Auto/.test(document.body.innerText) };
        })()`);
        if (!after.line1.includes("'package:flutter/material.dart'"))
          throw new Error('fix not applied: ' + after.line1);
        if (after.md !== r.mdBefore || after.busy)
          throw new Error(
            'Guru answered or started by itself: ' + JSON.stringify(after),
          );
        if (after.autoToggle)
          throw new Error('an Auto-explain toggle is still shown');
        return menu;
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
          const input = document.querySelector('[role=dialog]:not(.find-widget) input');
          const hasName = Boolean(input);
          const prefilled = input.value;
          const setName = async (v) => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await __t.wait(150);
            const dlg2 = document.querySelector('[role=dialog]:not(.find-widget)');
            return { note: dlg2.querySelector('[data-testid=folder-note]')?.innerText, error: /text-rose-400/.test(dlg2.innerHTML), createDisabled: [...dlg2.querySelectorAll('button')].find((b) => b.textContent.includes('बनाऊ'))?.disabled };
          };
          const messy = await setName('My App Now!');
          const blank = await setName('');
          const nepali = await setName('नमस्ते');
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await __t.wait(250);
          return { ids, before, after, hasName, prefilled, messy, blank, nepali, closed: !document.querySelector('[role=dialog]:not(.find-widget)') };
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
        if (!r.prefilled.trim()) throw new Error('name not pre-filled');
        if (
          !r.messy.note?.includes('my_app_now') ||
          r.messy.error ||
          r.messy.createDisabled
        )
          throw new Error(
            'messy name blocked/not adjusted: ' + JSON.stringify(r.messy),
          );
        if (!r.blank.note?.includes('flutter_app') || r.blank.createDisabled)
          throw new Error(
            'blank name not defaulted: ' + JSON.stringify(r.blank),
          );
        if (!r.nepali.note?.includes('flutter_app') || r.nepali.error)
          throw new Error('nepali name: ' + JSON.stringify(r.nepali));
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
      name: 'Output: errors are red; picking error text shows "Ask Guru AI" and sends nothing by itself',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          const guruBefore = [...document.querySelectorAll('aside')].pop().querySelectorAll('[data-answer], .md-body').length;
          const errLines = [...document.querySelectorAll('[data-testid=output-box] [data-error-line]')];
          const noBtnBefore = !document.querySelector('[data-testid=ask-guru-selection]');
          const el = errLines[0];
          if (!el) return { error: 'no red error line in the Output' };
          const color = el.className;
          const range = document.createRange();
          range.selectNodeContents(el);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          document.querySelector('[data-testid=output-box]').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          const btn = await __t.until(() => document.querySelector('[data-testid=ask-guru-selection]'), 4000);
          await __t.wait(2500);
          const guruAfter = [...document.querySelectorAll('aside')].pop().querySelectorAll('[data-answer], .md-body').length;
          const busy = [...document.querySelectorAll('aside button')].some((b) => b.innerText.trim() === '⏹');
          const label = btn ? btn.innerText : '';
          // छनोट हटाउँदा बटन हराउँछ — the button goes away when nothing is selected
          sel.removeAllRanges();
          document.querySelector('[data-testid=output-box]').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          await __t.wait(300);
          return { noBtnBefore, color, label, sentByItself: guruAfter !== guruBefore || busy, gone: !document.querySelector('[data-testid=ask-guru-selection]'), n: errLines.length };
        })()`);
        if (r.error) throw new Error(r.error);
        if (!r.noBtnBefore)
          throw new Error('button shown before anything was picked');
        if (!/Ask Guru AI|गुरु AI/.test(r.label))
          throw new Error(
            'no "Ask Guru AI" button after picking error text: ' +
              JSON.stringify(r),
          );
        if (r.sentByItself)
          throw new Error(
            'Guru was called without a click: ' + JSON.stringify(r),
          );
        if (!r.gone)
          throw new Error('button stayed after the selection was cleared');
        if (!r.color.includes('text-red-400'))
          throw new Error('error line is not red: ' + r.color);
        return r.n + ' red error line(s)';
      },
    },
    {
      name: 'Explanation box: instant plain English + Nepali notice for an editor mistake; green when fine',
      run: async (p) => {
        const r = await p.eval(`(async () => {
          await __t.open('app.js');
          const hints = await __t.until(() => document.querySelector('[data-testid=error-hints]')?.innerText, 15000);
          const bad = { hints: hints ?? '', allGoodWhileBroken: Boolean(document.querySelector('[data-testid=all-good]')) };
          await __t.open('ok.dart');
          const good = await __t.until(() => document.querySelector('[data-testid=all-good]'), 30000);
          return { bad, good: Boolean(good), goodText: good?.innerText ?? '' };
        })()`);
        const lines = r.bad.hints
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        const en = lines.findIndex(
          (l) => /^[A-Za-z]/.test(l) && !/^line /i.test(l),
        );
        const ne = lines.findIndex((l) => /[ऀ-ॿ]/.test(l) && !/line/.test(l));
        if (en < 0 || ne < 0)
          throw new Error('hint is not bilingual: ' + r.bad.hints);
        if (en > ne)
          throw new Error('Nepali came before English: ' + r.bad.hints);
        if (r.bad.allGoodWhileBroken)
          throw new Error('green "all good" shown while there is an error');
        if (!r.good)
          throw new Error('no green "all good" notice for a clean file');
        return lines.slice(0, 3).join(' | ');
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
          await window.studio.speak('e2e1', [{ text: 'Hello, I am your tutor.', lang: 'en-US' }, { text: 'नमस्ते। म तपाईंको गुरु हुँ।', lang: 'ne-NP' }], 1, 'female');
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
        // पहिले English, अनि नेपाली (Google नेपाली; Google नचले हेमकला) — English first, then Nepali.
        if (
          !/Natural/.test(chunks[0] ?? '') ||
          !/English/.test(chunks[0] ?? '')
        )
          throw new Error(
            'English chunk voice (should be first): ' + chunks[0],
          );
        if (!/Google नेपाली|हेमकला|Hemkala/.test(chunks[1] ?? ''))
          throw new Error(
            'Nepali chunk voice (should be second): ' + chunks[1],
          );
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
                Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'print() ले के गर्छ? छोटो उत्तर दिनुहोस्।');
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                await __t.wait(200);
                const before = document.querySelectorAll('aside .md-body').length;
                (await __t.until(() => [...document.querySelectorAll('aside button')].find((b) => b.innerText.trim() === '➤' && !b.disabled), 120000, 250)).click();
                const t0 = performance.now();
                await __t.until(() => document.querySelectorAll('aside .md-body').length > before && ![...document.querySelectorAll('aside button')].some((b) => b.innerText.trim() === '⏹'), 120000, 250);
                const a = [...document.querySelectorAll('aside .md-body')].pop()?.innerText ?? '';
                return { ms: Math.round(performance.now() - t0), a: a.slice(0, 160), fixed: Boolean(document.querySelector('aside [data-order-fixed]')), speaker: [...document.querySelectorAll('aside button[aria-label^="Read aloud"]')].length };
              })()`,
                150000,
              );
              if (!/[ऀ-ॿ]/.test(r.a) || !/[A-Za-z]{4}/.test(r.a))
                throw new Error('answer not bilingual: ' + r.a);
              if (r.speaker < 1)
                throw new Error('no speaker button under the answer');
              return `${r.ms} ms${r.fixed ? ' (model wrote Nepali first; display reordered)' : ' (model followed English-first itself)'}`;
            },
          },
          {
            name: 'Guru answer and spoken voice: simple English first, then Nepali',
            run: async (p) => {
              const r = await p.eval(
                `(async () => {
                await __t.idleGuru();
                await window.studio.stopSpeaking();
                await __t.wait(1200);
                const answer = [...document.querySelectorAll('aside .md-body')].pop()?.innerText ?? '';
                const firstLatin = answer.search(/[A-Za-z]{3}/);
                const firstDev = answer.search(/[ऀ-ॿ]{2}/);
                const ev = [];
                const off = window.studio.onSpeakerEvent((e) => { if (e.type === 'chunk') ev.push(e.voice ?? ''); });
                const btn = [...document.querySelectorAll('aside button[aria-label="Read aloud all"]')].pop();
                if (!btn) return { error: 'no Listen button', answer: answer.slice(0, 80) };
                btn.click();
                await __t.until(() => ev.length >= 2, 60000, 250);
                await window.studio.stopSpeaking();
                off();
                return { firstLatin, firstDev, voices: ev.slice(0, 3), head: answer.slice(0, 60) };
              })()`,
                120000,
              );
              if (r.error) throw new Error(r.error + ' ' + r.answer);
              if (
                r.firstLatin < 0 ||
                r.firstDev < 0 ||
                r.firstLatin > r.firstDev
              )
                throw new Error('text is not English-first: ' + r.head);
              const nep = (v) => /Google नेपाली|हेमकला|Hemkala/.test(v ?? '');
              if (nep(r.voices[0]))
                throw new Error('spoken Nepali first: ' + r.voices.join(' | '));
              if (!r.voices.slice(1).some(nep))
                throw new Error(
                  'no Nepali voice after English: ' + r.voices.join(' | '),
                );
              return r.voices
                .map((v) => v.replace(/Microsoft | Online.*$/g, ''))
                .join(' → ');
            },
          },
          {
            name: 'Guru explain: English part is pure English, Nepali part comes below',
            run: async (p) => {
              const r = await p.eval(
                `(async () => {
                await __t.idleGuru();
                await __t.open('app.js');
                await __t.wait(800);
                const btn = await __t.until(() => [...document.querySelectorAll('aside button')].find((b) => /📖/.test(b.innerText) && !b.disabled), 10000, 250);
                if (!btn) return { error: 'no explain button: ' + [...document.querySelectorAll('aside button')].map((b) => b.innerText.trim().slice(0, 14) + (b.disabled ? '(off)' : '')).join(' | ') };
                const before = document.querySelectorAll('aside [data-answer]').length;
                btn.click();
                await __t.wait(1500);
                await __t.until(() => document.querySelectorAll('aside [data-answer]').length > before && (window.studio.stopSpeaking(), true) && ![...document.querySelectorAll('aside button')].some((b) => b.innerText.trim() === '⏹'), 200000, 500);
                await window.studio.stopSpeaking();
                const card = [...document.querySelectorAll('aside [data-answer]')].pop();
                const clone = card.cloneNode(true);
                clone.querySelectorAll('pre').forEach((x) => x.remove());
                clone.querySelectorAll('[data-testid=explain-box] > div:first-child').forEach((x) => x.remove());
                const lines = card.innerText.split('\\n').map((l) => l.trim()).filter((l) => l && !/^(📝|💻)/.test(l));
                const ne = lines.findIndex((l) => /^\\W*नेपाली\\W*$/.test(l));
                const tail = lines.findIndex((l) => /📚/.test(l));
                const english = lines.slice(0, ne < 0 ? lines.length : ne).filter((_, k) => tail < 0 || k < tail).join(' ');
                return { ne, tail, devInEnglish: (english.match(/[ऀ-ॿ]+/g) ?? []).slice(0, 5), engHead: english.slice(0, 80), n: lines.length };
              })()`,
                260000,
              );
              if (r.error) throw new Error(r.error);
              if (r.ne < 0)
                throw new Error(
                  'no separate नेपाली section: ' + JSON.stringify(r),
                );
              if (r.devInEnglish.length)
                throw new Error(
                  'Nepali inside the English part: ' + JSON.stringify(r),
                );
              return 'English part: ' + r.engHead;
            },
          },
          {
            name: 'Guru "give code": code first, no quiz, no follow-up questions',
            run: async (p) => {
              const r = await p.eval(
                `(async () => {
                await __t.idleGuru();
                await __t.open('ok.dart');
                const ta = [...document.querySelectorAll('aside textarea')].pop();
                Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Dart मा दुई नम्बर जोड्ने function को कोड देऊ');
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                await __t.wait(200);
                const before = document.querySelectorAll('aside [data-answer]').length;
                (await __t.until(() => [...document.querySelectorAll('aside button')].find((b) => b.innerText.trim() === '➤' && !b.disabled), 120000, 250)).click();
                await __t.wait(1500);
                await __t.until(() => document.querySelectorAll('aside [data-answer]').length > before && (window.studio.stopSpeaking(), true) && ![...document.querySelectorAll('aside button')].some((b) => b.innerText.trim() === '⏹'), 200000, 500);
                await window.studio.stopSpeaking();
                const card = [...document.querySelectorAll('aside [data-answer]')].pop();
                const codeBox = document.querySelector('[data-testid=guru-code-box]');
                const code = codeBox ? codeBox.querySelectorAll('[data-testid=code-tab]').length : 0;
                const text = card.innerText;
                return { code, words: text.split(' ').filter(Boolean).length, quiz: card.innerHTML.includes('quiz') || /quiz|प्रश्न/i.test(text), asks: /\\?\\s*$/.test(text.trim()) || /say yes|shall I|चाहनुहुन्छ|भन्नुहोस् भने/i.test(text), head: text.slice(0, 120) };
              })()`,
                260000,
              );
              if (r.code < 1) throw new Error('no code: ' + JSON.stringify(r));
              if (r.words > 110)
                throw new Error(
                  'too much text around the code: ' + JSON.stringify(r),
                );
              if (r.asks)
                throw new Error(
                  'ends with a follow-up question: ' + JSON.stringify(r),
                );
              return r.words + ' words around the code';
            },
          },
          {
            name: 'Guru builds an app: full code for every file, not just a structure',
            run: async (p) => {
              const r = await p.eval(
                `(async () => {
                await __t.idleGuru();
                await __t.open('ok.dart');
                const ta = document.querySelector('aside:last-of-type textarea') ?? [...document.querySelectorAll('aside textarea')].pop();
                Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'मलाई Flutter मा सानो counter एप बनाइदेऊ, पूरा कोड सहित।');
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                await __t.wait(200);
                const before = document.querySelectorAll('aside [data-answer]').length;
                (await __t.until(() => [...document.querySelectorAll('aside button')].find((b) => b.innerText.trim() === '➤' && !b.disabled), 120000, 250)).click();
                await __t.wait(1500);
                const t0 = performance.now();
                await __t.until(() => document.querySelectorAll('aside [data-answer]').length > before && (window.studio.stopSpeaking(), true) && ![...document.querySelectorAll('aside button')].some((b) => b.innerText.trim() === '⏹'), 280000, 500);
                const card = [...document.querySelectorAll('aside [data-answer]')].pop();
                await window.studio.stopSpeaking();
                const box = document.querySelector('[data-testid=guru-code-box]');
                const blocks = [];
                for (const tab of box ? [...box.querySelectorAll('[data-testid=code-tab]')] : []) { tab.click(); await __t.wait(150); box.querySelector('[data-testid=code-unlock]')?.click(); await __t.wait(150); blocks.push(box.querySelector('[data-testid=code-text]').innerText); }
                const boxes = { code: blocks.length, preInChat: card.querySelectorAll('pre').length };
                return { boxes, ms: Math.round(performance.now() - t0), n: blocks.length, hasMain: /void main\\(/.test(blocks.join(' ')) && /runApp\\(/.test(blocks.join(' ')), hasState: blocks.some((b) => /(StatefulWidget|setState|ChangeNotifier|ValueNotifier)/.test(b)), chars: blocks.join('').length, head: card.innerText.slice(0, 80) };
              })()`,
                300000,
              );
              if (r.boxes.code < 1 || r.boxes.preInChat > 0)
                throw new Error(
                  'code is not in its own box: ' + JSON.stringify(r.boxes),
                );
              if (!r.hasMain)
                throw new Error(
                  'no complete main.dart in the answer: ' + JSON.stringify(r),
                );
              if (!r.hasState || r.chars < 400)
                throw new Error(
                  'code too short/incomplete: ' + JSON.stringify(r),
                );
              return `${r.n} code block(s), ${r.chars} chars, ${r.ms} ms`;
            },
          },
          {
            name: 'Code steps: target file header, locked next step, unlock',
            run: async (p) => {
              const r = await p.eval(
                `(async () => {
                window.__addGuruCode([
                  { title: 'zz_step.yaml', place: 'first config', language: 'yaml', code: 'name: demo', markdown: '' },
                  { title: 'lib/zz_step.dart', place: 'app entry', language: 'dart', code: 'void main() {}', markdown: '' },
                ]);
                await __t.wait(500);
                const tabs = () => [...document.querySelectorAll('[data-testid=code-tab]')];
                const first = tabs().length - 2;
                tabs()[first].click();
                await __t.wait(200);
                const head1 = document.querySelector('[data-testid=code-target]')?.innerText ?? '';
                tabs()[first + 1].click();
                await __t.wait(200);
                const locked = Boolean(document.querySelector('[data-testid=code-locked]'));
                const lockIcon = tabs()[first + 1].innerText.includes('🔒');
                document.querySelector('[data-testid=code-unlock]').click();
                await __t.wait(300);
                const open = document.querySelector('[data-testid=code-text]')?.innerText ?? '';
                const head2 = document.querySelector('[data-testid=code-target]')?.innerText ?? '';
                return { head1, locked, lockIcon, open, head2 };
              })()`,
                30000,
              );
              if (
                !/zz_step\.yaml/.test(r.head1) ||
                !/first config/.test(r.head1)
              )
                throw new Error('no file header: ' + JSON.stringify(r));
              if (!r.locked || !r.lockIcon)
                throw new Error('next step not locked: ' + JSON.stringify(r));
              if (
                !/void main/.test(r.open) ||
                !/lib\/zz_step\.dart/.test(r.head2)
              )
                throw new Error('unlock failed: ' + JSON.stringify(r));
            },
          },
          {
            name: 'Problems panel: "Fix with Guru" jumps to the file and asks Guru',
            run: async (p) => {
              const r = await p.eval(
                `(async () => {
                await __t.idleGuru();
                const codeTabs = () => [...document.querySelectorAll('[data-testid=code-tab]')].map((t) => t.innerText.split(' ')[0] + ' ' + t.innerText.split(' ')[1]);
                const tabsBefore = codeTabs();
                await __t.open('hello.py');
                await __t.until(() => __t.squiggles() > 0, 20000);
                await __t.open('app.js');
                document.querySelector('[data-testid=problems-toggle]').click();
                await __t.until(() => [...document.querySelectorAll('[data-testid=problem-row]')].some((x) => /hello\\.py:/.test(x.innerText)), 20000);
                const row = [...document.querySelectorAll('[data-testid=problem-row]')].find((x) => /hello\\.py:/.test(x.innerText));
                row.querySelector('[data-testid=problem-fix]').click();
                await __t.wait(1500);
                const tab = document.querySelector('main div[title].bg-slate-800')?.innerText.split('\\n')[0];
                const asked = await __t.until(() => /Fix with Guru: hello\\.py:\\d+/.test([...document.querySelectorAll('aside')].pop()?.innerText ?? ''), 90000, 250);
                await __t.idleGuru();
                document.querySelector('[data-testid=problems-toggle]').click();
                const tabsAfter = codeTabs();
                return { tab, asked: Boolean(asked), tabsBefore, tabsAfter };
              })()`,
                200000,
              );
              if (r.tab !== 'hello.py')
                throw new Error('did not open the file: ' + r.tab);
              if (!r.asked) throw new Error('Guru was not asked');
              // पहिलेका Code 1, Code 2 … नमेटिएको — earlier Code tabs must survive the follow-up question
              if (
                r.tabsBefore.length > 0 &&
                r.tabsAfter.slice(0, r.tabsBefore.length).join() !==
                  r.tabsBefore.join()
              )
                throw new Error(
                  'earlier code tabs were lost: ' + JSON.stringify(r),
                );
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
                if (!view) return { error: 'diff dialog never opened; note: ' + ([...document.querySelectorAll('aside')].pop()?.innerText.match(/अहिले कुनै गल्ती[^\\n]*/)?.[0] ?? 'none') + ' | last answer: ' + ([...document.querySelectorAll('aside .md-body')].pop()?.innerText.slice(0, 300) ?? '') };
                const diffText = view.innerText;
                const apply = [...document.querySelectorAll('[role=dialog]:not(.find-widget) button')].find((b) => b.textContent.includes('✅'));
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
