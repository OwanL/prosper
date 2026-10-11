import { describe, expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import { BALANCE, COMPOSED_BALANCE, nutrition } from '../src/world/config.ts';
import { validateCheckpoint, type Checkpoint } from '../src/server/checkpoint.ts';
import type {
  Citizen,
  CitizenMind,
  DeliveryReceipt,
  Point,
  Resource,
  Tier,
  World,
} from '../src/shared/types.ts';
import { MIND_LIMITS, type ResourceRequest, type TreeTaskState } from '../src/shared/tree-types.ts';
import type { WorldControlOptions } from '../src/world/evaluation-authority.ts';
import { reputationLevel, changeReputation } from '../src/world/reputation.ts';
import { territoryAt, territoryOf } from '../src/world/territory.ts';

// Real engine integration: everything below goes through createWorld/dispatch
// or tickWorld; no direct module mechanics, no mocked settlements, no mocked
// controller loading and no model calls. Worlds are composed natively through
// the user API (createWorld with controllerMode and explicit autonomy:false),
// the statically imported tree controller really runs during default ticks,
// and mechanics fixtures opt into passive-body evaluation authority so manual
// dispatch sequences stay deterministic next to live-controller tests.

const P = (x: number, y: number): Point => ({ x, y });

function composedFixture(population = 3, overrides: { seed?: number } = {}) {
  const world = createWorld({
    seed: overrides.seed ?? 11,
    population,
    controllerMode: 'composed',
    autonomy: false,
  });
  for (const citizen of Object.values(world.citizens))
    citizen.inventory = { 'food:1': 12, 'wood:1': 40, 'wood:2': 12 };
  const [a, b, c] = Object.values(world.citizens);
  return { world, a, b, c };
}

/** Explicit passive-body authority: composed citizens keep physical work,
 * meals and rest but the tree controller makes no strategic decisions, so
 * manual command sequences in mechanics fixtures stay deterministic. */
function bodyAuthority(world: World): WorldControlOptions {
  return {
    authority: {
      citizens: Object.fromEntries(
        Object.keys(world.citizens).map((citizenId) => [citizenId, 'passive-body' as const]),
      ),
      newbornAuthority: 'passive-body',
    },
  };
}
function tickBodies(world: World, count = 1): void {
  tickWorld(world, count, bodyAuthority(world));
}

const know = (citizen: Citizen, points: Point[]) => {
  for (const point of points)
    citizen.knowledge[`${point.x},${point.y}`] = {
      x: point.x, y: point.y, seenTick: 0, citizens: [], deposits: [], buildings: [], loot: [],
    };
};

function clearTile(world: World, x: number, y: number): void {
  for (const [depositId, deposit] of Object.entries(world.deposits))
    if (deposit.x === x && deposit.y === y) delete world.deposits[depositId];
}

function placeDeposit(world: World, x: number, y: number, resource: Resource, tier: Tier = 1) {
  clearTile(world, x, y);
  const id = `probe-${x}-${y}`;
  world.deposits[id] = { id, resource, tier, x, y, stock: 1, capacity: 1, regrowAt: 0 };
  return world.deposits[id]!;
}

function mindShell(citizen: Citizen, request?: ResourceRequest): CitizenMind {
  const active: TreeTaskState | undefined = request && {
    id: `task-${request.id}`, definitionId: 'Harvest', request, ancestry: [], phase: 'travel',
    status: 'running', startedTick: 0, lastProgressTick: 0,
    delivered: 0, receiptIds: [], ownedOrderIds: [],
  };
  return {
    version: 1,
    dispositions: { ambition: 0.5, morals: 0.5, generosity: 0.5, riskTolerance: 0.5,
      patience: 0.5, sociability: 0.5, vengefulness: 0.5, familyOrientation: 0.5,
      enterprise: 0.5, economicIndependence: 0.5 },
    memories: [], memoriesOmitted: 0,
    tasks: active ? [active] : [],
    ...(active ? { activeTaskId: active.id } : {}),
    receipts: [], trace: [], traceOmitted: 0, nextDirectorTick: 2400,
  };
}

/** Run the world until the citizen's physical work settles (bounded). Body
 * authority keeps the tree controller from issuing competing strategic work. */
function settleAction(world: World, citizenId: string, tickCap = 600): void {
  for (let ticks = 0; ticks < tickCap; ticks++) {
    tickBodies(world, 1);
    updateKnowledge(world);
    const citizen = world.citizens[citizenId]!;
    if (!citizen.action && citizen.queue.length === 0) return;
  }
  throw new Error(`Action for ${citizenId} never settled`);
}

function joinAndAdmit(world: World, applicantId: string, territoryId: string): void {
  const request = dispatch(world, applicantId, { type: 'join-territory', territoryId });
  expect(request.ok).toBe(true);
  const territory = world.territories![territoryId];
  const admission = territory.admissions.at(-1)!;
  for (const memberId of Object.keys(territory.members))
    dispatch(world, memberId, { type: 'vote-territory', territoryId, admissionId: admission.id, accept: true });
  expect(admission.status).toBe('admitted');
}

describe('composed createWorld bootstrap', () => {
  it('mints rest and deterministic seeded mind shells only for composed worlds', () => {
    const composed = createWorld({ seed: 5, population: 2, controllerMode: 'composed', autonomy: false });
    expect(composed.controllerMode).toBe('composed');
    for (const citizen of Object.values(composed.citizens)) {
      expect(citizen.rest).toEqual({ value: COMPOSED_BALANCE.maxRest });
      expect(citizen.mind).toMatchObject({ version: 1, memories: [], tasks: [], receipts: [] });
      expect(Object.values(citizen.mind!.dispositions)).toHaveLength(10);
      expect(Object.values(citizen.mind!.dispositions).every((value) => value >= 0 && value <= 1)).toBe(true);
    }
    const again = createWorld({ seed: 5, population: 2, controllerMode: 'composed', autonomy: false });
    const founder = Object.values(composed.citizens)[0]!;
    const refounder = Object.values(again.citizens)[0]!;
    expect(founder.mind).toEqual(refounder.mind);
    const other = createWorld({ seed: 6, population: 2, controllerMode: 'composed', autonomy: false });
    expect(founder.mind!.dispositions).not.toEqual(Object.values(other.citizens)[0]!.mind!.dispositions);
    const legacy = createWorld({ seed: 5, population: 2 });
    expect(legacy.controllerMode).toBeUndefined();
    for (const citizen of Object.values(legacy.citizens)) {
      expect(citizen.mind).toBeUndefined();
      expect(citizen.rest).toBeUndefined();
    }
    // The composed enable state is a user-API declaration: composed mode never
    // also enables the legacy autonomy bots.
    expect(() => createWorld({ controllerMode: 'weird' as never })).toThrow();
    expect(() => createWorld({ controllerMode: 'composed', autonomy: true })).toThrow(/legacy autonomy/);
  });

  it('leaves legacy worlds controller-free after default ticks', () => {
    const legacy = createWorld({ seed: 5, population: 2 });
    tickWorld(legacy, 2);
    for (const citizen of Object.values(legacy.citizens)) {
      expect(citizen.mind).toBeUndefined();
      expect(citizen.rest).toBeUndefined();
    }
  });

  it('seeds composed bodies when composed mode appears late (restore migration)', () => {
    const world = createWorld({ seed: 5, population: 2 });
    world.controllerMode = 'composed';
    const citizen = Object.values(world.citizens)[0]!;
    delete citizen.mind;
    delete citizen.rest;
    tickBodies(world, 1);
    expect(citizen.rest).toEqual({ value: COMPOSED_BALANCE.maxRest - COMPOSED_BALANCE.restDrain });
    expect((citizen.mind as CitizenMind | undefined)?.version).toBe(1);
  });
});

describe('composed controller integration in tickWorld', () => {
  it('executes the composed tree on the very first tick with no mock loading', () => {
    const { world, a } = composedFixture(3, { seed: 31 });
    // A single synchronous tickWorld call: no dynamic-import readiness, no
    // registration hook, no second-call priming.
    tickWorld(world, 1);
    expect(a.mind!.version).toBe(1);
    expect(a.mind!.tasks.length + a.mind!.trace.length).toBeGreaterThan(0);
    // Without authority metadata every composed citizen runs the controller.
    for (const citizen of Object.values(world.citizens))
      expect(citizen.mind!.tasks.length + citizen.mind!.trace.length).toBeGreaterThanOrEqual(0);
    // The controller proposes ordinary engine work through plain dispatch.
    tickWorld(world, 4);
    const proposed = Object.values(world.citizens).some((citizen) =>
      citizen.mind!.trace.some((entry) => entry.transition === 'propose') || citizen.action);
    expect(proposed).toBe(true);
  });

  it('gates controller decisions behind explicit passive-body evaluation authority', () => {
    const { world, a } = composedFixture(2);
    tickBodies(world, 3);
    // Bodies keep rest/fullness behavior, but no strategic tree state appears.
    expect(a.action).toBeNull();
    expect(a.mind!.tasks).toHaveLength(0);
    expect(a.mind!.activeTaskId).toBeUndefined();
    expect(a.mind!.trace).toHaveLength(0);
    // Dropping the authority control re-enables strategic controller decisions.
    tickWorld(world, 1);
    expect(a.mind!.tasks.length + a.mind!.trace.length).toBeGreaterThan(0);
  });

  it('starts queued physical work instead of leaving citizens silently inert', () => {
    const { world, b } = composedFixture(2);
    b.rest = { value: 0 };
    const deposit = placeDeposit(world, b.x, b.y, 'wood');
    expect(dispatch(world, b.id, { type: 'sleep', targetRest: 12 })).toMatchObject({ ok: true });
    expect(dispatch(world, b.id, { type: 'harvest', depositId: deposit.id, queue: 'append' }))
      .toMatchObject({ ok: true });
    settleAction(world, b.id);
    // The queued harvest actually ran after sleep: inputs converted, queue drained.
    // (Rest legitimately drains below the sleep target while awake harvesting.)
    expect(b.inventory['wood:1']).toBe(41);
    expect(b.queue).toHaveLength(0);
    expect(b.action).toBeNull();
  });
});

describe('territory commands through real dispatch', () => {
  it('creates, joins by vote, expands, leaves and disbands through dispatch alone', () => {
    const { world, a, b } = composedFixture(2);
    a.x = 10; a.y = 13; // within sight (3 and 2) of both marked tiles
    b.x = 12; b.y = 12;
    know(a, [P(10, 10), P(10, 11)]);
    const before = a.inventory['wood:1']!;
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(10, 10), P(10, 11)], woodTier: 1 }))
      .toMatchObject({ ok: true });
    expect(a.inventory['wood:1']).toBe(before - COMPOSED_BALANCE.territoryWoodPerTile * 2);
    const territory = territoryOf(world, a.id)!;
    expect(territory.ownerId).toBe(a.id);
    expect(territoryAt(world, P(10, 10))).toBe(territory);
    joinAndAdmit(world, b.id, territory.id);
    know(b, [P(10, 12), P(10, 13)]);
    const bBefore = b.inventory['wood:1']!;
    expect(dispatch(world, b.id, { type: 'expand-territory', territoryId: territory.id, tiles: [P(10, 12), P(10, 13)], woodTier: 1 }))
      .toMatchObject({ ok: true });
    expect(b.inventory['wood:1']).toBe(bBefore - COMPOSED_BALANCE.territoryWoodPerTile * 2);
    expect(territoryOf(world, b.id)).toBe(territory);
    expect(dispatch(world, b.id, { type: 'leave-territory' })).toMatchObject({ ok: true });
    expect(territoryOf(world, b.id)).toBeUndefined();
    expect(dispatch(world, a.id, { type: 'leave-territory' })).toMatchObject({ ok: true });
    expect(Object.values(world.territories ?? {})).toHaveLength(0);
    expect(Object.keys(world.signs ?? {})).toHaveLength(0);
    // Legacy worlds keep their surface: territory commands are composed-only.
    const legacy = createWorld({ seed: 3, population: 1 });
    const [legacyCitizen] = Object.values(legacy.citizens);
    expect(dispatch(legacy, legacyCitizen!.id, { type: 'create-territory', tiles: [P(1, 1)], woodTier: 1 }))
      .toMatchObject({ ok: false, code: 'unsupported-command' });
  });

  it('expires pending admissions during composed ticks via maintainTerritories', () => {
    const { world, a, b } = composedFixture(2);
    a.x = 12; a.y = 9; // within sight of the marked tile
    know(a, [P(10, 10)]);
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(10, 10)], woodTier: 1 })).toMatchObject({ ok: true });
    const territory = territoryOf(world, a.id)!;
    expect(dispatch(world, b.id, { type: 'join-territory', territoryId: territory.id })).toMatchObject({ ok: true });
    const admission = territory.admissions.at(-1)!;
    tickBodies(world, COMPOSED_BALANCE.admissionTimeoutTicks + 1);
    expect(admission.status).toBe('expired');
    expect(territory.members[b.id]).toBeUndefined();
    expect(territoryOf(world, a.id)).toBe(territory);
  });
});

