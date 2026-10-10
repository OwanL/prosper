import type { CitizenObservation, Command, CommandResult } from '../shared/types.ts';

/** Runner-local API v1. No World, manifest, evaluator or engine handle crosses this API. */
export type PrimitiveDecision =
  | { requestId: string; kind: 'command'; command: Command }
  | { requestId: string; kind: 'advance' };
export interface CandidateLimits {
  decisionTimeoutMs: number;
  episodeTimeoutMs: number;
  teardownTimeoutMs: number;
  maxDecisions: number;
  maxOutputBytes: number;
  /** Episode ceilings. Offline defaults are zero; admission gates execution capability. */
  maxModelCalls: number;
  maxTokens: number;
  maxModelCallsPerDecision?: number;
  maxTokensPerDecision?: number;
}
export interface PublicObjective {
  description: string;
  minHealth: number;
  minFullness: number;
}
export interface MechanicsContext {
  version: string;
  text: string;
  sha256: string;
}
export interface CandidateContext {
  apiVersion: 1;
  mechanics: MechanicsContext;
  objective: PublicObjective;
  cadence: number;
  horizon: number;
  limits: CandidateLimits;
  /** Present only when publicly restricting the command surface. */
  allowedCommands?: Command['type'][];
}
export interface DecisionInput {
  requestId: string;
  observation: CitizenObservation;
  remainingTicks: number;
}
export interface CommitRecord {
  requestId: string;
  tick: number;
  decision: PrimitiveDecision | null;
  knownResult?: CommandResult;
  dispatchResult?: CommandResult;
  failure?: string;
}
export interface CandidateFeedback {
  commit: CommitRecord;
  immediateObservation: CitizenObservation;
  /** Exactly the citizen projections after each subsequent single committed tick. */
  observations: CitizenObservation[];
}
export interface CandidateMetadata {
  id: string;
  version: string;
  artifact: string;
  provenance: string;
  /** Audited cooperative code only, including a separately owned local service. Not a sandbox. */
  execution: 'cooperative-in-process';
  inference?: 'none' | 'mock' | 'live';
}
export interface CandidateUsage {
  /** Cumulative across this episode, including failed/uncertain attempts. */
  modelCalls: number;
  /** Null means unknown, never zero. Mock accounting must supply a conservative bound. */
  tokens: number | null;
  /** Outstanding underlying operations after a hook returns make cancellation unsafe. */
  pendingOperations?: number;
}
export interface CandidateResponseAudit {
  requestId: string;
  bytes: number;
  sha256: string;
  /** Raw provider/mock text only when within the output-byte bound; never feedback. */
  text?: string;
}
export interface PrimitiveCandidate {
  readonly metadata: CandidateMetadata;
  reset(context: CandidateContext, candidateSeed: number, signal: AbortSignal): void | Promise<void>;
  /** Unknown return is deliberate: the runner independently performs strict decoding. */
  decide(input: DecisionInput, signal: AbortSignal): unknown | Promise<unknown>;
  feedback(feedback: CandidateFeedback, signal: AbortSignal): void | Promise<void>;
  close(signal: AbortSignal): void | Promise<void>;
  /** Required for inference admission, including conservative uncertain-operation accounting. */
  getUsage?(): CandidateUsage;
  /** Audit only; current settled response before decode, no stale/late response. */
  getLastResponse?(): CandidateResponseAudit | null;
}
/** A candidate cannot fund its next operation. Episode exhaustion must stop before cadence. */
export class CandidateBudgetFailure extends Error {
  constructor(readonly scope: 'episode' | 'decision', message: string) {
    super(message);
    this.name = 'CandidateBudgetFailure';
  }
}
/** Factory per episode: no learned state or scratch shared between episodes. */
export type CandidateFactory = () => PrimitiveCandidate;
