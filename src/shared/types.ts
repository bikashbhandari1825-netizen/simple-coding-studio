// Main process र UI बीच साझा types — Types shared by the main process and the UI.

/** फोल्डरभित्रको एउटा फाइल वा फोल्डर — One file or folder inside a project. */
export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  /** Symlink/junction (जस्तै Flutter को .plugin_symlinks) — a symlink or junction */
  isSymlink?: boolean;
}

export type ProjectKind =
  | 'flutter'
  | 'dart'
  | 'node'
  | 'python'
  | 'web'
  | 'unknown';

/** खोलिएको project — An opened project folder. */
export interface ProjectInfo {
  rootPath: string;
  name: string;
  kind: ProjectKind;
}

/** एक क्लिकमा चल्ने कमाण्ड — A one-click command (the user never types it). */
export interface RunPreset {
  id: string;
  labelNe: string;
  labelEn: string;
  /** देखाउनका लागि मात्र — Shown in the console, for learning. */
  commandLine: string;
  /** Hot reload जस्ता key पठाउन मिल्छ — Accepts keys like hot reload. */
  interactive: boolean;
}

export type RunEvent =
  | { runId: number; type: 'start'; commandLine: string }
  | { runId: number; type: 'output'; stream: 'stdout' | 'stderr'; data: string }
  | {
      runId: number;
      type: 'exit';
      code: number | null;
      stoppedByUser: boolean;
    };

export type AiMode = 'chat' | 'explain' | 'fix' | 'blueprint' | 'quickfix';

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiContext {
  fileName?: string;
  language?: string;
  code?: string;
  selection?: string;
  runOutput?: string;
  projectKind?: ProjectKind;
}

export interface AiRequest {
  requestId: string;
  mode: AiMode;
  messages: AiChatMessage[];
  context?: AiContext;
  /** Guru ले कुन भाषामा जवाफ दिने — Which language Guru should answer in. */
  answerLang?: 'ne' | 'en' | 'both';
  /** English कति सजिलो (1 सुरुवात … 4 प्राविधिक) — how simple Guru's English should be (1 basic … 4 technical). */
  englishLevel?: 1 | 2 | 3 | 4;
}

export type AiErrorKind = 'auth' | 'limit';

export type AiEvent =
  | { requestId: string; type: 'text'; text: string }
  | { requestId: string; type: 'done' }
  | { requestId: string; type: 'error'; message: string; kind?: AiErrorKind };

/** Claude Code (`claude --model`) का model छनोट — Model choices passed to Claude Code. */
export const AI_MODELS = [
  { id: 'default', label: 'Claude Code को आफ्नै छनोट · Claude Code default' },
  { id: 'opus', label: 'Opus (सबैभन्दा राम्रो · best, uses more of your plan)' },
  { id: 'sonnet', label: 'Sonnet (छिटो र सन्तुलित · fast, balanced)' },
  { id: 'haiku', label: 'Haiku (सबैभन्दा छिटो · fastest)' },
] as const;

export type AiModelId = (typeof AI_MODELS)[number]['id'];

export interface SettingsInfo {
  model: AiModelId;
}

/** Editor मा देखाइने एउटा गल्ती/चेतावनी — one error or warning shown in the editor. */
export interface EditorDiagnostic {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  code?: string;
}

export interface DiagEvent {
  file: string;
  /** 'dart' | 'python' */
  source: string;
  diagnostics: EditorDiagnostic[];
}

/** 🔊 बोलिने एउटा वाक्य — one sentence to speak. */
export interface SpeakChunk {
  text: string;
  lang: 'ne-NP' | 'en-US';
}

/** 🔊 Speaker बाट आउने घटना — events from the speaker (Edge speechSynthesis). */
export interface SpeakerEvent {
  type: 'ready' | 'start' | 'chunk' | 'word' | 'end' | 'error';
  id?: string;
  index?: number;
  charIndex?: number;
  voice?: string;
  stopped?: boolean;
  error?: string;
}

/** ☁️ Cloud dictation बाट आउने घटना — events from cloud dictation (Chrome/Edge speech service). */
export interface DictationEvent {
  type: 'ready' | 'start' | 'interim' | 'final' | 'end' | 'error';
  text?: string;
  error?: string;
}

/** यो computer को Claude Code login अवस्था — Claude Code sign-in state on this computer. */
export interface ClaudeStatus {
  installed: boolean;
  loggedIn: boolean;
  email?: string;
  /** pro, max, … */
  plan?: string;
  authMethod?: string;
}

