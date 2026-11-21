// Preload: UI (React) र Node/Electron बीचको सुरक्षित पुल।
// Preload: the safe bridge between the UI (React) and Node/Electron.
import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent,
} from 'electron';
import type {
  ClaudeStatus,
  AiEvent,
  DiagEvent,
  DictationEvent,
  RunEvent,
  SpeakerEvent,
  StudioApi,
} from './shared/types';

function subscribe<T>(
  channel: string,
  listener: (event: T) => void,
): () => void {
  const handler = (_e: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: StudioApi = {
  openFolderDialog: () => ipcRenderer.invoke('fs:openFolderDialog'),
  openDroppedFolder: (file) =>
    ipcRenderer.invoke('fs:openDroppedPath', webUtils.getPathForFile(file)),
  openRecentFolder: (folderPath) =>
    ipcRenderer.invoke('fs:openDroppedPath', folderPath),
  readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  listAllFiles: (rootPath) => ipcRenderer.invoke('fs:listAll', rootPath),
  searchInProject: (rootPath, query, opts) =>
    ipcRenderer.invoke('fs:search', rootPath, query, opts),
  diagFormat: (filePath, text) =>
    ipcRenderer.invoke('diag:format', filePath, text),
  writeFile: (filePath, content) =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),
  createFile: (dirPath, name) =>
    ipcRenderer.invoke('fs:createFile', dirPath, name),
  createFolder: (dirPath, name) =>
    ipcRenderer.invoke('fs:createFolder', dirPath, name),
  trashEntry: (entryPath) => ipcRenderer.invoke('fs:trash', entryPath),

  getRunPresets: (rootPath, currentFile) =>
    ipcRenderer.invoke('run:presets', rootPath, currentFile),
  run: (rootPath, presetId, currentFile) =>
    ipcRenderer.invoke('run:start', rootPath, presetId, currentFile),
  sendRunKey: (key) => ipcRenderer.invoke('run:key', key),
  stopRun: () => ipcRenderer.invoke('run:stop'),
  runFix: (rootPath, action, pkg) =>
    ipcRenderer.invoke('run:fix', rootPath, action, pkg),
  createFlutterProject: (name, template) =>
    ipcRenderer.invoke('project:createFlutter', name, template),
  getGitStatus: (rootPath) => ipcRenderer.invoke('project:gitStatus', rootPath),
  onRunEvent: (listener) => subscribe<RunEvent>('run:event', listener),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setModel: (model) => ipcRenderer.invoke('settings:setModel', model),
  askAi: (request) => ipcRenderer.invoke('ai:ask', request),
  cancelAi: (requestId) => ipcRenderer.invoke('ai:cancel', requestId),
  onAiEvent: (listener) => subscribe<AiEvent>('ai:event', listener),

  getClaudeStatus: () => ipcRenderer.invoke('claude:status'),
  claudeLogin: (switchAccount) =>
    ipcRenderer.invoke('claude:login', switchAccount),
  claudeLogout: () => ipcRenderer.invoke('claude:logout'),
  onClaudeStatus: (listener) =>
    subscribe<ClaudeStatus>('claude:status', listener),
  openSoundSettings: () => ipcRenderer.invoke('system:openSoundSettings'),

  diagUpdate: (filePath, text, kind) =>
    ipcRenderer.invoke('diag:update', filePath, text, kind),
  onDiagEvent: (listener) => subscribe<DiagEvent>('diag:event', listener),
  diagComplete: (filePath, text, line, column) =>
    ipcRenderer.invoke('diag:complete', filePath, text, line, column),
  diagCodeActions: (filePath, text, range, diagnostics) =>
    ipcRenderer.invoke('diag:codeActions', filePath, text, range, diagnostics),

  speakerAvailable: () => ipcRenderer.invoke('speaker:available'),
  speakerPrepare: () => ipcRenderer.invoke('speaker:prepare'),
  speak: (id, chunks, rate, gender, engine) =>
    ipcRenderer.invoke('speaker:speak', id, chunks, rate, gender, engine),
  stopSpeaking: () => ipcRenderer.invoke('speaker:stop'),
  onSpeakerEvent: (listener) =>
    subscribe<SpeakerEvent>('speaker:event', listener),

  dictationAvailable: () => ipcRenderer.invoke('dictation:available'),
  dictationPrepare: () => ipcRenderer.invoke('dictation:prepare'),
  dictationStart: (lang) => ipcRenderer.invoke('dictation:start', lang),
  dictationStop: () => ipcRenderer.invoke('dictation:stop'),
  onDictationEvent: (listener) =>
    subscribe<DictationEvent>('dictation:event', listener),
};

contextBridge.exposeInMainWorld('studio', api);
