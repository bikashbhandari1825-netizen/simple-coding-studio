import { app, ipcMain, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { AI_MODELS, type AiModelId, type SettingsInfo } from '../shared/types';

// API key Windows को आफ्नै encryption (DPAPI) ले बन्द गरेर राखिन्छ, plain text मा होइन।
// The API key is encrypted with the OS keystore (DPAPI on Windows), never stored as plain text.

interface StoredSettings {
  apiKeyEncrypted?: string;
  model?: AiModelId;
}

const file = () => path.join(app.getPath('userData'), 'settings.json');

function load(): StoredSettings {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8')) as StoredSettings;
  } catch {
    return {};
  }
}

function save(settings: StoredSettings) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(settings, null, 2), 'utf8');
}

function info(s: StoredSettings = load()): SettingsInfo {
  const model = AI_MODELS.some((m) => m.id === s.model)
    ? (s.model as AiModelId)
    : 'claude-opus-5-5';
  return { hasApiKey: Boolean(s.apiKeyEncrypted), model };
}

export function getApiKey(): string | null {
  const s = load();
  if (!s.apiKeyEncrypted || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(s.apiKeyEncrypted, 'base64'));
  } catch {
    return null;
  }
}

export function getModel(): AiModelId {
  return info().model;
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', () => info());

  ipcMain.handle('settings:saveKey', (_e, apiKey: unknown) => {
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!key.startsWith('sk-ant-')) {
      throw new Error(
        'यो Claude API key जस्तो देखिएन (sk-ant- बाट सुरु हुनुपर्छ) — This does not look like a Claude API key.',
      );
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'यो computer मा सुरक्षित भण्डारण उपलब्ध छैन — Secure storage is not available on this computer.',
      );
    }
    const s = load();
    s.apiKeyEncrypted = safeStorage.encryptString(key).toString('base64');
    save(s);
    return info(s);
  });

  ipcMain.handle('settings:clearKey', () => {
    const s = load();
    delete s.apiKeyEncrypted;
    save(s);
    return info(s);
  });

  ipcMain.handle('settings:setModel', (_e, model: unknown) => {
    if (!AI_MODELS.some((m) => m.id === model))
      throw new Error('Unknown model');
    const s = load();
    s.model = model as AiModelId;
    save(s);
    return info(s);
  });
}
