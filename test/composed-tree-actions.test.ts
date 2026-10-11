import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import { BALANCE } from '../src/world/config.ts';
import type { Citizen, CitizenObservation, Resource, Tier, World } from '../src/shared/types.ts';
import { MIND_LIMITS, type DeliveryReceipt, type ResourceRequest, type TreeTaskState } from '../src/shared/tree-types.ts';
import { loadCheckpoint, saveCheckpoint, validateCheckpoint, type Checkpoint } from '../src/server/checkpoint.ts';
import { ACTIONS, CONDITIONS, DELEGATES, identityViolation, stepTreeTask } from '../src/citizen/tree-actions.ts';

/** Observation-sequence harness (plan §5): only citizen-visible observations are
 * fed back; at most one proposed command is committed per idle boundary, with
 * an engine tick and knowledge update between cycle steps. */
function request(partial: Partial<ResourceRequest> & { resource: Resource; tier: Tier }): ResourceRequest {
  return { id: 'req-1', quantity: 1, allowMarket: true, purpose: 'test', urgency: 'routine',
    ...partial } as ResourceRequest;
}
function task(partial: Partial<TreeTaskState> & { definitionId: string; request: ResourceRequest }): TreeTaskState {
  return { id: 'task-1', ancestry: [], phase: '', status: 'running', startedTick: 0,
    lastProgressTick: 0, delivered: 0, receiptIds: [], ownedOrderIds: [], ...partial } as TreeTaskState;
}
function mindFor(citizen: Citizen): void {
  citizen.mind = { version: 1, dispositions: { ambition: 0.5, morals: 0.5, generosity: 0.5, riskTolerance: 0.5,
    patience: 0.5, sociability: 0.5, vengefulness: 0.5, familyOrientation: 0.5, enterprise: 0.5, economicIndependence: 0.5 },
    memories: [], memoriesOmitted: 0, tasks: [], receipts: [], trace: [], traceOmitted: 0, nextDirectorTick: 2400 };
}
function addReceipt(citizen: Citizen, receipt: Partial<DeliveryReceipt>): void {
  mindFor(citizen);
  citizen.mind!.receipts.push({ id: receipt.id ?? `r-${cash(citizen.mind!.receipts.length)}`, settlementId: 's-settle',
    tick: citizen.mind!.receipts.length, citizenId: citizen.id, item: receipt.item ?? 'wood:1',
    quantity: receipt.quantity ?? 1, source: receipt.source ?? 'harvest',
    ...(receipt.requestId !== undefined ? { requestId: receipt.requestId } : {}) });
}
const cash = (n: number) => `k${n}`;

function bodyTick(world: World): void {
  tickWorld(world, 1, { authority: { citizens: Object.fromEntries(Object.keys(world.citizens).map((id) => [id, 'direct' as const])), newbornAuthority: 'passive-body' } });
}
// Controlled engine fixtures register the task for request-allocated receipts.
function drive(world: World, id: string, state: TreeTaskState, maxSteps = 400, onStep?: (result: ReturnType<typeof stepTreeTask>) => void): void {
  for (let step = 0; step < maxSteps && state.status === 'running'; step++) {
    if (!world.citizens[id]!.mind) mindFor(world.citizens[id]!);
    const mind = world.citizens[id]!.mind!;
    mind.tasks = [state]; mind.activeTaskId = state.id;
    // Mirrors the composed controller: acquisition tasks claim unallocated
    // receipts whose item matches the request item (the exact tool for ObtainTool).
    const requested = state.definitionId === 'ObtainTool' ? state.targetId : `${state.request.resource}:${state.request.tier}`;
    for (const r of mind.receipts) if (!r.requestId && r.tick >= state.startedTick && r.item === requested) r.requestId = state.request.id;
    const result = stepTreeTask(observe(world, id), state);
    onStep?.(result);
    if (result.command) {
      const committed = dispatch(world, id, result.command);
      if (!committed.ok) throw new Error(`${state.definitionId}: ${committed.code}: ${committed.message}`);
      if (committed.order) state.ownedOrderIds.push(committed.order.id);
    }
    if (state.status === 'running') bodyTick(world);
    updateKnowledge(world);
  }
  if (state.status === 'running') throw new Error(`Task ${state.definitionId} did not settle in ${maxSteps} steps`);
}
/** Manual engine boundaries like the composed controller: a rejected acquisition
 * command stays recorded as personal error feedback instead of aborting the run. */
function driveWithRejections(world: World, id: string, state: TreeTaskState, maxSteps = 400): { harvestTargets: string[] } {
  const harvestTargets: string[] = [];
  for (let step = 0; step < maxSteps && state.status === 'running'; step++) {
    if (!world.citizens[id]!.mind) mindFor(world.citizens[id]!);
    const mind = world.citizens[id]!.mind!;
    mind.tasks = [state]; mind.activeTaskId = state.id;
    for (const r of mind.receipts) if (!r.requestId && r.tick >= state.startedTick &&
      r.item === `${state.request.resource}:${state.request.tier}`) r.requestId = state.request.id;
    const result = stepTreeTask(observe(world, id), state);
    if (result.command) {
      if (result.command.type === 'harvest') harvestTargets.push(result.command.depositId);
      const committed = dispatch(world, id, result.command);
      if (!committed.ok && result.command.type !== 'harvest')
        throw new Error(`${state.definitionId}: ${committed.code}: ${committed.message}`);
    }
    if (state.status === 'running') bodyTick(world);
    updateKnowledge(world);
  }
  if (state.status === 'running') throw new Error(`Task ${state.definitionId} did not settle in ${maxSteps} steps`);
  return { harvestTargets };
}
function twoCitizens(): { world: World; a: Citizen; b: Citizen } {
  const world = createWorld({ seed: 7, population: 2, autonomy: false });
  world.controllerMode = 'composed';
  const [a, b] = Object.values(world.citizens);
  return { world, a, b };
}
/** Fixture: place a next to b on open ground and refresh knowledge. */
function colocate(world: World, a: Citizen, b: Citizen): void {
  a.x = 4; a.y = 4; b.x = 5; b.y = 4;
  for (const c of [a, b]) { c.action = null; c.queue = []; c.fullness = 100; c.health = 100; }
  updateKnowledge(world);
}
function depositAt(world: World, id: string, x: number, y: number, resource: Resource, tier: Tier, stock = 1): void {
  world.deposits[id] = { id, x, y, resource, tier, stock, capacity: Math.max(1, stock), regrowAt: 0 };
}

