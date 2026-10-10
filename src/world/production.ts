import type { Citizen, Command, Deposit, ToolKind, Point, Resource, Tier, World } from '../shared/types.ts';
import { distance, itemKey } from '../shared/utils.ts';
import { TIERS } from '../shared/types.ts';
import { BALANCE, buildingRecipe, canRefine, equipmentRecipe, MATCHING_TOOL, STATION_RESOURCE } from './config.ts';
import { findPath, neighbors, walkable } from './pathfinding.ts';
import { claimAllows, inside, sharedClaim } from './society.ts';
import { highestToolTier } from '../shared/tool-utils.ts';

export const carried = (citizen: Citizen, kind: string, tier: number) => citizen.inventory[itemKey(kind, tier)] ?? 0;

export const allowed = (citizen: Citizen, point: Point) => !citizen.autonomy?.policy.noGo?.some((area) => inside(point, area));
const depositIndex=new WeakMap<World,{tick:number,cells:Map<string,Deposit[]>}>();
const personalDeposits=new WeakMap<Citizen,{tick:number,deposits:Deposit[]}>();
export function knownDeposits(world: World, citizen: Citizen): Deposit[] {
  const cached=personalDeposits.get(citizen);
  if(cached?.tick===world.tick)return cached.deposits;
  let index=depositIndex.get(world);
  if(index?.tick!==world.tick) {
    index={tick:world.tick,cells:new Map()};
    for(const deposit of Object.values(world.deposits)) {
      const key=`${deposit.x},${deposit.y}`;
      const bucket=index.cells.get(key)??[];bucket.push(deposit);index.cells.set(key,bucket);
    }
    depositIndex.set(world,index);
  }
  const known = new Map<string, Deposit>();
  for (const tile of Object.values(citizen.knowledge)) for (const deposit of tile.deposits) known.set(deposit.id, deposit);
  // Current local perception takes precedence; no remote stock refresh.
  for(let dx=-BALANCE.sightRadius;dx<=BALANCE.sightRadius;dx++)for(let dy=-BALANCE.sightRadius;dy<=BALANCE.sightRadius;dy++) {
    if(Math.abs(dx)+Math.abs(dy)>BALANCE.sightRadius)continue;
    for(const deposit of index.cells.get(`${citizen.x+dx},${citizen.y+dy}`)??[])known.set(deposit.id,deposit);
  }
  const deposits=[...known.values()];
  personalDeposits.set(citizen,{tick:world.tick,deposits});
  return deposits;
}
function claimsPenalty(world: World, citizen: Citizen, point: Point): number {
  const state = citizen.autonomy!;
  let penalty = 0;
  for (const claim of Object.values(world.claims ?? {})) {
    if (!inside(point, claim.areas) || claimAllows(world, claim, citizen)) continue;
    penalty += state.policy.caution * 15 * (1 - state.policy.aggression);
  }
  return penalty;
}
/** Select using local sight and dated observations; pathfinding only tests geometry. */
export function gatherCommand(world: World, citizen: Citizen, resource: Resource, tier: Tier): Command | null {
  if (tier > highestToolTier(citizen, MATCHING_TOOL[resource]) + 1) return null;
  const state = citizen.autonomy!;
  const candidates = knownDeposits(world, citizen).filter((deposit) => deposit.resource === resource && deposit.tier === tier && allowed(citizen, deposit));
  const grounds = sharedClaim(world, citizen)?.areas ?? state.policy.territory;
  const scores=new Map(candidates.map((d)=>[d.id,distance(citizen,d) + claimsPenalty(world,citizen,d) + (!d.stock ? Math.max(0, d.regrowAt-world.tick) / 8 + 6 : 0) + (world.tick - (state.visited[d.id] ?? -10000) < 24 ? 12 : 0) - (grounds && inside(d,grounds) ? 4 : 0)]));
  candidates.sort((a,b) => scores.get(a.id)!-scores.get(b.id)! || a.id.localeCompare(b.id));
  for (const deposit of candidates.slice(0,12)) {
    if (!findPath(world,citizen,deposit)) { state.visited[deposit.id] = world.tick; continue; }
    const current = distance(citizen,deposit) <= BALANCE.sightRadius;
    if (!current) return { type:'move', x:deposit.x,y:deposit.y };
    if (!deposit.stock || Object.values(world.citizens).some((other) => other.id !== citizen.id && other.alive && other.action?.command.type === 'harvest' && other.action.command.depositId === deposit.id)) continue;
    state.visited[deposit.id] = world.tick;
    return { type:'harvest',depositId:deposit.id };
  }
  return null;
}
/** Frontier utility includes personal exploration age and public inner-tier geography. */
export function exploreCommand(world: World, citizen: Citizen, inward = false): Command | null {
  const state = citizen.autonomy!;
  const center = { x:Math.floor(world.width/2), y:Math.floor(world.height/2) };
  const candidates: Point[]=[];
  for (const tile of Object.values(citizen.knowledge)) {
    if (!allowed(citizen,tile) || !walkable(world,tile) || distance(citizen,tile)===0) continue;
    if (neighbors(tile).some((p)=>p.x>=0&&p.y>=0&&p.x<world.width&&p.y<world.height&&!citizen.knowledge[`${p.x},${p.y}`])) candidates.push(tile);
  }
  if (!candidates.length) {
    // Fully explored worlds revisit dated sites, not hidden current stock.
    for (const deposit of knownDeposits(world,citizen)) if (allowed(citizen,deposit) && distance(citizen,deposit)>0) candidates.push(deposit);
  }
  candidates.sort((a,b)=> {
    const score=(p:Point)=>distance(citizen,p)+(inward?distance(p,center)*0.7:0)+(world.tick-(state.visited[`${p.x},${p.y}`]??-10000)<160?40:0);
    return score(a)-score(b)||a.y-b.y||a.x-b.x;
  });
  for (const target of candidates.slice(0,16)) {
    if (!findPath(world,citizen,target)) continue;
    state.visited[`${target.x},${target.y}`]=world.tick;
    return {type:'move',x:target.x,y:target.y};
  }
  return null;
}
export function buyAvailable(world: World,citizen:Citizen,item:string,quantity:number,maxPrice:number):Command|null {
  const sell=Object.values(world.orders).filter((order)=>order.side==='sell'&&order.item===item&&order.citizenId!==citizen.id&&order.price<=maxPrice).sort((a,b)=>a.price-b.price||a.sequence-b.sequence)[0];
  if (!sell || citizen.gold<sell.price) return null;
  return {type:'order',side:'buy',item,quantity:Math.min(quantity,sell.quantity,Math.floor(citizen.gold/sell.price)),price:sell.price};
}
/** Convert carried surplus at personally known owned stations, one adjacent step at a time. */
export function downconversionCommand(world: World, citizen: Citizen, resource: Resource, neededTier: Tier): Command | null {
  const stations = Object.values(world.buildings).filter((station) => station.ownerId === citizen.id && STATION_RESOURCE[station.kind] === resource && allowed(citizen, station) && !Object.values(world.orders).some((order) => order.item === `building:${station.id}`) && Object.values(citizen.knowledge).some((tile) => tile.buildings.some((building) => building.id === station.id)));
  for (const fromTier of TIERS) {
    if (fromTier <= neededTier || carried(citizen, resource, fromTier) < 1) continue;
    const station = stations.find((station) => canRefine(station.tier, fromTier, 'down') && findPath(world, citizen, station));
    if (station) return { type: 'refine', buildingId: station.id, fromTier, direction: 'down' };
  }
  return null;
}
/** A small HTN: recipes decompose into purchases, tool prerequisites and known gathering. */
export function equipmentCommand(world:World,citizen:Citizen,item:ToolKind,tier:Tier,depth=0):Command|null {
  if(depth>18)return null;
  const key=itemKey(item,tier);
  if(highestToolTier(citizen,item)>=tier) return null;
  const purchase=buyAvailable(world,citizen,key,1,citizen.autonomy!.policy.buyPrice*tier*8);
  if(purchase)return purchase;
  const recipe=equipmentRecipe(item,tier);
  for(const [ingredient,quantity] of Object.entries(recipe)) {
    if((citizen.inventory[ingredient]??0)>=quantity)continue;
    const resource=ingredient.split(':')[0] as Resource;
    const buy=buyAvailable(world,citizen,ingredient,quantity-(citizen.inventory[ingredient]??0),citizen.autonomy!.policy.buyPrice*2**(tier-1));
    if(buy)return buy;
    const conversion=downconversionCommand(world,citizen,resource,tier);
    if(conversion)return conversion;
    if(tier>highestToolTier(citizen,MATCHING_TOOL[resource])+1) {
      const prerequisite=equipmentCommand(world,citizen,MATCHING_TOOL[resource],(tier-1) as Tier,depth+1);
      if(prerequisite)return prerequisite;
    }
    const gather=gatherCommand(world,citizen,resource,tier);
    if(gather)return gather;
  }
  if(Object.entries(recipe).every(([ingredient,quantity])=>(citizen.inventory[ingredient]??0)>=quantity))return {type:'craft',item,tier};
  return exploreCommand(world,citizen,tier>1);
}
export function projectCommand(world:World,citizen:Citizen):Command|null {
  const project=citizen.autonomy!.project;
  if(!project)return null;
  for(const [ingredient,quantity] of Object.entries(buildingRecipe(project.kind,project.tier))) {
    if((citizen.inventory[ingredient]??0)>=quantity)continue;
    const resource=ingredient.split(':')[0] as Resource;
    const buy=buyAvailable(world,citizen,ingredient,quantity-(citizen.inventory[ingredient]??0),citizen.autonomy!.policy.buyPrice*2**(project.tier-1));
    if(buy)return buy;
    const conversion=downconversionCommand(world,citizen,resource,project.tier);
    if(conversion)return conversion;
    if(project.tier>highestToolTier(citizen,MATCHING_TOOL[resource])+1)return equipmentCommand(world,citizen,MATCHING_TOOL[resource],(project.tier-1) as Tier);
    return gatherCommand(world,citizen,resource,project.tier)??exploreCommand(world,citizen,project.tier>1);
  }
  if(distance(citizen,project)>BALANCE.sightRadius)return {type:'move',x:project.x,y:project.y};
  if(Object.values(world.buildings).some((b)=>distance(b,project)===0)||Object.values(world.deposits).some((d)=>distance(d,project)===0)) {delete citizen.autonomy!.project;return null;}
  return {type:'build',...project};
}