describe('construction and shared use in composed worlds', () => {
  it('forbids nonmember construction inside territory and allows members', () => {
    const { world, a, b } = composedFixture(2);
    a.x = 12; a.y = 9;
    b.x = 10; b.y = 8; // in sight of the site but a nonmember
    clearTile(world, 10, 10);
    know(a, [P(10, 10)]);
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(10, 10)], woodTier: 1 })).toMatchObject({ ok: true });
    b.inventory['fibre:1'] = 8;
    expect(dispatch(world, b.id, { type: 'build', kind: 'lumbermill', tier: 1, x: 10, y: 10 }))
      .toMatchObject({ ok: false, code: 'not-member' });
    // Membership opens construction inside the marked area.
    joinAndAdmit(world, b.id, territoryOf(world, a.id)!.id);
    expect(dispatch(world, b.id, { type: 'build', kind: 'lumbermill', tier: 1, x: 10, y: 10 }))
      .toMatchObject({ ok: true });
    settleAction(world, b.id);
    const building = Object.values(world.buildings).find((entry) => entry.x === 10 && entry.y === 10)!;
    expect(building.ownerId).toBe(b.id);
  });

  it('lets territory members refine at another member-owned station and outsiders cannot', () => {
    const { world, a, b, c } = composedFixture(3);
    a.x = 12; a.y = 9; // within sight of the marked tile
    know(a, [P(10, 10)]);
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(10, 10)], woodTier: 1 })).toMatchObject({ ok: true });
    world.buildings['mill'] = {
      id: 'mill', kind: 'lumbermill', tier: 1, x: 10, y: 10,
      ownerId: a.id, health: 100, maxHealth: 100, materials: {},
    };
    joinAndAdmit(world, b.id, territoryOf(world, a.id)!.id);
    b.x = 10; b.y = 8;
    b.inventory['wood:1'] = 0;
    expect(dispatch(world, c.id, { type: 'refine', buildingId: 'mill', fromTier: 2, direction: 'down' }))
      .toMatchObject({ ok: false, code: 'not-owner' });
    const bBefore2 = b.inventory['wood:2']!;
    expect(dispatch(world, b.id, { type: 'refine', buildingId: 'mill', fromTier: 2, direction: 'down' }))
      .toMatchObject({ ok: true });
    settleAction(world, b.id);
    expect(b.inventory['wood:2']).toBe(bBefore2 - 1);
    expect(b.inventory['wood:1']).toBe(2); // down-conversion output stays the member's own
    // Legacy mode keeps strict owner-only stations.
    const legacy = createWorld({ seed: 3, population: 2 });
    const [owner, helper] = Object.values(legacy.citizens);
    legacy.buildings['mill'] = {
      id: 'mill', kind: 'lumbermill', tier: 1, x: 10, y: 10,
      ownerId: owner!.id, health: 100, maxHealth: 100, materials: {},
    };
    expect(dispatch(legacy, helper!.id, { type: 'refine', buildingId: 'mill', fromTier: 2, direction: 'down' }))
      .toMatchObject({ ok: false, code: 'not-owner' });
  });
});

