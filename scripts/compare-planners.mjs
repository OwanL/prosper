import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createRuntimeBudget } from '../lib/budget.mjs';
import { cappedBudget, probeDecision, summarizeDecisions } from '../lib/experiments.mjs';
import { DEFAULT_ENDPOINT, DEFAULT_MODEL } from '../lib/planner.mjs';

const [command, directory, ...args] = process.argv.slice(2);
if (!directory || !['capture', 'prepare', 'run'].includes(command)) throw new Error('Usage: node scripts/compare-planners.mjs capture|prepare|run <capture-directory> [--live] [--models=name,name] [--repeats=2] [--cap=0.10]');
const dir = resolve(directory);
if (command === 'capture') {
  const state = await (await fetch('http://127.0.0.1:4173/api/state')).json();
  if (state.running || state.planner.activeCitizenId) throw new Error('Pause the simulation and wait for its active request before capture.');
  await mkdir(dir, { recursive: true });
  const pieces = [];
  for (const suffix of ['.2', '.1', '']) {
    try { pieces.push(await readFile(`.prosper/audit.jsonl${suffix}`, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await writeFile(join(dir, 'state.json'), JSON.stringify(state, null, 2), { flag: 'wx' });
  await writeFile(join(dir, 'audit.jsonl'), pieces.join(''), { flag: 'wx' });
  await writeFile(join(dir, 'guidance.mjs'), await readFile('lib/guidance.mjs'), { flag: 'wx' });
  console.log(JSON.stringify({ dir, tick: state.world.tick, note: 'Snapshot and retained audit captured; no simulation changes.' }));
} else if (command === 'prepare') {
  const entries = (await readFile(join(dir, 'audit.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const run = entries.findLast(e => e.type === 'run_started');
  if (!run) throw new Error('Capture must contain run_started');
  const ids = new Set(entries.filter(e => e.type === 'plan_dispatched' && e.runId === run.runId).map(e => e.planId));
  const requests = entries.filter(e => e.type === 'plan_request' && ids.has(e.planId));
  if (!requests.length) throw new Error('No retained decisions in the captured run. Run citizens before capturing comparison cases.');
  const citizens = [...new Set(requests.map(e => e.citizenId))];
  // First and last recorded decisions for every citizen: reproducible selection,
  // including ordinary independent work rather than only conspicuous failures.
  const selected = citizens.flatMap(id => {
    const own = requests.filter(e => e.citizenId === id);
    return own.length === 1 ? own : [own[0], own.at(-1)];
  });
  const cases = selected.map(e => ({ id: e.planId, request: e.request, observation: JSON.parse(e.request.messages[1].content) }));
  await writeFile(join(dir, 'cases.json'), JSON.stringify({ version: 1, runId: run.runId, selection: 'first and last retained request per citizen', cases }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ cases: cases.length, citizens: citizens.length, path: join(dir, 'cases.json') }));
} else {
  const value = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
  const strategyReview = args.includes('--strategy-review');
  const models = value('models', strategyReview ? DEFAULT_MODEL : `${DEFAULT_MODEL},glm-5.3:cloud`).split(',');
  const repeats = Number(value('repeats', '2'));
  const maxUsd = Number(value('cap', '0.10'));
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw new Error('repeats must be 1..5');
  if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 0.25) throw new Error('cap must be >0 and <=0.25 reference USD');
  const { cases } = JSON.parse(await readFile(join(dir, 'cases.json'), 'utf8'));
  const variants = models.flatMap(model => strategyReview
    ? [{ name: model, model }, { name: `${model}+strategy-review`, model, strategyReview: true }]
    : [{ name: model, model }]);
  const jobs = [];
  for (let repeat = 0; repeat < repeats; repeat++) for (const sample of cases) {
    // Alternate ordering to reduce systematic ordering effects.
    const order = (repeat + jobs.length / variants.length) % 2 ? [...variants].reverse() : variants;
    for (const variant of order) jobs.push({ sample, variant, repeat });
  }
  if (!args.includes('--live')) {
    console.log(JSON.stringify({ dryRun: true, cases: cases.length, requests: jobs.length, variants, maxReferenceUsd: maxUsd, accounting: 'existing ledger reference rates; not provider prices' }, null, 2));
    process.exit(0);
  }
  const state = await (await fetch('http://127.0.0.1:4173/api/state')).json();
  if (state.running || state.planner.activeCitizenId) throw new Error('Pause the simulation and let its active request finish before comparing.');
  const endpoint = process.env.OLLAMA_BASE_URL || DEFAULT_ENDPOINT;
  const available = await (await fetch(`${endpoint}/models`)).json();
  for (const model of models) if (!available.data?.some(m => m.id === model)) throw new Error(`Unavailable model: ${model}`);
  const budget = cappedBudget(createRuntimeBudget({ filePath: resolve('.prosper/usage.json') }), maxUsd);
  const output = join(dir, `comparison-${randomUUID()}`);
  await mkdir(output);
  await writeFile(join(output, 'config.json'), JSON.stringify({ variants, repeats, maxReferenceUsd: maxUsd, casesFile: join(dir, 'cases.json'), accounting: 'Shared ledger uses fixed reference rates, not model-specific provider prices.' }, null, 2));
  const results = [];
  let lastCall = Date.now(); // Also respect spacing after the live simulation's last call.
  try {
    for (const job of jobs) {
      await delay(Math.max(0, 5000 - (Date.now() - lastCall)));
      const current = await (await fetch('http://127.0.0.1:4173/api/state')).json();
      if (current.running || current.planner.activeCitizenId) throw new Error('Simulation resumed; stopping experiment.');
      lastCall = Date.now();
      const result = { ...await probeDecision({ ...job, budget, endpoint }), repeat: job.repeat };
      results.push(result);
      await appendFile(join(output, 'results.jsonl'), JSON.stringify(result) + '\n');
      console.log(JSON.stringify({ done: results.length, total: jobs.length, variant: result.variant, caseId: result.caseId, issues: result.assessment?.issues, actions: result.assessment?.actionTypes, error: result.error }));
    }
  } finally {
    const summary = { ...summarizeDecisions(results), referenceSpentUsd: budget.spent() };
    await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ output, ...summary }, null, 2));
  }
}
