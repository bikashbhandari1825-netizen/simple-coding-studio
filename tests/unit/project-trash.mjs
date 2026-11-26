// Unit test: which folders may be sent to the Recycle Bin.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { checkTrashableProject } = await import(
  pathToFileURL(path.resolve('src/main-process/projectTrash.ts')).href
);
let bad = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `got ${got} want ${want}`);
  if (!ok) bad++;
};
const prot = [
  'C:\\Users\\bikas',
  'C:\\Users\\bikas\\OneDrive\\Desktop',
  'C:\\Users\\bikas\\OneDrive\\Documents',
  'C:\\Users\\bikas\\Downloads',
  'C:\\Users\\bikas\\AppData\\Roaming',
  'C:\\Users\\bikas\\AppData\\Local\\SimpleCodingStudio\\app-1.0.0',
  'C:\\Windows',
];
const ok = (p) => checkTrashableProject(p, prot).error === null;
eq(
  'a normal project is allowed',
  ok('C:\\Users\\bikas\\OneDrive\\Desktop\\my_friend_app'),
  true,
);
eq(
  'a project right under the home folder is allowed',
  ok('C:\\Users\\bikas\\python_01'),
  true,
);
eq(
  'a folder name with spaces is allowed',
  ok('C:\\Users\\bikas\\OneDrive\\Desktop\\My Work\\app x'),
  true,
);
eq('the drive root is refused', ok('C:\\'), false);
eq('a first-level folder is refused', ok('C:\\Users'), false);
eq('the home folder is refused', ok('C:\\Users\\bikas'), false);
eq('Desktop is refused', ok('C:\\Users\\bikas\\OneDrive\\Desktop'), false);
eq(
  'OneDrive (parent of Desktop) is refused',
  ok('C:\\Users\\bikas\\OneDrive'),
  false,
);
eq('Downloads is refused', ok('C:\\Users\\bikas\\Downloads'), false);
eq(
  'the app install folder is refused',
  ok('C:\\Users\\bikas\\AppData\\Local\\SimpleCodingStudio'),
  false,
);
eq('Windows is refused', ok('C:\\Windows'), false);
eq('a relative path is refused', ok('my_app'), false);
eq('empty is refused', ok(''), false);
eq('a non-string is refused', ok(undefined), false);
process.exit(bad ? 1 : 0);
