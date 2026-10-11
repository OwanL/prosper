import type {
  Citizen,
  Command,
  CommandResult,
  Inventory,
  Point,
  Territory,
  TerritoryAdmission,
  TerritoryMembership,
  TerritorySign,
  Tier,
  World,
} from '../shared/types.ts';
import { isTier } from '../shared/tiers.ts';
import {
  addInventory,
  distance,
  event,
  fail,
  hasInventory,
  id,
  itemKey,
  ok,
  takeInventory,
} from '../shared/utils.ts';
import { inBounds } from './pathfinding.ts';
import { BALANCE, COMPOSED_BALANCE } from './config.ts';

// Marked-tile territory mechanics for the composed controller. Tile membership is
// authoritative in signs (not bounding rectangles); admissions, succession and
// disbanding follow the agreed territory design. Pure eligibility helpers are
// world-authoritative facts; command handling settles synchronously.

const tileKey = ({ x, y }: Point) => `${x},${y}`;
const ADMISSIONS_LIMIT = 64;
const NEIGHBOR_OFFSETS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** The single sign marking a tile, if any; one active territory per tile. */
export function signAt(world: World, point: Point): TerritorySign | undefined {
  return Object.values(world.signs ?? {}).find((sign) => sign.x === point.x && sign.y === point.y);
}

export function territoryAt(world: World, point: Point): Territory | undefined {
  const sign = signAt(world, point);
  return sign ? world.territories?.[sign.territoryId] : undefined;
}

/** A citizen belongs to at most one territory at any time. */
export function territoryOf(world: World, citizenId: string): Territory | undefined {
  return Object.values(world.territories ?? {}).find((territory) => !!territory.members[citizenId]);
}

export function territorySigns(world: World, territoryId: string): TerritorySign[] {
  return Object.values(world.signs ?? {}).filter((sign) => sign.territoryId === territoryId);
}

/** Pure build gate: only current territory members construct inside a marked area;
 * unmarked land stays governed by the ordinary site rules. */
export function canBuildInTerritory(world: World, citizenId: string, point: Point): CommandResult {
  const territory = territoryAt(world, point);
  if (!territory) return ok('The site is outside every territory.');
  if (territory.members[citizenId] && world.citizens[citizenId]?.alive)
    return ok('Territory members may build inside the marked area.');
  return fail('not-member', 'Territory members alone may build inside the marked area.');
}

/** Pure use gate for stations and houses alike (generic location/owner): owners
 * always use their own building; current members share use of buildings inside
 * their active territory; membership never transfers ownership. */
export function canUseTerritoryBuilding(world: World, citizenId: string, building: Point & { ownerId?: string | null }): boolean {
  if (building.ownerId != null && building.ownerId === citizenId) return true;
  const territory = territoryAt(world, building);
  return !!territory && !!territory.members[citizenId] && !!world.citizens[citizenId]?.alive;
}

/** Investment for marking `count` new tiles: 2 wood of the chosen tier per tile. */
export function markingCost(count: number, woodTier: Tier): Inventory {
  return { [itemKey('wood', woodTier)]: COMPOSED_BALANCE.territoryWoodPerTile * count };
}

const livingMembers = (world: World, territory: Territory) =>
  Object.keys(territory.members).filter((memberId) => world.citizens[memberId]?.alive);

const nextSequence = (territory: Territory) =>
  Math.max(-1, ...Object.values(territory.members).map((member) => member.sequence)) + 1;

function addMember(world: World, territory: Territory, citizenId: string): TerritoryMembership {
  const membership: TerritoryMembership = { citizenId, joinedTick: world.tick, sequence: nextSequence(territory) };
  territory.members[citizenId] = membership;
  return membership;
}

/** Longest uninterrupted membership by joinedTick, then join sequence, then ID.
 * Leaving and rejoining creates a fresh membership record, so it resets seniority. */
export function territorySuccessor(world: World, territory: Territory): string | undefined {
  return livingMembers(world, territory)
    .map((memberId) => ({ memberId, membership: territory.members[memberId] }))
    .sort((a, b) =>
      a.membership.joinedTick - b.membership.joinedTick ||
      a.membership.sequence - b.membership.sequence ||
      a.memberId.localeCompare(b.memberId))[0]?.memberId;
}

