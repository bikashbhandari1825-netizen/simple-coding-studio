import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AI_MODELS,
  type AiModelId,
  type FlutterTemplateId,
  type SettingsInfo,
} from '../../shared/types';
import { errorText } from '../lib/helpers';
import { diffStats, lineDiff } from '../lib/diff';
import { LoginCard, type ClaudeAccount } from './ClaudeAccount';
import { tr } from '../i18n';

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  /** चौडा dialog (प्रगति ड्यासबोर्ड) — a wider dialog */
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label={title}
        className={`glass-pop max-h-[90vh] w-full overflow-auto rounded-2xl p-5 ${wide ? 'max-w-3xl' : 'max-w-md'}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-100">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** नाम सोध्ने सानो dialog (Electron मा window.prompt चल्दैन) — Name prompt; window.prompt does not exist in Electron. */
export function PromptDialog({
  title,
  hint,
  placeholder,
  confirmLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  hint?: string;
  placeholder?: string;
  confirmLabel: string;
  onSubmit: (value: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      {hint && <p className="mb-3 text-sm text-slate-400">{tr(hint)}</p>}
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        className="glass-input w-full rounded-xl px-3 py-2 text-slate-100 outline-none"
      />
      {error && <p className="mt-2 text-sm text-rose-400">{tr(error)}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          {tr('रद्द · Cancel')}
        </button>
        <button
          className="btn-primary"
          disabled={busy || !value.trim()}
          onClick={() => void submit()}
        >
          {busy ? tr('पर्खनुहोस्… · Working…') : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** 🔍 बदलावको पूर्वावलोकन (diff) र एक-क्लिक लगाउने — change preview (diff) with a one-click apply. */
export function DiffDialog({
  fileName,
  before,
  after,
  note,
  onApply,
  onClose,
}: {
  fileName: string;
  before: string;
  after: string;
  note?: string;
  onApply: () => void;
  onClose: () => void;
}) {
  const lines = lineDiff(before, after);
  const { added, removed } = diffStats(lines);
  // बदलिएको ठाउँ वरिपरि ३ लाइन मात्र देखाउने — show only 3 lines of context around each change
  const CONTEXT = 3;
  const show = Array.from({ length: lines.length }, () => false);
  lines.forEach((l, i) => {
    if (l.type === 'same') return;
    const from = Math.max(0, i - CONTEXT);
    const to = Math.min(lines.length - 1, i + CONTEXT);
    for (let k = from; k <= to; k++) show[k] = true;
  });
  const gapText = (n: number) => `⋯ ${n} ${tr('लाइन उस्तै · unchanged lines')}`;
  const rows: {
    key: number;
    type: 'same' | 'add' | 'del' | 'gap';
    text: string;
  }[] = [];
  let gap = 0;
  lines.forEach((l, i) => {
    if (show[i]) {
      if (gap) rows.push({ key: -i - 1, type: 'gap', text: gapText(gap) });
      gap = 0;
      rows.push({ key: i, type: l.type, text: l.text });
    } else gap++;
  });
  if (gap) rows.push({ key: -999999, type: 'gap', text: gapText(gap) });
  const same = added === 0 && removed === 0;
  return (
    <Modal
      title={tr(`🔍 बदलाव हेर्नुहोस् · Review the change — ${fileName}`)}
      onClose={onClose}
      wide
    >
      <p className="mb-2 text-sm text-slate-300">
        <span className="text-emerald-400">+{added}</span>{' '}
        <span className="text-rose-400">−{removed}</span> {tr('लाइन · lines')}
        {note ? <span className="text-slate-400"> · {note}</span> : null}
      </p>
      <div
        data-testid="diff-view"
        className="max-h-[52vh] overflow-auto rounded-xl border border-white/10 bg-black/30 font-mono text-xs leading-5"
      >
        {same ? (
          <p className="p-3 text-slate-400">
            {tr('कुनै फरक छैन · No difference')}
          </p>
        ) : (
          rows.map((r) => (
            <div
              key={r.key}
              className={`px-3 whitespace-pre-wrap ${
                r.type === 'add'
                  ? 'bg-emerald-500/15 text-emerald-200'
                  : r.type === 'del'
                    ? 'bg-rose-500/15 text-rose-200'
                    : r.type === 'gap'
                      ? 'text-slate-500 italic'
                      : 'text-slate-300'
              }`}
            >
              {r.type === 'add' ? '+ ' : r.type === 'del' ? '− ' : '  '}
              {r.text}
            </div>
          ))
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {tr(
          'लगाएपछि Ctrl+Z ले फर्कन सकिन्छ; Ctrl+S ले सेभ हुन्छ · After applying, Ctrl+Z undoes it and Ctrl+S saves.',
        )}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          {tr('रद्द · Cancel')}
        </button>
        <button className="btn-primary" disabled={same} onClick={onApply}>
          {tr('✅ फाइलमा लगाऊ · Apply to file')}
        </button>
      </div>
    </Modal>
  );
}

const TEMPLATES: {
  id: FlutterTemplateId;
  icon: string;
  ne: string;
  en: string;
  desc: string;
}[] = [
  {
    id: 'basic',
    icon: '🔢',
    ne: 'सामान्य / Counter UI',
    en: 'Basic / Counter UI',
    desc: 'सबैभन्दा सरल सुरुवात — Flutter को आफ्नै Counter एप · The simplest start: the stock Counter app.',
  },
  {
    id: 'firebase',
    icon: '🔥',
    ne: 'Firebase Auth + Firestore',
    en: 'Firebase Auth + Firestore',
    desc: 'Login/Register र हरेक user को आफ्नै Notes · Email login and per-user notes (needs Firebase setup).',
  },
  {
    id: 'map',
    icon: '🗺️',
    ne: 'Real-time नक्सा + Counter-offer',
    en: 'Real-time Map + Counter-offer',
    desc: 'नक्सामा Pickup/Drop, यात्रुको offer र चालकको counter-offer live · Map, passenger offer and live driver counter-offers (needs Firebase setup).',
  },
];

/** नयाँ Flutter एप: starter छान्ने + नाम — pick a starter and a name for a new Flutter app. */
export function NewFlutterDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (name: string, template: FlutterTemplateId) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<FlutterTemplateId>('basic');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit(name.trim(), template);
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={tr('✨ नयाँ Flutter एप · New Flutter app')} onClose={onClose}>
      <p className="mb-2 text-sm text-slate-400">
        {tr('१) Starter छान्नुहोस् · Pick a starter')}
      </p>
      <div role="radiogroup" className="mb-4 flex flex-col gap-2">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={template === t.id}
            data-template={t.id}
            onClick={() => setTemplate(t.id)}
            className={`rounded-xl border px-3 py-2 text-left transition-colors ${
              template === t.id
                ? 'border-sky-400/70 bg-sky-400/10'
                : 'border-white/10 hover:bg-white/5'
            }`}
          >
            <div className="font-medium text-slate-100">
              {t.icon} {tr(`${t.ne} · ${t.en}`)}
            </div>
            <div className="text-xs text-slate-400">{tr(t.desc)}</div>
          </button>
        ))}
      </div>
      <p className="mb-2 text-sm text-slate-400">
        {tr(
          '२) नाम सानो अंग्रेजी अक्षरमा, खाली ठाउँको सट्टा _ (जस्तै nepali_quiz) — Lowercase name with _',
        )}
      </p>
      <input
        ref={inputRef}
        value={name}
        placeholder="my_first_app"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        className="glass-input w-full rounded-xl px-3 py-2 text-slate-100 outline-none"
      />
      <p className="mt-2 text-xs text-slate-500">
        {tr(
          'त्यसपछि project राख्ने फोल्डर छान्नुहोस् · Then choose where to save it.',
        )}
      </p>
      {error && <p className="mt-2 text-sm text-rose-400">{tr(error)}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          {tr('रद्द · Cancel')}
        </button>
        <button
          className="btn-primary"
          disabled={busy || !name.trim()}
          onClick={() => void submit()}
        >
          {busy ? tr('पर्खनुहोस्… · Working…') : tr('बनाऊ · Create')}
        </button>
      </div>
    </Modal>
  );
}

export function SettingsDialog({
  account,
  settings,
  onChange,
  onClose,
}: {
  account: ClaudeAccount;
  settings: SettingsInfo;
  onChange: (s: SettingsInfo) => void;
  onClose: () => void;
}) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const changeModel = async (model: AiModelId) => {
    try {
      onChange(await window.studio.setModel(model));
      setMessage({ ok: true, text: tr('Model बदलियो · Model changed') });
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    }
  };

  return (
    <Modal title={tr('⚙️ सेटिङ · Settings')} onClose={onClose}>
      <label className="mb-2 block text-sm font-medium text-slate-300">
        Claude account (Claude Code)
      </label>
      <LoginCard account={account} />
      <p className="mt-2 text-[11px] leading-4 text-slate-400">
        {tr(
          'Guru ले यो computer मा login भएको Claude Code प्रयोग गर्छ, त्यसैले तपाईंको Claude subscription बाटै चल्छ। API key वा छुट्टै credit चाहिँदैन। — Guru uses the Claude Code sign-in on this computer, so it runs on your Claude subscription: no API key, no separate credits.',
        )}
      </p>

      <label className="mt-5 mb-1 block text-sm font-medium text-slate-300">
        Guru model
      </label>
      <select
        value={settings.model}
        onChange={(e) => void changeModel(e.target.value as AiModelId)}
        className="glass-input w-full rounded-xl px-3 py-2 text-slate-100 outline-none"
      >
        {AI_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>

      {message && (
        <p
          className={`mt-3 text-sm ${message.ok ? 'text-emerald-400' : 'text-rose-400'}`}
        >
          {tr(message.text)}
        </p>
      )}
      <div className="mt-5 flex justify-end">
        <button className="btn-ghost" onClick={onClose}>
          {tr('बन्द · Close')}
        </button>
      </div>
    </Modal>
  );
}
