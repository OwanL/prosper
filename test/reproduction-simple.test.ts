import { describe, it, expect } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { validateCheckpoint, type Checkpoint } from '../src/server/checkpoint.ts';

function fixture() {
  const world = createWorld({ seed: 2 });
  world.buildings = {}; world.deposits = {};
  const [a,b] = Object.values(world.citizens);
  for (const c of [a,b]) { c.x=1;c.y=1;c.health=100;c.fullness=100;c.inventory={'food:1':1};c.consent={}; }
  return {world,a,b};
}
function restore(world: ReturnType<typeof createWorld>) {
  const cp: Checkpoint={version:1,savedAt:new Date().toISOString(),world,runtime:{running:false,speed:1,mode:'scripted',commandSequence:0,recorded:[]}};
  return validateCheckpoint(JSON.parse(JSON.stringify(cp))).world;
}
describe('simple reproduction commitments',()=>{
  it('needs no consent and consumes one T1 each for exactly one birth',()=>{
    const {world,a,b}=fixture();
    expect(dispatch(world,a.id,{type:'reproduce',partnerId:b.id}).ok).toBe(true);
    expect(a.action?.reserved).toEqual({'food:1':1});expect(b.action?.reserved).toEqual({'food:1':1});
    tickWorld(world,24);expect(world.events.filter(e=>e.kind==='birth')).toHaveLength(1);
    tickWorld(world,24);expect(world.events.filter(e=>e.kind==='birth')).toHaveLength(1);
  });
  it.each(['dead','busy','distant','foodshort'] as const)('rejects %s partner',kind=>{
    const {world,a,b}=fixture();
    if(kind==='dead')b.alive=false;
    if(kind==='distant')b.x=5;
    if(kind==='foodshort')b.inventory={};
    if(kind==='busy')dispatch(world,b.id,{type:'move',x:5,y:1});
    expect(dispatch(world,a.id,{type:'reproduce',partnerId:b.id}).ok).toBe(false);
    expect(a.inventory['food:1']).toBe(1);
  });
  it('refunds both parents on cancellation',()=>{
    const {world,a,b}=fixture();dispatch(world,a.id,{type:'reproduce',partnerId:b.id});
    dispatch(world,a.id,{type:'cancel'});
    expect(a.inventory['food:1']).toBe(1);expect(b.inventory['food:1']).toBe(1);expect(b.action).toBeNull();
  });
  it.each(['complete','cancel'] as const)('preserves old 3 T2 commitments on restore: %s',mode=>{
    const {world,a,b}=fixture();dispatch(world,a.id,{type:'reproduce',partnerId:b.id});
    a.action!.reserved={'food:2':3};b.action!.reserved={'food:2':3};
    const restored=restore(world);
    if(mode==='cancel') {dispatch(restored,a.id,{type:'cancel'});expect(restored.citizens[a.id].inventory['food:2']).toBe(3);expect(restored.citizens[b.id].inventory['food:2']).toBe(3);}
    else {tickWorld(restored,48);expect(restored.events.filter(e=>e.kind==='birth')).toHaveLength(1);}
  });
  it('accepts retained legacy consent requests and records without using them',()=>{
    const {world,a,b}=fixture();a.consent[b.id]=123;
    a.queue=[{type:'consent',partnerId:b.id,accept:true}];
    const restored=restore(world);expect(restored.citizens[a.id].consent[b.id]).toBe(123);
    expect(dispatch(restored,a.id,{type:'reproduce',partnerId:b.id}).ok).toBe(true);
  });
  it('restores a historical consent command in composed decision trace without making it a prerequisite',()=>{
    const world=createWorld({seed:7,population:2,controllerMode:'composed',autonomy:false});
    const [a,b]=Object.values(world.citizens);
    a.mind!.trace.push({tick:0,invocationId:'legacy-family',definitionId:'Reproduce',transition:'propose',reason:'Historical consent',command:{type:'consent',partnerId:b.id,accept:true}});
    a.consent[b.id]=100;
    const restored=restore(world);
    expect(restored.citizens[a.id].mind!.trace.at(-1)?.command).toEqual({type:'consent',partnerId:b.id,accept:true});
    expect(restored.citizens[a.id].consent[b.id]).toBe(100);
  });
  it('attempts reproduction naturally in a fresh twenty-citizen world without consent',()=>{
    const world=createWorld({seed:7,population:20,controllerMode:'composed'});
    let attempted=false,consented=false;
    for(let i=0;i<1200;i++) {
      tickWorld(world);
      for(const c of Object.values(world.citizens)) for(const e of c.mind?.trace??[]) {
        attempted ||= e.command?.type==='reproduce'; consented ||= e.command?.type==='consent';
      }
      if(attempted)break;
    }
    expect(attempted).toBe(true);expect(consented).toBe(false);
  });
  it('rejects free or mismatched persisted reservations',()=>{
    const {world,a,b}=fixture();dispatch(world,a.id,{type:'reproduce',partnerId:b.id});
    a.action!.reserved={'food:2':3};expect(()=>restore(world)).toThrow('joint reproduction identity/progress');
    a.action!.reserved={};b.action!.reserved={};expect(()=>restore(world)).toThrow();
  });
});
