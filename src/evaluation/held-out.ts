import { highestToolTier } from '../shared/tool-utils.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command, World } from '../shared/types.ts';
import { dispatch, tickWorld, type WorldControlOptions } from '../world/core.ts';
import { updateKnowledge } from '../world/observation.ts';
import { refinementOutput } from '../world/config.ts';
import type { CandidateFactory, CandidateLimits, CommitRecord } from './contracts.ts';
import { fixtureSchema, initializeFixture, totalGold, type FixtureManifest } from './fixtures.ts';
import { hash } from './audit.ts';
import { replayEpisode, runEpisode, type EpisodeReport } from './runner.ts';

/** Evaluator-private. Never import this module into candidate prompts/retrieval. */
export const HELD_OUT_CASES = ['tool-production-sale', 'station-conversion-sale'] as const;
export type HeldOutCase = typeof HELD_OUT_CASES[number];
export type HeldOutControl = 'standard' | 'endowed-meals';
export const HELD_OUT_LIMITS: Readonly<CandidateLimits> = Object.freeze({
  decisionTimeoutMs: 1000, episodeTimeoutMs: 30000, teardownTimeoutMs: 100,
  maxDecisions: 120, maxOutputBytes: 16384, maxModelCalls: 0, maxTokens: 0,
});
const VERSION = 'prosper-held-out-capabilities-1';
const allowedCommands: Command['type'][] = [
  'move', 'harvest', 'craft', 'build', 'refine', 'cancel', 'order', 'cancel-order',
];

/** Fresh validated manifest on each call. Fixed seed, no selection/search at runtime. */
export function heldOutFixture(caseId: HeldOutCase, control: HeldOutControl = 'standard'): FixtureManifest {
  if (!HELD_OUT_CASES.includes(caseId) || !['standard', 'endowed-meals'].includes(control))
    throw new Error('Unknown held-out case/control');
  const tool = caseId === 'tool-production-sale';
  return fixtureSchema.parse({
    version: 1, id: `${VERSION}-${caseId}-${control}`, split: 'held-out',
    provenance: 'Evaluator-authored endowments on fixed seed 21; no fabricated production/trades. Endowed-meals is a separately labelled control, not pooled with standard.',
    creation: { seed: 21, scenario: 'progression', population: 3, autonomy: true },
    actorIndex: 0, horizon: 120, cadence: 1,
    authorities: ['direct', 'passive-body', 'passive-body'], newbornAuthority: 'passive-body',
    allowedCommands,
    objective: {
      description: tool
        ? 'By tick 120, be alive with health at least 100 and fullness at least 70. Produce and actually sell at least one newly harvested T2 food unit to funded market demand for at least 12 gold. Endowed or purchased goods alone do not count as produced goods.'
        : 'By tick 120, be alive with health at least 100 and fullness at least 70. Construct an owned production station and produce and actually sell at least one newly refined T2 fibre unit to funded market demand for at least 9 gold. Endowed or purchased goods alone do not count as produced goods.',
      minHealth: 100, minFullness: 70,
    },
    overrides: [
      { citizenIndex: 0, position: tool ? { x: 28, y: 4 } : { x: 1, y: 1 }, health: 100, fullness: 100,
        gold: tool ? 6 : 0,
        inventory: { ...(tool ? { 'wood:1': 3 } : { 'wood:1': 6, 'fibre:1': 4, 'fibre:2': 2 }),
          ...(control === 'endowed-meals' ? { 'food:1': 3 } : {}) } },
      { citizenIndex: 1, position: { x: 2, y: 1 }, health: 100, fullness: 100, gold: 0,
        inventory: { 'food:1': 3, ...(tool ? { 'fibre:1': 3 } : {}) } },
      { citizenIndex: 2, position: { x: 1, y: 2 }, health: 100, fullness: 100, gold: tool ? 12 : 9,
        inventory: { 'food:1': 3 } },
    ],
    setup: [
      ...(tool ? [{ citizenIndex: 1, command: { type: 'order', side: 'sell', item: 'fibre:1', quantity: 3, price: 2 } }] : []),
      { citizenIndex: 2, command: { type: 'order', side: 'buy', item: tool ? 'food:2' : 'fibre:2', quantity: 1, price: tool ? 12 : 9 } },
    ],
  });
}

