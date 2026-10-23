/**
 * UI → game commands. The UI never touches ECS / physics directly; it enqueues a command and
 * the game loop drains the queue at the start of the next fixed step, so gameplay effects are
 * always applied at a deterministic point in the frame.
 */
export type GameCommand =
  | { type: 'respawn' }
  | { type: 'useItem'; slot: number }
  | { type: 'interact' }
  | { type: 'elevatorTo'; building: string; level: string };

const queue: GameCommand[] = [];

export function dispatch(command: GameCommand): void {
  queue.push(command);
}

export function drainCommands(handle: (command: GameCommand) => void): void {
  // Commands are rare (button clicks), so a plain array is fine; length reset keeps it allocation-free.
  for (let i = 0; i < queue.length; i++) handle(queue[i]!);
  queue.length = 0;
}
