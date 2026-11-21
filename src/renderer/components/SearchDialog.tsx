import { useEffect, useRef, useState } from 'react';
import type { SearchResult } from '../../shared/types';
import { tr } from '../i18n';
import { errorText, fileIcon } from '../lib/helpers';

/** पछिल्लो खोज सम्झने (फेरि खोल्दा उही नतिजा) — the last search, remembered between openings. */
export interface SearchMemory {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  result: SearchResult | null;
}

export const EMPTY_SEARCH: SearchMemory = {
  query: '',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  result: null,
};

/**
 * Ctrl+Shift+F "project खोज": सबै फाइलमा पाठ खोजेर नतिजामा क्लिक गर्दा त्यही फाइल र लाइनमा जाने।
 * Ctrl+Shift+F project search: find text in every file; click a result to jump to that file and line.
 */
export function SearchDialog({
  rootPath,
  initialQuery,
  memory,
  onRemember,
  onOpen,
  onClose,
}: {
  rootPath: string;
  /** Editor मा छानिएको शब्द — the word selected in the editor, if any */
  initialQuery: string;
  memory: SearchMemory;
  onRemember: (m: SearchMemory) => void;
  onOpen: (relativePath: string, line: number, column: number) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<SearchMemory>(
    initialQuery ? { ...memory, query: initialQuery, result: null } : memory,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const search = async (next: SearchMemory = state) => {
    const id = ++runId.current;
    if (!next.query.trim()) {
      setState({ ...next, result: null });
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await window.studio.searchInProject(rootPath, next.query, {
        caseSensitive: next.caseSensitive,
        wholeWord: next.wholeWord,
        regex: next.regex,
      });
      if (id !== runId.current) return; // पुरानो खोज — an older search finished late
      const updated = { ...next, result };
      setState(updated);
      onRemember(updated);
      setActive(0);
    } catch (err) {
      if (id === runId.current) setError(errorText(err));
    } finally {
      if (id === runId.current) setBusy(false);
    }
  };

  // टाइप गर्दा आफैं खोज्ने (अलिकति पर्खेर) — search as you type, after a short pause.
  useEffect(() => {
    if (!state.query.trim()) return;
    const t = setTimeout(() => void search(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- search() reads the latest state
  }, [state.query, state.caseSensitive, state.wholeWord, state.regex]);

  const matches = state.result?.matches ?? [];

  const toggle = (
    key: 'caseSensitive' | 'wholeWord' | 'regex',
    label: string,
    title: string,
  ) => (
    <button
      type="button"
      title={title}
      aria-pressed={state[key]}
      onClick={() => setState((s) => ({ ...s, [key]: !s[key] }))}
      className={`rounded px-2 py-0.5 font-mono text-xs ${
        state[key]
          ? 'bg-sky-600 text-white'
          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/50 pt-16 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label="Search in project"
        data-testid="project-search"
        className="glass-pop h-fit w-full max-w-3xl overflow-hidden rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-600 bg-slate-900 px-3 py-2">
          <input
            ref={inputRef}
            value={state.query}
            data-testid="project-search-input"
            placeholder={tr('सबै फाइलमा खोज्नुहोस्… · Search in all files…')}
            onChange={(e) => setState((s) => ({ ...s, query: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, matches.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                const m = matches[active];
                if (m && state.result) onOpen(m.file, m.line, m.column);
                else void search();
              }
            }}
            className="min-w-0 flex-1 bg-transparent px-1 py-1 text-slate-100 outline-none"
          />
          {toggle('caseSensitive', 'Aa', tr('ठूलो/सानो फरक · Match case'))}
          {toggle('wholeWord', 'ab', tr('पूरा शब्द · Whole word'))}
          {toggle('regex', '.*', tr('Regex (उन्नत) · Regular expression'))}
        </div>
        <ul
          className="max-h-[55vh] overflow-auto py-1 text-sm"
          data-testid="search-results"
        >
          {(error || state.result?.error) && (
            <li className="px-4 py-2 text-rose-400">
              {tr(error || state.result?.error || '')}
            </li>
          )}
          {busy && (
            <li className="px-4 py-2 text-slate-400">
              {tr('खोज्दै… · Searching…')}
            </li>
          )}
          {!busy &&
            state.result &&
            !state.result.error &&
            matches.length === 0 && (
              <li className="px-4 py-2 text-slate-400">
                {tr('केही भेटिएन · No matches')}
              </li>
            )}
          {matches.map((m, i) => {
            const name = m.file.slice(m.file.lastIndexOf('\\') + 1);
            const dir = m.file.slice(0, m.file.length - name.length);
            return (
              <li key={`${m.file}:${m.line}:${m.column}`}>
                <button
                  data-testid="search-result"
                  className={`flex w-full items-baseline gap-2 px-4 py-1 text-left ${
                    i === active
                      ? 'bg-sky-900/60 text-white'
                      : 'text-slate-200 hover:bg-slate-700'
                  }`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onOpen(m.file, m.line, m.column)}
                >
                  <span className="shrink-0">{fileIcon(name, false)}</span>
                  <span className="shrink-0 font-medium">
                    {name}:{m.line}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-300">
                    {m.text}
                  </span>
                  <span className="max-w-40 shrink-0 truncate text-[11px] text-slate-500">
                    {dir}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-slate-700 px-4 py-1.5 text-[11px] text-slate-500">
          {state.result
            ? tr(
                `${state.result.matches.length}${state.result.truncated ? '+' : ''} नतिजा, ${state.result.files} फाइलमा · ${state.result.matches.length}${state.result.truncated ? '+' : ''} results in ${state.result.files} files`,
              )
            : tr('टाइप गर्नुहोस् · Start typing')}{' '}
          — ↑↓ Enter · Esc
        </div>
      </div>
    </div>
  );
}
