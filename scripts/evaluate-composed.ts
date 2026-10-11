import { createWorld, tickWorld } from '../src/world/core.ts';
import type { World } from '../src/shared/types.ts';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function custody(world: World) {
  let gold = 0;
  const items: Record<string, number> = {};
  const add = (inventory: Record<string, number>) => { for (const [key, n] of Object.entries(inventory)) items[key] = (items[key] ?? 0) + n; };
  for (const c of Object.values(world.citizens)) { gold += c.gold; add(c.inventory); if (c.action) add(c.action.reserved); }
  for (const o of Object.values(world.orders)) { gold += o.escrowGold; add(o.escrowItems); }
  for (const l of Object.values(world.loot)) { gold += l.gold; add(l.inventory); }
  for (const b of Object.values(world.buildings)) add(b.materials);
  return { gold, goldDelta: gold - world.initialGold, items, valid: Number.isFinite(gold) && Object.values(items).every(n => Number.isFinite(n) && n >= 0) };
}
export function fingerprint(world: World) { return createHash('sha256').update(JSON.stringify(world)).digest('hex'); }

// Checkpoint validation: custody alone is not a full conservation proof, so re-check
// serializability, numeric finiteness, vital bounds and gold custody periodically.
type Checkpoint = { tick: number; ok: boolean; issues: string[] };
function scanNonFinite(value: unknown, path: string, issues: string[]) {
  if (issues.length >= 5) return;
  if (typeof value === 'number' && !Number.isFinite(value)) { issues.push(`non-finite number at ${path}`); return; }
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) scanNonFinite(value[i], `${path}[${i}]`, issues); }
  else if (value && typeof value === 'object') { for (const [k, v] of Object.entries(value)) scanNonFinite(v, `${path}.${k}`, issues); }
}
export function validateCheckpoint(world: World) {
  const issues: string[] = [];
  try {
    const serialized = JSON.stringify(world); // throws on timers, cycles, BigInt etc.
    if (JSON.stringify(JSON.parse(serialized)) !== serialized) issues.push('json round-trip mismatch');
  } catch (error) { issues.push(`not serializable: ${(error as Error).message}`); }
  scanNonFinite(world, 'world', issues);
  const account = custody(world);
  if (!account.valid) issues.push('invalid custody');
  if (Math.abs(account.goldDelta) > 1e-9) issues.push(`gold drifted ${account.goldDelta}`);
  for (const c of Object.values(world.citizens)) {
    if (!(c.health >= 0 && c.health <= 100) || !(c.fullness >= 0 && c.fullness <= 100)) issues.push(`${c.id} vitals out of range health=${c.health} fullness=${c.fullness}`);
    if (c.alive && c.health <= 0) issues.push(`${c.id} alive with health ${c.health} after settlement`);
  }
  return { tick: world.tick, ok: issues.length === 0, issues } satisfies Checkpoint;
}

