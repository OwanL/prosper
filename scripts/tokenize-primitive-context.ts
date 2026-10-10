/** Offline sizing only. No Ollama HTTP, service, weights download or generation.
 * Default: preflight/installed small metadata. --run: acquire ONLY pinned CPU ZIP
 * into OS temp, capture public development requests, vocabulary-only tokenization.
 * Prints JSON evidence; removes its known tokenizer directory. A runner rejection
 * before returning its temporary path leaves episode cleanup uncertain. */
import { spawn, execFile } from 'node:child_process';
import { createReadStream, createWriteStream, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, Readable } from 'node:stream';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  CPU_TOKENIZER, QWEN_INSTALLED, SIZING_LIMITS, capturePrimitiveRequests, sha256,
  parseTokenIds, renderQwen35NoThink, requestEvidence, sizingHeartbeatExpired, sizingStopReason, tokenizerArgs,
  type ResourceSample,
} from '../src/evaluation/tokenization.ts';

const exec = promisify(execFile);
const ps = (command: string) => exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
  windowsHide: true, timeout: 10_000, maxBuffer: 65_536,
});
const OS_SAMPLE = '$o=Get-CimInstance Win32_OperatingSystem; $free=[long]$o.FreePhysicalMemory*1024;';
export async function freeRam(): Promise<ResourceSample> {
  const { stdout } = await ps(OS_SAMPLE + '[pscustomobject]@{freeBytes=$free}|ConvertTo-Json -Compress');
  return JSON.parse(stdout);
}
export async function sizingPreflight(): Promise<ResourceSample> {
  const sample = await freeRam();
  const reason = sizingStopReason(sample, true);
  if (reason) throw new Error(`${reason}; freeBytes=${sample.freeBytes}`);
  return sample;
}
async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024 })) hash.update(chunk);
  return hash.digest('hex');
}
function installedMetadata() {
  // Exact known locations only. No directory traversal or durable Prosper access.
  const models = join(homedir(), '.ollama', 'models');
  const manifestPath = join(models, 'manifests', 'registry.ollama.ai', 'library', 'qwen3.5', '9b');
  const configPath = join(models, 'blobs', `sha256-${QWEN_INSTALLED.configSha256}`);
  const readSmall = (path: string) => {
    if (statSync(path).size > 65_536) throw new Error('Installed metadata unexpectedly large');
    return readFileSync(path);
  };
  const manifestBytes = readSmall(manifestPath);
  const configBytes = readSmall(configPath);
  if (sha256(manifestBytes) !== QWEN_INSTALLED.manifestSha256 || sha256(configBytes) !== QWEN_INSTALLED.configSha256)
    throw new Error('Installed manifest/config identity changed');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const config = JSON.parse(configBytes.toString('utf8'));
  const model = manifest.layers.find((layer: { mediaType: string }) => layer.mediaType === 'application/vnd.ollama.image.model');
  if (model?.digest !== `sha256:${QWEN_INSTALLED.ggufSha256}` || model?.size !== QWEN_INSTALLED.ggufBytes ||
      config.renderer !== 'qwen3.5' || config.model_family !== 'qwen35' ||
      manifest.layers.some((layer: { mediaType: string }) => ![
        'application/vnd.ollama.image.model', 'application/vnd.ollama.image.license', 'application/vnd.ollama.image.params',
      ].includes(layer.mediaType))) throw new Error('Unsupported renderer or embedded prompt/template/messages');
  const ggufPath = join(models, 'blobs', `sha256-${QWEN_INSTALLED.ggufSha256}`);
  if (statSync(ggufPath).size !== QWEN_INSTALLED.ggufBytes) throw new Error('Installed GGUF size changed');
  return { manifestPath, configPath, ggufPath, renderer: config.renderer,
    manifestSha256: sha256(manifestBytes), configSha256: sha256(configBytes),
    ggufSha256: QWEN_INSTALLED.ggufSha256, ggufBytes: QWEN_INSTALLED.ggufBytes,
    ggufDigestVerified: false, noEmbeddedMessagesOrSystem: true };
}

