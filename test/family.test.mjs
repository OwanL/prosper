import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, applyPlan, tickWorld, planningContext } from '../lib/world.mjs';
import { resolveInteraction } from '../lib/interactions.mjs';
import { acceptedFamily, familyContext, FAMILY_TTL, tickFamily } from '../lib/family.mjs';
import { createPlanner } from '../lib/planner.mjs';
import { normalizePlan } from '../lib/plans.mjs';
import { createSimulation } from '../lib/simulation.mjs';

const strategy = tasks => ({ thought: '', goals: ['Choose a partner'], memory: '', routine: { family: false }, work: null, reviewAfter: 300, tasks });
function agree(world, maker, recipient, location = true) {
  assert.equal(resolveInteraction(world, maker, { type: 'propose_family', target: recipient.id, location }).ok, true);
  const proposal = world.familyProposals.at(-1);
  assert.equal(resolveInteraction(world, recipient, { type: 'accept_family', proposal: proposal.id, location }).ok, true);
  return proposal;
}

test('global flags and hopeful messages grant no consent; proposals are private and partner-specific', () => {
  const world = createWorld();
  const [a, b, outsider] = world.citizens;
  Object.assign(a, { x: 2, y: 2, food: 10, wood: 10, familyReady: true });
  Object.assign(b, { x: 3, y: 2, food: 10, wood: 10, familyReady: true });
  world.messages.push({ id: 'hope', tick: 0, senderId: b.id, recipientId: a.id, text: 'I would like a family with you.' });
  const blocked = resolveInteraction(world, a, { type: 'reproduce', target: b.id });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /explicitly propose and accept/);
  resolveInteraction(world, a, { type: 'propose_family', target: b.id });
  const proposal = world.familyProposals[0];
  assert.equal(proposal.status, 'pending');
  assert.deepEqual(familyContext(world, outsider.id), []);
  assert.equal(resolveInteraction(world, outsider, { type: 'accept_family', proposal: proposal.id }).ok, false);
  assert.equal(resolveInteraction(world, a, { type: 'accept_family', proposal: proposal.id }).ok, false);
  assert.equal(acceptedFamily(world, a.id, b.id), undefined);
  assert.equal(resolveInteraction(world, b, { type: 'accept_family', proposal: proposal.id }).ok, true);
  assert.equal(acceptedFamily(world, a.id, outsider.id), undefined);
  assert.equal(acceptedFamily(world, a.id, b.id), proposal);
});

test('consent preserves preparation; explicit reproduction consumes the pairing once', () => {
  const world = createWorld();
  const [a, b] = world.citizens;
  Object.assign(a, { x: 2, y: 2, food: 10, wood: 10 });
  Object.assign(b, { x: 3, y: 2, food: 10, wood: 10 });
  applyPlan(world, a.id, strategy([{ type: 'propose_family', target: b.id, location: true }]));
  for (let i = 0; i < 4; i++) tickWorld(world);
  assert.equal(world.familyProposals[0].status, 'pending');
  assert.equal(world.stats.births, 0);
  const plan = normalizePlan(strategy([{ type: 'accept_family', proposal: world.familyProposals[0].id, location: true }]), planningContext(world, b.id));
  applyPlan(world, b.id, plan);
  for (let i = 0; i < 4; i++) tickWorld(world);
  assert.equal(world.stats.births, 0, 'acceptance alone does not schedule a meeting');
  assert.equal(b.tasks.length, 0);
  applyPlan(world, b.id, strategy([{ type: 'rest' }, { type: 'reproduce', target: a.id }]));
  for (let i = 0; i < 15; i++) tickWorld(world);
  assert.equal(world.stats.births, 1);
  assert.equal(world.familyProposals[0].status, 'fulfilled');
  assert.equal(resolveInteraction(world, b, { type: 'reproduce', target: a.id }).ok, false);
  assert.deepEqual(world.citizens.at(-1).parents, [b.id, a.id]);
});

test('accepted proposals allow global travel but do not bypass adjacency or resources', () => {
  const world = createWorld();
  const [a, b] = world.citizens;
  a.x = 15; a.y = 9;
  b.x = 0; b.y = 0;
  b.knowledge.people = {};
  resolveInteraction(world, a, { type: 'propose_family', target: b.id });
  applyPlan(world, b.id, strategy([{ type: 'accept_family', proposal: world.familyProposals[0].id }, { type: 'reproduce', target: a.id }]));
  for (let i = 0; i < 6; i++) tickWorld(world);
  assert.equal(world.stats.births, 0);
  assert.ok(b.x !== 0 || b.y !== 0, 'the chosen meeting travels without a location report');
  assert.ok(!b.actionResults.some(r => r.task.type === 'reproduce' && r.status === 'failed'));
  a.x = b.x; a.y = b.y;
  a.food = a.bread = 0;
  assert.equal(resolveInteraction(world, b, { type: 'reproduce', target: a.id }).ok, false);
  assert.equal(world.familyProposals[0].status, 'accepted', 'qualification failure does not fabricate a birth or consume consent');
});

