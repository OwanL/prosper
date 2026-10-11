import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CandidateBudgetFailure } from '../src/evaluation/contracts.ts';
import type { CandidateContext, CandidateFeedback, DecisionInput } from '../src/evaluation/contracts.ts';
import type { CitizenObservation, Command } from '../src/shared/types.ts';
import { commandSchema } from '../src/citizen/tools.ts';
import {
  createLocalModelCandidate, createNoCommandCandidate, decodePrimitiveDecision,
  MECHANICS_CONTEXT, PRIMITIVE_PROMPT_SHA256, PRIMITIVE_PROMPT, primitiveCommandSchema,
  type LocalModelConfig, type PrimitiveModelReply, type PrimitiveModelRequest, type PrimitiveModelTransport,
} from '../src/evaluation/candidates/index.ts';

const signal = () => new AbortController().signal;
const observation = (): CitizenObservation => ({
  tick: 0, mapSize: { width: 37, height: 37 }, ascii: '', entityIndex: [], visible: [], remembered: [], markets: [], messages: [], alerts: [],
  citizen: { id: 'public-actor', name: 'Actor', x: 0, y: 0, color: '', personality: '', alive: true, health: 100, fullness: 100, gold: 0,
    inventory: {}, action: null, queue: [], goals: [], memories: [], knowledge: {}, lastResult: '', nextReviewTick: 0,
    consent: {}, reproductionCooldown: 0, parents: [] },
});
const input = (requestId = 'r1'): DecisionInput => ({ requestId, observation: observation(), remainingTicks: 100 });
const context = (patch: Partial<CandidateContext['limits']> = {}): CandidateContext => ({
  apiVersion: 1, mechanics: MECHANICS_CONTEXT, objective: { description: 'Disclosed objective', minHealth: 50, minFullness: 10 }, cadence: 1, horizon: 100,
  limits: { decisionTimeoutMs: 1000, episodeTimeoutMs: 10_000, teardownTimeoutMs: 1000, maxDecisions: 20, maxOutputBytes: 2000,
    maxModelCalls: 0, maxTokens: 0, ...patch },
});
const config = (patch: Partial<LocalModelConfig> = {}): LocalModelConfig => ({
  endpoint: 'http://127.0.0.1:11434/api/chat', model: 'explicit-local-model:tag', maxPromptBytes: 100_000, maxInputTokens: 1000, maxOutputTokens: 100, ...patch,
});
const advanceReply = (request: PrimitiveModelRequest): PrimitiveModelReply => ({ text: JSON.stringify({ requestId: request.requestId, kind: 'advance' }), usage: { inputTokens: 100, outputTokens: 10 } });
const transport = (complete: PrimitiveModelTransport['complete'] = async (request) => advanceReply(request)): PrimitiveModelTransport => ({ capability: 'mock', complete });
const mockContext = (patch: Partial<CandidateContext['limits']> = {}) => context({ maxModelCalls: 10, maxTokens: 11_000, ...patch });
const feedback = (requestId = 'r1'): CandidateFeedback => ({
  commit: { requestId, tick: 0, decision: { requestId, kind: 'advance' } }, immediateObservation: observation(), observations: [observation()],
});
const decode = (value: unknown, patch = {}) => decodePrimitiveDecision(value, { requestId: 'r1', maxOutputBytes: 10_000, ...patch });
const commands: Command[] = [
  { type: 'move', x: 4, y: 3 }, { type: 'harvest', depositId: 'known-deposit' }, { type: 'craft', item: 'scythe', tier: 7 },
  { type: 'build', kind: 'wall', tier: 1, x: 2, y: 3 },
  { type: 'refine', buildingId: 'known-station', fromTier: 2, direction: 'down' }, { type: 'attack', targetId: 'known-target' },
  { type: 'loot', lootId: 'known-loot' }, { type: 'cancel' }, { type: 'order', side: 'buy', item: 'fibre:3', quantity: 12, price: 2 },
  { type: 'cancel-order', orderId: 'public-order' }, { type: 'transfer', citizenId: 'known-person', gold: 2 },
  { type: 'give', citizenId: 'known-person', item: 'axe:3', quantity: 1 }, { type: 'message', text: 'public text' },
  { type: 'remember', text: 'notebook text' }, { type: 'goals', goals: ['public goal'] }, { type: 'reproduce', partnerId: 'known-person' },
  { type: 'consent', partnerId: 'known-person', accept: false },
];

