import { describe, expect, it } from 'vitest';
import { commandSchema, tools } from '../src/citizen/tools.ts';
import { planSpecSchema, draftPlanParameters } from '../src/citizen/plan-schema.ts';
import { directiveSchema, strategyParameters } from '../src/citizen/directive-schema.ts';
import { autonomyPolicyPatchSchema } from '../src/citizen/autonomy-schema.ts';
import { forecastPlan } from '../src/citizen/plan-forecast.ts';
import { foodRunwayTicks, planningContext } from '../src/citizen/planning.ts';
import { freshContext } from '../src/citizen/prompt.ts';
import { strategicProjection } from '../src/citizen/strategic-context.ts';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe } from '../src/world/observation.ts';
import { BALANCE, buildingRecipe, equipmentRecipe, nutrition } from '../src/world/config.ts';
import { validateCheckpoint, type Checkpoint } from '../src/server/checkpoint.ts';
import { MAX_TIER, TIERS } from '../src/shared/tiers.ts';
import type { Command, Tier, World } from '../src/shared/types.ts';

function checkpoint(world: World): Checkpoint {
  return { version: 1, savedAt: new Date().toISOString(), world: structuredClone(world), runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } };
}
function fixture() {
  const world = createWorld({ seed: 7, autonomy: true });
  const citizen = Object.values(world.citizens)[0]!;
  return { world, citizen };
}

describe('six-tier citizen contracts', () => {
  it('accepts T6 commands, plans, directives and policy, rejecting unsupported tiers and bad directions', () => {
    const down = { type: 'refine', buildingId: 'station', fromTier: 6, direction: 'down' };
    expect(commandSchema.safeParse(down).success).toBe(true);
    expect(commandSchema.parse({ type: 'refine', buildingId: 'station', fromTier: 5 })).not.toHaveProperty('direction');
    const spec = { mode: 'replace', steps: [{ type: 'command', command: down }, { type: 'command', command: { type: 'craft', item: 'axe', tier: 6 } }, { type: 'gather', resource: 'food', tier: 6, maxTicks: 10 }] };
    expect(planSpecSchema.safeParse(spec).success).toBe(true);
    expect(directiveSchema.safeParse({ type: 'operate', buildingId: 'station', fromTier: 6, direction: 'down', areas: [[0, 0, 1, 1]], stopWhen: { kind: 'inventory-at-least', item: 'wood:6', quantity: 1 } }).success).toBe(true);
    expect(autonomyPolicyPatchSchema.safeParse({ targetTier: 6 }).success).toBe(true);
    for (const tier of [0, MAX_TIER + 1, 1.5]) {
      expect(commandSchema.safeParse({ type: 'craft', item: 'axe', tier }).success).toBe(false);
      expect(autonomyPolicyPatchSchema.safeParse({ targetTier: tier }).success).toBe(false);
    }
    expect(commandSchema.safeParse({ ...down, direction: 'sideways' }).success).toBe(false);
    expect(commandSchema.safeParse({ type: 'equip', item: `axe:${MAX_TIER + 1}` }).success).toBe(false);
    // Published provider schemas must expose the same range and direction.
    for (const schema of [tools, draftPlanParameters, strategyParameters]) {
      const json = JSON.stringify(schema);
      expect(json).toContain('"direction"');
      expect(json).toContain(JSON.stringify(TIERS));
    }
  });

  it('counts and eats high-tier food and exposes all configured recipe/timing tiers', () => {
    const { world, citizen } = fixture();
    citizen.fullness = 0;
    citizen.inventory = { 'food:6': 1 };
    const observation = observe(world, citizen.id);
    expect(foodRunwayTicks(citizen)).toBeCloseTo(nutrition(6) / BALANCE.fullnessDrain);
    const forecast = forecastPlan(observation, { mode: 'replace', steps: [{ type: 'wait', ticks: 1 }] });
    expect(forecast.state.inventory['food:6']).toEqual({ min: 0, max: 0 });
    const context = JSON.parse(freshContext(observation)[1]!.content!);
    expect(context.planning.recipes.tools.axe['6']).toEqual(equipmentRecipe('axe', 6));
    expect(context.planning.recipes.buildings.wall['6']).toEqual(buildingRecipe('wall', 6));
    expect(context.planning.nutritionByTier['6']).toBe(nutrition(6));
    expect(planningContext(observation).actionTimingTicks.harvestByMatchingToolTier).toHaveLength(MAX_TIER + 1);
    expect(strategicProjection(observation).planning.nutrition).toHaveLength(MAX_TIER);
  });

  it('forecasts T6 downconversion and blocks upconversion at insufficient stations', () => {
    const { world, citizen } = fixture();
    citizen.inventory = { 'wood:6': 1 };
    const o = observe(world, citizen.id);
    o.markets = []; o.remembered = [];
    o.visible = [{ x: citizen.x, y: citizen.y, seenTick: world.tick, citizens: [], deposits: [], loot: [], buildings: [{ id: 'station', kind: 'lumbermill', tier: 5, ownerId: citizen.id, x: citizen.x, y: citizen.y, health: 100, maxHealth: 100, materials: {} }] }];
    const forecast = (direction: 'up' | 'down') => forecastPlan(o, { mode: 'replace', steps: [{ type: 'command', command: { type: 'refine', buildingId: 'station', fromTier: 6, direction } }] });
    expect(forecast('down').steps[0]!.costsOnSuccess).toEqual({ 'wood:6': 1 });
    expect(forecast('down').state.inventory['wood:5']).toEqual({ min: 2, max: 2 });
    expect(forecast('up').steps[0]!.feasibility).toBe('blocked');
    o.visible[0]!.buildings[0]!.tier = 4;
    expect(forecast('down').steps[0]!.feasibility).toBe('blocked');
  });
});

