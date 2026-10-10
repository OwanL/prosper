import { describe, expect, it } from 'vitest';
import { MAX_TIER } from '../src/shared/tiers.ts';
import {
  approvePlanSchema,
  parsePlanSpec,
  planSpecSchema,
  MAX_PLAN_BUDGET_TICKS,
} from '../src/citizen/plan-schema.ts';
import { parseCommand, legacyTools as tools } from '../src/citizen/tools.ts';
import { freshContext, PROMPT_VERSION } from '../src/citizen/prompt.ts';
import { createWorld } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import { equipmentRecipe, buildingRecipe } from '../src/world/config.ts';

const wait = { type: 'wait', ticks: 1 };
describe('bounded plan schema', () => {
  it('defaults append and per-step review without mutating input', () => {
    const input = { steps: [wait] };
    expect(parsePlanSpec(input)).toEqual({
      mode: 'append',
      steps: [{ ...wait, onFailure: 'review' }],
    });
    expect(input).toEqual({ steps: [wait] });
    expect(
      parsePlanSpec({ mode: 'replace', steps: [{ ...wait, onFailure: 'continue' }] }).mode,
    ).toBe('replace');
  });
  it('allows only strict physical command variants, compatible with command validation', () => {
    const commands = [
      { type: 'move', x: 0, y: 3 },
      { type: 'harvest', depositId: 'deposit-1' },
      { type: 'craft', item: 'sword', tier: 3 },
      { type: 'build', kind: 'wall', tier: 2, x: 0, y: 1 },
      { type: 'refine', buildingId: 'station-1', fromTier: 2 },
      { type: 'loot', lootId: 'loot-1' },
    ];
    for (const command of commands) {
      expect(parsePlanSpec({ steps: [{ type: 'command', command }] }).steps[0]).toMatchObject({
        command: parseCommand(command),
      });
      expect(() =>
        parsePlanSpec({ steps: [{ type: 'command', command: { ...command, queue: 'append' } }] }),
      ).toThrow();
    }
    for (const command of [{ type: 'equip', item: 'axe:2' }, { type: 'unequip', kind: 'axe' }]) {
      expect(() => parseCommand(command)).toThrow();
      expect(() => parsePlanSpec({ steps: [{ type: 'command', command }] })).toThrow();
    }
    for (const command of [
      { type: 'attack', targetId: 'citizen-1' },
      { type: 'remember', text: 'hi' },
      { type: 'equip', item: 'food:1' },
    ]) {
      expect(() => parsePlanSpec({ steps: [{ type: 'command', command }] })).toThrow();
    }
  });
  it('delivers flat attack syntax and automatic carried-sword guidance', () => {
    const world = createWorld();
    updateKnowledge(world);
    const text = freshContext(observe(world, Object.keys(world.citizens)[0]))[0].content!;
    for (const command of [
      { type: 'attack', targetId: 'known-id' },
    ]) {
      expect(text).toContain(`command(${JSON.stringify(command)})`);
      expect(parseCommand(command)).toEqual(command);
    }
    expect(text).toContain('Attacks likewise use your highest-tier carried sword');
    expect(text).not.toContain('ownState.equipment');
    expect(text).toContain('personally known citizen/building ID');
    expect(text).toContain('current sight/prerequisites checked by execution');
    expect(text).toContain('Unarmed attacks are possible; a sword is not required');
    expect(() => parseCommand({ type: 'equip_sword', tier: 1 })).toThrow();
    expect(() => parseCommand({ type: 'attack', target: { id: 'known-id' } })).toThrow();
  });

  it.each([1, 2, 3, 4, 5, 6])('accepts gather, carried conditions and physical commands at tier %i', (tier) => {
    const commands = [
      { type: 'craft', item: 'sword', tier },
      { type: 'build', kind: 'wall', tier, x: 0, y: 1 },
      { type: 'refine', buildingId: 'station-1', fromTier: tier, direction: 'down' },
    ];
    for (const command of commands)
      expect(parsePlanSpec({ steps: [{ type: 'command', command }] }).steps[0]).toMatchObject({
        command: parseCommand(command),
      });
    expect(parsePlanSpec({ steps: [{
      type: 'gather', resource: 'wood', tier, maxTicks: 600,
      stopWhen: { kind: 'inventory-at-least', item: `wood:${tier}`, quantity: 1 },
    }] }).steps[0]).toMatchObject({ tier });
  });

  it('checks strict root/steps and step count', () => {
    for (const value of [
      null,
      [],
      { steps: [] },
      { steps: Array(13).fill(wait) },
      { steps: [wait], surprise: true },
      { steps: [{ ...wait, queue: 'append' }] },
      { mode: 'bad', steps: [wait] },
    ]) {
      expect(planSpecSchema.safeParse(value).success).toBe(false);
    }
    expect(parsePlanSpec({ steps: Array(12).fill(wait) }).steps).toHaveLength(12);
  });
  it('bounds gather, wait and cumulative explicit budgets', () => {
    const gather = {
      type: 'gather',
      resource: 'fibre',
      tier: 3,
      targetQuantity: 100,
      maxTicks: 9999,
    };
    expect(parsePlanSpec({ steps: [gather, wait] }).steps).toHaveLength(2);
    expect(() => parsePlanSpec({ steps: [gather, { ...wait, ticks: 2 }] })).toThrow(
      /Total wait ticks/,
    );
    expect(
      parsePlanSpec({ steps: [{ ...wait, ticks: MAX_PLAN_BUDGET_TICKS }] }).steps,
    ).toHaveLength(1);
    for (const step of [
      { ...gather, resource: 'gold' },
      { ...gather, tier: MAX_TIER + 1 },
      { ...gather, targetQuantity: 0 },
      { ...gather, targetQuantity: 101 },
      { ...gather, targetQuantity: 1.5 },
      { ...gather, maxTicks: 0 },
      { ...gather, maxTicks: 10001 },
      { ...wait, ticks: 0 },
      { ...wait, ticks: 1.5 },
      { ...wait, ticks: 10001 },
    ])
      expect(() => parsePlanSpec({ steps: [step] })).toThrow();
  });
  it('advertises flat provider steps and gives concise actionable shape feedback', () => {
    const parameters = tools.find((t) => t.function.name === 'draft_plan')!.function
      .parameters as any;
    expect(parameters.properties.steps.items.type).toBe('object');
    expect(parameters.properties.steps.items.anyOf).toBeUndefined();
    expect(parameters.properties.steps.items.properties.command.type).toBe('object');
    expect(parameters.properties.steps.items.properties.stopWhen.type).toBe('object');
    expect(() => parsePlanSpec({ steps: '[]' })).toThrow(/JSON array, not a string/);
    expect(() =>
      parsePlanSpec({
        steps: [{ type: 'gather', gather: { resource: 'wood', tier: 1, maxTicks: 600 } }],
      }),
    ).toThrow(/flat, not nested/);
    expect(
      parsePlanSpec({ steps: [{ type: 'gather', resource: 'wood', tier: 1, maxTicks: 600 }] })
        .steps[0],
    ).toEqual({ type: 'gather', resource: 'wood', tier: 1, maxTicks: 600, onFailure: 'review' });
  });

  it('bounds stop conditions and excludes non-carried keys', () => {
    const conditions = [
      { kind: 'food-runway-below', ticks: 0 },
      { kind: 'food-runway-below', ticks: 10000 },
      { kind: 'health-below', health: 100 },
      { kind: 'health-below', health: 0 },
      { kind: 'inventory-at-least', item: 'wood:3', quantity: 100 },
      { kind: 'inventory-at-least', item: 'sword:2', quantity: 1 },
    ];
    for (const stopWhen of conditions)
      expect(() => parsePlanSpec({ steps: [{ ...wait, stopWhen }] })).not.toThrow();
    for (const stopWhen of [
      { kind: 'food-runway-below', ticks: -1 },
      { kind: 'food-runway-below', ticks: 10001 },
      { kind: 'food-runway-below', ticks: 0.5 },
      { kind: 'health-below', health: 101 },
      { kind: 'health-below', health: -1 },
      ...['building:id', 'gold', `food:${MAX_TIER + 1}`, 'wood', 'axe:1 extra'].map((item) => ({
        kind: 'inventory-at-least',
        item,
        quantity: 1,
      })),
      { kind: 'inventory-at-least', item: 'food:1', quantity: 0 },
      { kind: 'inventory-at-least', item: 'food:1', quantity: 101 },
      { kind: 'health-below', health: 10, extra: true },
    ])
      expect(() => parsePlanSpec({ steps: [{ ...wait, stopWhen }] })).toThrow();
  });
  it('advertises object-root provider parameters and strict approval', () => {
    for (const name of ['draft_plan', 'approve_plan']) {
      const schema = tools.find((tool) => tool.function.name === name)!.function
        .parameters as Record<string, any>;
      expect(schema.type).toBe('object');
      expect(schema.anyOf).toBeUndefined();
      expect(schema.oneOf).toBeUndefined();
      expect(schema.additionalProperties).toBe(false);
    }
    expect(approvePlanSchema.parse({ draftId: 'draft-1' })).toEqual({ draftId: 'draft-1' });
    for (const value of [{ draftId: '' }, { draftId: 1 }, { draftId: 'draft-1', extra: true }])
      expect(approvePlanSchema.safeParse(value).success).toBe(false);
  });
  it('provides balance recipes and durable execution continuity, not drafts', () => {
    const world = createWorld();
    updateKnowledge(world);
    const observation = observe(world, Object.keys(world.citizens)[0]);
    Object.assign(observation.citizen, {
      plan: { ...parsePlanSpec({ steps: [wait] }), id: 'plan-1', approvedTick: 0, stepIndex: 0 },
      planReceipts: [{ planId: 'old-plan', message: 'finished' }],
    });
    const context = freshContext(observation);
    expect(PROMPT_VERSION).toBe('spike2-citizen-directives-17');
    expect(context[0].content).toContain('Choose intentions with set_strategy in one response');
    expect(context[0].content).toContain('Legacy drafts are a debug interface');
    const user = JSON.parse(context[1].content!);
    for (const tier of [1, 2, 3, 4, 5, 6] as const) {
      expect(user.planning.recipes.tools.sword[tier]).toEqual(equipmentRecipe('sword', tier));
      expect(user.planning.recipes.buildings.wall[tier]).toEqual(buildingRecipe('wall', tier));
    }
    expect(user.execution.approvedPlan.id).toBe('plan-1');
    expect(user.execution.planReceipts[0].planId).toBe('old-plan');
    expect(user.execution.draft).toBeUndefined();
  });
});