async function acquireCPU(directory: string, recordDownload: (bytes: number) => void) {
  await sizingPreflight();
  const archive = join(directory, CPU_TOKENIZER.archive);
  const response = await fetch(CPU_TOKENIZER.url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error('Pinned CPU acquisition failed');
  let bytes = 0;
  const hash = createHash('sha256');
  const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length; recordDownload(bytes);
    if (bytes > CPU_TOKENIZER.bytes) { callback(new Error('CPU archive exceeds published size')); return; }
    hash.update(chunk); callback(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), bound, createWriteStream(archive));
  const digest = hash.digest('hex');
  if (bytes !== CPU_TOKENIZER.bytes || digest !== CPU_TOKENIZER.sha256) throw new Error('Pinned CPU archive size/SHA mismatch');
  await sizingPreflight();
  const extracted = join(directory, 'cpu');
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  await ps(`Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(extracted)}`);
  const executable = join(extracted, 'llama-tokenize.exe');
  if (!statSync(executable).isFile()) throw new Error('Pinned CPU archive has no root llama-tokenize.exe');
  const { stdout, stderr } = await exec(executable, ['--version'], { windowsHide: true, timeout: 5000, maxBuffer: 65_536 });
  const version = stdout + stderr;
  if (!version.includes('11490') || !version.includes(CPU_TOKENIZER.commit.slice(0, 7))) throw new Error('Tokenizer build identity mismatch');
  return { executable, archiveBytes: bytes, archiveSha256: digest, executableSha256: await fileHash(executable), version };
}

/** Cooperative sampled stop, not an OS memory sandbox. Standalone CPU tokenizer
 * creates no service/children. Kill and await ONLY this task's child on any stop. */
