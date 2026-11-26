import { useState } from 'react';
import { baseName, forgetRecent, loadRecent } from '../lib/helpers';
import { tr } from '../i18n';

interface Props {
  onOpenFolder: () => void;
  onNewFlutter: () => void;
  onOpenRecent: (path: string) => void;
  /** 🗑️ project फोल्डर मेटाउन माग्ने — ask to delete a project folder */
  onDeleteProject?: (path: string) => void;
  /** अहिले खुलेको project — the project that is still open */
  currentProject?: string;
  onBack?: () => void;
}

// फोल्डरको नामबाट सधैँ उही रङ — a stable accent colour per project name.
const ACCENTS = [
  'from-sky-500 to-cyan-400',
  'from-violet-500 to-fuchsia-500',
  'from-emerald-500 to-teal-400',
  'from-amber-500 to-orange-500',
  'from-pink-500 to-rose-500',
  'from-indigo-500 to-sky-500',
];
const accentFor = (name: string) =>
  ACCENTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % ACCENTS.length];

/** 🌌 स्वागत पृष्ठ: drag & drop क्षेत्र र हालै खोलेका project — the welcome dashboard. */
export function Welcome({
  onOpenFolder,
  onNewFlutter,
  onOpenRecent,
  onDeleteProject,
  currentProject,
  onBack,
}: Props) {
  const [recent, setRecent] = useState(loadRecent);
  const [over, setOver] = useState(false);
  return (
    <div className="flex h-full items-start justify-center overflow-auto p-6 md:items-center">
      <div className="welcome-in w-full max-w-3xl py-6">
        {/* Hero */}
        <div className="flex flex-col items-center text-center">
          <div className="orb grid h-16 w-16 place-items-center rounded-2xl text-3xl">
            🎓
          </div>
          <h1 className="brand mt-4 text-4xl tracking-tight">
            Simple Coding Studio
          </h1>
          <p className="mt-2 text-slate-300">
            {tr(
              'नेपाली + English मा सिक्ने तपाईंको आफ्नै AI कोडिङ स्टुडियो · Your own AI coding studio, in Nepali + English',
            )}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2 text-[11px] text-slate-300">
            {[
              tr('🧑‍🏫 AI गुरु · AI tutor'),
              tr('🎤 बोलेर लेख्ने · Voice typing'),
              tr('🔊 नेपालीमा सुन्ने · Listen in Nepali'),
              tr('▶ Chrome मा चलाउने · Run in Chrome'),
            ].map((f) => (
              <span
                key={f}
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 backdrop-blur"
              >
                {f}
              </span>
            ))}
          </div>
        </div>

        {currentProject && onBack && (
          <button
            data-testid="welcome-back"
            className="btn-primary mt-6 w-full px-5 py-3 text-base"
            onClick={onBack}
          >
            {tr('↩ फर्क · Back to')} {baseName(currentProject)}
          </button>
        )}

        {/* Drop zone */}
        <div
          className={`dropzone mt-8 rounded-3xl p-[1.5px] ${over ? 'dropzone-over' : ''}`}
          onDragEnter={() => setOver(true)}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setOver(false);
          }}
          onDrop={() => setOver(false)}
        >
          <div className="rounded-[calc(1.5rem-1.5px)] bg-slate-950/80 px-8 py-9 text-center backdrop-blur-xl">
            <div
              className={`mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/5 text-4xl transition-transform duration-300 ${over ? 'scale-110' : 'float'}`}
            >
              📂
            </div>
            <p className="mt-4 text-lg font-semibold text-slate-100">
              Project फोल्डर यहाँ तानेर छोड्नुहोस्{' '}
              <span className="text-slate-400">(Drag & Drop)</span>
            </p>
            <p className="text-sm text-slate-400">
              Drag a project folder anywhere onto this window
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                className="btn-primary px-5 py-2.5 text-base"
                onClick={onOpenFolder}
              >
                {tr('📁 फोल्डर खोल · Open folder')}
              </button>
              <button
                className="btn-secondary px-5 py-2.5 text-base"
                onClick={onNewFlutter}
              >
                {tr('✨ नयाँ Flutter एप · New Flutter app')}
              </button>
            </div>
          </div>
        </div>

        {/* Recent projects */}
        {recent.length > 0 && (
          <div className="mt-9">
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-xs font-bold tracking-[0.18em] text-slate-400 uppercase">
                {tr('हालै खोलेका · Recent')}
              </h2>
              <div className="h-px flex-1 bg-gradient-to-r from-violet-500/40 to-transparent" />
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {recent.map((p) => {
                const name = baseName(p);
                return (
                  <li key={p} className="group relative">
                    <button
                      className="recent-card flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left"
                      onClick={() => onOpenRecent(p)}
                      title={p}
                    >
                      <span
                        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${accentFor(name)} text-base font-bold text-white shadow-lg`}
                      >
                        {name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-100">
                          {name}
                        </span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {p}
                        </span>
                      </span>
                      <span className="text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-sky-300">
                        ›
                      </span>
                    </button>
                    {onDeleteProject && (
                      <button
                        data-testid="recent-delete"
                        className="absolute -right-1.5 -bottom-1.5 hidden h-5 w-5 place-items-center rounded-full border border-white/10 bg-slate-900 text-[10px] group-hover:grid hover:border-rose-400/60"
                        title={tr(
                          'फोल्डर नै मेटाऊ (Recycle Bin मा) · Delete the folder (to Recycle Bin)',
                        )}
                        aria-label="Delete project folder"
                        onClick={() => onDeleteProject(p)}
                      >
                        🗑️
                      </button>
                    )}
                    <button
                      className="absolute -top-1.5 -right-1.5 hidden h-5 w-5 place-items-center rounded-full border border-white/10 bg-slate-900 text-[10px] text-slate-400 group-hover:grid hover:border-rose-400/60 hover:text-rose-300"
                      title={tr('सूचीबाट हटाऊ · Remove from list')}
                      aria-label="Remove from recent"
                      onClick={() => {
                        forgetRecent(p);
                        setRecent(loadRecent());
                      }}
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <p className="mt-8 text-center text-[11px] text-slate-500">
          {tr(
            'छिटो: Ctrl+P फाइल खोज · Ctrl+S सेभ — Shortcuts: Ctrl+P find file · Ctrl+S save',
          )}
        </p>
      </div>
    </div>
  );
}
