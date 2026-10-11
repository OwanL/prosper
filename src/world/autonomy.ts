import type { Citizen, Command, CommandResult, ToolKind, Point, Resource, Tier, World } from '../shared/types.ts';
import type { AutonomyPolicy, AutonomyPolicyPatch, CitizenTraits, SocialSignal } from '../shared/autonomy-types.ts';
import { MAX_TIER, TIERS } from '../shared/tiers.ts';
import { distance, event, fail, itemKey, ok, random } from '../shared/utils.ts';
import { BALANCE, buildingRecipe, canRefine, equipmentRecipe, MATCHING_TOOL, nutrition, refinementRecipe } from './config.ts';
import { directiveActionResult } from './directives.ts';
import { planActionResult } from './plans.ts';
import { releaseAction } from './life.ts';
import { acquisitionFloor, marketNeeds, marketReserves, restingBid } from './market-intent.ts';
import { findPath, walkable } from './pathfinding.ts';
import { buyAvailable, carried, downconversionCommand, equipmentCommand, exploreCommand, gatherCommand, knownDeposits, projectCommand } from './production.ts';
import { highestToolTier } from '../shared/tool-utils.ts';
import { allied, claimAllows, claimTerritory, deliverSignal, evidence, formAlliance, inside, maintainSociety, observeSocialEvents, relationship, renounceConflictingAlliances, sharedClaim, visibleCitizens } from './society.ts';

import { strategyAllowed, type WorldControlOptions } from './evaluation-authority.ts';

