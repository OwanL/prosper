import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveCheckpoint, loadCheckpoint } from '../src/server/checkpoint.ts';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { advanceTree, prepareTreeCandidates } from '../src/world/tree-controller.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import type { TreeTaskState } from '../src/shared/tree-types.ts';

function fixture() {
  const w = createWorld({seed: 937, population: 2, controllerMode: 'composed', autonomy: false});
  w.deposits = {}; w.buildings = {};
  const [buyer, producer] = Object.values(w.citizens);
  for (const c of [buyer, producer]) { c.x = 4; c.y = 4; c.inventory = {}; c.gold = 100; c.fullness = 100; c.knowledge = {}; }
  buyer.fullness = 25; producer.inventory = {'food:1': 1.8, 'knife:1': 1};
  for (const c of [buyer, producer]) Object.assign(c.mind!.dispositions, {morals:1,vengefulness:0,riskTolerance:0,familyOrientation:0,enterprise:1,ambition:0,economicIndependence:1});
  w.deposits.patch = {id:'patch', x:4,y:4,resource:'food',tier:1,stock:4,capacity:4,regrowAt:0};
  updateKnowledge(w);
  return {w,buyer,producer};
}
function foodTask(id: string): TreeTaskState {
  return {id,definitionId:'ObtainResource',request:{id,resource:'food',tier:1,quantity:1,allowMarket:true,purpose:'test',urgency:'routine'},ancestry:[],phase:'start',status:'running',startedTick:0,lastProgressTick:0,delivered:0,receiptIds:[],ownedOrderIds:[]};
}
it('posts a bounded need bid during physical work without cancelling it', () => {
  const {w,buyer} = fixture();
  dispatch(w,buyer.id,{type:'move',x:10,y:4});
  const action = buyer.action!.id;
  w.tick=20;
  advanceTree(w,buyer);
  const bid = Object.values(w.orders).find(o=>o.citizenId===buyer.id && o.side==='buy')!;
  expect(bid).toBeDefined(); expect(bid.quantity).toBeLessThanOrEqual(3);
  expect(buyer.gold).toBeGreaterThanOrEqual(50); expect(buyer.action?.id).toBe(action);
  advanceTree(w,buyer); expect(Object.values(w.orders)).toHaveLength(1);
  buyer.inventory['food:1']=10; w.tick=40; advanceTree(w,buyer);
  expect(w.orders[bid.id]).toBeUndefined(); expect(buyer.gold).toBe(100);
});
it('shrinks background demand after partial acquisition without repricing or repeated churn', () => {
  const {w,buyer}=fixture();
  dispatch(w,buyer.id,{type:'move',x:10,y:4});
  w.tick=20; advanceTree(w,buyer);
  const original=Object.values(w.orders)[0];
  expect(original.quantity).toBe(3); expect(original.price).toBe(12);
  expect(original.escrowGold).toBe(36);
  buyer.inventory['food:1']=1;
  w.tick=40; advanceTree(w,buyer);
  const reduced=Object.values(w.orders)[0];
  // Desired nutrition is max(20, 60 - 25) = 35; T1 supplies 100/9.
  expect(reduced.quantity).toBeCloseTo(2.15);
  expect(reduced.price).toBe(12); expect(reduced.escrowGold).toBeCloseTo(25.8);
  expect(buyer.gold).toBeCloseTo(74.2); expect(w.orders[original.id]).toBeUndefined();
  w.tick=60; advanceTree(w,buyer);
  expect(Object.values(w.orders)[0].id).toBe(reduced.id);
  buyer.inventory['food:1']=4; w.tick=80; advanceTree(w,buyer);
  expect(Object.values(w.orders)).toHaveLength(0); expect(buyer.gold).toBeCloseTo(100);
});
it('releases the exact excess from the review probe at a preserved 13-gold price', () => {
  const {w,buyer}=fixture();
  dispatch(w,buyer.id,{type:'move',x:10,y:4});
  const bid=dispatch(w,buyer.id,{type:'order',side:'buy',item:'food:1',quantity:3,price:13},'external',undefined,null).order!;
  expect(w.orders[bid.id].escrowGold).toBe(39);
  buyer.inventory['food:1']=1; w.tick=40; advanceTree(w,buyer);
  const reduced=Object.values(w.orders)[0];
  expect(reduced.quantity).toBeCloseTo(2.15); expect(reduced.price).toBe(13);
  expect(reduced.escrowGold).toBeCloseTo(27.95); expect(buyer.gold).toBeCloseTo(72.05);
  expect(w.orders[bid.id]).toBeUndefined();
});
it('reconciles partially executed background bids after restore without counting fills twice', () => {
  const {w,buyer,producer}=fixture();
  dispatch(w,buyer.id,{type:'move',x:10,y:4});
  w.tick=20; advanceTree(w,buyer);
  const bid=Object.values(w.orders)[0];
  dispatch(w,producer.id,{type:'order',side:'sell',item:'food:1',quantity:1,price:bid.price});
  expect(w.orders[bid.id].quantity).toBe(2);
  const unrelated=foodTask('unrelated'); buyer.mind!.tasks=[unrelated]; buyer.mind!.activeTaskId=unrelated.id;
  const owned=dispatch(w,buyer.id,{type:'order',side:'buy',item:'food:1',quantity:.25,price:5},'external',undefined,unrelated.request.id).order!;
  unrelated.ownedOrderIds.push(owned.id);
  const directory=mkdtempSync(join(tmpdir(),'prosper-food-reconcile-'));
  let restored: typeof w;
  try {
    const path=join(directory,'checkpoint.json');
    saveCheckpoint(path,{version:1,savedAt:new Date().toISOString(),world:w,runtime:{running:false,speed:1,mode:'scripted',commandSequence:0,recorded:[]}});
    restored=loadCheckpoint(path)!.world;
  } finally { rmSync(directory,{recursive:true,force:true}); }
  const actor=restored.citizens[buyer.id];
  restored.tick=40; advanceTree(restored,actor);
  // 3.15 desired units - 1 settled - .25 task-owned = 1.9 background.
  const reduced=Object.values(restored.orders).find(o=>o.citizenId===buyer.id && o.id!==owned.id)!;
  expect(reduced.quantity).toBeCloseTo(1.9);
  expect(restored.orders[owned.id]).toEqual(w.orders[owned.id]);
  expect(actor.gold).toBeCloseTo(100-12-1.25-1.9*12);
  expect(actor.mind!.receipts.filter(r=>r.item==='food:1').every(r=>r.requestId===undefined)).toBe(true);
  restored.tick=60; advanceTree(restored,actor);
  expect(restored.orders[reduced.id].quantity).toBeCloseTo(1.9);
  expect(Object.values(restored.citizens).reduce((n,c)=>n+c.gold,0)+Object.values(restored.orders).reduce((n,o)=>n+o.escrowGold,0)).toBeCloseTo(200);
});
it('keeps fractional need but ignores floating dust when reconciling', () => {
  const {w,buyer}=fixture();
  dispatch(w,buyer.id,{type:'move',x:10,y:4});
  w.tick=20; advanceTree(w,buyer);
  buyer.inventory['food:1']=3.14; w.tick=40; advanceTree(w,buyer);
  const bid=Object.values(w.orders)[0];
  expect(bid.quantity).toBeCloseTo(.01,10);
  buyer.inventory['food:1']+=1e-12; w.tick=60; advanceTree(w,buyer);
  expect(Object.values(w.orders)[0].id).toBe(bid.id);
  buyer.inventory['food:1']=3.15-1e-12; w.tick=80; advanceTree(w,buyer);
  expect(Object.values(w.orders)).toHaveLength(0); expect(buyer.gold).toBeCloseTo(100);
});
it('attributes resting fills to the original owner, never an unrelated active food task', () => {
  const {w,buyer,producer} = fixture();
  producer.inventory['food:1'] = 2;
  const unrelated = foodTask('unrelated'); buyer.mind!.tasks=[unrelated]; buyer.mind!.activeTaskId=unrelated.id;
  const bid = dispatch(w,buyer.id,{type:'order',side:'buy',item:'food:1',quantity:.5,price:10}, 'external', undefined, null).order!;
  dispatch(w,producer.id,{type:'order',side:'sell',item:'food:1',quantity:.5,price:10});
  expect(buyer.mind!.receipts.at(-1)?.requestId).toBeUndefined();
  const original = foodTask('original'); buyer.mind!.tasks.push(original);
  const owned = dispatch(w,buyer.id,{type:'order',side:'buy',item:'food:1',quantity:.5,price:10}, 'external', undefined, original.request.id).order!;
  original.ownedOrderIds.push(owned.id);
  const directory = mkdtempSync(join(tmpdir(), 'prosper-food-orders-'));
  let restored: typeof w;
  try {
    const path = join(directory, 'checkpoint.json');
    saveCheckpoint(path, {version:1,savedAt:new Date().toISOString(),world:w,runtime:{running:false,speed:1,mode:'scripted',commandSequence:0,recorded:[]}});
    restored = loadCheckpoint(path)!.world;
  } finally { rmSync(directory,{recursive:true,force:true}); }
  dispatch(restored,producer.id,{type:'order',side:'sell',item:'food:1',quantity:.5,price:10});
  expect(restored.citizens[buyer.id].mind!.receipts.at(-1)?.requestId).toBe('original');
  expect(w.orders[bid.id]).toBeUndefined();
  expect(Object.values(restored.citizens).reduce((n,c)=>n+(c.inventory['food:1']??0),0)).toBeCloseTo(2);
  expect(Object.values(restored.citizens).reduce((n,c)=>n+c.gold,0)+Object.values(restored.orders).reduce((n,o)=>n+o.escrowGold,0)).toBeCloseTo(200);
});
it('accounts for recoverable own asks and never treats own bids as producer demand', () => {
  const {w,buyer}=fixture(); buyer.fullness=100; buyer.inventory={'food:1':1.8};
  dispatch(w,buyer.id,{type:'order',side:'buy',item:'food:1',quantity:1,price:20},'external',undefined,null);
  expect(prepareTreeCandidates(observe(w,buyer.id)).some(c=>c.task.definitionId==='Harvest' && c.task.request.resource==='food')).toBe(false);
  const bid=Object.values(w.orders)[0]; dispatch(w,buyer.id,{type:'cancel-order',orderId:bid.id});
  dispatch(w,buyer.id,{type:'order',side:'sell',item:'food:1',quantity:1.8,price:100});
  w.tick=20; advanceTree(w,buyer);
  expect(Object.values(w.orders).some(o=>o.citizenId===buyer.id && o.side==='buy')).toBe(false);
});
it('does not invent supply, treats own bids as non-demand, and releases all escrow on cancellation', () => {
  const {w,buyer,producer}=fixture(); w.deposits={}; producer.inventory={};
  buyer.x=15; buyer.y=15; buyer.knowledge={}; producer.knowledge={};
  for(let i=0;i<80;i++) tickWorld(w);
  expect(w.events.some(e=>e.kind==='trade')).toBe(false);
  expect(Object.values(w.citizens).every(c=>(c.inventory['food:1']??0)===0)).toBe(true);
  const own = Object.values(w.orders).filter(o=>o.citizenId===buyer.id && o.side==='buy');
  expect(own.length).toBeLessThanOrEqual(1);
  const before=buyer.gold+own.reduce((n,o)=>n+o.escrowGold,0);
  for(const order of own) expect(dispatch(w,buyer.id,{type:'cancel-order',orderId:order.id}).ok).toBe(true);
  expect(buyer.gold).toBeCloseTo(before);
});
it('closes the buyer-producer loop without seeded orders or gifts', () => {
  const {w,buyer,producer} = fixture();
  // Only producer knows the deposit: buyer must work/explore while demand rests.
  buyer.x=15;buyer.y=15;buyer.knowledge={};updateKnowledge(w);
  const gold = buyer.gold + producer.gold;
  let harvested=false, traded=false, eaten=false;
  for(let i=0;i<500;i++) {
    tickWorld(w);
    harvested ||= w.events.some(e=>e.kind==='completion' && e.text==='Completed harvest.' && e.citizenId===producer.id);
    traded ||= w.events.some(e=>e.kind==='trade' && e.trade?.buyerId===buyer.id && e.trade?.sellerId===producer.id);
    eaten ||= w.events.some(e=>e.kind==='meal' && e.citizenId===buyer.id);
  }
  expect(harvested).toBe(true); expect(traded).toBe(true);expect(eaten).toBe(true);
  expect(Object.values(w.citizens).reduce((n,c)=>n+c.gold,0)+Object.values(w.orders).reduce((n,o)=>n+o.escrowGold,0)).toBeCloseTo(gold);
});
