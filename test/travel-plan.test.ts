import { describe, expect, it } from 'vitest';
import type { Command, World } from '../src/shared/types.ts';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge, validateKnownCommand } from '../src/world/observation.ts';
import { freshContext } from '../src/citizen/prompt.ts';

function setup() {
  const world = createWorld({ seed: 42 });
  const citizen = Object.values(world.citizens)[0];
  world.citizens = { [citizen.id]: citizen };
  world.deposits = {
    food: { id: 'food', x: 8, y: 2, resource: 'food', tier: 1, stock: 1, capacity: 1, regrowAt: 0 },
  };
  world.buildings = {};
  world.loot = {};
  citizen.x = 8;
  citizen.y = 2;
  citizen.knowledge = {};
  citizen.inventory = {};
  citizen.fullness = 100;
  updateKnowledge(world);
  citizen.x = 1;
  updateKnowledge(world);
  return { world, citizen };
}
function submit(world: World, citizenId: string, command: Command) {
  const gate = validateKnownCommand(world, citizenId, command);
  return gate.ok ? dispatch(world, citizenId, command) : gate;
}
function settle(world: World, citizenId: string) {
  const citizen = world.citizens[citizenId];
  for (let i = 0; i < 100 && (citizen.action || citizen.queue.length); i++) {
    tickWorld(world);
    updateKnowledge(world);
  }
  expect(citizen.action).toBeNull();
  expect(citizen.queue).toEqual([]);
}

