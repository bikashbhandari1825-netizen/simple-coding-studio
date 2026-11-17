import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AI_MODELS,
  type AiModelId,
  type SettingsInfo,
} from '../../shared/types';
import { errorText } from '../lib/helpers';
import { LoginCard, type ClaudeAccount } from './ClaudeAccount';

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label={title}
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-5 shadow-2xl"
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
      {hint && <p className="mb-3 text-sm text-slate-400">{hint}</p>}
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-sky-500"
      />
      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          रद्द · Cancel
        </button>
        <button
          className="btn-primary"
          disabled={busy || !value.trim()}
          onClick={() => void submit()}
        >
          {busy ? 'पर्खनुहोस्… · Working…' : confirmLabel}
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
      setMessage({ ok: true, text: 'Model बदलियो · Model changed' });
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    }
  };

  return (
    <Modal title="⚙️ सेटिङ · Settings" onClose={onClose}>
      <label className="mb-2 block text-sm font-medium text-slate-300">
        Claude account (Claude Code)
      </label>
      <LoginCard account={account} />
      <p className="mt-2 text-[11px] leading-4 text-slate-400">
        Guru ले यो computer मा login भएको Claude Code प्रयोग गर्छ, त्यसैले तपाईंको
        Claude subscription बाटै चल्छ। API key वा छुट्टै credit चाहिँदैन। — Guru uses
        the Claude Code sign-in on this computer, so it runs on your Claude
        subscription: no API key, no separate credits.
      </p>

      <label className="mt-5 mb-1 block text-sm font-medium text-slate-300">
        Guru model
      </label>
      <select
        value={settings.model}
        onChange={(e) => void changeModel(e.target.value as AiModelId)}
        className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-sky-500"
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
          {message.text}
        </p>
      )}
      <div className="mt-5 flex justify-end">
        <button className="btn-ghost" onClick={onClose}>
          बन्द · Close
        </button>
      </div>
    </Modal>
  );
}
