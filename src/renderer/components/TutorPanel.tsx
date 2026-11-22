import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
import { DiffDialog } from './Dialogs';
import { firstCodeBlock, mergeSnippet } from '../lib/diff';
import { englishFirst } from '../lib/englishFirst';
import { splitCode, splitNepali, type CodeBlock } from '../lib/splitCode';
import { wantsNepali } from '../lib/wantsNepali';
import { hintFor } from '../lib/editorErrorHint';
import { getUiLang, tr, tr2 } from '../i18n';
import { VoiceWave } from '../voice/VoiceWave';
import { SpeakWave } from '../voice/SpeakWave';
import { useSpeaker } from '../voice/useSpeaker';
import {
  adaptLevel,
  LEVEL_NAMES,
  LEVEL_UP_POINTS,
  loadLevel,
  saveLevel,
  type EnglishLevel,
} from '../lib/englishLevel';

import {
  COMMAND_LABELS,
  parseVoiceCommand,
  type VoiceCommand,
} from '../lib/voiceCommands';
import { fixFirstError } from '../intellisense';

import {
  answerQuizByVoice,
  ChallengeCard,
  ProgressDialog,
  QuizCard,
  ResultCard,
  splitBlocks,
  type ChallengeData,
} from './LearningCards';
import {
  learnFrom,
  markActive,
  setTodaysChallenge,
  today,
  todaysChallenge,
  useProgress,
} from '../lib/progress';

const AUTO_SPEAK_KEY = 'studio.guruAutoSpeak';

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
  /** च्यालेन्ज जाँचको जवाफ — this answer checks today's challenge */
  checksChallenge?: boolean;
  challengeTitle?: string;
}

export interface TutorRequest {
  /** भाषा: खाली भए English (नेपाली माग्दा मात्र नेपाली) — language: English by default; Nepali only when asked */
  lang?: 'ne' | 'en';
  mode: AiMode;
  label: string;
  checksChallenge?: boolean;
  challengeTitle?: string;
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
  /** 🎙️ App-स्तरका आवाज आदेश (Run, Save, ← →…) — app-level voice commands */
  onVoiceCommand?: (cmd: VoiceCommand) => void;
  /** Guru ले दिएको सच्याइएको पूरा पाठ खुला फाइलमा लगाउने — put the reviewed text into the open file */
  onApplyToFile?: (content: string) => void;
  /** Guru ले कोड लेखेपछि मुख्य स्क्रिनको कोड बाकसमा पठाउने — hand finished code blocks to the Code box in front */
  onCode?: (blocks: CodeBlock[]) => void;
  /** कोड बाकसको 'फाइलमा लगाऊ' ले यही चलाउँछ — the Code box's 'Preview & apply' calls this */
  applyRef?: { current: ((code: string) => void) | null };
  /** 🧭 गल्ती मार्गदर्शक कार्ड (Guru बाकस भित्र) — the error-guide card, shown inside the Guru panel */
  guideSlot?: ReactNode;
  /** कुराकानी सेभ गर्ने नाम (project अनुसार) — where the chat is saved (per project), so it survives closing the app */
  storageKey?: string;
}

export interface EditorError {
  line: number;
  column: number;
  message: string;
  source: string;
}

