import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAudit } from '../lib/audit.mjs';
import { createPlanner, PlanResponseError } from '../lib/planner.mjs';
import { createSimulation } from '../lib/simulation.mjs';

function localAudit(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'prosper-audit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, filePath: join(directory, 'audit.jsonl'), audit: createAudit({ filePath: join(directory, 'audit.jsonl'), ...options }) };
}
const valid = { thought: '', goals: ['Observe'], memory: '', routine: { family: false }, tasks: [{ type: 'wait', ticks: 1 }], work: null, reviewAfter: 300 };

test('audit rotates bounded JSONL with a shared session ID and no partial records', (t) => {
  const { directory, audit } = localAudit(t, { maxBytes: 512, archives: 2 });
  for (let index = 0; index < 25; index++) assert.equal(audit.record({ type: 'test', index, text: 'x'.repeat(100) }), true);
  const files = readdirSync(directory);
  assert.equal(files.length, 3);
  const records = files.flatMap(name => {
    assert.ok(statSync(join(directory, name)).size <= 512);
    return readFileSync(join(directory, name), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  });
  assert.equal(new Set(records.map(record => record.sessionId)).size, 1);
  assert.ok(records.some(record => record.index === 24));
  assert.equal(audit.record({ type: 'oversized', text: 'x'.repeat(1024) }), false);
  assert.match(audit.snapshot().lastError, /write failed/);
});

test('audit records exact projected request, raw content and normalized plan, not hidden context or headers', async (t) => {
  const { audit, filePath } = localAudit(t);
  let sent;
  const planner = createPlanner({ audit, fetchImpl: async (_url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(valid), reasoning: 'PRIVATE-REASONING' } }], usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 3 } } }) };
  } });
  const context = { tick: 10, citizen: { id: 'citizen-1' }, privateSecret: 'NOT-SENT', neighbors: [{ id: 'citizen-2', food: 999, private: 'NOT-SENT' }] };
  await planner.plan(context, undefined, { planId: 'correlated-plan' });
  const text = readFileSync(filePath, 'utf8');
  const records = text.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(records.map(record => record.type), ['plan_request', 'plan_response', 'plan_normalized']);
  assert.deepEqual(records[0].request, sent);
  assert.equal(records[1].content, JSON.stringify(valid));
  assert.deepEqual(records[1].reasoning, { requestedEffort: 'low', fields: ['reasoning'], characters: 17, tokens: 3 });
  assert.deepEqual(records[2].plan, valid);
  assert.ok(records.every(record => record.planId === 'correlated-plan'));
  assert.doesNotMatch(text, /NOT-SENT|headers|Authorization|PRIVATE-REASONING/);
  assert.equal(Object.hasOwn(JSON.parse(sent.messages[1].content).neighbors[0], 'food'), false);
});

test('invalid responses are recorded and usage is settled without retrying', async (t) => {
  const { audit, filePath } = localAudit(t);
  let calls = 0, settled = 0;
  const planner = createPlanner({ audit, budget: { reserve: () => 'r', settle: () => settled++ }, fetchImpl: async () => {
    calls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{broken' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
  } });
  await assert.rejects(planner.plan({ citizen: { id: 'citizen-1' } }), PlanResponseError);
  assert.deepEqual([calls, settled], [1, 1]);
  const records = readFileSync(filePath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(records.find(record => record.type === 'plan_response').content, '{broken');
  assert.ok(records.some(record => record.type === 'plan_error'));
});

test('simulation audit connects applied plans to actual outcomes and survives resets', async (t) => {
  const { audit, filePath } = localAudit(t);
  const client = { audit, model: 'offline', endpoint: 'http://mock.invalid', check: async () => {}, plan: async () => ({ plan: valid, tokens: 0 }) };
  const simulation = createSimulation(client);
  t.after(() => simulation.close());
  await simulation.check();
  simulation.control('play');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(simulation.state.planner.completed, 1);
  simulation.advance(1);
  simulation.advance(1);
  simulation.control('pause');
  assert.doesNotMatch(JSON.stringify(simulation.state.world), /audit|planId/);
  simulation.control('reset');
  const records = readFileSync(filePath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const applied = records.find(record => record.type === 'plan_applied');
  const executed = records.find(record => record.type === 'action_result');
  assert.equal(executed.planId, applied.planId);
  assert.equal(executed.runId, applied.runId);
  assert.equal(executed.status, 'completed');
  assert.equal(new Set(records.filter(record => record.type === 'run_started').map(record => record.runId)).size, 2);
});

test('throwing diagnostic sinks cannot interrupt a successful plan or simulation', async (t) => {
  const audit = { record: () => { throw new Error('disk failure'); } };
  const planner = createPlanner({ audit, fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(valid) } }] }) }) });
  assert.deepEqual((await planner.plan({ citizen: { id: 'citizen-1' } })).plan, valid);
  const simulation = createSimulation({ audit, model: 'offline', check: async () => {}, plan: async () => ({ plan: valid, tokens: 0 }) });
  t.after(() => simulation.close());
  await simulation.check();
  simulation.control('play');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(simulation.state.planner.completed, 1);
  assert.equal(simulation.state.running, true);
});
