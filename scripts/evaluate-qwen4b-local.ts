import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, copyFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { developmentFixture } from '../src/evaluation/fixtures.ts';
import { runEpisode, replayEpisode } from '../src/evaluation/runner.ts';
import { createLocalModelCandidate } from '../src/evaluation/candidates/local-model.ts';
import { OllamaTransport } from '../src/evaluation/candidates/ollama-transport.ts';
import { QWEN4B_RUN_ENVELOPE as E, readLocalResources, requireLocalResources, TaskOwnedOllamaService, OwnedServiceStartupFailure, OwnedServiceStartupStoppedFailure } from '../src/evaluation/local-service.ts';
import { QWEN4B_MODEL, QWEN4B_BLOBS, QWEN4B_DIGEST, prepareQwen4b, verifyQwen4bStore } from '../src/evaluation/qwen4b.ts';

export const QWEN4B_CALL_SPLIT = Object.freeze([1, 2] as const);
export const QWEN4B_LOCAL_CONFIG = Object.freeze({ model: QWEN4B_MODEL, maxPromptBytes: 80000,
  maxInputTokens: E.maxInputTokens, maxOutputTokens: E.maxOutputTokens, history: Object.freeze({ maxEntries: 4, maxBytes: 32000 }) });
export interface Qwen4bOptions { mode: 'offline' | 'prepare' | 'confirm'; artifactDirectory?: string }
export function parseQwen4bArgs(args: readonly string[]): Qwen4bOptions {
  if (!args.length) return { mode: 'offline' };
  const flag = args[0];
  if (flag !== '--prepare-only' && flag !== '--confirm-qwen4b-local') throw new Error('Only --prepare-only or --confirm-qwen4b-local [--artifact-dir PATH] supported');
  const mode = flag === '--prepare-only' ? 'prepare' : 'confirm';
  if (args.length === 1 && mode === 'prepare') return { mode };
  if (args.length !== 3 || args[1] !== '--artifact-dir' || !args[2]?.trim() || args[2].startsWith('--'))
    throw new Error('Explicit --artifact-dir PATH required for confirmation; no extra flags');
  return { mode, artifactDirectory: args[2] };
}
/** Preparation is explicit and separate from inference. Reusable verified stores
 * and failure evidence are never deleted by this runner. No sealed fixtures. */
