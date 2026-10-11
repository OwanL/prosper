import type { DecisionObservation, Deposit, Point } from '../shared/types.ts';
import { distance } from '../shared/utils.ts';
import { BALANCE, harvestDuration } from '../world/config.ts';
/** Current public work is a completion estimate, not a reservation or inventory
 * disclosure. Dated sightings are uncertainty, never a current competitor lock. */
export function harvestCost(o: DecisionObservation, deposit: Deposit, point: Point, toolTier: number): number {
  const own = distance(o.citizen, point) * BALANCE.moveTicks + harvestDuration(deposit.tier, toolTier);
  const competitors = new Map<string, number>();
  for (const tile of o.visible) {
    if (tile.seenTick !== o.tick) continue;
    for (const citizen of tile.citizens) {
      const work = citizen.publicWork;
      if (citizen.id === o.citizen.id || !citizen.alive || work?.depositId !== deposit.id) continue;
      competitors.set(citizen.id, work.remainingTicks + (work.phase === 'travel' ? work.harvestTicks : 0));
    }
  }
  const earlier = [...competitors.values()].filter((ticks) => ticks < own).length;
  // Known regrowth may restore a depleted unit before our completion. This is
  // an estimate; authoritative first-completion settlement decides actual yield.
  const regrowth = deposit.regrowAt > o.tick && deposit.regrowAt <= o.tick + own ? 1 : 0;
  if (deposit.stock + regrowth <= earlier) return Infinity;
  return Math.max(own, deposit.stock <= 0 ? Math.max(0, deposit.regrowAt - o.tick) : 0);
}