function definitionFiles(): Record<string, string> {
  return Object.fromEntries([
    ['src/evaluation/held-out.ts', new URL('./held-out.ts', import.meta.url)],
    ['test/evaluation-held-out.test.ts', new URL('../../test/evaluation-held-out.test.ts', import.meta.url)],
    ['docs/research/held-out-capability-suite.md', new URL('../../docs/research/held-out-capability-suite.md', import.meta.url)],
  ].map(([name, url]) => [String(name), readFileSync(url as URL, 'utf8')]));
}
function owned(world: World, actorId: string, item: string): number {
  const actor = world.citizens[actorId];
  return (actor.inventory[item] ?? 0) + (actor.action?.reserved[item] ?? 0)
    + Object.values(world.orders).filter(o => o.citizenId === actorId).reduce((n, o) => n + (o.escrowItems[item] ?? 0), 0);
}
function peerOwned(world: World, actorId: string, item: string): number {
  return Object.keys(world.citizens).filter(id => id !== actorId).reduce((n, id) => n + owned(world, id, item), 0);
}
export interface HeldOutVerification {
  version: string;
  definitionHash: string;
  caseId: HeldOutCase;
  control: HeldOutControl;
  status: EpisodeReport['status'];
  reason: string;
  success: boolean;
  /** The unmodified runner scores only vitals. This is NOT capability success. */
  runnerVitalsSuccess: boolean;
  vitals: boolean;
  completed: { craft: number; toolHarvest: number; build: number; down: number; up: number };
  initialOutputUnits: number;
  producedUnits: number;
  /** Conservative lineage: sell endowed/purchased units first, consume produced units first. */
  deliveredProducedUnits: number;
  targetSaleUnits: number;
  targetSaleGold: number;
  accountingValid: boolean;
  replay: { boundaries: number; stateHash: string };
}

/** Replay failure/definition mismatch throws: harness invalidity, not candidate failure.
 * Scoring uses reconstructed worlds, never candidate-visible claims or event text alone.
 */
