import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, planningContext, tickWorld, applyPlan, interruptForMessage, transactCitizenAction } from '../lib/world.mjs';
import { observeWorld } from '../lib/knowledge.mjs';
import { createCitizenToolSession, citizenObservation } from '../lib/citizen-tools.mjs';
import { createAgentPlanner } from '../lib/agent-planner.mjs';
import { normalizePlan } from '../lib/plans.mjs';
import { PlanResponseError } from '../lib/planner.mjs';
import { killCitizen } from '../lib/interactions.mjs';

function session(world, citizenId = 'citizen-1') {
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId, planId: 'test-turn' });
  tools.refresh();
  return tools;
}
function assertNoCoordinates(value) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.hasOwn(value, 'x'), false);
  assert.equal(Object.hasOwn(value, 'y'), false);
  for (const child of Object.values(value)) assertNoCoordinates(child);
}

test('a rejected decision reports independent task format and placement problems together without executing them', () => {
  const world = createWorld({ expanded: false }), actor = world.citizens[0];
  world.blocked = [];
  Object.assign(actor, { x: 2, y: 2 });
  world.nodes = [{ id: 'tree-check', kind: 'tree', x: 2, y: 2, stock: 1, yield: 5, regrowTicks: 120 }];
  observeWorld(world, actor);
  const tools = session(world), before = structuredClone(world);
  const rejected = tools.execute('commit_strategy', { tasks: [
    { type: 'rest', maxTicks: 20 },
    { type: 'collect', resource: 'wood', target: 'tree-check', area: 'south-east' },
  ], work: null });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.decisionApplied, false);
  assert.equal(rejected.taskProblems.length, 2);
  assert.match(rejected.taskProblems[0].errors[0], /maxTicks is unsupported/);
  assert.match(rejected.taskProblems[1].errors[0], /amount is required/);
  assert.match(rejected.taskProblems[1].errors[1], /outside your requested area/);
  assert.deepEqual(rejected.taskProblems[1].required, ['resource', 'amount']);
  assert.deepEqual(world, before);
});

test('the latest closed own escrow gives actual settlement evidence without exposing another citizen history', () => {
  const world = createWorld({ expanded: false }), [seller, buyer, observer] = world.citizens;
  seller.x = 2; seller.y = 2; buyer.x = 3; buyer.y = 2; seller.wood = 5; buyer.food = 5;
  const offer = transactCitizenAction(world, seller.id, { type: 'offer', give: 'wood', giveAmount: 2, want: 'food', wantAmount: 1 }, 'open-test');
  assert.equal(offer.ok, true);
  const id = world.offers.at(-1).id;
  assert.equal(citizenObservation(world, seller.id).ownOffer.id, id);
  applyPlan(world, buyer.id, normalizePlan({ tasks: [{ type: 'trade', offer: id }], work: null }, planningContext(world, buyer.id)));
  for (let i = 0; i < 6 && world.offers.at(-1).status === 'open'; i++) tickWorld(world);
  assert.equal(world.offers.at(-1).status, 'filled');
  const observation = citizenObservation(world, seller.id);
  assert.equal(observation.lastClosedOwnOffer.id, id);
  assert.equal(observation.lastClosedOwnOffer.status, 'filled');
  assert.equal(observation.ownOffer, null);
  assert.equal(citizenObservation(world, observer.id).lastClosedOwnOffer, undefined);
  assert.ok(!observation.eligibleExchanges.items.some(o => o.id === id), 'a filled history receipt is not an executable offer');
});

test('a final decision can queue a full reply while retaining physical effort, then send once', async () => {
  const world = createWorld({ expanded: false }), [actor, peer] = world.citizens;
  applyPlan(world, actor.id, normalizePlan({ tasks: [{ type: 'explore', ticks: 120 }], work: null }, planningContext(world, actor.id)));
  tickWorld(world);
  const order = actor.order, wood = actor.wood, text = 'A'.repeat(500), tools = session(world);
  let step = 0;
  const planner = createAgentPlanner({ fetchImpl: async () => {
    const current = step++;
    return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ id: `call-${current}`, function: {
      name: current < 5 ? 'get_mechanics' : 'continue_strategy',
      arguments: JSON.stringify(current < 5 ? { action: 'movement' } : { communications: [{ type: 'message', target: peer.id, text, location: true }] }),
    } }] } }], usage: {} }) };
  } });
  const result = await planner.plan(planningContext(world, actor.id), undefined, { toolSession: tools });
  assert.equal(result.steps, 6);
  assert.equal(world.messages.length, 0, 'a commitment is not a sent-message receipt');
  applyPlan(world, actor.id, result.plan);
  assert.equal(actor.order, order);
  assert.equal(citizenObservation(world, actor.id).citizen.communications[0].text, text);
  tickWorld(world); tickWorld(world);
  assert.equal(world.messages.length, 1);
  assert.equal(world.messages[0].text, text, '500-character native reply is not silently truncated');
  assert.equal(actor.wood, wood - 1);
  assert.equal(actor.order, order);
  assert.equal(order.startedAt, 1, 'communication did not restart the physical order');
});

test('queued correspondence rejects unknown reports and dead recipients atomically and uses actionable placement errors', () => {
  const world = createWorld({ expanded: false }), [actor, peer] = world.citizens, tools = session(world);
  const before = structuredClone(actor);
  assert.match(tools.execute('continue_strategy', { communications: [{ type: 'message', target: peer.id, text: 'Report', share: ['not-known'] }] }).error, /known/);
  assert.equal(tools.committed, null);
  assert.deepEqual(actor, before);
  assert.match(tools.execute('commit_strategy', { tasks: [{ type: 'message', target: peer.id, text: 'Reply' }] }).error, /communications/);
  world.dead.push({ id: 'dead-person', name: 'Dead Person' });
  assert.match(tools.execute('continue_strategy', { communications: [{ type: 'message', target: 'dead-person', text: 'Hello' }] }).error, /dead/);
  assert.equal(tools.committed, null);
});

test('explicit reply recipients allow lossless aliases but never infer public communication', () => {
  const world = createWorld({ expanded: false }), tools = session(world);
  assert.match(tools.execute('continue_strategy', { communications: [{ text: 'Private draft without a recipient' }] }).error, /type/);
  assert.equal(tools.committed, null);
  assert.match(tools.execute('continue_strategy', { communications: [{ to: 'citizen-2', target: 'citizen-3', text: 'Conflicting' }] }).error, /conflicting/);
  assert.equal(tools.execute('continue_strategy', { communications: [{ to: 'citizen-2', text: 'A clear private reply' }] }).ok, true);
  assert.deepEqual(tools.committed.plan.communications, [{ type: 'message', target: 'citizen-2', text: 'A clear private reply' }]);
  assert.equal(world.messages.length, 0);
  assert.equal(world.board.length, 0);
});

test('routine progress refreshes the next observation without extra messages or model queries', async () => {
  const world = createWorld({ expanded: false }), actor = world.citizens[0], tools = session(world), requests = [];
  const planner = createAgentPlanner({ fetchImpl: async (_, options) => {
    const body = JSON.parse(options.body), step = requests.length;
    requests.push(body);
    if (step === 0) { world.tick += 10; actor.food += 3; }
    return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ id: `call-${step}`, function: {
      name: step ? 'continue_strategy' : 'get_mechanics', arguments: JSON.stringify(step ? {} : { action: 'resources' }),
    } }] } }], usage: {} }) };
  } });
  const result = await planner.plan(planningContext(world, actor.id), undefined, { toolSession: tools });
  assert.equal(result.steps, 2);
  assert.equal(JSON.parse(requests[1].messages.at(-1).content).tick, 10);
  assert.equal(JSON.parse(requests[1].messages.at(-1).content).citizen.food, actor.food);
  assert.equal(requests[1].messages.filter(m => m.role === 'user').length, 1);
  assert.equal(result.reviewContext.tick, 10);
});

test('slow early reasoning reserves decision time even before the step limit', async () => {
  const world = createWorld({ expanded: false }), tools = session(world), requests = [];
  let clock = 0;
  const planner = createAgentPlanner({ now: () => clock, fetchImpl: async (_, options) => {
    const request = JSON.parse(options.body), step = requests.length;
    requests.push(request);
    clock += 80000;
    return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ id: `call-${step}`, function: {
      name: step ? 'continue_strategy' : 'get_mechanics', arguments: JSON.stringify(step ? {} : { action: 'resources' }),
    } }] } }], usage: {} }) };
  } });
  await planner.plan(planningContext(world, 'citizen-1'), undefined, { toolSession: tools });
  assert.deepEqual(requests[1].tools.map(t => t.function.name), ['continue_strategy', 'commit_strategy']);
  assert.match(requests[1].messages[0].content, /restriction is temporary/);
  assert.ok(JSON.parse(requests[1].messages.at(-1).content).capabilities.immediate.includes('open_offer'));
});

