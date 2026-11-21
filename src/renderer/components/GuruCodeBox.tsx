import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import type { CodeBlock } from '../lib/splitCode';

/**
 * 💻 Guru को कोड बाकस: Guru ले लेखेको कोड मुख्य स्क्रिनमा छुट्टै बाकसमा, व्याख्या भने छेउको Guru बाकसमा।
 * Guru's code box: code Guru wrote sits in its own box in front, the explanation stays in the Guru side panel.
 */
export function GuruCodeBox({
  blocks,
  onApply,
  onNewFile,
  onClose,
}: {
  blocks: CodeBlock[];
  /** खुला फाइलमा लगाउन हेर्ने — preview and apply to the open file */
  onApply: (code: string, language: string) => void;
  /** नयाँ फाइलका रूपमा राख्ने (बाटो भए) — save as a new file when a path is known */
  onNewFile?: (path: string, code: string) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  // नयाँ जवाफ आउँदा पहिलो कोडमा फर्किने — back to the first block when a new answer arrives
  useEffect(() => setIndex(0), [blocks]);
  const block = blocks[Math.min(index, blocks.length - 1)];
  if (!block) return null;

  return (
    <div
      data-testid="guru-code-box"
      className="flex h-60 shrink-0 flex-col border-t-2 border-emerald-500/60 bg-slate-950"
    >
      <div className="flex items-center gap-2 border-b border-emerald-500/30 px-3 py-1 text-xs">
        <span className="font-semibold text-emerald-300">
          {tr('💻 Guru को कोड · Guru’s code')}
        </span>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {blocks.map((b, i) => (
            <button
              key={i}
              data-testid="code-tab"
              onClick={() => setIndex(i)}
              className={`shrink-0 rounded px-2 py-0.5 font-mono ${
                i === index
                  ? 'bg-emerald-700/70 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {b.title ?? `${tr('कोड · Code')} ${i + 1}`}
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
          className="icon-btn"
          title={tr('बन्द · Close')}
          aria-label="Close code box"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <pre
        data-testid="code-text"
        className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[13px] leading-5 whitespace-pre text-emerald-50"
      >
        {block.code}
      </pre>
    </div>
  );
}