describe('identity, cycles and delegation', () => {
  it('excludes active ancestors by definition identity, even with fresh ids and changed requests', () => {
    const { world, a } = twoCitizens();
    const state = task({ id: 'fresh-invocation', definitionId: 'Harvest', ancestry: ['ObtainResource', 'Harvest'],
      request: request({ id: 'other-request', resource: 'wood', tier: 1, quantity: 9 }) });
    const result = stepTreeTask(observe(world, a.id), state);
    expect(result.status).toBe('failed');
    expect(result.failure).toBe('excluded');
    expect(result.reason).toMatch(/active ancestor/);
    expect(result.command).toBeUndefined();
    expect(state.status).toBe('failed');
  });
  it('allows approved delegation edges and rejects unapproved helper chains', () => {
    const { world, a, b } = twoCitizens();
    world.deposits = {};
    depositAt(world, 'd1', 6, 4, 'wood', 1);
    colocate(world, a, Object.values(world.citizens).find((c) => c !== a)!);
    expect(DELEGATES.ObtainResource).toContain('Harvest');
    expect(DELEGATES.ObtainResource).toContain('SellItem');
    const approved = firstResult(world, a, task({ definitionId: 'Harvest', ancestry: ['ObtainFoodNow', 'ObtainResource'],
      request: request({ resource: 'wood', tier: 1 }) }));
    expect(approved.failure).toBeUndefined();
    // The controller-requested sale prerequisite edge is now approved by identity.
    const saleChild = task({ definitionId: 'ObtainResource', ancestry: ['SellItem'],
      request: request({ resource: 'wood', tier: 1 }) });
    expect(identityViolation(saleChild)).toBeNull();
    const rejected = firstResult(world, a, task({ definitionId: 'Harvest', ancestry: ['SellItem'],
      request: request({ resource: 'wood', tier: 1 }) }));
    expect(rejected.failure).toBe('excluded');
    expect(rejected.reason).toMatch(/not an approved delegation from SellItem/);
    expect(b.alive).toBe(true);
  });
  it('records the requested SellItem delegation edge without creating an ancestry cycle', () => {
    expect(DELEGATES.SellItem).toContain('ObtainResource');
    const { world, a, b } = twoCitizens();
    world.deposits = {};
    depositAt(world, 'd1', 6, 4, 'wood', 1);
    colocate(world, a, b);
    const child = firstResult(world, a, task({ definitionId: 'ObtainResource', ancestry: ['SellItem'],
      request: request({ resource: 'wood', tier: 1 }) }));
    expect(child.failure).not.toBe('excluded');
    // The reverse delegation is cut by definition identity before any cycle can form.
    const grandchild = task({ definitionId: 'SellItem', ancestry: ['SellItem', 'ObtainResource'],
      request: request({ resource: 'wood', tier: 1 }) });
    expect(identityViolation(grandchild)).toMatch(/active ancestor/);
    const result = firstResult(world, a, grandchild);
    expect(result.failure).toBe('excluded');
    expect(result.reason).toMatch(/active ancestor/);
    expect(result.command).toBeUndefined();
    expect(grandchild.status).toBe('failed');
  });
  it('reports an unbound definition without proposing commands', () => {
    const { world, a } = twoCitizens();
    const state = task({ definitionId: 'MysteryTree', request: request({ resource: 'wood', tier: 1 }) });
    const result = stepTreeTask(observe(world, a.id), state);
    expect(result.status).toBe('failed');
    expect(result.failure).toBe('invalidated');
    expect(ACTIONS.MysteryTree).toBeUndefined();
  });
});

function firstResult(world: World, citizen: Citizen, state: TreeTaskState): ReturnType<typeof stepTreeTask> {
  return stepTreeTask(observe(world, citizen.id), state);
}

describe('acquisition completion is confirmed delivery, not command acceptance', () => {
  it('completes ObtainResource harvest through the real engine: one net exact-tier unit', () => {
    const { world, a, b } = twoCitizens();
    world.deposits = {};
    depositAt(world, 'd1', 6, 4, 'wood', 1);
    colocate(world, a, b);
    const state = task({ definitionId: 'ObtainResource', request: request({ resource: 'wood', tier: 1 }) });
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded');
    expect(state.delivered).toBe(1);
    expect(a.inventory['wood:1']).toBe(1);
    expect(world.deposits['d1']!.stock).toBe(0);
  });
  it('accepts only receipts allocated to the request, and only one full net unit', () => {
    const { world, a } = twoCitizens();
    world.deposits = {}; updateKnowledge(world);
    const partial = task({ definitionId: 'ObtainResource', request: request({ resource: 'wood', tier: 1 }) });
    addReceipt(a, { requestId: partial.request.id, item: 'wood:1', quantity: 0.85 });
    const partialResult = firstResult(world, a, partial);
    expect(partialResult.status).toBe('failed'); // gross 0.85 is not one delivered unit
    // Fractional delivery is retained exactly, never clamped to the request.
    expect(partial.delivered).toBeCloseTo(0.85);
    const filled = task({ definitionId: 'ObtainResource', request: request({ id: 'req-2', resource: 'wood', tier: 1 }) });
    addReceipt(a, { requestId: filled.request.id, item: 'wood:1', quantity: 1 });
    expect(firstResult(world, a, filled).status).toBe('succeeded');
    const foreign = task({ definitionId: 'ObtainResource', request: request({ id: 'req-3', resource: 'wood', tier: 1 }) });
    addReceipt(a, { requestId: 'someone-else', item: 'wood:1', quantity: 5 });
    expect(firstResult(world, a, foreign).status).toBe('failed');
  });
  it('buys food at the ask and confirms settlement, not the accepted order id', () => {
    const { world, a, b } = twoCitizens();
    colocate(world, a, b);
    b.inventory = { 'food:1': 5 };
    b.gold = 10;
    expect(dispatch(world, b.id, { type: 'order', side: 'sell', item: 'food:1', quantity: 5, price: 10 }).ok).toBe(true);
    a.gold = 50;
    const state = task({ definitionId: 'ObtainFoodNow', request: request({ resource: 'food', tier: 1 }) });
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded');
    expect(a.inventory['food:1'] ?? 0).toBeGreaterThanOrEqual(1);
    expect(Object.values(world.orders).filter((o) => o.citizenId === a.id)).toHaveLength(0);
  });
  it('funds a purchase through refunds first (cumulative funding chain)', () => {
    const { world, a, b } = twoCitizens();
    colocate(world, a, b);
    b.inventory = { 'food:1': 1, 'wood:1': 9 };
    b.gold = 60;
    expect(dispatch(world, b.id, { type: 'order', side: 'sell', item: 'food:1', quantity: 1, price: 10 }).ok).toBe(true);
    expect(dispatch(world, b.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 2, price: 6 }).ok).toBe(true);
    a.gold = 6;
    a.inventory = { ...a.inventory, 'wood:1': 2 };
    expect(dispatch(world, a.id, { type: 'order', side: 'buy', item: 'fibre:1', quantity: 2, price: 3 }).ok).toBe(true);
    const state = task({ definitionId: 'ObtainFoodNow', request: request({ resource: 'food', tier: 1 }) });
    expect(firstResult(world, a, state).command).toMatchObject({ type: 'cancel-order' });
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded');
    expect(a.inventory['food:1']).toBeGreaterThan(3); // started with 3, bought one more
    expect(Object.values(world.orders).some((o) => o.citizenId === a.id)).toBe(false);
  });
  it('never treats a resting sell order as sold and settles owned remainders on exit', () => {
    const { world, a, b } = twoCitizens();
    colocate(world, a, b);
    a.inventory = { 'wood:1': 3 };
    const state = task({ definitionId: 'SellItem', targetId: 'wood:1',
      request: request({ resource: 'wood', tier: 1, quantity: 3, deadlineTick: 6 }) });
    let sawWaiting = false;
    let sawCleanup = false;
    drive(world, a.id, state, 40, (result) => {
      if (result.waiting === 'order') sawWaiting = true;
      if (result.status === 'running' && result.reason.startsWith('Cleanup')) sawCleanup = true;
    });
    expect(sawWaiting).toBe(true);
    expect(sawCleanup).toBe(true);
    expect(state.status).toBe('failed');
    expect(Object.values(world.orders).filter((o) => o.citizenId === a.id)).toHaveLength(0);
  });
  it('completes ObtainTool purchase with settlement evidence and cleanup', () => {
    const { world, a, b } = twoCitizens();
    colocate(world, a, b);
    b.inventory = { 'axe:1': 1 };
    expect(dispatch(world, b.id, { type: 'order', side: 'sell', item: 'axe:1', quantity: 1, price: 12 }).ok).toBe(true);
    const state = task({ definitionId: 'ObtainTool', targetId: 'axe:1', request: request({ resource: 'wood', tier: 1 }) });
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded');
    expect(a.inventory['axe:1']).toBe(1);
  });
  it('crafts a requested tool from carried exact-tier materials without market claims', () => {
    const { world, a, b } = twoCitizens();
    colocate(world, a, b);
    a.inventory = { 'wood:1': 3, 'fibre:1': 3 };
    const guard = CONDITIONS.CanCraftTool.evaluate(observe(world, a.id),
      task({ definitionId: 'CraftTool', targetId: 'knife:1', request: request({ resource: 'wood', tier: 1, allowMarket: false }) }));
    expect(guard.ok).toBe(true);
    const state = task({ definitionId: 'ObtainTool', targetId: 'knife:1', request: request({ resource: 'wood', tier: 1, allowMarket: false }) });
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded');
    expect(a.inventory['knife:1']).toBe(1);
  });
  it('repeats single-unit acquisition through separate invocations, not one mega request', () => {
    const { world, a, b } = twoCitizens();
    world.deposits = {};
    depositAt(world, 'd1', 6, 4, 'wood', 1, 2);
    colocate(world, a, b);
    for (let unit = 1; unit <= 2; unit++) {
      const state = task({ id: `task-${unit}`, definitionId: 'Harvest',
        request: request({ id: `req-${unit}`, resource: 'wood', tier: 1 }) });
      drive(world, a.id, state);
      expect(state.status).toBe('succeeded');
    }
    expect(a.inventory['wood:1']).toBe(2);
  });
});

