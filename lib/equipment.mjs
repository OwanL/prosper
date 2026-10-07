// Each upgrade pays its listed wood cost and requires the preceding level.
export const EQUIPMENT = {
  tool: [null, { cost: 15, harvestReduction: 1 }, { cost: 60, harvestReduction: 2 }, { cost: 180, harvestReduction: 3 }],
  shoes: [null, { cost: 10, speed: 1.1 }, { cost: 40, speed: 1.4 }, { cost: 120, speed: 1.8 }],
  weapon: [null, { cost: 20, damage: 18, counterDamage: 12, durability: 12 }, { cost: 80, damage: 27, counterDamage: 18, durability: 24 }, { cost: 240, damage: 40, counterDamage: 27, durability: 40 }],
};
export const equipmentLevel = (citizen, item) => citizen[item] ? citizen[`${item}Level`] ?? 1 : 0;
export const equipmentSpec = (citizen, item) => EQUIPMENT[item]?.[equipmentLevel(citizen, item)] ?? null;
export function craftRequirement(citizen, task) {
  const level = task.level ?? 1;
  const spec = EQUIPMENT[task.item]?.[level];
  if (!Number.isInteger(level) || !spec) return { error: 'equipment level must be 1, 2 or 3' };
  const current = equipmentLevel(citizen, task.item);
  if (current >= level) return { error: `already has ${task.item} level ${current}; choose a higher level or rebuild after wear-out` };
  if (level !== current + 1) return { error: `craft ${task.item} level ${current + 1} before level ${level}` };
  return { level, ...spec };
}
export const EQUIPMENT_GUIDANCE = 'craft(item:tool|shoes|weapon,level:1|2|3), default level1. Upgrades require the previous level; pay the full listed wood cost per upgrade, replacing the equipped item. Tool levels cost15/60/180wood and cut harvest time by1/2/3ticks. Shoes cost10/40/120wood and give1.1x/1.4x/1.8x walking speed. Weapons cost20/80/240wood, hit for18/27/40 and counter for12/18/27, lasting12/24/40 armed uses; a broken weapon must be rebuilt from level1. Unarmed hit/counter6/4. Crafting gathers missing wood then takes4ticks. Tool/shoes do not wear out; equipment cannot be traded directly, but inputs can. Compare the upgrade benefit and collection time with other uses of your resources.';
