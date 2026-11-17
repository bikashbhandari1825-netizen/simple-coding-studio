import Anthropic from '@anthropic-ai/sdk';
import { ipcMain, type WebContents } from 'electron';
import type { AiContext, AiEvent, AiMode, AiRequest } from '../shared/types';
import { CLAUDE_PROFILE, isClaudeConnected } from './claudeLogin';
import { getApiKey, getModel } from './settings';

// API key main process मा मात्र रहन्छ। UI (renderer) ले key कहिल्यै देख्दैन।
// The API key stays in the main process; the UI never sees it.

const MAX_CONTEXT_CHARS = 300_000;

const SYSTEM_PROMPT = `You are "Guru", the built-in coding tutor inside Simple Coding Studio, a beginner-friendly code editor.
The learner is a Nepali speaker who is new to programming and wants to become a real software engineer. Their first target is Flutter/Dart, but help with any language they open.

How to answer:
- Write every explanation twice: first in simple Nepali (Devanagari), then in simple English. Use headings "नेपाली" and "English", or put both in a table when explaining code line by line.
- Keep code, file names, commands and identifiers in English inside backticks or code blocks.
- Be warm but honest, like a strict and caring teacher. If something is wrong, say exactly where (file and line) and why, then show how to fix it.
- Prefer short, concrete answers. Explain the "why", not only the "what".
- Never invent APIs. If unsure, say so.
- The learner runs commands with buttons, not a terminal. When a command is needed, name the button in this app if one fits (for example "Chrome मा चलाऊ / Run in Chrome", "प्याकेजहरू ल्याऊ / Get packages", "APK बनाऊ / Build APK").`;

const MODE_INSTRUCTIONS: Record<AiMode, string> = {
  chat: '',
  explain:
    'Explain the code below for a beginner. Start with one or two sentences on what the whole file or selection does. Then give a line-by-line (or block-by-block for long code) table with columns: Line | Code | नेपाली | English. End with "के सिक्यौं / What we learned" as 2-3 bullet points.',
  fix: 'The learner ran their program and got the output below. Find the real cause of the error. Say which file and line, explain why it happened, and show the corrected code. Explain in Nepali, then English. If there is no error, say so and explain what the output means.',
  blueprint:
    'The learner wants to build the app described below. Do NOT write the full code. Produce a step-by-step roadmap: 1) what the app does, 2) screens/pages, 3) folder and file structure, 4) packages needed and why, 5) numbered build steps from zero, each small enough for one learning session. Bilingual (Nepali, then English). End by asking whether they approve the plan before coding starts.',
};

const active = new Map<string, AbortController>();

function contextBlock(ctx: AiContext | undefined): string {
  if (!ctx) return '';
  const parts: string[] = [];
  if (ctx.projectKind) parts.push(`Project type: ${ctx.projectKind}`);
  if (ctx.fileName) parts.push(`Open file: ${ctx.fileName}`);
  if (ctx.selection)
    parts.push(
      `Selected code:\n\`\`\`${ctx.language ?? ''}\n${ctx.selection}\n\`\`\``,
    );
  else if (ctx.code)
    parts.push(
      `File contents:\n\`\`\`${ctx.language ?? ''}\n${ctx.code}\n\`\`\``,
    );
  if (ctx.runOutput)
    parts.push(`Program output:\n\`\`\`\n${ctx.runOutput}\n\`\`\``);
  return parts.join('\n\n');
}

function send(target: WebContents, event: AiEvent) {
  if (!target.isDestroyed()) target.send('ai:event', event);
}

