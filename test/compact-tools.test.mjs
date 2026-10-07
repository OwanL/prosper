import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, planningContext } from '../lib/world.mjs';
import { createCitizenToolSession, COMPACT_MODEL_TOOLS } from '../lib/citizen-tools.mjs';

test('compact inspection retains the strict original branch rules and knowledge boundary', () => {
  const world = createWorld(), tools = createCitizenToolSession({ getWorld: () => world, citizenId: 'citizen-1' });
  tools.refresh();
  assert.deepEqual(tools.execute('inspect', { subject: 'resources', resource: 'food' }), tools.execute('find_resources', { resource: 'food' }));
  assert.deepEqual(tools.execute('inspect', { subject: 'exchanges' }), tools.execute('get_exchanges', {}));
  const before = JSON.stringify(world);
  for (const args of [{ subject: 'resources' }, { subject: 'places', resource: 'food' },
    { subject: 'mechanics', action: 'invent' }, { subject: 'people', action: 'family' }]) {
    assert.equal(tools.execute('inspect', args).ok, false);
    assert.equal(JSON.stringify(world), before);
  }
});

test('compact family calls create actual proposals and consent without bypassing per-action validation', () => {
  const world = createWorld(), maker = createCitizenToolSession({ getWorld: () => world, citizenId: 'citizen-1' });
  maker.refresh();
  const bad = maker.execute('family', { action: 'propose', proposalId: 'guessed' });
  assert.equal(bad.ok, false);
  assert.equal(world.familyProposals.length, 0);
  const receipt = maker.execute('family', { action: 'propose', to: 'citizen-3' });
  assert.equal(receipt.ok, true);
  const recipient = createCitizenToolSession({ getWorld: () => world, citizenId: 'citizen-3' });
  recipient.refresh();
  const accepted = recipient.execute('family', { action: 'accept', proposalId: world.familyProposals[0].id });
  assert.deepEqual(accepted.familyConsent.acceptedPartnerIds, ['citizen-1']);
  assert.equal(world.stats.births, 0);
  assert.equal(planningContext(world, 'citizen-3').familyProposals[0].status, 'accepted');
  assert.equal(COMPACT_MODEL_TOOLS.length, 9);
  assert.ok(COMPACT_MODEL_TOOLS.some(t => t.function.name === 'plan_construction'));
});
