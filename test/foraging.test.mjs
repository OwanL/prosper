import test from 'node:test';
import assert from 'node:assert/strict';
import { competitionPenalty, visiblyOccupied } from '../lib/foraging.mjs';
import { createWorld, applyPlan, tickWorld } from '../lib/world.mjs';

test('automatic gathering chooses an available alternative to a freshly observed single-stock race', () => {
  const world = createWorld({ expanded: false });
  const [actor, peer] = world.citizens;
  world.citizens = [actor, peer]; world.blocked = [];
  Object.assign(actor, { x: 1, y: 1, hunger: 0, energy: 100, food: 4 });
  world.nodes = [
    { id: 'crop-contested', kind: 'crop', x: 2, y: 1, stock: 1, capacity: 1, yield: 1, regrowTicks: 99, regrowIn: 0 },
    { id: 'crop-free', kind: 'crop', x: 1, y: 3, stock: 1, capacity: 1, yield: 1, regrowTicks: 99, regrowIn: 0 },
  ];
  actor.knowledge = { nodes: {}, people: {}, explored: [] };
  Object.assign(peer, { x: 2, y: 1, hunger: 0, energy: 100,
    current: { task: { type: 'harvest', target: 'crop-contested' }, remaining: 3, purpose: 'need' } });
  applyPlan(world, actor.id, { thought: 'Collect food.', goals: ['Supply'], memory: '',
    routine: { family: false }, work: null, reviewAfter: 300, tasks: [{ type: 'gather', resource: 'food', amount: 1 }] });
  tickWorld(world);
  assert.equal(actor.gatherTarget.nodeId, 'crop-free');
  for (let i = 0; i < 9; i++) tickWorld(world);
  assert.equal(actor.resourceHistory['crop-free'].harvested, 1);
  assert.equal(actor.resourceHistory['crop-contested'], undefined);
});

test('competition preferences expire, allow sufficient stock, and never read remote live actions', () => {
  const node = { id: 'crop', kind: 'crop', stock: 1, regrowTicks: 99 };
  const actor = { knowledge: { people: { peer: { source: 'seen', observedAt: 10,
    observedActivity: { type: 'harvesting', target: 'crop' } } } }, resourceHistory: {} };
  assert.equal(competitionPenalty(actor, node, 10), 99);
  assert.equal(competitionPenalty(actor, { ...node, stock: 2 }, 10), 0);
  assert.equal(competitionPenalty(actor, node, 23), 0);
  actor.knowledge.people.peer.source = 'report';
  assert.equal(competitionPenalty(actor, node, 10), 0);
  actor.resourceHistory.crop = { lastOutcomeAt: 10, visits: 4, lostRaces: 2 };
  assert.equal(competitionPenalty(actor, node, 10), 50);
  assert.equal(competitionPenalty(actor, node, 209), 0);
});

test('occupied-site evidence requires current personal visibility, sufficient stock remains usable', () => {
  const actor = { knowledge: { people: { peer: { source: 'seen', observedAt: 10, observedActivity: { type: 'harvesting', target: 'crop' } } } } };
  const node = { id: 'crop', source: 'seen', observedAt: 10, stock: 1 };
  assert.equal(visiblyOccupied(actor, node, 10), true);
  assert.equal(visiblyOccupied(actor, node, 11), false);
  assert.equal(visiblyOccupied(actor, { ...node, stock: 2 }, 10), false);
  assert.equal(visiblyOccupied(actor, { ...node, source: 'report' }, 10), false);
  actor.knowledge.people.peer.source = 'report';
  assert.equal(visiblyOccupied(actor, node, 10), false);
});

test('a route changes when occupation becomes visible rather than using remote live work at departure', () => {
  const world = createWorld({ expanded: false }), [actor, peer] = world.citizens;
  world.citizens = [actor, peer]; world.blocked = [];
  Object.assign(actor, { x: 0, y: 0, hunger: 0, energy: 100, food: 5 });
  world.nodes = [
    { id: 'crop-occupied', kind: 'crop', x: 5, y: 0, stock: 1, capacity: 1, yield: 1, regrowTicks: 99, regrowIn: 0 },
    { id: 'crop-free', kind: 'crop', x: 0, y: 6, stock: 1, capacity: 1, yield: 1, regrowTicks: 99, regrowIn: 0 },
  ];
  actor.knowledge = { nodes: Object.fromEntries(world.nodes.map(n => [n.id, { ...n, source: 'seen', observedAt: 0 }])), people: {}, explored: [] };
  Object.assign(peer, { x: 5, y: 0, hunger: 0, energy: 100,
    current: { task: { type: 'harvest', target: 'crop-occupied' }, remaining: 20, purpose: 'need' } });
  applyPlan(world, actor.id, { thought: '', goals: ['Collect'], memory: '', routine: { family: false }, work: null,
    reviewAfter: 300, tasks: [{ type: 'gather', resource: 'food', amount: 1 }] });
  tickWorld(world);
  assert.equal(actor.gatherTarget.nodeId, 'crop-occupied', 'unseen work did not affect departure');
  tickWorld(world); tickWorld(world);
  assert.equal(actor.gatherTarget.nodeId, 'crop-free', 'fresh sighting makes the controller reconsider the route');
});

test('automatic work avoids stealing a visibly occupied harvest while deliberate camping can still contest it', () => {
  for (const camp of [false, true]) {
    const world = createWorld({ expanded: false }), [novice, expert] = world.citizens;
    world.citizens = [novice, expert]; world.width = 5; world.height = 5; world.blocked = [];
    const crop = { id: 'crop', kind: 'crop', x: 3, y: 3, stock: 1, capacity: 1, yield: 1, regrowTicks: 99, regrowIn: 0 };
    world.nodes = [crop];
    for (const c of world.citizens) {
      Object.assign(c, { x: 3, y: c === novice ? 3 : 4, food: 5, hunger: 0, energy: 100 });
      c.knowledge = { nodes: { crop: { ...crop, source: 'seen', observedAt: 0 } }, people: {},
        explored: Array.from({ length: 25 }, (_, i) => `${i % 5},${Math.floor(i / 5)}`) };
      applyPlan(world, c.id, { thought: '', goals: ['Collect'], memory: '', routine: { family: false }, work: null, reviewAfter: 300,
        tasks: [{ type: 'gather', resource: 'food', amount: 1, ...(c === expert && camp ? { camp: true, target: 'crop' } : {}) }] });
    }
    expert.tool = true; expert.toolLevel = 3;
    for (let tick = 0; tick < 10; tick++) tickWorld(world);
    assert.equal(world.stats.harvestedFood, 1, 'a real single-stock harvest resolves');
    assert.equal(novice.food, camp ? 5 : 6);
    assert.equal(expert.food, camp ? 6 : 5);
    assert.equal(novice.resourceHistory.crop.lostRaces, camp ? 1 : 0);
  }
});
