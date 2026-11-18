import { ipcMain, type WebContents } from 'electron';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { EditorDiagnostic } from '../shared/types';
import { assertInsideProject } from './fileSystem';

// Editor मा टाइप गर्दै गर्दा गल्ती पत्ता लगाउने (VS Code जस्तै):
// - Dart/Flutter: Flutter सँगै आउने Dart analysis server (Language Server Protocol)
// - Python: python आफैंले syntax जाँच
//
// Live error checking while typing (like VS Code):
// - Dart/Flutter: the Dart analysis server that ships with Flutter (Language Server Protocol)
// - Python: a syntax check by Python itself

let target: WebContents | null = null;

function send(file: string, source: string, diagnostics: EditorDiagnostic[]) {
  if (target && !target.isDestroyed())
    target.send('diag:event', { file, source, diagnostics });
}

// ---------------------------------------------------------------- Dart

function findDart(): string | null {
  const candidates: string[] = [];
  const finder = spawnSync('where', ['flutter'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  for (const line of finder.status === 0 ? finder.stdout.split(/\r?\n/) : []) {
    if (line.trim())
      candidates.push(
        path.join(
          path.dirname(line.trim()),
          'cache',
          'dart-sdk',
          'bin',
          'dart.exe',
        ),
      );
  }
  const dartWhere = spawnSync('where', ['dart'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  for (const line of dartWhere.status === 0
    ? dartWhere.stdout.split(/\r?\n/)
    : []) {
    const l = line.trim();
    if (!l) continue;
    candidates.push(
      l.toLowerCase().endsWith('.exe')
        ? l
        : path.join(path.dirname(l), 'cache', 'dart-sdk', 'bin', 'dart.exe'),
    );
  }
  candidates.push('C:\\flutter\\bin\\cache\\dart-sdk\\bin\\dart.exe');
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/** pubspec.yaml भएको सबैभन्दा नजिकको फोल्डर — the nearest folder with a pubspec.yaml. */
function dartRoot(file: string): string {
  let dir = path.dirname(file);
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'pubspec.yaml'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.dirname(file);
}

class DartServer {
  private proc: ChildProcess;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private ready: Promise<void>;
  private versions = new Map<string, number>();

  constructor(
    dart: string,
    readonly root: string,
  ) {
    this.proc = spawn(
      dart,
      [
        'language-server',
        '--protocol=lsp',
        '--client-id=simple-coding-studio',
        '--client-version=1.0',
      ],
      {
        cwd: root,
        windowsHide: true,
      },
    );
    this.proc.stdout?.on('data', (d: Buffer) => this.onData(d));
    this.proc.on('exit', () => dartServers.delete(this.root));
    const rootUri = pathToFileURL(root).href;
    this.ready = this.request('initialize', {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: path.basename(root) }],
      capabilities: {
        textDocument: {
          publishDiagnostics: { relatedInformation: false },
          completion: {
            completionItem: {
              snippetSupport: true,
              documentationFormat: ['plaintext', 'markdown'],
            },
          },
          codeAction: {
            codeActionLiteralSupport: {
              codeActionKind: { valueSet: ['quickfix', 'refactor', 'source'] },
            },
          },
        },
        workspace: { configuration: true },
      },
      initializationOptions: {
        onlyAnalyzeProjectsWithOpenFiles: true,
        // import नगरिएका हजारौँ सुझाव नल्याउने (छिटो) — skip thousands of not-yet-imported suggestions (faster)
        suggestFromUnimportedLibraries: false,
      },
    }).then(() => this.notify('initialized', {}));
  }

  private write(msg: object) {
    const body = Buffer.from(
      JSON.stringify({ jsonrpc: '2.0', ...msg }),
      'utf8',
    );
    this.proc.stdin?.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.proc.stdin?.write(body);
  }

  private pending = new Map<number, (v: unknown) => void>();
  private request(
    method: string,
    params: object,
    timeoutMs = 0,
  ): Promise<unknown> {
    const id = this.nextId++;
    this.write({ id, method, params });
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      if (timeoutMs)
        setTimeout(() => {
          if (this.pending.delete(id)) resolve(null);
        }, timeoutMs);
    });
  }
  private notify(method: string, params: object) {
    this.write({ method, params });
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const len = Number(header.match(/Content-Length: (\d+)/i)?.[1] ?? 0);
      if (this.buffer.length < headerEnd + 4 + len) return;
      const body = this.buffer
        .subarray(headerEnd + 4, headerEnd + 4 + len)
        .toString('utf8');
      this.buffer = this.buffer.subarray(headerEnd + 4 + len);
      try {
        this.onMessage(JSON.parse(body));
      } catch {
        // ignore malformed
      }
    }
  }

  private onMessage(msg: {
    id?: number;
    method?: string;
    params?: unknown;
    result?: unknown;
  }) {
    if (msg.id !== undefined && !msg.method) {
      this.pending.get(msg.id)?.(msg.result);
      this.pending.delete(msg.id);
      return;
    }
    if (msg.id !== undefined && msg.method) {
      // Server का प्रश्नहरूको साधारण जवाफ — answer server requests with empty results.
      const result =
        msg.method === 'workspace/configuration'
          ? ((msg.params as { items?: unknown[] })?.items ?? []).map(() => ({}))
          : null;
      this.write({ id: msg.id, result });
      return;
    }
    if (msg.method === 'textDocument/publishDiagnostics') {
      const p = msg.params as {
        uri: string;
        diagnostics: {
          range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
          };
          severity?: number;
          message: string;
          code?: string | number;
        }[];
      };
      let file: string;
      try {
        file = fileURLToPath(p.uri);
      } catch {
        return;
      }
      send(
        file,
        'dart',
        p.diagnostics.map((d) => ({
          line: d.range.start.line + 1,
          column: d.range.start.character + 1,
          endLine: d.range.end.line + 1,
          endColumn: d.range.end.character + 1,
          severity:
            d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info',
          message: d.message,
          code: d.code !== undefined ? String(d.code) : undefined,
        })),
      );
    }
  }

  async open(file: string, text: string) {
    await this.ready;
    this.versions.set(file, 1);
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri: pathToFileURL(file).href,
        languageId: 'dart',
        version: 1,
        text,
      },
    });
  }
  async change(file: string, text: string) {
    await this.ready;
    if (!this.versions.has(file)) return this.open(file, text);
    const version = (this.versions.get(file) ?? 1) + 1;
    this.versions.set(file, version);
    this.notify('textDocument/didChange', {
      textDocument: { uri: pathToFileURL(file).href, version },
      contentChanges: [{ text }],
    });
  }
  async close(file: string) {
    await this.ready;
    if (!this.versions.delete(file)) return;
    this.notify('textDocument/didClose', {
      textDocument: { uri: pathToFileURL(file).href },
    });
  }
  /** 💡 IntelliSense: कर्सरमा मिल्ने सुझावहरू — completion suggestions at the cursor. */
  async complete(file: string, text: string, line: number, column: number) {
    await this.change(file, text);
    const res = (await this.request(
      'textDocument/completion',
      {
        textDocument: { uri: pathToFileURL(file).href },
        position: { line: line - 1, character: column - 1 },
      },
      6000,
    )) as LspCompletionItem[] | { items?: LspCompletionItem[] } | null;
    const items = Array.isArray(res) ? res : (res?.items ?? []);
    return items
      .slice()
      .sort((a, b) =>
        (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label),
      )
      .slice(0, 250)
      .map((it) => ({
        label: it.label,
        kind: it.kind ?? 1,
        detail: it.detail,
        documentation:
          typeof it.documentation === 'string'
            ? it.documentation
            : it.documentation?.value,
        insertText: it.textEdit?.newText ?? it.insertText ?? it.label,
        isSnippet: it.insertTextFormat === 2,
        sortText: it.sortText,
        filterText: it.filterText,
      }));
  }

  /** 🔧 Quick fix: गल्ती सच्याउने तयारी सुझाव (यही फाइलका edit मात्र) — quick fixes (edits to this file only). */
  async codeActions(
    file: string,
    text: string,
    range: { line: number; column: number; endLine: number; endColumn: number },
    diagnostics: {
      line: number;
      column: number;
      endLine: number;
      endColumn: number;
      message: string;
      code?: string;
      severity: string;
    }[],
  ) {
    await this.change(file, text);
    const uri = pathToFileURL(file).href;
    const toRange = (r: {
      line: number;
      column: number;
      endLine: number;
      endColumn: number;
    }) => ({
      start: { line: r.line - 1, character: r.column - 1 },
      end: { line: r.endLine - 1, character: r.endColumn - 1 },
    });
    const res = (await this.request(
      'textDocument/codeAction',
      {
        textDocument: { uri },
        range: toRange(range),
        context: {
          diagnostics: diagnostics.map((d) => ({
            range: toRange(d),
            message: d.message,
            code: d.code,
            source: 'dart',
            severity:
              d.severity === 'error' ? 1 : d.severity === 'warning' ? 2 : 3,
          })),
          only: ['quickfix'],
        },
      },
      6000,
    )) as LspCodeAction[] | null;
    const same = (u: string) => {
      try {
        return (
          path.resolve(fileURLToPath(u)).toLowerCase() ===
          path.resolve(file).toLowerCase()
        );
      } catch {
        return false;
      }
    };
    const out: {
      title: string;
      preferred: boolean;
      edits: {
        line: number;
        column: number;
        endLine: number;
        endColumn: number;
        text: string;
      }[];
    }[] = [];
    for (const a of res ?? []) {
      if (!a || typeof a.title !== 'string' || !a.edit) continue;
      const edits: LspTextEdit[] = [];
      let foreign = false;
      for (const [u, list] of Object.entries(a.edit.changes ?? {})) {
        if (same(u)) edits.push(...list);
        else foreign = true;
      }
      for (const dc of a.edit.documentChanges ?? []) {
        if (dc.textDocument && same(dc.textDocument.uri))
          edits.push(...(dc.edits ?? []));
        else foreign = true;
      }
      // अरू फाइल छुने वा खाली fix नदेखाउने — skip fixes that touch other files or change nothing
      if (foreign || !edits.length) continue;
      out.push({
        title: a.title,
        preferred: Boolean(a.isPreferred),
        edits: edits.map((e) => ({
          line: e.range.start.line + 1,
          column: e.range.start.character + 1,
          endLine: e.range.end.line + 1,
          endColumn: e.range.end.character + 1,
          text: e.newText,
        })),
      });
    }
    return out.slice(0, 12);
  }

  dispose() {
    if (this.proc.exitCode === null) this.proc.kill();
  }
}

