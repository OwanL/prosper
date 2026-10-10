import { describe, expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { updateKnowledge } from '../src/world/observation.ts';
import { BALANCE, harvestDuration } from '../src/world/config.ts';
import { highestToolTier } from '../src/shared/tool-utils.ts';
import type { Command, Deposit, World } from '../src/shared/types.ts';

// Tools are permanent carried inventory: completed work/strikes never wear them
// out and never consume service materials. These invariants exercise real engine
// cycles (committed dispatches/ticks), not internal counters.

function arena() {
  const world = createWorld({ seed: 11, scenario: 'progression', population: 2 });
  const citizens = Object.values(world.citizens);
  citizens.forEach((c, i) => { c.x = 5 + i; c.y = 5; c.inventory = {}; });
  updateKnowledge(world);
  const send = (index: number, command: Command) => {
    const result = dispatch(world, citizens[index].id, command);
    expect(result, result.message ?? JSON.stringify(result)).toMatchObject({ ok: true });
    return result;
  };
  const tickUntilIdle = (index: number) => {
    const citizen = citizens[index];
    let ticks = 0;
    while (citizen.action && ticks++ < 4000) tickWorld(world);
    expect(citizen.action).toBeNull();
    updateKnowledge(world);
  };
  return { world, citizens, send, tickUntilIdle };
}

function woodDeposit(id: string, tier: number, x: number, y: number): Deposit {
  return { id, resource: 'wood', tier, x, y, stock: 1, capacity: 1, regrowAt: 0 };
}

describe('permanent carried tools through real engine cycles', () => {
  it('completes more than 64 harvest cycles without consuming T1 wood/fibre or wearing the top tool', () => {
    const { world, citizens, send, tickUntilIdle } = arena();
    const actor = citizens[0];
    const deposits: World['deposits'] = {};
    for (let i = 0; i < 66; i++) deposits[`wood-${i}`] = woodDeposit(`wood-${i}`, 1, 5, 5);
    deposits['wood-deep'] = woodDeposit('wood-deep', 3, 5, 5);
    world.deposits = deposits;
    updateKnowledge(world);
    actor.inventory = { 'axe:2': 1, 'wood:1': 1, 'fibre:1': 1, 'food:2': 30 };
    for (let i = 0; i < 66; i++) {
      send(0, { type: 'harvest', depositId: `wood-${i}` });
      // Duration 12 proves the automatic tier is the held T2 axe, not lower.
      expect(actor.action?.duration).toBe(harvestDuration(1, 2));
      tickUntilIdle(0);
    }
    expect(actor.inventory['wood:1']).toBe(67);
    expect(actor.inventory['fibre:1']).toBe(1);
    expect(actor.inventory['axe:2']).toBe(1);
    expect(highestToolTier(actor, 'axe')).toBe(2);
    send(0, { type: 'harvest', depositId: 'wood-deep' });
    expect(actor.action?.duration).toBe(harvestDuration(3, 2));
    tickUntilIdle(0);
    expect(actor.inventory['wood:3']).toBe(1);
    expect(world.events.every((e) => (e.kind as string) !== 'maintenance')).toBe(true);
    expect('maintenance' in actor).toBe(false);
  });

  it('lands more than 32 real sword strikes without consuming T1 wood/fibre or wearing the sword', () => {
    const { world, citizens, send, tickUntilIdle } = arena();
    const [actor, peer] = citizens;
    peer.x = 6; peer.y = 5;
    actor.inventory = { 'sword:2': 1, 'wood:1': 1, 'fibre:1': 1, 'food:2': 10 };
    peer.inventory = { 'food:2': 40, 'fibre:1': 1 };
    peer.health = 100;
    updateKnowledge(world);
    // One attack action repeats timed strikes every attackTicks until the target
    // dies or is cancelled; top up health between strikes inside the action.
    send(0, { type: 'attack', targetId: peer.id });
    expect(actor.action?.duration).toBe(BALANCE.attackTicks);
    const seen = new Set(world.events.map((e) => e.id));
    let strikes = 0;
    let ticks = 0;
    while (strikes < 33 && ticks++ < 4000) {
      tickWorld(world);
      peer.health = 100;
      for (const e of world.events)
        if (!seen.has(e.id)) {
          seen.add(e.id);
          if ((e.kind as string) === 'attack') strikes++;
        }
    }
    expect(strikes).toBeGreaterThanOrEqual(33);
    send(0, { type: 'cancel' });
    expect(peer.alive).toBe(true);
    expect(actor.inventory['sword:2']).toBe(1);
    expect(actor.inventory['wood:1']).toBe(1);
    expect(actor.inventory['fibre:1']).toBe(1);
    expect(world.events.every((e) => (e.kind as string) !== 'maintenance')).toBe(true);
    expect('maintenance' in actor).toBe(false);
    expect('maintenance' in peer).toBe(false);
  });

  it('excludes escrowed sell tools from automatic tier selection and restores them unworn on cancel', () => {
    const { world, citizens, send, tickUntilIdle } = arena();
    const actor = citizens[0];
    world.deposits = { mid: woodDeposit('mid', 2, 5, 5), deep: woodDeposit('deep', 3, 5, 5) };
    updateKnowledge(world);
    actor.inventory = { 'axe:1': 1, 'axe:2': 1, 'food:2': 40 };
    const order = send(0, { type: 'order', side: 'sell', item: 'axe:2', quantity: 1, price: 2 });
    expect(Object.values(world.orders).at(-1)?.escrowItems).toEqual({ 'axe:2': 1 });
    expect(actor.inventory['axe:2'] ?? 0).toBe(0);
    // Only the unescrowed T1 axe remains: it covers T2 deposits but not T3.
    const shallow = send(0, { type: 'harvest', depositId: 'mid' });
    expect(actor.action?.duration).toBe(harvestDuration(2, 1));
    tickUntilIdle(0);
    expect(dispatch(world, actor.id, { type: 'harvest', depositId: 'deep' }).code).toBe('tool-required');
    send(0, { type: 'cancel-order', orderId: order.order!.id });
    expect(actor.inventory).toMatchObject({ 'axe:1': 1, 'axe:2': 1 });
    // A cancelled escrow returns the tool exactly as listed: nothing wore out.
    send(0, { type: 'harvest', depositId: 'deep' });
    expect(actor.action?.duration).toBe(harvestDuration(3, 2));
    tickUntilIdle(0);
    expect(actor.inventory['wood:3']).toBe(1);
    expect(actor.inventory['axe:2']).toBe(1);
    expect(world.events.some((e) => (e.kind as string) === 'maintenance')).toBe(false);
  });

  it('keeps transferred tools intact at full tier across a gift and a market purchase', () => {
    const { world, citizens, send, tickUntilIdle } = arena();
    const [actor, peer] = citizens;
    world.deposits = { deep: woodDeposit('deep', 3, 6, 5) };
    updateKnowledge(world);
    // Gift: the receiver can immediately use the transferred tool at its tier.
    actor.inventory = { 'axe:2': 1, 'food:2': 40 };
    send(0, { type: 'give', citizenId: peer.id, item: 'axe:2', quantity: 1 });
    expect(actor.inventory['axe:2'] ?? 0).toBe(0);
    send(1, { type: 'harvest', depositId: 'deep' });
    expect(citizens[1].action?.duration).toBe(harvestDuration(3, 2));
    tickUntilIdle(1);
    const gifted = citizens[1].inventory;
    expect(gifted).toEqual({ 'axe:2': 1, 'wood:3': 1 });
    // Purchase: tools bought from a resting sell order are not worn either.
    actor.inventory = { 'food:2': 40 };
    actor.gold = 5;
    send(1, { type: 'order', side: 'sell', item: 'axe:2', quantity: 1, price: 2 });
    const bought = send(0, { type: 'order', side: 'buy', item: 'axe:2', quantity: 1, price: 2 });
    expect(bought.order?.filledQuantity).toBe(1);
    expect(actor.inventory['axe:2']).toBe(1);
    expect(peer.inventory['axe:2'] ?? 0).toBe(0);
    expect(peer.inventory['wood:3']).toBe(1);
    world.deposits.deep.stock = 1;
    world.deposits.deep.regrowAt = 0;
    actor.x = world.deposits.deep.x;
    actor.y = world.deposits.deep.y;
    updateKnowledge(world);
    send(0, { type: 'harvest', depositId: 'deep' });
    expect(actor.action?.duration).toBe(harvestDuration(3, 2));
    tickUntilIdle(0);
    expect(actor.inventory['axe:2']).toBe(1);
    expect(actor.inventory['wood:3']).toBe(1);
    expect(world.events.some((e) => (e.kind as string) === 'maintenance')).toBe(false);
  });

  it('carries killer-received tools and loot at full tier after a settled death', () => {
    const { world, citizens, send, tickUntilIdle } = arena();
    const [actor, peer] = citizens;
    peer.x = 6; peer.y = 5;
    world.deposits = { deepFood: { id: 'deepFood', resource: 'food', tier: 3, x: 5, y: 5, stock: 1, capacity: 1, regrowAt: 0 } };
    updateKnowledge(world);
    actor.inventory = { 'sword:1': 1, 'food:2': 40 };
    peer.inventory = { 'knife:2': 1, 'food:2': 40 };
    let guard = 0;
    send(0, { type: 'attack', targetId: peer.id });
    while (peer.alive && guard++ < 4000) tickWorld(world);
    expect(guard).toBeLessThan(4000);
    expect(peer.alive).toBe(false);
    expect(Object.values(world.loot)).toHaveLength(0);
    expect(actor.inventory['knife:2']).toBe(1);
    send(0, { type: 'harvest', depositId: 'deepFood' });
    expect(actor.action?.duration).toBe(harvestDuration(3, 2));
    tickUntilIdle(0);
    expect(actor.inventory['food:3']).toBe(1);
    expect(world.events.some((e) => (e.kind as string) === 'maintenance')).toBe(false);
  });
});