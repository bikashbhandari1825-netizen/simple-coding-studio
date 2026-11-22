import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { tr } from '../i18n';
import {
  currentStepIndex,
  norm,
  type Guide,
  type GuideTarget,
} from '../lib/errorGuide';

interface Spot {
  rect: DOMRect;
  /** ठ्याक्कै त्यही हो वा नजिकको माथिल्लो फोल्डर — the exact row, or the nearest visible parent folder */
  exact: boolean;
  inEditor: boolean;
}

const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/** लक्ष्य पेजमा खोज्ने — find the target element on the page */
function findSpot(target: GuideTarget): Spot | null {
  if (target.kind === 'tree') {
    const rows = [
      ...document.querySelectorAll<HTMLElement>('[data-tree-path]'),
    ];
    let path = norm(target.path).toLowerCase();
    let exact = true;
    // खुलेको ट्रीमा नभए नजिकको माथिल्लो फोल्डर देखाउने — if it is not shown, point at the nearest parent folder
    while (path.includes('/')) {
      const row = rows.find(
        (r) => norm(r.dataset.treePath ?? '').toLowerCase() === path,
      );
      if (row && visible(row))
        return { rect: row.getBoundingClientRect(), exact, inEditor: false };
      path = path.replace(/\/[^/]*$/, '');
      exact = false;
    }
    const top = document.querySelector('[data-guide-root]');
    return top && visible(top)
      ? { rect: top.getBoundingClientRect(), exact: false, inEditor: false }
      : null;
  }
  if (target.kind === 'button') {
    const want = target.match.toLowerCase();
    // तयार चिनारी भएको बटन पहिले — a button with an explicit guide mark comes first
    const marked = document.querySelector<HTMLElement>(
      `[data-guide-button="${want}"]`,
    );
    if (marked && visible(marked))
      return {
        rect: marked.getBoundingClientRect(),
        exact: true,
        inEditor: false,
      };
    const hit = [...document.querySelectorAll<HTMLElement>('button')].find(
      (b) =>
        visible(b) &&
        ((b.title ?? '').toLowerCase().includes(want) ||
          (b.textContent ?? '').toLowerCase().includes(want)),
    );
    return hit
      ? { rect: hit.getBoundingClientRect(), exact: true, inEditor: false }
      : null;
  }
  if (target.kind === 'dialog-input') {
    const input = document.querySelector<HTMLElement>(
      '[role=dialog]:not(.find-widget) input',
    );
    return input && visible(input)
      ? { rect: input.getBoundingClientRect(), exact: true, inEditor: false }
      : null;
  }
  const ed = document.querySelector('.monaco-editor');
  return ed && visible(ed)
    ? { rect: ed.getBoundingClientRect(), exact: true, inEditor: true }
    : null;
}

/**
 * 🧭 गल्तीको मार्गदर्शक: कारण, फाइल, चरणहरू र नाच्ने तीर।
 * Error guide: the reason, the file, the steps, and an animated arrow that points at the next place to click.
 */
