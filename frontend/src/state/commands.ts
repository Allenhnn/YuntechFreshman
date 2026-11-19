/**
 * UI → game commands. The UI never touches ECS / physics directly; it enqueues a command and
 * the game loop drains the queue at the start of the next fixed step, so gameplay effects are
 * always applied at a deterministic point in the frame.
 */
export type GameCommand =
  | { type: 'respawn' }
  /** Back to the new-game start point (quitting to the main menu). */
  | { type: 'toStart' }
  /** Resume the progress stored in this browser. */
  | { type: 'loadSave' }
  /** Fresh progress at the new-game start point. */
  | { type: 'newGame' }
  /** Abandon the track time trial in progress. */
  | { type: 'leaveRace' }
  /** Start navigating to a map place (x, z in campus metres). */
  | { type: 'navigate'; x: number; z: number; name: string; quiet?: boolean }
  | { type: 'stopNav' }
  | { type: 'useItem'; slot: number }
  | { type: 'interact' }
  | { type: 'elevatorTo'; building: string; level: string }
  /** Map teleport: x/z in campus metres; the game finds a safe standing spot near it. */
  | { type: 'teleport'; x: number; z: number; label: string }
  /** Phone camera: take a photo / turn the view (mouse pixels). */
  | { type: 'photo' }
  /** Quit the ball game in progress. */
  | { type: 'leaveSport' }
  | { type: 'cameraLook'; dx: number; dy: number }
  /** Navigate to the current story objective (G). */
  | { type: 'storyGuide' }
  /** 管理員模式 story controls. */
  | { type: 'storyAdmin'; op: 'jump'; day: number; step: number }
  | { type: 'storyAdmin'; op: 'complete' | 'reset' }
  /** 管理員模式: set the clock to a time of the current day (minutes). */
  | { type: 'setClock'; minuteOfDay: number };

const queue: GameCommand[] = [];

export function dispatch(command: GameCommand): void {
  queue.push(command);
}

export function drainCommands(handle: (command: GameCommand) => void): void {
  // Commands are rare (button clicks), so a plain array is fine; length reset keeps it allocation-free.
  for (let i = 0; i < queue.length; i++) handle(queue[i]!);
  queue.length = 0;
}
