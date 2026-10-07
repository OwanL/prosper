import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { commandSchema } from '../citizen/tools.ts';
import { validateResponse } from '../citizen/provider.ts';
import type { RecordedTurn } from '../citizen/index.ts';
import type { PlannerMode, World } from '../shared/types.ts';
import { BALANCE } from '../world/config.ts';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = count.min(1);
const text = z.string();
const identity = text.min(1).max(200);
const tier = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const point = { x: count, y: count };
const inventory = z.record(
  z.string().regex(/^(food|wood|fibre|axe|scythe|knife|sword):[123]$/),
  count,
);
const equipment = z
  .object({
    axe: text.optional(),
    scythe: text.optional(),
    knife: text.optional(),
    sword: text.optional(),
  })
  .strict();
const building = z
  .object({
    ...point,
    id: identity,
    kind: z.enum(['lumbermill', 'spinning-wheel', 'butchery', 'wall']),
    tier,
    ownerId: identity.nullable(),
    health: z.number().positive(),
    maxHealth: z.number().positive(),
    materials: inventory,
  })
  .strict();
const deposit = z
  .object({
    ...point,
    id: identity,
    resource: z.enum(['food', 'wood', 'fibre']),
    tier,
    stock: count,
    capacity: positive,
    regrowAt: count,
  })
  .strict();
const sighting = z
  .object({
    ...point,
    id: identity,
    name: text,
    color: text,
    alive: z.boolean(),
    health: z.number().min(0).max(100),
    activity: text,
  })
  .strict();
const memory = z
  .object({
    ...point,
    seenTick: count,
    citizens: z.array(sighting),
    deposits: z.array(deposit),
    buildings: z.array(building),
    loot: z.array(z.object({ ...point, id: identity, citizenName: text }).strict()),
  })
  .strict();
const action = z
  .object({
    id: identity,
    command: commandSchema,
    phase: z.enum(['travel', 'work']),
    startedTick: count,
    elapsed: count,
    duration: positive,
    reserved: inventory,
    path: z.array(z.object(point).strict()),
    target: z.object(point).strict(),
    partnerId: identity.optional(),
  })
  .strict();
const citizen = z
  .object({
    ...point,
    id: identity,
    name: text,
    color: text,
    personality: text,
    alive: z.boolean(),
    health: z.number().min(0).max(100),
    fullness: z.number().min(0).max(100),
    gold: count,
    inventory,
    equipment,
    action: action.nullable(),
    queue: z.array(commandSchema).max(BALANCE.queueLimit),
    goals: z.array(text),
    memories: z.array(z.object({ tick: count, text }).strict()),
    knowledge: z.record(text, memory),
    lastResult: text,
    nextReviewTick: count,
    consent: z.record(text, count),
    reproductionCooldown: count,
    parents: z.array(identity),
  })
  .strict();
const worldSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: identity,
    seed: count.max(0xffffffff),
    rngState: positive.max(0xffffffff),
    nextId: positive,
    tick: count,
    width: positive,
    height: positive,
    initialGold: count,
    citizens: z.record(text, citizen),
    deposits: z.record(text, deposit),
    buildings: z.record(text, building),
    orders: z.record(
      text,
      z
        .object({
          id: identity,
          citizenId: identity,
          side: z.enum(['buy', 'sell']),
          item: text.regex(/^(food|wood|fibre|axe|scythe|knife|sword):[123]$|^building:[\w-]+$/),
          quantity: positive,
          price: positive,
          createdTick: count,
          sequence: count,
          escrowGold: count,
          escrowItems: inventory,
        })
        .strict(),
    ),
    loot: z.record(
      text,
      z.object({ ...point, id: identity, citizenName: text, gold: count, inventory }).strict(),
    ),
    messages: z.array(
      z
        .object({ id: identity, tick: count, from: identity, to: identity.optional(), text })
        .strict(),
    ),
    events: z.array(
      z
        .object({
          id: identity,
          tick: count,
          kind: text,
          text,
          citizenId: identity.optional(),
          targetId: identity.optional(),
          x: count.optional(),
          y: count.optional(),
          audience: z.array(identity).optional(),
        })
        .strict(),
    ),
  })
  .strict();

