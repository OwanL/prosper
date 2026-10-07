import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tickWorld, applyPlan, planningContext } from '../lib/world.mjs';
import { normalizePlan } from '../lib/plans.mjs';

for (const type of ['bake', 'repair']) {
  test(`${type} collects distant inputs before returning to the bakery`, () => {
    const world = createWorld(), c = world.citizens[0];
    world.citizens = [c]; world.blocked = [];
    Object.assign(c, { x: 2, y: 2, food: type === 'bake' ? 0 : 4, wood: 0, hunger: 0, energy: 100, asyncReview: true });
    const site = { id: 'bakery-1', kind: 'bakery', x: 2, y: 2, ownerId: c.id, health: 200, maxHealth: 240, destroyed: false };
    world.buildings = [site]; world.nextBuildingId = 2;
    world.nodes = [
      { id: 'crop-1', kind: 'crop', x: 6, y: 2, stock: 1, capacity: 1, yield: 1, regrowTicks: 99, regrowIn: 0 },
      { id: 'tree-1', kind: 'tree', x: 6, y: 6, stock: 1, capacity: 1, yield: 5, regrowTicks: 120, regrowIn: 0 },
    ];
    c.knowledge.nodes = Object.fromEntries(world.nodes.map(n => [n.id, { ...n, observedAt: 0, source: 'seen' }]));
    tickWorld(world); // Observe the owned site before choosing it.
    applyPlan(world, c.id, normalizePlan({ tasks: [{ type, target: site.id, ...(type === 'bake' ? { amount: 1 } : {}) }], work: null }, planningContext(world, c.id)));
    for (let i = 0; i < 60; i++) tickWorld(world);
    assert.equal(c.resourceHistory['tree-1'].harvested, 5);
    if (type === 'bake') {
      assert.equal(c.resourceHistory['crop-1'].harvested, 1);
      assert.equal(world.stats.baked, 1);
      assert.equal(c.bread, 1);
    } else assert.equal(site.health, 220);
    assert.ok(Math.abs(c.x - site.x) + Math.abs(c.y - site.y) <= 1);
  });
}
