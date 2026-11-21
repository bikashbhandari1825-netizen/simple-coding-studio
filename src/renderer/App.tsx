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
import {
  NewFlutterDialog,
  PromptDialog,
  SettingsDialog,
} from './components/Dialogs';
import { EditorArea, type OpenTab } from './components/EditorArea';
import { FileTree } from './components/FileTree';
import { TutorPanel, type TutorRequest } from './components/TutorPanel';
import { Welcome } from './components/Welcome';
import { QuickOpen } from './components/QuickOpen';
import {
  EMPTY_SEARCH,
  SearchDialog,
  type SearchMemory,
} from './components/SearchDialog';
import { ProblemsPanel, type Problem } from './components/ProblemsPanel';
import { GuruCodeBox, type NumberedBlock } from './components/GuruCodeBox';
import type { CodeBlock } from './lib/splitCode';
import {
  baseName,
  errorText,
  isProbablyBinary,
  languageFor,
  rememberRecent,
  stripAnsi,
} from './lib/helpers';
import { getUiLang, setUiLang, tr, type UiLang } from './i18n';
import { LangSwitch } from './components/LangSwitch';
import { analyzeOutput, type FixTip } from './lib/errorAnalyzer';
import type {
  EditorDiagnostic,
  FlutterTemplateId,
  GitStatusInfo,
} from '../shared/types';
import { useNavHistory, type NavLoc } from './lib/useNavHistory';
import { setNotifier, setOpenFiles } from './intellisense';
import type { VoiceCommand } from './lib/voiceCommands';
import { findImportTypos, parseDartImports } from './lib/importTypos';

