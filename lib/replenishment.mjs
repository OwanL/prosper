// A nominal estimate from a personally witnessed depletion, never live remote
// regrowth. A due/past estimate does not say that stock is still available.
export function replenishmentEstimate(node, tick) {
  if (node.stock > 0 || !Number.isSafeInteger(node.witnessedDepletionAt) || node.witnessedDepletionAt < 0
    || !Number.isSafeInteger(node.observedAt) || !Number.isSafeInteger(tick) || tick < node.observedAt
    || !Number.isSafeInteger(node.regrowTicks) || node.regrowTicks < 1) return null;
  const dueAt = node.witnessedDepletionAt + node.regrowTicks;
  if (!Number.isSafeInteger(dueAt) || node.witnessedDepletionAt > node.observedAt || dueAt <= node.observedAt) return null;
  return { witnessedAt: node.witnessedDepletionAt, nominalDueAt: dueAt, ticksUntilNominalGrowth: Math.max(0, dueAt - tick) };
}

export function estimatedRecheckDelay(node, tick) {
  if (node.stock > 0) return 0;
  const estimate = replenishmentEstimate(node, tick);
  if (estimate) return estimate.ticksUntilNominalGrowth;
  // Without a witnessed drop, a nominal cycle after an empty sighting is only
  // a conservative recheck deadline, not the time harvesting occurred.
  return Math.max(0, (node.regrowTicks || (node.kind === 'tree' ? 120 : 99)) - Math.max(0, tick - node.observedAt));
}
