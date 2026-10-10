import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { CandidateFeedback, DecisionInput } from './contracts.ts';
import type { PrimitiveModelRequest } from './candidates/local-model.ts';

export const CPU_TOKENIZER = Object.freeze({
  build: 'b11490', commit: '9c2e0e491a822adae1f0b1c831adb4160057d24f',
  archive: 'llama-b11490-bin-win-cpu-x64.zip', bytes: 19_482_170,
  sha256: 'ed69a9e87713b84c63940b2f0e708c8e698e82b3d74dfa1364e94d97e334720c',
  url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11490/llama-b11490-bin-win-cpu-x64.zip',
});
export const QWEN_INSTALLED = Object.freeze({
  manifestSha256: '6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7',
  configSha256: 'be595b49fe22012bd1f5605ec14c7ffa58331783a88a4fd8c22e5fc8ec42cf9f',
  ggufSha256: 'dec52a44569a2a25341c4e4d3fee25846eed4f6f0b936278e3a3c900bb99d37c',
  ggufBytes: 6_594_462_816,
});
const GiB = 1024 ** 3;
/** Sizing-only planning ceilings, NOT a change to inference admission. Vocabulary
 * peak is unmeasured: allow 768 MiB for the child, retain 512 MiB free, and admit
 * only with 2 GiB free for Node, sampler, extraction and transient headroom. */
export const SIZING_LIMITS = Object.freeze({
  minimumFreeBytes: 2 * GiB, stopFreeBytes: GiB / 2,
  maximumProcessBytes: 768 * 1024 ** 2, timeoutMs: 30_000, sampleIntervalMs: 250,
});
export const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');
export const jsonSha256 = (value: unknown): string => sha256(JSON.stringify(value));
/** Mock-clock seam for the sampler watchdog. Startup grace is bounded too. */
export function sizingHeartbeatExpired(startedAt: number, lastSampleAt: number | undefined, now: number): boolean {
  return now - (lastSampleAt ?? startedAt) > (lastSampleAt === undefined ? 5000 : 1500);
}
export interface ResourceSample {
  freeBytes: number;
  workingSetBytes?: number;
  privateBytes?: number;
  peakWorkingSetBytes?: number;
}
export function sizingStopReason(sample: ResourceSample, initial = false): string | undefined {
  if (!Number.isSafeInteger(sample.freeBytes) || sample.freeBytes < 0) return 'Invalid free physical RAM sample';
  if (sample.freeBytes < (initial ? SIZING_LIMITS.minimumFreeBytes : SIZING_LIMITS.stopFreeBytes))
    return initial ? 'Sizing preflight requires at least 2 GiB free physical RAM' : 'Free physical RAM fell below 512 MiB';
  for (const key of ['workingSetBytes', 'privateBytes', 'peakWorkingSetBytes'] as const) {
    const value = sample[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) return `Invalid ${key} sample`;
    if (value !== undefined && value > SIZING_LIMITS.maximumProcessBytes) return `Tokenizer ${key} exceeded 768 MiB`;
  }
  return undefined;
}

// Go strings.TrimSpace uses Unicode White_Space (includes U+0085, excludes FEFF).
const GO_SPACE = /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;
export const goTrimSpace = (text: string): string => text.replace(GO_SPACE, '');
/** Restricted port of Ollama v0.35.1 model/renderers/qwen35.go, no tools/images.
 * The installed config must select qwen3.5 with no embedded messages/system.
 * This returns an EXACT ported byte string, not a verified Ollama token count. */
