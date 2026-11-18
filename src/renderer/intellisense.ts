import * as monaco from 'monaco-editor';
import type { EditorDiagnostic } from '../shared/types';
import { tr } from './i18n';
import { newId } from './lib/helpers';

// 💡 Smart IntelliSense:
//  - Dart: Dart analysis server बाट वास्तविक सुझाव र Quick Fix (VS Code कै इन्जिन)।
//  - Python: keyword, builtin र तयारी snippet।
//  - सबै भाषा: "🧑‍🏫 Guru AI Fix" — गल्तीमा क्लिक गर्दा Guru ले सच्याएको कोड सिधै editor मा।
// Smart IntelliSense: real Dart suggestions and quick fixes from the Dart analysis server (the same engine
// VS Code uses), Python keywords/builtins/snippets, and a "Guru AI Fix" for every language that writes the
// corrected code straight into the editor.

/** Model को URI बाट फाइलको path — map a model URI back to its file path (kept up to date by App). */
const pathByUri = new Map<string, string>();
export function setOpenFiles(paths: string[]): void {
  pathByUri.clear();
  for (const p of paths) pathByUri.set(monaco.Uri.parse(p).toString(), p);
}
const pathOf = (model: monaco.editor.ITextModel) =>
  pathByUri.get(model.uri.toString());

type Notify = (text: string, error?: boolean) => void;
let notify: Notify = () => undefined;
export function setNotifier(fn: Notify): void {
  notify = fn;
}

// LSP CompletionItemKind (1–25) → Monaco
const KIND_NAMES = [
  '',
  'Text',
  'Method',
  'Function',
  'Constructor',
  'Field',
  'Variable',
  'Class',
  'Interface',
  'Module',
  'Property',
  'Unit',
  'Value',
  'Enum',
  'Keyword',
  'Snippet',
  'Color',
  'File',
  'Reference',
  'Folder',
  'EnumMember',
  'Constant',
  'Struct',
  'Event',
  'Operator',
  'TypeParameter',
] as const;
const kindOf = (k: number) =>
  (monaco.languages.CompletionItemKind as unknown as Record<string, number>)[
    KIND_NAMES[k] || 'Text'
  ] ?? monaco.languages.CompletionItemKind.Text;

// ---------------------------------------------------------------- Python
const PY_KEYWORDS =
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(
    ' ',
  );
const PY_BUILTINS =
  'print input len range int float str list dict set tuple bool type abs min max sum sorted reversed enumerate zip map filter open round isinstance any all format'.split(
    ' ',
  );
const PY_SNIPPETS: [string, string, string][] = [
  ['def', 'def ${1:name}(${2:args}):\n\t${3:pass}', 'function · फङ्सन'],
  ['for', 'for ${1:item} in ${2:items}:\n\t${3:pass}', 'loop · लुप'],
  ['if', 'if ${1:condition}:\n\t${2:pass}', 'condition · सर्त'],
  [
    'ifelse',
    'if ${1:condition}:\n\t${2:pass}\nelse:\n\t${3:pass}',
    'if / else',
  ],
  ['while', 'while ${1:condition}:\n\t${2:pass}', 'loop · लुप'],
  [
    'class',
    'class ${1:Name}:\n\tdef __init__(self${2:, value}):\n\t\t${3:self.value = value}',
    'class · क्लास',
  ],
  ['main', "if __name__ == '__main__':\n\t${1:main()}", 'entry point'],
  [
    'try',
    'try:\n\t${1:pass}\nexcept ${2:Exception} as e:\n\tprint(e)',
    'error handling',
  ],
];

let registered = false;

