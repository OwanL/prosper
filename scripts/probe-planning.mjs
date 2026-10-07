// Compare guidance on explicitly selected recorded decisions; never execute them.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { probeDecision, cappedBudget } from '../lib/experiments.mjs';
import { createRuntimeBudget } from '../lib/budget.mjs';
import { SYSTEM_PROMPT, DEFAULT_MODEL, DEFAULT_ENDPOINT } from '../lib/planner.mjs';
import { continuityPrompt } from '../lib/continuity.mjs';

const [directory, ...args] = process.argv.slice(2);
if (!directory) throw new Error('Usage: node scripts/probe-planning.mjs <capture-directory> [--live]');
const root = resolve(directory);
const cases = JSON.parse(await readFile(join(root, 'cases.json'), 'utf8'));
if (!Array.isArray(cases) || cases.length < 1 || cases.length > 10) throw new Error('cases.json must contain 1..10 {label,planId} records');
const rows = (await readFile(join(root, 'audit.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
const samples = cases.map(c => {
  const entry = rows.find(r => r.type === 'plan_request' && r.planId === c.planId);
  if (!entry) throw new Error(`Missing request ${c.planId}`);
  return { id: c.label, request: entry.request, observation: JSON.parse(entry.request.messages[1].content) };
});
const config = { cases, repeats: 2, variants: ['recorded', 'revised'], model: DEFAULT_MODEL, capReferenceUsd: 0.05,
  scope: 'Recorded decision probes, identical observations and common current validation. No execution or spontaneous behavior claim.' };
if (!args.includes('--live')) { console.log(JSON.stringify({ dryRun: true, ...config })); process.exit(0); }
const budget = cappedBudget(createRuntimeBudget({ filePath: resolve('.prosper/usage.json') }), config.capReferenceUsd);
const dir = join(root, `probes-${randomUUID()}`);
await mkdir(dir);
await writeFile(join(dir, 'config.json'), JSON.stringify(config, null, 2));
let lastCall = Date.now();
const results = [];
try {
  for (let repeat = 0; repeat < 2; repeat++) for (const [index, sample] of samples.entries()) {
    for (const variant of (repeat + index) % 2 ? ['revised', 'recorded'] : ['recorded', 'revised']) {
      await delay(Math.max(0, 5000 - (Date.now() - lastCall)));
      const state = await (await fetch('http://127.0.0.1:4173/api/state')).json();
      if (state.running || state.planner.activeCitizenId) throw new Error('Live world must remain paused');
      const input = structuredClone(sample);
      if (variant === 'revised') input.request.messages[0].content = continuityPrompt(SYSTEM_PROMPT);
      lastCall = Date.now();
      const result = await probeDecision({ sample: input, variant: { name: variant, model: DEFAULT_MODEL }, budget,
        endpoint: process.env.OLLAMA_BASE_URL || DEFAULT_ENDPOINT });
      results.push({ ...result, repeat, label: sample.id, variant });
      await writeFile(join(dir, `${sample.id}-${variant}-${repeat}.json`), JSON.stringify(results.at(-1), null, 2));
      console.log(JSON.stringify({ label: sample.id, variant, repeat, error: result.error, plan: result.assessment?.plan }));
    }
  }
} finally {
  await writeFile(join(dir, 'summary.json'), JSON.stringify({ ...config, results, spentReferenceUsd: budget.spent() }, null, 2));
  console.log(JSON.stringify({ dir, spentReferenceUsd: budget.spent() }));
}
