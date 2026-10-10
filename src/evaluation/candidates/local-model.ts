import { createHash } from 'node:crypto';
import { CandidateBudgetFailure } from '../contracts.ts';
import type { CandidateContext, CandidateFeedback, CandidateMetadata, CandidateResponseAudit, DecisionInput, PrimitiveCandidate } from '../contracts.ts';
import { decodePrimitiveDecision, PRIMITIVE_DECISION_JSON_SCHEMA } from './decoder.ts';
import { aborted, EpisodeState, positiveInteger, type HistoryLimits } from './lifecycle.ts';
import { isAuditedOllamaTransport } from './ollama-transport.ts';

export const PRIMITIVE_PROMPT = `You control one Prosper citizen by direct primitives. Choose exactly one strict JSON decision matching the supplied schema and current requestId. Use only the public objective, mechanics, citizen observations and committed citizen-visible feedback. Do not infer hidden holdings or refresh dated memories. An advance decision issues no command and allows the declared cadence to pass. There is no eat, wait, policy, plan, query or macro command. Do not restart unfinished work accidentally. Acceptance is not completion. No text, markdown, extra fields, repairs or tool wrappers. No strategies or prerequisites are selected for you.`;
export const PRIMITIVE_PROMPT_SHA256 = createHash('sha256').update(PRIMITIVE_PROMPT).digest('hex');

