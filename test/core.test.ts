import { describe, expect, it } from 'vitest';
import type {
  Building,
  Citizen,
  Command,
  Deposit,
  Resource,
  Tier,
  World,
} from '../src/shared/types.ts';
import { distance, regionAt } from '../src/shared/utils.ts';
import { BALANCE, buildingRecipe, harvestDuration, nutrition } from '../src/world/config.ts';
import { cancelAction, createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { findPath } from '../src/world/pathfinding.ts';

function fixture() {
  const world = createWorld({ seed: 42 });
  const [citizen, other] = Object.values(world.citizens);
  return { world, citizen, other };
}
function send(world: World, citizen: Citizen, command: Command) {
  const result = dispatch(world, citizen.id, command);
  expect(result, result.message).toMatchObject({ ok: true });
  return result;
}
function settle(world: World, citizen: Citizen) {
  let ticks = 0;
  while ((citizen.action || citizen.queue.length) && ticks++ < 2_000) tickWorld(world);
  expect(citizen.action, citizen.lastResult).toBeNull();
  expect(citizen.queue).toEqual([]);
}
function deposit(world: World, resource: Resource = 'wood', tier: Tier = 1): Deposit {
  return Object.values(world.deposits).find((d) => d.resource === resource && d.tier === tier)!;
}
function station(world: World, citizen: Citizen, tier: Tier = 1): Building {
  const building: Building = {
    id: 'station-fixture',
    kind: 'lumbermill',
    tier,
    x: citizen.x,
    y: citizen.y,
    health: 100,
    maxHealth: 100,
    ownerId: citizen.id,
    materials: buildingRecipe('lumbermill', tier),
  };
  world.buildings[building.id] = building;
  return building;
}
function openSite(world: World, citizen: Citizen) {
  const points = [];
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) {
      if (
        !Object.values(world.deposits).some((d) => d.x === x && d.y === y) &&
        !Object.values(world.buildings).some((b) => b.x === x && b.y === y)
      )
        points.push({ x, y });
    }
  return points.sort((a, b) => distance(a, citizen) - distance(b, citizen))[0];
}
function gather(world: World, citizen: Citizen, resource: Resource, tier: Tier, quantity: number) {
  let attempts = 0;
  while ((citizen.inventory[`${resource}:${tier}`] ?? 0) < quantity && attempts++ < 100) {
    const candidates = Object.values(world.deposits)
      .filter((d) => d.resource === resource && d.tier === tier && d.stock > 0)
      .sort((a, b) => distance(a, citizen) - distance(b, citizen));
    if (!candidates.length) {
      tickWorld(world, BALANCE.regrowTicks);
      continue;
    }
    send(world, citizen, { type: 'harvest', depositId: candidates[0].id });
    settle(world, citizen);
  }
  expect(citizen.inventory[`${resource}:${tier}`]).toBeGreaterThanOrEqual(quantity);
}