function fullyConnected(tiles: Point[]): boolean {
  const marks = new Set(tiles.map(tileKey));
  const reach = new Set([tileKey(tiles[0])]);
  const frontier = [tileKey(tiles[0])];
  while (frontier.length) {
    const [x, y] = frontier.pop()!.split(',').map(Number);
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const key = `${x + dx},${y + dy}`;
      if (marks.has(key) && !reach.has(key)) { reach.add(key); frontier.push(key); }
    }
  }
  return reach.size === marks.size;
}

/** Every new tile must connect to an existing mark through existing or new tiles. */
function connectsTo(existing: Point[], tiles: Point[]): boolean {
  const union = new Set([...existing, ...tiles].map(tileKey));
  const reach = new Set(existing.map(tileKey));
  const frontier = [...reach];
  while (frontier.length) {
    const [x, y] = frontier.pop()!.split(',').map(Number);
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const key = `${x + dx},${y + dy}`;
      if (union.has(key) && !reach.has(key)) { reach.add(key); frontier.push(key); }
    }
  }
  return tiles.every((tile) => reach.has(tileKey(tile)));
}

/** Hard claim eligibility: currently inspected land, unclaimed tiles, no nonmember-owned buildings.
 * Signs may share a tile with buildings or deposits; those do not block marking. */
function tilesProblem(world: World, allowedOwners: ReadonlySet<string>, citizen: Citizen, tiles: Point[]): CommandResult | undefined {
  const seen = new Set<string>();
  for (const tile of tiles) {
    if (!Number.isInteger(tile.x) || !Number.isInteger(tile.y) || !inBounds(world, tile))
      return fail('invalid-tiles', 'Mark whole coordinates inside the map.');
    const key = tileKey(tile);
    if (seen.has(key)) return fail('duplicate-tile', 'Each tile may be marked once.');
    seen.add(key);
    if (!citizen.knowledge[key] || distance(citizen, tile) > BALANCE.sightRadius)
      return fail('needs-inspection', 'Travel to inspect all requested tiles before marking them.');
  }
  // Validate every tile's sight before consulting any live occupancy facts.
  for (const tile of tiles) {
    if (signAt(world, tile)) return fail('already-claimed', `Tile (${tile.x},${tile.y}) is already marked by a territory.`);
    for (const building of [...Object.values(world.buildings), ...Object.values(world.houses ?? {})]) {
      if (building.x === tile.x && building.y === tile.y && !allowedOwners.has(building.ownerId ?? ''))
        return fail('outsider-building', `Tile (${tile.x},${tile.y}) holds a building owned by a nonmember.`);
    }
  }
  return undefined;
}

function markTiles(world: World, territory: Territory, tiles: Point[], woodTier: Tier): TerritorySign[] {
  return tiles.map((tile) => {
    const signId = id(world, 'sign');
    const sign: TerritorySign = {
      id: signId, territoryId: territory.id, x: tile.x, y: tile.y, woodTier,
      health: COMPOSED_BALANCE.signHealth, maxHealth: COMPOSED_BALANCE.signHealth,
    };
    (world.signs ??= {})[signId] = sign;
    return sign;
  });
}

function pruneAdmissions(territory: Territory): void {
  while (territory.admissions.length > ADMISSIONS_LIMIT) {
    const resolved = territory.admissions.findIndex((admission) => admission.status !== 'pending');
    territory.admissions.splice(resolved === -1 ? 0 : resolved, 1);
  }
}

/** Strict majority means strictly more than half of all living current members
 * (children count equally and have one equal vote); silence is not approval. */
export function admissionThreshold(territory: Territory, world: World): number {
  return Math.floor(livingMembers(world, territory).length / 2) + 1;
}

const admissionAudience = (world: World, territory: Territory, applicantId: string) =>
  [...new Set([applicantId, ...livingMembers(world, territory)])];

function expireAdmission(world: World, territory: Territory, admission: TerritoryAdmission): void {
  admission.status = 'expired';
  event(world, 'claim', `${world.citizens[admission.applicantId]?.name ?? 'The applicant'}'s membership request expired.`, {
    citizenId: admission.applicantId, targetId: territory.ownerId,
    audience: admissionAudience(world, territory, admission.applicantId),
  });
}