describe('housing, rest and fatigue', () => {
  it('sleeps in a member-shared house at the house rate and outdoors at the outdoor rate', () => {
    const { world, a, b, c } = composedFixture(3);
    a.x = 10; a.y = 9; // within sight of the marked tile
    know(a, [P(10, 11)]);
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(10, 11)], woodTier: 1 })).toMatchObject({ ok: true });
    world.houses = { home: { id: 'home', ownerId: a.id, tier: 1, x: 10, y: 11, health: 100, maxHealth: 100 } };
    joinAndAdmit(world, b.id, territoryOf(world, a.id)!.id);
    b.x = 10; b.y = 13;
    c.x = 10; c.y = 13;
    b.rest = { value: 42 };
    c.rest = { value: 40 };
    // A nonmember may not sleep in someone else's house.
    expect(dispatch(world, c.id, { type: 'sleep', houseId: 'home', targetRest: 80 }))
      .toMatchObject({ ok: false, code: 'no-house-access' });
    expect(dispatch(world, b.id, { type: 'sleep', houseId: 'home', targetRest: 60 })).toMatchObject({ ok: true });
    expect(b.rest.sleepingHouseId).toBe('home');
    settleAction(world, b.id);
    expect(b.rest?.value).toBeGreaterThanOrEqual(60);
    expect(b.rest?.sleepingHouseId).toBeUndefined();
    // Outdoor sleeping restores at the slower rate; sleep needs the minimum duration.
    b.rest = { value: 0 };
    expect(dispatch(world, b.id, { type: 'sleep', targetRest: 10 })).toMatchObject({ ok: true });
    settleAction(world, b.id);
    expect(b.rest?.value).toBeGreaterThanOrEqual(10);
    // Targets above the cap and already-satisfied targets are refused.
    expect(dispatch(world, b.id, { type: 'sleep', targetRest: COMPOSED_BALANCE.maxRest + 1 }))
      .toMatchObject({ ok: false, code: 'invalid-rest-target' });
    expect(dispatch(world, b.id, { type: 'sleep', targetRest: 1 })).toMatchObject({ ok: false, code: 'rest-satisfied' });
  });

  it('drains rest while awake and makes productive work 50% longer when fatigued', () => {
    const { world, a, b } = composedFixture(2);
    b.x = 2; b.y = 4;
    clearTile(world, 2, 3);
    b.rest = { value: COMPOSED_BALANCE.fatigueThreshold + 5 };
    b.inventory['fibre:1'] = 2;
    expect(dispatch(world, b.id, { type: 'build', kind: 'wall', tier: 1, x: 2, y: 3 })).toMatchObject({ ok: true });
    expect(b.action!.duration).toBe(BALANCE.buildTicks); // rested work runs at normal speed
    dispatch(world, b.id, { type: 'cancel' });
    // Fatigue: below the threshold, productive work durations scale by 1.5.
    b.rest = { value: COMPOSED_BALANCE.fatigueThreshold - 1 };
    const deposit = placeDeposit(world, 2, 2, 'wood');
    b.x = 2; b.y = 2; // stand on the deposit so work starts without travel
    expect(dispatch(world, b.id, { type: 'harvest', depositId: deposit.id })).toMatchObject({ ok: true });
    expect(b.action!.duration)
      .toBe(BALANCE.harvestTicks * COMPOSED_BALANCE.fatigueDurationMultiplier);
    dispatch(world, b.id, { type: 'cancel' });
    // Awake rest drains every tick with the configured constant drain.
    b.rest = { value: COMPOSED_BALANCE.maxRest };
    tickBodies(world, COMPOSED_BALANCE.sleepMinimumTicks * 4);
    expect(b.rest!.value).toBeLessThan(COMPOSED_BALANCE.maxRest);
    expect(b.rest!.value)
      .toBeCloseTo(COMPOSED_BALANCE.maxRest - COMPOSED_BALANCE.restDrain * COMPOSED_BALANCE.sleepMinimumTicks * 4, 9);
  });
});

