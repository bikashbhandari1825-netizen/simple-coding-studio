// Unit test: lessons are well formed, and the "pass to move on" rules work.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const L = await import(
  pathToFileURL(path.resolve('src/renderer/lib/lessons.ts')).href
);
let bad = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    ok ? 'ok  ' : 'FAIL',
    name,
    ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`,
  );
  if (!ok) bad++;
};

const {
  LESSONS,
  normalizeAnswer,
  isCorrect,
  hintFor,
  offerGuru,
  isUnlocked,
  parsePassed,
} = L;

// ---- every lesson is well formed
eq('there are at least 4 lessons', LESSONS.length >= 4, true);
const ids = LESSONS.map((l) => l.id);
eq('lesson ids are unique', new Set(ids).size, ids.length);
const hasText = (b) =>
  typeof b?.ne === 'string' &&
  b.ne.length > 0 &&
  typeof b?.en === 'string' &&
  b.en.length > 0;
for (const lesson of LESSONS) {
  eq(
    `${lesson.id}: title and map are bilingual`,
    [
      lesson.title,
      lesson.map.learn,
      lesson.map.steps,
      lesson.map.result,
      lesson.map.risk,
    ].every(hasText),
    true,
  );
  const asks = lesson.items.filter((i) => i.kind === 'ask');
  eq(`${lesson.id}: has at least 2 questions`, asks.length >= 2, true);
  eq(
    `${lesson.id}: has at least one brain puzzle`,
    asks.some((a) => a.label === 'puzzle'),
    true,
  );
  eq(
    `${lesson.id}: starts with a teaching step, not a question`,
    lesson.items[0].kind,
    'info',
  );
  for (const [n, ask] of asks.entries()) {
    const tag = `${lesson.id} q${n + 1}`;
    eq(
      `${tag}: prompt, hints and right are bilingual`,
      hasText(ask.prompt) &&
        hasText(ask.right) &&
        ask.hints.length === 3 &&
        ask.hints.every(hasText),
      true,
    );
    eq(
      `${tag}: a correct answer is accepted`,
      ask.answers.every((a) => isCorrect(ask, a)),
      true,
    );
    if (ask.options) {
      eq(
        `${tag}: the right answer is among the options`,
        ask.options.some((o) => isCorrect(ask, o)),
        true,
      );
      eq(
        `${tag}: exactly one option is right`,
        ask.options.filter((o) => isCorrect(ask, o)).length,
        1,
      );
    }
    eq(`${tag}: an empty answer is wrong`, isCorrect(ask, '   '), false);
  }
  for (const item of lesson.items) {
    if (item.kind === 'info')
      eq(
        `${lesson.id}: info step has bilingual title and text`,
        hasText(item.title) && hasText(item.text),
        true,
      );
  }
}

// ---- answer checking
const bits = LESSONS[0].items.find((i) => i.kind === 'ask');
eq('0110 is right for the first practice', isCorrect(bits, '0110'), true);
eq('spaces are ignored', isCorrect(bits, ' 0 1 1 0 '), true);
eq('Nepali digits are accepted', isCorrect(bits, '०११०'), true);
eq('0111 is wrong', isCorrect(bits, '0111'), false);
eq('110 is wrong (digits count)', isCorrect(bits, '110'), false);
eq('normalise: quotes and case', normalizeAnswer(" 'NEK' "), 'nek');

// ---- hints grow with wrong tries
eq('no hint before a wrong try', hintFor(bits, 0), null);
eq('1 wrong -> first hint', hintFor(bits, 1), bits.hints[0]);
eq('2 wrong -> second hint', hintFor(bits, 2), bits.hints[1]);
eq('3 wrong -> worked example', hintFor(bits, 3), bits.hints[2]);
eq(
  'many wrong -> still the worked example (never the answer)',
  hintFor(bits, 50),
  bits.hints[2],
);
eq(
  'Guru is offered only after many wrong tries',
  [offerGuru(9), offerGuru(10)],
  [false, true],
);

// ---- pass to move on
eq(
  'the first lesson is always open',
  isUnlocked(LESSONS, [], LESSONS[0].id),
  true,
);
eq(
  'the second is locked at the start',
  isUnlocked(LESSONS, [], LESSONS[1].id),
  false,
);
eq(
  'the second opens after the first is passed',
  isUnlocked(LESSONS, [LESSONS[0].id], LESSONS[1].id),
  true,
);
eq(
  'the third stays locked if only the first is passed',
  isUnlocked(LESSONS, [LESSONS[0].id], LESSONS[2].id),
  false,
);
eq('an unknown lesson is locked', isUnlocked(LESSONS, [], 'nope'), false);
eq('saved progress: good json', parsePassed('["bits-1"]'), ['bits-1']);
eq('saved progress: broken json is empty', parsePassed('{oops'), []);
eq('saved progress: wrong type is empty', parsePassed('"x"'), []);
eq('saved progress: nothing is empty', parsePassed(null), []);
process.exit(bad ? 1 : 0);
