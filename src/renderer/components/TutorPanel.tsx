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
import { getUiLang, tr, tr2 } from '../i18n';
import { VoiceWave } from '../voice/VoiceWave';
import { SpeakWave } from '../voice/SpeakWave';
import { useSpeaker } from '../voice/useSpeaker';

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
  /** Editor मा अहिले देखिएका गल्तीहरू — errors currently shown in the editor */
  editorErrors: EditorError[];
  activeFile: string | null;
  onJumpTo: (line: number, column: number) => void;
}

export interface EditorError {
  line: number;
  column: number;
  message: string;
  source: string;
}

const AUTO_KEY = 'studio.guruAutoExplain';
/** टाइप गर्न रोकेपछि यति बेर पर्खेर मात्र Guru आफैं बोलाउने — wait this long after typing stops. */
const AUTO_DELAY_MS = 3500;
/** Guru आफैं बोलाउने बीचको न्यूनतम अन्तर (Claude को usage बचाउन) — minimum gap between automatic calls. */
const AUTO_MIN_GAP_MS = 20_000;

export function TutorPanel({
  account,
  getContext,
  pending,
  onPendingHandled,
  editorErrors,
  activeFile,
  onJumpTo,
}: Props) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // बोल्दै गर्दा शब्दहरू तुरुन्तै input मा देखाउने — show spoken words in the input box live.
  // रेकर्डिङ सुरु हुँदा box मा भएको पाठ यहीँ एकपटक मात्र समात्ने (React को ढिलो update मा भर नपर्ने)।
  // Capture the box's text once, when dictation starts, without relying on a deferred state updater.
  const inputRef = useRef(input);
  inputRef.current = input;
  const voiceBase = useRef('');
  const joinBase = (text: string) => {
    const base = voiceBase.current;
    return base && text ? `${base} ${text}` : base || text;
  };
  const voice = useVoiceInput(
    (text) => {
      // नयाँ रेकर्डिङ सुरु हुँदा (text खाली) box को पाठ समात्ने — capture the box text when a recording starts.
      if (!text && voice.state.stage === 'idle')
        voiceBase.current = inputRef.current.trimEnd();
      setInput(joinBase(text));
    },
    (shown, better) => {
      // तपाईंले पाठ नछोएको भए मात्र सुधारिएको पाठ राख्ने — replace only if you have not edited or sent it.
      setInput((prev) => (prev === joinBase(shown) ? joinBase(better) : prev));
    },
  );
  const listening = voice.state.stage === 'recording';
  // 🔊 Guru को जवाफ पढ्ने — read Guru's answers aloud
  const speaker = useSpeaker();

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
          answerLang: getUiLang(),
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

  // ---------- Smart Guru Error Diagnostics ----------
  const [autoExplain, setAutoExplain] = useState(() => {
    try {
      return localStorage.getItem(AUTO_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const lastExplained = useRef('');
  const lastAutoAt = useRef(0);
  const errorSignature = activeFile
    ? `${activeFile}|${editorErrors.map((e) => `${e.line}:${e.message}`).join('|')}`
    : '';

  const explainErrors = useCallback(
    (auto: boolean) => {
      if (!activeFile || editorErrors.length === 0) return;
      lastExplained.current = errorSignature;
      if (auto) lastAutoAt.current = Date.now();
      const list = editorErrors
        .slice(0, 8)
        .map(
          (e) =>
            `- line ${e.line}, column ${e.column} (${e.source}): ${e.message}`,
        )
        .join('\n');
      void ask({
        mode: 'fix',
        label: tr(
          `${auto ? '🤖 ' : ''}🩺 ${activeFile} मा ${editorErrors.length} गल्ती — किन भयो र कसरी सच्याउने · ${editorErrors.length} error(s) in ${activeFile}: why and how to fix`,
        ),
        prompt: `My code editor shows these errors in ${activeFile}:
${list}

For each error: say which line, explain in simple words why it happened (what the rule is), then show the corrected line(s) of code. Finish with a short tip so I avoid this mistake next time.`,
        context: { ...getContext(), runOutput: undefined },
      });
    },
    [activeFile, editorErrors, errorSignature, ask, getContext],
  );

  // टाइप गर्न रोकेपछि नयाँ गल्ती रहिरहे Guru आफैं बुझाउँछ — after typing pauses, Guru explains new errors by itself.
  useEffect(() => {
    if (!autoExplain || !errorSignature || editorErrors.length === 0) return;
    if (errorSignature === lastExplained.current || !account.status?.loggedIn)
      return;
    const t = setTimeout(() => {
      if (busyId || Date.now() - lastAutoAt.current < AUTO_MIN_GAP_MS) return;
      explainErrors(true);
    }, AUTO_DELAY_MS);
    return () => clearTimeout(t);
  }, [
    autoExplain,
    errorSignature,
    editorErrors.length,
    busyId,
    account.status?.loggedIn,
    explainErrors,
  ]);

  /** Guru को code block को "🔍 बुझाऊ" — explain a code block from Guru's answer. */
  const explainCodeBlock = (code: string, language: string) => {
    void ask({
      mode: 'explain',
      label: tr('🔍 यो code लाइन-लाइन बुझाऊ · Explain this code line by line'),
      prompt:
        'Explain this code from your answer, line by line, for a beginner.',
      context: { selection: code, language: language || undefined },
    });
  };

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
        ? tr('छानेको कोड · the selected code')
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
        label: tr('🩺 मेरो कोडमा गल्ती खोज · Find mistakes in my code'),
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
            {tr('Guru — AI शिक्षक')}
          </div>
          <div className="text-[11px] text-slate-400">
            नेपाली + English मा बुझाउँछ
          </div>
        </div>
        {items.length > 0 && !busyId && (
          <button
            className="chip"
            onClick={() => setItems([])}
            title={tr('नयाँ कुराकानी · New conversation')}
          >
            {tr('✨ नयाँ · New')}
          </button>
        )}
        <AccountMenu account={account} />
      </div>

      {(account.waiting || (account.status && !account.status.loggedIn)) && (
        <div className="m-3 rounded-lg border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200">
          <p className="mb-2">
            {tr(
              'Guru चलाउन Claude Code मा login गर्नुहोस्। — Sign in to Claude Code to use Guru.',
            )}
          </p>
          <LoginCard account={account} compact />
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-auto px-3 py-3">
        {items.length === 0 && (
          <div className="space-y-2 text-sm text-slate-400">
            <p>
              {tr(
                "नमस्ते! म तपाईंको coding शिक्षक हुँ। तलका बटन थिच्नुहोस् वा जे पनि सोध्नुहोस्। — Hi! I'm your coding tutor. Use the buttons below or ask me anything.",
              )}
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              <li>
                {tr(
                  '📖 खुला फाइल वा छानेको कोड लाइन-लाइन बुझाउँछु · I explain code line by line',
                )}
              </li>
              <li>
                {tr(
                  '🩺 तपाईंको कोडका गल्ती खोजेर सच्याउने तरिका बताउँछु · I find and explain mistakes',
                )}
              </li>
              <li>
                {tr(
                  '🗺️ नयाँ एपको चरणबद्ध योजना बनाउँछु · I plan new apps step by step',
                )}
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
              {item.content && !item.streaming && (
                <div className="-mt-0.5 mb-1 flex items-center justify-end gap-2">
                  {speaker.speakingId === item.id && (
                    <SpeakWave pulse={speaker.pulse} />
                  )}
                  <button
                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                      speaker.speakingId === item.id ||
                      speaker.loadingId === item.id
                        ? 'border-violet-400 bg-violet-600/30 text-white'
                        : 'border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white'
                    }`}
                    title={
                      speaker.speakingId === item.id
                        ? tr('रोक्न थिच्नुहोस् · Press to stop')
                        : tr(
                            'ठूलो स्वरमा सुन्नुहोस् (नेपाली + English) · Listen (Nepali + English)',
                          )
                    }
                    aria-label={
                      speaker.speakingId === item.id
                        ? 'Stop reading'
                        : 'Read aloud'
                    }
                    onClick={() => void speaker.toggle(item.id, item.content)}
                  >
                    {speaker.loadingId === item.id
                      ? tr('⏳ तयार हुँदै · Starting')
                      : speaker.speakingId === item.id
                        ? tr('⏹ रोक · Stop')
                        : tr('🔊 सुन · Listen')}
                  </button>
                </div>
              )}
              {item.content ? (
                <Markdown
                  text={item.content}
                  showCodeTools={!item.streaming}
                  onExplainCode={busyId ? undefined : explainCodeBlock}
                />
              ) : item.streaming ? (
                <span className="animate-pulse text-slate-400">
                  {tr('Guru सोच्दैछ… · thinking…')}
                </span>
              ) : null}
              {item.error && (
                <p className="mt-1 text-rose-400">⚠️ {tr(item.error)}</p>
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
            {tr('📖 बुझाऊ · Explain')}
          </button>
          <button
            className="chip"
            disabled={!!busyId || !hasCode}
            onClick={() => quick('fix')}
          >
            {tr('🩺 गल्ती खोज · Check')}
          </button>
          <button className="chip" disabled={!!busyId} onClick={startBlueprint}>
            {tr('🗺️ एप योजना · Plan app')}
          </button>
        </div>
        {editorErrors.length > 0 && activeFile && (
          <div
            className="mb-2 rounded-lg border border-rose-700/70 bg-rose-950/40 p-2 text-[12px] text-rose-100"
            role="status"
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold">
                {tr(
                  `⛔ ${activeFile} मा ${editorErrors.length} गल्ती · ${editorErrors.length} error(s) in ${activeFile}`,
                )}
              </span>
              <div className="flex-1" />
              <label
                className="flex cursor-pointer items-center gap-1 text-[11px] text-rose-200"
                title={tr(
                  'टाइप गर्न रोकेको ३.५ सेकेन्डपछि Guru आफैं बुझाउँछ (बढीमा २० सेकेन्डमा एकपटक) · Guru explains new errors by itself 3.5 s after you stop typing (at most once every 20 s)',
                )}
              >
                <input
                  type="checkbox"
                  checked={autoExplain}
                  onChange={(e) => {
                    setAutoExplain(e.target.checked);
                    try {
                      localStorage.setItem(
                        AUTO_KEY,
                        e.target.checked ? 'on' : 'off',
                      );
                    } catch {
                      // ignore
                    }
                  }}
                />
                {tr('🤖 आफैं · Auto')}
              </label>
            </div>
            <ul className="mt-1 max-h-20 space-y-0.5 overflow-auto">
              {editorErrors.slice(0, 5).map((e, i) => (
                <li key={i}>
                  <button
                    className="w-full truncate text-left font-mono text-[11px] text-rose-200 hover:text-white hover:underline"
                    title={e.message}
                    onClick={() => onJumpTo(e.line, e.column)}
                  >
                    {tr(`लाइन ${e.line} · line ${e.line}`)}: {e.message}
                  </button>
                </li>
              ))}
            </ul>
            <button
              className="chip mt-1.5 border-rose-600 text-rose-100"
              disabled={!!busyId}
              onClick={() => explainErrors(false)}
            >
              {tr(
                '🩺 Guru लाई किन र कसरी सच्याउने सोध · Ask Guru why and how to fix',
              )}
            </button>
          </div>
        )}
        {listening && (
          <div className="mb-2 rounded-xl border border-violet-500/40 bg-gradient-to-r from-sky-950/60 via-violet-950/60 to-pink-950/50 px-3 py-2">
            <VoiceWave analyser={voice.analyser} height={38} />
            <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-300">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-rose-500" />
              {voice.state.stage === 'recording'
                ? tr(
                    `सुन्दैछु… ${voice.state.seconds}s — रोक्न फेरि 🎤 थिच्नुहोस् · Listening… press 🎤 to stop`,
                  )
                : ''}
              <span className="ml-auto rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                {voice.language === 'nepali' ? 'ne-NP' : 'en-US'}
              </span>
            </div>
          </div>
        )}
        {listening && voice.quietMic && (
          <div
            className="mb-2 rounded-lg border border-amber-600 bg-amber-950/50 p-2 text-[12px] leading-5 text-amber-100"
            role="alert"
          >
            {tr(
              '🔈 Mic बाट आवाज धेरै सानो आइरहेको छ। Mic नजिक बोल्नुहोस्, वा Windows Sound सेटिङमा Input volume 80–100% गर्नुहोस्। — The microphone signal is very quiet. Speak closer, or raise the input volume to 80–100% in Windows Sound settings.',
            )}
            <button
              className="chip mt-1.5 block"
              onClick={() => void window.studio.openSoundSettings()}
            >
              {tr('⚙️ Sound सेटिङ खोल · Open Sound settings')}
            </button>
          </div>
        )}
        {voice.refining && !listening && (
          <p className="mb-1.5 text-[11px] text-slate-400">
            {tr(
              '✨ पाठ अझै सफा गर्दै (पठाउन पर्खनु पर्दैन) · Polishing the text (no need to wait)',
            )}
          </p>
        )}
        {speaker.error && (
          <p
            className="mb-1.5 text-xs text-rose-400"
            onClick={speaker.clearError}
          >
            {tr(speaker.error)}
          </p>
        )}
        {voice.error && (
          <p
            className="mb-1.5 text-xs text-rose-400"
            onClick={voice.clearError}
          >
            {tr(voice.error)}
          </p>
        )}
        <div className="flex gap-2">
          <div className="flex flex-col gap-1">
            <button
              className={`rounded-lg px-2.5 py-1.5 text-base ${
                listening
                  ? 'bg-rose-600 text-white shadow-[0_0_14px_rgba(244,63,94,0.7)]'
                  : 'border border-slate-600 text-slate-200 hover:bg-slate-700'
              } disabled:opacity-40`}
              title={tr('बोलेर लेख्नुहोस् (Voice) · Speak instead of typing')}
              onClick={voice.toggle}
            >
              <span className="relative">
                🎤
                {/* हरियो = voice typing तयार, पहेँलो = तयार हुँदै — green = ready, amber = getting ready */}
                <span
                  className={`absolute -top-1 -right-2 h-2 w-2 rounded-full ${voice.ready ? 'bg-emerald-400' : 'animate-pulse bg-amber-400'}`}
                  title={
                    voice.ready
                      ? tr('Voice typing तयार · Voice typing ready')
                      : tr('Voice typing तयार हुँदैछ · Voice typing getting ready')
                  }
                />
              </span>
            </button>
            <button
              className="rounded border border-slate-600 px-1 text-[10px] text-slate-300 hover:bg-slate-700"
              title={tr('बोल्ने भाषा · Speaking language')}
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
            placeholder={tr2(
              'प्रश्न लेख्नुहोस् वा 🎤 थिचेर बोल्नुहोस्… (Enter = पठाउ)',
              'Type or press 🎤 and speak… (Enter = send)',
            )}
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