describe('strict primitive decoder', () => {
  it.each(commands)('accepts real $type shape without semantic execution', (command) => {
    const value = { requestId: 'r1', kind: 'command', command: { ...command, queue: 'append' } };
    expect(decode(JSON.stringify(value))).toEqual(value);
    expect(primitiveCommandSchema.parse(command)).toEqual(commandSchema.parse(command));
  });
  it.each(['buy', 'sell'] as const)('accepts fractional commodity %s orders unchanged', (side) => {
    const value = { requestId: 'r1', kind: 'command', command: {
      type: 'order', side, item: 'food:1', quantity: 0.25, price: 3,
    } };
    expect(decode(JSON.stringify(value))).toEqual(value);
  });
  it.each([
    { type: 'order', side: 'sell', item: 'axe:1', quantity: 0.25, price: 1 },
    { type: 'order', side: 'buy', item: 'building:legacy-id', quantity: 1, price: 1 },
    { type: 'order', side: 'sell', item: 'food:1', quantity: Number.MAX_SAFE_INTEGER, price: 2 },
    { type: 'order', side: 'buy', item: 'food:1', quantity: Infinity, price: 1 },
    { type: 'order', side: 'buy', item: 'food:1', quantity: NaN, price: 1 },
    { type: 'give', citizenId: 'known-person', item: 'food:1', quantity: 0.25 },
    { type: 'transfer', citizenId: 'known-person', gold: 0.25 },
  ])('retains non-schema runtime bounds and other command integers %#', (command) => {
    expect(commandSchema.safeParse(command).success).toBe(false);
    expect(() => decode({ requestId: 'r1', kind: 'command', command })).toThrow('Invalid primitive decision structure.');
  });
  it('accepts no-command and does not insert a Command', () => {
    expect(decode({ requestId: 'r1', kind: 'advance' })).toEqual({ requestId: 'r1', kind: 'advance' });
  });
  it.each([
    {}, null, [], { requestId: 'r1', kind: 'advance', command: { type: 'cancel' } },
    { requestId: 'other', kind: 'advance' }, { requestId: 'r1', kind: 'command', command: { type: 'eat' } },
    { requestId: 'r1', kind: 'command', command: { type: 'wait', ticks: 1 } },
    { requestId: 'r1', kind: 'command', command: { type: 'set_policy' } },
    { requestId: 'r1', kind: 'command', command: { type: 'harvest', x: 0, y: 0 } },
    { requestId: 'r1', kind: 'command', command: { type: 'move', x: '0', y: 0 } },
    { requestId: 'r1', kind: 'command', command: { type: 'move', x: -1, y: 0 } },
    { requestId: 'r1', kind: 'command', command: { type: 'cancel', queue: 'later' } },
    { requestId: 'r1', kind: 'command', command: { type: 'craft', item: 'axe', tier: 8 } },
    { requestId: 'r1', kind: 'command', command: { type: 'order', side: 'buy', item: 'fibre:1', quantity: 0, price: 1 } },
    { requestId: 'r1', kind: 'command', command: { type: 'order', side: 'buy', item: 'fibre:1', quantity: 1, price: 1.5 } },
    { requestId: 'r1', kind: 'command', command: { type: 'order', side: 'buy', item: 'fibre:1', quantity: Number.MAX_SAFE_INTEGER + 1, price: 1 } },
    { requestId: 'r1', kind: 'command', command: { type: 'goals', goals: new Array(9).fill('x') } },
    { requestId: 'r1', kind: 'command', command: { type: 'remember', text: 'x'.repeat(601) } },
    { requestId: 'r1', kind: 'command', command: { type: 'message', text: 'x'.repeat(501) } },
    { requestId: 'r1', kind: 'command', command: { type: 'message', text: 'x', to: '' } },
  ])('rejects invalid output without repair %#', (value) => { expect(() => decode(value)).toThrow(); });
  it.each([
    '```json\n{"requestId":"r1","kind":"advance"}\n```',
    'Here is {"requestId":"r1","kind":"advance"}',
    '{"requestId":"r1","kind":"advance"}{"requestId":"r1","kind":"advance"}',
    '{"requestId":"r1","kind":"command","command":{"type":"cancel","type":"move","x":0,"y":0}}',
    '{"requestId":"r1","request\\u0049d":"r1","kind":"advance"}',
  ])('rejects wrapped, extra or ambiguous JSON %#', (raw) => { expect(() => decode(raw)).toThrow(); });
  it('reports stable decode categories without raw response fragments', () => {
    expect(() => decode('unique-raw-parse-fragment')).toThrow('Invalid JSON decision.');
    expect(() => decode({ requestId: 'r1', kind: 'unique-raw-schema-fragment' })).toThrow('Invalid primitive decision structure.');
    const cyclic: Record<string, unknown> = {}; cyclic['unique-raw-property-fragment'] = cyclic;
    expect(() => decode(cyclic)).toThrow('Decision must be serializable JSON.');
  });
  it('counts UTF-8 bytes and obeys the disclosed subset', () => {
    const raw = JSON.stringify({ requestId: 'r1', kind: 'command', command: { type: 'message', text: '😀' } });
    expect(() => decode(raw, { maxOutputBytes: raw.length })).toThrow('Output-byte');
    expect(() => decode(raw, { allowedCommands: ['move'] })).toThrow('public allowed');
    expect(decode({ requestId: 'r1', kind: 'advance' }, { allowedCommands: [] })).toEqual({ requestId: 'r1', kind: 'advance' });
  });
  it('leaves availability/knowledge/recipe checks to the harness', () => {
    // Structurally valid but not a usable station or funded trade. No fix inserted.
    const value = { requestId: 'r1', kind: 'command', command: { type: 'refine', buildingId: 'unknown', fromTier: 7 } };
    expect(decode(value)).toEqual(value);
  });
});

