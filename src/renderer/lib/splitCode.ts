// 📦 Guru को जवाफलाई दुई बाकसमा छुट्याउने: व्याख्या (पाठ) एउटा, कोड अर्को।
// Splits Guru's Markdown answer into two boxes: the explanation text, and each fenced code block on its own.

export interface CodeBlock {
  /** फाइलको नाम/बाटो (कोड माथिको लाइन), भए — the file path on the line just above the block, if any */
  title?: string;
  /** कहाँ राख्ने (छोटो टिप्पणी) — where/how to place it, if given */
  place?: string;
  /** भाषा (``` पछिको शब्द) — the language after the fence */
  language: string;
  /** कोड मात्र, ``` बिना — the code only, without fences */
  code: string;
  /** ``` सहितको पूरा block — the whole fenced block */
  markdown: string;
}

export interface SplitAnswer {
  /** कोड बाहेकको पाठ — the text without any code block */
  text: string;
  blocks: CodeBlock[];
}

// `lib/main.dart` / **pubspec.yaml** / lib/main.dart: — कोड माथिको फाइल बाटो
const PATH_LINE =
  /^[\s`*_#>-]*([\w./\\-]+\.[A-Za-z0-9]{1,6})[\s`*_:]*(?:[—–]\s*(.{1,80}?))?[\s`*_]*$/;

function makeBlock(lines: string[], title?: string, place?: string): CodeBlock {
  const language = lines[0].trim().slice(3).trim().split(/\s+/)[0] ?? '';
  const closed =
    lines.length > 1 && lines[lines.length - 1].trim().startsWith('```');
  const inner = lines.slice(1, closed ? -1 : undefined);
  return {
    title,
    place,
    language,
    code: inner.join('\n'),
    markdown: lines.join('\n'),
  };
}

export function splitCode(markdown: string): SplitAnswer {
  const text: string[] = [];
  const blocks: CodeBlock[] = [];
  let current: string[] | null = null;
  let title: string | undefined;
  let place: string | undefined;
  for (const line of markdown.split('\n')) {
    const fence = line.trim().startsWith('```');
    if (current === null) {
      if (!fence) {
        text.push(line);
        continue;
      }
      // कोडभन्दा तुरुन्तै माथिको फाइल बाटो शीर्षक बन्छ — a file path right above the block becomes its title
      let k = text.length - 1;
      while (k >= 0 && !text[k].trim()) k--;
      const m = k >= 0 ? PATH_LINE.exec(text[k]) : null;
      title = m ? m[1] : undefined;
      place = m?.[2]?.replace(/[`*_]+/g, '').trim() || undefined;
      if (m) text.splice(k, 1);
      current = [line];
    } else {
      current.push(line);
      if (fence) {
        blocks.push(makeBlock(current, title, place));
        current = null;
        title = undefined;
        place = undefined;
      }
    }
  }
  // लेखिँदै गरेको (बन्द नभएको) block पनि कोड बाकसमा — an unfinished block still goes to the code box
  if (current) blocks.push(makeBlock(current, title, place));
  return {
    text: text
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    blocks,
  };
}
