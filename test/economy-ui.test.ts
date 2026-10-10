import { describe, expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core';
import { updateKnowledge } from '../src/world/observation';
import { economySummary } from '../src/ui/Economy';
import { contestedOverlaps } from '../src/ui/Conflict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Economy } from '../src/ui/Economy';
import { Inspector } from '../src/ui/CitizenInspector';
import { Conflict } from '../src/ui/Conflict';
import { claimTerritory, formAlliance } from '../src/world/society';
import { enableAutonomy } from '../src/world/autonomy';

describe('spectator economy evidence', () => {
  it('separates carried tools, sell escrow and unharvested stock', () => {
    const world = createWorld();
    const c = Object.values(world.citizens)[0]!;
    c.inventory['wood:6'] = 8;
    c.inventory['axe:6'] = 1;
    dispatch(world, c.id, { type: 'order', side: 'sell', item: 'wood:6', quantity: 3, price: 9 });
    const data = economySummary(world);
    expect(data.stock['wood:6']?.carried).toBe(5);
    expect(data.stock['wood:6']?.held).toBe(3);
    expect(data.stock['axe:6']?.carried).toBe(1);
    expect(renderToStaticMarkup(createElement(Economy, { world }))).toContain('T6');
  });
  it('describes automatic carried tools without equipped state or equip controls', () => {
    const world = createWorld();
    const citizen = Object.values(world.citizens)[0]!;
    citizen.inventory = { 'axe:1': 1, 'axe:6': 1 };
    const inspector = renderToStaticMarkup(createElement(Inspector, { citizen, unavailable: false, cancel: () => {}, result: '' }));
    expect(inspector).toContain('Highest-tier carried tools are used automatically');
    expect(inspector).toContain('axe:1');
    expect(inspector).toContain('axe:6');
    expect(inspector).not.toContain('Equipped:');
    expect(inspector).not.toContain('Equipment is included');
    const economy = renderToStaticMarkup(createElement(Economy, { world }));
    expect(economy).toContain('carried tools are used automatically');
    expect(economy).not.toContain('equipment references');
  });
  it('includes travel-held inputs and down refinement in station use, without claiming completed output', () => {
    const world = createWorld();
    const c = Object.values(world.citizens)[0]!;
    world.buildings.station = {
      id: 'station',
      kind: 'lumbermill',
      tier: 6,
      ownerId: c.id,
      x: 1,
      y: 1,
      health: 100,
      maxHealth: 100,
      materials: {},
    };
    c.action = {
      id: 'work',
      command: { type: 'refine', buildingId: 'station', fromTier: 6, direction: 'down' },
      phase: 'travel',
      startedTick: 0,
      elapsed: 0,
      duration: 5,
      reserved: { 'wood:6': 1 },
      path: [],
      target: { x: 1, y: 1 },
    };
    const data = economySummary(world);
    expect(data.used.size).toBe(1);
    expect(data.stock['wood:6']?.held).toBe(1);
    expect(data.jobs.get('refine down T6 → T5 · travel')).toBe(1);
    expect(data.stock['wood:5']?.carried ?? 0).toBe(0);
  });
  it('keeps interrupted work inputs in held stock during emergency feeding', () => {
    const world = createWorld();
    const citizen = Object.values(world.citizens)[0]!;
    citizen.inventory = { 'wood:1': 3, 'fibre:1': 3 };
    expect(dispatch(world, citizen.id, { type: 'craft', item: 'knife', tier: 1 }).ok).toBe(true);
    const suspendedAction = structuredClone(citizen.action!);
    world.deposits.food = {
      id: 'food', resource: 'food', tier: 1, x: citizen.x, y: citizen.y,
      stock: 1, capacity: 1, regrowAt: 0,
    };
    updateKnowledge(world);
    citizen.fullness = 0;
    tickWorld(world);
    expect(citizen.emergency?.suspendedAction).toEqual(suspendedAction);
    const data = economySummary(world);
    expect(data.stock['wood:1']?.held).toBe(3);
    expect(data.stock['fibre:1']?.held).toBe(3);
    expect(data.stock['wood:1']?.carried ?? 0).toBe(0);
  });
  it('reports only retained decoded fills; never infers lifetime volume from orders', () => {
    const world = createWorld();
    world.tick = 50;
    world.significantEvents = [
      { id: 'one', tick: 12, kind: 'trade', text: '3 food:2 sold for 4 gold each.' },
      { id: 'two', tick: 30, kind: 'trade', text: '2 food:2 sold for 7 gold each.' },
      { id: 'old-format', tick: 31, kind: 'trade', text: 'Unknown receipt' },
    ];
    const data = economySummary(world);
    expect(data.volumes.get('food:2')).toEqual({ units: 5, gold: 26, lastPrice: 7, tick: 30 });
    expect(data.unparsed).toBe(1);
    const html = renderToStaticMarkup(createElement(Economy, { world }));
    expect(html).toContain('not lifetime volume');
    expect(html).toContain('No public quotes available');
  });
  it('distinguishes alliance shared claims, rival overlaps and recent strikes from active actions', () => {
    const world = createWorld();
    const [a, b, c] = Object.values(world.citizens);
    for (const actor of [a!, b!, c!]) enableAutonomy(world, actor);
    formAlliance(world, a!, b!);
    claimTerritory(world, a!, [8, 8, 12, 12]);
    claimTerritory(world, c!, [10, 10, 14, 14]);
    const overlaps = contestedOverlaps(
      Object.values(world.claims!),
      Object.values(world.alliances!),
    );
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]?.area).toEqual([10, 10, 12, 12]);
    world.significantEvents = [{ id: 'strike', kind: 'attack', tick: 0, text: 'Earlier strike' }];
    const html = renderToStaticMarkup(
      createElement(Conflict, { world, select: () => {}, focus: () => {} }),
    );
    expect(html).toContain('No active attacks');
    expect(html).toContain('Recent strikes · recorded, not active');
    expect(html).toContain('members:');
  });
});
