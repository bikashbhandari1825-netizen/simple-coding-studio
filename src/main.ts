import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerAiHandlers } from './main-process/ai';
import { registerFileSystemHandlers } from './main-process/fileSystem';
import { registerRunnerHandlers, stopCurrentRun } from './main-process/runner';
import { registerSettingsHandlers } from './main-process/settings';
import {
  registerClaudeLoginHandlers,
  stopClaudeLogin,
} from './main-process/claudeLogin';

// Windows installer ले shortcut बनाउँदा/हटाउँदा एप तुरुन्तै बन्द गर्ने।
// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
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
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
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
  registerFileSystemHandlers();
  registerRunnerHandlers();
  registerSettingsHandlers();
  registerAiHandlers();
  registerClaudeLoginHandlers();
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
  stopClaudeLogin();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
