import { useState } from 'react';
import { tr2, tr } from '../i18n';
import {
  LESSONS,
  hintFor,
  isCorrect,
  isUnlocked,
  offerGuru,
  parsePassed,
  type AskItem,
  type Bi,
  type InfoItem,
  type Lesson,
} from '../lib/lessons';
import { Modal } from './Dialogs';

const STORE = 'scs.learn.v1';

function loadPassed(): string[] {
  try {
    return parsePassed(localStorage.getItem(STORE));
  } catch {
    return [];
  }
}

function savePassed(ids: string[]): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(ids));
  } catch {
    // सेभ नभए पनि पाठ चल्छ — the lesson still works without saving
  }
}

const t = (b: Bi) => tr2(b.ne, b.en);

type View =
  | { mode: 'list' }
  | { mode: 'map'; id: string }
  | { mode: 'run'; id: string; index: number }
  | { mode: 'done'; id: string };

/** 🎓 पाठ: एक-एक चरण, क्विज मिलेपछि मात्र अगाडि — lessons: one step at a time, and you move on only when the quiz is right. */
export function LearnPanel({
  onClose,
  onAskGuru,
}: {
  onClose: () => void;
  /** धेरै पटक अड्किएमा Guru लाई सोध्ने (प्रयोगकर्ताले थिचेमा मात्र) — ask Guru when stuck (only when the learner presses it) */
  onAskGuru: (question: string) => void;
}) {
  const [passed, setPassed] = useState<string[]>(loadPassed);
  const [view, setView] = useState<View>({ mode: 'list' });

  const lesson = (id: string): Lesson =>
    LESSONS.find((l) => l.id === id) ?? LESSONS[0];

  const pass = (id: string) => {
    const next = passed.includes(id) ? passed : [...passed, id];
    setPassed(next);
    savePassed(next);
  };

  return (
    <Modal title={tr('🎓 सिक्ने · Learn')} onClose={onClose} wide>
      {view.mode === 'list' && (
        <LessonList
          passed={passed}
          onOpen={(id) => setView({ mode: 'map', id })}
        />
      )}
      {view.mode === 'map' && (
        <LessonMap
          lesson={lesson(view.id)}
          onBack={() => setView({ mode: 'list' })}
          onStart={() => setView({ mode: 'run', id: view.id, index: 0 })}
        />
      )}
      {view.mode === 'run' && (
        <LessonRun
          key={`${view.id}:${view.index}`}
          lesson={lesson(view.id)}
          index={view.index}
          onBack={() => setView({ mode: 'list' })}
          onNext={() => {
            const l = lesson(view.id);
            if (view.index + 1 >= l.items.length) {
              pass(l.id);
              setView({ mode: 'done', id: l.id });
            } else {
              setView({ mode: 'run', id: l.id, index: view.index + 1 });
            }
          }}
          onAskGuru={(q) => {
            onClose();
            onAskGuru(q);
          }}
        />
      )}
      {view.mode === 'done' && (
        <LessonDone
          lesson={lesson(view.id)}
          nextId={
            LESSONS[LESSONS.findIndex((l) => l.id === view.id) + 1]?.id ?? null
          }
          onList={() => setView({ mode: 'list' })}
          onNext={(id) => setView({ mode: 'map', id })}
        />
      )}
    </Modal>
  );
}

