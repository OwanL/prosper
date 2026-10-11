import { z } from 'zod';
import { autonomyPolicySchema } from '../citizen/autonomy-schema.ts';
import { isTier } from '../shared/tiers.ts';

import { commandSchema } from '../citizen/tools.ts';
import { MIND_LIMITS } from '../shared/tree-types.ts';
import { CARRIED_ITEM_RE } from '../shared/tiers.ts';

const count = z.number().int().nonnegative();
const text = z.string();
const unit = z.number().min(0).max(1);
const tier = z.number().int().refine(isTier, 'Invalid tier');
export const autonomyStateSchema = z
  .object({
    policy: autonomyPolicySchema,
    traits: z
      .object({
        aggression: unit,
        sociability: unit,
        ambition: unit,
        caution: unit,
        fertility: unit,
        loyalty: unit,
      })
      .strict(),
    relationships: z.record(
      text,
      z
        .object({
          trust: z.number(),
          grievance: z.number(),
          respect: z.number(),
          trades: count,
          trespasses: count,
          harm: z.number().nonnegative(),
          lastTick: count,
        })
        .strict(),
    ),
    evidence: z
      .array(
        z
          .object({
            tick: count,
            kind: z.enum([
              'competition',
              'trespass',
              'attack',
              'trade',
              'help',
              'threat',
              'alliance',
              'family',
              'survival',
            ]),
            otherId: text.optional(),
            text,
            x: count.optional(),
            y: count.optional(),
          })
          .strict(),
      )
      .max(64),
    evidenceOmitted: count.optional(),
    intent: text,
    nextThinkTick: count,
    nextSocialTick: count,
    nextMarketTick: count,
    lastEventId: count,
    lastProgressTick: count,
    visited: z.record(text, count),
    threatened: z.record(text, z.object({ tick: count, reason: text, demand: count }).strict()),
    permits: z.record(text, count),
    signals: z
      .array(
        z
          .object({
            from: text,
            tick: count,
            kind: z.enum([
              'alliance-offer',
              'family-offer',
              'family-accept',
              'family-ready',
              'family-decline',
              'access-demand',
              'access-grant',
            ]),
            x: count.optional(),
            y: count.optional(),
            amount: count.optional(),
            reason: text.optional(),
          })
          .strict(),
      )
      .max(24)
      .optional(),
    sentSignals: z.record(text, count).optional(),
    beggedTick: count.optional(),
    requestedPartnerId: text.optional(),
    familyFoodTarget: count.optional(),
    interruptedIntent: text.optional(),
    productionGoal: z
      .object({
        item: z.enum(['axe', 'scythe', 'knife', 'sword']),
        tier,
      })
      .strict()
      .optional(),
    meeting: z.object({ partnerId: text, x: count, y: count, tick: count }).strict().optional(),
    combat: z
      .object({ targetId: text, startedTick: count, lastContactTick: count, reason: text })
      .strict()
      .optional(),
    project: z
      .object({
        kind: z.enum(['lumbermill', 'spinning-wheel', 'butchery']),
        tier,
        x: count,
        y: count,
      })
      .strict()
      .optional(),
    source: z.enum(['scripted', 'live', 'recorded']).optional(),
    reviewedTick: count.optional(),
    policyRevision: count.optional(),
    claimSuppressed: z.boolean().optional(),
    territoryExplicit: z.boolean().optional(),
    idleReason: z.literal('surplus').optional(),
  })
  .strict();
export const claimSchema = z
  .object({
    accessPermits: z.record(text, count).optional(),
    id: text,
    ownerId: text,
    areas: z.tuple([count, count, count, count]),
    createdTick: count,
    expiresTick: count,
    accessPrice: count,
    stance: z.enum(['open', 'toll', 'exclusive']),
    resource: z.enum(['food', 'wood', 'fibre']),
  })
  .strict();
