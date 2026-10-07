import test from 'node:test';
import assert from 'node:assert/strict';
import { auditEvidence } from '../lib/monitor-evidence.mjs';

test('continuous evidence retains correlation and size metrics without prompts or private replay', () => {
  const requestParts = { tools: 18000, observation: 4000, instructions: 1000, publicHistory: 900, privateReplay: 50, envelope: 50 };
  const evidence = auditEvidence({ type: 'agent_request', sessionId: 'session', planId: 'plan', step: 2, promptBytes: 24000, requestParts,
    request: { messages: [{ content: 'PROMPT', reasoning: 'PRIVATE' }], tools: [{ function: { name: 'commit_strategy' } }] },
    providerHistory: 'ENCRYPTED', reasoning_content: 'PRIVATE', thinking: 'PRIVATE' });
  assert.deepEqual(evidence, { type: 'agent_request', sessionId: 'session', planId: 'plan', step: 2, promptBytes: 24000, requestParts,
    availableTools: ['commit_strategy'] });
  const result = { type: 'agent_tool_result', tool: 'open_offer', result: { ok: true, receiptId: 'offer-2' } };
  assert.deepEqual(auditEvidence(result), result);
  assert.deepEqual(auditEvidence({ type: 'agent_response', reasoning: { characters: 120 }, usage: { prompt_tokens: 100 } }),
    { type: 'agent_response', reasoning: { characters: 120 }, usage: { prompt_tokens: 100 } });
});
