import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/world/core.ts';
import { observe } from '../src/world/observation.ts';
import {
  admissionThreshold,
  canBuildInTerritory,
  canUseTerritoryBuilding,
  destroyTerritorySign,
  handleTerritoryCommand,
  inheritTerritoryMembership,
  maintainTerritories,
  markingCost,
  settleTerritoryDeath,
  territoryAt,
  territoryOf,
} from '../src/world/territory.ts';
import {
  changeReputation,
  reputationLevel,
  witnessMemberAttack,
  witnessStructureAttack,
  witnessTerritoryHarvest,
  witnessTerritoryTrespass,
} from '../src/world/reputation.ts';
import { COMPOSED_BALANCE } from '../src/world/config.ts';
import { validateCheckpoint } from '../src/server/checkpoint.ts';
import type { Citizen, Point, World } from '../src/shared/types.ts';

// Real createWorld fixtures plus direct module mechanics: no core/shared wiring here.

function fixture() {
  const world = createWorld({ seed: 7, population: 6, autonomy: false });
  world.controllerMode = 'composed';
  const [a, b, c, d, e, f] = Object.values(world.citizens);
  for (const citizen of Object.values(world.citizens))
    Object.assign(citizen, { x: 10, y: 11, inventory: { 'food:1': 12, 'wood:1': 50, 'wood:2': 50 } });
  return { world, a, b, c, d, e, f };
}

const P = (x: number, y: number): Point => ({ x, y });
const know = (citizen: Citizen, points: Point[]) => {
  for (const point of points)
    citizen.knowledge[`${point.x},${point.y}`] =
      { x: point.x, y: point.y, seenTick: 0, citizens: [], deposits: [], buildings: [], loot: [] };
};
const wood = (citizen: Citizen) => (citizen.inventory['wood:1'] ?? 0) + (citizen.inventory['wood:2'] ?? 0);

function placeBuilding(world: World, ownerId: string | null, x: number, y: number) {
  const building = { id: `bld-${x}-${y}`, kind: 'wall' as const, tier: 1 as const, x, y, ownerId, health: 100, maxHealth: 100, materials: {} };
  world.buildings[building.id] = building;
  return building;
}

function found(world: World, founder: Citizen, tiles: Point[], woodTier: 1 | 2 = 1) {
  Object.assign(founder, tiles[0]);
  know(founder, tiles);
  return handleTerritoryCommand(world, founder, { type: 'create-territory', tiles, woodTier });
}

function admit(world: World, owner: Citizen, applicant: Citizen) {
  const request = handleTerritoryCommand(world, applicant, { type: 'join-territory', territoryId: territorySignsId(world, owner) });
  expect(request?.ok).toBe(true);
  const territory = territoryOf(world, owner.id)!;
  const admission = territory.admissions.at(-1)!;
  // Every living member votes yes; silence never admits.
  for (const memberId of Object.keys(territory.members)) {
    const voter = world.citizens[memberId]!;
    expect(handleTerritoryCommand(world, voter, { type: 'vote-territory', territoryId: territory.id, admissionId: admission.id, accept: true })?.ok).toBe(true);
  }
  expect(admission.status).toBe('admitted');
  return territory;
}
const territorySignsId = (world: World, founder: Citizen) => territoryOf(world, founder.id)!.id;

