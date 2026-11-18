// Monaco लाई internet (CDN) बाट होइन, आफ्नै computer बाट लोड गर्ने।
// Load Monaco from the local package instead of a CDN, so the editor works offline.
//
// हरेक भाषाको आफ्नै worker: यिनैले टाइप गर्दै गर्दा TS/JS/JSON/CSS/HTML का गल्ती रातो रेखाले देखाउँछन्।
// One worker per language: these power the live red-squiggle errors for TS/JS/JSON/CSS/HTML while typing.
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker: (_id: string, label: string) => {
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less')
      return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor')
      return new HtmlWorker();
    return new EditorWorker();
  },
};

// सुरुवातीका लागि JS मा पनि type जाँच — also type-check plain JavaScript for beginners.
type TsDefaults = {
  setDiagnosticsOptions(o: object): void;
  setCompilerOptions(o: object): void;
};
type TsApi = { javascriptDefaults: TsDefaults; typescriptDefaults: TsDefaults };
// Monaco 0.57 मा TypeScript API `monaco.typescript` मा सर्यो; पुरानोमा `monaco.languages.typescript`।
// Monaco 0.57 moved the TypeScript API to `monaco.typescript`; older versions use `monaco.languages.typescript`.
const ts =
  (monaco as unknown as { typescript?: TsApi }).typescript ??
  (monaco.languages as unknown as { typescript?: TsApi }).typescript;
if (ts) {
  const diag = { noSemanticValidation: false, noSyntaxValidation: false };
  ts.typescriptDefaults.setDiagnosticsOptions(diag);
  ts.javascriptDefaults.setDiagnosticsOptions(diag);
  const opts = {
    allowNonTsExtensions: true,
    checkJs: true,
    jsx: 4 /* react-jsx */,
    target: 99 /* ESNext */,
    allowJs: true,
    // हरेक फाइल छुट्टै module: browser को window.name जस्ता नामसँग झूटो टकराव नहोस्।
    // Treat every file as a module so names like window.name don't cause false "redeclare" errors.
    moduleDetection: 3 /* Force */,
  };
  ts.typescriptDefaults.setCompilerOptions(opts);
  ts.javascriptDefaults.setCompilerOptions(opts);
}

loader.config({ monaco });

// स्वचालित परीक्षणका लागि (development मा मात्र) — exposed for automated tests, development only.
if (location.protocol.startsWith('http'))
  (window as unknown as { monaco: typeof monaco }).monaco = monaco;
