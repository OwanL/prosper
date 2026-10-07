// Ollama 0.35.1 parses tool properties into a limited Go struct before
// forwarding/rendering them. Inline references and describe constraints at
// those boundaries; the original schemas still validate every actual call.
// https://github.com/ollama/ollama/blob/v0.35.1/api/types.go
export function ollamaToolDefinitions(definitions) {
  return definitions.map(definition => {
    const tool = structuredClone(definition), parameters = tool.function.parameters;
    const defs = parameters.$defs ?? {};
    function property(schema) {
      schema = { ...schema };
      if (schema.$ref) {
        const name = schema.$ref.replace(/^#\/\$defs\//, '');
        if (!defs[name]) throw new Error(`Unknown local tool schema reference: ${schema.$ref}`);
        const { $ref, ...siblings } = schema;
        schema = { ...structuredClone(defs[name]), ...siblings };
      }
      const notes = [];
      for (const [lower, upper, label] of [['minimum', 'maximum', 'Value'], ['minLength', 'maxLength', 'Length'], ['minItems', 'maxItems', 'Items']]) {
        if (schema[lower] !== undefined || schema[upper] !== undefined) notes.push(`${label}: ${schema[lower] ?? 0}..${schema[upper] ?? 'unbounded'}.`);
      }
      if (schema.uniqueItems) notes.push('No repeated items.');
      if (notes.length) schema.description = [schema.description, ...notes].filter(Boolean).join(' ');
      if (schema.properties) schema.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, property(value)]));
      if (schema.anyOf) schema.anyOf = schema.anyOf.map(property);
      // Items is untyped in the provider's struct and retains its full schema.
      // Its references remain meaningful because root $defs is also retained.
      return schema;
    }
    parameters.properties = Object.fromEntries(Object.entries(parameters.properties).map(([key, value]) => [key, property(value)]));
    return tool;
  });
}
