import { z } from 'zod';
import { MAX_TIER, TIERS, CARRIED_ITEM_RE } from '../shared/tiers.ts';
import type { StrategySpec } from '../shared/directive-types.ts';
import { BALANCE } from '../world/config.ts';
import { autonomyPolicyPatchSchema } from './autonomy-schema.ts';

const coord = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const identity = z.string().min(1).max(200);
const tier = z.number().int().min(1).max(MAX_TIER);
export const rectangleSchema = z
  .tuple([coord, coord, coord, coord])
  .refine(
    (r) => r[0] <= r[2] && r[1] <= r[3],
    'Rectangle is [xMin,yMin,xMax,yMax], inclusive ordered bounds.',
  );
const quantity = z.number().int().min(1).max(10000);
const condition = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('food-runway-below'), ticks: z.number().int().min(0).max(10000) })
    .strict(),
  z.object({ kind: z.literal('health-below'), health: z.number().min(0).max(100) }).strict(),
  z
    .object({
      kind: z.literal('inventory-at-least'),
      item: z.string().regex(CARRIED_ITEM_RE),
      quantity,
    })
    .strict(),
]);
const scope = {
  areas: z.array(rectangleSchema).min(1).max(8),
  maxTicks: z.number().int().min(1).max(10000).optional(),
  stopWhen: condition.optional(),
};
const work = { ...scope, quantity: quantity.optional() };
export const directiveSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('gather'),
      resource: z.enum(['food', 'wood', 'fibre']),
      tier,
      ...work,
    })
    .strict(),
  z
    .object({
      type: z.literal('operate'),
      buildingId: identity,
      fromTier: tier, direction: z.enum(['up', 'down']).optional(),
      ...work,
    })
    .strict(),
  z
    .object({
      type: z.literal('craft'),
      item: z.enum(['axe', 'scythe', 'knife', 'sword']),
      tier,
      ...work,
    })
    .strict(),
  z
    .object({
      type: z.literal('build'),
      kind: z.enum(['lumbermill', 'spinning-wheel', 'butchery', 'wall']),
      tier,
      x: coord,
      y: coord,
      ...scope,
    })
    .strict(),
  z.object({ type: z.literal('reproduce'), partnerId: identity, ...scope }).strict(),
  z.object({ type: z.literal('explore'), ...scope }).strict(),
  z.object({ type: z.literal('move'), x: coord, y: coord }).strict(),
]);
export const directiveSpecSchema = z
  .object({
    mode: z.enum(['keep', 'append', 'replace']),
    policy: autonomyPolicyPatchSchema.optional(),
    directives: z.array(directiveSchema).max(4).optional(),
    reviewAfter: z.number().int().min(120).max(10000).default(600),
    // Raw tool arguments remain diagnostic evidence; normalize only this optional note.
    memory: z
      .string()
      .min(1)
      .max(8000)
      .transform((text) => {
        const marker = '[trimmed]';
        return text.length > BALANCE.memoryLength
          ? text.slice(0, BALANCE.memoryLength - marker.length) + marker
          : text;
      })
      .optional(),
    goals: z.array(z.string().min(1).max(BALANCE.goalLength)).max(BALANCE.goalLimit).optional(),
    communications: z
      .array(
        z
          .object({ text: z.string().min(1).max(BALANCE.messageLength), to: identity.optional() })
          .strict(),
      )
      .max(2)
      .optional(),
  })
  .strict()
  .refine(
    (spec) => spec.mode !== 'keep' || !spec.directives?.length,
    'keep retains existing work; omit directives.',
  );
