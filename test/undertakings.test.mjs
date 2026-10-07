import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, createWorld, planningContext, tickWorld, upgradeWorld } from '../lib/world.mjs';

function plan(tasks = [], work = null, family = false) {
  return { thought: 'Choose deliberately.', goals: ['Do this undertaking'], memory: '',
    routine: { family }, work, reviewAfter: 600, tasks };
}
function apply(world, actor, tasks = [], work = null, family = false) {
  return applyPlan(world, actor.id, plan(tasks, work, family));
}
function ticks(world, count) { for (let i = 0; i < count; i++) tickWorld(world); }
function fixture(count = 1) {
  const world = createWorld();
  world.citizens = world.citizens.slice(0, count);
  world.nodes = []; world.blocked = []; world.buildings = []; world.nextBuildingId = 1;
  for (const [i, c] of world.citizens.entries()) {
    Object.assign(c, { x: 2 + i, y: 2, hunger: 0, energy: 100, health: 100,
      food: 20, wood: 20, bread: 0, work: null, routine: { family: false }, familyReady: false,
      tasks: [], current: null, order: null, path: [], gatherTarget: null, exploreTarget: null,
      knowledge: { nodes: {}, buildings: {}, people: {}, explored: [] }, incidents: [],
      relationships: {}, planning: false, reviewAt: 600 });
    apply(world, c, [{ type: 'wait', ticks: 120 }]);
  }
  return { world, actor: world.citizens[0], other: world.citizens[1], third: world.citizens[2] };
}
function bakery(world, owner, health = 240) {
  const b = { id: `bakery-${world.nextBuildingId++}`, kind: 'bakery', x: owner.x, y: owner.y,
    ownerId: owner.id, health, maxHealth: 240, destroyed: false };
  world.buildings.push(b);
  owner.knowledge.buildings[b.id] = { ...b, observedAt: world.tick, source: 'seen' };
  return b;
}
function deposit(world, actor, kind) {
  const n = { id: `${kind}-test`, kind, x: actor.x, y: actor.y + 1, stock: 1,
    capacity: 1, yield: kind === 'tree' ? 5 : 1, regrowTicks: 1, regrowIn: 0 };
  world.nodes.push(n);
  actor.knowledge.nodes[n.id] = { ...n, observedAt: world.tick, source: 'seen' };
  return n;
}
const buildings = (world, c) => planningContext(world, c.id).buildings;
const incidents = (world, c) => {
  const context = planningContext(world, c.id);
  return context.incidents ?? context.citizen.incidents;
};

test('well-fed adults have no reserve agenda or automatic gathering', () => {
  const { world, actor } = fixture();
  deposit(world, actor, 'crop'); deposit(world, actor, 'tree');
  apply(world, actor);
  ticks(world, 12);
  assert.equal(actor.work, null);
  assert.deepEqual(actor.routine, { family: false });
  assert.deepEqual([actor.food, actor.wood], [20, 20]);
  assert.deepEqual([world.stats.harvestedFood, world.stats.harvestedWood], [0, 0]);
  assert.equal(actor.replanReason, 'strategy complete');
  assert.equal(actor.activity, 'Choosing next undertaking');
});

test('upgrade discards old food/wood reserve targets without inventing work', () => {
  const { world, actor } = fixture();
  Object.assign(actor, { food: 0, wood: 0, routine: { food: 4, wood: 10 }, familyReady: false,
    tasks: [], order: null, current: null, activity: 'Reserves met' });
  delete actor.work;
  const reviewAt = actor.reviewAt;
  upgradeWorld(world);
  assert.equal(actor.activity, 'Choosing next undertaking', 'the retired label is removed even without an idle primitive');
  assert.equal(actor.reviewAt, reviewAt, 'migration does not shorten review deadlines');
  deposit(world, actor, 'crop'); deposit(world, actor, 'tree');
  ticks(world, 10);
  assert.deepEqual(actor.routine, { family: false });
  assert.equal(actor.work, null);
  assert.deepEqual([actor.food, actor.wood], [0, 0]);
});

