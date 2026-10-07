// Prepared capability probes; these do not establish spontaneous emergence.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWorld, applyPlan, planningContext, tickWorld } from '../lib/world.mjs';
import { createPlanner, PlanResponseError } from '../lib/planner.mjs';
import { createAgentPlanner } from '../lib/agent-planner.mjs';
import { createCitizenToolSession } from '../lib/citizen-tools.mjs';
import { createRuntimeBudget } from '../lib/budget.mjs';
import { cappedBudget } from '../lib/experiments.mjs';
import { createAudit } from '../lib/audit.mjs';
import { normalizePlan } from '../lib/plans.mjs';

const live = process.argv.includes('--live');
const variants = process.argv.includes('--compare-reasoning-history') ? ['semantic-no-history', 'semantic']
  : process.argv.includes('--semantic-only') ? ['semantic'] : ['legacy', 'semantic'];
const cases = ['materials-ready', 'investment-in-progress'];
if (!live) { console.log(JSON.stringify({ dryRun: true, variants, cases, reviews: 2, maxReferenceUsd: 0.10, simulatedInferenceLatency: 0 })); process.exit(0); }
const state = await (await fetch('http://127.0.0.1:4173/api/state')).json();
if (state.running || state.planner.activeCitizenId) throw new Error('Pause the live run before prepared probes.');
const output = resolve('.prosper/experiments', `harness-probe-${randomUUID()}`);
await mkdir(output, { recursive: true });
const budget = cappedBudget(createRuntimeBudget({ filePath: resolve('.prosper/usage.json') }), 0.10);
const summaries = [];
try {
  for (const scenario of cases) for (const variant of variants) {
    const world = createWorld(), citizen = world.citizens[1];
    citizen.food = 12; citizen.wood = 65; citizen.hunger = 10; citizen.energy = 90;
    citizen.goals = ['Complete my chosen bakery investment, then produce bread'];
    const chosen = normalizePlan({ goals: citizen.goals, tasks: [{ type: 'build', building: 'bakery', x: citizen.x, y: citizen.y }], work: { type: 'bake', target: 'own' } }, planningContext(world, citizen.id));
    applyPlan(world, citizen.id, chosen);
    if (scenario === 'investment-in-progress') for (let i = 0; i < 12; i++) tickWorld(world);
    const audit = createAudit({ filePath: join(output, `${scenario}-${variant}.jsonl`), maxBytes: 8 * 1024 * 1024 });
    const planner = (variant.startsWith('semantic') ? createAgentPlanner : createPlanner)({ budget, audit, projectContinuity: true,
      preserveReasoning: variant !== 'semantic-no-history' });
    const decisions = [];
    for (let review = 0; review < 2; review++) {
      const liveState = await (await fetch('http://127.0.0.1:4173/api/state')).json();
      if (liveState.running || liveState.planner.activeCitizenId) throw new Error('Live run resumed; stopping probe.');
      const started = Date.now();
      const toolSession = createCitizenToolSession({ getWorld: () => world, citizenId: citizen.id, planId: randomUUID() });
      try {
        const result = await planner.plan(planningContext(world, citizen.id), undefined, { toolSession });
        applyPlan(world, citizen.id, result.plan);
        decisions.push({ latencyMs: Date.now() - started, steps: result.steps ?? 1, tools: result.tools ?? 0, plan: result.plan });
      } catch (error) {
        if (!(error instanceof PlanResponseError)) throw error;
        decisions.push({ latencyMs: Date.now() - started, error: error.message });
      }
      for (let i = 0; i < 65; i++) tickWorld(world);
    }
    const summary = { scenario, variant, decisions, built: world.stats.built, baked: world.stats.baked, health: citizen.health,
      replaced: citizen.strategyReplacements, continued: citizen.continuedReviews ?? 0 };
    summaries.push(summary);
    await writeFile(join(output, `${scenario}-${variant}.json`), JSON.stringify({ summary, world }, null, 2));
    console.log(JSON.stringify({ scenario, variant, built: summary.built, baked: summary.baked, steps: decisions.map(d => d.steps) }));
  }
} finally {
  await writeFile(join(output, 'summary.json'), JSON.stringify({ summaries, referenceSpentUsd: budget.spent(), limitations: 'Prepared chosen projects, one stochastic sample, zero simulated inference latency.' }, null, 2));
  console.log(JSON.stringify({ output, referenceSpentUsd: budget.spent() }));
}
