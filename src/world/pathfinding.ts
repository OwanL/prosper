import type { Point, World } from '../shared/types.ts';

export function inBounds(world: Pick<World, 'width' | 'height'>, point: Point): boolean {
  return (
    Number.isInteger(point.x) &&
    Number.isInteger(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < world.width &&
    point.y < world.height
  );
}
export function walkable(world: World, point: Point): boolean {
  return (
    inBounds(world, point) &&
    !Object.values(world.buildings).some(
      (b) => b.kind === 'wall' && b.x === point.x && b.y === point.y,
    )
  );
}
// Stable tie-breaking: east, north, west, south. Citizens and stations do not block.
export function neighbors(point: Point): Point[] {
  return [
    { x: point.x + 1, y: point.y },
    { x: point.x, y: point.y + 1 },
    { x: point.x - 1, y: point.y },
    { x: point.x, y: point.y - 1 },
  ];
}

/** Shortest orthogonal route, excluding start and including destination. */
export function findPath(world: World, start: Point, destination: Point): Point[] | null {
  if (!inBounds(world, start) || !walkable(world, destination)) return null;
  const key = (p: Point) => `${p.x},${p.y}`;
  const startKey = key(start),
    endKey = key(destination);
  const frontier: Point[] = [{ x: start.x, y: start.y }];
  const previous = new Map<string, Point | null>([[startKey, null]]);
  for (let cursor = 0; cursor < frontier.length; cursor++) {
    const point = frontier[cursor];
    if (key(point) === endKey) {
      const path: Point[] = [];
      let step = point;
      while (key(step) !== startKey) {
        path.push(step);
        step = previous.get(key(step))!;
      }
      return path.reverse();
    }
    for (const next of neighbors(point)) {
      if (!walkable(world, next) || previous.has(key(next))) continue;
      previous.set(key(next), point);
      frontier.push(next);
    }
  }
  return null;
}
