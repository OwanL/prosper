import { z } from 'zod';
import type { Command, CitizenObservation } from '../shared/types.ts';

const text = z.string().min(1).max(2000);
const id = z.string().min(1).max(200);
const coordinate = z.number().int().min(0);
const tier = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const equipment = z.enum(['axe', 'scythe', 'knife', 'sword']);
const building = z.enum(['lumbermill', 'spinning-wheel', 'butchery', 'wall']);
const item = z.string().regex(/^(food|wood|fibre|axe|scythe|knife|sword):[123]$|^building:[\w-]+$/);
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const queue = z.enum(['replace', 'append']).optional();
const variant = <T extends z.ZodRawShape>(type: string, shape: T) =>
  z.object({ type: z.literal(type), ...shape, queue }).strict();
export const commandSchema = z.union([
  variant('move', { x: coordinate, y: coordinate }),
  variant('harvest', { depositId: id }),
  variant('craft', { item: equipment, tier }),
  variant('equip', { item }),
  variant('unequip', { kind: equipment }),
  variant('build', { kind: building, tier, x: coordinate, y: coordinate }),
  variant('refine', { buildingId: id, fromTier: z.union([z.literal(1), z.literal(2)]) }),
  variant('attack', { targetId: id }),
  variant('loot', { lootId: id }),
  variant('cancel', {}),
  variant('order', { side: z.enum(['buy', 'sell']), item, quantity: positive, price: positive }),
  variant('cancel-order', { orderId: id }),
  variant('transfer', { citizenId: id, gold: positive }),
  variant('message', { text, to: id.optional() }),
  variant('remember', { text }),
  variant('goals', { goals: z.array(text).max(8) }),
  variant('reproduce', { partnerId: id }),
  variant('consent', { partnerId: id, accept: z.boolean() }),
]);
const tileSchema = z.object({ x: coordinate, y: coordinate }).strict();
export const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'command',
      description:
        'Submit one command synchronously. Physical commands replace existing work unless queue=append. Do not repeatedly restart unfinished work. Core validates prerequisites and returns actionable failures. remember/goals persist across fresh turns.',
      parameters: z.toJSONSchema(commandSchema),
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
export function parseCommand(value: unknown): Command {
  const parsed = commandSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      'Invalid command: use the command schema with exact required fields, valid item/tier, integer coordinates and positive quantity/price; omit unknown fields.',
    );
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