export function TutorPanel({
  account,
  getContext,
  pending,
  onPendingHandled,
  editorErrors,
  activeFile,
  onJumpTo,
  onCode,
  applyRef,
  onVoiceCommand,
  onApplyToFile,
  guideSlot,
  storageKey,
}: Props) {
  const [items, setItems] = useState<ChatItem[]>([]);
  // 💾 कुराकानी सेभ: एप बन्द गरेर खोले पनि फर्किन्छ — chat history survives closing and reopening the app
  const [chatOwner, setChatOwner] = useState<string | null>(null);
  useEffect(() => {
    if (!storageKey) return;
    let loaded: ChatItem[] = [];
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw)
        loaded = (JSON.parse(raw) as ChatItem[])
          .filter((i) => i && typeof i.id === 'string' && !i.streaming)
          .map((i) => ({ ...i, streaming: false }));
    } catch {
      loaded = [];
    }
    setItems(loaded);
    setChatOwner(storageKey);
  }, [storageKey]);
  useEffect(() => {
    // आफ्नै project को कुराकानी मात्र सेभ; लेखिँदै गरेको जवाफ छोड्ने — save only this project's chat, never a half-written answer
    if (!storageKey || chatOwner !== storageKey) return;
    if (items.some((i) => i.streaming)) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(items.slice(-80)));
    } catch {
      /* सेभ नभए पनि एप चल्छ — the app works without saving */
    }
  }, [items, storageKey, chatOwner]);
  // गल्तीको सुझाव सुरुमा English मात्र — error hints start in English only
  const [showNeHints, setShowNeHints] = useState(false);
  // कुन उत्तरको नेपाली भाग खुलेको छ — which answers have their Nepali part open
  const [neOpen, setNeOpen] = useState<Record<string, boolean>>({});
  const [input, setInput] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  // 📈 Progressive English लेभल — the learner's English level
  const [eng, setEng] = useState(loadLevel);
  const [levelNote, setLevelNote] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  // बोल्दै गर्दा शब्दहरू तुरुन्तै input मा देखाउने — show spoken words in the input box live.
  // रेकर्डिङ सुरु हुँदा box मा भएको पाठ यहीँ एकपटक मात्र समात्ने (React को ढिलो update मा भर नपर्ने)।
  // Capture the box's text once, when dictation starts, without relying on a deferred state updater.
  const inputRef = useRef(input);
  inputRef.current = input;
  const voiceBase = useRef('');
  const skipFinal = useRef(false);
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
      // submit भइसकेको रेकर्डिङको पछिल्लो पाठ बेवास्ता — ignore the late text of a recording that was already sent
      if (skipFinal.current) {
        skipFinal.current = false;
        return;
      }
      // 🎙️ छोटो आदेश भए काम गर्ने, पाठ नराख्ने — a short spoken command runs instead of becoming text.
      // 🧠 खुला quiz भए "A / बी / दोस्रो" उत्तर हो — with a quiz open, "A / B / second" answers it
      if (answerQuizByVoice(better)) {
        setInput(voiceBase.current);
        return;
      }
      const cmd = parseVoiceCommand(better);
      if (cmd) {
        setInput(voiceBase.current);
        commandRef.current(cmd);
        return;
      }
      // तपाईंले पाठ नछोएको भए मात्र सुधारिएको पाठ राख्ने — replace only if you have not edited or sent it.
      setInput((prev) => (prev === joinBase(shown) ? joinBase(better) : prev));
    },
  );
  const listening = voice.state.stage === 'recording';
  const commandRef = useRef<(cmd: VoiceCommand) => void>(() => undefined);
  // 🔊 Guru को जवाफ पढ्ने — read Guru's answers aloud
  const speaker = useSpeaker();
  // 🔊 जवाफ सकिनेबित्तिकै आफैं सुनाउने (Gemini जस्तै) — read each finished answer aloud by itself.
  const [autoSpeak, setAutoSpeak] = useState(() => {
    try {
      return localStorage.getItem(AUTO_SPEAK_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const autoSpeakRef = useRef(autoSpeak);
  autoSpeakRef.current = autoSpeak;
  const toSpeak = useRef(new Set<string>());
  const learned = useRef(new Set<string>());
  const [showProgress, setShowProgress] = useState(false);
  const progress = useProgress();

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
    // सकिएको जवाफ आफैं बोल्ने — speak answers that just finished
    // सकिएको जवाफबाट शब्द/कन्सेप्ट टिप्ने र आजको च्यालेन्ज सम्झने — learn from finished answers
    for (const item of items) {
      if (
        item.role !== 'assistant' ||
        item.streaming ||
        !item.content ||
        learned.current.has(item.id)
      )
        continue;
      learned.current.add(item.id);
      learnFrom(item.content);
      // कोड बाकसमा पठाउने (व्याख्या यहीँ रहन्छ) — send the code to the Code box; the explanation stays here
      const codeBlocks = splitCode(
        splitBlocks(englishFirst(item.content).text).markdown,
      ).blocks;
      if (codeBlocks.length) onCode?.(codeBlocks);
      const { challenge } = splitBlocks(item.content);
      if (challenge && !todaysChallenge()) setTodaysChallenge(challenge);
    }
    for (const id of toSpeak.current) {
      const item = items.find((i) => i.id === id);
      if (!item || item.streaming) continue;
      toSpeak.current.delete(id);
      if (item.content && !item.error)
        void speaker.toggle(`${id}:all`, item.content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- speaker.toggle is stable enough here
  }, [items]);

  useEffect(() => {
    const off = window.studio.onAiEvent((event) => {
      // Guru AI Fix जस्ता chat बाहिरका जवाफले chat फेरि नबनाओस् — streams without a chat item change nothing
      setItems((prev) =>
        !prev.some((i) => i.id === event.requestId)
          ? prev
          : prev.map((item) => {
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
      if (event.type === 'done' && autoSpeakRef.current)
        toSpeak.current.add(event.requestId);
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
        {
          id: requestId,
          role: 'assistant',
          content: '',
          streaming: true,
          checksChallenge: req.checksChallenge,
          challengeTitle: req.challengeTitle,
        },
      ]);
      setBusyId(requestId);
      markActive();
      // आफैं लेखेको प्रश्नबाट English लेभल मिलाउने — adapt the English level from what the learner typed.
      let level = eng.level;
      if (req.mode === 'chat') {
        const { state, change } = adaptLevel(eng, req.prompt);
        setEng(state);
        saveLevel(state);
        level = state.level;
        if (change === 'up')
          setLevelNote(
            tr2(
              `🎉 बधाई छ! English लेभल ${state.level} (${LEVEL_NAMES[state.level]}) मा पुग्यो।`,
              `🎉 Well done! Your English level is now ${state.level} (${LEVEL_NAMES[state.level]}).`,
            ),
          );
        else if (change === 'down')
          setLevelNote(
            tr2(
              `🙂 अब अझ सजिलो English (लेभल ${state.level}) मा बुझाउँछु।`,
              `🙂 I will use simpler English now (level ${state.level}).`,
            ),
          );
      }
      try {
        await window.studio.askAi({
          englishLevel: level,
          // English मात्र; नेपाली माग्दा मात्र नेपाली — English only; Nepali only when asked
          answerLang: req.lang ?? (wantsNepali(req.prompt) ? 'ne' : 'en'),
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
    [busyId, items, eng],
  );

  useEffect(() => {
    if (!levelNote) return;
    const t = setTimeout(() => setLevelNote(''), 7000);
    return () => clearTimeout(t);
  }, [levelNote]);

  useEffect(() => {
    if (pending && !busyId) {
      onPendingHandled();
      void ask(pending);
    }
  }, [pending, busyId, ask, onPendingHandled]);

  // ---------- Smart Guru Error Diagnostics ----------
  const lastExplained = useRef('');
  const errorSignature = activeFile
    ? `${activeFile}|${editorErrors.map((e) => `${e.line}:${e.message}`).join('|')}`
    : '';

  const explainErrors = useCallback(() => {
    if (!activeFile || editorErrors.length === 0) return;
    lastExplained.current = errorSignature;
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
        `🩺 ${activeFile} मा ${editorErrors.length} गल्ती — किन भयो र कसरी सच्याउने · ${editorErrors.length} error(s) in ${activeFile}: why and how to fix`,
      ),
      prompt: `My code editor shows these errors in ${activeFile}:
${list}

For each error: say which line, explain in simple words why it happened (what the rule is), then show the corrected line(s) of code. Finish with a short tip so I avoid this mistake next time.`,
      context: { ...getContext(), runOutput: undefined },
    });
  }, [activeFile, editorErrors, errorSignature, ask, getContext]);

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
    // बोल्दै गर्दै submit गरे: रेकर्डिङ रोकेर अहिलेको पाठ तुरुन्तै पठाउने, पछि फेरि box मा नआउने
    // Submitting while dictating: stop the mic, send the text now, and never let it come back into the box.
    if (voice.state.stage === 'recording') {
      skipFinal.current = true;
      voice.stop();
    }
    voiceBase.current = '';
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

  // ---------- 🔧 One-click fix, diff preview, quick actions ----------
  const [applyView, setApplyView] = useState<{
    fileName: string;
    before: string;
    after: string;
    note: string;
  } | null>(null);
  const autoDiffRef = useRef(false);
  const inputElRef = useRef<HTMLTextAreaElement>(null);

  /** Guru को कोडलाई खुला फाइलसँग दाँजेर diff देखाउने — compare Guru's code with the open file and show the diff. */
  const openApply = (code: string) => {
    const ctx = getContext();
    if (!ctx.fileName || ctx.code === undefined) {
      setLevelNote(
        tr('📂 पहिले editor मा फाइल खोल्नुहोस् · Open a file in the editor first'),
      );
      return;
    }
    const merged = mergeSnippet(ctx.code, code);
    if (!merged) {
      setLevelNote(
        tr(
          '🤔 यो कोड फाइलको कुन ठाउँमा राख्ने थाहा भएन — 📋 Copy गरेर राख्नुहोस् · I could not tell where this code goes — please Copy and paste it',
        ),
      );
      return;
    }
    setApplyView({
      fileName: ctx.fileName,
      before: ctx.code,
      after: merged.text,
      note:
        merged.mode === 'whole'
          ? tr('पूरै फाइल बदलिन्छ · whole file replaced')
          : tr('मिल्ने भाग मात्र बदलिन्छ · only the matching part is replaced'),
    });
  };

  const summarizeFile = () => {
    const ctx = getContext();
    if (!ctx.code) return;
    void ask({
      mode: 'chat',
      label: tr('📄 यो फाइल बुझाऊ · Summarize this file'),
      prompt:
        'Summarize this file briefly. First under the heading "English": at most 4 one-line bullets in simple, basic English (what it does and its main parts). Then under the heading "नेपाली": the same bullets in simple Nepali (Devanagari). End with one line starting "👉" (English, then Nepali) with the single most important thing to learn from it. No code, no tables.',
      context: { ...ctx, runOutput: undefined },
    });
  };

  if (applyRef) applyRef.current = openApply;

  const fixAndApply = () => {
    const ctx = getContext();
    const list = editorErrors
      .slice(0, 8)
      .map(
        (e) =>
          `- line ${e.line}, column ${e.column} (${e.source}): ${e.message}`,
      )
      .join('\n');
    if (!ctx.code || (!list && !ctx.runOutput)) {
      setLevelNote(
        tr(
          '✅ अहिले कुनै गल्ती भेटिएन — पहिले Run गर्नुहोस् वा फाइल खोल्नुहोस् · No error found right now — run the app or open a file first',
        ),
      );
      return;
    }
    autoDiffRef.current = true;
    void ask({
      mode: 'fix',
      label: tr('🛠 एरर खोज र ठीक गर · Find and fix the error'),
      prompt: `Find the real cause of the problem and fix it in ${ctx.fileName ?? 'this file'}.${
        list
          ? `
Editor errors:
${list}`
          : ''
      }
Reply in exactly this format and nothing else:
❓ one line: why it happened (simple English first, then Nepali).
✅ ONE fenced code block with the corrected code. If the file has fewer than 80 lines give the whole corrected file; otherwise give only the changed function or region plus one unchanged line above and below it.`,
      context: { ...ctx, runOutput: list ? undefined : ctx.runOutput },
    });
  };

  const newWidget = () => {
    const text = input.trim();
    const kind = getContext().projectKind;
    if (!text || text.startsWith('नयाँ widget/route बनाऊ')) {
      setInput('नयाँ widget/route बनाऊ: ');
      setTimeout(() => {
        const el = inputElRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }, 0);
      return;
    }
    const what = text.replace(/^नयाँ widget\/route बनाऊ:?\s*/, '');
    setInput('');
    void ask({
      mode: 'chat',
      label: `🧩 नयाँ विजेट/रूट: ${what}`,
      prompt: `Create this ${kind === 'flutter' || !kind ? 'Flutter widget, screen or route' : 'component'}: ${what}
Give: 1) the file path to create (for Flutter under lib/), 2) ONE complete, real, null-safe code block, 3) if it is a route/screen, the one line to register it (for example in routes or Navigator.push). At most 3 short bullets of notes, simple English first, then Nepali. No tables, no long explanation.`,
      context: { projectKind: kind },
    });
  };

  // "एरर खोज र ठीक गर" को जवाफ सकिनेबित्तिकै diff आफैं खोल्ने — open the diff as soon as the fix answer is complete.
  useEffect(() => {
    if (!autoDiffRef.current) return;
    const last = items[items.length - 1];
    if (!last || last.role !== 'assistant' || last.streaming) return;
    autoDiffRef.current = false;
    if (last.error || !last.content) return;
    const block = firstCodeBlock(last.content);
    if (block) openApply(block.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openApply only reads the latest editor state
  }, [items]);

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

  // 🧠 Quiz: बुझेको जाँच्न Guru ले २ प्रश्न सोध्छ — Guru asks two questions to check understanding.
  const startQuiz = () => {
    void ask({
      mode: 'chat',
      label: tr('🧠 मलाई जाँच · Quiz me'),
      prompt:
        'Quiz me on what you just explained (or, if nothing was explained yet, on very basic programming). Write one short encouraging line, then a fenced code block with the language tag quiz containing ONLY this JSON: {"topic": "...", "questions": [{"q": "question in simple Nepali written in Devanagari script, never romanized (English in brackets)", "options": ["...", "...", "..."], "answer": <index of the correct option, 0-based>, "why": "one short sentence explaining the right answer: Nepali in Devanagari, then English"}]}. Exactly 2 very easy multiple-choice questions with 3 options each. Do not reveal the answers outside the JSON.',
    });
  };

  // 🎯 आजको च्यालेन्ज: एक दिनमा एउटा, लेभल अनुसार — one small challenge a day, by level
  const startChallenge = () => {
    const cached = todaysChallenge();
    if (cached) {
      setItems((prev) => [
        ...prev,
        {
          id: newId(),
          role: 'assistant',
          content: '```challenge\n' + JSON.stringify(cached) + '\n```',
        },
      ]);
      return;
    }
    const kind = getContext().projectKind ?? 'flutter';
    void ask({
      mode: 'chat',
      label: tr('🎯 आजको च्यालेन्ज · Today’s challenge'),
      prompt: `Give me today's micro coding challenge for a total beginner (English level ${eng.level} of 4). Language: ${kind === 'python' ? 'Python' : kind === 'node' || kind === 'web' ? 'JavaScript' : 'Dart'}. It must take 5-10 minutes and teach one concept. Write one fun motivating line, then a fenced code block with the language tag challenge containing ONLY this JSON: {"title": "short fun title", "concept": "the concept it teaches", "taskNe": "the task in simple Nepali", "taskEn": "the task in simple English", "starter": "a few lines of starter code with a TODO comment"}.`,
    });
  };

  const checkChallenge = (c: ChallengeData) => {
    const ctx = getContext();
    if (!ctx.code?.trim()) {
      setLevelNote(
        tr(
          '✍️ पहिले editor मा फाइल खोलेर च्यालेन्जको कोड लेख्नुहोस्, अनि जाँच थिच्नुहोस् · First write your answer in a file in the editor, then press check',
        ),
      );
      return;
    }
    void ask({
      mode: 'fix',
      checksChallenge: true,
      challengeTitle: c.title,
      label: tr('✅ मेरो च्यालेन्ज जाँच · Check my challenge'),
      prompt: `Today's challenge: "${c.title}". Task: ${c.taskEn || c.taskNe}. Check whether my code below solves it. Be kind and simple. First write a fenced code block with the language tag result containing ONLY this JSON: {"pass": true or false, "tip_ne": "one sentence in Nepali", "tip_en": "one sentence in English"}. Then, if it is not solved yet, give one small hint (not the full answer).`,
      context: { ...ctx, runOutput: undefined },
    });
  };

  const copyStarter = (c: ChallengeData) => {
    void navigator.clipboard
      .writeText(c.starter ?? '')
      .then(() =>
        setLevelNote(
          tr(
            '📋 Starter code copy भयो — editor मा paste गर्नुहोस् · Starter code copied — paste it into the editor',
          ),
        ),
      )
      .catch(() => undefined);
  };

  commandRef.current = (cmd: VoiceCommand) => {
    setLevelNote(`🎙️ ${tr(COMMAND_LABELS[cmd])}`);
    if (cmd === 'explain') quick('explain');
    else if (cmd === 'newWidget') newWidget();
    else if (cmd === 'quiz') startQuiz();
    else if (cmd === 'fixError') {
      // editor मा गल्ती भए Guru ले सिधै सच्याउँछ; नभए run को output हेरेर — fix in the editor, else from the run output
      if (!fixFirstError()) quick('fix');
    } else onVoiceCommand?.(cmd);
  };

  const hasCode = Boolean(getContext().code);

  return (
    <div className="flex h-full flex-col">
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
        {(speaker.speakingId || speaker.loadingId) && (
          <button
            className="speaking-pill flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white"
            title={tr(
              'Guru बोल्दैछ — रोक्न थिच्नुहोस् · Guru is speaking — press to stop',
            )}
            aria-label="Stop Guru speaking"
            onClick={speaker.stop}
          >
            <SpeakWave pulse={speaker.pulse} width={70} height={18} />
            {speaker.loadingId
              ? tr('⏳ तयार · Starting')
              : tr('⏹ बोल्दै · Speaking')}
          </button>
        )}
        {items.length > 0 && !busyId && (
          <button
            className="chip"
            onClick={() => setItems([])}
            title={tr('नयाँ कुराकानी · New conversation')}
          >
            {tr('✨ नयाँ · New')}
          </button>
        )}
        <AccountMenu account={account} compact />
      </div>

      {guideSlot}

      {/* 📈 English लेभल र ✍️ लेख्दा बुझाऊ — English level and explain-as-you-type */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1.5 text-[11px] text-slate-300">
        <label
          className="flex items-center gap-1"
          title={tr(
            'Guru सुरुमा एकदमै सजिलो English बोल्छ र तपाईंको प्रगति हेरेर बिस्तारै लेभल बढाउँछ · Guru starts with very simple English and raises the level as you progress',
          )}
        >
          {tr('📈 English:')}
          <select
            aria-label="English level"
            className="glass-input rounded-lg px-1 py-0.5 text-slate-100"
            value={eng.auto ? 'auto' : String(eng.level)}
            onChange={(e) => {
              const v = e.target.value;
              const next =
                v === 'auto'
                  ? { ...eng, auto: true }
                  : {
                      auto: false,
                      level: Number(v) as EnglishLevel,
                      points: 0,
                    };
              setEng(next);
              saveLevel(next);
            }}
          >
            <option value="auto">
              {tr2(`आफैं मिलाउने (अहिले ${eng.level})`, `Auto (now ${eng.level})`)}
            </option>
            {([1, 2, 3, 4] as EnglishLevel[]).map((l) => (
              <option key={l} value={l}>
                {l} — {tr(LEVEL_NAMES[l])}
              </option>
            ))}
          </select>
        </label>
        {eng.auto && eng.level < 4 && (
          <span
            className="h-1.5 w-14 overflow-hidden rounded bg-slate-700"
            title={tr2(`अर्को लेभलसम्मको प्रगति`, `Progress to the next level`)}
          >
            <span
              className="block h-full bg-emerald-500"
              style={{
                width: `${Math.max(0, (eng.points / LEVEL_UP_POINTS) * 100)}%`,
              }}
            />
          </span>
        )}
        <div className="flex-1" />
        <label
          className="flex cursor-pointer items-center gap-1"
          title={tr(
            'Guru को जवाफ सकिनेबित्तिकै आफैं ठूलो स्वरमा सुनाउने · Read every answer aloud as soon as it is written',
          )}
        >
          <input
            type="checkbox"
            checked={autoSpeak}
            onChange={(e) => {
              setAutoSpeak(e.target.checked);
              if (!e.target.checked) speaker.stop();
              try {
                localStorage.setItem(
                  AUTO_SPEAK_KEY,
                  e.target.checked ? 'on' : 'off',
                );
              } catch {
                // ignore
              }
            }}
          />
          {tr('🔊 आफैं सुनाउ · Auto-speak')}
        </label>
        <button
          className="chip"
          disabled={!!busyId}
          title={tr(
            'हरेक दिन एउटा सानो रमाइलो च्यालेन्ज · One small fun challenge every day',
          )}
          onClick={startChallenge}
        >
          🎯 {tr('च्यालेन्ज · Challenge')}
          {progress.challenges.some((c) => c.done && c.day === today())
            ? ' ✅'
            : ''}
        </button>
        <button
          className="chip"
          title={tr('मेरो प्रगति: अंक, streak, शब्द, कन्सेप्ट · My progress')}
          onClick={() => setShowProgress(true)}
        >
          📊 🔥{progress.streak} ⭐{progress.points}
        </button>
      </div>
      {showProgress && (
        <ProgressDialog onClose={() => setShowProgress(false)} />
      )}
      {levelNote && (
        <div
          aria-live="polite"
          className="mx-3 mt-2 rounded-md bg-emerald-900/50 px-3 py-1.5 text-xs text-emerald-200"
        >
          {levelNote}
        </div>
      )}

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
              className="ml-6 rounded-2xl rounded-tr-md border border-sky-300/20 bg-gradient-to-br from-sky-600/35 to-violet-600/35 px-3 py-2 text-sm whitespace-pre-wrap text-sky-50 shadow-[0_8px_24px_-12px_rgba(99,102,241,0.8)]"
            >
              {item.label ?? item.content}
            </div>
          ) : (
            <div
              key={item.id}
              data-order-fixed={
                !item.streaming && englishFirst(item.content).changed
                  ? '1'
                  : undefined
              }
              className="rounded-2xl rounded-tl-md border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.9)] backdrop-blur"
            >
              {item.content ? (
                (() => {
                  // क्रम सुरक्षा: नेपाली अघि लेखिएको भए English पहिले देखाउने — show English first even if the model wrote Nepali first
                  const shown = item.streaming
                    ? item.content
                    : englishFirst(item.content).text;
                  const b = splitBlocks(shown, item.streaming);
                  // 📦 व्याख्या र कोड छुट्टाछुट्टै बाकसमा — explanation and code in separate boxes
                  const parts = splitCode(b.markdown);
                  const boxed = parts.blocks.length > 0;
                  return (
                    <div data-answer>
                      {/* व्याख्या यहीँ (छेउको बाकस); कोड मुख्य स्क्रिनको "Guru को कोड" बाकसमा — explanation here, code in the Code box in front */}
                      {(() => {
                        // सुरुमा English मात्र; बटन थिचेपछि नेपाली — English first; Nepali on demand
                        const sp = splitNepali(parts.text);
                        const open = Boolean(neOpen[item.id]);
                        return (
                          <>
                            {sp.english && (
                              <Markdown
                                text={sp.english}
                                showCodeTools={false}
                                onExplainCode={
                                  busyId ? undefined : explainCodeBlock
                                }
                                onApplyCode={busyId ? undefined : openApply}
                              />
                            )}
                            {sp.nepali && (
                              <>
                                <button
                                  data-testid="explain-ne"
                                  className="my-1 rounded-lg border border-sky-400 px-3 py-1 text-[12px] font-bold text-sky-200 hover:bg-sky-900/40"
                                  onClick={() =>
                                    setNeOpen((m) => ({
                                      ...m,
                                      [item.id]: !m[item.id],
                                    }))
                                  }
                                >
                                  {open
                                    ? '🇬🇧 English only'
                                    : '🇳🇵 नेपालीमा एक्सप्लेन गर · Explain in Nepali'}
                                </button>
                                {open && (
                                  <Markdown
                                    text={sp.nepali}
                                    showCodeTools={false}
                                    onExplainCode={
                                      busyId ? undefined : explainCodeBlock
                                    }
                                    onApplyCode={busyId ? undefined : openApply}
                                  />
                                )}
                              </>
                            )}
                            {/* अंग्रेजी उत्तरमा बटन: थिचेपछि मात्र Guru ले नेपालीमा बुझाउँछ — on an English answer, Guru explains in Nepali only after this button */}
                            {!sp.nepali &&
                              !item.streaming &&
                              !item.error &&
                              sp.english &&
                              !/[ऀ-ॿ]{3}/.test(sp.english) && (
                                <button
                                  data-testid="explain-ne-ask"
                                  disabled={Boolean(busyId)}
                                  className="my-1 rounded-lg border border-sky-400 px-3 py-1 text-[12px] font-bold text-sky-200 hover:bg-sky-900/40 disabled:opacity-50"
                                  onClick={() =>
                                    void ask({
                                      mode: 'chat',
                                      lang: 'ne',
                                      label: '🇳🇵 नेपालीमा एक्सप्लेन गर',
                                      prompt:
                                        'Explain the following answer in simple, short Nepali (keep code, file names and technical words in English):\n\n' +
                                        sp.english,
                                    })
                                  }
                                >
                                  {'🇳🇵 नेपालीमा एक्सप्लेन गर · Explain in Nepali'}
                                </button>
                              )}
                          </>
                        );
                      })()}
                      {boxed && (
                        <div
                          data-testid="code-moved-note"
                          className="mt-2 rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-2 py-1.5 text-[12px] text-emerald-200"
                        >
                          {item.streaming
                            ? tr('💻 कोड लेख्दैछु… · Writing the code…')
                            : `💻 ${parts.blocks.length} code block(s) are in the "Guru's code" box`}
                        </div>
                      )}
                      {b.quiz && <QuizCard data={b.quiz} />}
                      {b.challenge && (
                        <ChallengeCard
                          data={b.challenge}
                          onCheck={busyId ? undefined : checkChallenge}
                          onStart={copyStarter}
                        />
                      )}
                      {b.result && (
                        <ResultCard
                          data={b.result}
                          forChallenge={Boolean(item.checksChallenge)}
                          challengeTitle={item.challengeTitle}
                        />
                      )}
                    </div>
                  );
                })()
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
              {item.content && !item.streaming && (
                <SpeakerBar
                  onQuiz={busyId ? undefined : startQuiz}
                  id={item.id}
                  content={item.content}
                  speaker={speaker}
                  hasNepali={/[ऀ-ॿ]{2}/.test(item.content)}
                  hasEnglish={/[A-Za-z]{3}/.test(
                    item.content.replace(/```[\s\S]*?```/g, ''),
                  )}
                />
              )}
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-white/10 bg-slate-950/30 p-3">
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
            </div>
            <ul
              className="mt-1 max-h-32 space-y-1.5 overflow-auto"
              data-testid="error-hints"
            >
              <li>
                <button
                  data-testid="hints-explain-ne"
                  className="rounded border border-rose-300 px-2 py-0.5 text-[11px] font-bold text-rose-100 hover:bg-rose-900/40"
                  onClick={() => setShowNeHints((v) => !v)}
                >
                  {showNeHints
                    ? '🇬🇧 English only'
                    : '🇳🇵 नेपालीमा एक्सप्लेन गर · Explain in Nepali'}
                </button>
              </li>
              {editorErrors.slice(0, 4).map((e, i) => {
                const hint = hintFor(e.message, e.line);
                return (
                  <li key={i}>
                    <button
                      className="w-full text-left hover:underline"
                      title={e.message}
                      onClick={() => onJumpTo(e.line, e.column)}
                    >
                      <span className="font-mono text-[11px] font-semibold text-red-300">
                        {tr(`लाइन ${e.line} · line ${e.line}`)}
                      </span>
                      <span className="block text-[12px] text-rose-50">
                        {hint.en}
                      </span>
                      {showNeHints && (
                        <span className="block text-[12px] text-rose-200/90">
                          {hint.ne}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              className="chip mt-1.5 border-rose-600 text-rose-100"
              disabled={!!busyId}
              onClick={() => explainErrors()}
            >
              {tr(
                '🩺 Guru लाई किन र कसरी सच्याउने सोध · Ask Guru why and how to fix',
              )}
            </button>
          </div>
        )}
        {editorErrors.length === 0 && activeFile && (
          <div
            data-testid="all-good"
            className="mb-2 rounded-lg border border-emerald-600/60 bg-emerald-950/30 px-2 py-1 text-[12px] text-emerald-200"
          >
            {tr(
              `✅ ${activeFile}: अहिले कुनै गल्ती भेटिएन · No mistakes found right now`,
            )}
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
              className={`rounded-xl px-2.5 py-1.5 text-base ${
                listening
                  ? 'mic-live bg-gradient-to-br from-rose-500 to-fuchsia-600 text-white'
                  : 'border border-white/15 bg-white/5 text-slate-200 hover:border-sky-400/60 hover:bg-white/10 hover:shadow-[0_0_18px_-4px_rgba(56,189,248,0.7)]'
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
              className="rounded-md border border-white/15 bg-white/5 px-1 text-[10px] text-slate-300 hover:border-violet-400/60 hover:text-white"
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
            ref={inputElRef}
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
            className="glass-input min-w-0 flex-1 resize-none rounded-xl px-3 py-2 text-sm text-slate-100 outline-none"
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
              className="btn-primary px-3.5 text-base"
              disabled={!input.trim()}
              onClick={sendTyped}
            >
              ➤
            </button>
          )}
        </div>
        <div
          className="mt-2 flex flex-wrap gap-1.5"
          data-testid="quick-actions"
        >
          <button
            className="chip"
            disabled={!!busyId || !hasCode}
            onClick={summarizeFile}
          >
            {tr('📄 यो फाइल बुझाऊ · Explain this file')}
          </button>
          <button
            className="chip"
            disabled={!!busyId || !hasCode}
            onClick={fixAndApply}
          >
            {tr('🛠 एरर खोज र ठीक गर · Find & fix error')}
          </button>
          <button className="chip" disabled={!!busyId} onClick={newWidget}>
            {tr('🧩 नयाँ विजेट/रूट बनाऊ · New widget/route')}
          </button>
        </div>
      </div>
      {applyView && (
        <DiffDialog
          fileName={applyView.fileName}
          before={applyView.before}
          after={applyView.after}
          note={applyView.note}
          onClose={() => setApplyView(null)}
          onApply={() => {
            onApplyToFile?.(applyView.after);
            setApplyView(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * 🔊 हरेक जवाफको तल: सबै / नेपाली मात्र / English मात्र सुन्ने; उही बटन फेरि थिच्दा रोकिन्छ।
 * Under every answer: listen to all, Nepali only, or English only; pressing the same button again stops it.
 */
function SpeakerBar({
  onQuiz,
  id,
  content,
  speaker,
  hasNepali,
  hasEnglish,
}: {
  onQuiz?: () => void;
  id: string;
  content: string;
  speaker: ReturnType<typeof useSpeaker>;
  hasNepali: boolean;
  hasEnglish: boolean;
}) {
  const options: {
    key: string;
    label: string;
    only?: 'ne-NP' | 'en-US';
    show: boolean;
  }[] = [
    { key: 'all', label: tr('🔊 सबै सुन · Listen'), show: true },
    {
      key: 'en',
      label: '🔊 English',
      only: 'en-US',
      show: hasNepali && hasEnglish,
    },
    {
      key: 'ne',
      label: '🔊 नेपाली',
      only: 'ne-NP',
      show: hasNepali && hasEnglish,
    },
  ];
  return (
    <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5 border-t border-slate-700/70 pt-2">
      {onQuiz && (
        <button
          className="chip"
          title={tr(
            'बुझ्नुभयो कि भएन जाँच्न Guru ले २ प्रश्न सोध्छ (🎤 बोलेर जवाफ दिन मिल्छ) · Guru asks 2 questions; answer by voice or typing',
          )}
          onClick={onQuiz}
        >
          {tr('🧠 जाँच · Quiz me')}
        </button>
      )}
      {hasNepali && (
        <select
          aria-label="Nepali voice"
          className="glass-input mr-auto rounded-lg px-1 py-0.5 text-[11px] text-slate-300"
          title={tr('नेपाली कुन आवाजमा सुन्ने · Which voice reads Nepali')}
          value={speaker.engine}
          onChange={(e) => {
            speaker.stop();
            speaker.setEngine(e.target.value as 'google' | 'microsoft');
          }}
        >
          <option value="google">🇳🇵 Google नेपाली</option>
          <option value="microsoft">🇳🇵 Microsoft हेमकला</option>
        </select>
      )}
      {options
        .filter((o) => o.show)
        .map((o) => {
          const bid = `${id}:${o.key}`;
          const playing = speaker.speakingId === bid;
          const loading = speaker.loadingId === bid;
          return (
            <span key={o.key} className="flex items-center gap-1.5">
              {playing && (
                <SpeakWave pulse={speaker.pulse} width={56} height={20} />
              )}
              <button
                className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                  playing || loading
                    ? 'border-violet-400 bg-gradient-to-r from-sky-600/40 via-violet-600/40 to-pink-600/40 text-white shadow-[0_0_10px_rgba(167,139,250,0.5)]'
                    : 'border-slate-500 text-slate-200 hover:border-violet-400 hover:bg-slate-700 hover:text-white'
                }`}
                aria-label={playing ? 'Stop reading' : `Read aloud ${o.key}`}
                aria-pressed={playing}
                title={
                  playing
                    ? tr('रोक्न फेरि थिच्नुहोस् · Press again to stop')
                    : tr('ठूलो स्वरमा सुन्नुहोस् · Listen')
                }
                onClick={() => void speaker.toggle(bid, content, o.only)}
              >
                {loading
                  ? tr('⏳ तयार हुँदै · Starting')
                  : playing
                    ? tr('⏹ रोक · Stop')
                    : o.label}
              </button>
            </span>
          );
        })}
    </div>
  );
}
