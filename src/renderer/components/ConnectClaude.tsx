import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClaudeLoginProgress, SettingsInfo } from '../../shared/types';
import { errorText } from '../lib/helpers';

export const BILLING_URL = 'https://console.anthropic.com/settings/billing';

/**
 * Claude login का सबै काम एकै ठाउँमा: जोड्ने, छुटाउने, र account फेर्ने।
 * All Claude-login actions in one place: connect, log out, and switch account.
 */
export function useClaudeLogin(
  settings: SettingsInfo,
  onChange: (s: SettingsInfo) => void,
) {
  const [progress, setProgress] = useState<ClaudeLoginProgress>({
    stage: 'idle',
    message: '',
  });
  const [error, setError] = useState('');
  const busy = progress.stage === 'installing' || progress.stage === 'waiting';
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const off = window.studio.onClaudeProgress(setProgress);
    return () => off();
  }, []);

  const refresh = useCallback(
    async () => onChange(await window.studio.getSettings()),
    [onChange],
  );

  const connect = useCallback(async () => {
    setError('');
    try {
      const ok = await window.studio.connectClaude();
      if (!ok) setError('Login रद्द भयो · Login cancelled');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setProgress({ stage: 'idle', message: '' });
      await refresh();
    }
  }, [refresh]);

  const logout = useCallback(async () => {
    setError('');
    try {
      await window.studio.disconnectClaude();
    } catch (err) {
      setError(errorText(err));
    }
    await refresh();
  }, [refresh]);

  /** पुरानो login हटाएर नयाँ account जोड्ने — Log out, then log in again with another account. */
  const switchAccount = useCallback(async () => {
    const s = settingsRef.current;
    if (s.hasApiKey) {
      const ok = window.confirm(
        'अहिले API key प्रयोग भइरहेको छ। Key हटाएर browser login बाट अर्को account जोड्ने? — An API key is in use. Remove it and connect another account through the browser?',
      );
      if (!ok) return;
      await window.studio.clearApiKey();
    }
    await logout();
    await connect();
  }, [connect, logout]);

  return { progress, busy, error, connect, logout, switchAccount };
}

/** Login चलिरहँदा देखिने सानो बाकस — The progress box shown while a login runs. */
function LoginProgress({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-sky-700 bg-sky-950/50 p-3 text-sm text-sky-100">
      <p className="animate-pulse">⏳ {message}</p>
      <p className="mt-1 text-[11px] text-sky-300">
        अर्को email चाहियो भने browser मा पहिले त्यो email बाट sign in गर्नुहोस्। — To
        use another email, sign in with it in the browser first.
      </p>
      <button
        className="btn-ghost mt-2"
        onClick={() => void window.studio.cancelClaudeLogin()}
      >
        रद्द · Cancel
      </button>
    </div>
  );
}

