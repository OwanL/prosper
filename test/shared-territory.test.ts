import { describe, expect, it } from 'vitest';
import { cancelAction, createWorld, dispatch } from '../src/world/core.ts';
import { advanceAutonomy, enableAutonomy, setAutonomyPolicy } from '../src/world/autonomy.ts';
import { claimTerritory, formAlliance, maintainSociety, sharedClaim, witnessHarvest } from '../src/world/society.ts';
import { gatherCommand } from '../src/world/production.ts';
import { updateKnowledge } from '../src/world/observation.ts';
import { claimSchema } from '../src/server/autonomy-checkpoint.ts';
import { validateCheckpoint } from '../src/server/checkpoint.ts';

function turn(world: ReturnType<typeof createWorld>, citizen: ReturnType<typeof fixture>['a']) {
  citizen.autonomy!.nextSocialTick=0;citizen.autonomy!.nextThinkTick=world.tick;citizen.autonomy!.nextMarketTick=world.tick+1000;
  advanceAutonomy(world,citizen,{command:(command)=>dispatch(world,citizen.id,command),cancel:()=>cancelAction(world,citizen.id)});
}
function tollFixture(payMember=false) {
  const setup=fixture();const {world,a,b,c}=setup;world.tick=100;c.x=5;
  a.autonomy!.policy.accessPrice=8;c.autonomy!.policy.caution=1;c.autonomy!.claimSuppressed=true;
  world.deposits.wood={id:'wood',x:5,y:4,resource:'wood',tier:2,stock:1,capacity:1,regrowAt:0};
  const claim=claimTerritory(world,a,[5,4,5,4]);formAlliance(world,a,b);updateKnowledge(world);
  expect(dispatch(world,c.id,{type:'harvest',depositId:'wood'}).ok).toBe(true);
  turn(world,payMember?b:a);cancelAction(world,c.id);
  return {...setup,claim};
}

