import { expect, it } from 'vitest';
import { createWorld, tickWorld } from '../src/world/core.ts';
import { BALANCE, nutrition } from '../src/world/config.ts';

function citizenWithFood(fullness: number, food: number, tier = 3) {
  const world = createWorld({ seed: 812, population: 1 });
  const citizen = Object.values(world.citizens)[0]!;
  citizen.fullness = fullness;
  citizen.inventory = { [`food:${tier}`]: food };
  return { world, citizen };
}

it('eats an available fractional T3 portion when its proportional nutrition fits the fullness gap', () => {
  const { world, citizen } = citizenWithFood(40, 0.15);
  const before = citizen.fullness;
  tickWorld(world);
  expect(citizen.inventory['food:3'] ?? 0).toBe(0);
  expect(citizen.fullness).toBeCloseTo(before - BALANCE.fullnessDrain + nutrition(3) * 0.15, 9);
  expect(world.events.filter((event) => event.kind === 'meal' && event.citizenId === citizen.id)).toHaveLength(1);
});

it('keeps fractional food until its nutrition fits, while starvation remains a fallback', () => {
  const { world, citizen } = citizenWithFood(99, 0.15);
  const food = citizen.inventory['food:3'];
  tickWorld(world);
  expect(citizen.inventory['food:3']).toBe(food);
  expect(world.events.filter((event) => event.kind === 'meal' && event.citizenId === citizen.id)).toHaveLength(0);

  citizen.fullness = 0;
  const before = citizen.fullness;
  tickWorld(world);
  expect(citizen.inventory['food:3'] ?? 0).toBe(0);
  expect(citizen.fullness).toBeCloseTo(before + nutrition(3) * 0.15, 9);
});

it('keeps whole-unit high-tier meals gated by their full nutrition amount', () => {
  const { world, citizen } = citizenWithFood(40, 1);
  tickWorld(world);
  expect(citizen.inventory['food:3']).toBe(1);
  expect(world.events.filter((event) => event.kind === 'meal' && event.citizenId === citizen.id)).toHaveLength(0);
});

it('debits and restores the exact taxed fractional T1 meal once', () => {
  const { world, citizen } = citizenWithFood(40, 0.85, 1);
  const before = citizen.fullness;
  tickWorld(world);
  expect(citizen.inventory['food:1'] ?? 0).toBe(0);
  expect(citizen.fullness).toBeCloseTo(before - BALANCE.fullnessDrain + nutrition(1) * 0.85, 9);
  expect(world.events.filter((event) => event.kind === 'meal' && event.citizenId === citizen.id)).toHaveLength(1);
});

it('does not consume empty or nonpositive fractional inventory', () => {
  const { world, citizen } = citizenWithFood(40, 0);
  citizen.inventory['food:2'] = -0.15;
  const inventory = { ...citizen.inventory };
  tickWorld(world);
  expect(citizen.inventory).toEqual(inventory);
  expect(world.events.filter((event) => event.kind === 'meal' && event.citizenId === citizen.id)).toHaveLength(0);
});
