import type { DecisionObservation } from '../shared/types.ts';
import type { TreeTaskState } from '../shared/tree-types.ts';
import { BALANCE, buildingRecipe, equipmentRecipe, houseRecipe, nutrition, refinementRecipe } from '../world/config.ts';

/** Short-term commitments only. Custody is inventory: work and order escrow have
 * already left it. Delivery totals are historical, not additional held stock. */
export function committedReserves(o: Pick<DecisionObservation, 'citizen'>, extra?: TreeTaskState, emergency = false): Record<string, number> {
  const reserves: Record<string, number> = {};
  const tasks = [...(o.citizen.mind?.tasks ?? []), ...(extra ? [extra] : [])]
    .filter(t => t.status === 'running' && !t.phase.startsWith('exit:'));
  const add = (recipe: Record<string, number>) => { for (const [key, n] of Object.entries(recipe)) reserves[key] = Math.max(reserves[key] ?? 0, n); };
  for (const t of tasks) {
    // Strict starving-food funding abandons routine work inputs. Family
    // provisions remain protected; generic urgency never enables this exemption.
    if (emergency) {
      if (t.definitionId === 'Reproduce' || /family intention|observed invitation|family provision/.test(t.request.purpose)) add({[`food:${BALANCE.reproductionFoodTier}`]: BALANCE.reproductionFood});
      continue;
    }
    const tier = t.request.tier;
    if (['ObtainTool', 'CraftTool'].includes(t.definitionId) && t.targetId) {
      const [kind, level] = t.targetId.split(':');
      if (['axe', 'scythe', 'knife', 'sword'].includes(kind)) add(equipmentRecipe(kind as 'axe', Number(level)));
    } else if (t.definitionId === 'BuildHouse') add(houseRecipe(tier));
    else if (t.definitionId === 'BuildWall') add(Object.fromEntries(Object.entries(buildingRecipe('wall', tier)).map(([k,n]) => [k,n * t.request.quantity])));
    else if (t.definitionId === 'BuildResourceBuilding') add(buildingRecipe(({wood:'lumbermill',fibre:'spinning-wheel',food:'butchery'} as const)[t.request.resource], tier));
    else if (t.definitionId === 'RefineResource' && t.strategyId?.startsWith('refine-')) {
      const direction = t.strategyId === 'refine-up' ? 'up' : 'down';
      add(refinementRecipe(t.request.resource, tier + (direction === 'up' ? -1 : 1), direction));
    }
    const purpose = /^Materials for (lumbermill|spinning-wheel|butchery|house|wall|axe|scythe|knife|sword) T(\d+)/.exec(t.request.purpose);
    if (purpose) {
      const kind = purpose[1]!; const level = Number(purpose[2]);
      add(kind === 'house' ? houseRecipe(level) : ['axe','scythe','knife','sword'].includes(kind) ? equipmentRecipe(kind as 'axe', level) : buildingRecipe(kind as 'lumbermill', level));
    }
    if (t.definitionId === 'Reproduce' || /family intention|observed invitation|family provision/.test(t.request.purpose)) add({[`food:${BALANCE.reproductionFoodTier}`]: BALANCE.reproductionFood});
  }
  // Work has already secured its inputs outside carried custody.
  for (const [key, n] of Object.entries(o.citizen.action?.reserved ?? {}))
    reserves[key] = Math.max(0, (reserves[key] ?? 0) - n);
  // A small nutrition runway, allocated across actual carried food, not each tier.
  let need = Math.max(20, 60 - o.citizen.fullness);
  for (const [key, quantity] of Object.entries(o.citizen.inventory).filter(([k]) => /^food:\d+$/.test(k)).sort(([a],[b]) => Number(a.split(':')[1]) - Number(b.split(':')[1]))) {
    const units = Math.min(quantity, need / nutrition(Number(key.split(':')[1])));
    reserves[key] = Math.max(reserves[key] ?? 0, units);
    need = Math.max(0, need - units * nutrition(Number(key.split(':')[1])));
  }
  // Tools do not wear out: keep the highest carried tier of each useful kind.
  for (const kind of ['axe', 'knife', 'scythe', 'sword']) {
    const key = Object.keys(o.citizen.inventory).filter(k => k.startsWith(`${kind}:`) && o.citizen.inventory[k] >= 1)
      .sort((a,b) => Number(b.split(':')[1]) - Number(a.split(':')[1]))[0];
    if (key && !emergency) reserves[key] = Math.max(reserves[key] ?? 0, 1);
  }
  return reserves;
}
export function carriedSurplus(o: DecisionObservation, item: string, extra?: TreeTaskState, emergency = false): number {
  return Math.max(0, (o.citizen.inventory[item] ?? 0) - (committedReserves(o, extra, emergency)[item] ?? 0));
}
/** Background asks must not take custody promised to a running sale. This is
 * deliberately separate from sale execution's own surplus check. */
export function backgroundSaleReserves(o: Pick<DecisionObservation, 'citizen' | 'markets'>): Record<string, number> {
  const reserves: Record<string, number> = {};
  for (const task of o.citizen.mind?.tasks ?? []) {
    if (task.status !== 'running' || task.phase.startsWith('exit:') || task.definitionId !== 'SellItem') continue;
    const item = task.targetId ?? `${task.request.resource}:${task.request.tier}`;
    const escrow = o.markets.filter(order => order.side === 'sell' && order.citizenId === o.citizen.id && task.ownedOrderIds.includes(order.id) && order.item === item)
      .reduce((sum, order) => sum + order.quantity, 0);
    reserves[item] = (reserves[item] ?? 0) + Math.max(0, task.request.quantity - (task.accounting?.units ?? 0) - escrow);
  }
  return reserves;
}
/** Observed bids are engine-funded at posting; peer escrow is private and
 * projected as zero. Public remaining quantity is the attested demand.
 * Own listings are saturation, never demand. */
export function observedDemand(o: DecisionObservation, item: string): number {
  const bids = o.markets.filter(x => x.citizenId !== o.citizen.id && x.side === 'buy' && x.item === item)
    .reduce((n,x) => n + x.quantity, 0);
  const listed = o.markets.filter(x => x.citizenId === o.citizen.id && x.side === 'sell' && x.item === item).reduce((n,x) => n + x.quantity, 0);
  return Math.max(0, bids - listed);
}
