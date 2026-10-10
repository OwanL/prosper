import type { Citizen, ToolKind } from './types.ts';
import { TIERS } from './tiers.ts';

/** Available carried tools only: escrow and reserved inputs are outside inventory. */
export function highestToolTier(citizen: Pick<Citizen, 'inventory'>, kind: ToolKind): number {
  let highest = 0;
  for (const tier of TIERS) {
    if ((citizen.inventory[`${kind}:${tier}`] ?? 0) > 0) highest = Math.max(highest, tier);
  }
  return highest;
}
