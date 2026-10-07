import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, planningContext, transactCitizenAction, applyPlan, tickWorld } from '../lib/world.mjs';
import { createCitizenToolSession } from '../lib/citizen-tools.mjs';
import { createSimulation } from '../lib/simulation.mjs';
import { mailAffectsPlan } from '../lib/decision-relevance.mjs';
import { observeWorld } from '../lib/knowledge.mjs';

function town() {
  const world = createWorld({ expanded: false });
  world.citizens = world.citizens.slice(0, 3); world.blocked = [];
  world.citizens.forEach((c, i) => Object.assign(c, {
    x: 2 + i, y: 2, food: 20, wood: 15, hunger: 0, energy: 100, asyncReview: true,
  }));
  for (const c of world.citizens) observeWorld(world, c);
  return { world, actor: world.citizens[0], seller: world.citizens[1], sender: world.citizens[2] };
}
function toolsFor(world, actor) {
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: actor.id });
  tools.refresh(); return tools;
}
function send(world, sender, actor, text = 'I have news for our next conversation.') {
  assert.equal(transactCitizenAction(world, sender.id, { type: 'message', target: actor.id, text }).ok, true);
  return world.messages.at(-1);
}

test('unrelated mail does not prevent a selected craft from completing and remains unreviewed', () => {
  const { world, actor, sender } = town(), tools = toolsFor(world, actor);
  send(world, sender, actor);
  assert.equal(tools.execute('commit_strategy', { tasks: [{ type: 'craft', item: 'tool' }], work: null }).ok, true);
  assert.deepEqual(tools.committed.unreviewedChanges, ['mail']);
  assert.equal(tools.committed.reviewContext.citizen.inboxRevision, 0);
  applyPlan(world, actor.id, tools.committed.plan);
  for (let i = 0; i < 8 && !actor.tool; i++) tickWorld(world);
  assert.equal(actor.tool, true);
  assert.equal(actor.wood, 0);
  assert.equal(world.stats.crafted, 1);
});

for (const source of ['counterparty', 'referenced offer']) {
  test(`${source} mail still requires review before accepting a trade`, () => {
    const { world, actor, seller, sender } = town();
    assert.equal(transactCitizenAction(world, seller.id, { type: 'offer', give: 'wood', giveAmount: 5, want: 'food', wantAmount: 1 }).ok, true);
    const offer = world.offers.at(-1), tools = toolsFor(world, actor);
    send(world, source === 'counterparty' ? seller : sender, actor,
      source === 'counterparty' ? 'I need to discuss our terms.' : `Do not take ${offer.id}; I have different terms.`);
    const args = { tasks: [{ type: 'trade', offer: offer.id }], work: null };
    const rejected = tools.execute('commit_strategy', args);
    assert.equal(rejected.ok, false); assert.match(rejected.error, /New private mail/);
    assert.equal(tools.committed, null);
    assert.equal(world.stats.trades, 0);
    assert.equal(tools.execute('commit_strategy', args).ok, true, 'the attached fresh observation permits reconsideration');
  });
}

test('own-site aliases and shared site references retain relevant-mail protection', () => {
  const { world, actor, sender } = town();
  actor.knowledge.buildings = { 'bakery-12': { id: 'bakery-12', kind: 'bakery', ownerId: actor.id, x: 2, y: 2, health: 240, source: 'seen', observedAt: 0 } };
  const previous = planningContext(world, actor.id);
  send(world, sender, actor, 'bakery-12 needs your attention.');
  assert.equal(mailAffectsPlan({ work: { type: 'bake', target: 'own' } }, actor, previous, planningContext(world, actor.id)), true);
  const current = planningContext(world, actor.id);
  current.inbox[0] = { ...current.inbox[0], text: 'The site has changed.', share: ['tree-selected'] };
  assert.equal(mailAffectsPlan({ work: { type: 'gather', resource: 'wood', target: 'tree-selected' } }, actor, previous, current), true);
});

