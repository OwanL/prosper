// Spectator-only movement evidence. Never part of citizen planning knowledge.
export function recordMotion(citizen, previous, tick) {
  const points = citizen.motion ?? [];
  const last = points.at(-1);
  if (!last || last.x !== previous.x || last.y !== previous.y || last.tick > tick) points.length = 0;
  const startTick = Math.ceil(tick) - 1;
  if (!points.length || points.at(-1).tick < startTick) points.push({ tick: startTick, ...previous });
  points.push({ tick, x: citizen.x, y: citizen.y });
  citizen.motion = points.slice(-32);
}
