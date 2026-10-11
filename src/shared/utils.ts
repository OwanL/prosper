import type {
  World,
  WorldEvent,
  Inventory,
  CommandResult,
  Point,
  Region,
  ItemKey,
} from './types.ts';
export const ok = (message: string): CommandResult => ({ ok: true, code: 'ok', message });
export const fail = (code: string, message: string): CommandResult => ({
  ok: false,
  code,
  message,
});
export function id(world: World, prefix: string) {
  return `${prefix}-${world.nextId++}`;
}
export function random(world: World) {
  let x = world.rngState | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  world.rngState = x >>> 0;
  return world.rngState / 4294967296;
}
export function event(
  world: World,
  kind: string,
  text: string,
  detail: Omit<Partial<WorldEvent>, 'id' | 'tick' | 'kind' | 'text'> = {},
) {
  const entry: WorldEvent = { id: id(world, 'event'), tick: world.tick, kind, text, ...detail };
  world.events.push(entry);
  if (world.events.length > 500) world.events.splice(0, world.events.length - 500);
  if (significantEventKinds.has(kind)) {
    const stories = (world.significantEvents ??= []);
    stories.push(entry);
    // Frequent trades must not crowd out rarer conflict/family stories.
    if (stories.filter((story) => story.kind === kind).length > 64)
      stories.splice(
        stories.findIndex((story) => story.kind === kind),
        1,
      );
    if (stories.length > 256) stories.splice(0, stories.length - 256);
  }
  return entry;
}
const significantEventKinds = new Set([
  'death',
  'attack',
  'birth',
  'claim',
  'alliance',
  'threat',
  'trespass',
  'flee',
  'trade',
  'loot',
  'extortion',
  'destruction',
  'gift',
]);
/** Derived-only cache shape: refs/ticks/ids mirrors the ring contents, result is the
 * merged order. Held in a WeakMap keyed by the caller's object, so it is invisible to
 * serialization, cloning and RNG: no world field exists to restore or checkpoint. */
type EventHistoryCache = {
  refs: WorldEvent[];
  ticks: number[];
  ids: string[];
  result: WorldEvent[];
};
const eventHistoryCaches = new WeakMap<object, EventHistoryCache>();

/** Linear re-validation. Ring contents are public mutable arrays, so a cached merge is
 * trusted only when each ring entry is still the same reference with the same id and
 * tick. That detects append/trim/reorder/replacement and in-place tick edits; payload
 * edits (text/audience) cannot change the merged order and travel via the shared
 * references. A revision counter could not capture callers who mutate rings directly. */
function historyCacheValid(
  world: Pick<World, 'events' | 'significantEvents'>,
  cache: EventHistoryCache,
): boolean {
  const significant = world.significantEvents;
  if (cache.refs.length !== (significant?.length ?? 0) + world.events.length) return false;
  let at = 0;
  if (significant)
    for (const entry of significant) {
      if (cache.refs[at] !== entry || cache.ticks[at] !== entry.tick || cache.ids[at] !== entry.id)
        return false;
      at++;
    }
  for (const entry of world.events) {
    if (cache.refs[at] !== entry || cache.ticks[at] !== entry.tick || cache.ids[at] !== entry.id)
      return false;
    at++;
  }
  return true;
}

/** Merge by identity before the caller applies spectator or personal visibility rules.
 * The merge is cached per world object and re-validated with a linear fingerprint scan,
 * so callers who mutate ring arrays between calls still receive an exact fresh merge.
 * Returns a fresh copy each call; mutating it cannot poison the cache. */
export function worldEventHistory(
  world: Pick<World, 'events' | 'significantEvents'>,
): WorldEvent[] {
  const cached = eventHistoryCaches.get(world);
  if (cached && historyCacheValid(world, cached)) return cached.result.slice();
  const significant = world.significantEvents;
  const ring = [...(significant ?? []), ...world.events];
  const refs: WorldEvent[] = [];
  const ticks: number[] = [];
  const ids: string[] = [];
  for (const entry of ring) {
    refs.push(entry);
    ticks.push(entry.tick);
    ids.push(entry.id);
  }
  const result = [
    ...new Map(ring.map((entry) => [entry.id, entry])).values(),
  ].sort(
    (a, b) => a.tick - b.tick || Number(a.id.split('-').at(-1)) - Number(b.id.split('-').at(-1)),
  );
  eventHistoryCaches.set(world, { refs, ticks, ids, result });
  return result.slice();
}
export const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
type RingLayout = Pick<World, 'width' | 'height' | 'ringCount'>;
export function ringAt(world: RingLayout, p: Point): number {
  const ratio = Math.max(
    Math.abs((p.x + 0.5) / world.width - 0.5) * 2,
    Math.abs((p.y + 0.5) / world.height - 0.5) * 2,
  );
  if (world.ringCount === undefined) return ratio < 0.3 ? 0 : ratio < 0.66 ? 1 : 2;
  // Strict inner boundaries, shared with the nested rectangles used by the UI.
  for (let ring = 0; ring < world.ringCount - 1; ring++)
    if (ratio < (ring + 1) / world.ringCount) return ring;
  return world.ringCount - 1;
}
export function regionAt(world: RingLayout, p: Point): Region {
  const ring = ringAt(world, p);
  return ring === 0 ? 'center' : `ring${ring}`;
}
/** Outer-to-inner square boundaries; legacy worlds never adopt new geometry. */
export function ringBoundaries(world: RingLayout): { ring: number; ratio: number; region: Region }[] {
  const count = world.ringCount;
  const ratios = count === undefined
    ? [0.3, 0.66, 1]
    : Array.from({ length: count }, (_, ring) => (ring + 1) / count);
  return ratios.map((ratio, ring) => ({ ratio, ring, region: ring === 0 ? 'center' as const : `ring${ring}` as Region })).reverse();
}
export const itemKey = (kind: string, tier: number): ItemKey => `${kind}:${tier}`;
export function addInventory(to: Inventory, from: Inventory) {
  for (const [k, n] of Object.entries(from)) {
    to[k] = (to[k] ?? 0) + n;
    if (!to[k]) delete to[k];
  }
}
export function hasInventory(inventory: Inventory, cost: Inventory) {
  return Object.entries(cost).every(([k, n]) => (inventory[k] ?? 0) >= n);
}
export function takeInventory(inventory: Inventory, cost: Inventory) {
  if (!hasInventory(inventory, cost)) return false;
  for (const [k, n] of Object.entries(cost)) {
    inventory[k] -= n;
    if (!inventory[k]) delete inventory[k];
  }
  return true;
}
