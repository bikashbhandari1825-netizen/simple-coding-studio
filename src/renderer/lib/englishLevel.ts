// 📈 Progressive English: Guru सुरुमा एकदमै सजिलो English बोल्छ, अनि तपाईंको प्रगति हेरेर बिस्तारै लेभल बढाउँछ।
// Progressive English: Guru starts with very basic English and slowly raises the level as the learner progresses.

export type EnglishLevel = 1 | 2 | 3 | 4;

export const LEVEL_NAMES: Record<EnglishLevel, string> = {
  1: 'सुरुवात · Basic',
  2: 'सजिलो · Easy',
  3: 'सामान्य · Normal',
  4: 'प्राविधिक · Technical',
};

interface State {
  auto: boolean;
  level: EnglishLevel;
  /** प्रगतिको अंक: बुझेको संकेतले बढ्छ, नबुझेको संकेतले घट्छ — progress points */
  points: number;
}

const KEY = 'studio.englishLevel';
/** यति अंक पुगेपछि लेभल माथि — points needed to move up a level */
export const LEVEL_UP_POINTS = 10;
const LEVEL_DOWN_POINTS = -4;

export function loadLevel(): State {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '') as Partial<State>;
    const level = [1, 2, 3, 4].includes(Number(s.level))
      ? (Number(s.level) as EnglishLevel)
      : 1;
    return {
      auto: s.auto !== false,
      level,
      points: typeof s.points === 'number' ? s.points : 0,
    };
  } catch {
    return { auto: true, level: 1, points: 0 };
  }
}

export function saveLevel(s: State): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

// नबुझेको संकेत — signs that the learner did not understand
const CONFUSED =
  /बुझिन|बुझेन|बुझिएन|बुझ्दिन|बुझ्न सकिन|अर्थ के|के भन्न खोज|फेरि भन|सजिलो गरी|सजिलोसँग|अप्ठ्यारो|गाह्रो|didn'?t (get|understand)|don'?t (get|understand)|not understand|confus|what (does|is) .{1,30} mean|meaning of|too hard|simpler|explain again|easier/i;
// बुझेको / सन्तुष्ट संकेत — signs of understanding
const UNDERSTOOD =
  /बुझें|बुझेँ|बुझिसकें|थाहा भयो|ठिक छ|ठीक छ|धन्यवाद|got it|understood|i understand|makes sense|clear now|thanks|thank you|next/i;

/**
 * प्रश्न पठाउँदा लेभल मिलाउने। फर्काउँछ: नयाँ state र लेभल फेरियो भने सन्देश।
 * Update the level from the learner's new message. Returns the new state and a note when the level changed.
 */
export function adaptLevel(
  s: State,
  message: string,
): { state: State; change?: 'up' | 'down' } {
  if (!s.auto) return { state: s };
  let points = s.points;
  const words = message.match(/[A-Za-z]{2,}/g)?.length ?? 0;
  const nepali = message.match(/[ऀ-ॿ]/g)?.length ?? 0;
  if (CONFUSED.test(message)) points -= 4;
  else {
    points += 1; // हरेक प्रश्न नै सिकाइ हो — every question is progress
    if (UNDERSTOOD.test(message)) points += 2;
    // आफैं English मा लेख्नु ठूलो प्रगति हो — writing in English yourself is big progress
    if (words >= 5 && words * 3 > nepali) points += 2;
  }
  let level = s.level;
  let change: 'up' | 'down' | undefined;
  if (points >= LEVEL_UP_POINTS && level < 4) {
    level = (level + 1) as EnglishLevel;
    points = 0;
    change = 'up';
  } else if (points <= LEVEL_DOWN_POINTS && level > 1) {
    level = (level - 1) as EnglishLevel;
    points = 0;
    change = 'down';
  } else {
    points = Math.max(LEVEL_DOWN_POINTS, Math.min(points, LEVEL_UP_POINTS));
  }
  return { state: { ...s, level, points }, change };
}
