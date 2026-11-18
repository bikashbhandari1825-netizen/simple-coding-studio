import * as monaco from 'monaco-editor';
import type * as Monaco from 'monaco-editor';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AiContext,
  FileEntry,
  ProjectInfo,
  RunPreset,
  SettingsInfo,
} from '../shared/types';
import { ConsolePanel, type ConsoleLine } from './components/ConsolePanel';
import { AccountMenu, useClaudeAccount } from './components/ClaudeAccount';
import { PromptDialog, SettingsDialog } from './components/Dialogs';
import { EditorArea, type OpenTab } from './components/EditorArea';
import { FileTree } from './components/FileTree';
import { TutorPanel, type TutorRequest } from './components/TutorPanel';
import { Welcome } from './components/Welcome';
import { QuickOpen } from './components/QuickOpen';
import {
  baseName,
  errorText,
  isProbablyBinary,
  languageFor,
  rememberRecent,
  stripAnsi,
} from './lib/helpers';
import { getUiLang, setUiLang, tr, tr2, type UiLang } from './i18n';
import { LangSwitch } from './components/LangSwitch';
import { analyzeOutput, type FixTip } from './lib/errorAnalyzer';
import type { EditorDiagnostic } from '../shared/types';

type DialogKind =
  | 'newFile'
  | 'newFolder'
  | 'newFlutter'
  | 'settings'
  | 'quickOpen'
  | null;

const KIND_LABEL: Record<ProjectInfo['kind'], string> = {
  flutter: '💙 Flutter',
  dart: '🎯 Dart',
  node: '🟩 Node.js',
  python: '🐍 Python',
  web: '🌐 Web',
  unknown: '📁 Folder',
};

const MAX_CONSOLE_CHARS = 200_000;

