// Unit test: the app's data lives in one fixed folder, and old data is brought over once.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { fixedUserDataDir, hasUserDataArg, hasSavedData, migrateOldData } =
  await import(
    pathToFileURL(path.resolve('src/main-process/profilePath.ts')).href
  );
let bad = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    ok ? 'ok  ' : 'FAIL',
    name,
    ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`,
  );
  if (!ok) bad++;
};

// ---- where the data lives
eq(
  'default: .simple-coding-studio in the home folder',
  fixedUserDataDir('C:\\Users\\bikas', {}),
  path.join('C:\\Users\\bikas', '.simple-coding-studio'),
);
eq(
  'SCS_DATA_DIR wins',
  path.basename(
    fixedUserDataDir('C:\\Users\\bikas', { SCS_DATA_DIR: 'D:\\mydata' }),
  ),
  'mydata',
);
eq(
  'an empty SCS_DATA_DIR is ignored',
  fixedUserDataDir('H', { SCS_DATA_DIR: '  ' }),
  path.join('H', '.simple-coding-studio'),
);
eq(
  '--user-data-dir=... is noticed',
  hasUserDataArg(['app.exe', '--user-data-dir=C:\\x']),
  true,
);
eq(
  '--user-data-dir <path> is noticed',
  hasUserDataArg(['app.exe', '--user-data-dir', 'C:\\x']),
  true,
);
eq(
  'no data dir argument',
  hasUserDataArg(['app.exe', '--remote-debugging-port=9']),
  false,
);

// ---- bringing old data over (scratch folders only)
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'scs-profile-'));
const mk = (dir, files) => {
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
};
const oldDir = path.join(base, 'old');
const newDir = path.join(base, 'new');
mk(oldDir, {
  'Local Storage/leveldb/000003.log': 'CHAT-DATA',
  'Local Storage/leveldb/LOCK': '',
  'settings.json': '{"a":1}',
  'Cache/big.bin': 'x'.repeat(50),
  'speaker-browser/profile.bin': 'y',
  SingletonLock: 'z',
});
eq('old folder has data', hasSavedData(oldDir), true);
eq('new folder has none yet', hasSavedData(newDir), false);
eq('first time: data is copied', migrateOldData(oldDir, newDir), 'copied');
eq(
  'the chat data arrived',
  fs.readFileSync(
    path.join(newDir, 'Local Storage/leveldb/000003.log'),
    'utf8',
  ),
  'CHAT-DATA',
);
eq('settings arrived', fs.existsSync(path.join(newDir, 'settings.json')), true);
eq(
  'caches and helper browser profiles are not copied',
  [
    fs.existsSync(path.join(newDir, 'Cache')),
    fs.existsSync(path.join(newDir, 'speaker-browser')),
    fs.existsSync(path.join(newDir, 'SingletonLock')),
  ],
  [false, false, false],
);
eq(
  'the old folder is untouched',
  fs.readFileSync(
    path.join(oldDir, 'Local Storage/leveldb/000003.log'),
    'utf8',
  ),
  'CHAT-DATA',
);

// the user keeps chatting in the new folder; a second start must never overwrite it
fs.writeFileSync(
  path.join(newDir, 'Local Storage/leveldb/000003.log'),
  'NEWER-CHAT',
);
eq('second time: nothing is copied', migrateOldData(oldDir, newDir), 'already');
eq(
  'newer data is never overwritten',
  fs.readFileSync(
    path.join(newDir, 'Local Storage/leveldb/000003.log'),
    'utf8',
  ),
  'NEWER-CHAT',
);

// an old folder without saved data copies nothing
const emptyOld = path.join(base, 'empty-old');
fs.mkdirSync(emptyOld);
eq(
  'nothing to bring from an empty old folder',
  migrateOldData(emptyOld, path.join(base, 'new2')),
  'nothing',
);
eq(
  'and no folder is made for nothing',
  fs.existsSync(path.join(base, 'new2')),
  false,
);
fs.rmSync(base, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
