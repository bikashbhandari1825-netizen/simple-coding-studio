// 🎓 सिक्ने पाठहरू र "पास भएपछि मात्र अगाडि" नियम (शुद्ध logic) — lessons and the "pass to move on" rules (pure logic).
// यो फाइलमा अरू फाइलको import छैन, ताकि यसको परीक्षण सजिलो होस् — no local imports, so it can be unit-tested on its own.

/** नेपाली र English दुवै — a Nepali text and its simple English twin */
export interface Bi {
  ne: string;
  en: string;
}

export interface InfoItem {
  kind: 'info';
  title: Bi;
  text: Bi;
  /** "किन?" थिच्दा देखिने एक तह तलको कारण — the one-level-deeper reason shown by the Why button */
  why?: Bi;
  table?: { head: Bi[]; rows: string[][] };
  code?: string;
}

export interface AskItem {
  kind: 'ask';
  /** अभ्यास वा दिमागी खेल — a practice question or a brain puzzle */
  label: 'practice' | 'puzzle';
  prompt: Bi;
  /** options भए छनौट, नभए आफैं लेख्ने — choices, or free typing when absent */
  options?: string[];
  /** स्वीकार्य सही उत्तर — accepted right answers */
  answers: string[];
  /** १ गलत → सङ्केत, २ गलत → अर्को तरिका, ३+ गलत → मिल्दोजुल्दो उदाहरण — hint, rephrase, worked example */
  hints: [Bi, Bi, Bi];
  right: Bi;
}

export type LessonItem = InfoItem | AskItem;

export interface Lesson {
  id: string;
  title: Bi;
  /** पाठको नक्सा — the lesson map shown before starting (no surprises) */
  map: { learn: Bi; steps: Bi; result: Bi; risk: Bi };
  items: LessonItem[];
}

const bi = (ne: string, en: string): Bi => ({ ne, en });

const RISK = bi(
  'गल्ती भयो भने केही बिग्रँदैन। सङ्केत आउँछ, अनि फेरि प्रयास गर्न मिल्छ। कुनै समय सीमा छैन।',
  'A wrong answer breaks nothing. You get a hint and can try again. There is no timer.',
);

