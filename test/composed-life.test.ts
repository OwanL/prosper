import { describe, expect, it } from 'vitest';
import type { World } from '../src/shared/types.ts';
import type { Territory } from '../src/shared/territory-types.ts';
import type { WorldControlOptions } from '../src/world/evaluation-authority.ts';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { settleDeath } from '../src/world/life.ts';
import { BALANCE, COMPOSED_BALANCE, houseRecipe } from '../src/world/config.ts';
import { canUseTerritoryBuilding, territoryOf } from '../src/world/territory.ts';
import { reputationLevel } from '../src/world/reputation.ts';

function fixture() {
  const world = createWorld({
    seed: 42,
    scenario: 'progression',
    controllerMode: 'composed',
    autonomy: false,
  });
  world.deposits = {};
  const [a, b, c] = Object.values(world.citizens);
  for (const citizen of Object.values(world.citizens)) {
    citizen.x = 1; citizen.y = 1; citizen.fullness = 100;
    citizen.inventory = {}; citizen.gold = 0;
  }
  b.x = 2;
  return { world, a, b, c };
}

/** Explicit passive-body control authority: composed citizens keep physical
 * work, meals and rest, but the tree controller makes no strategic decisions,
 * so the controlled lifecycle mechanics below stay deterministic. Newborns
 * are bodies too, never strategic minds. */
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

/** A marked territory built through the sanctioned world records; membership
 * and signs are the authoritative forms the territory module reads. */
function makeTerritory(
  world: World,
  owner: { id: string },
  memberIds: string[],
  tiles: { x: number; y: number }[] = [{ x: 3, y: 1 }],
): Territory {
  const members: Territory['members'] = {
    [owner.id]: { citizenId: owner.id, joinedTick: world.tick, sequence: 0 },
  };
  for (const [index, memberId] of memberIds.filter((id) => id !== owner.id).entries())
    members[memberId] = { citizenId: memberId, joinedTick: world.tick, sequence: index + 1 };
  const territory: Territory = {
    id: 't', ownerId: owner.id, createdTick: world.tick, members, admissions: [],
  };
  (world.territories ??= {}).t = territory;
  for (const tile of tiles)
    (world.signs ??= {})[`sign-${tile.x}-${tile.y}`] = {
      id: `sign-${tile.x}-${tile.y}`, territoryId: 't', ...tile, woodTier: 1,
      health: COMPOSED_BALANCE.signHealth, maxHealth: COMPOSED_BALANCE.signHealth,
    };
  return territory;
}

function totalGold(world: World): number {
  return (
    Object.values(world.citizens).reduce((sum, c) => sum + c.gold, 0) +
    Object.values(world.orders).reduce((sum, order) => sum + order.escrowGold, 0) +
    Object.values(world.loot).reduce((sum, loot) => sum + loot.gold, 0)
  );
}
function totalHeld(world: World, item: string): number {
  return (
    Object.values(world.citizens).reduce((sum, c) => sum + (c.inventory[item] ?? 0), 0) +
    Object.values(world.orders).reduce((sum, o) => sum + (o.escrowItems[item] ?? 0), 0) +
    Object.values(world.loot).reduce((sum, l) => sum + (l.inventory[item] ?? 0), 0)
  );
}

