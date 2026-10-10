import { describe, expect, it } from 'vitest';
import { MAX_TIER } from '../src/shared/tiers.ts';
import { createWorld, dispatch, tickWorld, cancelAction } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import { freshContext, PROMPT_VERSION } from '../src/citizen/prompt.ts';
import { parseStrategySpec, strategyParameters } from '../src/citizen/directive-schema.ts';
import { commitStrategy } from '../src/world/directives.ts';
import { BALANCE } from '../src/world/config.ts';

const food = {
  type: 'gather' as const,
  resource: 'food' as const,
  tier: 1 as const,
  areas: [[0, 0, 3, 3] as [number, number, number, number]],
};
describe('directive decision guidance', () => {
  it('advertises the same recipient bounds as strict validation and explains public posting', () => {
    const recipient = strategyParameters.properties.communications.items.properties.to;
    expect(recipient).toMatchObject({ minLength: 1, maxLength: 200 });
    expect((recipient as any).description).toContain('omit for public');
    expect(
      parseStrategySpec({ mode: 'keep', communications: [{ text: 'Hello.' }] }).communications?.[0]
        .to,
    ).toBeUndefined();
    expect(() =>
      parseStrategySpec({ mode: 'keep', communications: [{ text: 'Hello.', to: '' }] }),
    ).toThrow(/omit.*public/);
  });

  it('gives craft-specific missing-area advice without guessing permissions', () => {
    expect(() =>
      parseStrategySpec({ mode: 'replace', directives: [{ type: 'craft', item: 'axe', tier: 1 }] }),
    ).toThrow(/craft.*areas.*ingredient/i);
    expect(() =>
      parseStrategySpec({
        mode: 'replace',
        directives: Array.from({ length: 5 }, () => ({ type: 'move', x: 1, y: 1 })),
      }),
    ).toThrow(/four.*preserve.*bounds/i);
  });

  it('teaches sequential ongoing work, ingredient permissions and snapshot uncertainty', () => {
    const world = createWorld({ seed: 1 });
    const citizen = Object.values(world.citizens)[0];
    updateKnowledge(world);
    const messages = freshContext(observe(world, citizen.id));
    const text = messages[0].content!;
    expect(text).toContain('Directives run in listed order');
    expect(text).toContain('At most four remaining directives');
    expect(text).toContain('Craft areas authorize both ingredient gathering and crafting');
    expect(text).toContain('new outputs, not a carried reserve');
    expect(text).toContain('citizen-authored beliefs');
    expect(text).toContain('snapshot at currentWorld.tick');
    const context = JSON.parse(messages[1].content!);
    expect(context.currentWorld.asciiLegend.x).toContain('NOT a wall');
    expect(context.currentWorld.asciiLegend['#']).toContain('wall');
    expect(context.currentWorld.asciiLegend.V.toLowerCase()).toContain('fibre');
  });

  it('makes rivalry, relationships and reproduction actionable without quotas or assumed consent', () => {
    const world = createWorld({ seed: 1 });
    const citizen = Object.values(world.citizens)[0];
    updateKnowledge(world);
    const messages = freshContext(observe(world, citizen.id));
    const text = messages[0].content!;
    expect(text).toContain('Rivalry, companionship, reproduction and influence are live ambitions');
    expect(text).toContain('Do not reflexively split every patch');
    expect(text).toContain('No violence, message or reproduction quota');
    expect(text).toContain('refusal remains valid');
    expect(text).toContain('consent can be withdrawn');
    expect(text).toContain('avoid repetitive status broadcasts');
    expect(text).toContain('Work automatically uses your highest-tier already-carried matching tool');
    expect(text).toContain('work_state_changed');
    const context = JSON.parse(messages[1].content!);
    expect(context.planning.reproduction).toMatchObject({
      foodPerParent: {
        item: `food:${BALANCE.reproductionFoodTier}`,
        quantity: BALANCE.reproductionFood,
      },
      minimumHealthPerParent: BALANCE.reproductionHealth,
      durationTicks: BALANCE.reproductionTicks,
      cooldownTicksPerParent: BALANCE.reproductionCooldown,
      consentDurationTicks: BALANCE.consentTicks,
    });
    expect(context.planning.reproduction.consent).toContain('Messages are not consent');
    expect(context.ownState.consent).toEqual(citizen.consent);
    expect(context.planning.reproduction).not.toHaveProperty('partnerConsent');
  });

  it('delivers v16 conflict and communication guidance on fresh reviews, not evidence of emergence', () => {
    const world = createWorld({ seed: 1 });
    const citizen = Object.values(world.citizens)[0];
    citizen.memories = [
      { tick: world.tick, text: 'I refused a price concession; awaiting a reply.' },
    ];
    updateKnowledge(world);
    for (const review of [0, 1]) {
      if (review) tickWorld(world, 1);
      const messages = freshContext(observe(world, citizen.id));
      const text = messages[0].content!;
      expect(text).toContain(PROMPT_VERSION);
      for (const phrase of [
        'not a friendly assistant, mediator',
        'Default consensus is not your objective',
        'selfish, spiteful or exploitative choices are legitimate roleplay',
        'Do not soften every demand into mutual benefit',
        'self-interest, pride or rivalry',
        'initiating resource, price or status disputes',
        'Exploit bargaining leverage',
        'charge desperate buyers more',
        'withhold help, demand concessions or form conditional alliances',
        'Threats and attacks need not be a last resort or self-defense',
        'demands, refusals, challenges, recruitment offers or ultimatums',
        'selective affection',
        'Match speech to your actual chosen actions',
        'angry broadcasts are not a substitute',
        'Remember actual actions and replies',
      ])
        expect(text).toContain(phrase);
      const context = JSON.parse(messages[1].content!);
      expect(context.personalityMemoriesGoals.personality).toBe(citizen.personality);
      expect(context.personalityMemoriesGoals.memories).toEqual(citizen.memories);
      expect(context.personalityMemoriesGoals.goals).toEqual(citizen.goals);
    }
  });

  it('bounds aggression and bluffing with choice, evidence, consent and accurate outcomes', () => {
    const world = createWorld({ seed: 1 });
    const citizen = Object.values(world.citizens)[0];
    updateKnowledge(world);
    const text = freshContext(observe(world, citizen.id))[0].content!;
    for (const phrase of [
      'private hunger or beliefs are not evidence available to you',
      'Do not invent an insult, grievance, enemy, relationship or territorial ownership',
      'Preserve differences between personalities',
      'not forced goals or attacks',
      'No violence, message or reproduction quota',
      'peaceful or solitary choices remain valid',
      'refusal remains valid',
      'consent can be withdrawn',
      'You may strategically bluff about your intentions',
      'never fabricate tool outcomes, completed actions, history, holdings',
      "another person's private beliefs",
      'store your bluff as your own stated intention/bluff, not as a fact',
      'Do not claim success or store it as fact before receiving',
    ])
      expect(text).toContain(phrase);
  });

  it('delivers audit guidance without imposing gifts, family help or work choices', () => {
    const world = createWorld({ seed: 1 });
    const citizen = Object.values(world.citizens)[0];
    updateKnowledge(world);
    const text = freshContext(observe(world, citizen.id))[0].content!;
    for (const phrase of [
      'communications length <=2',
      'reviewAfter must be 120..10000 ticks',
      'must omit directives or use an empty directives array',
      'append adds new work, not a restatement of retained work',
      'ADDITIONAL new outputs',
      `Tier N matching tools unlock N+1 capped T${MAX_TIER}`,
      `T${MAX_TIER - 1} already unlocks T${MAX_TIER} deposits, while T${MAX_TIER} improves speed`,
      'All T1 wood, fibre and food can be gathered barehanded',
      'the highest matching positive-count tier is used automatically',
      'execution.action.reserved holds work inputs separately',
      'Meals cannot eat those reserved inputs',
      'blocked strategy label alone does not mean that action stopped',
      'do not cancel or replace it solely because of that label',
      'first receive and inspect the prerequisite receipt',
      'Submit simple independent calls together',
      'A delivered message proves only delivery, not its claims',
      'settlement receipts',
      'collection completion',
      'tools from carried inventory and completed craft/transfer receipts',
      'refine completion',
      'Do not claim success or store it as fact before receiving',
      'Voluntary gold gifts are allowed',
      'non-coercion is not a blanket no-gifts rule',
      'not a forced support quota',
      "relatives' hidden hunger/private readiness is not exposed",
    ])
      expect(text).toContain(phrase);
  });

  it('advertises strategy bounds without expanding the schema or requiring work', () => {
    expect(() => parseStrategySpec({ mode: 'keep' })).not.toThrow();
    expect(() => parseStrategySpec({ mode: 'keep', directives: [food] })).toThrow();
    expect(() =>
      parseStrategySpec({
        mode: 'keep',
        communications: Array.from({ length: 3 }, () => ({ text: 'Hi' })),
      }),
    ).toThrow();
    for (const reviewAfter of [120, 10000])
      expect(() => parseStrategySpec({ mode: 'keep', reviewAfter })).not.toThrow();
    for (const reviewAfter of [119, 10001])
      expect(() => parseStrategySpec({ mode: 'keep', reviewAfter })).toThrow();
  });

  it('warns about deferred successors without rejecting or switching ongoing work', () => {
    const world = createWorld({ seed: 1 });
    const citizen = Object.values(world.citizens)[0];
    citizen.x = 1;
    citizen.y = 1;
    updateKnowledge(world);
    const decision = {
      mode: 'replace' as const,
      directives: [food, { type: 'explore' as const, areas: food.areas }],
    };
    const before = structuredClone(decision);
    const result = commitStrategy(world, citizen.id, decision, {
      command: (command) => dispatch(world, citizen.id, command, 'directive'),
      cancel: () => cancelAction(world, citizen.id),
    });
    expect(result.ok).toBe(true);
    expect((result as any).warnings?.[0]).toContain('Directive 1');
    expect((result as any).warnings?.[0]).toContain('later directives wait');
    expect(decision).toEqual(before);
    const context = JSON.parse(freshContext(observe(world, citizen.id))[1].content!);
    expect(context.execution.strategy.warnings).toEqual((result as any).warnings);
    tickWorld(world, 2);
    expect(citizen.strategy?.index).toBe(0);
    expect(citizen.strategy?.directives).toEqual(before.directives);
  });

  it('does not warn when a citizen has chosen a finite or conditional predecessor', () => {
    for (const ending of [
      { quantity: 3 },
      { maxTicks: 200 },
      { stopWhen: { kind: 'inventory-at-least' as const, item: 'food:1', quantity: 3 } },
    ]) {
      const world = createWorld({ seed: 1 });
      const citizen = Object.values(world.citizens)[0];
      updateKnowledge(world);
      const result = commitStrategy(
        world,
        citizen.id,
        {
          mode: 'replace',
          directives: [
            { ...food, ...ending },
            { type: 'explore', areas: food.areas },
          ],
        },
        {
          command: (command) => dispatch(world, citizen.id, command, 'directive'),
          cancel: () => cancelAction(world, citizen.id),
        },
      );
      expect(result.ok).toBe(true);
      expect((result as any).warnings ?? []).toEqual([]);
    }
  });
});