const PROGRESSION = ['ObtainFoodNow', 'ObtainResource', 'ObtainTool', 'Harvest', 'RefineResource', 'CraftTool', 'BuildResourceBuilding', 'BuildHouse', 'BuildWall', 'SellItem', 'GiveGift', 'Explore', 'Reproduce', 'AttackCitizen', 'CreateTerritory', 'ExpandTerritory', 'JoinTerritory', 'LeaveTerritory'];
function progression(outcomes: Record<string, number>, repeats: Record<string, number>) {
  const summary: Record<string, { succeeded: number; failed: number }> = {};
  for (const id of PROGRESSION) {
    const succeeded = outcomes[`${id}:succeeded`] ?? 0, failed = outcomes[`${id}:failed`] ?? 0;
    if (succeeded || failed || repeats[id]) summary[id] = { succeeded, failed };
  }
  return summary;
}
export function evaluate(seed: number, population: number, ticks: number, deadline = Infinity) {
  const world = createWorld({ seed, population, controllerMode: 'composed', runId: `composed-eval-${seed}-${population}` });
  const initial = custody(world);
  const events: Record<string, number> = {}, outcomes: Record<string, number> = {}, repeats: Record<string, number> = {};
  const seenEvents = new Set<string>(), seenOutcomes = new Set<string>(), seenTasks = new Set<string>();
  const lastGoal = new Map<string, string>();
  const evidence: unknown[] = [], failures: unknown[] = [], checkpoints: Checkpoint[] = [];
  let maxGoldError = 0, invalidCustodyTicks = 0;
  const validate = () => { if (checkpoints[checkpoints.length - 1]?.tick !== world.tick) checkpoints.push(validateCheckpoint(world)); };
  validate(); // tick-0 baseline
  const start = performance.now();
  while (world.tick < ticks && performance.now() < deadline) {
    tickWorld(world);
    if (world.tick % 100 === 0) validate();
    for (const e of [...world.events, ...world.significantEvents ?? []]) if (!seenEvents.has(e.id)) {
      seenEvents.add(e.id); const key = e.kind === 'completion' ? `${e.kind}:${e.text}` : e.kind;
      events[key] = (events[key] ?? 0) + 1;
    }
    for (const c of Object.values(world.citizens)) {
      for (const t of c.mind?.tasks ?? []) {
        if (!seenTasks.has(t.id)) { seenTasks.add(t.id); const goal = `${t.definitionId}:${t.request.resource}:${t.request.tier}:${t.targetId ?? ''}`;
          if (lastGoal.get(c.id) === goal) repeats[t.definitionId] = (repeats[t.definitionId] ?? 0) + 1;
          lastGoal.set(c.id, goal);
        }
        if (t.status !== 'running' && !seenOutcomes.has(t.id)) { seenOutcomes.add(t.id); const key = `${t.definitionId}:${t.status}`; outcomes[key] = (outcomes[key] ?? 0) + 1;
          if (t.status === 'failed' && failures.length < 30) failures.push({ actor: c.id, tick: world.tick, task: structuredClone(t), trace: structuredClone(c.mind?.trace.slice(-6)), lastResult: c.lastResult });
        }
      }
    }
    const account = custody(world); maxGoldError = Math.max(maxGoldError, Math.abs(account.goldDelta)); if (!account.valid) invalidCustodyTicks++;
    if (world.tick % 250 === 0) evidence.push({ tick: world.tick, actors: Object.values(world.citizens).map(c => ({ id: c.id, alive: c.alive, health: c.health, fullness: c.fullness, gold: c.gold, inventory: c.inventory, action: c.action?.command, active: c.mind?.tasks.find(t => t.id === c.mind?.activeTaskId), trace: c.mind?.trace.slice(-4), lastResult: c.lastResult })) });
  }
  validate(); // final checkpoint even when the horizon is not a 100-tick boundary
  const citizens = Object.values(world.citizens), elapsedMs = performance.now() - start;
  return { seed, founders: population, requestedTicks: ticks, ticks: world.tick, elapsedMs, ticksPerSecond: world.tick / elapsedMs * 1000,
    living: citizens.filter(c => c.alive).length, dead: citizens.filter(c => !c.alive).length, born: citizens.filter(c => c.parents.length).length,
    events, outcomes, repeats, progression: progression(outcomes, repeats), initial, final: custody(world), maxGoldError, invalidCustodyTicks,
    checkpoints: checkpoints.map(({ tick, ok, issues }) => ({ tick, ok, issues })), checkpointFailures: checkpoints.filter(c => !c.ok).length,
    territories: Object.keys(world.territories ?? {}).length, houses: Object.keys(world.houses ?? {}).length, buildings: Object.keys(world.buildings).length,
    fingerprint: fingerprint(world), failures, evidence,
    finalActors: citizens.map(c => ({ id: c.id, alive: c.alive, fullness: c.fullness, health: c.health, gold: c.gold, inventory: c.inventory, active: c.mind?.tasks.find(t => t.id === c.mind?.activeTaskId), trace: c.mind?.trace.slice(-10), lastResult: c.lastResult })) };
}
function snapshot() { return { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }), diffHash: createHash('sha256').update(execFileSync('git', ['diff', 'HEAD'])).digest('hex') }; }
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = mkdtempSync(join(tmpdir(), 'prosper-composed-eval-'));
  const before = snapshot(), deadline = performance.now() + 270_000; // shared ceiling well inside the 5-minute budget
  const runs = [1, 7, 42].map(seed => evaluate(seed, 20, 1500, deadline));
  const throughput = evaluate(7, 100, 300, deadline);
  const replay = evaluate(1, 20, runs[0]!.ticks, deadline);
  const report = { before, after: snapshot(), runs, throughput, determinism: { ticks: replay.ticks, comparedTicks: runs[0]!.ticks, equal: replay.ticks === runs[0]!.ticks && replay.fingerprint === runs[0]!.fingerprint }, replay };
  const file = join(directory, 'report.json'); writeFileSync(file, JSON.stringify(report, null, 2));
  const checkpointSummary = [...runs, throughput].map(r => `${r.seed}/${r.founders}: ${r.checkpoints.length} checkpoints, ${r.checkpointFailures} failed`);
  console.log(JSON.stringify({ file, checkpointSummary, runs: [...runs, throughput].map(({ evidence, finalActors, failures, checkpoints, ...summary }) => summary), determinism: report.determinism }, null, 2));
}