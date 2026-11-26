// 🎵 Guru को देखिएको जवाफका "लाइन" (अनुच्छेद, सूची, तालिकाको पंक्ति) — the readable lines of a displayed Guru answer.
// हरेक लाइन थिचेर त्यहींबाट सुन्न (Spotify को गीतको लाइन जस्तै) र बोलिँदै गरेको लाइन उज्यालो पार्न।
// Used to tap a line and listen from there (like a Spotify lyric line), and to highlight the line being read.

const LINE_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, tbody tr';

/** एउटा लाइनको पाठ — the text of one line (a table row becomes "| a | b |") */
function lineText(el: Element): string {
  if (el.tagName === 'TR') {
    const cells = [...el.children].map((c) => (c.textContent ?? '').trim());
    return `| ${cells.join(' | ')} |`;
  }
  const clone = el.cloneNode(true) as Element;
  // भित्रका सूची र कोड अलग लाइन हुन् — nested lists and code are separate lines
  for (const n of clone.querySelectorAll('ul, ol, pre')) n.remove();
  for (const br of clone.querySelectorAll('br'))
    br.replaceWith(document.createTextNode('\n'));
  return (clone.textContent ?? '').trim();
}

/**
 * root भित्रका बोल्न मिल्ने लाइनहरू (DOM क्रममा) र तिनका पाठ — the speakable lines inside `root`, in page order, with their texts.
 * els[i] को पाठ texts[i] हो — els[i] has the text texts[i].
 */
export function answerUnits(root: Element | null): {
  els: HTMLElement[];
  texts: string[];
} {
  const els: HTMLElement[] = [];
  const texts: string[] = [];
  if (!root) return { els, texts };
  for (const node of root.querySelectorAll(LINE_SELECTOR)) {
    const el = node as HTMLElement;
    if (el.closest('pre') || el.closest('[data-testid="code-moved-note"]'))
      continue;
    // खुला सूचीमा <li> भित्र <p> हुन्छ: <p> लाई लाइन मान्ने — in a loose list the <p> inside <li> is the line
    if (el.tagName === 'LI' && el.querySelector(':scope > p')) continue;
    const text = lineText(el);
    if (!text) continue;
    els.push(el);
    texts.push(text);
  }
  return { els, texts };
}

/** जवाफको DOM जग्गा (id बाट) — find a displayed answer's element by its chat id */
export function answerRoot(itemId: string): Element | null {
  return document.querySelector(`[data-answer-id="${CSS.escape(itemId)}"]`);
}

/** बोलिएको id ("<chatId>:all#3") बाट chat id — the chat id inside a speaking id like "<chatId>:all#3" */
export function chatIdOf(speakingId: string): string {
  const m = /^(.*?):(?:all|en|ne)(?:#\d+)?$/.exec(speakingId);
  return m ? m[1] : speakingId;
}
