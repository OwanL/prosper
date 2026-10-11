import { createWorld, tickWorld } from '../src/world/core.ts';
import { custody, validateCheckpoint, fingerprint } from './evaluate-composed.ts';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function evaluateMarketFamily(seed: number, ticks = 2000, deadline = Infinity) {
  const world = createWorld({ seed, population: 20, controllerMode: 'composed', runId: `market-family-${seed}` });
  const counts: Record<string, number> = {}, failures: Record<string, number> = {};
  const increment = (book: Record<string, number>, key: string) => { book[key] = (book[key] ?? 0) + 1; };
  const seenEvents = new Set<string>(), seenTrace = new Set<string>(), seenTasks = new Set<string>();
  const trades: unknown[] = [], quotes: unknown[] = [], family: unknown[] = [], busy: unknown[] = [];
  const prices: number[] = [], bids: number[] = [], spreads: number[] = [];
  const positions = new Map<string, { x: number; y: number }>(), tiles = new Map<string, Set<string>>();
  const distance: Record<string, number> = {}, exploreDistance: Record<string, number> = {};
  const checkpoints = [validateCheckpoint(world)]; let maxGoldError = 0;
  const start = performance.now();
  while (world.tick < ticks && performance.now() < deadline) {
    tickWorld(world);
    for (const event of [...world.events, ...(world.significantEvents ?? [])]) if (!seenEvents.has(event.id)) {
      seenEvents.add(event.id); increment(counts, `event:${event.kind}`);
      if (event.kind === 'trade') { trades.push(event); const match = event.text.match(/sold for ([\d.]+) gold each/); if (match) prices.push(Number(match[1])); }
      if (/birth|death|kill/.test(event.kind)) family.push(event);
    }
    for (const c of Object.values(world.citizens)) {
      const prior = positions.get(c.id); const step = prior ? Math.abs(c.x - prior.x) + Math.abs(c.y - prior.y) : 0;
      distance[c.id] = (distance[c.id] ?? 0) + step;
      const active = c.mind?.tasks.find(t => t.id === c.mind?.activeTaskId);
      if (active?.definitionId === 'Explore') exploreDistance[c.id] = (exploreDistance[c.id] ?? 0) + step;
      positions.set(c.id, { x: c.x, y: c.y });
      const visited = tiles.get(c.id) ?? new Set<string>(); visited.add(`${c.x},${c.y}`); tiles.set(c.id, visited);
      for (const task of c.mind?.tasks ?? []) if (task.status !== 'running' && !seenTasks.has(task.id)) {
        seenTasks.add(task.id); increment(counts, `${task.definitionId}:${task.status}`);
        if (task.status === 'failed') increment(failures, `${task.definitionId}: ${task.reason}`);
        if (/competitor|public work|depleted|reserved|tool|faster|speed/i.test(task.reason ?? '')) busy.push({ actor: c.id, tick: world.tick, task: structuredClone(task) });
      }
      // Spectator-only aggregation; nothing here feeds controller decisions.
      for (const trace of c.mind?.trace ?? []) {
        const key = `${c.id}:${JSON.stringify(trace)}`; if (seenTrace.has(key)) continue; seenTrace.add(key);
        increment(counts, `trace:${trace.definitionId}:${trace.transition}`);
        // Terminal tasks above count failures once; traces are a separate transition metric.
        if (trace.command) increment(counts, `command:${trace.command.type}`);
        if (trace.command?.type === 'order') { quotes.push({ actor: c.id, ...trace }); if (trace.command.side === 'buy') bids.push(trace.command.price); }
        if (trace.definitionId === 'Reproduce') family.push({ actor: c.id, ...trace });
        if (/busy|conflict|tool|faster|speed/i.test(trace.reason)) busy.push({ actor: c.id, ...trace });
      }
    }
    // Approximate contemporaneous top-of-book spreads; remote market, unweighted tick samples.
    const orders = Object.values(world.orders);
    for (const item of new Set(orders.map(o => o.item))) {
      const buys = orders.filter(o => o.item === item && o.side === 'buy'), sells = orders.filter(o => o.item === item && o.side === 'sell');
      if (buys.length && sells.length) spreads.push(Math.min(...sells.map(o => o.price)) - Math.max(...buys.map(o => o.price)));
    }
    maxGoldError = Math.max(maxGoldError, Math.abs(custody(world).goldDelta));
    if (world.tick % 100 === 0) checkpoints.push(validateCheckpoint(world));
  }
  if (checkpoints.at(-1)?.tick !== world.tick) checkpoints.push(validateCheckpoint(world));
  const distribution = (values: number[]) => { const sorted = [...values].sort((a,b) => a-b); return { n: sorted.length, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1), histogram: values.reduce<Record<string,number>>((a,v) => { increment(a, String(v)); return a; }, {}) }; };
  const actors = Object.values(world.citizens).map(c => ({ id: c.id, alive: c.alive, parents: c.parents, knownTiles: Object.keys(c.knowledge).length, uniqueVisited: tiles.get(c.id)?.size ?? 0, distance: distance[c.id] ?? 0, exploreDistance: exploreDistance[c.id] ?? 0, lastResult: c.lastResult, consent: c.consent }));
  return { seed, ticks: world.tick, elapsedMs: performance.now() - start, living: actors.filter(c => c.alive).length, births: actors.filter(c => c.parents.length).length, counts, failures, prices: distribution(prices), bids: distribution(bids), spreads: distribution(spreads), maxGoldError, custody: custody(world), checkpoints, fingerprint: fingerprint(world), actors, trades, quotes, family, busy };
}
function snapshot() { const dirty = execFileSync('git', ['status','--short'], { encoding: 'utf8' }); return { revision: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), dirty, diffHash: createHash('sha256').update(execFileSync('git',['diff','HEAD'])).digest('hex') }; }
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = mkdtempSync(join(tmpdir(), 'prosper-market-family-'));
  const before = snapshot(), deadline = performance.now() + 270_000;
  const runs = [1,7,42].map(seed => evaluateMarketFamily(seed,2000,deadline));
  const file = join(directory,'report.json'); writeFileSync(file, JSON.stringify({before,after:snapshot(),runs},null,2));
  console.log(JSON.stringify({file,runs:runs.map(({actors,trades,quotes,family,busy,...summary}) => ({...summary, exploration: actors.map(a => ({id:a.id,known:a.knownTiles,visited:a.uniqueVisited,distance:a.distance,exploreDistance:a.exploreDistance})), familyEvidence:family.slice(-20),busyEvidence:busy.slice(-10)}))},null,2));
}