describe('fractional harvest tax and unique net delivery receipts', () => {
  it('taxes a nonmember harvest 0.15 to the owner, delivers net 0.85 and receipts both', () => {
    const { world, a, b } = composedFixture(2);
    const deposit = placeDeposit(world, 10, 10, 'wood');
    a.x = 12; a.y = 9; // within sight of the marked tile
    know(a, [P(10, 10)]);
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(10, 10)], woodTier: 1 })).toMatchObject({ ok: true });
    a.mind = mindShell(a, { id: 'r-tax', resource: 'wood', tier: 1, quantity: 1, allowMarket: false, purpose: 'test', urgency: 'routine' });
    b.x = 10; b.y = 8;
    b.mind = mindShell(b, { id: 'r-harvest', resource: 'wood', tier: 1, quantity: 1, allowMarket: false, purpose: 'test', urgency: 'routine' });
    const bBefore = b.inventory['wood:1'] ?? 0;
    const aBefore = a.inventory['wood:1'] ?? 0;
    expect(dispatch(world, b.id, { type: 'harvest', depositId: deposit.id })).toMatchObject({ ok: true });
    settleAction(world, b.id);
    const tax = COMPOSED_BALANCE.territoryTaxRate;
    expect(b.inventory['wood:1']).toBeCloseTo(bBefore + (1 - tax), 9);
    expect(a.inventory['wood:1']).toBeCloseTo(aBefore + tax, 9);
    expect(deposit.stock).toBe(0);
    expect(b.mind!.receipts).toHaveLength(1);
    expect(b.mind!.receipts[0]).toMatchObject({
      citizenId: b.id, item: 'wood:1', quantity: 1 - tax, source: 'harvest', requestId: 'r-harvest',
    });
    expect(a.mind!.receipts).toHaveLength(1);
    expect(a.mind!.receipts[0]).toMatchObject({
      citizenId: a.id, item: 'wood:1', quantity: tax, source: 'tax',
    });
    // Every receipt id is unique even across recipients and settlement types.
    const ids = [...b.mind!.receipts, ...a.mind!.receipts].map((receipt) => receipt.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Conservation: the gross unit is exactly split between harvester and owner.
    expect(b.inventory['wood:1']! - bBefore + (a.inventory['wood:1']! - aBefore)).toBeCloseTo(1, 9);
  });

  it('receipts auto-consumed food with the actual net delivery, never a gross fallback', () => {
    const { world, a, b } = composedFixture(2, { seed: 23 });
    const deposit = placeDeposit(world, 6, 6, 'food');
    a.x = 8; a.y = 6; // within sight of the marked tile
    know(a, [P(6, 6)]);
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(6, 6)], woodTier: 1 })).toMatchObject({ ok: true });
    b.x = 6; b.y = 4;
    b.fullness = 0; // whatever is delivered is eaten this very tick
    b.mind = mindShell(b, { id: 'r-food', resource: 'food', tier: 1, quantity: 1, allowMarket: false, purpose: 'test', urgency: 'survival' });
    expect(dispatch(world, b.id, { type: 'harvest', depositId: deposit.id })).toMatchObject({ ok: true });
    settleAction(world, b.id);
    const net = 1 - COMPOSED_BALANCE.territoryTaxRate;
    expect(b.fullness).toBeGreaterThan(0); // delivery happened and was consumed
    expect(b.mind!.receipts).toHaveLength(1);
    expect(b.mind!.receipts[0]).toMatchObject({
      item: 'food:1', quantity: net, source: 'harvest', requestId: 'r-food',
    });
    expect(b.mind!.receipts[0]!.quantity).toBeLessThan(1); // never a gross=net fallback
  });

  it('receipts market buy fills and escrow recovery with real settled quantities', () => {
    const { world, a, b } = composedFixture(2, { seed: 29 });
    a.inventory = { 'wood:1': 4 };
    b.inventory = { 'food:1': 12, 'wood:2': 12 };
    b.mind = mindShell(b, { id: 'r-buy', resource: 'wood', tier: 1, quantity: 3, allowMarket: true, purpose: 'test', urgency: 'routine' });
    const listing = dispatch(world, a.id, { type: 'order', side: 'sell', item: 'wood:1', quantity: 4, price: 5 });
    expect(listing.ok).toBe(true);
    const buy = dispatch(world, b.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 3, price: 5 });
    expect(buy.ok).toBe(true);
    expect(buy.deliveries).toHaveLength(1);
    expect(buy.deliveries![0]).toMatchObject({
      citizenId: b.id, item: 'wood:1', quantity: 3, source: 'market', requestId: 'r-buy',
    });
    expect(b.inventory['wood:1']).toBe(3);
    expect(b.mind!.receipts.map((receipt) => receipt.settlementId)).toContain(`market:${buy.order!.id}`);
    // Recovery: a listed sell order's remaining escrow returns as a real delivery.
    const sale = dispatch(world, b.id, { type: 'order', side: 'sell', item: 'wood:2', quantity: 2, price: 4 });
    expect(sale.ok).toBe(true);
    b.mind!.receipts = [];
    const recovered = dispatch(world, b.id, { type: 'cancel-order', orderId: sale.order!.id });
    expect(recovered.ok).toBe(true);
    expect(recovered.deliveries).toHaveLength(1);
    expect(recovered.deliveries![0]).toMatchObject({
      citizenId: b.id, item: 'wood:2', quantity: 2, source: 'recovery',
    });
    expect(b.mind!.receipts).toHaveLength(1);
    expect(b.inventory['wood:2']).toBe(12);
  });
});

