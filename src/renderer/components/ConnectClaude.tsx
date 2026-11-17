import { useEffect, useState } from 'react';
import type { ClaudeLoginProgress, SettingsInfo } from '../../shared/types';
import { errorText } from '../lib/helpers';

/**
 * "Connect with Claude" बटन — browser मा login गरेर account जोड्ने।
 * The "Connect with Claude" button: links an account through a browser login, no API key to copy.
 */
export function ConnectClaude({
  settings,
  onChange,
  compact = false,
}: {
  settings: SettingsInfo;
  onChange: (s: SettingsInfo) => void;
  compact?: boolean;
}) {
  const [progress, setProgress] = useState<ClaudeLoginProgress>({
    stage: 'idle',
    message: '',
  });
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const busy = progress.stage === 'installing' || progress.stage === 'waiting';

  useEffect(() => {
    const off = window.studio.onClaudeProgress(setProgress);
    return () => off();
  }, []);

  useEffect(() => {
    if (!settings.claudeConnected || compact) return;
    window.studio
      .getClaudeStatus()
      .then(setStatus)
      .catch(() => setStatus(''));
  }, [settings.claudeConnected, compact]);

  const connect = async () => {
    setError('');
    try {
      const ok = await window.studio.connectClaude();
      if (!ok) setError('Login रद्द भयो · Login cancelled');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setProgress({ stage: 'idle', message: '' });
      onChange(await window.studio.getSettings());
    }
  };

  const disconnect = async () => {
    setError('');
    try {
      await window.studio.disconnectClaude();
    } catch (err) {
      setError(errorText(err));
    }
    onChange(await window.studio.getSettings());
  };

  if (settings.claudeConnected) {
    return (
      <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 p-3 text-sm text-emerald-200">
        ✅ Claude account जोडिएको छ · Claude account connected
        {status && !compact && (
          <pre className="mt-2 max-h-28 overflow-auto rounded bg-slate-950/60 p-2 text-[11px] whitespace-pre-wrap text-slate-300">
            {status}
          </pre>
        )}
        {!compact && (
          <button
            className="mt-2 block text-xs text-rose-300 hover:underline"
            onClick={() => void disconnect()}
          >
            Account छुटाऊ · Disconnect
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      {busy ? (
        <div className="rounded-lg border border-sky-700 bg-sky-950/50 p-3 text-sm text-sky-100">
          <p className="animate-pulse">⏳ {progress.message}</p>
          <button
            className="btn-ghost mt-2"
            onClick={() => void window.studio.cancelClaudeLogin()}
          >
            रद्द · Cancel
          </button>
        </div>
      ) : (
        <button
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d97757] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#e08a6c]"
          onClick={() => void connect()}
        >
          🔗 Connect with Claude (Browser Login)
        </button>
      )}
      {!busy && (
        <p className="mt-1.5 text-[11px] leading-4 text-slate-400">
          Browser खुल्छ, आफ्नो account छानेर Allow थिच्नुहोस्। Key copy गर्नु पर्दैन। —
          Opens your browser; pick your account and approve.
          {!compact && (
            <>
              <br />
              यो Anthropic Console (API) account हो। खर्च त्यसको API credit बाट
              कटिन्छ, Claude.ai Pro/Max subscription बाट होइन। — Uses your
              Anthropic Console (API) account and its credits, not a Claude.ai
              Pro/Max plan.
            </>
          )}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
    </div>
  );
}
