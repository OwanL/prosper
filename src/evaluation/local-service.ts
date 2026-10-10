import { spawn, execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { openSync, closeSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const GiB = 1024 ** 3;
export interface LocalResources { ramFreeBytes: number; gpuFreeBytes: number; gpuTotalBytes: number }
export interface LocalRunEnvelope {
  readonly contextTokens: number; readonly maxCalls: number; readonly maxInputTokens: number; readonly maxOutputTokens: number;
  readonly runWallMs: number; readonly decisionMs: number; readonly teardownMs: number;
  readonly minRamFreeBytes: number; readonly minGpuFreeBytes: number;
  readonly stopRamFreeBytes: number; readonly stopGpuFreeBytes: number;
}
export const LOCAL_RUN_ENVELOPE: LocalRunEnvelope = Object.freeze({
  contextTokens: 65536, maxCalls: 3, maxInputTokens: 60000, maxOutputTokens: 256,
  runWallMs: 300000, decisionMs: 90000, teardownMs: 10000,
  // Planning/headroom gates, NOT kernel-enforced allocation ceilings. Qwen's
  // FP16 KV at 64K is about 2 GiB; weights plus KV require partial GPU offload.
  minRamFreeBytes: 6 * GiB, minGpuFreeBytes: 7 * GiB,
  stopRamFreeBytes: 1 * GiB, stopGpuFreeBytes: 128 * 1024 ** 2,
});
export const GRANITE_RUN_ENVELOPE: LocalRunEnvelope = Object.freeze({
  ...LOCAL_RUN_ENVELOPE,
  contextTokens: 131072, maxInputTokens: 120000, maxOutputTokens: 256,
  minRamFreeBytes: 6 * GiB, minGpuFreeBytes: 5 * GiB,
});
// 96K FP16 KV ~3 GiB + 2.467 GiB text weights + 1.5 GiB buffer;
// Historical host heuristic: two weight copies + runtime + margin rounded up
// to 8 GiB, retained as rationale only, not an operational admission gate.
// Explicit user-authorized empirical load-trial admission is 2 GiB free RAM;
// this is not a measured requirement or an allocation guarantee.
export const QWEN4B_RUN_ENVELOPE: LocalRunEnvelope = Object.freeze({
  ...LOCAL_RUN_ENVELOPE, contextTokens: 98304, maxInputTokens: 90000,
  minRamFreeBytes: 2 * GiB, minGpuFreeBytes: 7.25 * GiB,
});
export interface OwnedServiceOptions { envelope?: LocalRunEnvelope; modelsPath?: string; signal?: AbortSignal }
function fixedEnvelope(envelope: LocalRunEnvelope): LocalRunEnvelope {
  if (envelope !== LOCAL_RUN_ENVELOPE && envelope !== GRANITE_RUN_ENVELOPE && envelope !== QWEN4B_RUN_ENVELOPE)
    throw new Error('Only exported fixed local run envelopes are permitted');
  return envelope;
}
function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== '' && !isAbsolute(path) && path !== '..' && !path.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'));
}
function isolatedModelsPath(directory: string, modelsPath: string): string {
  // Canonical paths reject junction/symlink escapes. Both directories must
  // already exist; the caller owns creation and cleanup, never the service.
  // Native realpath consistently expands Windows short-name aliases; the JS
  // implementation can leave an existing OS-temp alias unexpanded.
  const root = realpathSync.native(directory);
  const models = realpathSync.native(resolve(root, modelsPath));
  if (!isInside(realpathSync.native(tmpdir()), root) || !isInside(root, models) || !statSync(models).isDirectory())
    throw new Error('modelsPath must be a directory inside the task-owned OS-temp directory');
  return models;
}
export function requireLocalResources(resources: LocalResources, envelope: LocalRunEnvelope = LOCAL_RUN_ENVELOPE): void {
  fixedEnvelope(envelope);
  if (!Object.values(resources).every(n => Number.isSafeInteger(n) && n > 0) || resources.gpuFreeBytes > resources.gpuTotalBytes)
    throw new Error('Unavailable/invalid RAM or VRAM measurement');
  if (resources.ramFreeBytes < envelope.minRamFreeBytes || resources.gpuFreeBytes < envelope.minGpuFreeBytes)
    throw new Error(`Local resource preflight blocked: require ${envelope.minRamFreeBytes / GiB} GiB free RAM and ${envelope.minGpuFreeBytes / GiB} GiB free VRAM for the ${envelope.contextTokens / 1024}K context envelope`);
}
export async function readLocalResources(): Promise<LocalResources> {
  if (process.platform !== 'win32') throw new Error('Task-owned service currently supports Windows only');
  const ram = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '[long](Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory * 1024'], { timeout: 5000, maxBuffer: 4096 });
  const gpu = await exec('nvidia-smi.exe', ['--query-gpu=memory.free,memory.total', '--format=csv,noheader,nounits'], { timeout: 5000, maxBuffer: 4096 });
  const lines = gpu.stdout.trim().split(/\r?\n/);
  if (lines.length !== 1) throw new Error('Exactly one measured NVIDIA GPU required');
  const [free, total] = lines[0].split(',').map(n => Number(n.trim()) * 1024 ** 2);
  return { ramFreeBytes: Number(ram.stdout.trim()), gpuFreeBytes: free, gpuTotalBytes: total };
}
export class OwnedServiceStartupFailure extends Error {
  constructor(message: string, readonly service: TaskOwnedOllamaService) { super(message); }
}
/** Startup created an owned handle and teardown fulfilled. Unlike an ordinary
 * early startup error, this proves its exclusive log can safely be retained. */