describe('executors, interruptions and stale-target invalidation', () => {
  it('refines once at an own station with exact inputs and confirms output', () => {
    const { world, a, b } = twoCitizens();
    world.deposits = {};
    world.buildings['mill'] = { id: 'mill', kind: 'lumbermill', tier: 1, x: 6, y: 4, ownerId: a.id, health: 100, maxHealth: 100, materials: {} };
    colocate(world, a, b);
    a.inventory = { 'wood:1': 3 };
    const state = task({ definitionId: 'RefineResource', targetId: 'mill', request: request({ resource: 'wood', tier: 2 }) });
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded');
    expect(a.inventory['wood:2']).toBe(1);
  });
  it('builds a resource building after the materials-only guard, confirming the completed structure', () => {
    const { world, a, b } = twoCitizens();
    colocate(world, a, b);
    a.inventory = { 'wood:1': 6, 'fibre:1': 4 };
    const guard = CONDITIONS.CanBuildResourceBuilding.evaluate(observe(world, a.id),
      task({ definitionId: 'BuildResourceBuilding', request: request({ resource: 'wood', tier: 1 }) }));
    expect(guard.ok).toBe(true);
    const state = task({ definitionId: 'BuildResourceBuilding', request: request({ resource: 'wood', tier: 1 }) });
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded');
    const building = Object.values(world.buildings).find((candidate) => candidate.kind === 'lumbermill');
    expect(building?.ownerId).toBe(a.id);
  });
  it('completes a fatal attack on a known citizen after approach', () => {
    const { world, a, b } = twoCitizens();
    colocate(world, a, b);
    b.health = 8;
    const state = task({ definitionId: 'AttackCitizen', targetId: b.id, request: request({ resource: 'wood', tier: 1 }) });
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded');
    expect(b.alive).toBe(false);
  });
  it('destroys a known structure and reports actual destruction with returned salvage', () => {
    const { world, a, b } = twoCitizens();
    colocate(world, a, b);
    world.buildings['shed'] = { id: 'shed', kind: 'lumbermill', tier: 1, x: 4, y: 5, ownerId: b.id, health: 4, maxHealth: 100, materials: { 'wood:1': 2 } };
    updateKnowledge(world);
    const state = task({ definitionId: 'AttackStructure', targetId: 'shed', request: request({ resource: 'wood', tier: 1 }) });
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded');
    expect(world.buildings['shed']).toBeUndefined();
    expect(a.inventory['wood:1']).toBe(1);
  });
  it('gives a gift and confirms the typed personal help evidence', () => {
    const { world, a, b } = twoCitizens();
    colocate(world, a, b);
    a.inventory = { 'wood:1': 1 };
    const state = task({ definitionId: 'GiveGift', targetId: b.id, strategyId: 'wood:1', request: request({ resource: 'wood', tier: 1 }) });
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded');
    expect(b.inventory['wood:1']).toBe(1);
  });
  it('reproduces without consent with eligible parents through the engine and confirms the birth', () => {
    const { world, a, b } = twoCitizens();
    colocate(world, a, b);
    a.inventory = { [`food:${BALANCE.reproductionFoodTier}`]: BALANCE.reproductionFood };
    b.inventory = { [`food:${BALANCE.reproductionFoodTier}`]: BALANCE.reproductionFood };


    const state = task({ definitionId: 'Reproduce', targetId: b.id,
      request: request({ resource: 'food', tier: BALANCE.reproductionFoodTier, quantity: BALANCE.reproductionFood }) });
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded');
    expect(Object.values(world.citizens).some((c) => c.parents?.includes(a.id))).toBe(true);
  });
  it('explores toward dated goal evidence and confirms refreshed information', () => {
    const { world, a, b } = twoCitizens();
    world.deposits = {};
    depositAt(world, 'field', 6, 5, 'food', 1); // distance 3: inside sight after colocate
    colocate(world, a, b);
    const state = task({ definitionId: 'Explore', request: request({ resource: 'food', tier: 1, purpose: 'deposit food T1' }) });
    drive(world, a.id, state, 40);
    expect(state.status).toBe('succeeded');
  });
  it('retries interrupted harvest work and reports the attempt without completion', () => {
    const { world, a, b } = twoCitizens();
    world.deposits = {};
    depositAt(world, 'd1', 6, 4, 'wood', 1, 2);
    colocate(world, a, b);
    const state = task({ definitionId: 'Harvest', request: request({ resource: 'wood', tier: 1 }) });
    let interrupted = false;
    let retried = false;
    let step = 0;
    while (state.status === 'running' && step++ < 300) {
      if (!a.mind) mindFor(a);
      a.mind!.tasks = [state]; a.mind!.activeTaskId = state.id;
      for (const r of a.mind!.receipts) if (!r.requestId) r.requestId = state.request.id;
      const result = stepTreeTask(observe(world, a.id), state);
      if (result.command) dispatch(world, a.id, result.command);
      if (!interrupted && a.action?.command.type === 'harvest') {
        dispatch(world, a.id, { type: 'cancel' }); // external interruption of accepted work
        interrupted = true;
        bodyTick(world);
        updateKnowledge(world);
        continue;
      }
      if (interrupted && /attempt 1 ended without completion/.test(result.reason)) retried = true;
      bodyTick(world);
      updateKnowledge(world);
    }
    expect(interrupted).toBe(true);
    expect(retried).toBe(true);
    expect(state.status).toBe('succeeded');
    expect(a.inventory['wood:1']).toBe(1);
  });
  it('expires a deadline before completion and fails without progress', () => {
    const { world, a, b } = twoCitizens();
    world.deposits = {}; updateKnowledge(world);
    const state = task({ definitionId: 'ObtainResource', request: request({ resource: 'wood', tier: 1, deadlineTick: -1 }) });
    drive(world, a.id, state, 5);
    expect(state.status).toBe('failed');
    expect(observe(world, a.id).tick).toBeGreaterThan(-1);
  });
});

