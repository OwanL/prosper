import { expect, it, vi } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import * as observation from '../src/world/observation.ts';
import type { TreeTaskState } from '../src/shared/tree-types.ts';
import { BALANCE } from '../src/world/config.ts';

/** The composed controller's decision path uses observeDecision; the historical
 * full projection is the forced fallback reference. Both are decision-path
 * projections, so call-count assertions count their sum. */
const projectionCalls = (observe: { mock: { calls: unknown[][] } }, decision: { mock: { calls: unknown[][] } }) =>
  observe.mock.calls.length + decision.mock.calls.length;

/** Pair fast/decision-path and forced-full-projection worlds tick-for-tick at full
 * equality. The 100-citizen differential is CPU-heavy and only passes with comfort
 * standalone; its timeout is scoped per population proportionately (60s for 100) so
 * full-suite parallel contention does not flap it, while the 20-citizen case keeps
 * the tighter budget. */
const differentialProjection = (population: number) => {
  const fast = createWorld({ seed: 937, population, controllerMode: 'composed', autonomy: false });
  const slow = structuredClone(fast);
  const observeSpy = vi.spyOn(observation, 'observe');
  const decisionSpy = vi.spyOn(observation, 'observeDecision');
  const originalEntry = observation.observeEntry;
  const entrySpy = vi.spyOn(observation, 'observeEntry');
  let fastCalls = 0; let slowCalls = 0; let fastMs = 0; let slowMs = 0;
  try {
    for (let tick = 0; tick < 120; tick++) {
      entrySpy.mockImplementation(originalEntry);
      observeSpy.mockClear(); decisionSpy.mockClear();
      let start = performance.now();
      tickWorld(fast);
      fastMs += performance.now() - start;
      fastCalls += projectionCalls(observeSpy, decisionSpy);
      // Test-only module hook: absent entry conservatively selects the original path.
      entrySpy.mockImplementation(() => undefined as unknown as ReturnType<typeof originalEntry>);
      observeSpy.mockClear(); decisionSpy.mockClear();
      start = performance.now();
      tickWorld(slow);
      slowMs += performance.now() - start;
      slowCalls += projectionCalls(observeSpy, decisionSpy);
      expect(fast).toEqual(slow);
    }
    expect(fastCalls).toBeLessThan(slowCalls * .7);
    console.info({ population, fastCalls, slowCalls, fastMs, slowMs });
  } finally { vi.restoreAllMocks(); }
};

it.each([20])('matches forced full projection after every committed tick (%i citizens), including RNG', differentialProjection, 20000);
it.each([100])('matches forced full projection after every committed tick (%i citizens), including RNG', differentialProjection, 60000);

function edgeFixture() {
  const world = createWorld({ seed: 7, population: 2, controllerMode: 'composed', autonomy: false });
  world.deposits = {}; world.buildings = {};
  const [a, peer] = Object.values(world.citizens);
  for (const c of [a, peer]) { c.x = 4; c.y = 4; c.inventory = {}; c.gold = 100; c.fullness = 100; }
  const task: TreeTaskState = {
    id: 'edge', definitionId: 'Harvest', request: { id: 'edge-request', resource: 'wood', tier: 1,
      quantity: 1, allowMarket: true, purpose: 'edge fixture', urgency: 'routine' },
    ancestry: [], phase: 'travel:0', status: 'running', startedTick: 0, lastProgressTick: 0,
    delivered: 0, receiptIds: [], ownedOrderIds: [], strategyId: 'harvest', targetId: 'patch', target: { x: 4, y: 4 },
  };
  a.mind!.tasks = [task]; a.mind!.activeTaskId = task.id;
  world.deposits.patch = { id: 'patch', x: 4, y: 4, resource: 'wood', tier: 1, stock: 4, capacity: 4, regrowAt: 0 };
  return { world, a, peer, task };
}

/** Clone only after all mechanics/setup commits. No between-tick mutations: the
 * comparison includes the entire authoritative world, receipts, knowledge and RNG. */
