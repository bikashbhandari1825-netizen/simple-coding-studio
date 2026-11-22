// 🧭 Error Guide: package / import / class को गल्ती आउँदा कारण र चरण-चरणका कदम (AI बिना, तुरुन्तै)।
// Error Guide: when a package, import or class error appears, work out the reason and the steps to fix it (no AI, instant).
// हरेक वाक्य: पहिले सरल English, त्यसपछि नेपाली — every sentence: simple English first, then Nepali.

export type GuideTarget =
  /** फाइल/फोल्डर ट्रीको पङ्क्ति — a row in the file tree */
  | { kind: 'tree'; path: string }
  /** पेजको बटन (title वा लेखाइबाट) — a button found by its title or text */
  | { kind: 'button'; match: string }
  /** खुला editor — the open editor */
  | { kind: 'editor' }
  /** खुला संवाद बाकसको लेख्ने ठाउँ — the input of the open dialog */
  | { kind: 'dialog-input' };

export interface GuideStep {
  id: string;
  en: string;
  ne: string;
  target: GuideTarget;
  /** यो कदम सकियो? — is this step finished? */
  done: boolean;
}

export interface Guide {
  /** एउटै गल्तीलाई चिन्न — identifies the same problem again */
  key: string;
  kind: 'package' | 'import' | 'class';
  /** गल्ती के हो — what is wrong */
  en: string;
  ne: string;
  /** कुन फाइलमा काम गर्ने (project सापेक्ष) — the file to work on, relative to the project */
  file: string;
  /** एक क्लिकमा बनाउने फाइल (project सापेक्ष) — a file the guide can create in one click (relative to the project) */
  createPath?: string;
  /** ＋📄 को बाकसमा लेख्ने नाम — the name to type in the New file box */
  typed?: string;
  steps: GuideStep[];
}

export interface GuideContext {
  rootPath: string;
  /** गल्ती भएको फाइल — the file that has the error */
  filePath: string;
  /** pubspec.yaml को name — the pubspec name (for package:name/... imports) */
  projectName?: string;
  /** अहिले खुला/छानिएको फाइल — the file open now */
  activePath: string | null;
  /** ट्रीमा छानिएको फोल्डर — the folder selected in the tree */
  selectedDir: string;
  /** नयाँ फाइलको बाकस खुला छ? — is the New file box open? */
  newFileOpen: boolean;
  /** फाइल भए सामग्री (खुला ट्याबबाट) — the text of an open file, if any */
  fileText: (absPath: string) => string | undefined;
  /** डिस्कमा फाइल छ? — does the file exist on disk? */
  exists: (absPath: string) => boolean;
  /** project मा भेटिएका class नाम — class names found in the project */
  knownClasses: string[];
}

export interface GuideError {
  message: string;
  line?: number;
}

export const norm = (p: string) => p.split('\\').join('/').replace(/\/+$/, '');
const same = (a: string, b: string) =>
  norm(a).toLowerCase() === norm(b).toLowerCase();
const rel = (root: string, p: string) => {
  const r = norm(root);
  const n = norm(p);
  return n.toLowerCase().startsWith(r.toLowerCase() + '/')
    ? n.slice(r.length + 1)
    : n;
};
const dirOf = (p: string) => norm(p).replace(/\/[^/]*$/, '');
const baseOf = (p: string) => norm(p).replace(/^.*\//, '');

/** ../ र ./ मिलाएर बाटो बनाउने — join and resolve ./ and ../ */
export function resolveRelative(fromDir: string, target: string): string {
  const out = norm(fromDir).split('/');
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

const URI_MISSING =
  /target of uri doesn't exist:?\s*'([^']+)'|uri_does_not_exist.*?'([^']+)'|could not resolve the package '([^']+)'/i;

const SDK_PACKAGES = new Set(['flutter', 'flutter_test', 'flutter_driver']);

/** गल्तीको सन्देशबाट के चाहिन्छ पत्ता लगाउने — what the message is about */
export function parseError(
  message: string,
):
  | { kind: 'package'; pkg: string }
  | { kind: 'import'; uri: string }
  | { kind: 'class'; name: string }
  | null {
  // टाइपोको सुझाव आफ्नै एक-क्लिक सुझावले सम्हाल्छ — typo hints have their own one-click fix
  if (/Did you mean|टाइपो/i.test(message)) return null;
  const m = URI_MISSING.exec(message);
  if (m) {
    const uri = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    const pk = /^package:([^/]+)\/(.*)$/.exec(uri);
    if (pk) return { kind: 'package', pkg: pk[1] };
    return uri ? { kind: 'import', uri } : null;
  }
  const c =
    /undefined class '([^']+)'|undefined name '([A-Z]\w*)'|'([A-Z]\w*)' isn't a (?:class|type)|cannot find name '([A-Z]\w*)'/i.exec(
      message,
    );
  if (c) {
    const name = c[1] ?? c[2] ?? c[3] ?? c[4];
    // Dart का class ठूलो अक्षरले सुरु हुन्छन्; सानो अक्षरको नाम (जस्तै dart) टाइपिङ गल्ती हो — class names start with a capital; a lowercase word is not a class
    return /^[A-Z]/.test(name) ? { kind: 'class', name } : null;
  }
  return null;
}

/** जाँच्नुपर्ने फाइल (अस्तित्व हेर्न) — the file whose existence the guide needs to know */
export function neededFile(
  error: GuideError,
  ctx: GuideContext,
): string | undefined {
  const p = parseError(error.message);
  if (!p) return undefined;
  if (p.kind === 'package') {
    if (SDK_PACKAGES.has(p.pkg)) return undefined;
    if (ctx.projectName && p.pkg === ctx.projectName) {
      const uri = /'package:[^/]+\/([^']+)'/.exec(error.message);
      return uri ? norm(ctx.rootPath) + '/lib/' + uri[1] : undefined;
    }
    return undefined;
  }
  if (p.kind === 'import') {
    if (p.uri.startsWith('dart:')) return undefined;
    return resolveRelative(dirOf(ctx.filePath), p.uri);
  }
  return undefined;
}