export function installIntellisense(): void {
  if (registered) return;
  registered = true;

  // ---------- Dart completions ----------
  monaco.languages.registerCompletionItemProvider('dart', {
    triggerCharacters: ['.', '('],
    async provideCompletionItems(model, position) {
      const file = pathOf(model);
      if (!file) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );
      try {
        const items = await window.studio.diagComplete(
          file,
          model.getValue(),
          position.lineNumber,
          position.column,
        );
        return {
          suggestions: items.map((it) => ({
            label: it.label,
            kind: kindOf(it.kind),
            detail: it.detail,
            documentation: it.documentation,
            // Dart ले फर्काउने text ले शब्द सुरुदेखि बदल्छ — replace the word typed so far
            insertText: it.insertText,
            insertTextRules: it.isSnippet
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
            sortText: it.sortText,
            filterText: it.filterText,
            range,
          })),
        };
      } catch {
        return { suggestions: [] };
      }
    },
  });

  // ---------- Python completions ----------
  monaco.languages.registerCompletionItemProvider('python', {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );
      const K = monaco.languages.CompletionItemKind;
      const seen = new Set<string>();
      const suggestions: monaco.languages.CompletionItem[] = [];
      for (const [label, body, doc] of PY_SNIPPETS) {
        suggestions.push({
          label,
          kind: K.Snippet,
          insertText: body,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: tr(doc),
          sortText: '0' + label,
          range,
        });
      }
      for (const k of PY_KEYWORDS) {
        seen.add(k);
        suggestions.push({
          label: k,
          kind: K.Keyword,
          insertText: k,
          sortText: '2' + k,
          range,
        });
      }
      for (const b of PY_BUILTINS) {
        seen.add(b);
        suggestions.push({
          label: b,
          kind: K.Function,
          insertText: b + '($0)',
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: '1' + b,
          range,
        });
      }
      // यो फाइलमा भएका नामहरू — names already used in this file
      for (const m of model.getValue().matchAll(/\b[A-Za-z_]\w{2,}\b/g)) {
        if (seen.has(m[0]) || m[0] === word.word) continue;
        seen.add(m[0]);
        suggestions.push({
          label: m[0],
          kind: K.Variable,
          insertText: m[0],
          sortText: '3' + m[0],
          range,
        });
      }
      return { suggestions };
    },
  });

  // ---------- Quick fixes (💡 / Ctrl+.) ----------
  const aiFixCommand = monaco.editor.registerCommand(
    'studio.aiFix',
    (_accessor, uri: string, marker: monaco.editor.IMarkerData) => {
      const model = monaco.editor.getModel(monaco.Uri.parse(uri));
      if (model) void aiFix(model, marker);
    },
  );
  void aiFixCommand;

  const provider: monaco.languages.CodeActionProvider = {
    async provideCodeActions(model, range, context) {
      const errors = context.markers.filter(
        (m) => m.severity >= monaco.MarkerSeverity.Warning,
      );
      if (!errors.length) return { actions: [], dispose: () => undefined };
      const actions: monaco.languages.CodeAction[] = [];
      const file = pathOf(model);
      // Dart analysis server का तयारी fix — ready-made fixes from the Dart analysis server
      if (file && model.getLanguageId() === 'dart') {
        try {
          const diags: EditorDiagnostic[] = errors.map((m) => ({
            line: m.startLineNumber,
            column: m.startColumn,
            endLine: m.endLineNumber,
            endColumn: m.endColumn,
            message: m.message.replace(/ \(\w+\)$/, ''),
            code: typeof m.code === 'string' ? m.code : m.code?.value,
            severity:
              m.severity === monaco.MarkerSeverity.Error ? 'error' : 'warning',
          }));
          const fixes = await window.studio.diagCodeActions(
            file,
            model.getValue(),
            {
              line: range.startLineNumber,
              column: range.startColumn,
              endLine: range.endLineNumber,
              endColumn: range.endColumn,
            },
            diags,
          );
          for (const fx of fixes) {
            actions.push({
              title: `🔧 ${fx.title}`,
              kind: 'quickfix',
              isPreferred: fx.preferred,
              diagnostics: errors,
              edit: {
                edits: fx.edits.map((e) => ({
                  resource: model.uri,
                  versionId: model.getVersionId(),
                  textEdit: {
                    range: new monaco.Range(
                      e.line,
                      e.column,
                      e.endLine,
                      e.endColumn,
                    ),
                    text: e.text,
                  },
                })),
              },
            });
          }
        } catch {
          // Dart server नभए पनि AI fix बाँकी रहन्छ — the AI fix still works without the Dart server
        }
      }
      // 🧑‍🏫 हरेक भाषामा Guru AI Fix — Guru's AI fix in every language
      const first = errors[0];
      actions.push({
        title: tr('🧑‍🏫 Guru AI Fix — Guru ले यो गल्ती सच्याओस् · Let Guru fix this'),
        kind: 'quickfix',
        diagnostics: [first],
        command: {
          id: 'studio.aiFix',
          title: 'Guru AI Fix',
          arguments: [model.uri.toString(), first],
        },
      });
      return { actions, dispose: () => undefined };
    },
  };
  for (const lang of [
    'dart',
    'python',
    'javascript',
    'typescript',
    'json',
    'css',
    'html',
  ])
    monaco.languages.registerCodeActionProvider(lang, provider, {
      providedCodeActionKinds: ['quickfix'],
    });
}

