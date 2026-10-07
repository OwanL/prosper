import { ADULT_HUNGER_PER_TICK, CHILD_HUNGER_PER_TICK, STARVATION_DAMAGE_PER_TICK } from './economy.mjs';

export const hasNoMeal = citizen => (citizen.food ?? 0) <= 0 && (citizen.bread ?? 0) <= 0;

export function foodUrgency(citizen) {
  if (!hasNoMeal(citizen)) return { state: 'meal_available', note: 'Food or bread is already held; meals are automatic when needed.' };
  const rate = citizen.adult === false ? CHILD_HUNGER_PER_TICK : ADULT_HUNGER_PER_TICK;
  const starvationInTicks = Math.max(0, Math.ceil((100 - citizen.hunger) / rate));
  return { state: citizen.hunger >= 100 ? 'starvation' : 'no_meal', starvationInTicks,
    fatalHungerInTicks: starvationInTicks + Math.ceil(citizen.health / STARVATION_DAMAGE_PER_TICK),
    note: 'Approximate current clock without new meals, healing or other harm. Time passes during reasoning; resource yield and promised help are uncertain.' };
}
export const survivalUrgent = citizen => (hasNoMeal(citizen) && citizen.hunger >= 75) || citizen.health < 50;

// Compare against the last reviewed state, not every tick. Normal hunger and
// small fluctuations must not generate a new turn or endless context refreshes.
export function survivalDeteriorated(previous, current) {
  if (!survivalUrgent(current)) return false;
  if (!previous || current.health <= previous.health - 10) return true;
  return hasNoMeal(current) && (!hasNoMeal(previous)
    || [75, 90, 100].some(threshold => current.hunger >= threshold && previous.hunger < threshold));
}

// A deteriorating clock should not livelock an explicitly chosen immediate
// food response. This does not choose food, alter a plan or acknowledge mail.
export function immediateFoodWork(plan, citizen) {
  if (plan.mode === 'continue' && citizen.planBlocked) return false;
  const task = plan.mode === 'continue' ? citizen.order?.task ?? citizen.tasks?.[0] ?? citizen.work
    : plan.tasks?.[0] ?? plan.work;
  return ['collect', 'ensure_inventory', 'gather', 'acquire'].includes(task?.type) && task.resource === 'food';
}

