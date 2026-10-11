import type { DecisionObservation, Point } from '../shared/types.ts';
import { unit } from './tree-selection.ts';

/** Shared permissions use only the citizen's projected roster. */
export function settlementOwners(o: DecisionObservation): Set<string> {
  const owners = new Set([o.citizen.id]);
  for (const t of o.territories ?? []) if (t.members[o.citizen.id])
    for (const id of Object.keys(t.members)) owners.add(id);
  return owners;
}
/** Houses are a separate projected collection, never hidden tile occupancy. */
export function settlementOccupancy(o: DecisionObservation, tile: DecisionObservation['visible'][number]): { foreign: boolean; shared: boolean; empty: boolean } {
  const owners = settlementOwners(o);
  const structures = [...tile.buildings, ...(o.houses ?? []).filter(h => h.x === tile.x && h.y === tile.y)];
  return {
    foreign: structures.some(b => !!b.ownerId && !owners.has(b.ownerId)),
    shared: structures.some(b => !!b.ownerId && owners.has(b.ownerId)),
    empty: !structures.length && !tile.deposits.length,
  };
}
export function settlementClaimEligible(o: DecisionObservation, tile: DecisionObservation['visible'][number]): boolean {
  const size = o.mapSize;
  return (!size || (tile.x >= 0 && tile.y >= 0 && tile.x < size.width && tile.y < size.height)) &&
    !(o.signs ?? []).some(s => s.x === tile.x && s.y === tile.y) &&
    !(o.claims ?? []).some(c => c.expiresTick > o.tick && tile.x >= c.areas[0] && tile.y >= c.areas[1] && tile.x <= c.areas[2] && tile.y <= c.areas[3]) &&
    !settlementOccupancy(o, tile).foreign;
}
/** Two known usable tiles per member is the bounded settlement-space target.
 * Resource-only ground is not housing/production capacity. Only dated known
 * marked tiles count, with current visible evidence superseding memory. */
export function territoryLandPressure(o: DecisionObservation, territoryId: string): number {
  const territory = o.territories?.find(t => t.id === territoryId && t.members[o.citizen.id]);
  if (!territory) return 0;
  const members = Object.keys(territory.members).length;
  const tiles = new Map([...o.remembered, ...o.visible].filter(t => t.seenTick <= o.tick).map(t => [`${t.x},${t.y}`, t]));
  const visible = new Set(o.visible.map(t => `${t.x},${t.y}`));
  const marks = new Set((o.signs ?? []).filter(s => s.territoryId === territoryId).map(s => `${s.x},${s.y}`));
  let capacity = 0;
  for (const [key, tile] of tiles) {
    // Current sign evidence wins, including visible absence. Remote evidence
    // is dated with the tile, never refreshed from authoritative remote marks.
    if (visible.has(key) ? !marks.has(key) : tile.observedTerritoryId !== territoryId) continue;
    const occupancy = settlementOccupancy(o, tile);
    if (!occupancy.foreign && (occupancy.shared || occupancy.empty)) capacity++;
  }
  return members ? Math.max(0, Math.min(1, 1 - capacity / (2 * members))) : 0;
}

export function foreignMark(o: DecisionObservation, p: Point): boolean {
  return (o.signs ?? []).some(s => s.x === p.x && s.y === p.y &&
    !(o.territories ?? []).some(t => t.id === s.territoryId && t.members[o.citizen.id]));
}
/** Finite preference: twelve tiles of travel outweigh shared marked land. */
export function settlementSiteCost(o: DecisionObservation, p: Point): number {
  const shared = (o.signs ?? []).some(s => s.x === p.x && s.y === p.y &&
    (o.territories ?? []).some(t => t.id === s.territoryId && t.members[o.citizen.id]));
  return Math.hypot(p.x - o.citizen.x, p.y - o.citizen.y) - (shared ? 12 : 0);
}

/** Task-prepared citizen-relative values (not tier rank or guaranteed future yield).
 * Eligibility includes permissions, boundaries and prerequisites supplied by task guards.
 * Risk and values must be grounded in the dated citizen evidence, not spectator state. */
export interface SpatialSite extends Point {
  id: string; eligible: boolean; immediate: number; future: number; strategic: number;
  risk: number; evidenceTick: number;
  /** Optional known route length; otherwise straight-line distance is only a heuristic. */
  travelDistance?: number;
}
export interface SpatialComponents {
  id: string; immediate: number; future: number; strategic: number; travel: number; risk: number;
  evidenceTick: number;
}
export interface SpatialWeights { immediate: number; future: number; strategic: number; travel: number; risk: number }
/** No map traversal: only known eligible candidate tiles are evaluated. No market-location bonus. */
export function spatialComponents(observation: Pick<DecisionObservation, 'citizen' | 'visible' | 'remembered' | 'tick'>, sites: readonly SpatialSite[], travelScale = 10): SpatialComponents[] {
  const known = new Map<string, number>();
  for (const tile of [...observation.remembered, ...observation.visible]) {
    if (tile.seenTick <= observation.tick) known.set(`${tile.x},${tile.y}`, Math.max(known.get(`${tile.x},${tile.y}`) ?? -1, tile.seenTick));
  }
  return sites.filter(site => site.eligible && Number.isFinite(site.evidenceTick) && site.evidenceTick >= 0 && site.evidenceTick <= (known.get(`${site.x},${site.y}`) ?? -1)).map(site => {
    const distance = site.travelDistance !== undefined && Number.isFinite(site.travelDistance) && site.travelDistance >= 0
      ? site.travelDistance : Math.hypot(site.x - observation.citizen.x, site.y - observation.citizen.y);
    return { id: site.id, immediate: unit(site.immediate), future: unit(site.future), strategic: unit(site.strategic), risk: unit(site.risk), travel: unit(distance / (Number.isFinite(travelScale) && travelScale > 0 ? travelScale : 10)), evidenceTick: site.evidenceTick };
  });
}
/** A normalized contextual desirability, not a forecast probability or success guarantee. */
export function scoreSpatialSite(site: SpatialComponents, weights: SpatialWeights): number {
  const total = unit(weights.immediate) + unit(weights.future) + unit(weights.strategic) + unit(weights.travel) + unit(weights.risk);
  if (!total) return 0;
  return (unit(site.immediate) * unit(weights.immediate) + unit(site.future) * unit(weights.future) + unit(site.strategic) * unit(weights.strategic) + (1 - unit(site.travel)) * unit(weights.travel) + (1 - unit(site.risk)) * unit(weights.risk)) / total;
}
