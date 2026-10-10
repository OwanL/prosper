import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/world/core.ts';
import { updateKnowledge } from '../src/world/observation.ts';
import { projectSpectatorWorld } from '../src/server/snapshot.ts';
import { validateCheckpoint } from '../src/server/checkpoint.ts';
import { event } from '../src/shared/utils.ts';
import { ensureTelemetry } from '../src/world/telemetry.ts';

describe('spectator transport projection', () => {
  it('retains consequential events when a hundred citizens fill the mundane ring between polls', () => {
    const world = createWorld({ population: 100, autonomy: true });
    const story = event(world, 'attack', 'A witnessed attack', {
      citizenId: Object.keys(world.citizens)[0],
      x: 1,
      y: 1,
    });
    for (let i = 0; i < 1000; i++) event(world, 'completion', 'Routine work completed');
    expect(world.events).not.toContainEqual(story);
    expect(projectSpectatorWorld(world).events).toContainEqual(story);
    for (let i = 0; i < 300; i++) event(world, 'trade', 'An actual trade');
    expect(world.significantEvents?.length).toBeLessThanOrEqual(256);
    expect(projectSpectatorWorld(world).events).toContainEqual(story);
  });
  it('omits 100 citizens notebooks before cloning while retaining scenes, dossiers and full checkpoint data', () => {
    const world = createWorld({ seed: 3, population: 100, autonomy: true });
    updateKnowledge(world);
    for (const citizen of Object.values(world.citizens))
      for (let i = 0; i < 300; i++) {
        const x = i % world.width,
          y = Math.floor(i / world.width);
        citizen.knowledge[`${x},${y}`] = {
          x,
          y,
          seenTick: 0,
          citizens: [],
          buildings: [],
          deposits: [],
          loot: [],
        };
      }
    const original = JSON.stringify(world);
    const projection = projectSpectatorWorld(world);
    const fullBytes = Buffer.byteLength(original);
    const transportBytes = Buffer.byteLength(JSON.stringify(projection));
    expect(transportBytes).toBeLessThan(fullBytes * 0.2);
    expect(transportBytes).toBeLessThan(1500000);
    expect(
      Object.values(projection.citizens).every((c) => Object.keys(c.knowledge).length === 0),
    ).toBe(true);
    expect(projection.deposits).toEqual(world.deposits);
    expect(projection.events).toEqual(world.events);
    const first = Object.keys(world.citizens)[0];
    expect(projection.citizens[first].autonomy).toEqual(world.citizens[first].autonomy);
    projection.citizens[first].inventory['food:1'] = 999;
    projection.citizens[first].autonomy!.policy.aggression = 0.99;
    expect(JSON.stringify(world)).toBe(original);
    const checkpoint = validateCheckpoint({
      version: 1,
      savedAt: new Date().toISOString(),
      world,
      runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] },
    });
    expect(Object.keys(checkpoint.world.citizens[first].knowledge).length).toBeGreaterThanOrEqual(
      300,
    );
  });

  it('omits telemetry before cloning, leaving the persisted history unchanged', () => {
    const world = createWorld();
    ensureTelemetry(world);
    const history = world.telemetry;
    Object.defineProperty(history, 'cloneTrap', {
      value: () => { throw new Error('Telemetry must not be cloned'); }, enumerable: true,
    });
    expect(() => projectSpectatorWorld(world)).not.toThrow();
    expect(projectSpectatorWorld(world)).not.toHaveProperty('telemetry');
    expect(world.telemetry).toBe(history);
  });

  it('rejects accidentally captured citizen state inside persisted path points', () => {
    const world = createWorld();
    const citizen = Object.values(world.citizens)[0];
    citizen.action = {
      id: 'action-invalid',
      command: { type: 'move', x: citizen.x, y: citizen.y },
      phase: 'travel',
      startedTick: 0,
      elapsed: 0,
      duration: 2,
      reserved: {},
      target: { x: citizen.x, y: citizen.y },
      path: [
        { x: citizen.x, y: citizen.y, knowledge: citizen.knowledge } as { x: number; y: number },
      ],
    };
    expect(() =>
      validateCheckpoint({
        version: 1,
        savedAt: new Date().toISOString(),
        world,
        runtime: { running: false, speed: 1, mode: 'scripted', commandSequence: 0, recorded: [] },
      }),
    ).toThrow();
  });
});