test('chosen gathering continues above old reserve thresholds and survives serial completion', () => {
  for (const resource of ['food', 'wood']) {
    const { world, actor } = fixture();
    deposit(world, actor, resource === 'food' ? 'crop' : 'tree');
    const initial = actor[resource];
    const work = { type: 'gather', resource };
    apply(world, actor, [{ type: 'wait', ticks: 1 }], work);
    ticks(world, 35);
    assert.ok(actor[resource] > initial, `${resource} production continues above 4/10`);
    assert.deepEqual(actor.work, work);
    assert.equal(actor.tasks.length, 0);
    assert.notEqual(actor.replanReason, 'strategy complete');
  }
});

test('bake work repeatedly uses only the owner bakery and one food/wood per loaf', () => {
  const { world, actor, other } = fixture(2);
  const own = bakery(world, actor); bakery(world, other);
  apply(world, actor, [], { type: 'bake', target: 'own' });
  ticks(world, 25);
  assert.ok(actor.bread >= 2);
  assert.equal(actor.food, 20 - actor.bread);
  assert.equal(actor.wood, 20 - actor.bread);
  assert.equal(other.bread, 0);
  assert.equal(own.health, 240);
  assert.deepEqual(actor.work, { type: 'bake', target: 'own' });
});

test('bake work acquires missing raw food and wood rather than silently stopping', () => {
  const { world, actor } = fixture();
  actor.food = 0; actor.wood = 0;
  bakery(world, actor); deposit(world, actor, 'crop'); deposit(world, actor, 'tree');
  apply(world, actor, [], { type: 'bake', target: 'own' });
  ticks(world, 50);
  assert.ok(actor.bread > 0);
  assert.ok(world.stats.harvestedFood > 0 && world.stats.harvestedWood > 0);
  assert.deepEqual(actor.work, { type: 'bake', target: 'own' });
});

test('30-tick expensive build followed by bake amount two conserves inputs', () => {
  const { world, actor, other } = fixture(2);
  actor.food = 2; actor.wood = 52;
  const foreign = bakery(world, other);
  apply(world, actor, [{ type: 'build', building: 'bakery', x: 2, y: 2 },
    { type: 'bake', target: 'own', amount: 2 }]);
  ticks(world, 29);
  assert.equal(world.buildings.length, 1, 'construction is not instantaneous');
  ticks(world, 30);
  assert.equal(world.buildings.length, 2);
  assert.deepEqual([actor.food, actor.wood, actor.bread], [0, 0, 2]);
  assert.equal(world.buildings.find((b) => b.ownerId === actor.id).health, 240);
  assert.equal(foreign.ownerId, other.id);
  assert.equal(other.bread, 0);
  assert.equal(world.stats.baked, 2);
});

test('needs consume one bread for 87.5 hunger relief without starting an undertaking', () => {
  const { world, actor } = fixture();
  actor.food = 0; actor.bread = 1; actor.hunger = 90;
  apply(world, actor);
  ticks(world, 2);
  assert.equal(actor.bread, 0);
  assert.equal(actor.hunger, 3);
  assert.equal(actor.work, null);
});

test('bread is retained until its full nutrition is useful, then feeds without raw food or extra foraging', () => {
  const { world, actor } = fixture();
  actor.food = 0; actor.bread = 2; actor.hunger = 60;
  apply(world, actor);
  ticks(world, 109);
  assert.equal(actor.bread, 2, 'no loaf wasted at the raw-food threshold');
  assert.equal(actor.hunger, 87.25);
  ticks(world, 2);
  assert.equal(actor.bread, 1);
  assert.equal(actor.hunger, .25);
  assert.equal(actor.health, 100);
  ticks(world, 350);
  assert.equal(actor.bread, 0, 'next loaf lasts 350 adult ticks, using all 87.5 relief');
  assert.equal(actor.health, 100);
  assert.equal(world.stats.harvestedFood, 0);
});

test('bread-only parental care transfers and consumes real bread while retaining orders', () => {
  const { world, actor, other } = fixture(2);
  actor.food = 0; actor.bread = 2; other.food = 0;
  const child = { ...structuredClone(other), id: 'test-child', name: 'Child', x: 2, y: 3,
    adult: false, bornAt: 0, parents: [actor.id, other.id], hunger: 90, bread: 0,
    food: 0, wood: 0, tasks: [], order: null, current: null, planCount: 0 };
  world.citizens.push(child);
  ticks(world, 8);
  assert.ok(child.hunger < 30, 'dependent eats donated bread');
  assert.equal(actor.bread + child.bread, 1, 'exactly one loaf was consumed');
  assert.equal(actor.order?.task.type, 'wait', 'care preserves the chosen serial order');
  assert.equal(child.planCount, 0);
});

