import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tickWorld, applyPlan } from '../lib/world.mjs';
import { AREAS, QUADRANTS, areaOf, inArea, areaDestination, areaResourceLevel, worldAreas } from '../lib/places.mjs';
import { RING_NODE_SEEDS, economyForNodes, FOOD_REGROW_TICKS, WOOD_REGROW_TICKS } from '../lib/economy.mjs';
import { findPath, isWalkable } from '../lib/pathfinding.mjs';
import { createCitizenToolSession } from '../lib/citizen-tools.mjs';
import { createSimulation } from '../lib/simulation.mjs';
import { normalizePlan } from '../lib/plans.mjs';

const session = (world, citizen = world.citizens[0]) => createCitizenToolSession({ getWorld: () => world, citizenId: citizen.id });

test('default keeps eight adults and double land with fewer, higher-yield resource sites', () => {
  const world = createWorld();
  assert.deepEqual([world.width, world.height], [20, 16]);
  assert.equal(world.width * world.height, 2 * 16 * 10);
  assert.equal(world.citizens.length, 8);
  assert.equal(new Set(world.citizens.map(c => c.name)).size, 8);
  assert.equal(new Set(world.citizens.map(c => c.id)).size, 8);
  assert.equal(world.nextCitizenId, 9);
  assert.deepEqual(world.citizens.map(c => areaOf(world, c)).sort(), QUADRANTS.flatMap(q => [`${q}-ring-1`, `${q}-ring-2`]).sort());
  assert.equal(world.nodes.filter(n => n.kind === 'crop').length, 12);
  assert.equal(world.nodes.filter(n => n.kind === 'tree').length, 10);
  const old = economyForNodes(RING_NODE_SEEDS);
  assert.ok(Math.abs(world.economy.idealAdults - 24) < 1e-10);
  assert.ok(Math.abs(world.economy.foodPerMinute / old.foodPerMinute - .75) < 1e-10);
  assert.equal(world.economy.woodPerMinute, old.woodPerMinute);
  assert.ok(world.economy.idealAdults >= 2 * world.citizens.length, 'food headroom before travel and competition');
  for (const c of world.citizens) {
    assert.ok(c.adult && c.alive && isWalkable(world, c.x, c.y));
    assert.deepEqual(c.goals, c.aspirations);
    assert.notEqual(c.goals, c.aspirations);
    assert.ok(Object.values(c.knowledge.nodes).some(n => n.kind === 'crop'), `${c.name} initially sees food despite terrain`);
  }
  assert.equal(new Set(world.nodes.map(n => `${n.x},${n.y}`)).size, world.nodes.length);
  for (const node of world.nodes) assert.ok(findPath(world, world.citizens[0], node), `${node.id} reachable`);
  for (const node of world.nodes) {
    assert.equal(node.level, areaResourceLevel(world, areaOf(world, node)));
    assert.equal(node.yield, node.level * (node.kind === 'crop' ? 1 : 5));
    assert.equal(node.capacity, 1);
    assert.equal(node.regrowTicks, node.kind === 'crop' ? FOOD_REGROW_TICKS : WOOD_REGROW_TICKS);
  }
  tickWorld(world); // Includes normal world validation with all eight seeds.
});

test('center and two outward rings partition all tiles; bare quadrants exclude center', () => {
  const world = createWorld(), counts = new Map(AREAS.map(id => [id, 0]));
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
    const id = areaOf(world, { x, y });
    counts.set(id, counts.get(id) + 1);
    assert.ok(inArea(world, { x, y }, id.replace(/-ring-\d$/, '')));
    if (id === 'center') assert.ok(QUADRANTS.every(q => !inArea(world, { x, y }, q)));
  }
  assert.equal(counts.get('center'), 48);
  for (const q of QUADRANTS) assert.deepEqual([1, 2].map(r => counts.get(`${q}-ring-${r}`)), [23, 45]);
  assert.equal(areaOf(world, { x: 6, y: 5 }), 'center');
  assert.equal(areaOf(world, { x: 13, y: 10 }), 'center');
  assert.equal(areaOf(world, { x: 5, y: 6 }), 'north-west-ring-1');
  assert.equal(areaOf(world, { x: 3, y: 3 }), 'north-west-ring-1');
  assert.equal(areaOf(world, { x: 2, y: 4 }), 'north-west-ring-2');
  assert.equal(areaOf(world, { x: 1, y: 4 }), 'north-west-ring-2');
  assert.equal(areaOf(world, { x: 10, y: 8 }), 'center');
  assert.ok(areaDestination(world, world.citizens[0], 'north-west-ring-2'));
  assert.ok(areaDestination(world, world.citizens[0], 'center'));
});

