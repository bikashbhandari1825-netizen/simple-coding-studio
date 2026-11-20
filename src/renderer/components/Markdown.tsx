import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useEffect, useMemo, useRef } from 'react';
import { tr } from '../i18n';

// AI को Markdown जवाफलाई सुरक्षित HTML मा बदल्ने (DOMPurify ले खतरनाक code हटाउँछ)।
// हरेक code block मा "📋 Copy" र "🔍 बुझाऊ" बटन थपिन्छ।
// Render the AI's Markdown answer as safe HTML (DOMPurify strips anything dangerous),
// and add "Copy" and "Explain" buttons to every code block.

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function Markdown({
  text,
  onExplainCode,
  onApplyCode,
  showCodeTools = true,
}: {
  text: string;
  /** Code block को "🔍 बुझाऊ" थिच्दा — called when "Explain" is pressed on a code block. */
  onExplainCode?: (code: string, language: string) => void;
  /** Code block को "🔧 फाइलमा लगाऊ" थिच्दा — called when "Preview & apply" is pressed on a code block. */
  onApplyCode?: (code: string, language: string) => void;
  showCodeTools?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const explainRef = useRef(onExplainCode);
  explainRef.current = onExplainCode;
  const applyRef = useRef(onApplyCode);
  applyRef.current = onApplyCode;
  const canApply = Boolean(onApplyCode);

  const html = useMemo(
    () =>
      DOMPurify.sanitize(
        marked.parse(text, { async: false, gfm: true, breaks: true }) as string,
      ),
    [text],
  );

  useEffect(() => {
    const root = ref.current;
    if (!root || !showCodeTools) return;
    for (const pre of root.querySelectorAll('pre')) {
      if (pre.querySelector('.code-tools')) continue;
      const codeEl = pre.querySelector('code');
      const code = codeEl?.textContent ?? pre.textContent ?? '';
      if (code.trim().split('\n').length < 2 && code.length < 40) continue; // धेरै सानो code मा बटन नचाहिने — skip tiny snippets
      const language = codeEl?.className.match(/language-([\w-]+)/)?.[1] ?? '';
      const bar = document.createElement('div');
      bar.className = 'code-tools';
      const mk = (label: string, onClick: (b: HTMLButtonElement) => void) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', () => onClick(b));
        bar.appendChild(b);
      };
      mk(tr('📋 Copy गर · Copy'), (b) => {
        void navigator.clipboard.writeText(code).then(() => {
          b.textContent = tr('✓ Copy भयो · Copied');
          setTimeout(() => (b.textContent = tr('📋 Copy गर · Copy')), 1500);
        });
      });
      if (explainRef.current)
        mk(tr('🔍 लाइन-लाइन बुझाऊ · Explain line by line'), () =>
          explainRef.current?.(code, language),
        );
      if (
        applyRef.current &&
        !/^(quiz|challenge|result|bash|sh|shell|powershell|cmd|console|text)$/.test(
          language,
        )
      )
        mk(tr('🔧 हेर्ने र फाइलमा लगाऊ · Preview & apply'), () =>
          applyRef.current?.(code, language),
        );
      pre.prepend(bar);
    }
  }, [html, showCodeTools, canApply]);

  return (
    <div
      ref={ref}
      className="md-body"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
