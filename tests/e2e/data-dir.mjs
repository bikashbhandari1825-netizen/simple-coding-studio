// End-to-end: the packaged app keeps its data in the fixed folder (SCS_DATA_DIR here), and the data survives a restart.
// Usage: FORGE_OUT_DIR=<build dir> node tests/e2e/data-dir.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './driver.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const exe = path.join(
  process.env.FORGE_OUT_DIR || path.join(projectRoot, 'out'),
  'Simple Coding Studio-win32-x64',
  'SimpleCodingStudio.exe',
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scs-datadir-'));
const dataDir = path.join(tmp, 'data');
let failures = 0;
const check = (name, ok, info = '') => {
  console.log(ok ? '  PASS' : '  FAIL', name, info);
  if (!ok) failures++;
};

async function run(port, work) {
  // --user-data-dir ज्यान बुझ्दै दिइँदैन: एपले आफैं ठाउँ छान्छ — no --user-data-dir: the app picks the folder itself
  const child = spawn(exe, [`--remote-debugging-port=${port}`], {
    stdio: 'ignore',
    env: { ...process.env, SCS_DATA_DIR: dataDir },
  });
  let target;
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find(
        (t) => t.type === 'page' && !t.url.startsWith('devtools://'),
      );
      if (target) break;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!target) {
    child.kill();
    throw new Error('app did not start');
  }
  const page = await connect(target.webSocketDebuggerUrl);
  await new Promise((r) => setTimeout(r, 2500));
  let out;
  try {
    out = await work(page);
  } finally {
    try {
      await page.eval('window.close(), 1', 5000);
    } catch {
      // the page goes away while closing
    }
    page.close();
    const t0 = Date.now();
    while (child.exitCode === null && Date.now() - t0 < 15_000)
      await new Promise((r) => setTimeout(r, 200));
    if (child.exitCode === null) child.kill();
    await new Promise((r) => setTimeout(r, 1500));
  }
  return out;
}

try {
  await run(9811, (page) =>
    page.eval(
      `localStorage.setItem('scs.guru.v2:test:chat', 'HELLO-CHAT-' + 'x'.repeat(200)); 1`,
    ),
  );
  check(
    'first run: the data folder was created and holds Local Storage',
    fs.existsSync(path.join(dataDir, 'Local Storage')),
    dataDir,
  );
  const again = await run(9812, (page) =>
    page.eval(`localStorage.getItem('scs.guru.v2:test:chat')`),
  );
  check(
    'second run: the saved chat is still there',
    typeof again === 'string' && again.startsWith('HELLO-CHAT-'),
    String(again).slice(0, 30),
  );
} catch (err) {
  failures++;
  console.log('  FAIL', err instanceof Error ? err.message : String(err));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failures ? `${failures} failure(s)` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
