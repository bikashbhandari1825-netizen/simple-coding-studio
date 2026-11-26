// project फोल्डर मेटाउन सुरक्षित छ कि जाँच्ने (शुद्ध function) — a pure safety check before a project folder goes to the Recycle Bin.
// यो फाइलमा electron छैन, ताकि यसको परीक्षण सजिलो होस् — no electron here, so it can be unit-tested on its own.
import path from 'node:path';

export interface TrashCheck {
  /** ठीक छ भने null, नत्र कारण — null when allowed, otherwise the reason (Nepali + English) */
  error: string | null;
}

/** a, b को माथिल्लो (वा उही) फोल्डर हो? — is `a` the same as, or a parent of, `b`? */
function isSameOrParent(a: string, b: string): boolean {
  const rel = path.relative(path.resolve(a), path.resolve(b));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * मेटाउन नहुने ठाउँ: ड्राइभ, घर फोल्डर, Desktop/Documents/Downloads आदि, वा तिनका माथिल्ला फोल्डर।
 * Never allowed: a drive root, the home folder, Desktop/Documents/Downloads, or any parent of them.
 * `protectedPaths` मा ती ठाउँ दिइन्छ — the caller passes those places in.
 */
export function checkTrashableProject(
  target: unknown,
  protectedPaths: string[],
): TrashCheck {
  if (typeof target !== 'string' || target.trim() === '')
    return { error: 'फोल्डरको बाटो छैन — No folder path was given.' };
  if (!path.isAbsolute(target))
    return { error: 'पूरा बाटो चाहिन्छ — A full path is required.' };
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root)
    return {
      error: 'पूरै ड्राइभ मेटाउन मिल्दैन — A whole drive cannot be deleted.',
    };
  // ड्राइभ पछि कम्तीमा २ तह (Users\नाम\फोल्डर नै ३ तह) — at least two levels below the drive
  const depth = resolved
    .slice(parsed.root.length)
    .split(/[\\/]+/)
    .filter(Boolean).length;
  if (depth < 2)
    return {
      error:
        'यो फोल्डर धेरै माथिल्लो तहको छ, मेटाउन मिल्दैन — This folder is too close to the drive root to delete.',
    };
  for (const p of protectedPaths) {
    if (!p) continue;
    if (isSameOrParent(resolved, p))
      return {
        error:
          'यो महत्त्वपूर्ण फोल्डर हो (घर, Desktop, Documents, एपको आफ्नै फोल्डर आदि), मेटाउन मिल्दैन — This is an important system or personal folder and cannot be deleted.',
      };
  }
  return { error: null };
}
