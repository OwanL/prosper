import { describe, expect, it } from 'vitest';
import { forecastPlan } from '../src/citizen/plan-forecast.ts';
import type { CitizenObservation, TileMemory } from '../src/shared/types.ts';
import type { PlanCommand } from '../src/shared/plan-types.ts';
import { createWorld } from '../src/world/core.ts';
import { observe } from '../src/world/observation.ts';
import { BALANCE, nutrition } from '../src/world/config.ts';

function fixture(): CitizenObservation {
  const world = createWorld({ seed: 7 });
  const id = Object.keys(world.citizens)[0]!;
  const o = observe(world, id);
  o.tick = 100;
  o.citizen.x = 2; o.citizen.y = 2;
  o.citizen.fullness = 100; o.citizen.health = 80;
  o.citizen.inventory = {};
  o.citizen.action = null; o.citizen.queue = [];
  o.visible = []; o.remembered = []; o.markets = [];
  return o;
}
function tile(o: CitizenObservation, resource: 'food' | 'wood' | 'fibre' = 'wood', stock = 1): TileMemory {
  return { x: 2, y: 2, seenTick: o.tick, citizens: [], buildings: [], loot: [], deposits: [{ id: 'known', x: 2, y: 2, resource, tier: 1, stock, capacity: 1, regrowAt: stock ? 0 : o.tick + BALANCE.regrowTicks }] };
}

