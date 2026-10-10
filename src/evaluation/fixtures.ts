import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Command, CommandResult, World } from '../shared/types.ts';
import { CARRIED_ITEM_RE } from '../shared/tiers.ts';
import { commandSchema } from '../citizen/tools.ts';
import { createWorld, dispatch, type WorldControlOptions } from '../world/core.ts';
import { updateKnowledge, validateKnownCommand } from '../world/observation.ts';
import { BALANCE } from '../world/config.ts';

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const overrideSchema = z.object({
  citizenIndex: integer,
  position: z.object({ x: integer, y: integer }).strict().optional(),
  health: z.number().min(0).max(BALANCE.maxHealth).optional(),
  fullness: z.number().min(0).max(BALANCE.maxFullness).optional(),
  gold: integer.optional(),
  inventory: z.record(z.string().regex(CARRIED_ITEM_RE), integer).optional(),
}).strict();
export const fixtureSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  split: z.enum(['development', 'held-out']),
  provenance: z.string().min(1),
  creation: z.object({
    seed: z.number().int().min(0).max(0xffffffff),
    scenario: z.enum(['village', 'competition', 'progression']),
    population: z.number().int().min(1).max(250),
    autonomy: z.boolean(),
  }).strict(),
  actorIndex: integer,
  horizon: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  cadence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  authorities: z.array(z.enum(['direct', 'passive-body'])),
  newbornAuthority: z.literal('passive-body'),
  objective: z.object({
    description: z.string().min(1),
    minHealth: z.number().min(0).max(BALANCE.maxHealth),
    minFullness: z.number().min(0).max(BALANCE.maxFullness),
  }).strict(),
  overrides: z.array(overrideSchema),
  setup: z.array(z.object({ citizenIndex: integer, command: commandSchema }).strict()),
  allowedCommands: z.array(z.enum(commandSchema.options.map(s => s.shape.type.value) as [string, ...string[]])).optional(),
}).strict();
export type FixtureManifest = z.infer<typeof fixtureSchema>;
export interface SetupRecord { citizenId: string; command: import('../shared/types.ts').Command; knownResult: CommandResult; dispatchResult: CommandResult; stateHash?: string }
export function totalGold(world: World): number {
  return Object.values(world.citizens).reduce((n, c) => n + c.gold, 0)
    + Object.values(world.orders).reduce((n, o) => n + o.escrowGold, 0)
    + Object.values(world.loot).reduce((n, l) => n + l.gold, 0);
}
export function initializeFixture(input: unknown) {
  const manifest = fixtureSchema.parse(input);
  if (manifest.authorities.length !== manifest.creation.population || manifest.actorIndex >= manifest.creation.population)
    throw new Error('Fixture must list authority for every created citizen and a valid actor index');
  if (manifest.authorities[manifest.actorIndex] !== 'direct') throw new Error('Actor authority must be direct');
  if (manifest.authorities.some((a, i) => i !== manifest.actorIndex && a !== 'passive-body'))
    throw new Error('Initial slice requires passive-body peers');
  const world = createWorld({ ...manifest.creation, runId: `evaluation-${manifest.id}` });
  const ids = Object.keys(world.citizens);
  const options: WorldControlOptions = { authority: {
    citizens: Object.fromEntries(ids.map((id, i) => [id, manifest.authorities[i]])),
    newbornAuthority: manifest.newbornAuthority,
  } };
  const seen = new Set<number>();
  for (const override of manifest.overrides) {
    if (override.citizenIndex >= ids.length || seen.has(override.citizenIndex)) throw new Error('Unknown or duplicate override citizen');
    seen.add(override.citizenIndex);
    const citizen = world.citizens[ids[override.citizenIndex]];
    if (override.position) {
      if (override.position.x >= world.width || override.position.y >= world.height) throw new Error('Position outside world');
      Object.assign(citizen, override.position);
    }
    for (const key of ['health', 'fullness', 'gold'] as const)
      if (override[key] !== undefined) citizen[key] = override[key];
    if (override.inventory) citizen.inventory = { ...override.inventory };
  }
  for (const citizen of Object.values(world.citizens)) {
    if (!citizen.alive || citizen.health <= 0 || citizen.action || citizen.queue.length || citizen.emergency || citizen.plan || citizen.strategy)
      throw new Error('Initial slice requires healthy living idle bodies with no reserved work or strategy');
  }
  const gold = totalGold(world);
  if (!Number.isSafeInteger(gold)) throw new Error('Unsafe total gold');
  world.initialGold = gold;
  updateKnowledge(world);
  const setupWorld = structuredClone(world);
  const setupLog: SetupRecord[] = [];
  for (const setup of manifest.setup) {
    if (setup.citizenIndex >= ids.length || setup.citizenIndex === manifest.actorIndex)
      throw new Error('Setup must be a valid counterpart command');
    const command = setup.command as Command;
    if (command.type !== 'order') throw new Error('Only finite funded orders allowed during setup');
    const citizenId = ids[setup.citizenIndex];
    const knownResult = validateKnownCommand(world, citizenId, command);
    if (!knownResult.ok) throw new Error(`Setup knowledge rejection: ${knownResult.code}`);
    const dispatchResult = dispatch(world, citizenId, command, 'external', options);
    updateKnowledge(world);
    setupLog.push({ citizenId, command, knownResult, dispatchResult, stateHash: createHash('sha256').update(JSON.stringify(world)).digest('hex') });
    if (!dispatchResult.ok || dispatchResult.order?.filledQuantity !== 0 || dispatchResult.order.remainingQuantity !== command.quantity)
      throw new Error('Setup did not establish the declared resting funded order');
    if (totalGold(world) !== gold) throw new Error('Setup gold accounting failure');
  }
  return { manifest, world, setupWorld, setupLog, actorId: ids[manifest.actorIndex], options };
}

/** Authored development endowments, not natural-history or optimality claims. */
export function developmentFixture(kind: 'buy-meal' | 'sell-buy-meal', seed = 1, horizon = kind === 'buy-meal' ? 1 : 2): FixtureManifest {
  const sell = kind === 'sell-buy-meal';
  return fixtureSchema.parse({
    version: 1, id: kind, split: 'development',
    provenance: 'Authored initial liquidity/vitals/holdings; real seeded Prosper geometry; no fabricated history.',
    creation: { seed, scenario: 'progression', population: sell ? 3 : 2, autonomy: true },
    actorIndex: 0, horizon, cadence: 1,
    authorities: sell ? ['direct', 'passive-body', 'passive-body'] : ['direct', 'passive-body'],
    newbornAuthority: 'passive-body',
    objective: { description: 'Survive to the horizon with health at least 100 and fullness at least 90.', minHealth: 100, minFullness: 90 },
    overrides: [
      { citizenIndex: 0, position: { x: 1, y: 1 }, gold: sell ? 0 : 4, health: 100, fullness: 80, inventory: sell ? { 'wood:1': 2 } : {} },
      { citizenIndex: 1, position: { x: 2, y: 1 }, gold: 0, health: 100, fullness: 100, inventory: { 'food:1': 3 } },
      ...(sell ? [{ citizenIndex: 2, position: { x: 1, y: 2 }, gold: 4, health: 100, fullness: 100, inventory: { 'food:1': 2 } }] : []),
    ],
    setup: [
      { citizenIndex: 1, command: { type: 'order', side: 'sell', item: 'food:1', quantity: 1, price: 4 } },
      ...(sell ? [{ citizenIndex: 2, command: { type: 'order', side: 'buy', item: 'wood:1', quantity: 2, price: 2 } }] : []),
    ],
  });
}