describe('frozen mechanics and no-command lifecycle', () => {
  it('pins the exact public snapshot and prompt without strategies', () => {
    expect(Object.isFrozen(MECHANICS_CONTEXT)).toBe(true);
    expect(createHash('sha256').update(MECHANICS_CONTEXT.text).digest('hex')).toBe(MECHANICS_CONTEXT.sha256);
    expect(createHash('sha256').update(PRIMITIVE_PROMPT).digest('hex')).toBe(PRIMITIVE_PROMPT_SHA256);
    expect(MECHANICS_CONTEXT.text).toContain('harvestDuration');
  });
  it('resets usage/history, remains advance-only and never mutates inputs', () => {
    const candidate = createNoCommandCandidate(); const publicInput = input(); const before = structuredClone(publicInput);
    expect(() => candidate.decide(publicInput, signal())).toThrow('reset');
    candidate.reset(context(), 1, signal());
    expect(candidate.decide(publicInput, signal())).toEqual({ requestId: 'r1', kind: 'advance' });
    candidate.feedback(feedback(), signal());
    expect(candidate.getUsage()).toMatchObject({ decisions: 1, modelCalls: 0, tokens: 0, historyEntries: 1 });
    expect(publicInput).toEqual(before);
    candidate.close(signal()); expect(() => candidate.decide(input('r2'), signal())).toThrow('reset');
    candidate.reset(context(), 2, signal()); expect(candidate.getUsage()).toMatchObject({ decisions: 0, historyEntries: 0 });
    expect(candidate.decide(input(), signal())).toEqual({ requestId: 'r1', kind: 'advance' });
  });
  it.each([-1, 0.5, NaN, 2 ** 32])('rejects invalid candidate seed %s', (seed) => {
    expect(() => createNoCommandCandidate().reset(context(), seed, signal())).toThrow('seed');
  });
  it('enforces decision/request/abort limits and independent factories', () => {
    const candidate = createNoCommandCandidate(); candidate.reset(context({ maxDecisions: 1 }), 0, signal());
    candidate.decide(input(), signal());
    expect(() => candidate.decide(input(), signal())).toThrow('reused');
    expect(() => candidate.decide(input('r2'), signal())).toThrow('Decision limit');
    const controller = new AbortController(); controller.abort();
    expect(() => candidate.reset(context(), 0, controller.signal)).toThrow('aborted');
    const independent = createNoCommandCandidate(); independent.reset(context(), 0xffffffff, signal());
    expect(independent.getUsage().decisions).toBe(0);
  });
  it('rejects mutated manual hash and detaches reset context from callers', () => {
    const candidate = createNoCommandCandidate(); const ctx = context();
    expect(() => candidate.reset({ ...ctx, mechanics: { ...ctx.mechanics, text: 'changed' } }, 0, signal())).toThrow('hash');
    candidate.reset(ctx, 0, signal()); ctx.limits.maxOutputBytes = 1;
    expect(candidate.decide(input(), signal())).toEqual({ requestId: 'r1', kind: 'advance' });
  });
});

