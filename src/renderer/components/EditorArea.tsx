import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useEffect, useRef } from 'react';

export interface OpenTab {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  language: string;
}

interface Props {
  tabs: OpenTab[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onChange: (path: string, content: string) => void;
  onSave: () => void;
  onEditorReady: (editor: Monaco.editor.IStandaloneCodeEditor) => void;
}

export function EditorArea({
  tabs,
  activePath,
  onSelect,
  onClose,
  onChange,
  onSave,
  onEditorReady,
}: Props) {
  const active = tabs.find((t) => t.path === activePath) ?? null;
  // Monaco को command एकपटक मात्र दर्ता हुन्छ, त्यसैले पछिल्लो onSave ref मा राख्ने।
  // Monaco commands register once, so keep the latest onSave in a ref.
  const saveRef = useRef(onSave);
  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);

  const handleMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      saveRef.current(),
    );
    onEditorReady(editor);
  };

  if (!active) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
        <div className="text-5xl">📝</div>
        <p>बायाँपट्टिबाट फाइल छान्नुहोस्</p>
        <p className="text-sm">Pick a file on the left to start editing</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex overflow-x-auto border-b border-slate-700 bg-slate-900">
        {tabs.map((tab) => {
          const dirty = tab.content !== tab.savedContent;
          const isActive = tab.path === activePath;
          return (
            <div
              key={tab.path}
              title={tab.path}
              onClick={() => onSelect(tab.path)}
              onAuxClick={(e) => e.button === 1 && onClose(tab.path)}
              className={`group flex shrink-0 cursor-pointer items-center gap-2 border-r border-slate-700 px-3 py-1.5 text-sm ${
                isActive
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:bg-slate-800/60'
              }`}
            >
              <span>{tab.name}</span>
              <button
                className="w-4 text-center text-slate-500 hover:text-slate-100"
                title={dirty ? 'सेभ भएको छैन · Unsaved — close' : 'बन्द · Close'}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.path);
                }}
              >
                {dirty ? (
                  <span className="text-amber-400 group-hover:hidden">●</span>
                ) : null}
                <span className={dirty ? 'hidden group-hover:inline' : ''}>
                  ×
                </span>
              </button>
            </div>
          );
        })}
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          theme="vs-dark"
          path={active.path}
          language={active.language}
          value={active.content}
          onChange={(value) => onChange(active.path, value ?? '')}
          onMount={handleMount}
          options={{
            fontSize: 15,
            minimap: { enabled: false },
            automaticLayout: true,
            wordWrap: 'on',
            tabSize: 2,
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: true },
            renderWhitespace: 'boundary',
            smoothScrolling: true,
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  );
}
