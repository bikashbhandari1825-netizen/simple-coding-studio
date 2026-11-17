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
      className="flex overflow-hidden rounded-lg border border-slate-600"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={`px-2 py-1 text-xs font-semibold transition-colors ${
            value === o.id
              ? 'bg-sky-600 text-white'
              : 'text-slate-300 hover:bg-slate-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
