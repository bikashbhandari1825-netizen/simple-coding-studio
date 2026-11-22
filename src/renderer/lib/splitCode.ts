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
  /** आफैं थपिएका import लाइन — import lines added automatically */
  addedImports?: string[];
}

export interface SplitAnswer {
  /** कोड बाहेकको पाठ — the text without any code block */
  text: string;
  blocks: CodeBlock[];
}

// `lib/main.dart` / **pubspec.yaml** / lib/main.dart: — कोड माथिको फाइल बाटो
const PATH_LINE =
  /^[\s`*_#>-]*([\w./\\-]+\.[A-Za-z0-9]{1,6})[\s`*_:]*(?:[—–]\s*(.{1,80}?))?[\s`*_]*$/;

// "Code 2: lib/login_page.dart", "### 2. lib/x.dart" — a short header line that contains a file path somewhere
const LOOSE_PATH =
  /([\w./\\-]*[\w-]\.(?:dart|ya?ml|json|py|js|ts|tsx|jsx|html|css|md|kt|java|xml|gradle|txt))\b/gi;
// // lib/main.dart  /  # pubspec.yaml  /  <!-- index.html --> — the path written on the first line inside the code
const FIRST_LINE_PATH =
  /^\s*(?:\/\/|#|\/\*|<!--)\s*(?:file(?:name)?\s*[:=-]?\s*)?([\w./\\-]*[\w-]\.[A-Za-z0-9]{1,6})\s*(?:-->|\*\/)?\s*$/i;

const snake = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/_{2,}/g, '_')
    .toLowerCase();

/** फाइल नाम नदिएको कोडको बाटो अनुमान — guess the target file from what the code is */
export function inferTitle(code: string, language: string): string | undefined {
  const lang = language.toLowerCase();
  if ((lang === 'yaml' || lang === 'yml') && /^dependencies:/m.test(code))
    return 'pubspec.yaml';
  if (lang === 'dart' || /^\s*import 'package:/m.test(code)) {
    if (/\bvoid\s+main\s*\(/.test(code)) return 'lib/main.dart';
    const widget =
      /^\s*class\s+([A-Z]\w*)\s+extends\s+(?:Stateless|Stateful)Widget/m.exec(
        code,
      );
    const any = /^\s*class\s+([A-Z]\w*)/m.exec(code);
    const name = (widget ?? any)?.[1];
    if (name) return 'lib/' + snake(name) + '.dart';
  }
  return undefined;
}

/** फाइल/फोल्डरको सूची मात्र (कोड होइन)? — only a list of files/folders, not code? */
export function isFileTree(code: string): boolean {
  if (/[;{}]/.test(code)) return false;
  const lines = code.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return false;
  // हरेक लाइन फाइल/फोल्डरको बाटोले सुरु हुन्छ — each line starts with a file or folder path
  const treeish = lines.filter((l) =>
    /^[\s├└│─|+`*-]*(?:[\w.-]+\/)*[\w.-]*(?:\.(?:dart|ya?ml|json|py|js|ts|tsx|html|css|md|kt|java|xml|gradle|txt)\b|\/)/.test(
      l,
    ),
  );
  return treeish.length / lines.length >= 0.7;
}

function makeBlock(lines: string[], title?: string, place?: string): CodeBlock {
  const language = lines[0].trim().slice(3).trim().split(/\s+/)[0] ?? '';
  const closed =
    lines.length > 1 && lines[lines.length - 1].trim().startsWith('```');
  const inner = lines.slice(1, closed ? -1 : undefined);
  const code = inner.join('\n');
  title =
    title ??
    FIRST_LINE_PATH.exec(inner[0] ?? '')?.[1] ??
    inferTitle(code, language);
  return {
    title,
    place,
    language,
    code,
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
      else if (k >= 0 && text[k].length < 120) {
        const all = [...text[k].matchAll(LOOSE_PATH)];
        if (all.length === 1) {
          title = all[0][1];
          text.splice(k, 1);
        }
      }
      current = [line];
    } else {
      current.push(line);
      if (fence) {
        const made = makeBlock(current, title, place);
        // फाइलको रूख (योजना) कोड होइन — व्याख्यामै रहन्छ — a file-tree plan is not code; it stays in the explanation
        if (isFileTree(made.code)) text.push('', ...current, '');
        else blocks.push(made);
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

/**
 * Guru को उत्तरलाई English भाग र नेपाली भागमा छुट्याउने ("नेपाली" शीर्षकबाट)।
 * Split an answer into the English part and the Nepali part (at the "नेपाली" heading).
 */
export function splitNepali(markdown: string): {
  english: string;
  nepali: string;
} {
  const lines = markdown.split('\n');
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('```')) inCode = !inCode;
    if (inCode) continue;
    if (/^[\s#*_>\-:]*(?:🇳🇵\s*)?(?:नेपाली|Nepali)[\s#*_:]*$/u.test(lines[i]))
      return {
        english: lines.slice(0, i).join('\n').trim(),
        nepali: lines.slice(i).join('\n').trim(),
      };
  }
  return { english: markdown, nepali: '' };
}
