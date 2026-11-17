import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AiChatMessage,
  AiContext,
  AiMode,
  AiErrorKind,
} from '../../shared/types';
import { errorText, newId } from '../lib/helpers';
import {
  AccountFixActions,
  AccountMenu,
  LoginCard,
  type ClaudeAccount,
} from './ClaudeAccount';
import { useVoiceInput } from '../voice/useVoiceInput';
import { Markdown } from './Markdown';

interface ChatItem {
  id: string;
  role: 'user' | 'assistant';
  /** API लाई पठाइने पाठ — Text sent to the API. */
  content: string;
  /** Chat मा देखाइने छोटो label — Short label shown in the chat (user turns). */
  label?: string;
  error?: string;
  errorKind?: AiErrorKind;
  streaming?: boolean;
}

export interface TutorRequest {
  mode: AiMode;
  label: string;
  prompt: string;
  context?: AiContext;
}

interface Props {
  account: ClaudeAccount;
  getContext: () => AiContext;
  /** बाहिरबाट पठाइएको प्रश्न (जस्तै console को "Guru लाई सोध") — A request pushed from outside. */
  pending: TutorRequest | null;
  onPendingHandled: () => void;
}

export function TutorPanel({
  account,
  getContext,
  pending,
  onPendingHandled,
}: Props) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // बोलेको कुरा input मा थप्ने — append spoken text to the input box.
  const voice = useVoiceInput((text) =>
    setInput((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text)),
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [items]);

  useEffect(() => {
    const off = window.studio.onAiEvent((event) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== event.requestId) return item;
          if (event.type === 'text')
            return { ...item, content: item.content + event.text };
          if (event.type === 'error')
            return {
              ...item,
              streaming: false,
              error: event.message,
              errorKind: event.kind,
            };
          return { ...item, streaming: false };
        }),
      );
      if (event.type !== 'text')
        setBusyId((id) => (id === event.requestId ? null : id));
    });
    return () => off();
  }, []);

  const ask = useCallback(
    async (req: TutorRequest) => {
      if (busyId) return;
      const requestId = newId();
      // पहिलेका सफल कुराकानी मात्र इतिहासमा पठाउने — Send only completed, successful turns as history.
      const history: AiChatMessage[] = [];
      for (let i = 0; i + 1 < items.length; i++) {
        const u = items[i];
        const a = items[i + 1];
        if (
          u.role === 'user' &&
          a.role === 'assistant' &&
          !a.error &&
          a.content
        ) {
          history.push(
            { role: 'user', content: u.content },
            { role: 'assistant', content: a.content },
          );
          i++;
        }
      }
      const recent = history.slice(-12);
      setItems((prev) => [
        ...prev,
        { id: newId(), role: 'user', content: req.prompt, label: req.label },
        { id: requestId, role: 'assistant', content: '', streaming: true },
      ]);
      setBusyId(requestId);
      try {
        await window.studio.askAi({
          requestId,
          mode: req.mode,
          messages: [...recent, { role: 'user', content: req.prompt }],
          context: req.context,
        });
      } catch (err) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === requestId
              ? { ...it, streaming: false, error: errorText(err) }
              : it,
          ),
        );
        setBusyId(null);
      }
    },
    [busyId, items],
  );

  useEffect(() => {
    if (pending && !busyId) {
      onPendingHandled();
      void ask(pending);
    }
  }, [pending, busyId, ask, onPendingHandled]);

  const sendTyped = () => {
    const text = input.trim();
    if (!text || busyId) return;
    setInput('');
    const ctx = getContext();
    void ask({
      mode: 'chat',
      label: text,
      prompt: text,
      context: { ...ctx, runOutput: undefined },
    });
  };

  const quick = (mode: AiMode) => {
    const ctx = getContext();
    if (mode === 'explain') {
      if (!ctx.code && !ctx.selection) return;
      const what = ctx.selection
        ? 'छानेको कोड · the selected code'
        : `${ctx.fileName ?? 'यो फाइल'}`;
      void ask({
        mode,
        label: `📖 बुझाऊ: ${what}`,
        prompt: `Please explain ${ctx.selection ? 'the selected code' : 'this file'}.`,
        context: { ...ctx, runOutput: undefined },
      });
    } else if (mode === 'fix') {
      void ask({
        mode,
        label: '🩺 मेरो कोडमा गल्ती खोज · Find mistakes in my code',
        prompt:
          'Please review my code for mistakes (syntax, brackets, logic) and tell me exactly how to fix each one.',
        context: ctx,
      });
    }
  };

  const startBlueprint = () => {
    const text = input.trim();
    if (!text) {
      setInput('मलाई यस्तो एप बनाउनु छ: ');
      return;
    }
    setInput('');
    void ask({
      mode: 'blueprint',
      label: `🗺️ योजना: ${text}`,
      prompt: text,
      context: { projectKind: getContext().projectKind },
    });
  };

  const hasCode = Boolean(getContext().code);

  return (
    <div className="flex h-full flex-col bg-slate-900">
      <div className="flex items-center gap-2 border-b border-slate-700 px-3 py-2">
        <span className="text-lg">🧑‍🏫</span>
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-100">
            Guru — AI शिक्षक
          </div>
          <div className="text-[11px] text-slate-400">
            नेपाली + English मा बुझाउँछ
          </div>
        </div>
        {items.length > 0 && !busyId && (
          <button
            className="chip"
            onClick={() => setItems([])}
            title="नयाँ कुराकानी · New conversation"
          >
            ✨ नयाँ · New
          </button>
        )}
        <AccountMenu account={account} />
      </div>

      {(account.waiting || (account.status && !account.status.loggedIn)) && (
        <div className="m-3 rounded-lg border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200">
          <p className="mb-2">
            Guru चलाउन Claude Code मा login गर्नुहोस्। — Sign in to Claude Code to
            use Guru.
          </p>
          <LoginCard account={account} compact />
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-auto px-3 py-3">
        {items.length === 0 && (
          <div className="space-y-2 text-sm text-slate-400">
            <p>
              नमस्ते! म तपाईंको coding शिक्षक हुँ। तलका बटन थिच्नुहोस् वा जे पनि सोध्नुहोस्।
            </p>
            <p>
              Hi! I'm your coding tutor. Use the buttons below or ask me
              anything.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              <li>
                📖 खुला फाइल वा छानेको कोड लाइन-लाइन बुझाउँछु · I explain code line
                by line
              </li>
              <li>
                🩺 तपाईंको कोडका गल्ती खोजेर सच्याउने तरिका बताउँछु · I find and
                explain mistakes
              </li>
              <li>
                🗺️ नयाँ एपको चरणबद्ध योजना बनाउँछु · I plan new apps step by step
              </li>
            </ul>
          </div>
        )}
        {items.map((item) =>
          item.role === 'user' ? (
            <div
              key={item.id}
              className="ml-6 rounded-lg bg-sky-900/60 px-3 py-2 text-sm whitespace-pre-wrap text-sky-50"
            >
              {item.label ?? item.content}
            </div>
          ) : (
            <div
              key={item.id}
              className="rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-2 text-sm text-slate-100"
            >
              {item.content ? (
                <Markdown text={item.content} />
              ) : item.streaming ? (
                <span className="animate-pulse text-slate-400">
                  Guru सोच्दैछ… · thinking…
                </span>
              ) : null}
              {item.error && (
                <p className="mt-1 text-rose-400">⚠️ {item.error}</p>
              )}
              {item.error && item.errorKind && (
                <AccountFixActions kind={item.errorKind} account={account} />
              )}
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-slate-700 p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button
            className="chip"
            disabled={!!busyId || !hasCode}
            onClick={() => quick('explain')}
          >
            📖 बुझाऊ · Explain
          </button>
          <button
            className="chip"
            disabled={!!busyId || !hasCode}
            onClick={() => quick('fix')}
          >
            🩺 गल्ती खोज · Check
          </button>
          <button className="chip" disabled={!!busyId} onClick={startBlueprint}>
            🗺️ एप योजना · Plan app
          </button>
        </div>
        {voice.state.stage !== 'idle' && (
          <p className="mb-1.5 text-xs text-sky-300">
            {voice.state.stage === 'recording' &&
              `🔴 सुन्दैछु… ${voice.state.seconds}s — फेरि 🎤 थिच्दा रोकिन्छ · Listening… press 🎤 again to stop`}
            {voice.state.stage === 'loading' &&
              `⬇️ आवाज बुझ्ने model ल्याउँदै (पहिलोपटक मात्र, ~240MB) ${voice.state.progress}% · Downloading the speech model (first time only)`}
            {voice.state.stage === 'transcribing' &&
              '✍️ अक्षरमा बदल्दै… · Turning speech into text…'}
          </p>
        )}
        {voice.error && (
          <p
            className="mb-1.5 text-xs text-rose-400"
            onClick={voice.clearError}
          >
            {voice.error}
          </p>
        )}
        <div className="flex gap-2">
          <div className="flex flex-col gap-1">
            <button
              className={`rounded-lg px-2.5 py-1.5 text-base ${
                voice.state.stage === 'recording'
                  ? 'animate-pulse bg-rose-600 text-white'
                  : 'border border-slate-600 text-slate-200 hover:bg-slate-700'
              } disabled:opacity-40`}
              title="बोलेर लेख्नुहोस् (Voice) · Speak instead of typing"
              disabled={
                voice.state.stage === 'loading' ||
                voice.state.stage === 'transcribing'
              }
              onClick={voice.toggle}
            >
              🎤
            </button>
            <button
              className="rounded border border-slate-600 px-1 text-[10px] text-slate-300 hover:bg-slate-700"
              title="बोल्ने भाषा · Speaking language"
              disabled={voice.state.stage !== 'idle'}
              onClick={() =>
                voice.setLanguage(
                  voice.language === 'nepali' ? 'english' : 'nepali',
                )
              }
            >
              {voice.language === 'nepali' ? 'ने' : 'EN'}
            </button>
          </div>
          <textarea
            value={input}
            rows={2}
            placeholder="प्रश्न लेख्नुहोस्… (Enter = पठाउ, Shift+Enter = नयाँ लाइन)"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (input.startsWith('मलाई यस्तो एप बनाउनु छ')) startBlueprint();
                else sendTyped();
              }
            }}
            className="min-w-0 flex-1 resize-none rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
          {busyId ? (
            <button
              className="btn-ghost"
              onClick={() => void window.studio.cancelAi(busyId)}
            >
              ⏹
            </button>
          ) : (
            <button
              className="btn-primary"
              disabled={!input.trim()}
              onClick={sendTyped}
            >
              ➤
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