export async function tokenizeMonitored(executable: string, gguf: string, prompt: string) {
  const initial = await sizingPreflight();
  const child = spawn(executable, tokenizerArgs(gguf, prompt), {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    // CPU archive only. Do not consult shared installed backend/plugin locations.
    cwd: resolve(executable, '..'), env: { ...process.env, GGML_BACKEND_PATH: resolve(executable, '..') },
  });
  let stdout = '', stderr = '', stopped: string | undefined;
  let closed = false, monitorClosed = false;
  const samples: ResourceSample[] = [initial];
  const stop = (reason: string) => { stopped ??= reason; if (!closed) child.kill(); };
  const exited = new Promise<void>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', code => { closed = true; code === 0 ? resolveExit() : reject(new Error(stopped ?? `Tokenizer exited ${code}`)); });
  });
  // Prevent a rejected process promise going unhandled while sampler starts.
  void exited.catch(() => {});
  const monitor = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference="Stop"; while($true){' + OS_SAMPLE +
    '$p=Get-Process -Id ([int]$env:PROSPER_TOKENIZER_PID) -ErrorAction SilentlyContinue; if(!$p){break};' +
    '[pscustomobject]@{freeBytes=$free;workingSetBytes=[long]$p.WorkingSet64;privateBytes=[long]$p.PrivateMemorySize64;peakWorkingSetBytes=[long]$p.PeakWorkingSet64}|ConvertTo-Json -Compress; Start-Sleep -Milliseconds 250}'
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PROSPER_TOKENIZER_PID: String(child.pid) } });
  const monitorExit = new Promise<void>(resolveExit => monitor.once('close', () => { monitorClosed = true; resolveExit(); }));
  monitor.once('error', () => stop('Resource sampler failed to start'));
  let lines = '', lastSampleAt: number | undefined;
  monitor.stdout.on('data', (chunk: Buffer) => {
    lines += chunk.toString('utf8');
    if (lines.length > 65_536) { stop('Resource sampler output exceeded limit'); return; }
    for (;;) {
      const end = lines.indexOf('\n'); if (end < 0) break;
      const line = lines.slice(0, end).trim(); lines = lines.slice(end + 1);
      try { const sample: ResourceSample = JSON.parse(line); samples.push(sample); const reason = sizingStopReason(sample);
        if (reason) stop(reason); else lastSampleAt = performance.now(); }
      catch { stop('Invalid resource sampler output'); }
    }
  });
  monitor.stderr.on('data', () => stop('Resource sampler error'));
  monitor.once('close', code => { if (code !== 0 && !closed) stop('Resource sampler stopped unexpectedly'); });
  const collect = (key: 'stdout' | 'stderr', chunk: Buffer) => {
    if (key === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
    if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 4 * 1024 ** 2) stop('Tokenizer output exceeded 4 MiB');
    if (/load_tensors:|offloading|KV buffer|compute buffer|llama_decode/i.test(stderr)) stop('Unexpected tensor/context initialization');
  };
  child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk));
  child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk));
  const timeout = setTimeout(() => stop('Tokenizer exceeded 30-second deadline'), SIZING_LIMITS.timeoutMs);
  const watchdog = setInterval(() => {
    if (!closed && (monitorClosed || sizingHeartbeatExpired(started, lastSampleAt, performance.now()))) stop('No live resource samples');
  }, 250);
  const started = performance.now();
  try {
    await exited;
    if (stopped) throw new Error(stopped);
    // Fast exit before the sampler saw a process is NOT a measured safe run.
    if (samples.length < 2) throw new Error('Tokenizer finished before resource monitoring; no measured result retained');
    const ids = parseTokenIds(stdout, stderr);
    return { count: ids.length, tokenIdsSha256: sha256(JSON.stringify(ids)),
      stderrSha256: sha256(stderr), vocabularyOnlyProof: true,
      elapsedMs: performance.now() - started, resourceSamples: samples.length - 1,
      minimumFreeBytes: Math.min(...samples.map(s => s.freeBytes)),
      peakWorkingSetBytes: Math.max(...samples.map(s => s.peakWorkingSetBytes ?? s.workingSetBytes ?? 0)),
      peakPrivateBytes: Math.max(...samples.map(s => s.privateBytes ?? 0)) };
  } finally {
    clearTimeout(timeout); clearInterval(watchdog);
    if (!closed) { child.kill(); await exited.catch(() => {}); }
    if (!monitorClosed) monitor.kill();
    await monitorExit;
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (process.platform !== 'win32') throw new Error('This probe is pinned to Windows CPU x64');
  if (args.some(arg => arg !== '--run')) throw new Error('Only optional --run is supported; no resource-limit overrides');
  const initial = await freeRam();
  const identity = installedMetadata();
  const report: Record<string, unknown> = { mode: args.includes('--run') ? 'run' : 'preflight-only', initial,
    sizingLimits: SIZING_LIMITS, installed: identity, acquiredBytes: 0, measuredRequests: [],
    ollamaCountVerified: false, inferenceCalls: 0, servicesStarted: 0, episodeCleanupUncertain: false };
  const reason = sizingStopReason(initial, true);
  if (reason || !args.includes('--run')) {
    console.log(JSON.stringify({ ...report, status: reason ? 'blocked' : 'ready-not-run', blocker: reason ?? null }, null, 2));
    if (reason) process.exitCode = 2;
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), 'prosper-primitive-tokenizer-'));
  try {
    const runtime = await acquireCPU(directory, bytes => { report.downloadedBytes = bytes; });
    report.acquiredBytes = runtime.archiveBytes; report.runtime = runtime;
    await sizingPreflight();
    if (await fileHash(identity.ggufPath) !== QWEN_INSTALLED.ggufSha256) throw new Error('Installed GGUF full digest mismatch');
    identity.ggufDigestVerified = true;
    // Existing tsx registration occurs only after admission. Native Node default
    // preflight imports no world graph or compiler. No package acquisition.
    const { register } = await import('tsx/esm/api');
    const unregister = register();
    const results: unknown[] = [];
    report.measuredRequests = results; // Retain earlier valid measurements if a later request stops.
    try {
      for (const smallHistory of [false, true]) {
        await sizingPreflight();
        report.episodeCleanupUncertain = true;
        const captured = await capturePrimitiveRequests(smallHistory);
        report.episodeCleanupUncertain = false;
        for (let i = 0; i < captured.requests.length; i++) {
          const request = captured.requests[i];
          const file = join(directory, `${captured.lane}-${i + 1}.txt`);
          writeFileSync(file, renderQwen35NoThink(request.messages), 'utf8');
          const tokens = await tokenizeMonitored(runtime.executable, identity.ggufPath, file);
          results.push({ lane: captured.lane, turn: i + 1, ...requestEvidence(request), ...tokens,
            portedRenderedInputPlusOutput: tokens.count + request.maxOutputTokens,
            // No assertion of backend additions or generation prompt_eval_count identity.
            interpretation: 'Exact b11490 vocabulary-only count of the source-ported rendered bytes; Ollama runtime equivalence unverified' });
        }
      }
    } finally { await unregister(); }
    report.status = 'measured-ported-render-only';
    report.blocker = 'No installed Ollama renderer/tokenizer differential or generation-side special-token reconciliation; do not lower native reservation';
  } catch (error) { report.status = 'blocked'; report.blocker = String(error); process.exitCode = 2; }
  finally { rmSync(directory, { recursive: true, force: true }); report.knownTokenizerDirectoryRemoved = true; }
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(error => { console.error(String(error)); process.exitCode = 2; });
}