test('measured slow calls reserve room for a final decision before the fixed elapsed cutoff', async () => {
  const world = createWorld({ expanded: false }), tools = session(world), requests = [];
  let clock = 0;
  const durations = [15000, 25000, 30000, 35000];
  const planner = createAgentPlanner({ now: () => clock, fetchImpl: async (_, options) => {
    const body = JSON.parse(options.body), step = requests.length;
    requests.push(body);
    const final = body.tools.every(tool => ['continue_strategy', 'commit_strategy'].includes(tool.function.name));
    clock += durations[step] ?? 35000;
    if (clock > 120000) throw new Error('Controlled turn exceeded its deadline');
    return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ id: `call-${step}`, function: {
      name: final ? 'continue_strategy' : 'get_history', arguments: JSON.stringify({}),
    } }] } }], usage: {} }) };
  } });
  const result = await planner.plan(planningContext(world, 'citizen-1'), undefined, { toolSession: tools });
  assert.equal(result.steps, 4);
  assert.equal(clock, 105000, 'one more query before finalization would have made the controlled decision too late');
  assert.equal(result.plan.mode, 'continue');
  assert.ok(requests[3].tools.every(tool => ['continue_strategy', 'commit_strategy'].includes(tool.function.name)));
});

test('a closed trade returns only current eligible alternatives without an extra query', () => {
  const world = createWorld({ expanded: false }), [actor, maker, outsider] = world.citizens;
  const food = actor.food;
  const offer = transactCitizenAction(world, maker.id, { type: 'offer', give: 'food', giveAmount: 2, want: 'wood', wantAmount: 1 });
  transactCitizenAction(world, outsider.id, { type: 'offer', give: 'food', giveAmount: 2, want: 'wood', wantAmount: 1, recipient: maker.id });
  const tools = session(world);
  const failed = tools.execute('commit_strategy', { tasks: [{ type: 'trade', offer: 'gone-offer' }] });
  assert.equal(failed.ok, false);
  assert.equal(failed.exchanges.items.length, 1);
  assert.equal(failed.exchanges.items[0].id, offer.offer.id);
  assert.equal(failed.exchanges.items[0].youReceive.resource, 'food');
  assert.equal(tools.execute('commit_strategy', { tasks: [{ type: 'trade', offer: offer.offer.id }] }).ok, true);
  assert.equal(actor.food, food, 'validation did not settle the chosen exchange');
});

test('household context carries dated visible distress and personal memories without remote private state', () => {
  const world = createWorld({ expanded: false }), [parent, child] = world.citizens;
  world.citizens = [parent, child]; world.blocked = [];
  Object.assign(parent, { x: 1, y: 1, memories: ['Sprig died.'] });
  Object.assign(child, { x: 2, y: 1, parents: [parent.id], hunger: 100, health: 20, food: 9, wood: 30 });
  observeWorld(world, parent);
  world.tick = 100; Object.assign(child, { x: 15, y: 9, hunger: 0, health: 100 });
  const observation = citizenObservation(world, parent.id);
  const sighting = observation.household.members.find(p => p.id === child.id);
  assert.deepEqual(sighting.lastSeen.condition, { nourishment: 'starving', health: 'badly wounded' });
  assert.equal(sighting.lastSeen.ageTicks, 100);
  assert.equal(sighting.lastSeen.area, 'north-west');
  assert.ok(!JSON.stringify(sighting).includes('"food"'));
  assert.ok(!JSON.stringify(sighting).includes('"health":100'));
  assert.deepEqual(observation.recentMemories, ['Sprig died.']);
  assertNoCoordinates(observation);
});

test('a notified parent death remains visible after memory prose rolls away without exposing private corpse state', () => {
  const world = createWorld({ expanded: false }), [parent, actor, unrelated] = world.citizens;
  actor.parents = [parent.id]; parent.wood = 999;
  observeWorld(world, actor);
  assert.equal(citizenObservation(world, actor.id).household.members.find(p => p.id === parent.id).status, 'living');
  assert.equal(killCitizen(world, parent).ok, true);
  assert.equal(killCitizen(world, unrelated).ok, true);
  actor.memories = [];
  const household = citizenObservation(world, actor.id).household;
  const remembered = household.members.find(p => p.id === parent.id);
  assert.equal(remembered.status, 'deceased'); assert.equal(remembered.name, parent.name);
  assert.equal(remembered.lastSeen, undefined);
  assert.equal(remembered.health, undefined); assert.equal(remembered.wood, undefined);
  assert.ok(!JSON.stringify(household).includes('999'));
  assert.ok(!household.members.some(p => p.id === unrelated.id), 'unrelated deaths are not added to the household');
});

test('provider failures retain HTTP status and bounded Retry-After without retaining the body', async () => {
  const world = createWorld(), events = [];
  const planner = createAgentPlanner({ audit: { record: e => events.push(e) }, fetchImpl: async () => ({
    ok: false, status: 429, headers: { get: () => '120' }, text: async () => 'private provider body',
  }) });
  await assert.rejects(planner.plan(planningContext(world, 'citizen-1'), undefined, { toolSession: session(world) }), error => {
    assert.equal(error.httpStatus, 429);
    assert.equal(error.retryAfterMs, 120000);
    return true;
  });
  assert.equal(events.find(e => e.type === 'provider_error').httpStatus, 429);
  assert.ok(!JSON.stringify(events).includes('private provider body'));
});

test('an oversized tool batch returns complete error receipts without side effects and recovers to real chosen work', async () => {
  const world = createWorld(), actor = world.citizens[0], wood = actor.wood;
  let calls = 0;
  const planner = createAgentPlanner({ fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body), current = calls++;
    if (current === 1) {
      const receipts = request.messages.filter(m => m.role === 'tool');
      assert.equal(receipts.length, 8);
      for (const receipt of receipts) {
        const result = JSON.parse(receipt.content);
        assert.equal(result.ok, false); assert.match(result.error, /six tool calls.*rejected without execution/);
      }
    }
    return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: current === 0
      ? Array.from({ length: 8 }, (_, i) => ({ id: `oversized-${i}`, function: { name: 'post', arguments: JSON.stringify({ text: `Must not send ${i}` }) } }))
      : [{ id: 'recovered', function: { name: 'commit_strategy', arguments: JSON.stringify({ tasks: [{ type: 'craft', item: 'shoes' }], work: null }) } }] } }], usage: {} }) };
  } });
  const result = await planner.plan(planningContext(world, actor.id), undefined, { toolSession: session(world) });
  assert.equal(calls, 2); assert.equal(result.tools, 9); assert.equal(planner.metrics.toolErrors, 8);
  assert.equal(actor.wood, wood); assert.equal(world.board.length, 0, 'no rejected post spent wood or appeared on the board');
  actor.wood = 10; applyPlan(world, actor.id, result.plan);
  for (let i = 0; i < 6; i++) tickWorld(world);
  assert.equal(actor.shoes, true, 'the corrected decision actually executes');
});

test('a retired cached model reports a permanent failure and cannot be retried or revalidated from the local catalog', async () => {
  const world = createWorld(), events = [], settlements = [];
  let calls = 0, bodyReads = 0;
  const planner = createAgentPlanner({ model: 'retired:cloud', audit: { record: e => events.push(e) },
    budget: { reserve: () => 'reservation', settle: (...args) => settlements.push(args) },
    fetchImpl: async url => {
      calls++;
      if (url.endsWith('/models')) return { ok: true, json: async () => ({ data: [{ id: 'retired:cloud' }] }) };
      return { ok: false, status: 410, headers: { get: () => '60' },
        json: async () => { bodyReads++; return { error: 'private account details' }; } };
    } });
  await planner.check();
  const pending = () => planner.plan(planningContext(world, 'citizen-1'), undefined, { toolSession: session(world) });
  await assert.rejects(pending(), error => {
    assert.equal(error.httpStatus, 410); assert.equal(error.retryable, false);
    assert.match(error.message, /retired:cloud.*no longer available/);
    assert.match(error.message, /supported PROSPER_MODEL/); return true;
  });
  await assert.rejects(planner.check(), /no longer available/);
  await assert.rejects(pending(), /no longer available/);
  assert.equal(calls, 2, 'local presence cannot undo remote retirement or send another paid request');
  assert.equal(bodyReads, 0); assert.deepEqual(settlements, [['reservation', null]]);
  assert.equal(events.find(e => e.type === 'provider_error').retryable, false);
  assert.ok(!JSON.stringify(events).includes('private account details'));
});

