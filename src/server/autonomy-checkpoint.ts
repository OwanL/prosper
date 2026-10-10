import { z } from 'zod';
import { autonomyPolicySchema } from '../citizen/autonomy-schema.ts';
import { isTier } from '../shared/tiers.ts';

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
export const allianceSchema = z
  .object({
    id: text,
    name: text,
    members: z.array(text),
    createdTick: count,
    lastActiveTick: count,
  })
  .strict();
