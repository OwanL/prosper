const goods = ['food', 'wood', 'bread'];
export function captureStrategyBaseline(citizen, tick) {
  return { tick, inventory: Object.fromEntries(goods.map(key => [key, citizen[key] ?? 0])),
    health: citizen.health, hunger: citizen.hunger, completionRevision: citizen.completedActionRevision ?? 0 };
}
export function strategyProgress(citizen, tick) {
  const baseline = citizen.strategyBaseline;
  if (!baseline) return null;
  return { sinceTick: baseline.tick, elapsedTicks: tick - baseline.tick,
    inventoryChange: Object.fromEntries(goods.map(key => [key, (citizen[key] ?? 0) - baseline.inventory[key]])),
    healthChange: Math.round(citizen.health - baseline.health), hungerChange: Math.round(citizen.hunger - baseline.hunger),
    consequentialCompletions: Math.max(0, (citizen.completedActionRevision ?? 0) - baseline.completionRevision),
    note: 'Inventory is net of meals, gathering and exchanges. These changes are evidence, not proof that your objective succeeded.' };
}