test('citizens cannot choose deliberate waiting; recovery and productive follow-on work remain available', () => {
  const world = createWorld(), citizen = world.citizens[0], tools = session(world);
  const before = structuredClone(citizen);
  const rejected = tools.execute('commit_strategy', { tasks: [{ type: 'wait', ticks: 120 }], work: null });
  assert.equal(rejected.ok, false);
  assert.equal(tools.committed, null);
  assert.deepEqual(citizen, before, 'invalid waiting does not alter ongoing execution');
  const result = tools.execute('commit_strategy', { tasks: [{ type: 'rest' }], work: { type: 'gather', resource: 'wood' } });
  assert.equal(result.ok, true);
  applyPlan(world, citizen.id, tools.committed.plan);
  for (let i = 0; i < 6; i++) tickWorld(world);
  assert.equal(citizen.order.task.type, 'gather');
  assert.equal(citizen.order.task.resource, 'wood');
});

test('resource and area queries expose dated observed work rather than remote competition truth', () => {
  const world = createWorld({ expanded: false }), citizen = world.citizens[0], peer = world.citizens[1];
  const node = world.nodes.find(n => n.kind === 'crop' && citizen.knowledge.nodes[n.id]);
  Object.assign(citizen, { x: node.x, y: node.y });
  Object.assign(peer, { x: node.x, y: node.y, current: { task: { type: 'harvest', target: node.id } } });
  observeWorld(world, citizen);
  const tools = session(world);
  const before = tools.execute('find_resources', { resource: 'food' }).items.find(n => n.id === node.id);
  assert.deepEqual(before.lastSeenHarvesters, [{ id: peer.id, ageTicks: 0 }]);
  assert.deepEqual(citizenObservation(world, citizen.id).currentPlace.lastSeenPeople.find(p => p.id === peer.id).observedActivity,
    { type: 'harvesting', resource: 'food', target: node.id });
  peer.x = world.width - 1; peer.y = world.height - 1; peer.current = { task: { type: 'craft', item: 'weapon' } };
  world.tick += 20;
  observeWorld(world, citizen);
  const after = tools.execute('find_resources', { resource: 'food' }).items.find(n => n.id === node.id);
  assert.deepEqual(after.lastSeenHarvesters, [{ id: peer.id, ageTicks: 20 }]);
  assertNoCoordinates(tools.execute('get_people', {}));
  const contact = tools.execute('get_people', {}).items.find(p => p.id === peer.id).lastLocation;
  assert.deepEqual(contact.observedActivity, { type: 'harvesting', resource: 'food', target: node.id });
  assert.equal(contact.observedEquipment.weaponLevel, 0, 'unseen crafting does not update equipped evidence');
  assert.equal(contact.weaponDurability, undefined);
});

test('semantic information hides coordinates, unseen resources and peer private state', () => {
  const world = createWorld({ expanded: false });
  const tools = session(world);
  const before = tools.execute('find_resources', { resource: 'food' });
  const seen = new Set(before.items.map(n => n.id));
  assert.ok(!seen.has('crop-4'));
  world.nodes.find(n => n.id === 'crop-4').stock = 0;
  world.citizens[1].food = 999;
  assert.deepEqual(tools.execute('find_resources', { resource: 'food' }), before);
  for (const output of [citizenObservation(world, 'citizen-1'), before, tools.execute('get_people', {}), tools.execute('get_places', {}), tools.execute('get_buildings', {})]) assertNoCoordinates(output);
  assert.ok(!JSON.stringify(tools.execute('get_people', {})).includes('999'));
  assert.equal(tools.execute('find_resources', { resource: 'food', area: 'forest' }).ok, false);
});

test('offer receipt chains into a message, charges once and preserves physical progress', () => {
  const world = createWorld({ expanded: false }), citizen = world.citizens[0];
  applyPlan(world, citizen.id, normalizePlan({ tasks: [{ type: 'craft', item: 'tool' }], work: null }, planningContext(world, citizen.id)));
  const tools = session(world);
  const previousTasks = structuredClone(citizen.tasks);
  const offer = tools.execute('open_offer', { give: 'food', giveAmount: 2, want: 'wood', wantAmount: 4, recipient: 'citizen-2' });
  assert.equal(offer.ok, true);
  assert.equal(offer.receiptId, 'offer-1');
  const message = tools.execute('send_private_message', { to: 'citizen-2', text: `Offer ${offer.receiptId} is available.`, location: true });
  assert.equal(message.ok, true);
  assert.equal(message.inventory.wood, 4);
  assert.equal(citizen.food, 2);
  assert.deepEqual(citizen.tasks, previousTasks);
  assert.equal(world.messages[0].text, 'Offer offer-1 is available.');
  const commit = tools.execute('continue_strategy', {});
  assert.equal(commit.ok, true, commit.error);
  assert.equal(tools.execute('open_offer', { give: 'wood', giveAmount: 1, want: 'food', wantAmount: 1 }).ok, false);
});

test('opening a second offer requires explicit replacement and reports cancellation and refund', () => {
  const world = createWorld({ expanded: false }), tools = session(world);
  const terms = { give: 'food', giveAmount: 2, want: 'wood', wantAmount: 4, recipient: 'citizen-2' };
  const first = tools.execute('open_offer', terms);
  const before = structuredClone(world);
  const accidental = tools.execute('open_offer', { ...terms, recipient: 'citizen-3' });
  assert.equal(accidental.ok, false);
  assert.match(accidental.error, /cannot keep both offers open/);
  assert.equal(accidental.currentOffer.id, first.receiptId);
  assert.deepEqual(world, before, 'another recipient does not silently cancel the first offer');
  assert.equal(tools.execute('open_offer', { ...terms, replaceOfferId: 'offer-999' }).ok, false);
  assert.deepEqual(world, before);
  const second = tools.execute('open_offer', { ...terms, recipient: 'citizen-3', replaceOfferId: first.receiptId });
  assert.equal(second.ok, true);
  assert.equal(second.activeOfferId, 'offer-2');
  assert.equal(second.offer.recipient, 'citizen-3');
  assert.deepEqual(second.replacedOffer, { id: 'offer-1', status: 'cancelled', refunded: { resource: 'food', amount: 2 } });
  assert.equal(world.citizens[0].food, 2, 'old escrow refunded before new escrow charged');
  assert.deepEqual(world.offers.map(o => o.status), ['cancelled', 'open']);
  assert.match(second.note, /offer-1 is cancelled/);
  const after = structuredClone(world);
  assert.equal(tools.execute('open_offer', { ...terms, giveAmount: 100, replaceOfferId: second.receiptId }).ok, false);
  assert.deepEqual(world.offers, after.offers, 'unaffordable deliberate replacement preserves existing escrow');
  assert.equal(world.citizens[0].food, after.citizens[0].food);
  assert.equal(world.nextOfferId, after.nextOfferId);
});

test('a stale replacement ID cannot silently open a different offer after the original closes', () => {
  const world = createWorld({ expanded: false }), tools = session(world), before = structuredClone(world);
  assert.equal(tools.execute('open_offer', { give: 'food', giveAmount: 1, want: 'wood', wantAmount: 1, replaceOfferId: 'offer-1' }).ok, false);
  assert.deepEqual(world, before);
});

test('oversized correspondence returns a bounded draft for explicit review without sending', () => {
  const world = createWorld({ expanded: false }), tools = session(world), wood = world.citizens[0].wood;
  const result = tools.execute('send_private_message', { to: 'citizen-2', text: 'word '.repeat(150), location: true });
  assert.equal(result.ok, false);
  assert.equal(world.messages.length, 0);
  assert.equal(world.citizens[0].wood, wood);
  assert.ok(result.suggestedArguments.text.length <= 500);
  assert.ok(result.suggestedArguments.text.endsWith('…'));
  assert.match(result.note, /omits the ending/);
  assert.equal(tools.execute('send_private_message', result.suggestedArguments).ok, true);
  assert.equal(world.messages.length, 1);
  assert.equal(world.citizens[0].wood, wood - 1);
});

