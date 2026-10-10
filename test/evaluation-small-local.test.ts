import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as small from '../src/evaluation/small-model.ts';
import * as resources from '../src/evaluation/local-service.ts';
import * as fixtures from '../src/evaluation/fixtures.ts';
import * as runner from '../src/evaluation/runner.ts';
import { evaluateSmallLocal, SMALL_LOCAL_CONFIG, SMALL_LOCAL_CALL_SPLIT } from '../scripts/evaluate-small-local.ts';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function directory() {
  const value = await mkdtemp(join(tmpdir(), 'prosper-small-model-test-')); directories.push(value); return value;
}
const signal = () => new AbortController().signal;

describe('pinned small local model (offline, no weights/services/inference)', () => {
  it('pins exact immutable artifact size, digest, revisions and native template', () => {
    expect(Object.isFrozen(small.GRANITE_ARTIFACT)).toBe(true);
    expect(small.GRANITE_ARTIFACT).toMatchObject({ repository: 'ibm-granite/granite-4.0-h-1b-GGUF',
      revision: 'c2cb1972f511add21f3bae244990b8ff3a3ffb23', file: 'granite-4.0-h-1b-Q8_0.gguf', bytes: 1558926560,
      sha256: 'f29248184ca766350e56e6d161c2a637ad302a6d595e15d4a62cd58327a0ac0e',
      publisherRevision: 'd18cca4c121edb87d022116d281ce212c9136f57',
      publisherTemplateSha256: '9524df67b77a7b25a2dfee898f75b316a157eb9d855b51e32aeac79d7c8a83ce' });
    expect(small.GRANITE_ARTIFACT.url).toBe(`https://huggingface.co/${small.GRANITE_ARTIFACT.repository}/resolve/${small.GRANITE_ARTIFACT.revision}/${small.GRANITE_ARTIFACT.file}`);
    expect(small.GRANITE_TEMPLATE).toBe('{{ range .Messages }}<|start_of_role|>{{ .Role }}<|end_of_role|>{{ .Content }}<|end_of_text|>\n{{ end }}<|start_of_role|>assistant<|end_of_role|>');
    expect(small.GRANITE_TEMPLATE_SHA256).toBe(createHash('sha256').update(small.GRANITE_TEMPLATE).digest('hex'));
  });

  it('offline noconfirm plans without acquisition, fixtures, resources, service or inference', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const never = () => { throw new Error('Offline path performed work'); };
    const spies = [vi.spyOn(small, 'acquireGranite').mockImplementation(never),
      vi.spyOn(small, 'inspectGranite').mockImplementation(never), vi.spyOn(small, 'importGranite').mockImplementation(never),
      vi.spyOn(resources, 'readLocalResources').mockImplementation(never),
      vi.spyOn(resources.TaskOwnedOllamaService, 'start').mockImplementation(never),
      vi.spyOn(fixtures, 'developmentFixture').mockImplementation(never), vi.spyOn(runner, 'runEpisode').mockImplementation(never),
      vi.spyOn(globalThis, 'fetch').mockImplementation(never)];
    await evaluateSmallLocal(); await evaluateSmallLocal(false);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(2);
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({ kind: 'offline-small-local-plan', calls: 0,
      optIn: '--confirm-small-local', artifact: small.GRANITE_ARTIFACT, config: SMALL_LOCAL_CONFIG,
      envelope: { contextTokens: 131072, maxInputTokens: 120000, maxOutputTokens: 256, maxCalls: 3 } });
    expect(Object.isFrozen(SMALL_LOCAL_CONFIG)).toBe(true);
    expect(Object.isFrozen(SMALL_LOCAL_CONFIG.history)).toBe(true);
    expect(SMALL_LOCAL_CALL_SPLIT).toEqual([1, 2]);
    expect(SMALL_LOCAL_CALL_SPLIT.reduce((sum, count) => sum + count, 0)).toBe(3);
  });

  it('cannot forge inspected artifact metadata or import it, even if frozen', async () => {
    const forged = Object.freeze({ artifactSha256: small.GRANITE_ARTIFACT.sha256,
      embeddedTemplateSha256: small.GRANITE_ARTIFACT.publisherTemplateSha256, tokenizerPre: 'gpt2', modelInfo: Object.freeze({}) });
    for (const value of [undefined, null, {}, forged]) expect(small.isVerifiedGraniteMetadata(value)).toBe(false);
    const requireAdmission = vi.fn(); const fetchMock = vi.fn();
    await expect(small.importGranite({ requireAdmission } as unknown as resources.TaskOwnedOllamaService,
      await directory(), 'not-read.gguf', forged, signal(), fetchMock)).rejects.toThrow('Verified Granite');
    expect(requireAdmission).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects undersized files before hashing or reading GGUF metadata', async () => {
    const path = join(await directory(), 'tiny.gguf'); await writeFile(path, 'GGUF');
    await expect(small.verifyGraniteFile(path, signal())).rejects.toThrow('size mismatch');
    await expect(small.inspectGranite(path, signal())).rejects.toThrow('size mismatch');
  });

  it('streams tiny mock HTTP data, rejects undersize and removes partial output without buffering weights', async () => {
    const root = await directory();
    const fetchMock = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3])); controller.close();
    } })));
    await expect(small.acquireGranite(root, signal(), fetchMock)).rejects.toThrow('SHA256/bytes');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(small.GRANITE_ARTIFACT.url, expect.objectContaining({ redirect: 'follow', credentials: 'omit', signal: expect.any(AbortSignal) }));
    expect(await readdir(root)).toEqual([]);
  });
  it.each(['declared-size', 'http', 'read-error', 'cancel'] as const)('cleans task-owned partial files after %s acquisition failure', async (failure) => {
    const root = await directory(); const abort = new AbortController(); const cancel = vi.fn();
    const fetchMock = vi.fn(async () => {
      if (failure === 'http') return new Response('', { status: 503 });
      if (failure === 'declared-size') return new Response('tiny', { headers: { 'content-length': '4' } });
      return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
        if (failure === 'read-error') controller.error(new Error('mock stream failed'));
        else { controller.enqueue(new Uint8Array([1])); abort.abort(new Error('mock cancelled')); }
      }, cancel }));
    });
    await expect(small.acquireGranite(root, abort.signal, fetchMock)).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
    if (failure === 'cancel') expect(cancel).toHaveBeenCalledOnce();
  });
  it('preaborted acquisition performs no HTTP or filesystem creation', async () => {
    const root = await directory(); const abort = new AbortController(); abort.abort(); const fetchMock = vi.fn();
    await expect(small.acquireGranite(root, abort.signal, fetchMock)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled(); expect(await readdir(root)).toEqual([]);
  });
  it('rejects the OS-temp root itself before HTTP (requires a unique task directory)', async () => {
    const fetchMock = vi.fn();
    await expect(small.acquireGranite(tmpdir(), signal(), fetchMock)).rejects.toThrow('Unique OS-temp');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts only bounded JSON on explicit owned loopback with no redirect or credentials', async () => {
    const fetchMock = vi.fn(async () => new Response('{"status":"success"}'));
    expect(await small.ownedJson('http://127.0.0.1:19231', '/api/create', { model: small.GRANITE_MODEL }, signal(), fetchMock)).toEqual({ status: 'success' });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:19231/api/create', expect.objectContaining({
      method: 'POST', redirect: 'error', credentials: 'omit', body: JSON.stringify({ model: small.GRANITE_MODEL }) }));
    await expect(small.ownedJson('http://localhost:19231', '/api/version', undefined, signal(), fetchMock)).rejects.toThrow('loopback');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each(['[]', 'null', 'not-json', '"scalar"'])('fails closed on invalid metadata envelope %s', async (body) => {
    await expect(small.ownedJson('http://127.0.0.1:19231', '/api/version', undefined, signal(), async () => new Response(body))).rejects.toThrow();
  });
  it('caps streamed import metadata independently of content-length', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); }, cancel });
    await expect(small.ownedJson('http://127.0.0.1:19231', '/api/version', undefined, signal(), async () => new Response(body))).rejects.toThrow('byte ceiling');
    expect(cancel).toHaveBeenCalledOnce();
  });
});
