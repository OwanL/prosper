// Bounded decisions against unchanged copies of a paused live checkpoint.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAgentPlanner } from '../lib/agent-planner.mjs';
import { createCitizenToolSession } from '../lib/citizen-tools.mjs';
import { planningContext, applyPlan, tickWorld } from '../lib/world.mjs';
import { createRuntimeBudget } from '../lib/budget.mjs';
import { cappedBudget } from '../lib/experiments.mjs';
import { createAudit } from '../lib/audit.mjs';

const args = process.argv.slice(2);
const value = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const ids = value('citizens', 'citizen-1,citizen-2,citizen-8').split(',');
const ticks = Number(value('ticks', '160'));
if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > 600 || ids.length > 8) throw new Error('Use 1..600 ticks and at most eight citizens.');
if (!args.includes('--live')) {
  console.log(JSON.stringify({ dryRun: true, ids, ticks, capUsd: 0.10 }));
  process.exit(0);
}
const state = await (await fetch('http://127.0.0.1:4173/api/state')).json();
if (state.running || state.planner.activeCitizenIds?.length || state.planner.activeCitizenId) throw new Error('Pause and drain the live server before probing.');
const output = resolve('.prosper/experiments', `current-probe-${randomUUID()}`);
await mkdir(output, { recursive: true });
await writeFile(join(output, 'before.json'), JSON.stringify(state, null, 2));
const budget = cappedBudget(createRuntimeBudget({ filePath: resolve('.prosper/usage.json') }), 0.10);
const summaries = [];
try {
  for (const id of ids) {
    const live = await (await fetch('http://127.0.0.1:4173/api/state')).json();
    if (live.running || live.planner.activeCitizenIds?.length || live.world.tick !== state.world.tick) throw new Error('Live world changed; stopping probe.');
    const world = structuredClone(state.world), citizen = world.citizens.find(c => c.id === id && c.alive && c.adult);
    if (!citizen) throw new Error(`No living adult ${id}`);
    citizen.asyncReview = true;
    const audit = createAudit({ filePath: join(output, `${id}.jsonl`) });
    const planner = createAgentPlanner({ budget, audit, model: state.planner.model, endpoint: state.planner.endpoint, reasoningEffort: 'high' });
    const toolSession = createCitizenToolSession({ getWorld: () => world, citizenId: id, planId: randomUUID() });
    const started = Date.now();
    const result = await planner.plan(planningContext(world, id), undefined, { toolSession });
    applyPlan(world, id, result.plan);
    const messages = [...world.messages, ...world.board].filter(m => m.senderId === id && m.tick >= state.world.tick);
    const summary = { id, name: citizen.name, model: planner.model, reasoningEffort: planner.reasoningEffort,
      latencyMs: Date.now() - started, plan: result.plan, messages };
    for (let i = 0; i < ticks; i++) tickWorld(world);
    summary.after = { tick: world.tick, food: citizen.food, wood: citizen.wood, bread: citizen.bread, health: citizen.health,
      tool: citizen.toolLevel ?? Number(citizen.tool), shoes: citizen.shoesLevel ?? Number(citizen.shoes), weapon: citizen.weaponLevel ?? Number(citizen.weapon),
      order: citizen.order?.task, work: citizen.work, results: citizen.actionResults, stats: world.stats };
    summaries.push(summary);
    await writeFile(join(output, `${id}.json`), JSON.stringify({ summary, world }, null, 2));
    console.log(JSON.stringify(summary));
  }
} finally {
  const limitations = 'One stochastic decision per citizen on independent copies of a paused snapshot. Other citizens retain old execution, no further decisions, zero simulated inference latency. Not a town trial or causal comparison.';
  await writeFile(join(output, 'summary.json'), JSON.stringify({ summaries, referenceSpentUsd: budget.spent(), limitations }, null, 2));
  console.log(JSON.stringify({ output, referenceSpentUsd: budget.spent(), limitations }));
}
