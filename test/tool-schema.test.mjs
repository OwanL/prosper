import test from 'node:test';
import assert from 'node:assert/strict';
import { CITIZEN_TOOLS, MODEL_TOOLS, OLLAMA_MODEL_TOOLS, createCitizenToolSession } from '../lib/citizen-tools.mjs';
import { createWorld } from '../lib/world.mjs';

// The fields in api.ToolProperty at the installed provider's v0.35.1 tag.
// Items remains raw JSON; properties and anyOf use the same typed struct.
function providerProperty(schema) {
  const result = Object.fromEntries(['type', 'description', 'enum', 'required', 'items'].filter(k => k in schema).map(k => [k, schema[k]]));
  if (schema.properties) result.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, providerProperty(v)]));
  if (schema.anyOf) result.anyOf = schema.anyOf.map(providerProperty);
  return result;
}
const parameters = (tools, name) => tools.find(t => t.function.name === name).function.parameters;

test('provider transport preserves usable types, allowed areas and bounds through the actual property boundary', () => {
  const before = providerProperty(parameters(MODEL_TOOLS, 'commit_strategy').properties.work);
  assert.deepEqual(before.properties.area, {}, 'a reference-only typed property loses its schema in this parser');
  const after = providerProperty(parameters(OLLAMA_MODEL_TOOLS, 'commit_strategy').properties.work);
  assert.equal(after.properties.area.type, 'string');
  assert.ok(after.properties.area.enum.includes('north-west-ring-2'));
  assert.equal(after.properties.target.type, 'string');
  const offer = parameters(OLLAMA_MODEL_TOOLS, 'open_offer');
  assert.equal(providerProperty(offer.properties.giveAmount).type, 'integer');
  assert.match(providerProperty(offer.properties.giveAmount).description, /1\.\.1000/);
  assert.match(providerProperty(parameters(OLLAMA_MODEL_TOOLS, 'get_exchanges').properties.limit).description, /1\.\.8/);
  const tasks = providerProperty(parameters(OLLAMA_MODEL_TOOLS, 'commit_strategy').properties.tasks);
  assert.match(tasks.description, /0\.\.4/);
  assert.deepEqual(tasks.items, parameters(MODEL_TOOLS, 'commit_strategy').properties.tasks.items, 'raw nested task union retains every action and constraint');
  const defs = parameters(OLLAMA_MODEL_TOOLS, 'commit_strategy').$defs;
  assert.ok(defs.area.enum.includes('north-west-ring-2'), 'raw nested references retain their root definitions');
});

test('provider descriptions do not relax runtime quantities or change the original schemas', () => {
  assert.equal(parameters(CITIZEN_TOOLS, 'open_offer').properties.giveAmount.description, undefined);
  const world = createWorld({ expanded: false }), actor = world.citizens[0];
  actor.food = 1500;
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: actor.id });
  tools.refresh();
  const before = structuredClone(world.offers);
  assert.equal(tools.execute('open_offer', { give: 'food', giveAmount: 1001, want: 'wood', wantAmount: 1 }).ok, false);
  assert.equal(actor.food, 1500);
  assert.deepEqual(world.offers, before);
  assert.equal(tools.execute('open_offer', { give: 'food', giveAmount: 2, want: 'wood', wantAmount: 1 }).ok, true);
  assert.equal(actor.food, 1498);
  assert.equal(world.offers[0].giveAmount, 2);
});