test('place tools explain rings without exposing unknown remote resources', () => {
  const world = createWorld(), c = world.citizens[0], tools = session(world);
  const context = tools.refresh();
  assert.equal(context.currentPlace.id, 'north-west-ring-1');
  assert.deepEqual(context.geography.areas, AREAS);
  const places = tools.execute('get_places', {});
  assert.equal(places.areas.length, 9);
  assert.match(places.explanation, /increase outward/);
  assert.match(places.explanation, /Quality changes yield only/);
  const center = places.areas.find(a => a.id === 'center');
  assert.equal(center.resourceLevel, 3);
  assert.equal(center.knownFoodSites, 0);
  assert.equal(center.knownWoodSites, 0);
  assert.ok(!JSON.stringify(tools.execute('find_resources', { resource: 'food', area: 'center' })).includes('crop-1'));
  c.knowledge.nodes = Object.fromEntries(world.nodes.map(n => [n.id, { ...n, observedAt: 0, source: 'seen' }]));
  const outer = tools.execute('find_resources', { resource: 'food', area: 'north-west-ring-2' });
  assert.ok(JSON.stringify(outer).includes('north-west-ring-2'));
  assert.ok(!JSON.stringify(outer).includes('north-west-ring-1'));
});

test('chosen movement and collection execute in the requested outer ring', () => {
  const world = createWorld(), c = world.citizens[0]; world.citizens = [c];
  Object.assign(c, { hunger: 0, food: 0, asyncReview: true });
  c.knowledge.nodes = Object.fromEntries(world.nodes.map(n => [n.id, { ...n, observedAt: 0, source: 'seen' }]));
  const tools = session(world); tools.refresh();
  assert.equal(tools.execute('commit_strategy', { tasks: [{ type: 'move', area: 'north-west-ring-2' }, { type: 'ensure_inventory', resource: 'food', minimum: 1, area: 'north-west-ring-2' }], work: null }).ok, true);
  applyPlan(world, c.id, tools.committed.plan);
  for (let i = 0; i < 40 && c.food < 1; i++) tickWorld(world);
  assert.equal(c.food, 1);
  assert.equal(areaOf(world, c), 'north-west-ring-2');
  const harvested = world.nodes.filter(n => c.resourceHistory[n.id]?.harvested);
  assert.equal(harvested.length, 1);
  assert.equal(areaOf(world, harvested[0]), 'north-west-ring-2');
});

test('building destinations respect ring boundaries and personal explored terrain', () => {
  const world = createWorld(), c = world.citizens[0];
  c.knowledge.explored = ['4,5'];
  assert.equal(areaDestination(world, c, 'north-west-ring-2', { exploredOnly: true, buildable: true }), null);
  c.knowledge.explored.push('1,5');
  assert.deepEqual(areaDestination(world, c, 'north-west-ring-2', { exploredOnly: true, buildable: true }), { x: 1, y: 5 });
});

test('older worlds keep their four named areas without reinterpreting saved coordinates', () => {
  const world = createWorld({ expanded: false });
  assert.equal(areaOf(world, world.citizens[0]), 'north-west');
  assert.equal(session(world).execute('get_places', {}).areas.length, 4);
  assert.equal(areaDestination(world, world.citizens[0], 'north-west-ring-1'), null);
});

test('saved two-ring geography and uniform node yields remain unchanged', () => {
  const world = createWorld(); delete world.center;
  world.rings = [{ ring: 1, x: 2, y: 3, width: 16, height: 10 }, { ring: 2, x: 0, y: 0, width: 20, height: 16 }];
  world.nodes = RING_NODE_SEEDS.map(n => ({ ...n, stock: n.capacity, regrowIn: 0 }));
  assert.equal(worldAreas(world).length, 8);
  assert.equal(areaOf(world, { x: 17, y: 12 }), 'south-east-ring-1');
  assert.equal(areaOf(world, { x: 17, y: 13 }), 'south-east-ring-2');
  assert.equal(areaDestination(world, world.citizens[0], 'center'), null);
  assert.equal(areaDestination(world, world.citizens[0], 'north-west-ring-3'), null);
  assert.equal(session(world).execute('get_places', {}).areas.length, 8);
  assert.ok(world.nodes.every(n => !n.level && n.yield === (n.kind === 'crop' ? 1 : 5)));
});

test('scheduler serves all eight starting citizens and reset creates the expanded world', async t => {
  let now = 0; const calls = [];
  const sim = createSimulation({ asynchronousWork: true, check: async () => {}, plan: async context => {
    calls.push(context.citizen.id);
    return { plan: normalizePlan({ tasks: [{ type: 'wait', ticks: 120 }], work: null, reviewAfter: 600 }, context), tokens: 1 };
  } }, { now: () => now });
  t.after(() => sim.close());
  await sim.check(); sim.control('play');
  for (let i = 0; i < 8; i++) {
    await new Promise(resolve => setImmediate(resolve));
    now += 5000; sim.advance(.1);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.slice(0, 8), Array.from({ length: 8 }, (_, i) => `citizen-${i+1}`));
  sim.control('reset');
  assert.equal(sim.state.world.citizens.length, 8);
  assert.equal(sim.state.world.width * sim.state.world.height, 320);
});
