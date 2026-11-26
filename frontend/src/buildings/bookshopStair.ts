/** Local plan coordinates, shared by the visible stair and its physics boxes. */
export const stairLevels = [-2.475, 1.125, 3.6, 7.2] as const;
export const rear = -26, turn = -21.8, nose = -20.6, axisZ = 12.8, radius = 1.95;
export function bookshopFlight(height: number, returning: boolean) {
  const count = Math.ceil(height / 2 / .165);
  const depth = (turn - rear) / count;
  const z = axisZ + (returning ? -1 : 1) * radius / 2;
  return Array.from({length: count}, (_, i) => ({
    x: returning ? turn - (i + .5) * depth : rear + (i + .5) * depth,
    z, top: (returning ? height / 2 : 0) + (i + 1) * height / (2 * count), depth
  }));
}