function LessonList({
  passed,
  onOpen,
}: {
  passed: string[];
  onOpen: (id: string) => void;
}) {
  return (
    <div data-testid="learn-list">
      <p className="mb-3 text-sm text-slate-400">
        {tr(
          'एक पाठमा एउटै विषय। क्विज मिलेपछि मात्र अर्को पाठ खुल्छ। कुनै समय सीमा छैन। · One topic per lesson. The next lesson opens only when the quiz is right. There is no timer.',
        )}
      </p>
      <ul className="space-y-2">
        {LESSONS.map((l, i) => {
          const done = passed.includes(l.id);
          const open = isUnlocked(LESSONS, passed, l.id);
          return (
            <li key={l.id}>
              <button
                data-testid={`lesson-${l.id}`}
                data-state={done ? 'passed' : open ? 'open' : 'locked'}
                disabled={!open}
                onClick={() => onOpen(l.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span aria-hidden="true" className="text-xl">
                  {done ? '✅' : open ? '▶' : '🔒'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-100">
                    {i + 1}. {t(l.title)}
                  </span>
                  <span className="block text-xs text-slate-400">
                    {done
                      ? tr2('पास भयो', 'Passed')
                      : open
                        ? tr2('सुरु गर्न तयार', 'Ready to start')
                        : tr2(
                            'अघिल्लो पाठ पास गरेपछि खुल्छ',
                            'Opens after you pass the lesson before',
                          )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        {tr('अर्को: variable (चलक) — छिट्टै आउँछ · Next: variables — coming soon')}
      </p>
    </div>
  );
}

function LessonMap({
  lesson,
  onBack,
  onStart,
}: {
  lesson: Lesson;
  onBack: () => void;
  onStart: () => void;
}) {
  const rows: [string, Bi][] = [
    [tr2('यो पाठमा के सिकिन्छ', 'What you learn'), lesson.map.learn],
    [tr2('कति चरण', 'How long'), lesson.map.steps],
    [tr2('अन्त्यमा के हुन्छ', 'What you can do at the end'), lesson.map.result],
    [tr2('गल्ती भयो भने?', 'If you make a mistake?'), lesson.map.risk],
  ];
  return (
    <div data-testid="learn-map">
      <h3 className="mb-1 text-base font-semibold text-slate-100">
        {t(lesson.title)}
      </h3>
      <p className="mb-3 text-xs text-slate-400">
        {tr2('पाठको नक्सा', 'Lesson map')}
      </p>
      <dl className="space-y-2">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2"
          >
            <dt className="text-xs font-semibold text-sky-300">{k}</dt>
            <dd className="text-sm text-slate-200">{t(v)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onBack}>
          {tr('← पाठ सूची · Lessons')}
        </button>
        <button
          className="btn-primary"
          data-testid="learn-start"
          onClick={onStart}
        >
          {tr('सुरु · Start')}
        </button>
      </div>
    </div>
  );
}

function LessonRun({
  lesson,
  index,
  onBack,
  onNext,
  onAskGuru,
}: {
  lesson: Lesson;
  index: number;
  onBack: () => void;
  onNext: () => void;
  onAskGuru: (question: string) => void;
}) {
  const item = lesson.items[index];
  const last = index + 1 >= lesson.items.length;
  return (
    <div data-testid="learn-run">
      <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
        <span>
          {t(lesson.title)} · {index + 1}/{lesson.items.length}
        </span>
        <button className="btn-ghost" onClick={onBack}>
          {tr('← पाठ सूची · Lessons')}
        </button>
      </div>
      {item.kind === 'info' ? (
        <InfoStep item={item} last={last} onNext={onNext} />
      ) : (
        <AskStep
          item={item}
          last={last}
          onNext={onNext}
          onAskGuru={onAskGuru}
        />
      )}
    </div>
  );
}

function InfoStep({
  item,
  last,
  onNext,
}: {
  item: InfoItem;
  last: boolean;
  onNext: () => void;
}) {
  const [why, setWhy] = useState(false);
  return (
    <div>
      <h3 className="mb-2 text-base font-semibold text-slate-100">
        {t(item.title)}
      </h3>
      <p className="mb-3 text-sm leading-relaxed text-slate-200">
        {t(item.text)}
      </p>
      {item.code && (
        <pre className="mb-3 overflow-auto rounded-xl bg-slate-950/80 p-3 font-mono text-sm text-emerald-200">
          {item.code}
        </pre>
      )}
      {item.table && (
        <table className="mb-3 w-full overflow-hidden rounded-xl border border-white/10 text-sm">
          <thead className="bg-white/5 text-slate-300">
            <tr>
              {item.table.head.map((h) => (
                <th key={h.en} className="px-3 py-1.5 text-left font-semibold">
                  {t(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {item.table.rows.map((row) => (
              <tr key={row.join('|')} className="border-t border-white/10">
                {row.map((cell, c) => (
                  <td key={c} className="px-3 py-1.5 font-mono text-slate-100">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {item.why && (
        <div className="mb-3">
          <button
            className="btn-ghost"
            data-testid="learn-why"
            onClick={() => setWhy((v) => !v)}
          >
            {tr('🤔 किन? · Why?')}
          </button>
          {why && (
            <p
              data-testid="learn-why-text"
              className="mt-2 rounded-xl border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-sm text-sky-100"
            >
              {t(item.why)}
            </p>
          )}
        </div>
      )}
      <div className="flex justify-end">
        <button
          className="btn-primary"
          data-testid="learn-next"
          onClick={onNext}
        >
          {last ? tr('पूरा · Finish') : tr('अर्को · Next')}
        </button>
      </div>
    </div>
  );
}

function AskStep({
  item,
  last,
  onNext,
  onAskGuru,
}: {
  item: AskItem;
  last: boolean;
  onNext: () => void;
  onAskGuru: (question: string) => void;
}) {
  const [typed, setTyped] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [wrong, setWrong] = useState(0);
  const [right, setRight] = useState(false);

  const answer = item.options ? (picked ?? '') : typed;
  const check = () => {
    if (right || !answer.trim()) return;
    if (isCorrect(item, answer)) setRight(true);
    else setWrong((w) => w + 1);
  };
  const hint = hintFor(item, wrong);

  return (
    <div>
      <span className="mb-2 inline-block rounded-full bg-violet-500/20 px-2.5 py-0.5 text-xs text-violet-200">
        {item.label === 'puzzle'
          ? tr('🧩 दिमागी खेल · Brain puzzle')
          : tr('✏️ अभ्यास · Practice')}
      </span>
      <p
        data-testid="learn-prompt"
        className="mb-3 text-base leading-relaxed text-slate-100"
      >
        {t(item.prompt)}
      </p>
      {item.options ? (
        <div className="mb-3 grid gap-2">
          {item.options.map((o) => (
            <button
              key={o}
              data-testid="learn-option"
              disabled={right}
              onClick={() => setPicked(o)}
              className={`rounded-xl border px-3 py-2 text-left text-sm ${
                picked === o
                  ? 'border-sky-400 bg-sky-400/15 text-sky-100'
                  : 'border-white/10 bg-white/5 text-slate-200'
              }`}
            >
              {tr(o)}
            </button>
          ))}
        </div>
      ) : (
        <input
          data-testid="learn-input"
          autoFocus
          disabled={right}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && check()}
          placeholder={tr2('यहाँ लेख्नुहोस्', 'Type here')}
          className="glass-input mb-3 w-full rounded-xl px-3 py-2 text-slate-100 outline-none"
        />
      )}
      {right && (
        <p
          data-testid="learn-right"
          className="mb-3 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200"
        >
          ✓ {t(item.right)}
        </p>
      )}
      {!right && wrong > 0 && (
        <div data-testid="learn-wrong" className="mb-3 space-y-2">
          <p className="rounded-xl border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
            {tr2(
              'अहिलेसम्म मिलेन। केही बिग्रेको छैन, अर्को प्रयास गरौँ।',
              'Not yet. Nothing is broken. Let us try again.',
            )}
          </p>
          {hint && (
            <p
              data-testid="learn-hint"
              className="rounded-xl border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-sm text-sky-100"
            >
              💡 {t(hint)}
            </p>
          )}
          {offerGuru(wrong) && (
            <button
              className="btn-ghost"
              data-testid="learn-guru"
              onClick={() =>
                onAskGuru(
                  `I am learning and I am stuck on this quiz question. Explain the idea behind it in very simple English with one small example. Do not give the final answer.\n\n${item.prompt.en}`,
                )
              }
            >
              {tr('💬 Guru लाई सोध्ने · Ask Guru')}
            </button>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        {!right && (
          <button
            className="btn-primary"
            data-testid="learn-check"
            disabled={!answer.trim()}
            onClick={check}
          >
            {tr('जाँच · Check')}
          </button>
        )}
        {right && (
          <button
            className="btn-primary"
            data-testid="learn-next"
            onClick={onNext}
          >
            {last ? tr('पाठ पूरा · Finish lesson') : tr('अर्को · Next')}
          </button>
        )}
      </div>
    </div>
  );
}

function LessonDone({
  lesson,
  nextId,
  onList,
  onNext,
}: {
  lesson: Lesson;
  nextId: string | null;
  onList: () => void;
  onNext: (id: string) => void;
}) {
  return (
    <div data-testid="learn-done">
      <p className="mb-3 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-3 text-base text-emerald-200">
        🎉 {tr2('पाठ पास भयो:', 'Lesson passed:')} {t(lesson.title)}
      </p>
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onList}>
          {tr('← पाठ सूची · Lessons')}
        </button>
        {nextId && (
          <button
            className="btn-primary"
            data-testid="learn-next-lesson"
            onClick={() => onNext(nextId)}
          >
            {tr('अर्को पाठ · Next lesson')}
          </button>
        )}
      </div>
    </div>
  );
}
