import { expect, it } from 'vitest';
import { CitizenRunner } from '../src/citizen/runner.ts';
import { foodRisk, foodRunwayTicks, reviewReason, reviewState } from '../src/citizen/planning.ts';
import { createWorld } from '../src/world/core.ts';
import { BALANCE } from '../src/world/config.ts';
import { observe } from '../src/world/observation.ts';

function setup(lead?: number) {
  const world = createWorld({ seed: 42 });
  const citizen = Object.values(world.citizens)[0];
  for (const other of Object.values(world.citizens)) other.nextReviewTick = 10000;
  citizen.inventory = {};
  citizen.fullness = 80;
  citizen.strategy = {
    id: 'strategy-test',
    approvedTick: 0,
    directives: [{ type: 'gather', resource: 'wood', tier: 1, areas: [[0, 0, 2, 2]] }],
    index: 0,
    status: 'active',
    reviewTick: 10000,
    progress: 0,
    lastProgressTick: 0,
    attempted: [],
  };
  citizen.review = reviewState(world, citizen);
  if (lead !== undefined) citizen.review.replanLeadTicks = lead;
  citizen.nextReviewTick = 10000;
  const runway = (ticks: number) => {
    citizen.fullness = ticks * BALANCE.fullnessDrain;
  };
  return { world, citizen, runway };
}
it('warns at runway 400 with a learned lead of 600 without cancelling ongoing work', () => {
  const { world, citizen, runway } = setup(600);
  const strategy = structuredClone(citizen.strategy);
  runway(400);
  expect(foodRunwayTicks(citizen)).toBe(400);
  expect(foodRisk(citizen)).toBe(1);
  expect(reviewReason(world, citizen)).toBe('food runway deteriorated');
  expect(citizen.strategy).toEqual(strategy);
});
it('acknowledges the warning band once, then wakes only for further deterioration', () => {
  const { world, citizen, runway } = setup(600);
  runway(400);
  citizen.review = reviewState(world, citizen);
  for (const ticks of [399, 300, 121, 120, 1]) {
    runway(ticks);
    citizen.strategy!.progress++;
    citizen.strategy!.lastProgressTick = world.tick;
    expect(foodRisk(citizen)).toBe(1);
    expect(reviewReason(world, citizen)).toBeUndefined();
  }
  runway(0);
  expect(foodRisk(citizen)).toBe(2);
  expect(reviewReason(world, citizen)).toBe('food runway deteriorated');
});
it('existing recovery rearming permits a later early warning without scheduling a request', () => {
  const { world, citizen, runway } = setup(600);
  runway(400);
  citizen.review = reviewState(world, citizen);
  const runner = new CitizenRunner(
    {
      world: () => world,
      observe: (id) => observe(world, id),
      command: () => {
        throw new Error('No command expected');
      },
      diagnostic: () => {},
    },
    { mode: 'recorded', recorded: [] },
  );
  runway(800);
  runner.tick(); // Existing runner rearming lowers the acknowledged food-risk band.
  expect(citizen.review.foodRisk).toBe(0);
  expect(reviewReason(world, citizen)).toBeUndefined();
  runway(400);
  expect(reviewReason(world, citizen)).toBe('food runway deteriorated');
  expect(runner.records()).toHaveLength(0);
});
it.each([undefined, 20, 120])('retains the legacy 120-tick floor for lead %s', (lead) => {
  const { world, citizen, runway } = setup(lead);
  runway(121);
  expect(foodRisk(citizen)).toBe(0);
  runway(120);
  expect(foodRisk(citizen)).toBe(1);
  expect(reviewReason(world, citizen)).toBe('food runway deteriorated');
});
it('safe deliberate idleness stays acknowledged without forced work', () => {
  const { world, citizen, runway } = setup(600);
  citizen.strategy!.directives = [];
  citizen.strategy!.status = 'completed';
  runway(800);
  citizen.review = reviewState(world, citizen);
  expect(reviewReason(world, citizen)).toBeUndefined();
  expect(citizen.strategy!.directives).toEqual([]);
});