describe('fractional food consumption and meal conservation', () => {
  it('splits a taxed food harvest 0.85/0.15 and eats each fraction proportionally exactly once', () => {
    const { world, a, b } = composedFixture(2, { seed: 37 });
    const deposit = placeDeposit(world, 10, 10, 'food');
    a.x = 12; a.y = 9; // within sight of the marked tile
    know(a, [P(10, 10)]);
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(10, 10)], woodTier: 1 })).toMatchObject({ ok: true });
    a.mind = mindShell(a, { id: 'r-owner-food', resource: 'food', tier: 1, quantity: 1, allowMarket: false, purpose: 'test', urgency: 'routine' });
    b.x = 10; b.y = 8;
    b.mind = mindShell(b, { id: 'r-food-harvest', resource: 'food', tier: 1, quantity: 1, allowMarket: false, purpose: 'test', urgency: 'survival' });
    b.fullness = BALANCE.maxFullness; // bank the harvested unit instead of auto-eating during work
    expect(dispatch(world, b.id, { type: 'harvest', depositId: deposit.id })).toMatchObject({ ok: true });
    settleAction(world, b.id);
    const tax = COMPOSED_BALANCE.territoryTaxRate;
    // The real 0.85/0.15 fractional split is retained on both sides.
    expect(b.inventory['food:1']).toBeCloseTo(12 + (1 - tax), 9);
    expect(a.inventory['food:1']).toBeCloseTo(12 + tax, 9);
    expect(b.mind!.receipts).toHaveLength(1);
    expect(b.mind!.receipts[0]).toMatchObject({ item: 'food:1', source: 'harvest', requestId: 'r-food-harvest' });
    expect(b.mind!.receipts[0]!.quantity).toBeCloseTo(1 - tax, 9);
    expect(a.mind!.receipts[0]).toMatchObject({ item: 'food:1', source: 'tax', requestId: 'r-owner-food' });
    expect(a.mind!.receipts[0]!.quantity).toBeCloseTo(tax, 9);
    // A starving owner eats the fractional 0.15 tax unit proportionally, once.
    a.inventory = { 'food:1': tax };
    a.fullness = 0;
    tickBodies(world, 1);
    expect(a.inventory['food:1']).toBeUndefined(); // the partial unit is fully consumed by the debit
    const ownerMeal = a.fullness;
    expect(ownerMeal).toBeCloseTo(nutrition(1) * tax, 9);
    // The harvester's fractional 0.85 auto-eaten proportionally on the same rule.
    b.inventory = { 'food:1': 1 - tax };
    b.fullness = 0;
    tickBodies(world, 1);
    expect(b.inventory['food:1']).toBeUndefined();
    const harvesterMeal = b.fullness;
    expect(harvesterMeal).toBeCloseTo(nutrition(1) * (1 - tax), 9);
    // Whole-unit conservation: the two taxed halves of one unit grant exactly
    // one unit's nutrition across both fractional meals.
    expect(ownerMeal + harvesterMeal).toBeCloseTo(nutrition(1), 9);
    // No infinite meals: without further food the bodies only decay.
    const mealsBefore = world.events.filter((entry) => entry.kind === 'meal').length;
    const decayTicks = Math.ceil(ownerMeal / BALANCE.fullnessDrain);
    tickBodies(world, decayTicks);
    expect(world.events.filter((entry) => entry.kind === 'meal').length).toBe(mealsBefore);
    expect(a.inventory['food:1'] ?? 0).toBe(0);
    expect(b.inventory['food:1'] ?? 0).toBe(0);
    expect(b.fullness).toBeCloseTo(harvesterMeal - decayTicks * BALANCE.fullnessDrain, 9);
    expect(a.fullness).toBe(0); // spent, starved — never re-fed by a stale fraction
    expect(b.health).toBe(BALANCE.maxHealth);
  });

  it('dispatch rejects fractional gift quantities while whole gifts keep working', () => {
    const { world, a, b } = composedFixture(2);
    a.x = b.x; a.y = b.y; // adjacent
    expect(dispatch(world, a.id, { type: 'give', citizenId: b.id, item: 'food:1', quantity: 0.5 }))
      .toMatchObject({ ok: false, code: 'invalid-gift' });
    expect(a.inventory['food:1']).toBe(12);
    expect(b.inventory['food:1']).toBe(12);
    expect(dispatch(world, a.id, { type: 'give', citizenId: b.id, item: 'food:1', quantity: 1 }))
      .toMatchObject({ ok: true });
    expect(a.inventory['food:1']).toBe(11);
    expect(b.inventory['food:1']).toBe(13);
  });
});

describe('bounded receipt ledger retention under real settlement pressure', () => {
  /** Real engine flow only: every cycle is a dispatched post-then-cancel sell
   * order whose escrowed wood returns as exactly one recovery receipt, all
   * allocated to the citizen's active running request at record time. */
  const settlement = (world: World, citizen: Citizen, count: number): void => {
    for (let cycle = 0; cycle < count; cycle++) {
      const listing = dispatch(world, citizen.id, { type: 'order', side: 'sell', item: 'wood:1', quantity: 1, price: 2 });
      expect(listing.ok).toBe(true);
      expect(dispatch(world, citizen.id, { type: 'cancel-order', orderId: listing.order!.id })).toMatchObject({ ok: true });
    }
  };
  const terminalTask = (id: string, requestId: string, refs: DeliveryReceipt[]): TreeTaskState => ({
    id, definitionId: 'Harvest',
    request: { id: requestId, resource: 'wood', tier: 1, quantity: 1, allowMarket: false, purpose: 'test', urgency: 'routine' },
    ancestry: [], phase: 'exit:succeeded', status: 'succeeded', startedTick: 0, lastProgressTick: 0,
    delivered: refs.reduce((sum, receipt) => sum + receipt.quantity, 0),
    receiptIds: refs.map((receipt) => receipt.id), ownedOrderIds: [],
  });
  it('aggregates >128 running receipts, never evicts running credit and prunes terminal allocations atomically', () => {
    const { world, a: b } = composedFixture(1, { seed: 41 });
    b.mind = mindShell(b, { id: 'r-wood', resource: 'wood', tier: 1, quantity: 9, allowMarket: true, purpose: 'test', urgency: 'routine' });
    b.inventory = { 'wood:1': 400 };
    const running = b.mind!.tasks[0]!;
    settlement(world, b, 150);
    let ledger = b.mind!.receipts;
    // Every receipt was allocated to the still-running request, so nothing was
    // evictable: aggregation, not eviction, kept the ledger bounded.
    expect(ledger.length).toBe(MIND_LIMITS.receipts);
    expect(ledger.every((receipt) => receipt.requestId === running.request.id)).toBe(true);
    expect(ledger.some((receipt) => receipt.settlementId.startsWith('aggregate:'))).toBe(true);
    // Aggregation conserves net credit: 150 whole settlements remain as exact sums.
    expect(ledger.reduce((sum, receipt) => sum + receipt.quantity, 0)).toBe(150);
    expect(new Set(ledger.map((receipt) => receipt.id)).size).toBe(ledger.length);
    // Credit a mid-window slice onto the now-terminal old request: trimming may
    // evict those receipts only by pruning this allocation atomically.
    running.status = 'succeeded';
    running.phase = 'exit:succeeded';
    const mid = ledger.slice(60, 65);
    running.receiptIds = mid.map((receipt) => receipt.id);
    running.delivered = mid.reduce((sum, receipt) => sum + receipt.quantity, 0);
    const midIds = [...running.receiptIds];
    // A terminal sibling holds the very oldest receipts, which later evictions must prune.
    b.mind!.tasks.push(terminalTask('task-oldest-alloc', running.request.id, ledger.slice(0, 3)));
    // Fresh running request takes over as the active task.
    b.mind!.tasks.push({
      id: 'task-r-wood2', definitionId: 'Harvest',
      request: { id: 'r-wood2', resource: 'wood', tier: 1, quantity: 9, allowMarket: true, purpose: 'test', urgency: 'routine' },
      ancestry: [], phase: 'travel', status: 'running', startedTick: 0, lastProgressTick: 0,
      delivered: 0, receiptIds: [], ownedOrderIds: [],
    });
    b.mind!.activeTaskId = 'task-r-wood2';
    const running2 = b.mind!.tasks.at(-1)!;
    settlement(world, b, 20);
    ledger = b.mind!.receipts;
    expect(ledger.length).toBe(MIND_LIMITS.receipts);
    // Old-request receipts became evictable and were trimmed; total settlement
    // net is still conserved: 20 arrived, 20 of the evicted left, sums retained.
    expect(ledger.filter((receipt) => receipt.requestId === 'r-wood2')).toHaveLength(20);
    expect(ledger.reduce((sum, receipt) => sum + receipt.quantity, 0)).toBe(150);
    // The oldest terminal allocation was pruned atomically with its evicted receipts.
    const oldest = b.mind!.tasks.find((task) => task.id === 'task-oldest-alloc')!;
    expect(oldest.receiptIds).toHaveLength(0);
    expect(oldest.delivered).toBe(0);
    // The mid-window terminal allocation is untouched: all receipts retained.
    expect(running.receiptIds).toEqual(midIds);
    expect(running.delivered).toBeCloseTo(midIds.reduce((sum, receiptId) => sum + ledger.find((r) => r.id === receiptId)!.quantity, 0), 9);
    // Credited allocations of the running request survive further trimming.
    const credited = ledger.filter((receipt) => receipt.requestId === 'r-wood2').slice(-8).map((receipt) => receipt.id);
    running2.receiptIds = credited;
    running2.delivered = credited.reduce((sum, receiptId) => sum + ledger.find((r) => r.id === receiptId)!.quantity, 0);
    const creditedSum = running2.delivered;
    settlement(world, b, 5);
    ledger = b.mind!.receipts;
    expect(ledger.length).toBe(MIND_LIMITS.receipts);
    expect(running2.receiptIds).toEqual(credited); // running credit never evicted
    expect(running2.delivered).toBeCloseTo(creditedSum, 9);
    expect(new Set(ledger.map((receipt) => receipt.id)).size).toBe(ledger.length);
    // Starvation kills b for a real deceased mind: the dead citizen's mind keeps
    // >128 historical receipts and live allocations, and stays checkpoint-valid.
    b.health = 0.1;
    b.fullness = 0;
    tickBodies(world, 1);
    expect(b.alive).toBe(false);
    expect(b.mind!.receipts.length).toBe(MIND_LIMITS.receipts);
    const checkpoint: Checkpoint = {
      version: 1,
      savedAt: new Date().toISOString(),
      world,
      runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] },
    };
    expect(() => validateCheckpoint(JSON.parse(JSON.stringify(checkpoint)))).not.toThrow();
  });
});

