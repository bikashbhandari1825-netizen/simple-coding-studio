import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiErrorKind, ClaudeStatus } from '../../shared/types';
import { errorText } from '../lib/helpers';
import { tr } from '../i18n';

const LOGIN_WAIT_MS = 10 * 60 * 1000;

export interface ClaudeAccount {
  status: ClaudeStatus | null;
  /** Terminal मा login चलिरहेको छ — a login terminal is open and we are waiting for it. */
  waiting: boolean;
  error: string;
  login: (switchAccount: boolean) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<ClaudeStatus>;
  stopWaiting: () => void;
}

/**
 * Claude Code को login अवस्था र Login / Switch / Logout।
 * Claude Code sign-in state plus Login / Switch Account / Logout.
 */
export function useClaudeAccount(): ClaudeAccount {
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const baseline = useRef<ClaudeStatus | null>(null);

  const refresh = useCallback(async () => {
    const s = await window.studio.getClaudeStatus();
    setStatus(s);
    return s;
  }, []);

  useEffect(() => {
    void refresh();
    // Browser बाट फर्केपछि अवस्था फेरि पढ्ने — re-check when the user comes back from the browser.
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  // Terminal मा login सकिएसम्म हरेक ३ सेकेन्डमा जाँच्ने — poll every 3 s until the terminal login finishes.
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(async () => {
      const s = await refresh();
      const before = baseline.current;
      if (s.loggedIn && (!before?.loggedIn || s.email !== before.email))
        setWaiting(false);
    }, 3000);
    const stop = setTimeout(() => setWaiting(false), LOGIN_WAIT_MS);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [waiting, refresh]);

  const login = useCallback(
    async (switchAccount: boolean) => {
      setError('');
      const current = status ?? (await refresh());
      if (switchAccount && current.loggedIn) {
        const ok = window.confirm(
          tr(
            'यसले यो computer को Claude Code बाट पुरानो account logout गरेर नयाँ account जोड्छ (terminal मा चलिरहेको Claude Code मा पनि असर पर्छ)। अगाडि बढ्ने? — This logs Claude Code on this computer out of the current account and signs in again (it also affects Claude Code running in your terminals). Continue?',
          ),
        );
        if (!ok) return;
      }
      baseline.current = switchAccount
        ? { ...current, loggedIn: false }
        : current;
      try {
        await window.studio.claudeLogin(switchAccount && current.loggedIn);
        setWaiting(true);
      } catch (err) {
        setError(errorText(err));
      }
    },
    [refresh, status],
  );

  const logout = useCallback(async () => {
    const ok = window.confirm(
      tr(
        'यो computer को Claude Code बाट logout गर्ने? (terminal मा चलिरहेको Claude Code बाट पनि logout हुन्छ) — Log Claude Code out on this computer? (This also logs out Claude Code in your terminals.)',
      ),
    );
    if (!ok) return;
    setError('');
    try {
      setStatus(await window.studio.claudeLogout());
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  return {
    status,
    waiting,
    error,
    login,
    logout,
    refresh,
    stopWaiting: () => setWaiting(false),
  };
}

function WaitingBox({ account }: { account: ClaudeAccount }) {
  return (
    <div className="rounded-lg border border-sky-700 bg-sky-950/50 p-3 text-sm text-sky-100">
      <p className="animate-pulse">
        {tr(
          '⏳ कालो terminal window र browser खुल्यो। आफूले चाहेको email छानेर Authorize थिच्नुहोस्। — A terminal window and your browser opened; choose your email and authorize.',
        )}
      </p>
      <button
        className="btn-ghost mt-2"
        onClick={() => {
          account.stopWaiting();
          void account.refresh();
        }}
      >
        {tr('✓ सकियो · Done')}
      </button>
    </div>
  );
}

const planLabel = (s: ClaudeStatus) =>
  [
    s.email,
    s.plan ? `Claude ${s.plan.charAt(0).toUpperCase()}${s.plan.slice(1)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** Login नभएको बेला देखिने कार्ड (Guru र Settings) — The sign-in card shown in Guru and Settings. */
export function LoginCard({
  account,
}: {
  account: ClaudeAccount;
  compact?: boolean;
}) {
  const s = account.status;
  if (account.waiting) return <WaitingBox account={account} />;
  if (!s)
    return (
      <p className="text-xs text-slate-400">
        {tr('Claude Code जाँच्दै… · Checking Claude Code…')}
      </p>
    );
  if (!s.installed) {
    return (
      <div className="rounded-lg border border-amber-700 bg-amber-950/50 p-3 text-sm text-amber-200">
        {tr(
          'Claude Code यो computer मा भेटिएन। पहिले install गर्नुहोस्। — Claude Code is not installed on this computer.',
        )}{' '}
        <a
          href="https://claude.com/claude-code"
          target="_blank"
          rel="noreferrer"
          className="text-sky-300 underline"
        >
          claude.com/claude-code
        </a>
      </div>
    );
  }
  if (s.loggedIn) {
    return (
      <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 p-3 text-sm text-emerald-200">
        {tr('✅ Claude Code जोडिएको छ · Connected')}
        <div className="mt-1 text-xs text-emerald-100/80">{planLabel(s)}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="chip" onClick={() => void account.login(true)}>
            🔄 Switch Account
          </button>
          <button
            className="chip border-rose-700 text-rose-300"
            onClick={() => void account.logout()}
          >
            🚪 Logout
          </button>
        </div>
        {account.error && (
          <p className="mt-2 text-xs text-rose-400">{tr(account.error)}</p>
        )}
      </div>
    );
  }
  return (
    <div>
      <button
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d97757] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#e08a6c]"
        onClick={() => void account.login(false)}
      >
        🔗 Login with Claude
      </button>
      <p className="mt-1.5 text-[11px] leading-4 text-slate-400">
        {tr(
          'Terminal र browser खुल्छ, आफ्नो email छानेर Authorize थिच्नुहोस्। तपाईंको Claude subscription बाटै चल्छ, API key चाहिँदैन। — Opens a terminal and your browser; uses your Claude subscription, no API key.',
        )}
      </p>
      {account.error && (
        <p className="mt-2 text-xs text-rose-400">{tr(account.error)}</p>
      )}
    </div>
  );
}

/** माथिको toolbar र Guru मा सधैं देखिने account बटन — The always-visible account button. */
export function AccountMenu({ account }: { account: ClaudeAccount }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const s = account.status;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  if (!s) return null;
  if (!s.loggedIn) {
    return (
      <button
        className={`rounded-lg bg-[#d97757] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#e08a6c] disabled:opacity-60 ${account.waiting ? 'animate-pulse' : ''}`}
        disabled={!s.installed}
        title={
          s.installed
            ? tr('Claude Code मा login · Sign in to Claude Code')
            : tr('Claude Code install गर्नुहोस् · Install Claude Code')
        }
        onClick={() => void account.login(false)}
      >
        {account.waiting ? '⏳ Browser मा Authorize…' : '🔗 Login with Claude'}
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        className={`chip ${account.waiting ? 'animate-pulse' : ''}`}
        title="Switch Account / Logout"
        onClick={() => setOpen((o) => !o)}
      >
        👤 {s.email ?? 'Account'} ▾
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-slate-600 bg-slate-800 p-2 shadow-xl">
          {account.waiting ? (
            <WaitingBox account={account} />
          ) : (
            <>
              <p className="px-2 pb-2 text-[11px] text-slate-400">
                {planLabel(s)}
              </p>
              <button
                className="w-full rounded px-2 py-1.5 text-left text-sm text-slate-100 hover:bg-slate-700"
                onClick={() => {
                  setOpen(false);
                  void account.login(true);
                }}
              >
                {tr('🔄 Switch Account · अर्को email')}
              </button>
              <button
                className="w-full rounded px-2 py-1.5 text-left text-sm text-rose-300 hover:bg-slate-700"
                onClick={() => {
                  setOpen(false);
                  void account.logout();
                }}
              >
                🚪 Logout
              </button>
            </>
          )}
          {account.error && (
            <p className="mt-1 px-2 text-xs text-rose-400">
              {tr(account.error)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Guru को error मुनिका बटन — Buttons under a sign-in or usage-limit error. */
export function AccountFixActions({
  kind,
  account,
}: {
  kind: AiErrorKind;
  account: ClaudeAccount;
}) {
  if (account.waiting) return <WaitingBox account={account} />;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <button
        className="btn-primary"
        onClick={() =>
          void account.login(
            kind === 'limit' || Boolean(account.status?.loggedIn),
          )
        }
      >
        {kind === 'limit' ? '🔄 Switch Account' : '🔗 Login / Switch Account'}
      </button>
    </div>
  );
}