describe('marked territory composition', () => {
  it.each(['rejected', 'expired'] as const)('projects a real %s outcome privately and retains occurrence-time audiences', (outcome) => {
    const { world, a, b, c } = fixture();
    expect(found(world, a, [P(10, 10)])?.ok).toBe(true);
    const territory = territoryOf(world, a.id)!;
    Object.assign(b, { x: 0, y: 0 });
    Object.assign(c, { x: 0, y: 0 });
    expect(handleTerritoryCommand(world, b, { type: 'join-territory', territoryId: territory.id })?.ok).toBe(true);
    const admission = territory.admissions.at(-1)!;
    expect(observe(world, a.id).territories![0].admissions[0].id).toBe(admission.id);
    if (outcome === 'rejected') {
      expect(handleTerritoryCommand(world, a, { type: 'vote-territory', territoryId: territory.id, admissionId: admission.id, accept: false })?.ok).toBe(true);
    } else {
      world.tick = admission.expiresTick;
      maintainTerritories(world);
    }
    expect(admission.status).toBe(outcome);
    const projected = observe(world, b.id).territories!.find((entry) => entry.id === territory.id)!;
    expect(projected.members).toEqual({});
    expect(projected.admissions).toEqual([{ ...admission, votes: {} }]);
    const resolution = world.events.at(-1)!;
    expect(resolution.audience).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(observe(world, b.id).alerts.some((entry) => entry.id === resolution.id)).toBe(true);
    Object.assign(c, { x: a.x, y: a.y }); // Sight does not grant retroactive witnessing.
    expect(observe(world, c.id).territories!.find((entry) => entry.id === territory.id)?.admissions).toEqual([]);
    expect(observe(world, c.id).alerts.some((entry) => entry.id === resolution.id)).toBe(false);
  });

  it('bounds closed admission history immediately on request insertion', () => {
    const { world, a, b } = fixture();
    found(world, a, [P(10, 10)]);
    const territory = territoryOf(world, a.id)!;
    for (let i = 0; i < 70; i++) {
      handleTerritoryCommand(world, b, { type: 'join-territory', territoryId: territory.id });
      const admission = territory.admissions.at(-1)!;
      handleTerritoryCommand(world, a, { type: 'vote-territory', territoryId: territory.id, admissionId: admission.id, accept: false });
      expect(territory.admissions.length).toBeLessThanOrEqual(64);
    }
    expect(observe(world, b.id).territories![0].admissions).toHaveLength(64);
  });
  it('founds a connected territory, charging exactly 2 wood per tile, and makes the founder the owner-member', () => {
    const { world, a } = fixture();
    const tiles = [P(10, 10), P(10, 11), P(11, 11)];
    const before = wood(a);
    const result = found(world, a, tiles, 2);
    expect(result!.ok).toBe(true);
    expect(wood(a)).toBeCloseTo(before - markingCost(3, 2)['wood:2'], 9);
    const territory = territoryAt(world, P(10, 10))!;
    expect(territory.id).toBe(territoryOf(world, a.id)!.id);
    expect(territory.ownerId).toBe(a.id);
    expect(territory.members[a.id]).toEqual({ citizenId: a.id, joinedTick: world.tick, sequence: 0 });
    expect(Object.values(world.signs!)).toHaveLength(3);
    expect(territoryAt(world, P(11, 11))).toBe(territory);
    expect(territoryAt(world, P(5, 5))).toBeUndefined();
  });

  it('rejects unknown land, overlaps, outsider buildings, bad tiers and disconnected marks', () => {
    const { world, a, b } = fixture();
    const tiles = [P(10, 10)];
    expect(handleTerritoryCommand(world, a, { type: 'create-territory', tiles, woodTier: 1 })).toMatchObject({ ok: false, code: 'needs-inspection' });
    know(a, tiles);
    expect(handleTerritoryCommand(world, a, { type: 'create-territory', tiles: [P(400, 0)], woodTier: 1 })).toMatchObject({ ok: false, code: 'invalid-tiles' });
    expect(handleTerritoryCommand(world, a, { type: 'create-territory', tiles, woodTier: 99 })).toMatchObject({ ok: false, code: 'invalid-wood-tier' });
    expect(found(world, a, [P(10, 10), P(11, 11)])).toMatchObject({ ok: false, code: 'disconnected' });
    placeBuilding(world, b.id, 10, 10);
    expect(found(world, a, [P(10, 10)])).toMatchObject({ ok: false, code: 'outsider-building' });
    world.buildings['bld-10-10'].ownerId = null;
    expect(found(world, a, [P(10, 10)])).toMatchObject({ ok: false, code: 'outsider-building' });
    delete world.buildings['bld-10-10'];
    placeBuilding(world, a.id, 10, 10);
    expect(found(world, a, [P(10, 11)])).toMatchObject({ ok: true });
    const second = found(world, b, [P(10, 11)]);
    expect(second).toMatchObject({ ok: false, code: 'already-claimed' });
    expect(found(world, a, [P(10, 10)])).toMatchObject({ ok: false, code: 'already-member' });
  });

  it.each(['create', 'expand'] as const)('%s requires inspection before revealing hidden occupancy or claims', (operation) => {
    const { world, a, b } = fixture();
    const target = P(10, 11);
    if (operation === 'expand') expect(found(world, a, [P(10, 10)])?.ok).toBe(true);
    know(a, [target]); // Empty land was inspected before leaving sight.
    a.x = 20;
    a.y = 20;
    world.tick++;
    const attempt = () => handleTerritoryCommand(world, a, operation === 'create'
      ? { type: 'create-territory', tiles: [target], woodTier: 1 }
      : { type: 'expand-territory', territoryId: territorySignsId(world, a), tiles: [target], woodTier: 1 });
    const before = wood(a);
    const empty = attempt();
    expect(empty).toMatchObject({ ok: false, code: 'needs-inspection' });
    placeBuilding(world, b.id, target.x, target.y);
    expect(attempt()).toEqual(empty);
    delete world.buildings['bld-10-11'];
    expect(found(world, b, [target])?.ok).toBe(true);
    expect(attempt()).toEqual(empty);
    delete a.knowledge['10,11'];
    expect(attempt()).toEqual(empty);
    expect(wood(a)).toBe(before);
    expect(Object.values(world.signs!).filter((sign) => sign.x === 10 && sign.y === 11)).toHaveLength(1);
  });

  it('checks sight for the entire request before revealing a visible obstruction', () => {
    const { world, a, b } = fixture();
    const visible = P(10, 11);
    const hidden = P(10, 15);
    know(a, [visible, hidden]);
    placeBuilding(world, b.id, visible.x, visible.y);
    const before = wood(a);
    for (const tiles of [[visible, hidden], [hidden, visible]])
      expect(handleTerritoryCommand(world, a, { type: 'create-territory', tiles, woodTier: 1 }))
        .toMatchObject({ ok: false, code: 'needs-inspection' });
    expect(wood(a)).toBe(before);
    expect(Object.values(world.signs ?? {})).toHaveLength(0);
  });

  it('allows signs to share building positions and to mark deposit tiles', () => {
    const { world, a } = fixture();
    world.deposits.plant = { id: 'plant', resource: 'food', tier: 1, x: 10, y: 10, stock: 1, capacity: 1, regrowAt: 0 };
    placeBuilding(world, a.id, 10, 11);
    expect(found(world, a, [P(10, 10), P(10, 11)])).toMatchObject({ ok: true });
    expect(territoryAt(world, P(10, 10))).toBeDefined(); // sign and deposit share the tile
    expect(territoryAt(world, P(10, 11))).toBeDefined(); // sign and building share the tile
    expect(world.buildings['bld-10-11']).toBeDefined();
  });

  it('blocks expanding onto nonmember buildings and foreign claims, and only members expand', () => {
    const { world, a, b } = fixture();
    found(world, a, [P(10, 10)]);
    expect(handleTerritoryCommand(world, b, { type: 'expand-territory', territoryId: territorySignsId(world, a), tiles: [P(10, 11)], woodTier: 1 })).toMatchObject({ ok: false, code: 'not-member' });
    placeBuilding(world, b.id, 10, 11);
    know(a, [P(10, 11)]);
    expect(handleTerritoryCommand(world, a, { type: 'expand-territory', territoryId: territorySignsId(world, a), tiles: [P(10, 11)], woodTier: 1 })).toMatchObject({ ok: false, code: 'outsider-building' });
    delete world.buildings['bld-10-11'];
    world.signs!.foreign = { id: 'foreign', territoryId: 'other', x: 10, y: 11, woodTier: 1, health: 16, maxHealth: 16 };
    expect(handleTerritoryCommand(world, a, { type: 'expand-territory', territoryId: territorySignsId(world, a), tiles: [P(10, 11)], woodTier: 1 })).toMatchObject({ ok: false, code: 'already-claimed' });
    delete world.signs!.foreign;
    expect(handleTerritoryCommand(world, a, { type: 'expand-territory', territoryId: territorySignsId(world, a), tiles: [P(10, 12)], woodTier: 1 })) // not known
      .toMatchObject({ ok: false, code: 'needs-inspection' });
    a.y = 11;
    know(a, [P(11, 12), P(12, 12)]);
    expect(handleTerritoryCommand(world, a, { type: 'expand-territory', territoryId: territorySignsId(world, a), tiles: [P(11, 12), P(12, 12)], woodTier: 1 })).toMatchObject({ ok: false, code: 'disconnected' });
  });

  it('any member expands, pays their own wood at any tier, and ownership (tax) stays with the owner', () => {
    const { world, a, b } = fixture();
    found(world, a, [P(10, 10)], 1);
    const territoryId = territorySignsId(world, a);
    expect(admit(world, a, b)).toBeDefined();
    know(b, [P(11, 10), P(12, 10)]);
    const bBefore = wood(b);
    expect(handleTerritoryCommand(world, b, { type: 'expand-territory', territoryId, tiles: [P(11, 10), P(12, 10)], woodTier: 2 })).toMatchObject({ ok: true });
    expect(wood(b)).toBeCloseTo(bBefore - markingCost(2, 2)['wood:2'], 9);
    expect(wood(a)).toBeCloseTo(100 - markingCost(1, 1)['wood:1'], 9); // untouched by b's expansion
    const signs = Object.values(world.signs!);
    expect(signs.find((sign) => sign.x === 12 && sign.y === 10)!.woodTier).toBe(2);
    expect(signs.find((sign) => sign.x === 10 && sign.y === 10)!.woodTier).toBe(1);
    expect(territoryOf(world, b.id)!.ownerId).toBe(a.id);
  });

  it('conserves wood across founding, expansion, sign destruction and disbanding', () => {
    const { world, a } = fixture();
    found(world, a, [P(10, 10), P(10, 11)]);
    const territoryId = territorySignsId(world, a);
    know(a, [P(10, 12)]);
    handleTerritoryCommand(world, a, { type: 'expand-territory', territoryId, tiles: [P(10, 12)], woodTier: 1 });
    expect(wood(a)).toBeCloseTo(100 - COMPOSED_BALANCE.territoryWoodPerTile * 3, 9);
    expect(handleTerritoryCommand(world, a, { type: 'leave-territory' })).toMatchObject({ ok: true });
    expect(wood(a)).toBeCloseTo(100 - COMPOSED_BALANCE.territoryWoodPerTile * 3, 9); // disbanding refunds nothing
    expect(world.territories![territoryId]).toBeUndefined();
  });
});

