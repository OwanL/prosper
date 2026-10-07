import { EQUIPMENT } from './equipment.mjs';
// Stock is harvest opportunities (0/1), not item count. A tree yields a bundle.
export const VISION_RADIUS = 3;
export const CRAFT_COSTS = Object.fromEntries(Object.entries(EQUIPMENT).map(([item, levels]) => [item, levels[1].cost]));
export const BIRTH_FOOD_COST = 2;
export const BIRTH_MIN_HEALTH = 50;
export const ADULT_HUNGER_PER_TICK = 0.25;
export const CHILD_HUNGER_PER_TICK = 0.15;
export const STARVATION_DAMAGE_PER_TICK = 0.5;
export const FOOD_HARVEST_TICKS = 6;
export const WOOD_HARVEST_TICKS = 8;
export const FOOD_REGROW_TICKS = 99;
export const WOOD_REGROW_TICKS = 120;
export const WOOD_YIELD = 5;
export const SHOES_SPEED = EQUIPMENT.shoes[1].speed;

// Bakery constants; the bake recipe itself is 1 food + 1 wood -> 1 bread.
export const BAKERY_COST = 50;
export const BAKERY_HEALTH = 240;
export const BUILD_TICKS = 30;
export const BAKE_TICKS = 8;
export const REPAIR_TICKS = 4;
export const BREAD_NUTRITION = 87.5;

export const NODE_SEEDS = [
  [2, 1], [6, 1], [10, 1], [14, 2], [1, 4], [5, 4],
  [10, 4], [14, 5], [2, 8], [6, 8], [10, 8], [14, 9],
].map(([x, y], i) => ({ id: `crop-${i + 1}`, kind: 'crop', x, y, capacity: 1, yield: 1, regrowTicks: FOOD_REGROW_TICKS }))
  .concat([[4, 0], [12, 0], [3, 3], [12, 3], [3, 6], [11, 6], [5, 9], [15, 8]]
    .map(([x, y], i) => ({ id: `tree-${i + 1}`, kind: 'tree', x, y, capacity: 1, yield: WOOD_YIELD, regrowTicks: WOOD_REGROW_TICKS })));

// The original settlement forms the inner ring. New sites occupy the outer band.
export const RING_NODE_SEEDS = NODE_SEEDS.map(node => ({ ...node, x: node.x + 2, y: node.y + 3 }))
  .concat([[2, 1], [5, 1], [1, 6], [14, 1], [17, 1], [18, 6],
    [1, 10], [2, 14], [5, 14], [18, 10], [14, 14], [17, 14]]
    .map(([x, y], i) => ({ id: `crop-${i + 13}`, kind: 'crop', x, y, capacity: 1, yield: 1, regrowTicks: FOOD_REGROW_TICKS })))
  .concat([[4, 2], [0, 5], [15, 2], [19, 5], [0, 11], [4, 13], [19, 11], [15, 13]]
    .map(([x, y], i) => ({ id: `tree-${i + 9}`, kind: 'tree', x, y, capacity: 1, yield: WOOD_YIELD, regrowTicks: WOOD_REGROW_TICKS })));

// Perfect no-travel harvest cycle: 12 crops / (99 regrowth + 6 harvest) * 140 food-ticks/adult = 16 adults.
export const FOOD_IDEAL_PER_MINUTE = 12 * 60 / (FOOD_REGROW_TICKS + FOOD_HARVEST_TICKS);
export const ADULT_FOOD_PER_MINUTE = ADULT_HUNGER_PER_TICK * 60 / 35;

// Scarcity is spatial and gradual, not a change to hunger or survival rules.
// One stocked opportunity yields a bundle; capacity remains one at every level.
export const RESOURCE_LEVELS = {
  1: { cropYield: 1, woodYield: 5 },
  2: { cropYield: 2, woodYield: 10 },
  3: { cropYield: 3, woodYield: 15 },
};
const gradedNode = (kind, x, y, level, index) => ({ id: `${kind}-${index + 1}`, kind, x, y, level, capacity: 1,
  yield: RESOURCE_LEVELS[level][kind === 'crop' ? 'cropYield' : 'woodYield'],
  regrowTicks: kind === 'crop' ? FOOD_REGROW_TICKS : WOOD_REGROW_TICKS });
export const GRADED_NODE_SEEDS = [
  [6, 9, 3], [13, 6, 3],
  [5, 5, 2], [14, 10, 2],
  [2, 1, 1], [1, 6, 1], [17, 1, 1], [18, 6, 1],
  [2, 14, 1], [1, 10, 1], [17, 14, 1], [18, 10, 1],
].map(([x, y, level], i) => gradedNode('crop', x, y, level, i)).concat([
  [8, 7, 3], [11, 7, 3],
  [6, 4, 2], [13, 11, 2],
  [3, 1, 1], [1, 4, 1], [16, 1, 1], [3, 14, 1], [16, 14, 1], [18, 12, 1],
].map(([x, y, level], i) => gradedNode('tree', x, y, level, i)));

export function economyForNodes(nodes) {
  const idealRate = (kind, work) => nodes.filter(n => n.kind === kind)
    .reduce((sum, n) => sum + 60 * (n.yield ?? (kind === 'tree' ? WOOD_YIELD : 1))
      / ((n.regrowTicks ?? (kind === 'tree' ? WOOD_REGROW_TICKS : FOOD_REGROW_TICKS)) + work), 0);
  const foodPerMinute = idealRate('crop', FOOD_HARVEST_TICKS);
  return { foodPerMinute, woodPerMinute: idealRate('tree', WOOD_HARVEST_TICKS),
    adultFoodPerMinute: ADULT_FOOD_PER_MINUTE, idealAdults: Number((foodPerMinute / ADULT_FOOD_PER_MINUTE).toFixed(12)) };
}