export const LESSONS: Lesson[] = [
  {
    id: 'bits-1',
    title: bi('कम्प्युटरले कसरी सोच्छ', 'How a computer thinks'),
    map: {
      learn: bi(
        'कम्प्युटरले ० र १ मात्र बुझ्छ।',
        'A computer understands only 0 and 1.',
      ),
      steps: bi(
        '३ वटा सानो चरण, लगभग ५ मिनेट।',
        '3 small steps, about 5 minutes.',
      ),
      result: bi(
        'तपाईं बत्तीहरूलाई ० र १ मा लेख्न सक्नुहुन्छ।',
        'You can write lights as 0s and 1s.',
      ),
      risk: RISK,
    },
    items: [
      {
        kind: 'info',
        title: bi('बिजुली छ, वा छैन', 'Electricity is on, or off'),
        text: bi(
          'कम्प्युटरभित्र बिजुलीको सङ्केत मात्र चल्छ। बिजुली छ भने १। बिजुली छैन भने ०।',
          'Inside a computer, only electric signals move. Electricity on is 1. Electricity off is 0.',
        ),
        why: bi(
          'किन ० र १ मात्र? मेसिनले "छ" र "छैन" सजिलै र गल्ती नगरी चिन्न सक्छ। धेरै तह चिन्न गाह्रो हुन्छ।',
          'Why only 0 and 1? A machine can tell "on" from "off" easily and without mistakes. Many levels are harder to tell apart.',
        ),
      },
      {
        kind: 'info',
        title: bi('एउटा बत्ती = एउटा अङ्क', 'One light = one digit'),
        text: bi(
          'नियम: ON = १, OFF = ०। तल ३ वटा बत्ती छन्, त्यसैले ३ वटा अङ्क बन्छ।',
          'Rule: ON = 1, OFF = 0. Below there are 3 lights, so we write 3 digits.',
        ),
        table: {
          head: [bi('बत्ती', 'Light'), bi('अवस्था', 'State'), bi('अङ्क', 'Digit')],
          rows: [
            ['१', 'ON', '1'],
            ['२', 'OFF', '0'],
            ['३', 'ON', '1'],
          ],
        },
        why: bi(
          'नियम (ON = १) बत्ती होइन। बत्ती गन्दा तालिकाका पङ्क्ति मात्र गन्नुहोस्।',
          'The rule (ON = 1) is not a light. When you count lights, count only the table rows.',
        ),
      },
      {
        kind: 'ask',
        label: 'practice',
        prompt: bi(
          'अभ्यास: ४ बत्ती छन्: OFF, ON, ON, OFF। कसरी लेखिन्छ? (४ बत्ती = ४ अङ्क)',
          'Practice: 4 lights: OFF, ON, ON, OFF. How do we write them? (4 lights = 4 digits)',
        ),
        answers: ['0110'],
        hints: [
          bi(
            'सङ्केत: ON = १ र OFF = ०। पहिलो बत्तीदेखि एक-एक गरी हेर्नुहोस्।',
            'Hint: ON = 1 and OFF = 0. Look at the lights one by one, from the first.',
          ),
          bi(
            'OFF → ?, ON → ?, ON → ?, OFF → ? भनेर चार अङ्क लेख्नुहोस्।',
            'Write four digits: OFF → ?, ON → ?, ON → ?, OFF → ?.',
          ),
          bi(
            'उदाहरण (तपाईंको प्रश्न होइन): ON, OFF → १०। दुई बत्ती, दुई अङ्क।',
            'Example (not your question): ON, OFF → 10. Two lights, two digits.',
          ),
        ],
        right: bi('सही! ०११०।', 'Right! 0110.'),
      },
      {
        kind: 'ask',
        label: 'puzzle',
        prompt: bi(
          'क्विज: ४ बत्ती: ON, ON, OFF, ON। कुन अङ्क हो?',
          'Quiz: 4 lights: ON, ON, OFF, ON. Which digits are they?',
        ),
        options: ['1011', '1101', '1100', '0110'],
        answers: ['1101'],
        hints: [
          bi(
            'सङ्केत: ON = १, OFF = ०। क्रम नबदल्नुहोस्।',
            'Hint: ON = 1, OFF = 0. Keep the same order.',
          ),
          bi(
            'ON → १, ON → १, OFF → ०, ON → १। अब यी चार अङ्क जोड्नुहोस्।',
            'ON → 1, ON → 1, OFF → 0, ON → 1. Now put the four digits together.',
          ),
          bi(
            'उदाहरण (तपाईंको प्रश्न होइन): OFF, ON, ON → ०११।',
            'Example (not your question): OFF, ON, ON → 011.',
          ),
        ],
        right: bi('सही! १, १, ०, १ → ११०१।', 'Right! 1, 1, 0, 1 → 1101.'),
      },
      {
        kind: 'ask',
        label: 'puzzle',
        prompt: bi(
          'दिमागी खेल: ३, ६, ९, १२, ? — अर्को संख्या के?',
          'Brain puzzle: 3, 6, 9, 12, ? — what number comes next?',
        ),
        answers: ['15'],
        hints: [
          bi(
            'सङ्केत: एउटा संख्याबाट अर्कोमा कति थपिन्छ हेर्नुहोस्।',
            'Hint: look at how much is added from one number to the next.',
          ),
          bi(
            '३ → ६ मा ३ थपियो। ६ → ९ मा पनि ३। अब १२ मा कति थप्ने?',
            '3 → 6 adds 3. 6 → 9 also adds 3. Now how much do we add to 12?',
          ),
          bi(
            'उदाहरण (तपाईंको प्रश्न होइन): २, ४, ६, ८ → हरेक पटक २ थपिन्छ → अर्को १०।',
            'Example (not your question): 2, 4, 6, 8 → add 2 each time → next is 10.',
          ),
        ],
        right: bi('सही! १२ + ३ = १५।', 'Right! 12 + 3 = 15.'),
      },
    ],
  },
  {
    id: 'bits-2',
    title: bi('० र १ ले संख्या बनाउँछ', '0 and 1 make numbers'),
    map: {
      learn: bi(
        '३ वटा ० र १ को समूहले ० देखि ७ सम्मको संख्या कसरी बनाउँछ।',
        'How a group of three 0s and 1s makes a number from 0 to 7.',
      ),
      steps: bi(
        '३ वटा सानो चरण, लगभग ८ मिनेट।',
        '3 small steps, about 8 minutes.',
      ),
      result: bi(
        'तपाईं १०१ जस्तो समूहलाई संख्या (५) मा बदल्न सक्नुहुन्छ।',
        'You can turn a group like 101 into a number (5).',
      ),
      risk: RISK,
    },
    items: [
      {
        kind: 'info',
        title: bi('अङ्कको ठाउँको मूल्य', 'Each place has a value'),
        text: bi(
          'हामी २४७ लेख्दा हरेक अङ्कको ठाउँ हुन्छ: २ सय, ४ दश, ७ एक। ० र १ मा पनि ठाउँ हुन्छ, तर ठाउँको मूल्य ४, २, १ हुन्छ (दायाँबाट १, २, ४)।',
          'When we write 247, each digit has a place: 2 hundreds, 4 tens, 7 ones. In 0 and 1 the places have values too, but they are 4, 2, 1 (from the right: 1, 2, 4).',
        ),
        why: bi(
          'हरेक ठाउँ दायाँबाट बायाँ दोब्बर हुन्छ: १, २, ४, ८ ... यही नियम हो।',
          'Each place to the left is double the one before: 1, 2, 4, 8 ... That is the rule.',
        ),
      },
      {
        kind: 'info',
        title: bi('१०१ = ५', '101 = 5'),
        text: bi(
          'जहाँ १ छ त्यहाँको मूल्य जोड्नुहोस्। जहाँ ० छ त्यहाँको जोड्नु पर्दैन।',
          'Add the value of every place where there is a 1. Skip the places where there is a 0.',
        ),
        table: {
          head: [
            bi('ठाउँको मूल्य', 'Place value'),
            bi('अङ्क', 'Digit'),
            bi('जोड्ने', 'We add'),
          ],
          rows: [
            ['4', '1', '4'],
            ['2', '0', '0'],
            ['1', '1', '1'],
          ],
        },
        why: bi(
          '४ + ० + १ = ५। त्यसैले १०१ को अर्थ संख्या ५ हो।',
          '4 + 0 + 1 = 5. So 101 means the number 5.',
        ),
      },
      {
        kind: 'ask',
        label: 'practice',
        prompt: bi(
          'अभ्यास: ०११ कुन संख्या हो? (ठाउँको मूल्य: ४, २, १)',
          'Practice: which number is 011? (place values: 4, 2, 1)',
        ),
        answers: ['3'],
        hints: [
          bi(
            'सङ्केत: ० र १ लाई ४, २, १ को तल राख्नुहोस्: ४→०, २→१, १→१।',
            'Hint: put the digits under 4, 2, 1: 4→0, 2→1, 1→1.',
          ),
          bi(
            'जहाँ १ छ त्यही मात्र जोड्नुहोस्: २ र १। जोड कति?',
            'Add only the places with a 1: 2 and 1. What is the sum?',
          ),
          bi(
            'उदाहरण (तपाईंको प्रश्न होइन): ११० → ४ + २ = ६।',
            'Example (not your question): 110 → 4 + 2 = 6.',
          ),
        ],
        right: bi('सही! २ + १ = ३।', 'Right! 2 + 1 = 3.'),
      },
      {
        kind: 'ask',
        label: 'puzzle',
        prompt: bi('क्विज: ११० कुन संख्या हो?', 'Quiz: which number is 110?'),
        options: ['3', '5', '6', '7'],
        answers: ['6'],
        hints: [
          bi(
            'सङ्केत: ४, २, १ को तल ११० राख्नुहोस्।',
            'Hint: put 110 under 4, 2, 1.',
          ),
          bi(
            'पहिलो १ → ४, दोस्रो १ → २, अन्तिम ० → केही होइन। जोड कति?',
            'First 1 → 4, second 1 → 2, last 0 → nothing. What is the sum?',
          ),
          bi(
            'उदाहरण (तपाईंको प्रश्न होइन): १०१ → ४ + १ = ५।',
            'Example (not your question): 101 → 4 + 1 = 5.',
          ),
        ],
        right: bi('सही! ४ + २ = ६।', 'Right! 4 + 2 = 6.'),
      },
      {
        kind: 'ask',
        label: 'puzzle',
        prompt: bi(
          'क्विज: संख्या ७ लाई ३ बत्तीमा कसरी लेखिन्छ?',
          'Quiz: how do we write the number 7 with 3 lights?',
        ),
        answers: ['111'],
        hints: [
          bi('सङ्केत: ४ + २ + १ कति हुन्छ?', 'Hint: what is 4 + 2 + 1?'),
          bi(
            '७ पाउन ४, २ र १ तीनै चाहिन्छ। तीनै ठाउँमा के राख्ने?',
            'To get 7 we need 4, 2 and 1, all three. What do we put in all three places?',
          ),
          bi(
            'उदाहरण (तपाईंको प्रश्न होइन): ६ = ४ + २ → ११०।',
            'Example (not your question): 6 = 4 + 2 → 110.',
          ),
        ],
        right: bi('सही! १११ = ४ + २ + १ = ७।', 'Right! 111 = 4 + 2 + 1 = 7.'),
      },
      {
        kind: 'ask',
        label: 'puzzle',
        prompt: bi(
          'दिमागी खेल: १, ३, ६, १०, ? — अर्को संख्या के?',
          'Brain puzzle: 1, 3, 6, 10, ? — what number comes next?',
        ),
        answers: ['15'],
        hints: [
          bi(
            'सङ्केत: दुई संख्याबीचको फरक हेर्नुहोस्। फरकहरू आफैं पनि चल्दै छन्।',
            'Hint: look at the difference between two numbers. The differences move too.',
          ),
          bi(
            'फरकहरू: २, ३, ४। यी हरेक पटक १ ले बढ्दै छन्। अर्को फरक कति?',
            'The differences are 2, 3, 4. Each grows by 1. What is the next difference?',
          ),
          bi(
            'उदाहरण (तपाईंको प्रश्न होइन): १, २, ४, ७ → फरक १, २, ३ → अर्को फरक ४ → ११।',
            'Example (not your question): 1, 2, 4, 7 → differences 1, 2, 3 → next difference 4 → 11.',
          ),
        ],
        right: bi(
          'सही! फरक ५ भयो: १० + ५ = १५।',
          'Right! The next difference is 5: 10 + 5 = 15.',
        ),
      },
    ],
  },
  {
    id: 'bits-3',
    title: bi('अक्षर पनि संख्या हो', 'Letters are numbers too'),
    map: {
      learn: bi(
        'कम्प्युटरले अक्षर चिन्दैन। हरेक अक्षरलाई संख्या दिइएको हुन्छ।',
        'A computer does not know letters. Each letter is given a number.',
      ),
      steps: bi(
        '३ वटा सानो चरण, लगभग ६ मिनेट।',
        '3 small steps, about 6 minutes.',
      ),
      result: bi(
        'तपाईं अक्षरलाई संख्या, अनि ० र १ मा बदल्न सक्नुहुन्छ।',
        'You can turn a letter into a number, and then into 0s and 1s.',
      ),
      risk: RISK,
    },
    items: [
      {
        kind: 'info',
        title: bi('हरेक अक्षरको एउटा संख्या', 'Every letter has a number'),
        text: bi(
          'कम्प्युटरले "A" देख्दैन। उसले एउटा संख्या देख्छ। तल नमुना तालिका छ।',
          'The computer does not see "A". It sees a number. Below is a sample table.',
        ),
        table: {
          head: [bi('अक्षर', 'Letter'), bi('संख्या', 'Number')],
          rows: [
            ['A', '1'],
            ['B', '2'],
            ['C', '3'],
          ],
        },
        why: bi(
          'यो नमुना हो। असली कम्प्युटरमा A = ६५ हुन्छ, तर विचार उही हो: अक्षर → संख्या → ० र १।',
          'This is a sample. In real computers A = 65, but the idea is the same: letter → number → 0s and 1s.',
        ),
      },
      {
        kind: 'info',
        title: bi('अक्षर → संख्या → बत्ती', 'Letter → number → lights'),
        text: bi(
          'C = ३। ३ लाई ३ बत्तीमा लेख्दा ०११ हुन्छ (२ + १)। त्यसैले कम्प्युटरमा C ०११ जस्तो बन्छ।',
          'C = 3. Writing 3 with 3 lights gives 011 (2 + 1). So in the computer C becomes something like 011.',
        ),
        why: bi(
          'अघिल्लो पाठको नियम उही हो: ठाउँको मूल्य ४, २, १।',
          'It is the same rule as the last lesson: place values 4, 2, 1.',
        ),
      },
      {
        kind: 'ask',
        label: 'practice',
        prompt: bi(
          'अभ्यास: नमुना तालिकामा (A=१, B=२, C=३) B को संख्या कति हो?',
          'Practice: in the sample table (A=1, B=2, C=3), what is the number of B?',
        ),
        answers: ['2'],
        hints: [
          bi(
            'सङ्केत: तालिकाको B को पङ्क्ति हेर्नुहोस्।',
            'Hint: look at the row of B in the table.',
          ),
          bi(
            'B को अगाडि कुन संख्या लेखिएको छ?',
            'Which number is written next to B?',
          ),
          bi(
            'उदाहरण (तपाईंको प्रश्न होइन): A को संख्या १।',
            'Example (not your question): the number of A is 1.',
          ),
        ],
        right: bi('सही! B = २।', 'Right! B = 2.'),
      },
      {
        kind: 'ask',
        label: 'puzzle',
        prompt: bi(
          'क्विज: यही क्रम चल्दा (A=१, B=२, C=३) D को संख्या कति हुन्छ?',
          'Quiz: if the order goes on (A=1, B=2, C=3), what is the number of D?',
        ),
        options: ['3', '4', '5', '6'],
        answers: ['4'],
        hints: [
          bi(
            'सङ्केत: हरेक अक्षरमा संख्या कति थपिन्छ?',
            'Hint: how much does the number grow at each letter?',
          ),
          bi(
            'A, B, C = १, २, ३ → हरेक पटक १ थपिन्छ। C पछि D हो।',
            'A, B, C = 1, 2, 3 → each time 1 is added. D comes after C.',
          ),
          bi(
            'उदाहरण (तपाईंको प्रश्न होइन): १, २, ३ पछि ४ आउँछ।',
            'Example (not your question): after 1, 2, 3 comes 4.',
          ),
        ],
        right: bi('सही! D = ४।', 'Right! D = 4.'),
      },
      {
        kind: 'ask',
        label: 'puzzle',
        prompt: bi(
          'क्विज: संख्या २ लाई ३ बत्तीमा कसरी लेखिन्छ?',
          'Quiz: how do we write the number 2 with 3 lights?',
        ),
        answers: ['010'],
        hints: [
          bi(
            'सङ्केत: ठाउँको मूल्य ४, २, १ हो।',
            'Hint: the place values are 4, 2, 1.',
          ),
          bi(
            '२ पाउन कुन ठाउँमा १ राख्नुपर्छ? बाँकी ठाउँमा ०।',
            'Which place needs a 1 to make 2? The other places get 0.',
          ),
          bi(
            'उदाहरण (तपाईंको प्रश्न होइन): १ → ००१।',
            'Example (not your question): 1 → 001.',
          ),
        ],
        right: bi(
          'सही! ०१० (बीचको ठाउँ = २)।',
          'Right! 010 (the middle place = 2).',
        ),
      },
      {
        kind: 'ask',
        label: 'puzzle',
        prompt: bi(
          'दिमागी खेल: राम श्यामभन्दा अग्लो छ। श्याम हरिभन्दा अग्लो छ। सबैभन्दा होचो को हो?',
          'Brain puzzle: Ram is taller than Shyam. Shyam is taller than Hari. Who is the shortest?',
        ),
        options: ['Ram', 'Shyam', 'Hari'],
        answers: ['hari'],
        hints: [
          bi(
            'सङ्केत: तीन जनालाई अग्लोदेखि होचोसम्म लाइन लगाउनुहोस्।',
            'Hint: put the three in a line, from tallest to shortest.',
          ),
          bi(
            'राम > श्याम र श्याम > हरि। अन्तिममा को पर्छ?',
            'Ram > Shyam and Shyam > Hari. Who is last?',
          ),
          bi(
            'उदाहरण (तपाईंको प्रश्न होइन): क > ख, ख > ग भए सबैभन्दा होचो ग।',
            'Example (not your question): if K > L and L > M, the shortest is M.',
          ),
        ],
        right: bi('सही! हरि सबैभन्दा होचो।', 'Right! Hari is the shortest.'),
      },
    ],
  },
  {
    id: 'dart-1',
    title: bi('तपाईंको पहिलो Dart कोड', 'Your first Dart code'),
    map: {
      learn: bi(
        'Dart मा `print` ले पर्दामा लेख देखाउँछ, र `main` बाट प्रोग्राम सुरु हुन्छ।',
        'In Dart, `print` shows text on the screen, and the program starts at `main`.',
      ),
      steps: bi(
        '३ वटा सानो चरण, लगभग १० मिनेट।',
        '3 small steps, about 10 minutes.',
      ),
      result: bi(
        'तपाईं एउटा सानो Dart कोड पढ्न र बुझ्न सक्नुहुन्छ।',
        'You can read and understand a small piece of Dart code.',
      ),
      risk: RISK,
    },
    items: [
      {
        kind: 'info',
        title: bi('प्रोग्राम main बाट सुरु हुन्छ', 'A program starts at main'),
        text: bi(
          'कम्प्युटरलाई "कहाँबाट सुरु गर्ने" भन्नुपर्छ। Dart मा सुरु गर्ने ठाउँ `main` हो। `{ }` बीच आदेशहरू लेखिन्छ।',
          'The computer must be told where to start. In Dart the starting place is `main`. The instructions go between `{ }`.',
        ),
        code: "void main() {\n  print('Hello');\n}",
        why: bi(
          'किन `main`? घरमा मुख्य ढोका भएझैँ, प्रोग्राममा पनि एउटा मुख्य ढोका चाहिन्छ। कम्प्युटरले त्यहीँबाट छिर्छ।',
          'Why `main`? A house has one main door; a program needs one too. The computer enters from there.',
        ),
      },
      {
        kind: 'info',
        title: bi('print ले देखाउँछ', 'print shows text'),
        text: bi(
          "`print('Hello');` ले पर्दामा Hello देखाउँछ। उद्धरण ('...') बीचको लेख देखिन्छ। अन्त्यको `;` ले यो आदेश सकियो भन्छ।",
          "`print('Hello');` shows Hello on the screen. The text between quotes ('...') is what appears. The `;` at the end says this instruction is finished.",
        ),
        why: bi(
          'तपाईंले चाहे यो आफ्नै फाइलमा टाइप गरेर चलाउन सक्नुहुन्छ। यस पाठमा क्विज मात्र छ, चलाउनै पर्दैन।',
          'If you like, you can type this in your own file and run it. This lesson only has a quiz; running it is optional.',
        ),
      },
      {
        kind: 'ask',
        label: 'practice',
        prompt: bi(
          "अभ्यास: `print('Nek');` चलाउँदा पर्दामा के देखिन्छ?",
          "Practice: when we run `print('Nek');`, what appears on the screen?",
        ),
        answers: ['nek'],
        hints: [
          bi(
            'सङ्केत: उद्धरणको बीचको लेख हेर्नुहोस्।',
            'Hint: look at the text between the quotes.',
          ),
          bi(
            'उद्धरण आफैं देखिँदैन, भित्रको लेख मात्र देखिन्छ।',
            'The quotes do not appear, only the text inside.',
          ),
          bi(
            "उदाहरण (तपाईंको प्रश्न होइन): `print('Hi');` → Hi।",
            "Example (not your question): `print('Hi');` → Hi.",
          ),
        ],
        right: bi(
          'सही! पर्दामा Nek देखिन्छ।',
          'Right! Nek appears on the screen.',
        ),
      },
      {
        kind: 'ask',
        label: 'puzzle',
        prompt: bi(
          'क्विज: Dart प्रोग्राम कहाँबाट सुरु हुन्छ?',
          'Quiz: where does a Dart program start?',
        ),
        options: ['print', 'main', 'void', 'Hello'],
        answers: ['main'],
        hints: [
          bi(
            'सङ्केत: "मुख्य ढोका" को उदाहरण सम्झनुहोस्।',
            'Hint: remember the "main door" example.',
          ),
          bi(
            'कोडको पहिलो लाइनमा `void main() {` छ। ढोकाको नाम कुन हो?',
            'The first line is `void main() {`. Which word is the door?',
          ),
          bi(
            'उदाहरण (तपाईंको प्रश्न होइन): घरको मुख्य ढोकाबाट छिरिन्छ; प्रोग्रामको पनि एउटै सुरुवात हुन्छ।',
            'Example (not your question): you enter a house by its main door; a program also has one starting place.',
          ),
        ],
        right: bi(
          'सही! प्रोग्राम `main` बाट सुरु हुन्छ।',
          'Right! A program starts at `main`.',
        ),
      },
      {
        kind: 'ask',
        label: 'puzzle',
        prompt: bi(
          "क्विज: `print('Hi');` को अन्त्यको `;` ले के गर्छ?",
          "Quiz: what does the `;` at the end of `print('Hi');` do?",
        ),
        options: [
          'यो आदेश सकियो भन्छ · It says this instruction is finished',
          'पर्दामा ; देखाउँछ · It shows ; on the screen',
          'प्रोग्राम बन्द गर्छ · It closes the program',
        ],
        answers: ['यो आदेश सकियो भन्छ · it says this instruction is finished'],
        hints: [
          bi(
            'सङ्केत: वाक्यको अन्त्यमा पूर्णविराम (।) ले के गर्छ सोच्नुहोस्।',
            'Hint: think about what a full stop does at the end of a sentence.',
          ),
          bi(
            '`;` कोडको वाक्यको अन्त्यमा राखिन्छ। यसले एउटा आदेशको अन्त्य देखाउँछ।',
            'The `;` is put at the end of a code sentence. It marks the end of one instruction.',
          ),
          bi(
            'उदाहरण (तपाईंको प्रश्न होइन): नेपालीमा "म घर गएँ।" को "।" ले वाक्य सकियो भन्छ।',
            'Example (not your question): in "I went home." the "." says the sentence is finished.',
          ),
        ],
        right: bi(
          'सही! `;` ले आदेश सकियो भन्छ।',
          'Right! `;` says the instruction is finished.',
        ),
      },
      {
        kind: 'ask',
        label: 'puzzle',
        prompt: bi(
          'दिमागी खेल: २, ४, ८, १६, ? — अर्को संख्या के?',
          'Brain puzzle: 2, 4, 8, 16, ? — what number comes next?',
        ),
        answers: ['32'],
        hints: [
          bi(
            'सङ्केत: हरेक संख्यालाई अर्कोले कति गुणा गरेको छ हेर्नुहोस्।',
            'Hint: look at how many times bigger each number is than the one before.',
          ),
          bi(
            '२ → ४ (दोब्बर), ४ → ८ (दोब्बर), ८ → १६ (दोब्बर)। अब १६ को दोब्बर?',
            '2 → 4 (double), 4 → 8 (double), 8 → 16 (double). What is double of 16?',
          ),
          bi(
            'उदाहरण (तपाईंको प्रश्न होइन): १, २, ४, ८ → अर्को १६।',
            'Example (not your question): 1, 2, 4, 8 → next is 16.',
          ),
        ],
        right: bi('सही! १६ को दोब्बर ३२।', 'Right! Double of 16 is 32.'),
      },
    ],
  },
];

