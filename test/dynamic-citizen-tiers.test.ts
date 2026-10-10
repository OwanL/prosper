import { afterEach, describe, expect, it, vi } from 'vitest';
import { tierConfiguration } from '../src/shared/tiers.ts';

// Exercise a multi-digit progression without changing the production ring count.
afterEach(() => {
  vi.doUnmock('../src/shared/tiers.ts');
  vi.resetModules();
});

describe('citizen tier surfaces follow the shared configuration', () => {
  it.each([6, 11])('supports %i rings in schemas, prompts, meals and scripted harvests', async (ringCount) => {
    vi.resetModules();
    const config = tierConfiguration(ringCount);
    const { maxTier, tiers } = config;
    vi.doMock('../src/shared/tiers.ts', () => ({
      RING_COUNT: ringCount,
      MAX_TIER: maxTier,
      TIERS: tiers,
      tierConfiguration,
      isTier: (value: number) => Number.isInteger(value) && value >= 1 && value <= maxTier,
      CARRIED_ITEM_PATTERN: config.carriedItemPattern,
      CARRIED_ITEM_RE: new RegExp(config.carriedItemPattern),
      EQUIPMENT_ITEM_PATTERN: config.equipmentItemPattern,
      EQUIPMENT_ITEM_RE: new RegExp(config.equipmentItemPattern),
      RESOURCE_ITEM_PATTERN: config.resourceItemPattern,
      RESOURCE_ITEM_RE: new RegExp(config.resourceItemPattern),
      TRADABLE_ITEM_PATTERN: config.tradableItemPattern,
      TRADABLE_ITEM_RE: new RegExp(config.tradableItemPattern),
    }));
    const { commandSchema, parseCommand, legacyTools } = await import('../src/citizen/tools.ts');
    const { autonomyPolicyPatchSchema } = await import('../src/citizen/autonomy-schema.ts');
    const { directiveSchema, strategyParameters } = await import('../src/citizen/directive-schema.ts');
    const { planSpecSchema, draftPlanParameters } = await import('../src/citizen/plan-schema.ts');
    const { freshContext } = await import('../src/citizen/prompt.ts');
    const { strategicContext } = await import('../src/citizen/strategic-context.ts');
    const { providerContext } = await import('../src/citizen/context.ts');
    const { planningContext } = await import('../src/citizen/planning.ts');
    const { scriptedCommands } = await import('../src/citizen/scripted.ts');
    const { createWorld, dispatch, tickWorld } = await import('../src/world/core.ts');
    const { observe } = await import('../src/world/observation.ts');
    const { BALANCE, equipmentRecipe } = await import('../src/world/config.ts');
    const { ringAt } = await import('../src/shared/utils.ts');
    const { validateCheckpoint } = await import('../src/server/checkpoint.ts');

    expect(parseCommand({ type: 'craft', item: 'axe', tier: maxTier })).toMatchObject({ tier: maxTier });
    expect(parseCommand({ type: 'order', side: 'sell', item: `wood:${maxTier}`, quantity: 1, price: 1 }).type).toBe('order');
    expect(commandSchema.safeParse({ type: 'equip', item: `axe:${maxTier}` }).success).toBe(false);
    for (const tier of [0, maxTier + 1, 1.5]) {
      expect(commandSchema.safeParse({ type: 'craft', item: 'axe', tier }).success).toBe(false);
      expect(autonomyPolicyPatchSchema.safeParse({ targetTier: tier }).success).toBe(false);
    }
    expect(commandSchema.safeParse({ type: 'equip', item: `axe:${maxTier + 1}` }).success).toBe(false);
    expect(autonomyPolicyPatchSchema.safeParse({ targetTier: maxTier }).success).toBe(true);
    expect(directiveSchema.safeParse({
      type: 'gather', resource: 'wood', tier: maxTier, areas: [[0, 0, 1, 1]],
      stopWhen: { kind: 'inventory-at-least', item: `wood:${maxTier}`, quantity: 1 },
    }).success).toBe(true);
    expect(planSpecSchema.safeParse({ steps: [
      { type: 'gather', resource: 'food', tier: maxTier, maxTicks: 1 },
      { type: 'command', command: { type: 'craft', item: 'axe', tier: maxTier } },
      { type: 'command', command: { type: 'refine', buildingId: 'mill', fromTier: maxTier, direction: 'down' } },
    ] }).success).toBe(true);
    expect(draftPlanParameters.properties.steps.items.properties.tier.enum).toEqual(tiers);
    expect(new RegExp(draftPlanParameters.properties.steps.items.properties.stopWhen.properties.item.pattern).test(`food:${maxTier}`)).toBe(true);
    const commandParameters = legacyTools.find((tool) => tool.function.name === 'command')!.function.parameters;
    expect(JSON.stringify(commandParameters)).toContain(`down 2..${maxTier}`);
    expect(JSON.stringify(strategyParameters)).toContain(`down accepts 2..${maxTier}`);

    const world = createWorld({ seed: 1 });
    expect(world.ringCount).toBe(ringCount);
    expect(new Set(Object.values(world.deposits).map((d) => ringAt(world, d))).size).toBe(ringCount);
    for (const deposit of Object.values(world.deposits)) {
      const base = ringCount - ringAt(world, deposit);
      expect([base, base + 1]).toContain(deposit.tier);
    }
    expect(BALANCE.buildingHealth[maxTier]).toBe(10 * maxTier ** 2 + 50 * maxTier + 40);
    expect(BALANCE.attackDamage[maxTier]).toBe(6 * maxTier + 6);
    expect(BALANCE.refineTicks[maxTier]).toBe(1);
    const actor = Object.values(world.citizens)[0];
    actor.inventory = equipmentRecipe('axe', maxTier);
    expect(dispatch(world, actor.id, { type: 'craft', item: 'axe', tier: maxTier }).ok).toBe(true);
    expect(validateCheckpoint({ version: 1, savedAt: new Date().toISOString(), world, runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] } }).world.ringCount).toBe(ringCount);
    tickWorld(world, BALANCE.craftTicks);
    expect(actor.inventory[`axe:${maxTier}`]).toBe(1);
    expect(dispatch(world, actor.id, { type: 'order', side: 'sell', item: `axe:${maxTier}`, quantity: 1, price: 5 }).ok).toBe(true);
    const observation = observe(world, actor.id);
    const messages = freshContext(observation);
    expect(messages[0].content).toContain(`tiers T1..T${maxTier}`);
    const promptPlanning = JSON.parse(messages[1].content!).planning;
    expect(promptPlanning.recipes.refine.up.fromTiers).toEqual(tiers.slice(0, -1));
    expect(promptPlanning.recipes.refine.down.fromTiers).toEqual(tiers.slice(1));
    expect(strategicContext(observation)[0].content).toContain(`targetTier 1..${maxTier}`);
    const rows = planningContext(observation).actionTimingTicks.harvestByMatchingToolTier;
    expect(rows.map((row) => row.toolTier)).toEqual([0, ...tiers]);
    expect(rows.at(-1)!.depositTiers).toHaveLength(maxTier);
    expect(rows.at(-1)!.depositTiers1Through6).toEqual(rows.at(-1)!.depositTiers);

    observation.alerts = Array.from({ length: 12 }, (_, i) => ({
      id: `meal-${i}`, tick: i, kind: 'meal', text: `Ate T${maxTier} food.`, audience: [],
    }));
    observation.alerts.push({ id: 'unknown', tick: 0, kind: 'meal', text: `Ate T${maxTier + 1} food.`, audience: [] });
    expect(providerContext(observation).alerts).toHaveLength(9);
    expect(providerContext(observation).alerts.at(-1)!.id).toBe('unknown');

    const citizen = observation.citizen;
    citizen.action = null;
    citizen.plan = undefined;
    citizen.queue = [];
    citizen.fullness = 100;
    citizen.inventory = Object.fromEntries(tiers.slice(0, -1).flatMap((tier) =>
      ['axe', 'scythe', 'knife'].map((kind) => [`${kind}:${tier}`, 1]),
    ));
    observation.remembered = [];
    observation.visible = [{ x: citizen.x, y: citizen.y, seenTick: 0, citizens: [], buildings: [], loot: [], deposits: [
      { id: 'top-tier', x: citizen.x, y: citizen.y, resource: 'wood', tier: maxTier, stock: 1, capacity: 1, regrowAt: 0 },
    ] }];
    expect(scriptedCommands(observation)).toEqual([{ type: 'harvest', depositId: 'top-tier' }]);
  });
});