describe('membership, admission and votes', () => {
  it('admits by strict majority of all members, with the owner voting equally', () => {
    const { world, a, b, c, f } = fixture();
    found(world, a, [P(10, 10)]);
    const territoryId = territorySignsId(world, a);
    expect(handleTerritoryCommand(world, f, { type: 'vote-territory', territoryId, admissionId: 'none', accept: true })).toMatchObject({ ok: false, code: 'not-member' });
    const first = handleTerritoryCommand(world, b, { type: 'join-territory', territoryId })!;
    expect(first.ok).toBe(true);
    const territory = territoryOf(world, a.id)!;
    const request = territory.admissions.at(-1)!;
    expect(request.status).toBe('pending');
    expect(request.expiresTick).toBe(world.tick + COMPOSED_BALANCE.admissionTimeoutTicks);
    // One member: one yes vote alone settles admission.
    expect(handleTerritoryCommand(world, a, { type: 'vote-territory', territoryId, admissionId: request.id, accept: true })).toMatchObject({ ok: true, message: expect.stringContaining('joined') });
    expect(territory.members[b.id]).toBeDefined();
    // Two members: strict majority needs both yes votes.
    expect(handleTerritoryCommand(world, c, { type: 'join-territory', territoryId })).toMatchObject({ ok: true });
    const secondRequest = territory.admissions.at(-1)!;
    expect(handleTerritoryCommand(world, a, { type: 'vote-territory', territoryId, admissionId: secondRequest.id, accept: true })).toMatchObject({ ok: true, message: expect.stringContaining('still') });
    expect(secondRequest.status).toBe('pending');
    expect(handleTerritoryCommand(world, b, { type: 'vote-territory', territoryId, admissionId: secondRequest.id, accept: true })).toMatchObject({ ok: true });
    expect(territory.members[c.id]).toBeDefined();
    expect(handleTerritoryCommand(world, b, { type: 'vote-territory', territoryId, admissionId: secondRequest.id, accept: true })).toMatchObject({ ok: false, code: 'admission-closed' });
  });

  it('rejects when yes can no longer strictly exceed half, with silence never admitting', () => {
    const { world, a, b, c, d } = fixture();
    found(world, a, [P(10, 10)]);
    const territoryId = territorySignsId(world, a);
    admit(world, a, b);
    admit(world, a, c);
    expect(handleTerritoryCommand(world, d, { type: 'join-territory', territoryId })).toMatchObject({ ok: true });
    const territory = territoryOf(world, a.id)!;
    const request = territory.admissions.at(-1)!;
    expect(handleTerritoryCommand(world, a, { type: 'vote-territory', territoryId, admissionId: request.id, accept: true })).toMatchObject({ ok: true });
    expect(request.status).toBe('pending'); // 1 of 3 is not a majority and still possible
    expect(handleTerritoryCommand(world, b, { type: 'vote-territory', territoryId, admissionId: request.id, accept: false })).toMatchObject({ ok: true });
    expect(request.status).toBe('pending'); // c could still tie the vote into a majority
    expect(handleTerritoryCommand(world, c, { type: 'vote-territory', territoryId, admissionId: request.id, accept: false })).toMatchObject({ ok: true });
    expect(request.status).toBe('rejected'); // two no votes make a majority impossible
    expect(territory.members[d.id]).toBeUndefined();
    // Silence alone never admits or rejects before the timeout.
    expect(handleTerritoryCommand(world, d, { type: 'join-territory', territoryId })).toMatchObject({ ok: true });
    world.tick += COMPOSED_BALANCE.admissionTimeoutTicks + 1;
    maintainTerritories(world);
    expect(territory.admissions.at(-1)!.status).toBe('expired');
    expect(territory.members[d.id]).toBeUndefined();
  });

  it('counts children equally and admits newborns of two same-territory parents without a vote', () => {
    const { world, a, b, f } = fixture();
    found(world, a, [P(10, 10)]);
    admit(world, a, b);
    expect(inheritTerritoryMembership(world, f, a, b)!.id).toBe(territoryOf(world, a.id)!.id);
    const childId = f.id;
    expect(territoryOf(world, a.id)!.members[childId]).toEqual({ citizenId: childId, joinedTick: world.tick, sequence: 2 });
    // Children have one equal vote and count in the denominator.
    const territory = territoryOf(world, a.id)!;
    expect(admissionThreshold(territory, world)).toBe(2);
    const { world: other, a: owner, d: applicant, e: childTwo } = fixture();
    found(other, owner, [P(20, 20)]);
    admit(other, owner, childTwo);
    expect(handleTerritoryCommand(other, applicant, { type: 'join-territory', territoryId: territorySignsId(other, owner) })).toMatchObject({ ok: true });
    const request = territoryOf(other, owner.id)!.admissions.at(-1)!;
    expect(handleTerritoryCommand(other, owner, { type: 'vote-territory', territoryId: territoryOf(other, owner.id)!.id, admissionId: request.id, accept: true })).toMatchObject({ ok: true });
    expect(request.status).toBe('pending'); // 1 of 2: the child's vote is decisive
    expect(handleTerritoryCommand(other, childTwo, { type: 'vote-territory', territoryId: territoryOf(other, owner.id)!.id, admissionId: request.id, accept: true })).toMatchObject({ ok: true });
    expect(territoryOf(other, owner.id)!.members[applicant.id]).toBeDefined();
  });

  it('child membership is independent of a parent leaving, and membership cap applies to joining', () => {
    const { world, a, b, f, c } = fixture();
    found(world, a, [P(10, 10)]);
    admit(world, a, b);
    inheritTerritoryMembership(world, f, a, b);
    expect(handleTerritoryCommand(world, b, { type: 'leave-territory' })).toMatchObject({ ok: true });
    expect(territoryOf(world, f.id)).toBe(territoryOf(world, a.id)); // child keeps membership
    expect(territoryOf(world, b.id)).toBeUndefined();
    // No citizen belongs to two territories: joining while affiliated is refused.
    expect(found(world, b, [P(14, 14)])).toMatchObject({ ok: true }); // allowed after leaving
    admit(world, a, c); // c (unaffiliated) can join a's territory by member vote
    expect(handleTerritoryCommand(world, c, { type: 'join-territory', territoryId: territorySignsId(world, b) })).toMatchObject({ ok: false, code: 'already-member' });
    expect(inheritTerritoryMembership(world, c, a, b)).toBeUndefined(); // parents differ
  });

  it('resolves pending admissions after member departure, pruning departed votes', () => {
    const { world, a, b, c } = fixture();
    found(world, a, [P(10, 10)]);
    admit(world, a, b);
    const territoryId = territorySignsId(world, a);
    expect(handleTerritoryCommand(world, c, { type: 'join-territory', territoryId })).toMatchObject({ ok: true });
    const territory = territoryOf(world, a.id)!;
    const request = territory.admissions.at(-1)!;
    expect(handleTerritoryCommand(world, a, { type: 'vote-territory', territoryId, admissionId: request.id, accept: true })).toMatchObject({ ok: true });
    expect(request.status).toBe('pending'); // 1 of 2: needs b too
    expect(handleTerritoryCommand(world, b, { type: 'leave-territory' })).toMatchObject({ ok: true });
    expect(request.status).toBe('admitted'); // 1 of the remaining 1 is a strict majority
    expect(territory.members[c.id]).toBeDefined();
  });

  it('owner departure disbands without refund; buildings stay; non-owner leaving preserves the territory', () => {
    const { world, a, b } = fixture();
    found(world, a, [P(10, 10), P(11, 10)]);
    const territoryId = territorySignsId(world, a);
    admit(world, a, b);
    const building = placeBuilding(world, b.id, 11, 10);
    const eventsBefore = world.events.length;
    expect(handleTerritoryCommand(world, b, { type: 'leave-territory' })).toMatchObject({ ok: true });
    expect(territoryOf(world, a.id)!.id).toBe(territoryId); // non-owner leave keeps the territory
    expect(world.signs![Object.keys(world.signs!)[0]]).toBeDefined();
    const bBefore = wood(b);
    expect(handleTerritoryCommand(world, a, { type: 'leave-territory' })).toMatchObject({ ok: true });
    expect(world.territories![territoryId]).toBeUndefined();
    expect(Object.keys(world.signs!)).toHaveLength(0);
    expect(wood(b)).toBeCloseTo(bBefore, 9); // no refund anywhere
    expect(world.buildings[building.id]).toBe(building);
    expect(world.events.length).toBeGreaterThan(eventsBefore);
  });
});