type DialogKind =
  | 'newFile'
  | 'newFolder'
  | 'newFlutter'
  | 'settings'
  | 'quickOpen'
  | 'search'
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
  // 📊 Status bar: पछिल्लो सेभ, पछिल्लो Run, Git/backup — last save, last run and Git/backup
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [lastRun, setLastRun] = useState<{
    state: 'ok' | 'fail' | 'stopped';
    at: number;
  } | null>(null);
  const [git, setGit] = useState<GitStatusInfo>({ isRepo: false });
  const [dragging, setDragging] = useState(false);
  // 🔎 Project खोज र 🧯 समस्या सूची — project search and the Problems list
  const [searchMemory, setSearchMemory] = useState<SearchMemory>(EMPTY_SEARCH);
  const [searchSeed, setSearchSeed] = useState('');
  const [problems, setProblems] = useState<Problem[]>([]);
  const [problemsOpen, setProblemsOpen] = useState(false);
  // 💻 Guru को कोड बाकस (मुख्य स्क्रिनमा), व्याख्या छेउको Guru बाकसमा — Guru's code box in front; the explanation stays in the side panel
  // सबै कोड सधैं रहन्छ: Code 1, Code 2, … नयाँ जवाफले अघिल्लो मेट्दैन — all code is kept: Code 1, 2, …; a new answer never wipes the earlier ones
  const [guruCode, setGuruCode] = useState<NumberedBlock[]>([]);
  const [codeOpen, setCodeOpen] = useState(true);
  const [codeFocus, setCodeFocus] = useState(0);
  const addGuruCode = useCallback((blocks: CodeBlock[]) => {
    setGuruCode((prev) => {
      setCodeFocus(prev.length);
      return [
        ...prev,
        ...blocks.map((b, i) => ({ ...b, n: prev.length + i + 1 })),
      ];
    });
    setCodeOpen(true);
  }, []);
  const applyCodeRef = useRef<((code: string) => void) | null>(null);
  // परीक्षणका लागि: कोड ट्याब सिधै थप्ने — a hook so the end-to-end tests can add Code blocks without asking Guru
  useEffect(() => {
    (window as unknown as { __addGuruCode?: unknown }).__addGuruCode =
      addGuruCode;
  }, [addGuruCode]);
  // 🟢 हरेक Code को अवस्था: todo / red (गल्ती) / green (पूरा, गल्ती छैन) — each step's state, from the matching open file
  const [markerTick, setMarkerTick] = useState(0);
  const [unlockedExtra, setUnlockedExtra] = useState<number[]>([]);
  useEffect(() => {
    const sub = monaco.editor.onDidChangeMarkers(() =>
      setMarkerTick((t) => t + 1),
    );
    return () => sub.dispose();
  }, []);
  const stepStatus = useMemo(() => {
    const squash = (t: string) => t.replace(/\s+/g, '');
    const slashes = (p: string) => p.split('\\').join('/');
    return guruCode.map((b): 'todo' | 'green' | 'red' => {
      if (!b.title) return 'todo';
      const want = '/' + slashes(b.title).replace(/^\.?\//, '');
      const tab = tabs.find((t) =>
        ('/' + slashes(t.path)).toLowerCase().endsWith(want.toLowerCase()),
      );
      if (!tab) return 'todo';
      const model = monaco.editor.getModel(monaco.Uri.parse(tab.path));
      const bad = model
        ? monaco.editor
            .getModelMarkers({ resource: model.uri })
            .some((m) => m.severity === monaco.MarkerSeverity.Error)
        : false;
      if (bad) return 'red';
      const need = squash(b.code).length;
      return need > 0 && squash(tab.content).length >= need * 0.9
        ? 'green'
        : 'todo';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guruCode, tabs, markerTick]);
  // अर्को Code खुल्ने: अघिल्लो हरियो (र कोड फाइल भए Run सफल) — next Code unlocks when the previous is green (and a code file ran OK)
  const unlockedCount = useMemo(() => {
    let n = 1;
    while (n < guruCode.length) {
      const prev = guruCode[n - 1];
      const configFile = /\.(ya?ml|json|md|txt|toml|lock)$/i.test(
        prev.title ?? '',
      );
      const done =
        unlockedExtra.includes(n) ||
        !prev.title ||
        (stepStatus[n - 1] === 'green' &&
          (configFile || lastRun?.state === 'ok'));
      if (!done) break;
      n++;
    }
    return n;
  }, [guruCode, stepStatus, lastRun, unlockedExtra]);
  const problemCursor = useRef(-1);

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

  // 💡 IntelliSense लाई खुला फाइल र सूचना दिने — tell IntelliSense the open files and how to notify.
  useEffect(() => setNotifier(showToast), [showToast]);
  useEffect(() => setOpenFiles(tabs.map((t) => t.path)), [tabs]);

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
        setLastRun({
          state: event.stoppedByUser
            ? 'stopped'
            : event.code === 0
              ? 'ok'
              : 'fail',
          at: Date.now(),
        });
        // fix सफल भयो: पहिलेको Run आफैं फेरि — the fix worked: start the earlier Run again
        const again = rerunAfter.current;
        if (again && again.runId === event.runId) {
          rerunAfter.current = null;
          if (event.code === 0 && !event.stoppedByUser)
            setTimeout(() => void runPresetRef.current(again.presetId), 300);
        }
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

  // Git/backup स्थिति: project बदल्दा, सेभ/Run पछि र हरेक १५ सेकेन्डमा — refresh on project change, after save/run and every 15 s.
  const rootPath = project?.rootPath ?? null;
  useEffect(() => {
    if (!rootPath) {
      setGit({ isRepo: false });
      return;
    }
    let alive = true;
    const load = () =>
      window.studio
        .getGitStatus(rootPath)
        .then((g) => alive && setGit(g))
        .catch(() => alive && setGit({ isRepo: false }));
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [rootPath, lastSavedAt, lastRun]);

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
      setLastSavedAt(Date.now());
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
      setLastSavedAt(Date.now());
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
      // Ctrl+Shift+F = सबै फाइलमा खोज — project-wide search.
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === 'f' &&
        project
      ) {
        e.preventDefault();
        e.stopPropagation();
        openProjectSearch();
        return;
      }
      // Ctrl+F: editor बाहिर फोकस भए पनि यही फाइलमा खोज्ने — Find in the file even when focus is outside the editor.
      const inField = (e.target as HTMLElement | null)?.closest?.(
        '.monaco-editor, input, textarea, select, [role="dialog"]',
      );
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'h') &&
        editorRef.current &&
        activePath &&
        !inField
      ) {
        e.preventDefault();
        editorRef.current.focus();
        void editorRef.current
          .getAction(
            e.key.toLowerCase() === 'h'
              ? 'editor.action.startFindReplace'
              : 'actions.find',
          )
          ?.run();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openProjectSearch only reads refs and setters
  }, [saveActive, project, activePath]);

  // ---------- 🔎 Find · 🔍 Project search · ✨ Format · ⛔ Jump to error ----------
  const openProjectSearch = () => {
    if (!project) {
      showError(tr('पहिले project खोल्नुहोस् · Open a project first'));
      return;
    }
    const editor = editorRef.current;
    const sel = editor?.getSelection();
    const picked =
      editor && sel && !sel.isEmpty()
        ? (editor.getModel()?.getValueInRange(sel) ?? '')
        : '';
    // एउटै लाइनको छानिएको शब्द मात्र खोजमा हाल्ने — only a single-line selection seeds the search
    setSearchSeed(picked && !picked.includes('\n') ? picked.slice(0, 120) : '');
    setDialog('search');
  };
  const runEditorAction = (id: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    void editor.getAction(id)?.run();
  };
  const undoEdit = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    editor.trigger('toolbar', 'undo', null);
  };
  const redoEdit = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    editor.trigger('toolbar', 'redo', null);
  };
  const formatCode = async () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !activeTab) return;
    const before = model.getValue();
    try {
      if (/\.dart$/i.test(activeTab.path)) {
        const formatted = await window.studio.diagFormat(
          activeTab.path,
          before,
        );
        if (formatted === null) {
          showError(
            tr(
              'Dart formatter तयार भएन; Flutter install जाँच्नुहोस् · The Dart formatter is not ready; check that Flutter is installed',
            ),
          );
          return;
        }
        // Undo (Ctrl+Z) ले फर्काउन मिल्ने गरी — as one edit, so Ctrl+Z undoes it
        if (formatted !== before && model.getValue() === before)
          editor.executeEdits('format', [
            { range: model.getFullModelRange(), text: formatted },
          ]);
      } else {
        const action = editor.getAction('editor.action.formatDocument');
        if (!action?.isSupported()) {
          showError(
            tr(
              'यो प्रकारको फाइलमा Format उपलब्ध छैन · Format is not available for this file type',
            ),
          );
          return;
        }
        await action.run();
      }
      showToast(
        model.getValue() === before
          ? tr('✨ पहिले नै राम्रो छ · Already tidy')
          : tr('✨ Format भयो — Ctrl+Z ले फर्काउँछ · Formatted — Ctrl+Z undoes'),
      );
    } catch (err) {
      showError(errorText(err));
    }
  };

  // ---------- Run ----------
  const runSelected = (id = presetId) => runPreset(id);
  const runPresetRef = useRef<(id: string) => Promise<void>>(
    async () => undefined,
  );
  const runPreset = async (id: string) => {
    if (!project || !id) return;
    const preset = presets.find((p) => p.id === id);
    try {
      await saveAll(); // चलाउनुअघि सबै सेभ — save everything before running
      interactiveRef.current = Boolean(preset?.interactive);
      setConsoleOpen(true);
      await window.studio.run(project.rootPath, id, activePath);
    } catch (err) {
      pushLine('error', errorText(err));
    }
  };

  runPresetRef.current = runPreset;

  const createFlutter = async (name: string, template: FlutterTemplateId) => {
    if (!confirmDiscard()) return;
    setConsoleOpen(true);
    interactiveRef.current = false;
    const proj = await window.studio.createFlutterProject(name, template);
    if (proj) {
      applyProject(proj);
      showToast(tr('✨ नयाँ Flutter एप तयार भयो! · New Flutter app created!'));
    }
  };

  // ---------- 🎙️ Voice commands (हात नचलाई) ----------
  const handleVoiceCommand = (cmd: VoiceCommand) => {
    if (cmd === 'save') void saveActive();
    else if (cmd === 'stop') void window.studio.stopRun();
    else if (cmd === 'back') nav.back();
    else if (cmd === 'forward') nav.forward();
    else if (cmd === 'openFolder') void openFolder();
    else if (cmd === 'newFlutter') setDialog('newFlutter');
    else if (cmd === 'findFile') {
      if (project) setDialog('quickOpen');
    } else if (cmd === 'run' || cmd === 'runChrome') {
      if (!project) {
        showError(tr('पहिले project खोल्नुहोस् · Open a project first'));
        return;
      }
      const id =
        cmd === 'run'
          ? presetId
          : (
              presets.find((p) => p.id === 'flutter-web') ??
              presets.find((p) => /web|chrome/i.test(p.id))
            )?.id;
      if (!id) {
        showError(
          tr('यो project Chrome मा चल्दैन · This project cannot run in Chrome'),
        );
        return;
      }
      setPresetId(id);
      void runPreset(id);
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

  // सधैं पछिल्लो context (जम्पपछि प्रयोग हुने) — always the latest context, used right after a jump
  const getContextRef = useRef(getContext);
  getContextRef.current = getContext;

  const askGuruAboutOutput = () => {
    setPendingTutor({
      mode: 'fix',
      label: tr('🩺 यो output/गल्ती बुझाऊ · Explain this output/error'),
      prompt: 'I ran my program. Please explain the output and fix any error.',
      context: getContext(),
    });
  };

  /** Output मा छानेको/कपी गरेको पाठ मात्र, बटन थिचेपछि Guru लाई — only the text picked in the Output, sent when the button is clicked. */
  const askGuruAboutSelection = (text: string) => {
    const fence = '```';
    setPendingTutor({
      mode: 'fix',
      label: tr('🩺 छानेको error बुझाऊ · Explain the error I picked'),
      prompt: `Explain this error and give the fix. Keep it very short.\n\n${fence}\n${text.slice(0, 6000)}\n${fence}`,
      context: { ...getContext(), runOutput: undefined },
    });
  };

  /** कोड बाकसको कोड नयाँ फाइलमा राख्ने (भएको फाइल बदल्नुअघि सोध्ने) — save Guru's code as a file; ask before replacing an existing one */
  const saveCodeAsFile = async (rel: string, code: string) => {
    if (!project) return;
    try {
      const parts = rel.replace(/\\/g, '/').split('/').filter(Boolean);
      const name = parts[parts.length - 1];
      let dir = project.rootPath;
      for (const seg of parts.slice(0, -1)) {
        try {
          dir = await window.studio.createFolder(dir, seg);
        } catch {
          dir = `${dir}\\${seg}`;
        }
      }
      let file: string;
      try {
        file = await window.studio.createFile(dir, name);
      } catch {
        file = `${dir}\\${name}`;
        if (
          !window.confirm(
            tr(
              `${name} पहिल्यै छ। यो कोडले बदल्ने? — ${name} already exists. Replace it with this code?`,
            ),
          )
        )
          return;
      }
      await window.studio.writeFile(file, code);
      setTreeVersion((v) => v + 1);
      if (tabs.some((t) => samePath(t.path, file)))
        setTabs((prev) =>
          prev.map((t) =>
            samePath(t.path, file)
              ? { ...t, content: code, savedContent: code }
              : t,
          ),
        );
      await jumpTo(file, 1);
      showToast(tr(`📄 ${name} मा राखियो · Saved to ${name}`));
    } catch (err) {
      showError(errorText(err));
    }
  };

  const handlePendingHandled = useCallback(() => setPendingTutor(null), []);

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
    /** खोजको नतिजा भए शब्द छान्ने लम्बाइ — length to select when jumping to a search match */
    length?: number;
  } | null>(null);
  // जम्प पूरा भएपछि गर्ने काम (जस्तै "Guru सँग ठीक गर") — runs once a jump has landed (e.g. "Fix with Guru")
  const afterJump = useRef<(() => void) | null>(null);

  /** कुनै फाइलको लाइनमा जाने (फाइल बन्द भए खोलेर) — jump to a line, opening the file first if needed. */
  const jumpTo = async (
    full: string,
    line: number,
    column = 1,
    length?: number,
  ) => {
    const existing = tabs.find((t) => samePath(t.path, full));
    if (existing) setActivePath(existing.path);
    else
      await openFile({ name: baseName(full), path: full, isDirectory: false });
    setReveal({ path: existing?.path ?? full, line, column, length });
  };

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
      const column = Math.max(1, reveal.column);
      if (reveal.length)
        editor.setSelection({
          startLineNumber: line,
          startColumn: column,
          endLineNumber: line,
          endColumn: column + reveal.length,
        });
      else editor.setPosition({ lineNumber: line, column });
      editor.focus();
      setReveal(null);
      const next = afterJump.current;
      afterJump.current = null;
      next?.();
    }, 80);
    return () => clearTimeout(timer);
  }, [reveal, activePath]);

  // ---------- ← → Navigation history (VS Code जस्तै) ----------
  const navGoTo = useCallback(
    (loc: NavLoc) => {
      const existing = tabs.find((t) => samePath(t.path, loc.path));
      if (existing) setActivePath(existing.path);
      else
        void openFile({
          name: baseName(loc.path),
          path: loc.path,
          isDirectory: false,
        });
      setReveal({
        path: existing?.path ?? loc.path,
        line: loc.line,
        column: loc.column,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- samePath is a pure helper
    [tabs, openFile],
  );
  const nav = useNavHistory(activePath, navGoTo);
  const navRef = useRef(nav);
  navRef.current = nav;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'ArrowLeft') navRef.current.back();
        else navRef.current.forward();
      }
    };
    // माउसका साइड बटन (Back/Forward) पनि — mouse side buttons too
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        navRef.current.back();
      } else if (e.button === 4) {
        e.preventDefault();
        navRef.current.forward();
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mouseup', onMouse, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mouseup', onMouse, true);
    };
  }, []);

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
            // Quick Fix का लागि Dart लाई error को code चाहिन्छ — Dart needs the error code to offer quick fixes
            code: d.code,
          })),
        );
      }
    }
  }, [diagnostics, tabs, activePath]);

  // ✏️ Dart import को टाइपो (जस्तै packages:flutter/matterial.dart) — रातो रेखा र एक क्लिकको सुझाव, AI बिना।
  // Dart import typos get a red squiggle and a one-click suggestion, with no AI involved.
  useEffect(() => {
    for (const tab of tabs) {
      if (!/.dart$/i.test(tab.path)) continue;
      const model = monaco.editor.getModel(monaco.Uri.parse(tab.path));
      if (!model) continue;
      monaco.editor.setModelMarkers(
        model,
        'studio-typo',
        findImportTypos(tab.content).map((t) => ({
          severity: monaco.MarkerSeverity.Error,
          message: tr(
            `✏️ टाइपो? "${t.uri}" होइन, "${t.suggestion}" हुनुपर्छ · Typo? Did you mean "${t.suggestion}"?`,
          ),
          startLineNumber: t.line,
          startColumn: t.startColumn,
          endLineNumber: t.line,
          endColumn: t.endColumn,
          source: 'Typo',
          code: 'studio-typo',
        })),
      );
    }
  }, [tabs, activePath]);

  // ✅/❌ import लाइनको रङ: ठीक = हरियो, गलत = रातो — import lines: green when fine, red when wrong.
  const importDeco = useRef<Monaco.editor.IEditorDecorationsCollection | null>(
    null,
  );
  useEffect(() => {
    const paint = () => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!editor || !model || !activePath || !/.dart$/i.test(activePath)) {
        importDeco.current?.clear();
        return;
      }
      if (model.uri.toString() !== monaco.Uri.parse(activePath).toString())
        return;
      const wrong = new Set(
        monaco.editor
          .getModelMarkers({ resource: model.uri })
          .filter((m) => m.severity === monaco.MarkerSeverity.Error)
          .map((m) => m.startLineNumber),
      );
      const decorations = parseDartImports(model.getValue()).map((imp) => {
        const bad = wrong.has(imp.line);
        return {
          range: new monaco.Range(imp.line, 1, imp.line, 1),
          options: {
            isWholeLine: true,
            className: bad ? 'import-bad-line' : 'import-ok-line',
            linesDecorationsClassName: bad ? 'import-bad-bar' : 'import-ok-bar',
          },
        };
      });
      if (importDeco.current) importDeco.current.set(decorations);
      else importDeco.current = editor.createDecorationsCollection(decorations);
    };
    paint();
    const again = setTimeout(paint, 150);
    const sub = monaco.editor.onDidChangeMarkers(paint);
    return () => {
      clearTimeout(again);
      sub.dispose();
    };
  }, [activePath, activeTab?.content]);

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

  // 🧯 सबै खुला फाइलका गल्ती र चेतावनी (फाइल नाम + लाइनसहित) — errors and warnings of every open file, with file name and line.
  useEffect(() => {
    const read = () => {
      const list: Problem[] = [];
      for (const tab of tabs) {
        const model = monaco.editor.getModel(monaco.Uri.parse(tab.path));
        if (!model) continue;
        const seen = new Set<string>();
        const all = monaco.editor.getModelMarkers({ resource: model.uri });
        // टाइपोको सुझाव भएको लाइनमा Dart को लामो URI गल्ती नदोहोर्याउने — skip the analyzer's duplicate URI error on a line with a typo hint
        const typoLines = new Set(
          all
            .filter((m) => m.owner === 'studio-typo')
            .map((m) => m.startLineNumber),
        );
        for (const m of all) {
          if (
            m.owner !== 'studio-typo' &&
            typoLines.has(m.startLineNumber) &&
            /uri/i.test(m.message)
          )
            continue;
          const severity =
            m.severity === monaco.MarkerSeverity.Error
              ? 'error'
              : m.severity === monaco.MarkerSeverity.Warning
                ? 'warning'
                : null;
          if (!severity) continue;
          // एउटै गल्ती दुई जाँचबाट आए एकपटक मात्र — the same problem from two checkers is shown once.
          const key = `${m.startLineNumber}|${m.message.split('\n')[0]}`;
          if (seen.has(key)) continue;
          seen.add(key);
          list.push({
            path: tab.path,
            name: tab.name,
            line: m.startLineNumber,
            column: m.startColumn,
            severity,
            message: m.message.split('\n')[0],
            source: m.source ?? m.owner,
          });
        }
      }
      // गल्ती पहिले, त्यसपछि चेतावनी; फाइल र लाइन क्रममा — errors first, then warnings, by file and line
      list.sort(
        (a, b) =>
          Number(a.severity === 'warning') - Number(b.severity === 'warning') ||
          a.name.localeCompare(b.name) ||
          a.line - b.line,
      );
      setProblems((prev) =>
        JSON.stringify(prev) === JSON.stringify(list) ? prev : list,
      );
    };
    read();
    const sub = monaco.editor.onDidChangeMarkers(read);
    return () => sub.dispose();
  }, [tabs]);

  const jumpToProblem = (p: Problem) => {
    void jumpTo(p.path, p.line, p.column);
  };
  /** F8 जस्तै: अर्को गल्तीमा (फाइल फरक भए त्यही खोलेर) — jump to the next error, opening its file if needed. */
  const jumpToNextError = () => {
    const errors = problems.filter((p) => p.severity === 'error');
    const list = errors.length ? errors : problems;
    if (list.length === 0) {
      showToast(tr('✅ कुनै गल्ती छैन · No errors to jump to'));
      return;
    }
    // अहिलेको कर्सरपछिको पहिलो गल्ती — the first problem after the cursor
    const pos = editorRef.current?.getPosition();
    const here = activePath ?? '';
    let idx = list.findIndex(
      (p) =>
        samePath(p.path, here) &&
        pos &&
        (p.line > pos.lineNumber ||
          (p.line === pos.lineNumber && p.column > pos.column)),
    );
    if (idx < 0)
      idx =
        problemCursor.current + 1 < list.length ? problemCursor.current + 1 : 0;
    problemCursor.current = idx;
    jumpToProblem(list[idx]);
    showToast(
      tr(
        `⛔ गल्ती ${idx + 1}/${list.length} — ${list[idx].name}:${list[idx].line} · Error ${idx + 1} of ${list.length}`,
      ),
    );
  };
  /** 🧑‍🏫 त्यही गल्ती Guru लाई ठीक गर्न दिने — send exactly this problem to Guru to explain and fix. */
  const fixProblemWithGuru = (p: Problem) => {
    const ask = () =>
      setPendingTutor({
        mode: 'fix',
        label: `${tr('🧑‍🏫 Guru सँग ठीक गर · Fix with Guru')}: ${p.name}:${p.line}`,
        prompt: `Fix this ${p.severity} in ${p.name}, line ${p.line}: ${p.message}. Explain it simply, then give the corrected code.`,
        context: getContextRef.current(),
      });
    if (activePath && samePath(activePath, p.path)) {
      jumpToProblem(p);
      ask();
    } else {
      // फाइल खुलेपछि मात्र सन्दर्भ लिने — take the context only once the file is showing
      afterJump.current = ask;
      jumpToProblem(p);
    }
  };

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

  // 🔧 एकै क्लिकमा ठीक गर्ने, सफल भए उही Run फेरि आफैं — one-click fix, then the same Run again on success
  const rerunAfter = useRef<{ runId: number; presetId: string } | null>(null);
  const fixTip = async (tip: FixTip) => {
    if (!project || !tip.fix) return;
    try {
      setConsoleOpen(true);
      interactiveRef.current = false;
      const runId = await window.studio.runFix(
        project.rootPath,
        tip.fix.action,
        tip.fix.pkg,
      );
      rerunAfter.current = presetId ? { runId, presetId } : null;
    } catch (err) {
      showError(errorText(err));
    }
  };

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
      <header className="glass-bar title-bar relative z-20 flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <span className="mr-1 flex items-center gap-1.5 select-none">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-sky-500 via-violet-500 to-fuchsia-500 text-sm shadow-[0_0_18px_rgba(167,139,250,0.55)]">
            🎓
          </span>
          <span className="brand text-[15px]">Studio</span>
        </span>
        {/* ← → पछाडि / अगाडि — Back / Forward */}
        <div className="nav-pair flex items-center rounded-xl p-0.5">
          <button
            className="nav-btn"
            aria-label="Go back"
            disabled={!nav.canBack}
            title={tr('पछाडि जाऊ · Go back (Alt+←)')}
            onClick={nav.back}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M15 5l-7 7 7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            className="nav-btn"
            aria-label="Go forward"
            disabled={!nav.canForward}
            title={tr('अगाडि जाऊ · Go forward (Alt+→)')}
            onClick={nav.forward}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M9 5l7 7-7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
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
        {project && (
          <button
            className="btn-ghost"
            data-testid="tb-search"
            title="Ctrl+Shift+F"
            onClick={openProjectSearch}
          >
            <span aria-hidden="true">🔎</span>{' '}
            <span className="tb-label">{tr('सबैमा खोज · Search all')}</span>
          </button>
        )}
        {activeTab && (
          <div
            className="flex items-center gap-0.5"
            data-testid="edit-tools"
            role="group"
            aria-label="Editor tools"
          >
            <button
              className="btn-ghost"
              data-testid="tb-undo"
              title={tr('पछाडि · Undo (Ctrl+Z)')}
              aria-label="Undo"
              onClick={undoEdit}
            >
              <span aria-hidden="true">↶</span>
            </button>
            <button
              className="btn-ghost"
              data-testid="tb-redo"
              title={tr('अगाडि · Redo (Ctrl+Y)')}
              aria-label="Redo"
              onClick={redoEdit}
            >
              <span aria-hidden="true">↷</span>
            </button>
            <button
              className="btn-ghost"
              data-testid="tb-find"
              title={tr('यो फाइलमा खोज/बदल · Find & Replace (Ctrl+F)')}
              onClick={() => runEditorAction('actions.find')}
            >
              <span aria-hidden="true">🔍</span>{' '}
              <span className="tb-label">{tr('खोज · Find')}</span>
            </button>
            <button
              className="btn-ghost"
              data-testid="tb-format"
              title={tr('कोड मिलाऊ · Format code (Shift+Alt+F)')}
              onClick={() => void formatCode()}
            >
              <span aria-hidden="true">✨</span>{' '}
              <span className="tb-label">{tr('मिलाऊ · Format')}</span>
            </button>
            <button
              className="btn-ghost"
              data-testid="tb-next-error"
              title={tr('अर्को गल्तीमा जाऊ · Jump to next error')}
              onClick={jumpToNextError}
            >
              <span aria-hidden="true">⛔</span>{' '}
              <span className="tb-label">{tr('गल्तीमा जाऊ · Next error')}</span>
              {problems.some((p) => p.severity === 'error') && (
                <span className="ml-1 rounded-full bg-rose-600 px-1.5 text-[10px] text-white">
                  {problems.filter((p) => p.severity === 'error').length}
                </span>
              )}
            </button>
          </div>
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
          className="btn-ghost gear shrink-0"
          title={tr('सेटिङ · Settings')}
          aria-label="Settings"
          onClick={() => setDialog('settings')}
        >
          <span className="inline-block">⚙️</span>
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
                    setTabs((prev) =>
                      prev.map((t) =>
                        t.path === path ? { ...t, content } : t,
                      ),
                    );
                    scheduleDiagnostics(path, content);
                  }}
                  onSave={() => void saveActive()}
                  onEditorReady={(editor) => {
                    editorRef.current = editor;
                    nav.attach(editor);
                  }}
                />
              </div>
              {guruCode.length > 0 && codeOpen && (
                <GuruCodeBox
                  blocks={guruCode}
                  focusIndex={codeFocus}
                  status={stepStatus}
                  unlockedCount={unlockedCount}
                  onUnlock={(i) => setUnlockedExtra((u) => [...u, i])}
                  onClear={() => {
                    setGuruCode([]);
                    setUnlockedExtra([]);
                    setCodeFocus(0);
                  }}
                  onApply={(code) => applyCodeRef.current?.(code)}
                  onNewFile={(p, c) => void saveCodeAsFile(p, c)}
                  onClose={() => setCodeOpen(false)}
                />
              )}
              {guruCode.length > 0 && !codeOpen && (
                <button
                  data-testid="show-code-box"
                  className="border-t border-emerald-700/60 bg-slate-950 px-3 py-1 text-left text-xs font-semibold text-emerald-300 hover:text-emerald-200"
                  onClick={() => setCodeOpen(true)}
                >
                  {tr(
                    `▴ 💻 Guru को कोड देखाऊ (${guruCode.length}) · Show Guru's code`,
                  )}
                </button>
              )}
              {problemsOpen && (
                <ProblemsPanel
                  problems={problems}
                  onJump={jumpToProblem}
                  onFix={fixProblemWithGuru}
                  onClose={() => setProblemsOpen(false)}
                />
              )}
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
                    onAskSelection={askGuruAboutSelection}
                    onHide={() => setConsoleOpen(false)}
                    tips={tips}
                    onOpenTip={(tip) => void openTip(tip)}
                    onAskTip={askGuruAboutTip}
                    onFixTip={(tip) => void fixTip(tip)}
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
                  onAskSelection={askGuruAboutSelection}
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
            onVoiceCommand={handleVoiceCommand}
            onCode={addGuruCode}
            applyRef={applyCodeRef}
            onApplyToFile={(content) => {
              if (!activePath) return;
              setTabs((prev) =>
                prev.map((t) =>
                  t.path === activePath ? { ...t, content } : t,
                ),
              );
              showToast(
                tr(
                  '✅ फाइलमा लगाइयो — Ctrl+Z ले फर्काउँछ, Ctrl+S ले सेभ गर्छ · Applied — Ctrl+Z undoes, Ctrl+S saves',
                ),
              );
              editorRef.current?.focus();
            }}
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

      {/* Status bar: project · save · run · Git/backup */}
      <footer
        data-testid="status-bar"
        className="glass-bar flex items-center gap-3 overflow-hidden border-t px-3 py-0.5 text-[11px] whitespace-nowrap text-slate-400"
      >
        <span
          className="max-w-56 truncate text-slate-200"
          title={project?.rootPath ?? ''}
        >
          {project
            ? `${KIND_LABEL[project.kind]} · ${project.name}`
            : tr('कुनै project खुलेको छैन · No project open')}
        </span>
        {project && (
          <>
            <span
              data-status="save"
              className={dirtyCount > 0 ? 'text-sky-400' : undefined}
            >
              {dirtyCount > 0
                ? tr(`● ${dirtyCount} सेभ बाँकी · unsaved`)
                : lastSavedAt
                  ? tr(
                      `💾 सेभ भयो ${new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · saved`,
                    )
                  : tr('💾 सबै सेभ · all saved')}
            </span>
            <span
              data-status="run"
              className={
                running
                  ? 'text-sky-300'
                  : lastRun?.state === 'fail'
                    ? 'text-rose-400'
                    : lastRun?.state === 'ok'
                      ? 'text-emerald-400'
                      : undefined
              }
            >
              {running
                ? tr('▶ चल्दैछ · running')
                : lastRun?.state === 'ok'
                  ? tr('✅ Run सफल · run OK')
                  : lastRun?.state === 'fail'
                    ? tr('❌ Run मा गल्ती · run failed')
                    : lastRun?.state === 'stopped'
                      ? tr('⏹ Run रोकियो · stopped')
                      : tr('▶ Run गरिएको छैन · not run yet')}
            </span>
            <span
              data-status="git"
              title={
                git.isRepo
                  ? tr(
                      'Git: commit नभएका फाइल र GitHub मा पठाउन बाँकी commit · uncommitted files and unpushed commits',
                    )
                  : ''
              }
              className={
                git.isRepo &&
                git.changed === 0 &&
                git.ahead === 0 &&
                git.hasRemote
                  ? 'text-emerald-400'
                  : git.isRepo
                    ? 'text-sky-300'
                    : undefined
              }
            >
              {!git.isRepo
                ? tr('☁️ Git छैन — backup छैन · no Git, no backup')
                : `🌿 ${git.branch} · ` +
                  (git.changed > 0
                    ? tr(`● ${git.changed} बदलाव · changed`)
                    : tr('✓ सफा · clean')) +
                  (!git.hasRemote
                    ? tr(' · ☁️ GitHub जोडिएको छैन · no remote')
                    : git.ahead > 0
                      ? tr(` · ⬆ ${git.ahead} पठाउन बाँकी · to push`)
                      : git.changed === 0
                        ? tr(' · ☁️ backup भयो · backed up')
                        : '')}
            </span>
          </>
        )}
        <div className="min-w-0 flex-1" />
        {project && (
          <button
            data-testid="problems-toggle"
            title={tr('समस्या सूची खोल/बन्द · Show or hide Problems')}
            onClick={() => setProblemsOpen((o) => !o)}
            className={`rounded px-1.5 hover:bg-slate-700 ${
              problems.some((p) => p.severity === 'error')
                ? 'text-rose-400'
                : problems.length
                  ? 'text-sky-300'
                  : 'text-slate-400'
            }`}
          >
            {tr(
              `⛔ ${problems.filter((p) => p.severity === 'error').length} गल्ती · errors  ⚠ ${problems.filter((p) => p.severity === 'warning').length}`,
            )}
          </button>
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
        <NewFlutterDialog
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
      {dialog === 'search' && project && (
        <SearchDialog
          rootPath={project.rootPath}
          initialQuery={searchSeed}
          memory={searchMemory}
          onRemember={setSearchMemory}
          onClose={() => {
            setDialog(null);
            editorRef.current?.focus();
          }}
          onOpen={(rel, line, column) => {
            setDialog(null);
            const length = searchMemory.regex
              ? undefined
              : searchMemory.query.length || undefined;
            void jumpTo(`${project.rootPath}\\${rel}`, line, column, length);
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
