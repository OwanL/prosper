import { z } from 'zod';
import { MAX_TIER, TIERS, TRADABLE_ITEM_RE } from '../shared/tiers.ts';
import { draftPlanParameters, approvePlanParameters } from './plan-schema.ts';
import { strategyParameters } from './directive-schema.ts';
import type { Command, CitizenObservation } from '../shared/types.ts';
import { BALANCE } from '../world/config.ts';

const text = z.string().min(1).max(BALANCE.memoryLength);
const id = z.string().min(1).max(200);
const coordinate = z.number().int().min(0);
const tier = z.number().int().min(1).max(MAX_TIER);
const toolKind = z.enum(['axe', 'scythe', 'knife', 'sword']);
const building = z.enum(['lumbermill', 'spinning-wheel', 'butchery', 'wall']);
const item = z.string().regex(TRADABLE_ITEM_RE);
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const queue = z.enum(['replace', 'append']).optional();
const variant = <T extends z.ZodRawShape>(type: string, shape: T) =>
  z.object({ type: z.literal(type), ...shape, queue }).strict();
export const commandSchema = z.union([
  variant('move', { x: coordinate, y: coordinate }),
  variant('harvest', { depositId: id }),
  variant('craft', { item: toolKind, tier }),
  variant('build', { kind: building, tier, x: coordinate, y: coordinate }),
  variant('refine', { buildingId: id, fromTier: tier, direction: z.enum(['up', 'down']).optional() }),
  variant('attack', { targetId: id }),
  variant('loot', { lootId: id }),
  variant('cancel', {}),
  variant('order', { side: z.enum(['buy', 'sell']), item, quantity: positive, price: positive }),
  variant('cancel-order', { orderId: id }),
  variant('transfer', { citizenId: id, gold: positive }),
  variant('give', { citizenId: id, item, quantity: positive }),
  variant('message', { text: z.string().min(1).max(BALANCE.messageLength), to: id.optional() }),
  variant('remember', { text }),
  variant('goals', {
    goals: z.array(z.string().min(1).max(BALANCE.goalLength)).max(BALANCE.goalLimit),
  }),
  variant('reproduce', { partnerId: id }),
  variant('consent', { partnerId: id, accept: z.boolean() }),
]);
const tileSchema = z.object({ x: coordinate, y: coordinate }).strict();
const actionTypes = commandSchema.options.map((schema) => schema.shape.type.value);
// Ollama needs a root object: a top-level union can lose the discriminator.
// Advertising optional subtype fields does NOT relax strict per-action validation.
const commandParameters = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: actionTypes,
      description: 'Required action name; never use cmd, command or action instead.',
    },
    x: { type: 'integer', minimum: 0, description: 'Required for move/build, not harvest.' },
    y: { type: 'integer', minimum: 0, description: 'Required for move/build, not harvest.' },
    depositId: {
      type: 'string',
      description:
        'Required for harvest. Exact visible deposit ID from entityIndex, NOT coordinates.',
    },
    item: {
      type: 'string',
      description:
        'craft: axe/scythe/knife/sword; order: exact key e.g. axe:1, wood:1, building:<ID>.',
    },
    tier: { type: 'integer', enum: [...TIERS], description: 'Required for craft/build.' },
    kind: {
      type: 'string',
      enum: ['lumbermill', 'spinning-wheel', 'butchery', 'wall'],
      description: 'Required for build (building kind).',
    },
    buildingId: { type: 'string', description: 'Required for refine; exact visible building ID.' },
    fromTier: { type: 'integer', enum: [...TIERS], description: `Required for refine; up accepts 1..${MAX_TIER - 1}, down 2..${MAX_TIER}.` },
    direction: { type: 'string', enum: ['up', 'down'], description: 'refine only; default up: 3 inputs -> 1 next-tier unit. down: 1 input -> 2 previous-tier units. Up requires station tier >= input tier; down requires station tier >= input tier - 1.' },
    targetId: {
      type: 'string',
      description: 'Required for attack; exact visible citizen/building ID.',
    },
    lootId: { type: 'string', description: 'Required for loot; exact visible loot ID.' },
    side: {
      type: 'string',
      enum: ['buy', 'sell'],
      description:
        'Required for order: global gold-only market, instant remote settlement on matching; no barter or meetup.',
    },
    quantity: { type: 'integer', minimum: 1, description: 'Required for order.' },
    price: { type: 'integer', minimum: 1, description: 'Required for order; gold per unit.' },
    orderId: { type: 'string', description: 'Required for cancel-order.' },
    citizenId: { type: 'string', description: 'Required for transfer.' },
    gold: {
      type: 'integer',
      minimum: 1,
      description:
        'Required for transfer: unconditional gold gift, no goods received. Purchases use order instead.',
    },
    text: {
      type: 'string',
      minLength: 1,
      maxLength: BALANCE.memoryLength,
      description: `Required for message/remember. message max ${BALANCE.messageLength} characters; remember max ${BALANCE.memoryLength}. Keep notes compact.`,
    },
    to: { type: 'string', description: 'Optional recipient for message; omit for public.' },
    goals: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: BALANCE.goalLength },
      maxItems: BALANCE.goalLimit,
      description: 'Required for goals.',
    },
    partnerId: { type: 'string', description: 'Required for reproduce/consent.' },
    accept: { type: 'boolean', description: 'Required for consent.' },
    queue: {
      type: 'string',
      enum: ['replace', 'append'],
      description:
        'Optional; append physical work instead of replacing. While work is active, known remembered targets/sites can be appended after a move; current sight and prerequisites are checked at activation, not remotely at submission.',
    },
  },
  required: ['type'],
  additionalProperties: false,
};
const examples: Record<string, object> = {
  move: { type: 'move', x: 0, y: 0 },
  harvest: { type: 'harvest', depositId: '<visible deposit ID from entityIndex>' },
  craft: { type: 'craft', item: 'axe', tier: 1 },
  build: { type: 'build', kind: 'lumbermill', tier: 1, x: 0, y: 0 },
  refine: { type: 'refine', buildingId: '<visible building ID>', fromTier: 1 },
  attack: { type: 'attack', targetId: '<visible target ID>' },
  loot: { type: 'loot', lootId: '<visible loot ID>' },
  cancel: { type: 'cancel' },
  order: { type: 'order', side: 'sell', item: 'wood:1', quantity: 1, price: 1 },
  'cancel-order': { type: 'cancel-order', orderId: '<order ID>' },
  transfer: { type: 'transfer', citizenId: '<known citizen ID>', gold: 1 },
  give: { type: 'give', citizenId: '<known nearby citizen ID>', item: 'food:1', quantity: 1 },
  message: { type: 'message', text: 'Hello' },
  remember: { type: 'remember', text: 'Keep unfinished intent here.' },
  goals: { type: 'goals', goals: ['Gather food'] },
  reproduce: { type: 'reproduce', partnerId: '<visible citizen ID>' },
  consent: { type: 'consent', partnerId: '<known citizen ID>', accept: true },
};
export const legacyTools = [
  {
    type: 'function' as const,
    function: {
      name: 'command',
      description:
        'Submit one command synchronously. Prefer set_strategy for routine work; command remains available for deliberate individual actions. Use command for memory/goals/social/market actions or physical actions outside the plan vocabulary. Physical commands replace existing work unless queue=append. Do not repeatedly restart unfinished work. For travel-then-act, submit move to a remembered location followed by the known action with queue=append. Acceptance does not guarantee stock/existence; sight and prerequisites are checked when that entry starts. Core validates prerequisites and returns actionable failures. Trade goods using order (buy/sell for gold), not barter, messages or travel. remember/goals persist across fresh turns.',
      parameters: commandParameters,
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'draft_plan',
      description:
        'Forecast a full 1..12-step batch without mutating the world. Use command steps (move, harvest, craft, build, refine, loot), gather with maxTicks (optional carried targetQuantity; omit it to keep working), or wait. Resource-based gathering after travel may discover local targets; unknown exact entity IDs remain invalid. No per-step queue fields. mode defaults append; replace deliberately changes existing work. Total wait ticks plus gather maxTicks <=10000. onFailure defaults review; continue explicitly skips failed steps. stopWhen ends the step when its condition holds. Submit whole-list revisions, not one-step add loops. No immediate physical commands while drafting. Review the returned forecast then approve the latest draftId in a subsequent model response within this turn. Drafts expire at turn end/reload.',
      parameters: draftPlanParameters,
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'approve_plan',
      description:
        'Approve the latest turn-local draftId. Revalidates current knowledge, not all future ingredients; each step checks actual prerequisites on activation. Installs a durable plan and ends the turn after handling remaining memory/goals/social calls in the same response. Approved plans and receipts persist across fresh contexts/reload; drafts do not.',
      parameters: approvePlanParameters,
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'query_tile',
      description:
        'Inspect a currently visible tile or a dated remembered tile. Never reveals unseen live state.',
      parameters: z.toJSONSchema(tileSchema),
    },
  },
];
export const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'set_strategy',
      description:
        'Commit your intentions now and end this review after remaining calls in the same response. keep preserves work, append adds directives, replace deliberately changes it. Work areas authorize preparation and local exploration, not purchases, facilities or partners you did not select. Omit quantity/maxTicks for ongoing work. reviewAfter selects your next review without stopping work. Optional memory, goals and communications commit alongside the decision. No draft/approval exchange is needed.',
      parameters: strategyParameters,
    },
  },
  ...legacyTools.filter((tool) => ['command', 'query_tile'].includes(tool.function.name)),
];