describe('bounded observation-only plan forecasts', () => {
  it('reports recipe costs with no nutrition from reserved ingredients', () => {
    const o = fixture(); o.citizen.fullness = 50;
    o.citizen.inventory = { 'food:1': 3, 'fibre:1': 3 };
    const f = forecastPlan(o, { mode: 'replace', steps: [{ type: 'command', command: { type: 'craft', item: 'axe', tier: 1 } }] });
    expect(f.steps[0]!.costsOnSuccess).toEqual({ 'food:1': 3, 'fibre:1': 3 });
    expect(f.state.inventory['axe:1']).toEqual({ min: 1, max: 1 });
    expect(f.state.inventory['food:1']).toEqual({ min: 0, max: 0 });
    expect(f.state.fullness.min).toBeCloseTo(50 - BALANCE.craftTicks * BALANCE.fullnessDrain);
  });

  it('models lowest-tier automatic meals and fed health without an exact future-health promise', () => {
    const o = fixture(); o.citizen.fullness = 80;
    o.citizen.inventory = { 'food:1': 1, 'food:2': 1 };
    const f = forecastPlan(o, { mode: 'replace', steps: [{ type: 'wait', ticks: 1 }] });
    expect(f.state.inventory['food:1']).toEqual({ min: 0, max: 0 });
    expect(f.state.inventory['food:2']).toEqual({ min: 1, max: 1 });
    expect(f.state.fullness.min).toBeCloseTo(79.9 + nutrition(1));
    expect(f.assumptions.join(' ')).toContain('Health estimates exclude external damage');
  });

  it('automatically uses craft outputs and carries costs through later steps', () => {
    const o = fixture(); o.citizen.inventory = { 'food:1': 3, 'fibre:1': 3 };
    o.visible = [tile(o)]; o.visible[0]!.deposits[0]!.tier = 2;
    const f = forecastPlan(o, { mode: 'replace', steps: [
      { type: 'command', command: { type: 'craft', item: 'axe', tier: 1 } },
      { type: 'command', command: { type: 'harvest', depositId: 'known' } },
    ] });
    expect(f.steps[1]!.duration.conditional.max).toBe(BALANCE.harvestTicks);
    expect(f.steps[1]!.ticks.conditional.max).toBe(o.tick + BALANCE.craftTicks + BALANCE.harvestTicks);
    expect(f.state.inventory['axe:1']).toEqual({ min: 1, max: 1 });
    expect(f.state.inventory['wood:2']).toEqual({ min: 0, max: 1 });
  });

  it('uses the highest positive-count matching inventory tool without a setup step', () => {
    const o = fixture();
    o.citizen.inventory = { 'axe:1': 1, 'axe:3': 2, 'axe:6': 0, 'sword:6': 1 };
    o.visible = [tile(o)]; o.visible[0]!.deposits[0]!.tier = 4;
    const f = forecastPlan(o, { mode: 'replace', steps: [
      { type: 'command', command: { type: 'harvest', depositId: 'known' } },
    ] });
    expect(f.steps[0]!.feasibility).not.toBe('blocked');
    expect(f.steps[0]!.duration.conditional.max).toBe(BALANCE.harvestTicks);
    expect(f.state.inventory['wood:4']).toEqual({ min: 0, max: 1 });
    expect(f.state.inventory['axe:3']).toEqual({ min: 2, max: 2 });
  });

  it('treats stale stock as conditional and does not fabricate unseen loot contents', () => {
    const o = fixture(); const t = tile(o); t.seenTick = 5;
    t.loot.push({ id: 'body', x: 2, y: 2, citizenName: 'Someone' }); o.remembered = [t];
    const before = structuredClone(o);
    const f = forecastPlan(o, { mode: 'replace', steps: [
      { type: 'command', command: { type: 'harvest', depositId: 'known' } },
      { type: 'command', command: { type: 'loot', lootId: 'body' } },
    ] });
    expect(f.state.inventory['wood:1']).toEqual({ min: 0, max: 1 });
    expect(f.steps[0]!.warnings.join(' ')).toContain('tick 5');
    expect(f.steps[1]!.warnings.join(' ')).toContain('private/unknown');
    expect(o).toEqual(before);
    expect(JSON.parse(JSON.stringify(f))).toEqual(f);
    const unknown = forecastPlan(o, { mode: 'replace', steps: [{ type: 'command', command: { type: 'harvest', depositId: 'secret' } }] });
    expect(unknown.steps[0]!.feasibility).toBe('blocked');
    expect(unknown.steps[0]!.warnings.join(' ')).toContain('Unknown deposit');
  });

  it('bounds gather and accounts for completion-based regrowth and depletion across steps', () => {
    const o = fixture(); o.visible = [tile(o)];
    const budget = 2 * BALANCE.harvestTicks + BALANCE.regrowTicks;
    const f = forecastPlan(o, { mode: 'replace', steps: [{ type: 'gather', resource: 'wood', tier: 1, targetQuantity: 3, maxTicks: budget }] });
    expect(f.state.inventory['wood:1']).toEqual({ min: 0, max: 2 });
    expect(f.steps[0]!.duration.max).toBe(budget);
    expect(f.steps[0]!.duration.conditional.max).toBe(budget);
    const repeated = forecastPlan(o, { mode: 'replace', steps: [
      { type: 'gather', resource: 'wood', tier: 1, targetQuantity: 1, maxTicks: BALANCE.harvestTicks },
      { type: 'gather', resource: 'wood', tier: 1, targetQuantity: 2, maxTicks: BALANCE.harvestTicks },
    ] });
    expect(repeated.state.inventory['wood:1']!.max).toBe(1);
  });

  it('keeps discovery conditional without inventing yields or skipping known-feasible work', () => {
    const o = fixture(); o.citizen.inventory = { 'wood:1': 3, 'fibre:1': 3 };
    const f = forecastPlan(o, { mode: 'replace', steps: [
      { type: 'command', command: { type: 'move', x: 10, y: 2 } },
      { type: 'gather', resource: 'food', tier: 1, targetQuantity: 3, maxTicks: 20 },
      { type: 'command', command: { type: 'craft', item: 'knife', tier: 1 } },
    ] });
    expect(f.steps[1]!.feasibility).toBe('conditional');
    expect(f.steps[1]!.warnings.join(' ')).toContain('cannot yet be estimated');
    expect(f.steps[1]!.state.inventory['food:1']?.max ?? 0).toBe(0);
    expect(f.steps[2]!.feasibility).not.toBe('skipped');
    expect(f.state.inventory['knife:1']).toEqual({ min: 1, max: 1 });
    expect(f.feasibility).toBe('conditional');
  });

  it('distinguishes discovery-dependent deficits from impossible known inputs', () => {
    const o = fixture(); o.citizen.inventory = { 'fibre:1': 3 };
    const f = forecastPlan(o, { mode: 'replace', steps: [
      { type: 'gather', resource: 'food', tier: 1, targetQuantity: 3, maxTicks: 20 },
      { type: 'command', command: { type: 'craft', item: 'axe', tier: 1 } },
      { type: 'wait', ticks: 1 },
    ] });
    expect(f.steps[1]!.feasibility).toBe('conditional');
    expect(f.steps[1]!.warnings.join(' ')).toContain('discovery-dependent');
    expect(f.state.inventory['axe:1']?.max ?? 0).toBe(0);
    expect(f.steps[2]!.feasibility).not.toBe('skipped');
    o.citizen.inventory = {};
    const impossible = forecastPlan(o, { mode: 'replace', steps: [
      { type: 'gather', resource: 'food', tier: 1, maxTicks: 20 },
      { type: 'command', command: { type: 'craft', item: 'axe', tier: 1 } },
    ] });
    expect(impossible.steps[1]!.feasibility).toBe('blocked');
  });

  it('forecasts quantity-free gathering through its budget with regrowth and meals', () => {
    const o = fixture(); o.citizen.fullness = 20; o.visible = [tile(o, 'food')];
    const budget = 2 * BALANCE.harvestTicks + BALANCE.regrowTicks + 3;
    const f = forecastPlan(o, { mode: 'replace', steps: [{ type: 'gather', resource: 'food', tier: 1, maxTicks: budget }] });
    expect(f.steps[0]!.duration.conditional).toEqual({ min: budget, max: budget });
    expect(f.steps[0]!.warnings.join(' ')).toContain('deadline completes');
    expect(f.steps[0]!.warnings.join(' ')).not.toContain('target is not reached');
    expect(f.state.inventory['food:1']).toEqual({ min: 0, max: 0 });
    expect(f.state.fullness.max).toBeCloseTo(20 - budget * BALANCE.fullnessDrain + 2 * nutrition(1));
  });

  it('labels a quantity deadline as possible failure, not impossibility', () => {
    const o = fixture(); o.visible = [tile(o)];
    const f = forecastPlan(o, { mode: 'replace', steps: [
      { type: 'gather', resource: 'wood', tier: 1, targetQuantity: 2, maxTicks: BALANCE.harvestTicks },
      { type: 'wait', ticks: 1 },
    ] });
    expect(f.steps[0]!.feasibility).toBe('conditional');
    expect(f.steps[0]!.warnings.join(' ')).toContain('may fail');
    expect(f.steps[1]!.feasibility).not.toBe('skipped');
  });

  it('does not count eaten food toward carried gather target and respects tool limits', () => {
    const o = fixture(); o.citizen.fullness = 20; o.visible = [tile(o, 'food')];
    const f = forecastPlan(o, { mode: 'replace', steps: [{ type: 'gather', resource: 'food', tier: 1, targetQuantity: 1, maxTicks: BALANCE.harvestTicks }] });
    expect(f.state.inventory['food:1']?.max ?? 0).toBe(0);
    o.visible[0]!.deposits[0]!.tier = 3;
    const blocked = forecastPlan(o, { mode: 'replace', steps: [{ type: 'gather', resource: 'food', tier: 3, targetQuantity: 1, maxTicks: 100 }] });
    expect(blocked.steps[0]!.feasibility).toBe('blocked');
  });

  it('labels append start and state uncertainty instead of claiming queue completion', () => {
    const o = fixture(); o.citizen.queue = [{ type: 'move', x: 15, y: 15 }];
    const f = forecastPlan(o, { mode: 'append', steps: [{ type: 'wait', ticks: 5 }] });
    expect(f.startDelay.max).toBeNull(); expect(f.steps[0]!.ticks.max).toBeNull();
    expect(f.feasibility).toBe('conditional');
    expect(f.warnings.join(' ')).toContain('current carried baseline');
  });

  it('treats an existing plan without an action or queue as uncertain append work', () => {
    const o = fixture();
    o.citizen.plan = { id: 'waiting', approvedTick: 99, mode: 'replace', steps: [{ type: 'wait', ticks: 50 }], stepIndex: 0, wakeTick: 149 };
    const f = forecastPlan(o, { mode: 'append', steps: [{ type: 'wait', ticks: 5 }] });
    expect(f.startDelay.max).toBeNull();
    expect(f.feasibility).toBe('conditional');
    expect(f.warnings.join(' ')).toContain('existing action/queue/plan');
  });

  it.each(['harvest', 'refine', 'loot', 'build'] as const)('requires predicted activation sight for %s, allowing a preceding explicit move', type => {
    const o = fixture(); const t = tile(o); t.x = 10; t.deposits = [];
    o.citizen.inventory = { 'wood:1': 9, 'fibre:1': 4 };
    let command: PlanCommand;
    if (type === 'harvest') {
      t.deposits = [{ ...tile(o).deposits[0]!, x: 10 }];
      command = { type, depositId: 'known' };
    } else if (type === 'refine') {
      t.buildings = [{ id: 'station', x: 10, y: 2, kind: 'lumbermill', tier: 1, ownerId: o.citizen.id, health: 100, maxHealth: 100, materials: {} }];
      command = { type, buildingId: 'station', fromTier: 1 };
    } else if (type === 'loot') {
      t.loot = [{ id: 'body', x: 10, y: 2, citizenName: 'Someone' }];
      command = { type, lootId: 'body' };
    } else command = { type, kind: 'lumbermill', tier: 1, x: 10, y: 2 };
    o.remembered = [t];
    const blocked = forecastPlan(o, { mode: 'replace', steps: [{ type: 'command', command }] });
    expect(blocked.steps[0]!.feasibility).toBe('blocked');
    expect(blocked.steps[0]!.duration.conditional.max).toBe(0);
    expect(blocked.steps[0]!.warnings.join(' ')).toContain('explicit move');
    const moved = forecastPlan(o, { mode: 'replace', steps: [
      { type: 'command', command: { type: 'move', x: 10, y: 2 } },
      { type: 'command', command },
    ] });
    expect(moved.steps[1]!.feasibility).not.toBe('blocked');
    expect(moved.steps[1]!.warnings.join(' ')).not.toContain('outside predicted sight');
  });

  it('still lets gather auto-travel to a known deposit outside current sight', () => {
    const o = fixture(); const t = tile(o); t.x = 10; t.deposits[0]!.x = 10; o.remembered = [t];
    const f = forecastPlan(o, { mode: 'replace', steps: [{ type: 'gather', resource: 'wood', tier: 1, targetQuantity: 1, maxTicks: BALANCE.harvestTicks + 9 * BALANCE.moveTicks }] });
    expect(f.state.inventory['wood:1']?.max ?? 0).toBe(1);
    expect(f.steps[0]!.feasibility).toBe('conditional');
  });

  it('projects replace refunds once, never escrow or unfinished output', () => {
    const o = fixture();
    o.citizen.action = { id: 'a', command: { type: 'craft', item: 'axe', tier: 1 }, phase: 'work', startedTick: 99, elapsed: 1, duration: 8, reserved: { 'food:1': 3, 'fibre:1': 3 }, path: [], target: { x: 2, y: 2 } };
    const f = forecastPlan(o, { mode: 'replace', steps: [{ type: 'command', command: { type: 'craft', item: 'axe', tier: 1 } }] });
    expect(f.projectedRefund).toEqual(o.citizen.action.reserved);
    expect(f.state.inventory['axe:1']).toEqual({ min: 1, max: 1 });
    expect(o.citizen.inventory).toEqual({});
  });

  it('supports early conditions, failure review and explicit continue', () => {
    const o = fixture(); o.citizen.inventory['wood:1'] = 2;
    const f = forecastPlan(o, { mode: 'replace', steps: [
      { type: 'wait', ticks: 100, stopWhen: { kind: 'inventory-at-least', item: 'wood:1', quantity: 2 } },
      { type: 'command', command: { type: 'craft', item: 'axe', tier: 1 } },
      { type: 'wait', ticks: 20 },
    ] });
    expect(f.steps[0]!.duration.conditional.max).toBe(0);
    expect(f.steps[2]!.feasibility).toBe('skipped');
    const continued = forecastPlan(o, { mode: 'replace', steps: [
      { type: 'command', command: { type: 'craft', item: 'axe', tier: 1 }, onFailure: 'continue' },
      { type: 'wait', ticks: 20, stopWhen: { kind: 'health-below', health: 90 } },
    ] });
    expect(continued.steps[1]!.duration.conditional.max).toBe(0);
  });

  it('waits for dated regrowth and stops before food runway becomes unsafe', () => {
    const o = fixture(); o.visible = [tile(o, 'wood', 0)];
    const f = forecastPlan(o, { mode: 'replace', steps: [{ type: 'gather', resource: 'wood', tier: 1, targetQuantity: 1, maxTicks: BALANCE.regrowTicks + BALANCE.harvestTicks }] });
    expect(f.state.inventory['wood:1']!.max).toBe(1);
    expect(f.steps[0]!.duration.conditional.min).toBe(BALANCE.regrowTicks + BALANCE.harvestTicks);
    o.citizen.fullness = 1;
    const stopped = forecastPlan(o, { mode: 'replace', steps: [{ type: 'wait', ticks: 100, stopWhen: { kind: 'food-runway-below', ticks: 8 } }] });
    expect(stopped.steps[0]!.duration.conditional.max).toBeLessThan(5);
    expect(stopped.steps[0]!.ticks.max).toBeNull();
  });

  it('uses recipes and station speeds for build and refine and never guarantees an unknown route', () => {
    const o = fixture(); o.citizen.inventory = { 'wood:1': 9, 'fibre:1': 4 };
    const t = tile(o); t.deposits = [];
    t.buildings = [{ id: 'station', x: 2, y: 2, kind: 'lumbermill', tier: 1, ownerId: o.citizen.id, health: 100, maxHealth: 100, materials: {} }]; o.visible = [t];
    const f = forecastPlan(o, { mode: 'replace', steps: [
      { type: 'command', command: { type: 'refine', buildingId: 'station', fromTier: 1 } },
      { type: 'command', command: { type: 'build', kind: 'lumbermill', tier: 1, x: 3, y: 2 } },
    ] });
    expect(f.steps[0]!.costsOnSuccess).toEqual({ 'wood:1': 3 });
    expect(f.steps[0]!.duration.conditional.max).toBe(BALANCE.refineTicks[1]);
    expect(f.state.inventory['wood:2']).toEqual({ min: 1, max: 1 });
    expect(f.steps[1]!.costsOnSuccess).toEqual({ 'wood:1': 6, 'fibre:1': 4 });
    expect(f.steps[1]!.duration.max).toBeNull();
  });
});
