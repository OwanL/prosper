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
  return entry;
}
export const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export function regionAt(world: Pick<World, 'width' | 'height'>, p: Point): Region {
  const ratio = Math.max(
    Math.abs((p.x + 0.5) / world.width - 0.5) * 2,
    Math.abs((p.y + 0.5) / world.height - 0.5) * 2,
  );
  return ratio < 0.3 ? 'center' : ratio < 0.66 ? 'ring1' : 'ring2';
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