/** UI ले प्रयोग गर्न पाउने सुरक्षित API — The safe API the UI can call (window.studio). */
export interface StudioApi {
  // Files
  openFolderDialog(): Promise<ProjectInfo | null>;
  openDroppedFolder(file: File): Promise<ProjectInfo | null>;
  /** पहिले खोलेको project फेरि खोल्ने — Reopen a recent project by path. */
  openRecentFolder(folderPath: string): Promise<ProjectInfo | null>;
  readDir(dirPath: string): Promise<FileEntry[]>;
  readFile(filePath: string): Promise<string>;
  /** Ctrl+P "फाइल खोज" का लागि project का सबै फाइल — every file in the project, for Quick Open. */
  listAllFiles(
    rootPath: string,
  ): Promise<{ files: string[]; truncated: boolean }>;
  writeFile(filePath: string, content: string): Promise<void>;
  createFile(dirPath: string, name: string): Promise<string>;
  createFolder(dirPath: string, name: string): Promise<string>;
  /** Recycle Bin मा पठाउँछ (स्थायी रूपमा मेटिँदैन) — Moves to the Recycle Bin. */
  trashEntry(entryPath: string): Promise<void>;

  // Running
  getRunPresets(
    rootPath: string,
    currentFile: string | null,
  ): Promise<RunPreset[]>;
  run(
    rootPath: string,
    presetId: string,
    currentFile: string | null,
  ): Promise<number>;
  sendRunKey(key: 'r' | 'R' | 'q'): Promise<void>;
  stopRun(): Promise<void>;
  /** 🔧 एकै क्लिकको fix (pub get / pub add / pub upgrade) — returns the run id */
  runFix(
    rootPath: string,
    action: 'pubGet' | 'pubAdd' | 'pubUpgrade',
    pkg?: string,
  ): Promise<number>;
  createFlutterProject(name: string): Promise<ProjectInfo | null>;
  onRunEvent(listener: (event: RunEvent) => void): () => void;

  // AI tutor (Claude Code)
  getSettings(): Promise<SettingsInfo>;
  setModel(model: AiModelId): Promise<SettingsInfo>;
  askAi(request: AiRequest): Promise<void>;
  cancelAi(requestId: string): Promise<void>;
  onAiEvent(listener: (event: AiEvent) => void): () => void;

  // Claude account (claude auth)
  getClaudeStatus(): Promise<ClaudeStatus>;
  /** Terminal window खोलेर login (switchAccount: पहिले logout) — Opens a terminal window to log in (logs out first when switching). */
  claudeLogin(switchAccount: boolean): Promise<void>;
  claudeLogout(): Promise<ClaudeStatus>;

  /** Windows को Sound सेटिङ खोल्ने (mic volume) — Open Windows Sound settings (microphone volume). */
  openSoundSettings(): Promise<void>;

  // Live editor errors (Dart analysis server, Python syntax)
  diagUpdate(
    filePath: string,
    text: string,
    kind: 'open' | 'change' | 'close',
  ): Promise<void>;
  onDiagEvent(listener: (event: DiagEvent) => void): () => void;
  /** 💡 Dart IntelliSense सुझाव — Dart completion suggestions at a 1-based position. */
  diagComplete(
    filePath: string,
    text: string,
    line: number,
    column: number,
  ): Promise<CompletionSuggestion[]>;
  /** 🔧 Dart quick fixes for a range (edits to this file only). */
  diagCodeActions(
    filePath: string,
    text: string,
    range: TextRange,
    diagnostics: EditorDiagnostic[],
  ): Promise<QuickFix[]>;

  // 🔊 Speaker (Edge natural voices)
  speakerAvailable(): Promise<boolean>;
  speakerPrepare(): Promise<void>;
  speak(
    id: string,
    chunks: SpeakChunk[],
    rate: number,
    gender: 'female' | 'male',
    /** नेपाली आवाज: Google (Translate जस्तै, पूर्वनिर्धारित) वा Microsoft हेमकला — Nepali voice engine. */
    engine?: 'google' | 'microsoft',
  ): Promise<void>;
  stopSpeaking(): Promise<void>;
  onSpeakerEvent(listener: (event: SpeakerEvent) => void): () => void;

  // ☁️ Cloud dictation (Chrome/Edge)
  dictationAvailable(): Promise<boolean>;
  dictationPrepare(): Promise<void>;
  dictationStart(lang: 'ne-NP' | 'en-US'): Promise<void>;
  dictationStop(): Promise<void>;
  onDictationEvent(listener: (event: DictationEvent) => void): () => void;
}

declare global {
  interface Window {
    studio: StudioApi;
  }
}

/** 1-based दायरा — a 1-based text range. */
export interface TextRange {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface CompletionSuggestion {
  label: string;
  /** LSP CompletionItemKind (1–25) */
  kind: number;
  detail?: string;
  documentation?: string;
  insertText: string;
  isSnippet: boolean;
  sortText?: string;
  filterText?: string;
}

export interface QuickFix {
  title: string;
  preferred: boolean;
  edits: (TextRange & { text: string })[];
}
