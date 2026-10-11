import { expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import { harvestCost } from '../src/citizen/tree-harvest.ts';
import { stepTreeTask } from '../src/citizen/tree-actions.ts';
import type { TreeTaskState } from '../src/shared/tree-types.ts';

it('compares current public harvest estimates against own tools, ignoring stale locks', () => {
  const w = createWorld({ population: 2, autonomy: false }); const [a,b] = Object.values(w.citizens);
  a!.x = b!.x = 4; a!.y = b!.y = 4; b!.inventory = {};
  const d = { id:'test',x:4,y:4,resource:'wood' as const,tier:1,stock:1,capacity:1,regrowAt:0 };
  w.deposits = { test:d }; updateKnowledge(w);
  expect(dispatch(w,b!.id,{type:'harvest',depositId:d.id}).ok).toBe(true);
  tickWorld(w,1,{ authority:{ citizens:{[a!.id]:'direct',[b!.id]:'direct'},newbornAuthority:'passive-body' } }); updateKnowledge(w);
  const o = observe(w,a!.id);
  expect(o.visible.flatMap(t=>t.citizens).find(c=>c.id===b!.id)?.publicWork).toBeDefined();
  expect(harvestCost(o,d,d,0)).toBe(Infinity);
  expect(harvestCost(o,d,d,3)).toBeLessThan(Infinity);
  for(const tile of o.visible) tile.seenTick--;
  expect(harvestCost(o,d,d,0)).toBeLessThan(Infinity);
});
it('lets a travelling fast-tool competitor finish first and the slow loser select another deposit', () => {
  const w = createWorld({ population: 2, autonomy: false }); w.controllerMode = 'composed';
  const [a,b] = Object.values(w.citizens); a!.x=4; a!.y=4; a!.inventory={}; b!.x=5; b!.y=4; b!.inventory={'axe:3':1};
  w.deposits={ contested:{id:'contested',x:4,y:4,resource:'wood',tier:1,stock:1,capacity:1,regrowAt:0}, other:{id:'other',x:4,y:6,resource:'wood',tier:1,stock:1,capacity:1,regrowAt:0} };
  updateKnowledge(w);
  const s:TreeTaskState={id:'h',definitionId:'Harvest',ancestry:[],phase:'work:1',strategyId:'harvest',targetId:'contested',target:{x:4,y:4},actionId:'pending:'+JSON.stringify({type:'harvest',depositId:'contested'}),status:'running',startedTick:0,lastProgressTick:0,delivered:0,receiptIds:[],ownedOrderIds:[],request:{id:'r',resource:'wood',tier:1,quantity:1,allowMarket:false,purpose:'work',urgency:'routine'}};
  expect(dispatch(w,a!.id,{type:'harvest',depositId:'contested'}).ok).toBe(true);
  expect(dispatch(w,b!.id,{type:'harvest',depositId:'contested'}).ok).toBe(true);
  expect(b!.action?.phase).toBe('travel');
  for(let i=0;i<60 && a!.action;i++) { tickWorld(w,1,{authority:{citizens:{[a!.id]:'direct',[b!.id]:'direct'},newbornAuthority:'passive-body'}}); updateKnowledge(w); }
  expect(b!.inventory['wood:1']).toBe(1); expect(a!.inventory['wood:1']??0).toBe(0);
  const result=stepTreeTask(observe(w,a!.id),s);
  expect(result.status).toBe('running'); expect(s.delivered).toBe(0); expect(s.targetId).toBe('other');
});

it('retains a multi-step frontier target through real movement and gains knowledge', () => {
  const w=createWorld({population:1,autonomy:false}); const a=Object.values(w.citizens)[0]!;
  a.x=4;a.y=4;a.knowledge={};updateKnowledge(w);
  const before=Object.keys(a.knowledge).length;
  const s:TreeTaskState={id:'e',definitionId:'Explore',ancestry:[],phase:'',status:'running',startedTick:w.tick,lastProgressTick:w.tick,delivered:0,receiptIds:[],ownedOrderIds:[],request:{id:'r',resource:'food',tier:1,quantity:1,allowMarket:false,purpose:'find land',urgency:'routine'}};
  let target:typeof s.target;
  for(let i=0;i<100 && s.status==='running';i++){
    const result=stepTreeTask(observe(w,a.id),s);
    target ??= structuredClone(s.target);
    expect(s.target).toEqual(target);
    if(result.command) expect(dispatch(w,a.id,result.command).ok).toBe(true);
    tickWorld(w,1,{authority:{citizens:{[a.id]:'direct'},newbornAuthority:'passive-body'}});updateKnowledge(w);
  }
  expect(s.status).toBe('succeeded');expect(Object.keys(a.knowledge).length).toBeGreaterThan(before);
  expect(Math.abs(target!.x-4)+Math.abs(target!.y-4)).toBeGreaterThan(1);
});
