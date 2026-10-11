import { expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { advanceTree } from '../src/world/tree-controller.ts';
import { knownBuyPrice } from '../src/citizen/tree-market.ts';
import type { TreeTaskState } from '../src/shared/tree-types.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import { BALANCE, nutrition } from '../src/world/config.ts';
function fixture() {
  const w=createWorld({seed:937,population:2,controllerMode:'composed',autonomy:false});
  w.deposits={}; w.buildings={};
  const [buyer,seller]=Object.values(w.citizens);
  for(const c of [buyer,seller]) {c.x=4;c.y=4;c.inventory={};c.gold=100;c.fullness=100;}
  buyer.fullness=25; updateKnowledge(w);
  dispatch(w,buyer.id,{type:'move',x:10,y:4});
  return {w,buyer,seller};
}
it('recounts returned sell custody before admitting food demand',()=>{
  const {w,buyer}=fixture();buyer.inventory={'food:1':2};
  dispatch(w,buyer.id,{type:'order',side:'sell',item:'food:1',quantity:2,price:30});
  w.tick=20;advanceTree(w,buyer);
  expect(buyer.inventory['food:1']).toBe(2);
  expect(Object.values(w.orders).some(x=>x.citizenId===buyer.id&&x.side==='buy')).toBe(true);
});
it('buys known higher-tier nutrition while preserving ongoing work and background provenance',()=>{
  const {w,buyer,seller}=fixture(); seller.inventory={'food:2':4};
  dispatch(w,seller.id,{type:'order',side:'sell',item:'food:2',quantity:2,price:3});
  const action=buyer.action!.id;
  w.tick=20;advanceTree(w,buyer);
  expect(buyer.inventory['food:2']).toBeGreaterThanOrEqual(1);
  expect(buyer.action?.id).toBe(action);
  expect(buyer.mind!.receipts.at(-1)?.requestId).toBeUndefined();
  const fullness=buyer.fullness, food=buyer.inventory['food:2'];tickWorld(w);
  expect(buyer.fullness).toBeGreaterThan(fullness);
  expect(buyer.inventory['food:2']).toBeLessThan(food);
});
it('posts genuine material surplus during long work and preserves its tool',()=>{
  const {w,buyer}=fixture(); buyer.fullness=100;buyer.inventory={'wood:1':8,'axe:1':1};
  const action=buyer.action!.id; w.tick=20;advanceTree(w,buyer);
  expect(Object.values(w.orders).some(x=>x.side==='sell'&&x.item==='wood:1'&&x.requestId===null)).toBe(true);
  expect(Object.values(w.orders).some(x=>x.item==='axe:1')).toBe(false);
  expect(buyer.action?.id).toBe(action);
});
it('procures distinct T1 for an active family provision despite carried T2 nutrition',()=>{
  const {w,buyer,seller}=fixture(); buyer.fullness=100;buyer.inventory={'food:2':3};
  const goal:TreeTaskState={id:'family',definitionId:'ObtainResource',request:{id:'family',resource:'food',tier:1,quantity:1,allowMarket:true,purpose:'Prepare own family provisions',urgency:'routine'},ancestry:[],phase:'start',status:'running',startedTick:0,lastProgressTick:0,delivered:0,receiptIds:[],ownedOrderIds:[]};
  buyer.mind!.tasks=[goal];buyer.mind!.activeTaskId=goal.id;
  w.tick=20;advanceTree(w,buyer);
  expect(Object.values(w.orders).find(x=>x.side==='buy')?.item).toBe('food:1');
  seller.inventory={'food:1':1};dispatch(w,seller.id,{type:'order',side:'sell',item:'food:1',quantity:1,price:1});
  expect(buyer.inventory['food:1']).toBe(1);
  const {w:other,buyer:ordinary}=fixture(); ordinary.fullness=100;ordinary.inventory={'food:2':3};
  other.tick=20;advanceTree(other,ordinary);
  expect(Object.values(other.orders).some(x=>x.side==='buy')).toBe(false);
});
it.each([1,14])('moves aged bids toward known quotes in either direction from %s',price=>{
  const {w,buyer}=fixture();
  dispatch(w,buyer.id,{type:'order',side:'buy',item:'food:1',quantity:1,price});
  w.tick=100;advanceTree(w,buyer);
  const bid=Object.values(w.orders).find(x=>x.citizenId===buyer.id&&x.side==='buy')!;
  expect(bid.price).not.toBe(price);
  expect(Math.abs(bid.price-price)).toBeLessThanOrEqual(2);
  expect(price===1?bid.price>price:bid.price<price).toBe(true);
});
it('does not bid against a newly posted own food ask',()=>{
  const {w,buyer}=fixture();buyer.inventory={'food:2':1};
  w.tick=20;advanceTree(w,buyer);
  const own=Object.values(w.orders).filter(x=>x.citizenId===buyer.id);
  for(const ask of own.filter(x=>x.side==='sell')) expect(own.some(x=>x.side==='buy'&&x.item===ask.item)).toBe(false);
});
it('reconsiders an aged T1 bid for better observed T2 nutrition',()=>{
  const {w,buyer,seller}=fixture();
  dispatch(w,buyer.id,{type:'order',side:'buy',item:'food:1',quantity:2,price:5});
  seller.inventory={'food:2':2};dispatch(w,seller.id,{type:'order',side:'sell',item:'food:2',quantity:2,price:3});
  w.tick=100;advanceTree(w,buyer);
  expect(buyer.inventory['food:2']).toBeGreaterThan(0);
  expect(Object.values(w.orders).some(x=>x.citizenId===buyer.id&&x.item==='food:1'&&x.side==='buy')).toBe(false);
});
it('allocates a single half-wealth cap across multiple legacy food bids',()=>{
  const {w,buyer}=fixture();buyer.gold=100;
  dispatch(w,buyer.id,{type:'order',side:'buy',item:'food:1',quantity:2,price:12});
  dispatch(w,buyer.id,{type:'order',side:'buy',item:'food:2',quantity:2,price:18});
  w.tick=100;advanceTree(w,buyer);
  const bids=Object.values(w.orders).filter(x=>x.citizenId===buyer.id&&x.side==='buy');
  expect(bids.reduce((n,x)=>n+x.escrowGold,0)).toBeLessThanOrEqual(50);
  expect(buyer.gold+bids.reduce((n,x)=>n+x.escrowGold,0)).toBeCloseTo(100);
});
it('executes fractional T3 at its actual ask instead of an unmatched optimistic T1 bid',()=>{
  const {w,buyer,seller}=fixture(); buyer.fullness=40;buyer.gold=30;
  seller.inventory={'food:3':11,'food:1':1};
  dispatch(w,seller.id,{type:'order',side:'sell',item:'food:3',quantity:11,price:100});
  dispatch(w,seller.id,{type:'order',side:'sell',item:'food:1',quantity:1,price:30});
  const gold=buyer.gold+seller.gold, action=buyer.action!.id;
  w.tick=20;advanceTree(w,buyer);
  expect(buyer.inventory['food:3']).toBeCloseTo(.15);
  expect(buyer.inventory['food:1']??0).toBe(0);
  expect(buyer.gold).toBeCloseTo(15);
  expect(buyer.gold+seller.gold).toBeCloseTo(gold);
  expect(Object.values(w.orders).find(x=>x.item==='food:3')?.quantity).toBeCloseTo(10.85);
  expect(buyer.action?.id).toBe(action);
  // The buyer stays at 40 fullness through procurement, then eats the actual
  // fractional T3 meal during ordinary metabolism while continuing the action.
  const fullness=buyer.fullness;
  tickWorld(w);
  expect(buyer.fullness).toBeCloseTo(fullness- BALANCE.fullnessDrain + nutrition(3)*.15,9);
  expect(buyer.inventory['food:3']??0).toBe(0);
  expect(buyer.action?.id).toBe(action);
  expect(buyer.alive).toBe(true);
});
it('prices executions only from personal alerts rather than spectator last prices',()=>{
  const {w,buyer}=fixture();const o=observe(w,buyer.id);
  const base=knownBuyPrice(o,'food:1');
  expect(knownBuyPrice({...o,alerts:[]},'food:1')).toBe(base);
  const event={id:'known',tick:1,kind:'trade' as const,text:'1 food:1 sold for 25 gold each.'};
  expect(knownBuyPrice({...o,alerts:[event]},'food:1')).toBe(25);
});
