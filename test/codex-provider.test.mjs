import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodexTransport, responsesRequest, CODEX_ENDPOINT } from '../lib/codex-provider.mjs';
import { createAgentPlanner } from '../lib/agent-planner.mjs';
import { createRuntimePlanner } from '../lib/runtime-planner.mjs';

const auth = { access: 'PRIVATE-TOKEN', accountId: 'PRIVATE-ACCOUNT' };
const body = { model: 'gpt-6-luna', reasoning_effort: 'high', max_tokens: 8192, tools: [], messages: [{ role: 'system', content: 'Be a citizen' }, { role: 'user', content: 'state' }] };
const stream = events => {
  const encoded = new TextEncoder().encode(events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''));
  return new Response(new ReadableStream({ start(controller) {
    // Split inside lines and UTF-8 codepoints, not just at SSE boundaries.
    for (let i = 0; i < encoded.length; i += 3) controller.enqueue(encoded.slice(i, i + 3));
    controller.close();
  } }));
};

test('Responses conversion preserves call pairing, high effort and encrypted replay', () => {
  const output = [{ type: 'reasoning', id: 'rs-1', encrypted_content: 'PRIVATE-REASONING', summary: [] }, { type: 'function_call', call_id: 'call-1', name: 'get_context', arguments: '{}' }];
  const converted = responsesRequest({ ...body, messages: [...body.messages, { role: 'assistant', providerHistory: output }, { role: 'tool', tool_call_id: 'call-1', content: '{"tick":4}' }] });
  assert.equal(converted.reasoning.effort, 'high');
  assert.equal(converted.max_output_tokens, 8192);
  assert.deepEqual(converted.input.slice(1, 3), output);
  assert.deepEqual(converted.input.at(-1), { type: 'function_call_output', call_id: 'call-1', output: '{"tick":4}' });
});

test('Codex transport meters stream completion and never audits auth or encrypted reasoning', async () => {
  const requests = [], audit = [], settlements = [];
  const transport = createCodexTransport({ readAuth: async () => auth, fetchImpl: async (url, options) => {
    assert.equal(url, `${CODEX_ENDPOINT}/responses`);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer PRIVATE-TOKEN');
    requests.push(JSON.parse(options.body));
    return stream([{ type: 'response.completed', response: { status: 'completed', output: [
      { type: 'reasoning', id: 'rs-1', encrypted_content: 'PRIVATE-REASONING', summary: [] },
      { type: 'function_call', call_id: `call-${requests.length}`, name: requests.length === 1 ? 'get_context' : 'continue_strategy', arguments: '{}' },
    ], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30, output_tokens_details: { reasoning_tokens: 12 } } } }]);
  } });
  const toolSession = { refresh: () => ({ tick: 0, citizen: { id: 'a' } }), execute(name) { if (name === 'continue_strategy') this.committed = { plan: {} }; return this.refresh(); } };
  const planner = createAgentPlanner({ ...transport, model: 'gpt-6-luna', audit: { record: event => audit.push(event) }, budget: { reserve: () => 'r', settle: (...args) => settlements.push(args) } });
  await planner.check();
  const result = await planner.plan({ tick: 0, citizen: { id: 'a' } }, undefined, { toolSession });
  assert.equal(result.tokens, 60);
  assert.equal(settlements[1][1].outputTokens, 20);
  assert.ok(JSON.stringify(requests[1]).includes('PRIVATE-REASONING'));
  assert.ok(!JSON.stringify(audit).includes('PRIVATE-'));
});

test('HTTP failure preserves status and retry metadata; incomplete streams fail closed', async () => {
  const transport = createCodexTransport({ readAuth: async () => auth, fetchImpl: async () => new Response('', { status: 429, headers: { 'retry-after': '30' } }) });
  const response = await transport.fetchImpl('', { body: JSON.stringify(body) });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '30');
  const broken = createCodexTransport({ readAuth: async () => auth, fetchImpl: async () => stream([{ type: 'response.created' }]) });
  await assert.rejects(broken.fetchImpl('', { body: JSON.stringify(body) }), /without a completed response/);
});

test('completed streamed items survive a terminal usage envelope without output', async () => {
  const transport = createCodexTransport({ readAuth: async () => auth, fetchImpl: async () => stream([
    { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', call_id: 'a', name: 'continue_strategy', arguments: '{}' } },
    { type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } } },
  ]) });
  const payload = await (await transport.fetchImpl('', { body: JSON.stringify(body) })).json();
  assert.equal(payload.choices[0].message.tool_calls[0].function.name, 'continue_strategy');
  assert.equal(payload.usage.total_tokens, 7);
});

test('runtime provider configuration is explicit and bounded', () => {
  assert.equal(createRuntimePlanner({ env: {} }).maxConcurrentTurns, 6);
  const codex = createRuntimePlanner({ env: { PROSPER_PROVIDER: 'openai-codex', PROSPER_CONCURRENCY: '4' } });
  assert.equal(codex.model, 'gpt-6-luna');
  assert.equal(codex.reasoningEffort, 'low');
  assert.equal(codex.maxConcurrentTurns, 4);
  assert.throws(() => createRuntimePlanner({ env: { PROSPER_CONCURRENCY: '99' } }), /Concurrency/);
  assert.throws(() => createRuntimePlanner({ env: { PROSPER_PROVIDER: 'other' } }), /PROSPER_PROVIDER/);
  assert.throws(() => createRuntimePlanner({ env: { PROSPER_PROVIDER: 'openai-codex', PROSPER_HARNESS: 'legacy' } }), /semantic/);
});