test('report attachment errors identify their capability without spending or exposing private IDs', () => {
  const world = createWorld({ expanded: false }), tools = session(world), wood = world.citizens[0].wood;
  const offer = tools.execute('open_offer', { give: 'food', giveAmount: 1, want: 'wood', wantAmount: 2 });
  const result = tools.execute('post_public_message', { text: `See ${offer.receiptId}`, share: [offer.receiptId] });
  assert.match(result.error, /Reference an offer ID in text/);
  assert.equal(world.board.length, 0);
  assert.equal(world.citizens[0].wood, wood);
  assert.equal(tools.execute('post_public_message', { text: `See ${offer.receiptId}` }).ok, true);
});

test('area supply rates derive only from known snapshots and disclose their limits', () => {
  const world = createWorld({ expanded: false }), tools = session(world);
  const places = tools.execute('get_places', {});
  const northWest = places.areas.find(p => p.id === 'north-west');
  assert.ok(northWest.idealFoodPer100Ticks > 0);
  assert.equal(northWest.yourRawFoodNeedPer100Ticks, 0.71);
  assert.match(northWest.supplyNote, /Upper bound from known sites/);
  const east = places.areas.find(p => p.id === 'south-east');
  assert.equal(east.idealFoodPer100Ticks, 0);
  world.nodes.filter(n => n.x > 8).forEach(n => { n.stock = 0; n.yield = 999; });
  assert.deepEqual(tools.execute('get_places', {}), places);
});

test('bad mutations have no effect; stale mail requires refresh within the turn', () => {
  const world = createWorld({ expanded: false }), tools = session(world);
  const before = JSON.stringify(world);
  assert.equal(tools.execute('open_offer', { give: 'food', giveAmount: -1, want: 'wood', wantAmount: 1 }).ok, false);
  assert.equal(tools.execute('send_private_message', { to: 'citizen-2', text: 'hi', share: ['unknown'] }).ok, false);
  assert.equal(JSON.stringify(world), before);
  world.messages.push({ id: 'message-99', senderId: 'citizen-2', recipientId: 'citizen-1', text: 'new', tick: 0 });
  assert.match(tools.execute('commit_strategy', { tasks: [], work: null }).error, /New private mail/);
  tools.execute('get_context', {});
  assert.equal(tools.execute('commit_strategy', { tasks: [], work: null }).ok, true);
});

test('a failure occurring during reasoning must be observed before continuation', () => {
  const world = createWorld({ expanded: false }), tools = session(world);
  world.citizens[0].planBlocked = 'materials consumed elsewhere';
  assert.match(tools.execute('continue_strategy', {}).error, /failed during reasoning/);
  tools.execute('get_context', {});
  assert.equal(tools.execute('continue_strategy', {}).ok, true);
});

test('stale decision returns fresh evidence without applying it or requiring a separate query', () => {
  const world = createWorld({ expanded: false }), tools = session(world), citizen = world.citizens[0];
  world.messages.push({ id: 'message-99', senderId: 'citizen-2', recipientId: citizen.id, text: 'changed circumstances', tick: 0 });
  const before = structuredClone(citizen.tasks);
  const stale = tools.execute('commit_strategy', { tasks: [{ type: 'rest' }], work: null });
  assert.equal(stale.ok, false);
  assert.equal(stale.context.inbox.at(-1).id, 'message-99');
  assertNoCoordinates(stale.context);
  assert.equal(tools.committed, null);
  assert.deepEqual(citizen.tasks, before);
  assert.equal(tools.execute('continue_strategy', {}).ok, true);
  assert.equal(tools.committed.reviewContext.inbox.at(-1).id, 'message-99');
});

test('event polling surfaces new evidence but routine progress does not produce updates', () => {
  const world = createWorld({ expanded: false }), tools = session(world);
  tickWorld(world);
  assert.equal(tools.pollUpdates(), null);
  world.citizens[0].planBlocked = 'route unavailable';
  const update = tools.pollUpdates();
  assert.match(update.changes[0], /failed during reasoning/);
  assert.equal(update.context.citizen.execution.blockedBy, 'route unavailable');
  assert.equal(tools.pollUpdates(), null);
});

test('completed gifts refresh the decision, while receipts and routine harvesting do not', () => {
  const world = createWorld({ expanded: false }), [actor, peer] = world.citizens;
  Object.assign(actor, { x: 2, y: 1, food: 20, wood: 20, hunger: 0, asyncReview: true });
  Object.assign(peer, { x: 3, y: 1, hunger: 0 });
  applyPlan(world, actor.id, normalizePlan({ tasks: [{ type: 'give', target: peer.id, resource: 'wood', amount: 2 }], work: null }, planningContext(world, actor.id)));
  const tools = session(world);
  for (let i = 0; i < 4; i++) tickWorld(world);
  const update = tools.pollUpdates();
  assert.match(update.changes.join(' '), /consequential action completed/);
  assert.equal(update.context.completedActions.items.at(-1).task.type, 'give');
  assert.equal(tools.pollUpdates(), null);
  assert.equal(tools.execute('send_private_message', { to: peer.id, text: 'Delivery completed.' }).ok, true);
  assert.equal(tools.pollUpdates(), null, 'a synchronous receipt does not create an unseen completion');
  applyPlan(world, actor.id, normalizePlan({ tasks: [{ type: 'gather', resource: 'food', amount: 1 }], work: null }, planningContext(world, actor.id)));
  const before = actor.food;
  for (let i = 0; i < 12; i++) tickWorld(world);
  assert.ok(actor.food > before);
  assert.equal(tools.pollUpdates(), null, 'routine harvest completion does not interrupt reasoning');
  // Repeating a gift deliberately remains legal after the evidence was reviewed.
  assert.equal(tools.execute('commit_strategy', { tasks: [{ type: 'give', target: peer.id, resource: 'wood', amount: 2 }] }).ok, true);
});

test('a gift completed during a provider call rejects stale replacement and permits reconsideration', async () => {
  const world = createWorld({ expanded: false }), [actor, peer] = world.citizens, requests = [];
  Object.assign(actor, { food: 20, wood: 20, hunger: 0, asyncReview: true });
  Object.assign(peer, { x: actor.x, y: actor.y + 1, hunger: 0 });
  applyPlan(world, actor.id, normalizePlan({ tasks: [{ type: 'give', target: peer.id, resource: 'food', amount: 2 }, { type: 'wait', ticks: 100 }], work: null }, planningContext(world, actor.id)));
  const tools = session(world);
  const planner = createAgentPlanner({ fetchImpl: async (_url, options) => {
    const step = requests.length;
    requests.push(JSON.parse(options.body));
    if (step === 0) for (let i = 0; i < 5; i++) tickWorld(world);
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: `gift-${step}`, type: 'function', function: {
      name: step === 0 ? 'commit_strategy' : 'continue_strategy',
      arguments: JSON.stringify(step === 0 ? { tasks: [{ type: 'give', target: peer.id, resource: 'food', amount: 2 }] } : {}),
    } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) };
  } });
  const result = await planner.plan(planningContext(world, actor.id), undefined, { toolSession: tools });
  assert.equal(requests.length, 2);
  const evidence = JSON.parse(requests[1].messages.findLast(m => m.role === 'tool').content);
  assert.equal(evidence.ok, false);
  assert.match(evidence.error, /consequential action completed/);
  assert.equal(JSON.parse(requests[1].messages.at(-1).content).completedActions.items.at(-1).task.type, 'give');
  applyPlan(world, actor.id, result.plan);
  for (let i = 0; i < 12; i++) tickWorld(world);
  assert.equal(world.stats.transfers, 1, 'reconsideration preserves the remainder without repeating the old gift');
  assert.equal(result.reviewContext.citizen.completedActionRevision, 1);
});

test('native loop receives a racing event with rejection and can decide again in the next step', async () => {
  const world = createWorld({ expanded: false }), tools = session(world), requests = [];
  const planner = createAgentPlanner({ fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body), step = requests.length;
    requests.push(body);
    if (step === 0) world.messages.push({ id: 'message-99', senderId: 'citizen-2', recipientId: 'citizen-1', text: 'change of plan', tick: 0 });
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: `call-${step}`, type: 'function', function: { name: 'continue_strategy', arguments: '{}' } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) };
  } });
  const result = await planner.plan(planningContext(world, 'citizen-1'), undefined, { toolSession: tools });
  assert.equal(result.steps, 2);
  const evidence = JSON.parse(requests[1].messages.findLast(m => m.role === 'tool').content);
  assert.equal(evidence.ok, false);
  assert.equal(JSON.parse(requests[1].messages.at(-1).content).inbox.at(-1).id, 'message-99');
  assert.equal(result.reviewContext.inbox.at(-1).id, 'message-99');
});

