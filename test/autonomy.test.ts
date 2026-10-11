import { describe, expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { enableAutonomy, foodRunway, setAutonomyPolicy } from '../src/world/autonomy.ts';
import { updateKnowledge, observe } from '../src/world/observation.ts';
import { claimTerritory, deliverSignal, relationship } from '../src/world/society.ts';
import { findPath } from '../src/world/pathfinding.ts';
import type { World } from '../src/shared/types.ts';
import type { CitizenTraits } from '../src/shared/autonomy-types.ts';

function fixture() {
  const world=createWorld({seed:7,population:2});
  world.deposits={};
  const [a,b]=Object.values(world.citizens);
  for(const c of [a,b]) {c.x=4;c.y=4;c.inventory={'food:1':3};}
  b.x=5;
  return {world,a,b};
}
const run=(world:World,ticks:number)=>{updateKnowledge(world);for(let i=0;i<ticks;i++){tickWorld(world);updateKnowledge(world);}};
const gold=(world:World)=>Object.values(world.citizens).reduce((s,c)=>s+c.gold,0)+Object.values(world.orders).reduce((s,o)=>s+o.escrowGold,0)+Object.values(world.loot).reduce((s,l)=>s+l.gold,0);

describe('continuous local autonomy',()=> {
  it('buys actual affordable food while no model or physical directive exists',()=> {
    const {world,a,b}=fixture();
    a.fullness=3;a.inventory={};b.inventory={'food:2':8};
    enableAutonomy(world,a,{reproduction:'avoid',foodReserveTicks:500});
    expect(dispatch(world,b.id,{type:'order',side:'sell',item:'food:2',quantity:8,price:5}).ok).toBe(true);
    run(world,20);
    expect(foodRunway(a)).toBeGreaterThan(300);
    expect(a.health).toBe(100);
    expect(world.events.some((e)=>e.kind==='trade'&&e.citizenId===a.id)).toBe(true);
    expect(a.gold).toBeLessThan(100);
    expect(gold(world)).toBe(world.initialGold);
  });
  it('gathers bare-handed nearby food before starvation without buying unavailable goods',()=> {
    const {world,a}=fixture();a.fullness=1;a.inventory={};
    world.deposits.food={id:'food',x:4,y:5,resource:'food',tier:1,stock:2,capacity:2,regrowAt:0};
    enableAutonomy(world,a,{reproduction:'avoid'});
    run(world,60);
    expect(a.alive).toBe(true);
    // A forty-tick harvest can cost health when starting already starving,
    // but the controller completes the meal well before its death horizon.
    expect(a.health).toBeGreaterThan(90);
    expect(foodRunway(a)).toBeGreaterThan(80);
    expect(world.events.some((entry)=>entry.kind==='meal'&&entry.citizenId===a.id)).toBe(true);
    expect(world.deposits.food.stock).toBeLessThan(2);
  });
  it('lets policy no-go areas constrain transit as well as target selection',()=> {
    const {world,a}=fixture();
    enableAutonomy(world,a,{noGo:[[5,0,5,8]],reproduction:'avoid'});
    const path=findPath(world,a,{x:6,y:4})!;
    expect(path.length).toBeGreaterThan(2);
    expect(path.every((p)=>p.x!==5||p.y>8)).toBe(true);
    expect(path.every((p)=>Object.keys(p).sort().join() === 'x,y')).toBe(true);
    expect(findPath(world,a,{x:5,y:4})).toBe(null);
  });
  it('makes cooperative and assertive policies produce different access rules on identical geography',()=> {
    const first=fixture(),second=fixture();
    for(const f of [first,second]) {updateKnowledge(f.world);enableAutonomy(f.world,f.a,{livelihood:'food',reproduction:'avoid'});}
    expect(setAutonomyPolicy(first.world,first.a,{territory:[3,3,6,6],stance:'cooperative',accessPrice:0}).ok).toBe(true);
    expect(setAutonomyPolicy(second.world,second.a,{territory:[3,3,6,6],stance:'assertive',accessPrice:8}).ok).toBe(true);
    expect(Object.values(first.world.claims!)[0].stance).toBe('open');
    expect(Object.values(second.world.claims!)[0]).toMatchObject({stance:'toll',accessPrice:8});
    expect(observe(second.world,second.b.id).claims?.[0].areas).toEqual([3,3,6,6]);
    expect(setAutonomyPolicy(first.world,first.a,{territory:[0,0,100,100]}).ok).toBe(false);
    expect(first.a.autonomy!.policy.territory).toEqual([3,3,6,6]);
  });
  it('does not create family consent offers even when a legacy policy seeks parenthood',()=> {
    const {world,a,b}=fixture();
    a.inventory=b.inventory={'food:2':8};
    enableAutonomy(world,a,{reproduction:'seek',partnerId:b.id});
    enableAutonomy(world,b,{reproduction:'avoid'});
    run(world,150);
    expect(b.consent[a.id]).toBeUndefined();
    expect(Object.values(world.citizens).length).toBe(2);
    expect(b.autonomy!.signals?.some((s)=>s.kind==='family-offer'&&s.from===a.id)).toBe(false);
  });
  it('reproduces with an adjacent eligible partner without consent, preserving gold and inherited traits',()=> {
    const {world,a,b}=fixture();
    b.x=a.x; b.y=a.y;
    a.inventory={'food:1':9};b.inventory={'food:1':9};
    enableAutonomy(world,a,{reproduction:'seek',partnerId:b.id});
    enableAutonomy(world,b,{reproduction:'open',partnerId:a.id});
    relationship(a,b.id).trust=30;relationship(b,a.id).trust=30;
    run(world,100);
    const child=Object.values(world.citizens).find((c)=>c.parents.length===2);
    expect(child).toBeDefined();
    expect(child!.parents).toEqual([a.id,b.id]); expect(child!.gold).toBe(0);
    for(const [key,value] of Object.entries(child!.autonomy!.traits)) {
      const average=(a.autonomy!.traits[key as keyof CitizenTraits]+b.autonomy!.traits[key as keyof CitizenTraits])/2;
      expect(Math.abs(value-average)).toBeLessThanOrEqual(.100001);
    }
    expect(a.consent[b.id]).toBeUndefined();expect(b.consent[a.id]).toBeUndefined();
    expect(gold(world)).toBe(world.initialGold);
  });
  it('does not turn one alliance proposal into another citizen accepting it',()=> {
    const {world,a,b}=fixture();
    enableAutonomy(world,a,{allies:[b.id],reproduction:'avoid'});
    enableAutonomy(world,b,{rivals:[a.id],reproduction:'avoid'});
    deliverSignal(world,a,b,{kind:'alliance-offer'});
    run(world,100);
    expect(Object.keys(world.alliances??{})).toHaveLength(0);
    expect(b.autonomy!.policy.rivals).toEqual([a.id]);
  });
  it('does not learn another citizen harvested a remote claim',()=> {
    const {world,a,b}=fixture();
    a.x=1;a.y=1;b.x=12;b.y=12;
    world.deposits.food={id:'food',x:12,y:12,resource:'food',tier:1,stock:2,capacity:2,regrowAt:0};
    enableAutonomy(world,a,{livelihood:'food',reproduction:'avoid'});
    claimTerritory(world,a,[10,10,14,14]);
    expect(dispatch(world,b.id,{type:'harvest',depositId:'food'}).ok).toBe(true);
    run(world,12);
    expect(a.autonomy!.evidence.some((e)=>e.kind==='trespass'&&e.otherId===b.id)).toBe(false);
    expect(a.autonomy!.relationships[b.id]?.grievance??0).toBe(0);
  });
  it('returns gifts atomically from unreserved adjacent inventory including tools',()=> {
    const {world,a,b}=fixture();
    expect(dispatch(world,a.id,{type:'give',citizenId:b.id,item:'food:1',quantity:2}).ok).toBe(true);
    expect(a.inventory['food:1']).toBe(1);expect(b.inventory['food:1']).toBe(5);
    expect(dispatch(world,a.id,{type:'give',citizenId:b.id,item:'food:1',quantity:2}).ok).toBe(false);
    a.inventory['knife:1']=1;
    expect(dispatch(world,a.id,{type:'give',citizenId:b.id,item:'knife:1',quantity:1}).ok).toBe(true);
    expect(a.inventory['knife:1']).toBeUndefined();expect(b.inventory['knife:1']).toBe(1);
    b.x=12;expect(dispatch(world,a.id,{type:'give',citizenId:b.id,item:'food:1',quantity:1}).code).toBe('not-adjacent');
  });
  it('keeps autonomous continuation deterministic across JSON checkpoints',()=> {
    const world=createWorld({seed:19,autonomy:true});run(world,300);
    const restored:World=JSON.parse(JSON.stringify(world));
    run(world,200);run(restored,200);
    expect(restored).toEqual(world);
    expect(gold(world)).toBe(world.initialGold);
  });
});
