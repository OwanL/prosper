import { describe, expect, it } from 'vitest';
import type { WorldEvent, Order } from '../src/shared/types';
import {
  directorCandidate,
  eventPoint,
  humanizeEvent,
  marketQuotes,
  recentStories,
} from '../src/ui/story';
import {
  cameraPoint,
  projectObservation,
  projectWorld,
  regionAt,
  terrainRegions,
} from '../src/ui/model';
import { createWorld } from '../src/world/core';
import { observe } from '../src/world/observation';

describe('spectator evidence', () => {
  it('renders every authoritative region accurately with only three terrain shapes', () => {
    for (const [width, height] of [
      [21, 21],
      [86, 86],
      [14, 19],
    ]) {
      const shapes = terrainRegions(width!, height!);
      expect(shapes).toHaveLength(3);
      for (let y = 0; y < height!; y++)
        for (let x = 0; x < width!; x++) {
          const shape = shapes.findLast(
            (area) =>
              x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height,
          )!;
          expect(shape.region).toBe(regionAt(x, y, width!, height!));
        }
    }
  });
  it('clamps edge camera frames while preserving full-map overview', () => {
    expect(cameraPoint({ x: 1, y: 20 }, 10, 5, 21, 21)).toEqual({ x: 5, y: 18.5 });
    expect(cameraPoint({ x: 8, y: 4 }, 21, 21, 21, 21)).toEqual({ x: 10.5, y: 10.5 });
  });
  const attack: WorldEvent = {
    id: 'attack-1',
    kind: 'attack',
    tick: 20,
    text: 'A hit B',
    citizenId: 'a',
    targetId: 'b',
    x: 3,
    y: 2,
  };
  it('frames committed locations and excludes remote trades, future events, stale events and routine noise', () => {
    const events = [
      attack,
      { ...attack, id: 'noise', kind: 'completion', tick: 21 },
      { ...attack, id: 'future', tick: 30 },
      { ...attack, id: 'old', tick: -200 },
      { ...attack, id: 'remote-trade', kind: 'trade', x: undefined, y: undefined, tick: 22 },
    ];
    expect(recentStories(events, 22).map((event) => event.id)).toEqual([
      'remote-trade',
      'attack-1',
    ]);
    expect(directorCandidate(events, 22, 10, 10)?.id).toBe('attack-1');
    expect(directorCandidate(events, 22, 10, 10, 20)).toBeUndefined();
    expect(eventPoint({ ...attack, x: 10 }, 10, 10)).toBeUndefined();
    expect(eventPoint({ ...attack, y: NaN }, 10, 10)).toBeUndefined();
  });
  it('shows actual best bid/ask, aggregates available quantities and changes no order', () => {
    const orders = [
      { id: '1', item: 'food:1', side: 'sell', price: 5, quantity: 3 },
      { id: '2', item: 'food:1', side: 'sell', price: 3, quantity: 2 },
      { id: '3', item: 'food:1', side: 'buy', price: 2, quantity: 7 },
    ] as Order[];
    const copy = structuredClone(orders);
    expect(marketQuotes(orders)).toEqual([
      { item: 'food:1', ask: 3, bid: 2, supply: 5, demand: 7 },
    ]);
    expect(orders).toEqual(copy);
  });
  it('converts citizen IDs to readable names', () => {
    expect(
      humanizeEvent('c-10 threatened c-1', { 'c-1': { name: 'A' }, 'c-10': { name: 'B' } }),
    ).toBe('B threatened A');
    expect(
      humanizeEvent('Ada (citizen-127) attacked citizen-128', {
        'citizen-127': { name: 'Ada' },
        'citizen-128': { name: 'Bram' },
      }),
    ).toBe('Ada attacked Bram');
  });
  it('does not project global claims, alliances or private live actions into knowledge view', () => {
    const world = createWorld({ seed: 17 });
    const citizen = Object.values(world.citizens)[0]!;
    world.claims = {
      private: {
        id: 'private',
        ownerId: citizen.id,
        areas: [1, 2, 4, 5],
        stance: 'exclusive',
        accessPrice: 0,
        resource: 'wood',
        createdTick: 0,
        expiresTick: 100,
      },
    };
    expect(projectWorld(world).claims).toHaveLength(1);
    const scene = projectObservation(observe(world, citizen.id), world);
    expect(scene.claims).toBeUndefined();
    expect(scene.alliances).toBeUndefined();
    expect(scene.citizens.every(({ value }) => !value.attackTargetId)).toBe(true);
  });
});
