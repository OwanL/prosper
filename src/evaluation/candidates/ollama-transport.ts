import { createHash } from 'node:crypto';
import type { PrimitiveModelReply, PrimitiveModelRequest, PrimitiveModelTransport } from './local-model.ts';
import { GRANITE_MODEL, GRANITE_TEMPLATE, isVerifiedGraniteMetadata, type GraniteMetadata } from '../small-model.ts';
import { QWEN4B_MODEL, QWEN4B_TEMPLATE, isVerifiedQwen4bMetadata, type Qwen4bMetadata } from '../qwen4b.ts';
import { GRANITE_RUN_ENVELOPE, QWEN4B_RUN_ENVELOPE, type LocalRunEnvelope } from '../local-service.ts';

/** Cooperative ownership contract, not a sandbox. The caller must own this service
 * exclusively, never point at a shared production service, and stop its process
 * tree. stop() may fulfill ONLY after that tree is known to have stopped. */
export interface TaskOwnedOllamaController {
  readonly endpoint: string;
  stop(): Promise<void>;
  requireAdmission?(): Promise<void>;
  readonly modelsPath?: string;
  readonly envelope?: LocalRunEnvelope;
}
export interface OllamaTransportConfig {
  endpoint: string;
  model: 'qwen3.5:9b' | typeof GRANITE_MODEL | typeof QWEN4B_MODEL;
  /** Required for the ONE pinned challenger, never caller-asserted metadata. */
  granite?: GraniteMetadata;
  qwen4b?: Qwen4bMetadata;
  digest: string;
  size: number;
  contextTokens: number;
}

const admitted = new WeakSet<object>();
const PREFLIGHT_BYTES = 1024 * 1024;
const MAX_CONTEXT = 65536;
const neverSettles = (): Promise<never> => new Promise(() => {});

