import { describe, expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { BALANCE } from '../src/world/config.ts';
import { enableAutonomy, productionSaturated, setAutonomyPolicy } from '../src/world/autonomy.ts';
import { updateKnowledge } from '../src/world/observation.ts';
import { allied, deliverSignal, formAlliance } from '../src/world/society.ts';
import type { World } from '../src/shared/types.ts';
import { event } from '../src/shared/utils.ts';

const run=(world:World,ticks:number)=>{updateKnowledge(world);for(let i=0;i<ticks;i++){tickWorld(world);updateKnowledge(world);}};
function fixture(population=2) {
  const world=createWorld({seed:7,population});world.width=7;world.height=7;world.deposits={};
  const citizens=Object.values(world.citizens);
  citizens.forEach((c,i)=>{c.x=3+i;c.y=3;c.inventory={'food:2':20};});
  // Exhausted, actually explored local terrain: no fictitious food target.
  for(const citizen of citizens)for(let x=0;x<7;x++)for(let y=0;y<7;y++)citizen.knowledge[`${x},${y}`]={x,y,seenTick:0,citizens:[],deposits:[],buildings:[],loot:[]};
  return {world,citizens};
}

describe('costly local social consequences',()=> {
  it('lets a new rival policy renounce only the actor from a pact and prevents immediate indirect rejoin',()=> {
    const {world,citizens:[a,b,c]}=fixture(3);
    enableAutonomy(world,a,{reproduction:'avoid',allies:[b.id,c.id]});
    enableAutonomy(world,b,{reproduction:'avoid',allies:[a.id]});
    formAlliance(world,a,b);formAlliance(world,a,c);
    deliverSignal(world,a,b,{kind:'alliance-offer'});
    expect(allied(world,a,b.id)).toBe(true);
    updateKnowledge(world);
    expect(setAutonomyPolicy(world,a,{rivals:[b.id]}).ok).toBe(true);
    expect(allied(world,a,b.id)).toBe(false);expect(allied(world,b,c.id)).toBe(true);
    expect(b.autonomy!.signals?.some((signal)=>signal.kind==='alliance-offer'&&signal.from===a.id)).toBe(false);
    formAlliance(world,a,c);
    expect(allied(world,a,c.id)).toBe(false);
    expect(a.autonomy!.policy.allies).toEqual([b.id,c.id]);
    expect(world.events.some((entry)=>entry.kind==='alliance'&&entry.text.includes('renounces'))).toBe(true);
    world.tick=600;formAlliance(world,a,c);
    expect(allied(world,a,c.id)).toBe(false);
    expect(setAutonomyPolicy(world,a,{rivals:[]}).ok).toBe(true);
    formAlliance(world,a,c);expect(allied(world,a,c.id)).toBe(true);
  });
  it('retains actual newborn provisioning evidence after mundane event-ring churn',()=> {
    const {world,citizens:[a,b]}=fixture();
    b.parents=[a.id];b.inventory={};b.fullness=60;
    a.inventory={'food:3':5};
    enableAutonomy(world,a,{reproduction:'avoid'});a.autonomy!.nextSocialTick=0;
    event(world,'birth',`${b.id} born to ${a.id}.`,{citizenId:b.id,audience:[a.id,b.id]});
    for(let i=0;i<600;i++)event(world,'completion','Ordinary work completed.',{citizenId:a.id,audience:[a.id]});
    expect(world.events.some((entry)=>entry.kind==='birth')).toBe(false);
    run(world,4);
    expect(b.inventory['food:3']).toBe(1);
    expect(world.events.some((entry)=>entry.kind==='help'&&entry.citizenId===a.id&&entry.targetId===b.id)).toBe(true);
  });
  it('pauses saturated production using own escrow and funded public demand, not private peer stock',()=> {
    const {world,citizens:[a,b]}=fixture();
    a.inventory={'food:3':8};a.fullness=100;a.inventory['knife:2']=1;
    enableAutonomy(world,a,{reproduction:'open',livelihood:'food',targetTier:3});
    expect(dispatch(world,a.id,{type:'order',side:'sell',item:'food:3',quantity:6,price:16}).ok).toBe(true);
    expect(productionSaturated(world,a)).toBe(true);
    b.inventory['food:3']=1000;
    expect(productionSaturated(world,a)).toBe(true);
    run(world,4);
    expect(a.autonomy!.intent).toContain('Unsold food surplus');
    expect(a.autonomy!.idleReason).toBe('surplus');
    run(world,3);expect(a.autonomy!.idleReason).toBe('surplus');
    expect(a.autonomy!.evidence.some((entry)=>entry.text.startsWith('Production saturated:'))).toBe(true);
    expect(dispatch(world,b.id,{type:'order',side:'buy',item:'food:3',quantity:8,price:1}).ok).toBe(true);
    expect(productionSaturated(world,a)).toBe(false);
    run(world,24);expect(a.autonomy!.idleReason).toBeUndefined();
    a.autonomy!.idleReason='surplus';
    expect(setAutonomyPolicy(world,a,{sellPrice:5}).ok).toBe(true);
    expect(a.autonomy!.idleReason).toBeUndefined();
  });
  it('begs before a desperate robbery of an observed unaffordable food seller',()=> {
    const {world,citizens:[a,b]}=fixture();
    a.inventory={'sword:1':1};a.fullness=0;a.gold=0;
    enableAutonomy(world,a,{reproduction:'avoid',aggression:1,caution:0});
    expect(dispatch(world,b.id,{type:'order',side:'sell',item:'food:2',quantity:10,price:50}).ok).toBe(true);
    run(world,300);
    const plea=world.messages.find((m)=>m.from===a.id&&m.text.includes('I am starving'));
    const strike=world.events.find((e)=>e.kind==='attack'&&e.citizenId===a.id);
    expect(plea).toBeDefined();expect(strike).toBeDefined();
    expect(a.nextReviewTick).toBeLessThanOrEqual(plea!.tick+1);
    expect(strike!.tick-plea!.tick).toBeGreaterThanOrEqual(80);
    expect(a.autonomy!.evidence.some((e)=>e.text.includes('Starving after unanswered plea'))).toBe(true);
    expect(b.alive).toBe(false);expect(a.alive).toBe(true);
    expect(Object.values(world.loot)).toHaveLength(0);
  });
  it('uses actual allied defense to intervene against an observed attack',()=> {
    const {world,citizens:[a,b,c]}=fixture(3);
    a.inventory['sword:2']=1;
    enableAutonomy(world,a,{reproduction:'avoid',aggression:1,caution:0,targetTier:1});
    a.autonomy!.nextSocialTick=0;
    formAlliance(world,a,b);
    expect(dispatch(world,c.id,{type:'attack',targetId:b.id}).ok).toBe(true);
    run(world,8);
    expect(a.action?.command).toEqual(expect.objectContaining({type:'attack',targetId:c.id}));
    expect(a.autonomy!.evidence.some((e)=>e.text.includes('Intervened'))).toBe(true);
  });
});
