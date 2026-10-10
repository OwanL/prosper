import type { Citizen, Command, World, Tier } from '../shared/types.ts';
import { BALANCE, buildingRecipe, equipmentRecipe, MATCHING_TOOL, nutrition } from './config.ts';
import { highestToolTier } from '../shared/tool-utils.ts';
import { TIERS } from '../shared/tiers.ts';

/** Actual prospective consumption, not a generic hoarding allowance. */
export function marketReserves(citizen:Citizen):Record<string,number> {
  const state=citizen.autonomy!,policy=state.policy,result:Record<string,number>={};
  const protect=(recipe:Record<string,number>)=>{for(const [item,quantity] of Object.entries(recipe))result[item]=Math.max(result[item]??0,quantity);};
  const tool=MATCHING_TOOL[policy.livelihood],next=highestToolTier(citizen,tool)+1;
  const goal=state.productionGoal??(next<=policy.targetTier?{item:tool,tier:next as Tier}:undefined);
  if(goal) {
    protect(equipmentRecipe(goal.item,goal.tier));
    for(const tier of TIERS)if(tier<=goal.tier)for(const kind of ['axe','knife','scythe'] as const)if(highestToolTier(citizen,kind)<tier)protect(equipmentRecipe(kind,tier));
  }
  if(state.project)protect(buildingRecipe(state.project.kind,state.project.tier));
  if(policy.reproduction!=='avoid')result['food:2']=Math.max(result['food:2']??0,BALANCE.reproductionFood+1);
  // Livelihood preference protects one best carried tool, never prohibits explicit sales.
  const best=highestToolTier(citizen,tool);
  if(best)result[`${tool}:${best}`]=Math.max(result[`${tool}:${best}`]??0,1);
  return result;
}
export function marketNeeds(citizen:Citizen):Record<string,number> {
  const result=marketReserves(citizen),policy=citizen.autonomy!.policy;
  const fullness=TIERS.reduce((sum,t)=>sum+(citizen.inventory[`food:${t}`]??0)*nutrition(t),citizen.fullness);
  const food=Math.max(0,Math.ceil((policy.foodReserveTicks*BALANCE.fullnessDrain-fullness)/nutrition(1)));
  result['food:1']=(citizen.inventory['food:1']??0)+food;
  return result;
}
/** Retained addressed purchases only. Eviction means unknown basis, not proven profit. */
export function acquisitionFloor(world:World,citizen:Citizen,item:string):number {
  return Math.max(0,...world.events.filter(e=>e.kind==='trade'&&e.citizenId===citizen.id&&e.audience?.includes(citizen.id)).map(e=>{
    const match=/^\d+ (\S+) sold for (\d+) gold each\.$/.exec(e.text);
    return match?.[1]===item?Number(match[2])+1:0;
  }));
}
export function restingBid(world:World,citizen:Citizen):Command|null {
  const state=citizen.autonomy!,own=Object.values(world.orders).filter(o=>o.citizenId===citizen.id),bids=own.filter(o=>o.side==='buy');
  if(bids.length>=3)return null;
  const needs=marketNeeds(citizen),escrow=bids.reduce((sum,o)=>sum+o.escrowGold,0);
  const budget=Math.min(citizen.gold-24,Math.floor((citizen.gold+escrow)*.25)-escrow);
  if(budget<1)return null;
  const deficitFor=(item:string)=>Math.max(0,(needs[item]??0)-(citizen.inventory[item]??0));
  const candidates=[...Object.keys(needs).sort((a,b)=>Number(deficitFor(b)>0)-Number(deficitFor(a)>0)||Number(b.startsWith('food:'))-Number(a.startsWith('food:'))),'fibre:1','wood:1'];
  for(const item of new Set(candidates)) {
    if(own.some(o=>o.item===item))continue;
    const held=citizen.inventory[item]??0,deficit=Math.max(0,(needs[item]??0)-held),tier=Number(item.split(':')[1]);
    if(!deficit&&(deficitFor('food:1')>0||held>=3||!item.startsWith('wood:')&&!item.startsWith('fibre:')))continue;
    const asks=Object.values(world.orders).filter(o=>o.citizenId!==citizen.id&&o.side==='sell'&&o.item===item);
    const resale=Math.min(state.policy.sellPrice*2**(tier-1),...asks.map(o=>o.price));
    const price=deficit?Math.max(1,Math.floor(state.policy.buyPrice*2**(tier-1))):Math.max(1,Math.floor(resale)-1);
    // Immediate purchases remain the production planner's job.
    if(asks.some(o=>o.price<=price)||!deficit&&price>=resale)continue;
    const quantity=Math.min(3,deficit||3-held,Math.floor(budget/price));
    if(quantity>0)return {type:'order',side:'buy',item,quantity,price};
  }
  return null;
}
