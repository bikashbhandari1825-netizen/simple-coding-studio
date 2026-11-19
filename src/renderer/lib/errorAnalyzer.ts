// Smart Error Analyzer: terminal output पढेर Python / Dart / Flutter / Node का error तुरुन्तै चिन्ने।
// AI नबोलाई, आफ्नै नियमबाट (०.१ सेकेन्डभित्र) "कुन फाइल, कुन लाइन, के गडबड, कसरी सच्याउने" निकाल्छ।
//
// Reads run output and recognises common Python / Dart / Flutter / Node errors instantly with local rules
// (no AI call): which file, which line, what went wrong and how to fix it.

export interface FixTip {
  id: string;
  /** Error को किसिम, जस्तै ModuleNotFoundError — The error type, e.g. ModuleNotFoundError. */
  kind: string;
  /** मूल error सन्देश — The original error message. */
  message: string;
  /** "नेपाली · English" ढाँचाको सुझाव — Bilingual fix tip. */
  tip: string;
  file?: string;
  line?: number;
  column?: number;
  /** उही कारणका कति error यसमा मिसिए — how many errors of the same cause were grouped here */
  count?: number;
  /** 🔧 एकै क्लिकमा ठीक गर्ने काम — a one-click fix */
  fix?: QuickRunFix;
}

/** एकै क्लिकको fix (main process ले सुरक्षित कमाण्ड बनाउँछ) — a one-click fix; main builds the safe command. */
export interface QuickRunFix {
  action: 'pubGet' | 'pubAdd' | 'pubUpgrade';
  pkg?: string;
  label: string;
}

/** Python package नाम import नाम भन्दा फरक हुने अवस्था — Import names whose pip package name differs. */
const PIP_NAMES: Record<string, string> = {
  cv2: 'opencv-python',
  PIL: 'pillow',
  sklearn: 'scikit-learn',
  yaml: 'pyyaml',
  bs4: 'beautifulsoup4',
  dotenv: 'python-dotenv',
  docx: 'python-docx',
  serial: 'pyserial',
  Crypto: 'pycryptodome',
};

function pythonTip(kind: string, message: string): string {
  switch (kind) {
    case 'ModuleNotFoundError':
    case 'ImportError': {
      const mod = message.match(/No module named '([^'.]+)/)?.[1];
      if (mod) {
        const pkg = PIP_NAMES[mod] ?? mod;
        return `"${mod}" module यो computer मा install छैन। Terminal मा \`pip install ${pkg}\` चलाउनुहोस्, र requirements.txt मा "${pkg}" थप्नुहोस्। — The "${mod}" module is not installed. Run \`pip install ${pkg}\` and add "${pkg}" to requirements.txt.`;
      }
      const name = message.match(/cannot import name '([^']+)'/)?.[1];
      if (name) {
        return `"${name}" त्यो module मा भेटिएन। नामको हिज्जे र version जाँच्नुहोस्। — "${name}" does not exist in that module; check the spelling and the package version.`;
      }
      return 'Import मिलेन। Module को नाम र install भएको छ कि छैन जाँच्नुहोस्। — The import failed; check the module name and that it is installed.';
    }
    case 'NameError': {
      const name =
        message.match(/name '([^']+)' is not defined/)?.[1] ?? 'यो नाम';
      return `"${name}" परिभाषित (define) गरिएको छैन। हिज्जे मिलाउनुहोस्, वा प्रयोग गर्नुअघि variable/function बनाउनुहोस्, वा import गर्न बिर्सनुभयो कि हेर्नुहोस्। — "${name}" is not defined: fix the spelling, define it before use, or add the missing import.`;
    }
    case 'IndentationError':
    case 'TabError':
      return 'Indentation (लाइनको सुरुको खाली ठाउँ) मिलेन। एउटै block का लाइनहरू बराबर (४ space) भित्र हुनुपर्छ, Tab र space नमिसाउनुहोस्। — The indentation is wrong: lines in one block need the same indent (4 spaces); do not mix tabs and spaces.';
    case 'SyntaxError':
      if (/expected ':'/i.test(message)) {
        return 'if / for / def / class को लाइनको अन्त्यमा ":" छुट्यो। — A ":" is missing at the end of an if / for / def / class line.';
      }
      if (/unterminated string|EOL while scanning/i.test(message)) {
        return 'String को quote (\' वा ") बन्द गरिएको छैन। — A string quote is not closed.';
      }
      if (
        /was never closed|unexpected EOF|'\(' was never closed/i.test(message)
      ) {
        return 'कुनै ( [ { बन्द गरिएको छैन। माथिका लाइनहरूमा ब्र्याकेट जोडा मिलाउनुहोस्। — A bracket ( [ { was opened but never closed.';
      }
      return 'Python को लेखाइ (syntax) मिलेन। देखाइएको लाइन र त्यसको माथिल्लो लाइनमा ब्र्याकेट, colon, quote जाँच्नुहोस्। — Python syntax error: check brackets, colons and quotes on this line and the one above.';
    case 'TypeError':
      return 'गलत किसिमको मान (type) प्रयोग भयो, जस्तै text र number जोड्ने। चाहिएमा str() वा int() ले बदल्नुहोस्। — A value of the wrong type was used (e.g. adding text and a number); convert with str() or int().';
    case 'AttributeError':
      return 'त्यो object मा यो attribute/method छैन। हिज्जे र object को किसिम जाँच्नुहोस्; None त भएन? — That object has no such attribute or method; check the spelling and whether the value is None.';
    case 'KeyError':
      return 'Dictionary मा त्यो key छैन। .get() प्रयोग गर्नुहोस् वा key छ कि छैन पहिले जाँच्नुहोस्। — That key is not in the dictionary; use .get() or check for the key first.';
    case 'IndexError':
      return 'List को सीमाभन्दा बाहिरको index प्रयोग भयो। len() ले लम्बाइ जाँच्नुहोस्। — The index is outside the list; check its length with len().';
    case 'ZeroDivisionError':
      return 'शून्य (0) ले भाग गर्न मिल्दैन। भाग गर्नुअघि भाजक 0 छ कि छैन जाँच्नुहोस्। — Division by zero; check the divisor first.';
    case 'FileNotFoundError':
      return 'फाइल भेटिएन। फाइलको नाम र path जाँच्नुहोस्; program कुन फोल्डरबाट चल्छ ख्याल गर्नुहोस्। — The file was not found; check its name, path and the working folder.';
    case 'ValueError':
      return 'मान (value) मिलेन, जस्तै int("abc")। Input जाँचेर मात्र बदल्नुहोस्। — An invalid value was given (e.g. int("abc")); validate the input first.';
    default:
      return 'यो error को कारण बुझ्न "Guru लाई विस्तारमा सोध" थिच्नुहोस्। — Press "Ask Guru for details" to understand this error.';
  }
}

