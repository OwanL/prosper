import { expect, it } from 'vitest';
import { mindSchema } from '../src/server/autonomy-checkpoint.ts';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import { stepTreeTask } from '../src/citizen/tree-actions.ts';
import { loadCheckpoint, saveCheckpoint, type Checkpoint } from '../src/server/checkpoint.ts';
import type { TreeTaskState } from '../src/shared/tree-types.ts';
import type { World } from '../src/shared/types.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function restore(world: World): World {
  const dir = mkdtempSync(join(tmpdir(), 'prosper-task-accounting-'));
  try {
    const path = join(dir, 'checkpoint.json');
    const checkpoint: Checkpoint = { version: 1, savedAt: new Date().toISOString(), world,
      runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } };
    saveCheckpoint(path, checkpoint);
    return loadCheckpoint(path)!.world;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function task(definitionId: string, quantity = 1): TreeTaskState {
  return { id: 'accounting-task', definitionId, ancestry: [], phase: 'start', status: 'running', startedTick: 0,
    lastProgressTick: 0, delivered: 0, receiptIds: [], ownedOrderIds: [], request: { id: 'accounting-task', resource: 'food',
      tier: 1, quantity, allowMarket: true, purpose: 'accounting regression', urgency: 'survival' } };
}
function fixture(state: TreeTaskState) {
  const world = createWorld({ seed: 7, population: 2, controllerMode: 'composed' });
  const [a, b] = Object.values(world.citizens);
  a.x = b.x = 4; a.y = b.y = 4;
  a.mind!.tasks = [state]; a.mind!.activeTaskId = state.id;
  updateKnowledge(world);
  return { world, a, b };
}

it('seed 7 population 2 checkpoints every natural tick through 20', () => {
  const world = createWorld({ seed: 7, population: 2, controllerMode: 'composed' });
  for (let tick = 1; tick <= 20; tick++) {
    tickWorld(world);
    for (const citizen of Object.values(world.citizens)) expect(() => mindSchema.parse(citizen.mind), `tick ${tick} ${citizen.id}`).not.toThrow();
    expect(restore(world).tick).toBe(world.tick);
  }
});


it('recovers fractional food escrow across the cancel checkpoint, credits once and feeds a real meal', () => {
  const state = task('ObtainFoodNow', 1.2);
  const { world, a } = fixture(state);
  a.inventory = { 'food:1': 1.2 };
  expect(dispatch(world, a.id, { type: 'order', side: 'sell', item: 'food:1', quantity: 1.2, price: 10 }).ok).toBe(true);
  const proposal = stepTreeTask(observe(world, a.id), state);
  expect(proposal.command?.type).toBe('cancel-order');
  expect(state.phase).toBe('recover-cancel');
  expect(state.target).toBeUndefined();
  expect(state.accounting?.escrowQuantity).toBe(1.2);
  const restored = restore(world);
  const body = restored.citizens[a.id];
  const current = body.mind!.tasks[0];
  expect(current.accounting).toEqual({ escrowQuantity: 1.2 });
  expect(dispatch(restored, a.id, stepTreeTask(observe(restored, a.id), current).command!).ok).toBe(true);
  for (const receipt of body.mind!.receipts) if (receipt.item === 'food:1') receipt.requestId = current.request.id;
  expect(stepTreeTask(observe(restored, a.id), current).status).toBe('succeeded');
  expect(current.delivered).toBe(1.2);
  expect(new Set(current.receiptIds).size).toBe(current.receiptIds.length);
  stepTreeTask(observe(restored, a.id), current);
  expect(current.delivered).toBe(1.2);
  delete body.mind!.activeTaskId;
  body.fullness = 10;
  tickWorld(restored, 1, { authority: { citizens: Object.fromEntries(Object.keys(restored.citizens).map(id => [id, 'direct' as const])), newbornAuthority: 'passive-body' } });
  expect(body.fullness).toBeGreaterThan(10);
  expect(body.inventory['food:1']).toBeCloseTo(0.2);
  restore(restored);
});

it('fractional gold gift saves an exact custody baseline, conserves gold, and never transfers twice', () => {
  const state = task('GiveGift', 1); state.strategyId = 'gold';
  const { world, a, b } = fixture(state); state.targetId = b.id;
  a.gold = 10.75; b.gold = 3.25; world.initialGold = 14;
  const proposal = stepTreeTask(observe(world, a.id), state);
  expect(state.accounting?.goldBefore).toBe(10.75);
  expect(state.target).toBeUndefined();
  const restored = restore(world);
  const current = restored.citizens[a.id].mind!.tasks[0];
  expect(dispatch(restored, a.id, proposal.command!).ok).toBe(true);
  expect(stepTreeTask(observe(restored, a.id), current).status).toBe('succeeded');
  expect(current.status).toBe('succeeded');
  expect(restored.citizens[a.id].gold).toBe(9.75);
  expect(restored.citizens[b.id].gold).toBe(4.25);
  expect(restored.citizens[a.id].gold + restored.citizens[b.id].gold).toBe(14);
  delete restored.citizens[a.id].mind!.activeTaskId;
  restore(restored);
});