test('notes are projected without affecting executable fields or simulation bookkeeping', () => {
  const world = createWorld({ expanded: false }), tools = session(world);
  const result = tools.execute('continue_strategy', { memory: 'm'.repeat(500), goals: ['one', 'two', 'three', 'four'],
    undertaking: { objective: 'chosen project', success: 'observable completion', status: 'active', completedActions: 999, startedAt: -1 } });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.notes.memory.length, 200);
  assert.equal(result.notes.goals.length, 3);
  applyPlan(world, 'citizen-1', tools.committed.plan);
  assert.equal(world.citizens[0].undertaking.completedActions, 0);
  assert.equal(world.citizens[0].undertaking.startedAt, 0);
});

test('native scheduled reflection defaults to 600 ticks, honors earlier choices and leaves legacy normalization unchanged', () => {
  for (const name of ['commit_strategy', 'continue_strategy']) for (const horizon of [undefined, 180, 420]) {
    const world = createWorld({ expanded: false }), actor = world.citizens[0], tools = session(world);
    const result = tools.execute(name, horizon === undefined ? {} : { reviewAfter: horizon });
    assert.equal(result.ok, true, result.error);
    assert.equal(tools.committed.plan.reviewAfter, horizon ?? 600);
    applyPlan(world, actor.id, tools.committed.plan);
    assert.equal(actor.reviewAt, world.tick + (horizon ?? 600));
  }
  assert.equal(normalizePlan({ tasks: [{ type: 'rest' }], work: null }).reviewAfter, 300);
});

test('action schemas distinguish quantities, destinations and consumed family consent', () => {
  const world = createWorld({ expanded: false }), tools = session(world);
  const malformed = tools.execute('commit_strategy', { tasks: [{ type: 'ensure_inventory', resource: 'food', amount: 4 }] });
  assert.match(malformed.error, /minimum is required/);
  assert.deepEqual(malformed.taskFormat.required, ['resource', 'minimum']);
  assert.deepEqual(malformed.taskFormat.optional, ['area']);
  assert.match(malformed.taskFormat.minimumMeans, /TOTAL inventory/);
  assert.equal(tools.committed, null, 'the format receipt does not repair or execute a malformed task');
  assert.match(tools.execute('commit_strategy', { tasks: [{ type: 'bake', building: 'bakery', amount: 4 }] }).error, /target is required/);
  assert.match(tools.execute('commit_strategy', { tasks: [{ type: 'reproduce', target: 'citizen-3' }] }).error, /current accepted pairing/);
  assert.equal(tools.committed, null);
});

test('structured work can be JSON encoded, but executable contradictions still reject', () => {
  const world = createWorld({ expanded: false }), tools = session(world);
  assert.match(tools.execute('commit_strategy', { work: '{"type":"gather","resource":"food","amount":2}' }).error, /amount is unsupported/);
  assert.equal(tools.committed, null);
  assert.equal(tools.execute('commit_strategy', { work: '{"type":"gather","resource":"food"}' }).ok, true);
});

test('family tools return consent state and require review of external changes', () => {
  const world = createWorld({ expanded: false }), proposer = session(world, 'citizen-1'), recipient = session(world, 'citizen-3');
  const proposal = proposer.execute('propose_family', { to: 'citizen-3', location: true });
  assert.equal(proposal.ok, true);
  assert.equal(proposal.family[0].status, 'pending');
  assert.match(recipient.execute('continue_strategy', {}).error, /Family consent changed/);
  recipient.refresh();
  const acceptance = recipient.execute('accept_family', { proposalId: proposal.receiptId, location: true });
  assert.equal(acceptance.ok, true);
  assert.equal(acceptance.family[0].status, 'accepted');
  assert.equal(recipient.execute('continue_strategy', {}).ok, true);
  assert.match(proposer.execute('continue_strategy', {}).error, /Family consent changed/);
  proposer.refresh();
  assert.equal(proposer.execute('continue_strategy', {}).ok, true);
});

test('an unrelated consent update permits independent work while retaining an unreviewed family revision', () => {
  const world = createWorld({ expanded: false }), actor = world.citizens[0];
  world.familyProposals = [{ id: 'pair', makerId: actor.id, recipientId: 'citizen-3', status: 'accepted', createdAt: 0, updatedAt: 0, expiresAt: 1000 }];
  const tools = session(world);
  world.familyProposals[0].status = 'fulfilled'; actor.familyRevision = 1;
  assert.equal(tools.execute('commit_strategy', { tasks: [{ type: 'collect', resource: 'wood', amount: 2 }], work: { type: 'gather', resource: 'food' } }).ok, true);
  assert.equal(tools.committed.reviewContext.familyProposals[0].status, 'accepted', 'a successful independent plan does not pretend this event was reviewed');
  assert.notEqual(tools.committed.reviewContext.citizen.familyRevision ?? 0, actor.familyRevision);
  const reproduction = session(world);
  assert.equal(reproduction.execute('commit_strategy', { tasks: [{ type: 'reproduce', target: 'citizen-3' }] }).ok, false);
  assert.equal(reproduction.committed, null);
});

test('guessed private offer IDs do not disclose whether inaccessible escrow exists', () => {
  const world = createWorld({ expanded: false }), tools = session(world);
  transactCitizenAction(world, 'citizen-2', { type: 'offer', give: 'food', giveAmount: 1, want: 'wood', wantAmount: 1, recipient: 'citizen-3' });
  const privateAttempt = tools.execute('commit_strategy', { tasks: [{ type: 'trade', offer: 'offer-1' }] });
  const missingAttempt = tools.execute('commit_strategy', { tasks: [{ type: 'trade', offer: 'offer-999' }] });
  assert.deepEqual(privateAttempt, missingAttempt);
  assert.equal(tools.committed, null);
});

test('inventory directive accounts for consumption and scopes discretionary gathering', () => {
  const world = createWorld({ expanded: false }), citizen = world.citizens[0], tools = session(world);
  citizen.food = 1; citizen.hunger = 59;
  assert.equal(tools.execute('commit_strategy', { tasks: [{ type: 'ensure_inventory', resource: 'food', minimum: 2, area: 'north-west' }], work: null }).ok, true);
  applyPlan(world, citizen.id, tools.committed.plan);
  for (let i = 0; i < 220 && (citizen.tasks.length || citizen.order); i++) tickWorld(world);
  assert.equal(citizen.planBlocked, undefined);
  assert.ok(citizen.food >= 2);
  assert.equal(citizen.actionResults.findLast(r => r.task.type === 'acquire')?.status, 'completed');
});

test('minimum stock maps to durable inventory semantics and describes retained execution consistently', () => {
  const world = createWorld({ expanded: false }), citizen = world.citizens[0], tools = session(world);
  citizen.wood = 4;
  const receipt = tools.execute('commit_strategy', { tasks: [{ type: 'ensure_inventory', resource: 'wood', minimum: 5 }], work: null });
  assert.equal(receipt.ok, true);
  assert.deepEqual(receipt.tasks[0], { type: 'ensure_inventory', resource: 'wood', minimum: 5 });
  applyPlan(world, citizen.id, tools.committed.plan);
  tickWorld(world);
  assert.equal(citizen.order.task.type, 'acquire');
  const observation = citizenObservation(world, citizen.id);
  assert.deepEqual(observation.citizen.order, receipt.tasks[0]);
  assert.equal(observation.citizen.execution.inventoryTarget.minimum, 5);
  assert.equal(observation.citizen.execution.inventoryTarget.gap, 1);
  for (let i = 0; i < 100 && citizen.order; i++) tickWorld(world);
  assert.ok(citizen.wood >= 5);
  assert.equal(citizen.actionResults.findLast(r => r.task.type === 'acquire')?.status, 'completed');
});

test('a durable inventory target survives the legacy timeout and exposes stalled progress', () => {
  const world = createWorld({ expanded: false }), citizen = world.citizens[0], tools = session(world);
  for (const c of world.citizens) c.food = 100;
  citizen.wood = 0; citizen.asyncReview = true;
  for (const node of world.nodes.filter(n => n.kind === 'tree')) { node.stock = 0; node.regrowIn = 10000; }
  citizen.knowledge.nodes = Object.fromEntries(world.nodes.map(n => [n.id, { ...n, source: 'seen', observedAt: 0 }]));
  citizen.knowledge.explored = Array.from({ length: world.width * world.height }, (_, i) => `${i % world.width},${Math.floor(i / world.width)}`);
  assert.equal(tools.execute('commit_strategy', { tasks: [{ type: 'ensure_inventory', resource: 'wood', minimum: 20 }] }).ok, true);
  applyPlan(world, citizen.id, tools.committed.plan);
  for (let i = 0; i < 750; i++) tickWorld(world);
  assert.equal(citizen.order.task.type, 'acquire');
  assert.equal(citizen.planBlocked, undefined);
  const target = citizenObservation(world, citizen.id).citizen.execution.inventoryTarget;
  assert.equal(target.minimum, 20);
  assert.equal(target.current, 0);
  assert.equal(target.gap, 20);
  assert.ok(target.elapsedTicks >= 749);
  assert.equal(Object.hasOwn(citizenObservation(world, citizen.id).citizen.execution, 'completedUnits'), false);
  assert.ok(target.ticksSinceNewPeak > 600);
});

