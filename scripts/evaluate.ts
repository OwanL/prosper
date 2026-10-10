import { rmSync } from 'node:fs';
import { developmentFixture } from '../src/evaluation/fixtures.ts';
import { developmentReference } from '../src/evaluation/reference.ts';
import { createNoCommandCandidate } from '../src/evaluation/candidates/index.ts';
import { replayEpisode, runEpisode } from '../src/evaluation/runner.ts';

// Deliberately offline: no server/provider/model flag or durable-data bootstrap.
const args = process.argv.slice(2);
const supported = new Set(['fixture', 'seed', 'horizon', 'cadence', 'decision-timeout-ms', 'episode-timeout-ms', 'max-decisions']);
const values = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  const key = args[i]?.replace(/^--/, ''); const value = args[i + 1];
  if (!args[i]?.startsWith('--') || !supported.has(key) || !value || values.has(key)) throw new Error('Unknown/missing/duplicate option. See docs/research/evaluation-harness-usage.md');
  values.set(key, value);
}
function integer(key: string, fallback: number, minimum = 1): number {
  const value = Number(values.get(key) ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid --${key}`);
  return value;
}
const selected = values.get('fixture') ?? 'both';
if (!['both', 'buy-meal', 'sell-buy-meal'].includes(selected)) throw new Error('Invalid --fixture');
const fixtures = selected === 'both' ? ['buy-meal', 'sell-buy-meal'] as const : [selected as 'buy-meal' | 'sell-buy-meal'];
const paths: string[] = [];
try {
  for (const kind of fixtures) {
    const manifest = developmentFixture(kind, integer('seed', 1, 0), integer('horizon', kind === 'buy-meal' ? 1 : 2));
    manifest.cadence = integer('cadence', 1);
    for (const [label, factory] of [['no-command', createNoCommandCandidate], ['privileged-development-reference', developmentReference(kind)]] as const) {
      const report = await runEpisode(manifest, factory, { limits: {
        decisionTimeoutMs: integer('decision-timeout-ms', 1000), episodeTimeoutMs: integer('episode-timeout-ms', 30000), maxDecisions: integer('max-decisions', 1000),
      } });
      paths.push(report.outputDirectory);
      const replay = replayEpisode(report.outputDirectory);
      console.log(JSON.stringify({ fixture: kind, comparator: label, status: report.status, reason: report.reason, success: report.success,
        ticks: report.ticks, health: report.outcome.actor.health, fullness: report.outcome.actor.fullness, gold: report.outcome.actor.gold,
        accountingValid: report.accountingValid, replayBoundaries: replay.boundaries, modelCalls: report.usage.modelCalls,
      }));
      if (report.status === 'invalid' || !report.accountingValid) process.exitCode = 1;
    }
  }
} finally {
  // The CLI is a clean conformance probe, not an approved evidence export.
  for (const path of paths) rmSync(path, { recursive: true, force: true });
}
