import { describe, expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';
import { advanceTree, prepareTreeCandidates } from '../src/world/tree-controller.ts';
import { carriedSurplus, committedReserves, observedDemand } from '../src/citizen/tree-surplus.ts';
import type { TreeTaskState } from '../src/shared/tree-types.ts';

function fixture() {
  const world = createWorld({ seed: 7, population: 2, autonomy: false });
  const citizen = Object.values(world.citizens)[0]!;
  citizen.inventory = { 'fibre:1': 57.5, 'wood:1': 4, 'food:1': 4 };
  updateKnowledge(world);
  return { world, citizen, o: observe(world, citizen.id) };
}
const task = (id: string): TreeTaskState => ({ id, definitionId: 'ObtainResource', request: { id, resource: 'fibre', tier: 1, quantity: 1, purpose: 'Materials for axe T1', urgency: 'routine', allowMarket: true }, phase: 'start', status: 'running', ancestry: [], startedTick: 0, lastProgressTick: 0, delivered: 10, receiptIds: [], ownedOrderIds: [] });
describe('observation-only short term surplus', () => {
  it('keeps the construction parent after one child and releases stock only after confirmed build', () => {
    const world = createWorld({seed:7,population:1,controllerMode:'composed',autonomy:false});
    const a = Object.values(world.citizens)[0]!;
    a.inventory = {'wood:1':5,'fibre:1':3,'food:1':10}; a.fullness=100;
    world.deposits = {
      wood:{id:'wood',resource:'wood',tier:1,x:a.x+1,y:a.y,stock:4,capacity:4,regrowAt:0},
      fibre:{id:'fibre',resource:'fibre',tier:1,x:a.x+2,y:a.y,stock:4,capacity:4,regrowAt:0},
    };
    const parent = {...task('build'),delivered:0,definitionId:'BuildResourceBuilding',request:{...task('build').request,resource:'wood' as const,purpose:'Build own station'}};
    a.mind!.tasks.push(parent); a.mind!.activeTaskId=parent.id;
    updateKnowledge(world);
    expect(committedReserves(observe(world,a.id))['wood:1']).toBe(6);
    advanceTree(world,a);
    for(let i=0;i<150 && !a.mind!.tasks.some(t=>t.parentId===parent.id && t.status==='succeeded');i++) { tickWorld(world); updateKnowledge(world); }
    expect(a.mind!.tasks.some(t=>t.parentId===parent.id && t.status==='succeeded'), JSON.stringify(a.mind!.tasks)).toBe(true);
    expect(parent.status).toBe('running');
    expect(committedReserves(observe(world,a.id))['wood:1']).toBe(6);
    for(let i=0;i<250 && parent.status==='running';i++) { advanceTree(world,a); tickWorld(world); updateKnowledge(world); }
    expect(parent.status).toBe('succeeded');
    expect(a.mind!.tasks.filter(t=>t.parentId===parent.id && t.status==='succeeded')).toHaveLength(2);
    a.inventory['wood:1']=2;
    expect(carriedSurplus(observe(world,a.id),'wood:1')).toBe(2);
  });
  it('automatically posts substantial fibre surplus despite high independence', () => {
    const world = createWorld({seed: 7, population: 1, controllerMode: 'composed', autonomy: false});
    const a = Object.values(world.citizens)[0]!;
    a.inventory = {'fibre:1':57, 'food:1':8}; a.fullness=100;
    a.mind!.dispositions.economicIndependence=1;
    for (let i=0;i<150 && !Object.values(world.orders).some(x=>x.citizenId===a.id && x.side==='sell' && x.item==='fibre:1' && x.quantity>20);i++) tickWorld(world,1);
    expect(Object.values(world.orders).some(x=>x.citizenId===a.id && x.side==='sell' && x.item==='fibre:1' && x.quantity>20)).toBe(true);
  });
  it('quotes fractional surplus without withholding hypothetical construction inputs', () => {
    const { world, citizen, o } = fixture();
    const sale = prepareTreeCandidates(o).find(c => c.task.definitionId === 'SellItem' && c.task.targetId === 'fibre:1')!;
    expect(sale.task.request.quantity).toBe(57.5);
    const gold = Object.values(world.citizens).reduce((n,c) => n+c.gold,0);
    expect(dispatch(world, citizen.id, { type:'order', side:'sell', item:'fibre:1', quantity:sale.task.request.quantity, price:2 }).ok).toBe(true);
    tickWorld(world, 1); updateKnowledge(world);
    expect(citizen.inventory['fibre:1'] ?? 0).toBe(0);
    expect(Object.values(world.citizens).reduce((n,c)=>n+c.gold,0)).toBe(gold);
    expect(observedDemand(observe(world,citizen.id),'fibre:1')).toBe(0);
  });
  it('reserves the selected parent recipe once, not historical delivery', () => {
    const { o } = fixture();
    const parent = task('parent');
    const child = { ...task('child'), parentId:'parent' };
    const one = committedReserves(o,parent);
    // Extra task is intentionally duplicated; max recipe commitments do not multiply.
    expect(committedReserves(o,child)).toEqual(one);
    expect(carriedSurplus(o,'fibre:1',parent)).toBe(57.5-(one['fibre:1'] ?? 0));
    parent.status='succeeded';
    expect(carriedSurplus(o,'fibre:1',parent)).toBe(57.5);
  });
  it('does not produce already listed stock without observed demand', () => {
    const { world, citizen } = fixture();
    dispatch(world, citizen.id, {type:'order', side:'sell', item:'fibre:1', quantity:50, price:2});
    updateKnowledge(world);
    const o = observe(world,citizen.id);
    expect(observedDemand(o,'fibre:1')).toBe(0);
    expect(prepareTreeCandidates(o).some(c => c.task.definitionId === 'Harvest' && c.task.request.resource === 'fibre')).toBe(false);
    const buyer = Object.values(world.citizens).find(c=>c.id!==citizen.id)!;
    // The utility uses only a projected funded bid, not private buyer wealth.
    o.markets.push({...o.markets[0]!,id:'observed-bid',citizenId:buyer.id,side:'buy',item:'fibre:1',quantity:100,price:1,escrowGold:100,escrowItems:{}});
    expect(observedDemand(o,'fibre:1')).toBe(50);
  });
  it('protects committed family food but releases unrelated inputs in an emergency', () => {
    const {o}=fixture();
    const family={...task('family'),definitionId:'Reproduce',request:{...task('family').request,resource:'food' as const,purpose:'family intention'}};
    expect(committedReserves(o,family)['food:1']).toBeGreaterThanOrEqual(1);
    expect(committedReserves(o,family)['food:2']).toBeUndefined();
    const material=task('materials'); material.request.purpose='Materials for knife T1';
    expect(committedReserves(o,material)['wood:1']).toBeGreaterThan(0);
    expect(committedReserves(o,material,true)['wood:1'] ?? 0).toBe(0);
  });
  it('keeps a nutrition runway without reserving every food tier', () => {
    const { o } = fixture();
    o.citizen.fullness=0;
    expect(committedReserves(o)['food:1']).toBeGreaterThan(0);
    expect(carriedSurplus(o,'food:1')).toBeLessThan(4);
  });
});
