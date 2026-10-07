import type { BuildingKind, EquipmentKind, Inventory, Resource, Tier } from '../shared/types.ts';
import { itemKey } from '../shared/utils.ts';

// One tick is simulation time, never wall-clock time. Without food, fullness lasts
// 1,000 ticks and starvation takes another 500: ample time for travel and gathering.
export const BALANCE = {
  width: 21,
  height: 21,
  initialCitizens: 6,
  startingGold: 100,
  startingFood: 3,
  maxHealth: 100,
  maxFullness: 100,
  fullnessDrain: 0.1,
  starvationDamage: 0.2,
  healing: 0.05,
  moveTicks: 2,
  harvestTicks: 8,
  craftTicks: 8,
  buildTicks: 16,
  depositCapacity: 1,
  regrowTicks: 24,
  refineTicks: { 1: 9, 2: 6, 3: 3 },
  buildingHealth: { 1: 100, 2: 180, 3: 280 },
  // Ordinary strikes allow several reaction windows, even against a T3 sword.
  sightRadius: 3,
  attackTicks: 8,
  attackDamage: { 0: 8, 1: 12, 2: 18, 3: 24 },
  lootTicks: 4,
  salvageFraction: 0.75,
  // Each parent pays 100 potential fullness; the child starts with only 60.
  reproductionFoodTier: 2,
  reproductionFood: 3,
  reproductionHealth: 75,
  reproductionTicks: 24,
  reproductionCooldown: 1_000,
  consentTicks: 100,
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

export const RESOURCES: readonly Resource[] = ['wood', 'food', 'fibre'];
export const EQUIPMENT: readonly EquipmentKind[] = ['axe', 'scythe', 'knife', 'sword'];
export const BUILDINGS: readonly BuildingKind[] = [
  'lumbermill',
  'spinning-wheel',
  'butchery',
  'wall',
];
export const MATCHING_TOOL: Record<Resource, EquipmentKind> = {
  wood: 'axe',
  fibre: 'scythe',
  food: 'knife',
};
export const STATION_RESOURCE: Partial<Record<BuildingKind, Resource>> = {
  lumbermill: 'wood',
  'spinning-wheel': 'fibre',
  butchery: 'food',
};

export function equipmentRecipe(kind: EquipmentKind, tier: Tier): Inventory {
  const amounts: Record<EquipmentKind, Partial<Record<Resource, number>>> = {
    axe: { food: 3, fibre: 3 },
    scythe: { wood: 3, food: 3 },
    knife: { wood: 3, fibre: 3 },
    sword: { wood: 4, fibre: 4 },
  };
  return Object.fromEntries(
    Object.entries(amounts[kind]).map(([resource, n]) => [itemKey(resource, tier), n]),
  );
}

// Every station is buildable at its own input tier; no circular prerequisites.
export function buildingRecipe(kind: BuildingKind, tier: Tier): Inventory {
  const amounts = kind === 'wall' ? { wood: 4, fibre: 2 } : { wood: 6, fibre: 4 };
  return Object.fromEntries(
    Object.entries(amounts).map(([resource, n]) => [itemKey(resource, tier), n]),
  );
}
export function nutrition(tier: Tier): number {
  return BALANCE.maxFullness / (tier === 1 ? 9 : tier === 2 ? 3 : 1);
}
export function harvestDuration(depositTier: Tier, toolTier: number): number {
  return Math.max(1, Math.ceil(BALANCE.harvestTicks * 2 ** (depositTier - 1 - toolTier)));
}
