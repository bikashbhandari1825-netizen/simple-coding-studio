// 🎙️ Hands-free आदेश: छोटो बोली ("रन इन क्रोम", "यो एरर फिक्स गर") लाई app को काममा बदल्ने।
// Hands-free voice commands: turn a short spoken phrase into an app action.
// लामो वाक्य (प्रश्न) आदेश होइन, Guru लाई पठाइन्छ — longer sentences are questions for Guru, not commands.

export type VoiceCommand =
  | 'runChrome'
  | 'run'
  | 'stop'
  | 'save'
  | 'fixError'
  | 'explain'
  | 'quiz'
  | 'back'
  | 'forward'
  | 'findFile'
  | 'openFolder';

const RULES: [VoiceCommand, RegExp][] = [
  [
    'runChrome',
    /(run|रन|चलाऊ|चलाउ|चलाउनु|खोल|ओपन|open).*(chrome|क्रोम)|(chrome|क्रोम).*(run|रन|चलाऊ|चलाउ|मा चलाऊ|मा खोल)/,
  ],
  [
    'fixError',
    /(fix|फिक्स|ठीक|ठिक|सच्याऊ|सच्याउ|सुधार).*(error|एरर|इरर|गल्ती|bug|बग)|(error|एरर|इरर|गल्ती|bug|बग).*(fix|फिक्स|ठीक|ठिक|सच्याऊ|सच्याउ|सुधार)|^(fix (this|it)|फिक्स गर)$/,
  ],
  [
    'stop',
    /^(stop|stop (it|the app|running)|रोक|रोक्नु|रोक्नुहोस्|स्टप( गर)?|बन्द गर)$/,
  ],
  [
    'run',
    /^(run|run (it|the app|the code|my code|program)|रन( गर)?|चलाऊ|चलाउ|एप चलाऊ|कोड चलाऊ|प्रोग्राम चलाऊ)$/,
  ],
  ['save', /^(save|save (it|file|the file)|सेभ( गर)?|सेव( गर)?|फाइल सेभ गर)$/],
  [
    'explain',
    /^(explain|explain (this|it|the code|this code)|बुझाऊ|बुझाउ|यो बुझाऊ|(यो )?कोड बुझाऊ|एक्सप्लेन( गर)?)$/,
  ],
  ['quiz', /(quiz|क्विज|मलाई जाँच|मेरो परीक्षा|test me)/],
  ['back', /^(go back|back|पछाडि( जाऊ| जाउ)?|ब्याक( जाऊ)?)$/],
  ['forward', /^(go forward|forward|अगाडि( जाऊ| जाउ)?|फरवार्ड)$/],
  ['findFile', /^(find file|open file|फाइल खोज|फाइल खोल)$/],
  // "फोल्डर खोल" लाई speech ले कहिलेकाहीँ "थोपार्ने ठाउँ खोल" सुन्छ — speech sometimes hears "folder" oddly
  [
    'openFolder',
    /^((open|ओपन) (a |the )?(folder|project|फोल्डर)|(फोल्डर|फोल्डरहरू|प्रोजेक्ट|project|folder|थोपार्ने ठाउँ)( नयाँ)? (खोल|खोल्नु|खोल्ने|ओपन)( गर)?)$/,
  ],
];

/** आदेश भए त्यो, नभए null — the command, or null when it is ordinary speech. */
export function parseVoiceCommand(raw: string): VoiceCommand | null {
  const text = raw
    .toLowerCase()
    .replace(/[।.,!?"'`]/g, ' ')
    .replace(/\b(please|प्लिज)\b|कृपया|गर्नुहोस्|गरिदेऊ|गरिदिनुहोस्/g, (m) =>
      /गर्नुहोस्|गरिदेऊ|गरिदिनुहोस्/.test(m) ? 'गर' : ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.split(' ').length > 6) return null;
  for (const [cmd, re] of RULES) if (re.test(text)) return cmd;
  return null;
}

export const COMMAND_LABELS: Record<VoiceCommand, string> = {
  runChrome: '▶ Chrome मा चलाउँदै · Running in Chrome',
  run: '▶ चलाउँदै · Running',
  stop: '⏹ रोकियो · Stopped',
  save: '💾 सेभ गर्दै · Saving',
  fixError: '🩺 गल्ती सच्याउँदै · Fixing the error',
  explain: '📖 बुझाउँदै · Explaining',
  quiz: '🧠 क्विज सुरु · Starting a quiz',
  back: '← पछाडि · Going back',
  forward: '→ अगाडि · Going forward',
  findFile: '🔍 फाइल खोज · Find file',
  openFolder: '📁 फोल्डर खोल्दै · Opening a folder',
};
