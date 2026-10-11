import { expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import { stepTreeTask } from '../src/citizen/tree-actions.ts';
import { effortPrice, quotePrice } from '../src/citizen/tree-market.ts';
import type { TreeTaskState } from '../src/shared/tree-types.ts';

it('quotes grounded empty-book asks and reprices only remaining escrow without losing partial fills', () => {
  const w = createWorld({ population: 2, autonomy: false }); w.controllerMode = 'composed';
  const [a, b] = Object.values(w.citizens); a!.inventory = { 'wood:1': 3 }; b!.gold = 500;
  a!.x = b!.x = 4; a!.y = b!.y = 4; updateKnowledge(w);
  const state: TreeTaskState = { id: 'sale', definitionId: 'SellItem', targetId: 'wood:1', ancestry: [], phase: '', status: 'running', startedTick: 0, lastProgressTick: 0, delivered: 0, receiptIds: [], ownedOrderIds: [], request: { id: 'r', resource: 'wood', tier: 1, quantity: 3, allowMarket: true, purpose: 'sale', urgency: 'routine' } };
  const gold = a!.gold + b!.gold;
  const first = stepTreeTask(observe(w, a!.id), state);
  expect(first.command).toMatchObject({ type: 'order', side: 'sell' });
  if (first.command?.type !== 'order') throw Error('missing quote');
  expect(first.command.price).toBeGreaterThan(1);
  expect(effortPrice('wood:2')).toBeGreaterThan(effortPrice('wood:1'));
  const posted = dispatch(w, a!.id, first.command);
  expect(posted.ok).toBe(true);
  state.ownedOrderIds.push(posted.order!.id);
  expect(dispatch(w, b!.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 1, price: first.command.price }).ok).toBe(true);
  stepTreeTask(observe(w, a!.id), state); expect(state.accounting?.units).toBe(1);
  const floor = state.wakeTick;
  tickWorld(w, 180, { authority: { citizens: { [a!.id]: 'direct', [b!.id]: 'direct' }, newbornAuthority: 'passive-body' } }); updateKnowledge(w);
  const revision = stepTreeTask(observe(w, a!.id), state);
  expect(revision.command?.type).toBe('cancel-order');
  expect(dispatch(w, a!.id, revision.command!).ok).toBe(true);
  const repost = stepTreeTask(observe(w, a!.id), state);
  expect(repost.command).toMatchObject({ type: 'order', quantity: 2 });
  expect(state.wakeTick).toBe(floor); expect(state.accounting?.units).toBe(1);
  const reposted = dispatch(w, a!.id, repost.command!);
  expect(reposted.ok).toBe(true);
  state.ownedOrderIds.push(reposted.order!.id);
  expect(dispatch(w, b!.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 2, price: 100 }).ok).toBe(true);
  expect(stepTreeTask(observe(w, a!.id), state).status).toBe('succeeded');
  expect(state.accounting?.units).toBe(3); expect(a!.gold + b!.gold).toBe(gold);
  expect(Object.values(w.orders)).toHaveLength(0);
});
it('ignores an older same-citizen same-item listing filled while its own listing rests', () => {
  const w = createWorld({ population: 2, autonomy: false });
  const [a, b] = Object.values(w.citizens); a!.inventory = { 'wood:1': 2 }; b!.gold = 500;
  dispatch(w, a!.id, { type: 'order', side: 'sell', item: 'wood:1', quantity: 1, price: 1 });
  const state: TreeTaskState = { id: 'sale', definitionId: 'SellItem', targetId: 'wood:1', ancestry: [], phase: '', status: 'running', startedTick: 0, lastProgressTick: 0, delivered: 0, receiptIds: [], ownedOrderIds: [], request: { id: 'r', resource: 'wood', tier: 1, quantity: 1, allowMarket: true, purpose: 'sale', urgency: 'routine' } };
  const first = stepTreeTask(observe(w, a!.id), state);
  const posted = dispatch(w, a!.id, first.command!); state.ownedOrderIds.push(posted.order!.id);
  dispatch(w, b!.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 1, price: 100 });
  expect(stepTreeTask(observe(w, a!.id), state).status).toBe('running');
  expect(state.accounting?.units ?? 0).toBe(0);
  expect(w.orders[posted.order!.id]).toBeDefined();
});

it('does not dump an empty-book effort-valued commodity into an arbitrary low bid', () => {
  const w = createWorld({ population: 2, autonomy: false }); const [a,b] = Object.values(w.citizens);
  dispatch(w,b!.id,{ type:'order', side:'buy', item:'wood:1', quantity:1, price:1 });
  expect(quotePrice(observe(w,a!.id),'wood:1')).toBeGreaterThan(1);
});

it('persistent dispositions produce distinct patient versus generous quotations', () => {
  const w = createWorld({ population: 1, autonomy: false });
  const a = Object.values(w.citizens)[0]!;
  const dispositions = { ambition: 1, morals: 0, generosity: 0, riskTolerance: 1, patience: 1, sociability: 0, vengefulness: 1, familyOrientation: 1, enterprise: 1, economicIndependence: 1 };
  a.mind = { version: 1, dispositions, memories: [], memoriesOmitted: 0, tasks: [], receipts: [], trace: [], traceOmitted: 0, nextDirectorTick: 2400 };
  const patient = quotePrice(observe(w,a.id), 'wood:2');
  a.mind.dispositions = { ambition: 0, morals: 1, generosity: 1, riskTolerance: 0, patience: 0, sociability: 1, vengefulness: 0, familyOrientation: 0, enterprise: 0, economicIndependence: 0 };
  expect(quotePrice(observe(w,a.id), 'wood:2')).toBeLessThan(patient);
});
