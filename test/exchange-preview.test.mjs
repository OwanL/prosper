import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, planningContext, transactCitizenAction, applyPlan, tickWorld } from '../lib/world.mjs';
import { exchangePreview } from '../lib/exchange-preview.mjs';
import { createCitizenToolSession } from '../lib/citizen-tools.mjs';

test('exchange preview retrieves bounded eligible terms and referenced offers without choosing actions', () => {
  const world = createWorld(), actor = world.citizens[0];
  for (const maker of world.citizens.slice(1)) {
    transactCitizenAction(world, maker.id, { type: 'offer', give: 'food', giveAmount: 1, want: 'wood', wantAmount: 1,
      ...(maker.id === 'citizen-8' ? { recipient: 'citizen-2' } : {}) });
    world.tick++;
  }
  world.messages.push({ id: 'message-test', tick: world.tick, senderId: 'citizen-2', recipientId: actor.id, text: 'Consider offer-1, if it suits you.' });
  const before = structuredClone(world);
  const context = planningContext(world, actor.id), preview = exchangePreview(context);
  assert.equal(preview.items.length, 4);
  assert.equal(preview.items[0].id, 'offer-1');
  assert.equal(preview.omitted, 2);
  assert.ok(!preview.items.some(o => o.makerId === 'citizen-8'));
  assert.deepEqual(preview.items[0].youPay, { resource: 'wood', amount: 1 });
  assert.deepEqual(world, before);
  const unseenReference = exchangePreview({ ...context, inbox: [{ text: 'offer-7' }] });
  assert.ok(!unseenReference.items.some(o => o.id === 'offer-7'), 'a guessed restricted ID reveals no terms');
});

test('eligible exchanges stay fully discoverable through bounded pages', () => {
  const world = createWorld();
  for (const maker of world.citizens.slice(1)) transactCitizenAction(world, maker.id, { type: 'offer', give: 'food', giveAmount: 1, want: 'wood', wantAmount: 1 });
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: 'citizen-1' }); tools.refresh();
  let after, ids = [];
  do {
    const page = tools.execute('get_exchanges', { limit: 2, ...(after ? { after } : {}) });
    assert.ok(page.items.length <= 2); ids.push(...page.items.map(o => o.id)); after = page.nextAfter;
  } while (after);
  assert.equal(ids.length, 7); assert.equal(new Set(ids).size, 7);
});

test('an eligible trade template fills the entire real escrow after selection, without a separate amount', () => {
  const world = createWorld({ expanded: false }), [buyer, seller] = world.citizens;
  world.citizens = [buyer, seller]; world.blocked = [];
  Object.assign(buyer, { x: 2, y: 2, wood: 10, food: 20, hunger: 0, energy: 100, asyncReview: true });
  Object.assign(seller, { x: 3, y: 2, food: 20, wood: 10 });
  assert.equal(transactCitizenAction(world, seller.id, { type: 'offer', give: 'food', giveAmount: 3, want: 'wood', wantAmount: 5, recipient: buyer.id }).ok, true);
  const preview = exchangePreview(planningContext(world, buyer.id)), selected = preview.items[0];
  const tools = createCitizenToolSession({ getWorld: () => world, citizenId: buyer.id }); tools.refresh();
  const page = tools.execute('get_exchanges', {});
  assert.deepEqual(page.items[0].directive, selected.directive);
  assert.equal(world.stats.trades, 0, 'a template is an option, not execution');
  assert.equal(tools.execute('commit_strategy', { tasks: [selected.directive], work: null }).ok, true);
  applyPlan(world, buyer.id, tools.committed.plan);
  for (let i = 0; i < 8 && !world.stats.trades; i++) tickWorld(world);
  assert.equal(world.stats.trades, 1);
  assert.equal(buyer.food, 23);
  assert.equal(buyer.wood, 5);
  assert.equal(seller.wood, 15);
  assert.equal(world.offers[0].status, 'filled');
  const owner = createCitizenToolSession({ getWorld: () => world, citizenId: seller.id }); owner.refresh();
  assert.equal(owner.execute('open_offer', { give: 'food', giveAmount: 1, want: 'wood', wantAmount: 1 }).ok, true);
  assert.equal(owner.execute('get_exchanges', {}).items[0].directive, undefined, 'makers cannot take their own escrow');
});