function pairedTicks(fx: ReturnType<typeof edgeFixture>, count: number, fullFirstTick: boolean) {
  observation.updateKnowledge(fx.world);
  const slow = structuredClone(fx.world);
  const originalEntry = observation.observeEntry;
  const entrySpy = vi.spyOn(observation, 'observeEntry');
  const observeSpy = vi.spyOn(observation, 'observe');
  const decisionSpy = vi.spyOn(observation, 'observeDecision');
  const actorProjectionCalls = () => [...observeSpy.mock.calls, ...decisionSpy.mock.calls].filter(([, id]) => id === fx.a.id).length;
  const options = { authority: { citizens: { [fx.a.id]: 'local-ai', [fx.peer.id]: 'direct' } as Record<string, 'local-ai' | 'direct'> } };
  let firstActorCalls = 0;
  try {
    for (let tick = 0; tick < count; tick++) {
      entrySpy.mockImplementation(originalEntry); observeSpy.mockClear();
      tickWorld(fx.world, 1, options);
      if (!tick) firstActorCalls = actorProjectionCalls();
      entrySpy.mockImplementation(() => undefined as unknown as ReturnType<typeof originalEntry>);
      tickWorld(slow, 1, options);
      expect(fx.world, `authoritative differential at tick ${tick + 1}`).toEqual(slow);
      expect(fx.a.alive).toBe(true); expect(fx.peer.alive).toBe(true);
    }
    expect(firstActorCalls > 0).toBe(fullFirstTick);
  } finally { vi.restoreAllMocks(); }
}

it.each([true, false])('preserves busy %s-owned harvest through settlement', owned => {
  const fx = edgeFixture();
  expect(dispatch(fx.world, fx.a.id, { type: 'harvest', depositId: 'patch' }).ok).toBe(true);
  if (owned) fx.task.actionId = fx.a.action!.id;
  pairedTicks(fx, 45, false);
  expect(fx.a.mind!.receipts.some(r => r.source === 'harvest' && r.item === 'wood:1')).toBe(true);
});

it('delivers admission housekeeping during long work with exact full-path equality', () => {
  const fx = edgeFixture();
  fx.world.territories = { t: { id: 't', ownerId: fx.a.id, createdTick: 0,
    members: { [fx.a.id]: { citizenId: fx.a.id, joinedTick: 0, sequence: 0 } },
    admissions: [{ id: 'admit', applicantId: fx.peer.id, requestedTick: 0, expiresTick: 100, status: 'pending', votes: {} }] } };
  fx.world.signs = { s: { id: 's', territoryId: 't', x: 4, y: 4, woodTier: 1, health: 10, maxHealth: 10 } };
  fx.a.mind!.memories = Array.from({ length: 30 }, (_, i) => ({ id: `help-${i}`, tick: 0, kind: 'help' as const, otherId: fx.peer.id, text: 'Personal help' }));
  expect(dispatch(fx.world, fx.a.id, { type: 'harvest', depositId: 'patch' }).ok).toBe(true);
  const actionId = fx.a.action!.id;
  fx.task.actionId = actionId;
  pairedTicks(fx, 3, false);
  expect(fx.world.territories.t.admissions[0].status).toBe('admitted');
  expect(fx.world.territories.t.members[fx.peer.id]).toBeDefined();
  expect(fx.a.action!.id).toBe(actionId);
  expect(fx.task.actionId).toBe(actionId);
  expect(fx.task.status).toBe('running');
  expect(fx.world.territories.t.admissions[0].votes).toEqual({ [fx.a.id]: true });
});

it('falls back for active food work at guard-true starvation, preserving real cleanup and receipts', () => {
  const fx = edgeFixture();
  fx.task.definitionId = 'Harvest'; fx.task.request.resource = 'food'; fx.task.request.urgency = 'survival';
  fx.world.deposits.patch.resource = 'food';
  expect(dispatch(fx.world, fx.a.id, { type: 'harvest', depositId: 'patch' }).ok).toBe(true);
  fx.task.actionId = fx.a.action!.id; fx.a.fullness = 0;
  fx.peer.inventory['food:1'] = 2;
  expect(dispatch(fx.world, fx.peer.id, { type: 'order', side: 'sell', item: 'food:1', quantity: 2, price: 2 }).ok).toBe(true);
  pairedTicks(fx, 12, true);
  expect(fx.task.status).toBe('failed');
  expect(fx.a.mind!.trace.some(t => t.command?.type === 'cancel')).toBe(true);
  expect(fx.a.fullness).toBeGreaterThan(0);
});