test('semantic build resolves an explored site and asynchronous mail preserves work', () => {
  const world = createWorld({ expanded: false }), citizen = world.citizens[0], tools = session(world);
  citizen.wood = 60;
  assert.equal(tools.execute('commit_strategy', { tasks: [{ type: 'build', building: 'bakery', area: 'north-west' }], work: { type: 'bake', target: 'own' } }).ok, true);
  applyPlan(world, citizen.id, tools.committed.plan);
  tickWorld(world);
  const current = citizen.current;
  citizen.asyncReview = true;
  interruptForMessage(citizen, 'message-1');
  assert.equal(citizen.current, current);
  for (let i = 0; i < 60; i++) tickWorld(world);
  assert.equal(world.stats.built, 1);
});

test('urgent needs allow a chosen nearby food trade instead of overriding it with forage', () => {
  const world = createWorld({ expanded: false }), buyer = world.citizens[0], seller = world.citizens[1];
  buyer.x = 3; buyer.y = 2; seller.x = 4; seller.y = 2;
  buyer.food = 0; buyer.wood = 20; buyer.hunger = 90; buyer.asyncReview = true;
  seller.food = 8; seller.hunger = 10;
  observeWorld(world, buyer);
  const receipt = transactCitizenAction(world, seller.id, { type: 'offer', give: 'food', giveAmount: 4, want: 'wood', wantAmount: 8 });
  applyPlan(world, buyer.id, normalizePlan({ tasks: [{ type: 'trade', offer: receipt.receiptId }], work: null }, planningContext(world, buyer.id)));
  for (let i = 0; i < 4; i++) tickWorld(world);
  assert.equal(world.stats.trades, 1);
  assert.equal(buyer.wood, 12);
  assert.ok(buyer.hunger < 60);
});

test('urgent needs preserve a feasible chosen bake, while an unfunded trade falls back to forage', () => {
  const world = createWorld({ expanded: false }), citizen = world.citizens[0];
  citizen.food = 3; citizen.wood = 60; citizen.hunger = 10;
  const tools = session(world);
  assert.equal(tools.execute('commit_strategy', { tasks: [{ type: 'build', building: 'bakery' }], work: null }).ok, true);
  applyPlan(world, citizen.id, tools.committed.plan);
  for (let i = 0; i < 35; i++) tickWorld(world);
  citizen.asyncReview = true; citizen.food = 1; citizen.hunger = 87.5; citizen.energy = 80;
  applyPlan(world, citizen.id, normalizePlan({ tasks: [{ type: 'bake', target: 'own', amount: 1 }], work: null }, planningContext(world, citizen.id)));
  for (let i = 0; i < 10; i++) tickWorld(world);
  assert.equal(world.stats.baked, 1);
  assert.ok(citizen.hunger < 35, 'bread feeds the citizen rather than premature raw-food consumption');

  const seller = world.citizens[1]; seller.x = citizen.x + 1; seller.y = citizen.y; seller.food = 8;
  observeWorld(world, citizen);
  const offer = transactCitizenAction(world, seller.id, { type: 'offer', give: 'food', giveAmount: 4, want: 'wood', wantAmount: 100 });
  citizen.hunger = 70; citizen.food = 0;
  applyPlan(world, citizen.id, normalizePlan({ tasks: [{ type: 'trade', offer: offer.receiptId }], work: null }, planningContext(world, citizen.id)));
  tickWorld(world);
  assert.equal(citizen.gatherTarget?.resource, 'food');
  assert.equal(world.stats.trades, 0);
});

test('a hungry citizen can prepare an observed small wood payment for a chosen food trade', () => {
  const world = createWorld({ expanded: false }), [buyer, seller] = world.citizens;
  world.citizens = [buyer, seller]; world.blocked = [];
  world.nodes = [{ id: 'tree-payment', kind: 'tree', x: 2, y: 2, capacity: 1, stock: 1, yield: 5, regrowTicks: 120, regrowIn: 0 }];
  Object.assign(buyer, { x: 2, y: 2, food: 0, wood: 0, hunger: 100, health: 40, energy: 100, asyncReview: true });
  buyer.knowledge = { nodes: {}, people: {}, explored: [] };
  Object.assign(seller, { x: 3, y: 2, food: 20, hunger: 0, energy: 100 });
  observeWorld(world, buyer);
  const offer = transactCitizenAction(world, seller.id, { type: 'offer', give: 'food', giveAmount: 4, want: 'wood', wantAmount: 3 });
  applyPlan(world, buyer.id, normalizePlan({ tasks: [{ type: 'trade', offer: offer.receiptId }], work: null }, planningContext(world, buyer.id)));
  for (let i = 0; i < 20 && buyer.hunger >= 60; i++) tickWorld(world);
  assert.equal(world.stats.trades, 1);
  assert.ok(buyer.hunger < 60);
  assert.ok(buyer.alive);
  assert.equal(buyer.wood, 2);
  assert.equal(world.stats.harvestedWood, 5);
});

test('small-payment permission stops when observed stock is gone or survival time is insufficient', () => {
  for (const stock of [0, 1]) {
    const world = createWorld({ expanded: false }), [buyer, seller] = world.citizens;
    world.citizens = [buyer, seller]; world.blocked = [];
    world.nodes = [{ id: 'tree-payment', kind: 'tree', x: 2, y: 2, capacity: 1, stock, yield: 5, regrowTicks: 120, regrowIn: stock ? 0 : 120 },
      { id: 'crop', kind: 'crop', x: 3, y: 2, capacity: 1, stock: 1, yield: 1, regrowTicks: 99, regrowIn: 0 }];
    Object.assign(buyer, { x: 2, y: 2, food: 0, wood: 0, hunger: 100, health: stock ? 4 : 40, energy: 100, asyncReview: true });
    buyer.knowledge = { nodes: {}, people: {}, explored: [] };
    Object.assign(seller, { x: 3, y: 3, food: 20, hunger: 0, energy: 100 });
    observeWorld(world, buyer);
    const offer = transactCitizenAction(world, seller.id, { type: 'offer', give: 'food', giveAmount: 4, want: 'wood', wantAmount: 3 });
    applyPlan(world, buyer.id, normalizePlan({ tasks: [{ type: 'trade', offer: offer.receiptId }], work: null }, planningContext(world, buyer.id)));
    tickWorld(world);
    assert.equal(buyer.gatherTarget.resource, 'food');
    assert.equal(world.stats.harvestedWood, 0);
  }
});

function mealPaymentWorld({ secondStock = 1, health = 40, secondX = 3 } = {}) {
  const world = createWorld({ expanded: false }), [buyer, seller] = world.citizens;
  world.citizens = [buyer, seller]; world.blocked = [];
  world.nodes = [
    { id: 'tree-payment-1', kind: 'tree', x: 2, y: 2, capacity: 1, stock: 1, yield: 5, regrowTicks: 120, regrowIn: 0 },
    { id: 'tree-payment-2', kind: 'tree', x: secondX, y: 2, capacity: 1, stock: secondStock, yield: 5, regrowTicks: 120, regrowIn: secondStock ? 0 : 120 },
    { id: 'crop-payment', kind: 'crop', x: 2, y: 3, capacity: 1, stock: 1, yield: 1, regrowTicks: 99, regrowIn: 0 },
  ];
  Object.assign(buyer, { x: 2, y: 2, food: 0, wood: 0, hunger: 100, health, energy: 100, asyncReview: true });
  buyer.knowledge = { nodes: {}, people: {}, explored: [] };
  Object.assign(seller, { x: 4, y: 2, food: 20, hunger: 0, energy: 100 });
  observeWorld(world, buyer);
  const offer = transactCitizenAction(world, seller.id, { type: 'offer', give: 'food', giveAmount: 4, want: 'wood', wantAmount: 8 });
  applyPlan(world, buyer.id, normalizePlan({ tasks: [{ type: 'trade', offer: offer.receiptId }], work: null }, planningContext(world, buyer.id)));
  return { world, buyer, seller };
}