function resolveAdmission(world: World, territory: Territory, admission: TerritoryAdmission): TerritoryAdmission['status'] {
  if (admission.status !== 'pending') return admission.status;
  const applicant = world.citizens[admission.applicantId];
  if (!applicant?.alive) { expireAdmission(world, territory, admission); return admission.status; }
  const members = livingMembers(world, territory);
  const yes = Object.values(admission.votes).filter((accept) => accept).length;
  const no = Object.keys(admission.votes).length - yes;
  if (territoryOf(world, applicant.id)) {
    admission.status = 'rejected';
    event(world, 'claim', `${applicant.name} is already affiliated; the membership request was refused.`, { citizenId: applicant.id, targetId: territory.ownerId, audience: admissionAudience(world, territory, applicant.id) });
    return admission.status;
  }
  if (yes * 2 > members.length) {
    admission.status = 'admitted';
    addMember(world, territory, applicant.id);
    event(world, 'claim', `${applicant.name} joins the territory by majority vote.`, { citizenId: applicant.id, targetId: territory.ownerId, audience: admissionAudience(world, territory, applicant.id) });
    return admission.status;
  }
  // Once yes can no longer strictly exceed half, deny instead of waiting.
  if ((members.length - no) * 2 <= members.length) {
    admission.status = 'rejected';
    event(world, 'claim', `${applicant.name} was refused membership by vote.`, { citizenId: applicant.id, targetId: territory.ownerId, audience: admissionAudience(world, territory, applicant.id) });
  }
  return admission.status;
}

/** Departure ends membership; the departed also lose any pending vote, whose
 * removal re-resolves surviving requests against the smaller membership. */
function removeMembership(world: World, territory: Territory, citizenId: string): void {
  if (!territory.members[citizenId]) return;
  delete territory.members[citizenId];
  for (const admission of territory.admissions) {
    if (admission.status !== 'pending') continue;
    if (admission.applicantId === citizenId) { expireAdmission(world, territory, admission); continue; }
    delete admission.votes[citizenId];
    resolveAdmission(world, territory, admission);
  }
}

/** Disbanding: memberships and shared use end; remaining signs vanish without
 * refund; buildings stay in place with unchanged ownership. No expulsion exists,
 * so disbanding only follows owner departure/death or the last sign falling. */
export function disbandTerritory(world: World, territory: Territory, reason: string): void {
  for (const sign of Object.values(world.signs ?? {}))
    if (sign.territoryId === territory.id) delete world.signs![sign.id];
  delete world.territories![territory.id];
  if (world.offenseCooldowns)
    for (const key of Object.keys(world.offenseCooldowns))
      if (key.startsWith(`${territory.id}:`)) delete world.offenseCooldowns[key];
  event(world, 'claim', `${world.citizens[territory.ownerId]?.name ?? 'A territory'}'s territory disbands (${reason}); signs are removed without refund and buildings remain in place.`, { citizenId: territory.ownerId });
}

function foundTerritory(world: World, citizen: Citizen, tiles: Point[], woodTier: Tier): CommandResult {
  if (!Array.isArray(tiles) || !tiles.length) return fail('invalid-tiles', 'Mark at least one tile.');
  if (tiles.length > COMPOSED_BALANCE.maxTerritoryTilesPerCommand)
    return fail('too-many-tiles', `At most ${COMPOSED_BALANCE.maxTerritoryTilesPerCommand} tiles per command.`);
  if (!isTier(woodTier)) return fail('invalid-wood-tier', 'Choose a wood tier 1 through the world maximum.');
  if (territoryOf(world, citizen.id)) return fail('already-member', 'Leave the current territory before founding another.');
  // The creator's automatic membership lets their own buildings stay; no other
  // building owner is enrolled by creation.
  const problem = tilesProblem(world, new Set([citizen.id]), citizen, tiles);
  if (problem) return problem;
  if (!fullyConnected(tiles)) return fail('disconnected', 'An initial territory forms one connected marked area.');
  const cost = markingCost(tiles.length, woodTier);
  if (!hasInventory(citizen.inventory, cost))
    return fail('insufficient-materials', `Marking costs 2 wood per tile: ${JSON.stringify(cost)}.`);
  takeInventory(citizen.inventory, cost);
  const territory: Territory = {
    id: id(world, 'territory'), ownerId: citizen.id, createdTick: world.tick,
    members: { [citizen.id]: { citizenId: citizen.id, joinedTick: world.tick, sequence: 0 } },
    admissions: [],
  };
  (world.territories ??= {})[territory.id] = territory;
  markTiles(world, territory, tiles, woodTier);
  event(world, 'claim', `${citizen.name} founds a territory on ${tiles.length} marked tiles.`, { citizenId: citizen.id, x: citizen.x, y: citizen.y });
  return ok(`Founded a territory of ${tiles.length} tiles for ${JSON.stringify(cost)}.`);
}