test('a child collects a reserved free bread gift through the real executor', () => {
  const { world, actor, other } = fixture(2);
  actor.bread = 2;
  Object.assign(other, { adult: false, bornAt: 0, parents: [], tasks: [], order: null,
    current: null, food: 0, bread: 0, hunger: 20, planCount: 0 });
  apply(world, actor, [{ type: 'offer', give: 'bread', giveAmount: 2,
    want: 'wood', wantAmount: 0, recipient: other.id }]);
  ticks(world, 10);
  assert.equal(world.offers[0].status, 'filled');
  assert.deepEqual([actor.bread, other.bread], [0, 2]);
  assert.equal(other.planCount, 0);
});

test('building attack is not capped at three strikes and ends on destruction', () => {
  const { world, actor, other } = fixture(2);
  const b = bakery(world, other, 30);
  apply(world, actor, [{ type: 'attack', target: b.id }]);
  ticks(world, 30);
  assert.deepEqual([b.health, b.destroyed], [0, true]);
  assert.equal(world.stats.buildingAttacks, 5);
  assert.equal(other.health, 100, 'building strikes do not cause owner retaliation');
});

test('chosen standing and finite guards respond to a witnessed attacker, not bystanders', () => {
  for (const standing of [true, false]) {
    const { world, actor, other, third } = fixture(3);
    const b = bakery(world, actor);
    Object.assign(third, { x: 2, y: 3 });
    apply(world, other, [{ type: 'attack', target: b.id }]);
    apply(world, actor, standing ? [] : [{ type: 'guard', target: b.id, ticks: 30 }],
      standing ? { type: 'guard', target: b.id } : null);
    ticks(world, 14);
    assert.ok(other.health < 100, 'guard reacts to a recent locally witnessed building strike');
    assert.equal(third.health, 100, 'an innocent nearby adult is never a guard target');
    assert.ok(Math.abs(actor.x - b.x) + Math.abs(actor.y - b.y) <= 2);
  }
  const { world, actor, other } = fixture(2);
  const b = bakery(world, actor);
  apply(world, other, [{ type: 'attack', target: b.id }]);
  ticks(world, 4);
  assert.ok(incidents(world, actor).length > 0, 'the future guard witnessed a real strike');
  apply(world, other, [{ type: 'wait', ticks: 120 }]);
  world.tick += 600;
  apply(world, actor, [], { type: 'guard', target: b.id });
  ticks(world, 6);
  assert.equal(other.health, 100, 'an old incident does not authorize attacking a visible adult');
});

test('unchosen nearby adults do not automatically defend buildings', () => {
  const { world, actor, other, third } = fixture(3);
  const b = bakery(world, actor);
  apply(world, other, [{ type: 'attack', target: b.id }]);
  ticks(world, 12);
  assert.ok(b.health < 240);
  assert.deepEqual([actor.health, other.health, third.health], [100, 100, 100]);
  assert.equal(world.stats.attacks, 0);
});

test('remote owners receive property alerts while private reports and remote guards remain stale', () => {
  const { world, actor, other, third } = fixture(4);
  const witness = world.citizens[3];
  Object.assign(witness, { x: 2, y: 3 });
  const b = bakery(world, actor);
  actor.x = 14; actor.y = 8; third.x = 13; third.y = 8;
  apply(world, actor, [{ type: 'message', target: third.id, text: 'My bakery.', shareBuildings: [b.id] }]);
  ticks(world, 3);
  const report = buildings(world, third).find((entry) => entry.id === b.id);
  assert.equal(report.health, 240);
  assert.equal(report.source, 'report');
  assert.equal(buildings(world, other).find((entry) => entry.id === b.id).source, 'seen');
  apply(world, other, [{ type: 'attack', target: b.id }]);
  ticks(world, 4);
  assert.ok(b.health < 240);
  assert.ok(incidents(world, other).length > 0, 'actual attacker records local evidence');
  assert.ok(incidents(world, witness).length > 0, 'nearby observer records the actual attack');
  const alert = incidents(world, actor).at(-1);
  assert.equal(alert.source, 'owner-alert');
  assert.equal(alert.attackerId, other.id);
  assert.equal(alert.attackerName, other.name);
  assert.equal(alert.targetId, b.id);
  assert.equal(buildings(world, actor).find(entry => entry.id === b.id).health, b.health);
  assert.deepEqual(incidents(world, third), []);
  const stale = buildings(world, third).find((entry) => entry.id === b.id);
  assert.deepEqual([stale.health, stale.observedAt], [240, report.observedAt]);
  assert.equal(JSON.stringify(planningContext(world, third.id)).includes('lastAttackerId'), false);
  assert.equal(planningContext(world, third.id).neighbors.some((c) => 'incidents' in c), false);
  apply(world, actor, [], { type: 'guard', target: b.id });
  Object.assign(other, { x: 14, y: 7, tasks: [], order: null, current: null });
  ticks(world, 2);
  assert.equal(other.health, 100, 'remote live last-attacker metadata does not authorize attack');
});