const id = z.string().min(1).max(200);
const quantity = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const pointSchema = z.object({ x: count, y: count }).strict();
export const composedCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create-territory'), tiles: z.array(pointSchema).min(1).max(64), woodTier: tier, queue: z.enum(['replace', 'append']).optional() }).strict(),
  z.object({ type: z.literal('expand-territory'), territoryId: id, tiles: z.array(pointSchema).min(1).max(64), woodTier: tier, queue: z.enum(['replace', 'append']).optional() }).strict(),
  z.object({ type: z.literal('join-territory'), territoryId: id }).strict(),
  z.object({ type: z.literal('leave-territory') }).strict(),
  z.object({ type: z.literal('vote-territory'), territoryId: id, admissionId: id, accept: z.boolean() }).strict(),
  z.object({ type: z.literal('attack-sign'), signId: id, queue: z.enum(['replace', 'append']).optional() }).strict(),
  z.object({ type: z.literal('build-house'), tier, x: count, y: count, queue: z.enum(['replace', 'append']).optional() }).strict(),
  z.object({ type: z.literal('sleep'), houseId: id.optional(), targetRest: z.number().finite().positive().max(100), queue: z.enum(['replace', 'append']).optional() }).strict(),
]);
export const deliveryReceiptSchema = z.object({
  id, settlementId: id, tick: count, citizenId: id, item: z.string().regex(CARRIED_ITEM_RE), quantity: quantity.positive(),
  source: z.enum(['harvest', 'tax', 'market', 'recovery', 'gift', 'refine', 'estate']), requestId: id.optional(),
}).strict();
export const mindSchema = z.object({
  community: z.object({ weight: unit, tick: count, eventCursor: count }).strict().optional(),
  version: z.literal(1),
  dispositions: z.object({ ambition: unit, morals: unit, generosity: unit, riskTolerance: unit, patience: unit,
    sociability: unit, vengefulness: unit, familyOrientation: unit, enterprise: unit, economicIndependence: unit }).strict(),
  memories: z.array(z.object({ id, tick: count, kind: z.enum(['survival', 'trade', 'harm', 'help', 'family', 'territory', 'work']),
    otherId: id.optional(), location: pointSchema.optional(), text: z.string().max(600) }).strict()).max(MIND_LIMITS.memories),
  memoriesOmitted: count,
  tasks: z.array(z.object({ id, definitionId: id, parentId: id.optional(),
    request: z.object({ id, resource: z.enum(['food', 'wood', 'fibre']), tier, quantity: quantity.positive(), allowMarket: z.boolean(),
      purpose: z.string().max(600), urgency: z.enum(['routine', 'urgent', 'survival']), deadlineTick: count.optional() }).strict(),
    strategyId: id.optional(), ancestry: z.array(id).max(MIND_LIMITS.ancestry), phase: id,
    status: z.enum(['running', 'succeeded', 'failed']), startedTick: count, lastProgressTick: count, delivered: quantity,
    receiptIds: z.array(id).max(MIND_LIMITS.receipts), ownedOrderIds: z.array(id).max(MIND_LIMITS.ownedOrders),
    /** Optional WorldEvent completion evidence; bounded by the shared typed limit
     * (shared/tree-types.ts owns MIND_LIMITS), and never required to still be retained. */
    evidenceIds: z.array(id).max(MIND_LIMITS.evidence).optional(),
    tradeEventCursor: count.max(Number.MAX_SAFE_INTEGER).optional(),
    accounting: z.object({ units: quantity.optional(), escrowQuantity: quantity.optional(), goldBefore: quantity.optional(),
      marked: quantity.optional(), signBaseline: quantity.optional() }).strict().optional(),
    /** SellItem historically stores confirmed sale units in target.x, not a tile.
     * Preserve that persisted contract without relaxing any spatial coordinate. */
    actionId: id.optional(), targetId: id.optional(), target: z.object({ x: quantity, y: count }).strict().optional(), wakeTick: count.optional(), reason: z.string().max(600).optional(),
  }).strict().superRefine((task, context) => {
    if (task.definitionId !== 'SellItem' && task.target && !Number.isInteger(task.target.x))
      context.addIssue({ code: 'custom', path: ['target', 'x'], message: 'Spatial coordinates must be integers' });
  })).max(MIND_LIMITS.tasks),
  activeTaskId: id.optional(), receipts: z.array(deliveryReceiptSchema).max(MIND_LIMITS.receipts),
  trace: z.array(z.object({ tick: count, invocationId: id, definitionId: id, parentId: id.optional(),
    transition: z.enum(['enter', 'exclude', 'select', 'propose', 'wait', 'succeed', 'fail', 'interrupt']),
    reason: z.string().max(600), command: z.union([commandSchema, composedCommandSchema]).optional(),
  }).strict()).max(MIND_LIMITS.trace), traceOmitted: count, nextDirectorTick: count, lastDirectorTick: count.optional(),
}).strict();
export const territorySchema = z.object({ id, ownerId: id, createdTick: count,
  memberCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  members: z.record(id, z.object({ citizenId: id, joinedTick: count, sequence: count }).strict()),
  admissions: z.array(z.object({ id, applicantId: id, requestedTick: count, expiresTick: count,
    votes: z.record(id, z.boolean()), status: z.enum(['pending', 'admitted', 'rejected', 'expired']) }).strict()).max(64),
}).strict();
export const signSchema = z.object({ id, territoryId: id, x: count, y: count, woodTier: tier, health: quantity.positive(), maxHealth: quantity.positive() }).strict();
export const houseSchema = z.object({ id, ownerId: id, x: count, y: count, tier, health: quantity.positive(), maxHealth: quantity.positive() }).strict();
export const reputationSchema = z.record(id, z.record(id, z.enum(['hostile', 'disliked', 'neutral', 'positive', 'admired'])));

export const allianceSchema = z
  .object({
    id: text,
    name: text,
    members: z.array(text),
    createdTick: count,
    lastActiveTick: count,
  })
  .strict();