function expandTerritory(world: World, citizen: Citizen, territoryId: string, tiles: Point[], woodTier: Tier): CommandResult {
  const territory = world.territories?.[territoryId];
  if (!territory) return fail('missing-territory', 'That territory no longer exists.');
  if (!territory.members[citizen.id]) return fail('not-member', 'Only current members expand a territory.');
  if (!Array.isArray(tiles) || !tiles.length) return fail('invalid-tiles', 'Mark at least one tile.');
  if (tiles.length > COMPOSED_BALANCE.maxTerritoryTilesPerCommand)
    return fail('too-many-tiles', `At most ${COMPOSED_BALANCE.maxTerritoryTilesPerCommand} tiles per command.`);
  if (!isTier(woodTier)) return fail('invalid-wood-tier', 'Choose a wood tier 1 through the world maximum.');
  const existing = territorySigns(world, territory.id);
  const problem = tilesProblem(world, new Set(livingMembers(world, territory)), citizen, tiles);
  if (problem) return problem;
  if (!connectsTo(existing, tiles)) return fail('disconnected', 'Additions must connect through existing or newly marked tiles.');
  const cost = markingCost(tiles.length, woodTier);
  if (!hasInventory(citizen.inventory, cost))
    return fail('insufficient-materials', `Marking costs 2 wood per tile: ${JSON.stringify(cost)}.`);
  takeInventory(citizen.inventory, cost); // Any member may expand, paying from their own wood.
  markTiles(world, territory, tiles, woodTier);
  event(world, 'claim', `${citizen.name} expands the territory by ${tiles.length} marked tiles.`, { citizenId: citizen.id, x: citizen.x, y: citizen.y });
  return ok(`Expanded the territory by ${tiles.length} tiles for ${JSON.stringify(cost)}.`);
}

function requestAdmission(world: World, citizen: Citizen, territoryId: string): CommandResult {
  const territory = world.territories?.[territoryId];
  if (!territory) return fail('missing-territory', 'That territory no longer exists.');
  if (territoryOf(world, citizen.id)) return fail('already-member', 'Leave the current territory before requesting another.');
  if (territory.admissions.some((admission) => admission.status === 'pending' && admission.applicantId === citizen.id))
    return fail('admission-pending', 'A membership request is already pending.');
  const admission: TerritoryAdmission = {
    id: id(world, 'admission'), applicantId: citizen.id, requestedTick: world.tick,
    expiresTick: world.tick + COMPOSED_BALANCE.admissionTimeoutTicks, votes: {}, status: 'pending',
  };
  territory.admissions.push(admission);
  pruneAdmissions(territory);
  event(world, 'claim', `${citizen.name} requests to join the territory.`, { citizenId: citizen.id, targetId: territory.ownerId, audience: admissionAudience(world, territory, citizen.id) });
  return ok(`Request pending: ${admissionThreshold(territory, world)} of ${livingMembers(world, territory).length} member votes are needed before tick ${admission.expiresTick}.`);
}