export function ErrorGuide({
  guide,
  onClose,
  onCreate,
  docked = false,
}: {
  guide: Guide;
  onClose: () => void;
  /** फाइल यहीँ बनाउने — create the missing file right here */
  onCreate?: (relPath: string) => void;
  /** Guru बाकस भित्र राख्ने (तैरिने होइन) — place the card inside the Guru panel instead of floating */
  docked?: boolean;
}) {
  const auto = currentStepIndex(guide);
  const [picked, setPicked] = useState<number | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  // सुरुमा English मात्र; बटन थिचेपछि नेपाली देखिन्छ — English only at first; the button reveals Nepali
  const [showNe, setShowNe] = useState(false);
  useEffect(() => setShowNe(false), [guide.key]);
  // नयाँ गल्ती आए आफैं पहिलो कदम — a new problem starts at its own current step
  useEffect(() => setPicked(null), [guide.key]);
  const index = picked ?? auto;
  const step = guide.steps[index];
  const allDone = guide.steps.every((s) => s.done);

  // तीरको ठाउँ बारम्बार नयाँ गर्ने (स्क्रोल/साइज बदलिँदा) — keep the arrow position fresh
  useEffect(() => {
    const update = () => setSpot(findSpot(step.target));
    update();
    const id = setInterval(update, 300);
    window.addEventListener('resize', update);
    return () => {
      clearInterval(id);
      window.removeEventListener('resize', update);
    };
  }, [step.target]);

  return (
    <>
      {/* तीर body मा राख्ने: Guru बाकसको transform/blur भित्र 'fixed' ठाउँ बिग्रन्छ — the arrow lives in <body>, because a transformed or blurred parent breaks 'fixed' positions */}
      {spot &&
        !step.done &&
        createPortal(
          <div
            aria-hidden
            data-testid="guide-arrow"
            className="pointer-events-none fixed z-50"
            style={
              spot.inEditor
                ? { left: spot.rect.left + 18, top: spot.rect.top + 12 }
                : {
                    left: Math.min(
                      spot.rect.right + 4,
                      window.innerWidth - 150,
                    ),
                    top: spot.rect.top + spot.rect.height / 2 - 16,
                  }
            }
          >
            {!spot.inEditor && (
              <div
                className="guide-ring absolute rounded-md"
                style={{
                  left:
                    spot.rect.left -
                    Math.min(spot.rect.right + 4, window.innerWidth - 150) -
                    3,
                  top: -(spot.rect.height / 2 - 16) - 3,
                  width: spot.rect.width + 6,
                  height: spot.rect.height + 6,
                }}
              />
            )}
            <div className="guide-arrow flex items-center gap-1 rounded-full bg-violet-300 px-3 py-1 text-sm font-extrabold text-slate-900 shadow-lg shadow-black/50">
              <span className="text-lg leading-none">
                {spot.inEditor ? '⬇' : '⬅'}
              </span>
              <span>{tr('यहाँ · Here')}</span>
            </div>
          </div>,
          document.body,
        )}

      <div
        data-testid="error-guide"
        className={`rounded-xl border-2 border-sky-400 bg-slate-900 p-3 text-sm shadow-2xl shadow-black/60 ${
          docked
            ? 'm-2'
            : 'fixed right-4 bottom-4 z-40 w-[380px] max-w-[calc(100vw-2rem)]'
        }`}
      >
        <div className="flex items-start gap-2">
          <span className="text-lg">🧭</span>
          <div className="min-w-0 flex-1">
            {/* पहिले English, नेपाली बटन थिचेपछि — English first; Nepali on demand */}
            <div data-testid="guide-en" className="font-bold text-slate-50">
              {guide.en}
            </div>
            {showNe && (
              <div data-testid="guide-ne" className="font-bold text-sky-200">
                {guide.ne}
              </div>
            )}
          </div>
          <button
            className="icon-btn"
            aria-label="Close guide"
            title={tr('बन्द गर्नुहोस् · Close')}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <button
          data-testid="guide-explain-ne"
          className="mt-2 rounded-lg border border-sky-400 px-3 py-1 text-sm font-bold text-sky-200 hover:bg-sky-900/40"
          onClick={() => setShowNe((v) => !v)}
        >
          {showNe
            ? '🇬🇧 English मात्र · English only'
            : '🇳🇵 नेपालीमा एक्सप्लेन गर · Explain in Nepali'}
        </button>
        <div
          data-testid="guide-file"
          className="mt-2 rounded bg-slate-800 px-2 py-1 font-mono text-[13px] font-bold text-emerald-300"
        >
          {`📄 ${guide.file}`}
        </div>
        {guide.createPath && onCreate && (
          <button
            data-testid="guide-create"
            className="mt-2 w-full rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-extrabold text-slate-900 hover:bg-emerald-400"
            onClick={() => onCreate(guide.createPath as string)}
          >
            {tr(`📄 यहीँ बनाइदेऊ · Create ${guide.createPath} for me`)}
          </button>
        )}
        <ol className="mt-2 space-y-1">
          {guide.steps.map((s, i) => {
            const current = i === index && !s.done;
            return (
              <li key={s.id}>
                <button
                  data-testid="guide-step"
                  data-done={s.done ? 'yes' : 'no'}
                  data-current={current ? 'yes' : 'no'}
                  onClick={() => setPicked(i)}
                  className={`flex w-full items-start gap-2 rounded-md px-2 py-1 text-left ${
                    current
                      ? 'bg-violet-300/20 ring-1 ring-violet-300'
                      : 'hover:bg-slate-800'
                  }`}
                >
                  <span
                    className={`${s.done ? 'guide-pop' : ''} mt-0.5 shrink-0 rounded px-1.5 text-[11px] font-extrabold ${
                      s.done
                        ? 'bg-emerald-500 text-slate-900'
                        : current
                          ? 'bg-violet-300 text-slate-900'
                          : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {s.done ? '✅ OK · Good' : `${i + 1}`}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`block font-semibold ${s.done ? 'text-slate-400 line-through' : 'text-slate-100'}`}
                    >
                      {s.en}
                    </span>
                    {showNe && (
                      <span
                        className={`block ${s.done ? 'text-slate-500' : 'text-sky-200'}`}
                      >
                        {s.ne}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {allDone && (
          <div
            data-testid="guide-alldone"
            className="mt-2 rounded bg-emerald-900/60 px-2 py-1 font-bold text-emerald-200"
          >
            {tr(
              '✅ सबै कदम सकिए। गल्ती अझै भए "प्याकेजहरू ल्याऊ" थिच्नुहोस् · All steps done. If the error stays, press Get packages.',
            )}
          </div>
        )}
      </div>
    </>
  );
}
