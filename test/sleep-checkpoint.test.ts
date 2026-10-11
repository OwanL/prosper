import { expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { validateCheckpoint, type Checkpoint } from '../src/server/checkpoint.ts';
import { composedCommandSchema } from '../src/server/autonomy-checkpoint.ts';

it.each([0.5, 100])('accepts positive sleep checkpoint target %s', (targetRest) => {
  expect(composedCommandSchema.safeParse({ type: 'sleep', targetRest }).success).toBe(true);
});

it.each([0, -1, 100.5, Infinity, NaN])('rejects invalid sleep checkpoint target %s', (targetRest) => {
  expect(composedCommandSchema.safeParse({ type: 'sleep', targetRest }).success).toBe(false);
});

it('checkpoints real sleep work at its estimated duration and completes after restore', () => {
  const world = createWorld({ population: 1, autonomy: false });
  world.controllerMode = 'composed';
  const citizen = Object.values(world.citizens)[0];
  citizen.rest = { value: 20 };
  expect(dispatch(world, citizen.id, { type: 'sleep', targetRest: 85 }).ok).toBe(true);
  const duration = citizen.action!.duration;
  // advanceAction checks rest before sustain applies this tick's rest gain.
  // The target is therefore reached at the end of the estimated final tick,
  // while the action legitimately remains pending until the next tick.
  tickWorld(world, duration);
  expect(citizen.action?.elapsed).toBe(duration);
  const cp: Checkpoint = { version: 1, savedAt: new Date().toISOString(), world,
    runtime: { running: false, decisionTreeDebug: false, speed: 16, mode: 'scripted', commandSequence: 0, recorded: [] } };
  const restored = validateCheckpoint(cp).world;
  expect(restored.citizens[citizen.id].action?.elapsed).toBe(duration);
  const sleepId = restored.citizens[citizen.id].action!.id;
  tickWorld(restored, 1);
  expect(restored.citizens[citizen.id].action?.id).not.toBe(sleepId);
  expect(restored.citizens[citizen.id].rest!.value).toBeGreaterThanOrEqual(85);
  // Constructed legal-state fixture, not a claim that these elapsed/rest values
  // were produced by this run: sleep completion is rest-based, and duration is
  // only an estimate. Keep strictly overdue pending work restorable as well.
  const overdue = structuredClone(cp);
  overdue.world.citizens[citizen.id].action!.elapsed = duration + 1;
  overdue.world.citizens[citizen.id].rest!.value = 20;
  const restoredOverdue = validateCheckpoint(overdue).world;
  expect(restoredOverdue.citizens[citizen.id].action!.elapsed).toBeGreaterThan(duration);
  const overdueSleepId = restoredOverdue.citizens[citizen.id].action!.id;
  for (let ticks = 0; ticks < 100 && restoredOverdue.citizens[citizen.id].action?.id === overdueSleepId; ticks++) tickWorld(restoredOverdue, 1);
  expect(restoredOverdue.citizens[citizen.id].action?.id).not.toBe(overdueSleepId);
  expect(restoredOverdue.citizens[citizen.id].rest!.value).toBeGreaterThanOrEqual(85);
  const invalidTarget = structuredClone(cp);
  invalidTarget.world.citizens[citizen.id].action!.command = { type: 'sleep', targetRest: 0 };
  expect(() => validateCheckpoint(invalidTarget)).toThrow();
  const invalid = structuredClone(cp);
  invalid.world.citizens[citizen.id].action!.command = { type: 'move', x: citizen.x, y: citizen.y };
  expect(() => validateCheckpoint(invalid)).toThrow('action progress/target');
});
