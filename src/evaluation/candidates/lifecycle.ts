import { createHash } from 'node:crypto';
import type { CandidateContext, CandidateFeedback, DecisionInput } from '../contracts.ts';

export interface HistoryLimits { maxEntries: number; maxBytes: number }
export interface CandidateUsage {
  decisions: number;
  outputBytes: number;
  candidateWallMs: number;
  historyBytes: number;
  historyEntries: number;
  droppedHistoryEntries: number;
}
export const DEFAULT_HISTORY_LIMITS: Readonly<HistoryLimits> = Object.freeze({ maxEntries: 4, maxBytes: 32_000 });
export function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}.`);
}
export function aborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Candidate operation aborted.');
}

/** Episode-only scratch. No state is learned or shared between candidate instances. */
export class EpisodeState {
  context?: CandidateContext;
  seed = 0;
  generation = 0;
  active = false;
  private readonly history: string[] = [];
  private readonly requests = new Set<string>();
  private usage: CandidateUsage = this.emptyUsage();
  constructor(readonly historyLimits: Readonly<HistoryLimits> = DEFAULT_HISTORY_LIMITS) {
    positiveInteger(historyLimits.maxEntries, 'history-entry limit');
    positiveInteger(historyLimits.maxBytes, 'history-byte limit');
    this.historyLimits = Object.freeze({ ...historyLimits });
  }
  private emptyUsage(): CandidateUsage {
    return { decisions: 0, outputBytes: 0, candidateWallMs: 0, historyBytes: 0, historyEntries: 0, droppedHistoryEntries: 0 };
  }
  reset(context: CandidateContext, seed: number, signal: AbortSignal): void {
    aborted(signal);
    if (this.active) throw new Error('Outstanding transport must settle before reset.');
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Candidate seed must be a uint32.');
    if (context.apiVersion !== 1) throw new Error('Unsupported candidate API.');
    for (const [name, value] of Object.entries(context.limits)) {
      if (name === 'maxModelCalls' || name === 'maxTokens' || name === 'maxModelCallsPerDecision' || name === 'maxTokensPerDecision') {
        if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name}.`);
      } else positiveInteger(value, name);
    }
    positiveInteger(context.cadence, 'cadence');
    positiveInteger(context.horizon, 'horizon');
    if (createHash('sha256').update(context.mechanics.text).digest('hex') !== context.mechanics.sha256)
      throw new Error('Public mechanics hash mismatch.');
    this.context = structuredClone(context);
    this.seed = seed;
    this.generation++;
    this.history.length = 0;
    this.requests.clear();
    this.usage = this.emptyUsage();
  }
  begin(input: DecisionInput, signal: AbortSignal): { context: CandidateContext; generation: number; start: number } {
    aborted(signal);
    if (!this.context) throw new Error('Candidate must be reset before deciding.');
    if (this.active) throw new Error('Only one decision may be outstanding.');
    if (!input.requestId || input.requestId.length > 200 || this.requests.has(input.requestId)) throw new Error('Invalid or reused requestId.');
    if (!Number.isSafeInteger(input.remainingTicks) || input.remainingTicks < 0 || input.remainingTicks > this.context.horizon)
      throw new Error('Invalid remaining horizon.');
    if (this.usage.decisions >= this.context.limits.maxDecisions) throw new Error('Decision limit exhausted.');
    this.requests.add(input.requestId);
    this.usage.decisions++;
    this.active = true;
    return { context: structuredClone(this.context), generation: this.generation, start: performance.now() };
  }
  check(generation: number, signal: AbortSignal): void {
    aborted(signal);
    if (!this.context || generation !== this.generation) throw new Error('Stale candidate decision.');
  }
  finish(start: number, outputBytes = 0): void {
    this.active = false;
    this.usage.candidateWallMs += performance.now() - start;
    this.usage.outputBytes += outputBytes;
  }
  feedback(feedback: CandidateFeedback, signal: AbortSignal): void {
    aborted(signal);
    if (!this.context || this.active) throw new Error('Feedback requires an idle initialized candidate.');
    if (!this.requests.has(feedback.commit.requestId)) throw new Error('Feedback request was not issued by this episode.');
    const entry = JSON.stringify(feedback);
    const bytes = Buffer.byteLength(entry);
    if (bytes > this.historyLimits.maxBytes) { this.usage.droppedHistoryEntries++; return; }
    while (this.history.length >= this.historyLimits.maxEntries || this.usage.historyBytes + bytes > this.historyLimits.maxBytes) {
      this.usage.historyBytes -= Buffer.byteLength(this.history.shift()!);
      this.usage.droppedHistoryEntries++;
    }
    this.history.push(entry);
    this.usage.historyBytes += bytes;
    this.usage.historyEntries = this.history.length;
  }
  historyText(): readonly string[] { return [...this.history]; }
  getUsage(): CandidateUsage { return { ...this.usage }; }
  close(signal: AbortSignal): void {
    // Invalidate even if teardown's signal is already aborted.
    this.context = undefined;
    this.generation++;
    this.history.length = 0;
    this.requests.clear();
    this.usage.historyBytes = 0;
    this.usage.historyEntries = 0;
    aborted(signal);
  }
}
