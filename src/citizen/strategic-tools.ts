import { z } from 'zod';
import { autonomyPolicyPatchSchema } from './autonomy-schema.ts';
import { directiveSpecSchema } from './directive-schema.ts';

export const strategicDecisionSchema = z
  .object({
    goals: directiveSpecSchema.shape.goals.unwrap().max(6).optional(),
    communications: directiveSpecSchema.shape.communications,
    policy: autonomyPolicyPatchSchema,
    reviewAfter: z.number().int().min(600).max(10000).default(4800),
    memory: z.string().min(1).max(600).optional(),
  })
  .strict();

function compactSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactSchema);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    // Ollama's local grammar compiler rejects boolean items:false emitted for
    // closed Zod tuples. All our tuples are four homogeneous coordinates.
    const tuple = Array.isArray(object.prefixItems) ? object.prefixItems : undefined;
    if (tuple?.length && tuple.every((item) => JSON.stringify(item) === JSON.stringify(tuple[0])))
      return compactSchema({
        ...Object.fromEntries(Object.entries(object).filter(([key]) => key !== 'prefixItems')),
        items: tuple[0],
        minItems: tuple.length,
        maxItems: tuple.length,
      });
    return Object.fromEntries(
      Object.entries(object)
        .filter(([key]) => !['description', '$schema'].includes(key))
        .map(([key, child]) => [key, compactSchema(child)]),
    );
  }
  return value;
}

/** One decision surface. No query/acknowledgement round trips in normal operation. */
export const strategicTools = [
  {
    type: 'function' as const,
    function: {
      name: 'set_policy',
      description:
        'Revise lasting local-AI policy, memory, goals and up to two messages. The body handles all physical work. One response ends this review.',
      parameters: compactSchema(z.toJSONSchema(strategicDecisionSchema, { io: 'input' })),
    },
  },
];