describe('mocked local-model primitive protocol', () => {
  it('has no implicit endpoint/model, cloud fallback, real transport or retry', () => {
    for (const endpoint of ['https://example.com/api/chat', 'http://localhost.evil/api/chat', 'http://user@localhost/api/chat', 'file:///tmp/a'])
      expect(() => createLocalModelCandidate(config({ endpoint }), transport())).toThrow();
    for (const model of ['', 'qwen-cloud', ' model ']) expect(() => createLocalModelCandidate(config({ model }), transport())).toThrow();
    expect(() => createLocalModelCandidate(config(), { capability: 'local', complete: async () => { throw new Error('never called'); } })).toThrow('unsupported');
  });
  it('uses only public inputs and one structured mock call, records measured bytes/receipt', async () => {
    const calls: PrimitiveModelRequest[] = [];
    const candidate = createLocalModelCandidate(config(), transport(async (request) => { calls.push(request); return advanceReply(request); }));
    const ctx = mockContext(); const before = structuredClone(ctx); candidate.reset(ctx, 13, signal());
    expect(await candidate.decide(input(), signal())).toEqual({ requestId: 'r1', kind: 'advance' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ endpoint: config().endpoint, model: config().model, seed: 13, thinking: false, stream: false, maxInputTokens: 1000, maxOutputTokens: 100 });
    const publicPayload = JSON.parse(calls[0].messages[1].content);
    expect(publicPayload.observation).toEqual(input().observation);
    expect(publicPayload.objective).toEqual(ctx.objective);
    expect(Object.keys(publicPayload).sort()).toEqual(['cadence', 'history', 'historyOmissions', 'horizon', 'limits', 'objective', 'observation', 'remainingTicks', 'requestId'].sort());
    expect(ctx).toEqual(before);
    expect(candidate.metadata.inference).toBe('mock');
    expect(candidate.getUsage()).toMatchObject({ modelCalls: 1, tokens: 110, reservedTokens: 1100, unknownUsageCalls: 0, transportKind: 'mock' });
    expect(candidate.getUsage().outputBytes).toBe(Buffer.byteLength(advanceReply(calls[0]).text));
    expect(candidate.getUsage().promptBytes).toBe(Buffer.byteLength(JSON.stringify({ messages: calls[0].messages, format: calls[0].format })));
    candidate.feedback(feedback(), signal()); // normal completion must be idle
  });
  it.each([
    { text: '  { "requestId": "r1", "kind": "advance" }\n', maxOutputBytes: 2000, valid: true },
    { text: 'malformed response 😀', maxOutputBytes: 2000, valid: false },
    { text: 'oversized 😀'.repeat(100), maxOutputBytes: 20, valid: false },
  ])('captures bounded raw response audit before decoding %#', async ({ text, maxOutputBytes, valid }) => {
    const candidate = createLocalModelCandidate(config(), transport(async () => ({ text })));
    candidate.reset(mockContext({ maxOutputBytes }), 0, signal());
    expect(candidate.getLastResponse()).toBeNull();
    if (valid) expect(await candidate.decide(input(), signal())).toEqual({ requestId: 'r1', kind: 'advance' });
    else await expect(candidate.decide(input(), signal())).rejects.toThrow();
    const expected = {
      requestId: 'r1', bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
      ...(Buffer.byteLength(text) <= maxOutputBytes ? { text } : {}),
    };
    expect(candidate.getLastResponse()).toEqual(expected);
    const detached = candidate.getLastResponse()!; detached.sha256 = 'changed'; detached.text = 'changed';
    expect(candidate.getLastResponse()).toEqual(expected);
    candidate.reset(mockContext(), 1, signal()); expect(candidate.getLastResponse()).toBeNull();
    await candidate.decide(input(), signal()).catch(() => undefined);
    candidate.close(signal()); expect(candidate.getLastResponse()).toBeNull();
  });
  it('does not include response audit in prompts or preserve it after a pre-send failure', async () => {
    const calls: PrimitiveModelRequest[] = [];
    const candidate = createLocalModelCandidate(config(), transport(async (request) => {
      calls.push(request); return { text: 'malformed-audit-only-output' };
    }));
    candidate.reset(mockContext({ maxModelCalls: 2 }), 0, signal());
    await candidate.decide(input(), signal()).catch(() => undefined);
    expect(candidate.getLastResponse()?.text).toBe('malformed-audit-only-output');
    await candidate.decide(input('r2'), signal()).catch(() => undefined);
    expect(JSON.stringify(calls[1].messages)).not.toContain('malformed-audit-only-output');
    await expect(candidate.decide(input('r3'), signal())).rejects.toBeInstanceOf(CandidateBudgetFailure);
    expect(candidate.getLastResponse()).toBeNull();
  });
  it('keeps malformed raw response out of failure feedback and the next prompt', async () => {
    const raw = 'unique-raw-malformed-fragment';
    const calls: PrimitiveModelRequest[] = [];
    const candidate = createLocalModelCandidate(config(), transport(async (request) => {
      calls.push(request); return calls.length === 1 ? { text: raw } : advanceReply(request);
    }));
    candidate.reset(mockContext(), 0, signal());
    const failure = await candidate.decide(input(), signal()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Invalid JSON decision.');
    expect(candidate.getLastResponse()?.text).toBe(raw);
    const visibleFeedback = feedback();
    visibleFeedback.commit.decision = null;
    visibleFeedback.commit.failure = (failure as Error).message;
    candidate.feedback(visibleFeedback, signal());
    await candidate.decide(input('r2'), signal());
    expect(JSON.stringify(visibleFeedback)).not.toContain(raw);
    expect(JSON.stringify(calls[1].messages)).not.toContain(raw);
    expect(JSON.parse(calls[1].messages[1].content).history[0].commit.failure).toBe('Invalid JSON decision.');
  });
  it('retains failure accounting and does not repair, retry or choose prerequisites', async () => {
    const complete = vi.fn(async () => ({ text: 'markdown, not JSON' }));
    const candidate = createLocalModelCandidate(config(), transport(complete)); candidate.reset(mockContext(), 0, signal());
    await expect(candidate.decide(input(), signal())).rejects.toThrow();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(candidate.getUsage()).toMatchObject({ modelCalls: 1, tokens: 1100, unknownUsageCalls: 1, outputBytes: 18 });
  });
  it.each([
    { maxModelCalls: 0 }, { maxTokens: 1099 }, { maxModelCallsPerDecision: 0 }, { maxTokensPerDecision: 1099 },
  ])('checks episode/per-decision reservations before invoking transport %#', async (patch) => {
    const complete = vi.fn(async (request: PrimitiveModelRequest) => advanceReply(request));
    const candidate = createLocalModelCandidate(config(), transport(complete)); candidate.reset(mockContext(patch), 0, signal());
    const failure = await candidate.decide(input(), signal()).catch((error: unknown) => error);
    if ('maxModelCalls' in patch || 'maxTokens' in patch) {
      expect(failure).toBeInstanceOf(CandidateBudgetFailure);
      expect(failure).toMatchObject({ scope: 'episode' });
    } else {
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(CandidateBudgetFailure);
    }
    expect(complete).not.toHaveBeenCalled(); expect(candidate.getUsage().modelCalls).toBe(0);
  });
  it('retains missing receipts conservatively and exhausts budget', async () => {
    const candidate = createLocalModelCandidate(config(), transport(async (request) => ({ text: advanceReply(request).text })));
    candidate.reset(mockContext({ maxTokens: 1100 }), 0, signal());
    await candidate.decide(input(), signal());
    await expect(candidate.decide(input('r2'), signal())).rejects.toThrow('budget');
    expect(candidate.getUsage()).toMatchObject({ modelCalls: 1, tokens: 1100, unknownUsageCalls: 1 });
  });
  it('signals unavailable episode reservation even when charged usage remains below the ceiling', async () => {
    const complete = vi.fn(async (request: PrimitiveModelRequest) => ({ ...advanceReply(request), usage: { inputTokens: 120, outputTokens: 10 } }));
    const candidate = createLocalModelCandidate(config({ maxInputTokens: 4000, maxOutputTokens: 200 }), transport(complete));
    candidate.reset(mockContext({ maxTokens: 4200 }), 0, signal());
    await candidate.decide(input(), signal());
    const before = candidate.getUsage();
    expect(before).toMatchObject({ modelCalls: 1, tokens: 130, reservedTokens: 4200 });
    const failure = await candidate.decide(input('r2'), signal()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CandidateBudgetFailure);
    expect(failure).toMatchObject({ scope: 'episode', message: 'Token reservation exceeds budget.' });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(candidate.getUsage()).toMatchObject({ modelCalls: 1, tokens: 130, reservedTokens: 4200, pendingOperations: 0 });
  });
  it('signals episode call exhaustion without a second attempt', async () => {
    const complete = vi.fn(async (request: PrimitiveModelRequest) => advanceReply(request));
    const candidate = createLocalModelCandidate(config(), transport(complete));
    candidate.reset(mockContext({ maxModelCalls: 1 }), 0, signal());
    await candidate.decide(input(), signal());
    await expect(candidate.decide(input('r2'), signal())).rejects.toMatchObject({ name: 'CandidateBudgetFailure', scope: 'episode' });
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid/over-bound receipts and raw output-byte overflow', async () => {
    for (const usage of [{ inputTokens: -1, outputTokens: 1 }, { inputTokens: 1001, outputTokens: 1 }, { inputTokens: 1, outputTokens: 101 }, { inputTokens: 1.5, outputTokens: 1 }]) {
      const candidate = createLocalModelCandidate(config(), transport(async (request) => ({ text: advanceReply(request).text, usage })));
      candidate.reset(mockContext(), 0, signal()); await expect(candidate.decide(input(), signal())).rejects.toThrow('receipt');
      expect(candidate.getUsage().tokens).toBe(1100);
      expect(candidate.getLastResponse()?.text).toBe(JSON.stringify({ requestId: 'r1', kind: 'advance' }));
    }
    const candidate = createLocalModelCandidate(config(), transport()); candidate.reset(mockContext({ maxOutputBytes: 1 }), 0, signal());
    await expect(candidate.decide(input(), signal())).rejects.toThrow('Output-byte');
    expect(candidate.getUsage().outputBytes).toBeGreaterThan(1);
  });
  it('fails closed on oversized prompt without pruning or sending', async () => {
    const complete = vi.fn(async (request: PrimitiveModelRequest) => advanceReply(request));
    const candidate = createLocalModelCandidate(config({ maxPromptBytes: 1 }), transport(complete)); candidate.reset(mockContext(), 0, signal());
    await expect(candidate.decide(input(), signal())).rejects.toThrow('Prompt-byte'); expect(complete).not.toHaveBeenCalled();
  });
  it('bounds history, reports omissions and resets all episode scratch', async () => {
    const calls: PrimitiveModelRequest[] = [];
    const candidate = createLocalModelCandidate(config({ history: { maxEntries: 1, maxBytes: 5000 } }), transport(async (request) => { calls.push(request); return advanceReply(request); }));
    candidate.reset(mockContext(), 0, signal());
    await candidate.decide(input(), signal()); candidate.feedback(feedback(), signal());
    await candidate.decide(input('r2'), signal()); candidate.feedback(feedback('r2'), signal());
    await candidate.decide(input('r3'), signal());
    const payload = JSON.parse(calls[2].messages[1].content);
    expect(payload.history).toHaveLength(1); expect(payload.history[0].commit.requestId).toBe('r2'); expect(payload.historyOmissions).toBe(1);
    const oversized = feedback('r3'); oversized.immediateObservation.ascii = 'x'.repeat(6000); candidate.feedback(oversized, signal());
    expect(candidate.getUsage()).toMatchObject({ historyEntries: 1, droppedHistoryEntries: 2 });
    candidate.reset(mockContext(), 2, signal()); await candidate.decide(input(), signal());
    expect(JSON.parse(calls[3].messages[1].content).history).toEqual([]);
    expect(candidate.getUsage()).toMatchObject({ modelCalls: 1, tokens: 110, droppedHistoryEntries: 0 });
  });
  it('aborts promptly, suppresses late output and blocks reuse until ignored abort settles', async () => {
    let resolve!: (reply: PrimitiveModelReply) => void;
    const complete = vi.fn(() => new Promise<PrimitiveModelReply>((done) => { resolve = done; }));
    const candidate = createLocalModelCandidate(config(), transport(complete)); candidate.reset(mockContext(), 0, signal());
    const controller = new AbortController(); const decision = candidate.decide(input(), controller.signal);
    await Promise.resolve(); controller.abort(); await expect(decision).rejects.toThrow('aborted');
    await expect(candidate.decide(input('r2'), signal())).rejects.toThrow('outstanding');
    expect(() => candidate.reset(mockContext(), 0, signal())).toThrow('settle');
    candidate.close(signal()); expect(candidate.getUsage()).toMatchObject({ modelCalls: 1, tokens: 1100, pendingOperations: 1, transportPending: true });
    resolve({ text: '{"requestId":"r1","kind":"advance"}', usage: { inputTokens: 0, outputTokens: 0 } });
    await new Promise((done) => setImmediate(done));
    expect(candidate.getUsage()).toMatchObject({ modelCalls: 1, tokens: 1100, pendingOperations: 0, transportPending: false });
    expect(candidate.getLastResponse()).toBeNull(); // ignored-abort output is stale, not current audit
    candidate.reset(mockContext(), 0, signal()); expect(candidate.getUsage()).toMatchObject({ modelCalls: 0, tokens: 0 });
  });
  it('enforces per-decision wall deadline and close cancellation', async () => {
    const complete = (_request: PrimitiveModelRequest, abort: AbortSignal): Promise<PrimitiveModelReply> => new Promise((_resolve, reject) => abort.addEventListener('abort', () => reject(new Error('transport cancelled')), { once: true }));
    const candidate = createLocalModelCandidate(config(), transport(complete)); candidate.reset(mockContext({ decisionTimeoutMs: 10 }), 0, signal());
    await expect(candidate.decide(input(), signal())).rejects.toThrow();
    await new Promise((done) => setImmediate(done));
    candidate.reset(mockContext(), 0, signal()); const pending = candidate.decide(input(), signal()); await Promise.resolve();
    candidate.close(signal()); await expect(pending).rejects.toThrow();
    await new Promise((done) => setImmediate(done));
    expect(candidate.getUsage()).toMatchObject({ pendingOperations: 0, transportPending: false });
  });
});
