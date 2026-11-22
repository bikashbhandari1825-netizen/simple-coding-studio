// 🇳🇵 Guru ले नेपालीमा तब मात्र बोल्छ जब प्रयोगकर्ताले नै नेपाली माग्छ।
// Guru uses Nepali only when the learner asks for it (the default is English).

/** यो सन्देशले नेपाली माग्छ? — does this message ask for Nepali? */
export function wantsNepali(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // नेपालीमा / नेपालीमै / नेपाली मा — "in Nepali"
  if (/नेपाली\s*(मा|मै)(?![ऀ-ॿ])/u.test(t)) return true;
  // "explain in Nepali", "in Nepali", "Nepali please", "answer in nepali"
  if (/\b(in|into)\s+nepali\b/i.test(t)) return true;
  if (/\bnepali\b.{0,20}\b(explain|answer|please|bujha|meaning)\b/i.test(t))
    return true;
  if (/\b(explain|answer|tell|say)\b.{0,25}\bnepali\b/i.test(t)) return true;
  return false;
}
