// A route preference, not a reservation or prediction of remote live stock.
// Only recent personally seen work and the actor's own outcomes inform it.
import { estimatedRecheckDelay } from './replenishment.mjs';
import { FOOD_HARVEST_TICKS, WOOD_HARVEST_TICKS } from './economy.mjs';
import { equipmentSpec } from './equipment.mjs';

export function foragePreferenceCost(citizen, node, tick, travelTicks) {
  const effort = Math.max(1, (node.kind === 'tree' ? WOOD_HARVEST_TICKS : FOOD_HARVEST_TICKS)
    - (equipmentSpec(citizen, 'tool')?.harvestReduction ?? 0));
  return (Math.max(travelTicks ?? Infinity, estimatedRecheckDelay(node, tick)) + effort
    + competitionPenalty(citizen, node, tick)) / Math.max(1, node.yield ?? 1);
}

export function observedHarvesterCount(citizen, node, tick, maximumAge = 12) {
  return Object.values(citizen.knowledge?.people ?? {}).filter(p => p.source === 'seen'
    && tick - p.observedAt >= 0 && tick - p.observedAt <= maximumAge
    && p.observedActivity?.type === 'harvesting' && p.observedActivity.target === node.id).length;
}

export function visiblyOccupied(citizen, node, tick) {
  if (!(node.stock > 0) || node.source !== 'seen' || node.observedAt !== tick) return false;
  return observedHarvesterCount(citizen, node, tick, 0) >= node.stock;
}

export function competitionPenalty(citizen, node, tick) {
  const cycle = node.regrowTicks || (node.kind === 'crop' ? 99 : 120);
  const competitors = observedHarvesterCount(citizen, node, tick);
  const shortage = Math.max(0, competitors + 1 - Math.max(1, node.stock));
  const history = citizen.resourceHistory?.[node.id];
  const recentLoss = history && tick - history.lastOutcomeAt >= 0 && tick - history.lastOutcomeAt <= cycle * 2
    ? Math.min(0.5, (history.lostRaces ?? 0) / Math.max(1, history.visits ?? 0)) : 0;
  return Math.round(cycle * Math.max(shortage, recentLoss));
}