export interface Checkpoint {
  version: 1;
  savedAt: string;
  world: World;
  runtime: {
    running: boolean;
    speed: number;
    mode: PlannerMode;
    commandSequence: number;
    recorded: RecordedTurn[];
  };
}
const envelope = z
  .object({
    version: z.literal(1),
    savedAt: z.string().datetime(),
    world: worldSchema,
    runtime: z
      .object({
        running: z.boolean(),
        speed: z.number().min(0.1).max(100),
        mode: z.enum(['scripted', 'live', 'recorded']),
        commandSequence: count,
        recorded: z
          .array(z.object({ citizenId: identity, responses: z.array(z.unknown()) }).strict())
          .max(10000),
      })
      .strict(),
  })
  .strict();
const demand = (valid: unknown, message: string) => {
  if (!valid) throw new Error(`Invalid checkpoint invariant: ${message}`);
};

/** Refuse incompatible/corrupt worlds; no coercion, defaults or silent reset. */
export function validateCheckpoint(value: unknown): Checkpoint {
  const parsed = envelope.safeParse(value);
  if (!parsed.success)
    throw new Error(
      `Invalid checkpoint shape/version: ${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}`,
    );
  const cp = parsed.data as Checkpoint;
  const w = cp.world;
  const inBounds = (p: { x: number; y: number }) => p.x < w.width && p.y < w.height;
  const seen = new Set<string>();
  const unique = (id: string) => {
    demand(!seen.has(id), 'duplicate ID');
    seen.add(id);
    const suffix = /-(\d+)$/.exec(id);
    if (suffix) demand(Number(suffix[1]) < w.nextId, 'nextId would reuse an existing ID');
  };
  for (const entities of [w.citizens, w.deposits, w.buildings, w.orders, w.loot]) {
    for (const [key, entity] of Object.entries(entities)) {
      demand(key === entity.id, 'map key does not match entity ID');
      unique(entity.id);
      if ('x' in entity) demand(inBounds(entity), 'entity outside map');
    }
  }
  let gold =
    Object.values(w.citizens).reduce((n, c) => n + c.gold, 0) +
    Object.values(w.loot).reduce((n, l) => n + l.gold, 0);
  const buildingTiles = new Set<string>();
  for (const b of Object.values(w.buildings)) {
    const tile = `${b.x},${b.y}`;
    demand(!buildingTiles.has(tile), 'overlapping buildings');
    buildingTiles.add(tile);
    demand(
      !Object.values(w.deposits).some((d) => d.x === b.x && d.y === b.y),
      'building covers deposit',
    );
    demand(
      b.health <= b.maxHealth && (b.ownerId === null || w.citizens[b.ownerId]?.alive),
      'building health/owner',
    );
  }
  for (const d of Object.values(w.deposits))
    demand(d.stock <= d.capacity, 'deposit stock exceeds capacity');
  for (const c of Object.values(w.citizens)) {
    demand(c.alive === c.health > 0, 'citizen life/health mismatch');
    for (const [kind, item] of Object.entries(c.equipment))
      demand(
        item?.startsWith(`${kind}:`) && /^[\w-]+:[123]$/.test(item) && c.inventory[item] >= 1,
        'equipped item is not carried',
      );
    demand(
      c.parents.every((id) => !!w.citizens[id]) &&
        Object.keys(c.consent).every((id) => !!w.citizens[id]),
      'unknown parent/consent',
    );
    for (const [key, tile] of Object.entries(c.knowledge))
      demand(
        inBounds(tile) && tile.seenTick <= w.tick && key === `${tile.x},${tile.y}`,
        'invalid dated tile memory',
      );
    if (c.action) {
      const a = c.action;
      const partnerAction = a.partnerId ? w.citizens[a.partnerId]?.action : undefined;
      if (a.command.type === 'reproduce') {
        demand(
          a.partnerId === a.command.partnerId &&
            a.partnerId !== c.id &&
            partnerAction?.id === a.id &&
            partnerAction.partnerId === c.id &&
            partnerAction.command.type === 'reproduce' &&
            partnerAction.command.partnerId === c.id &&
            a.elapsed === partnerAction.elapsed &&
            a.duration === partnerAction.duration &&
            a.startedTick === partnerAction.startedTick,
          'joint reproduction identity/progress',
        );
        if (c.id < a.partnerId!) unique(a.id); // paired actions intentionally share one completion ID
      } else {
        demand(!a.partnerId, 'unexpected action partner');
        unique(a.id);
      }
      demand(
        ['move', 'harvest', 'craft', 'build', 'refine', 'attack', 'loot', 'reproduce'].includes(
          a.command.type,
        ),
        'nonphysical action',
      );
      demand(
        c.alive && a.startedTick <= w.tick && a.elapsed < a.duration && inBounds(a.target),
        'action progress/target',
      );
      let previous = { x: c.x, y: c.y };
      for (const p of a.path) {
        demand(
          inBounds(p) && Math.abs(previous.x - p.x) + Math.abs(previous.y - p.y) === 1,
          'action path',
        );
        previous = p;
      }
      demand(a.phase !== 'travel' || a.path.length > 0, 'travel path empty');
      demand(a.phase !== 'work' || a.path.length === 0, 'working action has travel path');
      demand(!a.partnerId || !!w.citizens[a.partnerId], 'action partner');
    }
    demand(c.alive || (!c.action && !c.queue.length), 'dead citizen still working');
  }
  for (const o of Object.values(w.orders)) {
    demand(w.citizens[o.citizenId]?.alive && o.createdTick <= w.tick, 'order owner/tick');
    demand(Number.isSafeInteger(o.quantity * o.price), 'order amount overflow');
    gold += o.escrowGold;
    if (o.side === 'buy')
      demand(
        o.escrowGold === o.quantity * o.price && Object.values(o.escrowItems).every((n) => n === 0),
        'buy escrow',
      );
    else {
      demand(o.escrowGold === 0, 'sell gold escrow');
      if (o.item.startsWith('building:')) {
        const b = w.buildings[o.item.slice(9)];
        demand(
          o.quantity === 1 &&
            b?.ownerId === o.citizenId &&
            Object.values(o.escrowItems).every((n) => n === 0),
          'building escrow',
        );
      } else
        demand(
          o.escrowItems[o.item] === o.quantity &&
            Object.entries(o.escrowItems).every(([item, n]) => item === o.item || n === 0),
          'sell escrow',
        );
    }
  }
  demand(Number.isSafeInteger(gold) && gold === w.initialGold, 'gold conservation');
  for (const m of w.messages) {
    unique(m.id);
    demand(
      m.tick <= w.tick && !!w.citizens[m.from] && (!m.to || !!w.citizens[m.to]),
      'message identity/tick',
    );
  }
  for (const e of w.events) {
    unique(e.id);
    demand(e.tick <= w.tick, 'future event');
  }
  for (const fixture of cp.runtime.recorded) {
    demand(!!w.citizens[fixture.citizenId], 'fixture citizen');
    for (const response of fixture.responses) validateResponse(response);
  }
  return cp;
}

export function dataDirectory(input = process.env.PROSPER_DATA_DIR ?? '.prosper-v2'): string {
  const directory = resolve(input);
  demand(
    !directory
      .replace(/\\/g, '/')
      .split('/')
      .some((part) => part.toLowerCase() === '.prosper'),
    'legacy .prosper directory is forbidden',
  );
  return directory;
}
export function loadCheckpoint(path: string): Checkpoint {
  return validateCheckpoint(JSON.parse(readFileSync(path, 'utf8')));
}
export function saveCheckpoint(path: string, checkpoint: Checkpoint): void {
  const text = `${JSON.stringify(validateCheckpoint(checkpoint))}\n`;
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, 'wx');
    writeFileSync(fd, text);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path); // same-directory atomic replace; prior checkpoint survives failed writes
  } finally {
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(temporary);
    } catch {
      /* renamed, or never created */
    }
  }
}
