// 💬 Editor को गल्तीको छोटो व्याख्या: पहिले सरल English, त्यसपछि नेपाली। AI बिना, तुरुन्तै।
// A short plain explanation of an editor error: simple English first, then Nepali. No AI, instant.

export interface ErrorHint {
  en: string;
  ne: string;
}

const RULES: [RegExp, (m: RegExpExecArray) => ErrorHint][] = [
  [
    /expected to find ';'|expected ';'|missing ';'|expected_token.*;/i,
    () => ({
      en: 'A semicolon ";" is missing. Add it at the end of this line.',
      ne: 'सेमिकोलन ";" छुटेको छ। यो लाइनको अन्त्यमा राख्नुहोस्।',
    }),
  ],
  [
    /target of uri doesn't exist|uri_does_not_exist|cannot find module|no module named|typo\?/i,
    () => ({
      en: 'This file or package cannot be found. Check the spelling, or get the packages.',
      ne: 'यो फाइल वा प्याकेज भेटिएन। हिज्जे जाँच्नुहोस्, वा प्याकेजहरू ल्याउनुहोस्।',
    }),
  ],
  [
    /undefined name '([^']+)'|cannot find name '([^']+)'|name '([^']+)' is not defined|'([^']+)' is not defined/i,
    (m) => {
      const name = m[1] || m[2] || m[3] || m[4];
      return {
        en: `The name "${name}" is not known. Check the spelling, or create it first.`,
        ne: `"${name}" नाम चिनिएन। हिज्जे जाँच्नुहोस्, वा पहिले यसलाई बनाउनुहोस्।`,
      };
    },
  ],
  [
    /undefined class|isn't a class|isn't a type|not a type/i,
    () => ({
      en: 'This class name is not known. Check capital letters and the import.',
      ne: 'यो class को नाम चिनिएन। ठूला अक्षर र import जाँच्नुहोस्।',
    }),
  ],
  [
    /expected '[)}\]]'|expected '[({[]'|unbalanced|unterminated|never closed|was never closed|unexpected eof|unexpected end/i,
    () => ({
      en: 'A bracket or quote is not closed. Find the matching one and close it.',
      ne: 'कुनै कोष्ठक वा कोटेसन बन्द भएको छैन। जोडी खोजेर बन्द गर्नुहोस्।',
    }),
  ],
  [
    /isn't defined for the|undefined_method|undefined_getter|is not a function|has no attribute|has no member|does not exist on type|property '[^']+' does not exist/i,
    () => ({
      en: 'This function or property does not exist here. Check its spelling.',
      ne: 'यहाँ यो function वा property छैन। हिज्जे जाँच्नुहोस्।',
    }),
  ],
  [
    /can't be assigned|not assignable|argument_type_not_assignable|invalid_assignment|incompatible types|type '[^']+' is not/i,
    () => ({
      en: 'The value has the wrong type for this place.',
      ne: 'यहाँ राख्न खोजेको मानको प्रकार मिलेन।',
    }),
  ],
  [
    /expected an identifier|expected ':'|invalid syntax|syntaxerror|unexpected token|unexpected character|expected_executable|missing_identifier/i,
    () => ({
      en: 'There is a typing mistake in the code structure here (syntax). Check this line.',
      ne: 'यहाँ कोडको बनावटमा टाइपिङ गल्ती छ (syntax)। यो लाइन जाँच्नुहोस्।',
    }),
  ],
  [
    /indentation/i,
    () => ({
      en: 'The spaces at the start of the line are wrong. Line up the code.',
      ne: 'लाइनको सुरुका खाली ठाउँ मिलेन। कोड मिलाएर राख्नुहोस्।',
    }),
  ],
];

/** गल्तीको सन्देशबाट छोटो द्विभाषी व्याख्या — a short bilingual hint for an error message. */
export function hintFor(message: string, line: number): ErrorHint {
  for (const [re, make] of RULES) {
    const m = re.exec(message);
    if (m) return make(m);
  }
  return {
    en: `There is a mistake on line ${line}. Click it to jump there.`,
    ne: `लाइन ${line} मा गल्ती छ। त्यहाँ जान क्लिक गर्नुहोस्।`,
  };
}
