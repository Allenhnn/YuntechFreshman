import { useEffect, useRef } from 'react';

/**
 * Esc priority: the innermost open thing closes first. Components that have a "back" step of their
 * own (a chat thread, a phone app page) register a handler while mounted; the newest one runs first
 * and returns true when it used the key. After them: the open window, the full map, and only then
 * the pause menu (game/hotkeys.ts).
 */
const stack: { ref: { current: () => boolean }; depth: number }[] = [];

/** `depth`: how deep the handler's view is (a chat thread inside the phone's chat app = 2). */
export function useEscape(fn: () => boolean, depth = 1): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const entry = { ref, depth };
    stack.push(entry);
    return () => { const i = stack.indexOf(entry); if (i >= 0) stack.splice(i, 1); };
  }, [depth]);
}

/** Runs the registered handlers, deepest (then newest) first; true when one of them used the key. */
export function runEscape(): boolean {
  const order = stack.map((e, i) => ({ e, i })).sort((a, b) => b.e.depth - a.e.depth || b.i - a.i);
  for (const { e } of order) if (e.ref.current()) return true;
  return false;
}
