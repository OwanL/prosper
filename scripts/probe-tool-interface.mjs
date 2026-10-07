// Paired decisions on immutable saved snapshots. Never controls the live world.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAgentPlanner, AGENT_PROMPT } from '../lib/agent-planner.mjs';
import { createCitizenToolSession, MODEL_TOOLS, OLLAMA_MODEL_TOOLS, COMPACT_MODEL_TOOLS } from '../lib/citizen-tools.mjs';
import { planningContext, applyPlan, tickWorld } from '../lib/world.mjs';
import { createRuntimeBudget } from '../lib/budget.mjs';
import { cappedBudget } from '../lib/experiments.mjs';
import { createAudit } from '../lib/audit.mjs';
import { exchangePreview } from '../lib/exchange-preview.mjs';
import { flattenTaskMenu } from '../lib/task-menu.mjs';
import { briefToolMenu } from '../lib/brief-tool-menu.mjs';
import { actionAffordances } from '../lib/action-affordances.mjs';
import { unifiedStrategyMenu, unifiedStrategyInstructions } from '../lib/strategy-tool-menu.mjs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const value = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
if (!file) throw new Error('Usage: node scripts/probe-tool-interface.mjs <saved-state.json> [--live] [--citizens=IDs] [--repeats=1]');
const ids = value('citizens', 'citizen-1,citizen-2,citizen-8,citizen-18').split(',');
const repeats = Number(value('repeats', '1'));
const advanceTicks = Number(value('advance-ticks', '0'));
if (!Number.isInteger(advanceTicks) || advanceTicks < 0 || advanceTicks > 120) throw new Error('advance-ticks must be 0..120.');
if (ids.length > 8 || !Number.isInteger(repeats) || repeats < 1 || repeats > 3) throw new Error('Use at most eight cases and 1..3 repeats.');
const state = JSON.parse(await readFile(resolve(file), 'utf8'));
if (!state.world?.citizens) throw new Error('Expected saved spectator state.');
let cells = [
  { name: 'current', tools: MODEL_TOOLS, instructions: AGENT_PROMPT },
  { name: 'compact', tools: COMPACT_MODEL_TOOLS, instructions: AGENT_PROMPT.replace('get_mechanics', 'inspect with subject mechanics and the action') },
];
if (value('baseline', null)) {
  const baseline = JSON.parse(await readFile(resolve(value('baseline')), 'utf8'));
  if (!Array.isArray(baseline.tools) || typeof baseline.instructions !== 'string') throw new Error('Baseline needs tools and instructions.');
  cells = [
    { name: 'baseline', ...baseline },
    { name: 'updated', tools: MODEL_TOOLS, instructions: AGENT_PROMPT },
  ];
}
if (args.includes('--exchange-preview')) cells = [
  { name: 'without-preview', tools: MODEL_TOOLS, instructions: AGENT_PROMPT, preview: false },
  { name: 'with-preview', tools: MODEL_TOOLS, instructions: `${AGENT_PROMPT}\nThe eligibleExchanges preview is actual current escrow. Use get_exchanges only when you need further offers or your history.`, preview: true },
];
if (args.includes('--schema-transport')) cells = [
  { name: 'references', tools: MODEL_TOOLS, instructions: AGENT_PROMPT },
  { name: 'ollama-compatible', tools: OLLAMA_MODEL_TOOLS, instructions: AGENT_PROMPT },
];
if (args.includes('--observation-placement')) cells = [
  { name: 'front-observation', tools: OLLAMA_MODEL_TOOLS, instructions: AGENT_PROMPT, observationPlacement: 'front' },
  { name: 'tail-observation', tools: OLLAMA_MODEL_TOOLS, instructions: AGENT_PROMPT, observationPlacement: 'tail' },
];
if (args.includes('--flat-tasks')) cells = [
  { name: 'task-variants', tools: OLLAMA_MODEL_TOOLS, instructions: AGENT_PROMPT },
  { name: 'flat-task-menu', tools: flattenTaskMenu(OLLAMA_MODEL_TOOLS), instructions: AGENT_PROMPT },
];
if (args.includes('--brief-menu')) cells = [
  { name: 'current-wording', tools: OLLAMA_MODEL_TOOLS, instructions: AGENT_PROMPT },
  { name: 'brief-wording', tools: briefToolMenu(OLLAMA_MODEL_TOOLS), instructions: AGENT_PROMPT },
];
if (args.includes('--affordances')) cells = [
  { name: 'current-observation', tools: OLLAMA_MODEL_TOOLS, instructions: AGENT_PROMPT },
  { name: 'cost-affordances', tools: OLLAMA_MODEL_TOOLS, affordances: true,
    instructions: `${AGENT_PROMPT}\nThe actionAffordances card reports your next equipment costs, bakery costs and chosen interaction inputs. Use those facts directly; get_mechanics is for details not already supplied. These are options, not requested outcomes.` },
];
if (args.includes('--action-templates')) cells = [
  { name: 'current-observation', tools: OLLAMA_MODEL_TOOLS, instructions: AGENT_PROMPT },
  { name: 'action-templates', tools: OLLAMA_MODEL_TOOLS, affordances: true, actionTemplates: true,
    instructions: `${AGENT_PROMPT}\nThe actionAffordances card contains optional valid directive templates and costs. Choose a directive itself to prepare and execute it; an extra inventory target is unnecessary. Use the supplied facts without requerying them. These are available options, not requested outcomes.` },
];
if (args.includes('--unified-strategy')) cells = [
  { name: 'native-strategies', tools: OLLAMA_MODEL_TOOLS, instructions: AGENT_PROMPT },
  { name: 'unified-strategy', tools: unifiedStrategyMenu(OLLAMA_MODEL_TOOLS), instructions: unifiedStrategyInstructions(AGENT_PROMPT) },
];
if (!args.includes('--live')) {
  console.log(JSON.stringify({ dryRun: true, ids, repeats, capUsd: 0.15,
    cells: cells.map(c => ({ name: c.name, tools: c.tools.length, bytes: Buffer.byteLength(JSON.stringify(c.tools)) })) }));
  process.exit(0);
}
const output = resolve('.prosper/experiments', `tool-interface-${randomUUID()}`);
await mkdir(output, { recursive: true });
await writeFile(join(output, 'baseline.json'), JSON.stringify(state));
const budget = cappedBudget(createRuntimeBudget({ filePath: resolve('.prosper/usage.json') }), 0.15, { scope: 'reservations' });
const results = [];
const limitations = `Small stochastic saved-state decision comparison. ${advanceTicks} physical ticks follow each provider response, before tool execution; this is a controlled cadence, not measured inference latency. Peers retain old execution during reasoning and160 follow-up ticks; there are no further decisions. Live town traffic may affect provider latency. Not evidence of sustained town behavior or a throughput comparison.`;
try {
  for (let repeat = 0; repeat < repeats; repeat++) for (const [index, id] of ids.entries()) {
    // Alternate order to reduce consistent first-cell timing bias.
    for (const cell of (repeat + index) % 2 ? [...cells].reverse() : cells) {
      const world = structuredClone(state.world), citizen = world.citizens.find(c => c.id === id && c.alive && c.adult);
      if (!citizen) throw new Error(`No living adult ${id} in capture.`);
      citizen.asyncReview = true;
      const label = `${repeat}-${id}-${cell.name}`;
      const audit = createAudit({ filePath: join(output, `${label}.jsonl`) });
      const planner = createAgentPlanner({ budget, audit, model: state.planner.model, endpoint: state.planner.endpoint,
        observationPlacement: cell.observationPlacement ?? 'tail',
        ...(advanceTicks ? { fetchImpl: async (...request) => {
          const response = await fetch(...request);
          for (let tick = 0; tick < advanceTicks; tick++) tickWorld(world);
          return response;
        } } : {}),
        reasoningEffort: 'high', toolDefinitions: cell.tools, instructions: cell.instructions,
        automaticObservation: cell.automaticObservation ?? true });
      const toolSession = createCitizenToolSession({ getWorld: () => world, citizenId: id, planId: label });
      if (cell.affordances) {
        const project = observation => ({ ...observation, actionAffordances: actionAffordances(world, id, { actionTemplates: cell.actionTemplates ?? false }) });
        const refresh = toolSession.refresh;
        toolSession.refresh = () => project(refresh());
        const poll = toolSession.pollUpdates;
        toolSession.pollUpdates = () => {
          const update = poll();
          return update ? { ...update, context: project(update.context) } : null;
        };
      }
      if (cell.preview !== undefined) {
        const project = observation => {
          if (cell.preview) return { ...observation, eligibleExchanges: exchangePreview(planningContext(world, id)) };
          const { eligibleExchanges, ...rest } = observation;
          return rest;
        };
        const refresh = toolSession.refresh;
        toolSession.refresh = () => project(refresh());
        const poll = toolSession.pollUpdates;
        toolSession.pollUpdates = () => {
          const update = poll();
          return update ? { ...update, context: project(update.context) } : null;
        };
      }
      const started = Date.now();
      const result = { id, name: citizen.name, variant: cell.name, repeat };
      try {
        const decision = await planner.plan(planningContext(world, id), undefined, { toolSession, planId: label });
        result.plan = decision.plan; result.steps = decision.steps;
        applyPlan(world, id, decision.plan);
        const existingIds = new Set([...state.world.messages, ...state.world.board].map(m => m.id));
        for (let tick = 0; tick < 160; tick++) tickWorld(world);
        result.messages = [...world.messages, ...world.board].filter(m => !existingIds.has(m.id) && (m.senderId === id || m.citizenId === id));
        result.after = { alive: citizen.alive, health: citizen.health, hunger: citizen.hunger, food: citizen.food,
          wood: citizen.wood, bread: citizen.bread, activity: citizen.activity, order: citizen.order?.task,
          results: citizen.actionResults?.slice(-5), newResults: citizen.actionResults?.filter(r => r.tick > state.world.tick),
          consequentialCompletions: (citizen.completedActionRevision ?? 0) - (state.world.citizens.find(c => c.id === id).completedActionRevision ?? 0), stats: world.stats };
      } catch (error) { result.error = error.message; }
      result.latencyMs = Date.now() - started; result.metrics = planner.metrics;
      results.push(result);
      await writeFile(join(output, `${label}.json`), JSON.stringify(result, null, 2));
      await writeFile(join(output, 'summary.json'), JSON.stringify({ results, spentUsd: budget.spent(), limitations }, null, 2));
      console.log(JSON.stringify({ id, variant: cell.name, repeat, steps: result.steps, error: result.error,
        inputTokens: planner.metrics.inputTokens, outputTokens: planner.metrics.outputTokens, toolErrors: planner.metrics.toolErrors }));
      if (budget.spent() >= 0.15) throw new Error('Probe reference cap reached.');
    }
  }
} finally {
  await writeFile(join(output, 'summary.json'), JSON.stringify({ results, spentUsd: budget.spent(), limitations }, null, 2));
  console.log(JSON.stringify({ output, spentUsd: budget.spent(), limitations }));
}
