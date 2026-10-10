import { describe, expect, it, vi } from 'vitest';
import type { Citizen, Command, World } from '../src/shared/types.ts';
import { createWorld, dispatch, tickWorld, type WorldControlOptions } from '../src/world/core.ts';
import { advanceAutonomy, reactAutonomy, setAutonomyPolicy } from '../src/world/autonomy.ts';
import { advanceDirectives, commitStrategy } from '../src/world/directives.ts';
import { advancePlan, approvePlan } from '../src/world/plans.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import { BALANCE, equipmentRecipe, nutrition } from '../src/world/config.ts';

function fixture(autonomy = false, population = 3) {
  const world = createWorld({ seed: 7, population, autonomy });
  const [actor, peer, other] = Object.values(world.citizens);
  for (const [index, citizen] of Object.values(world.citizens).entries()) {
    citizen.x = 2 + index;
    citizen.y = 2;
    citizen.inventory = {};
    citizen.fullness = 100;
  }
  world.deposits = {
    food: { id: 'food', resource: 'food', tier: 1, x: 2, y: 3, stock: 1, capacity: 1, regrowAt: 0 },
    wood: { id: 'wood', resource: 'wood', tier: 1, x: 2, y: 2, stock: 1, capacity: 1, regrowAt: 0 },
  };
  const options: WorldControlOptions = { authority: {
    citizens: Object.fromEntries(Object.values(world.citizens).map((citizen) =>
      [citizen.id, citizen === actor ? 'direct' : 'passive-body'])),
  } };
  updateKnowledge(world);
  const send = (citizen: Citizen, command: Command) => {
    const result = dispatch(world, citizen.id, command, 'external', options);
    expect(result, result.message).toMatchObject({ ok: true });
    updateKnowledge(world);
    return result;
  };
  const tick = (count = 1) => {
    for (let i = 0; i < count; i++) {
      tickWorld(world, 1, options);
      updateKnowledge(world);
    }
  };
  return { world, actor, peer, other, options, send, tick };
}

const actionsFor = (world: World, citizen: Citizen) => ({
  command: (command: Command) => dispatch(world, citizen.id, command, 'directive'),
  cancel: vi.fn(),
});

