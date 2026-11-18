// Tiny Chrome DevTools Protocol driver for the packaged app (no extra dependencies).
// प्याकेज गरिएको app लाई चलाउने सानो CDP driver (थप package बिना)।
import { spawn } from 'node:child_process';

export async function launchApp({ exe, port, userDataDir, extraArgs = [] }) {
  const child = spawn(
    exe,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      ...extraArgs,
    ],
    {
      stdio: 'ignore',
      detached: false,
    },
  );
  const deadline = Date.now() + 30_000;
  let target;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find(
        (t) => t.type === 'page' && !t.url.startsWith('devtools://'),
      );
      if (target) break;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!target) throw new Error('app did not start');
  const page = await connect(target.webSocketDebuggerUrl);
  return { child, page };
}

export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const call = (method, params = {}) =>
    new Promise((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  return {
    call,
    /** Evaluate an expression (or async IIFE) in the page and return its JSON value. */
    async eval(expression, timeoutMs = 120_000) {
      const res = await Promise.race([
        call('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        }),
        new Promise((_, rej) =>
          setTimeout(
            () => rej(new Error(`eval timeout after ${timeoutMs} ms`)),
            timeoutMs,
          ),
        ),
      ]);
      if (res.result?.exceptionDetails) {
        throw new Error(
          res.result.exceptionDetails.exception?.description ??
            JSON.stringify(res.result.exceptionDetails),
        );
      }
      return res.result?.result?.value;
    },
    async click(x, y) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await call('Input.dispatchMouseEvent', {
          type,
          x,
          y,
          button: 'left',
          clickCount: 1,
        });
      }
    },
    async type(text) {
      await call('Input.insertText', { text });
    },
    async key(key, code, vk, modifiers = 0) {
      await call('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key,
        code,
        windowsVirtualKeyCode: vk,
        modifiers,
      });
      await call('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code,
        windowsVirtualKeyCode: vk,
        modifiers,
      });
    },
    async reload() {
      await call('Page.reload', {});
    },
    close() {
      ws.close();
    },
  };
}
