import { z } from 'zod';
import { MAX_TIER, TRADABLE_ITEM_RE } from '../../shared/tiers.ts';
import { BALANCE } from '../../world/config.ts';
import type { Command } from '../../shared/types.ts';
import type { PrimitiveDecision } from '../contracts.ts';

// Same public primitive surface and bounds as citizen/tools.ts. No strategy,
// query, evaluator access, semantic repair or execution is available here.
const id = z.string().min(1).max(200);
const coordinate = z.number().int().min(0);
const tier = z.number().int().min(1).max(MAX_TIER);
const toolKind = z.enum(['axe', 'scythe', 'knife', 'sword']);
const building = z.enum(['lumbermill', 'spinning-wheel', 'butchery', 'wall']);
const item = z.string().regex(TRADABLE_ITEM_RE);
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const variant = <T extends z.ZodRawShape>(type: string, shape: T) =>
  z.object({ type: z.literal(type), ...shape, queue: z.enum(['replace', 'append']).optional() }).strict();
export const primitiveCommandSchema = z.union([
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
  variant('remember', { text: z.string().min(1).max(BALANCE.memoryLength) }),
  variant('goals', { goals: z.array(z.string().min(1).max(BALANCE.goalLength)).max(BALANCE.goalLimit) }),
  variant('reproduce', { partnerId: id }),
  variant('consent', { partnerId: id, accept: z.boolean() }),
]);
export const primitiveDecisionSchema = z.union([
  z.object({ requestId: id, kind: z.literal('advance') }).strict(),
  z.object({ requestId: id, kind: z.literal('command'), command: primitiveCommandSchema }).strict(),
]);
export const PRIMITIVE_DECISION_JSON_SCHEMA = z.toJSONSchema(primitiveDecisionSchema);

export interface DecodeOptions {
  requestId: string;
  maxOutputBytes: number;
  allowedCommands?: readonly Command['type'][];
}

function rejectDuplicateKeys(raw: string): void {
  const containers: { object: boolean; key: boolean; seen: Set<string> }[] = [];
  const tokens = raw.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) ?? [];
  for (const token of tokens) {
    const current = containers.at(-1);
    if (token === '{' || token === '[') containers.push({ object: token === '{', key: token === '{', seen: new Set() });
    else if (token === '}' || token === ']') containers.pop();
    else if (token === ',' && current?.object) current.key = true;
    else if (token === ':' && current?.object) current.key = false;
    else if (token.startsWith('"') && current?.object && current.key) {
      const key = JSON.parse(token) as string;
      if (current.seen.has(key)) throw new Error('Duplicate JSON property is ambiguous.');
      current.seen.add(key);
    }
  }
}

/** Decode exactly one JSON decision. Does not check knowledge, affordability or execute. */
export function decodePrimitiveDecision(value: unknown, options: DecodeOptions): PrimitiveDecision {
  if (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes < 1)
    throw new Error('Invalid output-byte limit.');
  let raw: string | undefined;
  try { raw = typeof value === 'string' ? value : JSON.stringify(value); }
  catch { throw new Error('Decision must be serializable JSON.'); }
  if (typeof raw !== 'string') throw new Error('Decision must be a JSON object.');
  if (Buffer.byteLength(raw, 'utf8') > options.maxOutputBytes) throw new Error('Output-byte limit exceeded.');
  // Never extract markdown, prose, tool wrappers or a second object. JSON.parse
  // errors are failures, not an invitation for a correction call. Public
  // feedback carries stable categories only; raw evidence stays in audit.
  let json: unknown;
  try { json = JSON.parse(raw); }
  catch { throw new Error('Invalid JSON decision.'); }
  rejectDuplicateKeys(raw);
  const result = primitiveDecisionSchema.safeParse(typeof value === 'string' ? json : value);
  if (!result.success) throw new Error('Invalid primitive decision structure.');
  const parsed = result.data;
  if (parsed.requestId !== options.requestId) throw new Error('Mismatched decision requestId.');
  if (parsed.kind === 'command' && options.allowedCommands && !options.allowedCommands.includes(parsed.command.type as Command['type']))
    throw new Error('Command type is outside the public allowed surface.');
  return parsed as PrimitiveDecision;
}
