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
import { planSpecSchema } from '../citizen/plan-schema.ts';
import { directiveSchema } from '../citizen/directive-schema.ts';
import { validateResponse } from '../citizen/provider.ts';
import type { RecordedTurn } from '../citizen/index.ts';
import type { PlannerMode, World } from '../shared/types.ts';
import { CARRIED_ITEM_RE, EQUIPMENT_ITEM_RE, RESOURCE_ITEM_RE, TRADABLE_ITEM_RE, MAX_TIER, isTier } from '../shared/tiers.ts';
import { BALANCE, buildingRecipe, equipmentRecipe, refinementRecipe, STATION_RESOURCE } from '../world/config.ts';
import { autonomyStateSchema, claimSchema, allianceSchema } from './autonomy-checkpoint.ts';
import { HISTORY_LIMIT } from '../shared/telemetry-types.ts';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = count.min(1);
const text = z.string();
const identity = text.min(1).max(200);
const worldEventSchema = z
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
  .strict();
const tier = z.number().int().refine(isTier, 'Invalid tier');
const point = { x: count, y: count };
const inventory = z.record(
  z.string().regex(CARRIED_ITEM_RE),
  count,
);
// Migration-only vocabulary; never advertised by the active command API.
const obsoleteCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('equip'), item: text.regex(TRADABLE_ITEM_RE), queue: z.enum(['replace', 'append']).optional() }).strict(),
  z.object({ type: z.literal('unequip'), kind: z.enum(['axe', 'scythe', 'knife', 'sword']), queue: z.enum(['replace', 'append']).optional() }).strict(),
]);
const savedCommand = z.union([commandSchema, obsoleteCommand]);
const obsoleteStep = planSpecSchema.shape.steps.element.options[0].extend({
  command: z.union([
    obsoleteCommand.options[0].omit({ queue: true }).extend({ item: text.regex(EQUIPMENT_ITEM_RE) }),
    obsoleteCommand.options[1].omit({ queue: true }),
  ]),
});
const savedPlanSpec = z.object({
  ...planSpecSchema.shape,
  steps: z.array(z.union([planSpecSchema.shape.steps.element, obsoleteStep])).min(1).max(12),
}).strict().superRefine((value, ctx) => {
  // Reuse the active cross-step budget contract with zero-budget placeholders.
  const checked = planSpecSchema.safeParse({ mode: value.mode, steps: value.steps.map((step) =>
    step.type === 'command' && isObsolete(step.command)
      ? { ...step, command: { type: 'move', x: 0, y: 0 } } : step) });
  if (!checked.success) for (const issue of checked.error.issues)
    ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
});
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
const plan = savedPlanSpec.safeExtend({
  id: identity,
  approvedTick: count,
  stepIndex: count.max(11),
  stepStartedTick: count.optional(),
  pending: z
    .object({
      actionId: identity,
      eventSequence: count,
      result: z.object({ ok: z.boolean(), code: text, message: text }).strict().optional(),
    })
    .strict()
    .optional(),
  gatheringTargetId: identity.optional(),
  wakeTick: count.optional(),
});
const planReceipt = z
  .object({
    planId: identity,
    step: count.max(11),
    tick: count,
    outcome: z.enum(['completed', 'condition', 'failed', 'cancelled']),
    message: text,
    state: z
      .object({
        ...point,
        inventory,
        fullness: z.number().min(0).max(100),
        health: z.number().min(0).max(100),
        gold: count,
      })
      .strict(),
  })
  .strict();
const directiveState = z
  .object({
    id: identity,
    approvedTick: count,
    directives: z.array(directiveSchema).max(4),
    index: count,
    status: z.enum(['active', 'blocked', 'completed', 'stopped']),
    reviewTick: count,
    startedTick: count.optional(),
    progress: count,
    lastProgressTick: count,
    attempted: z.array(text),
    wakeTick: count.optional(),
    pending: z
      .object({
        actionId: identity,
        purpose: z.enum(['travel', 'gather', 'work', 'explore']),
        result: z.object({ ok: z.boolean(), code: text, message: text }).strict().optional(),
      })
      .strict()
      .optional(),
    blockedReason: text.optional(),
  })
  .strict();
const emergency = z
  .object({
    startedTick: count,
    depositId: identity,
    outsideAreas: z.boolean(),
    stage: z.enum(['gather', 'return']),
    outcome: text.optional(),
    suspendedAction: action.optional(),
    suspendedPosition: z.object(point).strict().optional(),
  })
  .strict();
const directiveReceipt = z
  .object({
    tick: count,
    strategyId: identity,
    index: count,
    outcome: z.enum(['accepted', 'completed', 'stopped', 'blocked', 'cancelled']),
    message: text,
  })
  .strict();
