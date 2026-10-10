import { describe, expect, it } from 'vitest';
import { createWorld, dispatch, cancelAction, tickWorld } from '../src/world/core.ts';
import { updateKnowledge, observe } from '../src/world/observation.ts';
import { commitStrategy, inWorkAreas } from '../src/world/directives.ts';
import { parseStrategySpec, strategyParameters } from '../src/citizen/directive-schema.ts';
import { BALANCE } from '../src/world/config.ts';
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
  citizen.inventory = { 'food:1': 20 };
  citizen.knowledge = {};
  const actions = {
    command: (command: any) => dispatch(world, citizen.id, command, 'directive'),
    cancel: () => cancelAction(world, citizen.id),
  };
  const commit = (spec: StrategySpec) => commitStrategy(world, citizen.id, spec, actions);
  const tick = (count: number) => {
    for (let i = 0; i < count; i++) {
      tickWorld(world);
      updateKnowledge(world);
    }
  };
  const deposit = (
    id: string,
    resource: 'food' | 'wood' | 'fibre',
    x: number,
    y: number,
    stock = 1,
  ) => {
    world.deposits[id] = { id, resource, tier: 1, x, y, stock, capacity: stock, regrowAt: 0 };
    updateKnowledge(world);
  };
  return { world, citizen, commit, tick, deposit };
}
describe('high-level directive execution', () => {
  it('uses compact inclusive rectangle unions and strict actionable schemas', () => {
    expect(inWorkAreas({ x: 5, y: 5 }, [[1, 1, 5, 5]])).toBe(true);
    expect(
      inWorkAreas({ x: 6, y: 5 }, [
        [1, 1, 5, 5],
        [10, 10, 12, 12],
      ]),
    ).toBe(false);
    const spec = parseStrategySpec({
      mode: 'replace',
      directives: [{ type: 'gather', resource: 'wood', tier: 1, areas: [[0, 0, 5, 5]] }],
    });
    expect(spec.reviewAfter).toBe(600);
    expect(() =>
      parseStrategySpec({
        mode: 'replace',
        directives: [{ type: 'gather', resource: 'wood', tier: 1, areas: [[5, 0, 1, 5]] }],
      }),
    ).toThrow(/ordered bounds/);
    expect(() =>
      parseStrategySpec({ mode: 'keep', directives: [{ type: 'move', x: 1, y: 1 }] }),
    ).toThrow(/keep retains/);
    expect(strategyParameters.properties.directives.items.type).toBe('object');
  });
  it('discovers unknown resources within a rectangle and never harvests nearer out-of-area stock', () => {
    const { world, citizen, commit, tick, deposit } = setup();
    deposit('outside', 'wood', 1, 1, 9);
    deposit('inside', 'wood', 8, 1, 2);
    expect(
      observe(world, citizen.id).remembered.some((t) => t.deposits.some((d) => d.id === 'inside')),
    ).toBe(false);
    expect(
      commit({
        mode: 'replace',
        directives: [
          { type: 'gather', resource: 'wood', tier: 1, quantity: 2, areas: [[7, 0, 9, 2]] },
        ],
      }).ok,
    ).toBe(true);
    tick(100);
    expect(citizen.strategy?.status).toBe('completed');
    expect(citizen.inventory['wood:1']).toBe(2);
    expect(world.deposits.outside.stock).toBe(9);
    expect(citizen.x).toBe(8);
  });
  it('continues ongoing gathering across regrowth and past its reflection deadline', () => {
    const { citizen, commit, tick, deposit } = setup();
    deposit('wood', 'wood', 1, 1);
    commit({
      mode: 'replace',
      reviewAfter: 120,
      directives: [{ type: 'gather', resource: 'wood', tier: 1, areas: [[1, 1, 1, 1]] }],
    });
    tick(3 * BALANCE.harvestTicks + 2 * BALANCE.regrowTicks + 1);
    expect(citizen.strategy?.status).toBe('active');
    expect(citizen.inventory['wood:1']).toBeGreaterThanOrEqual(3);
    expect(citizen.directiveReceipts?.some((r) => r.outcome === 'blocked')).toBe(false);
  });
  it('counts new harvests even when automatic eating consumes the outputs', () => {
    const { citizen, commit, tick, deposit } = setup();
    citizen.inventory = {};
    citizen.fullness = 50;
    deposit('food', 'food', 1, 1, 2);
    commit({
      mode: 'replace',
      directives: [
        { type: 'gather', resource: 'food', tier: 1, quantity: 2, areas: [[1, 1, 1, 1]] },
      ],
    });
    tick(2 * BALANCE.harvestTicks + 1);
    expect(citizen.strategy?.status).toBe('completed');
    expect(citizen.inventory['food:1'] ?? 0).toBe(0);
    expect(citizen.fullness).toBeGreaterThan(50);
  });
  it('prepares recipe inputs then repeatedly operates a station across separate rectangles', () => {
    const { world, citizen, commit, tick, deposit } = setup();
    deposit('source', 'wood', 1, 1, 6);
    deposit('not-allowed', 'wood', 4, 1, 9);
    world.buildings.station = {
      id: 'station',
      kind: 'lumbermill',
      tier: 1,
      x: 8,
      y: 1,
      ownerId: citizen.id,
      health: 100,
      maxHealth: 100,
      materials: {},
    };
    citizen.knowledge['8,1'] = {
      x: 8,
      y: 1,
      seenTick: 0,
      citizens: [],
      deposits: [],
      buildings: [{ ...world.buildings.station }],
      loot: [],
    };
    expect(
      commit({
        mode: 'replace',
        directives: [
          {
            type: 'operate',
            buildingId: 'station',
            fromTier: 1,
            quantity: 2,
            areas: [
              [1, 1, 1, 1],
              [8, 1, 8, 1],
            ],
          },
        ],
      }).ok,
    ).toBe(true);
    tick(
      6 * BALANCE.harvestTicks +
        2 * BALANCE.regrowTicks +
        14 * BALANCE.moveTicks +
        2 * BALANCE.refineTicks[1] +
        10,
    );
    expect(citizen.strategy?.status).toBe('completed');
    expect(citizen.inventory['wood:2']).toBe(2);
    expect(world.deposits['not-allowed'].stock).toBe(9);
  });
  it('crafts with automatic input gathering without altering goals', () => {
    const { citizen, commit, tick, deposit } = setup();
    const goals = [...citizen.goals];
    deposit('fibre', 'fibre', 2, 1, 3);
    expect(
      commit({
        mode: 'replace',
        directives: [{ type: 'craft', item: 'axe', tier: 1, areas: [[1, 1, 2, 1]] }],
      }).ok,
    ).toBe(true);
    tick(3 * BALANCE.harvestTicks + BALANCE.moveTicks + BALANCE.craftTicks + 1);
    expect(citizen.inventory['axe:1']).toBe(1);
    expect(citizen.inventory['fibre:1'] ?? 0).toBe(0);
    expect(citizen.goals).toEqual(goals);
  });
  it('reports an actual harvest stall once instead of treating travel between depleted sites as output', () => {
    const { world, citizen, commit, tick, deposit } = setup();
    deposit('west', 'wood', 0, 1, 0);
    deposit('east', 'wood', 8, 1, 0);
    for (const node of Object.values(world.deposits)) {
      node.capacity = 1;
      node.regrowAt = 5000;
    }
    for (const x of [8, 4, 0]) {
      citizen.x = x;
      updateKnowledge(world);
    }
    commit({
      mode: 'replace',
      directives: [{ type: 'gather', resource: 'wood', tier: 1, areas: [[0, 1, 8, 1]] }],
    });
    tick(850);
    expect(citizen.strategy?.status).toBe('blocked');
    expect(citizen.inventory['wood:1'] ?? 0).toBe(0);
    expect(
      citizen.directiveReceipts?.filter((receipt) => receipt.outcome === 'blocked'),
    ).toHaveLength(1);
    expect(citizen.directiveReceipts?.at(-1)?.message).toContain('No harvesting progress');
  });

  it('prepares each batch of inputs for a finite multi-item craft objective', () => {
    const { citizen, commit, tick, deposit } = setup();
    deposit('fibre', 'fibre', 2, 1, 6);
    commit({
      mode: 'replace',
      directives: [{ type: 'craft', item: 'axe', tier: 1, quantity: 2, areas: [[1, 1, 2, 1]] }],
    });
    tick(6 * BALANCE.harvestTicks + BALANCE.moveTicks + 2 * BALANCE.craftTicks + 1);
    expect(citizen.inventory['axe:1']).toBe(2);
    expect(citizen.strategy?.status).toBe('completed');
  });

  it('counts successful harvest completion exactly at the optional deadline', () => {
    const { citizen, commit, tick, deposit } = setup();
    deposit('wood', 'wood', 1, 1);
    commit({
      mode: 'replace',
      directives: [
        {
          type: 'gather',
          resource: 'wood',
          tier: 1,
          quantity: 1,
          maxTicks: BALANCE.harvestTicks,
          areas: [[1, 1, 1, 1]],
        },
      ],
    });
    tick(BALANCE.harvestTicks + 1);
    expect(citizen.inventory['wood:1']).toBe(1);
    expect(citizen.strategy?.status).toBe('completed');
  });

  it('retains an exact in-flight job when keeping or appending and rejects invalid replacement atomically', () => {
    const { citizen, commit, tick, deposit } = setup();
    deposit('wood', 'wood', 1, 1, 3);
    commit({
      mode: 'replace',
      directives: [
        { type: 'gather', resource: 'wood', tier: 1, quantity: 2, areas: [[1, 1, 1, 1]] },
      ],
    });
    tick(4);
    const action = citizen.action;
    const pending = citizen.strategy?.pending;
    expect(commit({ mode: 'keep', memory: 'Continue the chosen work.' }).ok).toBe(true);
    expect(citizen.action).toBe(action);
    expect(commit({ mode: 'append', directives: [{ type: 'move', x: 5, y: 1 }] }).ok).toBe(true);
    expect(citizen.action).toBe(action);
    expect(citizen.strategy?.pending).toBe(pending);
    expect(
      commit({
        mode: 'replace',
        directives: [{ type: 'gather', resource: 'wood', tier: 1, areas: [[0, 0, 100, 100]] }],
      }).ok,
    ).toBe(false);
    expect(citizen.action).toBe(action);
    tick(2 * BALANCE.harvestTicks + 4 * BALANCE.moveTicks + 1);
    expect(citizen.x).toBe(5);
  });
  it('reports an exhausted area once and does not invent another area or strategy', () => {
    const { world, citizen, commit, tick } = setup();
    commit({
      mode: 'replace',
      directives: [{ type: 'gather', resource: 'fibre', tier: 1, areas: [[8, 1, 8, 1]] }],
    });
    tick(100);
    expect(citizen.strategy?.status).toBe('blocked');
    const count = world.events.filter(
      (e) => e.kind === 'directive' && e.text.includes('no personally known'),
    ).length;
    tick(100);
    expect(
      world.events.filter((e) => e.kind === 'directive' && e.text.includes('no personally known')),
    ).toHaveLength(count);
    expect(count).toBe(1);
  });
  it('honors chosen stop conditions without imposing work quotas', () => {
    const { citizen, commit, tick, deposit } = setup();
    deposit('wood', 'wood', 1, 1, 9);
    commit({
      mode: 'replace',
      directives: [
        {
          type: 'gather',
          resource: 'wood',
          tier: 1,
          stopWhen: { kind: 'inventory-at-least', item: 'wood:1', quantity: 1 },
          areas: [[1, 1, 1, 1]],
        },
      ],
    });
    tick(BALANCE.harvestTicks + 1);
    expect(citizen.strategy?.status).toBe('stopped');
    expect(citizen.inventory['wood:1']).toBe(1);
    expect(citizen.action).toBeNull();
  });
  it('requires appropriate carried tools and does not silently buy or craft upgrades', () => {
    const { citizen, commit, tick } = setup();
    commit({
      mode: 'replace',
      directives: [{ type: 'gather', resource: 'wood', tier: 2, areas: [[0, 0, 5, 5]] }],
    });
    tick(3);
    expect(citizen.strategy?.status).toBe('blocked');
    expect(citizen.inventory['axe:1']).toBeUndefined();
  });
  it('retains reproduction consent and counterpart prerequisites', () => {
    const { world, citizen, commit, tick } = setup();
    const partner = {
      ...structuredClone(citizen),
      id: 'partner',
      x: 2,
      consent: {} as Record<string, number>,
      action: null,
      strategy: undefined,
    };
    world.citizens.partner = partner;
    world.initialGold += partner.gold;
    citizen.inventory['food:2'] = BALANCE.reproductionFood;
    partner.inventory['food:2'] = BALANCE.reproductionFood;
    updateKnowledge(world);
    commit({
      mode: 'replace',
      directives: [{ type: 'reproduce', partnerId: 'partner', areas: [[1, 1, 2, 1]] }],
    });
    tick(2);
    expect(citizen.strategy?.status).toBe('blocked');
    expect(Object.values(world.citizens)).toHaveLength(2);
    citizen.consent.partner = world.tick + BALANCE.consentTicks;
    partner.consent[citizen.id] = world.tick + BALANCE.consentTicks;
    commit({
      mode: 'replace',
      directives: [{ type: 'reproduce', partnerId: 'partner', areas: [[1, 1, 2, 1]] }],
    });
    tick(BALANCE.reproductionTicks + 3);
    expect(Object.values(world.citizens)).toHaveLength(3);
    expect(citizen.strategy?.status).toBe('completed');
  });
});
