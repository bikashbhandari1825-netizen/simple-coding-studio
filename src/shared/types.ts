// Main process र UI बीच साझा types — Types shared by the main process and the UI.

/** फोल्डरभित्रको एउटा फाइल वा फोल्डर — One file or folder inside a project. */
export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
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

export type AiMode = 'chat' | 'explain' | 'fix' | 'blueprint';

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
}

export type AiEvent =
  | { requestId: string; type: 'text'; text: string }
  | { requestId: string; type: 'done' }
  | { requestId: string; type: 'error'; message: string };

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (सबैभन्दा राम्रो · best)' },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5 (छिटो, सस्तो · faster, cheaper)',
  },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (धेरै सस्तो · cheapest)' },
] as const;

export type AiModelId = (typeof AI_MODELS)[number]['id'];

export interface ClaudeLoginProgress {
  stage: 'idle' | 'installing' | 'waiting' | 'done';
  message: string;
}

export interface SettingsInfo {
  hasApiKey: boolean;
  /** Browser बाट Claude account जोडिएको छ — Connected through the browser login. */
  claudeConnected: boolean;
  model: AiModelId;
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
  createFlutterProject(name: string): Promise<ProjectInfo | null>;
  onRunEvent(listener: (event: RunEvent) => void): () => void;

  // AI tutor
  getSettings(): Promise<SettingsInfo>;
  saveApiKey(apiKey: string): Promise<SettingsInfo>;
  clearApiKey(): Promise<SettingsInfo>;
  setModel(model: AiModelId): Promise<SettingsInfo>;
  askAi(request: AiRequest): Promise<void>;
  cancelAi(requestId: string): Promise<void>;
  onAiEvent(listener: (event: AiEvent) => void): () => void;

  // Connect with Claude (browser login)
  connectClaude(): Promise<boolean>;
  cancelClaudeLogin(): Promise<void>;
  disconnectClaude(): Promise<boolean>;
  getClaudeStatus(): Promise<string>;
  onClaudeProgress(
    listener: (progress: ClaudeLoginProgress) => void,
  ): () => void;
}

declare global {
  interface Window {
    studio: StudioApi;
  }
}
