import { tr } from '../i18n';

/** खुला फाइलको एउटा गल्ती/चेतावनी — one error or warning in an open file. */
export interface Problem {
  path: string;
  name: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
  source: string;
}

/**
 * "समस्या · Problems": फाइलको नाम र लाइनसहित गल्ती सूची। क्लिक गरे त्यही लाइनमा जान्छ,
 * "Guru सँग ठीक गर" ले त्यही गल्ती बुझाउँछ र ठीक गर्छ।
 * Problems list with file name and line. Click a row to jump there; "Fix with Guru" explains and fixes that one.
 */
export function ProblemsPanel({
  problems,
  onJump,
  onFix,
  onClose,
}: {
  problems: Problem[];
  onJump: (p: Problem) => void;
  onFix: (p: Problem) => void;
  onClose: () => void;
}) {
  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.length - errors;
  return (
    <div
      data-testid="problems-panel"
      className="flex h-44 shrink-0 flex-col border-t border-slate-700 bg-slate-950"
    >
      <div className="flex items-center gap-3 border-b border-slate-800 px-3 py-1 text-xs text-slate-300">
        <span className="font-semibold">{tr('समस्या · Problems')}</span>
        <span className="text-rose-400">⛔ {errors}</span>
        <span className="text-sky-300">⚠ {warnings}</span>
        <div className="flex-1" />
        <button
          className="text-slate-500 hover:text-slate-200"
          title={tr('बन्द · Close')}
          aria-label="Close problems"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto text-sm">
        {problems.length === 0 && (
          <li className="px-3 py-3 text-emerald-400">
            {tr('✅ खुला फाइलहरूमा कुनै समस्या छैन · No problems in the open files')}
          </li>
        )}
        {problems.map((p) => (
          <li
            key={`${p.path}:${p.line}:${p.column}:${p.message}`}
            data-testid="problem-row"
            className="group flex items-center gap-2 px-3 py-1 hover:bg-slate-800"
          >
            <button
              className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
              title={tr('यो लाइनमा जाऊ · Jump to this line')}
              onClick={() => onJump(p)}
            >
              <span
                className={
                  p.severity === 'error' ? 'text-rose-400' : 'text-sky-300'
                }
              >
                {p.severity === 'error' ? '⛔' : '⚠'}
              </span>
              <span className="shrink-0 font-medium text-sky-300">
                {p.name}:{p.line}
              </span>
              <span className="min-w-0 truncate text-slate-200">
                {p.message}
              </span>
            </button>
            <button
              data-testid="problem-fix"
              className="shrink-0 rounded-md bg-violet-600/80 px-2 py-0.5 text-xs text-white hover:bg-violet-500"
              title={tr(
                'Guru ले यो गल्ती बुझाउँछ र ठीक गर्छ · Guru explains and fixes this',
              )}
              onClick={() => onFix(p)}
            >
              {tr('🧑‍🏫 Guru सँग ठीक गर · Fix with Guru')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
