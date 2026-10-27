/** Logical actions as bit flags so the whole input state is a single Uint32 and bindings are remappable. */
export const Action = {
  Forward: 1 << 0,
  Back: 1 << 1,
  Left: 1 << 2,
  Right: 1 << 3,
  Jump: 1 << 4,
  Sprint: 1 << 5,
  /** Fly down (tester mode). C rather than Ctrl: Ctrl+W would close the browser tab. */
  Down: 1 << 6,
} as const;
export type ActionBit = (typeof Action)[keyof typeof Action];

export const DEFAULT_BINDINGS: Readonly<Record<string, ActionBit>> = {
  KeyW: Action.Forward,
  ArrowUp: Action.Forward,
  KeyS: Action.Back,
  ArrowDown: Action.Back,
  KeyA: Action.Left,
  ArrowLeft: Action.Left,
  KeyD: Action.Right,
  ArrowRight: Action.Right,
  Space: Action.Jump,
  ShiftLeft: Action.Sprint,
  ShiftRight: Action.Sprint,
  KeyC: Action.Down,
};

/** Ignore pointer-lock movement spikes some browsers emit on focus changes. */
const MAX_MOUSE_DELTA = 400;

export interface Input {
  /** Bits currently held down. */
  held(): number;
  /** Bits pressed since the last call; call once per fixed step so presses are never lost or doubled. */
  consumePressed(): number;
  /** Accumulated pointer-lock mouse movement since the last call (pixels). */
  consumeMouse(out: { dx: number; dy: number }): void;
  setEnabled(enabled: boolean): void;
  /** Fallback when Pointer Lock is unavailable (sandboxed iframes): look by dragging with the left button. */
  setDragLook(enabled: boolean): void;
  dispose(): void;
}

export function createInput(target: HTMLElement, bindings: Readonly<Record<string, ActionBit>> = DEFAULT_BINDINGS): Input {
  let enabled = false;
  let dragLook = false;
  let held = 0;
  let pressed = 0;
  let mouseDX = 0;
  let mouseDY = 0;

  const onKeyDown = (e: KeyboardEvent): void => {
    const bit = bindings[e.code];
    if (bit === undefined || !enabled) return;
    e.preventDefault();
    if (!e.repeat && (held & bit) === 0) pressed |= bit;
    held |= bit;
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    const bit = bindings[e.code];
    if (bit === undefined) return;
    held &= ~bit;
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (!enabled) return;
    const looking = document.pointerLockElement === target || (dragLook && (e.buttons & 1) !== 0);
    if (!looking) return;
    if (Math.abs(e.movementX) > MAX_MOUSE_DELTA || Math.abs(e.movementY) > MAX_MOUSE_DELTA) return;
    mouseDX += e.movementX;
    mouseDY += e.movementY;
  };
  const reset = (): void => {
    held = 0;
    pressed = 0;
    mouseDX = 0;
    mouseDY = 0;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', reset);
  document.addEventListener('mousemove', onMouseMove);

  return {
    held: () => held,
    consumePressed() {
      const p = pressed;
      pressed = 0;
      return p;
    },
    consumeMouse(out) {
      out.dx = mouseDX;
      out.dy = mouseDY;
      mouseDX = 0;
      mouseDY = 0;
    },
    setEnabled(value) {
      enabled = value;
      if (!value) reset();
    },
    setDragLook(value) {
      dragLook = value;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', reset);
      document.removeEventListener('mousemove', onMouseMove);
    },
  };
}