test('a hungry buyer gathers payment from multiple observed trees and actually settles the meal trade', () => {
  const { world, buyer, seller } = mealPaymentWorld();
  for (let i = 0; i < 30 && buyer.hunger >= 60; i++) tickWorld(world);
  assert.equal(world.stats.trades, 1);
  assert.equal(world.offers[0].status, 'filled');
  assert.equal(world.stats.harvestedWood, 10);
  assert.equal(buyer.wood, 2);
  assert.equal(seller.wood, 28);
  assert.ok(buyer.alive && buyer.hunger < 60);
  assert.equal(world.stats.harvestedFood, 0, 'a feasible chosen meal is not preempted by raw-food foraging');
});

test('a hungry buyer does not fund a meal with insufficient stock, regrowth, or a route longer than remaining life', () => {
  for (const options of [{ secondStock: 0 }, { health: 8 }, { secondX: 5, health: 11 }]) {
    const { world, buyer } = mealPaymentWorld(options);
    tickWorld(world);
    assert.equal(buyer.gatherTarget?.resource, 'food');
    assert.equal(world.stats.harvestedWood, 0);
    assert.equal(world.stats.trades, 0);
  }
});

test('meal payment feasibility excludes stale, reported, unreachable, and visibly contested stock', () => {
  for (const evidence of ['stale', 'reported', 'unreachable', 'contested', 'contested-multiple-stock']) {
    const { world, buyer, seller } = mealPaymentWorld({ secondX: evidence === 'stale' || evidence === 'reported' ? 7 : 3 });
    const memory = { ...world.nodes[1], observedAt: evidence === 'stale' ? -13 : 0, source: evidence === 'reported' ? 'report' : 'seen' };
    buyer.knowledge.nodes[memory.id] = memory;
    if (evidence === 'unreachable') world.blocked = [{ x: 3, y: 2 }];
    if (evidence.startsWith('contested')) {
      if (evidence === 'contested-multiple-stock') {
        world.nodes[0].stock = 0; world.nodes[0].regrowIn = 120;
        world.nodes[1].stock = 2; world.nodes[1].capacity = 2;
      }
      Object.assign(seller, { x: 3, y: 2, activity: 'Harvesting wood at tree-payment-2' });
      seller.current = { task: { type: 'harvest', target: memory.id }, remaining: 9, total: 9, purpose: 'support' };
    }
    tickWorld(world);
    assert.equal(buyer.gatherTarget?.resource, 'food', evidence);
    assert.equal(world.stats.harvestedWood, 0, evidence);
  }
});

test('meal payment preparation rechecks depletion and preserves completed wood when the route becomes infeasible', () => {
  const { world, buyer } = mealPaymentWorld();
  for (let i = 0; i < 12 && buyer.wood === 0; i++) tickWorld(world);
  assert.equal(buyer.wood, 5);
  world.nodes[1].stock = 0; world.nodes[1].regrowIn = 120;
  tickWorld(world);
  assert.equal(buyer.gatherTarget?.resource, 'food');
  assert.equal(buyer.wood, 5);
  assert.equal(world.stats.harvestedWood, 5);
  assert.equal(world.stats.trades, 0);
});

test('a hungry buyer avoids payment preparation that cannot finish before escrow expires', () => {
  const { world, buyer } = mealPaymentWorld();
  world.tick = world.offers[0].expiresAt - 12;
  observeWorld(world, buyer);
  tickWorld(world);
  assert.equal(buyer.gatherTarget?.resource, 'food');
  assert.equal(world.stats.harvestedWood, 0);
  assert.equal(world.stats.trades, 0);
});

test('a growing population remains fully discoverable through bounded directory pages', () => {
  const world = createWorld({ expanded: false }), actor = world.citizens[0];
  world.citizens = [actor, ...Array.from({ length: 30 }, (_, i) => ({ ...structuredClone(actor),
    id: `person-${i}`, name: `Person ${i}`, food: 999, strategyMemory: 'PRIVATE' }))];
  actor.knowledge.people = {};
  const tools = session(world), all = [];
  let after;
  do {
    const page = tools.execute('get_people', after ? { after } : {});
    assert.ok(page.items.length <= 12);
    assert.ok(!JSON.stringify(page).includes('PRIVATE'));
    assert.ok(!JSON.stringify(page).includes('999'));
    all.push(...page.items.map(p => p.id)); after = page.nextAfter;
  } while (after);
  assert.equal(all.length, 30);
  assert.equal(new Set(all).size, 30);
  assert.deepEqual(tools.execute('get_people', { area: 'north-east' }).items, []);
});

test('area pressure uses bounded dated sightings and known rates, never a remote census or inventory', () => {
  const world = createWorld({ expanded: false }), actor = world.citizens[0];
  world.citizens = [actor, ...Array.from({ length: 20 }, (_, i) => ({ ...structuredClone(actor), id: `person-${i}`, name: `Person ${i}` }))];
  actor.knowledge.people = Object.fromEntries(world.citizens.slice(1).map(p => [p.id, {
    id: p.id, name: p.name, adult: true, x: 2, y: 2, source: 'seen', observedAt: 0,
  }]));
  const tools = session(world), before = tools.execute('get_places', {}).areas.find(a => a.id === 'north-west');
  assert.equal(before.lastSeenPeople.length, 6);
  assert.equal(before.lastSeenPeopleCount, 20);
  assert.equal(before.lastSeenPeopleOmitted, 14);
  assert.ok(before.estimatedRawFoodBalancePer100Ticks < 0);
  for (const peer of world.citizens.slice(1)) Object.assign(peer, { x: 15, y: 9, food: 999, hunger: 100, adult: false });
  const after = tools.execute('get_places', {}).areas.find(a => a.id === 'north-west');
  assert.deepEqual(after, before, 'unseen changes do not freshen remembered pressure or disclose private goods');
});

test('native tool loop chains receipts, recovers errors and meters every call', async () => {
  const world = createWorld({ expanded: false }), tools = session(world);
  const received = [], reservations = [], settlements = [], audit = [];
  let step = 0;
  const commands = [
    [{ name: 'open_offer', args: { give: 'food', giveAmount: 2, want: 'wood', wantAmount: 4 } }],
    [{ name: 'send_private_message', args: { to: 'citizen-2', text: 'See offer-1.', location: true } }, { name: 'commit_strategy', args: { tasks: [{ type: 'ensure_inventory', resource: 'wood', minimum: 10, area: 'invalid' }], work: null } }],
    [{ name: 'continue_strategy', args: {} }],
  ];
  const planner = createAgentPlanner({ audit: { record: event => audit.push(structuredClone(event)) }, budget: { reserve: (...args) => { reservations.push(args); return reservations.length; }, settle: (...args) => settlements.push(args) }, fetchImpl: async (_url, options) => {
    received.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', reasoning: 'PRIVATE', tool_calls: commands[step++].map((c, i) => ({ id: `call-${step}-${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }) };
  } });
  const result = await planner.plan(planningContext(world, 'citizen-1'), undefined, { toolSession: tools });
  assert.equal(result.steps, 3);
  assert.equal(result.tokens, 360);
  assert.equal(world.messages[0].text, 'See offer-1.');
  assert.equal(reservations.length, 3); assert.equal(settlements.length, 3);
  assert.match(received[2].messages.findLast(m => m.role === 'tool').content, /unknown value/);
  assert.equal(received[0].reasoning_effort, 'low');
  assert.equal(received[1].messages.find(m => m.role === 'assistant').reasoning, 'PRIVATE');
  assert.ok(!JSON.stringify(audit).includes('PRIVATE'));
  const requests = audit.filter(e => e.type === 'agent_request');
  for (const [index, event] of requests.entries()) {
    const actualBytes = Buffer.byteLength(JSON.stringify({ messages: received[index].messages, tools: received[index].tools }));
    assert.equal(Object.values(event.requestParts).reduce((sum, size) => sum + size, 0), actualBytes);
    assert.ok(Object.values(event.requestParts).every(size => Number.isInteger(size) && size >= 0));
  }
  assert.ok(requests[1].requestParts.publicHistory > 0);
  assert.ok(requests[1].requestParts.privateReplay > 0, 'private replay is counted without exposing its content');
  assert.equal(Object.values(planner.metrics.requestParts).reduce((sum, size) => sum + size, 0), planner.metrics.promptBytes);
});