export function renderQwen35NoThink(messages: PrimitiveModelRequest['messages']): string {
  if (messages.length !== 2 || messages[0].role !== 'system' || messages[1].role !== 'user' ||
      messages.some(m => typeof m.content !== 'string')) throw new Error('Only the actual two-message primitive shape is supported');
  const system = goTrimSpace(messages[0].content);
  const user = goTrimSpace(messages[1].content);
  // No tools and no native assistant transcript. History remains INSIDE user JSON.
  return `<|im_start|>system\n${system}<|im_end|>\n` +
    `<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
}
export function tokenizerArgs(gguf: string, prompt: string): string[] {
  // b11490 tokenize-tool setup overrides common's parse_special=false to true;
  // --no-parse-special is deliberately absent.
  // --file re-reads binary bytes verbatim, unlike common's normal prompt handling.
  return ['--model', gguf, '--file', prompt, '--no-escape', '--no-bos', '--ids'];
}
export function parseTokenIds(stdout: string, stderr: string): number[] {
  if (!stderr.includes('vocab only - skipping tensors')) throw new Error('Missing vocabulary-only runtime proof');
  if (/load_tensors:|offloading|KV buffer|compute buffer|llama_decode/i.test(stderr))
    throw new Error('Unexpected tensor/context initialization');
  const ids: unknown = JSON.parse(stdout.trim());
  if (!Array.isArray(ids) || ids.some(id => !Number.isSafeInteger(id) || id < 0)) throw new Error('Invalid token ID output');
  return ids as number[];
}

export interface CapturedPrimitiveRequests {
  lane: 'default-history' | 'development-small-history';
  requests: PrimitiveModelRequest[];
  inputs: DecisionInput[];
  feedback: CandidateFeedback[];
}
/** Fresh public development callback path only. No snapshots, trajectories,
 * held-out fixtures, model service, or candidate-selected prerequisite strategy. */
export async function capturePrimitiveRequests(smallHistory = false): Promise<CapturedPrimitiveRequests> {
  // Lazy imports keep sizing preflight independent of the world/evaluation graph.
  const [{ createLocalModelCandidate }, { developmentFixture }, { runEpisode }] = await Promise.all([
    import('./candidates/local-model.ts'), import('./fixtures.ts'), import('./runner.ts'),
  ]);
  const requests: PrimitiveModelRequest[] = [];
  const inputs: DecisionInput[] = [];
  const feedback: CandidateFeedback[] = [];
  const candidate = createLocalModelCandidate({
    endpoint: 'http://127.0.0.1:11434', model: 'mock-only-local',
    maxPromptBytes: 500_000, maxInputTokens: 60_000, maxOutputTokens: 256,
    ...(smallHistory ? { history: { maxEntries: 1, maxBytes: 1024 } } : {}),
  }, {
    capability: 'mock',
    async complete(request) {
      requests.push(structuredClone(request));
      // Mock accounting is never reported as measured tokens.
      return { text: JSON.stringify({ requestId: request.requestId, kind: 'advance' }),
        usage: { inputTokens: 100, outputTokens: 10 } };
    },
  });
  const decide = candidate.decide.bind(candidate);
  const committed = candidate.feedback.bind(candidate);
  candidate.decide = (input, signal) => { inputs.push(structuredClone(input)); return decide(input, signal); };
  candidate.feedback = (entry, signal) => { feedback.push(structuredClone(entry)); committed(entry, signal); };
  const report = await runEpisode(developmentFixture('sell-buy-meal', 7, 2), () => candidate, {
    candidateSeed: 1, limits: { maxModelCalls: 2, maxTokens: 120_512 },
  });
  try {
    if (report.status !== 'complete' || report.failures !== 0 || requests.length !== 2 || inputs.length !== 2 || feedback.length !== 2)
      throw new Error('Public request capture failed');
    for (let i = 0; i < 2; i++) {
      const payload = JSON.parse(requests[i].messages[1].content);
      if (JSON.stringify(payload.observation) !== JSON.stringify(inputs[i].observation)) throw new Error('Observation changed at capture boundary');
      const expectedHistory = i === 0 || smallHistory ? [] : [feedback[0]];
      if (JSON.stringify(payload.history) !== JSON.stringify(expectedHistory) || payload.historyOmissions !== (i === 1 && smallHistory ? 1 : 0))
        throw new Error('History changed at capture boundary');
    }
    return { lane: smallHistory ? 'development-small-history' : 'default-history', requests, inputs, feedback };
  } finally { rmSync(report.outputDirectory, { recursive: true, force: true }); }
}

export function requestEvidence(request: PrimitiveModelRequest) {
  const payload = JSON.parse(request.messages[1].content);
  const rendered = renderQwen35NoThink(request.messages);
  return {
    requestId: request.requestId, messagesSha256: jsonSha256(request.messages),
    systemSha256: sha256(request.messages[0].content), userSha256: sha256(request.messages[1].content),
    observationSha256: jsonSha256(payload.observation), historySha256: jsonSha256(payload.history),
    historyEntries: payload.history.length, historyOmissions: payload.historyOmissions,
    formatSha256: jsonSha256(request.format), envelopeSha256: jsonSha256({ messages: request.messages, format: request.format }),
    envelopeBytes: Buffer.byteLength(JSON.stringify({ messages: request.messages, format: request.format })),
    renderedBytes: Buffer.byteLength(rendered), renderedSha256: sha256(rendered),
    outputCeiling: request.maxOutputTokens,
  };
}