export interface AutonomyActions { command: (command: Command) => CommandResult; cancel: () => void }
const clamp = (value:number) => Math.max(0,Math.min(1,value));
const rectAround = (world:World,p:Point,r:number):[number,number,number,number] => [Math.max(0,p.x-r),Math.max(0,p.y-r),Math.min(world.width-1,p.x+r),Math.min(world.height-1,p.y+r)];
const serial = (citizen:Citizen) => Number(citizen.id.split('-').at(-1)) || 0;
export function foodRunway(citizen:Citizen):number {
  return (citizen.fullness + TIERS.reduce((sum,tier)=>sum+carried(citizen,'food',tier)*nutrition(tier),0))/BALANCE.fullnessDrain;
}
function defaultTraits(world:World,citizen:Citizen):CitizenTraits {
  let hash=(world.seed^Math.imul(serial(citizen),2654435761))>>>0;
  const value=()=>{hash=Math.imul(hash^hash>>>16,2246822507)>>>0; return .15+(hash/4294967296)*.7;};
  const traits={aggression:value(),sociability:value(),ambition:value(),caution:value(),fertility:value(),loyalty:value()};
  const text=citizen.personality.toLowerCase();
  if(/bold|status-conscious/.test(text)) {traits.aggression=.8;traits.ambition=.9;traits.caution=.3;}
  if(/warm|parenthood/.test(text)) {traits.fertility=.9;traits.sociability=.8;traits.aggression=.25;}
  if(/watchful|frugal/.test(text)) {traits.caution=.9;traits.loyalty=.9;traits.aggression=.3;}
  if(/curious|independent/.test(text)) {traits.fertility=.3;traits.aggression=.35;}
  return traits;
}
export function enableAutonomy(world:World,citizen:Citizen,policy:Partial<AutonomyPolicy>={}):void {
  if(citizen.autonomy) {
    Object.assign(citizen.autonomy.policy,policy);
    if(Object.hasOwn(policy,'territory'))citizen.autonomy.territoryExplicit=policy.territory!=null;
    return;
  }
  const traits=defaultTraits(world,citizen);
  const nearby=Object.values(world.deposits).filter((d)=>distance(citizen,d)<=BALANCE.sightRadius).sort((a,b)=>distance(citizen,a)-distance(citizen,b))[0];
  const livelihood=nearby?.resource??(['food','wood','fibre'] as const)[serial(citizen)%3];
  citizen.autonomy={source:'scripted',territoryExplicit:Object.hasOwn(policy,'territory')&&policy.territory!=null,traits,policy:{livelihood,targetTier:MAX_TIER,home:{x:citizen.x,y:citizen.y},stance:traits.aggression>.65?'assertive':'cooperative',aggression:traits.aggression,caution:traits.caution,foodReserveTicks:700,sellPrice:4,buyPrice:6,allies:[],rivals:[],reproduction:traits.fertility>.65?'seek':traits.fertility>.35?'open':'avoid',accessPrice:traits.aggression>.65?8:0,...policy},relationships:{},evidence:[],intent:`Establish a ${livelihood} livelihood`,nextThinkTick:world.tick,nextSocialTick:world.tick+serial(citizen)%80,nextMarketTick:world.tick+serial(citizen)%30,lastEventId:0,lastProgressTick:world.tick,visited:{},threatened:{},permits:{}};
  citizen.nextReviewTick=world.tick+600+serial(citizen)%600;
}
export function validateAutonomyPolicy(world:World,citizen:Citizen,policy:AutonomyPolicyPatch):CommandResult {
  for(const rect of [...(policy.noGo??[]),...(policy.territory?[policy.territory]:[])]) if(rect.length!==4||!rect.every(Number.isInteger)||rect[0]<0||rect[1]<0||rect[2]<rect[0]||rect[3]<rect[1]||rect[2]>=world.width||rect[3]>=world.height) return fail('invalid-policy-area','Policy areas must fit the public map bounds.');
  if(policy.home&&(!Number.isInteger(policy.home.x)||!Number.isInteger(policy.home.y)||policy.home.x<0||policy.home.y<0||policy.home.x>=world.width||policy.home.y>=world.height))return fail('invalid-policy-home','Home must be within public map bounds.');
  const known=new Set([citizen.id,...Object.values(citizen.knowledge).flatMap((t)=>t.citizens.map((c)=>c.id)),...visibleCitizens(world,citizen).map((c)=>c.id),...world.messages.filter((m)=>!m.to||m.to===citizen.id||m.from===citizen.id).flatMap((m)=>[m.from,...(m.to?[m.to]:[])]),...Object.values(world.orders).map((o)=>o.citizenId),...Object.values(world.claims??{}).map((c)=>c.ownerId),...Object.values(world.alliances??{}).flatMap((pact)=>pact.members)]);
  for(const otherId of [...(policy.allies??[]),...(policy.rivals??[]),...(policy.partnerId?[policy.partnerId]:[])])if(!known.has(otherId)||otherId===citizen.id)return fail('unknown-policy-citizen','Relationships and partners must use known other citizen IDs.');
  return ok('Policy valid.');
}
export function setAutonomyPolicy(world:World,citizen:Citizen,policy:AutonomyPolicyPatch,options?:WorldControlOptions):CommandResult {
  if(!strategyAllowed(citizen.id,options))return fail('evaluation-authority','Policy commits are disabled for this citizen.');
  const validation=validateAutonomyPolicy(world,citizen,policy);
  if(!validation.ok)return validation;
  enableAutonomy(world,citizen);
  if(Object.hasOwn(policy,'territory'))citizen.autonomy!.territoryExplicit=policy.territory!=null;
  const previousPartner=citizen.autonomy!.requestedPartnerId??citizen.autonomy!.meeting?.partnerId??citizen.autonomy!.policy.partnerId;
  const normalized={...policy};
  for(const key of ['home','territory','partnerId'] as const)if(normalized[key]===null) {
    delete normalized[key];
    delete citizen.autonomy!.policy[key];
  }
  Object.assign(citizen.autonomy!.policy,structuredClone(normalized));
  delete citizen.autonomy!.idleReason;
  if(policy.rivals)renounceConflictingAlliances(world,citizen);
  if(policy.noGo&&citizen.action&&[citizen.action.target,...citizen.action.path,citizen].some((point)=>policy.noGo!.some((area)=>inside(point,area)))) {
    const result=fail('policy-border-changed','New no-go policy invalidated this route or work site; reserved inputs returned.');
    planActionResult(citizen,citizen.action.id,result);directiveActionResult(citizen,citizen.action.id,result);
    releaseAction(world,citizen.id,false);
    citizen.lastResult=result.message;
    citizen.autonomy!.nextThinkTick=world.tick;
  }
  if(policy.territory===null) {
    citizen.autonomy!.claimSuppressed=true;
    maintainSociety(world);
    for(const [claimId,claim] of Object.entries(world.claims??{}))if(claim.ownerId===citizen.id)delete world.claims![claimId];
  }else if(policy.territory)citizen.autonomy!.claimSuppressed=false;
  citizen.autonomy!.policyRevision=(citizen.autonomy!.policyRevision??0)+1;
  citizen.autonomy!.reviewedTick=world.tick;
  const state=citizen.autonomy!,current=state.policy;
  const requested=previousPartner;
  if(requested&&(policy.partnerId===null||current.reproduction==='avoid'||current.partnerId&&current.partnerId!==requested||current.rivals.includes(requested)&&current.partnerId!==requested)) {
    delete state.requestedPartnerId;delete state.meeting;delete state.familyFoodTarget;
    state.signals=state.signals?.filter((signal)=>signal.from!==requested||!signal.kind.startsWith('family-'));
    state.sentSignals??={};state.sentSignals[`family-decline:${requested}`]=world.tick;
    state.intent='Revised family intentions; return to livelihood';
  }
  if(policy.territory)claimTerritory(world,citizen,policy.territory);
  return ok('Persistent policy updated; local survival, trade, social decisions and execution continue between reviews.');
}
export function inheritAutonomy(world:World,child:Citizen,a:Citizen,b:Citizen):void {
  if(!a.autonomy&&!b.autonomy)return;
  enableAutonomy(world,child);
  const state=child.autonomy!;
  const aTraits=a.autonomy?.traits??state.traits,bTraits=b.autonomy?.traits??state.traits;
  for(const key of Object.keys(state.traits) as (keyof CitizenTraits)[])state.traits[key]=clamp((aTraits[key]+bTraits[key])/2+(random(world)-.5)*.2);
  const mentor=(random(world)<.5?a:b).autonomy;
  if(mentor) {state.policy.livelihood=mentor.policy.livelihood;state.policy.home={x:child.x,y:child.y};}
  state.policy.aggression=state.traits.aggression;state.policy.caution=state.traits.caution;
  state.policy.stance=state.traits.aggression>.65?'assertive':'cooperative';
  state.policy.reproduction=state.traits.fertility>.65?'seek':state.traits.fertility>.35?'open':'avoid';
  for(const parent of [a,b]) {relationship(child,parent.id).trust=55;if(parent.autonomy)relationship(parent,child.id).trust=65;}
  child.personality=`Inherited disposition: aggression ${state.traits.aggression.toFixed(2)}, caution ${state.traits.caution.toFixed(2)}, sociability ${state.traits.sociability.toFixed(2)}, ambition ${state.traits.ambition.toFixed(2)}. Parents influence my skills and habits; I can find my own livelihood.`;
  child.goals=[`Find a sustainable ${state.policy.livelihood} livelihood`,'Keep food in reserve','Build relationships through actual exchanges'];
  evidence(child,{tick:world.tick,kind:'family',text:`Born to ${a.name} and ${b.name}; dispositions inherited with small mutation, no free currency.`});
}
function speak(world:World,citizen:Citizen,actions:AutonomyActions,text:string,to?:string):void {
  actions.command({type:'message',text,...(to?{to}:{})});
}
function issue(world:World,citizen:Citizen,actions:AutonomyActions,command:Command,intent:string,interrupt=false):boolean {
  delete citizen.autonomy!.idleReason;
  if(citizen.action&&interrupt) {
    const result=fail('local-interruption',`${intent}; local controller interrupted work.`);
    planActionResult(citizen,citizen.action.id,result);directiveActionResult(citizen,citizen.action.id,result);
    actions.cancel();
  }
  const result=actions.command(command);
  citizen.autonomy!.intent=result.ok?intent:`${intent}: ${result.message}`;
  if(result.ok)citizen.autonomy!.lastProgressTick=world.tick;
  else citizen.autonomy!.nextThinkTick=world.tick+24;
  if(result.ok&&command.type==='attack')citizen.autonomy!.combat={targetId:command.targetId,startedTick:world.tick,lastContactTick:world.tick,reason:intent};
  return result.ok;
}
const attackStrength=(citizen:Citizen)=>BALANCE.attackDamage[highestToolTier(citizen,'sword') as 0|Tier]*(.35+citizen.health/100);
function perceivedStrength(world:World,citizen:Citizen,opponent:Citizen):number {
  // Health is visible; held weapon is only used while the opponent is visibly fighting.
  const sword=opponent.action?.command.type==='attack'?highestToolTier(opponent,'sword'):0;
  let strength=BALANCE.attackDamage[sword as 0|Tier]*(.35+opponent.health/100);
  for(const nearby of visibleCitizens(world,citizen))if(nearby.id!==opponent.id&&allied(world,opponent,nearby.id))strength+=BALANCE.attackDamage[0]*.5;
  return strength;
}
function canFight(world:World,citizen:Citizen,opponent:Citizen,desperate=false):boolean {
  const policy=citizen.autonomy!.policy;
  return citizen.health>(desperate?8:20+policy.caution*30)&&attackStrength(citizen)*(desperate?2:1+policy.aggression*.8)>perceivedStrength(world,citizen,opponent)*(0.8+policy.caution*.5);
}
function flee(world:World,citizen:Citizen,opponent:Citizen,actions:AutonomyActions):boolean {
  const candidates:Point[]=[];
  for(let dx=-4;dx<=4;dx++)for(let dy=-4;dy<=4;dy++) {
    const p={x:citizen.x+dx,y:citizen.y+dy};
    if(Math.abs(dx)+Math.abs(dy)>4||!walkable(world,p)||citizen.autonomy!.policy.noGo?.some((a)=>inside(p,a)))continue;
    candidates.push(p);
  }
  candidates.sort((a,b)=>distance(b,opponent)-distance(a,opponent)||distance(a,citizen)-distance(b,citizen));
  const target=candidates.find((p)=>distance(p,opponent)>distance(citizen,opponent)&&findPath(world,citizen,p));
  if(!target)return false;
  if(citizen.autonomy!.intent!==`Flee ${opponent.name}`)event(world,'flee',`${citizen.name} flees ${opponent.name}: survival matters more than this fight.`,{citizenId:citizen.id,targetId:opponent.id,x:citizen.x,y:citizen.y,audience:[citizen.id,opponent.id]});
  return issue(world,citizen,actions,{type:'move',...target},`Flee ${opponent.name}`,true);
}
/** High priority reflexes run while strategic inference or ordinary physical work continues. */
export function reactAutonomy(world:World,citizen:Citizen,actions:AutonomyActions,options?:WorldControlOptions):void {
  if(!strategyAllowed(citizen.id,options))return;
  const state=citizen.autonomy;
  if(!state||world.tick<state.nextThinkTick)return;
  state.nextThinkTick=world.tick+4;
  if(world.tick%120<4) {
    if(Object.keys(state.visited).length>640)state.visited=Object.fromEntries(Object.entries(state.visited).sort((a,b)=>b[1]-a[1]).slice(0,512));
    for(const [otherId,threat] of Object.entries(state.threatened))if(world.tick-threat.tick>600)delete state.threatened[otherId];
    for(const [otherId,until] of Object.entries(state.permits))if(until<=world.tick)delete state.permits[otherId];
    if(state.signals)state.signals=state.signals.filter((signal)=>world.tick-signal.tick<2400);
    if(state.sentSignals)state.sentSignals=Object.fromEntries(Object.entries(state.sentSignals).filter(([,tick])=>world.tick-tick<2400).sort((a,b)=>b[1]-a[1]).slice(0,64));
    if(Object.keys(state.threatened).length>32)state.threatened=Object.fromEntries(Object.entries(state.threatened).sort((a,b)=>b[1].tick-a[1].tick).slice(0,32));
    if(Object.keys(state.permits).length>64)state.permits=Object.fromEntries(Object.entries(state.permits).sort((a,b)=>b[1]-a[1]).slice(0,64));
    if(Object.keys(state.relationships).length>64) {
      state.relationships=Object.fromEntries(Object.entries(state.relationships).sort(([aId,a],[bId,b])=> {
        const rank=(otherId:string,r:typeof a)=>Math.abs(r.trust)+r.grievance+r.harm+(allied(world,citizen,otherId)||citizen.parents.includes(otherId)?1000:0);
        return rank(bId,b)-rank(aId,a);
      }).slice(0,64));
    }
  }
  observeSocialEvents(world,citizen);
  if(state.policy.noGo?.some((area)=>inside(citizen,area))) {
    const exits:Point[]=[];
    for(let radius=1;radius<world.width+world.height&&!exits.length;radius++)for(let dx=-radius;dx<=radius;dx++)for(const dy of new Set([radius-Math.abs(dx),Math.abs(dx)-radius])) {
      const point={x:citizen.x+dx,y:citizen.y+dy};
      if(walkable(world,point)&&!state.policy.noGo.some((area)=>inside(point,area)))exits.push(point);
    }
    const exit=exits.find((point)=>findPath(world,citizen,point));
    if(exit&&state.intent!=='Leave newly forbidden ground')issue(world,citizen,actions,{type:'move',...exit},'Leave newly forbidden ground',true);
    if(!exit) {if(citizen.action)actions.cancel();state.intent='Trapped inside no-go policy; no safe exit';}
    return;
  }
  if(citizen.action?.command.type==='reproduce')return;
  const local=visibleCitizens(world,citizen);
  const attacker=local.find((other)=>other.action?.command.type==='attack'&&other.action.command.targetId===citizen.id);
  if(attacker) {
    if(citizen.action?.command.type==='attack'&&citizen.action.command.targetId===attacker.id&&citizen.health>25)return;
    if(canFight(world,citizen,attacker)&&citizen.health>35) {
      evidence(citizen,{tick:world.tick,kind:'attack',otherId:attacker.id,text:`Defending myself against ${attacker.name}'s visible attack.`});
      issue(world,citizen,actions,{type:'attack',targetId:attacker.id},`Defend against ${attacker.name}`,true);
    }else flee(world,citizen,attacker,actions);
    return;
  }
  if(citizen.action?.command.type==='attack') {
    const opponent=local.find((other)=>other.id===(citizen.action!.command as {targetId:string}).targetId);
    const combat=state.combat;
    if(combat) {
      if(opponent&&distance(citizen,opponent)<=1)combat.lastContactTick=world.tick;
      const ownClaim=sharedClaim(world,citizen);
      const leftTerritory=combat.reason==='Enforce a social commitment'&&ownClaim&&opponent&&!inside(opponent,ownClaim.areas)&&distance(opponent,{x:Math.max(ownClaim.areas[0],Math.min(ownClaim.areas[2],opponent.x)),y:Math.max(ownClaim.areas[1],Math.min(ownClaim.areas[3],opponent.y))})>1;
      if(world.tick-combat.lastContactTick>60||world.tick-combat.startedTick>320||leftTerritory) {
        actions.cancel();
        evidence(citizen,{tick:world.tick,kind:'attack',otherId:combat.targetId,text:`Ended pursuit: ${leftTerritory?'intruder left the grounds':'fight no longer worth the pursuit'}.`});
        state.intent='Return to livelihood after conflict';
        delete state.combat;
        return;
      }
    }
    if(opponent&&citizen.health<25)flee(world,citizen,opponent,actions);
    return;
  }
  // Survival interrupts ordinary production early enough to travel and buy food.
  if(foodRunway(citizen)<180&&citizen.action&&citizen.action.command.type!=='loot') {
    const active=citizen.action.command;
    const eating=active.type==='harvest'&&world.deposits[active.depositId]?.resource==='food';
    if(!eating&&state.intent!=='Secure food') {
      const rescue=foodCommand(world,citizen);
      if(rescue) {
        evidence(citizen,{tick:world.tick,kind:'survival',text:'Food reserve became critical; interrupted routine production before starvation.'});
        issue(world,citizen,actions,rescue,'Secure food',true);
      }
    }
  }
}
function foodCommand(world:World,citizen:Citizen):Command|null {
  const state=citizen.autonomy!;
  const desired=Math.max(1,Math.ceil((state.policy.foodReserveTicks-foodRunway(citizen))*BALANCE.fullnessDrain/nutrition(1)));
  const sales=Object.values(world.orders).filter((order)=>order.side==='sell'&&order.item.startsWith('food:')&&order.citizenId!==citizen.id).sort((a,b)=>a.price/nutrition(Number(a.item.split(':')[1]) as Tier)-b.price/nutrition(Number(b.item.split(':')[1]) as Tier));
  for(const sale of sales) {
    const tier=Number(sale.item.split(':')[1]) as Tier;
    const cap=state.policy.buyPrice*2**(tier-1)*(foodRunway(citizen)<100?3:1);
    const buy=buyAvailable(world,citizen,sale.item,Math.max(1,Math.ceil(desired*nutrition(1)/nutrition(tier))),cap);
    if(buy)return buy;
  }
  for(const tier of [...TIERS].reverse()) {const gather=gatherCommand(world,citizen,'food',tier);if(gather)return gather;}
  return null;
}
/** Production needs an outlet. Count only own goods/escrow, funded public demand
 * and actual addressed sale receipts; never infer a peer's private reserves. */
