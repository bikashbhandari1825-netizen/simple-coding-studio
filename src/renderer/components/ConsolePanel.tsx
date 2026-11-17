import { useEffect, useRef } from 'react';

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
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-1 text-xs">
        <span className="font-semibold text-slate-300">🖥️ नतिजा · Output</span>
        {running && (
          <span className="animate-pulse text-emerald-400">
            ● चल्दैछ · Running
          </span>
        )}
        <div className="flex-1" />
        {running && interactive && (
          <>
            <button
              className="chip"
              title="कोड बदलेपछि तुरुन्तै देखाउने · Apply code changes instantly"
              onClick={() => onKey('r')}
            >
              ⚡ Hot reload
            </button>
            <button
              className="chip"
              title="एप सुरुबाट फेरि चलाउने · Restart the app"
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
            ⏹ रोक · Stop
          </button>
        )}
        <button
          className="chip"
          onClick={onAskGuru}
          disabled={lines.length === 0}
          title="Guru लाई यो output बुझाउन भन · Ask Guru about this output"
        >
          🧑‍🏫 Guru लाई सोध · Ask Guru
        </button>
        <button className="chip" onClick={onClear}>
          🧹 सफा · Clear
        </button>
        <button className="icon-btn" title="लुकाऊ · Hide" onClick={onHide}>
          ▾
        </button>
      </div>
      <div className="flex-1 overflow-auto px-3 py-2 font-mono text-[13px] leading-5 whitespace-pre-wrap">
        {lines.length === 0 ? (
          <p className="text-slate-600">
            माथिको ▶ बटन थिचेर एप चलाउनुहोस्। नतिजा यहाँ देखिन्छ। — Press ▶ above to
            run; output appears here.
          </p>
        ) : (
          lines.map((l) => (
            <div key={l.id} className={COLORS[l.kind]}>
              {l.kind === 'command' ? `▶ ${l.text}` : l.text}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
