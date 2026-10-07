import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, applyPlan, tickWorld, planningContext, transactCitizenAction } from '../lib/world.mjs';
import { normalizePlan } from '../lib/plans.mjs';
import { createPlanner } from '../lib/planner.mjs';

const install = (world, citizen, raw) => applyPlan(world, citizen.id, normalizePlan({ tasks: [], work: null, ...raw }, planningContext(world, citizen.id)));

test('nearby private speech costs no wood, while walls and distance preserve paid phone contact', () => {
  const world = createWorld(), [sender, recipient] = world.citizens;
  world.blocked = [];
  Object.assign(sender, { x: 1, y: 1, wood: 0 }); Object.assign(recipient, { x: 2, y: 1 });
  const local = transactCitizenAction(world, sender.id, { type: 'message', target: recipient.id, text: 'Can you spare food?' });
  assert.equal(local.ok, true); assert.equal(local.channel, 'voice'); assert.equal(local.costWood, 0);
  assert.equal(sender.wood, 0); assert.equal(world.messages[0].channel, 'voice');
  Object.assign(recipient, { x: 3, y: 1 }); world.blocked = [{ x: 2, y: 1 }];
  const blocked = transactCitizenAction(world, sender.id, { type: 'message', target: recipient.id, text: 'Cannot reach you through the wall.' });
  assert.equal(blocked.ok, false); assert.match(blocked.error, /phone contact costs/);
  assert.equal(world.messages.length, 1);
  sender.wood = 1;
  const paid = transactCitizenAction(world, sender.id, { type: 'message', target: recipient.id, text: 'Using the phone instead.' });
  assert.equal(paid.ok, true); assert.equal(paid.channel, 'phone'); assert.equal(paid.costWood, 1); assert.equal(sender.wood, 0);
  Object.assign(recipient, { x: 12, y: 1 }); world.blocked = [];
  assert.equal(transactCitizenAction(world, sender.id, { type: 'message', target: recipient.id, text: 'Too far without phone wood.' }).ok, false);
  assert.equal(world.messages.length, 2);
});

test('queued speech rechecks visibility at send time and never gives free distant contact or partial reports', () => {
  const world = createWorld(), [sender, recipient] = world.citizens;
  world.blocked = [];
  Object.assign(sender, { x: 1, y: 1, wood: 0 }); Object.assign(recipient, { x: 2, y: 1, knowledge: { ...recipient.knowledge, nodes: {} } });
  const known = Object.keys(sender.knowledge.nodes)[0];
  install(world, sender, { communications: [{ type: 'message', target: recipient.id, text: 'Here is a site.', share: [known] }] });
  tickWorld(world); recipient.x = 12;
  tickWorld(world);
  assert.equal(world.messages.length, 0); assert.equal(sender.wood, 0);
  assert.equal(recipient.knowledge.nodes[known], undefined);
  assert.equal(sender.actionResults.at(-1).status, 'failed');
  assert.match(sender.actionResults.at(-1).reason, /phone contact costs/);
});

test('phone sends during physical work, charges once, and shares only recipient location knowledge', () => {
  const world = createWorld(), [sender, recipient, outsider] = world.citizens;
  recipient.knowledge.people = {}; outsider.knowledge.people = {};
  const wood = sender.wood;
  install(world, sender, { tasks: [{ type: 'wait', ticks: 120 }], communications: [{ type: 'message', target: recipient.id, text: 'Meet here if you choose.', location: true }] });
  tickWorld(world);
  assert.equal(world.messages.length, 0);
  tickWorld(world);
  assert.equal(world.messages.length, 1);
  assert.equal(sender.wood, wood - 1);
  assert.equal(sender.order.task.type, 'wait');
  assert.equal(sender.order.progress, 2, 'physical work continued concurrently');
  assert.equal(recipient.knowledge.people[sender.id].x, sender.x);
  assert.equal(outsider.knowledge.people[sender.id], undefined);
  assert.equal(recipient.pendingMessageId, world.messages[0].id);
  for (let i = 0; i < 4; i++) tickWorld(world);
  assert.equal(world.messages.length, 1);
  assert.equal(sender.actionResults.filter(r => r.task.type === 'message' && r.status === 'completed').length, 1);
});

test('phone failures cannot cancel physical orders, create wood, or send after death', () => {
  const world = createWorld(), [sender, recipient] = world.citizens;
  sender.wood = 0;
  install(world, sender, { tasks: [{ type: 'wait', ticks: 120 }], communications: [{ type: 'message', target: recipient.id, text: 'No credit.' }] });
  tickWorld(world); tickWorld(world);
  assert.equal(world.messages.length, 0);
  assert.equal(sender.wood, 0);
  assert.equal(sender.order.task.type, 'wait');
  assert.equal(sender.actionResults.at(-1).status, 'failed');
  sender.wood = 2;
  install(world, sender, { communications: [{ type: 'post', text: 'Too late.' }] });
  Object.assign(sender, { hunger: 100, health: 0.5 });
  tickWorld(world); tickWorld(world);
  assert.equal(world.board.length, 0);
});

test('phone replacement is explicit and invalid communications reject atomically', () => {
  const world = createWorld(), sender = world.citizens[0];
  install(world, sender, { communications: [{ type: 'post', text: 'Retained.' }] });
  tickWorld(world);
  install(world, sender, {});
  tickWorld(world);
  assert.equal(world.board[0].text, 'Retained.');
  install(world, sender, { communications: [{ type: 'post', text: 'Cancelled.' }] });
  tickWorld(world);
  install(world, sender, { communications: [] });
  tickWorld(world);
  assert.equal(world.board.length, 1);
  const before = structuredClone(sender);
  assert.throws(() => install(world, sender, { communications: [{ type: 'reproduce', target: 'citizen-2' }] }), /message and post/);
  assert.deepEqual(sender, before);
  assert.throws(() => install(world, sender, { communications: Array(3).fill({ type: 'post', text: 'x' }) }), /0–2/);
});

test('own pending phone actions and rejection feedback are bounded and private in model context', async () => {
  const world = createWorld(), [sender] = world.citizens;
  install(world, sender, { communications: [{ type: 'post', text: 'Pending.' }] });
  sender.lastError = 'Missing required amount';
  const context = planningContext(world, sender.id);
  context.neighbors[0].communications = [{ type: 'post', text: 'PRIVATE-PEER' }];
  let sent;
  const planner = createPlanner({ fetchImpl: async (_url, options) => {
    sent = JSON.parse(JSON.parse(options.body).messages[1].content);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"tasks":[],"work":null}' } }] }) };
  } });
  await planner.plan(context);
  assert.equal(sent.citizen.communications[0].text, 'Pending.');
  assert.equal(sent.citizen.lastPlanError, sender.lastError);
  assert.equal(sent.neighbors[0].communications, undefined);
});

test('proposalId is a lossless alias, while conflicting identifiers reject', () => {
  const world = createWorld(), citizen = world.citizens[0], context = planningContext(world, citizen.id);
  const result = normalizePlan({ tasks: [{ type: 'accept_family', proposalId: 'family-1' }] }, context);
  assert.equal(result.tasks[0].proposal, 'family-1');
  assert.throws(() => normalizePlan({ tasks: [{ type: 'accept_family', proposal: 'family-1', proposalId: 'family-2' }] }, context), /conflicting/);
});
