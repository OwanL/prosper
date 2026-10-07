import { describe, expect, it } from 'vitest';
import type { CitizenObservation, TileMemory } from '../src/shared/types';
import { createWorld } from '../src/world/core';
import { settleDeath } from '../src/world/life';
import {
  occupantOffset,
  progress,
  projectObservation,
  projectWorld,
  screenPoint,
} from '../src/ui/model';

const tile = (x: number, tick: number, stock: number): TileMemory => ({
  x,
  y: 1,
  seenTick: tick,
  citizens: [],
  buildings: [],
  loot: [],
  deposits: [{ id: 'tree', x, y: 1, resource: 'wood', tier: 1, stock, capacity: 10, regrowAt: 0 }],
});
describe('scene projection', () => {
  it('shows natural death as collectible loot, not a permanent duplicate citizen sprite', () => {
    const world = createWorld();
    const citizen = Object.values(world.citizens)[0];
    settleDeath(world, citizen.id);
    const scene = projectWorld(world);
    expect(scene.citizens.some((entry) => entry.value.id === citizen.id)).toBe(false);
    expect(scene.loot).toHaveLength(1);
    world.loot = {}; // after collection, only the historical dossier remains
    expect(projectWorld(world).loot).toHaveLength(0);
  });
  it('flips bottom-left coordinates to SVG centers', () => {
    expect(screenPoint({ x: 0, y: 0 }, 10)).toEqual({ x: 0.5, y: 9.5 });
    expect(screenPoint({ x: 2, y: 9 }, 10)).toEqual({ x: 2.5, y: 0.5 });
  });
  it('offsets shared occupants consistently irrespective of roster order', () => {
    const a = [{ id: 'b' }, { id: 'a' }];
    expect(occupantOffset('a', a)).toEqual(occupantOffset('a', a.toReversed()));
    expect(occupantOffset('a', a)).not.toEqual(occupantOffset('b', a));
    expect(occupantOffset('a', [{ id: 'a' }])).toEqual({ x: 0, y: 0 });
  });
  it('clamps progress without inventing completion', () => {
    expect(progress(3, 10)).toBe(0.3);
    expect(progress(-2, 10)).toBe(0);
    expect(progress(100, 10)).toBe(1);
    expect(progress(0, 0)).toBe(0);
  });
  it('uses dated memory, not spectator stock or hidden citizens', () => {
    const observation = {
      tick: 12,
      visible: [],
      remembered: [tile(1, 4, 2)],
    } as unknown as CitizenObservation;
    const dimensions = {
      width: 10,
      height: 10,
      citizens: { hidden: { name: 'Secret' } },
      deposits: { tree: { stock: 99 } },
    };
    const scene = projectObservation(observation, dimensions);
    expect(scene.citizens).toEqual([]);
    expect(scene.deposits[0]).toMatchObject({ remembered: true, seenTick: 4, value: { stock: 2 } });
    expect(scene).not.toHaveProperty('orders');
  });
  it('replaces a remembered tile with current sight even when the old entity vanished', () => {
    const current = { ...tile(1, 12, 8), deposits: [] };
    const scene = projectObservation(
      {
        tick: 12,
        visible: [current],
        remembered: [tile(1, 4, 2)],
      } as unknown as CitizenObservation,
      { width: 10, height: 10 },
    );
    expect(scene.deposits).toEqual([]);
    expect(scene.tiles).toHaveLength(1);
    expect(scene.tiles?.[0].remembered).toBe(false);
  });
});