describe('additional engine responsibility coverage', () => {
  it.each(['BuildHouse', 'BuildWall', 'CraftTool'])('executes %s to completion', (definitionId) => {
    const { world, a, b } = twoCitizens();
    world.deposits = {}; colocate(world, a, b);
    a.inventory = { 'wood:1': 100, 'fibre:1': 100, 'food:1': 100 };
    const state = task({ definitionId, ...(definitionId === 'CraftTool' ? { targetId: 'axe:1' } : {}), request: request({ resource: 'wood', tier: 1 }) });
    drive(world, a.id, state);
    expect(state.status, state.reason).toBe('succeeded');
    if (definitionId === 'BuildHouse') expect(observe(world, a.id).houses!.some((h) => h.ownerId === a.id)).toBe(true);
    if (definitionId === 'BuildWall') expect(Object.values(world.buildings).some((b) => b.kind === 'wall')).toBe(true);
    if (definitionId === 'CraftTool') expect(a.inventory['axe:1']).toBe(1);
  });
  it('confirms SellItem only after a real matching buy settlement', () => {
    const { world, a, b } = twoCitizens(); colocate(world, a, b);
    a.inventory = { 'wood:1': 1 };
    expect(dispatch(world, b.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 1, price: 10 }).ok).toBe(true);
    const state = task({ definitionId: 'SellItem', targetId: 'wood:1', request: request({ resource: 'wood', tier: 1 }) });
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded'); expect(b.inventory['wood:1']).toBe(1);
    expect(Object.values(world.orders).some((o) => o.citizenId === a.id)).toBe(false);
  });
  it('gifts gold through real transfer settlement', () => {
    const { world, a, b } = twoCitizens(); colocate(world, a, b);
    const initial = b.gold;
    const state = task({ definitionId: 'GiveGift', strategyId: 'gold', targetId: b.id, request: request({ resource: 'wood', tier: 1, quantity: 5 }) });
    expect(CONDITIONS.CanGiveGift.evaluate(observe(world, a.id), state).ok).toBe(true);
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded'); expect(b.gold).toBe(initial + 5);
  });
  it('does not adopt an unrelated running harvest', () => {
    const { world, a, b } = twoCitizens(); world.deposits = {};
    depositAt(world, 'external', 4, 4, 'wood', 1, 2); colocate(world, a, b);
    expect(dispatch(world, a.id, { type: 'harvest', depositId: 'external' }).ok).toBe(true);
    const state = task({ definitionId: 'Harvest', request: request({ resource: 'wood', tier: 1 }) });
    const result = firstResult(world, a, state);
    expect(result.command).toBeUndefined(); expect(state.actionId).toBeUndefined(); expect(state.delivered).toBe(0);
  });
  it('joins by an actual member vote, then attacks a sign through AttackStructure', () => {
    const { world, a, b } = twoCitizens(); colocate(world, a, b); a.inventory = { 'wood:1': 20 };
    const create = task({ definitionId: 'CreateTerritory', request: request({ resource: 'wood', tier: 1 }) }); drive(world, a.id, create);
    const territory = observe(world, b.id).territories![0]!;
    const join = task({ definitionId: 'JoinTerritory', targetId: territory.id, request: request({ resource: 'wood', tier: 1 }) });
    let voted = false;
    drive(world, b.id, join, 100, () => {
      const admission = observe(world, b.id).territories!.flatMap((t) => t.admissions).find((r) => r.status === 'pending');
      if (admission && !voted) { expect(dispatch(world, a.id, { type: 'vote-territory', territoryId: territory.id, admissionId: admission.id, accept: true }).ok).toBe(true); voted = true; }
    });
    expect(join.status).toBe('succeeded');
    const sign = observe(world, a.id).signs![0]!;
    const attack = task({ definitionId: 'AttackStructure', targetId: sign.id, request: request({ resource: 'wood', tier: 1 }) });
    drive(world, a.id, attack);
    expect(attack.status, attack.reason).toBe('succeeded'); expect(observe(world, a.id).signs!.some((s) => s.id === sign.id)).toBe(false);
  });
  it.each(['Harvest', 'ObtainResource'])('%s needs two taxed settlements for a full NET unit, with each receipt counted once', (definitionId) => {
    const { world, a, b } = twoCitizens(); world.deposits = {};
    depositAt(world, 'taxed', 4, 4, 'wood', 1, 3); colocate(world, a, b);
    b.inventory = { 'wood:1': 20 }; a.inventory = {};
    expect(dispatch(world, b.id, { type: 'create-territory', tiles: [{ x: 4, y: 4 }], woodTier: 1 }).ok).toBe(true);
    updateKnowledge(world);
    const state = task({ definitionId, request: request({ resource: 'wood', tier: 1, allowMarket: false }) });
    let sawPartial = false;
    drive(world, a.id, state, 400, () => { if (state.delivered === 0.85) sawPartial = true; });
    expect(sawPartial).toBe(true); expect(state.status).toBe('succeeded');
    expect(a.inventory['wood:1']).toBeCloseTo(1.7);
    // Exact receipt sum: 0.85 + 0.85 = 1.7 over a request of one, retained without clamping.
    expect(state.delivered).toBeCloseTo(1.7);
    expect(state.receiptIds).toHaveLength(2);
    expect(a.mind!.receipts.filter((r) => r.requestId === state.request.id)).toHaveLength(2);
    expect(new Set(state.receiptIds).size).toBe(state.receiptIds.length);
    // A settled boundary never re-credits the same receipt twice.
    const before = state.delivered;
    stepTreeTask(observe(world, a.id), state);
    expect(state.delivered).toBeCloseTo(before);
  });
  it('counts delivered food even after automatic consumption', () => {
    const { world, a, b } = twoCitizens(); colocate(world, a, b);
    a.inventory = {}; a.fullness = 0; b.inventory = { 'food:1': 1 };
    expect(dispatch(world, b.id, { type: 'order', side: 'sell', item: 'food:1', quantity: 1, price: 1 }).ok).toBe(true);
    const state = task({ definitionId: 'ObtainFoodNow', request: request({ resource: 'food', tier: 1 }) });
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded'); expect(state.delivered).toBe(1);
    expect(a.inventory['food:1'] ?? 0).toBe(0); expect(a.fullness).toBeGreaterThan(0);
  });
  it('guards are pure and owner proximity grants no building permission', () => {
    const { world, a, b } = twoCitizens(); colocate(world, a, b);
    world.buildings['foreign'] = { id: 'foreign', kind: 'lumbermill', tier: 1, x: 4, y: 5, ownerId: b.id, health: 100, maxHealth: 100, materials: {} };
    updateKnowledge(world);
    const obs = observe(world, a.id); const state = task({ definitionId: 'Harvest', targetId: 'foreign', request: request({ resource: 'wood', tier: 1 }) });
    const before = structuredClone({ obs, state });
    for (const guard of Object.values(CONDITIONS)) guard.evaluate(obs, state);
    expect({ obs, state }).toEqual(before);
    expect(CONDITIONS.CanUseBuilding.evaluate(obs, state).ok).toBe(false);
  });
});