async function handleAsk(target: WebContents, req: AiRequest) {
  const { requestId } = req;
  // API key भए त्यही, नभए browser login (profile) — Prefer a saved API key, else the browser-login profile.
  const apiKey = getApiKey();
  const connected = !apiKey && isClaudeConnected();
  if (!apiKey && !connected) {
    send(target, {
      requestId,
      type: 'error',
      message:
        'पहिले "Connect with Claude" थिचेर आफ्नो account जोड्नुहोस् — Press "Connect with Claude" first.',
    });
    return;
  }
  if (req.messages.length === 0 || req.messages[0].role !== 'user') {
    send(target, { requestId, type: 'error', message: 'Empty question' });
    return;
  }

  // अन्तिम user सन्देशमा mode निर्देशन र code context थप्ने — Attach mode instructions and code to the last user turn.
  const messages: Anthropic.MessageParam[] = req.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const last = messages[messages.length - 1];
  const extra = [MODE_INSTRUCTIONS[req.mode], contextBlock(req.context)]
    .filter(Boolean)
    .join('\n\n');
  if (last.role === 'user' && extra) {
    last.content = `${String(last.content)}\n\n${extra}`;
  }

  const totalChars = messages.reduce((n, m) => n + String(m.content).length, 0);
  if (totalChars > MAX_CONTEXT_CHARS) {
    send(target, {
      requestId,
      type: 'error',
      message:
        'फाइल धेरै ठूलो भयो। कोडको केही भाग select गरेर फेरि सोध्नुहोस् — The file is too large; select part of the code and ask again.',
    });
    return;
  }

  const model = getModel();
  const controller = new AbortController();
  active.set(requestId, controller);
  const client = apiKey
    ? new Anthropic({ apiKey })
    : new Anthropic({ profile: CLAUDE_PROFILE });

  try {
    // Opus/Sonnet ले कहिलेकाहीं अस्वीकार गरे अर्को model मा आफैं सर्ने (server-side fallback)।
    // On Opus/Sonnet, let the API retry a declined request on its recommended fallback model.
    const supportsFallback = model !== 'claude-haiku-5-5';
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 32000,
        system: SYSTEM_PROMPT,
        messages,
        output_config: { effort: 'medium' },
        ...(supportsFallback
          ? {
              betas: ['server-side-fallback-2026-07-01'],
              fallbacks: 'default' as const,
            }
          : {}),
      },
      { signal: controller.signal },
    );

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        send(target, { requestId, type: 'text', text: event.delta.text });
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      send(target, {
        requestId,
        type: 'error',
        message:
          'AI ले यो प्रश्नको जवाफ दिन मानेन। अर्को तरिकाले सोध्नुहोस् — The AI declined this request; try rephrasing.',
      });
      return;
    }
    if (final.stop_reason === 'max_tokens') {
      send(target, {
        requestId,
        type: 'text',
        text: '\n\n_(जवाफ लामो भएर काटियो — The answer was cut off because it was too long.)_',
      });
    }
    send(target, { requestId, type: 'done' });
  } catch (err) {
    if (controller.signal.aborted) {
      send(target, { requestId, type: 'done' });
      return;
    }
    send(target, { requestId, type: 'error', ...describeError(err) });
  } finally {
    active.delete(requestId);
  }
}

type ErrorKind = 'billing' | 'auth';

function describeError(err: unknown): { message: string; kind?: ErrorKind } {
  const text = err instanceof Error ? err.message : String(err);
  // Credit सकिँदा API ले 400 फर्काउँछ — the API answers 400 when the account is out of credit.
  if (
    err instanceof Anthropic.BadRequestError &&
    /credit balance|billing|purchase credits/i.test(text)
  ) {
    return {
      kind: 'billing',
      message:
        'यो account मा credit (ब्यालेन्स) सकियो। तलको "Account फेर" थिचेर अर्को account जोड्नुहोस्, वा credit थप्नुहोस्। — This account is out of credit. Switch to another account below, or add credits.',
    };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return {
      kind: 'auth',
      message:
        'Login वा API key मिलेन (म्याद सकिएको हुन सक्छ)। फेरि जोड्नुहोस् — The login or API key was rejected (it may have expired). Please reconnect.',
    };
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return {
      kind: 'auth',
      message:
        'यो account ले यो model चलाउन पाउँदैन — This account cannot use this model.',
    };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return {
      message:
        'धेरै छिटो-छिटो सोधियो, एकछिन पर्खेर फेरि प्रयास गर्नुहोस् — Rate limited; wait a moment and try again.',
    };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { message: `अनुरोध मिलेन — Bad request: ${text}` };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return {
      message:
        'Internet जडान भएन — Could not connect. Check your internet connection.',
    };
  }
  if (err instanceof Anthropic.APIError) {
    return {
      message: `AI सेवामा समस्या (${err.status ?? '?'}) — API error: ${text}`,
    };
  }
  // Login profile को token नवीकरण असफल — the saved login could not be refreshed.
  if (/profile|credential|refresh|token/i.test(text)) {
    return {
      kind: 'auth',
      message: `Claude login पुरानो भयो, फेरि जोड्नुहोस् — Your Claude login needs to be renewed. (${text.slice(0, 160)})`,
    };
  }
  return { message: text };
}

export function registerAiHandlers(): void {
  ipcMain.handle('ai:ask', (e, req: AiRequest) => {
    if (
      !req ||
      typeof req.requestId !== 'string' ||
      !Array.isArray(req.messages)
    )
      throw new Error('Invalid request');
    if (!(req.mode in MODE_INSTRUCTIONS)) throw new Error('Invalid mode');
    void handleAsk(e.sender, req);
  });

  ipcMain.handle('ai:cancel', (_e, requestId: string) => {
    active.get(requestId)?.abort();
  });
}