test('a stocked child never drains an adjacent parent before hunger reaches 60', () => {
  const { world, actor, other } = fixture(2);
  actor.bread = 3;
  const child = { ...structuredClone(other), id: 'test-child', name: 'Child', x: 2, y: 3,
    adult: false, bornAt: 0, parents: [actor.id, other.id], hunger: 50, bread: 1, food: 0,
    wood: 0, tasks: [], order: null, current: null, planCount: 0 };
  world.citizens.push(child);
  ticks(world, 30);
  assert.ok(child.hunger > 50 && child.hunger < 60, 'still below the feeding threshold');
  assert.deepEqual([actor.food, actor.bread], [20, 3], 'parent food and bread stayed stable');
  assert.equal(child.bread, 1, 'own reserves are eaten first, only at hunger 60');
  assert.equal(world.stats.transfers, 0);
  assert.ok(child.alive);
});

test('a chosen guard answers a witnessed citizen strike at the bakery after the victim is removed dead', () => {
  const { world, actor, other, third } = fixture(3);
  const b = bakery(world, actor);
  Object.assign(third, { x: 2, y: 3, health: 4, energy: 3, tasks: [], order: null, current: null });
  apply(world, other, [{ type: 'attack', target: third.id }]);
  apply(world, actor, [], { type: 'guard', target: b.id });
  ticks(world, 20);
  assert.ok(incidents(world, actor).some((i) => i.kind === 'citizen' && i.attackerId === other.id),
    'the guard witnessed a recent citizen strike at its bakery');
  assert.equal(world.citizens.some((c) => c.id === third.id), false, 'the victim was removed dead');
  assert.equal(world.stats.deaths, 1);
  assert.ok(Math.abs(other.x - b.x) + Math.abs(other.y - b.y) <= 2, 'the attacker remains visible at the site');
  assert.ok(other.health < 100 && other.health >= 60 && other.alive,
    'the guard punishes the attacker from the incident place, not any victim state');
  assert.deepEqual(actor.work, { type: 'guard', target: b.id });
  assert.ok(Math.abs(actor.x - b.x) + Math.abs(actor.y - b.y) <= 2, 'the guard keeps working its site');
});

test('a pending three-tick guard strike never lands on an attacker who walks out of the site radius', () => {
  const { world, actor, other, third } = fixture(3);
  const b = bakery(world, actor);
  Object.assign(other, { x: 3, y: 2 });
  Object.assign(third, { x: 4, y: 2, health: 4, energy: 3, tasks: [], order: null, current: null });
  apply(world, other, [{ type: 'attack', target: third.id }, { type: 'move', x: 3, y: 6 }]);
  apply(world, actor, [], { type: 'guard', target: b.id });
  ticks(world, 10);
  assert.equal(world.citizens.some((c) => c.id === third.id), false, 'the witnessed kill seeded the recent incident');
  assert.deepEqual([other.x, other.y], [3, 6], 'the attacker moved four real tiles');
  assert.equal(other.health, 100, 'no pending strike completes once the attacker left the radius');
  assert.equal(world.stats.attacks, 1, "only the attacker's own fatal strike counted");
  assert.deepEqual(actor.work, { type: 'guard', target: b.id }, 'the guard job continues');
  assert.ok(Math.abs(actor.x - b.x) + Math.abs(actor.y - b.y) <= 2);
  assert.ok(actor.activity.startsWith('Guarding'));
});

