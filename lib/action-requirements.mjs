import { BIRTH_FOOD_COST, BIRTH_MIN_HEALTH } from './economy.mjs';

// Own mechanical requirements for an explicitly chosen interaction. Never
// inspect a partner's private goods, vitals, goals or intended work.
export function ownInteractionRequirements(citizen, task, offer) {
  if (task.type === 'give') return { goods: { [task.resource]: task.amount } };
  if (task.type === 'trade') return { goods: { [offer.want]: offer.wantAmount } };
  if (task.type === 'reproduce') return {
    goods: { food: Math.max(0, BIRTH_FOOD_COST - Math.min(1, citizen.bread ?? 0) * 2) },
    minimumHealth: BIRTH_MIN_HEALTH,
  };
  return null;
}