describe('composed lifecycle estates', () => {
  it('settles an actual fatal attack, conserving fractional resources, escrow, gold and the owned house', () => {
    const { world, a, b } = fixture();
    b.inventory = { 'axe:1': 1, 'wood:1': 7.25 };
    b.gold = 20.5;
    expect(dispatch(world, b.id, { type: 'order', side: 'sell', item: 'axe:1', quantity: 1, price: 9 }).ok).toBe(true);
    expect(dispatch(world, b.id, { type: 'order', side: 'buy', item: 'fibre:1', quantity: 2, price: 3 }).ok).toBe(true);
    world.houses = { home: { id: 'home', ownerId: b.id, tier: 1, x: 3, y: 1, health: 100, maxHealth: 100 } };
    b.health = 1;
    expect(dispatch(world, a.id, { type: 'attack', targetId: b.id }).ok).toBe(true);
    tickBodies(world, BALANCE.attackTicks);
    expect(b.alive).toBe(false);
    expect(a.gold).toBe(20.5);
    expect(a.inventory).toEqual({ 'axe:1': 1, 'wood:1': 7.25 });
    expect(world.houses.home.ownerId).toBe(a.id);
    expect(Object.values(world.orders).filter((o) => o.citizenId === b.id)).toHaveLength(0);
    expect(world.loot).toEqual({});
    expect(totalGold(world)).toBe(20.5);
    expect(totalHeld(world, 'wood:1')).toBe(7.25);
    settleDeath(world, b.id, a.id); // Idempotent after real settlement.
    expect(a.gold).toBe(20.5);
  });

  it('prefers family and distributes full and fractional units deterministically', () => {
    const { world, a, b, c } = fixture();
    b.parents = [a.id]; c.parents = [a.id];
    a.inventory = { 'axe:1': 3, 'wood:1': 8.25 }; a.gold = 9.5;
    settleDeath(world, a.id);
    expect(b.gold + c.gold).toBe(9.5);
    expect([b.gold, c.gold].sort()).toEqual([4.5, 5]);
    expect((b.inventory['axe:1'] ?? 0) + (c.inventory['axe:1'] ?? 0)).toBe(3);
    expect([b.inventory['wood:1'] ?? 0, c.inventory['wood:1'] ?? 0].sort()).toEqual([4, 4.25]);
    expect(totalHeld(world, 'wood:1')).toBe(8.25);
    expect(world.loot).toEqual({});
  });

  it('completes real joint reproduction and refunds the surviving partner on death', () => {
    const { world, a, b } = fixture();
    for (const parent of [a, b]) parent.inventory = { 'food:1': BALANCE.reproductionFood * 2 };
    expect(dispatch(world, a.id, { type: 'reproduce', partnerId: b.id }).ok).toBe(true);
    tickBodies(world, BALANCE.reproductionTicks);
    const child = Object.values(world.citizens).find((c) => c.parents?.includes(a.id));
    expect(child?.parents).toEqual([a.id, b.id]);
    expect(child?.mind).toMatchObject({version:1,tasks:[],receipts:[]});
    expect(child?.rest?.value).toBe(100);
    a.reproductionCooldown = b.reproductionCooldown = 0;
    expect(dispatch(world, a.id, { type: 'reproduce', partnerId: b.id }).ok).toBe(true);
    settleDeath(world, a.id);
    expect(b.action).toBeNull();
    expect(b.inventory['food:1']).toBe(BALANCE.reproductionFood);
    expect(child?.inventory['food:1']).toBe(BALANCE.reproductionFood);
  });

  it('gives newborns membership of the shared parents territory and one equal vote', () => {
    const { world, a, b, c } = fixture();
    const territory = makeTerritory(world, a, [b.id]);
    for (const parent of [a, b]) parent.inventory = { 'food:1': BALANCE.reproductionFood };
    expect(dispatch(world, a.id, { type: 'reproduce', partnerId: b.id }).ok).toBe(true);
    tickBodies(world, BALANCE.reproductionTicks);
    const child = Object.values(world.citizens).find((entry) => entry.parents?.includes(a.id));
    expect(child).toBeTruthy();
    // The newborn joined without a vote and membership is their own record.
    expect(territoryOf(world, child!.id)?.id).toBe('t');
    expect(territory.members[child!.id]).toBeTruthy();
    // Admission votes count every living member equally; children included.
    expect(dispatch(world, c.id, { type: 'join-territory', territoryId: 't' }).ok).toBe(true);
    const admission = territory.admissions.at(-1)!;
    expect(admission.status).toBe('pending');
    expect(dispatch(world, a.id, {
      type: 'vote-territory', territoryId: 't', admissionId: admission.id, accept: true,
    }).ok).toBe(true);
    expect(admission.status).toBe('pending'); // One adult yes among three members.
    expect(dispatch(world, child!.id, {
      type: 'vote-territory', territoryId: 't', admissionId: admission.id, accept: true,
    }).ok).toBe(true);
    expect(admission.status).toBe('admitted'); // The child's single equal vote decided.
    expect(territory.members[c.id]).toBeTruthy();
  });

  it('hands a natural estate to buildings, houses and fractional gold while preserving member shared use', () => {
    const { world, a, b, c } = fixture();
    makeTerritory(world, a, [b.id, c.id], [{ x: 3, y: 1 }, { x: 4, y: 1 }]);
    const home = { id: 'home', ownerId: b.id, tier: 1, x: 3, y: 1, health: 100, maxHealth: 100 };
    world.houses = { home };
    world.buildings.station = {
      id: 'station', kind: 'lumbermill', tier: 1, ownerId: b.id, x: 4, y: 1,
      health: 100, maxHealth: 100, materials: { 'wood:1': 6 },
    };
    b.gold = 2.75;
    b.health = 0;
    tickBodies(world, 1);
    expect(b.alive).toBe(false);
    expect(territoryOf(world, b.id)).toBeUndefined();
    // Both owned properties passed to living members; owners never dangle.
    expect(new Set([home.ownerId, world.buildings.station.ownerId]).size).toBe(2);
    expect([home.ownerId, world.buildings.station.ownerId].every(
      (owner) => owner === a.id || owner === c.id,
    )).toBe(true);
    expect(a.gold + c.gold).toBe(2.75);
    // Shared use survives the inheritance: membership, not ownership, opens
    // the house and the station inside the marked area.
    for (const member of [a, c]) {
      expect(canUseTerritoryBuilding(world, member.id, home)).toBe(true);
      expect(canUseTerritoryBuilding(world, member.id, world.buildings.station)).toBe(true);
    }
    // Real shared use: a surviving non-owner member actually rests in the
    // inherited house.
    const sleeper = [a, c].find((member) => member.id !== home.ownerId)!;
    sleeper.rest!.value = 40;
    expect(dispatch(world, sleeper.id, {
      type: 'sleep', targetRest: 60, houseId: 'home',
    }).ok).toBe(true);
    tickBodies(world, 14);
    // House-rate rest (4/tick) exceeds the outdoor rate: real shared use.
    expect(sleeper.rest!.value).toBeGreaterThan(60);
    expect(sleeper.rest!.sleepingHouseId).toBeUndefined();
  });

  it('settles a fatal attack on a territory owner by conquest succession with the exact killer estate', () => {
    const { world, a, b } = fixture();
    makeTerritory(world, b, []);
    world.houses = { home: { id: 'home', ownerId: b.id, tier: 1, x: 3, y: 1, health: 100, maxHealth: 100 } };
    b.inventory = { 'wood:1': 3.75, 'food:2': 2 };
    b.gold = 10.5;
    b.health = 1;
    expect(dispatch(world, a.id, { type: 'attack', targetId: b.id }).ok).toBe(true);
    tickBodies(world, BALANCE.attackTicks);
    expect(b.alive).toBe(false);
    expect(a.gold).toBe(10.5);
    expect(a.inventory).toEqual({ 'wood:1': 3.75, 'food:2': 2 });
    expect(world.houses.home.ownerId).toBe(a.id);
    // The unaffiliated killer conquered leadership and joined as a member.
    expect(world.territories!.t.ownerId).toBe(a.id);
    expect(world.territories!.t.members[a.id]).toBeTruthy();
    expect(world.territories!.t.members[b.id]).toBeUndefined();
    expect(totalGold(world)).toBe(10.5);
    expect(totalHeld(world, 'wood:1')).toBe(3.75);
  });

  it('falls back to territory members before the general population', () => {
    const { world, a, b, c } = fixture();
    makeTerritory(world, a, [b.id]);
    a.gold = 7;
    settleDeath(world, a.id);
    expect(b.gold).toBe(7);
    expect(c.gold).toBe(0);
    expect(world.territories!.t.ownerId).toBe(b.id);
  });

  it('redistributes to all living citizens when there is no family or territory', () => {
    const { world, a } = fixture();
    a.gold = 17.5; a.inventory = { 'sword:1': 5 };
    settleDeath(world, a.id);
    const survivors = Object.values(world.citizens).filter((c) => c.alive);
    expect(survivors.reduce((sum, c) => sum + c.gold, 0)).toBe(17.5);
    expect(survivors.reduce((sum, c) => sum + (c.inventory['sword:1'] ?? 0), 0)).toBe(5);
    expect(Math.max(...survivors.map((c) => c.gold)) - Math.min(...survivors.map((c) => c.gold))).toBeLessThanOrEqual(1);
  });

  it('retains a last citizen fractional estate in custody without ground loot', () => {
    const { world, a } = fixture();
    for (const c of Object.values(world.citizens)) if (c !== a) c.alive = false;
    a.inventory = { 'sword:1': 0.75 }; a.gold = 3.5;
    settleDeath(world, a.id);
    expect(a.inventory['sword:1']).toBe(0.75);
    expect(a.gold).toBe(3.5);
    expect(world.loot).toEqual({});
  });

  it('witnesses only genuinely seen pursuit steps as trespass on member reputations', () => {
    const { world, a, b, c } = fixture();
    makeTerritory(world, c, [b.id], [{ x: 3, y: 1 }, { x: 4, y: 1 }]);
    b.x = 2;
    c.x = 20; c.y = 20; // Living member kept far away: no real sight of the corridor.
    a.x = 0;
    // Dated knowledge is a legal initial destination; c now stands elsewhere.
    a.knowledge['8,1'] = {
      x: 8, y: 1, seenTick: 0, buildings: [], deposits: [], loot: [],
      citizens: [{ id: c.id, name: c.name, color: c.color, alive: true, health: 100, activity: 'idle', x: 8, y: 1 }],
    };
    expect(dispatch(world, a.id, { type: 'attack', targetId: c.id }).ok).toBe(true);
    tickBodies(world, 8); // Pursuit steps to (1..4,1); both marked tiles crossed.
    expect(a.x).toBe(4);
    expect(reputationLevel(world, b.id, a.id)).toBe('disliked');
    // One witnessed offense carries one sanction to every living member once.
    expect(reputationLevel(world, c.id, a.id)).toBe('disliked');
    tickBodies(world, 6); // More sighted steps land inside the cooldown window.
    dispatch(world, a.id, { type: 'cancel' });
    expect(reputationLevel(world, b.id, a.id)).toBe('disliked');
  });

  it('never sanctions pursuit steps that no member can actually see', () => {
    const { world, a, b, c } = fixture();
    makeTerritory(world, c, [b.id], [{ x: 3, y: 1 }, { x: 4, y: 1 }]);
    b.x = 18; b.y = 1; // Both members are far from the marked corridor tiles.
    c.x = 20; c.y = 20;
    a.x = 0;
    a.knowledge['8,1'] = {
      x: 8, y: 1, seenTick: 0, buildings: [], deposits: [], loot: [],
      citizens: [{ id: c.id, name: c.name, color: c.color, alive: true, health: 100, activity: 'idle', x: 8, y: 1 }],
    };
    expect(dispatch(world, a.id, { type: 'attack', targetId: c.id }).ok).toBe(true);
    tickBodies(world, 14);
    expect(a.x).toBe(7); // The pursuit crossed both marked tiles unseen.
    dispatch(world, a.id, { type: 'cancel' });
    expect(reputationLevel(world, b.id, a.id)).toBe('neutral');
    expect(reputationLevel(world, c.id, a.id)).toBe('neutral');
  });

  it('destroys a house through real attacks with one-time salvage and wakes its sleeper', () => {
    const { world, a, b } = fixture();
    world.houses = { home: { id: 'home', ownerId: b.id, tier: 2, x: 3, y: 1, health: 9, maxHealth: 100 } };
    a.inventory['sword:3'] = 1;
    b.rest!.value = 40;
    expect(dispatch(world, b.id, { type: 'sleep', targetRest: 60, houseId: 'home' }).ok).toBe(true);
    expect(dispatch(world, a.id, { type: 'attack', targetId: 'home' }).ok).toBe(true);
    tickBodies(world, 12);
    expect(world.houses).toEqual({});
    const salvage = Object.fromEntries(
      Object.entries(houseRecipe(2)).map(([key, n]) => [key, Math.floor(n * BALANCE.salvageFraction)]),
    );
    expect(a.inventory).toMatchObject(salvage);
    expect(world.events.find((e) => e.kind === 'destruction')).toMatchObject({ targetId: 'home' });
    const alert = world.events.find((e) => e.kind === 'attack')!;
    expect(alert.audience).toContain(b.id);
    tickBodies(world, 12);
    expect(a.inventory).toMatchObject(salvage); // Construction salvage awarded once.
    // The sleeper whose house vanished revalidates on their own tick.
    expect(b.action).toBeNull();
    expect(b.rest!.sleepingHouseId).toBeUndefined();
    expect(b.lastResult).toContain('no longer exists');
  });
});