function castVote(world: World, citizen: Citizen, admissionId: string, territoryId: string, accept: boolean): CommandResult {
  const territory = world.territories?.[territoryId];
  if (!territory) return fail('missing-territory', 'That territory no longer exists.');
  if (!territory.members[citizen.id]) return fail('not-member', 'Only current members vote on admissions.');
  const admission = territory.admissions.find((entry) => entry.id === admissionId);
  if (!admission) return fail('missing-admission', 'That admission request does not exist.');
  if (admission.status !== 'pending')
    return fail('admission-closed', `The admission request is already ${admission.status}.`);
  admission.votes[citizen.id] = accept;
  const status = resolveAdmission(world, territory, admission);
  const applicant = world.citizens[admission.applicantId]?.name ?? 'The applicant';
  return status === 'admitted' ? ok(`Vote recorded; ${applicant} joined.`)
    : status === 'rejected' ? ok(`Vote recorded; ${applicant} was refused.`)
    : ok(`Vote recorded; ${admissionThreshold(territory, world)} yes votes of ${livingMembers(world, territory).length} members are still needed.`);
}

function leaveTerritory(world: World, citizen: Citizen): CommandResult {
  const territory = territoryOf(world, citizen.id);
  if (!territory) return fail('not-member', 'There is no membership to leave.');
  if (territory.ownerId === citizen.id) {
    disbandTerritory(world, territory, `${citizen.name} left`);
    return ok('Left the territory; it disbanded and its signs were removed without refund.');
  }
  removeMembership(world, territory, citizen.id);
  event(world, 'claim', `${citizen.name} left the territory.`, { citizenId: citizen.id, targetId: territory.ownerId });
  return ok('Left the territory; owned buildings stay in place with unchanged ownership.');
}

/** Synchronous settlement of the social territory commands. Returns undefined for
 * any other command so the caller continues its own handling. Physical marking
 * work (travel, attack-sign damage) belongs to the caller's action layer; these
 * settle only the consensual record and marking costs. */
export function handleTerritoryCommand(world: World, citizen: Citizen, command: Command): CommandResult | undefined {
  switch (command.type) {
    case 'create-territory':
      if (!citizen?.alive || citizen.health <= 0)
        return fail('unavailable-citizen', 'A living, healthy citizen is required.');
      return foundTerritory(world, citizen, command.tiles, command.woodTier);
    case 'expand-territory':
      if (!citizen?.alive || citizen.health <= 0)
        return fail('unavailable-citizen', 'A living, healthy citizen is required.');
      return expandTerritory(world, citizen, command.territoryId, command.tiles, command.woodTier);
    case 'join-territory':
      if (!citizen?.alive || citizen.health <= 0)
        return fail('unavailable-citizen', 'A living, healthy citizen is required.');
      return requestAdmission(world, citizen, command.territoryId);
    case 'leave-territory':
      if (!citizen?.alive || citizen.health <= 0)
        return fail('unavailable-citizen', 'A living, healthy citizen is required.');
      return leaveTerritory(world, citizen);
    case 'vote-territory':
      if (!citizen?.alive || citizen.health <= 0)
        return fail('unavailable-citizen', 'A living, healthy citizen is required.');
      return castVote(world, citizen, command.admissionId, command.territoryId, command.accept);
    default:
      return undefined;
  }
}

/** Admission expiry, dead-member cleanup, seniority fallback, orphan-sign and
 * cooldown pruning. Integrators call this once per tick alongside maintainSociety. */
export function maintainTerritories(world: World): void {
  for (const [signId, sign] of Object.entries(world.signs ?? {}))
    if (!world.territories?.[sign.territoryId]) delete world.signs![signId];
  for (const territory of [...Object.values(world.territories ?? {})]) {
    for (const memberId of Object.keys(territory.members))
      if (!world.citizens[memberId]?.alive) removeMembership(world, territory, memberId);
    if (!territory.members[territory.ownerId]) {
      const successor = territorySuccessor(world, territory);
      if (!successor) { disbandTerritory(world, territory, 'no surviving members'); continue; }
      territory.ownerId = successor;
      event(world, 'claim', `${world.citizens[successor]?.name ?? successor} inherits the territory leadership by seniority.`, { citizenId: successor, targetId: territory.id });
    }
    for (const admission of territory.admissions)
      if (admission.status === 'pending' && admission.expiresTick <= world.tick)
        expireAdmission(world, territory, admission);
    pruneAdmissions(territory);
    if (!Object.values(world.signs ?? {}).some((sign) => sign.territoryId === territory.id))
      disbandTerritory(world, territory, 'its last sign fell');
  }
  if (world.offenseCooldowns)
    for (const [key, until] of Object.entries(world.offenseCooldowns))
      if (until <= world.tick) delete world.offenseCooldowns[key];
}