test('explore work over fully explored terrain clears once as a failed policy without an idle loop', () => {
  const { world, actor } = fixture();
  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) actor.knowledge.explored.push(`${x},${y}`);
  }
  apply(world, actor, [], { type: 'explore' });
  ticks(world, 3);
  assert.equal(actor.work, null, 'the completed policy is cleared');
  assert.equal(actor.replanReason, 'chosen work failed');
  assert.equal(actor.memories.filter((m) => m.includes('no unexplored reachable terrain')).length, 1);
  ticks(world, 27);
  assert.equal(actor.memories.filter((m) => m.includes('no unexplored reachable terrain')).length, 1,
    'the failure is recorded once, then the citizen idles until its review');
  assert.equal(actor.replanReason, 'chosen work failed');
  assert.equal(actor.activity, 'Choosing next undertaking');
});

test('bake work at a known foreign bakery refuses locally before any harvesting or gathering', () => {
  const { world, actor, other } = fixture(2);
  Object.assign(other, { x: 3, y: 2 });
  const foreign = bakery(world, other);
  ticks(world, 1);
  apply(world, actor, [], { type: 'bake', target: foreign.id });
  ticks(world, 3);
  assert.deepEqual([actor.x, actor.y], [2, 2], 'the refusal happened locally without harvest trips');
  assert.equal(actor.work, null);
  assert.equal(actor.replanReason, 'chosen work failed');
  assert.equal(actor.memories.filter((m) => m.includes('no usable owner-operated bakery')).length, 1);
  assert.deepEqual([actor.food, actor.wood, actor.bread], [20, 20, 0], 'no ingredients were gathered');
  assert.deepEqual([world.stats.harvestedFood, world.stats.harvestedWood, world.stats.baked], [0, 0, 0]);
});

test('bake work picks the nearest known-live owned bakery, and none usable clears the failed job', () => {
  // The nearest own bakery is destroyed; a nearest foreign bakery is known-live; a far own one lives.
  {
    const { world, actor, other } = fixture(2);
    const near = bakery(world, actor); near.health = 0; near.destroyed = true;
    const foreign = bakery(world, other);
    const far = bakery(world, actor); far.x = 6; far.y = 2;
    actor.knowledge.buildings[far.id] = { ...far, observedAt: 0, source: 'seen' };
    ticks(world, 1);
    apply(world, actor, [], { type: 'bake', target: 'own' });
    ticks(world, 25);
    assert.equal(actor.bread, 2);
    assert.equal(world.stats.baked, 2);
    assert.deepEqual([actor.food, actor.wood], [18, 18]);
    assert.deepEqual(actor.work, { type: 'bake', target: 'own' });
    assert.ok(Math.abs(actor.x - far.x) + Math.abs(actor.y - far.y) <= 1, 'baked at the far known-live own bakery');
    assert.deepEqual([near.health, foreign.health, other.bread], [0, 240, 0],
      'the destroyed closest and the foreign bakery were never used');
  }
  {
    const { world, actor, other } = fixture(2);
    Object.assign(other, { x: 3, y: 2 });
    const near = bakery(world, actor); near.health = 0; near.destroyed = true;
    bakery(world, other);
    ticks(world, 1);
    apply(world, actor, [], { type: 'bake', target: 'own' });
    ticks(world, 3);
    assert.equal(actor.work, null, 'no usable bakery clears the failed job');
    assert.equal(actor.replanReason, 'chosen work failed');
    assert.equal(actor.memories.filter((m) => m.includes('no known bakery for the baking choice')).length, 1);
    assert.deepEqual([actor.x, actor.y, actor.food, actor.wood, actor.bread], [2, 2, 20, 20, 0]);
    assert.equal(world.stats.baked, 0, 'the known-live foreign bakery was never used');
  }
});

test('owner repair takes four ticks, costs two wood, adds twenty hp; outsiders cannot repair', () => {
  const { world, actor, other } = fixture(2);
  const b = bakery(world, actor, 100);
  apply(world, actor, [{ type: 'repair', target: b.id }]);
  ticks(world, 3);
  assert.deepEqual([b.health, actor.wood], [100, 20]);
  ticks(world, 1);
  assert.deepEqual([b.health, actor.wood], [120, 18]);
  try { apply(world, other, [{ type: 'repair', target: b.id }]); }
  catch (error) { assert.match(error.message, /owner|own|repair|Invalid/i); }
  ticks(world, 6);
  assert.deepEqual([b.health, other.wood], [120, 20]);
});
