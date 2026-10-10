import { expect, it } from 'vitest';
import { createWorld, dispatch, cancelAction } from '../src/world/core.ts';
import { advanceAutonomy, enableAutonomy, setAutonomyPolicy } from '../src/world/autonomy.ts';
import { sharedClaim } from '../src/world/society.ts';
function fixture() {
  const world=createWorld({seed:7,population:1});const a=Object.values(world.citizens)[0];a.x=10;a.y=10;
  world.deposits={wood:{id:'wood',resource:'wood',tier:2,x:10,y:10,stock:30,capacity:30,regrowAt:0}};
  // A carried axe is sufficient; no separate tool setup is needed.
  a.inventory={'food:1':20,'axe:1':1};enableAutonomy(world,a,{livelihood:'wood',reproduction:'avoid'});
  return {world,a};
}
function turn({world,a}:ReturnType<typeof fixture>) {
  cancelAction(world,a.id);a.autonomy!.nextSocialTick=world.tick;a.autonomy!.nextThinkTick=world.tick;a.autonomy!.nextMarketTick=world.tick+100;
  advanceAutonomy(world,a,{command:c=>dispatch(world,a.id,c),cancel:()=>cancelAction(world,a.id)});
}
it('claims a bounded two dimensional resource patch and grows at the same tier without map union',()=>{
  const f=fixture();turn(f);const first=[...sharedClaim(f.world,f.a)!.areas];
  expect(first[2]-first[0]).toBeGreaterThan(0);expect(first[3]-first[1]).toBeGreaterThan(0);
  f.world.tick=60;f.a.x=14;f.world.deposits.next={...f.world.deposits.wood,id:'next',x:14};turn(f);
  const area=sharedClaim(f.world,f.a)!.areas;
  expect(area[2]).toBeGreaterThan(first[2]);expect(area[2]-area[0]).toBeLessThanOrEqual(6);expect(area[3]-area[1]).toBeLessThanOrEqual(6);
  expect(f.a.autonomy!.policy.territory).toBeUndefined();
});
it('marks caller-provided enableAutonomy borders explicit without marking automatic claims',()=>{
  const f=fixture();expect(f.a.autonomy!.territoryExplicit).toBe(false);
  turn(f);expect(f.a.autonomy!.territoryExplicit).toBe(false);
  const explicit=fixture();enableAutonomy(explicit.world,explicit.a,{territory:[10,10,10,10]});
  enableAutonomy(explicit.world,explicit.a);turn(explicit);
  expect(explicit.a.autonomy!.territoryExplicit).toBe(true);
  expect(sharedClaim(explicit.world,explicit.a)!.areas).toEqual([10,10,10,10]);
});
it('grows a serialized legacy generated point claim on an ordinary autonomy turn',()=>{
  const f=fixture();setAutonomyPolicy(f.world,f.a,{territory:[10,10,10,10]});
  delete f.a.autonomy!.territoryExplicit;
  const world=JSON.parse(JSON.stringify(f.world)) as typeof f.world;
  const restored={world,a:world.citizens[f.a.id]};turn(restored);
  const area=sharedClaim(world,restored.a)!.areas;
  expect(area[2]-area[0]).toBeGreaterThan(0);expect(area[3]-area[1]).toBeGreaterThan(0);
  expect(area[2]-area[0]).toBeLessThanOrEqual(6);expect(area[3]-area[1]).toBeLessThanOrEqual(6);
  expect(restored.a.autonomy!.policy.territory).toBeUndefined();
  expect(restored.a.autonomy!.territoryExplicit).toBe(false);
});
it('preserves legacy non-singleton policy borders',()=>{
  const f=fixture();setAutonomyPolicy(f.world,f.a,{territory:[9,9,11,11]});delete f.a.autonomy!.territoryExplicit;
  turn(f);expect(sharedClaim(f.world,f.a)!.areas).toEqual([9,9,11,11]);
  expect(f.a.autonomy!.policy.territory).toEqual([9,9,11,11]);
});
it('does not reinterpret a legacy point away from known livelihood deposits',()=>{
  const f=fixture();setAutonomyPolicy(f.world,f.a,{territory:[11,10,11,10]});delete f.a.autonomy!.territoryExplicit;
  turn(f);expect(sharedClaim(f.world,f.a)!.areas).toEqual([11,10,11,10]);
  expect(f.a.autonomy!.policy.territory).toEqual([11,10,11,10]);
});
it('preserves deliberate borders and explicit claim suppression',()=>{
  const f=fixture();setAutonomyPolicy(f.world,f.a,{territory:[10,10,10,10]});turn(f);
  expect(sharedClaim(f.world,f.a)!.areas).toEqual([10,10,10,10]);
  expect(f.a.autonomy!.territoryExplicit).toBe(true);
  setAutonomyPolicy(f.world,f.a,{aggression:.8});f.world.tick=60;turn(f);
  expect(f.a.autonomy!.territoryExplicit).toBe(true);
  expect(sharedClaim(f.world,f.a)!.areas).toEqual([10,10,10,10]);
  setAutonomyPolicy(f.world,f.a,{territory:null});f.world.tick=120;turn(f);expect(sharedClaim(f.world,f.a)).toBeUndefined();
  expect(f.a.autonomy!.territoryExplicit).toBe(false);
});
