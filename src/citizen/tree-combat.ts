import type { CitizenSighting, DecisionObservation, Inventory } from '../shared/types.ts';
import { highestToolTier } from '../shared/tool-utils.ts';
import { BALANCE } from '../world/config.ts';
import { knownBuyPrice } from './tree-market.ts';

/** Only available carried holdings count. Personal observed unit prices use the
 * existing effort-price fallback, never estates, buildings or escrow. */
export function carriedCombatValue(o: DecisionObservation, inventory: Inventory, gold: number): number {
  return gold + Object.entries(inventory).reduce((sum, [item, quantity]) =>
    sum + Math.max(0, quantity) * knownBuyPrice(o, item), 0);
}
/** Conservative symmetric contest, not a forecast of free confiscation. Equal
 * health/damage gives p=.5; even overwhelming strength is capped at .9. Effort
 * costs .25 gold/tick and expected injury .5 gold/health. Utility saturates at
 * .75 with a 100-gold scale, so wealth cannot swamp all other goals. */
export function optionalAttackValue(o: DecisionObservation, peer: CitizenSighting): { gain: number; benefit: number; risk: number } | undefined {
  const tile = o.visible.find(t => t.citizens.some(c => c.id === peer.id));
  if (!tile || peer.inventory === undefined || peer.gold === undefined || peer.health <= 0) return undefined;
  const damage = (inventory: Inventory) => BALANCE.attackDamage[highestToolTier({ inventory }, 'sword')]!;
  const ownDamage = damage(o.citizen.inventory), otherDamage = damage(peer.inventory);
  const ownStrength = o.citizen.health * ownDamage, otherStrength = peer.health * otherDamage;
  const p = Math.max(.1, Math.min(.9, ownStrength / Math.max(1, ownStrength + otherStrength)));
  const steps = Math.max(0, Math.max(Math.abs(tile.x - o.citizen.x), Math.abs(tile.y - o.citizen.y)) - 1);
  const effort = steps * BALANCE.moveTicks + Math.ceil(peer.health / ownDamage) * BALANCE.attackTicks + BALANCE.lootTicks;
  const injury = Math.min(o.citizen.health, peer.health / ownDamage * otherDamage);
  const gain = p * carriedCombatValue(o, peer.inventory, peer.gold) -
    (1 - p) * carriedCombatValue(o, o.citizen.inventory, o.citizen.gold) - .25 * effort - .5 * injury;
  return { gain, benefit: .75 * Math.max(0, gain) / (100 + Math.max(0, gain)), risk: 1 - p };
}
