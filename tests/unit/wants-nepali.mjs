// Unit test: Nepali only when the learner asks for it.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { wantsNepali } = await import(
  pathToFileURL(path.resolve('src/renderer/lib/wantsNepali.ts')).href
);
let bad = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `got ${got} want ${want}`);
  if (!ok) bad++;
};
eq('नेपालीमा एक्सप्लेन गर', wantsNepali('नेपालीमा एक्सप्लेन गर'), true);
eq('नेपालीमै बुझाऊ', wantsNepali('यो कोड नेपालीमै बुझाऊ'), true);
eq('नेपाली मा', wantsNepali('नेपाली मा भन'), true);
eq('explain in Nepali', wantsNepali('please explain this in Nepali'), true);
eq('Nepali please', wantsNepali('Nepali please'), true);
eq('plain English question', wantsNepali('What does print do?'), false);
eq(
  'Nepali question about code stays English',
  wantsNepali('यो कोडले के गर्छ?'),
  false,
);
eq('app request in Nepali stays English', wantsNepali('मलाई एप बनाइदेऊ'), false);
eq('the word Nepali in another meaning', wantsNepali('Nepali Quiz app'), false);
eq('नेपाली भाषा', wantsNepali('नेपाली भाषाको एप बनाऊ'), false);
process.exit(bad ? 1 : 0);
