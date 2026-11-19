import { useEffect, useRef } from 'react';
import { tr, tr2 } from '../i18n';
import type { FixTip } from '../lib/errorAnalyzer';

export interface ConsoleLine {
  id: number;
  kind: 'command' | 'stdout' | 'stderr' | 'info' | 'error';
  text: string;
}

interface Props {
  lines: ConsoleLine[];
  running: boolean;
  interactive: boolean;
  onStop: () => void;
  onKey: (key: 'r' | 'R') => void;
  onClear: () => void;
  onAskGuru: () => void;
  onHide: () => void;
  /** यो run का error र सुझाव — Errors and fix tips found in this run. */
  tips?: FixTip[];
  onOpenTip?: (tip: FixTip) => void;
  onAskTip?: (tip: FixTip) => void;
  /** 🔧 एकै क्लिकको fix — run a tip's one-click fix */
  onFixTip?: (tip: FixTip) => void;
}

const COLORS: Record<ConsoleLine['kind'], string> = {
  command: 'text-sky-300 font-semibold',
  stdout: 'text-slate-200',
  stderr: 'text-amber-300',
  info: 'text-emerald-300',
  error: 'text-rose-400',
};

export function ConsolePanel({
  lines,
  running,
  interactive,
  onStop,
  onKey,
  onClear,
  onAskGuru,
  onHide,
  tips = [],
  onOpenTip,
  onAskTip,
  onFixTip,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines, tips.length]);

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-1 text-xs">
        <span className="font-semibold text-slate-300">
          {tr('🖥️ नतिजा · Output')}
        </span>
        {running && (
          <span className="animate-pulse text-emerald-400">
            {tr('● चल्दैछ · Running')}
          </span>
        )}
        <div className="flex-1" />
        {running && interactive && (
          <>
            <button
              className="chip"
              title={tr('कोड बदलेपछि तुरुन्तै देखाउने · Apply code changes instantly')}
              onClick={() => onKey('r')}
            >
              ⚡ Hot reload
            </button>
            <button
              className="chip"
              title={tr('एप सुरुबाट फेरि चलाउने · Restart the app')}
              onClick={() => onKey('R')}
            >
              🔄 Restart
            </button>
          </>
        )}
        {running && (
          <button
            className="chip border-rose-700 text-rose-300"
            onClick={onStop}
          >
            {tr('⏹ रोक · Stop')}
          </button>
        )}
        <button
          className="chip"
          onClick={onAskGuru}
          disabled={lines.length === 0}
          title={tr('Guru लाई यो output बुझाउन भन · Ask Guru about this output')}
        >
          {tr('🧑‍🏫 Guru लाई सोध · Ask Guru')}
        </button>
        <button className="chip" onClick={onClear}>
          {tr('🧹 सफा · Clear')}
        </button>
        <button className="icon-btn" title={tr('लुकाऊ · Hide')} onClick={onHide}>
          ▾
        </button>
      </div>
      <div className="flex-1 overflow-auto px-3 py-2 font-mono text-[13px] leading-5 whitespace-pre-wrap">
        {lines.length === 0 ? (
          <p className="text-slate-600">
            {tr(
              'माथिको ▶ बटन थिचेर एप चलाउनुहोस्। नतिजा यहाँ देखिन्छ। — Press ▶ above to run; output appears here.',
            )}
          </p>
        ) : (
          lines.map((l) => (
            <div key={l.id} className={COLORS[l.kind]}>
              {l.kind === 'command'
                ? `▶ ${l.text}`
                : l.kind === 'info' || l.kind === 'error'
                  ? tr(l.text)
                  : l.text}
            </div>
          ))
        )}
        {tips.map((tip) => (
          <FixTipCard
            key={tip.id}
            tip={tip}
            onOpen={onOpenTip}
            onAsk={onAskTip}
            onFix={running ? undefined : onFixTip}
          />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

/** Error को ठ्याक्कै तल देखिने "Guru's Fix Tip" — The "Guru's Fix Tip" card shown right under an error. */
function FixTipCard({
  tip,
  onOpen,
  onAsk,
  onFix,
}: {
  tip: FixTip;
  onOpen?: (t: FixTip) => void;
  onAsk?: (t: FixTip) => void;
  onFix?: (t: FixTip) => void;
}) {
  const where = tip.file
    ? `${tip.file}${tip.line ? ` : ${tr2(`लाइन ${tip.line}`, `line ${tip.line}`)}` : ''}${tip.column ? `, ${tr2(`कोलम ${tip.column}`, `col ${tip.column}`)}` : ''}`
    : '';
  return (
    <div
      className="my-2 rounded-lg border border-amber-600/70 bg-amber-950/40 p-3 font-sans whitespace-normal"
      role="note"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-amber-200">
          {tr("🧑‍🏫 Guru को Fix Tip · Guru's Fix Tip")}
        </span>
        <span className="rounded bg-rose-900/70 px-1.5 py-0.5 font-mono text-[11px] text-rose-200">
          {tip.kind}
        </span>
        {(tip.count ?? 1) > 1 && (
          <span
            className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold text-amber-100"
            title={tr('एउटै कारणले आएका error हरू · Errors with this same cause')}
          >
            ×{tip.count} {tr('error, एउटै कारण · errors, one cause')}
          </span>
        )}
      </div>
      {where && (
        <button
          className="mt-1.5 block text-left font-mono text-xs text-sky-300 underline-offset-2 hover:underline disabled:no-underline"
          disabled={!onOpen}
          title={tr('फाइल खोलेर त्यो लाइनमा जाऊ · Open the file at this line')}
          onClick={() => onOpen?.(tip)}
        >
          📍 {where}
        </button>
      )}
      <p className="mt-1 font-mono text-xs break-words text-rose-300">
        {tip.message}
      </p>
      <p className="mt-1.5 text-[13px] leading-5 text-amber-50">
        💡 {tr(tip.tip)}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {tip.fix && onFix && (
          <button className="btn-run" onClick={() => onFix(tip)}>
            {tr(tip.fix.label)}
          </button>
        )}
        {where && onOpen && (
          <button className="chip" onClick={() => onOpen(tip)}>
            {tr('📂 फाइल खोल · Open file')}
          </button>
        )}
        {onAsk && (
          <button className="chip" onClick={() => onAsk(tip)}>
            {tr('🧑‍🏫 Guru लाई विस्तारमा सोध · Ask Guru for details')}
          </button>
        )}
      </div>
    </div>
  );
}
