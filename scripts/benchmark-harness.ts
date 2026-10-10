import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CitizenRunner } from '../src/citizen/runner.ts';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import { strategicContext } from '../src/citizen/strategic-context.ts';
import { strategicTools } from '../src/citizen/strategic-tools.ts';
import { freshContext } from '../src/citizen/prompt.ts';
import { tools as legacyTools } from '../src/citizen/tools.ts';

// Offline admission/payload benchmark. Mock continuation policies have no provider
// usage receipts and must never be reported as measured live token efficiency.
const directory = mkdtempSync(join(tmpdir(), 'prosper-harness-benchmark-'));
const evidence = resolve(
  '.experiments',
  `harness-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
);
mkdirSync(evidence, { recursive: true });
const world = createWorld({ seed: 7, population: 100, autonomy: true });
updateKnowledge(world);
const samples: { tick: number; citizenId: string; compactBytes: number; legacyBytes: number }[] =
  [];
const requests: { tick: number; citizenId: string; bytes: number }[] = [];
let citizenTicks = 0;
const runner = new CitizenRunner(
  {
    world: () => world,
    observe: (id) => observe(world, id),
    command: (id, command) => dispatch(world, id, command),
    diagnostic: () => {},
  },
  {
    mode: 'live',
    model: 'offline-policy-benchmark',
    minRequestIntervalMs: 0,
    maxRequestsPerHour: 10000,
    ledgerOptions: { directory, maxRequests: 50, maxTokens: 2000000 },
    transport: async (request) => {
      requests.push({
        tick: world.tick,
        citizenId: request.citizenId,
        bytes: Buffer.byteLength(JSON.stringify(request.payload)),
      });
      return { content: '{"policy":{},"reviewAfter":4800}' };
    },
  },
);
try {
  const start = performance.now();
  for (let i = 0; i < 6000; i++) {
    tickWorld(world);
    updateKnowledge(world);
    runner.tick();
    for (let j = 0; j < 12; j++) await Promise.resolve();
    citizenTicks += Object.values(world.citizens).filter((citizen) => citizen.alive).length;
    if (world.tick % 1000 === 0) {
      for (const citizen of Object.values(world.citizens)
        .filter((c) => c.alive)
        .slice(0, 20)) {
        const observation = observe(world, citizen.id);
        samples.push({
          tick: world.tick,
          citizenId: citizen.id,
          compactBytes: Buffer.byteLength(
            JSON.stringify({
              model: 'qwen3.5:9b',
              reasoning_effort: 'none',
              max_tokens: 1200,
              stream: false,
              messages: strategicContext(observation),
              tools: strategicTools,
            }),
          ),
          legacyBytes: Buffer.byteLength(
            JSON.stringify({
              model: 'deepseek-v4.1-flash:cloud',
              reasoning_effort: 'low',
              max_tokens: 40000,
              stream: false,
              messages: freshContext(observation),
              tools: legacyTools,
            }),
          ),
        });
      }
      console.log(
        JSON.stringify({
          tick: world.tick,
          scheduledMockReviews: requests.length,
          living: Object.values(world.citizens).filter((c) => c.alive).length,
        }),
      );
    }
  }
  const percentile = (values: number[], p: number) =>
    [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] ?? 0;
  const summary = {
    label: 'Offline mock continuation benchmark, not live model quality or actual token usage',
    seed: 7,
    founders: 100,
    ticks: world.tick,
    elapsedMs: performance.now() - start,
    citizenTicks,
    simulationCitizenHours: citizenTicks / 14400,
    scheduledMockReviews: requests.length,
    scheduledReviewsPerSimulationCitizenHour: requests.length / (citizenTicks / 14400),
    providerRequests: 0,
    actualProviderTokens: 0,
    payloadSamples: samples.length,
    compactP50: percentile(
      samples.map((s) => s.compactBytes),
      0.5,
    ),
    compactP95: percentile(
      samples.map((s) => s.compactBytes),
      0.95,
    ),
    legacyP50: percentile(
      samples.map((s) => s.legacyBytes),
      0.5,
    ),
    legacyP95: percentile(
      samples.map((s) => s.legacyBytes),
      0.95,
    ),
    requests,
    samples,
    reasons: runner
      .records()
      .map((record) => ({
        tick: record.tick,
        citizenId: record.citizenId,
        reason: record.reason,
        policyOutcome: record.policyOutcome,
      })),
  };
  writeFileSync(join(evidence, 'evidence.json'), JSON.stringify(summary, null, 2));
  console.log(
    JSON.stringify(
      {
        ...summary,
        requests: requests.length,
        samples: samples.length,
        reasons: summary.reasons.length,
        evidence,
      },
      null,
      2,
    ),
  );
} finally {
  runner.interrupt('offline benchmark complete');
  rmSync(directory, { recursive: true, force: true });
}
