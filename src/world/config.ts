import type { BuildingKind, ToolKind, Inventory, Resource, Tier } from '../shared/types.ts';
import { itemKey } from '../shared/utils.ts';
import { RING_COUNT, MAX_TIER, TIERS, isTier } from '../shared/tiers.ts';

const tierTable = (value: (tier: number) => number): Record<number, number> =>
  Object.fromEntries(TIERS.map((tier) => [tier, value(tier)]));

// One tick is simulation time, never wall-clock time. Without food, fullness lasts
// 2,000 ticks and starvation takes another 500: ample time for travel and gathering.
export const BALANCE = {
  // Keep each additional band traversable and the central sectors large enough.
  width: 6 * RING_COUNT + 1,
  height: 6 * RING_COUNT + 1,
  initialCitizens: 20,
  startingGold: 100,
  startingFood: 3,
  maxHealth: 100,
  maxFullness: 100,
  fullnessDrain: 0.05,
  starvationDamage: 0.2,
  healing: 0.05,
  moveTicks: 2,
  // A barehanded harvest occupies ten simulated seconds at normal 4 Hz.
  // Better tools help, but never turn resource extraction into a one-tick tap.
  harvestTicks: 40,
  minimumHarvestTicks: 12,
  craftTicks: 8,
  buildTicks: 16,
  depositCapacity: 1,
  regrowTicks: 120,
  refineTicks: tierTable((tier) => tier === 1 ? 9 : Math.max(1, Math.ceil(12 / 2 ** (tier - 1)))),
  buildingHealth: tierTable((tier) => 10 * tier ** 2 + 50 * tier + 40),
  // Ordinary strikes allow several reaction windows, even against a T3 sword.
  sightRadius: 3,
  attackTicks: 8,
  attackDamage: { 0: 8, ...tierTable((tier) => 6 * tier + 6) } as Record<number, number>,
  lootTicks: 4,
  salvageFraction: 0.75,
  // Each parent pays 100 potential fullness; the child starts with only 60.
  reproductionFoodTier: 1,
  reproductionFood: 1,
  reproductionHealth: 75,
  reproductionTicks: 24,
  reproductionCooldown: 1_000,
  consentTicks: 2_400,
  newbornHealth: 100,
  newbornFullness: 60,
  queueLimit: 12,
  messageLength: 500,
  messagesPerWindow: 3,
  messageWindow: 10,
  messageHistory: 200,
  memoryLength: 600,
  memoryLimit: 20,
  goalLimit: 8,
  goalLength: 200,
} as const;

/** Provisional composed-world balance; fractions are finite JS numbers with 1e-9 conservation tolerance. */
export const COMPOSED_BALANCE = {
  quantityEpsilon: 1e-9, territoryWoodPerTile: 2, territoryTaxRate: 0.15,
  signHealth: 16, signAttackTicks: 8, signRecoveryFraction: 0.5,
  admissionTimeoutTicks: 120, offenseCooldownTicks: 120, maxTerritoryTilesPerCommand: 64,
  directorIntervalTicks: 2400, maxRest: 100, restDrain: 0.1,
  fatigueThreshold: 20, fatigueDurationMultiplier: 1.5, outdoorRestPerTick: 2,
  houseRestPerTick: 4, sleepMinimumTicks: 8,
} as const;
export function houseRecipe(tier: Tier): Inventory {
  return { [itemKey('wood', tier)]: 2 * 2 ** (tier - 1), [itemKey('fibre', tier)]: 2 ** (tier - 1) };
}

export const RESOURCES: readonly Resource[] = ['wood', 'food', 'fibre'];
/** Tool kinds are carried inventory items, automatically selected when used. */
export const EQUIPMENT: readonly ToolKind[] = ['axe', 'scythe', 'knife', 'sword'];
export const BUILDINGS: readonly BuildingKind[] = [
  'lumbermill',
  'spinning-wheel',
  'butchery',
  'wall',
];
export const MATCHING_TOOL: Record<Resource, ToolKind> = {
  wood: 'axe',
  fibre: 'scythe',
  food: 'knife',
};
export const STATION_RESOURCE: Partial<Record<BuildingKind, Resource>> = {
  lumbermill: 'wood',
  'spinning-wheel': 'fibre',
  butchery: 'food',
};

export function equipmentRecipe(kind: ToolKind, tier: Tier): Inventory {
  const amounts: Record<ToolKind, Partial<Record<Resource, number>>> = {
    axe: { food: 3, fibre: 3 },
    scythe: { wood: 3, food: 3 },
    knife: { wood: 3, fibre: 3 },
    sword: { wood: 4, fibre: 4 },
  };
  return Object.fromEntries(
    Object.entries(amounts[kind]).map(([resource, n]) => [itemKey(resource, tier), n * 2 ** (tier - 1)]),
  );
}

// Every station is buildable at its own input tier; no circular prerequisites.
export function buildingRecipe(kind: BuildingKind, tier: Tier): Inventory {
  const amounts = kind === 'wall' ? { wood: 4, fibre: 2 } : { wood: 6, fibre: 4 };
  return Object.fromEntries(
    Object.entries(amounts).map(([resource, n]) => [itemKey(resource, tier), n * 2 ** (tier - 1)]),
  );
}
export function canRefine(stationTier: Tier, fromTier: Tier, direction: 'up' | 'down' = 'up'): boolean {
  if (!isTier(stationTier) || !isTier(fromTier)) return false;
  return direction === 'up'
    ? fromTier < MAX_TIER && fromTier <= stationTier
    : direction === 'down' && fromTier > 1 && fromTier - 1 <= stationTier;
}
export function refinementRecipe(resource: Resource, fromTier: Tier, direction: 'up' | 'down' = 'up'): Inventory {
  return { [itemKey(resource, fromTier)]: direction === 'down' ? 1 : 3 };
}
export function refinementOutput(resource: Resource, fromTier: Tier, direction: 'up' | 'down' = 'up'): Inventory {
  return { [itemKey(resource, fromTier + (direction === 'down' ? -1 : 1))]: direction === 'down' ? 2 : 1 };
}
export function nutrition(tier: Tier): number {
  return BALANCE.maxFullness / (tier === 1 ? 9 : tier === 2 ? 3 : 1);
}
export function harvestDuration(depositTier: Tier, toolTier: number): number {
  return Math.max(BALANCE.minimumHarvestTicks, Math.ceil(BALANCE.harvestTicks * 2 ** (depositTier - 1 - toolTier)));
}
