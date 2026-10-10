import { describe, expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { enableAutonomy, foodRunway, productionSaturated } from '../src/world/autonomy.ts';
import { downconversionCommand, equipmentCommand, projectCommand } from '../src/world/production.ts';
import { updateKnowledge, observe } from '../src/world/observation.ts';
import { equipmentRecipe, nutrition } from '../src/world/config.ts';
import { MAX_TIER } from '../src/shared/tiers.ts';
import { scriptedCommands } from '../src/citizen/scripted.ts';

function fixture() {
  const world=createWorld({seed:7,population:1});world.deposits={};const citizen=Object.values(world.citizens)[0];citizen.x=4;citizen.y=4;
  enableAutonomy(world,citizen,{livelihood:'wood',reproduction:'avoid'});
  return {world,citizen};
}
describe('six-tier local production',()=>{
  it('defaults to the maximum tier and crafts T6 with exponential inputs, not old three-unit assumptions',()=>{
    const {world,citizen}=fixture();expect(citizen.autonomy!.policy.targetTier).toBe(MAX_TIER);
    citizen.inventory={...equipmentRecipe('knife',6)};
    expect(equipmentCommand(world,citizen,'knife',6)).toEqual({type:'craft',item:'knife',tier:6});
    expect(dispatch(world,citizen.id,{type:'craft',item:'knife',tier:6}).ok).toBe(true);
    for(let i=0;i<20;i++)tickWorld(world);
    expect(citizen.inventory['knife:6']).toBe(1);expect(citizen.inventory['wood:6']??0).toBe(0);
  });
  it('downconverts held higher-tier wood at an owned known station for a lower recipe',()=>{
    const {world,citizen}=fixture();citizen.inventory={'wood:6':1,'fibre:5':48,'food:1':3};
    world.buildings.station={id:'station',kind:'lumbermill',tier:5,x:4,y:4,health:100,maxHealth:100,ownerId:citizen.id,materials:{}};
    updateKnowledge(world);
    const command=equipmentCommand(world,citizen,'knife',5);
    expect(command).toEqual({type:'refine',buildingId:'station',fromTier:6,direction:'down'});
    expect(dispatch(world,citizen.id,command!).ok).toBe(true);
    for(let i=0;i<20;i++)tickWorld(world);
    expect(citizen.inventory['wood:6']??0).toBe(0);expect(citizen.inventory['wood:5']).toBe(2);
  });
  it('uses adjacent downconversion for projects and family-tier food, respecting station and no-go constraints',()=>{
    const {world,citizen}=fixture();citizen.inventory={'wood:3':1,'food:3':1};
    world.buildings.wood={id:'wood',kind:'lumbermill',tier:2,x:4,y:4,health:100,maxHealth:100,ownerId:citizen.id,materials:{}};
    world.buildings.food={id:'food',kind:'butchery',tier:2,x:4,y:5,health:100,maxHealth:100,ownerId:citizen.id,materials:{}};
    updateKnowledge(world);citizen.autonomy!.project={kind:'lumbermill',tier:2,x:6,y:4};
    expect(projectCommand(world,citizen)).toMatchObject({type:'refine',fromTier:3,direction:'down'});
    expect(downconversionCommand(world,citizen,'food',2)).toMatchObject({buildingId:'food',fromTier:3,direction:'down'});
    citizen.autonomy!.policy.noGo=[[4,5,4,5]];expect(downconversionCommand(world,citizen,'food',2)).toBeNull();
    world.buildings.wood.tier=1;expect(downconversionCommand(world,citizen,'wood',2)).toBeNull();
  });
  it('counts all food tiers and permits expensive high-tier input accumulation',()=>{
    const {world,citizen}=fixture();citizen.inventory={'food:6':2,'wood:6':95};
    expect(foodRunway(citizen)).toBe((citizen.fullness+2*nutrition(6))/.1);
    citizen.autonomy!.productionGoal={item:'knife',tier:6};expect(productionSaturated(world,citizen)).toBe(false);
  });
  it('legacy demonstration uses carried T6 tools and requires exponential T2 craft amounts',()=>{
    const {world,citizen}=fixture();citizen.inventory={'axe:6':1};updateKnowledge(world);
    expect(scriptedCommands(observe(world,citizen.id)).every((command)=>!['equip','unequip'].includes(command.type))).toBe(true);
    citizen.inventory={'axe:6':1,'axe:1':1,'knife:1':1,'scythe:1':1,'wood:2':3,'fibre:2':3};
    expect(scriptedCommands(observe(world,citizen.id)).some((command)=>command.type==='craft')).toBe(false);
  });
});