test('a whole-turn deadline reports a decision failure while accounting for successful steps and retaining physical work', async () => {
  const world = createWorld({ expanded: false }), actor = world.citizens[0];
  applyPlan(world, actor.id, normalizePlan({ tasks: [], work: { type: 'gather', resource: 'wood' } }, planningContext(world, actor.id)));
  const retained = structuredClone({ order: actor.order, tasks: actor.tasks, work: actor.work });
  const reserves = [], settles = [], audit = [];
  let calls = 0;
  const planner = createAgentPlanner({ turnTimeoutMs: 250,
    audit: { record: event => audit.push(event) },
    budget: { reserve: input => { const id = `paid-${reserves.length}`; reserves.push({ id, input }); return id; }, settle: (id, usage) => settles.push({ id, usage }) },
    fetchImpl: async (_url, { signal }) => {
      if (calls++ === 0) return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ id: 'first', function: {
        name: 'get_mechanics', arguments: '{"action":"resources"}' } }] } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }) };
      await new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('Deadline did not cancel the provider request')), 2000);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      });
    } });
  await assert.rejects(planner.plan(planningContext(world, actor.id), undefined, { toolSession: session(world) }), error => {
    assert.ok(error instanceof PlanResponseError);
    assert.match(error.message, /No strategy committed within turn limit/);
    assert.equal(error.tokens, 5);
    return true;
  });
  assert.equal(calls, 2); assert.equal(reserves.length, 2); assert.equal(settles.length, 2);
  assert.equal(settles[1].usage, null, 'missing usage is passed through for conservative accounting');
  assert.deepEqual({ order: actor.order, tasks: actor.tasks, work: actor.work }, retained);
  assert.match(audit.findLast(e => e.type === 'plan_error').reason, /No strategy committed/);
});

test('reasoning history is private to a turn and can be disabled for comparison', async () => {
  for (const preserveReasoning of [true, false]) {
    const world = createWorld({ expanded: false }), received = [];
    const planner = createAgentPlanner({ preserveReasoning, fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body), step = received.length % 2;
      received.push(body);
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'tool_calls', message: { reasoning: 'PRIVATE-TURN', tool_calls: [{ id: `call-${received.length}`, type: 'function', function: { name: step ? 'continue_strategy' : 'get_mechanics', arguments: JSON.stringify(step ? {} : { action: 'resources' }) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) };
    } });
    for (let i = 0; i < 2; i++) await planner.plan(planningContext(world, 'citizen-1'), undefined, { toolSession: session(world) });
    assert.equal(JSON.stringify(received[1]).includes('PRIVATE-TURN'), preserveReasoning);
    assert.equal(JSON.stringify(received[2]).includes('PRIVATE-TURN'), false);
    assert.equal(JSON.stringify(citizenObservation(world, 'citizen-1')).includes('PRIVATE-TURN'), false);
  }
});

test('oversized private scratch reasoning is omitted without losing tool receipts or wasting context', async () => {
  const world = createWorld({ expanded: false }), tools = session(world), received = [], reserves = [];
  const planner = createAgentPlanner({ budget: { reserve: input => { reserves.push(input); return 'reservation'; }, settle() {} }, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body), step = received.length;
    received.push(body);
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'tool_calls', message: { reasoning: step ? 'done' : 'r'.repeat(100000), tool_calls: [{ id: `call-${step}`, type: 'function', function: { name: step ? 'continue_strategy' : 'get_mechanics', arguments: JSON.stringify(step ? {} : { action: 'resources' }) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) };
  } });
  const result = await planner.plan(planningContext(world, 'citizen-1'), undefined, { toolSession: tools });
  assert.equal(result.steps, 2);
  assert.ok(reserves[1] - reserves[0] < 6000, 'receipts add bounded context without carrying the 100,000-character scratch text');
  assert.equal(received[1].messages.find(m => m.role === 'assistant').reasoning, undefined);
  assert.match(received[1].messages.find(m => m.role === 'tool').content, /collect/);
});

test('native turn reserves three steps for commitment and error recovery with current facts', async () => {
  const world = createWorld({ expanded: false }), tools = session(world), seen = [];
  const planner = createAgentPlanner({ fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body), step = seen.length;
    seen.push(body.tools.map(t => t.function.name));
    const name = step === 5 ? 'continue_strategy' : 'get_mechanics';
    const args = step === 5 ? {} : { action: 'resources' };
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: `call-${step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) };
  } });
  const result = await planner.plan(planningContext(world, 'citizen-1'), undefined, { toolSession: tools });
  assert.equal(result.steps, 6);
  assert.deepEqual(seen[5], ['continue_strategy', 'commit_strategy']);
});

test('a moderate initial context permits real actions before entering the smaller decision menu', async () => {
  const world = createWorld({ expanded: false }), tools = session(world), received = [];
  const planner = createAgentPlanner({ instructions: `Act as this citizen. ${'context '.repeat(2100)}`, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body), step = received.length;
    received.push(body);
    const name = step === 0 ? 'propose_family' : 'continue_strategy';
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: `call-${step}`, type: 'function',
      function: { name, arguments: JSON.stringify(step === 0 ? { to: 'citizen-2' } : {}) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) };
  } });
  const result = await planner.plan(planningContext(world, 'citizen-1'), undefined, { toolSession: tools });
  assert.equal(result.steps, 2);
  const firstBytes = Buffer.byteLength(JSON.stringify({ messages: received[0].messages, tools: received[0].tools }));
  assert.ok(firstBytes > 36000 && firstBytes <= 48000);
  assert.ok(received[0].tools.some(t => t.function.name === 'propose_family'));
  assert.deepEqual(received[1].tools.map(t => t.function.name), ['continue_strategy', 'commit_strategy']);
  assert.equal(world.familyProposals.length, 1, 'the proposal really happened before the decision');
  assert.equal(world.familyProposals[0].status, 'pending');
  assert.ok(received[1].messages.some(m => m.role === 'tool' && m.content.includes(world.familyProposals[0].id)), 'the successful receipt remains available');
});

test('consumed consent is explicit, and a rejected final decision can be repaired without losing receipts', async () => {
  const world = createWorld({ expanded: false }), [actor, peer] = world.citizens;
  Object.assign(actor, { food: 20, wood: 20 });
  world.familyProposals = [{ id: 'family-used', makerId: actor.id, recipientId: peer.id, status: 'accepted', createdAt: 0, updatedAt: 0, expiresAt: 1000 }];
  assert.deepEqual(citizenObservation(world, actor.id).familyConsent.acceptedPartnerIds, [peer.id]);
  const tools = session(world), received = [];
  const planner = createAgentPlanner({ fetchImpl: async (_, options) => {
    const request = JSON.parse(options.body), step = received.length;
    received.push(request);
    // A partner completes the birth while the actor is reasoning.
    if (step === 4) { world.familyProposals[0].status = 'fulfilled'; world.familyProposals[0].updatedAt = world.tick; }
    const name = step === 0 ? 'send_private_message' : step < 5 ? 'get_mechanics' : 'commit_strategy';
    const args = step === 0 ? { to: peer.id, text: 'I will keep working while we decide.' }
      : step < 5 ? { action: 'production' }
      : step === 5 ? { tasks: [{ type: 'collect', resource: 'food', amount: 2 }, { type: 'reproduce', target: peer.id }] }
      : { tasks: [{ type: 'collect', resource: 'food', amount: 2 }], work: { type: 'gather', resource: 'wood' } };
    return { ok: true, json: async () => ({ choices: [{ message: { reasoning: 'OLD-SCRATCH', tool_calls: [{ id: `call-${step}`, function: { name, arguments: JSON.stringify(args) } }] } }], usage: {} }) };
  } });
  const result = await planner.plan(planningContext(world, actor.id), undefined, { toolSession: tools });
  assert.equal(result.steps, 7);
  assert.deepEqual(JSON.parse(received[5].messages.at(-1).content).familyConsent.acceptedPartnerIds, []);
  assert.match(JSON.parse(received[5].messages.at(-1).content).familyConsent.note, /consumed/);
  assert.ok(!JSON.stringify(received[5]).includes('OLD-SCRATCH'));
  assert.deepEqual(received[5].tools.map(t => t.function.name), ['continue_strategy', 'commit_strategy']);
  const rejected = JSON.parse(received[6].messages.findLast(m => m.role === 'tool').content);
  assert.equal(rejected.decisionApplied, false);
  assert.match(rejected.error, /tasks\[1\].*consumed/);
  assert.equal(world.messages.length, 1);
  assert.equal(actor.wood, 19, 'successful communication charges once despite rejected physical decision');
  assert.equal(result.plan.tasks.some(t => t.type === 'reproduce'), false);
  assert.equal(result.plan.work.resource, 'wood');
});
