export type LockResult = 'locked' | 'cooldown' | 'unsupported';

export interface PointerLock {
  isLocked(): boolean;
  /** Must be called from a user gesture (click / keydown other than Esc). */
  request(): Promise<LockResult>;
  release(): void;
  onChange(listener: (locked: boolean) => void): void;
  dispose(): void;
}

/**
 * Wraps the Pointer Lock API quirks:
 *  - prefers raw (unadjusted) mouse input, falls back to the plain request
 *  - distinguishes "browser cooldown after Esc" (lock worked before) from "not available here"
 *    (sandboxed iframe / embedded preview), so the caller can fall back to drag-to-look
 */
export function createPointerLock(target: HTMLElement): PointerLock {
  let everLocked = false;
  const listeners: ((locked: boolean) => void)[] = [];
  const onChange = (): void => {
    const locked = document.pointerLockElement === target;
    if (locked) everLocked = true;
    for (const l of listeners) l(locked);
  };
  document.addEventListener('pointerlockchange', onChange);

  return {
    isLocked: () => document.pointerLockElement === target,
    async request() {
      if (document.pointerLockElement === target) return 'locked';
      try {
        await target.requestPointerLock({ unadjustedMovement: true });
        return 'locked';
      } catch {
        try {
          await target.requestPointerLock();
          return 'locked';
        } catch {
          return everLocked ? 'cooldown' : 'unsupported';
        }
      }
    },
    release() {
      if (document.pointerLockElement === target) document.exitPointerLock();
    },
    onChange(listener) {
      listeners.push(listener);
    },
    dispose() {
      document.removeEventListener('pointerlockchange', onChange);
      listeners.length = 0;
    },
  };
}
