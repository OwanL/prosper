import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from '../src/server/runtime.ts';
import { validateCheckpoint } from '../src/server/checkpoint.ts';
import { approvePlan } from '../src/world/plans.ts';
import { cancelAction } from '../src/world/core.ts';
import { updateKnowledge } from '../src/world/observation.ts';
const roots: string[] = [];
const runtimes: Runtime[] = [];
afterEach(() => {
  for (const r of runtimes.splice(0)) r.close();
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
function runtime(directory: string, restore = false) {
  const r = new Runtime({ directory, restore, autoClock: false, autonomy:false });
  runtimes.push(r);
  return r;
}

describe('plan checkpoint compatibility', () => {
  it('restores partial approved work and receipts without replaying costs or outputs', () => {
    const root = mkdtempSync(join(tmpdir(), 'prosper-plan-checkpoint-'));
    roots.push(root);
    const old = runtime(root);
    const citizen = Object.values(old.world.citizens)[0];
    for (const c of Object.values(old.world.citizens)) c.nextReviewTick = 10000;
    citizen.inventory = { 'wood:1': 3, 'fibre:1': 3, 'food:1': 10 };
    updateKnowledge(old.world);
    expect(
      approvePlan(
        old.world,
        citizen.id,
        {
          mode: 'append',
          steps: [
            { type: 'command', command: { type: 'craft', item: 'knife', tier: 1 } },
            { type: 'wait', ticks: 3 },
          ],
        },
        { cancel: () => cancelAction(old.world, citizen.id) },
      ).ok,
    ).toBe(true);
    old.control({ type: 'step', ticks: 3 });
    const before = old.checkpoint(false);
    expect(citizen.action?.reserved).toEqual({ 'wood:1': 3, 'fibre:1': 3 });
    const restored = runtime(root, true);
    const c = restored.world.citizens[citizen.id];
    expect(c.plan).toEqual(before.world.citizens[citizen.id].plan);
    expect(c.action).toEqual(before.world.citizens[citizen.id].action);
    restored.control({ type: 'step', ticks: 20 });
    expect(c.inventory['knife:1']).toBe(1);
    expect(c.inventory['wood:1'] ?? 0).toBe(0);
    expect(c).not.toHaveProperty('equipment');
    expect(c.plan).toBeUndefined();
    expect(c.planReceipts?.map((r) => r.outcome)).toEqual(['completed', 'completed']);
    const final = restored.checkpoint(false);
    expect(final.world.citizens[c.id].planReceipts).toEqual(c.planReceipts);
    const legacy = structuredClone(final);
    for (const citizen of Object.values(legacy.world.citizens)) {
      delete citizen.plan;
      delete citizen.planReceipts;
    }
    expect(() => validateCheckpoint(legacy)).not.toThrow();
  });

  it('migrates validated legacy references, queues and plan indices without changing held work or receipts', () => {
    const root = mkdtempSync(join(tmpdir(), 'prosper-tool-migration-'));
    roots.push(root);
    const r = runtime(root);
    const citizen = Object.values(r.world.citizens)[0];
    citizen.inventory = { 'wood:1': 3, 'fibre:1': 3, 'food:1': 10, 'axe:1': 1 };
    for (const c of Object.values(r.world.citizens)) c.nextReviewTick = 10000;
    approvePlan(r.world, citizen.id, {
      mode: 'append', steps: [
        { type: 'command', command: { type: 'craft', item: 'knife', tier: 1 } },
        { type: 'wait', ticks: 3 },
      ],
    }, { cancel: () => cancelAction(r.world, citizen.id) });
    r.control({ type: 'step', ticks: 3 });
    const cp = r.checkpoint(false);
    const legacy = JSON.parse(JSON.stringify(cp));
    const c = legacy.world.citizens[citizen.id];
    c.equipment = { axe: 'axe:1' };
    c.queue = [{ type: 'unequip', kind: 'axe' }, { type: 'move', x: c.x, y: c.y }];
    c.plan.steps.unshift({ type: 'command', command: { type: 'equip', item: 'axe:1' }, onFailure: 'review' });
    c.plan.stepIndex++;
    c.plan.steps.splice(2, 0, { type: 'command', command: { type: 'unequip', kind: 'knife' }, onFailure: 'review' });
    c.planReceipts = [{ planId: c.plan.id, step: 0, tick: 0, outcome: 'completed', message: 'Equipped axe:1.', state: { x: c.x, y: c.y, inventory: { 'axe:1': 1 }, fullness: 100, health: 100, gold: c.gold } }];
    const original = structuredClone(legacy);
    writeFileSync(join(root, 'checkpoint.json'), JSON.stringify(legacy));
    const restoredRuntime = runtime(root, true);
    const restored = restoredRuntime.world.citizens[citizen.id];
    expect(restored).not.toHaveProperty('equipment');
    expect(restored.inventory).toEqual(c.inventory);
    expect(restored.action).toEqual(c.action);
    expect(restored.gold).toBe(c.gold);
    expect(restored.queue).toEqual([{ type: 'move', x: c.x, y: c.y }]);
    expect(restored.plan?.stepIndex).toBe(0);
    expect(restored.plan?.pending).toEqual(c.plan.pending);
    const migratedPlanId = restored.plan!.id;
    expect(migratedPlanId).not.toBe(c.plan.id);
    expect(restored.planReceipts).toEqual(c.planReceipts);
    // A second checkpoint must keep the new identity, not migrate it again.
    expect(restoredRuntime.checkpoint(false).world.citizens[citizen.id].plan?.id).toBe(migratedPlanId);
    // Isolate plan continuation: the independently queued move would displace it.
    restored.queue = [];
    restoredRuntime.control({ type: 'step', ticks: 20 });
    expect(restored.inventory['knife:1']).toBe(1);
    expect(restored.inventory['wood:1'] ?? 0).toBe(0);
    expect(restored.inventory['fibre:1'] ?? 0).toBe(0);
    expect(restored.inventory['axe:1']).toBe(1);
    expect(restored.plan).toBeUndefined();
    expect(restored.planReceipts?.[0]).toEqual(c.planReceipts[0]);
    const completion = restored.planReceipts!.find((receipt) =>
      receipt.planId === migratedPlanId && receipt.step === 0);
    expect(completion?.outcome).toBe('completed');
    expect(completion?.message).toContain('Completed craft');
    expect(completion?.state.inventory['knife:1']).toBe(1);
    const identities = restored.planReceipts!.map((receipt) => `${receipt.planId}/${receipt.step}`);
    expect(new Set(identities).size).toBe(identities.length);
    expect(validateCheckpoint(legacy).world.orders).toEqual(legacy.world.orders);
    expect(legacy).toEqual(original);
  });

  it('skips a current obsolete step, retires obsolete-only plans and rejects malformed legacy states', () => {
    const root = mkdtempSync(join(tmpdir(), 'prosper-tool-migration-'));
    roots.push(root);
    const r = runtime(root);
    const cp = r.checkpoint(false);
    const legacy = JSON.parse(JSON.stringify(cp));
    const c = Object.values(legacy.world.citizens)[0] as any;
    c.inventory['axe:1'] = 1;
    c.equipment = { axe: 'axe:1' };
    c.plan = { id: `plan-${legacy.world.nextId++}`, mode: 'append', approvedTick: 0, stepIndex: 0, stepStartedTick: 0, wakeTick: 5, steps: [
      { type: 'command', command: { type: 'equip', item: 'axe:1' } },
      { type: 'wait', ticks: 3 },
    ] };
    const migrated = validateCheckpoint(legacy).world.citizens[c.id];
    expect(migrated.plan?.steps).toEqual([{ type: 'wait', ticks: 3, onFailure: 'review' }]);
    expect(migrated.plan).not.toHaveProperty('stepStartedTick');
    expect(migrated.plan).not.toHaveProperty('wakeTick');
    const only = structuredClone(legacy);
    only.world.citizens[c.id].plan.steps.pop();
    expect(validateCheckpoint(only).world.citizens[c.id].plan).toBeUndefined();
    for (const corrupt of [
      (v: any) => { v.equipment.axe = 'knife:1'; },
      (v: any) => { v.inventory['axe:1'] = 0; },
      (v: any) => { v.equipment.bow = 'axe:1'; },
      (v: any) => { v.plan.steps[0].command.extra = true; },
      (v: any) => { v.queue = [{ type: 'unequip', kind: 'bow' }]; },
      (v: any) => { v.plan.pending = { actionId: 'missing', eventSequence: 0, result: { ok: true, code: 'ok', message: 'old' } }; },
    ]) {
      const bad = structuredClone(legacy);
      corrupt(bad.world.citizens[c.id]);
      expect(() => validateCheckpoint(bad)).toThrow();
    }
  });

  it('normalizes queued recorded tool calls while retaining usage, other calls and historical text', () => {
    const root = mkdtempSync(join(tmpdir(), 'prosper-tool-migration-'));
    roots.push(root);
    const cp = runtime(root).checkpoint(false);
    const id = Object.keys(cp.world.citizens)[0];
    cp.runtime.recorded = [{ citizenId: id, responses: [{ content: 'Equipped axe:1.', usage: { inputTokens: 12, outputTokens: 3 }, toolCalls: [
      { id: 'old', name: 'command', arguments: JSON.stringify({ type: 'equip', item: 'axe:1' }) },
      { id: 'draft', name: 'draft_plan', arguments: JSON.stringify({ steps: [{ type: 'command', command: { type: 'unequip', kind: 'axe' } }] }) },
      { id: 'keep', name: 'command', arguments: JSON.stringify({ type: 'goals', goals: ['Trade'] }) },
    ] }] }];
    const original = structuredClone(cp);
    const response = validateCheckpoint(cp).runtime.recorded[0].responses[0];
    expect(response.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
    expect(response.content).toBe('Equipped axe:1.');
    expect(response.toolCalls?.map((call) => call.id)).toEqual(['draft', 'keep']);
    expect(JSON.parse(response.toolCalls![0].arguments).steps).toEqual([{ type: 'wait', ticks: 1 }]);
    expect(cp).toEqual(original);
    cp.runtime.recorded[0].responses[0].toolCalls![0].arguments = JSON.stringify({ type: 'equip', item: 'axe:1', bogus: true });
    expect(() => validateCheckpoint(cp)).toThrow();
  });

  it('rejects corrupt pending identity, progress, budgets and receipt times', () => {
    const root = mkdtempSync(join(tmpdir(), 'prosper-plan-checkpoint-'));
    roots.push(root);
    const r = runtime(root);
    const citizen = Object.values(r.world.citizens)[0];
    for (const c of Object.values(r.world.citizens)) c.nextReviewTick = 10000;
    citizen.inventory = { 'wood:1': 3, 'fibre:1': 3, 'food:1': 10 };
    approvePlan(
      r.world,
      citizen.id,
      {
        mode: 'append',
        steps: [{ type: 'command', command: { type: 'craft', item: 'knife', tier: 1 } }],
      },
      { cancel: () => cancelAction(r.world, citizen.id) },
    );
    r.control({ type: 'step', ticks: 1 });
    const cp = r.checkpoint(false);
    for (const corrupt of [
      (c: typeof citizen) => {
        c.plan!.pending!.actionId = 'different-action';
      },
      (c: typeof citizen) => {
        c.plan!.stepIndex = 1;
      },
      (c: typeof citizen) => {
        c.plan!.approvedTick = r.world.tick + 1;
      },
      (c: typeof citizen) => {
        c.plan!.steps = [{ type: 'wait', ticks: 10001 }];
      },
    ]) {
      const copy = structuredClone(cp);
      corrupt(copy.world.citizens[citizen.id]);
      expect(() => validateCheckpoint(copy)).toThrow();
    }
  });
});
