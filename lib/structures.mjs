import { BAKERY_COST, BAKERY_HEALTH, BUILD_TICKS } from './economy.mjs';

export const STRUCTURES = {
  bakery: { wood: BAKERY_COST, health: BAKERY_HEALTH, ticks: BUILD_TICKS },
  wall: { wood: 15, health: 120, ticks: 10 },
  house: { wood: 60, health: 180, ticks: 30 },
};
export const SALVAGE_FRACTION = 0.6;
export const salvageWood = building => Math.floor((building.woodCost ?? STRUCTURES[building.kind].wood) * SALVAGE_FRACTION);
export const livingStructure = b => b && b.health > 0 && b.destroyed !== true;
export const structureId = id => typeof id === 'string' && /^(?:bakery|wall|house)-[1-9]\d*$/.test(id);
export const HOUSE_REST_MULTIPLIER = 4;
export function houseRestMultiplier(world, citizen) {
  return (world.buildings ?? []).some(b => b.kind === 'house' && livingStructure(b) && b.ownerId === citizen.id
    && b.x === citizen.x && b.y === citizen.y) ? HOUSE_REST_MULTIPLIER : 1;
}
export const wallTile = (task, index = 0) => ({ x: task.x + (task.axis === 'horizontal' ? index : 0),
  y: task.y + (task.axis === 'vertical' ? index : 0) });