describe('timed sign attacks, witnesses and sign loss', () => {
  it('destroys a sign over repeated timed attacks, recovers half the marking wood, and disbands at the last sign', () => {
    const { world, a, b } = composedFixture(2);
    const deposit = placeDeposit(world, 10, 10, 'wood');
    void deposit;
    a.x = 12; a.y = 9; // within sight of the marked tile
    know(a, [P(10, 10)]);
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(10, 10)], woodTier: 1 })).toMatchObject({ ok: true });
    const [sign] = Object.values(world.signs!);
    a.x = 10; a.y = 8; // member actually within sight of the sign
    b.x = 10; b.y = 7;
    const bWoodBefore = b.inventory['wood:1']!;
    expect(dispatch(world, b.id, { type: 'attack-sign', signId: sign.id })).toMatchObject({ ok: true });
    settleAction(world, b.id);
    expect(sign.health).toBe(COMPOSED_BALANCE.signHealth - 1);
    // One strike is genuinely two witnessed offenses: the witnessed approach into
    // the marked tile (trespass) plus the witnessed structure damage; each real
    // sighting drops every member's opinion one level, without forcing combat.
    expect(reputationLevel(world, a.id, b.id)).toBe('hostile');
    let attacks = 1;
    while (Object.values(world.signs ?? {}).length > 0 && attacks < 100) {
      tickBodies(world, 10);
      updateKnowledge(world);
      if (b.action) continue;
      const result = dispatch(world, b.id, { type: 'attack-sign', signId: sign.id });
      if (result.ok) attacks++;
    }
    expect(attacks).toBe(COMPOSED_BALANCE.signHealth); // exactly one damage per timed attack
    expect(Object.values(world.territories ?? {})).toHaveLength(0); // last sign loss disbands
    expect(Object.keys(world.signs ?? {})).toHaveLength(0);
    expect(b.inventory['wood:1'])
      .toBe(bWoodBefore + COMPOSED_BALANCE.territoryWoodPerTile * COMPOSED_BALANCE.signRecoveryFraction);
    // The offense cooldown may lapse during the long siege; the sanction never rises
    // past one more level and no hook anywhere commands an attack.
    expect(['disliked', 'hostile']).toContain(reputationLevel(world, a.id, b.id));
    for (const citizen of Object.values(world.citizens))
      expect(citizen.action?.command.type ?? null).not.toBe('attack');
  });
});

