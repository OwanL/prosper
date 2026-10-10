import { z } from 'zod';
import { MAX_TIER, TIERS, CARRIED_ITEM_RE, CARRIED_ITEM_PATTERN } from '../shared/tiers.ts';
import type { PlanSpec } from '../shared/plan-types.ts';

export const MAX_PLAN_BUDGET_TICKS = 10_000;
const ticks = z.number().int().min(1).max(MAX_PLAN_BUDGET_TICKS);
const quantity = z.number().int().min(1).max(100);
const coordinate = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(200);
const tier = z.number().int().min(1).max(MAX_TIER);
const toolKind = z.enum(['axe', 'scythe', 'knife', 'sword']);
const carriedItem = z.string().regex(CARRIED_ITEM_RE);
// Independent, deliberately limited vocabulary: no queue fields or tools import cycle.
const planCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), x: coordinate, y: coordinate }).strict(),
  z.object({ type: z.literal('harvest'), depositId: id }).strict(),
  z.object({ type: z.literal('craft'), item: toolKind, tier }).strict(),
  z
    .object({
      type: z.literal('build'),
      kind: z.enum(['lumbermill', 'spinning-wheel', 'butchery', 'wall']),
      tier,
      x: coordinate,
      y: coordinate,
    })
    .strict(),
  z
    .object({
      type: z.literal('refine'),
      buildingId: id,
      fromTier: tier, direction: z.enum(['up', 'down']).optional(),
    })
    .strict(),
  z.object({ type: z.literal('loot'), lootId: id }).strict(),
]);
const conditionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('food-runway-below'),
      ticks: z.number().int().min(0).max(MAX_PLAN_BUDGET_TICKS),
    })
    .strict(),
  z.object({ kind: z.literal('health-below'), health: z.number().min(0).max(100) }).strict(),
  z.object({ kind: z.literal('inventory-at-least'), item: carriedItem, quantity }).strict(),
]);
const policy = {
  stopWhen: conditionSchema.optional(),
  onFailure: z.enum(['review', 'continue']).default('review'),
};
const stepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('command'), command: planCommandSchema, ...policy }).strict(),
  z
    .object({
      type: z.literal('gather'),
      resource: z.enum(['food', 'wood', 'fibre']),
      tier,
      targetQuantity: quantity.optional(),
      maxTicks: ticks,
      ...policy,
    })
    .strict(),
  z.object({ type: z.literal('wait'), ticks, ...policy }).strict(),
]);
const planObjectSchema = z
  .object({
    steps: z.array(stepSchema).min(1).max(12),
    mode: z.enum(['append', 'replace']).default('append'),
  })
  .strict();
// Bound cumulative explicit idle/search time, not uncertain travel/work forecasts.
// This prevents twelve individually valid 10k waits from becoming a 120k-tick plan.
export const planSpecSchema = planObjectSchema.superRefine((plan, ctx) => {
  const budget = plan.steps.reduce(
    (sum, step) =>
      sum + (step.type === 'wait' ? step.ticks : step.type === 'gather' ? step.maxTicks : 0),
    0,
  );
  if (budget > MAX_PLAN_BUDGET_TICKS)
    ctx.addIssue({
      code: 'custom',
      path: ['steps'],
      message: `Total wait ticks plus gather maxTicks must not exceed ${MAX_PLAN_BUDGET_TICKS}.`,
    });
});
export function parsePlanSpec(value: unknown): PlanSpec {
  const parsed = planSpecSchema.safeParse(value);
  if (parsed.success) return parsed.data as PlanSpec;
  const issues = parsed.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || 'plan'}: ${issue.message}`)
    .join('; ');
  throw new Error(
    `Invalid plan: ${issues}. steps must be a JSON array, not a string. Each gather step is flat, not nested: {"type":"gather","resource":"wood","tier":1,"maxTicks":600}; add targetQuantity only for a carried-stock target. Each command step uses {"type":"command","command":{"type":"move","x":1,"y":1}}. Revise the whole batch using only the fields in its schema.`,
  );
}
// Provider parameters always have an object root; unions occur only inside steps.
// Cross-step budget checks remain authoritative in parsePlanSpec.
// Like command(), expose object discriminators rather than provider-facing unions.
// Strict subtype and cross-step validation above remains authoritative.
export const draftPlanParameters = {
  type: 'object',
  required: ['steps'],
  additionalProperties: false,
  properties: {
    mode: { type: 'string', enum: ['append', 'replace'], default: 'append' },
    steps: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: {
        type: 'object',
        required: ['type'],
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['command', 'gather', 'wait'] },
          resource: {
            type: 'string',
            enum: ['food', 'wood', 'fibre'],
            description: 'gather: flat field, never a nested gather object.',
          },
          tier: { type: 'integer', enum: [...TIERS], description: 'Required for gather.' },
          targetQuantity: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'Optional gather carried target; omit to keep gathering until maxTicks.',
          },
          maxTicks: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_PLAN_BUDGET_TICKS,
            description: 'Required gather work budget.',
          },
          ticks: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_PLAN_BUDGET_TICKS,
            description: 'Required for wait.',
          },
          onFailure: { type: 'string', enum: ['review', 'continue'], default: 'review' },
          stopWhen: {
            type: 'object',
            required: ['kind'],
            additionalProperties: false,
            properties: {
              kind: {
                type: 'string',
                enum: ['food-runway-below', 'health-below', 'inventory-at-least'],
              },
              ticks: { type: 'integer', minimum: 0, maximum: MAX_PLAN_BUDGET_TICKS },
              health: { type: 'number', minimum: 0, maximum: 100 },
              item: { type: 'string', pattern: CARRIED_ITEM_PATTERN },
              quantity: { type: 'integer', minimum: 1, maximum: 100 },
            },
          },
          command: {
            type: 'object',
            required: ['type'],
            additionalProperties: false,
            properties: {
              type: {
                type: 'string',
                enum: ['move', 'harvest', 'craft', 'build', 'refine', 'loot'],
              },
              x: { type: 'integer', minimum: 0 },
              y: { type: 'integer', minimum: 0 },
              depositId: { type: 'string' },
              buildingId: { type: 'string' },
              lootId: { type: 'string' },
              item: {
                type: 'string',
                description: 'craft: tool kind (axe/scythe/knife/sword).',
              },
              tier: { type: 'integer', enum: [...TIERS] },
              fromTier: { type: 'integer', enum: [...TIERS] },
              direction: { type: 'string', enum: ['up', 'down'], description: `refine only; default up. Up 3 -> 1 next tier (input 1..${MAX_TIER - 1}, station >= input); down 1 -> 2 previous tier (input 2..${MAX_TIER}, station >= input - 1).` },
              kind: {
                type: 'string',
                enum: [
                  'lumbermill',
                  'spinning-wheel',
                  'butchery',
                  'wall',
                ],
              },
            },
          },
        },
      },
    },
  },
};
export const approvePlanSchema = z.object({ draftId: id }).strict();
export const approvePlanParameters = z.toJSONSchema(approvePlanSchema);