describe('runner-owned evaluation authority', () => {
  it.each([false, true])('preserves the normal tick path with absent options and explicit Local AI (autonomy=%s)', (autonomy) => {
    const a = fixture(autonomy).world;
    const b = structuredClone(a);
    const c = structuredClone(a);
    Object.values(a.citizens)[0].fullness = 0;
    Object.values(b.citizens)[0].fullness = 0;
    Object.values(c.citizens)[0].fullness = 0;
    const local: WorldControlOptions = { authority: { citizens:
      Object.fromEntries(Object.keys(c.citizens).map((id) => [id, 'local-ai'])) } };
    for (let i = 0; i < 50; i++) {
      tickWorld(a);
      tickWorld(b, 1, {});
      tickWorld(c, 1, local);
      for (const world of [a, b, c]) updateKnowledge(world);
    }
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(a.events.some((event) => ['emergency', 'completion'].includes(event.kind))).toBe(true);
  });

  it.each([false, true])('suppresses hunger strategists for direct and passive bodies (autonomy=%s)', (autonomy) => {
    const { world, options, tick } = fixture(autonomy);
    for (const citizen of Object.values(world.citizens)) citizen.fullness = 0;
    const policies = Object.values(world.citizens).map((c) => structuredClone(c.autonomy?.policy));
    tick(10);
    for (const [index, citizen] of Object.values(world.citizens).entries()) {
      expect(citizen.action).toBeNull();
      expect(citizen.queue).toEqual([]);
      expect(citizen.emergency).toBeUndefined();
      expect(citizen.health).toBeCloseTo(100 - 10 * BALANCE.starvationDamage);
      expect(citizen.autonomy?.policy).toEqual(policies[index]);
    }
    expect(world.orders).toEqual({});
    expect(world.messages).toEqual([]);
    expect(world.deposits.food.stock).toBe(1);
    expect(world).not.toHaveProperty('authority');
    expect(options.authority).toBeDefined();
  });

  it('rejects incomplete/invalid authority before any tick effects, including preexisting children', () => {
    const { world, options, peer } = fixture();
    peer.parents = [Object.keys(world.citizens)[0]];
    delete options.authority!.citizens[peer.id];
    const before = structuredClone(world);
    expect(() => tickWorld(world, 1, options)).toThrow(/authority/);
    expect(world).toEqual(before);
    options.authority!.citizens[peer.id] = 'passive-body';
    options.authority!.newbornAuthority = 'bad' as never;
    expect(() => tickWorld(world, 1, options)).toThrow(/newborn/);
    expect(world).toEqual(before);
  });

  it('buys through funded orders and consumes only the available carried food on the next tick', () => {
    const { world, actor, peer, tick, send } = fixture();
    actor.gold = 4;
    actor.fullness = 80;
    peer.inventory = { 'food:1': 1 };
    const sellerGold = peer.gold;
    send(peer, { type: 'order', side: 'sell', item: 'food:1', quantity: 1, price: 4 });
    const result = send(actor, { type: 'order', side: 'buy', item: 'food:1', quantity: 1, price: 4 });
    expect(result.order).toMatchObject({ filledQuantity: 1, goldPaid: 4 });
    expect(actor.fullness).toBe(80);
    expect(actor.inventory['food:1']).toBe(1);
    tick();
    expect(actor.inventory['food:1'] ?? 0).toBe(0);
    expect(actor.fullness).toBeCloseTo(79.9 + nutrition(1));
    expect(actor.gold).toBe(0);
    expect(peer.gold).toBe(sellerGold + 4);
    expect(world.events.filter((e) => e.kind === 'meal' && e.citizenId === actor.id)).toHaveLength(1);
  });

  it('preserves candidate craft, queued activation, cancellation refunds and regrowth at critical hunger', () => {
    const { world, actor, send, tick } = fixture(true);
    actor.fullness = 0;
    actor.inventory = equipmentRecipe('knife', 1);
    send(actor, { type: 'craft', item: 'knife', tier: 1 });
    send(actor, { type: 'harvest', depositId: 'wood', queue: 'append' });
    tick(BALANCE.craftTicks + BALANCE.harvestTicks);
    expect(actor.inventory['knife:1']).toBe(1);
    expect(actor.inventory['wood:1']).toBe(1);
    expect(actor.action).toBeNull();
    expect(actor.queue).toEqual([]);
    expect(actor.emergency).toBeUndefined();
    tick(BALANCE.regrowTicks);
    expect(world.deposits.wood.stock).toBe(1);
    actor.inventory = equipmentRecipe('axe', 1);
    const inventory = structuredClone(actor.inventory);
    send(actor, { type: 'craft', item: 'axe', tier: 1 });
    send(actor, { type: 'cancel' });
    expect(actor.inventory).toEqual(inventory);
    expect(actor.action).toBeNull();
  });

  it('keeps incoming combat physical without reactive defense/flee or cancellation of candidate work', () => {
    const { actor, peer, send, tick } = fixture(true);
    actor.inventory = equipmentRecipe('knife', 1);
    send(actor, { type: 'craft', item: 'knife', tier: 1 });
    send(peer, { type: 'attack', targetId: actor.id });
    tick(BALANCE.attackTicks);
    expect(actor.health).toBeLessThan(100);
    expect(actor.inventory['knife:1']).toBe(1);
    expect([actor.x, actor.y]).toEqual([2, 2]);
    expect(actor.action).toBeNull();
    expect(actor.autonomy?.combat).toBeUndefined();
  });

  it('does not advance an explicitly installed idle legacy plan, directive or emergency', () => {
    const { world, actor, peer, other, options, tick } = fixture();
    expect(approvePlan(world, actor.id, { mode: 'append', steps: [
      { type: 'command', command: { type: 'move', x: 6, y: 2 } },
    ] }, actionsFor(world, actor)).ok).toBe(true);
    expect(commitStrategy(world, peer.id, { mode: 'append', directives: [
      { type: 'move', x: 6, y: 2 },
    ] }, actionsFor(world, peer)).ok).toBe(true);
    other.emergency = { startedTick: 0, depositId: 'food', outsideAreas: false, stage: 'gather' };
    const plan = structuredClone(actor.plan);
    const strategy = structuredClone(peer.strategy);
    const emergency = structuredClone(other.emergency);
    tick(2);
    expect(actor.plan).toEqual(plan);
    expect(peer.strategy).toEqual(strategy);
    expect(other.emergency).toEqual(emergency);
    expect(Object.values(world.citizens).every((c) => !c.action)).toBe(true);
    const api = { command: vi.fn(), cancel: vi.fn() };
    advancePlan(world, actor, api, options);
    advanceDirectives(world, peer, api, options);
    expect(api.command).not.toHaveBeenCalled();
    expect(api.cancel).not.toHaveBeenCalled();
  });

  it('gates explicit policy/plan/directive commits and indirect strategic dispatcher sources without side effects', () => {
    const { world, actor, options } = fixture(true);
    const before = structuredClone(world);
    const api = { command: vi.fn(), cancel: vi.fn() };
    expect(setAutonomyPolicy(world, actor, { buyPrice: 9 }, options).code).toBe('evaluation-authority');
    expect(approvePlan(world, actor.id, { mode: 'replace', steps: [] }, api, options).code).toBe('evaluation-authority');
    expect(commitStrategy(world, actor.id, { mode: 'replace', directives: [] }, api, options).code).toBe('evaluation-authority');
    for (const source of ['plan', 'directive'] as const)
      expect(dispatch(world, actor.id, { type: 'move', x: 5, y: 2 }, source, options).code).toBe('evaluation-authority');
    reactAutonomy(world, actor, api, options);
    expect(advanceAutonomy(world, actor, api, options)).toBe(false);
    expect(api.command).not.toHaveBeenCalled();
    expect(api.cancel).not.toHaveBeenCalled();
    expect(world).toEqual(before);
  });

  it('settles starvation death, work reservations and funded order escrow without rescue', () => {
    const { world, actor, send, tick } = fixture();
    actor.fullness = 0;
    actor.health = BALANCE.starvationDamage;
    actor.inventory = equipmentRecipe('knife', 1);
    const inputs = structuredClone(actor.inventory);
    const gold = actor.gold;
    send(actor, { type: 'order', side: 'buy', item: 'wood:1', quantity: 1, price: 4 });
    send(actor, { type: 'craft', item: 'knife', tier: 1 });
    tick();
    expect(actor.alive).toBe(false);
    expect(actor.action).toBeNull();
    expect(Object.values(world.orders).some((o) => o.citizenId === actor.id)).toBe(false);
    const loot = Object.values(world.loot).find((body) => body.citizenName === actor.name)!;
    expect(loot.gold).toBe(gold);
    expect(loot.inventory).toEqual(inputs);
  });

  it('registers real newborns as passive bodies and replays a serialized continuation with one knowledge refresh per tick', () => {
    const { world, actor, peer, options, send, tick } = fixture(true, 2);
    for (const parent of [actor, peer]) parent.inventory = { 'food:2': BALANCE.reproductionFood };
    send(actor, { type: 'consent', partnerId: peer.id, accept: true });
    send(peer, { type: 'consent', partnerId: actor.id, accept: true });
    send(actor, { type: 'reproduce', partnerId: peer.id });
    tick(BALANCE.reproductionTicks);
    const child = Object.values(world.citizens).find((c) => c.parents.length)!;
    expect(child).toBeDefined();
    expect(child.autonomy).toBeDefined();
    expect(options.authority!.citizens[child.id]).toBe('passive-body');
    child.fullness = 0;
    tick();
    expect(child.action).toBeNull();
    expect(child.emergency).toBeUndefined();
    expect(child.health).toBeCloseTo(BALANCE.newbornHealth - BALANCE.starvationDamage);
    send(actor, { type: 'move', x: 8, y: 2 });
    tick(3);
    const resumed = JSON.parse(JSON.stringify(world)) as World;
    const resumedOptions = structuredClone(options);
    for (let i = 0; i < 12; i++) {
      tick();
      tickWorld(resumed, 1, resumedOptions);
      updateKnowledge(resumed);
      expect(observe(resumed, actor.id)).toEqual(observe(world, actor.id));
      expect(resumed).toEqual(JSON.parse(JSON.stringify(world)));
      expect(resumedOptions).toEqual(options);
    }
    expect(Object.values(actor.knowledge).some((tile) => tile.seenTick < world.tick)).toBe(true);
    expect(actor.x).toBe(8);
  });
});
