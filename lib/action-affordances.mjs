import { EQUIPMENT, equipmentLevel } from './equipment.mjs';
import { BAKERY_COST, BUILD_TICKS, BAKE_TICKS, BREAD_NUTRITION } from './economy.mjs';
import { knownBuildings } from './knowledge.mjs';
import { ownInteractionRequirements } from './action-requirements.mjs';

// Compact mechanical facts, used by explicit mechanics queries and experiments.
// These are options, not selected goals.
// Own goods and personally remembered sites only; no peer inventories or plans.
export function actionAffordances(world, citizenId, { actionTemplates = false } = {}) {
  const citizen = world.citizens.find(c => c.id === citizenId);
  if (!citizen) throw new Error('Citizen unavailable.');
  const upgrades = Object.keys(EQUIPMENT).flatMap(item => {
    const currentLevel = equipmentLevel(citizen, item), level = currentLevel + 1;
    const next = EQUIPMENT[item][level];
    if (!next) return [];
    const { cost, ...effect } = next;
    return [actionTemplates
      ? { directive: { type: 'craft', item, level }, wood: cost, craftTicks: 4, gathersMissingWood: true, effect }
      : { item, level, wood: cost, missingWood: Math.max(0, cost - citizen.wood), craftTicks: 4, effect }];
  });
  const task = citizen.order?.task ?? citizen.tasks[0] ?? citizen.work;
  const ownedBakeries = knownBuildings(citizen).filter(b => b.kind === 'bakery' && b.ownerId === citizen.id && b.health > 0);
  const ownedBakery = ownedBakeries.length > 0;
  const offer = task?.type === 'trade' ? world.offers.find(o => o.id === task.offer && o.status === 'open'
    && o.expiresAt > world.tick && o.makerId !== citizen.id && (o.recipient === null || o.recipient === citizen.id)) : null;
  const requirements = task && (task.type !== 'trade' || offer) ? ownInteractionRequirements(citizen, task, offer) : null;
  return {
    upgrades,
    bakeryBuild: actionTemplates
      ? { directive: { type: 'build', building: 'bakery' }, wood: BAKERY_COST, buildTicks: BUILD_TICKS, gathersMissingWood: true,
        alreadyOwned: ownedBakeries.length, existing: ownedBakeries.slice(0, 4).map(b => b.id),
        note: 'Extra bakeries do not increase one worker\'s output. Use an existing site unless the new location/access serves a concrete purpose.' }
      : { wood: BAKERY_COST, missingWood: Math.max(0, BAKERY_COST - citizen.wood), buildTicks: BUILD_TICKS },
    ...(actionTemplates || ownedBakery || ['build', 'bake'].includes(task?.type) ? {
      baking: { inputs: { food: 1, wood: 1 }, bakeTicks: BAKE_TICKS, bread: 1,
        hungerRelief: BREAD_NUTRITION, ownerOnly: true },
    } : {}),
    ...(requirements ? { chosenInteraction: { type: task.type, ...requirements,
      missingGoods: Object.fromEntries(Object.entries(requirements.goods).map(([resource, quantity]) => [resource, Math.max(0, quantity - (citizen[resource] ?? 0))])) } } : {}),
    note: actionTemplates
      ? 'Optional directive templates, not selected goals. Choose the directive itself to gather inputs and execute; no separate stockpile is required. You may add area/site choices. Travel/preparation take additional time. Query mechanics for other details.'
      : 'Options and costs, not orders or guaranteed availability. Craft/build/bake and chosen interactions gather missing raw inputs. Travel/preparation time is additional; query mechanics for other details.',
  };
}
