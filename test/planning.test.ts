import { describe, expect, it } from 'vitest';
import { CitizenRunner } from '../src/citizen/runner.ts';
import { foodRisk, planningContext, reviewReason, reviewState } from '../src/citizen/planning.ts';
import { freshContext } from '../src/citizen/prompt.ts';
import { createWorld, dispatch } from '../src/world/core.ts';
import { observe } from '../src/world/observation.ts';
import { event, id } from '../src/shared/utils.ts';
import { TIERS } from '../src/shared/tiers.ts';
import { harvestDuration } from '../src/world/config.ts';

function setup() {
  const world = createWorld({ seed: 42 });
  const [citizen, other] = Object.values(world.citizens);
  for (const c of Object.values(world.citizens)) c.nextReviewTick = 10000;
  citizen.nextReviewTick = 0;
  expect(dispatch(world, citizen.id, { type: 'move', x: 20, y: 20 }).ok).toBe(true);
  const runner = new CitizenRunner(
    {
      world: () => world,
      observe: (c) => observe(world, c),
      command: (c, command) => dispatch(world, c, command),
      diagnostic: () => {},
    },
    {
      contextMode: 'legacy', mode: 'recorded',
      recorded: Array.from({ length: 5 }, () => ({
        citizenId: citizen.id,
        responses: [{ content: 'Keep the current plan.' }],
      })),
    },
  );
  return { world, citizen, other, runner };
}

describe('advisory planning horizon and work-driven reviews', () => {
  it('provides balance-derived timings and food costs without setting goals or a queue quota', () => {
    const { world, citizen } = setup();
    citizen.inventory = { 'food:1': 1 };
    citizen.fullness = 20;
    const before = structuredClone(citizen);
    const observation = observe(world, citizen.id);
    const planning = planningContext(observation, 7);
    expect(planning).toMatchObject({
      minimumReviewCooldownTicks: 7,
      actionTimingTicks: {
        movePerOrthogonalStep: 2,
        craft: 8,
        build: 16,
        refineByStationTier: { 1: 9, 2: 6, 3: 3, 4: 2, 5: 1, 6: 1 },
        attackPerStrike: 8,
        loot: 4,
        reproduction: 24,
        regrowthAfterHarvest: 120,
      },
      food: { availableFoodRunwayTicks: 311 },
    });
    const harvestRows = planning.actionTimingTicks.harvestByMatchingToolTier;
    expect(harvestRows.map((row) => row.toolTier)).toEqual([0, ...TIERS]);
    expect(harvestRows.map((row) => row.depositTiers1Through6)).toEqual(
      [0, ...TIERS].map((toolTier) =>
        TIERS.map((tier) => tier > toolTier + 1 ? null : harvestDuration(tier, toolTier)),
      ),
    );
    // Retain explicit low-tier timing evidence alongside the procedural table.
    expect(harvestRows.slice(0, 7).map((row) => row.depositTiers1Through6.slice(0, 6))).toEqual([
      [40, null, null, null, null, null],
      [20, 40, null, null, null, null],
      [12, 20, 40, null, null, null],
      [12, 12, 20, 40, null, null],
      [12, 12, 12, 20, 40, null],
      [12, 12, 12, 12, 20, 40],
      [12, 12, 12, 12, 12, 20],
    ]);
    for (const row of harvestRows)
      expect(row.depositTiers1Through3).toEqual(row.depositTiers1Through6.slice(0, 3));
    expect(planning).not.toHaveProperty('targetWorkTicks');
    expect(planning.scheduling).toContain('reviews do not cancel work');
    const context = freshContext(observation, 7);
    expect(context[0].content).toContain('Omit quantity/maxTicks for ongoing routines');
    expect(JSON.parse(context[1].content!).planning).toMatchObject(planning);
    expect(citizen).toEqual(before);
  });

  it('does not review busy citizens at 12 or 120 ticks, but reviews after even a short plan ends', async () => {
    const { world, citizen, runner } = setup();
    await runner.startTurn(citizen.id);
    const action = structuredClone(citizen.action);
    for (const tick of [12, 120, 500]) {
      world.tick = tick;
      runner.tick();
      expect(runner.records()).toHaveLength(1);
    }
    expect(citizen.action).toEqual(action);
    citizen.action = null;
    world.tick++;
    runner.tick();
    expect(runner.records()).toHaveLength(2);
    expect(runner.records()[1].reason).toBe('work queue empty');
    await runner.startTurn(citizen.id);
    world.tick += 12;
    runner.tick(); // Choosing no physical work is also valid; retry after the idle cooldown.
    expect(runner.records()).toHaveLength(3);
    await runner.startTurn(citizen.id);
  });

  it('accepts a short plan ending well before the advisory horizon', async () => {
    const { world, citizen, runner } = setup();
    const goals = [...citizen.goals];
    await runner.startTurn(citizen.id);
    citizen.action = null;
    world.tick = 12;
    runner.tick();
    expect(runner.records()).toHaveLength(2);
    expect(runner.records()[1].reason).toBe('work queue empty');
    await runner.startTurn(citizen.id);
    expect(citizen.queue).toEqual([]);
    expect(citizen.goals).toEqual(goals);
  });

  it('wakes once for delivered personal changes, not public chatter or unrelated hidden events', async () => {
    const { world, citizen, other, runner } = setup();
    await runner.startTurn(citizen.id);
    world.tick = 12;
    event(world, 'error', 'Someone else failed.', { audience: [other.id] });
    world.messages.push({
      id: id(world, 'message'),
      tick: world.tick,
      from: other.id,
      text: 'Public chatter',
    });
    runner.tick();
    expect(runner.records()).toHaveLength(1);
    world.messages.push({
      id: id(world, 'message'),
      tick: world.tick,
      from: other.id,
      to: citizen.id,
      text: 'Can we trade?',
    });
    runner.tick();
    expect(runner.records()).toHaveLength(2);
    expect(runner.records()[1].reason).toBe('direct message received');
    await runner.startTurn(citizen.id);
    world.tick += 12;
    runner.tick();
    expect(runner.records()).toHaveLength(2);
    expect(citizen.action).not.toBeNull();
    for (const kind of ['error', 'trade', 'attack']) {
      event(world, kind, 'New personal information', {
        citizenId: other.id,
        audience: [citizen.id],
      });
      expect(reviewReason(world, citizen)).toBe(`personal ${kind} alert`);
      citizen.review = reviewState(world, citizen);
      expect(reviewReason(world, citizen)).toBeUndefined();
    }
  });

  it('warns on worsening food risk, rearms after recovery, and preserves acknowledgements across JSON restore', async () => {
    const { world, citizen, runner } = setup();
    citizen.inventory = {};
    citizen.fullness = 13;
    await runner.startTurn(citizen.id);
    world.tick = 12;
    citizen.fullness = 11;
    expect(reviewReason(world, citizen)).toBe('food runway deteriorated');
    runner.tick();
    await runner.startTurn(citizen.id);
    const restored = JSON.parse(JSON.stringify(world));
    expect(reviewReason(restored, restored.citizens[citizen.id])).toBeUndefined();
    world.tick += 12;
    runner.tick();
    expect(runner.records()).toHaveLength(2);
    citizen.fullness = 20;
    runner.tick();
    expect(citizen.review?.foodRisk).toBe(0);
    citizen.fullness = 11;
    expect(reviewReason(world, citizen)).toBe('food runway deteriorated');
    citizen.review = reviewState(world, citizen);
    citizen.fullness = 0;
    expect(foodRisk(citizen)).toBe(2);
    expect(reviewReason(world, citizen)).toBe('food runway deteriorated');
  });
});
