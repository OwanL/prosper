// Experimental provider menu only. Actual calls still use the original,
// per-task runtime validators in citizen-tools; no coercion or aliasing.
export function flattenTaskMenu(definitions) {
  const tools = structuredClone(definitions);
  const commit = tools.find(t => t.function.name === 'commit_strategy');
  const tasks = commit?.function.parameters.properties.tasks;
  const variants = tasks?.items?.oneOf;
  if (!Array.isArray(variants)) throw new Error('Expected the original task menu.');
  const properties = {}, rules = [];
  for (const variant of variants) {
    const name = variant.properties.type.enum[0];
    const required = variant.required.filter(field => field !== 'type');
    const optional = Object.keys(variant.properties).filter(field => field !== 'type' && !required.includes(field));
    rules.push(`${name}: required ${required.join(',') || 'none'}; optional ${optional.join(',') || 'none'}.`);
    for (const [field, schema] of Object.entries(variant.properties)) {
      if (field === 'type') continue;
      if (!properties[field]) properties[field] = schema;
      if (field === 'resource') properties[field] = { type: 'string', enum: ['food', 'wood', 'bread'],
        description: 'collect/ensure_inventory: food or wood only. give: food, wood or bread.' };
      if (field === 'target') properties[field] = { type: 'string', minLength: 1, maxLength: 100,
        description: 'move: citizen or known site. collect: known resource matching resource/area. build: known location. bake/repair/guard: known bakery. attack: living adult or known bakery. give/reproduce: living citizen.' };
    }
  }
  tasks.items = { type: 'object', additionalProperties: false, required: ['type'],
    description: `Only the fields listed for the chosen type are accepted. ${rules.join(' ')}`,
    properties: { type: { type: 'string', enum: variants.map(v => v.properties.type.enum[0]) }, ...properties } };
  return tools;
}