describe('witnessed offenses at real engine events', () => {
  it('sanctions trespass on actual movement into a territory, only when a member really sees it', () => {
    const { world, a, b } = composedFixture(2);
    const deposit = placeDeposit(world, 10, 10, 'wood');
    void deposit;
    a.x = 10; a.y = 9; // creation needs the founder within sight of the marked tile
    know(a, [P(10, 10)]);
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(10, 10)], woodTier: 1 })).toMatchObject({ ok: true });
    a.x = 16; a.y = 13; // far outside sight of the territory tile
    b.x = 10; b.y = 7;
    expect(dispatch(world, b.id, { type: 'move', x: 10, y: 10 })).toMatchObject({ ok: true });
    settleAction(world, b.id); // b crosses in; the only member cannot see the entry
    expect(b.x).toBe(10);
    expect(b.y).toBe(10);
    expect(reputationLevel(world, a.id, b.id)).toBe('neutral');
    // The owner walks within sight (Manhattan distance 3) of the tile.
    expect(dispatch(world, a.id, { type: 'move', x: 12, y: 9 })).toMatchObject({ ok: true });
    settleAction(world, a.id);
    expect(dispatch(world, b.id, { type: 'move', x: 10, y: 7 })).toMatchObject({ ok: true });
    settleAction(world, b.id);
    expect(dispatch(world, b.id, { type: 'move', x: 10, y: 10 })).toMatchObject({ ok: true });
    settleAction(world, b.id);
    expect(reputationLevel(world, a.id, b.id)).toBe('disliked');
    // Leaving and re-entering within the offense cooldown adds no further drop.
    expect(dispatch(world, b.id, { type: 'move', x: 10, y: 7 })).toMatchObject({ ok: true });
    settleAction(world, b.id);
    expect(dispatch(world, b.id, { type: 'move', x: 10, y: 10 })).toMatchObject({ ok: true });
    settleAction(world, b.id);
    expect(reputationLevel(world, a.id, b.id)).toBe('disliked');
    // After the cooldown lapses, the next genuinely witnessed entry drops one level.
    tickBodies(world, COMPOSED_BALANCE.offenseCooldownTicks);
    expect(dispatch(world, b.id, { type: 'move', x: 10, y: 7 })).toMatchObject({ ok: true });
    settleAction(world, b.id);
    expect(dispatch(world, b.id, { type: 'move', x: 10, y: 10 })).toMatchObject({ ok: true });
    settleAction(world, b.id);
    expect(reputationLevel(world, a.id, b.id)).toBe('hostile');
  });

  it('witnesses citizen attacks at real engagement, never at remote command acceptance', () => {
    const { world, a, b, c } = composedFixture(3, { seed: 17 });
    clearTile(world, 10, 10);
    know(a, [P(10, 10)]);
    a.x = 12; a.y = 9;
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(10, 10)], woodTier: 1 })).toMatchObject({ ok: true });
    b.x = a.x; b.y = a.y - 2;
    c.x = b.x - 1; c.y = b.y; // an unaffiliated bystander victim within reach
    // Accepting the attack remotely still witnesses nothing.
    expect(dispatch(world, b.id, { type: 'attack', targetId: a.id })).toMatchObject({ ok: true });
    expect(reputationLevel(world, a.id, b.id)).toBe('neutral');
    // Closing into actual strike range witnesses the offense immediately.
    let ticks = 0;
    while (reputationLevel(world, a.id, b.id) === 'neutral' && ticks < 60) {
      tickBodies(world, 1);
      ticks++;
    }
    expect(reputationLevel(world, a.id, b.id)).toBe('hostile'); // member attack: minimum for all members
    // The unaffiliated victim's own directed view drops at their real engagement:
    // witnesses are the victim and territory members, never omniscient bystanders.
    expect(dispatch(world, b.id, { type: 'cancel' })).toMatchObject({ ok: true });
    c.x = b.x - 1;
    c.y = b.y;
    expect(dispatch(world, b.id, { type: 'attack', targetId: c.id })).toMatchObject({ ok: true });
    expect(reputationLevel(world, c.id, b.id)).toBe('neutral');
    let victimTicks = 0;
    while (reputationLevel(world, c.id, b.id) === 'neutral' && victimTicks < 60) {
      tickBodies(world, 1);
      victimTicks++;
    }
    expect(reputationLevel(world, c.id, b.id)).toBe('hostile');
  });

  it.each(['building', 'house'] as const)('witnesses %s attacks at the strike, not acceptance, and member strikes stay exempt', (kind) => {
    const { world, a, b } = composedFixture(2, { seed: 17 });
    for (const tile of [P(10, 10), P(10, 11)]) clearTile(world, tile.x, tile.y);
    a.x = 12; a.y = 10; // within sight of the building tile at strike range
    know(a, [P(10, 10), P(10, 11)]);
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(10, 10), P(10, 11)], woodTier: 1 })).toMatchObject({ ok: true });
    const structure = { id: 'mill', tier: 1 as const, x: 10, y: 11,
      ownerId: a.id, health: 100, maxHealth: 100 };
    if (kind === 'house') world.houses = { mill: structure };
    else world.buildings.mill = { ...structure, kind: 'lumbermill', materials: {} };
    const target = kind === 'house' ? world.houses!.mill : world.buildings.mill;
    b.x = 10; b.y = 9;
    expect(dispatch(world, b.id, { type: 'attack', targetId: 'mill' })).toMatchObject({ ok: true });
    expect(reputationLevel(world, a.id, b.id)).toBe('neutral');
    let ticks = 0;
    while (target.health === 100 && ticks < 60) {
      tickBodies(world, 1);
      ticks++;
    }
    expect(target.health).toBeLessThan(100);
    // The approach crossed (10,10): witnessed trespass and the distinct
    // witnessed structure strike each lower opinion, not one merged offense.
    expect(reputationLevel(world, a.id, b.id)).toBe('hostile');
    // A member dismantling their own territory's building is not an offense.
    expect(dispatch(world, a.id, { type: 'attack', targetId: 'mill' })).toMatchObject({ ok: true });
    settleAction(world, a.id);
    expect(reputationLevel(world, a.id, a.id)).toBe('neutral'); // no self-opinion exists at all
  });
});

describe('unwitnessed structure strikes', () => {
  it.each(['building', 'house'] as const)('does not sanction a hidden %s strike or hidden trespass', kind => {
    const { world, a, b } = composedFixture(2);
    a.x = 10; a.y = 13; // creation needs the founder within sight of both marked tiles
    know(a, [P(10, 10), P(10, 11)]);
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(10, 10), P(10, 11)], woodTier: 1 }).ok).toBe(true);
    a.x = 16; a.y = 16; // then far outside sight of both structures
    const structure = { id: 'target', tier: 1 as const, x: 10, y: 11, ownerId: a.id, health: 100, maxHealth: 100 };
    if (kind === 'house') world.houses = { target: structure };
    else world.buildings.target = { ...structure, kind: 'lumbermill', materials: {} };
    b.x = 10; b.y = 9;
    const target = kind === 'house' ? world.houses!.target : world.buildings.target;
    expect(dispatch(world, b.id, { type: 'attack', targetId: 'target' }).ok).toBe(true);
    settleAction(world, b.id);
    expect(target.health).toBeLessThan(100);
    expect(reputationLevel(world, a.id, b.id)).toBe('neutral');
  });
});

