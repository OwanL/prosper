// Read-only sampling by default; --pause-at-end explicitly ends a trial.
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const args = process.argv.slice(2);
const seconds = Number(args.find(a => a.startsWith('--seconds='))?.split('=')[1] ?? 180);
if (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600) throw new Error('seconds must be 10..3600');
const url = process.env.PROSPER_URL || 'http://127.0.0.1:4173';
const output = resolve('.prosper/experiments', `observed-${randomUUID()}`);
await mkdir(output, { recursive: true });
const read = async () => { const response = await fetch(`${url}/api/state`); if (!response.ok) throw new Error(`State HTTP ${response.status}`); return response.json(); };
const samples = [];
let before;
if (args.includes('--play')) {
  before = await read();
  if (before.running || before.planner.activeCitizenId) throw new Error('--play requires a paused world with no turn in flight.');
  await writeFile(join(output, 'before.json'), JSON.stringify(before));
  const response = await fetch(`${url}/api/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'play' }) });
  if (!response.ok) throw new Error(`Play HTTP ${response.status}`);
  await response.json();
}
console.log(JSON.stringify({ output, seconds, play: args.includes('--play'), pauseAtEnd: args.includes('--pause-at-end') }));
for (let elapsed = 0; elapsed <= seconds; elapsed += 10) {
  if (elapsed) await delay(10000);
  const state = await read();
  await writeFile(join(output, `sample-${String(samples.length).padStart(3, '0')}.json`), JSON.stringify(state));
  const sample = { elapsed, tick: state.world.tick, running: state.running, connection: state.planner.connection,
    requests: state.planner.requests, completed: state.planner.completed, failed: state.planner.failed, discarded: state.planner.discarded,
    toolHarness: state.planner.toolHarness, stats: state.world.stats, chargedUsd: state.planner.budget?.chargedUsd,
    citizens: state.world.citizens.map(c => ({ id: c.id, health: c.health, hunger: c.hunger, food: c.food, bread: c.bread, wood: c.wood,
      activity: c.activity, current: c.order?.task ?? null, goals: c.goals, error: c.lastError, calls: c.reviewCalls ?? 0 })) };
  samples.push(sample);
  console.log(JSON.stringify(sample));
  if (state.planner.connection === 'error') break;
}
let final;
if (args.includes('--pause-at-end')) {
  await fetch(`${url}/api/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pause' }) });
  for (let i = 0; i < 120 && (await read()).planner.activeCitizenId; i++) await delay(1000);
  final = await read();
  await writeFile(join(output, 'state.json'), JSON.stringify(final));
}
for (const suffix of ['', '.1', '.2']) {
  try { await copyFile(resolve(`.prosper/audit.jsonl${suffix}`), join(output, `audit.jsonl${suffix}`)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await writeFile(join(output, 'summary.json'), JSON.stringify({ samples, baseline: before ? 'paused-before-play' : 'first-sample',
  referenceSpentUsd: (final?.planner.budget?.chargedUsd ?? samples.at(-1).chargedUsd) - (before?.planner.budget?.chargedUsd ?? samples[0].chargedUsd) }, null, 2));