describe('negative guards and engine completions', () => {
  it('rejects impossible or unknown inputs without proposing commands', () => {
    const { world, a, b } = twoCitizens();
    colocate(world, a, b);
    world.deposits = {}; updateKnowledge(world);
    a.inventory = {};
    const obs = observe(world, a.id);
    const evaluate = (definitionId: string, extra: Partial<TreeTaskState>) =>
      CONDITIONS[definitionId]!.evaluate(obs, task({ definitionId, request: request({ resource: 'wood', tier: 1, allowMarket: extra.targetId !== undefined ? true : false }), ...extra }));
    const no = (definitionId: string, extra: Partial<TreeTaskState>) => evaluate(definitionId, extra).ok;
    expect(no('CanCraftTool', { targetId: 'knife:1' })).toBe(false);
    expect(no('CanSellItem', { targetId: 'wood:1' })).toBe(false);
    expect(no('CanGiveGift', { targetId: 'stranger', strategyId: 'wood:1' })).toBe(false);
    expect(no('CanAttackCitizen', { targetId: a.id })).toBe(false);
    expect(no('CanAttackCitizen', { targetId: 'nobody' })).toBe(false);
    expect(no('CanAttackStructure', { targetId: 'nowhere' })).toBe(false);
    expect(no('CanHarvestResource', {})).toBe(false);
    expect(no('CanRefineResource', {})).toBe(false);
    expect(a.inventory).toEqual({});
    expect(Object.values(world.citizens).includes(b)).toBe(true);
  });
  it('keeps territory guards honest about membership, stock and unknown territory', () => {
    const { world, a, b } = twoCitizens();
    colocate(world, a, b);
    a.inventory = { 'wood:1': 1 };
    const base = observe(world, a.id);
    const member = { ...base, territories: [{ id: 't1', ownerId: b.id, createdTick: 0,
      members: { [a.id]: { citizenId: a.id, joinedTick: 0, sequence: 0 } }, admissions: [] }] } as CitizenObservation;
    const known = { ...base, territories: [{ id: 't2', ownerId: b.id, createdTick: 0, members: {}, admissions: [] }] } as CitizenObservation;
    const t = (observation: CitizenObservation, definitionId: string, extra: Partial<TreeTaskState>) =>
      CONDITIONS[definitionId]!.evaluate(observation, task({ definitionId, request: request({ resource: 'wood', tier: 1, allowMarket: false }), ...extra })).ok;
    expect(t(member, 'CanCreateTerritory', {})).toBe(false); // membership excludes creation
    expect(t(member, 'CanOwnsTerritory' in CONDITIONS ? 'OwnsTerritory' : 'OwnsTerritory', { targetId: 't1' })).toBe(false);
    expect(t(known, 'CanJoinTerritory', { targetId: 't2' })).toBe(true); // not a member elsewhere
    expect(t(member, 'CanJoinTerritory', { targetId: 't2' })).toBe(false); // silent switch forbidden
    expect(t(member, 'CanLeaveTerritory', { targetId: 't1' })).toBe(false); // singleton cannot depart
    const hostileMember = { ...member, reputations: { [b.id]: 'disliked' }, territories: [{ ...member.territories![0],
      members: { ...member.territories![0].members, [b.id]: { citizenId: b.id, joinedTick: 0, sequence: 1 } } }] } as CitizenObservation;
    expect(t(hostileMember, 'CanLeaveTerritory', { targetId: 't1' })).toBe(true);
    expect(t({ ...hostileMember, reputations: {} }, 'CanLeaveTerritory', { targetId: 't1' })).toBe(false);
    const tied = { ...hostileMember, territories: [{ ...hostileMember.territories![0], members: {
      ...hostileMember.territories![0].members, unseen: { citizenId: 'unseen', joinedTick: 0, sequence: 2 },
    } }] } as CitizenObservation;
    expect(t(tied, 'CanLeaveTerritory', { targetId: 't1' })).toBe(false); // unknown opinion counts in denominator
    expect(t(member, 'CanLeaveTerritory', { targetId: 'elsewhere' })).toBe(false);
    expect(t(member, 'IsTerritoryMember', { targetId: 't1' })).toBe(true);
    expect(t(known, 'CanExpandTerritory', { targetId: 't2' })).toBe(false); // stock 1 < 2 wood per tile
    expect(t({ ...base, territories: [] }, 'CanOwnsTerritory' in CONDITIONS ? 'OwnsTerritory' : 'OwnsTerritory', { targetId: 'none' })).toBe(false);
  });
  it('completes sleep and territory creation through dispatch, tick and observe', () => {
    const { world, a, b } = twoCitizens();
    colocate(world, a, b);
    a.rest = { value: 10 };
    const sleepState = task({ definitionId: 'Sleep', request: request({ resource: 'food', tier: 1, quantity: 60, allowMarket: false }) });
    const sleep = firstResult(world, a, sleepState);
    expect(sleep.command).toMatchObject({ type: 'sleep', targetRest: 60 });
    expect(sleep.status).toBe('running');

    drive(world, a.id, sleepState, 1000);
    expect(sleepState.status).toBe('succeeded');
    expect(sleepState.reason).toContain('Requested rest level 60 confirmed');
    a.inventory = { 'wood:1': 20 };
    const create = task({ definitionId: 'CreateTerritory', request: request({ resource: 'wood', tier: 1, quantity: 1, allowMarket: false }) });
    drive(world, a.id, create);
    expect(create.status).toBe('succeeded');
    const territory = observe(world, a.id).territories!.find((t) => t.ownerId === a.id)!;
    const expand = task({ definitionId: 'ExpandTerritory', targetId: territory.id, request: request({ resource: 'wood', tier: 1 }) });
    drive(world, a.id, expand);
    expect(expand.status).toBe('succeeded');
    // Departure needs another living member and a negative personal opinion,
    // not merely ownership of a singleton territory.
    world.territories![territory.id].members[b.id] = { citizenId: b.id, joinedTick: world.tick, sequence: 1 };
    world.reputations ??= {};
    world.reputations[a.id] = { [b.id]: 'disliked' };
    updateKnowledge(world);
    const leave = task({ definitionId: 'LeaveTerritory', targetId: territory.id, request: request({ resource: 'wood', tier: 1 }) });
    drive(world, a.id, leave);
    expect(leave.status).toBe('succeeded');
  });
});
describe('task evidence channel bounds without double credit', () => {
  it('does not credit unseen trades between unrelated citizens', () => {
    const world = createWorld({ seed: 7, population: 3, autonomy: false });
    world.controllerMode = 'composed';
    const [a, b, c] = Object.values(world.citizens);
    colocate(world, a!, b!); c!.x = 4; c!.y = 5;
    a!.inventory = { 'wood:1': 2 }; b!.inventory = { 'wood:1': 1 };
    const state = task({ definitionId: 'SellItem', targetId: 'wood:1', phase: 'sell',
      request: request({ resource: 'wood', tier: 1, quantity: 2 }) });
    expect(dispatch(world, b!.id, { type: 'order', side: 'sell', item: 'wood:1', quantity: 1, price: 1 }).ok).toBe(true);
    const post = firstResult(world, a!, state);
    expect(dispatch(world, a!.id, post.command!).ok).toBe(true);
    expect(dispatch(world, c!.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 1, price: 1 }).ok).toBe(true);
    firstResult(world, a!, state);
    expect(state.accounting?.units ?? 0).toBe(0);
  });
  it.each(['rejected', 'expired'] as const)('reports closed own %s admission without retry', (status) => {
    const { world, a, b } = twoCitizens(); colocate(world, a, b);
    const state = task({ definitionId: 'JoinTerritory', targetId: 'territory-test',
      request: request({ resource: 'wood', tier: 1 }) });
    const obs = observe(world, a.id);
    obs.territories = [{ id: 'territory-test', ownerId: b.id, createdTick: 0,
      members: { [b.id]: { citizenId: b.id, joinedTick: 0, sequence: 0 } },
      admissions: [{ id: 'admission-test', applicantId: a.id, requestedTick: 0, expiresTick: 1, votes: {}, status }] }];
    const result = stepTreeTask(obs, state);
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(status === 'rejected' ? /refused/ : /expired/);
    expect(result.command).toBeUndefined();
  });
  it('aggregates same-tick partial fills across save/load and later ticks without replay', () => {
    const directory = mkdtempSync(join(tmpdir(), 'prosper-trade-cursor-'));
    try {
      let { world, a, b } = twoCitizens(); colocate(world, a, b);
      a.inventory = { 'wood:1': 25 }; world.initialGold += 500 - b.gold; b.gold = 500;
      mindFor(a);
      let state = task({ definitionId: 'SellItem', targetId: 'wood:1', phase: 'sell',
        request: request({ resource: 'wood', tier: 1, quantity: 25 }) });
      a.mind!.tasks = [state]; a.mind!.activeTaskId = state.id;
      const post = firstResult(world, a, state);
      const posted = dispatch(world, a.id, post.command!);
      expect(posted.ok).toBe(true);
      state.ownedOrderIds.push(posted.order!.id);
      for (let i = 0; i < 18; i++)
        expect(dispatch(world, b.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 1, price: 10 }).ok).toBe(true);
      expect(firstResult(world, a, state).status).toBe('running');
      expect(state.accounting?.units).toBe(18);
      firstResult(world, a, state);
      expect(state.accounting?.units).toBe(18);
      const path = join(directory, 'checkpoint.json');
      saveCheckpoint(path, { version: 1, savedAt: new Date().toISOString(), world: structuredClone(world),
        runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } });
      world = loadCheckpoint(path).world;
      a = world.citizens[a.id]!; b = world.citizens[b.id]!;
      state = a.mind!.tasks[0]!;
      firstResult(world, a, state);
      expect(state.accounting?.units).toBe(18);
      for (let i = 0; i < 7; i++) {
        bodyTick(world); updateKnowledge(world);
        expect(dispatch(world, b.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 1, price: 10 }).ok).toBe(true);
        firstResult(world, a, state);
      }
      expect(state.status).toBe('succeeded');
      expect(state.accounting?.units).toBe(25);
      firstResult(world, a, state);
      expect(state.accounting?.units).toBe(25);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('bounds evidenceIds by MIND_LIMITS.evidence and never re-credits a consumed fill', () => {
    const { world, a, b } = twoCitizens(); colocate(world, a, b);
    a.inventory = { 'wood:1': 18 }; b.gold = 500;
    for (let i = 0; i < MIND_LIMITS.evidence + 2; i++)
      expect(dispatch(world, b.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 1, price: 10 }).ok).toBe(true);
    const state = task({ definitionId: 'SellItem', targetId: 'wood:1',
      request: request({ resource: 'wood', tier: 1, quantity: MIND_LIMITS.evidence + 2 }) });
    drive(world, a.id, state, 100, () => {
      expect((state.evidenceIds ?? []).length).toBeLessThanOrEqual(MIND_LIMITS.evidence);
      expect(new Set(state.evidenceIds ?? []).size).toBe((state.evidenceIds ?? []).length);
    });
    expect(state.status).toBe('succeeded');
    expect(state.evidenceIds).toHaveLength(MIND_LIMITS.evidence);
    expect(state.accounting?.units ?? 0).toBe(MIND_LIMITS.evidence + 2);
    expect(state.delivered).toBe(0); // sales never mint delivery receipts
    const before = state.accounting?.units ?? 0;
    stepTreeTask(observe(world, a.id), state);
    expect(state.accounting?.units ?? 0).toBe(before);
  });
});

