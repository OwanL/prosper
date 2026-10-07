import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tickWorld, applyPlan } from '../lib/world.mjs';
import { createCitizenToolSession } from '../lib/citizen-tools.mjs';
import { observeWorld, shareKnowledgeWith } from '../lib/knowledge.mjs';

const plan = (tasks = [], work = null) => ({ thought: 'Use the selected resources.', goals: ['Test resource access'],
  memory: '', routine: { family: false }, tasks, work, reviewAfter: 600 });
const ticks = (world, count) => { for (let i = 0; i < count; i++) tickWorld(world); };
const toolsFor = (world, actor) => {
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: actor.id });
  tools.refresh(); return tools;
};

test('every quality level produces its entire bundle with identical effort and regrowth', () => {
  for (const kind of ['crop', 'tree']) for (const level of [1, 2, 3]) {
    const world = createWorld(), actor = world.citizens[0];
    const node = world.nodes.find(n => n.kind === kind && n.level === level);
    world.nodes = [node]; world.citizens = [actor];
    Object.assign(actor, { x: node.x, y: node.y, food: 20, wood: 0, hunger: 0, energy: 100, asyncReview: true });
    observeWorld(world, actor);
    const resource = kind === 'crop' ? 'food' : 'wood', effort = kind === 'crop' ? 6 : 8;
    const before = actor[resource];
    applyPlan(world, actor.id, plan([{ type: 'gather', resource, amount: 1, target: node.id }]));
    ticks(world, effort - 1);
    assert.equal(actor[resource], before, `${kind} L${level} is still harvesting`);
    tickWorld(world);
    assert.equal(actor[resource] - before, level * (kind === 'crop' ? 1 : 5));
    assert.equal(world.stats[kind === 'crop' ? 'harvestedFood' : 'harvestedWood'], node.yield);
    assert.equal(actor.order.progress, node.yield, 'bounded collection may overshoot by a full bundle');
    assert.equal(node.stock, 0, 'one harvest opportunity consumed');
    assert.equal(node.regrowIn, kind === 'crop' ? 99 : 120);
    ticks(world, node.regrowTicks - 1);
    assert.equal(node.stock, 0);
    tickWorld(world);
    assert.equal(node.stock, 1, 'same regrowth period at every level');
  }
});

test('automatic collection and queries compare observed yield, retaining explicit distance ranking', () => {
  const world = createWorld({ expanded: false }), actor = world.citizens[0];
  world.citizens = [actor]; world.blocked = [];
  Object.assign(actor, { x: 2, y: 2, food: 20, hunger: 0, energy: 100, asyncReview: true });
  world.nodes = [
    { id: 'crop-poor', kind: 'crop', x: 2, y: 2, level: 1, yield: 1, stock: 1, capacity: 1, regrowTicks: 99, regrowIn: 0 },
    { id: 'crop-rich', kind: 'crop', x: 4, y: 2, level: 3, yield: 3, stock: 1, capacity: 1, regrowTicks: 99, regrowIn: 0 },
  ];
  actor.knowledge.nodes = {}; observeWorld(world, actor);
  const tools = toolsFor(world, actor), candidates = tools.execute('find_resources', { resource: 'food' });
  assert.deepEqual(candidates.items.map(n => n.id), ['crop-rich', 'crop-poor']);
  assert.deepEqual(candidates.items.map(n => n.preferenceCostTicks), [8 / 3, 6]);
  assert.equal(candidates.items[0].level, 3);
  assert.equal(candidates.items[0].yield, 3);
  assert.deepEqual(tools.execute('find_resources', { resource: 'food', rank: 'distance' }).items.map(n => n.id), ['crop-poor', 'crop-rich']);
  applyPlan(world, actor.id, plan([{ type: 'gather', resource: 'food', amount: 1 }]));
  ticks(world, 12);
  assert.equal(actor.food, 23);
  assert.equal(world.nodes[0].stock, 1, 'nearest low-yield site remains untouched');
  assert.equal(actor.resourceHistory['crop-rich'].harvested, 3);
});

test('quality reports preserve observation age and do not reveal remote changes', () => {
  const world = createWorld(), sender = world.citizens[0], recipient = world.citizens[4];
  const node = world.nodes.find(n => n.kind === 'crop' && n.level === 3);
  Object.assign(sender, { x: node.x, y: node.y }); observeWorld(world, sender);
  assert.equal(shareKnowledgeWith(world, sender, recipient, [node.id]).ok, true);
  const tools = toolsFor(world, recipient);
  const before = tools.execute('find_resources', { resource: 'food', area: 'center' });
  assert.equal(before.items[0].level, 3);
  assert.equal(before.items[0].yield, 3);
  assert.equal(before.items[0].source, 'report');
  Object.assign(node, { stock: 0, yield: 999, level: 1 });
  world.tick = 10;
  const after = tools.execute('find_resources', { resource: 'food', area: 'center' });
  assert.equal(after.items[0].observedStock, 1);
  assert.equal(after.items[0].yield, 3);
  assert.equal(after.items[0].level, 3);
  assert.equal(recipient.knowledge.nodes[node.id].observedAt, 0);
});

test('a contested high-quality opportunity pays only the successful harvester', () => {
  const world = createWorld(), [first, second] = world.citizens;
  const node = world.nodes.find(n => n.kind === 'crop' && n.level === 3);
  world.citizens = [first, second]; world.nodes = [node];
  for (const actor of world.citizens) {
    Object.assign(actor, { x: node.x, y: node.y, food: 20, hunger: 0, energy: 100, asyncReview: true });
    observeWorld(world, actor);
    applyPlan(world, actor.id, plan([{ type: 'gather', resource: 'food', amount: 1, target: node.id, camp: true }]));
  }
  ticks(world, 6);
  assert.equal(first.food + second.food, 43);
  assert.equal(world.stats.harvestedFood, 3);
  assert.equal(node.stock, 0);
  assert.equal(second.resourceHistory[node.id].lostRaces, 1);
});

test('eight native foragers survive repeated depletion on the sparser map', () => {
  const world = createWorld();
  for (const actor of world.citizens) {
    actor.asyncReview = true;
    applyPlan(world, actor.id, plan([], { type: 'gather', resource: 'food' }));
  }
  ticks(world, 1800);
  assert.ok(world.stats.harvestedFood > 200, 'multiple harvest/regrowth cycles actually executed');
  assert.equal(world.stats.deaths, 0);
  for (const actor of world.citizens) {
    assert.equal(actor.health, 100, actor.name);
    assert.ok(actor.food > 0, `${actor.name} retains a meal`);
  }
});
