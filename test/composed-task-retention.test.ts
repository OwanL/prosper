import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCheckpoint, saveCheckpoint, type Checkpoint } from '../src/server/checkpoint.ts';
import { MIND_LIMITS, type TreeTaskState } from '../src/shared/tree-types.ts';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { updateKnowledge } from '../src/world/observation.ts';
import type { Citizen, Tier, World } from '../src/shared/types.ts';

/** Task-retention bound regression (checkpoint citizen-889 restore failure):
 * task creation must cap BEFORE MIND_LIMITS.tasks is exceeded — child-chain
 * pushes used to overflow a retained full list past 16 tasks, which the
 * checkpoint schema (.max(MIND_LIMITS.tasks)) rightly rejects and a death
 * before the next boundary froze in place. Retention reserves the active
 * ancestry (running tasks and their terminal parents cascade child-first) and
 * prunes childless terminal goals to the remaining capacity. */

function fixture(seed: number): { world: World; citizens: Citizen[] } {
  const world = createWorld({ seed, population: 2, controllerMode: 'composed', autonomy: false });
  world.deposits = {}; world.buildings = {};
  const [a, peer] = Object.values(world.citizens);
  for (const c of [a, peer]) { c.x = 4; c.y = 4; c.fullness = 100; c.health = 100; }
  updateKnowledge(world);
  return { world, citizens: [a, peer] };
}
const filler = (owner: Citizen, i: number): TreeTaskState => ({
  id: `${owner.id}:0:Sleep:wood:1:filler${i}`, definitionId: 'Sleep',
  request: { id: `${owner.id}:0:Sleep:wood:1:filler${i}`, resource: 'wood', tier: 1 as Tier, quantity: 1, allowMarket: true, purpose: 'Retained terminal evidence', urgency: 'routine' },
  ancestry: [], phase: 'done', status: 'succeeded', startedTick: 0, lastProgressTick: 0,
  delivered: 0, receiptIds: [], ownedOrderIds: [],
});
const seedTask = (owner: Citizen, partial: Partial<TreeTaskState> & { id: string; definitionId: string }): TreeTaskState => ({
  ...partial,
  request: { id: partial.request?.id ?? partial.id, resource: partial.request?.resource ?? 'wood', tier: partial.request?.tier ?? (1 as Tier),
    quantity: partial.request?.quantity ?? 1, allowMarket: partial.request?.allowMarket ?? true,
    purpose: partial.request?.purpose ?? 'Retained regression task', urgency: partial.request?.urgency ?? 'routine' },
  ancestry: [], phase: 'start', status: 'running', startedTick: 0, lastProgressTick: 0,
  delivered: 0, receiptIds: [], ownedOrderIds: [],
});
/** Retention invariants checked after real ticks: the shared bound, active-
 * ancestry reachability of every running task (no orphaned running branches),
 * and receipt allocation accounting that must survive save/reload. */
function expectRetention(world: World, label: string): void {
  for (const citizen of Object.values(world.citizens)) {
    const mind = citizen.mind!;
    expect(mind.tasks.length, `${label} ${citizen.id} task bound`).toBeLessThanOrEqual(MIND_LIMITS.tasks);
    const byId = new Map(mind.tasks.map(task => [task.id, task]));
    const reachable = new Set<string>();
    let cursor = mind.activeTaskId ? byId.get(mind.activeTaskId) : undefined;
    for (let guard = 0; cursor && guard <= mind.tasks.length; guard++) {
      reachable.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    for (const task of mind.tasks)
      if (task.status === 'running')
        expect(reachable.has(task.id), `${label} ${citizen.id} orphaned running branch ${task.id}`).toBe(true);
    const ledger = new Map(mind.receipts.map(receipt => [receipt.id, receipt]));
    expect(mind.receipts.length, `${label} ${citizen.id} receipt bound`).toBeLessThanOrEqual(MIND_LIMITS.receipts);
    const allocated = new Set<string>();
    for (const task of mind.tasks) {
      expect(task.receiptIds.reduce((sum, id) => sum + (ledger.get(id)?.quantity ?? 0), 0),
        `${label} ${task.id} delivered accounting`).toBe(task.delivered);
      for (const id of task.receiptIds) {
        expect(ledger.has(id), `${label} ${task.id} allocated receipt ${id} resolves`).toBe(true);
        expect(allocated.has(id), `${label} receipt ${id} allocated twice`).toBe(false);
        allocated.add(id);
      }
    }
  }
}
const checkpoint = (world: World): Checkpoint => ({
  version: 1, savedAt: new Date().toISOString(), world,
  runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] },
});

