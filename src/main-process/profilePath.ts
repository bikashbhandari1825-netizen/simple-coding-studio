// 💾 एपको डेटा (Guru च्याट, कोड, सेटिङ) सधैं एउटै ठाउँमा — the app's data (Guru chats, code, settings) always in ONE place.
// समस्या: Claude जस्ता सुरक्षित (sandbox) एपले चलाउँदा %APPDATA% अर्कै ठाउँमा देखिन्छ, त्यसैले एउटै एपको डेटा दुई ठाउँमा बाँडिन्थ्यो।
// Problem: when a sandboxed app (such as Claude's tools) starts this app, %APPDATA% points somewhere else, so the data was split in two.
// उपाय: डेटा घरको फोल्डर (AppData बाहिर) मा राख्ने; त्यो दुवै तरिकाले उही हो। — Fix: keep the data in a folder in the home directory (outside AppData), the same for every way of starting the app.
// यो फाइलमा electron छैन, ताकि परीक्षण सजिलो होस् — no electron here, so it can be unit-tested on its own.
import fs from 'node:fs';
import path from 'node:path';

/** सार्दा नलिने (फेरि बन्ने वा ठूला) — not copied: caches, locks and the helper browser profiles (they are rebuilt) */
export const COPY_SKIP = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Crashpad',
  'blob_storage',
  'Network',
  'speaker-browser',
  'dictation-browser',
  'SingletonLock',
  'SingletonCookie',
  'SingletonSocket',
  'lockfile',
  'LOCK',
]);

/** उपयोगकर्ताले आफैं --user-data-dir दिएको छ (परीक्षण) — the caller chose a data folder with --user-data-dir (tests) */
export function hasUserDataArg(argv: string[]): boolean {
  return argv.some(
    (a) => a === '--user-data-dir' || a.startsWith('--user-data-dir='),
  );
}

/**
 * स्थिर डेटा फोल्डर: SCS_DATA_DIR भए त्यही, नत्र घर फोल्डरभित्र .simple-coding-studio
 * The fixed data folder: SCS_DATA_DIR when set, otherwise `.simple-coding-studio` in the home folder.
 */
export function fixedUserDataDir(
  home: string,
  env: Record<string, string | undefined>,
): string {
  const custom = env.SCS_DATA_DIR?.trim();
  return custom
    ? path.resolve(custom)
    : path.join(home, '.simple-coding-studio');
}

/** फोल्डरमा असली डेटा (Local Storage) छ? — does this folder hold real saved data (Local Storage)? */
export function hasSavedData(dir: string): boolean {
  try {
    return (
      fs.readdirSync(path.join(dir, 'Local Storage', 'leveldb')).length > 0
    );
  } catch {
    return false;
  }
}

/**
 * पुरानो डेटा फोल्डरबाट नयाँमा एकपटक सार्ने: नयाँमा डेटा छैन र पुरानोमा छ भने मात्र।
 * Copy the old data folder into the new one, once: only when the new one has no data and the old one has.
 * @returns 'copied' | 'already' (new has data) | 'nothing' (old has no data)
 */
export function migrateOldData(
  oldDir: string,
  newDir: string,
): 'copied' | 'already' | 'nothing' {
  if (hasSavedData(newDir)) return 'already';
  if (!hasSavedData(oldDir)) return 'nothing';
  fs.mkdirSync(newDir, { recursive: true });
  fs.cpSync(oldDir, newDir, {
    recursive: true,
    force: false,
    filter: (src) => !COPY_SKIP.has(path.basename(src)),
  });
  return 'copied';
}
