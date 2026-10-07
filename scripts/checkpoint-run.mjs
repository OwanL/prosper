// A fresh checkpoint, never a reset or an automatic process restart.
// --pause explicitly pauses ticking/new turns, then lets active turns drain.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const url = process.env.PROSPER_URL || 'http://127.0.0.1:4173';
const pause = process.argv.includes('--pause');
const seconds = Number(process.argv.find(a => a.startsWith('--seconds='))?.slice(10) ?? 45);
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) throw new Error('seconds must be1..60');
if (pause) {
  const response = await fetch(`${url}/api/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pause' }) });
  if (!response.ok) throw new Error(`Pause failed HTTP${response.status}`);
}
const until = Date.now() + seconds * 1000;
let state;
do {
  const response = await fetch(`${url}/api/state`, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error(`State failed HTTP${response.status}`);
  state = await response.json();
  if (state.running !== false) throw new Error('The town is running; pause it first or explicitly pass --pause. Nothing was captured.');
  if (!state.planner.activeCitizenId && !state.planner.activeCitizenIds?.length && !state.world.citizens.some(c => c.planning)) break;
  await delay(1000);
} while (Date.now() < until);
if (state.planner.activeCitizenId || state.planner.activeCitizenIds?.length || state.world.citizens.some(c => c.planning)) {
  throw new Error(`Town remains paused at tick${state.world.tick}; active turns have not drained. Leave the server alive and retry capture. No checkpoint was written.`);
}
if (!Number.isSafeInteger(state.world.tick) || state.world.tick < 0) throw new Error('Invalid world tick; nothing was captured.');
const directory = fileURLToPath(new URL(`../.prosper/experiments/overnight-reload-${randomUUID()}/`, import.meta.url));
await mkdir(directory, { recursive: true });
const file = join(directory, 'restart.json');
await writeFile(file, JSON.stringify(state), { flag: 'wx' });
console.log(JSON.stringify({ file, tick: state.world.tick, speed: state.speed, living: state.world.citizens.length, stats: state.world.stats,
  chargedUsd: state.planner.budget?.chargedUsd, paused: true, drained: true }));