export default function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [selectedDir, setSelectedDir] = useState('');
  const [treeVersion, setTreeVersion] = useState(0);
  const [presets, setPresets] = useState<RunPreset[]>([]);
  const [presetId, setPresetId] = useState('');
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [running, setRunning] = useState<{
    runId: number;
    interactive: boolean;
  } | null>(null);
  // Guru panel सधैं देखिन्छ; चौडाइ मात्र बदल्न मिल्छ — Guru is always visible; only its width can change.
  const [guruWidth, setGuruWidth] = useState(() => {
    try {
      return Number(localStorage.getItem('studio.guruWidth')) || 400;
    } catch {
      return 400;
    }
  });
  const account = useClaudeAccount();
  // भाषा बदल्दा पूरै app फेरि render हुन्छ — changing the language re-renders the whole app.
  const [uiLang, setUiLangState] = useState<UiLang>(getUiLang);
  const changeLang = (lang: UiLang) => {
    setUiLang(lang);
    setUiLangState(lang);
  };
  const [settings, setSettings] = useState<SettingsInfo>({
    model: 'default',
  });
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [pendingTutor, setPendingTutor] = useState<TutorRequest | null>(null);
  const [dragging, setDragging] = useState(false);

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const lineId = useRef(0);
  const interactiveRef = useRef(false);

  const activeTab = tabs.find((t) => t.path === activePath) ?? null;
  const dirtyCount = tabs.filter((t) => t.content !== t.savedContent).length;

  const showToast = useCallback((text: string, error = false) => {
    setToast({ text, error });
  }, []);
  const showError = useCallback(
    (text: string) => showToast(text, true),
    [showToast],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.error ? 6000 : 2500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    window.studio
      .getSettings()
      .then(setSettings)
      .catch(() => undefined);
  }, []);

  // ---------- Console ----------
  const pushLine = useCallback((kind: ConsoleLine['kind'], text: string) => {
    setConsoleLines((prev) => {
      const last = prev[prev.length - 1];
      let next: ConsoleLine[];
      // एउटै प्रकारको output लाई जोड्ने ताकि लाइन बीचमा नटुक्रियोस् — merge chunks so lines don't split.
      if (
        last &&
        last.kind === kind &&
        (kind === 'stdout' || kind === 'stderr')
      ) {
        next = [...prev.slice(0, -1), { ...last, text: last.text + text }];
      } else {
        next = [...prev, { id: lineId.current++, kind, text }];
      }
      let total = next.reduce((n, l) => n + l.text.length, 0);
      while (total > MAX_CONSOLE_CHARS && next.length > 1) {
        total -= next[0].text.length;
        next = next.slice(1);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const off = window.studio.onRunEvent((event) => {
      if (event.type === 'start') {
        setRunning({ runId: event.runId, interactive: interactiveRef.current });
        pushLine('command', event.commandLine);
      } else if (event.type === 'output') {
        pushLine(event.stream, stripAnsi(event.data));
      } else {
        setRunning((r) => (r?.runId === event.runId ? null : r));
        // Run गल्तीसहित बन्द भयो: Guru लाई आफैं बुझाउन भन्ने (Auto खुला भए) — a failed run: let Guru explain it (if Auto is on).
        if (event.code !== 0 && !event.stoppedByUser)
          setRunFailedAt(Date.now());
        pushLine(
          event.code === 0 || event.stoppedByUser ? 'info' : 'error',
          event.stoppedByUser
            ? tr('⏹ तपाईंले रोक्नुभयो · Stopped by you')
            : event.code === 0
              ? tr('✅ सफलतापूर्वक सकियो · Finished successfully')
              : tr(
                  `❌ गल्ती भयो (code ${event.code ?? '?'}) — बुझ्न "Guru लाई सोध" थिच्नुहोस् · Failed; press "Ask Guru" to understand the error`,
                ),
        );
      }
    });
    return () => off();
  }, [pushLine]);

  // ---------- Project ----------
  const refreshPresets = useCallback(
    (proj: ProjectInfo | null, currentFile: string | null) => {
      if (!proj) {
        setPresets([]);
        return;
      }
      window.studio
        .getRunPresets(proj.rootPath, currentFile)
        .then((list) => {
          setPresets(list);
          setPresetId((id) =>
            list.some((p) => p.id === id) ? id : (list[0]?.id ?? ''),
          );
        })
        .catch((err) => showError(errorText(err)));
    },
    [showError],
  );

  useEffect(() => {
    refreshPresets(project, activePath);
  }, [project, activePath, refreshPresets]);

  const confirmDiscard = () =>
    dirtyCount === 0 ||
    window.confirm(
      tr(
        `${dirtyCount} फाइल सेभ भएका छैनन्। छोडेर अगाडि बढ्ने? — ${dirtyCount} unsaved file(s). Discard changes?`,
      ),
    );

  const applyProject = useCallback((proj: ProjectInfo | null) => {
    if (!proj) return;
    setProject(proj);
    setTabs([]);
    setActivePath(null);
    setSelectedDir(proj.rootPath);
    setTreeVersion((v) => v + 1);
    rememberRecent(proj.rootPath);
  }, []);

  const openFolder = async () => {
    if (!confirmDiscard()) return;
    try {
      applyProject(await window.studio.openFolderDialog());
    } catch (err) {
      showError(errorText(err));
    }
  };

  const openRecent = async (p: string) => {
    try {
      const proj = await window.studio.openRecentFolder(p);
      if (!proj)
        showError(tr('यो फोल्डर भेटिएन — This folder no longer exists.'));
      applyProject(proj);
    } catch (err) {
      showError(errorText(err));
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!confirmDiscard()) return;
    try {
      const proj = await window.studio.openDroppedFolder(file);
      if (!proj)
        showError(
          tr(
            'कृपया फाइल होइन, फोल्डर छोड्नुहोस् — Please drop a folder, not a file.',
          ),
        );
      applyProject(proj);
    } catch (err) {
      showError(errorText(err));
    }
  };

  // ---------- Files ----------
  const openFile = useCallback(
    async (entry: FileEntry) => {
      if (tabs.some((t) => t.path === entry.path)) {
        setActivePath(entry.path);
        return;
      }
      if (isProbablyBinary(entry.name)) {
        showError(
          tr(
            'यो फाइल कोड होइन (image/binary), editor मा खोल्न मिल्दैन — This is not a text file.',
          ),
        );
        return;
      }
      try {
        const content = await window.studio.readFile(entry.path);
        setTabs((prev) => [
          ...prev,
          {
            path: entry.path,
            name: entry.name,
            content,
            savedContent: content,
            language: languageFor(entry.name),
          },
        ]);
        setActivePath(entry.path);
        if (/\.(dart|py)$/i.test(entry.name))
          void window.studio
            .diagUpdate(entry.path, content, 'open')
            .catch(() => undefined);
      } catch (err) {
        showError(errorText(err));
      }
    },
    [tabs, showError],
  );

  const saveActive = useCallback(async () => {
    const tab = tabs.find((t) => t.path === activePath);
    if (!tab) return;
    try {
      await window.studio.writeFile(tab.path, tab.content);
      setTabs((prev) =>
        prev.map((t) =>
          t.path === tab.path ? { ...t, savedContent: tab.content } : t,
        ),
      );
      showToast(tr(`💾 ${tab.name} सेभ भयो · Saved`));
      if (tab.name === 'pubspec.yaml' || tab.name === 'package.json')
        refreshPresets(project, activePath);
    } catch (err) {
      showError(errorText(err));
    }
  }, [tabs, activePath, project, refreshPresets, showToast, showError]);

  const saveAll = useCallback(async () => {
    const dirty = tabs.filter((t) => t.content !== t.savedContent);
    for (const tab of dirty) {
      await window.studio.writeFile(tab.path, tab.content);
    }
    if (dirty.length) {
      setTabs((prev) => prev.map((t) => ({ ...t, savedContent: t.content })));
    }
  }, [tabs]);

  const closeTab = (path: string) => {
    const tab = tabs.find((t) => t.path === path);
    if (
      tab &&
      tab.content !== tab.savedContent &&
      !window.confirm(
        tr(`${tab.name} सेभ भएको छैन। बन्द गर्ने? — Close without saving?`),
      )
    ) {
      return;
    }
    if (/\.dart$/i.test(path))
      void window.studio.diagUpdate(path, '', 'close').catch(() => undefined);
    const idx = tabs.findIndex((t) => t.path === path);
    const next = tabs.filter((t) => t.path !== path);
    setTabs(next);
    if (activePath === path)
      setActivePath(next[Math.min(idx, next.length - 1)]?.path ?? null);
  };

  const trash = async (entry: FileEntry) => {
    if (
      !window.confirm(
        tr(
          `"${entry.name}" लाई Recycle Bin मा पठाउने? — Move "${entry.name}" to the Recycle Bin?`,
        ),
      )
    )
      return;
    try {
      await window.studio.trashEntry(entry.path);
      const gone = (p: string) =>
        p === entry.path ||
        p.startsWith(entry.path + '\\') ||
        p.startsWith(entry.path + '/');
      setTabs((prev) => prev.filter((t) => !gone(t.path)));
      if (activePath && gone(activePath)) setActivePath(null);
      if (gone(selectedDir) && project) setSelectedDir(project.rootPath);
      setTreeVersion((v) => v + 1);
      showToast(tr('🗑 Recycle Bin मा पठाइयो · Moved to Recycle Bin'));
    } catch (err) {
      showError(errorText(err));
    }
  };

  // Ctrl+S editor बाहिर पनि — Ctrl+S also works outside the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveActive();
      }
      // Ctrl+P = फाइल खोज (VS Code जस्तै) — Ctrl+P = Quick Open, like VS Code.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p' && project) {
        e.preventDefault();
        setDialog('quickOpen');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [saveActive, project]);

  // ---------- Run ----------
  const runSelected = async () => {
    if (!project || !presetId) return;
    const preset = presets.find((p) => p.id === presetId);
    try {
      await saveAll(); // चलाउनुअघि सबै सेभ — save everything before running
      interactiveRef.current = Boolean(preset?.interactive);
      setConsoleOpen(true);
      await window.studio.run(project.rootPath, presetId, activePath);
    } catch (err) {
      pushLine('error', errorText(err));
    }
  };

  const createFlutter = async (name: string) => {
    if (!confirmDiscard()) return;
    setConsoleOpen(true);
    interactiveRef.current = false;
    const proj = await window.studio.createFlutterProject(name);
    if (proj) {
      applyProject(proj);
      showToast(tr('✨ नयाँ Flutter एप तयार भयो! · New Flutter app created!'));
    }
  };

  // ---------- Guru context ----------
  const getContext = useCallback((): AiContext => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const sel = editor?.getSelection();
    const selection =
      model && sel && !sel.isEmpty() && activeTab
        ? model.getValueInRange(sel)
        : undefined;
    const output = consoleLines
      .map((l) => (l.kind === 'command' ? `> ${l.text}` : l.text))
      .join('\n');
    return {
      projectKind: project?.kind,
      fileName: activeTab
        ? activeTab.path.slice((project?.rootPath.length ?? 0) + 1)
        : undefined,
      language: activeTab?.language,
      code: activeTab?.content || undefined,
      selection: selection?.trim() ? selection : undefined,
      runOutput: output ? output.slice(-12_000) : undefined,
    };
  }, [activeTab, consoleLines, project]);

  const askGuruAboutOutput = () => {
    setPendingTutor({
      mode: 'fix',
      label: tr('🩺 यो output/गल्ती बुझाऊ · Explain this output/error'),
      prompt: 'I ran my program. Please explain the output and fix any error.',
      context: getContext(),
    });
  };

  const handlePendingHandled = useCallback(() => setPendingTutor(null), []);

  // ✍️ लेख्दा बुझाऊ: नयाँ कोड लेखेर रोकिएपछि Guru ले नयाँ लाइन मात्र लाइन-लाइन, शब्द-शब्द बुझाउँछ।
  // Explain as I type: after the learner writes new code and pauses, Guru explains only the new lines.
  const typeSnap = useRef(new Map<string, Set<string>>());
  const typeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const lastTypeExplain = useRef(0);
  const typeLive = useRef({ getContext, loggedIn: false });
  typeLive.current = {
    getContext,
    loggedIn: Boolean(account.status?.loggedIn),
  };
  const lineKey = (l: string) => l.trim();
  const meaningful = (l: string) =>
    l.length >= 3 && /[A-Za-z0-9]/.test(l) && !/^(\/\/|#|\*|\/\*)/.test(l);
  const rememberLines = (path: string, content: string) =>
    typeSnap.current.set(
      path,
      new Set(content.split('\n').map(lineKey).filter(Boolean)),
    );
  const scheduleTypeExplain = (path: string, before: string) => {
    if (!typeSnap.current.has(path)) rememberLines(path, before);
    clearTimeout(typeTimer.current);
    typeTimer.current = setTimeout(function check() {
      let on = true;
      try {
        on = localStorage.getItem('studio.guruTypeExplain') !== 'off';
      } catch {
        // ignore
      }
      const live = typeLive.current;
      const model = editorRef.current?.getModel();
      if (!on || !live.loggedIn || !model) return;
      const ctx = live.getContext();
      if (!ctx.fileName || !path.endsWith(ctx.fileName)) return;
      const wait = 25_000 - (Date.now() - lastTypeExplain.current);
      if (wait > 0) {
        typeTimer.current = setTimeout(check, wait);
        return;
      }
      // गल्ती भएको बेला Guru ले पहिले गल्ती बुझाउँछ — while there are errors, the error explainer goes first.
      const errs = monaco.editor
        .getModelMarkers({ resource: model.uri })
        .filter((m) => m.severity === monaco.MarkerSeverity.Error);
      if (errs.length) return;
      const known = typeSnap.current.get(path) ?? new Set<string>();
      const text = model.getValue();
      const fresh = text
        .split('\n')
        .filter((l) => !known.has(lineKey(l)) && meaningful(lineKey(l)));
      if (!fresh.length) return;
      rememberLines(path, text);
      lastTypeExplain.current = Date.now();
      setPendingTutor({
        mode: 'explain',
        label: tr2(
          `✍️ तपाईंले लेखेका ${fresh.length} नयाँ लाइन बुझाऊ`,
          `✍️ Explain the ${fresh.length} new line(s) you wrote`,
        ),
        prompt:
          'I just wrote the new lines below in my file. Explain each new line and each word/symbol in it, in very simple words, and tell me if anything looks wrong or could be better.',
        context: {
          ...ctx,
          selection: fresh.slice(0, 40).join('\n'),
          runOutput: undefined,
        },
      });
    }, 4000);
  };

  // Run असफल भएपछि output र गल्तीहरू सहित Guru आफैं बोलाउने — after a failed run, Guru explains it by itself.
  const [runFailedAt, setRunFailedAt] = useState(0);
  useEffect(() => {
    if (!runFailedAt || !account.status?.loggedIn) return;
    let auto = true;
    try {
      auto = localStorage.getItem('studio.guruAutoExplain') !== 'off';
    } catch {
      // ignore
    }
    if (!auto) return;
    // Fix Tip हरू तयार हुन एकछिन पर्खने — give the Fix Tips a moment to be computed.
    const t = setTimeout(() => {
      setPendingTutor({
        mode: 'fix',
        label: tr(
          '🤖 🩺 Run असफल भयो — Guru ले कारण र उपाय बताउँछ · The run failed — Guru explains why and how to fix it',
        ),
        prompt:
          'I pressed Run and my program failed. Read the output below. Explain each real error (dependency, syntax or type error) in simple words, say which file and line it is in, and show the exact fix (corrected code or the command/button to use).',
        context: getContext(),
      });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per failure
  }, [runFailedAt]);

  // ---------- Smart Error Analyzer ----------
  // अन्तिम run को output मात्र पढ्ने — analyse only the latest run's output.
  const runOutput = useMemo(() => {
    let start = 0;
    for (let i = consoleLines.length - 1; i >= 0; i--) {
      if (consoleLines[i].kind === 'command') {
        start = i;
        break;
      }
    }
    return consoleLines
      .slice(start)
      .filter((l) => l.kind === 'stdout' || l.kind === 'stderr')
      .map((l) => l.text)
      .join('')
      .slice(-60_000);
  }, [consoleLines]);
  const tips = useMemo(() => {
    const root = project?.rootPath.replace(/\//g, '\\').toLowerCase();
    // Project भित्रका फाइललाई छोटो path मा देखाउने — show files inside the project with a short relative path.
    return analyzeOutput(runOutput).map((t) => {
      if (!t.file || !root) return t;
      const norm = t.file.replace(/\//g, '\\');
      return norm.toLowerCase().startsWith(root + '\\')
        ? { ...t, file: norm.slice(root.length + 1) }
        : t;
    });
  }, [runOutput, project]);
  const [reveal, setReveal] = useState<{
    path: string;
    line: number;
    column: number;
  } | null>(null);

  const resolveTipPath = useCallback(
    (file: string) => {
      const sep = project?.rootPath.includes('\\') ? '\\' : '/';
      const clean = file.replace(/^file:\/\/\/?/, '').replace(/[\\/]/g, sep);
      const absolute = /^[A-Za-z]:[\\/]/.test(clean) || clean.startsWith('/');
      return absolute || !project ? clean : `${project.rootPath}${sep}${clean}`;
    },
    [project],
  );
  const samePath = (a: string, b: string) =>
    a.replace(/\//g, '\\').toLowerCase() ===
    b.replace(/\//g, '\\').toLowerCase();

  const openTip = async (tip: FixTip) => {
    if (!tip.file) return;
    const full = resolveTipPath(tip.file);
    const existing = tabs.find((t) => samePath(t.path, full));
    if (existing) setActivePath(existing.path);
    else
      await openFile({ name: baseName(full), path: full, isDirectory: false });
    setReveal({
      path: existing?.path ?? full,
      line: tip.line ?? 1,
      column: tip.column ?? 1,
    });
  };

  // फाइल खुलेपछि ठ्याक्कै त्यो लाइनमा पुग्ने — jump to the error line once its file is showing.
  useEffect(() => {
    if (!reveal || !activePath || !samePath(reveal.path, activePath)) return;
    const timer = setTimeout(() => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!editor || !model) return;
      const line = Math.min(Math.max(1, reveal.line), model.getLineCount());
      editor.revealLineInCenter(line);
      editor.setPosition({
        lineNumber: line,
        column: Math.max(1, reveal.column),
      });
      editor.focus();
      setReveal(null);
    }, 80);
    return () => clearTimeout(timer);
  }, [reveal, activePath]);

  // ---------- Live editor errors (Dart analysis server, Python, TS/JS) ----------
  // टाइप गर्दै गर्दा गल्ती जाँच — check for mistakes while typing (Dart/Python go to the main process).
  const diagTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const scheduleDiagnostics = (path: string, content: string) => {
    if (!/\.(dart|py)$/i.test(path)) return; // TS/JS/JSON/CSS/HTML: Monaco ले आफैं जाँच्छ — Monaco checks these itself
    clearTimeout(diagTimers.current.get(path));
    diagTimers.current.set(
      path,
      setTimeout(
        () =>
          void window.studio
            .diagUpdate(path, content, 'change')
            .catch(() => undefined),
        350,
      ),
    );
  };
  const [diagnostics, setDiagnostics] = useState<
    Record<string, Record<string, EditorDiagnostic[]>>
  >({});
  const diagKey = (p: string) => p.replace(/\//g, '\\').toLowerCase();
  useEffect(() => {
    const off = window.studio.onDiagEvent((ev) =>
      setDiagnostics((prev) => ({
        ...prev,
        [diagKey(ev.file)]: {
          ...prev[diagKey(ev.file)],
          [ev.source]: ev.diagnostics,
        },
      })),
    );
    return () => off();
  }, []);
  // Dart/Python का गल्तीलाई सबै खुला फाइलको editor मा रातो रेखा बनाउने — show them as squiggles in every open file.
  useEffect(() => {
    const severity = {
      error: monaco.MarkerSeverity.Error,
      warning: monaco.MarkerSeverity.Warning,
      info: monaco.MarkerSeverity.Info,
    };
    for (const tab of tabs) {
      const model = monaco.editor.getModel(monaco.Uri.parse(tab.path));
      if (!model) continue;
      const bySource = diagnostics[diagKey(tab.path)] ?? {};
      for (const [source, list] of Object.entries(bySource)) {
        monaco.editor.setModelMarkers(
          model,
          `studio-${source}`,
          list.map((d) => ({
            severity: severity[d.severity],
            message: d.code ? `${d.message} (${d.code})` : d.message,
            startLineNumber: d.line,
            startColumn: d.column,
            endLineNumber: d.endLine,
            endColumn: Math.max(d.endColumn, d.column + 1),
            source: source === 'dart' ? 'Dart' : 'Python',
          })),
        );
      }
    }
  }, [diagnostics, tabs, activePath]);

  // खुला फाइलका सबै गल्ती (Monaco, Dart, Python, run) — every error in the open file, for Guru and the status bar.
  // खुला फाइल र त्यसका गल्ती सँगै राख्ने, ताकि Guru ले कहिल्यै अर्को फाइलको गल्ती नबुझाओस्।
  // Keep the errors together with the file they belong to, so Guru never explains another file's errors.
  const [activeErrors, setActiveErrors] = useState<{
    path: string | null;
    list: { line: number; column: number; message: string; source: string }[];
  }>({ path: null, list: [] });
  useEffect(() => {
    const read = () => {
      const model = editorRef.current?.getModel();
      // Editor ले अझै अर्को फाइल देखाउँदैछ भने पर्खने — the editor may still be showing the previous file.
      if (
        !model ||
        !activePath ||
        model.uri.toString() !== monaco.Uri.parse(activePath).toString()
      ) {
        setActiveErrors((prev) =>
          prev.path === null && prev.list.length === 0
            ? prev
            : { path: null, list: [] },
        );
        return;
      }
      const seen = new Set<string>();
      const list = monaco.editor
        .getModelMarkers({ resource: model.uri })
        .filter((m) => m.severity === monaco.MarkerSeverity.Error)
        .sort((a, b) => a.startLineNumber - b.startLineNumber)
        .map((m) => ({
          line: m.startLineNumber,
          column: m.startColumn,
          message: m.message,
          source: m.source ?? m.owner,
        }))
        // एउटै गल्ती दुई जाँचबाट आए एकपटक मात्र — the same error from two checkers is shown once.
        .filter((e) => {
          const key = `${e.line}|${e.message.replace(/^w+Error: /, '')}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      setActiveErrors((prev) =>
        prev.path === activePath &&
        JSON.stringify(prev.list) === JSON.stringify(list)
          ? prev
          : { path: activePath, list },
      );
    };
    read();
    const again = setTimeout(read, 120); // model बदलिएपछि फेरि — read again once the editor has switched models
    const sub = monaco.editor.onDidChangeMarkers(read);
    return () => {
      clearTimeout(again);
      sub.dispose();
    };
  }, [activePath, tabs.length]);

  // Editor मा error भएको लाइनमा रातो रेखा — red squiggles on the error lines in the editor.
  useEffect(() => {
    const timer = setTimeout(() => {
      const model = editorRef.current?.getModel();
      if (!model || !activePath) return;
      const markers = tips
        .filter(
          (t) =>
            t.file && t.line && samePath(resolveTipPath(t.file), activePath),
        )
        .map((t) => {
          const line = Math.min(t.line ?? 1, model.getLineCount());
          return {
            severity: monaco.MarkerSeverity.Error,
            message: `${t.kind}: ${t.message}
💡 ${tr(t.tip)}`,
            startLineNumber: line,
            startColumn: t.column ?? 1,
            endLineNumber: line,
            endColumn: model.getLineMaxColumn(line),
          };
        });
      monaco.editor.setModelMarkers(model, 'studio-run', markers);
    }, 60);
    return () => clearTimeout(timer);
  }, [tips, activePath, resolveTipPath, tabs.length]);

  const askGuruAboutTip = (tip: FixTip) => {
    setPendingTutor({
      mode: 'fix',
      label: `${tr('🩺 यो error बुझाऊ · Explain this error')}: ${tip.kind}`,
      prompt: `Explain this error and exactly how to fix it: ${tip.kind}: ${tip.message}${tip.file ? ` (in ${tip.file}${tip.line ? `, line ${tip.line}` : ''})` : ''}.`,
      context: getContext(),
    });
  };

  const currentPreset = useMemo(
    () => presets.find((p) => p.id === presetId),
    [presets, presetId],
  );

  const startGuruResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = guruWidth;
    let latest = startWidth;
    const move = (ev: PointerEvent) => {
      const max = Math.max(320, Math.min(900, window.innerWidth - 520));
      latest = Math.min(max, Math.max(300, startWidth + (startX - ev.clientX)));
      setGuruWidth(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      try {
        localStorage.setItem('studio.guruWidth', String(latest));
      } catch {
        // ignore
      }
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---------- Layout ----------
  return (
    <div
      className="studio-bg flex h-full flex-col text-slate-100"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => void onDrop(e)}
    >
      {/* Toolbar */}
      <header className="glass-bar relative z-20 flex items-center gap-2 border-b px-3 py-2">
        <span className="mr-1 flex items-center gap-1.5 select-none">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-sky-500 via-violet-500 to-fuchsia-500 text-sm shadow-[0_0_18px_rgba(167,139,250,0.55)]">
            🎓
          </span>
          <span className="brand text-[15px]">Studio</span>
        </span>
        <button
          className="btn-ghost"
          title={tr('फोल्डर खोल · Open folder')}
          onClick={() => void openFolder()}
        >
          <span aria-hidden="true">📁</span>{' '}
          <span className="tb-label">{tr('खोल · Open')}</span>
        </button>
        <button
          className="btn-ghost"
          title={tr('नयाँ Flutter एप · New Flutter app')}
          onClick={() => setDialog('newFlutter')}
        >
          <span aria-hidden="true">✨</span>{' '}
          <span className="tb-label">{tr('नयाँ एप · New app')}</span>
        </button>
        {project && (
          <span
            className="max-w-44 shrink-0 truncate rounded-full border border-sky-400/25 bg-sky-400/10 px-2.5 py-0.5 text-xs whitespace-nowrap text-sky-100 shadow-[0_0_14px_-4px_rgba(56,189,248,0.6)]"
            title={project.rootPath}
          >
            {KIND_LABEL[project.kind]} · {project.name}
          </span>
        )}
        {project && (
          <button
            className="btn-ghost"
            title="Ctrl+P"
            onClick={() => setDialog('quickOpen')}
          >
            <span aria-hidden="true">🔍</span>{' '}
            <span className="tb-label">{tr('फाइल खोज · Find file')}</span>
          </button>
        )}
        <div className="flex-1" />
        {project && presets.length > 0 && (
          <div className="flex items-center gap-1">
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              title={
                currentPreset
                  ? tr(`कमाण्ड · Command: ${currentPreset.commandLine}`)
                  : ''
              }
              className="glass-input w-48 min-w-0 shrink rounded-xl px-2 py-1.5 text-sm text-slate-100 outline-none"
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {tr(`${p.labelNe} · ${p.labelEn}`)}
                </option>
              ))}
            </select>
            <button
              className="btn-run"
              disabled={!presetId}
              onClick={() => void runSelected()}
            >
              {tr('▶ चलाऊ · Run')}
            </button>
          </div>
        )}
        {activeTab && (
          <button
            className="btn-ghost"
            onClick={() => void saveActive()}
            title="Ctrl+S"
          >
            <span aria-hidden="true">💾</span>{' '}
            <span className="tb-label">{tr('सेभ · Save')}</span>
          </button>
        )}
        <LangSwitch value={uiLang} onChange={changeLang} />
        <AccountMenu account={account} />
        <button
          className="btn-ghost shrink-0"
          title="Settings"
          onClick={() => setDialog('settings')}
        >
          ⚙️
        </button>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {project ? (
          <>
            <aside className="glass-panel w-64 shrink-0 border-r">
              <FileTree
                project={project}
                version={treeVersion}
                activePath={activePath}
                selectedDir={selectedDir}
                onOpenFile={(entry) => void openFile(entry)}
                onSelectDir={setSelectedDir}
                onNewFile={() => setDialog('newFile')}
                onNewFolder={() => setDialog('newFolder')}
                onTrash={(entry) => void trash(entry)}
                onError={showError}
              />
            </aside>
            <main className="flex min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 bg-slate-800">
                <EditorArea
                  tabs={tabs}
                  activePath={activePath}
                  onSelect={setActivePath}
                  onClose={closeTab}
                  onChange={(path, content) => {
                    scheduleTypeExplain(
                      path,
                      tabs.find((t) => t.path === path)?.content ?? '',
                    );
                    setTabs((prev) =>
                      prev.map((t) =>
                        t.path === path ? { ...t, content } : t,
                      ),
                    );
                    scheduleDiagnostics(path, content);
                  }}
                  onSave={() => void saveActive()}
                  onEditorReady={(editor) => (editorRef.current = editor)}
                />
              </div>
              {consoleOpen ? (
                <div className="h-56 shrink-0 border-t border-slate-700">
                  <ConsolePanel
                    lines={consoleLines}
                    running={Boolean(running)}
                    interactive={Boolean(running?.interactive)}
                    onStop={() => void window.studio.stopRun()}
                    onKey={(k) => void window.studio.sendRunKey(k)}
                    onClear={() => setConsoleLines([])}
                    onAskGuru={askGuruAboutOutput}
                    onHide={() => setConsoleOpen(false)}
                    tips={tips}
                    onOpenTip={(tip) => void openTip(tip)}
                    onAskTip={askGuruAboutTip}
                  />
                </div>
              ) : (
                <button
                  className="border-t border-slate-700 bg-slate-950 px-3 py-1 text-left text-xs text-slate-400 hover:text-slate-200"
                  onClick={() => setConsoleOpen(true)}
                >
                  {tr('▴ 🖥️ नतिजा देखाऊ · Show output')}{' '}
                  {running ? tr('● चल्दैछ · running') : ''}
                </button>
              )}
            </main>
          </>
        ) : (
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <Welcome
                onOpenFolder={() => void openFolder()}
                onNewFlutter={() => setDialog('newFlutter')}
                onOpenRecent={(p) => void openRecent(p)}
              />
            </div>
            {consoleLines.length > 0 && (
              <div className="h-56 shrink-0 border-t border-slate-700">
                <ConsolePanel
                  lines={consoleLines}
                  running={Boolean(running)}
                  interactive={false}
                  onStop={() => void window.studio.stopRun()}
                  onKey={() => undefined}
                  onClear={() => setConsoleLines([])}
                  onAskGuru={askGuruAboutOutput}
                  onHide={() => setConsoleLines([])}
                />
              </div>
            )}
          </main>
        )}
        <aside
          className="glass-panel relative shrink-0 border-l"
          style={{ width: guruWidth }}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            title={tr('तानेर चौडाइ बदल्नुहोस् · Drag to resize')}
            className="absolute top-0 -left-1 z-20 h-full w-2 cursor-col-resize transition-colors hover:bg-gradient-to-b hover:from-sky-400/60 hover:via-violet-400/60 hover:to-fuchsia-400/60"
            onPointerDown={startGuruResize}
          />
          <TutorPanel
            account={account}
            getContext={getContext}
            pending={pendingTutor}
            onPendingHandled={handlePendingHandled}
            editorErrors={
              activeErrors.path === activePath ? activeErrors.list : []
            }
            activeFile={
              activeTab && activeErrors.path === activeTab.path
                ? baseName(activeTab.path)
                : null
            }
            onJumpTo={(line, column) => {
              const editor = editorRef.current;
              if (!editor) return;
              editor.revealLineInCenter(line);
              editor.setPosition({ lineNumber: line, column });
              editor.focus();
            }}
          />
        </aside>
      </div>

      {/* Status bar */}
      <footer className="glass-bar flex items-center gap-3 border-t px-3 py-0.5 text-[11px] text-slate-400">
        <span>
          {project
            ? project.rootPath
            : tr('कुनै project खुलेको छैन · No project open')}
        </span>
        <div className="flex-1" />
        {dirtyCount > 0 && (
          <span className="text-amber-400">
            {tr(`● ${dirtyCount} सेभ बाँकी · unsaved`)}
          </span>
        )}
        {activeTab &&
          activeErrors.path === activeTab.path &&
          activeErrors.list.length > 0 && (
            <span className="text-rose-400">
              {tr(
                `⛔ ${activeErrors.list.length} गल्ती · ${activeErrors.list.length} error(s)`,
              )}
            </span>
          )}
        {activeTab && <span>{activeTab.language}</span>}
        <span>
          {account.status?.loggedIn
            ? tr(
                `🧑‍🏫 Guru तयार · ready (${account.status.email ?? 'Claude Code'})`,
              )
            : tr(
                '🧑‍🏫 Guru: Claude Code मा login गर्नुहोस् · sign in to Claude Code',
              )}
        </span>
      </footer>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-sky-900/40 text-2xl font-semibold text-white">
          {tr('📂 फोल्डर यहाँ छोड्नुहोस् · Drop the folder here')}
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-8 left-1/2 z-50 max-w-xl -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-xl ${
            toast.error ? 'bg-rose-700 text-white' : 'bg-emerald-700 text-white'
          }`}
        >
          {tr(toast.text)}
        </div>
      )}

      {dialog === 'newFile' && project && (
        <PromptDialog
          title={tr('नयाँ फाइल · New file')}
          hint={tr(`फोल्डर · Folder: ${baseName(selectedDir)}`)}
          placeholder="main.dart"
          confirmLabel={tr('बनाऊ · Create')}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const created = await window.studio.createFile(selectedDir, name);
            setTreeVersion((v) => v + 1);
            await openFile({
              name: baseName(created),
              path: created,
              isDirectory: false,
            });
          }}
        />
      )}
      {dialog === 'newFolder' && project && (
        <PromptDialog
          title={tr('नयाँ फोल्डर · New folder')}
          hint={tr(`भित्र · Inside: ${baseName(selectedDir)}`)}
          placeholder="screens"
          confirmLabel={tr('बनाऊ · Create')}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const created = await window.studio.createFolder(selectedDir, name);
            setSelectedDir(created);
            setTreeVersion((v) => v + 1);
          }}
        />
      )}
      {dialog === 'newFlutter' && (
        <PromptDialog
          title={tr('✨ नयाँ Flutter एप · New Flutter app')}
          hint={tr(
            'नाम सानो अंग्रेजी अक्षरमा, खाली ठाउँको सट्टा _ (जस्तै nepali_quiz)। त्यसपछि project राख्ने फोल्डर छान्नुहोस्। — Lowercase name with _ ; then choose where to save it.',
          )}
          placeholder="my_first_app"
          confirmLabel={tr('बनाऊ · Create')}
          onClose={() => setDialog(null)}
          onSubmit={createFlutter}
        />
      )}
      {dialog === 'quickOpen' && project && (
        <QuickOpen
          rootPath={project.rootPath}
          onClose={() => setDialog(null)}
          onOpen={(rel) => {
            setDialog(null);
            const full = `${project.rootPath}\\${rel}`;
            void openFile({
              name: baseName(full),
              path: full,
              isDirectory: false,
            });
          }}
        />
      )}
      {dialog === 'settings' && (
        <SettingsDialog
          account={account}
          settings={settings}
          onChange={setSettings}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
