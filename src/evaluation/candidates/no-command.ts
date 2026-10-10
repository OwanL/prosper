import type { CandidateContext, CandidateFeedback, CandidateMetadata, DecisionInput, PrimitiveCandidate } from '../contracts.ts';
import { decodePrimitiveDecision } from './decoder.ts';
import { EpisodeState } from './lifecycle.ts';

/** Body/endowment baseline, not a survival controller. Never issues a Command. */
export class NoCommandCandidate implements PrimitiveCandidate {
  readonly metadata: CandidateMetadata = Object.freeze({
    id: 'no-command', version: '1', inference: 'none', artifact: 'prosper-no-command-v1',
    provenance: 'Hand-authored advance-only baseline; no training or cross-episode memory.',
    execution: 'cooperative-in-process',
  });
  private readonly state = new EpisodeState();
  reset(context: CandidateContext, seed: number, signal: AbortSignal): void { this.state.reset(context, seed, signal); }
  decide(input: DecisionInput, signal: AbortSignal): unknown {
    const turn = this.state.begin(input, signal);
    let bytes = 0;
    try {
      const raw = JSON.stringify({ requestId: input.requestId, kind: 'advance' });
      bytes = Buffer.byteLength(raw);
      return decodePrimitiveDecision(raw, { requestId: input.requestId, maxOutputBytes: turn.context.limits.maxOutputBytes });
    } finally { this.state.finish(turn.start, bytes); }
  }
  feedback(feedback: CandidateFeedback, signal: AbortSignal): void { this.state.feedback(feedback, signal); }
  close(signal: AbortSignal): void { this.state.close(signal); }
  getUsage() { return { ...this.state.getUsage(), modelCalls: 0, tokens: 0 }; }
}
export const createNoCommandCandidate = (): NoCommandCandidate => new NoCommandCandidate();
