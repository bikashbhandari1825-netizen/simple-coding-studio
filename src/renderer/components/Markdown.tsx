import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';

// AI को Markdown जवाफलाई सुरक्षित HTML मा बदल्ने (DOMPurify ले खतरनाक code हटाउँछ)।
// Render the AI's Markdown answer as safe HTML (DOMPurify strips anything dangerous).

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function Markdown({ text }: { text: string }) {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(
        marked.parse(text, { async: false, gfm: true, breaks: true }) as string,
      ),
    [text],
  );
  return <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
