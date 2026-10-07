// Regression seam tests for the upcoming world/parent implementation (private messaging,
// identity-only planning context, camp semantics, snapshot reproduction, knowledge-gated
// family care). Deterministic and offline; expected to fail until that implementation lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, createWorld, planningContext, tickWorld } from '../lib/world.mjs';
import { resolveInteraction } from '../lib/interactions.mjs';
import { observeWorld, reportLocation } from '../lib/knowledge.mjs';

const find = (world, id) => world.citizens.find((entry) => entry.id === id);
function prepare(citizen, overrides = {}) {
  return Object.assign(citizen, {
    food: 20, wood: 20, hunger: 0, energy: 100, health: 100, routine: { food: 0, wood: 0 },
    current: null, order: null, tasks: [], path: [], planning: false, familyReady: false,
  }, overrides);
}
function plan(world, id, tasks, { family = false } = {}) {
  return applyPlan(world, id, {
    thought: 'Test strategy.', goals: ['Stay well'], memory: '',
    routine: { food: 0, wood: 0, family }, reviewAfter: 300, tasks,
  });
}
function node(id, kind, x, y, stock) {
  return { id, kind, x, y, capacity: 1, stock, regrowIn: 0, yield: kind === 'tree' ? 5 : 1, regrowTicks: kind === 'tree' ? 120 : 99 };
}
function memory(node, overrides = {}) {
  return {
    id: node.id, kind: node.kind, x: node.x, y: node.y, stock: node.stock, capacity: 1, yield: node.yield,
    regrowTicks: node.regrowTicks, observedAt: 0, source: 'seen', ...overrides,
  };
}
function remember(citizen, ...memories) {
  citizen.knowledge = { nodes: Object.fromEntries(memories.map((entry) => [entry.id, entry])), explored: [] };
}
function childOf(parent, x, y, { hunger = 55, food = 0 } = {}) {
  return {
    ...structuredClone(parent), id: 'child-1', name: 'Sprig', x, y, food, wood: 0, hunger,
    energy: 90, health: 100, adult: false, bornAt: 0, parents: [parent.id], tasks: [],
    current: null, order: null, path: [], planning: false, status: 'idle',
    routine: { food: 0, wood: 0 }, knowledge: { nodes: {}, explored: [], people: {} }, resourceHistory: {},
  };
}
function run(world, finished, limit = 40) {
  for (let tick = 0; tick < limit && !(finished && finished()); tick += 1) tickWorld(world);
}
// A plan is settled once its serial orders finished and the citizen fell back to idle.
const settled = (citizen) => citizen.order === null && citizen.tasks.length === 0 && citizen.status === 'idle';
const hasPrivateState = (contact) => ['food', 'wood', 'health', 'familyReady', 'hunger'].some((key) => key in contact);

test('planning context keeps an identity-only directory and contacts never freshen without observation', () => {
  const world = createWorld();
  const mira = find(world, 'citizen-1');
  const oren = find(world, 'citizen-2');
  world.citizens = [mira, oren];
  world.nodes = [];
  prepare(mira, { x: 2, y: 2 });
  prepare(oren, { x: 3, y: 2 });
  const child = childOf(mira, 4, 2);
  world.citizens.push(child);
  for (const citizen of world.citizens) observeWorld(world, citizen);
  // Remote vitals, inventory, consent, and positions change with no fresh observation.
  world.tick = 40;
  Object.assign(oren, { x: 9, y: 9, food: 7, wood: 7, health: 1, hunger: 1, energy: 1, familyReady: true });
  Object.assign(child, { x: 5, y: 5, hunger: 99, food: 5 });
  const context = planningContext(world, mira.id);
  // Contacts stay at the last observed or reported snapshot and carry no private state.
  assert.deepEqual(context.contacts?.map((c) => [c.id, c.x, c.y, c.observedAt, !hasPrivateState(c)]), [
    ['child-1', 4, 2, 0, true], ['citizen-2', 3, 2, 0, true],
  ], 'planningContext exposes own stale contacts, sorted by id not insertion order');
  // Neighbors are an identity directory only; children are identity-only too.
  assert.deepEqual(context.neighbors.map((n) => Object.keys(n).sort()), [['adult', 'id', 'name'], ['adult', 'id', 'name']]);
  assert.deepEqual(context.neighbors.map((n) => [n.id, n.name, n.adult]), [['citizen-2', 'Oren', true], ['child-1', 'Sprig', false]]);
  assert.deepEqual(context.citizen.children, [{ id: 'child-1', name: 'Sprig', adult: false }]);
  assert.deepEqual([context.inbox, context.outbox], [[], []]);
  // A voluntary report joins contacts as a report snapshot, still without private state.
  reportLocation(world, oren, mira);
  const reported = planningContext(world, mira.id).contacts.find((entry) => entry.id === 'citizen-2');
  assert.deepEqual({ source: reported?.source, reportedBy: reported?.reportedBy, observedAt: reported?.observedAt, private: hasPrivateState(reported) },
    { source: 'report', reportedBy: 'citizen-2', observedAt: 40, private: false });
});