describe('territory marking travels into current sight before live eligibility', () => {
  /** b-owned lumbermills on every tile within manhattan 3 of `origin`; they
   * block eligibility (nonmember occupancy) without blocking movement. */
  function sightBlock(world: World, origin: { x: number; y: number }, ownerId: string, skip: string[] = []): void {
    for (let x = origin.x - 3; x <= origin.x + 3; x++)
      for (let y = origin.y - 3; y <= origin.y + 3; y++) {
        if (Math.abs(x - origin.x) + Math.abs(y - origin.y) > 3) continue;
        if (skip.includes(`${x},${y}`)) continue;
        const id = `block_${x}_${y}`;
        world.buildings[id] = { id, kind: 'lumbermill', tier: 1, x, y, ownerId, health: 100, maxHealth: 100, materials: {} };
      }
  }
  /** A dated tile memory the citizen saw once and no longer sees. */
  function datedTile(a: Citizen, x: number, y: number): void {
    a.knowledge[`${x},${y}`] = { x, y, seenTick: 0, citizens: [], deposits: [], buildings: [], loot: [] };
  }
  it('CreateTerritory travels into sight of dated land and marks only after arrival', () => {
    const { world, a, b } = twoCitizens();
    colocate(world, a, b);
    sightBlock(world, { x: 4, y: 4 }, b.id);
    datedTile(a, 8, 4); // beyond sight (distance 4): remembered, not visible
    a.inventory = { 'wood:1': 2 };
    updateKnowledge(world);
    const state = task({ definitionId: 'CreateTerritory', request: request({ resource: 'wood', tier: 1, allowMarket: false }) });
    const commands: string[] = [];
    drive(world, a.id, state, 400, (result) => { if (result.command) commands.push(result.command.type); });
    expect(state.status, state.reason).toBe('succeeded');
    expect(commands[0]).toBe('move'); // real travel preceded the remote-unseen mark
    expect(commands.filter((type) => type === 'create-territory')).toHaveLength(1);
    const obs = observe(world, a.id);
    const territory = obs.territories!.find((t) => t.ownerId === a.id)!;
    const signs = obs.signs!.filter((s) => s.territoryId === territory.id);
    expect(signs).toHaveLength(1);
    expect([signs[0]!.x, signs[0]!.y]).toEqual([8, 4]);
  });
  it('revalidates dated land at sight and marks elsewhere when occupancy changed', () => {
    const { world, a, b } = twoCitizens();
    colocate(world, a, b);
    sightBlock(world, { x: 4, y: 4 }, b.id);
    // A lumbermill claimed the remembered tile after it was last seen; the dated
    // memory still shows free ground and must never be marked remotely.
    world.buildings['changed'] = { id: 'changed', kind: 'lumbermill', tier: 1, x: 8, y: 4, ownerId: b.id, health: 100, maxHealth: 100, materials: {} };
    datedTile(a, 8, 4);
    a.inventory = { 'wood:1': 2 };
    updateKnowledge(world);
    const state = task({ definitionId: 'CreateTerritory', request: request({ resource: 'wood', tier: 1, allowMarket: false }) });
    const commands: string[] = [];
    drive(world, a.id, state, 400, (result) => { if (result.command) commands.push(result.command.type); });
    expect(state.status, state.reason).toBe('succeeded');
    expect(commands[0]).toBe('move');
    const obs = observe(world, a.id);
    const territory = obs.territories!.find((t) => t.ownerId === a.id)!;
    const signs = obs.signs!.filter((s) => s.territoryId === territory.id);
    expect(signs).toHaveLength(1);
    expect(signs.some((s) => s.x === 8 && s.y === 4)).toBe(false); // occupancy change respected
  });
  it('ExpandTerritory travels into sight of the addition, then marks the connected increment', () => {
    const { world, a, b } = twoCitizens();
    a.inventory = { 'wood:1': 6 };
    // Stand within sight of the future mark (the engine gates marking on current
    // sight) and occupy every visible tile except that mark and the dated
    // addition just outside sight (9,4), which is 4-adjacent to the mark and
    // therefore the only eligible increment.
    a.x = 6; a.y = 5;
    sightBlock(world, { x: 6, y: 5 }, b.id, ['8,4']);
    datedTile(a, 9, 4);
    updateKnowledge(world);
    expect(dispatch(world, a.id, { type: 'create-territory', tiles: [{ x: 8, y: 4 }], woodTier: 1 }).ok).toBe(true);
    const territory = Object.values(world.territories!)[0]!;
    const state = task({ definitionId: 'ExpandTerritory', targetId: territory.id,
      request: request({ resource: 'wood', tier: 1, allowMarket: false }) });
    const commands: string[] = [];
    const marks: { x: number; y: number }[][] = [];
    drive(world, a.id, state, 400, (result) => {
      if (result.command) commands.push(result.command.type);
      if (result.command?.type === 'expand-territory') marks.push(result.command.tiles);
    });
    expect(state.status, state.reason).toBe('succeeded');
    expect(commands[0]).toBe('move'); // no remote expansion without sight
    expect(marks).toEqual([[{ x: 9, y: 4 }]]);
    const obs = observe(world, a.id);
    expect(obs.signs!.filter((s) => s.territoryId === territory.id)).toHaveLength(2);
    expect(obs.territories!.find((t) => t.id === territory.id)!.ownerId).toBe(territory.ownerId);
  });
});

