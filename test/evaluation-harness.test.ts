import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Command } from '../src/shared/types.ts';
import type { CandidateFactory, PrimitiveCandidate } from '../src/evaluation/contracts.ts';
import { developmentFixture, initializeFixture, totalGold } from '../src/evaluation/fixtures.ts';
import { developmentReference, noCommandBaseline } from '../src/evaluation/reference.ts';
import { replayEpisode, runEpisode } from '../src/evaluation/runner.ts';
import { createLocalModelCandidate, createNoCommandCandidate } from '../src/evaluation/candidates/index.ts';
import { BALANCE, nutrition } from '../src/world/config.ts';
const mockConfig = { endpoint: 'http://127.0.0.1:11434', model: 'mock-only-local', maxPromptBytes: 500000, maxInputTokens: 4000, maxOutputTokens: 200 }; 

const outputs: string[] = [];
afterEach(() => { for (const path of outputs.splice(0)) rmSync(path, { recursive: true, force: true }); });
async function run(...args: Parameters<typeof runEpisode>) { const report = await runEpisode(...args); outputs.push(report.outputDirectory); return report; }
function records(path: string): any[] { return readFileSync(join(path, 'trace.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)); }
function scripted(commands: Command[]): CandidateFactory {
  return () => {
    const candidate = noCommandBaseline(); let index = 0;
    return { ...candidate, reset() { index = 0; }, decide(input) { const command = commands[index++]; return command ? { kind: 'command', requestId: input.requestId, command } : { kind: 'advance', requestId: input.requestId }; } };
  };
}

describe('real-world headless evaluation', () => {
  it.each(['buy-meal', 'sell-buy-meal'] as const)('retains and replays %s reference versus no-command baseline', async kind => {
    const fixture = developmentFixture(kind);
    const report = await run(fixture, developmentReference(kind));
    expect(report.status).toBe('complete'); expect(report.success).toBe(true); expect(report.accountingValid).toBe(true);
    expect(report.outcome.actor.gold).toBe(0); expect(report.outcome.actor.inventory['food:1'] ?? 0).toBe(0);
    expect(report.outcome.actor.fullness).toBeCloseTo(80 + nutrition(1) - fixture.horizon * BALANCE.fullnessDrain, 8);
    const decision = records(report.outputDirectory).find(r => r.kind === 'decision');
    expect(decision.immediateObservation.citizen.fullness).toBe(80);
    expect(replayEpisode(report.outputDirectory).stateHash).toBe(report.outcome.stateHash);
    const baseline = await run(fixture, noCommandBaseline);
    expect(baseline.success).toBe(false); expect(baseline.outcome.actor.fullness).toBeCloseTo(80 - fixture.horizon * BALANCE.fullnessDrain);
    expect(baseline.outcome.actor.action).toBeNull(); expect(replayEpisode(baseline.outputDirectory).stateHash).toBe(baseline.outcome.stateHash);
  });
  it('strictly validates endowments and finite funded setup instead of repairing fixtures', () => {
    const fixture = developmentFixture('buy-meal');
    const initial = initializeFixture(fixture);
    expect(totalGold(initial.world)).toBe(4); expect(initial.world.initialGold).toBe(4);
    expect(initial.setupLog[0].dispatchResult.order?.filledQuantity).toBe(0);
    expect(Object.values(initial.world.orders)[0].escrowItems).toEqual({ 'food:1': 1 });
    for (const patch of [
      { ...fixture, authorities: ['direct'] },
      { ...fixture, overrides: [{ citizenIndex: 0, position: { x: 100000, y: 0 } }] },
      { ...fixture, overrides: [{ citizenIndex: 0, inventory: { 'food:999': 1 } }] },
      { ...fixture, overrides: [{ citizenIndex: 0, gold: -1 }] },
      { ...fixture, overrides: [{ citizenIndex: 0, health: 0 }] },
      { ...fixture, overrides: [{ citizenIndex: 1, inventory: {} }] },
      { ...fixture, overrides: [{ citizenIndex: 0, action: null }] },
    ]) expect(() => initializeFixture(patch)).toThrow();
  });
  it('does not leak emergency feeding, reactive or idle strategists at critical hunger', async () => {
    const fixture = developmentFixture('buy-meal', 7, 3);
    fixture.overrides[0].fullness = 0;
    const report = await run(fixture, noCommandBaseline);
    expect(report.outcome.actor.health).toBeCloseTo(99.4);
    expect(report.outcome.actor.action).toBeNull(); expect(report.outcome.actor.queue).toEqual([]);
    expect(report.outcome.actor.gold).toBe(4);
    const init = JSON.parse(readFileSync(join(report.outputDirectory, 'initialization.json'), 'utf8'));
    expect(init.options.authority.citizens[init.actorId]).toBe('direct');
    expect(Object.values(init.options.authority.citizens).filter(a => a === 'passive-body')).toHaveLength(1);
    expect(replayEpisode(report.outputDirectory).stateHash).toBe(report.outcome.stateHash);
  });
  it('separates malformed, known-gate and engine rejections, each consuming only normal cadence', async () => {
    const fixture = developmentFixture('sell-buy-meal', 1, 3);
    const command = scripted([{ type: 'harvest', depositId: 'unknown-entity' }, { type: 'order', side: 'buy', item: 'food:1', quantity: 1, price: 4 }]);
    const report = await run(fixture, () => {
      const candidate = command(); let n = 0;
      return { ...candidate, decide(input, signal) { return n++ === 0 ? { requestId: input.requestId, kind: 'command', command: { type: 'eat' } } : candidate.decide(input, signal); } };
    });
    const decisions = records(report.outputDirectory).filter(r => r.kind === 'decision');
    expect(decisions[0].commit.failure).toBeTruthy(); expect(decisions[0].commit.decision).toBeNull();
    expect(decisions[1].commit.knownResult.ok).toBe(false); expect(decisions[1].commit.dispatchResult).toBeUndefined();
    expect(decisions[2].commit.knownResult.ok).toBe(true); expect(decisions[2].commit.dispatchResult.ok).toBe(false);
    expect(report.ticks).toBe(3); expect(report.outcome.actor.gold).toBe(0);
    expect(replayEpisode(report.outputDirectory).stateHash).toBe(report.outcome.stateHash);
  });
  it('records partial settlement, resting escrow and real cancel-order refunds', async () => {
    const fixture = developmentFixture('buy-meal', 1, 2); fixture.overrides[0].gold = 14;
    const report = await run(fixture, () => {
      const candidate = noCommandBaseline(); let n = 0;
      return { ...candidate, decide(input) {
        const command: Command = n++ === 0 ? { type: 'order', side: 'buy', item: 'food:1', quantity: 2, price: 5 }
          : { type: 'cancel-order', orderId: input.observation.markets.find(o => o.citizenId === input.observation.citizen.id)!.id };
        return { requestId: input.requestId, kind: 'command', command };
      } };
    });
    const decisions = records(report.outputDirectory).filter(r => r.kind === 'decision');
    expect(decisions[0].commit.dispatchResult.order).toMatchObject({ filledQuantity: 1, remainingQuantity: 1, goldPaid: 4 });
    expect(Object.values(decisions[0].orders)).toEqual([expect.objectContaining({ escrowGold: 5 })]);
    expect(report.outcome.actor.gold).toBe(10); expect(Object.values(report.outcome.orders)).toHaveLength(0);
    expect(replayEpisode(report.outputDirectory).stateHash).toBe(report.outcome.stateHash);
  });
  it('preserves accepted work, FIFO candidate queues and per-tick knowledge while moving', async () => {
    const fixture = developmentFixture('buy-meal', 8, 20); fixture.setup = [];
    fixture.overrides[0].fullness = 100; fixture.overrides[0].inventory = { 'food:1': 6, 'fibre:1': 6 };
    const report = await run(fixture, scripted([{ type: 'craft', item: 'axe', tier: 1 }, { type: 'craft', item: 'axe', tier: 1, queue: 'append' }]));
    expect(report.outcome.actor.inventory['axe:1']).toBe(2); expect(report.outcome.actor.queue).toEqual([]); expect(report.outcome.actor.action).toBeNull();
    expect(records(report.outputDirectory).filter(r => r.kind === 'tick')).toHaveLength(20);
    expect(replayEpisode(report.outputDirectory).stateHash).toBe(report.outcome.stateHash);
    const move = developmentFixture('buy-meal', 8, 6); move.setup = [];
    const moved = await run(move, scripted([{ type: 'move', x: 3, y: 1 }, { type: 'move', x: 4, y: 1, queue: 'append' }]));
    const ticks = records(moved.outputDirectory).filter(r => r.kind === 'tick');
    expect(ticks.at(-1).observation.citizen.x).toBe(4);
    expect(ticks.every(r => r.observation.visible.every((tile: any) => tile.seenTick === r.tick))).toBe(true);
    expect(replayEpisode(moved.outputDirectory).stateHash).toBe(moved.outcome.stateHash);
  });
  it('death refunds/cancels remaining funded orders and does not invent remaining ticks', async () => {
    const fixture = developmentFixture('buy-meal', 1, 5); fixture.setup = [];
    fixture.overrides[0].fullness = 0; fixture.overrides[0].health = .1;
    const report = await run(fixture, scripted([{ type: 'order', side: 'buy', item: 'wood:1', quantity: 1, price: 1 }]));
    expect(report.reason).toBe('actor-death'); expect(report.ticks).toBe(1); expect(report.success).toBe(false);
    expect(Object.values(report.outcome.orders)).toHaveLength(0);
    expect(Object.values(report.outcome.loot)).toEqual([expect.objectContaining({ gold: 4 })]);
    expect(replayEpisode(report.outputDirectory).stateHash).toBe(report.outcome.stateHash);
  });
  it('pauses world for candidate latency and exposes only immutable citizen projection/public context', async () => {
    const fixture = developmentFixture('buy-meal');
    const report = await run(fixture, () => {
      const candidate = developmentReference('buy-meal')();
      return { ...candidate, reset(context) { expect(Object.isFrozen(context)).toBe(true); expect(context).not.toHaveProperty('seed'); expect(context).not.toHaveProperty('manifest'); },
        async decide(input, signal) {
          expect(Object.isFrozen(input.observation.citizen)).toBe(true);
          expect(input).not.toHaveProperty('world');
          expect(input.observation.visible.flatMap(t => t.citizens).filter(c => c.id !== input.observation.citizen.id).every(c => typeof c.gold === 'number' && 'inventory' in c && !('plan' in c) && !('mind' in c))).toBe(true);
          await new Promise(resolve => setTimeout(resolve, 20));
          expect(input.observation.tick).toBe(0);
          return candidate.decide(input, signal);
        } };
    });
    expect(report.success).toBe(true); expect(report.ticks).toBe(1); expect(report.costs.candidateMs).toBeGreaterThan(15);
  });
  it('contains aborted late results with no dispatch and records a normal no-command cadence', async () => {
    let aborted = false; let lateResultSettled = false;
    const report = await run(developmentFixture('buy-meal'), () => {
      const candidate = noCommandBaseline();
      return { ...candidate, decide(input, signal) {
        return new Promise(resolve => signal.addEventListener('abort', () => {
          aborted = true;
          // Settle after the timeout rejects, without a second wall-clock timer
          // competing with the containment deadline under parallel-suite load.
          queueMicrotask(() => {
            lateResultSettled = true;
            resolve({ requestId: input.requestId, kind: 'command', command: { type: 'order', side: 'buy', item: 'food:1', quantity: 1, price: 4 } });
          });
        }, { once: true }));
      } };
    // The 10ms decision timeout is the behavior under test; the episode's
    // overall wall budget must also accommodate parallel-suite contention.
    }, { limits: { decisionTimeoutMs: 10, teardownTimeoutMs: 100, episodeTimeoutMs: 60000 } });
    expect(aborted).toBe(true); expect(lateResultSettled).toBe(true);
    expect(report.status).toBe('complete'); expect(report.success).toBe(false); expect(report.ticks).toBe(1);
    expect(report.outcome.actor.gold).toBe(4); expect(report.failures).toBe(1);
    const decision = records(report.outputDirectory).find(r => r.kind === 'decision');
    expect(decision.commit.failure).toBe('timeout');
    expect(decision.commit.decision).toBeNull(); expect(decision.commit.dispatchResult).toBeUndefined();
    expect(replayEpisode(report.outputDirectory).stateHash).toBe(report.outcome.stateHash);
  });
  it('stops an uncontained timeout before any tick and blocks reuse', async () => {
    const candidate: PrimitiveCandidate = { ...noCommandBaseline(), decide() { return new Promise(() => {}); } };
    const report = await run(developmentFixture('buy-meal'), () => candidate, { limits: { decisionTimeoutMs: 5, teardownTimeoutMs: 5 } });
    expect(report.status).toBe('incomplete'); expect(report.ticks).toBe(0); expect(report.reason).toContain('unsafe');
    await expect(runEpisode(developmentFixture('buy-meal'), () => candidate)).rejects.toThrow('blocked');
  });
  it('stops exhausted episode decisions incomplete instead of free-running', async () => {
    const report = await run(developmentFixture('buy-meal', 1, 10), noCommandBaseline, { limits: { maxDecisions: 1 } });
    expect(report.status).toBe('incomplete'); expect(report.reason).toBe('decision-budget'); expect(report.ticks).toBe(1);
    expect(replayEpisode(report.outputDirectory).stateHash).toBe(report.outcome.stateHash);
  });
  it('uses configured fixed cadence clamped to the real remaining horizon', async () => {
    const fixture = developmentFixture('buy-meal', 1, 5); fixture.cadence = 3;
    const report = await run(fixture, noCommandBaseline);
    expect(report.decisions).toBe(2); expect(report.ticks).toBe(5);
    expect(records(report.outputDirectory).filter(r => r.kind === 'tick').map(r => r.tick)).toEqual([1, 2, 3, 4, 5]);
    expect(replayEpisode(report.outputDirectory).stateHash).toBe(report.outcome.stateHash);
  });
  it('bounds raw output and rejects mismatched request IDs before execution', async () => {
    for (const output of [(id: string) => ({ requestId: id, kind: 'advance', garbage: 'x'.repeat(500) }), () => ({ requestId: 'old', kind: 'advance' })]) {
      const report = await run(developmentFixture('buy-meal'), () => ({ ...noCommandBaseline(), decide(input) { return output(input.requestId); } }), { limits: { maxOutputBytes: 200 } });
      expect(report.failures).toBe(1); expect(report.outcome.actor.gold).toBe(4);
      const decision = records(report.outputDirectory).find(r => r.kind === 'decision');
      expect(decision.commit.decision).toBeNull();
      if (decision.raw.oversizedBytes) expect(decision.raw).not.toHaveProperty('garbage');
    }
  });
  it('admits only accounted mock inference and enforces numeric per-decision/episode budgets', async () => {
    function mock(): PrimitiveCandidate {
      let calls = 0;
      return { ...noCommandBaseline(), metadata: { ...noCommandBaseline().metadata, inference: 'mock' }, getUsage() { return { modelCalls: calls, tokens: calls * 10 }; }, decide(input) { calls++; return { requestId: input.requestId, kind: 'advance' }; } };
    }
    const report = await run(developmentFixture('buy-meal', 1, 3), mock, { limits: { maxModelCalls: 1, maxTokens: 10 } });
    expect(report.status).toBe('incomplete'); expect(report.ticks).toBe(1); expect(report.usage).toEqual({ modelCalls: 1, tokens: 10 });
    const over = await run(developmentFixture('buy-meal'), mock, { limits: { maxModelCalls: 2, maxTokens: 20, maxTokensPerDecision: 5 } });
    expect(over.ticks).toBe(0); expect(over.reason).toBe('decision-resource-budget');
    await expect(runEpisode(developmentFixture('buy-meal'), () => ({ ...noCommandBaseline(), metadata: { ...noCommandBaseline().metadata, inference: 'live' } }))).rejects.toThrow('Unsupported');
    const invalid = await run(developmentFixture('buy-meal'), () => ({ ...noCommandBaseline(), getUsage() { return { modelCalls: -1, tokens: 0 }; } }));
    expect(invalid.status).toBe('invalid'); expect(invalid.ticks).toBe(0);
    const unknown = await run(developmentFixture('buy-meal'), () => ({ ...mock(), getUsage() { return { modelCalls: 1, tokens: null }; } }), { limits: { maxModelCalls: 2, maxTokens: 20 } });
    expect(unknown.status).toBe('incomplete'); expect(unknown.usage.tokens).toBeNull(); expect(unknown.ticks).toBe(0);
  });
  it('integrates actual no-command and mocked local adapters through decoder/gate/authority/accounting', async () => {
    const fixture = developmentFixture('buy-meal');
    const baseline = await run(fixture, createNoCommandCandidate);
    expect(baseline.success).toBe(false); expect(baseline.usage.modelCalls).toBe(0);
    const model = await run(fixture, () => createLocalModelCandidate(mockConfig, {
      capability: 'mock', async complete(request) {
        const input = JSON.parse(request.messages.find(m => m.role === 'user')!.content);
        const ask = input.observation.markets.find((order: any) => order.side === 'sell' && order.item === 'food:1');
        return { text: JSON.stringify({ requestId: request.requestId, kind: 'command', command: { type: 'order', side: 'buy', item: ask.item, quantity: 1, price: ask.price } }), usage: { inputTokens: 100, outputTokens: 30 } };
      },
    }), { limits: { maxModelCalls: 1, maxTokens: 4200, maxModelCallsPerDecision: 1, maxTokensPerDecision: 4200 } });
    expect(model.success).toBe(true); expect(model.usage.modelCalls).toBe(1); expect(model.usage.tokens).toBe(130);
    const decision = records(model.outputDirectory).find(r => r.kind === 'decision');
    expect(decision.commit.knownResult.ok).toBe(true); expect(decision.commit.dispatchResult.order.filledQuantity).toBe(1);
    expect(decision.usage.reportedInputTokens).toBe(100);
    expect(replayEpisode(model.outputDirectory).stateHash).toBe(model.outcome.stateHash);
    const unknown = await run(fixture, () => createLocalModelCandidate(mockConfig, { capability: 'mock', async complete(request) {
      return { text: JSON.stringify({ requestId: request.requestId, kind: 'command', command: { type: 'harvest', depositId: 'not-known' } }) };
    } }), { limits: { maxModelCalls: 1, maxTokens: 4200 } });
    const rejected = records(unknown.outputDirectory).find(r => r.kind === 'decision');
    expect(rejected.commit.knownResult.ok).toBe(false); expect(rejected.commit.dispatchResult).toBeUndefined();
    expect(unknown.usage.tokens).toBe(4200); expect((unknown.usage as any).unknownUsageCalls).toBe(1);
    expect(replayEpisode(unknown.outputDirectory).stateHash).toBe(unknown.outcome.stateHash);
  });
  it.each(['valid', 'malformed', 'oversized'] as const)('retains bounded audit-only %s mock response before decoding', async kind => {
    let supplied = '';
    const report = await run(developmentFixture('buy-meal'), () => {
      const candidate = createLocalModelCandidate(mockConfig, { capability: 'mock', async complete(request) {
        supplied = kind === 'valid' ? JSON.stringify({ requestId: request.requestId, kind: 'advance' }, null, 2)
          : kind === 'malformed' ? '{ malformed provider reply' : 'x'.repeat(5000);
        return { text: supplied, usage: { inputTokens: 100, outputTokens: 30 } };
      } });
      const feedback = candidate.feedback.bind(candidate);
      candidate.feedback = (visible, signal) => { expect(visible).not.toHaveProperty('providerResponse'); expect(visible.commit).not.toHaveProperty('providerResponse'); feedback(visible, signal); };
      return candidate;
    }, { limits: { maxOutputBytes: 512, maxModelCalls: 1, maxTokens: 4200 } });
    const record = records(report.outputDirectory).find(r => r.kind === 'decision');
    expect(record.providerResponse).toMatchObject({ requestId: record.commit.requestId, bytes: Buffer.byteLength(supplied), sha256: createHash('sha256').update(supplied).digest('hex') });
    if (kind === 'oversized') expect(record.providerResponse).not.toHaveProperty('text');
    else expect(record.providerResponse.text).toBe(supplied);
    expect(record.commit.failure === undefined).toBe(kind === 'valid');
    expect(replayEpisode(report.outputDirectory).stateHash).toBe(report.outcome.stateHash);
  });
  it('keeps malformed raw response fragments out of feedback history and the next mock prompt', async () => {
    const marker = 'RAWSECRET'; const raw = `${marker}: invalid JSON response`;
    const prompts: string[] = []; let calls = 0;
    const report = await run(developmentFixture('buy-meal', 1, 2), () => createLocalModelCandidate(mockConfig, {
      capability: 'mock', async complete(request) {
        prompts.push(JSON.stringify(request.messages));
        const text = calls++ === 0 ? raw : JSON.stringify({ requestId: request.requestId, kind: 'advance' });
        return { text, usage: { inputTokens: 100, outputTokens: 30 } };
      },
    }), { limits: { maxModelCalls: 2, maxTokens: 8400 } });
    expect(calls).toBe(2); expect(report.failures).toBe(1);
    expect(prompts[1]).not.toContain(marker);
    const decision = records(report.outputDirectory).find(r => r.kind === 'decision');
    expect(decision.providerResponse.text).toBe(raw);
    expect(decision.commit.failure).not.toContain(marker);
    expect(replayEpisode(report.outputDirectory).stateHash).toBe(report.outcome.stateHash);
  });
  it('stops an unaffordable next episode reservation before cadence, without treating per-decision refusal as episode exhaustion', async () => {
    let calls = 0;
    const factory = () => createLocalModelCandidate(mockConfig, { capability: 'mock', async complete(request) {
      calls++;
      return { text: JSON.stringify({ requestId: request.requestId, kind: 'advance' }), usage: { inputTokens: 100, outputTokens: 30 } };
    } });
    // This checks numeric reservations/cadence, not wall-clock throughput under
    // parallel fork contention. Keep the call/token/tick budgets unchanged.
    const report = await run(developmentFixture('buy-meal', 1, 3), factory, { limits: { episodeTimeoutMs: 60000, maxModelCalls: 3, maxTokens: 4200 } });
    expect(calls).toBe(1); expect(report.usage.tokens).toBe(130);
    expect(report.status).toBe('incomplete'); expect(report.reason).toBe('resource-budget'); expect(report.ticks).toBe(1);
    const failure = records(report.outputDirectory).find(r => r.kind === 'candidate-failure');
    expect(failure.tick).toBe(1); expect(failure.commit.decision).toBeNull();
    expect(replayEpisode(report.outputDirectory).stateHash).toBe(report.outcome.stateHash);
    const perDecision = await run(developmentFixture('buy-meal', 1, 3), factory, { limits: { episodeTimeoutMs: 60000, maxModelCalls: 3, maxTokens: 8400, maxTokensPerDecision: 4100 } });
    expect(calls).toBe(1); expect(perDecision.usage.modelCalls).toBe(0);
    expect(perDecision.status).toBe('complete'); expect(perDecision.ticks).toBe(3); expect(perDecision.failures).toBe(3);
  }, 150000);
  it('does not mistake prompt abort for containment of an outstanding underlying mock operation', async () => {
    const adapter = createLocalModelCandidate(mockConfig, { capability: 'mock', complete() { return new Promise(() => {}); } });
    const report = await run(developmentFixture('buy-meal'), () => adapter, { limits: { decisionTimeoutMs: 10, teardownTimeoutMs: 10, maxModelCalls: 1, maxTokens: 4200 } });
    expect(report.status).toBe('incomplete'); expect(report.ticks).toBe(0); expect(report.reason).toContain('unsafe');
    expect(report.usage.tokens).toBe(4200); expect(report.usage.pendingOperations).toBe(1);
    expect(records(report.outputDirectory).find(r => r.kind === 'candidate-failure')).not.toHaveProperty('providerResponse');
    await expect(runEpisode(developmentFixture('buy-meal'), () => adapter)).rejects.toThrow('blocked');
  });
  it('rejects empty/truncated/missing trace boundaries and reconciles completion with the report', async () => {
    const report = await run(developmentFixture('buy-meal'), developmentReference('buy-meal'));
    const path = join(report.outputDirectory, 'trace.jsonl');
    const original = readFileSync(path, 'utf8'); const lines = records(report.outputDirectory);
    for (const broken of ['', lines.slice(0, -1).map(r => JSON.stringify(r)).join('\n'), lines.slice(1).map(r => JSON.stringify(r)).join('\n'), lines.filter(r => r.kind !== 'decision').map(r => JSON.stringify(r)).join('\n'), original.slice(0, -20)]) {
      writeFileSync(path, broken);
      expect(() => replayEpisode(report.outputDirectory)).toThrow();
    }
    writeFileSync(path, original);
    const reportPath = join(report.outputDirectory, 'report.json');
    writeFileSync(reportPath, JSON.stringify({ ...report, ticks: 0 }));
    expect(() => replayEpisode(report.outputDirectory)).toThrow('trace structure');
    const incomplete = await run(developmentFixture('buy-meal', 1, 5), createNoCommandCandidate, { limits: { maxDecisions: 1 } });
    expect(incomplete.status).toBe('incomplete');
    expect(replayEpisode(incomplete.outputDirectory).stateHash).toBe(incomplete.outcome.stateHash);
    const failed = await run(developmentFixture('buy-meal'), createNoCommandCandidate);
    const failedRecords = records(failed.outputDirectory);
    failedRecords.at(-1).report.success = true;
    writeFileSync(join(failed.outputDirectory, 'trace.jsonl'), failedRecords.map(r => JSON.stringify(r)).join('\n') + '\n');
    writeFileSync(join(failed.outputDirectory, 'report.json'), JSON.stringify({ ...failed, success: true }));
    expect(() => replayEpisode(failed.outputDirectory)).toThrow('final report/boundary reconciliation');
  });
  it('detects replay corruption instead of treating invalid mechanics as candidate failure', async () => {
    const report = await run(developmentFixture('buy-meal'), developmentReference('buy-meal'));
    const path = join(report.outputDirectory, 'trace.jsonl');
    const lines = records(report.outputDirectory); lines.find(r => r.kind === 'tick').stateHash = 'corrupted';
    writeFileSync(path, lines.map(r => JSON.stringify(r)).join('\n') + '\n');
    expect(() => replayEpisode(report.outputDirectory)).toThrow('Replay/accounting mismatch');
  });
});