test('private messages exclude third parties and never reach the public board or events', () => {
  const SECRET = 'stash the wood by the big tree; keep it between us.';
  const world = createWorld();
  const mira = find(world, 'citizen-1');
  const oren = find(world, 'citizen-2');
  const sela = find(world, 'citizen-4');
  world.citizens = [mira, oren, sela];
  const known = node('known-crop', 'crop', 6, 8, 1);
  world.nodes = [known];
  prepare(mira, { x: 2, y: 2, wood: 2 });
  prepare(oren, { x: 15, y: 9 });
  prepare(sela, { x: 2, y: 7 });
  world.tick = 10;
  remember(mira, memory(known, { stock: 0, observedAt: 4 }));
  plan(world, mira.id, [{ type: 'message', target: oren.id, text: SECRET, share: [known.id] }]);
  run(world, () => settled(mira), 12);
  assert.deepEqual([Array.isArray(world.messages), world.messages.length], [true, 1], 'one message was delivered');
  const message = world.messages[0];
  assert.deepEqual({ senderId: message.senderId, recipientId: message.recipientId, text: message.text, share: message.share },
    { senderId: mira.id, recipientId: oren.id, text: SECRET, share: [known.id] });
  assert.equal('location' in message, false, 'no coordinates without consent to share them');
  assert.deepEqual(oren.knowledge.nodes[known.id], {
    id: known.id, kind: 'crop', x: 6, y: 8, stock: 0, capacity: 1, yield: 1, regrowTicks: 99,
    observedAt: 4, source: 'report', reportedBy: mira.id, receivedAt: message.tick,
  }, 'shares copy the stale sender snapshot, not live stock, and land at the actual completion tick');
  assert.equal(message.tick, 12, 'delivery completes at the completion tick, not the plan start tick');
  assert.equal(sela.knowledge.nodes[known.id], undefined, 'shared deposits stay private to the recipient');
  assert.deepEqual(planningContext(world, oren.id).inbox?.map((entry) => entry.text), [SECRET], 'inbox lists messages addressed to self');
  assert.deepEqual(planningContext(world, mira.id).outbox?.map((entry) => entry.text), [SECRET], 'outbox lists messages sent by self');
  const selaContext = planningContext(world, sela.id);
  assert.deepEqual(selaContext.inbox, [], 'third parties receive nothing');
  assert.equal(JSON.stringify(selaContext).includes(SECRET), false, 'the private text is absent from third-party context');
  assert.equal(mira.wood, 1, 'sending costs one wood');
  assert.equal(world.board.length, 0, 'private messages do not become board posts');
  assert.ok(world.events.every((event) => !event.text.includes(SECRET)), 'private text never reaches public events');
});

test('messages never grant mechanical consent and copy coordinates only when location is true', () => {
  const world = createWorld();
  const mira = find(world, 'citizen-1');
  const oren = find(world, 'citizen-2');
  world.citizens = [mira, oren];
  world.nodes = [];
  prepare(mira, { x: 2, y: 2, wood: 2 });
  prepare(oren, { x: 15, y: 9 });
  oren.replanReason = null;
  oren.reviewAt = 500;
  plan(world, mira.id, [
    { type: 'message', target: oren.id, text: 'Will you start a family with me?', location: true },
    { type: 'message', target: oren.id, text: 'The southern crop looked empty.' },
  ]);
  run(world, () => settled(mira), 12);
  assert.equal(world.messages?.length, 2, 'both messages were delivered in order');
  const [withLocation, plain] = world.messages;
  assert.deepEqual(withLocation.location, { x: 2, y: 2 }, 'location:true copies the sender own coords');
  assert.equal('location' in plain, false, 'location omitted sends no coordinates');
  assert.equal(oren.familyReady, false, 'receiving a hopeful message never grants consent');
  assert.equal(mira.familyReady, false);
  assert.equal(oren.reviewAt, 500, 'an arriving message waits for the next eligible review');
  assert.notEqual(oren.replanReason, null, 'the recipient is nudged to review at the next eligible review');
});