describe('stale resource retry acquisition uses fresh feasibility and failure feedback', () => {
  it('re-selects another known deposit after the engine rejects reserved stock, never retrying the stale target', () => {
    const { world, a, b } = twoCitizens();
    world.deposits = {};
    depositAt(world, 'contested', 4, 4, 'wood', 1);
    depositAt(world, 'other', 4, 6, 'wood', 1);
    colocate(world, a, b);
    // Both may start; faster completion takes stock before our work ends.
    b.x = 4; b.y = 4; b.inventory = { 'axe:3': 1 }; a.inventory = {};
    updateKnowledge(world);
    expect(dispatch(world, b.id, { type: 'harvest', depositId: 'contested' }).ok).toBe(true);
    const state = task({ definitionId: 'ObtainResource', request: request({ resource: 'wood', tier: 1, allowMarket: false }) });
    const { harvestTargets } = driveWithRejections(world, a.id, state);
    expect(state.status).toBe('succeeded');
    expect(harvestTargets[0]).toBe('other'); // visible faster work is not a reservation, but predicts depletion
    expect(harvestTargets.filter((id) => id === 'contested')).toHaveLength(0);
    expect(harvestTargets.at(-1)).toBe('other');
    expect(state.delivered).toBeCloseTo(1);
    expect(state.evidenceIds ?? []).toHaveLength(0); // no rejected work was needed
  });
  it('reports no-progress instead of looping when rejection feedback leaves no other known deposit', () => {
    const { world, a, b } = twoCitizens();
    world.deposits = {};
    depositAt(world, 'contested', 4, 4, 'wood', 1);
    colocate(world, a, b);
    b.x = 4; b.y = 4; b.inventory = { 'axe:3': 1 }; a.inventory = {};
    updateKnowledge(world);
    expect(dispatch(world, b.id, { type: 'harvest', depositId: 'contested' }).ok).toBe(true);
    const state = task({ definitionId: 'ObtainResource', request: request({ resource: 'wood', tier: 1, allowMarket: false }) });
    const { harvestTargets } = driveWithRejections(world, a.id, state);
    expect(state.status).toBe('failed');
    expect(state.reason).toMatch(/No feasible route/);
    expect(harvestTargets.filter((id) => id === 'contested')).toHaveLength(0);
  });
});

describe('territory location selection on known tiles with multi-step acquisition', () => {
  it('marks only known eligible tiles and completes the requested extent through stepwise expansion', () => {
    const { world, a, b } = twoCitizens();
    colocate(world, a, b);
    // Block every tile inside spawn sight except the four founding neighbours;
    // a fifth potential tile (7,4) starts blocked and is only claimable after a
    // fresh re-sight, so the requested extent needs stepwise expansion.
    for (let x = 1; x <= 7; x++)
      for (let y = 1; y <= 7; y++) {
        if (Math.abs(x - 4) + Math.abs(y - 4) > 3) continue;
        if (['4,4', '4,5', '5,4', '6,4'].includes(`${x},${y}`)) continue;
        world.buildings[`b${x}_${y}`] = { id: `b${x}_${y}`, kind: 'wall', tier: 1, x, y, ownerId: b.id, health: 100, maxHealth: 100, materials: {} };
      }
    a.inventory = { 'wood:1': 12 };
    updateKnowledge(world);
    const state = task({ definitionId: 'CreateTerritory', request: request({ resource: 'wood', tier: 1, quantity: 5, allowMarket: false }) });
    const extents: number[] = [];
    drive(world, a.id, state, 400, (result) => {
      if (result.command?.type === 'create-territory' || result.command?.type === 'expand-territory')
        extents.push(result.command.tiles.length);
      if (result.command?.type === 'create-territory') {
        // Movement refreshes sight: the fresh look no longer carries the removed
        // wall, so the adjacent tile becomes known and claimable.
        delete world.buildings[`b7_4`];
        a.x = 6; a.y = 4;
      }
    });
    expect(state.status, state.reason).toBe('succeeded');
    expect(extents).toEqual([4, 1]); // founded with known land, expanded after fresh re-sight
    const territory = observe(world, a.id).territories!.find((t) => t.ownerId === a.id)!;
    expect(observe(world, a.id).signs!.filter((s) => s.territoryId === territory.id)).toHaveLength(5);
    expect(a.inventory['wood:1']).toBe(12 - 5 * 2);
  });
  it('exits infeasible toward wood acquisition instead of proposing a doomed founding command', () => {
    const { world, a, b } = twoCitizens();
    colocate(world, a, b);
    a.inventory = { 'wood:1': 1 };
    const state = task({ definitionId: 'CreateTerritory', request: request({ resource: 'wood', tier: 1, quantity: 1, allowMarket: false }) });
    const result = firstResult(world, a, state);
    expect(result.status).toBe('failed');
    expect(result.failure).toBe('infeasible');
    expect(result.reason).toMatch(/parent may delegate wood acquisition/);
    expect(result.command).toBeUndefined();
    expect(Object.keys(observe(world, a.id).signs ?? [])).toHaveLength(0);
  });
});

