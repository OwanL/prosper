import type {
  Citizen,
  CitizenObservation,
  Command,
  CommandResult,
  Order,
  Point,
  TileMemory,
  World,
} from '../shared/types.ts';
import { distance, fail, ok } from '../shared/utils.ts';

import { BALANCE } from './config.ts';

/** Manhattan sight; walls affect movement, never visibility. */
export const SIGHT_RADIUS = BALANCE.sightRadius;
const key = (point: Point) => `${point.x},${point.y}`;
const copy = <T>(value: T): T => structuredClone(value);
const inSight = (citizen: Citizen, point: Point) => distance(citizen, point) <= SIGHT_RADIUS;

function currentTiles(world: World, citizen: Citizen): TileMemory[] {
  const tiles: TileMemory[] = [];
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) {
      const point = { x, y };
      if (!inSight(citizen, point)) continue;
      const same = (entity: Point) => entity.x === x && entity.y === y;
      tiles.push({
        ...point,
        seenTick: world.tick,
        citizens: Object.values(world.citizens)
          .filter((c) => c.alive && same(c))
          .map((c) => ({
            id: c.id,
            name: c.name,
            color: c.color,
            x,
            y,
            alive: c.alive,
            health: c.health,
            // Presence is observable, but another citizen's plan/work is private.
            activity: 'present',
          })),
        deposits: copy(Object.values(world.deposits).filter(same)),
        buildings: copy(Object.values(world.buildings).filter(same)),
        loot: Object.values(world.loot)
          .filter(same)
          .map((l) => ({ id: l.id, x, y, citizenName: l.citizenName })),
      });
    }
  return tiles;
}

/** Call after creation and every committed world tick (including death/movement).
 * Empty visible tiles overwrite old occupants; remote tiles are never refreshed.
 */
export function updateKnowledge(world: World): void {
  for (const citizen of Object.values(world.citizens)) {
    if (!citizen.alive) continue;
    for (const tile of currentTiles(world, citizen)) citizen.knowledge[key(tile)] = tile;
  }
}

/** Pure citizen projection: calling observe does not commit new memories. */
export function observe(world: World, id: string): CitizenObservation {
  const source = world.citizens[id];
  if (!source) throw new Error(`Unknown citizen: ${id}`);
  const visible = source.alive ? currentTiles(world, source) : [];
  const visibleKeys = new Set(visible.map(key));
  const remembered = copy(
    Object.values(source.knowledge).filter((tile) => !visibleKeys.has(key(tile))),
  );
  const citizen = copy(source);
  // Use fresh local snapshots in the projected notebook, without changing state.
  for (const tile of visible) citizen.knowledge[key(tile)] = copy(tile);
  if (citizen.action) {
    // Only a contiguous visible prefix, not a route computed through unseen walls.
    const firstHidden = citizen.action.path.findIndex((point) => !visibleKeys.has(key(point)));
    if (firstHidden >= 0) citizen.action.path = citizen.action.path.slice(0, firstHidden);
    const command = citizen.action.command;
    if (command.type === 'attack' || command.type === 'reproduce') {
      const targetId = command.type === 'attack' ? command.targetId : command.partnerId;
      const known = [...visible, ...remembered]
        .flatMap((tile) => [...tile.citizens, ...tile.buildings])
        .find((entity) => entity.id === targetId);
      // Pursuit targets can track remote truth in core; expose only last sight.
      citizen.action.target = known ? { x: known.x, y: known.y } : { x: citizen.x, y: citizen.y };
    } else citizen.action.target = { x: citizen.action.target.x, y: citizen.action.target.y };
  }
  const tilesByKey = new Map(visible.map((tile) => [key(tile), tile]));
  const rows: string[] = [];
  for (let y = world.height - 1; y >= 0; y--) {
    let row = '';
    for (let x = 0; x < world.width; x++) {
      const tile = tilesByKey.get(key({ x, y }));
      row += !tile
        ? 'x'
        : tile.citizens.length
          ? '@'
          : tile.buildings.length
            ? tile.buildings[0].kind === 'wall'
              ? '#'
              : 'B'
            : tile.loot.length
              ? 'L'
              : tile.deposits.length
                ? { wood: 'W', food: 'F', fibre: 'V' }[tile.deposits[0].resource]
                : '.';
    }
    rows.push(row);
  }
  const entityIndex = visible
    .filter(
      (tile) =>
        tile.citizens.length || tile.deposits.length || tile.buildings.length || tile.loot.length,
    )
    .map(
      (tile) =>
        `(${tile.x},${tile.y}) seen tick ${tile.seenTick}: ${[
          ...tile.citizens.map((c) => `citizen ${c.id} ${c.name}`),
          ...tile.deposits.map((d) => `deposit ${d.id} ${d.resource} T${d.tier} stock ${d.stock}`),
          ...tile.buildings.map(
            (b) =>
              `building ${b.id} ${b.kind} T${b.tier} owner ${b.ownerId ?? 'none'} health ${b.health}`,
          ),
          ...tile.loot.map((l) => `loot ${l.id} ${l.citizenName}`),
        ].join('; ')}`,
    );
  // Orders are global; escrow is not an additional window into private holdings.
  // Building listings carry an optional building projection for location/condition.
  const markets: Order[] = Object.values(world.orders).map((order) => {
    const building = order.item.startsWith('building:')
      ? world.buildings[order.item.slice('building:'.length)]
      : undefined;
    return {
      ...copy(order),
      escrowGold: order.citizenId === id ? order.escrowGold : 0,
      escrowItems: order.citizenId === id ? copy(order.escrowItems) : {},
      ...(building ? { building: copy(building) } : {}),
    };
  });
  return {
    tick: world.tick,
    citizen,
    ascii: rows.join('\n'),
    entityIndex,
    visible,
    remembered,
    markets,
    messages: copy(
      world.messages.filter((message) => !message.to || message.from === id || message.to === id),
    ),
    // No audience means spectator-only, not public. Owner alerts use explicit audience.
    alerts: copy(world.events.filter((entry) => entry.audience?.includes(id))),
  };
}

