import { app, ipcMain, type WebContents } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AiContext,
  AiErrorKind,
  AiEvent,
  AiMode,
  AiRequest,
} from '../shared/types';
import { claudeEnv, findClaude, killTree, trackGuruChild } from './claudeCode';
import { getModel } from './settings';

// Guru ले `claude -p` (Claude Code) चलाएर जवाफ ल्याउँछ — तपाईंको Claude subscription बाटै, API key बिना।
// Guru answers by running `claude -p` (Claude Code) with the user's own subscription, no API key.

const MAX_CONTEXT_CHARS = 300_000;

const SYSTEM_PROMPT = `You are "Guru", the built-in coding tutor inside Simple Coding Studio, a beginner-friendly code editor.
The learner is a Nepali speaker who is new to programming and wants to become a real software engineer. Their first target is Flutter/Dart, but help with any language they open.

How to answer:
- Write every explanation twice, briefly: first in simple Nepali (Devanagari), then in simple English. Use headings "नेपाली" and "English", or put both in a table when explaining code line by line.
- Keep code, file names, commands and identifiers in English inside backticks or code blocks.
- Always write Nepali in Devanagari script (नेपाली), never in romanized form like "ke garcha" — also inside quiz, challenge and result JSON.
- Be warm but honest, like a strict and caring teacher. If something is wrong, say exactly where (file and line) and why, then show how to fix it.
- SHORT AND DIRECT (top priority, strict budget — the learner has limited usage): lead with the code or the fix, then only essential notes. Explanation text (not counting code) is at most about 60 words (about 3 one-line bullets) unless the learner explicitly asks for more detail. No greetings, no intro, no recap, no filler, no "let me know if…". One sentence for the "why", never an essay. Prefer the smallest change that works and show only the changed code (with one unchanged line of context above and below) instead of re-printing a whole file, unless the learner asks for the whole file.
- NO REPEATS: never explain again something already explained earlier in this conversation (the same code, line, word, concept or error). Instead say in one line "माथि बुझाइसकेँ · explained above" and only cover what is new. Do not repeat the question back.
- Never invent APIs. If unsure, say so.
- REAL CODE ONLY (strict): every piece of code you give must be real, complete and runnable — the kind used in real production Flutter/Dart and Python apps. Use correct imports, sound null safety, typed models, const constructors, small reusable widgets/functions, async/await with proper error handling (try/catch, mounted checks, timeouts), and current stable APIs and real packages from pub.dev / PyPI. Never give dummy, placeholder or pretend code: no "// your code here", no fake services, no pseudo-code, no TODOs left for the learner unless it is an explicit exercise. If something needs a real setup (an API key, Firebase config, a permission), use the real package and say exactly what to configure. Stay beginner-friendly by keeping each step small, not by making the code fake.
- LEARNING LOOP (always on when you teach with code): give the code in small steps (one file or one part at a time). For each step say exactly which file to create or open in this editor and where to paste it, then the compact code breakdown, then end with ONE quick check question as a fenced code block with the language tag quiz containing ONLY this JSON: {"topic": "...", "questions": [{"q": "...", "options": ["...", "...", "..."], "answer": <0-based index>, "why": "..."}]}. Finish with one line saying what the next step will be, so the learner continues after answering.
- REAL-TIME ERROR FIXING: whenever there is an error (from the editor, the analyzer or a run), always include "❓ किन आयो / Why it happened" (the real root cause in simple words, with file and line) and "✅ सही समाधान / Real fix" (the exact corrected code or the exact button/command), in Nepali and simple English. Never hide an error with a hack (no ignoring the error, no "!" just to silence null safety, no empty catch).
- You have no tools in this app: answer from the code and output the learner shares.
- CODE BREAKDOWN (compact; only when the learner pressed Explain / asked to understand code, never for fixes or generated code): when explaining code, add "🔍 कोडको व्याख्या / Code breakdown" right after it:
  1. A table "Line | Code | नेपाली | English" with one row per meaningful line or small block (skip lone brackets and blank lines); each cell at most about 8 words.
  2. "🔤 शब्द-शब्द / Word by word": only keywords/symbols the learner has NOT seen explained earlier in this conversation; one short line each. Omit the section if nothing is new.
  3. "⚙️ कसरी चल्छ / How it runs": one sentence.
  Skip the whole breakdown for code you already explained, or for a one-line change (then just say what changed in one line). For generated code or fixes, give at most 3 short bullets instead of the table.
- The learner runs commands with buttons, not a terminal. When a command is needed, name the button in this app if one fits (for example "Chrome मा चलाऊ / Run in Chrome", "प्याकेजहरू ल्याऊ / Get packages", "APK बनाऊ / Build APK").
- Quiz: when you asked quiz questions and the learner replies, treat the reply as their answers (they may have spoken them, so ignore small speech-to-text spelling mistakes). For each question say "✅ सही / Correct" or "❌ अलि मिलेन / Not quite", explain the right answer in one or two simple sentences, then give a short score like "२/२ 🎉". Encourage them warmly.`;

