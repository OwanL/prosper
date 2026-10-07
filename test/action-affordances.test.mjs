import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, applyPlan, tickWorld } from '../lib/world.mjs';
import { createCitizenToolSession } from '../lib/citizen-tools.mjs';
import { observeWorld } from '../lib/knowledge.mjs';
import { resolveInteraction } from '../lib/interactions.mjs';
import { actionAffordances } from '../lib/action-affordances.mjs';

for (const actionTemplates of [false, true]) test(`an equipment ${actionTemplates ? 'template' : 'option'} funds and completes the selected craft without an extra stockpile directive`, () => {
  const world = createWorld({ expanded: false }), c = world.citizens[0];
  world.citizens = [c]; world.blocked = [];
  Object.assign(c, { x: 2, y: 2, food: 20, wood: 0, hunger: 0, energy: 100, asyncReview: true });
  world.nodes = [{ id: 'tree-inputs', kind: 'tree', x: 2, y: 2, capacity: 3, stock: 3, yield: 5, regrowTicks: 120, regrowIn: 0 }];
  observeWorld(world, c);
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: c.id });
  tools.refresh();
  const options = actionTemplates ? tools.execute('get_mechanics', { action: 'equipment' }).nextUpgrades
    : actionAffordances(world, c.id).upgrades;
  const option = options.find(u => (u.item ?? u.directive?.item) === 'tool');
  const selected = option.directive ?? { type: 'craft', item: option.item, level: option.level };
  assert.equal(option.wood, 15);
  assert.equal(tools.execute('commit_strategy', { tasks: [selected], work: null }).ok, true);
  applyPlan(world, c.id, tools.committed.plan);
  for (let i = 0; i < 40 && !c.tool; i++) tickWorld(world);
  assert.equal(c.toolLevel, selected.level);
  assert.equal(c.wood, 0);
  assert.equal(world.stats.harvestedWood, option.wood);
  assert.equal(world.stats.crafted, 1);
  const next = actionAffordances(world, c.id).upgrades.find(u => u.item === 'tool');
  assert.equal(next.level, 2);
  assert.equal(next.wood, 60);
});

test('worn-out weapons expose rebuilding level one rather than a nonexistent next upgrade', () => {
  const world = createWorld({ expanded: false }), [c, target] = world.citizens;
  world.citizens = [c, target]; world.blocked = [];
  Object.assign(c, { x: 2, y: 2, weapon: true, weaponLevel: 3, weaponDurability: 1, tool: true, toolLevel: 3, shoes: true, shoesLevel: 3 });
  Object.assign(target, { x: 3, y: 2 });
  assert.deepEqual(actionAffordances(world, c.id).upgrades, []);
  assert.equal(resolveInteraction(world, c, { type: 'attack', target: target.id }).ok, true);
  const option = actionAffordances(world, c.id).upgrades.find(u => u.item === 'weapon');
  assert.equal(option.level, 1);
  assert.equal(option.wood, 20);
});

test('cost cards do not inspect remote peer goods, equipment, intentions or unseen building updates', () => {
  const world = createWorld({ expanded: false }), [c, peer] = world.citizens;
  c.knowledge.buildings = { remembered: { id: 'remembered', kind: 'bakery', ownerId: c.id, x: 2, y: 2, health: 240,
    maxHealth: 240, observedAt: 0, source: 'seen' } };
  world.buildings = [{ ...c.knowledge.buildings.remembered }];
  const before = actionAffordances(world, c.id);
  assert.ok(before.baking);
  Object.assign(peer, { wood: 987654, food: 987654, weapon: true, weaponLevel: 3, goals: ['PRIVATE_GOAL'] });
  world.buildings[0].health = 0;
  const after = actionAffordances(world, c.id);
  assert.deepEqual(after, before);
  assert.ok(!JSON.stringify(after).includes('987654'));
  assert.ok(!JSON.stringify(after).includes('PRIVATE_GOAL'));
  after.upgrades[0].effect.harvestReduction = 99;
  assert.notEqual(actionAffordances(world, c.id).upgrades[0].effect.harvestReduction, 99);
});
