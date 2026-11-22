// 🧑‍🏫 Guru ले दिएको "स्ट्रक्चर + असली कोड" साँच्चै काम गर्छ कि? — does Guru's "structure + real code" really work?
// हरेक एप-माग: Guru सँग सोध्ने → Code 1, 2… का फाइल नयाँ Flutter project मा राख्ने → pub get → analyze → web build।
// For each app request: ask Guru → put every Code tab into a fresh Flutter project → pub get → analyze → web build.
//   node tests/e2e/guru-apps.mjs [--count=3] [--keep]
import { execFileSync } from 'node:child_process';
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
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const FLUTTER = 'C:\\flutter\\bin\\flutter.bat';

const PROMPTS = [
  'I want to build a Flutter app to save my friends: name and phone number. Show them in a list, let me add a friend and delete a friend. Keep the data after closing the app.',
  'Build a Flutter expense tracker: add an expense with an amount and a category, show the list and the total money spent.',
  'मलाई साथीहरूले काम गरेको घण्टा टिप्ने Flutter एप बनाउनु छ: काम गर्ने मान्छे थप्ने, उसले कति घण्टा काम गर्‍यो थप्ने, र कुल घण्टा देखाउने। पूरा चल्ने कोड सहित।',
  'Build a simple Flutter quiz app with 5 questions, one question per screen, and a score screen at the end.',
];
const count = Math.min(Number(argv.count ?? 3), PROMPTS.length);

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'scs-guruapps-'));
const work = path.join(base, 'work');
fs.mkdirSync(work, { recursive: true });
fs.writeFileSync(path.join(work, 'readme.txt'), 'scratch');

const { child, page } = await launchApp({
  exe,
  port: 9342,
  userDataDir: path.join(base, 'profile'),
});
for (let i = 0; i < 60; i++) {
  const ok = await page
    .eval('Boolean(window.studio && window.studio.openRecentFolder)')
    .catch(() => false);
  if (ok) break;
  await new Promise((r) => setTimeout(r, 500));
}
await page.eval(`(async () => {
  await window.studio.openRecentFolder(${JSON.stringify(work)});
  localStorage.setItem('studio.recentProjects', JSON.stringify([${JSON.stringify(work)}]));
})()`);
await page.reload();
await new Promise((r) => setTimeout(r, 3000));
// हालका project खोल्न बटन थिच्ने (run.mjs जस्तै) र फाइल सूची/Sessions देखिन पर्खने
// Click the recent project like run.mjs does and wait for the file list and Sessions to show
const opened = await page.eval(
  `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 60; i++) {
    const btn = [...document.querySelectorAll('button')].find((x) => x.title === ${JSON.stringify(work)});
    if (btn) { btn.click(); break; }
    await wait(500);
  }
  for (let i = 0; i < 60; i++) {
    if (document.querySelector('[data-testid=session-new]')) return true;
    await wait(500);
  }
  return false;
})()`,
  90000,
);
if (!opened)
  throw new Error('the scratch project did not open (no Sessions list)');