export function parseStrategySpec(value: unknown): StrategySpec {
  const parsed = directiveSpecSchema.safeParse(value);
  if (parsed.success) return parsed.data as StrategySpec;
  const issues = parsed.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || 'strategy'}: ${issue.message}`)
    .join('; ');
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const advice = new Set<string>();
  for (const issue of parsed.error.issues) {
    if (issue.path[0] === 'communications' && issue.path[2] === 'to')
      advice.add(
        'Recipient to must be a nonempty known citizen ID (1..200 characters); omit to for public communication, never use an empty string.',
      );
    if (issue.path[0] === 'directives' && issue.path[2] === 'areas') {
      const entry = Array.isArray(raw.directives)
        ? raw.directives[Number(issue.path[1])]
        : undefined;
      const kind = entry && typeof entry === 'object' ? entry.type : undefined;
      advice.add(
        kind === 'craft'
          ? 'craft requires areas authorizing both missing ingredient gathering and crafting. Supply your chosen rectangle union; earlier directives do not extend these permissions. Syntax only: {"type":"craft","item":"axe","tier":1,"areas":[[0,0,5,5]]}.'
          : 'Every non-move directive requires areas: a chosen union of inclusive [minX,minY,maxX,maxY] rectangles. No area is inferred.',
      );
    }
    if (issue.path.length === 1 && issue.path[0] === 'directives' && issue.code === 'too_big')
      advice.add(
        'At most four directives. Shorten the list deliberately and preserve chosen quantity/time/stop bounds on retained directives; do not convert finite work to ongoing just to fix the count.',
      );
  }
  throw new Error(
    `Invalid strategy: ${issues}. ${advice.size ? [...advice].join(' ') : 'Use flat directives and rectangle arrays. Example: {"mode":"replace","directives":[{"type":"gather","resource":"wood","tier":1,"areas":[[0,0,5,5]]}]}'}. Omit quantity/maxTicks for ongoing gather/operate. keep takes no directives. No commitment was made.`,
  );
}

const integer = { type: 'integer', minimum: 0 };
// Provider-facing discriminators are objects, not nested union roots.
export const strategyParameters = {
  type: 'object',
  required: ['mode'],
  additionalProperties: false,
  properties: {
    mode: {
      type: 'string',
      enum: ['keep', 'append', 'replace'],
      description:
        'keep retains all work; append queues after it; replace deliberately changes work.',
    },
    reviewAfter: {
      type: 'integer',
      minimum: 120,
      maximum: 10000,
      default: 600,
      description: 'Reflection lead, not expiry. Ongoing work continues during and after review.',
    },
    memory: { type: 'string', minLength: 1, maxLength: BALANCE.memoryLength },
    goals: {
      type: 'array',
      maxItems: BALANCE.goalLimit,
      items: { type: 'string', minLength: 1, maxLength: BALANCE.goalLength },
    },
    communications: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        required: ['text'],
        additionalProperties: false,
        properties: {
          text: { type: 'string', minLength: 1, maxLength: BALANCE.messageLength },
          to: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description:
              'Optional known citizen ID for private communication; omit for public communication, never use an empty string.',
          },
        },
      },
    },
    directives: {
      type: 'array',
      maxItems: 4,
      description:
        'At most four remaining directives, including retained work on append. Execute in listed order, one at a time. An ongoing gather/operate without quantity, maxTicks or stopWhen does not finish at reviewAfter; later directives wait until it is stopped or replaced. Preserve your chosen bounds when shortening a list.',
      items: {
        description:
          'Required fields by type: gather=type,resource,tier,areas; operate=type,buildingId,fromTier,areas; craft=type,item,tier,areas; build=type,kind,tier,x,y,areas; reproduce=type,partnerId,areas; explore=type,areas; move=type,x,y. Flat objects, no nested command.',
        type: 'object',
        required: ['type'],
        additionalProperties: false,
        properties: {
          type: {
            type: 'string',
            enum: ['gather', 'operate', 'craft', 'build', 'reproduce', 'explore', 'move'],
          },
          areas: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            description:
              'Required for gather/operate/craft/build/reproduce/explore, omitted for move. Union of inclusive [xMin,yMin,xMax,yMax] rectangles. Each directive authorizes its own missing ingredient gathering and final work; permissions do not inherit from earlier directives. Transit may leave.',
            items: { type: 'array', minItems: 4, maxItems: 4, items: integer },
          },
          resource: { type: 'string', enum: ['food', 'wood', 'fibre'], description: 'gather only' },
          tier: { type: 'integer', enum: [...TIERS], description: 'gather/craft/build required' },
          buildingId: { type: 'string', description: 'operate: known owned station' },
          fromTier: {
            type: 'integer',
            enum: [...TIERS],
            description: `operate: input tier; up accepts 1..${MAX_TIER - 1}, down accepts 2..${MAX_TIER}`,
          },
          direction: {
            type: 'string', enum: ['up', 'down'],
            description: 'operate only; default up. Up 3 inputs -> 1 next-tier unit, station tier >= input tier. Down 1 input -> 2 previous-tier units, station tier >= input tier - 1.',
          },
          item: {
            type: 'string',
            enum: ['axe', 'scythe', 'knife', 'sword'],
            description: 'craft only',
          },
          kind: {
            type: 'string',
            enum: ['lumbermill', 'spinning-wheel', 'butchery', 'wall'],
            description: 'build only',
          },
          partnerId: {
            type: 'string',
            description: 'reproduce: known person; no invented consent or control of their work',
          },
          x: integer,
          y: integer,
          quantity: {
            type: 'integer',
            minimum: 1,
            maximum: 10000,
            description:
              'gather/operate/craft only: finite NEW successful harvests/output units, NOT a carried reserve. Meals/trades may consume the output before later work, which prepares missing inputs again inside its own areas. For a carried reserve, choose stopWhen inventory-at-least. Craft defaults to one item; omit for ongoing gather/operate.',
          },
          maxTicks: {
            type: 'integer',
            minimum: 1,
            maximum: 10000,
            description: 'Optional chosen time limit, never required for ongoing work.',
          },
          stopWhen: {
            type: 'object',
            required: ['kind'],
            additionalProperties: false,
            properties: {
              kind: {
                type: 'string',
                enum: ['food-runway-below', 'health-below', 'inventory-at-least'],
              },
              ticks: integer,
              health: { type: 'number', minimum: 0, maximum: 100 },
              item: { type: 'string' },
              quantity: { type: 'integer', minimum: 1, maximum: 10000 },
            },
          },
        },
      },
    },
  },
};