describe('signs, succession and lifecycle', () => {
  it('destroying a sign frees its tile, refunds half the marking wood to the destroyer, and keeps the rest', () => {
    const { world, a, c } = fixture();
    found(world, a, [P(10, 10), P(10, 11), P(10, 12)]);
    const territoryId = territorySignsId(world, a);
    const sign = Object.values(world.signs!).find((entry) => entry.x === 10 && entry.y === 10)!;
    expect(sign.maxHealth).toBe(COMPOSED_BALANCE.signHealth);
    const before = wood(c);
    expect(destroyTerritorySign(world, sign.id, c.id)).toMatchObject({ ok: true });
    expect(wood(c)).toBeCloseTo(before + COMPOSED_BALANCE.territoryWoodPerTile * COMPOSED_BALANCE.signRecoveryFraction, 9);
    expect(territoryAt(world, P(10, 10))).toBeUndefined();
    expect(territoryAt(world, P(10, 11))!.id).toBe(territoryId);
    expect(territoryOf(world, a.id)!.id).toBe(territoryId);
    expect(destroyTerritorySign(world, sign.id, c.id)).toMatchObject({ ok: false, code: 'missing-sign' });
    const second = Object.values(world.signs!).find((entry) => entry.x === 10 && entry.y === 12)!;
    destroyTerritorySign(world, second.id, a.id);
    expect(territoryAt(world, P(10, 11))!.id).toBe(territoryId); // fragment survives
    const last = Object.values(world.signs!).find((entry) => entry.territoryId === territoryId)!;
    destroyTerritorySign(world, last.id, a.id);
    expect(world.territories![territoryId]).toBeUndefined(); // last sign loss disbands
    expect(Object.values(world.signs!)).toHaveLength(0);
  });

  it('owner death succeeds by membership seniority, and rejoining resets seniority', () => {
    const { world, a, b, c } = fixture();
    found(world, a, [P(10, 10)]);
    world.tick = 10;
    admit(world, a, b);
    world.tick = 20;
    admit(world, a, c);
    world.tick = 30;
    expect(handleTerritoryCommand(world, b, { type: 'leave-territory' })).toMatchObject({ ok: true });
    world.tick = 40;
    admit(world, a, b); // b rejoins later than c ever left
    world.tick = 50;
    a.alive = false;
    settleTerritoryDeath(world, a.id);
    // c joined at tick 20 and never left; b's rejoining at tick 40 reset its seniority.
    expect(territoryOf(world, b.id)!.ownerId).toBe(c.id);
  });

  it('an eligible killer inherits; an unaffiliated killer joins; an affiliated killer does not', () => {
    const { world, a, b, c, d, e } = fixture();
    found(world, a, [P(10, 10)]);
    admit(world, a, b);
    admit(world, a, c);
    const territoryId = territoryOf(world, a.id)!.id;
    // A same-territory member killer inherits the leadership directly.
    a.alive = false;
    settleTerritoryDeath(world, a.id, b.id);
    expect(world.territories![territoryId].ownerId).toBe(b.id);
    // An unaffiliated killer conquers and becomes a member.
    b.alive = false;
    settleTerritoryDeath(world, b.id, d.id);
    const conquered = world.territories![territoryId];
    expect(conquered.ownerId).toBe(d.id);
    expect(conquered.members[d.id]).toBeDefined();
    // A killer affiliated elsewhere neither inherits nor switches membership.
    expect(found(world, e, [P(0, 0)])).toMatchObject({ ok: true });
    const eTerritoryId = territoryOf(world, e.id)!.id;
    d.alive = false;
    settleTerritoryDeath(world, d.id, e.id);
    expect(world.territories![eTerritoryId].ownerId).toBe(e.id); // e keeps its own territory
    expect(world.territories![territoryId].ownerId).toBe(c.id); // seniority picks the surviving member
  });

  it('a natural death with no surviving members disbands and removes the signs', () => {
    const { world, a } = fixture();
    found(world, a, [P(10, 10), P(10, 11)]);
    const territoryId = territoryOf(world, a.id)!.id;
    a.alive = false;
    settleTerritoryDeath(world, a.id);
    expect(territoryOf(world, a.id)).toBeUndefined();
    expect(world.territories![territoryId]).toBeUndefined();
    expect(Object.keys(world.signs!)).toHaveLength(0);
  });

  it('maintainTerritories promotes a leaderless territory by seniority as a safety net', () => {
    const { world, a, b } = fixture();
    found(world, a, [P(10, 10)]);
    admit(world, a, b);
    a.alive = false;
    maintainTerritories(world);
    expect(territoryOf(world, b.id)!.ownerId).toBe(b.id);
  });
});