function fixture() {
  const world=createWorld({seed:7,population:3});world.deposits={};
  const [a,b,c]=Object.values(world.citizens);
  // Carried axes automatically support territorial livelihood work.
  for(const citizen of [a,b,c]) {citizen.x=4;citizen.y=4;citizen.inventory={'food:2':12,'axe:1':1};enableAutonomy(world,citizen,{livelihood:'wood',reproduction:'avoid',stance:'assertive',aggression:1,caution:0});}
  return {world,a,b,c};
}
describe('one public alliance territory',()=>{
  it('consolidates without a union and prevents duplicate allied claims',()=>{
    const {world,a,b}=fixture();const first=claimTerritory(world,a,[4,4,4,4]);claimTerritory(world,b,[9,9,10,10]);
    formAlliance(world,a,b);
    expect(Object.values(world.claims!)).toEqual([first]);
    expect(claimTerritory(world,b,[1,1,2,2])).toBe(first);
    expect(sharedClaim(world,b)?.areas).toEqual([4,4,4,4]);
  });
  it('transfers representative on death and on explicit rival withdrawal',()=>{
    const {world,a,b,c}=fixture();const claim=claimTerritory(world,a,[4,4,4,4]);formAlliance(world,a,b);formAlliance(world,b,c);
    a.alive=false;maintainSociety(world);expect(claim.ownerId).toBe(b.id);
    setAutonomyPolicy(world,b,{rivals:[c.id]});expect(claim.ownerId).toBe(c.id);
    expect(sharedClaim(world,b)).toBeUndefined();expect(Object.keys(world.claims!)).toHaveLength(1);
  });
  it('preserves null/suppressed intent while allowing an ally to retain the grounds',()=>{
    const {world,a,b}=fixture();const claim=claimTerritory(world,a,[4,4,4,4]);formAlliance(world,a,b);
    setAutonomyPolicy(world,a,{territory:null});expect(claim.ownerId).toBe(b.id);expect(a.autonomy!.claimSuppressed).toBe(true);
  });
  it('prefers shared resources and records ally territorial defense without private knowledge',()=>{
    const {world,a,b,c}=fixture();a.x=5;b.x=4;c.x=5;
    const shared={id:'shared',x:5,y:4,resource:'wood' as const,tier:2 as const,stock:1,capacity:1,regrowAt:0};
    world.deposits={shared,near:{...shared,id:'near',x:4,y:4}};claimTerritory(world,a,[5,4,5,4]);formAlliance(world,a,b);
    updateKnowledge(world);expect(gatherCommand(world,b,'wood',2)).toEqual({type:'harvest',depositId:'shared'});
    witnessHarvest(world,c,shared);expect(b.autonomy!.relationships[c.id].trespasses).toBe(1);
    witnessHarvest(world,a,shared);expect(b.autonomy!.relationships[a.id].trespasses).toBe(0);
    expect(b.autonomy!.policy.territory).toBeUndefined();
  });
  it('allies with another livelihood enforce the shared resource claim after a warning',()=>{
    const {world,a,b,c}=fixture();world.tick=100;c.x=5;
    world.deposits.wood={id:'wood',x:5,y:4,resource:'wood',tier:2,stock:1,capacity:1,regrowAt:0};
    claimTerritory(world,a,[5,4,5,4]);formAlliance(world,a,b);b.autonomy!.policy.livelihood='food';
    updateKnowledge(world);expect(dispatch(world,c.id,{type:'harvest',depositId:'wood'}).ok).toBe(true);
    b.autonomy!.nextSocialTick=0;b.autonomy!.nextThinkTick=100;b.autonomy!.nextMarketTick=1000;
    b.autonomy!.relationships[c.id]={trust:0,grievance:30,respect:0,trades:0,trespasses:2,harm:0,lastTick:100};
    b.autonomy!.threatened[c.id]={tick:0,reason:'territorial trespass',demand:0};
    advanceAutonomy(world,b,{command:(command)=>dispatch(world,b.id,command),cancel:()=>{}});
    expect(b.action?.command).toEqual({type:'attack',targetId:c.id});
  });
  it('payment to a member synchronously authorizes shared enforcement and completed harvests',()=>{
    const {world,a,b,c,claim}=tollFixture();
    const gold=c.gold;turn(world,c);
    expect(c.gold).toBe(gold-8);expect(claim.accessPermits?.[c.id]).toBe(700);
    // The ally has not received a private receipt or read either peer notebook.
    expect(b.autonomy!.permits[c.id]).toBeUndefined();
    cancelAction(world,c.id);expect(dispatch(world,c.id,{type:'harvest',depositId:'wood'}).ok).toBe(true);
    b.autonomy!.relationships[c.id]={trust:0,grievance:30,respect:0,trades:0,trespasses:2,harm:0,lastTick:100};
    b.autonomy!.threatened[c.id]={tick:0,reason:'territorial trespass',demand:8};
    turn(world,b);expect(b.action?.command.type).not.toBe('attack');
    expect(b.autonomy!.relationships[c.id].trespasses).toBe(2);
    witnessHarvest(world,c,world.deposits.wood);expect(b.autonomy!.relationships[c.id].trespasses).toBe(2);
    // Representative renewal and transfer keep the authorization on the claim.
    const renewed=claimTerritory(world,a,claim.areas);expect(renewed.accessPermits?.[c.id]).toBe(700);
    a.alive=false;maintainSociety(world);expect(renewed.ownerId).toBe(b.id);
    cancelAction(world,b.id);world.tick=700;maintainSociety(world);
    expect(renewed.accessPermits?.[c.id]).toBeUndefined();
    b.autonomy!.threatened[c.id].tick=600;
    turn(world,b);expect(b.action?.command).toEqual({type:'attack',targetId:c.id});
  });
  it('payment to a non-representative member protects the visitor from the representative immediately',()=>{
    const {world,a,b,c,claim}=tollFixture(true);const gold=b.gold;
    turn(world,c);expect(b.gold).toBe(gold+8);expect(claim.accessPermits?.[c.id]).toBe(700);
    expect(a.autonomy!.permits[c.id]).toBeUndefined();
    cancelAction(world,c.id);expect(dispatch(world,c.id,{type:'harvest',depositId:'wood'}).ok).toBe(true);
    a.autonomy!.relationships[c.id]={trust:0,grievance:30,respect:0,trades:0,trespasses:2,harm:0,lastTick:100};
    a.autonomy!.threatened[c.id]={tick:0,reason:'territorial trespass',demand:8};
    turn(world,a);expect(a.action?.command.type).not.toBe('attack');
    expect(a.autonomy!.relationships[c.id].trespasses).toBe(2);
    expect(b.autonomy!.signals?.some((signal)=>signal.kind==='access-grant')).toBe(true);
  });
  it('does not grant territorial access after a failed payment or a protection payment',()=>{
    const {world,a,b,c,claim}=tollFixture();
    c.autonomy!.nextSocialTick=0;c.autonomy!.nextThinkTick=100;c.autonomy!.nextMarketTick=1000;
    advanceAutonomy(world,c,{command:()=>({ok:false,code:'failed',message:'failed transfer'}),cancel:()=>{}});
    expect(claim.accessPermits?.[c.id]).toBeUndefined();
    c.autonomy!.signals=[{kind:'access-demand',from:a.id,tick:100,amount:8,reason:'protection demand'}];
    a.autonomy!.threatened[c.id]={tick:100,reason:'protection demand',demand:8};
    turn(world,c);expect(claim.accessPermits?.[c.id]).toBeUndefined();
    cancelAction(world,a.id);turn(world,a);expect(a.autonomy!.permits[c.id]).toBe(600);
    expect(b.autonomy!.permits[c.id]).toBeUndefined();
    witnessHarvest(world,c,world.deposits.wood);expect(b.autonomy!.relationships[c.id].trespasses).toBe(1);
    world.tick=140;cancelAction(world,a.id);turn(world,a);
    expect(a.autonomy!.permits[c.id]).toBe(600); // Receipt rereads cannot renew a personal permit.
  });
  it('open access and claim permits remove grievances and gathering penalties, including expiry',()=>{
    const {world,a,b,c}=fixture();c.autonomy!.policy.caution=1;c.autonomy!.policy.aggression=0;
    world.deposits={near:{id:'near',x:5,y:4,resource:'wood',tier:2,stock:1,capacity:1,regrowAt:0},far:{id:'far',x:4,y:6,resource:'wood',tier:2,stock:1,capacity:1,regrowAt:0}};
    const claim=claimTerritory(world,a,[5,4,5,4]);formAlliance(world,a,b);updateKnowledge(world);
    c.autonomy!.permits[a.id]=1000;b.autonomy!.permits[c.id]=1000;
    expect(gatherCommand(world,c,'wood',2)).toEqual({type:'harvest',depositId:'far'});c.autonomy!.visited={};
    claim.accessPermits={[c.id]:600};
    expect(gatherCommand(world,c,'wood',2)).toEqual({type:'harvest',depositId:'near'});c.autonomy!.visited={};
    witnessHarvest(world,c,world.deposits.near);expect(b.autonomy!.relationships[c.id]).toBeUndefined();
    world.tick=600;witnessHarvest(world,c,world.deposits.near);expect(b.autonomy!.relationships[c.id].trespasses).toBe(1);
    expect(gatherCommand(world,c,'wood',2)).toEqual({type:'harvest',depositId:'far'});c.autonomy!.visited={};
    claim.stance='open';witnessHarvest(world,c,world.deposits.near);expect(b.autonomy!.relationships[c.id].trespasses).toBe(1);
    expect(gatherCommand(world,c,'wood',2)).toEqual({type:'harvest',depositId:'near'});
  });
  it('checkpoint claim schema accepts old claims and persists only valid optional permits',()=>{
    const {world,a,c}=fixture();const claim=claimTerritory(world,a,[4,4,4,4]);
    const checkpoint={version:1,savedAt:new Date().toISOString(),world,runtime:{running:false,speed:1,mode:'scripted',commandSequence:0,recorded:[]}};
    const restore=()=>validateCheckpoint(JSON.parse(JSON.stringify(checkpoint))).world.claims![claim.id];
    expect(restore().accessPermits).toBeUndefined();
    claim.accessPermits={[c.id]:600};
    expect(restore().accessPermits).toEqual({[c.id]:600});
    expect(claimSchema.safeParse({...claim,accessPermits:{[c.id]:-1}}).success).toBe(false);
  });
  it('automatic claims choose an unclaimed known resource ahead of overlapping richer ground',()=>{
    const {world,a,b}=fixture();b.x=12;b.y=12;
    world.deposits={busy:{id:'busy',x:4,y:5,resource:'wood',tier:3,stock:1,capacity:1,regrowAt:0},free:{id:'free',x:5,y:4,resource:'wood',tier:2,stock:1,capacity:1,regrowAt:0}};
    claimTerritory(world,b,[4,5,4,5]);updateKnowledge(world);a.autonomy!.nextSocialTick=0;a.autonomy!.nextThinkTick=0;
    advanceAutonomy(world,a,{command:(command)=>dispatch(world,a.id,command),cancel:()=>{}});
    const area=sharedClaim(world,a)!.areas;
    expect(area[0]).toBeLessThanOrEqual(5);expect(area[2]).toBeGreaterThanOrEqual(5);
    expect(area[1]).toBeLessThanOrEqual(4);expect(area[3]).toBeGreaterThanOrEqual(4);
    expect(area[2]-area[0]).toBeGreaterThan(0);expect(area[3]-area[1]).toBeGreaterThan(0);
    expect(area[0]>4||area[2]<4||area[1]>5||area[3]<5).toBe(true);
    setAutonomyPolicy(world,a,{territory:[4,5,4,5]});expect(sharedClaim(world,a)?.areas).toEqual([4,5,4,5]);
  });
});
