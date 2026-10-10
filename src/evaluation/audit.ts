import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { World } from '../shared/types.ts';
import { totalGold } from './fixtures.ts';
export function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function sourceIdentity() {
  const src = fileURLToPath(new URL('../', import.meta.url));
  const files: Record<string, string> = {};
  for (const directory of ['world', 'shared', 'citizen'])
    for (const entry of readdirSync(join(src, directory)).sort())
      if (entry.endsWith('.ts')) files[`${directory}/${entry}`] = createHash('sha256').update(readFileSync(join(src, directory, entry))).digest('hex');
  for (const entry of ['contracts.ts', 'runner.ts', 'fixtures.ts', 'audit.ts', 'mechanics.ts', 'reference.ts'])
    files[`evaluation/${entry}`] = createHash('sha256').update(readFileSync(join(src, 'evaluation', entry))).digest('hex');
  const candidates = join(src, 'evaluation', 'candidates');
  for (const entry of readdirSync(candidates).sort())
    if (entry.endsWith('.ts')) files[`evaluation/candidates/${entry}`] = createHash('sha256').update(readFileSync(join(candidates, entry))).digest('hex');
  const contract = readFileSync(new URL('../../docs/research/decision-harness-contract.md', import.meta.url));
  return { sha256: hash(files), files, contractSha256: createHash('sha256').update(contract).digest('hex') };
}
export function auditState(world: World, actorId: string) {
  const actor = world.citizens[actorId];
  return {
    stateHash: hash(world), tick: world.tick, totalGold: totalGold(world), initialGold: world.initialGold,
    actor: { alive: actor.alive, health: actor.health, fullness: actor.fullness, gold: actor.gold,
      inventory: actor.inventory, action: actor.action, queue: actor.queue },
    holders: Object.values(world.citizens).map(c => ({ id: c.id, alive: c.alive, health: c.health, fullness: c.fullness, gold: c.gold, inventory: c.inventory, reserved: c.action?.reserved })),
    orders: world.orders, loot: world.loot,
    /** Coverage is deliberately not represented as a complete emission sink. */
    eventCoverage: 'bounded-ring-not-exhaustive',
  };
}
export class TraceWriter {
  private eventIds = new Set<string>();
  constructor(readonly path: string) {}
  append(kind: string, world: World, actorId: string, detail: Record<string, unknown> = {}) {
    const events = world.events.filter(event => !this.eventIds.has(event.id));
    this.eventIds = new Set(world.events.map(event => event.id));
    const record = { kind, ...detail, ...auditState(world, actorId), events };
    appendFileSync(this.path, JSON.stringify(record) + '\n', { encoding: 'utf8', mode: 0o600 });
  }
}