const results = [];
function sh(args, cwd, timeout) {
  try {
    const out = execFileSync(FLUTTER, args, {
      cwd,
      shell: true,
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: String(e.stdout ?? '') + String(e.stderr ?? '') };
  }
}

try {
  for (let n = 0; n < count; n++) {
    const prompt = PROMPTS[n];
    console.log(`\n=== App ${n + 1}: ${prompt.slice(0, 70)}...`);
    // नयाँ कुराकानी, प्रश्न पठाउने, उत्तर सकिन पर्खने — new session, send, wait for the answer
    const r = await page.eval(
      `(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const until = async (fn, ms, step = 400) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { try { const v = fn(); if (v) return v; } catch {} await wait(step); } return null; };
        document.querySelector('[data-testid=session-new]')?.click();
        await wait(800);
        const ta = [...document.querySelectorAll('aside textarea')].pop();
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(prompt)});
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(300);
        const before = document.querySelectorAll('aside [data-answer]').length;
        const send = await until(() => [...document.querySelectorAll('aside button')].find((b) => b.innerText.trim() === '➤' && !b.disabled), 120000);
        if (!send) return { error: 'send button never enabled' };
        send.click();
        await wait(2000);
        await until(() => document.querySelectorAll('aside [data-answer]').length > before && (window.studio.stopSpeaking(), true) && ![...document.querySelectorAll('aside button')].some((b) => b.innerText.trim() === '⏹'), 420000, 600);
        await window.studio.stopSpeaking();
        await wait(1500);
        const keys = Object.keys(localStorage).filter((k) => k.startsWith('scs.code.v2:'));
        const all = keys.map((k) => ({ k, v: localStorage.getItem(k) }));
        // सबैभन्दा नयाँ कुराकानीको कोड: सबैभन्दा धेरै अन्तिम खण्ड भएको — the code of the active session
        const pk = ${JSON.stringify(work.toLowerCase())};
        const active = JSON.parse(localStorage.getItem('scs.sessions.v1:' + pk) || '{}').active;
        const mine = all.find((x) => x.k === 'scs.code.v2:' + pk + ':' + active);
        return { blocks: JSON.parse(mine?.v || '[]').map((b) => ({ title: b.title, code: b.code })), words: (document.querySelectorAll('aside [data-answer]')[document.querySelectorAll('aside [data-answer]').length - 1]?.innerText || '').split(' ').length };
      })()`,
      560000,
    );
    if (r.error) {
      results.push({ n: n + 1, ok: false, why: r.error });
      console.log('FAIL', r.error);
      continue;
    }
    const files = r.blocks.filter((b) => b.title);
    const unnamed = r.blocks.length - files.length;
    console.log(
      `  Guru gave ${r.blocks.length} code block(s): ${files.map((b) => b.title).join(', ')}${unnamed ? ` (+${unnamed} without a file name)` : ''}`,
    );
    // नयाँ project बनाउने — make a fresh project
    const dir = path.join(base, 'app' + (n + 1));
    const created = sh(
      ['create', '--platforms=web', '--no-pub', '-e', 'app' + (n + 1)],
      base,
      300000,
    );
    if (!created.ok) {
      results.push({ n: n + 1, ok: false, why: 'flutter create failed' });
      continue;
    }
    fs.rmSync(path.join(dir, 'test'), { recursive: true, force: true });
    fs.rmSync(path.join(dir, 'lib', 'main.dart'), { force: true });
    for (const b of files) {
      const rel = b.title.replace(/\\/g, '/').replace(/^\.?\//, '');
      if (/\.\./.test(rel)) continue;
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, b.code);
    }
    const problems = [];
    if (!files.some((b) => /lib\/main\.dart$/.test(b.title)))
      problems.push('no lib/main.dart given');
    if (unnamed) problems.push(unnamed + ' code block(s) without a file name');
    const get = sh(['pub', 'get'], dir, 300000);
    if (!get.ok)
      problems.push(
        'pub get failed: ' +
          get.out.split('\n').filter(Boolean).slice(-3).join(' | '),
      );
    let errors = [];
    let infos = 0;
    if (get.ok) {
      const an = sh(['analyze', 'lib'], dir, 300000);
      const lines = an.out.split('\n').map((l) => l.trim());
      errors = lines.filter((l) => /^error\b/.test(l));
      infos = lines.filter((l) => /^(info|warning)\b/.test(l)).length;
      if (errors.length)
        problems.push(
          errors.length +
            ' analyzer error(s): ' +
            errors.slice(0, 3).join(' || '),
        );
      if (!errors.length) {
        const build = sh(['build', 'web'], dir, 600000);
        if (!build.ok)
          problems.push(
            'web build failed: ' +
              build.out
                .split('\n')
                .filter((l) => /rror/.test(l))
                .slice(0, 3)
                .join(' | '),
          );
      }
    }
    const ok = problems.length === 0;
    results.push({
      n: n + 1,
      ok,
      files: files.map((b) => b.title),
      why: ok
        ? `analyze clean (${infos} hints), web build ok`
        : problems.join(' ; '),
    });
    console.log(
      (ok ? 'PASS' : 'FAIL') +
        `  App ${n + 1}: ` +
        results[results.length - 1].why,
    );
    if (argv.keep) console.log('  kept at', dir);
  }
} finally {
  try {
    child.kill();
  } catch {
    /* closed */
  }
}
fs.writeFileSync(
  path.join(os.tmpdir(), 'scs-guruapps-report.json'),
  JSON.stringify(results, null, 1),
);
const bad = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - bad.length}/${results.length} apps built from Guru's code`,
);
process.exit(bad.length ? 1 : 0);
