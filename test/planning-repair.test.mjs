import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, applyPlan, tickWorld, planningContext } from '../lib/world.mjs';
import { normalizePlan } from '../lib/plans.mjs';
import { observeWorld } from '../lib/knowledge.mjs';
import { resolveInteraction } from '../lib/interactions.mjs';

const install = (w, c, p) => applyPlan(w, c.id, normalizePlan(p, planningContext(w, c.id)));
const advance = (w, n) => { for (let i = 0; i < n; i++) tickWorld(w); };

test('fully explored depleted terrain retains gathering and retries without model calls', () => {
  const w = createWorld({ expanded: false }), c = w.citizens[0];
  w.citizens = [c];
  Object.assign(c, { food: 10, hunger: 0, energy: 100 });
  c.knowledge.explored = Array.from({ length: 160 }, (_, i) => `${i % 16},${Math.floor(i / 16)}`);
  for (const n of w.nodes) Object.assign(n, { stock: 0, regrowIn: 90 });
  const crop = w.nodes.find(n => n.id === 'crop-1');
  crop.regrowIn = 8;
  observeWorld(w, c);
  install(w, c, { tasks: [{ type: 'gather', resource: 'food', amount: 1 }], work: null });
  advance(w, 5);
  assert.equal(c.order.task.type, 'gather');
  assert.equal(c.order.progress, 0, 'waiting cannot count as harvested goods');
  assert.equal(c.planBlocked, undefined);
  assert.match(c.activity, /Waiting to recheck/);
  advance(w, 20);
  assert.equal(c.food, 11);
  assert.equal(w.stats.harvestedFood, 1);
  assert.ok(c.actionResults.some(r => r.status === 'completed' && r.task.type === 'gather'));
  assert.ok(!c.actionResults.some(r => r.status === 'failed'));
});

test('failed steps hold later tasks while needs and phone work continue; reviewed continuation releases them', () => {
  const w = createWorld({ expanded: false }), c = w.citizens[0];
  Object.assign(c, { food: 10, wood: 5, hunger: 0, energy: 100 });
  Object.assign(w.citizens[1], { x: 2, y: 3 }); observeWorld(w, c);
  install(w, c, { tasks: [{ type: 'give', target: 'citizen-2', resource: 'wood', amount: 100 }, { type: 'move', x: 4, y: 2 }], work: null });
  advance(w, 5);
  assert.match(c.planBlocked, /resources/);
  const location = [c.x, c.y];
  c.hunger = 60;
  c.communications = [{ type: 'message', target: 'citizen-2', text: 'I need to reconsider.' }];
  advance(w, 10);
  assert.deepEqual([c.x, c.y], location);
  assert.equal(c.tasks.length, 1);
  assert.equal(c.food, 9);
  assert.equal(w.messages.length, 1);
  assert.equal(planningContext(w, c.id).citizen.execution.blockedBy, c.planBlocked);
  install(w, c, { mode: 'continue' });
  advance(w, 10);
  assert.deepEqual([c.x, c.y], [4, 2]);
  assert.equal(c.planBlocked, undefined);
});

test('repeated single-use trade identifiers reject atomically through both entry points', () => {
  const w = createWorld({ expanded: false }), c = w.citizens[0], before = structuredClone(c);
  assert.equal(resolveInteraction(w, w.citizens[1], { type: 'offer', give: 'wood', giveAmount: 2, want: 'food', wantAmount: 1 }).ok, true);
  const raw = { tasks: [{ type: 'trade', offer: 'offer-1' }, { type: 'trade', offer: 'offer-1' }], work: null };
  assert.throws(() => install(w, c, raw), /accepted once/);
  const canonical = normalizePlan({ tasks: [], work: null }, planningContext(w, c.id));
  assert.throws(() => applyPlan(w, c.id, { ...canonical, tasks: raw.tasks }), /accepted once/);
  assert.deepEqual(c, before);
});

test('reproduction feedback identifies own unmet prerequisites without exposing partner values', () => {
  const w = createWorld({ expanded: false }), [c, peer] = w.citizens;
  Object.assign(c, { food: 1, wood: 10, energy: 30, health: 100, hunger: 0 });
  Object.assign(peer, { x: 2, y: 3, food: 123, wood: 456, energy: 100, health: 100, hunger: 0 });
  assert.equal(resolveInteraction(w, c, { type: 'propose_family', target: peer.id }).ok, true);
  assert.equal(resolveInteraction(w, peer, { type: 'accept_family', proposal: w.familyProposals[0].id }).ok, true);
  const before = structuredClone(w);
  const result = resolveInteraction(w, c, { type: 'reproduce', target: peer.id });
  assert.equal(result.ok, false);
  assert.match(result.reason, /your.*food-equivalents below 2/);
  assert.doesNotMatch(result.reason, /123|456/);
  assert.deepEqual(w, before, 'failure spends nothing and leaves consent intact');
});
