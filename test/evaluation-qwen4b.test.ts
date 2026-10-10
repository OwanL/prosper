import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const processMocks = vi.hoisted(() => ({ spawn: vi.fn(), exec: vi.fn() }));
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  return { spawn: processMocks.spawn, execFile: Object.assign(vi.fn(), { [promisify.custom]: processMocks.exec }) };
});
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { readFileSync as readFileSyncForTest, openSync, closeSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as qwen from '../src/evaluation/qwen4b.ts';
import * as resources from '../src/evaluation/local-service.ts';
import * as fixtures from '../src/evaluation/fixtures.ts';
import * as runner from '../src/evaluation/runner.ts';
import { evaluateQwen4bLocal, parseQwen4bArgs, QWEN4B_CALL_SPLIT, QWEN4B_LOCAL_CONFIG } from '../scripts/evaluate-qwen4b-local.ts';
vi.mock('../src/evaluation/candidates/ollama-transport.ts', () => ({ OllamaTransport: class {
  identity = 'mock'; getReplyAudits() { return [{ text: 'raw failed output' }]; }
} }));
const directories: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); processMocks.spawn.mockReset(); processMocks.exec.mockReset(); for (const root of directories.splice(0)) await rm(root, { recursive: true, force: true }); });
async function directory(prefix = 'prosper-qwen4b-artifacts-') {
  const root = await mkdtemp(join(await realpath(tmpdir()), prefix)); directories.push(root); return root;
}
const E = resources.QWEN4B_RUN_ENVELOPE;
describe('Qwen4B preparation and explicit offline lane', () => {
  it('pins a text-only manifest, native renderer config and full history/call profile', () => {
    const manifest = JSON.parse(qwen.QWEN4B_MANIFEST);
    expect(manifest.layers.map((layer: { mediaType: string }) => layer.mediaType)).not.toContain('application/vnd.ollama.image.projector');
    expect(qwen.QWEN4B_DIGEST).toBe(createHash('sha256').update(qwen.QWEN4B_MANIFEST).digest('hex'));
    expect(JSON.parse(qwen.QWEN4B_CONFIG)).toMatchObject({ renderer: 'qwen3.5', parser: 'qwen3.5' });
    for (const [kind, text] of [['config', qwen.QWEN4B_CONFIG], ['template', qwen.QWEN4B_TEMPLATE], ['params', qwen.QWEN4B_PARAMS]] as const) {
      const blob = qwen.QWEN4B_BLOBS.find(entry => entry.kind === kind)!;
      expect(Buffer.byteLength(text)).toBe(blob.bytes);
      expect(createHash('sha256').update(text).digest('hex')).toBe(blob.sha256);
    }
    expect(QWEN4B_LOCAL_CONFIG).toMatchObject({ maxPromptBytes: 80000, maxInputTokens: 90000, history: { maxEntries: 4, maxBytes: 32000 } });
    expect(QWEN4B_CALL_SPLIT).toEqual([1, 2]); expect(E.runWallMs).toBe(300000);
    expect(qwen.QWEN4B_SIZE).toBe(2648604814); // actual /api/tags includes config bytes
  });
  it('strictly separates offline, preparation and explicit prepared-store confirmation', () => {
    expect(parseQwen4bArgs([])).toEqual({ mode: 'offline' });
    expect(parseQwen4bArgs(['--prepare-only'])).toEqual({ mode: 'prepare' });
    expect(parseQwen4bArgs(['--confirm-qwen4b-local', '--artifact-dir', 'C:/temp/store'])).toEqual({ mode: 'confirm', artifactDirectory: 'C:/temp/store' });
    for (const args of [['--artifact-dir', 'x'], ['--confirm-qwen4b-local'], ['--prepare-only', '--confirm-qwen4b-local'], ['--prepare-only', '--artifact-dir', ''], ['--prepare-only', '--artifact-dir', 'x', '--retry']]) expect(() => parseQwen4bArgs(args)).toThrow();
  });
  it('offline default performs no resource, fixture, verification, acquisition or service work', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const never = () => { throw new Error('offline work'); };
    const spies = [vi.spyOn(qwen, 'prepareQwen4b').mockImplementation(never), vi.spyOn(qwen, 'verifyQwen4bStore').mockImplementation(never),
      vi.spyOn(resources, 'readLocalResources').mockImplementation(never), vi.spyOn(resources.TaskOwnedOllamaService, 'start').mockImplementation(never),
      vi.spyOn(fixtures, 'developmentFixture').mockImplementation(never), vi.spyOn(globalThis, 'fetch').mockImplementation(never)];
    await evaluateQwen4bLocal(); for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
  it('preparation RAM failure occurs before fetch or output creation', async () => {
    const fetchMock = vi.fn(); await expect(qwen.prepareQwen4b(undefined, fetchMock, () => 0)).rejects.toThrow('RAM'); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects non-task-owned roots and accepts canonical private model stores', async () => {
    await expect(qwen.canonicalQwen4bStore(tmpdir())).rejects.toThrow('Task-owned');
    const root = await directory(); await mkdir(join(root, 'models'));
    expect(await qwen.canonicalQwen4bStore(root)).toBe(root);
    const other = await directory('prosper-other-'); await mkdir(join(other, 'models'));
    await expect(qwen.canonicalQwen4bStore(other)).rejects.toThrow('Task-owned');
  });
  it('failed new preparation retains its known output root and requests only pinned HTTPS blobs', async () => {
    const fetchMock = vi.fn(async () => new Response('bad', { status: 503 }));
    let failure: qwen.Qwen4bPreparationFailure | undefined;
    try { await qwen.prepareQwen4b(undefined, fetchMock, () => qwen.QWEN4B_PREPARATION.minRamBytes); }
    catch (error) { failure = error as qwen.Qwen4bPreparationFailure; }
    expect(failure).toBeInstanceOf(qwen.Qwen4bPreparationFailure); expect(failure?.directory).toBeTruthy();
    directories.push(failure!.directory!);
    expect(String(failure)).toContain(failure!.directory!);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('https://registry.ollama.ai/v2/library/qwen3.5/blobs/sha256:' + qwen.QWEN4B_BLOBS[0]!.sha256,
      expect.objectContaining({ credentials: 'omit', redirect: 'follow', signal: expect.any(AbortSignal) }));
    expect(await readdir(join(failure!.directory!, 'models', 'blobs'))).toEqual([]);
    expect(await readFile(join(failure!.directory!, 'ownership.json'), 'utf8')).toContain('prosper-qwen4b-text-store-v1');
  });
  it('confirmation blocks insufficient resources before verification or service creation', async () => {
    vi.spyOn(resources, 'readLocalResources').mockResolvedValue({ ramFreeBytes: 1.5 * 1024 ** 3, gpuFreeBytes: 8 * 1024 ** 3, gpuTotalBytes: 8 * 1024 ** 3 });
    const verify = vi.spyOn(qwen, 'verifyQwen4bStore'); const start = vi.spyOn(resources.TaskOwnedOllamaService, 'start');
    await expect(evaluateQwen4bLocal({ mode: 'confirm', artifactDirectory: 'unused' })).rejects.toThrow();
    expect(verify).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
  });
  it('rejects caller-asserted verified metadata before HTTP', async () => {
    const actual = await vi.importActual<typeof import('../src/evaluation/candidates/ollama-transport.ts')>('../src/evaluation/candidates/ollama-transport.ts');
    const forged = Object.freeze({ directory: 'x', modelsPath: 'x/models', digest: qwen.QWEN4B_DIGEST, size: qwen.QWEN4B_SIZE, modelInfo: Object.freeze({}) });
    expect(qwen.isVerifiedQwen4bMetadata(forged)).toBe(false);
    const fetchMock = vi.fn();
    expect(() => new actual.OllamaTransport({ endpoint: 'http://127.0.0.1:1234', model: qwen.QWEN4B_MODEL, digest: forged.digest, size: forged.size,
      contextTokens: E.contextTokens, qwen4b: forged }, { endpoint: 'http://127.0.0.1:1234', modelsPath: forged.modelsPath, envelope: E, stop: vi.fn(), requireAdmission: vi.fn() }, fetchMock)).toThrow('verified Qwen4B');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  async function mockedTransport(epsilon: unknown = 0.000001, version = '0.40.1', blockCount = 32) {
    const actual = await vi.importActual<typeof import('../src/evaluation/candidates/ollama-transport.ts')>('../src/evaluation/candidates/ollama-transport.ts');
    const endpoint = 'http://127.0.0.1:1234';
    const metadata: qwen.Qwen4bMetadata = Object.freeze({ directory: 'C:/private-qwen-test', modelsPath: 'C:/private-qwen-test/models',
      digest: qwen.QWEN4B_DIGEST, size: qwen.QWEN4B_SIZE, modelInfo: Object.freeze({ 'tokenizer.ggml.model': 'gpt2',
        'qwen35.attention.layer_norm_rms_epsilon': 9.999999974752427e-7, 'qwen35.block_count': 32 }) });
    // Simulate only the trusted initializer; no artifacts, service or model work.
    vi.spyOn(qwen, 'isVerifiedQwen4bMetadata').mockImplementation((value): value is qwen.Qwen4bMetadata => value === metadata);
    const controller = { endpoint, modelsPath: metadata.modelsPath, envelope: E,
      requireAdmission: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
    const details = { format: 'gguf', family: 'qwen35', quantization_level: 'Q4_K_M' };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      switch (String(url).slice(endpoint.length)) {
        case '/api/version': return Response.json({ version });
        case '/api/show': {
          const show = { details, template: qwen.QWEN4B_TEMPLATE, parameters: 'presence_penalty 1.5\ntemperature 1\ntop_k 20\ntop_p 0.95',
            model_info: { ...metadata.modelInfo, 'qwen35.block_count': blockCount,
              'qwen35.attention.layer_norm_rms_epsilon': 'epsilon-value' } };
          // Valid JSON numeric overflow reaches the finite-number guard after parsing.
          const scalar = epsilon === Infinity ? '1e999' : epsilon === -Infinity ? '-1e999' : JSON.stringify(epsilon);
          return new Response(JSON.stringify(show).replace('"epsilon-value"', scalar!));
        }
        case '/api/tags': return Response.json({ models: [{ name: qwen.QWEN4B_MODEL, digest: metadata.digest, size: metadata.size, details }] });
        case '/api/chat': return Response.json({ done: true, model: qwen.QWEN4B_MODEL,
          message: { role: 'assistant', content: '{}' }, prompt_eval_count: 100, eval_count: 1 });
        default: throw new Error('Unexpected mocked HTTP endpoint');
      }
    });
    const transport = new actual.OllamaTransport({ endpoint, model: qwen.QWEN4B_MODEL, digest: metadata.digest, size: metadata.size,
      contextTokens: E.contextTokens, qwen4b: metadata }, controller, fetchMock);
    const complete = () => transport.complete({ endpoint, model: qwen.QWEN4B_MODEL, requestId: 'mock', seed: 1,
      messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'user' }], format: {},
      maxInputTokens: 90000, maxOutputTokens: 256, maxOutputBytes: 4096, thinking: false, stream: false }, new AbortController().signal);
    return { transport, complete, fetchMock, controller };
  }
  it.each([0.000001, 9.999999974752427e-7])('accepts the same stored float32 epsilon representation %s on pinned 0.40.1', async (epsilon) => {
    const { transport, complete, fetchMock, controller } = await mockedTransport(epsilon);
    try {
      await expect(complete()).resolves.toEqual({ text: '{}', usage: { inputTokens: 100, outputTokens: 1 } });
      expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual(['/api/version', '/api/show', '/api/tags', '/api/chat'].map(path => controller.endpoint + path));
      expect(controller.requireAdmission).toHaveBeenCalledTimes(2);
    } finally { await transport.close(); }
    expect(controller.stop).toHaveBeenCalledTimes(1);
  });
  it.each([1.1e-6, '0.000001', null, Infinity, -Infinity])('rejects changed, nonnumeric or nonfinite epsilon %s before chat', async (epsilon) => {
    const { complete, fetchMock, controller } = await mockedTransport(epsilon);
    await expect(complete()).rejects.toThrow('metadata mismatch');
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(controller.stop).toHaveBeenCalledTimes(1);
  });
  it('keeps other integer metadata exact', async () => {
    const { complete, fetchMock, controller } = await mockedTransport(0.000001, '0.40.1', 33);
    await expect(complete()).rejects.toThrow('metadata mismatch');
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(controller.stop).toHaveBeenCalledTimes(1);
  });
  it('rejects the former 0.35.1 version before show or chat', async () => {
    const { complete, fetchMock, controller } = await mockedTransport(0.000001, '0.35.1');
    await expect(complete()).rejects.toThrow('Ollama 0.40.1');
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(controller.stop).toHaveBeenCalledTimes(1);
  });
  it.each(['episode', 'startup'] as const)('preserves the original exclusive log on unconfirmed %s teardown and blocks reuse', async (phase) => {
    const root = await directory(); await mkdir(join(root, 'models'));
    const evidenceRoots: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((text: string) => { const event = JSON.parse(text); if (event.kind === 'identity') evidenceRoots.push(event.evidence); });
    vi.spyOn(resources, 'readLocalResources').mockResolvedValue({ ramFreeBytes: E.minRamFreeBytes, gpuFreeBytes: E.minGpuFreeBytes, gpuTotalBytes: 8 * 1024 ** 3 });
    vi.spyOn(qwen, 'verifyQwen4bStore').mockResolvedValue({ directory: root, modelsPath: join(root, 'models'), digest: qwen.QWEN4B_DIGEST, size: qwen.QWEN4B_SIZE, modelInfo: {} });
    const service = { endpoint: 'http://127.0.0.1:1234', stop: vi.fn().mockRejectedValue(new Error('unconfirmed stop')) } as unknown as resources.TaskOwnedOllamaService;
    const start = vi.spyOn(resources.TaskOwnedOllamaService, 'start').mockImplementation(async (directory) => {
      closeSync(openSync(join(directory, 'ollama.log'), 'wx', 0o600));
      await writeFile(join(directory, 'ollama.log'), 'retained original log');
      if (phase === 'startup') throw new resources.OwnedServiceStartupFailure('startup failed', service);
      return service;
    });
    vi.spyOn(fixtures, 'developmentFixture').mockReturnValue({ horizon: 1 } as ReturnType<typeof fixtures.developmentFixture>);
    vi.spyOn(runner, 'runEpisode').mockRejectedValue(new Error('episode failed'));
    try {
      await expect(evaluateQwen4bLocal({ mode: 'confirm', artifactDirectory: root })).rejects.toThrow('unconfirmed stop');
      expect(await readFile(join(root, 'ollama.log'), 'utf8')).toBe('retained original log');
      await expect(evaluateQwen4bLocal({ mode: 'confirm', artifactDirectory: root })).rejects.toThrow('EEXIST');
      expect(start.mock.calls.map(call => call[0])).toEqual([root, root]);
      expect(await readFile(join(root, 'ollama.log'), 'utf8')).toBe('retained original log');
    } finally { directories.push(...evidenceRoots); }
  });
  it.skipIf(process.platform !== 'win32')('retains confirmed-stopped startup timeout logs and permits retry of the same store', async () => {
    const root = await directory(); await mkdir(join(root, 'models'));
    const evidenceRoots: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((text: string) => { const event = JSON.parse(text); if (event.kind === 'identity') evidenceRoots.push(event.evidence); });
    vi.spyOn(resources, 'readLocalResources').mockResolvedValue({ ramFreeBytes: E.minRamFreeBytes, gpuFreeBytes: E.minGpuFreeBytes, gpuTotalBytes: 8 * 1024 ** 3 });
    vi.spyOn(qwen, 'verifyQwen4bStore').mockResolvedValue({ directory: root, modelsPath: join(root, 'models'), digest: qwen.QWEN4B_DIGEST, size: qwen.QWEN4B_SIZE, modelInfo: {} });
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock += 16000); // Expire startup without sleeping.
    processMocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { pid: 4321, exitCode: null as number | null, signalCode: null as string | null,
        kill: vi.fn(() => { child.exitCode = 0; return true; }) });
      return child;
    });
    processMocks.exec.mockImplementation(async (exe: string, args: string[]) => {
      const script = args.at(-1)!;
      if (exe === 'nvidia-smi.exe') return { stdout: '7800,8192' };
      if (script.includes('FreePhysicalMemory')) return { stdout: String(E.minRamFreeBytes) };
      if (script.includes('$all=')) return { stdout: JSON.stringify({ tree: [], listener: [] }) };
      return { stdout: '' };
    });
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const episode = vi.spyOn(runner, 'runEpisode');
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(evaluateQwen4bLocal({ mode: 'confirm', artifactDirectory: root })).rejects.toMatchObject({
          constructor: resources.OwnedServiceStartupStoppedFailure, message: 'Owned Ollama startup timeout',
          cause: expect.objectContaining({ message: 'Owned Ollama startup timeout' }), service: expect.any(resources.TaskOwnedOllamaService),
        });
        expect(await readdir(root)).toEqual(['models']);
        const retained = (await readdir(evidenceRoots[attempt]!)).find(name => name.includes('-service-'))!;
        expect(await readdir(join(evidenceRoots[attempt]!, retained))).toEqual(['ollama.log']);
      }
      expect(processMocks.spawn).toHaveBeenCalledTimes(2);
      expect(fetchMock).not.toHaveBeenCalled(); expect(episode).not.toHaveBeenCalled();
    } finally { directories.push(...evidenceRoots); }
  });
  it.skipIf(process.platform !== 'win32')('shares one global deadline and starts real guarded lifecycles with reusable child models and retained logs', async () => {
    const root = await directory(); const output = await directory('prosper-qwen-output-');
    await mkdir(join(root, 'models')); await writeFile(join(root, 'models', 'retained-store'), 'reusable');
    await writeFile(join(root, 'ownership.json'), 'retained ownership');
    let child: ReturnType<typeof mockProcessLifecycle>;
    function mockProcessLifecycle() {
      const owned = Object.assign(new EventEmitter(), { pid: 4321, exitCode: null as number | null, signalCode: null as string | null,
        kill: vi.fn(() => { owned.exitCode = 0; owned.signalCode = 'SIGKILL'; return true; }) });
      return owned;
    }
    processMocks.spawn.mockImplementation(() => { child = mockProcessLifecycle(); return child; });
    processMocks.exec.mockImplementation(async (exe: string, args: string[]) => {
      if (exe === 'nvidia-smi.exe') return { stdout: '7800,8192', stderr: '' };
      if (exe === 'taskkill.exe') { child.kill(); return { stdout: '', stderr: '' }; }
      const script = args.at(-1)!;
      if (script.includes('FreePhysicalMemory')) return { stdout: String(E.minRamFreeBytes), stderr: '' };
      if (script.includes('$all=')) return { stdout: JSON.stringify(child.exitCode === null
        ? { tree: [{ pid: child.pid, created: 'mock-root' }], listener: [child.pid] }
        : { tree: [], listener: [] }), stderr: '' };
      return { stdout: '', stderr: '' };
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    for (const file of ['initialization.json', 'trace.jsonl', 'report.json']) await writeFile(join(output, file), '{}');
    const evidenceRoots: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((text: string) => { const event = JSON.parse(text); if (event.kind === 'identity') evidenceRoots.push(event.evidence); });
    vi.spyOn(resources, 'readLocalResources').mockResolvedValue({ ramFreeBytes: E.minRamFreeBytes, gpuFreeBytes: E.minGpuFreeBytes, gpuTotalBytes: 8 * 1024 ** 3 });
    vi.spyOn(qwen, 'verifyQwen4bStore').mockResolvedValue({ directory: root, modelsPath: join(root, 'models'), digest: qwen.QWEN4B_DIGEST, size: qwen.QWEN4B_SIZE, modelInfo: {} });
    const stop = vi.spyOn(resources.TaskOwnedOllamaService.prototype, 'stop');
    const start = vi.spyOn(resources.TaskOwnedOllamaService, 'start');
    vi.spyOn(fixtures, 'developmentFixture').mockImplementation((family) => ({ horizon: family === 'buy-meal' ? 1 : 2 }) as ReturnType<typeof fixtures.developmentFixture>);
    const episode = vi.spyOn(runner, 'runEpisode').mockImplementation(async (_fixture, _candidate, options) => ({ outputDirectory: output, usage: { modelCalls: options!.limits!.maxModelCalls }, accountingValid: true, reason: 'completed' }) as Awaited<ReturnType<typeof runner.runEpisode>>);
    vi.spyOn(runner, 'replayEpisode').mockImplementation(() => {
      const events = JSON.parse(readFileSyncForTest(join(evidenceRoots[0]!, 'probe.json'), 'utf8'));
      expect(events.some((event: { kind: string }) => event.kind === 'raw-episode')).toBe(true);
      return {} as ReturnType<typeof runner.replayEpisode>;
    });
    try { await evaluateQwen4bLocal({ mode: 'confirm', artifactDirectory: root }); }
    finally { directories.push(...evidenceRoots); }
    expect(start).toHaveBeenCalledTimes(2); expect(start.mock.calls[0]![1]!.signal).toBe(start.mock.calls[1]![1]!.signal);
    expect(episode.mock.calls.map(call => call[2]!.limits!.maxModelCalls)).toEqual([1, 2]);
    expect(start.mock.calls.map(call => call[0])).toEqual([root, root]);
    expect(start.mock.calls.map(call => call[1]!.modelsPath)).toEqual([join(root, 'models'), join(root, 'models')]);
    expect(processMocks.spawn).toHaveBeenCalledTimes(2);
    for (const call of processMocks.spawn.mock.calls) expect(call[2].env.OLLAMA_MODELS).toBe(realpathSync.native(join(root, 'models')));
    expect(stop).toHaveBeenCalledTimes(2);
    expect(await readdir(root)).toEqual(['models', 'ownership.json']); // reusable store not removed, exclusive log moved
    expect(await readFile(join(root, 'models', 'retained-store'), 'utf8')).toBe('reusable');
    const retainedServices = (await readdir(evidenceRoots[0]!)).filter(name => name.includes('-service-'));
    expect(retainedServices).toHaveLength(2);
    for (const retained of retainedServices) expect(await readdir(join(evidenceRoots[0]!, retained))).toEqual(['ollama.log']);
  });
});

