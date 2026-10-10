import { mkdtempSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import type { CitizenObservation, Command, World } from '../shared/types.ts';
import { commandSchema } from '../citizen/tools.ts';
import { dispatch, tickWorld, type WorldControlOptions } from '../world/core.ts';
import { observe, updateKnowledge, validateKnownCommand } from '../world/observation.ts';
import type { CandidateFactory, CandidateLimits, CandidateUsage, CommitRecord, PrimitiveCandidate, PrimitiveDecision } from './contracts.ts';
import { CandidateBudgetFailure } from './contracts.ts';
import { isAuditedLocalCandidate } from './candidates/local-model.ts';
import { initializeFixture, totalGold } from './fixtures.ts';
import { hash, sourceIdentity, TraceWriter, auditState } from './audit.ts';
import { mechanicsContext } from './mechanics.ts';

export const DEFAULT_LIMITS: CandidateLimits = Object.freeze({
  decisionTimeoutMs: 1000, episodeTimeoutMs: 30000, teardownTimeoutMs: 100,
  maxDecisions: 1000, maxOutputBytes: 16384, maxModelCalls: 0, maxTokens: 0,
});
const limitsSchema = z.object({
  decisionTimeoutMs: z.number().int().positive().max(2147483647), episodeTimeoutMs: z.number().int().positive().max(2147483647),
  teardownTimeoutMs: z.number().int().positive().max(2147483647), maxDecisions: z.number().int().positive(),
  maxOutputBytes: z.number().int().positive(), maxModelCalls: z.number().int().nonnegative(), maxTokens: z.number().int().nonnegative(),
  maxModelCallsPerDecision: z.number().int().nonnegative().optional(), maxTokensPerDecision: z.number().int().nonnegative().optional(),
}).strict();
const decisionSchema = z.union([
  z.object({ requestId: z.string(), kind: z.literal('advance') }).strict(),
  z.object({ requestId: z.string(), kind: z.literal('command'), command: commandSchema }).strict(),
]);
function immutable<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
  };
  freeze(clone);
  return clone;
}
const poisoned = new WeakSet<PrimitiveCandidate>();
class HookFailure extends Error {
  constructor(message: string, readonly unsafe = false) { super(message); }
}
/** Cooperative code only: synchronous runaway code cannot be preempted in this process. */
async function bounded<T>(candidate: PrimitiveCandidate, hook: (signal: AbortSignal) => T | Promise<T>, timeout: number, teardown: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = performance.now();
  const pending = Promise.resolve().then(() => hook(controller.signal));
  const settled = pending.then(() => true, () => true);
  try {
    const result = await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new HookFailure('timeout')); }, timeout);
    })]);
    if (performance.now() - started > timeout) throw new HookFailure('timeout');
    return result;
  } catch (error) {
    controller.abort();
    if (error instanceof HookFailure) {
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      const contained = await Promise.race([settled, new Promise<boolean>(resolve => { cleanupTimer = setTimeout(() => resolve(false), teardown); })]);
      clearTimeout(cleanupTimer);
      if (!contained) { poisoned.add(candidate); throw new HookFailure('unsafe-uncontained-timeout', true); }
    }
    throw error;
  } finally { clearTimeout(timer); }
}
export interface EpisodeReport {
  outputDirectory: string;
  status: 'complete' | 'incomplete' | 'invalid';
  reason: string;
  success: boolean;
  ticks: number;
  decisions: number;
  failures: number;
  accountingValid: boolean;
  usage: CandidateUsage;
  outcome: ReturnType<typeof auditState>;
  costs: { wallMs: number; candidateMs: number; engineMs: number; knowledgeMs: number; traceMs: number; ticksPerSecond: number; outputBytes: number; memory: 'unknown-not-enforced'; search: 'unknown-not-enforced' };
}
/** Always creates a unique OS-temp output directory. Caller owns cleanup/approved retention. */
export async function runEpisode(input: unknown, factory: CandidateFactory, configuration: {
  candidateSeed?: number; limits?: Partial<CandidateLimits>;
} = {}): Promise<EpisodeReport> {
  const limits = limitsSchema.parse({ ...DEFAULT_LIMITS, ...configuration.limits });
  const initialized = initializeFixture(input);
  const { world, actorId, manifest, options, setupWorld, setupLog } = initialized;
  const candidate = factory();
  if (poisoned.has(candidate)) throw new Error('Candidate blocked after uncontained cancellation');
  const local = candidate.metadata.inference === 'live' && isAuditedLocalCandidate(candidate);
  if (candidate.metadata.execution !== 'cooperative-in-process' || candidate.metadata.inference === 'live' && !local)
    throw new Error('Unsupported execution: unaudited live/uncontained candidates are not admitted');
  const inference = candidate.metadata.inference === 'mock' || local;
  if (inference && !candidate.getUsage) throw new Error('Inference requires cumulative accounting');
  if (local && (limits.maxModelCalls < 1 || limits.maxTokens < 1)) throw new Error('Local inference requires positive explicit call/token budgets');
  const candidateSeed = configuration.candidateSeed ?? 1;
  if (!Number.isSafeInteger(candidateSeed)) throw new Error('Invalid candidate seed');
  const outputDirectory = mkdtempSync(join(tmpdir(), 'prosper-evaluation-'));
  const trace = new TraceWriter(join(outputDirectory, 'trace.jsonl'));
  const identity = sourceIdentity();
  const mechanics = mechanicsContext();
  writeFileSync(join(outputDirectory, 'initialization.json'), JSON.stringify({
    version: 1, manifest, manifestHash: hash(manifest), source: identity, initializedHash: hash(world),
    world, setupWorld, setupLog, actorId, options, candidateSeed, candidate: candidate.metadata, limits, mechanics,
  }), { mode: 0o600 });
  trace.append('initialization', world, actorId, { observation: observe(world, actorId), authority: options.authority });
  let decisions = 0, failures = 0, outputBytes = 0;
  let candidateMs = 0, engineMs = 0, knowledgeMs = 0, traceMs = 0;
  let usage: CandidateUsage = { modelCalls: 0, tokens: 0 };
  const started = performance.now();
  const deadline = started + limits.episodeTimeoutMs;
  let status: EpisodeReport['status'] = 'incomplete', reason = 'episode-budget';
  const checkUsage = (before: CandidateUsage = { modelCalls: 0, tokens: 0 }, perDecision = false) => {
    const reported = candidate.getUsage?.() ?? { modelCalls: 0, tokens: 0 };
    if (!Number.isSafeInteger(reported.modelCalls) || reported.modelCalls < usage.modelCalls ||
      reported.tokens !== null && (!Number.isSafeInteger(reported.tokens) || reported.tokens < (usage.tokens ?? 0))) throw new Error('Invalid/nonmonotonic candidate accounting');
    usage = structuredClone(reported);
    if (reported.pendingOperations !== undefined && (!Number.isSafeInteger(reported.pendingOperations) || reported.pendingOperations < 0)) throw new Error('Invalid pending operation accounting');
    if ((reported.pendingOperations ?? 0) > 0) { poisoned.add(candidate); throw new HookFailure('unsafe-pending-operations', true); }
    if (!inference && (usage.modelCalls > 0 || usage.tokens !== 0)) throw new Error('Undeclared inference usage');
    if (usage.tokens === null) throw new HookFailure('unknown-token-usage');
    if (usage.modelCalls > limits.maxModelCalls || usage.tokens > limits.maxTokens) throw new HookFailure('resource-budget');
    if (perDecision && (usage.modelCalls - before.modelCalls > (limits.maxModelCallsPerDecision ?? limits.maxModelCalls) || usage.tokens - (before.tokens ?? 0) > (limits.maxTokensPerDecision ?? limits.maxTokens))) throw new HookFailure('decision-resource-budget');
  };
  const hook = async <T>(action: (signal: AbortSignal) => T | Promise<T>): Promise<T> => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new HookFailure('episode-budget');
    const start = performance.now();
    try { return await bounded(candidate, action, Math.min(limits.decisionTimeoutMs, remaining), limits.teardownTimeoutMs); }
    finally { candidateMs += performance.now() - start; }
  };
  const append = (kind: string, detail: Record<string, unknown>) => {
    const start = performance.now();
    const requestId = (detail.commit as CommitRecord | undefined)?.requestId;
    const response = requestId ? candidate.getLastResponse?.() : null;
    if (response && response.requestId === requestId) {
      if (!Number.isSafeInteger(response.bytes) || response.bytes < 0 || !/^[a-f0-9]{64}$/.test(response.sha256)
        || response.text !== undefined && (typeof response.text !== 'string' || Buffer.byteLength(response.text) !== response.bytes
          || createHash('sha256').update(response.text).digest('hex') !== response.sha256)) throw new Error('Invalid response audit');
      detail = { ...detail, providerResponse: { requestId: response.requestId, bytes: response.bytes, sha256: response.sha256,
        ...(response.text !== undefined && response.bytes <= limits.maxOutputBytes ? { text: response.text } : {}),
      } };
    }
    trace.append(kind, world, actorId, detail); traceMs += performance.now() - start;
    if (totalGold(world) !== world.initialGold) throw new Error('gold-accounting-failure');
  };
  const knowledge = () => { const start = performance.now(); updateKnowledge(world); knowledgeMs += performance.now() - start; };
  try {
    await hook(signal => candidate.reset(immutable({ apiVersion: 1, mechanics, objective: manifest.objective, cadence: manifest.cadence, horizon: manifest.horizon, limits,
      ...(manifest.allowedCommands ? { allowedCommands: manifest.allowedCommands as Command['type'][] } : {}),
    }), candidateSeed, signal));
    checkUsage();
    while (world.tick < manifest.horizon && world.citizens[actorId].alive) {
      if (performance.now() >= deadline || decisions >= limits.maxDecisions) { reason = decisions >= limits.maxDecisions ? 'decision-budget' : 'episode-budget'; break; }
      if (inference && (usage.modelCalls >= limits.maxModelCalls || (usage.tokens ?? Infinity) >= limits.maxTokens)) { reason = 'resource-budget'; break; }
      const requestId = `${randomUUID()}:${decisions++}`;
      const before = { ...usage };
      const observation = immutable(observe(world, actorId));
      const commit: CommitRecord = { requestId, tick: world.tick, decision: null };
      let raw: unknown, rawAudit: unknown;
      try {
        raw = await hook(signal => candidate.decide(immutable({ requestId, observation, remainingTicks: manifest.horizon - world.tick }), signal));
        const encoded = JSON.stringify(raw);
        if (encoded === undefined) throw new Error('non-JSON-output');
        const bytes = Buffer.byteLength(encoded); outputBytes += bytes;
        rawAudit = bytes > limits.maxOutputBytes ? { oversizedBytes: bytes, sha256: hash(raw) } : structuredClone(raw);
        if (bytes > limits.maxOutputBytes) throw new Error('output-byte-limit');
        const parsed = decisionSchema.parse(raw) as PrimitiveDecision;
        if (parsed.requestId !== requestId) throw new Error('request-id-mismatch');
        if (parsed.kind === 'command' && manifest.allowedCommands && !manifest.allowedCommands.includes(parsed.command.type)) throw new Error('command-not-in-public-subset');
        commit.decision = parsed;
      } catch (error) {
        commit.failure = error instanceof Error ? error.message : 'candidate-failure'; failures++;
        if (error instanceof CandidateBudgetFailure && error.scope === 'episode') {
          checkUsage(before, true);
          append('candidate-failure', { commit, observation, raw: rawAudit, usage });
          throw new HookFailure('resource-budget');
        }
        if (error instanceof HookFailure && error.unsafe) {
          append('candidate-failure', { commit, observation, raw: rawAudit }); throw error;
        }
      }
      // Revoked/late promises have no execution callback. Only this current decoded value can commit.
      try { checkUsage(before, true); }
      catch (error) { append('candidate-failure', { commit, observation, raw: rawAudit, usage }); throw error; }
      if (performance.now() >= deadline) { append('candidate-failure', { commit, observation, raw: rawAudit, usage }); reason = 'episode-budget'; break; }
      if (commit.decision?.kind === 'command') {
        commit.knownResult = validateKnownCommand(world, actorId, commit.decision.command);
        if (commit.knownResult.ok) {
          const start = performance.now();
          commit.dispatchResult = dispatch(world, actorId, commit.decision.command, 'external', options);
          engineMs += performance.now() - start;
        }
      }
      knowledge();
      const immediateObservation = immutable(observe(world, actorId));
      append('decision', { commit, observation, immediateObservation, raw: rawAudit, usage });
      const observations: CitizenObservation[] = [];
      const ticks = Math.min(manifest.cadence, manifest.horizon - world.tick);
      for (let i = 0; i < ticks && world.citizens[actorId].alive; i++) {
        if (performance.now() >= deadline) { reason = 'episode-budget'; break; }
        const start = performance.now(); tickWorld(world, 1, options); engineMs += performance.now() - start;
        knowledge();
        const visible = immutable(observe(world, actorId)); observations.push(visible);
        append('tick', { observation: visible, authority: options.authority });
      }
      await hook(signal => candidate.feedback(immutable({ commit, immediateObservation, observations }), signal));
      checkUsage();
    }
    if (world.tick >= manifest.horizon || !world.citizens[actorId].alive) { status = 'complete'; reason = world.citizens[actorId].alive ? 'horizon' : 'actor-death'; }
  } catch (error) {
    reason = error instanceof Error ? error.message : 'runner-failure';
    status = error instanceof HookFailure ? 'incomplete' : 'invalid';
    trace.append('termination-failure', world, actorId, { reason, usage });
  } finally {
    try { await bounded(candidate, signal => candidate.close(signal), limits.teardownTimeoutMs, limits.teardownTimeoutMs); checkUsage(); }
    catch (error) { reason = `teardown:${error instanceof Error ? error.message : 'failure'}`; if (status !== 'invalid') status = 'incomplete'; poisoned.add(candidate); }
  }
  const wallMs = performance.now() - started;
  const outcome = auditState(world, actorId);
  const report: EpisodeReport = {
    outputDirectory, status, reason, success: status === 'complete' && world.tick === manifest.horizon && outcome.actor.alive && outcome.actor.health >= manifest.objective.minHealth && outcome.actor.fullness >= manifest.objective.minFullness,
    ticks: world.tick, decisions, failures, accountingValid: totalGold(world) === world.initialGold, usage, outcome,
    costs: { wallMs, candidateMs, engineMs, knowledgeMs, traceMs, ticksPerSecond: world.tick / (wallMs / 1000), outputBytes, memory: 'unknown-not-enforced', search: 'unknown-not-enforced' },
  };
  trace.append('completion', world, actorId, { report });
  writeFileSync(join(outputDirectory, 'report.json'), JSON.stringify(report), { mode: 0o600 });
  return report;
}