describe('foundational world', () => {
  it('creates deterministic regional supply and viable, equipped-once ring2 citizens', () => {
    const { world } = fixture();
    expect(world).toEqual(createWorld({ seed: 42 }));
    expect(world.deposits).not.toEqual(createWorld({ seed: 43 }).deposits);
    for (const region of ['ring2', 'ring1', 'center'] as const) {
      const deposits = Object.values(world.deposits).filter((d) => regionAt(world, d) === region);
      for (const resource of ['wood', 'food', 'fibre'])
        expect(deposits.filter((d) => d.resource === resource).length).toBeGreaterThan(0);
      if (region === 'ring2') {
        expect(deposits.filter((d) => d.tier === 2).length / deposits.length).toBeLessThan(0.1);
        expect(deposits.some((d) => d.tier === 3)).toBe(false);
      }
      if (region === 'ring1') {
        expect(deposits.filter((d) => d.tier === 2).length).toBeGreaterThan(deposits.length / 2);
        expect(deposits.some((d) => d.tier === 3)).toBe(false);
      }
      if (region === 'center') expect(deposits.every((d) => d.tier === 3)).toBe(true);
    }
    for (const citizen of Object.values(world.citizens)) {
      expect(regionAt(world, citizen)).toBe('ring2');
      expect(citizen.gold).toBe(100);
      expect(citizen.fullness).toBe(100);
      expect(citizen.equipment).toEqual({});
      expect(citizen.inventory).toEqual({ 'food:1': 3 });
      expect(
        Object.values(world.deposits).some((d) => d.tier === 1 && distance(d, citizen) === 0),
      ).toBe(true);
    }
    expect(world.initialGold).toBe(
      Object.values(world.citizens).reduce((sum, c) => sum + c.gold, 0),
    );
    expect(JSON.parse(JSON.stringify(world))).toEqual(world);
  });

  it('finds deterministic orthogonal paths, allowing stations and shared tiles but not walls', () => {
    const { world, citizen } = fixture();
    citizen.x = 0;
    citizen.y = 0;
    expect(findPath(world, citizen, { x: 1, y: 1 })).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
    const building = station(world, citizen);
    building.x = 1;
    building.y = 0;
    expect(findPath(world, citizen, { x: 1, y: 0 })).toEqual([{ x: 1, y: 0 }]);
    building.kind = 'wall';
    expect(findPath(world, citizen, { x: 1, y: 0 })).toBeNull();
    expect(findPath(world, citizen, { x: 1, y: 1 })).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
    send(world, citizen, { type: 'move', x: 1, y: 1 });
    tickWorld(world);
    expect({ x: citizen.x, y: citizen.y }).toEqual({ x: 0, y: 0 });
    tickWorld(world);
    expect({ x: citizen.x, y: citizen.y }).toEqual({ x: 0, y: 1 });
    tickWorld(world, 2);
    expect(citizen.action).toBeNull();
    expect(citizen.x).toBe(1);
  });

  it('reserves harvest stock across travel and work; cancellation releases it without a yield', () => {
    const { world, citizen, other } = fixture();
    const node = deposit(world);
    const before = { ...citizen.inventory };
    send(world, citizen, { type: 'harvest', depositId: node.id });
    expect(dispatch(world, other.id, { type: 'harvest', depositId: node.id }).code).toBe(
      'depleted-deposit',
    );
    expect(node.stock).toBe(1);
    send(world, citizen, { type: 'cancel' });
    expect(citizen.inventory).toEqual(before);
    other.x = node.x;
    other.y = node.y;
    send(world, other, { type: 'harvest', depositId: node.id });
    tickWorld(world, BALANCE.harvestTicks - 1);
    expect(node.stock).toBe(1);
    tickWorld(world);
    expect(node.stock).toBe(0);
    expect(other.inventory['wood:1']).toBe(1);
    expect(dispatch(world, other.id, { type: 'harvest', depositId: node.id }).code).toBe(
      'depleted-deposit',
    );
    tickWorld(world, BALANCE.regrowTicks - 1);
    expect(node.stock).toBe(0);
    tickWorld(world);
    expect(node.stock).toBe(1);
  });

  it('applies the exact matching-tool duration table and tier requirements', () => {
    for (const [tool, expected] of [
      [0, [8, 0, 0]],
      [1, [4, 8, 0]],
      [2, [2, 4, 8]],
      [3, [1, 2, 4]],
    ] as const) {
      for (const tier of [1, 2, 3] as const) {
        const { world, citizen } = fixture();
        const node = deposit(world, 'wood', tier);
        citizen.x = node.x;
        citizen.y = node.y;
        if (tool) {
          citizen.inventory[`axe:${tool}`] = 1;
          send(world, citizen, { type: 'equip', item: `axe:${tool}` });
        }
        const result = dispatch(world, citizen.id, { type: 'harvest', depositId: node.id });
        expect(result.ok).toBe(expected[tier - 1] > 0);
        if (result.ok) {
          expect(citizen.action?.duration).toBe(expected[tier - 1]);
          expect(harvestDuration(tier, tool)).toBe(expected[tier - 1]);
        } else expect(result.code).toBe('tool-required');
      }
    }
    const { world, citizen } = fixture();
    citizen.inventory['scythe:3'] = 1;
    send(world, citizen, { type: 'equip', item: 'scythe:3' });
    expect(
      dispatch(world, citizen.id, { type: 'harvest', depositId: deposit(world, 'wood', 2).id })
        .code,
    ).toBe('tool-required');
  });

  it('counts equipped equipment once and locks its use through harvesting', () => {
    const { world, citizen } = fixture();
    citizen.inventory['axe:1'] = 1;
    send(world, citizen, { type: 'equip', item: 'axe:1' });
    expect(citizen.inventory['axe:1']).toBe(1);
    send(world, citizen, { type: 'harvest', depositId: deposit(world).id });
    expect(dispatch(world, citizen.id, { type: 'unequip', kind: 'axe' }).code).toBe(
      'equipment-in-use',
    );
    expect(
      dispatch(world, citizen.id, {
        type: 'order',
        side: 'sell',
        item: 'axe:1',
        quantity: 1,
        price: 5,
      }).ok,
    ).toBe(false);
    send(world, citizen, { type: 'cancel' });
    send(world, citizen, { type: 'unequip', kind: 'axe' });
    send(world, citizen, { type: 'order', side: 'sell', item: 'axe:1', quantity: 1, price: 5 });
    expect(citizen.inventory['axe:1']).toBeUndefined();
    expect(dispatch(world, citizen.id, { type: 'equip', item: 'axe:1' }).code).toBe(
      'missing-equipment',
    );
  });

  it('reserves recipe inputs once, excludes meals/sales, and refunds on interruption', () => {
    const { world, citizen } = fixture();
    citizen.inventory = { 'food:1': 3, 'fibre:1': 3 };
    citizen.fullness = 0;
    send(world, citizen, { type: 'craft', item: 'axe', tier: 1 });
    expect(citizen.inventory).toEqual({});
    expect(citizen.action?.reserved).toEqual({ 'food:1': 3, 'fibre:1': 3 });
    expect(
      dispatch(world, citizen.id, {
        type: 'order',
        side: 'sell',
        item: 'food:1',
        quantity: 1,
        price: 1,
      }).ok,
    ).toBe(false);
    tickWorld(world, 2);
    expect(citizen.fullness).toBe(0);
    expect(citizen.health).toBeLessThan(100);
    send(world, citizen, { type: 'cancel' });
    expect(citizen.inventory).toEqual({ 'food:1': 3, 'fibre:1': 3 });
    cancelAction(world, citizen.id);
    expect(citizen.inventory['food:1']).toBe(3);
    tickWorld(world);
    expect(citizen.fullness).toBeCloseTo(100 / 9);
    expect(citizen.inventory['food:1']).toBe(2);
  });

  it('validates replacements before interrupting, then returns previous inputs atomically', () => {
    const { world, citizen } = fixture();
    citizen.inventory = { 'food:1': 3, 'fibre:1': 3, 'wood:1': 3 };
    send(world, citizen, { type: 'craft', item: 'axe', tier: 1 });
    tickWorld(world, 3);
    const actionId = citizen.action?.id;
    expect(dispatch(world, citizen.id, { type: 'craft', item: 'sword', tier: 3 }).code).toBe(
      'insufficient-materials',
    );
    expect(citizen.action?.id).toBe(actionId);
    expect(citizen.action?.elapsed).toBe(3);
    send(world, citizen, { type: 'craft', item: 'knife', tier: 1 });
    expect(citizen.inventory).toEqual({ 'food:1': 3 });
    settle(world, citizen);
    expect(citizen.inventory['knife:1']).toBe(1);
    expect(citizen.inventory['axe:1']).toBeUndefined();
    send(world, citizen, { type: 'cancel' });
    expect(citizen.inventory['knife:1']).toBe(1);
  });

  it('defers queued reservations, activates serially, and surfaces failed queued work', () => {
    const { world, citizen } = fixture();
    const node = deposit(world);
    citizen.x = node.x;
    citizen.y = node.y;
    citizen.inventory = { 'wood:1': 2, 'fibre:1': 3 };
    send(world, citizen, { type: 'harvest', depositId: node.id });
    send(world, citizen, { type: 'craft', item: 'knife', tier: 1, queue: 'append' });
    send(world, citizen, { type: 'craft', item: 'sword', tier: 3, queue: 'append' });
    expect(citizen.inventory).toEqual({ 'wood:1': 2, 'fibre:1': 3 });
    tickWorld(world, BALANCE.harvestTicks);
    expect(citizen.action?.command.type).toBe('craft');
    expect(citizen.action?.elapsed).toBe(0);
    expect(citizen.inventory).toEqual({});
    settle(world, citizen);
    expect(citizen.inventory['knife:1']).toBe(1);
    expect(citizen.lastResult).toContain('Required unreserved materials');
  });

  it('rejects mixed tiers and completes exact-tier crafting only once', () => {
    const { world, citizen } = fixture();
    citizen.inventory = { 'wood:1': 2, 'wood:2': 1, 'fibre:1': 3 };
    expect(dispatch(world, citizen.id, { type: 'craft', item: 'knife', tier: 1 }).code).toBe(
      'insufficient-materials',
    );
    citizen.inventory['wood:1'] = 3;
    send(world, citizen, { type: 'craft', item: 'knife', tier: 1 });
    tickWorld(world, BALANCE.craftTicks - 1);
    expect(citizen.inventory['knife:1']).toBeUndefined();
    tickWorld(world, 10);
    expect(citizen.inventory).toEqual({ 'wood:2': 1, 'knife:1': 1 });
    expect(citizen.equipment).toEqual({});
  });

  it('constructs with travel and reserved footprints, then operates owner-only stations', () => {
    const { world, citizen, other } = fixture();
    citizen.inventory = { 'wood:1': 9, 'fibre:1': 4 };
    other.inventory = { 'wood:1': 6, 'fibre:1': 4 };
    const site = openSite(world, citizen);
    send(world, citizen, { type: 'build', kind: 'lumbermill', tier: 1, ...site });
    other.x = citizen.x;
    other.y = citizen.y;
    expect(
      dispatch(world, other.id, { type: 'build', kind: 'butchery', tier: 1, ...site }).code,
    ).toBe('reserved-site');
    settle(world, citizen);
    const building = Object.values(world.buildings)[0];
    expect(building.materials).toEqual({ 'wood:1': 6, 'fibre:1': 4 });
    expect(citizen.x).toBe(site.x);
    expect(citizen.y).toBe(site.y);
    expect(
      dispatch(world, other.id, { type: 'refine', buildingId: building.id, fromTier: 1 }).code,
    ).toBe('not-owner');
    send(world, citizen, { type: 'refine', buildingId: building.id, fromTier: 1 });
    expect(citizen.inventory['wood:1']).toBeUndefined();
    settle(world, citizen);
    expect(citizen.inventory['wood:2']).toBe(1);
    expect(
      dispatch(world, citizen.id, { type: 'refine', buildingId: building.id, fromTier: 2 }).code,
    ).toBe('invalid-refining-tier');
  });

  it('refunds active refining after destruction or lost ownership and rejects listed stations', () => {
    for (const mutation of ['destroy', 'ownership'] as const) {
      const { world, citizen, other } = fixture();
      const building = station(world, citizen, 2);
      citizen.inventory = { 'wood:2': 3 };
      send(world, citizen, { type: 'refine', buildingId: building.id, fromTier: 2 });
      tickWorld(world, 2);
      if (mutation === 'destroy') delete world.buildings[building.id];
      else building.ownerId = other.id;
      tickWorld(world);
      expect(citizen.action).toBeNull();
      expect(citizen.inventory).toEqual({ 'wood:2': 3 });
    }
    const { world, citizen } = fixture();
    const building = station(world, citizen);
    citizen.inventory = { 'wood:1': 3 };
    send(world, citizen, {
      type: 'order',
      side: 'sell',
      item: `building:${building.id}`,
      quantity: 1,
      price: 10,
    });
    expect(
      dispatch(world, citizen.id, { type: 'refine', buildingId: building.id, fromTier: 1 }).code,
    ).toBe('listed-station');
    send(world, citizen, { type: 'cancel-order', orderId: Object.keys(world.orders)[0] });
    send(world, citizen, { type: 'refine', buildingId: building.id, fromTier: 1 });
    expect(
      dispatch(world, citizen.id, {
        type: 'order',
        side: 'sell',
        item: `building:${building.id}`,
        quantity: 1,
        price: 10,
      }).code,
    ).toBe('building-busy');
  });

  it('builds walls from adjacent tiles and prevents covering deposits/citizens', () => {
    const { world, citizen, other } = fixture();
    citizen.inventory = { 'wood:1': 4, 'fibre:1': 2 };
    expect(
      dispatch(world, citizen.id, {
        type: 'build',
        kind: 'wall',
        tier: 1,
        x: citizen.x,
        y: citizen.y,
      }).code,
    ).toBe('occupied-site');
    const site = openSite(world, citizen);
    other.x = site.x;
    other.y = site.y;
    expect(
      dispatch(world, citizen.id, { type: 'build', kind: 'wall', tier: 1, ...site }).code,
    ).toBe('occupied-site');
    other.x = 0;
    other.y = 0;
    if (site.x === 0 && site.y === 0) other.x = 1;
    send(world, citizen, { type: 'build', kind: 'wall', tier: 1, ...site });
    settle(world, citizen);
    expect(distance(citizen, site)).toBe(1);
    expect(Object.values(world.buildings)[0].kind).toBe('wall');
    expect(findPath(world, citizen, site)).toBeNull();
  });

  it.each([false, true])(
    'does not revalidate an unseen build site on a detour (occupant remains: %s)',
    (remains) => {
      const { world, citizen, other } = fixture();
      world.deposits = {};
      world.citizens = { [citizen.id]: citizen, [other.id]: other };
      citizen.x = 1;
      citizen.y = 1;
      other.x = 10;
      other.y = 10;
      const materials = buildingRecipe('wall', 1);
      citizen.inventory = { ...materials };
      const blocker = station(world, citizen);
      blocker.kind = 'wall';
      blocker.x = 2;
      blocker.y = 1;
      const site = { x: 4, y: 1 };
      send(world, citizen, { type: 'build', kind: 'wall', tier: 1, ...site });
      const actionId = citizen.action!.id;
      tickWorld(world, BALANCE.moveTicks);
      expect({ x: citizen.x, y: citizen.y }).toEqual({ x: 1, y: 2 });
      expect(distance(citizen, site)).toBeGreaterThan(BALANCE.sightRadius);
      const lastResult = citizen.lastResult;
      const eventCount = world.events.length;
      other.x = site.x;
      other.y = site.y;
      tickWorld(world);
      expect(citizen.action?.id).toBe(actionId);
      expect(citizen.lastResult).toBe(lastResult);
      expect(world.events).toHaveLength(eventCount);
      expect(citizen.inventory).toEqual({});
      expect(Object.values(world.buildings)).toHaveLength(1);
      if (!remains) {
        other.x = 10;
        other.y = 10;
      }
      settle(world, citizen);
      if (remains) {
        expect(citizen.lastResult).toContain('A wall cannot be placed on a citizen');
        expect(citizen.inventory).toEqual(materials);
        expect(Object.values(world.buildings)).toHaveLength(1);
      } else {
        expect(citizen.lastResult).toBe('Completed build.');
        expect(distance(citizen, site)).toBe(1);
        expect(citizen.inventory).toEqual({});
        expect(
          Object.values(world.buildings).filter((b) => b.x === site.x && b.y === site.y),
        ).toHaveLength(1);
      }
    },
  );

  it.each([false, true])(
    'requires sight at direct and queued build activation before occupancy checks (occupied: %s)',
    (occupied) => {
      const { world, citizen, other } = fixture();
      world.deposits = {};
      citizen.x = 1;
      citizen.y = 1;
      other.x = occupied ? 5 : 10;
      other.y = occupied ? 1 : 10;
      citizen.inventory = { ...buildingRecipe('wall', 1) };
      const build: Command = { type: 'build', kind: 'wall', tier: 1, x: 5, y: 1 };
      expect(dispatch(world, citizen.id, build).code).toBe('outside-sight');
      send(world, citizen, { type: 'move', x: 0, y: 1 });
      send(world, citizen, { ...build, queue: 'append' });
      settle(world, citizen);
      expect(citizen.lastResult).toContain('Travel');
      expect(citizen.lastResult).not.toContain('occupied');
      expect(citizen.inventory).toEqual(buildingRecipe('wall', 1));
      expect(world.buildings).toEqual({});
      expect(world.events.filter((e) => e.kind === 'error').map((e) => e.text)).toEqual([
        citizen.lastResult,
        citizen.lastResult,
      ]);
    },
  );

  it('rechecks wall occupancy atomically before construction completes', () => {
    const { world, citizen, other } = fixture();
    world.deposits = {};
    citizen.x = 1;
    citizen.y = 1;
    other.x = 10;
    other.y = 10;
    const materials = buildingRecipe('wall', 1);
    citizen.inventory = { ...materials };
    send(world, citizen, { type: 'build', kind: 'wall', tier: 1, x: 2, y: 1 });
    tickWorld(world, BALANCE.buildTicks - 1);
    other.x = 2;
    other.y = 1;
    tickWorld(world);
    expect(citizen.action).toBeNull();
    expect(citizen.inventory).toEqual(materials);
    expect(world.buildings).toEqual({});
    expect(citizen.lastResult).toContain('A wall cannot be placed on a citizen');
  });

  it('reroutes interrupted travel and releases work when the destination becomes unreachable', () => {
    const { world, citizen } = fixture();
    citizen.x = 0;
    citizen.y = 0;
    send(world, citizen, { type: 'move', x: 2, y: 0 });
    const wall = station(world, citizen);
    wall.kind = 'wall';
    wall.x = 1;
    wall.y = 0;
    tickWorld(world, 2);
    expect({ x: citizen.x, y: citizen.y }).toEqual({ x: 0, y: 1 });
    settle(world, citizen);
    expect({ x: citizen.x, y: citizen.y }).toEqual({ x: 2, y: 0 });
    send(world, citizen, { type: 'move', x: 0, y: 0 });
    const blocked = { ...wall, id: 'destination-wall', x: 0, y: 0 };
    world.buildings[blocked.id] = blocked;
    settle(world, citizen);
    expect(citizen.lastResult).toContain('blocked');
  });

  it('makes T1 -> tools/stations -> T2 -> T3 progression possible from creation', () => {
    const { world, citizen } = fixture();
    gather(world, citizen, 'food', 1, 9);
    gather(world, citizen, 'wood', 1, 3);
    gather(world, citizen, 'fibre', 1, 3);
    send(world, citizen, { type: 'craft', item: 'knife', tier: 1 });
    settle(world, citizen);
    send(world, citizen, { type: 'equip', item: 'knife:1' });
    gather(world, citizen, 'food', 1, 6);
    gather(world, citizen, 'fibre', 1, 3);
    send(world, citizen, { type: 'craft', item: 'axe', tier: 1 });
    settle(world, citizen);
    send(world, citizen, { type: 'equip', item: 'axe:1' });
    gather(world, citizen, 'wood', 1, 9);
    gather(world, citizen, 'fibre', 1, 4);
    send(world, citizen, {
      type: 'build',
      kind: 'lumbermill',
      tier: 1,
      ...openSite(world, citizen),
    });
    settle(world, citizen);
    const first = Object.values(world.buildings)[0];
    send(world, citizen, { type: 'refine', buildingId: first.id, fromTier: 1 });
    settle(world, citizen);
    expect(citizen.inventory['wood:2']).toBe(1);
    gather(world, citizen, 'wood', 2, 3);
    gather(world, citizen, 'food', 2, 3);
    send(world, citizen, { type: 'craft', item: 'scythe', tier: 2 });
    settle(world, citizen);
    send(world, citizen, { type: 'equip', item: 'scythe:2' });
    gather(world, citizen, 'fibre', 3, 1);
    expect(citizen.inventory['fibre:3']).toBe(1);
    gather(world, citizen, 'wood', 2, 9);
    gather(world, citizen, 'fibre', 2, 4);
    send(world, citizen, {
      type: 'build',
      kind: 'lumbermill',
      tier: 2,
      ...openSite(world, citizen),
    });
    settle(world, citizen);
    const second = Object.values(world.buildings).find((b) => b.tier === 2)!;
    send(world, citizen, { type: 'refine', buildingId: second.id, fromTier: 2 });
    settle(world, citizen);
    expect(citizen.inventory['wood:3']).toBe(1);
    expect(citizen.health).toBeGreaterThan(0);
    expect(Object.values(world.citizens).reduce((sum, c) => sum + c.gold, 0)).toBe(
      world.initialGold,
    );
  });

  it('auto-eats the lowest available tier, clamps nutrition, and preserves nutrition when refining', () => {
    const { world, citizen } = fixture();
    citizen.fullness = 60;
    citizen.health = 50;
    citizen.inventory = { 'food:1': 1, 'food:2': 1, 'food:3': 1 };
    tickWorld(world);
    expect(citizen.inventory['food:1']).toBeUndefined();
    expect(citizen.inventory['food:2']).toBe(1);
    expect(citizen.fullness).toBeCloseTo(59.9 + 100 / 9);
    expect(citizen.health).toBeCloseTo(50.05);
    citizen.fullness = 0;
    citizen.inventory = { 'food:3': 1 };
    tickWorld(world);
    expect(citizen.fullness).toBe(100);
    expect(citizen.health).toBeCloseTo(50.1);
    expect(nutrition(1) * 3).toBeCloseTo(nutrition(2));
    expect(nutrition(2) * 3).toBeCloseTo(nutrition(3));
    citizen.fullness = 99;
    citizen.inventory = { 'food:1': 1 };
    tickWorld(world);
    expect(citizen.inventory['food:1']).toBe(1);
  });

  it('allows 1,000 ticks of fullness and 500 ticks of starvation with no food', () => {
    const { world, citizen } = fixture();
    citizen.inventory = {};
    tickWorld(world, 999);
    expect(citizen.health).toBe(100);
    expect(citizen.fullness).toBeCloseTo(0.1);
    tickWorld(world);
    expect(citizen.fullness).toBe(0);
    expect(citizen.health).toBeCloseTo(99.8);
    tickWorld(world, 499);
    expect(citizen.health).toBe(0);
    expect(citizen.alive).toBe(false);
    expect(Object.values(world.loot)).toEqual([
      expect.objectContaining({
        citizenName: citizen.name,
        x: citizen.x,
        y: citizen.y,
        gold: 100,
        inventory: {},
      }),
    ]);
    expect(dispatch(world, citizen.id, { type: 'move', x: 0, y: 0 }).code).toBe(
      'unavailable-citizen',
    );
  });

  it('keeps market/message/memory commands separate from physical work and bounded', () => {
    const { world, citizen, other } = fixture();
    send(world, citizen, { type: 'move', x: citizen.x < 10 ? 20 : 0, y: citizen.y < 10 ? 20 : 0 });
    const actionId = citizen.action?.id;
    send(world, citizen, { type: 'transfer', citizenId: other.id, gold: 25 });
    expect(citizen.gold).toBe(75);
    expect(other.gold).toBe(125);
    for (let i = 0; i < 3; i++)
      send(world, citizen, { type: 'message', text: `hello ${i}`, to: other.id });
    expect(dispatch(world, citizen.id, { type: 'message', text: 'too fast' }).code).toBe(
      'message-rate',
    );
    expect(dispatch(world, citizen.id, { type: 'message', text: 'x'.repeat(501) }).code).toBe(
      'invalid-message',
    );
    tickWorld(world, BALANCE.messageWindow);
    send(world, citizen, { type: 'message', text: 'again' });
    for (let i = 0; i < 21; i++) send(world, citizen, { type: 'remember', text: `note ${i}` });
    expect(citizen.memories).toHaveLength(20);
    expect(citizen.memories[0].text).toBe('note 1');
    send(world, citizen, { type: 'goals', goals: ['Build a home'] });
    expect(citizen.goals).toEqual(['Build a home']);
    expect(citizen.action?.id).toBe(actionId);
    expect(Object.values(world.citizens).reduce((sum, c) => sum + c.gold, 0)).toBe(
      world.initialGold,
    );
  });

  it('round-trips unfinished work and reservations without duplicating output', () => {
    const { world, citizen } = fixture();
    citizen.inventory = { 'wood:1': 3, 'fibre:1': 3 };
    send(world, citizen, { type: 'craft', item: 'knife', tier: 1 });
    tickWorld(world, 3);
    const restored: World = JSON.parse(JSON.stringify(world));
    tickWorld(world, 10);
    tickWorld(restored, 10);
    expect(restored).toEqual(world);
    expect(restored.citizens[citizen.id].inventory['knife:1']).toBe(1);
  });

  it('rejects malformed commands and invalid life targets without starting work', () => {
    const { world, citizen } = fixture();
    expect(dispatch(world, citizen.id, null as unknown as Command).code).toBe('invalid-command');
    expect(dispatch(world, citizen.id, { type: 'attack', targetId: citizen.id }).code).toBe(
      'invalid-target',
    );
    expect(dispatch(world, citizen.id, { type: 'attack', targetId: 'none' }).code).toBe(
      'unknown-target',
    );
    expect(dispatch(world, citizen.id, { type: 'loot', lootId: 'none' }).code).toBe('missing-loot');
    expect(dispatch(world, citizen.id, { type: 'reproduce', partnerId: citizen.id }).code).toBe(
      'invalid-partner',
    );
    expect(
      dispatch(world, citizen.id, { type: 'consent', partnerId: 'none', accept: true }).code,
    ).toBe('missing-partner');
    expect(citizen.action).toBeNull();
    expect(dispatch(world, citizen.id, { type: 'move', x: -0.5, y: 0 }).code).toBe(
      'invalid-destination',
    );
    expect(() => tickWorld(world, -0.5)).toThrow('Tick count');
    expect(() => createWorld({ scenario: 'missing' })).toThrow('Unknown scenario');
  });
});
