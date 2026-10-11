import type {
  Citizen,
  CitizenObservation,
  Command,
  CommandResult,
  Point,
  TileMemory,
  Territory,
  TerritorySign,
  World,
  Deposit,
  Building,
  House,
  Loot,
  ReputationLevel,
  CitizenSighting,
  Tier,
  DecisionObservation,
} from '../shared/types.ts';
import { distance, fail, ok, worldEventHistory } from '../shared/utils.ts';

import { BALANCE, MATCHING_TOOL, harvestDuration } from './config.ts';
import { highestToolTier } from '../shared/tool-utils.ts';

/** Manhattan sight; walls affect movement, never visibility. */
export const SIGHT_RADIUS = BALANCE.sightRadius;
const key = (point: Point) => `${point.x},${point.y}`;
const copy = <T>(value: T): T => structuredClone(value);
/** Notebook ownership: writers replace entire rows, never mutate a captured row
 * or its children. currentTiles detaches deposits (primitive fields), buildings
 * (deep clone), sightings/publicWork and loot (fresh objects) from world truth.
 * Seal each borrowed row once, including restored rows, to enforce the contract
 * in production too without walking the whole notebook on every decision. */
const sealedMemories = new WeakSet<object>();
function sealMemory<T>(value: T): T {
  if (value && typeof value === 'object' && !sealedMemories.has(value)) {
    for (const child of Object.values(value)) sealMemory(child);
    Object.freeze(value);
    sealedMemories.add(value);
  }
  return value;
}
const inSight = (citizen: Citizen, point: Point) => distance(citizen, point) <= SIGHT_RADIUS;
/** Commit only this living citizen's current sight, never remote truth. */
export function refreshVisibleKnowledge(world: World, citizen: Citizen): void {
  if (!citizen.alive) return;
  for (const tile of currentTiles(world, citizen)) citizen.knowledge[key(tile)] = tile;
}

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
/** Only actual visible work toward a currently visible deposit, never queued intentions. */
function sighting(world: World, observer: Citizen, other: Citizen): CitizenSighting {
  const result: CitizenSighting = {
    id: other.id, name: other.name, color: other.color, x: other.x, y: other.y,
    alive: true, health: other.health, activity: 'present', busy: other.action !== null,
    inventory: { ...other.inventory }, gold: other.gold,
  };
  const action = other.action;
  if (action?.command.type !== 'harvest') return result;
  const deposit = world.deposits[action.command.depositId];
  if (!deposit || !inSight(observer, deposit)) return result;
  const tier = highestToolTier(other, MATCHING_TOOL[deposit.resource]);
  result.publicWork = {
    kind: 'harvest', depositId: deposit.id,
    phase: action.phase === 'travel' ? 'travel' : 'harvest',
    remainingTicks: action.phase === 'travel'
      ? Math.max(0, distance(other, deposit) * BALANCE.moveTicks - action.elapsed)
      : Math.max(0, Math.ceil(action.duration - action.elapsed)),
    harvestTicks: harvestDuration(deposit.tier, tier),
    ...(tier > 0 ? { toolTier: tier as Tier } : {}),
  };
  return result;
}
function currentTiles(world: World, citizen: Citizen, spatial=indexWorld(world)): TileMemory[] {
  const tiles: TileMemory[] = [];
  const marks = new Map(Object.values(world.signs ?? {}).map(sign => [key(sign), sign.territoryId]));
  for (let y = Math.max(0,citizen.y-SIGHT_RADIUS); y <= Math.min(world.height-1,citizen.y+SIGHT_RADIUS); y++)
    for (let x = Math.max(0,citizen.x-SIGHT_RADIUS); x <= Math.min(world.width-1,citizen.x+SIGHT_RADIUS); x++) {
      const point = { x, y };
      if (!inSight(citizen, point)) continue;
      const cell=spatial.get(key(point));
      const tile: TileMemory = {
        ...point,
        seenTick: world.tick,
        observedTerritoryId: marks.get(key(point)) ?? null,
        citizens: cell?.citizens.map((other)=>sighting(world,citizen,other))??[],
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
/** Composed civic projections stay knowledge-bounded: signs and houses are
 * exposed only at currently visible tiles (tile memories retain only dated
 * mark affiliation), and territories only through visible signs, own
 * membership or the citizen's own admission (including its final outcome). Foreign rosters are not
 * exposed; an own-membership territory projects its full membership, because
 * co-members are known through shared use, admission votes and events.
 * Own directed reputation opinions are available to the citizen; incoming
 * opinions of others stay hidden. */
function composedProjections(
  world: World,
  citizen: Citizen,
  ownOnly = false,
): { territories: Territory[]; signs: TerritorySign[]; houses: House[]; reputations: Record<string, ReputationLevel> } {
  const signs = Object.values(world.signs ?? {}).filter(
    (sign) => citizen.alive && inSight(citizen, sign),
  );
  const houses = Object.values(world.houses ?? {}).filter(
    (house) => citizen.alive && inSight(citizen, house),
  );
  const all = Object.values(world.territories ?? {});
  const memberships = all.filter((territory) => !!territory.members[citizen.id]);
  const ownRequests = all.filter(
    (territory) =>
      !territory.members[citizen.id] &&
      territory.admissions.some(
        (admission) => admission.applicantId === citizen.id,
      ),
  );
  const knownBySign = new Set(signs.map((sign) => sign.territoryId));
  const seenBySign = all.filter(
    (territory) => knownBySign.has(territory.id) && !memberships.includes(territory) && !ownRequests.includes(territory),
  );
  const detail = (territory: Territory): Territory => {
    const projection = copy(territory);
    projection.memberCount = Object.keys(territory.members).length;
    // Members must see pending requests to exercise their admission vote.
    // Closed requests belong only to their applicant; foreign rosters/votes
    // are stripped in the separate foreign projection below.
    projection.admissions = projection.admissions.filter(
      (admission) => admission.status === 'pending' || admission.applicantId === citizen.id,
    );
    for (const admission of projection.admissions)
      if (admission.applicantId === citizen.id) admission.votes = {};
    return projection;
  };
  const foreign = (territory: Territory): Territory => ({
    ...copy(territory),
    members: {},
    memberCount: Object.keys(territory.members).length,
    admissions: [],
  });
  return {
    territories: [
      ...memberships.map(detail),
      ...(ownOnly ? [] : ownRequests).map((territory) => ({
        ...foreign(territory),
        admissions: territory.admissions
          .filter((admission) => admission.applicantId === citizen.id)
          .map((admission) => ({ ...copy(admission), votes: {} })),
      })),
      ...(ownOnly ? [] : seenBySign).map(foreign),
    ].sort((a, b) => a.id.localeCompare(b.id)),
    signs: signs.map(copy),
    houses: houses.map(copy),
    reputations: { ...world.reputations?.[citizen.id] },
  };
}

/** Pure citizen projection: calling observe does not commit new memories. */
/** Text is optional for structured-only local controllers; legacy/model/API callers
 * retain the full projection by default. No knowledge or state is committed. */
/** Own civic housekeeping: avoid tile/body projection unless a vote is due.
 * relationshipContext reads only people and dated personal memories; deposit
 * grounding does not change those fields. Foreign membership is never returned. */
export function observeCommunityVote(world: World, citizen: Citizen) {
  if (!Object.values(world.territories ?? {}).some(t => !!t.members[citizen.id] && t.admissions.some(a =>
    a.status === 'pending' && a.expiresTick > world.tick && a.votes[citizen.id] === undefined))) return undefined;
  const civic = composedProjections(world, citizen, true);
  const visible = citizen.alive ? currentTiles(world, citizen) : [];
  const visibleKeys = new Set(visible.map(key));
  const remembered = Object.values(citizen.knowledge).filter(tile => !visibleKeys.has(key(tile))).map(sealMemory);
  return { tick: world.tick, citizen: { id: citizen.id, mind: citizen.mind },
    territories: civic.territories, reputations: civic.reputations, visible, remembered };
}

/** Minimal pure entry snapshot shared by busy composed turns and full observers. */
export function observeEntry(world: World, id: string) {
  return { tick: world.tick, citizen: { id },
    alerts: copy(worldEventHistory(world).filter(entry => entry.audience?.includes(id))) };
}

/** Shared non-citizen public windows — global orders, own messages, audience
 * events and public claims/alliances — identical for full public observers and
 * composed decision projections. Escrow outside this citizen is masked. */
function publicTail(
  world: World,
  id: string,
): Pick<CitizenObservation, 'tick' | 'mapSize' | 'markets' | 'messages' | 'alerts' | 'claims' | 'alliances'> {
  return {
    tick: world.tick,
    mapSize: {
      width: world.width,
      height: world.height,
      ...(world.ringCount !== undefined ? { ringCount: world.ringCount } : {}),
    },
    // Orders are global; escrow is not an additional window into private holdings.
    // Building listings carry an optional building projection for location/condition.
    markets: Object.values(world.orders).map((order) => {
      const building = order.item.startsWith('building:')
        ? world.buildings[order.item.slice('building:'.length)]
        : undefined;
      return {
        ...copy(order),
        escrowGold: order.citizenId === id ? order.escrowGold : 0,
        escrowItems: order.citizenId === id ? copy(order.escrowItems) : {},
        ...(building ? { building: copy(building) } : {}),
      };
    }),
    messages: copy(
      world.messages.filter((message) => !message.to || message.from === id || message.to === id),
    ),
    // No audience means spectator-only, not public. Owner alerts use explicit audience.
    alerts: observeEntry(world, id).alerts,
    claims: copy(Object.values(world.claims ?? {})),
    alliances: copy(Object.values(world.alliances ?? {})),
  };
}

export function observe(
  world: World,
  id: string,
  options: { includeText?: boolean } = {},
): CitizenObservation {
  const source = world.citizens[id];
  if (!source) throw new Error(`Unknown citizen: ${id}`);
  // Composed civic projections are knowledge-bounded; legacy worlds stay unchanged.
  const civic =
    world.controllerMode === 'composed' ? composedProjections(world, source) : undefined;
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
  let ascii = '';
  let entityIndex: CitizenObservation['entityIndex'] = [];
  if (options.includeText !== false) {
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
    ascii = rows.join('\n');
    entityIndex = visible
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
  }
  // Orders, messages, alerts and public claims come from the shared windows.
  const tail = publicTail(world, id);
  return {
    tick: tail.tick,
    mapSize: tail.mapSize,
    citizen,
    ascii,
    entityIndex,
    visible,
    remembered,
    markets: tail.markets,
    ...(civic
      ? {
          territories: civic.territories,
          signs: civic.signs,
          houses: civic.houses,
          reputations: civic.reputations,
        }
      : {}),
    messages: tail.messages,
    alerts: tail.alerts,
    claims: tail.claims,
    alliances: tail.alliances,
  };
}

/** Composed decision projection for local tree controllers. Same
 * knowledge-bounded boundary as observe, non-text (no ascii map or entity
 * index), and without the duplicate self notebook: `visible`+`remembered`
 * already carry every projected notebook tile, so `citizen.knowledge` is not
 * cloned and never written back. All real body fields — including the full
 * loadbearing mind clone — stay. Pure: no memories or state are committed. */
export function observeDecision(world: World, id: string): DecisionObservation {
  const source = world.citizens[id];
  if (!source) throw new Error(`Unknown citizen: ${id}`);
  // Composed civic projections are knowledge-bounded; legacy worlds stay unchanged.
  const civic =
    world.controllerMode === 'composed' ? composedProjections(world, source) : undefined;
  const visible = source.alive ? currentTiles(world, source) : [];
  const visibleKeys = new Set(visible.map(key));
  const remembered = Object.values(source.knowledge)
    .filter((tile) => !visibleKeys.has(key(tile)))
    .map(sealMemory);
  // Field-wise clone of the real body: every observable field is deep-cloned
  // exactly like observe's citizen projection, except the self notebook key,
  // whose projected content is the visible+remembered set above.
  const citizen = Object.fromEntries(
    Object.entries(source)
      .filter(([field]) => field !== 'knowledge')
      .map(([field, value]) => [field, copy(value)]),
  ) as Omit<Citizen, 'knowledge'>;
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
  const tail = publicTail(world, id);
  return {
    tick: tail.tick,
    mapSize: tail.mapSize,
    citizen,
    visible,
    remembered,
    markets: tail.markets,
    ...(civic
      ? {
          territories: civic.territories,
          signs: civic.signs,
          houses: civic.houses,
          reputations: civic.reputations,
        }
      : {}),
    messages: tail.messages,
    alerts: tail.alerts,
    claims: tail.claims,
    alliances: tail.alliances,
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
  if (!['harvest','refine','attack','loot','reproduce','consent','transfer','give','message','cancel-order','order','build','build-house','attack-sign'].includes(command.type))
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
  if(command.type==='attack-sign') {
    // Tile memories contain no dated sign identities. A known coordinate
    // cannot establish that a newly built (or destroyed) remote sign exists.
    const sign = world.signs?.[command.signId];
    const current = !!(citizen.alive && sign && inSight(citizen, sign));
    if (!current)
      return fail('unknown-entity','That sign is not known. Travel to inspect it first.');
    if (phase === 'submission' && command.queue === 'append' && citizen.action)
      return ok('Queued intent uses known information; sight and prerequisites will be checked when it starts.');
    return current
      ? ok('Command refers only to known information.')
      : fail('outside-sight','Travel to the sign before attacking it. While work is active, append the known target action to check sight and prerequisites automatically when it starts.');
  }
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
    (command.type === 'build' || command.type === 'build-house') &&
    tiles.some((tile) => tile.x === command.x && tile.y === command.y);
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
    case 'build-house':
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
