import type {
  CitizenObservation,
  CitizenSighting,
  Deposit,
  Building,
  Loot,
  Point,
  World,
  Command,
} from '../shared/types';
import { regionAt as worldRegionAt } from '../shared/utils';

export interface SceneCitizen extends CitizenSighting {
  progress?: number;
  thinking?: boolean;
  facing?: number;
  construction?: Extract<Command, { type: 'build' }>;
}
export interface SceneEntity<T> {
  value: T;
  remembered: boolean;
  seenTick: number;
}
export interface SceneModel {
  width: number;
  height: number;
  tick: number;
  citizens: SceneEntity<SceneCitizen>[];
  deposits: SceneEntity<Deposit>[];
  buildings: SceneEntity<Building>[];
  loot: SceneEntity<Pick<Loot, 'id' | 'x' | 'y' | 'citizenName'>>[];
  tiles: { x: number; y: number; seenTick: number; remembered: boolean }[] | null;
}
export function progress(elapsed: number, duration: number): number {
  return duration > 0 ? Math.max(0, Math.min(1, elapsed / duration)) : 0;
}
export function projectWorld(world: World, thinking: string[] = []): SceneModel {
  const wrap = <T>(value: T): SceneEntity<T> => ({
    value,
    remembered: false,
    seenTick: world.tick,
  });
  return {
    width: world.width,
    height: world.height,
    tick: world.tick,
    tiles: null,
    citizens: Object.values(world.citizens ?? {})
      .filter((c) => c.alive)
      .map((c) =>
        wrap({
          ...c,
          activity: c.alive
            ? c.action
              ? c.action.phase === 'travel'
                ? 'walking'
                : c.action.command.type
              : 'idle'
            : 'dead',
          progress: c.action ? progress(c.action.elapsed, c.action.duration) : undefined,
          thinking: thinking.includes(c.id),
          facing: c.action?.path[0] ? (c.action.path[0].x < c.x ? -1 : 1) : 1,
          construction: c.action?.command.type === 'build' ? c.action.command : undefined,
        }),
      ),
    deposits: Object.values(world.deposits ?? {}).map(wrap),
    buildings: Object.values(world.buildings ?? {}).map(wrap),
    loot: Object.values(world.loot ?? {}).map(wrap),
  };
}
// Only dimensions cross the spectator boundary. No unseen entity is read in this projection.
export function projectObservation(
  observation: CitizenObservation,
  dimensions: { width: number; height: number },
): SceneModel {
  const visible = observation.visible ?? [];
  const keys = new Set(visible.map((t) => `${t.x},${t.y}`));
  const tiles = [
    ...(observation.remembered ?? [])
      .filter((t) => !keys.has(`${t.x},${t.y}`))
      .map((t) => ({ ...t, remembered: true })),
    ...visible.map((t) => ({ ...t, remembered: false })),
  ];
  const collect = <T extends { id: string }>(
    get: (t: (typeof tiles)[number]) => T[],
  ): SceneEntity<T>[] => {
    const entities = new Map<string, SceneEntity<T>>();
    for (const t of tiles)
      for (const value of get(t) ?? [])
        entities.set(value.id, { value, remembered: t.remembered, seenTick: t.seenTick });
    return [...entities.values()];
  };
  return {
    width: dimensions.width,
    height: dimensions.height,
    tick: observation.tick,
    tiles,
    citizens: collect((t) => t.citizens),
    deposits: collect((t) => t.deposits),
    buildings: collect((t) => t.buildings),
    loot: collect((t) => t.loot),
  };
}
export function occupantOffset(id: string, occupants: { id: string }[]): Point {
  const sorted = occupants.map((c) => c.id).sort();
  const i = Math.max(0, sorted.indexOf(id));
  if (sorted.length <= 1) return { x: 0, y: 0 };
  const angle = (i * Math.PI * 2) / sorted.length;
  return { x: Math.cos(angle) * 0.23, y: Math.sin(angle) * 0.23 };
}
export function screenPoint(p: Point, height: number): Point {
  return { x: p.x + 0.5, y: height - p.y - 0.5 };
}
export function regionAt(x: number, y: number, width: number, height: number): string {
  return worldRegionAt({ width, height }, { x, y });
}
