import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { loadCheckpoint, saveCheckpoint, validateCheckpoint, type Checkpoint } from '../src/server/checkpoint.ts';
import type { CitizenMind, TreeTaskState } from '../src/shared/tree-types.ts';
import { updateKnowledge } from '../src/world/observation.ts';

function fixture(): Checkpoint {
  const world = createWorld({ population: 2 });
  world.controllerMode = 'composed';
  const c = Object.values(world.citizens)[0];
  c.inventory['wood:1'] = 0.85;
  c.rest = { value: 42 };
  c.mind = {
    version: 1, dispositions: { ambition: 0.5, morals: 0.5, generosity: 0.5, riskTolerance: 0.5,
      patience: 0.5, sociability: 0.5, vengefulness: 0.5, familyOrientation: 0.5, enterprise: 0.5, economicIndependence: 0.5 },
    memories: [], memoriesOmitted: 0, tasks: [], receipts: [], trace: [], traceOmitted: 0, nextDirectorTick: 2400,
  } satisfies CitizenMind;
  return { version: 1, savedAt: new Date().toISOString(), world,
    runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } };
}
describe('composed serializable contracts', () => {
  it('roundtrips fractional custody and bounded mind without filesystem access', () => {
    const cp = fixture();
    expect(validateCheckpoint(JSON.parse(JSON.stringify(cp)))).toEqual(cp);
  });
  it('preserves absent legacy mode without injecting a default', () => {
    const cp = fixture();
    delete cp.world.controllerMode;
    expect(validateCheckpoint(JSON.parse(JSON.stringify(cp)))).toEqual(cp);
  });
  it('roundtrips a running composed body after gift and market settlements', () => {
    const cp = fixture(); const world = cp.world;
    const [actor, peer] = Object.values(world.citizens);
    const building = { x: 5, y: 5 };
    actor.x = peer.x = building.x; actor.y = peer.y = building.y;
    actor.inventory['wood:1'] = 10; peer.gold = 100;
    updateKnowledge(world);
    expect(dispatch(world, actor.id, { type: 'give', citizenId: peer.id, item: 'wood:1', quantity: 1 }).ok).toBe(true);
    expect(dispatch(world, actor.id, { type: 'order', side: 'sell', item: 'wood:1', quantity: 1, price: 2 }).ok).toBe(true);
    expect(dispatch(world, peer.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 1, price: 2 }).ok).toBe(true);
    expect(dispatch(world, actor.id, { type: 'move', x: building.x + 1, y: building.y }).ok).toBe(true);
    cp.runtime.running = true;
    expect(actor.action).toBeDefined();
    expect(validateCheckpoint(JSON.parse(JSON.stringify(cp)))).toEqual(cp);
    tickWorld(world);
    expect(validateCheckpoint(JSON.parse(JSON.stringify(cp)))).toEqual(cp);
  });
  it('rejects malformed dispositions, unbounded memory and duplicate receipts', () => {
    const cp = fixture(); const c = Object.values(cp.world.citizens)[0];
    c.mind!.dispositions.morals = 2;
    expect(() => validateCheckpoint(cp)).toThrow();
    c.mind!.dispositions.morals = 0.5;
    c.mind!.memories = Array.from({ length: 65 }, (_, i) => ({ id: `m${i}`, tick: 0, kind: 'work', text: '' }));
    expect(() => validateCheckpoint(cp)).toThrow();
    c.mind!.memories = [];
    const r = { id: 'receipt', settlementId: 'settlement', tick: 0, citizenId: c.id, item: 'wood:1', quantity: 0.85, source: 'harvest' as const };
    c.mind!.receipts = [r, r];
    expect(() => validateCheckpoint(cp)).toThrow(/duplicate delivery/);
  });
  it('keeps delivery allocation strict and excludes WorldEvent evidence', () => {
    const cp = fixture(); const c = Object.values(cp.world.citizens)[0]; const mind = c.mind!;
    const task: TreeTaskState = { id: 'task', definitionId: 'ObtainResource', request: { id: 'request', resource: 'wood', tier: 1, quantity: 1, allowMarket: true, purpose: 'test', urgency: 'routine' },
      ancestry: [], phase: 'harvest', status: 'running', startedTick: 0, lastProgressTick: 0, delivered: 0.85, receiptIds: ['receipt'], ownedOrderIds: [] };
    mind.tasks = [task]; mind.activeTaskId = task.id;
    mind.receipts = [{ id: 'receipt', settlementId: 'settlement', tick: 0, citizenId: c.id, item: 'wood:1', quantity: 0.85, source: 'harvest', requestId: 'request' }];
    expect(validateCheckpoint(JSON.parse(JSON.stringify(cp)))).toEqual(cp);
    task.receiptIds.push('receipt');
    expect(() => validateCheckpoint(cp)).toThrow(/delivery allocation/);
    task.receiptIds = ['receipt'];
    mind.tasks.push({ ...task, id: 'other-task' });
    expect(() => validateCheckpoint(cp)).toThrow(/delivery allocation/);
    mind.tasks.pop();
    task.delivered = 1;
    expect(() => validateCheckpoint(cp)).toThrow(/net delivery evidence/);
    task.delivered = 0.85;
    mind.receipts[0].requestId = 'other-request';
    expect(() => validateCheckpoint(cp)).toThrow(/delivery allocation/);
    mind.receipts[0].requestId = 'request';
    task.receiptIds = ['event-not-a-receipt'];
    // No silent reclassification: unknown receipt ids never become event evidence.
    expect(() => validateCheckpoint(cp)).toThrow(/delivery allocation/);
    expect(task.evidenceIds).toBeUndefined();
  });
  it('roundtrips legal event evidence and keeps the channel bounded and separate', () => {
    const cp = fixture(); const c = Object.values(cp.world.citizens)[0]; const mind = c.mind!;
    const task: TreeTaskState = { id: 'task', definitionId: 'ObtainResource', request: { id: 'request', resource: 'wood', tier: 1, quantity: 1, allowMarket: true, purpose: 'test', urgency: 'routine' },
      ancestry: [], phase: 'harvest', status: 'running', startedTick: 0, lastProgressTick: 0, delivered: 0.85,
      receiptIds: ['receipt'], evidenceIds: ['event-1', 'event-2'], ownedOrderIds: [] };
    mind.tasks = [task]; mind.activeTaskId = task.id;
    mind.receipts = [{ id: 'receipt', settlementId: 'settlement', tick: 0, citizenId: c.id, item: 'wood:1', quantity: 0.85, source: 'harvest', requestId: 'request' }];
    expect(validateCheckpoint(JSON.parse(JSON.stringify(cp)))).toEqual(cp);
    // Bound aligns with the typed contract (MIND_LIMITS.evidence).
    task.evidenceIds = Array.from({ length: 17 }, (_, i) => `event-${i}`);
    expect(() => validateCheckpoint(cp)).toThrow(/Invalid checkpoint shape/);
    task.evidenceIds = ['event-1', 'event-1'];
    expect(() => validateCheckpoint(cp)).toThrow(/evidence channel separation/);
    task.evidenceIds = ['receipt'];
    expect(() => validateCheckpoint(cp)).toThrow(/evidence channel separation/);
  });
  it('retains exact overdelivery and rejects foreign-item allocation', () => {
    const cp = fixture(); const c = Object.values(cp.world.citizens)[0]; const mind = c.mind!;
    const task: TreeTaskState = { id: 'task', definitionId: 'ObtainResource', request: { id: 'request', resource: 'wood', tier: 1, quantity: 1, allowMarket: true, purpose: 'test', urgency: 'routine' },
      ancestry: [], phase: 'harvest', status: 'running', startedTick: 0, lastProgressTick: 0, delivered: 1.7, receiptIds: ['a', 'b'], ownedOrderIds: [] };
    mind.tasks = [task]; mind.activeTaskId = task.id;
    mind.receipts = [
      { id: 'a', settlementId: 's1', tick: 0, citizenId: c.id, item: 'wood:1', quantity: 0.85, source: 'harvest', requestId: 'request' },
      { id: 'b', settlementId: 's2', tick: 0, citizenId: c.id, item: 'wood:1', quantity: 0.85, source: 'market', requestId: 'request' },
    ];
    // Overdelivery beyond the request is exact custody evidence, never clamped.
    expect(validateCheckpoint(JSON.parse(JSON.stringify(cp)))).toEqual(cp);
    // A foreign-item receipt cannot be allocated to the request at any sum.
    mind.receipts[1] = { ...mind.receipts[1]!, item: 'food:1' };
    expect(() => validateCheckpoint(cp)).toThrow(/delivery allocation/);
  });
  it('validates 1500 normal composed ticks every 100 and restores an OS-temp save once', { timeout: 120000 }, () => {
    const directory = mkdtempSync(join(tmpdir(), 'prosper-composed-contracts-'));
    const world = createWorld({ seed: 7, population: 2, controllerMode: 'composed' });
    const checkpoint = (): Checkpoint => ({ version: 1, savedAt: new Date().toISOString(), world,
      runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } });
    for (let tick = 1; tick <= 1500; tick++) {
      tickWorld(world);
      if (tick % 100 === 0) validateCheckpoint(JSON.parse(JSON.stringify(checkpoint())));
    }
    const path = join(directory, 'checkpoint.json');
    saveCheckpoint(path, checkpoint());
    const restored = loadCheckpoint(path);
    expect(restored.world.tick).toBe(1500);
    expect(restored.world.controllerMode).toBe('composed');
    expect(() => validateCheckpoint(restored)).not.toThrow();
    expect(restored.world).toEqual(world);
  });
  it('rejects orphan signs and unknown directed opinions', () => {
    const cp = fixture();
    cp.world.signs = { sign: { id: 'sign', territoryId: 'missing', x: 0, y: 0, woodTier: 1, health: 16, maxHealth: 16 } };
    expect(() => validateCheckpoint(cp)).toThrow();
    delete cp.world.signs;
    cp.world.reputations = { missing: {} };
    expect(() => validateCheckpoint(cp)).toThrow();
  });
});
