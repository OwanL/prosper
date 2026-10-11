import { describe, expect, it } from 'vitest';
import { commandSchema, parseCommand, tools } from '../src/citizen/tools.ts';
import { freshContext } from '../src/citizen/prompt.ts';
import { createWorld } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';

describe('provider command schema', () => {
  it('advertises a root object with a required action discriminator and every action', () => {
    const parameters = tools.find((tool) => tool.function.name === 'command')!.function
      .parameters as Record<string, any>;
    expect(parameters.type).toBe('object');
    expect(parameters.required).toEqual(['type']);
    expect(parameters.anyOf).toBeUndefined();
    expect(parameters.oneOf).toBeUndefined();
    expect(parameters.properties.type.enum).toEqual(
      commandSchema.options.map((s) => s.shape.type.value).filter(type => type !== 'consent'),
    );
    expect(parameters.properties.type.enum).not.toContain('consent');
    expect(parameters.properties.type.enum).not.toContain('equip');
    expect(parameters.properties.type.enum).not.toContain('unequip');
    expect(parameters.properties.kind.enum).toEqual(['lumbermill', 'spinning-wheel', 'butchery', 'wall']);
    expect(parameters.properties.depositId.type).toBe('string');
    expect(parameters.properties.x.type).toBe('integer');
    expect(parameters.additionalProperties).toBe(false);
    expect(tools.map((tool) => tool.function.name)).toEqual([
      'set_strategy',
      'command',
      'query_tile',
    ]);
  });

  it.each(['cmd', 'command', 'action'])(
    'rejects saved missing-type shape using %s with an exact correction',
    (alias) => {
      expect(() => parseCommand({ [alias]: 'harvest', depositId: 'deposit-1' })).toThrow(
        /Missing required field "type".*not aliases.*Example:.*"type":"harvest","depositId"/,
      );
    },
  );

  it('corrects coordinate harvests without silently converting or dropping fields', () => {
    expect(() => parseCommand({ type: 'harvest', x: 2, y: 3 })).toThrow(
      /harvest:.*depositId.*entityIndex.*"type":"harvest","depositId"/,
    );
    expect(() => parseCommand({ type: 'harvest', depositId: 'deposit-1', x: 2, y: 3 })).toThrow(
      /Unrecognized.*x.*y/,
    );
    expect(parseCommand({ type: 'harvest', depositId: 'deposit-1' })).toEqual({
      type: 'harvest',
      depositId: 'deposit-1',
    });
  });

  it.each([{ type: 'equip', item: 'axe:1' }, { type: 'unequip', kind: 'axe' }])('rejects removed tool setup command %j', (command) => {
    expect(commandSchema.safeParse(command).success).toBe(false);
    expect(() => parseCommand(command)).toThrow(/Unsupported command type/);
  });

  it('rejects help and gives available actions and a valid example', () => {
    expect(() => parseCommand({ type: 'help' })).toThrow(
      /Unsupported command type "help".*move, harvest.*Example:.*"type":"move"/,
    );
  });

  it('reports subtype missing fields and invalid values precisely', () => {
    expect(() => parseCommand({ type: 'move', x: 1 })).toThrow(/move:.*y.*Example:.*"y":/);
    expect(() =>
      parseCommand({ type: 'order', side: 'sell', item: 'wood:1', quantity: 0, price: 1 }),
    ).toThrow(/order:.*quantity/);
  });

  it('explains gold-only remote orders without barter or trade meetups', () => {
    const world = createWorld();
    updateKnowledge(world);
    const prompt = freshContext(observe(world, Object.keys(world.citizens)[0]));
    const guidance = prompt[0].content!;
    expect(guidance).toContain('without travel or barter');
    expect(guidance).toContain('No direct item transfers');
    expect(guidance).toContain('an empty book does not prevent placing an order');
    expect(guidance).toContain('Transfers are unconditional gold gifts, not purchases');
    expect(guidance).toContain('"type":"order","side":"buy"');
    const parameters = tools.find((tool) => tool.function.name === 'command')!.function
      .parameters as Record<string, any>;
    expect(parameters.properties.side.description).toContain('global');
    expect(parameters.properties.gold.description).toContain('no goods');
  });

  it('uses actual indexed IDs in prompt examples, not guessed IDs', () => {
    const world = createWorld();
    updateKnowledge(world);
    const id = Object.keys(world.citizens)[0];
    const observation = observe(world, id);
    const deposit = observation.visible.flatMap((tile) => tile.deposits)[0];
    expect(deposit).toBeDefined();
    const prompt = freshContext(observation);
    expect(prompt[0].content).toContain('"type":"harvest","depositId":"' + deposit.id + '"');
    expect(prompt[0].content).toContain('flat object and required type');
  });
});