// 🔧 AI Quick Fix: editor मा सिधै राख्ने सच्याइएको कोड मात्र — corrected code only, inserted straight into the editor.
const QUICKFIX_SYSTEM_PROMPT = `You fix code inside a code editor. You receive numbered lines from a file and the errors on them.
Return ONLY the corrected replacement for exactly the line range you are given, inside ONE fenced code block, with the same indentation style.
Keep every line that is already correct. Do not add explanations, comments about the fix, or any text outside the code block.
If a name looks like a typo or unfinished word (for example "nn n" or "prnt"), replace it with the most likely intended code.
The fix must be real, production-quality code: correct types and null safety, no placeholders, and never silence an error with a hack (no "!" just to hide a null error, no empty catch, no ignore comments).`;

const MODE_INSTRUCTIONS: Record<AiMode, string> = {
  quickfix: '',
  chat: '',
  explain:
    'Explain the code below for a beginner. Start with one or two sentences on what the whole file or selection does. Then follow the MANDATORY code explanation rule: a table covering every line (Line | Code | नेपाली | English), then word by word for every keyword and symbol, then how it runs. End with "के सिक्यौं / What we learned" as 2-3 bullet points.',
  fix: 'The learner ran their program and got the output below. Find the real cause of the error. Say which file and line, explain why it happened, and show the corrected code. Explain in Nepali, then English. If there is no error, say so and explain what the output means.',
  blueprint:
    'The learner wants to build the app described below. Do NOT write the full code. Produce a step-by-step roadmap: 1) what the app does, 2) screens/pages, 3) folder and file structure, 4) packages needed and why, 5) numbered build steps from zero, each small enough for one learning session. Bilingual (Nepali, then English). End by asking whether they approve the plan before coding starts.',
};

const active = new Map<string, ChildProcess>();

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

function fail(
  target: WebContents,
  requestId: string,
  message: string,
  kind?: AiErrorKind,
) {
  send(target, { requestId, type: 'error', message, kind });
}

// 📈 Progressive English: लेभल अनुसार Guru को English कति सजिलो हुने।
// Progressive English: how simple Guru's English must be at each level.
const ENGLISH_LEVELS: Record<1 | 2 | 3 | 4, string> = {
  1: 'English level 1 (very basic, CEFR A1): in every English part use very short sentences (at most 8 words), only very common everyday words, and present tense. Example style: "This line shows text on the screen." No idioms or long words. When a technical word is needed, keep it and write its Nepali meaning in brackets the first time.',
  2: 'English level 2 (easy, CEFR A2): in every English part use short sentences (at most 12 words) and common words. Use at most three new technical words per answer, each with a short Nepali meaning in brackets the first time.',
  3: 'English level 3 (normal, CEFR B1): in every English part use clear, everyday English with normal programming terms. Explain only uncommon terms.',
  4: 'English level 4 (technical, CEFR B2): in every English part use natural professional software-engineering English, like good documentation.',
};

/** इतिहास र नयाँ प्रश्नलाई एउटै prompt मा राख्ने — Fold the history and the new question into one prompt. */
function buildPrompt(req: AiRequest): string {
  const history = req.messages.slice(0, -1);
  const last = req.messages[req.messages.length - 1];
  const extra = [MODE_INSTRUCTIONS[req.mode], contextBlock(req.context)]
    .filter(Boolean)
    .join('\n\n');
  const parts: string[] = [];
  if (history.length) {
    parts.push(
      'Earlier conversation with the learner (for context):\n' +
        history
          .map(
            (m) => `[${m.role === 'user' ? 'Learner' : 'Guru'}]: ${m.content}`,
          )
          .join('\n\n'),
    );
  }
  parts.push(`The learner's new message:\n${last.content}`);
  if (extra) parts.push(extra);
  if (req.answerLang === 'ne') {
    parts.push(
      'Answer language: write the whole answer in simple Nepali (Devanagari) only. Keep code, file names and technical terms in English. Do not add an English section.',
    );
  } else if (req.answerLang === 'en') {
    parts.push(
      'Answer language: write the whole answer in simple English only. Do not add a Nepali section.',
    );
  }
  const level = req.englishLevel ?? 1;
  if (req.mode === 'quickfix') return parts.join('\n\n---\n\n');
  if (req.answerLang !== 'ne') {
    parts.push(
      ENGLISH_LEVELS[level] +
        (level < 4
          ? ' At the very end add "📚 नयाँ English शब्द / New English words": 2 to 4 useful English words from this answer, each as "word — नेपाली अर्थ — one tiny example sentence", chosen to be just a little above this level so the learner grows.'
          : ''),
    );
  }
  return parts.join('\n\n---\n\n');
}