const citizen = z
  .object({
    autonomy: autonomyStateSchema.optional(),
    // Migration-only servicing counters; validated, then discarded on restore.
    maintenance: z
      .object({
        axe: count.optional(),
        scythe: count.optional(),
        knife: count.optional(),
        sword: count.optional(),
      })
      .strict()
      .optional(),
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
    equipment: equipment.optional(),
    action: action.nullable(),
    queue: z.array(savedCommand).max(BALANCE.queueLimit),
    plan: plan.optional(),
    planReceipts: z.array(planReceipt).max(24).optional(),
    strategy: directiveState.optional(),
    directiveReceipts: z.array(directiveReceipt).max(24).optional(),
    emergency: emergency.optional(),
    goals: z.array(text),
    memories: z.array(z.object({ tick: count, text }).strict()),
    knowledge: z.record(text, memory),
    lastResult: text,
    nextReviewTick: count,
    review: z
      .object({
        eventSequence: count,
        foodRisk: z.union([z.literal(0), z.literal(1), z.literal(2)]),
        planningWorkId: identity.optional(),
        replanLeadTicks: count.max(1000).optional(),
        strategicTick: count.optional(),
      })
      .strict()
      .optional(),
    consent: z.record(text, count),
    reproductionCooldown: count,
    parents: z.array(identity),
  })
  .strict();
