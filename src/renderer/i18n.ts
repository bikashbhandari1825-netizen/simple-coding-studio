// UI भाषा: नेपाली मात्र, English मात्र, वा दुवै।
// UI language: Nepali only, English only, or both.
//
// एपका सबै पाठ "नेपाली · English" वा "नेपाली — English" ढाँचामा लेखिएका छन्।
// tr() ले छानिएको भाषाको भाग मात्र देखाउँछ। App ले भाषा बदल्दा सबै component फेरि render हुन्छन्।
// Every UI string is written as "Nepali · English" or "Nepali — English"; tr() shows only the chosen half.
// App re-renders the whole tree when the language changes, so plain function calls pick up the new value.

export type UiLang = 'ne' | 'en' | 'both';

const KEY = 'studio.uiLang';
let current: UiLang = load();

function load(): UiLang {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'ne' || v === 'en' || v === 'both' ? v : 'both';
  } catch {
    return 'both';
  }
}

export function getUiLang(): UiLang {
  return current;
}

export function setUiLang(lang: UiLang): void {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // ignore
  }
  document.documentElement.lang = lang === 'en' ? 'en' : 'ne';
}

const HAS_DEVANAGARI = /[ऀ-ॿ]/;
// सुरुका emoji/चिन्ह — leading emoji and symbols, carried over to the English half.
const PREFIX =
  /^(?:(?:\p{Extended_Pictographic}|\u{FE0F}|\u{200D}|[▶▴▾●✓])+\s*)+/u;

/** "नेपाली · English" बाट छानिएको भाषाको भाग — Pick the chosen language's half of a bilingual string. */
export function tr(
  text: string | null | undefined,
  lang: UiLang = current,
): string {
  if (!text) return '';
  if (lang === 'both') return text;
  for (const sep of [' — ', ' · ']) {
    const at = text.indexOf(sep);
    if (at <= 0) continue;
    const left = text.slice(0, at);
    const right = text.slice(at + sep.length);
    // बायाँ भाग नेपाली र दायाँ English भए मात्र छुट्याउने — split only when the left half is Nepali and the right is not.
    if (!HAS_DEVANAGARI.test(left) || HAS_DEVANAGARI.test(right.slice(0, 40)))
      continue;
    if (lang === 'ne') return left.trim();
    const prefix = left.match(PREFIX)?.[0] ?? '';
    const english = right.trim();
    return prefix && !english.startsWith(prefix.trim())
      ? `${prefix}${english}`
      : english;
  }
  return text;
}

/** Template वाला पाठका लागि — For strings with values in them: tr2('नेपाली {x}', 'English {x}'). */
export function tr2(ne: string, en: string, lang: UiLang = current): string {
  return lang === 'ne' ? ne : lang === 'en' ? en : `${ne} · ${en}`;
}
