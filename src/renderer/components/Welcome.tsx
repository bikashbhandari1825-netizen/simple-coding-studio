import { useState } from 'react';
import { baseName, forgetRecent, loadRecent } from '../lib/helpers';
import { tr } from '../i18n';

interface Props {
  onOpenFolder: () => void;
  onNewFlutter: () => void;
  onOpenRecent: (path: string) => void;
}

export function Welcome({ onOpenFolder, onNewFlutter, onOpenRecent }: Props) {
  const [recent, setRecent] = useState(loadRecent);
  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <div className="w-full max-w-2xl">
        <h1 className="text-center text-3xl font-bold text-slate-100">
          Simple Coding Studio
        </h1>
        <p className="mt-1 text-center text-slate-400">
          {tr('सजिलो कोडिङ स्टुडियो · A friendly place to learn coding')}
        </p>

        <div className="mt-8 rounded-2xl border-2 border-dashed border-slate-600 bg-slate-800/40 p-8 text-center">
          <div className="text-5xl">📂</div>
          <p className="mt-3 text-lg text-slate-200">
            Project फोल्डर यहाँ तानेर छोड्नुहोस् (Drag & Drop)
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

        {recent.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-2 text-sm font-semibold text-slate-400 uppercase">
              {tr('हालै खोलेका · Recent')}
            </h2>
            <ul className="divide-y divide-slate-800 rounded-xl border border-slate-700 bg-slate-800/40">
              {recent.map((p) => (
                <li
                  key={p}
                  className="group flex items-center gap-3 px-4 py-2.5"
                >
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onOpenRecent(p)}
                    title={p}
                  >
                    <div className="truncate text-slate-100">
                      📁 {baseName(p)}
                    </div>
                    <div className="truncate text-xs text-slate-500">{p}</div>
                  </button>
                  <button
                    className="hidden text-xs text-slate-500 group-hover:block hover:text-rose-400"
                    title={tr('सूचीबाट हटाऊ · Remove from list')}
                    onClick={() => {
                      forgetRecent(p);
                      setRecent(loadRecent());
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
