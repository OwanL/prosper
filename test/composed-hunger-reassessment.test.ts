import { describe, expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { updateKnowledge, observe } from '../src/world/observation.ts';
import { advanceTree } from '../src/world/tree-controller.ts';
import { CONDITIONS, foodAcquisitionTicks } from '../src/citizen/tree-actions.ts';
import type { TreeTaskState } from '../src/shared/tree-types.ts';

function fixture() {
  const world = createWorld({ seed: 7, population: 2, controllerMode: 'composed', autonomy: false });
  world.deposits = {}; world.buildings = {};
  const [a, peer] = Object.values(world.citizens);
  for (const c of [a, peer]) { c.x = 4; c.y = 4; c.inventory = {}; c.gold = 100; c.fullness = 100; }
  a.fullness = 0; a.health = 12;
  const goal: TreeTaskState = { id: `${a.id}:0:ObtainResource:food:2`, definitionId: 'ObtainResource',
    request: { id: `${a.id}:0:ObtainResource:food:2`, resource: 'food', tier: 2, quantity: 1, allowMarket: true, purpose: 'Maintain food reserve', urgency: 'survival' },
    ancestry: [], phase: 'travel:0', status: 'running', startedTick: 0, lastProgressTick: 0,
    delivered: 0, receiptIds: [], ownedOrderIds: [], strategyId: 'harvest', targetId: 'lost', target: { x: 4, y: 4 } };
  a.mind!.tasks = [goal]; a.mind!.activeTaskId = goal.id;
  world.deposits.lost = { id: 'lost', x: 4, y: 4, resource: 'food', tier: 2, stock: 0, capacity: 1, regrowAt: 500 };
  updateKnowledge(world);
  return { world, a, peer, goal };
}

describe('persistent hungry acquisition reassessment through real mechanics', () => {
  it('abandons depleted exact-tier work for nearby lower-tier food and actually eats', () => {
    const { world, a, goal } = fixture();
    world.deposits.safe = { id: 'safe', x: 4, y: 4, resource: 'food', tier: 1, stock: 2, capacity: 2, regrowAt: 0 };
    updateKnowledge(world); tickWorld(world, 55);
    expect(goal.status).toBe('failed'); expect(goal.delivered).toBe(0);
    expect(a.alive).toBe(true); expect(a.fullness).toBeGreaterThan(0);
    expect(a.mind!.memories.some(m => m.kind === 'survival' && /Ate T1/.test(m.text))).toBe(true);
  });
  it('predicts a visible earlier competitor and chooses another deposit without cancelling the winner', () => {
    const { world, a, peer, goal } = fixture();
    goal.request.tier = 1; world.deposits.lost.tier = 1; world.deposits.lost.stock = 1; world.deposits.lost.regrowAt = 0;
    peer.inventory['knife:1'] = 1;
    expect(dispatch(world, peer.id, { type: 'harvest', depositId: 'lost' }).ok).toBe(true);
    world.deposits.safe = { id: 'safe', x: 4, y: 5, resource: 'food', tier: 1, stock: 1, capacity: 1, regrowAt: 0 };
    updateKnowledge(world);
    tickWorld(world, 55, { authority: { citizens: { [peer.id]: 'direct', [a.id]: 'local-ai' } } });
    expect(a.alive).toBe(true); expect(a.fullness).toBeGreaterThan(0);
    expect(peer.inventory['food:1']).toBe(1);
    expect(a.mind!.trace.some(e => e.command?.type === 'harvest' && e.command.depositId === 'safe')).toBe(true);
    expect(a.mind!.trace.some(e => e.command?.type === 'cancel')).toBe(false);
  });
  it('uses public available market supply instead of starving on a depleted goal', () => {
    const { world, a, peer, goal } = fixture(); peer.inventory['food:1'] = 1;
    expect(dispatch(world, peer.id, { type: 'order', side: 'sell', item: 'food:1', quantity: 1, price: 2 }).ok).toBe(true);
    updateKnowledge(world); tickWorld(world, 8, { authority: { citizens: { [peer.id]: 'direct', [a.id]: 'local-ai' } } });
    expect(goal.status).toBe('failed'); expect(a.alive).toBe(true); expect(a.fullness).toBeGreaterThan(0);
    expect(a.mind!.memories.some(m => m.kind === 'survival')).toBe(true);
  });
  it('combines carried cash with a funded sale to forecast, buy and eat urgent food', () => {
    const { world, a, peer, goal } = fixture();
    a.gold = 5; a.inventory['axe:1'] = 1; peer.inventory['food:1'] = 1;
    expect(dispatch(world, peer.id, { type: 'order', side: 'buy', item: 'axe:1', quantity: 1, price: 7 }).ok).toBe(true);
    expect(dispatch(world, peer.id, { type: 'order', side: 'sell', item: 'food:1', quantity: 1, price: 10 }).ok).toBe(true);
    updateKnowledge(world);
    const foodTask = { ...goal, request: { ...goal.request, tier: 1 } };
    expect(foodAcquisitionTicks(observe(world, a.id), foodTask)).toBeLessThan(Infinity);
    tickWorld(world, 12, { authority: { citizens: { [peer.id]: 'direct', [a.id]: 'local-ai' } } });
    expect(goal.status).toBe('failed');
    expect(a.alive).toBe(true); expect(a.fullness).toBeGreaterThan(0);
    expect(a.inventory['axe:1'] ?? 0).toBe(0);
    expect(peer.inventory['axe:1']).toBe(1);
    expect(a.gold).toBe(2); expect(peer.gold).toBe(103);
    expect(a.mind!.memories.some(m => m.kind === 'survival' && /Ate T1/.test(m.text))).toBe(true);
  });
  it('boundedly retires an impossible goal without invented delivery or spawn', () => {
    const { world, a, goal } = fixture(); tickWorld(world, 20);
    expect(goal.status).toBe('failed'); expect(goal.delivered).toBe(0);
    expect(a.mind!.receipts).toHaveLength(0); expect(world.deposits.lost.stock).toBe(0);
    expect(a.mind!.trace.filter(e => e.reason.startsWith('food-route:') && e.transition === 'interrupt')).toHaveLength(1);
  });
  it('does not use hidden fresh stock to change a dated estimate', () => {
    const { world, a, goal } = fixture(); const o = observe(world, a.id);
    const before = foodAcquisitionTicks(o, goal);
    world.deposits.lost.stock = 10;
    expect(foodAcquisitionTicks(o, goal)).toBe(before);
  });
  it('leaves routine nonfood work untouched outside urgency', () => {
    const { world, a, goal } = fixture(); a.fullness = 90;
    goal.request.resource = 'wood'; goal.request.urgency = 'routine';
    world.deposits.lost.resource = 'wood'; world.deposits.lost.tier = 1; world.deposits.lost.stock = 2;
    goal.request.tier = 1; updateKnowledge(world); advanceTree(world, a);
    expect(goal.phase.startsWith('exit')).toBe(false);
    expect(a.mind!.trace.some(e => e.reason.startsWith('food-route:'))).toBe(false);
  });
});

// ------------------------------------------------ explicit starvation override

/** Real-engine fixture for the user's explicit starvation rule: fullness truly
 * exhausted (the engine's actual starvation state), no autonomy, composed tree
 * controller only. Deposits, orders and tasks are staged through dispatch and
 * real knowledge updates; nothing is mocked. */
function starveFixture() {
  const world = createWorld({ seed: 7, population: 2, controllerMode: 'composed', autonomy: false });
  world.deposits = {}; world.buildings = {};
  const [a, peer] = Object.values(world.citizens);
  for (const c of [a, peer]) { c.x = 4; c.y = 4; c.inventory = {}; c.gold = 100; c.fullness = 100; }
  a.fullness = 0; a.health = 25; // engine starvation: health drains at 0.2/tick
  updateKnowledge(world);
  return { world, a, peer, auth: { authority: { citizens: { [peer.id]: 'direct', [a.id]: 'local-ai' } as Record<string, 'direct' | 'local-ai'> } } };
}
const seedTask = (fixture: ReturnType<typeof starveFixture>, task: TreeTaskState) => {
  fixture.a.mind!.tasks = [task]; fixture.a.mind!.activeTaskId = task.id; return task;
};
const baseTask = (id: string, definitionId: string, resource: 'food' | 'wood', tier: 1 | 2, patch: Partial<TreeTaskState> = {}): TreeTaskState => ({
  id, definitionId,
  request: { id: `${id}-req`, resource, tier, quantity: 1, allowMarket: true, purpose: 'test', urgency: 'survival' },
  ancestry: [], phase: 'start', status: 'running', startedTick: 0, lastProgressTick: 0,
  delivered: 0, receiptIds: [], ownedOrderIds: [], ...patch,
});
const place = (fixture: ReturnType<typeof starveFixture>, id: string, x: number, y: number, resource: 'food' | 'wood', stock: number) => {
  fixture.world.deposits[id] = { id, x, y, resource, tier: 1, stock, capacity: stock, regrowAt: 0 };
};
const starvationInterrupts = (fixture: ReturnType<typeof starveFixture>): number =>
  fixture.a.mind!.trace.filter(e => e.transition === 'interrupt' && /^starvation-critical$/.test(e.reason)).length;
const listAsk = (fixture: ReturnType<typeof starveFixture>, price = 2) => {
  fixture.peer.inventory['food:1'] = 1;
  expect(dispatch(fixture.world, fixture.peer.id, { type: 'order', side: 'sell', item: 'food:1', quantity: 1, price }).ok).toBe(true);
  updateKnowledge(fixture.world);
};
const ateT1 = (fixture: ReturnType<typeof starveFixture>): boolean =>
  fixture.a.mind!.memories.some(m => m.kind === 'survival' && /Ate T1/.test(m.text));
const run = (fixture: ReturnType<typeof starveFixture>, ticks: number, until: () => boolean): void => {
  for (let t = 0; t < ticks && !until(); t++) tickWorld(fixture.world, 1, fixture.auth);
};

describe('explicit starvation rule: guard decides, not a route estimate', () => {
  it('interrupts unrelated nonfood work at starvation and eats through ObtainFoodNow', () => {
    const fx = starveFixture();
    fx.a.gold = 2; // Immediate ask is funded; half-cash background buying cannot preempt the remedy.
    place(fx, 'wood1', 6, 4, 'wood', 3);
    const work = seedTask(fx, baseTask('wood-1', 'Harvest', 'wood', 1,
      { strategyId: 'harvest', targetId: 'wood1', target: { x: 6, y: 4 }, phase: 'travel:0' }));
    listAsk(fx);
    run(fx, 60, () => work.status !== 'running' && ateT1(fx));
    const foodNow = fx.a.mind!.tasks.find(t => t.definitionId === 'ObtainFoodNow');
    expect(foodNow).toMatchObject({ status: 'succeeded', delivered: 1 });
    expect(fx.a.mind!.receipts.some(r => r.item === 'food:1' && r.requestId === foodNow!.request.id)).toBe(true);
    expect(ateT1(fx)).toBe(true);
    expect(fx.a.alive).toBe(true); expect(fx.a.fullness).toBeGreaterThan(0);
  });

  it('interrupts an ongoing food-travel task at starvation and buys instead', () => {
    const fx = starveFixture();
    place(fx, 'feast', 4, 5, 'food', 2);
    const trip = seedTask(fx, baseTask('trip-1', 'ObtainResource', 'food', 1,
      { strategyId: 'harvest', targetId: 'feast', target: { x: 4, y: 5 }, phase: 'travel:0' }));
    run(fx, 1, () => false);
    expect(fx.a.mind!.trace.some(e => e.transition === 'propose')).toBe(true); // the trip was already underway
    listAsk(fx);
    run(fx, 60, () => trip.status !== 'running' && ateT1(fx));
    expect(trip).toMatchObject({ status: 'failed', reason: expect.stringContaining('interrupted: starvation-critical') });
    const foodNow = fx.a.mind!.tasks.find(t => t.definitionId === 'ObtainFoodNow');
    expect(foodNow).toMatchObject({ status: 'succeeded', delivered: 1 });
    expect(ateT1(fx)).toBe(true);
    // The trip never consumed the deposit: no invented harvest settlement either.
    expect(fx.world.deposits.feast!.stock).toBe(2);
    expect(fx.a.mind!.receipts.filter(r => r.source === 'harvest')).toHaveLength(0);
  });

  it('interrupts an active food harvest mid-action at starvation and buys instead', () => {
    const fx = starveFixture();
    place(fx, 'feast', 4, 5, 'food', 2);
    const harvest = seedTask(fx, baseTask('harv-1', 'Harvest', 'food', 1,
      { strategyId: 'harvest', targetId: 'feast', target: { x: 4, y: 5 }, phase: 'travel:0' }));
    // Let the trip arrive and install the real 40-tick harvest action first.
    for (let t = 0; t < 20 && fx.a.action?.command?.type !== 'harvest'; t++) tickWorld(fx.world, 1, fx.auth);
    expect(fx.a.action?.command).toMatchObject({ type: 'harvest', depositId: 'feast' });
    listAsk(fx);
    run(fx, 60, () => harvest.status !== 'running' && ateT1(fx));
    expect(harvest).toMatchObject({ status: 'failed', reason: expect.stringContaining('interrupted: starvation-critical') });
    // Cleanup stopped the owned action through the standard exit machinery.
    expect(fx.a.mind!.trace.some(e => e.transition === 'propose' && e.command?.type === 'cancel')).toBe(true);
    const foodNow = fx.a.mind!.tasks.find(t => t.definitionId === 'ObtainFoodNow');
    expect(foodNow).toMatchObject({ status: 'succeeded', delivered: 1 });
    expect(ateT1(fx)).toBe(true);
    expect(fx.world.deposits.feast!.stock).toBe(2);
    expect(fx.a.mind!.receipts.filter(r => r.source === 'harvest')).toHaveLength(0);
  });

  it('interrupts a partially delivered food goal, preserves its receipts, and eats through ObtainFoodNow', () => {
    const fx = starveFixture();
    const partial = seedTask(fx, baseTask('part-1', 'ObtainResource', 'food', 1,
      { strategyId: 'harvest', targetId: 'feast', target: { x: 4, y: 5 }, phase: 'travel:0' }));
    partial.request.quantity = 2; partial.delivered = 1; partial.receiptIds = ['r-partial-1'];
    fx.a.mind!.receipts = [{ id: 'r-partial-1', settlementId: 's-partial-1', tick: 0, citizenId: fx.a.id,
      item: 'food:1', quantity: 1, source: 'market', requestId: partial.request.id }];
    listAsk(fx);
    run(fx, 60, () => partial.status !== 'running' && ateT1(fx));
    expect(partial).toMatchObject({ status: 'failed', reason: expect.stringContaining('interrupted: starvation-critical') });
    // Interrupted partial work keeps its allocated receipt and exact count.
    expect(partial.delivered).toBe(1);
    expect(partial.receiptIds).toEqual(['r-partial-1']);
    const kept = fx.a.mind!.receipts.find(r => r.id === 'r-partial-1');
    expect(kept).toMatchObject({ item: 'food:1', quantity: 1, requestId: partial.request.id });
    // Only engine settlements exist: the seeded market receipt plus the real buy.
    expect(fx.a.mind!.receipts.filter(r => r.quantity > 0)).toHaveLength(2);
    const foodNow = fx.a.mind!.tasks.find(t => t.definitionId === 'ObtainFoodNow');
    expect(foodNow).toMatchObject({ status: 'succeeded', delivered: 1 });
    expect(ateT1(fx)).toBe(true);
  });

  it('does not interrupt or thrash usable food work when the guard is false', () => {
    const fx = starveFixture(); // no market supply anywhere: CanObtainFoodNow false
    place(fx, 'feast', 4, 5, 'food', 2);
    const trip = seedTask(fx, baseTask('trip-1', 'ObtainResource', 'food', 1,
      { strategyId: 'harvest', targetId: 'feast', target: { x: 4, y: 5 }, phase: 'travel:0' }));
    run(fx, 90, () => ateT1(fx));
    expect(trip.status).toBe('succeeded');
    expect(trip.delivered).toBeGreaterThan(0);
    expect(fx.a.mind!.tasks.some(t => t.definitionId === 'ObtainFoodNow')).toBe(false);
    // Not one hunger interrupt touched the usable trip before it delivered.
    expect(fx.a.mind!.trace.filter(e => e.transition === 'interrupt' && /critical/.test(e.reason))).toHaveLength(0);
    expect(ateT1(fx)).toBe(true);
  });

  it('does not re-interrupt a citizen already inside an ObtainFoodNow tree', () => {
    const fx = starveFixture();
    const resting = dispatch(fx.world, fx.a.id, { type: 'order', side: 'buy', item: 'food:1', quantity: 1, price: 2 });
    expect(resting.ok).toBe(true);
    const foodNow = seedTask(fx, baseTask('now-1', 'ObtainFoodNow', 'food', 1,
      { strategyId: 'buy', phase: 'buy', wakeTick: 0 }));
    run(fx, 40, () => false);
    // Already inside the remedy tree: no interrupt, no re-entry, escrow preserved.
    expect(starvationInterrupts(fx)).toBe(0);
    expect(fx.a.mind!.trace.filter(e => e.transition === 'interrupt')).toHaveLength(0);
    expect(fx.a.mind!.tasks.filter(t => t.definitionId === 'ObtainFoodNow')).toHaveLength(1);
    expect(foodNow.status).toBe('running');
    expect(foodNow.ownedOrderIds).toContain(resting.order!.id);
    expect(fx.world.orders[resting.order!.id]).toBeDefined();
  });

  it('bypasses a failed ObtainFoodNow cooldown at starvation and lands on the guard-true remedy without alternating or idling', () => {
    const fx = starveFixture();
    fx.a.gold = 2; // Preserve the explicit remedy's funded ask without background preemption.
    fx.a.health = 8; // urgent: starvation drains this health to death in ~40 ticks
    place(fx, 'wood1', 6, 4, 'wood', 3);
    // Replaceable work with real partial progress: the interrupt cleanup must
    // conserve the paid-for receipt exactly like the food-goal fixtures do.
    const work = seedTask(fx, baseTask('wood-1', 'Harvest', 'wood', 1,
      { strategyId: 'harvest', targetId: 'wood1', target: { x: 6, y: 4 }, phase: 'travel:0' }));
    work.delivered = 1; work.receiptIds = ['r-wood-1'];
    fx.a.mind!.receipts = [{ id: 'r-wood-1', settlementId: 's-wood-1', tick: 0, citizenId: fx.a.id,
      item: 'wood:1', quantity: 1, source: 'harvest', requestId: work.request.id }];
    // A recent failed T1 ObtainFoodNow invocation: the failed-goal cooldown used
    // to exclude the remedy from selection after the override cancelled the wood
    // work, so cheap affordable food stayed listed while the citizen idled.
    fx.a.mind!.trace.push({ tick: 0,
      invocationId: `${fx.a.id}:0:ObtainFoodNow:food:1:0`, definitionId: 'ObtainFoodNow',
      transition: 'fail', reason: 'Ask vanished before purchase' });
    // Public T1 food ask of quantity 2: the authoritative guard itself attests
    // a fundable immediate route before any controller tick runs.
    fx.peer.inventory['food:1'] = 2;
    expect(dispatch(fx.world, fx.peer.id,
      { type: 'order', side: 'sell', item: 'food:1', quantity: 2, price: 2 }).ok).toBe(true);
    updateKnowledge(fx.world);
    const guard = CONDITIONS.CanObtainFoodNow!.evaluate(observe(fx.world, fx.a.id),
      baseTask('probe-foodnow', 'ObtainFoodNow', 'food', 1));
    expect(guard.ok).toBe(true);
    run(fx, 60, () => work.status !== 'running' && ateT1(fx));
    // The override interrupt preserved the partial progress through cleanup.
    expect(work).toMatchObject({ status: 'failed', delivered: 1, receiptIds: ['r-wood-1'],
      reason: expect.stringContaining('interrupted: starvation-critical') });
    const kept = fx.a.mind!.receipts.find(r => r.id === 'r-wood-1');
    expect(kept?.quantity).toBe(1);
    // Direct guard-true replacement: ObtainFoodNow bought and ate, with no
    // alternating interrupt chain through fresh acquisition work in between.
    const foodNow = fx.a.mind!.tasks.find(t => t.definitionId === 'ObtainFoodNow');
    expect(foodNow).toMatchObject({ status: 'succeeded', delivered: 1, request: { tier: 1 } });
    expect(fx.a.mind!.receipts.some(r => r.item === 'food:1' && r.quantity > 0 &&
      r.requestId === foodNow!.request.id)).toBe(true);
    expect(fx.a.mind!.tasks.filter(t => t.definitionId === 'ObtainResource' && t.request.resource === 'food')).toHaveLength(0);
    expect(fx.a.mind!.trace.filter(e => e.transition === 'interrupt')).toHaveLength(1);
    // No idle stretch while affordable food was listed: the remedy proposal and
    // the actual meal both landed, and the body is recovering.
    expect(fx.a.mind!.trace.some(e => e.transition === 'propose' &&
      e.invocationId === foodNow!.request.id && e.command?.type === 'order')).toBe(true);
    expect(ateT1(fx)).toBe(true);
    expect(fx.a.alive).toBe(true); expect(fx.a.fullness).toBeGreaterThan(0);
  });

  it('cancels owned escrow through cleanup and conserves the escrowed items', () => {
    const fx = starveFixture();
    fx.a.gold = 2; // Keep the actual starvation interrupt ahead of background buying.
    fx.a.inventory['wood:1'] = 2;
    const listed = dispatch(fx.world, fx.a.id, { type: 'order', side: 'sell', item: 'wood:1', quantity: 2, price: 3 });
    expect(listed.ok).toBe(true);
    const sale = seedTask(fx, baseTask('sale-1', 'SellItem', 'wood', 1, { targetId: 'wood:1' }));
    sale.ownedOrderIds = [listed.order!.id];
    listAsk(fx);
    run(fx, 60, () => sale.status !== 'running' && ateT1(fx));
    expect(sale).toMatchObject({ status: 'failed', reason: expect.stringContaining('interrupted: starvation-critical') });
    expect(fx.world.orders[listed.order!.id]).toBeUndefined();
    expect(fx.a.inventory['wood:1']).toBe(2);
    // No fake completed sale (market receipt); cancellation conserves through a
    // real engine recovery receipt for the exact escrowed quantity.
    expect(fx.a.mind!.receipts.filter(r => r.item === 'wood:1' && r.source === 'market')).toHaveLength(0);
    const recovered = fx.a.mind!.receipts.find(r => r.item === 'wood:1' && r.source === 'recovery');
    expect(recovered?.quantity).toBe(2);
    const foodNow = fx.a.mind!.tasks.find(t => t.definitionId === 'ObtainFoodNow');
    expect(foodNow).toMatchObject({ status: 'succeeded', delivered: 1 });
    expect(ateT1(fx)).toBe(true);
  });
});
