import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import type { CodeBlock } from '../lib/splitCode';

/** क्रम नम्बर सहितको कोड (Code 1, Code 2, …) — a code block with its running number */
export interface NumberedBlock extends CodeBlock {
  n: number;
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
  unlockedCount = 9999,
  onUnlock,
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
  unlockedCount?: number;
  onUnlock?: (index: number) => void;
}) {
  const [index, setIndex] = useState(focusIndex);
  const [copied, setCopied] = useState(false);
  // नयाँ कोड आउँदा त्यही ट्याब देखाउने, अघिल्ला कोड ट्याब रहिरहन्छन् — show the new block; earlier tabs stay
  useEffect(() => setIndex(focusIndex), [focusIndex, blocks.length]);
  const block = blocks[Math.min(index, blocks.length - 1)];
  if (!block) return null;
  const bi = Math.min(index, blocks.length - 1);
  const locked = bi >= unlockedCount;
  const icon = (i: number) =>
    i >= unlockedCount
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
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {blocks.map((b, i) => (
            <button
              key={b.n}
              data-testid="code-tab"
              title={b.title ?? ''}
              onClick={() => setIndex(i)}
              className={`shrink-0 rounded px-2 py-0.5 font-mono text-[12px] font-bold ${
                i === index
                  ? 'bg-emerald-600 text-white'
                  : status[i] === 'red'
                    ? 'bg-red-900 text-red-100 hover:bg-red-800'
                    : i >= unlockedCount
                      ? 'bg-slate-900 text-slate-500 hover:bg-slate-800'
                      : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              {icon(i)}
              {`Code ${b.n}`}
              {b.title ? ` · ${b.title}` : ''}
            </button>
          ))}
        </div>
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
      <div
        data-testid="code-target"
        className="flex items-center gap-2 border-b border-slate-800 px-3 py-1 font-mono text-[13px] font-bold"
      >
        <span className="text-emerald-300">
          {block.title
            ? `📄 ${block.title}`
            : tr('📄 फाइल नाम छैन · no file name')}
        </span>
        {block.place && <span className="text-slate-300">— {block.place}</span>}
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
        <pre
          data-testid="code-text"
          className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[15px] leading-6 font-semibold whitespace-pre text-emerald-50"
        >
          {block.code}
        </pre>
      )}
    </div>
  );
}