it.each([['SellItem', 1.25], ['ObtainTool', 2], ['CraftTool', 2]] as const)('loads legacy %s counters without losing units', (definitionId, units) => {
  const state = task(definitionId); state.target = { x: units, y: 0 }; state.targetId = 'axe:1';
  const { world, a } = fixture(state);
  const restored = restore(world);
  const current = restored.citizens[a.id].mind!.tasks[0];
  stepTreeTask(observe(restored, a.id), current);
  expect(current.accounting?.units).toBe(units);
  expect(current.target).toBeUndefined();
});

it('loads legacy integer gift baseline and escrow quantity only in recognized phases', () => {
  const state = task('GiveGift'); state.strategyId = 'gold'; state.phase = 'gift-gold'; state.target = { x: 11, y: 0 };
  const { world, a, b } = fixture(state); state.targetId = b.id; a.gold = 10; world.initialGold = a.gold + b.gold;
  const restored = restore(world); const current = restored.citizens[a.id].mind!.tasks[0];
  expect(stepTreeTask(observe(restored, a.id), current).status).toBe('succeeded');
  expect(current.accounting?.goldBefore).toBe(11);
  const escrow = task('ObtainFoodNow', 2); escrow.strategyId = 'recover-escrow'; escrow.phase = 'recover-cancel'; escrow.target = { x: 2, y: 0 };
  const second = fixture(escrow); second.a.inventory = { 'food:1': 2 };
  const order = dispatch(second.world, second.a.id, { type: 'order', side: 'sell', item: 'food:1', quantity: 2, price: 10 });
  escrow.targetId = order.order!.id;
  const saved = restore(second.world); const loaded = saved.citizens[second.a.id].mind!.tasks[0];
  stepTreeTask(observe(saved, second.a.id), loaded);
  expect(loaded.accounting?.escrowQuantity).toBe(2);
  expect(loaded.target).toBeUndefined();
});

it('bounds nonspatial fields without relaxing spatial coordinates', () => {
  const state = task('BuildHouse'); const { a } = fixture(state);
  for (const invalid of [-1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    state.accounting = { units: invalid };
    expect(mindSchema.safeParse(a.mind).success).toBe(false);
  }
  state.accounting = { goldBefore: 1.25, escrowQuantity: 1.2, units: 0.125 };
  state.target = { x: 1.2, y: 0 };
  expect(mindSchema.safeParse(a.mind).success).toBe(false);
  state.target = { x: 1, y: 0 };
  expect(mindSchema.safeParse(a.mind).success).toBe(true);
});


it('retains exact fractional sale accounting across twenty fills, reload and subsequent settlement', () => {
  const state = task('SellItem', 2.75); state.targetId = 'wood:1';
  const { world: initial, a, b } = fixture(state);
  a.inventory = { 'wood:1': 2.75 };
  const posted = dispatch(initial, a.id, stepTreeTask(observe(initial, a.id), state).command!);
  expect(posted.ok).toBe(true); state.ownedOrderIds.push(posted.order!.id);
  let world = initial;
  const fill = (quantity: number) => {
    expect(dispatch(world, b.id, { type: 'order', side: 'buy', item: 'wood:1', quantity, price: 100 }).ok).toBe(true);
    const current = world.citizens[a.id].mind!.tasks[0];
    stepTreeTask(observe(world, a.id), current);
    return current;
  };
  for (let i = 0; i < 20; i++) fill(0.125);
  expect(state.accounting?.units).toBe(2.5); expect(state.target).toBeUndefined();
  world = restore(world);
  const current = world.citizens[a.id].mind!.tasks[0];
  stepTreeTask(observe(world, a.id), current);
  expect(current.accounting?.units).toBe(2.5);
  expect(fill(0.25).accounting?.units).toBe(2.75);
  expect(stepTreeTask(observe(world, a.id), current).status).toBe('succeeded');
  expect(current.accounting?.units).toBe(2.75);
  expect(current.receiptIds).toEqual([]);
  expect(world.citizens[b.id].inventory['wood:1']).toBe(2.75);
  delete world.citizens[a.id].mind!.activeTaskId;
  expect(restore(world).citizens[a.id].mind!.tasks[0].accounting?.units).toBe(2.75);
});

it('keeps the historical sale exception narrow and the other legacy counter coordinates integral', () => {
  const state = task('SellItem'); const { a } = fixture(state);
  state.target = { x: 1.25, y: 0 };
  expect(mindSchema.safeParse(a.mind).success).toBe(true);
  state.target.y = 0.5;
  expect(mindSchema.safeParse(a.mind).success).toBe(false);
  state.target.y = 0; state.definitionId = 'ObtainFoodNow'; state.strategyId = 'recover-escrow'; state.phase = 'recover-cancel';
  expect(mindSchema.safeParse(a.mind).success).toBe(false);
  state.target.x = 2;
  expect(mindSchema.safeParse(a.mind).success).toBe(true);
});
