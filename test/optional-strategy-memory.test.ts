import { describe, expect, it } from 'vitest';
import { parseStrategySpec, strategyParameters } from '../src/citizen/directive-schema.ts';
import { BALANCE } from '../src/world/config.ts';
import { createWorld, dispatch, cancelAction } from '../src/world/core.ts';
import { commitStrategy } from '../src/world/directives.ts';
import type { StrategySpec } from '../src/shared/directive-types.ts';

const marker = '[trimmed]';
const foodDecision: StrategySpec = {
  mode: 'replace',
  reviewAfter: 120,
  directives: [{ type: 'gather', resource: 'food', tier: 1, quantity: 4, areas: [[0, 0, 2, 2]] }],
  goals: ['Choose my own food supply'],
  communications: [{ text: 'Gathering food.' }],
};
function setup() {
  const world = createWorld({ seed: 2 });
  const citizen = Object.values(world.citizens)[0];
  const actions = {
    command: (command: Parameters<typeof dispatch>[2]) =>
      dispatch(world, citizen.id, command, 'directive'),
    cancel: () => cancelAction(world, citizen.id),
  };
  const commit = (input: unknown) =>
    commitStrategy(world, citizen.id, input as StrategySpec, actions);
  return { world, citizen, commit };
}

describe('optional strategy memory normalization', () => {
  it('trims only an oversized note with an explicit marker and preserves raw input', () => {
    const memory = 'n'.repeat(BALANCE.memoryLength + 150);
    const input = { ...foodDecision, memory };
    const original = structuredClone(input);
    const parsed = parseStrategySpec(input);
    expect(parsed.memory).toBe('n'.repeat(BALANCE.memoryLength - marker.length) + marker);
    expect(parsed.memory).toHaveLength(BALANCE.memoryLength);
    expect({ ...parsed, memory: input.memory }).toEqual(original);
    expect(input).toEqual(original);
    expect(strategyParameters.properties.memory.maxLength).toBe(BALANCE.memoryLength);
  });

  it.each(['short note', ' ', 'n'.repeat(BALANCE.memoryLength)])(
    'keeps a valid short note identical',
    (memory) => {
      expect(parseStrategySpec({ ...foodDecision, memory }).memory).toBe(memory);
    },
  );

  it('keeps omitted optional memory omitted', () => {
    expect(parseStrategySpec(foodDecision)).not.toHaveProperty('memory');
  });

  it('accepts bounded raw notes but rejects more than 8000 characters', () => {
    expect(parseStrategySpec({ ...foodDecision, memory: 'n'.repeat(8000) }).memory).toHaveLength(
      BALANCE.memoryLength,
    );
    expect(() => parseStrategySpec({ ...foodDecision, memory: 'n'.repeat(8001) })).toThrow(
      /memory/,
    );
  });

  it('commits food-first work and stores the explicitly trimmed note', () => {
    const { citizen, commit } = setup();
    const input = { ...foodDecision, memory: 'n'.repeat(BALANCE.memoryLength + 150) };
    const original = structuredClone(input);
    const result = commit(input);
    expect(result.ok).toBe(true);
    expect(result.metadataResults?.every((receipt) => receipt.ok)).toBe(true);
    expect(citizen.strategy?.directives).toEqual(foodDecision.directives);
    expect(citizen.goals).toEqual(foodDecision.goals);
    expect(citizen.memories.at(-1)?.text).toBe(
      'n'.repeat(BALANCE.memoryLength - marker.length) + marker,
    );
    expect(citizen.memories.at(-1)?.text).toHaveLength(BALANCE.memoryLength);
    expect(input).toEqual(original);
  });

  it.each([
    { ...foodDecision, memory: '' },
    { ...foodDecision, memory: 12 },
    { ...foodDecision, memory: null },
    { ...foodDecision, memory: 'n'.repeat(8001) },
    { ...foodDecision, memory: 'n'.repeat(700), mode: undefined },
    {
      ...foodDecision,
      memory: 'n'.repeat(700),
      directives: [{ type: 'gather', resource: 'food', tier: 1 }],
    },
    { ...foodDecision, memory: 'n'.repeat(700), goals: ['g'.repeat(BALANCE.goalLength + 1)] },
    { ...foodDecision, memory: 'n'.repeat(700), communications: [{ text: '' }] },
    { ...foodDecision, memory: 'n'.repeat(700), unexpected: true },
  ])('rejects other invalid shapes atomically without changing existing work', (input) => {
    const { world, citizen, commit } = setup();
    expect(commit({ mode: 'replace', directives: [{ type: 'move', x: 1, y: 1 }] }).ok).toBe(true);
    dispatch(world, citizen.id, { type: 'move', x: 2, y: 2 }, 'directive');
    const before = structuredClone(world);
    const original = structuredClone(input);
    expect(() => parseStrategySpec(input)).toThrow(/Invalid strategy/);
    expect(commit(input)).toMatchObject({ ok: false, code: 'invalid-strategy' });
    expect(world).toEqual(before);
    expect(input).toEqual(original);
  });
});