/** Guru (Claude) बाट सच्याइएको कोड ल्याएर सिधै editor मा राख्ने — ask Guru for corrected code and apply it. */
async function aiFix(
  model: monaco.editor.ITextModel,
  marker: monaco.editor.IMarkerData,
): Promise<void> {
  const total = model.getLineCount();
  const from = Math.max(1, marker.startLineNumber - 6);
  const to = Math.min(total, marker.endLineNumber + 6);
  const numbered: string[] = [];
  for (let l = from; l <= to; l++)
    numbered.push(`${String(l).padStart(4)} | ${model.getLineContent(l)}`);
  const errors = monaco.editor
    .getModelMarkers({ resource: model.uri })
    .filter((m) => m.startLineNumber >= from && m.endLineNumber <= to)
    .map((m) => `line ${m.startLineNumber}: ${m.message}`)
    .slice(0, 8);
  const version = model.getVersionId();
  const requestId = newId();
  notify(tr('🧑‍🏫 Guru ले गल्ती सच्याउँदैछ… · Guru is fixing it…'));
  let text = '';
  const result = await new Promise<string | null>((resolve) => {
    const off = window.studio.onAiEvent((ev) => {
      if (ev.requestId !== requestId) return;
      if (ev.type === 'text') text += ev.text;
      else {
        off();
        resolve(ev.type === 'done' ? text : null);
      }
    });
    window.studio
      .askAi({
        requestId,
        mode: 'quickfix',
        messages: [
          {
            role: 'user',
            content: `Language: ${model.getLanguageId()}\nFix lines ${from}-${to} (shown with line numbers; do not include the numbers in your answer):\n${numbered.join('\n')}\n\nErrors:\n${errors.join('\n') || marker.message}`,
          },
        ],
      })
      .catch(() => {
        off();
        resolve(null);
      });
  });
  const code = result?.match(/```[\w-]*\n([\s\S]*?)```/)?.[1];
  if (!code) {
    notify(
      tr(
        'Guru ले fix दिन सकेन। फेरि प्रयास गर्नुहोस्। · Guru could not produce a fix. Try again.',
      ),
      true,
    );
    return;
  }
  if (model.isDisposed() || model.getVersionId() !== version) {
    notify(
      tr(
        'यसबीचमा फाइल बदलियो, fix लागू गरिएन। · The file changed meanwhile; the fix was not applied.',
      ),
      true,
    );
    return;
  }
  const replacement = code.replace(/\n$/, '');
  model.pushEditOperations(
    [],
    [
      {
        range: new monaco.Range(from, 1, to, model.getLineMaxColumn(to)),
        text: replacement,
      },
    ],
    () => null,
  );
  notify(
    tr(
      '✅ Guru ले सच्यायो (Ctrl+Z ले फर्काउन सकिन्छ) · Fixed by Guru (Ctrl+Z to undo)',
    ),
  );
}

/**
 * 🎙️ "यो एरर फिक्स गर": खुला editor को पहिलो गल्ती Guru ले सिधै सच्याउने। गल्ती नभए false।
 * Voice "fix this error": let Guru fix the first error in the open editor. Returns false when there is none.
 */
export function fixFirstError(): boolean {
  const editor = monaco.editor.getEditors()[0];
  const model = editor?.getModel();
  if (!editor || !model) return false;
  const markers = monaco.editor
    .getModelMarkers({ resource: model.uri })
    .filter((m) => m.severity === monaco.MarkerSeverity.Error)
    .sort((a, b) => a.startLineNumber - b.startLineNumber);
  if (!markers.length) return false;
  editor.revealLineInCenter(markers[0].startLineNumber);
  void aiFix(model, markers[0]);
  return true;
}
