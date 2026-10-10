import { describe, expect, it, vi } from 'vitest';
import { OllamaTransport, isAuditedOllamaTransport, type OllamaTransportConfig, type TaskOwnedOllamaController } from '../src/evaluation/candidates/ollama-transport.ts';
import type { PrimitiveModelRequest } from '../src/evaluation/candidates/local-model.ts';
import { createHash } from 'node:crypto';
import { GRANITE_RUN_ENVELOPE } from '../src/evaluation/local-service.ts';
import { GRANITE_ARTIFACT, GRANITE_MODEL, GRANITE_TEMPLATE, type GraniteMetadata } from '../src/evaluation/small-model.ts';

// Only this frozen synthetic fixture is admitted; all other metadata still uses
// the real artifact-verification gate. No weights or inference in this suite.
const graniteProof = vi.hoisted(() => new WeakSet<object>());
vi.mock('../src/evaluation/small-model.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/evaluation/small-model.ts')>();
  return { ...actual, isVerifiedGraniteMetadata: (value: unknown) =>
    (typeof value === 'object' && value !== null && graniteProof.has(value)) || actual.isVerifiedGraniteMetadata(value) };
});

const endpoint = 'http://127.0.0.1:19231';
const digest = 'a'.repeat(64);
const config: OllamaTransportConfig = { endpoint, model: 'qwen3.5:9b', digest, size: 6600000000, contextTokens: 65536 };
const request = (): PrimitiveModelRequest => ({
  endpoint, model: config.model, requestId: 'decision-1', seed: 7,
  messages: [{ role: 'system', content: 'Use the schema.' }, { role: 'user', content: 'Choose.' }],
  format: { type: 'object' }, maxInputTokens: 60000, maxOutputTokens: 256, maxOutputBytes: 1024,
  thinking: false, stream: false,
});
const show = () => ({ details: { format: 'gguf' }, model_info: { 'tokenizer.ggml.model': 'gpt2' }, template: '{{ .Messages }}' });
const tags = () => ({ models: [{ name: config.model, model: config.model, digest, size: config.size, details: { format: 'gguf' } }] });
const reply = () => ({ model: config.model, done: true, message: { role: 'assistant', content: '{"kind":"advance"}' }, prompt_eval_count: 30, eval_count: 5 });
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
function fixture(responses: (Response | (() => Promise<Response>))[] = [json(show()), json(tags()), json(reply())], stop: () => Promise<void> = async () => {}) {
  const stopSpy = vi.fn(stop);
  const controller: TaskOwnedOllamaController = { endpoint, stop: stopSpy };
  const fetchMock = vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error('Unexpected HTTP request.');
    return typeof response === 'function' ? response() : response;
  });
  const transport = new OllamaTransport(config, controller, fetchMock as unknown as typeof fetch);
  return { transport, stopSpy, fetchMock };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function turns() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
async function reached(spy: ReturnType<typeof vi.fn>, count: number) {
  await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(count), { timeout: 1000, interval: 1 });
}