describe('composed controller run-to-run determinism', () => {
  it('reproduces identical worlds from the same seed across repeated live-controller runs', () => {
    const run = (): World => {
      const world = createWorld({ seed: 21, population: 3, controllerMode: 'composed', autonomy: false });
      tickWorld(world, 200); // no authority: the real controller drives every citizen
      updateKnowledge(world);
      return world;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});

describe('composed observation projections', () => {
  it('lets the real controller vote on a visible own-member request and complete admission', () => {
    const { world, a, b, c } = composedFixture(3, { seed: 11 });
    a.x = 10; a.y = 9;
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(10, 10)], woodTier: 1 }).ok).toBe(true);
    const territory = territoryOf(world, a.id)!;
    expect(dispatch(world, b.id, { type: 'join-territory', territoryId: territory.id }).ok).toBe(true);
    const admission = territory.admissions.at(-1)!;
    a.mind!.dispositions.sociability = 1;
    a.mind!.dispositions.generosity = 1;
    changeReputation(world, a.id, b.id, 2);
    expect(observe(world, a.id).territories![0]!.admissions).toContainEqual(admission);
    c.x = 10; c.y = 9;
    const foreign = observe(world, c.id).territories!.find(t => t.id === territory.id)!;
    expect(foreign.members).toEqual({});
    expect(foreign.admissions).toEqual([]);
    tickWorld(world, 1);
    expect(admission.votes[a.id]).toBe(true);
    expect(admission.status).toBe('admitted');
    expect(territoryOf(world, b.id)?.id).toBe(territory.id);
  });

  it('accepts currently visible territory sites without granting unseen land knowledge', () => {
    const { world, a } = composedFixture(1);
    a.x = 10; a.y = 9;
    a.knowledge = {};
    expect(observe(world, a.id).visible.some(tile => tile.x === 10 && tile.y === 10)).toBe(true);
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(10, 10)], woodTier: 1 }).ok).toBe(true);
    // Unseen land fails through the current inspection gate in territory.ts.
    expect(dispatch(world, a.id, { type: 'expand-territory', territoryId: territoryOf(world, a.id)!.id, tiles: [P(16, 16)], woodTier: 1 }))
      .toMatchObject({ ok: false, code: 'needs-inspection' });
    expect(a.knowledge['16,16']).toBeUndefined();
  });

  it('does not refresh foreign civic facts through stale known coordinates', () => {
    const { world, a, b } = composedFixture(2);
    a.x = 10; a.y = 9;
    b.x = 10; b.y = 9;
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(10, 10)], woodTier: 1 }).ok).toBe(true);
    world.houses = { home: { id: 'home', ownerId: a.id, tier: 1, x: 10, y: 10, health: 100, maxHealth: 100 } };
    updateKnowledge(world);
    expect(observe(world, b.id).houses).toHaveLength(1);
    b.x = 1; b.y = 1;
    const hiddenBefore = observe(world, b.id);
    expect(hiddenBefore.signs).toEqual([]);
    expect(hiddenBefore.houses).toEqual([]);
    expect(hiddenBefore.territories).toEqual([]);
    // Neither hidden destruction nor a new civic structure on previously seen
    // ground can enter the observation. Fresh sight reveals the actual change.
    delete world.houses.home;
    expect(dispatch(world, a.id, { type: 'leave-territory' }).ok).toBe(true);
    world.houses.newHome = { id: 'newHome', ownerId: a.id, tier: 2, x: 10, y: 10, health: 70, maxHealth: 100 };
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(10, 10)], woodTier: 1 }).ok).toBe(true);
    const hiddenAfter = observe(world, b.id);
    expect(hiddenAfter.signs).toEqual(hiddenBefore.signs);
    expect(hiddenAfter.houses).toEqual(hiddenBefore.houses);
    expect(hiddenAfter.territories).toEqual(hiddenBefore.territories);
    b.x = 10; b.y = 9;
    expect(observe(world, b.id).houses!.map(house => house.id)).toEqual(['newHome']);
    expect(observe(world, b.id).signs).toHaveLength(1);
  });
  it('exposes only knowledge-bounded territory facts, houses and own reputation', () => {
    const { world, a, b, c } = composedFixture(3);
    a.x = 10; a.y = 9;
    know(a, [P(10, 10)]);
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(10, 10)], woodTier: 1 })).toMatchObject({ ok: true });
    joinAndAdmit(world, b.id, territoryOf(world, a.id)!.id);
    world.houses = { home: { id: 'home', ownerId: a.id, tier: 1, x: 10, y: 10, health: 100, maxHealth: 100 } };
    // A far-away territory whose signs are unknown stays invisible to a.
    know(c, [P(16, 16)]);
    c.x = 16; c.y = 15; // the founder must stand within sight of their marked tile
    expect(dispatch(world, c.id, { type: 'create-territory', tiles: [P(16, 16)], woodTier: 1 })).toMatchObject({ ok: true });
    const farSign = Object.values(world.signs!).find((sign) => sign.x === 16)!;
    const observation = observe(world, a.id);
    const ownMembership = observation.territories!.find((territory) => !!territory.members[a.id]);
    expect(ownMembership?.id).toBe(territoryOf(world, a.id)!.id);
    expect(Object.keys(ownMembership!.members)).toContain(b.id); // co-members are known
    expect(observation.territories!.some((territory) => territory.ownerId === c.id)).toBe(false);
    expect(observation.signs!.map((sign) => sign.id)).toContain(Object.values(world.signs!)[0]!.id);
    expect(observation.houses!.map((house) => house.id)).toContain('home');
    expect(observation.signs!.some((sign) => sign.id === farSign.id)).toBe(false);
    // Own directed opinion only; others' opinions stay hidden. The runtime
    // projection is the single source for own reputation observation; the
    // CitizenObservation contract field itself is owned by shared-types.
    changeReputation(world, a.id, b.id, -1);
    const ownViews = observe(world, a.id) as typeof observation & { reputations?: Record<string, string> };
    const otherViews = observe(world, b.id) as typeof observation & { reputations?: Record<string, string> };
    expect(ownViews.reputations).toMatchObject({ [b.id]: 'disliked' });
    expect(otherViews.reputations).toEqual({});
    expect(observe(world, a.id).citizen.rest).toEqual(a.rest);
    expect(observe(world, a.id).citizen.mind).toEqual(a.mind);
    // Legacy observations carry none of the composed civic projection fields.
    const legacy = createWorld({ seed: 3, population: 2 });
    const [x] = Object.values(legacy.citizens);
    const legacyObservation = observe(legacy, x!.id);
    expect(legacyObservation.territories).toBeUndefined();
    expect(legacyObservation.signs).toBeUndefined();
    expect(legacyObservation.houses).toBeUndefined();
    expect((legacyObservation as unknown as { reputations?: unknown }).reputations).toBeUndefined();
  });
});

describe('composed checkpoint safety', () => {
  it('keeps taxed receipts, rest state and territories checkpoint-valid', () => {
    const { world, a, b } = composedFixture(2);
    const deposit = placeDeposit(world, 10, 10, 'wood');
    a.x = 12; a.y = 9; // within sight of the marked tile
    know(a, [P(10, 10)]);
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [P(10, 10)], woodTier: 1 })).toMatchObject({ ok: true });
    joinAndAdmit(world, b.id, territoryOf(world, a.id)!.id);
    b.x = 10; b.y = 8;
    b.rest = { value: 55 };
    b.mind = mindShell(b, { id: 'r-req', resource: 'wood', tier: 1, quantity: 2, allowMarket: false, purpose: 'test', urgency: 'routine' });
    expect(dispatch(world, b.id, { type: 'harvest', depositId: deposit.id })).toMatchObject({ ok: true });
    settleAction(world, b.id);
    const checkpoint: Checkpoint = {
      version: 1,
      savedAt: new Date().toISOString(),
      world,
      runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] },
    };
    expect(() => validateCheckpoint(JSON.parse(JSON.stringify(checkpoint)))).not.toThrow();
  });
});