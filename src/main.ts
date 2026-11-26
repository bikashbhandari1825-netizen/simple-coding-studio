import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import os from 'node:os';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerAiHandlers } from './main-process/ai';
import { registerFileSystemHandlers } from './main-process/fileSystem';
import { registerRunnerHandlers, stopCurrentRun } from './main-process/runner';
import { registerSettingsHandlers } from './main-process/settings';
import {
  registerClaudeCodeHandlers,
  stopAuthWatch,
  stopGuruChildren,
} from './main-process/claudeCode';
import {
  registerCloudDictationHandlers,
  stopCloudDictation,
} from './main-process/cloudDictation';
import {
  registerDiagnosticsHandlers,
  stopDiagnostics,
} from './main-process/diagnostics';
import { registerGitStatusHandlers } from './main-process/gitStatus';
import { registerSpeakerHandlers, stopSpeaker } from './main-process/speaker';
import {
  fixedUserDataDir,
  hasUserDataArg,
  migrateOldData,
} from './main-process/profilePath';

// Windows installer ले shortcut बनाउँदा/हटाउँदा एप तुरुन्तै बन्द गर्ने।
// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// 💾 डेटा (Guru च्याट, कोड, सेटिङ) सधैं एउटै फोल्डरमा: Claude जस्ता sandbox एपले चलाउँदा %APPDATA% अर्कै हुन्थ्यो र डेटा दुई ठाउँमा बाँडिन्थ्यो।
// Keep the data in one folder: when a sandboxed app started this app, %APPDATA% was a different place and the data got split in two.
// परीक्षणमा --user-data-dir दिइन्छ, त्यसलाई छुँदैनौँ। — Tests pass --user-data-dir; that is left alone.
if (
  !started &&
  !hasUserDataArg(process.argv) &&
  (app.isPackaged || process.env.SCS_DATA_DIR)
) {
  const dataDir = fixedUserDataDir(os.homedir(), process.env);
  try {
    // पहिलो पटक: पुरानो ठाउँको डेटा सार्ने — first time: bring the data over from the old place
    migrateOldData(app.getPath('userData'), dataDir);
  } catch (err) {
    console.error('[data] could not copy the old data', err);
  }
  app.setPath('userData', dataDir);
  app.setPath('sessionData', dataDir);
}

// एउटै समयमा एउटा मात्र Studio: दोस्रो पटक खोल्दा पहिलेकै window अगाडि ल्याउने।
// One Studio at a time: launching it again just brings the existing window forward.
if (!started && !app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
}

const isDev = Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL);

// Development मा मात्र: स्वचालित परीक्षणका लागि debug port खोल्ने।
// Development only: open a debug port so automated tests can drive the UI.
if (isDev && process.env.STUDIO_DEBUG_PORT) {
  app.commandLine.appendSwitch(
    'remote-debugging-port',
    process.env.STUDIO_DEBUG_PORT,
  );
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: 'Simple Coding Studio',
    backgroundColor: '#0a1024',
    autoHideMenuBar: true,
    // सेतो Windows title bar हटाएर app कै रङको बनाउने: toolbar नै title bar बन्छ,
    // र दायाँका − ☐ ✕ बटन app को रङमा।
    // Replace the white Windows title bar: the app's toolbar becomes the title bar and the
    // − ☐ ✕ window buttons are drawn in the app's colours.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0b1225',
      symbolColor: '#cbd5e1',
      height: 48,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // फाइल drop गर्दा window ले अर्को page मा navigate नगरोस्।
  // Stop the window navigating away when something is dropped on it.
  // उही page reload (Vite) गर्न दिने — still allow reloading the same page (Vite dev reloads).
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });

  // AI जवाफका https लिंकहरू आफ्नै browser मा खोल्ने, एपभित्र नयाँ window नखोल्ने।
  // Open https links (e.g. from AI answers) in the system browser, never in a new app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (isDev) {
    // DevTools चाहिएमा मात्र: STUDIO_DEVTOOLS=1 — open DevTools only when asked, so beginners see a clean app.
    if (process.env.STUDIO_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    // UI का console सन्देशहरू terminal मा पनि देखाउने (गल्ती खोज्न सजिलो)।
    // Mirror UI console messages to the terminal, to make debugging easier.
    mainWindow.webContents.on('console-message', ({ level, message }) => {
      console.log('[UI ' + level + '] ' + message);
    });
    mainWindow.webContents.on('preload-error', (_e, p, err) =>
      console.error('[preload-error]', p, err),
    );
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) =>
      console.error('[load-failed]', code, desc, url),
    );
  }
};

app.whenReady().then(() => {
  // Mic को volume मिलाउन Windows Sound सेटिङ खोल्ने (यही एउटा ठेगाना मात्र) — open Windows Sound settings; only this fixed URI.
  ipcMain.handle('system:openSoundSettings', () =>
    shell.openExternal(
      process.platform === 'win32' ? 'ms-settings:sound' : 'about:blank',
    ),
  );
  // 🎤 Voice का लागि microphone (audio मात्र) अनुमति; camera र अरू सबै अस्वीकार।
  // Allow the microphone (audio only) for voice input; deny camera and everything else.
  session.defaultSession.setPermissionRequestHandler(
    (_wc, permission, callback, details) => {
      const mediaTypes =
        'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
      callback(
        permission === 'media' &&
          mediaTypes.length > 0 &&
          mediaTypes.every((t) => t === 'audio'),
      );
    },
  );
  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission) => permission === 'media',
  );
  registerFileSystemHandlers();
  registerRunnerHandlers();
  registerSettingsHandlers();
  registerAiHandlers();
  registerClaudeCodeHandlers();
  registerCloudDictationHandlers();
  registerDiagnosticsHandlers();
  registerSpeakerHandlers();
  registerGitStatusHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// एप बन्द हुँदा चलिरहेको flutter/npm process पनि बन्द गर्ने।
// Stop any running flutter/npm process when the app quits.
app.on('before-quit', () => {
  stopCurrentRun();
  stopGuruChildren();
  stopAuthWatch();
  stopCloudDictation();
  stopDiagnostics();
  stopSpeaker();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