export function verifyHeldOutEpisode(outputDirectory: string): HeldOutVerification {
  // Also enforces the runner's OS-temp path/source/setup/boundary integrity rules.
  const replay = replayEpisode(outputDirectory);
  const definition = JSON.parse(readFileSync(join(outputDirectory, 'held-out-definition.json'), 'utf8'));
  const files = definitionFiles();
  if (definition.version !== VERSION || hash(definition.files) !== definition.definitionHash
    || definition.definitionHash !== hash(files)) throw new Error('Held-out definition mismatch');
  const manifest = heldOutFixture(definition.caseId, definition.control);
  const init = JSON.parse(readFileSync(join(outputDirectory, 'initialization.json'), 'utf8'));
  if (hash(init.manifest) !== hash(manifest) || hash(definition.manifest) !== hash(manifest)
    || hash(init.limits) !== hash(HELD_OUT_LIMITS) || init.candidateSeed !== 1)
    throw new Error('Held-out initialization/budget mismatch');
  // Self-consistent replay is not proof of the declared origin: reconstruct every
  // endowment/setup/authority field from the frozen fixture, not from the artifact.
  const canonical = initializeFixture(manifest);
  for (const field of ['world', 'setupWorld', 'setupLog', 'actorId', 'options'] as const)
    if (hash(init[field]) !== hash(canonical[field])) throw new Error(`Held-out origin mismatch: ${field}`);
  const report: EpisodeReport = JSON.parse(readFileSync(join(outputDirectory, 'report.json'), 'utf8'));
  const world: World = structuredClone(init.world);
  const actorId: string = init.actorId;
  const options: WorldControlOptions = structuredClone(init.options);
  const tool = definition.caseId === 'tool-production-sale';
  const target = tool ? 'food:2' : 'fibre:2';
  const price = tool ? 12 : 9;
  const initialOutputUnits = owned(world, actorId, target);
  let otherUnits = initialOutputUnits, creditedUnits = 0, producedUnits = 0;
  let deliveredProducedUnits = 0, targetSaleUnits = 0, targetSaleGold = 0;
  const completed = { craft: 0, toolHarvest: 0, build: 0, down: 0, up: 0 };
  const builtStations = new Set<string>();
  const records = readFileSync(join(outputDirectory, 'trace.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  for (const record of records) {
    const before = world.citizens[actorId];
    const action = before.action ? structuredClone(before.action) : null;
    const preToolTier = highestToolTier(before, 'knife');
    const eventIds = new Set(world.events.map(e => e.id));
    const buildingIds = new Set(Object.keys(world.buildings));
    const peersBefore = peerOwned(world, actorId, target);
    let minted = 0;
    if (record.kind === 'decision') {
      const commit: CommitRecord = record.commit;
      if (commit.decision?.kind === 'command' && commit.knownResult?.ok) {
        const command = commit.decision.command;
        const result = dispatch(world, actorId, command, 'external', options);
        if (command.type === 'order' && command.side === 'sell' && command.item === target && result.ok && result.order) {
          const quantity = result.order.filledQuantity;
          if (peerOwned(world, actorId, target) - peersBefore !== quantity) throw new Error('Delivery reconciliation failure');
          // Escrow transfers do not count as deliveries. Funded settlement is required.
          const endowedSold = Math.min(quantity, otherUnits);
          otherUnits -= endowedSold;
          const producedSold = quantity - endowedSold;
          if (producedSold > creditedUnits) throw new Error('Output lineage failure');
          creditedUnits -= producedSold;
          deliveredProducedUnits += producedSold;
          targetSaleUnits += quantity;
          targetSaleGold += result.order.goldReceived;
        }
      }
      updateKnowledge(world);
    } else if (record.kind === 'tick') {
      tickWorld(world, 1, options); updateKnowledge(world);
      const finished = action && world.citizens[actorId].action?.id !== action.id
        && world.events.some(e => !eventIds.has(e.id) && e.kind === 'completion' && e.citizenId === actorId
          && e.text === `Completed ${action.command.type}.`);
      if (finished && action) {
        const command = action.command;
        if (command.type === 'craft' && command.item === 'knife' && command.tier === 1) completed.craft++;
        if (command.type === 'harvest') {
          const deposit = world.deposits[command.depositId];
          if (tool && deposit.resource === 'food' && deposit.tier === 2) {
            if (preToolTier > 0) completed.toolHarvest++;
            minted = 1;
          }
        }
        if (command.type === 'build' && command.kind === 'spinning-wheel') {
          const built = Object.values(world.buildings).find(b => !buildingIds.has(b.id) && b.ownerId === actorId
            && b.kind === command.kind && b.tier === command.tier && b.x === command.x && b.y === command.y);
          if (!built) throw new Error('Construction reconciliation failure');
          builtStations.add(built.id); completed.build++;
        }
        if (!tool && command.type === 'refine' && builtStations.has(command.buildingId)) {
          if (command.direction === 'down') completed.down++;
          else completed.up++;
          minted = refinementOutput('fibre', command.fromTier, command.direction)['fibre:2'] ?? 0;
        }
      }
    }
    creditedUnits += minted; producedUnits += minted;
    // Account for buying, reservation, cancellation, other processing, meals/death.
    const delta = owned(world, actorId, target) - otherUnits - creditedUnits;
    if (delta >= 0) otherUnits += delta;
    else {
      const consumedProduced = Math.min(-delta, creditedUnits);
      creditedUnits -= consumedProduced;
      otherUnits += delta + consumedProduced;
      if (otherUnits < 0) throw new Error('Negative output lineage');
    }
    if (totalGold(world) !== world.initialGold) throw new Error('Held-out accounting failure');
  }
  if (hash(world) !== replay.stateHash) throw new Error('Held-out replay divergence');
  const actor = world.citizens[actorId];
  const vitals = actor.alive && actor.health >= manifest.objective.minHealth && actor.fullness >= manifest.objective.minFullness;
  const terminalFailures = records.filter(record => record.kind === 'termination-failure');
  const teardownFailure = typeof report.reason === 'string' && report.reason.startsWith('teardown:') && report.reason.length > 9;
  const completedReason = actor.alive ? 'horizon' : 'actor-death';
  if (!['complete', 'incomplete', 'invalid'].includes(report.status) || terminalFailures.length > 1
    || typeof report.reason !== 'string' || report.reason.length === 0
    || report.status === 'complete' && (terminalFailures.length !== 0 || report.reason !== completedReason
      || actor.alive && world.tick !== manifest.horizon)
    || report.status !== 'complete' && report.success
    || report.status === 'invalid' && terminalFailures.length !== 1
    || terminalFailures.length === 1 && (typeof terminalFailures[0].reason !== 'string'
      || terminalFailures[0].reason.length === 0 || !teardownFailure && report.reason !== terminalFailures[0].reason)
    || report.status === 'incomplete' && terminalFailures.length === 0 && !teardownFailure
      && !['episode-budget', 'decision-budget', 'resource-budget'].includes(report.reason))
    throw new Error('Held-out termination/report mismatch');
  // Intermediate craft/tool/conversion counts are evidence, not a recipe gate.
  const work = producedUnits > 0 && (tool || completed.build > 0);
  return {
    version: VERSION, definitionHash: definition.definitionHash, caseId: definition.caseId, control: definition.control,
    status: report.status, reason: report.reason,
    success: report.status === 'complete' && world.tick === manifest.horizon && vitals && work
      && deliveredProducedUnits >= 1 && targetSaleGold >= price,
    runnerVitalsSuccess: report.success, vitals, completed, initialOutputUnits, producedUnits,
    deliveredProducedUnits, targetSaleUnits, targetSaleGold, accountingValid: true, replay,
  };
}

export class HeldOutVerificationFailure extends Error {
  constructor(readonly outputDirectory: string, message: string) {
    super(message);
    this.name = 'HeldOutVerificationFailure';
  }
}

/** Evaluator entry point. Candidate factory is the unchanged runner-local API v1.
 * No reference strategy is exported/supplied; reference proofs live only in private tests.
 */
export async function runHeldOutCase(caseId: HeldOutCase, factory: CandidateFactory,
  control: HeldOutControl = 'standard'): Promise<{ episode: EpisodeReport; verification: HeldOutVerification }> {
  const manifest = heldOutFixture(caseId, control);
  const files = definitionFiles();
  const definition = { version: VERSION, caseId, control, manifest, limits: HELD_OUT_LIMITS, candidateSeed: 1,
    files, definitionHash: hash(files) };
  const episode = await runEpisode(manifest, factory, { candidateSeed: 1, limits: HELD_OUT_LIMITS });
  writeFileSync(join(episode.outputDirectory, 'held-out-definition.json'), JSON.stringify(definition), { mode: 0o600 });
  try {
    const verification = verifyHeldOutEpisode(episode.outputDirectory);
    writeFileSync(join(episode.outputDirectory, 'held-out-verification.json'), JSON.stringify(verification), { mode: 0o600 });
    return { episode, verification };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'held-out-verification-failure';
    writeFileSync(join(episode.outputDirectory, 'held-out-verification.json'), JSON.stringify({
      version: VERSION, definitionHash: definition.definitionHash, caseId, control, valid: false, reason,
    }), { mode: 0o600 });
    // Preserve invalid-run artifacts, and expose their location for retention/cleanup.
    throw new HeldOutVerificationFailure(episode.outputDirectory, reason);
  }
}
