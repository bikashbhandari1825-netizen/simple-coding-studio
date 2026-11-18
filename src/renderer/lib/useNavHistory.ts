import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';

/** एउटा स्थान: फाइल + लाइन + स्तम्भ — one place: file, line and column. */
export interface NavLoc {
  path: string;
  line: number;
  column: number;
}

const MAX = 60;
/** एउटै फाइलभित्र यति लाइनभन्दा टाढा उफ्रिँदा पनि इतिहासमा राख्ने — a jump this far within one file is recorded too. */
const JUMP_LINES = 12;

/**
 * ← → नेभिगेसन इतिहास (VS Code जस्तै): फाइल बदल्दा वा टाढाको लाइनमा उफ्रिँदा स्थान याद राख्ने।
 * Back/Forward navigation history, like VS Code: remembers where you were when you switch files
 * or jump far within a file.
 */
export function useNavHistory(
  activePath: string | null,
  goTo: (loc: NavLoc) => void,
) {
  const stack = useRef<NavLoc[]>([]);
  const index = useRef(-1);
  // ← → ले आफैं फाइल बदल्दा त्यसलाई नयाँ इतिहास नमान्ने — our own back/forward moves are not new history.
  const navigating = useRef<{ path: string; until: number } | null>(null);
  const activeRef = useRef(activePath);
  activeRef.current = activePath;
  const [state, setState] = useState({ canBack: false, canForward: false });
  const sync = () =>
    setState({
      canBack: index.current > 0,
      canForward: index.current < stack.current.length - 1,
    });

  const push = (loc: NavLoc) => {
    stack.current = stack.current.slice(0, index.current + 1);
    stack.current.push(loc);
    if (stack.current.length > MAX) stack.current.shift();
    index.current = stack.current.length - 1;
    sync();
  };

  const isOurMove = () => {
    const n = navigating.current;
    return Boolean(n && Date.now() < n.until);
  };

  // फाइल बदलिँदा — when the active file changes
  useEffect(() => {
    if (!activePath) return;
    const n = navigating.current;
    if (n && n.path === activePath && Date.now() < n.until) {
      // फाइल आइपुग्यो: अब छोटो समय मात्र "हाम्रो चाल" — the file arrived; only a brief window remains ours.
      n.until = Date.now() + 400;
      return;
    }
    const cur = stack.current[index.current];
    if (cur?.path === activePath) return;
    push({ path: activePath, line: -1, column: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- push uses refs only
  }, [activePath]);

  /** Editor तयार भएपछि cursor पछ्याउने — follow the cursor once the editor exists. */
  const attach = useCallback((editor: Monaco.editor.IStandaloneCodeEditor) => {
    editor.onDidChangeCursorPosition((e) => {
      const path = activeRef.current;
      const cur = stack.current[index.current];
      if (!path || !cur || cur.path !== path) return;
      const { lineNumber, column } = e.position;
      const explicit = e.reason === 3; // CursorChangeReason.Explicit (mouse, keyboard, error jump)
      // नयाँ खुलेको फाइलको पहिलो स्थान (आफैं भएको) — the first, automatic position of a freshly opened file
      if ((cur.line < 0 && !explicit) || isOurMove()) {
        cur.line = lineNumber;
        cur.column = column;
        return;
      }
      // थाहा नभएको सुरुको स्थान = लाइन १ — an unknown starting place is the top of the file
      const from = cur.line < 0 ? 1 : cur.line;
      if (cur.line < 0) cur.line = 1;
      // माउस/किबोर्ड/error-jump ले टाढा उफ्रियो भने नयाँ स्थान — a deliberate far jump is a new place
      if (explicit && Math.abs(lineNumber - from) >= JUMP_LINES) {
        push({ path, line: lineNumber, column });
      } else {
        cur.line = lineNumber;
        cur.column = column;
      }
    });
  }, []);

  const move = useCallback(
    (delta: -1 | 1) => {
      const target = index.current + delta;
      if (target < 0 || target >= stack.current.length) return;
      index.current = target;
      const loc = stack.current[target];
      // अर्को फाइल खुल्न (पढ्न) समय लाग्न सक्छ; उही फाइलमा तुरुन्तै — another file may take a moment to load.
      navigating.current = {
        path: loc.path,
        until: Date.now() + (loc.path === activeRef.current ? 400 : 5000),
      };
      sync();
      goTo({ ...loc, line: Math.max(1, loc.line) });
    },
    [goTo],
  );

  // इतिहासबाट हटेका (मेटिएका) फाइल — drop a file that no longer exists
  const forget = useCallback((path: string) => {
    const before = stack.current.length;
    stack.current = stack.current.filter((l) => l.path !== path);
    index.current = Math.min(index.current, stack.current.length - 1);
    if (stack.current.length !== before) sync();
  }, []);

  return {
    canBack: state.canBack,
    canForward: state.canForward,
    back: () => move(-1),
    forward: () => move(1),
    attach,
    forget,
  };
}
