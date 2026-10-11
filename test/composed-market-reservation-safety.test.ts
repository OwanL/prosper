import { expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import { fundingCapacity } from '../src/citizen/tree-actions.ts';
import { backgroundSaleReserves, carriedSurplus } from '../src/citizen/tree-surplus.ts';
import type { TreeTaskState } from '../src/shared/tree-types.ts';

function task(definitionId = 'ObtainFoodNow'): TreeTaskState {
  return { id: 'safety', definitionId, request: { id: 'safety', resource: 'food', tier: 1, quantity: 1, allowMarket: true, purpose: 'Immediate meal', urgency: 'survival' }, ancestry: [], phase: 'start', status: 'running', startedTick: 0, lastProgressTick: 0, delivered: 0, receiptIds: [], ownedOrderIds: [] };
}
it('only funded immediate starving food can liquidate the highest carried tool', () => {
  const world = createWorld({ seed: 7, population: 2, controllerMode: 'composed', autonomy: false });
  world.deposits = {}; world.buildings = {};
  const [a, b] = Object.values(world.citizens);
  for (const c of [a,b]) { c.x = 4; c.y = 4; c.inventory = {}; c.gold = 100; c.fullness = 100; }
  a.gold = 5; a.fullness = 0; a.inventory['axe:1'] = 1; b.inventory['food:1'] = 1;
  dispatch(world,b.id,{type:'order',side:'sell',item:'food:1',quantity:1,price:10});
  updateKnowledge(world);
  expect(fundingCapacity(observe(world,a.id),task()).total).toBe(0);
  dispatch(world,b.id,{type:'order',side:'buy',item:'axe:1',quantity:1,price:7});
  updateKnowledge(world);
  expect(fundingCapacity(observe(world,a.id),task()).total).toBe(7);
  a.fullness = 100;
  expect(fundingCapacity(observe(world,a.id),task()).total).toBe(0);
  expect(carriedSurplus(observe(world,a.id),'axe:1')).toBe(0);
  a.fullness = 0;
  tickWorld(world,12,{authority:{citizens:{[a.id]:'local-ai',[b.id]:'direct'}}});
  expect(a.fullness).toBeGreaterThan(0); expect(a.alive).toBe(true);
  expect(a.inventory['axe:1'] ?? 0).toBe(0); expect(b.inventory['axe:1']).toBe(1);
  expect(a.gold).toBe(2); expect(b.gold).toBe(103);
});
it('interrupts routine knife commitments to fund a starving meal',()=>{
  const world=createWorld({seed:7,population:2,controllerMode:'composed',autonomy:false});
  world.deposits={};world.buildings={};
  const [a,b]=Object.values(world.citizens);
  for(const c of [a,b]) {c.x=4;c.y=4;c.inventory={};c.gold=100;c.fullness=100;}
  a.gold=5;a.fullness=0;a.inventory={'wood:1':3};b.inventory={'food:1':1};
  const work=task('ObtainTool');work.id='knife';work.request.id='knife';work.request.resource='wood';work.request.urgency='routine';work.request.purpose='Materials for knife T1';work.targetId='knife:1';
  a.mind!.tasks=[work];a.mind!.activeTaskId=work.id;
  dispatch(world,b.id,{type:'order',side:'sell',item:'food:1',quantity:1,price:10});
  dispatch(world,b.id,{type:'order',side:'buy',item:'wood:1',quantity:3,price:5});
  updateKnowledge(world);
  expect(fundingCapacity(observe(world,a.id),task()).inventorySales).toBe(15);
  expect(carriedSurplus(observe(world,a.id),'wood:1')).toBe(0);
  tickWorld(world,12,{authority:{citizens:{[a.id]:'local-ai',[b.id]:'direct'}}});
  expect(a.fullness).toBeGreaterThan(0);expect(a.alive).toBe(true);
  expect(b.inventory['wood:1']).toBe(1);
  expect(a.gold).toBe(0);
  expect(a.mind!.trace.some(x=>x.transition==='interrupt')).toBe(true);
});
it('background reserves only remaining unescrowed sale custody, never self-blocking execution', () => {
  const world = createWorld({ population: 1, controllerMode: 'composed', autonomy: false });
  const [a] = Object.values(world.citizens); a.inventory = {'wood:1':6}; a.fullness = 100;
  const sale = task('SellItem'); sale.request.resource = 'wood'; sale.request.quantity = 4;
  sale.targetId = 'wood:1'; sale.accounting = { units: 2 };
  a.mind!.tasks = [sale];
  dispatch(world,a.id,{type:'order',side:'sell',item:'wood:1',quantity:2,price:20});
  sale.ownedOrderIds = Object.keys(world.orders);
  updateKnowledge(world);
  expect(backgroundSaleReserves(observe(world,a.id))['wood:1']).toBe(0);
  dispatch(world,a.id,{type:'cancel-order',orderId:sale.ownedOrderIds[0]!});
  updateKnowledge(world);
  expect(backgroundSaleReserves(observe(world,a.id))['wood:1']).toBe(2);
  expect(carriedSurplus(observe(world,a.id),'wood:1',sale)).toBe(6);
});