export async function evaluateQwen4bLocal(options: Qwen4bOptions = { mode: 'offline' }): Promise<void> {
  if (options.mode === 'offline') {
    console.log(JSON.stringify({ kind: 'offline-qwen4b-plan', blobs: QWEN4B_BLOBS, manifestSha256: QWEN4B_DIGEST,
      envelope: E, config: QWEN4B_LOCAL_CONFIG, calls: 0, prepare: '--prepare-only', confirm: '--confirm-qwen4b-local --artifact-dir PATH' }));
    return;
  }
  if (options.mode === 'prepare') { console.log(JSON.stringify({ kind: 'prepared-qwen4b', ...await prepareQwen4b(options.artifactDirectory) })); return; }
  if (options.mode !== 'confirm' || !options.artifactDirectory) throw new Error('Confirmation requires a prepared artifact directory');
  // Admission before full-weight disk verification; confirmation never fetches.
  requireLocalResources(await readLocalResources(), E);
  const metadata = await verifyQwen4bStore(options.artifactDirectory, AbortSignal.timeout(180000));
  const evidence = mkdtempSync(join(tmpdir(), 'prosper-qwen4b-evidence-'));
  const events: unknown[] = []; let service: TaskOwnedOllamaService | undefined; let serviceLogEvidence: string | undefined; let calls = 0;
  const stopAndRetainLog = async () => {
    await service!.stop(); // Never free the exclusive log path until teardown is confirmed.
    service = undefined;
    renameSync(join(metadata.directory, 'ollama.log'), serviceLogEvidence!);
  };
  const record = (event: unknown) => { events.push(event); writeFileSync(join(evidence, 'probe.json'), JSON.stringify(events, null, 2), { mode: 0o600 }); console.log(JSON.stringify(event)); };
  record({ kind: 'identity', metadata, envelope: E, config: QWEN4B_LOCAL_CONFIG, evidence,
    containment: 'cooperative owned process tree, no hard resource sandbox' });
  const started = performance.now(); const runSignal = AbortSignal.timeout(E.runWallMs);
  try {
    for (const [index, family] of (['buy-meal', 'sell-buy-meal'] as const).entries()) {
      runSignal.throwIfAborted();
      requireLocalResources(await readLocalResources(), E);
      serviceLogEvidence = join(mkdtempSync(join(evidence, `${family}-service-`)), 'ollama.log');
      try { service = await TaskOwnedOllamaService.start(metadata.directory, { envelope: E, modelsPath: metadata.modelsPath, signal: runSignal }); }
      catch (error) {
        if (error instanceof OwnedServiceStartupStoppedFailure)
          renameSync(join(metadata.directory, 'ollama.log'), serviceLogEvidence);
        else if (error instanceof OwnedServiceStartupFailure) service = error.service;
        // Other startup errors expose no handle/proof of teardown. Preserve the
        // original log rather than mistaking an existing wx guard for our log.
        throw error;
      }
      const transport = new OllamaTransport({ endpoint: service.endpoint, model: QWEN4B_MODEL, digest: metadata.digest,
        size: metadata.size, contextTokens: E.contextTokens, qwen4b: metadata }, service);
      const fixture = developmentFixture(family);
      const allowance = QWEN4B_CALL_SPLIT[index]!;
      const left = E.runWallMs - (performance.now() - started);
      if (left <= 0 || calls + allowance > E.maxCalls) throw new Error('Public probe wall/call budget exhausted');
      let report: Awaited<ReturnType<typeof runEpisode>>;
      try {
        report = await runEpisode(fixture, () => createLocalModelCandidate({ endpoint: service!.endpoint, ...QWEN4B_LOCAL_CONFIG }, transport), {
          limits: { decisionTimeoutMs: E.decisionMs, episodeTimeoutMs: Math.min(120000, Math.floor(left)), teardownTimeoutMs: E.teardownMs,
            maxDecisions: fixture.horizon, maxModelCalls: allowance, maxTokens: allowance * (E.maxInputTokens + E.maxOutputTokens),
            maxModelCallsPerDecision: 1, maxTokensPerDecision: E.maxInputTokens + E.maxOutputTokens },
        });
      } catch (error) {
        record({ kind: 'episode-failure', family, rawReplies: transport.getReplyAudits(), serviceFailure: service.failure, reason: String(error) }); throw error;
      }
      calls += report.usage.modelCalls;
      // Raw failures and original output location survive even retention/replay failure.
      record({ kind: 'raw-episode', family, report, rawReplies: transport.getReplyAudits(), serviceFailure: service.failure });
      const retained = join(evidence, 'prosper-evaluation-' + family); mkdirSync(retained);
      const files = ['initialization.json', 'trace.jsonl', 'report.json'];
      if (files.reduce((sum, file) => sum + statSync(join(report.outputDirectory, file)).size, 0) > 32 * 1024 ** 2) throw new Error('Trace retention byte ceiling');
      const hashes: Record<string, string> = {};
      for (const file of files) { const source = join(report.outputDirectory, file); copyFileSync(source, join(retained, file)); hashes[file] = createHash('sha256').update(readFileSync(source)).digest('hex'); }
      record({ kind: 'episode', family, report: { ...report, outputDirectory: retained }, hashes });
      try { record({ kind: 'replay-success', family, replay: replayEpisode(retained) }); }
      catch (error) { record({ kind: 'replay-failure', family, reason: String(error) }); throw error; }
      if (!report.accountingValid || report.reason.startsWith('unsafe')) throw new Error('Unsafe/invalid public probe accounting');
      await stopAndRetainLog();
    }
    record({ kind: 'probe-complete', calls, interpretation: 'Two public probes only; no held-out or strategic intelligence claim' });
  } catch (error) { record({ kind: 'probe-blocked-or-failed', calls, reason: String(error) }); throw error; }
  finally {
    if (service) {
      try { await stopAndRetainLog(); }
      catch (error) { record({ kind: 'unconfirmed-owned-teardown', evidence, reason: String(error) }); throw error; }
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { evaluateQwen4bLocal(parseQwen4bArgs(process.argv.slice(2))).catch(error => { console.error(String(error)); process.exitCode = 1; }); }
  catch (error) { console.error(String(error)); process.exitCode = 1; }
}