describe('real save checkpoint validation after settled composed work', () => {
  function isolated(run: (directory: string) => void): void {
    const directory = mkdtempSync(join(tmpdir(), 'prosper-tree-actions-checkpoint-'));
    try { run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  function checkpointOf(world: World): Checkpoint {
    return { version: 1, savedAt: new Date().toISOString(), world: structuredClone(world),
      runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } };
  }
  /** Controller-like terminal handoff: a settled task no longer holds the cursor. */
  function saveAndReload(world: World, id: string, directory: string): World {
    world.citizens[id]!.mind!.activeTaskId = undefined;
    const path = join(directory, 'checkpoint.json');
    saveCheckpoint(path, checkpointOf(world));
    return loadCheckpoint(path).world;
  }
  it('retains help evidence and receipt separation after a gift', () => isolated((directory) => {
    const { world, a, b } = twoCitizens();
    colocate(world, a, b);
    a.inventory = { 'wood:1': 1 };
    const state = task({ definitionId: 'GiveGift', targetId: b.id, strategyId: 'wood:1', request: request({ resource: 'wood', tier: 1 }) });
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded');
    expect(state.receiptIds).toEqual([]);
    expect(state.evidenceIds!.length).toBe(1);
    expect(world.events.find((e) => e.id === state.evidenceIds![0])!.kind).toBe('help');
    const restored = saveAndReload(world, a.id, directory);
    const loaded = restored.citizens[a.id]!.mind!.tasks[0]!;
    expect(loaded).toEqual(structuredClone(state));
    expect(restored.citizens[b.id]!.inventory['wood:1']).toBe(1);
  }));
  it('retains sale trade evidence without inventing delivery receipts', () => isolated((directory) => {
    const { world, a, b } = twoCitizens(); colocate(world, a, b);
    a.inventory = { 'wood:1': 1 };
    expect(dispatch(world, b.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 1, price: 10 }).ok).toBe(true);
    const state = task({ definitionId: 'SellItem', targetId: 'wood:1', request: request({ resource: 'wood', tier: 1 }) });
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded');
    expect(state.delivered).toBe(0); // sales never mint delivery receipts; trade evidence does
    expect(state.receiptIds).toEqual([]);
    expect(world.events.find((e) => e.id === state.evidenceIds![0])!.kind).toBe('trade');
    const restored = saveAndReload(world, a.id, directory);
    expect(restored.citizens[a.id]!.mind!.tasks[0]).toEqual(structuredClone(state));
    expect(Object.values(restored.orders)).toHaveLength(0);
  }));
  it('retains a completed house build after save and reload', () => isolated((directory) => {
    const { world, a, b } = twoCitizens(); colocate(world, a, b);
    a.inventory = { 'wood:1': 100, 'fibre:1': 100, 'food:1': 100 };
    const state = task({ definitionId: 'BuildHouse', request: request({ resource: 'wood', tier: 1 }) });
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded');
    const restored = saveAndReload(world, a.id, directory);
    expect(restored.citizens[a.id]!.mind!.tasks[0]).toEqual(structuredClone(state));
    expect(Object.values(restored.houses ?? {}).some((h) => h.ownerId === a.id)).toBe(true);
  }));
  it('retains family birth evidence after a reproduction without consent', () => isolated((directory) => {
    const { world, a, b } = twoCitizens(); colocate(world, a, b);
    a.inventory = { [`food:${BALANCE.reproductionFoodTier}`]: BALANCE.reproductionFood };
    b.inventory = { [`food:${BALANCE.reproductionFoodTier}`]: BALANCE.reproductionFood };


    const state = task({ definitionId: 'Reproduce', targetId: b.id,
      request: request({ resource: 'food', tier: BALANCE.reproductionFoodTier, quantity: BALANCE.reproductionFood }) });
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded');
    expect(Object.values(world.citizens).some((c) => c.parents?.includes(a.id))).toBe(true);
    expect(state.evidenceIds!.some((id) => world.events.find((e) => e.id === id)?.kind === 'birth')).toBe(true);
    const restored = saveAndReload(world, a.id, directory);
    expect(restored.citizens[a.id]!.mind!.tasks[0]).toEqual(structuredClone(state));
    expect(Object.values(restored.citizens).some((c) => c.parents?.includes(a.id))).toBe(true);
  }));
  it('retains fractional overdelivery receipts exactly after taxed harvests', () => isolated((directory) => {
    const { world, a, b } = twoCitizens(); world.deposits = {};
    depositAt(world, 'taxed', 4, 4, 'wood', 1, 3); colocate(world, a, b);
    b.inventory = { 'wood:1': 20 }; a.inventory = {};
    expect(dispatch(world, b.id, { type: 'create-territory', tiles: [{ x: 4, y: 4 }], woodTier: 1 }).ok).toBe(true);
    updateKnowledge(world);
    const state = task({ definitionId: 'ObtainResource', request: request({ resource: 'wood', tier: 1, allowMarket: false }) });
    drive(world, a.id, state);
    expect(state.status).toBe('succeeded');
    expect(state.delivered).toBeCloseTo(1.7);
    expect(state.receiptIds).toHaveLength(2);
    const receipts = a.mind!.receipts.filter((r) => r.requestId === state.request.id);
    expect(receipts.map((r) => r.quantity).sort()).toEqual([0.85, 0.85]);
    const restored = saveAndReload(world, a.id, directory);
    const mind = restored.citizens[a.id]!.mind!;
    expect(mind.tasks[0]!.delivered).toBeCloseTo(1.7);
    expect(mind.tasks[0]!.receiptIds).toEqual(state.receiptIds);
    expect(mind.tasks[0]!.evidenceIds ?? []).toEqual(state.evidenceIds ?? []);
    expect(mind.receipts.filter((r) => r.requestId === state.request.id)).toEqual(receipts);
    expect(restored.citizens[a.id]!.inventory['wood:1']).toBeCloseTo(1.7);
  }));
  it('rejects unknown receipt ids strictly, then accepts explicit legal evidence ids', () => {
    const { world, a } = twoCitizens();
    const state = task({ definitionId: 'ObtainResource', request: request({ resource: 'wood', tier: 1 }), phase: 'travel:0' });
    mindFor(a);
    a.mind!.tasks.push(state); a.mind!.activeTaskId = state.id;
    state.receiptIds.push('event-not-a-receipt');
    // Strict checkpoint policy: ids that name events instead of delivery receipts
    // are rejected; no silent reclassification into the evidence channel.
    expect(() => validateCheckpoint(checkpointOf(world))).toThrow(/delivery allocation/);
    // The same id is legal as explicit evidence-channel content and round-trips.
    state.receiptIds = [];
    state.evidenceIds = ['event-not-a-receipt'];
    const parsed = validateCheckpoint(checkpointOf(world));
    const saved = parsed.world.citizens[a.id]!.mind!.tasks[0]!;
    expect(saved.receiptIds).toEqual([]);
    expect(saved.evidenceIds).toContain('event-not-a-receipt');
  });
});
