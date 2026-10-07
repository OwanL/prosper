// Compare identical citizen snapshots and guidance, varying provider/concurrency.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAgentPlanner } from '../lib/agent-planner.mjs';
import { createCodexTransport, CODEX_MODEL } from '../lib/codex-provider.mjs';
import { createCitizenToolSession } from '../lib/citizen-tools.mjs';
import { planningContext } from '../lib/world.mjs';
import { createRuntimeBudget } from '../lib/budget.mjs';
import { cappedBudget } from '../lib/experiments.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const ids = option('citizens', 'citizen-1,citizen-2,citizen-6,citizen-8').split(',');
const sizes = option('concurrency', '2,4').split(',').map(Number);
if (ids.length < 1 || ids.length > 8 || new Set(ids).size !== ids.length || sizes.some(n => !Number.isInteger(n) || n < 1 || n > 8)) throw new Error('Use 1..8 unique citizens and concurrency values 1..8.');
if (args.includes('--ollama-only') && args.includes('--codex-only')) throw new Error('Choose only one provider filter.');
if (!args.includes('--live')) {
  console.log(JSON.stringify({ preview: true, citizens: ids, concurrency: sizes, referenceCapUsd: .30,
    provider: args.includes('--ollama-only') ? 'ollama' : args.includes('--codex-only') ? 'openai-codex' : 'both' }));
  process.exit(0);
}
const file = args.find(a => !a.startsWith('--'));
if (!file) throw new Error('A paused checkpoint file is required.');
const checkpoint = JSON.parse(await readFile(resolve(file), 'utf8'));
if (checkpoint.running || checkpoint.planner.activeCitizenIds.length) throw new Error('Paused, drained capture required.');
const output = resolve('.prosper/experiments', `throughput-${randomUUID()}`);
await mkdir(output, { recursive: true });
const budget = cappedBudget(createRuntimeBudget({ filePath: resolve('.prosper/usage.json') }), .30);
const summaries = [];
try {
  const providers = args.includes('--ollama-only') ? ['ollama'] : args.includes('--codex-only') ? ['openai-codex'] : ['ollama', 'openai-codex'];
  const cells = providers.flatMap(provider => sizes.map(concurrency => [provider, concurrency]));
  for (const [provider, concurrency] of cells) {
    const live = await (await fetch('http://127.0.0.1:4173/api/state')).json();
    if (live.running || live.planner.activeCitizenIds.length || live.world.tick !== checkpoint.world.tick) throw new Error('Live world changed; stop the benchmark.');
    const records = [], requests = [], started = Date.now();
    const planner = createAgentPlanner({ budget, reasoningEffort: 'high',
      ...(provider === 'openai-codex' ? { ...createCodexTransport(), model: CODEX_MODEL } : {}),
      audit: { record(event) { if (['agent_request', 'agent_response', 'agent_tool_result', 'provider_timing', 'plan_error'].includes(event.type)) records.push(event); } },
    });
    let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++], world = structuredClone(checkpoint.world), citizen = world.citizens.find(c => c.id === id);
        if (!citizen?.alive || !citizen.adult) throw new Error(`No living adult ${id} in checkpoint.`);
        citizen.asyncReview = true;
        const toolSession = createCitizenToolSession({ getWorld: () => world, citizenId: id, planId: randomUUID() });
        const start = Date.now();
        try {
          const result = await planner.plan(planningContext(world, id), undefined, { toolSession });
          requests.push({ id, latencyMs: Date.now() - start, steps: result.steps, tools: result.tools, plan: result.plan });
        } catch (error) { requests.push({ id, latencyMs: Date.now() - start, error: error.message }); }
      }
    }));
    const summary = { provider, concurrency, elapsedMs: Date.now() - started, metrics: planner.metrics, requests,
      maxPromptBytes: Math.max(0, ...records.filter(r => r.type === 'agent_request').map(r => r.promptBytes)),
      referenceSpentUsd: budget.spent() };
    summaries.push(summary);
    await writeFile(join(output, `${provider}-${concurrency}.json`), JSON.stringify({ summary, records }, null, 2));
    console.log(JSON.stringify({ provider, concurrency, elapsedMs: summary.elapsedMs, calls: planner.metrics.modelCalls,
      completed: requests.filter(r => !r.error).length, errors: requests.filter(r => r.error).map(r => ({ id: r.id, error: r.error })),
      inputTokens: planner.metrics.inputTokens, outputTokens: planner.metrics.outputTokens }));
  }
} finally {
  await writeFile(join(output, 'summary.json'), JSON.stringify({ summaries, referenceSpentUsd: budget.spent(),
    limitation: `${ids.length} fixed citizen copies per cell, frozen world during inference. Small stochastic, order-dependent capacity probe; not a behavior or sustained rate-limit trial.` }, null, 2));
  console.log(JSON.stringify({ output, referenceSpentUsd: budget.spent() }));
}
