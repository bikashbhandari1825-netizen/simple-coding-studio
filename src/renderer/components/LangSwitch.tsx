import type { UiLang } from '../i18n';

const OPTIONS: { id: UiLang; label: string; title: string }[] = [
  { id: 'ne', label: 'ने', title: 'नेपाली मात्र · Nepali only' },
  { id: 'en', label: 'EN', title: 'English मात्र · English only' },
  { id: 'both', label: 'ने+EN', title: 'दुवै भाषा · Both languages' },
];

/** माथिको toolbar को भाषा बटन — The UI language switch in the top bar. */
export function LangSwitch({
  value,
  onChange,
}: {
  value: UiLang;
  onChange: (lang: UiLang) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Language"
      className="flex gap-0.5 rounded-xl border border-white/10 bg-slate-950/50 p-0.5 backdrop-blur"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={`rounded-lg px-2 py-1 text-xs font-semibold ${
            value === o.id
              ? 'bg-gradient-to-br from-sky-500 to-violet-600 text-white shadow-[0_0_14px_-2px_rgba(139,92,246,0.7)]'
              : 'text-slate-300 hover:bg-white/10 hover:text-white'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
