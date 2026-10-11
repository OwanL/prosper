import { BALANCE } from '../src/world/config.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CitizenObservation, Command } from '../src/shared/types.ts';
import type { CandidateFactory } from '../src/evaluation/contracts.ts';
import { noCommandBaseline } from '../src/evaluation/reference.ts';
import { replayEpisode, runEpisode } from '../src/evaluation/runner.ts';
import { hash } from '../src/evaluation/audit.ts';
import { initializeFixture, totalGold } from '../src/evaluation/fixtures.ts';
import { observe } from '../src/world/observation.ts';
import {
  HELD_OUT_CASES, HELD_OUT_LIMITS, HeldOutVerificationFailure, heldOutFixture, runHeldOutCase, verifyHeldOutEpisode,
  type HeldOutCase, type HeldOutControl,
} from '../src/evaluation/held-out.ts';

// EVALUATOR PRIVATE: action recipes and traces must not enter candidate context,
// retrieval, manuals, training or development feedback. These prove feasibility ONLY.
const outputs: string[] = [];
afterEach(() => { for (const path of outputs.splice(0)) rmSync(path, { recursive: true, force: true }); });
async function run(caseId: HeldOutCase, factory: CandidateFactory, control: HeldOutControl = 'standard') {
  try {
    const result = await runHeldOutCase(caseId, factory, control);
    outputs.push(result.episode.outputDirectory);
    return result;
  } catch (error) {
    if (error instanceof HeldOutVerificationFailure) outputs.push(error.outputDirectory);
    throw error;
  }
}
type Step = (observation: CitizenObservation) => Command;
function feasibilityOnly(caseId: HeldOutCase): CandidateFactory {
  const station = (observation: CitizenObservation) => observation.visible.flatMap(t => t.buildings)
    .find(b => b.kind === 'spinning-wheel' && b.ownerId === observation.citizen.id)!.id;
  const steps: Step[] = caseId === 'tool-production-sale' ? [
    () => ({ type: 'order', side: 'buy', item: 'fibre:1', quantity: 3, price: 2 }),
    () => ({ type: 'craft', item: 'knife', tier: 1 }),
    observation => ({ type: 'harvest', depositId: observation.visible.flatMap(t => t.deposits)
      .find(d => d.resource === 'food' && d.tier === 2)!.id }),
    () => ({ type: 'order', side: 'sell', item: 'food:2', quantity: 1, price: 12 }),
  ] : [
    () => ({ type: 'build', kind: 'spinning-wheel', tier: 1, x: 1, y: 1 }),
    observation => ({ type: 'refine', buildingId: station(observation), fromTier: 2, direction: 'down' }),
    observation => ({ type: 'refine', buildingId: station(observation), fromTier: 2, direction: 'down' }),
    observation => ({ type: 'refine', buildingId: station(observation), fromTier: 1, direction: 'up' }),
    () => ({ type: 'order', side: 'sell', item: 'fibre:2', quantity: 1, price: 9 }),
  ];
  return () => {
    let index = 0;
    return {
      metadata: { id: `evaluator-private-feasibility-${caseId}`, version: '1',
        artifact: `authored-script-sha256:${hash(steps.map(step => step.toString()))}`,
        provenance: 'Evaluator-authored private recipe; feasibility only, not model intelligence or optimality.',
        execution: 'cooperative-in-process', inference: 'none' },
      reset() { index = 0; },
      decide(input) {
        const step = input.observation.citizen.action ? undefined : steps[index];
        if (!step) return { requestId: input.requestId, kind: 'advance' };
        index++;
        return { requestId: input.requestId, kind: 'command', command: step(input.observation) };
      },
      feedback() {}, close() {},
    };
  };
}
/** Simple immediate-market-only primitive baseline, no physical strategy. */
function marketOnly(caseId: HeldOutCase): CandidateFactory {
  return () => ({
    metadata: { id: 'private-market-only-control', version: '1', artifact: 'one immediate market command then advance',
      provenance: 'Declared simple primitive comparator, no physical work or intelligence claim.', execution: 'cooperative-in-process' },
    reset() {},
    decide(input) {
      if (input.observation.tick !== 0) return { requestId: input.requestId, kind: 'advance' };
      return { requestId: input.requestId, kind: 'command', command: caseId === 'tool-production-sale'
        ? { type: 'order', side: 'buy', item: 'fibre:1', quantity: 3, price: 2 }
        : { type: 'order', side: 'sell', item: 'fibre:2', quantity: 1, price: 9 } };
    },
    feedback() {}, close() {},
  });
}
function records(directory: string): any[] {
  return readFileSync(join(directory, 'trace.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
}

// Two fixed scenarios, no broad seed hunt/tuning. Normal body vitals can pass
// without decisions; the private verifier must demand committed production/trade.
describe('evaluator-owned held-out prerequisite combinations', () => {
  it('pins source-valid idle endowments, direct/passive authority and finite funded orders', () => {
    for (const caseId of HELD_OUT_CASES) {
      const manifest = heldOutFixture(caseId);
      const initial = initializeFixture(manifest);
      const actor = initial.world.citizens[initial.actorId];
      const ids = Object.keys(initial.world.citizens);
      expect(manifest).toMatchObject({ split: 'held-out', creation: { seed: 21, autonomy: true }, horizon: 120, cadence: 1 });
      expect(actor).toMatchObject({ action: null, queue: [], health: 100, fullness: 100 });
      expect(actor.inventory['food:1'] ?? 0).toBe(0);
      expect(manifest.objective.description).not.toMatch(/knife|down-conversion|up-conversion|spinning-wheel/);
      expect(initial.options.authority?.citizens).toEqual({ [ids[0]]: 'direct', [ids[1]]: 'passive-body', [ids[2]]: 'passive-body' });
      expect(initial.options.authority?.newbornAuthority).toBe('passive-body');
      expect(manifest.allowedCommands).not.toContain('attack');
      expect(manifest.allowedCommands).not.toContain('give');
      expect(totalGold(initial.world)).toBe(caseId === 'tool-production-sale' ? 18 : 9);
      expect(initial.setupLog.every(s => s.knownResult.ok && s.dispatchResult.ok && s.dispatchResult.order?.filledQuantity === 0)).toBe(true);
      expect(initial.setupLog).toHaveLength(caseId === 'tool-production-sale' ? 2 : 1);
      if (caseId === 'tool-production-sale') {
        expect(observe(initial.world, initial.actorId).visible.flatMap(t => t.deposits)).toContainEqual(
          expect.objectContaining({ resource: 'food', tier: 2, x: actor.x, y: actor.y, stock: 1 }));
      } else {
        expect(Object.values(initial.world.deposits).some(d => d.x === 1 && d.y === 1)).toBe(false);
        expect(Object.values(initial.world.buildings)).toHaveLength(0);
      }
      // Factory calls do not share mutable fixture state.
      manifest.overrides[0].gold = 999;
      expect(heldOutFixture(caseId).overrides[0].gold).not.toBe(999);
    }
  });

  for (const caseId of HELD_OUT_CASES) {
    it(`${caseId}: private script establishes feasible completed work and actual delivery, with exact replay`, async () => {
      const { episode, verification } = await run(caseId, feasibilityOnly(caseId));
      expect(episode).toMatchObject({ status: 'complete', reason: 'horizon', ticks: 120, decisions: 120, failures: 0,
        accountingValid: true, usage: { modelCalls: 0, tokens: 0 } });
      expect(verification).toMatchObject({ success: true, runnerVitalsSuccess: true, vitals: true,
        producedUnits: 1, deliveredProducedUnits: 1, targetSaleUnits: 1, targetSaleGold: caseId === 'tool-production-sale' ? 12 : 9 });
      // These are private reference evidence, not required solution milestones.
      expect(verification.completed).toEqual(caseId === 'tool-production-sale'
        ? { craft: 1, toolHarvest: 1, build: 0, down: 0, up: 0 }
        : { craft: 0, toolHarvest: 0, build: 1, down: 2, up: 1 });
      expect(verification.replay.stateHash).toBe(episode.outcome.stateHash);
      expect(verifyHeldOutEpisode(episode.outputDirectory)).toEqual(verification);
      const trace = records(episode.outputDirectory);
      expect(trace.every(r => r.totalGold === r.initialGold && r.totalGold === (caseId === 'tool-production-sale' ? 18 : 9))).toBe(true);
      expect(trace.filter(r => r.kind === 'tick').map(r => r.tick)).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));
      expect(trace.filter(r => r.kind === 'decision' && r.commit.decision.kind === 'command')
        .every(r => r.commit.knownResult.ok && r.commit.dispatchResult.ok)).toBe(true);
      expect(episode.outcome.holders.every(h => h.alive && h.health === 100)).toBe(true);
      const retained = JSON.parse(readFileSync(join(episode.outputDirectory, 'held-out-definition.json'), 'utf8'));
      expect(retained.manifest).toEqual(heldOutFixture(caseId));
      expect(retained.limits).toEqual(HELD_OUT_LIMITS);
      expect(Object.keys(retained.files)).toEqual(['src/evaluation/held-out.ts', 'test/evaluation-held-out.test.ts', 'docs/research/held-out-capability-suite.md']);
      expect(hash(retained.files)).toBe(verification.definitionHash);
      const init = JSON.parse(readFileSync(join(episode.outputDirectory, 'initialization.json'), 'utf8'));
      // Candidate context comes only from runner reset; it has no evaluator recipes.
      expect(init.mechanics.text).not.toContain('evaluator-private-feasibility');
      expect(trace[0].observation.citizen.memories).toEqual([]);
    });

    for (const control of ['standard', 'endowed-meals'] as const) {
      it(`${caseId}/${control}: no command cannot receive credit for automatic meals or strategic rescue`, async () => {
        const { episode, verification } = await run(caseId, noCommandBaseline, control);
        expect(episode.status).toBe('complete');
        expect(verification).toMatchObject({ success: false, runnerVitalsSuccess: true, producedUnits: 0,
          deliveredProducedUnits: 0, targetSaleUnits: 0, targetSaleGold: 0 });
        expect(verification.completed).toEqual({ craft: 0, toolHarvest: 0, build: 0, down: 0, up: 0 });
        const trace = records(episode.outputDirectory);
        expect(trace.filter(r => r.kind === 'decision').every(r => r.commit.decision.kind === 'advance' && !r.commit.dispatchResult)).toBe(true);
        expect(trace.every(r => r.actor.action === null && r.actor.queue.length === 0)).toBe(true);
        expect(Object.values(episode.outcome.orders)).toHaveLength(caseId === 'tool-production-sale' ? 2 : 1);
        expect(episode.outcome.actor.fullness).toBeCloseTo(100 - 120 * BALANCE.fullnessDrain, 8);
      });
    }

    it(`${caseId}: immediate-market-only actions and sale of endowed output are not causal production`, async () => {
      const { episode, verification } = await run(caseId, marketOnly(caseId));
      expect(episode.status).toBe('complete');
      expect(verification).toMatchObject({ success: false, producedUnits: 0, deliveredProducedUnits: 0 });
      expect(verification.targetSaleUnits).toBe(caseId === 'tool-production-sale' ? 0 : 1);
      expect(verification.initialOutputUnits).toBe(caseId === 'tool-production-sale' ? 0 : 2);
    });
  }

  it('accepted then canceled work produces no capability credit and refunds ingredients', async () => {
    const factory: CandidateFactory = () => ({
      metadata: { id: 'private-cancel-control', version: '1', artifact: 'buy, start craft, cancel',
        provenance: 'Cancellation invariant control only', execution: 'cooperative-in-process' },
      reset() {},
      decide(input) {
        const commands: Command[] = [
          { type: 'order', side: 'buy', item: 'fibre:1', quantity: 3, price: 2 },
          { type: 'craft', item: 'knife', tier: 1 }, { type: 'cancel' },
        ];
        const command = commands[input.observation.tick];
        return command ? { requestId: input.requestId, kind: 'command', command } : { requestId: input.requestId, kind: 'advance' };
      }, feedback() {}, close() {},
    });
    const { episode, verification } = await run('tool-production-sale', factory);
    expect(verification.success).toBe(false);
    expect(verification.completed.craft).toBe(0);
    expect(episode.outcome.actor.inventory).toMatchObject({ 'wood:1': 3, 'fibre:1': 3 });
    expect(episode.outcome.actor.inventory['knife:1'] ?? 0).toBe(0);
  });

  it('rejects self-consistent extra endowments hidden behind canonical manifest labels', async () => {
    const caseId = 'station-conversion-sale';
    const canonical = await run(caseId, noCommandBaseline);
    const altered = heldOutFixture(caseId);
    altered.overrides[0].inventory!['wood:1']++;
    const episode = await runEpisode(altered, feasibilityOnly(caseId), { candidateSeed: 1, limits: HELD_OUT_LIMITS });
    outputs.push(episode.outputDirectory);
    expect(episode.status).toBe('complete');
    const initPath = join(episode.outputDirectory, 'initialization.json');
    const init = JSON.parse(readFileSync(initPath, 'utf8'));
    init.manifest = heldOutFixture(caseId);
    init.manifestHash = hash(init.manifest);
    writeFileSync(initPath, JSON.stringify(init));
    writeFileSync(join(episode.outputDirectory, 'held-out-definition.json'),
      readFileSync(join(canonical.episode.outputDirectory, 'held-out-definition.json'), 'utf8'));
    // Every state/setup hash still reconciles: only canonical-origin validation
    // distinguishes this genuinely simulated extra endowment from the frozen case.
    expect(replayEpisode(episode.outputDirectory).stateHash).toBe(episode.outcome.stateHash);
    expect(() => verifyHeldOutEpisode(episode.outputDirectory)).toThrow('Held-out origin mismatch');
  });

  it('rejects terminal feedback failure relabelled as complete horizon success', async () => {
    const factory: CandidateFactory = () => {
      const candidate = feasibilityOnly('station-conversion-sale')();
      return { ...candidate, feedback(feedback) {
        if (feedback.observations.at(-1)?.tick === 120) throw new Error('private-terminal-feedback-failure');
      } };
    };
    const { episode, verification } = await run('station-conversion-sale', factory);
    expect(episode).toMatchObject({ status: 'invalid', reason: 'private-terminal-feedback-failure', ticks: 120, success: false });
    expect(verification.success).toBe(false);
    expect(verification.deliveredProducedUnits).toBe(1);
    const trace = records(episode.outputDirectory);
    expect(trace.filter(r => r.kind === 'termination-failure')).toHaveLength(1);
    const relabelled = { ...episode, status: 'complete', reason: 'horizon', success: true };
    trace.at(-1).report = relabelled;
    writeFileSync(join(episode.outputDirectory, 'report.json'), JSON.stringify(relabelled));
    writeFileSync(join(episode.outputDirectory, 'trace.jsonl'), trace.map(r => JSON.stringify(r)).join('\n') + '\n');
    // Base replay checks state and report consistency, but not terminal status provenance.
    expect(replayEpisode(episode.outputDirectory).stateHash).toBe(episode.outcome.stateHash);
    expect(() => verifyHeldOutEpisode(episode.outputDirectory)).toThrow('Held-out termination/report mismatch');
  });

  it('rejects altered evaluator definitions rather than scoring an unbound trace', async () => {
    const { episode } = await run('station-conversion-sale', noCommandBaseline);
    const path = join(episode.outputDirectory, 'held-out-definition.json');
    const definition = JSON.parse(readFileSync(path, 'utf8'));
    definition.files['src/evaluation/held-out.ts'] += '\n// changed';
    writeFileSync(path, JSON.stringify(definition));
    expect(() => verifyHeldOutEpisode(episode.outputDirectory)).toThrow('Held-out definition mismatch');
  });
});