/** Settings र Guru मा देखिने "Connect with Claude" — The connect card used in Settings and Guru. */
export function ConnectClaude({
  settings,
  onChange,
  compact = false,
}: {
  settings: SettingsInfo;
  onChange: (s: SettingsInfo) => void;
  compact?: boolean;
}) {
  const login = useClaudeLogin(settings, onChange);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!settings.claudeConnected || compact) return;
    window.studio
      .getClaudeStatus()
      .then(setStatus)
      .catch(() => setStatus(''));
  }, [settings.claudeConnected, compact]);

  if (login.busy) return <LoginProgress message={login.progress.message} />;

  if (settings.claudeConnected) {
    return (
      <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 p-3 text-sm text-emerald-200">
        ✅ Claude account जोडिएको छ · Claude account connected
        {status && !compact && (
          <pre className="mt-2 max-h-28 overflow-auto rounded bg-slate-950/60 p-2 text-[11px] whitespace-pre-wrap text-slate-300">
            {status}
          </pre>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="chip" onClick={() => void login.switchAccount()}>
            🔄 Account फेर · Switch account
          </button>
          <button
            className="chip border-rose-700 text-rose-300"
            onClick={() => void login.logout()}
          >
            🚪 Logout
          </button>
        </div>
        {login.error && (
          <p className="mt-2 text-sm text-rose-400">{login.error}</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d97757] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#e08a6c]"
        onClick={() => void login.connect()}
      >
        🔗 Connect with Claude (Browser Login)
      </button>
      <p className="mt-1.5 text-[11px] leading-4 text-slate-400">
        Browser खुल्छ, आफ्नो account छानेर Allow थिच्नुहोस्। Key copy गर्नु पर्दैन। — Opens
        your browser; pick your account and approve.
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
      {login.error && (
        <p className="mt-2 text-sm text-rose-400">{login.error}</p>
      )}
    </div>
  );
}

/**
 * Guru को शीर्षकमा सधैं देखिने account बटन: Switch Account / Logout।
 * Always-visible account button in Guru's header with Switch Account / Logout.
 */
export function AccountMenu({
  settings,
  onChange,
}: {
  settings: SettingsInfo;
  onChange: (s: SettingsInfo) => void;
}) {
  const login = useClaudeLogin(settings, onChange);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  if (!settings.claudeConnected && !settings.hasApiKey) {
    return (
      <button
        className={`rounded-lg bg-[#d97757] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#e08a6c] ${login.busy ? 'animate-pulse' : ''}`}
        disabled={login.busy}
        title={
          login.progress.message ||
          'Browser मा Claude account authorize गर्नुहोस् · Authorize your Claude account in the browser'
        }
        onClick={() => void login.connect()}
      >
        {login.busy ? '⏳ Browser मा Allow थिच्नुहोस्…' : '🔗 Connect Claude'}
      </button>
    );
  }
  const label = settings.hasApiKey
    ? '🔑 API key · Account'
    : '👤 Account · Logout / Switch';

  return (
    <div ref={ref} className="relative">
      <button
        className={`chip ${login.busy ? 'animate-pulse' : ''}`}
        title="Account फेर्ने वा Logout · Switch account or log out"
        onClick={() => setOpen((o) => !o)}
      >
        {label} ▾
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-slate-600 bg-slate-800 p-2 shadow-xl">
          {login.busy ? (
            <LoginProgress message={login.progress.message} />
          ) : (
            <>
              <p className="px-2 pb-2 text-[11px] text-slate-400">
                {settings.hasApiKey
                  ? 'अहिले API key प्रयोग हुँदैछ · Using an API key'
                  : 'Browser login बाट जोडिएको · Connected through browser login'}
              </p>
              <button
                className="w-full rounded px-2 py-1.5 text-left text-sm text-slate-100 hover:bg-slate-700"
                onClick={() => void login.switchAccount()}
              >
                🔄 अर्को Account / Email · Switch account
              </button>
              {settings.claudeConnected && (
                <button
                  className="w-full rounded px-2 py-1.5 text-left text-sm text-rose-300 hover:bg-slate-700"
                  onClick={() => {
                    setOpen(false);
                    void login.logout();
                  }}
                >
                  🚪 Logout
                </button>
              )}
              <a
                href={BILLING_URL}
                target="_blank"
                rel="noreferrer"
                className="block rounded px-2 py-1.5 text-sm text-sky-300 hover:bg-slate-700"
              >
                💳 Credit थप्ने · Add credits
              </a>
            </>
          )}
          {login.error && (
            <p className="mt-1 px-2 text-xs text-rose-400">{login.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Credit सकिएको वा login पुरानो भएको error मुनि देखिने बटनहरू।
 * Buttons shown under an out-of-credit or expired-login error.
 */
export function AccountFixActions({
  kind,
  settings,
  onChange,
}: {
  kind: 'billing' | 'auth';
  settings: SettingsInfo;
  onChange: (s: SettingsInfo) => void;
}) {
  const login = useClaudeLogin(settings, onChange);
  if (login.busy) return <LoginProgress message={login.progress.message} />;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <button
        className="btn-primary"
        onClick={() => void login.switchAccount()}
      >
        🔄{' '}
        {kind === 'billing'
          ? 'अर्को Account जोड · Switch account'
          : 'फेरि जोड · Reconnect'}
      </button>
      {kind === 'billing' && (
        <a
          href={BILLING_URL}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost border border-slate-600"
        >
          💳 Credit थप · Add credits
        </a>
      )}
      {login.error && (
        <p className="w-full text-xs text-rose-400">{login.error}</p>
      )}
    </div>
  );
}