describe('territory gates', () => {
  it('canBuildInTerritory allows members and outsiders outside, and blocks outsiders inside', () => {
    const { world, a, b } = fixture();
    expect(canBuildInTerritory(world, b.id, P(3, 3)).ok).toBe(true); // outside every territory
    found(world, a, [P(10, 10)]);
    expect(canBuildInTerritory(world, a.id, P(10, 10)).ok).toBe(true);
    expect(canBuildInTerritory(world, b.id, P(10, 10))).toMatchObject({ ok: false, code: 'not-member' });
  });

  it('canUseTerritoryBuilding grants owner use, member shared use inside, and nothing outside for outsiders', () => {
    const { world, a, b, c } = fixture();
    found(world, a, [P(10, 10), P(10, 11)]);
    admit(world, a, b);
    const station = placeBuilding(world, a.id, 10, 10);
    expect(canUseTerritoryBuilding(world, b.id, station)).toBe(true); // member shared use
    expect(canUseTerritoryBuilding(world, a.id, station)).toBe(true); // owner
    expect(canUseTerritoryBuilding(world, c.id, station)).toBe(false); // outsider inside
    const outside = placeBuilding(world, a.id, 3, 3);
    expect(canUseTerritoryBuilding(world, b.id, outside)).toBe(false);
    expect(canUseTerritoryBuilding(world, a.id, outside)).toBe(true);
    const house = { id: 'h', ownerId: a.id, x: 10, y: 11, tier: 1 as const, health: 100, maxHealth: 100 };
    world.houses = { h: house };
    expect(canUseTerritoryBuilding(world, b.id, house)).toBe(true); // generic house location/owner
    expect(canUseTerritoryBuilding(world, c.id, house)).toBe(false);
  });
});

