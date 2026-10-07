// Prepared opportunities test decisions and execution, not spontaneous emergence.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWorld, applyPlan, planningContext, tickWorld, transactCitizenAction } from '../lib/world.mjs';
import { observeWorld } from '../lib/knowledge.mjs';
import { normalizePlan } from '../lib/plans.mjs';
import { resolveBuilding } from '../lib/buildings.mjs';
import { createAgentPlanner } from '../lib/agent-planner.mjs';
import { PlanResponseError } from '../lib/planner.mjs';
import { createCitizenToolSession } from '../lib/citizen-tools.mjs';
import { createRuntimeBudget } from '../lib/budget.mjs';
import { cappedBudget } from '../lib/experiments.mjs';
import { createAudit } from '../lib/audit.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const cases = option('cases', 'food-exchange,property-under-attack').split(',');
if (cases.some(c => !['food-exchange', 'property-under-attack', 'peaceful-neighbor'].includes(c))) throw new Error('Unsupported prepared case.');
const advanceTicks = Number(option('advance-ticks', '0'));
if (!Number.isInteger(advanceTicks) || advanceTicks < 0 || advanceTicks > 120) throw new Error('advance-ticks must be 0..120.');
const savedState = option('state', null);
if (!process.argv.includes('--live')) { console.log(JSON.stringify({ dryRun: true, cases, reviews: 2, maxReferenceUsd: 0.05 })); process.exit(0); }
const live = savedState ? JSON.parse(await readFile(resolve(savedState), 'utf8')) : await (await fetch('http://127.0.0.1:4173/api/state')).json();
if (!savedState && (live.running || live.planner.activeCitizenId)) throw new Error('Pause the live simulation, or provide --state=<saved spectator checkpoint> for isolated fixtures.');
const output = resolve('.prosper/experiments', `social-probe-${randomUUID()}`);
await mkdir(output, { recursive: true });
const budget = cappedBudget(createRuntimeBudget({ filePath: resolve('.prosper/usage.json') }), 0.05, { scope: 'reservations' });
const summaries = [];
try {
  for (const scenario of cases) {
    const world = createWorld(), citizen = world.citizens.find(c => c.id === option('actor', 'citizen-4')), other = world.citizens[1];
    if (!citizen || citizen === other) throw new Error('Choose an existing actor other than citizen-2.');
    for (const c of world.citizens) { c.food = 12; c.energy = 90; c.hunger = 10; c.asyncReview = true; }
    citizen.x = 13; citizen.y = 7; other.x = 14; other.y = 7;
    citizen.wood = 80;
    if (scenario === 'food-exchange') {
      citizen.food = 0; citizen.hunger = 65;
      observeWorld(world, citizen); observeWorld(world, other);
      const offer = transactCitizenAction(world, other.id, { type: 'offer', give: 'food', giveAmount: 4, want: 'wood', wantAmount: 8, recipient: citizen.id });
      transactCitizenAction(world, other.id, { type: 'message', target: citizen.id, text: `${offer.receiptId}: 4 food for 8 wood, available now.`, location: true });
    } else {
      const built = resolveBuilding(world, citizen, { type: 'build', building: 'bakery', x: citizen.x, y: citizen.y });
      if (!built.ok) throw new Error(built.reason);
      citizen.weapon = true; citizen.weaponDurability = 12;
      other.weapon = scenario === 'property-under-attack' && !args.includes('--unarmed-attacker'); other.weaponDurability = other.weapon ? 12 : 0;
      observeWorld(world, citizen); observeWorld(world, other);
      const building = world.buildings[0];
      if (scenario === 'property-under-attack') {
        applyPlan(world, other.id, normalizePlan({ tasks: [{ type: 'attack', target: building.id }], work: null }, planningContext(world, other.id)));
        for (let i = 0; i < 3; i++) tickWorld(world);
      } else {
        transactCitizenAction(world, other.id, { type: 'message', target: citizen.id,
          text: 'I would like to work near your bakery. I can supply wood for bread; are you open to dealing?' });
      }
    }
    const audit = createAudit({ filePath: join(output, `${scenario}.jsonl`), maxBytes: 8 * 1024 * 1024 });
    Object.defineProperty(world, 'audit', { value: audit });
    const planner = createAgentPlanner({ budget, audit, model: live.planner.model, endpoint: live.planner.endpoint,
      reasoningEffort: 'high', ...(advanceTicks ? { fetchImpl: async (...request) => {
        const response = await fetch(...request);
        for (let i = 0; i < advanceTicks; i++) tickWorld(world);
        return response;
      } } : {}) });
    const decisions = [];
    const before = { ...world.stats };
    for (let review = 0; review < 2; review++) {
      if (!savedState) {
        const state = await (await fetch('http://127.0.0.1:4173/api/state')).json();
        if (state.running || state.planner.activeCitizenId) throw new Error('Live run resumed; stopping probes.');
      }
      if (!citizen.alive) break;
      const started = Date.now();
      const tools = createCitizenToolSession({ getWorld: () => world, citizenId: citizen.id, planId: randomUUID() });
      try {
        const result = await planner.plan(planningContext(world, citizen.id), undefined, { toolSession: tools });
        applyPlan(world, citizen.id, result.plan);
        decisions.push({ latencyMs: Date.now() - started, steps: result.steps, plan: result.plan });
      } catch (error) {
        if (!(error instanceof PlanResponseError)) throw error;
        decisions.push({ latencyMs: Date.now() - started, error: error.message });
      }
      for (let i = 0; i < 35; i++) tickWorld(world);
    }
    const summary = { scenario, actor: citizen.id, model: planner.model, reasoningEffort: planner.reasoningEffort,
      advanceTicks, unarmedAttacker: args.includes('--unarmed-attacker'), decisions,
      modelCalls: planner.metrics.modelCalls, inputTokens: planner.metrics.inputTokens, outputTokens: planner.metrics.outputTokens, toolErrors: planner.metrics.toolErrors,
      statsDelta: Object.fromEntries(Object.entries(world.stats).map(([key, value]) => [key, value - before[key]])),
      citizen: { health: citizen.health, food: citizen.food, wood: citizen.wood, alive: citizen.alive },
      buildings: world.buildings.map(b => ({ id: b.id, health: b.health })) };
    summaries.push(summary);
    await writeFile(join(output, `${scenario}.json`), JSON.stringify({ summary, world }, null, 2));
    console.log(JSON.stringify({ scenario, steps: decisions.map(d => d.steps), statsDelta: summary.statsDelta, citizen: summary.citizen }));
  }
} finally {
  await writeFile(join(output, 'summary.json'), JSON.stringify({ summaries, referenceSpentUsd: budget.spent(),
    limitations: `Prepared opportunities, one stochastic sample each. ${advanceTicks} physical ticks after each provider response is controlled cadence, not measured inference latency. Fixtures keep peers' old work and make no further decisions for them. No chosen outcome is forced, and no live town state or controls are changed.` }, null, 2));
  console.log(JSON.stringify({ output, referenceSpentUsd: budget.spent() }));
}