/** Death ends membership. Owner succession: an eligible killer first (same-territory
 * member, or an unaffiliated killer, who then joins), otherwise the longest-serving
 * survivor. Natural death always uses seniority. No building estates move here.
 * The killer may be given as citizen object or ID (life.ts passes either form). */
export function settleTerritoryDeath(world: World, dead: Citizen | string, killer?: Citizen | string): void {
  const citizen = typeof dead === 'string' ? world.citizens[dead] : dead;
  if (!citizen) return;
  const territory = Object.values(world.territories ?? {}).find((entry) => !!entry.members[citizen.id]);
  if (!territory) return;
  const wasOwner = territory.ownerId === citizen.id;
  removeMembership(world, territory, citizen.id);
  if (!wasOwner) return;
  const killerCitizen = typeof killer === 'string' ? world.citizens[killer] : killer;
  const killerId = typeof killer === 'string' ? killer : killer?.id;
  const eligible = !!killerCitizen?.alive && killerId !== citizen.id && killerId !== undefined;
  if (eligible && territory.members[killerId!]) {
    territory.ownerId = killerId!;
    event(world, 'claim', `${killerCitizen!.name} claims the territory leadership of ${citizen.name}.`, { citizenId: killerId!, targetId: citizen.id });
    return;
  }
  if (eligible && !territoryOf(world, killerId!)) {
    addMember(world, territory, killerId!);
    territory.ownerId = killerId!;
    event(world, 'claim', `${killerCitizen!.name} conquered the territory leadership of ${citizen.name} and joins it.`, { citizenId: killerId!, targetId: citizen.id });
    return;
  }
  const successor = territorySuccessor(world, territory);
  if (!successor) { disbandTerritory(world, territory, `${citizen.name} died with no surviving members`); return; }
  territory.ownerId = successor;
  event(world, 'claim', `${world.citizens[successor]?.name ?? successor} succeeds ${citizen.name} by membership seniority.`, { citizenId: successor, targetId: citizen.id });
}

/** Newborns join without a vote when both parents share one active territory.
 * Membership is then independent: a later parent departure never moves the child. */
export function inheritTerritoryMembership(
  world: World, child: Citizen | string, parentA: Citizen | string, parentB: Citizen | string,
): Territory | undefined {
  const parents = [parentA, parentB].map((parent) => (typeof parent === 'string' ? world.citizens[parent] : parent));
  if (parents.some((parent) => !parent?.alive)) return undefined;
  const [first, second] = parents.map((parent) => territoryOf(world, parent!.id));
  if (!first || first !== second) return undefined;
  const childId = typeof child === 'string' ? child : child.id;
  const childCitizen = typeof child === 'string' ? world.citizens[child] : child;
  if (!childCitizen || first.members[childId]) return first;
  addMember(world, first, childId);
  return first;
}

/** Deliberate sign destruction: the tile is freed immediately while other signs
 * retain the territory identity; the destroyer recovers half the marking wood
 * (no full reimbursement), and losing the last sign disbands without refund. */
export function destroyTerritorySign(world: World, signId: string, actorId: string): CommandResult {
  const sign = world.signs?.[signId];
  if (!sign) return fail('missing-sign', 'That sign no longer exists.');
  delete world.signs![signId];
  const actor = actorId ? world.citizens[actorId] : undefined;
  let recovery = 0;
  if (actor?.alive) {
    recovery = COMPOSED_BALANCE.territoryWoodPerTile * COMPOSED_BALANCE.signRecoveryFraction;
    event(world, 'destruction', `${actor.name} breaks a territory sign at (${sign.x},${sign.y}).`, { citizenId: actor.id, x: sign.x, y: sign.y });
  }
  if (recovery > 0) addInventory(actor!.inventory, { [`wood:${sign.woodTier}`]: recovery });
  const territory = world.territories?.[sign.territoryId];
  if (territory && !Object.values(world.signs ?? {}).some((entry) => entry.territoryId === territory.id))
    disbandTerritory(world, territory, 'its last sign fell');
  return ok(`Sign destroyed; ${recovery} wood:${sign.woodTier} recovered.`);
}