describe('travel-then-act citizen plans', () => {
  it('executes a move and remembered harvest in one submitted batch, without another model review', () => {
    const { world, citizen } = setup();
    expect(submit(world, citizen.id, { type: 'move', x: 8, y: 2 }).ok).toBe(true);
    const move = structuredClone(citizen.action);
    expect(
      submit(world, citizen.id, { type: 'harvest', depositId: 'food', queue: 'append' }).ok,
    ).toBe(true);
    expect(citizen.action).toEqual(move);
    expect(citizen.inventory).toEqual({});
    settle(world, citizen.id);
    expect(citizen.inventory['food:1']).toBe(1);
    expect(world.deposits.food.stock).toBe(0);
    expect(world.events.some((e) => e.kind === 'error')).toBe(false);
  });

  it('accepts stale harvest intent identically regardless of remote stock or existence', () => {
    const { world, citizen } = setup();
    submit(world, citizen.id, { type: 'move', x: 8, y: 2 });
    const command: Command = { type: 'harvest', depositId: 'food', queue: 'append' };
    const stocked = validateKnownCommand(world, citizen.id, command);
    world.deposits.food.stock = 0;
    const depleted = validateKnownCommand(world, citizen.id, command);
    delete world.deposits.food;
    const missing = validateKnownCommand(world, citizen.id, command);
    expect(stocked.ok).toBe(true);
    expect(depleted).toEqual(stocked);
    expect(missing).toEqual(stocked);
    expect(citizen.queue).toEqual([]); // Pure gate, no remote inspection or reservation.
  });

  it('reports arrival-time failures and continues later explicitly chosen work', () => {
    const { world, citizen } = setup();
    submit(world, citizen.id, { type: 'move', x: 8, y: 2 });
    expect(
      submit(world, citizen.id, { type: 'harvest', depositId: 'food', queue: 'append' }).ok,
    ).toBe(true);
    submit(world, citizen.id, { type: 'move', x: 9, y: 2, queue: 'append' });
    world.deposits.food.stock = 0;
    settle(world, citizen.id);
    expect(world.events.find((e) => e.kind === 'error')).toMatchObject({
      tick: 14,
      text: expect.stringContaining('depleted'),
    });
    expect(citizen.x).toBe(9);
    expect(citizen.inventory['food:1']).toBeUndefined();
  });

  it('does not remotely activate a deferred target if the preceding move stops short', () => {
    const { world, citizen } = setup();
    submit(world, citizen.id, { type: 'move', x: 2, y: 2 });
    expect(
      submit(world, citizen.id, { type: 'harvest', depositId: 'food', queue: 'append' }).ok,
    ).toBe(true);
    delete world.deposits.food;
    settle(world, citizen.id);
    const failure = world.events.find((e) => e.kind === 'error');
    expect(failure?.text).toContain('last-known coordinates');
    expect(failure?.text).not.toContain('no longer exists');
    expect(citizen.x).toBe(2);
  });

  it('keeps unknown IDs, remote replacements and idle append commands gated', () => {
    const { world, citizen } = setup();
    expect(
      submit(world, citizen.id, { type: 'harvest', depositId: 'food', queue: 'append' }).code,
    ).toBe('outside-sight');
    submit(world, citizen.id, { type: 'move', x: 8, y: 2 });
    expect(
      submit(world, citizen.id, { type: 'harvest', depositId: 'guessed', queue: 'append' }).code,
    ).toBe('unknown-entity');
    expect(
      submit(world, citizen.id, { type: 'harvest', depositId: 'food', queue: 'replace' }).code,
    ).toBe('outside-sight');
    expect(citizen.action?.command.type).toBe('move');
  });

  it('can queue a remembered build site and reserves inputs only after arrival', () => {
    const { world, citizen } = setup();
    citizen.inventory = { 'wood:1': 6, 'fibre:1': 4 };
    submit(world, citizen.id, { type: 'move', x: 9, y: 2 });
    expect(
      submit(world, citizen.id, {
        type: 'build',
        kind: 'lumbermill',
        tier: 1,
        x: 9,
        y: 2,
        queue: 'append',
      }).ok,
    ).toBe(true);
    expect(citizen.inventory).toEqual({ 'wood:1': 6, 'fibre:1': 4 });
    settle(world, citizen.id);
    expect(Object.values(world.buildings)).toEqual([
      expect.objectContaining({ kind: 'lumbermill', x: 9, y: 2, ownerId: citizen.id }),
    ]);
  });

  it.each(['refine', 'loot'] as const)(
    'executes deferred %s after travel with arrival-time validation',
    (type) => {
      const { world, citizen } = setup();
      if (type === 'refine') {
        world.buildings.station = {
          id: 'station',
          kind: 'lumbermill',
          tier: 1,
          x: 8,
          y: 2,
          ownerId: citizen.id,
          health: 100,
          maxHealth: 100,
          materials: {},
        };
        citizen.inventory = { 'wood:1': 3 };
      } else {
        world.loot.body = {
          id: 'body',
          x: 8,
          y: 2,
          citizenName: 'Former citizen',
          gold: 7,
          inventory: { 'fibre:1': 2 },
        };
      }
      citizen.x = 8;
      updateKnowledge(world);
      citizen.x = 1;
      updateKnowledge(world);
      submit(world, citizen.id, { type: 'move', x: 8, y: 2 });
      const command: Command =
        type === 'refine'
          ? { type: 'refine', buildingId: 'station', fromTier: 1, queue: 'append' }
          : { type: 'loot', lootId: 'body', queue: 'append' };
      expect(submit(world, citizen.id, command).ok).toBe(true);
      settle(world, citizen.id);
      expect(citizen.inventory[type === 'refine' ? 'wood:2' : 'fibre:1']).toBe(
        type === 'refine' ? 1 : 2,
      );
      expect(world.events.some((e) => e.kind === 'error')).toBe(false);
    },
  );

  it('preserves deferred travel and work through state serialization', () => {
    const { world, citizen } = setup();
    submit(world, citizen.id, { type: 'move', x: 8, y: 2 });
    expect(
      submit(world, citizen.id, { type: 'harvest', depositId: 'food', queue: 'append' }).ok,
    ).toBe(true);
    tickWorld(world, 4);
    updateKnowledge(world);
    const restored: World = JSON.parse(JSON.stringify(world));
    settle(restored, citizen.id);
    expect(restored.citizens[citizen.id].inventory['food:1']).toBe(1);
    expect(citizen.inventory).toEqual({});
  });

  it('does not accept an unexplored build site just because a move is active', () => {
    const { world, citizen } = setup();
    submit(world, citizen.id, { type: 'move', x: 19, y: 19 });
    expect(
      submit(world, citizen.id, {
        type: 'build',
        kind: 'wall',
        tier: 1,
        x: 19,
        y: 19,
        queue: 'append',
      }).code,
    ).toBe('outside-sight');
    expect(citizen.queue).toEqual([]);
  });

  it('guides citizens to let area directives travel and check prerequisites without a fresh review', () => {
    const { world, citizen } = setup();
    const context = freshContext(observe(world, citizen.id));
    expect(context[0].content).toContain('Prefer area directives, not waypoint lists');
    expect(context[0].content).toContain(
      'Travel and prerequisites are checked locally when work begins',
    );
  });
});
