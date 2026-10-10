import { describe, expect, it } from 'vitest';
import type { CitizenObservation, TileMemory } from '../src/shared/types';
import { createWorld } from '../src/world/core';
import { settleDeath } from '../src/world/life';
import { observe } from '../src/world/observation';
import { regionAt as worldRegionAt, ringAt } from '../src/shared/utils';
import {
  occupantOffset,
  progress,
  projectObservation,
  projectWorld,
  screenPoint,
  terrainRegions,
  terrainColor,
  regionAt,
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
  it('carries procedural layout through spectator and personal projections', () => {
    const world = createWorld();
    world.ringCount = 6;
    const citizen = Object.values(world.citizens)[0];
    const observation = observe(world, citizen.id);
    expect(observation.mapSize).toEqual({ width: world.width, height: world.height, ringCount: 6 });
    expect(projectWorld(world).ringCount).toBe(6);
    const scene = projectObservation(observation, { width: 2, height: 3 });
    expect(scene).toMatchObject({ width: world.width, height: world.height, ringCount: 6 });
    expect(scene.citizens.every(({ value }) =>
      observation.visible.some((tile) => tile.citizens.some((c) => c.id === value.id)),
    )).toBe(true);
  });
  it('never borrows spectator ring metadata for legacy observations', () => {
    const dimensions = { width: 10, height: 12, ringCount: 6 };
    const legacy = { tick: 0, visible: [], remembered: [] } as unknown as CitizenObservation;
    expect(projectObservation(legacy, dimensions)).toMatchObject({ width: 10, height: 12 });
    expect(projectObservation(legacy, dimensions).ringCount).toBeUndefined();
    const withSize = { ...legacy, mapSize: { width: 8, height: 9 } };
    expect(projectObservation(withSize, dimensions)).toMatchObject({ width: 8, height: 9 });
    expect(projectObservation(withSize, dimensions).ringCount).toBeUndefined();
    const world = createWorld();
    delete world.ringCount;
    expect(observe(world, Object.keys(world.citizens)[0]).mapSize).not.toHaveProperty('ringCount');
    expect(projectWorld(world).ringCount).toBeUndefined();
  });
  it('renders six equal bands and any configured band count with exact tile classifications', () => {
    for (const ringCount of [1, 6, 9]) {
      for (const [width, height] of [[60, 48], [37, 25], [72, 72]]) {
        const layout = { width, height, ringCount };
        const areas = terrainRegions(width, height, ringCount);
        expect(areas).toHaveLength(ringCount);
        expect(areas.map((area) => area.region)).toEqual(
          Array.from({ length: ringCount }, (_, i) => i === ringCount - 1 ? 'center' : `ring${ringCount - i - 1}`),
        );
        const seen = new Set<string>();
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const painted = areas.filter((area) =>
            x >= area.x && x < area.x + area.width &&
            y >= area.y && y < area.y + area.height,
          ).at(-1)!;
          const expected = worldRegionAt(layout, { x, y });
          expect(painted.region).toBe(expected);
          expect(regionAt(x, y, width, height, ringCount)).toBe(expected);
          expect(terrainColor(painted.region, ringCount)).toBe(terrainColor(expected, ringCount));
          expect(ringAt(layout, { x, y })).toBe(expected === 'center' ? 0 : Number(expected.slice(4)));
          seen.add(expected);
        }
        expect(seen.size).toBe(ringCount);
        expect(new Set(areas.map((area) => terrainColor(area.region, ringCount))).size).toBe(ringCount);
      }
    }
  });
  it('preserves absent-metadata three-band boundaries and colors exactly', () => {
    const width = 60, height = 48;
    const areas = terrainRegions(width, height);
    expect(areas.map((area) => area.region)).toEqual(['ring2', 'ring1', 'center']);
    expect(areas.map((area) => terrainColor(area.region))).toEqual(['#83966b', '#9ca97a', '#b7b384']);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const ratio = Math.max(Math.abs((x + 0.5) / width - 0.5) * 2, Math.abs((y + 0.5) / height - 0.5) * 2);
      const expected = ratio < 0.3 ? 'center' : ratio < 0.66 ? 'ring1' : 'ring2';
      const painted = areas.filter((area) => x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height).at(-1)!;
      expect(painted.region).toBe(expected);
      expect(regionAt(x, y, width, height)).toBe(expected);
    }
  });
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
