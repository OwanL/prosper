import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnContext } from '../lib/turn-context.mjs';
import { CITIZEN_TOOLS, MODEL_TOOLS } from '../lib/citizen-tools.mjs';
import { createAgentPlanner } from '../lib/agent-planner.mjs';

test('wire schema references preserve every runtime constraint', () => {
  for (let i = 0; i < MODEL_TOOLS.length; i++) {
    const root = MODEL_TOOLS[i].function.parameters;
    const expand = value => Array.isArray(value) ? value.map(expand) : value && typeof value === 'object'
      ? value.$ref ? expand(root.$defs[value.$ref.split('/').at(-1)])
        : Object.fromEntries(Object.entries(value).filter(([k]) => k !== '$defs').map(([k, v]) => [k, expand(v)])) : value;
    assert.deepEqual(expand(root), CITIZEN_TOOLS[i].function.parameters);
  }
  assert.ok(JSON.stringify(CITIZEN_TOOLS).length - JSON.stringify(MODEL_TOOLS).length > 2000,
    'shared schemas must remove material request bytes while preserving every constraint');
});

test('rolling snapshots retain errors, receipts and valid tool pairs', () => {
  const history = createTurnContext('instructions', { tick: 1, citizen: { id: 'a' }, inbox: ['old'] });
  const call = (id, name) => ({ id, function: { name, arguments: '{}' } });
  history.result(call('offer', 'open_offer'), { ok: true, offerId: 'offer-7', spent: 2 });
  history.result(call('context', 'get_context'), { tick: 2, citizen: { id: 'a' }, inbox: ['new mail'] });
  history.result(call('stale', 'commit_strategy'), { ok: false, error: 'Review new consent', context: { tick: 3, citizen: { id: 'a' }, family: ['consent-1'] } });
  history.result(call('invalid', 'get_context'), { ok: false, error: 'Invalid arguments' });
  history.update({ context: { tick: 4, citizen: { id: 'a' }, inbox: ['new mail'], family: ['consent-1'] }, changes: ['health decreased'] });
  history.prepare();
  assert.equal(JSON.parse(history.messages.at(-1).content).tick, 4);
  assert.equal(history.messages.filter(m => m.content.includes('"citizen"')).length, 1);
  assert.match(history.messages.find(m => m.tool_call_id === 'offer').content, /offer-7/);
  assert.match(history.messages.find(m => m.tool_call_id === 'stale').content, /Review new consent/);
  assert.ok(history.messages.some(m => /health decreased/.test(m.content)));
});

test('latest evidence follows complete tool batches without breaking pairs or dropping failed decisions', () => {
  const history = createTurnContext('instructions', { tick: 1, citizen: { food: 0 } });
  const calls = ['offer', 'message'].map(id => ({ id, function: { name: id === 'offer' ? 'open_offer' : 'send_private_message', arguments: '{}' } }));
  history.messages.push({ role: 'assistant', tool_calls: calls, content: null });
  history.result(calls[0], { ok: true, offerId: 'offer-1' });
  history.refresh({ tick: 2, citizen: { food: 10 } });
  history.result(calls[1], { ok: false, error: 'Cannot afford phone' });
  history.prepare();
  assert.deepEqual(history.messages.slice(1).map(m => m.role), ['assistant', 'tool', 'tool', 'user']);
  assert.deepEqual(history.messages.filter(m => m.role === 'tool').map(m => m.tool_call_id), ['offer', 'message']);
  assert.equal(JSON.parse(history.messages.at(-1).content).citizen.food, 10);
  assert.match(history.messages.find(m => m.tool_call_id === 'offer').content, /offer-1/);
  assert.match(history.messages.find(m => m.tool_call_id === 'message').content, /Cannot afford phone/);
  history.refresh({ tick: 3, citizen: { food: 9 } });
  history.prepare();
  assert.equal(history.messages.filter(m => m.content?.includes('"citizen"')).length, 1);
  assert.equal(JSON.parse(history.messages.at(-1).content).tick, 3);
});

test('repeated live updates and stale commits do not accumulate world snapshots', async () => {
  const requests = [];
  let tick = 0;
  const snapshot = () => ({ tick: ++tick, citizen: { id: 'mira' }, inbox: [{ text: 'x'.repeat(6000) }] });
  const session = {
    refresh: snapshot,
    pollUpdates: () => ({ context: snapshot(), changes: ['new mail'] }),
    execute(name) {
      if (name === 'get_context') return snapshot();
      if (requests.length < 7) return { ok: false, error: 'World changed. Review context.', context: snapshot() };
      this.committed = { plan: {}, tokens: 0 };
      return { ok: true };
    },
  };
  const planner = createAgentPlanner({ fetchImpl: async (_, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ id: `call-${requests.length}`, function: { name: requests.length === 1 ? 'get_context' : 'continue_strategy', arguments: '{}' } }] } }], usage: {} }) };
  } });
  await planner.plan({ tick: 0, citizen: { id: 'mira' } }, undefined, { toolSession: session });
  assert.equal(requests.length, 7);
  const initialBytes = Buffer.byteLength(JSON.stringify(requests[0]));
  for (const request of requests) {
    // Menu size changes with capabilities. Seven refreshes must add only
    // bounded receipts/alerts, never another copy of the6000-byte observation.
    assert.ok(Buffer.byteLength(JSON.stringify(request)) < initialBytes + 5000);
    assert.equal(request.messages.filter(m => m.content?.includes('"citizen"')).length, 1);
    const callIds = request.messages.flatMap(m => m.tool_calls?.map(c => c.id) ?? []);
    assert.deepEqual(callIds, request.messages.filter(m => m.role === 'tool').map(m => m.tool_call_id));
  }
});
