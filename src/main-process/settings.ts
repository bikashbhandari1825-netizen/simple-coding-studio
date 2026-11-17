import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { AI_MODELS, type AiModelId, type SettingsInfo } from '../shared/types';

// सेटिङ: Guru ले कुन Claude model प्रयोग गर्ने मात्र। API key चाहिँदैन (Claude Code subscription प्रयोग हुन्छ)।
// Settings hold only the Guru model choice; no API key is needed because Claude Code uses the subscription.

interface StoredSettings {
  model?: string;
  /** पुरानो संस्करणको key — a key saved by an older version; removed on load. */
  apiKeyEncrypted?: string;
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
    : 'default';
  return { model };
}

export function getModel(): AiModelId {
  return info().model;
}

export function registerSettingsHandlers(): void {
  // पुरानो संस्करणले राखेको API key अब चाहिँदैन, हटाउने — drop any API key an older version saved.
  const s = load();
  if (s.apiKeyEncrypted) {
    delete s.apiKeyEncrypted;
    save(s);
  }

  ipcMain.handle('settings:get', () => info());

  ipcMain.handle('settings:setModel', (_e, model: unknown) => {
    if (!AI_MODELS.some((m) => m.id === model))
      throw new Error('Unknown model');
    const next = load();
    next.model = model as AiModelId;
    save(next);
    return info(next);
  });
}
