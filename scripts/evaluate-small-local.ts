import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, statSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { developmentFixture } from '../src/evaluation/fixtures.ts';
import { runEpisode, replayEpisode } from '../src/evaluation/runner.ts';
import { createLocalModelCandidate } from '../src/evaluation/candidates/local-model.ts';
import { OllamaTransport } from '../src/evaluation/candidates/ollama-transport.ts';
import { GRANITE_RUN_ENVELOPE as E, readLocalResources, requireLocalResources, TaskOwnedOllamaService, OwnedServiceStartupFailure } from '../src/evaluation/local-service.ts';
import { GRANITE_ARTIFACT, GRANITE_MODEL, GRANITE_TEMPLATE_SHA256, acquireGranite, inspectGranite, importGranite } from '../src/evaluation/small-model.ts';

export const SMALL_LOCAL_CALL_SPLIT = Object.freeze([1, 2] as const);
export const SMALL_LOCAL_CONFIG = Object.freeze({ model: GRANITE_MODEL, maxPromptBytes: 110000,
  maxInputTokens: E.maxInputTokens, maxOutputTokens: E.maxOutputTokens, history: Object.freeze({ maxEntries: 4, maxBytes: 32000 }) });
/** Offline default constructs no fixtures and opens no network/service. Parent
 * owns explicit execution. Retained evidence is public development only. */
