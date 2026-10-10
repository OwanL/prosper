import type {
  Citizen,
  CitizenObservation,
  Command,
  CommandResult,
  Order,
  Point,
  TileMemory,
  World,
  Deposit,
  Building,
  Loot,
} from '../shared/types.ts';
import { distance, fail, ok, worldEventHistory } from '../shared/utils.ts';

import { BALANCE } from './config.ts';

/** Manhattan sight; walls affect movement, never visibility. */
export const SIGHT_RADIUS = BALANCE.sightRadius;
const key = (point: Point) => `${point.x},${point.y}`;
const copy = <T>(value: T): T => structuredClone(value);
const inSight = (citizen: Citizen, point: Point) => distance(citizen, point) <= SIGHT_RADIUS;

type SpatialCell = { citizens:Citizen[]; deposits:Deposit[]; buildings:Building[]; loot:Loot[] };
function indexWorld(world:World):Map<string,SpatialCell> {
  const index=new Map<string,SpatialCell>();
  const cell=(point:Point)=>{const address=key(point);let value=index.get(address);if(!value){value={citizens:[],deposits:[],buildings:[],loot:[]};index.set(address,value);}return value;};
  for(const citizen of Object.values(world.citizens))if(citizen.alive)cell(citizen).citizens.push(citizen);
  for(const deposit of Object.values(world.deposits))cell(deposit).deposits.push(deposit);
  for(const building of Object.values(world.buildings))cell(building).buildings.push(building);
  for(const loot of Object.values(world.loot))cell(loot).loot.push(loot);
  return index;
}
function currentTiles(world: World, citizen: Citizen, spatial=indexWorld(world)): TileMemory[] {
  const tiles: TileMemory[] = [];
  for (let y = Math.max(0,citizen.y-SIGHT_RADIUS); y <= Math.min(world.height-1,citizen.y+SIGHT_RADIUS); y++)
    for (let x = Math.max(0,citizen.x-SIGHT_RADIUS); x <= Math.min(world.width-1,citizen.x+SIGHT_RADIUS); x++) {
      const point = { x, y };
      if (!inSight(citizen, point)) continue;
      const cell=spatial.get(key(point));
      const tile: TileMemory = {
        ...point,
        seenTick: world.tick,
        citizens: cell?.citizens.map((other)=>({id:other.id,name:other.name,color:other.color,x:other.x,y:other.y,alive:true,health:other.health,activity:'present'}))??[],
        deposits:cell?.deposits.map((deposit)=>({...deposit}))??[],
        buildings:cell?.buildings.length?copy(cell.buildings):[],
        loot:cell?.loot.map((loot)=>({id:loot.id,x:loot.x,y:loot.y,citizenName:loot.citizenName}))??[],
      };
      tiles.push(tile);
    }
  return tiles;
}

/** Call after creation and every committed world tick (including death/movement).
 * Empty visible tiles overwrite old occupants; remote tiles are never refreshed.
 */
export function updateKnowledge(world: World): void {
  const spatial=indexWorld(world);
  for (const citizen of Object.values(world.citizens)) {
    if (!citizen.alive) continue;
    for (const tile of currentTiles(world, citizen,spatial)) citizen.knowledge[key(tile)] = tile;
    if(citizen.autonomy&&Object.keys(citizen.knowledge).length>640) {
      const ranked=Object.entries(citizen.knowledge).sort(([,a],[,b])=> {
        const score=(tile:TileMemory)=>tile.seenTick+(tile.buildings.some((building)=>building.ownerId===citizen.id)?100000:0)+(tile.deposits.some((deposit)=>deposit.resource===citizen.autonomy!.policy.livelihood||deposit.resource==='food')?1000:0);
        return score(b)-score(a);
      });
      citizen.knowledge=Object.fromEntries(ranked.slice(0,512));
    }
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
    mapSize: {
      width: world.width,
      height: world.height,
      ...(world.ringCount !== undefined ? { ringCount: world.ringCount } : {}),
    },
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
    alerts: copy(worldEventHistory(world).filter((entry) => entry.audience?.includes(id))),
    claims: copy(Object.values(world.claims ?? {})),
    alliances: copy(Object.values(world.alliances ?? {})),
  };
}

/** Optional pre-dispatch citizen-tool gate. Unknown IDs get identical feedback
 * regardless of whether they exist in spectator truth. Not a core replacement.
 */
