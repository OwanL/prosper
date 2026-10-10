/** Change this number to change fresh-world bands and the entire tier progression. */
export const RING_COUNT = 6;

export function tierConfiguration(ringCount: number) {
  if (!Number.isSafeInteger(ringCount) || ringCount < 1)
    throw new Error('Ring count must be a positive integer.');
  // The center normally yields ringCount, and can rarely yield ringCount + 1.
  const maxTier = ringCount + 1;
  const tiers = Array.from({ length: maxTier }, (_, i) => i + 1);
  const tierPattern = `(?:${tiers.join('|')})`;
  const carriedItemPattern = `^(food|wood|fibre|axe|scythe|knife|sword):${tierPattern}$`;
  const equipmentItemPattern = `^(axe|scythe|knife|sword):${tierPattern}$`;
  const resourceItemPattern = `^(food|wood|fibre):${tierPattern}$`;
  const tradableItemPattern = `${carriedItemPattern}|^building:[\\w-]+$`;
  return { maxTier, tiers, carriedItemPattern, equipmentItemPattern, resourceItemPattern, tradableItemPattern };
}

const configuration = tierConfiguration(RING_COUNT);
export const MAX_TIER = configuration.maxTier;
export const TIERS: readonly number[] = configuration.tiers;
export type Tier = number;
export const CARRIED_ITEM_PATTERN = configuration.carriedItemPattern;
export const EQUIPMENT_ITEM_PATTERN = configuration.equipmentItemPattern;
export const RESOURCE_ITEM_PATTERN = configuration.resourceItemPattern;
export const TRADABLE_ITEM_PATTERN = configuration.tradableItemPattern;
export const CARRIED_ITEM_RE = new RegExp(CARRIED_ITEM_PATTERN);
export const EQUIPMENT_ITEM_RE = new RegExp(EQUIPMENT_ITEM_PATTERN);
export const RESOURCE_ITEM_RE = new RegExp(RESOURCE_ITEM_PATTERN);
export const TRADABLE_ITEM_RE = new RegExp(TRADABLE_ITEM_PATTERN);
export const isTier = (value: number): value is Tier =>
  Number.isInteger(value) && value >= 1 && value <= MAX_TIER;
