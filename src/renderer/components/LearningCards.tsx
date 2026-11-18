import { useEffect, useRef, useState } from 'react';
import { tr, tr2 } from '../i18n';
import {
  completeTodaysChallenge,
  rankOf,
  recordQuiz,
  today,
  useProgress,
  type Challenge,
} from '../lib/progress';
import { LEVEL_NAMES, loadLevel } from '../lib/englishLevel';
import { Modal } from './Dialogs';

// 🎮 सिकाइ खेल: Guru को जवाफभित्रका ```quiz / ```challenge / ```result JSON लाई क्लिक गर्न मिल्ने card मा देखाउने।
// Learning game: render Guru's ```quiz / ```challenge / ```result JSON blocks as interactive cards.

export interface QuizQuestion {
  q: string;
  options: string[];
  answer: number;
  why?: string;
}
export interface QuizData {
  topic?: string;
  questions: QuizQuestion[];
}
export type ChallengeData = Omit<Challenge, 'day' | 'done'>;
export interface ResultData {
  pass: boolean;
  tip_ne?: string;
  tip_en?: string;
}

const BLOCK = /```(quiz|challenge|result)[^\n]*\n([\s\S]*?)```/g;

/** जवाफबाट विशेष block छुट्याउने — pull the special blocks out of an answer. */
export function splitBlocks(content: string, streaming = false) {
  let quiz: QuizData | undefined;
  let challenge: ChallengeData | undefined;
  let result: ResultData | undefined;
  let markdown = content.replace(BLOCK, (_all, kind: string, body: string) => {
    try {
      const data = JSON.parse(body.trim()) as unknown;
      if (kind === 'quiz' && isQuiz(data)) quiz = data;
      else if (kind === 'challenge' && isChallenge(data)) challenge = data;
      else if (
        kind === 'result' &&
        typeof (data as ResultData)?.pass === 'boolean'
      )
        result = data as ResultData;
      else return _all;
      return '';
    } catch {
      return streaming ? '' : _all;
    }
  });
  // लेखिँदै गरेको अधुरो block नदेखाउने — hide a block that is still being written
  if (streaming)
    markdown = markdown.replace(/```(quiz|challenge|result)[\s\S]*$/, '');
  return { markdown: markdown.trim(), quiz, challenge, result };
}

function isQuiz(d: unknown): d is QuizData {
  const q = (d as QuizData)?.questions;
  return (
    Array.isArray(q) &&
    q.length > 0 &&
    q.every(
      (x) =>
        typeof x?.q === 'string' &&
        Array.isArray(x.options) &&
        x.options.length >= 2 &&
        Number.isInteger(x.answer) &&
        x.answer >= 0 &&
        x.answer < x.options.length,
    )
  );
}
function isChallenge(d: unknown): d is ChallengeData {
  const c = d as ChallengeData;
  return (
    typeof c?.title === 'string' &&
    (typeof c.taskNe === 'string' || typeof c.taskEn === 'string')
  );
}

// ---------------------------------------------------------------- 🎙️ quiz answers by voice
const voiceTargets: ((choice: number) => boolean)[] = [];
/** बोलेर उत्तर: "A", "बी", "दोस्रो", "३"… — answer the open quiz by voice. Returns true if used. */
export function answerQuizByVoice(text: string): boolean {
  const t = text
    .toLowerCase()
    .replace(/[।.,!?]/g, '')
    .replace(/^(उत्तर|answer|option|विकल्प)\s*/, '')
    .trim();
  const table: [RegExp, number][] = [
    [/^(a|ए|एए|पहिलो|first|1|१|one|एक)$/, 0],
    [/^(b|बी|दोस्रो|second|2|२|two|दुई)$/, 1],
    [/^(c|सी|तेस्रो|third|3|३|three|तीन)$/, 2],
    [/^(d|डी|चौथो|fourth|4|४|four|चार)$/, 3],
  ];
  const hit = table.find(([re]) => re.test(t));
  if (!hit) return false;
  // सबैभन्दा नयाँ quiz मात्र — only the newest quiz listens, never an old one far up the chat
  const newest = voiceTargets[voiceTargets.length - 1];
  return newest ? newest(hit[1]) : false;
}

// ---------------------------------------------------------------- Quiz card
export function QuizCard({ data }: { data: QuizData }) {
  const [picked, setPicked] = useState<(number | null)[]>(() =>
    data.questions.map(() => null),
  );
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const choose = (qi: number, oi: number) => {
    if (pickedRef.current[qi] !== null) return;
    const next = [...pickedRef.current];
    next[qi] = oi;
    pickedRef.current = next;
    setPicked(next);
    recordQuiz(oi === data.questions[qi].answer);
  };
  // बोलेर उत्तर दिन मिल्ने: पहिलो बाँकी प्रश्नमा — voice answers go to the first unanswered question
  useEffect(() => {
    const target = (choice: number) => {
      const qi = pickedRef.current.findIndex((p) => p === null);
      if (qi < 0 || choice >= data.questions[qi].options.length) return false;
      choose(qi, choice);
      return true;
    };
    voiceTargets.push(target);
    return () => {
      const i = voiceTargets.indexOf(target);
      if (i >= 0) voiceTargets.splice(i, 1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- registered once per card
  }, []);
  const done = picked.every((p) => p !== null);
  const score = picked.filter((p, i) => p === data.questions[i].answer).length;
  return (
    <div className="quiz-card mt-2 rounded-2xl p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold tracking-wide text-violet-200 uppercase">
        🧠 {tr('क्विज · Quiz')}
        {data.topic && (
          <span className="font-normal normal-case text-slate-400">
            — {data.topic}
          </span>
        )}
        <span className="ml-auto font-normal normal-case text-slate-400">
          {tr('🎤 बोलेर पनि: "A", "बी", "दोस्रो" · Say "A", "B"…')}
        </span>
      </div>
      {data.questions.map((q, qi) => (
        <div key={qi} className="mb-3 last:mb-0">
          <p className="mb-1.5 font-semibold text-slate-100">
            {qi + 1}. {q.q}
          </p>
          <div className="grid gap-1.5">
            {q.options.map((o, oi) => {
              const p = picked[qi];
              const state =
                p === null
                  ? ''
                  : oi === q.answer
                    ? 'quiz-right'
                    : oi === p
                      ? 'quiz-wrong'
                      : 'opacity-50';
              return (
                <button
                  key={oi}
                  className={`quiz-option flex items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm ${state}`}
                  disabled={p !== null}
                  onClick={() => choose(qi, oi)}
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white/10 text-xs font-bold">
                    {String.fromCharCode(65 + oi)}
                  </span>
                  <span className="whitespace-normal">{o}</span>
                  {p !== null && oi === q.answer && (
                    <span className="ml-auto">✅</span>
                  )}
                  {p === oi && oi !== q.answer && (
                    <span className="ml-auto">❌</span>
                  )}
                </button>
              );
            })}
          </div>
          {picked[qi] !== null && q.why && (
            <p className="mt-1.5 rounded-lg bg-white/5 px-2 py-1 text-xs text-slate-300">
              💡 {q.why}
            </p>
          )}
        </div>
      ))}
      {done && (
        <div className="quiz-score mt-2 rounded-xl px-3 py-2 text-center text-sm font-bold text-white">
          {score === data.questions.length ? '🎉 ' : score > 0 ? '👍 ' : '💪 '}
          {tr2(
            `अंक ${score}/${data.questions.length}`,
            `Score ${score}/${data.questions.length}`,
          )}{' '}
          · +{score * 10 + (data.questions.length - score) * 2} ⭐
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Challenge card
export function ChallengeCard({
  data,
  onCheck,
  onStart,
}: {
  data: ChallengeData;
  onCheck?: (c: ChallengeData) => void;
  onStart?: (c: ChallengeData) => void;
}) {
  const progress = useProgress();
  const doneToday = progress.challenges.some(
    (c) => c.day === today() && c.done && c.title === data.title,
  );
  return (
    <div className="challenge-card mt-2 rounded-2xl p-3">
      <div className="flex items-center gap-2 text-xs font-bold tracking-wide text-amber-200 uppercase">
        🎯 {tr('आजको च्यालेन्ज · Today’s challenge')}
        {doneToday && (
          <span className="ml-auto rounded-full bg-emerald-500/20 px-2 text-emerald-200 normal-case">
            ✅ {tr('सकियो · Done')}
          </span>
        )}
      </div>
      <p className="mt-1 text-base font-bold text-white">{data.title}</p>
      {data.concept && (
        <p className="text-[11px] text-amber-200/80">🧩 {data.concept}</p>
      )}
      {data.taskNe && (
        <p className="mt-2 text-sm text-slate-100">{data.taskNe}</p>
      )}
      {data.taskEn && (
        <p className="mt-1 text-sm text-slate-300">{data.taskEn}</p>
      )}
      {data.starter && (
        <pre className="mt-2 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/80 p-2 font-mono text-xs text-slate-200">
          {data.starter}
        </pre>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {data.starter && onStart && (
          <button className="btn-secondary" onClick={() => onStart(data)}>
            {tr('✍️ editor मा सुरु गर · Start in editor')}
          </button>
        )}
        {onCheck && !doneToday && (
          <button className="btn-run" onClick={() => onCheck(data)}>
            {tr('✅ मैले गरें — जाँच · I did it — check')}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Result card
export function ResultCard({
  data,
  forChallenge,
  challengeTitle,
}: {
  data: ResultData;
  forChallenge: boolean;
  /** कुन च्यालेन्ज जाँचिएको — which challenge was checked */
  challengeTitle?: string;
}) {
  const awarded = useRef(false);
  const [bonus, setBonus] = useState(false);
  useEffect(() => {
    if (data.pass && forChallenge && !awarded.current) {
      awarded.current = true;
      setBonus(completeTodaysChallenge(challengeTitle));
    }
  }, [data.pass, forChallenge, challengeTitle]);
  return (
    <div
      className={`mt-2 rounded-2xl p-3 text-sm ${data.pass ? 'result-pass' : 'result-fail'}`}
    >
      <p className="text-base font-bold text-white">
        {data.pass
          ? tr('🎉 च्यालेन्ज पूरा! · Challenge complete!')
          : tr('💪 झन्डै! फेरि प्रयास · Almost! Try again')}
        {bonus && <span className="ml-2 text-amber-200">+30 ⭐</span>}
      </p>
      {data.tip_ne && <p className="mt-1 text-slate-100">{data.tip_ne}</p>}
      {data.tip_en && <p className="mt-0.5 text-slate-300">{data.tip_en}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- 📊 Progress dashboard
export function ProgressDialog({ onClose }: { onClose: () => void }) {
  const p = useProgress();
  const rank = rankOf(p.points);
  const level = loadLevel();
  const accuracy = p.quizTotal
    ? Math.round((p.quizRight / p.quizTotal) * 100)
    : 0;
  const last14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return today(d);
  });
  const toNext =
    rank.next > p.points ? Math.round((p.points / rank.next) * 100) : 100;
  const done = p.challenges.filter((c) => c.done).length;
  return (
    <Modal title={tr('📊 मेरो प्रगति · My progress')} onClose={onClose} wide>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          icon="🔥"
          label={tr('लगातार दिन · Day streak')}
          value={p.streak}
          sub={tr2(`उत्कृष्ट ${p.bestStreak}`, `best ${p.bestStreak}`)}
        />
        <Stat
          icon="⭐"
          label={tr('अंक · Points')}
          value={p.points}
          sub={rank.name}
        />
        <Stat
          icon="🎯"
          label={tr('च्यालेन्ज · Challenges')}
          value={done}
          sub={tr2('पूरा गरेका', 'completed')}
        />
      </div>
      <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="mb-1 flex justify-between text-xs text-slate-300">
          <span>{rank.name}</span>
          <span>
            {p.points} / {rank.next} ⭐
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className="progress-fill h-full rounded-full"
            style={{ width: `${toNext}%` }}
          />
        </div>
        <div
          className="mt-3 flex items-center gap-1"
          title={tr('पछिल्ला १४ दिन · Last 14 days')}
        >
          {last14.map((d) => (
            <span
              key={d}
              className={`h-4 flex-1 rounded ${p.days.includes(d) ? 'day-on' : 'bg-slate-800'}`}
              title={d}
            />
          ))}
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="text-xs font-bold text-sky-200">
            📚{' '}
            {tr2(
              `English शब्द: ${p.words.length}`,
              `English words: ${p.words.length}`,
            )}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            {tr2(
              `लेभल ${level.level}: ${LEVEL_NAMES[level.level]}`,
              `Level ${level.level}`,
            )}
          </div>
          <div className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-auto">
            {p.words
              .slice(-40)
              .reverse()
              .map((w) => (
                <span
                  key={w.word}
                  className="rounded-full border border-sky-400/25 bg-sky-400/10 px-2 py-0.5 text-[11px] text-sky-100"
                  title={w.meaning + (w.example ? ` — ${w.example}` : '')}
                >
                  {w.word}
                </span>
              ))}
            {!p.words.length && (
              <span className="text-xs text-slate-500">
                {tr('Guru सँग सिक्दै जाँदा यहाँ थपिन्छ · Fills up as you learn')}
              </span>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="text-xs font-bold text-violet-200">
            🧩{' '}
            {tr2(
              `कोड कन्सेप्ट: ${p.concepts.length}`,
              `Code concepts: ${p.concepts.length}`,
            )}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            🧠{' '}
            {tr2(
              `Quiz सही: ${p.quizRight}/${p.quizTotal} (${accuracy}%)`,
              `Quiz correct: ${p.quizRight}/${p.quizTotal} (${accuracy}%)`,
            )}
          </div>
          <div className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-auto">
            {p.concepts
              .slice(-60)
              .reverse()
              .map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-violet-400/25 bg-violet-400/10 px-2 py-0.5 font-mono text-[11px] text-violet-100"
                >
                  {c}
                </span>
              ))}
            {!p.concepts.length && (
              <span className="text-xs text-slate-500">
                {tr('कोड बुझ्दै जाँदा यहाँ थपिन्छ · Fills up as you learn')}
              </span>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: string;
  label: string;
  value: number;
  sub: string;
}) {
  return (
    <div className="stat-tile rounded-2xl p-3">
      <div className="text-2xl">{icon}</div>
      <div className="mt-1 text-2xl font-extrabold text-white">{value}</div>
      <div className="text-xs text-slate-300">{label}</div>
      <div className="text-[11px] text-slate-400">{sub}</div>
    </div>
  );
}
