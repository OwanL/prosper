// Read-only diagnostic for an observer capture. Audit sessions can cover more
// than the sampling window; report that scope separately rather than pool them.
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

if (!process.argv[2]) throw new Error('Usage: node scripts/summarize-run.mjs <observer-directory>');
const directory = resolve(process.argv[2]);
const summary = JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8'));
let first = summary.samples[0];
try {
  const before = JSON.parse(await readFile(join(directory, 'before.json'), 'utf8'));
  first = { tick: before.world.tick, stats: before.world.stats, chargedUsd: before.planner.budget?.chargedUsd };
} catch (error) { if (error.code !== 'ENOENT') throw error; }
let state;
try { state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const last = state ? { ...summary.samples.at(-1), tick: state.world.tick, stats: state.world.stats,
  citizens: state.world.citizens, chargedUsd: state.planner.budget?.chargedUsd } : summary.samples.at(-1);
const events = [];
for (const suffix of ['.2', '.1', '']) {
  try {
    for (const line of (await readFile(join(directory, `audit.jsonl${suffix}`), 'utf8')).trim().split('\n').filter(Boolean)) events.push(JSON.parse(line));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const sessionId = events.at(-1)?.sessionId;
const session = events.filter(e => e.sessionId === sessionId);
const plans = new Map();
for (const event of session.filter(e => e.planId)) {
  const plan = plans.get(event.planId) ?? { citizenId: event.citizenId, steps: 0, tools: 0, errors: [], contextUpdates: 0 };
  if (event.type === 'plan_dispatched') plan.dispatchedAt = event.recordedAt;
  if (event.type === 'agent_request') plan.steps++;
  if (event.type === 'agent_context_update') plan.contextUpdates++;
  if (event.type === 'agent_tool_result') {
    plan.tools++;
    if (event.result?.ok === false) plan.errors.push({ tool: event.tool, error: event.result.error });
  }
  if (['plan_applied', 'plan_rejected', 'plan_discarded'].includes(event.type)) {
    plan.outcome = event.type;
    plan.reason = event.reason;
    plan.durationSeconds = plan.dispatchedAt ? (Date.parse(event.recordedAt) - Date.parse(plan.dispatchedAt)) / 1000 : null;
  }
  plans.set(event.planId, plan);
}
const outcomes = Object.fromEntries(['plan_applied', 'plan_rejected', 'plan_discarded'].map(type => [type, [...plans.values()].filter(p => p.outcome === type).length]));
const errorGroups = new Map();
for (const plan of plans.values()) for (const error of plan.errors) {
  const key = `${error.tool}: ${error.error}`;
  errorGroups.set(key, (errorGroups.get(key) ?? 0) + 1);
}
console.log(JSON.stringify({
  samplingWindow: { startTick: first.tick, endTick: last.tick,
    statDeltas: Object.fromEntries(Object.entries(last.stats).map(([key, value]) => [key, value - (first.stats[key] ?? 0)])),
    ledgerDeltaUsd: last.chargedUsd - first.chargedUsd,
    accountingNote: summary.baseline === 'paused-before-play' ? 'Local reference delta from paused baseline, including in-flight settlement when captured; not a provider invoice.'
      : 'Local reference delta; first sample may include pending reservations or miss initial calls.',
    citizens: last.citizens.map(c => ({ id: c.id, health: c.health, food: c.food, bread: c.bread, wood: c.wood, current: c.order?.task ?? c.current ?? null })) },
  retainedAudit: { scope: 'Latest retained audit session; may extend beyond the sampling window or omit rotated records.', sessionId,
    firstRecordAt: session[0]?.recordedAt, lastRecordAt: session.at(-1)?.recordedAt, outcomes,
    reasoningResponses: session.filter(e => e.type === 'agent_response' && e.reasoning?.characters > 0).length,
    contextUpdates: session.filter(e => e.type === 'agent_context_update').length,
    errors: [...errorGroups].map(([error, count]) => ({ error, count })).sort((a, b) => b.count - a.count),
    turns: [...plans.entries()].map(([id, plan]) => ({ id, ...plan })) },
}, null, 2));
