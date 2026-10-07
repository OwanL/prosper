import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createWorld } from '../lib/world.mjs';
import { createPlanner, DEFAULT_MODEL, DEFAULT_ENDPOINT } from '../lib/planner.mjs';
import { createRuntimeBudget } from '../lib/budget.mjs';
import { createAudit } from '../lib/audit.mjs';
import { cappedBudget } from '../lib/experiments.mjs';
import { runTrial } from '../lib/trials.mjs';

const [directory, ...args] = process.argv.slice(2);
if (!directory) throw new Error('Usage: node scripts/run-trials.mjs <capture-directory> [--live] [--ticks=800]');
const ticks = Number(args.find(a => a.startsWith('--ticks='))?.slice(8) ?? 800);
if (!Number.isInteger(ticks) || ticks < 1 || ticks > 2000) throw new Error('ticks must be 1..2000');
const capture = JSON.parse(await readFile(join(resolve(directory), 'state.json'), 'utf8'));
if (capture.running || capture.planner.activeCitizenId) throw new Error('Expected paused capture');
const conditions = [
  { name: 'fresh', world: createWorld() },
  { name: 'captured', world: capture.world },
];
if (!args.includes('--live')) {
  console.log(JSON.stringify({ dryRun: true, conditions: conditions.map(c => c.name), variants: ['baseline', 'strategy-review'], ticks, model: DEFAULT_MODEL, maxReferenceUsd: 0.10 }));
  process.exit(0);
}
let lastRequest = Date.now();
const transport = async (url, options) => {
  if (url.endsWith('/chat/completions')) {
    await delay(Math.max(0, 5000 - (Date.now() - lastRequest)));
    const live = await (await fetch('http://127.0.0.1:4173/api/state')).json();
    if (live.running || live.planner.activeCitizenId) throw new Error('Pause live simulation before trials');
    lastRequest = Date.now();
  }
  return fetch(url, options);
};
const budget = cappedBudget(createRuntimeBudget({ filePath: resolve('.prosper/usage.json') }), 0.10);
const output = join(resolve(directory), `trials-${randomUUID()}`);
await mkdir(output);
const results = [];
try {
  trials: for (const condition of conditions) for (const strategyReview of [false, true]) {
    const name = `${condition.name}-${strategyReview ? 'strategy-review' : 'baseline'}`;
    const audit = createAudit({ filePath: join(output, `${name}.jsonl`), maxBytes: 8 * 1024 * 1024 });
    const planner = createPlanner({ model: DEFAULT_MODEL, endpoint: process.env.OLLAMA_BASE_URL || DEFAULT_ENDPOINT, budget, fetchImpl: transport, strategyReview, audit });
    const result = await runTrial({ world: condition.world, planner, ticks });
    await writeFile(join(output, `${name}.json`), JSON.stringify(result, null, 2));
    const { finalWorld, ...summary } = result;
    results.push({ name, ...summary });
    console.log(JSON.stringify({ name, requests: result.requests, stats: result.statsDelta, accepted: result.accepted, error: result.error }));
    if (result.error) break trials;
  }
} finally {
  await writeFile(join(output, 'summary.json'), JSON.stringify({ results, referenceSpentUsd: budget.spent() }, null, 2));
  console.log(JSON.stringify({ output, referenceSpentUsd: budget.spent() }));
}