export class OwnedServiceStartupStoppedFailure extends Error {
  constructor(error: unknown, readonly service: TaskOwnedOllamaService) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
  }
}
interface ProcessIdentity { pid: number; created: string }
async function processTree(pid: number, port: number): Promise<{ tree: ProcessIdentity[]; listener: number[] }> {
  const script = `$all=@(Get-CimInstance Win32_Process); $ids=@(${pid}); do { $old=$ids.Count; $ids+=@($all | Where-Object { $ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId } | ForEach-Object { $_.ProcessId }) } while ($ids.Count -gt $old); $tree=@($all | Where-Object { $ids -contains $_.ProcessId } | ForEach-Object { @{pid=[int]$_.ProcessId;created=$_.CreationDate.ToUniversalTime().ToString('o')} }); $listener=@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.OwningProcess }); @{tree=$tree;listener=$listener} | ConvertTo-Json -Compress -Depth 4`;
  const result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 5000, maxBuffer: 65536 });
  return JSON.parse(result.stdout);
}
/** Task-owned Ollama only. Tree termination + observed exit, not a Windows Job
 * Object or hard CPU/memory sandbox. Resource sampling can miss transient peaks.
 * Logs and identity tracking are private to the caller's OS-temp directory. */
export class TaskOwnedOllamaService {
  readonly endpoint: string;
  private readonly identities = new Map<number, string>();
  private stopped = false;
  private stopping?: Promise<void>;
  private wallTimer?: ReturnType<typeof setTimeout>;
  private monitorTimer?: ReturnType<typeof setTimeout>;
  private externalSignal?: AbortSignal;
  private externalAbort?: () => void;
  failure?: string;
  private constructor(private readonly child: ChildProcess, private readonly port: number, readonly envelope: LocalRunEnvelope, readonly modelsPath?: string) {
    this.endpoint = `http://127.0.0.1:${port}`;
  }
  static async start(directory: string, options: OwnedServiceOptions = {}): Promise<TaskOwnedOllamaService> {
    const envelope = fixedEnvelope(options.envelope === undefined ? LOCAL_RUN_ENVELOPE : options.envelope);
    if ((envelope === GRANITE_RUN_ENVELOPE || envelope === QWEN4B_RUN_ENVELOPE) && options.modelsPath === undefined)
      throw new Error('Pinned challenger requires an explicit task-owned OS-temp model store');
    const modelsPath = options.modelsPath === undefined ? undefined : isolatedModelsPath(directory, options.modelsPath);
    options.signal?.throwIfAborted();
    requireLocalResources(await readLocalResources(), envelope); // Before process creation or model load.
    options.signal?.throwIfAborted();
    const server = createServer();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Unable to reserve loopback port');
    const port = address.port;
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    options.signal?.throwIfAborted();
    const log = openSync(join(directory, 'ollama.log'), 'wx', 0o600);
    let child: ChildProcess;
    try {
      child = spawn('ollama.exe', ['serve'], { windowsHide: true, stdio: ['ignore', log, log], env: {
        ...process.env, OLLAMA_HOST: `127.0.0.1:${port}`, OLLAMA_NO_CLOUD: '1', OLLAMA_NOPRUNE: '1',
        OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_MAX_QUEUE: '1',
        OLLAMA_CONTEXT_LENGTH: String(envelope.contextTokens), OLLAMA_KEEP_ALIVE: '0', OLLAMA_LOAD_TIMEOUT: '60s',
        ...(modelsPath === undefined ? {} : { OLLAMA_MODELS: modelsPath }),
      } });
    } finally { closeSync(log); }
    const service = new TaskOwnedOllamaService(child, port, envelope, modelsPath);
    if (options.signal) {
      service.externalSignal = options.signal;
      service.externalAbort = () => { service.failure = 'external-run-abort'; void service.stop().catch(() => {}); };
      options.signal.addEventListener('abort', service.externalAbort, { once: true });
      if (options.signal.aborted) service.externalAbort();
    }
    let spawnError: Error | undefined;
    child.on('error', e => { spawnError = e; });
    try {
      const deadline = performance.now() + 15000;
      while (performance.now() < deadline) {
        options.signal?.throwIfAborted();
        if (spawnError) throw spawnError;
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) throw new Error('Owned Ollama exited during startup');
        const snapshot = await processTree(child.pid, port);
        options.signal?.throwIfAborted();
        if (spawnError) throw spawnError;
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('Owned Ollama exited during ownership verification');
        snapshot.tree.forEach(p => service.identities.set(p.pid, p.created));
        if (snapshot.listener.some(pid => pid !== child.pid)) throw new Error('Loopback listener is not the task-owned Ollama process');
        const remaining = Math.floor(deadline - performance.now());
        if (remaining <= 0) break;
        if (snapshot.listener.includes(child.pid)) {
          let response: Response | undefined;
          try {
            // Readiness only: a listening server may still be discovering GPUs.
            // Each probe stays inside the original startup budget; no model retry.
            const timeout = AbortSignal.timeout(Math.min(1000, remaining));
            response = await fetch(service.endpoint + '/api/version', { signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout, redirect: 'error' });
          } catch (error) {
            options.signal?.throwIfAborted();
            if (!(error instanceof TypeError) && !(error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError'))) throw error;
          }
          options.signal?.throwIfAborted();
          if (spawnError) throw spawnError;
          if (child.exitCode !== null || child.signalCode !== null) throw new Error('Owned Ollama exited during readiness verification');
          if (performance.now() >= deadline) break;
          if (response?.ok) { service.startMonitoring(); return service; }
        }
        const pause = Math.min(100, Math.floor(deadline - performance.now()));
        if (pause <= 0) break;
        await new Promise(resolve => setTimeout(resolve, pause));
      }
      throw new Error('Owned Ollama startup timeout');
    } catch (error) {
      try { await service.stop(); }
      catch (stopError) { throw new OwnedServiceStartupFailure(`Startup failed and owned teardown unconfirmed: ${String(error)}; ${String(stopError)}`, service); }
      throw new OwnedServiceStartupStoppedFailure(error, service);
    }
  }
  /** Fresh planning admission before each inference/model load; not an
   * allocation guarantee. Recheck lifecycle after the asynchronous sample. */
  async requireAdmission(): Promise<void> {
    this.requireRunning();
    const resources = await readLocalResources();
    this.requireRunning();
    requireLocalResources(resources, this.envelope);
  }
  private requireRunning(): void {
    if (this.failure || this.stopped || this.stopping || !this.child.pid || this.child.exitCode !== null || this.child.signalCode !== null)
      throw new Error(`Owned service admission blocked: ${this.failure ?? 'service stopped/stopping or exited'}`);
  }
  private startMonitoring(): void {
    this.wallTimer = setTimeout(() => { this.failure = 'run-wall-budget'; void this.stop().catch(() => {}); }, this.envelope.runWallMs);
    const sample = async () => {
      if (this.stopped || this.stopping) return;
      try {
        if (!this.child.pid) throw new Error('Owned service PID unavailable');
        const snapshot = await processTree(this.child.pid, this.port);
        const root = snapshot.tree.find(p => p.pid === this.child.pid);
        if (!root || root.created !== this.identities.get(root.pid)) throw new Error('Owned root process identity changed');
        snapshot.tree.forEach(p => { if (!this.identities.has(p.pid)) this.identities.set(p.pid, p.created); });
        if (snapshot.listener.some(pid => pid !== this.child.pid)) throw new Error('Owned service disappeared/listener ownership changed');
        const resources = await readLocalResources();
        if (resources.ramFreeBytes < this.envelope.stopRamFreeBytes || resources.gpuFreeBytes < this.envelope.stopGpuFreeBytes)
          throw new Error('Resource headroom stop');
      } catch (error) { this.failure = error instanceof Error ? error.message : 'Resource monitor failure'; await this.stop().catch(() => {}); return; }
      if (!this.stopping) this.monitorTimer = setTimeout(() => { void sample(); }, 1000);
    };
    this.monitorTimer = setTimeout(() => { void sample(); }, 1000);
  }
  stop(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.stopping) return this.stopping;
    this.stopping = this.stopTree().catch(error => { this.stopping = undefined; throw error; });
    return this.stopping;
  }
  private async stopTree(): Promise<void> {
    clearTimeout(this.wallTimer); clearTimeout(this.monitorTimer);
    if (this.externalSignal && this.externalAbort) this.externalSignal.removeEventListener('abort', this.externalAbort);
    if (!this.child.pid) {
      if (this.child.exitCode !== null) { this.stopped = true; return; }
      throw new Error('Cannot prove owned service stopped without PID');
    }
    // If startup failed before the first identity snapshot, no generation was
    // authorized. Stop via the owned handle BEFORE any fallible inspection.
    if (!this.identities.has(this.child.pid) && this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
    let snapshot: Awaited<ReturnType<typeof processTree>>;
    try { snapshot = await processTree(this.child.pid, this.port); }
    catch (error) {
      // Inspection failure cannot skip even the safe owned-root stop attempt.
      if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
      throw error; // Without inspection, descendants/exit remain unconfirmed.
    }
    const root = snapshot.tree.find(p => p.pid === this.child.pid);
    const rootOwned = root && root.created === this.identities.get(root.pid);
    if (rootOwned) {
      snapshot.tree.forEach(p => { if (!this.identities.has(p.pid)) this.identities.set(p.pid, p.created); });
      await exec('taskkill.exe', ['/PID', String(this.child.pid), '/T', '/F'], { timeout: 5000, maxBuffer: 65536 }).catch(() => {});
    }
    // Kill only retained matching identities if a runner was reparented before
    // root shutdown. Never overwrite an identity or kill a reused root PID.
    for (const [pid, created] of this.identities) {
      if (pid === this.child.pid) continue;
      const query = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${created}') { & taskkill.exe /PID ${pid} /T /F | Out-Null }`;
      await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { timeout: 5000, maxBuffer: 4096 });
    }
    // Deliberately never claim HTTP abort unloaded inference. Require observed
    // disappearance of each captured identity and of the owned listener.
    const deadline = performance.now() + 5000;
    do {
      const after = await processTree(this.child.pid, this.port);
      const same = after.tree.some(p => this.identities.get(p.pid) === p.created);
      // Captured runners may have been reparented; query their exact identities.
      const pids = [...this.identities.keys()];
      const query = `$ids=@(${pids.join(',')}); @(Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ProcessId } | ForEach-Object { @{pid=[int]$_.ProcessId;created=$_.CreationDate.ToUniversalTime().ToString('o')} }) | ConvertTo-Json -Compress`;
      const result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { timeout: 5000, maxBuffer: 65536 });
      const parsed: ProcessIdentity[] | ProcessIdentity | null = result.stdout.trim() ? JSON.parse(result.stdout) : null;
      const remaining = (parsed ? Array.isArray(parsed) ? parsed : [parsed] : []).some(p => this.identities.get(p.pid) === p.created);
      if (!same && !remaining && after.listener.length === 0 && (this.child.exitCode !== null || this.child.signalCode !== null)) { this.stopped = true; return; }
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (performance.now() < deadline);
    throw new Error('Owned process-tree teardown not confirmed; do not reuse inference');
  }
}