interface LspTextEdit {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
}
interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { value: string };
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: { newText: string };
  sortText?: string;
  filterText?: string;
}
interface LspCodeAction {
  title: string;
  isPreferred?: boolean;
  edit?: {
    changes?: Record<string, LspTextEdit[]>;
    documentChanges?: {
      textDocument?: { uri: string };
      edits?: LspTextEdit[];
    }[];
  };
}

const dartServers = new Map<string, DartServer>();
let dartExe: string | null | undefined;

function dartServerFor(file: string): DartServer | null {
  if (dartExe === undefined) dartExe = findDart();
  if (!dartExe) return null;
  const root = dartRoot(file);
  let server = dartServers.get(root);
  if (!server) {
    server = new DartServer(dartExe, root);
    dartServers.set(root, server);
  }
  return server;
}

// ---------------------------------------------------------------- Python

const PY_CHECK = `
import sys, json, ast
src = sys.stdin.read()
try:
    ast.parse(src, filename=sys.argv[1])
    print("[]")
except SyntaxError as e:
    print(json.dumps([{"line": e.lineno or 1, "column": e.offset or 1, "endLine": getattr(e, "end_lineno", None) or (e.lineno or 1), "endColumn": getattr(e, "end_offset", None) or ((e.offset or 1) + 1), "message": f"{type(e).__name__}: {e.msg}"}]))
`;

