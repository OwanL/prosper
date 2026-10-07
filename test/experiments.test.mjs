import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDecision, probeDecision, cappedBudget, summarizeDecisions } from '../lib/experiments.mjs';

const observation = { tick: 500, citizen: { id: 'a', goals: ['Explore'] }, neighbors: [{ id: 'b', adult: true }],
  familyProposals: [{ id: 'family-1', makerId: 'b', recipientId: 'a', status: 'fulfilled', expiresAt: 1000 }] };
const plan = { tasks: [], work: null };
const sample = { id: 'case-1', observation, request: { model: 'old', messages: [{ role: 'system', content: 'rules' }, { role: 'user', content: JSON.stringify(observation) }], temperature: 0.7 } };
const variant = { name: 'test', model: 'test' };

test('assessment distinguishes consumed consent and does not penalize independent action', () => {
  assert.deepEqual(assessDecision(plan, observation).issues, []);
  assert.deepEqual(assessDecision({ ...plan, tasks: [{ type: 'reproduce', target: 'b' }] }, observation).issues, ['no-accepted-pairing']);
  const pending = structuredClone(observation);
  pending.familyProposals[0].status = 'pending';
  assert.deepEqual(assessDecision({ ...plan, tasks: [{ type: 'accept_family', proposal: 'family-1' }, { type: 'reproduce', target: 'b' }] }, pending).issues, []);
});

test('probes preserve exact recorded messages and settle invalid replies without retry', async () => {
  const calls = [], charges = [];
  const budget = { reserve: (...a) => { charges.push(a); return 'id'; }, settle: (...a) => charges.push(a) };
  const result = await probeDecision({ sample, variant, budget, endpoint: 'http://mock.invalid/v1', fetchImpl: async (_url, opts) => {
    calls.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ usage: { prompt_tokens: 12, completion_tokens: 3 }, choices: [{ message: { content: 'broken' } }] }) };
  } });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].messages, sample.request.messages);
  assert.equal(calls[0].model, 'test');
  assert.equal(calls[0].temperature, 0.7);
  assert.match(result.error, /invalid JSON/);
  assert.deepEqual(charges.at(-1), ['id', { inputTokens: 12, outputTokens: 3 }]);
});

test('failed and truncated probes remain charged and cannot be scored valid', async () => {
  for (const mode of ['network', 'length']) {
    const settled = [];
    const result = await probeDecision({ sample, variant, endpoint: 'http://mock.invalid/v1',
      budget: { reserve: () => 'id', settle: (...a) => settled.push(a) },
      fetchImpl: async () => {
        if (mode === 'network') throw new Error('offline');
        return { ok: true, json: async () => ({ usage: { prompt_tokens: 1, completion_tokens: 2 }, choices: [{ finish_reason: 'length', message: { content: JSON.stringify(plan) } }] }) };
      },
    });
    assert.ok(result.error);
    assert.equal(result.assessment, undefined);
    assert.equal(settled.length, 1);
    if (mode === 'network') assert.deepEqual(settled[0], ['id', null]);
  }
});

test('oversized probes and exhausted run budgets stop before transport', async () => {
  await assert.rejects(probeDecision({ sample, variant: { ...variant, instruction: 'x'.repeat(12000) }, budget: { reserve: () => assert.fail() } }), /prompt limit/);
  let charge = 0;
  const capped = cappedBudget({ snapshot: () => ({ chargedUsd: charge, inputPerMillion: 1, outputPerMillion: 1 }), reserve: () => { charge += 0.01; return 'id'; }, settle: () => {} }, 0.015);
  capped.reserve(10000, 0);
  assert.throws(() => capped.reserve(10000, 0), /spending cap/);
});

test('summary measures proposed behavior without equating silence to failure', () => {
  const summary = summarizeDecisions([{ variant: 'a', assessment: assessDecision(plan, observation) }, { variant: 'a', error: 'invalid' }]);
  assert.equal(summary.groups.a.attempts, 2);
  assert.equal(summary.groups.a.valid, 1);
  assert.equal(summary.groups.a.grounded, 1);
  assert.equal(summary.groups.a.communicationPlans, 0);
});

test('reservation-scoped probe caps exclude other writers while retaining uncertain usage and pending bounds', () => {
  let external = 0, sequence = 0;
  const ledger = { snapshot: () => ({ chargedUsd: external, inputPerMillion: 1, outputPerMillion: 1 }),
    reserve: () => `reservation-${++sequence}`, settle: () => {} };
  const cap = cappedBudget(ledger, 0.02, { scope: 'reservations' });
  const first = cap.reserve(10000, 0);
  external = 100;
  assert.equal(cap.spent(), 0.01);
  cap.settle(first, { inputTokens: 2000, outputTokens: 0 });
  assert.equal(cap.spent(), 0.002);
  const second = cap.reserve(10000, 0);
  cap.settle(second, null);
  assert.equal(cap.spent(), 0.012);
  assert.throws(() => cap.reserve(10000, 0), /spending cap/);
  assert.throws(() => cap.settle(first, null), /Unknown experiment/);
});
