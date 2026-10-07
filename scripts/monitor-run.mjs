// Compact continuous telemetry. Read-only across server reloads and world resets;
// it never starts/replaces a process or changes controls in response to a timeout.
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { auditEvidence } from '../lib/monitor-evidence.mjs';

const seconds = Number(process.argv.find(a => a.startsWith('--seconds='))?.slice(10) ?? 21600);
if (!Number.isSafeInteger(seconds) || seconds < 30 || seconds > 43200) throw new Error('seconds must be 30..43200.');
const url = process.env.PROSPER_URL || 'http://127.0.0.1:4173';
const output = resolve('.prosper/experiments', `monitor-${randomUUID()}`);
await mkdir(output, { recursive: true });
const started = Date.now(); let previousTick = -1, segment = 0, polls = 0, disconnected = 0, lastCapture = 0, lastHeartbeat = 0;
const retainedAudit = new Set();
async function retainEvidence(auditPath) {
  if (!auditPath) return;
  const events = [];
  for (const suffix of ['.2', '.1', '']) {
    let contents;
    try { contents = await readFile(`${auditPath}${suffix}`, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const line of contents.split('\n')) {
      if (!line.trim()) continue;
      const key = createHash('sha256').update(line).digest('hex');
      if (retainedAudit.has(key)) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; } // An interrupted append can end in a partial line.
      retainedAudit.add(key);
      events.push(JSON.stringify(auditEvidence(event)));
    }
  }
  if (events.length) await appendFile(join(output, 'events.jsonl'), events.join('\n') + '\n');
  while (retainedAudit.size > 30000) retainedAudit.delete(retainedAudit.values().next().value);
}
console.log(JSON.stringify({ output, seconds, readOnly: true }));
do {
  const at = new Date().toISOString();
  try {
    const response = await fetch(`${url}/api/state`, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = await response.json(), planner = state.planner, world = state.world;
    if (world.tick < previousTick) segment++;
    previousTick = world.tick; polls++;
    const record = { at, segment, tick: world.tick, running: state.running, speed: state.speed, stats: world.stats,
      planner: { connection: planner.connection, completed: planner.completed, failed: planner.failed, discarded: planner.discarded,
        active: planner.activeCitizenIds, meanTurnMs: planner.meanTurnMs, metrics: planner.toolHarness, budget: planner.budget,
        errors: planner.activeErrors },
      citizens: world.citizens.map(c => ({ id: c.id, name: c.name, alive: c.alive, adult: c.adult, health: c.health, hunger: c.hunger,
        food: c.food, wood: c.wood, bread: c.bread, tool: c.toolLevel, shoes: c.shoesLevel, weapon: c.weaponLevel,
        activity: c.activity, order: c.order?.task, queue: c.tasks, work: c.work, goals: c.goals, undertaking: c.undertaking,
        planning: c.planning, reviews: c.reviewCalls, error: c.lastError })) };
    record.queue = planner.citizens?.filter(c => c.eligible).map(c => ({ id: c.id, priority: c.priority, reason: c.reason, waitMs: c.queueWaitMs })) ?? [];
    try { await retainEvidence(planner.audit?.filePath); }
    catch (error) { record.auditRetentionError = error.code ?? 'Audit read failed'; }
    await appendFile(join(output, 'samples.jsonl'), JSON.stringify(record) + '\n');
    await writeFile(join(output, 'latest.json'), JSON.stringify(record, null, 2));
    if (Date.now() - lastCapture >= 120000 || !lastCapture) {
      await writeFile(join(output, 'state-latest.json'), JSON.stringify(state)); lastCapture = Date.now();
    }
    if (Date.now() - lastHeartbeat >= 60000 || !lastHeartbeat) {
      console.log(JSON.stringify({ at, segment, tick: world.tick, running: state.running, completed: planner.completed,
        failed: planner.failed, errors: planner.activeErrors.length, population: world.citizens.filter(c => c.alive).length,
        messages: world.stats.messages, trades: world.stats.trades, births: world.stats.births, deaths: world.stats.deaths,
        attacks: world.stats.attacks, chargedUsd: planner.budget?.chargedUsd }));
      lastHeartbeat = Date.now();
    }
  } catch (error) {
    disconnected++;
    await appendFile(join(output, 'samples.jsonl'), JSON.stringify({ at, segment, connectionError: error.message }) + '\n');
    console.log(JSON.stringify({ at, connectionError: error.message, waitingForSameServer: true }));
  }
  await delay(Math.min(15000, Math.max(0, started + seconds * 1000 - Date.now())));
} while (Date.now() < started + seconds * 1000);
await writeFile(join(output, 'summary.json'), JSON.stringify({ polls, disconnected, segments: segment + 1, seconds, readOnly: true }, null, 2));
console.log(JSON.stringify({ output, finished: true, polls, disconnected }));