describe('six-tier checkpoint preservation', () => {
  it('restores T6 tool holdings, policy, production/project, plans, directives and memories', () => {
    const { world, citizen } = fixture();
    citizen.inventory = { 'axe:6': 1, 'food:6': 2 };
    citizen.autonomy!.policy.targetTier = 6;
    citizen.autonomy!.productionGoal = { item: 'axe', tier: 6 };
    citizen.autonomy!.project = { kind: 'lumbermill', tier: 6, x: citizen.x, y: citizen.y };
    for (const d of Object.values(world.deposits)) d.tier = 6;
    for (const tile of Object.values(citizen.knowledge)) for (const d of tile.deposits) d.tier = 6;
    const buildingId = `building-${world.nextId++}`;
    world.buildings[buildingId] = { id: buildingId, kind: 'lumbermill', tier: 6, ownerId: citizen.id, x: 0, y: 0, health: 100, maxHealth: 100, materials: { 'wood:6': 192, 'fibre:6': 128 } };
    for (const d of Object.values(world.deposits)) if (d.x === 0 && d.y === 0) delete world.deposits[d.id];
    citizen.plan = { id: `plan-${world.nextId++}`, approvedTick: world.tick, stepIndex: 0, mode: 'append', steps: [{ type: 'command', command: { type: 'craft', item: 'axe', tier: 6 }, onFailure: 'review' }] };
    citizen.strategy = { id: `strategy-${world.nextId++}`, approvedTick: world.tick, directives: [{ type: 'operate', buildingId, fromTier: 6, direction: 'down', areas: [[0, 0, world.width - 1, world.height - 1]] }], index: 0, status: 'active', reviewTick: world.tick + 600, progress: 0, lastProgressTick: world.tick, attempted: [] };
    citizen.queue = [{ type: 'craft', item: 'axe', tier: 6 }, { type: 'refine', buildingId, fromTier: 6, direction: 'down' }];
    const cp = checkpoint(world);
    expect(validateCheckpoint(cp).world).toEqual(cp.world);
    const corrupt = structuredClone(cp);
    corrupt.world.citizens[citizen.id]!.inventory[`wood:${MAX_TIER + 1}`] = 1;
    expect(() => validateCheckpoint(corrupt)).toThrow();
  });

  it.each([2, 3] as Tier[])('preserves exact old T%i craft/build reservations, rejecting partial or extra inputs', (tier) => {
    for (const type of ['craft', 'build'] as const) {
      const world = createWorld({ seed: 7 });
      const citizen = Object.values(world.citizens)[0]!;
      world.deposits = {}; world.buildings = {};
      const command: Command = type === 'craft'
        ? { type, item: 'knife', tier }
        : { type, kind: 'lumbermill', tier, x: citizen.x, y: citizen.y };
      citizen.inventory = type === 'craft' ? equipmentRecipe('knife', tier) : buildingRecipe('lumbermill', tier);
      expect(dispatch(world, citizen.id, command).ok).toBe(true);
      expect(citizen.action).not.toBeNull();
      const base = type === 'craft' ? equipmentRecipe('knife', 1) : buildingRecipe('lumbermill', 1);
      citizen.action!.reserved = Object.fromEntries(Object.entries(base).map(([key, n]) => [`${key.split(':')[0]}:${tier}`, n]));
      const cp = checkpoint(world);
      const suspended = structuredClone(cp);
      const suspendedCitizen = suspended.world.citizens[citizen.id]!;
      suspendedCitizen.emergency = { startedTick: world.tick, depositId: 'gone', outsideAreas: true, stage: 'gather', suspendedAction: suspendedCitizen.action!, suspendedPosition: { x: citizen.x, y: citizen.y } };
      suspendedCitizen.action = null;
      expect(validateCheckpoint(suspended).world.citizens[citizen.id]!.emergency!.suspendedAction).toEqual(citizen.action);
      const restored = validateCheckpoint(cp);
      expect(restored.world.citizens[citizen.id]!.action).toEqual(citizen.action);
      for (const mutation of ['partial', 'extra']) {
        const bad = structuredClone(cp);
        const reserved = bad.world.citizens[citizen.id]!.action!.reserved;
        if (mutation === 'partial') reserved[`wood:${tier}`]!--;
        else reserved[`food:${tier}`] = 1;
        expect(() => validateCheckpoint(bad)).toThrow('action reserved recipe');
      }
      tickWorld(restored.world, 30);
      expect(restored.world.citizens[citizen.id]!.action).toBeNull();
      if (type === 'craft') expect(restored.world.citizens[citizen.id]!.inventory[`knife:${tier}`]).toBe(1);
      else expect(Object.values(restored.world.buildings)).toHaveLength(1);
    }
  });

  it('checks exact T6 downconversion reservations without weakening refinement quantities', () => {
    const world = createWorld({ seed: 7 });
    const citizen = Object.values(world.citizens)[0]!;
    world.deposits = {}; world.buildings = {};
    const id = `building-${world.nextId++}`;
    world.buildings[id] = { id, kind: 'lumbermill', tier: 5, ownerId: citizen.id, x: citizen.x, y: citizen.y, health: 100, maxHealth: 100, materials: {} };
    citizen.inventory = { 'wood:6': 1 };
    expect(dispatch(world, citizen.id, { type: 'refine', buildingId: id, fromTier: 6, direction: 'down' }).ok).toBe(true);
    expect(validateCheckpoint(checkpoint(world)).world.citizens[citizen.id]!.action!.reserved).toEqual({ 'wood:6': 1 });
    citizen.action!.reserved['wood:6'] = 3;
    expect(() => validateCheckpoint(checkpoint(world))).toThrow('refine reserved quantity');
  });

  it('does not extend historical unscaled recipe compatibility to new tiers', () => {
    const { world, citizen } = fixture();
    citizen.inventory = equipmentRecipe('knife', 6);
    expect(dispatch(world, citizen.id, { type: 'craft', item: 'knife', tier: 6 }).ok).toBe(true);
    expect(() => validateCheckpoint(checkpoint(world))).not.toThrow();
    citizen.action!.reserved = { 'wood:6': 3, 'fibre:6': 3 };
    expect(() => validateCheckpoint(checkpoint(world))).toThrow('action reserved recipe');
  });
});
