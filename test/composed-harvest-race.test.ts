import { describe, expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld, type WorldControlOptions } from '../src/world/core.ts';
import { BALANCE, COMPOSED_BALANCE } from '../src/world/config.ts';

function fixture() {
  const world = createWorld({ seed: 7, population: 3, autonomy: false });
  world.controllerMode = 'composed';
  world.buildings = {};
  const [early, fast, owner] = Object.values(world.citizens);
  for (const citizen of [early, fast, owner]) {
    citizen.x = 4; citizen.y = 4; citizen.inventory = {}; citizen.fullness = 100;
  }
  world.deposits = {
    wood: { id: 'wood', x: 4, y: 4, resource: 'wood', tier: 1, stock: 1, capacity: 1, regrowAt: 0 },
    alternate: { id: 'alternate', x: 4, y: 5, resource: 'wood', tier: 1, stock: 1, capacity: 1, regrowAt: 0 },
  };
  const options: WorldControlOptions = { authority: { citizens: Object.fromEntries(
    [early, fast, owner].map(c => [c.id, 'direct' as const])) } };
  const start = (id: string, depositId = 'wood') => expect(dispatch(world, id, { type: 'harvest', depositId }, 'external', options).ok).toBe(true);
  const ticks = (n: number) => tickWorld(world, n, options);
  return { world, early, fast, owner, start, ticks };
}

describe('first completion wins harvest races', () => {
  it.each([false, true])('lets a faster tool overtake earlier work/travel (travel=%s)', travel => {
    const { world, early, fast, start, ticks } = fixture();
    if (travel) early.x = 3;
    start(early.id); ticks(5);
    fast.inventory['axe:1'] = 1;
    start(fast.id); ticks(20);
    expect(fast.inventory['wood:1']).toBe(1);
    ticks(30);
    expect(early.inventory['wood:1']).toBeUndefined();
    expect(early.action).toBeNull();
    expect(early.lastResult).toContain('no yield delivered');
    expect(early.mind?.receipts ?? []).toHaveLength(0);
    expect(world.deposits.wood.stock).toBe(0);
    start(early.id, 'alternate'); ticks(40 + BALANCE.moveTicks);
    expect(early.inventory['wood:1']).toBe(1);
  });

  it('breaks equal completion ties by citizen insertion order, not dispatch order', () => {
    const { world, early, fast, start, ticks } = fixture();
    start(fast.id); start(early.id); ticks(40);
    expect(early.inventory['wood:1']).toBe(1);
    expect(fast.inventory['wood:1']).toBeUndefined();
    expect(fast.action).toBeNull();
    expect(fast.lastResult).toContain('no yield delivered');
    expect(world.deposits.wood.stock).toBe(0);
  });

  it('taxes only the winner and records conserved net deliveries', () => {
    const { world, early, fast, owner, start, ticks } = fixture();
    world.territories = { t: { id: 't', ownerId: owner.id, createdTick: 0,
      members: { [owner.id]: { citizenId: owner.id, joinedTick: 0, sequence: 0 } }, admissions: [] } };
    world.signs = { sign: { id: 'sign', territoryId: 't', x: 4, y: 4,
      woodTier: 1, health: 100, maxHealth: 100 } };
    start(early.id); fast.inventory['axe:1'] = 1; start(fast.id); ticks(40);
    expect(fast.inventory['wood:1']).toBe(1 - COMPOSED_BALANCE.territoryTaxRate);
    expect(owner.inventory['wood:1']).toBe(COMPOSED_BALANCE.territoryTaxRate);
    expect(early.inventory['wood:1']).toBeUndefined();
    expect(early.mind?.receipts ?? []).toHaveLength(0);
    const receipts = [fast, owner].flatMap(c => c.mind?.receipts ?? []);
    expect(receipts).toHaveLength(2);
    expect(receipts.reduce((sum, receipt) => sum + receipt.quantity, 0)).toBe(1);
    expect(new Set(receipts.map(receipt => receipt.settlementId)).size).toBe(1);
  });

  it('settles real regrowth before a later completion, without promising stock', () => {
    const { world, early, fast, start, ticks } = fixture();
    start(early.id); fast.inventory['axe:1'] = 1; start(fast.id); ticks(20);
    world.deposits.wood.regrowAt = world.tick + 10;
    ticks(20);
    expect(early.inventory['wood:1']).toBe(1);
    expect(fast.inventory['wood:1']).toBe(1);
    expect(world.deposits.wood.stock).toBe(0);
  });
});
