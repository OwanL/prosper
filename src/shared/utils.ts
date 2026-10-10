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
/** Merge by identity before the caller applies spectator or personal visibility rules. */
export function worldEventHistory(
  world: Pick<World, 'events' | 'significantEvents'>,
): WorldEvent[] {
  return [
    ...new Map(
      [...(world.significantEvents ?? []), ...world.events].map((entry) => [entry.id, entry]),
    ).values(),
  ].sort(
    (a, b) => a.tick - b.tick || Number(a.id.split('-').at(-1)) - Number(b.id.split('-').at(-1)),
  );
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
