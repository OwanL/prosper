import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorldEvent } from '../src/shared/types';
import type { SceneModel } from '../src/ui/model';
import {
  CitizenRoster,
  WorldActivity,
  filterRoster,
  selectActivityEvents,
  type ActivityWorld,
} from '../src/ui/WorldActivity';

const event = (id: string, tick: number, kind = 'birth', text = `${id} recorded`): WorldEvent => ({
  id,
  tick,
  kind,
  text,
});
const world: ActivityWorld = {
  tick: 100,
  events: [event('receipt', 99, 'completion'), event('old', 1)],
  significantEvents: [event('new', 90)],
  citizens: { 'citizen-1': { name: 'Ada Vale' } },
};
const citizens: SceneModel['citizens'] = [
  {
    value: {
      id: 'citizen-1',
      name: 'Ada Vale',
      color: '#fff',
      x: 0,
      y: 0,
      alive: true,
      health: 81,
      activity: 'gather',
      fullness: 62,
    },
    remembered: false,
    seenTick: 100,
  },
  {
    value: {
      id: 'citizen-2',
      name: 'Bram Reed',
      color: '#fff',
      x: 1,
      y: 1,
      alive: false,
      health: 0,
      activity: 'dead',
    },
    remembered: true,
    seenTick: 12,
  },
];

describe('world activity selection', () => {
  it('prefers the consequential ring and only falls back when it is absent', () => {
    expect(selectActivityEvents(world).map((e) => e.id)).toEqual(['new']);
    expect(
      selectActivityEvents({ ...world, significantEvents: undefined }).map((e) => e.id),
    ).toEqual(['old']);
    expect(selectActivityEvents({ ...world, significantEvents: [] })).toEqual([]);
  });
  it('treats explicit private events, even an empty array, as the whole source', () => {
    expect(selectActivityEvents(world, [])).toEqual([]);
    expect(selectActivityEvents(world, [event('known', 5)]).map((e) => e.id)).toEqual(['known']);
  });
  it('filters mundane receipts and future entries, deduplicates repeated routine consequences, and caps at 20 newest', () => {
    const supplied = [
      event('command', 99, 'command'),
      event('meal', 99, 'meal'),
      event('future', 101),
      event('first', 90, 'trade', '1 food sold'),
      event('duplicate', 89, 'trade', '1 food sold'),
      ...Array.from({ length: 25 }, (_, i) => event(`birth-${i}`, i)),
    ];
    const copy = JSON.stringify(supplied);
    const recent = selectActivityEvents(world, supplied);
    expect(recent).toHaveLength(20);
    expect(recent[0]?.id).toBe('first');
    expect(recent[1]?.id).toBe('birth-24');
    expect(JSON.stringify(supplied)).toBe(copy);
  });
  it('shows honest ticks, readable names and only explicitly provided history', () => {
    const html = renderToStaticMarkup(
      createElement(WorldActivity, {
        world,
        events: [
          { ...event('known', 5, 'birth', 'citizen-1 had a child.'), citizenId: 'citizen-1' },
        ],
        onFocus: () => {},
      }),
    );
    expect(html).toContain('Ada Vale had a child.');
    expect(html).toContain('Tick 5');
    expect(html).toContain('<summary>Activity');
    expect(html).not.toContain('citizen-1');
    expect(html).not.toContain('new recorded');
  });
});

describe('projected citizen roster', () => {
  it('searches names and known activities/status, ignoring whitespace and case', () => {
    expect(filterRoster(citizens, ' ADA ')).toEqual([citizens[0]]);
    expect(filterRoster(citizens, 'gather')).toEqual([citizens[0]]);
    expect(filterRoster(citizens, 'remembered')).toEqual([citizens[1]]);
    expect(filterRoster(citizens, 'dead')).toEqual([citizens[1]]);
    expect(filterRoster(citizens, '')).toHaveLength(2);
    expect(filterRoster(citizens, 'unknown')).toEqual([]);
  });
  it('renders only projected known vitals, labels memories, and never serializes extra private fields', () => {
    const projected = citizens.map((entry) => ({
      ...entry,
      value: { ...entry.value, gold: 123456, memory: 'SECRET NOTE' },
    }));
    const html = renderToStaticMarkup(
      createElement(CitizenRoster, {
        citizens: projected,
        selectedId: 'citizen-1',
        privateId: 'citizen-1',
        onSelect: () => {},
      }),
    );
    expect(html).toContain('Ada Vale');
    expect(html).toContain('Health 81/100');
    expect(html).toContain('Fullness 62/100');
    expect(html).toContain('Last known Health 0/100');
    expect(html).not.toContain('Last known Fullness');
    expect(html).toContain('Remembered');
    expect(html).toContain('Dead');
    expect(html).toContain('tick 12');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Perspective');
    expect(html).not.toContain('123456');
    expect(html).not.toContain('SECRET NOTE');
  });
});