function dartTip(message: string): string {
  if (/Expected ';' after this/i.test(message)) {
    return 'यो लाइनको अन्त्यमा ";" (semicolon) छुट्यो। — A ";" is missing at the end of this line.';
  }
  if (
    /Can't find '[)\]}]' to match/i.test(message) ||
    /Expected '[)\]}]'/i.test(message)
  ) {
    return 'ब्र्याकेट जोडा मिलेन। हरेक ( [ { को बन्द गर्ने ) ] } चाहिन्छ। — Brackets do not match: every ( [ { needs its closing ) ] }.';
  }
  const undefinedName = message.match(
    /Undefined name '([^']+)'|The getter '([^']+)' isn't defined|The method '([^']+)' isn't defined/,
  );
  if (undefinedName) {
    const name = undefinedName[1] ?? undefinedName[2] ?? undefinedName[3];
    return `"${name}" भेटिएन। हिज्जे (ठूलो/सानो अक्षर सहित) मिलाउनुहोस्, वा import थप्नुहोस्। — "${name}" was not found: check the spelling (case matters) or add the import.`;
  }
  const pkg =
    message.match(/package:([a-z0-9_]+)\//)?.[1] ??
    message.match(/Couldn't resolve the package '([^']+)'/)?.[1];
  if (
    pkg ||
    /Target of URI doesn't exist|Couldn't resolve the package/i.test(message)
  ) {
    const name = pkg ?? 'package';
    return `"${name}" package भेटिएन। pubspec.yaml को dependencies मा "${name}" थपेर "प्याकेजहरू ल्याऊ · Get packages" थिच्नुहोस्। — The "${name}" package is missing: add it under dependencies in pubspec.yaml, then press "Get packages".`;
  }
  if (
    /can't be assigned to (a variable|the parameter) of type/i.test(message)
  ) {
    return 'मानको किसिम (type) मिलेन, जस्तै String को ठाउँमा int। सही type दिनुहोस् वा .toString() / int.parse() ले बदल्नुहोस्। — The value has the wrong type; pass the right type or convert with .toString() / int.parse().';
  }
  const required = message.match(
    /Required named parameter '([^']+)' must be provided/,
  )?.[1];
  if (required) {
    return `"${required}:" भन्ने parameter अनिवार्य छ, त्यो दिन छुट्यो। — The required "${required}:" parameter is missing.`;
  }
  if (
    /Too many positional arguments|Too few positional arguments/i.test(message)
  ) {
    return 'Function लाई दिइएका arguments को संख्या मिलेन। Function को परिभाषा हेर्नुहोस्। — The number of arguments does not match the function definition.';
  }
  if (/isn't a type|not a type/i.test(message)) {
    return 'त्यो नाम type होइन वा import गरिएको छैन। हिज्जे र import जाँच्नुहोस्। — That name is not a type or is not imported.';
  }
  if (/const/i.test(message) && /constant/i.test(message)) {
    return '"const" सँग बदलिने मान प्रयोग गर्न मिल्दैन। "const" हटाउनुहोस्। — A non-constant value is used where "const" is required; remove "const".';
  }
  return 'Dart ले यो लाइनमा गल्ती देख्यो। सन्देश ध्यानले पढ्नुहोस्, वा "Guru लाई विस्तारमा सोध" थिच्नुहोस्। — Dart found a problem on this line; read the message or ask Guru for details.';
}

const missingPkg = (message: string) =>
  message.match(/package:([a-z0-9_]+)\//)?.[1] ??
  message.match(/Couldn't resolve the package '([a-z0-9_]+)'/)?.[1];

/**
 * Terminal output बाट error हरू चिन्ने, एउटै कारणका धेरै error (जस्तै ४४ वटा) लाई एउटै card मा समेट्ने,
 * र सकिने ठाउँमा एकै क्लिकको fix जोड्ने।
 * Find errors in run output, fold many errors with one cause (e.g. 44 of them) into one card, and attach
 * a one-click fix where possible.
 */
export function analyzeOutput(output: string): FixTip[] {
  const raw = analyzeRaw(output);
  const out: FixTip[] = [];
  const byPkg = new Map<string, FixTip>();
  // कुन फाइलमा कुन package छुटेको — which files import a missing package
  const pkgByFile = new Map<string, FixTip>();
  const isMissing = (m: string) =>
    /Target of URI doesn't exist|Couldn't resolve the package|Not found: 'package:|Error when reading 'package:|doesn't exist/i.test(
      m,
    );
  // package नहुँदा त्यसैका कारण आउने अरू error (Method not found, Undefined name…) — follow-on errors
  const isFollowOn = (m: string) =>
    /Method not found|Getter not found|Setter not found|Undefined name|isn't defined|isn't a type|Type '[^']+' not found|Couldn't find constructor|The (method|getter|function) '[^']+' isn't defined/i.test(
      m,
    );
  for (const t of raw) {
    const pkg = isMissing(t.message) ? missingPkg(t.message) : undefined;
    if (pkg) {
      const g = byPkg.get(pkg);
      if (g) {
        g.count = (g.count ?? 1) + 1;
        continue;
      }
      const tip: FixTip = {
        ...t,
        count: 1,
        fix: {
          action: 'pubAdd',
          pkg,
          label: `📦 "${pkg}" थपेर प्याकेज ल्याऊ · Add "${pkg}" and get packages`,
        },
      };
      byPkg.set(pkg, tip);
      if (t.file) pkgByFile.set(t.file, tip);
      out.push(tip);
      continue;
    }
    // यो फाइलमा package छुटेको छ भने यो error त्यसैको परिणाम हो — a consequence of that missing package
    const owner = t.file ? pkgByFile.get(t.file) : undefined;
    if (owner && isFollowOn(t.message)) {
      owner.count = (owner.count ?? 1) + 1;
      continue;
    }
    if (
      t.kind === 'pub get' &&
      /doesn't match any versions|version solving failed/i.test(
        t.message + output,
      )
    )
      t.fix = {
        action: 'pubUpgrade',
        label:
          '🔧 प्याकेज version मिलाऊ · Fix package versions (pub upgrade --major-versions)',
      };
    out.push(t);
  }
  // प्याकेज नतानिएको सामान्य अवस्था — packages simply not fetched yet
  if (
    !out.some((t) => t.fix) &&
    /Run "?(flutter|dart) pub get"?|package_config\.json|pub get has not been run|Could not find a file named "pubspec\.lock"/i.test(
      output,
    )
  ) {
    out.unshift({
      id: 'pub-get-needed',
      kind: 'pub get',
      message: 'Packages are not fetched yet',
      tip: 'Project का प्याकेजहरू अझै तानिएका छैनन्। तलको बटन थिच्नुहोस्। — The project packages have not been fetched yet; press the button below.',
      fix: {
        action: 'pubGet',
        label: '📦 प्याकेजहरू ल्याऊ · Get packages (pub get)',
      },
    });
  }
  // धेरै error लाई कारणअनुसार गन्ने: सबैभन्दा धेरै भएको पहिले — causes with the most errors first
  // सबै error गनेर मात्र card छान्ने (बढीमा ६) — count every error first, then show at most 6 cards
  return out
    .sort(
      (a, b) =>
        (b.fix ? 1 : 0) - (a.fix ? 1 : 0) || (b.count ?? 1) - (a.count ?? 1),
    )
    .slice(0, 6);
}

function analyzeRaw(output: string): FixTip[] {
  const tips: FixTip[] = [];
  const seen = new Set<string>();
  const add = (tip: Omit<FixTip, 'id'>) => {
    const id = `${tip.kind}|${tip.file ?? ''}|${tip.line ?? ''}|${tip.message}`;
    if (seen.has(id)) return;
    seen.add(id);
    tips.push({ id, ...tip });
  };
  const lines = output.split(/\r?\n/);

  // ---- Python traceback ----
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(
      /^(\w+(?:Error|Exception|Warning)|KeyboardInterrupt): ?(.*)$/,
    );
    if (!m || /^\s/.test(lines[i])) continue;
    // माथि गएर अन्तिम 'File "...", line N' खोज्ने — walk up to the nearest traceback frame.
    let file: string | undefined;
    let line: number | undefined;
    for (let j = i - 1; j >= Math.max(0, i - 60); j--) {
      const f = lines[j].match(/^\s*File "([^"]+)", line (\d+)/);
      if (f) {
        if (
          !/[\\/](site-packages|lib[\\/]python\d|Lib)[\\/]/.test(f[1]) ||
          !file
        ) {
          file = f[1];
          line = Number(f[2]);
        }
        if (!/[\\/](site-packages|lib[\\/]python\d|Lib)[\\/]/.test(f[1])) break;
      }
      if (lines[j].startsWith('Traceback (most recent call last)')) break;
    }
    if (
      !file &&
      m[1] !== 'SyntaxError' &&
      m[1] !== 'IndentationError' &&
      m[1] !== 'TabError'
    ) {
      if (
        !lines
          .slice(Math.max(0, i - 60), i)
          .some((l) => l.startsWith('Traceback'))
      )
        continue;
    }
    add({
      kind: m[1],
      message: m[2] || m[1],
      tip: pythonTip(m[1], m[2]),
      file,
      line,
    });
  }

  // ---- Dart / Flutter compiler: lib/main.dart:12:5: Error: Expected ';' after this. ----
  for (const l of lines) {
    const m = l.match(
      /^\s*([^\s:][^:]*\.dart):(\d+):(\d+): (Error|Warning|Context): (.+)$/,
    );
    if (m && m[4] !== 'Context') {
      add({
        kind: `Dart ${m[4]}`,
        message: m[5],
        tip: dartTip(m[5]),
        file: m[1],
        line: Number(m[2]),
        column: Number(m[3]),
      });
    }
    // flutter analyze: error • Undefined name 'x' • lib/main.dart:12:5 • undefined_identifier
    const a = l.match(
      /^\s*(error|warning) • (.+?) • ([^•]+\.dart):(\d+):(\d+) • ([\w_]+)/,
    );
    if (a) {
      add({
        kind: `Dart ${a[1]}`,
        message: a[2],
        tip: dartTip(a[2]),
        file: a[3].trim(),
        line: Number(a[4]),
        column: Number(a[5]),
      });
    }
  }

  // ---- pubspec.yaml ----
  for (const l of lines) {
    const m = l.match(
      /Error on line (\d+), column (\d+) of ([^:]*pubspec\.yaml): (.+)$/,
    );
    if (m) {
      add({
        kind: 'pubspec.yaml',
        message: m[4],
        file: m[3],
        line: Number(m[1]),
        column: Number(m[2]),
        tip: 'pubspec.yaml मा indentation (space) मिलेन। YAML मा Tab चल्दैन, २ space प्रयोग गर्नुहोस्। — pubspec.yaml indentation is wrong: YAML needs spaces (2 per level), not tabs.',
      });
    }
    const dep = l.match(
      /Because \S+ depends on (\S+) .* which doesn't match any versions|depends on (\S+) which doesn't exist/,
    );
    if (dep) {
      add({
        kind: 'pub get',
        message: l.trim(),
        file: 'pubspec.yaml',
        tip: 'pubspec.yaml मा package को नाम वा version मिलेन। pub.dev मा सही नाम/version हेर्नुहोस्। — A package name or version in pubspec.yaml is wrong; check it on pub.dev.',
      });
    }
  }

  // ---- Flutter tooling ----
  const whole = output;
  if (/No supported devices (found|connected)|No devices found/i.test(whole)) {
    add({
      kind: 'Flutter device',
      message: 'No supported devices connected',
      tip: 'कुनै device भेटिएन। माथिबाट "Chrome मा चलाऊ · Run in Chrome" छानेर चलाउनुहोस्। — No device found; choose "Run in Chrome" at the top.',
    });
  }
  if (
    /Android license status unknown|Android licenses not accepted|You have not accepted the license agreements/i.test(
      whole,
    )
  ) {
    add({
      kind: 'Android licenses',
      message: 'Android SDK licenses are not accepted',
      tip: 'APK बनाउन Android license स्वीकार गर्नुपर्छ। Terminal मा `flutter doctor --android-licenses` चलाएर सबैमा y थिच्नुहोस्। — Accept the Android licenses: run `flutter doctor --android-licenses` and answer y.',
    });
  }
  if (
    /Unable to find suitable Visual Studio toolchain|Visual Studio is missing necessary components/i.test(
      whole,
    )
  ) {
    add({
      kind: 'Visual Studio',
      message: 'Visual Studio C++ tools are missing',
      tip: 'Windows एप चलाउन Visual Studio मा "Desktop development with C++" चाहिन्छ। अहिलेलाई "Chrome मा चलाऊ" प्रयोग गर्नुहोस्। — Windows builds need the "Desktop development with C++" workload; use "Run in Chrome" for now.',
    });
  }

  // ---- Node.js ----
  for (let i = 0; i < lines.length; i++) {
    const nf = lines[i].match(/Error: Cannot find module '([^']+)'/);
    if (nf) {
      const local = nf[1].startsWith('.') || nf[1].includes(':');
      add({
        kind: 'Node module',
        message: lines[i].trim(),
        tip: local
          ? `"${nf[1]}" फाइल भेटिएन। Path र फाइल नाम जाँच्नुहोस्। — The file "${nf[1]}" was not found; check the path.`
          : `"${nf[1]}" package install छैन। "प्याकेजहरू ल्याऊ · Install packages" थिच्नुहोस्, वा \`npm install ${nf[1]}\` चलाउनुहोस्। — The "${nf[1]}" package is missing; press "Install packages" or run \`npm install ${nf[1]}\`.`,
      });
    }
    const js = lines[i].match(
      /^(SyntaxError|ReferenceError|TypeError|RangeError): (.+)$/,
    );
    // Python ले पहिल्यै समातेको भए दोहोर्याउँदैन — skip errors the Python rules already explained.
    if (js && !tips.some((t) => t.kind === js[1] && t.message === js[2])) {
      let file: string | undefined;
      let line: number | undefined;
      let column: number | undefined;
      for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
        const at = lines[j].match(
          /\(?((?:[A-Za-z]:)?[^():]+\.[cm]?[jt]sx?):(\d+):(\d+)\)?/,
        );
        if (at && !/node:internal|node_modules/.test(at[1])) {
          [file, line, column] = [
            at[1].replace(/^file:\/\/\/?/, ''),
            Number(at[2]),
            Number(at[3]),
          ];
          break;
        }
      }
      if (!file) {
        for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
          const head = lines[j].match(
            /^((?:[A-Za-z]:)?[^():]+\.[cm]?[jt]sx?):(\d+)$/,
          );
          if (head) {
            [file, line] = [head[1], Number(head[2])];
            break;
          }
        }
      }
      const tip =
        js[1] === 'ReferenceError'
          ? 'त्यो नाम परिभाषित छैन। हिज्जे मिलाउनुहोस् वा पहिले variable बनाउनुहोस्। — That name is not defined; fix the spelling or declare it first.'
          : js[1] === 'SyntaxError'
            ? 'JavaScript को लेखाइ मिलेन। ब्र्याकेट, comma र quote जाँच्नुहोस्। — JavaScript syntax error: check brackets, commas and quotes.'
            : 'मान (value) को किसिम मिलेन, undefined त भएन? — A value has the wrong type; is it undefined?';
      add({ kind: js[1], message: js[2], tip, file, line, column });
    }
    if (/npm ERR! Missing script: "?([\w:-]+)"?/.test(lines[i])) {
      add({
        kind: 'npm script',
        message: lines[i].trim(),
        tip: 'package.json मा त्यो script छैन। "scripts" भाग जाँच्नुहोस्। — That script is not in package.json; check its "scripts" section.',
      });
    }
  }

  // Error भएका ठाउँ (फाइल/लाइन) भएकालाई पहिले देखाउने — show tips with a location first.
  return tips
    .sort((a, b) => Number(Boolean(b.file)) - Number(Boolean(a.file)))
    .slice(0, 400);
}
