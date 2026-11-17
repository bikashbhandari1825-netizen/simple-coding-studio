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
import {
  baseName,
  errorText,
  isProbablyBinary,
  languageFor,
  rememberRecent,
  stripAnsi,
} from './lib/helpers';

type DialogKind = 'newFile' | 'newFolder' | 'newFlutter' | 'settings' | null;

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
        pushLine(
          event.code === 0 || event.stoppedByUser ? 'info' : 'error',
          event.stoppedByUser
            ? '⏹ तपाईंले रोक्नुभयो · Stopped by you'
            : event.code === 0
              ? '✅ सफलतापूर्वक सकियो · Finished successfully'
              : `❌ गल्ती भयो (code ${event.code ?? '?'}) — बुझ्न "Guru लाई सोध" थिच्नुहोस् · Failed; press "Ask Guru" to understand the error`,
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
      `${dirtyCount} फाइल सेभ भएका छैनन्। छोडेर अगाडि बढ्ने? — ${dirtyCount} unsaved file(s). Discard changes?`,
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
      if (!proj) showError('यो फोल्डर भेटिएन — This folder no longer exists.');
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
          'कृपया फाइल होइन, फोल्डर छोड्नुहोस् — Please drop a folder, not a file.',
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
          'यो फाइल कोड होइन (image/binary), editor मा खोल्न मिल्दैन — This is not a text file.',
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
      showToast(`💾 ${tab.name} सेभ भयो · Saved`);
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
        `${tab.name} सेभ भएको छैन। बन्द गर्ने? — Close without saving?`,
      )
    ) {
      return;
    }
    const idx = tabs.findIndex((t) => t.path === path);
    const next = tabs.filter((t) => t.path !== path);
    setTabs(next);
    if (activePath === path)
      setActivePath(next[Math.min(idx, next.length - 1)]?.path ?? null);
  };

  const trash = async (entry: FileEntry) => {
    if (
      !window.confirm(
        `"${entry.name}" लाई Recycle Bin मा पठाउने? — Move "${entry.name}" to the Recycle Bin?`,
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
      showToast('🗑 Recycle Bin मा पठाइयो · Moved to Recycle Bin');
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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveActive]);

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
      showToast('✨ नयाँ Flutter एप तयार भयो! · New Flutter app created!');
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
      label: '🩺 यो output/गल्ती बुझाऊ · Explain this output/error',
      prompt: 'I ran my program. Please explain the output and fix any error.',
      context: getContext(),
    });
  };

  const handlePendingHandled = useCallback(() => setPendingTutor(null), []);

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
      className="flex h-full flex-col bg-slate-900 text-slate-100"
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
      <header className="flex items-center gap-2 border-b border-slate-700 bg-slate-950 px-3 py-2">
        <span className="mr-1 font-bold text-sky-300">🎓 Studio</span>
        <button className="btn-ghost" onClick={() => void openFolder()}>
          📁 खोल · Open
        </button>
        <button className="btn-ghost" onClick={() => setDialog('newFlutter')}>
          ✨ नयाँ एप · New app
        </button>
        {project && (
          <span
            className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300"
            title={project.rootPath}
          >
            {KIND_LABEL[project.kind]} · {project.name}
          </span>
        )}
        <div className="flex-1" />
        {project && presets.length > 0 && (
          <div className="flex items-center gap-1">
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              title={
                currentPreset
                  ? `कमाण्ड · Command: ${currentPreset.commandLine}`
                  : ''
              }
              className="max-w-72 rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none"
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.labelNe} · {p.labelEn}
                </option>
              ))}
            </select>
            <button
              className="btn-run"
              disabled={!presetId}
              onClick={() => void runSelected()}
            >
              ▶ चलाऊ · Run
            </button>
          </div>
        )}
        {activeTab && (
          <button
            className="btn-ghost"
            onClick={() => void saveActive()}
            title="Ctrl+S"
          >
            💾 सेभ · Save
          </button>
        )}
        <AccountMenu account={account} />
        <button
          className="btn-ghost"
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
            <aside className="w-64 shrink-0 border-r border-slate-700 bg-slate-900">
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
                  onChange={(path, content) =>
                    setTabs((prev) =>
                      prev.map((t) =>
                        t.path === path ? { ...t, content } : t,
                      ),
                    )
                  }
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
                  />
                </div>
              ) : (
                <button
                  className="border-t border-slate-700 bg-slate-950 px-3 py-1 text-left text-xs text-slate-400 hover:text-slate-200"
                  onClick={() => setConsoleOpen(true)}
                >
                  ▴ 🖥️ नतिजा देखाऊ · Show output{' '}
                  {running ? '● चल्दैछ · running' : ''}
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
          className="relative shrink-0 border-l border-slate-700"
          style={{ width: guruWidth }}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            title="तानेर चौडाइ बदल्नुहोस् · Drag to resize"
            className="absolute top-0 -left-1 z-20 h-full w-2 cursor-col-resize hover:bg-sky-500/40"
            onPointerDown={startGuruResize}
          />
          <TutorPanel
            account={account}
            getContext={getContext}
            pending={pendingTutor}
            onPendingHandled={handlePendingHandled}
          />
        </aside>
      </div>

      {/* Status bar */}
      <footer className="flex items-center gap-3 border-t border-slate-700 bg-slate-950 px-3 py-0.5 text-[11px] text-slate-400">
        <span>
          {project ? project.rootPath : 'कुनै project खुलेको छैन · No project open'}
        </span>
        <div className="flex-1" />
        {dirtyCount > 0 && (
          <span className="text-amber-400">
            ● {dirtyCount} सेभ बाँकी · unsaved
          </span>
        )}
        {activeTab && <span>{activeTab.language}</span>}
        <span>
          {account.status?.loggedIn
            ? `🧑‍🏫 Guru तयार · ready (${account.status.email ?? 'Claude Code'})`
            : '🧑‍🏫 Guru: Claude Code मा login गर्नुहोस् · sign in to Claude Code'}
        </span>
      </footer>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-sky-900/40 text-2xl font-semibold text-white">
          📂 फोल्डर यहाँ छोड्नुहोस् · Drop the folder here
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-8 left-1/2 z-50 max-w-xl -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-xl ${
            toast.error ? 'bg-rose-700 text-white' : 'bg-emerald-700 text-white'
          }`}
        >
          {toast.text}
        </div>
      )}

      {dialog === 'newFile' && project && (
        <PromptDialog
          title="नयाँ फाइल · New file"
          hint={`फोल्डर · Folder: ${baseName(selectedDir)}`}
          placeholder="main.dart"
          confirmLabel="बनाऊ · Create"
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
          title="नयाँ फोल्डर · New folder"
          hint={`भित्र · Inside: ${baseName(selectedDir)}`}
          placeholder="screens"
          confirmLabel="बनाऊ · Create"
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
          title="✨ नयाँ Flutter एप · New Flutter app"
          hint="नाम सानो अंग्रेजी अक्षरमा, खाली ठाउँको सट्टा _ (जस्तै nepali_quiz)। त्यसपछि project राख्ने फोल्डर छान्नुहोस्। — Lowercase name with _ ; then choose where to save it."
          placeholder="my_first_app"
          confirmLabel="बनाऊ · Create"
          onClose={() => setDialog(null)}
          onSubmit={createFlutter}
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
