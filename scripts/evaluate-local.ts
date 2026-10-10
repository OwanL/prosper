import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { developmentFixture } from '../src/evaluation/fixtures.ts';
import { runEpisode, replayEpisode } from '../src/evaluation/runner.ts';
import { createNoCommandCandidate } from '../src/evaluation/candidates/no-command.ts';
import { createLocalModelCandidate } from '../src/evaluation/candidates/local-model.ts';
import { OllamaTransport } from '../src/evaluation/candidates/ollama-transport.ts';
import { developmentReference } from '../src/evaluation/reference.ts';
import { LOCAL_RUN_ENVELOPE as E, readLocalResources, requireLocalResources, TaskOwnedOllamaService, OwnedServiceStartupFailure } from '../src/evaluation/local-service.ts';
import type { CandidateFactory } from '../src/evaluation/contracts.ts';

/** Explicit opt-in only. No retention, downloads, production runtime or fallback. */
export async function evaluateLocal(confirm: boolean): Promise<void> {
  if (!confirm) throw new Error('Pass --confirm-local for the bounded installed qwen3.5:9b development probe');
  const started = performance.now();
  const resources = await readLocalResources();
  console.log(JSON.stringify({ kind: 'preflight', resources, envelope: E, containment: 'cooperative-owned-process-tree; memory/CPU not hard-enforced' }));
  requireLocalResources(resources); // A failed gate never starts a service or sends a generation request.
  const directory = mkdtempSync(join(tmpdir(), 'prosper-local-development-'));
  let service: TaskOwnedOllamaService | undefined;
  let calls = 0;
  let stopped = true;
  try {
    for (const family of ['buy-meal', 'sell-buy-meal'] as const) {
      const fixture = developmentFixture(family);
      const run = async (label: string, factory: CandidateFactory, live = false) => {
        const remaining = E.runWallMs - (performance.now() - started);
        if (remaining <= 0) throw new Error('Development probe wall budget exhausted');
        const report = await runEpisode(fixture, factory, live ? { limits: {
          decisionTimeoutMs: E.decisionMs, episodeTimeoutMs: Math.min(120000, Math.floor(remaining)), teardownTimeoutMs: E.teardownMs,
          maxDecisions: fixture.horizon, maxModelCalls: Math.min(fixture.horizon, E.maxCalls - calls),
          maxTokens: Math.min(fixture.horizon, E.maxCalls - calls) * (E.maxInputTokens + E.maxOutputTokens),
          maxModelCallsPerDecision: 1, maxTokensPerDecision: E.maxInputTokens + E.maxOutputTokens,
        } } : {});
        try {
          const replay = replayEpisode(report.outputDirectory);
          const trace = readFileSync(join(report.outputDirectory, 'trace.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
          const decisions = trace.filter(r => r.kind === 'decision' || r.kind === 'candidate-failure').map(r => ({
            tick: r.commit.tick, decision: r.commit.decision, failure: r.commit.failure,
            knownResult: r.commit.knownResult, dispatchResult: r.commit.dispatchResult, usage: r.usage,
          }));
          if (live) calls += report.usage.modelCalls;
          console.log(JSON.stringify({ kind: 'episode', family, candidate: label, status: report.status, reason: report.reason,
            success: report.success, ticks: report.ticks, failures: report.failures, actor: report.outcome.actor,
            usage: report.usage, costs: report.costs, decisions, replay, serviceFailure: service?.failure }));
          if (report.status !== 'complete' || !report.accountingValid) throw new Error(`${label} stopped: ${report.reason}`);
        } finally { rmSync(report.outputDirectory, { recursive: true, force: true }); }
      };
      await run('no-command', createNoCommandCandidate);
      await run('privileged-authored-development-reference', developmentReference(family));
      requireLocalResources(await readLocalResources());
      try { service = await TaskOwnedOllamaService.start(mkdtempSync(join(directory, 'service-'))); }
      catch (error) {
        if (error instanceof OwnedServiceStartupFailure) { service = error.service; stopped = false; }
        throw error;
      }
      stopped = false;
      try {
        const response = await fetch(service.endpoint + '/api/tags', { signal: AbortSignal.timeout(2500), redirect: 'error' });
        if (!response.ok) throw new Error('Installed model catalog unavailable');
        const tags = await response.json() as { models?: { name: string; digest: string; size: number }[] };
        const installed = tags.models?.find(m => m.name === 'qwen3.5:9b');
        if (!installed) throw new Error('Exact installed qwen3.5:9b unavailable; no download/fallback');
        const transport = new OllamaTransport({ endpoint: service.endpoint, model: 'qwen3.5:9b', digest: installed.digest,
          size: installed.size, contextTokens: E.contextTokens }, service);
        console.log(JSON.stringify({ kind: 'candidate-identity', model: installed, transport: transport.identity }));
        await run('qwen3.5:9b-direct-primitives', () => createLocalModelCandidate({ endpoint: service!.endpoint,
          model: 'qwen3.5:9b', maxPromptBytes: 52000, maxInputTokens: E.maxInputTokens, maxOutputTokens: E.maxOutputTokens,
          history: { maxEntries: 1, maxBytes: 1024 },
        }, transport), true);
      } finally { await service.stop(); stopped = true; service = undefined; }
    }
    console.log(JSON.stringify({ kind: 'probe-complete', calls, wallMs: performance.now() - started,
      interpretation: 'Two authored development fixtures only; no sealed evaluation, strategic capability or population claim.' }));
  } finally {
    if (service) {
      try { await service.stop(); stopped = true; }
      catch (error) {
        console.error(JSON.stringify({ kind: 'unconfirmed-owned-teardown', temporaryLogs: directory, reason: String(error) }));
        throw error;
      }
    }
    // Failed teardown retains its uniquely owned logs for immediate diagnosis,
    // not a success/cleanup claim. This is the only unresolved-failure exception.
    if (stopped) rmSync(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  evaluateLocal(process.argv.slice(2).length === 1 && process.argv[2] === '--confirm-local').catch(error => {
    console.error(JSON.stringify({ kind: 'probe-blocked-or-failed', reason: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