/** One bounded primitive request. No execution authority or fixture data crosses this API. */
export interface PrimitiveModelRequest {
  endpoint: string;
  model: string;
  requestId: string;
  seed: number;
  messages: readonly { role: 'system' | 'user'; content: string }[];
  format: unknown;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxOutputBytes: number;
  thinking: false;
  stream: false;
}
export interface PrimitiveModelReply {
  text: string;
  /** Transport-reported receipts; missing/invalid usage retains the reservation. */
  usage?: { inputTokens: number; outputTokens: number };
}
export interface PrimitiveModelTransport {
  readonly capability: 'mock' | 'local';
  complete(request: PrimitiveModelRequest, signal: AbortSignal): Promise<PrimitiveModelReply>;
}
export interface LocalModelConfig {
  endpoint: string;
  model: string;
  maxPromptBytes: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  history?: HistoryLimits;
}
export function validateLocalModelConfig(config: LocalModelConfig): void {
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') throw new Error('Local endpoint must be HTTP(S).');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname.toLowerCase()) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new Error('Explicit credential-free loopback endpoint required.');
  if (!config.model || config.model.trim() !== config.model || /cloud|https?:\/\//i.test(config.model))
    throw new Error('Explicit local model ID required; cloud models are unsupported.');
  positiveInteger(config.maxPromptBytes, 'prompt-byte limit');
  positiveInteger(config.maxInputTokens, 'input-token limit');
  positiveInteger(config.maxOutputTokens, 'output-token limit');
  if (!Number.isSafeInteger(config.maxInputTokens + config.maxOutputTokens)) throw new Error('Token reservation exceeds safe integer range.');
}

/** Reject on abort without treating an ignored abort as transport teardown. */
function waitForReply<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('Model decision aborted or timed out.'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

const admittedLocalCandidates = new WeakSet<PrimitiveCandidate>();
export function isAuditedLocalCandidate(candidate: PrimitiveCandidate): boolean {
  return admittedLocalCandidates.has(candidate);
}

/** Mock or audited task-owned local transport. No retry, fallback or prerequisite strategy. */
export class LocalModelCandidate implements PrimitiveCandidate {
  readonly metadata: CandidateMetadata;
  private readonly state: EpisodeState;
  private readonly config: Readonly<LocalModelConfig>;
  private modelCalls = 0;
  private chargedTokens = 0;
  private reservedTokens = 0;
  private reportedInputTokens = 0;
  private reportedOutputTokens = 0;
  private unknownUsageCalls = 0;
  private promptBytes = 0;
  private transportPending = false;
  private episodeAbort = new AbortController();
  private lastResponse: CandidateResponseAudit | null = null;
  constructor(config: LocalModelConfig, private readonly transport: PrimitiveModelTransport) {
    validateLocalModelConfig(config);
    if (transport.capability !== 'mock' && !isAuditedOllamaTransport(transport))
      throw new Error('Unaudited live local transport is unsupported.');
    if (isAuditedOllamaTransport(transport)) admittedLocalCandidates.add(this);
    this.config = Object.freeze(structuredClone(config));
    this.state = new EpisodeState(config.history);
    this.metadata = Object.freeze({
      id: 'local-model-primitive', version: '2', inference: transport.capability === 'mock' ? 'mock' : 'live', execution: 'cooperative-in-process',
      artifact: `primitive-prompt:${PRIMITIVE_PROMPT_SHA256}; config:${createHash('sha256').update(JSON.stringify(this.config)).digest('hex')}${isAuditedOllamaTransport(transport) ? `; transport:${transport.identity}` : ''}`,
      provenance: `Hand-authored primitive prompt; ${transport.capability === 'mock' ? 'injected mock' : 'audited task-owned loopback Ollama'} transport. No training, fixture access, fallback or cross-episode memory. Cooperative lifecycle, not hard CPU/memory containment.`, 
    });
  }
  reset(context: CandidateContext, seed: number, signal: AbortSignal): void {
    if (this.transportPending) throw new Error('Outstanding transport must settle before reuse.');
    this.state.reset(context, seed, signal);
    this.lastResponse = null;
    this.episodeAbort.abort();
    this.episodeAbort = new AbortController();
    this.modelCalls = this.chargedTokens = this.reservedTokens = this.reportedInputTokens = this.reportedOutputTokens = this.unknownUsageCalls = this.promptBytes = 0;
  }
  async decide(input: DecisionInput, signal: AbortSignal): Promise<unknown> {
    this.lastResponse = null;
    const turn = this.state.begin(input, signal);
    let outputBytes = 0;
    let pending: Promise<PrimitiveModelReply> | undefined;
    let reservation = 0;
    try {
      const limits = turn.context.limits;
      const tokenBound = this.config.maxInputTokens + this.config.maxOutputTokens;
      if (this.modelCalls >= limits.maxModelCalls)
        throw new CandidateBudgetFailure('episode', 'Model-call limit exhausted.');
      if (this.chargedTokens + tokenBound > limits.maxTokens)
        throw new CandidateBudgetFailure('episode', 'Token reservation exceeds budget.');
      if (limits.maxModelCallsPerDecision !== undefined && limits.maxModelCallsPerDecision < 1)
        throw new Error('Model-call limit exhausted.');
      if (limits.maxTokensPerDecision !== undefined && tokenBound > limits.maxTokensPerDecision)
        throw new Error('Token reservation exceeds budget.');
      const messages: PrimitiveModelRequest['messages'] = [
        { role: 'system', content: PRIMITIVE_PROMPT + '\n\n' + turn.context.mechanics.text },
        { role: 'user', content: JSON.stringify({
          requestId: input.requestId, objective: turn.context.objective, cadence: turn.context.cadence,
          horizon: turn.context.horizon, remainingTicks: input.remainingTicks, allowedCommands: turn.context.allowedCommands,
          limits, observation: input.observation, history: this.state.historyText().map((entry) => JSON.parse(entry)),
          historyOmissions: this.state.getUsage().droppedHistoryEntries,
        }) },
      ];
      const format = structuredClone(PRIMITIVE_DECISION_JSON_SCHEMA);
      const requestBytes = Buffer.byteLength(JSON.stringify({ messages, format }));
      if (requestBytes > this.config.maxPromptBytes) throw new Error('Prompt-byte limit exceeded; observation not silently truncated.');
      this.promptBytes += requestBytes;
      // Reserve before invoking. Missing/invalid/late receipts retain the full
      // configured input+output bound. Transport must enforce those caps; this
      // cooperative protocol alone does not establish real process containment.
      this.modelCalls++;
      this.chargedTokens += tokenBound;
      this.reservedTokens += tokenBound;
      this.unknownUsageCalls++;
      reservation = tokenBound;
      const operationSignal = AbortSignal.any([signal, this.episodeAbort.signal, AbortSignal.timeout(limits.decisionTimeoutMs)]);
      aborted(operationSignal);
      this.transportPending = true;
      pending = Promise.resolve().then(() => {
        aborted(operationSignal);
        return this.transport.complete({
          endpoint: this.config.endpoint, model: this.config.model, requestId: input.requestId, seed: this.state.seed,
          messages, format, maxInputTokens: this.config.maxInputTokens, maxOutputTokens: this.config.maxOutputTokens,
          maxOutputBytes: limits.maxOutputBytes, thinking: false, stream: false,
        }, operationSignal);
      }).then((reply) => { this.transportPending = false; return reply; }, (error: unknown) => { this.transportPending = false; throw error; });
      const reply = await waitForReply(pending, operationSignal);
      this.state.check(turn.generation, operationSignal);
      if (typeof reply?.text !== 'string') throw new Error('Model reply must contain text.');
      outputBytes = Buffer.byteLength(reply.text);
      // Capture before receipt/schema rejection. An oversized response retains
      // only its byte count and digest, never an unbounded output string.
      this.lastResponse = {
        requestId: input.requestId, bytes: outputBytes,
        sha256: createHash('sha256').update(reply.text, 'utf8').digest('hex'),
        ...(outputBytes <= limits.maxOutputBytes ? { text: reply.text } : {}),
      };
      if (reply.usage !== undefined) {
        const { inputTokens, outputTokens } = reply.usage;
        if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || inputTokens > this.config.maxInputTokens ||
            !Number.isSafeInteger(outputTokens) || outputTokens < 0 || outputTokens > this.config.maxOutputTokens)
          throw new Error('Invalid or over-bound token receipt.');
        this.chargedTokens -= reservation - inputTokens - outputTokens;
        this.reportedInputTokens += inputTokens;
        this.reportedOutputTokens += outputTokens;
        this.unknownUsageCalls--;
      }
      return decodePrimitiveDecision(reply.text, {
        requestId: input.requestId, maxOutputBytes: limits.maxOutputBytes, allowedCommands: turn.context.allowedCommands,
      });
    } finally {
      if (pending && this.transportPending) {
        // An ignored abort returns promptly, but reuse remains blocked until the
        // original operation settles. Late output never becomes a decision.
        void pending.then(() => undefined, () => undefined).then(() => {
          this.transportPending = false;
          this.state.finish(turn.start, outputBytes);
        });
      } else this.state.finish(turn.start, outputBytes);
    }
  }
  feedback(feedback: CandidateFeedback, signal: AbortSignal): void { this.state.feedback(feedback, signal); }
  async close(signal: AbortSignal): Promise<void> {
    this.lastResponse = null;
    this.episodeAbort.abort();
    this.state.close(signal);
    if (isAuditedOllamaTransport(this.transport)) await this.transport.close();
  }
  getLastResponse(): CandidateResponseAudit | null { return this.lastResponse ? { ...this.lastResponse } : null; }
  getUsage() {
    return { ...this.state.getUsage(), modelCalls: this.modelCalls, tokens: this.chargedTokens,
      transportKind: this.transport.capability, reservedTokens: this.reservedTokens,
      reportedInputTokens: this.reportedInputTokens, reportedOutputTokens: this.reportedOutputTokens,
      unknownUsageCalls: this.unknownUsageCalls, promptBytes: this.promptBytes,
      pendingOperations: this.transportPending ? 1 : 0, transportPending: this.transportPending };
  }
}
export const createLocalModelCandidate = (config: LocalModelConfig, transport: PrimitiveModelTransport): LocalModelCandidate =>
  new LocalModelCandidate(config, transport);