let pythonExe: string | null | undefined;
function findPython(): string | null {
  const r = spawnSync('where', ['python'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  // Microsoft Store को नक्कली python (WindowsApps) छोड्ने — skip the Microsoft Store stub.
  const found = (r.status === 0 ? r.stdout.split(/\r?\n/) : [])
    .map((l) => l.trim())
    .find((l) => l && !/WindowsApps/i.test(l));
  return found ?? null;
}

function checkPython(file: string, text: string): Promise<EditorDiagnostic[]> {
  if (pythonExe === undefined) pythonExe = findPython();
  if (!pythonExe) return Promise.resolve([]);
  return new Promise((resolve) => {
    const child = spawn(
      pythonExe as string,
      ['-I', '-c', PY_CHECK, path.basename(file)],
      { windowsHide: true },
    );
    let out = '';
    child.stdout?.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.on('error', () => resolve([]));
    child.on('close', () => {
      try {
        const list = JSON.parse(out.trim() || '[]') as Omit<
          EditorDiagnostic,
          'severity'
        >[];
        resolve(list.map((d) => ({ ...d, severity: 'error' as const })));
      } catch {
        resolve([]);
      }
    });
    child.stdin?.end(text, 'utf8');
  });
}

// ---------------------------------------------------------------- IPC

export function stopDiagnostics(): void {
  for (const s of dartServers.values()) s.dispose();
  dartServers.clear();
}

export function registerDiagnosticsHandlers(): void {
  ipcMain.handle(
    'diag:update',
    async (
      e,
      filePath: string,
      text: string,
      kind: 'open' | 'change' | 'close',
    ) => {
      target = e.sender;
      const file = assertInsideProject(filePath);
      const ext = path.extname(file).toLowerCase();
      if (ext === '.dart') {
        const server = dartServerFor(file);
        if (!server) return;
        if (kind === 'open') await server.open(file, text);
        else if (kind === 'change') await server.change(file, text);
        else await server.close(file);
      } else if (ext === '.py' && kind !== 'close') {
        send(file, 'python', await checkPython(file, text));
      }
    },
  );

  ipcMain.handle(
    'diag:complete',
    async (
      _e,
      filePath: string,
      text: string,
      line: number,
      column: number,
    ) => {
      const file = assertInsideProject(filePath);
      if (path.extname(file).toLowerCase() !== '.dart') return [];
      const server = dartServerFor(file);
      if (!server || typeof text !== 'string') return [];
      return server.complete(file, text, Number(line), Number(column));
    },
  );

  ipcMain.handle(
    'diag:codeActions',
    async (
      _e,
      filePath: string,
      text: string,
      range: {
        line: number;
        column: number;
        endLine: number;
        endColumn: number;
      },
      diagnostics: {
        line: number;
        column: number;
        endLine: number;
        endColumn: number;
        message: string;
        code?: string;
        severity: string;
      }[],
    ) => {
      const file = assertInsideProject(filePath);
      if (path.extname(file).toLowerCase() !== '.dart') return [];
      const server = dartServerFor(file);
      if (!server || typeof text !== 'string' || !range) return [];
      return server.codeActions(
        file,
        text,
        range,
        Array.isArray(diagnostics) ? diagnostics.slice(0, 20) : [],
      );
    },
  );
}