test('private messages are accepted without proximity or known-location requirements', () => {
  const world = createWorld();
  const mira = find(world, 'citizen-1');
  const oren = find(world, 'citizen-2');
  world.citizens = [mira, oren];
  world.nodes = [];
  prepare(mira, { x: 2, y: 2, wood: 1 });
  prepare(oren, { x: 15, y: 9 });
  for (const citizen of world.citizens) observeWorld(world, citizen);
  assert.equal(oren.knowledge.people['citizen-1'], undefined, 'the sender position is unknown');
  let result;
  assert.doesNotThrow(() => {
    result = plan(world, mira.id, [{ type: 'message', target: oren.id, text: 'Do you trade wood for food?' }]);
  }, 'a message needs no meeting place or known location');
  run(world, () => settled(mira), 12);
  assert.equal(world.messages?.length, 1);
  assert.equal(mira.wood, 0, 'sending costs one wood');
  assert.equal('location' in world.messages[0], false);
  assert.equal(planningContext(world, oren.id).inbox?.length, 1, 'the remote recipient receives the message');
  assert.equal(oren.knowledge.people['citizen-1'], undefined, 'no location disclosure without location:true');
});

test('unpinned gather targets leave locally empty sites toward known stocked ones; camp:true pins', () => {
  const world = createWorld({ expanded: false });
  const mira = find(world, 'citizen-1');
  world.citizens = [mira];
  const empty = node('crop-empty', 'crop', 4, 2, 0);
  const stocked = node('crop-stocked', 'crop', 2, 4, 1);
  const hidden = node('crop-hidden', 'crop', 14, 2, 1); // never remembered; no oracle fallback
  world.nodes = [empty, stocked, hidden];
  prepare(mira, { x: 2, y: 2, food: 0 });
  remember(mira, memory(empty), memory(stocked));
  plan(world, mira.id, [{ type: 'gather', resource: 'food', amount: 1, target: empty.id }]);
  run(world, () => world.stats.harvestedFood === 1 && settled(mira), 40);
  assert.equal(world.stats.harvestedFood, 1, 'a locally empty unpinned target falls back to a known stocked one');
  assert.deepEqual([mira.x, mira.y], [2, 4], 'the harvest happened at the known stocked site');
  assert.equal(empty.stock, 0, 'the empty target stayed empty');
  assert.equal(hidden.stock, 1, 'unremembered deposits are never consulted');
  plan(world, mira.id, [{ type: 'gather', resource: 'food', amount: 1, target: empty.id, camp: true }]);
  run(world, null, 12); // give the pinned order time to reach the site and settle
  assert.equal(world.stats.harvestedFood, 1, 'camping does not harvest elsewhere');
  assert.deepEqual([mira.x, mira.y], [4, 2], 'the pinned camp stays at the chosen target');
  assert.equal(mira.order?.task.type, 'gather', 'the pinned order is still running');
});

