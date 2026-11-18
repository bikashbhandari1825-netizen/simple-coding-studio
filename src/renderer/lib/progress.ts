import { useEffect, useState } from 'react';

// 📊 सिकाइको प्रगति: अंक, लगातार दिन (streak), सिकेका English शब्द र कोडिङ कन्सेप्ट, quiz र च्यालेन्ज।
// Learning progress: points, daily streak, English words and coding concepts learned, quizzes and challenges.

export interface Word {
  word: string;
  meaning: string;
  example?: string;
}

export interface Challenge {
  day: string;
  title: string;
  concept?: string;
  taskNe: string;
  taskEn: string;
  starter?: string;
  done: boolean;
}

export interface Progress {
  points: number;
  streak: number;
  bestStreak: number;
  lastDay: string;
  /** सक्रिय दिनहरू (पछिल्ला ६०) — active days (last 60) */
  days: string[];
  words: Word[];
  concepts: string[];
  quizRight: number;
  quizTotal: number;
  challenges: Challenge[];
}

const KEY = 'studio.progress';
const EVENT = 'studio-progress';

const empty = (): Progress => ({
  points: 0,
  streak: 0,
  bestStreak: 0,
  lastDay: '',
  days: [],
  words: [],
  concepts: [],
  quizRight: 0,
  quizTotal: 0,
  challenges: [],
});

/** स्थानीय मितिअनुसार आजको दिन (YYYY-MM-DD) — today's local date. */
export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function loadProgress(): Progress {
  try {
    const raw = JSON.parse(
      localStorage.getItem(KEY) ?? 'null',
    ) as Partial<Progress> | null;
    return { ...empty(), ...raw };
  } catch {
    return empty();
  }
}

function save(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // भण्डारण नभए पनि app चल्छ — the app works even without storage
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

function update(fn: (p: Progress) => void): Progress {
  const p = loadProgress();
  fn(p);
  save(p);
  return p;
}

/** आज सिक्न आएको दर्ता: streak मिलाउने र दिनको पहिलो पटक +5 — record today's activity. */
export function markActive(): void {
  update((p) => {
    const t = today();
    if (p.lastDay === t) return;
    const y = new Date();
    y.setDate(y.getDate() - 1);
    p.streak = p.lastDay === today(y) ? p.streak + 1 : 1;
    p.bestStreak = Math.max(p.bestStreak, p.streak);
    p.lastDay = t;
    p.days = [...p.days.filter((d) => d !== t), t].slice(-60);
    p.points += 5;
  });
}

export function addPoints(n: number): void {
  update((p) => {
    p.points += n;
  });
}

export function recordQuiz(correct: boolean): void {
  update((p) => {
    p.quizTotal += 1;
    if (correct) p.quizRight += 1;
    p.points += correct ? 10 : 2;
  });
}

/** Guru को जवाफबाट नयाँ English शब्द र कोड कन्सेप्ट टिप्ने — collect new words and concepts from an answer. */
export function learnFrom(markdown: string): {
  words: number;
  concepts: number;
} {
  const words: Word[] = [];
  const concepts: string[] = [];
  const lines = markdown.replace(/\r/g, '').split('\n');
  let section: 'words' | 'concepts' | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (/नयाँ English शब्द|New English words/i.test(line)) {
      section = 'words';
      continue;
    }
    if (/शब्द-शब्द|Word by word/i.test(line)) {
      section = 'concepts';
      continue;
    }
    if (/^(#{1,6}\s|⚙|🔍|📚|🧠|🎯)/u.test(line) && !/^[-*|]/.test(line))
      section = null;
    if (!section || !line) continue;
    if (section === 'words') {
      if (!/^([-*+]|\d+[.)]|\|)/.test(line)) continue;
      // "- word — अर्थ — example" वा "| word | अर्थ |"
      const parts = line
        .replace(/^[-*+]\s*|^\d+[.)]\s*/, '')
        .split(/\s[—–-]\s|\|/)
        .map((s) => s.replace(/[*_`"]/g, '').trim())
        .filter(Boolean);
      if (
        parts.length >= 2 &&
        /^[A-Za-z][A-Za-z' -]{1,30}$/.test(parts[0]) &&
        !/^(word|words|english|शब्द)$/i.test(parts[0])
      )
        words.push({
          word: parts[0].toLowerCase(),
          meaning: parts[1],
          example: parts[2],
        });
    } else {
      // तालिकाको पहिलो cell वा सूचीमा backtick भित्रका keyword — backticked keywords
      for (const m of line.matchAll(/`([^`]{1,24})`/g)) {
        const c = m[1].trim();
        if (/^[A-Za-z_][\w.]*$/.test(c)) concepts.push(c);
      }
    }
  }
  let newWords = 0;
  let newConcepts = 0;
  update((p) => {
    for (const w of words)
      if (!p.words.some((x) => x.word === w.word)) {
        p.words.push(w);
        newWords++;
      }
    for (const c of concepts)
      if (!p.concepts.includes(c)) {
        p.concepts.push(c);
        newConcepts++;
      }
    p.words = p.words.slice(-500);
    p.concepts = p.concepts.slice(-500);
    p.points += newWords + newConcepts;
  });
  return { words: newWords, concepts: newConcepts };
}

export function todaysChallenge(): Challenge | null {
  return loadProgress().challenges.find((c) => c.day === today()) ?? null;
}

export function setTodaysChallenge(c: Omit<Challenge, 'day' | 'done'>): void {
  update((p) => {
    const t = today();
    p.challenges = [
      ...p.challenges.filter((x) => x.day !== t),
      { ...c, day: t, done: false },
    ].slice(-90);
  });
}

export function completeTodaysChallenge(title?: string): boolean {
  let first = false;
  update((p) => {
    const c = p.challenges.find(
      (x) => x.day === today() && (title === undefined || x.title === title),
    );
    if (c && !c.done) {
      c.done = true;
      p.points += 30;
      first = true;
    }
  });
  return first;
}

/** अंक अनुसार तह — a rank from points. */
export function rankOf(points: number): { name: string; next: number } {
  const ranks: [number, string][] = [
    [0, '🌱 सुरुवाती · Seedling'],
    [100, '🐣 सिक्दै · Learner'],
    [300, '🚀 कोडर · Coder'],
    [700, '⚡ डेभलपर · Developer'],
    [1500, '🏆 इन्जिनियर · Engineer'],
  ];
  let name = ranks[0][1];
  let next = ranks[1][0];
  for (let i = 0; i < ranks.length; i++)
    if (points >= ranks[i][0]) {
      name = ranks[i][1];
      next = ranks[i + 1]?.[0] ?? ranks[i][0];
    }
  return { name, next };
}

/** React मा प्रगति पढ्ने (बदलिँदा आफैं update) — read progress in React; updates live. */
export function useProgress(): Progress {
  const [p, setP] = useState(loadProgress);
  useEffect(() => {
    const on = () => setP(loadProgress());
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener('storage', on);
    };
  }, []);
  return p;
}