/** Optional pre-dispatch citizen-tool gate. Unknown IDs get identical feedback
 * regardless of whether they exist in spectator truth. Not a core replacement.
 */
export function validateKnownCommand(world: World, id: string, command: Command): CommandResult {
  const observation = observe(world, id);
  const tiles = [...observation.visible, ...observation.remembered];
  const citizens = new Set([
    id,
    ...tiles.flatMap((tile) => tile.citizens.map((c) => c.id)),
    ...tiles.flatMap((tile) => tile.buildings.flatMap((b) => (b.ownerId ? [b.ownerId] : []))),
    ...observation.alerts.flatMap((alert) => (alert.citizenId ? [alert.citizenId] : [])),
    ...observation.messages.flatMap((m) => [m.from, ...(m.to ? [m.to] : [])]),
    ...observation.markets.map((order) => order.citizenId),
  ]);
  const buildings = new Set([
    ...tiles.flatMap((tile) => tile.buildings.map((b) => b.id)),
    ...observation.markets
      .filter((order) => order.item.startsWith('building:'))
      .map((order) => order.item.slice(9)),
    ...observation.alerts.flatMap((alert) => (alert.targetId ? [alert.targetId] : [])),
  ]);
  let known = true;
  switch (command.type) {
    case 'harvest':
      known = tiles.some((tile) => tile.deposits.some((d) => d.id === command.depositId));
      break;
    case 'refine':
      known = buildings.has(command.buildingId);
      break;
    case 'attack':
      known = citizens.has(command.targetId) || buildings.has(command.targetId);
      break;
    case 'loot':
      known = tiles.some((tile) => tile.loot.some((l) => l.id === command.lootId));
      break;
    case 'reproduce':
    case 'consent':
      known = citizens.has(command.partnerId);
      break;
    case 'transfer':
      known = citizens.has(command.citizenId);
      break;
    case 'message':
      known = !command.to || citizens.has(command.to);
      break;
    case 'cancel-order':
      known = observation.markets.some((order) => order.id === command.orderId);
      break;
    case 'order':
      known = !command.item.startsWith('building:') || buildings.has(command.item.slice(9));
      break;
  }
  if (!known)
    return fail(
      'unknown-entity',
      'That entity is not known. Travel to inspect it or use public information.',
    );
  // Core checks live stock/existence immediately. Do not let stale IDs probe
  // those facts remotely: travel to the remembered/property coordinates first.
  let visible = true;
  switch (command.type) {
    // Coordinates remain valid travel destinations, but build validation must
    // not probe unseen occupants or construction reservations in core.
    case 'build':
      visible = observation.visible.some((tile) => tile.x === command.x && tile.y === command.y);
      break;
    case 'harvest':
      visible = observation.visible.some((tile) =>
        tile.deposits.some((d) => d.id === command.depositId),
      );
      break;
    case 'refine':
      visible = observation.visible.some((tile) =>
        tile.buildings.some((b) => b.id === command.buildingId),
      );
      break;
    case 'attack':
      visible = observation.visible.some((tile) =>
        [...tile.citizens, ...tile.buildings].some((e) => e.id === command.targetId),
      );
      break;
    case 'loot':
      visible = observation.visible.some((tile) => tile.loot.some((l) => l.id === command.lootId));
      break;
    case 'reproduce':
      visible = observation.visible.some((tile) =>
        tile.citizens.some((c) => c.id === command.partnerId),
      );
      break;
  }
  return visible
    ? ok('Command refers only to known information.')
    : fail(
        'outside-sight',
        'Travel to the last-known coordinates before inspecting or acting on this entity.',
      );
}