describe('directed reputation and witnessed offenses', () => {
  it('records directed, clamped opinions and deletes neutral entries', () => {
    const { world, a, b } = fixture();
    expect(reputationLevel(world, a.id, b.id)).toBe('neutral');
    expect(changeReputation(world, a.id, b.id, -1)).toBe('disliked');
    expect(reputationLevel(world, a.id, b.id)).toBe('disliked');
    expect(reputationLevel(world, b.id, a.id)).toBe('neutral'); // directed, not symmetric
    for (let i = 0; i < 6; i++) changeReputation(world, a.id, b.id, +1);
    expect(reputationLevel(world, a.id, b.id)).toBe('admired'); // clamped
    for (let i = 0; i < 6; i++) changeReputation(world, a.id, b.id, -1);
    expect(reputationLevel(world, a.id, b.id)).toBe('hostile'); // clamped
    changeReputation(world, a.id, b.id, +2); // hostile + two steps returns to neutral
    expect(reputationLevel(world, a.id, b.id)).toBe('neutral');
    expect(Object.keys(world.reputations![a.id] ?? {})).toHaveLength(0); // neutral deletes
  });

  it('witnessed nonmember harvesting drops one level for every member under cooldown', () => {
    const { world, a, b, c } = fixture();
    found(world, a, [P(10, 10)]);
    admit(world, a, c);
    const tile = P(10, 10);
    const eventsBefore = world.events.length;
    expect(witnessTerritoryHarvest(world, b.id, a.id, tile)).toBe('disliked'); // member witness a
    expect(reputationLevel(world, a.id, b.id)).toBe('disliked');
    expect(reputationLevel(world, c.id, b.id)).toBe('disliked'); // propagated to all members
    expect(world.events.length).toBe(eventsBefore); // hook emits nothing and forces no combat
    expect(world.events.filter((entry) => entry.kind === 'attack')).toHaveLength(0);
    // Same offense is cooldown-suppressed; a different one is not.
    expect(witnessTerritoryHarvest(world, b.id, c.id, tile)).toBeUndefined();
    expect(reputationLevel(world, a.id, b.id)).toBe('disliked');
    world.tick += COMPOSED_BALANCE.offenseCooldownTicks;
    expect(witnessTerritoryHarvest(world, b.id, a.id, tile)).toBe('hostile');
    // Member harvesting is authorized; outsider witnesses have no territory consequence.
    admit(world, a, b);
    expect(witnessTerritoryHarvest(world, b.id, a.id, tile)).toBeUndefined();
    expect(witnessTerritoryHarvest(world, c.id, c.id, tile)).toBeUndefined();
  });

  it('witnessed member attacks set the attacker hostile for all members without commanding combat', () => {
    const { world, a, b, c, d } = fixture();
    found(world, a, [P(10, 10)]);
    admit(world, a, c);
    const eventsBefore = world.events.length;
    expect(witnessMemberAttack(world, b.id, c.id)).toBe('hostile');
    expect(reputationLevel(world, a.id, b.id)).toBe('hostile');
    expect(reputationLevel(world, c.id, b.id)).toBe('hostile');
    expect(world.events.length).toBe(eventsBefore);
    // A nonmember witness propagates nothing.
    expect(witnessMemberAttack(world, a.id, b.id)).toBeUndefined();
    // Structure attack and trespass drop one level for a fresh actor, each under
    // its own per-offense cooldown.
    expect(witnessStructureAttack(world, d.id, a.id, P(10, 10))).toBe('disliked');
    expect(witnessTerritoryTrespass(world, d.id, a.id, P(10, 10))).toBe('hostile');
    expect(witnessStructureAttack(world, d.id, a.id, P(10, 10))).toBeUndefined(); // cooldown
    expect(witnessTerritoryTrespass(world, d.id, a.id, P(10, 10))).toBeUndefined();
  });

  it('maintainTerritories expires admissions, cleans orphan signs and prunes cooldowns', () => {
    const { world, a } = fixture();
    found(world, a, [P(10, 10)]);
    const territoryId = territorySignsId(world, a);
    world.signs!.orphan = { id: 'orphan', territoryId: 'ghost', x: 4, y: 4, woodTier: 1, health: 16, maxHealth: 16 };
    (world.offenseCooldowns ??= {})[`${territoryId}:x:harvest`] = 5;
    world.tick = 6;
    maintainTerritories(world);
    expect(world.signs!.orphan).toBeUndefined();
    expect(world.offenseCooldowns![`${territoryId}:x:harvest`]).toBeUndefined();
    expect(world.territories![territoryId]).toBeDefined();
  });

  it('handleTerritoryCommand passes through unrelated commands', () => {
    const { world, a } = fixture();
    expect(handleTerritoryCommand(world, a, { type: 'move', x: 1, y: 1 } as never)).toBeUndefined();
    expect(handleTerritoryCommand(world, a, { type: 'harvest', depositId: 'x' } as never)).toBeUndefined();
  });

  it('produces checkpoint-valid territory state', () => {
    const { world, a, b } = fixture();
    found(world, a, [P(10, 10)]);
    const territoryId = territorySignsId(world, a);
    expect(handleTerritoryCommand(world, b, { type: 'join-territory', territoryId })).toMatchObject({ ok: true });
    handleTerritoryCommand(world, a, { type: 'vote-territory', territoryId, admissionId: territoryOf(world, a.id)!.admissions.at(-1)!.id, accept: true });
    changeReputation(world, a.id, b.id, -1);
    inheritTerritoryMembership(world, world.citizens[Object.keys(world.citizens).at(-1)!]!, a, world.citizens[b.id]!);
    const checkpoint = { version: 1, savedAt: new Date().toISOString(), world,
      runtime: { running: false, speed: 1, mode: 'scripted' as const, commandSequence: 0, recorded: [] } };
    expect(() => validateCheckpoint(JSON.parse(JSON.stringify(checkpoint)))).not.toThrow();
  });
});