it('falls back for witnessed fresh attack danger during owned work', () => {
  const fx = edgeFixture();
  // Produce harm with real mechanics before installing work, not a synthetic alert.
  expect(dispatch(fx.world, fx.peer.id, { type: 'attack', targetId: fx.a.id }).ok).toBe(true);
  tickWorld(fx.world, BALANCE.attackTicks, { authority: { citizens: { [fx.a.id]: 'direct', [fx.peer.id]: 'direct' } } });
  expect(fx.a.health).toBeLessThan(100);
  expect(dispatch(fx.world, fx.a.id, { type: 'harvest', depositId: 'patch' }).ok).toBe(true);
  fx.task.actionId = fx.a.action!.id;
  pairedTicks(fx, 4, true);
  expect(fx.a.mind!.trace.some(t => t.transition === 'interrupt' && t.reason.startsWith('material-danger:'))).toBe(true);
});

it('clears recovered hunger episode keys even while busy', () => {
  const fx = edgeFixture();
  fx.a.mind!.trace = ['hunger-critical:2', 'starvation-critical'].map(reason => ({ tick: 0,
    invocationId: fx.task.id, definitionId: fx.task.definitionId, transition: 'interrupt', reason }));
  expect(dispatch(fx.world, fx.a.id, { type: 'harvest', depositId: 'patch' }).ok).toBe(true);
  fx.task.actionId = fx.a.action!.id;
  pairedTicks(fx, 3, false);
  expect(fx.a.mind!.trace.filter(t => /^(hunger|starvation)-critical/.test(t.reason))).toHaveLength(0);
});

it('adopts a mechanics-installed joint reproduction action for the selected family task', () => {
  const fx = edgeFixture();
  fx.task.definitionId = 'Reproduce'; fx.task.targetId = fx.peer.id;
  for (const c of [fx.a, fx.peer]) c.inventory['food:1'] = BALANCE.reproductionFood * 2;
  expect(dispatch(fx.world, fx.peer.id, { type: 'reproduce', partnerId: fx.a.id }).ok).toBe(true);
  const actionId = fx.a.action!.id;
  pairedTicks(fx, 3, false);
  expect(fx.task.actionId).toBe(actionId);
});

it('uses full projection for queue-only work', () => {
  const fx = edgeFixture();
  // Queue is a serialized mechanics fixture; no active physical work yet.
  // Core drains queues before controller admission. A stale target leaves no
  // action, so this exercises the full-path boundary rather than starting work.
  fx.a.queue = [{ type: 'harvest', depositId: 'missing' }];
  expect(fx.a.action).toBeNull();
  pairedTicks(fx, 3, true);
});

it('maintains retained receipt allocations and prunes retired leaves while busy', () => {
  const fx = edgeFixture();
  const retired = Array.from({ length: 80 }, (_, i): TreeTaskState => ({ ...structuredClone(fx.task),
    id: `retired-${i}`, status: 'succeeded', delivered: 9, receiptIds: ['expired'] }));
  const parent = retired.at(-2)!; const child = retired.at(-1)!; child.parentId = parent.id;
  parent.receiptIds = ['retained', 'expired'];
  fx.a.mind!.receipts = [{ id: 'retained', settlementId: 'fixture-settlement', tick: 0, citizenId: fx.a.id,
    item: 'wood:1', quantity: .5, source: 'market', requestId: parent.request.id }];
  fx.a.mind!.tasks = [...retired, fx.task];
  expect(dispatch(fx.world, fx.a.id, { type: 'harvest', depositId: 'patch' }).ok).toBe(true);
  fx.task.actionId = fx.a.action!.id;
  pairedTicks(fx, 3, false);
  expect(fx.a.mind!.tasks.length).toBeLessThan(81);
  expect(fx.a.mind!.tasks).toContain(parent);
  expect(parent.receiptIds).toEqual(['retained']); expect(parent.delivered).toBe(.5);
  expect(child.receiptIds).toEqual([]); expect(child.delivered).toBe(0);
});
