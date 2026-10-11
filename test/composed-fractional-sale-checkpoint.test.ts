import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createWorld, dispatch } from '../src/world/core.ts';
import { observe } from '../src/world/observation.ts';
import { stepTreeTask } from '../src/citizen/tree-actions.ts';
import { loadCheckpoint, saveCheckpoint, type Checkpoint } from '../src/server/checkpoint.ts';
import { mindSchema } from '../src/server/autonomy-checkpoint.ts';
import type { TreeTaskState } from '../src/shared/tree-types.ts';

it('continues fractional sale totals across disk restore and more than sixteen fills without duplicate credit', () => {
  let world = createWorld({ population: 2, autonomy: false });
  world.controllerMode = 'composed';
  const [seller, buyer] = Object.values(world.citizens);
  seller.inventory = { 'wood:1': 2.75 };
  const task: TreeTaskState = { id: 'fractional-sale', definitionId: 'SellItem', targetId: 'wood:1',
    ancestry: [], phase: 'start', status: 'running', startedTick: 0, lastProgressTick: 0, delivered: 0,
    receiptIds: [], ownedOrderIds: [], request: { id: 'fractional-sale', resource: 'wood', tier: 1,
      quantity: 2.75, allowMarket: true, purpose: 'sale', urgency: 'routine' } };
  seller.mind = { version: 1, dispositions: { ambition: 0.5, morals: 0.5, generosity: 0.5,
    riskTolerance: 0.5, patience: 0.5, sociability: 0.5, vengefulness: 0.5, familyOrientation: 0.5,
    enterprise: 0.5, economicIndependence: 0.5 }, memories: [], memoriesOmitted: 0,
    tasks: [task], receipts: [], trace: [], traceOmitted: 0, nextDirectorTick: 2400 };
  seller.mind!.activeTaskId = task.id;
  const proposal = stepTreeTask(observe(world, seller.id), task);
  const posted = dispatch(world, seller.id, proposal.command!);
  expect(posted.ok).toBe(true);
  task.ownedOrderIds.push(posted.order!.id);
  const fill = (quantity: number) => {
    expect(dispatch(world, buyer.id, { type: 'order', side: 'buy', item: 'wood:1', quantity, price: 100 }).ok).toBe(true);
    const current = world.citizens[seller.id].mind!.tasks[0];
    stepTreeTask(observe(world, seller.id), current);
    return current;
  };
  for (let i = 0; i < 20; i++) fill(0.125);
  expect(task.accounting?.units).toBe(2.5);
  expect(task.target).toBeUndefined();
  expect(task.evidenceIds!.length).toBeLessThanOrEqual(16);
  expect(task.receiptIds).toEqual([]);
  const directory = mkdtempSync(join(tmpdir(), 'prosper-fractional-sale-'));
  try {
    const path = join(directory, 'checkpoint.json');
    const checkpoint: Checkpoint = { version: 1, savedAt: new Date().toISOString(), world,
      runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } };
    saveCheckpoint(path, checkpoint);
    world = loadCheckpoint(path)!.world;
    const restored = world.citizens[seller.id].mind!.tasks[0];
    stepTreeTask(observe(world, seller.id), restored);
    expect(restored.accounting?.units).toBe(2.5);
    expect(restored.target).toBeUndefined();
    expect(fill(0.25).accounting?.units).toBe(2.75);
    expect(stepTreeTask(observe(world, seller.id), restored).status).toBe('succeeded');
    expect(restored.accounting?.units).toBe(2.75);
    expect(restored.target).toBeUndefined();
    expect(restored.receiptIds).toEqual([]);
    expect(world.citizens[buyer.id].inventory['wood:1']).toBe(2.75);
    delete world.citizens[seller.id].mind!.activeTaskId;
    saveCheckpoint(path, { ...checkpoint, world });
    const savedTask = loadCheckpoint(path)!.world.citizens[seller.id].mind!.tasks[0];
    expect(savedTask.accounting?.units).toBe(2.75);
    expect(savedTask.target).toBeUndefined();
    for (const invalid of [-1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const mind = structuredClone(world.citizens[seller.id].mind!);
      mind.tasks[0].accounting = { units: invalid };
      expect(mindSchema.safeParse(mind).success).toBe(false);
    }
    const spatial = structuredClone(world.citizens[seller.id].mind!);
    spatial.tasks[0].target = { x: 2.5, y: 3 };
    spatial.tasks[0].definitionId = 'BuildHouse';
    expect(mindSchema.safeParse(spatial).success).toBe(false);
    spatial.tasks[0].target = { x: 2, y: 3 };
    expect(mindSchema.safeParse(spatial).success).toBe(true);
    spatial.tasks[0].definitionId = 'SellItem';
    spatial.tasks[0].target.y = 0.5;
    expect(mindSchema.safeParse(spatial).success).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it('restores a legacy fractional SellItem target and continues accounting without duplicate credit', () => {
  let world = createWorld({ population: 2, autonomy: false });
  world.controllerMode = 'composed';
  const [seller, buyer] = Object.values(world.citizens);
  seller.inventory = { 'wood:1': 2.75 };
  const task: TreeTaskState = { id: 'legacy-fractional-sale', definitionId: 'SellItem', targetId: 'wood:1',
    ancestry: [], phase: 'start', status: 'running', startedTick: 0, lastProgressTick: 0, delivered: 0,
    receiptIds: [], ownedOrderIds: [], request: { id: 'legacy-fractional-sale', resource: 'wood', tier: 1,
      quantity: 2.75, allowMarket: true, purpose: 'sale', urgency: 'routine' } };
  seller.mind = { version: 1, dispositions: { ambition: 0.5, morals: 0.5, generosity: 0.5,
    riskTolerance: 0.5, patience: 0.5, sociability: 0.5, vengefulness: 0.5, familyOrientation: 0.5,
    enterprise: 0.5, economicIndependence: 0.5 }, memories: [], memoriesOmitted: 0,
    tasks: [task], receipts: [], trace: [], traceOmitted: 0, nextDirectorTick: 2400 };
  seller.mind.activeTaskId = task.id;
  const posted = dispatch(world, seller.id, stepTreeTask(observe(world, seller.id), task).command!);
  expect(posted.ok).toBe(true);
  task.ownedOrderIds.push(posted.order!.id);
  const fill = (quantity: number) => {
    expect(dispatch(world, buyer.id, { type: 'order', side: 'buy', item: 'wood:1', quantity, price: 100 }).ok).toBe(true);
    const current = world.citizens[seller.id].mind!.tasks[0];
    stepTreeTask(observe(world, seller.id), current);
    return current;
  };
  for (let i = 0; i < 20; i++) fill(0.125);
  expect(task.accounting?.units).toBe(2.5);

  const { accounting: _accounting, ...legacyFields } = structuredClone(task);
  const legacySellItem: TreeTaskState = { ...legacyFields, target: { x: 2.5, y: 0 } };
  seller.mind.tasks = [legacySellItem];
  const directory = mkdtempSync(join(tmpdir(), 'prosper-legacy-fractional-sale-'));
  try {
    const path = join(directory, 'checkpoint.json');
    const checkpoint: Checkpoint = { version: 1, savedAt: new Date().toISOString(), world,
      runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } };
    saveCheckpoint(path, checkpoint);
    world = loadCheckpoint(path)!.world;
    const restored = world.citizens[seller.id].mind!.tasks[0];
    expect(restored.target).toEqual({ x: 2.5, y: 0 });
    stepTreeTask(observe(world, seller.id), restored);
    expect(restored.accounting?.units).toBe(2.5);
    expect(restored.target).toBeUndefined();

    expect(fill(0.25).accounting?.units).toBe(2.75);
    expect(stepTreeTask(observe(world, seller.id), restored).status).toBe('succeeded');
    expect(world.citizens[buyer.id].inventory['wood:1']).toBe(2.75);
    expect(restored.accounting?.units).toBe(2.75);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