// ---------------------------------------------------------------- logic

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

/** उत्तर तुलना गर्न सफा बनाउने (नेपाली अङ्क, खाली ठाउँ, ठूलो-सानो अक्षर) — normalise an answer for comparing */
export function normalizeAnswer(input: string): string {
  let out = '';
  for (const ch of input.trim().toLowerCase()) {
    const d = DEVANAGARI_DIGITS.indexOf(ch);
    out += d >= 0 ? String(d) : ch;
  }
  return out
    .replace(/\s+/g, ' ')
    .replace(/[`'".]/g, '')
    .replace(/\s/g, '');
}

export function isCorrect(ask: AskItem, input: string): boolean {
  const given = normalizeAnswer(input);
  if (given === '') return false;
  return ask.answers.some((a) => normalizeAnswer(a) === given);
}

/** गलत प्रयासको गन्ती अनुसार सहयोग — the help for the number of wrong tries so far (1 = hint, 2 = rephrase, 3+ = worked example) */
export function hintFor(ask: AskItem, wrongTries: number): Bi | null {
  if (wrongTries <= 0) return null;
  return ask.hints[Math.min(wrongTries, 3) - 1];
}

/** धेरै पटक अड्किएमा Guru सँग कुरा गर्ने विकल्प देखाउने — offer "talk to Guru" after many wrong tries (it never unlocks anything) */
export function offerGuru(wrongTries: number): boolean {
  return wrongTries >= 10;
}

/** कुन पाठ खुला छ: पहिलो सधैँ, बाँकी अघिल्लो पास भएपछि — a lesson is open when it is first, or the one before it was passed */
export function isUnlocked(
  lessons: Lesson[],
  passed: string[],
  id: string,
): boolean {
  const i = lessons.findIndex((l) => l.id === id);
  if (i < 0) return false;
  return i === 0 || passed.includes(lessons[i - 1].id);
}

export function parsePassed(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