export function validateKnownCommand(
  world: World,
  id: string,
  command: Command,
  phase: 'submission' | 'activation' = 'submission',
): CommandResult {
  const citizen = world.citizens[id];
  if (!citizen) throw new Error(`Unknown citizen: ${id}`);
  // Routine commands do not need notebook clones, an ASCII map or projected
  // market inventories. Keep the gate on the same public knowledge boundary.
  if (!['harvest','refine','attack','loot','reproduce','consent','transfer','give','message','cancel-order','order','build'].includes(command.type))
    return ok('Command refers only to known information.');
  if (command.type === 'message' && !command.to || command.type === 'order' && !command.item.startsWith('building:'))
    return ok('Command refers only to known information.');
  if(command.type==='harvest'||command.type==='loot') {
    const targetId=command.type==='harvest'?command.depositId:command.lootId;
    const target=command.type==='harvest'?world.deposits[targetId]:world.loot[targetId];
    const current=!!(citizen.alive&&target&&inSight(citizen,target));
    const remembered=!current&&Object.values(citizen.knowledge).some((tile)=>!(citizen.alive&&inSight(citizen,tile))&&(command.type==='harvest'?tile.deposits:tile.loot).some((entity)=>entity.id===targetId));
    if(!current&&!remembered)return fail('unknown-entity','That entity is not known. Travel to inspect it or use public information.');
    if(phase==='submission'&&command.queue==='append'&&citizen.action)return ok('Queued intent uses known information; sight and prerequisites will be checked when it starts.');
    return current?ok('Command refers only to known information.'):fail('outside-sight','Travel to the last-known coordinates first. While work is active, append the known target action to check sight and prerequisites automatically when it starts.');
  }
  if(command.type==='cancel-order')return world.orders[command.orderId]?ok('Command refers only to known information.'):fail('unknown-entity','That entity is not known. Travel to inspect it or use public information.');
  const visibleTiles = citizen.alive ? currentTiles(world, citizen) : [];
  const visibleKeys = new Set(visibleTiles.map(key));
  const observation = {
    visible: visibleTiles,
    remembered: Object.values(citizen.knowledge).filter((tile) => !visibleKeys.has(key(tile))),
    alerts: worldEventHistory(world).filter((entry) => entry.audience?.includes(id)),
    messages: world.messages.filter((message) => !message.to || message.from === id || message.to === id),
    markets: Object.values(world.orders),
    claims: Object.values(world.claims ?? {}),
    alliances: Object.values(world.alliances ?? {}),
  };
  const tiles = [...observation.visible, ...observation.remembered];
  const citizens = new Set([
    id,
    ...tiles.flatMap((tile) => tile.citizens.map((c) => c.id)),
    ...tiles.flatMap((tile) => tile.buildings.flatMap((b) => (b.ownerId ? [b.ownerId] : []))),
    ...observation.alerts.flatMap((alert) => (alert.citizenId ? [alert.citizenId] : [])),
    ...observation.messages.flatMap((m) => [m.from, ...(m.to ? [m.to] : [])]),
    ...observation.markets.map((order) => order.citizenId),
    ...(observation.claims??[]).map((claim)=>claim.ownerId),
    ...(observation.alliances??[]).flatMap((alliance)=>alliance.members),
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
    case 'refine':
      known = buildings.has(command.buildingId);
      break;
    case 'attack':
      known = citizens.has(command.targetId) || buildings.has(command.targetId);
      break;
    case 'reproduce':
    case 'consent':
      known = citizens.has(command.partnerId);
      break;
    case 'transfer':
    case 'give':
      known = citizens.has(command.citizenId);
      break;
    case 'message':
      known = !command.to || citizens.has(command.to);
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
  // Appended intent may refer to dated targets without probing remote truth.
  // Only defer while work is active: otherwise append starts work immediately.
  // Core reuses this gate at activation, when visibility must actually hold.
  const deferred =
    phase === 'submission' && command.queue === 'append' && !!world.citizens[id]?.action;
  const knownSite =
    command.type === 'build' && tiles.some((tile) => tile.x === command.x && tile.y === command.y);
  const deferredTarget =
    ['harvest', 'refine', 'attack', 'loot', 'reproduce'].includes(command.type) || knownSite;
  if (deferred && deferredTarget)
    return ok(
      'Queued intent uses known information; sight and prerequisites will be checked when it starts.',
    );
  // Starting work now must not let stale IDs probe unseen stock or existence.
  let visible = true;
  switch (command.type) {
    // Coordinates remain valid travel destinations, but build validation must
    // not probe unseen occupants or construction reservations in core.
    case 'build':
      visible = observation.visible.some((tile) => tile.x === command.x && tile.y === command.y);
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
        'Travel to the last-known coordinates first. While work is active, append the known target action to check sight and prerequisites automatically when it starts.',
      );
}