export function parseCommand(value: unknown): Command {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('command requires a JSON object. Example: {"type":"move","x":0,"y":0}');
  const input = value as Record<string, unknown>;
  if (input.type === undefined)
    throw new Error(
      'Missing required field "type". Use type, not aliases cmd/command/action. Example: {"type":"harvest","depositId":"<visible deposit ID from entityIndex>"}; substitute the indexed ID, never guess it.',
    );
  const schema = commandSchema.options.find((option) => option.shape.type.value === input.type);
  if (!schema)
    throw new Error(
      `Unsupported command type ${JSON.stringify(input.type)}. Available: ${actionTypes.join(', ')}. Example: {"type":"move","x":0,"y":0}`,
    );
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => {
        const field = issue.path.join('.') || 'fields';
        return input[field] === undefined && issue.path.length === 1
          ? `Missing required field "${field}"`
          : `${field}: ${issue.message}`;
      })
      .join('; ');
    throw new Error(
      `Invalid ${input.type}: ${issues}. Use only this action's fields. ${input.type === 'harvest' ? 'Harvest needs depositId from entityIndex, not x/y. ' : ''}Example: ${JSON.stringify(examples[input.type as string])}. Replace placeholder IDs with known indexed IDs.`,
    );
  }
  return parsed.data as Command;
}
export function queryTile(value: unknown, observation: CitizenObservation): unknown {
  const point = tileSchema.safeParse(value);
  if (!point.success) throw new Error('query_tile requires nonnegative integer x and y only.');
  const matches = (tile: { x: number; y: number }) =>
    tile.x === point.data.x && tile.y === point.data.y;
  const visible = observation.visible.find(matches);
  if (visible) return { source: 'current', tile: visible };
  const remembered = observation.remembered.find(matches);
  return remembered
    ? { source: 'dated-memory', tile: remembered }
    : {
        source: 'unknown',
        message: 'Tile is outside sight and has no memory. Travel to inspect it.',
      };
}