export async function evaluateSmallLocal(confirm = false): Promise<void> {
  if (!confirm) {
    console.log(JSON.stringify({ kind: 'offline-small-local-plan', artifact: GRANITE_ARTIFACT, envelope: E, config: SMALL_LOCAL_CONFIG,
      optIn: '--confirm-small-local', calls: 0, note: 'No download, service or inference. Two public fixtures; no sealed evaluation.' }));
    return;
  }
  requireLocalResources(await readLocalResources(), E);
  const directory = mkdtempSync(join(tmpdir(), 'prosper-granite-probe-'));
  const evidence = mkdtempSync(join(tmpdir(), 'prosper-granite-evidence-'));
  const events: unknown[] = []; let service: TaskOwnedOllamaService | undefined; let calls = 0; let stopped = true;
  const record = (event: unknown) => { events.push(event); writeFileSync(join(evidence, 'probe.json'), JSON.stringify(events, null, 2), { mode: 0o600 }); console.log(JSON.stringify(event)); };
  record({ kind: 'identity', artifact: GRANITE_ARTIFACT, envelope: E, config: SMALL_LOCAL_CONFIG, templateSha256: GRANITE_TEMPLATE_SHA256,
    containment: 'cooperative-owned-process-tree; no hard RAM/VRAM/CPU containment', evidence });
  try {
    // Acquisition deadline separate from the 5-minute service/inference wall cap.
    const artifact = await acquireGranite(directory, AbortSignal.timeout(30 * 60 * 1000));
    const metadata = await inspectGranite(artifact, AbortSignal.timeout(180000));
    record({ kind: 'verified-artifact-metadata', metadata });
    const started = performance.now();
    // One deadline covers both service startups, imports and generations.
    // External abort stops whichever owned service is active, including startup.
    const runSignal = AbortSignal.timeout(E.runWallMs);
    for (const [index, family] of (['buy-meal', 'sell-buy-meal'] as const).entries()) {
      const remaining = E.runWallMs - (performance.now() - started);
      if (remaining <= 0 || calls >= E.maxCalls) throw new Error('Public probe wall/call budget exhausted');
      requireLocalResources(await readLocalResources(), E);
      const serviceDirectory = mkdtempSync(join(directory, 'service-'));
      // One distinct directory per lifecycle with a child store, never shared.
      const store = join(serviceDirectory, 'models'); mkdirSync(store);
      runSignal.throwIfAborted();
      try { service = await TaskOwnedOllamaService.start(serviceDirectory, { envelope: E, modelsPath: store, signal: runSignal }); }
      catch (error) { if (error instanceof OwnedServiceStartupFailure) { service = error.service; stopped = false; } throw error; }
      stopped = false;
      // Reimport the same locally verified GGUF into each new service/store.
      // This is not another acquisition, model selection or inference retry.
      const importRemaining = E.runWallMs - (performance.now() - started);
      if (importRemaining <= 0) throw new Error('Public probe wall budget exhausted before import');
      const installed = await importGranite(service, store, artifact, metadata,
        AbortSignal.any([runSignal, AbortSignal.timeout(Math.min(120000, Math.floor(importRemaining)))]));
      const transport = new OllamaTransport({ endpoint: service.endpoint, model: GRANITE_MODEL, ...installed,
        contextTokens: E.contextTokens, granite: metadata }, service);
      record({ kind: 'candidate-identity', family, installed, transport: transport.identity });
      const fixture = developmentFixture(family);
      // Fixed split: one call for horizon-one buy; two for horizon-two sell/buy.
      // Unused allowance never becomes retries or a supplied reference strategy.
      const allowance = Math.min(SMALL_LOCAL_CALL_SPLIT[index]!, E.maxCalls - calls);
      const left = E.runWallMs - (performance.now() - started); if (left <= 0) throw new Error('Public probe wall budget exhausted');
      const report = await runEpisode(fixture, () => createLocalModelCandidate({ endpoint: service!.endpoint, ...SMALL_LOCAL_CONFIG }, transport), {
        limits: { decisionTimeoutMs: E.decisionMs, episodeTimeoutMs: Math.min(120000, Math.floor(left)), teardownTimeoutMs: E.teardownMs,
          maxDecisions: fixture.horizon, maxModelCalls: allowance, maxTokens: allowance * (E.maxInputTokens + E.maxOutputTokens),
          maxModelCallsPerDecision: 1, maxTokensPerDecision: E.maxInputTokens + E.maxOutputTokens },
      });
      calls += report.usage.modelCalls;
      let auditRetained = false;
      try {
        // Retain bounded audits and raw replies BEFORE fallible replay/accounting.
        try {
          const retained = join(evidence, family); mkdirSync(retained);
          const files = ['initialization.json', 'trace.jsonl', 'report.json'];
          let bytes = 0; for (const file of files) bytes += statSync(join(report.outputDirectory, file)).size;
          if (bytes > 32 * 1024 ** 2) throw new Error('Public trace retention byte ceiling exceeded');
          const hashes: Record<string, string> = {};
          for (const file of files) { const source = join(report.outputDirectory, file); copyFileSync(source, join(retained, file)); hashes[file] = createHash('sha256').update(readFileSync(source)).digest('hex'); }
          record({ kind: 'episode', family, report: { ...report, outputDirectory: retained }, hashes,
            rawReplies: transport.getReplyAudits(), serviceFailure: service.failure });
          auditRetained = true;
        } catch (error) {
          const failure = { kind: 'retention-failure', family, originalOutputDirectory: report.outputDirectory,
            report, rawReplies: transport.getReplyAudits(), serviceFailure: service.failure, reason: String(error) };
          try { record(failure); }
          catch (recordError) { console.error(JSON.stringify({ ...failure, evidenceRecordFailure: String(recordError) })); }
          throw error; // Keep the original trajectory if retention failed.
        }
        try {
          const replay = replayEpisode(report.outputDirectory);
          record({ kind: 'replay-success', family, replay });
        } catch (error) {
          record({ kind: 'replay-failure', family, reason: String(error) });
          throw error;
        }
        if (!report.accountingValid || report.reason.startsWith('unsafe')) throw new Error('Unsafe/invalid public probe accounting');
      } finally { if (auditRetained) rmSync(report.outputDirectory, { recursive: true, force: true }); }
      await service.stop(); stopped = true; service = undefined;
    }
    record({ kind: 'probe-complete', calls, interpretation: 'Two public development fixtures, at most three attempts. No sealed-suite or strategic-intelligence claim.' });
  } catch (error) { record({ kind: 'probe-blocked-or-failed', calls, reason: String(error) }); throw error; }
  finally {
    if (service) {
      try { await service.stop(); stopped = true; }
      catch (error) { record({ kind: 'unconfirmed-owned-teardown', temporaryLogs: directory, reason: String(error) }); throw error; }
    }
    if (stopped) rmSync(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 1 && args[0] === '--confirm-small-local')) { console.error('Only --confirm-small-local is supported'); process.exitCode = 1; }
  else evaluateSmallLocal(args.length === 1).catch(error => { console.error(String(error)); process.exitCode = 1; });
}
