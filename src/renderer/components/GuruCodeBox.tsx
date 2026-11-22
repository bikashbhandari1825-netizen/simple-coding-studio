import { useEffect, useMemo, useRef, useState } from 'react';
import { tr } from '../i18n';
import type { CodeBlock } from '../lib/splitCode';
import { placeholderIn } from '../lib/wrongFile';
import { matchProgress, pathMatchLength } from '../lib/typeMatch';

/** क्रम नम्बर सहितको कोड (Code 1, Code 2, …) — a code block with its running number */
export interface NumberedBlock extends CodeBlock {
  n: number;
  /** कुन जवाफबाट आयो — which Guru answer it came from */
  batch: number;
}

/**
 * 💻 Guru को कोड बाकस: Guru ले लेखेको सबै कोड Code 1, Code 2… ट्याबमा सधैं रहन्छ, नयाँ जवाफले मेट्दैन।
 * व्याख्या भने छेउको Guru बाकसमा।
 * Guru's code box: every block Guru wrote stays as a numbered tab (Code 1, Code 2, …) and a new answer never wipes
 * the earlier ones. The explanation stays in the Guru side panel.
 */
export function GuruCodeBox({
  blocks,
  focusIndex,
  onApply,
  onNewFile,
  onClear,
  onClose,
  status = [],
  unlocked = [],
  onUnlock,
  onSelectTab,
  typedFor,
  typingPath = '',
}: {
  blocks: NumberedBlock[];
  /** नयाँ जवाफ आउँदा खुल्ने पहिलो नयाँ ट्याब — the first tab of the newest answer, selected when it arrives */
  focusIndex: number;
  /** खुला फाइलमा लगाउन हेर्ने — preview and apply to the open file */
  onApply: (code: string, language: string) => void;
  /** नयाँ फाइलका रूपमा राख्ने (बाटो भए) — save as a new file when a path is known */
  onNewFile?: (path: string, code: string) => void;
  /** सबै कोड हटाउने — remove all code blocks */
  onClear: () => void;
  /** बाकस लुकाउने (कोड रहन्छ) — hide the box (the code is kept) */
  onClose: () => void;
  /** हरेक Code को अवस्था — state of each step */
  status?: ('todo' | 'green' | 'red')[];
  /** कति Code खुला छन् — how many steps are unlocked */
  unlocked?: boolean[];
  onUnlock?: (index: number) => void;
  /** ट्याबमा क्लिक: त्यो फाइल छैन भने बनाउन सुझाउने — a tab was clicked (the app offers to create a missing file) */
  onSelectTab?: (block: NumberedBlock) => void;
  /** माथिको editor मा त्यो फाइलमा अहिलेसम्म लेखिएको पाठ — the text typed so far in that file's editor above */
  typedFor?: (block: NumberedBlock) => string | undefined;
  /** "नयाँ फाइल" बाकसमा लेखिँदै गरेको बाटो — the path being typed in the New file box */
  typingPath?: string;
}) {
  const [index, setIndex] = useState(focusIndex);
  const [copied, setCopied] = useState(false);
  // नयाँ कोड आउँदा त्यही ट्याब देखाउने, अघिल्ला कोड ट्याब रहिरहन्छन् — show the new block; earlier tabs stay
  useEffect(() => setIndex(focusIndex), [focusIndex, blocks.length]);
  const block = blocks[Math.min(index, blocks.length - 1)];
  if (!block) return null;
  const bi = Math.min(index, blocks.length - 1);
  const typed = typedFor?.(block);
  const progress = useMemo(
    () => matchProgress(block.code, typed),
    [block.code, typed],
  );
  const scroller = useRef<HTMLDivElement>(null);
  // लेख्दै जाँदा तल देखिने कोड आफैं सर्छ — scroll smoothly so the next line to type stays in view
  useEffect(() => {
    const box = scroller.current;
    const typing = progress.matched > 0 || progress.partial.some(Boolean);
    if (!box || !typing || progress.nextLine < 0) return;
    const el = box.querySelector<HTMLElement>(
      `[data-line="${progress.nextLine}"]`,
    );
    if (el) {
      const top = Math.max(0, el.offsetTop - box.clientHeight / 3);
      box.dataset.scrollTo = String(Math.round(top));
      box.scrollTo({ top, behavior: 'smooth' });
    }
  }, [progress.nextLine, progress.matched, bi]);
  const pathTyped = block.title ? pathMatchLength(block.title, typingPath) : 0;
  const isLocked = (i: number) => unlocked[i] === false;
  const locked = isLocked(bi);
  const icon = (i: number) =>
    isLocked(i)
      ? '🔒 '
      : status[i] === 'green'
        ? '✅ '
        : status[i] === 'red'
          ? '❌ '
          : '';

  return (
    <div
      data-testid="guru-code-box"
      className="flex h-64 shrink-0 flex-col border-t-2 border-emerald-500/60 bg-slate-950"
    >
      <div className="flex items-center gap-2 border-b border-emerald-500/30 px-3 py-1 text-xs">
        <span className="shrink-0 text-[13px] font-bold text-emerald-300">
          {tr('💻 Guru को कोड · Guru’s code')}
        </span>
        <div className="flex-1" />
        <button
          className="chip"
          data-testid="code-copy"
          onClick={() => {
            void navigator.clipboard.writeText(block.code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? tr('✓ Copy भयो · Copied') : tr('📋 Copy गर · Copy')}
        </button>
        {block.title && onNewFile && (
          <button
            className="chip"
            data-testid="code-newfile"
            title={tr('यो कोड नयाँ फाइलमा राख्छ · Saves this code as a new file')}
            onClick={() => onNewFile(block.title as string, block.code)}
          >
            {tr('📄 नयाँ फाइल · New file')}
          </button>
        )}
        <button
          className="chip"
          data-testid="code-apply"
          title={tr(
            'खुला फाइलमा के बदलिन्छ हेरेर लगाउने · See what changes in the open file, then apply',
          )}
          onClick={() => onApply(block.code, block.language)}
        >
          {tr('🔧 हेर्ने र फाइलमा लगाऊ · Preview & apply')}
        </button>
        <button
          className="chip"
          data-testid="code-clear"
          title={tr('सबै Code 1, 2… हटाउने · Remove all saved code blocks')}
          onClick={() => {
            if (
              window.confirm(
                tr(
                  `सबै ${blocks.length} कोड हटाउने? — Remove all ${blocks.length} code blocks?`,
                ),
              )
            )
              onClear();
          }}
        >
          🗑
        </button>
        <button
          className="icon-btn"
          title={tr('लुकाऊ (कोड रहन्छ) · Hide (the code is kept)')}
          aria-label="Hide code box"
          onClick={onClose}
        >
          ▾
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* 📁 हरेक फाइल छुट्टै: बाटो, अवस्था र आफ्नै बटन — each file stands apart, like items in a sidebar */}
        <nav
          data-testid="code-list"
          className="w-56 shrink-0 space-y-1 overflow-y-auto border-r border-slate-800 p-1.5"
        >
          {blocks.map((b, i) => (
            <button
              key={b.n}
              data-testid="code-tab"
              title={b.title ?? ''}
              onClick={() => {
                setIndex(i);
                onSelectTab?.(b);
              }}
              className={`block w-full rounded-md px-2 py-1 text-left font-mono ${
                i === index
                  ? 'bg-emerald-600 text-white'
                  : status[i] === 'red'
                    ? 'bg-red-900 text-red-100 hover:bg-red-800'
                    : isLocked(i)
                      ? 'bg-slate-900 text-slate-500 hover:bg-slate-800'
                      : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              <span className="block text-[12px] font-bold">
                {icon(i)}
                {`Code ${b.n}`}
              </span>
              <span className="block truncate text-[11px] font-bold opacity-90">
                {b.title ?? tr('फाइल नाम छैन · no file name')}
              </span>
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            data-testid="code-target"
            className="flex items-center gap-2 border-b border-slate-800 px-3 py-1 font-mono text-[13px] font-bold"
          >
            <span
              data-testid="code-file"
              className="text-[15px] font-bold text-emerald-300"
              style={{ fontWeight: 700 }}
            >
              {block.title ? (
                <>
                  {'📄 '}
                  <mark
                    data-testid="code-path-typed"
                    className="rounded bg-emerald-500/40 px-0 text-emerald-100"
                  >
                    {block.title.slice(0, pathTyped)}
                  </mark>
                  {block.title.slice(pathTyped)}
                </>
              ) : (
                tr('📄 फाइल नाम Guru ले दिएन · file name not given')
              )}
            </span>
            {block.place && (
              <span className="text-slate-300">— {block.place}</span>
            )}
            {progress.matched > 0 && (
              <span
                data-testid="code-progress"
                className="rounded bg-emerald-900/70 px-1.5 text-[12px] text-emerald-200"
              >
                {`✍️ ${progress.matched}/${progress.total}`}
              </span>
            )}
            <span
              data-testid="code-status"
              className={
                status[bi] === 'green'
                  ? 'ml-auto text-emerald-400'
                  : status[bi] === 'red'
                    ? 'ml-auto text-red-400'
                    : 'ml-auto text-slate-400'
              }
            >
              {locked
                ? tr(
                    '🔒 अघिल्लो Code हरियो भएपछि खुल्छ · Unlocks after the previous Code is green and runs',
                  )
                : status[bi] === 'green'
                  ? tr('✅ पूरा · Complete')
                  : status[bi] === 'red'
                    ? tr('❌ गल्ती छ · Has errors')
                    : tr(
                        '✍️ यो फाइलमा टाइप/पेस्ट गर्नुहोस् · Type or paste into this file',
                      )}
            </span>
          </div>
          {locked ? (
            <div
              data-testid="code-locked"
              className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-sm font-semibold text-slate-300"
            >
              <span>
                {tr(
                  '🔒 Code ' +
                    block.n +
                    ' पर्खाइमा छ · waiting — finish the earlier Code first, then run',
                )}
              </span>
              {onUnlock && (
                <button
                  className="chip"
                  data-testid="code-unlock"
                  onClick={() => onUnlock(bi)}
                >
                  {tr('🔓 अहिले नै खोल · Unlock now')}
                </button>
              )}
            </div>
          ) : (
            <>
              {placeholderIn(block.code) && (
                <div
                  data-testid="code-placeholder"
                  className="border-b border-red-500 bg-red-950 px-3 py-1 text-[13px] font-bold text-red-100"
                >
                  {tr(
                    `❌ Not real code: it has "${placeholderIn(block.code)}". Ask Guru for the full code. · यो असली कोड होइन, "${placeholderIn(block.code)}" छ। Guru लाई पूरा कोड माग्नुहोस्।`,
                  )}
                </div>
              )}
              <div
                ref={scroller}
                data-testid="code-text"
                className="relative min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[15px] leading-6 font-semibold whitespace-pre text-emerald-50"
              >
                {block.code.split('\n').map((line, i) => (
                  <div
                    key={i}
                    data-line={i}
                    data-state={progress.states[i]}
                    data-partial={progress.partial[i] || undefined}
                    className={
                      progress.states[i] === 'done'
                        ? 'rounded-sm bg-emerald-500/30 text-emerald-100'
                        : progress.states[i] === 'next'
                          ? 'rounded-sm bg-sky-500/30 ring-1 ring-sky-400'
                          : ''
                    }
                  >
                    {(() => {
                      if (line === '') return ' ';
                      const n = progress.partial[i];
                      if (!n) return line;
                      // अहिलेसम्म टाइप भएका अक्षर हरिया — the characters typed so far turn green
                      const lead = line.length - line.trimStart().length;
                      return (
                        <>
                          <span
                            data-testid="typed-part"
                            className="rounded-sm bg-emerald-500/45 text-emerald-100"
                          >
                            {line.slice(0, lead + n)}
                          </span>
                          {line.slice(lead + n)}
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