function guruCwd(): string {
  // कुनै project बाहिरको खाली फोल्डर, ताकि Claude Code ले अरू CLAUDE.md नपढोस्।
  // An empty folder outside any project so Claude Code picks up no project CLAUDE.md.
  const dir = path.join(app.getPath('userData'), 'guru-session');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function classify(text: string): AiErrorKind | undefined {
  if (
    /not logged in|\/login|please log in|logged out|oauth|authentication|invalid api key|unauthorized|\b401\b/i.test(
      text,
    )
  ) {
    return 'auth';
  }
  if (
    /usage limit|rate limit|limit reached|5-hour|weekly limit|resets? (at|in)/i.test(
      text,
    )
  )
    return 'limit';
  return undefined;
}

function friendly(kind: AiErrorKind | undefined, detail: string): string {
  if (kind === 'auth') {
    return `Claude Code मा login छैन वा पुरानो भयो। "Login / Switch Account" थिच्नुहोस्। — Claude Code is not signed in; press "Login / Switch Account". (${detail.slice(0, 200)})`;
  }
  if (kind === 'limit') {
    return `तपाईंको Claude subscription को usage limit पुग्यो। केही समयपछि फेरि प्रयास गर्नुहोस्, वा अर्को account मा switch गर्नुहोस्। — Your Claude plan's usage limit was reached; try again later or switch account. (${detail.slice(0, 200)})`;
  }
  return `Guru ले जवाफ दिन सकेन — Guru could not answer: ${detail.slice(0, 400)}`;
}

interface StreamLine {
  type?: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
  is_error?: boolean;
  result?: string;
  subtype?: string;
  rate_limit_info?: { status?: string; resetsAt?: number };
}

function handleAsk(target: WebContents, req: AiRequest) {
  const { requestId } = req;
  const claude = findClaude();
  if (!claude) {
    fail(
      target,
      requestId,
      'Claude Code (claude) यो computer मा भेटिएन। पहिले Claude Code install गर्नुहोस्। — Claude Code is not installed on this computer.',
      'auth',
    );
    return;
  }
  if (
    req.messages.length === 0 ||
    req.messages[req.messages.length - 1].role !== 'user'
  ) {
    fail(target, requestId, 'Empty question');
    return;
  }
  const prompt = buildPrompt(req);
  if (prompt.length > MAX_CONTEXT_CHARS) {
    fail(
      target,
      requestId,
      'फाइल धेरै ठूलो भयो। कोडको केही भाग select गरेर फेरि सोध्नुहोस् — The file is too large; select part of the code and ask again.',
    );
    return;
  }

  const model = getModel();
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--tools',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--system-prompt',
    req.mode === 'quickfix' ? QUICKFIX_SYSTEM_PROMPT : SYSTEM_PROMPT,
    ...(model === 'default' ? [] : ['--model', model]),
  ];
  const child = spawn(claude, args, {
    cwd: guruCwd(),
    env: claudeEnv(),
    windowsHide: true,
  });
  active.set(requestId, child);
  trackGuruChild(child);

  let buffer = '';
  let stderr = '';
  let gotText = false;
  let finished = false;
  let limitInfo = '';

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let msg: StreamLine;
    try {
      msg = JSON.parse(line) as StreamLine;
    } catch {
      return;
    }
    if (
      msg.type === 'stream_event' &&
      msg.event?.type === 'content_block_delta' &&
      msg.event.delta?.type === 'text_delta'
    ) {
      gotText = true;
      send(target, {
        requestId,
        type: 'text',
        text: msg.event.delta.text ?? '',
      });
    } else if (
      msg.type === 'rate_limit_event' &&
      msg.rate_limit_info?.status === 'rejected'
    ) {
      const at = msg.rate_limit_info.resetsAt
        ? new Date(msg.rate_limit_info.resetsAt * 1000).toLocaleString()
        : '';
      limitInfo = at ? `resets ${at}` : 'limit reached';
    } else if (msg.type === 'result') {
      finished = true;
      if (msg.is_error || (msg.subtype && msg.subtype !== 'success')) {
        const detail = msg.result || msg.subtype || 'unknown error';
        const kind = limitInfo ? 'limit' : classify(detail);
        fail(target, requestId, friendly(kind, limitInfo || detail), kind);
      } else {
        // Stream नआएको अवस्थामा पूरा जवाफ एकैचोटि पठाउने — fall back to the full result if nothing streamed.
        if (!gotText && msg.result)
          send(target, { requestId, type: 'text', text: msg.result });
        send(target, { requestId, type: 'done' });
      }
    }
  };

  child.stdout?.on('data', (d: Buffer) => {
    buffer += d.toString('utf8');
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');
    }
  });
  child.stderr?.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
  child.on('error', (err) => {
    finished = true;
    active.delete(requestId);
    fail(target, requestId, friendly(undefined, err.message));
  });
  child.on('close', (code) => {
    handleLine(buffer);
    const cancelled = !active.has(requestId);
    active.delete(requestId);
    if (finished) return;
    if (cancelled) {
      send(target, { requestId, type: 'done' });
      return;
    }
    const detail = stderr.trim() || `claude exited with code ${code}`;
    const kind = classify(detail);
    fail(target, requestId, friendly(kind, detail), kind);
  });

  child.stdin?.end(prompt, 'utf8');
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
    handleAsk(e.sender, req);
  });

  ipcMain.handle('ai:cancel', (_e, requestId: string) => {
    const child = active.get(requestId);
    if (!child) return;
    active.delete(requestId);
    killTree(child);
  });
}
