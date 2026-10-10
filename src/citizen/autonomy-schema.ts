import { z } from 'zod';
import { MAX_TIER } from '../shared/tiers.ts';

const coordinate = z.number().int().nonnegative();
const rect = z
  .tuple([coordinate, coordinate, coordinate, coordinate])
  .refine(([x0, y0, x1, y1]) => x0 <= x1 && y0 <= y1, 'Rectangle bounds must be ordered.');
const identity = z.string().min(1).max(200);
const unit = z.number().min(0).max(1);
export const autonomyPolicySchema = z
  .object({
    livelihood: z.enum(['food', 'wood', 'fibre']),
    targetTier: z.number().int().min(1).max(MAX_TIER),
    home: z.object({ x: coordinate, y: coordinate }).strict().optional(),
    territory: rect.optional(),
    noGo: z.array(rect).max(8).optional(),
    stance: z.enum(['cooperative', 'assertive', 'predatory']),
    aggression: unit,
    caution: unit,
    foodReserveTicks: z.number().int().min(120).max(10000),
    sellPrice: z.number().int().min(1).max(100),
    buyPrice: z.number().int().min(1).max(100),
    allies: z.array(identity).max(12),
    rivals: z.array(identity).max(12),
    reproduction: z.enum(['avoid', 'open', 'seek']),
    partnerId: identity.optional(),
    accessPrice: z.number().int().min(0).max(100),
  })
  .strict();

export const autonomyPolicyPatchSchema = autonomyPolicySchema.partial().extend({
  home: autonomyPolicySchema.shape.home.unwrap().nullable().optional(),
  territory: autonomyPolicySchema.shape.territory.unwrap().nullable().optional(),
  partnerId: autonomyPolicySchema.shape.partnerId.unwrap().nullable().optional(),
});