const boundedVital = z.number().min(0).max(100);
const telemetryFlow = z.object({ units: count, turnover: count, fills: count }).strict();
const telemetrySchema = z.object({
  version: z.literal(1),
  startedTick: count,
  frames: z.array(z.object({
    tick: count,
    population: count,
    meanHealth: boundedVital,
    meanFullness: boundedVital,
    citizens: z.record(identity, z.object({
      alive: z.boolean(), cash: count, escrow: count,
      health: boundedVital, fullness: boundedVital,
    }).strict()),
    markets: z.record(text.regex(CARRIED_ITEM_RE), z.object({
      bid: positive.nullable(), ask: positive.nullable(),
      lastPrice: positive.nullable(), lastTick: count.nullable(),
      supply: count, demand: count, carried: count, held: count, ground: count,
      units: count, turnover: count, fills: count,
    }).strict()),
  }).strict()).min(1).max(HISTORY_LIMIT),
  pending: z.record(text.regex(CARRIED_ITEM_RE), telemetryFlow),
  last: z.record(text.regex(CARRIED_ITEM_RE), z.object({ price: positive, tick: count }).strict()),
}).strict();
const worldSchema = z
  .object({
    telemetry: telemetrySchema.optional(),
    claims: z.record(text, claimSchema).optional(),
    alliances: z.record(text, allianceSchema).optional(),
    // Migration-only world flag, not an active mechanics option.
    maintenance: z.boolean().optional(),
    schemaVersion: z.literal(1),
    runId: identity,
    scenario: z.enum(['village', 'competition', 'progression']).optional(),
    seed: count.max(0xffffffff),
    rngState: positive.max(0xffffffff),
    nextId: positive,
    tick: count,
    width: positive,
    height: positive,
    ringCount: positive.optional(),
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
          item: text.regex(TRADABLE_ITEM_RE),
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
    events: z.array(worldEventSchema),
    significantEvents: z.array(worldEventSchema).max(256).optional(),
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
  // Retire only servicing state. Tools, reservations, progress and history stay intact.
  Reflect.deleteProperty(w, 'maintenance');
  for (const c of Object.values(w.citizens)) Reflect.deleteProperty(c, 'maintenance');
  const inBounds = (p: { x: number; y: number }) => p.x < w.width && p.y < w.height;
  if (w.telemetry) {
    const history = w.telemetry;
    demand(history.startedTick <= w.tick, 'telemetry start in future');
    let previous = -1;
    for (const frame of history.frames) {
      demand(frame.tick >= history.startedTick && frame.tick > previous && frame.tick <= w.tick,
        'telemetry frame tick ordering/bounds');
      previous = frame.tick;
      demand(Object.keys(frame.citizens).every((id) => Object.hasOwn(w.citizens, id)),
        'telemetry unknown citizen');
      for (const market of Object.values(frame.markets)) {
        demand((market.lastPrice === null) === (market.lastTick === null), 'telemetry last quote pair');
        demand(market.lastTick === null || market.lastTick <= frame.tick, 'telemetry future sample price');
      }
    }
    for (const quote of Object.values(history.last))
      demand(quote.tick <= w.tick, 'telemetry future last price');
  }
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
    for (const [kind, item] of Object.entries(parsed.data.world.citizens[c.id].equipment ?? {}))
      demand(
        item?.startsWith(`${kind}:`) && EQUIPMENT_ITEM_RE.test(item) && c.inventory[item] >= 1,
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
    for (const a of [c.action, c.emergency?.suspendedAction]) {
      if (!a) continue;
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
      let previous =
        a === c.emergency?.suspendedAction ? c.emergency.suspendedPosition! : { x: c.x, y: c.y };
      demand(!!previous && inBounds(previous), 'suspended action position');
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
      let recipe: Record<string, number> = {};
      let legacyRecipe: Record<string, number> | undefined;
      if (a.command.type === 'craft' || a.command.type === 'build') {
        const command = a.command;
        recipe = command.type === 'craft'
          ? equipmentRecipe(command.item, command.tier)
          : buildingRecipe(command.kind, command.tier);
        // Pre-six-tier actions already reserved unscaled inputs. Preserve exactly
        // those old recipes at historical tiers, never arbitrary partial costs.
        if (command.tier <= 3) {
          const base = command.type === 'craft'
            ? equipmentRecipe(command.item, 1)
            : buildingRecipe(command.kind, 1);
          legacyRecipe = Object.fromEntries(Object.entries(base).map(([key, n]) =>
            [`${key.split(':')[0]}:${command.tier}`, n]));
        }
      }
      if (a.command.type === 'reproduce')
        recipe = { [`food:${BALANCE.reproductionFoodTier}`]: BALANCE.reproductionFood };
      if (a.command.type === 'refine') {
        const station = w.buildings[a.command.buildingId];
        // A suspended station may have disappeared while the body detoured;
        // inputs remain held and are released by normal activation validation.
        const resource = station ? STATION_RESOURCE[station.kind] : undefined;
        const down = a.command.direction === 'down';
        demand(down ? a.command.fromTier >= 2 : a.command.fromTier < MAX_TIER, 'refine tier boundary');
        demand(
          resource ||
            (a === c.emergency?.suspendedAction &&
              Object.keys(a.reserved).length === 1 &&
              RESOURCE_ITEM_RE.test(Object.keys(a.reserved)[0]) &&
              Object.keys(a.reserved)[0].endsWith(`:${a.command.fromTier}`)),
          'refine reservation resource',
        );
        recipe = resource ? refinementRecipe(resource, a.command.fromTier, a.command.direction) : a.reserved;
        demand(
          Object.values(a.reserved).every((n) => n === (down ? 1 : 3)),
          'refine reserved quantity',
        );
      }
      const matchesRecipe = (expected: Record<string, number>) =>
        Object.entries(expected).every(([key, quantity]) => a.reserved[key] === quantity) &&
        Object.entries(a.reserved).every(([key, quantity]) => quantity === (expected[key] ?? 0));
      demand(
        matchesRecipe(recipe) || (legacyRecipe !== undefined && matchesRecipe(legacyRecipe)),
        'action reserved recipe',
      );
    }
    if (c.plan) {
      unique(c.plan.id);
      demand(
        c.alive && c.plan.approvedTick <= w.tick && c.plan.stepIndex < c.plan.steps.length,
        'plan life/tick/progress',
      );
      demand(
        c.plan.stepStartedTick === undefined ||
          (c.plan.stepStartedTick >= c.plan.approvedTick && c.plan.stepStartedTick <= w.tick),
        'plan step time',
      );
      if (c.plan.pending)
        demand(
          c.plan.pending.result
            ? ![c.action, c.emergency?.suspendedAction].some(
                (a) => a?.id === c.plan!.pending!.actionId,
              )
            : [c.action, c.emergency?.suspendedAction].some(
                (a) => a?.id === c.plan!.pending!.actionId,
              ),
          'plan pending action identity',
        );
      for (const step of c.plan.steps)
        if (
          step.type === 'command' &&
          (step.command.type === 'move' || step.command.type === 'build')
        )
          demand(inBounds(step.command), 'plan destination');
    }
    for (const receipt of c.planReceipts ?? [])
      demand(receipt.tick <= w.tick && inBounds(receipt.state), 'plan receipt time/position');
    if (c.strategy) {
      const s = c.strategy;
      unique(s.id);
      demand(
        c.alive &&
          s.approvedTick <= w.tick &&
          s.lastProgressTick >= s.approvedTick &&
          s.lastProgressTick <= w.tick,
        'strategy life/tick',
      );
      demand(
        s.index <= s.directives.length && (s.status !== 'active' || s.index < s.directives.length),
        'strategy index',
      );
      demand(
        s.startedTick === undefined || (s.startedTick >= s.approvedTick && s.startedTick <= w.tick),
        'directive start time',
      );
      demand(s.attempted.length <= 3 * w.width * w.height, 'directive exploration bound');
      for (const d of s.directives) {
        if ('areas' in d)
          for (const [x1, y1, x2, y2] of d.areas)
            demand(
              x1 <= x2 && y1 <= y2 && inBounds({ x: x1, y: y1 }) && inBounds({ x: x2, y: y2 }),
              'directive area bounds',
            );
        if (d.type === 'move' || d.type === 'build') demand(inBounds(d), 'directive destination');
      }
      if (s.pending)
        demand(
          s.pending.result
            ? ![c.action, c.emergency?.suspendedAction].some((a) => a?.id === s.pending!.actionId)
            : [c.action, c.emergency?.suspendedAction].some((a) => a?.id === s.pending!.actionId),
          'directive pending action identity',
        );
    }
    if (c.emergency) {
      const e = c.emergency;
      demand(c.alive && e.startedTick <= w.tick, 'emergency life/tick');
      demand(!!e.suspendedAction === !!e.suspendedPosition, 'emergency suspended position');
      demand(
        e.suspendedAction?.command.type !== 'reproduce',
        'joint reproduction cannot be suspended',
      );
      demand(
        !c.action ||
          (e.stage === 'gather'
            ? c.action.command.type === 'harvest' && c.action.command.depositId === e.depositId
            : c.action.command.type === 'move'),
        'emergency physical identity',
      );
    }
    for (const receipt of c.directiveReceipts ?? [])
      demand(receipt.tick <= w.tick, 'directive receipt time');
    demand(
      c.alive || (!c.action && !c.queue.length && !c.plan && !c.strategy && !c.emergency),
      'dead citizen still working',
    );
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
  // Normalize only after validating the complete legacy shape and invariants.
  // Equipment was a reference into inventory, never another unit to refund.
  const planIdentities = new Set([
    ...seen,
    ...Object.values(w.citizens).flatMap((c) => (c.planReceipts ?? []).map((r) => r.planId)),
  ]);
  for (const c of Object.values(parsed.data.world.citizens)) {
    delete c.equipment;
    c.queue = c.queue.filter((command) => !isObsolete(command));
    if (c.plan) {
      const p = c.plan;
      const obsolete = (step: typeof p.steps[number]) => step.type === 'command' && isObsolete(step.command);
      const currentRemoved = obsolete(p.steps[p.stepIndex]);
      demand(!currentRemoved || !p.pending, 'obsolete plan step has pending physical action');
      const index = p.steps.slice(0, p.stepIndex).filter((step) => !obsolete(step)).length;
      const originalLength = p.steps.length;
      p.steps = p.steps.filter((step) => !obsolete(step));
      p.stepIndex = index;
      if (index < p.steps.length && p.steps.length !== originalLength) {
        // Renumbered steps belong to a new plan identity; historical receipts
        // retain their original planId/step pair. Pending physical work is unchanged.
        // UUID IDs end in a nonnumeric tag, outside the nextId suffix protocol.
        do { p.id = `plan-migrated-${randomUUID()}-v2`; } while (planIdentities.has(p.id));
        planIdentities.add(p.id);
      }
      if (currentRemoved) {
        delete p.stepStartedTick;
        delete p.wakeTick;
        delete p.gatheringTargetId;
      }
      if (index >= p.steps.length) delete c.plan;
    }
  }
  for (const fixture of cp.runtime.recorded) {
    fixture.responses = structuredClone(fixture.responses);
    for (const response of fixture.responses) {
      // These are queued replay inputs, not historical diagnostic/token receipts.
      if (!response.toolCalls) continue;
      response.toolCalls = response.toolCalls.filter((call) => {
        if (call.name !== 'command' && call.name !== 'draft_plan') return true;
        let args: unknown;
        try { args = JSON.parse(call.arguments); } catch { return true; }
        if (call.name === 'command' && isObsolete(args)) {
          obsoleteCommand.parse(args); // Reject malformed old commands instead of erasing them.
          return false;
        } else if (call.name === 'draft_plan') {
          const legacy = savedPlanSpec.safeParse(args);
          if (!legacy.success) {
            if (JSON.stringify(args).includes('"equip"') || JSON.stringify(args).includes('"unequip"'))
              throw new Error('Invalid checkpoint legacy recorded plan');
            return true;
          }
          const steps = legacy.data.steps.filter((step) => step.type !== 'command' || !isObsolete(step.command));
          // Keep the draft/approve ID protocol intact for obsolete-only drafts.
          // A one-tick wait is the smallest valid plan, with no item/gold effects.
          if (steps.length !== legacy.data.steps.length)
            call.arguments = JSON.stringify({ ...legacy.data, steps: steps.length ? steps : [{ type: 'wait', ticks: 1 }] });
        }
        return true;
      });
    }
  }
  return cp;
}

function isObsolete(value: unknown): boolean {
  return !!value && typeof value === 'object' && 'type' in value &&
    (value.type === 'equip' || value.type === 'unequip');
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
