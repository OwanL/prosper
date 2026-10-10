import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), exec: vi.fn() }));
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  return { spawn: mocks.spawn, execFile: Object.assign(vi.fn(), { [promisify.custom]: mocks.exec }) };
});
import { mkdtempSync, mkdirSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GRANITE_RUN_ENVELOPE as G, QWEN4B_RUN_ENVELOPE as Q, LOCAL_RUN_ENVELOPE as E, OwnedServiceStartupFailure, OwnedServiceStartupStoppedFailure, TaskOwnedOllamaService } from '../src/evaluation/local-service.ts';

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe.skipIf(process.platform !== 'win32')('owned process startup teardown (mock processes only)', () => {
  function child() {
    const process = Object.assign(new EventEmitter(), { pid: 4321, exitCode: null as number | null, signalCode: null as string | null,
      kill: vi.fn(() => { process.exitCode = 0; process.signalCode = 'SIGKILL'; return true; }) });
    mocks.spawn.mockReturnValue(process);
    return process;
  }
  function running() {
    const process = child();
    const resources = { ram: 7 * 1024 ** 3, gpuMiB: 7500 };
    mocks.exec.mockImplementation(async (exe: string, args: string[]) => {
      if (exe === 'nvidia-smi.exe') return { stdout: `${resources.gpuMiB},8192`, stderr: '' };
      if (exe === 'taskkill.exe') { process.kill(); return { stdout: '', stderr: '' }; }
      const script = args.at(-1)!;
      if (script.includes('FreePhysicalMemory')) return { stdout: String(resources.ram), stderr: '' };
      if (script.includes('$all=')) return { stdout: JSON.stringify(process.exitCode === null
        ? { tree: [{ pid: process.pid, created: 'mock-root' }], listener: [process.pid] }
        : { tree: [], listener: [] }), stderr: '' };
      return { stdout: '', stderr: '' };
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    return { process, resources };
  }
  it.each([new TypeError('fetch failed'), new DOMException('readiness timed out', 'TimeoutError')])('retries a transient readiness failure before succeeding: %s', async error => {
    running();
    const readiness = vi.fn().mockRejectedValueOnce(error).mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', readiness);
    const directory = mkdtempSync(join(tmpdir(), 'prosper-service-test-'));
    let service: TaskOwnedOllamaService | undefined;
    try {
      service = await TaskOwnedOllamaService.start(directory);
      expect(readiness).toHaveBeenCalledTimes(2);
      expect(readiness.mock.calls.every(([url]) => url === service!.endpoint + '/api/version')).toBe(true);
    } finally { await service?.stop(); rmSync(directory, { recursive: true, force: true }); }
  });
  it('does not retry caller abort during a readiness fetch and confirms owned teardown', async () => {
    const { process } = running();
    const abort = new AbortController(); const reason = new Error('caller startup abort');
    const readiness = vi.fn().mockImplementation(async () => { abort.abort(reason); throw new TypeError('fetch aborted'); });
    vi.stubGlobal('fetch', readiness);
    const directory = mkdtempSync(join(tmpdir(), 'prosper-service-test-'));
    let failure: OwnedServiceStartupStoppedFailure | undefined;
    try {
      try { await TaskOwnedOllamaService.start(directory, { signal: abort.signal }); }
      catch (error) { expect(error).toBeInstanceOf(OwnedServiceStartupStoppedFailure); failure = error as OwnedServiceStartupStoppedFailure; }
      expect(failure?.cause).toBe(reason);
      expect(readiness).toHaveBeenCalledTimes(1);
      expect(process.kill).toHaveBeenCalled();
      await expect(failure!.service.stop()).resolves.toBeUndefined();
    } finally { await failure?.service.stop(); rmSync(directory, { recursive: true, force: true }); }
  });
  it('stops at the original readiness deadline after a fetch timeout and retains a confirmed failure handle', async () => {
    const { process } = running();
    let now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now);
    const readiness = vi.fn().mockImplementation(async () => {
      now += 15000; throw new DOMException('readiness timed out', 'TimeoutError');
    });
    vi.stubGlobal('fetch', readiness);
    const directory = mkdtempSync(join(tmpdir(), 'prosper-service-test-'));
    let failure: OwnedServiceStartupStoppedFailure | undefined;
    try {
      try { await TaskOwnedOllamaService.start(directory); }
      catch (error) { expect(error).toBeInstanceOf(OwnedServiceStartupStoppedFailure); failure = error as OwnedServiceStartupStoppedFailure; }
      expect(failure?.message).toBe('Owned Ollama startup timeout');
      expect(readiness).toHaveBeenCalledTimes(1);
      expect(process.kill).toHaveBeenCalled();
      await expect(failure!.service.stop()).resolves.toBeUndefined();
      await expect(failure!.service.requireAdmission()).rejects.toThrow('stopped');
    } finally { await failure?.service.stop(); rmSync(directory, { recursive: true, force: true }); }
  });
  it('uses a caller deadline to stop the active owned tree and blocks preaborted starts', async () => {
    const { process } = running();
    const directory = mkdtempSync(join(tmpdir(), 'prosper-service-test-'));
    const abort = new AbortController(); let service: TaskOwnedOllamaService | undefined;
    try {
      service = await TaskOwnedOllamaService.start(directory, { signal: abort.signal });
      abort.abort(); await service.stop();
      expect(process.kill).toHaveBeenCalled();
      await expect(service.requireAdmission()).rejects.toThrow('external-run-abort');
      const before = mocks.spawn.mock.calls.length;
      await expect(TaskOwnedOllamaService.start(directory, { signal: abort.signal })).rejects.toThrow();
      expect(mocks.spawn).toHaveBeenCalledTimes(before);
    } finally { await service?.stop(); rmSync(directory, { recursive: true, force: true }); }
  });
  it('keeps the installed Qwen config by default and freshly gates every admission', async () => {
    const { resources } = running();
    const directory = mkdtempSync(join(tmpdir(), 'prosper-service-test-'));
    let service: TaskOwnedOllamaService | undefined;
    try {
      service = await TaskOwnedOllamaService.start(directory);
      expect(service.envelope).toBe(E);
      const env = mocks.spawn.mock.calls[0][2].env;
      expect(env.OLLAMA_CONTEXT_LENGTH).toBe('65536');
      expect(env.OLLAMA_MODELS).toBe(globalThis.process.env.OLLAMA_MODELS);
      await expect(service.requireAdmission()).resolves.toBeUndefined();
      resources.ram = E.minRamFreeBytes - 1;
      await expect(service.requireAdmission()).rejects.toThrow('preflight blocked');
      resources.ram = E.minRamFreeBytes;
      resources.gpuMiB = 6000;
      await expect(service.requireAdmission()).rejects.toThrow('7 GiB');
      service.failure = 'mock monitor failure';
      await expect(service.requireAdmission()).rejects.toThrow('mock monitor failure');
      service.failure = undefined;
      await service.stop();
      await expect(service.requireAdmission()).rejects.toThrow('stopped');
    } finally { await service?.stop(); rmSync(directory, { recursive: true, force: true }); }
  });
  it('starts Qwen4B only with its private store, full envelope and shared caller deadline', async () => {
    const { resources, process } = running(); resources.ram = Q.minRamFreeBytes; resources.gpuMiB = 7800;
    const directory = mkdtempSync(join(tmpdir(), 'prosper-service-test-')); const models = join(directory, 'models'); mkdirSync(models);
    const abort = new AbortController(); let service: TaskOwnedOllamaService | undefined;
    try {
      await expect(TaskOwnedOllamaService.start(directory, { envelope: Q })).rejects.toThrow('explicit task-owned');
      expect(mocks.spawn).not.toHaveBeenCalled();
      service = await TaskOwnedOllamaService.start(directory, { envelope: Q, modelsPath: models, signal: abort.signal });
      expect(service.envelope).toBe(Q); expect(service.modelsPath).toBe(realpathSync.native(models));
      expect(mocks.spawn.mock.calls[0]![2].env).toMatchObject({ OLLAMA_CONTEXT_LENGTH: '98304', OLLAMA_MODELS: realpathSync.native(models), OLLAMA_NO_CLOUD: '1' });
      abort.abort(); await service.stop(); expect(process.kill).toHaveBeenCalled();
    } finally { await service?.stop(); rmSync(directory, { recursive: true, force: true }); }
  });
  it('uses the explicit Granite envelope and canonical isolated model directory', async () => {
    const { resources } = running(); resources.gpuMiB = 5120;
    const directory = mkdtempSync(join(tmpdir(), 'prosper-service-test-'));
    mkdirSync(join(directory, 'models'));
    let service: TaskOwnedOllamaService | undefined;
    try {
      service = await TaskOwnedOllamaService.start(directory, { envelope: G, modelsPath: 'models' });
      expect(service.envelope).toBe(G);
      expect(mocks.spawn.mock.calls[0][2].env).toMatchObject({
        OLLAMA_CONTEXT_LENGTH: '131072', OLLAMA_MODELS: realpathSync.native(join(directory, 'models')),
        OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_NO_CLOUD: '1',
      });
      await expect(service.requireAdmission()).resolves.toBeUndefined();
      resources.gpuMiB = 5119;
      await expect(service.requireAdmission()).rejects.toThrow('5 GiB');
    } finally { await service?.stop(); rmSync(directory, { recursive: true, force: true }); }
  });
  it('rejects envelope copies and model-directory escapes before spawning', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'prosper-service-test-'));
    const outside = mkdtempSync(join(tmpdir(), 'prosper-service-outside-'));
    symlinkSync(outside, join(directory, 'escape'), 'junction');
    try {
      await expect(TaskOwnedOllamaService.start(directory, { envelope: { ...G } })).rejects.toThrow('fixed');
      await expect(TaskOwnedOllamaService.start(directory, { envelope: G })).rejects.toThrow('explicit task-owned');
      for (const modelsPath of [directory, outside, '../' + outside.split(/[\\/]/).at(-1), 'escape'])
        await expect(TaskOwnedOllamaService.start(directory, { modelsPath })).rejects.toThrow('task-owned OS-temp');
      await expect(TaskOwnedOllamaService.start(join(directory, 'escape'), { modelsPath: directory })).rejects.toThrow('task-owned OS-temp');
      expect(mocks.spawn).not.toHaveBeenCalled();
      expect(mocks.exec).not.toHaveBeenCalled();
    } finally { rmSync(directory, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
  });
  it('rechecks lifecycle after an in-flight admission sample', async () => {
    running();
    const directory = mkdtempSync(join(tmpdir(), 'prosper-service-test-'));
    let service: TaskOwnedOllamaService | undefined;
    try {
      mkdirSync(join(directory, 'models'));
      service = await TaskOwnedOllamaService.start(directory, { envelope: G, modelsPath: 'models' });
      let finish!: (result: { stdout: string; stderr: string }) => void;
      mocks.exec.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const admission = service.requireAdmission();
      service.failure = 'interrupted';
      finish({ stdout: String(7 * 1024 ** 3), stderr: '' });
      await expect(admission).rejects.toThrow('interrupted');
    } finally { await service?.stop(); rmSync(directory, { recursive: true, force: true }); }
  });
  it('preserves Granite resource-stop monitoring and observed teardown', async () => {
    vi.useFakeTimers();
    const { resources, process } = running();
    const directory = mkdtempSync(join(tmpdir(), 'prosper-service-test-'));
    let service: TaskOwnedOllamaService | undefined;
    try {
      mkdirSync(join(directory, 'models'));
      service = await TaskOwnedOllamaService.start(directory, { envelope: G, modelsPath: 'models' });
      resources.ram = G.stopRamFreeBytes - 1;
      await vi.advanceTimersByTimeAsync(1000);
      expect(service.failure).toBe('Resource headroom stop');
      await service.stop();
      expect(process.kill).toHaveBeenCalled();
      await expect(service.requireAdmission()).rejects.toThrow('Resource headroom stop');
    } finally { await service?.stop(); rmSync(directory, { recursive: true, force: true }); }
  });
  function inspectFailure(always: boolean) {
    let inspections = 0;
    mocks.exec.mockImplementation(async (exe: string, args: string[]) => {
      if (exe === 'nvidia-smi.exe') return { stdout: '7500,8192', stderr: '' };
      const script = args.at(-1)!;
      if (script.includes('FreePhysicalMemory')) return { stdout: String(7 * 1024 ** 3), stderr: '' };
      if (script.includes('$all=')) {
        inspections++;
        if (always || inspections === 1) throw new Error('mock CIM inspection failure');
        return { stdout: JSON.stringify({ tree: [], listener: [] }), stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });
  }
  it('attempts owned-root termination even when startup identity inspection fails', async () => {
    const process = child(); inspectFailure(false);
    const directory = mkdtempSync(join(tmpdir(), 'prosper-service-test-'));
    try {
      await expect(TaskOwnedOllamaService.start(directory)).rejects.toThrow('mock CIM inspection failure');
      expect(process.kill).toHaveBeenCalledWith('SIGKILL');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('retains the owned handle on unconfirmed startup teardown and allows cleanup retry', async () => {
    const process = child(); inspectFailure(true);
    const directory = mkdtempSync(join(tmpdir(), 'prosper-service-test-'));
    try {
      let failure: OwnedServiceStartupFailure | undefined;
      try { await TaskOwnedOllamaService.start(directory); }
      catch (error) { expect(error).toBeInstanceOf(OwnedServiceStartupFailure); failure = error as OwnedServiceStartupFailure; }
      expect(failure).toBeDefined(); expect(process.kill).toHaveBeenCalledWith('SIGKILL');
      // Exact-identity query is separate from process-tree inspection.
      mocks.exec.mockImplementation(async (_exe: string, args: string[]) => ({
        stdout: args.at(-1)!.includes('$all=') ? JSON.stringify({ tree: [], listener: [] }) : '', stderr: '',
      }));
      await expect(failure!.service.stop()).resolves.toBeUndefined();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