/** Exact hashes (including floating point JSON), no tolerance-based hiding of divergence. */
export function replayEpisode(outputDirectory: string): { boundaries: number; stateHash: string } {
  const location = relative(realpathSync(tmpdir()), realpathSync(outputDirectory));
  if (isAbsolute(location) || location.startsWith('..') || !basename(outputDirectory).startsWith('prosper-evaluation-')) throw new Error('Replay inputs must be harness-owned OS-temp outputs');
  const init = JSON.parse(readFileSync(join(outputDirectory, 'initialization.json'), 'utf8'));
  if (hash(init.manifest) !== init.manifestHash || hash(init.world) !== init.initializedHash) throw new Error('Initialization artifact mismatch');
  const identity = sourceIdentity();
  if (identity.sha256 !== init.source.sha256 || identity.contractSha256 !== init.source.contractSha256) throw new Error('Replay requires identical source and contract');
  const options: WorldControlOptions = structuredClone(init.options);
  const setupWorld: World = structuredClone(init.setupWorld);
  for (const setup of init.setupLog) {
    const known = validateKnownCommand(setupWorld, setup.citizenId, setup.command);
    if (hash(known) !== hash(setup.knownResult) || !known.ok) throw new Error('Setup gate replay mismatch');
    const result = dispatch(setupWorld, setup.citizenId, setup.command, 'external', options);
    updateKnowledge(setupWorld);
    if (hash(result) !== hash(setup.dispatchResult) || hash(setupWorld) !== setup.stateHash) throw new Error('Setup replay mismatch');
  }
  if (hash(setupWorld) !== init.initializedHash) throw new Error('Setup initialized state mismatch');
  const world: World = structuredClone(init.world);
  const report = JSON.parse(readFileSync(join(outputDirectory, 'report.json'), 'utf8')) as EpisodeReport;
  const records = readFileSync(join(outputDirectory, 'trace.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const allowedKinds = new Set(['initialization', 'decision', 'tick', 'candidate-failure', 'termination-failure', 'completion']);
  if (records.length < 2 || records[0].kind !== 'initialization' || records.at(-1).kind !== 'completion'
    || records.filter(r => r.kind === 'initialization').length !== 1 || records.filter(r => r.kind === 'completion').length !== 1
    || records.some(r => !allowedKinds.has(r.kind)) || hash(records.at(-1).report) !== hash(report)) throw new Error('Incomplete or inconsistent replay trace structure');
  let boundaries = 0;
  let opportunities = 0;
  let decisionAvailable = false;
  let terminated = false;
  const requestIds = new Set<string>();
  for (const record of records) {
    if (record.kind === 'termination-failure') terminated = true;
    if (record.kind === 'decision' || record.kind === 'candidate-failure') {
      if (terminated || !record.commit || requestIds.has(record.commit.requestId) || record.commit.tick !== world.tick) throw new Error('Invalid replay decision order');
      requestIds.add(record.commit.requestId); opportunities++; decisionAvailable = record.kind === 'decision';
    }
    if (record.kind === 'tick' && (!decisionAvailable || terminated)) throw new Error('Invalid replay tick order');
    if (record.kind === 'decision') {
      const commit: CommitRecord = record.commit;
      if (commit.decision?.kind === 'command') {
        const known = validateKnownCommand(world, init.actorId, commit.decision.command);
        if (hash(known) !== hash(commit.knownResult)) throw new Error('Known gate replay mismatch');
        if (known.ok) {
          const result = dispatch(world, init.actorId, commit.decision.command, 'external', options);
          if (hash(result) !== hash(commit.dispatchResult)) throw new Error('Dispatcher replay mismatch');
        }
      }
      updateKnowledge(world);
    } else if (record.kind === 'tick') {
      tickWorld(world, 1, options); updateKnowledge(world);
    }
    if (hash(world) !== record.stateHash || totalGold(world) !== world.initialGold) throw new Error(`Replay/accounting mismatch at ${record.kind} tick ${record.tick}`);
    boundaries++;
  }
  const actor = world.citizens[init.actorId];
  const expectedSuccess = report.status === 'complete' && world.tick === init.manifest.horizon && actor.alive
    && actor.health >= init.manifest.objective.minHealth && actor.fullness >= init.manifest.objective.minFullness;
  if (report.success !== expectedSuccess || opportunities !== report.decisions || world.tick !== report.ticks || hash(auditState(world, init.actorId)) !== hash(report.outcome)
    || report.outcome.stateHash !== hash(world) || report.accountingValid !== (totalGold(world) === world.initialGold)
    || (report.status === 'complete' && world.tick < init.manifest.horizon && world.citizens[init.actorId].alive)) throw new Error('Replay final report/boundary reconciliation mismatch');
  return { boundaries, stateHash: hash(world) };
}