test('reproduce routes beyond a stale report while actual partner resources and consent still gate birth', () => {
  const world = createWorld();
  const mira = find(world, 'citizen-1');
  const oren = find(world, 'citizen-2');
  world.citizens = [mira, oren];
  world.nodes = [];
  prepare(mira, { x: 2, y: 2 });
  prepare(oren, { x: 14, y: 8, food: 1, wood: 0 });
  world.tick = 50;
  mira.familyReady = true;
  oren.familyReady = false; // Legacy flags do not authorize a pairing.
  assert.equal(resolveInteraction(world, mira, { type: 'propose_family', target: oren.id }).ok, true);
  assert.equal(resolveInteraction(world, oren, { type: 'accept_family', proposal: world.familyProposals[0].id }).ok, true);
  mira.knowledge = { nodes: {}, explored: [], people: {
    'citizen-2': { id: 'citizen-2', name: 'Oren', adult: true, x: 6, y: 2, observedAt: 10, source: 'report', reportedBy: 'citizen-3' },
  } };
  // Navigation can find a remote partner without turning sightings into live telemetry.
  plan(world, mira.id, [{ type: 'reproduce', target: oren.id }], { family: true });
  run(world, () => settled(mira), 30);
  assert.equal(world.stats.births, 0, 'travel does not bypass partner resources');
  assert.ok(Math.abs(mira.x - oren.x) + Math.abs(mira.y - oren.y) <= 1, 'the order reaches the actual partner beyond the stale report');
  assert.ok(mira.memories.some((text) => /wood|food/i.test(text)), 'the failure records actual meeting prerequisites');
  // At an actual meeting, real consent and resources are checked: no free birth.
  Object.assign(mira, { x: 4, y: 2 });
  Object.assign(oren, { x: 4, y: 3, food: 1, wood: 0, familyReady: true });
  mira.memories = [];
  observeWorld(world, mira); // refresh the contact so the meeting place is known
  plan(world, mira.id, [{ type: 'reproduce', target: oren.id }], { family: true });
  run(world, () => settled(mira), 20);
  assert.equal(world.stats.births, 0, 'a partner without birth resources still blocks the birth');
  assert.ok(mira.memories.some((text) => /wood|food/i.test(text)), 'resources are checked at the meeting');
  oren.food = 10;
  oren.familyReady = false;
  assert.equal(resolveInteraction(world, oren, { type: 'cancel_family', proposal: world.familyProposals[0].id }).ok, true);
  plan(world, mira.id, [{ type: 'reproduce', target: oren.id }], { family: true });
  run(world, () => settled(mira), 20);
  assert.equal(world.stats.births, 0, 'missing actual consent blocks the birth at the meeting');
  assert.ok(mira.memories.some((text) => /propose and accept/i.test(text)), 'pair-specific agreement is checked at the meeting');
  assert.equal(world.citizens.length, 2);
});

test('a location-only report reveals no hunger, so a private wait survives it; a locally visible hungry child still claims care', () => {
  const world = createWorld();
  const mira = find(world, 'citizen-1');
  world.citizens = [mira];
  world.nodes = [];
  prepare(mira, { x: 2, y: 2, food: 5 });
  const child = childOf(mira, 13, 8);
  world.citizens.push(child);
  observeWorld(world, mira); // eleven tiles away: the child is neither seen nor reported
  assert.equal(mira.knowledge.people['child-1'], undefined);
  plan(world, mira.id, [{ type: 'wait', ticks: 120 }]);
  run(world, null, 3);
  assert.deepEqual([mira.x, mira.y], [2, 2], 'an unseen hungry child does not interrupt a wellfed parent');
  assert.equal(mira.current?.task.type, 'wait', 'the wellfed wait is preserved');
  assert.equal(mira.food, 5, 'no food moved from the uninterrupting parent');
  assert.equal(mira.knowledge.people['child-1'], undefined, 'no contact was invented from remote hunger');
  reportLocation(world, child, mira); // the dependent voluntarily reports its own location
  assert.equal(mira.knowledge.people['child-1']?.source, 'report');
  assert.deepEqual(Object.keys(mira.knowledge.people['child-1']).sort(),
    ['adult', 'id', 'name', 'observedAt', 'reportedBy', 'source', 'x', 'y'],
    'a voluntary report carries identity and location only — never private vitals');
  run(world, null, 4);
  assert.deepEqual([mira.x, mira.y], [2, 2], 'a location-only report hides the hunger, so the wellfed wait remains uninterrupted');
  assert.equal(mira.current?.task.type, 'wait', 'the private wait survives a report alone');
  assert.equal(mira.food, 5, 'no food moved on a location-only report');
  // Nearby routine care is explicit existing policy: within the local sight radius (3),
  // a visibly hungry child claims the wellfed parent mid-wait.
  Object.assign(child, { x: 4, y: 3 });
  run(world, null, 12);
  assert.ok(Math.abs(mira.x - child.x) + Math.abs(mira.y - child.y) <= 1, 'the parent approaches the visibly hungry child');
  assert.ok(mira.food < 5, 'the parent fed the visible dependent');
  assert.ok(child.food > 0, 'the child received food');
  assert.equal(mira.order?.task.type, 'wait', 'care replaces only the waiting primitive, preserving the wait order');
});