describe('composed task retention bound', () => {
  it('caps a prerequisite-chain child before the retained bound is exceeded', () => {
    const { world, citizens: [a, peer] } = fixture(7);
    peer.inventory['food:1'] = 10;
    updateKnowledge(world);
    expect(dispatch(world, peer.id, { type: 'order', side: 'sell', item: 'food:1', quantity: 10, price: 2 }).ok).toBe(true);
    const mind = a.mind!;
    a.inventory = { 'fibre:1': 3 }; a.gold = 100;
    const active = seedTask(a, { id: `${a.id}:0:ObtainTool:wood:1`, definitionId: 'ObtainTool', targetId: 'axe:1' });
    mind.tasks = [active, ...Array.from({ length: MIND_LIMITS.tasks - 1 }, (_, i) => filler(a, i))];
    mind.activeTaskId = active.id;
    expect(mind.tasks.length).toBe(MIND_LIMITS.tasks);
    // Isolate prerequisite admission from the tick-1 background market pass.
    world.tick = 1;
    tickWorld(world, 1);
    expectRetention(world, 'prerequisite cap');
    expect(mind.tasks.length).toBe(MIND_LIMITS.tasks);
    // Admission evicted a childless terminal goal instead of exceeding the bound.
    expect(mind.tasks.some(task => task.id.endsWith('filler0'))).toBe(false);
    const child = mind.tasks.find(task => task.parentId === active.id);
    expect(child?.definitionId).toBe('ObtainResource');
    expect(child?.request.quantity).toBe(3);
    expect(mind.activeTaskId).toBe(child!.id);
  });

  it('caps a sale-production child before the retained bound is exceeded', () => {
    const { world, citizens: [a, peer] } = fixture(9);
    peer.inventory['wood:1'] = 10;
    updateKnowledge(world);
    expect(dispatch(world, peer.id, { type: 'order', side: 'sell', item: 'wood:1', quantity: 10, price: 2 }).ok).toBe(true);
    const mind = a.mind!;
    a.inventory = { 'wood:1': 2 }; a.gold = 100;
    const active = seedTask(a, { id: `${a.id}:0:SellItem:wood:1`, definitionId: 'SellItem', targetId: 'wood:1' });
    active.request.quantity = 10; // shortfall keeps the production delegate feasible
    mind.tasks = [active, ...Array.from({ length: MIND_LIMITS.tasks - 1 }, (_, i) => filler(a, i))];
    mind.activeTaskId = active.id;
    tickWorld(world, 1);
    expectRetention(world, 'sale cap');
    expect(mind.tasks.length).toBe(MIND_LIMITS.tasks);
    expect(mind.tasks.some(task => task.id.endsWith('filler0'))).toBe(false);
    const child = mind.tasks.find(task => task.parentId === active.id);
    expect(child?.definitionId).toBe('ObtainResource');
    expect(mind.activeTaskId).toBe(child!.id);
  });

  it('reserves the active ancestry and defers creation when no terminal could be evicted', () => {
    const { world, citizens: [a, peer] } = fixture(11);
    peer.inventory['food:1'] = 10;
    updateKnowledge(world);
    expect(dispatch(world, peer.id, { type: 'order', side: 'sell', item: 'food:1', quantity: 10, price: 2 }).ok).toBe(true);
    const mind = a.mind!;
    a.inventory = {}; a.gold = 100;
    // Full retained list of running ancestry: root…leaf with the leaf active, so
    // admission pressure must find nothing prunable and must not overflow.
    const definitionIds = ['ObtainFoodNow', 'ObtainResource', ...Array.from({ length: MIND_LIMITS.tasks - 3 }, () => 'Sleep'), 'ObtainTool'];
    const chain = definitionIds.map((definitionId, i) =>
      seedTask(a, {
        id: `${a.id}:0:${definitionId}:wood:1:${i}`, definitionId,
        ...(definitionId === 'ObtainFoodNow' ? { request: { id: `${a.id}:0:ObtainFoodNow:wood:1:0`, resource: 'food', tier: 1 as Tier, quantity: 1, allowMarket: true, purpose: 'Retained regression task', urgency: 'routine' } } : {}),
        ...(definitionId === 'ObtainTool' ? { targetId: 'axe:1' } : {}),
      }));
    for (let i = 1; i < chain.length; i++) chain[i]!.parentId = chain[i - 1]!.id;
    const leaf = chain.at(-1)!;
    mind.tasks = chain;
    mind.activeTaskId = leaf.id;
    tickWorld(world, 1);
    expectRetention(world, 'ancestry reserve');
    expect(mind.tasks.length).toBe(MIND_LIMITS.tasks);
    expect(mind.tasks.some(task => task.parentId === leaf.id)).toBe(false);
    expect(leaf.wakeTick).toBeDefined();
    expect(leaf.reason).toContain('retained task list at capacity');
    expect(mind.trace.some(entry => entry.invocationId === leaf.id && entry.transition === 'wait')).toBe(true);
  });

  it('retains the bound through repeated starvation interrupts, child chains and per-tick checkpoints to death', { timeout: 240_000 }, () => {
    const { world, citizens: [a, peer] } = fixture(21);
    const directory = mkdtempSync(join(tmpdir(), 'prosper-task-retention-'));
    const path = join(directory, 'checkpoint.json');
    try {
      peer.inventory = { 'food:1': 400, 'fibre:1': 50 };
      a.inventory = { 'fibre:1': 3 }; a.fullness = 40; a.health = 60;
      peer.gold += a.gold - 2; a.gold = 2; // conserve fixture gold while limiting immediate-buy funding
      updateKnowledge(world);
      const hungerKeys = new Set<string>();
      let hungerInterrupts = 0;
      const countHungerInterrupts = (): void => {
        for (const entry of a.mind!.trace)
          if (entry.transition === 'interrupt' && /hunger|starvation/.test(entry.reason)) {
            const key = `${entry.tick}:${entry.reason}`; // rolling trace: count each row once
            if (!hungerKeys.has(key)) { hungerKeys.add(key); hungerInterrupts++; }
          }
      };
      const maintainSupply = (): void => {
        const foodAsk = Object.values(world.orders).some(order => order.citizenId === peer.id && order.side === 'sell' &&
          order.item === 'food:1' && order.quantity > 0);
        if (!foodAsk && (peer.inventory['food:1'] ?? 0) > 0)
          dispatch(world, peer.id, { type: 'order', side: 'sell', item: 'food:1', quantity: 1, price: 2 });
      };
      let ticks = 0;
      /** Five explicit real starvation stimuli: each episode starts with exactly
       * enough gold for the price-2 immediate food ask, but less than the
       * background half-cash cap can spend. The intended starvation override,
       * not opportunistic background feeding, owns each recovery meal. */
      const clamp = (): void => {
        if (world.tick % 200 === 0 && world.tick > 0 && a.fullness > 0) {
          peer.gold += a.gold - 2; a.gold = 2; // conserved per-episode funding, below background half-cash cap
          a.fullness = 0;
        }
      };
      while (a.alive && ticks < 1500 && hungerInterrupts < 5) {
        clamp(); maintainSupply();
        tickWorld(world, 1); ticks++;
        countHungerInterrupts();
        expectRetention(world, `soak tick ${world.tick}`);
        saveCheckpoint(path, checkpoint(world));
      }
      expect(ticks, `soak produced repeated hunger episodes (${hungerInterrupts})`).toBeLessThan(1500);
      expect(hungerInterrupts, 'five controlled real starvation interruptions').toBe(5);
      // Actual starvation to death: supply withdrawn (peer stock removed, orders
      // cancelled), no remedy route remains; the interrupted/cascading mind is
      // checkpointed on every tick to death.
      for (const order of Object.values(world.orders)) if (order.citizenId === peer.id)
        dispatch(world, peer.id, { type: 'cancel-order', orderId: order.id });
      delete peer.inventory['food:1'];
      for (const item of Object.keys(a.inventory)) if (/^food:/.test(item)) delete a.inventory[item];
      a.fullness = 0;
      updateKnowledge(world);
      while (a.alive && ticks < 2300) {
        tickWorld(world, 1); ticks++;
        expectRetention(world, `death tick ${world.tick}`);
        saveCheckpoint(path, checkpoint(world));
      }
      expect(a.alive, `died by tick ${ticks}`).toBe(false);
      expectRetention(world, 'post-death');
      saveCheckpoint(path, checkpoint(world));
      const restored = loadCheckpoint(path)!.world;
      expect(restored.citizens).toEqual(world.citizens);
      // The dead citizen's retained tasks must save without loss and stay bounded.
      expect(Object.values(restored.citizens).every(c => c.mind!.tasks.length <= MIND_LIMITS.tasks)).toBe(true);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});