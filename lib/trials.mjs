import { createSimulation } from './simulation.mjs';

// Deterministic virtual clock; model latency does not advance simulated time.
// This isolates decision/execution differences and is not real-time performance.
export async function runTrial({ world, planner, ticks = 800, speed = 8 }) {
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > 10000 || ![1, 3, 8].includes(speed)) throw new Error('Invalid trial duration/speed');
  let now = 0;
  const pending = new Set();
  const completed = {}, failures = {}, partners = new Set();
  const client = { ...planner, audit: { record(event) {
    if (event.type === 'action_result') {
      if (event.status === 'completed') {
        completed[event.task.type] = (completed[event.task.type] ?? 0) + 1;
        if (event.task.target && ['message', 'give', 'reproduce', 'propose_family'].includes(event.task.type)) partners.add([event.citizenId, event.task.target].sort().join(':'));
      } else failures[event.reason] = (failures[event.reason] ?? 0) + 1;
    }
    planner.audit?.record(event);
  } }, plan(...args) {
    const promise = Promise.resolve().then(() => planner.plan(...args));
    pending.add(promise);
    promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  } };
  const simulation = createSimulation(client, { now: () => now });
  Object.assign(simulation.state.world, structuredClone(world));
  for (const citizen of simulation.state.world.citizens) citizen.planning = false;
  const before = { ...world.stats };
  const drain = async () => {
    while (pending.size) await Promise.allSettled([...pending]);
    await Promise.resolve();
  };
  try {
    await simulation.check();
    if (simulation.state.planner.connection !== 'ready') throw new Error('Trial model unavailable');
    simulation.control('speed', speed);
    simulation.control('play');
    await drain();
    for (let i = 0; i < ticks && simulation.state.running; i++) {
      now += 1000 / speed;
      simulation.advance(1 / speed);
      await drain();
    }
    simulation.control('pause');
    const state = simulation.state;
    return {
      clock: 'virtual, zero simulated model latency', startTick: world.tick, endTick: state.world.tick,
      speed, requests: state.planner.requests, accepted: state.planner.completed, rejected: state.planner.failed,
      error: state.planner.connection === 'error' ? state.planner.lastError : null,
      completedOrders: completed, failedOrders: failures, distinctTargetedPairs: partners.size,
      statsDelta: Object.fromEntries(Object.entries(state.world.stats).map(([key, value]) => [key, value - (before[key] ?? 0)])),
      citizens: state.world.citizens.map(c => ({ id: c.id, health: c.health, hunger: c.hunger, food: c.food, wood: c.wood, undertaking: c.undertaking ?? null })),
      finalWorld: structuredClone(state.world),
    };
  } finally {
    simulation.close();
  }
}