/** जाँच्नुपर्ने फाइल र फोल्डरहरू — the file and its folders whose existence the guide needs */
export function neededPaths(
  error: GuideError,
  ctx: GuideContext,
): { path: string; dir: boolean }[] {
  const file = neededFile(error, ctx);
  if (!file) return [];
  const root = norm(ctx.rootPath);
  const out = [{ path: file, dir: false }];
  for (let d = dirOf(file); d.length > root.length; d = dirOf(d))
    out.push({ path: d, dir: true });
  return out;
}

const snake = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/_{2,}/g, '_')
    .toLowerCase();

/** एउटा गल्तीबाट गाइड बनाउने — build a guide from one error */
export function buildGuide(error: GuideError, ctx: GuideContext): Guide | null {
  const p = parseError(error.message);
  if (!p) return null;
  const root = norm(ctx.rootPath);

  // ---- 📦 प्याकेज pubspec.yaml मा छैन — a package missing from pubspec.yaml
  if (p.kind === 'package' && !SDK_PACKAGES.has(p.pkg)) {
    const own = ctx.projectName && p.pkg === ctx.projectName;
    if (!own) {
      const pubspec = root + '/pubspec.yaml';
      const text = ctx.fileText(pubspec);
      const listed =
        text !== undefined &&
        new RegExp('^\\s{2,}' + p.pkg + '\\s*:', 'm').test(text);
      return {
        key: 'package:' + p.pkg,
        kind: 'package',
        en: 'The package "' + p.pkg + '" is not in pubspec.yaml yet.',
        ne: '"' + p.pkg + '" प्याकेज अझै pubspec.yaml मा छैन।',
        file: 'pubspec.yaml',
        steps: [
          {
            id: 'open-pubspec',
            en: 'Open pubspec.yaml.',
            ne: 'pubspec.yaml खोल्नुहोस्।',
            target: { kind: 'tree', path: pubspec },
            done: same(ctx.activePath ?? '', pubspec) || listed,
          },
          {
            id: 'add-package',
            en:
              'Under "dependencies:" add the line "  ' +
              p.pkg +
              ': any" (two spaces first).',
            ne:
              '"dependencies:" मुनि "  ' +
              p.pkg +
              ': any" लाइन थप्नुहोस् (सुरुमा दुई स्पेस)।',
            target: { kind: 'editor' },
            done: listed,
          },
          {
            id: 'get-packages',
            en: 'Press "Get packages" (the red error then goes away).',
            ne: '"प्याकेजहरू ल्याऊ · Get packages" थिच्नुहोस् (रातो गल्ती हट्छ)।',
            target: { kind: 'button', match: 'Get packages' },
            done: false,
          },
        ],
      };
    }
  }

  // ---- 📄 फाइल/import भेटिएन — a missing file behind an import
  if (p.kind === 'import' || p.kind === 'package') {
    const target = neededFile(error, ctx);
    if (!target) return null;
    const text = ctx.fileText(target);
    const exists = ctx.exists(target);
    // root बाट फाइलसम्मका फोल्डर, पहिलो नभएकोमा रोकिने — the folders from the root down to the file; stop at the first missing one
    const chain: string[] = [];
    for (let d = dirOf(target); d.length > root.length; d = dirOf(d))
      chain.unshift(d);
    const folderSteps: GuideStep[] = [];
    for (const d of chain) {
      if (!ctx.exists(d)) break;
      const label = rel(root, d);
      folderSteps.push({
        id: 'folder:' + label,
        en: 'Click the folder "' + baseOf(d) + '" in the file list.',
        ne: 'फाइल सूचीमा "' + baseOf(d) + '" फोल्डरमा क्लिक गर्नुहोस्।',
        target: { kind: 'tree', path: d },
        done:
          exists ||
          norm(ctx.selectedDir).toLowerCase().startsWith(norm(d).toLowerCase()),
      });
    }
    const typed = rel(root, target);
    const madeFolders = typed.includes('/')
      ? ' It also makes the missing folders.'
      : '';
    return {
      key: 'import:' + norm(target).toLowerCase(),
      kind: 'import',
      en: 'The file "' + rel(root, target) + '" does not exist yet.',
      ne: '"' + rel(root, target) + '" फाइल अझै बनेको छैन।',
      file: rel(root, target),
      createPath: exists ? undefined : rel(root, target),
      typed,
      steps: [
        ...folderSteps,
        {
          id: 'new-file',
          en: 'Press the ＋📄 button (New file).',
          ne: '＋📄 बटन (नयाँ फाइल) थिच्नुहोस्।',
          target: { kind: 'button', match: 'New file' },
          done: exists || ctx.newFileOpen,
        },
        {
          id: 'type-name',
          en: 'Type "' + typed + '" in the box and press Enter.' + madeFolders,
          ne:
            'बाकसमा "' +
            typed +
            '" लेखेर Enter थिच्नुहोस्।' +
            (madeFolders ? ' नभएका फोल्डर आफैं बन्छन्।' : ''),
          target: { kind: 'dialog-input' },
          done: exists,
        },
        {
          id: 'write-code',
          en: 'Open "' + baseOf(target) + '" and write its code.',
          ne: '"' + baseOf(target) + '" खोलेर यसको कोड लेख्नुहोस्।',
          target: { kind: 'tree', path: target },
          done: exists && text !== undefined && text.trim().length > 0,
        },
      ],
    };
  }

  // ---- 🔤 class चिनिएन — an unknown class name
  if (p.kind === 'class') {
    const lower = p.name.toLowerCase();
    const match = ctx.knownClasses.find(
      (c) => c !== p.name && c.toLowerCase() === lower,
    );
    const file = 'lib/' + snake(p.name) + '.dart';
    return {
      key: 'class:' + p.name,
      kind: 'class',
      en: match
        ? 'The class "' +
          p.name +
          '" is spelled with the wrong capital letters. It is "' +
          match +
          '".'
        : 'The class "' +
          p.name +
          '" is not known here. Create it, or import the file that has it.',
      ne: match
        ? '"' +
          p.name +
          '" class को ठूलो/सानो अक्षर मिलेन। सही नाम "' +
          match +
          '" हो।'
        : '"' +
          p.name +
          '" class यहाँ चिनिएन। यसलाई बनाउनुहोस्, वा यो भएको फाइल import गर्नुहोस्।',
      file: match ? rel(root, ctx.filePath) : file,
      steps: match
        ? [
            {
              id: 'fix-case',
              en:
                'On line ' +
                (error.line ?? '?') +
                ' change "' +
                p.name +
                '" to "' +
                match +
                '".',
              ne:
                'लाइन ' +
                (error.line ?? '?') +
                ' मा "' +
                p.name +
                '" लाई "' +
                match +
                '" बनाउनुहोस्।',
              target: { kind: 'editor' },
              done: false,
            },
          ]
        : [
            {
              id: 'create-class',
              en: 'Create "' + file + '" with the class "' + p.name + '".',
              ne: '"' + file + '" बनाएर त्यसमा "' + p.name + '" class लेख्नुहोस्।',
              target: { kind: 'button', match: 'New file' },
              done: ctx.exists(root + '/' + file),
            },
            {
              id: 'add-import',
              en:
                'Add "import \'' +
                baseOf(file) +
                '\';" at the top of this file.',
              ne: 'यो फाइलको माथि "import \'' + baseOf(file) + '\';" थप्नुहोस्।',
              target: { kind: 'editor' },
              done: false,
            },
          ],
    };
  }
  return null;
}

/** पहिलो पटक भेटिएको गाइड — the first guide among a list of errors */
export function firstGuide(
  errors: GuideError[],
  ctx: GuideContext,
): Guide | null {
  for (const e of errors) {
    const g = buildGuide(e, ctx);
    if (g) return g;
  }
  return null;
}

/** अहिले गर्नुपर्ने कदम (पहिलो नसकिएको) — the current step: the first one not done */
export function currentStepIndex(guide: Guide): number {
  const i = guide.steps.findIndex((s) => !s.done);
  return i < 0 ? guide.steps.length - 1 : i;
}
