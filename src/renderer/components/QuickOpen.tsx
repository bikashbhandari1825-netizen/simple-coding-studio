import { useEffect, useMemo, useRef, useState } from 'react';
import { tr } from '../i18n';
import { errorText, fileIcon } from '../lib/helpers';

/** नाम मिल्ने अंक: अक्षर क्रमैसँग मिले, शब्दको सुरु र फाइल नाममा बढी अंक — fuzzy score for a path. */
function score(pathLower: string, q: string): number {
  if (!q) return 1;
  const name = pathLower.slice(pathLower.lastIndexOf('\\') + 1);
  if (name.startsWith(q)) return 1000 - name.length;
  if (name.includes(q)) return 800 - name.length;
  if (pathLower.includes(q)) return 500 - pathLower.length / 10;
  let i = 0;
  let s = 0;
  for (const ch of pathLower) {
    if (ch === q[i]) {
      s += 2;
      i++;
      if (i === q.length) return 100 + s - pathLower.length / 20;
    }
  }
  return -1;
}

/**
 * Ctrl+P "फाइल खोज": ठूलो project मा नाम टाइप गरेर तुरुन्तै फाइल खोल्ने (VS Code जस्तै)।
 * Ctrl+P Quick Open: type part of a name to jump to any file in a large project (like VS Code).
 */
export function QuickOpen({
  rootPath,
  onOpen,
  onClose,
}: {
  rootPath: string;
  onOpen: (relativePath: string) => void;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    window.studio
      .listAllFiles(rootPath)
      .then((r) => {
        setFiles(r.files);
        setTruncated(r.truncated);
      })
      .catch((err) => setError(errorText(err)));
  }, [rootPath]);

  const results = useMemo(() => {
    if (!files) return [];
    const q = query.trim().toLowerCase().replace(/\//g, '\\');
    return (
      files
        // उस्तै अंक भए project को माथिल्लो तहका फाइल पहिले — on ties, files nearer the project root come first.
        .map((f) => ({
          f,
          raw: score(f.toLowerCase(), q),
          depth: f.split('\\').length,
        }))
        .filter((x) => x.raw >= 0)
        .sort((a, b) => b.raw - b.depth * 3 - (a.raw - a.depth * 3))
        .slice(0, 60)
        .map((x) => x.f)
    );
  }, [files, query]);

  useEffect(() => setActive(0), [query]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/50 pt-20 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label="Quick open"
        className="glass-pop h-fit w-full max-w-2xl overflow-hidden rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          placeholder={tr(
            'फाइलको नाम टाइप गर्नुहोस्… (जस्तै main.dart) · Type a file name… (e.g. main.dart)',
          )}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && results[active]) {
              onOpen(results[active]);
            }
          }}
          className="w-full border-b border-slate-600 bg-slate-900 px-4 py-3 text-slate-100 outline-none"
        />
        <ul className="max-h-[50vh] overflow-auto py-1 text-sm">
          {error && <li className="px-4 py-2 text-rose-400">{tr(error)}</li>}
          {!files && !error && (
            <li className="px-4 py-2 text-slate-400">
              {tr('फाइलहरू खोज्दै… · Indexing files…')}
            </li>
          )}
          {files && results.length === 0 && (
            <li className="px-4 py-2 text-slate-400">
              {tr('केही भेटिएन · No matches')}
            </li>
          )}
          {results.map((f, i) => {
            const name = f.slice(f.lastIndexOf('\\') + 1);
            const dir = f.slice(0, f.length - name.length);
            return (
              <li key={f}>
                <button
                  className={`flex w-full items-center gap-2 px-4 py-1.5 text-left ${i === active ? 'bg-sky-900/60 text-white' : 'text-slate-200 hover:bg-slate-700'}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onOpen(f)}
                >
                  <span>{fileIcon(name, false)}</span>
                  <span className="font-medium">{name}</span>
                  <span className="min-w-0 truncate text-xs text-slate-500">
                    {dir}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {files && (
          <div className="border-t border-slate-700 px-4 py-1.5 text-[11px] text-slate-500">
            {tr(
              `${files.length.toLocaleString()} फाइल${truncated ? ' (पहिला मात्र)' : ''} · ${files.length.toLocaleString()} files${truncated ? ' (first only)' : ''}`,
            )}{' '}
            — ↑↓ Enter · Esc
          </div>
        )}
      </div>
    </div>
  );
}