describe('task-owned audited Ollama HTTP transport (mock HTTP only)', () => {
  it('verifies installed metadata and exact tag before a single deterministic unloaded chat', async () => {
    const { transport, stopSpy, fetchMock } = fixture();
    expect(isAuditedOllamaTransport(transport)).toBe(true);
    expect(isAuditedOllamaTransport({ capability: 'local' })).toBe(false);
    expect(isAuditedOllamaTransport(Object.create(OllamaTransport.prototype))).toBe(false);
    const result = await transport.complete(request(), new AbortController().signal);
    expect(result).toEqual({ text: reply().message.content, usage: { inputTokens: 30, outputTokens: 5 } });
    expect(fetchMock.mock.calls.map((call) => (call as unknown as [string])[0])).toEqual([endpoint + '/api/show', endpoint + '/api/tags', endpoint + '/api/chat']);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    for (const [, options] of calls) expect(options).toMatchObject({ redirect: 'error', credentials: 'omit' });
    expect(JSON.parse(calls[2]![1].body as string)).toEqual({
      model: config.model, messages: request().messages, format: request().format, think: false, stream: false, keep_alive: 0,
      options: { temperature: 0, seed: 7, num_ctx: 65536, num_predict: 256 },
    });
    expect(stopSpy).not.toHaveBeenCalled();
    expect(transport.pending).toBe(false);
  });

  it.each(['https://127.0.0.1:19231', 'http://localhost:19231', 'http://[::1]:19231', 'http://user@127.0.0.1:19231', endpoint + '/api', endpoint + '?x=1', endpoint + '/a/../'])('rejects unsupported endpoint %s before HTTP', (badEndpoint) => {
    expect(() => new OllamaTransport({ ...config, endpoint: badEndpoint }, { endpoint: badEndpoint, stop: async () => {} })).toThrow();
  });
  it('requires exact matching owner, model, digest, size and bounded context', () => {
    const owner = { endpoint, stop: async () => {} };
    expect(() => new OllamaTransport(config, { ...owner, endpoint: 'http://127.0.0.1:19232' })).toThrow();
    expect(() => new OllamaTransport({ ...config, model: 'other' as 'qwen3.5:9b' }, owner)).toThrow();
    expect(() => new OllamaTransport({ ...config, digest: 'unknown' }, owner)).toThrow();
    expect(() => new OllamaTransport({ ...config, size: 0 }, owner)).toThrow();
    expect(() => new OllamaTransport({ ...config, contextTokens: 65537 }, owner)).toThrow();
    expect(() => new OllamaTransport(config, undefined as unknown as TaskOwnedOllamaController)).toThrow();
  });

  it.each([
    { endpoint: 'http://localhost:19231' }, { model: 'different' }, { maxInputTokens: 65300 },
    { maxInputTokens: 6200 }, { maxOutputTokens: 0 }, { maxOutputBytes: 1048577 },
    { seed: 1.5 }, { thinking: true }, { stream: true },
    { messages: [{ role: 'user', content: '漢'.repeat(20000) }] },
  ])('rejects invalid or unaffordable request before any HTTP: %j', async (change) => {
    const { transport, stopSpy, fetchMock } = fixture();
    await expect(transport.complete({ ...request(), ...change } as PrimitiveModelRequest, new AbortController().signal)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stopSpy).not.toHaveBeenCalled();
  });

  it.each([
    { ...show(), remote_host: 'https://example.invalid' },
    { ...show(), model_info: { 'tokenizer.ggml.model': 'llama' } },
    { ...show(), details: { format: 'safetensors' } },
    { ...show(), template: 'x'.repeat(60000) },
  ])('rejects unsupported show metadata without generation: %j', async (metadata) => {
    const { transport, stopSpy, fetchMock } = fixture([json(metadata)]);
    await expect(transport.complete(request(), new AbortController().signal)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalledOnce();
  });
  it.each([
    { ...tags().models[0], digest: 'b'.repeat(64) }, { ...tags().models[0], size: config.size + 1 },
    { ...tags().models[0], name: 'qwen3.5:9b-alias' }, { ...tags().models[0], remote_model: 'qwen' },
  ])('rejects exact installed tag mismatches without generation: %j', async (model) => {
    const { transport, stopSpy, fetchMock } = fixture([json(show()), json({ models: [model] })]);
    await expect(transport.complete(request(), new AbortController().signal)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stopSpy).toHaveBeenCalledOnce();
  });

  it.each([
    { done: false }, { model: 'other' }, { prompt_eval_count: undefined }, { prompt_eval_count: 60001 },
    { prompt_eval_count: -1 }, { eval_count: 257 }, { eval_count: 1.5 },
    { message: { role: 'assistant', content: 'x'.repeat(1025) } },
    { message: { role: 'assistant', content: '{}', thinking: 'hidden chain' } },
  ])('requires complete bounded output and integral usage receipts: %j', async (change) => {
    const { transport, stopSpy } = fixture([json(show()), json(tags()), json({ ...reply(), ...change })]);
    await expect(transport.complete(request(), new AbortController().signal)).rejects.toThrow();
    expect(stopSpy).toHaveBeenCalledOnce();
  });

  it('caps bodies while reading, not just trusting content-length, and stops on a large envelope', async () => {
    const envelope = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(71681)); controller.close();
    } });
    const { transport, stopSpy } = fixture([json(show()), json(tags()), new Response(envelope)]);
    await expect(transport.complete(request(), new AbortController().signal)).rejects.toThrow('envelope');
    expect(stopSpy).toHaveBeenCalledOnce();
  });
  it('rejects declared oversized envelope before reading it', async () => {
    const { transport, stopSpy } = fixture([new Response('{}', { headers: { 'content-length': '1048577' } })]);
    await expect(transport.complete(request(), new AbortController().signal)).rejects.toThrow('envelope');
    expect(stopSpy).toHaveBeenCalledOnce();
  });
  it.each([new Response('', { status: 302 }), new Response('', { status: 500 }), new Response('not json')])('does not retry HTTP/redirect/JSON failures', async (response) => {
    const { transport, stopSpy, fetchMock } = fixture([response]);
    await expect(transport.complete(request(), new AbortController().signal)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(stopSpy).toHaveBeenCalledOnce();
    await expect(transport.complete(request(), new AbortController().signal)).rejects.toThrow('reuse');
  });

  it('keeps failure pending until owned stop succeeds and then forbids reuse', async () => {
    const stop = deferred<void>();
    const { transport, stopSpy } = fixture([new Response('', { status: 500 })], () => stop.promise);
    let settled = false;
    const operation = transport.complete(request(), new AbortController().signal).finally(() => { settled = true; });
    void operation.catch(() => {});
    await reached(stopSpy, 1);
    expect(transport.pending).toBe(true);
    expect(settled).toBe(false);
    await expect(transport.complete(request(), new AbortController().signal)).rejects.toThrow('reuse');
    stop.resolve();
    await expect(operation).rejects.toThrow('HTTP');
    expect(transport.pending).toBe(false);
    expect(settled).toBe(true);
  });
  it('abort during begun generation awaits service stop even when HTTP ignores abort', async () => {
    const http = deferred<Response>();
    const stop = deferred<void>();
    const { transport, stopSpy, fetchMock } = fixture([json(show()), json(tags()), () => http.promise], () => stop.promise);
    const abort = new AbortController();
    let settled = false;
    const operation = transport.complete(request(), abort.signal).finally(() => { settled = true; });
    void operation.catch(() => {});
    await reached(fetchMock, 3);
    abort.abort();
    await reached(stopSpy, 1);
    expect(settled).toBe(false);
    expect(transport.pending).toBe(true);
    // A late valid response cannot prove the owned process has stopped.
    http.resolve(json(reply()));
    await turns();
    expect(settled).toBe(false);
    stop.resolve();
    await expect(operation).rejects.toThrow('aborted');
    expect(transport.pending).toBe(false);
  });
  it('a failed owned stop never falsely settles the operation', async () => {
    const { transport, stopSpy } = fixture([new Response('', { status: 500 })], async () => { throw new Error('tree still alive'); });
    let settled = false;
    void transport.complete(request(), new AbortController().signal).then(() => { settled = true; }, () => { settled = true; });
    await reached(stopSpy, 1);
    await turns();
    expect(settled).toBe(false);
    expect(transport.pending).toBe(true);
  });
  it('exposes stable immutable protocol/config identity', () => {
    const first = fixture().transport;
    const second = fixture().transport;
    expect(first.identity).toMatch(/^[a-f0-9]{64}$/);
    expect(second.identity).toBe(first.identity);
    const reordered = new OllamaTransport({ size: config.size, contextTokens: config.contextTokens, digest, model: config.model, endpoint: endpoint + '/' }, { endpoint, stop: async () => {} });
    expect(reordered.identity).toBe(first.identity);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.config)).toBe(true);
    const changed = new OllamaTransport({ ...config, digest: 'b'.repeat(64) }, { endpoint, stop: async () => {} });
    expect(changed.identity).not.toBe(first.identity);
  });
  it('close stops once, waits for success, and irrevocably blocks reuse', async () => {
    const stop = deferred<void>();
    const { transport, stopSpy, fetchMock } = fixture([], () => stop.promise);
    let settled = false;
    const closed = transport.close().then(() => { settled = true; });
    const again = transport.close();
    await reached(stopSpy, 1);
    expect(transport.pending).toBe(true);
    expect(settled).toBe(false);
    stop.resolve();
    await Promise.all([closed, again]);
    expect(transport.pending).toBe(false);
    await expect(transport.complete(request(), new AbortController().signal)).rejects.toThrow('reuse');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalledOnce();
  });
  it('close during ignored HTTP abort shares the same process stop', async () => {
    const http = deferred<Response>();
    const stop = deferred<void>();
    const { transport, stopSpy, fetchMock } = fixture([() => http.promise], () => stop.promise);
    const operation = transport.complete(request(), new AbortController().signal);
    void operation.catch(() => {});
    await reached(fetchMock, 1);
    const closed = transport.close();
    await reached(stopSpy, 1);
    expect(transport.pending).toBe(true);
    stop.resolve();
    await closed;
    await expect(operation).rejects.toThrow('aborted');
    expect(stopSpy).toHaveBeenCalledOnce();
    http.resolve(json(show()));
    await turns();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('failed close remains pending without pretending the tree is stopped', async () => {
    const { transport, stopSpy } = fixture([], async () => { throw new Error('stop failed'); });
    let settled = false;
    void transport.close().then(() => { settled = true; }, () => { settled = true; });
    await reached(stopSpy, 1);
    await turns();
    expect(settled).toBe(false);
    expect(transport.pending).toBe(true);
  });
  it('abort before a request begins has nothing to stop', async () => {
    const { transport, stopSpy, fetchMock } = fixture();
    const abort = new AbortController(); abort.abort();
    await expect(transport.complete(request(), abort.signal)).rejects.toThrow('aborted');
    expect(stopSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const graniteMetadata: GraniteMetadata = Object.freeze({
  artifactSha256: GRANITE_ARTIFACT.sha256, embeddedTemplateSha256: GRANITE_ARTIFACT.publisherTemplateSha256,
  tokenizerPre: 'gpt2', modelInfo: Object.freeze({
    'general.architecture': 'granitehybrid', 'general.file_type': 7,
    'granitehybrid.context_length': 131072, 'granitehybrid.block_count': 40,
    'granitehybrid.embedding_length': 1536, 'tokenizer.ggml.model': 'gpt2',
    'tokenizer.ggml.pre': 'gpt2', 'tokenizer.ggml.add_bos_token': false,
  }),
});
graniteProof.add(graniteMetadata);
const graniteConfig: OllamaTransportConfig = { endpoint, model: GRANITE_MODEL, digest,
  size: GRANITE_ARTIFACT.bytes + 2048, contextTokens: 131072, granite: graniteMetadata };
const graniteRequest = (): PrimitiveModelRequest => ({ ...request(), model: GRANITE_MODEL, maxInputTokens: 120000 });
const graniteShow = () => ({ details: { format: 'gguf', family: 'granitehybrid', quantization_level: 'Q8_0' },
  model_info: { ...graniteMetadata.modelInfo }, template: GRANITE_TEMPLATE, system: '', messages: [],
  parameters: 'num_ctx 131072\nstop "<|end_of_text|>"\n' });
const graniteTag = () => ({ name: GRANITE_MODEL, model: GRANITE_MODEL, digest, size: graniteConfig.size,
  details: { format: 'gguf', family: 'granitehybrid', quantization_level: 'Q8_0' } });
const graniteReply = () => ({ ...reply(), model: GRANITE_MODEL });
function graniteFixture(showValue: unknown = graniteShow(), tagValue: unknown = graniteTag(), replyValue: unknown = graniteReply()) {
  const responses = [json(showValue), json({ models: [tagValue] }), json(replyValue)];
  const events: string[] = [];
  const requireAdmission = vi.fn(async () => { events.push('admission'); });
  const stop = vi.fn(async () => {});
  const fetchMock = vi.fn(async (url: string, _options?: RequestInit) => {
    events.push(url.slice(endpoint.length));
    const response = responses.shift(); if (!response) throw new Error('Unexpected HTTP'); return response;
  });
  const owner = { endpoint, stop, requireAdmission, envelope: GRANITE_RUN_ENVELOPE, modelsPath: 'C:/mock-os-temp/owned/models' };
  return { transport: new OllamaTransport(graniteConfig, owner, fetchMock as typeof fetch), owner, fetchMock, events };
}

describe('pinned Granite transport (synthetic verified fixture, mock HTTP only)', () => {
  it('checks native template, fixed parameters, family and every verified modelInfo field, with fresh admission before generation', async () => {
    const { transport, owner, fetchMock, events } = graniteFixture();
    expect(Object.isFrozen(graniteMetadata)).toBe(true);
    expect(Object.isFrozen(graniteMetadata.modelInfo)).toBe(true);
    expect(await transport.complete(graniteRequest(), new AbortController().signal)).toEqual({ text: graniteReply().message.content, usage: { inputTokens: 30, outputTokens: 5 } });
    expect(events).toEqual(['admission', '/api/show', '/api/tags', 'admission', '/api/chat']);
    expect(owner.requireAdmission).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[2]![1]!.body as string)).toEqual({
      model: GRANITE_MODEL, messages: graniteRequest().messages, format: graniteRequest().format,
      think: false, stream: false, keep_alive: 0, truncate: false,
      options: { temperature: 0, seed: 7, num_ctx: 131072, num_predict: 256 },
    });
    expect(owner.stop).not.toHaveBeenCalled();
  });

  it('requires artifact proof, fresh admission capability and the exact context at construction', () => {
    const owner = { endpoint, stop: async () => {}, requireAdmission: async () => {}, envelope: GRANITE_RUN_ENVELOPE, modelsPath: 'C:/mock-os-temp/owned/models' };
    expect(() => new OllamaTransport({ ...graniteConfig, granite: { ...graniteMetadata } }, owner)).toThrow('Verified artifact');
    expect(() => new OllamaTransport({ ...graniteConfig, granite: undefined }, owner)).toThrow('Verified artifact');
    expect(() => new OllamaTransport(graniteConfig, { endpoint, stop: owner.stop })).toThrow('fresh');
    expect(() => new OllamaTransport(graniteConfig, { ...owner, modelsPath: undefined })).toThrow('fresh');
    expect(() => new OllamaTransport(graniteConfig, { ...owner, envelope: undefined })).toThrow('fresh');
    expect(() => new OllamaTransport({ ...graniteConfig, contextTokens: 65536 }, owner)).toThrow('Context');
    expect(() => new OllamaTransport({ ...config, granite: graniteMetadata }, owner)).toThrow('cannot authorize Qwen');
  });

  it.each([
    { template: GRANITE_TEMPLATE + '\n' }, { system: 'Added instructions' },
    { messages: [{ role: 'system', content: 'Added instructions' }] },
    { parameters: 'num_ctx 131072\nstop "wrong"' },
    { parameters: 'num_ctx 131072\nstop "<|end_of_text|>"\ntemperature 0' },
    { parameters: undefined }, { remote_host: 'https://example.invalid' },
    { details: { ...graniteShow().details, family: 'granite' } },
    { details: { ...graniteShow().details, quantization_level: 'Q4_0' } },
    ...Object.keys(graniteMetadata.modelInfo).map(key => ({ model_info: { ...graniteMetadata.modelInfo, [key]: 'mismatch' } })),
  ])('fails closed on show metadata mismatch: %j', async (change) => {
    const { transport, owner, fetchMock } = graniteFixture({ ...graniteShow(), ...change });
    await expect(transport.complete(graniteRequest(), new AbortController().signal)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(owner.stop).toHaveBeenCalledOnce();
  });

  it.each([
    { digest: 'b'.repeat(64) }, { size: graniteConfig.size + 1 }, { cloud: true },
    { details: { ...graniteTag().details, family: 'qwen' } },
    { details: { ...graniteTag().details, quantization_level: 'Q4_0' } },
  ])('fails closed on installed tag mismatch: %j', async (change) => {
    const { transport, owner, fetchMock } = graniteFixture(graniteShow(), { ...graniteTag(), ...change });
    await expect(transport.complete(graniteRequest(), new AbortController().signal)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(owner.requireAdmission).toHaveBeenCalledOnce();
    expect(owner.stop).toHaveBeenCalledOnce();
  });

  it.each([1, 2])('does not generate when admission check %i fails', async (check) => {
    const { transport, owner, fetchMock } = graniteFixture();
    if (check === 2) owner.requireAdmission.mockResolvedValueOnce(undefined);
    owner.requireAdmission.mockRejectedValueOnce(new Error('RAM gate blocked'));
    await expect(transport.complete(graniteRequest(), new AbortController().signal)).rejects.toThrow('RAM gate');
    expect(fetchMock).toHaveBeenCalledTimes(check === 1 ? 0 : 2);
    expect(owner.stop).toHaveBeenCalledTimes(check === 1 ? 0 : 1);
  });

  it.each([{ maxInputTokens: 119999 }, { maxOutputTokens: 255 },
    { messages: [{ role: 'user', content: 'Only one message' }] }])('rejects nonfixed primitive envelope before admission: %j', async (change) => {
    const { transport, owner, fetchMock } = graniteFixture();
    await expect(transport.complete({ ...graniteRequest(), ...change } as PrimitiveModelRequest, new AbortController().signal)).rejects.toThrow('Granite requires');
    expect(owner.requireAdmission).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retains bounded raw public content and hash when usage receipt is invalid', async () => {
    const content = '{"kind":"advance"}';
    const { transport, owner } = graniteFixture(graniteShow(), graniteTag(), { ...graniteReply(), prompt_eval_count: undefined });
    await expect(transport.complete(graniteRequest(), new AbortController().signal)).rejects.toThrow('receipts');
    expect(transport.getReplyAudits()).toEqual([{ bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex'), text: content }]);
    const copy = transport.getReplyAudits(); copy[0]!.text = 'mutated';
    expect(transport.getReplyAudits()[0]!.text).toBe(content);
    expect(owner.stop).toHaveBeenCalledOnce();
  });
  it('hashes but never retains raw over-bound content', async () => {
    const content = 'x'.repeat(1025);
    const { transport } = graniteFixture(graniteShow(), graniteTag(), { ...graniteReply(), message: { role: 'assistant', content } });
    await expect(transport.complete(graniteRequest(), new AbortController().signal)).rejects.toThrow('over-bound');
    expect(transport.getReplyAudits()).toEqual([{ bytes: 1025, sha256: createHash('sha256').update(content).digest('hex') }]);
  });
});
