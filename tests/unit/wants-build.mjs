// Unit test: which messages count as "build me an app / write the code" requests.
// node tests/unit/wants-build.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { wantsBuild } = await import(
  pathToFileURL(path.resolve('src/shared/wantsBuild.ts')).href
);
let bad = 0;
const check = (text, want) => {
  const got = wantsBuild(text);
  console.log(got === want ? 'ok  ' : 'FAIL', want ? 'build ' : 'other ', text);
  if (got !== want) bad++;
};
check('Make a todo app in Flutter', true);
check('मलाई Flutter मा क्याल्कुलेटर एप बनाइदेऊ', true);
check('login screen को code लेखेर देऊ', true);
check('create a weather app with API', true);
check('मेरो कोड कसरी काम गर्छ?', false);
check('What is a widget?', false);
check('My code editor shows these errors in main.dart', false);
check('Please review my code for mistakes', false);
check('for loop भनेको के हो?', false);
process.exit(bad ? 1 : 0);