test('decline, cancellation, replacement, expiry and partner death revoke pair-specific permission', () => {
  for (const mode of ['decline', 'cancel', 'replace', 'expire', 'death']) {
    const world = createWorld();
    const [a, b, c] = world.citizens;
    resolveInteraction(world, a, { type: 'propose_family', target: b.id });
    const proposal = world.familyProposals[0];
    if (mode === 'decline') resolveInteraction(world, b, { type: 'decline_family', proposal: proposal.id });
    if (mode === 'cancel') { resolveInteraction(world, b, { type: 'accept_family', proposal: proposal.id }); resolveInteraction(world, b, { type: 'cancel_family', proposal: proposal.id }); }
    if (mode === 'replace') resolveInteraction(world, a, { type: 'propose_family', target: c.id });
    if (mode === 'expire') { world.tick = FAMILY_TTL; tickFamily(world); }
    if (mode === 'death') { b.alive = false; tickFamily(world); }
    assert.ok(!['pending', 'accepted'].includes(proposal.status), mode);
    assert.equal(acceptedFamily(world, a.id, b.id), undefined);
  }
});

test('location disclosure is opt-in and contains no private partner state', () => {
  const world = createWorld();
  const [a, b] = world.citizens;
  b.knowledge.people = {};
  resolveInteraction(world, a, { type: 'propose_family', target: b.id });
  assert.equal(b.knowledge.people[a.id], undefined);
  resolveInteraction(world, a, { type: 'propose_family', target: b.id, location: true });
  const report = b.knowledge.people[a.id];
  assert.deepEqual([report.x, report.y], [a.x, a.y]);
  assert.equal(report.food, undefined);
  assert.equal(report.familyReady, undefined);
  a.x++;
  assert.notEqual(report.x, a.x);
});

test('a private proposal arriving during a model request survives stale plan application and obeys cooldowns', async (t) => {
  let now = 0, resolve;
  const pending = new Promise(done => { resolve = done; });
  const contexts = [];
  const simulation = createSimulation({ model: 'offline', check: async () => {}, plan: context => { contexts.push(context); return pending; } }, { now: () => now });
  t.after(() => simulation.close());
  await simulation.check();
  const [recipient, sender] = simulation.state.world.citizens;
  simulation.state.world.citizens = [recipient, sender];
  sender.planCount = 1; sender.lastPlanTick = 0; sender.reviewAt = 10000; sender.replanReason = null;
  sender.work = { type: 'rest' }; // A deliberate ongoing policy avoids an unrelated completion review.
  simulation.control('play');
  assert.equal(contexts.length, 1);
  assert.deepEqual(contexts[0].familyProposals, []);
  resolveInteraction(simulation.state.world, sender, { type: 'propose_family', target: recipient.id });
  sender.replanReason = null; // Isolate the recipient's eligible review.
  simulation.control('pause');
  resolve({ plan: { ...strategy([{ type: 'wait', ticks: 120 }]), reviewAfter: 600 }, tokens: 0 });
  await new Promise(done => setImmediate(done));
  assert.equal(recipient.replanReason, 'family proposal updated');
  now = 14999;
  simulation.control('play');
  for (let i = 0; i < 180; i++) simulation.advance(1);
  assert.equal(contexts.length, 1, 'a proposal observes the 15s event cooldown');
  now = 15000; simulation.advance(0);
  assert.equal(contexts.length, 2);
  assert.equal(contexts[1].familyProposals[0].status, 'pending');
});

test('planner exposes only own pairings and no global family consent fields', async () => {
  const world = createWorld();
  const [a, b, c] = world.citizens;
  agree(world, a, b);
  let sent;
  const planner = createPlanner({ fetchImpl: async (_url, options) => {
    sent = JSON.parse(JSON.parse(options.body).messages[1].content);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(strategy([])) } }] }) };
  } });
  const context = planningContext(world, c.id);
  context.familyProposals = world.familyProposals;
  await planner.plan(context);
  assert.deepEqual(sent.familyProposals, []);
  assert.equal(sent.citizen.familyReady, undefined);
  assert.equal(sent.citizen.routine, undefined);
});