export function productionSaturated(world:World,citizen:Citizen):boolean {
  const state=citizen.autonomy!,resource=state.policy.livelihood;
  const held={...citizen.inventory};
  for(const order of Object.values(world.orders))if(order.citizenId===citizen.id&&order.side==='sell')for(const [item,amount] of Object.entries(order.escrowItems))held[item]=(held[item]??0)+amount;
  const demand=Object.values(world.orders).filter((order)=>order.citizenId!==citizen.id&&order.side==='buy'&&order.item.startsWith(`${resource}:`)).reduce((sum,order)=>sum+order.quantity,0);
  const sales=[...world.events,...(world.significantEvents??[])].filter((entry)=>entry.kind==='trade'&&entry.targetId===citizen.id&&world.tick-entry.tick<600&&entry.text.includes(` ${resource}:`));
  const recent=new Map(sales.map((entry)=>[entry.id,entry]));
  const sold=[...recent.values()].reduce((sum,entry)=>sum+(Number(entry.text.split(' ')[0])||0),0);
  const buffer=6+Math.min(12,demand+sold);
  const required = {...(state.productionGoal?equipmentRecipe(state.productionGoal.item,state.productionGoal.tier):{}),...(state.project?buildingRecipe(state.project.kind,state.project.tier):{})};
  if(Object.entries(required).some(([item,amount])=>item.startsWith(`${resource}:`)&&(held[item]??0)<amount))return false;
  if(resource==='food') {
    const tier=Math.min(state.policy.targetTier,highestToolTier(citizen,'knife')+1) as Tier;
    const nutritionHeld=TIERS.reduce((sum,t)=>sum+(held[itemKey('food',t)]??0)*nutrition(t),citizen.fullness);
    const family=state.policy.reproduction==='avoid'?0:(BALANCE.reproductionFood+1)*nutrition(1);
    return nutritionHeld>state.policy.foodReserveTicks*BALANCE.fullnessDrain*2+family+buffer*nutrition(tier);
  }
  const developing=highestToolTier(citizen,MATCHING_TOOL[resource])<state.policy.targetTier;
  const recipeBuffer=developing?Math.max(...(['axe','knife','scythe'] as const).map((item)=>equipmentRecipe(item,state.policy.targetTier)[itemKey(resource,state.policy.targetTier)]??0)):0;
  return TIERS.reduce((sum,t)=>sum+(held[itemKey(resource,t)]??0),0)>18+buffer+recipeBuffer;
}
function manageMarket(world:World,citizen:Citizen,actions:AutonomyActions):void {
  const state=citizen.autonomy!;
  if(world.tick<state.nextMarketTick)return;
  state.nextMarketTick=world.tick+60;
  const own=Object.values(world.orders).filter((order)=>order.citizenId===citizen.id);
  // Escrow cannot be a food tomb: reclaim an unfed actor's unsold meals.
  if(foodRunway(citizen)<250) {
    const foodSale=own.find((order)=>order.side==='sell'&&order.item.startsWith('food:'));
    if(foodSale){actions.command({type:'cancel-order',orderId:foodSale.id});return;}
  }
  const needs=marketNeeds(citizen);
  for(const order of own) if(world.tick-order.createdTick>800||order.side==='buy'&&(foodRunway(citizen)<250&&!order.item.startsWith('food:')||(citizen.inventory[order.item]??0)>=(needs[order.item]??0)+3||order.price>state.policy.buyPrice*2**(Number(order.item.split(':')[1])-1))) {actions.command({type:'cancel-order',orderId:order.id});return;}
  const bid=restingBid(world,citizen);
  if(bid) {actions.command(bid);return;}
  const protectedInputs=marketReserves(citizen);
  for(const [item,amount] of Object.entries(citizen.inventory)) {
    const [kind,tierString]=item.split(':'),tier=Number(tierString);
    if(!['food','wood','fibre'].includes(kind)||own.some((order)=>order.item===item&&order.side==='sell'))continue;
    let reserve=Math.max(kind===state.policy.livelihood?5:0,protectedInputs[item]??0);
    if(kind==='food') {
      const surplusFullness=(foodRunway(citizen)-state.policy.foodReserveTicks-200)*BALANCE.fullnessDrain;
      reserve=Math.max(0,amount-Math.floor(surplusFullness/nutrition(tier as Tier)));
      if(tier===1&&state.policy.reproduction!=='avoid')reserve=Math.max(reserve,BALANCE.reproductionFood+1);
    }
    const specialty=MATCHING_TOOL[state.policy.livelihood],nextTier=highestToolTier(citizen,specialty)+1;
    const goal=state.productionGoal ?? (nextTier<=state.policy.targetTier?{item:specialty,tier:nextTier as Tier}:undefined);
    if(goal) {
      reserve=Math.max(reserve,equipmentRecipe(goal.item,goal.tier)[item]??0);
      // Preserve cross-tool prerequisite inputs too, rather than repeatedly selling them.
      if(tier<=goal.tier)for(const prerequisite of ['axe','knife','scythe'] as const)if(highestToolTier(citizen,prerequisite)<tier)reserve=Math.max(reserve,equipmentRecipe(prerequisite,tier as Tier)[item]??0);
    }
    if(state.project)reserve=Math.max(reserve,buildingRecipe(state.project.kind,state.project.tier)[item]??0);
    const surplus=Math.min(6,amount-reserve);
    if(surplus<=0)continue;
    const otherSales=Object.values(world.orders).filter((order)=>order.side==='sell'&&order.item===item&&order.citizenId!==citizen.id);
    const cheapest=otherSales.length?Math.min(...otherSales.map((order)=>order.price)):Infinity;
    const baseline=state.policy.sellPrice*2**(tier-1);
    const price=Math.max(1,acquisitionFloor(world,citizen,item),Math.min(baseline,Number.isFinite(cheapest)?cheapest:baseline));
    if(own.some((order)=>order.side==='buy'&&order.item===item&&order.price>=price))continue;
    actions.command({type:'order',side:'sell',item,quantity:surplus,price});
    return;
  }
}
function sociallyRelated(a:Citizen,b:Citizen):boolean { return a.parents.includes(b.id)||b.parents.includes(a.id)||a.parents.some((id)=>b.parents.includes(id)); }
function familyCommand(world:World,citizen:Citizen,_actions:AutonomyActions):Command|null {
  if(citizen.autonomy!.policy.reproduction==='avoid'||citizen.reproductionCooldown>world.tick||citizen.health<BALANCE.reproductionHealth||carried(citizen,'food',1)<1)return null;
  const partner=visibleCitizens(world,citizen).find(p=>p.id!==citizen.id&&p.alive&&p.health>=BALANCE.reproductionHealth&&!p.action&&distance(citizen,p)<=1);
  return partner?{type:'reproduce',partnerId:partner.id}:null;
}
function manageSocial(world:World,citizen:Citizen,actions:AutonomyActions):Command|null {
  const state=citizen.autonomy!,policy=state.policy;
  state.signals??=[];state.sentSignals??={};
  if(world.tick<state.nextSocialTick)return null;
  state.nextSocialTick=world.tick+40;
  const local=visibleCitizens(world,citizen);
  const ownClaim=sharedClaim(world,citizen);
  if(ownClaim&&inside(citizen,ownClaim.areas))ownClaim.expiresTick=world.tick+2400;
  if(!state.claimSuppressed&&(!ownClaim||ownClaim.ownerId===citizen.id)&&highestToolTier(citizen,MATCHING_TOOL[policy.livelihood])>=1) {
    // Only this missing-marker pattern identifies the old zero-radius generated
    // anchor: a policy point matching our current claim and a known T2+ livelihood
    // deposit. This is a local heuristic, not an unconditional saved-world migration;
    // historical wider borders and newly marked explicit points remain deliberate.
    const border=policy.territory;
    const legacyAnchor=state.territoryExplicit===undefined&&!!border&&border[0]===border[2]&&border[1]===border[3]&&ownClaim?.ownerId===citizen.id&&ownClaim.areas.every((value,index)=>value===border[index])&&knownDeposits(world,citizen).some((deposit)=>deposit.resource===policy.livelihood&&deposit.tier>=2&&deposit.x===border[0]&&deposit.y===border[1]);
    if(legacyAnchor) {delete policy.territory;state.territoryExplicit=false;}
    const overlaps=(p:Point)=>Object.values(world.claims??{}).some((claim)=>claim.expiresTick>world.tick&&claim.ownerId!==citizen.id&&!allied(world,citizen,claim.ownerId)&&inside(p,claim.areas));
    const rich=knownDeposits(world,citizen).filter((d)=>d.resource===policy.livelihood&&d.tier>=2&&distance(citizen,d)<=BALANCE.sightRadius&&!state.policy.noGo?.some((area)=>inside(d,area))).sort((a,b)=>Number(overlaps(a))-Number(overlaps(b))||b.tier-a.tier||distance(citizen,a)-distance(citizen,b))[0];
    const previousTier=ownClaim?Math.max(0,...knownDeposits(world,citizen).filter((d)=>inside(d,ownClaim.areas)&&d.resource===policy.livelihood).map((d)=>d.tier)):0;
    if(!ownClaim&&(policy.territory||rich)||!policy.territory&&ownClaim&&rich&&(legacyAnchor||rich.tier>previousTier||rich.tier===previousTier&&!inside(rich,ownClaim.areas))) {
      let area=policy.territory;
      if(!area&&rich) {
        const radius=1+Math.floor(clamp(state.traits.ambition*(1-policy.caution*.5))*2.99);
        const intersects=(a:number[],b:number[])=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
        const greedy=state.traits.ambition>.75&&policy.aggression>.6&&policy.caution<.5;
        for(let r=radius;r>=1;r--) {
          const offsets=[0,-r,r];
          for(const dx of offsets)for(const dy of offsets) {
            if(area)continue;
            const patch=rectAround(world,{x:rich.x+dx,y:rich.y+dy},r);
            if(!inside(rich,patch)||patch[2]<=patch[0]||patch[3]<=patch[1])continue;
            if(policy.noGo?.some(border=>intersects(patch,border)))continue;
            if(!greedy&&Object.values(world.claims??{}).some(claim=>claim.expiresTick>world.tick&&claim.ownerId!==citizen.id&&!allied(world,citizen,claim.ownerId)&&intersects(patch,claim.areas)))continue;
            area=patch;break;
          }
          if(area)break;
        }
      }
      if(area) {
      const claim=claimTerritory(world,citizen,area);
      speak(world,citizen,actions,`${citizen.name}'s ${policy.livelihood} grounds: (${area[0]},${area[1]})–(${area[2]},${area[3]}). ${claim.stance==='open'?'Work with us and we share access.':claim.accessPrice?`Pay ${claim.accessPrice} gold for access. Repeated trespass will be met with force.`:'Leave these resources alone. I will attack repeated intruders.'}`);
      }
    }
  }
  for(const other of local) {
    const rel=relationship(citizen,other.id);
    // Hunger is observable through an actual plea; newborn dependants are known
    // family, not a license to inspect another adult's hidden food inventory.
    const birth=[...world.events,...(world.significantEvents??[])].findLast((e)=>e.kind==='birth'&&e.citizenId===other.id&&e.audience?.includes(citizen.id));
    const dependant=other.parents.includes(citizen.id)&&!!birth&&world.tick-birth.tick<900;
    const plea=world.messages.some((m)=>m.from===other.id&&(!m.to||m.to===citizen.id)&&world.tick-m.tick<120&&/starving|need food|dying/i.test(m.text));
    if(distance(citizen,other)<=1&&(dependant||plea&&allied(world,citizen,other.id))&&foodRunway(citizen)>state.policy.foodReserveTicks+300) {
      for(const tier of TIERS) {
        if(carried(citizen,'food',tier)<2)continue;
        const quantity=Math.min(carried(citizen,'food',tier)-1,Math.max(1,Math.ceil(25/nutrition(tier))));
        const previousHelp=state.evidence.findLast((e)=>e.kind==='help'&&e.otherId===other.id);
        if(previousHelp&&world.tick-previousHelp.tick<180)break;
        return {type:'give',citizenId:other.id,item:itemKey('food',tier),quantity};
      }
    }
    if(world.tick-rel.lastTick>200) {rel.grievance=Math.max(0,rel.grievance-1);rel.lastTick=world.tick;}
    if(allied(world,citizen,other.id)) {
      const aggressor=local.find((p)=>p.action?.command.type==='attack'&&p.action.command.targetId===other.id);
      if(aggressor&&canFight(world,citizen,aggressor)&&foodRunway(citizen)>250) {
        evidence(citizen,{tick:world.tick,kind:'attack',otherId:aggressor.id,text:`Intervened against ${aggressor.name}'s visible attack on ally ${other.name}.`});
        return {type:'attack',targetId:aggressor.id};
      }
    }
    const rivalPact=Object.values(world.alliances??{}).some((pact)=>pact.members.includes(other.id)&&pact.members.some((member)=>policy.rivals.includes(member)));
    if(rel.grievance<15&&!policy.rivals.includes(other.id)&&!rivalPact&&!allied(world,citizen,other.id)&&(state.sentSignals['alliance-departure']??-10000)<=world.tick-500) {
      const explicit=policy.allies.includes(other.id);
      const received=state.signals.findLast((signal)=>signal.kind==='alliance-offer'&&signal.from===other.id&&world.tick-signal.tick<400);
      const compatible=explicit||state.traits.sociability>.35&&rel.trust>=18;
      if(received&&compatible) {
        formAlliance(world,citizen,other);
        if(allied(world,citizen,other.id))speak(world,citizen,actions,`${other.name} and I have a compact: reciprocal resource access and mutual defense.`);
      } else if(compatible&&(state.sentSignals[`alliance-offer:${other.id}`]??-10000)<world.tick-500) {
        speak(world,citizen,actions,`${other.name}, I propose reciprocal resource access and mutual defense.`,other.id);
        deliverSignal(world,citizen,other,{kind:'alliance-offer'});
      }
    }
    const claim=Object.values(world.claims??{}).find((c)=>(c.ownerId===citizen.id||allied(world,citizen,c.ownerId))&&inside(other,c.areas)&&c.expiresTick>world.tick&&c.stance!=='open');
    const extracting=other.action?.command.type==='harvest'&&world.deposits[other.action.command.depositId]?.resource===claim?.resource;
    if(claim&&extracting&&!claimAllows(world,claim,other)) {
      rel.grievance=Math.min(100,rel.grievance+8);rel.trespasses++;
      evidence(citizen,{tick:world.tick,kind:'trespass',otherId:other.id,text:`Saw ${other.name} working claimed ${policy.livelihood} grounds at (${other.x},${other.y}).`,x:other.x,y:other.y});
      const threat=state.threatened[other.id];
      if(!threat||world.tick-threat.tick>500) {
        state.threatened[other.id]={tick:world.tick,reason:'territorial trespass',demand:claim.accessPrice};
        speak(world,citizen,actions,`${other.name}, these ${policy.livelihood} grounds are claimed. ${claim.accessPrice?`Pay ${claim.accessPrice} gold for access`:'Leave the resources alone'} or I will use force.`,other.id);
        deliverSignal(world,citizen,other,{kind:'access-demand',amount:claim.accessPrice,reason:'territorial trespass'});
        event(world,'threat',`${citizen.name} warns ${other.name} over territorial trespass.`,{citizenId:citizen.id,targetId:other.id,x:other.x,y:other.y,audience:[citizen.id,other.id]});
      } else if(world.tick-threat.tick>=40&&rel.grievance>=25&&policy.aggression>.45&&canFight(world,citizen,other)) {
        evidence(citizen,{tick:world.tick,kind:'attack',otherId:other.id,text:`Enforced territory after warning and ${rel.trespasses} observed intrusions; grievance ${rel.grievance}.`});
        return {type:'attack',targetId:other.id};
      }
    }
    const publicGoods=Object.values(world.orders).filter((order)=>order.side==='sell'&&order.citizenId===other.id).reduce((value,order)=>value+order.quantity*order.price,0);
    if(policy.stance==='predatory'&&policy.aggression>.6&&foodRunway(citizen)>800&&highestToolTier(citizen,'sword')>=1&&!allied(world,citizen,other.id)&&!sociallyRelated(citizen,other)&&(publicGoods>=24||policy.rivals.includes(other.id))&&(state.permits[other.id]??0)<=world.tick&&canFight(world,citizen,other)) {
      const threat=state.threatened[other.id];
      const demand=Math.max(4,policy.accessPrice);
      if(!threat||world.tick-threat.tick>500) {
        state.threatened[other.id]={tick:world.tick,reason:'protection demand',demand};
        speak(world,citizen,actions,`${other.name}, your public goods make you worth protecting. Pay me ${demand} gold or I will take payment by force.`,other.id);
        deliverSignal(world,citizen,other,{kind:'access-demand',amount:demand,reason:'protection demand'});
        event(world,'threat',`${citizen.name} demands ${demand} gold from ${other.name}, backed by force and observed public trade goods.`,{citizenId:citizen.id,targetId:other.id,x:citizen.x,y:citizen.y,audience:[citizen.id,other.id]});
        evidence(citizen,{tick:world.tick,kind:'threat',otherId:other.id,text:`Demanded ${demand} gold after seeing ${publicGoods} gold of public sale goods.`});
      }else if(threat.reason==='protection demand'&&world.tick-threat.tick>=80) {
        evidence(citizen,{tick:world.tick,kind:'attack',otherId:other.id,text:`Used force after an unpaid ${threat.demand} gold protection demand; target has publicly offered goods, actual carried holdings unknown.`});
        return {type:'attack',targetId:other.id};
      }
    }
    // Respond to received coercion using personal visible threat evidence, not private thoughts.
    const threatening=state.signals.findLast((signal)=>signal.kind==='access-demand'&&signal.from===other.id&&world.tick-signal.tick<100);
    const territorial=threatening?.reason==='territorial trespass';
    const demandedClaim=territorial?sharedClaim(world,other):undefined;
    const payable=territorial?!!demandedClaim&&inside(citizen,demandedClaim.areas)&&demandedClaim.stance==='toll'&&demandedClaim.accessPrice===threatening?.amount&&!claimAllows(world,demandedClaim,citizen):(state.permits[other.id]??0)<=world.tick;
    if(threatening&&(threatening.amount??0)>0&&payable&&!allied(world,citizen,other.id)&&policy.caution>.55&&citizen.gold>=threatening.amount!) {
      const receipt=actions.command({type:'transfer',citizenId:other.id,gold:threatening.amount!});
      if(receipt.ok) {
        // Commit claim authorization with the successful transfer, before any
        // ally's next enforcement pass. Protection remains a personal receipt.
        if(demandedClaim) (demandedClaim.accessPermits??={})[citizen.id]=world.tick+600;
        else state.permits[other.id]=world.tick+600;
        deliverSignal(world,citizen,other,{kind:'access-grant',amount:threatening.amount,reason:threatening.reason});
        evidence(citizen,{tick:world.tick,kind:'threat',otherId:other.id,text:`Paid ${threatening.amount} gold for 600 ticks of access after a threat.`});
        event(world,'extortion',`${citizen.name} pays ${other.name} ${threatening.amount} gold for access.`,{citizenId:other.id,targetId:citizen.id,x:citizen.x,y:citizen.y,audience:[citizen.id,other.id]});
      }
    }
    const paid:SocialSignal|undefined=state.signals.findLast((signal)=>signal.kind==='access-grant'&&signal.from===other.id&&world.tick-signal.tick<100);
    if(paid&&state.threatened[other.id]&&paid.amount===state.threatened[other.id].demand) {
      if(paid.reason!=='territorial trespass') state.permits[other.id]=paid.tick+500;
      rel.grievance=Math.max(0,rel.grievance-20);
      // A delivered receipt is consumed once; rereading it cannot slide expiry.
      state.signals=state.signals.filter((signal)=>signal!==paid);
    }
  }
  return null;
}
/** Ordinary planning is cheap, single pass and synchronous. Model calls are optional policy reviews. */
export function advanceAutonomy(world:World,citizen:Citizen,actions:AutonomyActions,options?:WorldControlOptions):boolean {
  if(!strategyAllowed(citizen.id,options))return false;
  const state=citizen.autonomy;
  if(!state)return false;
  observeSocialEvents(world,citizen);
  manageMarket(world,citizen,actions);
  if(citizen.action||citizen.queue.length||citizen.plan||citizen.strategy?.status==='active') {delete state.idleReason;return false;}
  if(world.tick<state.nextThinkTick-3)return true;
  delete state.idleReason;
  const social=foodRunway(citizen)>=180?manageSocial(world,citizen,actions):null;
  if(social)return issue(world,citizen,actions,social,'Enforce a social commitment');
  if(foodRunway(citizen)<state.policy.foodReserveTicks) {
    const food=foodCommand(world,citizen);
    if(food)return issue(world,citizen,actions,food,'Secure food');
    const foods=knownDeposits(world,citizen).filter((deposit)=>deposit.resource==='food');
    const blocked=!!state.policy.noGo?.length&&foods.some((deposit)=>state.policy.noGo!.some((area)=>inside(deposit,area)))&&!foods.some((deposit)=>!state.policy.noGo!.some((area)=>inside(deposit,area))&&findPath(world,citizen,deposit));
    if(blocked&&!state.evidence.some((entry)=>entry.text.startsWith('Survival blocked by no-go policy')&&world.tick-entry.tick<300)) {
      evidence(citizen,{tick:world.tick,kind:'survival',text:'Survival blocked by no-go policy: known food is excluded or unreachable; no affordable public food sale. Border remains binding.'});
      citizen.nextReviewTick=Math.min(citizen.nextReviewTick,world.tick+1);
    }
    const body=Object.values(citizen.knowledge).flatMap((tile)=>tile.loot).find((loot)=>findPath(world,citizen,loot));
    if(body)return issue(world,citizen,actions,{type:'loot',lootId:body.id},'Search a known body for survival supplies');
    if(foodRunway(citizen)<100) {
      if(state.beggedTick===undefined||world.tick-state.beggedTick>300) {
        state.beggedTick=world.tick;speak(world,citizen,actions,'I am starving. I need food now. Sell it, lend it, or help me before this becomes desperate.');
        evidence(citizen,{tick:world.tick,kind:'survival',text:'No usable known food or affordable sale; publicly begged for food.'});
        citizen.nextReviewTick=Math.min(citizen.nextReviewTick,world.tick+1);
      } else if(world.tick-state.beggedTick>=80&&citizen.fullness===0) {
        // No private inventory scan: current food work and public sales are observable evidence.
        const target=visibleCitizens(world,citizen).filter((other)=>!allied(world,citizen,other.id)&&!sociallyRelated(citizen,other)).filter((other)=>other.action?.command.type==='harvest'&&world.deposits[other.action.command.depositId]?.resource==='food'||Object.values(world.orders).some((order)=>order.citizenId===other.id&&order.side==='sell'&&order.item.startsWith('food:'))).sort((a,b)=>a.health-b.health)[0];
        if(target&&canFight(world,citizen,target,true)) {
          evidence(citizen,{tick:world.tick,kind:'attack',otherId:target.id,text:`Starving after unanswered plea; attacked known food producer ${target.name} to seize possible reserves.`});
          speak(world,citizen,actions,`${target.name}, I asked for food and I am dying. I will take what I need.`,target.id);
          return issue(world,citizen,actions,{type:'attack',targetId:target.id},'Desperate food robbery');
        }
      }
    }
    // Empty known plants often regrow before a random frontier walk returns.
    // Wait briefly at a personally observed site; never refresh remote stock.
    const soon = foods.filter((deposit)=>deposit.tier<=highestToolTier(citizen,'knife')+1&&
      distance(citizen,deposit)<=BALANCE.sightRadius&&!deposit.stock&&deposit.regrowAt>world.tick&&
      deposit.regrowAt-world.tick<=Math.max(24,BALANCE.harvestTicks)&&
      !state.policy.noGo?.some((area)=>inside(deposit,area))&&findPath(world,citizen,deposit)&&
      !visibleCitizens(world,citizen).some((other)=>other.action?.command.type==='harvest'&&other.action.command.depositId===deposit.id))
      .sort((a,b)=>a.regrowAt-b.regrowAt||distance(citizen,a)-distance(citizen,b))[0];
    if(soon) {state.intent='Wait for nearby food regrowth';return true;}
    // Public food claims advertise a destination, not its unseen deposits/stock.
    const advertised=Object.values(world.claims??{}).filter((claim)=>claim.resource==='food'&&claim.expiresTick>world.tick)
      .map((claim)=>({x:Math.round((claim.areas[0]+claim.areas[2])/2),y:Math.round((claim.areas[1]+claim.areas[3])/2)}))
      .filter((point)=>distance(citizen,point)>BALANCE.sightRadius&&
        world.tick-(state.visited[`food-advert:${point.x},${point.y}`]??-10000)>300&&
        !state.policy.noGo?.some((area)=>inside(point,area))&&findPath(world,citizen,point))
      .sort((a,b)=>distance(citizen,a)-distance(citizen,b))[0];
    if(advertised) {state.visited[`food-advert:${advertised.x},${advertised.y}`]=world.tick;
      return issue(world,citizen,actions,{type:'move',...advertised},'Seek publicly advertised food grounds');}
    const explore=exploreCommand(world,citizen,false);
    if(explore)return issue(world,citizen,actions,explore,blocked?'Search safe terrain; survival blocked by no-go policy':'Search for food');
    if(blocked) {state.intent='Survival blocked by no-go policy';return true;}
  }
  const family=familyCommand(world,citizen,actions);
  if(family)return issue(world,citizen,actions,family,'Prepare a willing family');
  if(state.intent.startsWith('Wait')&&state.meeting&&world.tick-state.meeting.tick<1800)return true;
  // First sell what the local biome actually provides. Otherwise every novice
  // walks away seeking recipe inputs while nobody produces goods to trade.
  if(highestToolTier(citizen,MATCHING_TOOL[state.policy.livelihood])===0&&carried(citizen,state.policy.livelihood,1)<10&&world.tick<600) {
    const startup=gatherCommand(world,citizen,state.policy.livelihood,1);
    if(startup)return issue(world,citizen,actions,startup,`Establish ${state.policy.livelihood} stock for trade`);
  }
  // Persistent production subgoal prevents prerequisite thrashing between ticks.
  if(state.productionGoal) {
    const {item,tier}=state.productionGoal;
    if(highestToolTier(citizen,item)>=tier)delete state.productionGoal;
    else {
      const production=equipmentCommand(world,citizen,item,tier);
      if(production)return issue(world,citizen,actions,production,`Develop ${item} T${tier}`);
    }
  }
  const specialty=MATCHING_TOOL[state.policy.livelihood],tool=highestToolTier(citizen,specialty);
  const stations=Object.values(world.buildings).filter((building)=>building.ownerId===citizen.id&&building.kind!=='wall');
  if(state.project) {
    if(stations.some((building)=>building.x===state.project!.x&&building.y===state.project!.y))delete state.project;
    else {
      const command=projectCommand(world,citizen);
      if(command)return issue(world,citizen,actions,command,`Establish ${state.project.kind} T${state.project.tier}`);
    }
  }
  if(tool<Math.min(2,state.policy.targetTier)||tool<state.policy.targetTier&&world.tick>1200) {
    state.productionGoal={item:specialty,tier:(tool+1) as Tier};
    const command=equipmentCommand(world,citizen,specialty,(tool+1) as Tier);
    if(command)return issue(world,citizen,actions,command,`Develop ${specialty} T${tool+1}`);
  }
  if(state.policy.stance!=='cooperative'&&Object.values(state.relationships).some((rel)=>rel.grievance>=15)&&highestToolTier(citizen,'sword')<Math.min(2,tool)) {
    state.productionGoal={item:'sword',tier:Math.max(1,Math.min(2,tool)) as Tier};
    const command=equipmentCommand(world,citizen,state.productionGoal.item,state.productionGoal.tier);
    if(command)return issue(world,citizen,actions,command,'Prepare to defend contested resources');
  }
  if(!stations.length&&tool>=2&&world.tick>800&&foodRunway(citizen)>600) {
    const sites=Object.values(citizen.knowledge).filter((tile)=>distance(citizen,tile)<=BALANCE.sightRadius&&!tile.deposits.length&&!tile.buildings.length&&!state.policy.noGo?.some((area)=>inside(tile,area))&&walkable(world,tile)).sort((a,b)=>distance(citizen,a)-distance(citizen,b)||a.y-b.y||a.x-b.x);
    const site=sites[0];
    if(site) {
      const kind=state.policy.livelihood==='wood'?'lumbermill':state.policy.livelihood==='fibre'?'spinning-wheel':'butchery';
      state.project={kind,tier:1,x:site.x,y:site.y};
      const command=projectCommand(world,citizen);
      if(command)return issue(world,citizen,actions,command,`Establish ${kind} T1`);
    }
  }
  // Refineries provide a productive use for cheap local inputs when direct
  // high-tier extraction is contested or depleted. Owned stations stay useful.
  for(const station of stations) {
    const resource=station.kind==='lumbermill'?'wood':station.kind==='spinning-wheel'?'fibre':'food';
    if(resource!==state.policy.livelihood||Object.values(world.orders).some((o)=>o.item===`building:${station.id}`))continue;
    const known=Object.values(citizen.knowledge).some((tile)=>tile.buildings.some((b)=>b.id===station.id));
    if(!known)continue;
    for(const fromTier of [...TIERS].reverse()) {
      if(!canRefine(station.tier,fromTier,'up')||fromTier>=state.policy.targetTier)continue;
      const required=refinementRecipe(resource,fromTier,'up')[itemKey(resource,fromTier)]??3;
      if(carried(citizen,resource,fromTier)>=required+6&&(resource!=='food'||foodRunway(citizen)>1200))return issue(world,citizen,actions,{type:'refine',buildingId:station.id,fromTier},`Refine ${resource} at my ${station.kind}`);
    }
  }
  if(productionSaturated(world,citizen)) {
    state.idleReason='surplus';
    state.intent=`Unsold ${state.policy.livelihood} surplus; watch productive ground`;
    if(!state.evidence.some((entry)=>entry.text.startsWith('Production saturated:')&&world.tick-entry.tick<1200)) {
      evidence(citizen,{tick:world.tick,kind:'survival',text:`Production saturated: own ${state.policy.livelihood} stock and escrow exceed survival, recipe and observed sale buffers. Paused extraction; keep trading, social commitments and defense active.`});
      if(world.tick-(state.reviewedTick??0)>1200)citizen.nextReviewTick=Math.min(citizen.nextReviewTick,world.tick+30);
    }
    state.nextThinkTick=world.tick+20;
    return true;
  }
  for(const tier of [...TIERS].reverse()) {
    if(tier>state.policy.targetTier||tier>tool+1)continue;
    const gather=gatherCommand(world,citizen,state.policy.livelihood,tier);
    if(gather)return issue(world,citizen,actions,gather,`Produce ${state.policy.livelihood} T${tier}`);
  }
  const explore=exploreCommand(world,citizen,tool>0);
  if(explore)return issue(world,citizen,actions,explore,'Find productive ground');
  state.intent='Wait for a local opportunity';
  return true;
}
