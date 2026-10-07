// Read-only causal review of a retained monitor. Cohorts use dispatch tick,
// rather than mixing turns started before/after the selected interval.
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { auditEvidence } from '../lib/monitor-evidence.mjs';

const args = process.argv.slice(2), directory = args.find(a => !a.startsWith('--'));
if (!directory) throw new Error('Usage: review-run.mjs <monitor-directory> [--from=tick] [--to=tick] [--citizen=id] [--save]');
const option = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const from = Number(option('from', 0)), to = Number(option('to', Number.MAX_SAFE_INTEGER)), citizen = option('citizen', null);
if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) throw new Error('Invalid tick interval.');
const plans = new Map(), seen = new Set(), deaths = [], trace = [], samples = [];
async function* records(file) {
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    try { yield { line, event: JSON.parse(line) }; } catch { /* Interrupted append: omit incomplete record. */ }
  }
}
for await (const { line, event: e } of records(join(directory, 'events.jsonl'))) {
  const key = createHash('sha256').update(line).digest('hex');
  if (seen.has(key)) continue;
  seen.add(key);
  if (e.type === 'world_event' && e.tick >= from && e.tick <= to && /^[^\r\n]+ died\. (?:Their carried resources were lost\.|[^\r\n]+ received [^\r\n]+'s food and wood(?: and bread)?\.)$/.test(e.text ?? '')) deaths.push({ tick: e.tick, at: e.recordedAt, citizenId: e.citizenId, text: e.text });
  if (citizen && e.citizenId === citizen && e.tick >= from && e.tick <= to) trace.push(auditEvidence(e));
  if (!e.planId) continue;
  if (!plans.has(e.planId)) plans.set(e.planId, { id: e.planId, citizenId: e.citizenId, calls: 0, tools: {}, errors: {}, mechanics: {}, parts: {}, requestsWithParts: 0, latencies: [], input: 0, output: 0, bytes: 0 });
  const p = plans.get(e.planId);
  if (e.type === 'plan_dispatched') Object.assign(p, { tick: e.tick, started: Date.parse(e.recordedAt), cause: e.reason, queueMs: e.queueWaitMs });
  if (['plan_applied', 'plan_rejected', 'plan_discarded'].includes(e.type)) Object.assign(p, { ended: Date.parse(e.recordedAt), terminalTick: e.tick, status: e.type, reason: e.reason });
  if (e.type === 'agent_response') {
    p.calls++; p.input += e.usage?.prompt_tokens ?? 0; p.output += e.usage?.completion_tokens ?? 0;
    for (const call of e.toolCalls ?? []) if (call.function?.name === 'get_mechanics') {
      try { const action = JSON.parse(call.function.arguments).action; if (typeof action === 'string') p.mechanics[action] = (p.mechanics[action] ?? 0) + 1; }
      catch { /* Malformed arguments remain tool errors, not a query category. */ }
    }
  }
  if (e.type === 'agent_request' && e.requestParts) {
    p.requestsWithParts++;
    for (const [part, size] of Object.entries(e.requestParts)) if (Number.isFinite(size)) p.parts[part] = (p.parts[part] ?? 0) + size;
  }
  if (e.type === 'provider_timing') { p.latencies.push(e.latencyMs); p.bytes += e.promptBytes ?? 0; }
  if (e.type === 'agent_tool_result') {
    p.tools[e.tool] = (p.tools[e.tool] ?? 0) + 1;
    if (e.result?.ok === false) p.errors[e.result.error] = (p.errors[e.result.error] ?? 0) + 1;
  }
}
for await (const { event: s } of records(join(directory, 'samples.jsonl'))) {
  if (!s.stats || s.tick < from || s.tick > to) continue;
  samples.push({ at: s.at, tick: s.tick, stats: s.stats, ...(citizen ? { citizen: s.citizens?.find(c => c.id === citizen) } : {}) });
}
const cohort = [...plans.values()].filter(p => p.tick >= from && p.tick <= to);
const distribution = values => {
  const numbers = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!numbers.length) return { count: 0 };
  return { count: numbers.length, mean: numbers.reduce((a, b) => a + b, 0) / numbers.length,
    median: numbers[Math.ceil(numbers.length * .5) - 1], p95: numbers[Math.ceil(numbers.length * .95) - 1], max: numbers.at(-1) };
};
const count = values => values.reduce((out, key) => { out[key] = (out[key] ?? 0) + 1; return out; }, {});
const merge = field => cohort.reduce((out, p) => { for (const [key, n] of Object.entries(p[field])) out[key] = (out[key] ?? 0) + n; return out; }, {});
const first = samples[0], last = samples.at(-1);
const summary = { from, to, cohortTurns: cohort.length, causes: count(cohort.map(p => p.cause)), statuses: count(cohort.map(p => p.status ?? 'incomplete')),
  terminalProblems: cohort.filter(p => ['plan_rejected', 'plan_discarded'].includes(p.status)).map(p => ({ id: p.id, citizenId: p.citizenId, tick: p.tick, dispatchTick: p.tick, terminalTick: p.terminalTick, status: p.status, reason: p.reason })),
  queueMs: distribution(cohort.map(p => p.queueMs)), turnMs: distribution(cohort.filter(p => p.status === 'plan_applied').map(p => p.ended - p.started)),
  callMs: distribution(cohort.flatMap(p => p.latencies)), calls: cohort.reduce((n, p) => n + p.calls, 0),
  inputTokens: cohort.reduce((n, p) => n + p.input, 0), outputTokens: cohort.reduce((n, p) => n + p.output, 0), tools: merge('tools'), mechanicsQueries: merge('mechanics'),
  requestParts: { measuredRequests: cohort.reduce((n, p) => n + p.requestsWithParts, 0), bytes: merge('parts'), note: 'Serialized wire bytes, not provider template or tokenizer attribution. Old records may lack measurements.' },
  errors: merge('errors'), deaths,
  sampledChange: first && last ? { first: { at: first.at, tick: first.tick }, last: { at: last.at, tick: last.tick },
    stats: Object.fromEntries(Object.entries(last.stats).map(([key, value]) => [key, value - (first.stats[key] ?? 0)])) } : null,
  limitations: 'Dispatch cohort and retained records only; incomplete turns remain explicit. Sample deltas use the displayed sample ticks. Different populations/actions and concurrent probes prevent causal attribution of latency or behavior.' };
if (args.includes('--save')) {
  const output = resolve('.prosper/experiments', `review-${randomUUID()}`);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  if (citizen) await writeFile(join(output, 'citizen.json'), JSON.stringify({ citizen, trace, samples }, null, 2));
  summary.artifact = output;
}
console.log(JSON.stringify(summary));