test('an overflow or missing correspondence cannot prove that mail is unrelated', () => {
  const { world, actor, sender } = town(), tools = toolsFor(world, actor);
  for (let i = 0; i < 5; i++) send(world, sender, actor, `News ${i}.`);
  assert.equal(actor.inboxRevision, 5);
  assert.equal(planningContext(world, actor.id).inbox.length, 4);
  assert.equal(tools.execute('commit_strategy', { tasks: [{ type: 'craft', item: 'tool' }], work: null }).ok, false);
  const refreshed = tools.committed;
  assert.equal(refreshed, null);
  const previous = planningContext(world, actor.id);
  send(world, sender, actor);
  world.messages = [];
  assert.equal(mailAffectsPlan({ work: { type: 'gather', resource: 'food' } }, actor, previous, planningContext(world, actor.id)), true);
});

test('trimming previously reviewed history does not falsely reject a new strategy', () => {
  const { world, actor, sender } = town();
  send(world, sender, actor);
  const tools = toolsFor(world, actor);
  world.messages = [];
  assert.equal(tools.execute('commit_strategy', { tasks: [{ type: 'craft', item: 'tool' }], work: null }).ok, true);
  assert.deepEqual(tools.committed.unreviewedChanges, []);
});

test('mail arriving after commitment permits actual settlement and gets its own follow-up review', async t => {
  const { world, actor, seller, sender } = town();
  assert.equal(transactCitizenAction(world, seller.id, { type: 'offer', give: 'wood', giveAmount: 5, want: 'food', wantAmount: 1 }).ok, true);
  const offer = world.offers.at(-1), calls = [];
  let resolveFirst, clock = 0;
  const first = new Promise(resolve => { resolveFirst = resolve; });
  const simulation = createSimulation({
    model: 'test', endpoint: 'http://mock.invalid', harness: 'semantic-tools', asynchronousWork: true,
    maxConcurrentTurns: 1, minStartIntervalMs: 1000, check: async () => {},
    plan: (context, _signal, { toolSession }) => {
      calls.push(context);
      toolSession.refresh();
      if (calls.length === 1) {
        assert.equal(toolSession.execute('commit_strategy', { tasks: [{ type: 'trade', offer: offer.id }], work: { type: 'gather', resource: 'wood' } }).ok, true);
        return first.then(() => ({ ...toolSession.committed, tokens: 3 }));
      }
      assert.equal(toolSession.execute('continue_strategy', {}).ok, true);
      return Promise.resolve({ ...toolSession.committed, tokens: 2 });
    },
  }, { now: () => clock, worldFactory: () => world });
  t.after(() => simulation.close());
  await simulation.check(); simulation.control('play');
  assert.equal(calls.length, 1);
  const message = send(world, sender, actor);
  simulation.control('pause'); resolveFirst();
  for (let i = 0; i < 20 && simulation.state.planner.completed !== 1; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(simulation.state.planner.completed, 1);
  assert.equal(simulation.state.planner.discarded, 0);
  assert.equal(actor.pendingMessageId, message.id);
  assert.notEqual(actor.lastMessageReviewId, message.id, 'unread mail was not acknowledged by committing independent work');
  for (let i = 0; i < 8 && offer.status === 'open'; i++) tickWorld(world);
  assert.equal(world.stats.trades, 1);
  assert.equal(actor.food, 19);
  assert.equal(actor.wood, 20);
  assert.equal(actor.pendingMessageId, message.id);
  clock = 1000; simulation.control('play'); simulation.control('pause');
  for (let i = 0; i < 20 && simulation.state.planner.completed !== 2; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].citizen.id, actor.id);
  assert.equal(calls[1].inbox.at(-1).id, message.id);
  assert.equal(simulation.state.planner.completed, 2);
  assert.equal(actor.pendingMessageId, undefined);
  assert.equal(simulation.state.planner.totalTokens, 5);
});
