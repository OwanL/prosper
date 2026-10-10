import { describe, expect, it } from 'vitest';
import { cancelAction, createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { commitStrategy } from '../src/world/directives.ts';
import { updateKnowledge } from '../src/world/observation.ts';
import type { StrategySpec } from '../src/shared/directive-types.ts';

function setup() {
  const world = createWorld({ seed: 2 });
  const citizen = Object.values(world.citizens)[0];
  world.citizens = { [citizen.id]: citizen };
  world.initialGold = citizen.gold;
  world.buildings = {};
  world.deposits = {};
  world.orders = {};
  world.events = [];
  citizen.x = 1;
  citizen.y = 1;
  citizen.inventory = {};
  citizen.knowledge = {};
  updateKnowledge(world);
  const commit = (spec: StrategySpec) =>
    commitStrategy(world, citizen.id, spec, {
      command: (command) => dispatch(world, citizen.id, command, 'directive'),
      cancel: () => cancelAction(world, citizen.id),
    });
  return { world, citizen, commit };
}

describe('directive execution feedback', () => {
  it('scopes fully observed exploration to the exact rectangle union', () => {
    const { world, citizen, commit } = setup();
    const areas: [number, number, number, number][] = [
      [0, 0, 1, 1],
      [2, 1, 2, 1],
    ];
    expect(commit({ mode: 'replace', directives: [{ type: 'explore', areas }] }).ok).toBe(true);
    tickWorld(world);
    const receipt = citizen.directiveReceipts?.at(-1);
    expect(receipt?.outcome).toBe('completed');
    expect(receipt?.message).toContain('[[0,0,1,1],[2,1,2,1]]');
    expect(receipt?.message).toContain('fully observed');
    expect(receipt?.message).toContain('not establish enclosure or global resource absence');
  });

  it('distinguishes unseen destinations after failed moves from full observation', () => {
    const { world, citizen, commit } = setup();
    // A local wall enclosure makes this unseen destination unreachable. Feedback
    // must not identify the wall (or any cause) from the global pathfinder result.
    for (const [x, y] of [
      [0, 1],
      [2, 1],
      [1, 0],
      [1, 2],
    ]) {
      const id = `wall-${x}-${y}`;
      world.buildings[id] = {
        id,
        kind: 'wall',
        tier: 1,
        x,
        y,
        ownerId: null,
        health: 100,
        maxHealth: 100,
        materials: {},
      };
    }
    expect(
      commit({ mode: 'replace', directives: [{ type: 'explore', areas: [[8, 8, 8, 8]] }] }).ok,
    ).toBe(true);
    tickWorld(world);
    expect(citizen.strategy?.status).toBe('completed'); // Existing lifecycle unchanged.
    const message = citizen.directiveReceipts?.at(-1)?.message;
    expect(message).toContain('[[8,8,8,8]]');
    expect(message).toContain('1 unseen tiles remain');
    expect(message).not.toContain('fully observed');
    expect(message).not.toMatch(/wall|walled/);
  });

  it('scopes exploration interrupted by an actual route failure', () => {
    const { world, citizen, commit } = setup();
    expect(
      commit({ mode: 'replace', directives: [{ type: 'explore', areas: [[8, 8, 8, 8]] }] }).ok,
    ).toBe(true);
    tickWorld(world);
    expect(citizen.action?.command.type).toBe('move');
    for (const [x, y] of [
      [0, 1],
      [2, 1],
      [1, 0],
      [1, 2],
    ]) {
      const id = `obstacle-${x}-${y}`;
      world.buildings[id] = {
        id,
        kind: 'wall',
        tier: 1,
        x,
        y,
        ownerId: null,
        health: 100,
        maxHealth: 100,
        materials: {},
      };
    }
    tickWorld(world, 20);
    expect(citizen.strategy?.status).toBe('blocked');
    const message = citizen.directiveReceipts?.at(-1)?.message;
    expect(message).toContain('Route became blocked');
    expect(message).toContain('authorized rectangles [[8,8,8,8]]');
    expect(message).toContain('does not establish full observation, enclosure');
    expect(message).not.toMatch(/wall|walled/);
  });

  it('identifies the parent craft and missing food without gathering outside permissions', () => {
    const { world, citizen, commit } = setup();
    citizen.inventory = { 'food:1': 1, 'fibre:1': 3 };
    world.deposits.outside = {
      id: 'outside',
      resource: 'food',
      tier: 1,
      x: 2,
      y: 1,
      stock: 5,
      capacity: 5,
      regrowAt: 0,
    };
    updateKnowledge(world);
    expect(
      commit({
        mode: 'replace',
        directives: [
          { type: 'explore', areas: [[1, 1, 1, 1]] },
          { type: 'craft', item: 'axe', tier: 1, areas: [[1, 1, 1, 1]] },
        ],
      }).ok,
    ).toBe(true);
    tickWorld(world, 2);
    expect(citizen.strategy?.status).toBe('blocked');
    const receipt = citizen.directiveReceipts?.at(-1);
    expect(receipt?.index).toBe(1);
    expect(receipt?.message).toContain('Preparing craft directive index 1');
    expect(receipt?.message).toContain('food:1 required 3, currently available 1');
    expect(receipt?.message).toContain('[[1,1,1,1]]');
    expect(receipt?.message).toContain('no personally known food:1 supply');
    expect(receipt?.message).toContain('buy inputs explicitly');
    expect(world.deposits.outside.stock).toBe(5);
    expect(citizen.action).toBeNull();
  });
});