function positive(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}.`);
}
function endpointRoot(value: string): string {
  if (!/^http:\/\/127\.0\.0\.1(?::[0-9]+)?\/?$/.test(value))
    throw new Error('Only credential-free HTTP 127.0.0.1 root endpoints are supported.');
  return new URL(value).origin;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Ollama envelope.');
  return value as Record<string, unknown>;
}
function rejectRemote(value: unknown): void {
  if (Array.isArray(value)) { for (const entry of value) rejectRemote(entry); return; }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (/remote|cloud/i.test(key)) throw new Error('Remote model metadata is unsupported.');
      rejectRemote(entry);
    }
  }
}
function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Ollama operation aborted.');
}
/** Race abort even if a cooperative injected HTTP implementation ignores it. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Ollama operation aborted.'));
    if (signal.aborted) { void work.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Real local HTTP with no download, redirect, retry, fallback or streaming.
 * Failed HTTP cancellation never establishes inference termination: failures
 * remain pending until the task-owned process stop has successfully settled. */
export class OllamaTransport implements PrimitiveModelTransport {
  readonly capability = 'local' as const;
  readonly identity: string;
  readonly #config: Readonly<OllamaTransportConfig>;
  readonly #controller: TaskOwnedOllamaController;
  readonly #fetch: typeof fetch;
  #pending = false;
  #stopped = false;
  #stopPromise: Promise<void> | undefined;
  #activeAbort: AbortController | undefined;
  #replyAudits: { bytes: number; sha256: string; text?: string }[] = [];

  constructor(config: OllamaTransportConfig, controller: TaskOwnedOllamaController, fetchImpl: typeof fetch = fetch) {
    const endpoint = endpointRoot(config.endpoint);
    if (!controller || typeof controller.stop !== 'function' || endpointRoot(controller.endpoint) !== endpoint)
      throw new Error('Matching task-owned Ollama lifecycle controller required.');
    const granite = config.model === GRANITE_MODEL;
    const qwen4b = config.model === QWEN4B_MODEL;
    if (config.model !== 'qwen3.5:9b' && !granite && !qwen4b) throw new Error('Only exact local Qwen or pinned challengers are audited.');
    if (qwen4b && (!isVerifiedQwen4bMetadata(config.qwen4b) || typeof controller.requireAdmission !== 'function' ||
        controller.envelope !== QWEN4B_RUN_ENVELOPE || controller.modelsPath !== config.qwen4b.modelsPath ||
        config.digest !== config.qwen4b.digest || config.size !== config.qwen4b.size))
      throw new Error('Exact verified Qwen4B metadata, store and admission required.');
    if (!qwen4b && config.qwen4b !== undefined) throw new Error('Qwen4B metadata cannot authorize another model.');
    if (granite && (!isVerifiedGraniteMetadata(config.granite) || typeof controller.requireAdmission !== 'function' ||
        controller.envelope !== GRANITE_RUN_ENVELOPE || !controller.modelsPath))
      throw new Error('Verified artifact metadata and fresh task-owned Granite admission required.');
    if (!granite && config.granite !== undefined) throw new Error('Granite metadata cannot authorize Qwen.');
    if (!/^[a-f0-9]{64}$/.test(config.digest)) throw new Error('Exact installed SHA256 digest required.');
    positive(config.size, 'installed size');
    positive(config.contextTokens, 'context size');
    if (granite ? config.contextTokens !== 131072 : qwen4b ? config.contextTokens !== 98304 : config.contextTokens > MAX_CONTEXT) throw new Error('Context exceeds audited model envelope.');
    this.#config = Object.freeze({ endpoint, model: config.model, digest: config.digest, size: config.size, contextTokens: config.contextTokens,
      ...(granite ? { granite: config.granite } : {}), ...(qwen4b ? { qwen4b: config.qwen4b } : {}) });
    this.#controller = controller;
    this.#fetch = fetchImpl;
    this.identity = createHash('sha256').update(JSON.stringify({ protocol: 'task-owned-ollama-v1', ...this.#config,
      ...(granite || qwen4b ? { privateModelStore: controller.modelsPath } : {}) })).digest('hex');
    admitted.add(this);
    Object.freeze(this);
  }

  /** Public immutable admission facts, not proof that HTTP has already run. */
  get config(): Readonly<OllamaTransportConfig> { return this.#config; }
  get pending(): boolean { return this.#pending; }
  /** Public generated content only, even if receipt validation subsequently fails. */
  getReplyAudits(): readonly { bytes: number; sha256: string; text?: string }[] { return this.#replyAudits.map(entry => ({ ...entry })); }

  #stopOwned(): Promise<void> {
    this.#stopped = true;
    this.#stopPromise ??= Promise.resolve().then(() => this.#controller.stop()).catch(() => neverSettles());
    return this.#stopPromise;
  }

  /** Irrevocable teardown; aborting HTTP is only a request to cancel, not proof.
   * Share the same successful process-stop settlement with any failing call. */
  async close(): Promise<void> {
    this.#stopped = true;
    this.#pending = true;
    this.#activeAbort?.abort();
    await this.#stopOwned();
    this.#pending = false;
  }

  async complete(request: PrimitiveModelRequest, signal: AbortSignal): Promise<PrimitiveModelReply> {
    if (this.#pending || this.#stopped) throw new Error('Owned transport is pending or stopped; reuse forbidden.');
    checkAbort(signal);
    if (endpointRoot(request.endpoint) !== this.#config.endpoint || request.model !== this.#config.model)
      throw new Error('Request must match the pinned endpoint and model.');
    for (const [name, value] of Object.entries({ input: request.maxInputTokens, output: request.maxOutputTokens, bytes: request.maxOutputBytes })) positive(value, name);
    if (request.maxOutputBytes > PREFLIGHT_BYTES) throw new Error('Output-byte cap exceeds audited ceiling.');
    if (!Number.isSafeInteger(request.seed) || request.thinking !== false || request.stream !== false)
      throw new Error('Explicit seed, disabled thinking and nonstream request required.');
    if (!Array.isArray(request.messages) || !request.messages.length || request.messages.length > 64 ||
        request.messages.some((message) => !['system', 'user'].includes(message.role) || typeof message.content !== 'string'))
      throw new Error('Invalid bounded message list.');
    if (request.maxInputTokens + request.maxOutputTokens > this.#config.contextTokens)
      throw new Error('Context must cover the full input plus output reservation.');
    if (this.#config.granite && (request.maxInputTokens !== 120000 || request.maxOutputTokens !== 256 ||
        request.messages.length !== 2 || request.messages[0]?.role !== 'system' || request.messages[1]?.role !== 'user'))
      throw new Error('Granite requires the complete two-message primitive adapter and fixed reservations.');
    if (this.#config.qwen4b && (request.maxInputTokens !== 90000 || request.maxOutputTokens !== 256 ||
        request.messages.length !== 2 || request.messages[0]?.role !== 'system' || request.messages[1]?.role !== 'user'))
      throw new Error('Qwen4B requires the full two-message adapter and fixed reservations.');
    // No bytes/token averaging. GPT2's byte-based tokenizer is verified below.
    // Include schema and literal template bytes plus a deliberately generous
    // fixed 1024-token formatting/header allowance for EACH message and 4096
    // global tokens. Prompts never get truncated to fit these reservations.
    const promptBytes = Buffer.byteLength(JSON.stringify({ messages: request.messages, format: request.format }), 'utf8');
    const headerBound = 4096 + 1024 * request.messages.length;
    if (promptBytes + headerBound > request.maxInputTokens)
      throw new Error('Conservative UTF8 input bound exceeds reservation; no truncation.');

    const operationAbort = new AbortController();
    this.#activeAbort = operationAbort;
    const operationSignal = AbortSignal.any([signal, operationAbort.signal]);
    let begun = false;
    this.#pending = true;
    try {
      const work = async (): Promise<PrimitiveModelReply> => {
        const json = async (path: string, body: unknown | undefined, limit: number): Promise<Record<string, unknown>> => {
          checkAbort(operationSignal);
          begun = true;
          const response = await this.#fetch(this.#config.endpoint + path, {
            method: body === undefined ? 'GET' : 'POST', redirect: 'error', credentials: 'omit',
            headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body), signal: operationSignal,
          });
          checkAbort(operationSignal);
          if (!response.ok || response.redirected) throw new Error('Ollama HTTP failure or redirect.');
          const length = response.headers.get('content-length');
          if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw new Error('Ollama envelope exceeds byte ceiling.');
          if (!response.body) throw new Error('Missing Ollama body.');
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let bytes = 0;
          try {
            for (;;) {
              checkAbort(operationSignal);
              const chunk = await reader.read();
              if (chunk.done) break;
              bytes += chunk.value.byteLength;
              if (bytes > limit) throw new Error('Ollama envelope exceeds byte ceiling.');
              chunks.push(chunk.value);
            }
          } finally {
            void reader.cancel().catch(() => {});
            reader.releaseLock();
          }
          checkAbort(operationSignal);
          return record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes))));
        };
        if (this.#config.granite || this.#config.qwen4b) { await this.#controller.requireAdmission!(); checkAbort(operationSignal); }
        if (this.#config.qwen4b) {
          const version = await json('/api/version', undefined, PREFLIGHT_BYTES);
          if (version.version !== '0.40.1') throw new Error('Qwen4B trial requires the pinned native renderer Ollama 0.40.1.');
        }
        const show = await json('/api/show', { model: this.#config.model }, PREFLIGHT_BYTES);
        rejectRemote(show);
        if (record(show.details).format !== 'gguf' || record(show.model_info)['tokenizer.ggml.model'] !== 'gpt2')
          throw new Error('Installed GGUF with byte-based GPT2 tokenizer metadata required.');
        if (typeof show.template !== 'string' || !show.template ||
            promptBytes + headerBound + Buffer.byteLength(show.template, 'utf8') > request.maxInputTokens)
          throw new Error('Verified template exceeds conservative input bound.');
        if (this.#config.granite) {
          const info = record(show.model_info); const details = record(show.details);
          if (show.template !== GRANITE_TEMPLATE || (show.system !== undefined && show.system !== '') ||
              (show.messages !== undefined && (!Array.isArray(show.messages) || show.messages.length !== 0)) ||
              details.family !== 'granitehybrid' || details.quantization_level !== 'Q8_0' ||
              Object.entries(this.#config.granite.modelInfo).some(([key, value]) => info[key] !== value))
            throw new Error('Pinned Granite family, tokenizer, template or system metadata mismatch.');
          if (typeof show.parameters !== 'string') throw new Error('Granite import parameters missing.');
          const parameters = show.parameters.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
          if (parameters.length !== 2 || !parameters.some(line => /^num_ctx\s+131072$/.test(line)) ||
              !parameters.some(line => /^stop\s+"<\|end_of_text\|>"$/.test(line)))
            throw new Error('Unsupported Granite parameters or stop template.');
        }
        if (this.#config.qwen4b) {
          const info = record(show.model_info); const details = record(show.details);
          if (show.template !== QWEN4B_TEMPLATE || (show.system !== undefined && show.system !== '') ||
              (show.messages !== undefined && (!Array.isArray(show.messages) || show.messages.length !== 0)) ||
              details.family !== 'qwen35' || details.quantization_level !== 'Q4_K_M' ||
              Object.entries(this.#config.qwen4b.modelInfo).some(([key, value]) => {
                const actual = info[key];
                // Ollama JSON rounds this known GGUF float32 scalar; compare its
                // exact stored representation, without relaxing any other key.
                return key === 'qwen35.attention.layer_norm_rms_epsilon'
                  ? typeof actual !== 'number' || !Number.isFinite(actual) || Math.fround(actual) !== value
                  : actual !== value;
              }))
            throw new Error('Pinned native Qwen renderer metadata mismatch.');
          if (typeof show.parameters !== 'string') throw new Error('Native Qwen parameters missing.');
          const lines = show.parameters.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
          const expected = [/^presence_penalty\s+1\.5$/, /^temperature\s+1$/, /^top_k\s+20$/, /^top_p\s+0\.95$/];
          if (lines.length !== expected.length || expected.some(pattern => !lines.some(line => pattern.test(line))))
            throw new Error('Unsupported native Qwen parameters.');
        }
        const tags = await json('/api/tags', undefined, PREFLIGHT_BYTES);
        if (!Array.isArray(tags.models)) throw new Error('Missing installed model tags.');
        const matches = tags.models.map(record).filter((entry) => entry.name === this.#config.model);
        if (matches.length !== 1) throw new Error('Exact installed model tag required.');
        const installed = matches[0]!;
        rejectRemote(installed);
        if (installed.digest !== this.#config.digest || installed.size !== this.#config.size ||
            (installed.model !== undefined && installed.model !== this.#config.model) || record(installed.details).format !== 'gguf')
          throw new Error('Installed model digest, size or GGUF identity mismatch.');
        if (this.#config.granite) {
          if (record(installed.details).family !== 'granitehybrid' || record(installed.details).quantization_level !== 'Q8_0')
            throw new Error('Granite installed family/quantization mismatch.');
          await this.#controller.requireAdmission!(); checkAbort(operationSignal);
        }
        if (this.#config.qwen4b) {
          if (record(installed.details).family !== 'qwen35' || record(installed.details).quantization_level !== 'Q4_K_M')
            throw new Error('Qwen4B installed identity mismatch.');
          await this.#controller.requireAdmission!(); checkAbort(operationSignal);
        }
        const reply = await json('/api/chat', {
          model: this.#config.model, messages: request.messages, format: request.format,
          think: false, stream: false, keep_alive: 0,
          ...(this.#config.granite || this.#config.qwen4b ? { truncate: false } : {}),
          options: { temperature: 0, seed: request.seed, num_ctx: this.#config.contextTokens, num_predict: request.maxOutputTokens },
        }, 65536 + 6 * request.maxOutputBytes);
        if (reply.done !== true || reply.model !== this.#config.model) throw new Error('Incomplete or mismatched Ollama generation.');
        const message = record(reply.message);
        if ((this.#config.granite || this.#config.qwen4b) && typeof message.content === 'string') {
          const bytes = Buffer.byteLength(message.content, 'utf8');
          this.#replyAudits.push({ bytes, sha256: createHash('sha256').update(message.content).digest('hex'),
            ...(bytes <= request.maxOutputBytes ? { text: message.content } : {}) });
          if (this.#replyAudits.length > 3) this.#replyAudits.shift();
        }
        if (message.role !== 'assistant' || typeof message.content !== 'string' ||
            (message.thinking !== undefined && message.thinking !== '') || Buffer.byteLength(message.content, 'utf8') > request.maxOutputBytes)
          throw new Error('Invalid or over-bound Ollama output.');
        const inputTokens = reply.prompt_eval_count;
        const outputTokens = reply.eval_count;
        if (typeof inputTokens !== 'number' || !Number.isSafeInteger(inputTokens) || inputTokens < 0 || inputTokens > request.maxInputTokens ||
            typeof outputTokens !== 'number' || !Number.isSafeInteger(outputTokens) || outputTokens < 0 || outputTokens > request.maxOutputTokens)
          throw new Error('Missing, invalid or over-bound Ollama receipts.');
        return { text: message.content, usage: { inputTokens, outputTokens } };
      };
      const result = await abortable(work(), operationSignal);
      checkAbort(operationSignal);
      this.#pending = false;
      this.#activeAbort = undefined;
      return result;
    } catch (error) {
      operationAbort.abort();
      if (begun) await this.#stopOwned();
      this.#pending = false;
      this.#activeAbort = undefined;
      throw error;
    }
  }
}
Object.freeze(OllamaTransport.prototype);

/** Narrow admission proof: actual constructed audited class, never metadata alone.
 * It proves cooperative implementation identity, not hostile process isolation. */
export function isAuditedOllamaTransport(value: unknown): value is OllamaTransport {
  return typeof value === 'object' && value !== null && admitted.has(value) &&
    value instanceof OllamaTransport && Object.getPrototypeOf(value) === OllamaTransport.prototype;
}
