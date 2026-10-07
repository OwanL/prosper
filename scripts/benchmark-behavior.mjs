import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { behaviorCase, runBehaviorCase, BEHAVIOR_CASES } from '../lib/behavior-benchmark.mjs';
import { createPlanner, DEFAULT_MODEL, DEFAULT_ENDPOINT } from '../lib/planner.mjs';
import { createRuntimeBudget } from '../lib/budget.mjs';
import { cappedBudget } from '../lib/experiments.mjs';
import { createAudit } from '../lib/audit.mjs';

const args = process.argv.slice(2), live = args.includes('--live');
const repeats = Number(args.find(a => a.startsWith('--repeats='))?.slice(10) ?? 2);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw new Error('repeats must be 1..5');
const config = { cases: BEHAVIOR_CASES, repeats, variants: ['baseline', 'continuity'], decisionsPerCase: 2, model: DEFAULT_MODEL,
  maxReferenceUsd: 0.10, scope: 'Prepared capability cases, fixed review times and zero simulated inference latency; not spontaneous emergence or a live scheduler comparison.' };
if (!live) { console.log(JSON.stringify({ dryRun: true, ...config })); process.exit(0); }
const budget = cappedBudget(createRuntimeBudget({ filePath: resolve('.prosper/usage.json') }), 0.10);
const dir = resolve('.prosper/experiments', `behavior-${randomUUID()}`);
await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'config.json'), JSON.stringify(config, null, 2));
let lastCall = Date.now();
const transport = async (url, options) => {
  if (url.endsWith('/chat/completions')) {
    await delay(Math.max(0, 5000 - (Date.now() - lastCall)));
    const state = await (await fetch('http://127.0.0.1:4173/api/state')).json();
    if (state.running || state.planner.activeCitizenId) throw new Error('Live simulation must remain paused during the benchmark');
    lastCall = Date.now();
  }
  return fetch(url, options);
};
const results = [];
try {
  for (let repeat = 0; repeat < repeats; repeat++) for (let index = 0; index < BEHAVIOR_CASES.length; index++) {
    const name = BEHAVIOR_CASES[index];
    for (const projectContinuity of (repeat + index) % 2 ? [true, false] : [false, true]) {
      const variant = projectContinuity ? 'continuity' : 'baseline';
      const audit = createAudit({ filePath: join(dir, `${name}-${variant}-${repeat}.jsonl`), maxBytes: 8 * 1024 * 1024 });
      const planner = createPlanner({ model: DEFAULT_MODEL, endpoint: process.env.OLLAMA_BASE_URL || DEFAULT_ENDPOINT, projectContinuity, audit, budget, fetchImpl: transport });
      const result = await runBehaviorCase(behaviorCase(name), planner);
      await writeFile(join(dir, `${name}-${variant}-${repeat}.json`), JSON.stringify(result, null, 2));
      const { decisions, initialWorld, finalWorld, ...summary } = result;
      results.push({ variant, repeat, ...summary });
      console.log(JSON.stringify(results.at(-1)));
      if (budget.spent() >= 0.10) throw new Error('Benchmark cap reached');
    }
  }
} finally {
  await writeFile(join(dir, 'summary.json'), JSON.stringify({ ...config, results, spentReferenceUsd: budget.spent() }, null, 2));
  console.log(JSON.stringify({ dir, spentReferenceUsd: budget.spent() }));
}
