import type {
  CitizenObservation,
  CitizenSighting,
  Deposit,
  Building,
  House,
  Loot,
  Point,
  Territory,
  TerritorySign,
  World,
  Citizen,
  SpectatorCitizen,
  SpectatorWorld,
  Command,
} from '../shared/types';
import type { Alliance, TerritorialClaim } from '../shared/autonomy-types';
import { regionAt as worldRegionAt, ringBoundaries } from '../shared/utils';

export interface SceneCitizen extends CitizenSighting {
  progress?: number;
  thinking?: boolean;
  facing?: number;
  construction?: Extract<Command, { type: 'build' }>;
  fullness?: number;
  attackTargetId?: string;
  partnerId?: string;
  resources?: Record<string, number>;
  gold?: number;
  territory?: { id: string; ownerId: string; label: string; color: string; role: 'owner' | 'member' };
}
export interface SceneEntity<T> {
  value: T;
  remembered: boolean;
  seenTick: number;
}
export interface SceneModel {
  width: number;
  height: number;
  ringCount?: number;
  tick: number;
  citizens: SceneEntity<SceneCitizen>[];
  deposits: SceneEntity<Deposit>[];
  buildings: SceneEntity<Building>[];
  houses?: SceneEntity<House>[];
  signs?: SceneEntity<TerritorySign>[];
  territories?: Territory[];
  loot: SceneEntity<Pick<Loot, 'id' | 'x' | 'y' | 'citizenName'>>[];
  tiles: { x: number; y: number; seenTick: number; remembered: boolean }[] | null;
  claims?: TerritorialClaim[];
  alliances?: Alliance[];
}
/** Legacy presentation consumers do not read controller internals. Never treat a summary as CitizenMind. */
export function withoutControllerSummary(citizen: Citizen | SpectatorCitizen): Citizen {
  const { mind: _mind, ...body } = citizen;
  return body;
}
export function presentationWorld(world: SpectatorWorld): World {
  return { ...world, citizens: Object.fromEntries(Object.entries(world.citizens)
    .map(([id, citizen]) => [id, withoutControllerSummary(citizen)])) };
}
export function progress(elapsed: number, duration: number): number {
  return duration > 0 ? Math.max(0, Math.min(1, elapsed / duration)) : 0;
}
export function projectWorld(world: World | SpectatorWorld, thinking: string[] = []): SceneModel {
  const wrap = <T>(value: T): SceneEntity<T> => ({
    value,
    remembered: false,
    seenTick: world.tick,
  });
  return {
    width: world.width,
    height: world.height,
    ringCount: world.ringCount,
    tick: world.tick,
    tiles: null,
    claims: Object.values(world.claims ?? {}).filter(
      (claim) => claim.expiresTick > world.tick && world.citizens[claim.ownerId]?.alive,
    ),
    alliances: Object.values(world.alliances ?? {}),
    citizens: Object.values(world.citizens ?? {})
      .filter((c) => c.alive)
      .map((c) =>
        wrap({
          ...c,
          resources: { ...c.inventory },
          territory: citizenTerritory(Object.values(world.territories ?? {}), c.id, world.citizens),
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
          attackTargetId:
            c.action?.command.type === 'attack' ? c.action.command.targetId : undefined,
          partnerId:
            c.action?.command.type === 'reproduce' ? c.action.command.partnerId : undefined,
        }),
      ),
    deposits: Object.values(world.deposits ?? {}).map(wrap),
    buildings: Object.values(world.buildings ?? {}).map(wrap),
    houses: Object.values(world.houses ?? {}).map(wrap),
    signs: Object.values(world.signs ?? {}).map(wrap),
    territories: Object.values(world.territories ?? {}),
    loot: Object.values(world.loot ?? {}).map(wrap),
  };
}
// Layout comes from the observation; legacy observations may use dimensions only.
// No unseen entity or spectator ring metadata is read in this projection.
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
  // Signs and houses are not tile memories: dated evidence derives from the
  // knowledge tiles the observation already exposes (no new server window).
  const currentKeys = new Set((observation.visible ?? []).map((t) => `${t.x},${t.y}`));
  const recalledTicks = new Map<string, number>(
    (observation.remembered ?? []).map((t) => [`${t.x},${t.y}`, t.seenTick] as const),
  );
  const civic = <T extends Point>(list: T[] | undefined): SceneEntity<T>[] =>
    (list ?? []).map((value) => {
      const key = `${value.x},${value.y}`;
      const remembered = !currentKeys.has(key) && recalledTicks.has(key);
      return { value, remembered, seenTick: remembered ? recalledTicks.get(key)! : observation.tick };
    });
  return {
    width: observation.mapSize?.width ?? dimensions.width,
    height: observation.mapSize?.height ?? dimensions.height,
    ringCount: observation.mapSize?.ringCount,
    tick: observation.tick,
    tiles,
    citizens: collect((t) => t.citizens).map((entity) => ({
      ...entity,
      value: {
        ...entity.value,
        gold: undefined,
        resources: undefined,
        territory: citizenTerritory(observation.territories ?? [], entity.value.id,
          Object.fromEntries(tiles.flatMap(t => t.citizens).map(c => [c.id, c]))),
        ...(entity.value.id === observation.citizen.id ? {
          resources: { ...observation.citizen.inventory }, gold: observation.citizen.gold,
        } : {}),
      },
    })),
    deposits: collect((t) => t.deposits),
    buildings: collect((t) => t.buildings),
    houses: civic(observation.houses),
    signs: civic(observation.signs),
    territories: observation.territories,
    loot: collect((t) => t.loot),
  };
}
/** Tile membership is authoritative in signs; the map joins known signs to their territory. */
export function markedTerritories(model: Pick<SceneModel, 'signs' | 'territories'>): Map<string, Territory> {
  const byId = new Map((model.territories ?? []).map((territory) => [territory.id, territory]));
  const marked = new Map<string, Territory>();
  for (const { value: sign } of model.signs ?? []) {
    const territory = byId.get(sign.territoryId);
    if (territory) marked.set(`${sign.x},${sign.y}`, territory);
  }
  return marked;
}
/** Territory identity survives succession; personal identity colors remain untouched. */
export function territoryColor(territory: Pick<Territory, 'id'>): string {
  let hash = 2166136261;
  for (const char of territory.id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return `hsl(${hash % 360} 58% 65%)`;
}
export const unaffiliatedColor = '#9ca3af';
export function territoryLabel(territory: Pick<Territory, 'id' | 'ownerId'>,
  citizens: Record<string, Pick<Citizen, 'name'>> = {}): string {
  return `${citizens[territory.ownerId]?.name ?? 'Unknown owner'} · ${territory.id.slice(-8)}`;
}
export function citizenTerritory(territories: Territory[], citizenId: string,
  citizens: Record<string, Pick<Citizen, 'name'>> = {}): SceneCitizen['territory'] {
  const territory = [...territories].sort((a, b) => a.id.localeCompare(b.id))
    .find((t) => !!t.members[citizenId]);
  return territory ? { id: territory.id, ownerId: territory.ownerId,
    label: territoryLabel(territory, citizens), color: territoryColor(territory),
    role: territory.ownerId === citizenId ? 'owner' : 'member' } : undefined;
}
export function citizenColor(citizen: SceneCitizen): string {
  return citizen.territory?.color ?? unaffiliatedColor;
}
export type TerritoryMembershipView = 'owner' | 'member' | 'none';
export function membershipIn(
  territory: Territory | undefined,
  citizenId: string,
): TerritoryMembershipView {
  if (!territory?.members[citizenId]) return 'none';
  return territory.ownerId === citizenId ? 'owner' : 'member';
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
/** Keep a focused edge citizen in frame without showing empty space outside the map. */
export function cameraPoint(
  p: Point,
  width: number,
  height: number,
  mapWidth: number,
  mapHeight: number,
): Point {
  return {
    x: width >= mapWidth ? mapWidth / 2 : Math.max(width / 2, Math.min(mapWidth - width / 2, p.x)),
    y:
      height >= mapHeight
        ? mapHeight / 2
        : Math.max(height / 2, Math.min(mapHeight - height / 2, p.y)),
  };
}
/** Exact nested grid rectangles, painted outer-to-inner, replace spectator tile nodes. */
export function terrainRegions(width: number, height: number, ringCount?: number) {
  return ringBoundaries({ width, height, ringCount }).map(({ ratio, region }) => {
    const edge = (size: number) =>
      ratio === 1 ? 0 : Math.floor((size * (1 - ratio)) / 2 - 0.5) + 1;
    const x = edge(width),
      y = edge(height);
    return {
      x,
      y,
      width: width - 2 * x,
      height: height - 2 * y,
      region,
    };
  });
}
export function regionAt(
  x: number,
  y: number,
  width: number,
  height: number,
  ringCount?: number,
): string {
  return worldRegionAt({ width, height, ringCount }, { x, y });
}
/** One palette for both spectator rectangles and personally observed tiles. */
export function terrainColor(region: string, ringCount?: number): string {
  if (ringCount === undefined)
    return region === 'center' ? '#b7b384' : region === 'ring1' ? '#9ca97a' : '#83966b';
  const ring = region === 'center' ? 0 : Number(region.slice(4));
  const outward = ringCount > 1 ? ring / (ringCount - 1) : 0;
  return `hsl(${50 + 40 * outward} 24% ${62 - 17 * outward}%)`;
}
